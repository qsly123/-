import type { SecretRealmMonsterRole, SecretRealmSpecialType } from "@/types/game";

export const HONGMENG_BOTTLE_ITEM_ID = "item_hongmeng_zhangtian_bottle";
export const WILD_WOLF_VALLEY_NAME = "野狼谷";
export const WILD_WOLF_VALLEY_TAG = "wild_wolf_valley";
export const WILD_WOLF_VALLEY_WIDTH = 80;
export const WILD_WOLF_VALLEY_HEIGHT = 80;
export const WILD_WOLF_VALLEY_GLOBAL_RUNTIME_CONFIG_KEY = "SECRET_REALM_WILD_WOLF_VALLEY_RUNTIME_JSON";
export const WILD_WOLF_VALLEY_GLOBAL_COOLDOWN_MS = 60 * 60 * 1000;
export const WILD_WOLF_VALLEY_GLOBAL_LIFETIME_MS = 60 * 60 * 1000;
export const WILD_WOLF_VALLEY_INSTANCE_LIFETIME_MS = 90 * 60 * 1000;
export const WILD_WOLF_VALLEY_SPAWN_BASE_CHANCE = 0.35;
export const WILD_WOLF_VALLEY_SPAWN_MISS_BONUS_CHANCE = 0.15;
export const WILD_WOLF_VALLEY_FORCE_SPAWN_WINDOW = 5;
export const WILD_WOLF_VALLEY_MOB_BASE_CHANCE = 0.001;
export const WILD_WOLF_VALLEY_MOB_STEP_CHANCE = 0.001;
export const WILD_WOLF_VALLEY_BOSS_BASE_CHANCE = 0.01;
export const WILD_WOLF_VALLEY_BOSS_STEP_CHANCE = 0.01;

export type WildWolfValleySpawnRuntime = {
  lastAttemptAt: string | null;
  lastSpawnAt: string | null;
  missCount: number;
  lastResolvedMapId: string | null;
};

export function resolveSecretRealmSpecialType(params: {
  name?: string | null;
  tags?: unknown;
}): SecretRealmSpecialType | null {
  const name = String(params.name || "").trim();
  if (name === WILD_WOLF_VALLEY_NAME) {
    return "wild_wolf_valley";
  }

  const tags = Array.isArray(params.tags) ? params.tags : [];
  if (tags.includes(WILD_WOLF_VALLEY_TAG)) {
    return "wild_wolf_valley";
  }

  return null;
}

export function isWildWolfValleyRealm(params: {
  name?: string | null;
  tags?: unknown;
}) {
  return resolveSecretRealmSpecialType(params) === "wild_wolf_valley";
}

export function getSecretRealmSpecialHint(specialType: SecretRealmSpecialType | null | undefined) {
  if (specialType === "wild_wolf_valley") {
    return "传闻鸿蒙至宝掌天瓶现世。野狼谷每小时独立判定一次，未命中会逐步提高刷新概率；未持有掌天瓶时，谷中妖兽仍会掉落正常秘境奖励，并额外独立判定掌天瓶机缘。";
  }
  return null;
}

export function normalizeWildWolfValleySpawnRuntime(
  value: unknown,
): WildWolfValleySpawnRuntime {
  if (!value || typeof value !== "object") {
    return {
      lastAttemptAt: null,
      lastSpawnAt: null,
      missCount: 0,
      lastResolvedMapId: null,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    lastAttemptAt: typeof record.lastAttemptAt === "string" && record.lastAttemptAt.trim()
      ? record.lastAttemptAt
      : null,
    lastSpawnAt: typeof record.lastSpawnAt === "string" && record.lastSpawnAt.trim()
      ? record.lastSpawnAt
      : null,
    missCount: Math.max(
      0,
      Math.min(
        WILD_WOLF_VALLEY_FORCE_SPAWN_WINDOW - 1,
        Math.floor(Number(record.missCount || 0)),
      ),
    ),
    lastResolvedMapId: typeof record.lastResolvedMapId === "string" && record.lastResolvedMapId.trim()
      ? record.lastResolvedMapId
      : null,
  };
}

export function getWildWolfValleySpawnChance(missCount: number | null | undefined) {
  const normalizedMissCount = Math.max(
    0,
    Math.min(
      WILD_WOLF_VALLEY_FORCE_SPAWN_WINDOW - 1,
      Math.floor(Number(missCount || 0)),
    ),
  );
  if (normalizedMissCount >= WILD_WOLF_VALLEY_FORCE_SPAWN_WINDOW - 1) {
    return 1;
  }

  return Math.min(
    1,
    WILD_WOLF_VALLEY_SPAWN_BASE_CHANCE + normalizedMissCount * WILD_WOLF_VALLEY_SPAWN_MISS_BONUS_CHANCE,
  );
}

export function getWildWolfValleyBottleChance(params: {
  role: SecretRealmMonsterRole;
  counter: number | null | undefined;
}) {
  const counter = Math.max(0, Math.floor(Number(params.counter || 0)));
  const isBoss = params.role === "boss";
  const baseChance = isBoss ? WILD_WOLF_VALLEY_BOSS_BASE_CHANCE : WILD_WOLF_VALLEY_MOB_BASE_CHANCE;
  const stepChance = isBoss ? WILD_WOLF_VALLEY_BOSS_STEP_CHANCE : WILD_WOLF_VALLEY_MOB_STEP_CHANCE;
  return Math.min(1, baseChance + counter * stepChance);
}
