import { db } from "@/db";
import { maps, temporaryMaps, worldMapInstances } from "@/db/schema";
import { eq } from "drizzle-orm";

const COMBAT_REALM_CACHE_TTL_MS = 5 * 60 * 1000;

type CombatRealmCacheEntry = {
  realm: number | null;
  expiresAtMs: number;
};

type CombatRealmCacheState = typeof globalThis & {
  __combatRealmByMapIdCache?: Map<string, CombatRealmCacheEntry>;
};

function getCombatRealmCache() {
  const globalStore = globalThis as CombatRealmCacheState;
  if (!globalStore.__combatRealmByMapIdCache) {
    globalStore.__combatRealmByMapIdCache = new Map<string, CombatRealmCacheEntry>();
  }
  return globalStore.__combatRealmByMapIdCache;
}

function normalizeRealmValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(numeric));
}

function readCachedRealm(mapId: string) {
  const cache = getCombatRealmCache();
  if (!cache.has(mapId)) {
    return undefined;
  }
  const entry = cache.get(mapId);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(mapId);
    return undefined;
  }
  return entry.realm;
}

function writeCachedRealm(mapId: string, realm: number | null) {
  getCombatRealmCache().set(mapId, {
    realm,
    expiresAtMs: Date.now() + COMBAT_REALM_CACHE_TTL_MS,
  });
  return realm;
}

export async function resolveCombatRealmByMapId(mapId?: string | null): Promise<number | null> {
  const normalizedMapId = String(mapId || "").trim();
  if (!normalizedMapId) {
    return null;
  }

  const cachedRealm = readCachedRealm(normalizedMapId);
  if (cachedRealm !== undefined) {
    return cachedRealm;
  }

  const [temporaryMap, normalMap, worldMap] = await Promise.all([
    db.select({
      minRealm: temporaryMaps.minRealm,
    }).from(temporaryMaps).where(eq(temporaryMaps.id, normalizedMapId)).get(),
    db.select({
      minRealm: maps.minRealm,
    }).from(maps).where(eq(maps.id, normalizedMapId)).get(),
    db.select({
      minRealm: worldMapInstances.minRealm,
    }).from(worldMapInstances).where(eq(worldMapInstances.id, normalizedMapId)).get(),
  ]);

  const resolvedRealm = normalizeRealmValue(
    temporaryMap?.minRealm
    ?? normalMap?.minRealm
    ?? worldMap?.minRealm
    ?? null,
  );

  return writeCachedRealm(normalizedMapId, resolvedRealm);
}
