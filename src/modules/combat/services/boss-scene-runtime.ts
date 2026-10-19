import {
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import { createBattleSpatialRuntimeSnapshot } from "@/modules/combat/services/battle-spatial-runtime";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import {
  readPersistedRuntimeValue,
  writePersistedRuntimeValue,
} from "@/modules/shared/services/runtime-persisted-store";
import type { BossEvent, BossParticipant, CombatTurnState } from "@/types/game";

type BossEventSubscriber = (event: BossEvent) => void;

type BossSceneRuntimeGlobal = typeof globalThis & {
  __bossSceneSnapshots?: Map<string, BattleSceneSnapshot>;
  __bossEventSubscribers?: Map<string, Set<BossEventSubscriber>>;
  __bossEventReplay?: Map<string, BossEvent[]>;
  __bossSceneRuntimeHydrated?: boolean;
};

const MAX_REPLAY_EVENTS = 120;
const BOSS_SCENE_RUNTIME_NAMESPACE = "boss-scene-runtime";

function persistBossSceneRuntime(globalStore: BossSceneRuntimeGlobal) {
  writePersistedRuntimeValue(BOSS_SCENE_RUNTIME_NAMESPACE, "store", {
    snapshots: Array.from(globalStore.__bossSceneSnapshots?.entries() || []),
    replay: Array.from(globalStore.__bossEventReplay?.entries() || []),
  });
}

function getRuntimeStore() {
  const globalStore = globalThis as BossSceneRuntimeGlobal;
  globalStore.__bossSceneSnapshots = ensureGlobalMap<string, BattleSceneSnapshot>(
    globalStore as Record<string, unknown>,
    "__bossSceneSnapshots",
  );
  globalStore.__bossEventSubscribers = ensureGlobalMap<string, Set<BossEventSubscriber>>(
    globalStore as Record<string, unknown>,
    "__bossEventSubscribers",
  );
  globalStore.__bossEventReplay = ensureGlobalMap<string, BossEvent[]>(
    globalStore as Record<string, unknown>,
    "__bossEventReplay",
  );
  if (!globalStore.__bossSceneRuntimeHydrated) {
    globalStore.__bossSceneRuntimeHydrated = true;
    const persisted = readPersistedRuntimeValue<{
      snapshots?: Array<[string, BattleSceneSnapshot]>;
      replay?: Array<[string, BossEvent[]]>;
    }>(BOSS_SCENE_RUNTIME_NAMESPACE, "store");
    if (persisted?.snapshots && globalStore.__bossSceneSnapshots.size === 0) {
      for (const [bossId, snapshot] of persisted.snapshots) {
        globalStore.__bossSceneSnapshots.set(bossId, snapshot);
      }
    }
    if (persisted?.replay && globalStore.__bossEventReplay.size === 0) {
      for (const [bossId, replay] of persisted.replay) {
        globalStore.__bossEventReplay.set(bossId, replay);
      }
    }
  }
  return globalStore;
}

function normalizeParticipants(participants: BossParticipant[]) {
  return [...participants].sort((left, right) => left.slot - right.slot);
}

export function createBossSceneSnapshot(params: {
  bossId: string;
  bossName: string;
  participants: BossParticipant[];
  turnState?: CombatTurnState | null;
  previousSnapshot?: BattleSceneSnapshot | null;
}) {
  const normalizedParticipants = normalizeParticipants(params.participants);
  const previousSnapshot = params.previousSnapshot ?? getBossSceneSnapshot(params.bossId);

  return createBattleSpatialRuntimeSnapshot({
    mode: "boss",
    battleMode: "boss",
    units: [
      {
        id: `boss-${params.bossId}`,
        name: params.bossName,
        role: "boss",
      },
      ...normalizedParticipants.map((participant) => ({
        id: participant.playerId,
        name: participant.playerName,
        role: "player" as const,
        slot: participant.slot,
        avatarImageUrl: participant.avatarImageUrl,
        avatarFrameImageUrl: participant.avatarFrameImageUrl,
        isCurrent: participant.playerId === params.turnState?.currentTurnPlayerId,
      })),
    ],
    sequence: (previousSnapshot?.sequence || 0) + 1,
    tick: (previousSnapshot?.tick || 0) + 1,
    serverTimeMs: Date.now(),
    previousSnapshot: previousSnapshot || undefined,
  });
}

export function setBossSceneSnapshot(
  bossId: string,
  snapshot: BattleSceneSnapshot | null | undefined,
  options?: { persist?: boolean },
) {
  const runtimeStore = getRuntimeStore();
  const store = runtimeStore.__bossSceneSnapshots!;
  if (!snapshot) {
    store.delete(bossId);
    if (options?.persist !== false) {
      persistBossSceneRuntime(runtimeStore);
    }
    return null;
  }
  store.set(bossId, snapshot);
  if (options?.persist !== false) {
    persistBossSceneRuntime(runtimeStore);
  }
  return snapshot;
}

export function getBossSceneSnapshot(bossId: string) {
  return getRuntimeStore().__bossSceneSnapshots!.get(bossId) || null;
}

export function getLatestBossEvent(bossId: string) {
  const replayEvents = getRuntimeStore().__bossEventReplay!.get(bossId) || [];
  return replayEvents.length > 0 ? replayEvents[replayEvents.length - 1] || null : null;
}

export function subscribeBossEvents(bossId: string, subscriber: BossEventSubscriber) {
  const store = getRuntimeStore().__bossEventSubscribers!;
  const subscribers = store.get(bossId) || new Set<BossEventSubscriber>();
  subscribers.add(subscriber);
  store.set(bossId, subscribers);

  return () => {
    const current = store.get(bossId);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      store.delete(bossId);
    }
  };
}

export function publishBossEvent(event: BossEvent) {
  const runtimeStore = getRuntimeStore();
  if (event.sceneSnapshot) {
    setBossSceneSnapshot(event.bossId, event.sceneSnapshot, { persist: false });
  }

  const replayStore = runtimeStore.__bossEventReplay!;
  const nextReplay = [...(replayStore.get(event.bossId) || []), event];
  replayStore.set(event.bossId, nextReplay.slice(-MAX_REPLAY_EVENTS));
  persistBossSceneRuntime(runtimeStore);

  const subscribers = runtimeStore.__bossEventSubscribers!.get(event.bossId);
  if (!subscribers) {
    return;
  }

  for (const subscriber of subscribers) {
    subscriber(event);
  }
}
