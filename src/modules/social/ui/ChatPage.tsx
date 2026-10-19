"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button, Input, Segmented, Select, Spin, Typography, message } from "antd";
import {
  HeartOutlined,
  MailOutlined,
  MessageOutlined,
  SendOutlined,
  TeamOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import NotificationDot from "@/modules/shared/ui/components/NotificationDot";
import { openJsonEventStream } from "@/modules/shared/services/realtime-channel";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import PlayerInfoModal from "@/modules/shared/ui/components/PlayerInfoModal";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";
import { useSocialRoomPresence } from "@/modules/social/ui/hooks/useSocialRoomPresence";
import {
  createNearbyChatRenderKeyStore,
  NEARBY_ACTIVITY_PROGRESS_SCOPE,
  NEARBY_CHAT_PROGRESS_REASON,
  isNearbyChatProgressReason,
  resolveNearbyChatRenderKey,
  type NearbyChatEchoFrame,
} from "@/modules/social/realtime/nearby-chat-echo";
import {
  applyStateRefreshFramesFromResponse,
} from "@/modules/shared/ui/hooks/useStateRefreshFrames";
import {
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  type AnyStateRefreshEnvelope,
} from "@immortality/shared-protocol";

const { Text } = Typography;

type ChatMessageItem = {
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
};

type ChatSseEvent =
  | { type: "connected" }
  | { type: "chat_message"; data: ChatMessageItem };

type NearbyChatMessageItem = {
  id: number;
  mapId: string;
  districtName?: string | null;
  senderType: "player" | "npc" | "system";
  playerId: string | null;
  senderName: string;
  avatarId?: string | null;
  avatarImageUrl?: string | null;
  avatarFrameId?: string | null;
  avatarFrameImageUrl?: string | null;
  content: string;
  createdAt: string;
  /** 幂等键。房间回声与 SSE 回灌靠它对齐，保证一条消息只渲染一次。 */
  dedupeKey?: string | null;
};

type NearbyChatScope = "map" | "district";

type NearbyDistrictRumorItem = {
  districtName: string;
  title: string;
  content: string;
  heat: "low" | "medium" | "high";
  updatedAt: string;
  source: "ai" | "fallback";
};

type NearbyChatSseEvent =
  | {
    type: "connected";
    mapId: string;
    mapName: string;
    scope: NearbyChatScope;
    currentDistrictName: string | null;
    currentDistrictRumor: NearbyDistrictRumorItem | null;
    storageMode: "database" | "memory";
  }
  | { type: "nearby_message"; data: NearbyChatMessageItem };

type FriendItem = {
  id: number;
  targetPlayerId: string;
  targetPlayerName: string;
  targetRealmName: string;
  createdAt: string;
  updatedAt?: string;
  requestedBy?: string;
};

type IntimacyRelationType = "dao_lv" | "jie_yi" | "shi_tu";

type IntimacyItem = {
  id: number;
  targetPlayerId: string;
  targetPlayerName: string;
  targetRealmName: string;
  relationType: IntimacyRelationType;
  createdAt: string;
  updatedAt?: string;
  requestedBy?: string;
};

type DmConversationItem = {
  id: string;
  targetPlayerId: string;
  targetPlayerName: string;
  targetRealmName: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
};

type DmMessageItem = {
  id: number;
  conversationId: string;
  senderPlayerId: string;
  senderName: string;
  content: string;
  createdAt: string;
};

type DmPermission = "all" | "friends" | "none";

type SocialSseEvent =
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
  | { type: "friend_request"; data: unknown }
  | { type: "friend_update"; data: unknown }
  | { type: "intimacy_request"; data: unknown }
  | { type: "intimacy_update"; data: unknown }
  | { type: "notification"; data: unknown };

type NotificationRewardItem = {
  itemId: string;
  quantity: number;
  itemName?: string;
  itemIconUrl?: string | null;
};

type NotificationItem = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  claimedAt: string | null;
  reward: {
    gold?: number;
    xp?: number;
    items?: NotificationRewardItem[];
  };
};

type TabKey = "world" | "nearby" | "system" | "dm" | "social" | "notifications";

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  data?: T;
};

const RELATION_TYPE_OPTIONS: Array<{ label: string; value: IntimacyRelationType }> = [
  { label: "道侣", value: "dao_lv" },
  { label: "结义", value: "jie_yi" },
  { label: "师徒", value: "shi_tu" },
];

const DM_PERMISSION_OPTIONS: Array<{ label: string; value: DmPermission }> = [
  { label: "全部可聊", value: "all" },
  { label: "仅好友", value: "friends" },
  { label: "拒绝私聊", value: "none" },
];

const WORLD_CHAT_HISTORY_LIMIT = 100;
const NEARBY_CHAT_HISTORY_LIMIT = 100;
const SYSTEM_CHAT_HISTORY_LIMIT = 100;

/** 房间回声触发的增量同步防抖窗口，避免同图 N 条回声触发 N 次拉取。 */
const NEARBY_ECHO_SYNC_DEBOUNCE_MS = 250;

/** 生成本次发送的幂等键输入。弱网重试必须复用同一个值。 */
function createNearbyClientMessageId() {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${Date.now().toString(36)}-${random}`;
}

const panelStyle = {
  border: "1px solid #2a2520",
  borderRadius: 6,
  background: "rgba(13, 13, 15, 0.9)",
};

const innerPanelStyle = {
  border: "1px solid #2a2520",
  borderRadius: 6,
  background: "rgba(26, 26, 46, 0.82)",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function relationTypeLabel(value: string) {
  if (value === "dao_lv") return "道侣";
  if (value === "jie_yi") return "结义";
  if (value === "shi_tu") return "师徒";
  return value;
}

function hasNotificationRewardValue(reward: NotificationItem["reward"]) {
  return Boolean((reward.gold || 0) > 0 || (reward.xp || 0) > 0 || (reward.items?.length || 0) > 0);
}

function buildNotificationRewardSummary(reward: NotificationItem["reward"]) {
  const parts: string[] = [];

  if ((reward.gold || 0) > 0) {
    parts.push(`灵石+${reward.gold}`);
  }

  if ((reward.xp || 0) > 0) {
    parts.push(`修为+${reward.xp}`);
  }

  if (reward.items?.length) {
    parts.push(reward.items.map((item) => `${item.itemName || item.itemId}x${item.quantity}`).join("、"));
  }

  return parts.join("，");
}

function labelWithDot(label: string, showDot: boolean) {
  if (!showDot) {
    return label;
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", paddingRight: 10 }}>
      <span>{label}</span>
      <NotificationDot style={{ top: -1, right: 0 }} />
    </span>
  );
}

function scrollToBottom(ref: RefObject<HTMLDivElement | null>) {
  const node = ref.current;
  if (!node) {
    return;
  }

  node.scrollTop = node.scrollHeight;
}

function scheduleScrollToBottom(ref: RefObject<HTMLDivElement | null>) {
  if (typeof window === "undefined") {
    scrollToBottom(ref);
    return;
  }

  window.requestAnimationFrame(() => {
    scrollToBottom(ref);
    window.setTimeout(() => {
      scrollToBottom(ref);
    }, 0);
  });
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  return res.json() as Promise<ApiResponse<T>>;
}

function mergeChatMessages<T extends { id: number }>(
  current: T[],
  incoming: T[],
  limit: number,
) {
  if (incoming.length === 0) {
    return current;
  }

  const messageMap = new Map<number, T>();
  for (const item of current) {
    messageMap.set(item.id, item);
  }
  for (const item of incoming) {
    messageMap.set(item.id, item);
  }

  return Array.from(messageMap.values())
    .sort((left, right) => left.id - right.id)
    .slice(-limit);
}

function SectionCard({
  title,
  icon,
  extra,
  children,
}: {
  title: string | ReactNode;
  icon?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ ...innerPanelStyle, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {icon}
          <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>{title}</Text>
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

export default function ChatPage() {
  const {
    dmHasNotification,
    socialHasNotification,
    notificationHasNotification,
    refreshNotifications,
  } = useGameNotifications();

  const [tab, setTab] = useState<TabKey>("world");

  const [selfId, setSelfId] = useState("");
  const [worldLoading, setWorldLoading] = useState(true);
  const [worldMessages, setWorldMessages] = useState<ChatMessageItem[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [nearbyMessages, setNearbyMessages] = useState<NearbyChatMessageItem[]>([]);
  const [nearbyMapId, setNearbyMapId] = useState("");
  const [nearbyMapName, setNearbyMapName] = useState("");
  const [nearbyScope, setNearbyScope] = useState<NearbyChatScope>("map");
  const [nearbyCurrentDistrictName, setNearbyCurrentDistrictName] = useState<string | null>(null);
  const [nearbyCurrentDistrictRumor, setNearbyCurrentDistrictRumor] = useState<NearbyDistrictRumorItem | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);
  const [systemMessages, setSystemMessages] = useState<ChatMessageItem[]>([]);
  const [worldContent, setWorldContent] = useState("");
  const [worldSending, setWorldSending] = useState(false);
  const [nearbyContent, setNearbyContent] = useState("");
  const [nearbySending, setNearbySending] = useState(false);

  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsAccepted, setFriendsAccepted] = useState<FriendItem[]>([]);
  const [friendsIncoming, setFriendsIncoming] = useState<FriendItem[]>([]);
  const [friendsOutgoing, setFriendsOutgoing] = useState<FriendItem[]>([]);
  const [friendTargetInput, setFriendTargetInput] = useState("");

  const [intimacyLoading, setIntimacyLoading] = useState(false);
  const [intimacyAccepted, setIntimacyAccepted] = useState<IntimacyItem[]>([]);
  const [intimacyIncoming, setIntimacyIncoming] = useState<IntimacyItem[]>([]);
  const [intimacyOutgoing, setIntimacyOutgoing] = useState<IntimacyItem[]>([]);
  const [intimacyTargetInput, setIntimacyTargetInput] = useState("");
  const [intimacyType, setIntimacyType] = useState<IntimacyRelationType>("dao_lv");

  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationClaimingId, setNotificationClaimingId] = useState<number | null>(null);
  const [notificationDeletingId, setNotificationDeletingId] = useState<number | null>(null);

  const [dmLoading, setDmLoading] = useState(false);
  const [dmConversations, setDmConversations] = useState<DmConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [dmMessagesLoading, setDmMessagesLoading] = useState(false);
  const [dmMessages, setDmMessages] = useState<DmMessageItem[]>([]);
  const [dmTargetInput, setDmTargetInput] = useState("");
  const [dmContent, setDmContent] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmPermission, setDmPermission] = useState<DmPermission>("friends");
  const [dmPermissionSaving, setDmPermissionSaving] = useState(false);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerInfoOpen, setPlayerInfoOpen] = useState(false);
  /** 附近频道进度刷新次数（progress_refresh 12742，scope activity）。 */
  const [nearbyActivityVersion, setNearbyActivityVersion] = useState(0);

  const [messageApi, contextHolder] = message.useMessage();
  const initialDmRouteHandledRef = useRef(false);
  const worldListRef = useRef<HTMLDivElement>(null);
  const nearbyListRef = useRef<HTMLDivElement>(null);
  const systemListRef = useRef<HTMLDivElement>(null);
  const dmListRef = useRef<HTMLDivElement>(null);
  /** 已渲染 / 已入库的附近消息键，用于 SSE 回灌与房间回声对齐去重。 */
  const nearbyRenderKeysRef = useRef(createNearbyChatRenderKeyStore(NEARBY_CHAT_HISTORY_LIMIT * 4));
  /** 已排队的回声键，避免同一条回声重复触发增量同步。 */
  const nearbyPendingEchoKeysRef = useRef(new Set<string>());
  const nearbyEchoSyncTimerRef = useRef<number | null>(null);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => !item.claimedAt).length,
    [notifications],
  );
  const activeConversation = useMemo(
    () => dmConversations.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, dmConversations],
  );
  const effectiveDmTargetId = activeConversation?.targetPlayerId || dmTargetInput.trim();
  const nearbySseDistrictKey = nearbyScope === "district"
    ? (nearbyCurrentDistrictName || "__none__")
    : "__map__";

  const openPlayerInfo = useCallback((playerId: string) => {
    const nextId = playerId.trim();
    if (!nextId || nextId === selfId) {
      return;
    }

    setSelectedPlayerId(nextId);
    setPlayerInfoOpen(true);
  }, [selfId]);

  const jumpToDm = useCallback((playerId: string) => {
    const nextId = playerId.trim();
    if (!nextId || nextId === selfId) {
      return;
    }

    const existing = dmConversations.find((item) => item.targetPlayerId === nextId);
    if (existing) {
      setActiveConversationId(existing.id);
      setDmTargetInput("");
    } else {
      setActiveConversationId("");
      setDmMessages([]);
      setDmTargetInput(nextId);
    }
    setTab("dm");
  }, [dmConversations, selfId]);

  useEffect(() => {
    if (initialDmRouteHandledRef.current || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const targetTab = (params.get("tab") || "").trim();
    const targetPlayerId = (params.get("targetPlayerId") || "").trim();

    initialDmRouteHandledRef.current = true;

    if (targetTab !== "dm" && !targetPlayerId) {
      return;
    }

    if (targetTab === "dm") {
      setTab("dm");
    }

    if (targetPlayerId) {
      jumpToDm(targetPlayerId);
    }

    window.history.replaceState(window.history.state, "", "/game/chat");
  }, [jumpToDm]);

  const fetchWorldMessages = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setWorldLoading(true);
    }

    try {
      const json = await readJson<{ playerId: string; messages: ChatMessageItem[] }>("/api/game/chat", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showLoading) {
          messageApi.error("加载天道传音失败");
        }
        return;
      }

      setSelfId(json.data.playerId || "");
      setWorldMessages(json.data.messages || []);
    } catch {
      if (showLoading) {
        messageApi.error("加载天道传音失败");
      }
    } finally {
      if (showLoading) {
        setWorldLoading(false);
      }
    }
  }, [messageApi]);

  /**
   * 合入附近频道持久化消息。
   *
   * 附近频道的渲染唯一来源是「核心 API 列表 + SSE 回灌」，两条链路都按 `id` 合并，
   * 因此同一条消息重复到达不会产生第二条。房间回声不直接进列表，只触发增量同步。
   */
  const mergeNearbyMessages = useCallback((incoming: NearbyChatMessageItem[]) => {
    if (incoming.length === 0) {
      return;
    }

    for (const item of incoming) {
      const key = resolveNearbyChatRenderKey({
        dedupeKey: item.dedupeKey,
        messageId: item.id,
      });
      if (key) {
        nearbyRenderKeysRef.current.add(key);
      }
    }

    setNearbyMessages((current) => mergeChatMessages(current, incoming, NEARBY_CHAT_HISTORY_LIMIT));
  }, []);

  const fetchNearbyMessages = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setNearbyLoading(true);
    }

    try {
      const json = await readJson<{
        playerId: string;
        mapId: string;
        mapName: string;
        scope: NearbyChatScope;
        currentDistrictName: string | null;
        currentDistrictRumor: NearbyDistrictRumorItem | null;
        storageMode: "database" | "memory";
        messages: NearbyChatMessageItem[];
      }>(`/api/game/chat/nearby?scope=${encodeURIComponent(nearbyScope)}`, {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (json.error === "当前不在可用地图中") {
          setNearbyMapId("");
          setNearbyMapName("");
          setNearbyCurrentDistrictName(null);
          setNearbyCurrentDistrictRumor(null);
          setNearbyMessages([]);
          return;
        }
        if (showLoading) {
          messageApi.error(json.error || "加载附近消息失败");
        }
        return;
      }

      setSelfId(json.data.playerId || "");
      setNearbyMapId(json.data.mapId || "");
      setNearbyMapName(json.data.mapName || json.data.mapId || "");
      setNearbyScope(json.data.scope || nearbyScope);
      setNearbyCurrentDistrictName(json.data.currentDistrictName || null);
      setNearbyCurrentDistrictRumor(json.data.currentDistrictRumor || null);
      mergeNearbyMessages(json.data.messages || []);
    } catch {
      if (showLoading) {
        messageApi.error("加载附近消息失败");
      }
    } finally {
      if (showLoading) {
        setNearbyLoading(false);
      }
    }
  }, [mergeNearbyMessages, messageApi, nearbyScope]);

  /** 防抖的附近频道增量同步：N 条回声只触发一次拉取，避免重复刷屏。 */
  const scheduleNearbyEchoSync = useCallback(() => {
    if (nearbyEchoSyncTimerRef.current !== null) {
      return;
    }

    nearbyEchoSyncTimerRef.current = window.setTimeout(() => {
      nearbyEchoSyncTimerRef.current = null;
      void fetchNearbyMessages(false).finally(() => {
        nearbyPendingEchoKeysRef.current.clear();
      });
    }, NEARBY_ECHO_SYNC_DEBOUNCE_MS);
  }, [fetchNearbyMessages]);

  /** 消费 progress_refresh(12742) 刷新帧，禁止只回 ACK 不下发帧。 */
  const applyNearbyProgressFrame = useCallback((frame: AnyStateRefreshEnvelope) => {
    if (!frame || frame.opcode !== REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh) {
      return;
    }

    const payload = frame.payload as { scopes?: string[]; reason?: string } | undefined;
    const scopes = Array.isArray(payload?.scopes) ? payload?.scopes : [];
    if (!scopes.includes(NEARBY_ACTIVITY_PROGRESS_SCOPE)) {
      return;
    }

    // reason 白名单：repair 补齐通道也会下发 12742（`repair:<trigger>:<reason>`），
    // 那类帧由 repair 通道自己消费，这里必须跳过，否则同一帧被两条链路各消费一次。
    const reason = String(payload?.reason || "");
    if (!isNearbyChatProgressReason(reason)) {
      return;
    }

    setNearbyActivityVersion((version) => version + 1);

    // 重连 replay：房间侧提示附近频道需要重新对齐，这里补一次增量同步，
    // 不做整段历史重灌，避免锁屏回来刷历史。
    if (reason === NEARBY_CHAT_PROGRESS_REASON.replay) {
      scheduleNearbyEchoSync();
    }
  }, [scheduleNearbyEchoSync]);

  /**
   * 房间回声处理：只作为「同图有新消息」的信号。
   *
   * 已经由 SSE / 列表渲染过的键直接丢弃；未渲染过的键合并成一次增量拉取。
   * 房间回声本身**不会**写入消息列表，避免与 SSE 回灌重复渲染。
   */
  const handleSocialRoomNearbyMessage = useCallback((echo: NearbyChatEchoFrame) => {
    if (echo.mapId !== nearbyMapId) {
      return;
    }

    const key = resolveNearbyChatRenderKey({
      dedupeKey: echo.dedupeKey,
      messageId: echo.messageId,
      roomMessageId: echo.roomMessageId,
    });
    if (!key) {
      return;
    }
    if (nearbyRenderKeysRef.current.has(key) || nearbyPendingEchoKeysRef.current.has(key)) {
      return;
    }

    nearbyPendingEchoKeysRef.current.add(key);
    scheduleNearbyEchoSync();
  }, [nearbyMapId, scheduleNearbyEchoSync]);

  const socialRoomPresence = useSocialRoomPresence({
    enabled: Boolean(selfId && nearbyMapId),
    playerId: selfId,
    mapId: nearbyMapId,
    shardId: "0",
    onNearbyMessage: handleSocialRoomNearbyMessage,
    // 房间下发的资产 / 背包 / 进度刷新帧；附近频道只消费 scope=activity 的进度帧。
    onStateRefresh: applyNearbyProgressFrame,
  });

  const fetchSystemMessages = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setSystemLoading(true);
    }

    try {
      const json = await readJson<{ messages: ChatMessageItem[] }>("/api/game/chat/system", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showLoading) {
          messageApi.error("加载系统消息失败");
        }
        return;
      }

      setSystemMessages(json.data.messages || []);
    } catch {
      if (showLoading) {
        messageApi.error("加载系统消息失败");
      }
    } finally {
      if (showLoading) {
        setSystemLoading(false);
      }
    }
  }, [messageApi]);

  const fetchFriends = useCallback(async (showError = false) => {
    setFriendsLoading(true);
    try {
      const json = await readJson<{
        accepted: FriendItem[];
        incomingPending: FriendItem[];
        outgoingPending: FriendItem[];
      }>("/api/game/social/friends", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showError) {
          messageApi.error("加载好友信息失败");
        }
        return;
      }

      setFriendsAccepted(json.data.accepted || []);
      setFriendsIncoming(json.data.incomingPending || []);
      setFriendsOutgoing(json.data.outgoingPending || []);
    } catch {
      if (showError) {
        messageApi.error("加载好友信息失败");
      }
    } finally {
      setFriendsLoading(false);
    }
  }, [messageApi]);

  const fetchIntimacy = useCallback(async (showError = false) => {
    setIntimacyLoading(true);
    try {
      const json = await readJson<{
        accepted: IntimacyItem[];
        incomingPending: IntimacyItem[];
        outgoingPending: IntimacyItem[];
      }>("/api/game/social/intimacy", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showError) {
          messageApi.error("加载亲密关系失败");
        }
        return;
      }

      setIntimacyAccepted(json.data.accepted || []);
      setIntimacyIncoming(json.data.incomingPending || []);
      setIntimacyOutgoing(json.data.outgoingPending || []);
    } catch {
      if (showError) {
        messageApi.error("加载亲密关系失败");
      }
    } finally {
      setIntimacyLoading(false);
    }
  }, [messageApi]);

  const fetchNotifications = useCallback(async (showError = false) => {
    setNotificationLoading(true);
    try {
      const json = await readJson<{ mails: NotificationItem[] }>("/api/game/mail/list", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showError) {
          messageApi.error("加载通知失败");
        }
        return;
      }

      setNotifications(json.data.mails || []);
    } catch {
      if (showError) {
        messageApi.error("加载通知失败");
      }
    } finally {
      setNotificationLoading(false);
    }
  }, [messageApi]);

  const fetchDmSettings = useCallback(async (showError = false) => {
    try {
      const json = await readJson<{ dmPermission: DmPermission }>("/api/game/social/settings", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showError) {
          messageApi.error("加载私聊设置失败");
        }
        return;
      }

      setDmPermission(json.data.dmPermission || "friends");
    } catch {
      if (showError) {
        messageApi.error("加载私聊设置失败");
      }
    }
  }, [messageApi]);

  const fetchDmConversations = useCallback(async (preferredConversationId?: string, showError = false) => {
    setDmLoading(true);
    try {
      const json = await readJson<{ conversations: DmConversationItem[] }>("/api/game/social/dm/conversations", {
        cache: "no-store",
      });

      if (!json.success || !json.data) {
        if (showError) {
          messageApi.error("加载私聊会话失败");
        }
        return;
      }

      const nextConversations = json.data.conversations || [];
      const requestedTargetPlayerId = dmTargetInput.trim();
      const matchedTargetConversation = requestedTargetPlayerId
        ? nextConversations.find((item) => item.targetPlayerId === requestedTargetPlayerId) || null
        : null;
      setDmConversations(nextConversations);
      if (matchedTargetConversation) {
        setDmTargetInput("");
      }
      setActiveConversationId((current) => {
        if (preferredConversationId && nextConversations.some((item) => item.id === preferredConversationId)) {
          return preferredConversationId;
        }
        if (requestedTargetPlayerId) {
          return matchedTargetConversation?.id || "";
        }
        if (matchedTargetConversation) {
          return matchedTargetConversation.id;
        }
        if (current && nextConversations.some((item) => item.id === current)) {
          return current;
        }
        return nextConversations[0]?.id || "";
      });
    } catch {
      if (showError) {
        messageApi.error("加载私聊会话失败");
      }
    } finally {
      setDmLoading(false);
    }
  }, [dmTargetInput, messageApi]);

  const markDmConversationRead = useCallback(async (conversationId: string, lastReadMessageId: number) => {
    try {
      const json = await readJson<{ conversationId: string; lastReadMessageId: number }>(
        "/api/game/social/dm/read",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, lastReadMessageId }),
        },
      );

      if (!json.success) {
        return;
      }

      setDmConversations((current) => current.map((item) => (
        item.id === conversationId ? { ...item, unreadCount: 0 } : item
      )));
      await refreshNotifications();
    } catch {
      // ignore read sync failures
    }
  }, [refreshNotifications]);

  const fetchDmMessages = useCallback(async (conversationId: string, showError = false) => {
    if (!conversationId) {
      setDmMessages([]);
      return;
    }

    setDmMessagesLoading(true);
    try {
      const json = await readJson<{ conversationId: string; messages: DmMessageItem[] }>(
        `/api/game/social/dm/messages?conversationId=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );

      if (!json.success || !json.data) {
        if (showError) {
          messageApi.error("加载私聊消息失败");
        }
        return;
      }

      const nextMessages = json.data.messages || [];
      setDmMessages(nextMessages);

      const lastMessage = nextMessages[nextMessages.length - 1];
      if (lastMessage) {
        await markDmConversationRead(conversationId, lastMessage.id);
      }
    } catch {
      if (showError) {
        messageApi.error("加载私聊消息失败");
      }
    } finally {
      setDmMessagesLoading(false);
    }
  }, [markDmConversationRead, messageApi]);

  useEffect(() => {
    void fetchWorldMessages();
    void fetchNearbyMessages();
    void fetchSystemMessages();
    void fetchFriends();
    void fetchIntimacy();
    void fetchDmSettings();
    void fetchDmConversations();
    void fetchNotifications();
  }, [
    fetchDmConversations,
    fetchDmSettings,
    fetchFriends,
    fetchIntimacy,
    fetchNearbyMessages,
    fetchNotifications,
    fetchSystemMessages,
    fetchWorldMessages,
  ]);

  useEffect(() => {
    if (!activeConversationId) {
      setDmMessages([]);
      return;
    }

    void fetchDmMessages(activeConversationId);
  }, [activeConversationId, fetchDmMessages]);

  useEffect(() => {
    scheduleScrollToBottom(worldListRef);
  }, [worldMessages]);

  useEffect(() => {
    scheduleScrollToBottom(nearbyListRef);
  }, [nearbyMessages]);

  useEffect(() => {
    scheduleScrollToBottom(systemListRef);
  }, [systemMessages]);

  useEffect(() => {
    if (tab === "nearby") {
      scheduleScrollToBottom(nearbyListRef);
    }
  }, [nearbyMessages, tab]);

  useEffect(() => {
    if (tab === "system") {
      scheduleScrollToBottom(systemListRef);
    }
  }, [systemMessages, tab]);

  useEffect(() => {
    scheduleScrollToBottom(dmListRef);
  }, [dmMessages]);

  useEffect(() => {
    if (tab === "world") {
      scheduleScrollToBottom(worldListRef);
      return;
    }
    if (tab === "nearby") {
      scheduleScrollToBottom(nearbyListRef);
      return;
    }
    if (tab === "system") {
      scheduleScrollToBottom(systemListRef);
      return;
    }
    if (tab === "dm") {
      scheduleScrollToBottom(dmListRef);
    }
  }, [tab]);

  useEffect(() => {
    // 切图 / 切范围：清空列表的同时清空去重键，避免旧地图的消息键误伤新频道。
    setNearbyMessages([]);
    setNearbyCurrentDistrictRumor(null);
    nearbyRenderKeysRef.current.clear();
    nearbyPendingEchoKeysRef.current.clear();
  }, [nearbyMapId, nearbyScope]);

  useEffect(() => () => {
    if (nearbyEchoSyncTimerRef.current !== null) {
      window.clearTimeout(nearbyEchoSyncTimerRef.current);
      nearbyEchoSyncTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (tab === "social") {
      void fetchFriends();
      void fetchIntimacy();
    }

    if (tab === "dm") {
      void fetchDmSettings();
      void fetchDmConversations();
    }

    if (tab === "notifications") {
      void fetchNotifications();
    }

    if (tab === "nearby") {
      void fetchNearbyMessages();
    }
  }, [tab, fetchDmConversations, fetchDmSettings, fetchFriends, fetchIntimacy, fetchNearbyMessages, fetchNotifications]);

  useEffect(() => {
    if (tab !== "nearby" || !nearbyMapId) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchNearbyMessages(false);
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchNearbyMessages, nearbyMapId, tab]);

  useEffect(() => {
    let channel: ReturnType<typeof openJsonEventStream<ChatSseEvent>> | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const clearRetryTimer = () => {
      if (retryTimer === null) {
        return;
      }
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      channel?.close();
      channel = openJsonEventStream<ChatSseEvent>({
        url: "/api/game/chat/sse",
        onMessage: (payload) => {
          if (!payload || payload.type === "connected") {
            return;
          }

          if (payload.type === "chat_message") {
            if (payload.data.messageType === "system") {
              setSystemMessages((current) => mergeChatMessages(current, [payload.data], SYSTEM_CHAT_HISTORY_LIMIT));
              return;
            }

            setWorldMessages((current) => mergeChatMessages(current, [payload.data], WORLD_CHAT_HISTORY_LIMIT));
          }
        },
        onError: () => {
          channel?.close();
          channel = null;
          if (closed || retryTimer !== null) {
            return;
          }

          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (!closed) {
              connect();
            }
          }, 2000);
        },
      });
      if (!channel) {
        return;
      }
    };

    connect();

    return () => {
      closed = true;
      clearRetryTimer();
      channel?.close();
      channel = null;
    };
  }, []);

  useEffect(() => {
    if (!nearbyMapId) {
      return;
    }

    let channel: ReturnType<typeof openJsonEventStream<NearbyChatSseEvent>> | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const clearRetryTimer = () => {
      if (retryTimer === null) {
        return;
      }
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      channel?.close();
      channel = openJsonEventStream<NearbyChatSseEvent>({
        url: `/api/game/chat/nearby/sse?mapId=${encodeURIComponent(nearbyMapId)}&scope=${encodeURIComponent(nearbyScope)}`,
        onMessage: (payload) => {
          if (!payload) {
            return;
          }

          if (payload.type === "connected") {
            // 重连后 SSE 会重灌历史：这里**不清空**列表，历史消息按 id / 幂等键合并，
            // 重复到达不会产生第二条，避免锁屏回来整段刷历史。
            setNearbyMapName(payload.mapName || payload.mapId || "");
            setNearbyCurrentDistrictName(payload.currentDistrictName || null);
            setNearbyCurrentDistrictRumor(payload.currentDistrictRumor || null);
            return;
          }

          if (payload.type === "nearby_message" && payload.data.mapId === nearbyMapId) {
            mergeNearbyMessages([payload.data]);
          }
        },
        onError: () => {
          channel?.close();
          channel = null;
          if (closed || retryTimer !== null) {
            return;
          }

          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (!closed) {
              connect();
            }
          }, 2000);
        },
      });
      if (!channel) {
        return;
      }
    };

    connect();

    return () => {
      closed = true;
      clearRetryTimer();
      channel?.close();
      channel = null;
    };
  }, [mergeNearbyMessages, nearbyMapId, nearbyScope, nearbySseDistrictKey]);

  useEffect(() => {
    let channel: ReturnType<typeof openJsonEventStream<SocialSseEvent>> | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const clearRetryTimer = () => {
      if (retryTimer === null) {
        return;
      }
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      channel?.close();
      channel = openJsonEventStream<SocialSseEvent>({
        url: "/api/game/social/sse",
        onMessage: (payload) => {
          if (!payload || payload.type === "connected") {
            return;
          }

          if (payload.type === "dm_message") {
            void fetchDmConversations(payload.data.conversationId);
            if (payload.data.conversationId === activeConversationId) {
              void fetchDmMessages(payload.data.conversationId);
            }
            void refreshNotifications();
            return;
          }

          if (payload.type === "friend_request" || payload.type === "friend_update") {
            void fetchFriends();
            void refreshNotifications();
            return;
          }

          if (payload.type === "intimacy_request" || payload.type === "intimacy_update") {
            void fetchIntimacy();
            void refreshNotifications();
            return;
          }

          if (payload.type === "notification") {
            void fetchNotifications();
            void refreshNotifications();
          }
        },
        onError: () => {
          channel?.close();
          channel = null;
          if (closed || retryTimer !== null) {
            return;
          }

          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (!closed) {
              connect();
            }
          }, 2000);
        },
      });
      if (!channel) {
          return;
        }
    };

    connect();

    return () => {
      closed = true;
      clearRetryTimer();
      channel?.close();
      channel = null;
    };
  }, [
    activeConversationId,
    fetchDmConversations,
    fetchDmMessages,
    fetchFriends,
    fetchIntimacy,
    fetchNotifications,
    refreshNotifications,
  ]);

  const sendWorldMessage = useCallback(async () => {
    const content = worldContent.trim();
    if (!content) {
      messageApi.warning("请输入聊天内容");
      return;
    }

    setWorldSending(true);
    try {
      const json = await readJson<{ message: ChatMessageItem }>("/api/game/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!json.success) {
        messageApi.error("发送天道传音失败");
        return;
      }

      setWorldContent("");
    } catch {
      messageApi.error("发送天道传音失败");
    } finally {
      setWorldSending(false);
    }
  }, [messageApi, worldContent]);

  const sendNearbyMessage = useCallback(async () => {
    const content = nearbyContent.trim();
    if (!content) {
      messageApi.warning("请输入聊天内容");
      return;
    }
    if (!nearbyMapId) {
      messageApi.warning("当前没有可用的附近频道地图");
      return;
    }

    setNearbySending(true);
    // 幂等键：弱网重试必须复用同一个 clientMessageId，否则会重复入库。
    const clientMessageId = createNearbyClientMessageId();
    try {
      const json = await readJson<{
        message: NearbyChatMessageItem;
        dedupeHit: boolean;
        stateRefreshFrames: AnyStateRefreshEnvelope[];
        mapName: string;
        scope: NearbyChatScope;
        currentDistrictName: string | null;
        currentDistrictRumor: NearbyDistrictRumorItem | null;
        storageMode: "database" | "memory";
      }>("/api/game/chat/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          mapId: nearbyMapId,
          scope: nearbyScope,
          clientMessageId,
        }),
      });

      if (!json.success) {
        messageApi.error(json.error || "发送附近消息失败");
        return;
      }

      setNearbyMapName(json.data?.mapName || nearbyMapName || nearbyMapId);
      setNearbyCurrentDistrictName(json.data?.currentDistrictName || null);
      setNearbyCurrentDistrictRumor(json.data?.currentDistrictRumor || null);
      applyStateRefreshFramesFromResponse(json.data?.stateRefreshFrames, applyNearbyProgressFrame);

      // 核心 API 是唯一持久化入口：先把持久化结果合入列表并登记幂等键，
      // 后续 SSE 回灌与房间回声都会命中去重，保证只渲染一次。
      if (json.data?.message) {
        mergeNearbyMessages([json.data.message]);
      }

      socialRoomPresence.sendNearbyMessage(content, {
        messageId: json.data?.message?.id ?? null,
        dedupeKey: json.data?.message?.dedupeKey ?? null,
      });
      setNearbyContent("");
    } catch {
      messageApi.error("发送附近消息失败");
    } finally {
      setNearbySending(false);
    }
  }, [
    applyNearbyProgressFrame,
    mergeNearbyMessages,
    messageApi,
    nearbyContent,
    nearbyMapId,
    nearbyMapName,
    nearbyScope,
    socialRoomPresence,
  ]);

  const requestFriend = useCallback(async () => {
    const target = friendTargetInput.trim();
    if (!target) {
      messageApi.warning("请输入玩家 ID 或昵称");
      return;
    }

    try {
      const json = await readJson<{ friendship: unknown }>("/api/game/social/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId: target, targetName: target }),
      });

      if (!json.success) {
        messageApi.error("发起好友申请失败");
        return;
      }

      messageApi.success("好友申请已发送");
      setFriendTargetInput("");
      await fetchFriends();
      await refreshNotifications();
    } catch {
      messageApi.error("发起好友申请失败");
    }
  }, [fetchFriends, friendTargetInput, messageApi, refreshNotifications]);

  const respondFriendRequest = useCallback(async (friendshipId: number, action: "accept" | "reject") => {
    try {
      const json = await readJson<{ friendship: unknown }>("/api/game/social/friends/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendshipId, action }),
      });

      if (!json.success) {
        messageApi.error(action === "accept" ? "同意好友申请失败" : "拒绝好友申请失败");
        return;
      }

      messageApi.success(action === "accept" ? "已添加为好友" : "已拒绝好友申请");
      await fetchFriends();
      await fetchIntimacy();
      await refreshNotifications();
    } catch {
      messageApi.error(action === "accept" ? "同意好友申请失败" : "拒绝好友申请失败");
    }
  }, [fetchFriends, fetchIntimacy, messageApi, refreshNotifications]);

  const removeFriend = useCallback(async (friendshipId: number) => {
    try {
      const json = await readJson<unknown>("/api/game/social/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendshipId }),
      });

      if (!json.success) {
        messageApi.error("解除好友关系失败");
        return;
      }

      messageApi.success("已解除好友关系");
      await fetchFriends();
      await fetchIntimacy();
      await refreshNotifications();
    } catch {
      messageApi.error("解除好友关系失败");
    }
  }, [fetchFriends, fetchIntimacy, messageApi, refreshNotifications]);

  const requestIntimacy = useCallback(async () => {
    const target = intimacyTargetInput.trim();
    if (!target) {
      messageApi.warning("请输入好友 ID 或昵称");
      return;
    }

    try {
      const json = await readJson<{ relation: unknown }>("/api/game/social/intimacy/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPlayerId: target,
          targetName: target,
          relationType: intimacyType,
        }),
      });

      if (!json.success) {
        messageApi.error("发起亲密关系申请失败");
        return;
      }

      messageApi.success("亲密关系申请已发送");
      setIntimacyTargetInput("");
      await fetchIntimacy();
      await refreshNotifications();
    } catch {
      messageApi.error("发起亲密关系申请失败");
    }
  }, [fetchIntimacy, intimacyTargetInput, intimacyType, messageApi, refreshNotifications]);

  const respondIntimacyRequest = useCallback(async (relationId: number, action: "accept" | "reject") => {
    try {
      const json = await readJson<{ relation: unknown }>("/api/game/social/intimacy/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationId, action }),
      });

      if (!json.success) {
        messageApi.error(action === "accept" ? "同意亲密关系失败" : "拒绝亲密关系失败");
        return;
      }

      messageApi.success(action === "accept" ? "亲密关系已建立" : "已拒绝亲密关系申请");
      await fetchIntimacy();
      await refreshNotifications();
    } catch {
      messageApi.error(action === "accept" ? "同意亲密关系失败" : "拒绝亲密关系失败");
    }
  }, [fetchIntimacy, messageApi, refreshNotifications]);

  const removeIntimacy = useCallback(async (relationId: number) => {
    try {
      const json = await readJson<unknown>("/api/game/social/intimacy/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationId }),
      });

      if (!json.success) {
        messageApi.error("解除亲密关系失败");
        return;
      }

      messageApi.success("已解除亲密关系");
      await fetchIntimacy();
      await refreshNotifications();
    } catch {
      messageApi.error("解除亲密关系失败");
    }
  }, [fetchIntimacy, messageApi, refreshNotifications]);

  const claimNotification = useCallback(async (mailId: number, hasReward: boolean) => {
    setNotificationClaimingId(mailId);
    try {
      const json = await readJson<{ reward: NotificationItem["reward"] }>("/api/game/mail/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailId }),
      });

      if (!json.success) {
        messageApi.error(hasReward ? "领取奖励失败" : "标记已读失败");
        return;
      }

      const rewardSummary = buildNotificationRewardSummary(json.data?.reward || {});
      if (hasReward) {
        messageApi.success(rewardSummary ? `领取成功：${rewardSummary}` : "领取成功");
      } else {
        messageApi.success("已标记为已读");
      }

      await fetchNotifications();
      await refreshNotifications();
    } catch {
      messageApi.error(hasReward ? "领取奖励失败" : "标记已读失败");
    } finally {
      setNotificationClaimingId(null);
    }
  }, [fetchNotifications, messageApi, refreshNotifications]);

  const deleteNotification = useCallback(async (mailId: number) => {
    setNotificationDeletingId(mailId);
    try {
      const json = await readJson<unknown>("/api/game/mail/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailId }),
      });

      if (!json.success) {
        messageApi.error("删除通知失败");
        return;
      }

      messageApi.success("通知已删除");
      await fetchNotifications();
      await refreshNotifications();
    } catch {
      messageApi.error("删除通知失败");
    } finally {
      setNotificationDeletingId(null);
    }
  }, [fetchNotifications, messageApi, refreshNotifications]);

  const saveDmPermission = useCallback(async () => {
    setDmPermissionSaving(true);
    try {
      const json = await readJson<{ dmPermission: DmPermission }>("/api/game/social/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmPermission }),
      });

      if (!json.success) {
        messageApi.error("保存私聊设置失败");
        return;
      }

      messageApi.success("私聊设置已保存");
    } catch {
      messageApi.error("保存私聊设置失败");
    } finally {
      setDmPermissionSaving(false);
    }
  }, [dmPermission, messageApi]);

  const sendDmMessage = useCallback(async () => {
    const targetPlayerId = effectiveDmTargetId;
    const content = dmContent.trim();

    if (!targetPlayerId) {
      messageApi.warning("请选择会话或输入目标玩家 ID");
      return;
    }

    if (!content) {
      messageApi.warning("请输入私聊内容");
      return;
    }

    setDmSending(true);
    try {
      const json = await readJson<{ conversationId: string; message: DmMessageItem }>("/api/game/social/dm/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId, content }),
      });

      if (!json.success || !json.data) {
        messageApi.error("发送私聊失败");
        return;
      }

      setDmContent("");
      setDmTargetInput("");
      await fetchDmConversations(json.data.conversationId);
      await fetchDmMessages(json.data.conversationId);
      await refreshNotifications();
    } catch {
      messageApi.error("发送私聊失败");
    } finally {
      setDmSending(false);
    }
  }, [
    dmContent,
    effectiveDmTargetId,
    fetchDmConversations,
    fetchDmMessages,
    messageApi,
    refreshNotifications,
  ]);

  const renderPlayerNameButton = useCallback((playerId: string, playerName: string) => (
    <button
      type="button"
      onClick={() => openPlayerInfo(playerId)}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        color: "#e8e0d0",
        cursor: "pointer",
      }}
    >
      {playerName}
    </button>
  ), [openPlayerInfo]);

  const worldTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ ...innerPanelStyle, padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <MessageOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#a09880" }}>天道传音</Text>
          <DarkTag color="blue">发言 {worldMessages.length}</DarkTag>
        </div>
        <Button size="small" onClick={() => void fetchWorldMessages(false)}>刷新</Button>
      </div>

      <div ref={worldListRef} style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {worldLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
        ) : worldMessages.length === 0 ? (
          <Text style={{ color: "#6b6355" }}>当前还没有天道传音。</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {worldMessages.map((item) => (
              <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <PlayerAvatar
                  avatarImageUrl={item.avatarImageUrl}
                  avatarFrameImageUrl={item.avatarFrameImageUrl}
                  size={34}
                  fallbackText={item.senderName.slice(0, 1) || "修"}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {item.playerId ? renderPlayerNameButton(item.playerId, item.senderName) : <Text style={{ color: "#e8e0d0" }}>{item.senderName}</Text>}
                    <Text style={{ color: "#6b6355", fontSize: 11 }}>{formatTime(item.createdAt)}</Text>
                  </div>
                  <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap" }}>{item.content}</Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...innerPanelStyle, padding: 8, display: "flex", gap: 8 }}>
        <Input
          value={worldContent}
          maxLength={200}
          placeholder="输入天道传音内容"
          onChange={(event) => setWorldContent(event.target.value)}
          onPressEnter={() => void sendWorldMessage()}
        />
        <Button type="primary" icon={<SendOutlined />} loading={worldSending} onClick={() => void sendWorldMessage()}>
          发送
        </Button>
      </div>
    </div>
  );

  const nearbyTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ ...innerPanelStyle, padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <MessageOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#a09880" }}>附近频道</Text>
          <DarkTag color="blue">消息 {nearbyMessages.length}</DarkTag>
          {socialRoomPresence.status === "connected" ? (
            <DarkTag color="green">同图 {socialRoomPresence.nearbyPlayers.length}</DarkTag>
          ) : (
            <DarkTag color="default">实时 {socialRoomPresence.status === "idle" ? "待加入" : "同步中"}</DarkTag>
          )}
          {nearbyMapId ? <DarkTag color="default">{nearbyMapName || "当前地图"}</DarkTag> : null}
          {nearbyActivityVersion > 0 ? <DarkTag color="cyan">动态 {nearbyActivityVersion}</DarkTag> : null}
          <DarkTag color={nearbyScope === "district" ? "gold" : "blue"}>{nearbyScope === "district" ? "街区视角" : "全图视角"}</DarkTag>
          {nearbyCurrentDistrictName ? <DarkTag color="purple">{nearbyCurrentDistrictName}</DarkTag> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Segmented
            size="small"
            value={nearbyScope}
            onChange={(value) => setNearbyScope(value as NearbyChatScope)}
            options={[
              { label: "全图", value: "map" },
              { label: "街区", value: "district" },
            ]}
          />
          <Button size="small" onClick={() => void fetchNearbyMessages(false)}>刷新</Button>
          <Button size="small" disabled={socialRoomPresence.status !== "connected"} onClick={() => socialRoomPresence.repair()}>同步</Button>
        </div>
      </div>

      {nearbyCurrentDistrictRumor ? (
        <div style={{ ...innerPanelStyle, padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <DarkTag color={nearbyCurrentDistrictRumor.heat === "high" ? "red" : (nearbyCurrentDistrictRumor.heat === "medium" ? "gold" : "blue")}>
              {nearbyCurrentDistrictRumor.heat === "high" ? "热闻" : (nearbyCurrentDistrictRumor.heat === "medium" ? "街闻" : "闲闻")}
            </DarkTag>
            <Text style={{ color: "#e8d282", fontWeight: 600 }}>{nearbyCurrentDistrictRumor.title}</Text>
            <Text style={{ color: "#7d7462", fontSize: 11 }}>{formatTime(nearbyCurrentDistrictRumor.updatedAt)}</Text>
          </div>
          <Text style={{ color: "#c9c1b1" }}>{nearbyCurrentDistrictRumor.content}</Text>
        </div>
      ) : null}

      <div ref={nearbyListRef} style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {nearbyLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
        ) : !nearbyMapId ? (
          <Text style={{ color: "#6b6355" }}>当前不在可用地图中，暂时无法使用附近频道。</Text>
        ) : nearbyScope === "district" && !nearbyCurrentDistrictName ? (
          <Text style={{ color: "#6b6355" }}>你当前所在位置尚未落入开放世界街区，暂时无法切到街区附近。</Text>
        ) : nearbyMessages.length === 0 ? (
          <Text style={{ color: "#6b6355" }}>
            {nearbyScope === "district" ? "当前街区还没有附近消息。" : "当前地图还没有附近消息。"}
          </Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {nearbyMessages.map((item) => (
              <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <PlayerAvatar
                  avatarImageUrl={item.avatarImageUrl}
                  avatarFrameImageUrl={item.avatarFrameImageUrl}
                  size={34}
                  fallbackText={item.senderName.slice(0, 1) || "近"}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {item.playerId ? renderPlayerNameButton(item.playerId, item.senderName) : <Text style={{ color: "#e8e0d0" }}>{item.senderName}</Text>}
                    {item.senderType !== "player" ? <DarkTag color="gold">{item.senderType === "npc" ? "NPC" : "天道"}</DarkTag> : null}
                    {item.districtName ? <DarkTag color="blue">{item.districtName}</DarkTag> : null}
                    <Text style={{ color: "#6b6355", fontSize: 11 }}>{formatTime(item.createdAt)}</Text>
                  </div>
                  <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap" }}>{item.content}</Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...innerPanelStyle, padding: 8, display: "flex", gap: 8 }}>
        <Input
          value={nearbyContent}
          maxLength={200}
          disabled={!nearbyMapId}
          placeholder={nearbyMapId ? (nearbyScope === "district" ? "输入当前街区的附近发言" : "输入当前地图的附近发言") : "当前地图不可发送附近消息"}
          onChange={(event) => setNearbyContent(event.target.value)}
          onPressEnter={() => void sendNearbyMessage()}
        />
        <Button type="primary" icon={<SendOutlined />} loading={nearbySending} disabled={!nearbyMapId} onClick={() => void sendNearbyMessage()}>
          发送
        </Button>
      </div>
    </div>
  );

  const systemTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ ...innerPanelStyle, padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <MailOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#a09880" }}>系统频道</Text>
          <DarkTag color="gold">公告 {systemMessages.length}</DarkTag>
        </div>
        <Button size="small" onClick={() => void fetchSystemMessages(false)}>刷新</Button>
      </div>

      <div ref={systemListRef} style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {systemLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
        ) : systemMessages.length === 0 ? (
          <Text style={{ color: "#6b6355" }}>当前还没有系统消息。</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {systemMessages.map((item) => (
              <div key={item.id} style={{ ...innerPanelStyle, padding: 10, background: "rgba(38, 30, 18, 0.72)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <Text style={{ color: "#e8d282", fontWeight: 600 }}>{item.senderName || "系统"}</Text>
                  <Text style={{ color: "#6b6355", fontSize: 11 }}>{formatTime(item.createdAt)}</Text>
                </div>
                <Text style={{ color: "#c9c1b1", display: "block", marginTop: 6, whiteSpace: "pre-wrap" }}>{item.content}</Text>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const dmTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ ...innerPanelStyle, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <MessageOutlined style={{ color: "#c9a84c" }} />
            <Text style={{ color: "#a09880" }}>私聊会话</Text>
            <DarkTag color={dmHasNotification ? "gold" : "default"}>未读 {dmConversations.reduce((sum, item) => sum + item.unreadCount, 0)}</DarkTag>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Select value={dmPermission} options={DM_PERMISSION_OPTIONS} onChange={(value: DmPermission) => setDmPermission(value)} style={{ width: 132 }} />
            <Button size="small" loading={dmPermissionSaving} onClick={() => void saveDmPermission()}>保存设置</Button>
            <Button size="small" onClick={() => void fetchDmConversations(undefined, true)}>刷新会话</Button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={dmTargetInput} onChange={(event) => setDmTargetInput(event.target.value)} placeholder="没有会话时，可输入目标玩家 ID" />
          <Button onClick={() => setTab("social")}>去社交页找人</Button>
        </div>
      </div>

      <SectionCard title="会话列表" icon={<MessageOutlined style={{ color: "#c9a84c" }} />} extra={<DarkTag color="blue">{dmConversations.length} 个会话</DarkTag>}>
        {dmLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spin /></div>
        ) : dmConversations.length === 0 ? (
          <Text style={{ color: "#6b6355" }}>暂无私聊会话，可先在社交中添加好友或直接输入玩家 ID。</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dmConversations.map((item) => {
              const active = item.id === activeConversationId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveConversationId(item.id);
                    setDmTargetInput("");
                  }}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${active ? "#c9a84c" : "#2a2520"}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    background: active ? "rgba(53, 41, 22, 0.75)" : "rgba(18, 18, 26, 0.72)",
                    color: "#e8e0d0",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <PlayerAvatar size={28} fallbackText={item.targetPlayerName.slice(0, 1) || "友"} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <span>{item.targetPlayerName}</span>
                          <Text style={{ color: "#6b6355", fontSize: 11 }}>{item.targetRealmName}</Text>
                        </div>
                        <Text style={{ color: "#a09880", display: "block", fontSize: 12 }} ellipsis>{item.lastMessagePreview || "暂无消息"}</Text>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <Text style={{ color: "#6b6355", fontSize: 11 }}>{formatTime(item.lastMessageAt)}</Text>
                      {item.unreadCount > 0 && <DarkTag color="gold">未读 {item.unreadCount}</DarkTag>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title={activeConversation ? `与 ${activeConversation.targetPlayerName} 的私聊` : "私聊内容"} icon={<SendOutlined style={{ color: "#c9a84c" }} />}>
        <div ref={dmListRef} style={{ ...panelStyle, minHeight: 240, maxHeight: 360, overflow: "auto", padding: 10, marginBottom: 8 }}>
          {dmMessagesLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spin /></div>
          ) : !activeConversation && !dmTargetInput.trim() ? (
            <Text style={{ color: "#6b6355" }}>请选择一个私聊会话，或输入玩家 ID 后直接发送。</Text>
          ) : dmMessages.length === 0 ? (
            <Text style={{ color: "#6b6355" }}>当前还没有私聊消息。</Text>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dmMessages.map((item) => {
                const isSelf = item.senderPlayerId === selfId;
                return (
                  <div key={item.id} style={{ display: "flex", justifyContent: isSelf ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "82%", borderRadius: 8, padding: "8px 10px", background: isSelf ? "rgba(74, 119, 157, 0.75)" : "rgba(26, 26, 46, 0.82)", border: "1px solid #2a2520" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>{isSelf ? "你" : item.senderName}</Text>
                        <Text style={{ color: "#6b6355", fontSize: 11 }}>{formatTime(item.createdAt)}</Text>
                      </div>
                      <Text style={{ color: "#c9c1b1", whiteSpace: "pre-wrap" }}>{item.content}</Text>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Input value={dmContent} maxLength={200} onChange={(event) => setDmContent(event.target.value)} placeholder={effectiveDmTargetId ? `发送给 ${effectiveDmTargetId}` : "输入私聊内容"} onPressEnter={() => void sendDmMessage()} />
          <Button type="primary" icon={<SendOutlined />} loading={dmSending} onClick={() => void sendDmMessage()}>发送</Button>
        </div>
      </SectionCard>
    </div>
  );

  const socialTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1, overflow: "auto" }}>
      <div style={{ ...innerPanelStyle, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <TeamOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#a09880" }}>社交</Text>
          <DarkTag color="blue">好友 {friendsAccepted.length}</DarkTag>
          <DarkTag color="magenta">亲密 {intimacyAccepted.length}</DarkTag>
          <DarkTag color="gold">待处理 {friendsIncoming.length + intimacyIncoming.length}</DarkTag>
          <DarkTag color="default">申请中 {friendsOutgoing.length + intimacyOutgoing.length}</DarkTag>
        </div>
        <Button size="small" onClick={() => { void fetchFriends(true); void fetchIntimacy(true); }}>刷新社交</Button>
      </div>

      <SectionCard title="添加好友" icon={<UserAddOutlined style={{ color: "#c9a84c" }} />}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={friendTargetInput} onChange={(event) => setFriendTargetInput(event.target.value)} placeholder="输入玩家 ID 或昵称" onPressEnter={() => void requestFriend()} />
          <Button type="primary" onClick={() => void requestFriend()}>发送申请</Button>
        </div>
      </SectionCard>

      <SectionCard title="绑定亲密关系" icon={<HeartOutlined style={{ color: "#c9a84c" }} />}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Input value={intimacyTargetInput} onChange={(event) => setIntimacyTargetInput(event.target.value)} placeholder="输入好友 ID 或昵称" onPressEnter={() => void requestIntimacy()} />
          <Select value={intimacyType} options={RELATION_TYPE_OPTIONS} onChange={(value: IntimacyRelationType) => setIntimacyType(value)} style={{ width: 120 }} />
          <Button type="primary" onClick={() => void requestIntimacy()}>发起绑定</Button>
        </div>
      </SectionCard>

      {friendsLoading || intimacyLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
      ) : (
        <>
          <SectionCard title={labelWithDot("好友申请", friendsIncoming.length > 0)} icon={<UserAddOutlined style={{ color: "#c9a84c" }} />} extra={<DarkTag color={friendsIncoming.length > 0 ? "gold" : "default"}>{friendsIncoming.length} 条</DarkTag>}>
            {friendsIncoming.length === 0 ? <Text style={{ color: "#6b6355" }}>当前没有待处理的好友申请。</Text> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {friendsIncoming.map((item) => (
                  <div key={item.id} style={{ ...panelStyle, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {renderPlayerNameButton(item.targetPlayerId, item.targetPlayerName)}
                        <Text style={{ color: "#6b6355", fontSize: 12 }}>{item.targetRealmName}</Text>
                      </div>
                      <Text style={{ color: "#6b6355", fontSize: 11 }}>申请时间：{formatTime(item.createdAt)}</Text>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="small" onClick={() => jumpToDm(item.targetPlayerId)}>私聊</Button>
                      <Button size="small" type="primary" onClick={() => void respondFriendRequest(item.id, "accept")}>同意</Button>
                      <Button size="small" danger onClick={() => void respondFriendRequest(item.id, "reject")}>拒绝</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={labelWithDot("亲密申请", intimacyIncoming.length > 0)} icon={<HeartOutlined style={{ color: "#c9a84c" }} />} extra={<DarkTag color={intimacyIncoming.length > 0 ? "gold" : "default"}>{intimacyIncoming.length} 条</DarkTag>}>
            {intimacyIncoming.length === 0 ? <Text style={{ color: "#6b6355" }}>当前没有待处理的亲密申请。</Text> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {intimacyIncoming.map((item) => (
                  <div key={item.id} style={{ ...panelStyle, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {renderPlayerNameButton(item.targetPlayerId, item.targetPlayerName)}
                        <DarkTag color="magenta">{relationTypeLabel(item.relationType)}</DarkTag>
                        <Text style={{ color: "#6b6355", fontSize: 12 }}>{item.targetRealmName}</Text>
                      </div>
                      <Text style={{ color: "#6b6355", fontSize: 11 }}>申请时间：{formatTime(item.createdAt)}</Text>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="small" onClick={() => jumpToDm(item.targetPlayerId)}>私聊</Button>
                      <Button size="small" type="primary" onClick={() => void respondIntimacyRequest(item.id, "accept")}>同意</Button>
                      <Button size="small" danger onClick={() => void respondIntimacyRequest(item.id, "reject")}>拒绝</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="好友列表" icon={<TeamOutlined style={{ color: "#c9a84c" }} />} extra={<DarkTag color="blue">{friendsAccepted.length} 人</DarkTag>}>
            {friendsAccepted.length === 0 ? <Text style={{ color: "#6b6355" }}>当前还没有好友。</Text> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {friendsAccepted.map((item) => (
                  <div key={item.id} style={{ ...panelStyle, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {renderPlayerNameButton(item.targetPlayerId, item.targetPlayerName)}
                        <Text style={{ color: "#6b6355", fontSize: 12 }}>{item.targetRealmName}</Text>
                      </div>
                      <Text style={{ color: "#6b6355", fontSize: 11 }}>成为好友：{formatTime(item.updatedAt || item.createdAt)}</Text>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="small" onClick={() => jumpToDm(item.targetPlayerId)}>私聊</Button>
                      <Button size="small" onClick={() => openPlayerInfo(item.targetPlayerId)}>资料</Button>
                      <Button size="small" danger onClick={() => void removeFriend(item.id)}>删除</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="亲密关系" icon={<HeartOutlined style={{ color: "#c9a84c" }} />} extra={<DarkTag color="magenta">{intimacyAccepted.length} 条</DarkTag>}>
            {intimacyAccepted.length === 0 ? <Text style={{ color: "#6b6355" }}>当前还没有亲密关系。</Text> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {intimacyAccepted.map((item) => (
                  <div key={item.id} style={{ ...panelStyle, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {renderPlayerNameButton(item.targetPlayerId, item.targetPlayerName)}
                        <DarkTag color="magenta">{relationTypeLabel(item.relationType)}</DarkTag>
                        <Text style={{ color: "#6b6355", fontSize: 12 }}>{item.targetRealmName}</Text>
                      </div>
                      <Text style={{ color: "#6b6355", fontSize: 11 }}>建立时间：{formatTime(item.updatedAt || item.createdAt)}</Text>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="small" onClick={() => jumpToDm(item.targetPlayerId)}>私聊</Button>
                      <Button size="small" onClick={() => openPlayerInfo(item.targetPlayerId)}>资料</Button>
                      <Button size="small" danger onClick={() => void removeIntimacy(item.id)}>解除</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );

  const notificationsTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ ...innerPanelStyle, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <MailOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#a09880" }}>消息通知</Text>
          <DarkTag color={unreadNotificationCount > 0 ? "gold" : "default"}>未读 {unreadNotificationCount}</DarkTag>
        </div>
        <Button size="small" onClick={() => void fetchNotifications(true)}>刷新通知</Button>
      </div>

      <div style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {notificationLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
        ) : notifications.length === 0 ? (
          <Text style={{ color: "#6b6355" }}>当前还没有通知消息。</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notifications.map((item) => {
              const hasReward = hasNotificationRewardValue(item.reward || {});
              const claimed = Boolean(item.claimedAt);
              const rewardSummary = buildNotificationRewardSummary(item.reward || {});
              const isPvpNotice = item.title.includes("切磋") || item.content.includes("击败");

              return (
                <div key={item.id} style={{ ...innerPanelStyle, padding: 10, borderColor: claimed ? "#2f6b45" : (isPvpNotice ? "#8b3a3a" : "#2a2520") }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>{item.title}</Text>
                      {isPvpNotice && <DarkTag color="red">野外 PVP</DarkTag>}
                    </div>
                    <DarkTag color={claimed ? "green" : "blue"}>{claimed ? "已读" : (hasReward ? "可领取" : "未读")}</DarkTag>
                  </div>

                  {item.content && <Text style={{ color: "#c9c1b1", display: "block", marginTop: 6, whiteSpace: "pre-wrap" }}>{item.content}</Text>}
                  {rewardSummary && <Text style={{ color: "#c9a84c", display: "block", marginTop: 6, fontSize: 12 }}>奖励：{rewardSummary}</Text>}
                  <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 6 }}>{formatTime(item.createdAt)}</Text>

                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Button size="small" type={claimed ? "default" : "primary"} disabled={claimed} loading={notificationClaimingId === item.id} onClick={() => void claimNotification(item.id, hasReward)}>
                      {claimed ? "已处理" : (hasReward ? "领取奖励" : "标记已读")}
                    </Button>
                    <Button size="small" danger disabled={!claimed} loading={notificationDeletingId === item.id} onClick={() => void deleteNotification(item.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const topTabs: Array<{ key: TabKey; label: ReactNode }> = [
    { key: "world", label: "天道传音" },
    { key: "nearby", label: "附近" },
    { key: "system", label: "系统" },
    { key: "dm", label: labelWithDot("私聊", dmHasNotification) },
    { key: "social", label: labelWithDot("社交", socialHasNotification) },
    { key: "notifications", label: labelWithDot("通知", notificationHasNotification) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, padding: 8 }}>
      {contextHolder}

      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Text style={{ color: "#c9a84c", fontSize: 12, fontWeight: 600 }}>频道切换</Text>
          <Text style={{ color: "#7d7462", fontSize: 11 }}>左右滑动切换频道</Text>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 2,
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          }}
          className="chat-top-tab-strip"
        >
          {topTabs.map((tabItem) => {
            const active = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                type="button"
                onClick={() => setTab(tabItem.key)}
                style={{
                  flexShrink: 0,
                  minHeight: 34,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: active ? "1px solid rgba(201, 168, 76, 0.42)" : "1px solid rgba(96, 110, 132, 0.18)",
                  background: active
                    ? "linear-gradient(180deg, rgba(58, 48, 22, 0.92) 0%, rgba(27, 24, 20, 0.94) 100%)"
                    : "linear-gradient(180deg, rgba(24, 28, 41, 0.78) 0%, rgba(16, 19, 28, 0.88) 100%)",
                  color: active ? "#f1de9c" : "#c5cfda",
                  boxShadow: active ? "0 8px 18px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.05)" : "inset 0 1px 0 rgba(255,255,255,0.03)",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {tabItem.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "world" && worldTab}
        {tab === "nearby" && nearbyTab}
        {tab === "system" && systemTab}
        {tab === "dm" && dmTab}
        {tab === "social" && socialTab}
        {tab === "notifications" && notificationsTab}
      </div>

      <PlayerInfoModal
        open={playerInfoOpen}
        playerId={selectedPlayerId}
        scope="public"
        onClose={() => setPlayerInfoOpen(false)}
        onPrivateChat={(playerId) => {
          setPlayerInfoOpen(false);
          jumpToDm(playerId);
        }}
      />
      <style jsx>{`
        .chat-top-tab-strip::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
