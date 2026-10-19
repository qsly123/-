import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type RealtimeInputAck,
  type WorldMapSectorEnvelope,
} from "@immortality/shared-protocol";
import {
  average,
  createLoadClient,
  fetchHealth,
  loadCommonConfig,
  type LoadCommonConfig,
  type LoadFailure,
  percentile,
  runPool,
  waitForRoomMessage,
  withGameServerEndpoint,
} from "./load-utils";

interface LoadSample {
  index: number;
  joinMs: number;
  repairAckMs: number;
  snapshotMs: number;
  totalMs: number;
}

async function runVirtualClient(
  params: {
    index: number;
    endpoint: string;
    config: LoadCommonConfig;
  },
) {
  const startedAt = performance.now();
  const client = createLoadClient(params.endpoint);
  let room: ColyseusSdkRoom | null = null;

  try {
    const joinStartedAt = performance.now();
    room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
      mapId: params.config.mapId,
      shardId: params.config.shardId,
      playerId: `load-player-${params.index}`,
    });
    room.onMessage("sector_delta", () => undefined);
    const joinedAt = performance.now();

    const sequence = params.index + 1;
    const ackStartedAt = performance.now();
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
      actionId: `load-repair-${params.index}`,
      clientSentAt: Date.now(),
      inputType: "repair",
      payload: {},
    }));

    await ackPromise;
    const ackedAt = performance.now();
    await snapshotPromise;
    const snapshotAt = performance.now();

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      repairAckMs: Math.round(ackedAt - ackStartedAt),
      snapshotMs: Math.round(snapshotAt - ackStartedAt),
      totalMs: Math.round(snapshotAt - startedAt),
    } satisfies LoadSample;
  } finally {
    await room?.leave(true);
  }
}

function printSummary(params: {
  config: LoadCommonConfig;
  endpoint: string;
  samples: LoadSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const ackMs = params.samples.map((sample) => sample.repairAckMs);
  const snapshotMs = params.samples.map((sample) => sample.snapshotMs);
  const totalMs = params.samples.map((sample) => sample.totalMs);

  const summary = {
    target: params.endpoint,
    mapId: params.config.mapId,
    shardId: params.config.shardId,
    requestedConnections: params.config.totalConnections,
    concurrency: params.config.concurrency,
    successfulConnections: params.samples.length,
    failedConnections: params.failures.length,
    latencyMs: {
      joinAvg: average(joinMs),
      joinP95: percentile(joinMs, 0.95),
      repairAckAvg: average(ackMs),
      repairAckP95: percentile(ackMs, 0.95),
      sectorSnapshotAvg: average(snapshotMs),
      sectorSnapshotP95: percentile(snapshotMs, 0.95),
      totalAvg: average(totalMs),
      totalP95: percentile(totalMs, 0.95),
    },
    failures: params.failures.slice(0, 10),
    health: params.health,
  };

  console.log(JSON.stringify(summary, null, 2));
}

const config = loadCommonConfig(20);

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
