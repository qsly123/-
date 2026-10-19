import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { maps, monsters, npcs, playerMapEventSessions, randomEvents } from "@/db/schema";
import { chatCompletion, narrateEvent, narrateEventWithVariables } from "@/modules/ai/services/ai";
import {
  applyRandomEventRewards,
  collectRandomEventActionVariableKeys,
  pickRandomEventImageUrl,
  type RandomEventRewardInput,
  type RandomEventRewardView,
} from "@/modules/map/services/random-event-service";
import { collectDoubleCultivationRandomEventVariableOptions } from "@/modules/world/services/double-cultivation-random-event";
import { SYSTEM_CONFIG_ITEMS } from "@/modules/system/services/system-config-keys";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import type {
  MapEncounterChoiceView,
  MapEncounterSessionView,
  MapEncounterStageView,
  RandomEventEncounterMode,
} from "@/types/game";

const ENCOUNTER_CHAIN_PROMPT_KEY = "WORLD_FLAVOR_ENCOUNTER_CHAIN_PROMPT";
const ENCOUNTER_IDLE_EXPIRE_MS = 15 * 60 * 1000;

type RandomEventRow = typeof randomEvents.$inferSelect;
type SessionRow = typeof playerMapEventSessions.$inferSelect;

type EncounterChoicePayload = {
  id: string;
  label: string;
  tag?: string | null;
  tone?: string | null;
};

type EncounterStagePayload = {
  title: string;
  narrative: string;
  choices: EncounterChoicePayload[];
};

type EncounterFinalEventPayload = {
  name: string;
  type: string;
  narrative: string;
  imageUrl?: string | null;
  rewards?: RandomEventRewardView | null;
};

type EncounterSessionPayload = {
  version: 1;
  mapId: string;
  mapName: string;
  eventName: string;
  eventType: string;
  title: string;
  summary: string;
  imageUrl?: string | null;
  stages: EncounterStagePayload[];
  finalEvent?: EncounterFinalEventPayload | null;
};

type EncounterSelectedPathEntry = {
  stageIndex: number;
  choiceId: string;
  label: string;
  tag?: string | null;
};

function isMissingRelationError(error: unknown, relationName: string) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : null;
  const code = cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" && message.includes(relationName);
}

function createEncounterMigrationError() {
  return new Error("链式奇遇功能尚未完成数据库迁移，请先执行 0057 号迁移后再试");
}

export interface EncounterResolveResult {
  encounterSession: MapEncounterSessionView;
  stage?: MapEncounterStageView;
  finalEvent?: EncounterFinalEventPayload | null;
  sessionStatus: "active" | "completed" | "expired";
}

function getPromptDefault(key: string) {
  return SYSTEM_CONFIG_ITEMS.find((item) => item.key === key)?.defaultValue?.trim() || "";
}

async function getEncounterChainPrompt() {
  const configured = await getSystemConfigValue(ENCOUNTER_CHAIN_PROMPT_KEY);
  return configured?.trim() || getPromptDefault(ENCOUNTER_CHAIN_PROMPT_KEY);
}

function pickJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "";
}

function trimText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getExpireAt(now = Date.now()) {
  return new Date(now + ENCOUNTER_IDLE_EXPIRE_MS).toISOString();
}

function normalizeEncounterMode(value: unknown): RandomEventEncounterMode {
  return value === "chain" ? "chain" : "single";
}

function parseSessionPayload(value: unknown): EncounterSessionPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const stages = Array.isArray(payload.stages)
    ? payload.stages
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => {
        const entry = item as Record<string, unknown>;
        const choices = Array.isArray(entry.choices)
          ? entry.choices
            .filter((choice) => choice && typeof choice === "object" && !Array.isArray(choice))
            .map((choice, index) => {
              const choiceEntry = choice as Record<string, unknown>;
              return {
                id: trimText(choiceEntry.id, `choice_${index + 1}`),
                label: trimText(choiceEntry.label, `抉择${index + 1}`),
                tag: trimText(choiceEntry.tag) || null,
                tone: trimText(choiceEntry.tone) || null,
              };
            })
            .filter((choice) => choice.label)
          : [];
        return {
          title: trimText(entry.title, "奇遇一幕"),
          narrative: trimText(entry.narrative),
          choices,
        } satisfies EncounterStagePayload;
      })
      .filter((stage) => stage.narrative && stage.choices.length > 0)
    : [];

  if (stages.length < 2) {
    return null;
  }

  const finalEventRaw = payload.finalEvent;
  const finalEvent = finalEventRaw && typeof finalEventRaw === "object" && !Array.isArray(finalEventRaw)
    ? {
      name: trimText((finalEventRaw as Record<string, unknown>).name, trimText(payload.eventName, "奇遇后续")),
      type: trimText((finalEventRaw as Record<string, unknown>).type, trimText(payload.eventType, "encounter")),
      narrative: trimText((finalEventRaw as Record<string, unknown>).narrative, "此番奇遇，至此收束。"),
      imageUrl: trimText((finalEventRaw as Record<string, unknown>).imageUrl) || null,
      rewards: ((finalEventRaw as Record<string, unknown>).rewards || null) as RandomEventRewardView | null,
    } satisfies EncounterFinalEventPayload
    : null;

  return {
    version: 1,
    mapId: trimText(payload.mapId),
    mapName: trimText(payload.mapName, "此地"),
    eventName: trimText(payload.eventName, "无名奇遇"),
    eventType: trimText(payload.eventType, "encounter"),
    title: trimText(payload.title, trimText(payload.eventName, "无名奇遇")),
    summary: trimText(payload.summary),
    imageUrl: trimText(payload.imageUrl) || null,
    stages,
    finalEvent,
  };
}

function parseSelectedPath(value: unknown): EncounterSelectedPathEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        stageIndex: clampInteger(entry.stageIndex, 0, 99, 0),
        choiceId: trimText(entry.choiceId),
        label: trimText(entry.label, "未名抉择"),
        tag: trimText(entry.tag) || null,
      } satisfies EncounterSelectedPathEntry;
    })
    .filter((item) => item.choiceId);
}

function buildFallbackStages(params: {
  eventName: string;
  mapName: string;
  eventDescription: string;
  stageCount: number;
  choiceCount: number;
}) {
  const stageTemplates = [
    {
      title: "异兆初起",
      narrative: `${params.mapName}里忽有异响传来，${params.eventDescription || `你撞见了「${params.eventName}」的前兆`}。气机尚未明朗，却已逼得人必须尽快拿定主意。`,
    },
    {
      title: "局势翻涌",
      narrative: "你顺着异动再探一步，眼前局势愈发清楚。退一步可保稳妥，进一步则可能撞上更大的因果。",
    },
    {
      title: "尘埃未定",
      narrative: "风声、脚步、灵压都在这一刻汇到一处。你已站在奇遇尽头前，只差最后一念。",
    },
    {
      title: "尾声将落",
      narrative: "前路已显，余波仍在翻腾。只要再做最后的选择，这桩奇遇便会真正落定。",
    },
  ];
  const choiceLabels = [
    ["循迹上前", "先稳一步", "借势而行"],
    ["暗中试探", "亮明来意", "顺着风声走"],
    ["收束气机", "放手一搏", "记下这笔因果"],
  ];

  return Array.from({ length: params.stageCount }, (_, index) => {
    const template = stageTemplates[index] || stageTemplates[stageTemplates.length - 1];
    const labelSet = choiceLabels[index] || choiceLabels[choiceLabels.length - 1];
    const choices = Array.from({ length: params.choiceCount }, (__unused, choiceIndex) => ({
      id: `choice_${index + 1}_${choiceIndex + 1}`,
      label: labelSet[choiceIndex] || `取向${choiceIndex + 1}`,
      tag: choiceIndex === 0 ? "谨慎" : choiceIndex === 1 ? "果决" : "借势",
      tone: choiceIndex === 0 ? "稳" : choiceIndex === 1 ? "烈" : "奇",
    }));
    return {
      title: template.title,
      narrative: template.narrative,
      choices,
    } satisfies EncounterStagePayload;
  });
}

function sanitizeStageChoices(input: unknown, stageIndex: number, choiceCount: number): EncounterChoicePayload[] {
  const rawChoices = Array.isArray(input) ? input : [];
  const normalized = rawChoices
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, choiceCount)
    .map((item, choiceIndex) => {
      const entry = item as Record<string, unknown>;
      return {
        id: trimText(entry.id, `choice_${stageIndex + 1}_${choiceIndex + 1}`),
        label: trimText(entry.label, `抉择${choiceIndex + 1}`),
        tag: trimText(entry.tag) || null,
        tone: trimText(entry.tone) || null,
      } satisfies EncounterChoicePayload;
    })
    .filter((choice) => choice.label);

  if (normalized.length >= choiceCount) {
    return normalized.slice(0, choiceCount);
  }

  const fallback = buildFallbackStages({
    eventName: "无名奇遇",
    mapName: "此地",
    eventDescription: "",
    stageCount: stageIndex + 1,
    choiceCount,
  })[stageIndex]?.choices || [];

  return fallback.slice(0, choiceCount).map((choice, choiceIndex) => normalized[choiceIndex] || choice);
}

function sanitizeChainPayload(params: {
  parsed: Record<string, unknown> | null;
  eventName: string;
  eventType: string;
  mapId: string;
  mapName: string;
  imageUrl?: string | null;
  stageCount: number;
  choiceCount: number;
  eventDescription: string;
}): EncounterSessionPayload {
  const fallbackStages = buildFallbackStages({
    eventName: params.eventName,
    mapName: params.mapName,
    eventDescription: params.eventDescription,
    stageCount: params.stageCount,
    choiceCount: params.choiceCount,
  });
  if (!params.parsed) {
    return {
      version: 1,
      mapId: params.mapId,
      mapName: params.mapName,
      eventName: params.eventName,
      eventType: params.eventType,
      title: params.eventName,
      summary: params.eventDescription || `${params.eventName}在${params.mapName}渐次展开。`,
      imageUrl: params.imageUrl || null,
      stages: fallbackStages,
      finalEvent: null,
    };
  }

  const rawStages = Array.isArray(params.parsed.stages) ? params.parsed.stages : [];
  const stages = rawStages
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, params.stageCount)
    .map((item, stageIndex) => {
      const entry = item as Record<string, unknown>;
      return {
        title: trimText(entry.title, fallbackStages[stageIndex]?.title || `第${stageIndex + 1}段`),
        narrative: trimText(entry.narrative, fallbackStages[stageIndex]?.narrative || "前路未明。"),
        choices: sanitizeStageChoices(entry.choices, stageIndex, params.choiceCount),
      } satisfies EncounterStagePayload;
    })
    .filter((stage) => stage.narrative && stage.choices.length >= params.choiceCount);

  const finalStages = stages.length >= params.stageCount
    ? stages
    : fallbackStages.map((stage, index) => stages[index] || stage);

  return {
    version: 1,
    mapId: params.mapId,
    mapName: params.mapName,
    eventName: params.eventName,
    eventType: params.eventType,
    title: trimText(params.parsed.title, params.eventName),
    summary: trimText(params.parsed.summary, params.eventDescription || `${params.eventName}在${params.mapName}渐次展开。`),
    imageUrl: params.imageUrl || null,
    stages: finalStages,
    finalEvent: null,
  };
}

async function generateEncounterChainPayload(params: {
  eventRow: RandomEventRow;
  mapId: string;
  mapName: string;
  playerRealmName: string;
  stageCount: number;
  choiceCount: number;
}) {
  const npcRows = await db.select({ name: npcs.name }).from(npcs).where(eq(npcs.mapId, params.mapId)).limit(6).all();
  const monsterRows = await db.select({ name: monsters.name }).from(monsters).where(eq(monsters.mapId, params.mapId)).limit(6).all();
  const imageUrl = pickRandomEventImageUrl(params.eventRow.imageUrls);

  try {
    const prompt = await getEncounterChainPrompt();
    const raw = await chatCompletion(
      prompt,
      [{
        role: "user",
        content: JSON.stringify({
          eventName: params.eventRow.name,
          eventType: params.eventRow.eventType,
          mapName: params.mapName,
          playerRealm: params.playerRealmName,
          eventDescription: trimText(params.eventRow.description),
          eventPrompt: trimText(params.eventRow.aiPrompt),
          npcNames: npcRows.map((row) => row.name).filter(Boolean),
          monsterNames: monsterRows.map((row) => row.name).filter(Boolean),
          stageCount: params.stageCount,
          choiceCount: params.choiceCount,
        }),
      }],
      { temperature: 0.5, maxTokens: 900, scene: "worldFlavor" },
    );
    const jsonText = pickJsonObject(raw);
    const parsed = jsonText
      ? JSON.parse(jsonText) as Record<string, unknown>
      : null;
    return sanitizeChainPayload({
      parsed,
      eventName: params.eventRow.name,
      eventType: params.eventRow.eventType,
      mapId: params.mapId,
      mapName: params.mapName,
      imageUrl,
      stageCount: params.stageCount,
      choiceCount: params.choiceCount,
      eventDescription: trimText(params.eventRow.description),
    });
  } catch {
    return sanitizeChainPayload({
      parsed: null,
      eventName: params.eventRow.name,
      eventType: params.eventRow.eventType,
      mapId: params.mapId,
      mapName: params.mapName,
      imageUrl,
      stageCount: params.stageCount,
      choiceCount: params.choiceCount,
      eventDescription: trimText(params.eventRow.description),
    });
  }
}

function buildEncounterSessionView(params: {
  sessionId: string;
  eventId: string;
  eventName: string;
  eventType: string;
  status: "active" | "completed" | "expired";
  currentStageIndex: number;
  totalStages: number;
  expiresAt: string;
  selectedPath: EncounterSelectedPathEntry[];
}): MapEncounterSessionView {
  return {
    sessionId: params.sessionId,
    eventId: params.eventId,
    eventName: params.eventName,
    eventType: params.eventType,
    status: params.status,
    currentStageIndex: params.currentStageIndex,
    totalStages: params.totalStages,
    expiresAt: params.expiresAt,
    selectedPath: params.selectedPath.map((item) => ({
      stageIndex: item.stageIndex,
      choiceId: item.choiceId,
      label: item.label,
      tag: item.tag || null,
    })),
  };
}

function buildPathSummary(selectedPath: EncounterSelectedPathEntry[]) {
  return selectedPath.map((item) => item.tag || item.label);
}

function buildStageNarrative(stage: EncounterStagePayload, selectedPath: EncounterSelectedPathEntry[]) {
  if (selectedPath.length === 0) {
    return stage.narrative;
  }
  const summary = buildPathSummary(selectedPath).join("、");
  return `此前你一路选择了${summary}。\n\n${stage.narrative}`;
}

function buildStageView(params: {
  sessionId: string;
  currentStageIndex: number;
  payload: EncounterSessionPayload;
  selectedPath: EncounterSelectedPathEntry[];
}): MapEncounterStageView | undefined {
  const stage = params.payload.stages[params.currentStageIndex];
  if (!stage) {
    return undefined;
  }
  return {
    sessionId: params.sessionId,
    stageIndex: params.currentStageIndex,
    stageNumber: params.currentStageIndex + 1,
    totalStages: params.payload.stages.length,
    title: stage.title,
    narrative: buildStageNarrative(stage, params.selectedPath),
    imageUrl: params.payload.imageUrl || null,
    choices: stage.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      tag: choice.tag || null,
      tone: choice.tone || null,
    })) satisfies MapEncounterChoiceView[],
    pathSummary: buildPathSummary(params.selectedPath),
    isFinalStage: params.currentStageIndex >= params.payload.stages.length - 1,
  };
}

async function markExpiredSession(row: SessionRow) {
  await db.update(playerMapEventSessions).set({
    status: "expired",
    updatedAt: new Date().toISOString(),
  }).where(eq(playerMapEventSessions.id, row.id)).run();
}

function isSessionOnCurrentMap(payload: EncounterSessionPayload | null, currentMapId: string | null | undefined) {
  if (!currentMapId) {
    return true;
  }
  return Boolean(payload && payload.mapId === currentMapId);
}

function resolveSessionStatus(row: SessionRow): "active" | "completed" | "expired" {
  if (row.status === "completed") {
    return "completed";
  }
  if (row.status === "expired") {
    return "expired";
  }
  return "active";
}

function buildFallbackFinalNarrative(params: {
  eventName: string;
  eventDescription: string;
  selectedPath: EncounterSelectedPathEntry[];
}) {
  const pathText = buildPathSummary(params.selectedPath).join("、");
  if (pathText) {
    return `${params.eventDescription || `「${params.eventName}」终于有了结果`}。你这一路走的是${pathText}的路子，这份因果也因此落在了你身上。`;
  }
  return params.eventDescription || `「${params.eventName}」至此落幕。`;
}

async function resolveChainFinalEvent(params: {
  playerId: string;
  playerName: string;
  playerRealmName: string;
  eventRow: RandomEventRow;
  sessionId: string;
  payload: EncounterSessionPayload;
  selectedPath: EncounterSelectedPathEntry[];
}): Promise<EncounterFinalEventPayload> {
  const rewards = params.eventRow.rewards as RandomEventRewardInput | null;
  const pathSummaryText = buildPathSummary(params.selectedPath).join("、");
  const fallbackNarrative = buildFallbackFinalNarrative({
    eventName: params.eventRow.name,
    eventDescription: trimText(params.eventRow.description),
    selectedPath: params.selectedPath,
  });
  const actionVariableKeys = collectRandomEventActionVariableKeys(rewards);

  let narrative = fallbackNarrative;
  let aiVariables: Record<string, string> | null = null;

  if (trimText(params.eventRow.aiPrompt) && actionVariableKeys.length > 0) {
    const actionVariableResult = await collectDoubleCultivationRandomEventVariableOptions({
      playerId: params.playerId,
      actions: rewards?.actions || [],
    });
    const actionVariableOptions = actionVariableResult.variables;
    const actionVariableMeta = actionVariableResult.variableMeta;
    const constraintsText = actionVariableKeys.map((key) => {
      const values = actionVariableOptions[key];
      if (Array.isArray(values) && values.length > 0) {
        return `变量 {{${key}}} 候选：${values.join("、")}（必须原样输出）`;
      }
      return `变量 {{${key}}}：请返回可用于动作执行的值`;
    }).join("\n");
    const promptHints = actionVariableKeys
      .map((key) => trimText(actionVariableMeta[key]?.promptHint))
      .filter(Boolean);
    const promptWithVariables = `${params.eventRow.aiPrompt}

【行过之路】
${pathSummaryText || "未留下明确路径"}。

【变量约束】
你必须在 variables 中返回这些变量：${actionVariableKeys.join(", ")}。
${constraintsText}${promptHints.length > 0 ? `\n【动作补充约束】\n${promptHints.join("\n")}` : ""}`;
    const aiResult = await narrateEventWithVariables({
      eventPrompt: promptWithVariables,
      playerName: params.playerName || "无名修士",
      playerRealm: params.playerRealmName,
      variableKeys: actionVariableKeys,
    });
    for (const variableKey of actionVariableKeys) {
      const targetValue = trimText(aiResult.variables[variableKey]);
      if (!targetValue) {
        throw new Error(`AI 变量 {{${variableKey}}} 不能为空`);
      }
      const candidates = actionVariableOptions[variableKey];
      if (Array.isArray(candidates) && candidates.length > 0 && !new Set(candidates).has(targetValue)) {
        throw new Error(`AI 变量 {{${variableKey}}} 不在候选范围内`);
      }
    }
    narrative = trimText(aiResult.narrative, fallbackNarrative);
    aiVariables = aiResult.variables;
  } else if (trimText(params.eventRow.aiPrompt)) {
    try {
      narrative = trimText(await narrateEvent(
        `${params.eventRow.aiPrompt}\n\n【行过之路】\n${pathSummaryText || "未留下明确路径"}`,
        params.playerName || "无名修士",
        params.playerRealmName,
      ), fallbackNarrative);
    } catch {
      narrative = fallbackNarrative;
    }
  }

  const rewardsWithName = await applyRandomEventRewards({
    playerId: params.playerId,
    rewards,
    sourceRef: params.sessionId,
    aiVariables,
  });

  return {
    name: params.eventRow.name,
    type: params.eventRow.eventType,
    narrative,
    imageUrl: params.payload.imageUrl || null,
    rewards: rewardsWithName,
  };
}

async function getSessionRowById(playerId: string, sessionId: string) {
  try {
    return await db.select().from(playerMapEventSessions).where(and(
      eq(playerMapEventSessions.id, sessionId),
      eq(playerMapEventSessions.playerId, playerId),
    )).get();
  } catch (error) {
    if (isMissingRelationError(error, "player_map_event_sessions")) {
      throw createEncounterMigrationError();
    }
    throw error;
  }
}

async function getEventRowById(eventId: string) {
  return db.select().from(randomEvents).where(eq(randomEvents.id, eventId)).get();
}

export async function getActiveEncounterSessionForPlayer(
  playerId: string,
  currentMapId: string | null = null,
): Promise<EncounterResolveResult | null> {
  let row: SessionRow | undefined;
  try {
    row = await db.select().from(playerMapEventSessions)
      .where(and(
        eq(playerMapEventSessions.playerId, playerId),
        eq(playerMapEventSessions.status, "active"),
      ))
      .orderBy(desc(playerMapEventSessions.updatedAt))
      .limit(1)
      .get();
  } catch (error) {
    if (isMissingRelationError(error, "player_map_event_sessions")) {
      return null;
    }
    throw error;
  }
  if (!row) {
    return null;
  }
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await markExpiredSession(row);
    return {
      encounterSession: buildEncounterSessionView({
        sessionId: row.id,
        eventId: row.eventId,
        eventName: "奇遇已散",
        eventType: "encounter",
        status: "expired",
        currentStageIndex: row.currentStageIndex,
        totalStages: 0,
        expiresAt: row.expiresAt,
        selectedPath: parseSelectedPath(row.selectedPathJson),
      }),
      sessionStatus: "expired",
    };
  }

  const payload = parseSessionPayload(row.sessionPayloadJson);
  if (!payload) {
    return null;
  }
  if (!isSessionOnCurrentMap(payload, currentMapId)) {
    await markExpiredSession(row);
    return null;
  }
  const selectedPath = parseSelectedPath(row.selectedPathJson);
  return {
    encounterSession: buildEncounterSessionView({
      sessionId: row.id,
      eventId: row.eventId,
      eventName: payload.eventName,
      eventType: payload.eventType,
      status: "active",
      currentStageIndex: row.currentStageIndex,
      totalStages: payload.stages.length,
      expiresAt: row.expiresAt,
      selectedPath,
    }),
    stage: buildStageView({
      sessionId: row.id,
      currentStageIndex: row.currentStageIndex,
      payload,
      selectedPath,
    }),
    sessionStatus: "active",
  };
}

export async function hasRestorableEncounterSessionForEvent(params: {
  playerId: string;
  eventId: string;
  currentMapId: string | null;
}) {
  let row: SessionRow | undefined;
  try {
    row = await db.select().from(playerMapEventSessions).where(and(
      eq(playerMapEventSessions.playerId, params.playerId),
      eq(playerMapEventSessions.eventId, params.eventId),
      eq(playerMapEventSessions.status, "active"),
    ))
      .orderBy(desc(playerMapEventSessions.updatedAt))
      .limit(1)
      .get();
  } catch (error) {
    if (isMissingRelationError(error, "player_map_event_sessions")) {
      return false;
    }
    throw error;
  }

  if (!row) {
    return false;
  }
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await markExpiredSession(row);
    return false;
  }

  const payload = parseSessionPayload(row.sessionPayloadJson);
  if (!isSessionOnCurrentMap(payload, params.currentMapId)) {
    await markExpiredSession(row);
    return false;
  }

  return true;
}

export async function createOrRestoreEncounterSession(params: {
  playerId: string;
  playerName: string;
  playerRealmName: string;
  currentMapId: string | null;
  eventRow: RandomEventRow;
}): Promise<EncounterResolveResult> {
  let existing: SessionRow | undefined;
  try {
    existing = await db.select().from(playerMapEventSessions).where(and(
      eq(playerMapEventSessions.playerId, params.playerId),
      eq(playerMapEventSessions.eventId, params.eventRow.id),
      eq(playerMapEventSessions.status, "active"),
    ))
      .orderBy(desc(playerMapEventSessions.updatedAt))
      .limit(1)
      .get();
  } catch (error) {
    if (isMissingRelationError(error, "player_map_event_sessions")) {
      throw createEncounterMigrationError();
    }
    throw error;
  }

  if (existing) {
    if (Date.parse(existing.expiresAt) <= Date.now()) {
      await markExpiredSession(existing);
    } else {
      const payload = parseSessionPayload(existing.sessionPayloadJson);
      if (payload && isSessionOnCurrentMap(payload, params.currentMapId)) {
        const nextExpireAt = getExpireAt();
        await db.update(playerMapEventSessions).set({
          expiresAt: nextExpireAt,
          updatedAt: new Date().toISOString(),
        }).where(eq(playerMapEventSessions.id, existing.id)).run();
        const selectedPath = parseSelectedPath(existing.selectedPathJson);
        return {
          encounterSession: buildEncounterSessionView({
            sessionId: existing.id,
            eventId: existing.eventId,
            eventName: payload.eventName,
            eventType: payload.eventType,
            status: "active",
            currentStageIndex: existing.currentStageIndex,
            totalStages: payload.stages.length,
            expiresAt: nextExpireAt,
            selectedPath,
          }),
          stage: buildStageView({
            sessionId: existing.id,
            currentStageIndex: existing.currentStageIndex,
            payload,
            selectedPath,
          }),
          sessionStatus: "active",
        };
      }
      await markExpiredSession(existing);
    }
  }

  const mapId = trimText(params.currentMapId, params.eventRow.mapIds?.[0] || "");
  const mapRow = mapId
    ? await db.select({ id: maps.id, name: maps.name }).from(maps).where(eq(maps.id, mapId)).get()
    : null;
  const stageCount = clampInteger(params.eventRow.encounterStageCount, 2, 4, 3);
  const choiceCount = clampInteger(params.eventRow.encounterChoiceCount, 2, 3, 2);
  const payload = await generateEncounterChainPayload({
    eventRow: params.eventRow,
    mapId: mapRow?.id || mapId || "unknown_map",
    mapName: mapRow?.name || "此地",
    playerRealmName: params.playerRealmName,
    stageCount,
    choiceCount,
  });
  const nowIso = new Date().toISOString();
  const expiresAt = getExpireAt();
  const inserted = await db.insert(playerMapEventSessions).values({
    playerId: params.playerId,
    eventId: params.eventRow.id,
    status: "active",
    currentStageIndex: 0,
    sessionPayloadJson: payload,
    selectedPathJson: [],
    expiresAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).returning({ id: playerMapEventSessions.id }).get();

  const sessionId = inserted?.id || "";
  return {
    encounterSession: buildEncounterSessionView({
      sessionId,
      eventId: params.eventRow.id,
      eventName: payload.eventName,
      eventType: payload.eventType,
      status: "active",
      currentStageIndex: 0,
      totalStages: payload.stages.length,
      expiresAt,
      selectedPath: [],
    }),
    stage: buildStageView({
      sessionId,
      currentStageIndex: 0,
      payload,
      selectedPath: [],
    }),
    sessionStatus: "active",
  };
}

export async function advanceEncounterSession(params: {
  playerId: string;
  playerName: string;
  playerRealmName: string;
  currentMapId: string | null;
  sessionId: string;
  choiceId: string;
}): Promise<EncounterResolveResult> {
  const row = await getSessionRowById(params.playerId, params.sessionId);
  if (!row) {
    throw new Error("奇遇会话不存在");
  }

  const payload = parseSessionPayload(row.sessionPayloadJson);
  if (!payload) {
    throw new Error("奇遇会话数据已损坏");
  }
  if (!isSessionOnCurrentMap(payload, params.currentMapId)) {
    await markExpiredSession(row);
    return {
      encounterSession: buildEncounterSessionView({
        sessionId: row.id,
        eventId: row.eventId,
        eventName: payload.eventName,
        eventType: payload.eventType,
        status: "expired",
        currentStageIndex: row.currentStageIndex,
        totalStages: payload.stages.length,
        expiresAt: row.expiresAt,
        selectedPath: parseSelectedPath(row.selectedPathJson),
      }),
      sessionStatus: "expired",
    };
  }
  if (row.status === "completing") {
    throw new Error("奇遇正在结算，请稍候再试");
  }

  const selectedPath = parseSelectedPath(row.selectedPathJson);
  const currentStatus = resolveSessionStatus(row);
  if (currentStatus === "completed") {
    return {
      encounterSession: buildEncounterSessionView({
        sessionId: row.id,
        eventId: row.eventId,
        eventName: payload.eventName,
        eventType: payload.eventType,
        status: "completed",
        currentStageIndex: row.currentStageIndex,
        totalStages: payload.stages.length,
        expiresAt: row.expiresAt,
        selectedPath,
      }),
      finalEvent: payload.finalEvent || null,
      sessionStatus: "completed",
    };
  }

  if (Date.parse(row.expiresAt) <= Date.now()) {
    await markExpiredSession(row);
    return {
      encounterSession: buildEncounterSessionView({
        sessionId: row.id,
        eventId: row.eventId,
        eventName: payload.eventName,
        eventType: payload.eventType,
        status: "expired",
        currentStageIndex: row.currentStageIndex,
        totalStages: payload.stages.length,
        expiresAt: row.expiresAt,
        selectedPath,
      }),
      sessionStatus: "expired",
    };
  }

  const repeatedChoice = selectedPath[selectedPath.length - 1];
  if (repeatedChoice && repeatedChoice.choiceId === params.choiceId && repeatedChoice.stageIndex === row.currentStageIndex - 1) {
    return {
      encounterSession: buildEncounterSessionView({
        sessionId: row.id,
        eventId: row.eventId,
        eventName: payload.eventName,
        eventType: payload.eventType,
        status: "active",
        currentStageIndex: row.currentStageIndex,
        totalStages: payload.stages.length,
        expiresAt: row.expiresAt,
        selectedPath,
      }),
      stage: buildStageView({
        sessionId: row.id,
        currentStageIndex: row.currentStageIndex,
        payload,
        selectedPath,
      }),
      sessionStatus: "active",
    };
  }

  const currentStage = payload.stages[row.currentStageIndex];
  if (!currentStage) {
    throw new Error("奇遇阶段不存在");
  }

  const selectedChoice = currentStage.choices.find((choice) => choice.id === params.choiceId);
  if (!selectedChoice) {
    throw new Error("所选奇遇分支不存在");
  }

  const nextSelectedPath = [
    ...selectedPath,
    {
      stageIndex: row.currentStageIndex,
      choiceId: selectedChoice.id,
      label: selectedChoice.label,
      tag: selectedChoice.tag || null,
    } satisfies EncounterSelectedPathEntry,
  ];
  const nowIso = new Date().toISOString();
  const expiresAt = getExpireAt();

  if (row.currentStageIndex >= payload.stages.length - 1) {
    const locking = await db.update(playerMapEventSessions).set({
      status: "completing",
      selectedPathJson: nextSelectedPath,
      updatedAt: nowIso,
      expiresAt,
    }).where(and(
      eq(playerMapEventSessions.id, row.id),
      eq(playerMapEventSessions.playerId, params.playerId),
      eq(playerMapEventSessions.status, "active"),
    )).returning({ id: playerMapEventSessions.id }).get();

    if (!locking) {
      const latest = await getSessionRowById(params.playerId, params.sessionId);
      if (latest) {
        const latestPayload = parseSessionPayload(latest.sessionPayloadJson);
        if (latestPayload?.finalEvent) {
          return {
            encounterSession: buildEncounterSessionView({
              sessionId: latest.id,
              eventId: latest.eventId,
              eventName: latestPayload.eventName,
              eventType: latestPayload.eventType,
              status: resolveSessionStatus(latest),
              currentStageIndex: latest.currentStageIndex,
              totalStages: latestPayload.stages.length,
              expiresAt: latest.expiresAt,
              selectedPath: parseSelectedPath(latest.selectedPathJson),
            }),
            finalEvent: latestPayload.finalEvent,
            sessionStatus: resolveSessionStatus(latest),
          };
        }
      }
      throw new Error("奇遇正在结算，请稍候再试");
    }

    const eventRow = await getEventRowById(row.eventId);
    if (!eventRow) {
      await db.update(playerMapEventSessions).set({
        status: "active",
        updatedAt: new Date().toISOString(),
      }).where(eq(playerMapEventSessions.id, row.id)).run();
      throw new Error("奇遇事件已失效");
    }

    try {
      const finalEvent = await resolveChainFinalEvent({
        playerId: params.playerId,
        playerName: params.playerName,
        playerRealmName: params.playerRealmName,
        eventRow,
        sessionId: row.id,
        payload,
        selectedPath: nextSelectedPath,
      });
      const nextPayload: EncounterSessionPayload = {
        ...payload,
        finalEvent,
      };
      await db.update(playerMapEventSessions).set({
        status: "completed",
        currentStageIndex: payload.stages.length,
        sessionPayloadJson: nextPayload,
        selectedPathJson: nextSelectedPath,
        rewardAppliedAt: nowIso,
        updatedAt: nowIso,
        expiresAt,
      }).where(eq(playerMapEventSessions.id, row.id)).run();

      return {
        encounterSession: buildEncounterSessionView({
          sessionId: row.id,
          eventId: row.eventId,
          eventName: payload.eventName,
          eventType: payload.eventType,
          status: "completed",
          currentStageIndex: payload.stages.length,
          totalStages: payload.stages.length,
          expiresAt,
          selectedPath: nextSelectedPath,
        }),
        finalEvent,
        sessionStatus: "completed",
      };
    } catch (error) {
      await db.update(playerMapEventSessions).set({
        status: "active",
        selectedPathJson: selectedPath,
        updatedAt: new Date().toISOString(),
      }).where(eq(playerMapEventSessions.id, row.id)).run();
      throw error;
    }
  }

  const nextStageIndex = row.currentStageIndex + 1;
  await db.update(playerMapEventSessions).set({
    currentStageIndex: nextStageIndex,
    selectedPathJson: nextSelectedPath,
    expiresAt,
    updatedAt: nowIso,
  }).where(eq(playerMapEventSessions.id, row.id)).run();

  return {
    encounterSession: buildEncounterSessionView({
      sessionId: row.id,
      eventId: row.eventId,
      eventName: payload.eventName,
      eventType: payload.eventType,
      status: "active",
      currentStageIndex: nextStageIndex,
      totalStages: payload.stages.length,
      expiresAt,
      selectedPath: nextSelectedPath,
    }),
    stage: buildStageView({
      sessionId: row.id,
      currentStageIndex: nextStageIndex,
      payload,
      selectedPath: nextSelectedPath,
    }),
    sessionStatus: "active",
  };
}

export function isChainEncounterEvent(eventRow: Pick<RandomEventRow, "eventType" | "encounterMode">) {
  return eventRow.eventType === "encounter" && normalizeEncounterMode(eventRow.encounterMode) === "chain";
}
