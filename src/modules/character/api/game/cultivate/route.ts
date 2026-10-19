import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { attemptBreakthrough } from "@/modules/character/services/cultivation";
import {
  GONGFA_POINTS_PER_MAJOR_BREAKTHROUGH,
  GONGFA_POINTS_PER_MINOR_BREAKTHROUGH,
  grantGongfaPoints,
} from "@/modules/character/services/gongfa-service";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getBreakthroughXpByPosition } from "@/modules/character/services/realm-service";
import { getPlayerFortuneSpecialEffectSum } from "@/modules/character/services/fortune-service";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getPlayerStatusFlowEffectSum, syncPlayerStatuses } from "@/modules/character/services/player-status";
import { publishSystemAnnouncement } from "@/modules/chat/services/chat-service";

export async function POST() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    await syncPlayerStatuses(player.id);
    const [fortuneBreakthroughBonusRate, statusBreakthroughBonusRate] = await Promise.all([
      getPlayerFortuneSpecialEffectSum({
        playerId: player.id,
        key: "breakthroughSuccessRate",
      }),
      getPlayerStatusFlowEffectSum({
        playerId: player.id,
        key: "breakthroughSuccessRate",
      }),
    ]);
    const bonusRate = Number(player.breakthroughBonusRate || 0)
      + fortuneBreakthroughBonusRate
      + statusBreakthroughBonusRate;
    const currentMajor = player.realmMajor || 1;
    const currentMinor = player.realmMinor || 1;

    const result = await attemptBreakthrough({
      playerId: player.id,
      gender: player.gender,
      currentMajor,
      currentMinor,
      currentXp: player.cultivationXp,
      bonusRate,
      currentStats: {
        hp: player.hp,
        maxHp: player.maxHp,
        mp: player.mp,
        maxMp: player.maxMp,
        attack: player.attack,
        defense: player.defense,
        speed: player.speed,
        luck: player.luck,
        spiritualSense: player.spiritualSense,
        armorPenetration: player.armorPenetration,
        block: player.block,
        skillDamageBonus: player.skillDamageBonus,
        skillDamageReduction: player.skillDamageReduction,
        artifactDamageBonus: player.artifactDamageBonus,
        artifactDamageReduction: player.artifactDamageReduction,
      },
    });

    if (result.success) {
      await db.update(players).set({
        realm: result.newRealm,
        realmMajor: result.newMajor,
        realmMinor: result.newMinor,
        realmName: result.newRealmName,
        cultivationXp: result.newXp,
        maxHp: result.newStats.maxHp,
        hp: result.newStats.maxHp,
        maxMp: result.newStats.maxMp,
        mp: result.newStats.maxMp,
        attack: result.newStats.attack,
        defense: result.newStats.defense,
        speed: result.newStats.speed,
        luck: result.newStats.luck,
        spiritualSense: result.newStats.spiritualSense,
        armorPenetration: result.newStats.armorPenetration,
        block: result.newStats.block,
        skillDamageBonus: result.newStats.skillDamageBonus,
        skillDamageReduction: result.newStats.skillDamageReduction,
        artifactDamageBonus: result.newStats.artifactDamageBonus,
        artifactDamageReduction: result.newStats.artifactDamageReduction,
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

      // 功法点：突破是它的产出途径（跨大境界多给）
      try {
        await grantGongfaPoints({
          playerId: player.id,
          amount: result.newMajor > currentMajor
            ? GONGFA_POINTS_PER_MAJOR_BREAKTHROUGH
            : GONGFA_POINTS_PER_MINOR_BREAKTHROUGH,
          source: "breakthrough",
          reason: `突破至 ${result.newRealmName}`,
          sourceRef: `realm:${result.newRealm}`,
        });
      } catch (gongfaError) {
        console.error(
          "Gongfa point grant error:",
          gongfaError instanceof Error ? gongfaError.message : String(gongfaError),
        );
      }

      if (result.newMajor > currentMajor) {
        const playerName = (player.name || "无名修士").trim() || "无名修士";
        void publishSystemAnnouncement(`【破境】${playerName} 突破至 ${result.newRealmName}！`).catch((announcementError) => {
          console.error("Realm breakthrough announcement error:", announcementError);
        });
      }
    } else if (result.newXp !== player.cultivationXp) {
      const nextBonusRate = Math.min(0.95, Number(player.breakthroughBonusRate || 0) + 0.05);
      await db.update(players).set({
        cultivationXp: result.newXp,
        hp: Math.max(1, Math.floor(player.hp * 0.5)),
        breakthroughBonusRate: nextBonusRate,
        updatedAt: new Date().toISOString(),
      }).where(eq(players.id, player.id)).run();
    }

    const nextMajor = result.success ? result.newMajor : currentMajor;
    const nextMinor = result.success ? result.newMinor : currentMinor;
    const breakthroughRequiredXp = await getBreakthroughXpByPosition(nextMajor, nextMinor);

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        breakthroughRequiredXp,
      },
    });
  } catch (error) {
    console.error("Cultivation error:", error);
    return NextResponse.json({ success: false, error: "突破失败" }, { status: 500 });
  }
}
