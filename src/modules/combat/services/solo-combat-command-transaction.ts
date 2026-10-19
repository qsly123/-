import type { BattleActionRouteData, BattleCommandExecuteResult, CombatActionType } from "@/modules/combat/services/battle-command-executor";
import type { PendingCombatSession } from "@/modules/combat/services/pending-combat-session";
import {
  movePendingCombatSceneUnit,
  updatePendingCombatSessionState,
} from "@/modules/combat/services/pending-combat-session";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import { getBattleRuleset } from "@/modules/combat/services/battle-ruleset";
import { executeTurn, pickCombatEnemySkillId } from "@/modules/combat/services/combat";
import { getCombatScenePositions } from "@/modules/combat/services/combat-spatial";
import { getCombatDamageCalculator } from "@/modules/combat/services/damage-formula";
import { consumeOneCombatItem, prepareCombatItemUsage } from "@/modules/combat/services/combat-item-usage";

export function buildSoloCombatRouteData(params: {
  runtimeId: string;
  playerId: string;
  session: Pick<PendingCombatSession, "state" | "sceneSnapshot">;
}): BattleActionRouteData {
  const battleView = buildCombatBattleViewState({
    runtimeId: params.runtimeId,
    mode: "solo",
    state: params.session.state,
    sceneSnapshot: params.session.sceneSnapshot,
    viewerPlayerId: params.playerId,
  });
  const sceneSnapshot = params.session.sceneSnapshot;
  const battleRuntime = {
    runtimeId: params.runtimeId,
    mode: "solo" as const,
    state: battleView.runtimeState,
    sceneVersion: sceneSnapshot?.sceneVersion ?? sceneSnapshot?.sequence ?? 0,
    tick: sceneSnapshot?.tick ?? 0,
    ruleset: getBattleRuleset("solo"),
    participants: battleView.participants,
    battleView,
    turnState: null,
    sceneSnapshot,
    settlement: null,
    payload: battleView.modePayload || null,
  };

  return {
    state: params.session.state,
    battleView,
    battleRuntime,
    sceneSnapshot: params.session.sceneSnapshot,
  };
}

export async function performSoloCombatActionTransaction(params: {
  playerId: string;
  combatId: string;
  session: PendingCombatSession;
  action: CombatActionType;
  skillId?: string;
  itemId?: string;
  clientSequence: number;
}): Promise<BattleCommandExecuteResult> {
  const { playerId, combatId, session, action, skillId, itemId, clientSequence } = params;
  const damageCalculator = await getCombatDamageCalculator();
  const scenePositions = getCombatScenePositions(session.state, session.scenePositionOverrides);
  const enemyPlannedSkillId = pickCombatEnemySkillId(
    session.state.enemy,
    session.skillsData,
    (session.sceneSnapshot.tick || 0) + session.state.turn + 1,
  );
  const forcePlayerOpeningTurn = session.state.turn === 0;

  if (action === "surrender") {
    const previousLogLength = session.state.log.length;
    const newState = structuredClone(session.state);
    newState.turn += 1;
    newState.status = "enemy_win";
    newState.log.push({
      turn: newState.turn,
      actorName: newState.player.name,
      action: "认输",
      entryType: "flee",
      actorId: newState.player.id,
      targetId: newState.enemy.id,
      actorCurrentHp: newState.player.hp,
      actorCurrentMp: newState.player.mp,
      targetCurrentHp: newState.enemy.hp,
      targetCurrentMp: newState.enemy.mp,
      message: `${newState.player.name} 主动认输，结束了本场战斗。`,
    });
    const updatedSession = updatePendingCombatSessionState(playerId, combatId, newState, {
      previousLogLength,
      acceptedClientSequence: clientSequence,
    });
    return {
      success: true,
      data: buildSoloCombatRouteData({
        runtimeId: combatId,
        playerId,
        session: updatedSession || {
          ...session,
          state: newState,
        },
      }),
      payload: {
        settlementReason: "surrender",
      },
    };
  }

  if (action === "flee") {
    const previousLogLength = session.state.log.length;
    const newState = executeTurn(
      session.state,
      "flee",
      undefined,
      undefined,
      session.skillsData,
      undefined,
      damageCalculator,
      scenePositions,
      enemyPlannedSkillId,
      { forcePlayerFirst: forcePlayerOpeningTurn },
    );
    const updatedSession = updatePendingCombatSessionState(playerId, combatId, newState, {
      previousLogLength,
      acceptedClientSequence: clientSequence,
    });
    return {
      success: true,
      data: buildSoloCombatRouteData({
        runtimeId: combatId,
        playerId,
        session: updatedSession || {
          ...session,
          state: newState,
        },
      }),
    };
  }

  if (action === "skill") {
    if (!skillId) {
      return { success: false, error: "缺少神通 ID", acknowledgeSequence: true };
    }
    if (!session.state.player.skills.includes(skillId)) {
      return { success: false, error: "该神通当前不可用", acknowledgeSequence: true };
    }

    const cooldownLeft = Number(session.state.player.skillCooldowns?.[skillId] || 0);
    if (cooldownLeft > 0) {
      return {
        success: false,
        error: `神通冷却中，剩余 ${cooldownLeft} 回合`,
        acknowledgeSequence: true,
      };
    }

    const playerSkillData = session.skillsData[skillId];
    if (!playerSkillData) {
      return { success: false, error: "神通数据不存在", acknowledgeSequence: true };
    }

    const previousLogLength = session.state.log.length;
    const newState = executeTurn(
      session.state,
      "skill",
      skillId,
      playerSkillData,
      session.skillsData,
      undefined,
      damageCalculator,
      scenePositions,
      enemyPlannedSkillId,
      { forcePlayerFirst: forcePlayerOpeningTurn },
    );
    const updatedSession = updatePendingCombatSessionState(playerId, combatId, newState, {
      previousLogLength,
      acceptedClientSequence: clientSequence,
    });
    return {
      success: true,
      data: buildSoloCombatRouteData({
        runtimeId: combatId,
        playerId,
        session: updatedSession || {
          ...session,
          state: newState,
        },
      }),
    };
  }

  if (!itemId) {
    return { success: false, error: "缺少丹药 ID", acknowledgeSequence: true };
  }

  const preparedItem = await prepareCombatItemUsage({
    playerId,
    itemId,
  });
  if (!preparedItem.success) {
    return { success: false, error: preparedItem.error, acknowledgeSequence: true };
  }

  const previousLogLength = session.state.log.length;
  const newState = executeTurn(
    session.state,
    "item",
    undefined,
    undefined,
    session.skillsData,
    {
      name: preparedItem.itemName,
      effects: preparedItem.effects,
    },
    damageCalculator,
    scenePositions,
    enemyPlannedSkillId,
    { forcePlayerFirst: forcePlayerOpeningTurn },
  );
  const updatedSession = updatePendingCombatSessionState(playerId, combatId, newState, {
    previousLogLength,
    acceptedClientSequence: clientSequence,
  });
  await consumeOneCombatItem(playerId, itemId, preparedItem.quantity);
  return {
    success: true,
    data: buildSoloCombatRouteData({
      runtimeId: combatId,
      playerId,
      session: updatedSession || {
        ...session,
        state: newState,
      },
    }),
    payload: {
      itemId,
    },
  };
}

export async function performSoloCombatMovementTransaction(params: {
  playerId: string;
  combatId: string;
  session: PendingCombatSession;
  targetXPercent: number;
  targetYPercent: number;
  clientSequence: number;
}): Promise<BattleCommandExecuteResult> {
  const { playerId, combatId, session, targetXPercent, targetYPercent, clientSequence } = params;

  const updatedSession = movePendingCombatSceneUnit({
    playerId,
    combatId,
    unitId: session.state.player.id,
    targetXPercent,
    targetYPercent,
    acceptedClientSequence: clientSequence,
    preferredEnemySkillId: pickCombatEnemySkillId(
      session.state.enemy,
      session.skillsData,
      (session.sceneSnapshot.tick || 0) + session.state.turn + 1,
    ),
  });

  if (!updatedSession) {
    return {
      success: false,
      status: 400,
      error: "移动失败，当前位置不可达",
      acknowledgeSequence: true,
      data: buildSoloCombatRouteData({
        runtimeId: combatId,
        playerId,
        session,
      }),
    };
  }

  return {
    success: true,
    data: buildSoloCombatRouteData({
      runtimeId: combatId,
      playerId,
      session: updatedSession,
    }),
  };
}
