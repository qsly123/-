import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { guardPlayerAction } from "@/modules/combat/services/action-guard";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import { createBattleCommand } from "@/modules/combat/services/battle-command";
import {
  buildBattleCommandRouteResponse,
  executeBattleCommandRoute,
  type BattleActionRouteData,
} from "@/modules/combat/services/battle-command-executor";
import { isExpectedRequestAbortError } from "@/modules/shared/services/request-abort";
import { getPartyCombatRuntime } from "@/modules/combat/services/party-combat-service";
import { isPartyCombatParticipant } from "@/modules/combat/services/party-combat-service";
import { buildPartyCombatViewState } from "@/modules/combat/services/party-combat-service";
import { closePartyEncounter } from "@/modules/social/infrastructure/party-service";
import {
  getPendingCombatSession,
  releasePendingCombatSessionLock,
  tryAcquirePendingCombatSessionLock,
} from "@/modules/combat/services/pending-combat-session";
import {
  buildSoloCombatRouteData,
  performSoloCombatMovementTransaction,
} from "@/modules/combat/services/solo-combat-command-transaction";
import { buildPvpViewerSceneData, getPvpCombatRuntime, isPvpCombatParticipant, syncPvpCombatRuntime } from "@/modules/combat/services/pvp-runtime-service";
import { normalizeLegacyCombatMovementRequest } from "@immortality/shared-protocol";

const MAX_CLIENT_SCENE_TICK_LAG = 5;

function buildPvpRouteData(params: {
  runtimeId: string;
  playerId: string;
}): BattleActionRouteData | null {
  const viewerData = buildPvpViewerSceneData(params.runtimeId, params.playerId);
  if (!viewerData) {
    return null;
  }

  return {
    state: viewerData.state,
    battleView: viewerData.battleView,
    battleRuntime: viewerData.battleRuntime,
    sceneSnapshot: viewerData.sceneSnapshot,
    turnState: viewerData.turnState,
    settlement: viewerData.settlement,
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
      actionId?: unknown;
      clientSentAt?: unknown;
      clientSequence?: unknown;
      clientSceneTick?: unknown;
      targetXPercent?: unknown;
      targetYPercent?: unknown;
    };
    const normalizedProtocolInput = normalizeLegacyCombatMovementRequest(rawBody);
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
    const targetXPercent = typeof body.targetXPercent === "number" && Number.isFinite(body.targetXPercent)
      ? body.targetXPercent
      : undefined;
    const targetYPercent = typeof body.targetYPercent === "number" && Number.isFinite(body.targetYPercent)
      ? body.targetYPercent
      : undefined;

    if (!combatId && !partyCombatId && !pvpCombatId) {
      return NextResponse.json({ success: false, error: "缺少战斗 ID" }, { status: 400 });
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
      const runtime = await getPartyCombatRuntime(partyCombatId);
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
      const state = buildPartyCombatViewState(runtime.state, player.id);
      const battleView = buildCombatBattleViewState({
        runtimeId: partyCombatId,
        mode: "party",
        state,
        sceneSnapshot: runtime.sceneSnapshot,
        turnState: runtime.turnState,
        viewerPlayerId: player.id,
      });
      const battleRuntime = buildBattleRuntimeFromBattleView({
        battleView,
        sceneSnapshot: runtime.sceneSnapshot,
        turnState: runtime.turnState,
      });
      const command = createBattleCommand({
        runtimeId: partyCombatId,
        mode: "party",
        type: "move",
        actorId: player.id,
        payload: {
          ...(typeof targetXPercent === "number" ? { targetXPercent } : {}),
          ...(typeof targetYPercent === "number" ? { targetYPercent } : {}),
        },
        actionId: actionId || null,
        clientSentAt,
        clientSequence,
        clientSceneTick,
      });
      return buildBattleCommandRouteResponse({
        success: false,
        status: 400,
        error: "组队战暂未开放站位移动，请等待后续同步升级",
        runtimeId: partyCombatId,
        mode: "party",
        command,
        routeData: {
          state,
          battleView,
          battleRuntime,
          sceneSnapshot: runtime.sceneSnapshot,
          turnState: runtime.turnState,
        },
        serverSceneTick: runtime.sceneSnapshot?.tick || 0,
      });
    }

    if (pvpCombatId) {
      await syncPvpCombatRuntime(pvpCombatId);
      const runtime = getPvpCombatRuntime(pvpCombatId);
      if (!runtime) {
        return NextResponse.json({
          success: false,
          error: "论道会话不存在",
          errorCode: "COMBAT_SESSION_MISSING",
        }, { status: 404 });
      }
      if (!isPvpCombatParticipant(runtime, player.id)) {
        return NextResponse.json({
          success: false,
          error: "你不在这场论道中",
          errorCode: "COMBAT_FORBIDDEN",
        }, { status: 403 });
      }
      const routeData = buildPvpRouteData({
        runtimeId: pvpCombatId,
        playerId: player.id,
      });
      if (!routeData) {
        return NextResponse.json({ success: false, error: "论道状态同步失败" }, { status: 500 });
      }
      return executeBattleCommandRoute({
        runtimeId: pvpCombatId,
        mode: "pvp",
        actorId: player.id,
        commandType: "move",
        commandPayload: {
          ...(typeof targetXPercent === "number" ? { targetXPercent } : {}),
          ...(typeof targetYPercent === "number" ? { targetYPercent } : {}),
        },
        actionId: actionId || null,
        clientSentAt,
        clientSequence: typeof clientSequence === "number" ? clientSequence : 0,
        clientSceneTick: typeof clientSceneTick === "number" ? clientSceneTick : 0,
        serverSceneTick: routeData.sceneSnapshot?.tick || 0,
        lastAcceptedClientSequence: runtime.lastAcceptedClientSequenceByPlayerId[player.id] || 0,
        buildCurrentData: () => buildPvpRouteData({
          runtimeId: pvpCombatId,
          playerId: player.id,
        }) || routeData,
        commitAcceptedClientSequence: () => undefined,
        isFinished: () => runtime.state.status !== "ongoing",
        finishedError: "论道已结束",
        precheck: () => {
          if (typeof clientSequence !== "number") {
            return { status: 400, error: "缺少客户端动作序列，请刷新页面后重试" };
          }
          if (typeof clientSceneTick !== "number") {
            return { status: 400, error: "缺少场景同步帧序号，请等待同步后重试" };
          }
          if (typeof targetXPercent !== "number" || typeof targetYPercent !== "number") {
            return { status: 400, error: "缺少目标位置" };
          }
          return null;
        },
        perform: async () => ({
          success: false,
          status: 400,
          error: "论道位移同步尚未开放，当前先由统一场景快照负责站位表现",
          acknowledgeSequence: false,
          data: buildPvpRouteData({
            runtimeId: pvpCombatId,
            playerId: player.id,
          }) || routeData,
        }),
      });
    }

    if (!combatId) {
      return NextResponse.json({ success: false, error: "缺少战斗 ID" }, { status: 400 });
    }
    if (typeof clientSequence !== "number") {
      return NextResponse.json({ success: false, error: "缺少客户端动作序列，请刷新页面后重试" }, { status: 400 });
    }
    if (typeof clientSceneTick !== "number") {
      return NextResponse.json({ success: false, error: "缺少场景同步帧序号，请等待同步后重试" }, { status: 400 });
    }
    if (typeof targetXPercent !== "number") {
      return NextResponse.json({ success: false, error: "缺少目标位置" }, { status: 400 });
    }
    if (typeof targetYPercent !== "number") {
      return NextResponse.json({ success: false, error: "缺少目标位置" }, { status: 400 });
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

      const serverTick = pendingCombat.sceneSnapshot.tick || 0;
      return executeBattleCommandRoute({
        runtimeId: combatId,
        mode: "solo",
        actorId: player.id,
        commandType: "move",
        commandPayload: {
          targetXPercent,
          targetYPercent,
        },
        actionId: actionId || null,
        clientSentAt,
        clientSequence,
        clientSceneTick,
        serverSceneTick: serverTick,
        lastAcceptedClientSequence: pendingCombat.lastAcceptedClientSequence,
        maxClientSceneTickLag: MAX_CLIENT_SCENE_TICK_LAG,
        buildCurrentData: () => buildSoloCombatRouteData({
          runtimeId: combatId,
          playerId: player.id,
          session: pendingCombat,
        }),
        commitAcceptedClientSequence: (accepted) => {
          pendingCombat.lastAcceptedClientSequence = accepted;
        },
        isFinished: () => pendingCombat.state.status !== "ongoing",
        finishedError: "战斗已结束",
        finishedErrorCode: "COMBAT_SESSION_FINISHED",
        precheck: () => {
          if (typeof targetXPercent !== "number" || typeof targetYPercent !== "number") {
            return { status: 400, error: "缺少目标位置" };
          }
          return null;
        },
        perform: async () => {
          return performSoloCombatMovementTransaction({
            playerId: player.id,
            combatId,
            targetXPercent,
            targetYPercent,
            clientSequence,
            session: pendingCombat,
          });
        },
      });
    } finally {
      releasePendingCombatSessionLock(player.id, combatId);
    }
  } catch (error) {
    if (isExpectedRequestAbortError(error)) {
      return new Response(null, { status: 499 });
    }
    console.error("Combat move error:", error);
    return NextResponse.json({ success: false, error: "移动失败" }, { status: 500 });
  }
}
