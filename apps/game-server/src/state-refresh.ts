import {
  createStateRefreshFrameGroup,
  type AnyStateRefreshEnvelope,
  type StateRefreshFrameGroupParams,
} from "@immortality/shared-protocol";
import { deliverStateRefreshFrames } from "./state-refresh-registry";

/**
 * 状态变更刷新帧推送入口。
 *
 * 铁律：资产 / 背包 / 进度只要发生入库变更，就必须调用本函数下发对应刷新帧。
 * 客户端是纯渲染端，只回 ACK 不下发刷新帧等于界面停在旧值。
 */

const pushStats = {
  pushes: 0,
  frames: 0,
  delivered: 0,
  noTarget: 0,
};

export function getStateRefreshPushStats() {
  return { ...pushStats };
}

export function resetStateRefreshPushStats() {
  pushStats.pushes = 0;
  pushStats.frames = 0;
  pushStats.delivered = 0;
  pushStats.noTarget = 0;
}

export type PushStateRefreshParams = StateRefreshFrameGroupParams;

export interface StateRefreshPushResult {
  sentFrames: AnyStateRefreshEnvelope[];
  frameCount: number;
  delivered: number;
  matchedSessions: number;
  roomIds: string[];
  sentAt: number;
}

export function buildStateRefreshFrames(
  params: PushStateRefreshParams,
): AnyStateRefreshEnvelope[] {
  return createStateRefreshFrameGroup(params);
}

export function pushStateRefresh(
  params: PushStateRefreshParams,
): StateRefreshPushResult {
  const frames = buildStateRefreshFrames(params);
  const delivery = deliverStateRefreshFrames({
    playerId: params.playerId,
    frames,
  });

  pushStats.pushes += 1;
  pushStats.frames += frames.length;
  pushStats.delivered += delivery.delivered;
  if (delivery.matchedSessions === 0) {
    pushStats.noTarget += 1;
  }

  return {
    sentFrames: frames,
    frameCount: delivery.frames,
    delivered: delivery.delivered,
    matchedSessions: delivery.matchedSessions,
    roomIds: delivery.roomIds,
    sentAt: Date.now(),
  };
}

/**
 * 房间内同步推送。房间事务成功落账后立即调用，
 * 保证"落账成功"与"客户端收到刷新帧"在同一条链路上。
 */
export function pushStateRefreshForPlayer(params: {
  playerId: string;
  roomId?: string;
  serverTick?: number;
  reason: string;
  inventory?: StateRefreshFrameGroupParams["inventory"];
  asset?: StateRefreshFrameGroupParams["asset"];
  progress?: StateRefreshFrameGroupParams["progress"];
}): StateRefreshPushResult {
  return pushStateRefresh(params);
}
