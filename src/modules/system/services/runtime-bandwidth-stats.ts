type RealtimeTransportKind = "ws" | "sse";

type RealtimeBandwidthBucket = {
  totalMessages: number;
  fullMessages: number;
  deltaMessages: number;
  totalBytes: number;
  fullBytes: number;
  deltaBytes: number;
  potentialFullBytes: number;
  savedBytesEstimate: number;
};

type HttpCacheBandwidthBucket = {
  totalAssetRequests: number;
  notModifiedHits: number;
  bytesServed: number;
  servedResponses: number;
};

type RuntimeBandwidthStatsStore = {
  realtime: RealtimeBandwidthBucket;
  realtimeByTransport: Record<RealtimeTransportKind, RealtimeBandwidthBucket>;
  httpCache: HttpCacheBandwidthBucket;
};

type RuntimeBandwidthStatsGlobal = typeof globalThis & {
  __runtimeBandwidthStats?: RuntimeBandwidthStatsStore;
  __runtimeRealtimePayloadBaselineBytes?: WeakMap<object, number>;
};

export type RuntimeBandwidthStatsSnapshot = {
  realtime: RealtimeBandwidthBucket & {
    avgPayloadBytes: number;
    deltaHitRate: number;
    bandwidthHitRate: number;
  };
  realtimeByTransport: Record<
    RealtimeTransportKind,
    RealtimeBandwidthBucket & {
      avgPayloadBytes: number;
      deltaHitRate: number;
      bandwidthHitRate: number;
    }
  >;
  httpCache: HttpCacheBandwidthBucket & {
    notModifiedHitRate: number;
    avgResponseBytes: number;
  };
};

function getRuntimeGlobalStore() {
  return globalThis as RuntimeBandwidthStatsGlobal;
}

function createRealtimeBandwidthBucket(): RealtimeBandwidthBucket {
  return {
    totalMessages: 0,
    fullMessages: 0,
    deltaMessages: 0,
    totalBytes: 0,
    fullBytes: 0,
    deltaBytes: 0,
    potentialFullBytes: 0,
    savedBytesEstimate: 0,
  };
}

function createHttpCacheBandwidthBucket(): HttpCacheBandwidthBucket {
  return {
    totalAssetRequests: 0,
    notModifiedHits: 0,
    bytesServed: 0,
    servedResponses: 0,
  };
}

function getRuntimeBandwidthStatsStore() {
  const globalStore = getRuntimeGlobalStore();
  if (!globalStore.__runtimeBandwidthStats) {
    globalStore.__runtimeBandwidthStats = {
      realtime: createRealtimeBandwidthBucket(),
      realtimeByTransport: {
        ws: createRealtimeBandwidthBucket(),
        sse: createRealtimeBandwidthBucket(),
      },
      httpCache: createHttpCacheBandwidthBucket(),
    };
  }
  return globalStore.__runtimeBandwidthStats;
}

function getRealtimePayloadBaselineStore() {
  const globalStore = getRuntimeGlobalStore();
  if (!globalStore.__runtimeRealtimePayloadBaselineBytes) {
    globalStore.__runtimeRealtimePayloadBaselineBytes = new WeakMap<object, number>();
  }
  return globalStore.__runtimeRealtimePayloadBaselineBytes;
}

function toSafeInt(value: number | null | undefined) {
  const nextValue = Math.floor(Number(value || 0));
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function toRoundedRate(value: number) {
  return Number(value.toFixed(4));
}

function buildRealtimeBucketSnapshot(bucket: RealtimeBandwidthBucket) {
  const totalMessages = toSafeInt(bucket.totalMessages);
  const totalBytes = toSafeInt(bucket.totalBytes);
  const potentialFullBytes = toSafeInt(bucket.potentialFullBytes);
  const savedBytesEstimate = Math.min(
    toSafeInt(bucket.savedBytesEstimate),
    potentialFullBytes,
  );

  return {
    totalMessages,
    fullMessages: toSafeInt(bucket.fullMessages),
    deltaMessages: toSafeInt(bucket.deltaMessages),
    totalBytes,
    fullBytes: toSafeInt(bucket.fullBytes),
    deltaBytes: toSafeInt(bucket.deltaBytes),
    potentialFullBytes,
    savedBytesEstimate,
    avgPayloadBytes: totalMessages > 0 ? Math.round(totalBytes / totalMessages) : 0,
    deltaHitRate: totalMessages > 0 ? toRoundedRate(toSafeInt(bucket.deltaMessages) / totalMessages) : 0,
    bandwidthHitRate: potentialFullBytes > 0 ? toRoundedRate(savedBytesEstimate / potentialFullBytes) : 0,
  };
}

function buildHttpCacheBucketSnapshot(bucket: HttpCacheBandwidthBucket) {
  const totalAssetRequests = toSafeInt(bucket.totalAssetRequests);
  const servedResponses = toSafeInt(bucket.servedResponses);
  const bytesServed = toSafeInt(bucket.bytesServed);

  return {
    totalAssetRequests,
    notModifiedHits: toSafeInt(bucket.notModifiedHits),
    bytesServed,
    servedResponses,
    notModifiedHitRate: totalAssetRequests > 0
      ? toRoundedRate(toSafeInt(bucket.notModifiedHits) / totalAssetRequests)
      : 0,
    avgResponseBytes: servedResponses > 0 ? Math.round(bytesServed / servedResponses) : 0,
  };
}

function applyRealtimeBandwidthSample(params: {
  bucket: RealtimeBandwidthBucket;
  mode: "full" | "delta";
  bytes: number;
  baselineBytes: number;
}) {
  const nextBytes = toSafeInt(params.bytes);
  const nextBaselineBytes = Math.max(nextBytes, toSafeInt(params.baselineBytes));
  const savedBytes = Math.max(nextBaselineBytes - nextBytes, 0);

  params.bucket.totalMessages += 1;
  params.bucket.totalBytes += nextBytes;
  params.bucket.potentialFullBytes += nextBaselineBytes;
  params.bucket.savedBytesEstimate += savedBytes;

  if (params.mode === "delta") {
    params.bucket.deltaMessages += 1;
    params.bucket.deltaBytes += nextBytes;
    return;
  }

  params.bucket.fullMessages += 1;
  params.bucket.fullBytes += nextBytes;
}

export function rememberRealtimePayloadBaseline(payload: unknown, baselineBytes: number) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const nextBaselineBytes = toSafeInt(baselineBytes);
  if (nextBaselineBytes < 1) {
    return;
  }
  getRealtimePayloadBaselineStore().set(payload, nextBaselineBytes);
}

export function recordRealtimeTransportPayload(params: {
  transport: RealtimeTransportKind;
  payload: unknown;
  bytes: number;
}) {
  const payload = params.payload as {
    type?: string;
    snapshot?: { mode?: "full" | "delta" | "sector_snapshot" | "sector_delta" };
  } | null;
  if (!payload || payload.type !== "scene_snapshot" || !payload.snapshot) {
    return;
  }

  const nextBytes = toSafeInt(params.bytes);
  if (nextBytes < 1) {
    return;
  }

  const store = getRuntimeBandwidthStatsStore();
  const mode = payload.snapshot.mode === "delta" || payload.snapshot.mode === "sector_delta"
    ? "delta"
    : "full";
  const baselineBytes = Math.max(
    nextBytes,
    toSafeInt(getRealtimePayloadBaselineStore().get(payload as object)),
  );

  applyRealtimeBandwidthSample({
    bucket: store.realtime,
    mode,
    bytes: nextBytes,
    baselineBytes,
  });
  applyRealtimeBandwidthSample({
    bucket: store.realtimeByTransport[params.transport],
    mode,
    bytes: nextBytes,
    baselineBytes,
  });
}

export function recordHttpAssetCacheResponse(params: {
  status: number;
  bytesServed?: number;
}) {
  const store = getRuntimeBandwidthStatsStore();
  store.httpCache.totalAssetRequests += 1;

  if (params.status === 304) {
    store.httpCache.notModifiedHits += 1;
    return;
  }

  const bytesServed = toSafeInt(params.bytesServed);
  if (params.status === 200 && bytesServed > 0) {
    store.httpCache.bytesServed += bytesServed;
    store.httpCache.servedResponses += 1;
  }
}

export function collectRuntimeBandwidthStatsSnapshot(): RuntimeBandwidthStatsSnapshot {
  const store = getRuntimeBandwidthStatsStore();
  return {
    realtime: buildRealtimeBucketSnapshot(store.realtime),
    realtimeByTransport: {
      ws: buildRealtimeBucketSnapshot(store.realtimeByTransport.ws),
      sse: buildRealtimeBucketSnapshot(store.realtimeByTransport.sse),
    },
    httpCache: buildHttpCacheBucketSnapshot(store.httpCache),
  };
}
