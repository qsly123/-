import { and, eq, gt, isNull } from "drizzle-orm";
import {
  clampMapGridCoordinate,
  normalizeMapGridCoordinate as normalizeGridCoordinate,
} from "@immortality/shared-protocol";

type TileLike = {
  x?: unknown;
  y?: unknown;
  type?: unknown;
  walkable?: unknown;
};

export type WorldMapRuntimeSource = "map" | "temporary" | "world" | "fallback";

export interface WorldMapRuntimeRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  runtimeSource: WorldMapRuntimeSource;
  blockedTiles: ReadonlySet<string>;
  tilePortalEntities: WorldMapEntityRecord[];
}

export interface WorldMapPlayerRecord {
  id: string;
  name: string;
  currentMapId: string | null;
  positionX: number;
  positionY: number;
}

export type WorldMapEntityKind =
  | "npc"
  | "monster"
  | "opportunity"
  | "limited_opportunity"
  | "portal"
  | "event_portal"
  | "secret_realm"
  | "reputation_event"
  | "world_commission"
  | "sect_home"
  | "sect_activity"
  | "temporary_blocker"
  | "sealed_area";

export interface WorldMapEntityRecord {
  id: string;
  kind: WorldMapEntityKind;
  name: string;
  positionX: number;
  positionY: number;
}

export interface WorldMapRoomData {
  map: WorldMapRuntimeRecord;
  player: WorldMapPlayerRecord | null;
  entities: WorldMapEntityRecord[];
  privateEntities: WorldMapEntityRecord[];
  degraded: boolean;
  degradeReason?: string;
  entitiesDegraded?: boolean;
  entitiesDegradeReason?: string;
}

const DEFAULT_WORLD_MAP_ID = "default";
const DEFAULT_MAP_WIDTH = 16;
const DEFAULT_MAP_HEIGHT = 16;
const BLOCKING_TILE_TYPES = new Set([
  "water",
  "mountain",
  "building",
  "blocked",
  "barrier",
  "sealed",
  "event_blocker",
  "closed_portal",
  "portal_placeholder",
]);
const EXTRA_ENTITY_LIST_KEYS = [
  "mapEntrances",
  "mapEntities",
  "eventEntrances",
  "activityEntrances",
  "commissionEntrances",
  "reputationEntrances",
  "objectiveEntrances",
  "temporaryEntrances",
  "temporaryBlockers",
  "blockedAreas",
  "portalPlaceholders",
];

function normalizeId(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || DEFAULT_WORLD_MAP_ID;
}

function isDefaultMapId(mapId: string) {
  return mapId === DEFAULT_WORLD_MAP_ID || mapId === "smoke-map";
}

function normalizeDimension(value: unknown, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
    return fallback;
  }
  return Math.min(numberValue, 4096);
}

function tileKey(x: number, y: number) {
  return `${x}:${y}`;
}

function isBlockingTile(tile: TileLike) {
  if (tile.walkable === false) {
    return true;
  }
  const row = tile as Record<string, unknown>;
  const nowMs = Date.now();
  const startsAtMs = parseTimeMs(row.blockStartsAt ?? row.activeFrom ?? row.startsAt);
  const expiresAtMs = parseTimeMs(row.blockExpiresAt ?? row.activeUntil ?? row.expiresAt);
  const isInActiveWindow = (startsAtMs === null || startsAtMs <= nowMs)
    && (expiresAtMs === null || expiresAtMs > nowMs);
  if (typeof tile.type === "string" && BLOCKING_TILE_TYPES.has(tile.type)) {
    return isInActiveWindow;
  }
  if (row.temporaryBlocked === true || row.activityBlocked === true || row.portalPlaceholder === true) {
    return isInActiveWindow;
  }
  return false;
}

function parseTimeMs(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function buildBlockedTileSet(tilesData: unknown) {
  const blockedTiles = new Set<string>();
  if (!Array.isArray(tilesData)) {
    return blockedTiles;
  }

  for (const tile of tilesData) {
    if (!tile || typeof tile !== "object" || !isBlockingTile(tile as TileLike)) {
      continue;
    }
    const x = Number((tile as TileLike).x);
    const y = Number((tile as TileLike).y);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      continue;
    }
    blockedTiles.add(tileKey(x, y));
  }

  return blockedTiles;
}

function buildPortalEntityRecords(params: {
  mapId: string;
  tilesData: unknown;
  width: number;
  height: number;
}): WorldMapEntityRecord[] {
  if (!Array.isArray(params.tilesData)) {
    return [];
  }

  return params.tilesData.flatMap((tile, index) => {
    if (!tile || typeof tile !== "object" || Array.isArray(tile)) {
      return [];
    }

    const row = tile as Record<string, unknown>;
    if (row.type !== "portal" || row.walkable === false) {
      return [];
    }

    const position = {
      x: normalizeGridCoordinate(row.x),
      y: normalizeGridCoordinate(row.y),
    };
    const clampedPosition = clampPositionToMap({
      x: position.x,
      y: position.y,
      width: params.width,
      height: params.height,
    });
    const portalId = String(row.portalId || "").trim();
    const portalName = String(row.portalName || row.portalTargetName || "").trim();

    return [{
      id: `portal:${params.mapId}:${portalId || `${clampedPosition.x}:${clampedPosition.y}:${index}`}`,
      kind: "portal" as const,
      name: portalName || "传送点",
      positionX: clampedPosition.x,
      positionY: clampedPosition.y,
    }];
  });
}

function clampPositionToMap(params: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return clampMapGridCoordinate(params);
}

function readPayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readPayloadString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readPayloadNumber(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
  }
  return undefined;
}

function readPayloadBoolean(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
      }
    }
  }
  return false;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function deterministicPositionFromKey(params: {
  key: string;
  width: number;
  height: number;
}) {
  const hash = hashText(params.key || "world-event");
  return {
    x: params.width > 0 ? hash % params.width : 0,
    y: params.height > 0 ? Math.floor(hash / 97) % params.height : 0,
  };
}

function resolvePayloadMapId(payload: Record<string, unknown>) {
  return readPayloadString(payload, [
    "mapId",
    "worldMapId",
    "targetMapId",
    "currentMapId",
  ]);
}

function resolvePayloadEntityKind(payload: Record<string, unknown>, fallback: WorldMapEntityKind): WorldMapEntityKind {
  const rawKind = readPayloadString(payload, ["kind", "entityKind", "mapEntityKind", "entryKind", "sourceKind"]);
  if (
    rawKind === "opportunity"
    || rawKind === "limited_opportunity"
    || rawKind === "portal"
    || rawKind === "event_portal"
    || rawKind === "secret_realm"
    || rawKind === "reputation_event"
    || rawKind === "world_commission"
    || rawKind === "sect_home"
    || rawKind === "sect_activity"
    || rawKind === "temporary_blocker"
    || rawKind === "sealed_area"
  ) {
    return rawKind;
  }
  return fallback;
}

function normalizeEventTypeEntityKind(eventType: string): WorldMapEntityKind {
  const normalized = eventType.trim().toLowerCase();
  if (normalized.includes("sect")) {
    return "sect_activity";
  }
  if (normalized.includes("commission") || normalized.includes("quest") || normalized.includes("world")) {
    return "world_commission";
  }
  if (normalized.includes("reputation") || normalized.includes("fame")) {
    return "reputation_event";
  }
  if (normalized.includes("portal") || normalized.includes("entrance") || normalized.includes("rift")) {
    return "event_portal";
  }
  if (normalized.includes("limited") || normalized.includes("temporary") || normalized.includes("timed")) {
    return "limited_opportunity";
  }
  return "opportunity";
}

function isPayloadEntryActive(payload: Record<string, unknown>) {
  const nowMs = Date.now();
  const startsAtMs = parseTimeMs(payload.startsAt ?? payload.activeFrom ?? payload.spawnedAt);
  const expiresAtMs = parseTimeMs(payload.expiresAt ?? payload.activeUntil ?? payload.endsAt);
  return (startsAtMs === null || startsAtMs <= nowMs)
    && (expiresAtMs === null || expiresAtMs > nowMs);
}

function createPayloadEntityRecord(params: {
  payload: Record<string, unknown>;
  fallbackId: string;
  fallbackKind: WorldMapEntityKind;
  fallbackName: string;
  fallbackKey: string;
  map: WorldMapRuntimeRecord;
}): WorldMapEntityRecord | null {
  if (!isPayloadEntryActive(params.payload)) {
    return null;
  }
  const payloadMapId = resolvePayloadMapId(params.payload);
  if (payloadMapId && payloadMapId !== params.map.id) {
    return null;
  }
  if (readPayloadBoolean(params.payload, ["hidden", "privateOnly", "backendOnly"])) {
    return null;
  }

  const position = resolvePayloadPosition({
    payload: params.payload,
    fallbackKey: params.fallbackKey,
    width: params.map.width,
    height: params.map.height,
  });
  const id = readPayloadString(params.payload, ["id", "entityId", "entryId", "refId"]) || params.fallbackId;
  const name = readPayloadString(params.payload, ["name", "label", "title", "summary"]) || params.fallbackName;
  return {
    id,
    kind: resolvePayloadEntityKind(params.payload, params.fallbackKind),
    name,
    positionX: position.x,
    positionY: position.y,
  };
}

function collectPayloadEntityRecords(params: {
  payload: Record<string, unknown>;
  sourceId: string;
  sourceKind: WorldMapEntityKind;
  sourceName: string;
  map: WorldMapRuntimeRecord;
}): WorldMapEntityRecord[] {
  const direct = createPayloadEntityRecord({
    payload: params.payload,
    fallbackId: `${params.sourceKind}:${params.sourceId}`,
    fallbackKind: params.sourceKind,
    fallbackName: params.sourceName,
    fallbackKey: `${params.sourceKind}:${params.sourceId}`,
    map: params.map,
  });

  const extras: WorldMapEntityRecord[] = [];
  for (const key of EXTRA_ENTITY_LIST_KEYS) {
    const entries = params.payload[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    entries.forEach((entry, index) => {
      const record = createPayloadEntityRecord({
        payload: readPayloadRecord(entry),
        fallbackId: `${params.sourceKind}:${params.sourceId}:${key}:${index}`,
        fallbackKind: params.sourceKind,
        fallbackName: params.sourceName,
        fallbackKey: `${params.sourceKind}:${params.sourceId}:${key}:${index}`,
        map: params.map,
      });
      if (record) {
        extras.push(record);
      }
    });
  }

  return [
    ...(direct ? [direct] : []),
    ...extras,
  ];
}

function collectDynamicBlockedTiles(params: {
  payload: Record<string, unknown>;
  map: WorldMapRuntimeRecord;
  fallbackKey: string;
}) {
  const blockedTiles = new Set<string>();
  const entries: Record<string, unknown>[] = [];
  for (const key of ["temporaryBlockers", "blockedAreas", "sealedAreas", "portalPlaceholders"]) {
    const value = params.payload[key];
    if (Array.isArray(value)) {
      entries.push(...value.map(readPayloadRecord));
    }
  }
  if (
    readPayloadBoolean(params.payload, ["blocksMovement", "temporaryBlocked", "sealedArea", "portalPlaceholder"])
  ) {
    entries.push(params.payload);
  }

  entries.forEach((entry, index) => {
    if (!isPayloadEntryActive(entry)) {
      return;
    }
    const payloadMapId = resolvePayloadMapId(entry);
    if (payloadMapId && payloadMapId !== params.map.id) {
      return;
    }
    const position = resolvePayloadPosition({
      payload: entry,
      fallbackKey: `${params.fallbackKey}:${index}`,
      width: params.map.width,
      height: params.map.height,
    });
    blockedTiles.add(tileKey(position.x, position.y));

    const radius = Math.max(0, Math.min(8, Math.floor(readPayloadNumber(entry, ["radius", "blockRadius"]) || 0)));
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const next = clampPositionToMap({
          x: position.x + dx,
          y: position.y + dy,
          width: params.map.width,
          height: params.map.height,
        });
        blockedTiles.add(tileKey(next.x, next.y));
      }
    }
  });

  return blockedTiles;
}

function mergeBlockedTiles(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (!right.size) {
    return left;
  }
  return new Set([...left, ...right]);
}

function resolvePayloadPosition(params: {
  payload: Record<string, unknown>;
  fallbackKey: string;
  width: number;
  height: number;
}) {
  const nestedLocation = readPayloadRecord(params.payload.location);
  const nestedTarget = readPayloadRecord(params.payload.target);
  const x = readPayloadNumber(params.payload, ["positionX", "x", "targetX", "targetPositionX"])
    ?? readPayloadNumber(nestedLocation, ["positionX", "x"])
    ?? readPayloadNumber(nestedTarget, ["positionX", "x"]);
  const y = readPayloadNumber(params.payload, ["positionY", "y", "targetY", "targetPositionY"])
    ?? readPayloadNumber(nestedLocation, ["positionY", "y"])
    ?? readPayloadNumber(nestedTarget, ["positionY", "y"]);

  if (typeof x === "number" && typeof y === "number") {
    return normalizeEntityPosition({
      x,
      y,
      width: params.width,
      height: params.height,
    });
  }

  return deterministicPositionFromKey({
    key: params.fallbackKey,
    width: params.width,
    height: params.height,
  });
}

function createFallbackMap(mapId: string): WorldMapRuntimeRecord {
  return {
    id: normalizeId(mapId),
    name: "未连接地图",
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    runtimeSource: "fallback",
    blockedTiles: new Set<string>(),
    tilePortalEntities: [],
  };
}

function assertDatabaseUrlConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未配置");
  }
}

async function loadMapDb() {
  assertDatabaseUrlConfigured();
  const { db, schema } = await import("../../../src/db");
  return {
    db,
    mapOpportunitySpawns: schema.mapOpportunitySpawns,
    maps: schema.maps,
    monsters: schema.monsters,
    npcs: schema.npcs,
    players: schema.players,
    randomEvents: schema.randomEvents,
    secretRealmSpawns: schema.secretRealmSpawns,
    secretRealmTemplates: schema.secretRealmTemplates,
    sects: schema.sects,
    worldMapPortals: schema.worldMapPortals,
    worldMapInstances: schema.worldMapInstances,
    worldNpcProfiles: schema.worldNpcProfiles,
    worldNpcRuntime: schema.worldNpcRuntime,
    playerWorldEventOffers: schema.playerWorldEventOffers,
    playerWorldIncidents: schema.playerWorldIncidents,
    worldStorylines: schema.worldStorylines,
  };
}

async function loadPlayerRecord(playerId: string): Promise<WorldMapPlayerRecord | null> {
  const normalizedPlayerId = String(playerId || "").trim();
  if (!normalizedPlayerId) {
    return null;
  }

  const mapDb = await loadMapDb();
  const row = await mapDb.db.select({
    id: mapDb.players.id,
    name: mapDb.players.name,
    currentMapId: mapDb.players.currentMapId,
    positionX: mapDb.players.positionX,
    positionY: mapDb.players.positionY,
  }).from(mapDb.players).where(eq(mapDb.players.id, normalizedPlayerId)).get();

  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    name: row.name || row.id,
    currentMapId: row.currentMapId,
    positionX: normalizeGridCoordinate(row.positionX),
    positionY: normalizeGridCoordinate(row.positionY),
  };
}

async function loadRuntimeMapById(mapId: string): Promise<WorldMapRuntimeRecord | null> {
  const normalizedMapId = normalizeId(mapId);
  const { getRuntimeMapById } = await import("../../../src/modules/map/services/runtime-map-store");
  const runtimeMap = await getRuntimeMapById(normalizedMapId);
  if (!runtimeMap) {
    return null;
  }

  const width = normalizeDimension(runtimeMap.width, DEFAULT_MAP_WIDTH);
  const height = normalizeDimension(runtimeMap.height, DEFAULT_MAP_HEIGHT);
  return {
    id: runtimeMap.id,
    name: runtimeMap.name,
    width,
    height,
    runtimeSource: runtimeMap.runtimeSource,
    blockedTiles: buildBlockedTileSet(runtimeMap.tilesData),
    tilePortalEntities: buildPortalEntityRecords({
      mapId: runtimeMap.id,
      tilesData: runtimeMap.tilesData,
      width,
      height,
    }),
  };
}

function normalizeEntityPosition(params: {
  x: unknown;
  y: unknown;
  width: number;
  height: number;
}) {
  return clampPositionToMap({
    x: normalizeGridCoordinate(params.x),
    y: normalizeGridCoordinate(params.y),
    width: params.width,
    height: params.height,
  });
}

async function loadStaticMapEntities(map: WorldMapRuntimeRecord): Promise<WorldMapEntityRecord[]> {
  const mapDb = await loadMapDb();
  const nowIso = new Date().toISOString();
  const [npcRows, monsterRows, opportunityRows, secretRealmRows, sectRows] = await Promise.all([
    mapDb.db.select({
      id: mapDb.npcs.id,
      name: mapDb.npcs.name,
      positionX: mapDb.npcs.positionX,
      positionY: mapDb.npcs.positionY,
    }).from(mapDb.npcs).where(eq(mapDb.npcs.mapId, map.id)).all(),
    mapDb.db.select({
      id: mapDb.monsters.id,
      name: mapDb.monsters.name,
      positionX: mapDb.monsters.positionX,
      positionY: mapDb.monsters.positionY,
      currentPositionX: mapDb.monsters.currentPositionX,
      currentPositionY: mapDb.monsters.currentPositionY,
    }).from(mapDb.monsters).where(eq(mapDb.monsters.mapId, map.id)).all(),
    mapDb.db.select({
      spawnId: mapDb.mapOpportunitySpawns.id,
      name: mapDb.randomEvents.name,
      eventType: mapDb.randomEvents.eventType,
      positionX: mapDb.mapOpportunitySpawns.positionX,
      positionY: mapDb.mapOpportunitySpawns.positionY,
    }).from(mapDb.mapOpportunitySpawns)
      .innerJoin(mapDb.randomEvents, eq(mapDb.randomEvents.id, mapDb.mapOpportunitySpawns.eventId))
      .where(and(
        eq(mapDb.mapOpportunitySpawns.mapId, map.id),
        isNull(mapDb.mapOpportunitySpawns.claimedAt),
        gt(mapDb.mapOpportunitySpawns.expiresAt, nowIso),
      ))
      .all(),
    mapDb.db.select({
      spawnId: mapDb.secretRealmSpawns.id,
      name: mapDb.secretRealmTemplates.name,
      positionX: mapDb.secretRealmSpawns.positionX,
      positionY: mapDb.secretRealmSpawns.positionY,
    }).from(mapDb.secretRealmSpawns)
      .innerJoin(mapDb.secretRealmTemplates, eq(mapDb.secretRealmTemplates.id, mapDb.secretRealmSpawns.templateId))
      .where(and(
        eq(mapDb.secretRealmSpawns.mapId, map.id),
        eq(mapDb.secretRealmSpawns.status, "active"),
        eq(mapDb.secretRealmSpawns.spawnType, "global"),
        gt(mapDb.secretRealmSpawns.expiresAt, nowIso),
      ))
      .all(),
    mapDb.db.select({
      id: mapDb.sects.id,
      name: mapDb.sects.name,
      externalMapId: mapDb.sects.externalMapId,
      externalPositionX: mapDb.sects.externalPositionX,
      externalPositionY: mapDb.sects.externalPositionY,
      homeMapId: mapDb.sects.homeMapId,
      state: mapDb.sects.state,
    }).from(mapDb.sects)
      .where(eq(mapDb.sects.state, "active"))
      .all(),
  ]);

  return [
    ...map.tilePortalEntities,
    ...npcRows.map((row) => {
      const position = normalizeEntityPosition({
        x: row.positionX,
        y: row.positionY,
        width: map.width,
        height: map.height,
      });
      return {
        id: `npc:${row.id}`,
        kind: "npc" as const,
        name: row.name || row.id,
        positionX: position.x,
        positionY: position.y,
      };
    }),
    ...monsterRows.map((row) => {
      const position = normalizeEntityPosition({
        x: row.currentPositionX ?? row.positionX,
        y: row.currentPositionY ?? row.positionY,
        width: map.width,
        height: map.height,
      });
      return {
        id: `monster:${row.id}`,
        kind: "monster" as const,
        name: row.name || row.id,
        positionX: position.x,
        positionY: position.y,
      };
    }),
    ...opportunityRows.map((row) => {
      const position = normalizeEntityPosition({
        x: row.positionX,
        y: row.positionY,
        width: map.width,
        height: map.height,
      });
      return {
        id: `opportunity:${row.spawnId}`,
        kind: normalizeEventTypeEntityKind(row.eventType || "opportunity"),
        name: row.name || "机缘",
        positionX: position.x,
        positionY: position.y,
      };
    }),
    ...secretRealmRows.map((row) => {
      const position = normalizeEntityPosition({
        x: row.positionX,
        y: row.positionY,
        width: map.width,
        height: map.height,
      });
      return {
        id: `secret_realm:${row.spawnId}`,
        kind: "secret_realm" as const,
        name: row.name || "秘境入口",
        positionX: position.x,
        positionY: position.y,
      };
    }),
    ...sectRows.flatMap((row) => {
      if (row.externalMapId === map.id) {
        const position = normalizeEntityPosition({
          x: row.externalPositionX,
          y: row.externalPositionY,
          width: map.width,
          height: map.height,
        });
        return [{
          id: `sect_home:${row.id}:entrance`,
          kind: "sect_home" as const,
          name: `${row.name || "宗门"}驻地入口`,
          positionX: position.x,
          positionY: position.y,
        }];
      }

      if (row.homeMapId === map.id) {
        const position = deterministicPositionFromKey({
          key: `sect_home:${row.id}:home`,
          width: map.width,
          height: map.height,
        });
        return [{
          id: `sect_home:${row.id}:home`,
          kind: "sect_home" as const,
          name: row.name || "宗门驻地",
          positionX: position.x,
          positionY: position.y,
        }];
      }

      return [];
    }),
  ];
}

async function loadPrivateVisibleSecretRealmEntities(params: {
  map: WorldMapRuntimeRecord;
  playerId?: string | null;
}): Promise<WorldMapEntityRecord[]> {
  const normalizedPlayerId = String(params.playerId || "").trim();
  if (!normalizedPlayerId || params.map.runtimeSource !== "map") {
    return [];
  }

  const mapDb = await loadMapDb();
  const nowIso = new Date().toISOString();
  const rows = await mapDb.db.select({
    spawnId: mapDb.secretRealmSpawns.id,
    name: mapDb.secretRealmTemplates.name,
    spawnType: mapDb.secretRealmSpawns.spawnType,
    ownerPlayerId: mapDb.secretRealmSpawns.ownerPlayerId,
    visiblePlayerIds: mapDb.secretRealmSpawns.visiblePlayerIds,
    positionX: mapDb.secretRealmSpawns.positionX,
    positionY: mapDb.secretRealmSpawns.positionY,
  }).from(mapDb.secretRealmSpawns)
    .innerJoin(mapDb.secretRealmTemplates, eq(mapDb.secretRealmTemplates.id, mapDb.secretRealmSpawns.templateId))
    .where(and(
      eq(mapDb.secretRealmSpawns.mapId, params.map.id),
      eq(mapDb.secretRealmSpawns.status, "active"),
      eq(mapDb.secretRealmSpawns.spawnType, "personal"),
      gt(mapDb.secretRealmSpawns.expiresAt, nowIso),
    ))
    .all();

  return rows
    .filter((row) => (
      row.ownerPlayerId === normalizedPlayerId
      || (Array.isArray(row.visiblePlayerIds) && row.visiblePlayerIds.includes(normalizedPlayerId))
    ))
    .map((row) => {
      const position = normalizeEntityPosition({
        x: row.positionX,
        y: row.positionY,
        width: params.map.width,
        height: params.map.height,
      });
      return {
        id: `secret_realm:${row.spawnId}`,
        kind: "secret_realm" as const,
        name: row.name || "个人秘境入口",
        positionX: position.x,
        positionY: position.y,
      };
    });
}

async function loadPrivateWorldGuidanceEntities(params: {
  map: WorldMapRuntimeRecord;
  playerId?: string | null;
}): Promise<WorldMapEntityRecord[]> {
  const normalizedPlayerId = String(params.playerId || "").trim();
  if (!normalizedPlayerId || params.map.runtimeSource === "fallback") {
    return [];
  }

  const mapDb = await loadMapDb();
  const nowIso = new Date().toISOString();
  const [incidentRows, offerRows] = await Promise.all([
    mapDb.db.select({
      id: mapDb.playerWorldIncidents.id,
      incidentType: mapDb.playerWorldIncidents.incidentType,
      mapId: mapDb.playerWorldIncidents.mapId,
      districtName: mapDb.playerWorldIncidents.districtName,
      summary: mapDb.playerWorldIncidents.summary,
      payloadJson: mapDb.playerWorldIncidents.payloadJson,
    }).from(mapDb.playerWorldIncidents)
      .where(and(
        eq(mapDb.playerWorldIncidents.playerId, normalizedPlayerId),
        eq(mapDb.playerWorldIncidents.mapId, params.map.id),
      ))
      .limit(30)
      .all(),
    mapDb.db.select({
      id: mapDb.playerWorldEventOffers.id,
      offerType: mapDb.playerWorldEventOffers.offerType,
      sourceNpcId: mapDb.playerWorldEventOffers.sourceNpcId,
      summary: mapDb.playerWorldEventOffers.summary,
      payloadJson: mapDb.playerWorldEventOffers.payloadJson,
      npcCurrentMapId: mapDb.worldNpcRuntime.currentMapId,
      npcPositionX: mapDb.worldNpcRuntime.positionX,
      npcPositionY: mapDb.worldNpcRuntime.positionY,
    }).from(mapDb.playerWorldEventOffers)
      .leftJoin(mapDb.worldNpcRuntime, eq(mapDb.worldNpcRuntime.npcId, mapDb.playerWorldEventOffers.sourceNpcId))
      .where(and(
        eq(mapDb.playerWorldEventOffers.playerId, normalizedPlayerId),
        eq(mapDb.playerWorldEventOffers.status, "pending"),
        gt(mapDb.playerWorldEventOffers.expiresAt, nowIso),
      ))
      .limit(30)
      .all(),
  ]);

  const incidentEntities = incidentRows.flatMap((row) => {
    const payload = readPayloadRecord(row.payloadJson);
    return collectPayloadEntityRecords({
      payload,
      sourceId: String(row.id),
      sourceKind: "reputation_event",
      sourceName: row.summary || "名声事件",
      map: params.map,
    }).map((entity, index) => ({
      ...entity,
      id: index === 0 ? `reputation_event:${row.id}` : entity.id,
    }));
  });

  const offerEntities = offerRows.flatMap((row) => {
    const payload = readPayloadRecord(row.payloadJson);
    const payloadMapId = resolvePayloadMapId(payload);
    const sourceNpcOnMap = row.npcCurrentMapId === params.map.id;
    if (payloadMapId && payloadMapId !== params.map.id && !sourceNpcOnMap) {
      return [];
    }
    if (!payloadMapId && !sourceNpcOnMap) {
      return [];
    }

    const payloadPosition = resolvePayloadPosition({
      payload,
      fallbackKey: `world_commission:offer:${row.id}:${row.offerType}`,
      width: params.map.width,
      height: params.map.height,
    });
    const position = sourceNpcOnMap && typeof row.npcPositionX === "number" && typeof row.npcPositionY === "number"
      ? normalizeEntityPosition({
        x: row.npcPositionX,
        y: row.npcPositionY,
        width: params.map.width,
        height: params.map.height,
      })
      : payloadPosition;

    const primary = {
      id: `world_commission:offer:${row.id}`,
      kind: resolvePayloadEntityKind(payload, "world_commission"),
      name: row.summary || "世界委托",
      positionX: position.x,
      positionY: position.y,
    };
    const extras = collectPayloadEntityRecords({
      payload,
      sourceId: `offer:${row.id}`,
      sourceKind: "world_commission",
      sourceName: row.summary || "世界委托",
      map: params.map,
    }).filter((entity) => entity.id !== primary.id);

    return [primary, ...extras];
  });

  return [
    ...incidentEntities,
    ...offerEntities,
  ];
}

async function loadWorldMapNpcEntities(map: WorldMapRuntimeRecord): Promise<WorldMapEntityRecord[]> {
  const mapDb = await loadMapDb();
  const [npcRows, portalRows, storylineRows] = await Promise.all([
    mapDb.db.select({
      id: mapDb.worldNpcProfiles.id,
      name: mapDb.worldNpcProfiles.name,
      status: mapDb.worldNpcProfiles.status,
      positionX: mapDb.worldNpcRuntime.positionX,
      positionY: mapDb.worldNpcRuntime.positionY,
    }).from(mapDb.worldNpcProfiles)
      .innerJoin(mapDb.worldNpcRuntime, eq(mapDb.worldNpcRuntime.npcId, mapDb.worldNpcProfiles.id))
      .where(and(
        eq(mapDb.worldNpcRuntime.currentMapId, map.id),
        eq(mapDb.worldNpcRuntime.isActivated, true),
      ))
      .all(),
    mapDb.db.select({
      id: mapDb.worldMapPortals.id,
      name: mapDb.worldMapPortals.portalName,
      positionX: mapDb.worldMapPortals.positionX,
      positionY: mapDb.worldMapPortals.positionY,
    }).from(mapDb.worldMapPortals).where(eq(mapDb.worldMapPortals.worldMapId, map.id)).all(),
    mapDb.db.select({
      id: mapDb.worldStorylines.id,
      storylineType: mapDb.worldStorylines.storylineType,
      stageTitle: mapDb.worldStorylines.stageTitle,
      summary: mapDb.worldStorylines.summary,
      districtName: mapDb.worldStorylines.districtName,
      objectivePointId: mapDb.worldStorylines.objectivePointId,
      payloadJson: mapDb.worldStorylines.payloadJson,
    }).from(mapDb.worldStorylines)
      .where(and(
        eq(mapDb.worldStorylines.mapId, map.id),
        eq(mapDb.worldStorylines.status, "active"),
      ))
      .limit(50)
      .all(),
  ]);

  return [
    ...map.tilePortalEntities,
    ...npcRows
      .filter((row) => row.status !== "dead")
      .map((row) => {
        const position = normalizeEntityPosition({
          x: row.positionX,
          y: row.positionY,
          width: map.width,
          height: map.height,
        });
        return {
          id: `npc:${row.id}`,
          kind: "npc" as const,
          name: row.name || row.id,
          positionX: position.x,
          positionY: position.y,
        };
      }),
    ...portalRows.map((row) => {
      const position = normalizeEntityPosition({
        x: row.positionX,
        y: row.positionY,
        width: map.width,
        height: map.height,
      });
      return {
        id: `portal:${row.id}`,
        kind: "portal" as const,
        name: row.name || "传送点",
        positionX: position.x,
        positionY: position.y,
      };
    }),
    ...storylineRows.flatMap((row) => {
      const payload = readPayloadRecord(row.payloadJson);
      const position = resolvePayloadPosition({
        payload,
        fallbackKey: `world_commission:storyline:${row.id}:${row.districtName}:${row.objectivePointId || row.stageTitle}`,
        width: map.width,
        height: map.height,
      });
      const sourceKind = row.storylineType.includes("sect") ? "sect_activity" : "world_commission";
      const primary = {
        id: `world_commission:storyline:${row.id}`,
        kind: resolvePayloadEntityKind(payload, sourceKind),
        name: row.stageTitle || row.summary || "世界委托",
        positionX: position.x,
        positionY: position.y,
      };
      const extras = collectPayloadEntityRecords({
        payload,
        sourceId: `storyline:${row.id}`,
        sourceKind,
        sourceName: row.stageTitle || row.summary || "世界委托",
        map,
      }).filter((entity) => entity.id !== primary.id);
      return [primary, ...extras];
    }),
  ];
}

async function safeLoadWorldMapEntities(map: WorldMapRuntimeRecord): Promise<{
  entities: WorldMapEntityRecord[];
  degraded: boolean;
  degradeReason?: string;
}> {
  if (map.runtimeSource === "fallback") {
    return {
      entities: [],
      degraded: false,
    };
  }

  try {
    const entities = map.runtimeSource === "world"
      ? await loadWorldMapNpcEntities(map)
      : await loadStaticMapEntities(map);
    return {
      entities,
      degraded: false,
    };
  } catch (error) {
    return {
      entities: [],
      degraded: true,
      degradeReason: error instanceof Error ? error.message : "map_entities_db_unavailable",
    };
  }
}

async function safeLoadPrivateVisibleEntities(params: {
  map: WorldMapRuntimeRecord;
  playerId?: string | null;
}): Promise<{
  entities: WorldMapEntityRecord[];
  degraded: boolean;
  degradeReason?: string;
}> {
  if (params.map.runtimeSource === "fallback" || !params.playerId) {
    return {
      entities: [],
      degraded: false,
    };
  }

  try {
    const [secretRealms, worldGuidance] = await Promise.all([
      loadPrivateVisibleSecretRealmEntities(params),
      loadPrivateWorldGuidanceEntities(params),
    ]);
    return {
      entities: [
        ...secretRealms,
        ...worldGuidance,
      ],
      degraded: false,
    };
  } catch (error) {
    return {
      entities: [],
      degraded: true,
      degradeReason: error instanceof Error ? error.message : "private_map_entities_db_unavailable",
    };
  }
}

async function loadDynamicBlockedTiles(params: {
  map: WorldMapRuntimeRecord;
  playerId?: string | null;
}) {
  if (params.map.runtimeSource === "fallback") {
    return new Set<string>();
  }

  const mapDb = await loadMapDb();
  const nowIso = new Date().toISOString();
  const normalizedPlayerId = String(params.playerId || "").trim();
  const [storylineRows, incidentRows, offerRows] = await Promise.all([
    mapDb.db.select({
      id: mapDb.worldStorylines.id,
      payloadJson: mapDb.worldStorylines.payloadJson,
    }).from(mapDb.worldStorylines)
      .where(and(
        eq(mapDb.worldStorylines.mapId, params.map.id),
        eq(mapDb.worldStorylines.status, "active"),
      ))
      .limit(50)
      .all(),
    normalizedPlayerId
      ? mapDb.db.select({
        id: mapDb.playerWorldIncidents.id,
        payloadJson: mapDb.playerWorldIncidents.payloadJson,
      }).from(mapDb.playerWorldIncidents)
        .where(and(
          eq(mapDb.playerWorldIncidents.playerId, normalizedPlayerId),
          eq(mapDb.playerWorldIncidents.mapId, params.map.id),
        ))
        .limit(50)
        .all()
      : Promise.resolve([]),
    normalizedPlayerId
      ? mapDb.db.select({
        id: mapDb.playerWorldEventOffers.id,
        payloadJson: mapDb.playerWorldEventOffers.payloadJson,
      }).from(mapDb.playerWorldEventOffers)
        .where(and(
          eq(mapDb.playerWorldEventOffers.playerId, normalizedPlayerId),
          eq(mapDb.playerWorldEventOffers.status, "pending"),
          gt(mapDb.playerWorldEventOffers.expiresAt, nowIso),
        ))
        .limit(50)
        .all()
      : Promise.resolve([]),
  ]);

  const blockedTiles = new Set<string>();
  for (const row of [...storylineRows, ...incidentRows, ...offerRows]) {
    const dynamicTiles = collectDynamicBlockedTiles({
      payload: readPayloadRecord(row.payloadJson),
      map: params.map,
      fallbackKey: `dynamic_block:${row.id}`,
    });
    for (const key of dynamicTiles) {
      blockedTiles.add(key);
    }
  }
  return blockedTiles;
}

async function safeLoadDynamicBlockedTiles(params: {
  map: WorldMapRuntimeRecord;
  playerId?: string | null;
}): Promise<{
  blockedTiles: ReadonlySet<string>;
  degraded: boolean;
  degradeReason?: string;
}> {
  try {
    return {
      blockedTiles: await loadDynamicBlockedTiles(params),
      degraded: false,
    };
  } catch (error) {
    return {
      blockedTiles: new Set<string>(),
      degraded: true,
      degradeReason: error instanceof Error ? error.message : "dynamic_blocked_tiles_db_unavailable",
    };
  }
}

export async function loadWorldMapRoomData(params: {
  mapId?: string;
  playerId?: string | null;
}): Promise<WorldMapRoomData> {
  const requestedMapId = normalizeId(params.mapId);

  try {
    const player = params.playerId ? await loadPlayerRecord(params.playerId) : null;
    const targetMapId = isDefaultMapId(requestedMapId) && player?.currentMapId
      ? player.currentMapId
      : requestedMapId;
    const runtimeMap = await loadRuntimeMapById(targetMapId);
    const map = runtimeMap || createFallbackMap(targetMapId);

    if (!runtimeMap) {
      return {
        map,
        player,
        entities: [],
        privateEntities: [],
        degraded: true,
        degradeReason: "map_not_found",
      };
    }

    if (player) {
      const clampedPosition = clampPositionToMap({
        x: player.positionX,
        y: player.positionY,
        width: map.width,
        height: map.height,
      });
      player.positionX = clampedPosition.x;
      player.positionY = clampedPosition.y;
    }

    const entityData = await safeLoadWorldMapEntities(map);
    const privateEntityData = await safeLoadPrivateVisibleEntities({
      map,
      playerId: params.playerId,
    });
    const dynamicBlockedTileData = await safeLoadDynamicBlockedTiles({
      map,
      playerId: params.playerId,
    });
    const runtimeMapWithDynamicBlocks: WorldMapRuntimeRecord = {
      ...map,
      blockedTiles: mergeBlockedTiles(map.blockedTiles, dynamicBlockedTileData.blockedTiles),
    };

    return {
      map: runtimeMapWithDynamicBlocks,
      player,
      entities: entityData.entities,
      privateEntities: privateEntityData.entities,
      degraded: false,
      entitiesDegraded: entityData.degraded || privateEntityData.degraded || dynamicBlockedTileData.degraded,
      entitiesDegradeReason: entityData.degradeReason || privateEntityData.degradeReason || dynamicBlockedTileData.degradeReason,
    };
  } catch (error) {
    return {
      map: createFallbackMap(requestedMapId),
      player: null,
      entities: [],
      privateEntities: [],
      degraded: true,
      degradeReason: error instanceof Error ? error.message : "map_db_unavailable",
    };
  }
}

export async function persistWorldMapPlayerMove(params: {
  playerId: string;
  mapId: string;
  x: number;
  y: number;
}) {
  if (!process.env.DATABASE_URL) {
    return false;
  }

  const playerId = String(params.playerId || "").trim();
  const mapId = String(params.mapId || "").trim();
  if (!playerId || !mapId) {
    throw new Error("player_move_persist_invalid_identity");
  }
  if (!Number.isSafeInteger(params.x) || !Number.isSafeInteger(params.y)) {
    throw new Error("player_move_persist_invalid_position");
  }

  const mapDb = await loadMapDb();
  // 只落库同地图内的坐标：秘境实例引用（current_map_instance_id）由秘境进出流程维护，
  // 这里绝不能覆写，否则玩家在秘境内一走位就会被判定为“已离开秘境”。
  await mapDb.db.update(mapDb.players)
    .set({
      currentMapId: mapId,
      positionX: Math.max(0, params.x),
      positionY: Math.max(0, params.y),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(mapDb.players.id, playerId))
    .run();
  return true;
}
