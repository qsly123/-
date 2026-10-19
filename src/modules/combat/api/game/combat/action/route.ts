import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import {
  executeBattleCommandRouteAction,
  type BattleActionRouteData,
  type CombatActionType,
} from "@/modules/combat/services/battle-command-executor";
import {
  acceptPartyCombatClientSequence,
  performPartyCombatAction,
  performPartyCombatFlee,
  buildPartyCombatViewState,
  getLastAcceptedPartyCombatClientSequence,
  getPartyCombatRuntime,
  isPartyCombatParticipant,
  releasePartyCombatEncounterLock,
  tryAcquirePartyCombatEncounterLock,
} from "@/modules/combat/services/party-combat-service";
import { guardPlayerAction } from "@/modules/combat/services/action-guard";
import { isExpectedRequestAbortError } from "@/modules/shared/services/request-abort";
import { closePartyEncounter } from "@/modules/social/infrastructure/party-service";
import {
  getPendingCombatSession,
  releasePendingCombatSessionLock,
  tryAcquirePendingCombatSessionLock,
} from "@/modules/combat/services/pending-combat-session";
import {
  acceptPvpClientSequence,
  getLastAcceptedPvpClientSequence,
  getPvpCombatRuntime,
} from "@/modules/combat/services/pvp-runtime-service";
import { consumeOneCombatItem, prepareCombatItemUsage } from "@/modules/combat/services/combat-item-usage";
import { buildSoloCombatRouteData, performSoloCombatActionTransaction } from "@/modules/combat/services/solo-combat-command-transaction";
import {
  buildPvpCombatRouteData,
  performPvpCombatActionTransaction,
} from "@/modules/combat/services/pvp-combat-command-transaction";
import { normalizeLegacyCombatActionRequest } from "@immortality/shared-protocol";

function buildPartyRouteData(params: {
  runtimeId: string;
  playerId: string;
  state: Parameters<typeof buildPartyCombatViewState>[0];
  sceneSnapshot: BattleSceneSnapshot | null;
  turnState: NonNullable<Awaited<ReturnType<typeof getPartyCombatRuntime>>>["turnState"];
}): BattleActionRouteData {
  const state = buildPartyCombatViewState(params.state, params.playerId);
  const battleView = buildCombatBattleViewState({
    runtimeId: params.runtimeId,
    mode: "party",
    state,
    sceneSnapshot: params.sceneSnapshot,
    turnState: params.turnState,
    viewerPlayerId: params.playerId,
  });
  const battleRuntime = buildBattleRuntimeFromBattleView({
    battleView,
    sceneSnapshot: params.sceneSnapshot,
    turnState: params.turnState,
  });

  return {
    state,
    battleView,
    battleRuntime,
    sceneSnapshot: params.sceneSnapshot,
    turnState: params.turnState,
  };
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const rawBody = await request.json() as {
      combatId?: unknown;
      partyCombatId?: unknown;
      pvpCombatId?: unknown;
      action?: unknown;
      skillId?: unknown;
      itemId?: unknown;
      actionId?: unknown;
      clientSentAt?: unknown;
      clientSequence?: unknown;
      clientSceneTick?: unknown;
    };
    const normalizedProtocolInput = normalizeLegacyCombatActionRequest(rawBody);
    if (!normalizedProtocolInput.ok) {
      return NextResponse.json({
        success: false,
        error: normalizedProtocolInput.error,
        data: {
          realtimeAck: normalizedProtocolInput.ack,
        },
      }, { status: normalizedProtocolInput.status });
    }
    const body = normalizedProtocolInput.legacyBody as typeof rawBody;
    const combatId = typeof body.combatId === "string" ? body.combatId.trim() : "";
    const partyCombatId = typeof body.partyCombatId === "string" ? body.partyCombatId.trim() : "";
    const pvpCombatId = typeof body.pvpCombatId === "string" ? body.pvpCombatId.trim() : "";
    const action = body.action === "skill" || body.action === "item" || body.action === "flee" || body.action === "surrender"
      ? (body.action as CombatActionType)
      : null;
    const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    const clientSentAt = typeof body.clientSentAt === "number" && Number.isFinite(body.clientSentAt)
      ? body.clientSentAt
      : undefined;
    const clientSequence = typeof body.clientSequence === "number" && Number.isInteger(body.clientSequence) && body.clientSequence > 0
      ? body.clientSequence
      : undefined;
    const clientSceneTick = typeof body.clientSceneTick === "number" && Number.isInteger(body.clientSceneTick) && body.clientSceneTick >= 0
      ? body.clientSceneTick
      : undefined;

    if (!combatId && !partyCombatId && !pvpCombatId) {
      return NextResponse.json({ success: false, error: "缺少战斗 ID" }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ success: false, error: "战斗动作非法" }, { status: 400 });
    }
    if (typeof clientSequence !== "number") {
      return NextResponse.json({ success: false, error: "缺少客户端动作序列，请刷新页面后重试" }, { status: 400 });
    }
    if (typeof clientSceneTick !== "number") {
      return NextResponse.json({ success: false, error: "缺少场景同步帧序号，请等待同步后重试" }, { status: 400 });
    }

    const guarded = guardPlayerAction({
      playerId: player.id,
      scope: "combat",
      encounterId: partyCombatId || pvpCombatId || combatId,
      actionId: actionId || undefined,
      clientSentAt,
    });
    if (!guarded.allowed) {
      return NextResponse.json({
        success: false,
        error: guarded.error,
        errorCode: guarded.errorCode,
      }, { status: guarded.status });
    }

    if (partyCombatId) {
      if (!tryAcquirePartyCombatEncounterLock(partyCombatId)) {
        return NextResponse.json({ success: false, error: "组队战斗操作处理中，请稍后再试" }, { status: 409 });
      }

      try {
        const runtime = await getPartyCombatRuntime(partyCombatId, {
          includeResolved: true,
        });
        if (!runtime) {
          await closePartyEncounter({
            encounterId: partyCombatId,
            status: "abandoned",
          }).catch(() => null);
          return NextResponse.json({
            success: false,
            error: "组队战斗不存在",
            errorCode: "COMBAT_SESSION_MISSING",
          }, { status: 404 });
        }
        if (!isPartyCombatParticipant({
          state: runtime.state,
          playerId: player.id,
        })) {
          return NextResponse.json({
            success: false,
            error: "你不在该组队战斗中",
            errorCode: "COMBAT_FORBIDDEN",
          }, { status: 403 });
        }

        return executeBattleCommandRouteAction({
          runtimeId: partyCombatId,
          mode: "party",
          actorId: player.id,
          action,
          skillId,
          itemId,
          actionId: actionId || null,
          clientSentAt,
          clientSequence,
          clientSceneTick,
          serverSceneTick: runtime.sceneSnapshot?.tick || 0,
          lastAcceptedClientSequence: getLastAcceptedPartyCombatClientSequence(partyCombatId, player.id),
          buildCurrentData: () => buildPartyRouteData({
            runtimeId: partyCombatId,
            playerId: player.id,
            state: runtime.state,
            sceneSnapshot: runtime.sceneSnapshot,
            turnState: runtime.turnState,
          }),
          commitAcceptedClientSequence: (accepted) => {
            acceptPartyCombatClientSequence(partyCombatId, player.id, accepted);
          },
          isFinished: () => runtime.state.status !== "ongoing",
          isActorTurn: () => runtime.turnState.currentTurnPlayerId === player.id,
          perform: async () => {
            if (action === "flee") {
              const result = await performPartyCombatFlee({
                encounterId: partyCombatId,
                actorPlayerId: player.id,
              });
              if (!result.success) {
                return {
                  success: false,
                  error: result.error,
                  acknowledgeSequence: true,
                };
              }
              return {
                success: true,
                data: buildPartyRouteData({
                  runtimeId: partyCombatId,
                  playerId: player.id,
                  state: result.state,
                  sceneSnapshot: result.sceneSnapshot,
                  turnState: result.turnState,
                }),
              };
            }

            if (action === "item") {
              if (!itemId) {
                return { success: false, error: "缺少丹药 ID", acknowledgeSequence: true };
              }
              const preparedItem = await prepareCombatItemUsage({
                playerId: player.id,
                itemId,
              });
              if (!preparedItem.success) {
                return { success: false, error: preparedItem.error, acknowledgeSequence: true };
              }
              const result = await performPartyCombatAction({
                encounterId: partyCombatId,
                actorPlayerId: player.id,
                actionType: "item",
                itemName: preparedItem.itemName,
                itemEffects: preparedItem.effects,
              });
              if (!result.success) {
                return { success: false, error: result.error, acknowledgeSequence: true };
              }
              await consumeOneCombatItem(player.id, itemId, preparedItem.quantity);
              return {
                success: true,
                data: buildPartyRouteData({
                  runtimeId: partyCombatId,
                  playerId: player.id,
                  state: result.state,
                  sceneSnapshot: result.sceneSnapshot,
                  turnState: result.turnState,
                }),
                payload: {
                  itemId,
                },
              };
            }

            const result = await performPartyCombatAction({
              encounterId: partyCombatId,
              actorPlayerId: player.id,
              actionType: "skill",
              skillId,
            });
            if (!result.success) {
              return { success: false, error: result.error, acknowledgeSequence: true };
            }
            return {
              success: true,
              data: buildPartyRouteData({
                runtimeId: partyCombatId,
                playerId: player.id,
                state: result.state,
                sceneSnapshot: result.sceneSnapshot,
                turnState: result.turnState,
              }),
            };
          },
        });
      } finally {
        releasePartyCombatEncounterLock(partyCombatId);
      }
    }

    if (pvpCombatId) {
      const runtime = getPvpCombatRuntime(pvpCombatId);
      if (!runtime) {
        return NextResponse.json({
          success: false,
          error: "论道会话不存在",
          errorCode: "COMBAT_SESSION_MISSING",
        }, { status: 404 });
      }
      const currentData = buildPvpCombatRouteData({
        runtimeId: pvpCombatId,
        playerId: player.id,
      });
      if (!currentData) {
        return NextResponse.json({ success: false, error: "论道状态同步失败" }, { status: 500 });
      }

      const normalizedAction = action === "flee" ? "surrender" : action;
      return executeBattleCommandRouteAction({
        runtimeId: pvpCombatId,
        mode: "pvp",
        actorId: player.id,
        action,
        normalizedAction,
        skillId,
        itemId,
        actionId: actionId || null,
        clientSentAt,
        clientSequence,
        clientSceneTick,
        serverSceneTick: runtime.sceneSnapshotsByPlayerId[player.id]?.tick || 0,
        lastAcceptedClientSequence: getLastAcceptedPvpClientSequence(pvpCombatId, player.id),
        buildCurrentData: () => currentData,
        commitAcceptedClientSequence: (accepted) => {
          acceptPvpClientSequence(pvpCombatId, player.id, accepted);
        },
        isFinished: () => runtime.state.status !== "ongoing",
        finishedError: "论道已结束",
        isActorTurn: () => runtime.turnState.currentTurnPlayerId === player.id,
        perform: () => performPvpCombatActionTransaction({
          combatId: pvpCombatId,
          actorPlayerId: player.id,
          action,
          skillId,
          itemId,
        }),
      });
    }

    if (!tryAcquirePendingCombatSessionLock(player.id, combatId)) {
      return NextResponse.json({ success: false, error: "战斗操作处理中，请稍后再试" }, { status: 409 });
    }

    try {
      const pendingCombat = getPendingCombatSession(player.id, combatId);
      if (!pendingCombat) {
        return NextResponse.json({
          success: false,
          error: "战斗会话不存在或已失效",
          errorCode: "COMBAT_SESSION_MISSING",
        }, { status: 400 });
      }

      return executeBattleCommandRouteAction({
        runtimeId: combatId,
        mode: "solo",
        actorId: player.id,
        action,
        skillId,
        itemId,
        actionId: actionId || null,
        clientSentAt,
        clientSequence,
        clientSceneTick,
        serverSceneTick: pendingCombat.sceneSnapshot.tick || 0,
        lastAcceptedClientSequence: pendingCombat.lastAcceptedClientSequence,
        buildCurrentData: () => buildSoloCombatRouteData({
          runtimeId: combatId,
          playerId: player.id,
          session: pendingCombat,
        }),
        commitAcceptedClientSequence: (accepted) => {
          pendingCombat.lastAcceptedClientSequence = accepted;
        },
        isFinished: () => pendingCombat.state.status !== "ongoing",
        perform: () => performSoloCombatActionTransaction({
          playerId: player.id,
          combatId,
          session: pendingCombat,
          action,
          skillId,
          itemId,
          clientSequence,
        }),
      });
    } finally {
      releasePendingCombatSessionLock(player.id, combatId);
    }
  } catch (error) {
    if (isExpectedRequestAbortError(error)) {
      return new Response(null, { status: 499 });
    }
    console.error("Combat action error:", error);
    return NextResponse.json({ success: false, error: "战斗执行失败" }, { status: 500 });
  }
}
