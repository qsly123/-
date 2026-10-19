import {
  readPersistedRuntimeValue,
  writePersistedRuntimeValue,
} from "@/modules/shared/services/runtime-persisted-store";

type BossRouteSequenceGlobal = typeof globalThis & {
  __bossAcceptedCommandSequences?: Map<string, BossAcceptedSequenceValue>;
};

type BossAcceptedSequenceValue = {
  value: number;
  updatedAtMs: number;
};

const BOSS_COMMAND_SEQUENCE_NAMESPACE = "boss-command-sequence";
const BOSS_COMMAND_SEQUENCE_TTL_MS = 30 * 60 * 1000;

function getGlobalStore() {
  const globalStore = globalThis as BossRouteSequenceGlobal;
  if (!globalStore.__bossAcceptedCommandSequences) {
    globalStore.__bossAcceptedCommandSequences = new Map<string, BossAcceptedSequenceValue>();
  }
  return globalStore.__bossAcceptedCommandSequences;
}

function getSequenceKey(bossId: string, playerId: string) {
  return `${bossId}:${playerId}`;
}

function pruneExpiredAcceptedSequences(store: Map<string, BossAcceptedSequenceValue>, nowMs: number) {
  for (const [key, value] of store.entries()) {
    if (value.updatedAtMs + BOSS_COMMAND_SEQUENCE_TTL_MS <= nowMs) {
      store.delete(key);
    }
  }
}

export function getLastAcceptedBossClientSequence(bossId: string, playerId: string) {
  const nowMs = Date.now();
  const store = getGlobalStore();
  pruneExpiredAcceptedSequences(store, nowMs);
  const sequenceKey = getSequenceKey(bossId, playerId);
  const current = store.get(sequenceKey);
  if (current) {
    return current.value;
  }
  const persisted = readPersistedRuntimeValue<BossAcceptedSequenceValue>(
    BOSS_COMMAND_SEQUENCE_NAMESPACE,
    sequenceKey,
  );
  if (!persisted || persisted.updatedAtMs + BOSS_COMMAND_SEQUENCE_TTL_MS <= nowMs) {
    return 0;
  }
  store.set(sequenceKey, persisted);
  return persisted.value;
}

export function acceptBossClientSequence(bossId: string, playerId: string, clientSequence: number) {
  const nowMs = Date.now();
  const store = getGlobalStore();
  pruneExpiredAcceptedSequences(store, nowMs);
  const sequenceKey = getSequenceKey(bossId, playerId);
  const value = {
    value: clientSequence,
    updatedAtMs: nowMs,
  } satisfies BossAcceptedSequenceValue;
  store.set(sequenceKey, value);
  writePersistedRuntimeValue(BOSS_COMMAND_SEQUENCE_NAMESPACE, sequenceKey, value, {
    ttlMs: BOSS_COMMAND_SEQUENCE_TTL_MS,
  });
}
