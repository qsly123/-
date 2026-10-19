export * from "./damage-formula";
export * from "./runtime-ruleset";

export interface GridPosition {
  x: number;
  y: number;
}

export interface MovementIntent {
  from: GridPosition;
  to: GridPosition;
  blockedTiles?: ReadonlySet<string>;
  occupiedTiles?: ReadonlySet<string>;
  mapWidth?: number;
  mapHeight?: number;
}

export interface MovementDecision {
  accepted: boolean;
  position: GridPosition;
  reason?: "invalid_position" | "out_of_bounds" | "blocked" | "too_far";
}

function tileKey(position: GridPosition) {
  return `${position.x}:${position.y}`;
}

function hasBlockingTile(
  position: GridPosition,
  blockedTiles?: ReadonlySet<string>,
  occupiedTiles?: ReadonlySet<string>,
) {
  const key = tileKey(position);
  return Boolean(blockedTiles?.has(key) || occupiedTiles?.has(key));
}

function isValidGridPosition(position: GridPosition) {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isInteger(position.x)
    && Number.isInteger(position.y);
}

function isValidFinitePosition(position: GridPosition) {
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

export function decideGridMovement(intent: MovementIntent): MovementDecision {
  if (!isValidGridPosition(intent.from) || !isValidGridPosition(intent.to)) {
    return {
      accepted: false,
      position: intent.from,
      reason: "invalid_position",
    };
  }

  const dx = Math.abs(intent.to.x - intent.from.x);
  const dy = Math.abs(intent.to.y - intent.from.y);
  if (Math.max(dx, dy) > 1) {
    return {
      accepted: false,
      position: intent.from,
      reason: "too_far",
    };
  }

  if (
    (typeof intent.mapWidth === "number" && (intent.to.x < 0 || intent.to.x >= intent.mapWidth))
    || (typeof intent.mapHeight === "number" && (intent.to.y < 0 || intent.to.y >= intent.mapHeight))
  ) {
    return {
      accepted: false,
      position: intent.from,
      reason: "out_of_bounds",
    };
  }

  if (hasBlockingTile(intent.to, intent.blockedTiles, intent.occupiedTiles)) {
    return {
      accepted: false,
      position: intent.from,
      reason: "blocked",
    };
  }

  if (
    dx === 1
    && dy === 1
    && (
      hasBlockingTile({ x: intent.to.x, y: intent.from.y }, intent.blockedTiles, intent.occupiedTiles)
      || hasBlockingTile({ x: intent.from.x, y: intent.to.y }, intent.blockedTiles, intent.occupiedTiles)
    )
  ) {
    return {
      accepted: false,
      position: intent.from,
      reason: "blocked",
    };
  }

  return {
    accepted: true,
    position: intent.to,
  };
}

export interface CombatCommandIntent {
  actorId: string;
  targetId?: string;
  commandType: BattleCommandType;
  nowMs: number;
  ruleset?: BattleRuleset;
  cooldownReadyAtMs?: number;
  distance?: BattleDistanceResult;
}

export interface CombatCommandDecision {
  accepted: boolean;
  reason?: BattleCommandRejectReason;
}

export type BattleMode = "solo" | "party" | "boss" | "pvp";

export type BattleCommandType =
  | "basicAttack"
  | "skill"
  | "item"
  | "flee"
  | "surrender"
  | "repair"
  | "ready"
  | "movement"
  | "timeoutAdvance";

export type BattleCommandRejectReason =
  | "missing_actor"
  | "missing_target"
  | "unsupported"
  | "on_cooldown"
  | "out_of_range"
  | "invalid_position"
  | "too_far";

export interface BattleRuleset {
  mode: BattleMode;
  label: string;
  sharedTurn: boolean;
  supportsRealtime: boolean;
  allowedCommands: BattleCommandType[];
  movement: {
    enabled: boolean;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxStepPercent: number;
  };
  hit: {
    contactRangePercent: number;
    grazeRangePercent: number;
  };
  cooldown: {
    globalCooldownMs: number;
    itemCooldownMs: number;
    surrenderCooldownMs: number;
  };
  timeout: {
    turnTimeoutMs: number;
    repairOnReconnect: boolean;
    autoAdvanceOnTimeout: boolean;
  };
  settlement: {
    policy: "instant" | "shared_reward" | "claim_based";
  };
}

export interface BattleDistanceResult {
  dx: number;
  dy: number;
  direct: number;
}

export interface BattleDamageInput {
  attack: number;
  defense: number;
  baseDamage?: number;
  multiplier?: number;
  randomFactor?: number;
  speed?: number;
  luck?: number;
  armorPenetration?: number;
  skillDamageBonus?: number;
  targetDamageReduction?: number;
}

export interface BattleDamageResult {
  damage: number;
  effectiveDefense: number;
}

export interface BattleMovementIntent {
  ruleset: BattleRuleset;
  from: GridPosition;
  to: GridPosition;
}

export interface BattleMovementDecision {
  accepted: boolean;
  position: GridPosition;
  reason?: "invalid_position" | "out_of_bounds" | "too_far" | "unsupported";
}

export interface BattleSettlementIntent {
  idempotencyKey: string;
  battleId: string;
  mode: BattleMode;
  winnerId: string | null;
  loserId: string | null;
  reason: "victory" | "defeat" | "surrender" | "timeout" | "abort";
  occurredAt: number;
}

export interface BattleDeathPenaltyIntent {
  playerId: string;
  battleId: string;
  mode: BattleMode;
  shouldApply: boolean;
  reason: "pve_defeat" | "pvp_defeat" | "surrender" | "none";
}

export interface BattleRewardIntent {
  idempotencyKey: string;
  battleId: string;
  mode: BattleMode;
  playerId: string;
  xp: number;
  gold: number;
  source: "victory" | "participation" | "claim" | "none";
}

export interface BattleDropIntentItem {
  itemId: string;
  quantity: number;
  reason: "guaranteed" | "roll" | "none";
}

export interface BattleDropIntent {
  idempotencyKey: string;
  battleId: string;
  mode: BattleMode;
  playerId: string;
  items: BattleDropIntentItem[];
  source: "victory" | "participation" | "claim" | "none";
}

export interface PvpTimeoutDecision {
  shouldAdvance: boolean;
  reason?: "timeout" | "disabled" | "not_due";
}

const DEFAULT_BATTLE_MOVEMENT = {
  minX: 4,
  maxX: 96,
  minY: 8,
  maxY: 88,
  maxStepPercent: 8,
} as const;

const DEFAULT_BATTLE_TIMEOUT = {
  turnTimeoutMs: 12_000,
  repairOnReconnect: true,
  autoAdvanceOnTimeout: true,
} as const;

const BATTLE_RULESETS: Record<BattleMode, BattleRuleset> = {
  solo: {
    mode: "solo",
    label: "普通战斗规则",
    sharedTurn: false,
    supportsRealtime: true,
    allowedCommands: ["basicAttack", "skill", "item", "flee", "surrender", "repair", "movement"],
    movement: {
      ...DEFAULT_BATTLE_MOVEMENT,
      enabled: true,
    },
    hit: {
      contactRangePercent: 16,
      grazeRangePercent: 24,
    },
    cooldown: {
      globalCooldownMs: 800,
      itemCooldownMs: 1200,
      surrenderCooldownMs: 0,
    },
    timeout: DEFAULT_BATTLE_TIMEOUT,
    settlement: {
      policy: "instant",
    },
  },
  party: {
    mode: "party",
    label: "组队战斗规则",
    sharedTurn: true,
    supportsRealtime: true,
    allowedCommands: ["basicAttack", "skill", "item", "flee", "surrender", "repair", "ready", "movement", "timeoutAdvance"],
    movement: {
      ...DEFAULT_BATTLE_MOVEMENT,
      enabled: true,
      maxStepPercent: 7,
    },
    hit: {
      contactRangePercent: 18,
      grazeRangePercent: 26,
    },
    cooldown: {
      globalCooldownMs: 900,
      itemCooldownMs: 1500,
      surrenderCooldownMs: 0,
    },
    timeout: DEFAULT_BATTLE_TIMEOUT,
    settlement: {
      policy: "shared_reward",
    },
  },
  boss: {
    mode: "boss",
    label: "首领战规则",
    sharedTurn: true,
    supportsRealtime: true,
    allowedCommands: ["basicAttack", "skill", "item", "flee", "surrender", "repair", "ready", "movement", "timeoutAdvance"],
    movement: {
      ...DEFAULT_BATTLE_MOVEMENT,
      enabled: true,
      maxStepPercent: 7,
    },
    hit: {
      contactRangePercent: 20,
      grazeRangePercent: 30,
    },
    cooldown: {
      globalCooldownMs: 900,
      itemCooldownMs: 1600,
      surrenderCooldownMs: 0,
    },
    timeout: DEFAULT_BATTLE_TIMEOUT,
    settlement: {
      policy: "claim_based",
    },
  },
  pvp: {
    mode: "pvp",
    label: "论道规则",
    sharedTurn: false,
    supportsRealtime: true,
    allowedCommands: ["basicAttack", "skill", "item", "surrender", "repair", "ready", "movement", "timeoutAdvance"],
    movement: {
      ...DEFAULT_BATTLE_MOVEMENT,
      enabled: true,
      maxStepPercent: 6,
    },
    hit: {
      contactRangePercent: 14,
      grazeRangePercent: 22,
    },
    cooldown: {
      globalCooldownMs: 1000,
      itemCooldownMs: 1800,
      surrenderCooldownMs: 0,
    },
    timeout: {
      ...DEFAULT_BATTLE_TIMEOUT,
      turnTimeoutMs: 10_000,
    },
    settlement: {
      policy: "instant",
    },
  },
};

function sanitizeFiniteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

export function getBattleRuleset(mode: BattleMode): BattleRuleset {
  return BATTLE_RULESETS[mode];
}

export function battleRulesetSupportsCommand(
  ruleset: BattleRuleset,
  commandType: BattleCommandType,
) {
  return ruleset.allowedCommands.includes(commandType);
}

export function decideCombatCommand(intent: CombatCommandIntent): CombatCommandDecision {
  if (!intent.actorId.trim()) {
    return { accepted: false, reason: "missing_actor" };
  }
  const ruleset = intent.ruleset || BATTLE_RULESETS.solo;
  if (!battleRulesetSupportsCommand(ruleset, intent.commandType)) {
    return { accepted: false, reason: "unsupported" };
  }
  if ((intent.commandType === "skill" || intent.commandType === "basicAttack") && !intent.targetId?.trim()) {
    return { accepted: false, reason: "missing_target" };
  }
  if (intent.nowMs < 1) {
    return { accepted: false, reason: "unsupported" };
  }
  if (
    typeof intent.cooldownReadyAtMs === "number"
    && intent.cooldownReadyAtMs > intent.nowMs
  ) {
    return { accepted: false, reason: "on_cooldown" };
  }
  if (
    (intent.commandType === "skill" || intent.commandType === "basicAttack")
    && intent.distance
    && intent.distance.direct > ruleset.hit.grazeRangePercent
  ) {
    return { accepted: false, reason: "out_of_range" };
  }
  return { accepted: true };
}

export function calculateBattleDistance(
  from: GridPosition,
  to: GridPosition,
): BattleDistanceResult {
  const dx = Math.abs(sanitizeFiniteNumber(to.x, 0) - sanitizeFiniteNumber(from.x, 0));
  const dy = Math.abs(sanitizeFiniteNumber(to.y, 0) - sanitizeFiniteNumber(from.y, 0));
  return {
    dx,
    dy,
    direct: Math.hypot(dx, dy),
  };
}

export function decideBattleMovement(intent: BattleMovementIntent): BattleMovementDecision {
  if (!intent.ruleset.movement.enabled) {
    return {
      accepted: false,
      position: intent.from,
      reason: "unsupported",
    };
  }
  if (!isValidFinitePosition(intent.from) || !isValidFinitePosition(intent.to)) {
    return {
      accepted: false,
      position: intent.from,
      reason: "invalid_position",
    };
  }
  if (
    intent.to.x < intent.ruleset.movement.minX
    || intent.to.x > intent.ruleset.movement.maxX
    || intent.to.y < intent.ruleset.movement.minY
    || intent.to.y > intent.ruleset.movement.maxY
  ) {
    return {
      accepted: false,
      position: intent.from,
      reason: "out_of_bounds",
    };
  }
  const distance = calculateBattleDistance(intent.from, intent.to);
  if (distance.direct > intent.ruleset.movement.maxStepPercent) {
    return {
      accepted: false,
      position: intent.from,
      reason: "too_far",
    };
  }
  return {
    accepted: true,
    position: intent.to,
  };
}

export function calculateBattleDamage(input: BattleDamageInput): BattleDamageResult {
  const attack = Math.max(0, sanitizeFiniteNumber(input.attack, 0));
  const defense = Math.max(0, sanitizeFiniteNumber(input.defense, 0));
  const armorPenetration = Math.max(0, sanitizeFiniteNumber(input.armorPenetration ?? 0, 0));
  const effectiveDefense = Math.max(0, defense - armorPenetration);
  const baseDamage = Math.max(0, sanitizeFiniteNumber(input.baseDamage ?? 0, 0));
  const multiplier = Math.max(0, sanitizeFiniteNumber(input.multiplier ?? 1, 1));
  const randomFactor = Math.max(0, sanitizeFiniteNumber(input.randomFactor ?? 1, 1));
  const speed = Math.max(0, sanitizeFiniteNumber(input.speed ?? 0, 0));
  const luck = Math.max(0, sanitizeFiniteNumber(input.luck ?? 0, 0));
  const skillDamageBonus = sanitizeFiniteNumber(input.skillDamageBonus ?? 0, 0);
  const targetDamageReduction = Math.max(0, sanitizeFiniteNumber(input.targetDamageReduction ?? 0, 0));
  const raw = (
    (attack + speed * 0.2 + luck * 0.1) * multiplier
    + baseDamage
  ) * (100 / (100 + effectiveDefense)) * randomFactor;
  const scaled = raw * (1 + skillDamageBonus) * Math.max(0, 1 - targetDamageReduction);

  return {
    damage: Math.max(1, Math.floor(scaled)),
    effectiveDefense,
  };
}

export function createBattleSettlementIntent(params: {
  battleId: string;
  mode: BattleMode;
  winnerId?: string | null;
  loserId?: string | null;
  reason: BattleSettlementIntent["reason"];
  occurredAt: number;
}): BattleSettlementIntent {
  const occurredAt = Math.max(1, Math.floor(sanitizeFiniteNumber(params.occurredAt, Date.now())));
  const winnerId = params.winnerId?.trim() || null;
  const loserId = params.loserId?.trim() || null;
  return {
    idempotencyKey: [
      "battle-settlement",
      params.mode,
      params.battleId,
      winnerId || "none",
      loserId || "none",
      params.reason,
    ].join(":"),
    battleId: params.battleId,
    mode: params.mode,
    winnerId,
    loserId,
    reason: params.reason,
    occurredAt,
  };
}

export function createBattleDeathPenaltyIntent(params: {
  playerId: string;
  battleId: string;
  mode: BattleMode;
  defeated: boolean;
  surrendered?: boolean;
}): BattleDeathPenaltyIntent {
  const playerId = params.playerId.trim();
  const shouldApply = Boolean(playerId) && params.defeated && params.mode !== "boss";
  return {
    playerId,
    battleId: params.battleId,
    mode: params.mode,
    shouldApply,
    reason: shouldApply
      ? (params.surrendered ? "surrender" : params.mode === "pvp" ? "pvp_defeat" : "pve_defeat")
      : "none",
  };
}

export function createBattleRewardIntent(params: {
  battleId: string;
  mode: BattleMode;
  playerId: string;
  reason: BattleSettlementIntent["reason"];
  xp?: number;
  gold?: number;
}): BattleRewardIntent {
  const playerId = params.playerId.trim();
  const source = params.reason === "victory"
    ? "victory"
    : params.mode === "party" || params.mode === "boss"
      ? "participation"
      : "none";
  const xp = Math.max(0, Math.floor(sanitizeFiniteNumber(params.xp ?? 0, 0)));
  const gold = Math.max(0, Math.floor(sanitizeFiniteNumber(params.gold ?? 0, 0)));

  return {
    idempotencyKey: [
      "battle-reward",
      params.mode,
      params.battleId,
      playerId || "none",
      params.reason,
    ].join(":"),
    battleId: params.battleId,
    mode: params.mode,
    playerId,
    xp,
    gold,
    source,
  };
}

export function createBattleDropIntent(params: {
  battleId: string;
  mode: BattleMode;
  playerId: string;
  reason: BattleSettlementIntent["reason"];
  items?: BattleDropIntentItem[];
}): BattleDropIntent {
  const playerId = params.playerId.trim();
  const source = params.reason === "victory"
    ? "victory"
    : params.mode === "boss"
      ? "claim"
      : params.mode === "party"
        ? "participation"
        : "none";
  const items = (params.items || [])
    .map((item) => ({
      itemId: item.itemId.trim(),
      quantity: Math.max(0, Math.floor(sanitizeFiniteNumber(item.quantity, 0))),
      reason: item.reason,
    }))
    .filter((item) => item.itemId && item.quantity > 0);

  return {
    idempotencyKey: [
      "battle-drop",
      params.mode,
      params.battleId,
      playerId || "none",
      params.reason,
    ].join(":"),
    battleId: params.battleId,
    mode: params.mode,
    playerId,
    items,
    source,
  };
}

export function decidePvpTimeoutAdvance(params: {
  ruleset: BattleRuleset;
  nowMs: number;
  lastInputAtMs: number;
}): PvpTimeoutDecision {
  if (params.ruleset.mode !== "pvp" || !params.ruleset.timeout.autoAdvanceOnTimeout) {
    return { shouldAdvance: false, reason: "disabled" };
  }
  const elapsed = params.nowMs - params.lastInputAtMs;
  if (!Number.isFinite(elapsed) || elapsed < params.ruleset.timeout.turnTimeoutMs) {
    return { shouldAdvance: false, reason: "not_due" };
  }
  return { shouldAdvance: true, reason: "timeout" };
}
