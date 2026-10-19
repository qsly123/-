import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { publishChatMessage } from "@/modules/chat/services/chat-presence";
import type { ChatRealtimeMessage } from "@/modules/chat/services/chat-presence";
import {
  getPlayerCosmeticMapByIds,
  getPlayerCosmeticProfileById,
} from "@/modules/character/services/player-cosmetic-profile";

export const CHAT_CONTENT_MAX_LENGTH = 200;
export const WORLD_CHAT_HISTORY_LIMIT = 100;
export const SYSTEM_CHAT_HISTORY_LIMIT = 100;
const CHAT_HISTORY_TRIM_THROTTLE_MS = 15 * 1000;

export type ChatMessageType = "player" | "system";
type ChatTrimGlobal = typeof globalThis & {
  __chatTrimTasksByType?: Map<ChatMessageType, Promise<void>>;
  __chatTrimLastRunAtByType?: Map<ChatMessageType, number>;
};

function normalizeMessageType(messageType: string): ChatMessageType {
  return messageType === "system" ? "system" : "player";
}

function normalizeContent(content: string) {
  return content.trim().slice(0, CHAT_CONTENT_MAX_LENGTH);
}

function resolveChatHistoryLimit(messageType: ChatMessageType) {
  return messageType === "system" ? SYSTEM_CHAT_HISTORY_LIMIT : WORLD_CHAT_HISTORY_LIMIT;
}

interface CreateChatMessageInput {
  messageType: ChatMessageType;
  playerId?: string | null;
  senderName: string;
  content: string;
}

interface PublishAnnouncementOptions {
  senderName?: string;
}

async function trimChatMessagesByType(messageType: ChatMessageType) {
  const limit = resolveChatHistoryLimit(messageType);
  const allMessageIds = await db.select({
    id: chatMessages.id,
  }).from(chatMessages)
    .where(eq(chatMessages.messageType, messageType))
    .orderBy(desc(chatMessages.id))
    .offset(limit)
    .all();

  const staleMessageIds = allMessageIds
    .map((row) => row.id);

  if (staleMessageIds.length > 0) {
    await db.delete(chatMessages).where(inArray(chatMessages.id, staleMessageIds)).run();
  }
}

function getChatTrimTasksByType() {
  const globalStore = globalThis as ChatTrimGlobal;
  if (!globalStore.__chatTrimTasksByType) {
    globalStore.__chatTrimTasksByType = new Map<ChatMessageType, Promise<void>>();
  }
  return globalStore.__chatTrimTasksByType;
}

function getChatTrimLastRunAtByType() {
  const globalStore = globalThis as ChatTrimGlobal;
  if (!globalStore.__chatTrimLastRunAtByType) {
    globalStore.__chatTrimLastRunAtByType = new Map<ChatMessageType, number>();
  }
  return globalStore.__chatTrimLastRunAtByType;
}

function scheduleChatHistoryTrim(messageType: ChatMessageType) {
  const trimTasks = getChatTrimTasksByType();
  const activeTask = trimTasks.get(messageType);
  if (activeTask) {
    return activeTask;
  }

  const trimLastRunAt = getChatTrimLastRunAtByType();
  const nowMs = Date.now();
  const lastRunAt = trimLastRunAt.get(messageType) || 0;
  if (nowMs - lastRunAt < CHAT_HISTORY_TRIM_THROTTLE_MS) {
    return Promise.resolve();
  }

  trimLastRunAt.set(messageType, nowMs);
  const task = trimChatMessagesByType(messageType)
    .catch((error) => {
      console.error("Chat history trim error:", { messageType, error });
    })
    .finally(() => {
      if (trimTasks.get(messageType) === task) {
        trimTasks.delete(messageType);
      }
    });
  trimTasks.set(messageType, task);
  return task;
}

export async function listChatMessagesByType(messageType: ChatMessageType): Promise<ChatRealtimeMessage[]> {
  const rows = await db.select({
    id: chatMessages.id,
    messageType: chatMessages.messageType,
    playerId: chatMessages.playerId,
    senderName: chatMessages.senderName,
    content: chatMessages.content,
    createdAt: chatMessages.createdAt,
  }).from(chatMessages)
    .where(eq(chatMessages.messageType, messageType))
    .orderBy(desc(chatMessages.id))
    .limit(resolveChatHistoryLimit(messageType))
    .all();

  const messages = rows
    .slice()
    .reverse()
    .map((row) => ({
      ...row,
      messageType: normalizeMessageType(row.messageType),
    }));

  const playerIds = messages
    .map((item) => item.playerId || "")
    .filter(Boolean);
  const cosmeticMap = await getPlayerCosmeticMapByIds(playerIds);

  return messages.map((item) => {
    const cosmetic = item.playerId ? cosmeticMap.get(item.playerId) : undefined;
    return {
      ...item,
      avatarId: cosmetic?.avatarId || null,
      avatarImageUrl: cosmetic?.avatarImageUrl || null,
      avatarFrameId: cosmetic?.avatarFrameId || null,
      avatarFrameImageUrl: cosmetic?.avatarFrameImageUrl || null,
    };
  });
}

export async function createChatMessage(input: CreateChatMessageInput): Promise<ChatRealtimeMessage | null> {
  const senderName = (input.senderName || "").trim();
  const content = normalizeContent(input.content || "");
  if (!senderName || !content) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const inserted = await db.insert(chatMessages).values({
    messageType: input.messageType,
    playerId: input.playerId ?? null,
    senderName,
    content,
    createdAt,
  }).returning({
    id: chatMessages.id,
    messageType: chatMessages.messageType,
    playerId: chatMessages.playerId,
    senderName: chatMessages.senderName,
    content: chatMessages.content,
    createdAt: chatMessages.createdAt,
  }).get();

  if (!inserted) {
    return null;
  }

  void scheduleChatHistoryTrim(input.messageType);

  const cosmetics = inserted.playerId
    ? await getPlayerCosmeticProfileById(inserted.playerId)
    : {
      avatarId: null,
      avatarImageUrl: null,
      avatarFrameId: null,
      avatarFrameImageUrl: null,
    };

  const message: ChatRealtimeMessage = {
    id: inserted.id,
    messageType: normalizeMessageType(inserted.messageType),
    playerId: inserted.playerId,
    senderName: inserted.senderName,
    avatarId: cosmetics.avatarId,
    avatarImageUrl: cosmetics.avatarImageUrl,
    avatarFrameId: cosmetics.avatarFrameId,
    avatarFrameImageUrl: cosmetics.avatarFrameImageUrl,
    content: inserted.content,
    createdAt: inserted.createdAt,
  };

  publishChatMessage(message);
  return message;
}

async function publishChannelAnnouncement(
  messageType: ChatMessageType,
  content: string,
  options?: PublishAnnouncementOptions,
) {
  return createChatMessage({
    messageType,
    playerId: null,
    senderName: options?.senderName?.trim() || (messageType === "system" ? "系统" : "天道"),
    content,
  });
}

export async function publishWorldAnnouncement(content: string, options?: PublishAnnouncementOptions) {
  return publishChannelAnnouncement("player", content, options);
}

export async function publishSystemAnnouncement(content: string, options?: PublishAnnouncementOptions) {
  return publishChannelAnnouncement("system", content, options);
}

export async function publishTiandaoDualChannelAnnouncement(content: string) {
  return Promise.all([
    publishWorldAnnouncement(content, { senderName: "天道" }),
    publishSystemAnnouncement(content, { senderName: "天道" }),
  ]);
}
