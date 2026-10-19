/**
 * 装备强化（精炼）。
 *
 * 独立路由，不改动 inventory 主路由。强化消耗灵石，成本随等级递增。
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playerInventory, players } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  MAX_REFINE_LEVEL,
  REFINE_BONUS_PER_LEVEL,
} from "@/modules/character/services/framework/equipment.provider";

/** 每级强化的基础灵石成本，实际成本 = 基础 × (当前等级 + 1)。 */
const BASE_REFINE_COST = 50;

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { itemId?: unknown } | null;
    const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) {
      return NextResponse.json({ success: false, error: "缺少物品 id" }, { status: 400 });
    }

    const rows = await db
      .select({ refineLevel: playerInventory.refineLevel })
      .from(playerInventory)
      .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return NextResponse.json({ success: false, error: "背包中没有该物品" }, { status: 404 });
    }

    const currentLevel = Math.min(Math.max(row.refineLevel ?? 0, 0), MAX_REFINE_LEVEL);
    if (currentLevel >= MAX_REFINE_LEVEL) {
      return NextResponse.json(
        { success: false, error: `强化等级已达上限（${MAX_REFINE_LEVEL} 级）` },
        { status: 400 },
      );
    }

    const cost = BASE_REFINE_COST * (currentLevel + 1);
    const gold = player.gold ?? 0;
    if (gold < cost) {
      return NextResponse.json(
        { success: false, error: `灵石不足，本次需要 ${cost} 灵石` },
        { status: 400 },
      );
    }

    const nextLevel = currentLevel + 1;

    await db.transaction(async (tx) => {
      await tx
        .update(players)
        .set({ gold: gold - cost })
        .where(eq(players.id, player.id));
      await tx
        .update(playerInventory)
        .set({ refineLevel: nextLevel })
        .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)));
    });

    return NextResponse.json({
      success: true,
      data: {
        itemId,
        refineLevel: nextLevel,
        cost,
        bonusRatio: Number((nextLevel * REFINE_BONUS_PER_LEVEL).toFixed(2)),
        remainingGold: gold - cost,
      },
    });
  } catch (error) {
    console.error("Equipment refine error:", error);
    return NextResponse.json({ success: false, error: "强化失败" }, { status: 500 });
  }
}
