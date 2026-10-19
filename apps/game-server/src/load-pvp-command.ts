import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type CombatSceneEntity,
  type CombatSceneEnvelope,
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

interface LoadPvpCommandConfig extends LoadCommonConfig {
  pvpRooms: number;
  commandsPerPlayer: number;
  setupMovementLimit: number;
}

interface LoadPvpCommandSample {
  index: number;
  joinMs: number;
  setupMovements: number;
  acceptedCommands: number;
  rejectedCommands: number;
  commandAckAvgMs: number;
  commandAckP95Ms: number;
  totalMs: number;
  rejectedByReason: Record<string, number>;
}

const PVP_PLAYERS_PER_ROOM = 2;
const DEFAULT_SETUP_MOVEMENT_LIMIT = 16;
const DEFAULT_MAX_STEP_PERCENT = 5;
const DEFAULT_TARGET_RANGE_PERCENT = 14;
const INITIAL_POSITIONS: CombatSceneEntity[] = [
  {
    id: "pvp-a",
    kind: "combatant",
    name: "pvp-a",
    x: 50,
    y: 76,
    velocityX: 0,
    velocityY: 0,
    updatedAt: 0,
  },
  {
    id: "pvp-b",
    kind: "combatant",
    name: "pvp-b",
    x: 52,
    y: 24,
    velocityX: 0,
    velocityY: 0,
    updatedAt: 0,
  },
];

function loadConfig(): LoadPvpCommandConfig {
  const common = loadCommonConfig(4);
  return {
    ...common,
    pvpRooms: parsePositiveIntEnv("GAME_LOAD_PVP_ROOMS", common.totalConnections),
    commandsPerPlayer: parsePositiveIntEnv("GAME_LOAD_PVP_COMMANDS_PER_PLAYER", 4),
    setupMovementLimit: parsePositiveIntEnv("GAME_LOAD_PVP_SETUP_MOVEMENT_LIMIT", DEFAULT_SETUP_MOVEMENT_LIMIT),
  };
}

function addRejectedReason(
  rejectedByReason: Record<string, number>,
  reason: string | undefined,
) {
  const key = reason || "unknown";
  rejectedByReason[key] = (rejectedByReason[key] || 0) + 1;
}

function distance(left: CombatSceneEntity, right: CombatSceneEntity) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function nextStepToward(params: {
  from: CombatSceneEntity;
  to: CombatSceneEntity;
  maxStep: number;
  targetRange: number;
}) {
  const dx = params.to.x - params.from.x;
  const dy = params.to.y - params.from.y;
  const currentDistance = Math.hypot(dx, dy);
  if (currentDistance <= params.targetRange) {
    return null;
  }

  const stepDistance = Math.min(
    params.maxStep,
    Math.max(0, currentDistance - Math.max(1, params.targetRange - 1)),
  );
  if (stepDistance <= 0) {
    return null;
  }

  return {
    x: params.from.x + (dx / currentDistance) * stepDistance,
    y: params.from.y + (dy / currentDistance) * stepDistance,
  };
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
  const snapshotPromise = waitForRoomMessage<CombatSceneEnvelope>(
    params.room,
    "scene_snapshot",
    (payload) => payload.type === "scene_snapshot"
      && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );

  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-pvp-repair-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  }));

  await ackPromise;
  const snapshot = await snapshotPromise;
  return snapshot.authoritativeState.entities || [];
}

async function sendMovement(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
  x: number;
  y: number;
}) {
  const ackPromise = waitForRoomMessage<RealtimeInputAck<{ x?: number; y?: number }>>(
    params.room,
    "ack",
    (payload) => payload.inputType === "movement"
      && payload.acceptedSequence === params.sequence,
    params.timeoutMs,
  );
  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-pvp-movement-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "movement",
    payload: {
      x: params.x,
      y: params.y,
    },
  }));

  const ack = await ackPromise;
  return { ack };
}

async function sendBasicAttack(params: {
  room: ColyseusSdkRoom;
  sequence: number;
  timeoutMs: number;
  targetId: string;
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
    actionId: `load-pvp-command-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "command",
    payload: {
      commandType: "basicAttack",
      targetId: params.targetId,
    },
  }));

  const ack = await ackPromise;
  const ackedAt = performance.now();

  return {
    ack,
    ackMs: Math.round(ackedAt - startedAt),
  };
}

function createInitialEntity(playerId: string, playerIndex: number): CombatSceneEntity {
  return {
    ...INITIAL_POSITIONS[playerIndex],
    id: playerId,
    name: playerId,
  };
}

function indexEntitiesById(entities: CombatSceneEntity[]) {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

async function movePlayerIntoRange(params: {
  room: ColyseusSdkRoom;
  self: CombatSceneEntity;
  target: CombatSceneEntity;
  sequenceStart: number;
  timeoutMs: number;
  movementLimit: number;
}) {
  let self = { ...params.self };
  let sequence = params.sequenceStart;
  let movements = 0;

  for (let attempt = 0; attempt < params.movementLimit; attempt += 1) {
    if (distance(self, params.target) <= DEFAULT_TARGET_RANGE_PERCENT) {
      break;
    }

    const next = nextStepToward({
      from: self,
      to: params.target,
      maxStep: DEFAULT_MAX_STEP_PERCENT,
      targetRange: DEFAULT_TARGET_RANGE_PERCENT,
    });
    if (!next) {
      break;
    }

    const result = await sendMovement({
      room: params.room,
      sequence,
      timeoutMs: params.timeoutMs,
      x: next.x,
      y: next.y,
    });
    sequence += 1;
    if (!result.ack.accepted) {
      break;
    }
    const authoritativeState = result.ack.authoritativeState as { x?: unknown; y?: unknown } | undefined;
    self = {
      ...self,
      x: Number(authoritativeState?.x ?? next.x),
      y: Number(authoritativeState?.y ?? next.y),
    };
    movements += 1;
  }

  return {
    self,
    nextSequence: sequence,
    movements,
  };
}

async function runVirtualPvpRoom(params: {
  index: number;
  endpoint: string;
  config: LoadPvpCommandConfig;
}) {
  const startedAt = performance.now();
  const clients = [
    createLoadClient(params.endpoint),
    createLoadClient(params.endpoint),
  ];
  let firstRoom: ColyseusSdkRoom | null = null;
  let secondRoom: ColyseusSdkRoom | null = null;
  const playerIds = [
    `load-pvp-${params.index}-player-0`,
    `load-pvp-${params.index}-player-1`,
  ];

  try {
    const joinStartedAt = performance.now();
    firstRoom = await clients[0].create(GAME_ROOM_NAMES.pvp, {
      combatId: `load-pvp-${params.index}`,
      playerId: playerIds[0],
    });
    secondRoom = await clients[1].joinById(firstRoom.roomId, {
      combatId: `load-pvp-${params.index}`,
      playerId: playerIds[1],
    });
    const joinedAt = performance.now();

    firstRoom.onMessage("scene_snapshot", () => undefined);
    firstRoom.onMessage("timeline_event", () => undefined);
    firstRoom.onMessage("settlement", () => undefined);
    secondRoom.onMessage("scene_snapshot", () => undefined);
    secondRoom.onMessage("timeline_event", () => undefined);
    secondRoom.onMessage("settlement", () => undefined);

    const rooms = [firstRoom, secondRoom];
    const positions = [
      createInitialEntity(playerIds[0], 0),
      createInitialEntity(playerIds[1], 1),
    ];
    const nextSequences = [
      params.index * 1_000_000 + 1,
      params.index * 1_000_000 + 100_001,
    ];
    let setupMovements = 0;

    for (let playerIndex = 0; playerIndex < PVP_PLAYERS_PER_ROOM; playerIndex += 1) {
      const repairEntities = await sendRepair({
        room: rooms[playerIndex],
        sequence: nextSequences[playerIndex],
        timeoutMs: params.config.timeoutMs,
      });
      for (const [entityId, entity] of indexEntitiesById(repairEntities)) {
        const matchedIndex = playerIds.indexOf(entityId);
        if (matchedIndex >= 0) {
          positions[matchedIndex] = entity;
        }
      }
      nextSequences[playerIndex] += 1;
    }

    for (let playerIndex = 0; playerIndex < PVP_PLAYERS_PER_ROOM; playerIndex += 1) {
      const targetIndex = playerIndex === 0 ? 1 : 0;
      const setup = await movePlayerIntoRange({
        room: rooms[playerIndex],
        self: positions[playerIndex],
        target: positions[targetIndex],
        sequenceStart: nextSequences[playerIndex],
        timeoutMs: params.config.timeoutMs,
        movementLimit: params.config.setupMovementLimit,
      });
      positions[playerIndex] = setup.self;
      nextSequences[playerIndex] = setup.nextSequence;
      setupMovements += setup.movements;
    }

    const commandLatencies: number[] = [];
    const rejectedByReason: Record<string, number> = {};
    let acceptedCommands = 0;
    let rejectedCommands = 0;

    for (let step = 0; step < params.config.commandsPerPlayer; step += 1) {
      for (let playerIndex = 0; playerIndex < PVP_PLAYERS_PER_ROOM; playerIndex += 1) {
        const targetIndex = playerIndex === 0 ? 1 : 0;
        const result = await sendBasicAttack({
          room: rooms[playerIndex],
          sequence: nextSequences[playerIndex],
          timeoutMs: params.config.timeoutMs,
          targetId: playerIds[targetIndex],
        });
        nextSequences[playerIndex] += 1;
        commandLatencies.push(result.ackMs);
        if (result.ack.accepted) {
          acceptedCommands += 1;
        } else {
          rejectedCommands += 1;
          addRejectedReason(rejectedByReason, result.ack.reason);
        }
      }
    }

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      setupMovements,
      acceptedCommands,
      rejectedCommands,
      commandAckAvgMs: average(commandLatencies),
      commandAckP95Ms: createLatencyStats(commandLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
      rejectedByReason,
    } satisfies LoadPvpCommandSample;
  } finally {
    await Promise.allSettled([
      firstRoom?.leave(true),
      secondRoom?.leave(true),
    ]);
  }
}

function mergeRejectedReasons(samples: LoadPvpCommandSample[]) {
  const merged: Record<string, number> = {};
  for (const sample of samples) {
    for (const [reason, count] of Object.entries(sample.rejectedByReason)) {
      merged[reason] = (merged[reason] || 0) + count;
    }
  }
  return merged;
}

function printSummary(params: {
  config: LoadPvpCommandConfig;
  endpoint: string;
  samples: LoadPvpCommandSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const acceptedCommands = params.samples.reduce((sum, sample) => sum + sample.acceptedCommands, 0);
  const rejectedCommands = params.samples.reduce((sum, sample) => sum + sample.rejectedCommands, 0);
  const setupMovements = params.samples.reduce((sum, sample) => sum + sample.setupMovements, 0);
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const commandAckAvgMs = params.samples.map((sample) => sample.commandAckAvgMs);
  const commandAckP95Ms = params.samples.map((sample) => sample.commandAckP95Ms);
  const totalMs = params.samples.map((sample) => sample.totalMs);

  const summary = {
    target: params.endpoint,
    requestedPvpRooms: params.config.pvpRooms,
    playersPerRoom: PVP_PLAYERS_PER_ROOM,
    requestedConnections: params.config.pvpRooms * PVP_PLAYERS_PER_ROOM,
    concurrency: params.config.concurrency,
    commandsPerPlayer: params.config.commandsPerPlayer,
    requestedCommands: params.config.pvpRooms * PVP_PLAYERS_PER_ROOM * params.config.commandsPerPlayer,
    successfulRooms: params.samples.length,
    failedRooms: params.failures.length,
    setupMovements,
    acceptedCommands,
    rejectedCommands,
    rejectedByReason: mergeRejectedReasons(params.samples),
    latencyMs: {
      join: createLatencyStats(joinMs),
      commandAckAvgAcrossRooms: createLatencyStats(commandAckAvgMs),
      commandAckP95AcrossRooms: createLatencyStats(commandAckP95Ms),
      total: createLatencyStats(totalMs),
    },
    failures: params.failures.slice(0, 10),
    health: params.health,
  };

  console.log(JSON.stringify(summary, null, 2));
}

const config = loadConfig();

await withGameServerEndpoint(config.targetUrl, async (endpoint) => {
  const { samples, failures } = await runPool({
    totalConnections: config.pvpRooms,
    concurrency: Math.min(config.concurrency, config.pvpRooms),
  }, (index) => runVirtualPvpRoom({
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

  const acceptedCommands = samples.reduce((sum, sample) => sum + sample.acceptedCommands, 0);
  if (failures.length > 0 || acceptedCommands < 1) {
    process.exitCode = 1;
  }
});
