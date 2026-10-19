import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { playerFriendships, playerIntimacyRelations } from "@/db/schema";
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
    const relationId = Number(body?.relationId);
    const action = normalizeAction(body?.action);

    if (!Number.isFinite(relationId)) {
      return NextResponse.json({ success: false, error: "relationId 非法" }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ success: false, error: "action 非法" }, { status: 400 });
    }

    const relation = await db.select({
      id: playerIntimacyRelations.id,
      playerAId: playerIntimacyRelations.playerAId,
      playerBId: playerIntimacyRelations.playerBId,
      requestedBy: playerIntimacyRelations.requestedBy,
      relationType: playerIntimacyRelations.relationType,
      status: playerIntimacyRelations.status,
    }).from(playerIntimacyRelations).where(and(
      eq(playerIntimacyRelations.id, Math.floor(relationId)),
      or(
        eq(playerIntimacyRelations.playerAId, player.id),
        eq(playerIntimacyRelations.playerBId, player.id),
      ),
    )).get();

    if (!relation) {
      return NextResponse.json({ success: false, error: "绑定申请不存在" }, { status: 404 });
    }

    if (relation.status !== "pending") {
      return NextResponse.json({ success: false, error: "该申请已处理" }, { status: 400 });
    }

    if (relation.requestedBy === player.id) {
      return NextResponse.json({ success: false, error: "不能处理自己发出的申请" }, { status: 400 });
    }

    if (action === "accept") {
      const friendship = await db.select({
        id: playerFriendships.id,
      }).from(playerFriendships).where(and(
        eq(playerFriendships.playerAId, relation.playerAId),
        eq(playerFriendships.playerBId, relation.playerBId),
        eq(playerFriendships.status, "accepted"),
      )).get();

      if (!friendship) {
        return NextResponse.json({ success: false, error: "双方已不是好友，无法绑定" }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const nextStatus = action === "accept" ? "accepted" : "rejected";

    const updated = await db.update(playerIntimacyRelations).set({
      status: nextStatus,
      updatedAt: now,
      respondedAt: now,
    }).where(eq(playerIntimacyRelations.id, relation.id)).returning({
      id: playerIntimacyRelations.id,
      playerAId: playerIntimacyRelations.playerAId,
      playerBId: playerIntimacyRelations.playerBId,
      requestedBy: playerIntimacyRelations.requestedBy,
      relationType: playerIntimacyRelations.relationType,
      status: playerIntimacyRelations.status,
      updatedAt: playerIntimacyRelations.updatedAt,
      respondedAt: playerIntimacyRelations.respondedAt,
    }).get();

    if (!updated) {
      return NextResponse.json({ success: false, error: "处理绑定申请失败" }, { status: 500 });
    }

    publishSocialEvent([updated.playerAId, updated.playerBId], {
      type: "intimacy_update",
      data: {
        relationId: updated.id,
        status: updated.status,
        relationType: updated.relationType,
        updatedAt: updated.updatedAt,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        relation: updated,
      },
    });
  } catch (error) {
    console.error("Intimacy respond error:", error);
    return NextResponse.json({ success: false, error: "处理绑定申请失败" }, { status: 500 });
  }
}
