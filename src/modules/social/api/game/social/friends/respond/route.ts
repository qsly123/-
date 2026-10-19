import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { playerFriendships } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";

function normalizeAction(value: unknown): "accept" | "reject" | null {
  if (value === "accept" || value === "reject") {
    return value;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const friendshipId = Number(body?.friendshipId);
    const action = normalizeAction(body?.action);

    if (!Number.isFinite(friendshipId)) {
      return NextResponse.json({ success: false, error: "friendshipId 非法" }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ success: false, error: "action 非法" }, { status: 400 });
    }

    const friendship = await db.select({
      id: playerFriendships.id,
      playerAId: playerFriendships.playerAId,
      playerBId: playerFriendships.playerBId,
      requestedBy: playerFriendships.requestedBy,
      status: playerFriendships.status,
    }).from(playerFriendships).where(and(
      eq(playerFriendships.id, Math.floor(friendshipId)),
      or(
        eq(playerFriendships.playerAId, player.id),
        eq(playerFriendships.playerBId, player.id),
      ),
    )).get();

    if (!friendship) {
      return NextResponse.json({ success: false, error: "好友申请不存在" }, { status: 404 });
    }

    if (friendship.status !== "pending") {
      return NextResponse.json({ success: false, error: "该申请已处理" }, { status: 400 });
    }

    if (friendship.requestedBy === player.id) {
      return NextResponse.json({ success: false, error: "不能处理自己发出的申请" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const nextStatus = action === "accept" ? "accepted" : "rejected";

    const updated = await db.update(playerFriendships).set({
      status: nextStatus,
      updatedAt: now,
      respondedAt: now,
    }).where(eq(playerFriendships.id, friendship.id)).returning({
      id: playerFriendships.id,
      playerAId: playerFriendships.playerAId,
      playerBId: playerFriendships.playerBId,
      requestedBy: playerFriendships.requestedBy,
      status: playerFriendships.status,
      updatedAt: playerFriendships.updatedAt,
      respondedAt: playerFriendships.respondedAt,
    }).get();

    if (!updated) {
      return NextResponse.json({ success: false, error: "处理好友申请失败" }, { status: 500 });
    }

    publishSocialEvent([updated.playerAId, updated.playerBId], {
      type: "friend_update",
      data: {
        friendshipId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        friendship: updated,
      },
    });
  } catch (error) {
    console.error("Friend respond error:", error);
    return NextResponse.json({ success: false, error: "处理好友申请失败" }, { status: 500 });
  }
}
