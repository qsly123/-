import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dmConversationReads, dmMessages } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getConversationByIdForPlayer } from "@/modules/social/infrastructure/social-service";

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
    const lastReadMessageId = Number(body?.lastReadMessageId);

    if (!conversationId) {
      return NextResponse.json({ success: false, error: "conversationId 不能为空" }, { status: 400 });
    }

    if (!Number.isFinite(lastReadMessageId)) {
      return NextResponse.json({ success: false, error: "lastReadMessageId 非法" }, { status: 400 });
    }

    const conversation = await getConversationByIdForPlayer(conversationId, player.id);
    if (!conversation) {
      return NextResponse.json({ success: false, error: "会话不存在" }, { status: 404 });
    }

    const message = await db.select({
      id: dmMessages.id,
    }).from(dmMessages).where(and(
      eq(dmMessages.id, Math.floor(lastReadMessageId)),
      eq(dmMessages.conversationId, conversation.id),
    )).get();

    if (!message) {
      return NextResponse.json({ success: false, error: "消息不存在" }, { status: 404 });
    }

    const now = new Date().toISOString();
    await db.insert(dmConversationReads).values({
      conversationId: conversation.id,
      playerId: player.id,
      lastReadMessageId: message.id,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [dmConversationReads.conversationId, dmConversationReads.playerId],
      set: {
        lastReadMessageId: message.id,
        updatedAt: now,
      },
    }).run();

    return NextResponse.json({
      success: true,
      data: {
        conversationId: conversation.id,
        lastReadMessageId: message.id,
      },
    });
  } catch (error) {
    console.error("DM read error:", error);
    return NextResponse.json({ success: false, error: "更新已读失败" }, { status: 500 });
  }
}
