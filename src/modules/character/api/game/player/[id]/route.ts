import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { avatarAssets, avatarFrameAssets, items, playerInventory, players, skills } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import {
  getDoubleCultivationPregnancyDisplayStats,
  mergePregnancyDisplayStatus,
} from "@/modules/character/services/pregnancy-display-status";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { enrichItemEffectsForDisplay } from "@/modules/character/services/item-effect-display";
import { getEquipmentDisplayEffects } from "@/modules/character/services/equipment-stat-rules";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { getPlayerStatuses, syncPlayerStatuses } from "@/modules/character/services/player-status";
import {
  collectPlayerProfileActionsByPlugins,
  collectPlayerProfileBottomContentsByPlugins,
  extendPlayerProfileByPlugins,
} from "@/modules/shared/services/legacy-plugin-compat";
import {
  sanitizePlayerFacingItemDescription,
  sanitizePlayerFacingItemName,
} from "@/modules/shared/services/player-facing-copy";
import type { PlayerProfileAction, PlayerProfileBottomContent } from "@/modules/shared/types/legacy-plugin";
import { getPlayerSectSummary } from "@/modules/sect/services/sect-service";
import { getSafePlayerWorldReputationSummary } from "@/modules/world/services/player-world-pressure-service";

const HIDDEN_PROFILE_PLUGIN_IDS = new Set(["spiritual-field"]);
const HIDDEN_PROFILE_EXTRA_KEYS = new Set(["spiritualFieldSummary"]);
const EQUIPMENT_SLOT_ORDER: Record<string, number> = {
  weapon: 1,
  helmet: 2,
  armor: 3,
  shoes: 4,
  artifact_1: 5,
  artifact_2: 6,
  artifact_3: 7,
  artifact_4: 8,
};

type PlayerProfileEquipmentItem = {
  itemId: string;
  name: string;
  iconUrl: string | null;
  description: string | null;
  itemType: string;
  rarity: string;
  equipSlot: string | null;
  minRealm: number | null;
  maxRealm: number | null;
  effectTextLines: string[];
  effects: ReturnType<typeof enrichItemEffectsForDisplay>;
};

function filterPlayerProfileActions(actions: PlayerProfileAction[]) {
  return actions.filter((action) => !HIDDEN_PROFILE_PLUGIN_IDS.has(action.pluginId));
}

function filterPlayerProfileBottomContents(contents: PlayerProfileBottomContent[]) {
  return contents.filter((content) => !HIDDEN_PROFILE_PLUGIN_IDS.has(content.pluginId));
}

function filterPlayerProfileExtra(extra: Record<string, unknown> | null | undefined) {
  if (!extra) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(extra).filter(([key]) => !HIDDEN_PROFILE_EXTRA_KEYS.has(key)),
  );
}

async function loadPlayerProfileEquippedItems(playerId: string): Promise<PlayerProfileEquipmentItem[]> {
  const equippedRows = await db.select({
    itemId: playerInventory.itemId,
    equipSlot: playerInventory.equipSlot,
    stageMult: playerInventory.stageMult,
    refineLevel: playerInventory.refineLevel,
    name: items.name,
    iconUrl: items.iconUrl,
    description: items.description,
    itemType: items.itemType,
    rarity: items.rarity,
    minRealm: items.minRealm,
    maxRealm: items.maxRealm,
    effects: items.effects,
  }).from(playerInventory)
    .innerJoin(items, eq(playerInventory.itemId, items.id))
    .where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.equipped, true),
    ))
    .all();

  const skillIds = new Set<string>();
  const avatarIds = new Set<string>();
  const avatarFrameIds = new Set<string>();

  for (const row of equippedRows) {
    const effects = Array.isArray(row.effects) ? row.effects : [];
    for (const effect of effects) {
      if (effect && typeof effect === "object") {
        const rawSkillId = typeof effect.skillId === "string" ? effect.skillId.trim() : "";
        const rawAvatarId = typeof effect.avatarId === "string" ? effect.avatarId.trim() : "";
        const rawAvatarFrameId = typeof effect.avatarFrameId === "string" ? effect.avatarFrameId.trim() : "";
        if (rawSkillId) {
          skillIds.add(rawSkillId);
        }
        if (rawAvatarId) {
          avatarIds.add(rawAvatarId);
        }
        if (rawAvatarFrameId) {
          avatarFrameIds.add(rawAvatarFrameId);
        }
      }
    }
  }

  const [skillRows, avatarRows, avatarFrameRows] = await Promise.all([
    skillIds.size > 0
      ? db.select({ id: skills.id, name: skills.name }).from(skills).where(inArray(skills.id, Array.from(skillIds))).all()
      : Promise.resolve([]),
    avatarIds.size > 0
      ? db.select({ id: avatarAssets.id, name: avatarAssets.name }).from(avatarAssets).where(inArray(avatarAssets.id, Array.from(avatarIds))).all()
      : Promise.resolve([]),
    avatarFrameIds.size > 0
      ? db.select({ id: avatarFrameAssets.id, name: avatarFrameAssets.name }).from(avatarFrameAssets).where(inArray(avatarFrameAssets.id, Array.from(avatarFrameIds))).all()
      : Promise.resolve([]),
  ]);

  const skillNameMap = new Map(skillRows.map((row) => [row.id, row.name]));
  const avatarNameMap = new Map(avatarRows.map((row) => [row.id, row.name]));
  const avatarFrameNameMap = new Map(avatarFrameRows.map((row) => [row.id, row.name]));

  return equippedRows
    .map((row) => {
      const baseEffects = getEquipmentDisplayEffects(Array.isArray(row.effects) ? row.effects : [], row.stageMult, row.refineLevel ?? 0);
      const enrichedEffects = enrichItemEffectsForDisplay(baseEffects.map((effect) => ({
        ...effect,
        skillName: typeof effect?.skillId === "string" ? (skillNameMap.get(effect.skillId.trim()) || null) : null,
        avatarName: typeof effect?.avatarId === "string" ? (avatarNameMap.get(effect.avatarId.trim()) || null) : null,
        avatarFrameName: typeof effect?.avatarFrameId === "string" ? (avatarFrameNameMap.get(effect.avatarFrameId.trim()) || null) : null,
      })));

      return {
        itemId: row.itemId,
        equipSlot: row.equipSlot || null,
        name: sanitizePlayerFacingItemName(row.name, { itemType: row.itemType, rarity: row.rarity }),
        iconUrl: row.iconUrl || null,
        description: sanitizePlayerFacingItemDescription(row.description, { itemType: row.itemType, rarity: row.rarity }),
        itemType: row.itemType,
        rarity: row.rarity,
        minRealm: row.minRealm ?? null,
        maxRealm: row.maxRealm ?? null,
        effects: enrichedEffects,
        effectTextLines: enrichedEffects.map((effect) => effect.text),
      };
    })
    .sort((left, right) => {
      const leftOrder = EQUIPMENT_SLOT_ORDER[left.equipSlot || left.itemType] ?? 999;
      const rightOrder = EQUIPMENT_SLOT_ORDER[right.equipSlot || right.itemType] ?? 999;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentPlayer = await getCurrentPlayer();
    if (!currentPlayer) {
      return NextResponse.json({ success: false, error: "\u672A\u767B\u5F55" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: "\u73A9\u5BB6\u4E0D\u5B58\u5728" }, { status: 404 });
    }

    const targetPlayer = await db.select({
      id: players.id,
      name: players.name,
      gender: players.gender,
      realmName: players.realmName,
      hp: players.hp,
      maxHp: players.maxHp,
      mp: players.mp,
      maxMp: players.maxMp,
      attack: players.attack,
      defense: players.defense,
      speed: players.speed,
      luck: players.luck,
      spiritualSense: players.spiritualSense,
      armorPenetration: players.armorPenetration,
      block: players.block,
      skillDamageBonus: players.skillDamageBonus,
      skillDamageReduction: players.skillDamageReduction,
      artifactDamageBonus: players.artifactDamageBonus,
      artifactDamageReduction: players.artifactDamageReduction,
      currentMapId: players.currentMapId,
      positionX: players.positionX,
      positionY: players.positionY,
    }).from(players)
      .where(eq(players.id, id))
      .get();

    if (!targetPlayer || !targetPlayer.name) {
      return NextResponse.json({ success: false, error: "\u73A9\u5BB6\u4E0D\u5B58\u5728" }, { status: 404 });
    }

    await syncPlayerStatuses(targetPlayer.id);

    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "").trim();
    const isPublicScope = scope === "public";

    if (!isPublicScope) {
      const myMapId = currentPlayer.currentMapId || "map_starter_village";
      const targetMapId = targetPlayer.currentMapId || "map_starter_village";
      if (myMapId !== targetMapId) {
        return NextResponse.json({ success: false, error: "\u73A9\u5BB6\u4E0D\u5728\u9644\u8FD1" }, { status: 403 });
      }

      const dx = Math.abs(currentPlayer.positionX - targetPlayer.positionX);
      const dy = Math.abs(currentPlayer.positionY - targetPlayer.positionY);
      const isAdjacent = Math.max(dx, dy) <= 1;
      if (!isAdjacent) {
        return NextResponse.json({ success: false, error: "\u73A9\u5BB6\u4E0D\u5728\u9644\u8FD1" }, { status: 403 });
      }
    }

    const profileScope = isPublicScope ? "public" : "nearby";
    const [
      targetStats,
      cosmetics,
      rawStatuses,
      rawPluginProfileExtra,
      rawPluginProfileActions,
      rawPluginProfileBottomContents,
      doubleCultivationStats,
      sectSummary,
      equippedItems,
      reputationSummary,
    ] = await Promise.all([
      buildPlayerStatsSnapshot(targetPlayer),
      getPlayerCosmeticProfileById(targetPlayer.id),
      getPlayerStatuses(targetPlayer.id, { skipSync: true }),
      extendPlayerProfileByPlugins({
        viewerPlayerId: currentPlayer.id,
        targetPlayerId: targetPlayer.id,
        scope: profileScope,
      }),
      collectPlayerProfileActionsByPlugins({
        viewerPlayerId: currentPlayer.id,
        targetPlayerId: targetPlayer.id,
        scope: profileScope,
      }),
      collectPlayerProfileBottomContentsByPlugins({
        viewerPlayerId: currentPlayer.id,
        targetPlayerId: targetPlayer.id,
        scope: profileScope,
      }),
      getDoubleCultivationPregnancyDisplayStats({
        id: targetPlayer.id,
        name: targetPlayer.name,
        gender: targetPlayer.gender,
        realmName: targetPlayer.realmName,
        currentMapId: targetPlayer.currentMapId,
        positionX: targetPlayer.positionX,
        positionY: targetPlayer.positionY,
        isAlive: true,
      }),
      getPlayerSectSummary(targetPlayer.id),
      loadPlayerProfileEquippedItems(targetPlayer.id),
      getSafePlayerWorldReputationSummary(targetPlayer.id),
    ]);
    const pluginProfileExtra = filterPlayerProfileExtra(rawPluginProfileExtra);
    const pluginProfileActions = filterPlayerProfileActions(rawPluginProfileActions);
    const pluginProfileBottomContents = filterPlayerProfileBottomContents(rawPluginProfileBottomContents);
    const statuses = mergePregnancyDisplayStatus(
      rawStatuses,
      doubleCultivationStats?.pregnancyDisplayStatus ?? null,
    );
    const adultProfileSummary = {
      corruptionValue: Number(pluginProfileExtra.adultCorruptionValue || 0),
      allureValue: Number(pluginProfileExtra.adultAllureValue || 0),
      shameValue: Number(pluginProfileExtra.adultShameValue || 0),
      stageLabel: typeof pluginProfileExtra.adultStageLabel === "string" && pluginProfileExtra.adultStageLabel.trim()
        ? pluginProfileExtra.adultStageLabel.trim()
        : "\u4ECD\u5B88\u8FB9\u754C",
    };

    return NextResponse.json({
      success: true,
      data: {
        id: targetPlayer.id,
        name: targetPlayer.name,
        gender: targetPlayer.gender,
        realmName: targetPlayer.realmName,
        maxHp: targetStats.total.maxHp,
        maxMp: targetStats.total.maxMp,
        attack: targetStats.total.attack,
        defense: targetStats.total.defense,
        speed: targetStats.total.speed,
        luck: targetStats.total.luck,
        spiritualSense: targetStats.total.spiritualSense,
        armorPenetration: targetStats.total.armorPenetration,
        block: targetStats.total.block,
        skillDamageBonus: targetStats.total.skillDamageBonus,
        skillDamageReduction: targetStats.total.skillDamageReduction,
        artifactDamageBonus: targetStats.total.artifactDamageBonus,
        artifactDamageReduction: targetStats.total.artifactDamageReduction,
        combatPower: calculateCombatPower(targetStats.total),
        avatarId: cosmetics.avatarId,
        avatarImageUrl: cosmetics.avatarImageUrl,
        avatarFrameId: cosmetics.avatarFrameId,
        avatarFrameImageUrl: cosmetics.avatarFrameImageUrl,
        statuses,
        uterusStorageMl: doubleCultivationStats?.uterusStorageMl ?? null,
        uterusCapacityMl: doubleCultivationStats?.uterusCapacityMl ?? null,
        pregnancyDisplayStatus: doubleCultivationStats?.pregnancyDisplayStatus ?? null,
        sectSummary,
        adultProfileSummary,
        reputationSummary,
        equippedItems,
        pluginProfileActions,
        pluginProfileBottomContents,
        ...pluginProfileExtra,
      },
    });
  } catch (e) {
    console.error("Player profile error:", e);
    return NextResponse.json({ success: false, error: "\u83B7\u53D6\u73A9\u5BB6\u4FE1\u606F\u5931\u8D25" }, { status: 500 });
  }
}
