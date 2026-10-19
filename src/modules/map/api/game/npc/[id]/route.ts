import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { aiMemories, items, maps } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getItemByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { chatCompletion, chatCompletionWithTools, summarizeConversation } from "@/modules/ai/services/ai";
import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { CORE_LLM_CONFIG_KEYS, NPC_PROMPT_CONFIG_KEYS, SYSTEM_CONFIG_ITEMS } from "@/modules/system/services/system-config-keys";
import {
  buildNpcQuestActionList,
  buildNpcQuestVisibleList,
  decodeNpcEvent,
  encodeNpcEvent,
  executeNpcToolCall,
  getNpcTaskToolDefinitions,
} from "@/modules/quest/services/npc-task-tools";
import { advanceTalkQuestProgress } from "@/modules/quest/services/quest-service";
import { getSafeStaticNpcWorldAttitude } from "@/modules/world/services/player-world-pressure-service";
import { NpcInteractionError, requireNpcInteraction } from "@/modules/map/services/npc-interaction";
import { normalizeNpcPortraitImageUrl } from "@/modules/shared/services/cosmetic-url";

type QuestIntent = "none" | "list" | "accept" | "complete";

type QuestIntentResult = {
  intent: QuestIntent;
  questName: string | null;
};

type NpcQuestListItem = {
  id: string;
  name: string;
  description?: string;
  questType?: "talk" | "kill" | "collect" | "detect" | "bounty";
  questCategory?: "main" | "side";
  state: string;
  reason?: string;
  hint?: string;
  minRealm?: number;
  maxRealm?: number;
  minRealmName?: string;
  maxRealmName?: string;
  bountyDailyLimit?: number;
  bountyUsedCount?: number;
  bountyRemainingCount?: number;
};

type NpcPromptConfig = {
  quickReply: string;
  questIntent: string;
  questReply: string;
  toolChat: string;
};

const SYSTEM_CONFIG_DEFAULTS = SYSTEM_CONFIG_ITEMS.reduce<Record<string, string>>((acc, item) => {
  if (item.defaultValue !== undefined) {
    acc[item.key] = item.defaultValue;
  }
  return acc;
}, {});

function resolveConfigTextValue(key: string, configMap: Record<string, string>) {
  const configValue = configMap[key];
  if (typeof configValue === "string" && configValue.trim()) {
    return configValue;
  }
  const defaultValue = SYSTEM_CONFIG_DEFAULTS[key];
  if (typeof defaultValue === "string" && defaultValue.trim()) {
    return defaultValue;
  }
  return "";
}

async function resolveNpcPromptConfig(): Promise<NpcPromptConfig> {
  const configMap = await getSystemConfigMap(NPC_PROMPT_CONFIG_KEYS);
  return {
    quickReply: resolveConfigTextValue("NPC_QUICK_REPLY_PROMPT", configMap),
    questIntent: resolveConfigTextValue("NPC_QUEST_INTENT_PROMPT", configMap),
    questReply: resolveConfigTextValue("NPC_QUEST_REPLY_PROMPT", configMap),
    toolChat: resolveConfigTextValue("NPC_TOOL_CHAT_PROMPT", configMap),
  };
}

function renderPromptTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, rawKey) => variables[rawKey] ?? "");
}

function getLinZhaoweiRule(npcName: string) {
  return npcName === "林照微"
    ? "你是林照微时，语气必须冷静、克制、证据导向，可说“我核过账册/卷宗”，但不要冗长。"
    : "语气自然，短句，别像公文。";
}

function pickJsonObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function pickJsonArray(text: string): string | null {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

function normalizeNpcPersonality(personality: string, npcName: string): string {
  const normalized = personality.trim();
  if (normalized) {
    return normalized;
  }
  return `你是${npcName}，说话自然、直接，只基于已知事实回答。`;
}

function buildNpcIdentityContext(params: {
  npcName: string;
  npcTitle: string | null;
  npcDescription: string | null;
  mapName: string | null;
  isShop: boolean;
  shopItemNames: string[];
}): string {
  const lines = [
    `姓名：${params.npcName}`,
    `头衔：${params.npcTitle || "无"}`,
    `身份描述：${params.npcDescription || "无"}`,
    `所在地点：${params.mapName || "未知地点"}`,
    `是否经营商店：${params.isShop ? "是" : "否"}`,
  ];

  if (params.isShop) {
    lines.push(`可售商品：${params.shopItemNames.length ? params.shopItemNames.join("、") : "暂无登记商品"}`);
  }

  return lines.join("\n");
}

type StaticNpcDynamicView = {
  npcRoleType: "core_anchor" | "world_service" | "roaming";
  dynamicState: string;
  availabilityState: "available" | "guarded" | "limited";
  scheduleLabel: string;
  inventoryMode: "none" | "guaranteed_base" | "world_rotation" | "gray_rotation";
  isProtectedAnchor: boolean;
  merchantType: "none" | "base_guaranteed" | "world_merchant" | "gray_market";
  stockRotationTag: string | null;
  isReplaceable: boolean;
  replacementHint: string | null;
};

function hasShadowMerchantFlavor(text: string | null | undefined) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }
  return ["黑", "灰", "暗", "巷", "客栈", "渡", "坊", "市"].some((keyword) => normalized.includes(keyword));
}

function resolveStaticNpcDynamicView(params: {
  npcName: string;
  npcTitle: string | null;
  npcDescription: string | null;
  isShop: boolean;
  questCategoryList: Array<"main" | "side" | undefined>;
  worldAttitudeLevel: "neutral" | "guarded" | "cold" | "shadow_friendly";
}) : StaticNpcDynamicView {
  const hasMainQuest = params.questCategoryList.includes("main");
  const hasSideQuest = params.questCategoryList.includes("side");
  const isProtectedAnchor = hasMainQuest || params.isShop;
  const npcRoleType: StaticNpcDynamicView["npcRoleType"] = hasMainQuest
    ? "core_anchor"
    : (params.isShop || hasSideQuest ? "world_service" : "roaming");
  const merchantType: StaticNpcDynamicView["merchantType"] = !params.isShop
    ? "none"
    : hasMainQuest
      ? "base_guaranteed"
      : (params.worldAttitudeLevel === "shadow_friendly" || hasShadowMerchantFlavor(params.npcTitle) || hasShadowMerchantFlavor(params.npcDescription))
        ? "gray_market"
        : "world_merchant";
  const inventoryMode: StaticNpcDynamicView["inventoryMode"] = !params.isShop
    ? "none"
    : merchantType === "base_guaranteed"
      ? "guaranteed_base"
      : merchantType === "gray_market"
        ? "gray_rotation"
        : "world_rotation";
  const availabilityState: StaticNpcDynamicView["availabilityState"] = params.worldAttitudeLevel === "cold"
    ? "limited"
    : params.worldAttitudeLevel === "guarded"
      ? "guarded"
      : "available";
  const hour = new Date().getHours();
  const scheduleLabel = params.isShop
    ? hour >= 7 && hour < 18
      ? "白日开铺，肯见来客"
      : hour >= 18 && hour < 23
        ? "掌灯守柜，生意渐谨慎"
        : "夜深多半收摊，只留熟客门路"
    : hasMainQuest
      ? "多半守在原处，不会让主线断掉"
      : hasSideQuest
        ? "常在附近接人办事，偶尔也会换个落脚点"
        : "行踪较活，未必每次都按老样子出现";
  const dynamicState = params.worldAttitudeLevel === "cold"
    ? `${params.npcName} 对你明显有了戒意，话与货都不会像往常那样敞开。`
    : params.worldAttitudeLevel === "guarded"
      ? `${params.npcName} 还会见你，但会先看风声再决定给多少方便。`
      : merchantType === "gray_market"
        ? `${params.npcName} 明面照常，暗里更看重来路与口风。`
        : params.isShop
          ? `${params.npcName} 仍在维持这处生意，只是货盘会随局势慢慢变。`
          : `${params.npcName} 仍在此地活动，近期还没有离场迹象。`;
  const stockRotationTag = params.isShop
    ? merchantType === "base_guaranteed"
      ? "保底货盘"
      : merchantType === "gray_market"
        ? "灰市暗货"
        : "轮换货盘"
    : null;
  const isReplaceable = params.isShop && !isProtectedAnchor && merchantType !== "base_guaranteed";
  const replacementHint = params.isShop
    ? isReplaceable
      ? "若此人失踪，日后会有新面孔接过这处买卖，但货不会原样继承。"
      : "这类商人受世界锚点保护，不会让基础交易彻底断线。"
    : null;

  return {
    npcRoleType,
    dynamicState,
    availabilityState,
    scheduleLabel,
    inventoryMode,
    isProtectedAnchor,
    merchantType,
    stockRotationTag,
    isReplaceable,
    replacementHint,
  };
}

function buildFallbackQuickReplies(quests: NpcQuestListItem[]): string[] {
  const canComplete = quests.filter((q) => q.state === "可提交");
  const canAccept = quests.filter((q) => q.state === "可接取");
  const activeTalk = quests.filter((q) => q.state === "进行中" && q.questType === "talk");

  const replies: string[] = [];

  if (canComplete.length > 0) {
    const target = canComplete[0];
    replies.push(`我要交「${target.name}」`);
  }

  if (activeTalk.length > 0) {
    const target = activeTalk[0];
    replies.push(`我来传话，关于「${target.name}」`);
  }

  if (canAccept.length > 0) {
    const target = canAccept[0];
    replies.push(`我要接「${target.name}」`);
  }

  if (!canComplete.length && !canAccept.length && !activeTalk.length) {
    replies.push("你这边现在有什么委托");
  }

  replies.push("最近有什么消息");
  replies.push("我该往哪走");
  replies.push("附近的人都在哪");

  const unique = new Set<string>();
  for (const item of replies) {
    const text = (item || "").trim();
    if (!text) continue;
    unique.add(text);
    if (unique.size >= 3) break;
  }
  return [...unique];
}

async function generateQuickReplies(params: {
  npcName: string;
  npcTitle: string | null;
  npcPersonality: string;
  quests: NpcQuestListItem[];
  quickReplyPrompt: string;
}): Promise<string[]> {
  const fallback = buildFallbackQuickReplies(params.quests);
  const flavorReplies = ["最近有什么消息", "我该往哪走", "附近的人都在哪"];
  if (!params.quests.length) {
    return fallback;
  }

  const systemPrompt = params.quickReplyPrompt;

  const userContent = JSON.stringify({
    npc: {
      name: params.npcName,
      title: params.npcTitle,
    },
    personality: params.npcPersonality,
    quests: params.quests.map((q) => ({
      name: q.name,
      description: q.description || "",
      state: q.state,
      questType: q.questType || "",
      hint: q.hint || "",
    })),
  });

  try {
    const raw = await chatCompletion(
      systemPrompt,
      [{ role: "user", content: userContent }],
      { temperature: 0.3, maxTokens: 180, scene: "npc" },
    );
    const jsonText = pickJsonArray(raw);
    if (!jsonText) {
      return fallback;
    }

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const unique = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const text = item.trim();
      if (!text) continue;
      unique.add(text.slice(0, 24));
      if (unique.size >= 3) break;
    }

    const result = [...unique];
    if (result.length >= 1) {
      if (!result.some((item) => flavorReplies.includes(item))) {
        const candidate = fallback.find((item) => flavorReplies.includes(item)) || flavorReplies[0];
        if (!result.includes(candidate)) {
          if (result.length >= 3) {
            result[result.length - 1] = candidate;
          } else {
            result.push(candidate);
          }
        }
      }
      return result;
    }

    for (const item of fallback) {
      if (result.length >= 3) break;
      if (!result.includes(item)) {
        result.push(item);
      }
    }
    return result;
  } catch {
    return fallback;
  }
}

async function generateNpcQuestReply(params: {
  npcName: string;
  npcPersonality: string;
  npcIdentityContext: string;
  worldContext: string;
  playerMessage: string;
  lastNpcMessage: string | null;
  scene:
    | "list"
    | "need_pick_accept"
    | "need_pick_complete"
    | "no_accept"
    | "no_complete"
    | "accepted"
    | "completed";
  questName?: string;
  focusedQuest?: { name: string; description?: string; hint?: string } | null;
  canAccept?: { name: string; description?: string; hint?: string }[];
  canComplete?: { name: string; description?: string; hint?: string }[];
  rewards?: { xp?: number; gold?: number };
  story?: string;
  questReplyPromptTemplate: string;
}): Promise<string> {
  const systemPrompt = renderPromptTemplate(params.questReplyPromptTemplate, {
    npcPersonality: params.npcPersonality,
    npcIdentityContext: params.npcIdentityContext,
    worldContext: params.worldContext,
    linZhaoweiRule: getLinZhaoweiRule(params.npcName),
  });

  const userContent = JSON.stringify({
    scene: params.scene,
    playerMessage: params.playerMessage,
    lastNpcMessage: params.lastNpcMessage,
    focusedQuest: params.focusedQuest || null,
    canAccept: params.canAccept || [],
    canComplete: params.canComplete || [],
    questName: params.questName || null,
    rewards: params.rewards || null,
    story: params.story || null,
  });

  try {
    const reply = await chatCompletion(
      systemPrompt,
      [{ role: "user", content: userContent }],
      { temperature: 0.45, maxTokens: 180, scene: "npc" },
    );
    return (reply || "").trim();
  } catch {
    return "";
  }
}

async function detectQuestIntent(params: {
  playerMessage: string;
  lastNpcMessage: string | null;
  quests: { name: string; state: string; hint?: string }[];
  questIntentPrompt: string;
}): Promise<QuestIntentResult> {
  const systemPrompt = params.questIntentPrompt;

  const userContent = JSON.stringify({
    playerMessage: params.playerMessage,
    lastNpcMessage: params.lastNpcMessage,
    quests: params.quests,
  });

  const raw = await chatCompletion(
    systemPrompt,
    [{ role: "user", content: userContent }],
    { temperature: 0, maxTokens: 120, scene: "npc" },
  );

  const jsonText = pickJsonObject(raw);
  if (!jsonText) return { intent: "none", questName: null };

  try {
    const parsed = JSON.parse(jsonText) as { intent?: QuestIntent; questName?: string | null };
    const intent: QuestIntent = parsed.intent && ["none", "list", "accept", "complete"].includes(parsed.intent)
      ? parsed.intent
      : "none";
    const questName = typeof parsed.questName === "string" && parsed.questName.trim()
      ? parsed.questName.trim()
      : null;
    return { intent, questName };
  } catch {
    return { intent: "none", questName: null };
  }
}

/**
 * LLM 是否已配置。未配置时 NPC 对话必须走固定化回复——
 * 否则 chatCompletion 会直接抛错，整个对话接口返回 500，玩家看到「对话失败」。
 */
async function isLlmConfigured(): Promise<boolean> {
  try {
    const map = await getSystemConfigMap(CORE_LLM_CONFIG_KEYS);
    return Boolean(String(map.LLM_API_KEY || "").trim());
  } catch {
    return false;
  }
}

/** 固定化意图识别：不依赖 LLM，按关键词判定「接任务 / 交任务」。 */
function detectStaticQuestIntent(message: string): "accept" | "complete" | null {
  const text = message.trim();
  if (!text) {
    return null;
  }
  // 「我要交『xxx』」「我要接『xxx』」是固定快捷回复的措辞，必须能命中
  const completeWords = ["完成", "交差", "复命", "办妥", "交付", "做好了", "办好了", "交任务", "我要交"];
  const acceptWords = ["接任务", "领任务", "接取", "领取", "接下", "领受", "有事吗", "有什么事", "委托", "我要接"];
  if (completeWords.some((word) => text.includes(word))) {
    return "complete";
  }
  if (acceptWords.some((word) => text.includes(word))) {
    return "accept";
  }
  return null;
}

/**
 * 无 LLM 时的固定化任务对话（「写死」的任务功能，与右侧按钮走同一条办理链路）：
 * - 玩家话里能识别为「接 / 交」意图 → 直接办理，并把结果原样回给玩家；
 * - 识别不出 → 按当前任务状态给一句固定台词，保证对话可用而非报错。
 *
 * 注意：调用方在此之前已执行 advanceTalkQuestProgress，
 * 因此传话类任务在这里也可以直接交差，不会出现「条件未达」。
 */
async function tryStaticQuestDialogue(params: {
  playerId: string;
  npcId: string;
  npcName: string;
  playerMessage: string;
}): Promise<{
  reply: string;
  events: { type: "quest.accepted" | "quest.completed"; payload: Record<string, unknown> }[];
}> {
  const events: { type: "quest.accepted" | "quest.completed"; payload: Record<string, unknown> }[] = [];
  // 用 visible 列表：悬赏会合成「悬赏板」一项，传它的 id 才能走随机接取；
  // 直接用未 visible 化的原始悬赏项 id，accept 工具会查不到。
  const questList = buildNpcQuestVisibleList(
    await buildNpcQuestActionList(params.playerId, params.npcId),
  ).quests;
  const acceptable = questList.filter((quest) => quest.state === "可接取");
  const submittable = questList.filter((quest) => quest.state === "可提交");
  const intent = detectStaticQuestIntent(params.playerMessage);

  const runQuestAction = async (action: "accept" | "complete", pool: typeof questList) => {
    // 玩家点名了任务名则按其点名办理；未点名且只有一件时直接办；多件时请其点明
    const named = pool.find((quest) => quest.name && params.playerMessage.includes(quest.name));
    const target = named || (pool.length === 1 ? pool[0] : null);
    if (!target) {
      return null;
    }
    return executeNpcToolCall({
      playerId: params.playerId,
      npcId: params.npcId,
      toolCall: {
        id: `static_${action}`,
        name: action === "accept" ? "accept_npc_quest" : "complete_npc_quest",
        arguments: JSON.stringify({ questId: target.id }),
      },
    });
  };

  if (intent === "accept" && acceptable.length > 0) {
    const executed = await runQuestAction("accept", acceptable);
    if (executed) {
      if (executed.event) {
        events.push(executed.event);
      }
      return { reply: executed.resultText, events };
    }
    return {
      reply: `我这里有几桩事：${acceptable.map((quest) => quest.name).join("、")}。你指明要哪一桩，或在右侧点选。`,
      events,
    };
  }

  if (intent === "complete" && submittable.length > 0) {
    const executed = await runQuestAction("complete", submittable);
    if (executed) {
      if (executed.event) {
        events.push(executed.event);
      }
      return { reply: executed.resultText, events };
    }
    return {
      reply: `可交差的有：${submittable.map((quest) => quest.name).join("、")}。你指明哪一桩，或在右侧点选。`,
      events,
    };
  }

  // 玩家直接说出任务名（不带动词）时，也按该任务的状态办理
  const namedSubmittable = submittable.find((quest) => quest.name && params.playerMessage.includes(quest.name));
  if (namedSubmittable) {
    const executed = await runQuestAction("complete", [namedSubmittable]);
    if (executed) {
      if (executed.event) {
        events.push(executed.event);
      }
      return { reply: executed.resultText, events };
    }
  }
  const namedAcceptable = acceptable.find((quest) => quest.name && params.playerMessage.includes(quest.name));
  if (namedAcceptable) {
    const executed = await runQuestAction("accept", [namedAcceptable]);
    if (executed) {
      if (executed.event) {
        events.push(executed.event);
      }
      return { reply: executed.resultText, events };
    }
  }

  // 无明确意图：按当前任务状态给固定台词
  if (submittable.length > 0) {
    return { reply: "既是办妥了，就在右侧点「完成」交差，或在话里说一声「交差」。", events };
  }
  if (acceptable.length > 0) {
    const names = acceptable.map((quest) => quest.name).join("、");
    return { reply: `我这里有一桩事想托付于你——${names}。在右侧点「接取」，或在话里说一声「接任务」。`, events };
  }
  return { reply: `${params.npcName}看了你一眼，未多言语。此处暂无可托付之事。`, events };
}

async function tryHandleQuestAgent(params: {
  playerId: string;
  npcId: string;
  npcName: string;
  playerMessage: string;
  lastNpcMessage: string | null;
  npcPersonality: string;
  npcIdentityContext: string;
  worldContext: string;
  promptConfig: NpcPromptConfig;
}): Promise<{
  reply: string;
  events: { type: "quest.accepted" | "quest.completed"; payload: Record<string, unknown> }[];
} | null> {
  const listExecuted = await executeNpcToolCall({
    playerId: params.playerId,
    npcId: params.npcId,
    toolCall: {
      id: "agent.list",
      name: "list_npc_quests",
      arguments: "{}",
    },
  });

  let questsList: NpcQuestListItem[] = [];
  try {
    const parsed = JSON.parse(listExecuted.resultText) as { quests?: NpcQuestListItem[] };
    questsList = parsed.quests || [];
  } catch {
    questsList = [];
  }

  if (!questsList.length) return null;

  let intentResult: QuestIntentResult;
  try {
    intentResult = await detectQuestIntent({
      playerMessage: params.playerMessage,
      lastNpcMessage: params.lastNpcMessage,
      quests: questsList.map((q) => ({ name: q.name, state: q.state, ...(q.hint ? { hint: q.hint } : {}) })),
      questIntentPrompt: params.promptConfig.questIntent,
    });
  } catch {
    return null;
  }

  const canAccept = questsList.filter((q) => q.state === "可接取");
  const canComplete = questsList.filter((q) => q.state === "可提交");
  const toBrief = (q: NpcQuestListItem) => ({
    name: q.name,
    ...(q.description ? { description: q.description } : {}),
    ...(q.hint ? { hint: q.hint } : {}),
  });

  if (intentResult.intent === "none") return null;

  if (intentResult.intent === "list") {
    const reply = await generateNpcQuestReply({
      npcName: params.npcName,
      npcPersonality: params.npcPersonality,
      npcIdentityContext: params.npcIdentityContext,
      worldContext: params.worldContext,
      playerMessage: params.playerMessage,
      lastNpcMessage: params.lastNpcMessage,
      scene: "list",
      canAccept: canAccept.map(toBrief),
      canComplete: canComplete.map(toBrief),
      questReplyPromptTemplate: params.promptConfig.questReply,
    });
    return { reply: reply || "我这儿一时也想不起有什么差事。", events: [] };
  }

  if (intentResult.intent === "accept") {
    const targetQuestName = intentResult.questName
      || (canAccept.length === 1 ? canAccept[0].name : null);

    if (!targetQuestName) {
      const scene = canAccept.length === 0 ? "no_accept" : "need_pick_accept";
      const reply = await generateNpcQuestReply({
        npcName: params.npcName,
        npcPersonality: params.npcPersonality,
        npcIdentityContext: params.npcIdentityContext,
        worldContext: params.worldContext,
        playerMessage: params.playerMessage,
        lastNpcMessage: params.lastNpcMessage,
        scene,
        canAccept: canAccept.map(toBrief),
        canComplete: canComplete.map(toBrief),
        questReplyPromptTemplate: params.promptConfig.questReply,
      });
      return { reply: reply || "你先把话说明白。", events: [] };
    }

    const executed = await executeNpcToolCall({
      playerId: params.playerId,
      npcId: params.npcId,
      toolCall: {
        id: "agent.accept",
        name: "accept_npc_quest",
        arguments: JSON.stringify({ questName: targetQuestName }),
      },
    });

    if (!executed.event) {
      return { reply: executed.resultText || "此事暂办不了。", events: [] };
    }

    const questName = (executed.event.payload.questName as string | undefined) || targetQuestName;
    const focusedQuest = questsList.find((q) => q.name === questName);
    const story = typeof executed.event.payload.story === "string"
      ? executed.event.payload.story
      : undefined;
    const reply = await generateNpcQuestReply({
      npcName: params.npcName,
      npcPersonality: params.npcPersonality,
      npcIdentityContext: params.npcIdentityContext,
      worldContext: params.worldContext,
      playerMessage: params.playerMessage,
      lastNpcMessage: params.lastNpcMessage,
      scene: "accepted",
      questName,
      focusedQuest: focusedQuest ? toBrief(focusedQuest) : null,
      story,
      questReplyPromptTemplate: params.promptConfig.questReply,
    });

    return { reply: reply || story || "成，这事就交给你了。", events: [executed.event] };
  }

  if (intentResult.intent === "complete") {
    const targetQuestName = intentResult.questName
      || (canComplete.length === 1 ? canComplete[0].name : null);

    if (!targetQuestName) {
      const scene = canComplete.length === 0 ? "no_complete" : "need_pick_complete";
      const reply = await generateNpcQuestReply({
        npcName: params.npcName,
        npcPersonality: params.npcPersonality,
        npcIdentityContext: params.npcIdentityContext,
        worldContext: params.worldContext,
        playerMessage: params.playerMessage,
        lastNpcMessage: params.lastNpcMessage,
        scene,
        canAccept: canAccept.map(toBrief),
        canComplete: canComplete.map(toBrief),
        questReplyPromptTemplate: params.promptConfig.questReply,
      });
      return { reply: reply || "你先把话说明白。", events: [] };
    }

    const executed = await executeNpcToolCall({
      playerId: params.playerId,
      npcId: params.npcId,
      toolCall: {
        id: "agent.complete",
        name: "complete_npc_quest",
        arguments: JSON.stringify({ questName: targetQuestName }),
      },
    });

    if (!executed.event) {
      return { reply: executed.resultText || "此事暂交不了。", events: [] };
    }

    const questName = (executed.event.payload.questName as string | undefined) || targetQuestName;
    const focusedQuest = questsList.find((q) => q.name === questName);
    const rewards = executed.event.payload.rewards as { xp?: number; gold?: number } | undefined;
    const story = typeof executed.event.payload.story === "string"
      ? executed.event.payload.story
      : undefined;
    const reply = await generateNpcQuestReply({
      npcName: params.npcName,
      npcPersonality: params.npcPersonality,
      npcIdentityContext: params.npcIdentityContext,
      worldContext: params.worldContext,
      playerMessage: params.playerMessage,
      lastNpcMessage: params.lastNpcMessage,
      scene: "completed",
      questName,
      focusedQuest: focusedQuest ? toBrief(focusedQuest) : null,
      rewards,
      story,
      questReplyPromptTemplate: params.promptConfig.questReply,
    });

    return { reply: reply || story || "行，这事算了。", events: [executed.event] };
  }

  return null;
}

/** GET - 获取NPC信息和对话历史 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const url = new URL(req.url);
    const includeQuickReplies = url.searchParams.get("includeQuickReplies") === "1";

    const { id: npcId } = await params;
    const npc = await requireNpcInteraction({ playerId: player.id, npcId });
    const hasPersonality = typeof npc.personality === "string" && npc.personality.trim().length > 0;

    // 无 AI 人格时，进入 NPC 页面即视为完成一次“传话”交互；
    // includeQuickReplies 的附加请求不重复推进，避免一次进入累计两次进度。
    if (!includeQuickReplies && !hasPersonality) {
      await advanceTalkQuestProgress(player.id, npcId);
    }

    // 获取对话历史（最近20条）
    const memories = await db.select().from(aiMemories)
      .where(and(eq(aiMemories.npcId, npcId), eq(aiMemories.playerId, player.id)))
      .orderBy(desc(aiMemories.createdAt))
      .limit(20)
      .all();
    const orderedMemories = [...memories].reverse();

    const npcAllQuests = await buildNpcQuestActionList(player.id, npcId);
    const visibleQuestData = buildNpcQuestVisibleList(npcAllQuests);

    // 仅展示当前可办理任务，隐藏暂不可接/进行中/已完成，避免信息过载
    const npcQuests = visibleQuestData.quests
      .filter((quest) => (
        quest.state === "可接取"
        || quest.state === "可提交"
        || (quest.id === "__bounty_board__" && quest.questType === "bounty")
      ))
      .sort((a, b) => a.name.localeCompare(b.name));

    const npcPromptConfig = includeQuickReplies ? await resolveNpcPromptConfig() : null;
    // 未接入 LLM 时直接用固定快捷回复（「我要交『xxx』」这类措辞），
    // 既省去一次必然失败的 AI 请求，也能被固定化意图识别命中。
    const llmReady = await isLlmConfigured();
    const quickReplies = includeQuickReplies && hasPersonality && npcPromptConfig
      ? (llmReady
        ? await generateQuickReplies({
          npcName: npc.name,
          npcTitle: npc.title,
          npcPersonality: npc.personality,
          quests: visibleQuestData.quests,
          quickReplyPrompt: npcPromptConfig.quickReply,
        })
        : buildFallbackQuickReplies(visibleQuestData.quests))
      : [];
    const worldAttitude = await getSafeStaticNpcWorldAttitude({
      playerId: player.id,
      npcId,
    });
    const dynamicState = resolveStaticNpcDynamicView({
      npcName: npc.name,
      npcTitle: npc.title,
      npcDescription: npc.description,
      isShop: npc.isShop,
      questCategoryList: npcAllQuests.map((quest) => quest.questCategory),
      worldAttitudeLevel: worldAttitude.level,
    });

    // 商店物品
    let shopItems = null;
    if (npc.isShop && npc.shopItems) {
      const itemDetails = await Promise.all((npc.shopItems as { itemId: string; price: number }[]).map(async (si) => {
        const item = await getItemByIdCompat(si.itemId);
        return { ...si, item };
      }));
      shopItems = itemDetails;
    }

    return NextResponse.json({
      success: true,
      data: {
        npc: {
          id: npc.id,
          name: npc.name,
          title: npc.title,
          description: npc.description,
          hasPersonality,
          isShop: npc.isShop,
          portraitImageUrl: normalizeNpcPortraitImageUrl(npc.portraitImageUrl),
        },
        messages: orderedMemories.map((m) => {
          const event = decodeNpcEvent(m.content);
          if (!event) {
            return {
              role: m.role,
              content: m.content,
              messageType: "chat",
            };
          }

          return {
            role: "assistant",
            content: m.content,
            messageType: "event",
            eventType: event.type,
            eventPayload: event.payload,
          };
        }),
        quests: npcQuests,
        quickReplies,
        shopItems,
        worldAttitude: {
          level: worldAttitude.level,
          label: worldAttitude.label,
          summary: worldAttitude.summary,
        },
        worldReactionHints: worldAttitude.worldReactionHints,
        npcRoleType: dynamicState.npcRoleType,
        dynamicState: dynamicState.dynamicState,
        availabilityState: dynamicState.availabilityState,
        scheduleLabel: dynamicState.scheduleLabel,
        inventoryMode: dynamicState.inventoryMode,
        isProtectedAnchor: dynamicState.isProtectedAnchor,
        merchantType: dynamicState.merchantType,
        stockRotationTag: dynamicState.stockRotationTag,
        isReplaceable: dynamicState.isReplaceable,
        replacementHint: dynamicState.replacementHint,
      },
    });
  } catch (e) {
    if (e instanceof NpcInteractionError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    console.error("NPC data error:", e);
    return NextResponse.json({ success: false, error: "获取NPC信息失败" }, { status: 500 });
  }
}

/** DELETE - 清空与当前 NPC 的对话记忆 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const { id: npcId } = await params;
    await requireNpcInteraction({ playerId: player.id, npcId });

    const targetRows = await db.select({ id: aiMemories.id }).from(aiMemories)
      .where(and(eq(aiMemories.npcId, npcId), eq(aiMemories.playerId, player.id)))
      .all();

    if (targetRows.length > 0) {
      await db.delete(aiMemories)
        .where(and(eq(aiMemories.npcId, npcId), eq(aiMemories.playerId, player.id)))
        .run();
    }

    return NextResponse.json({
      success: true,
      data: {
        deletedCount: targetRows.length,
      },
    });
  } catch (e) {
    if (e instanceof NpcInteractionError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    console.error("NPC memory clear error:", e);
    return NextResponse.json({ success: false, error: "清空对话记忆失败" }, { status: 500 });
  }
}

/** POST - 与NPC对话 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const { id: npcId } = await params;
    const { message: playerMessage } = await req.json();
    if (!playerMessage?.trim()) {
      return NextResponse.json({ success: false, error: "请输入消息" }, { status: 400 });
    }

    const npc = await requireNpcInteraction({ playerId: player.id, npcId });
    const hasPersonality = typeof npc.personality === "string" && npc.personality.trim().length > 0;
    if (!hasPersonality) {
      return NextResponse.json({ success: false, error: "该NPC未配置AI人格，请使用右侧任务按钮办理事务" }, { status: 400 });
    }

    const npcPersonality = normalizeNpcPersonality(npc.personality, npc.name);
    const mapRow = npc.mapId
      ? await db.select({ name: maps.name }).from(maps).where(eq(maps.id, npc.mapId)).get()
      : null;
    const shopItemIds = npc.isShop && Array.isArray(npc.shopItems)
      ? [...new Set(npc.shopItems
        .map((item) => item.itemId)
        .filter((itemId): itemId is string => typeof itemId === "string" && itemId.trim() !== ""))]
      : [];
    const shopItemRows = shopItemIds.length > 0
      ? await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, shopItemIds)).all()
      : [];
    const shopItemNameMap = new Map(shopItemRows.map((row) => [row.id, row.name]));
    const shopItemNames = shopItemIds.map((itemId) => shopItemNameMap.get(itemId)).filter(Boolean) as string[];
    const npcIdentityContext = buildNpcIdentityContext({
      npcName: npc.name,
      npcTitle: npc.title,
      npcDescription: npc.description,
      mapName: mapRow?.name || null,
      isShop: npc.isShop,
      shopItemNames,
    });

    // 获取对话历史
    const allMemories = await db.select().from(aiMemories)
      .where(and(eq(aiMemories.npcId, npcId), eq(aiMemories.playerId, player.id)))
      .orderBy(desc(aiMemories.createdAt))
      .all();
    const orderedAllMemories = [...allMemories].reverse();

    // 分离最近对话和历史摘要
    const recentMessages = orderedAllMemories
      .filter((m) => !m.content.startsWith("[历史记忆摘要]"))
      .filter((m) => !decodeNpcEvent(m.content))
      .slice(-10)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    const summarizedMemory = orderedAllMemories.find((m) => m.summary)?.summary;

    const lastNpcMessage = [...recentMessages].reverse().find((m) => m.role === "assistant")?.content || null;

    // 世界上下文（供 AI 生成台词参考）
    const worldContext = `这是一个修仙世界，玩家"${player.name}"，性别：${player.gender || "未知"}，当前境界：${player.realmName}，修为：${player.cultivationXp}。`;
    const npcPromptConfig = await resolveNpcPromptConfig();

    // 先推进传话进度，让本轮对话可见最新任务状态
    await advanceTalkQuestProgress(player.id, npcId);

    // 未接入 LLM 时走固定化任务对话，避免整个对话接口报错
    if (!(await isLlmConfigured())) {
      const staticHandled = await tryStaticQuestDialogue({
        playerId: player.id,
        npcId,
        npcName: npc.name,
        playerMessage: playerMessage.trim(),
      });

      await db.insert(aiMemories).values({
        npcId,
        playerId: player.id,
        role: "user",
        content: playerMessage.trim(),
      }).run();

      for (const event of staticHandled.events) {
        await db.insert(aiMemories).values({
          npcId,
          playerId: player.id,
          role: "assistant",
          content: encodeNpcEvent(event),
        }).run();
      }

      await db.insert(aiMemories).values({
        npcId,
        playerId: player.id,
        role: "assistant",
        content: staticHandled.reply,
      }).run();

      return NextResponse.json({
        success: true,
        data: {
          reply: staticHandled.reply,
          events: staticHandled.events,
        },
      });
    }

    const agentHandled = await tryHandleQuestAgent({
      playerId: player.id,
      npcId,
      npcName: npc.name,
      playerMessage: playerMessage.trim(),
      lastNpcMessage,
      npcPersonality,
      npcIdentityContext,
      worldContext,
      promptConfig: npcPromptConfig,
    });

    const events: { type: "quest.accepted" | "quest.completed"; payload: Record<string, unknown> }[] = [];
    let reply = "";

    if (agentHandled) {
      reply = agentHandled.reply;
      events.push(...agentHandled.events);
    } else {
      const npcPrompt = renderPromptTemplate(npcPromptConfig.toolChat, {
        npcPersonality,
        npcIdentityContext,
        worldContext,
        memorySummarySection: summarizedMemory ? `\n===== 与此修士的过往记忆摘要 =====\n${summarizedMemory}` : "",
        linZhaoweiRule: getLinZhaoweiRule(npc.name),
      }) + `

===== 办事规则 =====
你先判断来意属于：任务办理 / 打听传闻 / 问路 / 普通闲聊。
1. 任务办理优先使用任务工具，不要虚构任务状态。
2. 打听当前地图消息时，优先调用 list_map_rumors。
3. 问路时：
   - 找当前地图内 NPC，用 locate_npc。
   - 问出口、传送阵、相邻地图，用 list_map_exits。
   - 若目标不在当前地图，只能回答目标所在地图与当前能走的下一跳，不能编造全图寻路。
4. 若工具已给出事实，只能基于工具结果回答，口吻保留 NPC 人设，但不要再改写事实。
5. 普通闲聊可直接回答，但不要臆造不存在的地图、人物、任务或奖励。`;

      const toolMessages: Parameters<typeof chatCompletionWithTools>[1] = [
        ...recentMessages,
        { role: "user", content: playerMessage.trim() },
      ];

      const tools = getNpcTaskToolDefinitions();

      let aiFailed = false;

      for (let round = 0; round < 3; round++) {
        let aiTurn: Awaited<ReturnType<typeof chatCompletionWithTools>>;
        try {
          aiTurn = await chatCompletionWithTools(
            npcPrompt,
            toolMessages,
            tools,
            { temperature: 0.45, maxTokens: 220, scene: "npc" },
          );
        } catch (aiError) {
          // LLM 不可用（超时 / 限流 / 服务故障）时不要再抛 500，改为降级到固定化任务对话
          console.error(
            "[npc] LLM 调用失败，降级固定化对话：",
            aiError instanceof Error ? aiError.message : String(aiError),
          );
          aiFailed = true;
          break;
        }

        if (!aiTurn.toolCalls.length) {
          reply = aiTurn.content || "此事且待片刻，你可换种说法再问我。";
          break;
        }

        toolMessages.push({
          role: "assistant",
          content: aiTurn.content || "",
          toolCalls: aiTurn.toolCalls,
        });

        for (const toolCall of aiTurn.toolCalls) {
          const executed = await executeNpcToolCall({
            playerId: player.id,
            npcId,
            toolCall,
          });

          toolMessages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: executed.resultText,
          });

          if (executed.event) {
            events.push(executed.event);
          }
        }
      }

      // LLM 不可用：用固定化任务对话兜底，玩家仍可正常办任务
      if (aiFailed) {
        const fallback = await tryStaticQuestDialogue({
          playerId: player.id,
          npcId,
          npcName: npc.name,
          playerMessage: playerMessage.trim(),
        });
        reply = fallback.reply;
        events.push(...fallback.events);
      }
    }

    if (!reply) {
      reply = events.length > 0
        ? "此事已办妥。若还要办别的，直说。"
        : "此事且待片刻，你可换种说法再问我。";
    }

    // 存储对话记忆
    await db.insert(aiMemories).values({
      npcId, playerId: player.id, role: "user", content: playerMessage.trim(),
    }).run();

    for (const event of events) {
      await db.insert(aiMemories).values({
        npcId,
        playerId: player.id,
        role: "assistant",
        content: encodeNpcEvent(event),
      }).run();
    }

    await db.insert(aiMemories).values({
      npcId, playerId: player.id, role: "assistant", content: reply,
    }).run();

    // 检查是否需要压缩历史（超过20条时压缩）
    const totalCount = (await db.select().from(aiMemories)
      .where(and(eq(aiMemories.npcId, npcId), eq(aiMemories.playerId, player.id)))
      .all()).length;

    if (totalCount > 20) {
      try {
        const oldMessages = await db.select().from(aiMemories)
          .where(and(eq(aiMemories.npcId, npcId), eq(aiMemories.playerId, player.id)))
          .orderBy(aiMemories.createdAt)
          .limit(totalCount - 10)
          .all();

        const summary = await summarizeConversation(
          npc.name,
          oldMessages.map((m) => ({ role: m.role, content: m.content }))
        );

        // 删除旧记录，保留最近10条
        for (const m of oldMessages) {
          await db.delete(aiMemories).where(eq(aiMemories.id, m.id)).run();
        }

        // 插入摘要记录
        await db.insert(aiMemories).values({
          npcId, playerId: player.id, role: "assistant",
          content: `[历史记忆摘要] ${summary}`,
          summary,
        }).run();
      } catch (e) {
        console.error("Memory compression error:", e);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        reply,
        events,
      },
    });
  } catch (e) {
    if (e instanceof NpcInteractionError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    console.error("NPC chat error:", e);
    return NextResponse.json({ success: false, error: "对话失败" }, { status: 500 });
  }
}
