import {
  ensureGlobalMap,
} from "@/modules/shared/services/global-store";
import type { NearbyChatMessage } from "@/modules/world/services/world-nearby-chat";

export interface NearbyChatPresenceMessage {
  type: "nearby_message";
  data: NearbyChatMessage;
}

type NearbyChatPresenceSubscriber = (message: NearbyChatPresenceMessage) => void;

type NearbyChatPresenceGlobal = typeof globalThis & {
  __nearbyChatPresenceSubscribersByMap?: Map<string, Set<NearbyChatPresenceSubscriber>>;
};

function getSubscribersByMap() {
  const globalStore = globalThis as NearbyChatPresenceGlobal;
  globalStore.__nearbyChatPresenceSubscribersByMap = ensureGlobalMap<string, Set<NearbyChatPresenceSubscriber>>(
    globalStore as Record<string, unknown>,
    "__nearbyChatPresenceSubscribersByMap",
  );
  return globalStore.__nearbyChatPresenceSubscribersByMap;
}

function getMapSubscribers(mapId: string) {
  const subscribersByMap = getSubscribersByMap();
  const current = subscribersByMap.get(mapId);
  if (current) {
    return current;
  }

  const next = new Set<NearbyChatPresenceSubscriber>();
  subscribersByMap.set(mapId, next);
  return next;
}

export function subscribeNearbyChatPresence(mapId: string, subscriber: NearbyChatPresenceSubscriber) {
  const subscribers = getMapSubscribers(mapId);
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      getSubscribersByMap().delete(mapId);
    }
  };
}

export function publishNearbyChatMessage(data: NearbyChatMessage) {
  const message: NearbyChatPresenceMessage = {
    type: "nearby_message",
    data,
  };

  const subscribers = getMapSubscribers(data.mapId);
  for (const subscriber of subscribers) {
    try {
      subscriber(message);
    } catch (error) {
      console.error("Nearby chat presence subscriber error:", error);
    }
  }
}
