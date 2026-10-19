import { sql } from "drizzle-orm";
import { db } from "@/db";
import { collectMapPresenceSubscriptionStats } from "@/modules/map/services/map-presence";
import { collectReadModelCacheStatsSnapshot } from "@/modules/shared/services/read-model-cache";
import { collectRuntimePersistedStoreStats } from "@/modules/shared/services/runtime-persisted-store";
import { collectRuntimeBandwidthStatsSnapshot } from "@/modules/system/services/runtime-bandwidth-stats";
import { collectRuntimeCodecStatsSnapshot } from "@/modules/system/services/runtime-codec-stats.mjs";
import { collectRuntimeMapInteractionStatsSnapshot } from "@/modules/system/services/runtime-map-interaction-stats";
import { collectRuntimeMapRealtimeSyncStatsSnapshot } from "@/modules/system/services/runtime-map-realtime-stats";

export type RuntimePerformanceEvent = {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

type MapSceneSourceStatBucket = {
  hubHits: number;
  fallbackHits: number;
};

type MapSceneSourceStats = {
  hubHits?: number;
  fallbackHits?: number;
  lastLoggedAtMs?: number;
  lastLoggedTotal?: number;
  fallbackReasons?: Record<string, number>;
  coldFallbackReasons?: Record<string, number>;
  mapStats?: Record<string, MapSceneSourceStatBucket>;
  sharedStateRequests?: number;
  sharedStateWarmHits?: number;
  playerTransitionWarmHits?: number;
  staleServedWhileRefreshCount?: number;
  coldFallbackCount?: number;
  firstFrameBootstrapTotalMs?: number;
  firstFrameBootstrapMaxMs?: number;
  firstFrameBootstrapSamples?: number;
};

type MapSceneVisibilityStats = {
  samples?: number;
  entityCounts?: Partial<Record<"player" | "npc" | "monster" | "opportunity", number>>;
};

type InternalJsonRequestStats = {
  totalRequests?: number;
  slowRequests?: number;
  failedRequests?: number;
  nonOkResponses?: number;
  lastDurationMs?: number;
  lastStatus?: number | null;
  lastFailureAtMs?: number;
  lastSlowAtMs?: number;
  slowByPath?: Record<string, number>;
  failedByPath?: Record<string, number>;
  nonOkByPath?: Record<string, number>;
};

type SharedStateCacheEntry = {
  promise?: Promise<unknown> | null;
  value?: {
    players?: unknown[];
    npcs?: unknown[];
    monsters?: unknown[];
    opportunities?: unknown[];
    updatedAtMs?: number;
  } | null;
  expiresAtMs?: number;
  lastAccessedAtMs?: number;
  lastSocketAccessAtMs?: number;
  lastRefreshReason?: string | null;
};

type SceneContextCacheEntry = {
  promise?: Promise<unknown> | null;
  value?: unknown;
  expiresAtMs?: number;
  lastAccessedAtMs?: number;
};

type RuntimePerformanceGlobal = typeof globalThis & {
  __runtimePerformanceEvents?: RuntimePerformanceEvent[];
  __mapSceneSourceStats?: MapSceneSourceStats;
  __mapSceneVisibilityStats?: MapSceneVisibilityStats;
  __internalJsonRequestStats?: InternalJsonRequestStats;
  __mapSceneSharedStateCache?: Map<string, SharedStateCacheEntry>;
  __mapSceneContextCache?: Map<string, SceneContextCacheEntry>;
  __mapSocketPlayerStateCache?: Map<string, { expiresAtMs?: number }>;
  __runtimePerformanceSnapshotCache?: {
    value: RuntimePerformanceSnapshot | null;
    expiresAtMs: number;
    promise: Promise<RuntimePerformanceSnapshot> | null;
  };
};

export type RuntimeHealthSnapshot = {
  generatedAt: string;
  status: "ok" | "degraded";
  uptimeSec: number;
  pid: number;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    heapUsageRate: number;
  };
  eventLoop: {
    userCpuTimeMs: number;
    systemCpuTimeMs: number;
    maxRssBytes: number;
  };
  db: {
    checked: boolean;
    ok: boolean;
    pingMs: number | null;
    error: string | null;
  };
};

type RuntimeCodecStatsBucketSnapshot = {
  messages: number;
  binaryMessages: number;
  textMessages: number;
  transportBytes: number;
  jsonBytes: number;
  savedBytes: number;
  compressionRate: number;
  binaryShare: number;
  encodeCount: number;
  encodeMsTotal: number;
  encodeMsMax: number;
  avgEncodeMs: number;
  encodeMsP95: number;
  decodeCount: number;
  decodeMsTotal: number;
  decodeMsMax: number;
  avgDecodeMs: number;
  decodeMsP95: number;
  serializeCount: number;
  serializeMsTotal: number;
  serializeMsMax: number;
  avgSerializeMs: number;
  serializeMsP95: number;
};

export type RuntimePerformanceSnapshot = RuntimeHealthSnapshot & {
  runtimeRoles: {
    bridgeLatencyMs: number | null;
    web: {
      ok: boolean;
      pid: number;
      uptimeSec: number;
      memory: {
        rssBytes: number;
        heapUsedBytes: number;
        heapTotalBytes: number;
      };
      cpu: {
        userCpuTimeMs: number;
        systemCpuTimeMs: number;
      };
    };
    realtime: {
      enabled: boolean;
      ok: boolean;
      pid: number | null;
      uptimeSec: number | null;
      port: number | null;
      memory: {
        rssBytes: number;
        heapUsedBytes: number;
        heapTotalBytes: number;
      } | null;
      cpu: {
        userCpuTimeMs: number;
        systemCpuTimeMs: number;
      } | null;
      error: string | null;
    };
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    databasePoolMax: number;
    nodeOptions: string;
    persistence: {
      activeRuntimeBaseDir: string | null;
      checkpointNamespaceCount: number;
      checkpointEntryCount: number;
      pendingNamespaceFlushes: number;
      runtimePersistDisabled: boolean;
    };
    readModelCache: {
      groups: Array<{
        group: string;
        hits: number;
        misses: number;
        invalidations: number;
        hitRate: number;
      }>;
      totalHits: number;
      totalMisses: number;
      totalInvalidations: number;
      totalHitRate: number;
    };
  };
  bandwidth: {
    realtime: {
      totalMessages: number;
      fullMessages: number;
      deltaMessages: number;
      totalBytes: number;
      fullBytes: number;
      deltaBytes: number;
      potentialFullBytes: number;
      savedBytesEstimate: number;
      avgPayloadBytes: number;
      deltaHitRate: number;
      bandwidthHitRate: number;
    };
    realtimeByTransport: {
      ws: {
        totalMessages: number;
        fullMessages: number;
        deltaMessages: number;
        totalBytes: number;
        fullBytes: number;
        deltaBytes: number;
        potentialFullBytes: number;
        savedBytesEstimate: number;
        avgPayloadBytes: number;
        deltaHitRate: number;
        bandwidthHitRate: number;
      };
      sse: {
        totalMessages: number;
        fullMessages: number;
        deltaMessages: number;
        totalBytes: number;
        fullBytes: number;
        deltaBytes: number;
        potentialFullBytes: number;
        savedBytesEstimate: number;
        avgPayloadBytes: number;
        deltaHitRate: number;
        bandwidthHitRate: number;
      };
    };
    httpCache: {
      totalAssetRequests: number;
      notModifiedHits: number;
      bytesServed: number;
      servedResponses: number;
      notModifiedHitRate: number;
      avgResponseBytes: number;
    };
  };
  codec: {
    total: RuntimeCodecStatsBucketSnapshot;
    byTransport: {
      ws: RuntimeCodecStatsBucketSnapshot;
      sse: RuntimeCodecStatsBucketSnapshot;
    };
    byCodec: {
      json: RuntimeCodecStatsBucketSnapshot;
      msgpack: RuntimeCodecStatsBucketSnapshot;
    };
    byScene: {
      map: RuntimeCodecStatsBucketSnapshot;
      combat: RuntimeCodecStatsBucketSnapshot;
      boss: RuntimeCodecStatsBucketSnapshot;
      unknown: RuntimeCodecStatsBucketSnapshot;
    };
    fallbackReasons: Array<{ reason: string; count: number }>;
  };
  mapScene: {
    interaction: {
      ack: {
        total: number;
        accepted: number;
        rejected: number;
        resyncRequired: number;
        durationTotalMs: number;
        durationMaxMs: number;
        correctionDistanceTotal: number;
        smallCorrections: number;
        smoothCorrections: number;
        snapCorrections: number;
        acceptedRate: number;
        avgDurationMs: number;
        avgCorrectionDistance: number;
      };
      silentRefresh: {
        total: number;
        reasons: Array<{ reason: string; count: number }>;
      };
    };
    realtimeSync: {
      total: {
        directUpdates: number;
        watcherRefreshes: number;
        idleRefreshes: number;
        activePollChecks: number;
        idlePollChecks: number;
        watcherLagTotalMs: number;
        watcherLagMaxMs: number;
        totalRefreshes: number;
        directHitRate: number;
        watcherShare: number;
        avgWatcherLagMs: number;
        watcherReasonBreakdown: Array<{
          reason: string;
          count: number;
          avgLagMs: number;
          maxLagMs: number;
        }>;
      };
      byTransport: {
        ws: {
          directUpdates: number;
          watcherRefreshes: number;
          idleRefreshes: number;
          activePollChecks: number;
          idlePollChecks: number;
          watcherLagTotalMs: number;
          watcherLagMaxMs: number;
          totalRefreshes: number;
          directHitRate: number;
          watcherShare: number;
          avgWatcherLagMs: number;
          watcherReasonBreakdown: Array<{
            reason: string;
            count: number;
            avgLagMs: number;
            maxLagMs: number;
          }>;
        };
        sse: {
          directUpdates: number;
          watcherRefreshes: number;
          idleRefreshes: number;
          activePollChecks: number;
          idlePollChecks: number;
          watcherLagTotalMs: number;
          watcherLagMaxMs: number;
          totalRefreshes: number;
          directHitRate: number;
          watcherShare: number;
          avgWatcherLagMs: number;
          watcherReasonBreakdown: Array<{
            reason: string;
            count: number;
            avgLagMs: number;
            maxLagMs: number;
          }>;
        };
      };
      transport: {
        wsSceneOpens: number;
        sseFallbackOpens: number;
        totalSceneOpens: number;
        wsSceneRatio: number;
        sseFallbackRatio: number;
        sseFallbackReasonBreakdown: Array<{ reason: string; count: number }>;
      };
    };
    source: {
      total: number;
      hubHits: number;
      fallbackHits: number;
      hubHitRate: number;
      fallbackReasons: Array<{ reason: string; count: number }>;
      coldFallbackCount: number;
      coldFallbackReasons: Array<{ reason: string; count: number }>;
      sharedStateRequests: number;
      sharedStateWarmHits: number;
      sharedStateWarmHitRate: number;
      playerTransitionWarmHits: number;
      staleServedWhileRefreshCount: number;
      firstFrameBootstrapLatencyMs: number;
      firstFrameBootstrapMaxLatencyMs: number;
      topMaps: Array<{ mapId: string; hubHits: number; fallbackHits: number; total: number }>;
    };
    internalJson: {
      totalRequests: number;
      slowRequests: number;
      failedRequests: number;
      nonOkResponses: number;
      lastDurationMs: number;
      lastStatus: number | null;
      slowPaths: Array<{ path: string; count: number }>;
      failedPaths: Array<{ path: string; count: number }>;
      nonOkPaths: Array<{ path: string; count: number }>;
    };
    caches: {
      sharedStateCacheSize: number;
      sharedStateWarmCount: number;
      sharedStateLoadingCount: number;
      sceneContextCacheSize: number;
      sceneContextHotCount: number;
      socketPlayerCacheSize: number;
    };
    aoi: {
      tileSize: number;
      preloadRings: number;
      activeAreaKeyCount: number;
      activeAreaSubscriberCount: number;
      routedMessages: number;
      deliveredMessages: number;
      deliveryHitRate: number;
      topMaps: Array<{
        mapId: string;
        areaKeyCount: number;
        subscriberCount: number;
        signalSubscriberCount: number;
      }>;
    };
    visibility: {
      samples: number;
      filteredEntityCounts: {
        player: number;
        npc: number;
        monster: number;
        opportunity: number;
      };
    };
    sharedMaps: Array<{
      mapId: string;
      playerCount: number;
      npcCount: number;
      monsterCount: number;
      opportunityCount: number;
      updatedAt: string | null;
      expiresInMs: number;
      lastAccessAgoMs: number;
      lastSocketAccessAgoMs: number;
      lastRefreshReason: string | null;
    }>;
  };
  recentEvents: RuntimePerformanceEvent[];
};

type InternalRealtimePerformancePayload = Pick<
  RuntimePerformanceSnapshot,
  "bandwidth" | "codec" | "mapScene" | "recentEvents"
> & {
  generatedAt?: string;
};

const RUNTIME_EVENT_BUFFER_LIMIT = 200;
const RUNTIME_PERFORMANCE_CACHE_TTL_MS = Math.max(
  0,
  Math.floor(Number(process.env.RUNTIME_PERFORMANCE_CACHE_TTL_MS || 1000) || 1000),
);
const REALTIME_INTERNAL_FETCH_TIMEOUT_MS = Math.max(
  250,
  Math.floor(Number(process.env.REALTIME_INTERNAL_FETCH_TIMEOUT_MS || 1500) || 1500),
);

function toNumber(value: unknown) {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function toRoundedRate(value: number) {
  return Number(value.toFixed(4));
}

function safeRecordEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [] as Array<[string, number]>;
  }
  return Object.entries(value).map(([key, count]) => [key, toNumber(count)] as [string, number]);
}

function sortCountEntries(value: unknown, limit = 8, keyName = "key", valueName = "count") {
  return safeRecordEntries(value)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({
      [keyName]: key,
      [valueName]: count,
    })) as Array<{ [key: string]: string | number }>;
}

function getRuntimeGlobalStore() {
  return globalThis as RuntimePerformanceGlobal;
}

function getRuntimePerformanceSnapshotCache() {
  const globalStore = getRuntimeGlobalStore();
  if (
    !globalStore.__runtimePerformanceSnapshotCache
    || typeof globalStore.__runtimePerformanceSnapshotCache !== "object"
  ) {
    globalStore.__runtimePerformanceSnapshotCache = {
      value: null,
      expiresAtMs: 0,
      promise: null,
    };
  }
  return globalStore.__runtimePerformanceSnapshotCache;
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit): Promise<{
  response: Response;
  json: T | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`fetch timeout after ${REALTIME_INTERNAL_FETCH_TIMEOUT_MS}ms`));
  }, REALTIME_INTERNAL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null) as T | null;
    return {
      response,
      json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function pushRuntimePerformanceEvent(event: Omit<RuntimePerformanceEvent, "id" | "at">) {
  const globalStore = getRuntimeGlobalStore();
  const buffer = Array.isArray(globalStore.__runtimePerformanceEvents)
    ? globalStore.__runtimePerformanceEvents
    : [];

  if (!Array.isArray(globalStore.__runtimePerformanceEvents)) {
    globalStore.__runtimePerformanceEvents = buffer;
  }

  buffer.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...event,
  });

  if (buffer.length > RUNTIME_EVENT_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - RUNTIME_EVENT_BUFFER_LIMIT);
  }
}

async function pingDatabase() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    return {
      checked: true,
      ok: true,
      pingMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      pingMs: null,
      error: error instanceof Error ? error.message : "数据库探活失败",
    };
  }
}

function readMemorySnapshot() {
  const usage = process.memoryUsage();
  const heapUsageRate = usage.heapTotal > 0 ? usage.heapUsed / usage.heapTotal : 0;

  return {
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    heapUsageRate: toRoundedRate(heapUsageRate),
  };
}

function readResourceUsageSnapshot() {
  const usage = process.resourceUsage();
  return {
    userCpuTimeMs: Math.round(usage.userCPUTime / 1000),
    systemCpuTimeMs: Math.round(usage.systemCPUTime / 1000),
    maxRssBytes: usage.maxRSS * 1024,
  };
}

export async function collectRuntimeHealthSnapshot(options?: {
  includeDb?: boolean;
}): Promise<RuntimeHealthSnapshot> {
  const dbSnapshot = options?.includeDb ? await pingDatabase() : {
    checked: false,
    ok: true,
    pingMs: null,
    error: null,
  };

  return {
    generatedAt: new Date().toISOString(),
    status: dbSnapshot.checked && !dbSnapshot.ok ? "degraded" : "ok",
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
    memory: readMemorySnapshot(),
    eventLoop: readResourceUsageSnapshot(),
    db: dbSnapshot,
  };
}

async function collectRuntimePerformanceSnapshotUncached(): Promise<RuntimePerformanceSnapshot> {
  const base = await collectRuntimeHealthSnapshot({ includeDb: true });
  const globalStore = getRuntimeGlobalStore();
  const bandwidth = collectRuntimeBandwidthStatsSnapshot();
  const codec = collectRuntimeCodecStatsSnapshot();
  const interaction = collectRuntimeMapInteractionStatsSnapshot();
  const realtimeSync = collectRuntimeMapRealtimeSyncStatsSnapshot();
  const persistenceStats = collectRuntimePersistedStoreStats();
  const readModelCacheGroups = collectReadModelCacheStatsSnapshot();
  const mapPresenceAoiStats = collectMapPresenceSubscriptionStats();
  const totalReadModelHits = readModelCacheGroups.reduce((sum, item) => sum + item.hits, 0);
  const totalReadModelMisses = readModelCacheGroups.reduce((sum, item) => sum + item.misses, 0);
  const totalReadModelInvalidations = readModelCacheGroups.reduce((sum, item) => sum + item.invalidations, 0);

  const sourceStats = globalStore.__mapSceneSourceStats || {};
  const internalJsonStats = globalStore.__internalJsonRequestStats || {};
  const sharedStateCache = globalStore.__mapSceneSharedStateCache instanceof Map
    ? globalStore.__mapSceneSharedStateCache
    : new Map<string, SharedStateCacheEntry>();
  const sceneContextCache = globalStore.__mapSceneContextCache instanceof Map
    ? globalStore.__mapSceneContextCache
    : new Map<string, SceneContextCacheEntry>();
  const socketPlayerCache = globalStore.__mapSocketPlayerStateCache instanceof Map
    ? globalStore.__mapSocketPlayerStateCache
    : new Map<string, { expiresAtMs?: number }>();
  const nowMs = Date.now();

  const hubHits = toNumber(sourceStats.hubHits);
  const fallbackHits = toNumber(sourceStats.fallbackHits);
  const total = hubHits + fallbackHits;
  const hubHitRate = total > 0 ? toRoundedRate(hubHits / total) : 0;

  const fallbackReasons = safeRecordEntries(sourceStats.fallbackReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason: String(reason), count: toNumber(count) }));
  const coldFallbackReasons = safeRecordEntries(sourceStats.coldFallbackReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason: String(reason), count: toNumber(count) }));
  const sharedStateRequests = toNumber(sourceStats.sharedStateRequests);
  const sharedStateWarmHits = toNumber(sourceStats.sharedStateWarmHits);
  const playerTransitionWarmHits = toNumber(sourceStats.playerTransitionWarmHits);
  const staleServedWhileRefreshCount = toNumber(sourceStats.staleServedWhileRefreshCount);
  const coldFallbackCount = toNumber(sourceStats.coldFallbackCount);
  const firstFrameBootstrapSamples = toNumber(sourceStats.firstFrameBootstrapSamples);
  const firstFrameBootstrapTotalMs = toNumber(sourceStats.firstFrameBootstrapTotalMs);
  const firstFrameBootstrapMaxMs = toNumber(sourceStats.firstFrameBootstrapMaxMs);
  const visibilityStats = globalStore.__mapSceneVisibilityStats || {};
  const visibilityEntityCounts = visibilityStats.entityCounts || {};
  const visibilitySamples = toNumber(visibilityStats.samples);

  const topMaps = Object.keys(sourceStats.mapStats || {})
    .map((mapId) => {
      const bucket = (sourceStats.mapStats || {})[mapId] || { hubHits: 0, fallbackHits: 0 };
      const currentHubHits = toNumber(bucket.hubHits);
      const currentFallbackHits = toNumber(bucket.fallbackHits);
      return {
        mapId,
        hubHits: currentHubHits,
        fallbackHits: currentFallbackHits,
        total: currentHubHits + currentFallbackHits,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const sharedMaps = Array.from(sharedStateCache.entries())
    .map(([mapId, entry]) => ({
      mapId,
      playerCount: Array.isArray(entry.value?.players) ? entry.value.players.length : 0,
      npcCount: Array.isArray(entry.value?.npcs) ? entry.value.npcs.length : 0,
      monsterCount: Array.isArray(entry.value?.monsters) ? entry.value.monsters.length : 0,
      opportunityCount: Array.isArray(entry.value?.opportunities) ? entry.value.opportunities.length : 0,
      updatedAt: entry.value?.updatedAtMs ? new Date(entry.value.updatedAtMs).toISOString() : null,
      expiresInMs: Math.max(toNumber(entry.expiresAtMs) - nowMs, 0),
      lastAccessAgoMs: Math.max(nowMs - toNumber(entry.lastAccessedAtMs), 0),
      lastSocketAccessAgoMs: Math.max(nowMs - toNumber(entry.lastSocketAccessAtMs), 0),
      lastRefreshReason: entry.lastRefreshReason || null,
    }))
    .sort((a, b) => {
      const activeDelta = a.lastSocketAccessAgoMs - b.lastSocketAccessAgoMs;
      if (activeDelta !== 0) {
        return activeDelta;
      }
      return b.playerCount - a.playerCount;
    })
    .slice(0, 10);

  const sceneContextHotCount = Array.from(sceneContextCache.values())
    .filter((entry) => toNumber(entry.expiresAtMs) > nowMs)
    .length;
  const sharedStateWarmCount = Array.from(sharedStateCache.values())
    .filter((entry) => !!entry.value)
    .length;
  const sharedStateLoadingCount = Array.from(sharedStateCache.values())
    .filter((entry) => !!entry.promise)
    .length;

  const recentEvents = (Array.isArray(globalStore.__runtimePerformanceEvents)
    ? [...globalStore.__runtimePerformanceEvents]
    : [])
    .sort((a, b) => a.at < b.at ? 1 : -1)
    .slice(0, 50);

  const realtimeRuntimeEnabled = String(process.env.REALTIME_RUNTIME_ENABLED || "").trim() === "1";
  const realtimeRuntimePort = Number.parseInt(String(process.env.REALTIME_RUNTIME_PORT || "3101").trim(), 10) || 3101;
  const internalToken = String(process.env.REALTIME_INTERNAL_TOKEN || process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  const webRuntimeRole = {
    ok: base.status === "ok",
    pid: base.pid,
    uptimeSec: base.uptimeSec,
    memory: {
      rssBytes: base.memory.rssBytes,
      heapUsedBytes: base.memory.heapUsedBytes,
      heapTotalBytes: base.memory.heapTotalBytes,
    },
    cpu: {
      userCpuTimeMs: base.eventLoop.userCpuTimeMs,
      systemCpuTimeMs: base.eventLoop.systemCpuTimeMs,
    },
  };
  let bridgeLatencyMs: number | null = null;
  let realtimeRuntimeRole: RuntimePerformanceSnapshot["runtimeRoles"]["realtime"] = {
    enabled: realtimeRuntimeEnabled,
    ok: !realtimeRuntimeEnabled,
    pid: null,
    uptimeSec: null,
    port: realtimeRuntimeEnabled ? realtimeRuntimePort : null,
    memory: null,
    cpu: null,
      error: null,
    };
  let realtimePerformanceOverride: InternalRealtimePerformancePayload | null = null;

  if (realtimeRuntimeEnabled) {
    const startedAt = Date.now();
    try {
      const {
        response,
        json,
      } = await fetchJsonWithTimeout<{
        success?: boolean;
        data?: {
          ok?: boolean;
          pid?: number;
          uptimeSec?: number;
          port?: number;
          memory?: {
            rssBytes?: number;
            heapUsedBytes?: number;
            heapTotalBytes?: number;
          };
          cpu?: {
            userCpuTimeMs?: number;
            systemCpuTimeMs?: number;
          };
        };
        error?: string;
      }>(`http://127.0.0.1:${realtimeRuntimePort}/_internal/runtime/health`, {
        headers: {
          "x-internal-realtime-token": internalToken,
        },
        cache: "no-store",
      });
      bridgeLatencyMs = Math.max(Date.now() - startedAt, 0);
      const roleData = json?.data;
      realtimeRuntimeRole = {
        enabled: true,
        ok: response.ok && roleData?.ok === true,
        pid: typeof roleData?.pid === "number" ? roleData.pid : null,
        uptimeSec: typeof roleData?.uptimeSec === "number" ? roleData.uptimeSec : null,
        port: typeof roleData?.port === "number" ? roleData.port : realtimeRuntimePort,
        memory: roleData?.memory ? {
          rssBytes: toNumber(roleData.memory.rssBytes),
          heapUsedBytes: toNumber(roleData.memory.heapUsedBytes),
          heapTotalBytes: toNumber(roleData.memory.heapTotalBytes),
        } : null,
        cpu: roleData?.cpu ? {
          userCpuTimeMs: toNumber(roleData.cpu.userCpuTimeMs),
          systemCpuTimeMs: toNumber(roleData.cpu.systemCpuTimeMs),
        } : null,
        error: response.ok ? null : (json?.error || "realtime runtime unhealthy"),
      };
      if (response.ok && roleData?.ok === true) {
        try {
          const {
            response: performanceResponse,
            json: performanceJson,
          } = await fetchJsonWithTimeout<{
            success?: boolean;
            data?: InternalRealtimePerformancePayload;
          }>(`http://127.0.0.1:${realtimeRuntimePort}/_internal/runtime/performance`, {
            headers: {
              "x-internal-realtime-token": internalToken,
            },
            cache: "no-store",
          });
          if (performanceResponse.ok) {
            if (performanceJson?.success && performanceJson.data) {
              realtimePerformanceOverride = performanceJson.data;
            }
          }
        } catch {
          // 性能细项拉取失败时保留 web 本地指标，不把 realtime 子健康直接判死。
        }
      }
    } catch (error) {
      bridgeLatencyMs = Math.max(Date.now() - startedAt, 0);
      realtimeRuntimeRole = {
        enabled: true,
        ok: false,
        pid: null,
        uptimeSec: null,
        port: realtimeRuntimePort,
        memory: null,
        cpu: null,
        error: error instanceof Error ? error.message : "realtime runtime unavailable",
      };
    }
  }

  return {
    ...base,
    runtimeRoles: {
      bridgeLatencyMs,
      web: webRuntimeRole,
      realtime: realtimeRuntimeRole,
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      databasePoolMax: toNumber(process.env.DATABASE_POOL_MAX || 6),
      nodeOptions: String(process.env.NODE_OPTIONS || "").trim(),
      persistence: persistenceStats,
      readModelCache: {
        groups: readModelCacheGroups,
        totalHits: totalReadModelHits,
        totalMisses: totalReadModelMisses,
        totalInvalidations: totalReadModelInvalidations,
        totalHitRate: totalReadModelHits + totalReadModelMisses > 0
          ? toRoundedRate(totalReadModelHits / (totalReadModelHits + totalReadModelMisses))
          : 0,
      },
    },
    bandwidth: realtimePerformanceOverride?.bandwidth || bandwidth,
    codec: realtimePerformanceOverride?.codec || codec,
    mapScene: realtimePerformanceOverride?.mapScene || {
      interaction,
      realtimeSync,
      source: {
        total,
        hubHits,
        fallbackHits,
        hubHitRate,
        fallbackReasons,
        coldFallbackCount,
        coldFallbackReasons,
        sharedStateRequests,
        sharedStateWarmHits,
        sharedStateWarmHitRate: sharedStateRequests > 0
          ? toRoundedRate(sharedStateWarmHits / sharedStateRequests)
          : 0,
        playerTransitionWarmHits,
        staleServedWhileRefreshCount,
        firstFrameBootstrapLatencyMs: firstFrameBootstrapSamples > 0
          ? Math.round(firstFrameBootstrapTotalMs / firstFrameBootstrapSamples)
          : 0,
        firstFrameBootstrapMaxLatencyMs: firstFrameBootstrapMaxMs,
        topMaps,
      },
      internalJson: {
        totalRequests: toNumber(internalJsonStats.totalRequests),
        slowRequests: toNumber(internalJsonStats.slowRequests),
        failedRequests: toNumber(internalJsonStats.failedRequests),
        nonOkResponses: toNumber(internalJsonStats.nonOkResponses),
        lastDurationMs: toNumber(internalJsonStats.lastDurationMs),
        lastStatus: internalJsonStats.lastStatus ?? null,
        slowPaths: sortCountEntries(internalJsonStats.slowByPath, 8, "path", "count") as Array<{ path: string; count: number }>,
        failedPaths: sortCountEntries(internalJsonStats.failedByPath, 8, "path", "count") as Array<{ path: string; count: number }>,
        nonOkPaths: sortCountEntries(internalJsonStats.nonOkByPath, 8, "path", "count") as Array<{ path: string; count: number }>,
      },
      caches: {
        sharedStateCacheSize: sharedStateCache.size,
        sharedStateWarmCount,
        sharedStateLoadingCount,
        sceneContextCacheSize: sceneContextCache.size,
        sceneContextHotCount,
        socketPlayerCacheSize: socketPlayerCache.size,
      },
      aoi: mapPresenceAoiStats,
      visibility: {
        samples: visibilitySamples,
        filteredEntityCounts: {
          player: visibilitySamples > 0 ? Math.round(toNumber(visibilityEntityCounts.player) / visibilitySamples) : 0,
          npc: visibilitySamples > 0 ? Math.round(toNumber(visibilityEntityCounts.npc) / visibilitySamples) : 0,
          monster: visibilitySamples > 0 ? Math.round(toNumber(visibilityEntityCounts.monster) / visibilitySamples) : 0,
          opportunity: visibilitySamples > 0 ? Math.round(toNumber(visibilityEntityCounts.opportunity) / visibilitySamples) : 0,
        },
      },
      sharedMaps,
    },
    recentEvents: realtimePerformanceOverride?.recentEvents || recentEvents,
  };
}

export async function collectRuntimePerformanceSnapshot(): Promise<RuntimePerformanceSnapshot> {
  if (RUNTIME_PERFORMANCE_CACHE_TTL_MS < 1) {
    return collectRuntimePerformanceSnapshotUncached();
  }

  const cache = getRuntimePerformanceSnapshotCache();
  const nowMs = Date.now();
  if (cache.value && cache.expiresAtMs > nowMs) {
    return cache.value;
  }
  if (cache.promise) {
    return cache.promise;
  }

  cache.promise = collectRuntimePerformanceSnapshotUncached()
    .then((snapshot) => {
      cache.value = snapshot;
      cache.expiresAtMs = Date.now() + RUNTIME_PERFORMANCE_CACHE_TTL_MS;
      return snapshot;
    })
    .finally(() => {
      cache.promise = null;
    });

  return cache.promise;
}
