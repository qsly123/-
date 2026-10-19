import { chatCompletion } from "@/modules/ai/services/ai";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import { SYSTEM_CONFIG_ITEMS } from "@/modules/system/services/system-config-keys";
import {
  buildOpenWorldContextSnapshot,
  getCachedOpenWorldAiKeywordPool,
  type OpenWorldAiKeywordPool,
  getCachedOpenWorldCustomNpcLibrary,
  getOpenWorldNpcArchetypeProfile,
  type OpenWorldCustomNpcDefinition,
  type OpenWorldCustomNpcLibrary,
  warmOpenWorldAiKeywordPool,
  warmOpenWorldCustomNpcLibrary,
  warmOpenWorldPressureReliefRules,
} from "@/modules/world/services/world-config";
import {
  buildOpenWorldWorldBookContext,
  type OpenWorldWorldBookScene,
} from "@/modules/world/services/world-worldbook";
import type {
  GeneratedOpenWorldMapDraft,
  GeneratedOpenWorldNpcDraft,
} from "@/modules/world/services/world-map-generator";

type OpenWorldPromptKey =
  | "OPEN_WORLD_STYLE_MASTER_PROMPT"
  | "OPEN_WORLD_STYLE_NEGATIVE_PROMPT"
  | "OPEN_WORLD_MAP_PROMPT"
  | "OPEN_WORLD_NPC_DNA_PROMPT"
  | "OPEN_WORLD_KEYWORD_POOL_PROMPT"
  | "OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT"
  | "OPEN_WORLD_CUSTOM_NPC_PROMPT"
  | "OPEN_WORLD_DYNAMIC_VISITOR_PROMPT"
  | "OPEN_WORLD_NPC_RELATION_PROMPT"
  | "OPEN_WORLD_NPC_LIFE_LOG_PROMPT"
  | "OPEN_WORLD_TIANDAO_EVENT_PROMPT"
  | "OPEN_WORLD_NPC_BARK_PROMPT"
  | "OPEN_WORLD_DISTRICT_RUMOR_PROMPT"
  | "OPEN_WORLD_FACTION_TONE_PROMPT"
  | "OPEN_WORLD_DISTRICT_STATE_PROMPT"
  | "OPEN_WORLD_STORYLINE_PROMPT"
  | "OPEN_WORLD_NPC_FACTION_HINT_PROMPT"
  | "OPEN_WORLD_SHADOW_EVENT_PROMPT"
  | "OPEN_WORLD_ADULT_PROFILE_PROMPT"
  | "OPEN_WORLD_ADULT_INVITE_PROMPT"
  | "OPEN_WORLD_ADULT_ACCEPT_PROMPT"
  | "OPEN_WORLD_ADULT_REJECT_PROMPT"
  | "OPEN_WORLD_ADULT_RESULT_PROMPT"
  | "OPEN_WORLD_ADULT_DRAIN_PROMPT"
  | "OPEN_WORLD_ADULT_PREGNANCY_PROMPT"
  | "OPEN_WORLD_ADULT_RUMOR_PROMPT"
  | "OPEN_WORLD_ADULT_BARK_PROMPT"
  | "OPEN_WORLD_CORRUPTION_GROWTH_PROMPT"
  | "OPEN_WORLD_WORLD_PRESSURE_FLAVOR_PROMPT"
  | "OPEN_WORLD_PRESSURE_RELIEF_PROMPT"
  | "OPEN_WORLD_RUMOR_SILENCE_PROMPT"
  | "OPEN_WORLD_LAWFUL_MEDIATION_PROMPT"
  | "OPEN_WORLD_CONSENSUAL_DUAL_CULTIVATION_PROMPT"
  | "OPEN_WORLD_FORCED_CONSEQUENCE_PROMPT"
  | "OPEN_WORLD_PARTNER_JEALOUSY_PROMPT";

type OpenWorldRuleKey =
  | "OPEN_WORLD_MAP_RULE"
  | "OPEN_WORLD_NPC_DNA_RULE"
  | "OPEN_WORLD_NPC_NAME_RULE"
  | "OPEN_WORLD_KEYWORD_POOL_RULE"
  | "OPEN_WORLD_CUSTOM_NPC_LIBRARY_RULE"
  | "OPEN_WORLD_NPC_BARK_RULE"
  | "OPEN_WORLD_ADULT_BARK_RULE"
  | "OPEN_WORLD_TIANDAO_EVENT_RULE"
  | "OPEN_WORLD_SHADOW_EVENT_RULE"
  | "OPEN_WORLD_PRESSURE_RELIEF_RULE"
  | "OPEN_WORLD_DISTRICT_RUMOR_RULE"
  | "OPEN_WORLD_FACTION_TONE_RULE"
  | "OPEN_WORLD_DISTRICT_STATE_RULE"
  | "OPEN_WORLD_STORYLINE_RULE"
  | "OPEN_WORLD_NPC_FACTION_HINT_RULE"
  | "OPEN_WORLD_ADULT_PROFILE_RULE"
  | "OPEN_WORLD_ADULT_INVITE_RULE"
  | "OPEN_WORLD_ADULT_RESULT_RULE"
  | "OPEN_WORLD_CORRUPTION_GROWTH_RULE"
  | "OPEN_WORLD_FORCED_CONSEQUENCE_RULE"
  | "OPEN_WORLD_PARTNER_JEALOUSY_RULE"
  | "OPEN_WORLD_ADULT_RUMOR_RULE"
  | "OPEN_WORLD_CUSTOM_NPC_PREVIEW_RULE";

type OpenWorldTemplateKey =
  | "OPEN_WORLD_MAP_TEMPLATE_JSON"
  | "OPEN_WORLD_NPC_DNA_TEMPLATE_JSON"
  | "OPEN_WORLD_KEYWORD_POOL_TEMPLATE_JSON"
  | "OPEN_WORLD_CUSTOM_NPC_LIBRARY_TEMPLATE_JSON"
  | "OPEN_WORLD_NPC_BARK_TEMPLATE_JSON"
  | "OPEN_WORLD_ADULT_BARK_TEMPLATE_JSON"
  | "OPEN_WORLD_TIANDAO_EVENT_TEMPLATE_JSON"
  | "OPEN_WORLD_SHADOW_EVENT_TEMPLATE_JSON"
  | "OPEN_WORLD_PRESSURE_RELIEF_TEMPLATE_JSON"
  | "OPEN_WORLD_DISTRICT_RUMOR_TEMPLATE_JSON"
  | "OPEN_WORLD_FACTION_TONE_TEMPLATE_JSON"
  | "OPEN_WORLD_DISTRICT_STATE_TEMPLATE_JSON"
  | "OPEN_WORLD_STORYLINE_TEMPLATE_JSON"
  | "OPEN_WORLD_NPC_FACTION_HINT_TEMPLATE_JSON"
  | "OPEN_WORLD_ADULT_PROFILE_TEMPLATE_JSON"
  | "OPEN_WORLD_ADULT_INVITE_TEMPLATE_JSON"
  | "OPEN_WORLD_ADULT_RESULT_TEMPLATE_JSON"
  | "OPEN_WORLD_CORRUPTION_GROWTH_TEMPLATE_JSON"
  | "OPEN_WORLD_FORCED_CONSEQUENCE_TEMPLATE_JSON"
  | "OPEN_WORLD_PARTNER_JEALOUSY_TEMPLATE_JSON"
  | "OPEN_WORLD_ADULT_RUMOR_TEMPLATE_JSON"
  | "OPEN_WORLD_CUSTOM_NPC_PREVIEW_TEMPLATE_JSON";

type OpenWorldActionKey = "wander" | "gather" | "hunt" | "loot" | "return" | "stall";
const OPEN_WORLD_AI_TIMEOUT_MS = 30_000;
const OPEN_WORLD_STYLE_MASTER_KEY = "OPEN_WORLD_STYLE_MASTER_PROMPT" as const;
const OPEN_WORLD_STYLE_NEGATIVE_KEY = "OPEN_WORLD_STYLE_NEGATIVE_PROMPT" as const;

function buildOpenWorldKeywordPoolSnapshot() {
  const keywordPool = getCachedOpenWorldAiKeywordPool();
  return {
    femaleNames: keywordPool.femaleNames.slice(0, 8),
    maleNames: keywordPool.maleNames.slice(0, 8),
    npcOrigins: keywordPool.npcOrigins.slice(0, 12),
    npcProfessions: keywordPool.npcProfessions.slice(0, 12),
    npcFactions: keywordPool.npcFactions.slice(0, 12),
    npcTraits: keywordPool.npcTraits.slice(0, 16),
    npcPersonalityKeywords: keywordPool.npcPersonalityKeywords.slice(0, 10),
    npcLifeKeywords: keywordPool.npcLifeKeywords.slice(0, 10),
    npcSocialKeywords: keywordPool.npcSocialKeywords.slice(0, 12),
    relationshipKeywords: keywordPool.relationshipKeywords.slice(0, 12),
    districtKeywords: keywordPool.districtKeywords.slice(0, 12),
    resourceKeywords: keywordPool.resourceKeywords.slice(0, 12),
    rumorKeywords: keywordPool.rumorKeywords.slice(0, 12),
    marketBuyerTitles: keywordPool.marketBuyerTitles.slice(0, 8),
  };
}

export type OpenWorldMapMetaResult = {
  source: "ai" | "fallback";
  theme: string;
  districts: string[];
  buildingTags: string[];
  resourceThemes: string[];
  npcCrowds: string[];
  rumorSeeds: string[];
  description: string;
};

export type OpenWorldNpcDnaProfile = {
  source: "ai" | "fallback";
  name: string;
  originType: string;
  profession: string;
  faction: string;
  personalitySummary: string;
  traitTags: string[];
  behaviorWeights: Record<OpenWorldActionKey, number>;
  biography: string;
};

export type OpenWorldNpcDnaBatchResult = {
  source: "ai" | "fallback";
  profiles: Record<string, OpenWorldNpcDnaProfile>;
};

export type OpenWorldNpcBarkResult = {
  source: "ai" | "fallback";
  mood: string;
  content: string;
  lines: string[];
};

export type OpenWorldTiandaoEventResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  tone: "calm" | "omen" | "warning" | "auspicious";
  content: string;
};

export type OpenWorldDistrictRumor = {
  districtName: string;
  title: string;
  content: string;
  heat: "low" | "medium" | "high";
};

export type OpenWorldDistrictRumorResult = {
  source: "ai" | "fallback";
  rumors: OpenWorldDistrictRumor[];
};

export type OpenWorldFactionToneResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  hints: string[];
};

export type OpenWorldDistrictStateFlavorResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  hooks: string[];
};

export type OpenWorldStorylineFlavorResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  nextMove: string;
};

export type OpenWorldNpcFactionHintResult = {
  source: "ai" | "fallback";
  surfaceFaction: string;
  stanceLabel: string;
  hazeLabel: string;
  hints: string[];
};

export type OpenWorldShadowEventResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  tone: "low" | "medium" | "high";
};

export type OpenWorldAdultProfileResult = {
  source: "ai" | "fallback";
  dispositionLabel: string;
  summary: string;
  roleTags: string[];
  preferenceTags: string[];
  preferenceHints: string[];
  corruptionStageLabel: string;
};

export type OpenWorldAdultInviteResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  atmosphere: string;
  responseOptions: string[];
};

export type OpenWorldAdultOutcomeResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  atmosphere: string;
  worldConsequence: string;
  changeHints: string[];
  fallbackReason?: string | null;
};

export type OpenWorldAdultRumorResult = {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  heat: "low" | "medium" | "high";
};

export type OpenWorldCorruptionGrowthResult = {
  source: "ai" | "fallback";
  summary: string;
  changeHints: string[];
  fallbackReason?: string | null;
};

export type OpenWorldCustomNpcPreviewResult = {
  source: "ai" | "fallback";
  summary: string;
  entries: Array<{
    npcId: string;
    sceneHint: string;
    mood: string;
    tags: string[];
  }>;
};

export type OpenWorldKeywordPoolGenerationResult = {
  source: "ai" | "fallback";
  summary: string;
  keywordPool: OpenWorldAiKeywordPool;
  fallbackReason?: string | null;
};

export type OpenWorldCustomNpcLibraryGenerationResult = {
  source: "ai" | "fallback";
  summary: string;
  library: OpenWorldCustomNpcLibrary;
  fallbackReason?: string | null;
};

function findDefaultPrompt(key: OpenWorldPromptKey) {
  return SYSTEM_CONFIG_ITEMS.find((item) => item.key === key)?.defaultValue?.trim() || "";
}

async function resolvePrompt(key: OpenWorldPromptKey) {
  const configured = await getSystemConfigValue(key);
  return configured?.trim() || findDefaultPrompt(key);
}

function findDefaultRule(key: OpenWorldRuleKey) {
  return SYSTEM_CONFIG_ITEMS.find((item) => item.key === key)?.defaultValue?.trim() || "";
}

async function resolveRule(key: OpenWorldRuleKey, fallback: string) {
  const configured = await getSystemConfigValue(key);
  return configured?.trim() || findDefaultRule(key) || fallback;
}

async function resolveTemplate<T extends Record<string, unknown>>(key: OpenWorldTemplateKey, fallback: T): Promise<T> {
  const configured = await getSystemConfigValue(key);
  const candidate = configured?.trim() || SYSTEM_CONFIG_ITEMS.find((item) => item.key === key)?.defaultValue?.trim() || "";
  if (!candidate) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function pickJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const startIndex = trimmed.indexOf("{");
  if (startIndex < 0) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function normalizeLooseJson(text: string) {
  return text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const rawCandidate = pickJsonObject(text);
  const candidates = [rawCandidate, normalizeLooseJson(rawCandidate), normalizeLooseJson(text)]
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function trimText(value: unknown, maxLength: number, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.slice(0, maxLength) || fallback;
}

function findLastBreakIndex(text: string, maxLength: number, pattern: RegExp) {
  const slice = text.slice(0, maxLength + 1);
  let match: RegExpExecArray | null = null;
  let lastIndex = -1;
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  do {
    match = globalPattern.exec(slice);
    if (match) {
      lastIndex = match.index;
    }
  } while (match);
  return lastIndex;
}

function trimNarrativeText(value: unknown, maxLength: number, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const minAcceptableLength = Math.max(24, Math.floor(maxLength * 0.6));
  const strongBreakIndex = findLastBreakIndex(normalized, maxLength, /[。！？!?；;]/g);
  if (strongBreakIndex >= minAcceptableLength) {
    return normalized.slice(0, strongBreakIndex + 1).trim();
  }

  const softBreakIndex = findLastBreakIndex(normalized, maxLength, /[，、：,:）)\]】」』〉》]/g);
  if (softBreakIndex >= minAcceptableLength) {
    return `${normalized.slice(0, softBreakIndex + 1).trim()}…`;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || "未知异常";
  }
  if (typeof error === "string") {
    const message = error.trim();
    return message || "未知异常";
  }
  return "未知异常";
}

function normalizeStringArray(value: unknown, maxCount: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => trimText(entry, maxLength))
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, maxCount);
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

async function requestOpenWorldJson(
  key: OpenWorldPromptKey,
  payload: Record<string, unknown>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    worldBookScene?: OpenWorldWorldBookScene;
    omitKeywordPoolSnapshot?: boolean;
    omitCustomNpcLibrarySnapshot?: boolean;
  },
) {
  await Promise.all([
    warmOpenWorldAiKeywordPool(),
    warmOpenWorldPressureReliefRules(),
    warmOpenWorldCustomNpcLibrary(),
  ]);
  const outputTemplate = payload.responseFormat && typeof payload.responseFormat === "object" && !Array.isArray(payload.responseFormat)
    ? payload.responseFormat as Record<string, unknown>
    : null;
  const payloadWithoutResponseFormat = Object.fromEntries(
    Object.entries(payload).filter(([entryKey]) => entryKey !== "responseFormat"),
  );
  const contextSnapshot = buildOpenWorldContextSnapshot();
  const enrichedPayload = {
    ...payloadWithoutResponseFormat,
    ...(options?.omitKeywordPoolSnapshot ? {} : {
      keywordPool: buildOpenWorldKeywordPoolSnapshot(),
    }),
    pressureReliefRules: contextSnapshot.pressureReliefRules,
    ...(options?.omitCustomNpcLibrarySnapshot ? {} : {
      customNpcLibrary: contextSnapshot.customNpcLibrary,
    }),
    forcedRules: contextSnapshot.forcedRules,
  };
  const [prompt, styleMasterPrompt, styleNegativePrompt, worldBookContext] = await Promise.all([
    resolvePrompt(key),
    key === OPEN_WORLD_STYLE_MASTER_KEY ? Promise.resolve("") : resolvePrompt(OPEN_WORLD_STYLE_MASTER_KEY),
    key === OPEN_WORLD_STYLE_NEGATIVE_KEY ? Promise.resolve("") : resolvePrompt(OPEN_WORLD_STYLE_NEGATIVE_KEY),
    options?.worldBookScene
      ? buildOpenWorldWorldBookContext({
        scene: options.worldBookScene,
        payload: enrichedPayload,
      })
      : Promise.resolve(null),
  ]);
  const promptSections = [
    worldBookContext?.beforeText || "",
    styleMasterPrompt,
    prompt,
    styleNegativePrompt ? `额外负面约束：\n${styleNegativePrompt}` : "",
    worldBookContext?.afterText || "",
  ].filter(Boolean);
  const composedPrompt = promptSections.join("\n\n");
  const response = await chatCompletion(
    composedPrompt,
    [{
      role: "user",
      content: [
        "你现在不是自由写作，而是在按固定 JSON 模板填表。",
        "请先理解“输出模板”，再根据“输入数据”只填写 JSON 值。",
        "禁止输出 Markdown、禁止解释、禁止额外说明、禁止补充模板外字段、禁止删字段。",
        outputTemplate
          ? `输出模板（字段名必须保留，只能填值）：\n${JSON.stringify(outputTemplate, null, 2)}`
          : "",
        `输入数据：\n${JSON.stringify(enrichedPayload, null, 2)}`,
        "最终只返回一个完整 JSON 对象。",
      ].filter(Boolean).join("\n\n"),
    }],
    {
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 800,
      scene: "openWorld",
      timeoutMs: OPEN_WORLD_AI_TIMEOUT_MS,
      responseFormat: outputTemplate ? "json_object" : undefined,
    },
  );

  return parseJsonObject(response);
}

function buildFallbackMapMeta(mapDraft: GeneratedOpenWorldMapDraft): OpenWorldMapMetaResult {
  const archetypeProfile = getOpenWorldNpcArchetypeProfile(mapDraft.archetype);
  return {
    source: "fallback",
    theme: mapDraft.theme,
    districts: mapDraft.districts.slice(0, 3),
    buildingTags: mapDraft.buildingTags.slice(0, 4),
    resourceThemes: mapDraft.resourceThemes.slice(0, 3),
    npcCrowds: [...archetypeProfile.crowdLabels].slice(0, 3),
    rumorSeeds: mapDraft.rumorSeeds.slice(0, 3),
    description: mapDraft.description,
  };
}

function sanitizeMapMeta(payload: Record<string, unknown> | null, mapDraft: GeneratedOpenWorldMapDraft): OpenWorldMapMetaResult {
  const fallback = buildFallbackMapMeta(mapDraft);
  if (!payload) {
    return fallback;
  }

  const districts = normalizeStringArray(payload.districts, 4, 16);
  const buildingTags = normalizeStringArray(payload.buildingTags, 6, 12);
  const resourceThemes = normalizeStringArray(payload.resourceThemes, 5, 12);
  const npcCrowds = normalizeStringArray(payload.npcCrowds, 5, 12);
  const rumorSeeds = normalizeStringArray(payload.rumorSeeds, 4, 40);

  return {
    source: "ai",
    theme: trimText(payload.theme, 32, fallback.theme),
    districts: districts.length >= 3 ? districts : fallback.districts,
    buildingTags: buildingTags.length >= 3 ? buildingTags : fallback.buildingTags,
    resourceThemes: resourceThemes.length >= 2 ? resourceThemes : fallback.resourceThemes,
    npcCrowds: npcCrowds.length >= 2 ? npcCrowds : fallback.npcCrowds,
    rumorSeeds: rumorSeeds.length >= 2 ? rumorSeeds : fallback.rumorSeeds,
    description: trimText(payload.description, 120, fallback.description),
  };
}

function buildFallbackBehaviorWeights(): Record<OpenWorldActionKey, number> {
  return {
    wander: 22,
    gather: 20,
    hunt: 16,
    loot: 14,
    return: 12,
    stall: 16,
  };
}

function normalizeActionPreference(value: string): OpenWorldActionKey | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (["wander", "游走", "闲逛", "巡游"].includes(normalized)) {
    return "wander";
  }
  if (["gather", "采药", "采集", "收集"].includes(normalized)) {
    return "gather";
  }
  if (["hunt", "打怪", "狩猎", "斗法"].includes(normalized)) {
    return "hunt";
  }
  if (["loot", "拾取", "捡漏", "搜刮"].includes(normalized)) {
    return "loot";
  }
  if (["return", "回城", "回返", "归镇"].includes(normalized)) {
    return "return";
  }
  if (["stall", "摆摊", "贸易", "贩卖"].includes(normalized)) {
    return "stall";
  }
  return null;
}

function buildBehaviorWeightsFromPreferences(preferences: string[] | undefined) {
  const weights = buildFallbackBehaviorWeights();
  const normalizedPreferences = (preferences || [])
    .map((entry) => normalizeActionPreference(entry))
    .filter((entry, index, list): entry is OpenWorldActionKey => Boolean(entry) && list.indexOf(entry) === index);

  normalizedPreferences.forEach((preference, index) => {
    weights[preference] += Math.max(3, 10 - index * 3);
  });

  return weights;
}

function buildFallbackNpcProfile(npcDraft: GeneratedOpenWorldNpcDraft): OpenWorldNpcDnaProfile {
  return {
    source: "fallback",
    name: npcDraft.name,
    originType: npcDraft.originType,
    profession: npcDraft.profession,
    faction: npcDraft.faction,
    personalitySummary: npcDraft.personalitySummary,
    traitTags: npcDraft.traitTags.slice(0, 3),
    behaviorWeights: buildFallbackBehaviorWeights(),
    biography: npcDraft.initialLifeLog.content,
  };
}

function sanitizeKeywordPoolField(
  payload: Record<string, unknown> | null,
  key: keyof OpenWorldAiKeywordPool,
  fallback: readonly string[],
  maxCount: number,
) {
  if (!payload) {
    return [...fallback];
  }
  const normalized = normalizeStringArray(payload[key], maxCount, 24);
  return normalized.length > 0 ? normalized : [...fallback];
}

function sanitizeOpenWorldKeywordPoolGeneration(
  payload: Record<string, unknown> | null,
  keywordPoolPayload: Record<string, unknown> | null,
  fallbackPool: OpenWorldAiKeywordPool,
  summaryFallback: string,
  fallbackReason?: string | null,
): OpenWorldKeywordPoolGenerationResult {
  const keywordPool: OpenWorldAiKeywordPool = {
    femaleNames: sanitizeKeywordPoolField(keywordPoolPayload, "femaleNames", fallbackPool.femaleNames, 16),
    maleNames: sanitizeKeywordPoolField(keywordPoolPayload, "maleNames", fallbackPool.maleNames, 16),
    npcOrigins: sanitizeKeywordPoolField(keywordPoolPayload, "npcOrigins", fallbackPool.npcOrigins, 20),
    npcProfessions: sanitizeKeywordPoolField(keywordPoolPayload, "npcProfessions", fallbackPool.npcProfessions, 20),
    npcFactions: sanitizeKeywordPoolField(keywordPoolPayload, "npcFactions", fallbackPool.npcFactions, 20),
    npcTraits: sanitizeKeywordPoolField(keywordPoolPayload, "npcTraits", fallbackPool.npcTraits, 24),
    npcPersonalityKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "npcPersonalityKeywords", fallbackPool.npcPersonalityKeywords, 18),
    npcLifeKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "npcLifeKeywords", fallbackPool.npcLifeKeywords, 18),
    npcSocialKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "npcSocialKeywords", fallbackPool.npcSocialKeywords, 18),
    relationshipKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "relationshipKeywords", fallbackPool.relationshipKeywords, 18),
    districtKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "districtKeywords", fallbackPool.districtKeywords, 18),
    resourceKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "resourceKeywords", fallbackPool.resourceKeywords, 18),
    rumorKeywords: sanitizeKeywordPoolField(keywordPoolPayload, "rumorKeywords", fallbackPool.rumorKeywords, 18),
    marketBuyerTitles: sanitizeKeywordPoolField(keywordPoolPayload, "marketBuyerTitles", fallbackPool.marketBuyerTitles, 16),
  };

  return {
    source: payload ? "ai" : "fallback",
    summary: trimText(payload?.summary, 120, summaryFallback),
    keywordPool,
    fallbackReason: payload ? null : (fallbackReason || "模型返回内容不是可用的 JSON 对象。"),
  };
}

function buildKeywordPoolReferenceSnapshot(keywordPool: OpenWorldAiKeywordPool) {
  return {
    femaleNames: keywordPool.femaleNames.slice(0, 4),
    maleNames: keywordPool.maleNames.slice(0, 4),
    npcOrigins: keywordPool.npcOrigins.slice(0, 5),
    npcProfessions: keywordPool.npcProfessions.slice(0, 5),
    npcFactions: keywordPool.npcFactions.slice(0, 5),
    npcTraits: keywordPool.npcTraits.slice(0, 6),
    npcPersonalityKeywords: keywordPool.npcPersonalityKeywords.slice(0, 5),
    npcLifeKeywords: keywordPool.npcLifeKeywords.slice(0, 5),
    npcSocialKeywords: keywordPool.npcSocialKeywords.slice(0, 5),
    relationshipKeywords: keywordPool.relationshipKeywords.slice(0, 5),
    districtKeywords: keywordPool.districtKeywords.slice(0, 5),
    resourceKeywords: keywordPool.resourceKeywords.slice(0, 5),
    rumorKeywords: keywordPool.rumorKeywords.slice(0, 5),
    marketBuyerTitles: keywordPool.marketBuyerTitles.slice(0, 4),
  };
}

function countKeywordPoolNovelty(
  generatedPool: OpenWorldAiKeywordPool,
  fallbackPool: OpenWorldAiKeywordPool,
) {
  const keys = Object.keys(generatedPool) as Array<keyof OpenWorldAiKeywordPool>;
  let changedFieldCount = 0;
  let novelEntryCount = 0;

  for (const key of keys) {
    const fallbackSet = new Set(fallbackPool[key]);
    const generatedEntries = generatedPool[key];
    const novelEntries = generatedEntries.filter((entry) => !fallbackSet.has(entry));
    if (novelEntries.length > 0) {
      changedFieldCount += 1;
      novelEntryCount += novelEntries.length;
    }
  }

  return {
    changedFieldCount,
    novelEntryCount,
  };
}

function isKeywordPoolTooSimilar(
  generatedPool: OpenWorldAiKeywordPool,
  fallbackPool: OpenWorldAiKeywordPool,
) {
  const novelty = countKeywordPoolNovelty(generatedPool, fallbackPool);
  return novelty.changedFieldCount < 4 || novelty.novelEntryCount < 12;
}

function buildCustomNpcLibraryReferenceSnapshot(library: OpenWorldCustomNpcLibrary) {
  return {
    npcs: library.npcs.slice(0, 3).map((npc) => ({
      name: npc.name,
      gender: npc.gender,
      originType: npc.originType,
      profession: npc.profession,
      faction: npc.faction,
      traitTags: npc.traitTags.slice(0, 3),
      worldBookKeywords: npc.worldBookKeywords.slice(0, 3),
      preferredMapTags: npc.preferredMapTags.slice(0, 3),
      relationshipTags: npc.relationshipTags.slice(0, 3),
    })),
  };
}

function sanitizeCustomNpcKeywordArray(value: unknown, maxCount: number, maxLength: number) {
  return normalizeStringArray(value, maxCount, maxLength);
}

function sanitizeGeneratedCustomNpc(
  payload: Record<string, unknown> | null,
  fallbackIndex: number,
  fallbackNpc?: OpenWorldCustomNpcDefinition | null,
): OpenWorldCustomNpcDefinition | null {
  if (!payload) {
    return fallbackNpc ? { ...fallbackNpc } : null;
  }

  const rawId = trimText(payload.id, 48, fallbackNpc?.id || `ai_custom_npc_${fallbackIndex + 1}`);
  const id = rawId
    .toLowerCase()
    .replace(/[^a-z0-9_\-:]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48)
    .replace(/^_+|_+$/g, "");
  const name = sanitizeOpenWorldNpcName(payload.name, fallbackNpc?.name || (fallbackIndex % 2 === 0 ? "柳青禾" : "林渡"));
  if (!id || !name) {
    return fallbackNpc ? { ...fallbackNpc } : null;
  }

  const genderRaw = String(payload.gender || fallbackNpc?.gender || "").trim().toLowerCase();
  const gender = ["male", "man", "男"].includes(genderRaw)
    ? "male" as const
    : ["female", "woman", "女"].includes(genderRaw)
      ? "female" as const
      : (fallbackNpc?.gender || (fallbackIndex % 2 === 0 ? "female" : "male"));

  return {
    id,
    name,
    gender,
    originType: trimText(payload.originType, 16, fallbackNpc?.originType || "散修"),
    profession: trimText(payload.profession, 16, fallbackNpc?.profession || "行脚修士"),
    faction: trimText(payload.faction, 16, fallbackNpc?.faction || "无门散人"),
    realmMinor: Math.max(1, Math.min(9, Math.floor(Number(payload.realmMinor || fallbackNpc?.realmMinor || 3) || 3))),
    personalitySummary: trimText(
      payload.personalitySummary,
      120,
      fallbackNpc?.personalitySummary || "这人来路不浅，却把自己藏得很深。",
    ),
    traitTags: (() => {
      const tags = sanitizeCustomNpcKeywordArray(payload.traitTags, 4, 12);
      return tags.length > 0 ? tags : (fallbackNpc?.traitTags || ["机敏", "多疑"]);
    })(),
    worldBookKeywords: sanitizeCustomNpcKeywordArray(payload.worldBookKeywords, 8, 16),
    adultTags: sanitizeCustomNpcKeywordArray(payload.adultTags, 6, 16),
    grayTags: sanitizeCustomNpcKeywordArray(payload.grayTags, 6, 16),
    preferredMapIds: sanitizeCustomNpcKeywordArray(payload.preferredMapIds, 8, 24),
    preferredMapTags: sanitizeCustomNpcKeywordArray(payload.preferredMapTags, 8, 16),
    writeToRandomPool: typeof payload.writeToRandomPool === "boolean"
      ? payload.writeToRandomPool
      : (fallbackNpc?.writeToRandomPool ?? true),
    allowDynamicWorldSpawn: typeof payload.allowDynamicWorldSpawn === "boolean"
      ? payload.allowDynamicWorldSpawn
      : (fallbackNpc?.allowDynamicWorldSpawn ?? true),
    partnerIds: sanitizeCustomNpcKeywordArray(payload.partnerIds, 6, 48),
    primaryPartnerId: trimText(payload.primaryPartnerId, 48, fallbackNpc?.primaryPartnerId || ""),
    relationshipTags: sanitizeCustomNpcKeywordArray(payload.relationshipTags, 6, 16),
  };
}

function sanitizeOpenWorldCustomNpcLibraryGeneration(
  payload: Record<string, unknown> | null,
  libraryPayload: Record<string, unknown> | null,
  fallbackLibrary: OpenWorldCustomNpcLibrary,
  summaryFallback: string,
  fallbackReason?: string | null,
): OpenWorldCustomNpcLibraryGenerationResult {
  const rows = Array.isArray(libraryPayload?.npcs)
    ? libraryPayload.npcs
    : Array.isArray(payload?.npcs)
      ? payload?.npcs
      : [];
  const npcs = rows
    .map((row, index) => {
      const fallbackNpc = fallbackLibrary.npcs[index] || null;
      return row && typeof row === "object" && !Array.isArray(row)
        ? sanitizeGeneratedCustomNpc(row as Record<string, unknown>, index, fallbackNpc)
        : sanitizeGeneratedCustomNpc(null, index, fallbackNpc);
    })
    .filter((entry): entry is OpenWorldCustomNpcDefinition => Boolean(entry))
    .filter((entry, index, list) => list.findIndex((target) => target.id === entry.id) === index);

  return {
    source: payload ? "ai" : "fallback",
    summary: trimText(payload?.summary, 120, summaryFallback),
    library: {
      npcs: npcs.length > 0
        ? npcs
        : fallbackLibrary.npcs.map((npc) => ({ ...npc })),
    },
    fallbackReason: payload ? null : (fallbackReason || "模型返回内容不是可用的 JSON 对象。"),
  };
}

function isCustomNpcLibraryTooSimilar(
  generatedLibrary: OpenWorldCustomNpcLibrary,
  fallbackLibrary: OpenWorldCustomNpcLibrary,
) {
  const fallbackNames = new Set(fallbackLibrary.npcs.map((npc) => npc.name));
  const novelCount = generatedLibrary.npcs.filter((npc) => !fallbackNames.has(npc.name)).length;
  return novelCount < Math.max(2, Math.floor(generatedLibrary.npcs.length / 2));
}

function sanitizeOpenWorldNpcName(value: unknown, fallback: string) {
  const normalized = trimText(value, 12, fallback).replace(/\s+/g, "");
  if (!normalized) {
    return fallback;
  }
  return /^[\u3400-\u9fff·]{2,8}$/.test(normalized)
    ? normalized
    : fallback;
}

function sanitizeNpcDnaEntry(
  payload: Record<string, unknown> | null,
  npcDraft: GeneratedOpenWorldNpcDraft,
): OpenWorldNpcDnaProfile {
  const fallback = buildFallbackNpcProfile(npcDraft);
  if (!payload) {
    return fallback;
  }

  const traitTags = normalizeStringArray(payload.traits, 4, 8);
  const behaviorPreferences = normalizeStringArray(payload.behaviorPreferences, 4, 8);

  return {
    source: "ai",
    name: npcDraft.sourceType === "custom"
      ? fallback.name
      : sanitizeOpenWorldNpcName(payload.name, fallback.name),
    originType: trimText(payload.origin, 16, fallback.originType),
    profession: trimText(payload.profession, 16, fallback.profession),
    faction: trimText(payload.faction, 16, fallback.faction),
    personalitySummary: trimText(payload.personalitySummary, 120, fallback.personalitySummary),
    traitTags: traitTags.length >= 2 ? traitTags : fallback.traitTags,
    behaviorWeights: buildBehaviorWeightsFromPreferences(behaviorPreferences),
    biography: trimText(payload.biography, 90, fallback.biography),
  };
}

function buildFallbackNpcBark(input: {
  npcName: string;
  currentActionLabel: string;
  mapName: string;
}) {
  const keywordPool = getCachedOpenWorldAiKeywordPool();
  const socialKeyword = keywordPool.npcSocialKeywords[0] || "传话";
  const relationshipKeyword = keywordPool.relationshipKeywords[0] || "旧识";
  const content = `${input.npcName}${input.currentActionLabel}，像是还惦记着${socialKeyword}与${relationshipKeyword}，在${input.mapName}里顺手留意四周风声。`;
  return {
    source: "fallback" as const,
    mood: "平静",
    content,
    lines: [content],
  };
}

function sanitizeNpcBark(
  payload: Record<string, unknown> | null,
  input: {
    seed: string;
    npcName: string;
    currentActionLabel: string;
    mapName: string;
  },
): OpenWorldNpcBarkResult {
  const fallback = buildFallbackNpcBark(input);
  if (!payload) {
    return fallback;
  }

  const lines = normalizeStringArray(payload.lines, 4, 24);
  if (lines.length <= 0) {
    return fallback;
  }

  return {
    source: "ai",
    mood: trimText(payload.mood, 12, fallback.mood),
    content: lines[hashSeed(input.seed) % lines.length] || fallback.content,
    lines,
  };
}

function buildFallbackTiandaoEvent(input: {
  eventType: string;
  mapName: string;
  actorName?: string;
  detail?: string;
}): OpenWorldTiandaoEventResult {
  const title = input.eventType === "reincarnation" ? "轮回再起" : "天机微动";
  const summary = input.eventType === "reincarnation"
    ? `${input.actorName || "一名旧影"}承接残痕，于${input.mapName}再度入世。`
    : (input.detail || `${input.mapName}灵机轻动，天地气数微微改易。`);
  return {
    source: "fallback",
    title,
    summary,
    tone: input.eventType === "reincarnation" ? "auspicious" : "calm",
    content: `【${title}】${summary}`,
  };
}

function sanitizeTiandaoEvent(
  payload: Record<string, unknown> | null,
  input: {
    eventType: string;
    mapName: string;
    actorName?: string;
    detail?: string;
  },
): OpenWorldTiandaoEventResult {
  const fallback = buildFallbackTiandaoEvent(input);
  if (!payload) {
    return fallback;
  }

  const tone = trimText(payload.tone, 12, fallback.tone);
  const normalizedTone = (["calm", "omen", "warning", "auspicious"].includes(tone)
    ? tone
    : fallback.tone) as OpenWorldTiandaoEventResult["tone"];
  const title = trimText(payload.title, 12, fallback.title);
  const summary = trimText(payload.summary, 60, fallback.summary);

  return {
    source: "ai",
    title,
    summary,
    tone: normalizedTone,
    content: `【${title}】${summary}`,
  };
}

function buildFallbackShadowEvent(input: {
  offerType: string;
  sourceFaction: string;
  hook: string;
}): OpenWorldShadowEventResult {
  const title = input.offerType === "black_market_trade"
    ? "黑市递帖"
    : input.offerType === "shadow_intel"
      ? "暗线传声"
      : input.offerType === "cultivator_hunt"
        ? "猎修委托"
        : input.offerType === "pressure_cleanse"
          ? "洗痕买路"
          : input.offerType === "rumor_silence"
            ? "压风声"
            : input.offerType === "lawful_mediation"
              ? "守序说项"
              : input.offerType === "consensual_dual_cultivation"
                ? "合意双修"
        : "魔修试心";

  return {
    source: "fallback",
    title,
    summary: trimText(input.hook || `${input.sourceFaction}正试着把你拖入更深的灰影里。`, 60, `${input.sourceFaction}正试着把你拖入更深的灰影里。`),
    tone: input.offerType === "demonic_temptation"
      ? "high"
      : input.offerType === "shadow_intel"
        ? "low"
        : input.offerType === "lawful_mediation"
          ? "low"
        : "medium",
  };
}

function sanitizeShadowEvent(
  payload: Record<string, unknown> | null,
  input: {
    offerType: string;
    sourceFaction: string;
    hook: string;
  },
): OpenWorldShadowEventResult {
  const fallback = buildFallbackShadowEvent(input);
  if (!payload) {
    return fallback;
  }

  const title = trimText(payload.title, 12, fallback.title);
  const summary = trimText(payload.summary, 60, fallback.summary);
  const tone = trimText(payload.tone, 12, fallback.tone);
  return {
    source: "ai",
    title,
    summary,
    tone: (["low", "medium", "high"].includes(tone) ? tone : fallback.tone) as OpenWorldShadowEventResult["tone"],
  };
}

function buildFallbackDistrictRumors(input: {
  mapName: string;
  mapArchetype: string;
  theme: string;
  districts: string[];
  rumorSeeds: string[];
  resourceThemes: string[];
}) {
  const heats: Array<OpenWorldDistrictRumor["heat"]> = ["medium", "high", "low"];
  return {
    source: "fallback" as const,
    rumors: input.districts.slice(0, 3).map((districtName, index) => ({
      districtName,
      title: trimText(input.rumorSeeds[index] || `${districtName}有新风声`, 12, `${districtName}风声起`),
      content: trimText(
        `${districtName}近来都在传：${input.rumorSeeds[index] || `${input.mapName}里又起了新的风声`}，不少人盯上了${input.resourceThemes[index % Math.max(1, input.resourceThemes.length)] || "旧机缘"}。`,
        36,
        `${districtName}近来风声颇紧，诸修都在留意机缘流向。`,
      ),
      heat: heats[index % heats.length],
    })),
  };
}

function buildFallbackFactionTone(input: {
  factionName: string;
  categoryLabel?: string;
  districtName?: string | null;
}): OpenWorldFactionToneResult {
  const factionName = trimText(input.factionName, 18, "无名势力");
  const districtName = trimText(input.districtName, 16, "这片地界");
  return {
    source: "fallback",
    title: `${factionName}有声`,
    summary: `${factionName}近来在${districtName}放话行事，外人多半先看口风，再决定要不要往里站。`,
    hints: [
      `${factionName}更看重有没有用，而不是空口表态。`,
      input.categoryLabel ? `${input.categoryLabel}一脉的行事气息已经浮到明面。` : "这股势力的口风已开始压过散修议论。",
      `若继续在${districtName}插手他们的事，迟早会被记上一笔。`,
    ],
  };
}

function buildFallbackDistrictStateFlavor(input: {
  districtName: string;
  dominantFactionName: string;
  tensionTag: string;
  hotspotSummary?: string | null;
}): OpenWorldDistrictStateFlavorResult {
  return {
    source: "fallback",
    title: `${input.districtName}变天`,
    summary: `${input.dominantFactionName}正在${input.districtName}压场，眼下局势可算“${input.tensionTag}”。${trimText(input.hotspotSummary, 32, "")}`,
    hooks: [
      `盯着${input.districtName}的人变多了，后续多半还会有人递话或试探。`,
      "只要继续有人在这条街出手，风声就不会轻易散。",
      "这里的节点一旦失手，整片街区的脸色都会变。",
    ],
  };
}

function buildFallbackStorylineFlavor(input: {
  districtName: string;
  storylineTypeLabel: string;
  sourceFactionName: string;
  stageLabel: string;
  summary: string;
}): OpenWorldStorylineFlavorResult {
  return {
    source: "fallback",
    title: trimText(input.stageLabel, 12, `${input.districtName}起波`),
    summary: `${input.sourceFactionName}在${input.districtName}推动的${input.storylineTypeLabel}已来到“${input.stageLabel}”，${trimText(input.summary, 48, "街面气氛越发绷紧。")}`,
    nextMove: `${input.sourceFactionName}多半还会顺着这条线继续逼人站队。`,
  };
}

function buildFallbackNpcFactionHint(input: {
  npcName: string;
  surfaceFaction: string;
  districtName?: string | null;
  realmName?: string | null;
}): OpenWorldNpcFactionHintResult {
  const highRealm = /七重|八重|九重|圆满|金丹|元婴/.test(String(input.realmName || ""));
  return {
    source: "fallback",
    surfaceFaction: trimText(input.surfaceFaction, 16, "无门散人"),
    stanceLabel: `${input.npcName}身上带着一股不好亲近的站队气。`,
    hazeLabel: highRealm ? "此人境界不低，真实站队仍隔着一层雾。" : "此人的外露痕迹不算深，多少能看出些来路。",
    hints: [
      `观其外在路数，更像是${input.surfaceFaction}那一边的人。`,
      input.districtName ? `${input.districtName}这条街的风向，多少已经沾到了此人身上。` : "此人举止和散修闲人并不太一样。",
      "若继续靠近试探，或许还能看出他到底替谁做事。",
    ],
  };
}

function buildFallbackAdultProfile(input: {
  npcName: string;
  faction?: string | null;
  profession?: string | null;
  traitTags?: string[];
  corruptionValue?: number;
}): OpenWorldAdultProfileResult {
  const traitTags = Array.isArray(input.traitTags) ? input.traitTags.filter(Boolean) : [];
  const corruptionValue = Number(input.corruptionValue || 0);
  const corruptionStageLabel = corruptionValue >= 70
    ? "欲念偏深"
    : corruptionValue >= 40
      ? "心防渐松"
      : "仍守边界";
  return {
    source: "fallback",
    dispositionLabel: corruptionValue >= 55 ? "暧昧试探" : "谨慎观望",
    summary: `${input.npcName}在${input.faction || "尘世边角"}修行已久，对亲近与双修自有分寸，更看重你此刻的气机、态度与缘分。`,
    roleTags: traitTags.slice(0, 2).length > 0 ? traitTags.slice(0, 2) : [input.profession || "散修", "谨慎"],
    preferenceTags: corruptionValue >= 55 ? ["试探", "情缘"] : ["双修", "克制"],
    preferenceHints: [
      "先看气机与措辞，再决定是否靠近。",
      "若心防未破，贸然逼近只会让其退开。",
      "危险偏好只会在高堕落或特殊因缘下浮出水面。",
    ],
    corruptionStageLabel,
  };
}

function sanitizeAdultProfile(
  payload: Record<string, unknown> | null,
  input: Parameters<typeof buildFallbackAdultProfile>[0],
): OpenWorldAdultProfileResult {
  const fallback = buildFallbackAdultProfile(input);
  if (!payload) {
    return fallback;
  }
  const roleTags = normalizeStringArray(payload.roleTags, 4, 10);
  const preferenceTags = normalizeStringArray(payload.preferenceTags, 4, 10);
  const preferenceHints = normalizeStringArray(payload.preferenceHints, 4, 26);
  return {
    source: "ai",
    dispositionLabel: trimText(payload.dispositionLabel, 16, fallback.dispositionLabel),
    summary: trimText(payload.summary, 90, fallback.summary),
    roleTags: roleTags.length > 0 ? roleTags : fallback.roleTags,
    preferenceTags: preferenceTags.length > 0 ? preferenceTags : fallback.preferenceTags,
    preferenceHints: preferenceHints.length > 0 ? preferenceHints : fallback.preferenceHints,
    corruptionStageLabel: trimText(payload.corruptionStageLabel, 16, fallback.corruptionStageLabel),
  };
}

function buildFallbackAdultInvite(input: {
  npcName: string;
  actionType: string;
  districtName?: string | null;
}): OpenWorldAdultInviteResult {
  const title = input.actionType === "essence_drain"
    ? "采补试探"
    : input.actionType === "dangerous_preference"
      ? "暧昧暗示"
      : "夜色相邀";
  return {
    source: "fallback",
    title,
    summary: `${input.npcName}在${input.districtName || "此地"}以含蓄口风试探你的心意，尚未越过明面边界。`,
    atmosphere: "四周气机并不喧哗，却藏着一层若有若无的暧昧试探。",
    responseOptions: ["接受", "婉拒", "反向诱导"],
  };
}

function sanitizeAdultInvite(
  payload: Record<string, unknown> | null,
  input: Parameters<typeof buildFallbackAdultInvite>[0],
): OpenWorldAdultInviteResult {
  const fallback = buildFallbackAdultInvite(input);
  if (!payload) {
    return fallback;
  }
  const responseOptions = normalizeStringArray(payload.responseOptions, 4, 8);
  return {
    source: "ai",
    title: trimText(payload.title, 24, fallback.title),
    summary: trimNarrativeText(payload.summary, 480, fallback.summary),
    atmosphere: trimNarrativeText(payload.atmosphere, 480, fallback.atmosphere),
    responseOptions: responseOptions.length > 0 ? responseOptions : fallback.responseOptions,
  };
}

function buildFallbackAdultOutcome(input: {
  outcomeType: "accept" | "reject" | "result" | "drain" | "pregnancy";
  npcName: string;
  actionType: string;
  pregnancyTriggered?: boolean;
  fallbackReason?: string | null;
}): OpenWorldAdultOutcomeResult {
  if (input.outcomeType === "reject") {
    return {
      source: "fallback",
      title: "止于边界",
      summary: `${input.npcName}没有继续越界，只让这场试探停在言语与气机之间。`,
      atmosphere: "气氛仍带几分余温，但边界被清楚留下。",
      worldConsequence: "这次接触更多会留下态度与风声，而不会直接转成更深牵连。",
      changeHints: ["边界被明确留下", "关系仍有观察余地"],
      fallbackReason: input.fallbackReason || null,
    };
  }
  if (input.outcomeType === "drain") {
    return {
      source: "fallback",
      title: "灵机暗转",
      summary: `${input.npcName}借着靠近与你交换了几分灵机，彼此气血与心念都留下余波。`,
      atmosphere: "灵息交错后，空气里多了一层危险而克制的余温。",
      worldConsequence: "若这类往来反复发生，风声会慢慢偏向更灰暗的一侧。",
      changeHints: ["灵机有所流转", "灰色痕迹略有加深"],
      fallbackReason: input.fallbackReason || null,
    };
  }
  if (input.outcomeType === "pregnancy") {
    return {
      source: "fallback",
      title: input.pregnancyTriggered ? "命数有痕" : "气机轻动",
      summary: input.pregnancyTriggered
        ? "这次亲近之后，你体内的命数似乎被轻轻触动，像有新的因果开始沉淀。"
        : "这场亲近没有立刻改写命数，却仍在你们之间留下了细微牵引。",
      atmosphere: "气机收束后，余韵并未立刻散去。",
      worldConsequence: input.pregnancyTriggered ? "既有孕育链已被触发，后续变化会继续沿现实时间推进。" : "命数未成形，但关系与风声仍会缓慢变化。",
      changeHints: input.pregnancyTriggered ? ["命数已被触动", "后续孕育链开始推进"] : ["命数暂未定型"],
      fallbackReason: input.fallbackReason || null,
    };
  }
  if (input.outcomeType === "accept") {
    return {
      source: "fallback",
      title: "心意已明",
      summary: `${input.npcName}在确认你的意愿后才继续靠近，这场接触最终落成了可被记住的一笔。`,
      atmosphere: "压低的气息里多了几分默契，余波却仍在暗处蔓延。",
      worldConsequence: "关系、风声与世界压力都会因这次选择留下痕迹。",
      changeHints: ["关系更近一步", "风声可能缓慢外泄"],
      fallbackReason: input.fallbackReason || null,
    };
  }
  return {
    source: "fallback",
    title: "余波未散",
    summary: `${input.npcName}与你之间留下了一段难以立刻抹去的余温与后果。`,
    atmosphere: "四下重归平静，但心境与风声都没有真正停下。",
    worldConsequence: "这会改变彼此的关系，也可能让街巷里多出新的耳语。",
    changeHints: ["关系发生变化", "街区风声轻动"],
    fallbackReason: input.fallbackReason || null,
  };
}

function sanitizeAdultOutcome(
  payload: Record<string, unknown> | null,
  input: Parameters<typeof buildFallbackAdultOutcome>[0],
): OpenWorldAdultOutcomeResult {
  const fallback = buildFallbackAdultOutcome(input);
  if (!payload) {
    return {
      ...fallback,
      fallbackReason: fallback.fallbackReason || "模型返回内容不是可用的 JSON 对象。",
    };
  }
  const changeHints = normalizeStringArray(payload.changeHints, 4, 24);
  return {
    source: "ai",
    title: trimText(payload.title, 12, fallback.title),
    summary: trimNarrativeText(payload.summary, 128, fallback.summary),
    atmosphere: trimNarrativeText(payload.atmosphere, 120, fallback.atmosphere),
    worldConsequence: trimNarrativeText(payload.worldConsequence, 120, fallback.worldConsequence),
    changeHints: changeHints.length > 0 ? changeHints : fallback.changeHints,
    fallbackReason: null,
  };
}

function buildFallbackCorruptionGrowth(input: {
  npcName: string;
  actionType: string;
  corruptionValue?: number;
  fallbackReason?: string | null;
}): OpenWorldCorruptionGrowthResult {
  const corruptionValue = Number(input.corruptionValue || 0);
  const stageLabel = corruptionValue >= 75
    ? "心防大开"
    : corruptionValue >= 45
      ? "边界渐松"
      : "仍有自持";
  const actionHint = input.actionType === "dangerous_preference"
    ? "危险偏好被悄悄放大"
    : input.actionType === "essence_drain"
      ? "对灵机交换的接受度正在上升"
      : "亲密与依赖的阈值被轻轻推开";
  return {
    source: "fallback",
    summary: `${input.npcName}这次接触后，心境已从“${stageLabel}”开始偏移，${actionHint}。`,
    changeHints: [
      "边界判断出现松动",
      "后续试探更容易留下心绪余波",
    ],
    fallbackReason: input.fallbackReason || null,
  };
}

function sanitizeCorruptionGrowth(
  payload: Record<string, unknown> | null,
  input: Parameters<typeof buildFallbackCorruptionGrowth>[0],
): OpenWorldCorruptionGrowthResult {
  const fallback = buildFallbackCorruptionGrowth(input);
  if (!payload) {
    return {
      ...fallback,
      fallbackReason: fallback.fallbackReason || "模型返回内容不是可用的 JSON 对象。",
    };
  }

  const changeHints = normalizeStringArray(payload.changeHints, 4, 24);
  return {
    source: "ai",
    summary: trimNarrativeText(payload.summary, 120, fallback.summary),
    changeHints: changeHints.length > 0 ? changeHints : fallback.changeHints,
    fallbackReason: null,
  };
}

function buildFallbackAdultRumor(input: {
  mapName: string;
  districtName?: string | null;
  actionType: string;
}): OpenWorldAdultRumorResult {
  return {
    source: "fallback",
    title: "夜风有耳",
    summary: `${input.districtName || input.mapName}里已有人低声议论昨夜那点暧昧余波。`,
    heat: input.actionType === "dangerous_preference" || input.actionType === "essence_drain" ? "high" : "medium",
  };
}

function sanitizeAdultRumor(
  payload: Record<string, unknown> | null,
  input: Parameters<typeof buildFallbackAdultRumor>[0],
): OpenWorldAdultRumorResult {
  const fallback = buildFallbackAdultRumor(input);
  if (!payload) {
    return fallback;
  }
  const heat = trimText(payload.heat, 12, fallback.heat);
  return {
    source: "ai",
    title: trimText(payload.title, 12, fallback.title),
    summary: trimText(payload.summary, 48, fallback.summary),
    heat: (["low", "medium", "high"].includes(heat) ? heat : fallback.heat) as OpenWorldAdultRumorResult["heat"],
  };
}

function sanitizeDistrictRumors(
  payload: Record<string, unknown> | null,
  input: {
    mapName: string;
    mapArchetype: string;
    theme: string;
    districts: string[];
    rumorSeeds: string[];
    resourceThemes: string[];
  },
): OpenWorldDistrictRumorResult {
  const fallback = buildFallbackDistrictRumors(input);
  if (!payload) {
    return fallback;
  }

  const rumors = Array.isArray(payload.rumors) ? payload.rumors : [];
  const normalized = rumors
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const districtName = trimText(row.districtName, 16);
      if (!districtName || !input.districts.includes(districtName)) {
        return null;
      }
      const heat = trimText(row.heat, 12, "medium");
      return {
        districtName,
        title: trimText(row.title, 12, `${districtName}风声起`),
        content: trimText(row.content, 36, `${districtName}近来风声颇紧。`),
        heat: (["low", "medium", "high"].includes(heat) ? heat : "medium") as OpenWorldDistrictRumor["heat"],
      } satisfies OpenWorldDistrictRumor;
    })
    .filter((entry, index, list): entry is OpenWorldDistrictRumor => {
      if (!entry) {
        return false;
      }
      return list.findIndex((item) => item?.districtName === entry.districtName) === index;
    });

  return {
    source: normalized.length >= input.districts.length ? "ai" : fallback.source,
    rumors: normalized.length >= input.districts.length
      ? input.districts.map((districtName) => normalized.find((entry) => entry.districtName === districtName))
        .filter((entry): entry is OpenWorldDistrictRumor => Boolean(entry))
      : fallback.rumors,
  };
}

function sanitizeFactionTone(
  payload: Record<string, unknown> | null,
  input: {
    factionName: string;
    categoryLabel?: string;
    districtName?: string | null;
  },
): OpenWorldFactionToneResult {
  const fallback = buildFallbackFactionTone(input);
  if (!payload) {
    return fallback;
  }
  return {
    source: "ai",
    title: trimText(payload.title, 12, fallback.title),
    summary: trimText(payload.summary, 60, fallback.summary),
    hints: (() => {
      const hints = normalizeStringArray(payload.hints, 3, 36);
      return hints.length > 0 ? hints : fallback.hints;
    })(),
  };
}

function sanitizeDistrictStateFlavor(
  payload: Record<string, unknown> | null,
  input: {
    districtName: string;
    dominantFactionName: string;
    tensionTag: string;
    hotspotSummary?: string | null;
  },
): OpenWorldDistrictStateFlavorResult {
  const fallback = buildFallbackDistrictStateFlavor(input);
  if (!payload) {
    return fallback;
  }
  return {
    source: "ai",
    title: trimText(payload.title, 12, fallback.title),
    summary: trimText(payload.summary, 60, fallback.summary),
    hooks: (() => {
      const hooks = normalizeStringArray(payload.hooks, 3, 42);
      return hooks.length > 0 ? hooks : fallback.hooks;
    })(),
  };
}

function sanitizeStorylineFlavor(
  payload: Record<string, unknown> | null,
  input: {
    districtName: string;
    storylineTypeLabel: string;
    sourceFactionName: string;
    stageLabel: string;
    summary: string;
  },
): OpenWorldStorylineFlavorResult {
  const fallback = buildFallbackStorylineFlavor(input);
  if (!payload) {
    return fallback;
  }
  return {
    source: "ai",
    title: trimText(payload.title, 12, fallback.title),
    summary: trimText(payload.summary, 70, fallback.summary),
    nextMove: trimText(payload.nextMove, 48, fallback.nextMove),
  };
}

function sanitizeNpcFactionHint(
  payload: Record<string, unknown> | null,
  input: {
    npcName: string;
    surfaceFaction: string;
    districtName?: string | null;
    realmName?: string | null;
  },
): OpenWorldNpcFactionHintResult {
  const fallback = buildFallbackNpcFactionHint(input);
  if (!payload) {
    return fallback;
  }
  return {
    source: "ai",
    surfaceFaction: trimText(payload.surfaceFaction, 16, fallback.surfaceFaction),
    stanceLabel: trimText(payload.stanceLabel, 28, fallback.stanceLabel),
    hazeLabel: trimText(payload.hazeLabel, 32, fallback.hazeLabel),
    hints: (() => {
      const hints = normalizeStringArray(payload.hints, 3, 40);
      return hints.length > 0 ? hints : fallback.hints;
    })(),
  };
}

function buildFallbackCustomNpcPreview(input: {
  mapName: string;
  entries: Array<{
    npcId: string;
    name: string;
    faction: string;
    profession: string;
  }>;
}): OpenWorldCustomNpcPreviewResult {
  return {
    source: "fallback",
    summary: `${input.mapName}会把这批自定义角色压进当前生态里，让他们以更鲜明的口风露面。`,
    entries: input.entries.map((entry) => ({
      npcId: entry.npcId,
      sceneHint: `${entry.name}会以${entry.profession}身份在附近露面。`,
      mood: `${entry.faction}的旧气息若隐若现。`,
      tags: [entry.faction, entry.profession].filter(Boolean),
    })),
  };
}

function sanitizeCustomNpcPreview(
  payload: Record<string, unknown> | null,
  input: {
    mapName: string;
    entries: Array<{
      npcId: string;
      name: string;
      faction: string;
      profession: string;
    }>;
  },
): OpenWorldCustomNpcPreviewResult {
  const fallback = buildFallbackCustomNpcPreview(input);
  if (!payload) {
    return fallback;
  }
  const rows = Array.isArray(payload.entries) ? payload.entries : [];
  const entries = rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return null;
      }
      const raw = row as Record<string, unknown>;
      const npcId = trimText(raw.npcId, 64);
      const base = input.entries.find((entry) => entry.npcId === npcId);
      if (!base) {
        return null;
      }
      return {
        npcId,
        sceneHint: trimText(raw.sceneHint, 48, `${base.name}会在此地露面。`),
        mood: trimText(raw.mood, 36, `${base.faction}气息不轻。`),
        tags: (() => {
          const tags = normalizeStringArray(raw.tags, 4, 12);
          return tags.length > 0 ? tags : [base.faction, base.profession].filter(Boolean);
        })(),
      };
    })
    .filter((entry): entry is OpenWorldCustomNpcPreviewResult["entries"][number] => Boolean(entry));
  return {
    source: entries.length > 0 ? "ai" : fallback.source,
    summary: trimText(payload.summary, 80, fallback.summary),
    entries: entries.length > 0 ? entries : fallback.entries,
  };
}

export async function generateOpenWorldMapMeta(mapDraft: GeneratedOpenWorldMapDraft): Promise<OpenWorldMapMetaResult> {
  try {
    const mapRule = await resolveRule(
      "OPEN_WORLD_MAP_RULE",
      "按输入地图资料填写主题、街区、建筑、人群与风声种子，不要改动地图基础规格，不要输出模板外字段。",
    );
    const mapTemplate = await resolveTemplate("OPEN_WORLD_MAP_TEMPLATE_JSON", {
      theme: "地图主题",
      districts: ["街区一", "街区二", "街区三"],
      buildingTags: ["建筑标签一", "建筑标签二"],
      resourceThemes: ["资源主题一", "资源主题二"],
      npcCrowds: ["人群气质一", "人群气质二"],
      rumorSeeds: ["风声种子一", "风声种子二"],
      description: "地图整体描述",
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_MAP_PROMPT", {
      mapId: mapDraft.id,
      archetype: mapDraft.archetype,
      mapName: mapDraft.name,
      size: {
        width: mapDraft.width,
        height: mapDraft.height,
      },
      defaultTheme: mapDraft.theme,
      defaultDistricts: mapDraft.districts,
      defaultBuildingTags: mapDraft.buildingTags,
      defaultResourceThemes: mapDraft.resourceThemes,
      defaultRumorSeeds: mapDraft.rumorSeeds,
      defaultDescription: mapDraft.description,
      responseFormat: mapTemplate,
      rule: mapRule,
    }, { temperature: 0.85, maxTokens: 700, worldBookScene: "map_meta" });

    return sanitizeMapMeta(payload, mapDraft);
  } catch {
    return buildFallbackMapMeta(mapDraft);
  }
}

export async function generateOpenWorldNpcDnaBatch(params: {
  mapDraft: GeneratedOpenWorldMapDraft;
  npcDrafts: GeneratedOpenWorldNpcDraft[];
}): Promise<OpenWorldNpcDnaBatchResult> {
  const fallbackProfiles = Object.fromEntries(
    params.npcDrafts.map((npcDraft) => [npcDraft.id, buildFallbackNpcProfile(npcDraft)]),
  );

  try {
    const npcDnaRule = await resolveRule(
      "OPEN_WORLD_NPC_DNA_RULE",
      "请按输入 NPC 填写人物 DNA；只改可编辑项，不要越权生成战斗数值或额外字段。",
    );
    const npcNameRule = await resolveRule(
      "OPEN_WORLD_NPC_NAME_RULE",
      "随机 NPC 的 name 必须是符合修仙世界气质的中文名字，并尽量与世界书、关键词池和当前地图风格一致；sourceType 为 custom 时不得改名。",
    );
    const npcDnaTemplate = await resolveTemplate("OPEN_WORLD_NPC_DNA_TEMPLATE_JSON", {
      npcs: [
        {
          npcId: "必须回填输入中的 npcId",
          name: "随机 NPC 需要重新生成的中文名；自定义 NPC 必须回填输入中的名字",
          origin: "出身",
          profession: "职业",
          faction: "阵营",
          personalitySummary: "人格摘要",
          traits: ["标签一", "标签二", "标签三"],
          behaviorPreferences: ["采药", "摆摊"],
          biography: "80字以内短传记",
        },
      ],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_NPC_DNA_PROMPT", {
      map: {
        id: params.mapDraft.id,
        name: params.mapDraft.name,
        archetype: params.mapDraft.archetype,
        theme: params.mapDraft.theme,
      },
      worldTone: "修仙界并非童话，凡人、正修、灰色势力与魔修并存，不得写成非黑即白的脸谱世界。",
      responseFormat: npcDnaTemplate,
      npcs: params.npcDrafts.map((npcDraft) => ({
        npcId: npcDraft.id,
        name: npcDraft.name,
        sourceType: npcDraft.sourceType || "random",
        customNpcId: npcDraft.customNpcId || null,
        nameEditable: npcDraft.sourceType !== "custom",
        gender: npcDraft.gender,
        realmName: npcDraft.realmName,
        originType: npcDraft.originType,
        profession: npcDraft.profession,
        faction: npcDraft.faction,
        currentActionLabel: npcDraft.runtime.currentActionLabel,
        personalitySummary: npcDraft.personalitySummary,
        traitTags: npcDraft.traitTags,
        worldBookKeywords: npcDraft.worldBookKeywords || [],
        adultTags: npcDraft.adultTags || [],
        grayTags: npcDraft.grayTags || [],
      })),
      namingRule: npcNameRule,
      rule: npcDnaRule,
    }, { temperature: 0.9, maxTokens: 1800, worldBookScene: "npc_dna" });

    const rawEntries = Array.isArray(payload?.npcs) ? payload.npcs : [];
    const resultProfiles: Record<string, OpenWorldNpcDnaProfile> = { ...fallbackProfiles };

    for (const rawEntry of rawEntries) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        continue;
      }
      const entry = rawEntry as Record<string, unknown>;
      const npcId = trimText(entry.npcId, 80);
      const baseDraft = params.npcDrafts.find((item) => item.id === npcId);
      if (!npcId || !baseDraft) {
        continue;
      }
      resultProfiles[npcId] = sanitizeNpcDnaEntry(entry, baseDraft);
    }

    return {
      source: "ai",
      profiles: resultProfiles,
    };
  } catch {
    return {
      source: "fallback",
      profiles: fallbackProfiles,
    };
  }
}

export async function generateOpenWorldKeywordPool(input: {
  seedKeywords: string[];
  styleKeywords?: string[];
  forbiddenKeywords?: string[];
  worldTheme?: string;
}) {
  const fallbackPool = getCachedOpenWorldAiKeywordPool();
  const referenceKeywordPool = buildKeywordPoolReferenceSnapshot(fallbackPool);
  const summaryFallback = input.seedKeywords.length > 0
    ? `已根据关键词“${input.seedKeywords.slice(0, 6).join("、")}”回退到当前开放世界关键词池。`
    : "已回退到当前开放世界关键词池。";

  const runAttempt = async (strictVariation: boolean) => {
    const keywordPoolRule = await resolveRule(
      "OPEN_WORLD_KEYWORD_POOL_RULE",
      "请按输入关键词扩写完整开放世界关键词池；若某字段没有明确线索，也要结合世界书与参考词池补齐，但不要整体照抄参考样本。",
    );
    const keywordPoolTemplate = await resolveTemplate("OPEN_WORLD_KEYWORD_POOL_TEMPLATE_JSON", {
      summary: "一句话说明本次扩写的整体方向",
      keywordPool: {
        femaleNames: ["女性名1", "女性名2"],
        maleNames: ["男性名1", "男性名2"],
        npcOrigins: ["出身1", "出身2"],
        npcProfessions: ["职业1", "职业2"],
        npcFactions: ["势力1", "势力2"],
        npcTraits: ["特性1", "特性2"],
        npcPersonalityKeywords: ["处事口风1", "处事口风2"],
        npcLifeKeywords: ["生计困局1", "生计困局2"],
        npcSocialKeywords: ["社交动作1", "社交动作2"],
        relationshipKeywords: ["关系标签1", "关系标签2"],
        districtKeywords: ["街区场景1", "街区场景2"],
        resourceKeywords: ["资源主题1", "资源主题2"],
        rumorKeywords: ["风声关键词1", "风声关键词2"],
        marketBuyerTitles: ["扫货商称谓1", "扫货商称谓2"],
      },
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_KEYWORD_POOL_PROMPT", {
      worldTheme: input.worldTheme || "灰色修仙界、街区任务链、成人向氛围与开放世界 NPC 生态",
      seedKeywords: input.seedKeywords,
      styleKeywords: input.styleKeywords || [],
      forbiddenKeywords: input.forbiddenKeywords || [],
      referenceKeywordPool,
      generationNonce: `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      responseFormat: keywordPoolTemplate,
      rule: strictVariation
        ? `${keywordPoolRule}\n额外强约束：必须按输入关键词重新生成一套明显有变化的完整开放世界关键词池。参考词池只可借鉴少量锚点，不得整组照抄；每个字段都要尽量产生新词，至少大半词条应与参考样本不同。`
        : keywordPoolRule,
    }, {
      temperature: strictVariation ? 1.05 : 0.92,
      maxTokens: 2400,
      worldBookScene: "keyword_pool",
      omitKeywordPoolSnapshot: true,
    });

    const keywordPayload = payload?.keywordPool && typeof payload.keywordPool === "object" && !Array.isArray(payload.keywordPool)
      ? payload.keywordPool as Record<string, unknown>
      : payload;
    return sanitizeOpenWorldKeywordPoolGeneration(
      payload,
      keywordPayload,
      fallbackPool,
      summaryFallback,
      payload ? null : "模型返回内容不是可用的关键词池 JSON 对象。",
    );
  };

  try {
    const firstPass = await runAttempt(false);
    if (firstPass.source === "ai" && !isKeywordPoolTooSimilar(firstPass.keywordPool, fallbackPool)) {
      return firstPass;
    }

    const secondPass = await runAttempt(true);
    if (secondPass.source === "ai") {
      const tooSimilar = isKeywordPoolTooSimilar(secondPass.keywordPool, fallbackPool);
      return {
        ...secondPass,
        summary: tooSimilar
          ? `${secondPass.summary}（模型本次变化仍偏保守，已保留结果，你也可以再次生成刷新一版。）`
          : secondPass.summary,
      };
    }

    return secondPass;
  } catch (error) {
    return {
      source: "fallback" as const,
      summary: summaryFallback,
      keywordPool: fallbackPool,
      fallbackReason: describeUnknownError(error),
    };
  }
}

export async function generateOpenWorldNpcDnaProfile(params: {
  mapDraft: GeneratedOpenWorldMapDraft;
  npcDraft: GeneratedOpenWorldNpcDraft;
}) {
  const batch = await generateOpenWorldNpcDnaBatch({
    mapDraft: params.mapDraft,
    npcDrafts: [params.npcDraft],
  });
  return batch.profiles[params.npcDraft.id] || buildFallbackNpcProfile(params.npcDraft);
}

export async function generateOpenWorldNpcBark(input: {
  seed: string;
  mapName: string;
  mapArchetype: string;
  currentDistrictName?: string | null;
  npcName: string;
  profession: string;
  realmName: string;
  personalitySummary: string;
  currentActionLabel: string;
}) {
  try {
    const npcBarkRule = await resolveRule(
      "OPEN_WORLD_NPC_BARK_RULE",
      "只写符合当前身份、地图气质与行为状态的短句，不要出现系统术语、模板外字段或现代口吻。",
    );
    const npcBarkTemplate = await resolveTemplate("OPEN_WORLD_NPC_BARK_TEMPLATE_JSON", {
      mood: "一句情绪标签",
      content: "一句 NPC 当前短句",
      lines: ["短句一", "短句二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_NPC_BARK_PROMPT", {
      mapName: input.mapName,
      mapArchetype: input.mapArchetype,
      currentDistrictName: input.currentDistrictName || "",
      worldTone: "修仙界非童话，但也有人情往来、买卖讨价、传话照应与旧债余波，NPC要像活在同一方天地里的人。",
      npcName: input.npcName,
      profession: input.profession,
      realmName: input.realmName,
      personalitySummary: input.personalitySummary,
      currentActionLabel: input.currentActionLabel,
      responseFormat: npcBarkTemplate,
      rule: npcBarkRule,
    }, { temperature: 0.95, maxTokens: 260, worldBookScene: "npc_bark" });

    return sanitizeNpcBark(payload, input);
  } catch {
    return buildFallbackNpcBark(input);
  }
}

export async function generateOpenWorldTiandaoEvent(input: {
  eventType: string;
  mapName: string;
  mapArchetype: string;
  actorName?: string;
  detail?: string;
}) {
  try {
    const tiandaoRule = await resolveRule(
      "OPEN_WORLD_TIANDAO_EVENT_RULE",
      "按输入事件类型填写天道播报，保持修仙世界天道昭示口吻，不要输出系统术语或模板外字段。",
    );
    const tiandaoTemplate = await resolveTemplate("OPEN_WORLD_TIANDAO_EVENT_TEMPLATE_JSON", {
      title: "事件标题",
      summary: "一句事件摘要",
      tone: "warning",
      content: "完整播报内容",
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_TIANDAO_EVENT_PROMPT", {
      eventType: input.eventType,
      mapName: input.mapName,
      mapArchetype: input.mapArchetype,
      worldTone: "修仙界并非童话，天道播报可出现吉兆、凶兆、暗潮与杀机，但仍需克制简洁。",
      actorName: input.actorName || "",
      detail: input.detail || "",
      responseFormat: tiandaoTemplate,
      rule: tiandaoRule,
    }, { temperature: 0.75, maxTokens: 240, worldBookScene: "tiandao_event" });

    return sanitizeTiandaoEvent(payload, input);
  } catch {
    return buildFallbackTiandaoEvent(input);
  }
}

export async function generateOpenWorldShadowEvent(input: {
  offerType: string;
  mapName?: string | null;
  sourceFaction: string;
  playerTitle: string;
  pressureSummary: string;
  hook: string;
}) {
  try {
    const shadowRule = await resolveRule(
      "OPEN_WORLD_SHADOW_EVENT_RULE",
      "只写灰线邀约标题、摘要与风险口风，不决定数值、奖励或执行结果。",
    );
    const shadowTemplate = await resolveTemplate("OPEN_WORLD_SHADOW_EVENT_TEMPLATE_JSON", {
      title: "邀约标题",
      summary: "邀约摘要",
      tone: "medium",
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_SHADOW_EVENT_PROMPT", {
      offerType: input.offerType,
      mapName: input.mapName || "人间一隅",
      sourceFaction: input.sourceFaction,
      playerTitle: input.playerTitle,
      pressureSummary: input.pressureSummary,
      hook: input.hook,
      worldTone: "修仙界并非童话，黑市、旁门与魔修的邀约需要阴冷克制，但不要堆砌现代黑帮术语。",
      responseFormat: shadowTemplate,
      rule: shadowRule,
    }, { temperature: 0.58, maxTokens: 220, worldBookScene: "shadow_event" });

    return sanitizeShadowEvent(payload, input);
  } catch {
    return buildFallbackShadowEvent(input);
  }
}

function resolvePressureReliefPromptKey(offerType: string): OpenWorldPromptKey {
  if (offerType === "rumor_silence") {
    return "OPEN_WORLD_RUMOR_SILENCE_PROMPT";
  }
  if (offerType === "lawful_mediation") {
    return "OPEN_WORLD_LAWFUL_MEDIATION_PROMPT";
  }
  if (offerType === "consensual_dual_cultivation") {
    return "OPEN_WORLD_CONSENSUAL_DUAL_CULTIVATION_PROMPT";
  }
  return "OPEN_WORLD_PRESSURE_RELIEF_PROMPT";
}

export async function generateOpenWorldPressureReliefOffer(input: {
  offerType: string;
  mapName?: string | null;
  sourceFaction: string;
  playerTitle: string;
  pressureSummary: string;
  hook: string;
  keywordRuleSummary?: string;
  consentSummary?: string;
}) {
  const promptKey = resolvePressureReliefPromptKey(input.offerType);
  try {
    const pressureReliefRule = await resolveRule(
      "OPEN_WORLD_PRESSURE_RELIEF_RULE",
      "这些邀约只负责提出口风与代价，是否接受始终由玩家决定，服务端会另行裁决实际效果。",
    );
    const pressureReliefTemplate = await resolveTemplate("OPEN_WORLD_PRESSURE_RELIEF_TEMPLATE_JSON", {
      title: "消压邀约标题",
      summary: "消压邀约摘要",
      tone: "medium",
    });
    const payload = await requestOpenWorldJson(promptKey, {
      offerType: input.offerType,
      mapName: input.mapName || "人间一隅",
      sourceFaction: input.sourceFaction,
      playerTitle: input.playerTitle,
      pressureSummary: input.pressureSummary,
      hook: input.hook,
      keywordRuleSummary: input.keywordRuleSummary || "",
      consentSummary: input.consentSummary || "",
      worldTone: "这些邀约只负责提出口风与代价，是否接受始终由玩家决定，服务端会另行裁决实际效果。",
      responseFormat: pressureReliefTemplate,
      rule: pressureReliefRule,
    }, { temperature: 0.58, maxTokens: 220, worldBookScene: "pressure_relief" });
    return sanitizeShadowEvent(payload, input);
  } catch {
    return buildFallbackShadowEvent(input);
  }
}

export async function generateOpenWorldDistrictRumors(input: {
  mapName: string;
  mapArchetype: string;
  theme: string;
  districts: string[];
  rumorSeeds: string[];
  resourceThemes: string[];
}) {
  try {
    const districtRumorRule = await resolveRule(
      "OPEN_WORLD_DISTRICT_RUMOR_RULE",
      "每个街区只生成一条风闻，必须围绕输入街区、资源与风声种子，不要写模板外字段。",
    );
    const districtRumorTemplate = await resolveTemplate("OPEN_WORLD_DISTRICT_RUMOR_TEMPLATE_JSON", {
      rumors: input.districts.map((districtName) => ({
        districtName,
        title: `${districtName}风声`,
        content: `${districtName}的风声摘要`,
        heat: "medium",
      })),
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_DISTRICT_RUMOR_PROMPT", {
      mapName: input.mapName,
      mapArchetype: input.mapArchetype,
      theme: input.theme,
      districts: input.districts,
      rumorSeeds: input.rumorSeeds,
      resourceThemes: input.resourceThemes,
      responseFormat: districtRumorTemplate,
      rule: districtRumorRule,
    }, { temperature: 0.88, maxTokens: 420, worldBookScene: "district_rumor" });

    return sanitizeDistrictRumors(payload, input);
  } catch {
    return buildFallbackDistrictRumors(input);
  }
}

export async function generateOpenWorldFactionTone(input: {
  factionName: string;
  categoryLabel?: string;
  districtName?: string | null;
  standingSummary?: string | null;
}) {
  try {
    const factionToneRule = await resolveRule(
      "OPEN_WORLD_FACTION_TONE_RULE",
      "只写势力外在口风、态度与提示，不要泄露底层数值、算法或模板外字段。",
    );
    const factionToneTemplate = await resolveTemplate("OPEN_WORLD_FACTION_TONE_TEMPLATE_JSON", {
      title: "势力口风标题",
      summary: "势力当前风格摘要",
      hints: ["提示一", "提示二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_FACTION_TONE_PROMPT", {
      factionName: input.factionName,
      categoryLabel: input.categoryLabel || "",
      districtName: input.districtName || "",
      standingSummary: input.standingSummary || "",
      responseFormat: factionToneTemplate,
      rule: factionToneRule,
    }, { temperature: 0.68, maxTokens: 260, worldBookScene: "faction_tone" });
    return sanitizeFactionTone(payload, input);
  } catch {
    return buildFallbackFactionTone(input);
  }
}

export async function generateOpenWorldDistrictStateFlavor(input: {
  districtName: string;
  dominantFactionName: string;
  tensionTag: string;
  hotspotSummary?: string | null;
}) {
  try {
    const districtStateRule = await resolveRule(
      "OPEN_WORLD_DISTRICT_STATE_RULE",
      "围绕主导势力、紧张标签与热点摘要填写街区局势，不要输出模板外字段。",
    );
    const districtStateTemplate = await resolveTemplate("OPEN_WORLD_DISTRICT_STATE_TEMPLATE_JSON", {
      title: "街区局势标题",
      summary: "街区局势摘要",
      hooks: ["可参与后续一", "可参与后续二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_DISTRICT_STATE_PROMPT", {
      districtName: input.districtName,
      dominantFactionName: input.dominantFactionName,
      tensionTag: input.tensionTag,
      hotspotSummary: input.hotspotSummary || "",
      responseFormat: districtStateTemplate,
      rule: districtStateRule,
    }, { temperature: 0.72, maxTokens: 260, worldBookScene: "district_state" });
    return sanitizeDistrictStateFlavor(payload, input);
  } catch {
    return buildFallbackDistrictStateFlavor(input);
  }
}

export async function generateOpenWorldStorylineFlavor(input: {
  districtName: string;
  storylineTypeLabel: string;
  sourceFactionName: string;
  stageLabel: string;
  summary: string;
}) {
  try {
    const storylineRule = await resolveRule(
      "OPEN_WORLD_STORYLINE_RULE",
      "围绕当前故事链阶段、势力来源与街区背景填写推进摘要和下一步，不要改写硬事实。",
    );
    const storylineTemplate = await resolveTemplate("OPEN_WORLD_STORYLINE_TEMPLATE_JSON", {
      title: "故事链标题",
      summary: "故事链当前摘要",
      nextMove: "下一步动作",
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_STORYLINE_PROMPT", {
      districtName: input.districtName,
      storylineTypeLabel: input.storylineTypeLabel,
      sourceFactionName: input.sourceFactionName,
      stageLabel: input.stageLabel,
      summary: input.summary,
      responseFormat: storylineTemplate,
      rule: storylineRule,
    }, { temperature: 0.74, maxTokens: 260, worldBookScene: "storyline" });
    return sanitizeStorylineFlavor(payload, input);
  } catch {
    return buildFallbackStorylineFlavor(input);
  }
}

export async function generateOpenWorldNpcFactionHint(input: {
  npcName: string;
  surfaceFaction: string;
  districtName?: string | null;
  realmName?: string | null;
}) {
  try {
    const npcFactionHintRule = await resolveRule(
      "OPEN_WORLD_NPC_FACTION_HINT_RULE",
      "只写玩家可感知的表面势力气息与提示，不要直接透出底层真实立场。",
    );
    const npcFactionHintTemplate = await resolveTemplate("OPEN_WORLD_NPC_FACTION_HINT_TEMPLATE_JSON", {
      surfaceFaction: "表面势力",
      stanceLabel: "立场判断",
      hazeLabel: "模糊气息描述",
      hints: ["暗示一", "暗示二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_NPC_FACTION_HINT_PROMPT", {
      npcName: input.npcName,
      surfaceFaction: input.surfaceFaction,
      districtName: input.districtName || "",
      realmName: input.realmName || "",
      responseFormat: npcFactionHintTemplate,
      rule: npcFactionHintRule,
    }, { temperature: 0.64, maxTokens: 260, worldBookScene: "npc_faction_hint" });
    return sanitizeNpcFactionHint(payload, input);
  } catch {
    return buildFallbackNpcFactionHint(input);
  }
}

export async function generateOpenWorldAdultProfile(input: {
  npcName: string;
  mapName: string;
  mapArchetype: string;
  faction?: string | null;
  profession?: string | null;
  personalitySummary?: string | null;
  traitTags?: string[];
  corruptionValue?: number;
}) {
  try {
    const adultProfileRule = await resolveRule(
      "OPEN_WORLD_ADULT_PROFILE_RULE",
      "只写成人互动倾向与边界，不写露骨内容，必须保留明确同意。",
    );
    const adultProfileTemplate = await resolveTemplate("OPEN_WORLD_ADULT_PROFILE_TEMPLATE_JSON", {
      dispositionLabel: "互动倾向标签",
      summary: "成人向关系摘要",
      roleTags: ["角色标签一", "角色标签二"],
      preferenceTags: ["偏好标签一", "偏好标签二"],
      preferenceHints: ["提示一", "提示二"],
      corruptionStageLabel: "堕落阶段标签",
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_ADULT_PROFILE_PROMPT", {
      npcName: input.npcName,
      mapName: input.mapName,
      mapArchetype: input.mapArchetype,
      faction: input.faction || "",
      profession: input.profession || "",
      personalitySummary: input.personalitySummary || "",
      traitTags: input.traitTags || [],
      corruptionValue: input.corruptionValue || 0,
      rule: adultProfileRule,
      responseFormat: adultProfileTemplate,
    }, { temperature: 0.72, maxTokens: 360, worldBookScene: "adult_profile" });
    return sanitizeAdultProfile(payload, input);
  } catch {
    return buildFallbackAdultProfile(input);
  }
}

export async function generateOpenWorldAdultInvite(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  moodHint?: string;
  dispositionLabel?: string;
}) {
  try {
    const adultInviteRule = await resolveRule(
      "OPEN_WORLD_ADULT_INVITE_RULE",
      "只能写含蓄邀约和试探，不写露骨内容。",
    );
    const adultInviteTemplate = await resolveTemplate("OPEN_WORLD_ADULT_INVITE_TEMPLATE_JSON", {
      title: "邀约标题",
      summary: "邀约摘要",
      atmosphere: "气氛描述",
      responseOptions: ["accept", "tease", "reject"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_ADULT_INVITE_PROMPT", {
      npcName: input.npcName,
      mapName: input.mapName,
      districtName: input.districtName || "",
      actionType: input.actionType,
      moodHint: input.moodHint || "",
      dispositionLabel: input.dispositionLabel || "",
      rule: adultInviteRule,
      responseFormat: adultInviteTemplate,
    }, { temperature: 0.78, maxTokens: 260, worldBookScene: "adult_invite" });
    return sanitizeAdultInvite(payload, input);
  } catch {
    return buildFallbackAdultInvite(input);
  }
}

async function generateOpenWorldAdultOutcomeByPrompt(
  promptKey:
    | "OPEN_WORLD_ADULT_ACCEPT_PROMPT"
    | "OPEN_WORLD_ADULT_REJECT_PROMPT"
    | "OPEN_WORLD_ADULT_RESULT_PROMPT"
    | "OPEN_WORLD_ADULT_DRAIN_PROMPT"
    | "OPEN_WORLD_ADULT_PREGNANCY_PROMPT",
  input: {
    npcName: string;
    mapName: string;
    districtName?: string | null;
    actionType: string;
    outcomeType: "accept" | "reject" | "result" | "drain" | "pregnancy";
    pregnancyTriggered?: boolean;
    atmosphereHint?: string;
  },
) {
  try {
    const adultResultRule = await resolveRule(
      "OPEN_WORLD_ADULT_RESULT_RULE",
      "只能写结果气氛、关系与世界后果，不写露骨过程。",
    );
    const adultResultTemplate = await resolveTemplate("OPEN_WORLD_ADULT_RESULT_TEMPLATE_JSON", {
      title: "结果标题",
      summary: "结果摘要",
      atmosphere: "气氛描述",
      worldConsequence: "世界后果",
      changeHints: ["变化一", "变化二"],
    });
    const payload = await requestOpenWorldJson(promptKey, {
      npcName: input.npcName,
      mapName: input.mapName,
      districtName: input.districtName || "",
      actionType: input.actionType,
      outcomeType: input.outcomeType,
      pregnancyTriggered: Boolean(input.pregnancyTriggered),
      atmosphereHint: input.atmosphereHint || "",
      rule: adultResultRule,
      responseFormat: adultResultTemplate,
    }, {
      temperature: 0.68,
      maxTokens: 300,
      worldBookScene: promptKey === "OPEN_WORLD_ADULT_ACCEPT_PROMPT"
        ? "adult_accept"
        : promptKey === "OPEN_WORLD_ADULT_REJECT_PROMPT"
          ? "adult_reject"
          : promptKey === "OPEN_WORLD_ADULT_DRAIN_PROMPT"
            ? "adult_drain"
            : promptKey === "OPEN_WORLD_ADULT_PREGNANCY_PROMPT"
              ? "adult_pregnancy"
              : "adult_result",
    });
    return sanitizeAdultOutcome(payload, input);
  } catch (error) {
    return buildFallbackAdultOutcome({
      ...input,
      fallbackReason: describeUnknownError(error),
    });
  }
}

export async function generateOpenWorldAdultAccept(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  atmosphereHint?: string;
}) {
  return generateOpenWorldAdultOutcomeByPrompt("OPEN_WORLD_ADULT_ACCEPT_PROMPT", {
    ...input,
    outcomeType: "accept",
  });
}

export async function generateOpenWorldAdultReject(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  atmosphereHint?: string;
}) {
  return generateOpenWorldAdultOutcomeByPrompt("OPEN_WORLD_ADULT_REJECT_PROMPT", {
    ...input,
    outcomeType: "reject",
  });
}

export async function generateOpenWorldAdultResult(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  atmosphereHint?: string;
}) {
  return generateOpenWorldAdultOutcomeByPrompt("OPEN_WORLD_ADULT_RESULT_PROMPT", {
    ...input,
    outcomeType: "result",
  });
}

export async function generateOpenWorldAdultDrain(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  atmosphereHint?: string;
}) {
  return generateOpenWorldAdultOutcomeByPrompt("OPEN_WORLD_ADULT_DRAIN_PROMPT", {
    ...input,
    outcomeType: "drain",
  });
}

export async function generateOpenWorldAdultPregnancy(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  pregnancyTriggered: boolean;
  atmosphereHint?: string;
}) {
  return generateOpenWorldAdultOutcomeByPrompt("OPEN_WORLD_ADULT_PREGNANCY_PROMPT", {
    ...input,
    outcomeType: "pregnancy",
  });
}

export async function generateOpenWorldCorruptionGrowth(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  corruptionValue?: number;
  atmosphereHint?: string;
}) {
  try {
    const corruptionGrowthRule = await resolveRule(
      "OPEN_WORLD_CORRUPTION_GROWTH_RULE",
      "只写心理、边界、依赖与危险偏好的变化趋势，不写露骨过程，不要输出模板外字段。",
    );
    const corruptionGrowthTemplate = await resolveTemplate("OPEN_WORLD_CORRUPTION_GROWTH_TEMPLATE_JSON", {
      summary: "成长摘要",
      changeHints: ["变化一", "变化二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_CORRUPTION_GROWTH_PROMPT", {
      npcName: input.npcName,
      mapName: input.mapName,
      districtName: input.districtName || "",
      actionType: input.actionType,
      corruptionValue: Number(input.corruptionValue || 0),
      atmosphereHint: input.atmosphereHint || "",
      rule: corruptionGrowthRule,
      responseFormat: corruptionGrowthTemplate,
    }, {
      temperature: 0.7,
      maxTokens: 220,
      worldBookScene: "corruption_growth",
    });
    return sanitizeCorruptionGrowth(payload, input);
  } catch (error) {
    return buildFallbackCorruptionGrowth({
      ...input,
      fallbackReason: describeUnknownError(error),
    });
  }
}

export async function generateOpenWorldForcedConsequence(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  atmosphereHint?: string;
  forcedAction: string;
}) {
  try {
    const forcedConsequenceRule = await resolveRule(
      "OPEN_WORLD_FORCED_CONSEQUENCE_RULE",
      "只写高堕落压迫后果，不写露骨过程，保留玩家可读的世界余波。",
    );
    const forcedConsequenceTemplate = await resolveTemplate("OPEN_WORLD_FORCED_CONSEQUENCE_TEMPLATE_JSON", {
      title: "强制后果标题",
      summary: "强制后果摘要",
      atmosphere: "气氛描述",
      worldConsequence: "世界后果",
      changeHints: ["变化一", "变化二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_FORCED_CONSEQUENCE_PROMPT", {
      npcName: input.npcName,
      mapName: input.mapName,
      districtName: input.districtName || "",
      actionType: input.actionType,
      outcomeType: "forced_consequence",
      forcedAction: input.forcedAction,
      atmosphereHint: input.atmosphereHint || "",
      rule: forcedConsequenceRule,
      responseFormat: forcedConsequenceTemplate,
    }, {
      temperature: 0.66,
      maxTokens: 260,
      worldBookScene: "forced_consequence",
    });
    return sanitizeAdultOutcome(payload, {
      ...input,
      outcomeType: "result",
    });
  } catch {
    return buildFallbackAdultOutcome({
      ...input,
      outcomeType: "result",
    });
  }
}

export async function generateOpenWorldPartnerJealousy(input: {
  npcName: string;
  mapName: string;
  districtName?: string | null;
  actionType: string;
  atmosphereHint?: string;
  partnerName: string;
}) {
  try {
    const partnerJealousyRule = await resolveRule(
      "OPEN_WORLD_PARTNER_JEALOUSY_RULE",
      "这是局部私怨，不是世界通缉。",
    );
    const partnerJealousyTemplate = await resolveTemplate("OPEN_WORLD_PARTNER_JEALOUSY_TEMPLATE_JSON", {
      title: "私怨标题",
      summary: "私怨摘要",
      atmosphere: "气氛描述",
      worldConsequence: "局部后果",
      changeHints: ["变化一", "变化二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_PARTNER_JEALOUSY_PROMPT", {
      npcName: input.npcName,
      partnerName: input.partnerName,
      mapName: input.mapName,
      districtName: input.districtName || "",
      actionType: input.actionType,
      outcomeType: "partner_jealousy",
      atmosphereHint: input.atmosphereHint || "",
      rule: partnerJealousyRule,
      responseFormat: partnerJealousyTemplate,
    }, {
      temperature: 0.62,
      maxTokens: 240,
      worldBookScene: "partner_jealousy",
    });
    return sanitizeAdultOutcome(payload, {
      ...input,
      outcomeType: "result",
    });
  } catch {
    return buildFallbackAdultOutcome({
      ...input,
      outcomeType: "result",
    });
  }
}

export async function generateOpenWorldAdultRumor(input: {
  mapName: string;
  districtName?: string | null;
  actionType: string;
  moodHint?: string;
}) {
  try {
    const adultRumorRule = await resolveRule(
      "OPEN_WORLD_ADULT_RUMOR_RULE",
      "只写坊间风声，不写露骨过程。",
    );
    const adultRumorTemplate = await resolveTemplate("OPEN_WORLD_ADULT_RUMOR_TEMPLATE_JSON", {
      title: "风声标题",
      summary: "风声摘要",
      heat: "medium",
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_ADULT_RUMOR_PROMPT", {
      mapName: input.mapName,
      districtName: input.districtName || "",
      actionType: input.actionType,
      moodHint: input.moodHint || "",
      rule: adultRumorRule,
      responseFormat: adultRumorTemplate,
    }, { temperature: 0.66, maxTokens: 200, worldBookScene: "adult_rumor" });
    return sanitizeAdultRumor(payload, input);
  } catch {
    return buildFallbackAdultRumor(input);
  }
}

export async function generateOpenWorldAdultBark(input: {
  seed: string;
  mapName: string;
  districtName?: string | null;
  npcName: string;
  actionType: string;
  moodHint?: string;
}) {
  try {
    const adultBarkRule = await resolveRule(
      "OPEN_WORLD_ADULT_BARK_RULE",
      "只写暧昧试探阶段的短句，不写露骨过程，不要出现模板外字段。",
    );
    const adultBarkTemplate = await resolveTemplate("OPEN_WORLD_ADULT_BARK_TEMPLATE_JSON", {
      mood: "一句情绪标签",
      content: "一句 NPC 当前短句",
      lines: ["短句一", "短句二"],
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_ADULT_BARK_PROMPT", {
      mapName: input.mapName,
      districtName: input.districtName || "",
      npcName: input.npcName,
      actionType: input.actionType,
      moodHint: input.moodHint || "",
      responseFormat: adultBarkTemplate,
      rule: adultBarkRule,
    }, { temperature: 0.82, maxTokens: 220, worldBookScene: "adult_bark" });

    return sanitizeNpcBark(payload, {
      seed: input.seed,
      npcName: input.npcName,
      currentActionLabel: "试探",
      mapName: input.mapName,
    });
  } catch {
    return buildFallbackNpcBark({
      npcName: input.npcName,
      currentActionLabel: "试探",
      mapName: input.mapName,
    });
  }
}

export async function generateOpenWorldCustomNpcPreview(input: {
  mapName: string;
  mapArchetype: string;
  entries: Array<{
    npcId: string;
    name: string;
    faction: string;
    profession: string;
    preferredMapIds?: string[];
    preferredMapTags?: string[];
  }>;
}) {
  try {
    const customNpcPreviewRule = await resolveRule(
      "OPEN_WORLD_CUSTOM_NPC_PREVIEW_RULE",
      "只写这些自定义 NPC 在当前地图里的出场摘要与气质，不改写其核心身份。",
    );
    const customNpcPreviewTemplate = await resolveTemplate("OPEN_WORLD_CUSTOM_NPC_PREVIEW_TEMPLATE_JSON", {
      summary: "出场群像摘要",
      entries: input.entries.map((entry) => ({
        npcId: entry.npcId,
        sceneHint: `${entry.name}的出场提示`,
        mood: "一句气质描述",
        tags: [entry.faction || "势力", entry.profession || "职业"].filter(Boolean),
      })),
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_CUSTOM_NPC_PROMPT", {
      mapName: input.mapName,
      mapArchetype: input.mapArchetype,
      entries: input.entries,
      rule: customNpcPreviewRule,
      responseFormat: customNpcPreviewTemplate,
    }, {
      temperature: 0.72,
      maxTokens: 420,
      worldBookScene: "custom_npc",
    });
    return sanitizeCustomNpcPreview(payload, input);
  } catch {
    return buildFallbackCustomNpcPreview(input);
  }
}

export async function generateOpenWorldCustomNpcLibrary(input: {
  seedKeywords: string[];
  styleKeywords?: string[];
  forbiddenKeywords?: string[];
  worldTheme?: string;
  npcCount?: number;
  preferredMapTags?: string[];
}) {
  const fallbackLibrary = getCachedOpenWorldCustomNpcLibrary();
  const referenceLibrary = buildCustomNpcLibraryReferenceSnapshot(fallbackLibrary);
  const desiredNpcCount = Math.max(1, Math.min(8, Math.floor(Number(input.npcCount || 4) || 4)));
  const summaryFallback = input.seedKeywords.length > 0
    ? `已根据关键词“${input.seedKeywords.slice(0, 6).join("、")}”回退到当前自定义 NPC 库。`
    : "已回退到当前自定义 NPC 库。";

  const runAttempt = async (strictVariation: boolean) => {
    const customNpcLibraryRule = await resolveRule(
      "OPEN_WORLD_CUSTOM_NPC_LIBRARY_RULE",
      "请按输入关键词生成一批可直接注入开放世界和普通世界动态层的自定义 NPC。可参考现有风格，但不要整体照抄旧库。",
    );
    const customNpcLibraryTemplate = await resolveTemplate("OPEN_WORLD_CUSTOM_NPC_LIBRARY_TEMPLATE_JSON", {
      summary: "一句话说明本次生成的自定义 NPC 群像方向",
      library: {
        npcs: [{
          id: "自定义NPC唯一ID",
          name: "中文修仙风格名字",
          gender: "female",
          originType: "出身",
          profession: "职业",
          faction: "势力",
          realmMinor: 4,
          personalitySummary: "人格摘要",
          traitTags: ["特性1", "特性2"],
          worldBookKeywords: ["关键词1", "关键词2"],
          adultTags: ["成人标签1", "成人标签2"],
          grayTags: ["灰线标签1", "灰线标签2"],
          preferredMapIds: ["world_open_1"],
          preferredMapTags: ["散修坊市带"],
          writeToRandomPool: true,
          allowDynamicWorldSpawn: true,
          partnerIds: ["custom_xxx"],
          primaryPartnerId: "",
          relationshipTags: ["关系标签1", "关系标签2"],
        }],
      },
    });
    const payload = await requestOpenWorldJson("OPEN_WORLD_CUSTOM_NPC_LIBRARY_PROMPT", {
      worldTheme: input.worldTheme || "灰色修仙界、街区任务链、开放世界动态 NPC、黑市与风声流动",
      seedKeywords: input.seedKeywords,
      styleKeywords: input.styleKeywords || [],
      forbiddenKeywords: input.forbiddenKeywords || [],
      preferredMapTags: input.preferredMapTags || [],
      desiredNpcCount,
      generationNonce: `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      referenceCustomNpcLibrary: referenceLibrary,
      responseFormat: customNpcLibraryTemplate,
      rule: strictVariation
        ? `${customNpcLibraryRule}\n额外强约束：必须按输入关键词重新生成一整批明显有区别的自定义 NPC。参考库只可借鉴结构和少量风格，不得整体照抄旧名字、旧身份、旧关系；至少一半以上 NPC 名字和核心设定要与参考库不同。`
        : customNpcLibraryRule,
    }, {
      temperature: strictVariation ? 1.02 : 0.88,
      maxTokens: 2600,
      worldBookScene: "custom_npc",
      omitCustomNpcLibrarySnapshot: true,
    });

    const libraryPayload = payload?.library && typeof payload.library === "object" && !Array.isArray(payload.library)
      ? payload.library as Record<string, unknown>
      : payload;
    return sanitizeOpenWorldCustomNpcLibraryGeneration(
      payload,
      libraryPayload,
      fallbackLibrary,
      summaryFallback,
      payload ? null : "模型返回内容不是可用的自定义 NPC 库 JSON 对象。",
    );
  };

  try {
    const firstPass = await runAttempt(false);
    if (firstPass.source === "ai" && !isCustomNpcLibraryTooSimilar(firstPass.library, fallbackLibrary)) {
      return firstPass;
    }

    const secondPass = await runAttempt(true);
    if (secondPass.source === "ai") {
      const tooSimilar = isCustomNpcLibraryTooSimilar(secondPass.library, fallbackLibrary);
      return {
        ...secondPass,
        summary: tooSimilar
          ? `${secondPass.summary}（模型本次生成仍偏保守，已保留结果，你可以再次生成刷新另一批人。）`
          : secondPass.summary,
      };
    }
    return secondPass;
  } catch (error) {
    return {
      source: "fallback" as const,
      summary: summaryFallback,
      library: {
        npcs: fallbackLibrary.npcs.map((npc) => ({ ...npc })),
      },
      fallbackReason: describeUnknownError(error),
    };
  }
}
