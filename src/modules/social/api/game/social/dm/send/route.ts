import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dmConversationReads, dmConversations, dmMessages, players } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";
import { hitSocialRateLimit } from "@/modules/social/infrastructure/social-rate-limit";
import { getAcceptedFriendshipByPair, getPlayerDmPermission } from "@/modules/social/infrastructure/social-service";
import { DM_CONTENT_MAX_LENGTH, normalizeDmContent, normalizePairPlayerIds } from "@/modules/social/domain/social-types";

const DM_SEND_MAX_PER_MINUTE = 30;
const DM_SEND_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    if (hitSocialRateLimit(`dm-send:${player.id}`, DM_SEND_MAX_PER_MINUTE, DM_SEND_WINDOW_MS)) {
      return NextResponse.json({ success: false, error: "发送过于频繁，请稍后再试" }, { status: 429 });
    }

    const body = await req.json();
    const targetPlayerId = typeof body?.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";
    const content = normalizeDmContent(body?.content);

    if (!targetPlayerId) {
      return NextResponse.json({ success: false, error: "targetPlayerId 不能为空" }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ success: false, error: "消息不能为空" }, { status: 400 });
    }

    if (content.length > DM_CONTENT_MAX_LENGTH) {
      return NextResponse.json({ success: false, error: `消息不能超过 ${DM_CONTENT_MAX_LENGTH} 字` }, { status: 400 });
    }

    if (targetPlayerId === player.id) {
      return NextResponse.json({ success: false, error: "不能给自己发私聊" }, { status: 400 });
    }

    const target = await db.select({
      id: players.id,
      name: players.name,
      realmName: players.realmName,
    }).from(players).where(eq(players.id, targetPlayerId)).get();

    if (!target) {
      return NextResponse.json({ success: false, error: "目标玩家不存在" }, { status: 404 });
    }

    const permission = await getPlayerDmPermission(target.id);
    if (permission === "none") {
      return NextResponse.json({ success: false, error: "对方已关闭私聊" }, { status: 403 });
    }

    if (permission === "friends") {
      const friendship = await getAcceptedFriendshipByPair(player.id, target.id);
      if (!friendship) {
        return NextResponse.json({ success: false, error: "对方仅允许好友私聊" }, { status: 403 });
      }
    }

    const now = new Date().toISOString();
    const pair = normalizePairPlayerIds(player.id, target.id);
    const messagePreview = content.slice(0, 80);

    const result = await db.transaction(async (tx) => {
      const conversation = await tx.insert(dmConversations).values({
        id: crypto.randomUUID(),
        playerAId: pair.playerAId,
        playerBId: pair.playerBId,
        lastMessageAt: now,
        lastMessagePreview: messagePreview,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [dmConversations.playerAId, dmConversations.playerBId],
        set: {
          lastMessageAt: now,
          lastMessagePreview: messagePreview,
          updatedAt: now,
        },
      }).returning({
        id: dmConversations.id,
        playerAId: dmConversations.playerAId,
        playerBId: dmConversations.playerBId,
        lastMessageAt: dmConversations.lastMessageAt,
        lastMessagePreview: dmConversations.lastMessagePreview,
      }).get();

      if (!conversation) {
        throw new Error("会话创建失败");
      }

      const insertedMessage = await tx.insert(dmMessages).values({
        conversationId: conversation.id,
        senderPlayerId: player.id,
        content,
        createdAt: now,
      }).returning({
        id: dmMessages.id,
        conversationId: dmMessages.conversationId,
        senderPlayerId: dmMessages.senderPlayerId,
        content: dmMessages.content,
        createdAt: dmMessages.createdAt,
      }).get();

      if (!insertedMessage) {
        throw new Error("消息写入失败");
      }

      await tx.insert(dmConversationReads).values({
        conversationId: conversation.id,
        playerId: player.id,
        lastReadMessageId: insertedMessage.id,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [dmConversationReads.conversationId, dmConversationReads.playerId],
        set: {
          lastReadMessageId: insertedMessage.id,
          updatedAt: now,
        },
      }).run();

      await tx.update(dmConversations).set({
        lastMessageAt: insertedMessage.createdAt,
        lastMessagePreview: messagePreview,
        updatedAt: now,
      }).where(eq(dmConversations.id, conversation.id)).run();

      return {
        conversation,
        message: insertedMessage,
      };
    });

    publishSocialEvent([target.id, player.id], {
      type: "dm_message",
      data: {
        conversationId: result.conversation.id,
        messageId: result.message.id,
        senderPlayerId: player.id,
        senderName: player.name || "无名修士",
        targetPlayerId: target.id,
        content: result.message.content,
        createdAt: result.message.createdAt,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        conversationId: result.conversation.id,
        message: {
          ...result.message,
          senderName: player.name || "无名修士",
        },
      },
    });
  } catch (error) {
    console.error("DM send error:", error);
    return NextResponse.json({ success: false, error: "发送私聊失败" }, { status: 500 });
  }
}
