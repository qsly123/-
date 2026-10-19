import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type CombatSceneEntity,
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

interface LoadCombatCommandConfig extends LoadCommonConfig {
  battles: number;
  commandsPerBattle: number;
  setupMovementLimit: number;
}

interface LoadCombatCommandSample {
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

const DEFAULT_SETUP_MOVEMENT_LIMIT = 16;
const DEFAULT_MAX_STEP_PERCENT = 6;
const DEFAULT_TARGET_RANGE_PERCENT = 14;
const DEFAULT_ATTACKER: CombatSceneEntity = {
  id: "attacker",
  kind: "combatant",
  name: "attacker",
  x: 50,
  y: 76,
  velocityX: 0,
  velocityY: 0,
  updatedAt: 0,
};
const DEFAULT_TARGET: CombatSceneEntity = {
  id: "target",
  kind: "combatant",
  name: "target",
  x: 52,
  y: 24,
  velocityX: 0,
  velocityY: 0,
  updatedAt: 0,
};

function loadConfig(): LoadCombatCommandConfig {
  const common = loadCommonConfig(4);
  return {
    ...common,
    battles: parsePositiveIntEnv("GAME_LOAD_BATTLES", common.totalConnections),
    commandsPerBattle: parsePositiveIntEnv("GAME_LOAD_COMMANDS_PER_BATTLE", 8),
    setupMovementLimit: parsePositiveIntEnv("GAME_LOAD_COMBAT_SETUP_MOVEMENT_LIMIT", DEFAULT_SETUP_MOVEMENT_LIMIT),
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

  params.room.send("input", createRealtimeClientInput({
    clientSequence: params.sequence,
    clientSceneTick: 0,
    actionId: `load-combat-repair-${params.sequence}`,
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  }));

  await ackPromise;
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
    actionId: `load-combat-movement-${params.sequence}`,
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
    actionId: `load-combat-command-${params.sequence}`,
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

async function moveAttackerIntoRange(params: {
  room: ColyseusSdkRoom;
  attacker: CombatSceneEntity;
  target: CombatSceneEntity;
  sequenceStart: number;
  timeoutMs: number;
  movementLimit: number;
}) {
  let attacker = { ...params.attacker };
  let sequence = params.sequenceStart;
  let movements = 0;
  const maxStep = DEFAULT_MAX_STEP_PERCENT;
  const targetRange = DEFAULT_TARGET_RANGE_PERCENT;

  for (let attempt = 0; attempt < params.movementLimit; attempt += 1) {
    if (distance(attacker, params.target) <= targetRange) {
      break;
    }

    const next = nextStepToward({
      from: attacker,
      to: params.target,
      maxStep,
      targetRange,
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
    attacker = {
      ...attacker,
      x: Number(authoritativeState?.x ?? next.x),
      y: Number(authoritativeState?.y ?? next.y),
    };
    movements += 1;
  }

  return {
    attacker,
    nextSequence: sequence,
    movements,
  };
}

async function runVirtualBattle(params: {
  index: number;
  endpoint: string;
  config: LoadCombatCommandConfig;
}) {
  const startedAt = performance.now();
  const attackerClient = createLoadClient(params.endpoint);
  const targetClient = createLoadClient(params.endpoint);
  let attackerRoom: ColyseusSdkRoom | null = null;
  let targetRoom: ColyseusSdkRoom | null = null;

  const attackerId = `load-combat-attacker-${params.index}`;
  const targetId = `load-combat-target-${params.index}`;

  try {
    const joinStartedAt = performance.now();
    attackerRoom = await attackerClient.create(GAME_ROOM_NAMES.combat, {
      combatId: `load-combat-${params.index}`,
      playerId: attackerId,
    });
    targetRoom = await targetClient.joinById(attackerRoom.roomId, {
      combatId: `load-combat-${params.index}`,
      playerId: targetId,
    });
    const joinedAt = performance.now();

    attackerRoom.onMessage("scene_snapshot", () => undefined);
    targetRoom.onMessage("scene_snapshot", () => undefined);

    const baseSequence = params.index * 100_000;
    await sendRepair({
      room: attackerRoom,
      sequence: baseSequence + 1,
      timeoutMs: params.config.timeoutMs,
    });

    const setup = await moveAttackerIntoRange({
      room: attackerRoom,
      attacker: {
        ...DEFAULT_ATTACKER,
        id: attackerId,
        name: attackerId,
      },
      target: {
        ...DEFAULT_TARGET,
        id: targetId,
        name: targetId,
      },
      sequenceStart: baseSequence + 2,
      timeoutMs: params.config.timeoutMs,
      movementLimit: params.config.setupMovementLimit,
    });

    const commandLatencies: number[] = [];
    const rejectedByReason: Record<string, number> = {};
    let acceptedCommands = 0;
    let rejectedCommands = 0;

    for (let step = 0; step < params.config.commandsPerBattle; step += 1) {
      const result = await sendBasicAttack({
        room: attackerRoom,
        sequence: setup.nextSequence + step,
        timeoutMs: params.config.timeoutMs,
        targetId,
      });
      commandLatencies.push(result.ackMs);
      if (result.ack.accepted) {
        acceptedCommands += 1;
      } else {
        rejectedCommands += 1;
        addRejectedReason(rejectedByReason, result.ack.reason);
      }
    }

    return {
      index: params.index,
      joinMs: Math.round(joinedAt - joinStartedAt),
      setupMovements: setup.movements,
      acceptedCommands,
      rejectedCommands,
      commandAckAvgMs: average(commandLatencies),
      commandAckP95Ms: createLatencyStats(commandLatencies).p95,
      totalMs: Math.round(performance.now() - startedAt),
      rejectedByReason,
    } satisfies LoadCombatCommandSample;
  } finally {
    await attackerRoom?.leave(true);
    await targetRoom?.leave(true);
  }
}

function mergeRejectedReasons(samples: LoadCombatCommandSample[]) {
  const merged: Record<string, number> = {};
  for (const sample of samples) {
    for (const [reason, count] of Object.entries(sample.rejectedByReason)) {
      merged[reason] = (merged[reason] || 0) + count;
    }
  }
  return merged;
}

function printSummary(params: {
  config: LoadCombatCommandConfig;
  endpoint: string;
  samples: LoadCombatCommandSample[];
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
    requestedBattles: params.config.battles,
    requestedConnections: params.config.battles * 2,
    concurrency: params.config.concurrency,
    commandsPerBattle: params.config.commandsPerBattle,
    requestedCommands: params.config.battles * params.config.commandsPerBattle,
    successfulBattles: params.samples.length,
    failedBattles: params.failures.length,
    setupMovements,
    acceptedCommands,
    rejectedCommands,
    rejectedByReason: mergeRejectedReasons(params.samples),
    latencyMs: {
      join: createLatencyStats(joinMs),
      commandAckAvgAcrossBattles: createLatencyStats(commandAckAvgMs),
      commandAckP95AcrossBattles: createLatencyStats(commandAckP95Ms),
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
    totalConnections: config.battles,
    concurrency: Math.min(config.concurrency, config.battles),
  }, (index) => runVirtualBattle({
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
