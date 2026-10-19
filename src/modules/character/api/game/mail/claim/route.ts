import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { playerMails } from "@/db/schema";
import { grantRewardToPlayer, hasRewardValue, normalizeCdkReward } from "@/modules/character/services/reward-service";

class ClaimError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseMailId(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const mailId = parseMailId(body.mailId);
    if (!mailId) {
      return NextResponse.json({ success: false, error: "mailId 非法" }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mail-claim:${player.id}:${mailId}`}))`);

      const mail = await tx.select({
        id: playerMails.id,
        title: playerMails.title,
        reward: playerMails.reward,
        claimedAt: playerMails.claimedAt,
      })
        .from(playerMails)
        .where(and(eq(playerMails.id, mailId), eq(playerMails.playerId, player.id)))
        .get();

      if (!mail) {
        throw new ClaimError("邮件不存在");
      }
      if (mail.claimedAt) {
        throw new ClaimError("邮件已领取");
      }

      const claimedMail = await tx.update(playerMails)
        .set({ claimedAt: new Date().toISOString() })
        .where(and(
          eq(playerMails.id, mailId),
          eq(playerMails.playerId, player.id),
          isNull(playerMails.claimedAt),
        ))
        .returning({
          id: playerMails.id,
          title: playerMails.title,
          reward: playerMails.reward,
        })
        .get();

      if (!claimedMail) {
        throw new ClaimError("邮件已领取");
      }

      const reward = normalizeCdkReward(claimedMail.reward || {});
      const grantedReward = hasRewardValue(reward)
        ? await grantRewardToPlayer({ tx, playerId: player.id, reward })
        : { gold: 0, xp: 0, items: [] };

      return {
        mailId: claimedMail.id,
        title: claimedMail.title,
        reward: grantedReward,
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ClaimError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Mail claim error:", error);
    return NextResponse.json({ success: false, error: "领取失败" }, { status: 500 });
  }
}
