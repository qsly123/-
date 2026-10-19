import type { BattleMode } from "./index";

export type BattleRuntimeCommandType =
  | "move"
  | "target"
  | "cast_skill"
  | "use_item"
  | "ready"
  | "timeoutAdvance"
  | "flee"
  | "surrender"
  | "ack_snapshot"
  | "request_repair";

export type BattleRuntimeSettlementPolicy = "instant" | "claim_based" | "shared_reward" | "replay_only";

export interface BattleRuntimeHitWindow {
  windupMs: number;
  activeMs: number;
  recoverMs: number;
  movementLockMs?: number;
}

export interface BattleRuntimeCollisionProfile {
  enabled: boolean;
  entityBlocking: boolean;
  mapBoundaryBlocking: boolean;
  separationPercent: number;
}

export interface BattleRuntimeRuleset {
  mode: BattleMode;
  label: string;
  sharedTurn: boolean;
  supportsRealtime: boolean;
  allowedCommands: BattleRuntimeCommandType[];
  spatialPolicy?: {
    enabled: boolean;
    supportsMovement: boolean;
    supportsContactRange: boolean;
    defaultContactRangePercent: number;
    defaultHitWindow: BattleRuntimeHitWindow;
  };
  collisionPolicy?: BattleRuntimeCollisionProfile;
  timeoutPolicy?: {
    turnTimeoutMs: number;
    repairOnReconnect: boolean;
    autoAdvanceOnTimeout: boolean;
  };
  settlementPolicy: BattleRuntimeSettlementPolicy;
}

const DEFAULT_HIT_WINDOW = {
  windupMs: 180,
  activeMs: 220,
  recoverMs: 320,
  movementLockMs: 220,
} as const;

const DEFAULT_TIMEOUT_POLICY = {
  turnTimeoutMs: 12_000,
  repairOnReconnect: true,
  autoAdvanceOnTimeout: true,
} as const;

const STATIC_COLLISION_POLICY = {
  enabled: true,
  entityBlocking: true,
  mapBoundaryBlocking: true,
  separationPercent: 4,
} as const;

const SOLO_COMMANDS: BattleRuntimeCommandType[] = [
  "move",
  "target",
  "cast_skill",
  "use_item",
  "flee",
  "ack_snapshot",
  "request_repair",
];

const PARTY_COMMANDS: BattleRuntimeCommandType[] = [
  "target",
  "cast_skill",
  "use_item",
  "ready",
  "timeoutAdvance",
  "flee",
  "ack_snapshot",
  "request_repair",
];

const BOSS_COMMANDS: BattleRuntimeCommandType[] = [
  "move",
  "cast_skill",
  "use_item",
  "ready",
  "flee",
  "ack_snapshot",
  "request_repair",
];

const PVP_COMMANDS: BattleRuntimeCommandType[] = [
  "move",
  "ready",
  "cast_skill",
  "use_item",
  "surrender",
  "timeoutAdvance",
  "ack_snapshot",
  "request_repair",
];

const BATTLE_RUNTIME_RULESETS: Record<BattleMode, BattleRuntimeRuleset> = {
  solo: {
    mode: "solo",
    label: "普通战斗规则",
    sharedTurn: false,
    supportsRealtime: true,
    allowedCommands: SOLO_COMMANDS,
    spatialPolicy: {
      enabled: true,
      supportsMovement: true,
      supportsContactRange: true,
      defaultContactRangePercent: 10,
      defaultHitWindow: DEFAULT_HIT_WINDOW,
    },
    collisionPolicy: STATIC_COLLISION_POLICY,
    timeoutPolicy: DEFAULT_TIMEOUT_POLICY,
    settlementPolicy: "instant",
  },
  party: {
    mode: "party",
    label: "组队战斗规则",
    sharedTurn: true,
    supportsRealtime: true,
    allowedCommands: PARTY_COMMANDS,
    spatialPolicy: {
      enabled: true,
      supportsMovement: false,
      supportsContactRange: true,
      defaultContactRangePercent: 11,
      defaultHitWindow: DEFAULT_HIT_WINDOW,
    },
    collisionPolicy: STATIC_COLLISION_POLICY,
    timeoutPolicy: DEFAULT_TIMEOUT_POLICY,
    settlementPolicy: "shared_reward",
  },
  boss: {
    mode: "boss",
    label: "首领战规则",
    sharedTurn: true,
    supportsRealtime: true,
    allowedCommands: BOSS_COMMANDS,
    spatialPolicy: {
      enabled: true,
      supportsMovement: true,
      supportsContactRange: true,
      defaultContactRangePercent: 12,
      defaultHitWindow: {
        ...DEFAULT_HIT_WINDOW,
        recoverMs: 380,
        movementLockMs: 260,
      },
    },
    collisionPolicy: {
      ...STATIC_COLLISION_POLICY,
      separationPercent: 5,
    },
    timeoutPolicy: DEFAULT_TIMEOUT_POLICY,
    settlementPolicy: "claim_based",
  },
  pvp: {
    mode: "pvp",
    label: "论道规则",
    sharedTurn: false,
    supportsRealtime: true,
    allowedCommands: PVP_COMMANDS,
    spatialPolicy: {
      enabled: true,
      supportsMovement: true,
      supportsContactRange: true,
      defaultContactRangePercent: 9,
      defaultHitWindow: DEFAULT_HIT_WINDOW,
    },
    collisionPolicy: STATIC_COLLISION_POLICY,
    timeoutPolicy: DEFAULT_TIMEOUT_POLICY,
    settlementPolicy: "instant",
  },
};

export function getBattleRuntimeRuleset(mode: BattleMode): BattleRuntimeRuleset {
  return BATTLE_RUNTIME_RULESETS[mode];
}

export function battleRuntimeRulesetSupportsCommand(
  mode: BattleMode,
  commandType: BattleRuntimeCommandType,
) {
  return BATTLE_RUNTIME_RULESETS[mode].allowedCommands.includes(commandType);
}
