import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { maps, mapEdges, npcs, playerQuests, players, quests } from "@/db/schema";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getMapDailyRumors } from "@/modules/map/services/map-rumor-service";
import {
  acceptRandomBountyQuestForPlayer,
  acceptQuestForPlayer,
  buildMainlineGuide,
  completeQuestForPlayer,
  computeQuestProgress,
  getPlayerNpcBountyDailyStatus,
} from "@/modules/quest/services/quest-service";
import { getSafeWorldQuestActionGate } from "@/modules/world/services/player-world-pressure-service";
import {
  getQuestRequirementActionText,
  getQuestRequirementProgressKey,
  getQuestRequirementTargetName,
} from "@/modules/quest/services/quest-requirement";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import type { AiToolCall, AiToolDefinition } from "@/modules/ai/services/ai";
import type { QuestRequirement } from "@/types/game";

export type NpcEventType = "quest.accepted" | "quest.completed";

export interface NpcEvent {
  type: NpcEventType;
  payload: Record<string, unknown>;
}

export interface NpcQuestActionItem {
  id: string;
  name: string;
  description: string;
  questType: "talk" | "kill" | "collect" | "detect" | "bounty";
  questCategory: "main" | "side";
  state: "可接取" | "进行中" | "可提交" | "暂不可接" | "已完成";
  reason?: string;
  hint?: string;
  minRealm?: number;
  maxRealm?: number;
  minRealmName?: string;
  maxRealmName?: string;
  hideBeforeAccept?: boolean;
  bountyDailyLimit?: number;
  bountyUsedCount?: number;
  bountyRemainingCount?: number;
}

export interface NpcToolExecutionResult {
  toolName: string;
  resultText: string;
  event?: NpcEvent;
}

const BOUNTY_BOARD_ID = "__bounty_board__";
const BOUNTY_BOARD_NAME = "悬赏任务";

function resolveDirectionText(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) {
    return "就在你跟前";
  }

  const horizontal = dx > 0 ? "东" : dx < 0 ? "西" : "";
  const vertical = dy > 0 ? "南" : dy < 0 ? "北" : "";
  const prefix = `${vertical}${horizontal}` || "附近";
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const distance = steps <= 1 ? "不远" : steps <= 3 ? "几步外" : "稍远些";
  return `${prefix}边，${distance}`;
}

async function getPlayerMapNavigationContext(playerId: string) {
  const player = await db.select({
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
    realmName: players.realmName,
  }).from(players).where(eq(players.id, playerId)).get();
  if (!player?.currentMapId) {
    return null;
  }

  const mapRow = await db.select({
    id: maps.id,
    name: maps.name,
    tilesData: maps.tilesData,
  }).from(maps).where(eq(maps.id, player.currentMapId)).get();
  if (!mapRow) {
    return null;
  }

  const npcRows = await db.select({
    id: npcs.id,
    name: npcs.name,
    title: npcs.title,
    mapId: npcs.mapId,
    positionX: npcs.positionX,
    positionY: npcs.positionY,
  }).from(npcs).all();
  const currentMapNpcs = npcRows.filter((npc) => npc.mapId === player.currentMapId);
  const edgeRows = await db.select({
    mapAId: mapEdges.mapAId,
    mapBId: mapEdges.mapBId,
  }).from(mapEdges).where(or(
    eq(mapEdges.mapAId, player.currentMapId),
    eq(mapEdges.mapBId, player.currentMapId),
  )).all();
  const linkedMapIds = [...new Set(edgeRows.map((edge) => (
    edge.mapAId === player.currentMapId ? edge.mapBId : edge.mapAId
  )))];
  const linkedMaps = linkedMapIds.length > 0
    ? await db.select({
      id: maps.id,
      name: maps.name,
      mapType: maps.mapType,
    }).from(maps).where(inArray(maps.id, linkedMapIds)).all()
    : [];
  const portalTiles = Array.isArray(mapRow.tilesData)
    ? mapRow.tilesData
      .filter((tile) => tile && typeof tile === "object" && !Array.isArray(tile))
      .map((tile) => tile as unknown as Record<string, unknown>)
      .filter((tile) => String(tile.type || "").trim() === "portal")
      .map((tile, index) => ({
        id: String(tile.portalId || `portal_${index + 1}`),
        name: String(tile.portalName || `传送阵(${tile.x},${tile.y})`),
        targetMapId: String(tile.portalTargetMapId || "").trim(),
        targetMapName: String(tile.portalTargetName || "").trim(),
        x: Number(tile.x || 0),
        y: Number(tile.y || 0),
      }))
    : [];

  return {
    player,
    mapRow,
    npcRows,
    currentMapNpcs,
    linkedMaps,
    portalTiles,
  };
}

export function getNpcTaskToolDefinitions(): AiToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "list_npc_quests",
        description: "列出当前NPC相关委托及状态（可接取/进行中/可提交/暂不可接/已完成），供玩家确认要办哪一件。",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "accept_npc_quest",
        description: "为当前玩家接取当前NPC可接取的指定任务。",
        parameters: {
          type: "object",
          properties: {
            questId: {
              type: "string",
              description: "任务ID（先通过 list_npc_quests 获取）",
            },
            questName: {
              type: "string",
              description: "任务名称（不便提供ID时可用）",
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "complete_npc_quest",
        description: "为当前玩家提交当前NPC可提交且满足条件的指定任务。",
        parameters: {
          type: "object",
          properties: {
            questId: {
              type: "string",
              description: "任务ID（先通过 list_npc_quests 获取）",
            },
            questName: {
              type: "string",
              description: "任务名称（不便提供ID时可用）",
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_map_rumors",
        description: "打听当前地图今日流传的传闻、秘境风闻与值得注意的消息。同图同日共享。",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "locate_npc",
        description: "打听某位 NPC 在哪里。若对方不在当前地图，只回答所在地图与当前可走的下一跳。",
        parameters: {
          type: "object",
          properties: {
            targetNpcName: {
              type: "string",
              description: "想找的 NPC 名字",
            },
          },
          required: ["targetNpcName"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_map_exits",
        description: "说明当前地图有哪些出口、传送入口或相邻地图，适合回答问路。",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
  ];
}

export function encodeNpcEvent(event: NpcEvent): string {
  return `[EVENT][${event.type}]${JSON.stringify(event.payload)}`;
}

export function decodeNpcEvent(content: string): NpcEvent | null {
  const match = content.match(/^\[EVENT\]\[([^\]]+)\](\{[\s\S]*\})$/);
  if (!match) return null;

  const eventType = match[1];
  if (eventType !== "quest.accepted" && eventType !== "quest.completed") {
    return null;
  }

  try {
    const payload = JSON.parse(match[2]) as Record<string, unknown>;
    return {
      type: eventType,
      payload,
    };
  } catch {
    return null;
  }
}

function toQuestType(value: unknown): "talk" | "kill" | "collect" | "detect" | "bounty" {
  if (value === "talk" || value === "kill" || value === "collect" || value === "detect" || value === "bounty") {
    return value;
  }
  return "detect";
}

function resolveQuestMaxRealm(maxRealm: unknown, minRealm: number): number | null {
  if (typeof maxRealm !== "number" || !Number.isFinite(maxRealm) || maxRealm < minRealm) {
    return null;
  }
  return Math.floor(maxRealm);
}

export function buildNpcQuestVisibleList(questList: NpcQuestActionItem[]) {
  const hiddenBounty = questList.filter((item) => item.questType === "bounty" && item.hideBeforeAccept);
  const visibleList = questList.filter((item) => !(item.questType === "bounty" && item.hideBeforeAccept));

  if (!hiddenBounty.length) {
    return {
      quests: visibleList,
      bountyBoard: null as NpcQuestActionItem | null,
    };
  }

  const minRealm = hiddenBounty.reduce((min, item) => {
    const current = typeof item.minRealm === "number" ? item.minRealm : 1;
    return Math.min(min, current);
  }, Number.MAX_SAFE_INTEGER);
  const maxRealm = hiddenBounty.reduce((max, item) => {
    const currentMin = typeof item.minRealm === "number" ? item.minRealm : 1;
    const current = typeof item.maxRealm === "number" ? item.maxRealm : currentMin;
    return Math.max(max, current);
  }, 1);
  const minRealmItem = hiddenBounty.reduce((best, item) => {
    const current = typeof item.minRealm === "number" ? item.minRealm : 1;
    const bestValue = typeof best.minRealm === "number" ? best.minRealm : 1;
    return current < bestValue ? item : best;
  }, hiddenBounty[0]);
  const maxRealmItem = hiddenBounty.reduce((best, item) => {
    const currentMin = typeof item.minRealm === "number" ? item.minRealm : 1;
    const current = typeof item.maxRealm === "number" ? item.maxRealm : currentMin;
    const bestMin = typeof best.minRealm === "number" ? best.minRealm : 1;
    const bestValue = typeof best.maxRealm === "number" ? best.maxRealm : bestMin;
    return current > bestValue ? item : best;
  }, hiddenBounty[0]);
  const minRealmName = minRealmItem.minRealmName || `${minRealm}`;
  const maxRealmName = maxRealmItem.maxRealmName || maxRealmItem.minRealmName || `${maxRealm}`;

  const dailyLimit = hiddenBounty.find((item) => typeof item.bountyDailyLimit === "number")?.bountyDailyLimit;
  const usedCount = hiddenBounty.find((item) => typeof item.bountyUsedCount === "number")?.bountyUsedCount;
  const remainingCount = hiddenBounty.find((item) => typeof item.bountyRemainingCount === "number")?.bountyRemainingCount;
  const availableCount = hiddenBounty.filter((item) => item.state === "可接取").length;
  const state: NpcQuestActionItem["state"] = availableCount > 0 ? "可接取" : "暂不可接";

  let hint = availableCount > 0
    ? `可随机接取 ${availableCount} 个悬赏。`
    : hiddenBounty.find((item) => item.hint)?.hint || "当前暂无可接悬赏。";
  if (typeof dailyLimit === "number") {
    const remaining = Math.max(0, remainingCount ?? 0);
    hint = `${hint} 今日剩余 ${remaining}/${dailyLimit}。`;
  }

  const bountyBoard: NpcQuestActionItem = {
    id: BOUNTY_BOARD_ID,
    name: BOUNTY_BOARD_NAME,
    description: `随机匹配任务（境界 ${minRealmName}-${maxRealmName}）。`,
    questType: "bounty",
    questCategory: "side",
    state,
    ...(state === "暂不可接"
      ? { reason: hiddenBounty.find((item) => item.reason)?.reason || "当前不可接取" }
      : {}),
    hint,
    minRealm,
    maxRealm,
    minRealmName,
    maxRealmName,
    ...(typeof dailyLimit === "number" ? { bountyDailyLimit: dailyLimit } : {}),
    ...(typeof usedCount === "number" ? { bountyUsedCount: usedCount } : {}),
    ...(typeof remainingCount === "number" ? { bountyRemainingCount: remainingCount } : {}),
  };

  return {
    quests: [bountyBoard, ...visibleList],
    bountyBoard,
  };
}

function parseArguments(args: string): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function cleanupQuestName(input: string): string {
  let name = (input || "").trim();
  const wrappers = [
    ["「", "」"],
    ["“", "”"],
    ["\"", "\""],
    ["'", "'"],
  ] as const;
  for (const [left, right] of wrappers) {
    if (name.startsWith(left) && name.endsWith(right) && name.length > left.length + right.length) {
      name = name.slice(left.length, name.length - right.length).trim();
    }
  }
  return name;
}

async function resolveNpcQuestIdByName(params: {
  npcId: string;
  questName: string;
  mode: "accept" | "complete";
}): Promise<{ questId: string | null; ambiguous: boolean }> {
  const name = cleanupQuestName(params.questName);
  if (!name) return { questId: null, ambiguous: false };

  const whereNpc = params.mode === "accept"
    ? eq(quests.acceptNpcId, params.npcId)
    : eq(quests.completeNpcId, params.npcId);

  const matches = await db.select({ id: quests.id })
    .from(quests)
    .where(and(eq(quests.name, name), whereNpc))
    .all();

  if (matches.length === 1) return { questId: matches[0].id, ambiguous: false };
  if (matches.length > 1) return { questId: null, ambiguous: true };
  return { questId: null, ambiguous: false };
}

export async function buildNpcQuestActionList(playerId: string, npcId: string): Promise<NpcQuestActionItem[]> {
  const npc = await db.select().from(npcs).where(eq(npcs.id, npcId)).get();
  if (!npc) return [];

  const player = await getPlayerByIdCompat(playerId);
  if (!player) return [];

  const npcQuestRows = await db.select().from(quests)
    .where(or(eq(quests.acceptNpcId, npcId), eq(quests.completeNpcId, npcId)))
    .all();
  const npcQuestIds = npcQuestRows.map((quest) => quest.id).sort((a, b) => a.localeCompare(b));
  const npcQuestMap = new Map(npcQuestRows.map((quest) => [quest.id, quest]));
  const list: NpcQuestActionItem[] = [];
  const mainlineGuide = await buildMainlineGuide(playerId);
  const currentMainQuestId = mainlineGuide.currentQuestId;
  const bountyDaily = await getPlayerNpcBountyDailyStatus(playerId, npcId);
  const realmNameCache = new Map<number, string>();
  const resolveRealmName = async (realmValue: number) => {
    const safeRealm = Math.max(1, Math.floor(Number(realmValue) || 1));
    const cached = realmNameCache.get(safeRealm);
    if (cached) {
      return cached;
    }
    const name = await getRealmFullNameByLinearRealm(safeRealm);
    realmNameCache.set(safeRealm, name);
    return name;
  };

  const playerQuestRows = npcQuestIds.length
    ? await db.select({
      questId: playerQuests.questId,
      status: playerQuests.status,
      progress: playerQuests.progress,
    })
      .from(playerQuests)
      .where(and(eq(playerQuests.playerId, playerId), inArray(playerQuests.questId, npcQuestIds)))
      .all()
    : [];

  const playerQuestMap = new Map(playerQuestRows.map((row) => [row.questId, row]));
  const completedQuestRows = await db.select({ questId: playerQuests.questId })
    .from(playerQuests)
    .where(and(eq(playerQuests.playerId, playerId), eq(playerQuests.status, "completed")))
    .all();
  const completedQuestIdSet = new Set(completedQuestRows.map((row) => row.questId));

  const hasActiveBountyAtNpc = npcQuestRows.some((quest) => {
    if (quest.questType !== "bounty") return false;
    if (quest.acceptNpcId !== npcId) return false;
    return playerQuestMap.get(quest.id)?.status === "active";
  });

  for (const questId of npcQuestIds) {
    const quest = npcQuestMap.get(questId);
    if (!quest) continue;
    const isMainQuest = quest.questCategory === "main";
    const isBountyQuest = quest.questType === "bounty";
    const questMaxRealm = resolveQuestMaxRealm(quest.maxRealm, quest.minRealm);
    const bountyMinRealmName = isBountyQuest ? await resolveRealmName(quest.minRealm) : undefined;
    const bountyMaxRealmName = isBountyQuest && questMaxRealm !== null
      ? await resolveRealmName(questMaxRealm)
      : undefined;
    const bountyRangeMaxRealmName = bountyMaxRealmName ?? bountyMinRealmName;

    const pq = playerQuestMap.get(quest.id);
    const playerStatus = pq?.status || "available";
    const { progress, isComplete } = await computeQuestProgress(playerId, quest.requirements, pq?.progress);

    const prereqs = Array.isArray(quest.prerequisites) ? quest.prerequisites : [];
    let prereqOk = true;
    let missingPrereqId: string | null = null;
    for (const preId of prereqs) {
      if (!completedQuestIdSet.has(preId)) {
        prereqOk = false;
        missingPrereqId = preId;
        break;
      }
    }

    let state: NpcQuestActionItem["state"] = "暂不可接";
    let reason: string | undefined;
    let hint: string | undefined;

    if (playerStatus === "active") {
      if (isComplete && quest.completeNpcId === npcId) {
        state = "可提交";
        hint = "此事你已办妥，可来交差。";
      } else if (isComplete) {
        state = "进行中";
        hint = "此事你已办妥，去找负责验收的人交差。";
      } else {
        state = "进行中";
        const reqs = (quest.requirements as QuestRequirement[] | null) || [];
        const unmet = reqs.find((r) => {
          const key = getQuestRequirementProgressKey(r);
          return (progress[key] || 0) < r.quantity;
        });
        if (unmet) {
          const key = getQuestRequirementProgressKey(unmet);
          const current = progress[key] || 0;
          const action = getQuestRequirementActionText(unmet.type);
          const targetName = getQuestRequirementTargetName(unmet);
          if (unmet.type === "realm") {
            const [currentRealmName, targetRealmName] = await Promise.all([
              resolveRealmName(current),
              resolveRealmName(unmet.quantity),
            ]);
            hint = `还差：${action} ${currentRealmName}/${targetRealmName}。`;
          } else if (unmet.type === "power") {
            hint = `还差：${action} ${current}/${unmet.quantity}。`;
          } else {
            hint = `还差：${action}${targetName} ${current}/${unmet.quantity}。`;
          }
        } else {
          hint = "此事尚未办妥，按委托要求去做便是。";
        }
      }
    } else if (playerStatus === "completed") {
      const canRepeat = isBountyQuest ? true : quest.repeatable;
      if (!isMainQuest && canRepeat && quest.acceptNpcId === npcId) {
        if (isBountyQuest && hasActiveBountyAtNpc) {
          state = "暂不可接";
          reason = "本处已有进行中的悬赏";
          hint = "你在我这儿已有悬赏未交，先办完再来抽新悬赏。";
        } else if (isBountyQuest && bountyDaily && bountyDaily.remainingCount < 1) {
          state = "暂不可接";
          reason = "今日悬赏次数已用尽";
          hint = "今日悬赏名额已用尽，明日再来。";
        } else if (player.realm < quest.minRealm || (questMaxRealm !== null && player.realm > questMaxRealm)) {
          state = "暂不可接";
          reason = "境界不符";
          hint = questMaxRealm !== null
            ? `此悬赏只接境界 ${bountyMinRealmName || quest.minRealm}-${bountyMaxRealmName || questMaxRealm} 的修士。`
            : `此悬赏只接境界 ${bountyMinRealmName || quest.minRealm} 及以上的修士。`;
        } else if (!prereqOk) {
          state = "暂不可接";
          reason = "尚有前置未了";
          hint = "先把前面的事办妥，再来接此委托。";
        } else {
          state = "可接取";
          hint = isBountyQuest
            ? "可抽取新的悬赏，接取后才会公布具体内容。"
            : "此委托可重复，你若还想做，再说一声即可。";
        }
      } else {
        state = "已完成";
        hint = "此委托已了结。";
      }
    } else {
      if (quest.acceptNpcId !== npcId) {
        state = "暂不可接";
        reason = "此处仅可交付";
        hint = "此委托不由我发放，你去找发布者接取。";
      } else if (isMainQuest && !currentMainQuestId) {
        state = mainlineGuide.status === "completed_all" ? "已完成" : "暂不可接";
        reason = mainlineGuide.status === "not_configured" ? "主线未配置" : undefined;
        hint = mainlineGuide.hint;
      } else if (isMainQuest && currentMainQuestId !== quest.id) {
        state = "暂不可接";
        reason = "需先推进当前主线";
        hint = "主线需按顺序办理，先把当前那件办妥。";
      } else if (isBountyQuest && !npc.bountyEnabled) {
        state = "暂不可接";
        reason = "发布者未开启悬赏";
        hint = "这处悬赏暂未开放。";
      } else if (isBountyQuest && hasActiveBountyAtNpc) {
        state = "暂不可接";
        reason = "本处已有进行中的悬赏";
        hint = "你在我这儿已有悬赏未交，先办完再来抽新悬赏。";
      } else if (isBountyQuest && bountyDaily && bountyDaily.remainingCount < 1) {
        state = "暂不可接";
        reason = "今日悬赏次数已用尽";
        hint = "今日悬赏名额已用尽，明日再来。";
      } else if (player.realm < quest.minRealm || (questMaxRealm !== null && player.realm > questMaxRealm)) {
        state = "暂不可接";
        reason = "境界不符";
        hint = isBountyQuest
          ? (questMaxRealm !== null
            ? `此悬赏只接境界 ${bountyMinRealmName || quest.minRealm}-${bountyMaxRealmName || questMaxRealm} 的修士。`
            : `此悬赏只接境界 ${bountyMinRealmName || quest.minRealm} 及以上的修士。`)
          : "先去修炼或历练提升境界，再来问我。";
      } else if (!prereqOk) {
        state = "暂不可接";
        if (missingPrereqId) {
          const preQuest = await db.select({ name: quests.name }).from(quests).where(eq(quests.id, missingPrereqId)).get();
          reason = preQuest?.name ? `需先办妥「${preQuest.name}」` : "尚有前置未了";
        } else {
          reason = "尚有前置未了";
        }
        hint = "先把前面的事办妥，再来接此委托。";
      } else {
        state = "可接取";
        hint = isBountyQuest
          ? "可抽取新的悬赏，接取后才会公布具体内容。"
          : "你若要接，报上委托名，我便替你记下。";
      }
    }

    if (state === "可接取" && !isMainQuest) {
      const worldGate = await getSafeWorldQuestActionGate({
        playerId,
        npcId,
        questCategory: isMainQuest ? "main" : "side",
        questType: quest.questType,
      });
      if (!worldGate.allowed) {
        state = "暂不可接";
        reason = "风声过紧";
        hint = worldGate.reason || "你最近的风声太紧，此事暂时不便交给你。";
      }
    }

    list.push({
      id: quest.id,
      name: quest.name,
      description: quest.description || "",
      questType: toQuestType(quest.questType),
      questCategory: isMainQuest ? "main" : "side",
      state,
      ...(reason ? { reason } : {}),
      ...(hint ? { hint } : {}),
      ...(isBountyQuest ? {
        minRealm: quest.minRealm,
        ...(bountyMinRealmName ? { minRealmName: bountyMinRealmName } : {}),
        ...(questMaxRealm !== null ? { maxRealm: questMaxRealm } : {}),
        ...(bountyRangeMaxRealmName ? { maxRealmName: bountyRangeMaxRealmName } : {}),
        hideBeforeAccept: state === "可接取" || state === "暂不可接",
        ...(bountyDaily ? {
          bountyDailyLimit: bountyDaily.dailyLimit,
          bountyUsedCount: bountyDaily.usedCount,
          bountyRemainingCount: bountyDaily.remainingCount,
        } : {}),
      } : {}),
    });
  }

  return list;
}

export async function executeNpcToolCall(params: {
  playerId: string;
  npcId: string;
  toolCall: AiToolCall;
}): Promise<NpcToolExecutionResult> {
  const { playerId, npcId, toolCall } = params;

  if (toolCall.name === "list_npc_quests") {
    const questList = await buildNpcQuestActionList(playerId, npcId);
    const visible = buildNpcQuestVisibleList(questList);
    return {
      toolName: toolCall.name,
      resultText: JSON.stringify({
        quests: visible.quests,
        bountyBoard: visible.bountyBoard,
      }),
    };
  }

  if (toolCall.name === "list_map_rumors") {
    const navigation = await getPlayerMapNavigationContext(playerId);
    if (!navigation) {
      return {
        toolName: toolCall.name,
        resultText: JSON.stringify({ success: false, error: "当前地图信息缺失" }),
      };
    }

    const rumors = await getMapDailyRumors({
      playerId,
      mapId: navigation.mapRow.id,
      playerRealmName: navigation.player.realmName || "凡人",
    });
    return {
      toolName: toolCall.name,
      resultText: JSON.stringify({
        mapId: rumors.mapId,
        dateKey: rumors.dateKey,
        headline: rumors.headline,
        source: rumors.source,
        rumors: rumors.rumors,
        fixedFacts: rumors.fixedFacts,
      }),
    };
  }

  if (toolCall.name === "locate_npc") {
    const args = parseArguments(toolCall.arguments);
    const targetNpcName = typeof args.targetNpcName === "string" ? cleanupQuestName(args.targetNpcName) : "";
    if (!targetNpcName) {
      return { toolName: toolCall.name, resultText: "你得说清想找谁。" };
    }

    const navigation = await getPlayerMapNavigationContext(playerId);
    if (!navigation) {
      return { toolName: toolCall.name, resultText: "眼下地图气机混乱，我一时辨不清路数。" };
    }

    const normalizedTarget = targetNpcName.toLowerCase();
    const targetNpc = navigation.npcRows.find((npc) => npc.name === targetNpcName)
      || navigation.npcRows.find((npc) => npc.name.includes(targetNpcName))
      || navigation.npcRows.find((npc) => npc.name.toLowerCase().includes(normalizedTarget));

    if (!targetNpc) {
      return {
        toolName: toolCall.name,
        resultText: JSON.stringify({
          found: false,
          targetNpcName,
          currentMapName: navigation.mapRow.name,
          exits: navigation.linkedMaps.map((map) => map.name),
        }),
      };
    }

    if (targetNpc.mapId === navigation.mapRow.id) {
      return {
        toolName: toolCall.name,
        resultText: JSON.stringify({
          found: true,
          sameMap: true,
          targetNpcName: targetNpc.name,
          currentMapName: navigation.mapRow.name,
          direction: resolveDirectionText(
            navigation.player.positionX,
            navigation.player.positionY,
            targetNpc.positionX,
            targetNpc.positionY,
          ),
          targetPosition: {
            x: targetNpc.positionX,
            y: targetNpc.positionY,
          },
        }),
      };
    }

    const targetMap = targetNpc.mapId
      ? await db.select({ id: maps.id, name: maps.name }).from(maps).where(eq(maps.id, targetNpc.mapId)).get()
      : null;
    return {
      toolName: toolCall.name,
      resultText: JSON.stringify({
        found: true,
        sameMap: false,
        targetNpcName: targetNpc.name,
        targetMapName: targetMap?.name || "未知地图",
        nextHopMaps: navigation.linkedMaps.map((map) => map.name),
      }),
    };
  }

  if (toolCall.name === "list_map_exits") {
    const navigation = await getPlayerMapNavigationContext(playerId);
    if (!navigation) {
      return { toolName: toolCall.name, resultText: "此地路数未明，我也一时说不准。" };
    }

    return {
      toolName: toolCall.name,
      resultText: JSON.stringify({
        mapName: navigation.mapRow.name,
        exits: navigation.linkedMaps.map((map) => ({
          id: map.id,
          name: map.name,
          mapType: map.mapType,
        })),
        portals: navigation.portalTiles.map((portal) => ({
          id: portal.id,
          name: portal.name,
          targetMapId: portal.targetMapId,
          targetMapName: portal.targetMapName,
          x: portal.x,
          y: portal.y,
          direction: resolveDirectionText(
            navigation.player.positionX,
            navigation.player.positionY,
            portal.x,
            portal.y,
          ),
        })),
      }),
    };
  }

  if (toolCall.name === "accept_npc_quest") {
    const args = parseArguments(toolCall.arguments);
    const questIdInput = typeof args.questId === "string" ? args.questId.trim() : "";
    let questId = questIdInput;
    const questNameInput = typeof args.questName === "string" ? args.questName.trim() : "";
    const cleanedQuestName = cleanupQuestName(questNameInput);

    const fullQuestList = await buildNpcQuestActionList(playerId, npcId);
    const visibleQuestData = buildNpcQuestVisibleList(fullQuestList);
    const availableVisible = visibleQuestData.quests.filter((q) => q.state === "可接取");

    const tryAcceptBounty = async () => {
      if (!visibleQuestData.bountyBoard || visibleQuestData.bountyBoard.state !== "可接取") {
        return {
          done: true,
          response: {
            toolName: toolCall.name,
            resultText: visibleQuestData.bountyBoard?.hint || "我这儿暂无可接取的悬赏。",
          } as NpcToolExecutionResult,
        };
      }

      const bountyResult = await acceptRandomBountyQuestForPlayer({ playerId, npcId });
      if (!bountyResult.success) {
        const error = bountyResult.error || "接取失败";
        const message = error === "该NPC未开启悬赏功能" ? "我这儿还没开放悬赏。"
          : error === "该NPC未配置每日悬赏次数" ? "悬赏名额还没设好，暂时接不了。"
          : error === "该NPC已有进行中的悬赏任务" ? "你在我这儿已有悬赏未交，先办完再来。"
          : error === "今日悬赏次数已用尽" ? "你今日在我这儿的悬赏次数已用尽。"
          : error === "当前境界暂无可接悬赏" ? "按你现在的境界，暂无匹配悬赏。"
          : "这会儿抽不到合适悬赏。";
        return {
          done: true,
          response: {
            toolName: toolCall.name,
            resultText: message,
          } as NpcToolExecutionResult,
        };
      }

      const bountyQuestId = bountyResult.data?.questId || "";
      const bountyQuestName = bountyResult.data?.questName || "悬赏任务";
      return {
        done: true,
        response: {
          toolName: toolCall.name,
          resultText: `好，这「${bountyQuestName}」的活儿就交给你了。`,
          event: {
            type: "quest.accepted",
            payload: {
              questId: bountyQuestId,
              questName: bountyQuestName,
              hint: bountyResult.data?.hint || "可去历练提升进度，完成后再回来交任务。",
              story: bountyResult.data?.story,
            },
          },
        } as NpcToolExecutionResult,
      };
    };

    if (questIdInput === BOUNTY_BOARD_ID || cleanedQuestName === BOUNTY_BOARD_NAME || cleanedQuestName.includes("悬赏")) {
      const bountyHandled = await tryAcceptBounty();
      if (bountyHandled.done) {
        return bountyHandled.response;
      }
    }

    if (questId) {
      const direct = await db.select({ id: quests.id }).from(quests)
        .where(and(eq(quests.id, questId), eq(quests.acceptNpcId, npcId)))
        .get();
      if (!direct) {
        const byName = await resolveNpcQuestIdByName({ npcId, questName: questId, mode: "accept" });
        if (byName.ambiguous) {
          return { toolName: toolCall.name, resultText: "同名委托不止一件，你把名字说全些。" };
        }
        questId = byName.questId || "";
      }
    }

    if (!questId && questNameInput) {
      const byName = await resolveNpcQuestIdByName({ npcId, questName: questNameInput, mode: "accept" });
      if (byName.ambiguous) {
        return { toolName: toolCall.name, resultText: "同名委托不止一件，你把名字说全些。" };
      }
      questId = byName.questId || "";
    }

    if (!questId) {
      if (questIdInput || questNameInput) {
        return { toolName: toolCall.name, resultText: "这委托我这儿查不到，你再确认下名字。" };
      }
      if (availableVisible.length === 1 && availableVisible[0].id === BOUNTY_BOARD_ID) {
        const bountyHandled = await tryAcceptBounty();
        if (bountyHandled.done) {
          return bountyHandled.response;
        }
      }
      if (availableVisible.length === 1) {
        questId = availableVisible[0].id;
      } else if (availableVisible.length === 0) {
        return { toolName: toolCall.name, resultText: "我这儿暂无可接取的委托。" };
      } else {
        return { toolName: toolCall.name, resultText: "可接取的委托不止一件，你报个委托名我才好替你记下。" };
      }
    }

    const targetQuestMeta = fullQuestList.find((item) => item.id === questId);
    if (targetQuestMeta && targetQuestMeta.state !== "可接取") {
      return {
        toolName: toolCall.name,
        resultText: targetQuestMeta.hint || targetQuestMeta.reason || "此委托眼下还接不了。",
      };
    }

    const result = await acceptQuestForPlayer({ playerId, npcId, questId });
    if (!result.success) {
      const error = result.error || "接取失败";
      const message = error === "任务不存在" ? "这委托我这儿查不到，你再确认下名字。"
        : error === "境界不足" ? "你境界未到，暂接不了此委托。"
        : error === "境界不符" ? "你的境界不在此委托要求范围内。"
        : error === "需先完成前置任务" ? "你尚有前置未了，先把前面的事办妥。"
        : error === "请先推进当前主线" ? "主线得一步步来，先把当前那件办完再说。"
        : error === "已有进行中的主线任务" ? "你手里已有主线在办，先了结那件。"
        : error === "主线任务不可重复" ? "这主线已了结，不可再接。"
        : error === "主线已全部完成" ? "此间主线你已尽数办妥。"
        : error === "任务已在进行中" ? "这委托你已在办，不必再接。"
        : error === "任务已完成且不可重复" ? "这委托已了结，且不可再接。"
        : error === "今日已办过，明日再来" ? "这活儿你今日已做过一趟，明日再来。"
        : error === "悬赏任务需随机接取" ? "悬赏要从悬赏板里随机抽取。"
        : error === "该任务不属于当前NPC" ? "此委托不归我管。"
        : "此事暂办不了。";
      return {
        toolName: toolCall.name,
        resultText: message,
      };
    }

    const questName = result.data?.questName || questId;
    return {
      toolName: toolCall.name,
      resultText: `好，这「${questName}」的活儿就交给你了。`,
      event: {
        type: "quest.accepted",
        payload: {
          questId,
          questName,
          hint: result.data?.hint || "可去历练提升进度，完成后再回来交任务。",
          story: result.data?.story,
        },
      },
    };
  }

  if (toolCall.name === "complete_npc_quest") {
    const args = parseArguments(toolCall.arguments);
    const questIdInput = typeof args.questId === "string" ? args.questId.trim() : "";
    let questId = questIdInput;
    const questNameInput = typeof args.questName === "string" ? args.questName.trim() : "";

    if (questId) {
      const direct = await db.select({ id: quests.id }).from(quests)
        .where(and(eq(quests.id, questId), eq(quests.completeNpcId, npcId)))
        .get();
      if (!direct) {
        const byName = await resolveNpcQuestIdByName({ npcId, questName: questId, mode: "complete" });
        if (byName.ambiguous) {
          return { toolName: toolCall.name, resultText: "同名委托不止一件，你把名字说全些。" };
        }
        questId = byName.questId || "";
      }
    }

    if (!questId && questNameInput) {
      const byName = await resolveNpcQuestIdByName({ npcId, questName: questNameInput, mode: "complete" });
      if (byName.ambiguous) {
        return { toolName: toolCall.name, resultText: "同名委托不止一件，你把名字说全些。" };
      }
      questId = byName.questId || "";
    }

    if (!questId) {
      if (questIdInput || questNameInput) {
        return { toolName: toolCall.name, resultText: "这委托我这儿查不到，你再确认下名字。" };
      }
      const questList = await buildNpcQuestActionList(playerId, npcId);
      const ready = questList.filter((q) => q.state === "可提交");
      if (ready.length === 1) {
        questId = ready[0].id;
      } else if (ready.length === 0) {
        return { toolName: toolCall.name, resultText: "你手上暂无可交差的委托。" };
      } else {
        return { toolName: toolCall.name, resultText: "可交差的委托不止一件，你报个委托名我才好替你核验。" };
      }
    }

    const result = await completeQuestForPlayer({ playerId, npcId, questId });
    if (!result.success) {
      const error = result.error || "提交失败";
      const message = error === "任务不存在" ? "这委托我这儿查不到，你再确认下名字。"
        : error === "材料不足" ? "材料未齐，凑齐了再来。"
        : error === "任务条件未完成" ? "条件未达，办妥了再来交差。"
        : error === "任务不在进行中" ? "你手上并无此委托，何来交差。"
        : error === "该任务不属于当前NPC" ? "此委托不归我管。"
        : "此事暂交不了。";
      return {
        toolName: toolCall.name,
        resultText: message,
      };
    }

    const questName = result.data?.questName || questId;
    const rewards = result.data?.rewards || {};
    const hint = result.data?.hint || "奖励已发放，可继续接取新的委托。";
    return {
      toolName: toolCall.name,
      resultText: `好，「${questName}」这事算了结了。`,
      event: {
        type: "quest.completed",
        payload: {
          questId,
          questName,
          rewards,
          hint,
          story: result.data?.story,
        },
      },
    };
  }

  return {
    toolName: toolCall.name,
    resultText: JSON.stringify({ success: false, error: "未知工具" }),
  };
}
