import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { playerIntimacyRelations } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const relationId = Number(body?.relationId);
    if (!Number.isFinite(relationId)) {
      return NextResponse.json({ success: false, error: "relationId 非法" }, { status: 400 });
    }

    const relation = await db.select({
      id: playerIntimacyRelations.id,
      playerAId: playerIntimacyRelations.playerAId,
      playerBId: playerIntimacyRelations.playerBId,
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
      return NextResponse.json({ success: false, error: "亲密关系不存在" }, { status: 404 });
    }

    if (relation.status === "canceled") {
      return NextResponse.json({ success: true });
    }

    const now = new Date().toISOString();
    await db.update(playerIntimacyRelations).set({
      status: "canceled",
      updatedAt: now,
      respondedAt: now,
    }).where(eq(playerIntimacyRelations.id, relation.id)).run();

    publishSocialEvent([relation.playerAId, relation.playerBId], {
      type: "intimacy_update",
      data: {
        relationId: relation.id,
        status: "canceled",
        relationType: relation.relationType,
        updatedAt: now,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Intimacy remove error:", error);
    return NextResponse.json({ success: false, error: "解除亲密关系失败" }, { status: 500 });
  }
}
