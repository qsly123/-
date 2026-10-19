import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { items, playerMails } from "@/db/schema";
import { ensureMarketListingSchema } from "@/modules/character/services/market-schema";
import { normalizeCdkReward } from "@/modules/character/services/reward-service";
import { processExpiredMarketListings } from "@/modules/character/services/market-service";

function safeNormalizeReward(input: unknown) {
  try {
    return normalizeCdkReward(input || {});
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    if (await ensureMarketListingSchema()) {
      await processExpiredMarketListings({
        sellerPlayerId: player.id,
        limit: 100,
      });
    }

    const mailRows = await db.select({
      id: playerMails.id,
      title: playerMails.title,
      content: playerMails.content,
      reward: playerMails.reward,
      claimedAt: playerMails.claimedAt,
      createdAt: playerMails.createdAt,
    })
      .from(playerMails)
      .where(eq(playerMails.playerId, player.id))
      .orderBy(desc(playerMails.createdAt), desc(playerMails.id))
      .all();

    const itemIdSet = new Set<string>();
    for (const mail of mailRows) {
      const reward = safeNormalizeReward(mail.reward);
      for (const item of reward.items || []) {
        itemIdSet.add(item.itemId);
      }
    }

    const itemIds = [...itemIdSet];
    const itemNameRows = itemIds.length > 0
      ? await db.select({
        id: items.id,
        name: items.name,
        iconUrl: items.iconUrl,
      })
        .from(items)
        .where(inArray(items.id, itemIds))
        .all()
      : [];
    const itemMap = new Map(itemNameRows.map((row) => [
      row.id,
      { name: row.name, iconUrl: row.iconUrl || null },
    ]));

    const mails = mailRows.map((mail) => {
      const reward = safeNormalizeReward(mail.reward);
      const rewardItems = (reward.items || []).map((item) => ({
        ...item,
        itemName: itemMap.get(item.itemId)?.name || item.itemId,
        itemIconUrl: itemMap.get(item.itemId)?.iconUrl || null,
      }));

      return {
        id: mail.id,
        title: mail.title,
        content: mail.content || "",
        createdAt: mail.createdAt,
        claimedAt: mail.claimedAt,
        reward: {
          ...(reward.gold ? { gold: reward.gold } : {}),
          ...(reward.xp ? { xp: reward.xp } : {}),
          ...(rewardItems.length ? { items: rewardItems } : {}),
        },
      };
    });

    return NextResponse.json({ success: true, data: { mails } });
  } catch (error) {
    console.error("Mail list error:", error);
    return NextResponse.json({ success: false, error: "获取邮件失败" }, { status: 500 });
  }
}
