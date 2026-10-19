import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { realmMajors, realmStages } from "@/db/schema";
import type { RealmRewardAttr, RealmRewardRule } from "@/types/game";

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CHINESE_UNITS = ["", "十", "百", "千"];

export interface RealmMajorConfig {
  id: number;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
}

type RealmMajorRow = {
  id: number;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
};

type RealmStageRow = {
  id: number;
  majorId: number;
  minor: number;
  name: string;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[] | null;
};

export interface RealmStageConfig {
  id: number;
  majorId: number;
  minor: number;
  name: string;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[];
}

export interface RealmPosition {
  major: number;
  minor: number;
}

export interface RealmResolvedStage {
  major: RealmMajorConfig;
  stage: RealmStageConfig;
}

interface RealmLinearEntry {
  stageId: number;
  majorOrder: number;
  majorName: string;
  minor: number;
  stageName: string;
}

export type RewardApplyKey = "hp" | "mp" | "attack" | "defense" | "speed" | "luck";
export type RandomFn = () => number;

const REWARD_ATTR_TO_PLAYER_FIELD: Record<RealmRewardAttr, RewardApplyKey> = {
  hp: "hp",
  mp: "mp",
  atk: "attack",
  def: "defense",
  speed: "speed",
  luck: "luck",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function numberToChinese(value: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) {
    return "一";
  }

  if (n < 10) {
    return CHINESE_DIGITS[n];
  }

  const text = String(n);
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const unitIndex = text.length - index - 1;
    const unit = CHINESE_UNITS[unitIndex] || "";

    if (digit === 0) {
      if (!output.endsWith("零") && index !== text.length - 1) {
        output += "零";
      }
      continue;
    }

    output += `${CHINESE_DIGITS[digit]}${unit}`;
  }

  output = output.replace(/零+/g, "零").replace(/零$/g, "");
  if (output.startsWith("一十")) {
    output = output.slice(1);
  }
  return output || "一";
}

function randomIntWeightedByEdgeProbability(
  valueMin: number,
  valueMax: number,
  probabilityMin: number,
  probabilityMax: number,
  randomFn: RandomFn = Math.random
) {
  const low = Math.floor(Math.min(valueMin, valueMax));
  const high = Math.floor(Math.max(valueMin, valueMax));
  if (high <= low) {
    return low;
  }

  const count = high - low + 1;
  const weights: number[] = [];
  let totalWeight = 0;

  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    const weight = clamp(probabilityMin + (probabilityMax - probabilityMin) * ratio, 0, 1);
    weights.push(weight);
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return low + Math.floor(randomFn() * count);
  }

  let roll = randomFn() * totalWeight;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) {
      return low + index;
    }
  }

  return high;
}

async function getRealmLinearEntries(): Promise<RealmLinearEntry[]> {
  const rows = await db.select({
    stageId: realmStages.id,
    majorOrder: realmMajors.order,
    majorName: realmMajors.name,
    minor: realmStages.minor,
    stageName: realmStages.name,
  })
    .from(realmStages)
    .innerJoin(realmMajors, eq(realmStages.majorId, realmMajors.id))
    .orderBy(asc(realmMajors.order), asc(realmStages.minor))
    .all();

  return rows.map((row) => ({
    stageId: Number(row.stageId),
    majorOrder: Number(row.majorOrder),
    majorName: String(row.majorName),
    minor: Number(row.minor),
    stageName: String(row.stageName || "").trim() || `${numberToChinese(Number(row.minor))}重`,
  }));
}

export async function toLinearRealm(major: number, minor: number): Promise<number> {
  const targetMajor = Math.max(1, Math.floor(Number(major) || 1));
  const targetMinor = Math.max(1, Math.floor(Number(minor) || 1));
  const entries = await getRealmLinearEntries();
  const index = entries.findIndex((entry) => entry.majorOrder === targetMajor && entry.minor === targetMinor);
  if (index < 0) {
    return 1;
  }
  return index + 1;
}

export async function fromLinearRealm(realm: number): Promise<RealmPosition> {
  const entries = await getRealmLinearEntries();
  if (!entries.length) {
    return { major: 1, minor: 1 };
  }

  const safeRealm = Math.max(1, Math.floor(Number(realm) || 1));
  const index = Math.min(entries.length, safeRealm) - 1;
  const entry = entries[index];
  return {
    major: entry.majorOrder,
    minor: entry.minor,
  };
}

export async function getRealmStatsByLinearRealm(realm: number) {
  const pos = await fromLinearRealm(realm);
  return getRealmStatsByPosition(pos.major, pos.minor);
}

export async function getRealmFullNameByLinearRealm(realm: number) {
  const pos = await fromLinearRealm(realm);
  return getRealmFullNameByPosition(pos.major, pos.minor);
}

export async function getBreakthroughXpByLinearRealm(realm: number) {
  const pos = await fromLinearRealm(realm);
  return getBreakthroughXpByPosition(pos.major, pos.minor);
}

export async function getBreakthroughRateByLinearRealm(realm: number) {
  const pos = await fromLinearRealm(realm);
  return getBreakthroughRateByPosition(pos.major, pos.minor);
}

export function getRealmDisplayName(majorName: string, stageName: string, minor = 1): string {
  const safeMajorName = String(majorName || "").trim();
  if (!safeMajorName) {
    return "未知境界";
  }

  const suffix = String(stageName || "").trim() || `${numberToChinese(Math.max(1, Math.floor(minor || 1)))}重`;
  return `${safeMajorName}${suffix}`;
}

export function buildRealmNameByOrder(order: number, minor: number, majors: RealmMajorConfig[]) {
  const major = majors.find((item) => item.order === order);
  if (!major) return "未知境界";
  return getRealmDisplayName(major.name, `${numberToChinese(Math.max(1, Math.floor(minor || 1)))}重`, minor);
}

export function validateRewardRules(rules: RealmRewardRule[] | null | undefined): string | null {
  if (!rules) return null;

  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object") {
      return `rewardRules[${index}] 格式错误`;
    }

    if (!["hp", "mp", "atk", "def", "speed", "luck"].includes(rule.attr)) {
      return `rewardRules[${index}].attr 非法`;
    }

    const probabilityMin = Number(rule.probabilityMin);
    const probabilityMax = Number(rule.probabilityMax);
    const valueMin = Number(rule.valueMin);
    const valueMax = Number(rule.valueMax);

    if (!Number.isFinite(probabilityMin) || !Number.isFinite(probabilityMax)) {
      return `rewardRules[${index}] 权重必须是数字`;
    }
    if (!Number.isFinite(valueMin) || !Number.isFinite(valueMax)) {
      return `rewardRules[${index}] 数值必须是数字`;
    }
    if (probabilityMin < 0 || probabilityMin > 1 || probabilityMax < 0 || probabilityMax > 1) {
      return `rewardRules[${index}] 权重区间非法`;
    }
    if (valueMin > valueMax) {
      return `rewardRules[${index}] 数值区间非法`;
    }
  }

  return null;
}

function normalizeRewardRules(rules: RealmRewardRule[] | null | undefined): RealmRewardRule[] {
  if (!Array.isArray(rules)) {
    return [];
  }
  return rules;
}

export function rollBreakthroughRewardWithRandom(
  rules: RealmRewardRule[] | null | undefined,
  randomFn: RandomFn = Math.random
) {
  const rewards: Partial<Record<RewardApplyKey, number>> = {};
  for (const rule of normalizeRewardRules(rules)) {
    const value = randomIntWeightedByEdgeProbability(
      rule.valueMin,
      rule.valueMax,
      rule.probabilityMin,
      rule.probabilityMax,
      randomFn
    );
    if (value <= 0) {
      continue;
    }

    const field = REWARD_ATTR_TO_PLAYER_FIELD[rule.attr];
    rewards[field] = (rewards[field] || 0) + value;
  }

  return rewards;
}

export function rollBreakthroughReward(rules: RealmRewardRule[] | null | undefined) {
  return rollBreakthroughRewardWithRandom(rules, Math.random);
}

export function applyBreakthroughRewardToStats(
  rewards: Partial<Record<RewardApplyKey, number>>,
  current: {
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
) {
  const maxHpGain = rewards.hp || 0;
  const maxMpGain = rewards.mp || 0;

  return {
    hp: current.hp + maxHpGain,
    maxHp: current.maxHp + maxHpGain,
    mp: current.mp + maxMpGain,
    maxMp: current.maxMp + maxMpGain,
    attack: current.attack + (rewards.attack || 0),
    defense: current.defense + (rewards.defense || 0),
    speed: current.speed + (rewards.speed || 0),
    luck: current.luck + (rewards.luck || 0),
    spiritualSense: current.spiritualSense,
    armorPenetration: current.armorPenetration,
    block: current.block,
    skillDamageBonus: current.skillDamageBonus,
    skillDamageReduction: current.skillDamageReduction,
    artifactDamageBonus: current.artifactDamageBonus,
    artifactDamageReduction: current.artifactDamageReduction,
  };
}

export function formatBreakthroughRewardText(rewards: Partial<Record<RewardApplyKey, number>>) {
  const pairs: Array<[RewardApplyKey, string]> = [
    ["hp", "气血"],
    ["mp", "灵力"],
    ["attack", "攻击"],
    ["defense", "防御"],
    ["speed", "遁速"],
    ["luck", "幸运"],
  ];

  const parts = pairs
    .filter(([key]) => (rewards[key] || 0) > 0)
    .map(([key, label]) => `${label}+${rewards[key]}`);

  return parts.join("，");
}

function normalizeMajorConfig(raw: RealmMajorRow): RealmMajorConfig {
  return {
    id: Number(raw.id),
    order: Number(raw.order),
    name: String(raw.name),
    baseHp: Number(raw.baseHp || 0),
    baseMp: Number(raw.baseMp || 0),
    baseAtk: Number(raw.baseAtk || 0),
    baseDef: Number(raw.baseDef || 0),
    baseSpiritualSense: Number(raw.baseSpiritualSense || 0),
  };
}

function normalizeStageConfig(raw: RealmStageRow): RealmStageConfig {
  return {
    id: Number(raw.id),
    majorId: Number(raw.majorId),
    minor: Number(raw.minor),
    name: String(raw.name || "").trim() || `${numberToChinese(Number(raw.minor))}重`,
    requiredXp: Number(raw.requiredXp),
    successRate: Number(raw.successRate),
    failXpLossRate: Number(raw.failXpLossRate),
    rewardRules: normalizeRewardRules(raw.rewardRules as RealmRewardRule[]),
  };
}

export async function getEnabledRealmMajors(): Promise<RealmMajorConfig[]> {
  const rows = await db.select()
    .from(realmMajors)
    .orderBy(asc(realmMajors.order))
    .all();

  return rows.map(normalizeMajorConfig);
}

export async function getRealmMajorByOrder(order: number): Promise<RealmMajorConfig | null> {
  const major = await db.select().from(realmMajors).where(eq(realmMajors.order, order)).get();
  if (!major) {
    return null;
  }
  return normalizeMajorConfig(major);
}

export async function getRealmStageByMajorAndMinor(majorOrder: number, minor: number): Promise<RealmResolvedStage | null> {
  const major = await getRealmMajorByOrder(majorOrder);
  if (!major) {
    return null;
  }

  const stage = await db.select().from(realmStages)
    .where(and(eq(realmStages.majorId, major.id), eq(realmStages.minor, minor)))
    .get();

  if (!stage) {
    return null;
  }

  return { major, stage: normalizeStageConfig(stage) };
}

export async function getInitialRealmStage(): Promise<RealmResolvedStage | null> {
  const major = await db.select().from(realmMajors).orderBy(asc(realmMajors.order)).get();
  if (!major) {
    return null;
  }

  const stage = await db.select().from(realmStages)
    .where(eq(realmStages.majorId, major.id))
    .orderBy(asc(realmStages.minor))
    .get();

  if (!stage) {
    return null;
  }

  return {
    major: normalizeMajorConfig(major),
    stage: normalizeStageConfig(stage),
  };
}

export async function getNextRealmStage(currentMajor: number, currentMinor: number): Promise<RealmResolvedStage | null> {
  const current = await getRealmStageByMajorAndMinor(currentMajor, currentMinor);
  if (!current) {
    return null;
  }

  const nextStageInCurrentMajor = await db.select().from(realmStages)
    .where(and(eq(realmStages.majorId, current.major.id), gt(realmStages.minor, current.stage.minor)))
    .orderBy(asc(realmStages.minor))
    .get();

  if (nextStageInCurrentMajor) {
    return {
      major: current.major,
      stage: normalizeStageConfig(nextStageInCurrentMajor),
    };
  }

  let currentOrder = current.major.order;
  while (true) {
    const nextMajor = await db.select().from(realmMajors)
      .where(gt(realmMajors.order, currentOrder))
      .orderBy(asc(realmMajors.order))
      .get();

    if (!nextMajor) {
      return null;
    }

    const firstStage = await db.select().from(realmStages)
      .where(eq(realmStages.majorId, nextMajor.id))
      .orderBy(asc(realmStages.minor))
      .get();

    if (firstStage) {
      return {
        major: normalizeMajorConfig(nextMajor),
        stage: normalizeStageConfig(firstStage),
      };
    }

    currentOrder = Number(nextMajor.order);
  }
}

export async function getRealmStatsByPosition(majorOrder: number, minor: number) {
  const major = await getRealmMajorByOrder(majorOrder);
  if (!major) {
    return { hp: 100, mp: 50, atk: 10, def: 5, spiritualSense: 0 };
  }

  const safeMinor = Math.max(1, Math.floor(Number(minor) || 1));
  const scale = 1 + (safeMinor - 1) * 0.12;
  return {
    hp: Math.floor(major.baseHp * scale),
    mp: Math.floor(major.baseMp * scale),
    atk: Math.floor(major.baseAtk * scale),
    def: Math.floor(major.baseDef * scale),
    // 神识按大境界成长，小境界不额外放大。
    spiritualSense: Math.max(0, Math.floor(major.baseSpiritualSense || 0)),
  };
}

export async function getBreakthroughXpByPosition(majorOrder: number, minor: number) {
  const row = await getRealmStageByMajorAndMinor(majorOrder, minor);
  return row?.stage.requiredXp ?? Infinity;
}

export async function getBreakthroughRateByPosition(majorOrder: number, minor: number) {
  const row = await getRealmStageByMajorAndMinor(majorOrder, minor);
  if (!row) {
    return 0;
  }
  return clamp(row.stage.successRate, 0, 1);
}

export async function getRealmFullNameByPosition(majorOrder: number, minor: number) {
  const row = await getRealmStageByMajorAndMinor(majorOrder, minor);
  if (!row) {
    return "未知境界";
  }
  return getRealmDisplayName(row.major.name, row.stage.name, row.stage.minor);
}
