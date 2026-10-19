import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { items, marketTradeRecords, players } from "@/db/schema";
import { parsePositiveInt } from "@/modules/character/services/market-service";

function parseLimit(value: string | null) {
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    return 20;
  }
  return Math.min(parsed, 100);
}

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));

    const [rows, unreadRow] = await Promise.all([
      db.select({
        id: marketTradeRecords.id,
        listingId: marketTradeRecords.listingId,
        sellerPlayerId: marketTradeRecords.sellerPlayerId,
        buyerPlayerId: marketTradeRecords.buyerPlayerId,
        itemId: marketTradeRecords.itemId,
        itemName: items.name,
        itemIconUrl: items.iconUrl,
        unitPrice: marketTradeRecords.unitPrice,
        quantity: marketTradeRecords.quantity,
        gross: marketTradeRecords.gross,
        fee: marketTradeRecords.fee,
        sellerNet: marketTradeRecords.sellerNet,
        sellerReadAt: marketTradeRecords.sellerReadAt,
        createdAt: marketTradeRecords.createdAt,
      })
        .from(marketTradeRecords)
        .innerJoin(items, eq(marketTradeRecords.itemId, items.id))
        .where(or(
          eq(marketTradeRecords.sellerPlayerId, player.id),
          eq(marketTradeRecords.buyerPlayerId, player.id),
        ))
        .orderBy(desc(marketTradeRecords.createdAt), desc(marketTradeRecords.id))
        .limit(limit)
        .all(),
      db.select({ total: count() })
        .from(marketTradeRecords)
        .where(and(
          eq(marketTradeRecords.sellerPlayerId, player.id),
          isNull(marketTradeRecords.sellerReadAt),
        ))
        .get(),
    ]);

    const playerIds = new Set<string>();
    for (const row of rows) {
      playerIds.add(row.sellerPlayerId);
      playerIds.add(row.buyerPlayerId);
    }
    const relatedPlayerIds = [...playerIds];

    const relatedPlayers = relatedPlayerIds.length > 0
      ? await db.select({
        id: players.id,
        name: players.name,
      }).from(players).where(inArray(players.id, relatedPlayerIds)).all()
      : [];
    const nameMap = new Map(relatedPlayers.map((item) => [item.id, item.name || "无名修士"]));

    const list = rows.map((row) => {
      const isSeller = row.sellerPlayerId === player.id;
      const counterpartyId = isSeller ? row.buyerPlayerId : row.sellerPlayerId;
      return {
        id: row.id,
        listingId: row.listingId,
        side: isSeller ? "sell" : "buy",
        sellerPlayerId: row.sellerPlayerId,
        buyerPlayerId: row.buyerPlayerId,
        counterpartyPlayerId: counterpartyId,
        counterpartyName: nameMap.get(counterpartyId) || "无名修士",
        itemId: row.itemId,
        itemName: row.itemName,
        itemIconUrl: row.itemIconUrl || null,
        unitPrice: row.unitPrice,
        quantity: row.quantity,
        gross: row.gross,
        fee: row.fee,
        sellerNet: row.sellerNet,
        sellerReadAt: row.sellerReadAt,
        isSellerUnread: isSeller && !row.sellerReadAt,
        createdAt: row.createdAt,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        unreadCount: unreadRow?.total || 0,
        list,
      },
    });
  } catch (error) {
    console.error("Market trades list error:", error);
    return NextResponse.json({ success: false, error: "获取交易记录失败" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const now = new Date().toISOString();
    await db.update(marketTradeRecords).set({
      sellerReadAt: now,
    }).where(and(
      eq(marketTradeRecords.sellerPlayerId, player.id),
      isNull(marketTradeRecords.sellerReadAt),
    )).run();

    return NextResponse.json({
      success: true,
      data: {
        readAt: now,
      },
    });
  } catch (error) {
    console.error("Market trades read error:", error);
    return NextResponse.json({ success: false, error: "标记交易通知已读失败" }, { status: 500 });
  }
}
