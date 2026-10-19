import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { quests, playerQuests, playerInventory, items } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import { buildMainlineGuide } from "@/modules/quest/services/quest-service";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getQuestRequirementProgressKey } from "@/modules/quest/services/quest-requirement";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import { listPlayerWorldContracts } from "@/modules/world/services/player-world-pressure-service";
import type { QuestRequirement } from "@/types/game";

type PlayerQuestRow = {
  questId: string;
  status: string;
  progress: Record<string, number> | null;
};

type InventoryRow = {
  itemId: string;
  quantity: number;
};

type ItemRow = {
  id: string;
  name: string;
  iconUrl: string | null;
};

type QuestRewardRow = {
  xp?: number;
  gold?: number;
  items?: { itemId: string; quantity: number }[];
};

type QuestRow = {
  id: string;
  name: string;
  description: string | null;
  questCategory: string | null;
  questType: string;
  acceptNpcId: string;
  completeNpcId: string;
  acceptStory: string | null;
  completeStory: string | null;
  requirements: QuestRequirement[] | null;
  rewards: QuestRewardRow | null;
  minRealm: number;
  maxRealm: number | null;
  repeatable: boolean;
};

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

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    // 获取玩家所有任务状态
    const pqs = (await db.select().from(playerQuests)
      .where(eq(playerQuests.playerId, player.id))
      .all()) as PlayerQuestRow[];
    const playerQuestMap = new Map<string, PlayerQuestRow>(
      pqs.map((row) => [row.questId, row]),
    );

    const inv = (await db.select().from(playerInventory)
      .where(eq(playerInventory.playerId, player.id))
      .all()) as InventoryRow[];
    const itemCountMap = new Map<string, number>(
      inv.map((row) => [row.itemId, row.quantity]),
    );

    // 获取所有任务
    const [allQuestsResult, worldContractsResult] = await Promise.allSettled([
      db.select().from(quests).all() as Promise<QuestRow[]>,
      listPlayerWorldContracts(player.id),
    ]);
    if (allQuestsResult.status !== "fulfilled") {
      throw allQuestsResult.reason;
    }
    const allQuests = allQuestsResult.value;
    const worldContracts = worldContractsResult.status === "fulfilled"
      ? worldContractsResult.value
      : [];
    const worldContractsError = worldContractsResult.status === "rejected"
      ? (worldContractsResult.reason instanceof Error
        ? worldContractsResult.reason.message
        : "世界委托暂时读取失败，请稍后重试。")
      : null;
    if (worldContractsResult.status === "rejected") {
      console.error("Quest list world contracts error:", worldContractsResult.reason);
    }
    const rewardItemIds = Array.from(new Set(
      allQuests
        .flatMap((quest) => quest.rewards?.items || [])
        .map((rewardItem) => rewardItem.itemId)
        .filter((itemId): itemId is string => typeof itemId === "string" && !!itemId.trim()),
    ));
    const rewardItems = rewardItemIds.length > 0
      ? (await db.select({
        id: items.id,
        name: items.name,
        iconUrl: items.iconUrl,
      }).from(items).where(inArray(items.id, rewardItemIds)).all()) as ItemRow[]
      : [];
    const playerStats = await buildPlayerStatsSnapshot(player);
    const playerCombatPower = calcCombatPower(playerStats.total);
    const mainlineGuide = await buildMainlineGuide(player.id);
    const questMap = new Map<string, QuestRow>(allQuests.map((quest) => [quest.id, quest]));
    const itemMap = new Map<string, { name: string; iconUrl: string | null }>(
      rewardItems.map((row) => [row.id, { name: row.name, iconUrl: row.iconUrl || null }]),
    );
    const activeMainQuestId = pqs.find((row) => {
      if (row.status !== "active") return false;
      const quest = questMap.get(row.questId);
      return quest?.questCategory === "main";
    })?.questId || null;

    const realmNameCache = new Map<number, string>();
    const resolveRealmName = async (realmValue: number) => {
      const safeRealm = Math.max(1, Math.floor(Number(realmValue) || 1));
      const cached = realmNameCache.get(safeRealm);
      if (cached) {
        return cached;
      }
      const resolved = await getRealmFullNameByLinearRealm(safeRealm);
      realmNameCache.set(safeRealm, resolved);
      return resolved;
    };

    const questList = await Promise.all(allQuests.map(async (q) => {
      const pq = playerQuestMap.get(q.id);
      const reqs = await Promise.all((q.requirements || []).map(async (req) => {
        if (req.type !== "realm") {
          return req;
        }
        return {
          ...req,
          targetName: await resolveRealmName(req.quantity),
        };
      }));
      const baseProgress = pq?.progress || {};
      const progress: Record<string, number> = { ...baseProgress };

      for (const req of reqs) {
        const progressKey = getQuestRequirementProgressKey(req);
        if (req.type === "collect") {
          const targetId = typeof req.targetId === "string" ? req.targetId.trim() : "";
          progress[progressKey] = targetId ? (itemCountMap.get(targetId) || 0) : 0;
          continue;
        }
        if (req.type === "realm") {
          progress[progressKey] = player.realm;
          continue;
        }
        if (req.type === "power") {
          progress[progressKey] = playerCombatPower;
        }
      }

      // 检查是否完成
      let isComplete = false;
      if (pq?.status === "active") {
        isComplete = reqs.every((r) => {
          const progressKey = getQuestRequirementProgressKey(r);
          return (progress[progressKey] || 0) >= r.quantity;
        });
      }

      const rewards = q.rewards ?? undefined;

      const rewardsWithName = rewards
        ? {
          ...rewards,
          items: rewards.items?.map((rewardItem) => ({
            ...rewardItem,
            itemName: itemMap.get(rewardItem.itemId)?.name || rewardItem.itemId,
            itemIconUrl: itemMap.get(rewardItem.itemId)?.iconUrl || null,
          })),
        }
        : rewards;

      const questCategory = q.questCategory === "main" ? "main" : "side";
      const status = pq?.status || "available";
      const isBountyAvailable = q.questType === "bounty" && status === "available";
      let canAccept = !pq || (pq.status !== "active" && (pq.status !== "completed" || q.repeatable));
      if (questCategory === "main") {
        canAccept = (!pq || pq.status !== "active")
          && pq?.status !== "completed"
          && mainlineGuide.currentQuestId === q.id
          && (!activeMainQuestId || activeMainQuestId === q.id);
      }

      return {
        id: q.id,
        name: isBountyAvailable ? "悬赏任务" : q.name,
        description: isBountyAvailable ? "接取后公开任务详情。" : q.description,
        questCategory,
        questType: q.questType,
        acceptNpcId: q.acceptNpcId,
        completeNpcId: q.completeNpcId,
        acceptStory: isBountyAvailable ? null : q.acceptStory,
        completeStory: isBountyAvailable ? null : q.completeStory,
        requirements: isBountyAvailable ? [] : reqs,
        rewards: isBountyAvailable ? undefined : rewardsWithName,
        minRealm: q.minRealm,
        maxRealm: q.maxRealm,
        repeatable: q.repeatable,
        status,
        progress: isBountyAvailable ? {} : progress,
        playerRealmName: player.realmName || "",
        isComplete,
        canAccept,
      };
    }));

    return NextResponse.json({
      success: true,
      data: {
        quests: questList,
        mainlineGuide,
        worldContracts,
        worldContractsError,
      },
    });
  } catch (e) {
    console.error("Quest list error:", e);
    return NextResponse.json({ success: false, error: "获取任务列表失败" }, { status: 500 });
  }
}
