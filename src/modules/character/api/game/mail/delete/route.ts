import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { playerMails } from "@/db/schema";

class DeleteMailError extends Error {
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

    const mail = await db.select({
      id: playerMails.id,
      claimedAt: playerMails.claimedAt,
    })
      .from(playerMails)
      .where(and(eq(playerMails.id, mailId), eq(playerMails.playerId, player.id)))
      .get();

    if (!mail) {
      throw new DeleteMailError("邮件不存在", 404);
    }
    if (!mail.claimedAt) {
      throw new DeleteMailError("请先领取或标记已读后再删除");
    }

    await db.delete(playerMails)
      .where(and(
        eq(playerMails.id, mailId),
        eq(playerMails.playerId, player.id),
        isNotNull(playerMails.claimedAt),
      ))
      .run();

    return NextResponse.json({ success: true, data: { mailId } });
  } catch (error) {
    if (error instanceof DeleteMailError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Mail delete error:", error);
    return NextResponse.json({ success: false, error: "删除失败" }, { status: 500 });
  }
}
