import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { dmMessages } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getConversationByIdForPlayer, getPlayerMapByIds } from "@/modules/social/infrastructure/social-service";
import { buildDmRetentionCutoff } from "@/modules/social/domain/social-types";

function parseLimit(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 30;
  }
  return Math.min(Math.floor(parsed), 50);
}

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const url = new URL(request.url);
    const conversationId = (url.searchParams.get("conversationId") || "").trim();
    const beforeIdRaw = (url.searchParams.get("beforeId") || "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));

    if (!conversationId) {
      return NextResponse.json({ success: false, error: "conversationId 不能为空" }, { status: 400 });
    }

    const conversation = await getConversationByIdForPlayer(conversationId, player.id);
    if (!conversation) {
      return NextResponse.json({ success: false, error: "会话不存在" }, { status: 404 });
    }

    const conditions: SQLWrapper[] = [
      eq(dmMessages.conversationId, conversation.id),
      gte(dmMessages.createdAt, buildDmRetentionCutoff()),
    ];

    if (beforeIdRaw) {
      const beforeId = Number(beforeIdRaw);
      if (!Number.isFinite(beforeId)) {
        return NextResponse.json({ success: false, error: "beforeId 非法" }, { status: 400 });
      }
      conditions.push(lt(dmMessages.id, Math.floor(beforeId)));
    }

    const rows = await db.select({
      id: dmMessages.id,
      conversationId: dmMessages.conversationId,
      senderPlayerId: dmMessages.senderPlayerId,
      content: dmMessages.content,
      createdAt: dmMessages.createdAt,
    }).from(dmMessages).where(and(...conditions)).orderBy(desc(dmMessages.id)).limit(limit).all();

    const senderMap = await getPlayerMapByIds(rows.map((row) => row.senderPlayerId));
    const messages = rows.slice().reverse().map((row) => ({
      ...row,
      senderName: senderMap.get(row.senderPlayerId)?.name || "未知修士",
    }));

    return NextResponse.json({
      success: true,
      data: {
        conversationId: conversation.id,
        messages,
      },
    });
  } catch (error) {
    console.error("DM messages error:", error);
    return NextResponse.json({ success: false, error: "获取私聊消息失败" }, { status: 500 });
  }
}
