"use client";

import { useCallback, useMemo, useState } from "react";
import { Button, Card, Collapse, Image, Input, InputNumber, Select, Space, Switch, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type {
  AdminFieldConfig,
  AdminJsonSchema,
  AdminRelationConfig,
  AdminSelectOption,
  JsonSchemaField,
} from "@/modules/admin/services/admin-ui-config";
import {
  GONGFA_COMBAT_BONUS_FIELD_GROUPS,
  normalizeGongfaBonusRecord,
} from "@/modules/shared/services/gongfa-bonus";
import {
  normalizeFortuneModifierValue,
  normalizeFortuneRateValue,
  serializeFortuneModifierValue,
} from "@/modules/shared/services/fortune-effect";
import { createDefaultPregnancySystemConfig } from "@/modules/character/constants/pregnancy-system";
import { BUILTIN_RANDOM_EVENT_ACTION_DEFINITIONS } from "@/modules/map/services/random-event-action-builtins";
import ReferenceSelect from "@/modules/admin/ui/components/ReferenceSelect";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import type { AttributeDelta, PlayerStatusFlowEffects, PregnancySystemConfig, PregnancySystemConfigStage } from "@/types/game";

const { TextArea } = Input;
const { Text } = Typography;
const EMPTY_SCHEMA_FIELDS: JsonSchemaField[] = [];
const BUILTIN_EVENT_REWARD_ACTION_TYPE_OPTIONS: AdminSelectOption[] = BUILTIN_RANDOM_EVENT_ACTION_DEFINITIONS.map((item) => ({
  label: item.label,
  value: item.type,
}));

interface JsonFieldEditorProps {
  field: AdminFieldConfig;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  realmOptions?: AdminSelectOption[];
  allowNegativeRewardValue?: boolean;
  contextValues?: Record<string, unknown>;
}

type JsonRow = Record<string, unknown> & { __key: string };
type RewardItem = { itemId: string; quantity: number };
type RewardObject = {
  xp?: number;
  gold?: number;
  items: RewardItem[];
  fortuneIds: string[];
};
type EventRewardAction = {
  type: string;
  targetVar: string;
  monsterId: string;
  mapId: string;
};
type EventRewardObject = RewardObject & {
  removeFortuneIds: string[];
  actions: EventRewardAction[];
};
type AttributeDeltaKey =
  | "hp"
  | "maxHp"
  | "mp"
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
type FortuneEventKey = "killPlayer" | "killMonster" | "selfDeath";
type FortuneModifierDraft = {
  flat?: number;
  percent?: number;
};
type FortuneEventEffectsObject = Record<FortuneEventKey, Partial<Record<AttributeDeltaKey, FortuneModifierDraft>>>;
type FortuneSpecialEffectKey =
  | "combatXpRate"
  | "adventureXpRate"
  | "questXpRate"
  | "pillXpRate"
  | "doubleCultivationXpRate"
  | "breakthroughSuccessRate"
  | "dongfuLingqiRate";
type FortuneSpecialEffectsObject = Partial<Record<FortuneSpecialEffectKey, number>>;
type EventJudgeGender = "男" | "女";
type EventJudgeFortuneCondition = {
  fortuneId: string;
  hasFortune: boolean;
};
type EventJudgeConditionsObject = {
  gender?: EventJudgeGender;
  fortuneConditions: EventJudgeFortuneCondition[];
  pluginConditions: Record<string, unknown>;
};
type EventJudgePluginDefinitionField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  multiple?: boolean;
  options?: AdminSelectOption[];
};
type EventJudgePluginDefinition = {
  pluginId: string;
  label: string;
  fields: EventJudgePluginDefinitionField[];
};
const CORE_EVENT_JUDGE_DEFINITIONS: EventJudgePluginDefinition[] = [
  {
    pluginId: "double-cultivation",
    label: "双修/孕育判定",
    fields: [
      {
        key: "minIntimacyScore",
        label: "亲密度至少达到",
        type: "number",
      },
    ],
  },
];
const CORE_EVENT_JUDGE_OPTIONS: AdminSelectOption[] = CORE_EVENT_JUDGE_DEFINITIONS.map((item) => ({
  label: item.label,
  value: item.pluginId,
}));
type SecretMetricId = "eventCount" | "fluidMlTotal" | "intimacyScore";
type SecretStatsRange = {
  min: number;
  max: number;
};
type SecretStatsField = {
  id: SecretMetricId;
  enabled: boolean;
  maleLabel: string;
  femaleLabel: string;
  unit: string;
};
type SecretStatsConfig = {
  fluidMlPerSessionRange: SecretStatsRange;
  intimacyPerSessionRange: SecretStatsRange;
  fields: SecretStatsField[];
};
type PregnancyFlowEffectKey = keyof PlayerStatusFlowEffects;
type PregnancyFortuneBonusKey =
  | "femaleChanceKey"
  | "maleChanceKey"
  | "femaleProgressKey"
  | "femaleRetentionKey"
  | "maleFluidKey";
type GongfaRequirementType = "none" | "intimacyLevel" | "doubleCultivationCount" | "intimacyScore" | "countOrScore";
type GongfaLevelConfig = {
  levelIndex: number;
  layerLabel: string;
  upgradeCost: number;
  requirementType: GongfaRequirementType;
  requirementValue: number;
  requirementText: string;
  bonuses: Record<string, number>;
};
type GongfaBonusFieldConfig = {
  key: string;
  label: string;
  step?: number;
};
type GongfaBonusFieldGroup = {
  key: string;
  title: string;
  fields: GongfaBonusFieldConfig[];
};

interface PrimitiveChangeMeta {
  optionRawLabel?: string;
}

const GONGFA_REQUIREMENT_OPTIONS: AdminSelectOption[] = [
  { label: "无条件", value: "none" },
  { label: "淫乱等级", value: "intimacyLevel" },
  { label: "双修次数", value: "doubleCultivationCount" },
  { label: "淫乱度", value: "intimacyScore" },
  { label: "双修次数或淫乱度", value: "countOrScore" },
];
const GONGFA_BONUS_FIELD_GROUPS: GongfaBonusFieldGroup[] = [
  ...GONGFA_COMBAT_BONUS_FIELD_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    fields: group.fields.map((field) => ({
      key: field.key,
      label: field.label,
      step: field.step,
    })),
  })),
  {
    key: "common",
    title: "通用增幅",
    fields: [
      { key: "\功\法\点\倍\率", label: "功法点倍率%", step: 0.1 },
      { key: "\炼\丹\成\功\率\增\幅", label: "炼丹成功率%", step: 0.1 },
      { key: "\炼\器\成\功\率\增\幅", label: "炼器成功率%", step: 0.1 },
      { key: "\洞\府\灵\气\增\幅", label: "洞府灵气增幅%", step: 0.1 },
    ],
  },
  {
    key: "sex",
    title: "Sex功法效果",
    fields: [
      { key: "\双\修\修\为\提\升\倍\率", label: "双修修为提升%", step: 0.1 },
      { key: "\淫\乱\度\增\幅", label: "淫乱度增幅%", step: 0.1 },
      { key: "\女\修\榨\精\增\幅", label: "女修榨精增幅%", step: 0.1 },
      { key: "\男\性\射\精\量\增\幅", label: "男性射精量增幅%", step: 0.1 },
      { key: "\男\性\精\液\容\量\增\幅", label: "男性精液容量增幅%", step: 0.1 },
      { key: "\男\性\精\液\恢\复\增\幅", label: "男性精液恢复增幅%", step: 0.1 },
      { key: "\子\宫\精\液\转\化\效\率\增\幅", label: "子宫转化效率%", step: 0.1 },
      { key: "\子\宫\消\化\减\秒", label: "子宫消化减秒", step: 1 },
      { key: "\男\性\互\补\吸\收\增\幅", label: "男性互补吸收%", step: 0.1 },
    ],
  },
];

const GONGFA_BONUS_GROUP_LABELS: Record<string, string> = {
  base: "\基\础\属\性",
  combat: "\战\斗\属\性",
  common: "\通\用\增\幅",
  sex: "Sex\功\法\效\果",
};

const GONGFA_BONUS_FIELD_LABELS: Record<string, string> = {
  maxHp: "\气\血",
  maxMp: "\灵\力",
  attack: "\攻\击",
  defense: "\防\御",
  speed: "\遁\速",
  luck: "\幸\运",
  spiritualSense: "\神\识",
  armorPenetration: "\破\防",
  block: "\格\挡",
  skillDamageBonus: "\神\通\增\伤",
  skillDamageReduction: "\神\通\减\伤",
  artifactDamageBonus: "\法\宝\增\伤",
  artifactDamageReduction: "\法\宝\减\伤",
  "\功\法\点\倍\率": "\功\法\点\倍\率%",
  "\炼\丹\成\功\率\增\幅": "\炼\丹\成\功\率%",
  "\炼\器\成\功\率\增\幅": "\炼\器\成\功\率%",
  "\洞\府\灵\气\增\幅": "\洞\府\灵\气\增\幅%",
  "\双\修\修\为\提\升\倍\率": "\双\修\修\为\提\升%",
  "\淫\乱\度\增\幅": "\淫\乱\度\增\幅",
  "\女\修\榨\精\增\幅": "\女\修\榨\精\增\幅%",
  "\男\性\射\精\量\增\幅": "\男\性\射\精\量\增\幅%",
  "\男\性\精\液\容\量\增\幅": "\男\性\精\液\容\量\增\幅%",
  "\男\性\精\液\恢\复\增\幅": "\男\性\精\液\恢\复\增\幅%",
  "\子\宫\精\液\转\化\效\率\增\幅": "\子\宫\精\液\转\化\效\率%",
  "\子\宫\消\化\减\秒": "\子\宫\消\化\减\秒",
  "\男\性\互\补\吸\收\增\幅": "\男\性\互\补\吸\收%",
};

for (const group of GONGFA_BONUS_FIELD_GROUPS) {
  const groupTitle = GONGFA_BONUS_GROUP_LABELS[group.key];
  if (groupTitle) {
    group.title = groupTitle;
  }
  for (const field of group.fields) {
    const label = GONGFA_BONUS_FIELD_LABELS[field.key];
    if (label) {
      field.label = label;
    }
  }
}

const REWARD_ITEM_FIELDS: JsonSchemaField[] = [
  { key: "itemId", label: "物品", type: "string", required: true, relation: { entity: "items", labelKey: "name" } },
  { key: "quantity", label: "数量", type: "number", required: true },
];
function buildEventRewardActionFields(actionTypeOptions: AdminSelectOption[]): JsonSchemaField[] {
  return [
    { key: "type", label: "动作类型", type: "string", required: true, options: actionTypeOptions, columnWidth: 220 },
    { key: "targetVar", label: "目标变量(可选)", type: "string", columnWidth: 280 },
    {
      key: "monsterId",
      label: "怪物",
      type: "string",
      columnWidth: 260,
      visibleWhenRelationMatched: true,
      relationByField: {
        key: "type",
        mapping: {
          battle: { entity: "monsters", labelKey: "name" },
        },
      },
    },
    {
      key: "mapId",
      label: "地图",
      type: "string",
      columnWidth: 260,
      visibleWhenRelationMatched: true,
      relationByField: {
        key: "type",
        mapping: {
          teleport: { entity: "maps", labelKey: "name" },
        },
      },
    },
  ];
}

const ATTRIBUTE_DELTA_KEYS: AttributeDeltaKey[] = [
  "hp",
  "maxHp",
  "mp",
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
];
const ATTRIBUTE_DELTA_LABELS: Record<AttributeDeltaKey, string> = {
  hp: "当前气血(hp)",
  maxHp: "最大气血(maxHp)",
  mp: "当前灵力(mp)",
  maxMp: "最大灵力(maxMp)",
  attack: "攻击(attack)",
  defense: "防御(defense)",
  speed: "遁速(speed)",
  luck: "幸运(luck)",
  spiritualSense: "神识(spiritualSense)",
  armorPenetration: "破防(armorPenetration)",
  block: "格挡(block)",
  skillDamageBonus: "神通增伤(skillDamageBonus)",
  skillDamageReduction: "神通减伤(skillDamageReduction)",
  artifactDamageBonus: "法宝增伤(artifactDamageBonus)",
  artifactDamageReduction: "法宝减伤(artifactDamageReduction)",
};
const FORTUNE_EVENT_KEYS: FortuneEventKey[] = ["killPlayer", "killMonster", "selfDeath"];
const FORTUNE_EVENT_LABELS: Record<FortuneEventKey, string> = {
  killPlayer: "击杀玩家",
  killMonster: "击杀怪物",
  selfDeath: "自身死亡",
};
const FORTUNE_SPECIAL_EFFECT_FIELDS: Array<{
  key: FortuneSpecialEffectKey;
  label: string;
}> = [
  { key: "combatXpRate", label: "战斗修为倍率" },
  { key: "adventureXpRate", label: "奇遇修为倍率" },
  { key: "questXpRate", label: "任务修为倍率" },
  { key: "pillXpRate", label: "丹药修为倍率" },
  { key: "doubleCultivationXpRate", label: "双修修为倍率" },
  { key: "breakthroughSuccessRate", label: "突破成功率" },
  { key: "dongfuLingqiRate", label: "洞府灵气倍率" },
];
const PREGNANCY_FLOW_EFFECT_FIELDS: Array<{
  key: PregnancyFlowEffectKey;
  label: string;
  step?: number;
}> = [
  { key: "dongfuLingqiRate", label: "洞府灵气倍率", step: 0.01 },
  { key: "breakthroughSuccessRate", label: "突破成功率倍率", step: 0.01 },
  { key: "doubleCultivationXpRate", label: "双修修为倍率", step: 0.01 },
];
const PREGNANCY_FORTUNE_BONUS_FIELDS: Array<{
  key: PregnancyFortuneBonusKey;
  label: string;
}> = [
  { key: "femaleChanceKey", label: "女方受孕气运键" },
  { key: "maleChanceKey", label: "男方受孕气运键" },
  { key: "femaleProgressKey", label: "女方孕育进度气运键" },
  { key: "femaleRetentionKey", label: "女方留存效率气运键" },
  { key: "maleFluidKey", label: "男方液量气运键" },
];
const EVENT_JUDGE_GENDER_OPTIONS: AdminSelectOption[] = [
  { label: "不限", value: "" },
  { label: "男", value: "男" },
  { label: "女", value: "女" },
];
const SECRET_METRIC_OPTIONS: AdminSelectOption[] = [
  { label: "事件次数", value: "eventCount" },
  { label: "累计灵液量", value: "fluidMlTotal" },
  { label: "亲密度", value: "intimacyScore" },
];
const SECRET_METRIC_DEFAULTS: Record<SecretMetricId, {
  maleLabel: string;
  femaleLabel: string;
  unit: string;
}> = {
  eventCount: {
    maleLabel: "事件次数",
    femaleLabel: "事件次数",
    unit: "次",
  },
  fluidMlTotal: {
    maleLabel: "累计灵液量",
    femaleLabel: "累计灵液量",
    unit: "ml",
  },
  intimacyScore: {
    maleLabel: "亲密度",
    femaleLabel: "亲密度",
    unit: "",
  },
};
const DEFAULT_SECRET_STATS_FLUID_RANGE: SecretStatsRange = { min: 8, max: 12 };
const DEFAULT_SECRET_STATS_INTIMACY_RANGE: SecretStatsRange = { min: 1, max: 3 };

function safeParse(raw?: string) {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toRawText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function ensureArrayObject(parsed: unknown): JsonRow[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>;
      const rawKey = record.__key;
      const stableKey = typeof rawKey === "string" && rawKey.trim() ? rawKey : `row-${index}`;
      return { ...record, __key: stableKey };
    });
}

function stripRowKey(row: JsonRow): Record<string, unknown> {
  const { __key, ...next } = row;
  void __key;
  return next;
}

function ensureArrayString(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((item) => String(item));
}

function ensureObject(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function toOptionalInt(value: unknown, allowNegative = false): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || (!allowNegative && n < 0)) {
    return undefined;
  }
  return Math.floor(n);
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return n;
}

function normalizeSecretMetricId(value: unknown): SecretMetricId | null {
  if (value === "eventCount" || value === "fluidMlTotal" || value === "intimacyScore") {
    return value;
  }
  return null;
}

function createDefaultSecretStatsField(id: SecretMetricId): SecretStatsField {
  const defaults = SECRET_METRIC_DEFAULTS[id];
  return {
    id,
    enabled: true,
    maleLabel: defaults.maleLabel,
    femaleLabel: defaults.femaleLabel,
    unit: defaults.unit,
  };
}

function createDefaultSecretStatsConfig(): SecretStatsConfig {
  return {
    fluidMlPerSessionRange: { ...DEFAULT_SECRET_STATS_FLUID_RANGE },
    intimacyPerSessionRange: { ...DEFAULT_SECRET_STATS_INTIMACY_RANGE },
    fields: [
      createDefaultSecretStatsField("eventCount"),
      createDefaultSecretStatsField("fluidMlTotal"),
      createDefaultSecretStatsField("intimacyScore"),
    ],
  };
}

function normalizeSecretStatsRange(value: unknown, fallback: SecretStatsRange) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  const typed = value as Record<string, unknown>;
  const minRaw = Number(typed.min);
  const maxRaw = Number(typed.max);
  const min = Number.isFinite(minRaw) ? Math.max(1, Math.floor(minRaw)) : fallback.min;
  const max = Number.isFinite(maxRaw) ? Math.max(1, Math.floor(maxRaw)) : fallback.max;
  return min <= max ? { min, max } : { min: max, max: min };
}

function ensureDoubleCultivationSecretStats(parsed: unknown): SecretStatsConfig {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return createDefaultSecretStatsConfig();
  }

  const typed = parsed as Record<string, unknown>;
  const fluidMlPerSessionRange = normalizeSecretStatsRange(
    typed.fluidMlPerSessionRange,
    DEFAULT_SECRET_STATS_FLUID_RANGE,
  );
  const intimacyPerSessionRange = normalizeSecretStatsRange(
    typed.intimacyPerSessionRange,
    DEFAULT_SECRET_STATS_INTIMACY_RANGE,
  );

  const fields = (Array.isArray(typed.fields) ? typed.fields : [])
    .map((item): SecretStatsField | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const id = normalizeSecretMetricId(row.id);
      if (!id) {
        return null;
      }
      const defaults = SECRET_METRIC_DEFAULTS[id];
      const maleLabel = String(row.maleLabel || "").trim() || defaults.maleLabel;
      const femaleLabel = String(row.femaleLabel || "").trim() || defaults.femaleLabel;
      const unit = String(row.unit || "").trim();
      return {
        id,
        enabled: row.enabled !== false,
        maleLabel,
        femaleLabel,
        unit: unit || defaults.unit,
      };
    })
    .filter((item): item is SecretStatsField => !!item);

  return {
    fluidMlPerSessionRange,
    intimacyPerSessionRange,
    fields: fields.length > 0 ? fields : createDefaultSecretStatsConfig().fields,
  };
}

function toDoubleCultivationSecretStatsRawText(value: SecretStatsConfig) {
  return toRawText({
    fluidMlPerSessionRange: normalizeSecretStatsRange(value.fluidMlPerSessionRange, DEFAULT_SECRET_STATS_FLUID_RANGE),
    intimacyPerSessionRange: normalizeSecretStatsRange(value.intimacyPerSessionRange, DEFAULT_SECRET_STATS_INTIMACY_RANGE),
    fields: value.fields.map((field) => ({
      id: field.id,
      enabled: field.enabled !== false,
      maleLabel: String(field.maleLabel || "").trim(),
      femaleLabel: String(field.femaleLabel || "").trim(),
      unit: String(field.unit || "").trim(),
    })),
  });
}

function normalizeGongfaRequirementType(value: unknown): GongfaRequirementType {
  if (
    value === "intimacyLevel"
    || value === "doubleCultivationCount"
    || value === "intimacyScore"
    || value === "countOrScore"
  ) {
    return value;
  }
  return "none";
}

function normalizeGongfaBonuses(value: unknown) {
  const normalizedInput = normalizeGongfaBonusRecord(value);
  const output: Record<string, number> = {};
  for (const group of GONGFA_BONUS_FIELD_GROUPS) {
    for (const field of group.fields) {
      const parsed = toOptionalNumber(normalizedInput[field.key]);
      if (parsed !== undefined && parsed !== 0) {
        output[field.key] = parsed;
      }
    }
  }
  return output;
}

function createDefaultGongfaLevelConfig(index: number): GongfaLevelConfig {
  return {
    levelIndex: index + 1,
    layerLabel: `第${index + 1}层`,
    upgradeCost: 0,
    requirementType: "none",
    requirementValue: 0,
    requirementText: "",
    bonuses: {},
  };
}

function ensureGongfaLevelConfig(parsed: unknown): GongfaLevelConfig[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      return {
        levelIndex: Math.max(1, toOptionalInt(row.levelIndex) ?? index + 1),
        layerLabel: String(row.layerLabel || `第${index + 1}层`).trim() || `第${index + 1}层`,
        upgradeCost: Math.max(0, toOptionalInt(row.upgradeCost) ?? 0),
        requirementType: normalizeGongfaRequirementType(row.requirementType),
        requirementValue: Math.max(0, toOptionalInt(row.requirementValue) ?? 0),
        requirementText: String(row.requirementText || "").trim(),
        bonuses: normalizeGongfaBonuses(row.bonuses),
      };
    })
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .map((item, index) => ({
      ...item,
      levelIndex: index + 1,
      layerLabel: item.layerLabel || `第${index + 1}层`,
    }));
}

function toGongfaLevelConfigRawText(levels: GongfaLevelConfig[]) {
  return toRawText(levels.map((level, index) => ({
    levelIndex: index + 1,
    layerLabel: String(level.layerLabel || `第${index + 1}层`).trim() || `第${index + 1}层`,
    upgradeCost: Math.max(0, toOptionalInt(level.upgradeCost) ?? 0),
    requirementType: normalizeGongfaRequirementType(level.requirementType),
    requirementValue: Math.max(0, toOptionalInt(level.requirementValue) ?? 0),
    requirementText: String(level.requirementText || "").trim(),
    bonuses: normalizeGongfaBonuses(level.bonuses),
  })));
}

function normalizeRewardItems(input: unknown): RewardItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        itemId: typeof row.itemId === "string" ? row.itemId : "",
        quantity: toOptionalInt(row.quantity) ?? 1,
      };
    });
}

function normalizeStringIdList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((item) => String(item || "").trim());
}

function ensureRewardObject(parsed: unknown, allowNegativeRewardValue = false): RewardObject {
  const value = ensureObject(parsed);
  return {
    xp: toOptionalInt(value.xp, allowNegativeRewardValue),
    gold: toOptionalInt(value.gold, allowNegativeRewardValue),
    items: normalizeRewardItems(value.items),
    fortuneIds: normalizeStringIdList(value.fortuneIds),
  };
}

function normalizeEventRewardActions(input: unknown): EventRewardAction[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item): EventRewardAction | null => {
      const row = item as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type.trim() : "";
      if (!type) {
        return null;
      }
      return {
        type,
        targetVar: typeof row.targetVar === "string" ? row.targetVar.trim() : "",
        monsterId: typeof row.monsterId === "string" ? row.monsterId.trim() : "",
        mapId: typeof row.mapId === "string" ? row.mapId.trim() : "",
      };
    })
    .filter((item): item is EventRewardAction => !!item);
}

function ensureEventRewardObject(parsed: unknown, allowNegativeRewardValue = false): EventRewardObject {
  const base = ensureRewardObject(parsed, allowNegativeRewardValue);
  const value = ensureObject(parsed);
  return {
    ...base,
    removeFortuneIds: normalizeStringIdList(value.removeFortuneIds),
    actions: normalizeEventRewardActions(value.actions),
  };
}

function toRewardRawText(value: RewardObject) {
  const output: Record<string, unknown> = {};
  if (value.xp !== undefined) {
    output.xp = value.xp;
  }
  if (value.gold !== undefined) {
    output.gold = value.gold;
  }
  if (value.items.length > 0) {
    output.items = value.items.map((item) => ({
      itemId: item.itemId,
      quantity: toOptionalInt(item.quantity) ?? 1,
    }));
  }
  if (value.fortuneIds.length > 0) {
    output.fortuneIds = value.fortuneIds;
  }
  return toRawText(output);
}

function toEventRewardRawText(value: EventRewardObject) {
  const output: Record<string, unknown> = {};
  if (value.xp !== undefined) {
    output.xp = value.xp;
  }
  if (value.gold !== undefined) {
    output.gold = value.gold;
  }
  if (value.items.length > 0) {
    output.items = value.items.map((item) => ({
      itemId: item.itemId,
      quantity: toOptionalInt(item.quantity) ?? 1,
    }));
  }
  if (value.fortuneIds.length > 0) {
    output.fortuneIds = value.fortuneIds;
  }
  if (value.removeFortuneIds.length > 0) {
    output.removeFortuneIds = value.removeFortuneIds;
  }
  if (value.actions.length > 0) {
    output.actions = value.actions.map((action) => {
      const row: Record<string, string> = {
        type: action.type,
      };
      if (action.targetVar.trim()) {
        row.targetVar = action.targetVar;
      }
      if (action.monsterId.trim()) {
        row.monsterId = action.monsterId;
      }
      if (action.mapId.trim()) {
        row.mapId = action.mapId;
      }
      return row;
    });
  }
  return toRawText(output);
}

function normalizeAttributeDelta(input: unknown): Partial<Record<AttributeDeltaKey, FortuneModifierDraft>> {
  const value = ensureObject(input);
  const output: Partial<Record<AttributeDeltaKey, FortuneModifierDraft>> = {};
  ATTRIBUTE_DELTA_KEYS.forEach((key) => {
    const normalized = normalizeFortuneModifierValue(value[key] as never);
    if (
      normalized.flat !== 0
      || normalized.percent !== 0
      || Object.prototype.hasOwnProperty.call(value, key)
    ) {
      output[key] = {
        flat: normalized.flat,
        percent: normalized.percent,
      };
    }
  });
  return output;
}

function ensureFortuneEventEffects(parsed: unknown): FortuneEventEffectsObject {
  const value = ensureObject(parsed);
  return {
    killPlayer: normalizeAttributeDelta(value.killPlayer),
    killMonster: normalizeAttributeDelta(value.killMonster),
    selfDeath: normalizeAttributeDelta(value.selfDeath),
  };
}

function toOptionalSignedInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return Math.trunc(n);
}

function normalizePregnancyAttrEffects(value: unknown): AttributeDelta {
  const typed = ensureObject(value);
  const output: AttributeDelta = {};
  for (const key of ATTRIBUTE_DELTA_KEYS) {
    const normalized = toOptionalSignedInt(typed[key]);
    if (normalized !== undefined && normalized !== 0) {
      output[key] = normalized;
    }
  }
  return output;
}

function normalizePregnancyFlowEffects(value: unknown): PlayerStatusFlowEffects {
  const typed = ensureObject(value);
  const output: PlayerStatusFlowEffects = {};
  for (const field of PREGNANCY_FLOW_EFFECT_FIELDS) {
    const normalized = toOptionalNumber(typed[field.key]);
    if (normalized !== undefined && normalized !== 0) {
      output[field.key] = Number(normalized.toFixed(4));
    }
  }
  return output;
}

function normalizePregnancyStage(
  value: unknown,
  fallback: PregnancySystemConfigStage,
  index: number,
): PregnancySystemConfigStage {
  const typed = ensureObject(value);
  const durationHours = toOptionalNumber(typed.durationHours);
  return {
    key: String(typed.key ?? "").trim() || fallback.key || `stage_${index + 1}`,
    title: String(typed.title ?? "").trim() || fallback.title || `阶段${index + 1}`,
    durationHours: durationHours !== undefined ? Math.max(0, Number(durationHours.toFixed(2))) : fallback.durationHours,
    iconImageUrl: String(typed.iconImageUrl ?? "").trim() || fallback.iconImageUrl || "",
    attrEffects: normalizePregnancyAttrEffects(typed.attrEffects ?? fallback.attrEffects),
    flowEffects: normalizePregnancyFlowEffects(typed.flowEffects ?? fallback.flowEffects),
  };
}

function createDefaultPregnancyStage(index: number): PregnancySystemConfigStage {
  const fallbackStages = createDefaultPregnancySystemConfig().stages;
  const fallback = fallbackStages[Math.min(index, fallbackStages.length - 1)] || fallbackStages[0];
  return {
    key: `pregnancy_stage_${index + 1}`,
    title: `孕育阶段${index + 1}`,
    durationHours: fallback?.durationHours || 8,
    iconImageUrl: fallback?.iconImageUrl || "",
    attrEffects: {},
    flowEffects: {},
  };
}

function ensurePregnancySystemConfig(parsed: unknown): PregnancySystemConfig {
  const fallback = createDefaultPregnancySystemConfig();
  const typed = ensureObject(parsed);
  const stagesRaw = Array.isArray(typed.stages) ? typed.stages : [];
  const normalizedStages = stagesRaw
    .map((stage, index) => normalizePregnancyStage(stage, fallback.stages[Math.min(index, fallback.stages.length - 1)] || createDefaultPregnancyStage(index), index))
    .filter((stage) => stage.key.trim() && stage.title.trim());
  const settlementRaw = ensureObject(typed.settlement);
  const baseChanceRate = toOptionalNumber(typed.baseChanceRate);
  const chanceCapRate = toOptionalNumber(typed.chanceCapRate);
  const highAbsorbMlThreshold = toOptionalNumber(typed.highAbsorbMlThreshold);
  const highAbsorbBonusRate = toOptionalNumber(typed.highAbsorbBonusRate);
  const lowFluidStageRatio = toOptionalNumber(typed.lowFluidStageRatio);
  const highFluidStageRatio = toOptionalNumber(typed.highFluidStageRatio);
  const settlementRewardXpRatio = toOptionalNumber(settlementRaw.rewardXpRatio);
  const settlementRewardXpMin = toOptionalSignedInt(settlementRaw.rewardXpMin);
  const settlementRewardXpMax = toOptionalSignedInt(settlementRaw.rewardXpMax);
  const fortuneBonusKeysRaw = ensureObject(typed.fortuneBonusKeys);

  return {
    enabled: typeof typed.enabled === "boolean" ? typed.enabled : fallback.enabled,
    statusKey: String(typed.statusKey ?? "").trim() || fallback.statusKey,
    statusTitle: String(typed.statusTitle ?? "").trim() || fallback.statusTitle,
    sourcePluginId: String(typed.sourcePluginId ?? "").trim() || fallback.sourcePluginId,
    baseChanceRate: baseChanceRate !== undefined ? Number(baseChanceRate.toFixed(4)) : fallback.baseChanceRate,
    chanceCapRate: chanceCapRate !== undefined ? Number(chanceCapRate.toFixed(4)) : fallback.chanceCapRate,
    highAbsorbMlThreshold: highAbsorbMlThreshold !== undefined ? Math.max(0, Number(highAbsorbMlThreshold.toFixed(2))) : fallback.highAbsorbMlThreshold,
    highAbsorbBonusRate: highAbsorbBonusRate !== undefined ? Number(highAbsorbBonusRate.toFixed(4)) : fallback.highAbsorbBonusRate,
    lowFluidStageRatio: lowFluidStageRatio !== undefined ? Number(lowFluidStageRatio.toFixed(4)) : fallback.lowFluidStageRatio,
    highFluidStageRatio: highFluidStageRatio !== undefined ? Number(highFluidStageRatio.toFixed(4)) : fallback.highFluidStageRatio,
    exclusiveEventStageKey: String(typed.exclusiveEventStageKey ?? "").trim() || fallback.exclusiveEventStageKey,
    fortuneBonusKeys: {
      femaleChanceKey: String(fortuneBonusKeysRaw.femaleChanceKey ?? "").trim() || fallback.fortuneBonusKeys.femaleChanceKey,
      maleChanceKey: String(fortuneBonusKeysRaw.maleChanceKey ?? "").trim() || fallback.fortuneBonusKeys.maleChanceKey,
      femaleProgressKey: String(fortuneBonusKeysRaw.femaleProgressKey ?? "").trim() || fallback.fortuneBonusKeys.femaleProgressKey,
      femaleRetentionKey: String(fortuneBonusKeysRaw.femaleRetentionKey ?? "").trim() || fallback.fortuneBonusKeys.femaleRetentionKey,
      maleFluidKey: String(fortuneBonusKeysRaw.maleFluidKey ?? "").trim() || fallback.fortuneBonusKeys.maleFluidKey,
    },
    stages: normalizedStages.length > 0 ? normalizedStages : fallback.stages.map((stage, index) => normalizePregnancyStage(stage, stage, index)),
    settlement: {
      title: String(settlementRaw.title ?? "").trim() || fallback.settlement.title,
      rewardXpRatio: settlementRewardXpRatio !== undefined ? Number(settlementRewardXpRatio.toFixed(4)) : fallback.settlement.rewardXpRatio,
      rewardXpMin: settlementRewardXpMin !== undefined ? settlementRewardXpMin : fallback.settlement.rewardXpMin,
      rewardXpMax: settlementRewardXpMax !== undefined ? settlementRewardXpMax : fallback.settlement.rewardXpMax,
    },
  };
}

function serializeFortuneEventModifierDraft(
  delta: Partial<Record<AttributeDeltaKey, FortuneModifierDraft>>,
  attrKey: AttributeDeltaKey,
) {
  if (!hasOwnDefinedKey(delta as Record<string, unknown>, attrKey)) {
    return undefined;
  }

  const draft = delta[attrKey] || {};
  const serialized = serializeFortuneModifierValue(draft);
  if (serialized !== undefined) {
    return serialized;
  }

  return {
    flat: 0,
    percent: 0,
  };
}

function toFortuneEventEffectsRawText(value: FortuneEventEffectsObject) {
  const output: Record<string, Record<string, number | Record<string, number>>> = {};

  FORTUNE_EVENT_KEYS.forEach((eventKey) => {
    const delta = value[eventKey] || {};
    const serializedDelta: Record<string, number | Record<string, number>> = {};

    ATTRIBUTE_DELTA_KEYS.forEach((attrKey) => {
      const next = serializeFortuneEventModifierDraft(delta, attrKey);
      if (next !== undefined) {
        serializedDelta[attrKey] = next;
      }
    });

    if (Object.keys(serializedDelta).length > 0) {
      output[eventKey] = serializedDelta;
    }
  });

  return toRawText(output);
}

function normalizeEventJudgeGender(input: unknown): EventJudgeGender | undefined {
  if (input === "男" || input === "女") {
    return input;
  }
  return undefined;
}

function ensureEventJudgeConditions(parsed: unknown): EventJudgeConditionsObject {
  const value = ensureObject(parsed);
  const fortuneConditionsRaw = Array.isArray(value.fortuneConditions) ? value.fortuneConditions : [];
  const fortuneConditions: EventJudgeFortuneCondition[] = fortuneConditionsRaw
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const row = item as Record<string, unknown>;
      const fortuneId = typeof row.fortuneId === "string" ? row.fortuneId.trim() : "";
      return {
        fortuneId,
        hasFortune: row.hasFortune !== false,
      };
    });

  const pluginConditionsRaw = value.pluginConditions;
  const pluginConditions = !pluginConditionsRaw || typeof pluginConditionsRaw !== "object" || Array.isArray(pluginConditionsRaw)
    ? {}
    : Object.fromEntries(
      Object.entries(pluginConditionsRaw as Record<string, unknown>)
        .map(([pluginId, condition]) => [String(pluginId || "").trim(), condition] as const)
        .filter(([pluginId]) => pluginId.length > 0),
    );

  return {
    gender: normalizeEventJudgeGender(value.gender),
    fortuneConditions,
    pluginConditions,
  };
}

function toEventJudgeConditionsRawText(value: EventJudgeConditionsObject) {
  const output: Record<string, unknown> = {};
  if (value.gender === "男" || value.gender === "女") {
    output.gender = value.gender;
  }
  output.fortuneConditions = value.fortuneConditions.map((row) => ({
    fortuneId: row.fortuneId,
    hasFortune: row.hasFortune !== false,
  }));
  if (Object.keys(value.pluginConditions).length > 0) {
    output.pluginConditions = value.pluginConditions;
  }
  return toRawText(output);
}

function createDefaultEventJudgePluginCondition(definition: EventJudgePluginDefinition) {
  const output: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (field.multiple) {
      output[field.key] = [];
      continue;
    }
    if (field.type === "number") {
      output[field.key] = 0;
      continue;
    }
    if (field.type === "boolean") {
      output[field.key] = false;
      continue;
    }
    if (field.options && field.options.length > 0) {
      output[field.key] = field.options[0].value;
      continue;
    }
    output[field.key] = "";
  }
  return output;
}

function shouldUseMultipleSelect(field: Pick<JsonSchemaField, "multiple" | "key" | "label">) {
  return field.multiple === true
    || /maptypes?/i.test(field.key)
    || /识别.*地图类型|地图类型/u.test(field.label);
}

function toFieldValue(field: JsonSchemaField, value: unknown) {
  if (shouldUseMultipleSelect(field)) {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
    return [];
  }
  if (field.type === "number") {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (field.type === "boolean") {
    return Boolean(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function resolveRelationConfig(field: JsonSchemaField, row?: Record<string, unknown>): AdminRelationConfig | undefined {
  if (row && field.relationByField) {
    const refType = row[field.relationByField.key];
    if (typeof refType === "string") {
      const mapped = field.relationByField.mapping[refType];
      if (mapped) {
        return mapped;
      }
    }
  }
  return field.relation;
}

function hasMatchedRelation(field: JsonSchemaField, row?: Record<string, unknown>) {
  if (!row) {
    return false;
  }
  if (field.visibleByField) {
    const refValue = row[field.visibleByField.key];
    if (typeof refValue !== "string") {
      return false;
    }
    return field.visibleByField.values.includes(refValue);
  }
  if (!field.relationByField) {
    return false;
  }
  const refType = row[field.relationByField.key];
  if (typeof refType !== "string") {
    return false;
  }
  return Boolean(field.relationByField.mapping[refType]);
}

function shouldDisplayFieldColumn(field: JsonSchemaField, rows: JsonRow[]) {
  if (!field.visibleWhenRelationMatched) {
    return true;
  }
  return rows.some((row) => hasMatchedRelation(field, row));
}

function stripInactiveRelationFields(row: JsonRow, fields: JsonSchemaField[]) {
  const next = { ...row };
  fields.forEach((field) => {
    if (!field.visibleWhenRelationMatched) {
      return;
    }
    if (hasMatchedRelation(field, next)) {
      return;
    }
    delete next[field.key];
  });
  return next;
}

function renderPrimitiveEditor(
  field: JsonSchemaField,
  value: unknown,
  onChange: (next: unknown, meta?: PrimitiveChangeMeta) => void,
  disabled?: boolean,
  row?: Record<string, unknown>,
) {
  if (field.options && field.options.length > 0) {
    const multiple = shouldUseMultipleSelect(field);
    const optionValue = multiple
      ? (Array.isArray(value) ? value.map((item) => String(item)) : [])
      : field.type === "number"
      ? (typeof value === "number" || typeof value === "string" ? String(value) : undefined)
      : (typeof value === "string" ? value : undefined);
    return (
      <Select
        mode={multiple ? "multiple" : undefined}
        showSearch
        optionFilterProp="label"
        disabled={disabled}
        options={field.options}
        allowClear={!field.required}
        value={optionValue}
        onChange={(next) => onChange(next)}
      />
    );
  }

  const relation = resolveRelationConfig(field, row);
  if (relation) {
    return (
      <ReferenceSelect
        entity={relation.entity}
        labelKey={relation.labelKey}
        value={typeof value === "string" ? value : undefined}
        onChange={() => undefined}
        onSelectOption={(nextValue, option) => onChange(nextValue, { optionRawLabel: option?.rawLabel })}
        disabled={disabled}
        allowClear={!field.required}
      />
    );
  }

  if (field.type === "number") {
    return (
      <InputNumber
        style={{ width: "100%" }}
        disabled={disabled}
        value={typeof value === "number" ? value : undefined}
        onChange={(next) => onChange(next)}
      />
    );
  }

  if (field.type === "boolean") {
    return (
      <Switch
        disabled={disabled}
        checked={Boolean(value)}
        onChange={(next) => onChange(next)}
      />
    );
  }

  return (
    <Input
      disabled={disabled}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function buildArrayObjectColumns(
  fields: JsonSchemaField[],
  onPatch: (rowKey: string, fieldKey: string, value: unknown, meta?: PrimitiveChangeMeta) => void,
  onRemove: (rowKey: string) => void,
  disabled?: boolean,
  rows: JsonRow[] = [],
  context?: {
    parentFieldKey?: string;
    realmOptions?: AdminSelectOption[];
  },
): ColumnsType<JsonRow> {
  const dynamicColumns: ColumnsType<JsonRow> = fields
    .filter((field) => shouldDisplayFieldColumn(field, rows))
    .map((field) => ({
      title: field.label,
      key: field.key,
      width: field.columnWidth,
      render: (_, row) => {
        if (field.visibleWhenRelationMatched && !hasMatchedRelation(field, row)) {
          return null;
        }

        if (context?.parentFieldKey === "requirements" && field.key === "quantity") {
          const reqType = typeof row.type === "string" ? row.type : "";
          if (reqType === "talk") {
            return null;
          }
          if (reqType === "realm") {
            if (context.realmOptions?.length) {
              return (
                <Select
                  showSearch
                  optionFilterProp="label"
                  disabled={disabled}
                  options={context.realmOptions}
                  value={typeof row.quantity === "number" || typeof row.quantity === "string" ? String(row.quantity) : undefined}
                  onChange={(next) => onPatch(row.__key, field.key, next)}
                />
              );
            }
            return (
              <InputNumber
                style={{ width: "100%" }}
                disabled={disabled}
                value={typeof row.quantity === "number" ? row.quantity : undefined}
                onChange={(next) => onPatch(row.__key, field.key, next)}
              />
            );
          }
        }

        const value = row[field.key];
        return renderPrimitiveEditor(field, value, (next, meta) => onPatch(row.__key, field.key, next, meta), disabled, row);
      },
    }));

  return [
    ...dynamicColumns,
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_, row) => (
        <Button
          size="small"
          danger
          disabled={disabled}
          onClick={() => onRemove(row.__key)}
        >
          删除
        </Button>
      ),
    },
  ];
}

function JsonRawEditor({
  raw,
  onRawChange,
  disabled,
  placeholder,
}: {
  raw: string;
  onRawChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <TextArea
      rows={8}
      disabled={disabled}
      value={raw}
      placeholder={placeholder || "请输入合法 JSON"}
      onChange={(e) => onRawChange(e.target.value)}
    />
  );
}

function ArrayStringEditor({
  schema,
  values,
  onChange,
  disabled,
}: {
  schema: AdminJsonSchema;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {values.map((item, index) => (
        <Space key={`row-${index}`} style={{ width: "100%" }}>
          {schema.relation ? (
            <ReferenceSelect
              entity={schema.relation.entity}
              labelKey={schema.relation.labelKey}
              value={item}
              onChange={(next) => {
                const copied = [...values];
                copied[index] = next || "";
                onChange(copied.filter((v) => v));
              }}
              disabled={disabled}
            />
          ) : schema.options && schema.options.length > 0 ? (
            <Select
              disabled={disabled}
              value={item || undefined}
              options={schema.options}
              allowClear
              style={{ minWidth: 220 }}
              onChange={(next) => {
                const copied = [...values];
                copied[index] = typeof next === "string" ? next : "";
                onChange(copied.filter((value) => value));
              }}
            />
          ) : (
            <Input
              disabled={disabled}
              value={item}
              onChange={(e) => {
                const copied = [...values];
                copied[index] = e.target.value;
                onChange(copied);
              }}
            />
          )}
          <Button
            danger
            disabled={disabled}
            onClick={() => {
              const copied = values.filter((_, i) => i !== index);
              onChange(copied);
            }}
          >
            删除
          </Button>
        </Space>
      ))}
      <Button
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
      >
        新增
      </Button>
    </Space>
  );
}

function hasOwnDefinedKey(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
}

function getDefaultValueForField(field: JsonSchemaField): unknown {
  if (shouldUseMultipleSelect(field)) {
    return [];
  }
  if (field.type === "number") {
    return 0;
  }
  if (field.type === "boolean") {
    return false;
  }
  return "";
}

function buildFieldPreview(field: JsonSchemaField, rawValue: unknown) {
  const value = toFieldValue(field, rawValue);
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return "";
  }
  if (field.type === "boolean") {
    return value ? "已启用" : "未启用";
  }
  if (field.options && field.options.length > 0) {
    const options = field.options || [];
    if (Array.isArray(value)) {
      return value
        .map((item) => options.find((option) => option.value === String(item))?.label || String(item))
        .join("、");
    }
    const matched = options.find((item) => item.value === String(value));
    return matched?.label || String(value);
  }
  if (Array.isArray(value)) {
    return value.join("、");
  }
  return String(value);
}

function ObjectEditor({
  schema,
  value,
  onChange,
  disabled,
}: {
  schema: AdminJsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const fields = schema.fields ?? EMPTY_SCHEMA_FIELDS;
  const [newFieldKey, setNewFieldKey] = useState("");
  const presentFields = useMemo(
    () => fields.filter((currentField) => hasOwnDefinedKey(value, currentField.key)),
    [fields, value],
  );
  const absentFields = useMemo(
    () => fields.filter((currentField) => !hasOwnDefinedKey(value, currentField.key)),
    [fields, value],
  );
  const effectiveNewFieldKey = absentFields.some((currentField) => currentField.key === newFieldKey)
    ? newFieldKey
    : absentFields[0]?.key || "";

  const collapseItems = presentFields.map((currentField) => {
    const preview = buildFieldPreview(currentField, value[currentField.key]);
    return {
      key: currentField.key,
      label: preview ? `${currentField.label}：${preview}` : currentField.label,
      children: (
        <Space orientation="vertical" style={{ width: "100%" }}>
          {renderPrimitiveEditor(
            currentField,
            toFieldValue(currentField, value[currentField.key]),
            (next) => {
              const normalized = toFieldValue(currentField, next);
              const nextValue = { ...value };
              const shouldDelete = Array.isArray(normalized)
                ? normalized.length === 0
                : normalized === undefined || normalized === null || normalized === "";
              if (shouldDelete) {
                delete nextValue[currentField.key];
              } else {
                nextValue[currentField.key] = normalized;
              }
              onChange(nextValue);
            },
            disabled,
            value,
          )}
          <Button
            danger
            disabled={disabled}
            onClick={() => {
              const nextValue = { ...value };
              delete nextValue[currentField.key];
              onChange(nextValue);
            }}
          >
            删除此项
          </Button>
        </Space>
      ),
    };
  });

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {absentFields.length > 0 && (
        <Card size="small" title="添加内容">
          <Space wrap style={{ width: "100%" }}>
            <Select
              style={{ minWidth: 220 }}
              value={effectiveNewFieldKey || undefined}
              options={absentFields.map((currentField) => ({
                label: currentField.label,
                value: currentField.key,
              }))}
              onChange={(next) => setNewFieldKey(String(next || ""))}
              disabled={disabled}
              placeholder="选择要添加的效果"
            />
            <Button
              type="primary"
              disabled={disabled || !effectiveNewFieldKey}
              onClick={() => {
                const targetField = fields.find((currentField) => currentField.key === effectiveNewFieldKey);
                if (!targetField) {
                  return;
                }
                onChange({
                  ...value,
                  [targetField.key]: getDefaultValueForField(targetField),
                });
              }}
            >
              添加
            </Button>
          </Space>
        </Card>
      )}
      {collapseItems.length > 0 ? (
        <Collapse size="small" items={collapseItems} />
      ) : (
        <Text style={{ color: "#6b6355", fontSize: 12 }}>暂无已添加内容</Text>
      )}
    </Space>
  );
}

function FortuneEventEffectsEditor({
  value,
  onChange,
  disabled,
}: {
  value: FortuneEventEffectsObject;
  onChange: (next: FortuneEventEffectsObject) => void;
  disabled?: boolean;
}) {
  const [newEventKey, setNewEventKey] = useState<FortuneEventKey | "">("");
  const [newAttrByEvent, setNewAttrByEvent] = useState<Partial<Record<FortuneEventKey, AttributeDeltaKey | "">>>({});

  const presentEventKeys = useMemo(
    () => FORTUNE_EVENT_KEYS.filter((eventKey) => Object.keys(value[eventKey] || {}).length > 0),
    [value],
  );
  const absentEventKeys = useMemo(
    () => FORTUNE_EVENT_KEYS.filter((eventKey) => !presentEventKeys.includes(eventKey)),
    [presentEventKeys],
  );
  const effectiveNewEventKey = absentEventKeys.includes(newEventKey as FortuneEventKey)
    ? newEventKey
    : absentEventKeys[0] || "";

  const collapseItems = presentEventKeys.map((eventKey) => {
    const currentValue = value[eventKey] || {};
    const presentAttrKeys = ATTRIBUTE_DELTA_KEYS.filter((attrKey) => hasOwnDefinedKey(currentValue, attrKey));
    const absentAttrKeys = ATTRIBUTE_DELTA_KEYS.filter((attrKey) => !presentAttrKeys.includes(attrKey));

    return {
      key: eventKey,
      label: `${FORTUNE_EVENT_LABELS[eventKey]}（${presentAttrKeys.length}项）`,
      children: (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Text style={{ color: "#6b6355", fontSize: 12 }}>
            当前气血/灵力的百分比按当前上限计算，其余属性按当前属性值计算。
          </Text>
          {absentAttrKeys.length > 0 && (
            <Space wrap style={{ width: "100%" }}>
              {(() => {
                const effectiveNewAttrKey = absentAttrKeys.includes((newAttrByEvent[eventKey] || "") as AttributeDeltaKey)
                  ? (newAttrByEvent[eventKey] || "")
                  : absentAttrKeys[0] || "";
                return (
                  <>
              <Select
                style={{ minWidth: 220 }}
                value={effectiveNewAttrKey || undefined}
                options={absentAttrKeys.map((attrKey) => ({
                  label: ATTRIBUTE_DELTA_LABELS[attrKey],
                  value: attrKey,
                }))}
                onChange={(next) => {
                  setNewAttrByEvent((prev) => ({
                    ...prev,
                    [eventKey]: (String(next || "") as AttributeDeltaKey | ""),
                  }));
                }}
                disabled={disabled}
                placeholder="选择要添加的属性"
              />
              <Button
                type="primary"
                disabled={disabled || !effectiveNewAttrKey}
                onClick={() => {
                  const attrKey = effectiveNewAttrKey;
                  if (!attrKey) {
                    return;
                  }
                  onChange({
                    ...value,
                    [eventKey]: {
                      ...currentValue,
                      [attrKey]: { flat: 0, percent: 0 },
                    },
                  });
                }}
              >
                添加属性
              </Button>
                  </>
                );
              })()}
            </Space>
          )}
          {presentAttrKeys.map((attrKey) => (
            <Card key={`${eventKey}-${attrKey}`} size="small" title={ATTRIBUTE_DELTA_LABELS[attrKey]}>
              <Space orientation="vertical" style={{ width: "100%" }}>
                <Space wrap style={{ width: "100%" }}>
                  <Text style={{ minWidth: 56, color: "#a09880" }}>固定值</Text>
                  <InputNumber
                    style={{ width: 220 }}
                    disabled={disabled}
                    value={currentValue[attrKey]?.flat}
                    onChange={(next) => {
                      const normalized = toOptionalNumber(next);
                      const nextEventValue = { ...currentValue };
                      const currentModifier = nextEventValue[attrKey] || {};
                      if (normalized === undefined) {
                        delete currentModifier.flat;
                      } else {
                        currentModifier.flat = normalized;
                      }
                      const hasFlat = currentModifier.flat !== undefined && currentModifier.flat !== 0;
                      const hasPercent = currentModifier.percent !== undefined && currentModifier.percent !== 0;
                      if (!hasFlat && !hasPercent) {
                        delete nextEventValue[attrKey];
                      } else {
                        nextEventValue[attrKey] = currentModifier;
                      }
                      const nextValue: FortuneEventEffectsObject = { ...value };
                      nextValue[eventKey] = nextEventValue;
                      onChange(nextValue);
                    }}
                  />
                </Space>
                <Space wrap style={{ width: "100%" }}>
                  <Text style={{ minWidth: 56, color: "#a09880" }}>百分比</Text>
                  <InputNumber
                    style={{ width: 220 }}
                    disabled={disabled}
                    step={0.1}
                    value={currentValue[attrKey]?.percent}
                    onChange={(next) => {
                      const normalized = toOptionalNumber(next);
                      const nextEventValue = { ...currentValue };
                      const currentModifier = nextEventValue[attrKey] || {};
                      if (normalized === undefined) {
                        delete currentModifier.percent;
                      } else {
                        currentModifier.percent = normalized;
                      }
                      const hasFlat = currentModifier.flat !== undefined && currentModifier.flat !== 0;
                      const hasPercent = currentModifier.percent !== undefined && currentModifier.percent !== 0;
                      if (!hasFlat && !hasPercent) {
                        delete nextEventValue[attrKey];
                      } else {
                        nextEventValue[attrKey] = currentModifier;
                      }
                      const nextValue: FortuneEventEffectsObject = { ...value };
                      nextValue[eventKey] = nextEventValue;
                      onChange(nextValue);
                    }}
                  />
                  <Text style={{ color: "#a09880" }}>%</Text>
                </Space>
                <Button
                  danger
                  disabled={disabled}
                  onClick={() => {
                    const nextEventValue = { ...currentValue };
                    delete nextEventValue[attrKey];
                    onChange({
                      ...value,
                      [eventKey]: nextEventValue,
                    });
                  }}
                >
                  删除属性
                </Button>
              </Space>
            </Card>
          ))}
          <Button
            danger
            disabled={disabled}
            onClick={() => {
              onChange({
                ...value,
                [eventKey]: {},
              });
            }}
          >
            删除事件效果
          </Button>
        </Space>
      ),
    };
  });

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {absentEventKeys.length > 0 && (
        <Card size="small" title="添加事件效果">
          <Space wrap style={{ width: "100%" }}>
            <Select
              style={{ minWidth: 220 }}
              value={effectiveNewEventKey || undefined}
              options={absentEventKeys.map((eventKey) => ({
                label: FORTUNE_EVENT_LABELS[eventKey],
                value: eventKey,
              }))}
              onChange={(next) => setNewEventKey(String(next || "") as FortuneEventKey | "")}
              disabled={disabled}
              placeholder="选择要添加的事件"
            />
            <Button
              type="primary"
              disabled={disabled || !effectiveNewEventKey}
              onClick={() => {
                if (!effectiveNewEventKey) {
                  return;
                }
                const defaultAttrKey = ATTRIBUTE_DELTA_KEYS[0];
                setNewEventKey("");
                onChange({
                  ...value,
                  [effectiveNewEventKey]: defaultAttrKey ? { [defaultAttrKey]: { flat: 0, percent: 0 } } : {},
                });
              }}
            >
              添加
            </Button>
          </Space>
        </Card>
      )}
      {collapseItems.length > 0 ? (
        <Collapse size="small" items={collapseItems} />
      ) : (
        <Text style={{ color: "#6b6355", fontSize: 12 }}>暂无已添加内容</Text>
      )}
    </Space>
  );
}

function FortuneSpecialEffectsEditor({
  value,
  onChange,
  disabled,
}: {
  value: FortuneSpecialEffectsObject;
  onChange: (next: FortuneSpecialEffectsObject) => void;
  disabled?: boolean;
}) {
  const [newFieldKey, setNewFieldKey] = useState<FortuneSpecialEffectKey | "">("");

  const presentFieldKeys = useMemo(
    () => FORTUNE_SPECIAL_EFFECT_FIELDS
      .map((field) => field.key)
      .filter((fieldKey) => hasOwnDefinedKey(value, fieldKey)),
    [value],
  );
  const absentFieldKeys = useMemo(
    () => FORTUNE_SPECIAL_EFFECT_FIELDS
      .map((field) => field.key)
      .filter((fieldKey) => !presentFieldKeys.includes(fieldKey)),
    [presentFieldKeys],
  );
  const effectiveNewFieldKey = absentFieldKeys.includes(newFieldKey as FortuneSpecialEffectKey)
    ? newFieldKey
    : absentFieldKeys[0] || "";

  const collapseItems = presentFieldKeys.map((fieldKey) => {
    const config = FORTUNE_SPECIAL_EFFECT_FIELDS.find((field) => field.key === fieldKey);
    if (!config) {
      return null;
    }

    const currentPercent = Number(value[fieldKey] || 0) * 100;
    return {
      key: fieldKey,
      label: config.label,
      children: (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Space wrap style={{ width: "100%" }}>
            <InputNumber
              style={{ width: 220 }}
              disabled={disabled}
              step={0.1}
              value={Number.isFinite(currentPercent) ? currentPercent : 0}
              onChange={(next) => {
                const normalized = toOptionalNumber(next);
                const nextValue: FortuneSpecialEffectsObject = { ...value };
                if (normalized === undefined || normalized === 0) {
                  delete nextValue[fieldKey];
                } else {
                  nextValue[fieldKey] = Number((normalized / 100).toFixed(4));
                }
                onChange(nextValue);
              }}
            />
            <Text style={{ color: "#a09880" }}>%</Text>
          </Space>
          <Button
            danger
            disabled={disabled}
            onClick={() => {
              const nextValue: FortuneSpecialEffectsObject = { ...value };
              delete nextValue[fieldKey];
              onChange(nextValue);
            }}
          >
            删除效果
          </Button>
        </Space>
      ),
    };
  }).filter((item): item is NonNullable<typeof item> => !!item);

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Text style={{ color: "#6b6355", fontSize: 12 }}>
        编辑器中按百分比填写，例如输入 20 代表 +20%。
      </Text>
      {absentFieldKeys.length > 0 && (
        <Card size="small" title="添加特殊效果">
          <Space wrap style={{ width: "100%" }}>
            <Select
              style={{ minWidth: 220 }}
              value={effectiveNewFieldKey || undefined}
              options={FORTUNE_SPECIAL_EFFECT_FIELDS
                .filter((field) => absentFieldKeys.includes(field.key))
                .map((field) => ({
                  label: field.label,
                  value: field.key,
                }))}
              onChange={(next) => setNewFieldKey(String(next || "") as FortuneSpecialEffectKey | "")}
              disabled={disabled}
              placeholder="选择要添加的效果"
            />
            <Button
              type="primary"
              disabled={disabled || !effectiveNewFieldKey}
              onClick={() => {
                if (!effectiveNewFieldKey) {
                  return;
                }
                setNewFieldKey("");
                onChange({
                  ...value,
                  [effectiveNewFieldKey]: 0.1,
                });
              }}
            >
              添加
            </Button>
          </Space>
        </Card>
      )}
      {collapseItems.length > 0 ? (
        <Collapse size="small" items={collapseItems} />
      ) : (
        <Text style={{ color: "#6b6355", fontSize: 12 }}>暂无已添加内容</Text>
      )}
    </Space>
  );
}

function normalizeQuestRequirementRow(row: JsonRow): JsonRow {
  const type = typeof row.type === "string" ? row.type : "";
  const next = { ...row };

  if (type === "talk") {
    next.quantity = 1;
  }

  if (type === "realm") {
    next.targetId = "";
    if (typeof next.targetName !== "string" || !next.targetName.trim()) {
      next.targetName = "当前境界";
    }
  }

  if (type === "power") {
    next.targetId = "";
    if (typeof next.targetName !== "string" || !next.targetName.trim()) {
      next.targetName = "综合战力";
    }
  }

  return next;
}

function PregnancyAttrEffectsEditor({
  value,
  disabled,
  onChange,
}: {
  value: AttributeDelta;
  disabled?: boolean;
  onChange: (next: AttributeDelta) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
      {ATTRIBUTE_DELTA_KEYS.map((key) => (
        <div key={`pregnancy-attr-${key}`}>
          <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
            {ATTRIBUTE_DELTA_LABELS[key].split("(")[0]}
          </Text>
          <InputNumber
            disabled={disabled}
            style={{ width: "100%" }}
            value={value[key] ?? 0}
            onChange={(next) => {
              const nextValue: AttributeDelta = {
                ...value,
              };
              const normalized = toOptionalSignedInt(next);
              if (normalized === undefined || normalized === 0) {
                delete nextValue[key];
              } else {
                nextValue[key] = normalized;
              }
              onChange(nextValue);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function PregnancyFlowEffectsEditor({
  value,
  disabled,
  onChange,
}: {
  value: PlayerStatusFlowEffects;
  disabled?: boolean;
  onChange: (next: PlayerStatusFlowEffects) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
      {PREGNANCY_FLOW_EFFECT_FIELDS.map((field) => (
        <div key={`pregnancy-flow-${field.key}`}>
          <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
            {field.label}
          </Text>
          <InputNumber
            disabled={disabled}
            style={{ width: "100%" }}
            step={field.step || 0.01}
            value={value[field.key] ?? 0}
            onChange={(next) => {
              const nextValue: PlayerStatusFlowEffects = {
                ...value,
              };
              const normalized = toOptionalNumber(next);
              if (normalized === undefined || normalized === 0) {
                delete nextValue[field.key];
              } else {
                nextValue[field.key] = Number(normalized.toFixed(4));
              }
              onChange(nextValue);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function PregnancySystemConfigEditor({
  value,
  disabled,
  onChange,
}: {
  value: PregnancySystemConfig;
  disabled?: boolean;
  onChange: (next: PregnancySystemConfig) => void;
}) {
  const updateStage = (stageIndex: number, updater: (stage: PregnancySystemConfigStage) => PregnancySystemConfigStage) => {
    const nextStages = value.stages.map((stage, index) => (index === stageIndex ? updater(stage) : stage));
    onChange({
      ...value,
      stages: nextStages,
    });
  };

  const moveStage = (stageIndex: number, offset: -1 | 1) => {
    const nextIndex = stageIndex + offset;
    if (nextIndex < 0 || nextIndex >= value.stages.length) {
      return;
    }
    const nextStages = [...value.stages];
    const [current] = nextStages.splice(stageIndex, 1);
    nextStages.splice(nextIndex, 0, current);
    onChange({
      ...value,
      stages: nextStages,
    });
  };

  const removeStage = (stageIndex: number) => {
    if (value.stages.length <= 1) {
      return;
    }
    onChange({
      ...value,
      stages: value.stages.filter((_, index) => index !== stageIndex),
    });
  };

  const collapseItems = value.stages.map((stage, stageIndex) => ({
    key: `${stage.key}-${stageIndex}`,
    label: `阶段 ${stageIndex + 1} · ${stage.title || "未命名阶段"} · ${stage.durationHours} 小时`,
    children: (
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
              阶段键
            </Text>
            <Input
              disabled={disabled}
              value={stage.key}
              onChange={(event) => {
                updateStage(stageIndex, (current) => ({
                  ...current,
                  key: event.target.value,
                }));
              }}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
              阶段名称
            </Text>
            <Input
              disabled={disabled}
              value={stage.title}
              onChange={(event) => {
                updateStage(stageIndex, (current) => ({
                  ...current,
                  title: event.target.value,
                }));
              }}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
              持续时长（小时）
            </Text>
            <InputNumber
              disabled={disabled}
              min={0}
              style={{ width: "100%" }}
              value={stage.durationHours}
              onChange={(next) => {
                updateStage(stageIndex, (current) => ({
                  ...current,
                  durationHours: Math.max(0, Number(toOptionalNumber(next)?.toFixed(2) || current.durationHours)),
                }));
              }}
            />
          </div>
        </div>

        <div>
          <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
            图标地址
          </Text>
          <Input
            disabled={disabled}
            value={stage.iconImageUrl}
            onChange={(event) => {
              updateStage(stageIndex, (current) => ({
                ...current,
                iconImageUrl: event.target.value,
              }));
            }}
          />
          {stage.iconImageUrl && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <Image
                src={stage.iconImageUrl}
                alt={stage.title || `阶段${stageIndex + 1}`}
                width={72}
                height={72}
                preview={false}
                style={{ objectFit: "cover", borderRadius: 12, border: "1px solid rgba(201, 168, 76, 0.18)" }}
              />
              <Text style={{ color: "#6b6355", fontSize: 12 }}>
                预览仅用于确认路径是否大致正确，实际显示以游戏内状态栏为准。
              </Text>
            </div>
          )}
        </div>

        <Card size="small" title="属性影响">
          <PregnancyAttrEffectsEditor
            value={stage.attrEffects}
            disabled={disabled}
            onChange={(nextAttrEffects) => {
              updateStage(stageIndex, (current) => ({
                ...current,
                attrEffects: nextAttrEffects,
              }));
            }}
          />
        </Card>

        <Card size="small" title="流程影响">
          <PregnancyFlowEffectsEditor
            value={stage.flowEffects}
            disabled={disabled}
            onChange={(nextFlowEffects) => {
              updateStage(stageIndex, (current) => ({
                ...current,
                flowEffects: nextFlowEffects,
              }));
            }}
          />
        </Card>

        <Space wrap>
          <Button disabled={disabled || stageIndex === 0} onClick={() => moveStage(stageIndex, -1)}>
            上移
          </Button>
          <Button disabled={disabled || stageIndex === value.stages.length - 1} onClick={() => moveStage(stageIndex, 1)}>
            下移
          </Button>
          <Button danger disabled={disabled || value.stages.length <= 1} onClick={() => removeStage(stageIndex)}>
            删除阶段
          </Button>
        </Space>
      </Space>
    ),
  }));

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Card size="small" title="基础设置">
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <Text style={{ color: "#d9d9d9", display: "block" }}>启用孕育系统</Text>
              <Text style={{ color: "#6b6355", fontSize: 12 }}>关闭后将直接停用整条玩家孕育状态链。</Text>
            </div>
            <Switch
              checked={value.enabled}
              disabled={disabled}
              checkedChildren="启用"
              unCheckedChildren="关闭"
              onChange={(checked) => onChange({
                ...value,
                enabled: checked,
              })}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <div>
              <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>状态键</Text>
              <Input
                disabled={disabled}
                value={value.statusKey}
                onChange={(event) => onChange({ ...value, statusKey: event.target.value })}
              />
            </div>
            <div>
              <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>状态标题</Text>
              <Input
                disabled={disabled}
                value={value.statusTitle}
                onChange={(event) => onChange({ ...value, statusTitle: event.target.value })}
              />
            </div>
            <div>
              <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>来源插件 ID</Text>
              <Input
                disabled={disabled}
                value={value.sourcePluginId}
                onChange={(event) => onChange({ ...value, sourcePluginId: event.target.value })}
              />
            </div>
          </div>
        </Space>
      </Card>

      <Card size="small" title="概率与阈值">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>基础概率</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              max={1}
              step={0.01}
              style={{ width: "100%" }}
              value={value.baseChanceRate}
              onChange={(next) => onChange({ ...value, baseChanceRate: Number(toOptionalNumber(next)?.toFixed(4) || value.baseChanceRate) })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>概率上限</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              max={1}
              step={0.01}
              style={{ width: "100%" }}
              value={value.chanceCapRate}
              onChange={(next) => onChange({ ...value, chanceCapRate: Number(toOptionalNumber(next)?.toFixed(4) || value.chanceCapRate) })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>高吸收阈值（ml）</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              step={1}
              style={{ width: "100%" }}
              value={value.highAbsorbMlThreshold}
              onChange={(next) => onChange({ ...value, highAbsorbMlThreshold: Number(toOptionalNumber(next)?.toFixed(2) || value.highAbsorbMlThreshold) })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>高吸收额外加成</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              max={1}
              step={0.01}
              style={{ width: "100%" }}
              value={value.highAbsorbBonusRate}
              onChange={(next) => onChange({ ...value, highAbsorbBonusRate: Number(toOptionalNumber(next)?.toFixed(4) || value.highAbsorbBonusRate) })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>低留存阶段阈值</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              max={1}
              step={0.01}
              style={{ width: "100%" }}
              value={value.lowFluidStageRatio}
              onChange={(next) => onChange({ ...value, lowFluidStageRatio: Number(toOptionalNumber(next)?.toFixed(4) || value.lowFluidStageRatio) })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>高留存阶段阈值</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              max={1}
              step={0.01}
              style={{ width: "100%" }}
              value={value.highFluidStageRatio}
              onChange={(next) => onChange({ ...value, highFluidStageRatio: Number(toOptionalNumber(next)?.toFixed(4) || value.highFluidStageRatio) })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>专属事件触发阶段键</Text>
            <Input
              disabled={disabled}
              value={value.exclusiveEventStageKey}
              onChange={(event) => onChange({ ...value, exclusiveEventStageKey: event.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card size="small" title="气运倍率键">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          {PREGNANCY_FORTUNE_BONUS_FIELDS.map((field) => (
            <div key={`pregnancy-bonus-key-${field.key}`}>
              <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>
                {field.label}
              </Text>
              <Input
                disabled={disabled}
                value={value.fortuneBonusKeys[field.key]}
                onChange={(event) => onChange({
                  ...value,
                  fortuneBonusKeys: {
                    ...value.fortuneBonusKeys,
                    [field.key]: event.target.value,
                  },
                })}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card
        size="small"
        title="阶段列表"
        extra={(
          <Button
            type="primary"
            disabled={disabled}
            onClick={() => onChange({
              ...value,
              stages: [...value.stages, createDefaultPregnancyStage(value.stages.length)],
            })}
          >
            新增阶段
          </Button>
        )}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          <Text style={{ color: "#6b6355", fontSize: 12 }}>
            阶段顺序就是实际推进顺序。可直接修改名称、时长、图标和每阶段影响。
          </Text>
          <Collapse size="small" items={collapseItems} />
        </Space>
      </Card>

      <Card size="small" title="完成结算">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>结算标题</Text>
            <Input
              disabled={disabled}
              value={value.settlement.title}
              onChange={(event) => onChange({
                ...value,
                settlement: {
                  ...value.settlement,
                  title: event.target.value,
                },
              })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>修为比例</Text>
            <InputNumber
              disabled={disabled}
              min={0}
              step={0.01}
              style={{ width: "100%" }}
              value={value.settlement.rewardXpRatio}
              onChange={(next) => onChange({
                ...value,
                settlement: {
                  ...value.settlement,
                  rewardXpRatio: Number(toOptionalNumber(next)?.toFixed(4) || value.settlement.rewardXpRatio),
                },
              })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>修为下限</Text>
            <InputNumber
              disabled={disabled}
              step={1}
              style={{ width: "100%" }}
              value={value.settlement.rewardXpMin}
              onChange={(next) => onChange({
                ...value,
                settlement: {
                  ...value.settlement,
                  rewardXpMin: toOptionalSignedInt(next) ?? value.settlement.rewardXpMin,
                },
              })}
            />
          </div>
          <div>
            <Text style={{ color: "#a09880", display: "block", fontSize: 12, marginBottom: 4 }}>修为上限</Text>
            <InputNumber
              disabled={disabled}
              step={1}
              style={{ width: "100%" }}
              value={value.settlement.rewardXpMax}
              onChange={(next) => onChange({
                ...value,
                settlement: {
                  ...value.settlement,
                  rewardXpMax: toOptionalSignedInt(next) ?? value.settlement.rewardXpMax,
                },
              })}
            />
          </div>
        </div>
      </Card>
    </Space>
  );
}

export default function JsonFieldEditor({
  field,
  value,
  onChange,
  disabled,
  realmOptions = [],
  allowNegativeRewardValue = false,
  contextValues,
}: JsonFieldEditorProps) {
  const schema = field.jsonSchema;
  const contextGongfaType = typeof contextValues?.gongfaType === "string" ? contextValues.gongfaType : "";
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [eventRewardActionTypeOptions] = useState<AdminSelectOption[]>(BUILTIN_EVENT_REWARD_ACTION_TYPE_OPTIONS);
  const eventJudgeDefinitions = useMemo<EventJudgePluginDefinition[]>(() => CORE_EVENT_JUDGE_DEFINITIONS, []);
  const eventJudgePluginOptions = useMemo<AdminSelectOption[]>(() => CORE_EVENT_JUDGE_OPTIONS, []);
  const [newEventJudgePluginId, setNewEventJudgePluginId] = useState("");
  const rawText = value || "";

  const parsed = useMemo(() => safeParse(rawText), [rawText]);
  const parseError = useMemo(() => {
    if (!rawText.trim()) {
      return null;
    }
    try {
      JSON.parse(rawText);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [rawText]);

  const pushRawChange = useCallback((nextRaw: string) => {
    onChange?.(nextRaw);
  }, [onChange]);

  const visualContent = useMemo(() => {
    if (!schema) {
      return null;
    }

    if (schema.kind === "array-string") {
      const values = ensureArrayString(parsed);
      return (
        <ArrayStringEditor
          schema={schema}
          values={values}
          disabled={disabled}
          onChange={(next) => pushRawChange(toRawText(next))}
        />
      );
    }

    if (schema.kind === "object") {
      const objectValue = ensureObject(parsed);
      return (
        <ObjectEditor
          schema={schema}
          value={objectValue}
          disabled={disabled}
          onChange={(next) => pushRawChange(toRawText(next))}
        />
      );
    }

    if (schema.kind === "pregnancy-system-config") {
      const pregnancyConfigValue = ensurePregnancySystemConfig(parsed);
      return (
        <PregnancySystemConfigEditor
          value={pregnancyConfigValue}
          disabled={disabled}
          onChange={(next) => pushRawChange(toRawText(next))}
        />
      );
    }

    if (schema.kind === "fortune-event-effects") {
      const eventEffectsValue = ensureFortuneEventEffects(parsed);

      return (
        <FortuneEventEffectsEditor
          value={eventEffectsValue}
          disabled={disabled}
          onChange={(next) => pushRawChange(toFortuneEventEffectsRawText(next))}
        />
      );
    }

    if (schema.kind === "fortune-special-effects") {
      const specialEffectsSource = ensureObject(parsed);
      const specialEffectsValue: FortuneSpecialEffectsObject = {};
      FORTUNE_SPECIAL_EFFECT_FIELDS.forEach((field) => {
        const normalized = normalizeFortuneRateValue(specialEffectsSource[field.key] as never);
        if (normalized !== 0 || Object.prototype.hasOwnProperty.call(specialEffectsSource, field.key)) {
          specialEffectsValue[field.key] = normalized;
        }
      });

      return (
        <FortuneSpecialEffectsEditor
          value={specialEffectsValue}
          disabled={disabled}
          onChange={(next) => {
            const output: Record<string, number> = {};
            FORTUNE_SPECIAL_EFFECT_FIELDS.forEach((field) => {
              const value = toOptionalNumber(next[field.key]);
              if (value !== undefined && value !== 0) {
                output[field.key] = Number(value.toFixed(4));
              }
            });
            pushRawChange(toRawText(output));
          }}
        />
      );
    }

    if (schema.kind === "event-judge-conditions") {
      const judgeValue = ensureEventJudgeConditions(parsed);
      const pluginConditionEntries = Object.entries(judgeValue.pluginConditions);
      const pluginDefinitionMap = new Map(eventJudgeDefinitions.map((item) => [item.pluginId, item]));
      const pluginLabelMap = new Map(
        eventJudgePluginOptions.map((item) => [String(item.value || "").trim(), String(item.label || "").trim()]),
      );
      const defaultNewPluginId = eventJudgePluginOptions.find((item) => {
        const pluginId = String(item.value || "").trim();
        return pluginId && !Object.prototype.hasOwnProperty.call(judgeValue.pluginConditions, pluginId);
      });

      const updatePluginConditions = (nextPluginConditions: Record<string, unknown>) => {
        pushRawChange(toEventJudgeConditionsRawText({
          ...judgeValue,
          pluginConditions: nextPluginConditions,
        }));
      };

      const removePluginJudge = (pluginId: string) => {
        const nextPluginConditions: Record<string, unknown> = {
          ...judgeValue.pluginConditions,
        };
        delete nextPluginConditions[pluginId];
        updatePluginConditions(nextPluginConditions);
      };

      const updatePluginJudgeByJsonText = (pluginId: string, nextRawText: string) => {
        const nextTrimmed = nextRawText.trim();
        let nextCondition: unknown = {};
        if (nextTrimmed) {
          try {
            nextCondition = JSON.parse(nextTrimmed);
          } catch {
            void message.error("核心判定条件 JSON 格式错误，未保存");
            return;
          }
          if (!nextCondition || typeof nextCondition !== "object" || Array.isArray(nextCondition)) {
            void message.error("核心判定条件必须是 JSON 对象");
            return;
          }
        }
        const nextPluginConditions: Record<string, unknown> = {
          ...judgeValue.pluginConditions,
          [pluginId]: nextCondition,
        };
        updatePluginConditions(nextPluginConditions);
      };

      const updatePluginJudgeFieldValue = (
        pluginId: string,
        field: EventJudgePluginDefinitionField,
        nextValue: unknown,
      ) => {
        const currentCondition = ensureObject(judgeValue.pluginConditions[pluginId]);
        const nextCondition: Record<string, unknown> = {
          ...currentCondition,
        };

        if (field.type === "number") {
          const value = toOptionalNumber(nextValue);
          if (value === undefined) {
            if (field.required) {
              nextCondition[field.key] = 0;
            } else {
              delete nextCondition[field.key];
            }
          } else {
            nextCondition[field.key] = value;
          }
        } else if (field.type === "boolean") {
          nextCondition[field.key] = nextValue === true;
        } else {
          const value = String(nextValue ?? "").trim();
          if (value || field.required) {
            nextCondition[field.key] = value;
          } else {
            delete nextCondition[field.key];
          }
        }

        updatePluginConditions({
          ...judgeValue.pluginConditions,
          [pluginId]: nextCondition,
        });
      };

      const addPluginJudge = () => {
        const pluginId = String(newEventJudgePluginId || "").trim()
          || String(defaultNewPluginId?.value || "").trim();
        if (!pluginId) {
          void message.warning("请先输入判定ID");
          return;
        }
        if (Object.prototype.hasOwnProperty.call(judgeValue.pluginConditions, pluginId)) {
          void message.warning("该核心判定已存在");
          return;
        }
        const definition = pluginDefinitionMap.get(pluginId);
        updatePluginConditions({
          ...judgeValue.pluginConditions,
          [pluginId]: definition ? createDefaultEventJudgePluginCondition(definition) : {},
        });
        setNewEventJudgePluginId("");
      };

      return (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Card size="small" title="性别判定">
            <Select
              showSearch
              optionFilterProp="label"
              disabled={disabled}
              options={EVENT_JUDGE_GENDER_OPTIONS}
              value={judgeValue.gender || ""}
              onChange={(next) => {
                const nextGender = normalizeEventJudgeGender(next);
                pushRawChange(toEventJudgeConditionsRawText({
                  ...judgeValue,
                  gender: nextGender,
                }));
              }}
            />
          </Card>
          <Card size="small" title="气运判定">
            <Space orientation="vertical" style={{ width: "100%" }}>
              {judgeValue.fortuneConditions.map((row, index) => (
                <Space key={`judge-fortune-${index}`} style={{ width: "100%" }}>
                  <ReferenceSelect
                    entity="fortunes"
                    labelKey="name"
                    value={row.fortuneId}
                    onChange={(next) => {
                      const nextFortuneId = String(next || "").trim();
                      const copied = [...judgeValue.fortuneConditions];
                      copied[index] = { ...copied[index], fortuneId: nextFortuneId };
                      pushRawChange(toEventJudgeConditionsRawText({
                        ...judgeValue,
                        fortuneConditions: copied,
                      }));
                    }}
                    disabled={disabled}
                  />
                  <Switch
                    checked={row.hasFortune !== false}
                    checkedChildren="有"
                    unCheckedChildren="无"
                    disabled={disabled}
                    onChange={(next) => {
                      const copied = [...judgeValue.fortuneConditions];
                      copied[index] = { ...copied[index], hasFortune: next };
                      pushRawChange(toEventJudgeConditionsRawText({
                        ...judgeValue,
                        fortuneConditions: copied,
                      }));
                    }}
                  />
                  <Button
                    danger
                    disabled={disabled}
                    onClick={() => {
                      const copied = judgeValue.fortuneConditions.filter((_, i) => i !== index);
                      pushRawChange(toEventJudgeConditionsRawText({
                        ...judgeValue,
                        fortuneConditions: copied,
                      }));
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ))}
              <Button
                disabled={disabled}
                onClick={() => {
                  pushRawChange(toEventJudgeConditionsRawText({
                    ...judgeValue,
                    fortuneConditions: [...judgeValue.fortuneConditions, { fortuneId: "", hasFortune: true }],
                  }));
                }}
              >
                新增条件
              </Button>
            </Space>
          </Card>
          <Card size="small" title="核心判定">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Space style={{ width: "100%" }}>
                <Input
                  style={{ width: 320 }}
                  placeholder="判定ID，例如 double-cultivation"
                  disabled={disabled}
                  value={newEventJudgePluginId}
                  onChange={(e) => setNewEventJudgePluginId(e.target.value)}
                />
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 320 }}
                  disabled={disabled}
                  placeholder="选择核心判定(可选)"
                  options={eventJudgePluginOptions}
                  value={undefined}
                  onChange={(next) => {
                    setNewEventJudgePluginId(String(next || "").trim());
                  }}
                />
                <Button disabled={disabled} onClick={addPluginJudge}>
                  新增核心判定
                </Button>
              </Space>
              {pluginConditionEntries.length < 1 ? (
                <Text type="secondary">暂无核心判定条件</Text>
              ) : null}
              {pluginConditionEntries.map(([pluginId, condition]) => {
                const pluginLabel = pluginLabelMap.get(pluginId) || pluginId;
                const pluginDefinition = pluginDefinitionMap.get(pluginId);
                return (
                  <Card
                    key={pluginId}
                    size="small"
                    title={pluginLabel}
                    extra={(
                      <Button
                        size="small"
                        danger
                        disabled={disabled}
                        onClick={() => removePluginJudge(pluginId)}
                      >
                        删除
                      </Button>
                    )}
                  >
                    {pluginDefinition && pluginDefinition.fields.length > 0 ? (
                      <Space orientation="vertical" style={{ width: "100%" }}>
                        {pluginDefinition.fields.map((fieldDef) => {
                          const field: JsonSchemaField = {
                            key: fieldDef.key,
                            label: fieldDef.label,
                            type: fieldDef.type,
                            required: fieldDef.required,
                            options: fieldDef.options,
                          };
                          const currentCondition = ensureObject(condition);
                          const currentValue = toFieldValue(field, currentCondition[fieldDef.key]);
                          return (
                            <div key={`${pluginId}-${fieldDef.key}`} style={{ maxWidth: 340 }}>
                              <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginBottom: 4 }}>
                                {fieldDef.label}
                              </Text>
                              {renderPrimitiveEditor(
                                field,
                                currentValue,
                                (next) => {
                                  updatePluginJudgeFieldValue(pluginId, fieldDef, next);
                                },
                                disabled,
                              )}
                            </div>
                          );
                        })}
                      </Space>
                    ) : (
                      <>
                        <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginBottom: 4 }}>
                          条件 JSON（对象），失焦时保存
                        </Text>
                        <TextArea
                          key={`${pluginId}-${JSON.stringify(condition ?? {})}`}
                          rows={4}
                          disabled={disabled}
                          defaultValue={toRawText(condition ?? {})}
                          onBlur={(e) => {
                            updatePluginJudgeByJsonText(pluginId, e.target.value);
                          }}
                        />
                      </>
                    )}
                  </Card>
                );
              })}
            </Space>
          </Card>
        </Space>
      );
    }

    if (schema.kind === "double-cultivation-secret-stats") {
      const secretStatsValue = ensureDoubleCultivationSecretStats(parsed);
      const rows: JsonRow[] = secretStatsValue.fields.map((field, index) => ({
        ...field,
        __key: `secret-stats-field-${index}`,
      }));

      const updateRows = (nextRows: JsonRow[]) => {
        const nextFields = nextRows
          .map((row): SecretStatsField | null => {
            const id = normalizeSecretMetricId(row.id);
            if (!id) {
              return null;
            }
            const defaults = SECRET_METRIC_DEFAULTS[id];
            return {
              id,
              enabled: row.enabled !== false,
              maleLabel: String(row.maleLabel || "").trim() || defaults.maleLabel,
              femaleLabel: String(row.femaleLabel || "").trim() || defaults.femaleLabel,
              unit: String(row.unit || "").trim() || defaults.unit,
            };
          })
          .filter((item): item is SecretStatsField => !!item);

        pushRawChange(toDoubleCultivationSecretStatsRawText({
          ...secretStatsValue,
          fields: nextFields.length > 0 ? nextFields : createDefaultSecretStatsConfig().fields,
        }));
      };

      const updateRange = (
        key: "fluidMlPerSessionRange" | "intimacyPerSessionRange",
        patch: Partial<SecretStatsRange>,
      ) => {
        const fallback = key === "fluidMlPerSessionRange"
          ? DEFAULT_SECRET_STATS_FLUID_RANGE
          : DEFAULT_SECRET_STATS_INTIMACY_RANGE;
        const nextRange = normalizeSecretStatsRange({
          ...secretStatsValue[key],
          ...patch,
        }, fallback);
        pushRawChange(toDoubleCultivationSecretStatsRawText({
          ...secretStatsValue,
          [key]: nextRange,
        }));
      };

      const columns: ColumnsType<JsonRow> = [
        {
          title: "指标",
          key: "id",
          width: 180,
          render: (_, row) => (
            <Select
              showSearch
              optionFilterProp="label"
              style={{ width: "100%" }}
              disabled={disabled}
              options={SECRET_METRIC_OPTIONS}
              value={String(row.id || "")}
              onChange={(nextValue) => {
                const nextId = normalizeSecretMetricId(nextValue);
                if (!nextId) {
                  return;
                }
                const defaults = SECRET_METRIC_DEFAULTS[nextId];
                const nextRows = rows.map((item) => item.__key === row.__key
                  ? {
                    ...item,
                    id: nextId,
                    maleLabel: defaults.maleLabel,
                    femaleLabel: defaults.femaleLabel,
                    unit: defaults.unit,
                  }
                  : item);
                updateRows(nextRows);
              }}
            />
          ),
        },
        {
          title: "启用",
          key: "enabled",
          width: 90,
          render: (_, row) => (
            <Switch
              checked={row.enabled !== false}
              checkedChildren="开"
              unCheckedChildren="关"
              disabled={disabled}
              onChange={(nextValue) => {
                const nextRows = rows.map((item) => item.__key === row.__key
                  ? { ...item, enabled: nextValue }
                  : item);
                updateRows(nextRows);
              }}
            />
          ),
        },
        {
          title: "男文案",
          key: "maleLabel",
          render: (_, row) => (
            <Input
              disabled={disabled}
              value={String(row.maleLabel || "")}
              onChange={(event) => {
                const nextRows = rows.map((item) => item.__key === row.__key
                  ? { ...item, maleLabel: event.target.value }
                  : item);
                updateRows(nextRows);
              }}
            />
          ),
        },
        {
          title: "女文案",
          key: "femaleLabel",
          render: (_, row) => (
            <Input
              disabled={disabled}
              value={String(row.femaleLabel || "")}
              onChange={(event) => {
                const nextRows = rows.map((item) => item.__key === row.__key
                  ? { ...item, femaleLabel: event.target.value }
                  : item);
                updateRows(nextRows);
              }}
            />
          ),
        },
        {
          title: "单位",
          key: "unit",
          width: 120,
          render: (_, row) => (
            <Input
              disabled={disabled}
              value={String(row.unit || "")}
              onChange={(event) => {
                const nextRows = rows.map((item) => item.__key === row.__key
                  ? { ...item, unit: event.target.value }
                  : item);
                updateRows(nextRows);
              }}
            />
          ),
        },
        {
          title: "操作",
          key: "actions",
          width: 80,
          render: (_, row) => (
            <Button
              size="small"
              danger
              disabled={disabled}
              onClick={() => {
                const nextRows = rows.filter((item) => item.__key !== row.__key);
                updateRows(nextRows);
              }}
            >
              删除
            </Button>
          ),
        },
      ];

      return (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Card size="small" title="每次双修灵液量范围 (ml)">
            <Space style={{ width: "100%" }}>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                disabled={disabled}
                value={secretStatsValue.fluidMlPerSessionRange.min}
                onChange={(next) => {
                  updateRange("fluidMlPerSessionRange", {
                    min: toOptionalInt(next) ?? secretStatsValue.fluidMlPerSessionRange.min,
                  });
                }}
              />
              <Text type="secondary">~</Text>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                disabled={disabled}
                value={secretStatsValue.fluidMlPerSessionRange.max}
                onChange={(next) => {
                  updateRange("fluidMlPerSessionRange", {
                    max: toOptionalInt(next) ?? secretStatsValue.fluidMlPerSessionRange.max,
                  });
                }}
              />
            </Space>
          </Card>
          <Card size="small" title="每次双修亲密度范围">
            <Space style={{ width: "100%" }}>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                disabled={disabled}
                value={secretStatsValue.intimacyPerSessionRange.min}
                onChange={(next) => {
                  updateRange("intimacyPerSessionRange", {
                    min: toOptionalInt(next) ?? secretStatsValue.intimacyPerSessionRange.min,
                  });
                }}
              />
              <Text type="secondary">~</Text>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                disabled={disabled}
                value={secretStatsValue.intimacyPerSessionRange.max}
                onChange={(next) => {
                  updateRange("intimacyPerSessionRange", {
                    max: toOptionalInt(next) ?? secretStatsValue.intimacyPerSessionRange.max,
                  });
                }}
              />
            </Space>
          </Card>
          <Card size="small" title="展示字段">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Table<JsonRow>
                rowKey="__key"
                size="small"
                pagination={false}
                columns={columns}
                dataSource={rows}
              />
              <Button
                disabled={disabled}
                onClick={() => {
                  updateRows([
                    ...rows,
                    {
                      __key: `secret-stats-field-${rows.length}`,
                      ...createDefaultSecretStatsField("eventCount"),
                    },
                  ]);
                }}
              >
                新增字段
              </Button>
            </Space>
          </Card>
        </Space>
      );
    }

    if (schema.kind === "gongfa-level-config") {
      const levels = ensureGongfaLevelConfig(parsed);
      const visibleLevels = levels.length > 0 ? levels : [createDefaultGongfaLevelConfig(0)];
      const visibleBonusGroups = GONGFA_BONUS_FIELD_GROUPS.filter((group) => {
        if (contextGongfaType === "normal") {
          return group.key !== "sex";
        }
        return true;
      });
      const updateLevels = (nextLevels: GongfaLevelConfig[]) => {
        pushRawChange(toGongfaLevelConfigRawText(nextLevels.map((level, index) => ({
          ...level,
          levelIndex: index + 1,
        }))));
      };
      const setLevel = (index: number, patch: Partial<GongfaLevelConfig>) => {
        updateLevels(visibleLevels.map((level, currentIndex) => (
          currentIndex === index
            ? {
              ...level,
              ...patch,
            }
            : level
        )));
      };
      const moveLevel = (index: number, delta: -1 | 1) => {
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= visibleLevels.length) {
          return;
        }
        const nextLevels = [...visibleLevels];
        const current = nextLevels[index];
        nextLevels[index] = nextLevels[nextIndex];
        nextLevels[nextIndex] = current;
        updateLevels(nextLevels);
      };
      const getRequirementSummary = (level: GongfaLevelConfig) => {
        if (level.requirementType === "none") {
          return "无额外要求";
        }
        const requirementOption = GONGFA_REQUIREMENT_OPTIONS.find((option) => option.value === level.requirementType);
        const requirementLabel = requirementOption?.label || level.requirementType;
        return requirementLabel + " " + Math.max(0, level.requirementValue || 0);
      };
      const getBonusGroupSummary = (level: GongfaLevelConfig, group: GongfaBonusFieldGroup) => {
        return group.fields
          .map((field) => {
            const value = toOptionalNumber(level.bonuses[field.key]);
            if (value === undefined || value === 0) {
              return null;
            }
            return field.label + (value > 0 ? "+" : "") + value;
          })
          .filter((item): item is string => !!item);
      };

      return (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Collapse
            accordion={false}
            items={visibleLevels.map((level, index) => ({
              key: "gongfa-level-" + index,
              label: (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%", paddingRight: 8 }}>
                  <span>{(level.layerLabel || ("第" + (index + 1) + "层")) + " · 第 " + (index + 1) + " 层"}</span>
                  <span style={{ color: "#8d826b", fontSize: 12 }}>
                    {"消耗 " + Math.max(0, level.upgradeCost || 0) + " · " + getRequirementSummary(level)}
                  </span>
                </div>
              ),
              children: (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Card size="small" title="基础设置">
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <Text style={{ display: "block", marginBottom: 6 }}>层级名称</Text>
                        <Input
                          disabled={disabled}
                          value={level.layerLabel}
                          onChange={(event) => {
                            setLevel(index, {
                              layerLabel: event.target.value,
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Text style={{ display: "block", marginBottom: 6 }}>升级消耗</Text>
                        <InputNumber
                          style={{ width: "100%" }}
                          min={0}
                          disabled={disabled}
                          value={level.upgradeCost}
                          onChange={(next) => {
                            setLevel(index, {
                              upgradeCost: Math.max(0, toOptionalInt(next) ?? 0),
                            });
                          }}
                        />
                      </div>
                    </div>
                  </Card>

                  <Card size="small" title="升级要求">
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <Text style={{ display: "block", marginBottom: 6 }}>要求类型</Text>
                        <Select
                          value={level.requirementType}
                          disabled={disabled}
                          options={GONGFA_REQUIREMENT_OPTIONS}
                          onChange={(nextValue) => {
                            setLevel(index, {
                              requirementType: normalizeGongfaRequirementType(nextValue),
                            });
                          }}
                        />
                      </div>
                      {level.requirementType !== "none" && (
                        <div>
                          <Text style={{ display: "block", marginBottom: 6 }}>要求数值</Text>
                          <InputNumber
                            style={{ width: "100%" }}
                            min={0}
                            disabled={disabled}
                            value={level.requirementValue}
                            onChange={(next) => {
                              setLevel(index, {
                                requirementValue: Math.max(0, toOptionalInt(next) ?? 0),
                              });
                            }}
                          />
                        </div>
                      )}
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Text style={{ display: "block", marginBottom: 6 }}>要求说明</Text>
                        <TextArea
                          rows={2}
                          disabled={disabled}
                          value={level.requirementText}
                          onChange={(event) => {
                            setLevel(index, {
                              requirementText: event.target.value,
                            });
                          }}
                        />
                      </div>
                    </div>
                  </Card>

                  <Collapse
                    size="small"
                    defaultActiveKey={visibleBonusGroups
                      .filter((group) => getBonusGroupSummary(level, group).length > 0)
                      .map((group) => "gongfa-level-" + index + "-bonus-" + group.key)}
                    items={visibleBonusGroups.map((group) => {
                      const summaryItems = getBonusGroupSummary(level, group);
                      return {
                        key: "gongfa-level-" + index + "-bonus-" + group.key,
                        label: (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%", paddingRight: 8 }}>
                            <span>{group.title}</span>
                            <span style={{ color: "#8d826b", fontSize: 12 }}>
                              {summaryItems.length > 0 ? summaryItems.join("，") : "未配置奖励"}
                            </span>
                          </div>
                        ),
                        children: (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                              gap: 12,
                            }}
                          >
                            {group.fields.map((bonusField) => (
                              <div key={bonusField.key}>
                                <Text style={{ display: "block", marginBottom: 6 }}>{bonusField.label}</Text>
                                <InputNumber
                                  style={{ width: "100%" }}
                                  disabled={disabled}
                                  value={Number(level.bonuses[bonusField.key] || 0)}
                                  step={bonusField.step || 1}
                                  precision={bonusField.step && bonusField.step < 1 ? 2 : 0}
                                  onChange={(next) => {
                                    const bonuses = {
                                      ...level.bonuses,
                                    };
                                    const parsedValue = toOptionalNumber(next) ?? 0;
                                    if (parsedValue === 0) {
                                      delete bonuses[bonusField.key];
                                    } else {
                                      bonuses[bonusField.key] = parsedValue;
                                    }
                                    setLevel(index, { bonuses });
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        ),
                      };
                    })}
                  />

                  <Space wrap>
                    <Button disabled={disabled || index < 1} onClick={() => moveLevel(index, -1)}>上移</Button>
                    <Button disabled={disabled || index >= visibleLevels.length - 1} onClick={() => moveLevel(index, 1)}>下移</Button>
                    <Button
                      danger
                      disabled={disabled}
                      onClick={() => {
                        updateLevels(visibleLevels.filter((_, currentIndex) => currentIndex !== index));
                      }}
                    >
                      删除层级
                    </Button>
                  </Space>
                </Space>
              ),
            }))}
          />
          <Button
            disabled={disabled}
            onClick={() => {
              updateLevels([...visibleLevels, createDefaultGongfaLevelConfig(visibleLevels.length)]);
            }}
          >
            新增层级
          </Button>
        </Space>
      );
    }
    if (schema.kind === "reward-object") {
      const rewardValue = ensureRewardObject(parsed, allowNegativeRewardValue);
      const rows: JsonRow[] = rewardValue.items.map((item, index) => ({
        ...item,
        __key: `reward-item-${index}`,
      }));

      const updateRows = (nextRows: JsonRow[]) => {
        const nextItems: RewardItem[] = nextRows.map((row) => ({
          itemId: typeof row.itemId === "string" ? row.itemId : "",
          quantity: toOptionalInt(row.quantity) ?? 1,
        }));
        pushRawChange(toRewardRawText({
          ...rewardValue,
          items: nextItems,
        }));
      };

      const columns = buildArrayObjectColumns(
        REWARD_ITEM_FIELDS,
        (rowKey, fieldKey, nextValue) => {
          const nextRows = rows.map((row) => {
            if (row.__key !== rowKey) {
              return row;
            }
            const fieldMeta = REWARD_ITEM_FIELDS.find((f) => f.key === fieldKey);
            const normalized = fieldMeta ? toFieldValue(fieldMeta, nextValue) : nextValue;
            return { ...row, [fieldKey]: normalized };
          });
          updateRows(nextRows);
        },
        (rowKey) => {
          updateRows(rows.filter((row) => row.__key !== rowKey));
        },
        disabled,
        rows,
      );

      return (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Card size="small" title="经验">
            <InputNumber
              style={{ width: "100%" }}
              min={allowNegativeRewardValue ? undefined : 0}
              disabled={disabled}
              value={rewardValue.xp}
              onChange={(next) => {
                pushRawChange(toRewardRawText({
                  ...rewardValue,
                  xp: toOptionalInt(next, allowNegativeRewardValue),
                }));
              }}
            />
          </Card>
          <Card size="small" title="灵石">
            <InputNumber
              style={{ width: "100%" }}
              min={allowNegativeRewardValue ? undefined : 0}
              disabled={disabled}
              value={rewardValue.gold}
              onChange={(next) => {
                pushRawChange(toRewardRawText({
                  ...rewardValue,
                  gold: toOptionalInt(next, allowNegativeRewardValue),
                }));
              }}
            />
          </Card>
          <Card size="small" title="物品奖励">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Table<JsonRow>
                rowKey="__key"
                size="small"
                pagination={false}
                columns={columns}
                dataSource={rows}
              />
              <Button
                disabled={disabled}
                onClick={() => {
                  updateRows([...rows, { __key: `reward-item-${rows.length}`, itemId: "", quantity: 1 }]);
                }}
              >
                新增物品
              </Button>
            </Space>
          </Card>
          <Card size="small" title="气运奖励">
            <Space orientation="vertical" style={{ width: "100%" }}>
              {rewardValue.fortuneIds.map((fortuneId, index) => (
                <Space key={`reward-fortune-${index}`} style={{ width: "100%" }}>
                  <ReferenceSelect
                    entity="fortunes"
                    labelKey="name"
                    value={fortuneId}
                    onChange={(next) => {
                      const nextIds = [...rewardValue.fortuneIds];
                      nextIds[index] = String(next || "").trim();
                      pushRawChange(toRewardRawText({
                        ...rewardValue,
                        fortuneIds: nextIds.filter(Boolean),
                      }));
                    }}
                    disabled={disabled}
                  />
                  <Button
                    danger
                    disabled={disabled}
                    onClick={() => {
                      const nextIds = rewardValue.fortuneIds.filter((_, i) => i !== index);
                      pushRawChange(toRewardRawText({
                        ...rewardValue,
                        fortuneIds: nextIds,
                      }));
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ))}
              <Button
                disabled={disabled}
                onClick={() => {
                  pushRawChange(toRewardRawText({
                    ...rewardValue,
                    fortuneIds: [...rewardValue.fortuneIds, ""],
                  }));
                }}
              >
                新增气运
              </Button>
            </Space>
          </Card>
        </Space>
      );
    }

    if (schema.kind === "event-reward-object") {
      const rewardValue = ensureEventRewardObject(parsed, allowNegativeRewardValue);
      const itemRows: JsonRow[] = rewardValue.items.map((item, index) => ({
        ...item,
        __key: `event-reward-item-${index}`,
      }));
      const actionRows: JsonRow[] = rewardValue.actions.map((action, index) => ({
        ...action,
        __key: `event-reward-action-${index}`,
      }));
      const eventRewardActionFields = buildEventRewardActionFields(eventRewardActionTypeOptions);

      const updateItemRows = (nextRows: JsonRow[]) => {
        const nextItems: RewardItem[] = nextRows.map((row) => ({
          itemId: typeof row.itemId === "string" ? row.itemId : "",
          quantity: toOptionalInt(row.quantity) ?? 1,
        }));
        pushRawChange(toEventRewardRawText({
          ...rewardValue,
          items: nextItems,
        }));
      };

      const updateActionRows = (nextRows: JsonRow[]) => {
        const nextActions: EventRewardAction[] = nextRows.map((row) => ({
          type: typeof row.type === "string" ? row.type.trim() : "",
          targetVar: typeof row.targetVar === "string" ? row.targetVar.trim() : "",
          monsterId: typeof row.monsterId === "string" ? row.monsterId.trim() : "",
          mapId: typeof row.mapId === "string" ? row.mapId.trim() : "",
        })).filter((row) => !!row.type);
        pushRawChange(toEventRewardRawText({
          ...rewardValue,
          actions: nextActions,
        }));
      };

      const itemColumns = buildArrayObjectColumns(
        REWARD_ITEM_FIELDS,
        (rowKey, fieldKey, nextValue) => {
          const nextRows = itemRows.map((row) => {
            if (row.__key !== rowKey) {
              return row;
            }
            const fieldMeta = REWARD_ITEM_FIELDS.find((f) => f.key === fieldKey);
            const normalized = fieldMeta ? toFieldValue(fieldMeta, nextValue) : nextValue;
            return { ...row, [fieldKey]: normalized };
          });
          updateItemRows(nextRows);
        },
        (rowKey) => {
          updateItemRows(itemRows.filter((row) => row.__key !== rowKey));
        },
        disabled,
        itemRows,
      );

      const actionColumns = buildArrayObjectColumns(
        eventRewardActionFields,
        (rowKey, fieldKey, nextValue) => {
          const nextRows = actionRows.map((row) => {
            if (row.__key !== rowKey) {
              return row;
            }
            const fieldMeta = eventRewardActionFields.find((f) => f.key === fieldKey);
            const normalized = fieldMeta ? toFieldValue(fieldMeta, nextValue) : nextValue;
            return stripInactiveRelationFields({ ...row, [fieldKey]: normalized }, eventRewardActionFields);
          });
          updateActionRows(nextRows);
        },
        (rowKey) => {
          updateActionRows(actionRows.filter((row) => row.__key !== rowKey));
        },
        disabled,
        actionRows,
      );

      return (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Card size="small" title="经验">
            <InputNumber
              style={{ width: "100%" }}
              min={allowNegativeRewardValue ? undefined : 0}
              disabled={disabled}
              value={rewardValue.xp}
              onChange={(next) => {
                pushRawChange(toEventRewardRawText({
                  ...rewardValue,
                  xp: toOptionalInt(next, allowNegativeRewardValue),
                }));
              }}
            />
          </Card>
          <Card size="small" title="灵石">
            <InputNumber
              style={{ width: "100%" }}
              min={allowNegativeRewardValue ? undefined : 0}
              disabled={disabled}
              value={rewardValue.gold}
              onChange={(next) => {
                pushRawChange(toEventRewardRawText({
                  ...rewardValue,
                  gold: toOptionalInt(next, allowNegativeRewardValue),
                }));
              }}
            />
          </Card>
          <Card size="small" title="物品奖励">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Table<JsonRow>
                rowKey="__key"
                size="small"
                pagination={false}
                columns={itemColumns}
                dataSource={itemRows}
              />
              <Button
                disabled={disabled}
                onClick={() => {
                  updateItemRows([...itemRows, { __key: `event-reward-item-${itemRows.length}`, itemId: "", quantity: 1 }]);
                }}
              >
                新增物品
              </Button>
            </Space>
          </Card>
          <Card size="small" title="触发动作">
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Table<JsonRow>
                rowKey="__key"
                size="small"
                pagination={false}
                columns={actionColumns}
                dataSource={actionRows}
              />
              <Button
                disabled={disabled || eventRewardActionTypeOptions.length < 1}
                onClick={() => {
                  const defaultActionType = eventRewardActionTypeOptions[0]?.value || "";
                  if (!defaultActionType) {
                    return;
                  }
                  updateActionRows([
                    ...actionRows,
                    {
                      __key: `event-reward-action-${actionRows.length}`,
                      type: defaultActionType,
                      targetVar: "",
                      monsterId: "",
                      mapId: "",
                    },
                  ]);
                }}
              >
                新增动作
              </Button>
              {eventRewardActionTypeOptions.length < 1 && (
                <Text style={{ color: "#6b6355", fontSize: 12 }}>
                  当前没有可用动作类型。
                </Text>
              )}
            </Space>
          </Card>
          <Card size="small" title="气运奖励">
            <Space orientation="vertical" style={{ width: "100%" }}>
              {rewardValue.fortuneIds.map((fortuneId, index) => (
                <Space key={`event-reward-fortune-${index}`} style={{ width: "100%" }}>
                  <ReferenceSelect
                    entity="fortunes"
                    labelKey="name"
                    value={fortuneId}
                    onChange={(next) => {
                      const nextIds = [...rewardValue.fortuneIds];
                      nextIds[index] = String(next || "").trim();
                      pushRawChange(toEventRewardRawText({
                        ...rewardValue,
                        fortuneIds: nextIds.filter(Boolean),
                      }));
                    }}
                    disabled={disabled}
                  />
                  <Button
                    danger
                    disabled={disabled}
                    onClick={() => {
                      const nextIds = rewardValue.fortuneIds.filter((_, i) => i !== index);
                      pushRawChange(toEventRewardRawText({
                        ...rewardValue,
                        fortuneIds: nextIds,
                      }));
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ))}
              <Button
                disabled={disabled}
                onClick={() => {
                  pushRawChange(toEventRewardRawText({
                    ...rewardValue,
                    fortuneIds: [...rewardValue.fortuneIds, ""],
                  }));
                }}
              >
                新增气运
              </Button>
            </Space>
          </Card>
          <Card size="small" title="气运惩罚">
            <Space orientation="vertical" style={{ width: "100%" }}>
              {rewardValue.removeFortuneIds.map((fortuneId, index) => (
                <Space key={`event-reward-remove-fortune-${index}`} style={{ width: "100%" }}>
                  <ReferenceSelect
                    entity="fortunes"
                    labelKey="name"
                    value={fortuneId}
                    onChange={(next) => {
                      const nextIds = [...rewardValue.removeFortuneIds];
                      nextIds[index] = String(next || "").trim();
                      pushRawChange(toEventRewardRawText({
                        ...rewardValue,
                        removeFortuneIds: nextIds.filter(Boolean),
                      }));
                    }}
                    disabled={disabled}
                  />
                  <Button
                    danger
                    disabled={disabled}
                    onClick={() => {
                      const nextIds = rewardValue.removeFortuneIds.filter((_, i) => i !== index);
                      pushRawChange(toEventRewardRawText({
                        ...rewardValue,
                        removeFortuneIds: nextIds,
                      }));
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ))}
              <Button
                disabled={disabled}
                onClick={() => {
                  pushRawChange(toEventRewardRawText({
                    ...rewardValue,
                    removeFortuneIds: [...rewardValue.removeFortuneIds, ""],
                  }));
                }}
              >
                新增惩罚气运
              </Button>
            </Space>
          </Card>
        </Space>
      );
    }

    const fields = schema.fields || [];
    const rows = ensureArrayObject(parsed);
    const columns = buildArrayObjectColumns(
      fields,
      (rowKey, fieldKey, nextValue, meta) => {
        const nextRows = rows.map((row) => {
          if (row.__key !== rowKey) {
            return row;
          }
          const fieldMeta = fields.find((f) => f.key === fieldKey);
          const normalized = fieldMeta ? toFieldValue(fieldMeta, nextValue) : nextValue;
          let nextRow: JsonRow = { ...row, [fieldKey]: normalized };
          if (fieldMeta?.syncLabelTo && meta?.optionRawLabel) {
            nextRow[fieldMeta.syncLabelTo] = meta.optionRawLabel;
          }
          if (field.key === "requirements") {
            nextRow = normalizeQuestRequirementRow(nextRow);
          }
          return stripInactiveRelationFields(nextRow, fields);
        });
        const pure = nextRows.map(stripRowKey);
        pushRawChange(toRawText(pure));
      },
      (rowKey) => {
        const nextRows = rows.filter((row) => row.__key !== rowKey).map(stripRowKey);
        pushRawChange(toRawText(nextRows));
      },
      disabled,
      rows,
      { parentFieldKey: field.key, realmOptions },
    );

    return (
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Table<JsonRow>
          rowKey="__key"
          size="small"
          pagination={false}
          columns={columns}
          dataSource={rows}
        />
        <Button
          disabled={disabled}
          onClick={() => {
            const initial: Record<string, unknown> = {};
            fields.forEach((f) => {
              if (f.visibleWhenRelationMatched) {
                return;
              }
              if (f.type === "boolean") {
                initial[f.key] = false;
              } else if (f.type === "number") {
                initial[f.key] = 0;
              } else {
                initial[f.key] = "";
              }
            });
            if (field.key === "requirements") {
              initial.quantity = 1;
            }
            const pure = [...rows.map(stripRowKey), initial];
            pushRawChange(toRawText(pure));
          }}
        >
          新增{schema.itemLabel || "条目"}
        </Button>
      </Space>
    );
  }, [
    schema,
    parsed,
    disabled,
    pushRawChange,
    field.key,
    realmOptions,
    allowNegativeRewardValue,
    contextGongfaType,
    eventRewardActionTypeOptions,
    eventJudgeDefinitions,
    eventJudgePluginOptions,
    newEventJudgePluginId,
  ]);

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {schema && (
        <Space>
          <Button
            size="small"
            type={mode === "visual" ? "primary" : "default"}
            onClick={() => setMode("visual")}
          >
            可视化
          </Button>
          <Button
            size="small"
            type={mode === "raw" ? "primary" : "default"}
            onClick={() => setMode("raw")}
          >
            原始JSON
          </Button>
          {parseError && <DarkTag color="red">JSON格式错误</DarkTag>}
        </Space>
      )}

      {!schema || mode === "raw" ? (
        <JsonRawEditor
          raw={rawText}
          disabled={disabled}
          placeholder={field.placeholder}
          onRawChange={pushRawChange}
        />
      ) : (
        visualContent
      )}

      {parseError && mode === "raw" && (
        <Text type="danger">{parseError}</Text>
      )}
    </Space>
  );
}

