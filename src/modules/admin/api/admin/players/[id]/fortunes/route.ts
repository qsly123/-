import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { fortunes, playerFortunes, players } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { grantFortunesToPlayer, removePlayerFortune, syncExpiredFortunes } from "@/modules/character/services/fortune-service";

function parseFortuneIds(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const single = String(value || "").trim();
  return single ? [single] : [];
}

function parseSourceType(value: unknown) {
  const sourceType = String(value || "").trim();
  if (!sourceType) {
    return "admin";
  }
  if (sourceType === "starter" || sourceType === "quest" || sourceType === "random_event" || sourceType === "admin" || sourceType === "system") {
    return sourceType;
  }
  return "admin";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const playerId = String(id || "").trim();
  if (!playerId) {
    return NextResponse.json({ success: false, error: "玩家ID不能为空" }, { status: 400 });
  }

  const player = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId)).get();
  if (!player) {
    return NextResponse.json({ success: false, error: "玩家不存在" }, { status: 404 });
  }

  await syncExpiredFortunes({ playerId });

  const list = await db.select({
    playerFortuneId: playerFortunes.id,
    playerId: playerFortunes.playerId,
    fortuneId: playerFortunes.fortuneId,
    sourceType: playerFortunes.sourceType,
    sourceRef: playerFortunes.sourceRef,
    status: playerFortunes.status,
    acquiredAt: playerFortunes.acquiredAt,
    expiresAt: playerFortunes.expiresAt,
    endedAt: playerFortunes.endedAt,
    createdAt: playerFortunes.createdAt,
    updatedAt: playerFortunes.updatedAt,
    fortuneName: fortunes.name,
    fortuneGrade: fortunes.grade,
    fortuneEnabled: fortunes.enabled,
  }).from(playerFortunes)
    .innerJoin(fortunes, eq(playerFortunes.fortuneId, fortunes.id))
    .where(and(
      eq(playerFortunes.playerId, playerId),
      eq(playerFortunes.status, "active"),
    ))
    .orderBy(desc(playerFortunes.acquiredAt), desc(playerFortunes.id))
    .all();

  return NextResponse.json({
    success: true,
    data: {
      list,
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const playerId = String(id || "").trim();
  if (!playerId) {
    return NextResponse.json({ success: false, error: "玩家ID不能为空" }, { status: 400 });
  }

  const player = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId)).get();
  if (!player) {
    return NextResponse.json({ success: false, error: "玩家不存在" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const fortuneIds = parseFortuneIds(body?.fortuneIds);
    if (!fortuneIds.length) {
      return NextResponse.json({ success: false, error: "fortuneIds 不能为空" }, { status: 400 });
    }

    const sourceType = parseSourceType(body?.sourceType);
    const sourceRef = typeof body?.sourceRef === "string" ? body.sourceRef.trim() || null : null;

    const results = await grantFortunesToPlayer({
      playerId,
      fortuneIds,
      sourceType,
      sourceRef,
      allowDisabled: false,
    });

    return NextResponse.json({
      success: true,
      data: {
        results,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发放气运失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { id } = await params;
  const playerId = String(id || "").trim();
  if (!playerId) {
    return NextResponse.json({ success: false, error: "玩家ID不能为空" }, { status: 400 });
  }

  const player = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId)).get();
  if (!player) {
    return NextResponse.json({ success: false, error: "玩家不存在" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const playerFortuneId = Number(body?.playerFortuneId);
    if (!Number.isFinite(playerFortuneId)) {
      return NextResponse.json({ success: false, error: "playerFortuneId 非法" }, { status: 400 });
    }

    const target = await db.select({
      id: playerFortunes.id,
      playerId: playerFortunes.playerId,
    }).from(playerFortunes).where(and(
      eq(playerFortunes.id, Math.floor(playerFortuneId)),
      eq(playerFortunes.playerId, playerId),
    )).get();

    if (!target) {
      return NextResponse.json({ success: false, error: "玩家气运记录不存在" }, { status: 404 });
    }

    const removed = await removePlayerFortune({
      playerId,
      playerFortuneId: target.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        removed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "移除气运失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
