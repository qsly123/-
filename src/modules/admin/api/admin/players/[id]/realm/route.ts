import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { simulatePlayerStatsToTargetRealm } from "@/modules/admin/services/admin-player-realm";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";

function parseTargetRealm(value: unknown) {
  const targetRealm = Number(value);
  if (!Number.isInteger(targetRealm) || targetRealm < 1) {
    throw new Error("targetRealm 必须为大于等于 1 的整数");
  }
  return targetRealm;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const { id } = await params;
    const playerId = String(id || "").trim();
    if (!playerId) {
      return NextResponse.json({ success: false, error: "玩家ID不能为空" }, { status: 400 });
    }

    const body = await request.json();
    const targetRealm = parseTargetRealm(body?.targetRealm);

    const player = await db.select({
      id: players.id,
      spiritualRoot: players.spiritualRoot,
    }).from(players).where(eq(players.id, playerId)).get();

    if (!player) {
      return NextResponse.json({ success: false, error: "玩家不存在" }, { status: 404 });
    }

    const simulated = await simulatePlayerStatsToTargetRealm({
      playerId: player.id,
      spiritualRoot: player.spiritualRoot || null,
      targetRealm,
    });
    const now = new Date().toISOString();

    await db.update(players).set({
      realm: simulated.realm,
      realmMajor: simulated.realmMajor,
      realmMinor: simulated.realmMinor,
      realmName: simulated.realmName,
      hp: simulated.maxHp,
      maxHp: simulated.maxHp,
      mp: simulated.maxMp,
      maxMp: simulated.maxMp,
      attack: simulated.attack,
      defense: simulated.defense,
      speed: simulated.speed,
      luck: simulated.luck,
      breakthroughBonusRate: 0,
      updatedAt: now,
    }).where(eq(players.id, playerId)).run();

    const updatedPlayer = await getPlayerByIdCompat(playerId);
    if (updatedPlayer) {
      const snapshot = await buildPlayerStatsSnapshot(updatedPlayer);
      await db.update(players).set({
        hp: snapshot.total.maxHp,
        mp: snapshot.total.maxMp,
        updatedAt: new Date().toISOString(),
      }).where(eq(players.id, playerId)).run();
    }

    return NextResponse.json({
      success: true,
      data: {
        id: player.id,
        ...simulated,
        breakthroughBonusRate: 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "境界操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
