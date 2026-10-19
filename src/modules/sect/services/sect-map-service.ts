import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { maps, monsters, npcs, sects } from "@/db/schema";
import type { TileData } from "@/types/game";
import { SECT_BUILDING_DEFAULTS, SECT_LEVEL_CONFIG } from "@/modules/sect/services/sect-constants";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { getGameStartConfig } from "@/modules/character/services/game-start-config";
import { publishMapStructureChanged } from "@/modules/map/services/map-structure-invalidation";

export const SECT_HOME_START_SPAWN_PORTAL_ID = "__game_start_spawn__";

export function buildSectHomePortalId(sectId: string) {
  return `sect_home_portal_${sectId}`;
}

export function buildSectEntryPortalId(sectId: string) {
  return `sect_entry_portal_${sectId}`;
}

export function buildSectHomeStartPortalId(sectId: string) {
  return `sect_home_start_portal_${sectId}`;
}

function buildTileKey(x: number, y: number) {
  return `${x},${y}`;
}

function getChebyshevDistance(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function cloneTiles(tilesData: TileData[] | null | undefined) {
  return Array.isArray(tilesData) ? tilesData.map((tile) => ({ ...tile })) : [];
}

function setTile(tilesData: TileData[], tile: TileData) {
  const next = tilesData.filter((entry) => !(entry.x === tile.x && entry.y === tile.y));
  next.push(tile);
  return next;
}

function upsertPortalTile(tilesData: TileData[], tile: TileData) {
  const next = tilesData.filter((entry) => entry.portalId !== tile.portalId && !(entry.x === tile.x && entry.y === tile.y));
  next.push(tile);
  return next;
}

function isPlacementTileBlocked(tile: TileData | undefined) {
  if (!tile) {
    return false;
  }
  if (tile.walkable === false) {
    return true;
  }
  if (tile.eventId) {
    return true;
  }
  return tile.type === "building" || tile.type === "portal" || tile.type === "water" || tile.type === "mountain";
}

export async function validateSectPlacement(params: {
  mapId: string;
  positionX: number;
  positionY: number;
  currentSectId?: string | null;
}) {
  const runtimeMap = await getRuntimeMapById(params.mapId);
  if (!runtimeMap || runtimeMap.runtimeSource !== "map") {
    throw new Error("这里只是临时场景，不能立宗。请前往城镇、山野这类常驻地图选址");
  }
  if (runtimeMap.mapType === "open_world" || runtimeMap.mapType === "secret_realm_instance" || runtimeMap.mapType === "sect") {
    throw new Error("当前地图不能立宗。请前往城镇、山野这类常驻地图选址");
  }

  const x = Math.floor(params.positionX);
  const y = Math.floor(params.positionY);
  if (x < 0 || y < 0 || x >= runtimeMap.width || y >= runtimeMap.height) {
    throw new Error("宗门入口坐标超出地图范围");
  }

  const tileMap = new Map<string, TileData>();
  for (const tile of cloneTiles(runtimeMap.tilesData)) {
    tileMap.set(buildTileKey(tile.x, tile.y), tile);
  }
  const currentTile = tileMap.get(buildTileKey(x, y));
  if (isPlacementTileBlocked(currentTile)) {
    throw new Error("当前地块不可立宗，请选择空旷可通行地块");
  }

  for (const tile of tileMap.values()) {
    if (tile.type !== "portal") {
      continue;
    }
    if (getChebyshevDistance(tile.x, tile.y, x, y) <= 4) {
      throw new Error("距离现有传送点过近，需避开 4 格以上");
    }
  }

  const [existingSects, mapNpcs, mapMonsters] = await Promise.all([
    db.select({
      id: sects.id,
      externalPositionX: sects.externalPositionX,
      externalPositionY: sects.externalPositionY,
    }).from(sects)
      .where(and(
        eq(sects.externalMapId, params.mapId),
        params.currentSectId ? ne(sects.id, params.currentSectId) : undefined,
      ) as never)
      .all(),
    db.select({
      positionX: npcs.positionX,
      positionY: npcs.positionY,
    }).from(npcs)
      .where(eq(npcs.mapId, params.mapId))
      .all(),
    db.select({
      positionX: monsters.positionX,
      positionY: monsters.positionY,
    }).from(monsters)
      .where(eq(monsters.mapId, params.mapId))
      .all(),
  ]);

  for (const sect of existingSects) {
    if (getChebyshevDistance(sect.externalPositionX, sect.externalPositionY, x, y) <= 8) {
      throw new Error("距离其他宗门入口过近，需避开 8 格以上");
    }
  }
  if (mapNpcs.some((row) => row.positionX === x && row.positionY === y)) {
    throw new Error("宗门入口不能覆盖 NPC");
  }
  if (mapMonsters.some((row) => row.positionX === x && row.positionY === y)) {
    throw new Error("宗门入口不能覆盖怪物");
  }

  return {
    map: runtimeMap,
    positionX: x,
    positionY: y,
  };
}

function buildSectBaseTerrain(size: number) {
  const tiles: TileData[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const isEdge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      if (isEdge) {
        tiles.push({
          x,
          y,
          type: "mountain",
          walkable: false,
          description: "宗门边界",
        });
      }
    }
  }
  return tiles;
}

function carveSectRoads(size: number, tiles: TileData[]) {
  const center = Math.floor(size / 2);
  let nextTiles = [...tiles];
  for (let i = 1; i < size - 1; i += 1) {
    nextTiles = setTile(nextTiles, { x: center, y: i, type: "road", walkable: true });
    nextTiles = setTile(nextTiles, { x: i, y: center, type: "road", walkable: true });
  }
  return nextTiles;
}

function placeSectBuildings(params: {
  sectId: string;
  sectName: string;
  size: number;
}) {
  const center = Math.floor(params.size / 2);
  const buildings = SECT_BUILDING_DEFAULTS.map((building) => {
    const clampedX = Math.max(1, Math.min(params.size - 2, building.positionX));
    const clampedY = Math.max(1, Math.min(params.size - 2, building.positionY));
    if (building.buildingType === "main_hall") {
      return { ...building, positionX: center, positionY: center };
    }
    if (building.buildingType === "portal") {
      return { ...building, positionX: 1, positionY: params.size - 2 };
    }
    return { ...building, positionX: clampedX, positionY: clampedY };
  });

  const portalBuilding = buildings.find((item) => item.buildingType === "portal");
  const tiles = buildings.map<TileData>((building) => {
    if (building.buildingType === "portal") {
      return {
        x: building.positionX,
        y: building.positionY,
        type: "portal",
        walkable: true,
        description: `${params.sectName}传送阵`,
        portalId: buildSectHomePortalId(params.sectId),
        portalName: `${params.sectName}传送阵`,
      };
    }
    return {
      x: building.positionX,
      y: building.positionY,
      type: "building",
      walkable: true,
      description: building.description,
    };
  });

  return {
    buildings,
    tiles,
    portalPosition: portalBuilding
      ? { x: portalBuilding.positionX, y: portalBuilding.positionY }
      : { x: 1, y: params.size - 2 },
  };
}

export function ensureSectHomeFixedPortalsInTiles(params: {
  tilesData: TileData[] | null | undefined;
  sectId: string;
  sectName: string;
  size: number;
  externalMapId: string;
  externalMapName?: string;
  startMapId: string;
  startMapName?: string;
}) {
  let nextTiles = cloneTiles(params.tilesData)
    .filter((tile) => tile.portalId !== buildSectHomeStartPortalId(params.sectId));
  const homePortalTile: TileData = {
    x: 1,
    y: params.size - 2,
    type: "portal",
    walkable: true,
    description: `${params.sectName}主传送阵，可返回宗门入口或出生点`,
    portalId: buildSectHomePortalId(params.sectId),
    portalName: `${params.sectName}传送阵`,
    portalTargetMapId: params.externalMapId,
    portalTargetPortalId: buildSectEntryPortalId(params.sectId),
    portalTargetName: params.externalMapName || "宗门入口",
    portalExtraTargets: [{
      mapId: params.startMapId,
      mapName: params.startMapName || "出生点",
      portalId: SECT_HOME_START_SPAWN_PORTAL_ID,
      label: "回出生点",
    }],
  };
  nextTiles = upsertPortalTile(nextTiles, homePortalTile);
  return nextTiles;
}

export function buildSectHomeMap(params: {
  sectId: string;
  sectName: string;
  level?: 1 | 2 | 3 | 4 | 5;
  externalMapId: string;
  externalMapName: string;
  startMapId: string;
  startMapName?: string;
}) {
  const level = params.level || 1;
  const config = SECT_LEVEL_CONFIG[level];
  const size = config.mapSize;
  const baseTiles = buildSectBaseTerrain(size);
  const roadTiles = carveSectRoads(size, baseTiles);
  const buildingResult = placeSectBuildings({
    sectId: params.sectId,
    sectName: params.sectName,
    size,
  });

  let tilesData = [...roadTiles];
  for (const tile of buildingResult.tiles) {
    tilesData = setTile(tilesData, tile);
  }
  tilesData = setTile(tilesData, {
    x: size - 2,
    y: 1,
    type: "decor",
    walkable: true,
    description: "灵泉石景",
  });
  tilesData = setTile(tilesData, {
    x: size - 3,
    y: 1,
    type: "decor",
    walkable: true,
    description: "宗门石碑",
  });
  tilesData = ensureSectHomeFixedPortalsInTiles({
    tilesData,
    sectId: params.sectId,
    sectName: params.sectName,
    size,
    externalMapId: params.externalMapId,
    externalMapName: params.externalMapName,
    startMapId: params.startMapId,
    startMapName: params.startMapName,
  });

  return {
    width: size,
    height: size,
    minRealm: 1,
    mapType: "sect",
    tilesData,
    buildings: buildingResult.buildings,
  };
}

export function injectSectEntryPortal(params: {
  tilesData: TileData[] | null | undefined;
  sectId: string;
  sectName: string;
  positionX: number;
  positionY: number;
  homeMapId: string;
}) {
  return setTile(cloneTiles(params.tilesData), {
    x: params.positionX,
    y: params.positionY,
    type: "portal",
    walkable: true,
    description: `通往 ${params.sectName} 驻地`,
    portalId: buildSectEntryPortalId(params.sectId),
    portalName: `${params.sectName}入口`,
    portalTargetMapId: params.homeMapId,
    portalTargetPortalId: buildSectHomePortalId(params.sectId),
    portalTargetName: `${params.sectName}驻地`,
  });
}

export function removeSectEntryPortal(params: {
  tilesData: TileData[] | null | undefined;
  sectId: string;
  positionX?: number | null;
  positionY?: number | null;
}) {
  return cloneTiles(params.tilesData).filter((tile) => {
    if (tile.portalId === buildSectEntryPortalId(params.sectId)) {
      return false;
    }
    if (
      typeof params.positionX === "number"
      && typeof params.positionY === "number"
      && tile.x === params.positionX
      && tile.y === params.positionY
      && tile.type === "portal"
    ) {
      return false;
    }
    return true;
  });
}

export async function ensureSectHomeMapFixedPortals(params: {
  sectId: string;
  sectName: string;
  homeMapId: string;
  externalMapId: string;
  externalMapName?: string | null;
}) {
  const homeMap = await db.select({
    id: maps.id,
    width: maps.width,
    height: maps.height,
    tilesData: maps.tilesData,
  }).from(maps).where(eq(maps.id, params.homeMapId)).get();
  if (!homeMap) {
    return null;
  }

  const gameStartConfig = await getGameStartConfig();
  const nextTiles = ensureSectHomeFixedPortalsInTiles({
    tilesData: Array.isArray(homeMap.tilesData) ? homeMap.tilesData : [],
    sectId: params.sectId,
    sectName: params.sectName,
    size: Math.max(homeMap.width, homeMap.height),
    externalMapId: params.externalMapId,
    externalMapName: params.externalMapName || undefined,
    startMapId: gameStartConfig.mapId,
    startMapName: "出生点",
  });
  const previousJson = JSON.stringify(Array.isArray(homeMap.tilesData) ? homeMap.tilesData : []);
  const nextJson = JSON.stringify(nextTiles);
  if (previousJson !== nextJson) {
    await db.update(maps).set({
      mapType: "sect",
      tilesData: nextTiles,
    }).where(eq(maps.id, homeMap.id)).run();
    publishMapStructureChanged({
      mapIds: [homeMap.id],
      source: "sect-home-fixed-portals",
    });
  }

  return {
    mapId: homeMap.id,
    width: homeMap.width,
    height: homeMap.height,
    tilesData: nextTiles,
  };
}

export function expandSectMapTiles(params: {
  tilesData: TileData[] | null | undefined;
  nextSize: number;
}) {
  const nextTiles = cloneTiles(params.tilesData);
  const tileMap = new Map<string, TileData>();
  for (const tile of nextTiles) {
    tileMap.set(buildTileKey(tile.x, tile.y), { ...tile });
  }
  for (let y = 0; y < params.nextSize; y += 1) {
    for (let x = 0; x < params.nextSize; x += 1) {
      const key = buildTileKey(x, y);
      if (tileMap.has(key)) {
        continue;
      }
      const isEdge = x === 0 || y === 0 || x === params.nextSize - 1 || y === params.nextSize - 1;
      tileMap.set(key, {
        x,
        y,
        type: isEdge ? "mountain" : "grass",
        walkable: !isEdge,
        description: isEdge ? "宗门边界" : "新开辟地块",
      });
    }
  }
  return Array.from(tileMap.values()).sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

export async function updateSectHomeMapRecord(params: {
  mapId: string;
  name?: string;
  width: number;
  height: number;
  tilesData: TileData[];
}) {
  await db.update(maps).set({
    name: params.name,
    width: params.width,
    height: params.height,
    mapType: "sect",
    tilesData: params.tilesData,
  }).where(eq(maps.id, params.mapId)).run();
  publishMapStructureChanged({
    mapIds: [params.mapId],
    source: "sect-home-map-record",
  });
}
