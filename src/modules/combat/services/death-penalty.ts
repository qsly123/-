import {
  fromLinearRealm,
  getRealmFullNameByPosition,
  getRealmStageByMajorAndMinor,
  getRealmStatsByPosition,
  toLinearRealm,
} from "@/modules/character/services/realm-service";
import { mergePlayerStats } from "@/modules/character/services/player-stats";
import type { EquipmentStatsBonus } from "@/modules/character/services/player-stats";

export interface DeathPenaltyInput {
  currentMajor: number;
  currentMinor: number;
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense?: number;
  armorPenetration?: number;
  block?: number;
  skillDamageBonus?: number;
  skillDamageReduction?: number;
  artifactDamageBonus?: number;
  artifactDamageReduction?: number;
  equipment?: EquipmentStatsBonus;
}

export interface DeathPenaltyResult {
  realm: number;
  realmMajor: number;
  realmMinor: number;
  realmName: string;
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

function emptyEquipment(): EquipmentStatsBonus {
  return {
    maxHp: 0,
    maxMp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    luck: 0,
    spiritualSense: 0,
    armorPenetration: 0,
    block: 0,
    skillDamageBonus: 0,
    skillDamageReduction: 0,
    artifactDamageBonus: 0,
    artifactDamageReduction: 0,
  };
}

async function getMaxRewardLossByStage(major: number, minor: number) {
  const stage = await getRealmStageByMajorAndMinor(major, minor);
  const rules = stage?.stage.rewardRules || [];
  const rewardLoss = {
    maxHp: 0,
    maxMp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    luck: 0,
  };

  for (const rule of rules) {
    const maxValue = Math.max(Number(rule.valueMin), Number(rule.valueMax));
    const loss = Math.max(0, Math.floor(maxValue));
    if (loss <= 0) {
      continue;
    }

    if (rule.attr === "hp") {
      rewardLoss.maxHp += loss;
      continue;
    }
    if (rule.attr === "mp") {
      rewardLoss.maxMp += loss;
      continue;
    }
    if (rule.attr === "atk") {
      rewardLoss.attack += loss;
      continue;
    }
    if (rule.attr === "def") {
      rewardLoss.defense += loss;
      continue;
    }
    if (rule.attr === "speed") {
      rewardLoss.speed += loss;
      continue;
    }
    if (rule.attr === "luck") {
      rewardLoss.luck += loss;
    }
  }

  return rewardLoss;
}

export async function calculateDeathPenalty(input: DeathPenaltyInput): Promise<DeathPenaltyResult> {
  const currentMajor = Math.max(1, Math.floor(input.currentMajor || 1));
  const currentMinor = Math.max(1, Math.floor(input.currentMinor || 1));

  const currentStage = await getRealmStageByMajorAndMinor(currentMajor, currentMinor);
  const currentRealm = currentStage
    ? await toLinearRealm(currentMajor, currentMinor)
    : 1;
  const downgradedRealm = Math.max(1, currentRealm - 1);
  const downgradedPosition = await fromLinearRealm(downgradedRealm);

  const newMajor = downgradedPosition.major;
  const newMinor = downgradedPosition.minor;

  const [currentRealmStats, newRealmStats, newRealmName, rewardLoss] = await Promise.all([
    getRealmStatsByPosition(currentMajor, currentMinor),
    getRealmStatsByPosition(newMajor, newMinor),
    getRealmFullNameByPosition(newMajor, newMinor),
    getMaxRewardLossByStage(newMajor, newMinor),
  ]);

  const realmLoss = {
    maxHp: Math.max(0, currentRealmStats.hp - newRealmStats.hp),
    maxMp: Math.max(0, currentRealmStats.mp - newRealmStats.mp),
    attack: Math.max(0, currentRealmStats.atk - newRealmStats.atk),
    defense: Math.max(0, currentRealmStats.def - newRealmStats.def),
    speed: 0,
    luck: 0,
  };

  const nextBaseStats = {
    maxHp: Math.max(1, input.maxHp - realmLoss.maxHp - rewardLoss.maxHp),
    maxMp: Math.max(0, input.maxMp - realmLoss.maxMp - rewardLoss.maxMp),
    attack: Math.max(1, input.attack - realmLoss.attack - rewardLoss.attack),
    defense: Math.max(0, input.defense - realmLoss.defense - rewardLoss.defense),
    speed: Math.max(0, input.speed - rewardLoss.speed),
    luck: Math.max(0, input.luck - rewardLoss.luck),
    spiritualSense: Math.max(0, input.spiritualSense ?? 0),
    armorPenetration: Math.max(0, input.armorPenetration ?? 0),
    block: Math.max(0, input.block ?? 0),
    skillDamageBonus: input.skillDamageBonus ?? 0,
    skillDamageReduction: Math.max(0, input.skillDamageReduction ?? 0),
    artifactDamageBonus: input.artifactDamageBonus ?? 0,
    artifactDamageReduction: Math.max(0, input.artifactDamageReduction ?? 0),
  };
  const equipment = input.equipment || emptyEquipment();
  const totalStats = mergePlayerStats({
    hp: 0,
    maxHp: nextBaseStats.maxHp,
    mp: 0,
    maxMp: nextBaseStats.maxMp,
    attack: nextBaseStats.attack,
    defense: nextBaseStats.defense,
    speed: nextBaseStats.speed,
    luck: nextBaseStats.luck,
    spiritualSense: nextBaseStats.spiritualSense,
    armorPenetration: nextBaseStats.armorPenetration,
    block: nextBaseStats.block,
    skillDamageBonus: nextBaseStats.skillDamageBonus,
    skillDamageReduction: nextBaseStats.skillDamageReduction,
    artifactDamageBonus: nextBaseStats.artifactDamageBonus,
    artifactDamageReduction: nextBaseStats.artifactDamageReduction,
  }, equipment);
  const newHp = Math.max(1, Math.floor(totalStats.maxHp * 0.3));
  const newMp = Math.max(0, Math.floor(totalStats.maxMp * 0.3));

  return {
    realm: downgradedRealm,
    realmMajor: newMajor,
    realmMinor: newMinor,
    realmName: newRealmName,
    hp: newHp,
    maxHp: nextBaseStats.maxHp,
    mp: newMp,
    maxMp: nextBaseStats.maxMp,
    attack: nextBaseStats.attack,
    defense: nextBaseStats.defense,
    speed: nextBaseStats.speed,
    luck: nextBaseStats.luck,
    spiritualSense: nextBaseStats.spiritualSense,
    armorPenetration: nextBaseStats.armorPenetration,
    block: nextBaseStats.block,
    skillDamageBonus: nextBaseStats.skillDamageBonus,
    skillDamageReduction: nextBaseStats.skillDamageReduction,
    artifactDamageBonus: nextBaseStats.artifactDamageBonus,
    artifactDamageReduction: nextBaseStats.artifactDamageReduction,
  };
}
