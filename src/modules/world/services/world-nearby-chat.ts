import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, worldLocalMessages, worldNpcProfiles, worldNpcRuntime } from "@/db/schema";
import { getPlayerCosmeticMapByIds, getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { CHAT_CONTENT_MAX_LENGTH } from "@/modules/chat/services/chat-service";
import { publishNearbyChatMessage } from "@/modules/chat/services/nearby-chat-presence";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { OPEN_WORLD_LOCAL_CHAT_LIMIT } from "@/modules/world/services/world-config";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import { ensureOpenWorldSchema, getOpenWorldSchemaStatus } from "@/modules/world/services/world-schema";

export type NearbyChatSenderType = "player" | "npc" | "system";
export type NearbyChatScope = "map" | "district";
export type NearbyChatStorageMode = "database" | "memory";

export interface NearbyChatMessage {
  id: number;
  mapId: string;
  districtName?: string | null;
  senderType: NearbyChatSenderType;
  playerId: string | null;
  npcId?: string | null;
  senderName: string;
  avatarId?: string | null;
  avatarImageUrl?: string | null;
  avatarFrameId?: string | null;
  avatarFrameImageUrl?: string | null;
  content: string;
  createdAt: string;
  /** 幂等键。房间广播回声与 SSE 持久化回灌靠它对齐，保证客户端只渲染一次。 */
  dedupeKey?: string | null;
}

interface CreateNearbyChatMessageInput {
  mapId: string;
  senderType: NearbyChatSenderType;
  playerId?: string | null;
  npcId?: string | null;
  districtName?: string | null;
  senderName: string;
  content: string;
  /** 发送方生成的幂等键；重复提交同一键不会新增消息。 */
  dedupeKey?: string | null;
}

type ListNearbyChatMessageOptions = {
  scope?: NearbyChatScope;
  districtName?: string | null;
};

type NearbyChatFallbackGlobalStore = typeof globalThis & {
  __openWorldNearbyFallbackMessagesByMap?: Map<string, NearbyChatMessage[]>;
  __openWorldNearbyFallbackAutoIncrementId?: number;
};

function normalizeMapId(mapId: string) {
  return mapId.trim();
}

function normalizeContent(content: string) {
  return content.trim().slice(0, CHAT_CONTENT_MAX_LENGTH);
}

function normalizeNearbyChatScope(scope: unknown): NearbyChatScope {
  return scope === "district" ? "district" : "map";
}

const NEARBY_CHAT_DEDUPE_KEY_MAX_LENGTH = 128;

/**
 * 归一化幂等键。
 *
 * 只允许 `[\w.:-]`，避免把任意用户输入写进唯一索引。
 * 返回 null 表示本次发送不参与幂等（例如 NPC / 天道系统消息）。
 */
function normalizeDedupeKey(raw: unknown): string | null {
  const normalized = String(raw || "").trim().slice(0, NEARBY_CHAT_DEDUPE_KEY_MAX_LENGTH);
  if (!normalized || !/^[\w.:-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

/** 客户端 / 房间回声侧统一使用的幂等键构造函数。 */
export function createNearbyChatDedupeKey(playerId: string, clientMessageId: string) {
  const normalizedPlayerId = normalizeDedupeKey(playerId);
  const normalizedClientMessageId = normalizeDedupeKey(clientMessageId);
  if (!normalizedPlayerId || !normalizedClientMessageId) {
    return null;
  }
  return `${normalizedPlayerId}:${normalizedClientMessageId}`;
}

function getFallbackMessagesByMap() {
  const globalStore = globalThis as NearbyChatFallbackGlobalStore;
  globalStore.__openWorldNearbyFallbackMessagesByMap = ensureGlobalMap<string, NearbyChatMessage[]>(
    globalStore as Record<string, unknown>,
    "__openWorldNearbyFallbackMessagesByMap",
  );
  return globalStore.__openWorldNearbyFallbackMessagesByMap;
}

function nextFallbackMessageId() {
  const globalStore = globalThis as NearbyChatFallbackGlobalStore;
  const nextId = (globalStore.__openWorldNearbyFallbackAutoIncrementId || 0) + 1;
  globalStore.__openWorldNearbyFallbackAutoIncrementId = nextId;
  return nextId;
}

async function buildDistrictNameFromInput(input: CreateNearbyChatMessageInput) {
  const explicitDistrictName = String(input.districtName || "").trim();
  if (explicitDistrictName) {
    return explicitDistrictName;
  }

  if (input.playerId) {
    const playerRow = await db.select({
      positionX: players.positionX,
      positionY: players.positionY,
    }).from(players).where(eq(players.id, input.playerId)).get();
    return playerRow
      ? resolveOpenWorldDistrictName({
        mapId: input.mapId,
        positionX: playerRow.positionX,
        positionY: playerRow.positionY,
      })
      : null;
  }

  if (input.npcId) {
    const npcRuntimeRow = await db.select({
      positionX: worldNpcRuntime.positionX,
      positionY: worldNpcRuntime.positionY,
    }).from(worldNpcRuntime).where(eq(worldNpcRuntime.npcId, input.npcId)).get();
    return npcRuntimeRow
      ? resolveOpenWorldDistrictName({
        mapId: input.mapId,
        positionX: npcRuntimeRow.positionX,
        positionY: npcRuntimeRow.positionY,
      })
      : null;
  }

  return null;
}

function filterNearbyChatMessagesByScope(messages: NearbyChatMessage[], options?: ListNearbyChatMessageOptions) {
  const scope = normalizeNearbyChatScope(options?.scope);
  if (scope !== "district") {
    return messages;
  }
  const districtName = String(options?.districtName || "").trim();
  if (!districtName) {
    return [];
  }
  return messages.filter((message) => message.districtName === districtName);
}

async function listFallbackNearbyChatMessages(mapId: string, options?: ListNearbyChatMessageOptions) {
  const normalizedMapId = normalizeMapId(mapId);
  if (!normalizedMapId) {
    return [];
  }
  return filterNearbyChatMessagesByScope(
    (getFallbackMessagesByMap().get(normalizedMapId) || []).map((item) => ({ ...item })),
    options,
  );
}

async function createFallbackNearbyChatMessage(input: CreateNearbyChatMessageInput) {
  const mapId = normalizeMapId(input.mapId || "");
  const senderName = (input.senderName || "").trim();
  const content = normalizeContent(input.content || "");
  if (!mapId || !senderName || !content) {
    return null;
  }

  const playerCosmetic = input.playerId
    ? await getPlayerCosmeticProfileById(input.playerId)
    : {
      avatarId: null,
      avatarImageUrl: null,
      avatarFrameId: null,
      avatarFrameImageUrl: null,
    };
  const dedupeKey = normalizeDedupeKey(input.dedupeKey);
  const existingMessages = getFallbackMessagesByMap().get(mapId) || [];
  if (dedupeKey) {
    const duplicated = existingMessages.find((item) => item.dedupeKey === dedupeKey);
    if (duplicated) {
      return { ...duplicated };
    }
  }

  const districtName = await buildDistrictNameFromInput({
    ...input,
    mapId,
    senderName,
    content,
  });

  const message: NearbyChatMessage = {
    id: nextFallbackMessageId(),
    mapId,
    districtName,
    senderType: input.senderType,
    playerId: input.playerId ?? null,
    npcId: input.npcId ?? null,
    senderName,
    avatarId: playerCosmetic.avatarId,
    avatarImageUrl: playerCosmetic.avatarImageUrl,
    avatarFrameId: playerCosmetic.avatarFrameId,
    avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
    content,
    createdAt: new Date().toISOString(),
    dedupeKey,
  };

  getFallbackMessagesByMap().set(mapId, [...existingMessages, message].slice(-OPEN_WORLD_LOCAL_CHAT_LIMIT));
  publishNearbyChatMessage(message);
  return message;
}

async function trimWorldLocalMessages(mapId: string) {
  if (!(await ensureOpenWorldSchema())) {
    return;
  }
  const rows = await db.select({ id: worldLocalMessages.id })
    .from(worldLocalMessages)
    .where(eq(worldLocalMessages.mapId, mapId))
    .orderBy(desc(worldLocalMessages.id))
    .offset(OPEN_WORLD_LOCAL_CHAT_LIMIT)
    .all();

  const staleIds = rows.map((row) => row.id);
  if (staleIds.length <= 0) {
    return;
  }

  await db.delete(worldLocalMessages).where(inArray(worldLocalMessages.id, staleIds)).run();
}

export async function listWorldNearbyChatMessages(
  mapId: string,
  options?: ListNearbyChatMessageOptions,
): Promise<NearbyChatMessage[]> {
  if (!(await ensureOpenWorldSchema())) {
    return listFallbackNearbyChatMessages(mapId, options);
  }
  const normalizedMapId = normalizeMapId(mapId);
  if (!normalizedMapId) {
    return [];
  }

  const rows = await db.select().from(worldLocalMessages)
    .where(eq(worldLocalMessages.mapId, normalizedMapId))
    .orderBy(desc(worldLocalMessages.id))
    .limit(OPEN_WORLD_LOCAL_CHAT_LIMIT)
    .all();
  const orderedRows = [...rows].reverse();

  const playerIds = Array.from(new Set(orderedRows
    .map((row) => row.speakerPlayerId)
    .filter((value): value is string => Boolean(value))));
  const npcIds = Array.from(new Set(orderedRows
    .map((row) => row.speakerNpcId)
    .filter((value): value is string => Boolean(value))));
  const needsPlayerDistrictLookup = orderedRows.some((row) => !row.districtName && row.speakerPlayerId);
  const needsNpcDistrictLookup = orderedRows.some((row) => !row.districtName && row.speakerNpcId);

  const [playerCosmeticMap, playerRows, npcRows, npcRuntimeRows] = await Promise.all([
    playerIds.length > 0
      ? getPlayerCosmeticMapByIds(playerIds)
      : Promise.resolve(new Map()),
    playerIds.length > 0
      && needsPlayerDistrictLookup
      ? db.select({
        id: players.id,
        positionX: players.positionX,
        positionY: players.positionY,
      }).from(players).where(inArray(players.id, playerIds)).all()
      : Promise.resolve([]),
    npcIds.length > 0
      ? db.select({
        id: worldNpcProfiles.id,
        avatarImageUrl: worldNpcProfiles.avatarImageUrl,
      }).from(worldNpcProfiles).where(inArray(worldNpcProfiles.id, npcIds)).all()
      : Promise.resolve([]),
    npcIds.length > 0
      && needsNpcDistrictLookup
      ? db.select({
        npcId: worldNpcRuntime.npcId,
        positionX: worldNpcRuntime.positionX,
        positionY: worldNpcRuntime.positionY,
      }).from(worldNpcRuntime).where(inArray(worldNpcRuntime.npcId, npcIds)).all()
      : Promise.resolve([]),
  ]);
  const npcAvatarMap = new Map(npcRows.map((row) => [row.id, row.avatarImageUrl]));
  const playerDistrictMap = new Map(playerRows.map((row) => [
    row.id,
    resolveOpenWorldDistrictName({
      mapId: normalizedMapId,
      positionX: row.positionX,
      positionY: row.positionY,
    }),
  ]));
  const npcDistrictMap = new Map(npcRuntimeRows.map((row) => [
    row.npcId,
    resolveOpenWorldDistrictName({
      mapId: normalizedMapId,
      positionX: row.positionX,
      positionY: row.positionY,
    }),
  ]));

  return filterNearbyChatMessagesByScope(orderedRows.map((row) => {
    const playerCosmetic = row.speakerPlayerId ? playerCosmeticMap.get(row.speakerPlayerId) : null;
    return {
      id: row.id,
      mapId: row.mapId,
      districtName: row.districtName
        || (row.speakerPlayerId ? (playerDistrictMap.get(row.speakerPlayerId) || null) : null)
        || (row.speakerNpcId ? (npcDistrictMap.get(row.speakerNpcId) || null) : null),
      senderType: (row.speakerType || "player") as NearbyChatSenderType,
      playerId: row.speakerPlayerId,
      npcId: row.speakerNpcId,
      senderName: row.speakerName,
      avatarId: playerCosmetic?.avatarId || null,
      avatarImageUrl: row.speakerNpcId
        ? (npcAvatarMap.get(row.speakerNpcId) || null)
        : (playerCosmetic?.avatarImageUrl || null),
      avatarFrameId: playerCosmetic?.avatarFrameId || null,
      avatarFrameImageUrl: playerCosmetic?.avatarFrameImageUrl || null,
      content: row.content,
      createdAt: row.createdAt,
      dedupeKey: row.dedupeKey || null,
    } satisfies NearbyChatMessage;
  }), options);
}

export async function createWorldNearbyChatMessage(input: CreateNearbyChatMessageInput): Promise<NearbyChatMessage | null> {
  if (!(await ensureOpenWorldSchema())) {
    return createFallbackNearbyChatMessage(input);
  }
  const mapId = normalizeMapId(input.mapId || "");
  const senderName = (input.senderName || "").trim();
  const content = normalizeContent(input.content || "");
  if (!mapId || !senderName || !content) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const dedupeKey = normalizeDedupeKey(input.dedupeKey);
  const districtName = await buildDistrictNameFromInput({
    ...input,
    mapId,
    senderName,
    content,
  });

  const inserted = dedupeKey
    ? await db.insert(worldLocalMessages).values({
      mapId,
      districtName,
      speakerType: input.senderType,
      speakerPlayerId: input.playerId ?? null,
      speakerNpcId: input.npcId ?? null,
      speakerName: senderName,
      content,
      createdAt,
      dedupeKey,
    }).onConflictDoNothing({
      target: [worldLocalMessages.mapId, worldLocalMessages.dedupeKey],
    }).returning({
      id: worldLocalMessages.id,
    }).get()
    : await db.insert(worldLocalMessages).values({
      mapId,
      districtName,
      speakerType: input.senderType,
      speakerPlayerId: input.playerId ?? null,
      speakerNpcId: input.npcId ?? null,
      speakerName: senderName,
      content,
      createdAt,
    }).returning({
      id: worldLocalMessages.id,
    }).get();

  // 幂等命中：同一 dedupeKey 已入库，直接回读原消息，不新增、不重复广播。
  if (dedupeKey && !inserted?.id) {
    const existing = await db.select().from(worldLocalMessages)
      .where(and(
        eq(worldLocalMessages.mapId, mapId),
        eq(worldLocalMessages.dedupeKey, dedupeKey),
      ))
      .limit(1)
      .get();
    if (existing) {
      return {
        id: existing.id,
        mapId: existing.mapId,
        districtName: existing.districtName,
        senderType: (existing.speakerType || "player") as NearbyChatSenderType,
        playerId: existing.speakerPlayerId,
        npcId: existing.speakerNpcId,
        senderName: existing.speakerName,
        avatarId: null,
        avatarImageUrl: null,
        avatarFrameId: null,
        avatarFrameImageUrl: null,
        content: existing.content,
        createdAt: existing.createdAt,
        dedupeKey: existing.dedupeKey || null,
      } satisfies NearbyChatMessage;
    }
  }

  await trimWorldLocalMessages(mapId);

  const playerCosmetic = input.playerId
    ? await getPlayerCosmeticProfileById(input.playerId)
    : {
      avatarId: null,
      avatarImageUrl: null,
      avatarFrameId: null,
      avatarFrameImageUrl: null,
    };
  const npcAvatar = input.npcId
    ? await db.select({
      avatarImageUrl: worldNpcProfiles.avatarImageUrl,
    }).from(worldNpcProfiles).where(eq(worldNpcProfiles.id, input.npcId)).get()
    : null;

  const message: NearbyChatMessage = {
    id: inserted?.id || 0,
    mapId,
    districtName,
    senderType: input.senderType,
    playerId: input.playerId ?? null,
    npcId: input.npcId ?? null,
    senderName,
    avatarId: playerCosmetic.avatarId,
    avatarImageUrl: input.npcId ? (npcAvatar?.avatarImageUrl || null) : playerCosmetic.avatarImageUrl,
    avatarFrameId: playerCosmetic.avatarFrameId,
    avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
    content,
    createdAt,
    dedupeKey,
  };

  publishNearbyChatMessage(message);
  return message;
}

export async function createWorldNpcNearbyChatMessage(params: {
  mapId: string;
  npcId: string;
  senderName: string;
  content: string;
  districtName?: string | null;
}) {
  return createWorldNearbyChatMessage({
    mapId: params.mapId,
    npcId: params.npcId,
    districtName: params.districtName,
    senderType: "npc",
    senderName: params.senderName,
    content: params.content,
  });
}

export async function createTiandaoNearbyChatMessage(params: {
  mapId: string;
  content: string;
  districtName?: string | null;
}) {
  return createWorldNearbyChatMessage({
    mapId: params.mapId,
    districtName: params.districtName,
    senderType: "system",
    senderName: "天道",
    content: params.content,
  });
}

export function getWorldNearbyChatStorageMode(): NearbyChatStorageMode {
  return getOpenWorldSchemaStatus().ready ? "database" : "memory";
}
