import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { items, marketListings, playerInventory } from "@/db/schema";
import { ensureMarketListingSchema } from "@/modules/character/services/market-schema";
import { parsePositiveInt, processExpiredMarketListings } from "@/modules/character/services/market-service";
import { invalidateReadModelCacheByPrefix } from "@/modules/shared/services/read-model-cache";
import { MARKET_LISTINGS_CACHE_PREFIX } from "@/modules/shared/services/read-model-cache-keys";

class MarketError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    if (!(await ensureMarketListingSchema())) {
      return NextResponse.json({ success: false, error: "市场表结构尚未就绪，请稍后重试" }, { status: 503 });
    }

    const { id: rawId } = await params;
    const listingId = parsePositiveInt(rawId);
    if (!listingId) {
      return NextResponse.json({ success: false, error: "挂单ID非法" }, { status: 400 });
    }

    await processExpiredMarketListings({
      listingId,
      sellerPlayerId: player.id,
      limit: 1,
    });

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${listingId})`);

      const listing = await tx.select({
        id: marketListings.id,
        sellerPlayerId: marketListings.sellerPlayerId,
        itemId: marketListings.itemId,
        itemName: items.name,
        status: marketListings.status,
        quantityRemaining: marketListings.quantityRemaining,
      }).from(marketListings)
        .innerJoin(items, eq(marketListings.itemId, items.id))
        .where(eq(marketListings.id, listingId))
        .get();

      if (!listing) {
        throw new MarketError("挂单不存在", 404);
      }
      if (listing.sellerPlayerId !== player.id) {
        throw new MarketError("无权下架该挂单", 403);
      }
      if (listing.status === "expired") {
        throw new MarketError("挂单已过期，剩余物品已通过邮件退还", 409);
      }
      if (listing.status !== "active") {
        throw new MarketError("该挂单不可下架");
      }
      if (listing.quantityRemaining < 1) {
        throw new MarketError("挂单无可返还数量");
      }

      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`market-listing:${player.id}:${listing.itemId}`}))`);

      const inventory = await tx.select({
        quantity: playerInventory.quantity,
      }).from(playerInventory)
        .where(and(
          eq(playerInventory.playerId, player.id),
          eq(playerInventory.itemId, listing.itemId),
        ))
        .get();

      if (inventory) {
        await tx.update(playerInventory)
          .set({ quantity: inventory.quantity + listing.quantityRemaining })
          .where(and(
            eq(playerInventory.playerId, player.id),
            eq(playerInventory.itemId, listing.itemId),
          ))
          .run();
      } else {
        await tx.insert(playerInventory).values({
          playerId: player.id,
          itemId: listing.itemId,
          quantity: listing.quantityRemaining,
          equipped: false,
        }).run();
      }

      await tx.update(marketListings).set({
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      }).where(eq(marketListings.id, listing.id)).run();

      return {
        itemName: listing.itemName,
        quantity: listing.quantityRemaining,
      };
    });

    invalidateReadModelCacheByPrefix(MARKET_LISTINGS_CACHE_PREFIX, "market_visibility");

    return NextResponse.json({
      success: true,
      data: {
        message: `下架成功：返还${result.itemName}x${result.quantity}`,
      },
    });
  } catch (error) {
    if (error instanceof MarketError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Market cancel error:", error);
    return NextResponse.json({ success: false, error: "下架失败" }, { status: 500 });
  }
}
