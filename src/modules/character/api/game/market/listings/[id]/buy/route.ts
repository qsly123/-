import { NextResponse } from "next/server";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { items, marketListings, marketTradeRecords, playerInventory, players } from "@/db/schema";
import { ensureMarketListingSchema } from "@/modules/character/services/market-schema";
import {
  calcMarketTradeAmounts,
  getMarketDailyBuyWindow,
  getMarketFeePercent,
  MARKET_DAILY_BUY_LIMIT,
  MARKET_DAILY_BUY_RULE_TEXT,
  parsePositiveInt,
  processExpiredMarketListings,
} from "@/modules/character/services/market-service";
import { invalidateReadModelCache, invalidateReadModelCacheByPrefix } from "@/modules/shared/services/read-model-cache";
import {
  buildNotificationSummaryCacheKey,
  MARKET_LISTINGS_CACHE_PREFIX,
} from "@/modules/shared/services/read-model-cache-keys";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";
import { getSafePlayerWorldMarketPenaltySummary } from "@/modules/world/services/player-world-pressure-service";

class MarketError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type SqlExecutor = Pick<typeof db, "execute">;

type ListingRow = {
  id: number;
  sellerPlayerId: string;
  itemId: string;
  itemName: string;
  unitPrice: number;
  quantityRemaining: number;
  status: string;
  visibleAt: string;
  expiresAt: string;
};

async function lockMarketTradeResources(tx: SqlExecutor, params: {
  listingId: number;
  buyerPlayerId: string;
  sellerPlayerId: string;
}) {
  const playerLockKeys = [params.buyerPlayerId, params.sellerPlayerId]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  await tx.execute(sql`select pg_advisory_xact_lock(${params.listingId})`);
  for (const playerLockKey of playerLockKeys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`market-player:${playerLockKey}`}))`);
  }
}

function ensureListingPurchasable(listing: ListingRow, buyerPlayerId: string, quantity: number, nowIso: string) {
  if (listing.status !== "active") {
    throw new MarketError("该挂单不可购买");
  }
  if (listing.expiresAt <= nowIso) {
    throw new MarketError("该挂单已过期");
  }
  if (listing.visibleAt > nowIso) {
    throw new MarketError("该挂单仍在缓冲中，请稍后再试");
  }
  if (listing.sellerPlayerId === buyerPlayerId) {
    throw new MarketError("不能购买自己的挂单");
  }
  if (quantity > listing.quantityRemaining) {
    throw new MarketError("购买数量超过剩余数量");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const body = await request.json();
    const quantity = parsePositiveInt(body.quantity);
    if (!quantity) {
      return NextResponse.json({ success: false, error: "quantity 必须大于 0" }, { status: 400 });
    }

    await processExpiredMarketListings({ listingId, limit: 1 });

    const baseFeePercent = await getMarketFeePercent();
    const worldPenaltySummary = await getSafePlayerWorldMarketPenaltySummary(player.id, baseFeePercent);
    const feePercent = worldPenaltySummary.finalFeePercent;
    const result = await db.transaction(async (tx) => {
      const nowIso = new Date().toISOString();
      await tx.execute(sql`select pg_advisory_xact_lock(${listingId})`);

      const listing = await tx.select({
        id: marketListings.id,
        sellerPlayerId: marketListings.sellerPlayerId,
        itemId: marketListings.itemId,
        itemName: items.name,
        unitPrice: marketListings.unitPrice,
        quantityRemaining: marketListings.quantityRemaining,
        status: marketListings.status,
        visibleAt: marketListings.visibleAt,
        expiresAt: marketListings.expiresAt,
      })
        .from(marketListings)
        .innerJoin(items, eq(marketListings.itemId, items.id))
        .where(eq(marketListings.id, listingId))
        .get();

      if (!listing) {
        throw new MarketError("挂单不存在", 404);
      }
      ensureListingPurchasable(listing, player.id, quantity, nowIso);

      await lockMarketTradeResources(tx, {
        listingId: listing.id,
        buyerPlayerId: player.id,
        sellerPlayerId: listing.sellerPlayerId,
      });

      const latestListing = await tx.select({
        id: marketListings.id,
        sellerPlayerId: marketListings.sellerPlayerId,
        itemId: marketListings.itemId,
        itemName: items.name,
        unitPrice: marketListings.unitPrice,
        quantityRemaining: marketListings.quantityRemaining,
        status: marketListings.status,
        visibleAt: marketListings.visibleAt,
        expiresAt: marketListings.expiresAt,
      })
        .from(marketListings)
        .innerJoin(items, eq(marketListings.itemId, items.id))
        .where(eq(marketListings.id, listingId))
        .get();

      if (!latestListing) {
        throw new MarketError("挂单不存在", 404);
      }
      ensureListingPurchasable(latestListing, player.id, quantity, nowIso);

      const buyer = await tx.select({
        id: players.id,
        gold: players.gold,
      }).from(players).where(eq(players.id, player.id)).get();
      if (!buyer) {
        throw new MarketError("买家不存在", 404);
      }

      const dailyWindow = getMarketDailyBuyWindow();
      const todayBuyCountRow = await tx.select({ total: count() })
        .from(marketTradeRecords)
        .where(and(
          eq(marketTradeRecords.buyerPlayerId, buyer.id),
          gte(marketTradeRecords.createdAt, dailyWindow.startAt),
          lt(marketTradeRecords.createdAt, dailyWindow.endAt),
        ))
        .get();
      const todayBuyCount = Number(todayBuyCountRow?.total || 0);
      if (todayBuyCount >= MARKET_DAILY_BUY_LIMIT) {
        throw new MarketError(`今日已达${MARKET_DAILY_BUY_RULE_TEXT}`);
      }

      const seller = await tx.select({
        id: players.id,
        name: players.name,
        gold: players.gold,
      }).from(players).where(eq(players.id, latestListing.sellerPlayerId)).get();
      if (!seller) {
        const now = new Date().toISOString();
        await tx.update(marketListings).set({
          status: "cancelled",
          updatedAt: now,
        }).where(eq(marketListings.id, latestListing.id)).run();
        return {
          success: false as const,
          error: "挂单已失效，卖家不存在",
          status: 404,
        };
      }

      const trade = calcMarketTradeAmounts(latestListing.unitPrice, quantity, feePercent);
      if (buyer.gold < trade.gross) {
        throw new MarketError("灵石不足");
      }

      const now = new Date().toISOString();
      await tx.update(players).set({
        gold: buyer.gold - trade.gross,
        updatedAt: now,
      }).where(eq(players.id, buyer.id)).run();

      await tx.update(players).set({
        gold: seller.gold + trade.sellerNet,
        updatedAt: now,
      }).where(eq(players.id, seller.id)).run();

      const inventory = await tx.select({
        quantity: playerInventory.quantity,
      }).from(playerInventory)
        .where(and(
          eq(playerInventory.playerId, buyer.id),
          eq(playerInventory.itemId, latestListing.itemId),
        ))
        .get();

      if (inventory) {
        await tx.update(playerInventory)
          .set({ quantity: inventory.quantity + quantity })
          .where(and(
            eq(playerInventory.playerId, buyer.id),
            eq(playerInventory.itemId, latestListing.itemId),
          ))
          .run();
      } else {
        await tx.insert(playerInventory).values({
          playerId: buyer.id,
          itemId: latestListing.itemId,
          quantity,
          equipped: false,
        }).run();
      }

      const remaining = latestListing.quantityRemaining - quantity;
      await tx.update(marketListings).set({
        quantityRemaining: remaining,
        status: remaining > 0 ? "active" : "sold_out",
        updatedAt: now,
      }).where(eq(marketListings.id, latestListing.id)).run();

      const tradeRecord = await tx.insert(marketTradeRecords).values({
        listingId: latestListing.id,
        sellerPlayerId: seller.id,
        buyerPlayerId: buyer.id,
        itemId: latestListing.itemId,
        unitPrice: latestListing.unitPrice,
        quantity,
        gross: trade.gross,
        fee: trade.fee,
        sellerNet: trade.sellerNet,
        sellerReadAt: null,
        createdAt: now,
      }).returning({
        id: marketTradeRecords.id,
      }).get();

      if (!tradeRecord) {
        throw new MarketError("写入交易记录失败", 500);
      }

      return {
        success: true as const,
        tradeRecordId: tradeRecord.id,
        sellerId: seller.id,
        sellerName: seller.name || "无名修士",
        itemName: latestListing.itemName,
        quantity,
        trade,
      };
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    publishSocialEvent([result.sellerId], {
      type: "market_trade_sold",
      data: {
        tradeRecordId: result.tradeRecordId,
        itemName: result.itemName,
        quantity: result.quantity,
        sellerName: result.sellerName,
        createdAt: new Date().toISOString(),
      },
    });
    invalidateReadModelCacheByPrefix(MARKET_LISTINGS_CACHE_PREFIX, "market_visibility");
    invalidateReadModelCache(buildNotificationSummaryCacheKey(result.sellerId));

    return NextResponse.json({
      success: true,
      data: {
        message: `购买成功：${result.itemName}x${result.quantity}`,
        totalCost: result.trade.gross,
        fee: result.trade.fee,
        sellerNet: result.trade.sellerNet,
        feePercent,
        worldPenaltySummary,
      },
    });
  } catch (error) {
    if (error instanceof MarketError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Market buy error:", error);
    return NextResponse.json({ success: false, error: "购买失败" }, { status: 500 });
  }
}
