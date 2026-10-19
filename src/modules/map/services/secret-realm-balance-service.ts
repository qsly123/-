import type {
  SecretRealmMonsterPlan,
  SecretRealmPoint,
  SecretRealmRarity,
  SecretRealmRewardPlan,
  SecretRealmSizeTier,
  SecretRealmTemplateSnapshot,
  SecretRealmValidationReport,
  TileData,
} from "@/types/game";

type SecretRealmSizeConfig = {
  min: number;
  max: number;
  blockedRatioMin: number;
  blockedRatioMax: number;
  baseBudget: number;
};

export const SECRET_REALM_PERSONAL_PITY_THRESHOLD = 3;
export const SECRET_REALM_GLOBAL_COOLDOWN_MS = 8 * 60 * 1000;
export const SECRET_REALM_PERSONAL_COOLDOWN_MS = 24 * 60 * 1000;
export const SECRET_REALM_GLOBAL_LIFETIME_MS = 18 * 60 * 1000;
export const SECRET_REALM_PERSONAL_LIFETIME_MS = 30 * 60 * 1000;
export const SECRET_REALM_INSTANCE_LIFETIME_MS = 40 * 60 * 1000;
export const SECRET_REALM_SETTLE_LIFETIME_MS = 2 * 60 * 1000;
export const SECRET_REALM_MAX_GLOBAL_SPAWNS_PER_TICK = 2;

export const SECRET_REALM_SIZE_CONFIG: Record<SecretRealmSizeTier, SecretRealmSizeConfig> = {
  small: {
    min: 9,
    max: 13,
    blockedRatioMin: 0.36,
    blockedRatioMax: 0.62,
    baseBudget: 110,
  },
  medium: {
    min: 15,
    max: 25,
    blockedRatioMin: 0.4,
    blockedRatioMax: 0.66,
    baseBudget: 180,
  },
  large: {
    min: 30,
    max: 50,
    blockedRatioMin: 0.45,
    blockedRatioMax: 0.7,
    baseBudget: 280,
  },
};

const RARITY_MULTIPLIERS: Record<SecretRealmRarity, number> = {
  common: 1,
  rare: 1.18,
  epic: 1.42,
  legendary: 1.75,
};

export function randomInt(minValue: number, maxValue: number) {
  if (maxValue <= minValue) {
    return minValue;
  }
  return minValue + Math.floor(Math.random() * (maxValue - minValue + 1));
}

export function randomPick<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)] as T;
}

export function normalizeSecretRealmSizeTier(value: unknown): SecretRealmSizeTier {
  if (value === "large" || value === "medium" || value === "small") {
    return value;
  }
  return "small";
}

export function normalizeSecretRealmRarity(value: unknown): SecretRealmRarity {
  if (value === "legendary" || value === "epic" || value === "rare" || value === "common") {
    return value;
  }
  return "common";
}

export function pickSecretRealmDimensions(sizeTier: SecretRealmSizeTier) {
  const config = SECRET_REALM_SIZE_CONFIG[sizeTier];
  return {
    width: randomInt(config.min, config.max),
    height: randomInt(config.min, config.max),
  };
}

export function pickSecretRealmRarity(sizeTier: SecretRealmSizeTier): SecretRealmRarity {
  const roll = Math.random();
  if (sizeTier === "large") {
    if (roll > 0.93) return "legendary";
    if (roll > 0.68) return "epic";
    if (roll > 0.35) return "rare";
    return "common";
  }
  if (sizeTier === "medium") {
    if (roll > 0.97) return "legendary";
    if (roll > 0.82) return "epic";
    if (roll > 0.48) return "rare";
    return "common";
  }
  if (roll > 0.99) return "legendary";
  if (roll > 0.9) return "epic";
  if (roll > 0.62) return "rare";
  return "common";
}

export function buildSecretRealmRewardPlan(params: {
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
}): SecretRealmRewardPlan {
  const sizeConfig = SECRET_REALM_SIZE_CONFIG[params.sizeTier];
  const budget = Math.round(sizeConfig.baseBudget * RARITY_MULTIPLIERS[params.rarity]);

  const dropQualityTags = params.rarity === "legendary"
    ? ["legendary", "epic", "rare", "uncommon"]
    : params.rarity === "epic"
      ? ["epic", "rare", "uncommon", "common"]
      : params.rarity === "rare"
        ? ["rare", "uncommon", "common"]
        : ["uncommon", "common"];

  const rarityWeights = params.rarity === "legendary"
    ? { common: 18, uncommon: 28, rare: 30, epic: 24, legendary: 0, hongmeng: 0 }
    : params.rarity === "epic"
      ? { common: 24, uncommon: 30, rare: 28, epic: 18, legendary: 0, hongmeng: 0 }
      : params.rarity === "rare"
        ? { common: 28, uncommon: 32, rare: 26, epic: 14, legendary: 0, hongmeng: 0 }
        : { common: 34, uncommon: 34, rare: 22, epic: 10, legendary: 0, hongmeng: 0 };

  const categoryWeights = {
    existing_material: params.rarity === "legendary" ? 36 : 40,
    alchemy_material: params.rarity === "common" ? 25 : 24,
    smithing_material: params.rarity === "legendary" ? 24 : 25,
    herb_seed: params.rarity === "legendary" ? 10 : 10,
    equipment: params.rarity === "common" ? 0 : 10,
  } as const;

  return {
    budget,
    secretCurrencyAmount: Math.max(12, Math.round(budget / 6)),
    dropQualityTags,
    rarityWeights,
    categoryWeights,
    roleRewardConfigs: {
      normal: {
        slotMin: 0,
        slotMax: 1,
        categoryWeights: {
          existing_material: 40,
          alchemy_material: categoryWeights.alchemy_material,
          smithing_material: categoryWeights.smithing_material,
          herb_seed: categoryWeights.herb_seed,
          equipment: 0,
        },
        rarityWeights,
      },
      elite: {
        slotMin: 1,
        slotMax: 2,
        categoryWeights: {
          existing_material: 35,
          herb_seed: 15,
          alchemy_material: 20,
          smithing_material: 20,
          equipment: 10,
        },
        guaranteedCategories: ["alchemy_material"],
        rarityWeights: {
          common: Math.max(10, rarityWeights.common - 8),
          uncommon: Math.max(24, rarityWeights.uncommon + 4),
          rare: Math.max(28, rarityWeights.rare + 6),
          epic: Math.max(14, rarityWeights.epic + 4),
          legendary: 0,
          hongmeng: 0,
        },
      },
      boss: {
        slotMin: 1,
        slotMax: 2,
        categoryWeights: {
          existing_material: 50,
          alchemy_material: 20,
          smithing_material: 20,
          herb_seed: 0,
          equipment: 10,
        },
        guaranteedCategories: ["existing_material"],
        rarityWeights: {
          common: 0,
          uncommon: 0,
          rare: Math.max(52, rarityWeights.rare),
          epic: Math.max(36, rarityWeights.epic + 14),
          legendary: 0,
          hongmeng: 0,
        },
      },
    },
    themeBiasTags: [],
    elementWeights: {
      metal: 20,
      wood: 20,
      water: 20,
      fire: 20,
      earth: 20,
    },
  };
}

export function buildSecretRealmMonsterPlan(params: {
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
}): SecretRealmMonsterPlan[] {
  const commonCount = params.sizeTier === "large" ? 18 : params.sizeTier === "medium" ? 10 : 6;
  const eliteCount = params.sizeTier === "large" ? 4 : params.sizeTier === "medium" ? 2 : 1;
  const eliteWeight = params.rarity === "legendary" ? 0.24 : params.rarity === "epic" ? 0.2 : 0.16;

  return [
    {
      role: "normal",
      count: commonCount,
      budgetWeight: 0.55,
      labels: ["杂兵", "巡守"],
    },
    {
      role: "elite",
      count: eliteCount,
      budgetWeight: eliteWeight,
      labels: ["精英", "词缀"],
    },
    {
      role: "boss",
      count: 1,
      budgetWeight: 1,
      labels: ["首领", params.rarity],
    },
  ];
}

function buildTileKey(point: SecretRealmPoint) {
  return `${point.x},${point.y}`;
}

function isWalkableTile(tile: TileData | undefined) {
  return tile?.walkable !== false;
}

function buildTileMap(tilesData: TileData[]) {
  return new Map(tilesData.map((tile) => [buildTileKey(tile), tile]));
}

function getNeighbors(point: SecretRealmPoint, width: number, height: number) {
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  return directions
    .map((direction) => ({ x: point.x + direction.x, y: point.y + direction.y }))
    .filter((candidate) => (
      candidate.x >= 0
      && candidate.x < width
      && candidate.y >= 0
      && candidate.y < height
    ));
}

export function listReachablePoints(snapshot: SecretRealmTemplateSnapshot, start: SecretRealmPoint) {
  const tileMap = buildTileMap(snapshot.tilesData);
  const startTile = tileMap.get(buildTileKey(start));
  if (!isWalkableTile(startTile)) {
    return [];
  }
  const visited = new Set<string>();
  const queue: SecretRealmPoint[] = [start];
  const reachablePoints: SecretRealmPoint[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as SecretRealmPoint;
    const currentKey = buildTileKey(current);
    if (visited.has(currentKey)) {
      continue;
    }
    visited.add(currentKey);
    reachablePoints.push(current);

    for (const next of getNeighbors(current, snapshot.width, snapshot.height)) {
      const tile = tileMap.get(buildTileKey(next));
      if (!isWalkableTile(tile)) {
        continue;
      }
      queue.push(next);
    }
  }

  return reachablePoints;
}

function canReach(snapshot: SecretRealmTemplateSnapshot, start: SecretRealmPoint, target: SecretRealmPoint) {
  const reachableKeys = new Set(listReachablePoints(snapshot, start).map((point) => buildTileKey(point)));
  return reachableKeys.has(buildTileKey(target));
}

export function calculateBlockedRatio(snapshot: SecretRealmTemplateSnapshot) {
  const total = Math.max(1, snapshot.width * snapshot.height);
  const blockedCount = snapshot.tilesData.filter((tile) => tile.walkable === false).length;
  return blockedCount / total;
}

export function validateSecretRealmSnapshot(
  snapshot: SecretRealmTemplateSnapshot,
  source: "ai" | "fallback",
): SecretRealmValidationReport {
  const reasons: string[] = [];
  const sizeTier = normalizeSecretRealmSizeTier(snapshot.sizeTier);
  const config = SECRET_REALM_SIZE_CONFIG[sizeTier];
  const blockedRatio = calculateBlockedRatio(snapshot);

  if (snapshot.width < config.min || snapshot.width > config.max) {
    reasons.push(`宽度 ${snapshot.width} 不在 ${config.min}-${config.max} 范围内`);
  }

  if (snapshot.height < config.min || snapshot.height > config.max) {
    reasons.push(`高度 ${snapshot.height} 不在 ${config.min}-${config.max} 范围内`);
  }

  if (blockedRatio < config.blockedRatioMin || blockedRatio > config.blockedRatioMax) {
    reasons.push(`阻挡占比 ${blockedRatio.toFixed(2)} 超出 ${config.blockedRatioMin.toFixed(2)}-${config.blockedRatioMax.toFixed(2)}`);
  }

  const entryReachableKeys = new Set(listReachablePoints(snapshot, snapshot.entryPoint).map((point) => buildTileKey(point)));
  const disconnectedWalkableCount = snapshot.tilesData.filter((tile) => (
    isWalkableTile(tile) && !entryReachableKeys.has(buildTileKey(tile))
  )).length;
  if (disconnectedWalkableCount > 0) {
    reasons.push(`存在 ${disconnectedWalkableCount} 个入口无法到达的可通行格`);
  }

  if (!canReach(snapshot, snapshot.entryPoint, snapshot.bossPoint)) {
    reasons.push("入口无法到达 Boss");
  }

  if (!canReach(snapshot, snapshot.entryPoint, snapshot.returnPoint)) {
    reasons.push("入口无法到达回返阵");
  }

  if (!canReach(snapshot, snapshot.returnPoint, snapshot.bossPoint)) {
    reasons.push("回返阵无法到达 Boss");
  }

  return {
    passed: reasons.length === 0,
    source,
    reasons,
    blockedRatio,
    width: snapshot.width,
    height: snapshot.height,
  };
}
