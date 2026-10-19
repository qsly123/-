import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type RealtimeInputAck,
  type WorldMapSectorEnvelope,
} from "@immortality/shared-protocol";
import {
  createLatencyStats,
  createLoadClient,
  fetchHealth,
  loadCommonConfig,
  type LoadCommonConfig,
  parsePositiveIntEnv,
  toErrorMessage,
  waitForRoomMessage,
  withGameServerEndpoint,
} from "./load-utils";

if (process.env.GAME_LOAD_SUPPRESS_DEGRADED_WARNINGS === "1") {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = String(args[0] || "");
    if (
      first.includes("WorldMapRoom map data degraded")
      || first.includes("WorldMapRoom entity data degraded")
    ) {
      return;
    }
    originalWarn(...args);
  };
}

interface LoadMapShardsConfig extends LoadCommonConfig {
  mapCount: number;
  shardsPerMap: number;
  holdMs: number;
}

interface LoadMapShardSample {
  index: number;
  roomKey: string;
  joinMs: number;
  repairAckMs: number;
  snapshotMs: number;
  totalMs: number;
}

interface ConnectedRoom {
  room: ColyseusSdkRoom;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function loadConfig(): LoadMapShardsConfig {
  return {
    ...loadCommonConfig(100),
    mapCount: parsePositiveIntEnv("GAME_LOAD_MAP_COUNT", 3),
    shardsPerMap: parsePositiveIntEnv("GAME_LOAD_SHARDS_PER_MAP", 2),
    holdMs: parsePositiveIntEnv("GAME_LOAD_HOLD_MS", 1000, 0),
  };
}

function resolveRoomTarget(config: LoadMapShardsConfig, index: number) {
  const mapIndex = index % config.mapCount;
  const shardIndex = Math.floor(index / config.mapCount) % config.shardsPerMap;
  return {
    mapId: `${config.mapId}-${mapIndex + 1}`,
    shardId: `${config.shardId}-${shardIndex + 1}`,
    roomKey: `${config.mapId}-${mapIndex + 1}:${config.shardId}-${shardIndex + 1}`,
  };
}

async function connectVirtualClient(params: {
  index: number;
  endpoint: string;
  config: LoadMapShardsConfig;
}) {
  const target = resolveRoomTarget(params.config, params.index);
  const startedAt = performance.now();
  const client = createLoadClient(params.endpoint);
  let room: ColyseusSdkRoom | null = null;

  try {
    const joinStartedAt = performance.now();
    room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
      mapId: target.mapId,
      shardId: target.shardId,
      playerId: `load-shard-player-${params.index}`,
    });
    room.onMessage("sector_delta", () => undefined);
    const joinedAt = performance.now();

    const sequence = params.index + 1;
    const repairStartedAt = performance.now();
    const ackPromise = waitForRoomMessage<RealtimeInputAck>(
      room,
      "ack",
      (payload) => payload.accepted === true && payload.acceptedSequence === sequence,
      params.config.timeoutMs,
    );
    const snapshotPromise = waitForRoomMessage<WorldMapSectorEnvelope>(
      room,
      "sector_snapshot",
      (payload) => payload.type === "sector_snapshot" && payload.acceptedSequence === sequence,
      params.config.timeoutMs,
    );

    room.send("input", createRealtimeClientInput({
      clientSequence: sequence,
      clientSceneTick: 0,
      actionId: `load-shard-repair-${params.index}`,
      clientSentAt: Date.now(),
      inputType: "repair",
      payload: {},
    }));

    await ackPromise;
    const ackedAt = performance.now();
    await snapshotPromise;
    const snapshottedAt = performance.now();

    const connectedRoom = { room };
    room = null;

    return {
      connectedRoom,
      sample: {
        index: params.index,
        roomKey: target.roomKey,
        joinMs: Math.round(joinedAt - joinStartedAt),
        repairAckMs: Math.round(ackedAt - repairStartedAt),
        snapshotMs: Math.round(snapshottedAt - repairStartedAt),
        totalMs: Math.round(snapshottedAt - startedAt),
      } satisfies LoadMapShardSample,
    };
  } catch (error) {
    await room?.leave(true).catch(() => undefined);
    throw error;
  }
}

async function connectSustainedPool(params: {
  endpoint: string;
  config: LoadMapShardsConfig;
}) {
  const samples: LoadMapShardSample[] = [];
  const failures: Array<{ index: number; message: string }> = [];
  const connectedRooms: ConnectedRoom[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < params.config.totalConnections) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        const connected = await connectVirtualClient({
          index,
          endpoint: params.endpoint,
          config: params.config,
        });
        samples.push(connected.sample);
        connectedRooms.push(connected.connectedRoom);
      } catch (error) {
        failures.push({
          index,
          message: toErrorMessage(error),
        });
      }
    }
  }

  await Promise.all(Array.from(
    { length: params.config.concurrency },
    () => worker(),
  ));

  return { samples, failures, connectedRooms };
}

async function leaveConnectedRooms(connectedRooms: ConnectedRoom[]) {
  const settled = await Promise.allSettled(
    connectedRooms.map((connected) => connected.room.leave(true)),
  );
  return settled.filter((result) => result.status === "rejected").length;
}

async function fetchHealthWithRetry(endpoint: string, attempts = 3) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchHealth(endpoint);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(100 * attempt);
      }
    }
  }
  return {
    error: toErrorMessage(lastError),
  };
}

function hasHealthError(health: unknown) {
  return Boolean(
    health
    && typeof health === "object"
    && "error" in health,
  );
}

function summarizeRooms(samples: LoadMapShardSample[]) {
  const rooms: Record<string, number> = {};
  for (const sample of samples) {
    rooms[sample.roomKey] = (rooms[sample.roomKey] || 0) + 1;
  }
  return rooms;
}

function printSummary(params: {
  config: LoadMapShardsConfig;
  endpoint: string;
  samples: LoadMapShardSample[];
  failures: Array<{ index: number; message: string }>;
  healthWhileOnline: unknown;
  healthAfterLeave: unknown;
  leaveFailures: number;
}) {
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const repairAckMs = params.samples.map((sample) => sample.repairAckMs);
  const snapshotMs = params.samples.map((sample) => sample.snapshotMs);
  const totalMs = params.samples.map((sample) => sample.totalMs);
  const roomDistribution = summarizeRooms(params.samples);

  const summary = {
    target: params.endpoint,
    requestedConnections: params.config.totalConnections,
    successfulConnections: params.samples.length,
    failedConnections: params.failures.length,
    mapCount: params.config.mapCount,
    shardsPerMap: params.config.shardsPerMap,
    expectedRooms: params.config.mapCount * params.config.shardsPerMap,
    activeRooms: Object.keys(roomDistribution).length,
    holdMs: params.config.holdMs,
    roomDistribution,
    latencyMs: {
      join: createLatencyStats(joinMs),
      repairAck: createLatencyStats(repairAckMs),
      sectorSnapshot: createLatencyStats(snapshotMs),
      total: createLatencyStats(totalMs),
    },
    failures: params.failures.slice(0, 10),
    leaveFailures: params.leaveFailures,
    healthWhileOnline: params.healthWhileOnline,
    healthAfterLeave: params.healthAfterLeave,
  };

  console.log(JSON.stringify(summary, null, 2));
}

const config = loadConfig();

await withGameServerEndpoint(config.targetUrl, async (endpoint) => {
  const { samples, failures, connectedRooms } = await connectSustainedPool({
    endpoint,
    config,
  });

  if (config.holdMs > 0) {
    await sleep(config.holdMs);
  }

  const healthWhileOnline = await fetchHealthWithRetry(endpoint);

  const leaveFailures = await leaveConnectedRooms(connectedRooms);
  const healthAfterLeave = await fetchHealthWithRetry(endpoint);

  printSummary({
    config,
    endpoint,
    samples,
    failures,
    healthWhileOnline,
    healthAfterLeave,
    leaveFailures,
  });

  if (
    failures.length > 0 ||
    leaveFailures > 0 ||
    hasHealthError(healthWhileOnline) ||
    hasHealthError(healthAfterLeave) ||
    samples.length !== config.totalConnections
  ) {
    process.exitCode = 1;
  }
});
