import { count, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  items,
  players,
  worldMapInstances,
  worldMapPortals,
  worldNpcInventory,
  worldNpcLifeLogs,
  worldNpcProfiles,
  worldNpcRuntime,
} from "@/db/schema";
import {
  buildOpenWorldMapDrafts,
  buildOpenWorldNpcDrafts,
  type GeneratedOpenWorldMapDraft,
} from "@/modules/world/services/world-map-generator";
import {
  buildWorldMapBlockedTileKeySet,
  isWorldMapWalkablePosition,
  resolveNearestWorldMapWalkablePosition,
} from "@/modules/world/services/world-map-walkable";
import {
  getOpenWorldNpcRealmName,
  normalizeOpenWorldNpcGrowthStats,
} from "@/modules/world/services/world-npc-growth";
import {
  generateOpenWorldMapMeta,
  generateOpenWorldNpcDnaBatch,
} from "@/modules/world/services/world-ai-generation";
import { listOpenWorldDistricts } from "@/modules/world/services/world-district-service";
import {
  pickOpenWorldHotRumorFromRumors,
  readOpenWorldDistrictRumorSnapshotFromMapRow,
} from "@/modules/world/services/world-rumor-service";
import { listOpenWorldObjectivePoints } from "@/modules/world/services/world-objective-points";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";
import {
  OPEN_WORLD_ACTIVE_NPC_LIMIT,
  OPEN_WORLD_LAYOUT_VERSION,
  OPEN_WORLD_MAP_LIMIT,
  OPEN_WORLD_MAP_TYPE,
  OPEN_WORLD_NPCS_PER_MAP,
  normalizeOpenWorldHeatTier,
  normalizeOpenWorldRegionBand,
  resolveOpenWorldHeatTierLabel,
  resolveOpenWorldHeatTierSortValue,
  warmOpenWorldAiKeywordPool,
  warmOpenWorldCustomNpcLibrary,
} from "@/modules/world/services/world-config";
import type { TileData } from "@/types/game";

type ItemPoolEntry = {
  id: string;
  name: string;
  iconUrl: string | null;
};

type Point = {
  x: number;
  y: number;
};

type StoredOpenWorldMapMeta = {
  layoutVersion?: number;
  theme?: string;
  districts?: string[];
  buildingTags?: string[];
  resourceThemes?: string[];
  npcCrowds?: string[];
  rumorSeeds?: string[];
  regionBand?: string;
  heatTier?: string;
  heatScore?: number;
  dangerLevel?: number;
  mysteryLevel?: number;
  travelConnections?: GeneratedOpenWorldMapDraft["travelConnections"];
  encounterHooks?: string[];
  secretRealmHooks?: string[];
  districtRumors?: Array<{
    districtName: string;
    title: string;
    content: string;
    heat: "low" | "medium" | "high";
    updatedAt: string;
    source: "ai" | "fallback";
  }>;
  districtRumorsUpdatedAt?: string;
  aiSource?: "ai" | "fallback";
  generatedAt?: string;
};

type OpenWorldBootstrapGlobalStore = typeof globalThis & {
  __immortalityOpenWorldBootstrapPromise?: Promise<boolean>;
  __immortalityOpenWorldBootstrapReadyUntil?: number;
};

const OPEN_WORLD_BOOTSTRAP_CACHE_TTL_MS = 30_000;

function chebyshevDistance(left: Point, right: Point) {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
  );
}
const OPEN_WORLD_MAP_HEAT_TOUCH_COOLDOWN_MS = 3 * 60 * 1000;

type OpenWorldMapHeatTouchGlobalStore = typeof globalThis & {
  __immortalityOpenWorldMapHeatTouchMap?: Map<string, number>;
};

function getOpenWorldMapHeatTouchMap() {
  const globalStore = globalThis as OpenWorldMapHeatTouchGlobalStore;
  globalStore.__immortalityOpenWorldMapHeatTouchMap = globalStore.__immortalityOpenWorldMapHeatTouchMap || new Map<string, number>();
  return globalStore.__immortalityOpenWorldMapHeatTouchMap;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeTravelConnections(
  value: unknown,
  fallback: GeneratedOpenWorldMapDraft["travelConnections"],
): GeneratedOpenWorldMapDraft["travelConnections"] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const rows = value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const role = String(row.role || "").trim() as GeneratedOpenWorldMapDraft["travelConnections"][number]["role"];
      const targetMapId = String(row.targetMapId || "").trim();
      const targetMapName = String(row.targetMapName || "").trim();
      const travelType = String(row.travelType || "").trim() as GeneratedOpenWorldMapDraft["travelConnections"][number]["travelType"];
      const label = String(row.label || "").trim();
      const summary = String(row.summary || "").trim();
      const heatTierHint = String(row.heatTierHint || "").trim();
      if (!targetMapId || !targetMapName || !label || !summary) {
        return null;
      }
      return {
        role: role === "main" || role === "return" || role === "branch" ? role : "branch",
        targetMapId,
        targetMapName,
        travelType: travelType === "portal" || travelType === "road" || travelType === "rift" ? travelType : "road",
        label,
        summary,
        heatTierHint,
      } satisfies GeneratedOpenWorldMapDraft["travelConnections"][number];
    })
    .filter((entry): entry is GeneratedOpenWorldMapDraft["travelConnections"][number] => Boolean(entry));

  return rows.length > 0 ? rows : fallback;
}

function resolveHeatTierByScore(heatScore: number, fallbackTier: string | null | undefined) {
  if (heatScore >= 75) {
    return "hot" as const;
  }
  if (heatScore >= 48) {
    return "warm" as const;
  }
  const normalizedFallback = normalizeOpenWorldHeatTier(fallbackTier);
  return normalizedFallback === "hot" || normalizedFallback === "warm" ? "cold" as const : normalizedFallback;
}

function buildMapDraftLookup() {
  return new Map<string, GeneratedOpenWorldMapDraft>(buildOpenWorldMapDrafts().map((draft) => [draft.id, draft]));
}

type OpenWorldDraftLookupGlobalStore = typeof globalThis & {
  __immortalityOpenWorldDraftLookup?: Map<string, GeneratedOpenWorldMapDraft>;
};

function getOpenWorldDraftLookup() {
  const globalStore = globalThis as OpenWorldDraftLookupGlobalStore;
  if (!globalStore.__immortalityOpenWorldDraftLookup) {
    globalStore.__immortalityOpenWorldDraftLookup = buildMapDraftLookup();
  }
  return globalStore.__immortalityOpenWorldDraftLookup;
}

function resolveStoredMapSnapshot(
  row: typeof worldMapInstances.$inferSelect,
  draft: GeneratedOpenWorldMapDraft | null,
) {
  const metaJson = (row.metaJson || {}) as StoredOpenWorldMapMeta;
  const heatScore = Math.max(0, Number(row.heatScore || metaJson.heatScore || draft?.heatScore || 0));
  const heatTier = resolveHeatTierByScore(heatScore, row.heatTier || metaJson.heatTier || draft?.heatTier);
  const regionBand = normalizeOpenWorldRegionBand(row.regionBand || metaJson.regionBand || draft?.regionBand);
  const dangerLevel = Math.max(0, Number(row.dangerLevel || metaJson.dangerLevel || draft?.dangerLevel || 0));
  const mysteryLevel = Math.max(0, Number(row.mysteryLevel || metaJson.mysteryLevel || draft?.mysteryLevel || 0));
  const travelConnections = normalizeTravelConnections(row.travelConnectionsJson, draft?.travelConnections || []);
  const rumorHooks = normalizeStringArray(row.rumorHooksJson).length > 0
    ? normalizeStringArray(row.rumorHooksJson)
    : (draft?.rumorSeeds || []);
  const metaEncounterHooks = normalizeStringArray(metaJson.encounterHooks);
  const encounterHooks = normalizeStringArray(row.encounterHooksJson).length > 0
    ? normalizeStringArray(row.encounterHooksJson)
    : (metaEncounterHooks.length > 0 ? metaEncounterHooks : (draft?.encounterHooks || []));
  const metaSecretRealmHooks = normalizeStringArray(metaJson.secretRealmHooks);
  const secretRealmHooks = normalizeStringArray(row.secretRealmHooksJson).length > 0
    ? normalizeStringArray(row.secretRealmHooksJson)
    : (metaSecretRealmHooks.length > 0 ? metaSecretRealmHooks : (draft?.secretRealmHooks || []));

  return {
    metaJson,
    heatTier,
    heatTierLabel: resolveOpenWorldHeatTierLabel(heatTier),
    heatScore,
    regionBand,
    dangerLevel,
    mysteryLevel,
    travelConnections,
    rumorHooks,
    encounterHooks,
    secretRealmHooks,
  };
}

function buildMapHeatSummary(params: {
  mapName: string;
  heatTier: "hot" | "warm" | "cold";
  heatTierLabel: string;
  heatScore: number;
  dangerLevel: number;
  mysteryLevel: number;
}) {
  const summary = params.heatTier === "hot"
    ? `${params.mapName}眼下处于热地图层，玩家、风声和委托都更容易把这里继续点燃。`
    : params.heatTier === "warm"
      ? `${params.mapName}目前维持温地图层，世界状态会继续低频推演，但不会整图全速运行。`
      : `${params.mapName}暂时落在冷地图层，只保留摘要、路网入口与重建所需的世界痕迹。`;
  return {
    heatTier: params.heatTier,
    heatTierLabel: params.heatTierLabel,
    heatScore: params.heatScore,
    dangerLevel: params.dangerLevel,
    mysteryLevel: params.mysteryLevel,
    summary,
  };
}

function normalizeTileImagePath(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildTileKindKey(tile: Pick<TileData, "x" | "y" | "type">) {
  return `${tile.x}:${tile.y}:${tile.type}`;
}

function buildTilePositionKey(tile: Pick<TileData, "x" | "y">) {
  return `${tile.x}:${tile.y}`;
}

function repairOpenWorldSceneTiles(existingTiles: unknown, draftTiles: TileData[]) {
  const currentTiles = Array.isArray(existingTiles) ? existingTiles as TileData[] : [];
  if (currentTiles.length <= 0) {
    return draftTiles;
  }

  const draftTileMap = new Map(draftTiles.map((tile) => [buildTileKindKey(tile), tile] as const));
  const currentTileKindKeys = new Set(currentTiles.map((tile) => buildTileKindKey(tile)));
  const currentTilePositionKeys = new Set(currentTiles.map((tile) => buildTilePositionKey(tile)));
  let changed = false;
  const nextTiles = currentTiles.map((tile) => {
    const draftTile = draftTileMap.get(buildTileKindKey(tile));
    if (!draftTile) {
      return tile;
    }

    const currentImageUrl = normalizeTileImagePath(tile.imageUrl);
    const draftImageUrl = normalizeTileImagePath(draftTile.imageUrl);
    const shouldReplaceImage = currentImageUrl.startsWith("/worldpack-icons/four-realms/items/")
      || (draftImageUrl && currentImageUrl !== draftImageUrl);

    if (!shouldReplaceImage) {
      return tile;
    }

    changed = true;
    return {
      ...tile,
      imageUrl: draftTile.imageUrl || undefined,
      description: draftTile.description || tile.description,
      portalName: draftTile.portalName || tile.portalName,
      portalTargetName: draftTile.portalTargetName || tile.portalTargetName,
      portalTargetMapId: draftTile.portalTargetMapId || tile.portalTargetMapId,
      portalTargetPortalId: draftTile.portalTargetPortalId || tile.portalTargetPortalId,
    } satisfies TileData;
  });

  for (const draftTile of draftTiles) {
    if (currentTileKindKeys.has(buildTileKindKey(draftTile))) {
      continue;
    }
    if (currentTilePositionKeys.has(buildTilePositionKey(draftTile))) {
      continue;
    }
    nextTiles.push(draftTile);
    changed = true;
  }

  return changed ? nextTiles : currentTiles;
}

function pickSeeded<T>(list: T[], seed: string, offset = 0): T | null {
  if (list.length <= 0) {
    return null;
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index) + offset;
    hash |= 0;
  }
  return list[Math.abs(hash) % list.length] || null;
}

function buildNpcInventoryDrafts(npcId: string, itemPool: ItemPoolEntry[]) {
  if (itemPool.length <= 0) {
    return [];
  }

  const first = pickSeeded(itemPool, `${npcId}:loot:1`, 1);
  const second = pickSeeded(itemPool, `${npcId}:loot:2`, 2);
  const selected = [first, second].filter((item, index, list): item is ItemPoolEntry => (
    Boolean(item) && list.findIndex((candidate) => candidate?.id === item?.id) === index
  ));

  return selected.map((item, index) => ({
    id: `${npcId}:loot:${index + 1}`,
    npcId,
    itemId: item.id,
    itemNameSnapshot: item.name,
    itemIconUrl: item.iconUrl,
    quantity: index === 0 ? 1 : 2,
    isEquipped: false,
    isLootable: true,
    slotType: index === 0 ? "bag" : "stash",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

export async function ensureOpenWorldBootstrap(options?: {
  forceAiRefresh?: boolean;
}) {
  const globalStore = globalThis as OpenWorldBootstrapGlobalStore;
  const shouldForceRefresh = Boolean(options?.forceAiRefresh);
  const readyUntil = globalStore.__immortalityOpenWorldBootstrapReadyUntil || 0;
  if (!shouldForceRefresh && readyUntil > Date.now()) {
    return true;
  }

  if (globalStore.__immortalityOpenWorldBootstrapPromise) {
    if (!shouldForceRefresh) {
      return globalStore.__immortalityOpenWorldBootstrapPromise;
    }
    await globalStore.__immortalityOpenWorldBootstrapPromise;
  }

  if (!(await ensureOpenWorldSchema())) {
    return false;
  }

  globalStore.__immortalityOpenWorldBootstrapPromise = (async () => {
    await Promise.all([
      warmOpenWorldAiKeywordPool(shouldForceRefresh),
      warmOpenWorldCustomNpcLibrary(shouldForceRefresh),
    ]);
    const drafts = buildOpenWorldMapDrafts();
    const draftMapIds = drafts.map((draft) => draft.id);

    const [existingMaps, existingPortals, existingProfiles, existingRuntimeRows, existingInventoryRows, itemPool] = await Promise.all([
      db.select().from(worldMapInstances).where(inArray(worldMapInstances.id, draftMapIds)).all(),
      db.select().from(worldMapPortals).where(inArray(worldMapPortals.worldMapId, draftMapIds)).all(),
      db.select().from(worldNpcProfiles).where(inArray(worldNpcProfiles.worldMapId, draftMapIds)).all(),
      db.select().from(worldNpcRuntime).where(inArray(worldNpcRuntime.currentMapId, draftMapIds)).all(),
      db.select({ npcId: worldNpcInventory.npcId }).from(worldNpcInventory).all(),
      db.select({
        id: items.id,
        name: items.name,
        iconUrl: items.iconUrl,
      }).from(items).limit(24).all(),
    ]);

    const existingMapIdSet = new Set(existingMaps.map((row) => row.id));
    const existingPortalIdSet = new Set(existingPortals.map((row) => row.id));
    const existingPortalById = new Map(existingPortals.map((row) => [row.id, row]));
    const existingProfileIdSet = new Set(existingProfiles.map((row) => row.id));
    const existingRuntimeIdSet = new Set(existingRuntimeRows.map((row) => row.npcId));
    const existingInventoryNpcIdSet = new Set(existingInventoryRows.map((row) => row.npcId));
    const existingMapById = new Map(existingMaps.map((row) => [row.id, row]));
    const existingProfileById = new Map(existingProfiles.map((row) => [row.id, row]));
    const existingRuntimeById = new Map(existingRuntimeRows.map((row) => [row.npcId, row]));
    const rebuiltMapIdSet = new Set(
      drafts
        .filter((draft) => {
          const existingMap = existingMapById.get(draft.id);
          if (!existingMap) {
            return false;
          }
          const metaJson = (existingMap.metaJson || {}) as StoredOpenWorldMapMeta;
          return (
            existingMap.archetype !== draft.archetype
            || existingMap.name !== draft.name
            || Number(existingMap.width || 0) !== draft.width
            || Number(existingMap.height || 0) !== draft.height
            || String(existingMap.regionBand || "").trim() !== draft.regionBand
            || String(existingMap.heatTier || "").trim() !== draft.heatTier
            || Number(existingMap.dangerLevel || 0) !== draft.dangerLevel
            || Number(existingMap.mysteryLevel || 0) !== draft.mysteryLevel
            || Number(metaJson.layoutVersion || 0) !== OPEN_WORLD_LAYOUT_VERSION
          );
        })
        .map((draft) => draft.id),
    );

    const mapMetaById = new Map<string, Awaited<ReturnType<typeof generateOpenWorldMapMeta>>>();
    const mapsNeedingMeta = drafts.filter((draft) => {
      const existingMap = existingMapById.get(draft.id);
      const metaJson = existingMap?.metaJson as StoredOpenWorldMapMeta | null | undefined;
      return Boolean(
        shouldForceRefresh
        || !existingMap
        || !String(metaJson?.theme || "").trim()
        || rebuiltMapIdSet.has(draft.id),
      );
    });
    if (mapsNeedingMeta.length > 0) {
      const mapMetaEntries = await Promise.all(mapsNeedingMeta.map(async (draft) => [
        draft.id,
        await generateOpenWorldMapMeta(draft),
      ] as const));
      for (const [mapId, meta] of mapMetaEntries) {
        mapMetaById.set(mapId, meta);
      }
    }

    const npcDnaBatchByMapId = new Map<string, Awaited<ReturnType<typeof generateOpenWorldNpcDnaBatch>>>();
    const npcDnaBatchEntries = await Promise.all(drafts.map(async (draft) => {
      const npcDrafts = buildOpenWorldNpcDrafts(draft);
      const targetNpcDrafts = shouldForceRefresh
        ? npcDrafts
        : rebuiltMapIdSet.has(draft.id)
          ? npcDrafts
          : npcDrafts.filter((npcDraft) => !existingProfileIdSet.has(npcDraft.id));
      if (targetNpcDrafts.length <= 0) {
        return null;
      }
      return [
        draft.id,
        await generateOpenWorldNpcDnaBatch({
          mapDraft: draft,
          npcDrafts: targetNpcDrafts,
        }),
      ] as const;
    }));
    for (const entry of npcDnaBatchEntries) {
      if (!entry) {
        continue;
      }
      npcDnaBatchByMapId.set(entry[0], entry[1]);
    }

    for (const draft of drafts) {
      const existingMap = existingMapById.get(draft.id);
      const mapMeta = mapMetaById.get(draft.id);
      const storedMetaJson = mapMeta
        ? {
          layoutVersion: OPEN_WORLD_LAYOUT_VERSION,
          theme: mapMeta.theme,
          districts: mapMeta.districts,
          buildingTags: mapMeta.buildingTags,
          resourceThemes: mapMeta.resourceThemes,
          npcCrowds: mapMeta.npcCrowds,
          rumorSeeds: mapMeta.rumorSeeds,
          regionBand: draft.regionBand,
          heatTier: draft.heatTier,
          heatScore: draft.heatScore,
          dangerLevel: draft.dangerLevel,
          mysteryLevel: draft.mysteryLevel,
          travelConnections: draft.travelConnections,
          encounterHooks: draft.encounterHooks,
          secretRealmHooks: draft.secretRealmHooks,
          aiSource: mapMeta.source,
          generatedAt: new Date().toISOString(),
        }
        : undefined;

      if (!existingMapIdSet.has(draft.id)) {
        await db.insert(worldMapInstances).values({
          id: draft.id,
          name: draft.name,
          archetype: draft.archetype,
          seed: draft.seed,
          status: "active",
          width: draft.width,
          height: draft.height,
          minRealm: draft.minRealm,
          heatTier: draft.heatTier,
          heatScore: draft.heatScore,
          regionBand: draft.regionBand,
          dangerLevel: draft.dangerLevel,
          mysteryLevel: draft.mysteryLevel,
          description: mapMeta?.description || draft.description,
          backgroundImageUrl: draft.backgroundImageUrl,
          travelConnectionsJson: draft.travelConnections,
          rumorHooksJson: draft.rumorSeeds,
          encounterHooksJson: draft.encounterHooks,
          secretRealmHooksJson: draft.secretRealmHooks,
          metaJson: {
            ...(storedMetaJson || {}),
            layoutVersion: OPEN_WORLD_LAYOUT_VERSION,
          },
          tilesData: draft.tilesData,
          spawnMapId: draft.id,
          spawnPositionX: draft.spawnPositionX,
          spawnPositionY: draft.spawnPositionY,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).run();
        continue;
      }

      const existingMetaJson = (existingMap?.metaJson || {}) as StoredOpenWorldMapMeta;
      const shouldRebuildMap = rebuiltMapIdSet.has(draft.id);
      const repairedTilesData = shouldRebuildMap
        ? draft.tilesData
        : repairOpenWorldSceneTiles(existingMap?.tilesData, draft.tilesData);
      const nextMapPayload = {
        name: draft.name,
        archetype: draft.archetype,
        seed: draft.seed,
        status: "active" as const,
        width: draft.width,
        height: draft.height,
        minRealm: draft.minRealm,
        heatTier: draft.heatTier,
        heatScore: draft.heatScore,
        regionBand: draft.regionBand,
        dangerLevel: draft.dangerLevel,
        mysteryLevel: draft.mysteryLevel,
        description: mapMeta?.description || draft.description,
        backgroundImageUrl: draft.backgroundImageUrl,
        travelConnectionsJson: draft.travelConnections,
        rumorHooksJson: draft.rumorSeeds,
        encounterHooksJson: draft.encounterHooks,
        secretRealmHooksJson: draft.secretRealmHooks,
        tilesData: repairedTilesData,
        spawnMapId: draft.id,
        spawnPositionX: draft.spawnPositionX,
        spawnPositionY: draft.spawnPositionY,
        updatedAt: new Date().toISOString(),
      };

      if (storedMetaJson) {
        await db.update(worldMapInstances).set({
          ...nextMapPayload,
          metaJson: {
            ...existingMetaJson,
            ...storedMetaJson,
            layoutVersion: OPEN_WORLD_LAYOUT_VERSION,
          },
        }).where(eq(worldMapInstances.id, draft.id)).run();
        continue;
      }

      if (
        shouldRebuildMap
        || repairedTilesData !== existingMap?.tilesData
        || existingMap?.backgroundImageUrl !== draft.backgroundImageUrl
        || existingMap?.name !== draft.name
        || existingMap?.archetype !== draft.archetype
        || existingMap?.seed !== draft.seed
        || Number(existingMap?.minRealm || 0) !== draft.minRealm
        || Number(existingMap?.width || 0) !== draft.width
        || Number(existingMap?.height || 0) !== draft.height
        || String(existingMap?.heatTier || "").trim() !== draft.heatTier
        || Number(existingMap?.heatScore || 0) !== draft.heatScore
        || String(existingMap?.regionBand || "").trim() !== draft.regionBand
        || Number(existingMap?.dangerLevel || 0) !== draft.dangerLevel
        || Number(existingMap?.mysteryLevel || 0) !== draft.mysteryLevel
      ) {
        await db.update(worldMapInstances).set({
          ...nextMapPayload,
          metaJson: {
            ...existingMetaJson,
            layoutVersion: OPEN_WORLD_LAYOUT_VERSION,
          },
        }).where(eq(worldMapInstances.id, draft.id)).run();
      }
    }

    for (const draft of drafts) {
      for (const portal of draft.portals) {
        const existingPortal = existingPortalById.get(portal.id);
        if (!existingPortalIdSet.has(portal.id)) {
          await db.insert(worldMapPortals).values({
            id: portal.id,
            worldMapId: draft.id,
            portalName: portal.portalName,
            positionX: portal.positionX,
            positionY: portal.positionY,
            targetWorldMapId: portal.targetWorldMapId,
            targetPositionX: portal.targetPositionX,
            targetPositionY: portal.targetPositionY,
            bidirectionalGroupKey: portal.bidirectionalGroupKey,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).run();
          continue;
        }
        if (
          !existingPortal
          || existingPortal.portalName !== portal.portalName
          || Number(existingPortal.positionX || 0) !== portal.positionX
          || Number(existingPortal.positionY || 0) !== portal.positionY
          || existingPortal.targetWorldMapId !== portal.targetWorldMapId
          || Number(existingPortal.targetPositionX || 0) !== portal.targetPositionX
          || Number(existingPortal.targetPositionY || 0) !== portal.targetPositionY
          || existingPortal.bidirectionalGroupKey !== portal.bidirectionalGroupKey
        ) {
          await db.update(worldMapPortals).set({
            portalName: portal.portalName,
            positionX: portal.positionX,
            positionY: portal.positionY,
            targetWorldMapId: portal.targetWorldMapId,
            targetPositionX: portal.targetPositionX,
            targetPositionY: portal.targetPositionY,
            bidirectionalGroupKey: portal.bidirectionalGroupKey,
            updatedAt: new Date().toISOString(),
          }).where(eq(worldMapPortals.id, portal.id)).run();
        }
      }
    }

    for (const draft of drafts) {
      const npcDrafts = buildOpenWorldNpcDrafts(draft);
      const npcDnaBatch = npcDnaBatchByMapId.get(draft.id) || null;
      const rebuiltMap = rebuiltMapIdSet.has(draft.id);
      const blockedTileKeys = buildWorldMapBlockedTileKeySet(draft.tilesData, draft.width, draft.height);
      const reservedNpcPositions: Point[] = [];
      for (const npcDraft of npcDrafts) {
        const safeDraftPosition = resolveNearestWorldMapWalkablePosition({
          preferred: {
            x: npcDraft.runtime.positionX,
            y: npcDraft.runtime.positionY,
          },
          width: draft.width,
          height: draft.height,
          blockedTileKeys,
          avoidPoints: reservedNpcPositions,
          minDistanceFromAvoidPoints: 2,
        });
        const npcDnaProfile = npcDnaBatch?.profiles[npcDraft.id];
        if (!existingProfileIdSet.has(npcDraft.id)) {
          await db.insert(worldNpcProfiles).values({
            id: npcDraft.id,
            worldMapId: npcDraft.worldMapId,
            name: npcDnaProfile?.name || npcDraft.name,
            gender: npcDraft.gender,
            originType: npcDnaProfile?.originType || npcDraft.originType,
            profession: npcDnaProfile?.profession || npcDraft.profession,
            faction: npcDnaProfile?.faction || npcDraft.faction,
            realmName: npcDraft.realmName,
            realmMajor: npcDraft.realmMajor,
            realmMinor: npcDraft.realmMinor,
            personalitySummary: npcDnaProfile?.personalitySummary || npcDraft.personalitySummary,
            dnaSeed: npcDraft.dnaSeed,
            traitTags: npcDnaProfile?.traitTags || npcDraft.traitTags,
            behaviorWeights: npcDnaProfile?.behaviorWeights || npcDraft.behaviorWeights,
            statsSummary: npcDraft.statsSummary,
            lifeStage: "adult",
            reincarnationCount: 0,
            isKillable: true,
            status: "active",
            avatarImageUrl: npcDraft.avatarImageUrl,
            portraitImageUrl: npcDraft.portraitImageUrl,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).run();

          await db.insert(worldNpcLifeLogs).values({
            npcId: npcDraft.id,
            logType: npcDraft.initialLifeLog.logType,
            title: npcDraft.initialLifeLog.title,
            content: npcDnaProfile?.biography || npcDraft.initialLifeLog.content,
            payloadJson: npcDraft.initialLifeLog.payloadJson,
            createdAt: new Date().toISOString(),
          }).run();
        } else {
          const existingProfile = existingProfileById.get(npcDraft.id);
          if (existingProfile) {
            const nextOriginType = npcDnaProfile?.originType || npcDraft.originType;
            const nextProfession = npcDnaProfile?.profession || npcDraft.profession;
            const nextFaction = npcDnaProfile?.faction || npcDraft.faction;
            const nextTraitTags = npcDnaProfile?.traitTags || npcDraft.traitTags;
            const normalizedStats = normalizeOpenWorldNpcGrowthStats({
              dnaSeed: existingProfile.dnaSeed,
              profession: rebuiltMap ? nextProfession : existingProfile.profession,
              traitTags: rebuiltMap ? nextTraitTags : existingProfile.traitTags,
              realmMinor: existingProfile.realmMinor,
              statsSummary: existingProfile.statsSummary,
            });
            const expectedRealmName = getOpenWorldNpcRealmName(existingProfile.realmMinor);
            const currentGrowthThreshold = Number(existingProfile.statsSummary?.growthThreshold || 0);

            if (rebuiltMap || options?.forceAiRefresh) {
              await db.update(worldNpcProfiles).set({
                name: npcDnaProfile?.name || npcDraft.name,
                gender: npcDraft.gender,
                originType: nextOriginType,
                profession: nextProfession,
                faction: nextFaction,
                realmName: expectedRealmName,
                personalitySummary: npcDnaProfile?.personalitySummary || npcDraft.personalitySummary,
                traitTags: nextTraitTags,
                behaviorWeights: npcDnaProfile?.behaviorWeights || npcDraft.behaviorWeights,
                statsSummary: normalizedStats,
                avatarImageUrl: npcDraft.avatarImageUrl,
                portraitImageUrl: npcDraft.portraitImageUrl,
                updatedAt: new Date().toISOString(),
              }).where(eq(worldNpcProfiles.id, npcDraft.id)).run();
            } else if (existingProfile.realmName !== expectedRealmName || currentGrowthThreshold <= 0) {
              await db.update(worldNpcProfiles).set({
                realmName: expectedRealmName,
                statsSummary: normalizedStats,
                updatedAt: new Date().toISOString(),
              }).where(eq(worldNpcProfiles.id, npcDraft.id)).run();
            }
          }
        }

        let finalNpcPosition = safeDraftPosition;

        if (!existingRuntimeIdSet.has(npcDraft.id)) {
          await db.insert(worldNpcRuntime).values({
            npcId: npcDraft.id,
            currentMapId: npcDraft.runtime.currentMapId,
            positionX: safeDraftPosition.x,
            positionY: safeDraftPosition.y,
            currentAction: npcDraft.runtime.currentAction,
            currentActionLabel: npcDraft.runtime.currentActionLabel,
            isActivated: npcDraft.runtime.isActivated,
            lastActionAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).run();
        } else {
          const existingRuntime = existingRuntimeById.get(npcDraft.id);
          const runtimeNeedsRepair = existingRuntime
            ? !isWorldMapWalkablePosition({
              x: existingRuntime.positionX,
              y: existingRuntime.positionY,
              width: draft.width,
              height: draft.height,
              blockedTileKeys,
            })
            : false;
          const runtimeTooCrowded = existingRuntime
            ? reservedNpcPositions.some((point) => chebyshevDistance(point, {
              x: existingRuntime.positionX,
              y: existingRuntime.positionY,
            }) < 2)
            : false;
          const runtimeOutsideBounds = existingRuntime
            ? existingRuntime.positionX < 1
              || existingRuntime.positionY < 1
              || existingRuntime.positionX > draft.width - 2
              || existingRuntime.positionY > draft.height - 2
            : false;
          const repairedRuntimePosition = existingRuntime
            ? resolveNearestWorldMapWalkablePosition({
              preferred: {
                x: existingRuntime.positionX,
                y: existingRuntime.positionY,
              },
              width: draft.width,
              height: draft.height,
              blockedTileKeys,
              candidatePoints: [safeDraftPosition],
              avoidPoints: reservedNpcPositions,
              minDistanceFromAvoidPoints: 2,
            })
            : safeDraftPosition;
          const shouldRewriteRuntime = rebuiltMap || runtimeOutsideBounds || runtimeNeedsRepair || runtimeTooCrowded;
          if (shouldRewriteRuntime) {
            finalNpcPosition = rebuiltMap ? safeDraftPosition : repairedRuntimePosition;
            await db.update(worldNpcRuntime).set({
              positionX: finalNpcPosition.x,
              positionY: finalNpcPosition.y,
              currentAction: npcDraft.runtime.currentAction,
              currentActionLabel: npcDraft.runtime.currentActionLabel,
              isActivated: npcDraft.runtime.isActivated,
              updatedAt: new Date().toISOString(),
            }).where(eq(worldNpcRuntime.npcId, npcDraft.id)).run();
          } else if (existingRuntime) {
            finalNpcPosition = {
              x: existingRuntime.positionX,
              y: existingRuntime.positionY,
            };
          }
        }

        if (!existingInventoryNpcIdSet.has(npcDraft.id)) {
          const inventoryDrafts = buildNpcInventoryDrafts(npcDraft.id, itemPool);
          if (inventoryDrafts.length > 0) {
            await db.insert(worldNpcInventory).values(inventoryDrafts).run();
          }
        }
        reservedNpcPositions.push(finalNpcPosition);
      }

      if (rebuiltMap) {
        const currentPlayers = await db.select({
          id: players.id,
          positionX: players.positionX,
          positionY: players.positionY,
        }).from(players).where(eq(players.currentMapId, draft.id)).all();
        for (const currentPlayer of currentPlayers) {
          const repairedPlayerPosition = resolveNearestWorldMapWalkablePosition({
            preferred: {
              x: currentPlayer.positionX,
              y: currentPlayer.positionY,
            },
            width: draft.width,
            height: draft.height,
            blockedTileKeys,
            candidatePoints: [
              {
                x: draft.spawnPositionX,
                y: draft.spawnPositionY,
              },
            ],
          });
          if (
            repairedPlayerPosition.x !== currentPlayer.positionX
            || repairedPlayerPosition.y !== currentPlayer.positionY
          ) {
            await db.update(players).set({
              positionX: repairedPlayerPosition.x,
              positionY: repairedPlayerPosition.y,
              updatedAt: new Date().toISOString(),
            }).where(eq(players.id, currentPlayer.id)).run();
          }
        }
      }
    }

    globalStore.__immortalityOpenWorldBootstrapReadyUntil = Date.now() + OPEN_WORLD_BOOTSTRAP_CACHE_TTL_MS;
    return true;
  })().catch((error) => {
    globalStore.__immortalityOpenWorldBootstrapReadyUntil = 0;
    throw error;
  }).finally(() => {
    globalStore.__immortalityOpenWorldBootstrapPromise = undefined;
  });

  return globalStore.__immortalityOpenWorldBootstrapPromise;
}

export async function listOpenWorldMaps() {
  if (!(await ensureOpenWorldBootstrap())) {
    return [];
  }

  const rows = await db.select().from(worldMapInstances)
    .limit(OPEN_WORLD_MAP_LIMIT)
    .all();
  const mapIds = rows.map((row) => row.id);
  const draftMapLookup = getOpenWorldDraftLookup();

  const [portalRows, npcRows] = await Promise.all([
    mapIds.length > 0
      ? db.select().from(worldMapPortals).where(inArray(worldMapPortals.worldMapId, mapIds)).all()
      : Promise.resolve([]),
    mapIds.length > 0
      ? db.select({
        worldMapId: worldNpcProfiles.worldMapId,
        status: worldNpcProfiles.status,
      }).from(worldNpcProfiles).where(inArray(worldNpcProfiles.worldMapId, mapIds)).all()
      : Promise.resolve([]),
  ]);

  const portalCountByMapId = new Map<string, number>();
  for (const portalRow of portalRows) {
    portalCountByMapId.set(portalRow.worldMapId, (portalCountByMapId.get(portalRow.worldMapId) || 0) + 1);
  }
  const aliveNpcCountByMapId = new Map<string, number>();
  for (const npcRow of npcRows) {
    if (npcRow.status === "dead") {
      continue;
    }
    aliveNpcCountByMapId.set(npcRow.worldMapId, (aliveNpcCountByMapId.get(npcRow.worldMapId) || 0) + 1);
  }

  const hotRumorByMapId = new Map(rows.map((row) => {
    const rumorSnapshot = readOpenWorldDistrictRumorSnapshotFromMapRow(row);
    return [row.id, pickOpenWorldHotRumorFromRumors(rumorSnapshot.rumors)] as const;
  }));
  const snapshotByMapId = new Map(rows.map((row) => [row.id, resolveStoredMapSnapshot(row, draftMapLookup.get(row.id) || null)] as const));

  return [...rows]
    .sort((left, right) => {
      const leftSnapshot = snapshotByMapId.get(left.id);
      const rightSnapshot = snapshotByMapId.get(right.id);
      const tierGap = (rightSnapshot ? resolveOpenWorldHeatTierSortValue(rightSnapshot.heatTier) : 0)
        - (leftSnapshot ? resolveOpenWorldHeatTierSortValue(leftSnapshot.heatTier) : 0);
      if (tierGap !== 0) {
        return tierGap;
      }
      const scoreGap = Number(rightSnapshot?.heatScore || 0) - Number(leftSnapshot?.heatScore || 0);
      if (scoreGap !== 0) {
        return scoreGap;
      }
      return String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt));
    })
    .map((row) => {
    const snapshot = snapshotByMapId.get(row.id) || resolveStoredMapSnapshot(row, draftMapLookup.get(row.id) || null);
    const aliveNpcCount = aliveNpcCountByMapId.get(row.id) || 0;
    const hotRumor = hotRumorByMapId.get(row.id) || null;
    return {
      id: row.id,
      name: row.name,
      archetype: row.archetype,
      status: row.status,
      description: row.description,
      backgroundImageUrl: row.backgroundImageUrl,
      width: row.width,
      height: row.height,
      minRealm: row.minRealm,
      mapType: OPEN_WORLD_MAP_TYPE,
      heatTier: snapshot.heatTier,
      heatTierLabel: snapshot.heatTierLabel,
      heatScore: snapshot.heatScore,
      regionBand: snapshot.regionBand,
      dangerLevel: snapshot.dangerLevel,
      mysteryLevel: snapshot.mysteryLevel,
      travelConnections: snapshot.travelConnections,
      rumorHooks: snapshot.rumorHooks,
      encounterHooks: snapshot.encounterHooks,
      secretRealmHooks: snapshot.secretRealmHooks,
      activeNpcCount: Math.min(aliveNpcCount, OPEN_WORLD_ACTIVE_NPC_LIMIT),
      totalNpcCount: Math.max(aliveNpcCount, OPEN_WORLD_NPCS_PER_MAP),
      portalCount: portalCountByMapId.get(row.id) || 0,
      hotRumor,
      spawnPositionX: row.spawnPositionX,
      spawnPositionY: row.spawnPositionY,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function getOpenWorldMapById(mapId: string) {
  if (!(await ensureOpenWorldBootstrap())) {
    return null;
  }

  const row = await db.select().from(worldMapInstances).where(eq(worldMapInstances.id, mapId)).get();
  if (!row) {
    return null;
  }

  const [portals, npcCountRow, activeRuntimeCountRow] = await Promise.all([
    db.select().from(worldMapPortals).where(eq(worldMapPortals.worldMapId, mapId)).all(),
    db.select({ value: count() }).from(worldNpcProfiles).where(eq(worldNpcProfiles.worldMapId, mapId)).get(),
    db.select({ value: count() }).from(worldNpcRuntime).where(eq(worldNpcRuntime.currentMapId, mapId)).get(),
  ]);
  const draftMeta = getOpenWorldDraftLookup().get(mapId) || null;
  const snapshot = resolveStoredMapSnapshot(row, draftMeta);
  const metaJson = snapshot.metaJson;
  const districtRumorSnapshot = readOpenWorldDistrictRumorSnapshotFromMapRow(row);
  const districtRumors = districtRumorSnapshot.rumors;

  return {
    id: row.id,
    name: row.name,
    archetype: row.archetype,
    status: row.status,
    seed: row.seed,
    description: row.description,
    backgroundImageUrl: row.backgroundImageUrl,
    width: row.width,
    height: row.height,
    minRealm: row.minRealm,
    mapType: OPEN_WORLD_MAP_TYPE,
    heatTier: snapshot.heatTier,
    heatTierLabel: snapshot.heatTierLabel,
    heatScore: snapshot.heatScore,
    regionBand: snapshot.regionBand,
    dangerLevel: snapshot.dangerLevel,
    mysteryLevel: snapshot.mysteryLevel,
    tilesData: Array.isArray(row.tilesData) ? row.tilesData : [],
    theme: String(metaJson.theme || "").trim() || draftMeta?.theme || "",
    districts: Array.isArray(metaJson.districts) && metaJson.districts.length > 0
      ? metaJson.districts
      : listOpenWorldDistricts(mapId),
    buildingTags: Array.isArray(metaJson.buildingTags) && metaJson.buildingTags.length > 0
      ? metaJson.buildingTags
      : (draftMeta?.buildingTags || []),
    resourceThemes: Array.isArray(metaJson.resourceThemes) && metaJson.resourceThemes.length > 0
      ? metaJson.resourceThemes
      : (draftMeta?.resourceThemes || []),
    rumorSeeds: Array.isArray(metaJson.rumorSeeds) && metaJson.rumorSeeds.length > 0
      ? metaJson.rumorSeeds
      : (draftMeta?.rumorSeeds || []),
    rumorHooks: snapshot.rumorHooks,
    encounterHooks: snapshot.encounterHooks,
    secretRealmHooks: snapshot.secretRealmHooks,
    travelConnections: snapshot.travelConnections,
    districtRumors,
    objectivePoints: listOpenWorldObjectivePoints(row.id),
    districtRumorsUpdatedAt: districtRumors[0]?.updatedAt
      || (typeof metaJson.districtRumorsUpdatedAt === "string" ? metaJson.districtRumorsUpdatedAt : null),
    npcCrowds: Array.isArray(metaJson.npcCrowds) ? metaJson.npcCrowds : [],
    aiSource: metaJson.aiSource || "fallback",
    mapHeatSummary: buildMapHeatSummary({
      mapName: row.name,
      heatTier: snapshot.heatTier,
      heatTierLabel: snapshot.heatTierLabel,
      heatScore: snapshot.heatScore,
      dangerLevel: snapshot.dangerLevel,
      mysteryLevel: snapshot.mysteryLevel,
    }),
    spawnPositionX: row.spawnPositionX,
    spawnPositionY: row.spawnPositionY,
    portals,
    totalNpcCount: Number(npcCountRow?.value || 0),
    runtimeNpcCount: Number(activeRuntimeCountRow?.value || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function touchOpenWorldMapHeat(params: {
  mapId: string;
  playerId?: string | null;
  reason?: string;
  delta?: number;
}) {
  const normalizedMapId = String(params.mapId || "").trim();
  if (!normalizedMapId || !(await ensureOpenWorldBootstrap())) {
    return null;
  }

  const playerId = String(params.playerId || "system").trim() || "system";
  const reason = String(params.reason || "visit").trim() || "visit";
  const touchKey = `${playerId}:${normalizedMapId}:${reason}`;
  const touchMap = getOpenWorldMapHeatTouchMap();
  const lastTouchedAt = touchMap.get(touchKey) || 0;
  if ((Date.now() - lastTouchedAt) < OPEN_WORLD_MAP_HEAT_TOUCH_COOLDOWN_MS) {
    return null;
  }

  const row = await db.select().from(worldMapInstances).where(eq(worldMapInstances.id, normalizedMapId)).get();
  if (!row) {
    return null;
  }

  const draft = getOpenWorldDraftLookup().get(normalizedMapId) || null;
  const snapshot = resolveStoredMapSnapshot(row, draft);
  const nextHeatScore = Math.max(0, Math.min(100, snapshot.heatScore + Math.max(1, Number(params.delta || 3))));
  const nextHeatTier = resolveHeatTierByScore(nextHeatScore, snapshot.heatTier);
  touchMap.set(touchKey, Date.now());

  if (nextHeatScore === snapshot.heatScore && nextHeatTier === snapshot.heatTier) {
    return {
      heatTier: snapshot.heatTier,
      heatScore: snapshot.heatScore,
    };
  }

  await db.update(worldMapInstances).set({
    heatScore: nextHeatScore,
    heatTier: nextHeatTier,
    updatedAt: new Date().toISOString(),
  }).where(eq(worldMapInstances.id, normalizedMapId)).run();

  return {
    heatTier: nextHeatTier,
    heatScore: nextHeatScore,
  };
}

export async function getOpenWorldMapExplorationSummary(mapId: string) {
  if (!(await ensureOpenWorldBootstrap())) {
    return null;
  }

  const row = await db.select().from(worldMapInstances).where(eq(worldMapInstances.id, mapId)).get();
  if (!row) {
    return null;
  }
  const draft = getOpenWorldDraftLookup().get(mapId) || null;
  const snapshot = resolveStoredMapSnapshot(row, draft);

  return {
    regionBand: snapshot.regionBand,
    heatTier: snapshot.heatTier,
    heatTierLabel: snapshot.heatTierLabel,
    travelConnections: snapshot.travelConnections.map((connection) => ({
      role: connection.role,
      targetMapId: connection.targetMapId,
      targetMapName: connection.targetMapName,
      travelType: connection.travelType,
      label: connection.label,
      summary: connection.summary,
      heatTierHint: connection.heatTierHint,
    })),
    rumorHooks: snapshot.rumorHooks.slice(0, 4),
    encounterHooks: snapshot.encounterHooks.slice(0, 4),
    secretRealmHooks: snapshot.secretRealmHooks.slice(0, 4),
    mapHeatSummary: buildMapHeatSummary({
      mapName: row.name,
      heatTier: snapshot.heatTier,
      heatTierLabel: snapshot.heatTierLabel,
      heatScore: snapshot.heatScore,
      dangerLevel: snapshot.dangerLevel,
      mysteryLevel: snapshot.mysteryLevel,
    }),
  };
}

export async function getOpenWorldMapNetworkOverview() {
  const maps = await listOpenWorldMaps();
  const regionMap = new Map<string, {
    regionBand: string;
    mapCount: number;
    hotCount: number;
    warmCount: number;
    coldCount: number;
    averageDangerLevel: number;
    averageMysteryLevel: number;
    anchorMaps: string[];
  }>();

  let rumorHookCount = 0;
  let encounterHookCount = 0;
  let secretRealmHookCount = 0;

  maps.forEach((map) => {
    const current = regionMap.get(map.regionBand) || {
      regionBand: map.regionBand,
      mapCount: 0,
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      averageDangerLevel: 0,
      averageMysteryLevel: 0,
      anchorMaps: [],
    };
    current.mapCount += 1;
    if (map.heatTier === "hot") {
      current.hotCount += 1;
    } else if (map.heatTier === "warm") {
      current.warmCount += 1;
    } else {
      current.coldCount += 1;
    }
    current.averageDangerLevel += Number(map.dangerLevel || 0);
    current.averageMysteryLevel += Number(map.mysteryLevel || 0);
    current.anchorMaps.push(map.name);
    regionMap.set(map.regionBand, current);
    rumorHookCount += Array.isArray(map.rumorHooks) ? map.rumorHooks.length : 0;
    encounterHookCount += Array.isArray(map.encounterHooks) ? map.encounterHooks.length : 0;
    secretRealmHookCount += Array.isArray(map.secretRealmHooks) ? map.secretRealmHooks.length : 0;
  });

  return {
    summary: {
      totalMapCount: maps.length,
      hotMapCount: maps.filter((map) => map.heatTier === "hot").length,
      warmMapCount: maps.filter((map) => map.heatTier === "warm").length,
      coldMapCount: maps.filter((map) => map.heatTier === "cold").length,
    },
    regionBands: Array.from(regionMap.values()).map((entry) => ({
      ...entry,
      averageDangerLevel: entry.mapCount > 0 ? Math.round(entry.averageDangerLevel / entry.mapCount) : 0,
      averageMysteryLevel: entry.mapCount > 0 ? Math.round(entry.averageMysteryLevel / entry.mapCount) : 0,
      anchorMaps: entry.anchorMaps.slice(0, 4),
    })),
    maps: maps.map((map) => ({
      id: map.id,
      name: map.name,
      regionBand: map.regionBand,
      heatTier: map.heatTier,
      heatTierLabel: map.heatTierLabel,
      heatScore: map.heatScore,
      dangerLevel: map.dangerLevel,
      mysteryLevel: map.mysteryLevel,
      travelConnections: map.travelConnections,
      rumorHookCount: map.rumorHooks.length,
      encounterHookCount: map.encounterHooks.length,
      secretRealmHookCount: map.secretRealmHooks.length,
    })),
    explorationDensity: {
      rumorHookCount,
      encounterHookCount,
      secretRealmHookCount,
    },
  };
}

export async function getOpenWorldDashboardSummary() {
  const bootstrapReady = await ensureOpenWorldBootstrap();
  if (!bootstrapReady) {
    return {
      tiandaoStatus: "未安装",
      worldTime: new Date().toISOString(),
      activeMapCount: 0,
      activeNpcCount: 0,
      aliveNpcCount: 0,
      todayEventCount: 0,
      aiHealth: "schema-missing",
    };
  }

  const [mapRows, npcProfileRows, activeNpcRow, todayEventRows] = await Promise.all([
    db.select({
      id: worldMapInstances.id,
      status: worldMapInstances.status,
    }).from(worldMapInstances).all(),
    db.select({
      id: worldNpcProfiles.id,
      status: worldNpcProfiles.status,
    }).from(worldNpcProfiles).all(),
    db.select({ value: count() }).from(worldNpcRuntime).where(eq(worldNpcRuntime.isActivated, true)).get(),
    db.select({
      id: worldNpcLifeLogs.id,
    }).from(worldNpcLifeLogs)
      .where(gt(worldNpcLifeLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()))
      .all(),
  ]);

  const activeMapCount = mapRows.filter((row) => row.status === "active").length;
  const aliveNpcCount = npcProfileRows.filter((row) => row.status !== "dead").length;

  return {
    tiandaoStatus: activeMapCount > 0 ? "运行中" : "待启动",
    worldTime: new Date().toISOString(),
    activeMapCount,
    activeNpcCount: Number(activeNpcRow?.value || 0),
    aliveNpcCount,
    todayEventCount: todayEventRows.length,
    aiHealth: "fallback-ready",
  };
}
