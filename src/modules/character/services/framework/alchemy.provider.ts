/**
 * 丹药 / 丹毒模块骨架。
 *
 * 现状：丹药为 itemType=consumable + effects；丹毒上限 20、每 8 分钟自然恢复 1 点，
 * 满毒拒服。缺丹药品级分级，也缺解毒手段（丹毒只能挂机等）。
 *
 * 内在阶段待填：
 *   1. 丹药品级（下 / 中 / 上 / 极品）映射效果倍率，由炼丹成功率决定；
 *   2. 新增 reduce_toxicity 效果类型与解毒丹道具；
 *   3. 丹毒分段惩罚（当前只有"满毒拒服"一档）。
 */

import type { GameEvent, GameEventType } from "./events";
import type { ProviderContext, SystemProvider } from "./provider";
import type { StatFlatBonus, StatPercentBonus } from "./stat-modifiers";

export const PILL_GRADES = ["下品", "中品", "上品", "极品"] as const;
export type PillGrade = (typeof PILL_GRADES)[number];

/** 丹药品级对应效果倍率。 */
export const PILL_GRADE_MULTIPLIER: Record<PillGrade, number> = {
  下品: 0.8,
  中品: 1,
  上品: 1.3,
  极品: 1.6,
};

export interface ActivePillEffect {
  itemId: string;
  grade: PillGrade;
  expiresAt: string | null;
  flat: StatFlatBonus;
  percent: StatPercentBonus;
}

export interface ToxicityState {
  /** 当前丹毒值。 */
  value: number;
  /** 上限。 */
  cap: number;
  /** 每点恢复所需秒数。 */
  recoverSecondsPerPoint: number;
}

export const alchemyProvider: SystemProvider = {
  id: "alchemy",
  displayName: "丹药丹毒",

  async collectModifiers(_ctx: ProviderContext) {
    // TODO(内在阶段)：丹药效果为即时结算（服用时写入基础属性），此处不重复输出
    void _ctx;
    return [];
  },

  handles: ["itemUse" satisfies GameEventType, "alchemyCraft" satisfies GameEventType],

  async onEvent(event: GameEvent) {
    // TODO(内在阶段)：服用丹药时累积丹毒；炼制成功时按成功率决定品级
    void event;
  },
};
