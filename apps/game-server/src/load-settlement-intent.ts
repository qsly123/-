import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type GameRoomName,
  type RealtimeInputAck,
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

interface SettlementIntentLike {
  idempotencyKey?: unknown;
  battleId?: unknown;
  mode?: unknown;
  loserId?: unknown;
  reason?: unknown;
  occurredAt?: unknown;
}

interface LoadSettlementIntentConfig extends LoadCommonConfig {
  rooms: number;
  roomName: GameRoomName;
  repeatedSurrendersPerRoom: number;
}

interface LoadSettlementIntentSample {
  index: number;
  joinMs: number;
  acceptedSurrenders: number;
  rejectedSurrenders: number;
  settlementIntents: number;
  uniqueIdempotencyKeys: number;
  stableIdempotencyKey: boolean;
  firstIdempotencyKey: string | null;
  surrenderAckAvgMs: number;
  surrenderAckP95Ms: number;
  totalMs: number;
  rejectedByReason: Record<string, number>;
}

const ROOM_NAME_BY_MODE = {
  combat: GAME_ROOM_NAMES.combat,
  boss: GAME_ROOM_NAMES.boss,
  pvp: GAME_ROOM_NAMES.pvp,
} as const;

function loadRoomName(): GameRoomName {
  const raw = process.env.GAME_LOAD_SETTLEMENT_ROOM?.trim().toLowerCase() || "pvp";
  if (raw === "combat" || raw === "boss" || raw === "pvp") {
    return ROOM_NAME_BY_MODE[raw];
  }
  return GAME_ROOM_NAMES.pvp;
}

function loadConfig(): LoadSettlementIntentConfig {
  const common = loadCommonConfig(4);
  return {
    ...common,
    rooms: parsePositiveIntEnv("GAME_LOAD_SETTLEMENT_ROOMS", common.totalConnections),
    roomName: loadRoomName(),
    repeatedSurrendersPerRoom: parsePositiveIntEnv("GAME_LOAD_SETTLEMENT_REPEATS", 3),
  };
}

function addRejectedReason(
  rejectedByReason: Record<string, number>,
  reason: string | undefined,
) {
  const key = reason || "unknown";
  rejectedByReason[key] = (rejectedByReason[key] || 0) + 1;
}

function getSettlementIntentFromAck(ack: RealtimeInputAck) {
  const authoritativeState = ack.authoritativeState as {
    settlementIntent?: SettlementIntentLike | null;
  } | undefined;
  const intent = authoritativeState?.settlementIntent;
  if (!intent || typeof intent !== "object") {
    return null;
  }
  return intent;
}

function getIdempotencyKey(intent: SettlementIntentLike | null) {
  const key = intent?.idempotencyKey;
  return typeof key === "string" && key.trim().length > 0 ? key : null;
}

async function sendRepair(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
}) {
  const ackPromise = waitForRoomMessage<RealtimeInputAck>(
    params.room,
    "ack",
    (payload) => payload.inputType === "repair"
      && payload.accepted === true
      && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );

  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-settlement-repair-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  }));

  await ackPromise;
}

async function sendSurrender(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
}) {
  const startedAt = performance.now();
  const ackPromise = waitForRoomMessage<RealtimeInputAck>(
    params.room,
    "ack",
    (payload) => payload.inputType === "command"
      && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );
  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-settlement-surrender-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "command",
    payload: {
      commandType: "surrender",
    },
  }));

  const ack = await ackPromise;
  const ackedAt = performance.now();

  return {
    ack,
    ackMs: Math.round(ackedAt - startedAt),
  };
}

async function runVirtualSettlementRoom(params: {
  index: number;
  endpoint: string;
  config: LoadSettlementIntentConfig;
}) {
  const startedAt = performance.now();
  const surrenderClient = createLoadClient(params.endpoint);
  const opponentClient = createLoadClient(params.endpoint);
  let surrenderRoom: ColyseusSdkRoom | null = null;
  let opponentRoom: ColyseusSdkRoom | null = null;
  const surrenderPlayerId = `load-settlement-${params.index}-loser`;
  const opponentPlayerId = `load-settlement-${params.index}-opponent`;

  try {
    const joinStartedAt = performance.now();
    surrenderRoom = await surrenderClient.create(params.config.roomName, {
      combatId: `load-settlement-${params.index}`,
      playerId: surrenderPlayerId,
    });
    opponentRoom = await opponentClient.joinById(surrenderRoom.roomId, {
      combatId: `load-settlement-${params.index}`,
      playerId: opponentPlayerId,
    });
    const joinedAt = performance.now();

    surrenderRoom.onMessage("scene_snapshot", () => undefined);
    opponentRoom.onMessage("scene_snapshot", () => undefined);

    const baseSequence = params.index * 100_000;
    await sendRepair({
      room: surrenderRoom,
      sequence: baseSequence + 1,
      timeoutMs: params.config.timeoutMs,
    });

    const surrenderLatencies: number[] = [];
    const rejectedByReason: Record<string, number> = {};
    const idempotencyKeys: string[] = [];
    let acceptedSurrenders = 0;
    let rejectedSurrenders = 0;
    let settlementIntents = 0;

    for (let step = 0; step < params.config.repeatedSurrendersPerRoom; step += 1) {
      const result = await sendSurrender({
        room: surrenderRoom,
        sequence: baseSequence + 2 + step,
        timeoutMs: params.config.timeoutMs,
      });
      surrenderLatencies.push(result.ackMs);
      if (result.ack.accepted) {
        acceptedSurrenders += 1;
        const intent = getSettlementIntentFromAck(result.ack);
        const idempotencyKey = getIdempotencyKey(intent);
        if (intent) {
          settlementIntents += 1;
        }
        if (idempotencyKey) {
          idempotencyKeys.push(idempotencyKey);
        }
      } else {
        rejectedSurrenders += 1;
        addRejectedReason(rejectedByReason, result.ack.reason);
      }
    }

    const uniqueIdempotencyKeys = new Set(idempotencyKeys);
    const stableIdempotencyKey = idempotencyKeys.length === params.config.repeatedSurrendersPerRoom
      && uniqueIdempotencyKeys.size === 1;

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      acceptedSurrenders,
      rejectedSurrenders,
      settlementIntents,
      uniqueIdempotencyKeys: uniqueIdempotencyKeys.size,
      stableIdempotencyKey,
      firstIdempotencyKey: idempotencyKeys[0] || null,
      surrenderAckAvgMs: average(surrenderLatencies),
      surrenderAckP95Ms: createLatencyStats(surrenderLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
      rejectedByReason,
    } satisfies LoadSettlementIntentSample;
  } finally {
    await surrenderRoom?.leave(true);
    await opponentRoom?.leave(true);
  }
}

function mergeRejectedReasons(samples: LoadSettlementIntentSample[]) {
  const merged: Record<string, number> = {};
  for (const sample of samples) {
    for (const [reason, count] of Object.entries(sample.rejectedByReason)) {
      merged[reason] = (merged[reason] || 0) + count;
    }
  }
  return merged;
}

function printSummary(params: {
  config: LoadSettlementIntentConfig;
  endpoint: string;
  samples: LoadSettlementIntentSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const acceptedSurrenders = params.samples.reduce((sum, sample) => sum + sample.acceptedSurrenders, 0);
  const rejectedSurrenders = params.samples.reduce((sum, sample) => sum + sample.rejectedSurrenders, 0);
  const settlementIntents = params.samples.reduce((sum, sample) => sum + sample.settlementIntents, 0);
  const stableKeyRooms = params.samples.filter((sample) => sample.stableIdempotencyKey).length;
  const unstableKeyRooms = params.samples.length - stableKeyRooms;
  const uniqueIdempotencyKeys = new Set(
    params.samples
      .map((sample) => sample.firstIdempotencyKey)
      .filter((key): key is string => Boolean(key)),
  );
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const surrenderAckAvgMs = params.samples.map((sample) => sample.surrenderAckAvgMs);
  const surrenderAckP95Ms = params.samples.map((sample) => sample.surrenderAckP95Ms);
  const totalMs = params.samples.map((sample) => sample.totalMs);

  const summary = {
    target: params.endpoint,
    roomName: params.config.roomName,
    requestedRooms: params.config.rooms,
    requestedConnections: params.config.rooms * 2,
    concurrency: params.config.concurrency,
    repeatedSurrendersPerRoom: params.config.repeatedSurrendersPerRoom,
    requestedSurrenders: params.config.rooms * params.config.repeatedSurrendersPerRoom,
    successfulRooms: params.samples.length,
    failedRooms: params.failures.length,
    acceptedSurrenders,
    rejectedSurrenders,
    settlementIntents,
    uniqueIdempotencyKeys: uniqueIdempotencyKeys.size,
    stableKeyRooms,
    unstableKeyRooms,
    rejectedByReason: mergeRejectedReasons(params.samples),
    latencyMs: {
      join: createLatencyStats(joinMs),
      surrenderAckAvgAcrossRooms: createLatencyStats(surrenderAckAvgMs),
      surrenderAckP95AcrossRooms: createLatencyStats(surrenderAckP95Ms),
      total: createLatencyStats(totalMs),
    },
    failures: params.failures.slice(0, 10),
    health: params.health,
  };

  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

const config = loadConfig();

await withGameServerEndpoint(config.targetUrl, async (endpoint) => {
  const { samples, failures } = await runPool({
    totalConnections: config.rooms,
    concurrency: Math.min(config.concurrency, config.rooms),
  }, (index) => runVirtualSettlementRoom({
    index,
    endpoint,
    config,
  }));
  const health = await fetchHealth(endpoint).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  const summary = printSummary({
    config,
    endpoint,
    samples,
    failures,
    health,
  });

  if (
    failures.length > 0
    || summary.unstableKeyRooms > 0
    || summary.acceptedSurrenders !== summary.requestedSurrenders
    || summary.settlementIntents !== summary.requestedSurrenders
  ) {
    process.exitCode = 1;
  }
});
