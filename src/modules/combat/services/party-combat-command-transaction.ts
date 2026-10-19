import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import type {
  BattleActionRouteData,
  CombatActionType,
} from "@/modules/combat/services/battle-command-executor";
import {
  acceptPartyCombatClientSequence,
  advancePartyCombatTimeout,
  buildPartyCombatViewState,
  getLastAcceptedPartyCombatClientSequence,
  getPartyCombatRuntime,
  isPartyCombatParticipant,
  performPartyCombatAction,
  performPartyCombatFlee,
  releasePartyCombatEncounterLock,
  tryAcquirePartyCombatEncounterLock,
} from "@/modules/combat/services/party-combat-service";
import { closePartyEncounter } from "@/modules/social/infrastructure/party-service";
import type { CombatState, CombatTurnState } from "@/types/game";
import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";
import { consumeOneCombatItem, prepareCombatItemUsage } from "@/modules/combat/services/combat-item-usage";

export function buildPartyCombatRouteData(params: {
  encounterId: string;
  viewerPlayerId: string;
  state: CombatState;
  sceneSnapshot: BattleSceneSnapshot | null;
  turnState: CombatTurnState | null;
}): BattleActionRouteData {
  const state = buildPartyCombatViewState(params.state, params.viewerPlayerId);
  const battleView = buildCombatBattleViewState({
    runtimeId: params.encounterId,
    mode: "party",
    state,
    sceneSnapshot: params.sceneSnapshot,
    turnState: params.turnState,
    viewerPlayerId: params.viewerPlayerId,
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

export async function performPartyCombatTimeoutAdvanceTransaction(params: {
  encounterId: string;
  actorPlayerId: string;
}) {
  const { encounterId, actorPlayerId } = params;
  if (!tryAcquirePartyCombatEncounterLock(encounterId)) {
    return {
      success: false as const,
      status: 409,
      error: "组队战斗推进中，请稍后再试",
    };
  }

  try {
    const runtime = await getPartyCombatRuntime(encounterId, {
      includeResolved: true,
    });
    if (!runtime) {
      await closePartyEncounter({
        encounterId,
        status: "abandoned",
      }).catch(() => null);
      return {
        success: false as const,
        status: 404,
        error: "组队战斗不存在",
      };
    }
    if (!isPartyCombatParticipant({
      state: runtime.state,
      playerId: actorPlayerId,
    })) {
      return {
        success: false as const,
        status: 403,
        error: "你不在该组队战斗中",
      };
    }

    const currentData = buildPartyCombatRouteData({
      encounterId,
      viewerPlayerId: actorPlayerId,
      state: runtime.state,
      sceneSnapshot: runtime.sceneSnapshot,
      turnState: runtime.turnState,
    });
    const result = await advancePartyCombatTimeout(encounterId);
    if (!result.success) {
      return {
        success: false as const,
        status: 400,
        error: result.error,
        data: currentData,
      };
    }

    return {
      success: true as const,
      data: buildPartyCombatRouteData({
        encounterId,
        viewerPlayerId: actorPlayerId,
        state: result.state,
        sceneSnapshot: result.sceneSnapshot,
        turnState: result.turnState,
      }),
    };
  } finally {
    releasePartyCombatEncounterLock(encounterId);
  }
}

export async function performPartyCombatActionTransaction(params: {
  encounterId: string;
  actorPlayerId: string;
  action: CombatActionType;
  skillId?: string;
  itemId?: string;
  clientSequence: number;
  clientSceneTick: number;
  maxClientSceneTickLag?: number;
}) {
  const {
    encounterId,
    actorPlayerId,
    action,
    skillId,
    itemId,
    clientSequence,
    clientSceneTick,
  } = params;
  const maxClientSceneTickLag = params.maxClientSceneTickLag ?? 5;

  if (!tryAcquirePartyCombatEncounterLock(encounterId)) {
    return {
      success: false as const,
      status: 409,
      error: "组队战斗操作处理中，请稍后再试",
      acceptedClientSequence: getLastAcceptedPartyCombatClientSequence(encounterId, actorPlayerId),
      acknowledgeSequence: false,
    };
  }

  try {
    const runtime = await getPartyCombatRuntime(encounterId, {
      includeResolved: true,
    });
    if (!runtime) {
      await closePartyEncounter({
        encounterId,
        status: "abandoned",
      }).catch(() => null);
      return {
        success: false as const,
        status: 404,
        error: "组队战斗不存在",
        errorCode: "COMBAT_SESSION_MISSING",
        acceptedClientSequence: getLastAcceptedPartyCombatClientSequence(encounterId, actorPlayerId),
        acknowledgeSequence: false,
      };
    }

    const currentData = buildPartyCombatRouteData({
      encounterId,
      viewerPlayerId: actorPlayerId,
      state: runtime.state,
      sceneSnapshot: runtime.sceneSnapshot,
      turnState: runtime.turnState,
    });

    if (!isPartyCombatParticipant({
      state: runtime.state,
      playerId: actorPlayerId,
    })) {
      return {
        success: false as const,
        status: 403,
        error: "你不在该组队战斗中",
        errorCode: "COMBAT_FORBIDDEN",
        data: currentData,
        acceptedClientSequence: getLastAcceptedPartyCombatClientSequence(encounterId, actorPlayerId),
        acknowledgeSequence: false,
      };
    }

    const lastAcceptedClientSequence = getLastAcceptedPartyCombatClientSequence(encounterId, actorPlayerId);
    if (clientSequence <= lastAcceptedClientSequence) {
      return {
        success: false as const,
        status: 409,
        error: "动作序列已处理",
        errorCode: "COMBAT_SCENE_STALE",
        data: currentData,
        acceptedClientSequence: lastAcceptedClientSequence,
        acknowledgeSequence: false,
      };
    }
    if (clientSequence > lastAcceptedClientSequence + 1) {
      return {
        success: false as const,
        status: 409,
        error: "动作序号跳帧，请等待上一帧确认后再继续出手",
        errorCode: "COMBAT_SCENE_STALE",
        data: currentData,
        acceptedClientSequence: lastAcceptedClientSequence,
        acknowledgeSequence: false,
      };
    }

    const serverSceneTick = runtime.sceneSnapshot?.tick || 0;
    if (clientSceneTick > serverSceneTick || serverSceneTick - clientSceneTick > maxClientSceneTickLag) {
      return {
        success: false as const,
        status: 409,
        error: "战斗状态已更新，请等待场景同步后再出手",
        errorCode: "COMBAT_SCENE_STALE",
        data: currentData,
        acceptedClientSequence: lastAcceptedClientSequence,
        acknowledgeSequence: false,
      };
    }

    if (runtime.state.status !== "ongoing") {
      return {
        success: false as const,
        status: 400,
        error: "战斗已结束",
        errorCode: "COMBAT_SESSION_FINISHED",
        data: currentData,
        acceptedClientSequence: lastAcceptedClientSequence,
        acknowledgeSequence: false,
      };
    }
    if (action !== "flee" && runtime.turnState.currentTurnPlayerId !== actorPlayerId) {
      return {
        success: false as const,
        status: 400,
        error: "当前还未轮到你出手",
        data: currentData,
        acceptedClientSequence: lastAcceptedClientSequence,
        acknowledgeSequence: false,
      };
    }

    const finish = async (result: Awaited<ReturnType<typeof performPartyCombatAction>> | Awaited<ReturnType<typeof performPartyCombatFlee>>) => {
      if (!result.success) {
        acceptPartyCombatClientSequence(encounterId, actorPlayerId, clientSequence);
        return {
          success: false as const,
          status: 400,
          error: result.error,
          data: currentData,
          acceptedClientSequence: clientSequence,
          acknowledgeSequence: true,
        };
      }

      acceptPartyCombatClientSequence(encounterId, actorPlayerId, clientSequence);
      return {
        success: true as const,
        data: buildPartyCombatRouteData({
          encounterId,
          viewerPlayerId: actorPlayerId,
          state: result.state,
          sceneSnapshot: result.sceneSnapshot,
          turnState: result.turnState,
        }),
        acceptedClientSequence: clientSequence,
        acknowledgeSequence: true,
      };
    };

    if (action === "flee" || action === "surrender") {
      return finish(await performPartyCombatFlee({
        encounterId,
        actorPlayerId,
      }));
    }

    if (action === "item") {
      if (!itemId) {
        acceptPartyCombatClientSequence(encounterId, actorPlayerId, clientSequence);
        return {
          success: false as const,
          status: 400,
          error: "缺少丹药 ID",
          data: currentData,
          acceptedClientSequence: clientSequence,
          acknowledgeSequence: true,
        };
      }
      const preparedItem = await prepareCombatItemUsage({
        playerId: actorPlayerId,
        itemId,
      });
      if (!preparedItem.success) {
        acceptPartyCombatClientSequence(encounterId, actorPlayerId, clientSequence);
        return {
          success: false as const,
          status: 400,
          error: preparedItem.error,
          data: currentData,
          acceptedClientSequence: clientSequence,
          acknowledgeSequence: true,
        };
      }
      const result = await performPartyCombatAction({
        encounterId,
        actorPlayerId,
        actionType: "item",
        itemName: preparedItem.itemName,
        itemEffects: preparedItem.effects,
      });
      if (result.success) {
        await consumeOneCombatItem(actorPlayerId, itemId, preparedItem.quantity);
      }
      return finish(result);
    }

    return finish(await performPartyCombatAction({
      encounterId,
      actorPlayerId,
      actionType: "skill",
      skillId,
    }));
  } finally {
    releasePartyCombatEncounterLock(encounterId);
  }
}
