import { ensureGlobalMap } from "@/modules/shared/services/global-store";

export interface PendingMapEvent {
  eventId: string;
  sourceType: "encounter" | "opportunity";
  sourceRef?: string | null;
  createdAt: number;
}

type PendingMapEventStore = Map<string, PendingMapEvent>;

type PendingMapEventGlobal = typeof globalThis & {
  __pendingMapEventStore?: PendingMapEventStore;
};

const PENDING_EVENT_EXPIRE_MS = 5 * 60 * 1000;

function getStore() {
  const globalStore = globalThis as PendingMapEventGlobal;
  globalStore.__pendingMapEventStore = ensureGlobalMap<string, PendingMapEvent>(
    globalStore as Record<string, unknown>,
    "__pendingMapEventStore",
  );
  return globalStore.__pendingMapEventStore;
}

export function setPendingMapEvent(
  playerId: string,
  eventId: string,
  options?: { sourceType?: "encounter" | "opportunity"; sourceRef?: string | null },
) {
  getStore().set(playerId, {
    eventId,
    sourceType: options?.sourceType || "encounter",
    sourceRef: options?.sourceRef || null,
    createdAt: Date.now(),
  });
}

export function clearPendingMapEvent(playerId: string) {
  getStore().delete(playerId);
}

export function getPendingMapEvent(playerId: string, eventId: string) {
  const store = getStore();
  const pending = store.get(playerId);
  if (!pending) return null;

  if (Date.now() - pending.createdAt > PENDING_EVENT_EXPIRE_MS) {
    store.delete(playerId);
    return null;
  }

  if (pending.eventId !== eventId) {
    return null;
  }

  return pending;
}

export function consumePendingMapEvent(playerId: string, eventId: string) {
  const pending = getPendingMapEvent(playerId, eventId);
  if (pending) {
    getStore().delete(playerId);
  }
  return pending;
}
