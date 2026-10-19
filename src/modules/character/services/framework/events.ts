/**
 * 养成系统领域事件契约。
 *
 * 气运的 eventEffects（击杀 / 死亡触发）、天赋的抉择、丹毒记账等都需要统一的触发点，
 * 此前这些能力要么没有触发方、要么散落在各处，这里统一收口。
 */

export const GAME_EVENT_TYPES = [
  "killMonster",
  "killPlayer",
  "selfDeath",
  "breakthrough",
  "realmUp",
  "alchemyCraft",
  "equipChange",
  "itemUse",
  "explore",
  "questComplete",
  "meditationTick",
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

export interface GameEvent<TPayload = Record<string, unknown>> {
  type: GameEventType;
  playerId: string;
  /** ISO 时间戳。 */
  at: string;
  payload?: TPayload;
}

export type GameEventHandler<TPayload = Record<string, unknown>> = (
  event: GameEvent<TPayload>,
) => Promise<void> | void;

export function createGameEvent<TPayload = Record<string, unknown>>(
  type: GameEventType,
  playerId: string,
  payload?: TPayload,
): GameEvent<TPayload> {
  return { type, playerId, at: new Date().toISOString(), payload };
}
