type WorldSummaryCacheKeyParams = {
  playerId: string;
  requestedMapId: string;
  currentMapId: string;
  currentMapInstanceId?: string | null;
  positionX?: number | null;
  positionY?: number | null;
};

type WorldIntelCacheKeyParams = {
  playerId: string;
  mapId: string;
};

type MarketListingsCacheKeyParams = {
  playerId: string;
  page: number;
  pageSize: number;
  itemId?: string;
  keyword?: string;
  myOnly?: boolean;
};

const DEFAULT_POSITION_BUCKET_SIZE = 3;

export const NOTIFICATION_SUMMARY_CACHE_PREFIX = "notification-summary:";
export const WORLD_SUMMARY_CACHE_PREFIX = "world-summary:";
export const WORLD_INTEL_CACHE_PREFIX = "world-intel:";
export const RANKING_CACHE_PREFIX = "rankings:";
export const MARKET_LISTINGS_CACHE_PREFIX = "market-listings:";

function normalizeKeyPart(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function bucketPosition(value: number | null | undefined, bucketSize = DEFAULT_POSITION_BUCKET_SIZE) {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) {
    return "na";
  }
  return String(Math.max(0, Math.floor(normalizedValue / Math.max(1, bucketSize))));
}

export function readPositiveIntEnv(name: string, fallbackValue: number, minValue = 1) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }
  return parsed;
}

export function getNotificationSummaryCacheTtlMs() {
  return readPositiveIntEnv("NOTIFICATION_SUMMARY_CACHE_TTL_MS", 3_000, 250);
}

export function getWorldSummaryCacheTtlMs() {
  return readPositiveIntEnv("WORLD_SUMMARY_CACHE_TTL_MS", 5_000, 250);
}

export function getWorldIntelCacheTtlMs() {
  return readPositiveIntEnv("WORLD_INTEL_CACHE_TTL_MS", 5_000, 250);
}

export function getRankingCacheTtlMs() {
  return readPositiveIntEnv("RANKING_CACHE_TTL_MS", 30_000, 1_000);
}

export function getMarketVisibilityCacheTtlMs() {
  return readPositiveIntEnv("MARKET_VISIBILITY_CACHE_TTL_MS", 3_000, 250);
}

export function buildNotificationSummaryCacheKey(playerId: string) {
  return `${NOTIFICATION_SUMMARY_CACHE_PREFIX}${normalizeKeyPart(playerId)}`;
}

export function buildWorldSummaryCacheKey(params: WorldSummaryCacheKeyParams) {
  const playerId = normalizeKeyPart(params.playerId);
  const requestedMapId = normalizeKeyPart(params.requestedMapId);
  const currentMapId = normalizeKeyPart(params.currentMapId);
  const currentMapInstanceId = normalizeKeyPart(params.currentMapInstanceId);
  const positionBucketX = bucketPosition(params.positionX);
  const positionBucketY = bucketPosition(params.positionY);

  return [
    WORLD_SUMMARY_CACHE_PREFIX,
    playerId,
    requestedMapId,
    currentMapId,
    currentMapInstanceId,
    positionBucketX,
    positionBucketY,
  ].join("|");
}

export function buildWorldIntelCacheKey(params: WorldIntelCacheKeyParams) {
  return [
    WORLD_INTEL_CACHE_PREFIX,
    normalizeKeyPart(params.playerId),
    normalizeKeyPart(params.mapId),
  ].join("|");
}

export function buildRankingCacheKey(dimension: string) {
  return `${RANKING_CACHE_PREFIX}${normalizeKeyPart(dimension) || "power"}`;
}

export function buildMarketListingsCacheKey(params: MarketListingsCacheKeyParams) {
  return [
    MARKET_LISTINGS_CACHE_PREFIX,
    normalizeKeyPart(params.playerId),
    normalizeKeyPart(params.page),
    normalizeKeyPart(params.pageSize),
    normalizeKeyPart(params.itemId),
    normalizeKeyPart(params.keyword),
    normalizeKeyPart(params.myOnly === true),
  ].join("|");
}
