import type { SpiritualRoot } from "@/types/game";
import { getRealmStatsByPosition } from "@/modules/character/services/realm-service";

const BASE_SPEED = 5;
const BASE_LUCK = 5;

export interface PlayerBaseStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
}

function applyPercentBonus(baseValue: number, percentValue: number | undefined) {
  return Math.floor(baseValue * (1 + (percentValue || 0)));
}

export function applySpiritualRootBonusToStats(
  baseStats: {
    hp: number;
    mp: number;
    attack: number;
    defense: number;
    speed: number;
    luck: number;
    spiritualSense: number;
    armorPenetration: number;
    block: number;
    skillDamageBonus: number;
    skillDamageReduction: number;
    artifactDamageBonus: number;
    artifactDamageReduction: number;
  },
  spiritualRoot?: SpiritualRoot | null
): PlayerBaseStats {
  const bonuses = spiritualRoot?.bonuses;
  const hp = applyPercentBonus(baseStats.hp, bonuses?.hpPercent);
  const mp = applyPercentBonus(baseStats.mp, bonuses?.mpPercent);

  return {
    hp,
    maxHp: hp,
    mp,
    maxMp: mp,
    attack: applyPercentBonus(baseStats.attack, bonuses?.atkPercent),
    defense: applyPercentBonus(baseStats.defense, bonuses?.defPercent),
    speed: applyPercentBonus(baseStats.speed, bonuses?.speedPercent),
    luck: applyPercentBonus(baseStats.luck, bonuses?.luckPercent),
    spiritualSense: applyPercentBonus(baseStats.spiritualSense, bonuses?.spiritualSensePercent),
    armorPenetration: applyPercentBonus(baseStats.armorPenetration, bonuses?.armorPenetrationPercent),
    block: applyPercentBonus(baseStats.block, bonuses?.blockPercent),
    skillDamageBonus: applyPercentBonus(baseStats.skillDamageBonus, bonuses?.skillDamageBonusPercent),
    skillDamageReduction: applyPercentBonus(baseStats.skillDamageReduction, bonuses?.skillDamageReductionPercent),
    artifactDamageBonus: applyPercentBonus(baseStats.artifactDamageBonus, bonuses?.artifactDamageBonusPercent),
    artifactDamageReduction: applyPercentBonus(baseStats.artifactDamageReduction, bonuses?.artifactDamageReductionPercent),
  };
}

export async function buildInitialPlayerBaseStats(spiritualRoot?: SpiritualRoot | null): Promise<PlayerBaseStats> {
  const realmStats = await getRealmStatsByPosition(1, 1);
  return applySpiritualRootBonusToStats({
    hp: realmStats.hp,
    mp: realmStats.mp,
    attack: realmStats.atk,
    defense: realmStats.def,
    speed: BASE_SPEED,
    luck: BASE_LUCK,
    spiritualSense: realmStats.spiritualSense,
    armorPenetration: 0,
    block: 0,
    skillDamageBonus: 0,
    skillDamageReduction: 0,
    artifactDamageBonus: 0,
    artifactDamageReduction: 0,
  }, spiritualRoot);
}
