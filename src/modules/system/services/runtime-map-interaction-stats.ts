type MapMoveCorrectionKind = "none" | "small" | "smooth" | "snap";

type RuntimeMapMoveAckStats = {
  total: number;
  accepted: number;
  rejected: number;
  resyncRequired: number;
  durationTotalMs: number;
  durationMaxMs: number;
  correctionDistanceTotal: number;
  smallCorrections: number;
  smoothCorrections: number;
  snapCorrections: number;
};

type RuntimeMapSilentRefreshStats = {
  total: number;
  reasons: Record<string, number>;
};

type RuntimeMapInteractionStatsStore = {
  ack: RuntimeMapMoveAckStats;
  silentRefresh: RuntimeMapSilentRefreshStats;
};

type RuntimeMapInteractionStatsGlobal = typeof globalThis & {
  __runtimeMapInteractionStats?: RuntimeMapInteractionStatsStore;
};

export type RuntimeMapMoveAckStatsSnapshot = RuntimeMapMoveAckStats & {
  acceptedRate: number;
  avgDurationMs: number;
  avgCorrectionDistance: number;
};

export type RuntimeMapSilentRefreshStatsSnapshot = {
  total: number;
  reasons: Array<{ reason: string; count: number }>;
};

export type RuntimeMapInteractionStatsSnapshot = {
  ack: RuntimeMapMoveAckStatsSnapshot;
  silentRefresh: RuntimeMapSilentRefreshStatsSnapshot;
};

function getRuntimeGlobalStore() {
  return globalThis as RuntimeMapInteractionStatsGlobal;
}

function toSafeInt(value: number | null | undefined) {
  const nextValue = Math.floor(Number(value || 0));
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function toRoundedRate(value: number) {
  return Number(value.toFixed(4));
}

function createAckStats(): RuntimeMapMoveAckStats {
  return {
    total: 0,
    accepted: 0,
    rejected: 0,
    resyncRequired: 0,
    durationTotalMs: 0,
    durationMaxMs: 0,
    correctionDistanceTotal: 0,
    smallCorrections: 0,
    smoothCorrections: 0,
    snapCorrections: 0,
  };
}

function createSilentRefreshStats(): RuntimeMapSilentRefreshStats {
  return {
    total: 0,
    reasons: {},
  };
}

function getStore() {
  const globalStore = getRuntimeGlobalStore();
  if (!globalStore.__runtimeMapInteractionStats) {
    globalStore.__runtimeMapInteractionStats = {
      ack: createAckStats(),
      silentRefresh: createSilentRefreshStats(),
    };
  }
  return globalStore.__runtimeMapInteractionStats;
}

export function recordRuntimeMapMoveAck(params: {
  accepted: boolean;
  durationMs: number;
  correctionDistance?: number;
  correctionKind?: MapMoveCorrectionKind;
  resyncRequired?: boolean;
}) {
  const store = getStore();
  const ack = store.ack;
  const durationMs = toSafeInt(params.durationMs);
  const correctionDistance = Math.max(0, Number(params.correctionDistance || 0));

  ack.total += 1;
  if (params.accepted) {
    ack.accepted += 1;
  } else {
    ack.rejected += 1;
  }
  if (params.resyncRequired) {
    ack.resyncRequired += 1;
  }
  ack.durationTotalMs += durationMs;
  ack.durationMaxMs = Math.max(ack.durationMaxMs, durationMs);
  ack.correctionDistanceTotal += correctionDistance;

  if (params.correctionKind === "small") {
    ack.smallCorrections += 1;
    return;
  }
  if (params.correctionKind === "smooth") {
    ack.smoothCorrections += 1;
    return;
  }
  if (params.correctionKind === "snap") {
    ack.snapCorrections += 1;
  }
}

export function recordRuntimeMapSilentRefresh(reason: string) {
  const store = getStore();
  const normalizedReason = String(reason || "").trim() || "unknown";
  store.silentRefresh.total += 1;
  store.silentRefresh.reasons[normalizedReason] = toSafeInt(store.silentRefresh.reasons[normalizedReason]) + 1;
}

export function collectRuntimeMapInteractionStatsSnapshot(): RuntimeMapInteractionStatsSnapshot {
  const store = getStore();
  const ack = store.ack;
  const total = toSafeInt(ack.total);
  const accepted = toSafeInt(ack.accepted);
  const rejected = toSafeInt(ack.rejected);
  const resyncRequired = toSafeInt(ack.resyncRequired);
  const durationTotalMs = toSafeInt(ack.durationTotalMs);
  const durationMaxMs = toSafeInt(ack.durationMaxMs);
  const correctionDistanceTotal = Number(ack.correctionDistanceTotal || 0);
  const smallCorrections = toSafeInt(ack.smallCorrections);
  const smoothCorrections = toSafeInt(ack.smoothCorrections);
  const snapCorrections = toSafeInt(ack.snapCorrections);

  return {
    ack: {
      total,
      accepted,
      rejected,
      resyncRequired,
      durationTotalMs,
      durationMaxMs,
      correctionDistanceTotal,
      smallCorrections,
      smoothCorrections,
      snapCorrections,
      acceptedRate: total > 0 ? toRoundedRate(accepted / total) : 0,
      avgDurationMs: total > 0 ? Math.round(durationTotalMs / total) : 0,
      avgCorrectionDistance: total > 0
        ? Number((correctionDistanceTotal / total).toFixed(2))
        : 0,
    },
    silentRefresh: {
      total: toSafeInt(store.silentRefresh.total),
      reasons: Object.entries(store.silentRefresh.reasons)
        .map(([reason, count]) => ({
          reason,
          count: toSafeInt(count),
        }))
        .sort((left, right) => right.count - left.count),
    },
  };
}
