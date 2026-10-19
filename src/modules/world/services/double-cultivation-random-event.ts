import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { monsters, players, temporaryMonsters } from "@/db/schema";
import {
  requestDoubleCultivationHostCommand,
  respondDoubleCultivationHostCommand,
} from "@/modules/world/services/double-cultivation-actions";
import { settleMapMonsterDoubleCultivationHostLedger } from "@/modules/world/services/double-cultivation-ledger";
import { getDoubleCultivationStats } from "@/modules/world/services/double-cultivation-core-api";
import type { RandomEventRewardAction } from "@/types/game";

const DOUBLE_CULTIVATION_NEARBY_RANGE = 1;
const DOUBLE_CULTIVATION_FALLBACK_MONSTER_LIMIT = 8;
const DOUBLE_CULTIVATION_ACTION_TYPE = "doubleCultivation";
const DOUBLE_CULTIVATION_LEGACY_CONDITION_KEY = "double-cultivation";
const RANDOM_EVENT_PLAYER_PROMPT_HINT = "当前双修目标为人族修士，请按人与人双修描写，不要把目标写成妖兽、灵兽或其他非人种族。";
const RANDOM_EVENT_HUMAN_BEAST_PROMPT_HINT = "当前没有可用玩家目标，必须改为人兽双修。请明确发起者是人族修士，目标是灵兽/妖兽，不要把目标写成人类修士。";

type NearbyPlayerCandidate = {
  id: string;
  name: string;
};

type NearbyMonsterCandidate = {
  id: string;
  name: string;
  monsterType: string;
  realmName: string;
};

type DoubleCultivationCandidateSet = {
  playerCandidates: NearbyPlayerCandidate[];
  monsterCandidates: NearbyMonsterCandidate[];
  usedMapMonsterFallback: boolean;
};

type DoubleCultivationTargetPool = {
  targetKind: "player" | "monster";
  optionNames: string[];
  promptHint: string;
};

export interface CoreRandomEventActionVariableOptionMeta {
  targetKind?: "player" | "monster";
  promptHint?: string;
}

export interface CoreRandomEventActionVariableOptionsResult {
  variables: Record<string, string[]>;
  variableMeta: Record<string, CoreRandomEventActionVariableOptionMeta>;
}

export interface CoreRandomEventJudgeResult {
  passed: boolean;
  failedConditionKey?: string;
  reason?: string;
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    if (i !== j) {
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
  return arr;
}

function parseTemplateVariableKey(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
}

function normalizeGender(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "男" || normalized === "male" || normalized === "man") {
    return "male" as const;
  }
  if (normalized === "女" || normalized === "female" || normalized === "woman") {
    return "female" as const;
  }
  return null;
}

function normalizeDoubleCultivationName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function buildTargetVariableAliases(variableKey: string, targetVar: string) {
  const normalizedKey = parseTemplateVariableKey(variableKey);
  return Array.from(new Set([
    variableKey,
    targetVar,
    normalizedKey,
    `{{${normalizedKey}}}`,
    "Name",
    "{{Name}}",
    "name",
    "{{name}}",
    "targetName",
    "{{targetName}}",
    "target",
    "{{target}}",
    "目标",
    "{{目标}}",
    "对象",
    "{{对象}}",
  ].map((entry) => String(entry || "").trim()).filter(Boolean)));
}

function matchOptionName(rawValue: string, optionNames: string[]) {
  const normalizedValue = normalizeDoubleCultivationName(rawValue);
  if (!normalizedValue) {
    return "";
  }
  const exactMatch = optionNames.find((optionName) => normalizeDoubleCultivationName(optionName) === normalizedValue);
  if (exactMatch) {
    return exactMatch;
  }
  const partialMatches = optionNames.filter((optionName) => {
    const normalizedOption = normalizeDoubleCultivationName(optionName);
    return normalizedOption.includes(normalizedValue) || normalizedValue.includes(normalizedOption);
  });
  return partialMatches.length === 1 ? partialMatches[0] : "";
}

function resolveAiVariableValue(aiVariables: Record<string, unknown> | null | undefined, variableKey: string, targetVar: string) {
  if (!aiVariables || typeof aiVariables !== "object") {
    return "";
  }
  const directValue = String(aiVariables[variableKey] || "").trim();
  if (directValue) {
    return directValue;
  }
  const wrappedValue = String(aiVariables[targetVar] || "").trim();
  if (wrappedValue) {
    return wrappedValue;
  }
  const normalizedKey = variableKey.trim().toLowerCase();
  for (const [candidateKey, candidateValue] of Object.entries(aiVariables)) {
    if (parseTemplateVariableKey(candidateKey).toLowerCase() === normalizedKey) {
      const matchedValue = String(candidateValue || "").trim();
      if (matchedValue) {
        return matchedValue;
      }
    }
  }
  return "";
}

function resolveDoubleCultivationTargetName(params: {
  aiVariables: Record<string, unknown> | null | undefined;
  variableKey: string;
  targetVar: string;
  optionNames: string[];
}) {
  const { aiVariables, variableKey, targetVar, optionNames } = params;
  const directValue = resolveAiVariableValue(aiVariables, variableKey, targetVar);
  const matchedDirectValue = matchOptionName(directValue, optionNames);
  if (matchedDirectValue) {
    return matchedDirectValue;
  }
  if (directValue) {
    return directValue;
  }
  if (aiVariables && typeof aiVariables === "object") {
    for (const alias of buildTargetVariableAliases(variableKey, targetVar)) {
      const aliasValue = String(aiVariables[alias] || "").trim();
      const matchedAliasValue = matchOptionName(aliasValue, optionNames);
      if (matchedAliasValue) {
        return matchedAliasValue;
      }
      if (aliasValue) {
        return aliasValue;
      }
    }
    for (const candidateValue of Object.values(aiVariables)) {
      const textValue = String(candidateValue || "").trim();
      const matchedValue = matchOptionName(textValue, optionNames);
      if (matchedValue) {
        return matchedValue;
      }
    }
  }
  return optionNames.length === 1 ? optionNames[0] : "";
}

function findNamedCandidate<T extends { name: string }>(candidates: T[], targetName: string) {
  const exactMatch = candidates.find((candidate) => candidate.name === targetName);
  if (exactMatch) {
    return exactMatch;
  }
  const normalizedTargetName = normalizeDoubleCultivationName(targetName);
  if (!normalizedTargetName) {
    return null;
  }
  const normalizedExactMatch = candidates.find((candidate) => normalizeDoubleCultivationName(candidate.name) === normalizedTargetName);
  if (normalizedExactMatch) {
    return normalizedExactMatch;
  }
  const fuzzyMatches = candidates.filter((candidate) => {
    const normalizedCandidateName = normalizeDoubleCultivationName(candidate.name);
    return normalizedCandidateName.includes(normalizedTargetName)
      || normalizedTargetName.includes(normalizedCandidateName);
  });
  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
}

function normalizeCandidateName(value: unknown, fallback: string) {
  const name = String(value || "").trim();
  return name || fallback;
}

function sortCandidateByName<T extends { id: string; name: string }>(left: T, right: T) {
  return left.name.localeCompare(right.name, "zh-Hans-CN") || left.id.localeCompare(right.id);
}

function dedupeCandidateNames(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }
  return result;
}

function resolveMonsterRealmName(monsterType: string) {
  if (monsterType === "boss") {
    return "山野霸主";
  }
  if (monsterType === "elite") {
    return "山野灵境";
  }
  return "山野妖域";
}

async function resolveNearbyDoubleCultivationCandidates(playerId: string): Promise<DoubleCultivationCandidateSet> {
  const self = await db.select({
    id: players.id,
    gender: players.gender,
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
  }).from(players).where(eq(players.id, playerId)).get();
  if (!self) {
    throw new Error("玩家不存在");
  }

  const selfGender = normalizeGender(self.gender);
  if (!selfGender) {
    throw new Error("当前角色性别未设置，无法执行双修动作");
  }

  const sameMapId = typeof self.currentMapId === "string" ? self.currentMapId.trim() : "";
  if (!sameMapId) {
    return {
      playerCandidates: [],
      monsterCandidates: [],
      usedMapMonsterFallback: false,
    };
  }

  const centerX = Number(self.positionX || 0);
  const centerY = Number(self.positionY || 0);
  const minX = centerX - DOUBLE_CULTIVATION_NEARBY_RANGE;
  const maxX = centerX + DOUBLE_CULTIVATION_NEARBY_RANGE;
  const minY = centerY - DOUBLE_CULTIVATION_NEARBY_RANGE;
  const maxY = centerY + DOUBLE_CULTIVATION_NEARBY_RANGE;
  const targetGender = selfGender === "male" ? "女" : "男";

  const [playerRows, monsterRows, temporaryMonsterRows] = await Promise.all([
    db.select({
      id: players.id,
      name: players.name,
    }).from(players).where(and(
      eq(players.currentMapId, sameMapId),
      ne(players.id, self.id),
      eq(players.gender, targetGender),
      eq(players.isAlive, true),
      gte(players.positionX, minX),
      lte(players.positionX, maxX),
      gte(players.positionY, minY),
      lte(players.positionY, maxY),
    )).all(),
    db.select({
      id: monsters.id,
      name: monsters.name,
      monsterType: monsters.monsterType,
    }).from(monsters).where(and(
      eq(monsters.mapId, sameMapId),
      gte(monsters.positionX, minX),
      lte(monsters.positionX, maxX),
      gte(monsters.positionY, minY),
      lte(monsters.positionY, maxY),
    )).all(),
    db.select({
      id: temporaryMonsters.id,
      name: temporaryMonsters.name,
      monsterType: temporaryMonsters.monsterType,
    }).from(temporaryMonsters).where(and(
      eq(temporaryMonsters.mapId, sameMapId),
      gte(temporaryMonsters.positionX, minX),
      lte(temporaryMonsters.positionX, maxX),
      gte(temporaryMonsters.positionY, minY),
      lte(temporaryMonsters.positionY, maxY),
    )).all(),
  ]);

  const playerCandidates = playerRows.map((row) => ({
    id: row.id,
    name: normalizeCandidateName(row.name, "无名修士"),
  })).sort(sortCandidateByName);

  let monsterCandidates = [
    ...monsterRows.map((row) => ({
      id: row.id,
      name: normalizeCandidateName(row.name, "无名妖兽"),
      monsterType: String(row.monsterType || "normal"),
      realmName: resolveMonsterRealmName(String(row.monsterType || "normal")),
    })),
    ...temporaryMonsterRows.map((row) => ({
      id: row.id,
      name: normalizeCandidateName(row.name, "无名妖兽"),
      monsterType: String(row.monsterType || "normal"),
      realmName: resolveMonsterRealmName(String(row.monsterType || "normal")),
    })),
  ].sort(sortCandidateByName);
  let usedMapMonsterFallback = false;

  if (playerCandidates.length < 1 && monsterCandidates.length < 1) {
    const [fallbackMonsterRows, fallbackTemporaryMonsterRows] = await Promise.all([
      db.select({
        id: monsters.id,
        name: monsters.name,
        monsterType: monsters.monsterType,
        positionX: monsters.positionX,
        positionY: monsters.positionY,
      }).from(monsters).where(eq(monsters.mapId, sameMapId)).all(),
      db.select({
        id: temporaryMonsters.id,
        name: temporaryMonsters.name,
        monsterType: temporaryMonsters.monsterType,
        positionX: temporaryMonsters.positionX,
        positionY: temporaryMonsters.positionY,
      }).from(temporaryMonsters).where(eq(temporaryMonsters.mapId, sameMapId)).all(),
    ]);

    monsterCandidates = [
      ...fallbackMonsterRows.map((row) => ({
        id: row.id,
        name: normalizeCandidateName(row.name, "无名妖兽"),
        monsterType: String(row.monsterType || "normal"),
        realmName: resolveMonsterRealmName(String(row.monsterType || "normal")),
        distance: Math.abs(Number(row.positionX || 0) - centerX) + Math.abs(Number(row.positionY || 0) - centerY),
      })),
      ...fallbackTemporaryMonsterRows.map((row) => ({
        id: row.id,
        name: normalizeCandidateName(row.name, "无名妖兽"),
        monsterType: String(row.monsterType || "normal"),
        realmName: resolveMonsterRealmName(String(row.monsterType || "normal")),
        distance: Math.abs(Number(row.positionX || 0) - centerX) + Math.abs(Number(row.positionY || 0) - centerY),
      })),
    ]
      .sort((left, right) => left.distance - right.distance || sortCandidateByName(left, right))
      .slice(0, DOUBLE_CULTIVATION_FALLBACK_MONSTER_LIMIT)
      .map((row) => ({
        id: row.id,
        name: row.name,
        monsterType: row.monsterType,
        realmName: row.realmName,
      }));
    usedMapMonsterFallback = monsterCandidates.length > 0;
  }

  return {
    playerCandidates,
    monsterCandidates,
    usedMapMonsterFallback,
  };
}

function resolveActiveDoubleCultivationTargetPool(candidates: DoubleCultivationCandidateSet): DoubleCultivationTargetPool | null {
  if (candidates.playerCandidates.length > 0) {
    return {
      targetKind: "player",
      optionNames: shuffleArray(dedupeCandidateNames(candidates.playerCandidates.map((candidate) => candidate.name))),
      promptHint: RANDOM_EVENT_PLAYER_PROMPT_HINT,
    };
  }

  if (candidates.monsterCandidates.length > 0) {
    return {
      targetKind: "monster",
      optionNames: shuffleArray(dedupeCandidateNames(candidates.monsterCandidates.map((candidate) => candidate.name))),
      promptHint: candidates.usedMapMonsterFallback
        ? `${RANDOM_EVENT_HUMAN_BEAST_PROMPT_HINT} 本次候选来自当前地图最近的妖兽，请围绕妖兽目标展开叙事。`
        : RANDOM_EVENT_HUMAN_BEAST_PROMPT_HINT,
    };
  }

  return null;
}

function parseDoubleCultivationJudgeCondition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { minIntimacyScore: 0 };
  }
  const row = value as Record<string, unknown>;
  const minRaw = Number(row.minIntimacyScore);
  return {
    minIntimacyScore: Number.isFinite(minRaw) ? Math.max(0, Math.floor(minRaw)) : 0,
  };
}

export function isDoubleCultivationRandomEventAction(action: RandomEventRewardAction) {
  return String(action?.type || "").trim() === DOUBLE_CULTIVATION_ACTION_TYPE;
}

export async function collectDoubleCultivationRandomEventVariableOptions(params: {
  playerId: string;
  actions: RandomEventRewardAction[];
}): Promise<CoreRandomEventActionVariableOptionsResult> {
  const targetVariableKeys = Array.from(new Set(
    (Array.isArray(params.actions) ? params.actions : [])
      .filter(isDoubleCultivationRandomEventAction)
      .map((action) => parseTemplateVariableKey(action.targetVar))
      .filter(Boolean),
  ));

  if (targetVariableKeys.length < 1) {
    return {
      variables: {},
      variableMeta: {},
    };
  }

  const candidates = await resolveNearbyDoubleCultivationCandidates(params.playerId);
  const activePool = resolveActiveDoubleCultivationTargetPool(candidates);
  if (!activePool || activePool.optionNames.length < 1) {
    return {
      variables: {},
      variableMeta: {},
    };
  }

  const variables: Record<string, string[]> = {};
  const variableMeta: Record<string, CoreRandomEventActionVariableOptionMeta> = {};
  for (const key of targetVariableKeys) {
    variables[key] = activePool.optionNames;
    variableMeta[key] = {
      targetKind: activePool.targetKind,
      promptHint: activePool.promptHint,
    };
  }

  return {
    variables,
    variableMeta,
  };
}

export async function executeDoubleCultivationRandomEventAction(params: {
  playerId: string;
  action: RandomEventRewardAction;
  aiVariables?: Record<string, string> | null;
  sourceRef?: string | null;
}) {
  if (!isDoubleCultivationRandomEventAction(params.action)) {
    return null;
  }

  const targetVar = typeof params.action.targetVar === "string" ? params.action.targetVar.trim() : "";
  if (!targetVar) {
    throw new Error("双修动作缺少 targetVar");
  }
  const variableKey = parseTemplateVariableKey(targetVar);
  if (!variableKey) {
    throw new Error("双修动作 targetVar 非法");
  }

  const candidates = await resolveNearbyDoubleCultivationCandidates(params.playerId);
  const activePool = resolveActiveDoubleCultivationTargetPool(candidates);
  if (!activePool) {
    throw new Error("附近没有可用于双修动作的目标角色或妖兽");
  }

  const targetName = resolveDoubleCultivationTargetName({
    aiVariables: params.aiVariables as Record<string, unknown> | undefined,
    variableKey,
    targetVar,
    optionNames: activePool.optionNames,
  });
  if (!targetName) {
    throw new Error(`动作执行失败：AI 未返回变量 {{${variableKey}}}`);
  }

  if (activePool.targetKind === "player") {
    const targetCandidate = findNamedCandidate(candidates.playerCandidates, targetName);
    if (!targetCandidate) {
      throw new Error(`动作执行失败：附近没有名为 ${targetName} 的双修目标角色`);
    }
    const requestResult = await requestDoubleCultivationHostCommand({
      requesterId: params.playerId,
      targetInput: targetCandidate.id,
    });
    const settledResult = await respondDoubleCultivationHostCommand({
      playerId: requestResult.target.id,
      requestId: requestResult.request.id,
      action: "accept",
    });
    if (!settledResult.settled || !settledResult.log) {
      throw new Error("动作执行失败：双修未完成");
    }
    return {
      type: "doubleCultivation",
      label: `双修·${requestResult.target.name || targetCandidate.name}`,
      targetVar,
      targetName: requestResult.target.name || targetCandidate.name,
      targetKind: "player" as const,
      logId: settledResult.log.id,
    };
  }

  const targetCandidate = findNamedCandidate(candidates.monsterCandidates, targetName);
  if (!targetCandidate) {
    throw new Error(`动作执行失败：附近没有名为 ${targetName} 的双修目标妖兽`);
  }

  const settledResult = await settleMapMonsterDoubleCultivationHostLedger({
    playerId: params.playerId,
    targetMonsterId: targetCandidate.id,
    targetMonsterName: targetCandidate.name,
    targetMonsterType: targetCandidate.monsterType,
    targetMonsterRealmName: targetCandidate.realmName,
    actionType: "random_event_beast_cultivation",
    sourceRef: `${String(params.sourceRef || "random-event").trim() || "random-event"}:${params.playerId}:${targetCandidate.id}:${targetVar}`,
    sourceTargetId: targetCandidate.id,
  });
  if (!settledResult.settled || !settledResult.log) {
    throw new Error("动作执行失败：人兽双修未完成");
  }
  return {
    type: "doubleCultivation",
    label: `人兽双修·${targetCandidate.name}`,
    targetVar,
      targetName: targetCandidate.name,
      targetKind: "monster" as const,
      monsterId: targetCandidate.id,
      logId: settledResult.log.id ?? undefined,
    };
}

export async function judgeDoubleCultivationRandomEventCondition(params: {
  playerId: string;
  condition: unknown;
}): Promise<CoreRandomEventJudgeResult> {
  const condition = parseDoubleCultivationJudgeCondition(params.condition);
  if (condition.minIntimacyScore < 1) {
    return { passed: true };
  }

  const player = await db.select({
    gender: players.gender,
  }).from(players).where(eq(players.id, params.playerId)).get();
  const stats = await getDoubleCultivationStats({
    playerId: params.playerId,
    gender: player?.gender,
  });
  const intimacyScore = Math.max(0, Number(stats.metrics?.intimacyScore || 0));
  if (intimacyScore >= condition.minIntimacyScore) {
    return { passed: true };
  }

  return {
    passed: false,
    failedConditionKey: DOUBLE_CULTIVATION_LEGACY_CONDITION_KEY,
    reason: `双修亲密度不足（需要 ${condition.minIntimacyScore}，当前 ${intimacyScore}）`,
  };
}

export async function judgeCoreRandomEventConditions(params: {
  playerId: string;
  pluginConditions: Record<string, unknown>;
}): Promise<CoreRandomEventJudgeResult> {
  const entries = Object.entries(params.pluginConditions || {})
    .map(([key, condition]) => [String(key || "").trim(), condition] as const)
    .filter(([key]) => key.length > 0);
  for (const [key, condition] of entries) {
    if (key === DOUBLE_CULTIVATION_LEGACY_CONDITION_KEY) {
      const result = await judgeDoubleCultivationRandomEventCondition({
        playerId: params.playerId,
        condition,
      });
      if (!result.passed) {
        return result;
      }
      continue;
    }

    return {
      passed: false,
      failedConditionKey: key,
      reason: `历史插件判定 ${key} 已退役，请将该奇遇条件迁入核心随机事件规则。`,
    };
  }

  return { passed: true };
}
