import type { ActiveEffect, CombatUnit, SkillSourceType } from "@/types/game";
import type { DamageCalculator } from "@/modules/combat/services/damage-formula";

const MAX_CRIT_CHANCE = 0.55;
const MAX_BLOCK_CHANCE = 0.45;
const MAX_PENETRATION_IGNORE_RATIO = 0.8;
const PENETRATION_BLOCK_COUNTER_RATIO = 0.45;
const PENETRATION_SOFT_CAP = 500;
const BASE_DEFENSE_MITIGATION_FACTOR = 100;
const BLOCK_REDUCTION_BASE = 0.2;
const BLOCK_REDUCTION_SCALE = 0.35;
const BLOCK_REDUCTION_SOFT_CAP = 800;
const HEAL_SPIRITUAL_SENSE_RATIO = 2.15;
const REALM_PRESSURE_STEP = 0.04;
const REALM_PRESSURE_BONUS_CAP = 0.18;
const REALM_PRESSURE_PENALTY_CAP = 0.14;
const REALM_PRESSURE_SENSE_SUPPORT_CAP = 0.025;
const REALM_PRESSURE_SENSE_DIVISOR = 8000;

export interface CombatSkillContext {
  sourceType?: SkillSourceType;
}

export interface CalculatedAttackOutcome {
  totalDamage: number;
  hpDamage: number;
  mpDamage: number;
  isCritical: boolean;
  isBlocked: boolean;
  shieldRatio: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDamageValue(value: number) {
  return Math.max(1, Math.floor(Number(value) || 0));
}

function normalizeShieldRatioValue(rawValue: number) {
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return 0;
  }
  if (rawValue <= 1) {
    return rawValue * 100;
  }
  return rawValue;
}

export function normalizeShieldRatioForDisplay(rawValue: number) {
  return Math.floor(clamp(normalizeShieldRatioValue(rawValue), 0, 100));
}

function getSkillDamageModifier(attacker: CombatUnit, defender: CombatUnit, sourceType?: SkillSourceType) {
  if (sourceType === "artifact") {
    return attacker.artifactDamageBonus - defender.artifactDamageReduction;
  }
  return attacker.skillDamageBonus - defender.skillDamageReduction;
}

function getShieldRatio(activeEffects: ActiveEffect[]) {
  return activeEffects.reduce((maxRatio, effect) => {
    if (effect.type !== "shield") {
      return maxRatio;
    }
    return Math.max(maxRatio, normalizeShieldRatioValue(Number(effect.value)));
  }, 0);
}

function calculateEffectiveDefense(attacker: CombatUnit, defender: CombatUnit) {
  const safeDefense = Math.max(0, Number(defender.defense) || 0);
  const attackerPenetration = Math.max(0, Number(attacker.armorPenetration) || 0);
  const defenderBlock = Math.max(0, Number(defender.block) || 0);

  const effectivePenetration = Math.max(0, attackerPenetration - defenderBlock * PENETRATION_BLOCK_COUNTER_RATIO);
  const ignoreRatio = clamp(
    effectivePenetration / (effectivePenetration + PENETRATION_SOFT_CAP),
    0,
    MAX_PENETRATION_IGNORE_RATIO,
  );

  return Math.max(0, safeDefense * (1 - ignoreRatio));
}

function calculateRawDamageFallback(params: {
  attacker: CombatUnit;
  defender: CombatUnit;
  damageBase: number;
  damageMultiplier: number;
  variance: number;
}) {
  const effectiveDefense = calculateEffectiveDefense(params.attacker, params.defender);
  const attackPower = (
    params.attacker.attack
    + params.attacker.armorPenetration * 0.28
    + params.attacker.speed * 0.2
    + params.attacker.luck * 0.1
  );
  const defenseMultiplier = BASE_DEFENSE_MITIGATION_FACTOR / (BASE_DEFENSE_MITIGATION_FACTOR + effectiveDefense);
  const baseDamage = attackPower * params.damageMultiplier + params.damageBase;
  return baseDamage * defenseMultiplier * params.variance;
}

function calculateCritChance(attacker: CombatUnit) {
  const luckRate = attacker.luck / (attacker.luck + 900);
  const speedRate = Math.max(0, attacker.speed / (attacker.speed + 2200)) * 0.08;
  return clamp(0.05 + luckRate + speedRate + (attacker.critBonus ?? 0), 0.05, MAX_CRIT_CHANCE);
}

function calculateCritMultiplier(attacker: CombatUnit) {
  return 1.45 + clamp(attacker.luck / 3000, 0, 0.35);
}

function calculateBlockChance(attacker: CombatUnit, defender: CombatUnit) {
  const blockBase = defender.block / (defender.block + 600);
  const penetrationSuppress = (attacker.armorPenetration / (attacker.armorPenetration + 650)) * 0.62;
  return clamp(blockBase * (1 - penetrationSuppress) + (defender.blockBonus ?? 0), 0, MAX_BLOCK_CHANCE);
}

function calculateBlockReduction(defender: CombatUnit) {
  const ratio = defender.block / (defender.block + BLOCK_REDUCTION_SOFT_CAP);
  return clamp(BLOCK_REDUCTION_BASE + ratio * BLOCK_REDUCTION_SCALE, BLOCK_REDUCTION_BASE, 0.7);
}

function calculateRealmPressureRatio(attacker: CombatUnit, defender: CombatUnit) {
  const attackerRealmRaw = Number(attacker.realm);
  const defenderRealmRaw = Number(defender.realm);
  if (!Number.isFinite(attackerRealmRaw) || attackerRealmRaw <= 0 || !Number.isFinite(defenderRealmRaw) || defenderRealmRaw <= 0) {
    return 0;
  }
  const attackerRealm = Math.max(1, Math.floor(attackerRealmRaw));
  const defenderRealm = Math.max(1, Math.floor(defenderRealmRaw));

  const realmGap = clamp(attackerRealm - defenderRealm, -4, 5);
  const senseSupport = clamp(
    (attacker.spiritualSense - defender.spiritualSense) / REALM_PRESSURE_SENSE_DIVISOR,
    -REALM_PRESSURE_SENSE_SUPPORT_CAP,
    REALM_PRESSURE_SENSE_SUPPORT_CAP,
  );
  const totalRatio = realmGap * REALM_PRESSURE_STEP + senseSupport;
  return clamp(totalRatio, -REALM_PRESSURE_PENALTY_CAP, REALM_PRESSURE_BONUS_CAP);
}

export function applyShieldMitigation(target: CombatUnit, incomingDamage: number) {
  const safeDamage = Math.max(0, Math.floor(Number(incomingDamage) || 0));
  if (safeDamage <= 0) {
    return {
      totalDamage: 0,
      hpDamage: 0,
      mpDamage: 0,
      shieldRatio: 0,
    };
  }

  const shieldRatio = clamp(getShieldRatio(target.activeEffects), 0, 100);
  const redirectedToMp = Math.min(
    target.mp,
    Math.floor(safeDamage * (shieldRatio / 100)),
  );
  const hpDamage = Math.max(0, safeDamage - redirectedToMp);

  target.mp = Math.max(0, target.mp - redirectedToMp);
  target.hp = Math.max(0, target.hp - hpDamage);

  return {
    totalDamage: safeDamage,
    hpDamage,
    mpDamage: redirectedToMp,
    shieldRatio,
  };
}

export function calculateCombatDamageOutcome(params: {
  attacker: CombatUnit;
  defender: CombatUnit;
  damageBase: number;
  damageMultiplier: number;
  damageCalculator?: DamageCalculator;
  sourceType?: SkillSourceType;
  damageScale?: number;
}) {
  const variance = 0.9 + Math.random() * 0.2;
  const effectiveDefense = calculateEffectiveDefense(params.attacker, params.defender);
  const rawDamage = params.damageCalculator
    ? params.damageCalculator({
      atk: params.attacker.attack,
      def: params.defender.defense,
      base: params.damageBase,
      mul: params.damageMultiplier,
      rand: variance,
      speed: params.attacker.speed,
      luck: params.attacker.luck,
      spiritualSense: 0,
      armorPenetration: params.attacker.armorPenetration,
      block: params.defender.block,
      senseDiff: 0,
      effectiveDef: effectiveDefense,
    })
    : normalizeDamageValue(calculateRawDamageFallback({
      attacker: params.attacker,
      defender: params.defender,
      damageBase: params.damageBase,
      damageMultiplier: params.damageMultiplier,
      variance,
    }));

  const damageModifier = getSkillDamageModifier(params.attacker, params.defender, params.sourceType);
  let damage = Math.max(1, Math.floor(rawDamage * Math.max(0, 1 + damageModifier / 100)));
  damage = Math.max(1, Math.floor(damage * (1 + calculateRealmPressureRatio(params.attacker, params.defender))));
  damage = Math.max(1, Math.floor(damage * Math.max(0, params.damageScale ?? 1)));

  const critChance = calculateCritChance(params.attacker);
  const isCritical = Math.random() < critChance;
  if (isCritical) {
    damage = Math.max(1, Math.floor(damage * calculateCritMultiplier(params.attacker)));
  }

  const blockChance = calculateBlockChance(params.attacker, params.defender);
  const isBlocked = Math.random() < blockChance;
  if (isBlocked) {
    const blockReduction = calculateBlockReduction(params.defender);
    damage = Math.max(1, Math.floor(damage * (1 - blockReduction)));
  }

  const mitigated = applyShieldMitigation(params.defender, damage);
  return {
    ...mitigated,
    isCritical,
    isBlocked,
  } satisfies CalculatedAttackOutcome;
}

export function calculateHealAmount(actor: CombatUnit, sourceType?: SkillSourceType) {
  const base = (
    actor.attack * 0.22
    + actor.spiritualSense * HEAL_SPIRITUAL_SENSE_RATIO
    + actor.maxMp * 0.05
    + 20
  );
  const luckBoost = 1 + (actor.luck / (actor.luck + 1200)) * 0.25;
  const modifier = getSkillDamageModifier(actor, actor, sourceType);
  const value = base * luckBoost * Math.max(0, 1 + modifier / 100);
  return Math.max(1, Math.floor(value));
}
