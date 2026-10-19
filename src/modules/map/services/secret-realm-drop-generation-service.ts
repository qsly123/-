import { randomUUID } from "crypto";
import { readdir } from "fs/promises";
import path from "path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { getFourRealmsPack } from "@/db/offline-packs/four-realms-pack";
import {
  items,
  mapInstanceMonsters,
  mapInstances,
  playerInventory,
  players,
  secretRealmRewardClaims,
  secretRealmRuns,
  secretRealmTemplates,
  temporaryMaps,
  temporaryMonsters,
} from "@/db/schema";
import {
  buildFallbackEquipmentFlavor,
  type WorldFlavorAttributeConstraint,
} from "@/modules/ai/services/world-flavor-generation";
import { publishTiandaoDualChannelAnnouncement } from "@/modules/chat/services/chat-service";
import { ensurePlayerInventoryIntegrity } from "@/modules/character/services/player-inventory-integrity";
import { insertItemCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { supportsMapInstanceMonsterLootBlueprint } from "@/modules/map/services/map-instance-monster-schema-compat";
import {
  HONGMENG_BOTTLE_ITEM_ID,
  getWildWolfValleyBottleChance,
  isWildWolfValleyRealm,
} from "@/modules/map/services/secret-realm-specials";
import {
  recordSecretRealmBossGateMonsterDefeat,
  unlockSecretRealmBossGateDoors,
} from "@/modules/map/services/secret-realm-boss-gate-service";
import {
  clampSecretRealmEntryRarityByRole,
  sanitizeSecretRealmLootBlueprintByRole,
} from "@/modules/map/services/secret-realm-loot-rarity";
import { buildSecretRealmThemeProfile } from "@/modules/map/services/secret-realm-theme-profile-service";
import { advanceMapSceneTick } from "@/modules/map/services/map-scene-sync";
import { publishMapRefresh } from "@/modules/map/services/map-presence";
import {
  buildUploadsPublicUrl,
  getExistingUploadRoots,
  UPLOADS_ROOT_CANDIDATES,
} from "@/modules/shared/services/upload-storage";
import { clearMonsterAiRuntimeForMonsters } from "@/modules/map/services/monster-ai";
import type {
  CombatRewardDrop,
  ItemEffect,
  ItemRarity,
  SecretRealmAlchemyRoute,
  SecretRealmBossPitySnapshot,
  SecretRealmDropStageKey,
  SecretRealmElement,
  SecretRealmEquipmentRoute,
  SecretRealmHongmengPitySnapshot,
  SecretRealmLootBlueprint,
  SecretRealmLootBlueprintEntry,
  SecretRealmLootCategory,
  SecretRealmMonsterRole,
  SecretRealmRewardRoleConfig,
  SecretRealmRewardPlan,
  SecretRealmRewardSnapshot,
  SecretRealmRunSummary,
  SecretRealmSeedThemeTag,
} from "@/types/game";

type RewardTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RewardContext = {
  instanceId: string;
  mapId: string;
  runId: string | null;
  monsterId: string;
  monsterName: string;
  monsterDescription: string | null;
  role: SecretRealmMonsterRole;
  monsterStatus: string;
  rewardPlan: SecretRealmRewardPlan | null;
  lootBlueprint: SecretRealmLootBlueprint | null;
  recommendedRealm: number;
  instanceRarity: string;
  theme: string;
  templateName: string;
  templateTags: string[];
  isWildWolfValley: boolean;
  supportsLootBlueprintPersistence: boolean;
};

type EquipmentTemplate = {
  routeLabel: string;
  itemType: "weapon" | "armor" | "helmet" | "shoes" | "artifact";
  iconDirectory: string;
  themeTags: string[];
  baseEffects: (scalar: number) => ItemEffect[];
  allowedAttributes: (scalar: number) => WorldFlavorAttributeConstraint[];
};

type SeedTemplate = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  rarity: string | null;
  minRealm: number | null;
  maxRealm: number | null;
  seedName: string | null;
  dropThemeTags: SecretRealmSeedThemeTag[];
  secretRealmWeight: number;
};

type ExistingMaterialTemplate = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  rarity: string | null;
  minRealm: number | null;
  maxRealm: number | null;
  itemType: string;
  sourceType: string | null;
  isBound: boolean;
};

type RewardResult = {
  isSecretRealm: boolean;
  reusedClaim: boolean;
  xp: number;
  gold: number;
  drops: CombatRewardDrop[];
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  grantedItemIds: string[];
};

type DatabaseErrorLike = {
  code?: unknown;
  cause?: unknown;
  query?: unknown;
  message?: unknown;
};

const FILE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const CACHE_TTL_MS = 60 * 1000;
const SECRET_REALM_ELEMENTS: SecretRealmElement[] = ["metal", "wood", "water", "fire", "earth"];
const SECRET_REALM_DROP_STAGE_KEYS = ["lianqi", "zhuji", "jiedan", "yuanying", "huashen"] as const satisfies SecretRealmDropStageKey[];
type SecretRealmDropStageKeyValue = (typeof SECRET_REALM_DROP_STAGE_KEYS)[number];
type SecretRealmStageKey = "lianqi" | "zhuji" | "jiedan" | "yuanying";
const ALCHEMY_ROUTES: SecretRealmAlchemyRoute[] = ["cultivation", "breakthrough", "recovery", "spirit"];
const BOSS_PITY_BASE_CHANCE = 0.05;
const BOSS_PITY_STEP_CHANCE = 0.05;
const BOSS_PITY_HARD_GUARANTEE_ATTEMPT = 20;
const BOSS_PITY_MAX_COUNTER = BOSS_PITY_HARD_GUARANTEE_ATTEMPT - 1;
const BOSS_PITY_MATERIAL_CATEGORIES = ["alchemy_material", "smithing_material"] as const satisfies SecretRealmLootCategory[];
const HONGMENG_PITY_BASE_CHANCE = 0.01;
const HONGMENG_PITY_STEP_CHANCE = 0.01;
const HONGMENG_PITY_HARD_GUARANTEE_ATTEMPT = 70;
const HONGMENG_PITY_MAX_COUNTER = HONGMENG_PITY_HARD_GUARANTEE_ATTEMPT - 1;
const HONGMENG_PITY_MATERIAL_CATEGORIES = ["alchemy_material", "smithing_material"] as const satisfies SecretRealmLootCategory[];
const BOSS_NATURAL_HONGMENG_DROP_CHANCE = 0.005;
const CATEGORY_LABELS: Record<SecretRealmLootCategory, string> = {
  existing_material: "正式灵材",
  alchemy_material: "秘境丹材",
  smithing_material: "秘境器材",
  herb_seed: "灵植种子",
  equipment: "秘境装备",
};
const ALCHEMY_ROUTE_LABELS: Record<SecretRealmAlchemyRoute, string> = {
  cultivation: "修为丹材",
  breakthrough: "破境丹材",
  recovery: "回元丹材",
  spirit: "养神丹材",
};
const MATERIAL_DIRECTORIES = {
  alchemy_material: {
    metal: "ai-alchemy/material-metal",
    wood: "ai-alchemy/material-wood",
    water: "ai-alchemy/material-water",
    fire: "ai-alchemy/material-fire",
    earth: "ai-alchemy/material-earth",
  },
  smithing_material: {
    metal: "ai-smithing/material-metal",
    wood: "ai-smithing/material-wood",
    water: "ai-smithing/material-water",
    fire: "ai-smithing/material-fire",
    earth: "ai-smithing/material-earth",
  },
} as const;
const ELEMENT_WORDS: Record<SecretRealmElement, string[]> = {
  metal: ["庚金", "碎锋", "铜魄", "寒晶"],
  wood: ["灵枝", "藤魄", "青芝", "木华"],
  water: ["寒露", "潮魄", "玄泉", "凝霜"],
  fire: ["炎砂", "赤焰", "火髓", "炽晶"],
  earth: ["岩髓", "土魄", "厚晶", "壤砂"],
};
const MATERIAL_SUFFIXES = {
  alchemy_material: ["露", "芝", "果", "草", "砂"],
  smithing_material: ["铁", "晶", "砂", "髓", "骨"],
} as const;
const SECRET_REALM_LOOT_CATEGORY_FALLBACKS: Record<SecretRealmLootCategory, SecretRealmLootCategory[]> = {
  existing_material: ["alchemy_material", "smithing_material", "herb_seed"],
  alchemy_material: ["smithing_material", "existing_material", "herb_seed", "equipment"],
  smithing_material: ["alchemy_material", "existing_material", "herb_seed", "equipment"],
  herb_seed: ["existing_material", "alchemy_material", "smithing_material", "equipment"],
  equipment: ["smithing_material", "alchemy_material", "existing_material"],
};
const SECRET_REALM_STAGE_MIN_REALM: Record<SecretRealmStageKey, number> = {
  lianqi: 1,
  zhuji: 13,
  jiedan: 17,
  yuanying: 21,
};
const SECRET_REALM_DROP_STAGE_MIN_REALM: Record<SecretRealmDropStageKey, number> = {
  lianqi: 1,
  zhuji: 13,
  jiedan: 17,
  yuanying: 21,
  huashen: 25,
};
const SECRET_REALM_DROP_STAGE_MAX_REALM: Record<SecretRealmDropStageKey, number | null> = {
  lianqi: 12,
  zhuji: 16,
  jiedan: 20,
  yuanying: 24,
  huashen: null,
};
const SECRET_REALM_DROP_STAGE_SCALAR: Record<SecretRealmDropStageKey, number> = {
  lianqi: 1,
  zhuji: 2,
  jiedan: 3,
  yuanying: 4,
  huashen: 5,
};
const SECRET_REALM_STAGE_MATERIAL_COUNTS: Record<SecretRealmStageKey, number> = {
  lianqi: 9,
  zhuji: 9,
  jiedan: 9,
  yuanying: 10,
};
const SECRET_REALM_STAGE_ELEMENTAL_START_INDEX: Record<SecretRealmStageKey, number> = {
  lianqi: 4,
  zhuji: 4,
  jiedan: 4,
  yuanying: 5,
};
const BUILTIN_SPIRITUAL_FIELD_SEEDS = getFourRealmsPack().spiritualFieldSeeds;
const EQUIPMENT_ROUTES = ["sword", "blade", "needle", "robe", "helmet", "boots", "talisman", "shield", "focus"] as const satisfies SecretRealmEquipmentRoute[];
type GeneratedEquipmentRoute = (typeof EQUIPMENT_ROUTES)[number];
const EQUIPMENT_TEMPLATES: Record<GeneratedEquipmentRoute, EquipmentTemplate> = {
  sword: {
    routeLabel: "剑",
    itemType: "weapon",
    iconDirectory: "ai-smithing/sword",
    themeTags: ["剑修", "灵锋", "破敌"],
    baseEffects: (scalar) => [{ type: "boost_atk", value: 6 * scalar }, { type: "boost_armor_penetration", value: Math.max(1, scalar - 1 || 1) }],
    allowedAttributes: (scalar) => [
      { key: "boost_atk", label: "攻击", min: 2 * scalar, max: 4 * scalar, preferred: 3 * scalar },
      { key: "boost_armor_penetration", label: "破防", min: 1, max: Math.max(1, scalar), preferred: 1 },
      { key: "boost_skill_damage_bonus", label: "神通增伤", min: 1, max: Math.max(1, scalar), preferred: 1, rare: true },
    ],
  },
  blade: {
    routeLabel: "刀",
    itemType: "weapon",
    iconDirectory: "ai-smithing/blade",
    themeTags: ["刀修", "破阵", "煞锋"],
    baseEffects: (scalar) => [{ type: "boost_atk", value: 7 * scalar }, { type: "boost_armor_penetration", value: Math.max(1, scalar) }],
    allowedAttributes: (scalar) => [
      { key: "boost_atk", label: "攻击", min: 2 * scalar, max: 4 * scalar, preferred: 3 * scalar },
      { key: "boost_armor_penetration", label: "破防", min: 1, max: Math.max(1, scalar + 1), preferred: 1, rare: true },
      { key: "boost_speed", label: "速度", min: 1, max: Math.max(1, scalar), preferred: 1 },
    ],
  },
  needle: {
    routeLabel: "针",
    itemType: "weapon",
    iconDirectory: "ai-smithing/needle",
    themeTags: ["针修", "迅杀", "灵刺"],
    baseEffects: (scalar) => [{ type: "boost_atk", value: 6 * scalar }, { type: "boost_speed", value: 2 * scalar }, { type: "boost_armor_penetration", value: Math.max(1, scalar - 1 || 1) }],
    allowedAttributes: (scalar) => [
      { key: "boost_speed", label: "速度", min: scalar, max: 2 * scalar, preferred: scalar + 1 },
      { key: "boost_atk", label: "攻击", min: scalar + 1, max: 3 * scalar, preferred: 2 * scalar },
      { key: "boost_armor_penetration", label: "破防", min: 1, max: Math.max(1, scalar), preferred: 1, rare: true },
    ],
  },
  robe: {
    routeLabel: "法衣",
    itemType: "armor",
    iconDirectory: "ai-smithing/armor-robe",
    themeTags: ["法衣", "护体", "稳守"],
    baseEffects: (scalar) => [{ type: "boost_hp", value: 28 * scalar }, { type: "boost_def", value: 4 * scalar }],
    allowedAttributes: (scalar) => [
      { key: "boost_hp", label: "气血", min: 12 * scalar, max: 20 * scalar, preferred: 16 * scalar },
      { key: "boost_def", label: "防御", min: scalar, max: 2 * scalar, preferred: scalar + 1 },
      { key: "boost_skill_damage_reduction", label: "神通减伤", min: 1, max: Math.max(1, scalar), preferred: 1, rare: true },
    ],
  },
  helmet: {
    routeLabel: "灵冠",
    itemType: "helmet",
    iconDirectory: "ai-smithing/armor-helmet",
    themeTags: ["灵冠", "护念", "凝神"],
    baseEffects: (scalar) => [{ type: "boost_def", value: 3 * scalar }, { type: "boost_mp", value: 10 * scalar }, { type: "boost_skill_damage_reduction", value: Math.max(1, scalar - 1 || 1) }],
    allowedAttributes: (scalar) => [
      { key: "boost_mp", label: "灵力", min: 8 * scalar, max: 12 * scalar, preferred: 10 * scalar },
      { key: "boost_def", label: "防御", min: scalar, max: 2 * scalar, preferred: scalar + 1 },
      { key: "boost_skill_damage_bonus", label: "神通增伤", min: 1, max: Math.max(1, scalar), preferred: 1, rare: true },
    ],
  },
  boots: {
    routeLabel: "步履",
    itemType: "shoes",
    iconDirectory: "ai-smithing/armor-boots",
    themeTags: ["轻身", "游斗", "踏风"],
    baseEffects: (scalar) => [{ type: "boost_speed", value: 2 * scalar }, { type: "boost_hp", value: 16 * scalar }],
    allowedAttributes: (scalar) => [
      { key: "boost_speed", label: "速度", min: scalar, max: 2 * scalar, preferred: scalar + 1 },
      { key: "boost_hp", label: "气血", min: 8 * scalar, max: 14 * scalar, preferred: 10 * scalar },
      { key: "boost_luck", label: "气运", min: 1, max: Math.max(1, scalar), preferred: 1, rare: true },
    ],
  },
  talisman: {
    routeLabel: "符器",
    itemType: "artifact",
    iconDirectory: "ai-smithing/talisman",
    themeTags: ["符器", "术法", "聚灵"],
    baseEffects: (scalar) => [{ type: "boost_skill_damage_bonus", value: Math.max(1, scalar) }, { type: "boost_mp", value: 14 * scalar }],
    allowedAttributes: (scalar) => [
      { key: "boost_skill_damage_bonus", label: "神通增伤", min: 1, max: Math.max(1, scalar + 1), preferred: Math.max(1, scalar), rare: true },
      { key: "boost_mp", label: "灵力", min: 8 * scalar, max: 14 * scalar, preferred: 10 * scalar },
      { key: "boost_skill_damage_reduction", label: "神通减伤", min: 1, max: Math.max(1, scalar), preferred: 1 },
    ],
  },
  focus: {
    routeLabel: "法修器",
    itemType: "weapon",
    iconDirectory: "ai-smithing/focus",
    themeTags: ["法修器", "聚灵", "破阵"],
    baseEffects: (scalar) => [{ type: "boost_atk", value: 5 * scalar }, { type: "boost_mp", value: 10 * scalar }, { type: "boost_skill_damage_bonus", value: Math.max(1, scalar - 1 || 1) }],
    allowedAttributes: (scalar) => [
      { key: "boost_skill_damage_bonus", label: "神通增伤", min: 1, max: Math.max(1, scalar), preferred: 1, rare: true },
      { key: "boost_mp", label: "灵力", min: 8 * scalar, max: 12 * scalar, preferred: 10 * scalar },
      { key: "boost_armor_penetration", label: "破防", min: 1, max: Math.max(1, scalar), preferred: 1 },
    ],
  },
  shield: {
    routeLabel: "盾器",
    itemType: "artifact",
    iconDirectory: "ai-smithing/shield",
    themeTags: ["承压", "壁垒", "厚守"],
    baseEffects: (scalar) => [{ type: "boost_def", value: 4 * scalar }, { type: "boost_block", value: Math.max(1, scalar) }],
    allowedAttributes: (scalar) => [
      { key: "boost_def", label: "防御", min: scalar + 1, max: 3 * scalar, preferred: 2 * scalar },
      { key: "boost_block", label: "格挡", min: 1, max: Math.max(1, scalar + 1), preferred: 1, rare: true },
      { key: "boost_hp", label: "气血", min: 8 * scalar, max: 14 * scalar, preferred: 10 * scalar },
    ],
  },
};

let iconCache:
  | {
      expiresAt: number;
      pools: Record<string, string[]>;
    }
  | null = null;
let iconCachePromise: Promise<Record<string, string[]>> | null = null;
const secretRealmRewardWarnCache = new Map<string, number>();
let existingMaterialTemplateCache:
  | {
      expiresAt: number;
      templates: ExistingMaterialTemplate[];
    }
  | null = null;
let existingMaterialTemplateCachePromise: Promise<ExistingMaterialTemplate[]> | null = null;

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string, maxLength: number, fallback: string) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, maxLength);
}

function seedToNumber(seed: string) {
  return Array.from(seed).reduce((acc, char, index) => {
    return (acc + char.charCodeAt(0) * (index + 31)) % 2147483647;
  }, 0);
}

function seededRandom(seed: string) {
  const value = Math.sin(seedToNumber(seed) + 1) * 10000;
  return value - Math.floor(value);
}

function pickFromSeed<T>(seed: string, values: readonly T[]): T {
  if (values.length === 0) {
    throw new Error("随机池为空");
  }
  return values[Math.floor(seededRandom(seed) * values.length)] as T;
}

function weightedPick<T extends string>(seed: string, weights: Partial<Record<T, number>>, fallback: T) {
  const entries = Object.entries(weights)
    .map(([key, value]) => [key as T, Math.max(0, Number(value || 0))] as const)
    .filter((entry) => entry[1] > 0);
  if (entries.length === 0) {
    return fallback;
  }
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  let cursor = seededRandom(seed) * total;
  for (const [key, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) {
      return key;
    }
  }
  return entries[entries.length - 1]?.[0] || fallback;
}

function dedupe<T>(values: T[]) {
  return Array.from(new Set(values));
}

function warnSecretRealmRewardOnce(key: string, payload: Record<string, unknown>) {
  const now = Date.now();
  const lastWarnedAt = secretRealmRewardWarnCache.get(key) || 0;
  if (lastWarnedAt > 0 && (now - lastWarnedAt) < CACHE_TTL_MS) {
    return;
  }
  secretRealmRewardWarnCache.set(key, now);
  console.warn(payload.message || "Secret realm reward warning", payload);
}

function unwrapDatabaseError(error: unknown): DatabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const typed = error as DatabaseErrorLike;
  if (typeof typed.code === "string" || typeof typed.query === "string" || typeof typed.message === "string") {
    return typed;
  }
  return unwrapDatabaseError(typed.cause);
}

function isDatabaseExecutionError(error: unknown) {
  const dbError = unwrapDatabaseError(error);
  if (!dbError) {
    return false;
  }
  if (typeof dbError.code === "string") {
    return true;
  }
  if (typeof dbError.query === "string") {
    return true;
  }
  return typeof dbError.message === "string" && dbError.message.includes("Failed query:");
}

function normalizeRarity(value: unknown): ItemRarity {
  if (value === "hongmeng" || value === "legendary" || value === "epic" || value === "rare" || value === "uncommon" || value === "common") {
    return value;
  }
  return "common";
}

function getRarityRank(rarity: string | null | undefined) {
  switch (normalizeRarity(rarity)) {
    case "hongmeng":
      return 6;
    case "legendary":
      return 5;
    case "epic":
      return 4;
    case "rare":
      return 3;
    case "uncommon":
      return 2;
    default:
      return 1;
  }
}

function isMaterialDropAtLeastRarity(drop: CombatRewardDrop, targetRarity: ItemRarity) {
  return getRarityRank(drop.itemRarity) >= getRarityRank(targetRarity)
    && (drop.itemCategoryLabel === CATEGORY_LABELS.existing_material
      || drop.itemCategoryLabel === CATEGORY_LABELS.alchemy_material
      || drop.itemCategoryLabel === CATEGORY_LABELS.smithing_material);
}

function canGrantBossLegendaryPity(role: SecretRealmMonsterRole) {
  return role === "boss";
}

function canGrantBossHongmengDrops(role: SecretRealmMonsterRole) {
  return role === "boss";
}

function boostBossRarityWeights(rarityWeights: Partial<Record<ItemRarity, number>>) {
  return {
    common: 0,
    uncommon: 0,
    rare: Math.max(1, Math.round(Number(rarityWeights.rare || 0) * 1.1)),
    epic: Math.max(1, Math.round(Number(rarityWeights.epic || 0) * 1.2)),
    legendary: Math.max(0, Math.round(Number(rarityWeights.legendary || 0) * 1.2)),
    hongmeng: 0,
  } satisfies Partial<Record<ItemRarity, number>>;
}

function getBossPityAttempt(counter: number | null | undefined) {
  return clampNumber(Math.floor(Number(counter || 0)) + 1, 1, BOSS_PITY_HARD_GUARANTEE_ATTEMPT);
}

function getBossPityChance(attempt: number) {
  return clampNumber(
    BOSS_PITY_BASE_CHANCE + Math.max(0, attempt - 1) * BOSS_PITY_STEP_CHANCE,
    BOSS_PITY_BASE_CHANCE,
    1,
  );
}

function getBossPityTargetRarity(attempt: number): ItemRarity {
  void attempt;
  return "legendary";
}

function getHongmengPityAttempt(counter: number | null | undefined) {
  return clampNumber(Math.floor(Number(counter || 0)) + 1, 1, HONGMENG_PITY_HARD_GUARANTEE_ATTEMPT);
}

function getHongmengPityChance(attempt: number) {
  return clampNumber(
    HONGMENG_PITY_BASE_CHANCE + Math.max(0, attempt - 1) * HONGMENG_PITY_STEP_CHANCE,
    HONGMENG_PITY_BASE_CHANCE,
    1,
  );
}

function mergeEffects(effects: ItemEffect[]) {
  const merged = new Map<string, ItemEffect>();
  for (const effect of effects) {
    const key = effect.type === "bind_skill" ? `bind:${effect.skillId || ""}` : effect.type;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...effect });
      continue;
    }
    merged.set(key, { ...previous, value: Number(previous.value || 0) + Number(effect.value || 0) });
  }
  return Array.from(merged.values());
}

function resolveSecretRealmDropStageKey(recommendedRealm: number): SecretRealmDropStageKey {
  if (recommendedRealm >= SECRET_REALM_DROP_STAGE_MIN_REALM.huashen) {
    return "huashen";
  }
  if (recommendedRealm >= SECRET_REALM_STAGE_MIN_REALM.yuanying) {
    return "yuanying";
  }
  if (recommendedRealm >= SECRET_REALM_STAGE_MIN_REALM.jiedan) {
    return "jiedan";
  }
  if (recommendedRealm >= SECRET_REALM_STAGE_MIN_REALM.zhuji) {
    return "zhuji";
  }
  return "lianqi";
}

function clampFormalStageKey(stageKey: SecretRealmDropStageKey | null | undefined): SecretRealmStageKey {
  if (stageKey === "huashen") {
    return "yuanying";
  }
  if (stageKey === "yuanying" || stageKey === "jiedan" || stageKey === "zhuji" || stageKey === "lianqi") {
    return stageKey;
  }
  return "lianqi";
}

function getDropStageProfile(stageKey: SecretRealmDropStageKey | null | undefined) {
  const resolvedStageKey = stageKey && SECRET_REALM_DROP_STAGE_KEYS.includes(stageKey)
    ? stageKey
    : "lianqi";
  return {
    key: resolvedStageKey,
    label: buildRealmLabel(SECRET_REALM_DROP_STAGE_MIN_REALM[resolvedStageKey]),
    minRealm: SECRET_REALM_DROP_STAGE_MIN_REALM[resolvedStageKey],
    maxRealm: SECRET_REALM_DROP_STAGE_MAX_REALM[resolvedStageKey],
    scalar: SECRET_REALM_DROP_STAGE_SCALAR[resolvedStageKey],
    formalStageKey: clampFormalStageKey(resolvedStageKey),
  };
}

function getNextDropStageKey(stageKey: SecretRealmDropStageKey) {
  const index = SECRET_REALM_DROP_STAGE_KEYS.indexOf(stageKey);
  if (index < 0 || index >= SECRET_REALM_DROP_STAGE_KEYS.length - 1) {
    return null;
  }
  return SECRET_REALM_DROP_STAGE_KEYS[index + 1] || null;
}

function resolveDropStageAdvanceChance(params: {
  role: SecretRealmMonsterRole;
  rarity: ItemRarity;
}) {
  const baseChance = params.role === "boss"
    ? 0.18
    : params.role === "elite"
      ? 0.12
      : 0.08;
  if (params.rarity === "hongmeng") {
    return Math.min(0.45, baseChance + 0.18);
  }
  if (params.rarity === "legendary") {
    return Math.min(0.32, baseChance + 0.1);
  }
  if (params.rarity === "epic") {
    return Math.min(0.24, baseChance + 0.05);
  }
  return baseChance;
}

function pickDropStageKey(params: {
  recommendedRealm: number;
  role: SecretRealmMonsterRole;
  rarity: ItemRarity;
  seed: string;
}) {
  const currentStageKey = resolveSecretRealmDropStageKey(params.recommendedRealm);
  const nextStageKey = getNextDropStageKey(currentStageKey);
  if (!nextStageKey) {
    return currentStageKey;
  }
  const advanceChance = resolveDropStageAdvanceChance({
    role: params.role,
    rarity: params.rarity,
  });
  return seededRandom(`${params.seed}:drop-stage`) < advanceChance
    ? nextStageKey
    : currentStageKey;
}

function matchesDropStageRange(params: {
  minRealm: number | null | undefined;
  maxRealm: number | null | undefined;
  dropStageKey: SecretRealmDropStageKey | null | undefined;
  recommendedRealm: number;
}) {
  const stageProfile = getDropStageProfile(params.dropStageKey || resolveSecretRealmDropStageKey(params.recommendedRealm));
  const targetMin = stageProfile.minRealm;
  const targetMax = stageProfile.maxRealm;
  const itemMin = params.minRealm ?? targetMin;
  const itemMax = params.maxRealm ?? targetMax;

  if (targetMax === null) {
    return itemMax === null || itemMax >= targetMin;
  }
  if (itemMax === null) {
    return itemMin <= targetMax;
  }
  return itemMin <= targetMax && itemMax >= targetMin;
}

function buildStageItemId(stage: SecretRealmDropStageKeyValue, kind: string) {
  return `item_four_realms_${stage}_${kind}`;
}

function buildStageMaterialIds(stage: SecretRealmDropStageKeyValue) {
  const materialCount = stage === "huashen" ? 11 : SECRET_REALM_STAGE_MATERIAL_COUNTS[stage];
  return Array.from({ length: materialCount }, (_, index) => buildStageItemId(stage, `material_${index + 1}`));
}

function buildStageSeedItemId(stage: SecretRealmDropStageKeyValue) {
  return buildStageItemId(stage, "seed_herb");
}

function buildStageHerbItemId(stage: SecretRealmDropStageKeyValue) {
  return buildStageItemId(stage, "material_herb");
}

function buildStageElementalMaterialIds(stage: SecretRealmStageKey): Record<SecretRealmElement, string> {
  const startIndex = SECRET_REALM_STAGE_ELEMENTAL_START_INDEX[stage];
  const materials = buildStageMaterialIds(stage);
  return {
    metal: materials[startIndex] || materials[0],
    wood: materials[startIndex + 1] || materials[1] || materials[0],
    water: materials[startIndex + 2] || materials[2] || materials[0],
    fire: materials[startIndex + 3] || materials[3] || materials[0],
    earth: materials[startIndex + 4] || materials[4] || materials[0],
  };
}

function isAllowedExistingPoolItemId(itemId: string) {
  const value = String(itemId || "").trim();
  if (!value) {
    return false;
  }
  if (value === "item_hongmeng_zhangtian_bottle") {
    return false;
  }
  if (!value.startsWith("item_four_realms_")) {
    return false;
  }
  if (/_quest_/u.test(value)) {
    return false;
  }
  return /_material_\d+$/u.test(value)
    || /_material_herb$/u.test(value)
    || /_seed_/u.test(value);
}

function isAllowedFormalMaterialItemId(itemId: string) {
  const value = String(itemId || "").trim();
  return isAllowedExistingPoolItemId(value) && !/_seed_/u.test(value);
}

function isAllowedSeedPoolItemId(itemId: string) {
  const value = String(itemId || "").trim();
  return isAllowedExistingPoolItemId(value) && /_seed_/u.test(value);
}

function buildFallbackExistingMaterialCandidateIds(params: {
  recommendedRealm: number;
  role: SecretRealmMonsterRole;
  rarity: ItemRarity;
  dropStageKey?: SecretRealmDropStageKey;
  element?: SecretRealmElement;
  themeProfile: {
    preferredElements: SecretRealmElement[];
  };
  includeSeeds: boolean;
}) {
  const stage = clampFormalStageKey(params.dropStageKey || resolveSecretRealmDropStageKey(params.recommendedRealm));
  const stageMaterials = buildStageMaterialIds(stage);
  const elementalMaterials = buildStageElementalMaterialIds(stage);
  const nonElementalMaterials = stageMaterials.slice(0, SECRET_REALM_STAGE_ELEMENTAL_START_INDEX[stage]);
  const preferredElements = dedupe([
    ...(params.element ? [params.element] : []),
    ...params.themeProfile.preferredElements,
  ]).filter((element): element is SecretRealmElement => SECRET_REALM_ELEMENTS.includes(element));

  const candidates: string[] = [];
  if (params.role === "boss") {
    preferredElements.forEach((element) => candidates.push(elementalMaterials[element]));
    if (stage !== "lianqi") {
      candidates.push(buildStageHerbItemId(stage));
    }
    stageMaterials.slice(Math.max(0, stageMaterials.length - 3)).forEach((itemId) => candidates.push(itemId));
  } else if (params.role === "elite") {
    preferredElements.forEach((element) => candidates.push(elementalMaterials[element]));
    nonElementalMaterials.slice(0, 3).forEach((itemId) => candidates.push(itemId));
    if (stage !== "lianqi") {
      candidates.push(buildStageHerbItemId(stage));
    }
  } else {
    nonElementalMaterials.slice(0, 4).forEach((itemId) => candidates.push(itemId));
    preferredElements.slice(0, 2).forEach((element) => candidates.push(elementalMaterials[element]));
  }

  if (params.includeSeeds) {
    candidates.push(buildStageSeedItemId(stage));
  }

  return dedupe(candidates.filter((itemId) => params.includeSeeds ? isAllowedExistingPoolItemId(itemId) : isAllowedFormalMaterialItemId(itemId)));
}

function pickExistingMaterialItemId(params: {
  rewardPlan: SecretRealmRewardPlan | null;
  role: SecretRealmMonsterRole;
  slotIndex: number;
  recommendedRealm: number;
  rarity: ItemRarity;
  dropStageKey?: SecretRealmDropStageKey;
  element?: SecretRealmElement;
  themeProfile: {
    preferredElements: SecretRealmElement[];
  };
  generatedSeed: string;
  includeSeeds: boolean;
}) {
  const guaranteePool = (params.rewardPlan?.guaranteedItemIds || []).filter(isAllowedFormalMaterialItemId);
  const weightedPool = (params.rewardPlan?.weightedItemIds || []).filter(isAllowedFormalMaterialItemId);
  const fallbackPool = buildFallbackExistingMaterialCandidateIds({
    recommendedRealm: params.recommendedRealm,
    role: params.role,
    rarity: params.rarity,
    dropStageKey: params.dropStageKey,
    element: params.element,
    themeProfile: params.themeProfile,
    includeSeeds: params.includeSeeds,
  });
  const pool = params.role === "boss" && params.slotIndex === 0 && guaranteePool.length > 0
    ? guaranteePool
    : weightedPool.length > 0
      ? weightedPool
      : params.role === "boss" && params.slotIndex === 0 && guaranteePool.length === 0 && fallbackPool.length > 0
        ? fallbackPool
        : [...weightedPool, ...fallbackPool];
  const normalizedPool = dedupe(pool.filter(isAllowedFormalMaterialItemId));
  if (normalizedPool.length === 0) {
    return null;
  }
  return pickFromSeed(`${params.generatedSeed}:existing-material`, normalizedPool);
}

function buildThemeProfile(theme: string, labels?: string[]): {
  themeTags: string[];
  preferredElements: SecretRealmElement[];
  preferredCategories: SecretRealmLootCategory[];
} {
  const profile = buildSecretRealmThemeProfile(theme, labels);
  return {
    themeTags: profile.themeTags,
    preferredElements: profile.preferredElements,
    preferredCategories: profile.preferredCategories,
  };
}

function buildFallbackRoleConfig(
  role: SecretRealmMonsterRole,
  instanceRarity: string,
): SecretRealmRewardRoleConfig {
  const rarityWeights = instanceRarity === "legendary"
    ? { common: 18, uncommon: 28, rare: 30, epic: 24, legendary: 0, hongmeng: 0 }
    : instanceRarity === "epic"
      ? { common: 24, uncommon: 30, rare: 28, epic: 18, legendary: 0, hongmeng: 0 }
      : instanceRarity === "rare"
        ? { common: 28, uncommon: 32, rare: 26, epic: 14, legendary: 0, hongmeng: 0 }
        : { common: 34, uncommon: 34, rare: 22, epic: 10, legendary: 0, hongmeng: 0 };

  if (role === "boss") {
    return {
      slotMin: 1,
      slotMax: 2,
      categoryWeights: { existing_material: 50, alchemy_material: 20, smithing_material: 20, equipment: 10, herb_seed: 0 },
      rarityWeights: { common: 0, uncommon: 0, rare: Math.max(52, Number(rarityWeights.rare || 0)), epic: Math.max(36, Number(rarityWeights.epic || 0) + 14), legendary: 0, hongmeng: 0 },
    };
  }
  if (role === "elite") {
    return {
      slotMin: 1,
      slotMax: 2,
      categoryWeights: { existing_material: 35, herb_seed: 10, alchemy_material: 20, smithing_material: 20, equipment: 15 },
      rarityWeights: {
        common: Math.max(10, Number(rarityWeights.common || 0) - 8),
        uncommon: Math.max(24, Number(rarityWeights.uncommon || 0) + 4),
        rare: Math.max(28, Number(rarityWeights.rare || 0) + 6),
        epic: Math.max(14, Number(rarityWeights.epic || 0) + 4),
        legendary: 0,
        hongmeng: 0,
      },
    };
  }
  return {
    slotMin: 0,
    slotMax: 1,
    categoryWeights: { existing_material: 40, herb_seed: 10, alchemy_material: 25, smithing_material: 25, equipment: 0 },
    rarityWeights: {
      common: Math.max(24, Number(rarityWeights.common || 0)),
      uncommon: Math.max(28, Number(rarityWeights.uncommon || 0)),
      rare: Math.max(18, Number(rarityWeights.rare || 0)),
      epic: Math.max(6, Number(rarityWeights.epic || 0)),
      legendary: 0,
      hongmeng: 0,
    },
  };
}

function buildBlueprintEntries(params: {
  seed: string;
  role: SecretRealmMonsterRole;
  rewardPlan: SecretRealmRewardPlan | null;
  theme: string;
  labels?: string[];
  instanceRarity: string;
  recommendedRealm: number;
}) {
  const fallbackRoleConfig = buildFallbackRoleConfig(params.role, params.instanceRarity);
  const plannedRoleConfig = params.rewardPlan?.roleRewardConfigs?.[params.role];
  const roleConfig: SecretRealmRewardRoleConfig = {
    slotMin: plannedRoleConfig?.slotMin ?? fallbackRoleConfig.slotMin,
    slotMax: plannedRoleConfig?.slotMax ?? fallbackRoleConfig.slotMax,
    categoryWeights: {
      ...(fallbackRoleConfig.categoryWeights || {}),
      ...(params.rewardPlan?.categoryWeights || {}),
      ...(plannedRoleConfig?.categoryWeights || {}),
    },
    rarityWeights: {
      ...(fallbackRoleConfig.rarityWeights || {}),
      ...(params.rewardPlan?.rarityWeights || {}),
      ...(plannedRoleConfig?.rarityWeights || {}),
    },
    guaranteedCategories: plannedRoleConfig?.guaranteedCategories || fallbackRoleConfig.guaranteedCategories,
  };
  const themeProfile = buildThemeProfile(params.theme, params.labels);
  const baseCategoryWeights = {
    ...(roleConfig.categoryWeights || {}),
  } as Partial<Record<SecretRealmLootCategory, number>>;
  for (const category of themeProfile.preferredCategories) {
    baseCategoryWeights[category] = Number(baseCategoryWeights[category] || 0) + 8;
  }
  const rarityWeights = {
    ...(roleConfig.rarityWeights || {}),
  } as Partial<Record<ItemRarity, number>>;
  const resolvedRarityWeights = params.role === "boss"
    ? boostBossRarityWeights(rarityWeights)
    : rarityWeights;
  const slotCount = clampNumber(
    Math.round(roleConfig.slotMin + seededRandom(`${params.seed}:slots`) * Math.max(0, roleConfig.slotMax - roleConfig.slotMin)),
    roleConfig.slotMin,
    roleConfig.slotMax,
  );

  const entries: SecretRealmLootBlueprintEntry[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    let categoryWeights = { ...baseCategoryWeights };
    if (params.role === "boss" && index === 0) {
      categoryWeights = {
        existing_material: 50,
        alchemy_material: 25,
        smithing_material: 25,
        herb_seed: 0,
        equipment: 0,
      };
    } else if (params.role === "elite" && index === 0) {
      categoryWeights.equipment = 0;
    } else if (params.role === "normal") {
      categoryWeights.equipment = 0;
    }

    const category = roleConfig.guaranteedCategories?.[index]
      || weightedPick(`${params.seed}:category:${index}`, categoryWeights, themeProfile.preferredCategories[0] || "existing_material");
    const rarityFallback = params.role === "boss" ? "rare" : params.role === "elite" ? "uncommon" : "common";
    const rarity = clampSecretRealmEntryRarityByRole(
      params.role,
      normalizeRarity(weightedPick(`${params.seed}:rarity:${index}`, resolvedRarityWeights, rarityFallback)),
    );
    const element = pickFromSeed(`${params.seed}:element:${index}`, themeProfile.preferredElements);
    const chance = params.role === "boss"
      ? (index === 0 ? 1 : 0.45)
      : params.role === "elite"
        ? (index === 0 ? 1 : 0.35)
        : 1;
    const route = category === "alchemy_material"
      ? pickFromSeed(`${params.seed}:alchemy:${index}`, ALCHEMY_ROUTES)
      : category === "equipment"
        ? pickFromSeed(`${params.seed}:equip:${index}`, EQUIPMENT_ROUTES)
        : undefined;
    const dropStageKey = pickDropStageKey({
      recommendedRealm: params.recommendedRealm,
      role: params.role,
      rarity,
      seed: `${params.seed}:stage:${index}`,
    });
    const usageLabel = category === "alchemy_material"
      ? ALCHEMY_ROUTE_LABELS[pickFromSeed(`${params.seed}:usage:${index}`, ALCHEMY_ROUTES)]
      : CATEGORY_LABELS[category];
    const existingItemId = category === "existing_material"
      ? pickExistingMaterialItemId({
        rewardPlan: params.rewardPlan,
        role: params.role,
        slotIndex: index,
        recommendedRealm: params.recommendedRealm,
        rarity,
        dropStageKey,
        element,
        themeProfile,
        generatedSeed: `${params.seed}:existing:${index}`,
        includeSeeds: false,
      }) || undefined
      : undefined;
    entries.push({
      slotId: `slot_${index + 1}`,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      rarity,
      quantityMin: 1,
      quantityMax: category === "equipment" ? 1 : category === "herb_seed" ? 2 : 1,
      chance,
      element,
      route,
      dropStageKey,
      existingItemId,
      themeTag: themeProfile.themeTags[index % themeProfile.themeTags.length] || themeProfile.themeTags[0],
      usageLabel,
      uniquePerPlayer: category !== "herb_seed" && category !== "existing_material",
    });
  }

  const bonusSeedChance = params.role === "boss"
    ? 1
    : params.role === "elite"
      ? (themeProfile.preferredCategories.includes("herb_seed") ? 0.32 : 0.22)
      : (themeProfile.preferredCategories.includes("herb_seed") ? 0.14 : 0.08);
  if (bonusSeedChance > 0) {
    const bonusSeedRarity = params.recommendedRealm >= 21
      ? (params.role === "boss" ? "legendary" : "epic")
      : params.recommendedRealm >= 17
        ? (params.role === "boss" ? "epic" : "rare")
        : "uncommon";
    entries.push({
      slotId: "seed_bonus",
      category: "herb_seed",
      categoryLabel: CATEGORY_LABELS.herb_seed,
      rarity: normalizeRarity(bonusSeedRarity),
      quantityMin: 1,
      quantityMax: 1,
      chance: bonusSeedChance,
      dropStageKey: pickDropStageKey({
        recommendedRealm: params.recommendedRealm,
        role: params.role,
        rarity: normalizeRarity(bonusSeedRarity),
        seed: `${params.seed}:seed-bonus:stage`,
      }),
      themeTag: themeProfile.themeTags[0] || "秘境",
      usageLabel: CATEGORY_LABELS.herb_seed,
      uniquePerPlayer: false,
    });
  }

  return {
    themeProfile,
    entries,
  };
}

export function buildSecretRealmLootBlueprint(params: {
  seed: string;
  role: SecretRealmMonsterRole;
  rewardPlan: SecretRealmRewardPlan | null;
  theme: string;
  labels?: string[];
  instanceRarity: string;
  recommendedRealm: number;
}): SecretRealmLootBlueprint {
  const { themeProfile, entries } = buildBlueprintEntries(params);
  return {
    version: 4,
    role: params.role,
    theme: params.theme,
    themeTags: themeProfile.themeTags,
    preferredElements: themeProfile.preferredElements,
    preferredCategories: themeProfile.preferredCategories,
    entries,
  };
}

async function listFilesByDirectory(directory: string) {
  const roots = await getExistingUploadRoots();
  const rootsToScan = roots.length > 0 ? roots : [...UPLOADS_ROOT_CANDIDATES];
  const urls = new Set<string>();

  for (const rootPath of rootsToScan) {
    const targetDirectory = path.resolve(rootPath, "cosmetics", "item", ...directory.split("/"));
    try {
      const entries = await readdir(targetDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        urls.add(buildUploadsPublicUrl("cosmetics", "item", ...directory.split("/"), entry.name));
      }
    } catch {
      continue;
    }
  }

  return [...urls].sort((left, right) => left.localeCompare(right));
}

async function loadIconPools() {
  const directories = dedupe([
    ...Object.values(MATERIAL_DIRECTORIES.alchemy_material),
    ...Object.values(MATERIAL_DIRECTORIES.smithing_material),
    ...Object.values(EQUIPMENT_TEMPLATES).map((template) => template.iconDirectory),
  ]);
  const entries = await Promise.all(
    directories.map(async (directory) => [directory, await listFilesByDirectory(directory)] as const),
  );
  return entries.reduce<Record<string, string[]>>((pools, [directory, files]) => {
    pools[directory] = files;
    return pools;
  }, {});
}

async function getIconPools() {
  const now = Date.now();
  if (iconCache && iconCache.expiresAt > now) {
    return iconCache.pools;
  }
  if (!iconCachePromise) {
    iconCachePromise = loadIconPools().finally(() => {
      iconCachePromise = null;
    });
  }
  const pools = await iconCachePromise;
  iconCache = {
    expiresAt: now + CACHE_TTL_MS,
    pools,
  };
  return pools;
}

async function isRewardCategoryAssetAvailable(category: SecretRealmLootCategory) {
  if (category === "herb_seed") {
    return true;
  }
  if (category === "existing_material") {
    const templates = await getExistingMaterialTemplates();
    return templates.length > 0;
  }

  const pools = await getIconPools();
  if (category === "equipment") {
    return Object.values(EQUIPMENT_TEMPLATES).some((template) => (pools[template.iconDirectory] || []).length > 0);
  }

  const materialDirectories = Object.values(MATERIAL_DIRECTORIES[category]);
  return materialDirectories.some((directory) => (pools[directory] || []).length > 0);
}

async function resolveMaterialAsset(params: {
  category: "alchemy_material" | "smithing_material";
  preferredElement?: SecretRealmElement | null;
  generatedSeed: string;
}) {
  const pools = await getIconPools();
  const preferredElement = params.preferredElement && SECRET_REALM_ELEMENTS.includes(params.preferredElement)
    ? params.preferredElement
    : null;
  if (preferredElement) {
    const preferredDirectory = MATERIAL_DIRECTORIES[params.category][preferredElement];
    const preferredPool = pools[preferredDirectory] || [];
    if (preferredPool.length > 0) {
      return {
        element: preferredElement,
        directory: preferredDirectory,
        iconUrl: pickFromSeed(`${params.generatedSeed}:preferred:${preferredElement}`, preferredPool),
      };
    }
  }

  const fallbackElements = SECRET_REALM_ELEMENTS.filter((element) => {
    const directory = MATERIAL_DIRECTORIES[params.category][element];
    return (pools[directory] || []).length > 0;
  });
  if (fallbackElements.length === 0) {
    return null;
  }

  const pickedElement = pickFromSeed(`${params.generatedSeed}:material-element`, fallbackElements);
  const pickedDirectory = MATERIAL_DIRECTORIES[params.category][pickedElement];
  const pickedPool = pools[pickedDirectory] || [];
  if (pickedPool.length === 0) {
    return null;
  }
  return {
    element: pickedElement,
    directory: pickedDirectory,
    iconUrl: pickFromSeed(`${params.generatedSeed}:material-icon:${pickedElement}`, pickedPool),
  };
}

async function resolveEquipmentAsset(route: SecretRealmEquipmentRoute | undefined, generatedSeed: string) {
  const pools = await getIconPools();
  const preferredRoute = ((route as GeneratedEquipmentRoute | undefined) || "sword");
  const preferredTemplate = EQUIPMENT_TEMPLATES[preferredRoute] || EQUIPMENT_TEMPLATES.sword;
  const preferredPool = pools[preferredTemplate.iconDirectory] || [];
  if (preferredPool.length > 0) {
    return {
      route: preferredRoute,
      template: preferredTemplate,
      iconUrl: pickFromSeed(`${generatedSeed}:preferred-route:${preferredRoute}`, preferredPool),
    };
  }

  const fallbackRoutes = (Object.keys(EQUIPMENT_TEMPLATES) as GeneratedEquipmentRoute[]).filter((candidateRoute) => {
    const template = EQUIPMENT_TEMPLATES[candidateRoute];
    return (pools[template.iconDirectory] || []).length > 0;
  });
  if (fallbackRoutes.length === 0) {
    return null;
  }

  const pickedRoute = pickFromSeed(`${generatedSeed}:equipment-route`, fallbackRoutes);
  const pickedTemplate = EQUIPMENT_TEMPLATES[pickedRoute];
  const pickedPool = pools[pickedTemplate.iconDirectory] || [];
  if (pickedPool.length === 0) {
    return null;
  }
  return {
    route: pickedRoute,
    template: pickedTemplate,
    iconUrl: pickFromSeed(`${generatedSeed}:equipment-icon:${pickedRoute}`, pickedPool),
  };
}

function buildCategoryFallbackOrder(category: SecretRealmLootCategory) {
  return [category, ...SECRET_REALM_LOOT_CATEGORY_FALLBACKS[category]]
    .filter((value, index, array) => array.indexOf(value) === index);
}

function buildFallbackEntry(
  entry: SecretRealmLootBlueprintEntry,
  category: SecretRealmLootCategory,
  generatedSeed: string,
): SecretRealmLootBlueprintEntry {
  if (category === entry.category) {
    return entry;
  }

  if (category === "equipment") {
    const route = (entry.category === "equipment" && entry.route)
      ? entry.route
      : pickFromSeed(`${generatedSeed}:fallback-equipment-route`, EQUIPMENT_ROUTES);
    return {
      ...entry,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      quantityMin: 1,
      quantityMax: 1,
      route,
      usageLabel: CATEGORY_LABELS[category],
      uniquePerPlayer: true,
    };
  }

  if (category === "alchemy_material") {
    const route: SecretRealmAlchemyRoute = entry.category === "alchemy_material" && entry.route
      ? entry.route as SecretRealmAlchemyRoute
      : pickFromSeed(`${generatedSeed}:fallback-alchemy-route`, ALCHEMY_ROUTES);
    return {
      ...entry,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      quantityMin: 1,
      quantityMax: entry.rarity === "common" ? 2 : 1,
      route,
      usageLabel: ALCHEMY_ROUTE_LABELS[route],
      uniquePerPlayer: true,
    };
  }

  if (category === "smithing_material") {
    return {
      ...entry,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      quantityMin: 1,
      quantityMax: entry.rarity === "common" ? 2 : 1,
      route: undefined,
      usageLabel: CATEGORY_LABELS[category],
      uniquePerPlayer: true,
    };
  }

  if (category === "existing_material") {
    return {
      ...entry,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      quantityMin: 1,
      quantityMax: 1,
      route: undefined,
      usageLabel: CATEGORY_LABELS[category],
      existingItemId: entry.existingItemId,
      uniquePerPlayer: false,
    };
  }

  return {
    ...entry,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    quantityMin: 1,
    quantityMax: 2,
    route: undefined,
    usageLabel: CATEGORY_LABELS[category],
    uniquePerPlayer: false,
  };
}

async function getRewardContext(monsterId: string): Promise<RewardContext | null> {
  const supportsLootBlueprintPersistence = await supportsMapInstanceMonsterLootBlueprint();
  const row = await db.select({
    instanceId: mapInstanceMonsters.instanceId,
    mapId: mapInstances.mapId,
    runId: secretRealmRuns.id,
    monsterId: mapInstanceMonsters.monsterId,
    role: mapInstanceMonsters.role,
    monsterStatus: mapInstanceMonsters.status,
    rewardPlan: mapInstanceMonsters.rewardPlan,
    lootBlueprint: supportsLootBlueprintPersistence
      ? mapInstanceMonsters.lootBlueprintJson
      : sql<SecretRealmLootBlueprint | null>`null`,
    recommendedRealm: mapInstances.recommendedRealm,
    instanceRarity: mapInstances.rarity,
    theme: secretRealmTemplates.theme,
    templateName: secretRealmTemplates.name,
    templateTags: secretRealmTemplates.tags,
    monsterName: temporaryMonsters.name,
    monsterDescription: temporaryMonsters.description,
  }).from(mapInstanceMonsters)
    .innerJoin(mapInstances, eq(mapInstances.id, mapInstanceMonsters.instanceId))
    .leftJoin(secretRealmRuns, eq(secretRealmRuns.instanceId, mapInstances.id))
    .leftJoin(secretRealmTemplates, eq(secretRealmTemplates.id, mapInstances.templateId))
    .leftJoin(temporaryMonsters, eq(temporaryMonsters.id, mapInstanceMonsters.monsterId))
    .where(eq(mapInstanceMonsters.monsterId, monsterId))
    .get();
  if (!row) {
    return null;
  }
  const templateName = String(row.templateName || "秘境");
  const templateTags = Array.isArray(row.templateTags)
    ? row.templateTags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return {
    instanceId: row.instanceId,
    mapId: row.mapId,
    runId: row.runId || null,
    monsterId: row.monsterId,
    monsterName: row.monsterName || "秘境异兽",
    monsterDescription: row.monsterDescription || null,
    role: (row.role as SecretRealmMonsterRole) || "normal",
    monsterStatus: row.monsterStatus || "alive",
    rewardPlan: (row.rewardPlan || null) as SecretRealmRewardPlan | null,
    lootBlueprint: (row.lootBlueprint || null) as SecretRealmLootBlueprint | null,
    recommendedRealm: Math.max(1, Number(row.recommendedRealm || 1)),
    instanceRarity: String(row.instanceRarity || "common"),
    theme: String(row.theme || "秘境"),
    templateName,
    templateTags,
    isWildWolfValley: isWildWolfValleyRealm({
      name: templateName,
      tags: templateTags,
    }),
    supportsLootBlueprintPersistence,
  };
}

async function addInventoryStackTx(tx: RewardTx, playerId: string, itemId: string, quantity: number) {
  const existingRows = await tx.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
    .all();
  if (existingRows.length === 0) {
    await tx.insert(playerInventory).values({
      playerId,
      itemId,
      quantity,
      equipped: false,
    }).run();
    return;
  }

  const mergedQuantity = existingRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0) + quantity;
  if (existingRows.length === 1) {
    await tx.update(playerInventory)
      .set({ quantity: mergedQuantity })
      .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
      .run();
    return;
  }

  await tx.delete(playerInventory)
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
    .run();
  await tx.insert(playerInventory).values({
    playerId,
    itemId,
    quantity: mergedQuantity,
    equipped: false,
  }).run();
}

async function hasInventoryItemTx(tx: RewardTx, playerId: string, itemId: string) {
  const existingRows = await tx.select({
    quantity: playerInventory.quantity,
  }).from(playerInventory)
    .where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.itemId, itemId),
    ))
    .all();
  return existingRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0) > 0;
}

async function grantWildWolfValleyBottleTx(params: {
  tx: RewardTx;
  playerId: string;
}) {
  const bottleItem = await params.tx.select({
    id: items.id,
    name: items.name,
    iconUrl: items.iconUrl,
    rarity: items.rarity,
  }).from(items)
    .where(eq(items.id, HONGMENG_BOTTLE_ITEM_ID))
    .get();
  if (!bottleItem) {
    throw new Error("掌天瓶物品定义缺失，无法发放鸿蒙至宝奖励");
  }

  await addInventoryStackTx(params.tx, params.playerId, HONGMENG_BOTTLE_ITEM_ID, 1);
  return {
    itemId: bottleItem.id,
    itemName: bottleItem.name,
    itemIconUrl: bottleItem.iconUrl || null,
    quantity: 1,
    itemRarity: bottleItem.rarity,
    itemSourceType: "hongmeng_treasure",
    itemCategoryLabel: "鸿蒙至宝",
  } satisfies CombatRewardDrop;
}

async function lockPlayerRowTx(tx: RewardTx, playerId: string) {
  const rows = await tx.execute<{
    id: string;
    cultivation_xp: number;
    gold: number;
    secret_realm_pity_counter: number;
    secret_realm_hongmeng_pity_counter: number;
    wild_wolf_valley_mob_bottle_pity_counter: number;
    wild_wolf_valley_boss_bottle_pity_counter: number;
  }>(
    sql`
      SELECT
        "id",
        "cultivation_xp",
        "gold",
        "secret_realm_pity_counter",
        "secret_realm_hongmeng_pity_counter",
        "wild_wolf_valley_mob_bottle_pity_counter",
        "wild_wolf_valley_boss_bottle_pity_counter"
      FROM "players"
      WHERE "id" = ${playerId}
      FOR UPDATE
    `,
  );
  return rows[0] || null;
}

async function loadExistingMaterialTemplates() {
  const formalStageKeys = SECRET_REALM_DROP_STAGE_KEYS.filter((stage): stage is SecretRealmStageKey => stage !== "huashen");
  const candidateIds = dedupe([
    ...formalStageKeys.flatMap((stage) => buildStageMaterialIds(stage)),
    ...formalStageKeys.map((stage) => buildStageSeedItemId(stage)),
    ...formalStageKeys
      .filter((stage) => stage !== "lianqi")
      .map((stage) => buildStageHerbItemId(stage)),
  ]).filter(isAllowedFormalMaterialItemId);
  if (candidateIds.length === 0) {
    return [] as ExistingMaterialTemplate[];
  }

  const rows = await db.select({
    itemId: items.id,
    itemName: items.name,
    itemIconUrl: items.iconUrl,
    rarity: items.rarity,
    minRealm: items.minRealm,
    maxRealm: items.maxRealm,
    itemType: items.itemType,
    sourceType: items.sourceType,
    isBound: items.isBound,
  }).from(items).where(inArray(items.id, candidateIds)).all();

  return rows.filter((row) => (
    row.itemType === "material"
    && !row.isBound
    && (row.sourceType === null || row.sourceType === "" || row.sourceType === "system")
    && isAllowedFormalMaterialItemId(row.itemId)
  ));
}

async function getExistingMaterialTemplates() {
  const now = Date.now();
  if (existingMaterialTemplateCache && existingMaterialTemplateCache.expiresAt > now) {
    return existingMaterialTemplateCache.templates;
  }
  if (!existingMaterialTemplateCachePromise) {
    existingMaterialTemplateCachePromise = loadExistingMaterialTemplates().finally(() => {
      existingMaterialTemplateCachePromise = null;
    });
  }
  const templates = await existingMaterialTemplateCachePromise;
  existingMaterialTemplateCache = {
    expiresAt: now + CACHE_TTL_MS,
    templates,
  };
  return templates;
}

async function listSeedTemplatesTx(tx: RewardTx) {
  const builtinSeedMetaRows = BUILTIN_SPIRITUAL_FIELD_SEEDS
    .filter((seed) => isAllowedSeedPoolItemId(seed.seedItemId));
  const builtinSeedIds = dedupe(builtinSeedMetaRows.map((seed) => seed.seedItemId));
  const builtinItemRows = builtinSeedIds.length > 0
    ? await tx.select({
      id: items.id,
      name: items.name,
      iconUrl: items.iconUrl,
      rarity: items.rarity,
      minRealm: items.minRealm,
      maxRealm: items.maxRealm,
    }).from(items).where(inArray(items.id, builtinSeedIds)).all()
    : [];
  const builtinItemMap = new Map(builtinItemRows.map((item) => [item.id, item] as const));

  const buildBuiltinSeeds = () => {
    return builtinSeedMetaRows.flatMap((seed) => {
      const item = builtinItemMap.get(seed.seedItemId);
      if (!item) {
        return [];
      }
      return [{
        itemId: item.id,
        itemName: item.name,
        itemIconUrl: item.iconUrl || null,
        rarity: item.rarity,
        minRealm: item.minRealm ?? null,
        maxRealm: item.maxRealm ?? null,
        seedName: seed.name || item.name || seed.seedItemId,
        dropThemeTags: Array.isArray(seed.dropThemeTags) ? seed.dropThemeTags : [],
        secretRealmWeight: Math.max(1, Number(seed.secretRealmWeight || 0) || 1),
      } satisfies SeedTemplate];
    });
  };

  const builtinMap = new Map<string, SeedTemplate>(buildBuiltinSeeds().map((seed) => [seed.itemId, seed] as const));
  try {
    const rows = await tx.execute<{
      item_id: string;
      item_name: string;
      item_icon_url: string | null;
      rarity: string | null;
      min_realm: number | null;
      max_realm: number | null;
      seed_name: string | null;
      drop_theme_tags: SecretRealmSeedThemeTag[] | null;
      secret_realm_weight: number | null;
    }>(
      sql`
        SELECT
          s."seed_item_id" AS "item_id",
          i."name" AS "item_name",
          i."icon_url" AS "item_icon_url",
          i."rarity" AS "rarity",
          i."min_realm" AS "min_realm",
          i."max_realm" AS "max_realm",
          s."name" AS "seed_name",
          COALESCE(s."drop_theme_tags", '[]'::jsonb) AS "drop_theme_tags",
          COALESCE(s."secret_realm_weight", 1) AS "secret_realm_weight"
        FROM "plugin_spiritual_field_seeds" s
        INNER JOIN "items" i ON i."id" = s."seed_item_id"
        WHERE COALESCE(s."enabled", true) = true
      `,
    );
    for (const row of rows) {
      builtinMap.set(row.item_id, {
        itemId: row.item_id,
        itemName: row.item_name,
        itemIconUrl: row.item_icon_url,
        rarity: row.rarity,
        minRealm: row.min_realm,
        maxRealm: row.max_realm,
        seedName: row.seed_name,
        dropThemeTags: Array.isArray(row.drop_theme_tags)
          ? row.drop_theme_tags.filter((tag): tag is SecretRealmSeedThemeTag => typeof tag === "string")
          : [],
        secretRealmWeight: Math.max(1, Number(row.secret_realm_weight || 0) || 1),
      });
    }
  } catch {
    try {
      const legacyRows = await tx.execute<{
        item_id: string;
        item_name: string;
        item_icon_url: string | null;
        rarity: string | null;
        min_realm: number | null;
        max_realm: number | null;
        seed_name: string | null;
      }>(
        sql`
          SELECT
            s."seed_item_id" AS "item_id",
            i."name" AS "item_name",
            i."icon_url" AS "item_icon_url",
            i."rarity" AS "rarity",
            i."min_realm" AS "min_realm",
            i."max_realm" AS "max_realm",
            s."name" AS "seed_name"
          FROM "plugin_spiritual_field_seeds" s
          INNER JOIN "items" i ON i."id" = s."seed_item_id"
          WHERE COALESCE(s."enabled", true) = true
        `,
      );
      for (const row of legacyRows) {
        const fallback = builtinMap.get(row.item_id);
        builtinMap.set(row.item_id, {
          itemId: row.item_id,
          itemName: row.item_name,
          itemIconUrl: row.item_icon_url,
          rarity: row.rarity,
          minRealm: row.min_realm,
          maxRealm: row.max_realm,
          seedName: row.seed_name,
          dropThemeTags: fallback?.dropThemeTags || [],
          secretRealmWeight: fallback?.secretRealmWeight || 1,
        });
      }
    } catch {
      // 兼容旧插件表尚未升级或尚未安装的场景，继续回退到内置灵种目录。
    }
  }

  return [...builtinMap.values()];
}

async function resolveBlueprintTx(tx: RewardTx, context: RewardContext) {
  if (context.lootBlueprint?.entries?.length && Number(context.lootBlueprint.version || 1) >= 4) {
    const sanitizedBlueprint = sanitizeSecretRealmLootBlueprintByRole(context.lootBlueprint);
    if (
      sanitizedBlueprint
      && context.supportsLootBlueprintPersistence
      && JSON.stringify(sanitizedBlueprint) !== JSON.stringify(context.lootBlueprint)
    ) {
      await tx.update(mapInstanceMonsters).set({
        lootBlueprintJson: sanitizedBlueprint,
        updatedAt: new Date().toISOString(),
      }).where(eq(mapInstanceMonsters.monsterId, context.monsterId)).run();
    }
    return sanitizedBlueprint || context.lootBlueprint;
  }
  const blueprint = buildSecretRealmLootBlueprint({
    seed: `${context.instanceId}:${context.monsterId}:${context.role}`,
    role: context.role,
    rewardPlan: context.rewardPlan,
    theme: context.theme,
    labels: [context.monsterName, context.monsterDescription || ""],
    instanceRarity: context.instanceRarity,
    recommendedRealm: context.recommendedRealm,
  });
  const sanitizedBlueprint = sanitizeSecretRealmLootBlueprintByRole(blueprint) || blueprint;
  if (context.supportsLootBlueprintPersistence) {
    await tx.update(mapInstanceMonsters).set({
      lootBlueprintJson: sanitizedBlueprint,
      updatedAt: new Date().toISOString(),
    }).where(eq(mapInstanceMonsters.monsterId, context.monsterId)).run();
  }
  return sanitizedBlueprint;
}

function buildThemeStem(themeTag: string) {
  if (/荒林|妖植/u.test(themeTag)) return "林";
  if (/药气|丹/u.test(themeTag)) return "丹";
  if (/矿脉|石/u.test(themeTag)) return "矿";
  if (/残煞|煞/u.test(themeTag)) return "煞";
  return "境";
}

function buildRealmLabel(recommendedRealm: number) {
  if (recommendedRealm >= 25) return "化神";
  if (recommendedRealm >= 21) return "元婴";
  if (recommendedRealm >= 17) return "结丹";
  if (recommendedRealm >= 13) return "筑基";
  return "练气";
}

async function upsertRunSummaryTx(tx: RewardTx, runId: string | null, playerId: string, nowIso: string) {
  if (!runId) {
    return;
  }
  const rows = await tx.execute<{ summary_json: SecretRealmRunSummary | null }>(
    sql`
      SELECT "summary_json"
      FROM "secret_realm_runs"
      WHERE "id" = ${runId}
      FOR UPDATE
    `,
  );
  const summary = (rows[0]?.summary_json || {}) as SecretRealmRunSummary;
  const participantPlayerIds = Array.from(new Set([
    ...(Array.isArray(summary.participantPlayerIds) ? summary.participantPlayerIds : []),
    playerId,
  ]));
  await tx.update(secretRealmRuns).set({
    summaryJson: {
      ...summary,
      participantPlayerIds,
    },
    updatedAt: nowIso,
  }).where(eq(secretRealmRuns.id, runId)).run();
}

async function markMonsterDefeatedTx(tx: RewardTx, context: RewardContext, nowIso: string) {
  if (context.role === "boss" || context.monsterStatus !== "alive") {
    return;
  }
  await tx.update(mapInstanceMonsters).set({
    status: "dead",
    defeatedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(mapInstanceMonsters.monsterId, context.monsterId)).run();
  if (!context.runId) {
    return;
  }
  const rows = await tx.execute<{ summary_json: SecretRealmRunSummary | null }>(
    sql`
      SELECT "summary_json"
      FROM "secret_realm_runs"
      WHERE "id" = ${context.runId}
      FOR UPDATE
    `,
  );
  const summary = (rows[0]?.summary_json || {}) as SecretRealmRunSummary;
  const defeatedMonsterIds = Array.from(new Set([...(summary.defeatedMonsterIds || []), context.monsterId]));
  const bossGateUpdate = recordSecretRealmBossGateMonsterDefeat({
    summary,
    monsterId: context.monsterId,
    defeatedMonsterIds,
    nowIso,
  });
  await tx.update(secretRealmRuns).set({
    summaryJson: {
      ...bossGateUpdate.nextSummary,
      defeatedMonsterIds,
      defeatedMonsterCount: defeatedMonsterIds.length,
      lastDefeatedMonsterAt: nowIso,
    },
    updatedAt: nowIso,
  }).where(eq(secretRealmRuns.id, context.runId)).run();

  if (bossGateUpdate.unlockedNow) {
    const currentMap = await tx.select({
      tilesData: temporaryMaps.tilesData,
    }).from(temporaryMaps).where(eq(temporaryMaps.id, context.mapId)).get();
    if (currentMap?.tilesData) {
      const restoredTiles = unlockSecretRealmBossGateDoors({
        tilesData: Array.isArray(currentMap.tilesData) ? currentMap.tilesData : [],
        gate: bossGateUpdate.bossGate,
      });
      await tx.update(temporaryMaps).set({
        tilesData: restoredTiles,
        updatedAt: nowIso,
      }).where(eq(temporaryMaps.id, context.mapId)).run();
    }
  }
}

function readClaim(claim: typeof secretRealmRewardClaims.$inferSelect) {
  const snapshot = (claim.rewardSnapshot || { xp: 0, gold: 0, drops: [] }) as SecretRealmRewardSnapshot;
  return {
    isSecretRealm: true,
    reusedClaim: true,
    xp: Math.max(0, Number(snapshot.xp || claim.xp || 0)),
    gold: Math.max(0, Number(snapshot.gold || claim.gold || 0)),
    drops: Array.isArray(snapshot.drops) ? snapshot.drops : [],
    noRewardReason: snapshot.noRewardReason || (claim.noRewardReason as "stamina_empty" | "repeat_guard_blocked" | undefined),
    grantedItemIds: Array.isArray(snapshot.grantedItemIds) ? snapshot.grantedItemIds : Array.isArray(claim.grantedItemIds) ? claim.grantedItemIds : [],
  } satisfies RewardResult;
}

async function grantExistingMaterialDropTx(tx: RewardTx, playerId: string, context: RewardContext, entry: SecretRealmLootBlueprintEntry, generatedSeed: string) {
  const templates = await getExistingMaterialTemplates();
  const candidates = templates.filter((candidate) => (
    matchesDropStageRange({
      minRealm: candidate.minRealm,
      maxRealm: candidate.maxRealm,
      dropStageKey: entry.dropStageKey,
      recommendedRealm: context.recommendedRealm,
    })
    && candidate.itemType === "material"
    && !candidate.isBound
    && (candidate.sourceType === null || candidate.sourceType === "" || candidate.sourceType === "system")
  ));
  const preferredItemId = entry.existingItemId && candidates.some((candidate) => candidate.itemId === entry.existingItemId)
    ? entry.existingItemId
    : null;
  const picked = preferredItemId
    ? candidates.find((candidate) => candidate.itemId === preferredItemId) || null
    : (candidates.length > 0 ? candidates.find((candidate) => candidate.itemId === pickFromSeed(`${generatedSeed}:existing-item`, candidates.map((item) => item.itemId))) || null : null);
  if (!picked) {
    return null;
  }
  const quantity = clampNumber(
    entry.quantityMin + Math.floor(seededRandom(`${generatedSeed}:quantity`) * Math.max(1, entry.quantityMax - entry.quantityMin + 1)),
    entry.quantityMin,
    entry.quantityMax,
  );
  await addInventoryStackTx(tx, playerId, picked.itemId, quantity);
  return {
    itemId: picked.itemId,
    itemName: picked.itemName,
    itemIconUrl: picked.itemIconUrl || null,
    quantity,
    itemRarity: picked.rarity || entry.rarity,
    itemSourceType: "system",
    itemCategoryLabel: CATEGORY_LABELS.existing_material,
  } satisfies CombatRewardDrop;
}

async function buildMaterialDrop(params: {
  entry: SecretRealmLootBlueprintEntry;
  context: RewardContext;
  playerId: string;
  generatedSeed: string;
}) {
  const category = params.entry.category === "smithing_material" ? "smithing_material" : "alchemy_material";
  const asset = await resolveMaterialAsset({
    category,
    preferredElement: params.entry.element || "earth",
    generatedSeed: params.generatedSeed,
  });
  if (!asset) {
    const categoryDirectory = category === "alchemy_material" ? "ai-alchemy/material-*" : "ai-smithing/material-*";
    throw new Error(`秘境${CATEGORY_LABELS[category]}缺少专属图标，请先上传到 /uploads/cosmetics/item/${categoryDirectory}/`);
  }
  const element = asset.element;
  const iconUrl = asset.iconUrl;
  const prefix = pickFromSeed(`${params.generatedSeed}:prefix`, ELEMENT_WORDS[element]);
  const suffix = pickFromSeed(`${params.generatedSeed}:suffix`, MATERIAL_SUFFIXES[category]);
  const name = normalizeText(`${buildThemeStem(params.entry.themeTag || "秘境")}${prefix}${suffix}`, 6, `${prefix}${suffix}`);
  const description = normalizeText(`${params.entry.themeTag || "秘境"}灵机沉积，可作${params.entry.usageLabel || CATEGORY_LABELS[category]}。`, 30, "此物久受秘境灵机浸润。");
  const itemId = `item_secret_realm_${category}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const stageProfile = getDropStageProfile(params.entry.dropStageKey || resolveSecretRealmDropStageKey(params.context.recommendedRealm));
  const price = params.entry.rarity === "hongmeng"
    ? 360
    : params.entry.rarity === "legendary"
      ? 180
      : params.entry.rarity === "epic"
        ? 120
        : params.entry.rarity === "rare"
          ? 80
          : 36;
  return {
    itemId,
    itemRow: {
      id: itemId,
      templateItemId: null,
      name,
      iconUrl,
      description,
      itemType: "material" as const,
      rarity: params.entry.rarity,
      effects: [],
      pillToxicity: 0,
      price,
      stackable: false,
      isBound: false,
      minRealm: stageProfile.minRealm,
      maxRealm: null,
      sourceType: "secret_realm",
      sourceInstanceId: params.context.instanceId,
      sourceMonsterId: params.context.monsterId,
      sourcePlayerId: params.playerId,
      sourceCategory: params.entry.category,
      generatedSeed: params.generatedSeed,
      sourceMeta: {
        theme: params.context.theme,
        role: params.context.role,
        route: params.entry.route || null,
        element,
        slotId: params.entry.slotId,
        dropStageKey: stageProfile.key,
      },
      createdAt,
    },
    drop: {
      itemId,
      itemName: name,
      itemIconUrl: iconUrl,
      quantity: 1,
      itemRarity: params.entry.rarity,
      itemSourceType: "secret_realm",
      itemCategoryLabel: CATEGORY_LABELS[params.entry.category],
    } satisfies CombatRewardDrop,
  };
}

async function buildEquipmentDrop(params: {
  entry: SecretRealmLootBlueprintEntry;
  context: RewardContext;
  playerId: string;
  generatedSeed: string;
}) {
  const equipmentAsset = await resolveEquipmentAsset(params.entry.route as SecretRealmEquipmentRoute | undefined, params.generatedSeed);
  if (!equipmentAsset) {
    throw new Error("秘境装备缺少专属图标，请先上传到 /uploads/cosmetics/item/ai-smithing/<equipment-route>/");
  }
  const route = equipmentAsset.route;
  const template = equipmentAsset.template;
  const stageProfile = getDropStageProfile(params.entry.dropStageKey || resolveSecretRealmDropStageKey(params.context.recommendedRealm));
  const rarityBonus = params.entry.rarity === "hongmeng"
    ? 5
    : params.entry.rarity === "legendary"
      ? 3
      : params.entry.rarity === "epic"
        ? 2
        : params.entry.rarity === "rare"
          ? 1
          : 0;
  const scalar = Math.max(1, stageProfile.scalar + rarityBonus);
  const flavor = buildFallbackEquipmentFlavor({
    seed: params.generatedSeed,
    realm: stageProfile.label,
    stageName: stageProfile.label,
    route: template.routeLabel,
    itemCategory: template.routeLabel,
    descriptionMaxLength: 30,
    materialTags: [params.context.monsterName, params.context.theme, params.entry.themeTag || "秘境"],
    themeTags: template.themeTags,
    storyHooks: [
      `${params.context.monsterName}死后余煞凝成器纹`,
      `${params.context.theme}遗韵沉入此器`,
    ],
    allowedAttributes: template.allowedAttributes(scalar),
    maxAttributeCount: 2,
  });
  const iconUrl = equipmentAsset.iconUrl;
  const itemId = `item_secret_realm_${route}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const effects = mergeEffects([
    ...template.baseEffects(scalar),
    ...flavor.affixes.map((affix) => ({ type: affix.key as ItemEffect["type"], value: affix.value })),
  ]);
  const name = normalizeText(flavor.name, 6, `${template.routeLabel}器`);
  const createdAt = new Date().toISOString();
  return {
    itemId,
    itemRow: {
      id: itemId,
      templateItemId: null,
      name,
      iconUrl,
      description: normalizeText(flavor.description, 30, "此器藏有秘境余威。"),
      itemType: template.itemType,
      rarity: params.entry.rarity,
      effects,
      pillToxicity: 0,
      price: Math.max(80, 100 * scalar),
      stackable: false,
      isBound: false,
      minRealm: stageProfile.minRealm,
      maxRealm: null,
      sourceType: "secret_realm",
      sourceInstanceId: params.context.instanceId,
      sourceMonsterId: params.context.monsterId,
      sourcePlayerId: params.playerId,
      sourceCategory: params.entry.category,
      generatedSeed: params.generatedSeed,
      sourceMeta: {
        theme: params.context.theme,
        role: params.context.role,
        route,
        element: params.entry.element || null,
        slotId: params.entry.slotId,
        dropStageKey: stageProfile.key,
      },
      createdAt,
    },
    drop: {
      itemId,
      itemName: name,
      itemIconUrl: iconUrl,
      quantity: 1,
      itemRarity: params.entry.rarity,
      itemSourceType: "secret_realm",
      itemCategoryLabel: CATEGORY_LABELS.equipment,
    } satisfies CombatRewardDrop,
  };
}

async function grantSeedDropTx(tx: RewardTx, playerId: string, context: RewardContext, entry: SecretRealmLootBlueprintEntry, generatedSeed: string) {
  const themeProfile = buildSecretRealmThemeProfile(context.theme, context.templateTags);
  const minimumSeedRarityRank = context.role === "boss"
    ? (context.recommendedRealm >= 21 ? getRarityRank("epic") : getRarityRank("rare"))
    : context.role === "elite"
      ? (context.recommendedRealm >= 21 ? getRarityRank("epic") : getRarityRank("rare"))
      : getRarityRank("uncommon");
  const stageProfile = getDropStageProfile(entry.dropStageKey || resolveSecretRealmDropStageKey(context.recommendedRealm));
  const candidates = (await listSeedTemplatesTx(tx)).filter((candidate) => (
    matchesDropStageRange({
      minRealm: candidate.minRealm,
      maxRealm: candidate.maxRealm,
      dropStageKey: stageProfile.formalStageKey,
      recommendedRealm: context.recommendedRealm,
    })
    && getRarityRank(candidate.rarity) >= minimumSeedRarityRank
  ));
  if (candidates.length === 0) {
    return null;
  }
  const themedCandidates = candidates.filter((candidate) => (
    candidate.dropThemeTags.length === 0
    || candidate.dropThemeTags.some((tag) => (
      (tag === "forest" && themeProfile.themeTags.includes("荒林"))
      || (tag === "water" && themeProfile.preferredElements.includes("water"))
      || (tag === "pill" && themeProfile.themeTags.includes("药气"))
      || (tag === "growth" && themeProfile.preferredCategories.includes("herb_seed"))
      || (tag === "ore" && themeProfile.themeTags.includes("矿脉"))
      || (tag === "ruins" && themeProfile.themeTags.includes("残煞"))
    ))
  ));
  const pool = themedCandidates.length > 0 ? themedCandidates : candidates;
  const weightedPool = pool.flatMap((candidate) => Array.from({
    length: Math.max(1, Math.min(8, Number(candidate.secretRealmWeight || 1))),
  }, () => candidate));
  const picked = pickFromSeed(generatedSeed, weightedPool);
  const quantity = clampNumber(entry.quantityMin + Math.floor(seededRandom(`${generatedSeed}:quantity`) * Math.max(1, entry.quantityMax - entry.quantityMin + 1)), entry.quantityMin, entry.quantityMax);
  await addInventoryStackTx(tx, playerId, picked.itemId, quantity);
  return {
    itemId: picked.itemId,
    itemName: picked.seedName || picked.itemName,
    itemIconUrl: picked.itemIconUrl || null,
    quantity,
    itemRarity: picked.rarity || entry.rarity,
    itemSourceType: "secret_realm",
    itemCategoryLabel: CATEGORY_LABELS.herb_seed,
  } satisfies CombatRewardDrop;
}

async function buildRewardForEntryTx(params: {
  tx: RewardTx;
  playerId: string;
  context: RewardContext;
  entry: SecretRealmLootBlueprintEntry;
  generatedSeed: string;
}) {
  let lastError: unknown = null;

  for (const category of buildCategoryFallbackOrder(params.entry.category)) {
    const resolvedEntry = buildFallbackEntry(params.entry, category, params.generatedSeed);
    const categoryAvailable = await isRewardCategoryAssetAvailable(category);
    if (!categoryAvailable) {
      warnSecretRealmRewardOnce(
        `secret-realm-reward-category-unavailable:${category}`,
        {
          message: "Secret realm reward category unavailable",
          category,
          fromCategory: params.entry.category,
          instanceId: params.context.instanceId,
          monsterId: params.context.monsterId,
          detail: category === "existing_material"
            ? "正式灵材池为空或不匹配当前境界，已自动跳过该类别"
            : category === "alchemy_material"
            ? "秘境丹材专属图标池为空，已自动跳过该类别"
            : category === "smithing_material"
              ? "秘境器材专属图标池为空，已自动跳过该类别"
              : "秘境装备专属图标池为空，已自动跳过该类别",
        },
      );
      continue;
    }

    try {
      if (category === "existing_material") {
        const existingMaterialDrop = await grantExistingMaterialDropTx(
          params.tx,
          params.playerId,
          params.context,
          resolvedEntry,
          params.generatedSeed,
        );
        if (existingMaterialDrop) {
          return {
            kind: "stack" as const,
            drop: existingMaterialDrop,
          };
        }
        continue;
      }

      if (category === "herb_seed") {
        const seedDrop = await grantSeedDropTx(
          params.tx,
          params.playerId,
          params.context,
          resolvedEntry,
          params.generatedSeed,
        );
        if (seedDrop) {
          return {
            kind: "stack" as const,
            drop: seedDrop,
          };
        }
        continue;
      }

      const built = category === "equipment"
        ? await buildEquipmentDrop({
          entry: resolvedEntry,
          context: params.context,
          playerId: params.playerId,
          generatedSeed: params.generatedSeed,
        })
        : await buildMaterialDrop({
          entry: resolvedEntry,
          context: params.context,
          playerId: params.playerId,
          generatedSeed: params.generatedSeed,
        });

      return {
        kind: "item" as const,
        built,
      };
    } catch (error) {
      if (isDatabaseExecutionError(error)) {
        throw error;
      }
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      warnSecretRealmRewardOnce(
        `secret-realm-reward-slot-fallback:${params.entry.category}:${category}:${message}`,
        {
          message: "Secret realm reward slot fallback",
          instanceId: params.context.instanceId,
          monsterId: params.context.monsterId,
          playerId: params.playerId,
          slotId: params.entry.slotId,
          fromCategory: params.entry.category,
          tryCategory: category,
          error: message,
        },
      );
    }
  }

  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    warnSecretRealmRewardOnce(
      `secret-realm-reward-slot-exhausted:${params.entry.category}:${message}`,
      {
        message: "Secret realm reward slot skipped after fallback exhaustion",
        instanceId: params.context.instanceId,
        monsterId: params.context.monsterId,
        playerId: params.playerId,
        slotId: params.entry.slotId,
        category: params.entry.category,
        error: message,
      },
    );
  }
  return null;
}

function buildBossPityEntry(params: {
  context: RewardContext;
  attempt: number;
  generatedSeed: string;
}): SecretRealmLootBlueprintEntry {
  const themeProfile = buildThemeProfile(params.context.theme, [params.context.monsterName, params.context.monsterDescription || ""]);
  const preferredMaterialCategories = themeProfile.preferredCategories.filter((category) => (
    category === "alchemy_material" || category === "smithing_material"
  )) as Array<(typeof BOSS_PITY_MATERIAL_CATEGORIES)[number]>;
  const categoryWeights: Record<(typeof BOSS_PITY_MATERIAL_CATEGORIES)[number], number> = {
    alchemy_material: 50,
    smithing_material: 50,
  };
  for (const category of preferredMaterialCategories) {
    categoryWeights[category] += 20;
  }
  const category = weightedPick(
    `${params.generatedSeed}:boss-pity:category`,
    categoryWeights,
    preferredMaterialCategories[0] || "alchemy_material",
  ) as (typeof BOSS_PITY_MATERIAL_CATEGORIES)[number];
  const elementPool = themeProfile.preferredElements.length > 0 ? themeProfile.preferredElements : SECRET_REALM_ELEMENTS;
  const element = pickFromSeed(`${params.generatedSeed}:boss-pity:element`, elementPool);
  const route = category === "alchemy_material"
    ? pickFromSeed(`${params.generatedSeed}:boss-pity:route`, ALCHEMY_ROUTES)
    : undefined;

  return {
    slotId: `boss_pity_${params.attempt}`,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    rarity: getBossPityTargetRarity(params.attempt),
    quantityMin: 1,
    quantityMax: 1,
    chance: 1,
    element,
    route,
    dropStageKey: pickDropStageKey({
      recommendedRealm: params.context.recommendedRealm,
      role: params.context.role,
      rarity: getBossPityTargetRarity(params.attempt),
      seed: `${params.generatedSeed}:drop-stage`,
    }),
    themeTag: themeProfile.themeTags[0] || "秘境余韵",
    usageLabel: category === "alchemy_material"
      ? ALCHEMY_ROUTE_LABELS[route as SecretRealmAlchemyRoute]
      : CATEGORY_LABELS[category],
    uniquePerPlayer: true,
  };
}

function buildHongmengMaterialEntry(params: {
  context: RewardContext;
  slotKey: string;
  generatedSeed: string;
}): SecretRealmLootBlueprintEntry {
  const themeProfile = buildThemeProfile(params.context.theme, [params.context.monsterName, params.context.monsterDescription || ""]);
  const preferredMaterialCategories = themeProfile.preferredCategories.filter((category) => (
    category === "alchemy_material" || category === "smithing_material"
  )) as Array<(typeof HONGMENG_PITY_MATERIAL_CATEGORIES)[number]>;
  const categoryWeights: Record<(typeof HONGMENG_PITY_MATERIAL_CATEGORIES)[number], number> = {
    alchemy_material: 50,
    smithing_material: 50,
  };
  for (const category of preferredMaterialCategories) {
    categoryWeights[category] += 18;
  }
  const category = weightedPick(
    `${params.generatedSeed}:hongmeng-pity:category`,
    categoryWeights,
    preferredMaterialCategories[0] || "alchemy_material",
  ) as (typeof HONGMENG_PITY_MATERIAL_CATEGORIES)[number];
  const elementPool = themeProfile.preferredElements.length > 0 ? themeProfile.preferredElements : SECRET_REALM_ELEMENTS;
  const element = pickFromSeed(`${params.generatedSeed}:hongmeng-pity:element`, elementPool);
  const route = category === "alchemy_material"
    ? pickFromSeed(`${params.generatedSeed}:hongmeng-pity:route`, ALCHEMY_ROUTES)
    : undefined;

  return {
    slotId: params.slotKey,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    rarity: "hongmeng",
    quantityMin: 1,
    quantityMax: 1,
    chance: 1,
    element,
    route,
    dropStageKey: pickDropStageKey({
      recommendedRealm: params.context.recommendedRealm,
      role: params.context.role,
      rarity: "hongmeng",
      seed: `${params.generatedSeed}:drop-stage`,
    }),
    themeTag: themeProfile.themeTags[0] || "鸿蒙余辉",
    usageLabel: category === "alchemy_material"
      ? ALCHEMY_ROUTE_LABELS[route as SecretRealmAlchemyRoute]
      : CATEGORY_LABELS[category],
    uniquePerPlayer: true,
  };
}

async function grantBossPityDropTx(params: {
  tx: RewardTx;
  playerId: string;
  context: RewardContext;
  attempt: number;
}) {
  const generatedSeed = `${params.context.runId || params.context.instanceId}:${params.context.monsterId}:${params.playerId}:boss-pity:${params.attempt}`;
  const primaryEntry = buildBossPityEntry({
    context: params.context,
    attempt: params.attempt,
    generatedSeed,
  });
  const fallbackCategories = BOSS_PITY_MATERIAL_CATEGORIES.filter((category) => category !== primaryEntry.category);
  const entryQueue = [
    primaryEntry,
    ...fallbackCategories.map((category, index) => {
      const route = category === "alchemy_material"
        ? pickFromSeed(`${generatedSeed}:boss-pity:fallback:${index + 1}`, ALCHEMY_ROUTES)
        : undefined;
      return {
        ...primaryEntry,
        slotId: `${primaryEntry.slotId}_fallback_${index + 1}`,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        route,
        usageLabel: category === "alchemy_material"
          ? ALCHEMY_ROUTE_LABELS[route as SecretRealmAlchemyRoute]
          : CATEGORY_LABELS[category],
      };
    }),
  ];

  let lastError: unknown = null;
  for (const entry of entryQueue) {
    try {
      const built = await buildMaterialDrop({
        entry,
        context: params.context,
        playerId: params.playerId,
        generatedSeed: `${generatedSeed}:${entry.category}`,
      });
      await insertItemCompat(built.itemRow, params.tx);
      await params.tx.insert(playerInventory).values({
        playerId: params.playerId,
        itemId: built.itemId,
        quantity: 1,
        equipped: false,
      }).run();
      return built.drop;
    } catch (error) {
      if (isDatabaseExecutionError(error)) {
        throw error;
      }
      lastError = error;
      warnSecretRealmRewardOnce(
        `secret-realm-boss-pity-fallback:${entry.category}:${params.context.instanceId}:${params.context.monsterId}`,
        {
          message: "Secret realm boss pity material fallback",
          instanceId: params.context.instanceId,
          monsterId: params.context.monsterId,
          playerId: params.playerId,
          tryCategory: entry.category,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("秘境金材保底奖励生成失败"));
}

async function grantHongmengPityDropTx(params: {
  tx: RewardTx;
  playerId: string;
  context: RewardContext;
  attempt: number;
}) {
  const generatedSeed = `${params.context.runId || params.context.instanceId}:${params.context.monsterId}:${params.playerId}:hongmeng-pity:${params.attempt}`;
  const primaryEntry = buildHongmengMaterialEntry({
    context: params.context,
    slotKey: `hongmeng_pity_${params.attempt}`,
    generatedSeed,
  });
  const fallbackCategories = HONGMENG_PITY_MATERIAL_CATEGORIES.filter((category) => category !== primaryEntry.category);
  const entryQueue = [
    primaryEntry,
    ...fallbackCategories.map((category, index) => {
      const route = category === "alchemy_material"
        ? pickFromSeed(`${generatedSeed}:hongmeng-pity:fallback:${index + 1}`, ALCHEMY_ROUTES)
        : undefined;
      return {
        ...primaryEntry,
        slotId: `${primaryEntry.slotId}_fallback_${index + 1}`,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        route,
        usageLabel: category === "alchemy_material"
          ? ALCHEMY_ROUTE_LABELS[route as SecretRealmAlchemyRoute]
          : CATEGORY_LABELS[category],
      };
    }),
  ];

  let lastError: unknown = null;
  for (const entry of entryQueue) {
    try {
      const built = await buildMaterialDrop({
        entry,
        context: params.context,
        playerId: params.playerId,
        generatedSeed: `${generatedSeed}:${entry.category}`,
      });
      await insertItemCompat(built.itemRow, params.tx);
      await params.tx.insert(playerInventory).values({
        playerId: params.playerId,
        itemId: built.itemId,
        quantity: 1,
        equipped: false,
      }).run();
      return built.drop;
    } catch (error) {
      if (isDatabaseExecutionError(error)) {
        throw error;
      }
      lastError = error;
      warnSecretRealmRewardOnce(
        `secret-realm-hongmeng-pity-fallback:${entry.category}:${params.context.instanceId}:${params.context.monsterId}`,
        {
          message: "Secret realm hongmeng pity material fallback",
          instanceId: params.context.instanceId,
          monsterId: params.context.monsterId,
          playerId: params.playerId,
          tryCategory: entry.category,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("秘境鸿蒙保底奖励生成失败"));
}

async function grantBossNaturalHongmengDropTx(params: {
  tx: RewardTx;
  playerId: string;
  context: RewardContext;
}) {
  const generatedSeed = `${params.context.runId || params.context.instanceId}:${params.context.monsterId}:${params.playerId}:boss-hongmeng-natural`;
  const primaryEntry = buildHongmengMaterialEntry({
    context: params.context,
    slotKey: "boss_hongmeng_natural",
    generatedSeed,
  });
  const fallbackCategories = HONGMENG_PITY_MATERIAL_CATEGORIES.filter((category) => category !== primaryEntry.category);
  const entryQueue = [
    primaryEntry,
    ...fallbackCategories.map((category, index) => {
      const route = category === "alchemy_material"
        ? pickFromSeed(`${generatedSeed}:boss-hongmeng-natural:fallback:${index + 1}`, ALCHEMY_ROUTES)
        : undefined;
      return {
        ...primaryEntry,
        slotId: `${primaryEntry.slotId}_fallback_${index + 1}`,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        route,
        usageLabel: category === "alchemy_material"
          ? ALCHEMY_ROUTE_LABELS[route as SecretRealmAlchemyRoute]
          : CATEGORY_LABELS[category],
      };
    }),
  ];

  let lastError: unknown = null;
  for (const entry of entryQueue) {
    try {
      const built = await buildMaterialDrop({
        entry,
        context: params.context,
        playerId: params.playerId,
        generatedSeed: `${generatedSeed}:${entry.category}`,
      });
      await insertItemCompat(built.itemRow, params.tx);
      await params.tx.insert(playerInventory).values({
        playerId: params.playerId,
        itemId: built.itemId,
        quantity: 1,
        equipped: false,
      }).run();
      return built.drop;
    } catch (error) {
      if (isDatabaseExecutionError(error)) {
        throw error;
      }
      lastError = error;
      warnSecretRealmRewardOnce(
        `secret-realm-boss-natural-hongmeng-fallback:${entry.category}:${params.context.instanceId}:${params.context.monsterId}`,
        {
          message: "Secret realm boss natural hongmeng material fallback",
          instanceId: params.context.instanceId,
          monsterId: params.context.monsterId,
          playerId: params.playerId,
          tryCategory: entry.category,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("秘境鸿蒙自然掉落生成失败"));
}

export async function grantSecretRealmMonsterPlayerRewards(params: {
  monsterId: string;
  playerId: string;
  xp: number;
  gold: number;
  noRewardReason?: "stamina_empty" | "repeat_guard_blocked";
  projectedResources?: { hp?: number; mp?: number };
  markMonsterDefeated?: boolean;
}): Promise<RewardResult | null> {
  await ensurePlayerInventoryIntegrity();
  const context = await getRewardContext(params.monsterId);
  if (!context) {
    return null;
  }

  const result = await db.transaction(async (tx) => {
    const existingClaim = await tx.select().from(secretRealmRewardClaims).where(and(
      eq(secretRealmRewardClaims.instanceId, context.instanceId),
      eq(secretRealmRewardClaims.monsterId, params.monsterId),
      eq(secretRealmRewardClaims.playerId, params.playerId),
    )).get();
    if (existingClaim) {
      return readClaim(existingClaim);
    }

    const nowIso = new Date().toISOString();
    const placeholder = await tx.insert(secretRealmRewardClaims).values({
      runId: context.runId,
      instanceId: context.instanceId,
      monsterId: params.monsterId,
      playerId: params.playerId,
      role: context.role,
      status: "pending",
      xp: 0,
      gold: 0,
      rewardSnapshot: { xp: 0, gold: 0, drops: [] },
      grantedItemIds: [],
      claimedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoNothing().returning().get();
    if (!placeholder) {
      const claimed = await tx.select().from(secretRealmRewardClaims).where(and(
        eq(secretRealmRewardClaims.instanceId, context.instanceId),
        eq(secretRealmRewardClaims.monsterId, params.monsterId),
        eq(secretRealmRewardClaims.playerId, params.playerId),
      )).get();
      return claimed ? readClaim(claimed) : null;
    }

    const playerRow = await lockPlayerRowTx(tx, params.playerId);
    if (!playerRow) {
      throw new Error("玩家不存在");
    }

    const drops: CombatRewardDrop[] = [];
    const grantedItemIds: string[] = [];
    let legendaryPitySnapshot: SecretRealmBossPitySnapshot | undefined;
    let hongmengPitySnapshot: SecretRealmHongmengPitySnapshot | undefined;
    let wildWolfValleyBottleSnapshot: SecretRealmRewardSnapshot["wildWolfValleyBottle"] | undefined;
    const hasBottleBeforeRoll = context.isWildWolfValley
      ? await hasInventoryItemTx(tx, params.playerId, HONGMENG_BOTTLE_ITEM_ID)
      : false;
    if (!params.noRewardReason) {
      if (
        context.isWildWolfValley
        && hasBottleBeforeRoll
        && (
          Number(playerRow.wild_wolf_valley_mob_bottle_pity_counter || 0) > 0
          || Number(playerRow.wild_wolf_valley_boss_bottle_pity_counter || 0) > 0
        )
      ) {
        await tx.update(players).set({
          wildWolfValleyMobBottlePityCounter: 0,
          wildWolfValleyBossBottlePityCounter: 0,
          updatedAt: nowIso,
        }).where(eq(players.id, params.playerId)).run();
      }

      const blueprint = await resolveBlueprintTx(tx, context);
      for (const entry of blueprint.entries || []) {
        const generatedSeed = `${context.runId || context.instanceId}:${context.monsterId}:${params.playerId}:${entry.slotId}`;
        if (seededRandom(`${generatedSeed}:roll`) > clampNumber(entry.chance, 0, 1)) {
          continue;
        }
        const builtReward = await buildRewardForEntryTx({
          tx,
          playerId: params.playerId,
          context,
          entry,
          generatedSeed,
        });
        if (!builtReward) {
          continue;
        }
        if (builtReward.kind === "stack") {
          drops.push(builtReward.drop);
          grantedItemIds.push(builtReward.drop.itemId);
          continue;
        }
        await insertItemCompat(builtReward.built.itemRow, tx);
        await tx.insert(playerInventory).values({
          playerId: params.playerId,
          itemId: builtReward.built.itemId,
          quantity: 1,
          equipped: false,
        }).run();
        drops.push(builtReward.built.drop);
        grantedItemIds.push(builtReward.built.itemId);
      }

      if (
        canGrantBossHongmengDrops(context.role)
        && !drops.some((drop) => isMaterialDropAtLeastRarity(drop, "hongmeng"))
        && seededRandom(`${context.runId || context.instanceId}:${context.monsterId}:${params.playerId}:boss-natural-hongmeng-roll`) < BOSS_NATURAL_HONGMENG_DROP_CHANCE
      ) {
        const naturalHongmengDrop = await grantBossNaturalHongmengDropTx({
          tx,
          playerId: params.playerId,
          context,
        });
        drops.push(naturalHongmengDrop);
        grantedItemIds.push(naturalHongmengDrop.itemId);
      }

      if (context.isWildWolfValley && !hasBottleBeforeRoll) {
        const counterBefore = context.role === "boss"
          ? Math.max(0, Number(playerRow.wild_wolf_valley_boss_bottle_pity_counter || 0))
          : Math.max(0, Number(playerRow.wild_wolf_valley_mob_bottle_pity_counter || 0));
        const chance = getWildWolfValleyBottleChance({
          role: context.role,
          counter: counterBefore,
        });
        const rollSeed = `${context.runId || context.instanceId}:${context.monsterId}:${params.playerId}:wild-wolf-valley:bottle:${context.role}:${counterBefore}`;
        const granted = seededRandom(rollSeed) < chance;
        const counterAfter = granted ? 0 : counterBefore + 1;

        if (granted) {
          const bottleDrop = await grantWildWolfValleyBottleTx({
            tx,
            playerId: params.playerId,
          });
          drops.push(bottleDrop);
          grantedItemIds.push(bottleDrop.itemId);
          await tx.update(players).set({
            wildWolfValleyMobBottlePityCounter: 0,
            wildWolfValleyBossBottlePityCounter: 0,
            updatedAt: nowIso,
          }).where(eq(players.id, params.playerId)).run();
        } else if (context.role === "boss") {
          await tx.update(players).set({
            wildWolfValleyBossBottlePityCounter: counterAfter,
            updatedAt: nowIso,
          }).where(eq(players.id, params.playerId)).run();
        } else {
          await tx.update(players).set({
            wildWolfValleyMobBottlePityCounter: counterAfter,
            updatedAt: nowIso,
          }).where(eq(players.id, params.playerId)).run();
        }

        wildWolfValleyBottleSnapshot = {
          ownedBeforeRoll: false,
          role: context.role,
          chance,
          counterBefore,
          counterAfter,
          granted,
          ...(granted ? { grantedItemId: HONGMENG_BOTTLE_ITEM_ID } : {}),
        };
      }

      const nextLegendaryPityCounter = canGrantBossLegendaryPity(context.role)
        ? (() => {
          const legendaryPityAttempt = getBossPityAttempt(playerRow.secret_realm_pity_counter);
          const legendaryPityChance = getBossPityChance(legendaryPityAttempt);
          const legendaryTargetRarity = getBossPityTargetRarity(legendaryPityAttempt);
          const hasLegendaryMaterialBeforePity = drops.some((drop) => isMaterialDropAtLeastRarity(drop, "legendary"));
          const shouldTriggerLegendaryPity = !hasLegendaryMaterialBeforePity && (
            legendaryPityAttempt >= BOSS_PITY_HARD_GUARANTEE_ATTEMPT
            || seededRandom(`${context.runId || context.instanceId}:${context.monsterId}:${params.playerId}:legendary-pity-roll:${legendaryPityAttempt}`) < legendaryPityChance
          );

          if (shouldTriggerLegendaryPity) {
            return grantBossPityDropTx({
              tx,
              playerId: params.playerId,
              context,
              attempt: legendaryPityAttempt,
            }).then((legendaryPityDrop) => {
              drops.push(legendaryPityDrop);
              grantedItemIds.push(legendaryPityDrop.itemId);
              const hasLegendaryMaterialAfterSettle = drops.some((drop) => isMaterialDropAtLeastRarity(drop, "legendary"));
              const resolvedNextCounter = hasLegendaryMaterialAfterSettle
                ? 0
                : Math.min(BOSS_PITY_MAX_COUNTER, Math.max(0, Number(playerRow.secret_realm_pity_counter || 0)) + 1);
              legendaryPitySnapshot = {
                attempt: legendaryPityAttempt,
                chance: legendaryPityChance,
                targetRarity: legendaryTargetRarity,
                requiredLegendaryMaterial: legendaryPityAttempt >= BOSS_PITY_HARD_GUARANTEE_ATTEMPT,
                triggered: true,
                grantedDropItemId: legendaryPityDrop.itemId,
                grantedDropRarity: legendaryPityDrop.itemRarity || null,
                counterAfterSettle: resolvedNextCounter,
                resetReason: hasLegendaryMaterialAfterSettle ? "legendary_material" : undefined,
              };
              return resolvedNextCounter;
            });
          }

          const hasLegendaryMaterialAfterSettle = drops.some((drop) => isMaterialDropAtLeastRarity(drop, "legendary"));
          const resolvedNextCounter = hasLegendaryMaterialAfterSettle
            ? 0
            : Math.min(BOSS_PITY_MAX_COUNTER, Math.max(0, Number(playerRow.secret_realm_pity_counter || 0)) + 1);
          legendaryPitySnapshot = {
            attempt: legendaryPityAttempt,
            chance: legendaryPityChance,
            targetRarity: legendaryTargetRarity,
            requiredLegendaryMaterial: legendaryPityAttempt >= BOSS_PITY_HARD_GUARANTEE_ATTEMPT,
            triggered: false,
            counterAfterSettle: resolvedNextCounter,
            resetReason: hasLegendaryMaterialAfterSettle ? "legendary_material" : "not_triggered",
          };
          return Promise.resolve(resolvedNextCounter);
        })()
        : Promise.resolve(Math.max(0, Number(playerRow.secret_realm_pity_counter || 0)));

      const nextHongmengPityCounter = canGrantBossHongmengDrops(context.role)
        ? (() => {
          const hongmengPityAttempt = getHongmengPityAttempt(playerRow.secret_realm_hongmeng_pity_counter);
          const hongmengPityChance = getHongmengPityChance(hongmengPityAttempt);
          const hasHongmengMaterialBeforePity = drops.some((drop) => isMaterialDropAtLeastRarity(drop, "hongmeng"));
          const shouldTriggerHongmengPity = !hasHongmengMaterialBeforePity && (
            hongmengPityAttempt >= HONGMENG_PITY_HARD_GUARANTEE_ATTEMPT
            || seededRandom(`${context.runId || context.instanceId}:${context.monsterId}:${params.playerId}:hongmeng-pity-roll:${hongmengPityAttempt}`) < hongmengPityChance
          );

          if (shouldTriggerHongmengPity) {
            return grantHongmengPityDropTx({
              tx,
              playerId: params.playerId,
              context,
              attempt: hongmengPityAttempt,
            }).then((hongmengPityDrop) => {
              drops.push(hongmengPityDrop);
              grantedItemIds.push(hongmengPityDrop.itemId);
              const hasHongmengMaterialAfterSettle = drops.some((drop) => isMaterialDropAtLeastRarity(drop, "hongmeng"));
              const resolvedNextCounter = hasHongmengMaterialAfterSettle
                ? 0
                : Math.min(HONGMENG_PITY_MAX_COUNTER, Math.max(0, Number(playerRow.secret_realm_hongmeng_pity_counter || 0)) + 1);
              hongmengPitySnapshot = {
                attempt: hongmengPityAttempt,
                chance: hongmengPityChance,
                triggered: true,
                grantedDropItemId: hongmengPityDrop.itemId,
                grantedDropRarity: hongmengPityDrop.itemRarity || null,
                counterAfterSettle: resolvedNextCounter,
                resetReason: hasHongmengMaterialAfterSettle ? "hongmeng_material" : undefined,
              };
              return resolvedNextCounter;
            });
          }

          const hasHongmengMaterialAfterSettle = drops.some((drop) => isMaterialDropAtLeastRarity(drop, "hongmeng"));
          const resolvedNextCounter = hasHongmengMaterialAfterSettle
            ? 0
            : Math.min(HONGMENG_PITY_MAX_COUNTER, Math.max(0, Number(playerRow.secret_realm_hongmeng_pity_counter || 0)) + 1);
          hongmengPitySnapshot = {
            attempt: hongmengPityAttempt,
            chance: hongmengPityChance,
            triggered: false,
            counterAfterSettle: resolvedNextCounter,
            resetReason: hasHongmengMaterialAfterSettle ? "hongmeng_material" : "not_triggered",
          };
          return Promise.resolve(resolvedNextCounter);
        })()
        : Promise.resolve(Math.max(0, Number(playerRow.secret_realm_hongmeng_pity_counter || 0)));

      await tx.update(players).set({
        secretRealmPityCounter: await nextLegendaryPityCounter,
        secretRealmHongmengPityCounter: await nextHongmengPityCounter,
        updatedAt: nowIso,
      }).where(eq(players.id, params.playerId)).run();
    }

    await tx.update(players).set({
      cultivationXp: Number(playerRow.cultivation_xp || 0) + Math.max(0, Math.floor(params.xp || 0)),
      gold: Number(playerRow.gold || 0) + Math.max(0, Math.floor(params.gold || 0)),
      ...(typeof params.projectedResources?.hp === "number" ? { hp: params.projectedResources.hp } : {}),
      ...(typeof params.projectedResources?.mp === "number" ? { mp: params.projectedResources.mp } : {}),
      ...(params.noRewardReason ? {
        secretRealmPityCounter: Math.max(0, Number(playerRow.secret_realm_pity_counter || 0)),
        secretRealmHongmengPityCounter: Math.max(0, Number(playerRow.secret_realm_hongmeng_pity_counter || 0)),
      } : {}),
      updatedAt: nowIso,
    }).where(eq(players.id, params.playerId)).run();

    if (params.markMonsterDefeated ?? context.role !== "boss") {
      await markMonsterDefeatedTx(tx, context, nowIso);
    }

    const snapshot: SecretRealmRewardSnapshot = {
      xp: Math.max(0, Math.floor(params.xp || 0)),
      gold: Math.max(0, Math.floor(params.gold || 0)),
      drops,
      grantedItemIds,
      ...(params.noRewardReason ? { noRewardReason: params.noRewardReason } : {}),
      ...(legendaryPitySnapshot ? {
        bossPity: legendaryPitySnapshot,
        legendaryPity: legendaryPitySnapshot,
      } : {}),
      ...(hongmengPitySnapshot ? { hongmengPity: hongmengPitySnapshot } : {}),
      ...(wildWolfValleyBottleSnapshot ? { wildWolfValleyBottle: wildWolfValleyBottleSnapshot } : {}),
    };
    await tx.update(secretRealmRewardClaims).set({
      status: params.noRewardReason ? "no_reward" : "claimed",
      xp: snapshot.xp,
      gold: snapshot.gold,
      noRewardReason: params.noRewardReason || null,
      rewardSnapshot: snapshot,
      grantedItemIds,
      claimedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(secretRealmRewardClaims.id, placeholder.id)).run();
    await upsertRunSummaryTx(tx, context.runId, params.playerId, nowIso);

    return {
      isSecretRealm: true,
      reusedClaim: false,
      xp: snapshot.xp,
      gold: snapshot.gold,
      drops,
      noRewardReason: params.noRewardReason,
      grantedItemIds,
    } satisfies RewardResult;
  });

  if (
    result
    && !result.reusedClaim
    && (params.markMonsterDefeated ?? context.role !== "boss")
  ) {
    clearMonsterAiRuntimeForMonsters({
      mapId: context.mapId,
      monsterIds: [context.monsterId],
    });
    advanceMapSceneTick(context.mapId);
    publishMapRefresh({
      mapId: context.mapId,
      reason: "monster_defeat",
    });
  }

  if (
    result
    && !result.reusedClaim
    && result.grantedItemIds.includes(HONGMENG_BOTTLE_ITEM_ID)
  ) {
    const playerName = await db.select({
      name: players.name,
    }).from(players).where(eq(players.id, params.playerId)).get();
    const broadcasterName = playerName?.name?.trim() || "无名修士";
    void publishTiandaoDualChannelAnnouncement(
      `【鸿蒙至宝】${broadcasterName} 获得了鸿蒙至宝「掌天瓶」！`,
    ).catch((error) => {
      console.error("Wild Wolf Valley bottle announcement error:", error);
    });
  }

  return result;
}
