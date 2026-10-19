import {
  createStateRefreshFrameGroup,
  type AnyStateRefreshEnvelope,
  type ProgressRefreshScope,
} from "@immortality/shared-protocol";

/**
 * 战斗域状态刷新帧契约。
 *
 * 战斗中的技能 / 丹药 / 逃跑 / 认输 / 移动五个动作统一走 Colyseus command。
 * command 一旦在服务端发生入库变更（典型是丹药消耗背包、结算发放奖励），
 * 必须下发对应的状态刷新帧，不允许只回 ACK。
 *
 * 本文件只负责"描述帧"，不负责投递：
 * - game-server 进程内由 `apps/game-server/src/combat-state-refresh.ts` 直接投递到房间连接。
 * - Next API 进程内由 `@/modules/combat/services/combat-state-refresh-publish` 走内部端点投递，
 *   并把同一批帧回传到 HTTP 响应体，保证客户端一定有机会刷新。
 */

export const COMBAT_STATE_REFRESH_REASON = {
  /** 战斗中使用丹药，背包库存已扣减。 */
  itemUsed: "combat_item_used",
  /** 战斗结算落账，资产 / 进度需要刷新。 */
  rewardSettled: "combat_reward_settled",
  /** 对战超时 / 断线裁定落账，资产 / 进度需要刷新。 */
  disconnectSettled: "combat_disconnect_settled",
} as const;

export type CombatStateRefreshReason =
  (typeof COMBAT_STATE_REFRESH_REASON)[keyof typeof COMBAT_STATE_REFRESH_REASON];

/** 战斗结算后会同时影响养成 / 境界 / 任务三类进度。 */
export const COMBAT_REWARD_REFRESH_SCOPES: readonly ProgressRefreshScope[] = [
  "cultivation",
  "realm",
  "quest",
];

function normalizeItemIds(itemIds: readonly (string | null | undefined)[]) {
  return Array.from(new Set(
    itemIds
      .map((itemId) => String(itemId || "").trim())
      .filter(Boolean),
  ));
}

export function buildCombatItemUsedRefreshFrames(params: {
  playerId: string;
  itemIds: readonly (string | null | undefined)[];
  reason?: CombatStateRefreshReason;
  roomId?: string;
  serverTick?: number;
}): AnyStateRefreshEnvelope[] {
  const itemIds = normalizeItemIds(params.itemIds);
  if (!String(params.playerId || "").trim() || itemIds.length === 0) {
    return [];
  }

  return createStateRefreshFrameGroup({
    playerId: params.playerId,
    roomId: params.roomId,
    serverTick: params.serverTick,
    reason: params.reason || COMBAT_STATE_REFRESH_REASON.itemUsed,
    inventory: {
      changedItemIds: itemIds,
    },
  });
}

export function buildCombatRewardRefreshFrames(params: {
  playerId: string;
  reason?: CombatStateRefreshReason;
  currencies?: Record<string, number>;
  scopes?: readonly ProgressRefreshScope[];
  roomId?: string;
  serverTick?: number;
}): AnyStateRefreshEnvelope[] {
  if (!String(params.playerId || "").trim()) {
    return [];
  }

  const scopes = normalizeItemIds(params.scopes || []) as ProgressRefreshScope[];

  return createStateRefreshFrameGroup({
    playerId: params.playerId,
    roomId: params.roomId,
    serverTick: params.serverTick,
    reason: params.reason || COMBAT_STATE_REFRESH_REASON.rewardSettled,
    asset: {
      currencies: params.currencies,
    },
    progress: {
      scopes: scopes.length > 0 ? scopes : [...COMBAT_REWARD_REFRESH_SCOPES],
    },
  });
}
