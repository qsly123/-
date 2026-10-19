import { NextResponse } from "next/server";
import { and, count, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { dmConversationReads, dmConversations, dmMessages } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerMapByIds } from "@/modules/social/infrastructure/social-service";
import { buildDmRetentionCutoff } from "@/modules/social/domain/social-types";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const conversations = await db.select({
      id: dmConversations.id,
      playerAId: dmConversations.playerAId,
      playerBId: dmConversations.playerBId,
      lastMessageAt: dmConversations.lastMessageAt,
      lastMessagePreview: dmConversations.lastMessagePreview,
      updatedAt: dmConversations.updatedAt,
    }).from(dmConversations).where(or(
      eq(dmConversations.playerAId, player.id),
      eq(dmConversations.playerBId, player.id),
    )).orderBy(desc(dmConversations.lastMessageAt)).all();

    if (!conversations.length) {
      return NextResponse.json({ success: true, data: { conversations: [] } });
    }

    const conversationIds = conversations.map((item) => item.id);
    const targetPlayerIds = conversations.map((item) => item.playerAId === player.id ? item.playerBId : item.playerAId);
    const profileMap = await getPlayerMapByIds(targetPlayerIds);
    const cutoff = buildDmRetentionCutoff();
    const latestMessageIds = db.select({
      conversationId: dmMessages.conversationId,
      latestMessageId: sql<number>`max(${dmMessages.id})`.as("latest_message_id"),
    }).from(dmMessages)
      .where(and(
        inArray(dmMessages.conversationId, conversationIds),
        gte(dmMessages.createdAt, cutoff),
      ))
      .groupBy(dmMessages.conversationId)
      .as("latest_dm_message_ids");

    const [unreadRows, recentMessages] = await Promise.all([
      db.select({
        conversationId: dmMessages.conversationId,
        total: count(),
      }).from(dmMessages)
        .leftJoin(dmConversationReads, and(
          eq(dmConversationReads.conversationId, dmMessages.conversationId),
          eq(dmConversationReads.playerId, player.id),
        ))
        .where(and(
          inArray(dmMessages.conversationId, conversationIds),
          ne(dmMessages.senderPlayerId, player.id),
          gte(dmMessages.createdAt, cutoff),
          sql`${dmMessages.id} > coalesce(${dmConversationReads.lastReadMessageId}, 0)`,
        ))
        .groupBy(dmMessages.conversationId)
        .all(),
      db.select({
        conversationId: latestMessageIds.conversationId,
        id: dmMessages.id,
        content: dmMessages.content,
        createdAt: dmMessages.createdAt,
      }).from(latestMessageIds)
        .innerJoin(dmMessages, eq(dmMessages.id, latestMessageIds.latestMessageId))
        .all(),
    ]);

    const unreadCountMap = new Map(
      unreadRows.map((row) => [row.conversationId, Number(row.total) || 0] as const),
    );
    const lastMessageMap = new Map(
      recentMessages.map((message) => [message.conversationId, message] as const),
    );

    const items = conversations.map((conversation) => {
      const targetPlayerId = conversation.playerAId === player.id ? conversation.playerBId : conversation.playerAId;
      const target = profileMap.get(targetPlayerId);
      const lastMessage = lastMessageMap.get(conversation.id);

      return {
        id: conversation.id,
        targetPlayerId,
        targetPlayerName: target?.name || "未知修士",
        targetRealmName: target?.realmName || "未知境界",
        lastMessageAt: lastMessage?.createdAt || conversation.lastMessageAt,
        lastMessagePreview: lastMessage?.content || conversation.lastMessagePreview,
        unreadCount: unreadCountMap.get(conversation.id) || 0,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        conversations: items,
      },
    });
  } catch (error) {
    console.error("DM conversations error:", error);
    return NextResponse.json({ success: false, error: "获取私聊会话失败" }, { status: 500 });
  }
}
