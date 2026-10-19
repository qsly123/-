"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openJsonEventStream } from "@/modules/shared/services/realtime-channel";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
};

type NotificationState = {
  dmUnreadCount: number;
  friendIncomingCount: number;
  intimacyIncomingCount: number;
  pluginBadgeMap: Record<string, number>;
  mailUnreadCount: number;
  marketUnreadCount: number;
  checkinCanClaim: boolean;
  wildWolfValleyAttention: boolean;
  worldDangerCount: number;
  worldBountyActive: boolean;
  worldRumorUnread: number;
  sectIncomingCount: number;
  sectVisitorIncomingCount: number;
  sectHasNotification: boolean;
};

type SocialSseEvent =
  | { type: "connected"; data?: unknown }
  | { type: "dm_message"; data: unknown }
  | { type: "friend_request"; data: unknown }
  | { type: "friend_update"; data: unknown }
  | { type: "intimacy_request"; data: unknown }
  | { type: "intimacy_update"; data: unknown }
  | { type: "market_trade_sold"; data: unknown }
  | { type: "notification"; data: unknown };

type GameNotificationContextValue = NotificationState & {
  chatHasNotification: boolean;
  dmHasNotification: boolean;
  friendHasNotification: boolean;
  intimacyHasNotification: boolean;
  socialHasNotification: boolean;
  pluginHasNotification: boolean;
  notificationHasNotification: boolean;
  mailHasNotification: boolean;
  marketHasNotification: boolean;
  activityHasNotification: boolean;
  sectHasNotification: boolean;
  refreshNotifications: () => Promise<void>;
};

const EMPTY_NOTIFICATION_STATE: NotificationState = {
  dmUnreadCount: 0,
  friendIncomingCount: 0,
  intimacyIncomingCount: 0,
  pluginBadgeMap: {},
  mailUnreadCount: 0,
  marketUnreadCount: 0,
  checkinCanClaim: false,
  wildWolfValleyAttention: false,
  worldDangerCount: 0,
  worldBountyActive: false,
  worldRumorUnread: 0,
  sectIncomingCount: 0,
  sectVisitorIncomingCount: 0,
  sectHasNotification: false,
};

const GameNotificationContext = createContext<GameNotificationContextValue | null>(null);
const AUTO_FULL_REFRESH_INTERVAL_MS = 5_000;
const AUTO_SOCIAL_REFRESH_INTERVAL_MS = 2_500;
const AUTO_PASSIVE_REFRESH_INTERVAL_MS = 15_000;

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

async function fetchNotificationSummary() {
  try {
    const res = await fetch("/api/game/notifications/summary", { cache: "no-store" });
    const json = await res.json() as ApiResponse<NotificationState>;
    if (!json.success || !json.data) {
      return null;
    }
    return {
      ...EMPTY_NOTIFICATION_STATE,
      ...json.data,
      pluginBadgeMap: json.data.pluginBadgeMap || {},
    };
  } catch {
    return null;
  }
}

export function GameNotificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NotificationState>(EMPTY_NOTIFICATION_STATE);
  const refreshStartedAtRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const pageVisibleRef = useRef(true);
  const pendingVisibleRefreshRef = useRef(false);

  const applyNotificationState = useCallback((summary: NotificationState | null, options?: { merge?: boolean }) => {
    if (!summary) {
      return;
    }

    if (options?.merge) {
      setState((prev) => ({
        ...prev,
        ...summary,
      }));
      return;
    }

    setState(summary);
  }, []);

  const refreshSummary = useCallback(async (options?: { force?: boolean; minIntervalMs?: number }) => {
    const force = options?.force ?? true;
    const minIntervalMs = options?.minIntervalMs ?? AUTO_FULL_REFRESH_INTERVAL_MS;
    const now = Date.now();
    if (!force && !pageVisibleRef.current) {
      pendingVisibleRefreshRef.current = true;
      return;
    }
    if (!force && refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    if (!force && now - refreshStartedAtRef.current < minIntervalMs) {
      return;
    }

    refreshStartedAtRef.current = now;
    const refreshPromise = (async () => {
      const summary = await fetchNotificationSummary();
      applyNotificationState(summary);
    })();

    refreshPromiseRef.current = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (refreshPromiseRef.current === refreshPromise) {
        refreshPromiseRef.current = null;
      }
    }
  }, [applyNotificationState]);

  const refreshSocialNotifications = useCallback(async (force = true) => {
    return await refreshSummary({
      force,
      minIntervalMs: AUTO_SOCIAL_REFRESH_INTERVAL_MS,
    });
  }, [refreshSummary]);

  const refreshNotifications = useCallback(async (force = true) => {
    return await refreshSummary({
      force,
      minIntervalMs: AUTO_FULL_REFRESH_INTERVAL_MS,
    });
  }, [refreshSummary]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshNotifications(false);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    pageVisibleRef.current = isDocumentVisible();

    const handleFocus = () => {
      pageVisibleRef.current = true;
      void refreshNotifications(false);
    };

    const handleVisibilityChange = () => {
      pageVisibleRef.current = isDocumentVisible();
      if (!pageVisibleRef.current || !pendingVisibleRefreshRef.current) {
        return;
      }
      pendingVisibleRefreshRef.current = false;
      void refreshNotifications(false);
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshNotifications(false);
    }, AUTO_PASSIVE_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    let channel: { close: () => void } | null = null;
    let closed = false;
    let retryTimer: number | null = null;

    const clearRetryTimer = () => {
      if (retryTimer === null) {
        return;
      }
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      channel = openJsonEventStream<SocialSseEvent>({
        url: "/api/game/social/sse",
        onMessage: (payload) => {
          if (!payload || payload.type === "connected") {
            return;
          }

          if (payload.type === "market_trade_sold" || payload.type === "notification") {
            void refreshNotifications(false);
            return;
          }

          if (
            payload.type === "dm_message"
            || payload.type === "friend_request"
            || payload.type === "friend_update"
            || payload.type === "intimacy_request"
            || payload.type === "intimacy_update"
          ) {
            void refreshSocialNotifications(false);
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
    };

    connect();

    return () => {
      closed = true;
      clearRetryTimer();
      channel?.close();
      channel = null;
    };
  }, [refreshNotifications, refreshSocialNotifications]);

  const value = useMemo<GameNotificationContextValue>(() => {
    const dmHasNotification = state.dmUnreadCount > 0;
    const friendHasNotification = state.friendIncomingCount > 0;
    const intimacyHasNotification = state.intimacyIncomingCount > 0;
    const socialHasNotification = friendHasNotification || intimacyHasNotification;
    const pluginHasNotification = Object.values(state.pluginBadgeMap).some((count) => Number(count || 0) > 0);
    const mailHasNotification = state.mailUnreadCount > 0;
    // 聊天页“通知”标签当前只展示站内信/邮件，不直接展示世界压力与风声内容。
    // 在专属世界通知面板落地前，红点只跟真实可读消息绑定，避免出现“有红点但列表为空”。
    const notificationHasNotification = mailHasNotification;
    const marketHasNotification = state.marketUnreadCount > 0;
    const sectHasNotification = state.sectHasNotification || state.sectIncomingCount > 0 || state.sectVisitorIncomingCount > 0;
    const chatHasNotification = dmHasNotification
      || socialHasNotification
      || notificationHasNotification
      || state.wildWolfValleyAttention;
    const activityHasNotification = state.checkinCanClaim;

    return {
      ...state,
      chatHasNotification,
      dmHasNotification,
      friendHasNotification,
      intimacyHasNotification,
      socialHasNotification,
      pluginHasNotification,
      notificationHasNotification,
      mailHasNotification,
      marketHasNotification,
      activityHasNotification,
      sectHasNotification,
      refreshNotifications,
    };
  }, [state, refreshNotifications]);

  return (
    <GameNotificationContext.Provider value={value}>
      {children}
    </GameNotificationContext.Provider>
  );
}

export function useGameNotifications() {
  const context = useContext(GameNotificationContext);
  if (!context) {
    throw new Error("useGameNotifications 必须在 GameNotificationProvider 内使用");
  }
  return context;
}
