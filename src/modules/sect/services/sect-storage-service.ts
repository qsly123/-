import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  items,
  playerInventory,
  players,
  sectResources,
  sectStorageItems,
  sects,
} from "@/db/schema";
import { getStorageExpandCost, SECT_MAX_STORAGE_CAPACITY } from "@/modules/sect/services/sect-constants";
import { acquireSectMutationLock, ensureSectFeatureReady, getSectCore, requireSectMembership, requireSectPermission } from "@/modules/sect/services/sect-service";

function toSafeInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function findNextSlot(usedSlots: number[], capacity: number) {
  for (let slotIndex = 1; slotIndex <= capacity; slotIndex += 1) {
    if (!usedSlots.includes(slotIndex)) {
      return slotIndex;
    }
  }
  return null;
}

function ensureSectTransferableItem(params: {
  equipped: boolean;
  isBound: boolean;
  action: "deposit" | "donate_item";
}) {
  if (params.equipped) {
    throw new Error(params.action === "deposit"
      ? "穿戴中的物品不能存入宗门仓库"
      : "穿戴中的物品不能捐为宗门材料");
  }
  if (params.isBound) {
    throw new Error(params.action === "deposit"
      ? "绑定物品不能存入宗门仓库"
      : "绑定物品不能捐为宗门材料");
  }
}

export async function mutateSectStorage(params: {
  playerId: string;
  action: "deposit" | "withdraw" | "expand" | "donate_gold" | "donate_item";
  itemId?: string;
  storageItemId?: number;
  quantity?: number;
}) {
  await ensureSectFeatureReady();
  const membership = await requireSectMembership(params.playerId);
  const sect = await getSectCore(membership.sectId);
  if (!sect) {
    throw new Error("宗门不存在");
  }
  if (sect.state === "abandoned_public") {
    throw new Error("宗门已公开荒废，当前不可操作仓库");
  }

  const quantity = Math.max(1, toSafeInt(params.quantity, 1));
  const nowIso = new Date().toISOString();

  if (params.action === "donate_gold") {
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, sect.id);
      const player = await tx.select({ gold: players.gold }).from(players).where(eq(players.id, params.playerId)).get();
      const nextResources = await tx.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get();
      if (!player || player.gold < quantity) {
        throw new Error("灵石不足");
      }
      if (!nextResources) {
        throw new Error("宗门仓库数据不存在");
      }
      await tx.update(players).set({
        gold: player.gold - quantity,
        updatedAt: nowIso,
      }).where(eq(players.id, params.playerId)).run();
      await tx.update(sectResources).set({
        spiritStone: nextResources.spiritStone + quantity,
        updatedAt: nowIso,
      }).where(eq(sectResources.sectId, sect.id)).run();
    });
    return;
  }

  if (params.action === "donate_item") {
    if (!params.itemId) {
      throw new Error("缺少物品");
    }
    const itemId = params.itemId;
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, sect.id);
      const inventory = await tx.select({
        itemId: playerInventory.itemId,
        quantity: playerInventory.quantity,
        equipped: playerInventory.equipped,
        isBound: items.isBound,
      }).from(playerInventory)
        .innerJoin(items, eq(items.id, playerInventory.itemId))
        .where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, itemId),
        ))
        .get();
      const nextResources = await tx.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get();
      if (!inventory || inventory.quantity < quantity) {
        throw new Error("材料不足");
      }
      ensureSectTransferableItem({
        equipped: inventory.equipped,
        isBound: Boolean(inventory.isBound),
        action: "donate_item",
      });
      if (!nextResources) {
        throw new Error("宗门仓库数据不存在");
      }
      if (inventory.quantity === quantity) {
        await tx.delete(playerInventory)
          .where(and(
            eq(playerInventory.playerId, params.playerId),
            eq(playerInventory.itemId, itemId),
          ))
          .run();
      } else {
        await tx.update(playerInventory).set({
          quantity: inventory.quantity - quantity,
        }).where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, itemId),
        )).run();
      }
      await tx.update(sectResources).set({
        sectMaterial: nextResources.sectMaterial + quantity,
        updatedAt: nowIso,
      }).where(eq(sectResources.sectId, sect.id)).run();
    });
    return;
  }

  if (params.action === "expand") {
    await requireSectPermission(params.playerId, "manage_storage");
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, sect.id);
      const nextResources = await tx.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get();
      if (!nextResources) {
        throw new Error("宗门仓库数据不存在");
      }
      const nextCapacity = Math.min(SECT_MAX_STORAGE_CAPACITY, nextResources.storageCapacity + 20);
      if (nextCapacity <= nextResources.storageCapacity) {
        throw new Error("仓库已达最大容量");
      }
      const cost = getStorageExpandCost(nextCapacity);
      if (
        nextResources.spiritStone < cost.spiritStone
        || nextResources.wood < cost.wood
        || nextResources.stone < cost.stone
        || nextResources.sectMaterial < cost.sectMaterial
      ) {
        throw new Error("宗门资源不足");
      }
      await tx.update(sectResources).set({
        spiritStone: nextResources.spiritStone - cost.spiritStone,
        wood: nextResources.wood - cost.wood,
        stone: nextResources.stone - cost.stone,
        sectMaterial: nextResources.sectMaterial - cost.sectMaterial,
        storageCapacity: nextCapacity,
        updatedAt: nowIso,
      }).where(eq(sectResources.sectId, sect.id)).run();
      await tx.update(sects).set({
        storageCapacity: nextCapacity,
        updatedAt: nowIso,
      }).where(eq(sects.id, sect.id)).run();
    });
    return;
  }

  if (params.action === "deposit") {
    if (!params.itemId) {
      throw new Error("缺少物品");
    }
    const itemId = params.itemId;
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, sect.id);
      const inventory = await tx.select({
        itemId: playerInventory.itemId,
        quantity: playerInventory.quantity,
        equipped: playerInventory.equipped,
        isBound: items.isBound,
      }).from(playerInventory)
        .innerJoin(items, eq(items.id, playerInventory.itemId))
        .where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, itemId),
        ))
        .get();
      const nextResources = await tx.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get();
      if (!inventory || inventory.quantity < quantity) {
        throw new Error("背包数量不足");
      }
      ensureSectTransferableItem({
        equipped: inventory.equipped,
        isBound: Boolean(inventory.isBound),
        action: "deposit",
      });
      if (!nextResources) {
        throw new Error("宗门仓库数据不存在");
      }
      const storageRows = await tx.select().from(sectStorageItems)
        .where(eq(sectStorageItems.sectId, sect.id))
        .orderBy(asc(sectStorageItems.slotIndex))
        .all();
      const existing = storageRows.find((row) => row.itemId === itemId);
      if (!existing && storageRows.length >= nextResources.storageCapacity) {
        throw new Error("宗门仓库已满，请先扩容");
      }

      if (inventory.quantity === quantity) {
        await tx.delete(playerInventory)
          .where(and(
            eq(playerInventory.playerId, params.playerId),
            eq(playerInventory.itemId, itemId),
          ))
          .run();
      } else {
        await tx.update(playerInventory).set({
          quantity: inventory.quantity - quantity,
        }).where(and(
          eq(playerInventory.playerId, params.playerId),
          eq(playerInventory.itemId, itemId),
        )).run();
      }

      if (existing) {
        await tx.update(sectStorageItems).set({
          quantity: existing.quantity + quantity,
          updatedAt: nowIso,
        }).where(eq(sectStorageItems.id, existing.id)).run();
      } else {
        const nextSlot = findNextSlot(storageRows.map((row) => row.slotIndex), nextResources.storageCapacity);
        if (nextSlot === null) {
          throw new Error("宗门仓库已满，请先扩容");
        }
        await tx.insert(sectStorageItems).values({
          sectId: sect.id,
          slotIndex: nextSlot,
          itemId,
          quantity,
          createdAt: nowIso,
          updatedAt: nowIso,
        }).run();
      }
    });
    return;
  }

  await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, sect.id);
    const storageItem = await tx.select().from(sectStorageItems).where(eq(sectStorageItems.id, params.storageItemId || -1)).get();
    if (!storageItem || storageItem.sectId !== sect.id) {
      throw new Error("仓库物品不存在");
    }
    if (storageItem.quantity < quantity) {
      throw new Error("仓库数量不足");
    }

    const inventory = await tx.select().from(playerInventory)
      .where(and(
        eq(playerInventory.playerId, params.playerId),
        eq(playerInventory.itemId, storageItem.itemId),
      ))
      .get();

    if (inventory) {
      await tx.update(playerInventory).set({
        quantity: inventory.quantity + quantity,
      }).where(and(
        eq(playerInventory.playerId, params.playerId),
        eq(playerInventory.itemId, storageItem.itemId),
      )).run();
    } else {
      await tx.insert(playerInventory).values({
        playerId: params.playerId,
        itemId: storageItem.itemId,
        quantity,
        equipped: false,
        equipSlot: null,
      }).run();
    }

    if (storageItem.quantity === quantity) {
      await tx.delete(sectStorageItems).where(eq(sectStorageItems.id, storageItem.id)).run();
    } else {
      await tx.update(sectStorageItems).set({
        quantity: storageItem.quantity - quantity,
        updatedAt: nowIso,
      }).where(eq(sectStorageItems.id, storageItem.id)).run();
    }
  });
}
