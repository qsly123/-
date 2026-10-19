import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";
import type { BattleMode, BattleRealtimeEnvelope } from "@/types/game";

export type BattleSceneSnapshotVersion = {
  runtimeVersion: number;
  sceneVersion: number;
  connectionSequence: number;
  tick: number;
  sequence: number;
};

function normalizeSnapshotNumber(value: number | undefined, fallback = 0) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? Math.max(0, Math.floor(nextValue)) : fallback;
}

export function resolveBattleSceneSnapshotVersion(snapshot?: BattleSceneSnapshot | null): BattleSceneSnapshotVersion {
  if (!snapshot) {
    return {
      runtimeVersion: 0,
      sceneVersion: 0,
      connectionSequence: 0,
      tick: 0,
      sequence: 0,
    };
  }

  const tick = normalizeSnapshotNumber(snapshot.tick);
  const sequence = normalizeSnapshotNumber(snapshot.sequence, tick);

  return {
    runtimeVersion: normalizeSnapshotNumber(snapshot.runtimeVersion, 0),
    sceneVersion: normalizeSnapshotNumber(snapshot.sceneVersion, 0),
    connectionSequence: normalizeSnapshotNumber(snapshot.connectionSequence, 0),
    tick,
    sequence,
  };
}

export function isOlderBattleSceneSnapshot(
  incoming: BattleSceneSnapshot,
  current: BattleSceneSnapshot | null | undefined,
) {
  const incomingVersion = resolveBattleSceneSnapshotVersion(incoming);
  const currentVersion = resolveBattleSceneSnapshotVersion(current);

  if (incomingVersion.runtimeVersion !== currentVersion.runtimeVersion) {
    return incomingVersion.runtimeVersion < currentVersion.runtimeVersion;
  }
  if (incomingVersion.sceneVersion !== currentVersion.sceneVersion) {
    return incomingVersion.sceneVersion < currentVersion.sceneVersion;
  }
  if (incomingVersion.connectionSequence !== currentVersion.connectionSequence) {
    return incomingVersion.connectionSequence < currentVersion.connectionSequence;
  }
  if (incomingVersion.tick !== currentVersion.tick) {
    return incomingVersion.tick < currentVersion.tick;
  }

  return incomingVersion.sequence < currentVersion.sequence;
}

export function buildBattleRealtimeConnectedEnvelope(params: {
  runtimeId: string;
  mode: BattleMode;
  codec?: "json" | "msgpack";
  codecFallbackReason?: string;
}): BattleRealtimeEnvelope {
  return {
    type: "connected",
    runtimeId: params.runtimeId,
    mode: params.mode,
    codec: params.codec,
    codecFallbackReason: params.codecFallbackReason,
  };
}

export function buildBattleRealtimeErrorEnvelope(params: {
  runtimeId: string;
  mode: BattleMode;
  errorCode?: string;
  message?: string;
}): BattleRealtimeEnvelope {
  return {
    type: "error",
    runtimeId: params.runtimeId,
    mode: params.mode,
    errorCode: params.errorCode,
    message: params.message,
  };
}

export function buildBattleRepairRequestPayload(params: {
  runtimeId: string;
  mode: BattleMode;
  snapshot?: BattleSceneSnapshot | null;
  lastConnectionSequence: number;
  reason?: string;
}) {
  const snapshotVersion = resolveBattleSceneSnapshotVersion(params.snapshot);
  return {
    type: "repair_request",
    reason: params.reason || "missing_connection_window",
    runtimeId: params.runtimeId,
    mode: params.mode,
    runtimeVersion: snapshotVersion.runtimeVersion,
    sceneVersion: snapshotVersion.sceneVersion,
    lastConnectionSequence: Math.max(0, Math.floor(Number(params.lastConnectionSequence || 0))),
  };
}
