import {
  buildItemEffectExtraText,
  formatItemEffectRateValue,
  formatItemEffectText,
  type ItemEffectDisplayEntry,
} from "@/modules/character/services/item-effect-display";
import { RARITY_COLORS } from "@/modules/shared/constants";

type EquipmentStageKey = "lianqi" | "zhuji" | "jiedan" | "yuanying" | "huashen";
type EquipmentEffectTierKey = "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";

type EquipmentEffectSummaryConfig = {
  type: string;
  label: string;
  formatValue?: (value: number) => string;
};

export type EquipmentItemDisplayMeta = {
  itemType?: string | null;
  minRealm?: number | null;
};

export type EquipmentEffectDisplayLine = {
  key: string;
  text: string;
  extraText: string;
  color: string;
  tierKey: EquipmentEffectTierKey | null;
  isSkill: boolean;
};

type EquipmentEffectDisplaySource = ItemEffectDisplayEntry & {
  label?: string;
  text?: string;
  extraText?: string;
};

const EQUIPPABLE_ITEM_TYPES = new Set(["weapon", "armor", "helmet", "shoes", "artifact"]);
const DEFAULT_EFFECT_COLOR = "#c9c1b1";
const SKILL_EFFECT_COLOR = RARITY_COLORS.legendary;
const EQUIPMENT_EFFECT_TIER_COLORS: Record<EquipmentEffectTierKey, string> = {
  common: "#f3efe5",
  uncommon: RARITY_COLORS.uncommon,
  rare: RARITY_COLORS.rare,
  epic: RARITY_COLORS.epic,
  legendary: RARITY_COLORS.legendary,
  hongmeng: RARITY_COLORS.hongmeng,
};
const EQUIPMENT_STAGE_THRESHOLDS: Array<{ key: EquipmentStageKey; minRealm: number; scalar: number }> = [
  { key: "huashen", minRealm: 25, scalar: 5 },
  { key: "yuanying", minRealm: 21, scalar: 4 },
  { key: "jiedan", minRealm: 17, scalar: 3 },
  { key: "zhuji", minRealm: 13, scalar: 2 },
  { key: "lianqi", minRealm: 1, scalar: 1 },
];

const EQUIPMENT_EFFECT_TIER_ORDER: readonly EquipmentEffectTierKey[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "hongmeng",
] as const;

const EQUIPMENT_EFFECT_TIER_STEPS: Partial<Record<string, readonly number[]>> = {
  boost_atk: [6, 7, 8, 9, 10, 12],
  boost_def: [2, 3, 4, 5, 6, 7],
  boost_hp: [18, 30, 42, 54, 66, 78],
  boost_mp: [8, 12, 16, 20, 24, 28],
  boost_speed: [1, 2, 3, 4, 5, 6],
  boost_luck: [1, 2, 3, 4, 5, 6],
  boost_spiritual_sense: [1, 2, 3, 4, 5, 6],
  boost_armor_penetration: [1, 2, 3, 4, 5, 6],
  boost_block: [1, 2, 3, 4, 5, 6],
  boost_skill_damage_bonus: [1, 2, 3, 4, 5, 6],
  boost_skill_damage_reduction: [1, 2, 3, 4, 5, 6],
  boost_artifact_damage_bonus: [1, 2, 3, 4, 5, 6],
  boost_artifact_damage_reduction: [1, 2, 3, 4, 5, 6],
};

const EQUIPMENT_EFFECT_SUMMARY_CONFIGS: readonly EquipmentEffectSummaryConfig[] = [
  { type: "boost_atk", label: "攻击" },
  { type: "boost_def", label: "防御" },
  { type: "boost_hp", label: "最大气血" },
  { type: "boost_mp", label: "最大灵力" },
  { type: "boost_speed", label: "遁速" },
  { type: "boost_luck", label: "幸运" },
  { type: "boost_spiritual_sense", label: "神识" },
  { type: "boost_armor_penetration", label: "破防" },
  { type: "boost_block", label: "格挡" },
  { type: "boost_skill_damage_bonus", label: "神通增伤", formatValue: (value) => `+${value}%` },
  { type: "boost_skill_damage_reduction", label: "神通减伤", formatValue: (value) => `+${value}%` },
  { type: "boost_artifact_damage_bonus", label: "法宝增伤", formatValue: (value) => `+${value}%` },
  { type: "boost_artifact_damage_reduction", label: "法宝减伤", formatValue: (value) => `+${value}%` },
  { type: "boost_breakthrough", label: "突破成功率", formatValue: formatItemEffectRateValue },
  { type: "boost_xp", label: "修为" },
] as const;

function isEquippableItemType(itemType?: string | null) {
  return typeof itemType === "string" && EQUIPPABLE_ITEM_TYPES.has(itemType);
}

function resolveEquipmentStageScalar(minRealm?: number | null) {
  const realm = Math.max(1, Math.floor(Number(minRealm || 1)));
  const stage = EQUIPMENT_STAGE_THRESHOLDS.find((entry) => realm >= entry.minRealm) || EQUIPMENT_STAGE_THRESHOLDS.at(-1)!;
  return stage.scalar;
}

function resolveTierKeyFromSteps(value: number, steps: readonly number[]): EquipmentEffectTierKey {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (value >= steps[index]) {
      return EQUIPMENT_EFFECT_TIER_ORDER[index] || "hongmeng";
    }
  }
  return "common";
}

function resolveEquipmentEffectTier(effect: EquipmentEffectDisplaySource, item: EquipmentItemDisplayMeta) {
  if (!isEquippableItemType(item.itemType)) {
    return null;
  }

  const type = typeof effect.type === "string" ? effect.type : "";
  if (type === "bind_skill" || type === "learn_skill") {
    return {
      key: "legendary" as EquipmentEffectTierKey,
      color: SKILL_EFFECT_COLOR,
    };
  }

  const numericValue = Number(effect.value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  const baseSteps = EQUIPMENT_EFFECT_TIER_STEPS[type];
  if (!baseSteps) {
    return null;
  }

  const scalar = resolveEquipmentStageScalar(item.minRealm);
  const scaledSteps = baseSteps.map((entry) => Math.max(1, Math.round(entry * scalar)));
  const tierKey = resolveTierKeyFromSteps(numericValue, scaledSteps);
  return {
    key: tierKey,
    color: EQUIPMENT_EFFECT_TIER_COLORS[tierKey] || DEFAULT_EFFECT_COLOR,
  };
}

function buildEffectLineText(effect: EquipmentEffectDisplaySource) {
  const baseText = String(effect.text || "").trim();
  if (baseText) {
    return baseText;
  }
  const labelText = String(effect.label || "").trim();
  if (labelText) {
    return labelText;
  }
  return formatItemEffectText(effect);
}

export function buildEquipmentEffectDetailLines(
  item: EquipmentItemDisplayMeta,
  effects: EquipmentEffectDisplaySource[] | null | undefined,
) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return [] as EquipmentEffectDisplayLine[];
  }

  return effects.map((effect, index) => {
    const tier = resolveEquipmentEffectTier(effect, item);
    const type = typeof effect.type === "string" ? effect.type : "unknown";
    return {
      key: `${type}-${index}`,
      text: buildEffectLineText(effect),
      extraText: String(effect.extraText || buildItemEffectExtraText(effect) || "").trim(),
      color: tier?.color || DEFAULT_EFFECT_COLOR,
      tierKey: tier?.key || null,
      isSkill: type === "bind_skill" || type === "learn_skill",
    };
  });
}

export function buildEquipmentEffectSummaryLines(
  item: EquipmentItemDisplayMeta,
  effects: EquipmentEffectDisplaySource[] | null | undefined,
) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return [] as EquipmentEffectDisplayLine[];
  }

  const totals = new Map<string, number>();
  for (const effect of effects) {
    const type = typeof effect.type === "string" ? effect.type : "";
    if (!type || type === "bind_skill" || type === "learn_skill") {
      continue;
    }
    const value = Number(effect.value || 0);
    if (!Number.isFinite(value) || value === 0) {
      continue;
    }
    totals.set(type, Number(totals.get(type) || 0) + value);
  }

  return EQUIPMENT_EFFECT_SUMMARY_CONFIGS.flatMap((config) => {
    const value = Number(totals.get(config.type) || 0);
    if (!Number.isFinite(value) || value === 0) {
      return [];
    }
    const tier = resolveEquipmentEffectTier({ type: config.type, value }, item);
    const valueText = config.formatValue
      ? config.formatValue(value)
      : `${value > 0 ? "+" : ""}${value}`;
    return [{
      key: `${config.type}-summary`,
      text: `${config.label} ${valueText}`,
      extraText: "",
      color: tier?.color || DEFAULT_EFFECT_COLOR,
      tierKey: tier?.key || null,
      isSkill: false,
    } satisfies EquipmentEffectDisplayLine];
  });
}
