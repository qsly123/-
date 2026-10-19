import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { avatarAssets, avatarFrameAssets, players } from "@/db/schema";
import {
  type PlayerCosmeticProfile,
} from "@/modules/character/services/player-cosmetic-profile";
import { listMapSceneMonsters } from "@/modules/map/services/monster-ai";
import { listMapSceneNpcsByMap } from "@/modules/map/services/map-npc-scene";
import { listActiveOpportunitiesByMap } from "@/modules/map/services/opportunity-service";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import type {
  MapSceneMonster,
  MapSceneNpc,
  MapSceneOpportunity,
  MapScenePlayer,
} from "@/modules/map/services/map-scene-state";
import {
  subscribeMapPresenceForMap,
  type MapPresenceMessage,
} from "@/modules/map/services/map-presence";
import {
  listOnlineMapPlayerIdsByMap,
  peekMapPlayerOnlinePresence,
} from "@/modules/map/services/map-player-online-runtime";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { pushRuntimePerformanceEvent } from "@/modules/system/services/runtime-performance";

function parsePositiveIntEnv(name: string, fallbackValue: number, minValue = 1) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }
  return parsed;
}

const MAP_SCENE_SHARED_STATE_TTL_MS = 15_000;
const MAP_SCENE_SHARED_STATE_SLOW_LOAD_MS = 2_000;
const MAP_SCENE_SHARED_STATE_REFRESH_AHEAD_MS = 3_000;
const MAP_SCENE_SHARED_STATE_RECENT_ACCESS_WINDOW_MS = 60_000;
const MAP_SCENE_SHARED_STATE_RETRY_TTL_MS = 3_000;
const MAP_SHARED_STATE_STALE_REUSE_MS = parsePositiveIntEnv(
  "MAP_SHARED_STATE_STALE_REUSE_MS",
  30_000,
  0,
);
const MAP_SHARED_STATE_TRANSITION_WARM_ENABLED = String(
  process.env.MAP_SHARED_STATE_TRANSITION_WARM_ENABLED ?? "1",
).trim() !== "0";
const MAP_SCENE_SHARED_STATE_PRUNE_INTERVAL_MS = 60_000;
const MAP_SCENE_SHARED_STATE_STALE_MS = 10 * 60 * 1000;
const MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY = parsePositiveIntEnv(
  "MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY",
  2,
  1,
);

export type MapSceneHubRuntimeMap = {
  id: string;
  width: number;
  height: number;
  tilesData: unknown;
};

export type MapSceneHubWarmSharedStateResult = {
  sharedState: MapSceneSharedState;
  map: MapSceneHubRuntimeMap;
};

export type MapSceneSharedState = {
  mapId: string;
  players: MapScenePlayer[];
  npcs: MapSceneNpc[];
  monsters: MapSceneMonster[];
  opportunities: MapSceneOpportunity[];
  updatedAtMs: number;
};

type MapSceneSharedStateRefreshReason =
  | "initial"
  | "ttl_expired"
  | "proactive"
  | "map_refresh"
  | "secret_realm_changed"
  | "player_transition";

type MapSceneSharedStateCacheEntry = {
  promise: Promise<MapSceneSharedState> | null;
  value: MapSceneSharedState | null;
  expiresAtMs: number;
  map: MapSceneHubRuntimeMap;
  unsubscribe: (() => void) | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  lastAccessedAtMs: number;
  lastSocketAccessAtMs: number;
  lastRefreshReason: MapSceneSharedStateRefreshReason | null;
};

type MapSceneSharedStateProactiveRefreshTask = {
  mapId: string;
  map: MapSceneHubRuntimeMap;
  enqueuedAtMs: number;
  waiters: Array<{
    resolve: (value: MapSceneSharedState) => void;
    reject: (reason?: unknown) => void;
  }>;
};

type MapSceneSharedStateProactiveRefreshState = {
  activeCount: number;
  queue: MapSceneSharedStateProactiveRefreshTask[];
  requestsByMap: Map<string, MapSceneSharedStateProactiveRefreshTask>;
};

type MapSceneHubGlobal = typeof globalThis & {
  __mapSceneSharedStateCache?: Map<string, MapSceneSharedStateCacheEntry>;
  __mapSceneSharedStateCachePruneTimer?: ReturnType<typeof setInterval>;
  __mapSceneSharedStateProactiveRefreshState?: MapSceneSharedStateProactiveRefreshState;
  __mapSceneSourceStats?: {
    sharedStateRequests?: number;
    sharedStateWarmHits?: number;
    playerTransitionWarmHits?: number;
    staleServedWhileRefreshCount?: number;
  };
  __mapSceneHubRuntimeBridge?: {
    warmSharedStateByMapId?: (params: {
      mapId: string;
      force?: boolean;
      reason?: Extract<MapSceneSharedStateRefreshReason, "player_transition" | "proactive">;
    }) => Promise<MapSceneHubWarmSharedStateResult | null>;
  };
};

type MapPlayerRow = {
  id: string;
  name: string | null;
  gender: string | null;
  avatarId: string | null;
  avatarFrameId: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string | null;
  positionX: number;
  positionY: number;
  currentMapId: string | null;
};

function parseOpportunityExpiresAtMs(expiresAt: string | null | undefined) {
  const normalized = String(expiresAt || "").trim();
  if (!normalized) {
    return 0;
  }
  const value = Date.parse(normalized);
  return Number.isFinite(value) ? value : 0;
}

function pruneExpiredOpportunities(opportunities: MapSceneOpportunity[], nowMs = Date.now()) {
  return opportunities.filter((opportunity) => {
    const expiresAtMs = parseOpportunityExpiresAtMs(opportunity.expiresAt);
    return expiresAtMs <= 0 || expiresAtMs > nowMs;
  });
}

function getMapSceneSourceStatsStore() {
  const globalStore = globalThis as MapSceneHubGlobal;
  if (!globalStore.__mapSceneSourceStats || typeof globalStore.__mapSceneSourceStats !== "object") {
    globalStore.__mapSceneSourceStats = {};
  }
  return globalStore.__mapSceneSourceStats;
}

function recordSharedStateRequest(params?: {
  warmHit?: boolean;
  staleServed?: boolean;
  reason?: MapSceneSharedStateRefreshReason;
}) {
  const stats = getMapSceneSourceStatsStore();
  stats.sharedStateRequests = Number(stats.sharedStateRequests || 0) + 1;
  if (params?.warmHit) {
    stats.sharedStateWarmHits = Number(stats.sharedStateWarmHits || 0) + 1;
    if (params.reason === "player_transition") {
      stats.playerTransitionWarmHits = Number(stats.playerTransitionWarmHits || 0) + 1;
    }
  }
  if (params?.staleServed) {
    stats.staleServedWhileRefreshCount = Number(stats.staleServedWhileRefreshCount || 0) + 1;
  }
}

function normalizeSharedStateValue(
  value: MapSceneSharedState | null | undefined,
  nowMs = Date.now(),
) {
  if (!value) {
    return null;
  }
  return pruneExpiredOpportunitiesFromSharedState(value, nowMs);
}

function isSharedStateStaleReusable(
  entry: MapSceneSharedStateCacheEntry | undefined,
  nowMs: number,
) {
  if (!entry?.value || MAP_SHARED_STATE_STALE_REUSE_MS < 1) {
    return false;
  }
  const expiresAtMs = Number(entry.expiresAtMs || 0);
  return expiresAtMs > 0
    && expiresAtMs <= nowMs
    && expiresAtMs + MAP_SHARED_STATE_STALE_REUSE_MS >= nowMs;
}

function pruneExpiredOpportunitiesFromSharedState(
  state: MapSceneSharedState,
  nowMs = Date.now(),
): MapSceneSharedState {
  const nextOpportunities = pruneExpiredOpportunities(state.opportunities, nowMs);
  if (nextOpportunities.length === state.opportunities.length) {
    return state;
  }
  return {
    ...state,
    opportunities: nextOpportunities,
    updatedAtMs: nowMs,
  };
}

function getMapSceneSharedStateCache() {
  const globalStore = globalThis as MapSceneHubGlobal;
  globalStore.__mapSceneSharedStateCache = ensureGlobalMap<string, MapSceneSharedStateCacheEntry>(
    globalStore as Record<string, unknown>,
    "__mapSceneSharedStateCache",
  );
  if (!globalStore.__mapSceneSharedStateCachePruneTimer) {
    globalStore.__mapSceneSharedStateCachePruneTimer = setInterval(() => {
      const cache = globalStore.__mapSceneSharedStateCache;
      if (!cache) {
        return;
      }

      const nowMs = Date.now();
      for (const [mapId, entry] of cache.entries()) {
        if (entry.promise) {
          continue;
        }
        if (getLatestAccessAtMs(entry) + MAP_SCENE_SHARED_STATE_STALE_MS >= nowMs) {
          continue;
        }
        clearRefreshTimer(entry);
        entry.unsubscribe?.();
        cache.delete(mapId);
      }
    }, MAP_SCENE_SHARED_STATE_PRUNE_INTERVAL_MS);
    if (typeof globalStore.__mapSceneSharedStateCachePruneTimer.unref === "function") {
      globalStore.__mapSceneSharedStateCachePruneTimer.unref();
    }
  }
  return globalStore.__mapSceneSharedStateCache;
}

function getMapSceneSharedStateProactiveRefreshState() {
  const globalStore = globalThis as MapSceneHubGlobal;
  if (!globalStore.__mapSceneSharedStateProactiveRefreshState) {
    globalStore.__mapSceneSharedStateProactiveRefreshState = {
      activeCount: 0,
      queue: [],
      requestsByMap: new Map<string, MapSceneSharedStateProactiveRefreshTask>(),
    };
  }
  return globalStore.__mapSceneSharedStateProactiveRefreshState;
}

function toMapScenePlayer(row: MapPlayerRow, cosmetic: PlayerCosmeticProfile): MapScenePlayer {
  return {
    id: row.id,
    name: row.name || "无名",
    gender: row.gender,
    avatarImageUrl: cosmetic.avatarImageUrl || null,
    avatarFrameImageUrl: cosmetic.avatarFrameImageUrl || null,
    realm: row.realm,
    realmMajor: row.realmMajor,
    realmMinor: row.realmMinor,
    realmName: row.realmName || "凡人",
    positionX: row.positionX,
    positionY: row.positionY,
  };
}

async function loadMapPlayers(mapId: string) {
  const onlinePlayerIds = Array.from(listOnlineMapPlayerIdsByMap(mapId));
  if (!onlinePlayerIds.length) {
    return [];
  }

  const onlinePresenceByPlayerId = new Map(
    onlinePlayerIds.map((playerId) => [playerId, peekMapPlayerOnlinePresence(playerId)]),
  );

  const rows = await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    avatarId: players.avatarId,
    avatarFrameId: players.avatarFrameId,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    positionX: players.positionX,
    positionY: players.positionY,
    currentMapId: players.currentMapId,
  }).from(players).where(
    inArray(players.id, onlinePlayerIds),
  ).all();

  if (!rows.length) {
    return [];
  }

  const avatarIds = [...new Set(rows.map((row) => row.avatarId || "").filter(Boolean))];
  const avatarFrameIds = [...new Set(rows.map((row) => row.avatarFrameId || "").filter(Boolean))];

  const [avatarRows, avatarFrameRows] = await Promise.all([
    avatarIds.length
      ? db.select({
        id: avatarAssets.id,
        imageUrl: avatarAssets.imageUrl,
      }).from(avatarAssets)
        .where(and(
          inArray(avatarAssets.id, avatarIds),
          eq(avatarAssets.enabled, true),
        ))
        .all()
      : Promise.resolve([]),
    avatarFrameIds.length
      ? db.select({
        id: avatarFrameAssets.id,
        imageUrl: avatarFrameAssets.imageUrl,
      }).from(avatarFrameAssets)
        .where(and(
          inArray(avatarFrameAssets.id, avatarFrameIds),
          eq(avatarFrameAssets.enabled, true),
        ))
        .all()
      : Promise.resolve([]),
  ]);

  const avatarMap = new Map(avatarRows.map((row) => [row.id, row.imageUrl]));
  const avatarFrameMap = new Map(avatarFrameRows.map((row) => [row.id, row.imageUrl]));

  return rows.flatMap((row) => {
    const onlinePresence = onlinePresenceByPlayerId.get(row.id) || null;
    const effectiveMapId = String(onlinePresence?.mapId || row.currentMapId || "").trim();
    if (effectiveMapId !== mapId) {
      return [];
    }

    return [toMapScenePlayer({
      ...row,
      currentMapId: effectiveMapId,
      positionX: onlinePresence ? onlinePresence.positionX : row.positionX,
      positionY: onlinePresence ? onlinePresence.positionY : row.positionY,
    }, {
      avatarId: row.avatarId || null,
      avatarImageUrl: row.avatarId ? (avatarMap.get(row.avatarId) || null) : null,
      avatarFrameId: row.avatarFrameId || null,
      avatarFrameImageUrl: row.avatarFrameId ? (avatarFrameMap.get(row.avatarFrameId) || null) : null,
    })];
  });
}

async function measureAsync<T>(loader: () => Promise<T>) {
  const startedAtMs = Date.now();
  const value = await loader();
  return {
    value,
    durationMs: Date.now() - startedAtMs,
  };
}

async function loadSharedStateUncached(params: {
  mapId: string;
  map: MapSceneHubRuntimeMap;
  reason: MapSceneSharedStateRefreshReason;
}): Promise<MapSceneSharedState> {
  const startedAtMs = Date.now();
  const [playersResult, npcsResult, monstersResult, opportunitiesResult] = await Promise.all([
    measureAsync(() => loadMapPlayers(params.mapId)),
    measureAsync(() => listMapSceneNpcsByMap(params.mapId)),
    measureAsync(() => listMapSceneMonsters({
      mapId: params.mapId,
      map: {
        id: params.map.id,
        width: params.map.width,
        height: params.map.height,
        tilesData: params.map.tilesData,
      },
    })),
    measureAsync(() => listActiveOpportunitiesByMap(params.mapId)),
  ]);
  const playersInMap = playersResult.value;
  const npcs = npcsResult.value;
  const monsters = monstersResult.value;
  const opportunities = opportunitiesResult.value;

  const durationMs = Date.now() - startedAtMs;
  if (durationMs >= MAP_SCENE_SHARED_STATE_SLOW_LOAD_MS) {
    pushRuntimePerformanceEvent({
      level: "warn",
      source: "map-scene-hub",
      type: "shared_state_slow_load",
      message: "地图共享态加载耗时偏高",
      data: {
        mapId: params.mapId,
        reason: params.reason,
        durationMs,
        playersLoadMs: playersResult.durationMs,
        npcsLoadMs: npcsResult.durationMs,
        monstersLoadMs: monstersResult.durationMs,
        opportunitiesLoadMs: opportunitiesResult.durationMs,
        playerCount: playersInMap.length,
        npcCount: npcs.length,
        monsterCount: monsters.length,
        opportunityCount: opportunities.length,
      },
    });
    console.warn("[map-scene-hub] slow shared state load", {
      mapId: params.mapId,
      reason: params.reason,
      durationMs,
      playersLoadMs: playersResult.durationMs,
      npcsLoadMs: npcsResult.durationMs,
      monstersLoadMs: monstersResult.durationMs,
      opportunitiesLoadMs: opportunitiesResult.durationMs,
      playerCount: playersInMap.length,
      npcCount: npcs.length,
      monsterCount: monsters.length,
      opportunityCount: opportunities.length,
    });
  }

  return {
    mapId: params.mapId,
    players: playersInMap,
    npcs,
    monsters,
    opportunities: pruneExpiredOpportunities(opportunities),
    updatedAtMs: Date.now(),
  };
}

function getLatestAccessAtMs(entry: MapSceneSharedStateCacheEntry | undefined) {
  return Math.max(
    Number(entry?.lastAccessedAtMs || 0),
    Number(entry?.lastSocketAccessAtMs || 0),
  );
}

function shouldKeepMapSceneProactiveRefresh(
  entry: MapSceneSharedStateCacheEntry | undefined,
  nowMs: number,
) {
  if (!entry) {
    return false;
  }

  if (getLatestAccessAtMs(entry) + MAP_SCENE_SHARED_STATE_RECENT_ACCESS_WINDOW_MS < nowMs) {
    return false;
  }

  const playerCount = Array.isArray(entry.value?.players) ? entry.value.players.length : 0;
  if (playerCount > 0) {
    return true;
  }

  return Number(entry.lastSocketAccessAtMs || 0) + MAP_SCENE_SHARED_STATE_RECENT_ACCESS_WINDOW_MS >= nowMs;
}

function clearRefreshTimer(entry: MapSceneSharedStateCacheEntry | undefined) {
  if (!entry?.refreshTimer) {
    return;
  }
  clearTimeout(entry.refreshTimer);
}

function upsertPlayer(playersInMap: MapScenePlayer[], player: MapScenePlayer) {
  const nextPlayers = playersInMap.filter((current) => current.id !== player.id);
  nextPlayers.push(player);
  return nextPlayers;
}

function applyPresenceToSharedState(
  state: MapSceneSharedState,
  message: MapPresenceMessage,
): MapSceneSharedState | null {
  const normalizedState = pruneExpiredOpportunitiesFromSharedState(state);
  if (message.type === "player_position") {
    const nextPlayer: MapScenePlayer = {
      id: message.data.id,
      name: message.data.name || "无名",
      gender: message.data.gender,
      avatarImageUrl: message.data.avatarImageUrl || null,
      avatarFrameImageUrl: message.data.avatarFrameImageUrl || null,
      realm: message.data.realm,
      realmMajor: message.data.realmMajor,
      realmMinor: message.data.realmMinor,
      realmName: message.data.realmName || "凡人",
      positionX: message.data.positionX,
      positionY: message.data.positionY,
    };

    if (message.data.mapId === normalizedState.mapId) {
      return {
        ...normalizedState,
        players: upsertPlayer(normalizedState.players, nextPlayer),
        updatedAtMs: Date.now(),
      };
    }

    if (message.data.prevMapId === normalizedState.mapId) {
      return {
        ...normalizedState,
        players: normalizedState.players.filter((player) => player.id !== message.data.id),
        updatedAtMs: Date.now(),
      };
    }

    return normalizedState;
  }

  if (message.type === "monster_position" && message.data.mapId === normalizedState.mapId) {
    return {
      ...normalizedState,
      monsters: normalizedState.monsters.map((monster) => (
        monster.id === message.data.id
          ? {
            ...monster,
            positionX: message.data.positionX,
            positionY: message.data.positionY,
          }
          : monster
      )),
      updatedAtMs: Date.now(),
    };
  }

  if (message.type === "opportunity_spawned" && message.data.mapId === normalizedState.mapId) {
    const nextOpportunity: MapSceneOpportunity = {
      spawnId: message.data.spawnId,
      eventId: message.data.eventId,
      name: message.data.name,
      iconImageUrl: message.data.iconImageUrl || null,
      minRealm: message.data.minRealm,
      maxRealm: message.data.maxRealm,
      positionX: message.data.positionX,
      positionY: message.data.positionY,
      expiresAt: message.data.expiresAt,
    };
    return {
      ...normalizedState,
      opportunities: [
        ...normalizedState.opportunities.filter((item) => item.spawnId !== message.data.spawnId),
        nextOpportunity,
      ],
      updatedAtMs: Date.now(),
    };
  }

  if (message.type === "opportunity_claimed" && message.data.mapId === normalizedState.mapId) {
    return {
      ...normalizedState,
      opportunities: normalizedState.opportunities.filter((item) => item.spawnId !== message.data.spawnId),
      updatedAtMs: Date.now(),
    };
  }

  if (
    (message.type === "secret_realm_changed" || message.type === "map_refresh")
    && message.data.mapId === normalizedState.mapId
  ) {
    return null;
  }

  return normalizedState;
}

function bindPresenceSubscription(mapId: string) {
  const cache = getMapSceneSharedStateCache();
  const existing = cache.get(mapId);
  if (!existing || existing.unsubscribe) {
    return;
  }

  const unsubscribe = subscribeMapPresenceForMap(mapId, (message) => {
    const latest = cache.get(mapId);
    if (!latest) {
      return;
    }

    if (!latest.value) {
      return;
    }

    const invalidationReason = message.type === "map_refresh"
      ? "map_refresh"
      : message.type === "secret_realm_changed"
        ? "secret_realm_changed"
        : null;
    const nextValue = applyPresenceToSharedState(latest.value, message);
    if (!nextValue) {
      if (!latest.map || !invalidationReason) {
        clearRefreshTimer(latest);
        cache.set(mapId, {
          ...latest,
          promise: null,
          value: null,
          expiresAtMs: 0,
          refreshTimer: null,
          lastRefreshReason: invalidationReason,
        });
        return;
      }

      void queueMapSceneSharedStateRefresh({
        mapId,
        map: latest.map,
        force: true,
        reason: invalidationReason,
      }).catch((error) => {
        pushRuntimePerformanceEvent({
          level: "error",
          source: "map-scene-hub",
          type: "forced_refresh_failed",
          message: "地图共享态强制刷新失败",
          data: {
            mapId,
            reason: invalidationReason,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        console.error("[map-scene-hub] forced refresh failed", {
          mapId,
          reason: invalidationReason,
          error,
        });
      });
      return;
    }

    cache.set(mapId, {
      ...latest,
      value: nextValue,
      expiresAtMs: Date.now() + MAP_SCENE_SHARED_STATE_TTL_MS,
      lastRefreshReason: latest.lastRefreshReason,
    });
    scheduleMapSceneSharedStateRefresh(mapId);
  });

  cache.set(mapId, {
    ...existing,
    unsubscribe,
  });
}

function scheduleMapSceneSharedStateRefresh(mapId: string) {
  const cache = getMapSceneSharedStateCache();
  const entry = cache.get(mapId);
  if (!entry?.map || !entry.value) {
    return;
  }

  clearRefreshTimer(entry);

  const delayMs = Math.max(
    1_000,
    Number(entry.expiresAtMs || 0) - Date.now() - MAP_SCENE_SHARED_STATE_REFRESH_AHEAD_MS,
  );
  const refreshTimer = setTimeout(() => {
    const latest = cache.get(mapId);
    if (!latest) {
      return;
    }

    cache.set(mapId, {
      ...latest,
      refreshTimer: null,
    });

    if (!shouldKeepMapSceneProactiveRefresh(latest, Date.now())) {
      return;
    }

    void enqueueMapSceneSharedStateProactiveRefresh({
      mapId,
      map: latest.map,
    }).catch((error) => {
      pushRuntimePerformanceEvent({
        level: "error",
        source: "map-scene-hub",
        type: "proactive_refresh_failed",
        message: "地图共享态主动刷新失败",
        data: {
          mapId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      console.error("[map-scene-hub] proactive refresh failed", {
        mapId,
        error,
      });
    });
  }, delayMs);

  if (typeof refreshTimer.unref === "function") {
    refreshTimer.unref();
  }

  cache.set(mapId, {
    ...entry,
    refreshTimer,
  });
}

async function queueMapSceneSharedStateRefreshDirect(params: {
  mapId: string;
  map: MapSceneHubRuntimeMap;
  force?: boolean;
  reason: MapSceneSharedStateRefreshReason;
}): Promise<MapSceneSharedState> {
  const cache = getMapSceneSharedStateCache();
  const nowMs = Date.now();
  const cached = cache.get(params.mapId);
  if (cached?.promise) {
    recordSharedStateRequest({
      warmHit: Boolean(cached?.value),
      staleServed: isSharedStateStaleReusable(cached, nowMs),
      reason: cached?.value ? "ttl_expired" : "initial",
    });
    return await cached.promise;
  }

  const retainedValue = params.force ? null : cached?.value || null;
  const retainedExpiryMs = retainedValue ? Number(cached?.expiresAtMs || 0) : 0;

  const loadPromise = (async () => {
    try {
      const value = await loadSharedStateUncached({
        mapId: params.mapId,
        map: params.map,
        reason: params.reason,
      });
      const latest = cache.get(params.mapId);
      cache.set(params.mapId, {
        promise: null,
        value,
        expiresAtMs: Date.now() + MAP_SCENE_SHARED_STATE_TTL_MS,
        map: params.map,
        unsubscribe: latest?.unsubscribe || null,
        refreshTimer: latest?.refreshTimer || null,
        lastAccessedAtMs: Math.max(nowMs, Number(latest?.lastAccessedAtMs || 0)),
        lastSocketAccessAtMs: Number(latest?.lastSocketAccessAtMs || 0),
        lastRefreshReason: params.reason,
      });
      bindPresenceSubscription(params.mapId);
      scheduleMapSceneSharedStateRefresh(params.mapId);
      return value;
    } catch (error) {
      const latest = cache.get(params.mapId);
      if (retainedValue || latest?.value) {
        cache.set(params.mapId, {
          promise: null,
          value: retainedValue || latest?.value || null,
          expiresAtMs: Date.now() + MAP_SCENE_SHARED_STATE_RETRY_TTL_MS,
          map: params.map,
          unsubscribe: latest?.unsubscribe || null,
          refreshTimer: latest?.refreshTimer || null,
          lastAccessedAtMs: Math.max(nowMs, Number(latest?.lastAccessedAtMs || 0)),
          lastSocketAccessAtMs: Number(latest?.lastSocketAccessAtMs || 0),
          lastRefreshReason: params.reason,
        });
        scheduleMapSceneSharedStateRefresh(params.mapId);
      } else {
        clearRefreshTimer(latest);
        cache.set(params.mapId, {
          promise: null,
          value: null,
          expiresAtMs: retainedExpiryMs,
          map: params.map,
          unsubscribe: latest?.unsubscribe || null,
          refreshTimer: null,
          lastAccessedAtMs: Math.max(nowMs, Number(latest?.lastAccessedAtMs || 0)),
          lastSocketAccessAtMs: Number(latest?.lastSocketAccessAtMs || 0),
          lastRefreshReason: params.reason,
        });
      }
      throw error;
    }
  })();

  cache.set(params.mapId, {
    promise: loadPromise,
    value: retainedValue,
    expiresAtMs: retainedExpiryMs,
    map: params.map,
    unsubscribe: cached?.unsubscribe || null,
    refreshTimer: cached?.refreshTimer || null,
    lastAccessedAtMs: Math.max(nowMs, Number(cached?.lastAccessedAtMs || 0)),
    lastSocketAccessAtMs: Number(cached?.lastSocketAccessAtMs || 0),
    lastRefreshReason: params.reason,
  });

  return await loadPromise;
}

async function runMapSceneSharedStateProactiveRefreshTask(
  task: MapSceneSharedStateProactiveRefreshTask,
) {
  const cache = getMapSceneSharedStateCache();
  const latest = cache.get(task.mapId);
  const nowMs = Date.now();

  if (latest?.promise) {
    return await latest.promise;
  }

  if (latest?.value && latest.expiresAtMs > nowMs + MAP_SCENE_SHARED_STATE_REFRESH_AHEAD_MS) {
    return latest.value;
  }

  if (latest?.value && !shouldKeepMapSceneProactiveRefresh(latest, nowMs)) {
    return latest.value;
  }

  return await queueMapSceneSharedStateRefreshDirect({
    mapId: task.mapId,
    map: task.map,
    reason: "proactive",
  });
}

function drainMapSceneSharedStateProactiveRefreshQueue() {
  const proactiveState = getMapSceneSharedStateProactiveRefreshState();
  while (
    proactiveState.activeCount < MAP_SCENE_SHARED_STATE_PROACTIVE_MAX_CONCURRENCY
    && proactiveState.queue.length > 0
  ) {
    const task = proactiveState.queue.shift();
    if (!task) {
      continue;
    }

    proactiveState.activeCount += 1;
    void runMapSceneSharedStateProactiveRefreshTask(task)
      .then((value) => {
        for (const waiter of task.waiters) {
          waiter.resolve(value);
        }
      })
      .catch((error) => {
        for (const waiter of task.waiters) {
          waiter.reject(error);
        }
      })
      .finally(() => {
        proactiveState.requestsByMap.delete(task.mapId);
        proactiveState.activeCount = Math.max(0, proactiveState.activeCount - 1);
        drainMapSceneSharedStateProactiveRefreshQueue();
      });
  }
}

function enqueueMapSceneSharedStateProactiveRefresh(params: {
  mapId: string;
  map: MapSceneHubRuntimeMap;
}) {
  const proactiveState = getMapSceneSharedStateProactiveRefreshState();
  const existing = proactiveState.requestsByMap.get(params.mapId);
  if (existing) {
    existing.map = params.map;
    return new Promise<MapSceneSharedState>((resolve, reject) => {
      existing.waiters.push({ resolve, reject });
    });
  }

  return new Promise<MapSceneSharedState>((resolve, reject) => {
    const task: MapSceneSharedStateProactiveRefreshTask = {
      mapId: params.mapId,
      map: params.map,
      enqueuedAtMs: Date.now(),
      waiters: [{ resolve, reject }],
    };
    proactiveState.requestsByMap.set(params.mapId, task);
    proactiveState.queue.push(task);
    drainMapSceneSharedStateProactiveRefreshQueue();
  });
}

export async function queueMapSceneSharedStateRefresh(params: {
  mapId: string;
  map: MapSceneHubRuntimeMap;
  force?: boolean;
  reason?: MapSceneSharedStateRefreshReason;
}): Promise<MapSceneSharedState> {
  const normalizedMapId = params.mapId.trim();
  const reason = params.reason || "proactive";
  if (!normalizedMapId) {
    throw new Error("mapId is required for map scene shared state refresh.");
  }

  const cache = getMapSceneSharedStateCache();
  const cached = cache.get(normalizedMapId);
  if (cached?.promise) {
    return await cached.promise;
  }

  if (reason === "proactive") {
    return await enqueueMapSceneSharedStateProactiveRefresh({
      mapId: normalizedMapId,
      map: params.map,
    });
  }

  return await queueMapSceneSharedStateRefreshDirect({
    mapId: normalizedMapId,
    map: params.map,
    force: params.force,
    reason,
  });
}

export async function getMapSceneSharedState(params: {
  mapId: string;
  map: MapSceneHubRuntimeMap;
}): Promise<MapSceneSharedState> {
  const cache = getMapSceneSharedStateCache();
  const nowMs = Date.now();
  const cached = cache.get(params.mapId);

  if (cached) {
    cache.set(params.mapId, {
      ...cached,
      map: params.map,
      lastAccessedAtMs: nowMs,
    });
  }

  if (cached?.value && cached.expiresAtMs > nowMs) {
    const nextValue = normalizeSharedStateValue(cached.value, nowMs) ?? cached.value;
    if (nextValue !== cached.value) {
      cache.set(params.mapId, {
        ...cached,
        value: nextValue,
        lastAccessedAtMs: nowMs,
      });
    }
    recordSharedStateRequest({
      warmHit: true,
      reason: "initial",
    });
    return nextValue;
  }
  if (cached?.promise) {
    return await cached.promise;
  }

  if (isSharedStateStaleReusable(cached, nowMs)) {
    const nextValue = normalizeSharedStateValue(cached?.value, nowMs) ?? cached!.value!;
    cache.set(params.mapId, {
      ...cached!,
      value: nextValue,
      lastAccessedAtMs: nowMs,
    });
    recordSharedStateRequest({
      warmHit: true,
      staleServed: true,
      reason: "ttl_expired",
    });
    void queueMapSceneSharedStateRefreshDirect({
      mapId: params.mapId,
      map: params.map,
      force: false,
      reason: "ttl_expired",
    }).catch(() => {
      // stale-while-refresh 保留旧值兜底，后台刷新失败时交给现有事件日志处理。
    });
    return nextValue!;
  }

  recordSharedStateRequest({
    warmHit: false,
    reason: cached?.value ? "ttl_expired" : "initial",
  });

  return await queueMapSceneSharedStateRefresh({
    mapId: params.mapId,
    map: params.map,
    force: !cached?.value,
    reason: cached?.value ? "ttl_expired" : "initial",
  });
}

export function invalidateMapSceneSharedState(mapId: string) {
  const cache = getMapSceneSharedStateCache();
  const cached = cache.get(mapId);
  if (!cached) {
    return;
  }
  clearRefreshTimer(cached);
  cache.set(mapId, {
    ...cached,
    promise: null,
    value: null,
    expiresAtMs: 0,
    refreshTimer: null,
  });
}

export async function warmMapSceneSharedStateForMapId(params: {
  mapId: string;
  force?: boolean;
  reason?: Extract<MapSceneSharedStateRefreshReason, "player_transition" | "proactive">;
}) {
  const normalizedMapId = params.mapId.trim();
  if (!normalizedMapId) {
    return null;
  }

  const reason = params.reason || "player_transition";
  if (reason === "player_transition" && !MAP_SHARED_STATE_TRANSITION_WARM_ENABLED) {
    return null;
  }

  const runtimeMap = await getRuntimeMapById(normalizedMapId);
  if (!runtimeMap) {
    return null;
  }

  const normalizedMap: MapSceneHubRuntimeMap = {
    id: runtimeMap.id,
    width: runtimeMap.width,
    height: runtimeMap.height,
    tilesData: runtimeMap.tilesData,
  };
  const cache = getMapSceneSharedStateCache();
  const nowMs = Date.now();
  const cached = cache.get(normalizedMapId);

  if (cached) {
    cache.set(normalizedMapId, {
      ...cached,
      map: normalizedMap,
      lastAccessedAtMs: nowMs,
    });
  }

  if (!params.force && cached?.value && cached.expiresAtMs > nowMs) {
    const sharedState = normalizeSharedStateValue(cached.value, nowMs);
    if (sharedState !== cached.value) {
      cache.set(normalizedMapId, {
        ...cached,
        map: normalizedMap,
        value: sharedState,
        lastAccessedAtMs: nowMs,
      });
    }
    recordSharedStateRequest({
      warmHit: true,
      reason,
    });
    return {
      sharedState: sharedState!,
      map: normalizedMap,
    };
  }

  if (!params.force && cached?.promise) {
    recordSharedStateRequest({
      warmHit: Boolean(cached?.value),
      staleServed: isSharedStateStaleReusable(cached, nowMs),
      reason,
    });
    const sharedState = await cached.promise;
    return {
      sharedState,
      map: normalizedMap,
    };
  }

  if (!params.force && isSharedStateStaleReusable(cached, nowMs)) {
    const sharedState = normalizeSharedStateValue(cached?.value, nowMs);
    cache.set(normalizedMapId, {
      ...cached!,
      map: normalizedMap,
      value: sharedState,
      lastAccessedAtMs: nowMs,
    });
    recordSharedStateRequest({
      warmHit: true,
      staleServed: true,
      reason,
    });
    void queueMapSceneSharedStateRefreshDirect({
      mapId: normalizedMapId,
      map: normalizedMap,
      force: false,
      reason,
    }).catch(() => {
      // stale-while-refresh 已经把旧值交付出去，这里只保留后台刷新。
    });
    return {
      sharedState: sharedState!,
      map: normalizedMap,
    };
  }

  if (!cached?.promise) {
    recordSharedStateRequest({
      warmHit: false,
      reason,
    });
  }

  const sharedState = await queueMapSceneSharedStateRefresh({
    mapId: normalizedMapId,
    map: normalizedMap,
    force: params.force,
    reason,
  });

  return {
    sharedState,
    map: normalizedMap,
  };
}

function registerMapSceneHubRuntimeBridge() {
  const globalStore = globalThis as MapSceneHubGlobal;
  globalStore.__mapSceneHubRuntimeBridge = {
    ...(globalStore.__mapSceneHubRuntimeBridge || {}),
    warmSharedStateByMapId: warmMapSceneSharedStateForMapId,
  };
}

registerMapSceneHubRuntimeBridge();
