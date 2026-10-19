import { NextResponse } from "next/server";
import { and, count, desc, eq, gt, like, lte, or, sql, type SQLWrapper } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { items, marketListings, playerInventory, players } from "@/db/schema";
import { ensureMarketListingSchema } from "@/modules/character/services/market-schema";
import {
  buildMarketListingSchedule,
  getMarketFeePercent,
  MARKET_DAILY_BUY_LIMIT,
  MARKET_DAILY_BUY_RULE_TEXT,
  MARKET_INT_MAX,
  parsePositiveInt,
  processNpcMarketPurchases,
  processExpiredMarketListings,
} from "@/modules/character/services/market-service";
import {
  invalidateReadModelCacheByPrefix,
  readThroughReadModelCache,
} from "@/modules/shared/services/read-model-cache";
import {
  buildMarketListingsCacheKey,
  getMarketVisibilityCacheTtlMs,
  MARKET_LISTINGS_CACHE_PREFIX,
} from "@/modules/shared/services/read-model-cache-keys";
import { getSafePlayerWorldMarketPenaltySummary } from "@/modules/world/services/player-world-pressure-service";

class MarketError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function parsePage(value: string | null, defaultValue: number) {
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    return defaultValue;
  }
  return parsed;
}

function parsePageSize(value: string | null, defaultValue: number) {
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    return defaultValue;
  }
  return Math.min(parsed, 50);
}

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    if (!(await ensureMarketListingSchema())) {
      return NextResponse.json({ success: false, error: "市场表结构尚未就绪，请稍后重试" }, { status: 503 });
    }

    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get("page"), 1);
    const pageSize = parsePageSize(url.searchParams.get("pageSize"), 20);
    const itemId = (url.searchParams.get("itemId") || "").trim();
    const keyword = (url.searchParams.get("keyword") || "").trim();
    const myOnly = url.searchParams.get("myOnly") === "true";
    const data = await readThroughReadModelCache({
      key: buildMarketListingsCacheKey({
        playerId: player.id,
        page,
        pageSize,
        itemId,
        keyword,
        myOnly,
      }),
      ttlMs: getMarketVisibilityCacheTtlMs(),
      statGroup: "market_visibility",
      loader: async () => {
        const nowIso = new Date().toISOString();
        await processExpiredMarketListings(
          myOnly
            ? { sellerPlayerId: player.id, limit: 100 }
            : { limit: 100 },
        );
        if (!myOnly) {
          await processNpcMarketPurchases({ limit: 4 });
        }

        const conditions: SQLWrapper[] = [];
        if (myOnly) {
          conditions.push(eq(marketListings.sellerPlayerId, player.id));
        } else {
          conditions.push(eq(marketListings.status, "active"));
          conditions.push(lte(marketListings.visibleAt, nowIso));
          conditions.push(gt(marketListings.expiresAt, nowIso));
        }

        if (itemId) {
          conditions.push(eq(marketListings.itemId, itemId));
        }

        if (keyword) {
          conditions.push(or(
            like(items.name, `%${keyword}%`),
            like(items.id, `%${keyword}%`),
          )!);
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const totalRow = whereClause
          ? await db.select({ total: count() })
            .from(marketListings)
            .innerJoin(items, eq(marketListings.itemId, items.id))
            .innerJoin(players, eq(marketListings.sellerPlayerId, players.id))
            .where(whereClause)
            .get()
          : await db.select({ total: count() })
            .from(marketListings)
            .innerJoin(items, eq(marketListings.itemId, items.id))
            .innerJoin(players, eq(marketListings.sellerPlayerId, players.id))
            .get();

        const total = totalRow?.total ?? 0;
        const maxPage = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, maxPage);
        const offset = (safePage - 1) * pageSize;
        const rows = whereClause
          ? await db.select({
            id: marketListings.id,
            sellerPlayerId: marketListings.sellerPlayerId,
            sellerName: players.name,
            itemId: marketListings.itemId,
            itemName: items.name,
            itemIconUrl: items.iconUrl,
            itemType: items.itemType,
            rarity: items.rarity,
            isBound: items.isBound,
            unitPrice: marketListings.unitPrice,
            quantityTotal: marketListings.quantityTotal,
            quantityRemaining: marketListings.quantityRemaining,
            status: marketListings.status,
            visibleAt: marketListings.visibleAt,
            expiresAt: marketListings.expiresAt,
            createdAt: marketListings.createdAt,
            updatedAt: marketListings.updatedAt,
          })
            .from(marketListings)
            .innerJoin(items, eq(marketListings.itemId, items.id))
            .innerJoin(players, eq(marketListings.sellerPlayerId, players.id))
            .where(whereClause)
            .orderBy(desc(marketListings.createdAt), desc(marketListings.id))
            .limit(pageSize)
            .offset(offset)
            .all()
          : await db.select({
            id: marketListings.id,
            sellerPlayerId: marketListings.sellerPlayerId,
            sellerName: players.name,
            itemId: marketListings.itemId,
            itemName: items.name,
            itemIconUrl: items.iconUrl,
            itemType: items.itemType,
            rarity: items.rarity,
            isBound: items.isBound,
            unitPrice: marketListings.unitPrice,
            quantityTotal: marketListings.quantityTotal,
            quantityRemaining: marketListings.quantityRemaining,
            status: marketListings.status,
            visibleAt: marketListings.visibleAt,
            expiresAt: marketListings.expiresAt,
            createdAt: marketListings.createdAt,
            updatedAt: marketListings.updatedAt,
          })
            .from(marketListings)
            .innerJoin(items, eq(marketListings.itemId, items.id))
            .innerJoin(players, eq(marketListings.sellerPlayerId, players.id))
            .orderBy(desc(marketListings.createdAt), desc(marketListings.id))
            .limit(pageSize)
            .offset(offset)
            .all();

        const baseFeePercent = await getMarketFeePercent();
        const worldPenaltySummary = await getSafePlayerWorldMarketPenaltySummary(player.id, baseFeePercent);
        const list = rows.map((row) => ({
          ...row,
          isMine: row.sellerPlayerId === player.id,
        }));

        return {
          list,
          feePercent: worldPenaltySummary.finalFeePercent,
          dailyBuyLimit: MARKET_DAILY_BUY_LIMIT,
          dailyBuyRuleText: MARKET_DAILY_BUY_RULE_TEXT,
          playerGold: player.gold,
          worldPenaltySummary,
          pagination: {
            page: safePage,
            pageSize,
            total,
          },
        };
      },
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Market listings error:", error);
    return NextResponse.json({ success: false, error: "获取市场列表失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    if (!(await ensureMarketListingSchema())) {
      return NextResponse.json({ success: false, error: "市场表结构尚未就绪，请稍后重试" }, { status: 503 });
    }

    const body = await request.json();
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const unitPrice = parsePositiveInt(body.unitPrice);
    const quantity = parsePositiveInt(body.quantity);

    if (!itemId) {
      return NextResponse.json({ success: false, error: "itemId 不能为空" }, { status: 400 });
    }
    if (!unitPrice) {
      return NextResponse.json({ success: false, error: `unitPrice 必须在 1 到 ${MARKET_INT_MAX} 之间` }, { status: 400 });
    }
    if (!quantity) {
      return NextResponse.json({ success: false, error: `quantity 必须在 1 到 ${MARKET_INT_MAX} 之间` }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`market-listing:${player.id}:${itemId}`}))`);

      const item = await tx.select({
        id: items.id,
        name: items.name,
        isBound: items.isBound,
      })
        .from(items)
        .where(eq(items.id, itemId))
        .get();

      if (!item) {
        throw new MarketError("物品不存在");
      }
      if (item.isBound) {
        throw new MarketError("绑定物品不可交易");
      }

      const inventory = await tx.select({
        quantity: playerInventory.quantity,
        equipped: playerInventory.equipped,
      })
        .from(playerInventory)
        .where(and(
          eq(playerInventory.playerId, player.id),
          eq(playerInventory.itemId, itemId),
        ))
        .get();

      if (!inventory || inventory.quantity < quantity) {
        throw new MarketError("背包数量不足");
      }
      if (inventory.equipped) {
        throw new MarketError("已装备物品不可上架，请先卸下");
      }

      if (inventory.quantity === quantity) {
        await tx.delete(playerInventory)
          .where(and(
            eq(playerInventory.playerId, player.id),
            eq(playerInventory.itemId, itemId),
          ))
          .run();
      } else {
        await tx.update(playerInventory)
          .set({ quantity: inventory.quantity - quantity })
          .where(and(
            eq(playerInventory.playerId, player.id),
            eq(playerInventory.itemId, itemId),
          ))
          .run();
      }

      const schedule = buildMarketListingSchedule();
      const listing = await tx.insert(marketListings).values({
        sellerPlayerId: player.id,
        itemId,
        unitPrice,
        quantityTotal: quantity,
        quantityRemaining: quantity,
        status: "active",
        visibleAt: schedule.visibleAt,
        expiresAt: schedule.expiresAt,
        createdAt: schedule.createdAt,
        updatedAt: schedule.createdAt,
      }).returning({
        id: marketListings.id,
        visibleAt: marketListings.visibleAt,
      }).get();

      if (!listing) {
        throw new MarketError("上架失败", 500);
      }

      return {
        listingId: listing.id,
        visibleAt: listing.visibleAt,
        itemName: item.name,
      };
    });

    invalidateReadModelCacheByPrefix(MARKET_LISTINGS_CACHE_PREFIX, "market_visibility");

    return NextResponse.json({
      success: true,
      data: {
        listingId: result.listingId,
        visibleAt: result.visibleAt,
        message: `已上架${result.itemName}，将在5分钟后公开显示`,
      },
    });
  } catch (error) {
    if (error instanceof MarketError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Market create listing error:", error);
    return NextResponse.json({ success: false, error: "上架失败" }, { status: 500 });
  }
}
