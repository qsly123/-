import {
  ensureGlobalMap,
  ensureGlobalSet,
} from "@/modules/shared/services/global-store";
import { markMapPlayerOnlinePresence } from "@/modules/map/services/map-player-online-runtime";
import { invalidateMapSceneContextCache } from "@/modules/map/services/map-scene-loader";
import { invalidateMapReadModelCache } from "@/modules/map/services/map-read-model-cache";

export interface MapPresencePlayerEvent {
  id: string;
  name: string;
  gender?: string | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  realm: number;
  realmMajor?: number | null;
  realmMinor?: number | null;
  realmName: string;
  mapId: string;
  prevMapId: string;
  positionX: number;
  positionY: number;
  prevPositionX?: number | null;
  prevPositionY?: number | null;
}

export interface MapOpportunitySpawnedEvent {
  mapId: string;
  spawnId: string;
  eventId: string;
  name: string;
  iconImageUrl?: string | null;
  minRealm: number;
  maxRealm: number | null;
  positionX: number;
  positionY: number;
  expiresAt: string;
}

export interface MapOpportunityClaimedEvent {
  mapId: string;
  spawnId: string;
  eventId: string;
  claimedByPlayerId: string;
  positionX: number;
  positionY: number;
}

export interface MapMonsterPositionEvent {
  id: string;
  mapId: string;
  positionX: number;
  positionY: number;
  prevPositionX?: number | null;
  prevPositionY?: number | null;
}

export interface MapSecretRealmPresenceEvent {
  mapId: string;
  spawnId: string;
  spawnType: "global" | "personal";
  status: "active" | "entered" | "completed" | "expired";
  ownerPlayerId: string | null;
  visiblePlayerIds: string[];
}

export interface MapRefreshEvent {
  mapId: string;
  reason: "secret_realm" | "monster_defeat" | "map_structure";
}

export type MapPresenceMessage =
  | {
    type: "player_position";
    data: MapPresencePlayerEvent;
  }
  | {
    type: "monster_position";
    data: MapMonsterPositionEvent;
  }
  | {
    type: "opportunity_spawned";
    data: MapOpportunitySpawnedEvent;
  }
  | {
    type: "opportunity_claimed";
    data: MapOpportunityClaimedEvent;
  }
  | {
    type: "secret_realm_changed";
    data: MapSecretRealmPresenceEvent;
  }
  | {
    type: "map_refresh";
    data: MapRefreshEvent;
  };

type MapPresenceSubscriber = (message: MapPresenceMessage) => void;

type MapPresenceGlobal = typeof globalThis & {
  __mapPresenceSubscribers?: Set<MapPresenceSubscriber>;
  __mapPresenceSubscribersByMapId?: Map<string, Set<MapPresenceSubscriber>>;
  __mapPresenceSignalSubscribersByMapId?: Map<string, Set<MapPresenceSubscriber>>;
  __mapPresenceSubscribersByPlayerId?: Map<string, Set<MapPresenceSubscriber>>;
  __mapPresenceSubscribersByAoiKey?: Map<string, Set<MapPresenceSubscriber>>;
  __mapPresenceActiveAoiKeysByMapId?: Map<string, Set<string>>;
  __mapPresenceAoiStats?: {
    routedMessages: number;
    deliveredMessages: number;
    skippedMessagesWithoutActiveArea: number;
  };
};

type MapPresenceAoiMapStat = {
  mapId: string;
  areaKeyCount: number;
  subscriberCount: number;
  signalSubscriberCount: number;
};

const MAP_AOI_TILE_SIZE = parsePositiveIntEnv("MAP_AOI_TILE_SIZE", 12, 1);
const MAP_AOI_PRELOAD_RINGS = parsePositiveIntEnv("MAP_AOI_PRELOAD_RINGS", 1, 0);

function parsePositiveIntEnv(name: string, fallbackValue: number, minValue = 0) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }
  return parsed;
}

function getSubscribers() {
  const globalStore = globalThis as MapPresenceGlobal;
  globalStore.__mapPresenceSubscribers = ensureGlobalSet<MapPresenceSubscriber>(
    globalStore as Record<string, unknown>,
    "__mapPresenceSubscribers",
  );
  return globalStore.__mapPresenceSubscribers;
}

function getSubscribersByMapId() {
  const globalStore = globalThis as MapPresenceGlobal;
  globalStore.__mapPresenceSubscribersByMapId = ensureGlobalMap<string, Set<MapPresenceSubscriber>>(
    globalStore as Record<string, unknown>,
    "__mapPresenceSubscribersByMapId",
  );
  return globalStore.__mapPresenceSubscribersByMapId;
}

function getSignalSubscribersByMapId() {
  const globalStore = globalThis as MapPresenceGlobal;
  globalStore.__mapPresenceSignalSubscribersByMapId = ensureGlobalMap<string, Set<MapPresenceSubscriber>>(
    globalStore as Record<string, unknown>,
    "__mapPresenceSignalSubscribersByMapId",
  );
  return globalStore.__mapPresenceSignalSubscribersByMapId;
}

function getSubscribersByPlayerId() {
  const globalStore = globalThis as MapPresenceGlobal;
  globalStore.__mapPresenceSubscribersByPlayerId = ensureGlobalMap<string, Set<MapPresenceSubscriber>>(
    globalStore as Record<string, unknown>,
    "__mapPresenceSubscribersByPlayerId",
  );
  return globalStore.__mapPresenceSubscribersByPlayerId;
}

function getSubscribersByAoiKey() {
  const globalStore = globalThis as MapPresenceGlobal;
  globalStore.__mapPresenceSubscribersByAoiKey = ensureGlobalMap<string, Set<MapPresenceSubscriber>>(
    globalStore as Record<string, unknown>,
    "__mapPresenceSubscribersByAoiKey",
  );
  return globalStore.__mapPresenceSubscribersByAoiKey;
}

function getAoiStats() {
  const globalStore = globalThis as MapPresenceGlobal;
  if (!globalStore.__mapPresenceAoiStats || typeof globalStore.__mapPresenceAoiStats !== "object") {
    globalStore.__mapPresenceAoiStats = {
      routedMessages: 0,
      deliveredMessages: 0,
      skippedMessagesWithoutActiveArea: 0,
    };
  }
  return globalStore.__mapPresenceAoiStats;
}

function getActiveAoiKeysByMapId() {
  const globalStore = globalThis as MapPresenceGlobal;
  globalStore.__mapPresenceActiveAoiKeysByMapId = ensureGlobalMap<string, Set<string>>(
    globalStore as Record<string, unknown>,
    "__mapPresenceActiveAoiKeysByMapId",
  );
  return globalStore.__mapPresenceActiveAoiKeysByMapId;
}

function registerActiveAoiKey(aoiKey: string) {
  const normalizedAoiKey = String(aoiKey || "").trim();
  if (!normalizedAoiKey) {
    return;
  }
  const [mapId] = normalizedAoiKey.split(":");
  if (!mapId) {
    return;
  }
  const store = getActiveAoiKeysByMapId();
  const keys = store.get(mapId) || new Set<string>();
  keys.add(normalizedAoiKey);
  store.set(mapId, keys);
}

function unregisterActiveAoiKey(aoiKey: string, remainingSubscribers: Set<MapPresenceSubscriber> | undefined) {
  const normalizedAoiKey = String(aoiKey || "").trim();
  if (!normalizedAoiKey) {
    return;
  }
  if (remainingSubscribers && remainingSubscribers.size > 0) {
    return;
  }
  const [mapId] = normalizedAoiKey.split(":");
  if (!mapId) {
    return;
  }
  const store = getActiveAoiKeysByMapId();
  const keys = store.get(mapId);
  if (!keys) {
    return;
  }
  keys.delete(normalizedAoiKey);
  if (keys.size === 0) {
    store.delete(mapId);
  }
}

function buildAoiKey(mapId: string, tileX: number, tileY: number) {
  return `${mapId}:${tileX}:${tileY}`;
}

function normalizeTileCoordinate(value: number) {
  return Math.floor(Math.max(0, Number(value || 0)) / MAP_AOI_TILE_SIZE);
}

function buildAoiKeysAroundPosition(params: {
  mapId: string;
  positionX: number;
  positionY: number;
  preloadRings?: number;
}) {
  const normalizedMapId = String(params.mapId || "").trim();
  if (!normalizedMapId) {
    return [] as string[];
  }
  const rings = Math.max(0, Number.isFinite(params.preloadRings)
    ? Math.floor(Number(params.preloadRings))
    : MAP_AOI_PRELOAD_RINGS);
  const centerTileX = normalizeTileCoordinate(params.positionX);
  const centerTileY = normalizeTileCoordinate(params.positionY);
  const keys = new Set<string>();

  for (let deltaX = -rings; deltaX <= rings; deltaX += 1) {
    for (let deltaY = -rings; deltaY <= rings; deltaY += 1) {
      keys.add(buildAoiKey(
        normalizedMapId,
        Math.max(0, centerTileX + deltaX),
        Math.max(0, centerTileY + deltaY),
      ));
    }
  }

  return Array.from(keys);
}

function getRelevantAoiKeys(message: MapPresenceMessage) {
  if (message.type === "player_position") {
    return Array.from(new Set([
      ...buildAoiKeysAroundPosition({
        mapId: message.data.mapId,
        positionX: message.data.positionX,
        positionY: message.data.positionY,
        preloadRings: 0,
      }),
      ...buildAoiKeysAroundPosition({
        mapId: message.data.prevMapId || message.data.mapId,
        positionX: message.data.prevPositionX ?? message.data.positionX,
        positionY: message.data.prevPositionY ?? message.data.positionY,
        preloadRings: 0,
      }),
    ]));
  }

  if (message.type === "monster_position") {
    return Array.from(new Set([
      ...buildAoiKeysAroundPosition({
        mapId: message.data.mapId,
        positionX: message.data.positionX,
        positionY: message.data.positionY,
        preloadRings: 0,
      }),
      ...buildAoiKeysAroundPosition({
        mapId: message.data.mapId,
        positionX: message.data.prevPositionX ?? message.data.positionX,
        positionY: message.data.prevPositionY ?? message.data.positionY,
        preloadRings: 0,
      }),
    ]));
  }

  if (message.type === "opportunity_spawned" || message.type === "opportunity_claimed") {
    return buildAoiKeysAroundPosition({
      mapId: message.data.mapId,
      positionX: message.data.positionX,
      positionY: message.data.positionY,
      preloadRings: 0,
    });
  }

  return [];
}

function getRelevantMapIds(message: MapPresenceMessage) {
  if (message.type === "player_position") {
    return Array.from(new Set([message.data.mapId, message.data.prevMapId].filter(Boolean)));
  }
  return [message.data.mapId];
}

function getRelevantPlayerIds(message: MapPresenceMessage) {
  if (message.type === "player_position") {
    return [message.data.id];
  }
  return [];
}

function notifySubscriberSet(
  subscribers: Iterable<MapPresenceSubscriber> | undefined,
  message: MapPresenceMessage,
  dispatched: Set<MapPresenceSubscriber>,
) {
  if (!subscribers) {
    return;
  }
  for (const subscriber of subscribers) {
    if (dispatched.has(subscriber)) {
      continue;
    }
    dispatched.add(subscriber);
    try {
      subscriber(message);
    } catch (e) {
      console.error("Map presence subscriber error:", e);
    }
  }
}

function publishMapPresenceMessage(message: MapPresenceMessage) {
  const dispatched = new Set<MapPresenceSubscriber>();
  notifySubscriberSet(getSubscribers(), message, dispatched);

  const subscribersByMapId = getSubscribersByMapId();
  for (const mapId of getRelevantMapIds(message)) {
    notifySubscriberSet(subscribersByMapId.get(mapId), message, dispatched);
  }

  const subscribersByPlayerId = getSubscribersByPlayerId();
  for (const playerId of getRelevantPlayerIds(message)) {
    notifySubscriberSet(subscribersByPlayerId.get(playerId), message, dispatched);
  }

  if (message.type === "secret_realm_changed" || message.type === "map_refresh") {
    const signalSubscribersByMapId = getSignalSubscribersByMapId();
    for (const mapId of getRelevantMapIds(message)) {
      notifySubscriberSet(signalSubscribersByMapId.get(mapId), message, dispatched);
    }
    return;
  }

  const aoiKeys = getRelevantAoiKeys(message);
  if (aoiKeys.length < 1) {
    return;
  }

  const activeAoiKeysByMapId = getActiveAoiKeysByMapId();
  const activeAoiKeys = aoiKeys.filter((aoiKey) => {
    const [mapId] = aoiKey.split(":");
    return Boolean(mapId && activeAoiKeysByMapId.get(mapId)?.has(aoiKey));
  });

  const stats = getAoiStats();
  if (activeAoiKeys.length < 1) {
    stats.skippedMessagesWithoutActiveArea += 1;
    return;
  }
  stats.routedMessages += 1;
  const subscribersByAoiKey = getSubscribersByAoiKey();
  const deliveredCountBefore = dispatched.size;
  for (const aoiKey of activeAoiKeys) {
    notifySubscriberSet(subscribersByAoiKey.get(aoiKey), message, dispatched);
  }
  if (dispatched.size > deliveredCountBefore) {
    stats.deliveredMessages += 1;
  }
}

export function subscribeMapPresence(subscriber: MapPresenceSubscriber) {
  const subscribers = getSubscribers();
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function subscribeMapPresenceForMap(mapId: string, subscriber: MapPresenceSubscriber) {
  const normalizedMapId = mapId.trim();
  if (!normalizedMapId) {
    return () => {};
  }
  const store = getSubscribersByMapId();
  const subscribers = store.get(normalizedMapId) || new Set<MapPresenceSubscriber>();
  subscribers.add(subscriber);
  store.set(normalizedMapId, subscribers);
  return () => {
    const current = store.get(normalizedMapId);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      store.delete(normalizedMapId);
    }
  };
}

export function subscribeMapPresenceForMapSignals(mapId: string, subscriber: MapPresenceSubscriber) {
  const normalizedMapId = mapId.trim();
  if (!normalizedMapId) {
    return () => {};
  }
  const store = getSignalSubscribersByMapId();
  const subscribers = store.get(normalizedMapId) || new Set<MapPresenceSubscriber>();
  subscribers.add(subscriber);
  store.set(normalizedMapId, subscribers);
  return () => {
    const current = store.get(normalizedMapId);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      store.delete(normalizedMapId);
    }
  };
}

export function subscribeMapPresenceForPlayer(playerId: string, subscriber: MapPresenceSubscriber) {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    return () => {};
  }
  const store = getSubscribersByPlayerId();
  const subscribers = store.get(normalizedPlayerId) || new Set<MapPresenceSubscriber>();
  subscribers.add(subscriber);
  store.set(normalizedPlayerId, subscribers);
  return () => {
    const current = store.get(normalizedPlayerId);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      store.delete(normalizedPlayerId);
    }
  };
}

export function buildMapAoiKeysForPlayerPosition(params: {
  mapId: string;
  positionX: number;
  positionY: number;
  preloadRings?: number;
}) {
  return buildAoiKeysAroundPosition(params);
}

export function subscribeMapPresenceForAoiKeys(aoiKeys: string[], subscriber: MapPresenceSubscriber) {
  const normalizedKeys = Array.from(new Set(
    aoiKeys
      .map((key) => String(key || "").trim())
      .filter(Boolean),
  ));
  if (normalizedKeys.length < 1) {
    return () => {};
  }

  const store = getSubscribersByAoiKey();
  normalizedKeys.forEach((aoiKey) => {
    const subscribers = store.get(aoiKey) || new Set<MapPresenceSubscriber>();
    subscribers.add(subscriber);
    store.set(aoiKey, subscribers);
    registerActiveAoiKey(aoiKey);
  });

  return () => {
    normalizedKeys.forEach((aoiKey) => {
      const current = store.get(aoiKey);
      if (!current) {
        return;
      }
      current.delete(subscriber);
      if (current.size === 0) {
        store.delete(aoiKey);
      }
      unregisterActiveAoiKey(aoiKey, current);
    });
  };
}

export function publishMapPresencePlayerPosition(event: MapPresencePlayerEvent) {
  markMapPlayerOnlinePresence({
    playerId: event.id,
    mapId: event.mapId,
    positionX: event.positionX,
    positionY: event.positionY,
  });

  if (!event.name) return;

  const message: MapPresenceMessage = { type: "player_position", data: event };
  publishMapPresenceMessage(message);
}

export function publishMapPresenceMonsterPosition(event: MapMonsterPositionEvent) {
  if (!event.id) return;

  const message: MapPresenceMessage = { type: "monster_position", data: event };
  publishMapPresenceMessage(message);
}

export function publishMapOpportunitySpawned(event: MapOpportunitySpawnedEvent) {
  invalidateMapSceneContextCache({
    mapId: event.mapId,
  });
  invalidateMapReadModelCache(`map:panel:${event.mapId}:`);
  const message: MapPresenceMessage = { type: "opportunity_spawned", data: event };
  publishMapPresenceMessage(message);
}

export function publishMapOpportunityClaimed(event: MapOpportunityClaimedEvent) {
  invalidateMapSceneContextCache({
    mapId: event.mapId,
    playerId: event.claimedByPlayerId,
  });
  invalidateMapReadModelCache(`map:panel:${event.mapId}:`);
  const message: MapPresenceMessage = { type: "opportunity_claimed", data: event };
  publishMapPresenceMessage(message);
}

export function publishMapSecretRealmChanged(event: MapSecretRealmPresenceEvent) {
  invalidateMapSceneContextCache({
    mapId: event.mapId,
  });
  invalidateMapReadModelCache(`map:panel:${event.mapId}:`);
  const message: MapPresenceMessage = { type: "secret_realm_changed", data: event };
  publishMapPresenceMessage(message);
}

export function publishMapRefresh(event: MapRefreshEvent) {
  invalidateMapSceneContextCache({
    mapId: event.mapId,
  });
  invalidateMapReadModelCache(`map:panel:${event.mapId}:`);
  const message: MapPresenceMessage = { type: "map_refresh", data: event };
  publishMapPresenceMessage(message);
}

export function collectMapPresenceSubscriptionStats() {
  const areaStore = getSubscribersByAoiKey();
  const signalStore = getSignalSubscribersByMapId();
  const stats = getAoiStats();
  const mapStatMap = new Map<string, MapPresenceAoiMapStat>();

  for (const [aoiKey, subscribers] of areaStore.entries()) {
    const [mapId] = aoiKey.split(":");
    const current = mapStatMap.get(mapId) || {
      mapId,
      areaKeyCount: 0,
      subscriberCount: 0,
      signalSubscriberCount: 0,
    };
    current.areaKeyCount += 1;
    current.subscriberCount += subscribers.size;
    mapStatMap.set(mapId, current);
  }

  for (const [mapId, subscribers] of signalStore.entries()) {
    const current = mapStatMap.get(mapId) || {
      mapId,
      areaKeyCount: 0,
      subscriberCount: 0,
      signalSubscriberCount: 0,
    };
    current.signalSubscriberCount = subscribers.size;
    mapStatMap.set(mapId, current);
  }

  return {
    tileSize: MAP_AOI_TILE_SIZE,
    preloadRings: MAP_AOI_PRELOAD_RINGS,
    activeAreaKeyCount: areaStore.size,
    activeAreaSubscriberCount: Array.from(areaStore.values())
      .reduce((sum, subscribers) => sum + subscribers.size, 0),
    routedMessages: stats.routedMessages,
    deliveredMessages: stats.deliveredMessages,
    skippedMessagesWithoutActiveArea: stats.skippedMessagesWithoutActiveArea,
    deliveryHitRate: stats.routedMessages > 0
      ? Number((stats.deliveredMessages / stats.routedMessages).toFixed(4))
      : 0,
    topMaps: Array.from(mapStatMap.values())
      .sort((left, right) => (
        (right.subscriberCount + right.signalSubscriberCount) - (left.subscriberCount + left.signalSubscriberCount)
      ))
      .slice(0, 8),
  };
}
