import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playerFriendships } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";
import { hitSocialRateLimit } from "@/modules/social/infrastructure/social-rate-limit";
import { findPlayerByIdOrName } from "@/modules/social/infrastructure/social-service";
import { normalizePairPlayerIds } from "@/modules/social/domain/social-types";

const FRIEND_REQUEST_MAX_PER_MINUTE = 10;
const FRIEND_REQUEST_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    if (hitSocialRateLimit(`friend-request:${player.id}`, FRIEND_REQUEST_MAX_PER_MINUTE, FRIEND_REQUEST_WINDOW_MS)) {
      return NextResponse.json({ success: false, error: "操作过于频繁，请稍后再试" }, { status: 429 });
    }

    const body = await req.json();
    const target = await findPlayerByIdOrName({
      targetPlayerId: body?.targetPlayerId,
      targetName: body?.targetName,
    });

    if (!target) {
      return NextResponse.json({ success: false, error: "目标玩家不存在" }, { status: 404 });
    }

    if (target.id === player.id) {
      return NextResponse.json({ success: false, error: "不能添加自己为好友" }, { status: 400 });
    }

    const pair = normalizePairPlayerIds(player.id, target.id);
    const existing = await db.select({
      id: playerFriendships.id,
      status: playerFriendships.status,
      requestedBy: playerFriendships.requestedBy,
      createdAt: playerFriendships.createdAt,
      updatedAt: playerFriendships.updatedAt,
    }).from(playerFriendships).where(and(
      eq(playerFriendships.playerAId, pair.playerAId),
      eq(playerFriendships.playerBId, pair.playerBId),
    )).get();

    if (existing?.status === "accepted") {
      return NextResponse.json({ success: false, error: "你们已经是好友" }, { status: 400 });
    }

    if (existing?.status === "pending") {
      if (existing.requestedBy === player.id) {
        return NextResponse.json({ success: false, error: "你已发出好友申请" }, { status: 400 });
      }
      return NextResponse.json({ success: false, error: "对方已向你发起申请，请先处理" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const friendship = existing
      ? await db.update(playerFriendships).set({
        requestedBy: player.id,
        status: "pending",
        updatedAt: now,
        respondedAt: null,
      }).where(eq(playerFriendships.id, existing.id)).returning({
        id: playerFriendships.id,
        playerAId: playerFriendships.playerAId,
        playerBId: playerFriendships.playerBId,
        requestedBy: playerFriendships.requestedBy,
        status: playerFriendships.status,
        createdAt: playerFriendships.createdAt,
        updatedAt: playerFriendships.updatedAt,
      }).get()
      : await db.insert(playerFriendships).values({
        playerAId: pair.playerAId,
        playerBId: pair.playerBId,
        requestedBy: player.id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        respondedAt: null,
      }).returning({
        id: playerFriendships.id,
        playerAId: playerFriendships.playerAId,
        playerBId: playerFriendships.playerBId,
        requestedBy: playerFriendships.requestedBy,
        status: playerFriendships.status,
        createdAt: playerFriendships.createdAt,
        updatedAt: playerFriendships.updatedAt,
      }).get();

    if (!friendship) {
      return NextResponse.json({ success: false, error: "发起好友申请失败" }, { status: 500 });
    }

    publishSocialEvent([target.id], {
      type: "friend_request",
      data: {
        friendshipId: friendship.id,
        requesterId: player.id,
        requesterName: player.name || "无名修士",
        createdAt: friendship.createdAt,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        friendship,
      },
    });
  } catch (error) {
    console.error("Friend request error:", error);
    return NextResponse.json({ success: false, error: "发起好友申请失败" }, { status: 500 });
  }
}
