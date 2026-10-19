import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { buildBattleCommandRouteResponse } from "@/modules/combat/services/battle-command-executor";
import { createBattleCommand } from "@/modules/combat/services/battle-command";
import {
  performPartyCombatTimeoutAdvanceTransaction,
} from "@/modules/combat/services/party-combat-command-transaction";
import { advancePvpCombatTimeout, buildPvpViewerSceneData, getPvpCombatRuntime, isPvpCombatParticipant } from "@/modules/combat/services/pvp-runtime-service";
import { normalizeLegacyCombatAdvanceRequest } from "@immortality/shared-protocol";

export async function POST(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null) as {
    partyCombatId?: unknown;
    pvpCombatId?: unknown;
  } | null;
  const normalizedProtocolInput = normalizeLegacyCombatAdvanceRequest(rawBody);
  if (!normalizedProtocolInput.ok) {
    return NextResponse.json({
      success: false,
      error: normalizedProtocolInput.error,
      data: {
        realtimeAck: normalizedProtocolInput.ack,
      },
    }, { status: normalizedProtocolInput.status });
  }
  const body = normalizedProtocolInput.legacyBody as NonNullable<typeof rawBody>;
  const partyCombatId = typeof body?.partyCombatId === "string" ? body.partyCombatId.trim() : "";
  const pvpCombatId = typeof body?.pvpCombatId === "string" ? body.pvpCombatId.trim() : "";
  if (!partyCombatId && !pvpCombatId) {
    return NextResponse.json({ success: false, error: "缺少战斗推进 ID" }, { status: 400 });
  }

  if (pvpCombatId) {
    const runtime = getPvpCombatRuntime(pvpCombatId);
    if (!runtime) {
      return NextResponse.json({ success: false, error: "论道会话不存在" }, { status: 404 });
    }
    if (!isPvpCombatParticipant(runtime, player.id)) {
      return NextResponse.json({ success: false, error: "你不在这场论道中" }, { status: 403 });
    }

    const currentData = buildPvpViewerSceneData(pvpCombatId, player.id);
    if (!currentData) {
      return NextResponse.json({ success: false, error: "论道状态同步失败" }, { status: 500 });
    }

    const result = await advancePvpCombatTimeout(pvpCombatId);
    const timeoutCommand = createBattleCommand({
      runtimeId: pvpCombatId,
      mode: "pvp",
      type: "ready",
      actorId: player.id,
      payload: {
        timeoutAdvance: true,
      },
    });
    if (!result.success) {
      return buildBattleCommandRouteResponse({
        success: false,
        status: 400,
        error: result.error,
        runtimeId: pvpCombatId,
        mode: "pvp",
        command: timeoutCommand,
        routeData: {
          state: currentData.state,
          battleView: currentData.battleView,
          battleRuntime: currentData.battleRuntime,
          sceneSnapshot: currentData.sceneSnapshot,
          turnState: currentData.turnState,
          settlement: currentData.settlement,
        },
        serverSceneTick: currentData.sceneSnapshot?.tick || 0,
      });
    }

    const nextData = buildPvpViewerSceneData(pvpCombatId, player.id);
    if (!nextData) {
      return NextResponse.json({ success: false, error: "论道状态同步失败" }, { status: 500 });
    }

    return buildBattleCommandRouteResponse({
      success: true,
      runtimeId: pvpCombatId,
      mode: "pvp",
      command: timeoutCommand,
      routeData: {
        state: nextData.state,
        battleView: nextData.battleView,
        battleRuntime: nextData.battleRuntime,
        sceneSnapshot: nextData.sceneSnapshot,
        turnState: nextData.turnState,
        settlement: nextData.settlement,
      },
      serverSceneTick: nextData.sceneSnapshot?.tick || 0,
    });
  }

  const result = await performPartyCombatTimeoutAdvanceTransaction({
    encounterId: partyCombatId,
    actorPlayerId: player.id,
  });
  const timeoutCommand = createBattleCommand({
    runtimeId: partyCombatId,
    mode: "party",
    type: "timeoutAdvance",
    actorId: player.id,
    payload: {
      timeoutAdvance: true,
    },
  });
  if (!result.success) {
    if (!result.data) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status || 400 });
    }
    return buildBattleCommandRouteResponse({
      success: false,
      status: result.status || 400,
      error: result.error,
      runtimeId: partyCombatId,
      mode: "party",
      command: timeoutCommand,
      routeData: result.data,
      serverSceneTick: result.data.sceneSnapshot?.tick || 0,
    });
  }

  return buildBattleCommandRouteResponse({
    success: true,
    runtimeId: partyCombatId,
    mode: "party",
    command: timeoutCommand,
    routeData: result.data,
    serverSceneTick: result.data.sceneSnapshot?.tick || 0,
  });
}
