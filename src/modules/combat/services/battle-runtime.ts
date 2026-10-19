import { loadBattleSceneHubState, type BattleSceneHubRef, type BattleSceneHubState } from "@/modules/combat/services/battle-scene-hub";
import { getBattleRuleset } from "@/modules/combat/services/battle-ruleset";
import type { BattleRuntime, BattleViewState } from "@/types/game";

function resolveSceneVersion(battleView?: BattleViewState | null) {
  const snapshot = battleView?.sceneSnapshot;
  if (!snapshot) {
    return 0;
  }
  return snapshot.sceneVersion ?? snapshot.sequence ?? 0;
}

function resolveSceneTick(battleView?: BattleViewState | null) {
  return battleView?.sceneSnapshot?.tick ?? 0;
}

export function buildBattleRuntime(params: {
  runtimeId: string;
  mode: BattleRuntime["mode"];
  state: BattleRuntime["state"];
  participants?: BattleRuntime["participants"];
  battleView?: BattleViewState | null;
  turnState?: BattleRuntime["turnState"];
  sceneSnapshot?: BattleRuntime["sceneSnapshot"];
  settlement?: BattleRuntime["settlement"];
  payload?: BattleRuntime["payload"];
}): BattleRuntime {
  const battleView = params.battleView || null;
  const sceneSnapshot = params.sceneSnapshot ?? battleView?.sceneSnapshot ?? null;
  const turnState = params.turnState ?? battleView?.turnState ?? null;

  return {
    runtimeId: params.runtimeId,
    mode: params.mode,
    state: params.state,
    sceneVersion: sceneSnapshot?.sceneVersion ?? sceneSnapshot?.sequence ?? 0,
    tick: sceneSnapshot?.tick ?? 0,
    ruleset: getBattleRuleset(params.mode),
    participants: params.participants || battleView?.participants || [],
    battleView,
    turnState,
    sceneSnapshot,
    settlement: params.settlement || null,
    payload: params.payload || battleView?.modePayload || null,
  };
}

export function buildBattleRuntimeFromBattleView(params: {
  battleView: BattleViewState;
  sceneSnapshot?: BattleRuntime["sceneSnapshot"];
  turnState?: BattleRuntime["turnState"];
  settlement?: BattleRuntime["settlement"];
  payload?: BattleRuntime["payload"];
}): BattleRuntime {
  return buildBattleRuntime({
    runtimeId: params.battleView.runtimeId,
    mode: params.battleView.mode,
    state: params.battleView.runtimeState,
    participants: params.battleView.participants,
    battleView: params.battleView,
    sceneSnapshot: params.sceneSnapshot ?? params.battleView.sceneSnapshot ?? null,
    turnState: params.turnState ?? params.battleView.turnState ?? null,
    settlement: params.settlement,
    payload: params.payload,
  });
}

function buildFallbackBattleViewFromHubState(hubState: BattleSceneHubState): BattleViewState {
  return {
    runtimeId: hubState.runtimeId,
    mode: hubState.mode,
    runtimeState: hubState.runtimeState,
    title: hubState.mode === "boss"
      ? "首领战"
      : hubState.mode === "party"
        ? "组队战斗"
        : hubState.mode === "pvp"
          ? "论道回放"
          : "普通战斗",
    subtitle: null,
    statusText: null,
    hero: null,
    target: null,
    participants: [],
    turnState: hubState.turnState || null,
    sceneSnapshot: hubState.snapshot || null,
    modePayload: hubState.payload || null,
  };
}

export function buildBattleRuntimeFromSceneHubState(params: {
  hubState: BattleSceneHubState;
  battleView?: BattleViewState | null;
}): BattleRuntime {
  const battleView = params.battleView || buildFallbackBattleViewFromHubState(params.hubState);
  return {
    runtimeId: params.hubState.runtimeId,
    mode: params.hubState.mode,
    state: params.hubState.runtimeState,
    sceneVersion: params.hubState.snapshot?.sceneVersion ?? params.hubState.snapshot?.sequence ?? resolveSceneVersion(battleView),
    tick: params.hubState.snapshot?.tick ?? resolveSceneTick(battleView),
    ruleset: getBattleRuleset(params.hubState.mode),
    participants: battleView.participants,
    battleView,
    turnState: params.hubState.turnState || battleView.turnState || null,
    sceneSnapshot: params.hubState.snapshot || battleView.sceneSnapshot || null,
    settlement: null,
    payload: params.hubState.payload || battleView.modePayload || null,
  };
}

export async function loadBattleRuntime(ref: BattleSceneHubRef, battleView?: BattleViewState | null) {
  const hubState = await loadBattleSceneHubState(ref);
  if (!hubState) {
    return null;
  }
  return buildBattleRuntimeFromSceneHubState({
    hubState,
    battleView,
  });
}
