import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { players, playerInventory } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getItemByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { NpcInteractionError, requireNpcInteraction } from "@/modules/map/services/npc-interaction";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const body = await request.json();
    const npcId = typeof body.npcId === "string" ? body.npcId.trim() : "";
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!npcId) {
      return NextResponse.json({ success: false, error: "npcId 不能为空" }, { status: 400 });
    }
    if (!itemId) {
      return NextResponse.json({ success: false, error: "itemId 不能为空" }, { status: 400 });
    }

    const npc = await requireNpcInteraction({ playerId: player.id, npcId });
    if (!npc || !npc.isShop) return NextResponse.json({ success: false, error: "商店不存在" }, { status: 404 });

    const shopItems = (npc.shopItems as { itemId: string; price: number }[]) || [];
    const shopItem = shopItems.find(si => si.itemId === itemId);
    if (!shopItem) return NextResponse.json({ success: false, error: "商店没有该物品" }, { status: 400 });

    const item = await getItemByIdCompat(itemId);
    if (!item) return NextResponse.json({ success: false, error: "物品不存在" }, { status: 404 });
    if (item.minRealm !== null && item.minRealm !== undefined && player.realm < item.minRealm) {
      return NextResponse.json({
        success: false,
        error: `境界不足，无法购买${item.name}`,
      }, { status: 400 });
    }
    if (item.maxRealm !== null && item.maxRealm !== undefined && player.realm > item.maxRealm) {
      return NextResponse.json({
        success: false,
        error: `当前境界过高，无法购买${item.name}`,
      }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shop-buy:${player.id}`}))`);

      const latestPlayer = await tx.select({
        id: players.id,
        gold: players.gold,
      }).from(players).where(eq(players.id, player.id)).get();
      if (!latestPlayer) {
        throw new Error("玩家不存在");
      }
      if (latestPlayer.gold < shopItem.price) {
        throw new Error("灵石不足");
      }

      const now = new Date().toISOString();
      await tx.update(players).set({
        gold: latestPlayer.gold - shopItem.price,
        updatedAt: now,
      }).where(eq(players.id, latestPlayer.id)).run();

      const existing = await tx.select().from(playerInventory)
        .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
        .get();
      if (existing) {
        await tx.update(playerInventory).set({ quantity: existing.quantity + 1 })
          .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
          .run();
      } else {
        await tx.insert(playerInventory).values({ playerId: player.id, itemId, quantity: 1 }).run();
      }
    });

    return NextResponse.json({
      success: true,
      data: { message: `购买了${item?.name || itemId}，花费${shopItem.price}灵石` },
    });
  } catch (e) {
    if (e instanceof NpcInteractionError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    if (e instanceof Error && e.message === "灵石不足") {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }
    if (e instanceof Error && e.message === "玩家不存在") {
      return NextResponse.json({ success: false, error: e.message }, { status: 404 });
    }
    console.error("Shop buy error:", e);
    return NextResponse.json({ success: false, error: "购买失败" }, { status: 500 });
  }
}
