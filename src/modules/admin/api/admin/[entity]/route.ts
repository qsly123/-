import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { mapEdges, sectBuildings, sectRolePermissions, sessions } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { canAccessAdminEntity } from "@/modules/admin/services/admin-entity-access";
import {
  getItemByIdCompat,
  getPlayerByIdCompat,
  isMissingItemPillToxicityColumnError,
  isMissingPillToxicityConfigTableError,
  isMissingPlayerPillToxicityColumnError,
} from "@/modules/character/services/pill-toxicity-schema-compat";
import { resolveEntity } from "./entity-configs";
import { normalizeEntityPayload } from "./entity-normalize";
import { validateEntityPayload } from "./entity-validators";
import {
  assertNpcMonsterPositionAvailable,
  getCurrentEntityPosition,
  isPositionManagedEntity,
  resolveEntityPosition,
} from "./entity-position";
import {
  deleteAccountsWithRelations,
  deleteCdkCodesWithRelations,
  deleteMapsWithRelations,
  deleteNpcsWithRelations,
  deletePlayersWithRelations,
  deleteTemporaryMapsWithRelations,
  deleteTemporaryMonstersWithRelations,
  formatDeleteError,
} from "./entity-deletion";
import {
  normalizeRowId,
  normalizeRowIds,
} from "./route-helpers";
import { queryEntityList } from "./entity-list";
import { publishMapStructureChanged } from "@/modules/map/services/map-structure-invalidation";

const DEFAULT_PAGE = 1;

function parseSectBuildingRowId(rowId: string | number) {
  const [sectId, buildingType] = String(rowId).split(":");
  if (!sectId || !buildingType) {
    throw new Error("宗门建筑 id 非法");
  }
  return {
    sectId,
    buildingType,
  };
}

function parseSectRolePermissionRowId(rowId: string | number) {
  const [sectId, roleKey, permissionKey] = String(rowId).split(":");
  if (!sectId || !roleKey || !permissionKey) {
    throw new Error("宗门权限 id 非法");
  }
  return {
    sectId,
    roleKey,
    permissionKey,
  };
}

function stripLegacyUnsupportedFields(entity: string, payload: Record<string, unknown>) {
  const nextPayload = { ...payload };
  if (entity === "players") {
    delete nextPayload.pillToxicity;
    delete nextPayload.pillToxicityUpdatedAt;
  }
  if (entity === "items" || entity === "aiItems") {
    delete nextPayload.pillToxicity;
  }
  return nextPayload;
}

function isMapStructureEntity(entity: string) {
  return entity === "maps" || entity === "temporaryMaps" || entity === "mapEdges";
}

function collectMapIdsFromMapStructurePayload(entity: string, payload: Record<string, unknown>, rowId?: string | number) {
  if (entity === "maps" || entity === "temporaryMaps") {
    return [String(rowId ?? payload.id ?? "").trim()].filter(Boolean);
  }
  if (entity === "mapEdges") {
    return [
      String(payload.mapAId || "").trim(),
      String(payload.mapBId || "").trim(),
    ].filter(Boolean);
  }
  return [];
}

async function collectExistingMapStructureIds(entity: string, rowIds: Array<string | number>) {
  if (entity === "maps" || entity === "temporaryMaps") {
    const directIds = rowIds.map((id) => String(id || "").trim()).filter(Boolean);
    if (entity !== "maps" || directIds.length === 0) {
      return directIds;
    }

    const edgeRows = await db.select({
      mapAId: mapEdges.mapAId,
      mapBId: mapEdges.mapBId,
    }).from(mapEdges).where(or(
      inArray(mapEdges.mapAId, directIds),
      inArray(mapEdges.mapBId, directIds),
    )).all();
    return [
      ...directIds,
      ...edgeRows.flatMap((row) => [row.mapAId, row.mapBId]),
    ];
  }

  if (entity !== "mapEdges") {
    return [];
  }

  const edgeIds = rowIds
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id));
  if (edgeIds.length === 0) {
    return [];
  }

  const rows = await db.select({
    mapAId: mapEdges.mapAId,
    mapBId: mapEdges.mapBId,
  }).from(mapEdges).where(inArray(mapEdges.id, edgeIds)).all();
  return rows.flatMap((row) => [row.mapAId, row.mapBId]);
}

function publishAdminMapStructureChanged(entity: string, mapIds: Array<string | null | undefined>, source: string) {
  if (!isMapStructureEntity(entity)) {
    return;
  }
  publishMapStructureChanged({
    mapIds,
    source,
  });
}

async function insertEntityWithCompat(entity: string, table: unknown, payload: Record<string, unknown>) {
  try {
    await db.insert(table as never).values(payload as never).run();
  } catch (error) {
    if (entity === "players" && isMissingPlayerPillToxicityColumnError(error)) {
      await db.insert(table as never).values(stripLegacyUnsupportedFields(entity, payload) as never).run();
      return;
    }
    if ((entity === "items" || entity === "aiItems") && isMissingItemPillToxicityColumnError(error)) {
      await db.insert(table as never).values(stripLegacyUnsupportedFields(entity, payload) as never).run();
      return;
    }
    if (entity === "pillToxicityConfigs" && isMissingPillToxicityConfigTableError(error)) {
      throw new Error("当前数据库未完成丹毒迁移，暂不可编辑丹毒配置");
    }
    throw error;
  }
}

async function updateEntityWithCompat(entity: string, table: unknown, idColumn: unknown, normalizedId: string | number, payload: Record<string, unknown>) {
  if (entity === "sectBuildings") {
    const parsed = parseSectBuildingRowId(normalizedId);
    await db.update(sectBuildings)
      .set(payload)
      .where(and(
        eq(sectBuildings.sectId, parsed.sectId),
        eq(sectBuildings.buildingType, parsed.buildingType as never),
      ))
      .run();
    return;
  }
  if (entity === "sectRolePermissions") {
    const parsed = parseSectRolePermissionRowId(normalizedId);
    await db.update(sectRolePermissions)
      .set(payload)
      .where(and(
        eq(sectRolePermissions.sectId, parsed.sectId),
        eq(sectRolePermissions.roleKey, parsed.roleKey as never),
        eq(sectRolePermissions.permissionKey, parsed.permissionKey as never),
      ))
      .run();
    return;
  }
  try {
    await db.update(table as never)
      .set(payload as never)
      .where(eq(idColumn as never, normalizedId as never))
      .run();
  } catch (error) {
    if (entity === "players" && isMissingPlayerPillToxicityColumnError(error)) {
      await db.update(table as never)
        .set(stripLegacyUnsupportedFields(entity, payload) as never)
        .where(eq(idColumn as never, normalizedId as never))
        .run();
      return;
    }
    if ((entity === "items" || entity === "aiItems") && isMissingItemPillToxicityColumnError(error)) {
      await db.update(table as never)
        .set(stripLegacyUnsupportedFields(entity, payload) as never)
        .where(eq(idColumn as never, normalizedId as never))
        .run();
      return;
    }
    if (entity === "pillToxicityConfigs" && isMissingPillToxicityConfigTableError(error)) {
      throw new Error("当前数据库未完成丹毒迁移，暂不可编辑丹毒配置");
    }
    throw error;
  }
}

async function getEntityRowWithCompat(entity: string, table: unknown, idColumn: unknown, normalizedId: string | number) {
  if (entity === "players") {
    return await getPlayerByIdCompat(String(normalizedId));
  }
  if (entity === "items" || entity === "aiItems") {
    return await getItemByIdCompat(String(normalizedId));
  }
  if (entity === "sectBuildings") {
    const parsed = parseSectBuildingRowId(normalizedId);
    return await db.select().from(sectBuildings)
      .where(and(
        eq(sectBuildings.sectId, parsed.sectId),
        eq(sectBuildings.buildingType, parsed.buildingType as never),
      ))
      .get();
  }
  if (entity === "sectRolePermissions") {
    const parsed = parseSectRolePermissionRowId(normalizedId);
    return await db.select().from(sectRolePermissions)
      .where(and(
        eq(sectRolePermissions.sectId, parsed.sectId),
        eq(sectRolePermissions.roleKey, parsed.roleKey as never),
        eq(sectRolePermissions.permissionKey, parsed.permissionKey as never),
      ))
      .get();
  }
  try {
    return await db.select().from(table as never)
      .where(eq(idColumn as never, normalizedId as never))
      .get();
  } catch (error) {
    if (entity === "pillToxicityConfigs" && isMissingPillToxicityConfigTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function resolveAccessibleEntity(rawEntity: string) {
  const resolved = resolveEntity(rawEntity);
  if (!resolved) {
    return {
      resolved: null,
      response: NextResponse.json({ success: false, error: "不支持的管理实体" }, { status: 404 }),
    };
  }

  const access = await canAccessAdminEntity(resolved.entity);
  if (!access) {
    return {
      resolved: null,
      response: NextResponse.json({ success: false, error: "实体未启用" }, { status: 404 }),
    };
  }

  return {
    resolved,
    response: null as NextResponse | null,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { entity: rawEntity } = await params;
  const access = await resolveAccessibleEntity(rawEntity);
  if (!access.resolved) {
    return access.response || NextResponse.json({ success: false, error: "不支持的管理实体" }, { status: 404 });
  }
  const resolved = access.resolved;

  const url = new URL(request.url);
  const result = await queryEntityList(resolved.config, url.searchParams, DEFAULT_PAGE);

  return NextResponse.json({
    success: true,
    data: result,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { entity: rawEntity } = await params;
  const access = await resolveAccessibleEntity(rawEntity);
  if (!access.resolved) {
    return access.response || NextResponse.json({ success: false, error: "不支持的管理实体" }, { status: 404 });
  }
  const resolved = access.resolved;

  if (resolved.config.readOnlyCreate) {
    return NextResponse.json({ success: false, error: "该实体不支持新增" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const payload = normalizeEntityPayload(resolved.entity, body, true);
    await validateEntityPayload(resolved.entity, payload, true);

    if (isPositionManagedEntity(resolved.entity)) {
      const position = resolveEntityPosition(payload);
      await assertNpcMonsterPositionAvailable({
        entity: resolved.entity,
        mapId: position.mapId,
        positionX: position.positionX,
        positionY: position.positionY,
      });
    }

    if (resolved.entity === "systemConfigs") {
      await db.insert(resolved.config.table)
        .values(payload as never)
        .onConflictDoUpdate({
          target: resolved.config.idColumn as never,
          set: payload as never,
        })
        .run();
    } else {
      await insertEntityWithCompat(resolved.entity, resolved.config.table, payload);
    }
    publishAdminMapStructureChanged(
      resolved.entity,
      collectMapIdsFromMapStructurePayload(resolved.entity, payload),
      "admin-entity-create",
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "新增失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { entity: rawEntity } = await params;
  const access = await resolveAccessibleEntity(rawEntity);
  if (!access.resolved) {
    return access.response || NextResponse.json({ success: false, error: "不支持的管理实体" }, { status: 404 });
  }
  const resolved = access.resolved;

  try {
    const body = await request.json();
    const rowId = body.id;
    if (rowId === undefined || rowId === null || rowId === "") {
      return NextResponse.json({ success: false, error: "缺少 id" }, { status: 400 });
    }

    const normalizedId = normalizeRowId(resolved.entity, rowId);
    const payload = normalizeEntityPayload(resolved.entity, body, false);
    delete payload.id;
    await validateEntityPayload(resolved.entity, payload, false, normalizedId);

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ success: false, error: "没有可更新字段" }, { status: 400 });
    }

    if (isPositionManagedEntity(resolved.entity)) {
      const currentPosition = await getCurrentEntityPosition(resolved.entity, String(normalizedId));
      const position = resolveEntityPosition({
        mapId: payload.mapId === undefined ? currentPosition.mapId : payload.mapId,
        positionX: payload.positionX === undefined ? currentPosition.positionX : payload.positionX,
        positionY: payload.positionY === undefined ? currentPosition.positionY : payload.positionY,
      });
      await assertNpcMonsterPositionAvailable({
        entity: resolved.entity,
        mapId: position.mapId,
        positionX: position.positionX,
        positionY: position.positionY,
        selfId: normalizedId,
      });
    }

    const shouldForceLogout = resolved.entity === "accounts" && typeof payload.passwordHash === "string";
    const mapStructureBeforeIds = isMapStructureEntity(resolved.entity)
      ? await collectExistingMapStructureIds(resolved.entity, [normalizedId])
      : [];

    if (shouldForceLogout) {
      await db.transaction(async (tx) => {
        await tx.update(resolved.config.table)
          .set(payload as never)
          .where(eq(resolved.config.idColumn as never, normalizedId as never))
          .run();
        await tx.delete(sessions).where(eq(sessions.accountId, String(normalizedId))).run();
      });
    } else {
      await updateEntityWithCompat(resolved.entity, resolved.config.table, resolved.config.idColumn, normalizedId, payload);
    }

    const row = await getEntityRowWithCompat(resolved.entity, resolved.config.table, resolved.config.idColumn, normalizedId);

    if (!row) {
      return NextResponse.json({ success: false, error: "记录不存在" }, { status: 404 });
    }

    const safeRow = resolved.config.sanitizeOne
      ? resolved.config.sanitizeOne(row as Record<string, unknown>)
      : row;

    publishAdminMapStructureChanged(
      resolved.entity,
      [
        ...mapStructureBeforeIds,
        ...collectMapIdsFromMapStructurePayload(resolved.entity, row as Record<string, unknown>, normalizedId),
      ],
      "admin-entity-update",
    );

    return NextResponse.json({ success: true, data: safeRow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const { entity: rawEntity } = await params;
  const access = await resolveAccessibleEntity(rawEntity);
  if (!access.resolved) {
    return access.response || NextResponse.json({ success: false, error: "不支持的管理实体" }, { status: 404 });
  }
  const resolved = access.resolved;

  if (resolved.config.readOnlyDelete) {
    return NextResponse.json({ success: false, error: "该实体不支持删除" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const rowIds = Array.isArray(body.ids)
      ? body.ids
      : [body.id];

    const filteredIds = rowIds.filter((id: unknown) => id !== undefined && id !== null && id !== "");
    if (!filteredIds.length) {
      return NextResponse.json({ success: false, error: "缺少 id 或 ids" }, { status: 400 });
    }

    const normalizedIds = normalizeRowIds(resolved.entity, filteredIds);
    const mapStructureBeforeIds = isMapStructureEntity(resolved.entity)
      ? await collectExistingMapStructureIds(resolved.entity, normalizedIds)
      : [];
    if (resolved.entity === "maps") {
      await deleteMapsWithRelations(normalizedIds as string[]);
    } else if (resolved.entity === "temporaryMaps") {
      await deleteTemporaryMapsWithRelations(normalizedIds as string[]);
    } else if (resolved.entity === "npcs") {
      await deleteNpcsWithRelations(normalizedIds as string[]);
    } else if (resolved.entity === "temporaryMonsters") {
      await deleteTemporaryMonstersWithRelations(normalizedIds as string[]);
    } else if (resolved.entity === "players") {
      await deletePlayersWithRelations(normalizedIds as string[]);
    } else if (resolved.entity === "accounts") {
      await deleteAccountsWithRelations(normalizedIds as string[]);
    } else if (resolved.entity === "cdkCodes") {
      await deleteCdkCodesWithRelations(normalizedIds as number[]);
    } else if (resolved.entity === "sectRolePermissions") {
      for (const id of normalizedIds) {
        const parsed = parseSectRolePermissionRowId(id);
        await db.delete(sectRolePermissions)
          .where(and(
            eq(sectRolePermissions.sectId, parsed.sectId),
            eq(sectRolePermissions.roleKey, parsed.roleKey as never),
            eq(sectRolePermissions.permissionKey, parsed.permissionKey as never),
          ))
          .run();
      }
    } else if (normalizedIds.length === 1) {
      await db.delete(resolved.config.table)
        .where(eq(resolved.config.idColumn as never, normalizedIds[0] as never))
        .run();
    } else {
      await db.delete(resolved.config.table)
        .where(inArray(resolved.config.idColumn as never, normalizedIds as never))
        .run();
    }

    publishAdminMapStructureChanged(
      resolved.entity,
      mapStructureBeforeIds,
      "admin-entity-delete",
    );

    return NextResponse.json({ success: true, data: { deletedCount: normalizedIds.length } });
  } catch (error) {
    const message = formatDeleteError(error, { exposeConstraintDetails: true });
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
