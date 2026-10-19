import {
  ensureGlobalArray,
  ensureGlobalSet,
} from "@/modules/shared/services/global-store";

export interface ChatRealtimeMessage {
  id: number;
  messageType: "player" | "system";
  playerId: string | null;
  senderName: string;
  avatarId?: string | null;
  avatarImageUrl?: string | null;
  avatarFrameId?: string | null;
  avatarFrameImageUrl?: string | null;
  content: string;
  createdAt: string;
}

export interface ChatPresenceMessage {
  type: "chat_message";
  data: ChatRealtimeMessage;
}

type ChatPresenceSubscriber = (message: ChatPresenceMessage) => void;

type ChatPresenceGlobal = typeof globalThis & {
  __chatPresenceSubscribers?: Set<ChatPresenceSubscriber>;
  __chatPresencePlayerEvents?: ChatPresenceMessage[];
  __chatPresenceSystemEvents?: ChatPresenceMessage[];
};

const MAX_CHAT_PRESENCE_EVENTS_PER_TYPE = 80;

function getSubscribers() {
  const globalStore = globalThis as ChatPresenceGlobal;
  globalStore.__chatPresenceSubscribers = ensureGlobalSet<ChatPresenceSubscriber>(
    globalStore as Record<string, unknown>,
    "__chatPresenceSubscribers",
  );
  return globalStore.__chatPresenceSubscribers;
}

function getEventLog(messageType: ChatRealtimeMessage["messageType"]) {
  const globalStore = globalThis as ChatPresenceGlobal;
  const key = messageType === "system"
    ? "__chatPresenceSystemEvents"
    : "__chatPresencePlayerEvents";
  globalStore[key] = ensureGlobalArray<ChatPresenceMessage>(
    globalStore as Record<string, unknown>,
    key,
  );
  return globalStore[key] || [];
}

export function subscribeChatPresence(subscriber: ChatPresenceSubscriber) {
  const subscribers = getSubscribers();
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function publishChatMessage(data: ChatRealtimeMessage) {
  const message: ChatPresenceMessage = { type: "chat_message", data };
  const eventLog = getEventLog(data.messageType);
  eventLog.push(message);
  if (eventLog.length > MAX_CHAT_PRESENCE_EVENTS_PER_TYPE) {
    eventLog.splice(0, eventLog.length - MAX_CHAT_PRESENCE_EVENTS_PER_TYPE);
  }
  const subscribers = getSubscribers();
  for (const subscriber of subscribers) {
    try {
      subscriber(message);
    } catch (e) {
      console.error("Chat presence subscriber error:", e);
    }
  }
}

export function getChatPresenceEvents() {
  return [
    ...getEventLog("player"),
    ...getEventLog("system"),
  ].sort((left, right) => left.data.id - right.data.id);
}
