export type AlchemyBalanceStageKey = "lianqi" | "zhuji" | "jiedan" | "yuanying" | "huashen";
export type AlchemyBalanceRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";

type Range = {
  min: number;
  max: number;
};

const OFFICIAL_XP_PILL_VALUE_BY_STAGE: Record<AlchemyBalanceStageKey, number> = {
  lianqi: 1600,
  zhuji: 3200,
  jiedan: 4800,
  yuanying: 6400,
  huashen: 8000,
};

const AI_CULTIVATION_XP_RANGE_MULTIPLIERS: Record<AlchemyBalanceRarity, Range> = {
  common: { min: 0.85, max: 0.95 },
  uncommon: { min: 0.95, max: 1.05 },
  rare: { min: 1.05, max: 1.18 },
  epic: { min: 1.16, max: 1.3 },
  legendary: { min: 1.28, max: 1.45 },
  hongmeng: { min: 1.46, max: 1.66 },
};

const AI_ZERO_TOXICITY_BONUS_RATE_BY_STAGE: Record<AlchemyBalanceStageKey, number> = {
  lianqi: 1.12,
  zhuji: 1.12,
  jiedan: 1.12,
  yuanying: 1.1,
  huashen: 1.1,
};

export const ALCHEMY_RARITY_LABELS: Record<AlchemyBalanceRarity, string> = {
  common: "凡品",
  uncommon: "良品",
  rare: "上品",
  epic: "极品",
  legendary: "仙品",
  hongmeng: "鸿蒙",
};

export const AI_ALCHEMY_PILL_TOXICITY_BY_RARITY: Record<AlchemyBalanceRarity, number> = {
  common: 2,
  uncommon: 2,
  rare: 2,
  epic: 1,
  legendary: 1,
  hongmeng: 0,
};

export function getOfficialXpPillValue(stage: AlchemyBalanceStageKey) {
  return OFFICIAL_XP_PILL_VALUE_BY_STAGE[stage];
}

export function getOfficialXpPillToxicity() {
  return 1;
}

export function getAiAlchemyZeroToxicityBonusRate(stage: AlchemyBalanceStageKey) {
  return AI_ZERO_TOXICITY_BONUS_RATE_BY_STAGE[stage];
}

export function getAiAlchemyXpRangeByRarity(
  stage: AlchemyBalanceStageKey,
  rarity: AlchemyBalanceRarity,
): Range {
  const baseline = getOfficialXpPillValue(stage);
  const multiplier = AI_CULTIVATION_XP_RANGE_MULTIPLIERS[rarity];
  return {
    min: Math.round(baseline * multiplier.min),
    max: Math.round(baseline * multiplier.max),
  };
}

export function getAiAlchemyStageXpRange(stage: AlchemyBalanceStageKey) {
  const commonRange = getAiAlchemyXpRangeByRarity(stage, "common");
  const hongmengRange = getAiAlchemyXpRangeByRarity(stage, "hongmeng");
  return {
    min: commonRange.min,
    max: hongmengRange.max,
  };
}

export function resolveAiAlchemyResultRarityLabel(
  rarity: AlchemyBalanceRarity,
  toxicity: number,
) {
  if (rarity === "hongmeng" || toxicity <= 0) {
    return ALCHEMY_RARITY_LABELS.hongmeng;
  }
  return ALCHEMY_RARITY_LABELS[rarity];
}
