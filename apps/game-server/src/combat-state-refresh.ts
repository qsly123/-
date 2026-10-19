import type { ProgressRefreshScope } from "@immortality/shared-protocol";
import {
  buildCombatItemUsedRefreshFrames,
  buildCombatRewardRefreshFrames,
  COMBAT_STATE_REFRESH_REASON,
  type CombatStateRefreshReason,
} from "../../../src/modules/combat/services/combat-state-refresh-contract";
import { deliverStateRefreshFrames } from "./state-refresh-registry";

/**
 * 战斗域状态刷新帧投递。
 *
 * 战斗 command 主链（技能 / 丹药 / 逃跑 / 认输 / 移动）在房间内完成事务后，
 * 只要发生了入库变更，就必须调用这里下发对应刷新帧。
 * 客户端是纯渲染端，只回 ACK 不下发刷新帧等于界面停在旧值。
 */

export interface CombatStateRefreshPushResult {
  frameCount: number;
  delivered: number;
  matchedSessions: number;
  roomIds: string[];
}

function deliver(frames: ReturnType<typeof buildCombatItemUsedRefreshFrames>, playerId: string): CombatStateRefreshPushResult {
  const delivery = deliverStateRefreshFrames({ playerId, frames });
  return {
    frameCount: delivery.frames,
    delivered: delivery.delivered,
    matchedSessions: delivery.matchedSessions,
    roomIds: delivery.roomIds,
  };
}

/** 丹药 command 成功扣减库存后下发 inventory_refresh(10302)。 */
export function pushCombatInventoryRefresh(params: {
  playerId: string;
  itemIds: readonly (string | null | undefined)[];
  roomId?: string;
  serverTick?: number;
  reason?: CombatStateRefreshReason;
}): CombatStateRefreshPushResult {
  const frames = buildCombatItemUsedRefreshFrames(params);
  if (frames.length === 0) {
    return { frameCount: 0, delivered: 0, matchedSessions: 0, roomIds: [] };
  }
  return deliver(frames, String(params.playerId || "").trim());
}

/** 战斗结算 / 离场结算落账后下发 asset_refresh(10510) 与 progress_refresh(12742)。 */
export function pushCombatRewardRefresh(params: {
  playerId: string;
  reason?: CombatStateRefreshReason;
  currencies?: Record<string, number>;
  scopes?: readonly ProgressRefreshScope[];
  roomId?: string;
  serverTick?: number;
}): CombatStateRefreshPushResult {
  const frames = buildCombatRewardRefreshFrames(params);
  if (frames.length === 0) {
    return { frameCount: 0, delivered: 0, matchedSessions: 0, roomIds: [] };
  }
  return deliver(frames, String(params.playerId || "").trim());
}

export { COMBAT_STATE_REFRESH_REASON };
export type { CombatStateRefreshReason };
