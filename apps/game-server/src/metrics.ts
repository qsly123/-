export interface GameServerRuntimeMetrics {
  roomsCreated: number;
  onlineConnections: number;
  peakOnlineConnections: number;
  joins: number;
  leaves: number;
  reconnectLeaves: number;
  reconnectSuccesses: number;
  reconnectFailures: number;
  reconnectSuccessRate: number;
  inputMessages: number;
  repairInputs: number;
  moveAccepted: number;
  moveRejected: number;
  moveRejectedByReason: Record<string, number>;
  realtimeRejected: number;
  realtimeRejectedByReason: Record<string, number>;
  persistFailures: number;
  persistFailuresByReason: Record<string, number>;
  socialMessages: number;
  socialRejected: number;
  socialRejectedByReason: Record<string, number>;
  interactInputs: number;
  travelInputs: number;
  sectorSnapshotsSent: number;
  sectorDeltasSent: number;
  tickSamples: number;
  tickAvgMs: number;
  tickMaxMs: number;
  websocketUpgradeRequests: number;
  websocketConnections: number;
  websocketConnectionErrors: number;
  websocketClientErrors: number;
  websocketHeartbeatTerminations: number;
  websocketHandshakeTimeouts: number;
  websocketMissingSessionAndRoom: number;
  websocketFailedReconnects: number;
  websocketRoomConnectFailures: number;
  websocketErrorByReason: Record<string, number>;
}

export interface GameServerRoomRuntimeSnapshot {
  roomId: string;
  roomKind: string;
  mapId: string;
  mapName: string;
  mapRuntimeSource: string;
  shardId: string;
  combatId: string | null;
  partyId: string | null;
  createdAt: string;
  updatedAt: string;
  disposedAt: string | null;
  clientCount: number;
  peakClientCount: number;
  entityCount: number;
  inputMessages: number;
  repairInputs: number;
  moveAccepted: number;
  moveRejected: number;
  moveRejectedByReason: Record<string, number>;
  reconnectLeaves: number;
  reconnectSuccesses: number;
  reconnectFailures: number;
  reconnectSuccessRate: number;
  realtimeRejected: number;
  realtimeRejectedByReason: Record<string, number>;
  persistFailures: number;
  persistFailuresByReason: Record<string, number>;
  socialMessages: number;
  socialRejected: number;
  socialRejectedByReason: Record<string, number>;
  interactInputs: number;
  travelInputs: number;
  sectorSnapshotsSent: number;
  sectorDeltasSent: number;
  tickSamples: number;
  tickAvgMs: number;
  tickMaxMs: number;
  status: "active" | "disposed";
}

const metrics: GameServerRuntimeMetrics = {
  roomsCreated: 0,
  onlineConnections: 0,
  peakOnlineConnections: 0,
  joins: 0,
  leaves: 0,
  reconnectLeaves: 0,
  reconnectSuccesses: 0,
  reconnectFailures: 0,
  reconnectSuccessRate: 0,
  inputMessages: 0,
  repairInputs: 0,
  moveAccepted: 0,
  moveRejected: 0,
  moveRejectedByReason: {},
  realtimeRejected: 0,
  realtimeRejectedByReason: {},
  persistFailures: 0,
  persistFailuresByReason: {},
  socialMessages: 0,
  socialRejected: 0,
  socialRejectedByReason: {},
  interactInputs: 0,
  travelInputs: 0,
  sectorSnapshotsSent: 0,
  sectorDeltasSent: 0,
  tickSamples: 0,
  tickAvgMs: 0,
  tickMaxMs: 0,
  websocketUpgradeRequests: 0,
  websocketConnections: 0,
  websocketConnectionErrors: 0,
  websocketClientErrors: 0,
  websocketHeartbeatTerminations: 0,
  websocketHandshakeTimeouts: 0,
  websocketMissingSessionAndRoom: 0,
  websocketFailedReconnects: 0,
  websocketRoomConnectFailures: 0,
  websocketErrorByReason: {},
};

let tickTotalMs = 0;
const roomRuntimeSnapshots = new Map<string, GameServerRoomRuntimeSnapshot & { tickTotalMs: number }>();

const NORMAL_WEBSOCKET_CLOSE_CODE = 1000;
const COLYSEUS_CONSENTED_LEAVE_CLOSE_CODE = 4000;

export function isReconnectCandidateCloseCode(code: unknown) {
  return typeof code === "number"
    && code !== NORMAL_WEBSOCKET_CLOSE_CODE
    && code !== COLYSEUS_CONSENTED_LEAVE_CLOSE_CODE;
}

export function incrementGameServerMetric(
  key: Exclude<
    keyof GameServerRuntimeMetrics,
    | "moveRejectedByReason"
    | "realtimeRejectedByReason"
    | "persistFailuresByReason"
    | "socialRejectedByReason"
    | "websocketErrorByReason"
    | "reconnectSuccessRate"
    | "tickAvgMs"
    | "tickMaxMs"
  >,
  amount = 1,
) {
  metrics[key] += amount;
  if (key === "reconnectLeaves" || key === "reconnectSuccesses" || key === "reconnectFailures") {
    recomputeReconnectSuccessRate();
  }
}

export function incrementGameServerTransportMetric(
  key: "websocketUpgradeRequests"
    | "websocketConnections"
    | "websocketConnectionErrors"
    | "websocketClientErrors"
    | "websocketHeartbeatTerminations"
    | "websocketHandshakeTimeouts"
    | "websocketMissingSessionAndRoom"
    | "websocketFailedReconnects"
    | "websocketRoomConnectFailures",
  amount = 1,
) {
  metrics[key] += amount;
}

function incrementRecordCounter(record: Record<string, number>, reason: string | undefined, amount = 1) {
  const normalizedReason = reason || "unknown";
  record[normalizedReason] = (record[normalizedReason] || 0) + amount;
}

export function registerGameServerRoom(params: {
  roomId: string;
  roomKind: string;
  mapId?: string;
  shardId?: string;
  combatId?: string;
  partyId?: string;
}) {
  const now = new Date().toISOString();
  roomRuntimeSnapshots.set(params.roomId, {
    roomId: params.roomId,
    roomKind: params.roomKind,
    mapId: params.mapId || "default",
    mapName: "",
    mapRuntimeSource: "",
    shardId: params.shardId || "0",
    combatId: params.combatId || null,
    partyId: params.partyId || null,
    createdAt: now,
    updatedAt: now,
    disposedAt: null,
    clientCount: 0,
    peakClientCount: 0,
    entityCount: 0,
    inputMessages: 0,
    repairInputs: 0,
    moveAccepted: 0,
    moveRejected: 0,
    moveRejectedByReason: {},
    reconnectLeaves: 0,
    reconnectSuccesses: 0,
    reconnectFailures: 0,
    reconnectSuccessRate: 0,
    realtimeRejected: 0,
    realtimeRejectedByReason: {},
    persistFailures: 0,
    persistFailuresByReason: {},
    socialMessages: 0,
    socialRejected: 0,
    socialRejectedByReason: {},
    interactInputs: 0,
    travelInputs: 0,
    sectorSnapshotsSent: 0,
    sectorDeltasSent: 0,
    tickSamples: 0,
    tickAvgMs: 0,
    tickMaxMs: 0,
    tickTotalMs: 0,
    status: "active",
  });
}

export function disposeGameServerRoom(roomId: string) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  const now = new Date().toISOString();
  snapshot.status = "disposed";
  snapshot.disposedAt = now;
  snapshot.updatedAt = now;
  roomRuntimeSnapshots.delete(roomId);
}

export function updateGameServerRoomMetadata(roomId: string, params: {
  mapId?: string;
  mapName?: string;
  mapRuntimeSource?: string;
  shardId?: string;
  combatId?: string | null;
  partyId?: string | null;
  entityCount?: number;
}) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  if (typeof params.mapId === "string") {
    snapshot.mapId = params.mapId;
  }
  if (typeof params.mapName === "string") {
    snapshot.mapName = params.mapName;
  }
  if (typeof params.mapRuntimeSource === "string") {
    snapshot.mapRuntimeSource = params.mapRuntimeSource;
  }
  if (typeof params.shardId === "string") {
    snapshot.shardId = params.shardId;
  }
  if (params.combatId !== undefined) {
    snapshot.combatId = params.combatId;
  }
  if (params.partyId !== undefined) {
    snapshot.partyId = params.partyId;
  }
  if (typeof params.entityCount === "number" && Number.isFinite(params.entityCount)) {
    snapshot.entityCount = Math.max(0, Math.trunc(params.entityCount));
  }
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerRoomJoin(roomId: string) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.clientCount += 1;
  snapshot.peakClientCount = Math.max(snapshot.peakClientCount, snapshot.clientCount);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerRoomLeave(roomId: string) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.clientCount = Math.max(0, snapshot.clientCount - 1);
  snapshot.updatedAt = new Date().toISOString();
}

export function incrementGameServerRoomMetric(
  roomId: string,
  key: "inputMessages"
    | "repairInputs"
    | "moveAccepted"
    | "moveRejected"
    | "interactInputs"
    | "travelInputs"
    | "sectorSnapshotsSent"
    | "sectorDeltasSent",
  amount = 1,
) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot[key] += amount;
  snapshot.updatedAt = new Date().toISOString();
}

function recomputeRoomReconnectSuccessRate(snapshot: GameServerRoomRuntimeSnapshot) {
  const attempts = snapshot.reconnectSuccesses + snapshot.reconnectFailures;
  snapshot.reconnectSuccessRate = attempts > 0
    ? Number((snapshot.reconnectSuccesses / attempts).toFixed(4))
    : 0;
}

export function recordGameServerRoomReconnectLeave(roomId: string) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.reconnectLeaves += 1;
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerRoomReconnectSuccess(roomId: string) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.reconnectSuccesses += 1;
  recomputeRoomReconnectSuccessRate(snapshot);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerRoomReconnectFailure(roomId: string) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.reconnectFailures += 1;
  recomputeRoomReconnectSuccessRate(snapshot);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerRoomMoveRejected(roomId: string, reason: string | undefined) {
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.moveRejected += 1;
  incrementRecordCounter(snapshot.moveRejectedByReason, reason);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordRealtimeRejected(reason: string | undefined, roomId?: string) {
  metrics.realtimeRejected += 1;
  incrementRecordCounter(metrics.realtimeRejectedByReason, reason);
  if (!roomId) {
    return;
  }
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.realtimeRejected += 1;
  incrementRecordCounter(snapshot.realtimeRejectedByReason, reason);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerRoomPersistFailure(roomId: string | undefined, reason: string | undefined) {
  metrics.persistFailures += 1;
  incrementRecordCounter(metrics.persistFailuresByReason, reason);
  if (!roomId) {
    return;
  }
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.persistFailures += 1;
  incrementRecordCounter(snapshot.persistFailuresByReason, reason);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordSocialRoomMessage(roomId: string) {
  metrics.socialMessages += 1;
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.socialMessages += 1;
  snapshot.updatedAt = new Date().toISOString();
}

export function recordSocialRoomReject(roomId: string, reason: string | undefined) {
  metrics.socialRejected += 1;
  incrementRecordCounter(metrics.socialRejectedByReason, reason);
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.socialRejected += 1;
  incrementRecordCounter(snapshot.socialRejectedByReason, reason);
  snapshot.updatedAt = new Date().toISOString();
}

export function recordGameServerTransportError(reason: string | undefined) {
  incrementRecordCounter(metrics.websocketErrorByReason, reason);
}

export function adjustOnlineConnections(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }
  metrics.onlineConnections = Math.max(0, metrics.onlineConnections + Math.trunc(delta));
  metrics.peakOnlineConnections = Math.max(metrics.peakOnlineConnections, metrics.onlineConnections);
}

export function recordSimulationTickDuration(durationMs: number, roomId?: string) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  metrics.tickSamples += 1;
  tickTotalMs += durationMs;
  metrics.tickAvgMs = Number((tickTotalMs / metrics.tickSamples).toFixed(3));
  metrics.tickMaxMs = Number(Math.max(metrics.tickMaxMs, durationMs).toFixed(3));

  if (!roomId) {
    return;
  }
  const snapshot = roomRuntimeSnapshots.get(roomId);
  if (!snapshot) {
    return;
  }
  snapshot.tickSamples += 1;
  snapshot.tickTotalMs += durationMs;
  snapshot.tickAvgMs = Number((snapshot.tickTotalMs / snapshot.tickSamples).toFixed(3));
  snapshot.tickMaxMs = Number(Math.max(snapshot.tickMaxMs, durationMs).toFixed(3));
  snapshot.updatedAt = new Date().toISOString();
}

export function recordMoveRejected(reason: string | undefined) {
  metrics.moveRejected += 1;
  incrementRecordCounter(metrics.moveRejectedByReason, reason);
}

function recomputeReconnectSuccessRate() {
  const attempts = metrics.reconnectSuccesses + metrics.reconnectFailures;
  metrics.reconnectSuccessRate = attempts > 0
    ? Number((metrics.reconnectSuccesses / attempts).toFixed(4))
    : 0;
}

export function getGameServerRuntimeMetrics(): GameServerRuntimeMetrics {
  return {
    ...metrics,
    moveRejectedByReason: {
      ...metrics.moveRejectedByReason,
    },
    realtimeRejectedByReason: {
      ...metrics.realtimeRejectedByReason,
    },
    persistFailuresByReason: {
      ...metrics.persistFailuresByReason,
    },
    socialRejectedByReason: {
      ...metrics.socialRejectedByReason,
    },
    websocketErrorByReason: {
      ...metrics.websocketErrorByReason,
    },
  };
}

export function getGameServerRoomRuntimeSnapshots(): GameServerRoomRuntimeSnapshot[] {
  return [...roomRuntimeSnapshots.values()]
    .map((snapshot) => ({
      roomId: snapshot.roomId,
      roomKind: snapshot.roomKind,
      mapId: snapshot.mapId,
      mapName: snapshot.mapName,
      mapRuntimeSource: snapshot.mapRuntimeSource,
      shardId: snapshot.shardId,
      combatId: snapshot.combatId,
      partyId: snapshot.partyId,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      disposedAt: snapshot.disposedAt,
      clientCount: snapshot.clientCount,
      peakClientCount: snapshot.peakClientCount,
      entityCount: snapshot.entityCount,
      inputMessages: snapshot.inputMessages,
      repairInputs: snapshot.repairInputs,
      moveAccepted: snapshot.moveAccepted,
      moveRejected: snapshot.moveRejected,
      moveRejectedByReason: { ...snapshot.moveRejectedByReason },
      reconnectLeaves: snapshot.reconnectLeaves,
      reconnectSuccesses: snapshot.reconnectSuccesses,
      reconnectFailures: snapshot.reconnectFailures,
      reconnectSuccessRate: snapshot.reconnectSuccessRate,
      realtimeRejected: snapshot.realtimeRejected,
      realtimeRejectedByReason: { ...snapshot.realtimeRejectedByReason },
      persistFailures: snapshot.persistFailures,
      persistFailuresByReason: { ...snapshot.persistFailuresByReason },
      socialMessages: snapshot.socialMessages,
      socialRejected: snapshot.socialRejected,
      socialRejectedByReason: { ...snapshot.socialRejectedByReason },
      interactInputs: snapshot.interactInputs,
      travelInputs: snapshot.travelInputs,
      sectorSnapshotsSent: snapshot.sectorSnapshotsSent,
      sectorDeltasSent: snapshot.sectorDeltasSent,
      tickSamples: snapshot.tickSamples,
      tickAvgMs: snapshot.tickAvgMs,
      tickMaxMs: snapshot.tickMaxMs,
      status: snapshot.status,
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
