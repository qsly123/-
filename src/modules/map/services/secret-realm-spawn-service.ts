import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { maps, npcs, players, secretRealmSpawns, secretRealmTemplates, systemConfigs } from "@/db/schema";
import { publishSystemAnnouncement } from "@/modules/chat/services/chat-service";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import { publishMapSecretRealmChanged } from "@/modules/map/services/map-presence";
import {
  normalizeSecretRealmRarity,
  normalizeSecretRealmSizeTier,
  pickSecretRealmRarity,
  randomInt,
  SECRET_REALM_GLOBAL_COOLDOWN_MS,
  SECRET_REALM_GLOBAL_LIFETIME_MS,
  SECRET_REALM_MAX_GLOBAL_SPAWNS_PER_TICK,
  SECRET_REALM_PERSONAL_COOLDOWN_MS,
  SECRET_REALM_PERSONAL_LIFETIME_MS,
  SECRET_REALM_PERSONAL_PITY_THRESHOLD,
} from "@/modules/map/services/secret-realm-balance-service";
import { buildSecretRealmDropIntel } from "@/modules/map/services/secret-realm-drop-intel";
import { buildSecretRealmLootBlueprint } from "@/modules/map/services/secret-realm-drop-generation-service";
import { ensureSecretRealmTemplate, ensureWildWolfValleyTemplate } from "@/modules/map/services/secret-realm-generation-service";
import {
  WILD_WOLF_VALLEY_FORCE_SPAWN_WINDOW,
  WILD_WOLF_VALLEY_GLOBAL_COOLDOWN_MS,
  WILD_WOLF_VALLEY_GLOBAL_LIFETIME_MS,
  WILD_WOLF_VALLEY_GLOBAL_RUNTIME_CONFIG_KEY,
  WILD_WOLF_VALLEY_NAME,
  getWildWolfValleySpawnChance,
  getSecretRealmSpecialHint,
  normalizeWildWolfValleySpawnRuntime,
  resolveSecretRealmSpecialType,
} from "@/modules/map/services/secret-realm-specials";
import { buildSecretRealmSeedFocusView } from "@/modules/map/services/secret-realm-theme-profile-service";
import type { SecretRealmSpawnView } from "@/modules/map/services/secret-realm-types";
import { listMonsterPositionSnapshotsByMap } from "@/modules/map/services/monster-position";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { getPartyMovementContext } from "@/modules/social/infrastructure/party-service";
import { OPEN_WORLD_MAP_TYPE } from "@/modules/world/services/world-config";

type MapRow = {
  id: string;
  name: string;
  width: number;
  height: number;
  mapType: string;
  minRealm: number;
  tilesData: unknown;
};

function supportsLegacySecretRealmSpawnMap(map: Pick<MapRow, "mapType">) {
  return map.mapType !== "secret_realm_instance" && map.mapType !== OPEN_WORLD_MAP_TYPE;
}

type TileEntity = {
  x: number;
  y: number;
  walkable?: boolean;
};

type SecretRealmSpawnEnsureEntry = {
  completedAtMs: number;
  promise: Promise<void> | null;
  personalPromises: Map<string, Promise<void>>;
};

type SecretRealmSpawnEnsureGlobal = typeof globalThis & {
  __secretRealmSpawnEnsureByMapId?: Map<string, SecretRealmSpawnEnsureEntry>;
  __legacySecretRealmSpawnMapCache?: Map<string, LegacySecretRealmSpawnMapCacheEntry>;
};

const SECRET_REALM_SPAWN_ENSURE_TTL_MS = 30_000;
const LEGACY_SECRET_REALM_MAP_CACHE_TTL_MS = 60_000;

type LegacySecretRealmSpawnMapCacheEntry = {
  map: MapRow | null;
  expiresAtMs: number;
};

function getSecretRealmSpawnEnsureStore() {
  const globalStore = globalThis as SecretRealmSpawnEnsureGlobal;
  globalStore.__secretRealmSpawnEnsureByMapId = ensureGlobalMap<string, SecretRealmSpawnEnsureEntry>(
    globalStore as Record<string, unknown>,
    "__secretRealmSpawnEnsureByMapId",
  );
  return globalStore.__secretRealmSpawnEnsureByMapId;
}

function getLegacySecretRealmSpawnMapCache() {
  const globalStore = globalThis as SecretRealmSpawnEnsureGlobal;
  globalStore.__legacySecretRealmSpawnMapCache = ensureGlobalMap<string, LegacySecretRealmSpawnMapCacheEntry>(
    globalStore as Record<string, unknown>,
    "__legacySecretRealmSpawnMapCache",
  );
  return globalStore.__legacySecretRealmSpawnMapCache;
}

function createSecretRealmSpawnEnsureEntry(completedAtMs = 0): SecretRealmSpawnEnsureEntry {
  return {
    completedAtMs,
    promise: null,
    personalPromises: new Map<string, Promise<void>>(),
  };
}

async function resolveLegacySecretRealmSpawnMap(params: {
  mapId: string;
  mapData?: MapRow;
}) {
  const normalizedMapId = String(params.mapId || params.mapData?.id || "").trim();
  if (!normalizedMapId) {
    return null;
  }

  const mapCache = getLegacySecretRealmSpawnMapCache();
  const nowMs = Date.now();
  const cached = mapCache.get(normalizedMapId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.map;
  }

  if (params.mapData && !supportsLegacySecretRealmSpawnMap(params.mapData)) {
    mapCache.set(normalizedMapId, {
      map: null,
      expiresAtMs: nowMs + LEGACY_SECRET_REALM_MAP_CACHE_TTL_MS,
    });
    return null;
  }

  const persistedMap = await db.select({
    id: maps.id,
    name: maps.name,
    width: maps.width,
    height: maps.height,
    mapType: maps.mapType,
    minRealm: maps.minRealm,
    tilesData: maps.tilesData,
  }).from(maps).where(eq(maps.id, normalizedMapId)).get();

  const resolvedMap = persistedMap && supportsLegacySecretRealmSpawnMap(persistedMap)
    ? persistedMap
    : null;

  mapCache.set(normalizedMapId, {
    map: resolvedMap,
    expiresAtMs: nowMs + LEGACY_SECRET_REALM_MAP_CACHE_TTL_MS,
  });

  return resolvedMap;
}

function buildPositionKey(x: number, y: number) {
  return `${x},${y}`;
}

function toIsoAfter(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function parseIsoMs(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function readWildWolfValleySpawnRuntime() {
  const row = await db.select({
    value: systemConfigs.value,
  }).from(systemConfigs).where(eq(systemConfigs.key, WILD_WOLF_VALLEY_GLOBAL_RUNTIME_CONFIG_KEY)).get();

  if (!row?.value) {
    return normalizeWildWolfValleySpawnRuntime(null);
  }

  try {
    return normalizeWildWolfValleySpawnRuntime(JSON.parse(row.value));
  } catch {
    return normalizeWildWolfValleySpawnRuntime(null);
  }
}

async function writeWildWolfValleySpawnRuntime(payload: {
  lastAttemptAt: string;
  lastSpawnAt?: string | null;
  missCount: number;
  lastResolvedMapId?: string | null;
}) {
  const existing = await readWildWolfValleySpawnRuntime();
  const nowIso = payload.lastAttemptAt;
  const nextValue = JSON.stringify({
    lastAttemptAt: payload.lastAttemptAt,
    lastSpawnAt: payload.lastSpawnAt ?? existing.lastSpawnAt ?? null,
    missCount: Math.max(0, Math.min(WILD_WOLF_VALLEY_FORCE_SPAWN_WINDOW - 1, Math.floor(payload.missCount || 0))),
    lastResolvedMapId: payload.lastResolvedMapId ?? existing.lastResolvedMapId ?? null,
  });

  await db.insert(systemConfigs).values({
    key: WILD_WOLF_VALLEY_GLOBAL_RUNTIME_CONFIG_KEY,
    value: nextValue,
    group: "game",
    isSecret: false,
    description: "野狼谷特殊秘境全局刷新运行态",
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: systemConfigs.key,
    set: {
      value: nextValue,
      group: "game",
      isSecret: false,
      description: "野狼谷特殊秘境全局刷新运行态",
      updatedAt: nowIso,
    },
  }).run();
}

function pickSpawnSizeTier() {
  const roll = Math.random();
  if (roll > 0.88) return "large" as const;
  if (roll > 0.52) return "medium" as const;
  return "small" as const;
}

function buildBlockedTiles(params: {
  width: number;
  height: number;
  tilesData: unknown;
  npcPositions: Array<{ positionX: number; positionY: number }>;
  monsterPositions: Array<{ positionX: number; positionY: number }>;
  existingSpawnPositions: Array<{ positionX: number; positionY: number }>;
}) {
  const blocked = new Set<string>();
  const tiles = Array.isArray(params.tilesData) ? params.tilesData as TileEntity[] : [];

  for (const tile of tiles) {
    if (tile.walkable === false) {
      blocked.add(buildPositionKey(tile.x, tile.y));
    }
  }
  for (const npc of params.npcPositions) {
    blocked.add(buildPositionKey(npc.positionX, npc.positionY));
  }
  for (const monster of params.monsterPositions) {
    blocked.add(buildPositionKey(monster.positionX, monster.positionY));
  }
  for (const spawn of params.existingSpawnPositions) {
    blocked.add(buildPositionKey(spawn.positionX, spawn.positionY));
  }

  return blocked;
}

async function pickSpawnPosition(map: MapRow) {
  const nowIso = new Date().toISOString();
  const [npcPositions, monsterPositions, existingSpawnPositions] = await Promise.all([
    db.select({
      positionX: npcs.positionX,
      positionY: npcs.positionY,
    }).from(npcs).where(eq(npcs.mapId, map.id)).all(),
    listMonsterPositionSnapshotsByMap(map.id),
    db.select({
      positionX: secretRealmSpawns.positionX,
      positionY: secretRealmSpawns.positionY,
    }).from(secretRealmSpawns).where(and(
      eq(secretRealmSpawns.mapId, map.id),
      eq(secretRealmSpawns.status, "active"),
      gt(secretRealmSpawns.expiresAt, nowIso),
    )).all(),
  ]);

  const blocked = buildBlockedTiles({
    width: map.width,
    height: map.height,
    tilesData: map.tilesData,
    npcPositions,
    monsterPositions,
    existingSpawnPositions,
  });

  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const key = buildPositionKey(x, y);
      if (blocked.has(key)) {
        continue;
      }
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates[randomInt(0, candidates.length - 1)] || null;
}

async function cleanupExpiredSpawns(nowIso = new Date().toISOString()) {
  const expiredRows = await db.select({
    id: secretRealmSpawns.id,
    mapId: secretRealmSpawns.mapId,
    spawnType: secretRealmSpawns.spawnType,
    ownerPlayerId: secretRealmSpawns.ownerPlayerId,
    visiblePlayerIds: secretRealmSpawns.visiblePlayerIds,
  }).from(secretRealmSpawns).where(and(
    eq(secretRealmSpawns.status, "active"),
    sql`${secretRealmSpawns.expiresAt} <= ${nowIso}`,
  )).all();

  await db.update(secretRealmSpawns).set({
    status: "expired",
    updatedAt: nowIso,
  }).where(and(
    eq(secretRealmSpawns.status, "active"),
    sql`${secretRealmSpawns.expiresAt} <= ${nowIso}`,
  )).run();

  for (const row of expiredRows) {
    publishMapSecretRealmChanged({
      mapId: row.mapId,
      spawnId: row.id,
      spawnType: row.spawnType === "personal" ? "personal" : "global",
      status: "expired",
      ownerPlayerId: row.ownerPlayerId,
      visiblePlayerIds: Array.isArray(row.visiblePlayerIds) ? row.visiblePlayerIds : [],
    });
  }

  await db.execute(sql`
    UPDATE "secret_realm_spawns" s
    SET
      "instance_id" = NULL,
      "updated_at" = ${nowIso}
    WHERE s."instance_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "map_instances" mi
        WHERE mi."id" = s."instance_id"
      )
  `);
}

async function ensureGlobalSecretRealmSpawn(map: MapRow) {
  if (!supportsLegacySecretRealmSpawnMap(map)) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const wildWolfValleySpawn = await ensureWildWolfValleySpawn(map);
  if (wildWolfValleySpawn) {
    return wildWolfValleySpawn;
  }

  const activeSpawn = await db.select().from(secretRealmSpawns).where(and(
    eq(secretRealmSpawns.mapId, map.id),
    eq(secretRealmSpawns.spawnType, "global"),
    eq(secretRealmSpawns.status, "active"),
    gt(secretRealmSpawns.expiresAt, nowIso),
  )).get();

  if (activeSpawn) {
    return activeSpawn;
  }

  const latestSpawn = await db.select({
    spawnedAt: secretRealmSpawns.spawnedAt,
  }).from(secretRealmSpawns).where(and(
    eq(secretRealmSpawns.mapId, map.id),
    eq(secretRealmSpawns.spawnType, "global"),
  )).orderBy(desc(secretRealmSpawns.spawnedAt)).get();

  if (latestSpawn && parseIsoMs(latestSpawn.spawnedAt) + SECRET_REALM_GLOBAL_COOLDOWN_MS > Date.now()) {
    return null;
  }

  const position = await pickSpawnPosition(map);
  if (!position) {
    return null;
  }

  const sizeTier = pickSpawnSizeTier();
  const template = await ensureSecretRealmTemplate({
    recommendedRealm: Math.max(1, map.minRealm),
    sizeTier,
    rarity: pickSecretRealmRarity(sizeTier),
  });
  if (!template) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const inserted = await db.insert(secretRealmSpawns).values({
    templateId: template.id,
    mapId: map.id,
    spawnType: "global",
    status: "active",
    ownerPlayerId: null,
    visiblePlayerIds: [],
    positionX: position.x,
    positionY: position.y,
    spawnedAt: createdAt,
    expiresAt: toIsoAfter(SECRET_REALM_GLOBAL_LIFETIME_MS),
    enteredAt: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  }).returning().get();

  if (inserted) {
    publishMapSecretRealmChanged({
      mapId: inserted.mapId,
      spawnId: inserted.id,
      spawnType: "global",
      status: "active",
      ownerPlayerId: null,
      visiblePlayerIds: [],
    });
    void publishSystemAnnouncement(`【秘境刷新】${map.name}出现了秘境「${template.name}」。`).catch((error) => {
      console.error("Secret realm announcement error:", error);
    });
  }

  return inserted || null;
}

async function ensureWildWolfValleySpawn(map: MapRow) {
  if (!supportsLegacySecretRealmSpawnMap(map)) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const activeSpecial = await db.select({
    id: secretRealmSpawns.id,
  }).from(secretRealmSpawns)
    .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
    .where(and(
      eq(secretRealmSpawns.status, "active"),
      gt(secretRealmSpawns.expiresAt, nowIso),
      eq(secretRealmTemplates.name, WILD_WOLF_VALLEY_NAME),
    ))
    .get();
  if (activeSpecial) {
    return null;
  }

  const runtime = await readWildWolfValleySpawnRuntime();
  const latestSpecial = await db.select({
    spawnedAt: secretRealmSpawns.spawnedAt,
  }).from(secretRealmSpawns)
    .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
    .where(eq(secretRealmTemplates.name, WILD_WOLF_VALLEY_NAME))
    .orderBy(desc(secretRealmSpawns.spawnedAt))
    .get();

  const latestAttemptMs = Math.max(
    parseIsoMs(runtime.lastAttemptAt),
    parseIsoMs(latestSpecial?.spawnedAt),
  );
  if (latestAttemptMs + WILD_WOLF_VALLEY_GLOBAL_COOLDOWN_MS > Date.now()) {
    return null;
  }

  const spawnChance = getWildWolfValleySpawnChance(runtime.missCount);
  if (Math.random() > spawnChance) {
    await writeWildWolfValleySpawnRuntime({
      lastAttemptAt: nowIso,
      lastSpawnAt: runtime.lastSpawnAt || latestSpecial?.spawnedAt || null,
      missCount: runtime.missCount + 1,
      lastResolvedMapId: map.id,
    });
    return null;
  }

  const position = await pickSpawnPosition(map);
  if (!position) {
    return null;
  }

  const template = await ensureWildWolfValleyTemplate({
    recommendedRealm: Math.max(1, map.minRealm),
  });
  const duplicateGuard = await db.select({
    id: secretRealmSpawns.id,
  }).from(secretRealmSpawns)
    .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
    .where(and(
      eq(secretRealmSpawns.status, "active"),
      gt(secretRealmSpawns.expiresAt, nowIso),
      eq(secretRealmTemplates.name, WILD_WOLF_VALLEY_NAME),
    ))
    .get();
  if (duplicateGuard) {
    return null;
  }
  const createdAt = new Date().toISOString();
  const inserted = await db.insert(secretRealmSpawns).values({
    templateId: template.id,
    mapId: map.id,
    spawnType: "global",
    status: "active",
    ownerPlayerId: null,
    visiblePlayerIds: [],
    positionX: position.x,
    positionY: position.y,
    spawnedAt: createdAt,
    expiresAt: toIsoAfter(WILD_WOLF_VALLEY_GLOBAL_LIFETIME_MS),
    enteredAt: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  }).returning().get();

  if (inserted) {
    await writeWildWolfValleySpawnRuntime({
      lastAttemptAt: createdAt,
      lastSpawnAt: createdAt,
      missCount: 0,
      lastResolvedMapId: map.id,
    });
    publishMapSecretRealmChanged({
      mapId: inserted.mapId,
      spawnId: inserted.id,
      spawnType: "global",
      status: "active",
      ownerPlayerId: null,
      visiblePlayerIds: [],
    });
    void publishSystemAnnouncement(`【鸿蒙异兆】${map.name}出现了超大型秘境「${WILD_WOLF_VALLEY_NAME}」，传闻掌天瓶即将现世。`).catch((error) => {
      console.error("Wild wolf valley announcement error:", error);
    });
  }

  return inserted || null;
}

async function buildVisiblePlayerIds(playerId: string, mapId: string) {
  const visibleIds = new Set<string>([playerId]);
  const partyMovementContext = await getPartyMovementContext(playerId);
  if (!partyMovementContext || partyMovementContext.leaderPlayerId !== playerId) {
    return [...visibleIds];
  }

  const leader = partyMovementContext.members.find((member) => member.id === playerId);
  if (!leader) {
    return [...visibleIds];
  }

  for (const member of partyMovementContext.members) {
    if (member.currentMapId !== mapId) {
      continue;
    }
    if (Math.max(Math.abs(member.positionX - leader.positionX), Math.abs(member.positionY - leader.positionY)) > 1) {
      continue;
    }
    visibleIds.add(member.id);
  }

  return [...visibleIds];
}

async function ensurePersonalSecretRealmSpawn(map: MapRow, playerId: string) {
  if (!supportsLegacySecretRealmSpawnMap(map)) {
    return null;
  }

  const player = await db.select().from(players).where(eq(players.id, playerId)).get();
  if (!player || player.currentMapId !== map.id) {
    return null;
  }
  if (player.secretRealmPityCounter < SECRET_REALM_PERSONAL_PITY_THRESHOLD) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const activeSpawn = await db.select().from(secretRealmSpawns).where(and(
    eq(secretRealmSpawns.ownerPlayerId, player.id),
    eq(secretRealmSpawns.spawnType, "personal"),
    eq(secretRealmSpawns.status, "active"),
    gt(secretRealmSpawns.expiresAt, nowIso),
  )).get();
  if (activeSpawn) {
    return activeSpawn;
  }

  if (
    player.secretRealmLastPersonalSpawnAt
    && parseIsoMs(player.secretRealmLastPersonalSpawnAt) + SECRET_REALM_PERSONAL_COOLDOWN_MS > Date.now()
  ) {
    return null;
  }

  const position = await pickSpawnPosition(map);
  if (!position) {
    return null;
  }

  const sizeTier = player.realm >= 16 ? "large" : player.realm >= 8 ? "medium" : "small";
  const template = await ensureSecretRealmTemplate({
    recommendedRealm: player.realm,
    sizeTier,
    rarity: pickSecretRealmRarity(sizeTier),
  });
  if (!template) {
    return null;
  }

  const visiblePlayerIds = await buildVisiblePlayerIds(player.id, map.id);
  const createdAt = new Date().toISOString();
  const inserted = await db.insert(secretRealmSpawns).values({
    templateId: template.id,
    mapId: map.id,
    spawnType: "personal",
    status: "active",
    ownerPlayerId: player.id,
    visiblePlayerIds,
    positionX: position.x,
    positionY: position.y,
    spawnedAt: createdAt,
    expiresAt: toIsoAfter(SECRET_REALM_PERSONAL_LIFETIME_MS),
    enteredAt: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  }).returning().get();

  if (inserted) {
    await db.update(players).set({
      secretRealmPityCounter: 0,
      secretRealmLastPersonalSpawnAt: createdAt,
      updatedAt: createdAt,
    }).where(eq(players.id, player.id)).run();
    publishMapSecretRealmChanged({
      mapId: inserted.mapId,
      spawnId: inserted.id,
      spawnType: "personal",
      status: "active",
      ownerPlayerId: inserted.ownerPlayerId,
      visiblePlayerIds: Array.isArray(inserted.visiblePlayerIds) ? inserted.visiblePlayerIds : [],
    });
  }

  return inserted || null;
}

export async function ensureSecretRealmSpawnsForMap(params: {
  mapId: string;
  playerId?: string | null;
  mapData?: MapRow;
}) {
  const map = await resolveLegacySecretRealmSpawnMap({
    mapId: params.mapId,
    mapData: params.mapData,
  });

  if (!map) {
    return;
  }

  const ensureStore = getSecretRealmSpawnEnsureStore();
  const cachedEntry = ensureStore.get(map.id) || createSecretRealmSpawnEnsureEntry();
  if (!ensureStore.has(map.id)) {
    ensureStore.set(map.id, cachedEntry);
  }
  const nowMs = Date.now();

  const ensurePersonalForPlayer = async (playerId: string) => {
    const personalPromise = cachedEntry.personalPromises.get(playerId);
    if (personalPromise) {
      await personalPromise;
      return;
    }

    const nextPromise = (async () => {
      await ensurePersonalSecretRealmSpawn(map, playerId);
    })();
    cachedEntry.personalPromises.set(playerId, nextPromise);
    try {
      await nextPromise;
    } finally {
      cachedEntry.personalPromises.delete(playerId);
    }
  };

  if (cachedEntry?.promise) {
    await cachedEntry.promise;
    if (params.playerId) {
      await ensurePersonalForPlayer(params.playerId);
    }
    return;
  }
  if (cachedEntry && nowMs - cachedEntry.completedAtMs < SECRET_REALM_SPAWN_ENSURE_TTL_MS) {
    if (params.playerId) {
      await ensurePersonalForPlayer(params.playerId);
    }
    return;
  }

  const ensurePromise = (async () => {
    await cleanupExpiredSpawns();
    await ensureGlobalSecretRealmSpawn(map);
  })();

  cachedEntry.promise = ensurePromise;
  ensureStore.set(map.id, cachedEntry);

  try {
    await ensurePromise;
    cachedEntry.completedAtMs = Date.now();
    cachedEntry.promise = null;
    ensureStore.set(map.id, cachedEntry);
    if (params.playerId) {
      await ensurePersonalForPlayer(params.playerId);
    }
  } catch (error) {
    cachedEntry.promise = null;
    ensureStore.set(map.id, cachedEntry);
    throw error;
  }
}

export async function listVisibleSecretRealmSpawns(params: {
  mapId: string;
  playerId: string;
}): Promise<SecretRealmSpawnView[]> {
  const nowIso = new Date().toISOString();
  const rows = await db.select({
    id: secretRealmSpawns.id,
    templateId: secretRealmSpawns.templateId,
    mapId: secretRealmSpawns.mapId,
    mapName: maps.name,
    instanceId: secretRealmSpawns.instanceId,
    spawnType: secretRealmSpawns.spawnType,
    status: secretRealmSpawns.status,
    ownerPlayerId: secretRealmSpawns.ownerPlayerId,
    visiblePlayerIds: secretRealmSpawns.visiblePlayerIds,
    positionX: secretRealmSpawns.positionX,
    positionY: secretRealmSpawns.positionY,
    expiresAt: secretRealmSpawns.expiresAt,
    name: secretRealmTemplates.name,
    description: secretRealmTemplates.description,
    announcement: secretRealmTemplates.announcement,
    theme: secretRealmTemplates.theme,
    bossPool: secretRealmTemplates.bossPool,
    bossBackground: secretRealmTemplates.bossBackground,
    tags: secretRealmTemplates.tags,
    sizeTier: secretRealmTemplates.sizeTier,
    rarity: secretRealmTemplates.rarity,
    recommendedRealm: secretRealmTemplates.recommendedRealm,
    rewardBudget: secretRealmTemplates.rewardBudget,
    snapshotJson: secretRealmTemplates.snapshotJson,
  }).from(secretRealmSpawns)
    .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
    .innerJoin(maps, eq(maps.id, secretRealmSpawns.mapId))
    .where(and(
      eq(secretRealmSpawns.mapId, params.mapId),
      eq(secretRealmSpawns.status, "active"),
      gt(secretRealmSpawns.expiresAt, nowIso),
    ))
    .all();

  return (await Promise.all(rows
    .filter((row) => (
      row.spawnType === "global"
      || row.ownerPlayerId === params.playerId
      || (Array.isArray(row.visiblePlayerIds) && row.visiblePlayerIds.includes(params.playerId))
    ))
    .map(async (row) => {
      const specialType = resolveSecretRealmSpecialType({
        name: row.name,
        tags: row.tags,
      });
      const recommendedRealmName = await getRealmFullNameByLinearRealm(Math.max(1, Number(row.recommendedRealm || 1)))
        .catch(() => `境界 ${Math.max(1, Number(row.recommendedRealm || 1))}`);
      const seedFocusView = buildSecretRealmSeedFocusView({
        theme: row.theme,
        labels: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
        recommendedRealm: row.recommendedRealm,
        specialType,
      });
      const dropIntelPreview = row.snapshotJson?.rewardPlan
        ? buildSecretRealmDropIntel(buildSecretRealmLootBlueprint({
          seed: `secret-realm-spawn-preview:${row.id}:${row.templateId}`,
          role: "boss",
          rewardPlan: row.snapshotJson.rewardPlan,
          theme: row.theme,
          labels: [row.name, row.description],
          instanceRarity: String(row.rarity || "common"),
          recommendedRealm: Math.max(1, Number(row.recommendedRealm || 1)),
        }))
        : [];
      return {
        id: row.id,
        templateId: row.templateId,
        mapId: row.mapId,
        mapName: row.mapName,
        spawnType: row.spawnType === "personal" ? "personal" : "global",
        visibilityScope: row.spawnType === "personal"
          ? ((Array.isArray(row.visiblePlayerIds) && row.visiblePlayerIds.length > 1) ? "party" : "owner")
          : "world",
        status: row.status === "completed" ? "completed" : row.status === "expired" ? "expired" : row.status === "entered" ? "entered" : "active",
        name: row.name,
        description: row.description,
        announcementText: row.announcement,
        bossName: Array.isArray(row.bossPool) && row.bossPool.length > 0
          ? row.bossPool[0] || "秘境之主"
          : "秘境之主",
        sizeTier: normalizeSecretRealmSizeTier(row.sizeTier),
        rarity: normalizeSecretRealmRarity(row.rarity),
        recommendedRealm: row.recommendedRealm,
        recommendedRealmName,
        rewardBudget: row.rewardBudget,
        positionX: row.positionX,
        positionY: row.positionY,
        expiresAt: row.expiresAt,
        ownerPlayerId: row.ownerPlayerId,
        partyId: null,
        mapInstanceId: row.instanceId,
        canEnter: row.status === "active" || row.spawnType === "global",
        specialType,
        showAttentionDot: Boolean(specialType),
        specialHint: getSecretRealmSpecialHint(specialType),
        seedFocusTags: seedFocusView.seedFocusTags,
        hasHighTierSeedChance: seedFocusView.hasHighTierSeedChance,
        dropIntelPreview,
      } satisfies SecretRealmSpawnView;
    })))
    .sort((left, right) => {
      const leftSpecial = left.specialType ? 1 : 0;
      const rightSpecial = right.specialType ? 1 : 0;
      if (leftSpecial !== rightSpecial) {
        return rightSpecial - leftSpecial;
      }
      return Date.parse(left.expiresAt) - Date.parse(right.expiresAt);
    });
}

export async function incrementSecretRealmPityCounter(playerIds: string[]) {
  const uniqueIds = [...new Set(playerIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return;
  }

  await db.update(players).set({
    secretRealmPityCounter: sql`${players.secretRealmPityCounter} + 1`,
    updatedAt: new Date().toISOString(),
  }).where(inArray(players.id, uniqueIds)).run();
}

export async function markSecretRealmSpawnEntered(
  spawnId: string,
  instanceId: string,
  options?: { hideAfterEnter?: boolean },
) {
  const nowIso = new Date().toISOString();
  const current = await db.select({
    mapId: secretRealmSpawns.mapId,
    spawnType: secretRealmSpawns.spawnType,
    ownerPlayerId: secretRealmSpawns.ownerPlayerId,
    visiblePlayerIds: secretRealmSpawns.visiblePlayerIds,
  }).from(secretRealmSpawns).where(eq(secretRealmSpawns.id, spawnId)).get();

  await db.update(secretRealmSpawns).set({
    instanceId,
    status: options?.hideAfterEnter ? "entered" : "active",
    enteredAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(secretRealmSpawns.id, spawnId)).run();

  if (current) {
    publishMapSecretRealmChanged({
      mapId: current.mapId,
      spawnId,
      spawnType: current.spawnType === "personal" ? "personal" : "global",
      status: options?.hideAfterEnter ? "entered" : "active",
      ownerPlayerId: current.ownerPlayerId,
      visiblePlayerIds: Array.isArray(current.visiblePlayerIds) ? current.visiblePlayerIds : [],
    });
  }
}

export async function markSecretRealmSpawnCompleted(spawnId: string) {
  const nowIso = new Date().toISOString();
  const current = await db.select({
    mapId: secretRealmSpawns.mapId,
    spawnType: secretRealmSpawns.spawnType,
    ownerPlayerId: secretRealmSpawns.ownerPlayerId,
    visiblePlayerIds: secretRealmSpawns.visiblePlayerIds,
  }).from(secretRealmSpawns).where(eq(secretRealmSpawns.id, spawnId)).get();

  await db.update(secretRealmSpawns).set({
    status: "completed",
    completedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(secretRealmSpawns.id, spawnId)).run();

  if (current) {
    publishMapSecretRealmChanged({
      mapId: current.mapId,
      spawnId,
      spawnType: current.spawnType === "personal" ? "personal" : "global",
      status: "completed",
      ownerPlayerId: current.ownerPlayerId,
      visiblePlayerIds: Array.isArray(current.visiblePlayerIds) ? current.visiblePlayerIds : [],
    });
  }
}

export async function runSecretRealmTick() {
  await cleanupExpiredSpawns();
  const worldMaps = await db.select({
    id: maps.id,
    name: maps.name,
    width: maps.width,
    height: maps.height,
    mapType: maps.mapType,
    minRealm: maps.minRealm,
    tilesData: maps.tilesData,
  }).from(maps).where(and(
    sql`${maps.mapType} <> ${"secret_realm_instance"}`,
    sql`${maps.mapType} <> ${OPEN_WORLD_MAP_TYPE}`,
  )).all();

  const shuffledMaps = [...worldMaps].sort(() => Math.random() - 0.5);
  const targetMaps = shuffledMaps.slice(0, SECRET_REALM_MAX_GLOBAL_SPAWNS_PER_TICK);

  for (const map of targetMaps) {
    await ensureGlobalSecretRealmSpawn(map);
  }
}
