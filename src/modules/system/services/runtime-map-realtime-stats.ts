type MapRealtimeTransportKind = "ws" | "sse";
type MapRealtimeSyncUpdateSource = "direct" | "watcher" | "idle";
type MapRealtimeSyncPollMode = "active" | "idle";
export type MapRealtimeWatcherReason =
  | "connection_gap_unrepairable"
  | "idle_subscription_stale"
  | "shared_state_miss_after_bootstrap";
export type MapRealtimeTransportFallbackReason =
  | "client_no_ws"
  | "ws_upgrade_failed"
  | "codec_negotiation_failed"
  | "bridge_downgrade"
  | "explicit_client_no_ws"
  | "unknown";

type MapRealtimeSyncWatcherReasonBucket = {
  count: number;
  watcherLagTotalMs: number;
  watcherLagMaxMs: number;
};

type MapRealtimeSyncBucket = {
  directUpdates: number;
  watcherRefreshes: number;
  idleRefreshes: number;
  activePollChecks: number;
  idlePollChecks: number;
  watcherLagTotalMs: number;
  watcherLagMaxMs: number;
  watcherReasons: Partial<Record<MapRealtimeWatcherReason, MapRealtimeSyncWatcherReasonBucket>>;
};

type MapRealtimeTransportStats = {
  wsSceneOpens: number;
  sseFallbackOpens: number;
  sseFallbackReasons: Partial<Record<MapRealtimeTransportFallbackReason, number>>;
};

type RuntimeMapRealtimeSyncStatsStore = {
  total: MapRealtimeSyncBucket;
  byTransport: Record<MapRealtimeTransportKind, MapRealtimeSyncBucket>;
  transport: MapRealtimeTransportStats;
};

type RuntimeMapRealtimeSyncStatsGlobal = typeof globalThis & {
  __mapRealtimeSyncStats?: RuntimeMapRealtimeSyncStatsStore;
};

export type RuntimeMapRealtimeSyncBucketSnapshot = MapRealtimeSyncBucket & {
  totalRefreshes: number;
  directHitRate: number;
  watcherShare: number;
  avgWatcherLagMs: number;
  watcherReasonBreakdown: Array<{
    reason: MapRealtimeWatcherReason;
    count: number;
    avgLagMs: number;
    maxLagMs: number;
  }>;
};

export type RuntimeMapRealtimeSyncStatsSnapshot = {
  total: RuntimeMapRealtimeSyncBucketSnapshot;
  byTransport: Record<MapRealtimeTransportKind, RuntimeMapRealtimeSyncBucketSnapshot>;
  transport: {
    wsSceneOpens: number;
    sseFallbackOpens: number;
    totalSceneOpens: number;
    wsSceneRatio: number;
    sseFallbackRatio: number;
    sseFallbackReasonBreakdown: Array<{
      reason: MapRealtimeTransportFallbackReason;
      count: number;
    }>;
  };
};

function getRuntimeGlobalStore() {
  return globalThis as RuntimeMapRealtimeSyncStatsGlobal;
}

function createBucket(): MapRealtimeSyncBucket {
  return {
    directUpdates: 0,
    watcherRefreshes: 0,
    idleRefreshes: 0,
    activePollChecks: 0,
    idlePollChecks: 0,
    watcherLagTotalMs: 0,
    watcherLagMaxMs: 0,
    watcherReasons: {},
  };
}

function createTransportStats(): MapRealtimeTransportStats {
  return {
    wsSceneOpens: 0,
    sseFallbackOpens: 0,
    sseFallbackReasons: {},
  };
}

function getStore() {
  const globalStore = getRuntimeGlobalStore();
  if (!globalStore.__mapRealtimeSyncStats) {
    globalStore.__mapRealtimeSyncStats = {
      total: createBucket(),
      byTransport: {
        ws: createBucket(),
        sse: createBucket(),
      },
      transport: createTransportStats(),
    };
  }
  if (!globalStore.__mapRealtimeSyncStats.transport) {
    globalStore.__mapRealtimeSyncStats.transport = createTransportStats();
  }
  for (const bucket of [
    globalStore.__mapRealtimeSyncStats.total,
    globalStore.__mapRealtimeSyncStats.byTransport.ws,
    globalStore.__mapRealtimeSyncStats.byTransport.sse,
  ]) {
    if (!bucket.watcherReasons) {
      bucket.watcherReasons = {};
    }
  }
  return globalStore.__mapRealtimeSyncStats;
}

function toSafeInt(value: number | null | undefined) {
  const nextValue = Math.floor(Number(value || 0));
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function toRoundedRate(value: number) {
  return Number(value.toFixed(4));
}

function normalizeWatcherReason(reason: unknown): MapRealtimeWatcherReason {
  if (reason === "connection_gap_unrepairable") {
    return "connection_gap_unrepairable";
  }
  if (reason === "shared_state_miss_after_bootstrap") {
    return "shared_state_miss_after_bootstrap";
  }
  return "idle_subscription_stale";
}

function normalizeTransportFallbackReason(reason: unknown): MapRealtimeTransportFallbackReason {
  if (reason === "client_no_ws") {
    return "client_no_ws";
  }
  if (reason === "ws_upgrade_failed") {
    return "ws_upgrade_failed";
  }
  if (reason === "codec_negotiation_failed") {
    return "codec_negotiation_failed";
  }
  if (reason === "bridge_downgrade") {
    return "bridge_downgrade";
  }
  if (reason === "explicit_client_no_ws") {
    return "explicit_client_no_ws";
  }
  return "unknown";
}

function applyDeliverySample(params: {
  bucket: MapRealtimeSyncBucket;
  source: MapRealtimeSyncUpdateSource;
  watcherLagMs?: number;
  watcherReason?: MapRealtimeWatcherReason;
}) {
  if (params.source === "direct") {
    params.bucket.directUpdates += 1;
    return;
  }

  if (params.source === "idle") {
    params.bucket.idleRefreshes += 1;
    return;
  }

  params.bucket.watcherRefreshes += 1;
  const watcherLagMs = toSafeInt(params.watcherLagMs);
  const watcherReason = normalizeWatcherReason(params.watcherReason);
  const watcherReasonBucket = params.bucket.watcherReasons[watcherReason] || {
    count: 0,
    watcherLagTotalMs: 0,
    watcherLagMaxMs: 0,
  };
  watcherReasonBucket.count += 1;
  if (watcherLagMs > 0) {
    params.bucket.watcherLagTotalMs += watcherLagMs;
    params.bucket.watcherLagMaxMs = Math.max(params.bucket.watcherLagMaxMs, watcherLagMs);
    watcherReasonBucket.watcherLagTotalMs += watcherLagMs;
    watcherReasonBucket.watcherLagMaxMs = Math.max(
      watcherReasonBucket.watcherLagMaxMs,
      watcherLagMs,
    );
  }
  params.bucket.watcherReasons[watcherReason] = watcherReasonBucket;
}

function applyPollSample(params: {
  bucket: MapRealtimeSyncBucket;
  mode: MapRealtimeSyncPollMode;
}) {
  if (params.mode === "active") {
    params.bucket.activePollChecks += 1;
    return;
  }
  params.bucket.idlePollChecks += 1;
}

function buildBucketSnapshot(bucket: MapRealtimeSyncBucket): RuntimeMapRealtimeSyncBucketSnapshot {
  const directUpdates = toSafeInt(bucket.directUpdates);
  const watcherRefreshes = toSafeInt(bucket.watcherRefreshes);
  const idleRefreshes = toSafeInt(bucket.idleRefreshes);
  const activePollChecks = toSafeInt(bucket.activePollChecks);
  const idlePollChecks = toSafeInt(bucket.idlePollChecks);
  const watcherLagTotalMs = toSafeInt(bucket.watcherLagTotalMs);
  const watcherLagMaxMs = toSafeInt(bucket.watcherLagMaxMs);
  const totalRefreshes = directUpdates + watcherRefreshes + idleRefreshes;
  const trackedRealtimeRefreshes = directUpdates + watcherRefreshes;
  const watcherReasonBreakdown = Object.entries(bucket.watcherReasons || {})
    .map(([reason, value]) => {
      const count = toSafeInt(value?.count);
      const lagTotalMs = toSafeInt(value?.watcherLagTotalMs);
      const lagMaxMs = toSafeInt(value?.watcherLagMaxMs);
      return {
        reason: normalizeWatcherReason(reason),
        count,
        avgLagMs: count > 0 ? Math.round(lagTotalMs / count) : 0,
        maxLagMs: lagMaxMs,
      };
    })
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);

  return {
    directUpdates,
    watcherRefreshes,
    idleRefreshes,
    activePollChecks,
    idlePollChecks,
    watcherLagTotalMs,
    watcherLagMaxMs,
    watcherReasons: bucket.watcherReasons || {},
    totalRefreshes,
    directHitRate: trackedRealtimeRefreshes > 0
      ? toRoundedRate(directUpdates / trackedRealtimeRefreshes)
      : 0,
    watcherShare: trackedRealtimeRefreshes > 0
      ? toRoundedRate(watcherRefreshes / trackedRealtimeRefreshes)
      : 0,
    avgWatcherLagMs: watcherRefreshes > 0
      ? Math.round(watcherLagTotalMs / watcherRefreshes)
      : 0,
    watcherReasonBreakdown,
  };
}

export function recordMapRealtimeSyncDelivery(params: {
  transport: MapRealtimeTransportKind;
  source: MapRealtimeSyncUpdateSource;
  watcherLagMs?: number;
  watcherReason?: MapRealtimeWatcherReason;
}) {
  const store = getStore();
  applyDeliverySample({
    bucket: store.total,
    source: params.source,
    watcherLagMs: params.watcherLagMs,
    watcherReason: params.watcherReason,
  });
  applyDeliverySample({
    bucket: store.byTransport[params.transport],
    source: params.source,
    watcherLagMs: params.watcherLagMs,
    watcherReason: params.watcherReason,
  });
}

export function recordMapRealtimeSyncPoll(params: {
  transport: MapRealtimeTransportKind;
  mode: MapRealtimeSyncPollMode;
}) {
  const store = getStore();
  applyPollSample({
    bucket: store.total,
    mode: params.mode,
  });
  applyPollSample({
    bucket: store.byTransport[params.transport],
    mode: params.mode,
  });
}

export function recordMapRealtimeTransportOpen(params: {
  transport: MapRealtimeTransportKind;
  fallbackReason?: MapRealtimeTransportFallbackReason;
}) {
  const store = getStore();
  if (params.transport === "ws") {
    store.transport.wsSceneOpens += 1;
    return;
  }

  store.transport.sseFallbackOpens += 1;
  const reason = normalizeTransportFallbackReason(params.fallbackReason);
  store.transport.sseFallbackReasons[reason] = toSafeInt(store.transport.sseFallbackReasons[reason]) + 1;
}

export function collectRuntimeMapRealtimeSyncStatsSnapshot(): RuntimeMapRealtimeSyncStatsSnapshot {
  const store = getStore();
  const wsSceneOpens = toSafeInt(store.transport.wsSceneOpens);
  const sseFallbackOpens = toSafeInt(store.transport.sseFallbackOpens);
  const totalSceneOpens = wsSceneOpens + sseFallbackOpens;
  return {
    total: buildBucketSnapshot(store.total),
    byTransport: {
      ws: buildBucketSnapshot(store.byTransport.ws),
      sse: buildBucketSnapshot(store.byTransport.sse),
    },
    transport: {
      wsSceneOpens,
      sseFallbackOpens,
      totalSceneOpens,
      wsSceneRatio: totalSceneOpens > 0 ? toRoundedRate(wsSceneOpens / totalSceneOpens) : 0,
      sseFallbackRatio: totalSceneOpens > 0 ? toRoundedRate(sseFallbackOpens / totalSceneOpens) : 0,
      sseFallbackReasonBreakdown: Object.entries(store.transport.sseFallbackReasons || {})
        .map(([reason, count]) => ({
          reason: normalizeTransportFallbackReason(reason),
          count: toSafeInt(count),
        }))
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count),
    },
  };
}
