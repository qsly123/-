import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items, pillToxicityConfigs, players } from "@/db/schema";
import {
  isMissingPillToxicityConfigTableError,
  isMissingPlayerPillToxicityColumnError,
  isPlayerPillToxicitySchemaMissing,
} from "@/modules/character/services/pill-toxicity-schema-compat";
import type { ItemEffect } from "@/types/game";

const DEFAULT_PILL_TOXICITY_KEY = "default";
const DEFAULT_MAX_TOXICITY = 20;
const DEFAULT_RECOVER_INTERVAL_MINUTES = 8;
const CONFIG_CACHE_TTL_MS = 30 * 1000;

type PillToxicityPlayerSource = Pick<
  typeof players.$inferSelect,
  "id" | "pillToxicity" | "pillToxicityUpdatedAt"
>;

type PillToxicityItemSource = Pick<
  typeof items.$inferSelect,
  "itemType" | "pillToxicity"
>;

export interface PillToxicityConfigSnapshot {
  key: string;
  maxToxicity: number;
  recoverIntervalMinutes: number;
}

export interface PillToxicityStatus {
  current: number;
  max: number;
  recoverIntervalMinutes: number;
  nextRecoverInSeconds: number | null;
  isFull: boolean;
}

interface RecoveryComputationResult {
  current: number;
  normalizedUpdatedAt: string;
  nextRecoverInSeconds: number | null;
}

let pillToxicityConfigCache: {
  value: PillToxicityConfigSnapshot;
  expiresAt: number;
} | null = null;
let pillToxicityConfigTableAvailable: boolean | null = null;

function buildDefaultPillToxicityConfigSnapshot(): PillToxicityConfigSnapshot {
  return {
    key: DEFAULT_PILL_TOXICITY_KEY,
    maxToxicity: DEFAULT_MAX_TOXICITY,
    recoverIntervalMinutes: DEFAULT_RECOVER_INTERVAL_MINUTES,
  };
}

function normalizePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function resolveUpdatedAtIso(raw: string | null | undefined, nowIso: string) {
  if (!raw || typeof raw !== "string") {
    return nowIso;
  }
  const text = raw.trim();
  if (!text) {
    return nowIso;
  }
  const parsedMs = Date.parse(text);
  if (!Number.isFinite(parsedMs)) {
    return nowIso;
  }
  return new Date(parsedMs).toISOString();
}

function computeRecoveredPillToxicity(params: {
  current: number;
  updatedAt: string | null | undefined;
  now: Date;
  recoverIntervalMinutes: number;
}): RecoveryComputationResult {
  const nowIso = params.now.toISOString();
  const nowMs = params.now.getTime();
  const current = Math.max(0, Math.floor(Number(params.current || 0)));
  const intervalMinutes = normalizePositiveInt(params.recoverIntervalMinutes, DEFAULT_RECOVER_INTERVAL_MINUTES);
  const intervalMs = intervalMinutes * 60 * 1000;
  const updatedAtIso = resolveUpdatedAtIso(params.updatedAt, nowIso);
  const updatedAtMs = Date.parse(updatedAtIso);

  if (current <= 0) {
    return {
      current: 0,
      normalizedUpdatedAt: nowIso,
      nextRecoverInSeconds: null,
    };
  }

  const elapsedMs = Math.max(0, nowMs - updatedAtMs);
  const recovered = Math.min(current, Math.floor(elapsedMs / intervalMs));
  const remaining = Math.max(0, current - recovered);

  if (remaining <= 0) {
    return {
      current: 0,
      normalizedUpdatedAt: nowIso,
      nextRecoverInSeconds: null,
    };
  }

  const normalizedUpdatedAt = new Date(updatedAtMs + recovered * intervalMs).toISOString();
  const elapsedSinceNormalized = Math.max(0, nowMs - Date.parse(normalizedUpdatedAt));
  const remainingMs = Math.max(0, intervalMs - elapsedSinceNormalized);

  return {
    current: remaining,
    normalizedUpdatedAt,
    nextRecoverInSeconds: Math.ceil(remainingMs / 1000),
  };
}

export async function getPillToxicityConfig(): Promise<PillToxicityConfigSnapshot> {
  const nowMs = Date.now();
  if (pillToxicityConfigCache && pillToxicityConfigCache.expiresAt > nowMs) {
    return pillToxicityConfigCache.value;
  }

  if (pillToxicityConfigTableAvailable === false) {
    const fallbackConfig = buildDefaultPillToxicityConfigSnapshot();
    pillToxicityConfigCache = {
      value: fallbackConfig,
      expiresAt: nowMs + CONFIG_CACHE_TTL_MS,
    };
    return fallbackConfig;
  }

  let row: typeof pillToxicityConfigs.$inferSelect | undefined;
  try {
    row = await db.select().from(pillToxicityConfigs)
      .where(eq(pillToxicityConfigs.key, DEFAULT_PILL_TOXICITY_KEY))
      .get();

    if (!row) {
      const nowIso = new Date(nowMs).toISOString();
      await db.insert(pillToxicityConfigs).values({
        key: DEFAULT_PILL_TOXICITY_KEY,
        maxToxicity: DEFAULT_MAX_TOXICITY,
        recoverIntervalMinutes: DEFAULT_RECOVER_INTERVAL_MINUTES,
        createdAt: nowIso,
        updatedAt: nowIso,
      }).onConflictDoNothing().run();

      row = await db.select().from(pillToxicityConfigs)
        .where(eq(pillToxicityConfigs.key, DEFAULT_PILL_TOXICITY_KEY))
        .get();
    }
    pillToxicityConfigTableAvailable = true;
  } catch (error) {
    if (!isMissingPillToxicityConfigTableError(error)) {
      throw error;
    }
    pillToxicityConfigTableAvailable = false;
  }

  const config: PillToxicityConfigSnapshot = row
    ? {
      key: DEFAULT_PILL_TOXICITY_KEY,
      maxToxicity: normalizePositiveInt(row.maxToxicity, DEFAULT_MAX_TOXICITY),
      recoverIntervalMinutes: normalizePositiveInt(row.recoverIntervalMinutes, DEFAULT_RECOVER_INTERVAL_MINUTES),
    }
    : buildDefaultPillToxicityConfigSnapshot();

  pillToxicityConfigCache = {
    value: config,
    expiresAt: nowMs + CONFIG_CACHE_TTL_MS,
  };

  return config;
}

export async function recoverPlayerPillToxicity<T extends PillToxicityPlayerSource>(
  player: T,
  now = new Date(),
  options?: { persist?: boolean },
): Promise<T> {
  const config = await getPillToxicityConfig();
  const recovered = computeRecoveredPillToxicity({
    current: player.pillToxicity,
    updatedAt: player.pillToxicityUpdatedAt,
    now,
    recoverIntervalMinutes: config.recoverIntervalMinutes,
  });

  if (isPlayerPillToxicitySchemaMissing()) {
    return {
      ...player,
      pillToxicity: recovered.current,
      pillToxicityUpdatedAt: recovered.normalizedUpdatedAt,
    };
  }

  if (
    options?.persist !== false
    && (
    recovered.current !== Number(player.pillToxicity || 0)
    || recovered.normalizedUpdatedAt !== resolveUpdatedAtIso(player.pillToxicityUpdatedAt, now.toISOString())
    )
  ) {
    try {
      await db.update(players).set({
        pillToxicity: recovered.current,
        pillToxicityUpdatedAt: recovered.normalizedUpdatedAt,
        updatedAt: now.toISOString(),
      }).where(eq(players.id, player.id)).run();
    } catch (error) {
      if (!isMissingPlayerPillToxicityColumnError(error)) {
        throw error;
      }
    }
  }

  return {
    ...player,
    pillToxicity: recovered.current,
    pillToxicityUpdatedAt: recovered.normalizedUpdatedAt,
  };
}

export async function buildPlayerPillToxicityStatus(player: PillToxicityPlayerSource, now = new Date()): Promise<PillToxicityStatus> {
  const config = await getPillToxicityConfig();
  const recovered = computeRecoveredPillToxicity({
    current: player.pillToxicity,
    updatedAt: player.pillToxicityUpdatedAt,
    now,
    recoverIntervalMinutes: config.recoverIntervalMinutes,
  });

  return {
    current: recovered.current,
    max: config.maxToxicity,
    recoverIntervalMinutes: config.recoverIntervalMinutes,
    nextRecoverInSeconds: recovered.nextRecoverInSeconds,
    isFull: recovered.current >= config.maxToxicity,
  };
}

export function getXpPillToxicityGain(item: PillToxicityItemSource, effects: ItemEffect[]) {
  if (item.itemType !== "consumable") {
    return 0;
  }
  const hasXpEffect = effects.some((effect) => effect?.type === "boost_xp" && Number(effect.value || 0) > 0);
  if (!hasXpEffect) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(item.pillToxicity || 0)));
}
