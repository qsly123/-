import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { mapEdges, players } from "@/db/schema";
import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { fromLinearRealm, getRealmFullNameByPosition } from "@/modules/character/services/realm-service";
import { publishMapPresencePlayerPosition } from "@/modules/map/services/map-presence";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { getMapTravelMode } from "@/modules/map/services/map-travel-mode";
import {
  buildPartyMapTravelBlockedMessage,
  listPartyMembersBelowMapRealm,
} from "@/modules/map/services/party-map-travel-restriction";
import { getPortalTileAt, getPortalTravelTarget, pickPortalSpawn } from "@/modules/map/services/map-portal";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { advanceMapSceneTick, ensureMapSceneTick, resetMapClientSequence } from "@/modules/map/services/map-scene-sync";
import { resetRepeatKillGuard } from "@/modules/combat/services/repeat-kill-guard";
import {
  leaveSecretRealmForPlayer,
  repairStaleSecretRealmReferenceForPlayer,
} from "@/modules/map/services/secret-realm-instance-service";
import { canPlayerAccessSectMap } from "@/modules/sect/services/sect-service";
import { SECT_HOME_START_SPAWN_PORTAL_ID } from "@/modules/sect/services/sect-map-service";
import { getPartyMovementContext } from "@/modules/social/infrastructure/party-service";
import { isSecretRealmMapType } from "@/modules/map/services/secret-realm-types";
import { normalizeLegacyMapTravelRequest } from "@immortality/shared-protocol";
import {
  finishMapActionIdempotency,
  startMapActionIdempotency,
} from "@/modules/map/services/map-action-idempotency";

export async function POST(request: Request) {
  let idempotencyKey: string | null = null;
  try {
    const player = await getCurrentPlayer(request);
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const rawBody = await request.json();
    const normalizedProtocolInput = normalizeLegacyMapTravelRequest(rawBody);
    if (!normalizedProtocolInput.ok) {
      return NextResponse.json({
        success: false,
        error: normalizedProtocolInput.error,
        data: {
          realtimeAck: normalizedProtocolInput.ack,
        },
      }, { status: normalizedProtocolInput.status });
    }
    const { mapId: legacyMapId, targetMapId: protocolTargetMapId } = normalizedProtocolInput.legacyBody as {
      mapId?: unknown;
      targetMapId?: unknown;
    };
    const targetMapId = typeof protocolTargetMapId === "string"
      ? protocolTargetMapId
      : typeof legacyMapId === "string"
        ? legacyMapId
        : "";
    if (!targetMapId || typeof targetMapId !== "string") {
      return NextResponse.json({ success: false, error: "缺少目标地图" }, { status: 400 });
    }
    const travelInput = normalizedProtocolInput.input;

    const currentMapId = player.currentMapId || "map_starter_village";
    const idempotency = await startMapActionIdempotency({
      scope: "map-travel",
      roomId: "next-api:map-travel",
      playerId: player.id,
      actionId: travelInput.actionId,
      inputType: "travel",
      mapId: currentMapId,
      targetMapId,
      payload: {
        ...normalizedProtocolInput.legacyBody,
        targetMapId,
      },
    });
    idempotencyKey = idempotency.idempotencyKey;
    if (idempotency.status === "accepted") {
      return NextResponse.json({
        success: true,
        data: {
          ...idempotency.result,
          alreadyProcessed: true,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      });
    }
    if (idempotency.status === "rejected") {
      return NextResponse.json({
        success: false,
        error: idempotency.reason || "地图切换失败",
        data: {
          ...idempotency.result,
          alreadyProcessed: true,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      }, { status: 400 });
    }
    if (idempotency.status === "pending") {
      return NextResponse.json({
        success: false,
        error: "地图切换正在处理中，请稍后重试",
        data: {
          realtimeAck: {
            accepted: false,
            inputType: travelInput.inputType,
            acceptedSequence: travelInput.clientSequence,
            reason: "settlement_pending",
            serverTick: travelInput.clientSceneTick,
            authoritativeState: {
              targetMapId,
              alreadyProcessing: true,
            },
          },
          protocol: normalizedProtocolInput.protocolMeta,
        },
      }, { status: 409 });
    }

    if (targetMapId === currentMapId) {
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: "已在当前地图",
        result: { mapId: currentMapId },
      });
      return NextResponse.json({ success: false, error: "已在当前地图" }, { status: 400 });
    }

    const currentMap = await getRuntimeMapById(currentMapId);
    if (!currentMap) {
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: "当前地图不存在",
        result: { mapId: currentMapId },
      });
      return NextResponse.json({ success: false, error: "当前地图不存在" }, { status: 404 });
    }
    const repairedStaleSecretRealmReference = player.currentMapInstanceId && !isSecretRealmMapType(currentMap.mapType)
      ? await repairStaleSecretRealmReferenceForPlayer({
        playerId: player.id,
        player,
        currentMapType: currentMap.mapType,
      })
      : false;
    const activeSecretRealmInstanceId = repairedStaleSecretRealmReference ? null : player.currentMapInstanceId;

    if (activeSecretRealmInstanceId) {
      const currentPortal = getPortalTileAt(currentMap.tilesData, player.positionX, player.positionY);
      if (currentPortal?.portalTargetMapId === targetMapId) {
        try {
          const leaveResult = await leaveSecretRealmForPlayer(player.id);
          if (leaveResult.mapId) {
            await warmMapSceneSharedStateForMapId({
              mapId: leaveResult.mapId,
              reason: "player_transition",
            }).catch((error) => {
              console.error("Travel secret realm return prewarm error:", error);
            });
          }
          const responseData = {
            mapId: leaveResult.mapId,
            mapName: currentPortal.portalTargetName || "原地图",
            positionX: leaveResult.positionX,
            positionY: leaveResult.positionY,
          };
          await finishMapActionIdempotency({
            idempotencyKey,
            status: "accepted",
            result: responseData,
          });
          return NextResponse.json({
            success: true,
            data: {
              ...responseData,
              protocol: normalizedProtocolInput.protocolMeta,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "秘境回返失败";
          return NextResponse.json({ success: false, error: message }, { status: 400 });
        }
      }

      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: "秘境中请通过回返阵离开",
        result: { currentMapId, targetMapId },
      });
      return NextResponse.json({ success: false, error: "秘境中请通过回返阵离开" }, { status: 400 });
    }

    const travelMode = await getMapTravelMode();
    const currentPortal = travelMode === "portal"
      ? getPortalTileAt(currentMap.tilesData, player.positionX, player.positionY)
      : null;
    const resolvedPortalTarget = travelMode === "portal"
      ? getPortalTravelTarget(currentPortal, targetMapId)
      : null;
    const isSectStartPortal = resolvedPortalTarget?.portalId === SECT_HOME_START_SPAWN_PORTAL_ID;
    const gameStartConfig = isSectStartPortal ? await getGameStartConfig() : null;
    const resolvedTargetMapId = isSectStartPortal
      ? gameStartConfig!.mapId
      : String(resolvedPortalTarget?.mapId || targetMapId).trim();
    const requiredTargetMapId = String(resolvedPortalTarget?.mapId || "").trim();

    if (travelMode !== "portal" || !requiredTargetMapId) {
      const edge = await db.select().from(mapEdges).where(
        or(
          and(eq(mapEdges.mapAId, currentMapId), eq(mapEdges.mapBId, resolvedTargetMapId)),
          and(eq(mapEdges.mapAId, resolvedTargetMapId), eq(mapEdges.mapBId, currentMapId)),
        ),
      ).get();

      if (!edge) {
        await finishMapActionIdempotency({
          idempotencyKey,
          status: "rejected",
          reason: "两张地图尚未连通",
          result: { currentMapId, targetMapId: resolvedTargetMapId },
        });
        return NextResponse.json({ success: false, error: "两张地图尚未连通" }, { status: 400 });
      }
    }
    const targetMap = await getRuntimeMapById(resolvedTargetMapId);
    if (!targetMap) {
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: "目标地图不存在",
        result: { currentMapId, targetMapId: resolvedTargetMapId },
      });
      return NextResponse.json({ success: false, error: "目标地图不存在" }, { status: 404 });
    }
    const sectAccess = await canPlayerAccessSectMap({
      playerId: player.id,
      mapId: targetMap.id,
    });
    if (!sectAccess.allowed) {
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: sectAccess.reason || "无权进入该宗门驻地",
        result: { currentMapId, targetMapId: targetMap.id },
      });
      return NextResponse.json({ success: false, error: sectAccess.reason || "无权进入该宗门驻地" }, { status: 403 });
    }

    if (player.realm < targetMap.minRealm) {
      const requiredRealm = await fromLinearRealm(targetMap.minRealm);
      const requiredRealmName = await getRealmFullNameByPosition(requiredRealm.major, requiredRealm.minor);
      const error = `需要达到 ${requiredRealmName} 及以上，才能进入 ${targetMap.name}`;
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: error,
        result: { currentMapId, targetMapId: targetMap.id, requiredRealm: targetMap.minRealm },
      });
      return NextResponse.json({
        success: false,
        error,
      }, { status: 400 });
    }
    const partyMovementContext = await getPartyMovementContext(player.id);
    const blockedMembers = listPartyMembersBelowMapRealm({
      members: partyMovementContext?.members.map((member) => ({
        id: member.id,
        name: member.name,
        realm: member.realm,
        realmName: member.realmName,
      })) || [],
      minRealm: targetMap.minRealm,
    });
    if (blockedMembers.length > 0) {
      const requiredRealm = await fromLinearRealm(targetMap.minRealm);
      const requiredRealmName = await getRealmFullNameByPosition(requiredRealm.major, requiredRealm.minor);
      const error = buildPartyMapTravelBlockedMessage({
        targetMapName: targetMap.name,
        requiredRealmName,
        blockedMembers,
      }) || `队伍需全员达到 ${requiredRealmName} 及以上，才能进入 ${targetMap.name}`;
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "rejected",
        reason: error,
        result: { currentMapId, targetMapId: targetMap.id },
      });
      return NextResponse.json({
        success: false,
        error,
      }, { status: 400 });
    }
    let spawnX = Math.floor(targetMap.width / 2);
    let spawnY = Math.floor(targetMap.height / 2);

    if (travelMode === "portal") {
      if (!currentPortal) {
        await finishMapActionIdempotency({
          idempotencyKey,
          status: "rejected",
          reason: "传送点模式下需要先站在传送点上",
          result: { currentMapId, targetMapId: targetMap.id },
        });
        return NextResponse.json({ success: false, error: "传送点模式下需要先站在传送点上" }, { status: 400 });
      }
      if (!resolvedPortalTarget) {
        const portalName = currentPortal.portalName || "当前传送阵";
        const error = `${portalName}当前不能前往该地点`;
        await finishMapActionIdempotency({
          idempotencyKey,
          status: "rejected",
          reason: error,
          result: { currentMapId, targetMapId: targetMap.id },
        });
        return NextResponse.json({
          success: false,
          error,
        }, { status: 400 });
      }

      if (requiredTargetMapId && requiredTargetMapId !== resolvedTargetMapId) {
        const portalName = currentPortal.portalName || "当前传送阵";
        const targetName = resolvedPortalTarget.mapName || currentPortal.portalTargetName || "指定地图";
        const error = `${portalName}当前只能前往 ${targetName}`;
        await finishMapActionIdempotency({
          idempotencyKey,
          status: "rejected",
          reason: error,
          result: { currentMapId, targetMapId: resolvedTargetMapId },
        });
        return NextResponse.json({
          success: false,
          error,
        }, { status: 400 });
      }

      if (isSectStartPortal) {
        spawnX = gameStartConfig!.positionX;
        spawnY = gameStartConfig!.positionY;
      } else {
        const targetPortal = pickPortalSpawn(targetMap.tilesData, resolvedPortalTarget.portalId);
        if (!targetPortal) {
          await finishMapActionIdempotency({
            idempotencyKey,
            status: "rejected",
            reason: "目标地图未配置可用传送点",
            result: { currentMapId, targetMapId: targetMap.id },
          });
          return NextResponse.json({ success: false, error: "目标地图未配置可用传送点" }, { status: 400 });
        }

        spawnX = targetPortal.x;
        spawnY = targetPortal.y;
      }
    }

    await db.update(players)
      .set({
        currentMapId: targetMap.id,
        positionX: spawnX,
        positionY: spawnY,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(players.id, player.id))
      .run();
    ensureMapSceneTick(currentMapId);
    ensureMapSceneTick(targetMap.id);
    advanceMapSceneTick(currentMapId);
    advanceMapSceneTick(targetMap.id);
    resetMapClientSequence(player.id, targetMap.id);
    resetRepeatKillGuard(player.id);
    await warmMapSceneSharedStateForMapId({
      mapId: targetMap.id,
      reason: "player_transition",
    }).catch((error) => {
      console.error("Travel target map prewarm error:", error);
    });

    const playerCosmetic = player.avatarId || player.avatarFrameId
      ? await getPlayerCosmeticProfileById(player.id)
      : { avatarImageUrl: null, avatarFrameImageUrl: null };

    publishMapPresencePlayerPosition({
      id: player.id,
      name: player.name || "",
      gender: player.gender,
      avatarImageUrl: playerCosmetic.avatarImageUrl,
      avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
      realm: player.realm,
      realmMajor: player.realmMajor,
      realmMinor: player.realmMinor,
      realmName: player.realmName || "凡人",
      mapId: targetMap.id,
      prevMapId: currentMapId,
      positionX: spawnX,
      positionY: spawnY,
    });

    const responseData = {
      mapId: targetMap.id,
      mapName: targetMap.name,
      positionX: spawnX,
      positionY: spawnY,
    };
    await finishMapActionIdempotency({
      idempotencyKey,
      status: "accepted",
      result: responseData,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...responseData,
        protocol: normalizedProtocolInput.protocolMeta,
      },
    });
  } catch (error) {
    console.error("Travel error:", error);
    if (idempotencyKey) {
      console.error("Map travel left pending for manual reconciliation:", {
        idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return NextResponse.json({ success: false, error: "地图切换失败" }, { status: 500 });
  }
}
