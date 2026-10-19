import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory, players } from "@/db/schema";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import {
  EQUIPMENT_ITEM_TYPES,
  tuneEquipmentInstance,
} from "@/modules/character/services/equipment-instance-service";
import type { CdkReward } from "@/types/game";

type DbExecutor = Pick<typeof db, "select" | "update" | "insert" | "execute">;

export interface GrantedRewardItem {
  itemId: string;
  quantity: number;
  itemName: string;
  itemIconUrl?: string | null;
}

export interface GrantedReward {
  gold: number;
  xp: number;
  items: GrantedRewardItem[];
}

function toNonNegativeInt(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} 必须是大于等于 0 的数字`);
  }
  return Math.floor(parsed);
}

function toPositiveInt(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${fieldName} 必须是大于等于 1 的数字`);
  }
  return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRewardItems(itemsInput: unknown) {
  if (itemsInput === undefined || itemsInput === null) {
    return [] as { itemId: string; quantity: number }[];
  }
  if (!Array.isArray(itemsInput)) {
    throw new Error("reward.items 必须是数组");
  }

  const aggregated = new Map<string, number>();
  for (const rawItem of itemsInput) {
    if (!isRecord(rawItem)) {
      throw new Error("reward.items 项格式错误");
    }
    const itemId = typeof rawItem.itemId === "string" ? rawItem.itemId.trim() : "";
    if (!itemId) {
      throw new Error("reward.items.itemId 不能为空");
    }
    const quantity = toPositiveInt(rawItem.quantity, `reward.items(${itemId}).quantity`);
    aggregated.set(itemId, (aggregated.get(itemId) || 0) + quantity);
  }

  return Array.from(aggregated.entries()).map(([itemId, quantity]) => ({
    itemId,
    quantity,
  }));
}

export function normalizeCdkReward(input: unknown): CdkReward {
  if (!isRecord(input)) {
    throw new Error("reward 格式错误");
  }

  const gold = toNonNegativeInt(input.gold, "reward.gold");
  const xp = toNonNegativeInt(input.xp, "reward.xp");
  const items = normalizeRewardItems(input.items);

  const normalized: CdkReward = {};
  if (gold > 0) {
    normalized.gold = gold;
  }
  if (xp > 0) {
    normalized.xp = xp;
  }
  if (items.length > 0) {
    normalized.items = items;
  }
  return normalized;
}

export function hasRewardValue(reward: CdkReward) {
  return Boolean((reward.gold || 0) > 0 || (reward.xp || 0) > 0 || (reward.items?.length || 0) > 0);
}

export async function grantRewardToPlayer(params: {
  playerId: string;
  reward: CdkReward;
  tx?: DbExecutor;
}): Promise<GrantedReward> {
  const tx = params.tx || db;
  const reward = normalizeCdkReward(params.reward);
  const gold = reward.gold || 0;
  const xp = reward.xp || 0;
  const rewardItems = reward.items || [];

  const player = await getPlayerByIdCompat(params.playerId, tx);
  if (!player) {
    throw new Error("玩家不存在");
  }

  if (gold > 0 || xp > 0) {
    await tx.update(players).set({
      gold: player.gold + gold,
      cultivationXp: player.cultivationXp + xp,
      updatedAt: new Date().toISOString(),
    }).where(eq(players.id, params.playerId)).run();
  }

  const grantedItems: GrantedRewardItem[] = [];
  for (const rewardItem of rewardItems) {
    const item = await tx.select({
      name: items.name,
      iconUrl: items.iconUrl,
      itemType: items.itemType,
    })
      .from(items)
      .where(eq(items.id, rewardItem.itemId))
      .get();

    if (!item) {
      throw new Error(`奖励物品不存在: ${rewardItem.itemId}`);
    }

    const inv = await tx.select().from(playerInventory)
      .where(and(
        eq(playerInventory.playerId, params.playerId),
        eq(playerInventory.itemId, rewardItem.itemId),
      ))
      .get();

    if (inv) {
      await tx.update(playerInventory)
        .set({ quantity: inv.quantity + rewardItem.quantity })
        .where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, rewardItem.itemId),
        ))
        .run();
    } else {
      await tx.insert(playerInventory)
        .values({
          playerId: params.playerId,
          itemId: rewardItem.itemId,
          quantity: rewardItem.quantity,
        })
        .run();
    }

    // 装备（含掉落）到手时按当前境界定阶段系数、掷专精词条。
    // 必须在事务内做，否则读不到上面刚插入的行。
    if (EQUIPMENT_ITEM_TYPES.has(String(item.itemType || ""))) {
      await tuneEquipmentInstance({
        playerId: params.playerId,
        itemId: rewardItem.itemId,
        playerRealm: Number((player as { realm?: number }).realm || 1),
        tx,
      });
    }

    grantedItems.push({
      itemId: rewardItem.itemId,
      quantity: rewardItem.quantity,
      itemName: item.name,
      itemIconUrl: item.iconUrl || null,
    });
  }

  return {
    gold,
    xp,
    items: grantedItems,
  };
}
