import { ensureGlobalMap, isPlainObject } from "@/modules/shared/services/global-store";
import {
  readPersistedRuntimeValue,
  writePersistedRuntimeValueNow,
} from "@/modules/shared/services/runtime-persisted-store";
import { buildMapAoiKeysForPlayerPosition } from "@/modules/map/services/map-presence";

type MapSceneSyncState = {
  tickByMapId: Map<string, number>;
  sectorTickByAoiKey: Map<string, number>;
  playerSequenceByMapKey: Map<string, { mapId: string; lastAcceptedClientSequence: number; updatedAtMs: number }>;
};

type MapSceneSyncGlobal = typeof globalThis & {
  __mapSceneSyncState?: MapSceneSyncState;
};

const MAP_SEQUENCE_TTL_MS = 10 * 60 * 1000;
const MAP_SCENE_SYNC_RUNTIME_NAMESPACE = "map-scene-sync";

function getState() {
  const globalStore = globalThis as MapSceneSyncGlobal;
  const currentState = isPlainObject(globalStore.__mapSceneSyncState)
    ? globalStore.__mapSceneSyncState as MapSceneSyncState
    : {} as MapSceneSyncState;
  currentState.tickByMapId = ensureGlobalMap<string, number>(
    currentState as Record<string, unknown>,
    "tickByMapId",
  );
  currentState.sectorTickByAoiKey = ensureGlobalMap<string, number>(
    currentState as Record<string, unknown>,
    "sectorTickByAoiKey",
  );
  currentState.playerSequenceByMapKey = ensureGlobalMap<
    string,
    { mapId: string; lastAcceptedClientSequence: number; updatedAtMs: number }
  >(
    currentState as Record<string, unknown>,
    "playerSequenceByMapKey",
  );
  globalStore.__mapSceneSyncState = currentState;
  return globalStore.__mapSceneSyncState;
}

function getPlayerMapKey(playerId: string, mapId: string) {
  return `${playerId}:${mapId}`;
}

function pruneExpiredPlayerSequences(state: MapSceneSyncState, nowMs: number) {
  for (const [key, value] of state.playerSequenceByMapKey.entries()) {
    if (nowMs - value.updatedAtMs > MAP_SEQUENCE_TTL_MS) {
      state.playerSequenceByMapKey.delete(key);
    }
  }
}

export function ensureMapSceneTick(mapId: string) {
  const state = getState();
  const current = state.tickByMapId.get(mapId);
  const persisted = readPersistedRuntimeValue<number>(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `tick:${mapId}`);
  const nextTick = Math.max(
    typeof current === "number" && current >= 1 ? current : 1,
    typeof persisted === "number" && persisted >= 1 ? persisted : 1,
  );
  state.tickByMapId.set(mapId, nextTick);
  return nextTick;
}

export function getMapSceneTick(mapId: string) {
  return ensureMapSceneTick(mapId);
}

export function advanceMapSceneTick(mapId: string) {
  const state = getState();
  const nextTick = ensureMapSceneTick(mapId) + 1;
  const updatedAtMs = Date.now();
  state.tickByMapId.set(mapId, nextTick);
  writePersistedRuntimeValueNow(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `tick:${mapId}`, nextTick);
  writePersistedRuntimeValueNow(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `tick-meta:${mapId}`, {
    tick: nextTick,
    updatedAtMs,
  });
  return nextTick;
}

function normalizeSectorKeys(aoiKeys: string[]) {
  return Array.from(new Set(
    (Array.isArray(aoiKeys) ? aoiKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean),
  ));
}

export function advanceMapSceneSectorTicks(aoiKeys: string[], tick?: number) {
  const normalizedKeys = normalizeSectorKeys(aoiKeys);
  if (normalizedKeys.length < 1) {
    return 0;
  }

  const state = getState();
  const updatedAtMs = Date.now();
  const nextTick = Number.isFinite(tick) && Number(tick) >= 1
    ? Math.floor(Number(tick))
    : updatedAtMs;

  normalizedKeys.forEach((aoiKey) => {
    state.sectorTickByAoiKey.set(aoiKey, nextTick);
    writePersistedRuntimeValueNow(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `sector-tick:${aoiKey}`, nextTick);
    writePersistedRuntimeValueNow(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `sector-tick-meta:${aoiKey}`, {
      tick: nextTick,
      updatedAtMs,
    });
  });

  return nextTick;
}

export function advanceMapSceneTickForPositions(params: {
  mapId: string;
  positions: Array<{
    positionX: number;
    positionY: number;
  }>;
  tick?: number;
}) {
  const normalizedMapId = String(params.mapId || "").trim();
  if (!normalizedMapId) {
    return 0;
  }

  const aoiKeys = normalizeSectorKeys(
    (Array.isArray(params.positions) ? params.positions : []).flatMap((position) => (
      buildMapAoiKeysForPlayerPosition({
        mapId: normalizedMapId,
        positionX: Number(position?.positionX || 0),
        positionY: Number(position?.positionY || 0),
        preloadRings: 0,
      })
    )),
  );

  return advanceMapSceneSectorTicks(aoiKeys, params.tick);
}

export function getLastAcceptedMapClientSequence(playerId: string, mapId: string) {
  const state = getState();
  pruneExpiredPlayerSequences(state, Date.now());
  const key = getPlayerMapKey(playerId, mapId);
  const current = state.playerSequenceByMapKey.get(key) || null;
  const persisted = readPersistedRuntimeValue<{
    mapId: string;
    lastAcceptedClientSequence: number;
    updatedAtMs: number;
  }>(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `seq:${key}`);

  let nextValue = current;
  if (
    persisted
    && persisted.mapId === mapId
    && typeof persisted.lastAcceptedClientSequence === "number"
    && (
      !nextValue
      || persisted.updatedAtMs > nextValue.updatedAtMs
      || persisted.lastAcceptedClientSequence > nextValue.lastAcceptedClientSequence
    )
  ) {
    nextValue = persisted;
  }

  if (!nextValue) {
    nextValue = {
      mapId,
      lastAcceptedClientSequence: 0,
      updatedAtMs: Date.now(),
    };
  }

  state.playerSequenceByMapKey.set(key, nextValue);
  return nextValue.lastAcceptedClientSequence;
}

export function acceptMapClientSequence(playerId: string, mapId: string, clientSequence: number) {
  const state = getState();
  pruneExpiredPlayerSequences(state, Date.now());
  const key = getPlayerMapKey(playerId, mapId);
  const value = {
    mapId,
    lastAcceptedClientSequence: clientSequence,
    updatedAtMs: Date.now(),
  };
  state.playerSequenceByMapKey.set(key, value);
  writePersistedRuntimeValueNow(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `seq:${key}`, value, {
    ttlMs: MAP_SEQUENCE_TTL_MS,
  });
}

export function resetMapClientSequence(playerId: string, mapId: string) {
  const state = getState();
  pruneExpiredPlayerSequences(state, Date.now());
  const key = getPlayerMapKey(playerId, mapId);
  const value = {
    mapId,
    lastAcceptedClientSequence: 0,
    updatedAtMs: Date.now(),
  };
  state.playerSequenceByMapKey.set(key, value);
  writePersistedRuntimeValueNow(MAP_SCENE_SYNC_RUNTIME_NAMESPACE, `seq:${key}`, value, {
    ttlMs: MAP_SEQUENCE_TTL_MS,
  });
}
