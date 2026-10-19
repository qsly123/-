"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRealtimeRepairPayload,
  GAME_ROOM_NAMES,
  type RealtimeInputAck,
  type RealtimeRepairTrigger,
  type SocialPresenceEnvelope,
  type SocialPresenceEvent,
  type SocialPresencePlayer,
} from "@immortality/shared-protocol";
import {
  type SectPresenceCommand,
  type SectPresenceEvent,
  type SectPresenceMemberView,
  type SocialPresenceEnvelopeWithSect,
} from "@immortality/shared-protocol/sect-presence";
import {
  joinGameRoomWithSdkClient,
  loadGameColyseusSdkConstructor,
  type GameRoomConnection,
} from "@/modules/shared/services/colyseus-game-client";
import type { AnyStateRefreshEnvelope } from "@immortality/shared-protocol";
import {
  isNearbyChatEchoFrame,
  NEARBY_CHAT_ECHO_MESSAGE_TYPE,
  type NearbyChatEchoFrame,
} from "@/modules/social/realtime/nearby-chat-echo";
import {
  createStateRefreshMessageHandlers,
} from "@/modules/shared/ui/hooks/useStateRefreshFrames";
import { useForegroundRepairTrigger } from "@/modules/shared/ui/hooks/useForegroundRepairTrigger";

type SocialRoomStatus = "idle" | "connecting" | "connected" | "unavailable" | "disconnected";

/** game-server 下发的 social 帧：通用 presence 事件 + 宗门扩展事件 + 宗门 presence 列表。 */
type SocialRoomPayload = SocialPresenceEnvelopeWithSect & {
  sectPresence?: SectPresenceMemberView[];
};

export interface UseSocialRoomPresenceOptions {
  enabled?: boolean;
  playerId?: string | null;
  mapId?: string | null;
  shardId?: string | null;
  partyId?: string | null;
  sectId?: string | null;
  /**
   * 附近频道回声回调。
   *
   * 只代表「同图有新消息」这一实时信号，帧内容**不是持久化结果**。
   * 房间不再通过 `social_event.nearby_message` 广播消息，避免同一条消息两帧重复渲染；
   * 页面必须先用 `dedupeKey / messageId` 去重，再决定是否补一次增量拉取。
   */
  onNearbyMessage?: (echo: NearbyChatEchoFrame) => void;
  /** 资产 / 背包 / 进度刷新帧回调：宗门页靠它感知仓库与任命变化。 */
  onStateRefresh?: (frame: AnyStateRefreshEnvelope) => void;
  onSectPresenceEvent?: (event: SectPresenceEvent) => void;
}

export interface UseSocialRoomPresenceResult {
  status: SocialRoomStatus;
  lastError: string | null;
  lastAck: RealtimeInputAck | null;
  nearbyPlayers: SocialPresencePlayer[];
  partyMembers: SocialPresencePlayer[];
  sectMembers: SocialPresencePlayer[];
  sectPresence: SectPresenceMemberView[];
  /** 最近一次 repair 触发时间，用于判断 presence 是否已与服务端对齐。 */
  lastRepairAt: number;
  /** presence 处于未确认状态时为 true，UI 不得把旧列表当作实时在线。 */
  presenceStale: boolean;
  sendNearbyMessage: (
    message: string,
    meta?: { messageId?: number | null; dedupeKey?: string | null },
  ) => boolean;
  sendSectPresenceCommand: (
    command: SectPresenceCommand,
    payload?: { roleKey?: string; targetPlayerId?: string },
  ) => boolean;
  repair: (trigger?: RealtimeRepairTrigger) => boolean;
}

function normalizeId(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toSectPresenceList(payload: SocialRoomPayload | null): SectPresenceMemberView[] {
  if (!payload || !Array.isArray(payload.sectPresence)) {
    return [];
  }
  return payload.sectPresence;
}

function readEvents(payload: SocialRoomPayload | null): Array<SocialPresenceEvent | SectPresenceEvent> {
  if (!payload || !Array.isArray(payload.events)) {
    return [];
  }
  return payload.events;
}

export function useSocialRoomPresence(options: UseSocialRoomPresenceOptions): UseSocialRoomPresenceResult {
  const enabled = options.enabled ?? true;
  const playerId = normalizeId(options.playerId);
  const mapId = normalizeId(options.mapId);
  const shardId = normalizeId(options.shardId) || "0";
  const partyId = normalizeId(options.partyId);
  const sectId = normalizeId(options.sectId);
  const connectionRef = useRef<GameRoomConnection | null>(null);
  const messageHandlerRef = useRef(options.onNearbyMessage);
  const stateRefreshRef = useRef(options.onStateRefresh);
  const sectPresenceEventRef = useRef(options.onSectPresenceEvent);
  const [status, setStatus] = useState<SocialRoomStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastAck, setLastAck] = useState<RealtimeInputAck | null>(null);
  const [snapshot, setSnapshot] = useState<SocialPresenceEnvelope["authoritativeState"] | null>(null);
  const [sectPresence, setSectPresence] = useState<SectPresenceMemberView[]>([]);
  const [lastRepairAt, setLastRepairAt] = useState(0);
  /** repair 时带上"我最后看到的状态"，便于服务端判断补齐范围。 */
  const lastEnvelopeRef = useRef({ serverTick: 0, snapshotVersion: 0 });

  messageHandlerRef.current = options.onNearbyMessage;
  stateRefreshRef.current = options.onStateRefresh;
  sectPresenceEventRef.current = options.onSectPresenceEvent;

  const joinKey = useMemo(() => (
    enabled && playerId && mapId
      ? [playerId, mapId, shardId, partyId || "", sectId || ""].join("|")
      : ""
  ), [enabled, mapId, partyId, playerId, sectId, shardId]);

  useEffect(() => {
    let cancelled = false;
    let snapshotCleanup: (() => void) | undefined;
    let eventCleanup: (() => void) | undefined;
    let echoCleanup: (() => void) | undefined;

    async function connect() {
      if (!joinKey || !playerId || !mapId) {
        setStatus("idle");
        setSnapshot(null);
        setSectPresence([]);
        return;
      }

      setStatus("connecting");
      setLastError(null);

      try {
        const ClientConstructor = await loadGameColyseusSdkConstructor();
        if (!ClientConstructor) {
          throw new Error("colyseus_sdk_unavailable");
        }
        if (cancelled) {
          return;
        }

        const connection = await joinGameRoomWithSdkClient({
          ClientConstructor,
          roomName: GAME_ROOM_NAMES.social,
          options: {
            playerId,
            mapId,
            shardId,
            ...(partyId ? { partyId } : {}),
            ...(sectId ? { sectId } : {}),
          },
          // join 前预注册刷新帧 handler，避免首帧到达时被 SDK 丢弃。
          messageHandlers: createStateRefreshMessageHandlers((frame) => {
            stateRefreshRef.current?.(frame);
          }),
          onAck: (ack) => {
            setLastAck(ack);
          },
          onLeave: () => {
            if (!cancelled) {
              setStatus("disconnected");
            }
          },
          onReconnect: () => {
            if (!cancelled) {
              setStatus("connected");
              connectionRef.current?.sendInput("repair", {
                trigger: "reconnect",
                reason: "social_room_reconnect",
              });
            }
          },
        });
        if (cancelled) {
          await connection.leave(true);
          return;
        }

        connectionRef.current = connection;
        const rememberEnvelope = (payload: SocialRoomPayload) => {
          lastEnvelopeRef.current = {
            serverTick: Number(payload?.serverTick || 0),
            snapshotVersion: Number(payload?.snapshotVersion || 0),
          };
        };
        snapshotCleanup = connection.room.onMessage?.<SocialRoomPayload>("social_snapshot", (payload) => {
          rememberEnvelope(payload);
          setSnapshot(payload.authoritativeState);
          setSectPresence(toSectPresenceList(payload));
          // 附近消息不走 social_snapshot：持久化回灌走 SSE，实时提示走回声帧。
        }) || undefined;
        eventCleanup = connection.room.onMessage?.<SocialRoomPayload>("social_event", (payload) => {
          rememberEnvelope(payload);
          setSnapshot(payload.authoritativeState);
          setSectPresence(toSectPresenceList(payload));
          for (const event of readEvents(payload)) {
            // 同一条附近消息只允许一条链路渲染：这里刻意不派发 nearby_message，
            // 由下方 nearby_chat_echo 帧承载，避免与 SSE 回灌重复刷屏。
            if (
              event.type === "sect_presence_join"
              || event.type === "sect_presence_leave"
              || event.type === "sect_presence_home_changed"
              || event.type === "sect_presence_role_changed"
            ) {
              sectPresenceEventRef.current?.(event);
            }
          }
        }) || undefined;
        echoCleanup = connection.room.onMessage?.<NearbyChatEchoFrame>(
          NEARBY_CHAT_ECHO_MESSAGE_TYPE,
          (payload) => {
            if (!isNearbyChatEchoFrame(payload)) {
              return;
            }
            messageHandlerRef.current?.(payload);
          },
        ) || undefined;
        setStatus("connected");
        connection.sendInput("repair", {
          trigger: "initial_join",
          reason: "social_room_join",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setStatus("unavailable");
        setLastError(error instanceof Error ? error.message : "social_room_unavailable");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      snapshotCleanup?.();
      eventCleanup?.();
      echoCleanup?.();
      const connection = connectionRef.current;
      connectionRef.current = null;
      if (connection) {
        void connection.leave(true);
      }
    };
  }, [joinKey, mapId, partyId, playerId, sectId, shardId]);

  const sendNearbyMessage = useCallback((
    message: string,
    meta?: { messageId?: number | null; dedupeKey?: string | null },
  ) => {
    const content = message.trim();
    const connection = connectionRef.current;
    if (!connection || !content) {
      return false;
    }
    const messageId = Number(meta?.messageId);
    const dedupeKey = String(meta?.dedupeKey || "").trim();
    connection.sendInput("nearbyMessage", {
      message: content.slice(0, 200),
      // 幂等键仅供回声携带；服务端不会据此写库，持久化仍由核心 API 负责。
      ...(Number.isSafeInteger(messageId) && messageId > 0 ? { messageId } : {}),
      ...(dedupeKey ? { dedupeKey } : {}),
    });
    return true;
  }, []);

  /**
   * 宗门驻地 presence 指令：进入 / 离开驻地、任命变化。
   * 服务端收到后会向同宗门在线成员广播 social_event(10202)。
   */
  const sendSectPresenceCommand = useCallback((
    command: SectPresenceCommand,
    payload?: { roleKey?: string; targetPlayerId?: string },
  ) => {
    const connection = connectionRef.current;
    if (!connection) {
      return false;
    }
    connection.sendInput("command", {
      command,
      ...(payload?.roleKey ? { roleKey: payload.roleKey } : {}),
      ...(payload?.targetPlayerId ? { targetPlayerId: payload.targetPlayerId } : {}),
    });
    return true;
  }, []);

  const repair = useCallback((trigger: RealtimeRepairTrigger = "manual") => {
    const connection = connectionRef.current;
    if (!connection) {
      return false;
    }
    connection.sendInput("repair", createRealtimeRepairPayload({
      trigger,
      reason: `social_room_${trigger}`,
      lastServerTick: lastEnvelopeRef.current.serverTick,
      lastSnapshotVersion: lastEnvelopeRef.current.snapshotVersion,
    }));
    setLastRepairAt(Date.now());
    return true;
  }, []);

  /**
   * iOS 锁屏 / 切后台回到前台后自动 repair。
   *
   * 聊天 presence 最容易假在线：玩家看到的是上一次 social_snapshot 留下的列表，
   * 而服务端可能已经因为连接冻结把它标记为离线。回到前台必须立刻要一帧权威快照。
   */
  useForegroundRepairTrigger({
    enabled: Boolean(joinKey),
    onRepair: (trigger) => {
      repair(trigger);
    },
  });

  return {
    status,
    lastError,
    lastAck,
    nearbyPlayers: snapshot?.nearbyPlayers || [],
    partyMembers: snapshot?.partyMembers || [],
    sectMembers: snapshot?.sectMembers || [],
    sectPresence,
    lastRepairAt,
    // 未连上 / repair 未回包时，UI 不允许把旧列表当成实时在线展示。
    presenceStale: status !== "connected",
    sendNearbyMessage,
    sendSectPresenceCommand,
    repair,
  };
}
