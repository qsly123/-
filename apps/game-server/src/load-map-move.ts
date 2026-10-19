import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type RealtimeInputAck,
  type WorldMapSectorEnvelope,
} from "@immortality/shared-protocol";
import {
  average,
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

interface LoadMapMoveConfig extends LoadCommonConfig {
  movesPerClient: number;
}

interface LoadMapMoveSample {
  index: number;
  joinMs: number;
  repairAckMs: number;
  successfulMoves: number;
  rejectedMoves: number;
  moveAckAvgMs: number;
  moveAckP95Ms: number;
  totalMs: number;
  rejectedByReason: Record<string, number>;
}

function loadConfig(): LoadMapMoveConfig {
  return {
    ...loadCommonConfig(10),
    movesPerClient: parsePositiveIntEnv("GAME_LOAD_MOVES_PER_CLIENT", 12),
  };
}

function nextPosition(step: number) {
  const route = [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
  ];
  return route[step % route.length] || { x: 0, y: 0 };
}

async function waitForAcceptedRepair(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
}) {
  const ackPromise = waitForRoomMessage<RealtimeInputAck>(
    params.room,
    "ack",
    (payload) => payload.accepted === true && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );
  const snapshotPromise = waitForRoomMessage<WorldMapSectorEnvelope>(
    params.room,
    "sector_snapshot",
    (payload) => payload.type === "sector_snapshot" && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );

  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-map-repair-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  }));

  await ackPromise;
  await snapshotPromise;
}

async function sendMove(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
  x: number;
  y: number;
}) {
  const startedAt = performance.now();
  const ackPromise = waitForRoomMessage<RealtimeInputAck<{ x?: number; y?: number }>>(
    params.room,
    "ack",
    (payload) => payload.inputType === "move" && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );

  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-map-move-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "move",
    payload: {
      x: params.x,
      y: params.y,
    },
  }));

  const ack = await ackPromise;
  return {
    ack,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

function addRejectedReason(
  rejectedByReason: Record<string, number>,
  reason: string | undefined,
) {
  const key = reason || "unknown";
  rejectedByReason[key] = (rejectedByReason[key] || 0) + 1;
}

async function runVirtualClient(params: {
  index: number;
  endpoint: string;
  config: LoadMapMoveConfig;
}) {
  const startedAt = performance.now();
  const client = createLoadClient(params.endpoint);
  let room: ColyseusSdkRoom | null = null;

  try {
    const joinStartedAt = performance.now();
    room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
      mapId: params.config.mapId,
      shardId: params.config.shardId,
      playerId: `load-move-player-${params.index}`,
    });
    room.onMessage("sector_delta", () => undefined);
    const joinedAt = performance.now();

    const repairSequence = params.index * 10_000 + 1;
    const repairStartedAt = performance.now();
    await waitForAcceptedRepair({
      room,
      sequence: repairSequence,
      timeoutMs: params.config.timeoutMs,
    });
    const repairedAt = performance.now();

    const moveLatencies: number[] = [];
    const rejectedByReason: Record<string, number> = {};
    let successfulMoves = 0;
    let rejectedMoves = 0;

    for (let step = 0; step < params.config.movesPerClient; step += 1) {
      const position = nextPosition(step);
      const result = await sendMove({
        room,
        sequence: repairSequence + step + 1,
        timeoutMs: params.config.timeoutMs,
        x: position.x,
        y: position.y,
      });
      moveLatencies.push(result.latencyMs);
      if (result.ack.accepted) {
        successfulMoves += 1;
      } else {
        rejectedMoves += 1;
        addRejectedReason(rejectedByReason, result.ack.reason);
      }
    }

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      repairAckMs: Math.round(repairedAt - repairStartedAt),
      successfulMoves,
      rejectedMoves,
      moveAckAvgMs: average(moveLatencies),
      moveAckP95Ms: createLatencyStats(moveLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
      rejectedByReason,
    } satisfies LoadMapMoveSample;
  } finally {
    await room?.leave(true);
  }
}

function mergeRejectedReasons(samples: LoadMapMoveSample[]) {
  const merged: Record<string, number> = {};
  for (const sample of samples) {
    for (const [reason, count] of Object.entries(sample.rejectedByReason)) {
      merged[reason] = (merged[reason] || 0) + count;
    }
  }
  return merged;
}

function printSummary(params: {
  config: LoadMapMoveConfig;
  endpoint: string;
  samples: LoadMapMoveSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const successfulMoves = params.samples.reduce((sum, sample) => sum + sample.successfulMoves, 0);
  const rejectedMoves = params.samples.reduce((sum, sample) => sum + sample.rejectedMoves, 0);
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const repairMs = params.samples.map((sample) => sample.repairAckMs);
  const moveAckAvgMs = params.samples.map((sample) => sample.moveAckAvgMs);
  const moveAckP95Ms = params.samples.map((sample) => sample.moveAckP95Ms);
  const totalMs = params.samples.map((sample) => sample.totalMs);

  const summary = {
    target: params.endpoint,
    mapId: params.config.mapId,
    shardId: params.config.shardId,
    requestedConnections: params.config.totalConnections,
    concurrency: params.config.concurrency,
    movesPerClient: params.config.movesPerClient,
    requestedMoves: params.config.totalConnections * params.config.movesPerClient,
    successfulConnections: params.samples.length,
    failedConnections: params.failures.length,
    successfulMoves,
    rejectedMoves,
    rejectedByReason: mergeRejectedReasons(params.samples),
    latencyMs: {
      join: createLatencyStats(joinMs),
      repairAck: createLatencyStats(repairMs),
      moveAckAvgAcrossClients: createLatencyStats(moveAckAvgMs),
      moveAckP95AcrossClients: createLatencyStats(moveAckP95Ms),
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
