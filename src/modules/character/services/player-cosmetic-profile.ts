import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { avatarAssets, avatarFrameAssets, players } from "@/db/schema";
import { scheduleExpiredTemporaryCosmeticsCleanup } from "@/modules/character/services/temporary-cosmetic-service";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";

export interface PlayerCosmeticProfile {
  avatarId: string | null;
  avatarImageUrl: string | null;
  avatarFrameId: string | null;
  avatarFrameImageUrl: string | null;
}

const EMPTY_PROFILE: PlayerCosmeticProfile = {
  avatarId: null,
  avatarImageUrl: null,
  avatarFrameId: null,
  avatarFrameImageUrl: null,
};

const PLAYER_COSMETIC_ASSET_CACHE_TTL_MS = 60 * 1000;

type CosmeticAssetCacheEntry = {
  expiresAtMs: number;
  imageUrl: string | null;
};

type PlayerCosmeticRuntimeGlobal = typeof globalThis & {
  __playerCosmeticAvatarAssetCache?: Map<string, CosmeticAssetCacheEntry>;
  __playerCosmeticAvatarFrameAssetCache?: Map<string, CosmeticAssetCacheEntry>;
};

function normalizeIds(input: string[]) {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))];
}

function getCosmeticAssetCache(kind: "avatar" | "avatarFrame") {
  const globalStore = globalThis as PlayerCosmeticRuntimeGlobal;
  if (kind === "avatar") {
    globalStore.__playerCosmeticAvatarAssetCache = ensureGlobalMap<string, CosmeticAssetCacheEntry>(
      globalStore as Record<string, unknown>,
      "__playerCosmeticAvatarAssetCache",
    );
    return globalStore.__playerCosmeticAvatarAssetCache;
  }

  globalStore.__playerCosmeticAvatarFrameAssetCache = ensureGlobalMap<string, CosmeticAssetCacheEntry>(
    globalStore as Record<string, unknown>,
    "__playerCosmeticAvatarFrameAssetCache",
  );
  return globalStore.__playerCosmeticAvatarFrameAssetCache;
}

async function resolveEnabledCosmeticAssetImageUrl(
  kind: "avatar" | "avatarFrame",
  assetId: string | null,
) {
  const normalizedAssetId = typeof assetId === "string" ? assetId.trim() : "";
  if (!normalizedAssetId) {
    return null;
  }

  const cache = getCosmeticAssetCache(kind);
  const nowMs = Date.now();
  const cached = cache.get(normalizedAssetId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.imageUrl;
  }

  const row = kind === "avatar"
    ? await db.select({ imageUrl: avatarAssets.imageUrl })
      .from(avatarAssets)
      .where(and(
        eq(avatarAssets.id, normalizedAssetId),
        eq(avatarAssets.enabled, true),
      ))
      .get()
    : await db.select({ imageUrl: avatarFrameAssets.imageUrl })
      .from(avatarFrameAssets)
      .where(and(
        eq(avatarFrameAssets.id, normalizedAssetId),
        eq(avatarFrameAssets.enabled, true),
      ))
      .get();

  const imageUrl = row?.imageUrl || null;
  cache.set(normalizedAssetId, {
    expiresAtMs: nowMs + PLAYER_COSMETIC_ASSET_CACHE_TTL_MS,
    imageUrl,
  });
  return imageUrl;
}

export async function getPlayerCosmeticProfileFromIds(params: {
  avatarId?: string | null;
  avatarFrameId?: string | null;
}) {
  const avatarId = typeof params.avatarId === "string" ? params.avatarId.trim() : "";
  const avatarFrameId = typeof params.avatarFrameId === "string" ? params.avatarFrameId.trim() : "";
  if (!avatarId && !avatarFrameId) {
    return { ...EMPTY_PROFILE };
  }

  const [avatarImageUrl, avatarFrameImageUrl] = await Promise.all([
    resolveEnabledCosmeticAssetImageUrl("avatar", avatarId || null),
    resolveEnabledCosmeticAssetImageUrl("avatarFrame", avatarFrameId || null),
  ]);

  return {
    avatarId: avatarId || null,
    avatarImageUrl,
    avatarFrameId: avatarFrameId || null,
    avatarFrameImageUrl,
  };
}

export async function getPlayerCosmeticMapByIds(playerIds: string[]) {
  void scheduleExpiredTemporaryCosmeticsCleanup();
  const normalizedIds = normalizeIds(playerIds);
  if (!normalizedIds.length) {
    return new Map<string, PlayerCosmeticProfile>();
  }

  const rows = await db.select({
    playerId: players.id,
    avatarId: players.avatarId,
    avatarFrameId: players.avatarFrameId,
  }).from(players)
    .where(inArray(players.id, normalizedIds))
    .all();

  const avatarIds = normalizeIds(rows.map((row) => row.avatarId || ""));
  const avatarFrameIds = normalizeIds(rows.map((row) => row.avatarFrameId || ""));

  const avatarRows = avatarIds.length
    ? await db.select({
      id: avatarAssets.id,
      imageUrl: avatarAssets.imageUrl,
    }).from(avatarAssets)
      .where(and(
        inArray(avatarAssets.id, avatarIds),
        eq(avatarAssets.enabled, true),
      ))
      .all()
    : [];
  const avatarFrameRows = avatarFrameIds.length
    ? await db.select({
      id: avatarFrameAssets.id,
      imageUrl: avatarFrameAssets.imageUrl,
    }).from(avatarFrameAssets)
      .where(and(
        inArray(avatarFrameAssets.id, avatarFrameIds),
        eq(avatarFrameAssets.enabled, true),
      ))
      .all()
    : [];

  const avatarMap = new Map(avatarRows.map((row) => [row.id, row.imageUrl]));
  const avatarFrameMap = new Map(avatarFrameRows.map((row) => [row.id, row.imageUrl]));

  const result = new Map<string, PlayerCosmeticProfile>();
  for (const row of rows) {
    result.set(row.playerId, {
      avatarId: row.avatarId || null,
      avatarImageUrl: row.avatarId ? (avatarMap.get(row.avatarId) || null) : null,
      avatarFrameId: row.avatarFrameId || null,
      avatarFrameImageUrl: row.avatarFrameId ? (avatarFrameMap.get(row.avatarFrameId) || null) : null,
    });
  }
  return result;
}

export async function getPlayerCosmeticProfileById(playerId: string) {
  void scheduleExpiredTemporaryCosmeticsCleanup();
  const normalizedId = playerId.trim();
  if (!normalizedId) {
    return { ...EMPTY_PROFILE };
  }

  const row = await db.select({
    avatarId: players.avatarId,
    avatarFrameId: players.avatarFrameId,
  }).from(players).where(eq(players.id, normalizedId)).get();

  if (!row) {
    return { ...EMPTY_PROFILE };
  }

  return getPlayerCosmeticProfileFromIds({
    avatarId: row.avatarId,
    avatarFrameId: row.avatarFrameId,
  });
}
