/**
 * 模块注册表：统一装配各养成系统的属性修饰，并分发领域事件。
 */

import type { GameEvent } from "./events";
import type { ProviderContext, SystemProvider } from "./provider";
import { mergeStatModifiers, type MergedModifiers, type StatModifier } from "./stat-modifiers";

const providers = new Map<string, SystemProvider>();

export function registerProvider(provider: SystemProvider): void {
  providers.set(provider.id, provider);
}

export function listProviders(): SystemProvider[] {
  return [...providers.values()];
}

export function getProvider(id: string): SystemProvider | undefined {
  return providers.get(id);
}

/** 汇总全部模块的修饰层。单个模块抛错不影响其余模块。 */
export async function collectAllModifiers(ctx: ProviderContext): Promise<StatModifier[]> {
  const result: StatModifier[] = [];

  for (const provider of providers.values()) {
    try {
      const modifiers = await provider.collectModifiers(ctx);
      if (Array.isArray(modifiers)) result.push(...modifiers);
    } catch (error) {
      console.error(
        `[framework] 模块 ${provider.id} 采集属性修饰失败：`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return result;
}

export async function collectMergedModifiers(ctx: ProviderContext): Promise<MergedModifiers> {
  return mergeStatModifiers(await collectAllModifiers(ctx));
}

/** 把事件分发给声明关心该类型的模块。 */
export async function dispatchGameEvent(event: GameEvent): Promise<void> {
  for (const provider of providers.values()) {
    if (!provider.onEvent) continue;
    if (provider.handles && !provider.handles.includes(event.type)) continue;

    try {
      await provider.onEvent(event);
    } catch (error) {
      console.error(
        `[framework] 模块 ${provider.id} 处理事件 ${event.type} 失败：`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
