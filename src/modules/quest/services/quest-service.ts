import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { fortunes, items, maps, npcs, playerInventory, playerNpcBountyDaily, playerQuests, players, quests } from "@/db/schema";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import { getQuestRequirementProgressKey } from "@/modules/quest/services/quest-requirement";
import { applyXpRateForPlayer, grantFortunesToPlayer } from "@/modules/character/services/fortune-service";
import type { QuestCategory, QuestRequirement, QuestReward } from "@/types/game";

const MAIN_QUEST_CATEGORY: QuestCategory = "main";
const SIDE_QUEST_CATEGORY: QuestCategory = "side";
const BOUNTY_QUEST_TYPE = "bounty";
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export type MainlineGuideStatus = "not_configured" | "available" | "active" | "ready_to_submit" | "completed_all";

export interface MainlineGuide {
  currentQuestId: string | null;
  status: MainlineGuideStatus;
  npcId?: string;
  npcName?: string;
  mapId?: string;
  mapName?: string;
  minRealm?: number;
  minRealmName?: string;
  hint: string;
}

export interface QuestServiceResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface AcceptQuestResult {
  questId: string;
  questName: string;
  hint?: string;
  story?: string;
}

export interface BountyDailyStatus {
  dateKey: string;
  dailyLimit: number;
  usedCount: number;
  remainingCount: number;
}

export interface CompleteQuestResult {
  questId: string;
  questName: string;
  hint?: string;
  story?: string;
  rewards: QuestReward & {
    items?: { itemId: string; quantity: number; itemName?: string; itemIconUrl?: string | null }[];
  };
}

interface QuestProgressResult {
  progress: Record<string, number>;
  isComplete: boolean;
}

interface MainQuestPointerPlayer {
  id: string;
  currentMainQuestId: string | null;
}

interface MainQuestRef {
  id: string;
  prerequisites: string[] | null;
}

type QuestProgressExecutor = Pick<typeof db, "select" | "update">;

function calcCombatPower(stats: {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
}) {
  return calculateCombatPower(stats);
}

function toRequirements(input: unknown): QuestRequirement[] {
  return (input as QuestRequirement[] | null) || [];
}

function toProgress(input: unknown): Record<string, number> {
  return (input as Record<string, number> | null) || {};
}

function toQuestCategory(value: unknown): QuestCategory {
  return value === MAIN_QUEST_CATEGORY ? MAIN_QUEST_CATEGORY : SIDE_QUEST_CATEGORY;
}

function toPrerequisiteIds(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  return list
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function toMainPrerequisiteIds(prerequisitesInput: unknown, mainQuestIdSet: Set<string>): string[] {
  return toPrerequisiteIds(prerequisitesInput)
    .filter((questId) => mainQuestIdSet.has(questId));
}

function getShanghaiDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function resolveQuestMaxRealm(maxRealm: unknown, minRealm: number): number | null {
  if (typeof maxRealm !== "number" || !Number.isFinite(maxRealm) || maxRealm < minRealm) {
    return null;
  }
  return Math.floor(maxRealm);
}

async function hasCompletedPrerequisites(playerId: string, prerequisitesInput: unknown): Promise<boolean> {
  const prereqs = toPrerequisiteIds(prerequisitesInput);
  for (const preId of prereqs) {
    const prePq = await db.select().from(playerQuests)
      .where(and(
        eq(playerQuests.playerId, playerId),
        eq(playerQuests.questId, preId),
        eq(playerQuests.status, "completed"),
      ))
      .get();
    if (!prePq) {
      return false;
    }
  }
  return true;
}

function hasCompletedPrerequisitesFromStatusMap(
  prerequisitesInput: unknown,
  completedQuestIds: Set<string>,
) {
  const prereqs = toPrerequisiteIds(prerequisitesInput);
  return prereqs.every((preId) => completedQuestIds.has(preId));
}

async function loadMainQuestRefs(): Promise<MainQuestRef[]> {
  return await db.select({
    id: quests.id,
    prerequisites: quests.prerequisites,
  })
    .from(quests)
    .where(eq(quests.questCategory, MAIN_QUEST_CATEGORY))
    .all() as MainQuestRef[];
}

function findDirectNextMainQuestId(mainQuests: MainQuestRef[], currentQuestId: string): string | null {
  const mainQuestIdSet = new Set(mainQuests.map((quest) => quest.id));
  return mainQuests
    .filter((quest) => toMainPrerequisiteIds(quest.prerequisites, mainQuestIdSet).includes(currentQuestId))
    .map((quest) => quest.id)
    .sort((a, b) => a.localeCompare(b))[0] || null;
}

function findReadyMainQuestId(mainQuests: MainQuestRef[], completedQuestIds: Set<string>): string | null {
  const mainQuestIdSet = new Set(mainQuests.map((quest) => quest.id));
  return mainQuests
    .filter((quest) => !completedQuestIds.has(quest.id))
    .filter((quest) => toMainPrerequisiteIds(quest.prerequisites, mainQuestIdSet).every((preId) => completedQuestIds.has(preId)))
    .map((quest) => quest.id)
    .sort((a, b) => a.localeCompare(b))[0] || null;
}

async function findCompletedMainQuestIdSet(playerId: string, mainQuestIdSet: Set<string>): Promise<Set<string>> {
  const completedRows = await db.select({ questId: playerQuests.questId })
    .from(playerQuests)
    .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.status, "completed")))
    .all();

  return new Set(
    completedRows
      .map((row) => row.questId)
      .filter((questId) => mainQuestIdSet.has(questId)),
  );
}

async function findActiveMainQuestId(playerId: string, mainQuestIdSet: Set<string>): Promise<string | null> {
  const activeQuests = await db.select({ questId: playerQuests.questId })
    .from(playerQuests)
    .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.status, "active")))
    .all();

  for (const row of activeQuests) {
    if (mainQuestIdSet.has(row.questId)) {
      return row.questId;
    }
  }

  return null;
}

async function resolveCurrentMainQuestId(player: MainQuestPointerPlayer): Promise<string | null> {
  const mainQuests = await loadMainQuestRefs();
  if (!mainQuests.length) {
    if (player.currentMainQuestId) {
      await db.update(players)
        .set({
          currentMainQuestId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(players.id, player.id), eq(players.currentMainQuestId, player.currentMainQuestId)))
        .run();
    }
    return null;
  }

  const mainQuestIdSet = new Set(mainQuests.map((quest) => quest.id));
  if (player.currentMainQuestId && mainQuestIdSet.has(player.currentMainQuestId)) {
    return player.currentMainQuestId;
  }
  if (player.currentMainQuestId && !mainQuestIdSet.has(player.currentMainQuestId)) {
    await db.update(players)
      .set({
        currentMainQuestId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(players.id, player.id), eq(players.currentMainQuestId, player.currentMainQuestId)))
      .run();
  }

  const activeMainQuestId = await findActiveMainQuestId(player.id, mainQuestIdSet);
  if (activeMainQuestId) {
    await db.update(players)
      .set({
        currentMainQuestId: activeMainQuestId,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(players.id, player.id), isNull(players.currentMainQuestId)))
      .run();
    return activeMainQuestId;
  }

  const completedMainQuestIds = await findCompletedMainQuestIdSet(player.id, mainQuestIdSet);
  const readyMainQuestId = findReadyMainQuestId(mainQuests, completedMainQuestIds);
  if (!readyMainQuestId) {
    return null;
  }

  await db.update(players)
    .set({
      currentMainQuestId: readyMainQuestId,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(players.id, player.id), isNull(players.currentMainQuestId)))
    .run();

  const refreshed = await db.select({ currentMainQuestId: players.currentMainQuestId })
    .from(players)
    .where(eq(players.id, player.id))
    .get();

  return refreshed?.currentMainQuestId || readyMainQuestId;
}

export async function getCurrentMainQuestIdForPlayer(playerId: string): Promise<string | null> {
  const player = await db.select({
    id: players.id,
    currentMainQuestId: players.currentMainQuestId,
  })
    .from(players)
    .where(eq(players.id, playerId))
    .get();

  if (!player) {
    return null;
  }

  return resolveCurrentMainQuestId(player);
}

function buildMainlineGuideHint(params: {
  questName?: string;
  npcName?: string;
  mapName?: string;
  status: MainlineGuideStatus;
}) {
  const { questName, npcName, mapName, status } = params;
  if (status === "not_configured") {
    return "当前未配置主线任务。";
  }
  if (status === "completed_all") {
    return "主线任务已全部完成。";
  }

  const where = mapName ? `前往${mapName}` : "前往目标地图";
  const who = npcName ? `寻找${npcName}` : "寻找发布者";
  const name = questName ? `「${questName}」` : "当前主线";

  if (status === "available") {
    return `${where}，${who}，接取主线${name}。`;
  }

  if (status === "ready_to_submit") {
    return `主线${name}已完成，回去找${npcName || "发布者"}提交。`;
  }

  return `继续推进主线${name}，完成后回${npcName || "发布者"}交任务。`;
}

export async function buildMainlineGuide(playerId: string): Promise<MainlineGuide> {
  const player = await db.select({
    id: players.id,
    currentMainQuestId: players.currentMainQuestId,
  })
    .from(players)
    .where(eq(players.id, playerId))
    .get();

  if (!player) {
    return {
      currentQuestId: null,
      status: "not_configured",
      hint: "玩家不存在。",
    };
  }

  const mainQuests = await loadMainQuestRefs();
  const maxSteps = Math.max(2, mainQuests.length + 2);
  let currentMainQuestId = await resolveCurrentMainQuestId(player);
  let steps = 0;

  while (currentMainQuestId && steps < maxSteps) {
    const quest = await db.select().from(quests).where(eq(quests.id, currentMainQuestId)).get();
    if (!quest || toQuestCategory(quest.questCategory) !== MAIN_QUEST_CATEGORY) {
      await db.update(players)
        .set({
          currentMainQuestId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(players.id, player.id), eq(players.currentMainQuestId, currentMainQuestId)))
        .run();
      currentMainQuestId = await resolveCurrentMainQuestId({
        id: player.id,
        currentMainQuestId: null,
      });
      steps += 1;
      continue;
    }

    const pq = await db.select().from(playerQuests)
      .where(and(eq(playerQuests.playerId, player.id), eq(playerQuests.questId, quest.id)))
      .get();

    if (pq?.status === "completed") {
      const nextQuestId = findDirectNextMainQuestId(mainQuests, quest.id);
      await db.update(players)
        .set({
          currentMainQuestId: nextQuestId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(players.id, player.id))
        .run();
      currentMainQuestId = nextQuestId;
      steps += 1;
      continue;
    }

    const acceptNpc = await db.select({ id: npcs.id, name: npcs.name, mapId: npcs.mapId })
      .from(npcs)
      .where(eq(npcs.id, quest.acceptNpcId))
      .get();
    const completeNpc = quest.completeNpcId === quest.acceptNpcId
      ? acceptNpc
      : await db.select({ id: npcs.id, name: npcs.name, mapId: npcs.mapId })
        .from(npcs)
        .where(eq(npcs.id, quest.completeNpcId))
        .get();
    const minRealmName = await getRealmFullNameByLinearRealm(quest.minRealm);

    if (pq?.status === "active") {
      const { isComplete } = await computeQuestProgress(player.id, quest.requirements, pq.progress);
      const status: MainlineGuideStatus = isComplete ? "ready_to_submit" : "active";
      const targetNpc = completeNpc || acceptNpc;
      const map = targetNpc?.mapId
        ? await db.select({ id: maps.id, name: maps.name })
          .from(maps)
          .where(eq(maps.id, targetNpc.mapId))
          .get()
        : null;
      return {
        currentQuestId: quest.id,
        status,
        ...(targetNpc ? { npcId: targetNpc.id, npcName: targetNpc.name } : {}),
        ...(map ? { mapId: map.id, mapName: map.name } : {}),
        minRealm: quest.minRealm,
        minRealmName,
        hint: buildMainlineGuideHint({
          questName: quest.name,
          npcName: targetNpc?.name,
          mapName: map?.name,
          status,
        }),
      };
    }

    const map = acceptNpc?.mapId
      ? await db.select({ id: maps.id, name: maps.name })
        .from(maps)
        .where(eq(maps.id, acceptNpc.mapId))
        .get()
      : null;

    return {
      currentQuestId: quest.id,
      status: "available",
      ...(acceptNpc ? { npcId: acceptNpc.id, npcName: acceptNpc.name } : {}),
      ...(map ? { mapId: map.id, mapName: map.name } : {}),
      minRealm: quest.minRealm,
      minRealmName,
      hint: buildMainlineGuideHint({
        questName: quest.name,
        npcName: acceptNpc?.name,
        mapName: map?.name,
        status: "available",
      }),
    };
  }

  if (currentMainQuestId) {
    return {
      currentQuestId: null,
      status: "not_configured",
      hint: "当前主线配置异常，请联系管理员。",
    };
  }

  const status: MainlineGuideStatus = mainQuests.length ? "completed_all" : "not_configured";
  return {
    currentQuestId: null,
    status,
    hint: buildMainlineGuideHint({ status }),
  };
}

export async function computeQuestProgress(
  playerId: string,
  requirementsInput: unknown,
  baseProgressInput: unknown,
): Promise<QuestProgressResult> {
  const requirements = toRequirements(requirementsInput);
  const progress = { ...toProgress(baseProgressInput) };
  const needRealm = requirements.some((req) => req.type === "realm");
  const needPower = requirements.some((req) => req.type === "power");

  let playerRealm = 0;
  let playerPower = 0;
  if (needRealm || needPower) {
    const player = await db.select({
      id: players.id,
      realm: players.realm,
      hp: players.hp,
      maxHp: players.maxHp,
      mp: players.mp,
      maxMp: players.maxMp,
      attack: players.attack,
      defense: players.defense,
      speed: players.speed,
      luck: players.luck,
      spiritualSense: players.spiritualSense,
      armorPenetration: players.armorPenetration,
      block: players.block,
      skillDamageBonus: players.skillDamageBonus,
      skillDamageReduction: players.skillDamageReduction,
      artifactDamageBonus: players.artifactDamageBonus,
      artifactDamageReduction: players.artifactDamageReduction,
    })
      .from(players)
      .where(eq(players.id, playerId))
      .get();

    if (player) {
      playerRealm = player.realm;
      if (needPower) {
        const stats = await buildPlayerStatsSnapshot(player);
        playerPower = calcCombatPower(stats.total);
      }
    }
  }

  for (const req of requirements) {
    const key = getQuestRequirementProgressKey(req);
    if (req.type === "collect") {
      const targetId = typeof req.targetId === "string" ? req.targetId.trim() : "";
      if (!targetId) {
        progress[key] = 0;
        continue;
      }
      const inv = await db.select().from(playerInventory)
        .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, targetId)))
        .get();
      progress[key] = inv?.quantity || 0;
      continue;
    }

    if (req.type === "realm") {
      progress[key] = playerRealm;
      continue;
    }

    if (req.type === "power") {
      progress[key] = playerPower;
    }
  }

  const isComplete = requirements.every((req) => {
    const key = getQuestRequirementProgressKey(req);
    return (progress[key] || 0) >= req.quantity;
  });
  return { progress, isComplete };
}

async function advanceTalkQuestProgressWithExecutor(executor: QuestProgressExecutor, playerId: string, npcId: string): Promise<void> {
  const activeQuests = await executor.select({
    questId: playerQuests.questId,
    progress: playerQuests.progress,
  })
    .from(playerQuests)
    .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.status, "active")))
    .all();

  for (const row of activeQuests) {
    const quest = await executor.select({ requirements: quests.requirements })
      .from(quests)
      .where(eq(quests.id, row.questId))
      .get();
    if (!quest) continue;

    const requirements = toRequirements(quest.requirements);
    const talkReqs = requirements.filter((req) => req.type === "talk" && req.targetId === npcId);
    if (!talkReqs.length) continue;

    const requiredCount = talkReqs.reduce((max, req) => Math.max(max, req.quantity), 0);
    const progress = { ...toProgress(row.progress) };
    const current = progress[npcId] || 0;
    if (current >= requiredCount) continue;

    progress[npcId] = Math.min(requiredCount, current + 1);
    await executor.update(playerQuests)
      .set({ progress })
      .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.questId, row.questId)))
      .run();
  }
}

export async function advanceTalkQuestProgressTx(executor: QuestProgressExecutor, playerId: string, npcId: string): Promise<void> {
  await advanceTalkQuestProgressWithExecutor(executor, playerId, npcId);
}

export async function advanceTalkQuestProgress(playerId: string, npcId: string): Promise<void> {
  await advanceTalkQuestProgressWithExecutor(db, playerId, npcId);
}

async function advanceKillQuestProgressWithExecutor(executor: QuestProgressExecutor, playerId: string, monsterId: string): Promise<void> {
  const activeQuests = await executor.select({
    questId: playerQuests.questId,
    progress: playerQuests.progress,
  })
    .from(playerQuests)
    .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.status, "active")))
    .all();

  for (const row of activeQuests) {
    const quest = await executor.select({ requirements: quests.requirements })
      .from(quests)
      .where(eq(quests.id, row.questId))
      .get();
    if (!quest) continue;

    const requirements = toRequirements(quest.requirements);
    const killReqs = requirements.filter((req) => req.type === "kill" && req.targetId === monsterId);
    if (!killReqs.length) continue;

    const requiredCount = killReqs.reduce((max, req) => Math.max(max, req.quantity), 0);
    const progress = { ...toProgress(row.progress) };
    const current = progress[monsterId] || 0;
    if (current >= requiredCount) continue;

    progress[monsterId] = Math.min(requiredCount, current + 1);
    await executor.update(playerQuests)
      .set({ progress })
      .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.questId, row.questId)))
      .run();
  }
}

export async function advanceKillQuestProgressTx(executor: QuestProgressExecutor, playerId: string, monsterId: string): Promise<void> {
  await advanceKillQuestProgressWithExecutor(executor, playerId, monsterId);
}

export async function advanceKillQuestProgress(playerId: string, monsterId: string): Promise<void> {
  await advanceKillQuestProgressWithExecutor(db, playerId, monsterId);
}

export async function getPlayerNpcBountyDailyStatus(playerId: string, npcId: string): Promise<BountyDailyStatus | null> {
  const npc = await db.select({
    bountyEnabled: npcs.bountyEnabled,
    bountyDailyLimit: npcs.bountyDailyLimit,
  })
    .from(npcs)
    .where(eq(npcs.id, npcId))
    .get();

  if (!npc?.bountyEnabled) {
    return null;
  }

  const dateKey = getShanghaiDateKey();
  const usage = await db.select({
    usedCount: playerNpcBountyDaily.usedCount,
  })
    .from(playerNpcBountyDaily)
    .where(and(
      eq(playerNpcBountyDaily.playerId, playerId),
      eq(playerNpcBountyDaily.npcId, npcId),
      eq(playerNpcBountyDaily.dateKey, dateKey),
    ))
    .get();

  const usedCount = usage?.usedCount || 0;
  const dailyLimit = Math.max(0, npc.bountyDailyLimit);
  return {
    dateKey,
    dailyLimit,
    usedCount,
    remainingCount: Math.max(0, dailyLimit - usedCount),
  };
}

async function increasePlayerNpcBountyDailyUsage(playerId: string, npcId: string): Promise<void> {
  const now = new Date().toISOString();
  const dateKey = getShanghaiDateKey();
  const usage = await db.select({
    id: playerNpcBountyDaily.id,
    usedCount: playerNpcBountyDaily.usedCount,
  })
    .from(playerNpcBountyDaily)
    .where(and(
      eq(playerNpcBountyDaily.playerId, playerId),
      eq(playerNpcBountyDaily.npcId, npcId),
      eq(playerNpcBountyDaily.dateKey, dateKey),
    ))
    .get();

  if (!usage) {
    await db.insert(playerNpcBountyDaily)
      .values({
        playerId,
        npcId,
        dateKey,
        usedCount: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return;
  }

  await db.update(playerNpcBountyDaily)
    .set({
      usedCount: usage.usedCount + 1,
      updatedAt: now,
    })
    .where(eq(playerNpcBountyDaily.id, usage.id))
    .run();
}

async function hasActiveBountyQuestAtNpc(playerId: string, npcId: string): Promise<boolean> {
  const row = await db.select({
    questId: playerQuests.questId,
  })
    .from(playerQuests)
    .innerJoin(quests, eq(playerQuests.questId, quests.id))
    .where(and(
      eq(playerQuests.playerId, playerId),
      eq(playerQuests.status, "active"),
      eq(quests.questType, BOUNTY_QUEST_TYPE),
      eq(quests.acceptNpcId, npcId),
    ))
    .get();

  return Boolean(row);
}

export async function acceptRandomBountyQuestForPlayer(params: {
  playerId: string;
  npcId: string;
}): Promise<QuestServiceResult<AcceptQuestResult>> {
  const { playerId, npcId } = params;

  const player = await getPlayerByIdCompat(playerId);
  if (!player) return { success: false, error: "玩家不存在" };

  const npc = await db.select({
    id: npcs.id,
    bountyEnabled: npcs.bountyEnabled,
    bountyDailyLimit: npcs.bountyDailyLimit,
  })
    .from(npcs)
    .where(eq(npcs.id, npcId))
    .get();
  if (!npc) return { success: false, error: "NPC不存在" };
  if (!npc.bountyEnabled) return { success: false, error: "该NPC未开启悬赏功能" };
  if (npc.bountyDailyLimit < 1) return { success: false, error: "该NPC未配置每日悬赏次数" };

  if (await hasActiveBountyQuestAtNpc(playerId, npcId)) {
    return { success: false, error: "该NPC已有进行中的悬赏任务" };
  }

  const dailyStatus = await getPlayerNpcBountyDailyStatus(playerId, npcId);
  if (!dailyStatus || dailyStatus.remainingCount < 1) {
    return { success: false, error: "今日悬赏次数已用尽" };
  }

  const bountyQuests = await db.select().from(quests)
    .where(and(eq(quests.acceptNpcId, npcId), eq(quests.questType, BOUNTY_QUEST_TYPE)))
    .all();
  if (!bountyQuests.length) {
    return { success: false, error: "暂无可分配悬赏任务" };
  }

  const allPlayerQuestRows = await db.select({
    questId: playerQuests.questId,
    status: playerQuests.status,
  })
    .from(playerQuests)
    .where(eq(playerQuests.playerId, playerId))
    .all();

  const playerQuestStatus = new Map(allPlayerQuestRows.map((row) => [row.questId, row.status]));
  const completedQuestIds = new Set(
    allPlayerQuestRows
      .filter((row) => row.status === "completed")
      .map((row) => row.questId),
  );

  const candidates = bountyQuests.filter((quest) => {
    if (quest.acceptNpcId !== npcId) return false;
    if (player.realm < quest.minRealm) return false;
    const maxRealm = resolveQuestMaxRealm(quest.maxRealm, quest.minRealm);
    if (maxRealm !== null && player.realm > maxRealm) return false;
    if (!hasCompletedPrerequisitesFromStatusMap(quest.prerequisites, completedQuestIds)) return false;

    const status = playerQuestStatus.get(quest.id);
    if (status === "active") return false;
    return true;
  });

  if (!candidates.length) {
    return { success: false, error: "当前境界暂无可接悬赏" };
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  const result = await acceptQuestForPlayer({
    playerId,
    npcId,
    questId: selected.id,
    allowBountyDirect: true,
  });

  if (!result.success) {
    return result;
  }

  await increasePlayerNpcBountyDailyUsage(playerId, npcId);
  return result;
}

export async function acceptQuestForPlayer(params: {
  playerId: string;
  questId: string;
  npcId: string;
  allowBountyDirect?: boolean;
}): Promise<QuestServiceResult<AcceptQuestResult>> {
  const { playerId, questId, npcId } = params;

  const player = await getPlayerByIdCompat(playerId);
  if (!player) return { success: false, error: "玩家不存在" };

  const quest = await db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!quest) return { success: false, error: "任务不存在" };

  const isMainQuest = toQuestCategory(quest.questCategory) === MAIN_QUEST_CATEGORY;
  const isBountyQuest = quest.questType === BOUNTY_QUEST_TYPE;

  if (quest.acceptNpcId !== npcId) {
    return { success: false, error: "该任务不属于当前NPC" };
  }

  if (isBountyQuest && !params.allowBountyDirect) {
    return { success: false, error: "悬赏任务需随机接取" };
  }

  if (player.realm < quest.minRealm) {
    return { success: false, error: "境界不足" };
  }

  const maxRealm = resolveQuestMaxRealm(quest.maxRealm, quest.minRealm);
  if (maxRealm !== null && player.realm > maxRealm) {
    return { success: false, error: "境界不符" };
  }

  if (isMainQuest) {
    const currentMainQuestId = await resolveCurrentMainQuestId({
      id: player.id,
      currentMainQuestId: player.currentMainQuestId,
    });

    if (!currentMainQuestId) {
      return { success: false, error: "主线已全部完成" };
    }

    if (currentMainQuestId !== questId) {
      return { success: false, error: "请先推进当前主线" };
    }

    const mainQuests = await loadMainQuestRefs();
    const mainQuestIdSet = new Set(mainQuests.map((item) => item.id));
    const activeMainQuestId = await findActiveMainQuestId(player.id, mainQuestIdSet);
    if (activeMainQuestId && activeMainQuestId !== questId) {
      return { success: false, error: "已有进行中的主线任务" };
    }
  }

  const prereqOk = await hasCompletedPrerequisites(player.id, quest.prerequisites);
  if (!prereqOk) {
    return { success: false, error: "需先完成前置任务" };
  }

  const existing = await db.select().from(playerQuests)
    .where(and(eq(playerQuests.playerId, player.id), eq(playerQuests.questId, questId)))
    .get();

  if (existing?.status === "active") {
    return { success: false, error: "任务已在进行中" };
  }

  if (existing?.status === "completed") {
    if (isMainQuest) {
      return { success: false, error: "主线任务不可重复" };
    }
    const questRepeatable = isBountyQuest ? true : quest.repeatable;
    if (!questRepeatable) {
      return { success: false, error: "任务已完成且不可重复" };
    }
    // 每日重复任务：同一自然日只能办一次，否则可无限刷奖励
    if (
      quest.repeatCycle === "daily"
      && existing.completedAt
      && getShanghaiDateKey(new Date(existing.completedAt)) === getShanghaiDateKey()
    ) {
      return { success: false, error: "今日已办过，明日再来" };
    }
  }

  if (existing) {
    await db.update(playerQuests)
      .set({
        status: "active",
        progress: {},
        acceptedAt: new Date().toISOString(),
        completedAt: null,
      })
      .where(and(eq(playerQuests.playerId, player.id), eq(playerQuests.questId, questId)))
      .run();
  } else {
    await db.insert(playerQuests)
      .values({
        playerId: player.id,
        questId,
        status: "active",
        progress: {},
        acceptedAt: new Date().toISOString(),
      })
      .run();
  }

  const hint = isMainQuest
    ? (await buildMainlineGuide(player.id)).hint
    : "可去历练提升进度，完成后再回来交任务。";

  return {
    success: true,
    data: {
      questId: quest.id,
      questName: quest.name,
      hint,
      story: quest.acceptStory || undefined,
    },
  };
}

export async function completeQuestForPlayer(params: {
  playerId: string;
  questId: string;
  npcId: string;
}): Promise<QuestServiceResult<CompleteQuestResult>> {
  const { playerId, questId, npcId } = params;

  const player = await getPlayerByIdCompat(playerId);
  if (!player) return { success: false, error: "玩家不存在" };

  const quest = await db.select().from(quests).where(eq(quests.id, questId)).get();
  if (!quest) return { success: false, error: "任务不存在" };

  const isMainQuest = toQuestCategory(quest.questCategory) === MAIN_QUEST_CATEGORY;

  if (quest.completeNpcId !== npcId) {
    return { success: false, error: "该任务不属于当前NPC" };
  }

  const pq = await db.select().from(playerQuests)
    .where(and(eq(playerQuests.playerId, player.id), eq(playerQuests.questId, questId)))
    .get();

  if (!pq || pq.status !== "active") {
    return { success: false, error: "任务不在进行中" };
  }

  const reqs = toRequirements(quest.requirements);
  const { progress } = await computeQuestProgress(player.id, quest.requirements, pq.progress);

  for (const req of reqs) {
    const key = getQuestRequirementProgressKey(req);
    if ((progress[key] || 0) < req.quantity) {
      return { success: false, error: req.type === "collect" ? "材料不足" : "任务条件未完成" };
    }
  }

  for (const req of reqs) {
    if (req.type !== "collect") continue;
    const targetId = typeof req.targetId === "string" ? req.targetId.trim() : "";
    if (!targetId) continue;

    const inv = await db.select().from(playerInventory)
      .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, targetId)))
      .get();

    if (!inv) continue;

    if (inv.quantity <= req.quantity) {
      await db.delete(playerInventory)
        .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, targetId)))
        .run();
    } else {
      await db.update(playerInventory)
        .set({ quantity: inv.quantity - req.quantity })
        .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, targetId)))
        .run();
    }
  }

  const rewards = (quest.rewards as QuestReward | null) || {};
  const baseXp = Math.max(0, Math.floor(Number(rewards.xp || 0)));
  const xpGain = baseXp > 0
    ? await applyXpRateForPlayer({
      playerId: player.id,
      baseXp,
      channel: "quest",
    })
    : 0;
  const goldGain = Math.max(0, Math.floor(Number(rewards.gold || 0)));

  if (xpGain > 0 || goldGain > 0) {
    await db.update(players)
      .set({
        cultivationXp: player.cultivationXp + xpGain,
        gold: player.gold + goldGain,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(players.id, player.id))
      .run();
  }

  if (rewards.items?.length) {
    for (const rewardItem of rewards.items) {
      const existing = await db.select().from(playerInventory)
        .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, rewardItem.itemId)))
        .get();

      if (existing) {
        await db.update(playerInventory)
          .set({ quantity: existing.quantity + rewardItem.quantity })
          .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, rewardItem.itemId)))
          .run();
      } else {
        await db.insert(playerInventory)
          .values({
            playerId: player.id,
            itemId: rewardItem.itemId,
            quantity: rewardItem.quantity,
          })
          .run();
      }
    }
  }

  const rewardFortuneIds = Array.isArray(rewards.fortuneIds)
    ? [...new Set(rewards.fortuneIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const fortuneGrantResults = rewardFortuneIds.length > 0
    ? await grantFortunesToPlayer({
      playerId: player.id,
      fortuneIds: rewardFortuneIds,
      sourceType: "quest",
      sourceRef: quest.id,
    })
    : [];
  const grantedFortuneIds = fortuneGrantResults
    .filter((row) => row.action !== "skipped")
    .map((row) => row.fortuneId);
  const visibleGrantedFortuneIds = grantedFortuneIds.length > 0
    ? await db.select({ id: fortunes.id })
      .from(fortunes)
      .where(and(
        inArray(fortunes.id, grantedFortuneIds),
        eq(fortunes.isHidden, false),
      ))
      .all()
    : [];
  const visibleGrantedFortuneIdSet = new Set(visibleGrantedFortuneIds.map((row) => row.id));
  const visibleGrantedFortuneIdList = grantedFortuneIds.filter((id) => visibleGrantedFortuneIdSet.has(id));

  const rewardsForResponse: CompleteQuestResult["rewards"] = {
    ...rewards,
    xp: xpGain,
    gold: goldGain,
    fortuneIds: visibleGrantedFortuneIdList.length > 0 ? visibleGrantedFortuneIdList : undefined,
  };

  if (rewards.items?.length) {
    rewardsForResponse.items = await Promise.all(rewards.items.map(async (rewardItem) => {
      const item = await db.select({
        name: items.name,
        iconUrl: items.iconUrl,
      })
        .from(items)
        .where(eq(items.id, rewardItem.itemId))
        .get();

      return {
        ...rewardItem,
        itemName: item?.name || rewardItem.itemId,
        itemIconUrl: item?.iconUrl || null,
      };
    }));
  }

  await db.update(playerQuests)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(and(eq(playerQuests.playerId, player.id), eq(playerQuests.questId, questId)))
    .run();

  if (isMainQuest) {
    const mainQuests = await loadMainQuestRefs();
    const nextQuestId = findDirectNextMainQuestId(mainQuests, quest.id);
    await db.update(players)
      .set({
        currentMainQuestId: nextQuestId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(players.id, player.id))
      .run();
  }

  const hint = isMainQuest
    ? (await buildMainlineGuide(player.id)).hint
    : "若还想接新委托，可继续与NPC对话。";

  return {
    success: true,
    data: {
      questId: quest.id,
      questName: quest.name,
      rewards: rewardsForResponse,
      hint,
      story: quest.completeStory || undefined,
    },
  };
}
