"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  BankOutlined,
  EnvironmentOutlined,
  GoldOutlined,
  MessageOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UserOutlined,
  GiftOutlined,
  UnorderedListOutlined,
  CrownOutlined,
  HeartOutlined,
} from "@ant-design/icons";
import { Modal, Progress, message } from "antd";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isCapacitorRuntime } from "@/modules/shared/services/client-runtime";
import NotificationDot from "@/modules/shared/ui/components/NotificationDot";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import { GameNotificationProvider, useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";
import {
  CULTIVATION_PAGE_BACKGROUND,
  GAME_PORTRAIT_STAGE_MAX_WIDTH,
  buildCultivationActionButtonStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

type GameTab = {
  key: string;
  label: string;
  icon: ReactNode;
  noticeKey?: "chat" | "character" | "activity" | "sect";
  comingSoon?: boolean;
};

const TABS: GameTab[] = [
  { key: "/game/map", label: "地图", icon: <EnvironmentOutlined /> },
  { key: "/game/chat", label: "聊天", icon: <MessageOutlined />, noticeKey: "chat" as const },
  { key: "/game/character", label: "角色", icon: <UserOutlined />, noticeKey: "character" as const },
  { key: "/game/quests", label: "任务", icon: <UnorderedListOutlined /> },
  { key: "/game/sect", label: "宗门", icon: <BankOutlined />, noticeKey: "sect" as const },
  { key: "/game/dongfu", label: "洞府", icon: <ThunderboltOutlined /> },
  { key: "/game/activity", label: "活动", icon: <GiftOutlined />, noticeKey: "activity" as const },
];
const DEFAULT_GAME_COMPACT_VIEWPORT = true;

type AuthMeResponse = {
  success: boolean;
  error?: string;
  maintenance?: boolean;
  data?: {
    name?: string;
    gender?: string | null;
    avatarImageUrl?: string | null;
    avatarFrameImageUrl?: string | null;
    realmName?: string | null;
    combatPower?: number;
    gold?: number;
    lingYu?: number;
    hp?: number;
    maxHp?: number;
    mp?: number;
    maxMp?: number;
    uterusStorageMl?: number | null;
    uterusCapacityMl?: number | null;
    pregnancyDisplayStatus?: {
      iconImageUrl?: string | null;
      title?: string;
      stageTitle?: string;
    } | null;
  };
};

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  data?: T;
};

type MeditationStartResponse = {
  startedAt: string;
  readyAt: string;
  durationMs: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
};

type MeditationClaimResponse = {
  percent: number;
  recoveredHp: number;
  recoveredMp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
};

type MeditationSessionState = MeditationStartResponse;

type UterusExpelSessionState = {
  startedAt: string;
  readyAt: string;
  durationMs: number;
  uterusStorageMl: number;
  uterusCapacityMl: number;
};

type DeploymentVersionResponse = {
  success: boolean;
  data?: {
    version?: string;
  };
};

function extractAsyncErrorMessage(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "message" in value) {
    const message = value.message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function isServerActionVersionMismatchMessage(value: unknown) {
  const normalized = extractAsyncErrorMessage(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes("failed to find server action")
    || (
      normalized.includes("server action")
      && normalized.includes("older or newer deployment")
    );
}

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <GameNotificationProvider>
      <GameLayoutShell>{children}</GameLayoutShell>
    </GameNotificationProvider>
  );
}

function GameLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    chatHasNotification,
    pluginHasNotification,
    activityHasNotification,
    marketHasNotification,
    sectHasNotification,
  } = useGameNotifications();
  const [topBarPlayer, setTopBarPlayer] = useState<AuthMeResponse["data"] | null>(null);
  const [versionUpdate, setVersionUpdate] = useState<{ current: string; latest: string } | null>(null);
  const [meditationSession, setMeditationSession] = useState<MeditationSessionState | null>(null);
  const [meditationPercent, setMeditationPercent] = useState(0);
  const [meditationSubmitting, setMeditationSubmitting] = useState(false);
  const [uterusExpelSession, setUterusExpelSession] = useState<UterusExpelSessionState | null>(null);
  const [uterusExpelPercent, setUterusExpelPercent] = useState(0);
  const [uterusExpelSubmitting, setUterusExpelSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [isCompactViewport, setIsCompactViewport] = useState(DEFAULT_GAME_COMPACT_VIEWPORT);
  const deploymentVersionRef = useRef<string | null>(null);
  const deploymentVersionRequestRef = useRef<Promise<string | null> | null>(null);
  const deploymentVersionCheckedAtRef = useRef(0);
  const topBarPlayerRef = useRef<AuthMeResponse["data"] | null>(null);
  const topBarPlayerFetchedAtRef = useRef(0);
  const topBarPlayerRequestRef = useRef<Promise<AuthMeResponse["data"] | null> | null>(null);

  useEffect(() => {
    topBarPlayerRef.current = topBarPlayer;
  }, [topBarPlayer]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsCompactViewport(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  const refreshTopBarPlayer = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    const now = Date.now();
    if (!force && topBarPlayerRef.current && now - topBarPlayerFetchedAtRef.current < 15_000) {
      return topBarPlayerRef.current;
    }
    if (!force && topBarPlayerRequestRef.current) {
      return topBarPlayerRequestRef.current;
    }

    const requestPromise = (async () => {
      const res = await fetch("/api/auth/me?view=summary", { cache: "no-store" });
      if (res.status === 503) {
        const json = await res.json() as AuthMeResponse;
        if (json.maintenance) {
          messageApi.warning(json.error || "服务器维护中，请稍后再入世。");
          router.replace("/create-character?maintenance=1");
        }
        return null;
      }
      if (res.status === 409) {
        router.replace("/select-character");
        return null;
      }
      if (res.status === 401) {
        router.replace("/login");
        return null;
      }
      if (!res.ok) {
        return null;
      }

      const json = await res.json() as AuthMeResponse;
      if (json.success && json.data) {
        setTopBarPlayer(json.data);
        topBarPlayerFetchedAtRef.current = Date.now();
        return json.data;
      }

      return null;
    })();

    topBarPlayerRequestRef.current = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (topBarPlayerRequestRef.current === requestPromise) {
        topBarPlayerRequestRef.current = null;
      }
    }
  }, [messageApi, router]);

  const checkDeploymentVersion = useCallback(async (options?: { force?: boolean }) => {
    if (typeof window === "undefined") {
      return null;
    }

    const force = options?.force === true;
    const now = Date.now();
    if (!force && deploymentVersionRef.current && now - deploymentVersionCheckedAtRef.current < 15_000) {
      return deploymentVersionRef.current;
    }
    if (!force && deploymentVersionRequestRef.current) {
      return deploymentVersionRequestRef.current;
    }

    deploymentVersionCheckedAtRef.current = now;

    const requestPromise = (async () => {
      const res = await fetch("/api/system/version", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) {
        return null;
      }

      const json = await res.json() as DeploymentVersionResponse;
      if (!json.success) {
        return null;
      }

      const nextVersion = String(json.data?.version || "").trim();
      if (!nextVersion) {
        return null;
      }

      if (!deploymentVersionRef.current) {
        deploymentVersionRef.current = nextVersion;
        return nextVersion;
      }

      if (deploymentVersionRef.current !== nextVersion) {
        setVersionUpdate({
          current: deploymentVersionRef.current,
          latest: nextVersion,
        });
      }

      return nextVersion;
    })();

    deploymentVersionRequestRef.current = requestPromise;
    try {
      return await requestPromise;
    } catch {
      return null;
    } finally {
      if (deploymentVersionRequestRef.current === requestPromise) {
        deploymentVersionRequestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function ensureCharacterSelected() {
      try {
        const player = await refreshTopBarPlayer({ force: topBarPlayer === null });
        if (cancelled || !player) return;
      } catch {
        // 网络异常时保持当前页面，不打断主流程
      }
    }

    void ensureCharacterSelected();
    return () => {
      cancelled = true;
    };
  }, [pathname, refreshTopBarPlayer, topBarPlayer]);

  useEffect(() => {
    const resetRepeatKillGuard = async () => {
      try {
        await fetch("/api/game/combat/repeat-guard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset" }),
        });
      } catch {
        // 重连复位失败时不打断主流程
      }
    };

    void resetRepeatKillGuard();
    window.addEventListener("online", resetRepeatKillGuard);
    return () => {
      window.removeEventListener("online", resetRepeatKillGuard);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || isCapacitorRuntime()) {
      return;
    }

    navigator.serviceWorker.register("/sw.js", {
      scope: "/game/",
      updateViaCache: "none",
    }).then((registration) => {
      void registration.update();
    }).catch(() => {
      // 注册失败时不影响主流程
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleVisibilityCheck = () => {
      if (document.visibilityState === "visible") {
        void checkDeploymentVersion({ force: true });
      }
    };

    const handleWindowFocus = () => {
      void checkDeploymentVersion({ force: true });
    };

    const handleWindowOnline = () => {
      void checkDeploymentVersion({ force: true });
    };

    void checkDeploymentVersion({ force: true });

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkDeploymentVersion();
      }
    }, 15000);

    document.addEventListener("visibilitychange", handleVisibilityCheck);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("online", handleWindowOnline);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityCheck);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("online", handleWindowOnline);
    };
  }, [checkDeploymentVersion]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleVersionMismatchError = (value: unknown) => {
      if (!isServerActionVersionMismatchMessage(value)) {
        return;
      }
      void checkDeploymentVersion({ force: true });
    };

    const handleWindowError = (event: ErrorEvent) => {
      handleVersionMismatchError(event.error || event.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      handleVersionMismatchError(event.reason);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [checkDeploymentVersion]);

  const handleRefreshForUpdate = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(async (registration) => {
          await registration.update();
        }));
      }

      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys
            .filter((key) => key.startsWith("pwa-"))
            .map((key) => caches.delete(key)),
        );
      }
    } catch {
      // 刷新前清理缓存失败时继续直接刷新
    }

    window.location.reload();
  };

  const stopMeditation = useCallback(async (action: "claim" | "cancel") => {
    if (!meditationSession || meditationSubmitting) {
      return;
    }

    setMeditationSubmitting(true);
    try {
      const res = await fetch("/api/game/meditation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json() as ApiResponse<MeditationClaimResponse>;

      if (!res.ok || !json.success) {
        messageApi.error(json.error || (action === "claim" ? "收功失败" : "停止打坐失败"));
        return;
      }

      if (action === "cancel") {
        setMeditationSession(null);
        setMeditationPercent(0);
        messageApi.info("已停止打坐");
        return;
      }

      if (json.data) {
        const claimData = json.data;
        setTopBarPlayer((current) => (
          current
            ? {
              ...current,
              hp: claimData.hp,
              maxHp: claimData.maxHp,
              mp: claimData.mp,
              maxMp: claimData.maxMp,
            }
            : current
        ));
        await refreshTopBarPlayer({ force: true });
        messageApi.success(`收功完成，恢复气血 ${claimData.recoveredHp}，恢复灵气 ${claimData.recoveredMp}（${claimData.percent}%）`);
      }

      setMeditationSession(null);
      setMeditationPercent(0);
    } catch {
      messageApi.error(action === "claim" ? "收功失败" : "停止打坐失败");
    } finally {
      setMeditationSubmitting(false);
    }
  }, [meditationSession, meditationSubmitting, messageApi, refreshTopBarPlayer]);

  const startMeditation = useCallback(async () => {
    if (meditationSubmitting || uterusExpelSession) {
      if (uterusExpelSession) {
        messageApi.warning("排精进行中，暂时无法开始打坐");
      }
      return;
    }

    setMeditationSubmitting(true);
    try {
      const res = await fetch("/api/game/meditation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const json = await res.json() as ApiResponse<MeditationStartResponse>;

      if (!res.ok || !json.success || !json.data) {
        messageApi.warning(json.error || "暂时无法开始打坐");
        return;
      }

      setMeditationSession(json.data);
      setMeditationPercent(0);
    } catch {
      messageApi.error("暂时无法开始打坐");
    } finally {
      setMeditationSubmitting(false);
    }
  }, [meditationSubmitting, messageApi, uterusExpelSession]);

  const claimUterusExpel = useCallback(async () => {
    if (!uterusExpelSession || uterusExpelSubmitting) {
      return;
    }

    setUterusExpelSubmitting(true);
    try {
      const res = await fetch("/api/game/uterus-expel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      });
      const json = await res.json() as ApiResponse<{
        expelledMl: number;
        reward?: {
          items?: Array<{
            itemId: string;
            quantity: number;
            itemName: string;
          }>;
        };
      }>;

      if (!res.ok || !json.success || !json.data) {
        messageApi.error(json.error || "排精失败");
        return;
      }

      const rewardItem = Array.isArray(json.data.reward?.items) ? json.data.reward?.items[0] : null;
      messageApi.success(
        rewardItem
          ? `排精完成，排出 ${json.data.expelledMl} ml，获得 ${rewardItem.quantity} 个「${rewardItem.itemName}」`
          : `排精完成，排出 ${json.data.expelledMl} ml`,
      );
      setUterusExpelSession(null);
      setUterusExpelPercent(0);
      await refreshTopBarPlayer({ force: true });
    } catch {
      messageApi.error("排精失败");
    } finally {
      setUterusExpelSubmitting(false);
    }
  }, [messageApi, refreshTopBarPlayer, uterusExpelSession, uterusExpelSubmitting]);

  const startUterusExpel = useCallback(async () => {
    if (uterusExpelSubmitting || meditationSession) {
      if (meditationSession) {
        messageApi.warning("打坐进行中，暂时无法开始排精");
      }
      return;
    }

    setUterusExpelSubmitting(true);
    try {
      const res = await fetch("/api/game/uterus-expel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const json = await res.json() as ApiResponse<UterusExpelSessionState>;
      if (!res.ok || !json.success || !json.data) {
        messageApi.error(json.error || "暂时无法开始排精");
        return;
      }
      setUterusExpelSession(json.data);
      setUterusExpelPercent(0);
    } catch {
      messageApi.error("暂时无法开始排精");
    } finally {
      setUterusExpelSubmitting(false);
    }
  }, [meditationSession, messageApi, uterusExpelSubmitting]);

  const cancelUterusExpel = useCallback(async () => {
    if (!uterusExpelSession || uterusExpelSubmitting) {
      return;
    }

    setUterusExpelSubmitting(true);
    try {
      await fetch("/api/game/uterus-expel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      setUterusExpelSession(null);
      setUterusExpelPercent(0);
    } catch {
      messageApi.error("取消排精失败");
    } finally {
      setUterusExpelSubmitting(false);
    }
  }, [messageApi, uterusExpelSession, uterusExpelSubmitting]);

  useEffect(() => {
    if (!meditationSession) {
      setMeditationPercent(0);
      return;
    }

    const tick = () => {
      const startedAtMs = Date.parse(meditationSession.startedAt);
      if (!Number.isFinite(startedAtMs)) {
        setMeditationPercent(0);
        return;
      }

      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      setMeditationPercent(Math.max(0, Math.min(100, Math.floor(elapsedMs / 600))));
    };

    tick();
    const timer = window.setInterval(tick, 200);
    return () => {
      window.clearInterval(timer);
    };
  }, [meditationSession]);

  useEffect(() => {
    if (!meditationSession || meditationSubmitting || meditationPercent < 100) {
      return;
    }

    void stopMeditation("claim");
  }, [meditationPercent, meditationSession, meditationSubmitting, stopMeditation]);

  useEffect(() => {
    if (!uterusExpelSession) {
      setUterusExpelPercent(0);
      return;
    }

    const tick = () => {
      const startedAtMs = Date.parse(uterusExpelSession.startedAt);
      if (!Number.isFinite(startedAtMs)) {
        setUterusExpelPercent(0);
        return;
      }
      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      setUterusExpelPercent(
        Math.max(0, Math.min(100, Math.floor((elapsedMs / uterusExpelSession.durationMs) * 100))),
      );
    };

    tick();
    const timer = window.setInterval(tick, 200);
    return () => {
      window.clearInterval(timer);
    };
  }, [uterusExpelSession]);

  useEffect(() => {
    if (!uterusExpelSession || uterusExpelSubmitting || uterusExpelPercent < 100) {
      return;
    }

    void claimUterusExpel();
  }, [claimUterusExpel, uterusExpelPercent, uterusExpelSession, uterusExpelSubmitting]);

  // 战斗/NPC/Boss页面不显示底部导航
  const hideNav = pathname.includes("/combat/")
    || pathname.includes("/npc/")
    || pathname.includes("/boss/")
    || pathname.includes("/pvp/");
  const isMapPage = pathname.startsWith("/game/map");
  const useCondensedMapTopBar = isMapPage && isCompactViewport;
  const showMeditationButton = pathname.startsWith("/game/map");
  const hasRetainedFluid = showMeditationButton
    && topBarPlayer?.gender === "女"
    && Math.max(0, Math.floor(Number(topBarPlayer?.uterusStorageMl || 0))) > 0;
  const displayName = topBarPlayer?.name?.trim() || "无名";
  const avatarText = displayName.slice(0, 1) || "修";
  const meditationSecondsLeft = meditationSession
    ? Math.max(0, Math.ceil((100 - meditationPercent) * 0.6))
    : 0;
  const uterusExpelSecondsLeft = uterusExpelSession
    ? Math.max(0, Math.ceil(((100 - uterusExpelPercent) * (uterusExpelSession.durationMs / 100)) / 1000))
    : 0;
  const quickStatStyle = {
    color: "#dccb96",
    fontSize: useCondensedMapTopBar ? 9 : 11,
    lineHeight: 1.2,
    display: "inline-flex",
    alignItems: "center",
    gap: useCondensedMapTopBar ? 2 : 3,
    height: useCondensedMapTopBar ? 19 : 24,
    padding: useCondensedMapTopBar ? "0 6px" : "0 9px",
    borderRadius: 999,
    background: "rgba(20, 28, 52, 0.92)",
    border: "1px solid rgba(76, 98, 158, 0.5)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  };
  const quickButtonStyle = {
    ...buildCultivationActionButtonStyle(),
    minWidth: 58,
    minHeight: useCondensedMapTopBar ? 26 : 34,
    height: useCondensedMapTopBar ? 26 : 34,
    padding: useCondensedMapTopBar ? "0 8px" : "0 10px",
    borderRadius: useCondensedMapTopBar ? 9 : 12,
    fontSize: useCondensedMapTopBar ? 9 : 11,
    boxShadow: "inset 0 1px 0 rgba(240, 248, 255, 0.05), 0 8px 18px rgba(7, 9, 18, 0.2)",
  } as const;
  const compactQuickButtonStyle = {
    ...quickButtonStyle,
    minWidth: 0,
    width: "100%",
    minHeight: useCondensedMapTopBar ? 26 : 34,
    padding: useCondensedMapTopBar ? "0 7px" : "0 9px",
    fontSize: useCondensedMapTopBar ? 9 : 11,
    gap: useCondensedMapTopBar ? 3 : 4,
    flexShrink: 0,
    whiteSpace: "nowrap",
  } as const;
  const compactQuickActionGridWidth = 156;
  const utilityQuickActionStackWidth = 76;
  const actionButtonMinWidth = hasRetainedFluid ? 54 : 64;
  const reserveExpelSlotWhileLoading = showMeditationButton && topBarPlayer === null;
  const showExpelQuickButton = showMeditationButton && (hasRetainedFluid || Boolean(uterusExpelSession) || reserveExpelSlotWhileLoading);
  const useCompactMeditationActions = showMeditationButton && isCompactViewport;
  const useStackedUtilityActions = !showMeditationButton && isCompactViewport;
  const topBarShellStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: useCondensedMapTopBar ? 4 : 10,
    flexWrap: useCondensedMapTopBar ? "nowrap" as const : "wrap" as const,
    padding: useCondensedMapTopBar ? "5px 6px" : "10px 11px",
    borderRadius: useCondensedMapTopBar ? 12 : 16,
    border: "1px solid rgba(118, 135, 160, 0.2)",
    background: "radial-gradient(circle at top center, rgba(201, 168, 76, 0.14), transparent 34%), linear-gradient(180deg, rgba(27, 32, 45, 0.96) 0%, rgba(14, 17, 26, 0.98) 100%)",
    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(240, 248, 255, 0.05)",
    position: "relative" as const,
    overflow: "hidden",
  };
  const topBarMainPanelStyle = {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: useCondensedMapTopBar ? 6 : 10,
    flex: 1,
    padding: useCondensedMapTopBar ? "6px 7px" : "10px 11px",
    borderRadius: useCondensedMapTopBar ? 10 : 14,
    border: "1px solid rgba(64, 76, 110, 0.78)",
    background: "linear-gradient(180deg, rgba(21, 26, 42, 0.96), rgba(11, 15, 27, 0.94))",
    boxShadow: "inset 0 1px 0 rgba(240, 248, 255, 0.05), 0 8px 18px rgba(4, 7, 16, 0.16)",
    position: "relative" as const,
    zIndex: 1,
  };
  const topBarActionPanelStyle = {
    display: useCondensedMapTopBar ? "grid" : (useCompactMeditationActions || useStackedUtilityActions ? "grid" : "flex"),
    alignItems: "center",
    justifyContent: "flex-end",
    gridTemplateColumns: useCondensedMapTopBar
      ? "repeat(2, minmax(0, 1fr))"
      : (useCompactMeditationActions ? "repeat(2, minmax(0, 1fr))" : (useStackedUtilityActions ? "minmax(0, 1fr)" : undefined)),
    gap: useCondensedMapTopBar ? 3 : (useStackedUtilityActions ? 5 : 6),
    flexShrink: 0,
    width: useCondensedMapTopBar ? 132 : (useCompactMeditationActions ? compactQuickActionGridWidth : (useStackedUtilityActions ? utilityQuickActionStackWidth : undefined)),
    maxWidth: useCondensedMapTopBar ? 132 : (useCompactMeditationActions ? compactQuickActionGridWidth : (useStackedUtilityActions ? utilityQuickActionStackWidth : undefined)),
    padding: useCondensedMapTopBar ? "4px" : (useStackedUtilityActions ? "5px" : "8px"),
    borderRadius: useCondensedMapTopBar ? 10 : 14,
    border: useCondensedMapTopBar ? "1px solid rgba(64, 76, 110, 0.72)" : "1px solid rgba(64, 76, 110, 0.72)",
    background: useCondensedMapTopBar ? "linear-gradient(180deg, rgba(18, 23, 38, 0.94), rgba(10, 13, 24, 0.92))" : "linear-gradient(180deg, rgba(18, 23, 38, 0.94), rgba(10, 13, 24, 0.92))",
    boxShadow: useCondensedMapTopBar ? "inset 0 1px 0 rgba(240, 248, 255, 0.04), 0 8px 18px rgba(4, 7, 16, 0.14)" : "inset 0 1px 0 rgba(240, 248, 255, 0.04), 0 8px 18px rgba(4, 7, 16, 0.14)",
    position: "relative" as const,
    zIndex: 1,
  };
  const navShellStyle = {
    display: "flex",
    gap: 5,
    padding: "9px 8px calc(max(var(--safe-area-bottom), 6px) + 5px)",
    borderTop: "1px solid rgba(86, 70, 43, 0.92)",
    background: "radial-gradient(circle at top center, rgba(201, 168, 76, 0.16), transparent 34%), linear-gradient(180deg, rgba(19, 20, 30, 0.98) 0%, rgba(10, 11, 16, 0.995) 100%)",
    boxShadow: "0 -12px 28px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(240, 248, 255, 0.04)",
    flexShrink: 0,
    position: "relative" as const,
    overflow: "hidden",
  };
  const handleTabPress = useCallback((tab: GameTab) => {
    if (tab.comingSoon) {
      messageApi.open({
        type: "info",
        content: "宗门系统敬请期待",
        duration: 1.5,
        style: {
          marginTop: 12,
        },
      });
      return;
    }
    router.push(tab.key);
  }, [messageApi, router]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "var(--app-height, 100dvh)",
      minHeight: "100dvh",
      maxWidth: GAME_PORTRAIT_STAGE_MAX_WIDTH,
      margin: "0 auto",
      background: CULTIVATION_PAGE_BACKGROUND,
      boxShadow: "0 0 0 1px rgba(201, 168, 76, 0.04), 0 20px 56px rgba(0, 0, 0, 0.34)",
    }}>
      {contextHolder}
      {versionUpdate && (
        <div style={{
          padding: "8px 8px 0",
          paddingTop: hideNav ? "calc(env(safe-area-inset-top, 0px) + 8px)" : 8,
          flexShrink: 0,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "9px 10px",
            borderRadius: 12,
            border: "1px solid rgba(201, 168, 76, 0.45)",
            background: "linear-gradient(180deg, rgba(58, 44, 18, 0.96) 0%, rgba(31, 24, 12, 0.96) 100%)",
            boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(250, 232, 172, 0.07)",
          }}>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "#f5df9d", fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                发现新版本
              </span>
              <span style={{ color: "#d9ceb0", fontSize: 11, lineHeight: 1.3 }}>
                页面已检测到容器升级，刷新后即可切换到最新版本。
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleRefreshForUpdate()}
              style={{
                minWidth: 76,
                height: 30,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid #8d6f2c",
                background: "#c9a84c",
                color: "#1a1408",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              立即刷新
            </button>
          </div>
        </div>
      )}
      {!hideNav && (
        <div style={{
          padding: useCondensedMapTopBar ? "4px 4px 2px" : "8px 8px 6px",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          flexShrink: 0,
        }}>
          <div style={topBarShellStyle}>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background: "radial-gradient(110% 80% at 50% -25%, rgba(201,168,76,0.18), rgba(201,168,76,0.02) 40%, rgba(0,0,0,0) 72%)",
              }}
            />
            <div style={topBarMainPanelStyle}>
              <PlayerAvatar
                size={useCondensedMapTopBar ? 22 : 34}
                avatarImageUrl={topBarPlayer?.avatarImageUrl}
                avatarFrameImageUrl={topBarPlayer?.avatarFrameImageUrl}
                fallbackText={avatarText}
                fallbackColor="#e8d282"
                fallbackFontWeight={600}
                borderColor="#8a7240"
                background="linear-gradient(180deg, rgba(78, 64, 31, 0.88), rgba(32, 24, 13, 0.92))"
              />
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{
                    color: "#f4ecda",
                    fontWeight: 600,
                    lineHeight: 1.1,
                    fontSize: useCondensedMapTopBar ? 11 : 15,
                    maxWidth: useCondensedMapTopBar ? 80 : 142,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textShadow: "0 1px 12px rgba(232, 210, 130, 0.16)",
                  }}>
                    {displayName}
                  </span>
                  <span style={quickStatStyle} title="战力">
                    <ThunderboltOutlined style={{ fontSize: 11, opacity: 0.9 }} />
                    {Number(topBarPlayer?.combatPower || 0).toLocaleString()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap", rowGap: 3 }}>
                  <span style={{
                    color: "#bfc9e4",
                    fontSize: useCondensedMapTopBar ? 9 : 11,
                    lineHeight: 1.2,
                    maxWidth: useCondensedMapTopBar ? 76 : 124,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {topBarPlayer?.realmName || "凡人"}
                  </span>
                  <span style={quickStatStyle} title="灵石">
                    <GoldOutlined style={{ fontSize: 11, opacity: 0.9 }} />
                    {Number(topBarPlayer?.gold || 0).toLocaleString()}
                  </span>
                  <span style={{
                    ...quickStatStyle,
                    color: "#78d0ab",
                    border: "1px solid rgba(70, 130, 99, 0.52)",
                    background: "rgba(20, 46, 35, 0.9)",
                  }} title="灵玉">
                    <CrownOutlined style={{ fontSize: 11, opacity: 0.9 }} />
                    {Number(topBarPlayer?.lingYu || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div style={topBarActionPanelStyle}>
              {useCompactMeditationActions ? (
                <>
                  <button
                    type="button"
                    onClick={() => void startMeditation()}
                    disabled={meditationSubmitting || Boolean(uterusExpelSession)}
                    style={{
                        ...compactQuickButtonStyle,
                        color: meditationSession ? "#f5df9d" : "#d9d1bd",
                        borderColor: meditationSession ? "#8d6f2c" : "#3b3428",
                        boxShadow: meditationSession
                          ? "0 10px 22px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.06)"
                          : compactQuickButtonStyle.boxShadow,
                        opacity: meditationSubmitting || uterusExpelSession ? 0.75 : 1,
                        cursor: meditationSubmitting || uterusExpelSession ? "wait" : "pointer",
                    }}
                  >
                    <ThunderboltOutlined />
                    <span>{meditationSession ? "打坐中" : "打坐"}</span>
                  </button>
                  {showExpelQuickButton && (
                    <button
                      type="button"
                      onClick={() => void startUterusExpel()}
                      disabled={topBarPlayer === null || uterusExpelSubmitting || Boolean(meditationSession)}
                      style={{
                        ...compactQuickButtonStyle,
                        color: uterusExpelSession ? "#ffd3e5" : "#f3d7de",
                        borderColor: uterusExpelSession ? "#d46a94" : "#5b3140",
                        background: uterusExpelSession
                          ? "linear-gradient(180deg, rgba(72, 22, 41, 0.96) 0%, rgba(36, 12, 22, 0.96) 100%)"
                          : "linear-gradient(180deg, rgba(43, 18, 29, 0.92) 0%, rgba(23, 11, 18, 0.92) 100%)",
                        boxShadow: "0 10px 22px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04)",
                        opacity: topBarPlayer === null || uterusExpelSubmitting || meditationSession ? 0.75 : 1,
                        cursor: topBarPlayer === null || uterusExpelSubmitting || meditationSession ? "wait" : "pointer",
                      }}
                    >
                      <HeartOutlined />
                      <span>{uterusExpelSession ? "排精中" : "排精"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.push("/game/market")}
                    style={{
                      ...compactQuickButtonStyle,
                      ...(pathname.startsWith("/game/market")
                        ? buildCultivationActionButtonStyle({ active: true })
                        : {}),
                      minWidth: 0,
                      width: "100%",
                      padding: compactQuickButtonStyle.padding,
                      fontSize: compactQuickButtonStyle.fontSize,
                      gap: compactQuickButtonStyle.gap,
                      minHeight: compactQuickButtonStyle.minHeight,
                    }}
                  >
                    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", lineHeight: 1, fontSize: useCondensedMapTopBar ? 10 : undefined }}>
                      <ShopOutlined />
                      {marketHasNotification && <NotificationDot />}
                    </span>
                    市场
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/game/rankings")}
                    style={{
                      ...compactQuickButtonStyle,
                      ...(pathname.startsWith("/game/rankings")
                        ? buildCultivationActionButtonStyle({ active: true })
                        : {}),
                      minWidth: 0,
                      width: "100%",
                      padding: compactQuickButtonStyle.padding,
                      fontSize: compactQuickButtonStyle.fontSize,
                      gap: compactQuickButtonStyle.gap,
                      minHeight: compactQuickButtonStyle.minHeight,
                    }}
                  >
                    <TrophyOutlined style={useCondensedMapTopBar ? { fontSize: 10 } : undefined} />
                    排行
                  </button>
                </>
              ) : (
                <>
                  {showMeditationButton && (
                    <button
                      type="button"
                      onClick={() => void startMeditation()}
                      disabled={meditationSubmitting || Boolean(uterusExpelSession)}
                      style={{
                        ...quickButtonStyle,
                        minWidth: actionButtonMinWidth,
                        color: meditationSession ? "#f5df9d" : "#d9d1bd",
                        borderColor: meditationSession ? "#8d6f2c" : "#3b3428",
                        boxShadow: meditationSession
                          ? "0 10px 22px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05)"
                          : quickButtonStyle.boxShadow,
                        opacity: meditationSubmitting || uterusExpelSession ? 0.75 : 1,
                        cursor: meditationSubmitting || uterusExpelSession ? "wait" : "pointer",
                      }}
                    >
                      <ThunderboltOutlined />
                      <span>{meditationSession ? "打坐中" : "打坐"}</span>
                    </button>
                  )}
                  {showExpelQuickButton && (
                    <button
                      type="button"
                      onClick={() => void startUterusExpel()}
                      disabled={uterusExpelSubmitting || Boolean(meditationSession)}
                      style={{
                        ...quickButtonStyle,
                        minWidth: actionButtonMinWidth,
                        color: uterusExpelSession ? "#ffd3e5" : "#f3d7de",
                        borderColor: uterusExpelSession ? "#d46a94" : "#5b3140",
                        background: uterusExpelSession
                          ? "linear-gradient(180deg, rgba(72, 22, 41, 0.96) 0%, rgba(36, 12, 22, 0.96) 100%)"
                          : "linear-gradient(180deg, rgba(43, 18, 29, 0.92) 0%, rgba(23, 11, 18, 0.92) 100%)",
                        boxShadow: "0 10px 22px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04)",
                        opacity: uterusExpelSubmitting || meditationSession ? 0.75 : 1,
                        cursor: uterusExpelSubmitting || meditationSession ? "wait" : "pointer",
                      }}
                    >
                      <HeartOutlined />
                      <span>{uterusExpelSession ? "排精中" : "排精"}</span>
                    </button>
                  )}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: useStackedUtilityActions ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
                    gap: useStackedUtilityActions ? 5 : 6,
                    minWidth: useStackedUtilityActions ? 0 : 118,
                  }}>
                    <button
                      type="button"
                      onClick={() => router.push("/game/market")}
                      style={{
                        ...quickButtonStyle,
                        ...(pathname.startsWith("/game/market")
                          ? buildCultivationActionButtonStyle({ active: true })
                          : {}),
                        minWidth: 0,
                        height: quickButtonStyle.height,
                        padding: useStackedUtilityActions ? "0 8px" : quickButtonStyle.padding,
                        fontSize: quickButtonStyle.fontSize,
                      }}
                    >
                      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", lineHeight: 1 }}>
                        <ShopOutlined />
                        {marketHasNotification && <NotificationDot />}
                      </span>
                      市场
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/game/rankings")}
                      style={{
                        ...quickButtonStyle,
                        ...(pathname.startsWith("/game/rankings")
                          ? buildCultivationActionButtonStyle({ active: true })
                          : {}),
                        minWidth: 0,
                        height: quickButtonStyle.height,
                        padding: useStackedUtilityActions ? "0 8px" : quickButtonStyle.padding,
                        fontSize: quickButtonStyle.fontSize,
                      }}
                    >
                      <TrophyOutlined style={useCondensedMapTopBar ? { fontSize: 10 } : undefined} />
                      排行
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <main style={{
        flex: 1,
        overflow: "auto",
        padding: hideNav ? 0 : undefined,
        background: "transparent",
      }}>
        {children}
      </main>

      {/* 底部导航 */}
      {!hideNav && (
        <nav style={navShellStyle}>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(90deg, rgba(240, 211, 138, 0.06), transparent 38%, rgba(110, 147, 255, 0.05))",
            }}
          />
          {TABS.map((tab) => {
            const active = !tab.comingSoon && (
              pathname === tab.key
              || pathname.startsWith(tab.key + "/")
              || (tab.key === "/game/character" && pathname.startsWith("/game/appearance"))
            );
            const showDot = tab.noticeKey === "chat"
              ? chatHasNotification
              : tab.noticeKey === "character"
                ? pluginHasNotification
                : tab.noticeKey === "sect"
                  ? sectHasNotification
                : tab.noticeKey === "activity"
                  ? activityHasNotification
                  : false;
            const tabButtonStyle = {
              background: active
                ? "radial-gradient(circle at top center, rgba(201, 168, 76, 0.18), transparent 52%), linear-gradient(180deg, rgba(63, 51, 24, 0.94) 0%, rgba(27, 24, 20, 0.92) 100%)"
                : "linear-gradient(180deg, rgba(20, 24, 38, 0.72) 0%, rgba(12, 15, 24, 0.88) 100%)",
              border: active ? "1px solid rgba(201, 168, 76, 0.34)" : "1px solid rgba(70, 82, 114, 0.22)",
              color: active ? "#f1de9c" : "#8f96ab",
              boxShadow: active
                ? "0 10px 18px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)"
                : "inset 0 1px 0 rgba(255,255,255,0.03)",
              transform: active ? "translateY(-1px)" : "translateY(0)",
            };
            return (
              <button
                key={tab.key}
                onClick={() => handleTabPress(tab)}
                aria-label={tab.comingSoon ? `${tab.label}，敬请期待` : tab.label}
                className="game-nav-button"
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 0 5px",
                  borderRadius: 16,
                  ...tabButtonStyle,
                  fontSize: 10,
                  cursor: "pointer",
                  gap: 3,
                  position: "relative",
                  zIndex: 1,
                  transition: "color 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
                }}
              >
                <span style={{
                  fontSize: 16,
                  position: "relative",
                  display: "inline-flex",
                  lineHeight: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 30,
                  minHeight: 26,
                  padding: active ? "4px 10px" : "4px 8px",
                  borderRadius: 999,
                  background: active ? "rgba(201, 168, 76, 0.14)" : "rgba(16, 20, 31, 0.48)",
                  boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "inset 0 1px 0 rgba(255,255,255,0.03)",
                  transition: "padding 0.2s ease, background 0.2s ease, box-shadow 0.2s ease",
                }}>
                  {tab.icon}
                  {showDot && <NotificationDot />}
                </span>
                <span style={{ whiteSpace: "nowrap", lineHeight: 1.1, fontWeight: active ? 600 : 500 }}>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}
      <Modal
        open={Boolean(meditationSession)}
        title="原地打坐"
        centered
        maskClosable={false}
        closable={!meditationSubmitting}
        onCancel={() => {
          if (!meditationSubmitting) {
            void stopMeditation("cancel");
          }
        }}
        okText="结束打坐并恢复"
        cancelText="取消打坐"
        okButtonProps={{
          loading: meditationSubmitting,
          disabled: meditationPercent < 1,
        }}
        cancelButtonProps={{
          disabled: meditationSubmitting,
        }}
        onOk={() => void stopMeditation("claim")}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "#6b6355", fontSize: 13, lineHeight: 1.7 }}>
            打坐进度会按真实耗时线性增长，满 100% 需要 60 秒，进行到一半时收功即可按 50% 恢复气血和灵气。
          </div>
          <Progress percent={meditationPercent} status={meditationPercent >= 100 ? "success" : "active"} />
          <div style={{ display: "grid", gap: 6, color: "#6b6355", fontSize: 13 }}>
            <span>当前进度：{meditationPercent}%</span>
            <span>剩余时间：{meditationSecondsLeft} 秒</span>
            <span>
              当前状态：气血 {Number(topBarPlayer?.hp ?? meditationSession?.hp ?? 0)}/{Number(topBarPlayer?.maxHp ?? meditationSession?.maxHp ?? 0)}，
              灵气 {Number(topBarPlayer?.mp ?? meditationSession?.mp ?? 0)}/{Number(topBarPlayer?.maxMp ?? meditationSession?.maxMp ?? 0)}
            </span>
          </div>
        </div>
      </Modal>
      <Modal
        open={Boolean(uterusExpelSession)}
        title="排精"
        centered
        maskClosable={false}
        closable={!uterusExpelSubmitting}
        onCancel={() => {
          if (!uterusExpelSubmitting) {
            void cancelUterusExpel();
          }
        }}
        okText="完成排精"
        cancelText="取消排精"
        okButtonProps={{
          loading: uterusExpelSubmitting,
          disabled: uterusExpelPercent < 100,
        }}
        cancelButtonProps={{
          disabled: uterusExpelSubmitting,
        }}
        onOk={() => void claimUterusExpel()}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "#6b6355", fontSize: 13, lineHeight: 1.7 }}>
            排精会按真实耗时推进，满 100% 需要 60 秒。完成后会随机排出 3-7 ml 留存精液，并转化为可入包的物品「精液」。
          </div>
          <Progress percent={uterusExpelPercent} status={uterusExpelPercent >= 100 ? "success" : "active"} strokeColor="#d46a94" />
          <div style={{ display: "grid", gap: 6, color: "#6b6355", fontSize: 13 }}>
            <span>当前进度：{uterusExpelPercent}%</span>
            <span>剩余时间：{uterusExpelSecondsLeft} 秒</span>
            <span>
              当前留存：{Math.max(0, Math.floor(Number(topBarPlayer?.uterusStorageMl || uterusExpelSession?.uterusStorageMl || 0)))} /
              {Math.max(1, Math.floor(Number(topBarPlayer?.uterusCapacityMl || uterusExpelSession?.uterusCapacityMl || 120)))} ml
            </span>
          </div>
        </div>
      </Modal>
      <style jsx global>{`
        @keyframes cultivation-page-reveal {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

      `}</style>
    </div>
  );
}
