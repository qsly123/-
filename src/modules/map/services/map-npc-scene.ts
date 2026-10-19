import { eq } from "drizzle-orm";
import { db } from "@/db";
import { npcs } from "@/db/schema";
import type { MapSceneNpc } from "@/modules/map/services/map-scene-state";
import { normalizeNpcAvatarImageUrl } from "@/modules/shared/services/cosmetic-url";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { listWorldSceneNpcsByMap } from "@/modules/world/services/world-npc-service";

const MAP_SCENE_NPC_CACHE_TTL_MS = 2000;

type MapNpcSceneCacheEntry = {
  expiresAtMs: number;
  value: MapSceneNpc[];
};

type MapNpcSceneGlobal = typeof globalThis & {
  __mapNpcSceneCache?: Map<string, MapNpcSceneCacheEntry>;
};

function getNpcSceneCache() {
  const globalStore = globalThis as MapNpcSceneGlobal;
  globalStore.__mapNpcSceneCache = ensureGlobalMap<string, MapNpcSceneCacheEntry>(
    globalStore as Record<string, unknown>,
    "__mapNpcSceneCache",
  );
  return globalStore.__mapNpcSceneCache;
}

export async function listMapSceneNpcsByMap(mapId: string): Promise<MapSceneNpc[]> {
  const cache = getNpcSceneCache();
  const nowMs = Date.now();
  const cached = cache.get(mapId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  const staticRows = await db.select({
    id: npcs.id,
    name: npcs.name,
    title: npcs.title,
    avatarImageUrl: npcs.avatarImageUrl,
    positionX: npcs.positionX,
    positionY: npcs.positionY,
    isShop: npcs.isShop,
  }).from(npcs).where(eq(npcs.mapId, mapId)).all();
  const worldRows = mapId.startsWith("world_open_")
    ? await listWorldSceneNpcsByMap(mapId)
    : [];

  const nextValue = [
    ...staticRows.map((row) => ({
      ...row,
      avatarImageUrl: normalizeNpcAvatarImageUrl(row.avatarImageUrl),
      sourceType: "static" as const,
      detailRoute: `/game/npc/${row.id}`,
      realmName: null,
      currentActionLabel: null,
      isKillable: false,
      status: "active",
    })),
    ...worldRows,
  ];

  cache.set(mapId, {
    expiresAtMs: nowMs + MAP_SCENE_NPC_CACHE_TTL_MS,
    value: nextValue,
  });

  return nextValue;
}
