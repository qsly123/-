import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, mapInstanceMonsters, monsters, temporaryMonsters } from "@/db/schema";
import { advanceMapSceneTick, advanceMapSceneTickForPositions } from "@/modules/map/services/map-scene-sync";
import { publishMapPresenceMonsterPosition, publishMapRefresh } from "@/modules/map/services/map-presence";
import { resolveMonsterCurrentPosition } from "@/modules/map/services/monster-position";
import {
  listRuntimeMonstersByMapId,
  type RuntimeMonsterRecord,
} from "@/modules/map/services/runtime-monster-store";
import { ensureGlobalMap, isPlainObject } from "@/modules/shared/services/global-store";
import type { MapSceneMonster, MapSceneMonsterDrop } from "@/modules/map/services/map-scene-state";
import type { DropItem } from "@/types/game";
import { normalizeMonsterImageUrl } from "@/modules/shared/services/cosmetic-url";
import {
  buildSecretRealmDropIntel,
  buildSecretRealmFallbackDropIntel,
  type SecretRealmDropIntelEntry,
} from "@/modules/map/services/secret-realm-drop-intel";

type TileEntity = {
  x: number;
  y: number;
  type?: string;
  walkable?: boolean;
};

type MapSceneMonsterRow = {
  id: string;
  name: string;
  avatarImageUrl: string | null;
  monsterType: string;
  level: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  drops: DropItem[] | null;
  mapId: string;
  positionX: number;
  positionY: number;
  currentPositionX: number | null;
  currentPositionY: number | null;
  nextAiMoveAt: string | null;
  positionUpdatedAt: string | null;
  aiMoveIntervalMinSeconds: number | null;
  aiMoveIntervalMaxSeconds: number | null;
  aiMoveRange: number | null;
  isTemporary: boolean;
};

type MonsterAiConfig = {
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  moveRange: number;
};

type MonsterRuntimeEntry = {
  id: string;
  mapId: string;
  spawnX: number;
  spawnY: number;
  currentX: number;
  currentY: number;
  previousX?: number;
  previousY?: number;
  config: MonsterAiConfig;
  sceneMonster: Omit<MapSceneMonster, "positionX" | "positionY">;
  nextMoveAtMs: number;
};

type MapRuntimeEntry = {
  id: string;
  width: number;
  height: number;
  blockedTileKeys: Set<string>;
  monsterIds: Set<string>;
};

type MonsterAiRuntimeState = {
  monstersById: Map<string, MonsterRuntimeEntry>;
  mapsById: Map<string, MapRuntimeEntry>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
};

type MonsterAiRuntimeGlobal = typeof globalThis & {
  __monsterAiRuntimeState?: MonsterAiRuntimeState;
  __mapSceneMonsterCache?: Map<string, { expiresAtMs: number; value: MapSceneMonster[] }>;
};

type MonsterRuntimeExecutor = Pick<typeof db, "select" | "update">;

export const DEFAULT_MONSTER_AI_MOVE_INTERVAL_MIN_SECONDS = 3;
export const DEFAULT_MONSTER_AI_MOVE_INTERVAL_MAX_SECONDS = 6;
export const DEFAULT_MONSTER_AI_MOVE_RANGE = 6;

const MONSTER_AI_HEARTBEAT_MS = 1000;
const MAP_SCENE_MONSTER_CACHE_TTL_MS = 1000;
const DIRECTION_STEPS = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

function getRuntimeState() {
  const globalStore = globalThis as MonsterAiRuntimeGlobal;
  const currentState = isPlainObject(globalStore.__monsterAiRuntimeState)
    ? globalStore.__monsterAiRuntimeState as MonsterAiRuntimeState
    : {} as MonsterAiRuntimeState;
  currentState.monstersById = ensureGlobalMap<string, MonsterRuntimeEntry>(
    currentState as Record<string, unknown>,
    "monstersById",
  );
  currentState.mapsById = ensureGlobalMap<string, MapRuntimeEntry>(
    currentState as Record<string, unknown>,
    "mapsById",
  );
  currentState.heartbeatTimer = currentState.heartbeatTimer ?? null;
  globalStore.__monsterAiRuntimeState = currentState;
  return currentState;
}

function getMapSceneMonsterCache() {
  const globalStore = globalThis as MonsterAiRuntimeGlobal;
  globalStore.__mapSceneMonsterCache = ensureGlobalMap<string, { expiresAtMs: number; value: MapSceneMonster[] }>(
    globalStore as Record<string, unknown>,
    "__mapSceneMonsterCache",
  );
  return globalStore.__mapSceneMonsterCache;
}

function invalidateMapSceneMonsterCache(mapId: string) {
  getMapSceneMonsterCache().delete(mapId);
}

function toPositiveInteger(value: number | null | undefined, fallbackValue: number) {
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  const normalized = Math.floor(Number(value));
  return normalized >= 0 ? normalized : fallbackValue;
}

export function resolveMonsterAiConfig(input: {
  aiMoveIntervalMinSeconds?: number | null;
  aiMoveIntervalMaxSeconds?: number | null;
  aiMoveRange?: number | null;
}): MonsterAiConfig {
  const intervalMinSeconds = Math.max(
    1,
    toPositiveInteger(input.aiMoveIntervalMinSeconds, DEFAULT_MONSTER_AI_MOVE_INTERVAL_MIN_SECONDS),
  );
  const intervalMaxSeconds = Math.max(
    intervalMinSeconds,
    toPositiveInteger(input.aiMoveIntervalMaxSeconds, DEFAULT_MONSTER_AI_MOVE_INTERVAL_MAX_SECONDS),
  );
  const moveRange = Math.max(
    0,
    toPositiveInteger(input.aiMoveRange, DEFAULT_MONSTER_AI_MOVE_RANGE),
  );

  return {
    intervalMinSeconds,
    intervalMaxSeconds,
    moveRange,
  };
}

function buildBlockedTileKey(x: number, y: number) {
  return `${x},${y}`;
}

function createBlockedTileKeySet(tilesData: unknown, width: number, height: number) {
  const blockedTileKeys = new Set<string>();
  const tiles = Array.isArray(tilesData) ? tilesData as TileEntity[] : [];

  for (const tile of tiles) {
    if (!tile || typeof tile !== "object") {
      continue;
    }
    if (
      Number.isInteger(tile.x)
      && Number.isInteger(tile.y)
      && tile.x >= 0
      && tile.x < width
      && tile.y >= 0
      && tile.y < height
      && tile.walkable === false
    ) {
      blockedTileKeys.add(buildBlockedTileKey(tile.x, tile.y));
    }
  }

  return blockedTileKeys;
}

function randomBetween(minValue: number, maxValue: number) {
  if (maxValue <= minValue) {
    return minValue;
  }
  return minValue + Math.floor(Math.random() * (maxValue - minValue + 1));
}

function getNextMoveAtMs(config: MonsterAiConfig, nowMs: number) {
  return nowMs + randomBetween(config.intervalMinSeconds, config.intervalMaxSeconds) * 1000;
}

function parseIsoMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function buildSceneMonster(
  row: MapSceneMonsterRow,
  dropByItemId: Map<string, { name: string; iconUrl: string | null; rarity: string | null }>,
) {
  const drops = (row.drops || []).map((drop) => ({
    ...drop,
    itemName: dropByItemId.get(drop.itemId)?.name || drop.itemId,
    itemIconUrl: dropByItemId.get(drop.itemId)?.iconUrl || null,
    itemRarity: dropByItemId.get(drop.itemId)?.rarity || null,
  })) satisfies MapSceneMonsterDrop[];

  return {
    id: row.id,
    name: row.name,
    avatarImageUrl: normalizeMonsterImageUrl(row.avatarImageUrl),
    monsterType: row.monsterType,
    level: row.level,
    hp: row.hp,
    attack: row.attack,
    defense: row.defense,
    speed: row.speed,
    drops,
    dropIntel: [],
  } satisfies Omit<MapSceneMonster, "positionX" | "positionY">;
}

async function loadSecretRealmDropIntelMap(monsterIds: string[]) {
  const uniqueMonsterIds = Array.from(new Set(monsterIds.filter(Boolean)));
  if (uniqueMonsterIds.length === 0) {
    return new Map<string, SecretRealmDropIntelEntry[]>();
  }

  const rows = await db.select({
    monsterId: mapInstanceMonsters.monsterId,
    role: mapInstanceMonsters.role,
    lootBlueprintJson: mapInstanceMonsters.lootBlueprintJson,
  }).from(mapInstanceMonsters)
    .where(inArray(mapInstanceMonsters.monsterId, uniqueMonsterIds))
    .all();

  const intelMap = new Map<string, SecretRealmDropIntelEntry[]>();
  for (const row of rows) {
    const intel = buildSecretRealmDropIntel(row.lootBlueprintJson || null);
    const role = row.role === "boss" || row.role === "elite" || row.role === "normal"
      ? row.role
      : "normal";
    intelMap.set(
      row.monsterId,
      intel.length > 0 ? intel : buildSecretRealmFallbackDropIntel(role),
    );
  }

  return intelMap;
}

function toMapSceneMonsterRow(row: RuntimeMonsterRecord): MapSceneMonsterRow {
  return {
    id: row.id,
    name: row.name,
    avatarImageUrl: row.iconUrl,
    monsterType: row.monsterType,
    level: row.level,
    hp: row.hp,
    attack: row.attack,
    defense: row.defense,
    speed: row.speed,
    drops: row.drops,
    mapId: row.mapId,
    positionX: row.positionX,
    positionY: row.positionY,
    currentPositionX: row.currentPositionX,
    currentPositionY: row.currentPositionY,
    nextAiMoveAt: row.nextAiMoveAt,
    positionUpdatedAt: row.positionUpdatedAt,
    aiMoveIntervalMinSeconds: row.aiMoveIntervalMinSeconds,
    aiMoveIntervalMaxSeconds: row.aiMoveIntervalMaxSeconds,
    aiMoveRange: row.aiMoveRange,
    isTemporary: row.isTemporary,
  };
}

async function updateMonsterRuntimePosition(executor: MonsterRuntimeExecutor, row: MapSceneMonsterRow, params: {
  currentPositionX: number;
  currentPositionY: number;
  nextAiMoveAt: string;
  positionUpdatedAt: string;
}) {
  if (row.isTemporary) {
    await executor.update(temporaryMonsters).set({
      currentPositionX: params.currentPositionX,
      currentPositionY: params.currentPositionY,
      nextAiMoveAt: params.nextAiMoveAt,
      positionUpdatedAt: params.positionUpdatedAt,
      updatedAt: params.positionUpdatedAt,
    }).where(eq(temporaryMonsters.id, row.id)).run();
    return;
  }

  await executor.update(monsters).set({
    currentPositionX: params.currentPositionX,
    currentPositionY: params.currentPositionY,
    nextAiMoveAt: params.nextAiMoveAt,
    positionUpdatedAt: params.positionUpdatedAt,
  }).where(eq(monsters.id, row.id)).run();
}

async function loadRuntimeMonsterRowsByIds(executor: MonsterRuntimeExecutor, monsterIds: string[]) {
  const uniqueMonsterIds = Array.from(new Set(monsterIds.filter(Boolean)));
  if (uniqueMonsterIds.length === 0) {
    return [] as MapSceneMonsterRow[];
  }

  const [temporaryRows, normalRows] = await Promise.all([
    executor.select({
      id: temporaryMonsters.id,
      name: temporaryMonsters.name,
      avatarImageUrl: temporaryMonsters.iconUrl,
      monsterType: temporaryMonsters.monsterType,
      level: temporaryMonsters.level,
      hp: temporaryMonsters.hp,
      attack: temporaryMonsters.attack,
      defense: temporaryMonsters.defense,
      speed: temporaryMonsters.speed,
      drops: temporaryMonsters.drops,
      mapId: temporaryMonsters.mapId,
      positionX: temporaryMonsters.positionX,
      positionY: temporaryMonsters.positionY,
      currentPositionX: temporaryMonsters.currentPositionX,
      currentPositionY: temporaryMonsters.currentPositionY,
      nextAiMoveAt: temporaryMonsters.nextAiMoveAt,
      positionUpdatedAt: temporaryMonsters.positionUpdatedAt,
      aiMoveIntervalMinSeconds: temporaryMonsters.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: temporaryMonsters.aiMoveIntervalMaxSeconds,
      aiMoveRange: temporaryMonsters.aiMoveRange,
      isTemporary: sql<boolean>`true`,
    }).from(temporaryMonsters).where(inArray(temporaryMonsters.id, uniqueMonsterIds)).all(),
    executor.select({
      id: monsters.id,
      name: monsters.name,
      avatarImageUrl: monsters.iconUrl,
      monsterType: monsters.monsterType,
      level: monsters.level,
      hp: monsters.hp,
      attack: monsters.attack,
      defense: monsters.defense,
      speed: monsters.speed,
      drops: monsters.drops,
      mapId: monsters.mapId,
      positionX: monsters.positionX,
      positionY: monsters.positionY,
      currentPositionX: monsters.currentPositionX,
      currentPositionY: monsters.currentPositionY,
      nextAiMoveAt: monsters.nextAiMoveAt,
      positionUpdatedAt: monsters.positionUpdatedAt,
      aiMoveIntervalMinSeconds: monsters.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: monsters.aiMoveIntervalMaxSeconds,
      aiMoveRange: monsters.aiMoveRange,
      isTemporary: sql<boolean>`false`,
    }).from(monsters).where(inArray(monsters.id, uniqueMonsterIds)).all(),
  ]);

  const rowById = new Map<string, MapSceneMonsterRow>();
  temporaryRows.forEach((row: MapSceneMonsterRow) => {
    rowById.set(row.id, row);
  });
  normalRows.forEach((row: MapSceneMonsterRow) => {
    if (!rowById.has(row.id)) {
      rowById.set(row.id, row);
    }
  });

  return uniqueMonsterIds
    .map((monsterId) => rowById.get(monsterId) || null)
    .filter((row): row is MapSceneMonsterRow => Boolean(row));
}

async function loadSecretRealmMonsterStatusMap(executor: Pick<typeof db, "select">, monsterIds: string[]) {
  const uniqueMonsterIds = Array.from(new Set(monsterIds.filter(Boolean)));
  if (uniqueMonsterIds.length === 0) {
    return new Map<string, string>();
  }

  const runtimeRows = await executor.select({
    monsterId: mapInstanceMonsters.monsterId,
    status: mapInstanceMonsters.status,
  }).from(mapInstanceMonsters).where(inArray(
    mapInstanceMonsters.monsterId,
    uniqueMonsterIds,
  )).all();

  const runtimeStatusByMonsterId = new Map<string, string>();
  runtimeRows.forEach((row) => {
    runtimeStatusByMonsterId.set(row.monsterId, row.status);
  });
  return runtimeStatusByMonsterId;
}

async function filterAliveSceneMonsterRows(rows: MapSceneMonsterRow[]) {
  if (rows.length === 0) {
    return rows;
  }

  const runtimeStatusByMonsterId = await loadSecretRealmMonsterStatusMap(
    db,
    rows.map((row) => row.id),
  );

  return rows.filter((row) => {
    const status = runtimeStatusByMonsterId.get(row.id);
    return !status || status === "alive";
  });
}

function removeMonsterRuntimeEntries(params: {
  mapId: string;
  monsterIds: string[];
  deleteMapEntryWhenEmpty?: boolean;
}) {
  const state = getRuntimeState();
  const mapEntry = state.mapsById.get(params.mapId) || null;
  const targetMonsterIds = Array.from(new Set(params.monsterIds.filter(Boolean)));
  if (targetMonsterIds.length === 0) {
    return false;
  }

  let changed = false;
  for (const monsterId of targetMonsterIds) {
    if (state.monstersById.delete(monsterId)) {
      changed = true;
    }
    if (mapEntry?.monsterIds.delete(monsterId)) {
      changed = true;
    }
  }

  if (mapEntry && mapEntry.monsterIds.size === 0 && params.deleteMapEntryWhenEmpty !== false) {
    state.mapsById.delete(params.mapId);
    changed = true;
  }

  if (changed) {
    invalidateMapSceneMonsterCache(params.mapId);
    releaseHeartbeatIfIdle();
  }

  return changed;
}

function isWalkablePosition(mapEntry: MapRuntimeEntry, x: number, y: number) {
  if (x < 0 || x >= mapEntry.width || y < 0 || y >= mapEntry.height) {
    return false;
  }
  return !mapEntry.blockedTileKeys.has(buildBlockedTileKey(x, y));
}

function canMoveDiagonally(mapEntry: MapRuntimeEntry, fromX: number, fromY: number, toX: number, toY: number) {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  if (Math.abs(deltaX) !== 1 || Math.abs(deltaY) !== 1) {
    return true;
  }
  return (
    isWalkablePosition(mapEntry, fromX + deltaX, fromY)
    && isWalkablePosition(mapEntry, fromX, fromY + deltaY)
  );
}

function isWithinMoveRange(entry: MonsterRuntimeEntry, targetX: number, targetY: number) {
  if (entry.config.moveRange <= 0) {
    return targetX === entry.spawnX && targetY === entry.spawnY;
  }
  return Math.max(
    Math.abs(targetX - entry.spawnX),
    Math.abs(targetY - entry.spawnY),
  ) <= entry.config.moveRange;
}

function chooseNextMonsterStep(
  entry: MonsterRuntimeEntry,
  mapEntry: MapRuntimeEntry,
  occupiedPositions: Set<string>,
) {
  const currentKey = buildBlockedTileKey(entry.currentX, entry.currentY);
  occupiedPositions.delete(currentKey);

  const candidates = DIRECTION_STEPS
    .map((direction) => ({
      x: entry.currentX + direction.x,
      y: entry.currentY + direction.y,
    }))
    .filter((candidate) => (
      isWalkablePosition(mapEntry, candidate.x, candidate.y)
      && canMoveDiagonally(mapEntry, entry.currentX, entry.currentY, candidate.x, candidate.y)
      && isWithinMoveRange(entry, candidate.x, candidate.y)
      && !occupiedPositions.has(buildBlockedTileKey(candidate.x, candidate.y))
    ));

  if (candidates.length === 0) {
    occupiedPositions.add(currentKey);
    return {
      x: entry.currentX,
      y: entry.currentY,
      moved: false,
    };
  }

  const nextPosition = candidates[Math.floor(Math.random() * candidates.length)] || {
    x: entry.currentX,
    y: entry.currentY,
  };

  occupiedPositions.add(buildBlockedTileKey(nextPosition.x, nextPosition.y));
  return {
    x: nextPosition.x,
    y: nextPosition.y,
    moved: nextPosition.x !== entry.currentX || nextPosition.y !== entry.currentY,
  };
}

function primeHeartbeat() {
  const state = getRuntimeState();
  if (state.heartbeatTimer) {
    return;
  }

  state.heartbeatTimer = setInterval(() => {
    void advanceMonsterAiRuntime();
  }, MONSTER_AI_HEARTBEAT_MS);

  if (typeof state.heartbeatTimer.unref === "function") {
    state.heartbeatTimer.unref();
  }
}

function releaseHeartbeatIfIdle() {
  const state = getRuntimeState();
  if (state.monstersById.size > 0 || state.mapsById.size > 0 || !state.heartbeatTimer) {
    return;
  }
  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

async function advanceMonsterAiRuntime(nowMs = Date.now()) {
  const state = getRuntimeState();

  for (const mapEntry of state.mapsById.values()) {
    if (mapEntry.monsterIds.size === 0) {
      continue;
    }
    const hasDueMonster = Array.from(mapEntry.monsterIds).some((monsterId) => {
      const entry = state.monstersById.get(monsterId);
      return entry && entry.mapId === mapEntry.id && entry.nextMoveAtMs <= nowMs;
    });
    if (!hasDueMonster) {
      continue;
    }

    const advanceResult = await db.transaction(async (tx) => {
      const lockRows = await tx.execute(sql<Array<{ locked: boolean }>>`
        select pg_try_advisory_xact_lock(hashtext(${`monster-ai-map:${mapEntry.id}`})) as "locked"
      `);
      const locked = Array.isArray(lockRows) ? Boolean(lockRows[0]?.locked) : false;
      if (!locked) {
        return {
          movedEntries: [] as MonsterRuntimeEntry[],
          staleMonsterIds: [] as string[],
        };
      }

      const activeMonsterIds = Array.from(mapEntry.monsterIds);
      const monsterRows = activeMonsterIds.length > 0
        ? await loadRuntimeMonsterRowsByIds(tx, activeMonsterIds)
        : [];
      const secretRealmMonsterStatusMap = await loadSecretRealmMonsterStatusMap(tx, activeMonsterIds);
      const aliveMonsterRows = monsterRows.filter((row) => {
        const status = secretRealmMonsterStatusMap.get(row.id);
        return !status || status === "alive";
      });
      const aliveMonsterIdSet = new Set(aliveMonsterRows.map((row) => row.id));
      const staleMonsterIds = activeMonsterIds.filter((monsterId) => !aliveMonsterIdSet.has(monsterId));

      const occupiedPositions = new Set<string>();
      for (const row of aliveMonsterRows) {
        const currentPosition = resolveMonsterCurrentPosition(row);
        occupiedPositions.add(buildBlockedTileKey(currentPosition.positionX, currentPosition.positionY));
      }

      const movedEntries: MonsterRuntimeEntry[] = [];
      const nowIso = new Date(nowMs).toISOString();

      for (const row of aliveMonsterRows) {
        const entry = state.monstersById.get(row.id);
        if (!entry || entry.mapId !== mapEntry.id) {
          continue;
        }

        const currentPosition = resolveMonsterCurrentPosition(row);
        const currentNextMoveAtMs = parseIsoMs(row.nextAiMoveAt) ?? entry.nextMoveAtMs ?? getNextMoveAtMs(entry.config, nowMs);
        entry.currentX = currentPosition.positionX;
        entry.currentY = currentPosition.positionY;
        entry.nextMoveAtMs = currentNextMoveAtMs;

        if (currentNextMoveAtMs > nowMs) {
          continue;
        }

        const nextPosition = chooseNextMonsterStep({
          ...entry,
          currentX: currentPosition.positionX,
          currentY: currentPosition.positionY,
        }, mapEntry, occupiedPositions);
        const nextMoveAtMs = getNextMoveAtMs(entry.config, nowMs);

        await updateMonsterRuntimePosition(tx, row, {
          currentPositionX: nextPosition.x,
          currentPositionY: nextPosition.y,
          nextAiMoveAt: new Date(nextMoveAtMs).toISOString(),
          positionUpdatedAt: nextPosition.moved ? nowIso : (row.positionUpdatedAt ?? nowIso),
        });

        entry.currentX = nextPosition.x;
        entry.currentY = nextPosition.y;
        entry.nextMoveAtMs = nextMoveAtMs;

        if (nextPosition.moved) {
          movedEntries.push({
            ...entry,
            previousX: currentPosition.positionX,
            previousY: currentPosition.positionY,
            currentX: nextPosition.x,
            currentY: nextPosition.y,
            nextMoveAtMs,
          });
        }
      }

      return {
        movedEntries,
        staleMonsterIds,
      };
    });

    if (advanceResult.staleMonsterIds.length > 0) {
      const removed = removeMonsterRuntimeEntries({
        mapId: mapEntry.id,
        monsterIds: advanceResult.staleMonsterIds,
      });
      if (removed) {
        advanceMapSceneTick(mapEntry.id);
        publishMapRefresh({
          mapId: mapEntry.id,
          reason: "monster_defeat",
        });
      }
    }

    for (const movedEntry of advanceResult.movedEntries) {
      const nextSceneTick = advanceMapSceneTick(movedEntry.mapId);
      advanceMapSceneTickForPositions({
        mapId: movedEntry.mapId,
        tick: nextSceneTick,
        positions: [
          {
            positionX: movedEntry.previousX ?? movedEntry.currentX,
            positionY: movedEntry.previousY ?? movedEntry.currentY,
          },
          {
            positionX: movedEntry.currentX,
            positionY: movedEntry.currentY,
          },
        ],
      });
      publishMapPresenceMonsterPosition({
        id: movedEntry.sceneMonster.id,
        mapId: movedEntry.mapId,
        positionX: movedEntry.currentX,
        positionY: movedEntry.currentY,
        prevPositionX: movedEntry.previousX ?? movedEntry.currentX,
        prevPositionY: movedEntry.previousY ?? movedEntry.currentY,
      });
    }
  }
}

async function ensureMonsterRuntimePersistence(params: {
  monsters: MapSceneMonsterRow[];
  nowMs: number;
}) {
  const state = getRuntimeState();
  const nowIso = new Date(params.nowMs).toISOString();

  for (const row of params.monsters) {
    const config = resolveMonsterAiConfig({
      aiMoveIntervalMinSeconds: row.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: row.aiMoveIntervalMaxSeconds,
      aiMoveRange: row.aiMoveRange,
    });
    const current = state.monstersById.get(row.id);
    const shouldResetPosition = Boolean(
      current
      && (current.mapId !== row.mapId || current.spawnX !== row.positionX || current.spawnY !== row.positionY),
    );
    const currentPosition = shouldResetPosition
      ? { positionX: row.positionX, positionY: row.positionY }
      : resolveMonsterCurrentPosition(row);
    const nextMoveAtMs = parseIsoMs(row.nextAiMoveAt) ?? getNextMoveAtMs(config, params.nowMs);
    const needsPersistence = shouldResetPosition
      || row.currentPositionX === null
      || row.currentPositionY === null
      || !row.nextAiMoveAt;

    if (!needsPersistence) {
      continue;
    }

    row.currentPositionX = currentPosition.positionX;
    row.currentPositionY = currentPosition.positionY;
    row.nextAiMoveAt = new Date(nextMoveAtMs).toISOString();
    row.positionUpdatedAt = shouldResetPosition ? nowIso : (row.positionUpdatedAt ?? nowIso);

    await updateMonsterRuntimePosition(db, row, {
      currentPositionX: row.currentPositionX,
      currentPositionY: row.currentPositionY,
      nextAiMoveAt: row.nextAiMoveAt,
      positionUpdatedAt: row.positionUpdatedAt,
    });
  }
}

function syncMonsterRuntimeState(params: {
  map: {
    id: string;
    width: number;
    height: number;
    tilesData: unknown;
  };
  monsters: MapSceneMonsterRow[];
  nowMs?: number;
}) {
  const state = getRuntimeState();
  const nowMs = params.nowMs ?? Date.now();
  const mapEntry = {
    id: params.map.id,
    width: params.map.width,
    height: params.map.height,
    blockedTileKeys: createBlockedTileKeySet(params.map.tilesData, params.map.width, params.map.height),
    monsterIds: new Set<string>(),
  } satisfies MapRuntimeEntry;
  const previousMonsterIds = new Set(state.mapsById.get(params.map.id)?.monsterIds || []);

  state.mapsById.set(params.map.id, mapEntry);

  for (const row of params.monsters) {
    const config = resolveMonsterAiConfig({
      aiMoveIntervalMinSeconds: row.aiMoveIntervalMinSeconds,
      aiMoveIntervalMaxSeconds: row.aiMoveIntervalMaxSeconds,
      aiMoveRange: row.aiMoveRange,
    });
    const sceneMonster = {
      id: row.id,
      name: row.name,
      avatarImageUrl: normalizeMonsterImageUrl(row.avatarImageUrl),
      monsterType: row.monsterType,
      level: row.level,
      hp: row.hp,
      attack: row.attack,
      defense: row.defense,
      speed: row.speed,
      drops: [],
    } satisfies Omit<MapSceneMonster, "positionX" | "positionY">;
    const current = state.monstersById.get(row.id);
    const shouldResetPosition = !current
      || current.mapId !== row.mapId
      || current.spawnX !== row.positionX
      || current.spawnY !== row.positionY;
    const currentPosition = shouldResetPosition
      ? { positionX: row.positionX, positionY: row.positionY }
      : resolveMonsterCurrentPosition(row);
    const nextMoveAtMs = parseIsoMs(row.nextAiMoveAt) ?? getNextMoveAtMs(config, nowMs);

    state.monstersById.set(row.id, {
      id: row.id,
      mapId: row.mapId,
      spawnX: row.positionX,
      spawnY: row.positionY,
      currentX: currentPosition.positionX,
      currentY: currentPosition.positionY,
      config,
      sceneMonster: current
        ? {
          ...current.sceneMonster,
          ...sceneMonster,
        }
        : sceneMonster,
      nextMoveAtMs,
    });
    mapEntry.monsterIds.add(row.id);
    previousMonsterIds.delete(row.id);
  }

  for (const removedMonsterId of previousMonsterIds) {
    state.monstersById.delete(removedMonsterId);
  }
}

function buildMonsterSceneList(params: {
  mapId: string;
  enrichedMonsters: Array<Omit<MapSceneMonster, "positionX" | "positionY"> & { id: string }>;
}) {
  const state = getRuntimeState();

  return params.enrichedMonsters.map((monster) => {
    const runtimeEntry = state.monstersById.get(monster.id);
    const positionX = runtimeEntry?.currentX ?? 0;
    const positionY = runtimeEntry?.currentY ?? 0;
    return {
      ...monster,
      positionX,
      positionY,
    } satisfies MapSceneMonster;
  }).filter((monster) => {
    const runtimeEntry = state.monstersById.get(monster.id);
    return runtimeEntry?.mapId === params.mapId;
  });
}

export async function listMapSceneMonsters(params: {
  mapId: string;
  map: {
    id: string;
    width: number;
    height: number;
    tilesData: unknown;
  };
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const cache = getMapSceneMonsterCache();
  const cached = cache.get(params.mapId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  const runtimeRows = await listRuntimeMonstersByMapId(params.mapId);
  const monsterRows = await filterAliveSceneMonsterRows(runtimeRows.map(toMapSceneMonsterRow));

  await ensureMonsterRuntimePersistence({
    monsters: monsterRows,
    nowMs,
  });

  syncMonsterRuntimeState({
    map: params.map,
    monsters: monsterRows,
    nowMs,
  });

  const dropItemIds = Array.from(new Set(
    monsterRows.flatMap((monster) => (monster.drops || []).map((drop) => drop.itemId)),
  ));

  const dropByItemId = new Map<string, { name: string; iconUrl: string | null; rarity: string | null }>();
  if (dropItemIds.length > 0) {
    const dropRows = await db.select({
      id: items.id,
      name: items.name,
      iconUrl: items.iconUrl,
      rarity: items.rarity,
    }).from(items).where(inArray(items.id, dropItemIds)).all();

    for (const item of dropRows) {
      dropByItemId.set(item.id, {
        name: item.name,
        iconUrl: item.iconUrl || null,
        rarity: item.rarity || null,
      });
    }
  }

  const secretRealmDropIntelMap = await loadSecretRealmDropIntelMap(monsterRows.map((row) => row.id));
  const enrichedMonsters = monsterRows.map((row) => {
    const monster = buildSceneMonster(row, dropByItemId);
    const dropIntel = secretRealmDropIntelMap.get(row.id) || [];
    if (dropIntel.length < 1) {
      return monster;
    }
    return {
      ...monster,
      dropIntel,
    } satisfies Omit<MapSceneMonster, "positionX" | "positionY">;
  });
  const sceneMonsters = buildMonsterSceneList({
    mapId: params.mapId,
    enrichedMonsters,
  });
  const state = getRuntimeState();

  for (const monster of sceneMonsters) {
    const runtimeEntry = state.monstersById.get(monster.id);
    if (!runtimeEntry) {
      continue;
    }
    runtimeEntry.sceneMonster = {
      id: monster.id,
      name: monster.name,
      avatarImageUrl: normalizeMonsterImageUrl(monster.avatarImageUrl),
      monsterType: monster.monsterType,
      level: monster.level,
      hp: monster.hp,
      attack: monster.attack,
      defense: monster.defense,
      speed: monster.speed,
      drops: monster.drops,
      dropIntel: monster.dropIntel || [],
    };
  }

  primeHeartbeat();
  cache.set(params.mapId, {
    expiresAtMs: nowMs + MAP_SCENE_MONSTER_CACHE_TTL_MS,
    value: sceneMonsters,
  });
  return sceneMonsters;
}

export function clearMonsterAiRuntimeForMap(params: {
  mapId: string;
  monsterIds?: string[];
}) {
  const state = getRuntimeState();
  const targetMonsterIds = params.monsterIds?.length
    ? params.monsterIds
    : Array.from(state.mapsById.get(params.mapId)?.monsterIds || []);

  removeMonsterRuntimeEntries({
    mapId: params.mapId,
    monsterIds: targetMonsterIds,
  });
}

export function clearMonsterAiRuntimeForMonsters(params: {
  mapId: string;
  monsterIds: string[];
}) {
  removeMonsterRuntimeEntries({
    mapId: params.mapId,
    monsterIds: params.monsterIds,
  });
}
