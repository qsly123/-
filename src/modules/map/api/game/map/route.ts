import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import { db } from "@/db";
import { players } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getStaminaSettings } from "@/modules/character/services/stamina-service";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { loadMapSceneContextForPlayer } from "@/modules/map/services/map-scene-loader";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { loadFullMapPanelData } from "@/modules/map/services/map-full-panel-data";
import { queueOpportunitySpawnsForMap } from "@/modules/map/services/opportunity-service";
import { getPortalTileAt, listWalkablePortalTiles } from "@/modules/map/services/map-portal";
import { getActiveEncounterSessionForPlayer } from "@/modules/map/services/map-encounter-session-service";
import { filterMapSceneStateByVision } from "@/modules/map/services/map-vision";
import { advanceMapSceneTick, ensureMapSceneTick, resetMapClientSequence } from "@/modules/map/services/map-scene-sync";
import {
  repairStaleSecretRealmReferenceForPlayer,
} from "@/modules/map/services/secret-realm-instance-service";
import { ensureSecretRealmRuntimeCleanup } from "@/modules/map/services/secret-realm-runtime-maintenance";
import { ensureSecretRealmSpawnsForMap } from "@/modules/map/services/secret-realm-spawn-service";
import { isSecretRealmMapType } from "@/modules/map/services/secret-realm-types";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { publishMapPresencePlayerPosition } from "@/modules/map/services/map-presence";
import { canPlayerAccessSectMap } from "@/modules/sect/services/sect-service";
import { normalizeNpcAvatarImageUrl } from "@/modules/shared/services/cosmetic-url";
import { resetRepeatKillGuard } from "@/modules/combat/services/repeat-kill-guard";
import {
  markMapPlayerOnlinePresence,
  peekMapPlayerOnlinePresence,
} from "@/modules/map/services/map-player-online-runtime";
import { recordRuntimeMapSilentRefresh } from "@/modules/system/services/runtime-map-interaction-stats";

function calcCombatPower(stats: {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
}) {
  return calculateCombatPower(stats);
}

function shouldForceSceneContextReload(reason: string) {
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) {
    return false;
  }

  return [
    "map_changed",
    "runtime_restart",
    "snapshot_chain_break",
    "scene_version_gap",
    "missing_connection_window",
    "monster_defeat_signal",
    "map_refresh_signal",
    "event_modal_close",
    "ack_timeout_resync",
  ].includes(normalizedReason);
}

/** GET - 获取当前地图数据 */
export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const refreshMode = searchParams.get("refreshMode") === "silent" ? "silent" : "full";
    const silentRefresh = refreshMode === "silent";
    const silentRefreshReason = String(searchParams.get("reason") || "").trim() || "manual";
    const includeWorldIntelDetails = !silentRefresh && searchParams.get("includeWorldIntel") === "1";

    if (!silentRefresh) {
      await ensureSecretRealmRuntimeCleanup();
    }

    const [playerStats, staminaSettings, playerCosmetic] = await Promise.all([
      buildPlayerStatsSnapshot(player),
      getStaminaSettings(),
      getPlayerCosmeticProfileById(player.id),
    ]);
    const spiritualSense = playerStats.total.spiritualSense;
    const combatPower = calcCombatPower(playerStats.total);

    let currentPlayer = {
      ...player,
      currentMapId: player.currentMapId || "map_starter_village",
      currentMapInstanceId: player.currentMapInstanceId ?? null,
    };
    let mapId = currentPlayer.currentMapId;
    let map = await getRuntimeMapById(mapId);
    if (!map) {
      return NextResponse.json({ success: false, error: "地图不存在" }, { status: 404 });
    }
    if (map.mapType === "sect") {
      const sectAccess = await canPlayerAccessSectMap({
        playerId: player.id,
        mapId: map.id,
      });
      if (!sectAccess.allowed && sectAccess.sect) {
        const fallbackMap = await getRuntimeMapById(sectAccess.sect.externalMapId);
        if (!fallbackMap) {
          return NextResponse.json({ success: false, error: sectAccess.reason || "宗门入口地图不存在" }, { status: 400 });
        }
        const nowIso = new Date().toISOString();
        await db.update(players)
          .set({
            currentMapId: fallbackMap.id,
            currentMapInstanceId: null,
            positionX: sectAccess.sect.externalPositionX,
            positionY: sectAccess.sect.externalPositionY,
            updatedAt: nowIso,
          })
          .where(eq(players.id, player.id))
          .run();
        ensureMapSceneTick(map.id);
        ensureMapSceneTick(fallbackMap.id);
        advanceMapSceneTick(map.id);
        advanceMapSceneTick(fallbackMap.id);
        resetMapClientSequence(player.id, fallbackMap.id);
        resetRepeatKillGuard(player.id);
        await warmMapSceneSharedStateForMapId({
          mapId: fallbackMap.id,
          reason: "player_transition",
        }).catch((error) => {
          console.error("Map route sect fallback prewarm error:", error);
        });
        publishMapPresencePlayerPosition({
          id: player.id,
          name: player.name,
          gender: player.gender,
          avatarImageUrl: playerCosmetic.avatarImageUrl,
          avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
          realm: player.realm,
          realmMajor: player.realmMajor,
          realmMinor: player.realmMinor,
          realmName: player.realmName,
          mapId: fallbackMap.id,
          prevMapId: map.id,
          positionX: sectAccess.sect.externalPositionX,
          positionY: sectAccess.sect.externalPositionY,
        });
        currentPlayer = {
          ...currentPlayer,
          currentMapId: fallbackMap.id,
          currentMapInstanceId: null,
          positionX: sectAccess.sect.externalPositionX,
          positionY: sectAccess.sect.externalPositionY,
          updatedAt: nowIso,
        };
        mapId = fallbackMap.id;
        map = fallbackMap;
      }
    }
    const secretRealmMap = isSecretRealmMapType(map.mapType);
    const allowSecretRealmSpawns = !secretRealmMap && map.mapType !== "open_world";
    const allowOpportunities = !secretRealmMap && map.mapType !== "open_world";
    const repairedStaleSecretRealmReference = !silentRefresh && !secretRealmMap && currentPlayer.currentMapInstanceId
      ? await repairStaleSecretRealmReferenceForPlayer({
        playerId: player.id,
        player: currentPlayer,
        currentMapType: map.mapType,
      })
      : false;
    const effectiveCurrentMapInstanceId = repairedStaleSecretRealmReference ? null : (currentPlayer.currentMapInstanceId ?? null);
    const playerPortal = getPortalTileAt(map.tilesData, currentPlayer.positionX, currentPlayer.positionY);
    const playerOnPortal = Boolean(playerPortal);
    const mapData = {
      id: map.id,
      width: map.width,
      height: map.height,
      mapType: map.mapType,
      tilesData: map.tilesData,
    };

    const previousOnlinePresence = peekMapPlayerOnlinePresence(currentPlayer.id);
    markMapPlayerOnlinePresence({
      playerId: currentPlayer.id,
      mapId: map.id,
      positionX: currentPlayer.positionX,
      positionY: currentPlayer.positionY,
    });
    const shouldBroadcastPresence = !previousOnlinePresence
      || previousOnlinePresence.mapId !== map.id
      || previousOnlinePresence.positionX !== currentPlayer.positionX
      || previousOnlinePresence.positionY !== currentPlayer.positionY;
    if (shouldBroadcastPresence) {
      publishMapPresencePlayerPosition({
        id: currentPlayer.id,
        name: currentPlayer.name,
        gender: currentPlayer.gender,
        avatarImageUrl: playerCosmetic.avatarImageUrl,
        avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
        realm: currentPlayer.realm,
        realmMajor: currentPlayer.realmMajor,
        realmMinor: currentPlayer.realmMinor,
        realmName: currentPlayer.realmName,
        mapId: map.id,
        prevMapId: previousOnlinePresence?.mapId || map.id,
        positionX: currentPlayer.positionX,
        positionY: currentPlayer.positionY,
      });
    }

    const sharedStateWarmPromise = !silentRefresh
      ? warmMapSceneSharedStateForMapId({
        mapId,
        reason: "player_transition",
      }).catch((error) => {
        console.error("Map route shared state prewarm error:", error);
        return null;
      })
      : null;
    void sharedStateWarmPromise;

    if (!silentRefresh && allowOpportunities) {
      queueOpportunitySpawnsForMap({
        mapId,
        mapData,
      });
    }
    if (!silentRefresh && allowSecretRealmSpawns) {
      await ensureSecretRealmSpawnsForMap({
        mapId,
        playerId: player.id,
        mapData: {
          ...mapData,
          name: map.name,
          minRealm: map.minRealm,
        },
      });
    }
    const sceneContext = await loadMapSceneContextForPlayer(player.id, {
      force: silentRefresh && shouldForceSceneContextReload(silentRefreshReason),
      player: {
        id: currentPlayer.id,
        name: currentPlayer.name,
        gender: currentPlayer.gender,
        realm: currentPlayer.realm,
        realmMajor: currentPlayer.realmMajor,
        realmMinor: currentPlayer.realmMinor,
        realmName: currentPlayer.realmName,
        positionX: currentPlayer.positionX,
        positionY: currentPlayer.positionY,
        currentMapId: currentPlayer.currentMapId,
      },
      map: {
        id: map.id,
        width: map.width,
        height: map.height,
        tilesData: map.tilesData,
      },
      playerCosmetic,
    });
    if (!sceneContext) {
      return NextResponse.json({ success: false, error: "地图场景加载失败" }, { status: 500 });
    }
    const visibleSceneState = filterMapSceneStateByVision(sceneContext.sceneState, spiritualSense);
    const sceneTick = ensureMapSceneTick(map.id);
    const sceneServerTimeMs = Date.now();
    const opportunities = visibleSceneState.opportunities;
    const portalTiles = secretRealmMap ? [] : listWalkablePortalTiles(map.tilesData);
    const activeEncounterSession = await getActiveEncounterSessionForPlayer(player.id, mapId);
    const basePortals = portalTiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      portalId: tile.portalId || "",
      portalName: tile.portalName || `传送阵(${tile.x},${tile.y})`,
      targetMapId: tile.portalTargetMapId || "",
      targetMapName: tile.portalTargetName || "",
      targetPortalId: tile.portalTargetPortalId || "",
      imageUrl: tile.imageUrl || null,
    }));
    const sceneResponseData = {
      map: {
        id: map.id,
        name: map.name,
        description: map.description,
        backgroundImageUrl: map.backgroundImageUrl,
        width: map.width,
        height: map.height,
        mapType: map.mapType,
        tilesData: Array.isArray(map.tilesData) ? map.tilesData : [],
      },
      player: {
        id: currentPlayer.id,
        positionX: currentPlayer.positionX,
        positionY: currentPlayer.positionY,
        currentMapInstanceId: effectiveCurrentMapInstanceId,
        name: currentPlayer.name,
        gender: currentPlayer.gender,
        avatarImageUrl: playerCosmetic.avatarImageUrl,
        avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
        realm: currentPlayer.realm,
        realmMajor: currentPlayer.realmMajor,
        realmMinor: currentPlayer.realmMinor,
        realmName: currentPlayer.realmName,
        combatPower,
        spiritualSense,
        gold: currentPlayer.gold,
        lingYu: currentPlayer.lingYu,
        stamina: currentPlayer.stamina,
        staminaMax: staminaSettings.max,
      },
      playerOnPortal,
      playerPortal: playerPortal ? {
        x: playerPortal.x,
        y: playerPortal.y,
        portalId: playerPortal.portalId || "",
        portalName: playerPortal.portalName || `传送阵(${playerPortal.x}, ${playerPortal.y})`,
        targetMapId: playerPortal.portalTargetMapId || "",
        targetMapName: playerPortal.portalTargetName || "",
        targetPortalId: playerPortal.portalTargetPortalId || "",
        imageUrl: playerPortal.imageUrl || null,
      } : null,
      portals: basePortals,
      npcs: visibleSceneState.npcs.map((npc) => ({
        ...npc,
        avatarImageUrl: normalizeNpcAvatarImageUrl(npc.avatarImageUrl),
      })),
      monsters: visibleSceneState.monsters,
      otherPlayers: visibleSceneState.otherPlayers,
      opportunities,
      activeEncounterSession,
      sceneTick,
      sceneServerTimeMs,
    };

    if (silentRefresh) {
      recordRuntimeMapSilentRefresh(silentRefreshReason);
      return NextResponse.json({
        success: true,
        data: sceneResponseData,
      });
    }

    const fullPanelData = await loadFullMapPanelData({
      playerId: player.id,
      playerRealm: player.realm,
      mapId,
      map: {
        id: map.id,
        name: map.name,
        mapType: map.mapType,
      },
      currentPlayer: {
        id: currentPlayer.id,
        name: currentPlayer.name,
        realm: currentPlayer.realm,
        realmMinor: currentPlayer.realmMinor,
        positionX: currentPlayer.positionX,
        positionY: currentPlayer.positionY,
      },
      playerPortal: sceneResponseData.playerPortal ? {
        x: sceneResponseData.playerPortal.x,
        y: sceneResponseData.playerPortal.y,
        portalId: sceneResponseData.playerPortal.portalId,
        portalName: sceneResponseData.playerPortal.portalName,
        targetMapId: sceneResponseData.playerPortal.targetMapId,
        targetMapName: sceneResponseData.playerPortal.targetMapName,
        targetPortalId: sceneResponseData.playerPortal.targetPortalId,
        imageUrl: sceneResponseData.playerPortal.imageUrl,
      } : null,
      portalTiles,
      sceneNpcs: sceneResponseData.npcs,
      opportunities: opportunities.map((opportunity) => ({
        spawnId: opportunity.spawnId,
        name: opportunity.name,
        positionX: opportunity.positionX,
        positionY: opportunity.positionY,
      })),
      secretRealmMap,
      allowSecretRealmSpawns,
      effectiveCurrentMapInstanceId,
      includeWorldIntelDetails,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...sceneResponseData,
        ...fullPanelData,
      },
    });
  } catch (e) {
    console.error("Map data error:", e);
    return NextResponse.json({ success: false, error: "获取地图失败" }, { status: 500 });
  }
}
