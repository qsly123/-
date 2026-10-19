import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { simulatePlayerStatsToTargetRealm } from "@/modules/admin/services/admin-player-realm";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";

interface RealmCorrectionFailure {
  id: string;
  error: string;
}

function normalizePlayerRealm(value: unknown) {
  const realm = Number(value);
  if (!Number.isInteger(realm) || realm < 1) {
    throw new Error("当前境界非法");
  }
  return realm;
}

export async function POST() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const allPlayers = await db.select({
      id: players.id,
      realm: players.realm,
      spiritualRoot: players.spiritualRoot,
    }).from(players).all();

    const total = allPlayers.length;
    let successCount = 0;
    let failedCount = 0;
    const failures: RealmCorrectionFailure[] = [];

    for (const player of allPlayers) {
      try {
        const targetRealm = normalizePlayerRealm(player.realm);
        const simulated = await simulatePlayerStatsToTargetRealm({
          playerId: player.id,
          spiritualRoot: player.spiritualRoot || null,
          targetRealm,
        });

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
          updatedAt: new Date().toISOString(),
        }).where(eq(players.id, player.id)).run();

        const updatedPlayer = await getPlayerByIdCompat(player.id);
        if (updatedPlayer) {
          const snapshot = await buildPlayerStatsSnapshot(updatedPlayer);
          await db.update(players).set({
            hp: snapshot.total.maxHp,
            mp: snapshot.total.maxMp,
            updatedAt: new Date().toISOString(),
          }).where(eq(players.id, player.id)).run();
        }

        successCount += 1;
      } catch (error) {
        failedCount += 1;
        failures.push({
          id: player.id,
          error: error instanceof Error ? error.message : "境界矫正失败",
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total,
        successCount,
        failedCount,
        failures,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "境界矫正失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
