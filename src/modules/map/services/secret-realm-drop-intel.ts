import type { SecretRealmLootBlueprint, ItemRarity, SecretRealmMonsterRole } from "@/types/game";
import {
  normalizeSecretRealmItemRarity,
  sanitizeSecretRealmLootBlueprintByRole,
} from "@/modules/map/services/secret-realm-loot-rarity";

export type SecretRealmDropIntelEntry = {
  label: string;
  rarity: ItemRarity;
  rarityLabel: string;
  chanceText: string;
  quantityText: string;
};

const BOSS_NATURAL_HONGMENG_INTEL_ENTRY: SecretRealmDropIntelEntry = {
  label: "鸿蒙灵材",
  rarity: "hongmeng",
  rarityLabel: "鸿蒙",
  chanceText: "极低概率",
  quantityText: "1",
};

const NORMAL_BASELINE_INTEL_ENTRIES: SecretRealmDropIntelEntry[] = [
  {
    label: "凡品灵材",
    rarity: "common",
    rarityLabel: "凡品",
    chanceText: "几乎必出",
    quantityText: "1",
  },
  {
    label: "良品灵材",
    rarity: "uncommon",
    rarityLabel: "良品",
    chanceText: "低概率",
    quantityText: "1",
  },
];

const RARITY_LABELS: Record<ItemRarity, string> = {
  common: "凡品",
  uncommon: "良品",
  rare: "上品",
  epic: "极品",
  legendary: "仙品",
  hongmeng: "鸿蒙",
};

const RARITY_RANKS: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  hongmeng: 6,
};

function resolveChanceText(chance: number) {
  if (chance >= 0.999) {
    return "几乎必出";
  }
  if (chance >= 0.6) {
    return "高概率";
  }
  if (chance >= 0.3) {
    return "中概率";
  }
  return "低概率";
}

function buildQuantityText(minQuantity: number, maxQuantity: number) {
  if (minQuantity === maxQuantity) {
    return `${minQuantity}`;
  }
  return `${minQuantity}-${maxQuantity}`;
}

export function buildSecretRealmDropIntel(blueprint?: SecretRealmLootBlueprint | null) {
  const sanitizedBlueprint = sanitizeSecretRealmLootBlueprintByRole(blueprint);
  if (!sanitizedBlueprint?.entries?.length) {
    return [] as SecretRealmDropIntelEntry[];
  }

  const grouped = new Map<string, {
    label: string;
    rarity: ItemRarity;
    chance: number;
    quantityMin: number;
    quantityMax: number;
  }>();

  for (const entry of sanitizedBlueprint.entries) {
    const rarity = normalizeSecretRealmItemRarity(entry.rarity);
    const label = `${RARITY_LABELS[rarity]}${entry.categoryLabel}`;
    const key = `${rarity}:${entry.categoryLabel}`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        label,
        rarity,
        chance: Number(entry.chance || 0),
        quantityMin: Math.max(1, Number(entry.quantityMin || 1)),
        quantityMax: Math.max(1, Number(entry.quantityMax || 1)),
      });
      continue;
    }

    current.chance = Math.max(current.chance, Number(entry.chance || 0));
    current.quantityMin = Math.min(current.quantityMin, Math.max(1, Number(entry.quantityMin || 1)));
    current.quantityMax = Math.max(current.quantityMax, Math.max(1, Number(entry.quantityMax || 1)));
  }

  let entries = Array.from(grouped.values())
    .sort((left, right) => {
      if (Math.abs(right.chance - left.chance) > 0.001) {
        return right.chance - left.chance;
      }
      return RARITY_RANKS[right.rarity] - RARITY_RANKS[left.rarity];
    })
    .slice(0, 4)
    .map((entry) => ({
      label: entry.label,
      rarity: entry.rarity,
      rarityLabel: RARITY_LABELS[entry.rarity],
      chanceText: resolveChanceText(entry.chance),
      quantityText: buildQuantityText(entry.quantityMin, entry.quantityMax),
    })) satisfies SecretRealmDropIntelEntry[];

  if (sanitizedBlueprint.role === "normal") {
    const existingRarities = new Set(entries.map((entry) => entry.rarity));
    const missingBaselineEntries = NORMAL_BASELINE_INTEL_ENTRIES.filter((entry) => !existingRarities.has(entry.rarity));
    if (missingBaselineEntries.length > 0) {
      entries = [...missingBaselineEntries, ...entries]
        .filter((entry, index, array) => array.findIndex((candidate) => candidate.label === entry.label) === index)
        .slice(0, 4);
    }
  }

  if (sanitizedBlueprint.role === "boss" && !entries.some((entry) => entry.rarity === "hongmeng")) {
    entries = [...entries.slice(0, 3), BOSS_NATURAL_HONGMENG_INTEL_ENTRY];
  }

  return entries;
}

export function buildSecretRealmFallbackDropIntel(role: SecretRealmMonsterRole) {
  if (role === "boss") {
    return [
      {
        label: "上品灵材",
        rarity: "rare",
        rarityLabel: RARITY_LABELS.rare,
        chanceText: "高概率",
        quantityText: "1",
      },
      {
        label: "极品灵材",
        rarity: "epic",
        rarityLabel: RARITY_LABELS.epic,
        chanceText: "中概率",
        quantityText: "1",
      },
      {
        label: "仙品灵材",
        rarity: "legendary",
        rarityLabel: RARITY_LABELS.legendary,
        chanceText: "低概率",
        quantityText: "1",
      },
      BOSS_NATURAL_HONGMENG_INTEL_ENTRY,
    ] satisfies SecretRealmDropIntelEntry[];
  }

  if (role === "elite") {
    return [
      {
        label: "良品灵材",
        rarity: "uncommon",
        rarityLabel: RARITY_LABELS.uncommon,
        chanceText: "高概率",
        quantityText: "1",
      },
      {
        label: "上品灵材",
        rarity: "rare",
        rarityLabel: RARITY_LABELS.rare,
        chanceText: "中概率",
        quantityText: "1",
      },
      {
        label: "极品灵材",
        rarity: "epic",
        rarityLabel: RARITY_LABELS.epic,
        chanceText: "低概率",
        quantityText: "1",
      },
    ] satisfies SecretRealmDropIntelEntry[];
  }

  return [
    ...NORMAL_BASELINE_INTEL_ENTRIES,
  ] satisfies SecretRealmDropIntelEntry[];
}
