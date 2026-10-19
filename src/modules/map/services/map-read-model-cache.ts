import {
  invalidateReadModelCacheByPrefix,
  readThroughReadModelCache,
} from "@/modules/shared/services/read-model-cache";

function parsePositiveIntEnv(name: string, fallbackValue: number, minValue = 1) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }
  return parsed;
}

const MAP_READ_MODEL_CACHE_TTL_MS = parsePositiveIntEnv("MAP_PANEL_READ_MODEL_CACHE_TTL_MS", 8_000, 200);
const MAP_READ_MODEL_CACHE_STAT_GROUP = "map-panel";

export async function loadMapReadModelCache<T>(params: {
  cacheKey: string;
  loader: () => Promise<T>;
  ttlMs?: number;
  force?: boolean;
  statGroup?: string;
}) {
  const normalizedCacheKey = String(params.cacheKey || "").trim();
  if (!normalizedCacheKey) {
    return await params.loader();
  }

  const ttlMs = Math.max(200, Number(params.ttlMs || MAP_READ_MODEL_CACHE_TTL_MS));
  if (params.force) {
    invalidateReadModelCacheByPrefix(normalizedCacheKey, params.statGroup || MAP_READ_MODEL_CACHE_STAT_GROUP);
  }

  return await readThroughReadModelCache<T>({
    key: normalizedCacheKey,
    ttlMs,
    loader: params.loader,
    statGroup: params.statGroup || MAP_READ_MODEL_CACHE_STAT_GROUP,
  });
}

export function invalidateMapReadModelCache(prefix?: string, statGroup?: string) {
  const normalizedPrefix = String(prefix || "").trim();
  if (!normalizedPrefix) {
    return 0;
  }
  return invalidateReadModelCacheByPrefix(
    normalizedPrefix,
    statGroup || MAP_READ_MODEL_CACHE_STAT_GROUP,
  );
}
