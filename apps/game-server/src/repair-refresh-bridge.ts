import type { Client } from "colyseus";
import {
  type ProgressRefreshScope,
  type RealtimeClientInput,
  type RealtimeRepairPayload,
  type RealtimeRepairTrigger,
} from "@immortality/shared-protocol";
import {
  flushPlayerRefreshDigest,
  getPlayerRefreshDigestSnapshot,
  isRepairFlushTrigger,
  recordPlayerRefreshDigest,
} from "./player-refresh-digest";

/** 加入房间时的基线刷新范围：只刷玩家真正会看的成长面。 */
const JOIN_BASELINE_PROGRESS_SCOPES: readonly ProgressRefreshScope[] = [
  "cultivation",
  "realm",
  "quest",
];

/**
 * 房间 repair 与刷新帧摘要之间的桥接层。
 *
 * 房间侧只负责解析 repair 载荷并拿到权威房间信息，是否下发刷新帧由
 * `player-refresh-digest` 统一裁决，避免三类房间各写一套幂等逻辑。
 */

export {
  recordPlayerRefreshDigest,
  getPlayerRefreshDigestSnapshot,
  isRepairFlushTrigger,
} from "./player-refresh-digest";
export type { PlayerRefreshDigestInput } from "./player-refresh-digest";

function readRepairPayload(input: RealtimeClientInput): RealtimeRepairPayload | null {
  const payload = input.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload as RealtimeRepairPayload;
}

/** 解析 repair 触发原因；无法识别时按 manual 处理，不占用补齐通道。 */
export function resolveRepairTrigger(input: RealtimeClientInput): RealtimeRepairTrigger {
  const payload = readRepairPayload(input);
  const trigger = String(payload?.trigger || "").trim();
  return isRepairFlushTrigger(trigger) ? trigger : "manual";
}

export function readRepairReason(input: RealtimeClientInput) {
  const payload = readRepairPayload(input);
  const reason = String(payload?.reason || "").trim();
  return reason || null;
}

/**
 * 加入房间时挂一条「基线摘要」。
 *
 * 玩家刚进房（含重连 / 前后台恢复后重新 join）时本地资产面板一定是从上次会话
 * 或首屏缓存带过来的旧值，这里先挂一条摘要，下一次 repair 补齐时统一下发，
 * 保证玩家看到的资产 / 背包 / 进度与服务端一致，而不是"连上了但数值是旧的"。
 */
export function seedRepairRefreshDigestForJoin(playerId: string): number | null {
  return recordPlayerRefreshDigest({
    playerId,
    inventory: {},
    asset: {},
    progress: { scopes: JOIN_BASELINE_PROGRESS_SCOPES },
  });
}

export interface RepairRefreshFlushOutcome {
  trigger: RealtimeRepairTrigger;
  reason: string | null;
  flushed: boolean;
  frameCount: number;
  delivered: number;
  matchedSessions: number;
  pendingVersion: number;
  lastFlushedVersion: number;
}

/**
 * repair 补齐后下发待补的刷新帧。
 *
 * 只有 `REPAIR_FLUSH_TRIGGERS` 里的触发原因会走补齐通道；手动 repair 不重复下发。
 * 没有待补变更时返回 `flushed: false`，此时房间回 ACK 即可，不构成"只回 ACK"。
 */
export function flushRepairRefreshForClient(params: {
  client: Client;
  input: RealtimeClientInput;
  playerId: string;
  roomId: string;
  serverTick: number;
}): RepairRefreshFlushOutcome | null {
  const trigger = resolveRepairTrigger(params.input);
  const reason = readRepairReason(params.input);
  const before = getPlayerRefreshDigestSnapshot(params.playerId);

  if (!isRepairFlushTrigger(trigger)) {
    return null;
  }

  const result = flushPlayerRefreshDigest({
    playerId: params.playerId,
    roomId: params.roomId,
    serverTick: params.serverTick,
    trigger,
    ...(reason ? { reason } : {}),
  });

  return {
    trigger,
    reason,
    flushed: Boolean(result && result.frameCount > 0),
    frameCount: result?.frameCount || 0,
    delivered: result?.delivered || 0,
    matchedSessions: result?.matchedSessions || 0,
    pendingVersion: before?.version || 0,
    lastFlushedVersion: result
      ? (before?.version || 0)
      : (before?.lastFlushedVersion || 0),
  };
}

export type { RealtimeRepairPayload, RealtimeRepairTrigger };
