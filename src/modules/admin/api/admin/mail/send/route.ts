import { NextResponse } from "next/server";
import { inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { items, playerMails, players } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { normalizeCdkReward } from "@/modules/character/services/reward-service";

class SendMailError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseRecipients(input: unknown) {
  if (typeof input !== "string") {
    return [] as string[];
  }

  const tokens = input
    .split(/\r?\n|,|，/)
    .map((token) => token.trim())
    .filter(Boolean);

  return [...new Set(tokens)];
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const targetType = body.targetType === "custom" ? "custom" : "all";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";

    if (!title) {
      throw new SendMailError("标题不能为空");
    }

    const reward = normalizeCdkReward(body.reward || {});
    const rewardItemIds = (reward.items || []).map((item) => item.itemId);
    if (rewardItemIds.length > 0) {
      const existedRows = await db.select({ id: items.id })
        .from(items)
        .where(inArray(items.id, rewardItemIds))
        .all();
      const existedSet = new Set(existedRows.map((row) => row.id));
      const missingItems = rewardItemIds.filter((itemId) => !existedSet.has(itemId));
      if (missingItems.length > 0) {
        throw new SendMailError(`奖励物品不存在：${missingItems.join("、")}`);
      }
    }

    let targetPlayerIds: string[] = [];
    let unmatchedRecipients: string[] = [];

    if (targetType === "all") {
      const allPlayers = await db.select({ id: players.id }).from(players).all();
      targetPlayerIds = [...new Set(allPlayers.map((row) => row.id))];
    } else {
      const recipients = parseRecipients(body.recipients);
      if (!recipients.length) {
        throw new SendMailError("请填写至少一个收件角色（ID或名称）");
      }

      const matchedPlayers = await db.select({ id: players.id, name: players.name })
        .from(players)
        .where(or(inArray(players.id, recipients), inArray(players.name, recipients)))
        .all();

      targetPlayerIds = [...new Set(matchedPlayers.map((row) => row.id))];
      if (!targetPlayerIds.length) {
        throw new SendMailError("未匹配到任何角色");
      }

      unmatchedRecipients = recipients.filter((token) => {
        return !matchedPlayers.some((player) => player.id === token || player.name === token);
      });
    }

    if (!targetPlayerIds.length) {
      throw new SendMailError("暂无可发送角色");
    }

    const now = new Date().toISOString();
    await db.insert(playerMails).values(targetPlayerIds.map((playerId) => ({
      playerId,
      title,
      content,
      reward,
      sentBy: auth.admin?.id,
      createdAt: now,
    }))).run();

    return NextResponse.json({
      success: true,
      data: {
        sentCount: targetPlayerIds.length,
        unmatchedRecipients,
      },
    });
  } catch (error) {
    if (error instanceof SendMailError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Admin mail send error:", error);
    return NextResponse.json({ success: false, error: "发送失败" }, { status: 500 });
  }
}
