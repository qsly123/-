import type { SpiritualRoot } from "@/types/game";
import {
  applyBreakthroughRewardToStats,
  fromLinearRealm,
  getNextRealmStage,
  getRealmFullNameByPosition,
  getRealmStageByMajorAndMinor,
  getRealmStatsByPosition,
  rollBreakthroughRewardWithRandom,
  toLinearRealm,
} from "@/modules/character/services/realm-service";
import { buildInitialPlayerBaseStats, type PlayerBaseStats } from "@/modules/character/services/player-initial-stats";

interface SimulatePlayerStatsToTargetRealmInput {
  playerId: string;
  spiritualRoot?: SpiritualRoot | null;
  targetRealm: number;
}

export interface SimulatePlayerStatsToTargetRealmResult {
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

function hashToUint32(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seedText: string) {
  let state = hashToUint32(seedText) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeTargetRealm(targetRealm: number) {
  const normalized = Math.floor(Number(targetRealm));
  if (!Number.isFinite(normalized) || normalized < 1) {
    throw new Error("目标境界非法");
  }
  return normalized;
}

async function assertRealmConfigured(major: number, minor: number, errorMessage: string) {
  const stage = await getRealmStageByMajorAndMinor(major, minor);
  if (!stage) {
    throw new Error(errorMessage);
  }
}

function applyNextRealmBaseStats(currentStats: PlayerBaseStats, nextRealmStats: {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  spiritualSense?: number;
}) {
  const maxHp = Math.max(nextRealmStats.hp, currentStats.maxHp);
  const maxMp = Math.max(nextRealmStats.mp, currentStats.maxMp);
  return {
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    attack: Math.max(nextRealmStats.atk, currentStats.attack),
    defense: Math.max(nextRealmStats.def, currentStats.defense),
    speed: currentStats.speed,
    luck: currentStats.luck,
    spiritualSense: Math.max(nextRealmStats.spiritualSense || 0, currentStats.spiritualSense),
    armorPenetration: currentStats.armorPenetration,
    block: currentStats.block,
    skillDamageBonus: currentStats.skillDamageBonus,
    skillDamageReduction: currentStats.skillDamageReduction,
    artifactDamageBonus: currentStats.artifactDamageBonus,
    artifactDamageReduction: currentStats.artifactDamageReduction,
  };
}

export async function simulatePlayerStatsToTargetRealm(
  input: SimulatePlayerStatsToTargetRealmInput
): Promise<SimulatePlayerStatsToTargetRealmResult> {
  const targetRealm = normalizeTargetRealm(input.targetRealm);
  const targetPos = await fromLinearRealm(targetRealm);
  await assertRealmConfigured(targetPos.major, targetPos.minor, "目标境界不存在或未启用");
  await assertRealmConfigured(1, 1, "最低境界配置缺失");

  let currentMajor = 1;
  let currentMinor = 1;
  let currentRealm = 1;
  // 灵根改由统一修饰层生效，基础属性不再重复折算。
  let currentStats = await buildInitialPlayerBaseStats();
  const randomFn = createSeededRandom(`${input.playerId}:${targetRealm}`);

  while (currentRealm < targetRealm) {
    const currentStage = await getRealmStageByMajorAndMinor(currentMajor, currentMinor);
    if (!currentStage) {
      throw new Error(`境界配置缺失：${currentMajor}-${currentMinor}`);
    }

    const nextStage = await getNextRealmStage(currentMajor, currentMinor);
    if (!nextStage) {
      throw new Error("目标境界超出当前境界配置上限");
    }

    const nextMajor = nextStage.major.order;
    const nextMinor = nextStage.stage.minor;
    const rewards = rollBreakthroughRewardWithRandom(currentStage.stage.rewardRules, randomFn);
    const nextRealmStats = await getRealmStatsByPosition(nextMajor, nextMinor);
    const nextBaseStats = applyNextRealmBaseStats(currentStats, nextRealmStats);
    currentStats = applyBreakthroughRewardToStats(rewards, nextBaseStats);
    currentMajor = nextMajor;
    currentMinor = nextMinor;
    currentRealm = await toLinearRealm(nextMajor, nextMinor);
  }

  if (currentRealm !== targetRealm) {
    throw new Error("目标境界不可达");
  }

  const realmName = await getRealmFullNameByPosition(currentMajor, currentMinor);
  return {
    realm: currentRealm,
    realmMajor: currentMajor,
    realmMinor: currentMinor,
    realmName,
    hp: currentStats.hp,
    maxHp: currentStats.maxHp,
    mp: currentStats.mp,
    maxMp: currentStats.maxMp,
    attack: currentStats.attack,
    defense: currentStats.defense,
    speed: currentStats.speed,
    luck: currentStats.luck,
    spiritualSense: currentStats.spiritualSense,
    armorPenetration: currentStats.armorPenetration,
    block: currentStats.block,
    skillDamageBonus: currentStats.skillDamageBonus,
    skillDamageReduction: currentStats.skillDamageReduction,
    artifactDamageBonus: currentStats.artifactDamageBonus,
    artifactDamageReduction: currentStats.artifactDamageReduction,
  };
}
