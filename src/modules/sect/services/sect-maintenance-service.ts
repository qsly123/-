import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  maps,
  players,
  sectApplications,
  sectBuildings,
  sectLogs,
  sectMembers,
  sectResources,
  sectRolePermissions,
  sectStorageItems,
  sects,
} from "@/db/schema";
import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { removeSectEntryPortal } from "@/modules/sect/services/sect-map-service";
import { publishMapStructureChanged } from "@/modules/map/services/map-structure-invalidation";

const EMPTY_SECT_CLEANUP_HOURS = 24;
const MAINTENANCE_THROTTLE_MS = 5 * 60 * 1000;

let lastSectMaintenanceAt = 0;
let runningSectMaintenancePromise: Promise<void> | null = null;

function buildCleanupDeadline(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function acquireSectCleanupLock(executor: Pick<typeof db, "execute">, sectId: string) {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`sect-cleanup:${sectId}`}))`);
}

async function deleteExpiredEmptySect(sectId: string) {
  const gameStartConfig = await getGameStartConfig();
  const changedMapIds = new Set<string>();

  await db.transaction(async (tx) => {
    await acquireSectCleanupLock(tx, sectId);

    const sect = await tx.select({
      id: sects.id,
      name: sects.name,
      externalMapId: sects.externalMapId,
      externalPositionX: sects.externalPositionX,
      externalPositionY: sects.externalPositionY,
      homeMapId: sects.homeMapId,
      emptySinceAt: sects.emptySinceAt,
    }).from(sects).where(eq(sects.id, sectId)).get();

    if (!sect || !sect.emptySinceAt) {
      return;
    }

    const memberCountRow = await tx.select({
      total: sql<number>`count(*)::int`,
    }).from(sectMembers).where(eq(sectMembers.sectId, sectId)).get();
    const memberCount = Number(memberCountRow?.total || 0);
    if (memberCount > 0) {
      await tx.update(sects).set({
        emptySinceAt: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(sects.id, sectId)).run();
      return;
    }

    const externalMap = await tx.select({
      id: maps.id,
      tilesData: maps.tilesData,
    }).from(maps).where(eq(maps.id, sect.externalMapId)).get();

    if (externalMap) {
      await tx.update(maps).set({
        tilesData: removeSectEntryPortal({
          tilesData: externalMap.tilesData,
          sectId,
          positionX: sect.externalPositionX,
          positionY: sect.externalPositionY,
        }),
      }).where(eq(maps.id, externalMap.id)).run();
      changedMapIds.add(externalMap.id);
    }

    await tx.update(players).set({
      currentMapId: externalMap?.id || gameStartConfig.mapId,
      currentMapInstanceId: null,
      positionX: externalMap ? sect.externalPositionX : gameStartConfig.positionX,
      positionY: externalMap ? sect.externalPositionY : gameStartConfig.positionY,
      updatedAt: new Date().toISOString(),
    }).where(eq(players.currentMapId, sect.homeMapId)).run();

    await tx.delete(sectRolePermissions).where(eq(sectRolePermissions.sectId, sectId)).run();
    await tx.delete(sectApplications).where(eq(sectApplications.sectId, sectId)).run();
    await tx.delete(sectBuildings).where(eq(sectBuildings.sectId, sectId)).run();
    await tx.delete(sectResources).where(eq(sectResources.sectId, sectId)).run();
    await tx.delete(sectStorageItems).where(eq(sectStorageItems.sectId, sectId)).run();
    await tx.delete(sectLogs).where(eq(sectLogs.sectId, sectId)).run();
    await tx.delete(sects).where(eq(sects.id, sectId)).run();
    await tx.delete(maps).where(eq(maps.id, sect.homeMapId)).run();
    changedMapIds.add(sect.homeMapId);
  });
  publishMapStructureChanged({
    mapIds: Array.from(changedMapIds),
    source: "sect-empty-cleanup",
  });
}

export async function cleanupExpiredEmptySects(limit = 3) {
  const deadline = buildCleanupDeadline(EMPTY_SECT_CLEANUP_HOURS);
  const candidates = await db.select({
    id: sects.id,
  }).from(sects)
    .where(and(
      isNotNull(sects.emptySinceAt),
      lte(sects.emptySinceAt, deadline),
    ))
    .orderBy(asc(sects.emptySinceAt))
    .limit(limit);

  for (const candidate of candidates) {
    try {
      await deleteExpiredEmptySect(candidate.id);
    } catch (error) {
      console.error("[sect][maintenance] 空宗门清理失败", candidate.id, error);
    }
  }
}

export async function runSectMaintenanceIfDue() {
  const now = Date.now();
  if (runningSectMaintenancePromise) {
    return runningSectMaintenancePromise;
  }
  if (now - lastSectMaintenanceAt < MAINTENANCE_THROTTLE_MS) {
    return;
  }

  runningSectMaintenancePromise = (async () => {
    try {
      await cleanupExpiredEmptySects();
    } finally {
      lastSectMaintenanceAt = Date.now();
      runningSectMaintenancePromise = null;
    }
  })();

  return runningSectMaintenancePromise;
}
