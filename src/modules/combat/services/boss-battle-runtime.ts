import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import { buildBossBattleViewState } from "@/modules/combat/services/battle-view";
import type { BattleRuntime, BattleViewState, BossParticipant, CombatTurnState } from "@/types/game";

export type BossBattleRuntimePayload = {
  battleView: BattleViewState;
  battleRuntime: BattleRuntime;
};

export function resolveBossBattleStatusText(params: {
  currentHp: number;
  statusText?: string | null;
}) {
  if (typeof params.statusText === "string" && params.statusText.trim().length > 0) {
    return params.statusText.trim();
  }
  return params.currentHp > 0 ? "首领交战中" : "首领已被击败";
}

export function buildBossBattleRuntimePayload(params: {
  runtimeId: string;
  bossName: string;
  currentHp: number;
  maxHp: number;
  participants: BossParticipant[];
  turnState?: CombatTurnState | null;
  sceneSnapshot?: BattleSceneSnapshot | null;
  viewerPlayerId?: string | null;
  statusText?: string | null;
  modePayload?: Record<string, unknown> | null;
}): BossBattleRuntimePayload {
  const battleView = buildBossBattleViewState({
    runtimeId: params.runtimeId,
    bossName: params.bossName,
    currentHp: params.currentHp,
    maxHp: params.maxHp,
    participants: params.participants,
    turnState: params.turnState || null,
    sceneSnapshot: params.sceneSnapshot || null,
    viewerPlayerId: params.viewerPlayerId,
    statusText: resolveBossBattleStatusText({
      currentHp: params.currentHp,
      statusText: params.statusText,
    }),
    modePayload: params.modePayload || null,
  });

  return {
    battleView,
    battleRuntime: buildBattleRuntimeFromBattleView({
      battleView,
      sceneSnapshot: params.sceneSnapshot || null,
      turnState: params.turnState || null,
      payload: params.modePayload || null,
    }),
  };
}
