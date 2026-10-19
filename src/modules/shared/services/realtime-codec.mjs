import {
  packBattleSceneSnapshotForWire,
  packMapSceneSnapshotForWire,
  unpackBattleSceneSnapshotFromWire,
  unpackMapSceneSnapshotFromWire,
} from "./realtime-scene-schema.mjs";

export const REALTIME_CODEC_JSON = "json";
export const REALTIME_CODEC_MSGPACK = "msgpack";
export const REALTIME_CODEC_PACKET_KIND_MAP_SCENE = "map_scene_snapshot_v1";
export const REALTIME_CODEC_PACKET_KIND_BATTLE_SCENE = "battle_scene_snapshot_v1";

function parseEnvFloat(name, fallbackValue, minValue = 0, maxValue = 1) {
  const rawValue = Number.parseFloat(String(process.env[name] || "").trim());
  if (!Number.isFinite(rawValue)) {
    return fallbackValue;
  }
  return Math.min(maxValue, Math.max(minValue, rawValue));
}

const REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE = parseEnvFloat(
  "REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE",
  0.1,
  0,
  1,
);

let msgpackLoadError = null;
let msgpackUnavailableWarned = false;

const msgpackRuntimeModule = await import("@msgpack/msgpack").catch((error) => {
  msgpackLoadError = error;
  return null;
});

const encodeMessagePack = typeof msgpackRuntimeModule?.encode === "function"
  ? msgpackRuntimeModule.encode
  : null;
const decodeMessagePack = typeof msgpackRuntimeModule?.decode === "function"
  ? msgpackRuntimeModule.decode
  : null;

function isMsgpackRuntimeAvailable() {
  return Boolean(encodeMessagePack && decodeMessagePack);
}

function warnMsgpackUnavailable(reason) {
  if (msgpackUnavailableWarned || isMsgpackRuntimeAvailable()) {
    return;
  }
  msgpackUnavailableWarned = true;
  const details = msgpackLoadError instanceof Error
    ? msgpackLoadError.message
    : String(msgpackLoadError || "unknown error");
  console.warn(
    `[realtime-codec] MessagePack unavailable during ${reason}, fallback to JSON. ${details}`,
  );
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createTextEncoder() {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder();
  }
  return {
    encode(value) {
      return Buffer.from(String(value), "utf8");
    },
  };
}

const textEncoder = createTextEncoder();

function createTextDecoder() {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8");
  }
  return {
    decode(value) {
      return Buffer.from(value).toString("utf8");
    },
  };
}

const textDecoder = createTextDecoder();

function getRealtimePayloadEncodeCache() {
  const globalStore = globalThis;
  if (!(globalStore.__realtimePayloadEncodeCache instanceof WeakMap)) {
    globalStore.__realtimePayloadEncodeCache = new WeakMap();
  }
  return globalStore.__realtimePayloadEncodeCache;
}

function getCachedEncodedRealtimePayload(payload, codec) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const payloadCache = getRealtimePayloadEncodeCache().get(payload);
  if (!payloadCache || typeof payloadCache !== "object") {
    return null;
  }
  return payloadCache[codec] || null;
}

function setCachedEncodedRealtimePayload(payload, codec, value) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const cache = getRealtimePayloadEncodeCache();
  const payloadCache = cache.get(payload) || {};
  payloadCache[codec] = value;
  cache.set(payload, payloadCache);
}

function measureJsonSerialization(payload) {
  const startedAt = nowMs();
  const serialized = JSON.stringify(payload);
  return {
    serialized,
    serializeMs: nowMs() - startedAt,
    jsonBytes: textEncoder.encode(serialized).byteLength,
  };
}

function estimateSampledMetric(value, sampleWeight) {
  const normalizedValue = Number(value || 0);
  const normalizedWeight = Number(sampleWeight || 0);
  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return 0;
  }
  if (!Number.isFinite(normalizedWeight) || normalizedWeight <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(normalizedValue * normalizedWeight));
}

function takeJsonBaselineSample() {
  if (REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE >= 1) {
    return {
      measured: true,
      weight: 1,
    };
  }
  if (REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE <= 0) {
    return {
      measured: false,
      weight: 0,
    };
  }
  if (Math.random() < REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE) {
    return {
      measured: true,
      weight: 1 / REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE,
    };
  }
  return {
    measured: false,
    weight: 0,
  };
}

function buildJsonBaselineEstimate(payload) {
  const sample = takeJsonBaselineSample();
  if (!sample.measured) {
    return {
      jsonBytes: 0,
      serializeMs: 0,
      serializeMeasured: false,
      jsonBaselineSampled: false,
      jsonBaselineSampleRate: REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE,
    };
  }

  const measuredJson = measureJsonSerialization(payload);
  return {
    jsonBytes: estimateSampledMetric(measuredJson.jsonBytes, sample.weight),
    serializeMs: measuredJson.serializeMs,
    serializeMeasured: true,
    jsonBaselineSampled: REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE > 0
      && REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE < 1,
    jsonBaselineSampleRate: REALTIME_CODEC_JSON_BASELINE_SAMPLE_RATE,
  };
}

function isMapSceneSnapshot(snapshot) {
  return Boolean(snapshot)
    && typeof snapshot === "object"
    && Array.isArray(snapshot.entities);
}

function isBattleSceneSnapshot(snapshot) {
  return Boolean(snapshot)
    && typeof snapshot === "object"
    && Array.isArray(snapshot.units);
}

export function inferRealtimeSceneType(payload) {
  if (!payload || typeof payload !== "object") {
    return "unknown";
  }
  if ("bossId" in payload) {
    return "boss";
  }
  if (isMapSceneSnapshot(payload.snapshot) || isMapSceneSnapshot(payload.sceneSnapshot) || "mapId" in payload) {
    return "map";
  }
  if (
    isBattleSceneSnapshot(payload.snapshot)
    || isBattleSceneSnapshot(payload.sceneSnapshot)
    || "combatId" in payload
    || "partyCombatId" in payload
  ) {
    return "combat";
  }
  return "unknown";
}

function resolveRealtimeCodecSelection(codec, fallback = REALTIME_CODEC_JSON) {
  const normalizedCodec = String(codec || "").trim().toLowerCase();
  if (normalizedCodec === REALTIME_CODEC_MSGPACK) {
    if (!isMsgpackRuntimeAvailable()) {
      warnMsgpackUnavailable("resolve");
      return {
        codec: REALTIME_CODEC_JSON,
        requestedCodec: REALTIME_CODEC_MSGPACK,
        fallbackReason: "msgpack_unavailable",
      };
    }
    return {
      codec: REALTIME_CODEC_MSGPACK,
      requestedCodec: REALTIME_CODEC_MSGPACK,
      fallbackReason: null,
    };
  }

  if (normalizedCodec === REALTIME_CODEC_JSON) {
    return {
      codec: REALTIME_CODEC_JSON,
      requestedCodec: REALTIME_CODEC_JSON,
      fallbackReason: null,
    };
  }

  if (fallback === REALTIME_CODEC_MSGPACK) {
    if (!isMsgpackRuntimeAvailable()) {
      warnMsgpackUnavailable("resolve-fallback");
      return {
        codec: REALTIME_CODEC_JSON,
        requestedCodec: REALTIME_CODEC_MSGPACK,
        fallbackReason: "msgpack_unavailable",
      };
    }
    return {
      codec: REALTIME_CODEC_MSGPACK,
      requestedCodec: REALTIME_CODEC_MSGPACK,
      fallbackReason: null,
    };
  }

  return {
    codec: REALTIME_CODEC_JSON,
    requestedCodec: REALTIME_CODEC_JSON,
    fallbackReason: null,
  };
}

function normalizeBinaryInput(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

function hasBlobShape(input) {
  return Boolean(input)
    && typeof input === "object"
    && typeof input.arrayBuffer === "function";
}

function transformPayloadForCodec(payload, codec) {
  if (codec !== REALTIME_CODEC_MSGPACK) {
    return payload;
  }

  if (payload?.type === "scene_snapshot" && payload?.snapshot?.entities) {
    const nextPayload = {
      __rtCodec: REALTIME_CODEC_PACKET_KIND_MAP_SCENE,
      snapshot: packMapSceneSnapshotForWire(payload.snapshot),
    };
    const extra = {
      ...payload,
    };
    delete extra.snapshot;
    delete extra.type;
    if (Object.keys(extra).length > 0) {
      nextPayload.extra = extra;
    }
    return nextPayload;
  }

  if (payload?.type === "scene_snapshot" && isBattleSceneSnapshot(payload?.snapshot)) {
    const nextPayload = {
      __rtCodec: REALTIME_CODEC_PACKET_KIND_BATTLE_SCENE,
      snapshot: packBattleSceneSnapshotForWire(payload.snapshot),
    };
    const extra = {
      ...payload,
    };
    delete extra.snapshot;
    delete extra.type;
    if (Object.keys(extra).length > 0) {
      nextPayload.extra = extra;
    }
    return nextPayload;
  }

  if (isBattleSceneSnapshot(payload?.sceneSnapshot)) {
    return {
      ...payload,
      sceneSnapshot: {
        __rtCodec: REALTIME_CODEC_PACKET_KIND_BATTLE_SCENE,
        snapshot: packBattleSceneSnapshotForWire(payload.sceneSnapshot),
      },
    };
  }

  return payload;
}

function restorePayloadFromCodec(decodedPayload) {
  if (!decodedPayload || typeof decodedPayload !== "object") {
    return decodedPayload;
  }

  if (decodedPayload.__rtCodec === REALTIME_CODEC_PACKET_KIND_MAP_SCENE && decodedPayload.snapshot) {
    return {
      type: "scene_snapshot",
      ...(decodedPayload.extra || {}),
      snapshot: unpackMapSceneSnapshotFromWire(decodedPayload.snapshot),
    };
  }

  if (decodedPayload.__rtCodec === REALTIME_CODEC_PACKET_KIND_BATTLE_SCENE && decodedPayload.snapshot) {
    return {
      type: "scene_snapshot",
      ...(decodedPayload.extra || {}),
      snapshot: unpackBattleSceneSnapshotFromWire(decodedPayload.snapshot),
    };
  }

  if (
    decodedPayload.sceneSnapshot
    && typeof decodedPayload.sceneSnapshot === "object"
    && decodedPayload.sceneSnapshot.__rtCodec === REALTIME_CODEC_PACKET_KIND_BATTLE_SCENE
  ) {
    return {
      ...decodedPayload,
      sceneSnapshot: unpackBattleSceneSnapshotFromWire(decodedPayload.sceneSnapshot.snapshot),
    };
  }

  return decodedPayload;
}

export function resolveRealtimeCodecKind(codec, fallback = REALTIME_CODEC_JSON) {
  return resolveRealtimeCodecSelection(codec, fallback).codec;
}

export function isBinaryRealtimeCodec(codec) {
  return resolveRealtimeCodecKind(codec) === REALTIME_CODEC_MSGPACK;
}

export function appendRealtimeCodecSearchParam(url, codec) {
  const resolvedCodec = resolveRealtimeCodecKind(codec);
  if (resolvedCodec !== REALTIME_CODEC_MSGPACK) {
    return url;
  }

  const hasWindow = typeof window !== "undefined" && typeof window.location?.origin === "string";
  const baseOrigin = hasWindow ? window.location.origin : "http://localhost";
  const nextUrl = new URL(url, baseOrigin);
  nextUrl.searchParams.set("codec", REALTIME_CODEC_MSGPACK);

  if (/^wss?:\/\//i.test(url) || /^https?:\/\//i.test(url)) {
    return nextUrl.toString();
  }
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

export function encodeRealtimePayload(payload, options) {
  const codecSelection = resolveRealtimeCodecSelection(options?.codec);
  const resolvedCodec = codecSelection.codec;
  const sceneType = inferRealtimeSceneType(payload);
  const cachedValue = getCachedEncodedRealtimePayload(payload, resolvedCodec);

  if (cachedValue) {
    return {
      ...cachedValue,
      requestedCodec: codecSelection.requestedCodec,
      fallbackReason: codecSelection.fallbackReason,
    };
  }

  if (resolvedCodec === REALTIME_CODEC_JSON) {
    const measuredJson = measureJsonSerialization(payload);
    const nextValue = {
      codec: REALTIME_CODEC_JSON,
      sceneType,
      binary: false,
      data: measuredJson.serialized,
      transportBytes: measuredJson.jsonBytes,
      jsonBytes: measuredJson.jsonBytes,
      serializeMs: measuredJson.serializeMs,
      serializeMeasured: true,
      jsonBaselineSampled: false,
      jsonBaselineSampleRate: 1,
      encodeMs: measuredJson.serializeMs,
    };
    setCachedEncodedRealtimePayload(payload, resolvedCodec, nextValue);
    return {
      ...nextValue,
      requestedCodec: codecSelection.requestedCodec,
      fallbackReason: codecSelection.fallbackReason,
    };
  }

  const preparedPayload = transformPayloadForCodec(payload, resolvedCodec);
  const encodeStartedAt = nowMs();
  const encodedPayload = encodeMessagePack(preparedPayload);
  const encodeMs = nowMs() - encodeStartedAt;

  const nextValue = {
    codec: REALTIME_CODEC_MSGPACK,
    sceneType,
    binary: true,
    data: encodedPayload,
    transportBytes: encodedPayload.byteLength,
    ...buildJsonBaselineEstimate(payload),
    encodeMs,
  };
  setCachedEncodedRealtimePayload(payload, resolvedCodec, nextValue);
  return {
    ...nextValue,
    requestedCodec: codecSelection.requestedCodec,
    fallbackReason: codecSelection.fallbackReason,
  };
}

export function decodeRealtimePayload(input, options) {
  const binaryInput = normalizeBinaryInput(input);
  if (!binaryInput && typeof input !== "string") {
    throw new Error("Unsupported realtime payload input");
  }

  const codecSelection = resolveRealtimeCodecSelection(
    options?.codec,
    binaryInput ? REALTIME_CODEC_MSGPACK : REALTIME_CODEC_JSON,
  );
  const resolvedCodec = codecSelection.codec;
  const decodeStartedAt = nowMs();
  const transportBytes = binaryInput
    ? binaryInput.byteLength
    : textEncoder.encode(String(input || "")).byteLength;

  let decodedPayload;
  if (binaryInput) {
    if (resolvedCodec === REALTIME_CODEC_MSGPACK && decodeMessagePack) {
      decodedPayload = decodeMessagePack(binaryInput);
    } else {
      warnMsgpackUnavailable("decode");
      const binaryText = textDecoder.decode(binaryInput);
      decodedPayload = JSON.parse(binaryText);
    }
  } else {
    decodedPayload = JSON.parse(String(input));
  }

  const decodeMs = nowMs() - decodeStartedAt;
  const payload = restorePayloadFromCodec(decodedPayload);
  const sceneType = inferRealtimeSceneType(payload);
  const jsonBaselineEstimate = binaryInput
    ? buildJsonBaselineEstimate(payload)
    : {
        jsonBytes: transportBytes,
        serializeMs: 0,
        serializeMeasured: false,
        jsonBaselineSampled: false,
        jsonBaselineSampleRate: 1,
      };

  return {
    codec: binaryInput && resolvedCodec === REALTIME_CODEC_MSGPACK
      ? REALTIME_CODEC_MSGPACK
      : REALTIME_CODEC_JSON,
    requestedCodec: codecSelection.requestedCodec,
    fallbackReason: codecSelection.fallbackReason,
    sceneType,
    binary: Boolean(binaryInput),
    payload,
    transportBytes,
    ...jsonBaselineEstimate,
    decodeMs,
  };
}

export async function decodeRealtimePayloadAsync(input, options) {
  if (hasBlobShape(input)) {
    const arrayBuffer = await input.arrayBuffer();
    return decodeRealtimePayload(arrayBuffer, options);
  }
  return decodeRealtimePayload(input, options);
}
