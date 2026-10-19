import {
  type AnyStateRefreshEnvelope,
} from "@immortality/shared-protocol";

/**
 * 状态变更刷新帧投递注册表。
 *
 * 玩家可能同时在地图房、战斗房、社交房里，资产 / 背包 / 进度一旦发生入库变更，
 * 必须把对应刷新帧投递到该玩家的所有在线连接，否则客户端纯渲染端会停在旧值。
 */

export interface StateRefreshTarget {
  playerId: string;
  roomId: string;
  roomKind: string;
  sessionId: string;
  send: (type: string, message: unknown) => void;
}

const targets = new Map<string, StateRefreshTarget>();

export interface StateRefreshDeliveryResult {
  frames: number;
  delivered: number;
  roomIds: string[];
  matchedSessions: number;
}

function createTargetKey(roomId: string, sessionId: string) {
  return `${roomId}:${sessionId}`;
}

export function registerStateRefreshTarget(target: StateRefreshTarget) {
  const key = createTargetKey(target.roomId, target.sessionId);
  targets.set(key, target);
  return () => {
    if (targets.get(key) === target) {
      targets.delete(key);
    }
  };
}

export function unregisterStateRefreshTarget(roomId: string, sessionId: string) {
  targets.delete(createTargetKey(roomId, sessionId));
}

export function deliverStateRefreshFrames(params: {
  playerId: string;
  frames: readonly AnyStateRefreshEnvelope[];
}): StateRefreshDeliveryResult {
  const playerId = String(params.playerId || "").trim();
  const frames = Array.isArray(params.frames) ? params.frames : [];
  const roomIds = new Set<string>();
  let delivered = 0;
  let matchedSessions = 0;

  if (!playerId || frames.length === 0) {
    return { frames: frames.length, delivered: 0, roomIds: [], matchedSessions: 0 };
  }

  for (const target of targets.values()) {
    if (target.playerId !== playerId) {
      continue;
    }
    matchedSessions += 1;
    for (const frame of frames) {
      try {
        target.send(frame.type, frame);
        delivered += 1;
        roomIds.add(target.roomId);
      } catch (error) {
        console.error("[game-server] state refresh send failed", {
          logCategory: "game-server.state_refresh.send_failed",
          roomId: target.roomId,
          roomKind: target.roomKind,
          playerId,
          opcode: frame.opcode,
          error,
        });
      }
    }
  }

  return {
    frames: frames.length,
    delivered,
    roomIds: Array.from(roomIds),
    matchedSessions,
  };
}

export function getStateRefreshTargetCount() {
  return targets.size;
}

export function getStateRefreshTargetsByPlayer(playerId: string) {
  const normalized = String(playerId || "").trim();
  return Array.from(targets.values()).filter((target) => target.playerId === normalized);
}
