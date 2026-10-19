/**
 * 打怪修为的「跨境界」调整。
 *
 * 改动前：胜利修为 = 怪物 xpReward × 气运加成，**完全不看境界差**——
 * 越级殊死和回头割草收益一样，刷低级怪就是最优解，境界压制失去意义。
 *
 * 现在按「小境界差」算：
 *   每高 1 个小境界 +20%，每低 1 个小境界 −20%
 *   打**下一个大段**的怪直接不给修为（练气圆满在筑基初期身上刷不出东西）
 *   范围夹在 0.4 ~ 2.0
 *
 * 玩家境界（players.realm）与怪物等级（monsters.level）是同一套线性境界，可以直接相减。
 * 段位归属（练气/筑基/…）走 realm-position，带缓存。
 */

import { getRealmPosition } from "@/modules/character/services/realm-position";

/** 每差 1 个小境界的修为增减 */
export const COMBAT_XP_STEP = 0.2;
export const COMBAT_XP_MIN = 0.4;
export const COMBAT_XP_MAX = 2.0;

export type CombatXpGap = {
  /** 小境界差（怪物 − 玩家），正数=越级 */
  gap: number;
  multiplier: number;
  label: string;
  /** 打下一段的怪，修为归零 */
  blocked: boolean;
};

function labelFor(multiplier: number, blocked: boolean): string {
  if (blocked) {
    return "低段低效";
  }
  if (multiplier >= 1.6) return "越境殊死";
  if (multiplier >= 1.3) return "越境";
  if (multiplier >= 1.1) return "小越";
  if (multiplier >= 0.9) return "相当";
  if (multiplier >= 0.7) return "略低";
  return "割草";
}

export async function resolveCombatXpGap(
  playerRealm: number,
  monsterRealm: number,
): Promise<CombatXpGap> {
  const player = Number.isFinite(playerRealm) ? Math.floor(playerRealm) : 0;
  const monster = Number.isFinite(monsterRealm) ? Math.floor(monsterRealm) : 0;
  const gap = monster - player;

  const [playerPos, monsterPos] = await Promise.all([
    getRealmPosition(player),
    getRealmPosition(monster),
  ]);

  // 拿不到境界配置时不敢乱打折，按同级处理
  if (!playerPos || !monsterPos) {
    return { gap, multiplier: 1, label: "相当", blocked: false };
  }

  // 跨段向下：练气圆满打练气以下的怪、筑基打练气怪 —— 不给修为
  if (monsterPos.major < playerPos.major) {
    return { gap, multiplier: 0, label: labelFor(0, true), blocked: true };
  }

  const raw = 1 + gap * COMBAT_XP_STEP;
  const multiplier = Math.min(COMBAT_XP_MAX, Math.max(COMBAT_XP_MIN, raw));
  return { gap, multiplier, label: labelFor(multiplier, false), blocked: false };
}

/**
 * 应用境界差：在气运加成之后乘档位系数。
 * 被判定为「低段低效」时直接 0 修为（不是保底 1 点，那样等于鼓励刷低级怪）。
 */
export async function applyCombatXpGap(
  baseXp: number,
  playerRealm: number,
  monsterRealm: number,
): Promise<{ xp: number; multiplier: number; label: string; gap: number; blocked: boolean }> {
  const tier = await resolveCombatXpGap(playerRealm, monsterRealm);
  const raw = Math.max(0, Math.floor(Number(baseXp) || 0));
  if (raw <= 0 || tier.blocked) {
    return { xp: 0, multiplier: tier.multiplier, label: tier.label, gap: tier.gap, blocked: tier.blocked };
  }
  return {
    xp: Math.max(1, Math.round(raw * tier.multiplier)),
    multiplier: tier.multiplier,
    label: tier.label,
    gap: tier.gap,
    blocked: false,
  };
}
