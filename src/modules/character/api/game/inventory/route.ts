import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import {
  avatarAssets,
  avatarFrameAssets,
  hongmengTreasureConfigs,
  items,
  playerCombatSettings,
  playerInventory,
  playerSkills,
  players,
  skills,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import type { ItemEffect } from "@/types/game";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getEquipmentDisplayEffects } from "@/modules/character/services/equipment-stat-rules";
import {
  ARTIFACT_EQUIP_SLOTS,
  MAX_EQUIPPED_SHENTONG_SKILLS,
  isArtifactEquipSlot,
  isEquippableItemType,
} from "@/modules/shared/constants";
import { getPlayerSkillLoadout } from "@/modules/character/services/player-active-skills";
import { applyXpRateForPlayerDetailed } from "@/modules/character/services/fortune-service";
import { getPlayerHongmengTreasureStateMap } from "@/modules/character/services/hongmeng-treasure-service";
import { resolvePillCrossRealmRate } from "@/modules/character/services/pill-cross-realm";
import { enrichItemEffectsForDisplay } from "@/modules/character/services/item-effect-display";
import {
  buildPlayerPillToxicityStatus,
  getXpPillToxicityGain,
} from "@/modules/character/services/pill-toxicity-service";
import {
  getItemByIdCompat,
  getItemsByIdsCompat,
  isPlayerPillToxicitySchemaMissing,
} from "@/modules/character/services/pill-toxicity-schema-compat";
import {
  buildQuickSellPreview,
  hasActiveQuickSellFilters,
  type QuickSellFilterState,
} from "@/modules/character/services/inventory-quick-sell";
import { getStaminaSettings } from "@/modules/character/services/stamina-service";
import { getBreakthroughXpByPosition } from "@/modules/character/services/realm-service";
import { sanitizePlayerFacingItemName } from "@/modules/shared/services/player-facing-copy";
import { buildPlayerFacingItemBase } from "@/modules/character/services/player-facing-item";
import {
  normalizeTemporaryDurationDays,
  unlockAvatarForPlayer,
  unlockAvatarFrameForPlayer,
} from "@/modules/character/services/temporary-cosmetic-service";

type InventoryEffectDisplay = ItemEffect & {
  label: string;
  text: string;
  extraText: string;
};

type InventoryListItem = ReturnType<typeof buildPlayerFacingItemBase> & {
  itemId: string;
  quantity: number;
  equipped: boolean;
  equipSlot: string | null;
  effects: InventoryEffectDisplay[];
};

type InventoryActionRequest = {
  action: string;
  itemId?: string;
  dropQuantity?: number;
  equipSlot?: string;
  filters?: QuickSellFilterState | null;
};

/** GET - 获取背包 */
export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const inv = await db.select().from(playerInventory)
      .where(eq(playerInventory.playerId, player.id))
      .orderBy(asc(playerInventory.itemId))
      .all();

    const itemIds = Array.from(new Set(
      inv
        .map((inventoryItem) => inventoryItem.itemId)
        .filter((itemId): itemId is string => typeof itemId === "string" && !!itemId),
    ));
    const inventoryItems = await getItemsByIdsCompat(itemIds);
    const itemMap = new Map(
      inventoryItems.map((item) => [item.id, item]),
    );

    const itemList = inv
      .map((pi) => {
        const item = itemMap.get(pi.itemId);
        if (!item) {
          return null;
        }
        const publicItem = buildPlayerFacingItemBase(item);
        return {
          ...publicItem,
          itemId: pi.itemId,
          quantity: pi.quantity,
          equipped: pi.equipped,
          equipSlot: pi.equipSlot,
          effects: enrichItemEffectsForDisplay(isEquippableItemType(item.itemType)
            ? getEquipmentDisplayEffects((item.effects ?? []) as ItemEffect[], pi.stageMult, pi.refineLevel ?? 0)
            : (item.effects ?? []) as ItemEffect[]),
        };
      })
      .filter((item): item is InventoryListItem => item !== null);

    const hongmengTreasureStates = await getPlayerHongmengTreasureStateMap({
      playerId: player.id,
      itemIds: itemList.map((item) => item.itemId),
    });
    const pillToxicityStatus = await buildPlayerPillToxicityStatus(player);

    return NextResponse.json({
      success: true,
      data: {
        items: itemList.map((item) => ({
          ...item,
          isHongmengTreasure: Boolean(hongmengTreasureStates[item.itemId]),
          hongmengTreasure: hongmengTreasureStates[item.itemId] ?? null,
        })),
        gold: player.gold,
        lingYu: player.lingYu,
        pillToxicity: pillToxicityStatus,
      },
    });
  } catch (e) {
    console.error("Inventory error:", e);
    return NextResponse.json({ success: false, error: "获取背包失败" }, { status: 500 });
  }
}

async function consumeOneItem(playerId: string, itemId: string, quantity: number) {
  if (quantity <= 1) {
    await db.delete(playerInventory)
      .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
      .run();
    return;
  }

  await db.update(playerInventory).set({ quantity: quantity - 1 })
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
    .run();
}

function buildRealmRangeError(
  realm: number,
  minRealm: number | null | undefined,
  maxRealm: number | null | undefined,
  label: string,
  action: string
) {
  if (minRealm !== null && minRealm !== undefined && realm < minRealm) {
    return `境界不足，无法${action}${label}`;
  }
  if (maxRealm !== null && maxRealm !== undefined && realm > maxRealm) {
    return `当前境界过高，无法${action}${label}`;
  }
  return null;
}

async function handleQuickSellAction(playerId: string, filters?: QuickSellFilterState | null) {
  if (!hasActiveQuickSellFilters(filters)) {
    return NextResponse.json({
      success: false,
      error: "请至少选择一种类型或品质后再进行快捷出售",
    }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const currentPlayer = await tx.select({
      id: players.id,
      gold: players.gold,
    }).from(players)
      .where(eq(players.id, playerId))
      .get();

    if (!currentPlayer) {
      throw new Error("玩家不存在");
    }

    const inventoryRows = await tx.select({
      itemId: playerInventory.itemId,
      quantity: playerInventory.quantity,
      equipped: playerInventory.equipped,
    }).from(playerInventory)
      .where(eq(playerInventory.playerId, playerId))
      .all();

    const itemIds = Array.from(new Set(
      inventoryRows
        .map((entry) => entry.itemId)
        .filter((itemId): itemId is string => typeof itemId === "string" && !!itemId),
    ));

    if (itemIds.length === 0) {
      return null;
    }

    const itemRows = await tx.select({
      id: items.id,
      itemType: items.itemType,
      rarity: items.rarity,
      price: items.price,
    }).from(items)
      .where(inArray(items.id, itemIds))
      .all();

    const hongmengRows = await tx.select({
      itemId: hongmengTreasureConfigs.itemId,
    }).from(hongmengTreasureConfigs)
      .where(and(
        eq(hongmengTreasureConfigs.enabled, true),
        inArray(hongmengTreasureConfigs.itemId, itemIds),
      ))
      .all();

    const itemMap = new Map(itemRows.map((entry) => [entry.id, entry]));
    const hongmengItemIdSet = new Set(hongmengRows.map((entry) => entry.itemId));
    const preview = buildQuickSellPreview(
      inventoryRows
        .map((entry) => {
          const item = itemMap.get(entry.itemId);
          if (!item) {
            return null;
          }
          return {
            itemId: entry.itemId,
            quantity: entry.quantity,
            equipped: entry.equipped,
            itemType: item.itemType,
            rarity: item.rarity,
            price: item.price,
            isHongmengTreasure: hongmengItemIdSet.has(entry.itemId),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      filters,
    );

    if (preview.entries.length === 0) {
      return null;
    }

    const soldItemIds = preview.entries.map((entry) => entry.item.itemId);

    await tx.delete(playerInventory)
      .where(and(
        eq(playerInventory.playerId, playerId),
        inArray(playerInventory.itemId, soldItemIds),
      ))
      .run();

    await tx.update(players).set({
      gold: Number(currentPlayer.gold || 0) + preview.goldGained,
      updatedAt: new Date().toISOString(),
    }).where(eq(players.id, playerId))
      .run();

    return preview;
  });

  if (!result) {
    return NextResponse.json({
      success: false,
      error: "当前筛选下无可出售物品",
    }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      soldStackCount: result.soldStackCount,
      soldItemCount: result.soldItemCount,
      goldGained: result.goldGained,
      message: `快捷出售成功，出售 ${result.soldStackCount} 种物品，共 ${result.soldItemCount} 件，获得 ${result.goldGained} 灵石`,
    },
  });
}

/** POST - 使用/装备物品 */
export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const { action, itemId, dropQuantity, equipSlot, filters } = await request.json() as InventoryActionRequest;

    if (action === "quick_sell") {
      return handleQuickSellAction(player.id, filters);
    }

    if (!itemId) {
      return NextResponse.json({ success: false, error: "缺少物品ID" }, { status: 400 });
    }

    const inv = await db.select().from(playerInventory)
      .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
      .get();
    if (!inv || inv.quantity <= 0) {
      return NextResponse.json({ success: false, error: "物品不存在" }, { status: 400 });
    }

    const item = await getItemByIdCompat(itemId);
    if (!item) return NextResponse.json({ success: false, error: "物品数据错误" }, { status: 400 });
    const safeItemName = sanitizePlayerFacingItemName(item.name, { itemType: item.itemType, rarity: item.rarity });

    // 修为丹 / 回血回蓝丹不拦境界：低境界也吃得了，只是收益按 0.8^段差 折算（见 pill-cross-realm）。
    // 破境丹（boost_breakthrough）、装备、技能书仍按境界区间拦截。
    const isRecoveryConsumable = item.itemType === "consumable"
      && ((item.effects as ItemEffect[]) || []).some((eff) => (
        eff.type === "boost_xp" || eff.type === "heal_hp" || eff.type === "heal_mp"
      ));
    // 跨境界服用折算率，修为/回血/回蓝共用
    const crossRealm = await resolvePillCrossRealmRate({
      playerRealm: Number(player.realm ?? 0),
      itemMinRealm: item.minRealm,
    });

    if (action === "use" || action === "equip" || action === "use_combat") {
      if (!isRecoveryConsumable) {
        const actionLabel = action === "equip" ? "装备" : "使用";
        const realmError = buildRealmRangeError(player.realm, item.minRealm, item.maxRealm, safeItemName, actionLabel);
        if (realmError) {
          return NextResponse.json({
            success: false,
            error: realmError,
          }, { status: 400 });
        }
      }
    }

    if (action === "use_combat") {
      if (item.itemType !== "consumable") {
        return NextResponse.json({ success: false, error: "战斗中只能使用丹药" }, { status: 400 });
      }

      // 跨境界服用：低境界吃高段丹药，回复量同样按 0.8^段差 折算
      const effects = ((item.effects as ItemEffect[]) || [])
        .filter((eff) => (eff.type === "heal_hp" || eff.type === "heal_mp") && Number(eff.value) > 0)
        .map((eff) => ({
          ...eff,
          value: Math.max(1, Math.round(Number(eff.value || 0) * crossRealm.rate)),
        }));
      if (!effects.length) {
        return NextResponse.json({ success: false, error: "战斗中仅支持恢复气血/灵力丹药" }, { status: 400 });
      }

      await consumeOneItem(player.id, itemId, inv.quantity);
      return NextResponse.json({
        success: true,
        data: { message: `使用了${safeItemName}`, itemName: safeItemName, effects },
      });
    }

    if (action === "use") {
      if (item.itemType !== "consumable" && item.itemType !== "skill_book") {
        return NextResponse.json({ success: false, error: "该物品不可使用" }, { status: 400 });
      }

      const effects = (item.effects as ItemEffect[]) || [];
      const pillToxicityStatus = await buildPlayerPillToxicityStatus(player);
      const pillToxicityGain = getXpPillToxicityGain(item, effects);
      const canPersistPillToxicity = !isPlayerPillToxicitySchemaMissing();

      if (item.itemType === "consumable") {
        const stats = await buildPlayerStatsSnapshot(player);
        const nowIso = new Date().toISOString();
        const updates: Partial<typeof players.$inferInsert> = { updatedAt: nowIso };
        let breakthroughBonusDelta = 0;
        let toxicityReduceDelta = 0;
        // 跨境界服用：低境界吃高段修为丹，收益打折（品级倍率不受影响）
        const boostXp = Math.round(effects.reduce((total, eff) => (
          eff.type === "boost_xp"
            ? total + Number(eff.value || 0)
            : total
        ), 0) * crossRealm.rate);
        const isPureXpConsumable = boostXp > 0 && effects.every((eff) => eff.type === "boost_xp");
        const newlyUnlockedAvatarNames: string[] = [];
        const alreadyUnlockedAvatarNames: string[] = [];
        const newlyUnlockedAvatarFrameNames: string[] = [];
        const alreadyUnlockedAvatarFrameNames: string[] = [];
        const temporaryUnlockedAvatarNames: string[] = [];
        const temporaryUnlockedAvatarFrameNames: string[] = [];
        const hpBefore = player.hp;
        const mpBefore = player.mp;
        const staminaSettings = await getStaminaSettings();
        const staminaMax = Number(staminaSettings.max || 100);
        const staminaBefore = Number(player.stamina || 0);
        let hpAfter = player.hp;
        let mpAfter = player.mp;
        let staminaAfter = staminaBefore;

        for (const eff of effects) {
          switch (eff.type) {
            case "heal_hp":
              hpAfter = Math.min(
                stats.total.maxHp,
                hpAfter + Math.round(Number(eff.value || 0) * crossRealm.rate),
              );
              break;
            case "heal_mp":
              mpAfter = Math.min(
                stats.total.maxMp,
                mpAfter + Math.round(Number(eff.value || 0) * crossRealm.rate),
              );
              break;
            case "heal_stamina":
              staminaAfter = Math.min(staminaMax, staminaAfter + eff.value);
              break;
            case "reduce_toxicity":
              toxicityReduceDelta += Number(eff.value || 0);
              break;
            case "boost_breakthrough":
              breakthroughBonusDelta += eff.value;
              break;
            case "unlock_avatar": {
              const avatarId = typeof eff.avatarId === "string" ? eff.avatarId.trim() : "";
              if (!avatarId || (player.gender !== "男" && player.gender !== "女")) {
                break;
              }

              const avatar = await db.select({
                id: avatarAssets.id,
                name: avatarAssets.name,
                gender: avatarAssets.gender,
                enabled: avatarAssets.enabled,
              }).from(avatarAssets)
                .where(eq(avatarAssets.id, avatarId))
                .get();

              if (!avatar || !avatar.enabled || avatar.gender !== player.gender) {
                break;
              }

              const durationDays = normalizeTemporaryDurationDays(eff.duration);
              const unlockResult = await unlockAvatarForPlayer({
                playerId: player.id,
                avatarId,
                itemId,
                durationDays,
                tx: db,
              });

              if (unlockResult.temporary) {
                temporaryUnlockedAvatarNames.push(`${avatar.name}（${unlockResult.durationDays}天）`);
                updates.avatarId = avatar.id;
              } else if (unlockResult.inserted) {
                newlyUnlockedAvatarNames.push(avatar.name);
              } else {
                alreadyUnlockedAvatarNames.push(avatar.name);
              }
              break;
            }
            case "unlock_avatar_frame": {
              const avatarFrameId = typeof eff.avatarFrameId === "string" ? eff.avatarFrameId.trim() : "";
              if (!avatarFrameId) {
                break;
              }

              const avatarFrame = await db.select({
                id: avatarFrameAssets.id,
                name: avatarFrameAssets.name,
                enabled: avatarFrameAssets.enabled,
              }).from(avatarFrameAssets)
                .where(eq(avatarFrameAssets.id, avatarFrameId))
                .get();

              if (!avatarFrame || !avatarFrame.enabled) {
                break;
              }

              const durationDays = normalizeTemporaryDurationDays(eff.duration);
              const unlockResult = await unlockAvatarFrameForPlayer({
                playerId: player.id,
                avatarFrameId,
                itemId,
                durationDays,
                tx: db,
              });

              if (unlockResult.temporary) {
                temporaryUnlockedAvatarFrameNames.push(`${avatarFrame.name}（${unlockResult.durationDays}天）`);
                updates.avatarFrameId = avatarFrame.id;
              } else if (unlockResult.inserted) {
                newlyUnlockedAvatarFrameNames.push(avatarFrame.name);
              } else {
                alreadyUnlockedAvatarFrameNames.push(avatarFrame.name);
              }
              break;
            }
          }
        }

        const xpDetail = Math.max(0, Math.floor(boostXp)) > 0
          ? await applyXpRateForPlayerDetailed({
            playerId: player.id,
            baseXp: Math.max(0, Math.floor(boostXp)),
            channel: "pill",
          })
          : null;
        const breakthroughRequiredXp = xpDetail
          ? await getBreakthroughXpByPosition(player.realmMajor || 1, player.realmMinor || 1)
          : 0;
        const xpCap = Number.isFinite(breakthroughRequiredXp)
          ? Math.max(0, Math.floor(Number(breakthroughRequiredXp)))
          : Number.POSITIVE_INFINITY;
        const xpRoom = xpDetail
          ? Math.max(0, xpCap - Number(player.cultivationXp || 0))
          : 0;
        const xpGain = xpDetail
          ? Math.max(0, Math.min(xpDetail.finalXp, xpRoom))
          : 0;

        if (isPureXpConsumable && xpDetail && xpRoom <= 0) {
          return NextResponse.json({
            success: false,
            error: "当前境界修为已满，请先突破后再服用修为丹",
          }, { status: 400 });
        }

        if (xpGain > 0 && pillToxicityGain > 0 && pillToxicityStatus.current + pillToxicityGain > pillToxicityStatus.max) {
          const nextRecoverText = pillToxicityStatus.nextRecoverInSeconds
            ? `，约 ${Math.ceil(pillToxicityStatus.nextRecoverInSeconds / 60)} 分钟后恢复 1 点`
            : "";
          return NextResponse.json({
            success: false,
            error: `当前丹毒 ${pillToxicityStatus.current}/${pillToxicityStatus.max}，已无法继续服用修为丹${nextRecoverText}`,
          }, { status: 400 });
        }

        if (hpAfter !== hpBefore) {
          updates.hp = hpAfter;
        }
        if (mpAfter !== mpBefore) {
          updates.mp = mpAfter;
        }
        if (staminaAfter !== staminaBefore) {
          updates.stamina = staminaAfter;
          updates.staminaUpdatedAt = new Date().toISOString();
        }
        if (xpGain > 0) {
          updates.cultivationXp = Number(player.cultivationXp || 0) + xpGain;
        }
        if (xpGain > 0 && pillToxicityGain > 0 && canPersistPillToxicity) {
          updates.pillToxicity = pillToxicityStatus.current + pillToxicityGain;
          // 服丹后重新开始计时，避免利用旧倒计时缩短新增丹毒的恢复时间。
          updates.pillToxicityUpdatedAt = nowIso;
        }
        if (toxicityReduceDelta > 0 && canPersistPillToxicity && pillToxicityStatus.current > 0) {
          updates.pillToxicity = Math.max(0, pillToxicityStatus.current - toxicityReduceDelta);
          updates.pillToxicityUpdatedAt = nowIso;
        }

        if (breakthroughBonusDelta > 0) {
          updates.breakthroughBonusRate = Number(player.breakthroughBonusRate || 0) + breakthroughBonusDelta;
        }

        await db.update(players).set(updates).where(eq(players.id, player.id)).run();
        await consumeOneItem(player.id, itemId, inv.quantity);

        const recoverMessages: string[] = [];
        if (hpAfter !== hpBefore) {
          recoverMessages.push(`气血 ${hpBefore} -> ${hpAfter}`);
        }
        if (mpAfter !== mpBefore) {
          recoverMessages.push(`灵力 ${mpBefore} -> ${mpAfter}`);
        }
        if (staminaAfter !== staminaBefore) {
          recoverMessages.push(`体力 ${staminaBefore} -> ${staminaAfter}`);
        }
        if (xpGain > 0) {
          recoverMessages.push(`修为 +${xpGain}`);
        }
        if (xpGain > 0 && pillToxicityGain > 0 && canPersistPillToxicity) {
          recoverMessages.push(`丹毒 +${pillToxicityGain}（${pillToxicityStatus.current + pillToxicityGain}/${pillToxicityStatus.max}）`);
        }
        if (toxicityReduceDelta > 0 && canPersistPillToxicity && pillToxicityStatus.current > 0) {
          const reducedToxicity = Math.min(toxicityReduceDelta, pillToxicityStatus.current);
          recoverMessages.push(`丹毒 -${reducedToxicity}（${pillToxicityStatus.current - reducedToxicity}/${pillToxicityStatus.max}）`);
        }
        if (xpDetail && xpDetail.finalXp > xpGain) {
          recoverMessages.push("当前修为已满，请先突破。");
        }
        if (newlyUnlockedAvatarNames.length > 0) {
          recoverMessages.push(`激活头像 ${newlyUnlockedAvatarNames.join("、")}`);
        }
        if (newlyUnlockedAvatarFrameNames.length > 0) {
          recoverMessages.push(`激活头像框 ${newlyUnlockedAvatarFrameNames.join("、")}`);
        }
        if (alreadyUnlockedAvatarNames.length > 0) {
          recoverMessages.push(`头像已激活 ${alreadyUnlockedAvatarNames.join("、")}`);
        }
        if (alreadyUnlockedAvatarFrameNames.length > 0) {
          recoverMessages.push(`头像框已激活 ${alreadyUnlockedAvatarFrameNames.join("、")}`);
        }
        if (temporaryUnlockedAvatarNames.length > 0) {
          recoverMessages.push(`激活限时头像 ${temporaryUnlockedAvatarNames.join("、")}`);
        }
        if (temporaryUnlockedAvatarFrameNames.length > 0) {
          recoverMessages.push(`激活限时头像框 ${temporaryUnlockedAvatarFrameNames.join("、")}`);
        }

        const message = recoverMessages.length > 0
          ? `使用了${safeItemName}：${recoverMessages.join("；")}`
          : `使用了${safeItemName}`;
        const nextPillToxicityStatus = xpGain > 0 && pillToxicityGain > 0 && canPersistPillToxicity
          ? await buildPlayerPillToxicityStatus({
            id: player.id,
            pillToxicity: pillToxicityStatus.current + pillToxicityGain,
            pillToxicityUpdatedAt: nowIso,
          }, new Date(nowIso))
          : pillToxicityStatus;
        return NextResponse.json({
          success: true,
          data: {
            message,
            effects,
            xpGain,
            xpBase: xpDetail?.baseXp || 0,
            xpRate: xpDetail?.rateSum || 0,
            xpBonus: xpDetail?.bonusXp || 0,
            pillToxicity: nextPillToxicityStatus,
          },
        });
      }

      const learnEffect = effects.find(
        (eff) => eff.type === "learn_skill" && typeof eff.skillId === "string" && eff.skillId.trim()
      );
      if (!learnEffect?.skillId) {
        return NextResponse.json({ success: false, error: "神通书配置错误" }, { status: 400 });
      }

      const skillId = learnEffect.skillId.trim();
      const targetSkill = await db.select({
        id: skills.id,
        name: skills.name,
        minRealm: skills.minRealm,
        maxRealm: skills.maxRealm,
      }).from(skills)
        .where(eq(skills.id, skillId))
        .get();
      if (!targetSkill) {
        return NextResponse.json({ success: false, error: "神通不存在" }, { status: 400 });
      }
      const skillRealmError = buildRealmRangeError(player.realm, targetSkill.minRealm, targetSkill.maxRealm, targetSkill.name, "参悟");
      if (skillRealmError) {
        return NextResponse.json({
          success: false,
          error: skillRealmError,
        }, { status: 400 });
      }

      const existingSkill = await db.select({ playerId: playerSkills.playerId }).from(playerSkills)
        .where(and(eq(playerSkills.playerId, player.id), eq(playerSkills.skillId, skillId)))
        .get();

      if (!existingSkill) {
        await db.insert(playerSkills).values({
          playerId: player.id,
          skillId,
          level: 1,
        }).run();
      }

      let autoEquipped = false;
      if (!existingSkill) {
        const loadout = await getPlayerSkillLoadout({
          playerId: player.id,
          realm: player.realm,
        });

        let nextSkillRotation = loadout.skillRotation;
        if (!loadout.hasStoredSkillRotation) {
          nextSkillRotation = loadout.skillRotation;
          autoEquipped = nextSkillRotation.includes(skillId);
        } else if (
          loadout.equippedLearnedSkills.length < MAX_EQUIPPED_SHENTONG_SKILLS
          && !nextSkillRotation.includes(skillId)
        ) {
          nextSkillRotation = [...nextSkillRotation, skillId];
          autoEquipped = true;
        }

        if (autoEquipped || !loadout.hasStoredSkillRotation) {
          await db.insert(playerCombatSettings).values({
            playerId: player.id,
            skillRotation: nextSkillRotation,
            updatedAt: new Date().toISOString(),
          }).onConflictDoUpdate({
            target: playerCombatSettings.playerId,
            set: {
              skillRotation: nextSkillRotation,
              updatedAt: new Date().toISOString(),
            },
          }).run();
        }
      }

      await consumeOneItem(player.id, itemId, inv.quantity);

      if (existingSkill) {
        return NextResponse.json({
          success: true,
          data: { message: `你已掌握${targetSkill.name}，神通书被消耗` },
        });
      }

      return NextResponse.json({
        success: true,
        data: { message: autoEquipped ? `参悟了${targetSkill.name}，并已自动装备` : `参悟了${targetSkill.name}` },
      });
    }

    if (action === "equip") {
      if (!isEquippableItemType(item.itemType)) {
        return NextResponse.json({ success: false, error: "该物品不可装备" }, { status: 400 });
      }

      // 卸下同类型已装备物品
      if (item.itemType === "artifact") {
        const requestedSlot = typeof equipSlot === "string" && isArtifactEquipSlot(equipSlot)
          ? equipSlot
          : null;
        const currentSlot = typeof inv.equipSlot === "string" && isArtifactEquipSlot(inv.equipSlot)
          ? inv.equipSlot
          : null;

        const equippedInventoryRows = await db.select({
          itemId: playerInventory.itemId,
          equipSlot: playerInventory.equipSlot,
        }).from(playerInventory)
          .where(and(
            eq(playerInventory.playerId, player.id),
            eq(playerInventory.equipped, true),
          ))
          .all();
        const equippedArtifactItems = await getItemsByIdsCompat(
          equippedInventoryRows.map((entry) => entry.itemId),
        );
        const artifactItemIdSet = new Set(
          equippedArtifactItems
            .filter((entry) => entry.itemType === "artifact")
            .map((entry) => entry.id),
        );
        const equippedArtifacts = equippedInventoryRows.filter((entry) => artifactItemIdSet.has(entry.itemId));

        const occupiedSlots = new Set(
          equippedArtifacts
            .filter((entry) => entry.itemId !== itemId)
            .map((entry) => entry.equipSlot)
            .filter((slot): slot is string => typeof slot === "string" && isArtifactEquipSlot(slot)),
        );

        if (requestedSlot && occupiedSlots.has(requestedSlot)) {
          return NextResponse.json({ success: false, error: "该法宝槽位已被占用" }, { status: 400 });
        }

        const targetSlot = requestedSlot
          || currentSlot
          || ARTIFACT_EQUIP_SLOTS.find((slot) => !occupiedSlots.has(slot))
          || null;

        if (!targetSlot) {
          return NextResponse.json({ success: false, error: "法宝槽已满，请先卸下法宝" }, { status: 400 });
        }

        await db.update(playerInventory).set({
          equipped: true,
          equipSlot: targetSlot,
        })
          .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
          .run();
      } else {
        const equippedInventoryRows = await db.select().from(playerInventory)
          .where(and(
            eq(playerInventory.playerId, player.id),
            eq(playerInventory.equipped, true),
          ))
          .all();
        const equippedItems = await getItemsByIdsCompat(
          equippedInventoryRows.map((entry) => entry.itemId),
        );
        const targetItemIdSet = new Set(
          equippedItems
            .filter((entry) => entry.itemType === item.itemType)
            .map((entry) => entry.id),
        );
        const equippedSameType = equippedInventoryRows.filter((entry) => targetItemIdSet.has(entry.itemId));

        for (const eq2 of equippedSameType) {
          await db.update(playerInventory).set({
            equipped: false,
            equipSlot: null,
          })
            .where(and(
              eq(playerInventory.playerId, player.id),
              eq(playerInventory.itemId, eq2.itemId),
            ))
            .run();
        }

        await db.update(playerInventory).set({
          equipped: true,
          equipSlot: null,
        })
          .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
          .run();
      }

      return NextResponse.json({ success: true, data: { message: `装备了${safeItemName}` } });
    }

    if (action === "unequip") {
      await db.update(playerInventory).set({ equipped: false, equipSlot: null })
        .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
        .run();

      return NextResponse.json({ success: true, data: { message: `卸下了${safeItemName}` } });
    }

    if (action === "drop") {
      if (inv.equipped) {
        return NextResponse.json({ success: false, error: "请先卸下后再丢弃" }, { status: 400 });
      }

      const hongmengTreasureConfig = await db.select({
        itemId: hongmengTreasureConfigs.itemId,
      }).from(hongmengTreasureConfigs)
        .where(eq(hongmengTreasureConfigs.itemId, itemId))
        .get();
      if (hongmengTreasureConfig) {
        return NextResponse.json({ success: false, error: "鸿蒙至宝无法丢弃" }, { status: 400 });
      }

      const quantity = Number(dropQuantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return NextResponse.json({ success: false, error: "丢弃数量无效" }, { status: 400 });
      }

      if (quantity > inv.quantity) {
        return NextResponse.json({ success: false, error: "丢弃数量超过持有数量" }, { status: 400 });
      }

      if (quantity === inv.quantity) {
        await db.delete(playerInventory)
          .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
          .run();
      } else {
        await db.update(playerInventory).set({ quantity: inv.quantity - quantity })
          .where(and(eq(playerInventory.playerId, player.id), eq(playerInventory.itemId, itemId)))
          .run();
      }

      return NextResponse.json({ success: true, data: { message: `丢弃了${safeItemName} x${quantity}` } });
    }

    return NextResponse.json({ success: false, error: "未知操作" }, { status: 400 });
  } catch (e) {
    console.error("Inventory action error:", e);
    return NextResponse.json({ success: false, error: "操作失败" }, { status: 500 });
  }
}
