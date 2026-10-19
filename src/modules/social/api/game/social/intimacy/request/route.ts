import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playerFriendships, playerIntimacyRelations } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { publishSocialEvent } from "@/modules/social/realtime/social-presence";
import { hitSocialRateLimit } from "@/modules/social/infrastructure/social-rate-limit";
import { findPlayerByIdOrName } from "@/modules/social/infrastructure/social-service";
import { isIntimacyRelationType, normalizePairPlayerIds } from "@/modules/social/domain/social-types";

const INTIMACY_REQUEST_MAX_PER_MINUTE = 8;
const INTIMACY_REQUEST_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    if (hitSocialRateLimit(`intimacy-request:${player.id}`, INTIMACY_REQUEST_MAX_PER_MINUTE, INTIMACY_REQUEST_WINDOW_MS)) {
      return NextResponse.json({ success: false, error: "操作过于频繁，请稍后再试" }, { status: 429 });
    }

    const body = await req.json();
    const relationTypeRaw = typeof body?.relationType === "string" ? body.relationType.trim() : "";
    if (!isIntimacyRelationType(relationTypeRaw)) {
      return NextResponse.json({ success: false, error: "relationType 非法" }, { status: 400 });
    }

    const target = await findPlayerByIdOrName({
      targetPlayerId: body?.targetPlayerId,
      targetName: body?.targetName,
    });

    if (!target) {
      return NextResponse.json({ success: false, error: "目标玩家不存在" }, { status: 404 });
    }

    if (target.id === player.id) {
      return NextResponse.json({ success: false, error: "不能和自己绑定亲密关系" }, { status: 400 });
    }

    const pair = normalizePairPlayerIds(player.id, target.id);

    const friendship = await db.select({
      id: playerFriendships.id,
      status: playerFriendships.status,
    }).from(playerFriendships).where(and(
      eq(playerFriendships.playerAId, pair.playerAId),
      eq(playerFriendships.playerBId, pair.playerBId),
      eq(playerFriendships.status, "accepted"),
    )).get();

    if (!friendship) {
      return NextResponse.json({ success: false, error: "需要先成为好友才能绑定亲密关系" }, { status: 400 });
    }

    const existing = await db.select({
      id: playerIntimacyRelations.id,
      status: playerIntimacyRelations.status,
      requestedBy: playerIntimacyRelations.requestedBy,
      relationType: playerIntimacyRelations.relationType,
      createdAt: playerIntimacyRelations.createdAt,
      updatedAt: playerIntimacyRelations.updatedAt,
    }).from(playerIntimacyRelations).where(and(
      eq(playerIntimacyRelations.playerAId, pair.playerAId),
      eq(playerIntimacyRelations.playerBId, pair.playerBId),
    )).get();

    if (existing?.status === "accepted") {
      return NextResponse.json({ success: false, error: "你们已经绑定亲密关系" }, { status: 400 });
    }

    if (existing?.status === "pending") {
      if (existing.requestedBy === player.id) {
        return NextResponse.json({ success: false, error: "你已发出绑定申请" }, { status: 400 });
      }
      return NextResponse.json({ success: false, error: "对方已向你发起绑定申请，请先处理" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const relation = existing
      ? await db.update(playerIntimacyRelations).set({
        requestedBy: player.id,
        relationType: relationTypeRaw,
        status: "pending",
        updatedAt: now,
        respondedAt: null,
      }).where(eq(playerIntimacyRelations.id, existing.id)).returning({
        id: playerIntimacyRelations.id,
        playerAId: playerIntimacyRelations.playerAId,
        playerBId: playerIntimacyRelations.playerBId,
        requestedBy: playerIntimacyRelations.requestedBy,
        relationType: playerIntimacyRelations.relationType,
        status: playerIntimacyRelations.status,
        createdAt: playerIntimacyRelations.createdAt,
        updatedAt: playerIntimacyRelations.updatedAt,
      }).get()
      : await db.insert(playerIntimacyRelations).values({
        playerAId: pair.playerAId,
        playerBId: pair.playerBId,
        requestedBy: player.id,
        relationType: relationTypeRaw,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        respondedAt: null,
      }).returning({
        id: playerIntimacyRelations.id,
        playerAId: playerIntimacyRelations.playerAId,
        playerBId: playerIntimacyRelations.playerBId,
        requestedBy: playerIntimacyRelations.requestedBy,
        relationType: playerIntimacyRelations.relationType,
        status: playerIntimacyRelations.status,
        createdAt: playerIntimacyRelations.createdAt,
        updatedAt: playerIntimacyRelations.updatedAt,
      }).get();

    if (!relation) {
      return NextResponse.json({ success: false, error: "发起绑定申请失败" }, { status: 500 });
    }

    publishSocialEvent([target.id], {
      type: "intimacy_request",
      data: {
        relationId: relation.id,
        requesterId: player.id,
        requesterName: player.name || "无名修士",
        relationType: relation.relationType,
        createdAt: relation.createdAt,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        relation,
      },
    });
  } catch (error) {
    console.error("Intimacy request error:", error);
    return NextResponse.json({ success: false, error: "发起绑定申请失败" }, { status: 500 });
  }
}
