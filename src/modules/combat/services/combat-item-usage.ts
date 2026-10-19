import { and, eq } from "drizzle-orm";
import type { ItemEffect } from "@/types/game";

export type PreparedCombatItemUsage =
  | {
    success: true;
    itemName: string;
    quantity: number;
    effects: Array<{ type: string; value: number }>;
  }
  | {
    success: false;
    error: string;
  };

async function loadCombatItemUsageDeps() {
  const [
    dbModule,
    schemaModule,
    itemCompatModule,
  ] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("@/modules/character/services/pill-toxicity-schema-compat"),
  ]);
  return {
    db: dbModule.db,
    playerInventory: schemaModule.playerInventory,
    getItemByIdCompat: itemCompatModule.getItemByIdCompat,
  };
}

export async function consumeOneCombatItem(playerId: string, itemId: string, quantity: number) {
  const { db, playerInventory } = await loadCombatItemUsageDeps();
  if (quantity <= 1) {
    await db.delete(playerInventory)
      .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
      .run();
    return;
  }

  await db.update(playerInventory).set({ quantity: quantity - 1 })
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
    .run();
}

export async function prepareCombatItemUsage(params: {
  playerId: string;
  itemId: string;
}): Promise<PreparedCombatItemUsage> {
  const { playerId, itemId } = params;
  const { db, playerInventory, getItemByIdCompat } = await loadCombatItemUsageDeps();
  const inv = await db.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
    .get();
  if (!inv || inv.quantity <= 0) {
    return { success: false, error: "丹药不存在或数量不足" };
  }

  const item = await getItemByIdCompat(itemId);
  if (!item || item.itemType !== "consumable") {
    return { success: false, error: "战斗中只能使用消耗品" };
  }

  const effects = ((item.effects as ItemEffect[]) || [])
    .filter((effect) => (effect.type === "heal_hp" || effect.type === "heal_mp") && Number(effect.value) > 0)
    .map((effect) => ({ type: effect.type, value: Number(effect.value) }));
  if (!effects.length) {
    return { success: false, error: "当前只支持恢复气血或灵力的丹药" };
  }

  return {
    success: true,
    itemName: item.name,
    quantity: inv.quantity,
    effects,
  };
}
