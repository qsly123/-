import { normalizeFortuneModifierValue, normalizeFortuneRateValue } from "@/modules/shared/services/fortune-effect";
import type {
  AttributeDelta,
  FortuneEventAttributeDelta,
  FortuneEventEffects,
  FortuneSpecialEffects,
} from "@/types/game";

export function formatFortunePercent(rate: number) {
  const percent = rate * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function toInt(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function formatSignedNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  return value > 0 ? `+${value}` : `${value}`;
}

export function buildFortuneAttrLines(attrEffects: AttributeDelta | null | undefined) {
  return [
    { label: "当前气血", value: toInt(attrEffects?.hp) },
    { label: "最大气血", value: toInt(attrEffects?.maxHp) },
    { label: "当前灵力", value: toInt(attrEffects?.mp) },
    { label: "最大灵力", value: toInt(attrEffects?.maxMp) },
    { label: "攻击", value: toInt(attrEffects?.attack) },
    { label: "防御", value: toInt(attrEffects?.defense) },
    { label: "遁速", value: toInt(attrEffects?.speed) },
    { label: "神识", value: toInt(attrEffects?.spiritualSense) },
    { label: "破防", value: toInt(attrEffects?.armorPenetration) },
    { label: "格挡", value: toInt(attrEffects?.block) },
    { label: "神通增伤", value: toInt(attrEffects?.skillDamageBonus) },
    { label: "神通减伤", value: toInt(attrEffects?.skillDamageReduction) },
    { label: "法宝增伤", value: toInt(attrEffects?.artifactDamageBonus) },
    { label: "法宝减伤", value: toInt(attrEffects?.artifactDamageReduction) },
    { label: "幸运", value: toInt(attrEffects?.luck) },
  ]
    .filter((item) => item.value !== 0)
    .map((item) => `${item.label}：${item.value >= 0 ? `+${item.value}` : item.value}`);
}

export function buildFortuneEventAttrLines(attrEffects: FortuneEventAttributeDelta | null | undefined) {
  return [
    { key: "hp", label: "当前气血" },
    { key: "maxHp", label: "最大气血" },
    { key: "mp", label: "当前灵力" },
    { key: "maxMp", label: "最大灵力" },
    { key: "attack", label: "攻击" },
    { key: "defense", label: "防御" },
    { key: "speed", label: "遁速" },
    { key: "luck", label: "幸运" },
    { key: "spiritualSense", label: "神识" },
    { key: "armorPenetration", label: "破防" },
    { key: "block", label: "格挡" },
    { key: "skillDamageBonus", label: "神通增伤" },
    { key: "skillDamageReduction", label: "神通减伤" },
    { key: "artifactDamageBonus", label: "法宝增伤" },
    { key: "artifactDamageReduction", label: "法宝减伤" },
  ]
    .map((item) => {
      const rawValue = attrEffects?.[item.key as keyof FortuneEventAttributeDelta];
      const normalized = normalizeFortuneModifierValue(rawValue);
      if (normalized.flat === 0 && normalized.percent === 0) {
        return null;
      }

      const parts: string[] = [];
      if (normalized.flat !== 0) {
        parts.push(formatSignedNumber(normalized.flat));
      }
      if (normalized.percent !== 0) {
        parts.push(`${formatSignedNumber(normalized.percent)}%`);
      }
      return `${item.label}：${parts.join("，")}`;
    })
    .filter((item): item is string => Boolean(item));
}

export function buildFortuneEventSections(eventEffects: FortuneEventEffects | null | undefined) {
  return [
    { label: "击杀玩家", lines: buildFortuneEventAttrLines(eventEffects?.killPlayer) },
    { label: "击杀怪物", lines: buildFortuneEventAttrLines(eventEffects?.killMonster) },
    { label: "自身死亡", lines: buildFortuneEventAttrLines(eventEffects?.selfDeath) },
  ].filter((section) => section.lines.length > 0);
}

export function buildFortuneSpecialLines(effects: FortuneSpecialEffects | null | undefined) {
  return [
    { label: "战斗修为", value: normalizeFortuneRateValue(effects?.combatXpRate) },
    { label: "奇遇修为", value: normalizeFortuneRateValue(effects?.adventureXpRate) },
    { label: "任务修为", value: normalizeFortuneRateValue(effects?.questXpRate) },
    { label: "丹药修为", value: normalizeFortuneRateValue(effects?.pillXpRate) },
    { label: "双修修为", value: normalizeFortuneRateValue(effects?.doubleCultivationXpRate) },
    { label: "突破成功率", value: normalizeFortuneRateValue(effects?.breakthroughSuccessRate) },
    { label: "洞府灵气", value: normalizeFortuneRateValue(effects?.dongfuLingqiRate) },
    { label: "受孕概率", value: normalizeFortuneRateValue(effects?.pregnancyChanceRate) },
    { label: "孕育推进", value: normalizeFortuneRateValue(effects?.pregnancyProgressRate) },
    { label: "双修液量", value: normalizeFortuneRateValue(effects?.doubleCultivationFluidRate) },
    { label: "双修留存", value: normalizeFortuneRateValue(effects?.doubleCultivationRetentionRate) },
  ]
    .filter((item) => item.value !== 0)
    .map((item) => `${item.label}：${formatFortunePercent(item.value)}`);
}
