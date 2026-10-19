/**
 * 功法 / 神通模块。
 *
 * 功法走 `plugin_gongfa_*` 表（服务内懒建表），加成是**按层累积的绝对值**，
 * 因此输出 `flat` 层而不是 percent。
 *
 * 关键：升级功法只改 `plugin_gongfa_player_progress.level`、扣功法点，
 * **不写回基础属性**，所以此前这些加成没有任何消费方——由本 provider 输出不会重复计算。
 * 双修类功法的加成（如「双修修为提升倍率」）无法映射到战斗属性，会被自动过滤。
 *
 * 神通（skills）当前 `player_skills.level` 仍是死字段，暂无成长曲线，
 * 等神通等级真正纳入成长后再并入本层。
 */

import { getPlayerGongfaCombatBonus } from "@/modules/character/services/gongfa-service";
import type { ProviderContext, SystemProvider } from "./provider";
import type { StatFlatBonus } from "./stat-modifiers";

export const gongfaProvider: SystemProvider = {
  id: "gongfa",
  displayName: "功法神通",

  async collectModifiers(ctx: ProviderContext) {
    try {
      const flat = await getPlayerGongfaCombatBonus(ctx.playerId) as StatFlatBonus;
      if (Object.keys(flat).length === 0) {
        return [];
      }
      return [{ layer: "gongfa", flat }];
    } catch (error) {
      console.error(
        "[gongfa] 功法修饰采集失败，跳过该层：",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
};
