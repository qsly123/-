import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory } from "@/db/schema";

export const REBIRTH_CHARM_NAME = "转生符";

export async function consumeRebirthCharmIfAvailable(playerId: string): Promise<boolean> {
  const charm = await db.select({ id: items.id }).from(items)
    .where(eq(items.name, REBIRTH_CHARM_NAME))
    .get();
  if (!charm) {
    return false;
  }

  const inv = await db.select({ quantity: playerInventory.quantity }).from(playerInventory)
    .where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.itemId, charm.id),
    ))
    .get();
  if (!inv || inv.quantity <= 0) {
    return false;
  }

  if (inv.quantity <= 1) {
    await db.delete(playerInventory)
      .where(and(
        eq(playerInventory.playerId, playerId),
        eq(playerInventory.itemId, charm.id),
      ))
      .run();
    return true;
  }

  await db.update(playerInventory).set({ quantity: inv.quantity - 1 })
    .where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.itemId, charm.id),
    ))
    .run();
  return true;
}
