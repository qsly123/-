import { createSceneStreamRuntime } from "@/modules/shared/services/scene-stream-runtime";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import { buildBattleRuntimeFromBattleView } from "@/modules/combat/services/battle-runtime";
import { buildBossBattleRuntimePayload, resolveBossBattleStatusText } from "@/modules/combat/services/boss-battle-runtime";
import {
  loadBattleSceneHubState,
  subscribeBattleSceneHub,
  type BattleSceneHubRef,
  type BattleSceneHubState,
} from "@/modules/combat/services/battle-scene-hub";
import type { BattleRealtimeEnvelope, BattleViewState, BossParticipant, CombatState } from "@/types/game";

function buildBattleViewFromHubState(params: {
  hubState: BattleSceneHubState;
  viewerPlayerId?: string | null;
}) {
  const viewerPlayerId = params.viewerPlayerId?.trim() || null;
  if (params.hubState.mode === "solo" || params.hubState.mode === "party") {
    const state = params.hubState.state;
    if (!state) {
      return null;
    }
    return buildCombatBattleViewState({
      runtimeId: params.hubState.runtimeId,
      mode: params.hubState.mode,
      state,
      sceneSnapshot: params.hubState.snapshot,
      turnState: params.hubState.turnState,
      viewerPlayerId,
    });
  }
  if (params.hubState.mode === "pvp") {
    const payload = params.hubState.payload || {};
    const battleView = payload.battleView as BattleViewState | undefined;
    return battleView || null;
  }

  return null;
}

function buildInitialEnvelope(params: {
  hubState: BattleSceneHubState;
  viewerPlayerId?: string | null;
}): BattleRealtimeEnvelope | null {
  if (params.hubState.mode === "boss") {
    const payload = params.hubState.payload || null;
    const participants = Array.isArray(payload?.participants)
      ? payload.participants as BossParticipant[]
      : [];
    const currentHp = typeof payload?.currentHp === "number" ? payload.currentHp : 0;
    const maxHp = typeof payload?.maxHp === "number" ? payload.maxHp : Math.max(1, currentHp);
    const bossName = params.hubState.snapshot?.units.find((unit) => unit.role === "boss")?.name
      || "首领战";
    const { battleView, battleRuntime } = buildBossBattleRuntimePayload({
      runtimeId: params.hubState.runtimeId,
      bossName,
      currentHp,
      maxHp,
      participants,
      turnState: params.hubState.turnState,
      sceneSnapshot: params.hubState.snapshot,
      viewerPlayerId: params.viewerPlayerId,
      statusText: resolveBossBattleStatusText({
        currentHp,
        statusText: typeof payload?.statusText === "string" ? payload.statusText : null,
      }),
      modePayload: payload,
    });

    return {
      type: "scene_snapshot",
      runtimeId: params.hubState.runtimeId,
      mode: params.hubState.mode,
      sceneSnapshot: params.hubState.snapshot,
      turnState: params.hubState.turnState,
      payload: {
        ...(payload || {}),
        state: params.hubState.state,
        battleView,
        battleRuntime,
      },
    };
  }

  const battleView = buildBattleViewFromHubState(params);
  const battleRuntime = battleView
    ? buildBattleRuntimeFromBattleView({
      battleView,
      sceneSnapshot: params.hubState.snapshot,
      turnState: params.hubState.turnState,
      payload: params.hubState.payload,
    })
    : null;

  return {
    type: "scene_snapshot",
    runtimeId: params.hubState.runtimeId,
    mode: params.hubState.mode,
    sceneSnapshot: params.hubState.snapshot,
    turnState: params.hubState.turnState,
    payload: {
      ...(params.hubState.payload || {}),
      state: params.hubState.state,
      battleView,
      battleRuntime,
    },
  };
}

function buildRealtimeEnvelope(params: {
  ref: BattleSceneHubRef;
  event: BattleRealtimeEnvelope;
  viewerPlayerId?: string | null;
}) {
  if (params.ref.mode === "solo" || params.ref.mode === "party") {
    const state = params.event.payload?.state as CombatState | undefined;
    let battleView: BattleViewState | null = null;
    if (state) {
      battleView = buildCombatBattleViewState({
        runtimeId: params.ref.runtimeId,
        mode: params.ref.mode,
        state,
        sceneSnapshot: params.event.sceneSnapshot || null,
        turnState: params.event.turnState || null,
        viewerPlayerId: params.viewerPlayerId,
      });
    }

    return {
      ...params.event,
      payload: {
        ...(params.event.payload || {}),
        ...(battleView ? {
          battleView,
          battleRuntime: buildBattleRuntimeFromBattleView({
            battleView,
            sceneSnapshot: params.event.sceneSnapshot || null,
            turnState: params.event.turnState || null,
          }),
        } : {}),
      },
    } satisfies BattleRealtimeEnvelope;
  }

  if (params.ref.mode === "boss") {
    const payload = params.event.payload || {};
    const participants = Array.isArray(payload.participants)
      ? payload.participants as BossParticipant[]
      : [];
    const currentHp = typeof payload.currentHp === "number" ? payload.currentHp : 0;
    const maxHp = typeof payload.maxHp === "number" ? payload.maxHp : Math.max(1, currentHp);
    const bossName = params.event.sceneSnapshot?.units.find((unit) => unit.role === "boss")?.name
      || "首领战";
    const { battleView, battleRuntime } = buildBossBattleRuntimePayload({
      runtimeId: params.ref.runtimeId,
      bossName,
      currentHp,
      maxHp,
      participants,
      turnState: params.event.turnState || null,
      sceneSnapshot: params.event.sceneSnapshot || null,
      viewerPlayerId: params.viewerPlayerId,
      statusText: resolveBossBattleStatusText({
        currentHp,
        statusText: typeof payload.statusText === "string" ? payload.statusText : null,
      }),
      modePayload: payload,
    });

    return {
      ...params.event,
      payload: {
        ...payload,
        battleView,
        battleRuntime,
      },
    } satisfies BattleRealtimeEnvelope;
  }

  if (params.ref.mode === "pvp") {
    return {
      ...params.event,
      payload: {
        ...(params.event.payload || {}),
      },
    } satisfies BattleRealtimeEnvelope;
  }

  return params.event;
}

export function createBattleSceneStreamRuntime(params: {
  ref: BattleSceneHubRef;
  viewerPlayerId?: string | null;
}) {
  return createSceneStreamRuntime<null, unknown, BattleRealtimeEnvelope>({
    async getInitialEvents() {
      const events: BattleRealtimeEnvelope[] = [{
        type: "connected",
        runtimeId: params.ref.runtimeId,
        mode: params.ref.mode,
      }];
      const hubState = await loadBattleSceneHubState(params.ref);
      const initialEnvelope = hubState
        ? buildInitialEnvelope({
          hubState,
          viewerPlayerId: params.viewerPlayerId,
        })
        : null;
      if (initialEnvelope) {
        events.push(initialEnvelope);
      }
      return events;
    },
    subscribe(subscriber) {
      return subscribeBattleSceneHub(params.ref, (event) => {
        subscriber(buildRealtimeEnvelope({
          ref: params.ref,
          event,
          viewerPlayerId: params.viewerPlayerId,
        }));
      });
    },
  });
}
