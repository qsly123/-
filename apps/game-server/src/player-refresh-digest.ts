import {
  type ProgressRefreshScope,
  type RealtimeRepairTrigger,
} from "@immortality/shared-protocol";
import { pushStateRefresh, type StateRefreshPushResult } from "./state-refresh";

/**
 * repair 补齐后的资产 / 背包 / 进度刷新帧摘要。
 *
 * 铁律：客户端是纯渲染端，资产 / 背包 / 进度是否变化完全取决于服务端下发的刷新帧。
 * iOS 锁屏 / 切后台期间玩家连不上房间，这段时间里发生的入库变更即使当时推送过也
 * 可能丢失。因此前后台恢复类 repair 补齐状态后，服务端必须主动下发
 * 10302(inventory_refresh) / 10510(asset_refresh) / 12742(progress_refresh)，
 * 只回 ACK 等于让界面停在旧值，玩家会看到"数值没变但别人变了"的假在线现象。
 *
 * 幂等：摘要带单调递增 version。flush 成功后 pending 被清空，连续第二次 repair
 * 不会重复下发；只有发生新的入库变更（重新 record）才会再次产生刷新帧。
 */

/** 需要补齐刷新帧的 repair 触发原因。手动 repair 不占用补齐通道。 */
export const REPAIR_FLUSH_TRIGGERS: readonly RealtimeRepairTrigger[] = [
  "initial_join",
  "reconnect",
  "weak_network_timeout",
  "foreground_restore",
  "visibility_restore",
];

/** 前后台恢复专用触发原因，真机验收时按这两个 trigger 检索日志。 */
export const FOREGROUND_REPAIR_TRIGGERS: readonly RealtimeRepairTrigger[] = [
  "foreground_restore",
  "visibility_restore",
];

export interface PlayerRefreshDigestInput {
  playerId: string;
  inventory?: { changedItemIds?: readonly string[] };
  asset?: { currencies?: Record<string, number> };
  progress?: { scopes?: readonly ProgressRefreshScope[] };
}

export interface PlayerRefreshDigestSnapshot {
  playerId: string;
  version: number;
  pending: boolean;
  inventory: { changedItemIds: string[] } | null;
  asset: { currencies: Record<string, number> } | null;
  progress: { scopes: ProgressRefreshScope[] } | null;
  lastFlushedVersion: number;
  lastFlushReason: string | null;
}

interface PendingDigest {
  version: number;
  changedItemIds: string[];
  currencies: Record<string, number> | null;
  scopes: ProgressRefreshScope[];
}

const pendingDigests = new Map<string, PendingDigest>();
const lastFlushedVersions = new Map<string, number>();
const lastFlushReasons = new Map<string, string>();
let versionCursor = 0;

const digestStats = {
  recorded: 0,
  flushed: 0,
  skipped: 0,
  frames: 0,
  lastFlushAt: 0,
};

export function getPlayerRefreshDigestStats() {
  return { ...digestStats, pendingPlayers: pendingDigests.size };
}

export function resetPlayerRefreshDigests() {
  pendingDigests.clear();
  lastFlushedVersions.clear();
  lastFlushReasons.clear();
  versionCursor = 0;
  digestStats.recorded = 0;
  digestStats.flushed = 0;
  digestStats.skipped = 0;
  digestStats.frames = 0;
  digestStats.lastFlushAt = 0;
}

function normalizePlayerId(value: unknown) {
  return String(value || "").trim();
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function normalizeCurrencyMap(values: Record<string, number> | undefined) {
  const result: Record<string, number> = {};
  if (!values || typeof values !== "object") {
    return result;
  }
  for (const [key, rawValue] of Object.entries(values)) {
    const normalizedKey = String(key || "").trim();
    const numberValue = Number(rawValue);
    if (!normalizedKey || !Number.isFinite(numberValue)) {
      continue;
    }
    result[normalizedKey] = numberValue;
  }
  return result;
}

export function isRepairFlushTrigger(
  trigger: unknown,
): trigger is RealtimeRepairTrigger {
  return REPAIR_FLUSH_TRIGGERS.includes(trigger as RealtimeRepairTrigger);
}

export function isForegroundRepairTrigger(
  trigger: unknown,
): trigger is RealtimeRepairTrigger {
  return FOREGROUND_REPAIR_TRIGGERS.includes(trigger as RealtimeRepairTrigger);
}

function nextVersion() {
  versionCursor += 1;
  return versionCursor;
}

/**
 * 记录一次资产 / 背包 / 进度入库变更。
 *
 * 房间事务成功落账后调用，摘要会一直挂到玩家下一次 repair 补齐时下发，
 * 保证断连窗口里发生的变更不会丢。
 */
export function recordPlayerRefreshDigest(
  params: PlayerRefreshDigestInput,
): number | null {
  const playerId = normalizePlayerId(params.playerId);
  if (!playerId) {
    return null;
  }

  const changedItemIds = normalizeStringList(params.inventory?.changedItemIds);
  const currencies = params.asset?.currencies
    ? normalizeCurrencyMap(params.asset.currencies)
    : null;
  const scopes = params.progress?.scopes
    ? (normalizeStringList(params.progress.scopes) as ProgressRefreshScope[])
    : [];

  const current = pendingDigests.get(playerId);
  const merged: PendingDigest = {
    version: nextVersion(),
    changedItemIds: Array.from(new Set([...(current?.changedItemIds || []), ...changedItemIds])),
    currencies: currencies || current?.currencies || null,
    scopes: Array.from(new Set([...(current?.scopes || []), ...scopes])) as ProgressRefreshScope[],
  };

  pendingDigests.set(playerId, merged);
  digestStats.recorded += 1;
  return merged.version;
}

export function getPlayerRefreshDigestSnapshot(
  playerId: string,
): PlayerRefreshDigestSnapshot | null {
  const normalized = normalizePlayerId(playerId);
  if (!normalized) {
    return null;
  }

  const pending = pendingDigests.get(normalized) || null;
  return {
    playerId: normalized,
    version: pending?.version || 0,
    pending: Boolean(pending),
    inventory: pending?.changedItemIds.length
      ? { changedItemIds: [...pending.changedItemIds] }
      : (pending ? { changedItemIds: [] } : null),
    asset: pending?.currencies ? { currencies: { ...pending.currencies } } : null,
    progress: pending?.scopes.length ? { scopes: [...pending.scopes] } : null,
    lastFlushedVersion: lastFlushedVersions.get(normalized) || 0,
    lastFlushReason: lastFlushReasons.get(normalized) || null,
  };
}

/**
 * repair 补齐后下发生效的刷新帧。
 *
 * 返回 null 表示"没有需要补齐的变更"，此时房间只回 ACK 是合法的；
 * 只要返回非 null，就一定已经向该玩家的所有在线连接投递过 10302/10510/12742。
 */
export function flushPlayerRefreshDigest(params: {
  playerId: string;
  roomId?: string;
  serverTick?: number;
  trigger: RealtimeRepairTrigger;
  reason?: string;
}): StateRefreshPushResult | null {
  const playerId = normalizePlayerId(params.playerId);
  if (!playerId) {
    return null;
  }

  const pending = pendingDigests.get(playerId);
  if (!pending) {
    return null;
  }

  const lastFlushedVersion = lastFlushedVersions.get(playerId) || 0;
  if (pending.version <= lastFlushedVersion) {
    // 幂等短路：连续两次 repair 不会产生重复刷新帧。
    digestStats.skipped += 1;
    pendingDigests.delete(playerId);
    return null;
  }

  pendingDigests.delete(playerId);
  lastFlushedVersions.set(playerId, pending.version);
  const reason = `repair:${params.trigger}${params.reason ? `:${params.reason}` : ""}`;
  lastFlushReasons.set(playerId, reason);

  const result = pushStateRefresh({
    playerId,
    ...(params.roomId ? { roomId: params.roomId } : {}),
    ...(typeof params.serverTick === "number" ? { serverTick: params.serverTick } : {}),
    reason,
    inventory: pending.changedItemIds.length
      ? { changedItemIds: pending.changedItemIds }
      : undefined,
    asset: pending.currencies ? { currencies: pending.currencies } : undefined,
    progress: pending.scopes.length ? { scopes: pending.scopes } : undefined,
  });

  digestStats.flushed += 1;
  digestStats.frames += result.frameCount;
  digestStats.lastFlushAt = result.sentAt;
  return result;
}
