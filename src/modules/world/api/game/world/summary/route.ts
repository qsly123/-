import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { loadMapSceneContextForPlayer } from "@/modules/map/services/map-scene-loader";
import { ensureOpportunitySpawnsForMap, listActiveOpportunitiesByMap } from "@/modules/map/services/opportunity-service";
import { getPortalTileAt, listWalkablePortalTiles } from "@/modules/map/services/map-portal";
import { filterMapSceneStateByVision } from "@/modules/map/services/map-vision";
import { getRuntimeMapById, listRuntimeMapsByIds } from "@/modules/map/services/runtime-map-store";
import { readThroughReadModelCache } from "@/modules/shared/services/read-model-cache";
import {
  buildWorldSummaryCacheKey,
  getWorldSummaryCacheTtlMs,
} from "@/modules/shared/services/read-model-cache-keys";
import { listWorldAdultInvitesForMap } from "@/modules/world/services/world-adult-service";
import { getSafePlayerWorldPressureSnapshot } from "@/modules/world/services/player-world-pressure-service";
import { getOpenWorldMapExplorationSummary } from "@/modules/world/services/world-map-service";
import { loadRemoteMapWorldSummary, loadWorldSummaryView } from "@/modules/world/services/world-summary-service";

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedMapId = String(searchParams.get("mapId") || player.currentMapId || "").trim();
    if (!requestedMapId) {
      return NextResponse.json({ success: false, error: "缺少地图标识" }, { status: 400 });
    }

    const runtimeMap = await getRuntimeMapById(requestedMapId);
    if (!runtimeMap) {
      return NextResponse.json({ success: false, error: "地图不存在" }, { status: 404 });
    }

    const currentMapId = String(player.currentMapId || "").trim();
    const data = await readThroughReadModelCache({
      key: buildWorldSummaryCacheKey({
        playerId: player.id,
        requestedMapId,
        currentMapId,
        currentMapInstanceId: player.currentMapInstanceId,
        positionX: player.positionX,
        positionY: player.positionY,
      }),
      ttlMs: getWorldSummaryCacheTtlMs(),
      statGroup: "world_summary",
      loader: async () => {
        const pressureSnapshot = await getSafePlayerWorldPressureSnapshot(player.id);
        if (requestedMapId !== currentMapId) {
          return await loadRemoteMapWorldSummary({
            playerId: player.id,
            mapId: runtimeMap.id,
            mapType: runtimeMap.mapType,
            mapName: runtimeMap.name,
            pressureSnapshot,
          });
        }

        if (runtimeMap.mapType !== "open_world") {
          await ensureOpportunitySpawnsForMap({
            mapId: runtimeMap.id,
            mapData: {
              id: runtimeMap.id,
              width: runtimeMap.width,
              height: runtimeMap.height,
              mapType: runtimeMap.mapType,
              tilesData: runtimeMap.tilesData,
            },
          }).catch(() => null);
        }

        const playerStats = await buildPlayerStatsSnapshot(player);
        const playerCosmetic = await getPlayerCosmeticProfileById(player.id);
        const opportunities = runtimeMap.mapType !== "open_world"
          ? await listActiveOpportunitiesByMap(runtimeMap.id).catch(() => [])
          : [];
        const sceneContext = await loadMapSceneContextForPlayer(player.id, {
          player: {
            id: player.id,
            name: player.name,
            gender: player.gender,
            realm: player.realm,
            realmMajor: player.realmMajor,
            realmMinor: player.realmMinor,
            realmName: player.realmName,
            positionX: player.positionX,
            positionY: player.positionY,
            currentMapId: runtimeMap.id,
          },
          map: {
            id: runtimeMap.id,
            width: runtimeMap.width,
            height: runtimeMap.height,
            tilesData: runtimeMap.tilesData,
          },
          playerCosmetic,
          opportunities,
        });

        const visibleSceneState = sceneContext
          ? filterMapSceneStateByVision(sceneContext.sceneState, playerStats.total.spiritualSense)
          : null;
        const portalTiles = listWalkablePortalTiles(runtimeMap.tilesData);
        const portalTargetMapIds = Array.from(new Set(portalTiles
          .map((tile) => String(tile.portalTargetMapId || "").trim())
          .filter(Boolean)));
        const linkedMaps = await listRuntimeMapsByIds(portalTargetMapIds);
        const linkedMapMetaMap = new Map(linkedMaps.map((row) => [row.id, row]));
        const playerPortal = getPortalTileAt(runtimeMap.tilesData, player.positionX, player.positionY);
        const adultInvites = runtimeMap.mapType === "open_world"
          ? await listWorldAdultInvitesForMap({
            playerId: player.id,
            mapId: runtimeMap.id,
          }).catch(() => ({ invites: [], adultDangerHints: [] }))
          : { invites: [], adultDangerHints: [] };

        const summary = await loadWorldSummaryView({
          playerId: player.id,
          mapId: runtimeMap.id,
          mapName: runtimeMap.name,
          mapType: runtimeMap.mapType,
          playerPositionX: player.positionX,
          playerPositionY: player.positionY,
          npcs: (visibleSceneState?.npcs || []).map((npc) => ({
            id: npc.id,
            name: npc.name,
            title: npc.title,
            positionX: npc.positionX,
            positionY: npc.positionY,
            isShop: npc.isShop,
            sourceType: npc.sourceType,
            detailRoute: npc.detailRoute || null,
            currentActionLabel: npc.currentActionLabel || null,
          })),
          portals: portalTiles.map((tile) => ({
            x: tile.x,
            y: tile.y,
            portalId: tile.portalId || "",
            portalName: tile.portalName || `传送阵(${tile.x},${tile.y})`,
            targetMapId: tile.portalTargetMapId || "",
            targetMapName: tile.portalTargetName || linkedMapMetaMap.get(tile.portalTargetMapId || "")?.name || "",
          })),
          opportunities: (visibleSceneState?.opportunities || []).map((opportunity) => ({
            spawnId: opportunity.spawnId,
            name: opportunity.name,
            positionX: opportunity.positionX,
            positionY: opportunity.positionY,
          })),
          pressureSnapshot,
          adultInvites: adultInvites.invites,
          openWorldExploration: runtimeMap.mapType === "open_world"
            ? await getOpenWorldMapExplorationSummary(runtimeMap.id).catch(() => null)
            : null,
        });

        return {
          ...summary,
          playerOnPortal: Boolean(playerPortal),
        };
      },
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("World summary error:", error);
    return NextResponse.json({ success: false, error: "获取地图摘要失败" }, { status: 500 });
  }
}
