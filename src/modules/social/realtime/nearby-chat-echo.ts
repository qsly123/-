/**
 * 附近频道房间回声帧的客户端契约。
 *
 * ⚠️ 本文件是服务端 `apps/game-server/src/rooms/nearby-chat-echo.ts` 的镜像，
 * 两端帧名与字段名必须保持一致（由 `apps/game-server/src/bot/system-b-nearby-chat.ts`
 * 场景断言看守），否则去重会失效。
 *
 * ## 边界
 *
 * - 持久化唯一入口：核心 API `POST /api/game/chat/nearby` + 现役 SSE
 *   `/api/game/chat/nearby/sse`（唯一真源，消息带持久化 `id` 与 `dedupeKey`）。
 * - `SocialRoom` 只发回声帧：不写库、不生成持久化 id。
 * - 客户端渲染唯一来源仍是持久化链路；回声帧只用于「有新消息」提示与幂等对齐。
 */

export const NEARBY_CHAT_ECHO_MESSAGE_TYPE = "nearby_chat_echo";

/** 附近频道进度刷新帧使用的 scope（progress_refresh = 12742）。 */
export const NEARBY_ACTIVITY_PROGRESS_SCOPE = "activity";

export const NEARBY_CHAT_PROGRESS_REASON = {
  message: "nearby_message",
  memberChanged: "nearby_member_changed",
  replay: "nearby_replay",
  /**
   * 核心 API 发送成功后随响应回带的帧（12742 / activity）。
   * 消息本地已合入，收到这类帧只更新动态计数，不再触发拉取。
   */
  sent: "nearby_message_sent",
} as const;

/**
 * 归属附近频道的 reason 全集。
 *
 * 波次3 的 repair 补齐同样下发 12742（`reason` 形如 `repair:<trigger>:<reason>`），
 * 那类帧由 repair 通道自己消费；附近频道必须按 reason 白名单过滤，
 * 否则同一帧会被两条链路各消费一次（计数翻倍 / 重复拉取）。
 */
export const NEARBY_CHAT_PROGRESS_REASONS: readonly string[] = Object.values(NEARBY_CHAT_PROGRESS_REASON);

export function isNearbyChatProgressReason(reason: unknown): boolean {
  return NEARBY_CHAT_PROGRESS_REASONS.includes(String(reason || ""));
}

export type NearbyChatProgressReason =
  (typeof NEARBY_CHAT_PROGRESS_REASON)[keyof typeof NEARBY_CHAT_PROGRESS_REASON];

export interface NearbyChatEchoFrame {
  type: "nearby_chat_echo";
  roomId: string;
  serverTick: number;
  sentAt: number;
  mapId: string;
  shardId: string;
  roomMessageId: string;
  messageId: number | null;
  dedupeKey: string | null;
  senderPlayerId: string;
  senderName: string;
  content: string;
}

const RENDER_KEY_MAX_LENGTH = 160;

/**
 * 计算消息渲染去重键。
 *
 * 优先级：`dedupeKey` > `db:<messageId>` > `room:<roomMessageId>`。
 * 返回 null 表示这条数据无法去重，调用方应当丢弃而不是渲染。
 */
export function resolveNearbyChatRenderKey(params: {
  dedupeKey?: string | null;
  messageId?: number | null;
  roomMessageId?: string | null;
}): string | null {
  const dedupeKey = String(params.dedupeKey || "").trim();
  if (dedupeKey) {
    return dedupeKey.slice(0, RENDER_KEY_MAX_LENGTH);
  }

  const messageId = Number(params.messageId);
  if (Number.isSafeInteger(messageId) && messageId > 0) {
    return `db:${messageId}`;
  }

  const roomMessageId = String(params.roomMessageId || "").trim();
  if (roomMessageId) {
    return `room:${roomMessageId.slice(0, RENDER_KEY_MAX_LENGTH)}`;
  }

  return null;
}

export interface NearbyChatRenderKeyStore {
  /** 返回 true 表示这条消息此前已经渲染过（或已入库），调用方应跳过。 */
  has: (key: string) => boolean;
  /** 登记已渲染键，返回 true 表示本次是首次登记。 */
  add: (key: string) => boolean;
  size: () => number;
  clear: () => void;
}

/**
 * 已渲染消息键的有限容量集合（FIFO）。
 *
 * 用于「SSE 回灌」与「房间回声」两条链路对齐：
 * 同一条消息只有第一次到达会被登记，后续到达直接判定为重复。
 */
export function createNearbyChatRenderKeyStore(limit = 400): NearbyChatRenderKeyStore {
  const keys = new Set<string>();
  const maxSize = Math.max(1, Math.floor(limit));

  return {
    has(key) {
      return keys.has(key);
    },
    add(key) {
      if (keys.has(key)) {
        return false;
      }
      keys.add(key);
      if (keys.size > maxSize) {
        const oldest = keys.values().next().value;
        if (typeof oldest === "string") {
          keys.delete(oldest);
        }
      }
      return true;
    },
    size() {
      return keys.size;
    },
    clear() {
      keys.clear();
    },
  };
}

export function isNearbyChatEchoFrame(value: unknown): value is NearbyChatEchoFrame {
  if (!value || typeof value !== "object") {
    return false;
  }
  const frame = value as Partial<NearbyChatEchoFrame>;
  return frame.type === NEARBY_CHAT_ECHO_MESSAGE_TYPE && typeof frame.mapId === "string";
}
