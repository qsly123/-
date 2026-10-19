/**
 * 气运模块。
 *
 * 重要：气运的 attrEffects（属性增减）在授予时就通过 applyPlayerDeltaWithLedger
 * 直接写入玩家基础属性并按账本记账，因此**不能再作为修饰层输出**，否则会双重加成。
 * 本模块的职责是：
 *   1. 取数前确保限时气运已到期回滚（syncExpiredFortunes），避免过期效果残留；
 *   2. 为「限时机缘 / 事件型气运」预留位置（数据由 scripts/seed-fortune-expansion.ts 灌入）。
 *
 * 事件型气运（killMonster / killPlayer / selfDeath）的触发点已由战斗结算直接调用
 * applyFortuneEventEffects，因此这里不重复订阅，避免重复结算。
 */

import { syncExpiredFortunes } from "@/modules/character/services/fortune-service";
import type { GameEvent, GameEventType } from "./events";
import type { ProviderContext, SystemProvider } from "./provider";
import type { StatPercentBonus } from "./stat-modifiers";

export interface FortuneModifierInput {
  fortuneId: string;
  grade: "white" | "blue" | "purple" | "gold" | "red";
  /** 0 表示永久。 */
  durationSeconds: number;
  expiresAt: string | null;
  percent: StatPercentBonus;
}

/** 战斗类事件：事件型气运由战斗结算直接处理，此处仅声明用于观测。 */
export const FORTUNE_HANDLED_EVENTS: readonly GameEventType[] = [
  "killMonster",
  "killPlayer",
  "selfDeath",
];

export const fortuneProvider: SystemProvider = {
  id: "fortune",
  displayName: "气运",

  async collectModifiers(ctx: ProviderContext) {
    // 限时气运到期后需要回滚属性，取数前统一同步一次。
    try {
      await syncExpiredFortunes({ playerId: ctx.playerId });
    } catch (error) {
      console.error(
        "[framework] 气运到期同步失败：",
        error instanceof Error ? error.message : String(error),
      );
    }

    // attrEffects 已直接作用于基础属性，此处不再输出修饰层。
    return [];
  },

  handles: FORTUNE_HANDLED_EVENTS,

  async onEvent(event: GameEvent) {
    // 事件型气运已由战斗结算调用 applyFortuneEventEffects 处理，此处不重复结算。
    void event;
  },
};
