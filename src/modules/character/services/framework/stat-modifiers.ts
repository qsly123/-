/**
 * 养成系统统一属性修饰契约。
 *
 * 所有养成模块（灵根 / 天赋 / 境界 / 功法 / 气运 / 装备 / 丹药）都只通过
 * StatModifier 表达自身对角色属性的影响，属性聚合与战斗结算统一从修饰层取数，
 * 避免各系统各自改基础属性导致互相覆盖。
 */

/** 可加成的属性键，与 PlayerStats / EquipmentStatsBonus 对齐。 */
export const STAT_KEYS = [
  "maxHp",
  "maxMp",
  "attack",
  "defense",
  "speed",
  "luck",
  "spiritualSense",
  "armorPenetration",
  "block",
  "skillDamageBonus",
  "skillDamageReduction",
  "artifactDamageBonus",
  "artifactDamageReduction",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** 固定值加成（装备、丹药等）。 */
export type StatFlatBonus = Partial<Record<StatKey, number>>;

/** 百分比加成（灵根、天赋、气运等），0.08 表示 +8%。 */
export type StatPercentBonus = Partial<Record<StatKey, number>>;

/**
 * 修饰层顺序：越靠前越基础。
 * realm 作为基准层，percent 层在后统一乘算。
 */
export const STAT_MODIFIER_LAYERS = [
  "realm",
  "spiritualRoot",
  "talent",
  "gongfa",
  "fortune",
  "equipment",
  "status",
] as const;

export type StatModifierLayer = (typeof STAT_MODIFIER_LAYERS)[number];

export interface StatModifier {
  layer: StatModifierLayer;
  flat?: StatFlatBonus;
  percent?: StatPercentBonus;
  /** 元素（五行）伤害加成，独立于常规属性，供五行克制结算使用。 */
  elementDamageBonus?: number;
}

/** 灵根 bonuses 的字段与内部属性键的映射。 */
export const SPIRITUAL_ROOT_PERCENT_KEY_MAP: Record<string, StatKey> = {
  hpPercent: "maxHp",
  mpPercent: "maxMp",
  atkPercent: "attack",
  defPercent: "defense",
  speedPercent: "speed",
  luckPercent: "luck",
  spiritualSensePercent: "spiritualSense",
  armorPenetrationPercent: "armorPenetration",
  blockPercent: "block",
  skillDamageBonusPercent: "skillDamageBonus",
  skillDamageReductionPercent: "skillDamageReduction",
  artifactDamageBonusPercent: "artifactDamageBonus",
  artifactDamageReductionPercent: "artifactDamageReduction",
};

export interface MergedModifiers {
  flat: StatFlatBonus;
  percent: StatPercentBonus;
  elementDamageBonus: number;
}

export function createEmptyMergedModifiers(): MergedModifiers {
  return { flat: {}, percent: {}, elementDamageBonus: 0 };
}

/** 汇总多个修饰层：固定值相加、百分比相加、元素加成相加。 */
export function mergeStatModifiers(modifiers: readonly StatModifier[]): MergedModifiers {
  const merged = createEmptyMergedModifiers();

  for (const modifier of modifiers) {
    if (modifier.flat) {
      for (const key of STAT_KEYS) {
        const value = modifier.flat[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          merged.flat[key] = (merged.flat[key] ?? 0) + value;
        }
      }
    }
    if (modifier.percent) {
      for (const key of STAT_KEYS) {
        const value = modifier.percent[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          merged.percent[key] = (merged.percent[key] ?? 0) + value;
        }
      }
    }
    if (typeof modifier.elementDamageBonus === "number" && Number.isFinite(modifier.elementDamageBonus)) {
      merged.elementDamageBonus += modifier.elementDamageBonus;
    }
  }

  return merged;
}

/**
 * 按 `(base + Σflat) × (1 + Σpercent)` 计算最终属性。
 * 百分比层作用于固定值加成之后，因此灵根等成长型设计对装备与境界收益同样生效。
 */
export function applyModifiers(
  base: Readonly<Partial<Record<StatKey, number>>>,
  merged: MergedModifiers,
): Record<StatKey, number> {
  const result = {} as Record<StatKey, number>;

  for (const key of STAT_KEYS) {
    const baseValue = base[key] ?? 0;
    const flatValue = merged.flat[key] ?? 0;
    const percentValue = merged.percent[key] ?? 0;
    const scaled = (baseValue + flatValue) * (1 + percentValue);
    result[key] = Math.max(0, Math.round(scaled * 100) / 100);
  }

  return result;
}
