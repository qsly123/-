/**
 * 天赋 / 流派模块。
 *
 * 输出**随大境界分段的百分比层**（阶段曲线），而非恒定加成，
 * 以此实现「流派强势期轮换」（见 `docs/current/benchmark-gbsh-ynxy.md`）。
 *
 * 只输出 percent 层，不写回基础属性，也不重复装备/灵根/气运已有的加成。
 */

import { getPlayerTalentPercent } from "@/modules/character/services/talent-service";
import type { ProviderContext, SystemProvider } from "./provider";
import type { StatPercentBonus } from "./stat-modifiers";

export const talentProvider: SystemProvider = {
  id: "talent",
  displayName: "天赋流派",

  async collectModifiers(ctx: ProviderContext) {
    try {
      const percent: StatPercentBonus = await getPlayerTalentPercent(ctx.playerId);
      if (Object.keys(percent).length === 0) {
        return [];
      }
      return [{ layer: "talent", percent }];
    } catch (error) {
      console.error(
        "[talent] 流派修饰采集失败，跳过该层：",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
};
