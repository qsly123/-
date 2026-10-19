export type GongfaCombatBonusKey =
  | "maxHp"
  | "maxMp"
  | "attack"
  | "defense"
  | "speed"
  | "luck"
  | "spiritualSense"
  | "armorPenetration"
  | "block"
  | "skillDamageBonus"
  | "skillDamageReduction"
  | "artifactDamageBonus"
  | "artifactDamageReduction";

export type GongfaBonusFieldDefinition = {
  key: GongfaCombatBonusKey;
  label: string;
  group: "base" | "combat";
  aliases: string[];
  step?: number;
};

type GongfaBonusFieldGroup = {
  key: string;
  title: string;
  fields: Array<{
    key: string;
    label: string;
    step?: number;
  }>;
};

export const GONGFA_COMBAT_BONUS_DEFINITIONS: GongfaBonusFieldDefinition[] = [
  {
    key: "maxHp",
    label: "气血",
    group: "base",
    aliases: ["maxHp", "max_hp", "气血", "最大气血"],
  },
  {
    key: "maxMp",
    label: "灵力",
    group: "base",
    aliases: ["maxMp", "max_mp", "灵力", "最大灵力"],
  },
  {
    key: "attack",
    label: "攻击",
    group: "base",
    aliases: ["attack", "atk", "攻击"],
  },
  {
    key: "defense",
    label: "防御",
    group: "base",
    aliases: ["defense", "def", "防御"],
  },
  {
    key: "speed",
    label: "速度",
    group: "base",
    aliases: ["speed", "速度"],
  },
  {
    key: "luck",
    label: "幸运",
    group: "base",
    aliases: ["luck", "幸运"],
  },
  {
    key: "spiritualSense",
    label: "神识",
    group: "combat",
    aliases: ["spiritualSense", "spiritual_sense", "神识"],
  },
  {
    key: "armorPenetration",
    label: "破防",
    group: "combat",
    aliases: ["armorPenetration", "armor_penetration", "破防"],
  },
  {
    key: "block",
    label: "格挡",
    group: "combat",
    aliases: ["block", "格挡"],
  },
  {
    key: "skillDamageBonus",
    label: "神通增伤",
    group: "combat",
    aliases: ["skillDamageBonus", "skill_damage_bonus", "神通增伤", "技能增伤"],
  },
  {
    key: "skillDamageReduction",
    label: "神通减伤",
    group: "combat",
    aliases: ["skillDamageReduction", "skill_damage_reduction", "神通减伤", "技能减伤"],
  },
  {
    key: "artifactDamageBonus",
    label: "法宝增伤",
    group: "combat",
    aliases: ["artifactDamageBonus", "artifact_damage_bonus", "法宝增伤"],
  },
  {
    key: "artifactDamageReduction",
    label: "法宝减伤",
    group: "combat",
    aliases: ["artifactDamageReduction", "artifact_damage_reduction", "法宝减伤"],
  },
];

const GONGFA_COMBAT_BONUS_DEFINITION_MAP = new Map(
  GONGFA_COMBAT_BONUS_DEFINITIONS.map((definition) => [definition.key, definition] as const),
);

const GONGFA_COMBAT_BONUS_ALIAS_MAP = new Map<string, GongfaCombatBonusKey>();
for (const definition of GONGFA_COMBAT_BONUS_DEFINITIONS) {
  for (const alias of definition.aliases) {
    const normalizedAlias = alias.trim();
    if (!normalizedAlias) {
      continue;
    }
    GONGFA_COMBAT_BONUS_ALIAS_MAP.set(normalizedAlias, definition.key);
  }
}

export const GONGFA_COMBAT_BONUS_FIELD_GROUPS: GongfaBonusFieldGroup[] = [
  {
    key: "base",
    title: "基础属性",
    fields: GONGFA_COMBAT_BONUS_DEFINITIONS
      .filter((definition) => definition.group === "base")
      .map((definition) => ({
        key: definition.key,
        label: definition.label,
        step: definition.step,
      })),
  },
  {
    key: "combat",
    title: "战斗属性",
    fields: GONGFA_COMBAT_BONUS_DEFINITIONS
      .filter((definition) => definition.group === "combat")
      .map((definition) => ({
        key: definition.key,
        label: definition.label,
        step: definition.step,
      })),
  },
];

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

export function normalizeGongfaCombatBonusKey(key: unknown): GongfaCombatBonusKey | null {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return null;
  }
  return GONGFA_COMBAT_BONUS_ALIAS_MAP.get(normalizedKey) || null;
}

export function canonicalizeGongfaBonusKey(key: unknown): string {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return "";
  }
  return normalizeGongfaCombatBonusKey(normalizedKey) || normalizedKey;
}

export function getGongfaBonusLabel(key: unknown): string {
  const normalizedKey = normalizeGongfaCombatBonusKey(key);
  if (!normalizedKey) {
    return String(key || "").trim();
  }
  return GONGFA_COMBAT_BONUS_DEFINITION_MAP.get(normalizedKey)?.label || normalizedKey;
}

export function normalizeGongfaBonusRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const output: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = canonicalizeGongfaBonusKey(rawKey);
    if (!key) {
      continue;
    }
    const value = toFiniteNumber(rawValue);
    if (!Number.isFinite(value) || Math.abs(value) < 0.00001) {
      continue;
    }
    output[key] = Number((toFiniteNumber(output[key]) + value).toFixed(4));
  }
  return output;
}

export function getGongfaCombatBonusValue(
  totalBonus: Record<string, unknown>,
  key: GongfaCombatBonusKey,
): number {
  const definition = GONGFA_COMBAT_BONUS_DEFINITION_MAP.get(key);
  if (!definition) {
    return 0;
  }
  for (const alias of definition.aliases) {
    if (!Object.prototype.hasOwnProperty.call(totalBonus, alias)) {
      continue;
    }
    return toFiniteNumber(totalBonus[alias]);
  }
  return 0;
}
