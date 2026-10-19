/**
 * 养成系统统一框架入口。
 *
 * 使用方式：
 *   1. 启动时（或首次取数前）调用 registerBuiltinProviders() 完成模块注册；
 *   2. 属性聚合处调用 collectMergedModifiers({ playerId }) 获取全模块汇总；
 *   3. 业务侧通过 dispatchGameEvent(event) 触发跨模块事件。
 */

import { registerProvider } from "./registry";
import { spiritualRootProvider } from "./spiritual-root.provider";
import { talentProvider } from "./talent.provider";
import { realmProvider } from "./realm.provider";
import { gongfaProvider } from "./gongfa.provider";
import { fortuneProvider } from "./fortune.provider";
import { equipmentProvider } from "./equipment.provider";
import { alchemyProvider } from "./alchemy.provider";

let registered = false;

/** 幂等注册内置模块。 */
export function registerBuiltinProviders(): void {
  if (registered) return;

  for (const provider of [
    realmProvider,
    spiritualRootProvider,
    talentProvider,
    gongfaProvider,
    fortuneProvider,
    equipmentProvider,
    alchemyProvider,
  ]) {
    registerProvider(provider);
  }

  registered = true;
}

export {
  collectAllModifiers,
  collectMergedModifiers,
  dispatchGameEvent,
  getProvider,
  listProviders,
  registerProvider,
} from "./registry";
export { mapSpiritualRootPercent, toSpiritualRootModifier } from "./spiritual-root.provider";
export type { ProviderContext, SystemProvider } from "./provider";
export type { GameEvent, GameEventHandler, GameEventType } from "./events";
export {
  applyModifiers,
  mergeStatModifiers,
  SPIRITUAL_ROOT_PERCENT_KEY_MAP,
  STAT_KEYS,
  STAT_MODIFIER_LAYERS,
} from "./stat-modifiers";
export type {
  MergedModifiers,
  StatFlatBonus,
  StatKey,
  StatModifier,
  StatModifierLayer,
  StatPercentBonus,
} from "./stat-modifiers";
