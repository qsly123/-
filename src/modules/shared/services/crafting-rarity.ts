export type CraftingMaterialRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";

export type CraftingOutputRarityWeights = Record<CraftingMaterialRarity, number>;

export type CraftingOutputRarityResolution = {
  rarity: CraftingMaterialRarity;
  dominantRarity: CraftingMaterialRarity;
  dominantCount: number;
  supportAbove: number;
  supportBelow: number;
  rarityPattern: string;
  weights: CraftingOutputRarityWeights;
};

const RARITY_ORDER: readonly CraftingMaterialRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "hongmeng",
];

const DEFAULT_OUTPUT_RARITY: CraftingMaterialRarity = "uncommon";

const BASELINE_WEIGHT_BY_DOMINANT_COUNT: Record<number, { same: number; side: number; sideBiasFactor: number }> = {
  1: { same: 0.45, side: 0.55, sideBiasFactor: 0.04 },
  2: { same: 0.5, side: 0.5, sideBiasFactor: 0.05 },
  3: { same: 0.7, side: 0.3, sideBiasFactor: 0.05 },
  4: { same: 0.85, side: 0.15, sideBiasFactor: 0.04 },
};

export function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function normalizeCraftingMaterialRarity(
  value: unknown,
  fallback: CraftingMaterialRarity = DEFAULT_OUTPUT_RARITY,
): CraftingMaterialRarity {
  const rarity = String(value || "").trim().toLowerCase();
  if (rarity === "common") return "common";
  if (rarity === "uncommon") return "uncommon";
  if (rarity === "rare") return "rare";
  if (rarity === "epic") return "epic";
  if (rarity === "legendary") return "legendary";
  if (rarity === "hongmeng") return "hongmeng";
  return fallback;
}

export function getCraftingMaterialRarityRank(rarity: CraftingMaterialRarity) {
  return RARITY_ORDER.indexOf(rarity);
}

export function getCraftingMaterialRarityByRank(rank: number): CraftingMaterialRarity {
  const safeRank = Math.max(0, Math.min(RARITY_ORDER.length - 1, Math.round(rank)));
  return RARITY_ORDER[safeRank] || DEFAULT_OUTPUT_RARITY;
}

function createEmptyWeights(): CraftingOutputRarityWeights {
  return {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    hongmeng: 0,
  };
}

function normalizeWeights(weights: CraftingOutputRarityWeights): CraftingOutputRarityWeights {
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  if (total <= 0) {
    return {
      ...createEmptyWeights(),
      [DEFAULT_OUTPUT_RARITY]: 1,
    };
  }

  const normalized = createEmptyWeights();
  for (const rarity of RARITY_ORDER) {
    normalized[rarity] = Math.max(0, Number(weights[rarity] || 0)) / total;
  }
  return normalized;
}

export function buildCraftingOutputRarityWeights(
  materialRarities: readonly CraftingMaterialRarity[],
): Omit<CraftingOutputRarityResolution, "rarity"> {
  if (materialRarities.length === 0) {
    return {
      dominantRarity: DEFAULT_OUTPUT_RARITY,
      dominantCount: 0,
      supportAbove: 0,
      supportBelow: 0,
      rarityPattern: "",
      weights: normalizeWeights({
        ...createEmptyWeights(),
        [DEFAULT_OUTPUT_RARITY]: 1,
      }),
    };
  }

  const counts = createEmptyWeights();
  let totalRank = 0;

  for (const rarity of materialRarities) {
    counts[rarity] += 1;
    totalRank += getCraftingMaterialRarityRank(rarity);
  }

  let dominantRarity: CraftingMaterialRarity = DEFAULT_OUTPUT_RARITY;
  let dominantCount = 0;

  for (const rarity of RARITY_ORDER) {
    const currentCount = counts[rarity];
    const currentRank = getCraftingMaterialRarityRank(rarity);
    const dominantRank = getCraftingMaterialRarityRank(dominantRarity);
    if (currentCount > dominantCount || (currentCount === dominantCount && currentRank > dominantRank)) {
      dominantRarity = rarity;
      dominantCount = currentCount;
    }
  }

  if (dominantCount <= 1) {
    dominantRarity = getCraftingMaterialRarityByRank(totalRank / materialRarities.length);
  }

  const dominantRank = getCraftingMaterialRarityRank(dominantRarity);
  let supportAbove = 0;
  let supportBelow = 0;
  for (const rarity of materialRarities) {
    const rank = getCraftingMaterialRarityRank(rarity);
    if (rank > dominantRank) {
      supportAbove += rank - dominantRank;
    } else if (rank < dominantRank) {
      supportBelow += dominantRank - rank;
    }
  }

  const baseline = BASELINE_WEIGHT_BY_DOMINANT_COUNT[Math.max(1, Math.min(4, dominantCount))];
  const weights = createEmptyWeights();
  const directionalBias = Math.max(-baseline.side / 2, Math.min(
    baseline.side / 2,
    (supportAbove - supportBelow) * baseline.sideBiasFactor,
  ));
  const upWeight = baseline.side / 2 + directionalBias;
  const downWeight = baseline.side / 2 - directionalBias;

  weights[dominantRarity] += baseline.same;

  if (dominantRank + 1 < RARITY_ORDER.length) {
    weights[getCraftingMaterialRarityByRank(dominantRank + 1)] += upWeight;
  } else {
    weights[dominantRarity] += upWeight;
  }

  if (dominantRank - 1 >= 0) {
    weights[getCraftingMaterialRarityByRank(dominantRank - 1)] += downWeight;
  } else {
    weights[dominantRarity] += downWeight;
  }

  const rarityPattern = [...RARITY_ORDER]
    .reverse()
    .map((rarity) => `${rarity}:${counts[rarity]}`)
    .join("|");

  return {
    dominantRarity,
    dominantCount,
    supportAbove,
    supportBelow,
    rarityPattern,
    weights: normalizeWeights(weights),
  };
}

export function rollCraftingOutputRarity(
  materialRarities: readonly CraftingMaterialRarity[],
  randomValue = Math.random(),
): CraftingOutputRarityResolution {
  const resolution = buildCraftingOutputRarityWeights(materialRarities);
  const roll = clamp01(randomValue);
  let cumulative = 0;

  for (const rarity of RARITY_ORDER) {
    cumulative += resolution.weights[rarity];
    if (roll <= cumulative) {
      return {
        rarity,
        dominantRarity: resolution.dominantRarity,
        dominantCount: resolution.dominantCount,
        supportAbove: resolution.supportAbove,
        supportBelow: resolution.supportBelow,
        rarityPattern: resolution.rarityPattern,
        weights: resolution.weights,
      };
    }
  }

  const fallbackRarity = resolution.dominantRarity;
  return {
    rarity: fallbackRarity,
    dominantRarity: resolution.dominantRarity,
    dominantCount: resolution.dominantCount,
    supportAbove: resolution.supportAbove,
    supportBelow: resolution.supportBelow,
    rarityPattern: resolution.rarityPattern,
    weights: resolution.weights,
  };
}
