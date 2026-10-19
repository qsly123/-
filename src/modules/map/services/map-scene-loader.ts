import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getPlayerCosmeticProfileById, type PlayerCosmeticProfile } from "@/modules/character/services/player-cosmetic-profile";
import {
  buildMapSceneStateFromMapData,
  type MapSceneOpportunity,
  type MapScenePlayer,
  type MapSceneState,
} from "@/modules/map/services/map-scene-state";
import { getMapSceneSharedState } from "@/modules/map/services/map-scene-hub";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { pushRuntimePerformanceEvent } from "@/modules/system/services/runtime-performance";

function parsePositiveIntEnv(name: string, fallbackValue: number, minValue = 1) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }
  return parsed;
}

const MAP_SCENE_CONTEXT_CACHE_TTL_MS = parsePositiveIntEnv("MAP_SCENE_CONTEXT_CACHE_TTL_MS", 2_000, 200);
const MAP_SCENE_CONTEXT_SLOW_LOAD_MS = 1_500;
const MAP_SCENE_CONTEXT_CACHE_PRUNE_INTERVAL_MS = 60_000;
const MAP_SCENE_CONTEXT_CACHE_STALE_MS = 5 * 60 * 1000;

export type MapSceneSelfPlayer = {
  id: string;
  name: string | null;
  gender: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string | null;
  positionX: number;
  positionY: number;
  currentMapId: string | null;
};

type RuntimeSceneMap = {
  id: string;
  width: number;
  height: number;
  tilesData: unknown;
};

type LoadMapSceneContextOptions = {
  force?: boolean;
  player?: MapSceneSelfPlayer | null;
  map?: RuntimeSceneMap | null;
  playerCosmetic?: PlayerCosmeticProfile | null;
  opportunities?: MapSceneOpportunity[] | null;
};

export type LoadedMapSceneContext = {
  currentMapId: string;
  playerRealm: number;
  map: RuntimeSceneMap;
  sceneState: MapSceneState;
};

type MapSceneContextCacheEntry = {
  promise: Promise<LoadedMapSceneContext | null> | null;
  value: LoadedMapSceneContext | null;
  expiresAtMs: number;
  lastAccessedAtMs: number;
};

type MapSceneLoaderGlobal = typeof globalThis & {
  __mapSceneContextCache?: Map<string, MapSceneContextCacheEntry>;
  __mapSceneContextCachePruneTimer?: ReturnType<typeof setInterval>;
};

function formatScenePlayer(
  row: {
    id: string;
    name: string | null;
    gender: string | null;
    realm: number;
    realmMajor: number | null;
    realmMinor: number | null;
    realmName: string | null;
    positionX: number;
    positionY: number;
  },
  cosmetic?: PlayerCosmeticProfile | null,
): MapScenePlayer {
  return {
    id: row.id,
    name: row.name || "无名",
    gender: row.gender,
    avatarImageUrl: cosmetic?.avatarImageUrl || null,
    avatarFrameImageUrl: cosmetic?.avatarFrameImageUrl || null,
    realm: row.realm,
    realmMajor: row.realmMajor,
    realmMinor: row.realmMinor,
    realmName: row.realmName || "凡人",
    positionX: row.positionX,
    positionY: row.positionY,
  };
}

export function canSeeOpportunityByRealm(params: {
  playerRealm: number;
  minRealm: number;
  maxRealm: number | null;
}) {
  if (params.playerRealm < params.minRealm) {
    return false;
  }
  if (params.maxRealm !== null && params.playerRealm > params.maxRealm) {
    return false;
  }
  return true;
}

async function loadSelfPlayer(playerId: string) {
  return await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    positionX: players.positionX,
    positionY: players.positionY,
    currentMapId: players.currentMapId,
  }).from(players).where(eq(players.id, playerId)).get();
}

function getMapSceneContextCache() {
  const globalStore = globalThis as MapSceneLoaderGlobal;
  globalStore.__mapSceneContextCache = ensureGlobalMap<string, MapSceneContextCacheEntry>(
    globalStore as Record<string, unknown>,
    "__mapSceneContextCache",
  );
  if (!globalStore.__mapSceneContextCachePruneTimer) {
    globalStore.__mapSceneContextCachePruneTimer = setInterval(() => {
      const cache = globalStore.__mapSceneContextCache;
      if (!cache) {
        return;
      }

      const nowMs = Date.now();
      for (const [cacheKey, entry] of cache.entries()) {
        if (entry.promise) {
          continue;
        }
        if (
          Number(entry.expiresAtMs || 0) < nowMs
          && Number(entry.lastAccessedAtMs || 0) + MAP_SCENE_CONTEXT_CACHE_STALE_MS < nowMs
        ) {
          cache.delete(cacheKey);
        }
      }
    }, MAP_SCENE_CONTEXT_CACHE_PRUNE_INTERVAL_MS);
    if (typeof globalStore.__mapSceneContextCachePruneTimer.unref === "function") {
      globalStore.__mapSceneContextCachePruneTimer.unref();
    }
  }
  return globalStore.__mapSceneContextCache;
}

function buildMapSceneContextCacheKey(
  playerId: string,
  options?: LoadMapSceneContextOptions,
) {
  const player = options?.player;
  const map = options?.map;
  const playerCosmetic = options?.playerCosmetic;
  const opportunities = options?.opportunities;

  return JSON.stringify({
    playerId,
    currentMapId: player?.currentMapId ?? null,
    positionX: player?.positionX ?? null,
    positionY: player?.positionY ?? null,
    realm: player?.realm ?? null,
    mapId: map?.id ?? null,
    mapWidth: map?.width ?? null,
    mapHeight: map?.height ?? null,
    playerAvatarId: playerCosmetic?.avatarId ?? null,
    playerAvatarFrameId: playerCosmetic?.avatarFrameId ?? null,
    opportunityCount: opportunities?.length ?? null,
    opportunitySignature: opportunities
      ? opportunities.map((item) => `${item.spawnId}:${item.positionX},${item.positionY}`).join("|")
      : null,
  });
}

async function loadMapSceneContextForPlayerUncached(
  playerId: string,
  options?: LoadMapSceneContextOptions,
): Promise<LoadedMapSceneContext | null> {
  const selfPlayer = options?.player || await loadSelfPlayer(playerId);
  if (!selfPlayer?.id) {
    return null;
  }

  const currentMapId = selfPlayer.currentMapId || "map_starter_village";
  const runtimeMap = options?.map || await getRuntimeMapById(currentMapId);
  if (!runtimeMap) {
    return null;
  }

  const sharedState = await getMapSceneSharedState({
    mapId: currentMapId,
    map: {
      id: runtimeMap.id,
      width: runtimeMap.width,
      height: runtimeMap.height,
      tilesData: runtimeMap.tilesData,
    },
  });
  const activeOpportunities = options?.opportunities || sharedState.opportunities;

  const selfPlayerFromSharedState = sharedState.players.find((player) => player.id === selfPlayer.id) || null;
  const selfCosmetic = options?.playerCosmetic
    || (
      selfPlayerFromSharedState
        ? {
          avatarId: null,
          avatarImageUrl: selfPlayerFromSharedState.avatarImageUrl || null,
          avatarFrameId: null,
          avatarFrameImageUrl: selfPlayerFromSharedState.avatarFrameImageUrl || null,
        }
        : await getPlayerCosmeticProfileById(playerId)
    );
  const otherPlayers = sharedState.players.filter((player) => player.id !== selfPlayer.id);
  const playerSnapshot = formatScenePlayer(selfPlayer, selfCosmetic);

  const opportunities = activeOpportunities.filter((item) => canSeeOpportunityByRealm({
    playerRealm: selfPlayer.realm,
    minRealm: item.minRealm,
    maxRealm: item.maxRealm,
  }));

  return {
    currentMapId,
    playerRealm: selfPlayer.realm,
    map: {
      id: runtimeMap.id,
      width: runtimeMap.width,
      height: runtimeMap.height,
      tilesData: runtimeMap.tilesData,
    },
    sceneState: buildMapSceneStateFromMapData({
      mapId: currentMapId,
      player: playerSnapshot,
      otherPlayers,
      npcs: sharedState.npcs,
      monsters: sharedState.monsters,
      opportunities,
    }),
  };
}

export async function loadMapSceneContextForPlayer(
  playerId: string,
  options?: LoadMapSceneContextOptions,
): Promise<LoadedMapSceneContext | null> {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    return null;
  }

  const cacheKey = buildMapSceneContextCacheKey(normalizedPlayerId, options);
  const cache = getMapSceneContextCache();
  const nowMs = Date.now();
  const cached = cache.get(cacheKey);
  const forceReload = options?.force === true;
  if (cached) {
    cache.set(cacheKey, {
      ...cached,
      lastAccessedAtMs: nowMs,
    });
  }

  if (!forceReload && cached?.value && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  if (!forceReload && cached?.promise) {
    return await cached.promise;
  }

  const loadPromise = (async () => {
    const startedAtMs = Date.now();
    try {
      const result = await loadMapSceneContextForPlayerUncached(normalizedPlayerId, options);
      const durationMs = Date.now() - startedAtMs;
      if (durationMs >= MAP_SCENE_CONTEXT_SLOW_LOAD_MS) {
        pushRuntimePerformanceEvent({
          level: "warn",
          source: "map-scene-loader",
          type: "scene_context_slow_load",
          message: "地图场景上下文加载耗时偏高",
          data: {
            playerId: normalizedPlayerId,
            durationMs,
            mapId: result?.currentMapId || options?.player?.currentMapId || options?.map?.id || null,
          },
        });
        console.warn("[map-scene-loader] slow scene context load", {
          playerId: normalizedPlayerId,
          durationMs,
          mapId: result?.currentMapId || options?.player?.currentMapId || options?.map?.id || null,
        });
      }
      cache.set(cacheKey, {
        promise: null,
        value: result,
        expiresAtMs: Date.now() + MAP_SCENE_CONTEXT_CACHE_TTL_MS,
        lastAccessedAtMs: Date.now(),
      });
      return result;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
  })();

  cache.set(cacheKey, {
    promise: loadPromise,
    value: null,
    expiresAtMs: nowMs + MAP_SCENE_CONTEXT_CACHE_TTL_MS,
    lastAccessedAtMs: nowMs,
  });

  try {
    return await loadPromise;
  } finally {
    const latest = cache.get(cacheKey);
    if (latest?.promise === loadPromise && latest.value === null) {
      cache.delete(cacheKey);
    }
  }
}

export function invalidateMapSceneContextCache(params?: {
  playerId?: string | null;
  mapId?: string | null;
}) {
  const cache = getMapSceneContextCache();
  const normalizedPlayerId = String(params?.playerId || "").trim();
  const normalizedMapId = String(params?.mapId || "").trim();
  const playerNeedle = normalizedPlayerId ? `"playerId":"${normalizedPlayerId}"` : "";
  const mapNeedles = normalizedMapId
    ? [`"currentMapId":"${normalizedMapId}"`, `"mapId":"${normalizedMapId}"`]
    : [];

  for (const cacheKey of cache.keys()) {
    if (playerNeedle && !cacheKey.includes(playerNeedle)) {
      continue;
    }
    if (mapNeedles.length > 0 && !mapNeedles.some((needle) => cacheKey.includes(needle))) {
      continue;
    }
    cache.delete(cacheKey);
  }
}
