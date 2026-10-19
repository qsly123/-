import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { monsters, npcs, temporaryMonsters } from "@/db/schema";
import type { AdminEntity } from "@/modules/admin/services/admin-entities";

export type PositionManagedEntity = "npcs" | "monsters" | "temporaryMonsters";

export function isPositionManagedEntity(entity: AdminEntity): entity is PositionManagedEntity {
  return entity === "npcs" || entity === "monsters" || entity === "temporaryMonsters";
}

function normalizeMapId(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function normalizePosition(value: unknown, fieldName: "positionX" | "positionY") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} 非法`);
  }
  return Math.floor(parsed);
}

export function resolveEntityPosition(payload: Record<string, unknown>) {
  return {
    mapId: normalizeMapId(payload.mapId),
    positionX: normalizePosition(payload.positionX, "positionX"),
    positionY: normalizePosition(payload.positionY, "positionY"),
  };
}

function isSameEntitySelf(
  entity: PositionManagedEntity,
  targetEntity: PositionManagedEntity,
  targetId: string,
  selfId?: string | number,
) {
  if (selfId === undefined) {
    return false;
  }
  return entity === targetEntity && targetId === String(selfId);
}

export async function assertNpcMonsterPositionAvailable(params: {
  entity: PositionManagedEntity;
  mapId: string | null;
  positionX: number;
  positionY: number;
  selfId?: string | number;
}) {
  if (!params.mapId) {
    return;
  }

  if (params.entity === "temporaryMonsters") {
    const temporaryMonsterAtPosition = await db.select({
      id: temporaryMonsters.id,
      name: temporaryMonsters.name,
    }).from(temporaryMonsters)
      .where(and(
        eq(temporaryMonsters.mapId, params.mapId),
        eq(temporaryMonsters.positionX, params.positionX),
        eq(temporaryMonsters.positionY, params.positionY),
      ))
      .get();

    if (
      temporaryMonsterAtPosition
      && !isSameEntitySelf(params.entity, "temporaryMonsters", temporaryMonsterAtPosition.id, params.selfId)
    ) {
      throw new Error(`坐标冲突：(${params.positionX}, ${params.positionY}) 已被临时怪物“${temporaryMonsterAtPosition.name}”占用`);
    }
    return;
  }

  const [npcAtPosition, monsterAtPosition] = await Promise.all([
    db.select({
      id: npcs.id,
      name: npcs.name,
    }).from(npcs)
      .where(and(
        eq(npcs.mapId, params.mapId),
        eq(npcs.positionX, params.positionX),
        eq(npcs.positionY, params.positionY),
      ))
      .get(),
    db.select({
      id: monsters.id,
      name: monsters.name,
    }).from(monsters)
      .where(and(
        eq(monsters.mapId, params.mapId),
        eq(monsters.positionX, params.positionX),
        eq(monsters.positionY, params.positionY),
      ))
      .get(),
  ]);

  if (npcAtPosition && !isSameEntitySelf(params.entity, "npcs", npcAtPosition.id, params.selfId)) {
    throw new Error(`坐标冲突：(${params.positionX}, ${params.positionY}) 已被 NPC“${npcAtPosition.name}”占用`);
  }

  if (monsterAtPosition && !isSameEntitySelf(params.entity, "monsters", monsterAtPosition.id, params.selfId)) {
    throw new Error(`坐标冲突：(${params.positionX}, ${params.positionY}) 已被怪物“${monsterAtPosition.name}”占用`);
  }
}

export async function getCurrentEntityPosition(entity: PositionManagedEntity, rowId: string) {
  if (entity === "npcs") {
    const row = await db.select({
      mapId: npcs.mapId,
      positionX: npcs.positionX,
      positionY: npcs.positionY,
    }).from(npcs).where(eq(npcs.id, rowId)).get();
    if (!row) {
      throw new Error("记录不存在");
    }
    return row;
  }

  if (entity === "temporaryMonsters") {
    const row = await db.select({
      mapId: temporaryMonsters.mapId,
      positionX: temporaryMonsters.positionX,
      positionY: temporaryMonsters.positionY,
    }).from(temporaryMonsters).where(eq(temporaryMonsters.id, rowId)).get();
    if (!row) {
      throw new Error("记录不存在");
    }
    return row;
  }

  const row = await db.select({
    mapId: monsters.mapId,
    positionX: monsters.positionX,
    positionY: monsters.positionY,
  }).from(monsters).where(eq(monsters.id, rowId)).get();
  if (!row) {
    throw new Error("记录不存在");
  }
  return row;
}
