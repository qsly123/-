import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  maps,
  monsters,
  npcs,
  pillToxicityConfigs,
  quests,
  randomEvents,
  temporaryMaps,
  temporaryMonsters,
} from "@/db/schema";
import type { AdminEntity } from "@/modules/admin/services/admin-entities";
import { isMissingPillToxicityConfigTableError } from "@/modules/character/services/pill-toxicity-schema-compat";
import { BUILTIN_RANDOM_EVENT_ACTION_TYPE_SET } from "@/modules/map/services/random-event-action-builtins";
import { resolveRandomEventMapTypes } from "@/modules/map/services/random-event-service";
import { collectRandomEventActionDefinitionsByPlugins } from "@/modules/shared/services/legacy-plugin-compat";

const SUPPORTED_RANDOM_EVENT_TYPES = new Set(["encounter", "opportunity"]);
const RANDOM_EVENT_ACTION_TARGET_VAR_REGEX = /^\{\{[a-zA-Z0-9_]+\}\}$/;

function toNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
}

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function normalizeRandomEventActions(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => {
      const value = row as Record<string, unknown>;
      return {
        type: typeof value.type === "string" ? value.type.trim() : "",
        targetVar: typeof value.targetVar === "string" ? value.targetVar.trim() : "",
        monsterId: typeof value.monsterId === "string" ? value.monsterId.trim() : "",
        mapId: typeof value.mapId === "string" ? value.mapId.trim() : "",
      };
    });
}

type MapTileDraft = {
  x: number;
  y: number;
  type: string;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
};

function normalizeMapTileDrafts(input: unknown): MapTileDraft[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      x: Math.floor(Number(row.x)),
      y: Math.floor(Number(row.y)),
      type: typeof row.type === "string" ? row.type.trim() : "",
      portalId: typeof row.portalId === "string" ? row.portalId.trim() : "",
      portalName: typeof row.portalName === "string" ? row.portalName.trim() : "",
      portalTargetMapId: typeof row.portalTargetMapId === "string" ? row.portalTargetMapId.trim() : "",
    }))
    .filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y) && row.type);
}

async function ensureMapExists(mapId: string) {
  const directMap = await db.select({ id: maps.id }).from(maps).where(eq(maps.id, mapId)).get();
  if (directMap) {
    return true;
  }
  const temporaryMap = await db.select({ id: temporaryMaps.id }).from(temporaryMaps).where(eq(temporaryMaps.id, mapId)).get();
  return Boolean(temporaryMap);
}

async function validateMapPayload(
  payload: Record<string, unknown>,
  entity: "maps" | "temporaryMaps",
) {
  if (!("tilesData" in payload)) {
    return;
  }

  const tiles = normalizeMapTileDrafts(payload.tilesData);
  const seenPortalIds = new Map<string, string>();
  const checkedTargetMapIds = new Map<string, boolean>();

  for (const tile of tiles) {
    if (tile.type !== "portal") {
      continue;
    }

    const tileLabel = tile.portalName || tile.portalId || `(${tile.x},${tile.y})`;
    const targetMapId = tile.portalTargetMapId || "";

    if (!targetMapId) {
      throw new Error(`传送阵 ${tileLabel} 缺少目标地图`);
    }

    if (tile.portalId) {
      const previousPosition = seenPortalIds.get(tile.portalId);
      const currentPosition = `(${tile.x},${tile.y})`;
      if (previousPosition) {
        throw new Error(`传送阵 ID 重复：${tile.portalId}，位置 ${previousPosition} 与 ${currentPosition}`);
      }
      seenPortalIds.set(tile.portalId, currentPosition);
    }

    let targetExists = checkedTargetMapIds.get(targetMapId);
    if (targetExists === undefined) {
      targetExists = await ensureMapExists(targetMapId);
      checkedTargetMapIds.set(targetMapId, targetExists);
    }

    if (!targetExists) {
      const mapTypeLabel = entity === "temporaryMaps" ? "正式/临时地图" : "地图";
      throw new Error(`传送阵 ${tileLabel} 绑定的目标${mapTypeLabel}不存在：${targetMapId}`);
    }
  }
}

async function validateNpcPayload(payload: Record<string, unknown>, forCreate: boolean, rowId?: string | number) {
  let finalBountyEnabled = toBoolean(payload.bountyEnabled);
  let finalBountyDailyLimit = toNullableInteger(payload.bountyDailyLimit) ?? 0;

  if (!forCreate) {
    if (rowId === undefined) {
      throw new Error("缺少 id");
    }
    const current = await db.select({
      bountyEnabled: npcs.bountyEnabled,
      bountyDailyLimit: npcs.bountyDailyLimit,
    }).from(npcs).where(eq(npcs.id, String(rowId))).get();
    if (!current) {
      throw new Error("记录不存在");
    }
    finalBountyEnabled = payload.bountyEnabled === undefined ? current.bountyEnabled : finalBountyEnabled;
    finalBountyDailyLimit = payload.bountyDailyLimit === undefined
      ? current.bountyDailyLimit
      : finalBountyDailyLimit;
  }

  if (finalBountyEnabled && finalBountyDailyLimit < 1) {
    throw new Error("开启悬赏 NPC 时，每日悬赏次数必须大于等于 1");
  }
}

async function validateQuestPayload(payload: Record<string, unknown>, forCreate: boolean, rowId?: string | number) {
  let finalQuestType = typeof payload.questType === "string" ? payload.questType : "";
  let finalAcceptNpcId = typeof payload.acceptNpcId === "string" ? payload.acceptNpcId.trim() : "";
  let finalCompleteNpcId = typeof payload.completeNpcId === "string" ? payload.completeNpcId.trim() : "";
  let finalMinRealm = toNullableInteger(payload.minRealm);
  let finalMaxRealm = toNullableInteger(payload.maxRealm);

  if (!forCreate) {
    if (rowId === undefined) {
      throw new Error("缺少 id");
    }
    const current = await db.select({
      questType: quests.questType,
      acceptNpcId: quests.acceptNpcId,
      completeNpcId: quests.completeNpcId,
      minRealm: quests.minRealm,
      maxRealm: quests.maxRealm,
    }).from(quests).where(eq(quests.id, String(rowId))).get();
    if (!current) {
      throw new Error("记录不存在");
    }
    finalQuestType = finalQuestType || current.questType;
    finalAcceptNpcId = finalAcceptNpcId || current.acceptNpcId;
    finalCompleteNpcId = finalCompleteNpcId || current.completeNpcId;
    finalMinRealm = finalMinRealm ?? current.minRealm;
    finalMaxRealm = payload.maxRealm === undefined ? current.maxRealm : finalMaxRealm;
  }

  if (finalMinRealm === null || finalMinRealm < 1) {
    throw new Error("minRealm 非法");
  }

  if (finalMaxRealm !== null && finalMaxRealm < finalMinRealm) {
    throw new Error("maxRealm 不能小于 minRealm");
  }

  if (finalQuestType !== "bounty") {
    return;
  }

  if (!finalAcceptNpcId || !finalCompleteNpcId) {
    throw new Error("悬赏任务必须配置接取 NPC 和完成 NPC");
  }

  if (finalAcceptNpcId !== finalCompleteNpcId) {
    throw new Error("悬赏任务必须由同一个 NPC 接取与提交");
  }

  if (finalMaxRealm === null) {
    throw new Error("悬赏任务必须配置最高境界");
  }

  const npc = await db.select({
    id: npcs.id,
    bountyEnabled: npcs.bountyEnabled,
  }).from(npcs).where(eq(npcs.id, finalAcceptNpcId)).get();

  if (!npc) {
    throw new Error("接取 NPC 不存在");
  }

  if (!npc.bountyEnabled) {
    throw new Error("目标 NPC 未开启悬赏功能，不能分配悬赏任务");
  }

  payload.repeatable = true;
}

async function validateMonsterPayload(
  payload: Record<string, unknown>,
  forCreate: boolean,
  rowId: string | number | undefined,
  entity: "monsters" | "temporaryMonsters",
) {
  let finalIntervalMin = toNullableInteger(payload.aiMoveIntervalMinSeconds);
  let finalIntervalMax = toNullableInteger(payload.aiMoveIntervalMaxSeconds);
  let finalMoveRange = toNullableInteger(payload.aiMoveRange);
  let finalMapId = typeof payload.mapId === "string" ? payload.mapId.trim() : "";

  if (!forCreate) {
    if (rowId === undefined) {
      throw new Error("缺少 id");
    }
    const current = entity === "temporaryMonsters"
      ? await db.select({
        aiMoveIntervalMinSeconds: temporaryMonsters.aiMoveIntervalMinSeconds,
        aiMoveIntervalMaxSeconds: temporaryMonsters.aiMoveIntervalMaxSeconds,
        aiMoveRange: temporaryMonsters.aiMoveRange,
        mapId: temporaryMonsters.mapId,
      }).from(temporaryMonsters).where(eq(temporaryMonsters.id, String(rowId))).get()
      : await db.select({
        aiMoveIntervalMinSeconds: monsters.aiMoveIntervalMinSeconds,
        aiMoveIntervalMaxSeconds: monsters.aiMoveIntervalMaxSeconds,
        aiMoveRange: monsters.aiMoveRange,
        mapId: monsters.mapId,
      }).from(monsters).where(eq(monsters.id, String(rowId))).get();
    if (!current) {
      throw new Error("记录不存在");
    }

    finalIntervalMin = payload.aiMoveIntervalMinSeconds === undefined
      ? current.aiMoveIntervalMinSeconds
      : finalIntervalMin;
    finalIntervalMax = payload.aiMoveIntervalMaxSeconds === undefined
      ? current.aiMoveIntervalMaxSeconds
      : finalIntervalMax;
    finalMoveRange = payload.aiMoveRange === undefined
      ? current.aiMoveRange
      : finalMoveRange;
    finalMapId = payload.mapId === undefined ? current.mapId : finalMapId;
  }

  if (finalIntervalMin !== null && finalIntervalMin < 1) {
    throw new Error("巡逻最短间隔必须大于等于 1 秒");
  }
  if (finalIntervalMax !== null && finalIntervalMax < 1) {
    throw new Error("巡逻最长间隔必须大于等于 1 秒");
  }
  if (
    finalIntervalMin !== null
    && finalIntervalMax !== null
    && finalIntervalMax < finalIntervalMin
  ) {
    throw new Error("巡逻最长间隔不能小于最短间隔");
  }
  if (finalMoveRange !== null && finalMoveRange < 0) {
    throw new Error("巡逻范围不能小于 0");
  }

  if (entity === "temporaryMonsters") {
    if (!finalMapId) {
      throw new Error("临时怪物必须绑定临时地图");
    }
    const mapRow = await db.select({ id: temporaryMaps.id })
      .from(temporaryMaps)
      .where(eq(temporaryMaps.id, finalMapId))
      .get();
    if (!mapRow) {
      throw new Error("临时怪物绑定的临时地图不存在");
    }
  }
}

async function validateRandomEventPayload(payload: Record<string, unknown>, forCreate: boolean, rowId?: string | number) {
  let finalEventType = typeof payload.eventType === "string" ? payload.eventType : "";
  let finalEncounterMode = typeof payload.encounterMode === "string" ? payload.encounterMode.trim() : "";
  let finalEncounterStageCount = toNullableInteger(payload.encounterStageCount);
  let finalEncounterChoiceCount = toNullableInteger(payload.encounterChoiceCount);
  let finalProbability = Number(payload.probability);
  let finalMinRealm = toNullableInteger(payload.minRealm);
  let finalMaxRealm = toNullableInteger(payload.maxRealm);
  let finalMapType = typeof payload.mapType === "string" ? payload.mapType.trim() : "";
  let finalMapTypes = Array.isArray(payload.mapTypes) ? payload.mapTypes : null;
  let finalSpawnInterval = toNullableInteger(payload.spawnIntervalSeconds);
  let finalDuration = toNullableInteger(payload.durationSeconds);
  let finalAiPrompt = typeof payload.aiPrompt === "string" ? payload.aiPrompt.trim() : "";
  let finalRewards = payload.rewards;

  if (!forCreate) {
    if (rowId === undefined) {
      throw new Error("缺少 id");
    }
    const current = await db.select({
      eventType: randomEvents.eventType,
      encounterMode: randomEvents.encounterMode,
      encounterStageCount: randomEvents.encounterStageCount,
      encounterChoiceCount: randomEvents.encounterChoiceCount,
      probability: randomEvents.probability,
      minRealm: randomEvents.minRealm,
      maxRealm: randomEvents.maxRealm,
      mapType: randomEvents.mapType,
      mapTypes: randomEvents.mapTypes,
      spawnIntervalSeconds: randomEvents.spawnIntervalSeconds,
      durationSeconds: randomEvents.durationSeconds,
      aiPrompt: randomEvents.aiPrompt,
      rewards: randomEvents.rewards,
    }).from(randomEvents).where(eq(randomEvents.id, String(rowId))).get();
    if (!current) {
      throw new Error("记录不存在");
    }

    finalEventType = finalEventType || current.eventType;
    finalEncounterMode = finalEncounterMode || String(current.encounterMode || "").trim();
    finalEncounterStageCount = payload.encounterStageCount === undefined
      ? current.encounterStageCount
      : finalEncounterStageCount;
    finalEncounterChoiceCount = payload.encounterChoiceCount === undefined
      ? current.encounterChoiceCount
      : finalEncounterChoiceCount;
    finalProbability = payload.probability === undefined ? Number(current.probability) : finalProbability;
    finalMinRealm = finalMinRealm ?? current.minRealm;
    finalMaxRealm = payload.maxRealm === undefined ? current.maxRealm : finalMaxRealm;
    finalMapType = payload.mapType === undefined ? String(current.mapType || "").trim() : finalMapType;
    finalMapTypes = payload.mapTypes === undefined ? current.mapTypes : finalMapTypes;
    finalSpawnInterval = payload.spawnIntervalSeconds === undefined
      ? current.spawnIntervalSeconds
      : finalSpawnInterval;
    finalDuration = payload.durationSeconds === undefined
      ? current.durationSeconds
      : finalDuration;
    finalAiPrompt = payload.aiPrompt === undefined
      ? String(current.aiPrompt || "").trim()
      : finalAiPrompt;
    finalRewards = payload.rewards === undefined
      ? current.rewards
      : finalRewards;
  }

  if (!Number.isFinite(finalProbability) || finalProbability < 0 || finalProbability > 1) {
    throw new Error("probability 必须在 0 到 1 之间，例如 0.01 表示 1%");
  }
  if (!SUPPORTED_RANDOM_EVENT_TYPES.has(finalEventType)) {
    throw new Error("eventType 仅支持 encounter 或 opportunity");
  }
  if (finalEncounterMode !== "chain") {
    finalEncounterMode = "single";
  }
  if (finalMinRealm === null || finalMinRealm < 1) {
    throw new Error("minRealm 非法");
  }
  if (finalMaxRealm !== null && finalMaxRealm < finalMinRealm) {
    throw new Error("maxRealm 不能小于 minRealm");
  }

  const resolvedMapTypes = resolveRandomEventMapTypes({
    mapTypes: finalMapTypes,
    mapType: finalMapType,
  });
  if (resolvedMapTypes.length > 0) {
    payload.mapTypes = resolvedMapTypes;
    payload.mapType = resolvedMapTypes[0];
  } else if ("mapTypes" in payload || "mapType" in payload) {
    payload.mapTypes = null;
    payload.mapType = null;
  }

  if (finalEventType === "opportunity") {
    if (finalEncounterMode === "chain") {
      throw new Error("chain 模式仅支持 encounter 类型事件");
    }
    if (finalSpawnInterval === null || finalSpawnInterval < 1) {
      throw new Error("机缘事件必须配置大于 0 的刷新间隔");
    }
    if (finalDuration === null || finalDuration < 1) {
      throw new Error("机缘事件必须配置大于 0 的存活时长");
    }
  } else if (finalSpawnInterval !== null && finalSpawnInterval < 1) {
    throw new Error("遭遇事件触发间隔必须大于 0，留空表示不限制");
  }

  if (finalEncounterMode === "chain") {
    if (finalEventType !== "encounter") {
      throw new Error("chain 模式仅支持 encounter 类型事件");
    }
    if (!finalAiPrompt) {
      throw new Error("chain 模式必须填写 AI 叙事提示词");
    }
    if (finalEncounterStageCount === null || finalEncounterStageCount < 2 || finalEncounterStageCount > 4) {
      throw new Error("chain 模式 encounterStageCount 必须在 2-4 之间");
    }
    if (finalEncounterChoiceCount === null || finalEncounterChoiceCount < 2 || finalEncounterChoiceCount > 3) {
      throw new Error("chain 模式 encounterChoiceCount 必须在 2-3 之间");
    }
  }

  const rewardObject = finalRewards && typeof finalRewards === "object" && !Array.isArray(finalRewards)
    ? finalRewards as Record<string, unknown>
    : {};
  const actions = normalizeRandomEventActions(rewardObject.actions);
  const hasTargetVariables = actions.some((action) => !!action.targetVar);
  if (hasTargetVariables && !finalAiPrompt) {
    throw new Error("配置动作时必须填写 AI 叙事提示词");
  }
  const actionDefinitions = await collectRandomEventActionDefinitionsByPlugins();
  const supportedActionTypes = new Set(
    [
      ...Array.from(BUILTIN_RANDOM_EVENT_ACTION_TYPE_SET),
      ...actionDefinitions
        .map((item) => String(item.type || "").trim())
        .filter(Boolean),
    ],
  );
  for (const action of actions) {
    if (!supportedActionTypes.has(action.type)) {
      throw new Error(`动作类型未启用或不存在: ${action.type || "空"}`);
    }
    if (action.targetVar && !RANDOM_EVENT_ACTION_TARGET_VAR_REGEX.test(action.targetVar)) {
      throw new Error("动作 targetVar 必须是 {{Name}} 形式");
    }
    if (action.type === "battle") {
      if (!action.monsterId) {
        throw new Error("战斗动作必须选择怪物");
      }
      const monster = await db.select({ id: monsters.id }).from(monsters).where(eq(monsters.id, action.monsterId)).get();
      if (!monster) {
        throw new Error(`战斗怪物不存在: ${action.monsterId}`);
      }
    }
    if (action.type === "teleport") {
      if (!action.mapId) {
        throw new Error("传送动作必须选择地图");
      }
      const map = await db.select({ id: maps.id }).from(maps).where(eq(maps.id, action.mapId)).get();
      if (!map) {
        throw new Error(`传送目标地图不存在: ${action.mapId}`);
      }
    }
  }
}

async function validatePillToxicityConfigPayload(payload: Record<string, unknown>, forCreate: boolean, rowId?: string | number) {
  let finalMaxToxicity = toNullableInteger(payload.maxToxicity);
  let finalRecoverIntervalMinutes = toNullableInteger(payload.recoverIntervalMinutes);

  if (!forCreate) {
    if (rowId === undefined) {
      throw new Error("缺少 id");
    }
    let current;
    try {
      current = await db.select({
        maxToxicity: pillToxicityConfigs.maxToxicity,
        recoverIntervalMinutes: pillToxicityConfigs.recoverIntervalMinutes,
      }).from(pillToxicityConfigs)
        .where(eq(pillToxicityConfigs.key, String(rowId)))
        .get();
    } catch (error) {
      if (isMissingPillToxicityConfigTableError(error)) {
        throw new Error("当前数据库未完成丹毒迁移，暂不可编辑丹毒配置");
      }
      throw error;
    }
    if (!current) {
      throw new Error("记录不存在");
    }
    finalMaxToxicity = payload.maxToxicity === undefined ? current.maxToxicity : finalMaxToxicity;
    finalRecoverIntervalMinutes = payload.recoverIntervalMinutes === undefined
      ? current.recoverIntervalMinutes
      : finalRecoverIntervalMinutes;
  }

  if (finalMaxToxicity === null || finalMaxToxicity < 1) {
    throw new Error("丹毒上限必须大于等于 1");
  }
  if (finalRecoverIntervalMinutes === null || finalRecoverIntervalMinutes < 1) {
    throw new Error("恢复间隔必须大于等于 1 分钟");
  }
}

export async function validateEntityPayload(
  entity: AdminEntity,
  payload: Record<string, unknown>,
  forCreate: boolean,
  rowId?: string | number,
) {
  if (entity === "maps") {
    await validateMapPayload(payload, "maps");
    return;
  }
  if (entity === "temporaryMaps") {
    await validateMapPayload(payload, "temporaryMaps");
    return;
  }
  if (entity === "monsters") {
    await validateMonsterPayload(payload, forCreate, rowId, "monsters");
    return;
  }
  if (entity === "temporaryMonsters") {
    await validateMonsterPayload(payload, forCreate, rowId, "temporaryMonsters");
    return;
  }
  if (entity === "npcs") {
    await validateNpcPayload(payload, forCreate, rowId);
    return;
  }
  if (entity === "quests") {
    await validateQuestPayload(payload, forCreate, rowId);
    return;
  }
  if (entity === "randomEvents") {
    await validateRandomEventPayload(payload, forCreate, rowId);
    return;
  }
  if (entity === "pillToxicityConfigs") {
    await validatePillToxicityConfigPayload(payload, forCreate, rowId);
  }
}
