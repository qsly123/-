import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { SpiritualRoot } from "@/types/game";
import {
  ALCHEMY_LLM_CONFIG_KEYS,
  CORE_LLM_CONFIG_KEYS,
  EVENT_LLM_CONFIG_KEYS,
  NPC_LLM_CONFIG_KEYS,
  OPEN_WORLD_LLM_CONFIG_KEYS,
  SPIRITUAL_ROOT_CONFIG_KEYS,
  SPIRITUAL_ROOT_LLM_CONFIG_KEYS,
  SMITHING_LLM_CONFIG_KEYS,
  SYSTEM_CONFIG_ITEMS,
  WORLD_FLAVOR_LLM_CONFIG_KEYS,
} from "@/modules/system/services/system-config-keys";
import { getRequiredSystemConfigMap, getSystemConfigMap, getSystemConfigValue } from "@/modules/system/services/system-config";

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type AiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiToolMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

const NPC_SUMMARY_PROMPT_KEY = "NPC_SUMMARY_PROMPT";

type ChatScene = "default" | "spiritualRoot" | "npc" | "event" | "worldFlavor" | "openWorld" | "smithing" | "alchemy";

type ChatRuntime = {
  client: OpenAI;
  model: string;
  expiresAt: number;
};

const VALID_SPIRITUAL_ROOT_VARIANTS = new Set(["雷", "冰", "风", "暗", "光", "淫"]);
const EMPTY_SPIRITUAL_ROOT_VARIANTS = new Set(["", "null", "none", "无", "无变异", "瑕"]);
const CHAT_RUNTIME_CACHE_TTL_MS = 15_000;
const DEFAULT_AI_TIMEOUT_MS = 12_000;
const chatRuntimeCache = new Map<ChatScene, ChatRuntime>();
const chatRuntimePromiseCache = new Map<ChatScene, Promise<ChatRuntime>>();

const CHAT_SCENE_KEY_MAP: Record<Exclude<ChatScene, "default">, readonly [string, string, string]> = {
  spiritualRoot: SPIRITUAL_ROOT_LLM_CONFIG_KEYS,
  npc: NPC_LLM_CONFIG_KEYS,
  event: EVENT_LLM_CONFIG_KEYS,
  worldFlavor: WORLD_FLAVOR_LLM_CONFIG_KEYS,
  openWorld: OPEN_WORLD_LLM_CONFIG_KEYS,
  smithing: SMITHING_LLM_CONFIG_KEYS,
  alchemy: ALCHEMY_LLM_CONFIG_KEYS,
};

function pickOverrideOrFallback(overrideValue: string | undefined, fallbackValue: string) {
  const normalized = (overrideValue || "").trim();
  return normalized || fallbackValue;
}

function buildChatRuntime(baseURL: string, apiKey: string, model: string): ChatRuntime {
  return {
    client: new OpenAI({
      baseURL,
      apiKey,
    }),
    model,
    expiresAt: Date.now() + CHAT_RUNTIME_CACHE_TTL_MS,
  };
}

function normalizeTimeoutMs(value: number | undefined) {
  const timeoutMs = Number(value || DEFAULT_AI_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_AI_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(60_000, Math.floor(timeoutMs)));
}

function shouldRetryWithoutJsonResponseFormat(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : String(error || "");
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("response_format")
    || normalized.includes("json_object")
    || (normalized.includes("unsupported") && normalized.includes("json"))
    || (normalized.includes("invalid") && normalized.includes("response format"))
  );
}

async function createChatRuntime(scene: ChatScene = "default") {
  const cached = chatRuntimeCache.get(scene);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const activePromise = chatRuntimePromiseCache.get(scene);
  if (activePromise) {
    return await activePromise;
  }

  const runtimePromise = (async () => {
    const coreConfig = await getRequiredSystemConfigMap(CORE_LLM_CONFIG_KEYS);
    if (scene === "default") {
      const runtime = buildChatRuntime(
        coreConfig.LLM_BASE_URL,
        coreConfig.LLM_API_KEY,
        coreConfig.LLM_MODEL,
      );
      chatRuntimeCache.set(scene, runtime);
      return runtime;
    }

    if (scene === "openWorld" || scene === "smithing" || scene === "alchemy") {
      const worldFlavorOverrideMap = await getSystemConfigMap(WORLD_FLAVOR_LLM_CONFIG_KEYS);
      const sceneOverrideKeys = scene === "openWorld"
        ? OPEN_WORLD_LLM_CONFIG_KEYS
        : (scene === "smithing" ? SMITHING_LLM_CONFIG_KEYS : ALCHEMY_LLM_CONFIG_KEYS);
      const sceneOverrideMap = await getSystemConfigMap(sceneOverrideKeys);
      const runtime = buildChatRuntime(
        pickOverrideOrFallback(
          sceneOverrideMap[sceneOverrideKeys[0]],
          pickOverrideOrFallback(worldFlavorOverrideMap.WORLD_FLAVOR_LLM_BASE_URL, coreConfig.LLM_BASE_URL),
        ),
        pickOverrideOrFallback(
          sceneOverrideMap[sceneOverrideKeys[1]],
          pickOverrideOrFallback(worldFlavorOverrideMap.WORLD_FLAVOR_LLM_API_KEY, coreConfig.LLM_API_KEY),
        ),
        pickOverrideOrFallback(
          sceneOverrideMap[sceneOverrideKeys[2]],
          pickOverrideOrFallback(worldFlavorOverrideMap.WORLD_FLAVOR_LLM_MODEL, coreConfig.LLM_MODEL),
        ),
      );
      chatRuntimeCache.set(scene, runtime);
      return runtime;
    }

    const overrideKeys = CHAT_SCENE_KEY_MAP[scene];
    const overrideMap = await getSystemConfigMap(overrideKeys);
    const runtime = buildChatRuntime(
      pickOverrideOrFallback(overrideMap[overrideKeys[0]], coreConfig.LLM_BASE_URL),
      pickOverrideOrFallback(overrideMap[overrideKeys[1]], coreConfig.LLM_API_KEY),
      pickOverrideOrFallback(overrideMap[overrideKeys[2]], coreConfig.LLM_MODEL),
    );
    chatRuntimeCache.set(scene, runtime);
    return runtime;
  })();

  chatRuntimePromiseCache.set(scene, runtimePromise);
  return await runtimePromise.finally(() => {
    if (chatRuntimePromiseCache.get(scene) === runtimePromise) {
      chatRuntimePromiseCache.delete(scene);
    }
  });
}

/** 通用 AI 调用 */
export async function chatCompletion(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    scene?: ChatScene;
    timeoutMs?: number;
    responseFormat?: "json_object";
  }
): Promise<string> {
  const runtime = await createChatRuntime(options?.scene || "default");
  const formattedMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];
  const requestPayload = {
    model: runtime.model,
    messages: formattedMessages,
    temperature: options?.temperature ?? 0.8,
    max_tokens: options?.maxTokens ?? 500,
    ...(options?.responseFormat === "json_object"
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };
  let response: Awaited<ReturnType<typeof runtime.client.chat.completions.create>>;
  try {
    response = await runtime.client.chat.completions.create(requestPayload, {
      timeout: normalizeTimeoutMs(options?.timeoutMs),
    });
  } catch (error) {
    if (options?.responseFormat !== "json_object" || !shouldRetryWithoutJsonResponseFormat(error)) {
      throw error;
    }

    response = await runtime.client.chat.completions.create({
      model: runtime.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.8,
      max_tokens: options?.maxTokens ?? 500,
    }, {
      timeout: normalizeTimeoutMs(options?.timeoutMs),
    });
  }
  return response.choices[0]?.message?.content || "";
}

/** 支持工具调用的 AI 对话 */
export async function chatCompletionWithTools(
  systemPrompt: string,
  messages: AiToolMessage[],
  tools: AiToolDefinition[],
  options?: { temperature?: number; maxTokens?: number; scene?: ChatScene; timeoutMs?: number }
): Promise<{ content: string; toolCalls: AiToolCall[] }> {
  const runtime = await createChatRuntime(options?.scene || "default");
  const formattedMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        };
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content || "",
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: {
              name: call.name,
              arguments: call.arguments,
            },
          })),
        };
      }

      return {
        role: message.role,
        content: message.content,
      };
    }),
  ];

  const response = await runtime.client.chat.completions.create({
    model: runtime.model,
    messages: formattedMessages as unknown as ChatCompletionMessageParam[],
    tools: tools as unknown as ChatCompletionTool[],
    temperature: options?.temperature ?? 0.8,
    max_tokens: options?.maxTokens ?? 500,
  }, {
    timeout: normalizeTimeoutMs(options?.timeoutMs),
  });

  const aiMessage = response.choices[0]?.message;
  const toolCalls = (aiMessage?.tool_calls || [])
    .filter((call): call is {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    } => call.type === "function" && "function" in call && !!call.function)
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));

  return {
    content: aiMessage?.content || "",
    toolCalls,
  };
}

function getDefaultSpiritualRootPrompt() {
  const key = SPIRITUAL_ROOT_CONFIG_KEYS[0];
  const config = SYSTEM_CONFIG_ITEMS.find((item) => item.key === key);
  if (config?.defaultValue && config.defaultValue.trim()) {
    return config.defaultValue;
  }
  return "你是修仙世界的天道意志。根据弟子心中所想，生成一个独特灵根，并严格返回 JSON。";
}

async function resolveSpiritualRootPrompt() {
  const key = SPIRITUAL_ROOT_CONFIG_KEYS[0];
  const value = await getSystemConfigValue(key);
  return value?.trim() || getDefaultSpiritualRootPrompt();
}

function renderPromptTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, rawKey) => variables[rawKey] ?? "");
}

function normalizeSpiritualRootVariant(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (EMPTY_SPIRITUAL_ROOT_VARIANTS.has(lowered) || EMPTY_SPIRITUAL_ROOT_VARIANTS.has(normalized)) {
    return null;
  }

  return VALID_SPIRITUAL_ROOT_VARIANTS.has(normalized) ? normalized : null;
}

function getDefaultNpcSummaryPrompt() {
  const config = SYSTEM_CONFIG_ITEMS.find((item) => item.key === NPC_SUMMARY_PROMPT_KEY);
  if (config?.defaultValue && config.defaultValue.trim()) {
    return config.defaultValue;
  }
  return "你是一个对话摘要助手。请将以下{{npcName}}与修士的对话内容压缩为简短摘要，保留关键信息。";
}

async function resolveNpcSummaryPrompt(npcName: string) {
  const value = await getSystemConfigValue(NPC_SUMMARY_PROMPT_KEY);
  const template = value?.trim() || getDefaultNpcSummaryPrompt();
  return renderPromptTemplate(template, { npcName });
}

/** 生成灵根 */
export async function generateSpiritualRoot(playerWish: string): Promise<SpiritualRoot> {
  // 模型未配置 / 调用失败都必须能开出角色，因此整条 LLM 链路都在兜底范围内。
  let response: string | null = null;
  try {
    const systemPrompt = await resolveSpiritualRootPrompt();

    response = await chatCompletion(
      systemPrompt,
      [{ role: "user", content: `弟子心中所想：${playerWish}` }],
      { temperature: 0.9, maxTokens: 300, scene: "spiritualRoot" }
    );
  } catch (error) {
    console.warn(
      "[ai] 灵根生成模型不可用，退回本地模板：",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (response) {
    try {
      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const root: SpiritualRoot = JSON.parse(jsonMatch[0]);

      // 校验并限制加成范围
      const b = root.bonuses;
      const clamp = (v: number | undefined) => Math.min(Math.max(v || 0, 0), 0.15);
      root.variant = normalizeSpiritualRootVariant(root.variant);
      root.bonuses = {
        hpPercent: clamp(b.hpPercent),
        mpPercent: clamp(b.mpPercent),
        atkPercent: clamp(b.atkPercent),
        defPercent: clamp(b.defPercent),
        speedPercent: clamp(b.speedPercent),
        luckPercent: clamp(b.luckPercent),
        spiritualSensePercent: clamp(b.spiritualSensePercent),
        armorPenetrationPercent: clamp(b.armorPenetrationPercent),
        blockPercent: clamp(b.blockPercent),
        skillDamageBonusPercent: clamp(b.skillDamageBonusPercent),
        skillDamageReductionPercent: clamp(b.skillDamageReductionPercent),
        artifactDamageBonusPercent: clamp(b.artifactDamageBonusPercent),
        artifactDamageReductionPercent: clamp(b.artifactDamageReductionPercent),
        elementDamageBonus: clamp(b.elementDamageBonus),
      };

      return root;
    } catch {
      // 模型返回无法解析，同样退回本地模板
    }
  }

  return buildOfflineSpiritualRoot(playerWish);
}

const OFFLINE_ROOT_ELEMENTS = ["金", "木", "水", "火", "土"] as const;

const OFFLINE_ROOT_NAMES: Record<string, readonly string[]> = {
  金: ["锐金灵根", "庚金剑骨灵根", "太白锋芒灵根"],
  木: ["苍木灵根", "青乙木灵根", "万木回春灵根"],
  水: ["玄水灵根", "癸水灵根", "北溟寒渊灵根"],
  火: ["赤火灵根", "丙火灵根", "离火焚心灵根"],
  土: ["厚土灵根", "戊土灵根", "磐岳镇地基灵根"],
};

const OFFLINE_ROOT_DESCS: Record<string, readonly string[]> = {
  金: ["灵根呈银白之色，锋芒内敛而锐不可当。", "金气凛然，出手如剑，最利攻伐。"],
  木: ["灵根翠色盎然，生机绵长，最擅久战。", "木气滋生，气血悠长，损伤易复。"],
  水: ["灵根幽蓝深邃，如深潭之水，法力绵厚。", "水气柔韧，御法从容，久战不竭。"],
  火: ["灵根赤红炽烈，热浪隐隐，攻势最猛。", "火气张扬，一击焚心，爆发无双。"],
  土: ["灵根厚重如山，金黄沉稳，守御无双。", "土气敦实，身如磐岳，难撼分毫。"],
};

// 离线模板只使用常规属性变异；特殊玩法变异（如「淫」）交由模型在配置齐全时生成。
const OFFLINE_ROOT_VARIANTS = ["雷", "冰", "风", "暗", "光"] as const;

function hashWishText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 未配置 LLM 或调用失败时的灵根兜底。
 * 按心愿文本做确定性哈希，同一句心愿必得同一灵根，避免刷新即变、也不同玩家撞成一样。
 */
export function buildOfflineSpiritualRoot(playerWish: string): SpiritualRoot {
  const wish = playerWish.trim();
  const seed = hashWishText(wish || "道心初立");
  const element = OFFLINE_ROOT_ELEMENTS[seed % OFFLINE_ROOT_ELEMENTS.length] ?? "土";

  const names = OFFLINE_ROOT_NAMES[element] ?? [];
  const descs = OFFLINE_ROOT_DESCS[element] ?? [];
  const name = names[(seed >>> 5) % Math.max(names.length, 1)] ?? `${element}灵根`;
  const baseDesc = descs[(seed >>> 9) % Math.max(descs.length, 1)] ?? `灵根属${element}，禀赋自天成。`;

  // 约三成概率带属性变异
  const variantSeed = seed >>> 13;
  const variant = variantSeed % 10 < 3
    ? OFFLINE_ROOT_VARIANTS[variantSeed % OFFLINE_ROOT_VARIANTS.length] ?? null
    : null;

  const mainBonus = 0.06 + ((seed >>> 17) % 5) * 0.015;
  const elementBonus: Record<string, SpiritualRoot["bonuses"]> = {
    金: { atkPercent: mainBonus, armorPenetrationPercent: 0.03 },
    木: { hpPercent: mainBonus, blockPercent: 0.03 },
    水: { mpPercent: mainBonus, spiritualSensePercent: 0.03 },
    火: { atkPercent: mainBonus, skillDamageBonusPercent: 0.03 },
    土: { defPercent: mainBonus, skillDamageReductionPercent: 0.03 },
  };

  const wishEcho = wish ? wish.slice(0, 12) : "长生大道";
  const description = variant
    ? `${baseDesc}此根兼带${variant}属变异，乃弟子心中所念「${wishEcho}」感召而生。`
    : `${baseDesc}乃弟子心中所念「${wishEcho}」感召而生。`;

  return {
    name,
    element,
    variant,
    description,
    bonuses: {
      ...(elementBonus[element] ?? {}),
      luckPercent: 0.02,
      elementDamageBonus: 0.05,
    },
  };
}

/** NPC 对话 */
export async function npcChat(
  npcPersonality: string,
  worldContext: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  playerMessage: string,
  memorySummary?: string
): Promise<string> {
  const systemPrompt = `${npcPersonality}

===== 世界背景 =====
${worldContext}
${memorySummary ? `\n===== 与此修士的过往记忆摘要 =====\n${memorySummary}` : ""}

注意：
1. 保持角色设定，不要跳出角色
2. 回复简洁，控制在100字以内
3. 适当使用修仙世界的称呼和用语
4. 记住之前对话的上下文`;

  return chatCompletion(
    systemPrompt,
    [...conversationHistory, { role: "user", content: playerMessage }],
    { temperature: 0.8, maxTokens: 200, scene: "npc" }
  );
}

/** 压缩对话历史为摘要 */
export async function summarizeConversation(
  npcName: string,
  conversations: { role: string; content: string }[]
): Promise<string> {
  const convText = conversations.map(c =>
    `${c.role === "user" ? "修士" : npcName}: ${c.content}`
  ).join("\n");
  const systemPrompt = await resolveNpcSummaryPrompt(npcName);

  return chatCompletion(
    systemPrompt,
    [{ role: "user", content: convText }],
    { temperature: 0.3, maxTokens: 150, scene: "npc" }
  );
}

/** 随机事件叙事 */
export async function narrateEvent(
  eventPrompt: string,
  playerName: string,
  playerRealm: string
): Promise<string> {
  return chatCompletion(
    eventPrompt,
    [{ role: "user", content: `修士"${playerName}"，当前境界：${playerRealm}，正在探索途中。请描述这次奇遇。` }],
    { temperature: 0.9, maxTokens: 300, scene: "event" }
  );
}

function pickJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "";
}

export async function narrateEventWithVariables(params: {
  eventPrompt: string;
  playerName: string;
  playerRealm: string;
  variableKeys: string[];
}) {
  const variableKeys = [...new Set(params.variableKeys.map((key) => key.trim()).filter(Boolean))];
  if (variableKeys.length === 0) {
    return {
      narrative: await narrateEvent(params.eventPrompt, params.playerName, params.playerRealm),
      variables: {} as Record<string, string>,
    };
  }

  const exampleVariables = variableKeys
    .map((key) => `\"${key}\":\"示例角色名\"`)
    .join(",");

  const systemPrompt = `${params.eventPrompt}

你必须只返回 JSON 对象，不要输出其他说明文本。
返回格式：
{
  "narrative": "剧情叙事",
  "variables": {${exampleVariables}}
}
要求：
1. variables 必须包含全部键：${variableKeys.join(", ")}；
2. variables 的值必须是角色真实名字，不要加花括号。`;

  const response = await chatCompletion(
    systemPrompt,
    [{ role: "user", content: `修士"${params.playerName}"，当前境界：${params.playerRealm}，正在探索途中。请描述这次奇遇并填充变量。` }],
    { temperature: 0.9, maxTokens: 360, scene: "event" }
  );

  const jsonText = pickJsonObject(response);
  if (!jsonText) {
    throw new Error("AI 返回格式错误：缺少 JSON 对象");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI 返回格式错误：JSON 解析失败");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 返回格式错误：顶层结构非法");
  }

  const payload = parsed as Record<string, unknown>;
  const narrative = typeof payload.narrative === "string" ? payload.narrative.trim() : "";
  if (!narrative) {
    throw new Error("AI 返回格式错误：narrative 为空");
  }

  const rawVariables = payload.variables;
  if (!rawVariables || typeof rawVariables !== "object" || Array.isArray(rawVariables)) {
    throw new Error("AI 返回格式错误：variables 非对象");
  }

  const variables: Record<string, string> = {};
  for (const key of variableKeys) {
    const value = typeof (rawVariables as Record<string, unknown>)[key] === "string"
      ? String((rawVariables as Record<string, unknown>)[key]).trim()
      : "";
    if (!value) {
      throw new Error(`AI 返回格式错误：缺少变量 ${key}`);
    }
    variables[key] = value;
  }

  return {
    narrative,
    variables,
  };
}
