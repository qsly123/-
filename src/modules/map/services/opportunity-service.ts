import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mapOpportunitySpawns, maps, npcs, players, randomEvents } from "@/db/schema";
import {
  applyRandomEventRewards,
  matchRandomEventTargetMap,
  pickRandomEventImageUrl,
  type RandomEventRewardInput,
  type RandomEventRewardView,
} from "@/modules/map/services/random-event-service";
import { listMonsterPositionSnapshotsByMap } from "@/modules/map/services/monster-position";
import { listOnlineMapPlayerIdsByMap } from "@/modules/map/services/map-player-online-runtime";
import { publishMapOpportunityClaimed, publishMapOpportunitySpawned } from "@/modules/map/services/map-presence";
import { setPendingMapEvent } from "@/modules/map/services/pending-map-event";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";

interface TileEntity {
  x: number;
  y: number;
  walkable?: boolean;
}

interface OpportunityEventTemplate {
  id: string;
  name: string;
  description: string | null;
  iconImageUrl: string | null;
  imageUrls: string[] | null;
  aiPrompt: string | null;
  minRealm: number;
  maxRealm: number | null;
  mapType: string | null;
  mapTypes: string[] | null;
  mapIds: string[] | null;
  spawnIntervalSeconds: number | null;
  durationSeconds: number | null;
  rewards: RandomEventRewardInput | null;
}

type OpportunitySpawnCheckState = {
  completedAtMs: number;
  inFlight: Promise<void> | null;
};

type OpportunityRuntimeGlobal = typeof globalThis & {
  __opportunitySpawnCheckState?: Map<string, OpportunitySpawnCheckState>;
  __opportunityHintCacheByMapId?: Map<string, {
    expiresAtMs: number;
    positions: Set<string>;
  }>;
};

const OPPORTUNITY_SPAWN_RECHECK_MS = 3_000;
const OPPORTUNITY_POSITION_HINT_CACHE_TTL_MS = 800;

function supportsLegacyOpportunityMap(mapType: string) {
  return mapType !== "open_world" && mapType !== "secret_realm_instance";
}

export interface OpportunityView {
  spawnId: string;
  eventId: string;
  name: string;
  iconImageUrl: string | null;
  minRealm: number;
  maxRealm: number | null;
  positionX: number;
  positionY: number;
  expiresAt: string;
}

export interface ClaimOpportunityResult {
  status: "none" | "claimed" | "lost" | "blocked";
  message?: string;
  event?:
    | {
      id: string;
      name: string;
      type: string;
      pendingAi: true;
    }
    | {
      name: string;
      type: string;
      narrative: string;
      imageUrl?: string | null;
      rewards?: RandomEventRewardView | null;
    };
}

function parseIsoMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return ms;
}

function toPositiveInt(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(Number(value));
  if (normalized <= 0) return fallback;
  return normalized;
}

function canEventSpawnInMap(eventTemplate: OpportunityEventTemplate, mapId: string, mapType: string) {
  return matchRandomEventTargetMap({
    currentMapId: mapId,
    currentMapType: mapType,
    mapIds: eventTemplate.mapIds,
    mapTypes: eventTemplate.mapTypes,
    legacyMapType: eventTemplate.mapType,
  });
}

function getOpportunitySpawnCheckStore() {
  const globalStore = globalThis as OpportunityRuntimeGlobal;
  globalStore.__opportunitySpawnCheckState = ensureGlobalMap<string, OpportunitySpawnCheckState>(
    globalStore as Record<string, unknown>,
    "__opportunitySpawnCheckState",
  );
  return globalStore.__opportunitySpawnCheckState;
}

function getOpportunityHintCacheStore() {
  const globalStore = globalThis as OpportunityRuntimeGlobal;
  globalStore.__opportunityHintCacheByMapId = ensureGlobalMap<string, {
    expiresAtMs: number;
    positions: Set<string>;
  }>(
    globalStore as Record<string, unknown>,
    "__opportunityHintCacheByMapId",
  );
  return globalStore.__opportunityHintCacheByMapId;
}

function buildOpportunityPositionKey(positionX: number, positionY: number) {
  return `${positionX},${positionY}`;
}

function primeOpportunityHintCache(params: {
  mapId: string;
  positions: Iterable<string>;
  ttlMs?: number;
}) {
  const ttlMs = Math.max(100, Math.floor(Number(params.ttlMs || OPPORTUNITY_POSITION_HINT_CACHE_TTL_MS)));
  getOpportunityHintCacheStore().set(params.mapId, {
    expiresAtMs: Date.now() + ttlMs,
    positions: new Set(params.positions),
  });
}

function updateOpportunityHintCachePosition(params: {
  mapId: string;
  positionX: number;
  positionY: number;
  present: boolean;
}) {
  const store = getOpportunityHintCacheStore();
  const cached = store.get(params.mapId);
  if (!cached || cached.expiresAtMs <= Date.now()) {
    return;
  }
  const nextPositions = new Set(cached.positions);
  const key = buildOpportunityPositionKey(params.positionX, params.positionY);
  if (params.present) {
    nextPositions.add(key);
  } else {
    nextPositions.delete(key);
  }
  store.set(params.mapId, {
    expiresAtMs: cached.expiresAtMs,
    positions: nextPositions,
  });
}

async function loadActiveOpportunityPositionHints(mapId: string) {
  const nowIso = new Date().toISOString();
  const rows = await db.select({
    positionX: mapOpportunitySpawns.positionX,
    positionY: mapOpportunitySpawns.positionY,
  }).from(mapOpportunitySpawns).where(and(
    eq(mapOpportunitySpawns.mapId, mapId),
    isNull(mapOpportunitySpawns.claimedAt),
    gt(mapOpportunitySpawns.expiresAt, nowIso),
  )).all();
  primeOpportunityHintCache({
    mapId,
    positions: rows.map((row) => buildOpportunityPositionKey(row.positionX, row.positionY)),
  });
  return rows;
}

export async function hasActiveOpportunityHintAtPosition(params: {
  mapId: string;
  positionX: number;
  positionY: number;
}) {
  const normalizedMapId = params.mapId.trim();
  if (!normalizedMapId) {
    return false;
  }
  const store = getOpportunityHintCacheStore();
  const cached = store.get(normalizedMapId);
  const nowMs = Date.now();
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.positions.has(buildOpportunityPositionKey(params.positionX, params.positionY));
  }

  const rows = await loadActiveOpportunityPositionHints(normalizedMapId);
  return rows.some((row) => row.positionX === params.positionX && row.positionY === params.positionY);
}

function buildStaticBlockedSet(params: {
  tilesData: unknown;
  npcPositions: Array<{ positionX: number; positionY: number }>;
  monsterPositions: Array<{ positionX: number; positionY: number }>;
}) {
  const blocked = new Set<string>();

  const tiles = Array.isArray(params.tilesData) ? params.tilesData as TileEntity[] : [];
  for (const tile of tiles) {
    if (tile.walkable === false) {
      blocked.add(`${tile.x},${tile.y}`);
    }
  }

  for (const npc of params.npcPositions) {
    blocked.add(`${npc.positionX},${npc.positionY}`);
  }
  for (const monster of params.monsterPositions) {
    blocked.add(`${monster.positionX},${monster.positionY}`);
  }

  return blocked;
}

async function pickSpawnPosition(params: {
  mapId: string;
  width: number;
  height: number;
  staticBlocked: Set<string>;
  nowIso: string;
}) {
  const activeSpawns = await db.select({
    positionX: mapOpportunitySpawns.positionX,
    positionY: mapOpportunitySpawns.positionY,
  }).from(mapOpportunitySpawns).where(and(
    eq(mapOpportunitySpawns.mapId, params.mapId),
    isNull(mapOpportunitySpawns.claimedAt),
    gt(mapOpportunitySpawns.expiresAt, params.nowIso),
  )).all();

  const blocked = new Set(params.staticBlocked);
  for (const row of activeSpawns) {
    blocked.add(`${row.positionX},${row.positionY}`);
  }

  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < params.height; y += 1) {
    for (let x = 0; x < params.width; x += 1) {
      const key = `${x},${y}`;
      if (blocked.has(key)) continue;
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

export async function ensureOpportunitySpawnsForMap(params: {
  mapId: string;
  mapData?: {
    id: string;
    width: number;
    height: number;
    mapType: string;
    tilesData: unknown;
  };
}) {
  const store = getOpportunitySpawnCheckStore();
  const existing = store.get(params.mapId);
  const nowMs = Date.now();
  if (existing?.inFlight) {
    await existing.inFlight;
    return;
  }
  if (existing && nowMs - existing.completedAtMs < OPPORTUNITY_SPAWN_RECHECK_MS) {
    return;
  }

  const run = (async () => {
    const mapData = params.mapData
      || await db.select({
        id: maps.id,
        width: maps.width,
        height: maps.height,
        mapType: maps.mapType,
        tilesData: maps.tilesData,
      }).from(maps).where(eq(maps.id, params.mapId)).get();

    if (!mapData) {
      return;
    }
    if (!supportsLegacyOpportunityMap(mapData.mapType)) {
      return;
    }

    const eventTemplates = await db.select({
      id: randomEvents.id,
      name: randomEvents.name,
      description: randomEvents.description,
      iconImageUrl: randomEvents.iconImageUrl,
      imageUrls: randomEvents.imageUrls,
      aiPrompt: randomEvents.aiPrompt,
      minRealm: randomEvents.minRealm,
      maxRealm: randomEvents.maxRealm,
      mapType: randomEvents.mapType,
      mapTypes: randomEvents.mapTypes,
      mapIds: randomEvents.mapIds,
      spawnIntervalSeconds: randomEvents.spawnIntervalSeconds,
      durationSeconds: randomEvents.durationSeconds,
      rewards: randomEvents.rewards,
    }).from(randomEvents).where(eq(randomEvents.eventType, "opportunity")).all();

    if (eventTemplates.length === 0) {
      return;
    }

    const onlinePlayerIds = [...listOnlineMapPlayerIdsByMap(mapData.id)];
    const [npcPositions, monsterPositions, playerPositions] = await Promise.all([
      db.select({
        positionX: npcs.positionX,
        positionY: npcs.positionY,
      }).from(npcs).where(eq(npcs.mapId, mapData.id)).all(),
      listMonsterPositionSnapshotsByMap(mapData.id),
      onlinePlayerIds.length > 0
        ? db.select({
          positionX: players.positionX,
          positionY: players.positionY,
        }).from(players).where(inArray(players.id, onlinePlayerIds)).all()
        : Promise.resolve([] as Array<{ positionX: number; positionY: number }>),
    ]);

    const staticBlocked = buildStaticBlockedSet({
      tilesData: mapData.tilesData,
      npcPositions: [...npcPositions, ...playerPositions],
      monsterPositions,
    });

    const scanStartedAtMs = Date.now();
    const nowIso = new Date(scanStartedAtMs).toISOString();

    for (const eventTemplate of eventTemplates) {
      if (!canEventSpawnInMap(eventTemplate, mapData.id, mapData.mapType)) {
        continue;
      }

      const activeSpawn = await db.select({
        id: mapOpportunitySpawns.id,
      }).from(mapOpportunitySpawns).where(and(
        eq(mapOpportunitySpawns.eventId, eventTemplate.id),
        eq(mapOpportunitySpawns.mapId, mapData.id),
        isNull(mapOpportunitySpawns.claimedAt),
        gt(mapOpportunitySpawns.expiresAt, nowIso),
      )).get();
      if (activeSpawn) {
        continue;
      }

      const intervalSeconds = toPositiveInt(eventTemplate.spawnIntervalSeconds, 300);
      const latestSpawn = await db.select({
        spawnedAt: mapOpportunitySpawns.spawnedAt,
      }).from(mapOpportunitySpawns).where(and(
        eq(mapOpportunitySpawns.eventId, eventTemplate.id),
        eq(mapOpportunitySpawns.mapId, mapData.id),
      )).orderBy(desc(mapOpportunitySpawns.spawnedAt)).get();

      if (latestSpawn) {
        const latestMs = parseIsoMs(latestSpawn.spawnedAt);
        if (latestMs !== null && latestMs + intervalSeconds * 1000 > scanStartedAtMs) {
          continue;
        }
      }

      const position = await pickSpawnPosition({
        mapId: mapData.id,
        width: mapData.width,
        height: mapData.height,
        staticBlocked,
        nowIso,
      });
      if (!position) {
        continue;
      }

      const durationSeconds = toPositiveInt(eventTemplate.durationSeconds, 300);
      const expiresAt = new Date(scanStartedAtMs + durationSeconds * 1000).toISOString();
      const createdAt = new Date(scanStartedAtMs).toISOString();

      const created = await db.insert(mapOpportunitySpawns).values({
        eventId: eventTemplate.id,
        mapId: mapData.id,
        positionX: position.x,
        positionY: position.y,
        spawnedAt: createdAt,
        expiresAt,
        claimedByPlayerId: null,
        claimedAt: null,
        createdAt,
        updatedAt: createdAt,
      }).returning({
        spawnId: mapOpportunitySpawns.id,
      }).get();
      if (!created) {
        continue;
      }

      publishMapOpportunitySpawned({
        mapId: mapData.id,
        spawnId: created.spawnId,
        eventId: eventTemplate.id,
        name: eventTemplate.name,
        iconImageUrl: eventTemplate.iconImageUrl,
        minRealm: eventTemplate.minRealm,
        maxRealm: eventTemplate.maxRealm,
        positionX: position.x,
        positionY: position.y,
        expiresAt,
      });
      updateOpportunityHintCachePosition({
        mapId: mapData.id,
        positionX: position.x,
        positionY: position.y,
        present: true,
      });
    }
  })();

  store.set(params.mapId, {
    completedAtMs: existing?.completedAtMs || 0,
    inFlight: run,
  });

  try {
    await run;
  } finally {
    store.set(params.mapId, {
      completedAtMs: Date.now(),
      inFlight: null,
    });
  }
}

export function queueOpportunitySpawnsForMap(params: {
  mapId: string;
  mapData?: {
    id: string;
    width: number;
    height: number;
    mapType: string;
    tilesData: unknown;
  };
}) {
  void ensureOpportunitySpawnsForMap(params).catch((error) => {
    console.error("Queue opportunity spawn error:", error);
  });
}

export async function listActiveOpportunitiesByMap(mapId: string): Promise<OpportunityView[]> {
  const nowIso = new Date().toISOString();
  return await db.select({
    spawnId: mapOpportunitySpawns.id,
    eventId: mapOpportunitySpawns.eventId,
    name: randomEvents.name,
    iconImageUrl: randomEvents.iconImageUrl,
    minRealm: randomEvents.minRealm,
    maxRealm: randomEvents.maxRealm,
    positionX: mapOpportunitySpawns.positionX,
    positionY: mapOpportunitySpawns.positionY,
    expiresAt: mapOpportunitySpawns.expiresAt,
  }).from(mapOpportunitySpawns)
    .innerJoin(randomEvents, eq(randomEvents.id, mapOpportunitySpawns.eventId))
    .where(and(
      eq(mapOpportunitySpawns.mapId, mapId),
      eq(randomEvents.eventType, "opportunity"),
      isNull(mapOpportunitySpawns.claimedAt),
      gt(mapOpportunitySpawns.expiresAt, nowIso),
    ))
    .orderBy(asc(mapOpportunitySpawns.spawnedAt))
    .all();
}

export async function tryClaimOpportunity(params: {
  playerId: string;
  playerRealm: number;
  mapId: string;
  positionX: number;
  positionY: number;
}): Promise<ClaimOpportunityResult> {
  const nowIso = new Date().toISOString();

  const target = await db.select({
    spawnId: mapOpportunitySpawns.id,
    eventId: randomEvents.id,
    eventType: randomEvents.eventType,
    eventName: randomEvents.name,
    description: randomEvents.description,
    imageUrls: randomEvents.imageUrls,
    aiPrompt: randomEvents.aiPrompt,
    rewards: randomEvents.rewards,
    minRealm: randomEvents.minRealm,
    maxRealm: randomEvents.maxRealm,
    positionX: mapOpportunitySpawns.positionX,
    positionY: mapOpportunitySpawns.positionY,
  }).from(mapOpportunitySpawns)
    .innerJoin(randomEvents, eq(randomEvents.id, mapOpportunitySpawns.eventId))
    .where(and(
      eq(mapOpportunitySpawns.mapId, params.mapId),
      eq(mapOpportunitySpawns.positionX, params.positionX),
      eq(mapOpportunitySpawns.positionY, params.positionY),
      eq(randomEvents.eventType, "opportunity"),
      isNull(mapOpportunitySpawns.claimedAt),
      gt(mapOpportunitySpawns.expiresAt, nowIso),
    ))
    .orderBy(asc(mapOpportunitySpawns.spawnedAt))
    .get();

  if (!target) {
    return { status: "none" };
  }

  const meetsMinRealm = params.playerRealm >= target.minRealm;
  const meetsMaxRealm = target.maxRealm === null || params.playerRealm <= target.maxRealm;
  if (!meetsMinRealm || !meetsMaxRealm) {
    return {
      status: "blocked",
      message: `境界不足，无法获得机缘「${target.eventName}」`,
    };
  }

  const claimed = await db.update(mapOpportunitySpawns).set({
    claimedByPlayerId: params.playerId,
    claimedAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(mapOpportunitySpawns.id, target.spawnId),
    isNull(mapOpportunitySpawns.claimedAt),
    gt(mapOpportunitySpawns.expiresAt, nowIso),
  )).returning({
    id: mapOpportunitySpawns.id,
  }).get();

  if (!claimed) {
    return { status: "lost" };
  }

  if (target.aiPrompt) {
    setPendingMapEvent(params.playerId, target.eventId, {
      sourceType: "opportunity",
      sourceRef: target.spawnId,
    });

    publishMapOpportunityClaimed({
      mapId: params.mapId,
      spawnId: target.spawnId,
      eventId: target.eventId,
      claimedByPlayerId: params.playerId,
      positionX: target.positionX,
      positionY: target.positionY,
    });
    updateOpportunityHintCachePosition({
      mapId: params.mapId,
      positionX: target.positionX,
      positionY: target.positionY,
      present: false,
    });

    return {
      status: "claimed",
      event: {
        id: target.eventId,
        name: target.eventName,
        type: target.eventType,
        pendingAi: true,
      },
    };
  }

  const narrative = target.description || "你触及天地灵机，获得了一份机缘。";

  const rewards = target.rewards as RandomEventRewardInput | null;
  const rewardsWithName = await applyRandomEventRewards({
    playerId: params.playerId,
    rewards,
    sourceRef: `${target.eventId}:${target.spawnId}`,
  });

  publishMapOpportunityClaimed({
    mapId: params.mapId,
    spawnId: target.spawnId,
    eventId: target.eventId,
    claimedByPlayerId: params.playerId,
    positionX: target.positionX,
    positionY: target.positionY,
  });
  updateOpportunityHintCachePosition({
    mapId: params.mapId,
    positionX: target.positionX,
    positionY: target.positionY,
    present: false,
  });

  return {
    status: "claimed",
    event: {
      name: target.eventName,
      type: target.eventType,
      narrative,
      imageUrl: pickRandomEventImageUrl(target.imageUrls),
      rewards: rewardsWithName,
    },
  };
}
