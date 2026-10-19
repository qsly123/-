type CombatPowerStats = {
  maxHp?: number;
  maxMp?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  luck?: number;
  spiritualSense?: number;
  armorPenetration?: number;
  block?: number;
  skillDamageBonus?: number;
  skillDamageReduction?: number;
  artifactDamageBonus?: number;
  artifactDamageReduction?: number;
};

const COMBAT_POWER_WEIGHTS = {
  maxHp: 1,
  maxMp: 1,
  attack: 20,
  defense: 15,
  speed: 120,
  luck: 120,
  spiritualSense: 6,
  armorPenetration: 10,
  block: 10,
  skillDamageBonus: 8,
  skillDamageReduction: 8,
  artifactDamageBonus: 6,
  artifactDamageReduction: 6,
} as const;

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

export function calculateCombatPower(stats: CombatPowerStats): number {
  return Math.max(0, Math.floor(
    toFiniteNumber(stats.maxHp) * COMBAT_POWER_WEIGHTS.maxHp
    + toFiniteNumber(stats.maxMp) * COMBAT_POWER_WEIGHTS.maxMp
    + toFiniteNumber(stats.attack) * COMBAT_POWER_WEIGHTS.attack
    + toFiniteNumber(stats.defense) * COMBAT_POWER_WEIGHTS.defense
    + toFiniteNumber(stats.speed) * COMBAT_POWER_WEIGHTS.speed
    + toFiniteNumber(stats.luck) * COMBAT_POWER_WEIGHTS.luck
    + toFiniteNumber(stats.spiritualSense) * COMBAT_POWER_WEIGHTS.spiritualSense
    + toFiniteNumber(stats.armorPenetration) * COMBAT_POWER_WEIGHTS.armorPenetration
    + toFiniteNumber(stats.block) * COMBAT_POWER_WEIGHTS.block
    + toFiniteNumber(stats.skillDamageBonus) * COMBAT_POWER_WEIGHTS.skillDamageBonus
    + toFiniteNumber(stats.skillDamageReduction) * COMBAT_POWER_WEIGHTS.skillDamageReduction
    + toFiniteNumber(stats.artifactDamageBonus) * COMBAT_POWER_WEIGHTS.artifactDamageBonus
    + toFiniteNumber(stats.artifactDamageReduction) * COMBAT_POWER_WEIGHTS.artifactDamageReduction,
  ));
}
