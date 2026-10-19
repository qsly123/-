import { pushStateRefreshForPlayer } from "../state-refresh";

/**
 * 帧名。客户端镜像定义见
 * `src/modules/social/realtime/nearby-chat-echo.ts`，两端字段名必须一致。
 */
export const NEARBY_CHAT_ECHO_MESSAGE_TYPE = "nearby_chat_echo";

/** 客户端 `nearbyMessage` 输入里允许携带的幂等字段。 */
export interface NearbyChatEchoPayloadInput {
  messageId?: unknown;
  dedupeKey?: unknown;
}

/** 房间回声帧。只用于实时提示与幂等对齐，不代表持久化结果。 */
export interface NearbyChatEchoFrame {
  type: "nearby_chat_echo";
  roomId: string;
  serverTick: number;
  sentAt: number;
  mapId: string;
  shardId: string;
  /** 房间内唯一回声 id，仅链路追踪用，不参与持久化。 */
  roomMessageId: string;
  /** 持久化消息 id；null 表示这条回声没有对应持久化消息。 */
  messageId: number | null;
  dedupeKey: string | null;
  senderPlayerId: string;
  senderName: string;
  content: string;
}

/**
 * 附近频道「房间回声帧」服务端构造器。
 *
 * ## 边界定义（P2-A）
 *
 * 附近频道有两条链路，必须严格分工，否则同一条消息会在 H5 上刷两次：
 *
 * 1. **持久化唯一入口**：核心 API `POST /api/game/chat/nearby`
 *    → 写 `world_local_messages`（带 `id` 与 `dedupe_key`）
 *    → 由现役 SSE `/api/game/chat/nearby/sse` 回灌到所有订阅端。
 * 2. **实时广播（本文件）**：`SocialRoom` 收到 `nearbyMessage` 输入后
 *    **只做同图广播回声，不写库、不生成持久化 id、不伪造持久化结果**。
 *
 * 回声帧必须携带发送方在 POST 成功后回传的 `messageId` / `dedupeKey`，
 * 客户端用它与 SSE 回灌的持久化消息对齐：同一键只渲染一次。
 *
 * 没有 `messageId` 也没有 `dedupeKey` 的回声属于「纯房间侧消息」，
 * 客户端不得渲染成历史消息，避免重启 / 重连后消息凭空消失造成的假重复。
 */

/** 附近频道进度刷新帧统一使用 activity scope。 */
const NEARBY_ACTIVITY_PROGRESS_SCOPES = ["activity"] as const;

/** 房间内回声自增序号，仅用于同房间内区分回声，重启后归零不影响正确性。 */
const echoCountersBySession = new Map<string, number>();

function nextEchoSequence(sessionId: string) {
  const next = (echoCountersBySession.get(sessionId) || 0) + 1;
  echoCountersBySession.set(sessionId, next);
  return next;
}

export function releaseNearbyChatEchoSequence(sessionId: string) {
  echoCountersBySession.delete(sessionId);
}

function normalizeDedupeKey(raw: unknown): string | null {
  const normalized = String(raw || "").trim().slice(0, 128);
  if (!normalized || !/^[\w.:-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeMessageId(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * 计算消息渲染去重键（与客户端镜像实现必须一致）。
 *
 * 优先级：`dedupeKey` > `db:<messageId>` > `room:<roomMessageId>`。
 */
export function resolveNearbyChatRenderKey(params: {
  dedupeKey?: string | null;
  messageId?: number | null;
  roomMessageId?: string | null;
}): string | null {
  const dedupeKey = String(params.dedupeKey || "").trim();
  if (dedupeKey) {
    return dedupeKey.slice(0, 160);
  }

  const messageId = Number(params.messageId);
  if (Number.isSafeInteger(messageId) && messageId > 0) {
    return `db:${messageId}`;
  }

  const roomMessageId = String(params.roomMessageId || "").trim();
  if (roomMessageId) {
    return `room:${roomMessageId.slice(0, 160)}`;
  }

  return null;
}

/** 从客户端 `nearbyMessage` 输入里解析幂等键，供广播回声携带。 */
export function readNearbyChatEchoDedupeKeys(payload: unknown): {
  messageId: number | null;
  dedupeKey: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { messageId: null, dedupeKey: null };
  }
  const raw = payload as NearbyChatEchoPayloadInput;
  return {
    messageId: normalizeMessageId(raw.messageId),
    dedupeKey: normalizeDedupeKey(raw.dedupeKey),
  };
}

/**
 * 附近频道进度刷新帧的 reason。
 *
 * 客户端镜像见 `src/modules/social/realtime/nearby-chat-echo.ts` 的
 * `NEARBY_CHAT_PROGRESS_REASON`，两端必须一致。
 */
export const NEARBY_CHAT_PROGRESS_REASON = {
  message: "nearby_message",
  memberChanged: "nearby_member_changed",
  replay: "nearby_replay",
} as const;

/** 房间回声广播所需的最小房间能力，避免把房间逻辑搬进本文件。 */
export interface NearbyChatEchoRoomAdapter {
  roomId: string;
  getServerTick: () => number;
  clients: Iterable<{
    sessionId: string;
    send: (type: string, message: unknown) => void;
  }>;
  getContext: (sessionId: string) => { mapId: string; shardId: string } | undefined;
}

/**
 * 广播附近频道回声帧。
 *
 * 只发给同图同分片的连接，**不写库**。每条消息只产生一帧回声，
 * 客户端靠 `messageId` / `dedupeKey` 与 SSE 持久化回灌对齐去重。
 */
export function broadcastNearbyChatEcho(
  adapter: NearbyChatEchoRoomAdapter,
  params: {
    sessionId: string;
    mapId: string;
    shardId: string;
    senderPlayerId: string;
    senderName: string;
    content: string;
    messageId: number | null;
    dedupeKey: string | null;
  },
): NearbyChatEchoFrame {
  const echo = createNearbyChatEchoFrame({
    roomId: adapter.roomId,
    serverTick: adapter.getServerTick(),
    sessionId: params.sessionId,
    mapId: params.mapId,
    shardId: params.shardId,
    senderPlayerId: params.senderPlayerId,
    senderName: params.senderName,
    content: params.content,
    messageId: params.messageId,
    dedupeKey: params.dedupeKey,
  });

  for (const target of adapter.clients) {
    const context = adapter.getContext(target.sessionId);
    if (!context || context.mapId !== echo.mapId || context.shardId !== echo.shardId) {
      continue;
    }
    target.send(NEARBY_CHAT_ECHO_MESSAGE_TYPE, echo);
  }

  return echo;
}

/**
 * 下发附近频道进度刷新帧（progress_refresh = 12742，scope activity）。
 *
 * 成员进出 / 新消息 / 重连 replay 都必须调用，禁止只回 ACK。
 */
export function pushNearbyActivityProgressRefresh(params: {
  playerIds: Iterable<string>;
  roomId: string;
  serverTick: number;
  reason: string;
}) {
  const normalizedPlayerIds = new Set<string>();
  for (const playerId of params.playerIds) {
    const normalized = String(playerId || "").trim();
    if (normalized) {
      normalizedPlayerIds.add(normalized);
    }
  }

  for (const playerId of normalizedPlayerIds) {
    pushStateRefreshForPlayer({
      playerId,
      roomId: params.roomId,
      serverTick: params.serverTick,
      reason: params.reason,
      progress: {
        scopes: [...NEARBY_ACTIVITY_PROGRESS_SCOPES],
      },
    });
  }
}

export function createNearbyChatEchoFrame(params: {
  roomId: string;
  serverTick: number;
  sessionId: string;
  mapId: string;
  shardId: string;
  senderPlayerId: string;
  senderName: string;
  content: string;
  messageId: number | null;
  dedupeKey: string | null;
}): NearbyChatEchoFrame {
  return {
    type: "nearby_chat_echo",
    roomId: params.roomId,
    serverTick: params.serverTick,
    sentAt: Date.now(),
    mapId: params.mapId,
    shardId: params.shardId,
    roomMessageId: `${params.sessionId}:${nextEchoSequence(params.sessionId)}`,
    messageId: params.messageId,
    dedupeKey: params.dedupeKey,
    senderPlayerId: params.senderPlayerId,
    senderName: params.senderName,
    content: params.content,
  };
}
