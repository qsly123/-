import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  maps,
  sectBuildings,
  sectResources,
  sectRolePermissions,
  sects,
} from "@/db/schema";
import type { SectBuildingType, SectPermissionKey, SectRoleKey, TileData } from "@/types/game";
import { acquireSectMutationLock, ensureSectFeatureReady, getSectCore, requireSectMembership, requireSectPermission, resolveSectPermissionSet } from "@/modules/sect/services/sect-service";
import { buildSectHomePortalId, ensureSectHomeMapFixedPortals } from "@/modules/sect/services/sect-map-service";
import { publishMapStructureChanged } from "@/modules/map/services/map-structure-invalidation";

function toSafeInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function replaceTile(tilesData: TileData[] | null | undefined, tile: TileData) {
  const nextTiles = Array.isArray(tilesData) ? [...tilesData] : [];
  const targetIndex = nextTiles.findIndex((entry) => entry.x === tile.x && entry.y === tile.y);
  if (targetIndex >= 0) {
    nextTiles[targetIndex] = tile;
    return nextTiles;
  }
  nextTiles.push(tile);
  return nextTiles;
}

export async function mutateSectBuildingState(params: {
  playerId: string;
  action: "upgrade_lingqi_peak" | "update_announcement" | "toggle_permission";
  roleKey?: SectRoleKey;
  permissionKey?: SectPermissionKey;
  enabled?: boolean;
  announcement?: string;
}) {
  await ensureSectFeatureReady();
  const membership = await requireSectMembership(params.playerId);
  const sect = await getSectCore(membership.sectId);
  if (!sect) {
    throw new Error("宗门数据不存在");
  }
  const authority = await resolveSectPermissionSet(membership.sectId, membership.roleKey, params.playerId);

  const nowIso = new Date().toISOString();
  if (params.action === "update_announcement") {
    await requireSectPermission(params.playerId, "manage_notice");
    await db.update(sects).set({
      announcement: params.announcement?.trim() || "",
      updatedAt: nowIso,
    }).where(eq(sects.id, sect.id)).run();
    return;
  }

  if (params.action === "toggle_permission") {
    if (!authority.isGovernor) {
      throw new Error("只有宗主可调整细项权限");
    }
    if (!params.roleKey || !params.permissionKey) {
      throw new Error("缺少权限参数");
    }
    await db.insert(sectRolePermissions).values({
      sectId: sect.id,
      roleKey: params.roleKey,
      permissionKey: params.permissionKey,
      enabled: params.enabled !== false,
      updatedAt: nowIso,
    }).onConflictDoUpdate({
      target: [
        sectRolePermissions.sectId,
        sectRolePermissions.roleKey,
        sectRolePermissions.permissionKey,
      ],
      set: {
        enabled: params.enabled !== false,
        updatedAt: nowIso,
      },
    }).run();
    return;
  }

  await requireSectPermission(params.playerId, "manage_buildings");
  const lingqiPeak = await db.select().from(sectBuildings)
    .where(and(
      eq(sectBuildings.sectId, sect.id),
      eq(sectBuildings.buildingType, "lingqi_peak"),
    ))
    .get();
  if (!lingqiPeak) {
    throw new Error("灵气峰不存在");
  }
  if (lingqiPeak.level >= 5) {
    throw new Error("灵气峰已满级");
  }

  await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, sect.id);
    const freshLingqiPeak = await tx.select().from(sectBuildings)
      .where(and(
        eq(sectBuildings.sectId, sect.id),
        eq(sectBuildings.buildingType, "lingqi_peak"),
      ))
      .get();
    const resources = await tx.select().from(sectResources).where(eq(sectResources.sectId, sect.id)).get();
    if (!freshLingqiPeak || !resources) {
      throw new Error("宗门数据不存在");
    }
    if (freshLingqiPeak.level >= 5) {
      throw new Error("灵气峰已满级");
    }
    const nextLevel = freshLingqiPeak.level + 1;
    const spiritStoneCost = 600 * nextLevel;
    const sectMaterialCost = 40 * nextLevel;
    if (resources.spiritStone < spiritStoneCost || resources.sectMaterial < sectMaterialCost) {
      throw new Error("宗门资源不足");
    }
    await tx.update(sectBuildings).set({
      level: freshLingqiPeak.level + 1,
      updatedAt: nowIso,
    }).where(and(
      eq(sectBuildings.sectId, sect.id),
      eq(sectBuildings.buildingType, "lingqi_peak"),
    )).run();
    await tx.update(sectResources).set({
      spiritStone: resources.spiritStone - spiritStoneCost,
      sectMaterial: resources.sectMaterial - sectMaterialCost,
      updatedAt: nowIso,
    }).where(eq(sectResources.sectId, sect.id)).run();
  });
}

export async function mutateSectMap(params: {
  playerId: string;
  action: "move_building" | "paint_tile" | "update_portal_meta";
  buildingType?: SectBuildingType;
  positionX?: number;
  positionY?: number;
  tileType?: "road" | "decor" | "grass" | "forest";
  description?: string;
  portalName?: string;
}) {
  await ensureSectFeatureReady();
  const membership = await requireSectPermission(params.playerId, "edit_map");
  const sect = await getSectCore(membership.sectId);
  if (!sect) {
    throw new Error("宗门不存在");
  }
  const map = await db.select().from(maps).where(eq(maps.id, sect.homeMapId)).get();
  if (!map) {
    throw new Error("宗门地图不存在");
  }

  const tilesData = Array.isArray(map.tilesData) ? [...map.tilesData] : [];
  if (params.action === "update_portal_meta") {
    const hasPortal = tilesData.some((tile) => tile.portalId === buildSectHomePortalId(sect.id));
    if (!hasPortal) {
      throw new Error("宗门传送阵不存在");
    }
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, sect.id);
      const freshMap = await tx.select().from(maps).where(eq(maps.id, map.id)).get();
      if (!freshMap) {
        throw new Error("宗门地图不存在");
      }
      const freshTiles = Array.isArray(freshMap.tilesData) ? freshMap.tilesData : [];
      if (!freshTiles.some((tile) => tile.portalId === buildSectHomePortalId(sect.id))) {
        throw new Error("宗门传送阵不存在");
      }
      await tx.update(maps).set({
        tilesData: freshTiles.map((tile) => (
          tile.portalId === buildSectHomePortalId(sect.id)
            ? {
              ...tile,
              portalName: params.portalName?.trim() || tile.portalName,
              description: params.description?.trim() || tile.description,
            }
            : tile
        )),
      }).where(eq(maps.id, map.id)).run();
    });
    publishMapStructureChanged({
      mapIds: [map.id],
      source: "sect-map-update-portal-meta",
    });
    return;
  }

  const x = toSafeInt(params.positionX, 0);
  const y = toSafeInt(params.positionY, 0);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    throw new Error("地块坐标越界");
  }

  if (params.action === "paint_tile") {
    if (!params.tileType) {
      throw new Error("缺少地块类型");
    }
    const tileType = params.tileType;
    await db.transaction(async (tx) => {
      await acquireSectMutationLock(tx, sect.id);
      const freshConflictBuilding = await tx.select().from(sectBuildings)
        .where(and(
          eq(sectBuildings.sectId, sect.id),
          eq(sectBuildings.positionX, x),
          eq(sectBuildings.positionY, y),
        ))
        .get();
      if (freshConflictBuilding) {
        throw new Error("建筑所在格不可直接改造");
      }
      const freshMap = await tx.select().from(maps).where(eq(maps.id, map.id)).get();
      if (!freshMap) {
        throw new Error("宗门地图不存在");
      }
      const freshTiles = Array.isArray(freshMap.tilesData) ? freshMap.tilesData : [];
      const targetTile = freshTiles.find((tile) => tile.x === x && tile.y === y);
      if (targetTile?.type === "portal") {
        throw new Error("固定传送阵不可改造");
      }
      await tx.update(maps).set({
        tilesData: replaceTile(freshTiles, {
          x,
          y,
          type: tileType,
          walkable: true,
          description: params.description?.trim() || undefined,
        }),
      }).where(eq(maps.id, map.id)).run();
    });
    publishMapStructureChanged({
      mapIds: [map.id],
      source: "sect-map-paint-tile",
    });
    return;
  }

  if (!params.buildingType) {
    throw new Error("缺少建筑类型");
  }

  const building = await db.select().from(sectBuildings)
    .where(and(
      eq(sectBuildings.sectId, sect.id),
      eq(sectBuildings.buildingType, params.buildingType),
    ))
    .get();
  if (!building) {
    throw new Error("建筑不存在");
  }
  if (params.buildingType === "portal") {
    throw new Error("宗门传送阵不可移动");
  }
  const nowIso = new Date().toISOString();

  await db.transaction(async (tx) => {
    await acquireSectMutationLock(tx, sect.id);
    const freshMap = await tx.select().from(maps).where(eq(maps.id, map.id)).get();
    const freshBuilding = await tx.select().from(sectBuildings)
      .where(and(
        eq(sectBuildings.sectId, sect.id),
        eq(sectBuildings.buildingType, params.buildingType!),
      ))
      .get();
    const freshConflictBuilding = await tx.select().from(sectBuildings)
      .where(and(
        eq(sectBuildings.sectId, sect.id),
        eq(sectBuildings.positionX, x),
        eq(sectBuildings.positionY, y),
      ))
      .get();
    if (!freshMap || !freshBuilding) {
      throw new Error("宗门地图或建筑不存在");
    }
    const freshTiles = Array.isArray(freshMap.tilesData) ? freshMap.tilesData : [];
    const targetTile = freshTiles.find((tile) => tile.x === x && tile.y === y);
    if (
      targetTile?.walkable === false
      || targetTile?.type === "mountain"
      || targetTile?.type === "water"
      || targetTile?.type === "portal"
    ) {
      throw new Error("目标地块不可放置建筑");
    }
    if (freshConflictBuilding && freshConflictBuilding.buildingType !== freshBuilding.buildingType) {
      throw new Error("目标地块已有建筑或传送阵");
    }
    const cleanedTiles = freshTiles.map((tile) => (
      tile.x === freshBuilding.positionX && tile.y === freshBuilding.positionY && tile.type === "building"
        ? {
          x: tile.x,
          y: tile.y,
          type: "road",
          walkable: true,
          description: "宗门道路",
        }
        : tile
    ));
    const nextTiles = replaceTile(cleanedTiles, {
      x,
      y,
      type: "building",
      walkable: true,
      description: params.description?.trim() || freshBuilding.description || undefined,
    });
    await tx.update(sectBuildings).set({
      positionX: x,
      positionY: y,
      updatedAt: nowIso,
    }).where(and(
      eq(sectBuildings.sectId, sect.id),
      eq(sectBuildings.buildingType, params.buildingType!),
    )).run();
    await tx.update(maps).set({
      tilesData: nextTiles,
    }).where(eq(maps.id, map.id)).run();
  });
  publishMapStructureChanged({
    mapIds: [map.id],
    source: "sect-map-move-building",
  });
}

export async function getSectEditSnapshot(playerId: string) {
  const membership = await requireSectPermission(playerId, "edit_map");
  const sect = await getSectCore(membership.sectId);
  if (!sect) {
    throw new Error("宗门不存在");
  }
  await ensureSectHomeMapFixedPortals({
    sectId: sect.id,
    sectName: sect.name,
    homeMapId: sect.homeMapId,
    externalMapId: sect.externalMapId,
    externalMapName: null,
  });
  const map = await db.select().from(maps).where(eq(maps.id, sect.homeMapId)).get();
  const buildings = await db.select().from(sectBuildings)
    .where(eq(sectBuildings.sectId, sect.id))
    .orderBy(asc(sectBuildings.positionY), asc(sectBuildings.positionX))
    .all();
  if (!map) {
    throw new Error("宗门地图不存在");
  }
  return {
    sectId: sect.id,
    sectName: sect.name,
    map: {
      id: map.id,
      width: map.width,
      height: map.height,
      tilesData: Array.isArray(map.tilesData) ? map.tilesData : [],
    },
    buildings,
  };
}
