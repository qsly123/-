import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { STAMINA_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

export const STAMINA_MAX = 100;
export const STAMINA_RECOVER_INTERVAL_MINUTES = 60;
export const STAMINA_RECOVER_PER_INTERVAL = 10;
export const STAMINA_RECOVER_PER_HOUR = 10;
export const STAMINA_RECOVER_INTERVAL_MS = 60 * 60 * 1000;
export const STAMINA_REWARD_COST = 1;
const STAMINA_SETTINGS_CACHE_TTL_MS = 30 * 1000;

type PlayerStaminaSource = Pick<typeof players.$inferSelect, "id" | "stamina" | "staminaUpdatedAt">;
type StaminaExecutor = Pick<typeof db, "execute" | "select" | "update">;

export interface StaminaSettings {
  max: number;
  recoverIntervalMinutes: number;
  recoverPerInterval: number;
  recoverPerHour: number;
  recoverIntervalMs: number;
}

const DEFAULT_STAMINA_SETTINGS: StaminaSettings = {
  max: STAMINA_MAX,
  recoverIntervalMinutes: STAMINA_RECOVER_INTERVAL_MINUTES,
  recoverPerInterval: STAMINA_RECOVER_PER_INTERVAL,
  recoverPerHour: STAMINA_RECOVER_PER_HOUR,
  recoverIntervalMs: STAMINA_RECOVER_INTERVAL_MS,
};

let staminaSettingsCache: {
  value: StaminaSettings;
  expiresAt: number;
} | null = null;

function normalizePositiveInteger(value: string | undefined, fallback: number) {
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

function toSafeStamina(value: unknown, maxStamina: number) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  const n = Math.floor(raw);
  return Math.max(0, Math.min(maxStamina, n));
}

function parseUpdatedAtMs(staminaUpdatedAt: string | null | undefined, nowMs: number) {
  const parsed = Date.parse(staminaUpdatedAt || "");
  if (Number.isNaN(parsed)) {
    return nowMs;
  }
  return parsed;
}

export async function getStaminaSettings(): Promise<StaminaSettings> {
  const nowMs = Date.now();
  if (staminaSettingsCache && staminaSettingsCache.expiresAt > nowMs) {
    return staminaSettingsCache.value;
  }

  const configMap = await getSystemConfigMap(STAMINA_CONFIG_KEYS);
  const max = normalizePositiveInteger(configMap.STAMINA_MAX, STAMINA_MAX);
  const recoverIntervalMinutes = normalizePositiveInteger(
    configMap.STAMINA_RECOVER_INTERVAL_MINUTES,
    STAMINA_RECOVER_INTERVAL_MINUTES
  );
  const recoverPerInterval = normalizePositiveInteger(
    configMap.STAMINA_RECOVER_PER_INTERVAL,
    STAMINA_RECOVER_PER_INTERVAL
  );
  const recoverPerHour = Number(((recoverPerInterval * 60) / recoverIntervalMinutes).toFixed(2));
  const recoverIntervalMs = recoverIntervalMinutes * 60 * 1000;

  const settings: StaminaSettings = {
    max,
    recoverIntervalMinutes,
    recoverPerInterval,
    recoverPerHour,
    recoverIntervalMs,
  };

  staminaSettingsCache = {
    value: settings,
    expiresAt: nowMs + STAMINA_SETTINGS_CACHE_TTL_MS,
  };
  return settings;
}

export function recoverStaminaSnapshot(params: {
  stamina: number;
  staminaUpdatedAt: string | null | undefined;
  nowMs?: number;
  settings?: StaminaSettings;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const settings = params.settings || DEFAULT_STAMINA_SETTINGS;
  const current = toSafeStamina(params.stamina, settings.max);
  const previousUpdatedAt = typeof params.staminaUpdatedAt === "string" && params.staminaUpdatedAt
    ? params.staminaUpdatedAt
    : new Date(nowMs).toISOString();
  const lastMs = parseUpdatedAtMs(params.staminaUpdatedAt, nowMs);

  if (current >= settings.max) {
    if (nowMs - lastMs < settings.recoverIntervalMs) {
      return {
        stamina: settings.max,
        staminaUpdatedAt: previousUpdatedAt,
        changed: current !== params.stamina,
      };
    }
    return {
      stamina: settings.max,
      staminaUpdatedAt: new Date(nowMs).toISOString(),
      changed: true,
    };
  }

  const elapsedMs = Math.max(0, nowMs - lastMs);
  const recoverSteps = Math.floor(elapsedMs / settings.recoverIntervalMs);
  if (recoverSteps <= 0) {
    return {
      stamina: current,
      staminaUpdatedAt: previousUpdatedAt,
      changed: current !== params.stamina,
    };
  }

  const recovered = recoverSteps * settings.recoverPerInterval;
  const nextStamina = Math.min(settings.max, current + recovered);
  const nextUpdatedAt = nextStamina >= settings.max
    ? new Date(nowMs).toISOString()
    : new Date(lastMs + recoverSteps * settings.recoverIntervalMs).toISOString();

  return {
    stamina: nextStamina,
    staminaUpdatedAt: nextUpdatedAt,
    changed: nextStamina !== current || nextUpdatedAt !== previousUpdatedAt,
  };
}

function getExecuteRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }
  return [];
}

async function persistPlayerStamina(
  playerId: string,
  stamina: number,
  staminaUpdatedAt: string,
  executor: Pick<typeof db, "update"> = db,
) {
  await executor.update(players).set({
    stamina,
    staminaUpdatedAt,
    updatedAt: new Date().toISOString(),
  }).where(eq(players.id, playerId)).run();
}

export async function recoverPlayerStamina<T extends PlayerStaminaSource>(
  player: T,
  options?: { persist?: boolean },
): Promise<T> {
  const settings = await getStaminaSettings();
  const recovered = recoverStaminaSnapshot({
    stamina: player.stamina,
    staminaUpdatedAt: player.staminaUpdatedAt,
    settings,
  });
  if (!recovered.changed) {
    return player;
  }

  if (options?.persist !== false) {
    await persistPlayerStamina(player.id, recovered.stamina, recovered.staminaUpdatedAt);
  }
  return {
    ...player,
    stamina: recovered.stamina,
    staminaUpdatedAt: recovered.staminaUpdatedAt,
  };
}

async function lockPlayerStaminaRow(executor: StaminaExecutor, playerId: string) {
  const rows = await executor.execute(sql<PlayerStaminaSource[]>`
    select
      id,
      stamina,
      stamina_updated_at as "staminaUpdatedAt"
    from players
    where id = ${playerId}
    for update
  `);
  const [row] = getExecuteRows<PlayerStaminaSource>(rows);
  return row || null;
}

export async function consumePlayerStaminaForRewardTx(
  executor: StaminaExecutor,
  playerId: string,
  cost = STAMINA_REWARD_COST,
) {
  const settings = await getStaminaSettings();
  const player = await lockPlayerStaminaRow(executor, playerId);

  if (!player) {
    return { consumed: false, stamina: 0 };
  }

  const recovered = recoverStaminaSnapshot({
    stamina: player.stamina,
    staminaUpdatedAt: player.staminaUpdatedAt,
    settings,
  });

  if (recovered.stamina < cost) {
    if (recovered.changed) {
      await persistPlayerStamina(playerId, recovered.stamina, recovered.staminaUpdatedAt, executor);
    }
    return {
      consumed: false,
      stamina: recovered.stamina,
    };
  }

  const nowIso = new Date().toISOString();
  const nextStamina = recovered.stamina - cost;
  await executor.update(players).set({
    stamina: nextStamina,
    staminaUpdatedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(players.id, playerId)).run();

  return {
    consumed: true,
    stamina: nextStamina,
  };
}

export async function consumePlayerStaminaForReward(playerId: string, cost = STAMINA_REWARD_COST) {
  return db.transaction((tx) => consumePlayerStaminaForRewardTx(tx, playerId, cost));
}
