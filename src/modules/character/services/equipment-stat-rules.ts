import type { ItemEffect } from "@/types/game";
import { STAT_KEYS, type StatFlatBonus, type StatKey, type StatPercentBonus } from "@/modules/character/services/framework/stat-modifiers";

export const REFINE_BONUS_PER_LEVEL = 0.05;
export const MAX_REFINE_LEVEL = 10;

const SCALABLE_EFFECT_KEYS: Partial<Record<ItemEffect["type"], StatKey>> = {
  boost_hp: "maxHp", boost_mp: "maxMp", boost_atk: "attack", boost_def: "defense",
  boost_speed: "speed", boost_luck: "luck", boost_spiritual_sense: "spiritualSense",
  boost_armor_penetration: "armorPenetration", boost_block: "block",
};

export function isDamagePercentageStat(key: string): boolean {
  return key === "skillDamageBonus" || key === "skillDamageReduction"
    || key === "artifactDamageBonus" || key === "artifactDamageReduction";
}

export interface EquipmentStatAffix {
  kind?: string;
  key: string;
  flat?: number;
  percent?: number;
}

/** 只缩放固定属性；百分点、概率、治疗、技能绑定保持模板单位。 */
export function scaleEquipmentEffects(effects: ItemEffect[], stageMult: unknown): ItemEffect[] {
  const raw = Number(stageMult);
  const mult = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return effects.map((effect) => SCALABLE_EFFECT_KEYS[effect.type] && Number.isFinite(effect.value)
    ? { ...effect, value: Math.round(effect.value * mult) }
    : { ...effect });
}

/** 精炼使用已缩放、已取整的实例固定属性，展示与结算共用。 */
export function getEquipmentRefineBonus(effects: ItemEffect[], stageMult: unknown, refineLevel: number): StatFlatBonus {
  const level = Number.isFinite(refineLevel) ? Math.min(MAX_REFINE_LEVEL, Math.max(0, Math.floor(refineLevel))) : 0;
  const bonus: StatFlatBonus = {};
  for (const effect of scaleEquipmentEffects(effects, stageMult)) {
    const key = SCALABLE_EFFECT_KEYS[effect.type];
    if (!key || !Number.isFinite(effect.value)) continue;
    bonus[key] = (bonus[key] ?? 0) + effect.value * level * REFINE_BONUS_PER_LEVEL;
  }
  return bonus;
}

/** 兼容存量 percent:0.02；伤害类词条解释为增加2个百分点。 */
export function collectEquipmentAffixBonus(affixes: EquipmentStatAffix[] | null | undefined): {
  flat: StatFlatBonus; percent: StatPercentBonus;
} {
  const flat: StatFlatBonus = {};
  const percent: StatPercentBonus = {};
  for (const affix of affixes ?? []) {
    if (affix.kind && affix.kind !== "stat") continue;
    if (!STAT_KEYS.includes(affix.key as StatKey)) continue;
    const key = affix.key as StatKey;
    if (typeof affix.flat === "number" && Number.isFinite(affix.flat)) {
      flat[key] = (flat[key] ?? 0) + affix.flat;
    }
    if (typeof affix.percent === "number" && Number.isFinite(affix.percent)) {
      if (isDamagePercentageStat(key)) {
        flat[key] = (flat[key] ?? 0) + affix.percent * 100;
      } else {
        percent[key] = (percent[key] ?? 0) + affix.percent;
      }
    }
  }
  return { flat, percent };
}

export function getEquipmentDisplayEffects(effects: ItemEffect[], stageMult: unknown, refineLevel: number): ItemEffect[] {
  const scaled = scaleEquipmentEffects(effects, stageMult);
  const level = Number.isFinite(refineLevel) ? Math.min(MAX_REFINE_LEVEL, Math.max(0, Math.floor(refineLevel))) : 0;
  return scaled.map((effect) => SCALABLE_EFFECT_KEYS[effect.type] && Number.isFinite(effect.value)
    ? { ...effect, value: effect.value * (1 + level * REFINE_BONUS_PER_LEVEL) }
    : effect);
}
