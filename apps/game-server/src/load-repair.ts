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

interface LoadRepairConfig extends LoadCommonConfig {
  repairsPerClient: number;
  repairDelayMs: number;
  repairJitterMs: number;
}

interface LoadRepairSample {
  index: number;
  joinMs: number;
  successfulRepairs: number;
  repairAckAvgMs: number;
  repairAckP95Ms: number;
  sectorSnapshotAvgMs: number;
  sectorSnapshotP95Ms: number;
  totalMs: number;
}

function loadConfig(): LoadRepairConfig {
  return {
    ...loadCommonConfig(10),
    repairsPerClient: parsePositiveIntEnv("GAME_LOAD_REPAIRS_PER_CLIENT", 8),
    repairDelayMs: parsePositiveIntEnv("GAME_LOAD_REPAIR_DELAY_MS", 50, 0),
    repairJitterMs: parsePositiveIntEnv("GAME_LOAD_REPAIR_JITTER_MS", 100, 0),
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

function resolveRepairDelay(config: LoadRepairConfig, step: number) {
  if (step <= 0) {
    return 0;
  }
  if (config.repairJitterMs <= 0) {
    return config.repairDelayMs;
  }
  const jitter = (step * 37) % (config.repairJitterMs + 1);
  return config.repairDelayMs + jitter;
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
    actionId: `load-repair-${params.sequence}`,
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
  config: LoadRepairConfig;
}) {
  const startedAt = performance.now();
  const client = createLoadClient(params.endpoint);
  let room: ColyseusSdkRoom | null = null;

  try {
    const joinStartedAt = performance.now();
    room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
      mapId: params.config.mapId,
      shardId: params.config.shardId,
      playerId: `load-repair-player-${params.index}`,
    });
    room.onMessage("sector_delta", () => undefined);
    const joinedAt = performance.now();

    const ackLatencies: number[] = [];
    const snapshotLatencies: number[] = [];

    for (let step = 0; step < params.config.repairsPerClient; step += 1) {
      await sleep(resolveRepairDelay(params.config, step));
      const result = await sendRepair({
        room,
        sequence: params.index * 10_000 + step + 1,
        timeoutMs: params.config.timeoutMs,
      });
      ackLatencies.push(result.ackMs);
      snapshotLatencies.push(result.snapshotMs);
    }

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      successfulRepairs: params.config.repairsPerClient,
      repairAckAvgMs: createLatencyStats(ackLatencies).avg,
      repairAckP95Ms: createLatencyStats(ackLatencies).p95,
      sectorSnapshotAvgMs: createLatencyStats(snapshotLatencies).avg,
      sectorSnapshotP95Ms: createLatencyStats(snapshotLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
    } satisfies LoadRepairSample;
  } finally {
    await room?.leave(true);
  }
}

function printSummary(params: {
  config: LoadRepairConfig;
  endpoint: string;
  samples: LoadRepairSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const successfulRepairs = params.samples.reduce((sum, sample) => sum + sample.successfulRepairs, 0);
  const joinMs = params.samples.map((sample) => sample.joinMs);
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
    repairsPerClient: params.config.repairsPerClient,
    repairDelayMs: params.config.repairDelayMs,
    repairJitterMs: params.config.repairJitterMs,
    requestedRepairs: params.config.totalConnections * params.config.repairsPerClient,
    successfulConnections: params.samples.length,
    failedConnections: params.failures.length,
    successfulRepairs,
    latencyMs: {
      join: createLatencyStats(joinMs),
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
