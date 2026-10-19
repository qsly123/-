import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mapRealtimeEventLogs } from "@/db/schema";

export type MapActionIdempotencyStartResult =
  | { status: "started"; idempotencyKey: string }
  | { status: "pending"; idempotencyKey: string }
  | { status: "accepted"; idempotencyKey: string; result: Record<string, unknown> }
  | { status: "rejected"; idempotencyKey: string; reason: string | null; result: Record<string, unknown> };

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createMapActionIdempotencyKey(params: {
  scope: string;
  playerId: string;
  actionId: string;
}) {
  return [
    params.scope.trim() || "map-action",
    params.playerId.trim() || "anonymous",
    params.actionId.trim() || "missing-action",
  ].join(":");
}

export async function startMapActionIdempotency(params: {
  scope: string;
  roomId: string;
  playerId: string;
  actionId: string;
  inputType: string;
  mapId?: string | null;
  targetMapId?: string | null;
  entityId?: string | null;
  payload: Record<string, unknown>;
}): Promise<MapActionIdempotencyStartResult> {
  const idempotencyKey = createMapActionIdempotencyKey({
    scope: params.scope,
    playerId: params.playerId,
    actionId: params.actionId,
  });
  const nowIso = new Date().toISOString();
  const inserted = await db.insert(mapRealtimeEventLogs).values({
    idempotencyKey,
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
    createdAt: nowIso,
  }).onConflictDoNothing().returning({
    id: mapRealtimeEventLogs.id,
  }).get();

  if (inserted?.id) {
    return { status: "started", idempotencyKey };
  }

  const existing = await db.select({
    status: mapRealtimeEventLogs.status,
    reason: mapRealtimeEventLogs.reason,
    resultJson: mapRealtimeEventLogs.resultJson,
  }).from(mapRealtimeEventLogs)
    .where(eq(mapRealtimeEventLogs.idempotencyKey, idempotencyKey))
    .get();
  if (!existing || existing.status === "pending") {
    return { status: "pending", idempotencyKey };
  }

  return {
    status: existing.status === "accepted" ? "accepted" : "rejected",
    idempotencyKey,
    reason: existing.reason || null,
    result: toRecord(existing.resultJson),
  };
}

export async function finishMapActionIdempotency(params: {
  idempotencyKey: string;
  status: "accepted" | "rejected";
  reason?: string | null;
  result: Record<string, unknown>;
}) {
  await db.update(mapRealtimeEventLogs).set({
    status: params.status,
    reason: params.reason || null,
    resultJson: params.result,
  }).where(and(
    eq(mapRealtimeEventLogs.idempotencyKey, params.idempotencyKey),
    eq(mapRealtimeEventLogs.status, "pending"),
  )).run();
}
