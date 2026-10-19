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
  type LoadFailure,
  parsePositiveIntEnv,
  runPool,
  waitForRoomMessage,
  withGameServerEndpoint,
} from "./load-utils";

const CLOSE_CODE_GOING_AWAY = 1001;

interface LoadReconnectConfig extends LoadCommonConfig {
  reconnectsPerClient: number;
  reconnectDelayMs: number;
}

interface LoadReconnectSample {
  index: number;
  joinMs: number;
  successfulReconnects: number;
  reconnectAvgMs: number;
  reconnectP95Ms: number;
  repairAckAvgMs: number;
  repairAckP95Ms: number;
  sectorSnapshotAvgMs: number;
  sectorSnapshotP95Ms: number;
  totalMs: number;
}

function loadConfig(): LoadReconnectConfig {
  return {
    ...loadCommonConfig(6),
    reconnectsPerClient: parsePositiveIntEnv("GAME_LOAD_RECONNECTS_PER_CLIENT", 2),
    reconnectDelayMs: parsePositiveIntEnv("GAME_LOAD_RECONNECT_DELAY_MS", 100, 0),
  };
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function closeRoomForManualReconnect(room: ColyseusSdkRoom) {
  const leavePromise = new Promise<void>((resolve) => {
    room.onLeave.once(() => {
      resolve();
    });
  });

  room.reconnection.enabled = false;
  room.connection.close(CLOSE_CODE_GOING_AWAY, "load reconnect");
  await leavePromise;
}

async function sendRepair(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
}) {
  const startedAt = performance.now();
  const ackPromise = waitForRoomMessage<RealtimeInputAck>(
    params.room,
    "ack",
    (payload) => payload.inputType === "repair"
      && payload.accepted === true
      && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );
  const snapshotPromise = waitForRoomMessage<WorldMapSectorEnvelope>(
    params.room,
    "sector_snapshot",
    (payload) => payload.type === "sector_snapshot"
      && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );

  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-reconnect-repair-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  }));

  await ackPromise;
  const ackedAt = performance.now();
  await snapshotPromise;
  const snapshottedAt = performance.now();

  return {
    ackMs: Math.round(ackedAt - startedAt),
    snapshotMs: Math.round(snapshottedAt - startedAt),
  };
}

async function runVirtualClient(params: {
  index: number;
  endpoint: string;
  config: LoadReconnectConfig;
}) {
  const startedAt = performance.now();
  const client = createLoadClient(params.endpoint);
  let room: ColyseusSdkRoom | null = null;

  try {
    const joinStartedAt = performance.now();
    room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
      mapId: params.config.mapId,
      shardId: params.config.shardId,
      playerId: `load-reconnect-player-${params.index}`,
    });
    room.onMessage("sector_delta", () => undefined);
    const joinedAt = performance.now();

    const reconnectLatencies: number[] = [];
    const repairAckLatencies: number[] = [];
    const snapshotLatencies: number[] = [];

    for (let step = 0; step < params.config.reconnectsPerClient; step += 1) {
      const token: string = room.reconnectionToken;
      await closeRoomForManualReconnect(room);
      await sleep(params.config.reconnectDelayMs);

      const reconnectStartedAt = performance.now();
      room = await client.reconnect(token);
      room.onMessage("sector_delta", () => undefined);
      reconnectLatencies.push(Math.round(performance.now() - reconnectStartedAt));

      const repair = await sendRepair({
        room,
        sequence: params.index * 10_000 + step + 1,
        timeoutMs: params.config.timeoutMs,
      });
      repairAckLatencies.push(repair.ackMs);
      snapshotLatencies.push(repair.snapshotMs);
    }

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      successfulReconnects: params.config.reconnectsPerClient,
      reconnectAvgMs: createLatencyStats(reconnectLatencies).avg,
      reconnectP95Ms: createLatencyStats(reconnectLatencies).p95,
      repairAckAvgMs: createLatencyStats(repairAckLatencies).avg,
      repairAckP95Ms: createLatencyStats(repairAckLatencies).p95,
      sectorSnapshotAvgMs: createLatencyStats(snapshotLatencies).avg,
      sectorSnapshotP95Ms: createLatencyStats(snapshotLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
    } satisfies LoadReconnectSample;
  } finally {
    await room?.leave(true);
  }
}

function printSummary(params: {
  config: LoadReconnectConfig;
  endpoint: string;
  samples: LoadReconnectSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const successfulReconnects = params.samples.reduce((sum, sample) => sum + sample.successfulReconnects, 0);
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const reconnectAvgMs = params.samples.map((sample) => sample.reconnectAvgMs);
  const reconnectP95Ms = params.samples.map((sample) => sample.reconnectP95Ms);
  const repairAckAvgMs = params.samples.map((sample) => sample.repairAckAvgMs);
  const repairAckP95Ms = params.samples.map((sample) => sample.repairAckP95Ms);
  const sectorSnapshotAvgMs = params.samples.map((sample) => sample.sectorSnapshotAvgMs);
  const sectorSnapshotP95Ms = params.samples.map((sample) => sample.sectorSnapshotP95Ms);
  const totalMs = params.samples.map((sample) => sample.totalMs);

  const summary = {
    target: params.endpoint,
    mapId: params.config.mapId,
    shardId: params.config.shardId,
    requestedConnections: params.config.totalConnections,
    concurrency: params.config.concurrency,
    reconnectsPerClient: params.config.reconnectsPerClient,
    reconnectDelayMs: params.config.reconnectDelayMs,
    requestedReconnects: params.config.totalConnections * params.config.reconnectsPerClient,
    successfulConnections: params.samples.length,
    failedConnections: params.failures.length,
    successfulReconnects,
    latencyMs: {
      join: createLatencyStats(joinMs),
      reconnectAvgAcrossClients: createLatencyStats(reconnectAvgMs),
      reconnectP95AcrossClients: createLatencyStats(reconnectP95Ms),
      repairAckAvgAcrossClients: createLatencyStats(repairAckAvgMs),
      repairAckP95AcrossClients: createLatencyStats(repairAckP95Ms),
      sectorSnapshotAvgAcrossClients: createLatencyStats(sectorSnapshotAvgMs),
      sectorSnapshotP95AcrossClients: createLatencyStats(sectorSnapshotP95Ms),
      total: createLatencyStats(totalMs),
    },
    failures: params.failures.slice(0, 10),
    health: params.health,
  };

  console.log(JSON.stringify(summary, null, 2));
}

const config = loadConfig();

await withGameServerEndpoint(config.targetUrl, async (endpoint) => {
  const { samples, failures } = await runPool(config, (index) => runVirtualClient({
    index,
    endpoint,
    config,
  }));
  const health = await fetchHealth(endpoint).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  printSummary({
    config,
    endpoint,
    samples,
    failures,
    health,
  });

  if (failures.length > 0) {
    process.exitCode = 1;
  }
});
