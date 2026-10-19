import { chatCompletion } from "@/modules/ai/services/ai";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import { SYSTEM_CONFIG_ITEMS } from "@/modules/system/services/system-config-keys";

type WorldFlavorScene = "npc" | "event" | "worldFlavor" | "smithing";
type WorldFlavorKind = "equipment" | "smithing" | "encounter" | "npcBark" | "mapRumor";

export interface WorldFlavorAttributeConstraint {
  key: string;
  label: string;
  min: number;
  max: number;
  preferred?: number;
  rare?: boolean;
}

export interface GeneratedWorldFlavorAffix {
  key: string;
  label: string;
  value: number;
  reason: string;
  rare?: boolean;
}

export interface EquipmentFlavorRequest {
  seed?: string;
  realm: string;
  stageName?: string;
  route: string;
  itemCategory: string;
  baseName?: string;
  descriptionMaxLength?: number;
  materialTags?: string[];
  themeTags?: string[];
  storyHooks?: string[];
  allowedAttributes?: WorldFlavorAttributeConstraint[];
  maxAttributeCount?: number;
}

export interface EquipmentFlavorResult {
  source: "ai" | "fallback";
  name: string;
  shortName: string;
  origin: string;
  description: string;
  flavorLines: string[];
  affixes: GeneratedWorldFlavorAffix[];
}

export interface EncounterStoryboardShot {
  scene: string;
  narration: string;
  speaker?: string;
  line?: string;
}

export interface EncounterStoryboardRequest {
  seed?: string;
  titleHint?: string;
  realm: string;
  mapName: string;
  theme: string;
  npcNames?: string[];
  enemyNames?: string[];
  requiredBeats?: string[];
  fixedEnding?: string;
  shotCount?: number;
}

export interface EncounterStoryboardResult {
  source: "ai" | "fallback";
  title: string;
  summary: string;
  shots: EncounterStoryboardShot[];
}

export interface NpcBarkRequest {
  seed?: string;
  realm: string;
  mapName: string;
  npcName: string;
  npcTitle?: string;
  npcRole?: string;
  npcPersonality?: string;
  situation: string;
  stance?: string;
  targetName?: string;
}

export interface NpcBarkResult {
  source: "ai" | "fallback";
  mood: string;
  lines: string[];
}

export interface MapRumorEntry {
  text: string;
  credibility: "low" | "mid" | "high";
  tag?: string;
}

export interface MapRumorRequest {
  seed?: string;
  realm: string;
  mapName: string;
  theme?: string;
  rumorSources?: string[];
  fixedFacts?: string[];
  tabooTags?: string[];
  dangerTags?: string[];
  rumorCount?: number;
}

export interface MapRumorResult {
  source: "ai" | "fallback";
  headline: string;
  rumors: MapRumorEntry[];
}

const WORLD_FLAVOR_PROMPT_KEYS = {
  equipment: "WORLD_FLAVOR_EQUIPMENT_PROMPT",
  smithing: "WORLD_FLAVOR_SMITHING_PROMPT",
  encounter: "WORLD_FLAVOR_ENCOUNTER_PROMPT",
  npcBark: "WORLD_FLAVOR_NPC_BARK_PROMPT",
  mapRumor: "WORLD_FLAVOR_MAP_RUMOR_PROMPT",
} as const satisfies Record<WorldFlavorKind, string>;

const WORLD_FLAVOR_SCENE_MAP: Record<WorldFlavorKind, WorldFlavorScene> = {
  equipment: "worldFlavor",
  smithing: "smithing",
  encounter: "worldFlavor",
  npcBark: "npc",
  mapRumor: "worldFlavor",
};
const WORLD_FLAVOR_AI_TIMEOUT_MS = 10_000;

function findDefaultPrompt(key: string) {
  const item = SYSTEM_CONFIG_ITEMS.find((config) => config.key === key);
  return item?.defaultValue?.trim() || "";
}

async function resolvePrompt(key: string) {
  const configured = await getSystemConfigValue(key);
  return configured?.trim() || findDefaultPrompt(key);
}

function pickJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const jsonText = pickJsonObject(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
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

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeStringArray(value: unknown, minCount: number, maxCount: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const result = value
    .map((entry) => trimText(entry, maxLength))
    .filter(Boolean);

  return result.slice(0, Math.max(minCount, maxCount));
}

function pickFromSeed(seed: string, values: readonly string[]) {
  if (values.length === 0) {
    return "";
  }
  const hash = Array.from(seed).reduce((acc, char, index) => {
    return (acc + char.charCodeAt(0) * (index + 17)) % 2147483647;
  }, 0);
  return values[hash % values.length];
}

async function requestWorldFlavorJson(kind: WorldFlavorKind, payload: Record<string, unknown>, options?: {
  temperature?: number;
  maxTokens?: number;
}) {
  const prompt = await resolvePrompt(WORLD_FLAVOR_PROMPT_KEYS[kind]);
  const response = await chatCompletion(
    prompt,
    [{
      role: "user",
      content: `请基于以下输入生成内容，并且只返回 JSON 对象：\n${JSON.stringify(payload, null, 2)}`,
    }],
    {
      temperature: options?.temperature ?? 0.85,
      maxTokens: options?.maxTokens ?? 600,
      scene: WORLD_FLAVOR_SCENE_MAP[kind],
      timeoutMs: WORLD_FLAVOR_AI_TIMEOUT_MS,
    }
  );

  return parseJsonObject(response);
}

function sanitizeAffixes(
  rawAffixes: unknown,
  allowedAttributes: WorldFlavorAttributeConstraint[] | undefined,
  maxAttributeCount: number
) {
  if (!allowedAttributes?.length || !Array.isArray(rawAffixes)) {
    return [] as GeneratedWorldFlavorAffix[];
  }

  const allowedMap = new Map(allowedAttributes.map((attribute) => [attribute.key, attribute]));
  const seen = new Set<string>();
  const result: GeneratedWorldFlavorAffix[] = [];

  for (const rawAffix of rawAffixes) {
    if (!rawAffix || typeof rawAffix !== "object" || Array.isArray(rawAffix)) {
      continue;
    }

    const payload = rawAffix as Record<string, unknown>;
    const key = trimText(payload.key, 40);
    const constraint = allowedMap.get(key);
    if (!constraint || seen.has(key)) {
      continue;
    }

    const value = clampInteger(payload.value, constraint.min, constraint.max, constraint.preferred ?? constraint.min);
    result.push({
      key,
      label: trimText(payload.label, 20, constraint.label),
      value,
      reason: trimText(payload.reason, 30, "此器物在炼制时保留了原材余性。"),
      rare: constraint.rare || undefined,
    });
    seen.add(key);

    if (result.length >= maxAttributeCount) {
      break;
    }
  }

  return result;
}

export function buildFallbackEquipmentFlavor(request: EquipmentFlavorRequest): EquipmentFlavorResult {
  const descriptionMaxLength = Math.max(12, Math.min(request.descriptionMaxLength ?? 80, 120));
  const routeNameMap: Record<string, readonly string[]> = {
    剑: ["青锋", "寒汐", "断云", "沉星", "归藏"],
    刀: ["斩尘", "裂风", "赤沙", "沉岳", "夜潮"],
    针: ["游丝", "藏霜", "惊雨", "碎月", "断魄"],
    符器: ["引雷", "镇煞", "回灵", "护元", "照骨"],
    盾器: ["玄龟", "伏波", "镇岳", "守关", "沉壁"],
    法修器: ["凝识", "引潮", "明川", "照夜", "听澜"],
    剑匣: ["藏锋", "镇川", "敛河", "守缺", "叩关"],
    战幡: ["血曜", "镇野", "玄烽", "定锋", "压城"],
    灵环: ["逐电", "听风", "流影", "飞芒", "追星"],
    法衣: ["云纹", "玄箓", "沉砂", "护脉", "归海"],
    灵冠: ["镇心", "明识", "听涛", "照魄", "静神"],
    步履: ["逐云", "踏霜", "听风", "行川", "流火"],
  };
  const routePrefix = pickFromSeed(`${request.seed || request.baseName || request.route}:${request.realm}`, routeNameMap[request.route] || ["青木", "玄铁", "沉砂", "流火"]);
  const routeSuffixMap: Record<string, string> = {
    剑: "剑",
    刀: "刀",
    针: "针",
    符器: "符",
    盾器: "盾",
    法修器: "杖",
    剑匣: "匣",
    战幡: "幡",
    灵环: "环",
    法衣: "衣",
    灵冠: "冠",
    步履: "履",
  };
  const suffix = request.itemCategory === "法宝"
    ? (routeSuffixMap[request.route] || "宝")
    : (routeSuffixMap[request.route] || "器");
  const name = trimText(request.baseName, 12) || `${routePrefix}${suffix}`;
  const shortName = trimText(name.slice(0, 4), 6, name);
  const theme = request.themeTags?.[0] || "旧器";
  const material = request.materialTags?.[0] || "寒铁";
  const hook = request.storyHooks?.[0] || "曾随一名无名散修走过荒僻海路";
  const maxAttributeCount = Math.max(0, Math.min(request.maxAttributeCount ?? 2, request.allowedAttributes?.length ?? 0));
  const affixes = (request.allowedAttributes || [])
    .slice(0, maxAttributeCount)
    .map((attribute) => ({
      key: attribute.key,
      label: attribute.label,
      value: clampInteger(attribute.preferred ?? attribute.min, attribute.min, attribute.max, attribute.min),
      reason: `以${material}为骨，炼成后残留${theme}一脉气息。`,
      rare: attribute.rare || undefined,
    }));

  return {
    source: "fallback",
    name,
    shortName,
    origin: `${name}并非名门重器，只因${hook}，才在散修间留下名声。`,
    description: trimText(`此器以${material}炼成，灵光内敛，最宜${request.realm}修士久用。`, descriptionMaxLength),
    flavorLines: [
      `有人说它前主临死前都未肯易手。`,
      `也有人说，此器最认得走投无路之人。`,
    ],
    affixes,
  };
}

function sanitizeEquipmentFlavor(payload: Record<string, unknown> | null, request: EquipmentFlavorRequest): EquipmentFlavorResult {
  const fallback = buildFallbackEquipmentFlavor(request);
  const descriptionMaxLength = Math.max(12, Math.min(request.descriptionMaxLength ?? 80, 120));
  if (!payload) {
    return fallback;
  }

  const maxAttributeCount = Math.max(0, Math.min(request.maxAttributeCount ?? 2, request.allowedAttributes?.length ?? 0));
  const affixes = sanitizeAffixes(payload.affixes, request.allowedAttributes, maxAttributeCount);

  return {
    source: "ai",
    name: trimText(payload.name, 12, fallback.name),
    shortName: trimText(payload.shortName, 8, fallback.shortName),
    origin: trimText(payload.origin, 120, fallback.origin),
    description: trimText(payload.description, descriptionMaxLength, fallback.description),
    flavorLines: normalizeStringArray(payload.flavorLines, 1, 3, 32).slice(0, 3),
    affixes,
  };
}

function buildFallbackEncounterStoryboard(request: EncounterStoryboardRequest): EncounterStoryboardResult {
  const firstNpc = request.npcNames?.[0] || "一名散修";
  const firstEnemy = request.enemyNames?.[0] || "来历不明的敌手";
  const beatOne = request.requiredBeats?.[0] || "异样征兆初现";
  const beatTwo = request.requiredBeats?.[1] || "主角被迫出手";
  const ending = request.fixedEnding || "风波暂歇，但代价已刻进道心。";

  return {
    source: "fallback",
    title: trimText(request.titleHint, 16, `${request.mapName}异闻`),
    summary: trimText(`${request.theme}在${request.mapName}骤然发作，${firstNpc}与${firstEnemy}的出现逼得主角提前站队。`, 70),
    shots: [
      {
        scene: beatOne,
        narration: `${request.mapName}风声有异，${firstNpc}带来的消息让人察觉此地已不再太平。`,
      },
      {
        scene: beatTwo,
        narration: `${firstEnemy}显露踪迹后，主角再无退路，只能以${request.realm}修为强行周旋。`,
        speaker: firstNpc,
        line: "道友，今日若退，后患必更深。",
      },
      {
        scene: "余波未尽",
        narration: ending,
      },
    ],
  };
}

function sanitizeEncounterStoryboard(payload: Record<string, unknown> | null, request: EncounterStoryboardRequest): EncounterStoryboardResult {
  const fallback = buildFallbackEncounterStoryboard(request);
  if (!payload) {
    return fallback;
  }

  const rawShots = Array.isArray(payload.shots) ? payload.shots : [];
  const shotLimit = clampInteger(request.shotCount, 3, 6, 4);
  const shots = rawShots
    .filter((shot) => shot && typeof shot === "object" && !Array.isArray(shot))
    .slice(0, shotLimit)
    .map((shot) => {
      const entry = shot as Record<string, unknown>;
      return {
        scene: trimText(entry.scene, 18, "分镜"),
        narration: trimText(entry.narration, 120, "灵气翻涌之间，局势骤然生变。"),
        speaker: trimText(entry.speaker, 12) || undefined,
        line: trimText(entry.line, 28) || undefined,
      };
    })
    .filter((shot) => shot.scene && shot.narration);

  if (shots.length < 3) {
    return fallback;
  }

  return {
    source: "ai",
    title: trimText(payload.title, 16, fallback.title),
    summary: trimText(payload.summary, 70, fallback.summary),
    shots,
  };
}

function buildFallbackNpcBark(request: NpcBarkRequest): NpcBarkResult {
  const target = request.targetName ? `，${request.targetName}` : "";
  const role = request.npcRole || request.npcTitle || "路边修士";
  return {
    source: "fallback",
    mood: trimText(request.stance, 10, "警惕"),
    lines: [
      trimText(`${role}低声道：此地不安稳${target}。`, 24, "此地不安稳。"),
      trimText(`${request.mapName}这阵风，像是要出事。`, 24, `${request.mapName}怕是要出事。`),
      trimText(`${request.situation}，你我都得留个后手。`, 24, "凡事先留后手。"),
    ],
  };
}

function sanitizeNpcBark(payload: Record<string, unknown> | null, request: NpcBarkRequest): NpcBarkResult {
  const fallback = buildFallbackNpcBark(request);
  if (!payload) {
    return fallback;
  }

  const lines = normalizeStringArray(payload.lines, 2, 4, 24).slice(0, 4);
  if (lines.length < 2) {
    return fallback;
  }

  return {
    source: "ai",
    mood: trimText(payload.mood, 12, fallback.mood),
    lines,
  };
}

function buildFallbackMapRumor(request: MapRumorRequest): MapRumorResult {
  const source = request.rumorSources?.[0] || "茶摊闲客";
  const taboo = request.tabooTags?.[0] || "夜里莫近水边";
  const danger = request.dangerTags?.[0] || "有人专盯落单修士";
  const fact = request.fixedFacts?.[0] || `${request.mapName}近来灵气紊乱`;

  return {
    source: "fallback",
    headline: `${request.mapName}近闻`,
    rumors: [
      { text: `${source}传出消息：${fact}。`, credibility: "high", tag: "实闻" },
      { text: `老住民都提醒一句，${taboo}。`, credibility: "mid", tag: "禁忌" },
      { text: `也有人说，${danger}，未必全是假话。`, credibility: "mid", tag: "凶讯" },
    ],
  };
}

function sanitizeMapRumor(payload: Record<string, unknown> | null, request: MapRumorRequest): MapRumorResult {
  const fallback = buildFallbackMapRumor(request);
  if (!payload) {
    return fallback;
  }

  const rawRumors = Array.isArray(payload.rumors) ? payload.rumors : [];
  const rumorLimit = clampInteger(request.rumorCount, 3, 5, 3);
  const rumors = rawRumors
    .filter((rumor) => rumor && typeof rumor === "object" && !Array.isArray(rumor))
    .slice(0, rumorLimit)
    .map((rumor) => {
      const entry = rumor as Record<string, unknown>;
      const credibility = trimText(entry.credibility, 8, "mid");
      return {
        text: trimText(entry.text, 40),
        credibility: (["low", "mid", "high"].includes(credibility) ? credibility : "mid") as MapRumorEntry["credibility"],
        tag: trimText(entry.tag, 12) || undefined,
      };
    })
    .filter((rumor) => rumor.text);

  if (rumors.length < 3) {
    return fallback;
  }

  return {
    source: "ai",
    headline: trimText(payload.headline, 16, fallback.headline),
    rumors,
  };
}

export async function generateEquipmentFlavor(request: EquipmentFlavorRequest): Promise<EquipmentFlavorResult> {
  try {
    const payload = await requestWorldFlavorJson("equipment", {
      realm: request.realm,
      stageName: request.stageName || "",
      route: request.route,
      itemCategory: request.itemCategory,
      baseName: request.baseName || "",
      materialTags: request.materialTags || [],
      themeTags: request.themeTags || [],
      storyHooks: request.storyHooks || [],
      maxAttributeCount: Math.max(0, Math.min(request.maxAttributeCount ?? 2, 4)),
      allowedAttributes: (request.allowedAttributes || []).map((attribute) => ({
        key: attribute.key,
        label: attribute.label,
        min: attribute.min,
        max: attribute.max,
        preferred: attribute.preferred ?? null,
        rare: attribute.rare || false,
      })),
    }, { maxTokens: 700 });

    return sanitizeEquipmentFlavor(payload, request);
  } catch {
    return buildFallbackEquipmentFlavor(request);
  }
}

export async function generateSmithingFlavor(request: EquipmentFlavorRequest): Promise<EquipmentFlavorResult> {
  try {
    const payload = await requestWorldFlavorJson("smithing", {
      realm: request.realm,
      stageName: request.stageName || "",
      route: request.route,
      itemCategory: request.itemCategory,
      baseName: request.baseName || "",
      descriptionMaxLength: request.descriptionMaxLength ?? 80,
      materialTags: request.materialTags || [],
      themeTags: request.themeTags || [],
      storyHooks: request.storyHooks || [],
      maxAttributeCount: Math.max(0, Math.min(request.maxAttributeCount ?? 2, 4)),
      allowedAttributes: (request.allowedAttributes || []).map((attribute) => ({
        key: attribute.key,
        label: attribute.label,
        min: attribute.min,
        max: attribute.max,
        preferred: attribute.preferred ?? null,
        rare: attribute.rare || false,
      })),
    }, { maxTokens: 700 });

    return sanitizeEquipmentFlavor(payload, request);
  } catch {
    return buildFallbackEquipmentFlavor(request);
  }
}

export async function generateEncounterStoryboard(request: EncounterStoryboardRequest): Promise<EncounterStoryboardResult> {
  try {
    const payload = await requestWorldFlavorJson("encounter", {
      titleHint: request.titleHint || "",
      realm: request.realm,
      mapName: request.mapName,
      theme: request.theme,
      npcNames: request.npcNames || [],
      enemyNames: request.enemyNames || [],
      requiredBeats: request.requiredBeats || [],
      fixedEnding: request.fixedEnding || "",
      shotCount: clampInteger(request.shotCount, 3, 6, 4),
    }, { maxTokens: 900 });

    return sanitizeEncounterStoryboard(payload, request);
  } catch {
    return buildFallbackEncounterStoryboard(request);
  }
}

export async function generateNpcBark(request: NpcBarkRequest): Promise<NpcBarkResult> {
  try {
    const payload = await requestWorldFlavorJson("npcBark", {
      realm: request.realm,
      mapName: request.mapName,
      npcName: request.npcName,
      npcTitle: request.npcTitle || "",
      npcRole: request.npcRole || "",
      npcPersonality: request.npcPersonality || "",
      situation: request.situation,
      stance: request.stance || "",
      targetName: request.targetName || "",
    }, { temperature: 0.9, maxTokens: 260 });

    return sanitizeNpcBark(payload, request);
  } catch {
    return buildFallbackNpcBark(request);
  }
}

export async function generateMapRumor(request: MapRumorRequest): Promise<MapRumorResult> {
  try {
    const payload = await requestWorldFlavorJson("mapRumor", {
      realm: request.realm,
      mapName: request.mapName,
      theme: request.theme || "",
      rumorSources: request.rumorSources || [],
      fixedFacts: request.fixedFacts || [],
      tabooTags: request.tabooTags || [],
      dangerTags: request.dangerTags || [],
      rumorCount: clampInteger(request.rumorCount, 3, 5, 3),
    }, { maxTokens: 520 });

    return sanitizeMapRumor(payload, request);
  } catch {
    return buildFallbackMapRumor(request);
  }
}
