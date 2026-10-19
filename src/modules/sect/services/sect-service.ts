import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  maps,
  players,
  items,
  sectApplications,
  sectBuildings,
  sectLogs,
  sectMembers,
  sectResources,
  sectRolePermissions,
  sectStorageItems,
  sects,
} from "@/db/schema";
import type {
  SectApplicationType,
  SectPermissionKey,
  SectRoleKey,
  SectSummary,
} from "@/types/game";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import {
  buildSectHomeMap,
  ensureSectHomeMapFixedPortals,
  expandSectMapTiles,
  injectSectEntryPortal,
  validateSectPlacement,
} from "@/modules/sect/services/sect-map-service";
import { runSectMaintenanceIfDue } from "@/modules/sect/services/sect-maintenance-service";
import {
  getLingqiPeakBonusRate,
  getSectLevelConfig,
  getSectRoleLabel,
  SECT_CREATE_MIN_REALM_CONFIG_KEY,
  SECT_CREATE_GOLD_COST,
  SECT_DEFAULT_CREATE_MIN_REALM,
  SECT_DEFAULT_STORAGE_CAPACITY,
  SECT_LEVEL_ORDER,
  SECT_MAX_LEVEL,
  SECT_ROLE_ORDER,
  SECT_ROLE_PERMISSION_DEFAULTS,
} from "@/modules/sect/services/sect-constants";
import { refreshSectGovernance } from "@/modules/sect/services/sect-governance-service";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { publishMapStructureChanged } from "@/modules/map/services/map-structure-invalidation";

const JOIN_EXPIRE_HOURS = 72;
const VISIT_EXPIRE_HOURS = 48;
const VISIT_APPROVED_HOURS = 24;
const SECT_LEGACY_WRONG_CREATE_MIN_REALM = 31;
const REQUIRED_SECT_TABLES = [
  "sects",
  "sect_members",
  "sect_role_permissions",
  "sect_applications",
  "sect_buildings",
  "sect_resources",
  "sect_storage_items",
  "sect_logs",
] as const;
const REQUIRED_SECT_COLUMNS = [
  { tableName: "sects", columnName: "empty_since_at" },
] as const;
const SECT_SCHEMA_ERROR_KEYWORDS = [
  ...REQUIRED_SECT_TABLES,
  ...REQUIRED_SECT_COLUMNS.map((entry) => entry.columnName),
  "sect_",
];

type SectDatabaseErrorShape = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

let sectSchemaReadyCache: boolean | null = null;
let sectSchemaReadyPromise: Promise<boolean> | null = null;
let hasWarnedMissingSectSchema = false;

function normalizeRoleKey(roleKey: string | null | undefined): SectRoleKey {
  if (roleKey === "handyman_disciple") {
    return "handyman";
  }
  return (roleKey || "outer_disciple") as SectRoleKey;
}

function getRoleIndex(roleKey: string | null | undefined) {
  const normalized = normalizeRoleKey(roleKey);
  const index = SECT_ROLE_ORDER.indexOf(normalized);
  return index >= 0 ? index : SECT_ROLE_ORDER.length;
}

function futureIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function buildSectLockKey(sectId: string) {
  return `sect:${sectId}`;
}

function buildSectPlacementLockKey(mapId: string) {
  return `sect-placement:${mapId}`;
}

function buildSectApplicationLockKey(sectId: string, playerId: string, type: SectApplicationType) {
  return `sect-application:${sectId}:${playerId}:${type}`;
}

function buildSectMemberLockKey(playerId: string) {
  return `sect-member:${playerId}`;
}

function getExecuteRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }

  return [];
}

function extractSectDatabaseError(error: unknown): SectDatabaseErrorShape | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const root = error as SectDatabaseErrorShape;
  if (typeof root.code === "string") {
    return root;
  }

  if (root.cause && typeof root.cause === "object") {
    const nested = extractSectDatabaseError(root.cause);
    if (nested) {
      return nested;
    }
  }

  if (typeof root.message === "string") {
    return root;
  }

  return null;
}

function includesSchemaKeyword(message: unknown) {
  if (typeof message !== "string") {
    return false;
  }

  const normalized = message.toLowerCase();
  return SECT_SCHEMA_ERROR_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isMissingSectSchemaError(error: unknown) {
  const dbError = extractSectDatabaseError(error);
  if (!dbError) {
    return false;
  }

  if (dbError.code !== "42P01" && dbError.code !== "42703") {
    return false;
  }

  return includesSchemaKeyword(dbError.message);
}

function markSectSchemaUnavailable(context: string, error?: unknown) {
  sectSchemaReadyCache = false;
  sectSchemaReadyPromise = null;

  if (hasWarnedMissingSectSchema) {
    return;
  }

  hasWarnedMissingSectSchema = true;
  console.warn(`[sect] 检测到宗门表结构缺失，主流程已启用降级保护。请确认老库已完成宗门升级。context=${context}`, error);
}

async function hasPublicTable(tableName: string) {
  const result = await db.execute(sql`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = ${tableName}
  `);

  const rows = getExecuteRows<{ value?: number | string }>(result);
  return Number(rows[0]?.value || 0) > 0;
}

async function hasPublicColumn(tableName: string, columnName: string) {
  const result = await db.execute(sql`
    select count(*)::int as value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
  `);

  const rows = getExecuteRows<{ value?: number | string }>(result);
  return Number(rows[0]?.value || 0) > 0;
}

async function isSectSchemaAvailable() {
  if (sectSchemaReadyCache !== null) {
    return sectSchemaReadyCache;
  }

  if (!sectSchemaReadyPromise) {
    sectSchemaReadyPromise = (async () => {
      const checks = await Promise.all(
        REQUIRED_SECT_TABLES.map(async (tableName) => ({
          tableName,
          exists: await hasPublicTable(tableName),
        })),
      );
      const missingTables = checks.filter((entry) => !entry.exists).map((entry) => entry.tableName);
      if (missingTables.length > 0) {
        markSectSchemaUnavailable(`missing=${missingTables.join(",")}`);
        return false;
      }

      const columnChecks = await Promise.all(
        REQUIRED_SECT_COLUMNS.map(async (entry) => ({
          ...entry,
          exists: await hasPublicColumn(entry.tableName, entry.columnName),
        })),
      );
      const missingColumns = columnChecks
        .filter((entry) => !entry.exists)
        .map((entry) => `${entry.tableName}.${entry.columnName}`);
      if (missingColumns.length > 0) {
        markSectSchemaUnavailable(`missing_columns=${missingColumns.join(",")}`);
        return false;
      }

      sectSchemaReadyCache = true;
      return true;
    })().catch((error) => {
      sectSchemaReadyPromise = null;
      throw error;
    });
  }

  const ready = await sectSchemaReadyPromise;
  sectSchemaReadyPromise = null;
  return ready;
}

async function withSectReadFallback<TFallback, TResult>(context: string, fallbackValue: TFallback, action: () => Promise<TResult>): Promise<TFallback | TResult> {
  if (!(await isSectSchemaAvailable())) {
    return fallbackValue;
  }

  try {
    await runSectMaintenanceIfDue();
    return await action();
  } catch (error) {
    if (isMissingSectSchemaError(error)) {
      markSectSchemaUnavailable(context, error);
      return fallbackValue;
    }
    throw error;
  }
}

export async function ensureSectFeatureReady() {
  if (await isSectSchemaAvailable()) {
    return;
  }

  throw new Error("宗门系统尚未初始化完成，请先完成数据库升级后再试");
}

async function acquireTextLock(executor: Pick<typeof db, "execute">, key: string) {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

export async function acquireSectMutationLock(executor: Pick<typeof db, "execute">, sectId: string) {
  await acquireTextLock(executor, buildSectLockKey(sectId));
}

async function acquireSectPlacementLock(executor: Pick<typeof db, "execute">, mapId: string) {
  await acquireTextLock(executor, buildSectPlacementLockKey(mapId));
}

async function acquireSectApplicationLock(executor: Pick<typeof db, "execute">, sectId: string, playerId: string, type: SectApplicationType) {
  await acquireTextLock(executor, buildSectApplicationLockKey(sectId, playerId, type));
}

async function acquireSectMemberLock(executor: Pick<typeof db, "execute">, playerId: string) {
  await acquireTextLock(executor, buildSectMemberLockKey(playerId));
}

async function expirePendingSectApplications(filters: {
  playerId?: string;
  sectId?: string;
  type?: SectApplicationType;
}, executor: Pick<typeof db, "update"> = db) {
  if (!(await isSectSchemaAvailable())) {
    return;
  }

  const nowIso = new Date().toISOString();
  const conditions = [
    eq(sectApplications.status, "pending"),
    lt(sectApplications.expiresAt, nowIso),
    filters.playerId ? eq(sectApplications.playerId, filters.playerId) : undefined,
    filters.sectId ? eq(sectApplications.sectId, filters.sectId) : undefined,
    filters.type ? eq(sectApplications.type, filters.type) : undefined,
  ].filter(Boolean);
  await executor.update(sectApplications).set({
    status: "expired",
    respondedAt: nowIso,
    updatedAt: nowIso,
  }).where(and(...conditions)).run();
}

function resolveSectPermissionSetForSect(
  sect: Awaited<ReturnType<typeof getSectCore>> extends infer T ? NonNullable<T> : never,
  playerId: string | undefined,
  permissions: SectPermissionKey[],
) {
  const isGovernor = Boolean(playerId && sect.governorPlayerId === playerId);
  if (sect.state === "abandoned_public" && !isGovernor) {
    return {
      sect,
      isGovernor,
      permissions: [] as SectPermissionKey[],
    };
  }
  return {
    sect,
    isGovernor,
    permissions: isGovernor ? SECT_ROLE_PERMISSION_DEFAULTS.leader : permissions,
  };
}

export async function resolveSectPermissionSet(sectId: string, roleKey: SectRoleKey, playerId?: string) {
  const sect = await getSectCore(sectId);
  if (!sect) {
    throw new Error("宗门不存在");
  }
  const permissions = await getSectRolePermissions(sectId, roleKey);
  return resolveSectPermissionSetForSect(sect, playerId, permissions);
}

export async function getSectCreateMinRealm() {
  const raw = await getSystemConfigValue(SECT_CREATE_MIN_REALM_CONFIG_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SECT_DEFAULT_CREATE_MIN_REALM;
  }
  const normalized = Math.floor(parsed);
  if (normalized === SECT_LEGACY_WRONG_CREATE_MIN_REALM) {
    // 兼容早期误写到库里的旧默认值，避免线上继续把创建门槛抬到炼虚。
    return SECT_DEFAULT_CREATE_MIN_REALM;
  }
  return normalized;
}

export async function getPlayerSectMembership(playerId: string) {
  return await withSectReadFallback("getPlayerSectMembership", null, async () => {
    const row = await db.select({
      sectId: sectMembers.sectId,
      roleKey: sectMembers.roleKey,
    }).from(sectMembers)
      .where(eq(sectMembers.playerId, playerId))
      .get();

    if (!row) {
      return null;
    }

    const roleKey = normalizeRoleKey(row.roleKey);
    return {
      sectId: row.sectId,
      roleKey,
      roleLabel: getSectRoleLabel(roleKey),
    };
  });
}

export async function getSectCore(sectId: string) {
  return await withSectReadFallback("getSectCore", null, async () => {
    await refreshSectGovernance(sectId);
    return await db.select().from(sects).where(eq(sects.id, sectId)).get();
  });
}

export async function getSectRolePermissions(sectId: string, roleKey: SectRoleKey) {
  const rows = await db.select({
    permissionKey: sectRolePermissions.permissionKey,
    enabled: sectRolePermissions.enabled,
  }).from(sectRolePermissions)
    .where(and(
      eq(sectRolePermissions.sectId, sectId),
      eq(sectRolePermissions.roleKey, roleKey),
    ))
    .all();

  if (rows.length === 0) {
    return SECT_ROLE_PERMISSION_DEFAULTS[roleKey] || [];
  }

  return rows
    .filter((row) => row.enabled)
    .map((row) => row.permissionKey as SectPermissionKey);
}

export async function requireSectMembership(playerId: string) {
  await ensureSectFeatureReady();
  const membership = await getPlayerSectMembership(playerId);
  if (!membership) {
    throw new Error("你尚未加入宗门");
  }
  return membership;
}

export async function requireSectPermission(playerId: string, permission: SectPermissionKey) {
  const membership = await requireSectMembership(playerId);
  const authority = await resolveSectPermissionSet(membership.sectId, membership.roleKey, playerId);
  if (authority.sect.state === "abandoned_public" && !authority.isGovernor) {
    throw new Error("宗门已公开荒废，当前不可执行此操作");
  }
  if (authority.isGovernor) {
    return membership;
  }
  if (!authority.permissions.includes(permission)) {
    throw new Error("当前职权不足");
  }
  return membership;
}

async function ensurePlayerHasNoSect(playerId: string) {
  const membership = await getPlayerSectMembership(playerId);
  if (membership) {
    throw new Error("每位修士只能加入或创建一个宗门");
  }
}

async function getSectMemberCount(sectId: string) {
  const row = await db.select({ total: count() }).from(sectMembers).where(eq(sectMembers.sectId, sectId)).get();
  return Number(row?.total || 0);
}

async function getSectLingqiPeakLevel(sectId: string) {
  const row = await db.select({ level: sectBuildings.level }).from(sectBuildings)
    .where(and(
      eq(sectBuildings.sectId, sectId),
      eq(sectBuildings.buildingType, "lingqi_peak"),
    ))
    .get();
  return Math.max(1, Number(row?.level || 1));
}

export async function buildSectSummary(sectId: string, roleKey: SectRoleKey, playerId?: string): Promise<SectSummary> {
  const [authority, memberCount, lingqiPeakLevel] = await Promise.all([
    resolveSectPermissionSet(sectId, roleKey, playerId),
    getSectMemberCount(sectId),
    getSectLingqiPeakLevel(sectId),
  ]);
  return buildSectSummaryFromAuthority(authority, roleKey, memberCount, lingqiPeakLevel);
}

function buildSectSummaryFromAuthority(
  authority: {
    sect: Awaited<ReturnType<typeof getSectCore>> extends infer T ? NonNullable<T> : never;
    isGovernor: boolean;
    permissions: SectPermissionKey[];
  },
  roleKey: SectRoleKey,
  memberCount: number,
  lingqiPeakLevel: number,
): SectSummary {
  const { sect, isGovernor, permissions } = authority;
  const publicState = sect.state === "abandoned_public";

  return {
    sectId: sect.id,
    sectName: sect.name,
    state: publicState ? "abandoned_public" : "active",
    roleKey,
    roleLabel: getSectRoleLabel(roleKey),
    isGovernor,
    sectLevel: sect.level as 1 | 2 | 3 | 4 | 5,
    sectMapSize: sect.mapSize,
    sectMemberCount: memberCount,
    sectMemberLimit: sect.memberLimit,
    dongfuBonusRate: getLingqiPeakBonusRate(lingqiPeakLevel),
    mapSize: sect.mapSize,
    publicState,
    canReviewJoinApplications: isGovernor || permissions.includes("review_join"),
    canReviewVisitApplications: isGovernor || permissions.includes("review_visit"),
  };
}

async function getPlayerSectQueryContext(playerId: string) {
  await expirePendingSectApplications({ playerId });
  const membership = await requireSectMembership(playerId);
  const sect = await getSectCore(membership.sectId);
  if (!sect) {
    throw new Error("宗门不存在");
  }
  const permissions = await getSectRolePermissions(sect.id, membership.roleKey);
  const authority = resolveSectPermissionSetForSect(sect, playerId, permissions);
  return {
    membership,
    sect,
    authority,
  };
}

async function createDefaultRolePermissions(sectId: string) {
  const nowIso = new Date().toISOString();
  const values = Object.entries(SECT_ROLE_PERMISSION_DEFAULTS).flatMap(([roleKey, permissionKeys]) => (
    permissionKeys.map((permissionKey) => ({
      sectId,
      roleKey: normalizeRoleKey(roleKey),
      permissionKey,
      enabled: true,
      updatedAt: nowIso,
    }))
  ));
  if (values.length > 0) {
    await db.insert(sectRolePermissions).values(values).onConflictDoNothing().run();
  }
}

async function addSectLog(sectId: string, actorPlayerId: string | null, actionType: string, detail: Record<string, unknown>) {
  await db.insert(sectLogs).values({
    sectId,
    actorPlayerId,
    actionType,
    detail,
    createdAt: new Date().toISOString(),
  }).run();
}

export async function createSect(params: {
  playerId: string;
  sectName: string;
  announcement?: string;
  mapId: string;
  positionX: number;
  positionY: number;
}) {
  await ensureSectFeatureReady();
  const player = await db.select({
    id: players.id,
    name: players.name,
    realm: players.realm,
    gold: players.gold,
  }).from(players).where(eq(players.id, params.playerId)).get();
  if (!player) {
    throw new Error("玩家不存在");
  }

  await ensurePlayerHasNoSect(player.id);
  const createMinRealm = await getSectCreateMinRealm();
  if (player.realm < createMinRealm) {
    const realmName = await getRealmFullNameByLinearRealm(createMinRealm);
    throw new Error(`创建宗门至少需要达到 ${realmName}`);
  }
  if (Number(player.gold || 0) < SECT_CREATE_GOLD_COST) {
    throw new Error(`创建宗门需要消耗 ${SECT_CREATE_GOLD_COST} 灵石，你当前灵石不足`);
  }

  const placement = await validateSectPlacement({
    mapId: params.mapId,
    positionX: params.positionX,
    positionY: params.positionY,
  });
  const sectName = params.sectName.trim();
  if (!sectName) {
    throw new Error("宗门名称不能为空");
  }

  const sectId = crypto.randomUUID();
  const homeMapId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const levelConfig = getSectLevelConfig(1);
  const gameStartConfig = await getGameStartConfig();
  const homeMap = buildSectHomeMap({
    sectId,
    sectName,
    level: 1,
    externalMapId: placement.map.id,
    externalMapName: placement.map.name,
    startMapId: gameStartConfig.mapId,
    startMapName: "出生点",
  });
  await db.transaction(async (tx) => {
    await acquireSectMemberLock(tx, player.id);
    await acquireSectPlacementLock(tx, placement.map.id);
    const currentMembership = await tx.select({ sectId: sectMembers.sectId }).from(sectMembers).where(eq(sectMembers.playerId, player.id)).get();
    if (currentMembership) {
      throw new Error("每位修士只能加入或创建一个宗门");
    }
    const latestPlayer = await tx.select({
      gold: players.gold,
    }).from(players).where(eq(players.id, player.id)).get();
    if (!latestPlayer) {
      throw new Error("玩家不存在");
    }
    if (Number(latestPlayer.gold || 0) < SECT_CREATE_GOLD_COST) {
      throw new Error(`创建宗门需要消耗 ${SECT_CREATE_GOLD_COST} 灵石，你当前灵石不足`);
    }
    await validateSectPlacement({
      mapId: params.mapId,
      positionX: params.positionX,
      positionY: params.positionY,
    });
    const freshExternalMap = await tx.select().from(maps).where(eq(maps.id, placement.map.id)).get();
    if (!freshExternalMap) {
      throw new Error("宗门入口地图不存在");
    }
    const entryTiles = injectSectEntryPortal({
      tilesData: freshExternalMap.tilesData,
      sectId,
      sectName,
      positionX: placement.positionX,
      positionY: placement.positionY,
      homeMapId,
    });
    await tx.insert(maps).values({
      id: homeMapId,
      name: `${sectName}驻地`,
      description: `${sectName}宗门驻地`,
      width: homeMap.width,
      height: homeMap.height,
      minRealm: 1,
      mapType: "sect",
      tilesData: homeMap.tilesData,
      createdAt: nowIso,
    }).run();

    await tx.update(maps).set({
      tilesData: entryTiles,
    }).where(eq(maps.id, placement.map.id)).run();

    await tx.update(players).set({
      gold: Number(latestPlayer.gold || 0) - SECT_CREATE_GOLD_COST,
    }).where(eq(players.id, player.id)).run();

    await tx.insert(sects).values({
      id: sectId,
      name: sectName,
      announcement: params.announcement?.trim() || "",
      description: `${sectName}宗门`,
      state: "active",
      externalMapId: placement.map.id,
      externalPositionX: placement.positionX,
      externalPositionY: placement.positionY,
      homeMapId,
      founderPlayerId: player.id,
      governorPlayerId: player.id,
      level: 1,
      mapSize: levelConfig.mapSize,
      memberLimit: levelConfig.memberLimit,
      storageCapacity: SECT_DEFAULT_STORAGE_CAPACITY,
      joinApprovalEnabled: true,
      visitorApprovalEnabled: true,
      emptySinceAt: null,
      governanceRefreshedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).run();

    await tx.insert(sectMembers).values({
      playerId: player.id,
      sectId,
      roleKey: "leader",
      joinedAt: nowIso,
      appointedByPlayerId: player.id,
      updatedAt: nowIso,
    }).run();

    await tx.insert(sectResources).values({
      sectId,
      spiritStone: 0,
      wood: 0,
      stone: 0,
      sectMaterial: 0,
      storageCapacity: SECT_DEFAULT_STORAGE_CAPACITY,
      updatedAt: nowIso,
    }).run();

    await tx.insert(sectBuildings).values(
      homeMap.buildings.map((building) => ({
        sectId,
        buildingType: building.buildingType,
        name: building.name,
        level: building.level,
        positionX: building.positionX,
        positionY: building.positionY,
        description: building.description,
        meta: {},
        updatedAt: nowIso,
      })),
    ).run();
  });

  await createDefaultRolePermissions(sectId);
  await addSectLog(sectId, player.id, "create", {
    founderName: player.name,
    createGoldCost: SECT_CREATE_GOLD_COST,
    externalMapId: placement.map.id,
    externalPositionX: placement.positionX,
    externalPositionY: placement.positionY,
  });
  publishMapStructureChanged({
    mapIds: [placement.map.id, homeMapId],
    source: "sect-create",
  });

  return {
    sectId,
    homeMapId,
  };
}

export async function applyToSect(params: {
  playerId: string;
  sectId: string;
  type: SectApplicationType;
  note?: string;
}) {
  await ensureSectFeatureReady();
  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await acquireSectApplicationLock(tx, params.sectId, params.playerId, params.type);
    await expirePendingSectApplications({
      playerId: params.playerId,
      sectId: params.sectId,
      type: params.type,
    }, tx);

    const sect = await tx.select().from(sects).where(eq(sects.id, params.sectId)).get();
    if (!sect) {
      throw new Error("宗门不存在");
    }
    if (sect.state === "abandoned_public") {
      throw new Error(params.type === "visit" ? "该宗门已公开荒废，可直接进入，无需申请" : "公开荒废宗门当前不可申请加入");
    }

    await acquireSectMemberLock(tx, params.playerId);
    if (params.type === "join") {
      const membership = await tx.select({ sectId: sectMembers.sectId }).from(sectMembers).where(eq(sectMembers.playerId, params.playerId)).get();
      if (membership) {
        throw new Error("每位修士只能加入或创建一个宗门");
      }
    } else {
      const membership = await tx.select({ sectId: sectMembers.sectId }).from(sectMembers).where(eq(sectMembers.playerId, params.playerId)).get();
      if (membership?.sectId === params.sectId) {
        throw new Error("本宗弟子无需再次申请访客");
      }
    }

    const existing = await tx.select({ id: sectApplications.id }).from(sectApplications)
      .where(and(
        eq(sectApplications.sectId, params.sectId),
        eq(sectApplications.playerId, params.playerId),
        eq(sectApplications.type, params.type),
        eq(sectApplications.status, "pending"),
      ))
      .get();
    if (existing) {
      throw new Error("已有待处理申请，请勿重复提交");
    }

    const autoApproveJoin = params.type === "join" && !sect.joinApprovalEnabled;
    const autoApproveVisit = params.type === "visit" && !sect.visitorApprovalEnabled;
    if (autoApproveJoin) {
      const memberCountRow = await tx.select({ total: count() }).from(sectMembers).where(eq(sectMembers.sectId, sect.id)).get();
      const memberCount = Number(memberCountRow?.total || 0);
      if (memberCount >= sect.memberLimit) {
        throw new Error("宗门人数已满，请先扩建");
      }
      await tx.insert(sectMembers).values({
        playerId: params.playerId,
        sectId: sect.id,
        roleKey: "outer_disciple",
        joinedAt: nowIso,
        appointedByPlayerId: sect.governorPlayerId,
        updatedAt: nowIso,
      }).run();
      await tx.update(sects).set({
        emptySinceAt: null,
        updatedAt: nowIso,
      }).where(eq(sects.id, sect.id)).run();
    }

    const autoApproved = autoApproveJoin || autoApproveVisit;
    await tx.insert(sectApplications).values({
      sectId: params.sectId,
      playerId: params.playerId,
      type: params.type,
      status: autoApproved ? "approved" : "pending",
      note: params.note?.trim() || null,
      reviewedByPlayerId: autoApproved ? sect.governorPlayerId : null,
      respondedAt: autoApproved ? nowIso : null,
      expiresAt: autoApproveJoin
        ? null
        : (autoApproveVisit
          ? futureIso(VISIT_APPROVED_HOURS)
          : futureIso(params.type === "join" ? JOIN_EXPIRE_HOURS : VISIT_EXPIRE_HOURS)),
      createdAt: nowIso,
      updatedAt: nowIso,
    }).run();
  });
}

export async function respondToSectApplication(params: {
  playerId: string;
  applicationId: string;
  action: "approve" | "reject";
}) {
  await ensureSectFeatureReady();
  const application = await db.select().from(sectApplications).where(eq(sectApplications.id, params.applicationId)).get();
  if (!application) {
    throw new Error("申请不存在");
  }
  if (application.status !== "pending") {
    throw new Error("申请已处理");
  }

  const permission = application.type === "join" ? "review_join" : "review_visit";
  const membership = await requireSectPermission(params.playerId, permission);
  if (membership.sectId !== application.sectId) {
    throw new Error("不能处理其他宗门的申请");
  }

  const nowIso = new Date().toISOString();
  if (params.action === "reject") {
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, application.sectId);
      const currentApplication = await tx.select().from(sectApplications).where(eq(sectApplications.id, application.id)).get();
      if (!currentApplication || currentApplication.status !== "pending") {
        throw new Error("申请已处理");
      }
      if (currentApplication.expiresAt && currentApplication.expiresAt <= nowIso) {
        await tx.update(sectApplications).set({
          status: "expired",
          respondedAt: nowIso,
          updatedAt: nowIso,
        }).where(eq(sectApplications.id, application.id)).run();
        throw new Error("申请已过期");
      }
      await tx.update(sectApplications).set({
        status: "rejected",
        reviewedByPlayerId: params.playerId,
        respondedAt: nowIso,
        updatedAt: nowIso,
      }).where(eq(sectApplications.id, application.id)).run();
    });
    return;
  }

  if (application.type === "join") {
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, application.sectId);
      await acquireSectMemberLock(tx, application.playerId);
      const currentApplication = await tx.select().from(sectApplications).where(eq(sectApplications.id, application.id)).get();
      if (!currentApplication || currentApplication.status !== "pending") {
        throw new Error("申请已处理");
      }
      if (currentApplication.expiresAt && currentApplication.expiresAt <= nowIso) {
        await tx.update(sectApplications).set({
          status: "expired",
          respondedAt: nowIso,
          updatedAt: nowIso,
        }).where(eq(sectApplications.id, application.id)).run();
        throw new Error("申请已过期");
      }
      const currentMembership = await tx.select({ sectId: sectMembers.sectId }).from(sectMembers).where(eq(sectMembers.playerId, application.playerId)).get();
      if (currentMembership) {
        throw new Error("该修士已有宗门归属");
      }
      const sect = await tx.select().from(sects).where(eq(sects.id, application.sectId)).get();
      if (!sect) {
        throw new Error("宗门不存在");
      }
      const memberCountRow = await tx.select({ total: count() }).from(sectMembers).where(eq(sectMembers.sectId, sect.id)).get();
      const memberCount = Number(memberCountRow?.total || 0);
      if (memberCount >= sect.memberLimit) {
        throw new Error("宗门人数已满，请先扩建");
      }
      await tx.insert(sectMembers).values({
        playerId: application.playerId,
        sectId: sect.id,
        roleKey: "outer_disciple",
        joinedAt: nowIso,
        appointedByPlayerId: params.playerId,
        updatedAt: nowIso,
      }).run();
      await tx.update(sects).set({
        emptySinceAt: null,
        updatedAt: nowIso,
      }).where(eq(sects.id, sect.id)).run();
      await tx.update(sectApplications).set({
        status: "approved",
        reviewedByPlayerId: params.playerId,
        respondedAt: nowIso,
        updatedAt: nowIso,
      }).where(eq(sectApplications.id, application.id)).run();
    });
    await addSectLog(application.sectId, params.playerId, "approve_join", {
      targetPlayerId: application.playerId,
    });
    return;
  }

  await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, application.sectId);
    const currentApplication = await tx.select().from(sectApplications).where(eq(sectApplications.id, application.id)).get();
    if (!currentApplication || currentApplication.status !== "pending") {
      throw new Error("申请已处理");
    }
    if (currentApplication.expiresAt && currentApplication.expiresAt <= nowIso) {
      await tx.update(sectApplications).set({
        status: "expired",
        respondedAt: nowIso,
        updatedAt: nowIso,
      }).where(eq(sectApplications.id, application.id)).run();
      throw new Error("申请已过期");
    }
    await tx.update(sectApplications).set({
      status: "approved",
      reviewedByPlayerId: params.playerId,
      respondedAt: nowIso,
      expiresAt: futureIso(VISIT_APPROVED_HOURS),
      updatedAt: nowIso,
    }).where(eq(sectApplications.id, application.id)).run();
  });
}

export async function appointSectMember(params: {
  playerId: string;
  targetPlayerId: string;
  roleKey: SectRoleKey;
}) {
  await ensureSectFeatureReady();
  const membership = await requireSectPermission(params.playerId, "appoint_member");
  const authority = await resolveSectPermissionSet(membership.sectId, membership.roleKey, params.playerId);
  const target = await db.select().from(sectMembers).where(eq(sectMembers.playerId, params.targetPlayerId)).get();
  if (!target || target.sectId !== membership.sectId) {
    throw new Error("目标修士不在本宗");
  }

  const operatorIndex = getRoleIndex(authority.isGovernor ? "leader" : membership.roleKey);
  const targetIndex = getRoleIndex(target.roleKey);
  const nextIndex = getRoleIndex(params.roleKey);
  if (!authority.isGovernor && (targetIndex <= operatorIndex || nextIndex <= operatorIndex)) {
    throw new Error("只能调整低于自身职阶的成员");
  }

  const nowIso = new Date().toISOString();
  if (params.roleKey === "leader") {
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, membership.sectId);
      await acquireSectMemberLock(tx, params.targetPlayerId);
      const freshSect = await tx.select().from(sects).where(eq(sects.id, membership.sectId)).get();
      const freshOperator = await tx.select().from(sectMembers).where(eq(sectMembers.playerId, params.playerId)).get();
      const freshTarget = await tx.select().from(sectMembers).where(eq(sectMembers.playerId, params.targetPlayerId)).get();
      if (!freshSect || !freshOperator || !freshTarget || freshOperator.sectId !== membership.sectId || freshTarget.sectId !== membership.sectId) {
        throw new Error("目标修士不在本宗");
      }
      await tx.update(sectMembers).set({
        roleKey: "vice_leader",
        appointedByPlayerId: params.playerId,
        updatedAt: nowIso,
      }).where(and(
        eq(sectMembers.sectId, membership.sectId),
        eq(sectMembers.roleKey, "leader"),
        sql`${sectMembers.playerId} <> ${params.targetPlayerId}`,
      )).run();

      await tx.update(sectMembers).set({
        roleKey: "leader",
        appointedByPlayerId: params.playerId,
        updatedAt: nowIso,
      }).where(and(
        eq(sectMembers.playerId, params.targetPlayerId),
        eq(sectMembers.sectId, membership.sectId),
      )).run();

      await tx.update(sects).set({
        governorPlayerId: params.targetPlayerId,
        updatedAt: nowIso,
      }).where(eq(sects.id, freshSect.id)).run();
    });
    await addSectLog(membership.sectId, params.playerId, "appoint_leader", {
      targetPlayerId: params.targetPlayerId,
    });
    return;
  }

  await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, membership.sectId);
    await acquireSectMemberLock(tx, params.targetPlayerId);
    const freshOperator = await tx.select().from(sectMembers).where(eq(sectMembers.playerId, params.playerId)).get();
    const freshTarget = await tx.select().from(sectMembers).where(eq(sectMembers.playerId, params.targetPlayerId)).get();
    const freshSect = await tx.select().from(sects).where(eq(sects.id, membership.sectId)).get();
    if (!freshOperator || !freshTarget || !freshSect || freshOperator.sectId !== membership.sectId || freshTarget.sectId !== membership.sectId) {
      throw new Error("目标修士不在本宗");
    }
    const operatorRoleKey = normalizeRoleKey(freshOperator.roleKey);
    const operatorIndex = getRoleIndex(freshSect.governorPlayerId === params.playerId ? "leader" : operatorRoleKey);
    const targetIndex = getRoleIndex(freshTarget.roleKey);
    const nextIndex = getRoleIndex(params.roleKey);
    if (freshSect.governorPlayerId !== params.playerId && (targetIndex <= operatorIndex || nextIndex <= operatorIndex)) {
      throw new Error("只能调整低于自身职阶的成员");
    }
    await tx.update(sectMembers).set({
      roleKey: normalizeRoleKey(params.roleKey),
      appointedByPlayerId: params.playerId,
      updatedAt: nowIso,
    }).where(and(
      eq(sectMembers.playerId, params.targetPlayerId),
      eq(sectMembers.sectId, membership.sectId),
    )).run();
  });
}

export async function leaveSect(playerId: string) {
  await ensureSectFeatureReady();
  const membership = await requireSectMembership(playerId);
  const sect = await getSectCore(membership.sectId);
  if (!sect) {
    throw new Error("宗门不存在");
  }

  const nowIso = new Date().toISOString();
  const leaveResult = await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, sect.id);
    const freshMembership = await tx.select().from(sectMembers).where(eq(sectMembers.playerId, playerId)).get();
    if (!freshMembership || freshMembership.sectId !== sect.id) {
      throw new Error("你尚未加入宗门");
    }
    const memberCountRow = await tx.select({ total: count() }).from(sectMembers).where(eq(sectMembers.sectId, sect.id)).get();
    const memberCount = Number(memberCountRow?.total || 0);
    if (normalizeRoleKey(freshMembership.roleKey) === "leader" && memberCount > 1) {
      throw new Error("宗主不能直接退出，请先移交宗主之位");
    }

    await tx.delete(sectMembers).where(and(
      eq(sectMembers.playerId, playerId),
      eq(sectMembers.sectId, sect.id),
    )).run();

    if (memberCount <= 1) {
      await tx.update(sects).set({
        state: "abandoned_public",
        governorPlayerId: null,
        emptySinceAt: nowIso,
        updatedAt: nowIso,
      }).where(eq(sects.id, sect.id)).run();
    }

    return {
      memberCountBeforeLeave: memberCount,
    };
  });

  await addSectLog(sect.id, playerId, "leave", {
    memberCountBeforeLeave: leaveResult.memberCountBeforeLeave,
  });

  if (leaveResult.memberCountBeforeLeave > 1) {
    await refreshSectGovernance(sect.id);
  }
}

export async function expandSect(playerId: string) {
  await ensureSectFeatureReady();
  const membership = await requireSectPermission(playerId, "expand_sect");
  const nowIso = new Date().toISOString();
  let changedHomeMapId: string | null = null;

  await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, membership.sectId);
    const sect = await tx.select().from(sects).where(eq(sects.id, membership.sectId)).get();
    const resources = await tx.select().from(sectResources).where(eq(sectResources.sectId, membership.sectId)).get();
    if (!sect || !resources) {
      throw new Error("宗门数据不存在");
    }
    if (sect.level >= SECT_MAX_LEVEL) {
      throw new Error("宗门已达最高等级");
    }
    const nextLevel = (sect.level + 1) as 1 | 2 | 3 | 4 | 5;
    const nextConfig = getSectLevelConfig(nextLevel);
    const cost = nextConfig.expandCost;
    if (
      resources.spiritStone < cost.spiritStone
      || resources.wood < cost.wood
      || resources.stone < cost.stone
      || resources.sectMaterial < cost.sectMaterial
    ) {
      throw new Error("宗门资源不足，无法扩建");
    }
    const homeMap = await tx.select().from(maps).where(eq(maps.id, sect.homeMapId)).get();
    if (!homeMap) {
      throw new Error("宗门驻地地图不存在");
    }
    const nextTiles = expandSectMapTiles({
      tilesData: homeMap.tilesData,
      nextSize: nextConfig.mapSize,
    });
    await tx.update(sects).set({
      level: nextLevel,
      mapSize: nextConfig.mapSize,
      memberLimit: nextConfig.memberLimit,
      updatedAt: nowIso,
    }).where(eq(sects.id, sect.id)).run();

    await tx.update(sectResources).set({
      spiritStone: resources.spiritStone - cost.spiritStone,
      wood: resources.wood - cost.wood,
      stone: resources.stone - cost.stone,
      sectMaterial: resources.sectMaterial - cost.sectMaterial,
      updatedAt: nowIso,
    }).where(eq(sectResources.sectId, sect.id)).run();
    await tx.update(maps).set({
      width: nextConfig.mapSize,
      height: nextConfig.mapSize,
      mapType: "sect",
      tilesData: nextTiles,
    }).where(eq(maps.id, sect.homeMapId)).run();
    changedHomeMapId = sect.homeMapId;
  });
  publishMapStructureChanged({
    mapIds: [changedHomeMapId],
    source: "sect-upgrade-map",
  });
}

export async function canPlayerEnterSectMap(playerId: string, homeMapId: string): Promise<{
  allowed: boolean;
  sect: Awaited<ReturnType<typeof getSectCore>>;
  reason?: string;
}> {
  const fallbackResult: {
    allowed: boolean;
    sect: Awaited<ReturnType<typeof getSectCore>>;
    reason?: string;
  } = {
    allowed: true,
    sect: null,
  };

  return await withSectReadFallback("canPlayerEnterSectMap", fallbackResult, async () => {
    const sect = await db.select().from(sects).where(eq(sects.homeMapId, homeMapId)).get();
    if (!sect) {
      return { allowed: true, sect: null };
    }

    await ensureSectHomeMapFixedPortals({
      sectId: sect.id,
      sectName: sect.name,
      homeMapId: sect.homeMapId,
      externalMapId: sect.externalMapId,
      externalMapName: null,
    });

    await refreshSectGovernance(sect.id);
    const nextSect = await db.select().from(sects).where(eq(sects.id, sect.id)).get();
    if (!nextSect) {
      return { allowed: false, sect: null, reason: "宗门不存在" };
    }

    const membership = await getPlayerSectMembership(playerId);
    if (membership?.sectId === nextSect.id || nextSect.state === "abandoned_public") {
      return { allowed: true, sect: nextSect };
    }

    const visit = await db.select({ id: sectApplications.id }).from(sectApplications)
      .where(and(
        eq(sectApplications.sectId, nextSect.id),
        eq(sectApplications.playerId, playerId),
        eq(sectApplications.type, "visit"),
        eq(sectApplications.status, "approved"),
        gt(sectApplications.expiresAt, new Date().toISOString()),
      ))
      .get();

    if (!visit) {
      return { allowed: false, sect: nextSect, reason: "此宗门需要先通过访客申请" };
    }

    return { allowed: true, sect: nextSect };
  });
}

export async function getSectDongfuBonusRateForPlayer(playerId: string) {
  return await withSectReadFallback("getSectDongfuBonusRateForPlayer", {
    sectDongfuLingqiRate: 0,
    sectSummary: null as SectSummary | null,
  }, async () => {
    const membership = await getPlayerSectMembership(playerId);
    if (!membership) {
      return {
        sectDongfuLingqiRate: 0,
        sectSummary: null as SectSummary | null,
      };
    }

    const summary = await buildSectSummary(membership.sectId, membership.roleKey, playerId);
    const lingqiPeakLevel = await getSectLingqiPeakLevel(membership.sectId);
    return {
      sectDongfuLingqiRate: getLingqiPeakBonusRate(lingqiPeakLevel),
      sectSummary: summary,
    };
  });
}

export async function getSectDongfuBonusRate(playerId: string) {
  const result = await getSectDongfuBonusRateForPlayer(playerId);
  return result.sectDongfuLingqiRate;
}

export async function getPlayerSectSummary(playerId: string) {
  return await withSectReadFallback("getPlayerSectSummary", null, async () => {
    const membership = await getPlayerSectMembership(playerId);
    if (!membership) {
      return null;
    }
    return await buildSectSummary(membership.sectId, membership.roleKey, playerId);
  });
}

export async function getSectMembersSnapshot(playerId: string) {
  return await withSectReadFallback("getSectMembersSnapshot", [], async () => {
    const { sect } = await getPlayerSectQueryContext(playerId);
    const members = await db.select({
      playerId: sectMembers.playerId,
      roleKey: sectMembers.roleKey,
      playerName: players.name,
      realmName: players.realmName,
      lastSeenAt: players.lastSeenAt,
    }).from(sectMembers)
      .innerJoin(players, eq(players.id, sectMembers.playerId))
      .where(eq(sectMembers.sectId, sect.id))
      .all();

    return members
      .map((row) => {
        const roleKey = normalizeRoleKey(row.roleKey);
        return {
          playerId: row.playerId,
          playerName: row.playerName,
          realmName: row.realmName,
          roleKey,
          roleLabel: getSectRoleLabel(roleKey),
          lastSeenAt: row.lastSeenAt,
        };
      })
      .sort((a, b) => getRoleIndex(a.roleKey) - getRoleIndex(b.roleKey));
  });
}

export async function getSectBuildingsSnapshot(playerId: string) {
  return await withSectReadFallback("getSectBuildingsSnapshot", {
    buildings: [],
    resources: null,
    permissions: [] as SectPermissionKey[],
    permissionPreview: {
      innerDiscipleReviewVisitEnabled: false,
    },
  }, async () => {
    const { sect, authority } = await getPlayerSectQueryContext(playerId);
    const innerDisciplePermissions = authority.isGovernor
      ? await getSectRolePermissions(sect.id, "inner_disciple")
      : [];
    const [buildings, resources] = await Promise.all([
      db.select().from(sectBuildings).where(eq(sectBuildings.sectId, sect.id)).orderBy(asc(sectBuildings.positionY), asc(sectBuildings.positionX)).all(),
      db.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get(),
    ]);

    return {
      buildings,
      resources: resources || null,
      permissions: authority.permissions,
      permissionPreview: {
        innerDiscipleReviewVisitEnabled: innerDisciplePermissions.includes("review_visit"),
      },
    };
  });
}

export async function getSectStorageSnapshot(playerId: string) {
  return await withSectReadFallback("getSectStorageSnapshot", {
    storage: [],
    resources: null,
  }, async () => {
    const { sect } = await getPlayerSectQueryContext(playerId);
    const [storage, resources] = await Promise.all([
      db.select({
        id: sectStorageItems.id,
        slotIndex: sectStorageItems.slotIndex,
        itemId: sectStorageItems.itemId,
        itemName: items.name,
        quantity: sectStorageItems.quantity,
      }).from(sectStorageItems)
        .leftJoin(items, eq(items.id, sectStorageItems.itemId))
        .where(eq(sectStorageItems.sectId, sect.id))
        .orderBy(asc(sectStorageItems.slotIndex))
        .all(),
      db.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get(),
    ]);
    return {
      storage,
      resources: resources || null,
    };
  });
}

export async function canPlayerAccessSectMap(params: {
  playerId: string;
  mapId: string;
}) {
  return await canPlayerEnterSectMap(params.playerId, params.mapId);
}

export async function getSectDashboard(playerId: string) {
  const player = await db.select({
    id: players.id,
    name: players.name,
    realm: players.realm,
    gold: players.gold,
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
  }).from(players).where(eq(players.id, playerId)).get();
  if (!player) {
    throw new Error("玩家不存在");
  }

  const createMinRealm = await getSectCreateMinRealm();
  const createMinRealmName = await getRealmFullNameByLinearRealm(createMinRealm);
  const unavailablePayload = {
    currentPlayer: {
      id: player.id,
      name: player.name,
      realm: player.realm,
      gold: Number(player.gold || 0),
      currentMapId: player.currentMapId,
      positionX: player.positionX,
      positionY: player.positionY,
      createMinRealm,
      createMinRealmName,
      createGoldCost: SECT_CREATE_GOLD_COST,
    },
    membership: null,
    canCreate: false,
    browse: {
      sects: [],
      myApplications: [],
    },
    sect: null,
    schemaReady: false,
    schemaMessage: "宗门系统尚未初始化完成",
  };

  return await withSectReadFallback("getSectDashboard", unavailablePayload, async () => {
    await expirePendingSectApplications({ playerId });
    const membership = await getPlayerSectMembership(playerId);
    const [browseRows, applicationRows] = await Promise.all([
      db.select({
        id: sects.id,
        name: sects.name,
        announcement: sects.announcement,
        state: sects.state,
        level: sects.level,
        mapSize: sects.mapSize,
        memberLimit: sects.memberLimit,
        governorPlayerId: sects.governorPlayerId,
        externalMapId: sects.externalMapId,
        externalPositionX: sects.externalPositionX,
        externalPositionY: sects.externalPositionY,
        externalMapName: maps.name,
      }).from(sects)
        .leftJoin(maps, eq(maps.id, sects.externalMapId))
        .orderBy(desc(sects.level), asc(sects.name))
        .all(),
      db.select({
        id: sectApplications.id,
        sectId: sectApplications.sectId,
        sectName: sects.name,
        type: sectApplications.type,
        status: sectApplications.status,
        note: sectApplications.note,
        createdAt: sectApplications.createdAt,
        expiresAt: sectApplications.expiresAt,
      }).from(sectApplications)
        .innerJoin(sects, eq(sects.id, sectApplications.sectId))
        .where(eq(sectApplications.playerId, playerId))
        .orderBy(desc(sectApplications.createdAt))
        .all(),
    ]);

    const browseSectIds = browseRows.map((row) => row.id);
    const countRows = browseSectIds.length > 0
      ? await db.select({
        sectId: sectMembers.sectId,
        total: count(),
      }).from(sectMembers)
        .where(inArray(sectMembers.sectId, browseSectIds))
        .groupBy(sectMembers.sectId)
        .all()
      : [];
    const countMap = new Map(countRows.map((row) => [row.sectId, Number(row.total || 0)]));

    const basePayload = {
      currentPlayer: unavailablePayload.currentPlayer,
      membership,
      canCreate: player.realm >= createMinRealm && Number(player.gold || 0) >= SECT_CREATE_GOLD_COST && !membership,
      browse: {
        sects: browseRows.map((row) => ({
          id: row.id,
          name: row.name,
          announcement: row.announcement,
          state: row.state,
          level: row.level,
          mapSize: row.mapSize,
          memberCount: countMap.get(row.id) || 0,
          memberLimit: row.memberLimit,
          externalMapId: row.externalMapId,
          externalPositionX: row.externalPositionX,
          externalPositionY: row.externalPositionY,
          externalMapName: row.externalMapName,
        })),
        myApplications: applicationRows,
      },
      schemaReady: true,
      schemaMessage: null,
    };

    if (!membership) {
      return {
        ...basePayload,
        sect: null,
      };
    }

    await expirePendingSectApplications({ sectId: membership.sectId });
    const sect = await getSectCore(membership.sectId);
    if (!sect) {
      return {
        ...basePayload,
        sect: null,
      };
    }

    const permissions = await getSectRolePermissions(sect.id, membership.roleKey);
    const authority = resolveSectPermissionSetForSect(sect, playerId, permissions);
    const allowedPendingTypes = [
      authority.isGovernor || authority.permissions.includes("review_join") ? "join" : null,
      authority.isGovernor || authority.permissions.includes("review_visit") ? "visit" : null,
    ].filter((value): value is "join" | "visit" => Boolean(value));
    const innerDisciplePermissions = authority.isGovernor
      ? await getSectRolePermissions(sect.id, "inner_disciple")
      : [];

    const [memberCount, lingqiPeakLevel, resources, buildings, members, pendingApplications, storage] = await Promise.all([
      getSectMemberCount(sect.id),
      getSectLingqiPeakLevel(sect.id),
      db.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get(),
      db.select().from(sectBuildings).where(eq(sectBuildings.sectId, sect.id)).orderBy(asc(sectBuildings.positionY), asc(sectBuildings.positionX)).all(),
      db.select({
        playerId: sectMembers.playerId,
        roleKey: sectMembers.roleKey,
        playerName: players.name,
        realmName: players.realmName,
        lastSeenAt: players.lastSeenAt,
      }).from(sectMembers)
        .innerJoin(players, eq(players.id, sectMembers.playerId))
        .where(eq(sectMembers.sectId, sect.id))
        .all(),
      db.select({
        id: sectApplications.id,
        playerId: sectApplications.playerId,
        type: sectApplications.type,
        status: sectApplications.status,
        note: sectApplications.note,
        createdAt: sectApplications.createdAt,
        expiresAt: sectApplications.expiresAt,
        playerName: players.name,
      }).from(sectApplications)
        .innerJoin(players, eq(players.id, sectApplications.playerId))
        .where(and(
          eq(sectApplications.sectId, sect.id),
          eq(sectApplications.status, "pending"),
          gt(sectApplications.expiresAt, new Date().toISOString()),
          allowedPendingTypes.length > 0 ? inArray(sectApplications.type, allowedPendingTypes) : sql`false`,
        ))
        .orderBy(desc(sectApplications.createdAt))
        .all(),
      db.select({
        id: sectStorageItems.id,
        slotIndex: sectStorageItems.slotIndex,
        itemId: sectStorageItems.itemId,
        itemName: items.name,
        quantity: sectStorageItems.quantity,
      }).from(sectStorageItems)
        .leftJoin(items, eq(items.id, sectStorageItems.itemId))
        .where(eq(sectStorageItems.sectId, sect.id))
        .orderBy(asc(sectStorageItems.slotIndex))
        .all(),
    ]);
    const summary = buildSectSummaryFromAuthority(authority, membership.roleKey, memberCount, lingqiPeakLevel);

    return {
      ...basePayload,
      sect: {
        ...sect,
        roleKey: membership.roleKey,
        roleLabel: membership.roleLabel,
        summary,
        resources,
        buildings,
        members: members
          .map((row) => {
            const roleKey = normalizeRoleKey(row.roleKey);
            return {
              playerId: row.playerId,
              playerName: row.playerName,
              realmName: row.realmName,
              roleKey,
              roleLabel: getSectRoleLabel(roleKey),
              lastSeenAt: row.lastSeenAt,
            };
          })
          .sort((a, b) => getRoleIndex(a.roleKey) - getRoleIndex(b.roleKey)),
        pendingApplications,
        storage,
        permissions: authority.isGovernor ? SECT_ROLE_PERMISSION_DEFAULTS.leader : authority.permissions,
        permissionPreview: {
          innerDiscipleReviewVisitEnabled: innerDisciplePermissions.includes("review_visit"),
        },
        levelConfig: SECT_LEVEL_ORDER.map((level) => ({
          level,
          mapSize: getSectLevelConfig(level).mapSize,
          memberLimit: getSectLevelConfig(level).memberLimit,
        })),
      },
    };
  });
}
