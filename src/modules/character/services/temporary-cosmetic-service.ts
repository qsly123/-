import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  avatarAssets,
  avatarFrameAssets,
  playerTemporaryCosmeticGrants,
  playerUnlockedAvatarFrames,
  playerUnlockedAvatars,
  players,
} from "@/db/schema";

const MS_DAY = 24 * 60 * 60 * 1000;
const TEMPORARY_COSMETIC_CLEANUP_THROTTLE_MS = 60 * 1000;

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;
type TemporaryCosmeticCleanupGlobal = typeof globalThis & {
  __temporaryCosmeticCleanupPromise?: Promise<{ revoked: number }> | null;
  __temporaryCosmeticCleanupLastRunAt?: number;
};

export function normalizeTemporaryDurationDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

export async function unlockAvatarForPlayer(params: {
  playerId: string;
  avatarId: string;
  itemId: string;
  durationDays?: number;
  tx?: DbExecutor;
}) {
  const tx = params.tx || db;
  const durationDays = normalizeTemporaryDurationDays(params.durationDays);
  const nowIso = new Date().toISOString();
  const inserted = await tx.insert(playerUnlockedAvatars).values({
    playerId: params.playerId,
    avatarId: params.avatarId,
    sourceItemId: params.itemId,
  }).onConflictDoNothing().returning({
    avatarId: playerUnlockedAvatars.avatarId,
  }).get();

  let expiresAt: string | null = null;
  if (durationDays > 0) {
    expiresAt = new Date(Date.now() + durationDays * MS_DAY).toISOString();
    await tx.insert(playerTemporaryCosmeticGrants).values({
      playerId: params.playerId,
      avatarId: params.avatarId,
      sourceItemId: params.itemId,
      insertedAvatarUnlock: Boolean(inserted),
      grantedAt: nowIso,
      expiresAt,
    }).run();
  }

  return {
    inserted: Boolean(inserted),
    temporary: durationDays > 0,
    durationDays,
    expiresAt,
  };
}

export async function unlockAvatarFrameForPlayer(params: {
  playerId: string;
  avatarFrameId: string;
  itemId: string;
  durationDays?: number;
  tx?: DbExecutor;
}) {
  const tx = params.tx || db;
  const durationDays = normalizeTemporaryDurationDays(params.durationDays);
  const nowIso = new Date().toISOString();
  const inserted = await tx.insert(playerUnlockedAvatarFrames).values({
    playerId: params.playerId,
    avatarFrameId: params.avatarFrameId,
    sourceItemId: params.itemId,
  }).onConflictDoNothing().returning({
    avatarFrameId: playerUnlockedAvatarFrames.avatarFrameId,
  }).get();

  let expiresAt: string | null = null;
  if (durationDays > 0) {
    expiresAt = new Date(Date.now() + durationDays * MS_DAY).toISOString();
    await tx.insert(playerTemporaryCosmeticGrants).values({
      playerId: params.playerId,
      avatarFrameId: params.avatarFrameId,
      sourceItemId: params.itemId,
      insertedAvatarFrameUnlock: Boolean(inserted),
      grantedAt: nowIso,
      expiresAt,
    }).run();
  }

  return {
    inserted: Boolean(inserted),
    temporary: durationDays > 0,
    durationDays,
    expiresAt,
  };
}

async function cleanupExpiredTemporaryCosmeticsWithExecutor(tx: DbExecutor, nowIso: string) {
  const expiredRows = await tx.select({
    id: playerTemporaryCosmeticGrants.id,
    playerId: playerTemporaryCosmeticGrants.playerId,
    avatarId: playerTemporaryCosmeticGrants.avatarId,
    avatarFrameId: playerTemporaryCosmeticGrants.avatarFrameId,
    insertedAvatarUnlock: playerTemporaryCosmeticGrants.insertedAvatarUnlock,
    insertedAvatarFrameUnlock: playerTemporaryCosmeticGrants.insertedAvatarFrameUnlock,
  }).from(playerTemporaryCosmeticGrants)
    .where(and(
      isNull(playerTemporaryCosmeticGrants.revokedAt),
      lte(playerTemporaryCosmeticGrants.expiresAt, nowIso),
    ))
    .all();

  for (const row of expiredRows) {
    if (row.insertedAvatarUnlock && row.avatarId) {
      const activeAvatarGrant = await tx.select({ id: playerTemporaryCosmeticGrants.id })
        .from(playerTemporaryCosmeticGrants)
        .where(and(
          eq(playerTemporaryCosmeticGrants.playerId, row.playerId),
          eq(playerTemporaryCosmeticGrants.avatarId, row.avatarId),
          isNull(playerTemporaryCosmeticGrants.revokedAt),
          gt(playerTemporaryCosmeticGrants.expiresAt, nowIso),
        ))
        .get();

      if (!activeAvatarGrant) {
        await tx.delete(playerUnlockedAvatars).where(and(
          eq(playerUnlockedAvatars.playerId, row.playerId),
          eq(playerUnlockedAvatars.avatarId, row.avatarId),
        )).run();

        const avatar = await tx.select({
          isPublic: avatarAssets.isPublic,
        }).from(avatarAssets)
          .where(eq(avatarAssets.id, row.avatarId))
          .get();

        if (avatar && !avatar.isPublic) {
          const stillUnlocked = await tx.select({ avatarId: playerUnlockedAvatars.avatarId })
            .from(playerUnlockedAvatars)
            .where(and(
              eq(playerUnlockedAvatars.playerId, row.playerId),
              eq(playerUnlockedAvatars.avatarId, row.avatarId),
            ))
            .get();

          if (!stillUnlocked) {
            await tx.update(players).set({
              avatarId: null,
              updatedAt: nowIso,
            }).where(and(
              eq(players.id, row.playerId),
              eq(players.avatarId, row.avatarId),
            )).run();
          }
        }
      }
    }

    if (row.insertedAvatarFrameUnlock && row.avatarFrameId) {
      const activeFrameGrant = await tx.select({ id: playerTemporaryCosmeticGrants.id })
        .from(playerTemporaryCosmeticGrants)
        .where(and(
          eq(playerTemporaryCosmeticGrants.playerId, row.playerId),
          eq(playerTemporaryCosmeticGrants.avatarFrameId, row.avatarFrameId),
          isNull(playerTemporaryCosmeticGrants.revokedAt),
          gt(playerTemporaryCosmeticGrants.expiresAt, nowIso),
        ))
        .get();

      if (!activeFrameGrant) {
        await tx.delete(playerUnlockedAvatarFrames).where(and(
          eq(playerUnlockedAvatarFrames.playerId, row.playerId),
          eq(playerUnlockedAvatarFrames.avatarFrameId, row.avatarFrameId),
        )).run();

        const avatarFrame = await tx.select({
          isPublic: avatarFrameAssets.isPublic,
        }).from(avatarFrameAssets)
          .where(eq(avatarFrameAssets.id, row.avatarFrameId))
          .get();

        if (avatarFrame && !avatarFrame.isPublic) {
          const stillUnlocked = await tx.select({ avatarFrameId: playerUnlockedAvatarFrames.avatarFrameId })
            .from(playerUnlockedAvatarFrames)
            .where(and(
              eq(playerUnlockedAvatarFrames.playerId, row.playerId),
              eq(playerUnlockedAvatarFrames.avatarFrameId, row.avatarFrameId),
            ))
            .get();

          if (!stillUnlocked) {
            await tx.update(players).set({
              avatarFrameId: null,
              updatedAt: nowIso,
            }).where(and(
              eq(players.id, row.playerId),
              eq(players.avatarFrameId, row.avatarFrameId),
            )).run();
          }
        }
      }
    }

    await tx.update(playerTemporaryCosmeticGrants).set({
      revokedAt: nowIso,
    }).where(eq(playerTemporaryCosmeticGrants.id, row.id)).run();
  }

  return { revoked: expiredRows.length };
}

export async function cleanupExpiredTemporaryCosmetics() {
  const nowIso = new Date().toISOString();
  return await db.transaction(async (tx) => {
    return await cleanupExpiredTemporaryCosmeticsWithExecutor(tx, nowIso);
  });
}

export function scheduleExpiredTemporaryCosmeticsCleanup() {
  const globalStore = globalThis as TemporaryCosmeticCleanupGlobal;
  const nowMs = Date.now();
  const lastRunAt = globalStore.__temporaryCosmeticCleanupLastRunAt || 0;
  if (globalStore.__temporaryCosmeticCleanupPromise) {
    return globalStore.__temporaryCosmeticCleanupPromise;
  }
  if (nowMs - lastRunAt < TEMPORARY_COSMETIC_CLEANUP_THROTTLE_MS) {
    return Promise.resolve({ revoked: 0 });
  }

  globalStore.__temporaryCosmeticCleanupLastRunAt = nowMs;
  globalStore.__temporaryCosmeticCleanupPromise = cleanupExpiredTemporaryCosmetics()
    .catch((error) => {
      console.error("[temporary-cosmetic-cleanup] failed:", error);
      return { revoked: 0 };
    })
    .finally(() => {
      globalStore.__temporaryCosmeticCleanupPromise = null;
    });

  return globalStore.__temporaryCosmeticCleanupPromise;
}
