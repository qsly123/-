import { ensureGlobalMap } from "@/modules/shared/services/global-store";

export type SocialRealtimeEvent =
  | { type: "connected" }
  | {
    type: "dm_message";
    data: {
      conversationId: string;
      messageId: number;
      senderPlayerId: string;
      senderName: string;
      targetPlayerId: string;
      content: string;
      createdAt: string;
    };
  }
  | {
    type: "friend_request";
    data: {
      friendshipId: number;
      requesterId: string;
      requesterName: string;
      createdAt: string;
    };
  }
  | {
    type: "friend_update";
    data: {
      friendshipId: number;
      status: string;
      updatedAt: string;
    };
  }
  | {
    type: "intimacy_request";
    data: {
      relationId: number;
      requesterId: string;
      requesterName: string;
      relationType: string;
      createdAt: string;
    };
  }
  | {
    type: "intimacy_update";
    data: {
      relationId: number;
      status: string;
      relationType: string;
      updatedAt: string;
    };
  }
  | {
    type: "market_trade_sold";
    data: {
      tradeRecordId: number;
      itemName: string;
      quantity: number;
      sellerName: string;
      createdAt: string;
    };
  }
  | {
    type: "notification";
    data: {
      kind: "pvp_defeat" | "system";
      title: string;
      content: string;
      createdAt: string;
    };
  };

type SocialSubscriber = (event: SocialRealtimeEvent) => void;

type SocialPresenceGlobal = typeof globalThis & {
  __socialPresenceSubscribers?: Map<string, Set<SocialSubscriber>>;
  __socialPresenceReplay?: Map<string, SocialRealtimeEvent[]>;
};

const MAX_SOCIAL_REPLAY_EVENTS = 80;

function getSubscribersMap() {
  const globalStore = globalThis as SocialPresenceGlobal;
  globalStore.__socialPresenceSubscribers = ensureGlobalMap<string, Set<SocialSubscriber>>(
    globalStore as Record<string, unknown>,
    "__socialPresenceSubscribers",
  );
  return globalStore.__socialPresenceSubscribers;
}

function getReplayMap() {
  const globalStore = globalThis as SocialPresenceGlobal;
  globalStore.__socialPresenceReplay = ensureGlobalMap<string, SocialRealtimeEvent[]>(
    globalStore as Record<string, unknown>,
    "__socialPresenceReplay",
  );
  return globalStore.__socialPresenceReplay;
}

export function subscribeSocialPresence(playerId: string, subscriber: SocialSubscriber) {
  const subscribersMap = getSubscribersMap();
  const playerSubscribers = subscribersMap.get(playerId) || new Set<SocialSubscriber>();
  playerSubscribers.add(subscriber);
  subscribersMap.set(playerId, playerSubscribers);

  return () => {
    const current = subscribersMap.get(playerId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) {
      subscribersMap.delete(playerId);
    }
  };
}

export function publishSocialEvent(targetPlayerIds: string[], event: SocialRealtimeEvent) {
  if (!targetPlayerIds.length) return;

  const subscribersMap = getSubscribersMap();
  const replayMap = getReplayMap();
  const dedupIds = [...new Set(targetPlayerIds.map((id) => id.trim()).filter(Boolean))];

  for (const playerId of dedupIds) {
    const replayEvents = [...(replayMap.get(playerId) || []), event];
    replayMap.set(playerId, replayEvents.slice(-MAX_SOCIAL_REPLAY_EVENTS));

    const subscribers = subscribersMap.get(playerId);
    if (!subscribers || subscribers.size === 0) {
      continue;
    }

    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        console.error("Social presence subscriber error:", error);
      }
    }
  }
}

export function getSocialPresenceEvents(playerId: string) {
  return [...(getReplayMap().get(playerId) || [])];
}
