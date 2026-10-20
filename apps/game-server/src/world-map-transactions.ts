import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import {
  type MapInteractPayload,
  type MapTravelPayload,
  type RealtimeClientInput,
  type RealtimeInputRejectReason,
} from "@immortality/shared-protocol";
import type { GameEntityState } from "./state";

type TransactionStatus = "accepted" | "rejected" | "pending";

export type MapTransactionResult = {
  accepted: boolean;
  reason?: RealtimeInputRejectReason;
  authoritativeState?: Record<string, unknown>;
  removeActorFromRoom?: boolean;
};

type CachedTransactionResult = {
  expiresAt: number;
  result: MapTransactionResult;
};

const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const PENDING_RETRY_AFTER_MS = 60_000;
const transactionResultCache = new Map<string, CachedTransactionResult>();

function assertDatabaseUrlConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未配置");
  }
}

async function loadTransactionDb() {
  assertDatabaseUrlConfigured();
  const { db, schema } = await import("../../../src/db");
  return {
    db,
    mapEdges: schema.mapEdges,
    mapOpportunitySpawns: schema.mapOpportunitySpawns,
    mapRealtimeEventLogs: schema.mapRealtimeEventLogs,
    maps: schema.maps,
    players: schema.players,
  };
}

function createIdempotencyKey(params: {
  roomId: string;
  playerId: string;
  actionId: string;
}) {
  return `${params.roomId}:${params.playerId}:${params.actionId}`;
}

function rememberTransactionResult(key: string, result: MapTransactionResult) {
  transactionResultCache.set(key, {
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    result,
  });
}

function getRememberedTransactionResult(key: string) {
  const cached = transactionResultCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    transactionResultCache.delete(key);
    return null;
  }
  return cached.result;
}

async function loadPersistedTransactionResult(idempotencyKey: string): Promise<MapTransactionResult | null> {
  const mapDb = await loadTransactionDb();
  const row = await mapDb.db.select({
    status: mapDb.mapRealtimeEventLogs.status,
    reason: mapDb.mapRealtimeEventLogs.reason,
    resultJson: mapDb.mapRealtimeEventLogs.resultJson,
  }).from(mapDb.mapRealtimeEventLogs)
    .where(eq(mapDb.mapRealtimeEventLogs.idempotencyKey, idempotencyKey))
    .get();

  if (!row) {
    return null;
  }

  if (row.status === "pending") {
    return {
      accepted: false,
      reason: "settlement_pending",
      authoritativeState: {
        alreadyProcessing: true,
      },
    };
  }

  const authoritativeState = toRecord(row.resultJson);
  return {
    accepted: row.status === "accepted",
    reason: row.status === "accepted"
      ? undefined
      : (row.reason as RealtimeInputRejectReason | undefined),
    authoritativeState: {
      ...authoritativeState,
      alreadyProcessed: true,
    },
  };
}

function cleanupTransactionResultCache() {
  const now = Date.now();
  for (const [key, cached] of transactionResultCache.entries()) {
    if (cached.expiresAt < now) {
      transactionResultCache.delete(key);
    }
  }
}

async function persistMapRealtimeEventLog(params: {
  idempotencyKey: string;
  roomId: string;
  playerId: string;
  mapId?: string | null;
  targetMapId?: string | null;
  entityId?: string | null;
  actionId: string;
  inputType: "interact" | "travel";
  status: TransactionStatus;
  reason?: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  try {
    const mapDb = await loadTransactionDb();
    await mapDb.db.update(mapDb.mapRealtimeEventLogs).set({
      status: params.status,
      reason: params.reason || null,
      resultJson: params.result,
    }).where(eq(mapDb.mapRealtimeEventLogs.idempotencyKey, params.idempotencyKey)).run();
  } catch (error) {
    console.warn("[game-server] map realtime event log degraded", {
      roomId: params.roomId,
      playerId: params.playerId,
      inputType: params.inputType,
      reason: error instanceof Error ? error.message : "event_log_update_failed",
    });
  }
}

async function startMapRealtimeEventLog(params: {
  idempotencyKey: string;
  roomId: string;
  playerId: string;
  mapId?: string | null;
  targetMapId?: string | null;
  entityId?: string | null;
  actionId: string;
  inputType: "interact" | "travel";
  payload: Record<string, unknown>;
}): Promise<MapTransactionResult | null> {
  const mapDb = await loadTransactionDb();
  const inserted = await mapDb.db.insert(mapDb.mapRealtimeEventLogs).values({
      idempotencyKey: params.idempotencyKey,
      roomId: params.roomId,
      playerId: params.playerId,
      mapId: params.mapId || null,
      targetMapId: params.targetMapId || null,
      entityId: params.entityId || null,
      actionId: params.actionId,
      inputType: params.inputType,
      status: "pending",
      reason: null,
      payloadJson: params.payload,
      resultJson: {},
      createdAt: new Date().toISOString(),
    }).onConflictDoNothing().returning({
      id: mapDb.mapRealtimeEventLogs.id,
    }).get();

  if (inserted?.id) {
    return null;
  }

  const staleBeforeIso = new Date(Date.now() - PENDING_RETRY_AFTER_MS).toISOString();
  const reclaimed = await mapDb.db.update(mapDb.mapRealtimeEventLogs).set({
    roomId: params.roomId,
    playerId: params.playerId,
    mapId: params.mapId || null,
    targetMapId: params.targetMapId || null,
    entityId: params.entityId || null,
    actionId: params.actionId,
    inputType: params.inputType,
    status: "pending",
    reason: null,
    payloadJson: params.payload,
    resultJson: {},
    createdAt: new Date().toISOString(),
  }).where(and(
    eq(mapDb.mapRealtimeEventLogs.idempotencyKey, params.idempotencyKey),
    eq(mapDb.mapRealtimeEventLogs.status, "pending"),
    lt(mapDb.mapRealtimeEventLogs.createdAt, staleBeforeIso),
  )).returning({
    id: mapDb.mapRealtimeEventLogs.id,
  }).get();
  if (reclaimed?.id) {
    console.warn("[game-server] map realtime event log reclaimed stale pending", {
      roomId: params.roomId,
      playerId: params.playerId,
      actionId: params.actionId,
      inputType: params.inputType,
    });
    return null;
  }

  return await loadPersistedTransactionResult(params.idempotencyKey);
}

function parseEntityRef(entityId: string) {
  const [kind, ...rest] = entityId.split(":");
  return {
    kind,
    id: rest.join(":"),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeTileCoordinate(value: unknown) {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function findPortalTargetOnTile(tilesData: unknown, position: { x: number; y: number }, targetMapId: string) {
  if (!Array.isArray(tilesData)) {
    return null;
  }

  for (const tile of tilesData) {
    const row = toRecord(tile);
    if (row.type !== "portal" || row.walkable === false) {
      continue;
    }
    if (normalizeTileCoordinate(row.x) !== position.x || normalizeTileCoordinate(row.y) !== position.y) {
      continue;
    }
    if (String(row.portalTargetMapId || "").trim() === targetMapId) {
      return row;
    }
    if (Array.isArray(row.portalExtraTargets)) {
      const matchedExtraTarget = row.portalExtraTargets.find((target) => (
        String(toRecord(target).mapId || "").trim() === targetMapId
      ));
      if (matchedExtraTarget) {
        return row;
      }
    }
  }

  return null;
}

function pickTargetSpawn(tilesData: unknown, fallback: { x: number; y: number }) {
  if (!Array.isArray(tilesData)) {
    return fallback;
  }
  const portal = tilesData
    .map((tile) => toRecord(tile))
    .find((tile) => tile.type === "portal" && tile.walkable !== false);
  if (!portal) {
    return fallback;
  }
  return {
    x: normalizeTileCoordinate(portal.x) ?? fallback.x,
    y: normalizeTileCoordinate(portal.y) ?? fallback.y,
  };
}

async function loadMapRow(mapId: string) {
  const mapDb = await loadTransactionDb();
  return await mapDb.db.select({
    id: mapDb.maps.id,
    name: mapDb.maps.name,
    width: mapDb.maps.width,
    height: mapDb.maps.height,
    minRealm: mapDb.maps.minRealm,
    tilesData: mapDb.maps.tilesData,
  }).from(mapDb.maps).where(eq(mapDb.maps.id, mapId)).get();
}

function createRejectedResult(reason: RealtimeInputRejectReason, authoritativeState?: Record<string, unknown>) {
  return {
    accepted: false,
    reason,
    authoritativeState,
  } satisfies MapTransactionResult;
}

function isOpportunityEntity(params: {
  entityRefKind: string;
  targetKind: string;
}) {
  return params.entityRefKind === "opportunity"
    || params.entityRefKind === "limited_opportunity"
    || params.targetKind === "opportunity"
    || params.targetKind === "limited_opportunity";
}

function isPassiveEventEntrance(kind: string) {
  return kind === "world_commission"
    || kind === "reputation_event"
    || kind === "sect_activity"
    || kind === "event_portal"
    || kind === "secret_realm"
    || kind === "portal"
    || kind === "sect_home";
}

function isBlockingEventEntity(kind: string) {
  return kind === "temporary_blocker" || kind === "sealed_area";
}

export async function executeMapInteractTransaction(params: {
  roomId: string;
  mapId: string;
  playerId: string;
  input: RealtimeClientInput<MapInteractPayload, "interact">;
  actor: GameEntityState;
  target: GameEntityState;
}): Promise<MapTransactionResult> {
  cleanupTransactionResultCache();
  const idempotencyKey = createIdempotencyKey({
    roomId: params.roomId,
    playerId: params.playerId,
    actionId: params.input.actionId,
  });
  const cached = getRememberedTransactionResult(idempotencyKey);
  if (cached) {
    return cached;
  }
  const persisted = await loadPersistedTransactionResult(idempotencyKey);
  if (persisted) {
    rememberTransactionResult(idempotencyKey, persisted);
    return persisted;
  }
  const started = await startMapRealtimeEventLog({
    idempotencyKey,
    roomId: params.roomId,
    playerId: params.playerId,
    mapId: params.mapId,
    entityId: params.target.id,
    actionId: params.input.actionId,
    inputType: "interact",
    payload: { ...params.input.payload },
  });
  if (started) {
    rememberTransactionResult(idempotencyKey, started);
    return started;
  }

  const entityRef = parseEntityRef(params.target.id);
  let result: MapTransactionResult;

  if (isBlockingEventEntity(params.target.kind) || isBlockingEventEntity(entityRef.kind)) {
    result = createRejectedResult("permission_denied", {
      x: params.actor.x,
      y: params.actor.y,
      targetId: params.target.id,
      targetKind: params.target.kind,
      blocked: true,
    });
  } else if (isPassiveEventEntrance(params.target.kind) || isPassiveEventEntrance(entityRef.kind)) {
    result = {
      accepted: true,
      authoritativeState: {
        x: params.actor.x,
        y: params.actor.y,
        entityId: params.target.id,
        entityKind: params.target.kind,
        actionRef: entityRef.id || params.target.id,
        claimed: false,
        sideEffect: "none",
      },
    };
  } else if (!isOpportunityEntity({ entityRefKind: entityRef.kind, targetKind: params.target.kind }) || !entityRef.id) {
    result = createRejectedResult("unsupported_input", {
      x: params.actor.x,
      y: params.actor.y,
      targetId: params.target.id,
      targetKind: params.target.kind,
    });
  } else {
    // 机缘的奖励与AI上下文由Next侧核心服务统一结算。
    // 房间不能提前写claimedAt，否则后续领取入口找不到未领取的spawn。
    result = {
      accepted: true,
      authoritativeState: {
        x: params.actor.x, y: params.actor.y, entityId: params.target.id,
        claimed: false, requiresOpportunityClaim: true,
      },
    };
  }

  rememberTransactionResult(idempotencyKey, result);
  await persistMapRealtimeEventLog({
    idempotencyKey,
    roomId: params.roomId,
    playerId: params.playerId,
    mapId: params.mapId,
    entityId: params.target.id,
    actionId: params.input.actionId,
    inputType: "interact",
    status: result.accepted ? "accepted" : "rejected",
    reason: result.reason,
    payload: { ...params.input.payload },
    result: result.authoritativeState || {},
  });
  return result;
}

export async function executeMapTravelTransaction(params: {
  roomId: string;
  mapId: string;
  playerId: string;
  input: RealtimeClientInput<MapTravelPayload, "travel">;
  actor: GameEntityState;
}): Promise<MapTransactionResult> {
  cleanupTransactionResultCache();
  const idempotencyKey = createIdempotencyKey({
    roomId: params.roomId,
    playerId: params.playerId,
    actionId: params.input.actionId,
  });
  const cached = getRememberedTransactionResult(idempotencyKey);
  if (cached) {
    return cached;
  }
  const persisted = await loadPersistedTransactionResult(idempotencyKey);
  if (persisted) {
    rememberTransactionResult(idempotencyKey, persisted);
    return persisted;
  }

  const targetMapId = String(params.input.payload.targetMapId || "").trim();
  const started = await startMapRealtimeEventLog({
    idempotencyKey,
    roomId: params.roomId,
    playerId: params.playerId,
    mapId: params.mapId,
    targetMapId,
    actionId: params.input.actionId,
    inputType: "travel",
    payload: { ...params.input.payload },
  });
  if (started) {
    rememberTransactionResult(idempotencyKey, started);
    return started;
  }

  const mapDb = await loadTransactionDb();
  const [player, currentMap, targetMap] = await Promise.all([
    mapDb.db.select({
      id: mapDb.players.id,
      realm: mapDb.players.realm,
      currentMapId: mapDb.players.currentMapId,
      positionX: mapDb.players.positionX,
      positionY: mapDb.players.positionY,
    }).from(mapDb.players).where(eq(mapDb.players.id, params.playerId)).get(),
    loadMapRow(params.mapId),
    loadMapRow(targetMapId),
  ]);

  let result: MapTransactionResult;
  if (!player?.id || player.currentMapId !== params.mapId) {
    result = createRejectedResult("stale_state", {
      x: params.actor.x,
      y: params.actor.y,
      mapId: params.mapId,
      currentMapId: player?.currentMapId || null,
    });
  } else if (!currentMap?.id || !targetMap?.id) {
    result = createRejectedResult("target_missing", {
      x: params.actor.x,
      y: params.actor.y,
      targetMapId,
    });
  } else if (player.realm < targetMap.minRealm) {
    result = createRejectedResult("permission_denied", {
      x: params.actor.x,
      y: params.actor.y,
      targetMapId,
      requiredRealm: targetMap.minRealm,
    });
  } else {
    const portalTarget = findPortalTargetOnTile(
      currentMap.tilesData,
      { x: params.actor.x, y: params.actor.y },
      targetMap.id,
    );
    const edge = portalTarget
      ? { id: "portal" }
      : await mapDb.db.select({ id: mapDb.mapEdges.id }).from(mapDb.mapEdges).where(or(
        and(eq(mapDb.mapEdges.mapAId, currentMap.id), eq(mapDb.mapEdges.mapBId, targetMap.id)),
        and(eq(mapDb.mapEdges.mapAId, targetMap.id), eq(mapDb.mapEdges.mapBId, currentMap.id)),
      )).get();

    if (!edge) {
      result = createRejectedResult("target_missing", {
        x: params.actor.x,
        y: params.actor.y,
        targetMapId: targetMap.id,
      });
    } else {
      const spawn = pickTargetSpawn(targetMap.tilesData, {
        x: Math.floor(targetMap.width / 2),
        y: Math.floor(targetMap.height / 2),
      });
      const nowIso = new Date().toISOString();
      await mapDb.db.update(mapDb.players).set({
        currentMapId: targetMap.id,
        positionX: spawn.x,
        positionY: spawn.y,
        updatedAt: nowIso,
      }).where(eq(mapDb.players.id, params.playerId)).run();

      result = {
        accepted: true,
        removeActorFromRoom: true,
        authoritativeState: {
          previousMapId: currentMap.id,
          mapId: targetMap.id,
          mapName: targetMap.name,
          x: spawn.x,
          y: spawn.y,
        },
      };
    }
  }

  rememberTransactionResult(idempotencyKey, result);
  await persistMapRealtimeEventLog({
    idempotencyKey,
    roomId: params.roomId,
    playerId: params.playerId,
    mapId: params.mapId,
    targetMapId,
    actionId: params.input.actionId,
    inputType: "travel",
    status: result.accepted ? "accepted" : "rejected",
    reason: result.reason,
    payload: { ...params.input.payload },
    result: result.authoritativeState || {},
  });
  return result;
}
