import { NextResponse } from "next/server";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { playerFriendships, playerIntimacyRelations } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const friendshipId = Number(body?.friendshipId);
    if (!Number.isFinite(friendshipId)) {
      return NextResponse.json({ success: false, error: "friendshipId 非法" }, { status: 400 });
    }

    const friendship = await db.select({
      id: playerFriendships.id,
      playerAId: playerFriendships.playerAId,
      playerBId: playerFriendships.playerBId,
      status: playerFriendships.status,
    }).from(playerFriendships).where(and(
      eq(playerFriendships.id, Math.floor(friendshipId)),
      or(
        eq(playerFriendships.playerAId, player.id),
        eq(playerFriendships.playerBId, player.id),
      ),
    )).get();

    if (!friendship) {
      return NextResponse.json({ success: false, error: "好友关系不存在" }, { status: 404 });
    }

    if (friendship.status === "canceled") {
      return NextResponse.json({ success: true });
    }

    const now = new Date().toISOString();
    await db.update(playerFriendships).set({
      status: "canceled",
      updatedAt: now,
      respondedAt: now,
    }).where(eq(playerFriendships.id, friendship.id)).run();

    await db.update(playerIntimacyRelations).set({
      status: "canceled",
      updatedAt: now,
      respondedAt: now,
    }).where(and(
      eq(playerIntimacyRelations.playerAId, friendship.playerAId),
      eq(playerIntimacyRelations.playerBId, friendship.playerBId),
      ne(playerIntimacyRelations.status, "canceled"),
    )).run();

    publishSocialEvent([friendship.playerAId, friendship.playerBId], {
      type: "friend_update",
      data: {
        friendshipId: friendship.id,
        status: "canceled",
        updatedAt: now,
      },
    });

    publishSocialEvent([friendship.playerAId, friendship.playerBId], {
      type: "intimacy_update",
      data: {
        relationId: 0,
        status: "canceled",
        relationType: "",
        updatedAt: now,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Friend remove error:", error);
    return NextResponse.json({ success: false, error: "删除好友失败" }, { status: 500 });
  }
}
