import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bossInstances, monsters } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import type { BossEvent } from "@/types/game";

type BossGlobal = typeof globalThis & {
  __bossEvents?: BossEvent[];
  __bossRooms?: Record<string, { participants: unknown[] }>;
};

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const { id } = await params;
    const monsterId = String(id || "").trim();
    if (!monsterId) {
      return NextResponse.json({ success: false, error: "Boss ID 不能为空" }, { status: 400 });
    }

    const monster = await db.select().from(monsters).where(eq(monsters.id, monsterId)).get();
    if (!monster) {
      return NextResponse.json({ success: false, error: "Boss不存在" }, { status: 404 });
    }

    if (monster.monsterType !== "boss") {
      return NextResponse.json({ success: false, error: "该怪物不是Boss，无法复活" }, { status: 400 });
    }

    const aliveInstance = await db.select().from(bossInstances)
      .where(and(eq(bossInstances.monsterId, monsterId), eq(bossInstances.status, "alive")))
      .orderBy(desc(bossInstances.id))
      .get();

    if (aliveInstance) {
      return NextResponse.json({ success: false, error: "Boss已存活，无需复活" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const latestInstance = await db.select().from(bossInstances)
      .where(eq(bossInstances.monsterId, monsterId))
      .orderBy(desc(bossInstances.id))
      .get();

    if (!latestInstance) {
      await db.insert(bossInstances).values({
        monsterId,
        currentHp: monster.hp,
        maxHp: monster.hp,
        lastHitPlayerId: null,
        status: "alive",
        damageMap: {},
        spawnedAt: now,
        killedAt: null,
        nextSpawnAt: null,
      }).run();
    } else {
      await db.update(bossInstances).set({
        currentHp: monster.hp,
        maxHp: monster.hp,
        lastHitPlayerId: null,
        status: "alive",
        damageMap: {},
        spawnedAt: now,
        killedAt: null,
        nextSpawnAt: null,
      }).where(eq(bossInstances.id, latestInstance.id)).run();
    }

    const bossGlobal = globalThis as BossGlobal;
    if (bossGlobal.__bossRooms) {
      delete bossGlobal.__bossRooms[monsterId];
    }
    bossGlobal.__bossEvents = bossGlobal.__bossEvents || [];
    bossGlobal.__bossEvents.push({
      type: "boss_spawn",
      bossId: monsterId,
      currentHp: monster.hp,
      maxHp: monster.hp,
      participants: [],
    });
    if (bossGlobal.__bossEvents.length > 500) {
      bossGlobal.__bossEvents.splice(0, bossGlobal.__bossEvents.length - 500);
    }

    return NextResponse.json({
      success: true,
      data: {
        monsterId,
        currentHp: monster.hp,
        maxHp: monster.hp,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Boss复活失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
