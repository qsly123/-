/**
 * 装备 / 法宝模块。
 *
 * 注意：装备的基础属性（items.effects 的 boost_*）已由 player-stats 的
 * getPlayersEquipmentBonusMap 计入 equipment 层，因此这里**只输出增量部分**：
 *   1. 强化（精炼）等级带来的额外加成；
 *   2. 随机词条带来的固定值与百分比加成。
 * 若把 effects 再算一遍会造成双倍加成。
 */

import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory, players } from "@/db/schema";
import type { ItemEffect } from "@/types/game";
import type { GameEvent, GameEventType } from "./events";
import type { ProviderContext, SystemProvider } from "./provider";
import type { StatFlatBonus, StatKey, StatModifier, StatPercentBonus } from "./stat-modifiers";
import { collectEquipmentAffixBonus, getEquipmentRefineBonus } from "@/modules/character/services/equipment-stat-rules";
export { REFINE_BONUS_PER_LEVEL, MAX_REFINE_LEVEL } from "@/modules/character/services/equipment-stat-rules";

export interface EquipmentAffix {
  /** 词条键，对应 StatKey。 */
  key: string;
  /** 固定值或百分比，二选一。 */
  flat?: number;
  percent?: number;
}

export async function collectEquipmentModifiers(playerId: string): Promise<StatModifier[]> {
  const rows = await db
    .select({
      effects: items.effects,
      refineLevel: playerInventory.refineLevel,
      stageMult: playerInventory.stageMult,
      affixes: playerInventory.affixes,
    })
    .from(playerInventory)
    .innerJoin(items, eq(playerInventory.itemId, items.id))
    .innerJoin(players, eq(playerInventory.playerId, players.id))
    .where(
      and(
        eq(playerInventory.playerId, playerId),
        eq(playerInventory.equipped, true),
        or(isNull(items.minRealm), lte(items.minRealm, players.realm)),
        or(isNull(items.maxRealm), gte(items.maxRealm, players.realm)),
      ),
    )
    .all();

  const flat: StatFlatBonus = {};
  const percent: StatPercentBonus = {};

  for (const row of rows) {
    const refineBonus = getEquipmentRefineBonus((row.effects ?? []) as ItemEffect[], row.stageMult, row.refineLevel ?? 0);
    for (const [key, value] of Object.entries(refineBonus) as [StatKey, number][]) {
      flat[key] = (flat[key] ?? 0) + value;
    }

    // 词条
    const affixBonus = collectEquipmentAffixBonus(row.affixes as EquipmentAffix[] | null);
    for (const [key, value] of Object.entries(affixBonus.flat) as [StatKey, number][]) {
      flat[key] = (flat[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(affixBonus.percent) as [StatKey, number][]) {
      percent[key] = (percent[key] ?? 0) + value;
    }
  }

  const hasEffect = Object.keys(flat).length > 0 || Object.keys(percent).length > 0;
  if (!hasEffect) return [];

  return [{ layer: "equipment", flat, percent }];
}

export const equipmentProvider: SystemProvider = {
  id: "equipment",
  displayName: "装备法宝",

  async collectModifiers(ctx: ProviderContext) {
    return await collectEquipmentModifiers(ctx.playerId);
  },

  handles: ["equipChange" satisfies GameEventType],

  async onEvent(event: GameEvent) {
    // 装备变更无需在此处理，修饰层每次取数实时计算。
    void event;
  },
};
