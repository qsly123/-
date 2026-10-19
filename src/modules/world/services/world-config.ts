import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { getSystemConfigJsonValue, getSystemConfigMap } from "@/modules/system/services/system-config";
import { OPEN_WORLD_SYSTEM_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

export const OPEN_WORLD_MAP_SIZE = 30;
export const OPEN_WORLD_NPCS_PER_MAP = 24;
export const OPEN_WORLD_ACTIVE_NPC_LIMIT = 12;
export const OPEN_WORLD_MAP_TYPE = "open_world";
export const OPEN_WORLD_LOCAL_CHAT_LIMIT = 100;
export const OPEN_WORLD_LAYOUT_VERSION = 5;
const OPEN_WORLD_KEYWORD_POOL_CACHE_TTL_MS = 5_000;
const OPEN_WORLD_KEYWORD_POOL_CONFIG_KEY = "OPEN_WORLD_KEYWORD_POOL_JSON";
const OPEN_WORLD_PRESSURE_RELIEF_RULES_CONFIG_KEY = "OPEN_WORLD_PRESSURE_RELIEF_RULES_JSON";
const OPEN_WORLD_CUSTOM_NPC_LIBRARY_CONFIG_KEY = "OPEN_WORLD_CUSTOM_NPC_LIBRARY_JSON";
const OPEN_WORLD_CUSTOM_NPC_PER_MAP_LIMIT = 4;

export type OpenWorldPressureTarget = "notorietyScore" | "bountyHeat" | "shadowFavor" | "lawfulPressure";
export type OpenWorldPressureReliefOfferType =
  | "pressure_cleanse"
  | "rumor_silence"
  | "lawful_mediation"
  | "consensual_dual_cultivation";
export type OpenWorldCoerciveFlavorLevel = "low" | "medium" | "high";
export type OpenWorldForcedAction = "rob_lingyu" | "forced_teleport" | "forced_dual_cultivation";

export type OpenWorldPressureReliefRule = {
  offerType: OpenWorldPressureReliefOfferType;
  enabled: boolean;
  label: string;
  sourceFaction: string;
  baseReliefValue: number;
  pressureTargets: OpenWorldPressureTarget[];
  requiresKeywords: string[];
  consentRequired: boolean;
  coerciveFlavorLevel: OpenWorldCoerciveFlavorLevel;
  forcedActions: OpenWorldForcedAction[];
  summaryHint: string;
};

export type OpenWorldPressureReliefRules = {
  highCorruptionThreshold: number;
  perMapCustomNpcLimit: number;
  rules: OpenWorldPressureReliefRule[];
};

export type OpenWorldCustomNpcDefinition = {
  id: string;
  name: string;
  gender: "male" | "female";
  originType: string;
  profession: string;
  faction: string;
  realmMinor: number;
  personalitySummary: string;
  traitTags: string[];
  worldBookKeywords: string[];
  adultTags: string[];
  grayTags: string[];
  preferredMapIds: string[];
  preferredMapTags: string[];
  writeToRandomPool: boolean;
  allowDynamicWorldSpawn: boolean;
  partnerIds: string[];
  primaryPartnerId: string;
  relationshipTags: string[];
};

export type OpenWorldCustomNpcLibrary = {
  npcs: OpenWorldCustomNpcDefinition[];
};

export type OpenWorldForcedRuleSnapshot = {
  highCorruptionThreshold: number;
  playerForcedActions: OpenWorldForcedAction[];
  npcForcedActions: Extract<OpenWorldForcedAction, "rob_lingyu">[];
  perMapCustomNpcLimit: number;
};

export type OpenWorldAiKeywordPool = {
  femaleNames: string[];
  maleNames: string[];
  npcOrigins: string[];
  npcProfessions: string[];
  npcFactions: string[];
  npcTraits: string[];
  npcPersonalityKeywords: string[];
  npcLifeKeywords: string[];
  npcSocialKeywords: string[];
  relationshipKeywords: string[];
  districtKeywords: string[];
  resourceKeywords: string[];
  rumorKeywords: string[];
  marketBuyerTitles: string[];
};

const DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL: OpenWorldAiKeywordPool = {
  femaleNames: ["柳青禾", "苏月白", "何秋棠", "顾灵汐", "沈知遥", "宁小霜"],
  maleNames: ["陈砚生", "林渡", "谢临川", "周行简", "卫长风", "白景尘"],
  npcOrigins: ["寒门", "猎户", "散修", "坊市子弟", "山村", "边军遗孤", "流徙罪民", "旧矿孤儿"],
  npcProfessions: ["药农", "行脚商", "猎修", "摊主", "巡山人", "散修客", "夜行客", "黑市牙人"],
  npcFactions: ["无门散人", "市井", "山泽", "古道盟", "清风集", "北荒行营", "黑市暗线", "血煞旁门"],
  npcTraits: ["谨慎", "多疑", "热心", "贪利", "沉静", "狠辣", "爱酒", "念旧", "胆大", "机敏", "冷酷", "偏执", "薄情", "隐忍", "嗜血", "圆滑"],
  npcPersonalityKeywords: ["讲人情", "识进退", "爱惜脸面", "念旧账", "看重名声", "嘴上留分寸"],
  npcLifeKeywords: ["旧债未清", "替亲友奔走", "赶着换灵石", "想攒一份聘礼", "惦记山门人情", "顾着摊上的生计"],
  npcSocialKeywords: ["传话", "还礼", "照应", "搭伙", "还价", "换药", "借宿", "护送", "走动关系", "递帖"],
  relationshipKeywords: ["旧识", "同门", "街坊", "同行", "旧主顾", "酒友", "债主", "照应人"],
  districtKeywords: ["茶肆", "渡口", "药铺", "脚店", "夜摊", "巷口", "石桥", "旧祠"],
  resourceKeywords: ["灵草", "矿屑", "兽骨", "旧符", "药泥", "杂货", "黑货", "阵盘残片"],
  rumorKeywords: ["风声", "耳目", "口信", "暗线", "旧账", "黑市", "余波", "人情债"],
  marketBuyerTitles: ["行脚商", "坊市药客", "灰巷摊主", "旧货牙人", "灵材掮客", "山道客商"],
};

const DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES: OpenWorldPressureReliefRules = {
  highCorruptionThreshold: 75,
  perMapCustomNpcLimit: OPEN_WORLD_CUSTOM_NPC_PER_MAP_LIMIT,
  rules: [
    {
      offerType: "pressure_cleanse",
      enabled: true,
      label: "洗痕交易",
      sourceFaction: "灰线行商",
      baseReliefValue: 18,
      pressureTargets: ["notorietyScore", "lawfulPressure"],
      requiresKeywords: ["洗痕", "买路"],
      consentRequired: true,
      coerciveFlavorLevel: "medium",
      forcedActions: ["rob_lingyu"],
      summaryHint: "有人愿意替你洗去一段明面痕迹，但要收一笔不干净的人情。",
    },
    {
      offerType: "rumor_silence",
      enabled: true,
      label: "压风声",
      sourceFaction: "夜渡会",
      baseReliefValue: 14,
      pressureTargets: ["bountyHeat", "lawfulPressure"],
      requiresKeywords: ["压口风", "暗线"],
      consentRequired: true,
      coerciveFlavorLevel: "high",
      forcedActions: ["forced_dual_cultivation", "rob_lingyu", "forced_teleport"],
      summaryHint: "暗线愿意替你压一阵风声，但价码绝不只写在纸上。",
    },
    {
      offerType: "lawful_mediation",
      enabled: true,
      label: "守序调解",
      sourceFaction: "巡街修士",
      baseReliefValue: 12,
      pressureTargets: ["lawfulPressure", "notorietyScore"],
      requiresKeywords: ["赔礼", "递帖"],
      consentRequired: true,
      coerciveFlavorLevel: "low",
      forcedActions: [],
      summaryHint: "有人愿替你向守序一侧说项，但你得先把姿态放低。",
    },
    {
      offerType: "consensual_dual_cultivation",
      enabled: true,
      label: "合意双修洗痕",
      sourceFaction: "灰幕修士",
      baseReliefValue: 24,
      pressureTargets: ["bountyHeat", "lawfulPressure", "notorietyScore"],
      requiresKeywords: ["合意", "双修"],
      consentRequired: true,
      coerciveFlavorLevel: "high",
      forcedActions: ["rob_lingyu", "forced_teleport"],
      summaryHint: "一场双方都点头的双修，能最快把你眼前那点风声洗散。",
    },
  ],
};

const DEFAULT_OPEN_WORLD_CUSTOM_NPC_LIBRARY: OpenWorldCustomNpcLibrary = {
  npcs: [
    {
      id: "custom_lianye",
      name: "连夜",
      gender: "female",
      originType: "灰巷旧户",
      profession: "卖讯修士",
      faction: "夜渡会",
      realmMinor: 5,
      personalitySummary: "说话轻缓，却总像比你先知道半步风声。",
      traitTags: ["机敏", "圆滑", "多疑"],
      worldBookKeywords: ["夜渡会", "卖讯", "灰巷"],
      adultTags: ["试探", "合意双修"],
      grayTags: ["暗线", "压风声"],
      preferredMapIds: ["world_open_5", "world_open_15"],
      preferredMapTags: ["散修坊市带", "边荒灰域带"],
      writeToRandomPool: true,
      allowDynamicWorldSpawn: true,
      partnerIds: [],
      primaryPartnerId: "",
      relationshipTags: ["卖讯", "两头通吃"],
    },
  ],
};

let openWorldKeywordPoolCache: OpenWorldAiKeywordPool = {
  ...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL,
};
let openWorldKeywordPoolCacheExpiresAt = 0;
let openWorldPressureReliefRulesCache: OpenWorldPressureReliefRules = {
  ...DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES,
  rules: DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.rules.map((rule) => ({ ...rule })),
};
let openWorldPressureReliefRulesCacheExpiresAt = 0;
let openWorldCustomNpcLibraryCache: OpenWorldCustomNpcLibrary = {
  npcs: DEFAULT_OPEN_WORLD_CUSTOM_NPC_LIBRARY.npcs.map((npc) => ({ ...npc })),
};
let openWorldCustomNpcLibraryCacheExpiresAt = 0;

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export const OPEN_WORLD_ARCHETYPES = [
  "凡人城镇",
  "修士坊市",
  "山野聚落",
  "边荒据点",
  "宗门聚落",
] as const;

export const OPEN_WORLD_NPC_ACTIONS = [
  "idle",
  "wander",
  "gather",
  "hunt",
  "loot",
  "return",
  "stall",
  "dead",
] as const;

export type OpenWorldArchetype = typeof OPEN_WORLD_ARCHETYPES[number];
export type OpenWorldNpcAction = typeof OPEN_WORLD_NPC_ACTIONS[number];
export const OPEN_WORLD_HEAT_TIERS = ["hot", "warm", "cold"] as const;
export const OPEN_WORLD_REGION_BANDS = [
  "凡尘城镇带",
  "散修坊市带",
  "山野聚落带",
  "边荒灰域带",
] as const;

export type OpenWorldHeatTier = typeof OPEN_WORLD_HEAT_TIERS[number];
export type OpenWorldRegionBand = typeof OPEN_WORLD_REGION_BANDS[number];
export type OpenWorldTravelConnectionRole = "main" | "return" | "branch";
export type OpenWorldTravelConnectionType = "portal" | "road" | "rift";

export type OpenWorldTravelConnectionBlueprint = {
  role: OpenWorldTravelConnectionRole;
  targetMapId: string;
  targetMapName: string;
  travelType: OpenWorldTravelConnectionType;
  label: string;
  summary: string;
};

export type OpenWorldMapBlueprint = {
  id: string;
  name: string;
  archetype: OpenWorldArchetype;
  regionBand: OpenWorldRegionBand;
  heatTier: OpenWorldHeatTier;
  heatScore: number;
  dangerLevel: number;
  mysteryLevel: number;
  theme: string;
  description: string;
  districts: string[];
  buildingTags: string[];
  resourceThemes: string[];
  rumorSeeds: string[];
  encounterHooks: string[];
  secretRealmHooks: string[];
  travelConnections: OpenWorldTravelConnectionBlueprint[];
};

export const OPEN_WORLD_ACTIVE_MAP_ARCHETYPES = [
  "凡人城镇",
  "修士坊市",
  "山野聚落",
  "边荒据点",
  "宗门聚落",
] as const satisfies readonly OpenWorldArchetype[];

export const OPEN_WORLD_SCENE_ICONS = {
  portal: "/open-world/scene-icons/portal-array.svg",
  house: "/open-world/scene-icons/inn-house.svg",
  stall: "/open-world/scene-icons/stall-awning.svg",
  stele: "/open-world/scene-icons/rumor-stele.svg",
  herb: "/open-world/scene-icons/herb-garden.svg",
  watchtower: "/open-world/scene-icons/watchtower.svg",
} as const;

export const OPEN_WORLD_BUILDING_ICONS: Record<OpenWorldArchetype, string[]> = {
  "凡人城镇": [
    OPEN_WORLD_SCENE_ICONS.house,
    OPEN_WORLD_SCENE_ICONS.stall,
    OPEN_WORLD_SCENE_ICONS.stele,
  ],
  "修士坊市": [
    OPEN_WORLD_SCENE_ICONS.portal,
    OPEN_WORLD_SCENE_ICONS.stall,
    OPEN_WORLD_SCENE_ICONS.stele,
  ],
  "山野聚落": [
    OPEN_WORLD_SCENE_ICONS.herb,
    OPEN_WORLD_SCENE_ICONS.house,
    OPEN_WORLD_SCENE_ICONS.stele,
  ],
  "边荒据点": [
    OPEN_WORLD_SCENE_ICONS.watchtower,
    OPEN_WORLD_SCENE_ICONS.stall,
    OPEN_WORLD_SCENE_ICONS.portal,
  ],
  "宗门聚落": [
    OPEN_WORLD_SCENE_ICONS.watchtower,
    OPEN_WORLD_SCENE_ICONS.house,
    OPEN_WORLD_SCENE_ICONS.stele,
  ],
};

export const OPEN_WORLD_PORTAL_IMAGE_URL = OPEN_WORLD_SCENE_ICONS.portal;

function normalizeKeywordStringList(value: unknown, fallback: readonly string[]) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = Array.from(new Set(
    value
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.slice(0, 24)),
  ));
  return normalized.length > 0 ? normalized : [...fallback];
}

function mergeKeywordStringList(primary: readonly string[], fallback: readonly string[]) {
  return Array.from(new Set([
    ...primary.map((entry) => String(entry || "").trim()).filter(Boolean),
    ...fallback.map((entry) => String(entry || "").trim()).filter(Boolean),
  ]));
}

function normalizeOpenWorldAiKeywordPool(raw: unknown): OpenWorldAiKeywordPool {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    femaleNames: normalizeKeywordStringList(payload.femaleNames, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.femaleNames),
    maleNames: normalizeKeywordStringList(payload.maleNames, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.maleNames),
    npcOrigins: normalizeKeywordStringList(payload.npcOrigins, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcOrigins),
    npcProfessions: normalizeKeywordStringList(payload.npcProfessions, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcProfessions),
    npcFactions: normalizeKeywordStringList(payload.npcFactions, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcFactions),
    npcTraits: normalizeKeywordStringList(payload.npcTraits, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcTraits),
    npcPersonalityKeywords: normalizeKeywordStringList(payload.npcPersonalityKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcPersonalityKeywords),
    npcLifeKeywords: normalizeKeywordStringList(payload.npcLifeKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcLifeKeywords),
    npcSocialKeywords: normalizeKeywordStringList(payload.npcSocialKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcSocialKeywords),
    relationshipKeywords: normalizeKeywordStringList(payload.relationshipKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.relationshipKeywords),
    districtKeywords: normalizeKeywordStringList(payload.districtKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.districtKeywords),
    resourceKeywords: normalizeKeywordStringList(payload.resourceKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.resourceKeywords),
    rumorKeywords: normalizeKeywordStringList(payload.rumorKeywords, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.rumorKeywords),
    marketBuyerTitles: normalizeKeywordStringList(payload.marketBuyerTitles, DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.marketBuyerTitles),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizePressureTargets(value: unknown, fallback: readonly OpenWorldPressureTarget[]) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .map((entry) => String(entry || "").trim())
    .filter((entry): entry is OpenWorldPressureTarget => (
      entry === "notorietyScore"
      || entry === "bountyHeat"
      || entry === "shadowFavor"
      || entry === "lawfulPressure"
    ));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...fallback];
}

function normalizeForcedActions(value: unknown, fallback: readonly OpenWorldForcedAction[]) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .map((entry) => String(entry || "").trim())
    .filter((entry): entry is OpenWorldForcedAction => (
      entry === "rob_lingyu"
      || entry === "forced_teleport"
      || entry === "forced_dual_cultivation"
    ));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...fallback];
}

function normalizePressureReliefRule(raw: unknown, fallback: OpenWorldPressureReliefRule): OpenWorldPressureReliefRule {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const offerType = String(payload.offerType || "").trim();
  const normalizedOfferType = (
    offerType === "pressure_cleanse"
    || offerType === "rumor_silence"
    || offerType === "lawful_mediation"
    || offerType === "consensual_dual_cultivation"
  )
    ? offerType
    : fallback.offerType;
  const coerciveFlavorLevel = String(payload.coerciveFlavorLevel || "").trim();
  return {
    offerType: normalizedOfferType,
    enabled: normalizeBoolean(payload.enabled, fallback.enabled),
    label: String(payload.label || "").trim().slice(0, 20) || fallback.label,
    sourceFaction: String(payload.sourceFaction || "").trim().slice(0, 24) || fallback.sourceFaction,
    baseReliefValue: Math.max(1, Math.min(60, Math.floor(Number(payload.baseReliefValue || fallback.baseReliefValue) || fallback.baseReliefValue))),
    pressureTargets: normalizePressureTargets(payload.pressureTargets, fallback.pressureTargets),
    requiresKeywords: normalizeKeywordStringList(payload.requiresKeywords, fallback.requiresKeywords).slice(0, 6),
    consentRequired: normalizeBoolean(payload.consentRequired, fallback.consentRequired),
    coerciveFlavorLevel: (coerciveFlavorLevel === "low" || coerciveFlavorLevel === "medium" || coerciveFlavorLevel === "high")
      ? coerciveFlavorLevel
      : fallback.coerciveFlavorLevel,
    forcedActions: normalizeForcedActions(payload.forcedActions, fallback.forcedActions),
    summaryHint: String(payload.summaryHint || "").trim().slice(0, 80) || fallback.summaryHint,
  };
}

function normalizeOpenWorldPressureReliefRules(raw: unknown): OpenWorldPressureReliefRules {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rawRules = Array.isArray(payload.rules) ? payload.rules : [];
  const fallbackByType = new Map(
    DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.rules.map((rule) => [rule.offerType, rule] as const),
  );
  const normalizedRules = rawRules
    .map((rule) => {
      const rawOfferType = rule && typeof rule === "object" && !Array.isArray(rule)
        ? String((rule as Record<string, unknown>).offerType || "").trim()
        : "";
      const fallback = fallbackByType.get(rawOfferType as OpenWorldPressureReliefOfferType) || DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.rules[0];
      return normalizePressureReliefRule(rule, fallback);
    })
    .filter((rule, index, list) => list.findIndex((entry) => entry.offerType === rule.offerType) === index);

  if (normalizedRules.length <= 0) {
    return {
      ...DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES,
      rules: DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.rules.map((rule) => ({ ...rule })),
    };
  }

  return {
    highCorruptionThreshold: Math.max(50, Math.min(100, Math.floor(Number(payload.highCorruptionThreshold || DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.highCorruptionThreshold) || DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.highCorruptionThreshold))),
    perMapCustomNpcLimit: Math.max(1, Math.min(OPEN_WORLD_CUSTOM_NPC_PER_MAP_LIMIT, Math.floor(Number(payload.perMapCustomNpcLimit || DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.perMapCustomNpcLimit) || DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.perMapCustomNpcLimit))),
    rules: normalizedRules,
  };
}

function normalizeGender(value: unknown, fallback: "male" | "female") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "male" || normalized === "man" || normalized === "男") {
    return "male" as const;
  }
  if (normalized === "female" || normalized === "woman" || normalized === "女") {
    return "female" as const;
  }
  return fallback;
}

function normalizeOpenWorldCustomNpc(raw: unknown, fallbackIndex: number): OpenWorldCustomNpcDefinition | null {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  if (!payload) {
    return null;
  }
  const id = String(payload.id || "").trim().slice(0, 48);
  const name = String(payload.name || "").trim().slice(0, 16);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    gender: normalizeGender(payload.gender, fallbackIndex % 2 === 0 ? "female" : "male"),
    originType: String(payload.originType || "散修").trim().slice(0, 16) || "散修",
    profession: String(payload.profession || "行脚修士").trim().slice(0, 16) || "行脚修士",
    faction: String(payload.faction || "无门散人").trim().slice(0, 16) || "无门散人",
    realmMinor: Math.max(1, Math.min(9, Math.floor(Number(payload.realmMinor || 3) || 3))),
    personalitySummary: String(payload.personalitySummary || "这人来路不浅，却把自己藏得很深。").trim().slice(0, 120) || "这人来路不浅，却把自己藏得很深。",
    traitTags: normalizeKeywordStringList(payload.traitTags, ["机敏", "多疑"]).slice(0, 4),
    worldBookKeywords: normalizeKeywordStringList(payload.worldBookKeywords, []).slice(0, 8),
    adultTags: normalizeKeywordStringList(payload.adultTags, []).slice(0, 6),
    grayTags: normalizeKeywordStringList(payload.grayTags, []).slice(0, 6),
    preferredMapIds: normalizeKeywordStringList(payload.preferredMapIds, []).slice(0, 8),
    preferredMapTags: normalizeKeywordStringList(payload.preferredMapTags, []).slice(0, 8),
    writeToRandomPool: normalizeBoolean(payload.writeToRandomPool, true),
    allowDynamicWorldSpawn: normalizeBoolean(payload.allowDynamicWorldSpawn, true),
    partnerIds: normalizeKeywordStringList(payload.partnerIds, []).slice(0, 6),
    primaryPartnerId: String(payload.primaryPartnerId || "").trim().slice(0, 48),
    relationshipTags: normalizeKeywordStringList(payload.relationshipTags, []).slice(0, 6),
  };
}

function normalizeOpenWorldCustomNpcLibrary(raw: unknown): OpenWorldCustomNpcLibrary {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rawNpcs = Array.isArray(payload.npcs) ? payload.npcs : [];
  const npcs = rawNpcs
    .map((npc, index) => normalizeOpenWorldCustomNpc(npc, index))
    .filter((npc): npc is OpenWorldCustomNpcDefinition => Boolean(npc))
    .filter((npc, index, list) => list.findIndex((entry) => entry.id === npc.id) === index);
  return {
    npcs: npcs.length > 0
      ? npcs
      : DEFAULT_OPEN_WORLD_CUSTOM_NPC_LIBRARY.npcs.map((npc) => ({ ...npc })),
  };
}

function trimFlavorKeyword(value: string, fallback: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 8);
}

export function getDefaultOpenWorldAiKeywordPool() {
  return {
    ...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL,
    femaleNames: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.femaleNames],
    maleNames: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.maleNames],
    npcOrigins: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcOrigins],
    npcProfessions: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcProfessions],
    npcFactions: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcFactions],
    npcTraits: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcTraits],
    npcPersonalityKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcPersonalityKeywords],
    npcLifeKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcLifeKeywords],
    npcSocialKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.npcSocialKeywords],
    relationshipKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.relationshipKeywords],
    districtKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.districtKeywords],
    resourceKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.resourceKeywords],
    rumorKeywords: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.rumorKeywords],
    marketBuyerTitles: [...DEFAULT_OPEN_WORLD_AI_KEYWORD_POOL.marketBuyerTitles],
  } satisfies OpenWorldAiKeywordPool;
}

export function invalidateOpenWorldAiKeywordPoolCache() {
  openWorldKeywordPoolCacheExpiresAt = 0;
}

export function getCachedOpenWorldAiKeywordPool() {
  return openWorldKeywordPoolCache;
}

export async function warmOpenWorldAiKeywordPool(force = false) {
  if (!force && openWorldKeywordPoolCacheExpiresAt > Date.now()) {
    return openWorldKeywordPoolCache;
  }

  const rawConfig = await getSystemConfigJsonValue<Record<string, unknown>>(OPEN_WORLD_KEYWORD_POOL_CONFIG_KEY);
  openWorldKeywordPoolCache = normalizeOpenWorldAiKeywordPool(rawConfig);
  openWorldKeywordPoolCacheExpiresAt = Date.now() + OPEN_WORLD_KEYWORD_POOL_CACHE_TTL_MS;
  return openWorldKeywordPoolCache;
}

export function getDefaultOpenWorldPressureReliefRules() {
  return {
    ...DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES,
    rules: DEFAULT_OPEN_WORLD_PRESSURE_RELIEF_RULES.rules.map((rule) => ({
      ...rule,
      pressureTargets: [...rule.pressureTargets],
      requiresKeywords: [...rule.requiresKeywords],
      forcedActions: [...rule.forcedActions],
    })),
  } satisfies OpenWorldPressureReliefRules;
}

export function invalidateOpenWorldPressureReliefRulesCache() {
  openWorldPressureReliefRulesCacheExpiresAt = 0;
}

export function getCachedOpenWorldPressureReliefRules() {
  return openWorldPressureReliefRulesCache;
}

export async function warmOpenWorldPressureReliefRules(force = false) {
  if (!force && openWorldPressureReliefRulesCacheExpiresAt > Date.now()) {
    return openWorldPressureReliefRulesCache;
  }
  const rawConfig = await getSystemConfigJsonValue<Record<string, unknown>>(OPEN_WORLD_PRESSURE_RELIEF_RULES_CONFIG_KEY);
  openWorldPressureReliefRulesCache = normalizeOpenWorldPressureReliefRules(rawConfig);
  openWorldPressureReliefRulesCacheExpiresAt = Date.now() + OPEN_WORLD_KEYWORD_POOL_CACHE_TTL_MS;
  return openWorldPressureReliefRulesCache;
}

export function getDefaultOpenWorldCustomNpcLibrary() {
  return {
    npcs: DEFAULT_OPEN_WORLD_CUSTOM_NPC_LIBRARY.npcs.map((npc) => ({
      ...npc,
      traitTags: [...npc.traitTags],
      worldBookKeywords: [...npc.worldBookKeywords],
      adultTags: [...npc.adultTags],
      grayTags: [...npc.grayTags],
      preferredMapIds: [...npc.preferredMapIds],
      preferredMapTags: [...npc.preferredMapTags],
      partnerIds: [...npc.partnerIds],
      relationshipTags: [...npc.relationshipTags],
    })),
  } satisfies OpenWorldCustomNpcLibrary;
}

export function invalidateOpenWorldCustomNpcLibraryCache() {
  openWorldCustomNpcLibraryCacheExpiresAt = 0;
}

export function getCachedOpenWorldCustomNpcLibrary() {
  return openWorldCustomNpcLibraryCache;
}

export async function warmOpenWorldCustomNpcLibrary(force = false) {
  if (!force && openWorldCustomNpcLibraryCacheExpiresAt > Date.now()) {
    return openWorldCustomNpcLibraryCache;
  }
  const rawConfig = await getSystemConfigJsonValue<Record<string, unknown>>(OPEN_WORLD_CUSTOM_NPC_LIBRARY_CONFIG_KEY);
  openWorldCustomNpcLibraryCache = normalizeOpenWorldCustomNpcLibrary(rawConfig);
  openWorldCustomNpcLibraryCacheExpiresAt = Date.now() + OPEN_WORLD_KEYWORD_POOL_CACHE_TTL_MS;
  return openWorldCustomNpcLibraryCache;
}

export function getOpenWorldPressureReliefRule(offerType: OpenWorldPressureReliefOfferType) {
  return getCachedOpenWorldPressureReliefRules().rules.find((rule) => rule.offerType === offerType) || null;
}

export function getOpenWorldForcedRuleSnapshot(): OpenWorldForcedRuleSnapshot {
  const rules = getCachedOpenWorldPressureReliefRules();
  const playerForcedActions = Array.from(new Set(
    rules.rules.flatMap((rule) => rule.coerciveFlavorLevel === "high" ? rule.forcedActions : []),
  ));
  return {
    highCorruptionThreshold: rules.highCorruptionThreshold,
    playerForcedActions: playerForcedActions.length > 0
      ? playerForcedActions
      : ["forced_dual_cultivation", "rob_lingyu", "forced_teleport"],
    npcForcedActions: ["rob_lingyu"],
    perMapCustomNpcLimit: rules.perMapCustomNpcLimit,
  };
}

function buildOpenWorldCustomNpcNamePool(gender: "male" | "female") {
  return getCachedOpenWorldCustomNpcLibrary().npcs
    .filter((npc) => npc.writeToRandomPool && npc.gender === gender)
    .map((npc) => npc.name);
}

export const OPEN_WORLD_MAP_BLUEPRINTS = [
  {
    id: "world_open_1",
    name: "柳河镇",
    archetype: "凡人城镇",
    regionBand: "凡尘城镇带",
    heatTier: "hot",
    heatScore: 84,
    dangerLevel: 24,
    mysteryLevel: 28,
    theme: "柳河沿岸烟火浓密，茶肆药铺与驿道风声日夜不息",
    description: "柳河镇是凡尘城镇带最热闹的驿口，跑商、采药与外来散修都爱先在这里落脚听风。",
    districts: ["柳河北街", "柳河中坊", "柳河南埠"],
    buildingTags: ["柳桥渡口", "河畔药铺", "旧茶肆", "驿路传送阵"],
    resourceThemes: ["河滩药草", "民间杂货", "旧船木料"],
    rumorSeeds: ["夜半渡口总有人收一批不问来路的药篓", "柳桥下方的水声里，常混着陌生修士的低语", "镇北旧祠外近来总留着潮湿脚印"],
    encounterHooks: ["探碑：柳桥边的旧碑夜里会浮出残字", "寻药：河滩湿地生出一圈异香药草", "护送：药铺托人把一篓灵草送去坊市"],
    secretRealmHooks: ["荒废洞府：河堤暗渠后藏着半塌石门", "灰市暗层：渡口货舱下方偶尔透出异灯"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_5", targetMapName: "浮灯坊", travelType: "portal", label: "界域主阵", summary: "主阵直通浮灯坊，是凡尘与坊市最常用的商路。"},
      { role: "return", targetMapId: "world_open_2", targetMapName: "青石集", travelType: "road", label: "回返驿路", summary: "沿官道回返青石集，适合就近转场与补货。"},
      { role: "branch", targetMapId: "world_open_9", targetMapName: "雾岭寨", travelType: "rift", label: "山径裂隙", summary: "柳河北坡有条偏门山径，可拐进雾岭寨的雾林边界。"},
    ],
  },
  {
    id: "world_open_2",
    name: "青石集",
    archetype: "凡人城镇",
    regionBand: "凡尘城镇带",
    heatTier: "hot",
    heatScore: 82,
    dangerLevel: 26,
    mysteryLevel: 26,
    theme: "青石长街上货郎与散修混行，白日热闹，入夜人情更杂",
    description: "青石集的街面不大，但铺面极密，玩家容易在短时间里连撞风声、接头与灰活。",
    districts: ["青石北街", "青石中坊", "青石南埠"],
    buildingTags: ["青石牌坊", "旧米行", "灰巷脚店", "集口传送阵"],
    resourceThemes: ["野参碎根", "行商杂货", "旧铜片"],
    rumorSeeds: ["集口总有人替人盯着外地修士的出入", "旧米行后院近来被人夜里翻过三次", "南埠的脚店老板忽然开始高价收破阵残片"],
    encounterHooks: ["追索：有人托你追一名偷走货票的脚夫", "拾遗：北街石缝里常能翻出旧修遗物", "探碑：牌坊石纹里藏着一段残缺阵路"],
    secretRealmHooks: ["残阵秘窟：集外废井下疑似有残阵窟口", "灰市暗层：灰巷脚店后墙时常开出暗门"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_6", targetMapName: "断虹墟", travelType: "portal", label: "界域主阵", summary: "主阵可直达断虹墟，集里的修士大多从这里外出采买。"},
      { role: "return", targetMapId: "world_open_1", targetMapName: "柳河镇", travelType: "road", label: "回返驿路", summary: "回返驿路通向柳河镇，商旅常在两地间往返。"},
      { role: "branch", targetMapId: "world_open_10", targetMapName: "寒溪坳", travelType: "rift", label: "寒溪偏径", summary: "青石集南侧有条湿寒小路，尽头能钻进寒溪坳。"},
    ],
  },
  {
    id: "world_open_3",
    name: "药王埠",
    archetype: "凡人城镇",
    regionBand: "凡尘城镇带",
    heatTier: "hot",
    heatScore: 80,
    dangerLevel: 28,
    mysteryLevel: 35,
    theme: "药商、药农与试药修士汇成一埠，药香与命债一同漂在风里",
    description: "药王埠比寻常城镇更适合药材和孕育相关余波展开，奇闻与秘境入口偏向药性与旧洞府。",
    districts: ["药王北街", "药王中坊", "药王南埠"],
    buildingTags: ["百草铺", "晒药棚", "埠头仓屋", "定向传送阵"],
    resourceThemes: ["阴干灵草", "药泥", "旧药札"],
    rumorSeeds: ["晒药棚顶近来总落下一串不该有的灰羽", "有人说南埠药仓里藏着会自己开合的旧柜", "埠头卖药人最近不肯在白天谈某味禁药"],
    encounterHooks: ["寻药：有位老药师求你补一味失传辅药", "破阵：仓屋后头的封药阵纹忽然松动", "护送：百草铺想把一箱药材送往碎玉市"],
    secretRealmHooks: ["荒废洞府：药王埠旧山壁里埋着丹修洞府", "残阵秘窟：封药阵深处偶有青火外溢"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_7", targetMapName: "碎玉市", travelType: "portal", label: "界域主阵", summary: "药王埠的主阵向来直连碎玉市，灵材转手最快。"},
      { role: "return", targetMapId: "world_open_4", targetMapName: "乌篷渡", travelType: "road", label: "回返货道", summary: "回返货道顺着水岸走，能退回乌篷渡整补货船。"},
      { role: "branch", targetMapId: "world_open_11", targetMapName: "鹿门坡", travelType: "rift", label: "药坡隐径", summary: "晒药棚旁的小坡道会把人引入鹿门坡的药兽地界。"},
    ],
  },
  {
    id: "world_open_4",
    name: "乌篷渡",
    archetype: "凡人城镇",
    regionBand: "凡尘城镇带",
    heatTier: "hot",
    heatScore: 78,
    dangerLevel: 30,
    mysteryLevel: 32,
    theme: "舟船、脚帮与夜渡客在潮水间换货，渡口表面平静，底下最藏事",
    description: "乌篷渡的风声更偏走私、夜渡与黑货，适合承接灰线委托与跨图跑路。",
    districts: ["乌篷北街", "乌篷中坊", "乌篷南埠"],
    buildingTags: ["乌篷栈桥", "旧船行", "夜渡棚", "回返传送阵"],
    resourceThemes: ["湿木船料", "渡口黑货", "潮纹石片"],
    rumorSeeds: ["夜里有人听见船底传来敲阵声", "旧船行近来总停着一艘不挂旗的乌篷船", "南埠货篓里经常混着来路不明的灰砂"],
    encounterHooks: ["护送：夜渡客让你押一批不见光的货", "追索：有人在渡口抛下血迹后失踪", "拾遗：潮退后总会露出一些旧水府残片"],
    secretRealmHooks: ["灰市暗层：夜渡棚后有一层只在子夜开门的暗市", "妖巢裂隙：渡外浅滩偶尔裂出浑浊妖雾"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_8", targetMapName: "回风阁", travelType: "portal", label: "界域主阵", summary: "渡口主阵直达回风阁，夜里更是行商最快的跳点。"},
      { role: "return", targetMapId: "world_open_3", targetMapName: "药王埠", travelType: "road", label: "回返货道", summary: "沿水岸货道回返药王埠，可顺手补货与出手药材。"},
      { role: "branch", targetMapId: "world_open_12", targetMapName: "青藤岭", travelType: "rift", label: "藤岭偏舟", summary: "一条旧舟道会把人送进青藤岭边上的潮雾小湾。"},
    ],
  },
  {
    id: "world_open_5",
    name: "浮灯坊",
    archetype: "修士坊市",
    regionBand: "散修坊市带",
    heatTier: "hot",
    heatScore: 88,
    dangerLevel: 38,
    mysteryLevel: 44,
    theme: "灯影不灭的坊市聚满散修、掮客与灰线商贩，越热闹越容易藏人",
    description: "浮灯坊是开放世界最常见的中转热图，市场、黑线、成人风声和秘境消息都会在这里交汇。",
    districts: ["浮灯北市", "浮灯中坊", "浮灯暗巷"],
    buildingTags: ["浮灯牌楼", "灵材棚市", "黑火小摊", "坊心传送阵"],
    resourceThemes: ["碎灵矿", "旧法器胚", "灰市符材"],
    rumorSeeds: ["浮灯下有人专收追缉链的暗线消息", "北市法器摊昨夜忽然少了三件压箱货", "暗巷里近来总飘着异甜的炉灰味"],
    encounterHooks: ["探碑：坊心古碑偶尔映出别处坐标", "护送：有人要你把一匣符材送往黑砂堡", "追索：暗巷里有人在找失踪的掮客"],
    secretRealmHooks: ["灰市暗层：浮灯坊地底藏着会位移的灰市夹层", "残阵秘窟：旧法器铺后院埋着碎阵暗窟"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_13", targetMapName: "黑砂堡", travelType: "portal", label: "界域主阵", summary: "浮灯坊主阵会把人直接送往黑砂堡，是最危险也最赚钱的商路。"},
      { role: "return", targetMapId: "world_open_1", targetMapName: "柳河镇", travelType: "road", label: "回返商路", summary: "回返商路沿着柳河外驿退回凡尘地界。"},
      { role: "branch", targetMapId: "world_open_6", targetMapName: "断虹墟", travelType: "rift", label: "坊间支阵", summary: "支阵可快速切进断虹墟，适合坊市间短程倒货。"},
    ],
  },
  {
    id: "world_open_6",
    name: "断虹墟",
    archetype: "修士坊市",
    regionBand: "散修坊市带",
    heatTier: "hot",
    heatScore: 86,
    dangerLevel: 42,
    mysteryLevel: 48,
    theme: "残虹石路、破旧棚市与断阵商贩挤在一起，什么都能卖，什么都可能出事",
    description: "断虹墟更偏残阵、掮客和偷卖旧物，战斗后的拾遗与破阵线索在这里很密。",
    districts: ["断虹北市", "断虹中坊", "断虹暗廊"],
    buildingTags: ["断虹石街", "残符棚", "旧阵铺", "裂隙传送阵"],
    resourceThemes: ["残符纸", "碎阵盘", "斑驳矿屑"],
    rumorSeeds: ["断虹石街有人高价收能认主的旧阵眼", "暗廊里最近总有人把血衣埋进碎阵灰里", "北市有摊主放话说能卖一段通往残烽营的旧路"],
    encounterHooks: ["破阵：有人请你试开一块残阵盘", "拾遗：断虹石路缝里常掉出旧符碎片", "追索：一个卖阵盘的散修突然失踪"],
    secretRealmHooks: ["残阵秘窟：旧阵铺下方时常传出阵鸣", "荒废洞府：墟外断崖藏着一间塌了一半的阵修洞府"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_14", targetMapName: "残烽营", travelType: "portal", label: "界域主阵", summary: "主阵直穿边荒，能去到残烽营的废营外场。"},
      { role: "return", targetMapId: "world_open_2", targetMapName: "青石集", travelType: "road", label: "回返商路", summary: "回返商路退回青石集，是断虹墟最常见的补给线。"},
      { role: "branch", targetMapId: "world_open_5", targetMapName: "浮灯坊", travelType: "rift", label: "坊间支阵", summary: "支阵可与浮灯坊短距互通，适合临时转手。"},
    ],
  },
  {
    id: "world_open_7",
    name: "碎玉市",
    archetype: "修士坊市",
    regionBand: "散修坊市带",
    heatTier: "hot",
    heatScore: 85,
    dangerLevel: 40,
    mysteryLevel: 46,
    theme: "玉屑、灵矿与假货同场翻滚，最亮的摊位往往也最会骗人",
    description: "碎玉市会更频繁地挂出灵矿、法器胚与猎修相关风闻，是一张高价值跑图热点。",
    districts: ["碎玉北市", "碎玉中坊", "碎玉货街"],
    buildingTags: ["碎玉棚楼", "矿材铺", "鉴玉台", "坊心传送阵"],
    resourceThemes: ["碎灵玉", "矿髓屑", "法器碎胚"],
    rumorSeeds: ["鉴玉台近来总有人拿沾血玉片来验货", "货街里有人私下问起鬼市塞的路", "北市矿材铺忽然开始防着外来女修"],
    encounterHooks: ["寻药：一位炼器师想用药液洗开封玉", "护送：有人要你护送一车矿髓去鬼市塞", "拾遗：鉴玉台附近常能捡到被弃的玉纹残片"],
    secretRealmHooks: ["荒废洞府：碎玉市外的采坑尽头埋着旧矿主洞府", "灰市暗层：鉴玉台暗室里有个只认玉牌的灰门"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_15", targetMapName: "鬼市塞", travelType: "portal", label: "界域主阵", summary: "主阵可直落鬼市塞，是矿货与黑货最险的一段路。"},
      { role: "return", targetMapId: "world_open_3", targetMapName: "药王埠", travelType: "road", label: "回返货道", summary: "回返货道把碎玉市和药王埠重新串起来。"},
      { role: "branch", targetMapId: "world_open_8", targetMapName: "回风阁", travelType: "rift", label: "坊间支阵", summary: "支阵直通回风阁，适合想躲开主路的人。"},
    ],
  },
  {
    id: "world_open_8",
    name: "回风阁",
    archetype: "修士坊市",
    regionBand: "散修坊市带",
    heatTier: "hot",
    heatScore: 83,
    dangerLevel: 44,
    mysteryLevel: 52,
    theme: "回风长廊风声倒灌，阁里摊位多，耳目更多，消息比货更值钱",
    description: "回风阁更偏情报、追缉风声和多势力交汇，是第五阶段路网与秘境异动的重要中枢。",
    districts: ["回风北阁", "回风中坊", "回风灰廊"],
    buildingTags: ["回风长廊", "听风阁", "旧消息摊", "回旋传送阵"],
    resourceThemes: ["情报玉简", "旧令牌", "灰巷药粉"],
    rumorSeeds: ["听风阁里有人兜售追缉链的下一跳", "回风灰廊近来总能闻到焦阵味", "有人说葬阵垒那边的裂隙已经开始外涌"],
    encounterHooks: ["追索：有人请你找回一枚丢失的传讯玉简", "探碑：听风阁碑面会记录一闪而过的地名", "护送：灰廊来客要你带一封密帖去葬阵垒"],
    secretRealmHooks: ["灰市暗层：回风灰廊下方是会换口令的暗层", "妖巢裂隙：阁外回风坡偶尔裂出妖雾细缝"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_16", targetMapName: "葬阵垒", travelType: "portal", label: "界域主阵", summary: "主阵直落葬阵垒外缘，常有人赌着命去换一条大风声。"},
      { role: "return", targetMapId: "world_open_4", targetMapName: "乌篷渡", travelType: "road", label: "回返货道", summary: "沿水廊回返乌篷渡，可以借夜渡客掩去行踪。"},
      { role: "branch", targetMapId: "world_open_7", targetMapName: "碎玉市", travelType: "rift", label: "坊间支阵", summary: "支阵通往碎玉市，方便在两地间转运矿材与消息。"},
    ],
  },
  {
    id: "world_open_9",
    name: "雾岭寨",
    archetype: "山野聚落",
    regionBand: "山野聚落带",
    heatTier: "warm",
    heatScore: 64,
    dangerLevel: 48,
    mysteryLevel: 58,
    theme: "雾岭路滑草深，采药人与猎修共住山寨，越往雾深处越分不清路和阵",
    description: "雾岭寨是山野带的入口，适合寻药、探碑与妖巢裂隙类玩法，不需要全图高频同步。",
    districts: ["雾岭前寨", "雾岭中坡", "雾岭雾谷"],
    buildingTags: ["雾木寨门", "药篓棚", "猎修火塘", "山路回返阵"],
    resourceThemes: ["雾根草", "兽骨", "湿藤药泥"],
    rumorSeeds: ["雾谷里近来总有人把脚印踩成同一个方向", "寨门边有人见过半夜会亮的断碑", "中坡猎修说山里妖物突然安静了几天"],
    encounterHooks: ["寻药：雾谷深处生出一株断年灵草", "探碑：山路断碑夜里会显字", "追索：有人托你找回失踪的采药篓"],
    secretRealmHooks: ["妖巢裂隙：雾谷深处常裂出妖气薄缝", "荒废洞府：猎修火塘后山埋着旧散修洞府"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_13", targetMapName: "黑砂堡", travelType: "road", label: "边荒山道", summary: "边荒山道能一路摸去黑砂堡，是最稳的山野进边荒路线。"},
      { role: "return", targetMapId: "world_open_1", targetMapName: "柳河镇", travelType: "road", label: "回返山径", summary: "回返山径退回柳河镇，方便从雾岭寨回补给线。"},
      { role: "branch", targetMapId: "world_open_10", targetMapName: "寒溪坳", travelType: "rift", label: "雾岭岔路", summary: "一条岔路能顺着山气转进寒溪坳。"},
    ],
  },
  {
    id: "world_open_10",
    name: "寒溪坳",
    archetype: "山野聚落",
    regionBand: "山野聚落带",
    heatTier: "warm",
    heatScore: 60,
    dangerLevel: 50,
    mysteryLevel: 60,
    theme: "寒溪细流绕坳而过，山路偏冷，水气里总藏着不干净的回声",
    description: "寒溪坳更适合山野追索与破阵，地图平时降频运行，但有事件时会快速升温。",
    districts: ["寒溪前坳", "寒溪中坡", "寒溪幽溪"],
    buildingTags: ["寒溪木桥", "溪边草棚", "旧猎棚", "裂隙回返阵"],
    resourceThemes: ["寒溪苔药", "兽皮", "溪石残粉"],
    rumorSeeds: ["幽溪边近来总浮着不属于山里的符纸", "有人说木桥下夜里会传来低低念咒声", "旧猎棚里新多了几只不带血的兽骨"],
    encounterHooks: ["破阵：溪边旧阵常会突然亮起", "追索：有人要你寻找走失的守林弟子", "拾遗：寒溪边总能捡到被水磨圆的残符"],
    secretRealmHooks: ["残阵秘窟：幽溪石壁后埋着一段旧阵道", "妖巢裂隙：溪谷深处会不定时裂出冷雾妖洞"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_14", targetMapName: "残烽营", travelType: "road", label: "边荒山道", summary: "边荒山道可以把人引进残烽营的旧哨坡。"},
      { role: "return", targetMapId: "world_open_2", targetMapName: "青石集", travelType: "road", label: "回返山径", summary: "回返山径退回青石集，适合补给后再次进山。"},
      { role: "branch", targetMapId: "world_open_9", targetMapName: "雾岭寨", travelType: "rift", label: "寒溪岔路", summary: "岔路可与雾岭寨短接，跑山更灵活。"},
    ],
  },
  {
    id: "world_open_11",
    name: "鹿门坡",
    archetype: "山野聚落",
    regionBand: "山野聚落带",
    heatTier: "warm",
    heatScore: 58,
    dangerLevel: 52,
    mysteryLevel: 62,
    theme: "鹿门古坡上灵兽痕迹杂乱，药路和猎路交叉，稍一分神就会走进旧禁地",
    description: "鹿门坡更偏灵兽、药坡与旧禁地线索，适合护送、寻药和拾遗类奇遇。",
    districts: ["鹿门前坡", "鹿门中岭", "鹿门旧林"],
    buildingTags: ["鹿门石坡", "守坡棚", "药兽圈", "山道回返阵"],
    resourceThemes: ["灵鹿茸", "坡地药苗", "旧守符"],
    rumorSeeds: ["旧林里近来总传来像铃声一样的鹿鸣", "守坡棚附近有人捡到过带血的兽角", "药兽圈外突然多了几段不知谁刻的阵纹"],
    encounterHooks: ["护送：守坡人请你送一只小药兽下山", "寻药：坡背面新长出一片少见药苗", "拾遗：旧林里会掉出失主不明的守符"],
    secretRealmHooks: ["荒废洞府：鹿门旧林深处有座废弃驯兽洞府", "妖巢裂隙：药兽圈后的地缝里常有腥风"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_15", targetMapName: "鬼市塞", travelType: "road", label: "边荒山道", summary: "边荒山道能一路摸去鬼市塞，是走私货常用的偏门路。"},
      { role: "return", targetMapId: "world_open_3", targetMapName: "药王埠", travelType: "road", label: "回返药坡", summary: "回返药坡会把人带回药王埠一带。"},
      { role: "branch", targetMapId: "world_open_12", targetMapName: "青藤岭", travelType: "rift", label: "鹿门岔岭", summary: "岔岭可连去青藤岭，适合连续跑山。"},
    ],
  },
  {
    id: "world_open_12",
    name: "青藤岭",
    archetype: "山野聚落",
    regionBand: "山野聚落带",
    heatTier: "warm",
    heatScore: 56,
    dangerLevel: 54,
    mysteryLevel: 66,
    theme: "青藤满岭，旧路被藤蔓半掩，越往里走越像在钻一座活着的山阵",
    description: "青藤岭更偏秘境前置与裂隙感，适合第五阶段的秘境异动展示。",
    districts: ["青藤前岭", "青藤中坡", "青藤深岭"],
    buildingTags: ["青藤岭门", "藤棚药架", "守山火台", "裂隙回返阵"],
    resourceThemes: ["青藤药汁", "木灵枝", "山阵残叶"],
    rumorSeeds: ["深岭里有人看见藤蔓会自己换向生长", "守山火台近来总在无风时自行熄灭", "前岭旧路上多出一串不属于人的抓痕"],
    encounterHooks: ["破阵：青藤深岭的活藤会自行缠阵", "探碑：山路侧碑上会映出裂隙时刻", "追索：一名守山人进岭后失了音讯"],
    secretRealmHooks: ["残阵秘窟：藤蔓覆盖的旧石门后藏着阵窟", "妖巢裂隙：深岭内侧常裂出一道带腥气的细缝"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_16", targetMapName: "葬阵垒", travelType: "road", label: "边荒山道", summary: "边荒山道穿过青藤岭深处，能通到葬阵垒外缘。"},
      { role: "return", targetMapId: "world_open_4", targetMapName: "乌篷渡", travelType: "road", label: "回返潮岭", summary: "回返潮岭会把人带回乌篷渡附近的旧舟道。"},
      { role: "branch", targetMapId: "world_open_11", targetMapName: "鹿门坡", travelType: "rift", label: "青藤岔岭", summary: "岔岭与鹿门坡互通，是连续跑山时最顺的一跳。"},
    ],
  },
  {
    id: "world_open_13",
    name: "黑砂堡",
    archetype: "边荒据点",
    regionBand: "边荒灰域带",
    heatTier: "cold",
    heatScore: 44,
    dangerLevel: 68,
    mysteryLevel: 72,
    theme: "黑砂长风压在堡墙上，巡边修士、灰营客与亡命客都在这里换气",
    description: "黑砂堡默认降到冷层，但一旦有玩家、故事链或秘境入口卷进来，就会迅速重新升温。",
    districts: ["黑砂前堡", "黑砂中营", "黑砂外墙"],
    buildingTags: ["黑砂堡门", "巡边哨塔", "灰营货棚", "边荒传送阵"],
    resourceThemes: ["黑砂矿", "旧兵残片", "边地药根"],
    rumorSeeds: ["黑砂外墙近来总有人半夜偷偷试阵", "灰营货棚有人收追缉链上的旧人头消息", "巡边修士说堡外的风里开始带血味"],
    encounterHooks: ["护送：灰营客托你护一车黑砂", "追索：一名巡边修士在堡外失踪", "破阵：旧兵阵盘在风墙边重新亮起"],
    secretRealmHooks: ["灰市暗层：堡内货棚下面藏着一层只认血账的暗市", "残阵秘窟：外墙破口后方埋着军阵遗窟"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_5", targetMapName: "浮灯坊", travelType: "portal", label: "回返主阵", summary: "黑砂堡的主阵多半用来回返浮灯坊，把黑货送回热图。"},
      { role: "return", targetMapId: "world_open_9", targetMapName: "雾岭寨", travelType: "road", label: "回返山道", summary: "沿山道可退回雾岭寨，不必从最显眼的主阵走。"},
      { role: "branch", targetMapId: "world_open_14", targetMapName: "残烽营", travelType: "rift", label: "灰域岔阵", summary: "灰域岔阵能快速横切到残烽营。"},
    ],
  },
  {
    id: "world_open_14",
    name: "残烽营",
    archetype: "边荒据点",
    regionBand: "边荒灰域带",
    heatTier: "cold",
    heatScore: 42,
    dangerLevel: 72,
    mysteryLevel: 70,
    theme: "废营火台早已熄灭，旧军迹和灰线客却把这里重新养成了一处半死不活的据点",
    description: "残烽营偏战斗、追缉与残阵风声，适合高危险地图在冷层里低频推演。",
    districts: ["残烽前营", "残烽中帐", "残烽外坡"],
    buildingTags: ["残烽火台", "破帐营地", "补给棚", "边荒回返阵"],
    resourceThemes: ["荒军铁片", "烽灰", "旧营药箱"],
    rumorSeeds: ["火台昨夜无故亮过一次", "中帐里有人悄悄卖旧军名册", "外坡近来总能捡到断裂的血契符线"],
    encounterHooks: ["追索：有人想查失落的旧军名册", "破阵：火台下的旧军阵开始复苏", "拾遗：营地外坡总能翻出兵器残片"],
    secretRealmHooks: ["残阵秘窟：废营地下有半埋军阵窟", "荒废洞府：外坡裂谷里藏着旧斥候洞穴"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_6", targetMapName: "断虹墟", travelType: "portal", label: "回返主阵", summary: "回返主阵直退断虹墟，方便把边荒残物出手。"},
      { role: "return", targetMapId: "world_open_10", targetMapName: "寒溪坳", travelType: "road", label: "回返山道", summary: "沿山道可退回寒溪坳，再从山野转回凡尘。"},
      { role: "branch", targetMapId: "world_open_13", targetMapName: "黑砂堡", travelType: "rift", label: "灰域岔阵", summary: "灰域岔阵与黑砂堡互通，是边荒横切的重要通道。"},
    ],
  },
  {
    id: "world_open_15",
    name: "鬼市塞",
    archetype: "边荒据点",
    regionBand: "边荒灰域带",
    heatTier: "cold",
    heatScore: 40,
    dangerLevel: 74,
    mysteryLevel: 80,
    theme: "鬼市塞像一处会呼吸的裂口，走私、魔修和情报客都在这里压低声音说话",
    description: "鬼市塞神秘度最高，默认冷层但奇闻、暗层和黑市邀约最浓，一旦升温会非常危险。",
    districts: ["鬼市前塞", "鬼市暗巷", "鬼市后坡"],
    buildingTags: ["鬼市寨门", "黑帘小摊", "暗线货台", "裂口传送阵"],
    resourceThemes: ["灰市秘药", "血砂", "旧契符"],
    rumorSeeds: ["鬼市暗巷里有人兜售从死人身上剥下的旧命牌", "前塞今夜会不会开门，全看谁先递对口令", "后坡裂口近来总有阴火顺风上窜"],
    encounterHooks: ["护送：有人要你护一件黑货过塞", "追索：暗线客让你找一位失联的卖讯人", "探碑：鬼市塞的旧碑会记下错名之人"],
    secretRealmHooks: ["灰市暗层：鬼市塞地下暗层会定时换门", "妖巢裂隙：后坡裂口内时常透出妖风"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_7", targetMapName: "碎玉市", travelType: "portal", label: "回返主阵", summary: "回返主阵能把鬼市塞的黑货送回碎玉市出手。"},
      { role: "return", targetMapId: "world_open_11", targetMapName: "鹿门坡", travelType: "road", label: "回返山道", summary: "回返山道退向鹿门坡，比主阵更隐蔽。"},
      { role: "branch", targetMapId: "world_open_16", targetMapName: "葬阵垒", travelType: "rift", label: "灰域岔阵", summary: "岔阵通往葬阵垒，两地之间的死气往来最频。"},
    ],
  },
  {
    id: "world_open_16",
    name: "葬阵垒",
    archetype: "边荒据点",
    regionBand: "边荒灰域带",
    heatTier: "cold",
    heatScore: 38,
    dangerLevel: 78,
    mysteryLevel: 84,
    theme: "废阵成垒，死气与旧禁制纠缠不散，连风声都像从坟里吹出来",
    description: "葬阵垒是第五阶段的高危终点图，默认冷层冻结，但最适合挂接裂隙、秘境和高神秘奇闻。",
    districts: ["葬阵前垒", "葬阵中台", "葬阵裂谷"],
    buildingTags: ["葬阵残垒", "封阵石台", "裂谷哨点", "边荒回返阵"],
    resourceThemes: ["葬阵灰石", "死气残片", "断阵骨符"],
    rumorSeeds: ["葬阵裂谷里近来总回荡着不属于活人的脚步声", "封阵石台昨夜多出一道新血线", "有人说回风阁那边已经开始听见这里的风"],
    encounterHooks: ["破阵：石台上的旧封阵开始松动", "追索：有人要你找回一块丢失的断阵骨符", "探碑：前垒残碑会显出裂隙开启的时刻"],
    secretRealmHooks: ["残阵秘窟：葬阵垒深处埋着最完整的残阵窟", "荒废洞府：裂谷底部藏着一座无人敢认领的旧洞府"],
    travelConnections: [
      { role: "main", targetMapId: "world_open_8", targetMapName: "回风阁", travelType: "portal", label: "回返主阵", summary: "回返主阵会把你送回回风阁，把最危险的风声带回热图。"},
      { role: "return", targetMapId: "world_open_12", targetMapName: "青藤岭", travelType: "road", label: "回返山道", summary: "回返山道从裂谷边摸回青藤岭，不必暴露在主阵上。"},
      { role: "branch", targetMapId: "world_open_15", targetMapName: "鬼市塞", travelType: "rift", label: "灰域岔阵", summary: "岔阵与鬼市塞相连，两边的暗线与死气互相勾连。"},
    ],
  },
] as const satisfies readonly OpenWorldMapBlueprint[];

export const OPEN_WORLD_MAP_LIMIT = OPEN_WORLD_MAP_BLUEPRINTS.length;

export const OPEN_WORLD_NPC_ORIGINS = ["寒门", "猎户", "散修", "坊市子弟", "山村", "边军遗孤", "流徙罪民", "旧矿孤儿"] as const;
export const OPEN_WORLD_NPC_PROFESSIONS = ["药农", "行脚商", "猎修", "摊主", "巡山人", "散修客", "夜行客", "黑市牙人"] as const;
export const OPEN_WORLD_NPC_FACTIONS = ["无门散人", "市井", "山泽", "古道盟", "清风集", "北荒行营", "黑市暗线", "血煞旁门"] as const;
export const OPEN_WORLD_NPC_TRAITS = [
  "谨慎",
  "多疑",
  "热心",
  "贪利",
  "沉静",
  "狠辣",
  "爱酒",
  "念旧",
  "胆大",
  "机敏",
  "冷酷",
  "偏执",
  "薄情",
  "隐忍",
  "嗜血",
  "圆滑",
] as const;

export type OpenWorldNpcAlignment = "orthodox" | "gray" | "shadow";

export type OpenWorldNpcDisposition = {
  alignment: OpenWorldNpcAlignment;
  alignmentLabel: string;
  shadowScore: number;
  probeBias: number;
  assassinationBias: number;
};

type OpenWorldNpcArchetypeProfile = {
  origins: readonly string[];
  professions: readonly string[];
  factions: readonly string[];
  crowdLabels: readonly string[];
  behaviorWeights: {
    wander: number;
    gather: number;
    hunt: number;
    loot: number;
    return: number;
    stall: number;
  };
};

export const OPEN_WORLD_NPC_ARCHETYPE_PROFILES: Record<OpenWorldArchetype, OpenWorldNpcArchetypeProfile> = {
  "凡人城镇": {
    origins: OPEN_WORLD_NPC_ORIGINS,
    professions: OPEN_WORLD_NPC_PROFESSIONS,
    factions: OPEN_WORLD_NPC_FACTIONS,
    crowdLabels: ["药农", "行商", "游历修士", "灰巷来客"],
    behaviorWeights: {
      wander: 22,
      gather: 20,
      hunt: 16,
      loot: 14,
      return: 12,
      stall: 16,
    },
  },
  "修士坊市": {
    origins: ["坊市子弟", "散修", "寒门", "旧商号后人", "外来游修", "炼器学徒", "逃契学徒"],
    professions: ["行脚商", "摊主", "符材贩子", "灵材掮客", "散修客", "法器摊主", "黑市牙人"],
    factions: ["市井", "清风集", "古道盟", "无门散人", "百货行", "旧符会", "黑市暗线", "夜渡会"],
    crowdLabels: ["散修", "行商", "摆摊修士", "黑市掮客"],
    behaviorWeights: {
      wander: 20,
      gather: 14,
      hunt: 15,
      loot: 17,
      return: 12,
      stall: 22,
    },
  },
  "山野聚落": {
    origins: ["猎户", "山村", "散修", "采药人家", "溪谷旧民", "守林后裔", "逐宗弃徒"],
    professions: ["药农", "猎修", "巡山人", "采药客", "溪谷守望", "散修客", "夜行客"],
    factions: ["山泽", "无门散人", "清风集", "古道盟", "溪谷会", "松岭采修", "瘴林旁门"],
    crowdLabels: ["采药客", "猎修", "山居散修", "瘴林异修"],
    behaviorWeights: {
      wander: 18,
      gather: 24,
      hunt: 18,
      loot: 12,
      return: 14,
      stall: 14,
    },
  },
  "边荒据点": {
    origins: ["边军遗孤", "猎户", "散修", "流民", "旧营后人", "荒道脚夫", "逃荒罪徒"],
    professions: ["巡山人", "猎修", "补给摊主", "守备修士", "斥候", "散修客", "血契亡命"],
    factions: ["北荒行营", "古道盟", "无门散人", "山泽", "巡边队", "荒道同盟", "血煞旁门", "灰营客"],
    crowdLabels: ["巡边修士", "补给商", "边地散修", "亡命客"],
    behaviorWeights: {
      wander: 18,
      gather: 14,
      hunt: 24,
      loot: 16,
      return: 16,
      stall: 12,
    },
  },
  "宗门聚落": {
    origins: ["外门弟子", "杂役出身", "药园学徒", "山下寒门", "护山客", "旧门旁支", "逐出门墙者"],
    professions: ["守山弟子", "丹房学徒", "剑坪值守", "藏经阁抄录", "药园弟子", "外门执事", "罚役弟子"],
    factions: ["外门", "戒律堂", "丹房", "藏经阁", "护山队", "云麓别院", "弃脉客"],
    crowdLabels: ["外门弟子", "丹房学徒", "护山修士", "失势门人"],
    behaviorWeights: {
      wander: 20,
      gather: 18,
      hunt: 22,
      loot: 10,
      return: 18,
      stall: 12,
    },
  },
};

export const OPEN_WORLD_FEMALE_NAMES = ["柳青禾", "苏月白", "何秋棠", "顾灵汐", "沈知遥", "宁小霜"] as const;
export const OPEN_WORLD_MALE_NAMES = ["陈砚生", "林渡", "谢临川", "周行简", "卫长风", "白景尘"] as const;

export function getOpenWorldFemaleNamePool() {
  return mergeKeywordStringList(
    mergeKeywordStringList(getCachedOpenWorldAiKeywordPool().femaleNames, buildOpenWorldCustomNpcNamePool("female")),
    OPEN_WORLD_FEMALE_NAMES,
  );
}

export function getOpenWorldMaleNamePool() {
  return mergeKeywordStringList(
    mergeKeywordStringList(getCachedOpenWorldAiKeywordPool().maleNames, buildOpenWorldCustomNpcNamePool("male")),
    OPEN_WORLD_MALE_NAMES,
  );
}

export function getOpenWorldNpcTraitPool() {
  return mergeKeywordStringList(getCachedOpenWorldAiKeywordPool().npcTraits, OPEN_WORLD_NPC_TRAITS);
}

export const OPEN_WORLD_REALM_NAMES = [
  "凡人",
  "练气期一重",
  "练气期二重",
  "练气期三重",
  "练气期四重",
  "练气期五重",
  "练气期六重",
  "练气期七重",
  "练气期八重",
  "练气期九重",
] as const;

export const OPEN_WORLD_ACTION_LABELS: Record<OpenWorldNpcAction, string> = {
  idle: "驻足观望",
  wander: "沿街游走",
  gather: "采集草药",
  hunt: "追逐低阶妖物",
  loot: "收拾战利",
  return: "回城歇脚",
  stall: "摆摊叫卖",
  dead: "身死道消",
};

export function normalizeOpenWorldAction(action: string | null | undefined): OpenWorldNpcAction {
  if (!action) {
    return "idle";
  }
  return OPEN_WORLD_NPC_ACTIONS.includes(action as OpenWorldNpcAction)
    ? action as OpenWorldNpcAction
    : "idle";
}

export function getOpenWorldActionLabel(action: string | null | undefined) {
  return OPEN_WORLD_ACTION_LABELS[normalizeOpenWorldAction(action)];
}

export function buildOpenWorldNpcActionLabel(params: {
  action: string | null | undefined;
  seed: string;
  profession?: string | null;
  faction?: string | null;
  traitTags?: string[] | null;
}) {
  const action = normalizeOpenWorldAction(params.action);
  if (action === "dead") {
    return OPEN_WORLD_ACTION_LABELS.dead;
  }

  const keywordPool = getCachedOpenWorldAiKeywordPool();
  const socialKeyword = trimFlavorKeyword(
    keywordPool.npcSocialKeywords[hashSeed(`${params.seed}:social`) % keywordPool.npcSocialKeywords.length] || "",
    "走动",
  );
  const lifeKeyword = trimFlavorKeyword(
    keywordPool.npcLifeKeywords[hashSeed(`${params.seed}:life`) % keywordPool.npcLifeKeywords.length] || "",
    "生计",
  );
  const relationKeyword = trimFlavorKeyword(
    keywordPool.relationshipKeywords[hashSeed(`${params.seed}:relation`) % keywordPool.relationshipKeywords.length] || "",
    "旧识",
  );
  const profession = String(params.profession || "").trim();
  const faction = String(params.faction || "").trim();
  const traitTags = Array.isArray(params.traitTags) ? params.traitTags.filter(Boolean) : [];
  const careful = traitTags.includes("谨慎") || traitTags.includes("多疑") || traitTags.includes("沉静");
  const merchantLike = /(商|摊|牙人|货|贩)/.test(profession);
  const herbLike = /(药|丹|圃|采)/.test(profession);
  const hunterLike = /(猎|巡|守|斥候)/.test(profession);

  if (action === "wander") {
    if (merchantLike) {
      return `沿街${socialKeyword}`;
    }
    return careful ? `探听${relationKeyword}` : `访旧${socialKeyword}`;
  }
  if (action === "gather") {
    if (herbLike) {
      return `替人采药`;
    }
    return `收拢${lifeKeyword}`;
  }
  if (action === "hunt") {
    if (hunterLike) {
      return `追妖换赏`;
    }
    return faction.includes("黑市") ? `追索旧账` : `结伙猎妖`;
  }
  if (action === "loot") {
    return merchantLike ? `清点货色` : `收拾余财`;
  }
  if (action === "return") {
    return `回去${socialKeyword}`;
  }
  if (action === "stall") {
    return merchantLike ? `摆摊还价` : `守着生计`;
  }
  return getOpenWorldActionLabel(action);
}

export function buildOpenWorldNpcPersonalitySummary(params: {
  seed: string;
  name: string;
  originType: string;
  profession: string;
  faction: string;
  traitTags: string[];
}) {
  const keywordPool = getCachedOpenWorldAiKeywordPool();
  const personalityKeyword = trimFlavorKeyword(
    keywordPool.npcPersonalityKeywords[hashSeed(`${params.seed}:personality`) % keywordPool.npcPersonalityKeywords.length] || "",
    "讲人情",
  );
  const lifeKeyword = trimFlavorKeyword(
    keywordPool.npcLifeKeywords[hashSeed(`${params.seed}:livelihood`) % keywordPool.npcLifeKeywords.length] || "",
    "顾着生计",
  );
  const socialKeyword = trimFlavorKeyword(
    keywordPool.npcSocialKeywords[hashSeed(`${params.seed}:social-summary`) % keywordPool.npcSocialKeywords.length] || "",
    "照应",
  );
  const traits = params.traitTags.filter(Boolean).slice(0, 3);
  return `${params.name}出身${params.originType}，在${params.faction}一带以${params.profession}谋生，性情${traits.join("、")}，平日${personalityKeyword}，也总在为${lifeKeyword}与${socialKeyword}奔忙。`;
}

export function pickOpenWorldArchetype(index: number): OpenWorldArchetype {
  return OPEN_WORLD_MAP_BLUEPRINTS[index % OPEN_WORLD_MAP_BLUEPRINTS.length]?.archetype || OPEN_WORLD_ACTIVE_MAP_ARCHETYPES[0];
}

export function getOpenWorldNpcArchetypeProfile(archetype: OpenWorldArchetype) {
  const baseProfile = OPEN_WORLD_NPC_ARCHETYPE_PROFILES[archetype];
  const keywordPool = getCachedOpenWorldAiKeywordPool();
  return {
    ...baseProfile,
    origins: mergeKeywordStringList(keywordPool.npcOrigins, baseProfile.origins),
    professions: mergeKeywordStringList(keywordPool.npcProfessions, baseProfile.professions),
    factions: mergeKeywordStringList(keywordPool.npcFactions, baseProfile.factions),
  };
}

function scoreCustomNpcForMap(params: {
  npc: OpenWorldCustomNpcDefinition;
  mapId: string;
  mapName: string;
  archetype: OpenWorldArchetype;
  regionBand: OpenWorldRegionBand;
}) {
  if (!params.npc.allowDynamicWorldSpawn) {
    return -1;
  }
  let score = 0;
  if (params.npc.preferredMapIds.includes(params.mapId)) {
    score += 120;
  }
  const tagSet = new Set([
    params.mapId,
    params.mapName,
    params.archetype,
    params.regionBand,
  ]);
  params.npc.preferredMapTags.forEach((tag) => {
    if (tagSet.has(tag)) {
      score += 40;
    }
  });
  if (score <= 0 && params.npc.preferredMapIds.length <= 0 && params.npc.preferredMapTags.length <= 0) {
    score = 12;
  }
  return score;
}

export function pickOpenWorldCustomNpcsForMap(params: {
  mapId: string;
  mapName: string;
  archetype: OpenWorldArchetype;
  regionBand: OpenWorldRegionBand;
}) {
  const limit = Math.max(1, Math.min(
    OPEN_WORLD_CUSTOM_NPC_PER_MAP_LIMIT,
    getCachedOpenWorldPressureReliefRules().perMapCustomNpcLimit,
  ));
  return getCachedOpenWorldCustomNpcLibrary().npcs
    .map((npc) => ({
      npc,
      score: scoreCustomNpcForMap({
        npc,
        mapId: params.mapId,
        mapName: params.mapName,
        archetype: params.archetype,
        regionBand: params.regionBand,
      }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return hashSeed(`${params.mapId}:${left.npc.id}`) - hashSeed(`${params.mapId}:${right.npc.id}`);
    })
    .slice(0, limit)
    .map((entry) => entry.npc);
}

export function findOpenWorldCustomNpcByGeneratedId(generatedNpcId: string) {
  const match = String(generatedNpcId || "").match(/:custom:([^:]+)$/);
  if (!match) {
    return null;
  }
  const customNpcId = String(match[1] || "").trim();
  if (!customNpcId) {
    return null;
  }
  return getCachedOpenWorldCustomNpcLibrary().npcs.find((npc) => npc.id === customNpcId) || null;
}

export function buildOpenWorldContextSnapshot() {
  const reliefRules = getCachedOpenWorldPressureReliefRules();
  const customNpcLibrary = getCachedOpenWorldCustomNpcLibrary();
  return {
    keywordPool: getCachedOpenWorldAiKeywordPool(),
    pressureReliefRules: {
      highCorruptionThreshold: reliefRules.highCorruptionThreshold,
      perMapCustomNpcLimit: reliefRules.perMapCustomNpcLimit,
      rules: reliefRules.rules.map((rule) => ({
        offerType: rule.offerType,
        label: rule.label,
        sourceFaction: rule.sourceFaction,
        baseReliefValue: rule.baseReliefValue,
        pressureTargets: [...rule.pressureTargets],
        requiresKeywords: [...rule.requiresKeywords],
        coerciveFlavorLevel: rule.coerciveFlavorLevel,
        forcedActions: [...rule.forcedActions],
      })),
    },
    customNpcLibrary: {
      totalCount: customNpcLibrary.npcs.length,
      npcs: customNpcLibrary.npcs.slice(0, 12).map((npc) => ({
        id: npc.id,
        name: npc.name,
        gender: npc.gender,
        faction: npc.faction,
        profession: npc.profession,
        preferredMapIds: [...npc.preferredMapIds],
        preferredMapTags: [...npc.preferredMapTags],
        worldBookKeywords: [...npc.worldBookKeywords],
        grayTags: [...npc.grayTags],
        relationshipTags: [...npc.relationshipTags],
      })),
    },
    forcedRules: getOpenWorldForcedRuleSnapshot(),
  };
}

export function listOpenWorldMapBlueprints() {
  return OPEN_WORLD_MAP_BLUEPRINTS.map((blueprint) => ({
    ...blueprint,
    districts: [...blueprint.districts],
    buildingTags: [...blueprint.buildingTags],
    resourceThemes: [...blueprint.resourceThemes],
    rumorSeeds: [...blueprint.rumorSeeds],
    encounterHooks: [...blueprint.encounterHooks],
    secretRealmHooks: [...blueprint.secretRealmHooks],
    travelConnections: blueprint.travelConnections.map((connection) => ({ ...connection })),
  })) as OpenWorldMapBlueprint[];
}

export function getOpenWorldMapBlueprintById(mapId: string) {
  return listOpenWorldMapBlueprints().find((blueprint) => blueprint.id === mapId) || null;
}

export function resolveOpenWorldHeatTierLabel(heatTier: OpenWorldHeatTier) {
  if (heatTier === "hot") {
    return "热地图";
  }
  if (heatTier === "warm") {
    return "温地图";
  }
  return "冷地图";
}

export function resolveOpenWorldHeatTierSortValue(heatTier: OpenWorldHeatTier) {
  if (heatTier === "hot") {
    return 3;
  }
  if (heatTier === "warm") {
    return 2;
  }
  return 1;
}

export function normalizeOpenWorldHeatTier(value: string | null | undefined): OpenWorldHeatTier {
  if (value === "hot" || value === "warm" || value === "cold") {
    return value;
  }
  return "cold";
}

export function normalizeOpenWorldRegionBand(value: string | null | undefined): OpenWorldRegionBand {
  return OPEN_WORLD_REGION_BANDS.find((entry) => entry === value) || "凡尘城镇带";
}

export function resolveOpenWorldNpcDisposition(params: {
  faction?: string | null;
  profession?: string | null;
  traitTags?: string[] | null;
  realmMinor?: number | null;
}) {
  const faction = String(params.faction || "").trim();
  const profession = String(params.profession || "").trim();
  const traitTags = Array.isArray(params.traitTags) ? params.traitTags.filter(Boolean) : [];
  const realmMinor = Math.max(1, Number(params.realmMinor || 1));

  const shadowTraits = new Set(["狠辣", "冷酷", "偏执", "薄情", "隐忍", "嗜血"]);
  const grayTraits = new Set(["多疑", "贪利", "圆滑", "机敏", "胆大"]);
  const brightTraits = new Set(["热心", "念旧", "谨慎", "沉静"]);
  const shadowFactions = ["血煞", "黑市", "旁门", "夜渡", "瘴林", "灰营"];
  const shadowProfessions = ["夜行", "黑市", "血契", "牙人"];

  let shadowScore = 24;

  traitTags.forEach((tag) => {
    if (shadowTraits.has(tag)) {
      shadowScore += 14;
      return;
    }
    if (grayTraits.has(tag)) {
      shadowScore += 8;
      return;
    }
    if (brightTraits.has(tag)) {
      shadowScore -= 6;
    }
  });

  if (shadowFactions.some((keyword) => faction.includes(keyword))) {
    shadowScore += 26;
  } else if (["山泽", "古道盟", "弃脉客", "无门散人"].some((keyword) => faction.includes(keyword))) {
    shadowScore += 8;
  }

  if (shadowProfessions.some((keyword) => profession.includes(keyword))) {
    shadowScore += 18;
  } else if (["猎修", "斥候", "巡山人"].some((keyword) => profession.includes(keyword))) {
    shadowScore += 7;
  }

  shadowScore += Math.max(0, realmMinor - 4) * 2;
  shadowScore = Math.max(0, Math.min(100, shadowScore));

  const alignment = shadowScore >= 68
    ? "shadow"
    : shadowScore >= 40
      ? "gray"
      : "orthodox";
  const alignmentLabel = alignment === "shadow"
    ? "魔修暗潮"
    : alignment === "gray"
      ? "灰色修士"
      : "守序一脉";
  const probeBias = Math.max(0.12, Math.min(0.82, 0.12 + shadowScore / 140 + Math.max(0, realmMinor - 2) * 0.015));
  const assassinationBias = Math.max(0.03, Math.min(0.72, 0.02 + shadowScore / 170 + Math.max(0, realmMinor - 3) * 0.02));

  return {
    alignment,
    alignmentLabel,
    shadowScore,
    probeBias,
    assassinationBias,
  } satisfies OpenWorldNpcDisposition;
}

export function buildOpenWorldSeed(prefix: string, index: number) {
  return `${prefix}-${index}`;
}

export async function getOpenWorldEntranceConfig() {
  return getGameStartConfig();
}

export async function getOpenWorldSystemConfigMap() {
  return getSystemConfigMap(OPEN_WORLD_SYSTEM_CONFIG_KEYS);
}
