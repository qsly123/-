/**
 * 功能模块 Provider 契约。
 *
 * 每个养成系统实现一个 SystemProvider，独立声明自己提供的属性修饰与关心的事件，
 * 从而可以并行开发、最后由注册表统一装配。
 */

import type { GameEventType, GameEventHandler } from "./events";
import type { StatModifier } from "./stat-modifiers";

export interface ProviderContext {
  playerId: string;
}

export interface SystemProvider {
  /** 模块唯一标识，如 "spiritual-root"。 */
  id: string;
  /** 展示名，如 "灵根"。 */
  displayName: string;
  /** 该模块对角色属性的全部影响。 */
  collectModifiers(ctx: ProviderContext): Promise<StatModifier[]>;
  /** 该模块关心的事件类型，用于事件分发。 */
  handles?: readonly GameEventType[];
  /** 事件回调。 */
  onEvent?: GameEventHandler;
}
