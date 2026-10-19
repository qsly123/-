import { asc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { mapEdges, maps, temporaryMaps, worldMapInstances } from "@/db/schema";
import type { TileData } from "@/types/game";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";
import { ensureOpenWorldBootstrap, listOpenWorldMaps } from "@/modules/world/services/world-map-service";
import {
  OPEN_WORLD_PORTAL_IMAGE_URL,
  getOpenWorldEntranceConfig,
} from "@/modules/world/services/world-config";

export type RuntimeMapRecord = {
  id: string;
  name: string;
  description: string | null;
  backgroundImageUrl: string | null;
  width: number;
  height: number;
  minRealm: number;
  mapType: string;
  tilesData: TileData[] | null;
  createdAt: string;
  updatedAt: string | null;
  isTemporary: boolean;
  runtimeSource: "map" | "temporary" | "world";
};

const OPEN_WORLD_ENTRANCE_SOURCE_PORTAL_ID = "portal_open_world_gateway";
const OPEN_WORLD_ENTRANCE_RETURN_PORTAL_ID = "portal_open_world_return";

type RuntimePortalContext = {
  sourceMapId: string;
  sourceMapName: string;
  sourceAnchorX: number;
  sourceAnchorY: number;
  targetMapId: string;
  targetMapName: string;
};

function toRuntimeMapRecord(
  row: {
    id: string;
    name: string;
    description: string | null;
    backgroundImageUrl: string | null;
    width: number;
    height: number;
    minRealm: number;
    mapType: string;
    tilesData: TileData[] | null;
    createdAt: string;
    updatedAt?: string | null;
  },
  runtimeSource: "map" | "temporary" | "world",
): RuntimeMapRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    backgroundImageUrl: row.backgroundImageUrl,
    width: row.width,
    height: row.height,
    minRealm: row.minRealm,
    mapType: row.mapType,
    tilesData: row.tilesData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
    isTemporary: runtimeSource === "temporary",
    runtimeSource,
  };
}

function listPortalTiles(tilesData: TileData[] | null | undefined) {
  if (!Array.isArray(tilesData)) {
    return [];
  }

  return tilesData.filter((tile) => tile?.type === "portal");
}

function hasMissingPortalTargetMapId(tilesData: TileData[] | null | undefined) {
  return listPortalTiles(tilesData).some((tile) => !String(tile.portalTargetMapId || "").trim());
}

function clampPosition(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isSyntheticPortalBlocked(tile: TileData | undefined) {
  if (!tile) {
    return false;
  }
  if (tile.type === "portal") {
    return true;
  }
  if (tile.walkable === false) {
    return true;
  }
  return tile.type === "water" || tile.type === "mountain" || tile.type === "building";
}

function pickSyntheticPortalPosition(params: {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  tilesData: TileData[] | null;
}) {
  const { width, height, anchorX, anchorY, tilesData } = params;
  const tileMap = new Map<string, TileData>();
  for (const tile of tilesData || []) {
    tileMap.set(`${tile.x},${tile.y}`, tile);
  }

  const candidates: Array<readonly [number, number]> = [
    [anchorX + 2, anchorY],
    [anchorX + 1, anchorY],
    [anchorX + 2, anchorY - 1],
    [anchorX + 1, anchorY - 1],
    [anchorX, anchorY - 1],
    [anchorX + 3, anchorY],
    [anchorX + 2, anchorY + 1],
  ];

  for (const [rawX, rawY] of candidates) {
    const x = clampPosition(rawX, 0, Math.max(0, width - 1));
    const y = clampPosition(rawY, 0, Math.max(0, height - 1));
    const tile = tileMap.get(`${x},${y}`);
    if (!isSyntheticPortalBlocked(tile)) {
      return { x, y };
    }
  }

  let fallback: { x: number; y: number; distance: number } | null = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tileMap.get(`${x},${y}`);
      if (isSyntheticPortalBlocked(tile)) {
        continue;
      }
      const distance = Math.abs(x - anchorX) + Math.abs(y - anchorY);
      if (!fallback || distance < fallback.distance) {
        fallback = { x, y, distance };
      }
    }
  }

  if (fallback) {
    return {
      x: fallback.x,
      y: fallback.y,
    };
  }

  return null;
}

function upsertSyntheticPortalTile(tilesData: TileData[] | null, tile: TileData) {
  const baseTiles = Array.isArray(tilesData) ? tilesData : [];
  const filteredTiles = baseTiles.filter((entry) => !(entry.x === tile.x && entry.y === tile.y));
  return [...filteredTiles, tile];
}

async function loadOpenWorldEntranceContext(): Promise<RuntimePortalContext | null> {
  if (!(await ensureOpenWorldSchema())) {
    return null;
  }

  const entranceConfig = await getOpenWorldEntranceConfig();
  const sourceMapId = String(entranceConfig.mapId || "").trim();
  if (!sourceMapId) {
    return null;
  }

  const [sourceMap, worldMaps, fallbackTargetWorldMap] = await Promise.all([
    db.select({
      id: maps.id,
      name: maps.name,
    }).from(maps).where(eq(maps.id, sourceMapId)).get(),
    listOpenWorldMaps().catch(() => []),
    db.select({
      id: worldMapInstances.id,
      name: worldMapInstances.name,
    }).from(worldMapInstances)
      .orderBy(asc(worldMapInstances.createdAt))
      .limit(1)
      .get(),
  ]);
  const targetWorldMap = worldMaps.find((entry) => entry.heatTier === "hot")
    || worldMaps[0]
    || fallbackTargetWorldMap;

  if (!sourceMap || !targetWorldMap) {
    return null;
  }

  return {
    sourceMapId: sourceMap.id,
    sourceMapName: sourceMap.name,
    sourceAnchorX: entranceConfig.positionX,
    sourceAnchorY: entranceConfig.positionY,
    targetMapId: targetWorldMap.id,
    targetMapName: targetWorldMap.name,
  };
}

async function injectOpenWorldEntrancePortals(
  record: RuntimeMapRecord,
  entranceContextInput?: RuntimePortalContext | null,
): Promise<RuntimeMapRecord> {
  const entranceContext = entranceContextInput === undefined
    ? await loadOpenWorldEntranceContext()
    : entranceContextInput;
  if (!entranceContext) {
    return record;
  }

  if (record.id === entranceContext.sourceMapId) {
    const position = pickSyntheticPortalPosition({
      width: record.width,
      height: record.height,
      anchorX: entranceContext.sourceAnchorX,
      anchorY: entranceContext.sourceAnchorY,
      tilesData: record.tilesData,
    });
    if (!position) {
      return record;
    }

    return {
      ...record,
      tilesData: upsertSyntheticPortalTile(record.tilesData, {
        x: position.x,
        y: position.y,
        type: "portal",
        walkable: true,
        description: `通往${entranceContext.targetMapName}的天道界门，踏入后可进入开放世界。`,
        imageUrl: OPEN_WORLD_PORTAL_IMAGE_URL,
        portalId: OPEN_WORLD_ENTRANCE_SOURCE_PORTAL_ID,
        portalName: "天道界门",
        portalTargetMapId: entranceContext.targetMapId,
        portalTargetPortalId: OPEN_WORLD_ENTRANCE_RETURN_PORTAL_ID,
        portalTargetName: entranceContext.targetMapName,
      }),
    };
  }

  if (record.id === entranceContext.targetMapId) {
    const position = pickSyntheticPortalPosition({
      width: record.width,
      height: record.height,
      anchorX: Math.floor(record.width / 2),
      anchorY: Math.floor(record.height / 2),
      tilesData: record.tilesData,
    });
    if (!position) {
      return record;
    }

    return {
      ...record,
      tilesData: upsertSyntheticPortalTile(record.tilesData, {
        x: position.x,
        y: position.y,
        type: "portal",
        walkable: true,
        description: `返尘阵可回到${entranceContext.sourceMapName}，便于往返开放世界与现世地图。`,
        imageUrl: OPEN_WORLD_PORTAL_IMAGE_URL,
        portalId: OPEN_WORLD_ENTRANCE_RETURN_PORTAL_ID,
        portalName: "返尘阵",
        portalTargetMapId: entranceContext.sourceMapId,
        portalTargetPortalId: OPEN_WORLD_ENTRANCE_SOURCE_PORTAL_ID,
        portalTargetName: entranceContext.sourceMapName,
      }),
    };
  }

  return record;
}

async function repairLegacyPortalTiles<T extends {
  id: string;
  name: string;
  tilesData: TileData[] | null;
}>(row: T): Promise<T> {
  if (!hasMissingPortalTargetMapId(row.tilesData)) {
    return row;
  }

  const edges = await db.select({
    mapAId: mapEdges.mapAId,
    mapBId: mapEdges.mapBId,
  }).from(mapEdges).where(or(eq(mapEdges.mapAId, row.id), eq(mapEdges.mapBId, row.id))).all();
  const connectedMapIds = Array.from(new Set(edges.map((edge) => (
    edge.mapAId === row.id ? edge.mapBId : edge.mapAId
  )).filter(Boolean)));

  if (connectedMapIds.length === 0) {
    return row;
  }

  const connectedMaps = await db.select({
    id: maps.id,
    name: maps.name,
    tilesData: maps.tilesData,
  }).from(maps).where(inArray(maps.id, connectedMapIds)).all();

  const candidates = connectedMaps.flatMap((connectedMap) => {
    const reversePortals = listPortalTiles(connectedMap.tilesData)
      .filter((tile) => String(tile.portalTargetMapId || "").trim() === row.id);

    return reversePortals.map((tile) => ({
      targetMapId: connectedMap.id,
      targetMapName: connectedMap.name,
      localPortalId: String(tile.portalTargetPortalId || "").trim() || undefined,
      localPortalName: String(tile.portalTargetName || "").trim() || undefined,
      localImageUrl: tile.imageUrl || undefined,
      targetPortalId: String(tile.portalId || "").trim() || undefined,
      targetPortalName: String(tile.portalName || "").trim() || connectedMap.name,
    }));
  });

  if (candidates.length === 0 || !Array.isArray(row.tilesData)) {
    return row;
  }

  const unusedCandidates = [...candidates];
  const repairedTiles = row.tilesData.map((tile) => {
    if (tile?.type !== "portal" || String(tile.portalTargetMapId || "").trim()) {
      return tile;
    }

    const descriptionText = `${tile.portalName || ""} ${tile.description || ""}`;
    const matchedIndex = unusedCandidates.findIndex((candidate) => (
      descriptionText.includes(candidate.targetMapName)
    ));
    const fallbackIndex = matchedIndex >= 0
      ? matchedIndex
      : (unusedCandidates.length === 1 ? 0 : -1);

    if (fallbackIndex < 0) {
      return tile;
    }

    const candidate = unusedCandidates.splice(fallbackIndex, 1)[0];
    return {
      ...tile,
      portalId: tile.portalId || candidate.localPortalId,
      portalName: tile.portalName || candidate.localPortalName,
      imageUrl: tile.imageUrl || candidate.localImageUrl,
      portalTargetMapId: candidate.targetMapId,
      portalTargetPortalId: candidate.targetPortalId,
      portalTargetName: candidate.targetPortalName,
    };
  });

  return {
    ...row,
    tilesData: repairedTiles,
  };
}

async function finalizeRuntimeMapRecord(
  record: RuntimeMapRecord,
  entranceContext?: RuntimePortalContext | null,
): Promise<RuntimeMapRecord> {
  let nextRecord = record;

  if (record.runtimeSource === "map") {
    nextRecord = toRuntimeMapRecord(
      await repairLegacyPortalTiles({
        id: record.id,
        name: record.name,
        description: record.description,
        backgroundImageUrl: record.backgroundImageUrl,
        width: record.width,
        height: record.height,
        minRealm: record.minRealm,
        mapType: record.mapType,
        tilesData: record.tilesData,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
      "map",
    );
  }

  return injectOpenWorldEntrancePortals(nextRecord, entranceContext);
}

export async function getRuntimeMapById(mapId: string): Promise<RuntimeMapRecord | null> {
  const temporaryMap = await db.select({
    id: temporaryMaps.id,
    name: temporaryMaps.name,
    description: temporaryMaps.description,
    backgroundImageUrl: temporaryMaps.backgroundImageUrl,
    width: temporaryMaps.width,
    height: temporaryMaps.height,
    minRealm: temporaryMaps.minRealm,
    mapType: temporaryMaps.mapType,
    tilesData: temporaryMaps.tilesData,
    createdAt: temporaryMaps.createdAt,
    updatedAt: temporaryMaps.updatedAt,
  }).from(temporaryMaps).where(eq(temporaryMaps.id, mapId)).get();
  if (temporaryMap) {
    return finalizeRuntimeMapRecord(toRuntimeMapRecord(temporaryMap, "temporary"));
  }

  if (await ensureOpenWorldBootstrap()) {
    const worldMap = await db.select({
      id: worldMapInstances.id,
      name: worldMapInstances.name,
      description: worldMapInstances.description,
      backgroundImageUrl: worldMapInstances.backgroundImageUrl,
      width: worldMapInstances.width,
      height: worldMapInstances.height,
      minRealm: worldMapInstances.minRealm,
      mapType: worldMapInstances.archetype,
      tilesData: worldMapInstances.tilesData,
      createdAt: worldMapInstances.createdAt,
      updatedAt: worldMapInstances.updatedAt,
    }).from(worldMapInstances).where(eq(worldMapInstances.id, mapId)).get();
    if (worldMap) {
      return finalizeRuntimeMapRecord(toRuntimeMapRecord({
        ...worldMap,
        mapType: "open_world",
      }, "world"));
    }
  }

  const normalMap = await db.select({
    id: maps.id,
    name: maps.name,
    description: maps.description,
    backgroundImageUrl: maps.backgroundImageUrl,
    width: maps.width,
    height: maps.height,
    minRealm: maps.minRealm,
    mapType: maps.mapType,
    tilesData: maps.tilesData,
    createdAt: maps.createdAt,
  }).from(maps).where(eq(maps.id, mapId)).get();
  if (!normalMap) {
    return null;
  }

  return finalizeRuntimeMapRecord(toRuntimeMapRecord(normalMap, "map"));
}

export async function listRuntimeMapsByIds(mapIds: string[]): Promise<RuntimeMapRecord[]> {
  const uniqueIds = Array.from(new Set(mapIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }

  const openWorldSchemaReady = await ensureOpenWorldBootstrap();
  const [temporaryRows, worldRows, normalRows] = await Promise.all([
    db.select({
      id: temporaryMaps.id,
      name: temporaryMaps.name,
      description: temporaryMaps.description,
      backgroundImageUrl: temporaryMaps.backgroundImageUrl,
      width: temporaryMaps.width,
      height: temporaryMaps.height,
      minRealm: temporaryMaps.minRealm,
      mapType: temporaryMaps.mapType,
      tilesData: temporaryMaps.tilesData,
      createdAt: temporaryMaps.createdAt,
      updatedAt: temporaryMaps.updatedAt,
    }).from(temporaryMaps).where(inArray(temporaryMaps.id, uniqueIds)).all(),
    openWorldSchemaReady
      ? db.select({
        id: worldMapInstances.id,
        name: worldMapInstances.name,
        description: worldMapInstances.description,
        backgroundImageUrl: worldMapInstances.backgroundImageUrl,
        width: worldMapInstances.width,
        height: worldMapInstances.height,
        minRealm: worldMapInstances.minRealm,
        mapType: worldMapInstances.archetype,
        tilesData: worldMapInstances.tilesData,
        createdAt: worldMapInstances.createdAt,
        updatedAt: worldMapInstances.updatedAt,
      }).from(worldMapInstances).where(inArray(worldMapInstances.id, uniqueIds)).all()
      : Promise.resolve([]),
    db.select({
      id: maps.id,
      name: maps.name,
      description: maps.description,
      backgroundImageUrl: maps.backgroundImageUrl,
      width: maps.width,
      height: maps.height,
      minRealm: maps.minRealm,
      mapType: maps.mapType,
      tilesData: maps.tilesData,
      createdAt: maps.createdAt,
    }).from(maps).where(inArray(maps.id, uniqueIds)).all(),
  ] as const);

  const entranceContext = await loadOpenWorldEntranceContext();
  const resultMap = new Map<string, RuntimeMapRecord>();
  const finalizedRows = await Promise.all([
    ...temporaryRows.map(async (row) => finalizeRuntimeMapRecord(toRuntimeMapRecord(row, "temporary"), entranceContext)),
    ...worldRows.map(async (row) => finalizeRuntimeMapRecord(toRuntimeMapRecord({
      ...row,
      mapType: "open_world",
    }, "world"), entranceContext)),
    ...normalRows.map(async (row) => finalizeRuntimeMapRecord(toRuntimeMapRecord(row, "map"), entranceContext)),
  ]);

  finalizedRows.forEach((row) => {
    if (!resultMap.has(row.id)) {
      resultMap.set(row.id, row);
    }
  });

  return uniqueIds
    .map((mapId) => resultMap.get(mapId) || null)
    .filter((row): row is RuntimeMapRecord => Boolean(row));
}
