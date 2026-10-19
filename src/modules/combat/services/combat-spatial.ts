import type { CombatState } from "@/types/game";

type CombatSpatialSkillLike = {
  skillType?: string;
};

export type CombatScenePositions = {
  playerXPercent: number;
  playerYPercent: number;
  enemyXPercent: number;
  enemyYPercent: number;
  horizontalDistancePercent: number;
  verticalDistancePercent: number;
  directDistancePercent: number;
};

export type CombatSkillContactResult = {
  outcome: "hit" | "graze" | "miss";
  damageScale: number;
  resultLabel?: string;
  messageSuffix?: string;
};

export type CombatEnemyAiMovementPlan = {
  targetXPercent: number;
  targetYPercent: number;
  horizontalSpeedPercentPerSecond: number;
  verticalSpeedPercentPerSecond: number;
};

export type CombatActorAutoMovementPlan = {
  targetXPercent: number;
  targetYPercent: number;
};

type CombatSkillRangeProfile = {
  requiresContact: boolean;
  hitWindowPercent: number;
  grazeWindowPercent: number;
  preferredOffsetPercent: number;
  movementStepPercent: number;
};

export const COMBAT_SCENE_X_MIN_PERCENT = 4;
export const COMBAT_SCENE_X_MAX_PERCENT = 96;
export const COMBAT_SCENE_PLAYER_Y_MIN_PERCENT = 8;
export const COMBAT_SCENE_PLAYER_Y_MAX_PERCENT = 88;
export const COMBAT_SCENE_ENEMY_Y_MIN_PERCENT = 12;
export const COMBAT_SCENE_ENEMY_Y_MAX_PERCENT = 82;
const COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS = 0.36;
const COMBAT_SCENE_TARGET_HOLD_TOLERANCE_PERCENT = 1.2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function clampCombatSceneXPercent(value: number) {
  return clamp(value, COMBAT_SCENE_X_MIN_PERCENT, COMBAT_SCENE_X_MAX_PERCENT);
}

export function clampCombatScenePlayerYPercent(value: number) {
  return clamp(value, COMBAT_SCENE_PLAYER_Y_MIN_PERCENT, COMBAT_SCENE_PLAYER_Y_MAX_PERCENT);
}

export function clampCombatSceneEnemyYPercent(value: number) {
  return clamp(value, COMBAT_SCENE_ENEMY_Y_MIN_PERCENT, COMBAT_SCENE_ENEMY_Y_MAX_PERCENT);
}

function moveTowards(current: number, target: number, maxStep: number) {
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) {
    return target;
  }
  return current + (Math.sign(delta) * maxStep);
}

function getSeededRatio(seedValue: number) {
  const raw = Math.sin(seedValue * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function getSkillRangeProfile(skillType?: string, skillId?: string): CombatSkillRangeProfile {
  if (skillType === "heal" || skillType === "shield" || skillType === "utility") {
    return {
      requiresContact: false,
      hitWindowPercent: 999,
      grazeWindowPercent: 999,
      preferredOffsetPercent: 8,
      movementStepPercent: 5,
    };
  }

  if (skillType === "aoe") {
    return {
      requiresContact: true,
      hitWindowPercent: 24,
      grazeWindowPercent: 34,
      preferredOffsetPercent: 9,
      movementStepPercent: 5.5,
    };
  }

  if (skillType === "dot" || skillType === "debuff") {
    return {
      requiresContact: true,
      hitWindowPercent: 18,
      grazeWindowPercent: 26,
      preferredOffsetPercent: 6,
      movementStepPercent: 6,
    };
  }

  if (skillId === "skill_basic_attack") {
    return {
      requiresContact: true,
      hitWindowPercent: 14,
      grazeWindowPercent: 20,
      preferredOffsetPercent: 3,
      movementStepPercent: 7,
    };
  }

  return {
    requiresContact: true,
    hitWindowPercent: 16,
    grazeWindowPercent: 23,
    preferredOffsetPercent: 4,
    movementStepPercent: 6.5,
  };
}

function resolveStableFlankSign(currentActorXPercent: number, currentTargetXPercent: number, fallbackSign: -1 | 1) {
  const delta = currentActorXPercent - currentTargetXPercent;
  if (Math.abs(delta) <= 0.4) {
    return fallbackSign;
  }
  return delta < 0 ? -1 : 1;
}

function shouldHoldCurrentCombatPosition(params: {
  currentDirectDistance: number;
  profile: CombatSkillRangeProfile;
}) {
  if (!params.profile.requiresContact) {
    return true;
  }
  return params.currentDirectDistance <= (params.profile.hitWindowPercent + COMBAT_SCENE_TARGET_HOLD_TOLERANCE_PERCENT);
}

export function resolveCombatActorAutoMovementPlan(params: {
  actorIsPlayer: boolean;
  currentActorXPercent: number;
  currentActorYPercent: number;
  currentTargetXPercent: number;
  currentTargetYPercent: number;
  preferredSkillId?: string | null;
  preferredSkill?: CombatSpatialSkillLike | null;
}): CombatActorAutoMovementPlan {
  const profile = getSkillRangeProfile(params.preferredSkill?.skillType, params.preferredSkillId || undefined);
  const flankSign = resolveStableFlankSign(
    params.currentActorXPercent,
    params.currentTargetXPercent,
    -1,
  );
  const currentDirectDistance = Math.hypot(
    params.currentActorXPercent - params.currentTargetXPercent,
    params.currentActorYPercent - params.currentTargetYPercent,
  );

  if (shouldHoldCurrentCombatPosition({
    currentDirectDistance,
    profile,
  })) {
    return {
      targetXPercent: clampCombatSceneXPercent(params.currentActorXPercent),
      targetYPercent: params.actorIsPlayer
        ? clampCombatScenePlayerYPercent(params.currentActorYPercent)
        : clampCombatSceneEnemyYPercent(params.currentActorYPercent),
    };
  }

  let desiredXPercent = params.currentTargetXPercent + (flankSign * profile.preferredOffsetPercent);
  let desiredYPercent = params.currentTargetYPercent + (
    params.actorIsPlayer
      ? Math.max(9, profile.preferredOffsetPercent * 1.12)
      : -Math.max(9, profile.preferredOffsetPercent * 0.9)
  );

  if (profile.requiresContact && currentDirectDistance > profile.hitWindowPercent * 1.08) {
    desiredXPercent = params.currentTargetXPercent + (flankSign * Math.min(3.2, profile.preferredOffsetPercent * 0.45));
    desiredYPercent = params.currentTargetYPercent + (
      params.actorIsPlayer
        ? Math.max(5.2, profile.preferredOffsetPercent * 0.58)
        : -Math.max(4.5, profile.preferredOffsetPercent * 0.35)
    );
  }

  if (!profile.requiresContact) {
    desiredXPercent = params.currentTargetXPercent + (flankSign * Math.max(8, profile.preferredOffsetPercent));
    desiredYPercent = params.actorIsPlayer
      ? params.currentTargetYPercent + 26
      : params.currentTargetYPercent - 24;
  }

  return {
    targetXPercent: clampCombatSceneXPercent(desiredXPercent),
    targetYPercent: params.actorIsPlayer
      ? clampCombatScenePlayerYPercent(desiredYPercent)
      : clampCombatSceneEnemyYPercent(desiredYPercent),
  };
}

export function getCombatScenePositions(
  state: CombatState,
  positionOverrides?: Record<string, { xPercent?: number; yPercent?: number }>,
): CombatScenePositions {
  const playerPosition = positionOverrides?.[state.player.id];
  const enemyPosition = positionOverrides?.[state.enemy.id];
  const playerXPercent = clampCombatSceneXPercent(playerPosition?.xPercent ?? 50);
  const playerYPercent = clampCombatScenePlayerYPercent(playerPosition?.yPercent ?? 76);
  const enemyXPercent = clampCombatSceneXPercent(enemyPosition?.xPercent ?? 50);
  const enemyYPercent = clampCombatSceneEnemyYPercent(enemyPosition?.yPercent ?? 14);
  const horizontalDistancePercent = Math.abs(playerXPercent - enemyXPercent);
  const verticalDistancePercent = Math.abs(playerYPercent - enemyYPercent);

  return {
    playerXPercent,
    playerYPercent,
    enemyXPercent,
    enemyYPercent,
    horizontalDistancePercent,
    verticalDistancePercent,
    directDistancePercent: Math.hypot(horizontalDistancePercent, verticalDistancePercent),
  };
}

export function getInitialEnemySceneXPercent(seedKey: string) {
  const hash = seedKey.split("").reduce((total, char, index) => total + (char.charCodeAt(0) * (index + 7)), 0);
  return getSeededRatio(hash) > 0.5 ? 58 : 42;
}

export function resolveCombatSkillContact(params: {
  actorIsPlayer: boolean;
  skillType?: string;
  skillId?: string;
  positions?: CombatScenePositions | null;
}): CombatSkillContactResult {
  const profile = getSkillRangeProfile(params.skillType, params.skillId);
  if (!profile.requiresContact || !params.positions) {
    return {
      outcome: "hit",
      damageScale: 1,
    };
  }

  const distance = params.positions.directDistancePercent;
  if (distance <= profile.hitWindowPercent) {
    return {
      outcome: "hit",
      damageScale: 1,
    };
  }

  if (distance <= profile.grazeWindowPercent) {
    return {
      outcome: "graze",
      damageScale: 0.58,
      messageSuffix: params.actorIsPlayer ? "擦中边缘，威能衰减。" : "擦中过体，伤害减弱。",
    };
  }

  return {
    outcome: "miss",
    damageScale: 0,
    resultLabel: "MISS",
    messageSuffix: params.actorIsPlayer ? "被对手拉开身位，未能命中。" : "被你拉开身位，未能命中。",
  };
}

export function resolveEnemyAiMovementPlan(params: {
  state: CombatState;
  sceneTick: number;
  currentEnemyXPercent: number;
  currentEnemyYPercent: number;
  currentPlayerXPercent: number;
  currentPlayerYPercent: number;
  preferredSkillId?: string | null;
  preferredSkill?: CombatSpatialSkillLike | null;
}): CombatEnemyAiMovementPlan {
  const profile = getSkillRangeProfile(params.preferredSkill?.skillType, params.preferredSkillId || undefined);
  const seedValue = params.state.turn + params.state.enemy.speed + params.state.player.speed;
  const seededFlankSign = getSeededRatio(seedValue) >= 0.5 ? 1 : -1;
  const flankSign = resolveStableFlankSign(
    params.currentEnemyXPercent,
    params.currentPlayerXPercent,
    seededFlankSign,
  );
  const preferredContactGapPercent = Math.max(
    8.8,
    Math.min(12.5, profile.hitWindowPercent * 0.72),
  );

  let desiredXPercent = profile.requiresContact
    ? params.currentPlayerXPercent
    : params.currentPlayerXPercent + (flankSign * profile.preferredOffsetPercent);
  let desiredYPercent = params.currentPlayerYPercent - (
    profile.requiresContact
      ? preferredContactGapPercent
      : Math.max(9, profile.preferredOffsetPercent * 0.9)
  );

  const currentDirectDistance = Math.hypot(
    params.currentEnemyXPercent - params.currentPlayerXPercent,
    params.currentEnemyYPercent - params.currentPlayerYPercent,
  );

  if (shouldHoldCurrentCombatPosition({
    currentDirectDistance,
    profile,
  })) {
    return {
      targetXPercent: clampCombatSceneXPercent(params.currentEnemyXPercent),
      targetYPercent: clampCombatSceneEnemyYPercent(params.currentEnemyYPercent),
      horizontalSpeedPercentPerSecond: profile.movementStepPercent / COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS,
      verticalSpeedPercentPerSecond: Math.max(2.8, profile.movementStepPercent * 0.92) / COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS,
    };
  }

  if (profile.requiresContact && currentDirectDistance > profile.hitWindowPercent * 1.08) {
    desiredXPercent = params.currentPlayerXPercent;
    desiredYPercent = params.currentPlayerYPercent - preferredContactGapPercent;
  }

  if (!profile.requiresContact) {
    desiredXPercent = (params.currentPlayerXPercent * 0.42) + 29;
    desiredYPercent = Math.max(COMBAT_SCENE_ENEMY_Y_MIN_PERCENT + 2, params.currentPlayerYPercent - 24);
  }

  return {
    targetXPercent: clampCombatSceneXPercent(desiredXPercent),
    targetYPercent: clampCombatSceneEnemyYPercent(desiredYPercent),
    horizontalSpeedPercentPerSecond: profile.movementStepPercent / COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS,
    verticalSpeedPercentPerSecond: Math.max(2.8, profile.movementStepPercent * 0.92) / COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS,
  };
}

export function resolveEnemyAiNextXPercent(params: {
  state: CombatState;
  sceneTick: number;
  currentEnemyXPercent: number;
  currentEnemyYPercent: number;
  currentPlayerXPercent: number;
  currentPlayerYPercent: number;
  preferredSkillId?: string | null;
  preferredSkill?: CombatSpatialSkillLike | null;
}) {
  const movementPlan = resolveEnemyAiMovementPlan(params);
  return {
    xPercent: clampCombatSceneXPercent(
      moveTowards(
        params.currentEnemyXPercent,
        movementPlan.targetXPercent,
        movementPlan.horizontalSpeedPercentPerSecond * COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS,
      ),
    ),
    yPercent: clamp(
      moveTowards(
        params.currentEnemyYPercent,
        movementPlan.targetYPercent,
        movementPlan.verticalSpeedPercentPerSecond * COMBAT_SCENE_REFERENCE_MOVE_TICK_SECONDS,
      ),
      COMBAT_SCENE_ENEMY_Y_MIN_PERCENT,
      COMBAT_SCENE_ENEMY_Y_MAX_PERCENT,
    ),
  };
}
