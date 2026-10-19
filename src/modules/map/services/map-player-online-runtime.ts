import { ensureGlobalMap } from "@/modules/shared/services/global-store";

const MAP_PLAYER_ONLINE_TTL_MS = 45_000;

type MapPlayerOnlinePresence = {
  playerId: string;
  mapId: string;
  positionX: number;
  positionY: number;
  updatedAtMs: number;
};

type MapPlayerOnlineRuntimeGlobal = typeof globalThis & {
  __mapOnlinePlayerPresenceByPlayerId?: Map<string, MapPlayerOnlinePresence>;
};

function getPresenceByPlayerId() {
  const globalStore = globalThis as MapPlayerOnlineRuntimeGlobal;
  globalStore.__mapOnlinePlayerPresenceByPlayerId = ensureGlobalMap<string, MapPlayerOnlinePresence>(
    globalStore as Record<string, unknown>,
    "__mapOnlinePlayerPresenceByPlayerId",
  );
  return globalStore.__mapOnlinePlayerPresenceByPlayerId;
}

function pruneExpiredMapPlayerOnlinePresence(nowMs = Date.now()) {
  for (const [playerId, presence] of getPresenceByPlayerId().entries()) {
    if (nowMs - presence.updatedAtMs > MAP_PLAYER_ONLINE_TTL_MS) {
      getPresenceByPlayerId().delete(playerId);
    }
  }
}

export function markMapPlayerOnlinePresence(params: {
  playerId: string;
  mapId: string;
  positionX: number;
  positionY: number;
}) {
  const playerId = params.playerId.trim();
  const mapId = params.mapId.trim();
  if (!playerId || !mapId) {
    return;
  }

  pruneExpiredMapPlayerOnlinePresence();
  getPresenceByPlayerId().set(playerId, {
    playerId,
    mapId,
    positionX: Math.max(0, Math.floor(params.positionX)),
    positionY: Math.max(0, Math.floor(params.positionY)),
    updatedAtMs: Date.now(),
  });
}

export function peekMapPlayerOnlinePresence(playerId: string) {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    return null;
  }

  pruneExpiredMapPlayerOnlinePresence();
  return getPresenceByPlayerId().get(normalizedPlayerId) || null;
}

export function listOnlineMapPlayerIdsByMap(mapId: string) {
  const normalizedMapId = mapId.trim();
  if (!normalizedMapId) {
    return new Set<string>();
  }

  pruneExpiredMapPlayerOnlinePresence();
  return new Set(
    Array.from(getPresenceByPlayerId().values())
      .filter((presence) => presence.mapId === normalizedMapId)
      .map((presence) => presence.playerId),
  );
}

export function getMapPlayerOnlinePresenceTtlMs() {
  return MAP_PLAYER_ONLINE_TTL_MS;
}
