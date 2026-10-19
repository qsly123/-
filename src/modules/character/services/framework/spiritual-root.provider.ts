/**
 * 灵根模块。
 *
 * 职责：把 players.spiritual_root 的百分比加成输出为常驻修饰层。
 * 此前灵根只在建号时被一次性折算进基础属性，之后再不参与计算；
 * 接入修饰层后，境界提升与装备收益都会被灵根百分比放大。
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import type { SpiritualRoot } from "@/types/game";
import type { ProviderContext, SystemProvider } from "./provider";
import {
  SPIRITUAL_ROOT_PERCENT_KEY_MAP,
  type StatModifier,
  type StatPercentBonus,
} from "./stat-modifiers";

/** 灵根品阶，内在阶段用于放大百分比强度。 */
export const SPIRITUAL_ROOT_GRADES = ["黄", "玄", "地", "天"] as const;
export type SpiritualRootGrade = (typeof SPIRITUAL_ROOT_GRADES)[number];

/** 把灵根 bonuses 的字段映射成统一的百分比结构。 */
export function mapSpiritualRootPercent(root: SpiritualRoot | null | undefined): StatPercentBonus {
  const percent: StatPercentBonus = {};
  if (!root?.bonuses) return percent;

  const bonuses = root.bonuses as unknown as Record<string, unknown>;
  for (const [sourceKey, statKey] of Object.entries(SPIRITUAL_ROOT_PERCENT_KEY_MAP)) {
    const value = bonuses[sourceKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      percent[statKey] = value;
    }
  }

  return percent;
}

export function toSpiritualRootModifier(root: SpiritualRoot | null | undefined): StatModifier[] {
  if (!root) return [];

  const percent = mapSpiritualRootPercent(root);
  const elementDamageBonus = root.bonuses?.elementDamageBonus ?? 0;
  const hasEffect = Object.keys(percent).length > 0 || elementDamageBonus !== 0;
  if (!hasEffect) return [];

  return [{ layer: "spiritualRoot", percent, elementDamageBonus }];
}

export const spiritualRootProvider: SystemProvider = {
  id: "spiritual-root",
  displayName: "灵根",

  async collectModifiers(ctx: ProviderContext) {
    const rows = await db
      .select({ root: players.spiritualRoot })
      .from(players)
      .where(eq(players.id, ctx.playerId))
      .limit(1);

    return toSpiritualRootModifier(rows[0]?.root ?? null);
  },
};
