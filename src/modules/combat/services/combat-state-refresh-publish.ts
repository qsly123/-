import type {
  AnyStateRefreshEnvelope,
  ProgressRefreshScope,
} from "@immortality/shared-protocol";
import { pushStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import {
  COMBAT_REWARD_REFRESH_SCOPES,
  COMBAT_STATE_REFRESH_REASON,
  type CombatStateRefreshReason,
} from "@/modules/combat/services/combat-state-refresh-contract";

/**
 * Next 进程内的战斗状态刷新帧投递。
 *
 * Next API 事务（例如 HTTP action fallback、Boss 核心事务）一旦发生入库变更：
 * 1. 尝试把刷新帧投递给 game-server，由其下发到该玩家全部在线连接；
 * 2. 无论投递是否成功，都把同一批帧回传到 HTTP 响应体，客户端消费后必定刷新。
 *
 * 只回 ACK 不带帧组是明确禁止的。
 */

export interface PublishCombatRefreshFramesParams {
  playerId: string;
  /** 本次事务真实消耗掉的丹药。被拒绝的事务不得传入，避免客户端误扣。 */
  consumedItemIds?: readonly string[];
  /** 本次事务是否产生了战斗结算。 */
  settled?: boolean;
  rewardReason?: CombatStateRefreshReason;
  currencies?: Record<string, number>;
  scopes?: readonly ProgressRefreshScope[];
  roomId?: string;
  serverTick?: number;
}

export async function publishCombatRefreshFrames(
  params: PublishCombatRefreshFramesParams,
): Promise<AnyStateRefreshEnvelope[]> {
  const playerId = String(params.playerId || "").trim();
  const itemIds = Array.from(new Set(
    (params.consumedItemIds || [])
      .map((itemId) => String(itemId || "").trim())
      .filter(Boolean),
  ));
  if (!playerId || (!itemIds.length && params.settled !== true)) {
    return [];
  }

  const frames: AnyStateRefreshEnvelope[] = [];

  if (itemIds.length > 0) {
    const inventoryOutcome = await pushStateRefreshFrames({
      playerId,
      roomId: params.roomId,
      serverTick: params.serverTick,
      reason: COMBAT_STATE_REFRESH_REASON.itemUsed,
      inventory: {
        changedItemIds: itemIds,
        full: true,
      },
    });
    frames.push(...inventoryOutcome.frames);
  }

  if (params.settled === true) {
    const scopes = (params.scopes && params.scopes.length > 0
      ? params.scopes
      : COMBAT_REWARD_REFRESH_SCOPES) as ProgressRefreshScope[];
    const rewardOutcome = await pushStateRefreshFrames({
      playerId,
      roomId: params.roomId,
      serverTick: params.serverTick,
      reason: params.rewardReason || COMBAT_STATE_REFRESH_REASON.rewardSettled,
      asset: {
        currencies: params.currencies,
        full: true,
      },
      progress: {
        scopes,
        full: true,
      },
    });
    frames.push(...rewardOutcome.frames);
  }

  return frames;
}
