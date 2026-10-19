import type { BattleActionRouteData, BattleCommandExecuteResult, CombatActionType } from "@/modules/combat/services/battle-command-executor";
import { getCombatDamageCalculator } from "@/modules/combat/services/damage-formula";
import { consumeOneCombatItem, prepareCombatItemUsage } from "@/modules/combat/services/combat-item-usage";
import {
  buildPvpViewerSceneData,
  getPvpCombatRuntime,
  isPvpCombatParticipant,
  performPvpCombatAction,
  performPvpCombatMovement,
  syncPvpCombatRuntime,
} from "@/modules/combat/services/pvp-runtime-service";

export function buildPvpCombatRouteData(params: {
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

export async function performPvpCombatActionTransaction(params: {
  combatId: string;
  actorPlayerId: string;
  action: CombatActionType;
  skillId?: string;
  itemId?: string;
}): Promise<BattleCommandExecuteResult> {
  const normalizedAction = params.action === "flee" ? "surrender" : params.action;
  let itemPayload: { itemName: string; itemEffects: Array<{ type: string; value: number }>; quantity: number } | null = null;

  await syncPvpCombatRuntime(params.combatId);
  const runtime = getPvpCombatRuntime(params.combatId);
  if (!runtime) {
    return {
      success: false,
      status: 404,
      error: "论道会话不存在",
      errorCode: "COMBAT_SESSION_MISSING",
    };
  }
  if (!isPvpCombatParticipant(runtime, params.actorPlayerId)) {
    return {
      success: false,
      status: 403,
      error: "你不在这场论道中",
      errorCode: "COMBAT_FORBIDDEN",
    };
  }

  const currentData = buildPvpCombatRouteData({
    runtimeId: params.combatId,
    playerId: params.actorPlayerId,
  });
  if (!currentData) {
    return {
      success: false,
      status: 500,
      error: "论道状态同步失败",
    };
  }

  if (normalizedAction === "item") {
    const itemId = params.itemId?.trim() || "";
    if (!itemId) {
      return {
        success: false,
        error: "缺少丹药 ID",
        acknowledgeSequence: true,
        data: currentData,
      };
    }
    const preparedItem = await prepareCombatItemUsage({
      playerId: params.actorPlayerId,
      itemId,
    });
    if (!preparedItem.success) {
      return {
        success: false,
        error: preparedItem.error,
        acknowledgeSequence: true,
        data: currentData,
      };
    }
    itemPayload = {
      itemName: preparedItem.itemName,
      itemEffects: preparedItem.effects,
      quantity: preparedItem.quantity,
    };
  }

  const damageCalculator = normalizedAction === "skill"
    ? await getCombatDamageCalculator()
    : undefined;
  const result = await performPvpCombatAction({
    combatId: params.combatId,
    actorPlayerId: params.actorPlayerId,
    actionType: normalizedAction,
    skillId: params.skillId?.trim() || undefined,
    itemName: itemPayload?.itemName,
    itemEffects: itemPayload?.itemEffects,
    damageCalculator,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "移动失败",
      acknowledgeSequence: true,
      data: currentData,
    };
  }
  if (normalizedAction === "item" && itemPayload && params.itemId) {
    await consumeOneCombatItem(params.actorPlayerId, params.itemId, itemPayload.quantity);
  }

  const nextData = buildPvpCombatRouteData({
    runtimeId: params.combatId,
    playerId: params.actorPlayerId,
  });
  if (!nextData) {
    return {
      success: false,
      error: "论道状态同步失败",
      status: 500,
      acknowledgeSequence: true,
      data: currentData,
    };
  }

  return {
    success: true,
    data: nextData,
    payload: normalizedAction === "item" && params.itemId ? { itemId: params.itemId } : null,
  };
}

export async function performPvpCombatMovementTransaction(params: {
  combatId: string;
  actorPlayerId: string;
  targetXPercent: number;
  targetYPercent: number;
}): Promise<BattleCommandExecuteResult> {
  await syncPvpCombatRuntime(params.combatId);
  const runtime = getPvpCombatRuntime(params.combatId);
  if (!runtime) {
    return {
      success: false,
      status: 404,
      error: "论道会话不存在",
      errorCode: "COMBAT_SESSION_MISSING",
    };
  }
  if (!isPvpCombatParticipant(runtime, params.actorPlayerId)) {
    return {
      success: false,
      status: 403,
      error: "你不在这场论道中",
      errorCode: "COMBAT_FORBIDDEN",
    };
  }

  const currentData = buildPvpCombatRouteData({
    runtimeId: params.combatId,
    playerId: params.actorPlayerId,
  });
  if (!currentData) {
    return {
      success: false,
      status: 500,
      error: "论道状态同步失败",
    };
  }

  const result = await performPvpCombatMovement({
    combatId: params.combatId,
    actorPlayerId: params.actorPlayerId,
    targetXPercent: params.targetXPercent,
    targetYPercent: params.targetYPercent,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      acknowledgeSequence: true,
      data: currentData,
    };
  }

  const nextData = buildPvpCombatRouteData({
    runtimeId: params.combatId,
    playerId: params.actorPlayerId,
  });
  if (!nextData) {
    return {
      success: false,
      error: "论道状态同步失败",
      status: 500,
      acknowledgeSequence: true,
      data: currentData,
    };
  }

  return {
    success: true,
    data: nextData,
    payload: {
      actorPosition: result.actorPosition,
    },
  };
}
