function createCodecStatsBucket() {
  return {
    messages: 0,
    binaryMessages: 0,
    textMessages: 0,
    transportBytes: 0,
    jsonBytes: 0,
    savedBytes: 0,
    encodeCount: 0,
    encodeMsTotal: 0,
    encodeMsMax: 0,
    decodeCount: 0,
    decodeMsTotal: 0,
    decodeMsMax: 0,
    serializeCount: 0,
    serializeMsTotal: 0,
    serializeMsMax: 0,
    encodeSamples: [],
    decodeSamples: [],
    serializeSamples: [],
  };
}

function getCodecStatsGlobal() {
  const globalStore = globalThis;
  if (!globalStore.__runtimeCodecStats || typeof globalStore.__runtimeCodecStats !== "object") {
    globalStore.__runtimeCodecStats = {
      total: createCodecStatsBucket(),
      byTransport: {
        ws: createCodecStatsBucket(),
        sse: createCodecStatsBucket(),
      },
      byCodec: {
        json: createCodecStatsBucket(),
        msgpack: createCodecStatsBucket(),
      },
      byScene: {
        map: createCodecStatsBucket(),
        combat: createCodecStatsBucket(),
        boss: createCodecStatsBucket(),
        unknown: createCodecStatsBucket(),
      },
      fallbackReasons: {},
    };
  }
  return globalStore.__runtimeCodecStats;
}

function normalizeDuration(value) {
  const nextValue = Number(value || 0);
  return Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : 0;
}

function normalizePositiveInt(value) {
  const nextValue = Math.floor(Number(value || 0));
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function applyCodecTransportSample(bucket, params) {
  bucket.messages += 1;
  bucket.transportBytes += normalizePositiveInt(params.transportBytes);
  bucket.jsonBytes += normalizePositiveInt(params.jsonBytes);
  bucket.savedBytes += Math.max(
    normalizePositiveInt(params.jsonBytes) - normalizePositiveInt(params.transportBytes),
    0,
  );
  if (params.binary) {
    bucket.binaryMessages += 1;
  } else {
    bucket.textMessages += 1;
  }
}

function applyEncodeSample(bucket, params) {
  applyCodecTransportSample(bucket, params);
  bucket.encodeCount += 1;
  const encodeMs = normalizeDuration(params.encodeMs);
  bucket.encodeMsTotal += encodeMs;
  bucket.encodeMsMax = Math.max(bucket.encodeMsMax, encodeMs);
  if (params.serializeMeasured !== false) {
    bucket.serializeCount += 1;
  }
  const serializeMs = normalizeDuration(params.serializeMs);
  if (params.serializeMeasured !== false) {
    bucket.serializeMsTotal += serializeMs;
    bucket.serializeMsMax = Math.max(bucket.serializeMsMax, serializeMs);
  }
  bucket.encodeSamples.push(encodeMs);
  if (bucket.encodeSamples.length > 512) {
    bucket.encodeSamples.splice(0, bucket.encodeSamples.length - 512);
  }
  if (params.serializeMeasured !== false) {
    bucket.serializeSamples.push(serializeMs);
    if (bucket.serializeSamples.length > 512) {
      bucket.serializeSamples.splice(0, bucket.serializeSamples.length - 512);
    }
  }
}

function applyDecodeSample(bucket, params) {
  applyCodecTransportSample(bucket, params);
  bucket.decodeCount += 1;
  const decodeMs = normalizeDuration(params.decodeMs);
  bucket.decodeMsTotal += decodeMs;
  bucket.decodeMsMax = Math.max(bucket.decodeMsMax, decodeMs);
  bucket.decodeSamples.push(decodeMs);
  if (bucket.decodeSamples.length > 512) {
    bucket.decodeSamples.splice(0, bucket.decodeSamples.length - 512);
  }
}

function percentileFromSamples(samples, percentile) {
  if (!Array.isArray(samples) || samples.length < 1) {
    return 0;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(
    sorted.length - 1,
    Math.ceil((percentile / 100) * sorted.length) - 1,
  ));
  return normalizeDuration(sorted[index]);
}

function buildBucketSnapshot(bucket) {
  const messages = normalizePositiveInt(bucket.messages);
  const binaryMessages = normalizePositiveInt(bucket.binaryMessages);
  const transportBytes = normalizePositiveInt(bucket.transportBytes);
  const jsonBytes = normalizePositiveInt(bucket.jsonBytes);
  const savedBytes = Math.min(
    normalizePositiveInt(bucket.savedBytes),
    jsonBytes,
  );
  const encodeCount = normalizePositiveInt(bucket.encodeCount);
  const decodeCount = normalizePositiveInt(bucket.decodeCount);
  const serializeCount = normalizePositiveInt(bucket.serializeCount);

  return {
    messages,
    binaryMessages,
    textMessages: normalizePositiveInt(bucket.textMessages),
    transportBytes,
    jsonBytes,
    savedBytes,
    compressionRate: jsonBytes > 0 ? Number((savedBytes / jsonBytes).toFixed(4)) : 0,
    binaryShare: messages > 0 ? Number((binaryMessages / messages).toFixed(4)) : 0,
    encodeCount,
    encodeMsTotal: Number(normalizeDuration(bucket.encodeMsTotal).toFixed(4)),
    encodeMsMax: Number(normalizeDuration(bucket.encodeMsMax).toFixed(4)),
    avgEncodeMs: encodeCount > 0 ? Number((normalizeDuration(bucket.encodeMsTotal) / encodeCount).toFixed(4)) : 0,
    encodeMsP95: Number(percentileFromSamples(bucket.encodeSamples, 95).toFixed(4)),
    decodeCount,
    decodeMsTotal: Number(normalizeDuration(bucket.decodeMsTotal).toFixed(4)),
    decodeMsMax: Number(normalizeDuration(bucket.decodeMsMax).toFixed(4)),
    avgDecodeMs: decodeCount > 0 ? Number((normalizeDuration(bucket.decodeMsTotal) / decodeCount).toFixed(4)) : 0,
    decodeMsP95: Number(percentileFromSamples(bucket.decodeSamples, 95).toFixed(4)),
    serializeCount,
    serializeMsTotal: Number(normalizeDuration(bucket.serializeMsTotal).toFixed(4)),
    serializeMsMax: Number(normalizeDuration(bucket.serializeMsMax).toFixed(4)),
    avgSerializeMs: serializeCount > 0 ? Number((normalizeDuration(bucket.serializeMsTotal) / serializeCount).toFixed(4)) : 0,
    serializeMsP95: Number(percentileFromSamples(bucket.serializeSamples, 95).toFixed(4)),
  };
}

export function recordRuntimeCodecEncodeSample(params) {
  const codec = params?.codec === "msgpack" ? "msgpack" : "json";
  const transport = params?.transport === "sse" ? "sse" : "ws";
  const sceneType = params?.sceneType === "map" || params?.sceneType === "combat" || params?.sceneType === "boss"
    ? params.sceneType
    : "unknown";
  const store = getCodecStatsGlobal();
  const normalizedParams = {
    binary: params?.binary === true,
    transportBytes: params?.transportBytes,
    jsonBytes: params?.jsonBytes,
    encodeMs: params?.encodeMs,
    serializeMs: params?.serializeMs,
    serializeMeasured: params?.serializeMeasured !== false,
  };
  applyEncodeSample(store.total, normalizedParams);
  applyEncodeSample(store.byTransport[transport], normalizedParams);
  applyEncodeSample(store.byCodec[codec], normalizedParams);
  applyEncodeSample(store.byScene[sceneType], normalizedParams);
  if (typeof params?.fallbackReason === "string" && params.fallbackReason.trim()) {
    store.fallbackReasons[params.fallbackReason.trim()] = normalizePositiveInt(store.fallbackReasons[params.fallbackReason.trim()]) + 1;
  }
}

export function recordRuntimeCodecDecodeSample(params) {
  const codec = params?.codec === "msgpack" ? "msgpack" : "json";
  const transport = params?.transport === "sse" ? "sse" : "ws";
  const sceneType = params?.sceneType === "map" || params?.sceneType === "combat" || params?.sceneType === "boss"
    ? params.sceneType
    : "unknown";
  const store = getCodecStatsGlobal();
  const normalizedParams = {
    binary: params?.binary === true,
    transportBytes: params?.transportBytes,
    jsonBytes: params?.jsonBytes,
    decodeMs: params?.decodeMs,
  };
  applyDecodeSample(store.total, normalizedParams);
  applyDecodeSample(store.byTransport[transport], normalizedParams);
  applyDecodeSample(store.byCodec[codec], normalizedParams);
  applyDecodeSample(store.byScene[sceneType], normalizedParams);
  if (typeof params?.fallbackReason === "string" && params.fallbackReason.trim()) {
    store.fallbackReasons[params.fallbackReason.trim()] = normalizePositiveInt(store.fallbackReasons[params.fallbackReason.trim()]) + 1;
  }
}

export function collectRuntimeCodecStatsSnapshot() {
  const store = getCodecStatsGlobal();
  return {
    total: buildBucketSnapshot(store.total),
    byTransport: {
      ws: buildBucketSnapshot(store.byTransport.ws),
      sse: buildBucketSnapshot(store.byTransport.sse),
    },
    byCodec: {
      json: buildBucketSnapshot(store.byCodec.json),
      msgpack: buildBucketSnapshot(store.byCodec.msgpack),
    },
    byScene: {
      map: buildBucketSnapshot(store.byScene.map),
      combat: buildBucketSnapshot(store.byScene.combat),
      boss: buildBucketSnapshot(store.byScene.boss),
      unknown: buildBucketSnapshot(store.byScene.unknown),
    },
    fallbackReasons: Object.entries(store.fallbackReasons || {})
      .map(([reason, count]) => ({ reason, count: normalizePositiveInt(count) }))
      .sort((left, right) => right.count - left.count),
  };
}
