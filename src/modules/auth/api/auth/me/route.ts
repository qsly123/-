import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { avatarAssets, avatarFrameAssets, items, playerInventory } from "@/db/schema";
import { getCurrentAccount, getCurrentPlayer } from "@/modules/auth/services/auth";
import { buildPlayerStatsSnapshotWithOptions } from "@/modules/character/services/player-stats";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import { getPlayerFortuneSpecialEffectSum } from "@/modules/character/services/fortune-service";
import { mergePregnancyDisplayStatus } from "@/modules/character/services/pregnancy-display-status";
import { createPlayerStatusContext } from "@/modules/character/services/player-status";
import { getBreakthroughRateByPosition, getBreakthroughXpByPosition } from "@/modules/character/services/realm-service";
import { getStaminaSettings } from "@/modules/character/services/stamina-service";
import { scheduleExpiredTemporaryCosmeticsCleanup } from "@/modules/character/services/temporary-cosmetic-service";
import { getGameMaintenanceStatus } from "@/modules/system/services/game-maintenance";
import { getSafePlayerWorldReputationSummary } from "@/modules/world/services/player-world-pressure-service";
import {
  buildDoubleCultivationProfileBottomContents,
  getDoubleCultivationStats,
} from "@/modules/world/services/double-cultivation-core-api";
import {
  ARTIFACT_EQUIP_SLOTS,
  isArtifactEquipSlot,
  isEquippableItemType,
} from "@/modules/shared/constants";
import { getPlayerSectSummary } from "@/modules/sect/services/sect-service";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function normalizeAuthMeView(request: Request) {
  const view = new URL(request.url).searchParams.get("view")?.trim().toLowerCase();
  return view === "summary" ? "summary" : "full";
}

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, {
        status: 401,
        headers: NO_STORE_HEADERS,
      });
    }

    const maintenanceStatus = await getGameMaintenanceStatus();
    if (maintenanceStatus.enabled) {
      return NextResponse.json({
        success: false,
        error: maintenanceStatus.message,
        maintenance: true,
      }, {
        status: 503,
        headers: NO_STORE_HEADERS,
      });
    }

    void scheduleExpiredTemporaryCosmeticsCleanup();

    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未选择角色" }, {
        status: 409,
        headers: NO_STORE_HEADERS,
      });
    }

    const { accountId, ...safePlayer } = player;
    void accountId;
    const view = normalizeAuthMeView(request);
    const statusContext = createPlayerStatusContext(player.id);

    const [statusBonus, staminaSettings, avatar, avatarFrame, doubleCultivationStats, sectSummary, reputationSummary] = await Promise.all([
      statusContext.getAttrBonus(),
      getStaminaSettings(),
      player.avatarId
        ? db.select({
          id: avatarAssets.id,
          imageUrl: avatarAssets.imageUrl,
        }).from(avatarAssets)
          .where(and(
            eq(avatarAssets.id, player.avatarId),
            eq(avatarAssets.enabled, true),
          ))
          .get()
        : Promise.resolve(null),
      player.avatarFrameId
        ? db.select({
          id: avatarFrameAssets.id,
          imageUrl: avatarFrameAssets.imageUrl,
        }).from(avatarFrameAssets)
          .where(and(
            eq(avatarFrameAssets.id, player.avatarFrameId),
            eq(avatarFrameAssets.enabled, true),
          ))
          .get()
        : Promise.resolve(null),
      getDoubleCultivationStats({
        playerId: player.id,
        gender: player.gender,
      }),
      getPlayerSectSummary(player.id),
      getSafePlayerWorldReputationSummary(player.id),
    ]);
    const snapshot = await buildPlayerStatsSnapshotWithOptions(player, {
      statusBonus,
    });
    const adultProfileSummary = {
      corruptionValue: Number(doubleCultivationStats.adultProfile?.corruptionValue || 0),
      allureValue: Number(doubleCultivationStats.adultProfile?.allureValue || 0),
      shameValue: Number(doubleCultivationStats.adultProfile?.shameValue || 0),
      stageLabel: typeof doubleCultivationStats.adultProfile?.stageLabel === "string" && doubleCultivationStats.adultProfile.stageLabel.trim()
        ? doubleCultivationStats.adultProfile.stageLabel.trim()
        : "仍守边界",
    };

    if (view === "summary") {
      return NextResponse.json({
        success: true,
        data: {
          id: safePlayer.id,
          name: safePlayer.name,
          gender: safePlayer.gender,
          realm: safePlayer.realm,
          realmMajor: safePlayer.realmMajor,
          realmMinor: safePlayer.realmMinor,
          realmName: safePlayer.realmName,
          hp: snapshot.total.hp,
          maxHp: snapshot.total.maxHp,
          mp: snapshot.total.mp,
          maxMp: snapshot.total.maxMp,
          combatPower: calculateCombatPower(snapshot.total),
          gold: safePlayer.gold,
          lingYu: safePlayer.lingYu,
          stamina: safePlayer.stamina,
          staminaMax: staminaSettings.max,
          staminaRecoverPerHour: staminaSettings.recoverPerHour,
          staminaRecoverPerInterval: staminaSettings.recoverPerInterval,
          staminaRecoverIntervalMinutes: staminaSettings.recoverIntervalMinutes,
          avatarId: safePlayer.avatarId,
          avatarImageUrl: avatar?.imageUrl || null,
          avatarFrameId: safePlayer.avatarFrameId,
          avatarFrameImageUrl: avatarFrame?.imageUrl || null,
          uterusStorageMl: doubleCultivationStats?.uterusStorageMl ?? null,
          uterusCapacityMl: doubleCultivationStats?.uterusCapacityMl ?? null,
          pregnancyDisplayStatus: doubleCultivationStats?.pregnancyDisplayStatus ?? null,
          adultProfileSummary,
          reputationSummary,
          sectSummary,
        },
      }, {
        headers: NO_STORE_HEADERS,
      });
    }

    const major = player.realmMajor || 1;
    const minor = player.realmMinor || 1;
    const breakthroughRequiredXp = await getBreakthroughXpByPosition(major, minor);
    const breakthroughBaseRate = await getBreakthroughRateByPosition(major, minor);
    const [
      fortuneBreakthroughBonusRate,
      statuses,
      equippedItems,
    ] = await Promise.all([
      getPlayerFortuneSpecialEffectSum({
        playerId: player.id,
        key: "breakthroughSuccessRate",
      }),
      statusContext.getStatuses(),
      db.select({
        itemId: items.id,
        name: items.name,
        itemType: items.itemType,
        iconUrl: items.iconUrl,
        equipSlot: playerInventory.equipSlot,
      }).from(playerInventory)
        .innerJoin(items, eq(playerInventory.itemId, items.id))
        .where(and(
          eq(playerInventory.playerId, player.id),
          eq(playerInventory.equipped, true),
        ))
        .all(),
    ]);
    const statusBreakthroughBonusRate = statuses.reduce(
      (sum, status) => sum + Number(status.flowEffects.breakthroughSuccessRate || 0),
      0,
    );
    const breakthroughBonusRate = Number(player.breakthroughBonusRate || 0)
      + fortuneBreakthroughBonusRate
      + statusBreakthroughBonusRate;
    const breakthroughSuccessRate = Math.min(0.95, breakthroughBaseRate + breakthroughBonusRate);

    const equipment = {
      weapon: null as { id: string; name: string; iconUrl: string | null } | null,
      helmet: null as { id: string; name: string; iconUrl: string | null } | null,
      armor: null as { id: string; name: string; iconUrl: string | null } | null,
      shoes: null as { id: string; name: string; iconUrl: string | null } | null,
      artifacts: ARTIFACT_EQUIP_SLOTS.map(() => null as {
        id: string;
        name: string;
        iconUrl: string | null;
        equipSlot: string;
      } | null),
    };

    for (const equippedItem of equippedItems) {
      if (!isEquippableItemType(equippedItem.itemType)) {
        continue;
      }

      const normalizedItem = {
        id: equippedItem.itemId,
        name: equippedItem.name,
        iconUrl: equippedItem.iconUrl || null,
      };

      if (equippedItem.itemType === "artifact") {
        if (!equippedItem.equipSlot || !isArtifactEquipSlot(equippedItem.equipSlot)) {
          continue;
        }
        const slotIndex = ARTIFACT_EQUIP_SLOTS.indexOf(equippedItem.equipSlot);
        if (slotIndex < 0 || equipment.artifacts[slotIndex]) {
          continue;
        }
        equipment.artifacts[slotIndex] = {
          ...normalizedItem,
          equipSlot: equippedItem.equipSlot,
        };
        continue;
      }

      if (equipment[equippedItem.itemType]) {
        continue;
      }
      equipment[equippedItem.itemType] = normalizedItem;
    }

    const mergedStatuses = mergePregnancyDisplayStatus(
      statuses,
      doubleCultivationStats?.pregnancyDisplayStatus ?? null,
    );
    const pluginProfileBottomContents = buildDoubleCultivationProfileBottomContents(doubleCultivationStats);

    return NextResponse.json({
      success: true,
      data: {
        ...safePlayer,
        hp: snapshot.total.hp,
        maxHp: snapshot.total.maxHp,
        mp: snapshot.total.mp,
        maxMp: snapshot.total.maxMp,
        attack: snapshot.total.attack,
        defense: snapshot.total.defense,
        speed: snapshot.total.speed,
        spiritualSense: snapshot.total.spiritualSense,
        armorPenetration: snapshot.total.armorPenetration,
        block: snapshot.total.block,
        skillDamageBonus: snapshot.total.skillDamageBonus,
        skillDamageReduction: snapshot.total.skillDamageReduction,
        artifactDamageBonus: snapshot.total.artifactDamageBonus,
        artifactDamageReduction: snapshot.total.artifactDamageReduction,
        luck: snapshot.total.luck,
        combatPower: calculateCombatPower(snapshot.total),
        stamina: player.stamina,
        staminaMax: staminaSettings.max,
        staminaRecoverPerHour: staminaSettings.recoverPerHour,
        staminaRecoverPerInterval: staminaSettings.recoverPerInterval,
        staminaRecoverIntervalMinutes: staminaSettings.recoverIntervalMinutes,
        statsBreakdown: snapshot,
        avatarId: player.avatarId,
        avatarImageUrl: avatar?.imageUrl || null,
        avatarFrameId: player.avatarFrameId,
        avatarFrameImageUrl: avatarFrame?.imageUrl || null,
        breakthroughRequiredXp,
        breakthroughBaseRate,
        breakthroughBonusRate,
        breakthroughSuccessRate,
        statuses: mergedStatuses,
        uterusStorageMl: doubleCultivationStats?.uterusStorageMl ?? null,
        uterusCapacityMl: doubleCultivationStats?.uterusCapacityMl ?? null,
        pregnancyDisplayStatus: doubleCultivationStats?.pregnancyDisplayStatus ?? null,
        equipment,
        sectSummary,
        adultProfileSummary,
        reputationSummary,
        pluginProfileBottomContents,
      },
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return NextResponse.json({ success: false, error: "获取信息失败" }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}
