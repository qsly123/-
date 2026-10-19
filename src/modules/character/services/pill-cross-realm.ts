/**
 * 修为丹的跨境界服用。
 *
 * 原来的做法：境界不够直接不让吃（inventory/route.ts 的通用境界拦截）。
 * 现在的做法：**不拦**，但低境界吃高段丹药要打折——
 *     练气吃练气丹 1000 → 1000（本段，不打折）
 *     练气吃筑基丹 1500 → 1200（跨 1 段 ×0.8）
 *     练气吃结丹丹 2250 → 1440（跨 2 段 ×0.64）
 * 即每跨 1 个大段保留 80%。品级倍率（下品/上品/极品）不受影响，那是丹药本身的数值。
 *
 * 这样高级丹仍然更值钱（1200 > 1000），但不再是「买高级丹碾压境界」的最优解。
 */

import { getRealmPosition } from "@/modules/character/services/realm-position";

/** 每跨 1 个大段，修为保留比例 */
export const PILL_CROSS_REALM_KEEP = 0.8;

export type PillCrossRealmResult = {
  /** 折算后的修为 */
  value: number;
  /** 实际折算率（1 = 未打折） */
  rate: number;
  /** 跨了几个大段 */
  segments: number;
  /** 丹药所属境界名（「筑基初期」），用于提示 */
  pillRealmLabel: string | null;
};

export async function resolvePillCrossRealmRate(params: {
  playerRealm: number;
  itemMinRealm: number | null | undefined;
}): Promise<Omit<PillCrossRealmResult, "value">> {
  const itemMinRealm = Number(params.itemMinRealm);
  if (!Number.isFinite(itemMinRealm) || itemMinRealm <= 0) {
    return { rate: 1, segments: 0, pillRealmLabel: null };
  }

  const [playerPos, pillPos] = await Promise.all([
    getRealmPosition(Number(params.playerRealm) || 1),
    getRealmPosition(itemMinRealm),
  ]);
  if (!playerPos || !pillPos) {
    return { rate: 1, segments: 0, pillRealmLabel: null };
  }

  // 吃本段或更低段的丹：不打折算——低段丹的修为本来就少，再打折就没法用了
  const segments = Math.max(0, pillPos.major - playerPos.major);
  const rate = segments === 0 ? 1 : PILL_CROSS_REALM_KEEP ** segments;
  return { rate, segments, pillRealmLabel: pillPos.label };
}

/** 把丹药的修为按跨段率折算（返回整数，至少 1 点，免得白吃）。 */
export async function applyPillCrossRealm(params: {
  value: number;
  playerRealm: number;
  itemMinRealm: number | null | undefined;
}): Promise<PillCrossRealmResult> {
  const base = Math.max(0, Math.floor(Number(params.value) || 0));
  const info = await resolvePillCrossRealmRate({
    playerRealm: params.playerRealm,
    itemMinRealm: params.itemMinRealm,
  });
  if (base <= 0 || info.rate >= 1) {
    return { value: base, ...info };
  }
  return { value: Math.max(1, Math.round(base * info.rate)), ...info };
}
