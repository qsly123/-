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

interface LoadBossCommandConfig extends LoadCommonConfig {
  bossRooms: number;
  playersPerRoom: number;
  commandsPerPlayer: number;
  setupMovementLimit: number;
  expectedCommandResult: "reject" | "accept" | "any";
}

interface LoadBossCommandSample {
  index: number;
  joinMs: number;
  joinedPlayers: number;
  setupMovements: number;
  acceptedCommands: number;
  rejectedCommands: number;
  commandAckAvgMs: number;
  commandAckP95Ms: number;
  totalMs: number;
  rejectedByReason: Record<string, number>;
}

const DEFAULT_SETUP_MOVEMENT_LIMIT = 16;
const DEFAULT_MAX_STEP_PERCENT = 6;
const DEFAULT_TARGET_RANGE_PERCENT = 14;
const FIRST_PLAYER_POSITION: CombatSceneEntity = {
  id: "first",
  kind: "combatant",
  name: "first",
  x: 50,
  y: 76,
  velocityX: 0,
  velocityY: 0,
  updatedAt: 0,
};
const OTHER_PLAYER_POSITION: CombatSceneEntity = {
  id: "other",
  kind: "combatant",
  name: "other",
  x: 52,
  y: 24,
  velocityX: 0,
  velocityY: 0,
  updatedAt: 0,
};

function loadConfig(): LoadBossCommandConfig {
  const bossRooms = parsePositiveIntEnv("GAME_LOAD_BOSS_ROOMS", 1);
  const expectedCommandResult = process.env.GAME_LOAD_BOSS_EXPECT_COMMAND === "accept"
    || process.env.GAME_LOAD_BOSS_EXPECT_COMMAND === "any"
    ? process.env.GAME_LOAD_BOSS_EXPECT_COMMAND
    : "reject";
  const common = loadCommonConfig(bossRooms);
  return {
    ...common,
    bossRooms,
    playersPerRoom: parsePositiveIntEnv("GAME_LOAD_BOSS_PLAYERS", 20, 2),
    commandsPerPlayer: parsePositiveIntEnv("GAME_LOAD_BOSS_COMMANDS_PER_PLAYER", 3),
    setupMovementLimit: parsePositiveIntEnv("GAME_LOAD_BOSS_SETUP_MOVEMENT_LIMIT", DEFAULT_SETUP_MOVEMENT_LIMIT),
    expectedCommandResult,
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
    actionId: `load-boss-repair-${params.sequence}`,
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
    actionId: `load-boss-movement-${params.sequence}`,
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
    actionId: `load-boss-command-${params.sequence}`,
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
    ...(playerIndex === 0 ? FIRST_PLAYER_POSITION : OTHER_PLAYER_POSITION),
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

async function runVirtualBossRoom(params: {
  index: number;
  endpoint: string;
  config: LoadBossCommandConfig;
}) {
  const startedAt = performance.now();
  const clients = Array.from(
    { length: params.config.playersPerRoom },
    () => createLoadClient(params.endpoint),
  );
  const rooms: ColyseusSdkRoom[] = [];
  const playerIds = Array.from(
    { length: params.config.playersPerRoom },
    (_, playerIndex) => `load-boss-${params.index}-player-${playerIndex}`,
  );

  try {
    const joinStartedAt = performance.now();
    const firstRoom = await clients[0].create(GAME_ROOM_NAMES.boss, {
      combatId: `load-boss-${params.index}`,
      playerId: playerIds[0],
    });
    rooms.push(firstRoom);
    firstRoom.onMessage("scene_snapshot", () => undefined);
    firstRoom.onMessage("timeline_event", () => undefined);
    firstRoom.onMessage("settlement", () => undefined);

    for (let playerIndex = 1; playerIndex < params.config.playersPerRoom; playerIndex += 1) {
      const room = await clients[playerIndex].joinById(firstRoom.roomId, {
        combatId: `load-boss-${params.index}`,
        playerId: playerIds[playerIndex],
      });
      room.onMessage("scene_snapshot", () => undefined);
      room.onMessage("timeline_event", () => undefined);
      room.onMessage("settlement", () => undefined);
      rooms.push(room);
    }
    const joinedAt = performance.now();

    const commandLatencies: number[] = [];
    const rejectedByReason: Record<string, number> = {};
    let acceptedCommands = 0;
    let rejectedCommands = 0;
    let setupMovements = 0;
    const positions = new Map<string, CombatSceneEntity>(
      playerIds.map((playerId, playerIndex) => [playerId, createInitialEntity(playerId, playerIndex)]),
    );

    for (let playerIndex = 0; playerIndex < rooms.length; playerIndex += 1) {
      const targetIndex = playerIndex === 0 ? 1 : 0;
      const baseSequence = params.index * 10_000_000 + playerIndex * 100_000;

      const repairEntities = await sendRepair({
        room: rooms[playerIndex],
        sequence: baseSequence + 1,
        timeoutMs: params.config.timeoutMs,
      });
      for (const [entityId, entity] of indexEntitiesById(repairEntities)) {
        if (playerIds.includes(entityId)) {
          positions.set(entityId, entity);
        }
      }

      const setup = await movePlayerIntoRange({
        room: rooms[playerIndex],
        self: positions.get(playerIds[playerIndex]) || createInitialEntity(playerIds[playerIndex], playerIndex),
        target: positions.get(playerIds[targetIndex]) || createInitialEntity(playerIds[targetIndex], targetIndex),
        sequenceStart: baseSequence + 2,
        timeoutMs: params.config.timeoutMs,
        movementLimit: params.config.setupMovementLimit,
      });
      setupMovements += setup.movements;
      positions.set(playerIds[playerIndex], setup.self);

      for (let step = 0; step < params.config.commandsPerPlayer; step += 1) {
        const result = await sendBasicAttack({
          room: rooms[playerIndex],
          sequence: setup.nextSequence + step,
          timeoutMs: params.config.timeoutMs,
          targetId: playerIds[targetIndex],
        });
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
      joinedPlayers: rooms.length,
      setupMovements,
      acceptedCommands,
      rejectedCommands,
      commandAckAvgMs: average(commandLatencies),
      commandAckP95Ms: createLatencyStats(commandLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
      rejectedByReason,
    } satisfies LoadBossCommandSample;
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
  }
}

function mergeRejectedReasons(samples: LoadBossCommandSample[]) {
  const merged: Record<string, number> = {};
  for (const sample of samples) {
    for (const [reason, count] of Object.entries(sample.rejectedByReason)) {
      merged[reason] = (merged[reason] || 0) + count;
    }
  }
  return merged;
}

function printSummary(params: {
  config: LoadBossCommandConfig;
  endpoint: string;
  samples: LoadBossCommandSample[];
  failures: LoadFailure[];
  health: unknown;
}) {
  const acceptedCommands = params.samples.reduce((sum, sample) => sum + sample.acceptedCommands, 0);
  const rejectedCommands = params.samples.reduce((sum, sample) => sum + sample.rejectedCommands, 0);
  const setupMovements = params.samples.reduce((sum, sample) => sum + sample.setupMovements, 0);
  const joinedPlayers = params.samples.reduce((sum, sample) => sum + sample.joinedPlayers, 0);
  const joinMs = params.samples.map((sample) => sample.joinMs);
  const commandAckAvgMs = params.samples.map((sample) => sample.commandAckAvgMs);
  const commandAckP95Ms = params.samples.map((sample) => sample.commandAckP95Ms);
  const totalMs = params.samples.map((sample) => sample.totalMs);

  const summary = {
    target: params.endpoint,
    requestedBossRooms: params.config.bossRooms,
    playersPerRoom: params.config.playersPerRoom,
    requestedConnections: params.config.bossRooms * params.config.playersPerRoom,
    joinedPlayers,
    concurrency: params.config.concurrency,
    commandsPerPlayer: params.config.commandsPerPlayer,
    expectedCommandResult: params.config.expectedCommandResult,
    requestedCommands: params.config.bossRooms * params.config.playersPerRoom * params.config.commandsPerPlayer,
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
    totalConnections: config.bossRooms,
    concurrency: Math.min(config.concurrency, config.bossRooms),
  }, (index) => runVirtualBossRoom({
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
  const rejectedCommands = samples.reduce((sum, sample) => sum + sample.rejectedCommands, 0);
  const requestedCommands = config.bossRooms * config.playersPerRoom * config.commandsPerPlayer;
  const commandExpectationFailed = config.expectedCommandResult === "accept"
    ? acceptedCommands < requestedCommands
    : config.expectedCommandResult === "reject"
      ? rejectedCommands < requestedCommands || acceptedCommands > 0
      : acceptedCommands + rejectedCommands < requestedCommands;
  if (failures.length > 0 || commandExpectationFailed) {
    process.exitCode = 1;
  }
});
