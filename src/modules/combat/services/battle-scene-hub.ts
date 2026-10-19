import { getLatestBossEvent, getBossSceneSnapshot, subscribeBossEvents } from "@/modules/combat/services/boss-scene-runtime";
import {
  buildPartyCombatViewState,
  getPartyCombatEncounterRuntime,
  subscribePartyCombatSceneEvents,
} from "@/modules/combat/services/party-combat-service";
import {
  getPendingCombatSession,
  getPendingCombatSceneSnapshot,
  getSettledCombatSessionResult,
  subscribePendingCombatSceneEventsByCombat,
} from "@/modules/combat/services/pending-combat-session";
import {
  buildPvpViewerSceneData,
  syncPvpCombatRuntime,
  subscribePvpCombatRuntime,
} from "@/modules/combat/services/pvp-runtime-service";
import type { BattleMode, BattleRealtimeEnvelope, BattleRuntimeState, CombatState, CombatTurnState } from "@/types/game";
import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";

export type BattleSceneHubRef =
  | { mode: "solo"; runtimeId: string; playerId: string }
  | { mode: "party"; runtimeId: string; playerId: string }
  | { mode: "boss"; runtimeId: string; playerId?: string | null }
  | { mode: "pvp"; runtimeId: string; playerId: string };

export type BattleSceneHubState = {
  runtimeId: string;
  mode: BattleMode;
  runtimeState: BattleRuntimeState;
  snapshot: BattleSceneSnapshot | null;
  state: CombatState | null;
  turnState: CombatTurnState | null;
  payload?: Record<string, unknown> | null;
};

function resolveRuntimeState(params: {
  mode: BattleMode;
  state?: CombatState | null;
  snapshot?: BattleSceneSnapshot | null;
  currentHp?: number | null;
}) {
  if (params.mode === "boss") {
    if (typeof params.currentHp === "number") {
      return params.currentHp > 0 ? "active" : "finished";
    }
    return params.snapshot ? "active" : "preparing";
  }
  if (!params.state) {
    return params.snapshot ? "finished" : "preparing";
  }
  if (params.state.status === "ongoing") {
    return "active";
  }
  return "finished";
}

export async function loadBattleSceneHubState(ref: BattleSceneHubRef): Promise<BattleSceneHubState | null> {
  if (ref.mode === "solo") {
    const pending = getPendingCombatSession(ref.playerId, ref.runtimeId);
    const snapshot = getPendingCombatSceneSnapshot(ref.playerId, ref.runtimeId);
    if (pending && snapshot) {
      return {
        runtimeId: ref.runtimeId,
        mode: "solo",
        runtimeState: resolveRuntimeState({
          mode: "solo",
          state: pending.state,
          snapshot,
        }),
        snapshot,
        state: pending.state,
        turnState: null,
      };
    }

    const settled = getSettledCombatSessionResult(ref.playerId, ref.runtimeId);
    if (!settled) {
      return null;
    }

    return {
      runtimeId: ref.runtimeId,
      mode: "solo",
      runtimeState: "finished",
      snapshot: settled.sceneSnapshot,
      state: settled.state,
      turnState: null,
    };
  }

  if (ref.mode === "party") {
    const runtime = await getPartyCombatEncounterRuntime({
      encounterId: ref.runtimeId,
      allowStatuses: ["ongoing", "resolved", "abandoned"],
    });
    if (!runtime) {
      return null;
    }

    return {
      runtimeId: ref.runtimeId,
      mode: "party",
      runtimeState: resolveRuntimeState({
        mode: "party",
        state: runtime.state,
        snapshot: runtime.sceneSnapshot,
      }),
      snapshot: runtime.sceneSnapshot,
      state: buildPartyCombatViewState(runtime.state, ref.playerId),
      turnState: runtime.turnState,
    };
  }

  if (ref.mode === "boss") {
    const latestEvent = getLatestBossEvent(ref.runtimeId);
    const snapshot = getBossSceneSnapshot(ref.runtimeId);
    if (!latestEvent && !snapshot) {
      return null;
    }

    return {
      runtimeId: ref.runtimeId,
      mode: "boss",
      runtimeState: resolveRuntimeState({
        mode: "boss",
        snapshot,
        currentHp: latestEvent?.currentHp,
      }),
      snapshot,
      state: null,
      turnState: latestEvent?.turnState || null,
      payload: latestEvent ? {
        bossId: latestEvent.bossId,
        eventType: latestEvent.type,
        currentHp: latestEvent.currentHp,
        maxHp: latestEvent.maxHp,
        participants: latestEvent.participants,
        bossNextIntent: latestEvent.bossNextIntent,
        statusText: typeof latestEvent.currentHp === "number" && latestEvent.currentHp > 0
          ? "首领交战中"
          : "首领已被击败",
      } : null,
    };
  }

  await syncPvpCombatRuntime(ref.runtimeId);
  const viewerData = buildPvpViewerSceneData(ref.runtimeId, ref.playerId);
  if (!viewerData) {
    return null;
  }

  return {
    runtimeId: ref.runtimeId,
    mode: "pvp",
    runtimeState: resolveRuntimeState({
      mode: "pvp",
      state: viewerData.state,
      snapshot: viewerData.sceneSnapshot,
    }),
    snapshot: viewerData.sceneSnapshot,
    state: viewerData.state,
    turnState: viewerData.turnState,
    payload: {
      battleView: viewerData.battleView,
      battleRuntime: viewerData.battleRuntime,
      settlement: viewerData.settlement,
    },
  };
}

export function subscribeBattleSceneHub(
  ref: BattleSceneHubRef,
  subscriber: (event: BattleRealtimeEnvelope) => void,
) {
  if (ref.mode === "solo") {
    return subscribePendingCombatSceneEventsByCombat(ref.playerId, ref.runtimeId, (event) => {
      subscriber({
        type: "scene_snapshot",
        runtimeId: ref.runtimeId,
        mode: "solo",
        sceneSnapshot: event.snapshot,
        payload: {
          state: event.state,
        },
      });
    });
  }

  if (ref.mode === "party") {
    return subscribePartyCombatSceneEvents(ref.runtimeId, (event) => {
      subscriber({
        type: "scene_snapshot",
        runtimeId: ref.runtimeId,
        mode: "party",
        sceneSnapshot: event.sceneSnapshot,
        turnState: event.turnState,
        payload: {
          state: event.state,
        },
      });
    });
  }

  if (ref.mode === "boss") {
    return subscribeBossEvents(ref.runtimeId, (event) => {
      subscriber({
        type: event.type === "boss_dead" ? "settlement" : "event",
        runtimeId: ref.runtimeId,
        mode: "boss",
        sceneSnapshot: event.sceneSnapshot || null,
        turnState: event.turnState || null,
        payload: {
          ...event,
          bossId: event.bossId,
          eventType: event.type,
          statusText: typeof event.currentHp === "number" && event.currentHp > 0
            ? "首领交战中"
            : event.type === "boss_spawn"
              ? "首领已重生"
              : "首领已被击败",
        } as unknown as Record<string, unknown>,
      });
    });
  }

  return subscribePvpCombatRuntime(ref.runtimeId, (event) => {
    const viewerData = buildPvpViewerSceneData(ref.runtimeId, ref.playerId);
    if (!viewerData) {
      subscriber({
        type: "runtime_closed",
        runtimeId: ref.runtimeId,
        mode: "pvp",
      });
      return;
    }
    subscriber({
      type: event.type === "settlement" ? "settlement" : event.type === "closed" ? "runtime_closed" : "scene_snapshot",
      runtimeId: ref.runtimeId,
      mode: "pvp",
      sceneSnapshot: viewerData.sceneSnapshot,
      turnState: viewerData.turnState,
      payload: {
        state: viewerData.state,
        battleView: viewerData.battleView,
        battleRuntime: viewerData.battleRuntime,
        settlement: viewerData.settlement,
      },
    });
  });
}
