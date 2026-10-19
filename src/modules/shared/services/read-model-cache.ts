type ReadModelCacheEntry<T> = {
  value: T;
  expiresAtMs: number;
  updatedAtMs: number;
};

type ReadModelCacheStats = {
  hits: number;
  misses: number;
  invalidations: number;
};

type ReadModelCacheGlobal = typeof globalThis & {
  __readModelCache?: Map<string, ReadModelCacheEntry<unknown>>;
  __readModelCacheInflight?: Map<string, Promise<unknown>>;
  __readModelCacheStats?: Map<string, ReadModelCacheStats>;
};

function getGlobalStore() {
  return globalThis as ReadModelCacheGlobal;
}

function getReadModelCache() {
  const globalStore = getGlobalStore();
  if (!globalStore.__readModelCache) {
    globalStore.__readModelCache = new Map<string, ReadModelCacheEntry<unknown>>();
  }
  return globalStore.__readModelCache;
}

function getReadModelCacheInflight() {
  const globalStore = getGlobalStore();
  if (!globalStore.__readModelCacheInflight) {
    globalStore.__readModelCacheInflight = new Map<string, Promise<unknown>>();
  }
  return globalStore.__readModelCacheInflight;
}

function getReadModelCacheStatsStore() {
  const globalStore = getGlobalStore();
  if (!globalStore.__readModelCacheStats) {
    globalStore.__readModelCacheStats = new Map<string, ReadModelCacheStats>();
  }
  return globalStore.__readModelCacheStats;
}

function recordReadModelCacheStat(group: string, field: keyof ReadModelCacheStats) {
  const statsStore = getReadModelCacheStatsStore();
  const current = statsStore.get(group) || {
    hits: 0,
    misses: 0,
    invalidations: 0,
  };
  current[field] += 1;
  statsStore.set(group, current);
}

function isExpired(entry: ReadModelCacheEntry<unknown> | undefined, nowMs: number) {
  return !entry || entry.expiresAtMs <= nowMs;
}

export async function readThroughReadModelCache<T>(params: {
  key: string;
  ttlMs: number;
  loader: () => Promise<T>;
  statGroup?: string;
}) {
  const key = String(params.key || "").trim();
  const statGroup = String(params.statGroup || "default").trim() || "default";
  if (!key) {
    return await params.loader();
  }

  const cache = getReadModelCache();
  const inflight = getReadModelCacheInflight();
  const nowMs = Date.now();
  const cached = cache.get(key);
  if (cached && !isExpired(cached, nowMs)) {
    recordReadModelCacheStat(statGroup, "hits");
    return cached.value as T;
  }

  const pending = inflight.get(key);
  if (pending) {
    recordReadModelCacheStat(statGroup, "hits");
    return await pending as T;
  }

  recordReadModelCacheStat(statGroup, "misses");
  const task = params.loader()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAtMs: Date.now() + Math.max(1, Math.floor(params.ttlMs)),
        updatedAtMs: Date.now(),
      });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === task) {
        inflight.delete(key);
      }
    });
  inflight.set(key, task);
  return await task;
}

export function invalidateReadModelCache(key: string) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return;
  }
  getReadModelCache().delete(normalizedKey);
}

export function invalidateReadModelCacheByPrefix(prefix: string, statGroup?: string) {
  const normalizedPrefix = String(prefix || "").trim();
  if (!normalizedPrefix) {
    return 0;
  }

  let invalidatedCount = 0;
  const cache = getReadModelCache();
  for (const key of cache.keys()) {
    if (!key.startsWith(normalizedPrefix)) {
      continue;
    }
    cache.delete(key);
    invalidatedCount += 1;
  }

  if (invalidatedCount > 0) {
    recordReadModelCacheStat(String(statGroup || "default").trim() || "default", "invalidations");
  }

  return invalidatedCount;
}

export function collectReadModelCacheStatsSnapshot() {
  return Array.from(getReadModelCacheStatsStore().entries())
    .map(([group, stats]) => ({
      group,
      hits: stats.hits,
      misses: stats.misses,
      invalidations: stats.invalidations,
      hitRate: stats.hits + stats.misses > 0
        ? Number((stats.hits / (stats.hits + stats.misses)).toFixed(4))
        : 0,
    }))
    .sort((left, right) => (
      (right.hits + right.misses) - (left.hits + left.misses)
    ));
}
