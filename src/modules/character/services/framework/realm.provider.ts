/**
 * 境界模块。
 *
 * **本层刻意不输出任何修饰**，原因有两条，改动前务必先读：
 *
 * 1. 境界的属性收益已经写进了基础属性：每次突破由 `applyBreakthroughRewardToStats`
 *    把 hp/mp/attack/defense/speed/luck 奖励落到玩家基础属性上。
 *    若这里再按境界输出一遍基准 flat，就会**双倍计算**。
 *
 * 2. 境界压制（高境界压制低境界）已经在战斗公式里生效，无需在属性层重做：
 *    `combat-mechanics.ts` 中按境界差 `realmGap × 0.04` 计算命中与伤害修正，
 *    并对总修正做 clamp（约 −0.14 ~ +0.18）。它作用于**战斗结算**而非属性面板，
 *    因此不属于本 provider 的职责。
 *
 * 结论：骨架里「按境界输出基准 flat 层」这条 TODO 不应实现，否则就是重复计算。
 * 若日后要让境界提供**额外**乘区（例如「大境界压制系数」做成一个可配置的 percent 层），
 * 必须先确认该收益没有在突破奖励里给过。
 */

import type { ProviderContext, SystemProvider } from "./provider";

export const realmProvider: SystemProvider = {
  id: "realm",
  displayName: "境界",

  async collectModifiers(_ctx: ProviderContext) {
    void _ctx;
    return [];
  },
};
