import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { avatarAssets, avatarFrameAssets, playerInventory, skills } from "@/db/schema";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import { getPlayerHongmengTreasureStateByItemId } from "@/modules/character/services/hongmeng-treasure-service";
import { enrichItemEffectsForDisplay } from "@/modules/character/services/item-effect-display";
import { getItemByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { buildPlayerFacingItemBase } from "@/modules/character/services/player-facing-item";
import type { ItemEffect } from "@/types/game";
import { getEquipmentDisplayEffects } from "@/modules/character/services/equipment-stat-rules";
import { isEquippableItemType } from "@/modules/shared/constants";

/** GET - 获取单个背包物品详情 */
export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const { itemId: rawItemId } = await params;
    const itemId = decodeURIComponent(rawItemId || "").trim();
    if (!itemId) {
      return NextResponse.json({ success: false, error: "缺少物品ID" }, { status: 400 });
    }

    const item = await getItemByIdCompat(itemId);
    if (!item) {
      return NextResponse.json({ success: false, error: "物品不存在" }, { status: 404 });
    }
    const itemDetail = buildPlayerFacingItemBase(item);

    const [minRealmName, maxRealmName] = await Promise.all([
      item.minRealm !== null && item.minRealm !== undefined
        ? getRealmFullNameByLinearRealm(Number(item.minRealm))
        : Promise.resolve(null),
      item.maxRealm !== null && item.maxRealm !== undefined
        ? getRealmFullNameByLinearRealm(Number(item.maxRealm))
        : Promise.resolve(null),
    ]);

    const inv = await db.select().from(playerInventory)
      .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
      .get();

    const hongmengTreasure = await getPlayerHongmengTreasureStateByItemId({
      playerId: player.id,
      itemId,
    });

    const templateEffects = Array.isArray(item.effects) ? item.effects as ItemEffect[] : [];
    const effects = inv && isEquippableItemType(item.itemType)
      ? getEquipmentDisplayEffects(templateEffects, inv.stageMult, inv.refineLevel ?? 0)
      : templateEffects;
    const skillIdSet = new Set<string>();
    const avatarIdSet = new Set<string>();
    const avatarFrameIdSet = new Set<string>();
    for (const effect of effects) {
      if (typeof effect?.skillId === "string" && effect.skillId.trim()) {
        skillIdSet.add(effect.skillId.trim());
      }
      if (typeof effect?.avatarId === "string" && effect.avatarId.trim()) {
        avatarIdSet.add(effect.avatarId.trim());
      }
      if (typeof effect?.avatarFrameId === "string" && effect.avatarFrameId.trim()) {
        avatarFrameIdSet.add(effect.avatarFrameId.trim());
      }
    }

    const [skillRows, avatarRows, avatarFrameRows] = await Promise.all([
      skillIdSet.size > 0
        ? db.select({
          id: skills.id,
          name: skills.name,
        }).from(skills)
          .where(inArray(skills.id, Array.from(skillIdSet)))
          .all()
        : Promise.resolve([]),
      avatarIdSet.size > 0
        ? db.select({
          id: avatarAssets.id,
          name: avatarAssets.name,
        }).from(avatarAssets)
          .where(inArray(avatarAssets.id, Array.from(avatarIdSet)))
          .all()
        : Promise.resolve([]),
      avatarFrameIdSet.size > 0
        ? db.select({
          id: avatarFrameAssets.id,
          name: avatarFrameAssets.name,
        }).from(avatarFrameAssets)
          .where(inArray(avatarFrameAssets.id, Array.from(avatarFrameIdSet)))
          .all()
        : Promise.resolve([]),
    ]);

    const skillNameMap = new Map(skillRows.map((row) => [row.id, row.name]));
    const avatarNameMap = new Map(avatarRows.map((row) => [row.id, row.name]));
    const avatarFrameNameMap = new Map(avatarFrameRows.map((row) => [row.id, row.name]));
    const enrichedEffects = enrichItemEffectsForDisplay(effects.map((effect) => ({
      ...effect,
      skillName: typeof effect.skillId === "string" ? (skillNameMap.get(effect.skillId.trim()) || null) : null,
      avatarName: typeof effect.avatarId === "string" ? (avatarNameMap.get(effect.avatarId.trim()) || null) : null,
      avatarFrameName: typeof effect.avatarFrameId === "string" ? (avatarFrameNameMap.get(effect.avatarFrameId.trim()) || null) : null,
    })));

    return NextResponse.json({
      success: true,
      data: {
        quantity: inv?.quantity || 0,
        equipped: inv?.equipped || false,
        equipSlot: inv?.equipSlot || null,
        isHongmengTreasure: Boolean(hongmengTreasure),
        hongmengTreasure: hongmengTreasure ?? null,
        minRealmName,
        maxRealmName,
        ...itemDetail,
        effects: enrichedEffects,
        effectTextLines: enrichedEffects.map((effect) => effect.text),
      },
    });
  } catch (e) {
    console.error("Inventory item detail error:", e);
    return NextResponse.json({ success: false, error: "获取物品详情失败" }, { status: 500 });
  }
}
