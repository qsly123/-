"use client";

import type React from "react";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, message } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import type { RealtimeInputAck } from "@immortality/shared-protocol";
import BattlePageStateCard from "@/modules/combat/ui/components/BattlePageStateCard";
import BattleActionPanel from "@/modules/combat/ui/components/BattleActionPanel";
import BattleViewHeaderCard from "@/modules/combat/ui/components/BattleViewHeaderCard";
import BattleStageBackdropCanvas from "@/modules/combat/ui/components/BattleStageBackdropCanvas";
import BattleStageEntityCanvas from "@/modules/combat/ui/components/BattleStageEntityCanvas";
import CombatPhaserScene from "@/modules/combat/ui/components/CombatPhaserScene";
import CompactCombatUnitStatusCard from "@/modules/combat/ui/components/CompactCombatUnitStatusCard";
import CombatLogFloatingPanel from "@/modules/combat/ui/components/CombatLogFloatingPanel";
import UnifiedBattleShell from "@/modules/combat/ui/components/UnifiedBattleShell";
import { COMBAT_SOLO_MOVEMENT_ENABLED } from "@/modules/combat/services/combat-scene-config";
import {
  clampCombatScenePlayerYPercent,
  clampCombatSceneXPercent,
  getCombatScenePositions,
  resolveCombatActorAutoMovementPlan,
  resolveCombatSkillContact,
} from "@/modules/combat/services/combat-spatial";
import {
  useCombatSceneController,
  type CombatActionApiResponse,
  type SkillView,
} from "@/modules/combat/ui/hooks/useCombatSceneController";
import {
  formatInventorySyncHint,
  useCombatConsumableInventory,
} from "@/modules/combat/ui/hooks/useCombatConsumableInventory";
import { applyStateRefreshFramesFromResponse } from "@/modules/shared/ui/hooks/useStateRefreshFrames";
import {
  pickCombatAutoActionDecision,
  pickCombatAutoMovementAnchorSkillId,
} from "@/modules/combat/services/combat-ai";
import { getSkillVisualEffectDurationMs } from "@/modules/shared/services/skill-visual-effect";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import RewardDropList from "@/modules/shared/ui/components/RewardDropList";
import type {
  CombatLogEntry,
  CombatRepeatGuardPayload,
  CombatSkillVisualEffect,
  CombatState,
  CombatUnit,
} from "@/types/game";

type DropView = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  quantity: number;
  itemRarity?: string | null;
};

type SettleApiResponse = {
  success?: boolean;
  error?: string;
  data?: {
    xp?: number;
    gold?: number;
    drops?: DropView[];
    noRewardReason?: string;
    antiRepeatGuard?: CombatRepeatGuardPayload;
    died?: boolean;
    fled?: boolean;
    message?: string;
  };
};

type PopupState = {
  id: number;
  targetId: string;
  label: string;
  kind: "damage" | "heal" | "system";
  createdAtMs: number;
  durationMs: number;
};

type MotionState = {
  id: number;
  actorId: string;
  targetId: string;
  entryType: NonNullable<CombatLogEntry["entryType"]>;
  visualEffect?: CombatSkillVisualEffect | null;
  durationMs: number;
};

type CombatMoveTarget = {
  xPercent: number;
  yPercent: number;
};

function normalizeCombatRecoveryCode(errorCode?: unknown) {
  return typeof errorCode === "string" && errorCode.trim() ? errorCode.trim().toUpperCase() : "UNKNOWN_COMBAT_ERROR";
}

const COMBAT_SETTLE_RETRY_LIMIT = 4;
const COMBAT_SETTLE_RETRY_BASE_DELAY_MS = 350;
const COMBAT_PHASER_SCENE_ENABLED = process.env.NEXT_PUBLIC_COMBAT_PHASER_SCENE === "1";

function shouldUseColyseusCombatAction() {
  return true;
}

function isCombatFinishedPayload(data?: CombatActionApiResponse["data"] | null) {
  return data?.state?.status && data.state.status !== "ongoing";
}

function mapCombatAckReasonToErrorCode(reason?: string) {
  if (reason === "stale_state" || reason === "already_processed") {
    return "COMBAT_SCENE_STALE";
  }
  if (reason === "entity_missing") {
    return "COMBAT_SESSION_MISSING";
  }
  if (reason === "settlement_pending") {
    return "COMBAT_SESSION_FINISHED";
  }
  return reason ? reason.toUpperCase() : undefined;
}

function buildCombatActionResponseFromAck(ack: RealtimeInputAck): CombatActionApiResponse {
  const authoritativeState = ack.authoritativeState as Partial<{
    state: CombatState;
    sceneSnapshot: unknown;
    battleView: unknown;
    turnState: unknown;
    acceptedClientSequence: number;
    message: string | null;
  }> | undefined;
  return {
    success: ack.accepted,
    error: ack.accepted ? undefined : authoritativeState?.message || "战斗执行失败",
    errorCode: ack.accepted ? undefined : mapCombatAckReasonToErrorCode(ack.reason),
    data: {
      state: authoritativeState?.state,
      sceneSnapshot: authoritativeState?.sceneSnapshot as NonNullable<CombatActionApiResponse["data"]>["sceneSnapshot"],
      battleView: authoritativeState?.battleView as NonNullable<CombatActionApiResponse["data"]>["battleView"],
      turnState: authoritativeState?.turnState as NonNullable<CombatActionApiResponse["data"]>["turnState"],
      acceptedClientSequence: authoritativeState?.acceptedClientSequence ?? ack.acceptedSequence,
    },
  };
}

function buildCombatRealtimeUnavailableResponse(messageText: string): CombatActionApiResponse {
  return {
    success: false,
    error: messageText,
    errorCode: "COMBAT_REALTIME_UNAVAILABLE",
    data: {},
  };
}

async function readCombatActionResponse(response: Response, fallbackError: string): Promise<CombatActionApiResponse> {
  const text = await response.text();
  let json: CombatActionApiResponse | null = null;
  try {
    json = text ? JSON.parse(text) as CombatActionApiResponse : null;
  } catch {
    json = null;
  }
  if (response.ok && json) {
    return json;
  }
  return {
    success: false,
    error: json?.error || fallbackError,
    errorCode: json?.errorCode,
    data: json?.data || {},
  };
}

function shouldRetryCombatSettle(status: number) {
  return status === 409 || status >= 500;
}

function clampMovePercent(value: number) {
  return Math.round(clampCombatSceneXPercent(value));
}

function clampMoveTarget(target: CombatMoveTarget) {
  return {
    xPercent: clampMovePercent(target.xPercent),
    yPercent: Math.round(clampCombatScenePlayerYPercent(target.yPercent)),
  } satisfies CombatMoveTarget;
}

function getOrbFallbackText(unit: CombatUnit) {
  const compactName = unit.name.replace(/\s+/g, "");
  return compactName ? compactName.slice(0, Math.min(2, compactName.length)) : unit.isPlayer ? "修士" : "敌手";
}

function renderSettleRewardContent(data: NonNullable<SettleApiResponse["data"]>) {
  return (
    <div>
      <p>获得修为：{data.xp ?? 0}</p>
      <p>获得灵石：{data.gold ?? 0}</p>
      {data.drops?.length ? (
        <div>
          <p>掉落物品：</p>
          <div className="combat-drop-list">
            <RewardDropList drops={data.drops} iconSize={16} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function decodeCombatRouteMonsterId(value: string) {
  if (!value.includes("%")) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function CombatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const monsterId = decodeCombatRouteMonsterId(id);
  const router = useRouter();
  const { modal } = App.useApp();
  const [messageApi, contextHolder] = message.useMessage();
  const [settling, setSettling] = useState(false);
  const [acting, setActing] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [rotationCursor, setRotationCursor] = useState(0);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [consumablesExpanded, setConsumablesExpanded] = useState(true);
  const [activeMotion, setActiveMotion] = useState<MotionState | null>(null);
  const [popups, setPopups] = useState<PopupState[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const logAutoFollowRef = useRef(true);
  const latestCombatStateRef = useRef<CombatState | null>(null);
  const lastAnimatedLogIndexRef = useRef(0);
  const popupIdRef = useRef(1);
  const motionIdRef = useRef(1);
  const animationQueueRef = useRef<CombatLogEntry[]>([]);
  const animationBusyRef = useRef(false);
  const lastAutoSeekRef = useRef<{ key: string; issuedAt: number } | null>(null);
  const activeMotionTimerRef = useRef<number | null>(null);
  const popupTimerRefs = useRef<number[]>([]);
  const combatRecoveryModalOpenRef = useRef(false);
  const combatSettleFailureModalOpenRef = useRef(false);
  const settledCombatKeyRef = useRef<string | null>(null);
  const settlingCombatKeyRef = useRef<string | null>(null);
  const settleRetryTimerRef = useRef<number | null>(null);
  const settleRetryCountRef = useRef<Record<string, number>>({});
  const consumablePanelInitializedRef = useRef(false);

  const acknowledgeRepeatGuard = useCallback(async () => {
    const response = await fetch("/api/game/combat/repeat-guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acknowledge" }),
    });
    const json = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
    if (!response.ok || !json?.success) {
      throw new Error(json?.error || "操作确认失败，请重试");
    }
  }, []);

  const clearTransientTimers = useCallback(() => {
    if (activeMotionTimerRef.current !== null) {
      window.clearTimeout(activeMotionTimerRef.current);
    }
    activeMotionTimerRef.current = null;
    popupTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    popupTimerRefs.current = [];
  }, []);

  const clearSettleRetryTimer = useCallback(() => {
    if (settleRetryTimerRef.current !== null) {
      window.clearTimeout(settleRetryTimerRef.current);
    }
    settleRetryTimerRef.current = null;
  }, []);

  const showCombatRecoveryModal = useCallback((errorCode?: string) => {
    if (combatRecoveryModalOpenRef.current) {
      return;
    }

    combatRecoveryModalOpenRef.current = true;
    setAutoEnabled(false);
    modal.error({
      title: "战斗状态已失效",
      centered: true,
      maskClosable: false,
      closable: false,
      okText: "回到地图",
      content: <div className="combat-recovery-modal"><p>当前角色已不在这场战斗中，继续操作会持续失败。</p><p>错误代码：<code>{normalizeCombatRecoveryCode(errorCode)}</code></p></div>,
      onOk: () => {
        combatRecoveryModalOpenRef.current = false;
        router.push("/game/map");
      },
      afterClose: () => {
        combatRecoveryModalOpenRef.current = false;
      },
    });
  }, [modal, router]);

  const handleCombatSessionStart = useCallback(() => {
    setRotationCursor(0);
    setAutoEnabled(false);
    lastAnimatedLogIndexRef.current = 0;
    animationQueueRef.current = [];
    animationBusyRef.current = false;
    clearTransientTimers();
    setPopups([]);
    setActiveMotion(null);
    lastAutoSeekRef.current = null;
  }, [clearTransientTimers]);

  const controller = useCombatSceneController({
    monsterId,
    messageApi,
    onRecoveryRedirect: showCombatRecoveryModal,
    onSessionStart: handleCombatSessionStart,
  });

  const {
    activePartyCombatId,
    applyAuthoritativeSync,
    battleView,
    combatCommandRoomStatus,
    combatRealtimeLastAck,
    combatRealtimeSceneEnvelope,
    combatState,
    createCombatActionMeta,
    handleCombatFailureRecovery,
    loading,
    markSceneStale,
    movePipelinePending,
    predictedPlayerPosition,
    requestMove,
    restorePendingClientSequence,
    sceneSnapshot,
    sceneStreamState,
    sendCombatCommandAndWaitForAck,
    sendCombatRepair,
    skillsData,
    skillRotation,
    startupError,
    restartCombat,
    stateRefreshSignals,
    stateRefreshVersions,
    applyStateRefreshFrame,
  } = controller;

  const isPartyCombat = combatState?.mode === "party" && Array.isArray(combatState.participants);
  const movementEnabled = COMBAT_SOLO_MOVEMENT_ENABLED && !isPartyCombat;
  const isMyTurn = !isPartyCombat || combatState?.currentTurnPlayerId === combatState?.player.id;
  const movementPipelineActive = movementEnabled && movePipelinePending;
  const authoritativePlayerUnit = sceneSnapshot?.units.find((unit) => unit.id === combatState?.player.id) || null;
  const hasAuthoritativeActionTimeline = Boolean((sceneSnapshot?.timeline || []).some(
    (event) => (event.channel || "action") === "action",
  ));
  const effectivePredictedPlayerPosition = movementEnabled
    && !isPartyCombat
    && authoritativePlayerUnit?.moveState === "moving"
    && !hasAuthoritativeActionTimeline
    ? predictedPlayerPosition
    : null;
  const exitCombatScene = useCallback(() => {
    const isPartyScene = latestCombatStateRef.current?.mode === "party" || Boolean(activePartyCombatId);
    if (isPartyScene) {
      router.push("/game/map");
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/game/map");
  }, [activePartyCombatId, router]);

  const showCombatSettleFailureModal = useCallback((content?: string) => {
    if (combatSettleFailureModalOpenRef.current) {
      return;
    }

    combatSettleFailureModalOpenRef.current = true;
    modal.error({
      title: "战斗结算失败",
      centered: true,
      maskClosable: false,
      closable: false,
      okText: "返回地图",
      content: content || "结算未完成，请返回地图后重试。",
      onOk: () => {
        combatSettleFailureModalOpenRef.current = false;
        router.push("/game/map");
      },
    });
  }, [modal, router]);
  const showVictoryRewardModal = useCallback((data: NonNullable<SettleApiResponse["data"]>) => {
    modal.success({
      title: "战斗胜利",
      content: renderSettleRewardContent(data),
      onOk: () => exitCombatScene(),
      okText: "返回",
    });
  }, [exitCombatScene, modal]);
  const stageUnits = useMemo(() => {
    if (!combatState) {
      return [];
    }

    return [{
      id: combatState.enemy.id,
      name: combatState.enemy.name,
      role: "enemy" as const,
      avatarImageUrl: combatState.enemy.avatarImageUrl,
      avatarFrameImageUrl: combatState.enemy.avatarFrameImageUrl,
      fallbackText: getOrbFallbackText(combatState.enemy),
      isDead: combatState.enemy.hp <= 0,
      hp: combatState.enemy.hp,
      maxHp: combatState.enemy.maxHp,
      mp: combatState.enemy.mp,
      maxMp: combatState.enemy.maxMp,
      activeEffects: combatState.enemy.activeEffects,
    }, ...((combatState.participants?.length ? combatState.participants : [combatState.player]).map((unit, index) => ({
      id: unit.id,
      name: unit.name,
      role: "player" as const,
      slot: index,
      avatarImageUrl: unit.avatarImageUrl,
      avatarFrameImageUrl: unit.avatarFrameImageUrl,
      fallbackText: getOrbFallbackText(unit),
      isCurrent: combatState.mode === "party"
        ? unit.id === combatState.currentTurnPlayerId
        : unit.id === combatState.player.id,
      isDead: unit.hp <= 0,
      hp: unit.hp,
      maxHp: unit.maxHp,
      mp: unit.mp,
      maxMp: unit.maxMp,
      activeEffects: unit.activeEffects,
    })))];
  }, [combatState]);
  const stageMotion = useMemo(() => (
    activeMotion && activeMotion.entryType !== "status"
      ? {
        id: activeMotion.id,
        actorId: activeMotion.actorId,
        targetId: activeMotion.targetId,
        durationMs: activeMotion.durationMs,
        visualEffect: activeMotion.visualEffect,
      }
      : null
  ), [activeMotion]);
  const backdropUnits = useMemo(() => (
    stageUnits.map((unit) => ({
      id: unit.id,
      role: unit.role,
      isActor: activeMotion?.actorId === unit.id && activeMotion.entryType !== "status",
      isTarget: activeMotion?.targetId === unit.id && activeMotion.entryType !== "status",
      isCurrent: "isCurrent" in unit ? unit.isCurrent : undefined,
    }))
  ), [activeMotion, stageUnits]);
  const playerSceneXPercent = effectivePredictedPlayerPosition?.xPercent
    ?? sceneSnapshot?.units.find((unit) => unit.id === combatState?.player.id)?.xPercent
    ?? 50;
  const playerSceneYPercent = effectivePredictedPlayerPosition?.yPercent
    ?? sceneSnapshot?.units.find((unit) => unit.id === combatState?.player.id)?.yPercent
    ?? 84;
  const sceneStatusBadge = sceneStreamState === "stale" ? "已断线" : sceneStreamState === "connecting" ? "同步中" : null;
  const moveControlDisabled = !movementEnabled
    || combatState?.status !== "ongoing"
    || settling
    || acting
    || autoEnabled
    || movementPipelineActive
    || !isMyTurn
    || isPartyCombat;
  const autoBattleToggleDisabled = autoEnabled
    ? settling || combatState?.status !== "ongoing"
    : settling || acting || movementPipelineActive || !isMyTurn || !skillRotation.length;
  const scenePositionOverrides = useMemo(() => {
    if (!sceneSnapshot && !(effectivePredictedPlayerPosition && combatState?.player.id)) {
      return undefined;
    }

    const nextOverrides = Object.fromEntries(
      (sceneSnapshot?.units || []).map((unit) => [
        unit.id,
        {
          xPercent: unit.xPercent,
          yPercent: unit.yPercent,
        },
      ]),
    ) as Record<string, { xPercent: number; yPercent: number }>;

    if (effectivePredictedPlayerPosition && combatState?.player.id) {
      nextOverrides[combatState.player.id] = effectivePredictedPlayerPosition;
    }

    return nextOverrides;
  }, [combatState?.player.id, effectivePredictedPlayerPosition, sceneSnapshot]);
  const stageRenderOverrides = useMemo(() => {
    if (!effectivePredictedPlayerPosition || !combatState?.player.id) {
      return null;
    }

    return new Map([
      [
        combatState.player.id,
        effectivePredictedPlayerPosition,
      ],
    ]);
  }, [combatState?.player.id, effectivePredictedPlayerPosition]);
  const combatScenePositions = useMemo(() => (
    combatState ? getCombatScenePositions(combatState, scenePositionOverrides) : null
  ), [combatState, scenePositionOverrides]);
  const handleCombatPhaserMove = useCallback((x: number, y: number) => {
    if (!movementEnabled || moveControlDisabled) {
      return;
    }
    const nextTarget = clampMoveTarget({
      xPercent: x,
      yPercent: y,
    });
    requestMove(nextTarget);
  }, [movementEnabled, moveControlDisabled, requestMove]);

  const commitMoveTarget = useCallback((target: CombatMoveTarget) => {
    if (moveControlDisabled) {
      return;
    }
    const nextTarget = clampMoveTarget(target);
    void requestMove(nextTarget);
  }, [moveControlDisabled, requestMove]);

  const stopAutoBattle = useCallback(() => {
    lastAutoSeekRef.current = null;
    setAutoEnabled(false);
  }, []);

  const startAutoBattle = useCallback(() => {
    if (!skillRotation.length) {
      messageApi.warning("当前没有可用的出战技能顺序，请先前往神通页整理");
      return;
    }
    lastAutoSeekRef.current = null;
    setRotationCursor(0);
    setAutoEnabled(true);
  }, [messageApi, skillRotation.length]);

  const handleStageMovePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!combatState || moveControlDisabled) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-stage-control='move-rail']")) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const nextTarget = {
      xPercent: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100,
      yPercent: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100,
    } satisfies CombatMoveTarget;
    commitMoveTarget(nextTarget);
  }, [combatState, commitMoveTarget, moveControlDisabled]);

  const pushPopup = useCallback((targetId: string, label: string, kind: PopupState["kind"]) => {
    const id = popupIdRef.current++;
    const createdAtMs = Date.now();
    const durationMs = 1280;
    setPopups((current) => [...current, { id, targetId, label, kind, createdAtMs, durationMs }]);
    const timer = window.setTimeout(
      () => {
        setPopups((current) => current.filter((item) => item.id !== id));
        popupTimerRefs.current = popupTimerRefs.current.filter((item) => item !== timer);
      },
      durationMs,
    );
    popupTimerRefs.current.push(timer);
  }, []);

  const playNextAnimation = useCallback(() => {
    if (animationBusyRef.current) {
      return;
    }

    const nextEntry = animationQueueRef.current.shift();
    if (!nextEntry || !nextEntry.entryType || nextEntry.entryType === "system") {
      setActiveMotion(null);
      return;
    }

    const actorId = nextEntry.actorId || latestCombatStateRef.current?.enemy.id;
    const targetId = nextEntry.targetId || actorId;
    if (!actorId || !targetId) {
      setActiveMotion(null);
      return;
    }

    const motionId = motionIdRef.current++;
    animationBusyRef.current = true;
    const motionDuration = Math.max(440, getSkillVisualEffectDurationMs(nextEntry.visualEffect) + 120);
    setActiveMotion({
      id: motionId,
      actorId,
      targetId,
      entryType: nextEntry.entryType,
      visualEffect: nextEntry.visualEffect,
      durationMs: motionDuration,
    });
    if (nextEntry.damage && nextEntry.targetId) {
      pushPopup(nextEntry.targetId, `-${nextEntry.damage}`, "damage");
    }
    if (nextEntry.heal && nextEntry.targetId) {
      pushPopup(nextEntry.targetId, `+${nextEntry.heal}`, "heal");
    }
    if (nextEntry.resultType === "miss" && nextEntry.resultLabel && nextEntry.targetId) {
      pushPopup(nextEntry.targetId, nextEntry.resultLabel, "system");
    }

    activeMotionTimerRef.current = window.setTimeout(() => {
      activeMotionTimerRef.current = null;
      setActiveMotion((current) => current?.id === motionId ? null : current);
      animationBusyRef.current = false;
      playNextAnimation();
    }, motionDuration);
  }, [pushPopup]);

  useEffect(() => {
    latestCombatStateRef.current = combatState;
  }, [combatState]);

  useEffect(() => () => clearTransientTimers(), [clearTransientTimers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 901px)");
    const syncViewportMode = () => {
      const isDesktop = mediaQuery.matches;
      setIsDesktopViewport(isDesktop);
      if (!consumablePanelInitializedRef.current) {
        setConsumablesExpanded(!isDesktop);
        consumablePanelInitializedRef.current = true;
      }
    };

    syncViewportMode();
    const handleChange = () => syncViewportMode();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  // 丹药数量由服务端 inventory_refresh(10302) 刷新帧驱动，
  // 帧到达时先本地即时扣减，再以服务端库存为准回填，保证界面不回退。
  const {
    consumables: combatConsumables,
    applyConsumedItem: applyCombatConsumableConsumed,
    lastRefreshedAt: combatInventoryRefreshedAt,
  } = useCombatConsumableInventory({
    inventoryVersion: stateRefreshVersions.inventory,
    inventorySignal: stateRefreshSignals.inventory,
  });

  useEffect(() => {
    if (!combatState || combatState.status !== "ongoing") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (moveControlDisabled) {
        return;
      }
      if (event.key === "a" || event.key === "A" || event.key === "ArrowLeft") {
        commitMoveTarget({
          xPercent: playerSceneXPercent - 10,
          yPercent: playerSceneYPercent,
        });
      }
      if (event.key === "d" || event.key === "D" || event.key === "ArrowRight") {
        commitMoveTarget({
          xPercent: playerSceneXPercent + 10,
          yPercent: playerSceneYPercent,
        });
      }
      if (event.key === "w" || event.key === "W" || event.key === "ArrowUp") {
        commitMoveTarget({
          xPercent: playerSceneXPercent,
          yPercent: playerSceneYPercent - 10,
        });
      }
      if (event.key === "s" || event.key === "S" || event.key === "ArrowDown") {
        commitMoveTarget({
          xPercent: playerSceneXPercent,
          yPercent: playerSceneYPercent + 10,
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combatState, commitMoveTarget, moveControlDisabled, playerSceneXPercent, playerSceneYPercent]);

  useEffect(() => {
    if (logExpanded && logAutoFollowRef.current) {
      logRef.current?.scrollTo(0, logRef.current.scrollHeight);
    }
  }, [combatState?.log, logExpanded]);

  useEffect(() => {
    if (!combatState) {
      return;
    }
    if (combatState.log.length < lastAnimatedLogIndexRef.current) {
      lastAnimatedLogIndexRef.current = 0;
    }
    const nextEntries = combatState.log.slice(lastAnimatedLogIndexRef.current);
    lastAnimatedLogIndexRef.current = combatState.log.length;
    if (!nextEntries.length) {
      return;
    }
    animationQueueRef.current.push(...nextEntries.filter((entry) => entry.entryType && entry.entryType !== "system"));
    playNextAnimation();
  }, [combatState, playNextAnimation]);

  useEffect(() => {
    if (combatState && combatState.status !== "ongoing") {
      setAutoEnabled(false);
      animationQueueRef.current = [];
      animationBusyRef.current = false;
      lastAutoSeekRef.current = null;
      clearTransientTimers();
      setActiveMotion(null);
      setPopups([]);
    }
  }, [clearTransientTimers, combatState]);

  useEffect(() => () => {
    clearSettleRetryTimer();
  }, [clearSettleRetryTimer]);

  const settleCombat = useCallback(async (state: CombatState) => {
    const settleKey = `${state.id}:${state.status}`;
    if (settledCombatKeyRef.current === settleKey || settlingCombatKeyRef.current === settleKey) {
      return;
    }

    settlingCombatKeyRef.current = settleKey;
    let keepSettleKey = false;
    setSettling(true);
    try {
      const response = await fetch("/api/game/combat/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ combatId: state.id, ...(activePartyCombatId ? { partyCombatId: activePartyCombatId } : {}) }) });
      const json = await response.json() as SettleApiResponse;
      if (!json.success) {
        if (shouldRetryCombatSettle(response.status)) {
          const nextRetryCount = (settleRetryCountRef.current[settleKey] || 0) + 1;
          if (nextRetryCount <= COMBAT_SETTLE_RETRY_LIMIT) {
            settleRetryCountRef.current[settleKey] = nextRetryCount;
            clearSettleRetryTimer();
            settleRetryTimerRef.current = window.setTimeout(() => {
              settleRetryTimerRef.current = null;
              const latestState = latestCombatStateRef.current;
              if (latestState && `${latestState.id}:${latestState.status}` === settleKey) {
                void settleCombat(latestState);
              }
            }, COMBAT_SETTLE_RETRY_BASE_DELAY_MS * nextRetryCount);
            return;
          }
        }

        if (response.status === 400 && json.error?.includes("战斗会话不存在或已结算")) {
          keepSettleKey = true;
          delete settleRetryCountRef.current[settleKey];
          settledCombatKeyRef.current = settleKey;
          messageApi.info("当前战斗已完成，正在离开战场");
          window.setTimeout(() => exitCombatScene(), 300);
          return;
        }

        settlingCombatKeyRef.current = null;
        delete settleRetryCountRef.current[settleKey];
        showCombatSettleFailureModal(json.error || "战斗结算失败");
        return;
      }

      delete settleRetryCountRef.current[settleKey];
      settledCombatKeyRef.current = settleKey;
      const data = json.data || {};
      if (state.status === "player_win") {
        if (data.noRewardReason === "repeat_guard_blocked") {
          keepSettleKey = true;
          modal.warning({
            title: "收益已暂停",
            content: data.antiRepeatGuard?.message || "检测到重复击杀行为，当前战斗不再发放收益。",
            onOk: () => exitCombatScene(),
            okText: "返回",
          });
          return;
        }

        if (data.antiRepeatGuard?.status === "probe_required") {
          keepSettleKey = true;
          modal.confirm({
            title: "操作确认",
            centered: true,
            maskClosable: false,
            closable: false,
            okText: "我在正常操作",
            cancelButtonProps: { style: { display: "none" } },
            content: data.antiRepeatGuard.message,
            onOk: async () => {
              await acknowledgeRepeatGuard();
              if (data.noRewardReason === "stamina_empty") {
                modal.warning({
                  title: "战斗胜利",
                  content: "体力不足，本次战斗未获得收益。",
                  onOk: () => exitCombatScene(),
                  okText: "返回",
                });
                return;
              }
              showVictoryRewardModal(data);
            },
          });
          return;
        }

        if (data.noRewardReason === "stamina_empty") {
          keepSettleKey = true;
          modal.warning({ title: "战斗胜利", content: "体力不足，本次战斗未获得收益。", onOk: () => exitCombatScene(), okText: "返回" });
          return;
        }

        keepSettleKey = true;
        showVictoryRewardModal(data);
        return;
      }

      if (data.died) {
        keepSettleKey = true;
        modal.error({ title: "战斗失败", content: data.message || "角色已倒下。", onOk: () => router.push("/game/map"), okText: "回到地图" });
        return;
      }
      if (data.fled) {
        keepSettleKey = true;
        messageApi.info("你已成功脱离战斗");
        window.setTimeout(() => exitCombatScene(), 500);
      }
    } catch {
      settlingCombatKeyRef.current = null;
      const nextRetryCount = (settleRetryCountRef.current[settleKey] || 0) + 1;
      if (nextRetryCount <= COMBAT_SETTLE_RETRY_LIMIT) {
        settleRetryCountRef.current[settleKey] = nextRetryCount;
        clearSettleRetryTimer();
        settleRetryTimerRef.current = window.setTimeout(() => {
          settleRetryTimerRef.current = null;
          const latestState = latestCombatStateRef.current;
          if (latestState && `${latestState.id}:${latestState.status}` === settleKey) {
            void settleCombat(latestState);
          }
        }, COMBAT_SETTLE_RETRY_BASE_DELAY_MS * nextRetryCount);
        return;
      }
      delete settleRetryCountRef.current[settleKey];
      showCombatSettleFailureModal("战斗结算失败");
    } finally {
      setSettling(false);
      if (settlingCombatKeyRef.current === settleKey) {
        settlingCombatKeyRef.current = null;
      }
      if (!keepSettleKey && settledCombatKeyRef.current === settleKey) {
        settledCombatKeyRef.current = null;
      }
    }
  }, [acknowledgeRepeatGuard, activePartyCombatId, clearSettleRetryTimer, exitCombatScene, messageApi, modal, router, showCombatSettleFailureModal, showVictoryRewardModal]);

  useEffect(() => {
    if (!combatState || combatState.status === "ongoing") {
      clearSettleRetryTimer();
      settleRetryCountRef.current = {};
      settledCombatKeyRef.current = null;
      return;
    }

    void settleCombat(combatState);
  }, [clearSettleRetryTimer, combatState, settleCombat]);

  const submitColyseusCombatAction = useCallback(async (params: {
    actionMeta: ReturnType<typeof createCombatActionMeta>;
    actionType: "skill" | "item" | "flee" | "surrender";
    skillId?: string;
    itemId?: string;
  }) => {
    if (combatCommandRoomStatus !== "connected") {
      return null;
    }
    const result = await sendCombatCommandAndWaitForAck({
      commandType: params.actionType,
      ...(params.skillId ? { skillId: params.skillId } : {}),
      ...(params.itemId ? { itemId: params.itemId } : {}),
      ...(combatState?.enemy.id ? { targetId: combatState.enemy.id } : {}),
    }, {
      clientSequence: params.actionMeta.clientSequence,
      actionId: params.actionMeta.actionId,
      clientSentAt: params.actionMeta.clientSentAt,
      timeoutMs: 3500,
    });
    if (!result) {
      return null;
    }
    return buildCombatActionResponseFromAck(result.ack);
  }, [combatCommandRoomStatus, combatState?.enemy.id, sendCombatCommandAndWaitForAck]);

  const submitHttpCombatAction = useCallback(async (params: {
    actionMeta: ReturnType<typeof createCombatActionMeta>;
    actionType: "skill" | "item" | "flee" | "surrender";
    skillId?: string;
    itemId?: string;
  }) => {
    if (!combatState?.id) {
      return buildCombatRealtimeUnavailableResponse("战斗会话尚未建立，请稍后重试。");
    }

    const response = await fetch("/api/game/combat/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        combatId: combatState.id,
        ...(activePartyCombatId ? { partyCombatId: activePartyCombatId } : {}),
        action: params.actionType,
        ...(params.skillId ? { skillId: params.skillId } : {}),
        ...(params.itemId ? { itemId: params.itemId } : {}),
        clientSequence: params.actionMeta.clientSequence,
        clientSceneTick: params.actionMeta.clientSceneTick,
        actionId: params.actionMeta.actionId,
        clientSentAt: params.actionMeta.clientSentAt,
      }),
    });
    return readCombatActionResponse(response, "战斗执行失败");
  }, [activePartyCombatId, combatState?.id]);

  const handleAction = useCallback(async (actionType: "skill" | "flee" | "surrender", skillId?: string, _fromAuto = false) => {
    const requiresMyTurn = actionType !== "flee" && actionType !== "surrender";
    if (!combatState || combatState.status !== "ongoing" || acting || movementPipelineActive || (requiresMyTurn && !isMyTurn)) {
      return;
    }

    setActing(true);
    const actionMeta = createCombatActionMeta();
    try {
      const useColyseusAction = shouldUseColyseusCombatAction();
      const colyseusJson = useColyseusAction
        ? await submitColyseusCombatAction({
          actionMeta,
          actionType,
          skillId,
        })
        : null;
      const json = colyseusJson
        || await submitHttpCombatAction({
          actionMeta,
          actionType,
          skillId,
        });
      applyAuthoritativeSync(json.data, {
        requestedClientSequence: actionMeta.clientSequence,
      });
      if (!json.success) {
        if (typeof json.data?.acceptedClientSequence !== "number") {
          restorePendingClientSequence(actionMeta.clientSequence);
        }
        if (json.errorCode === "COMBAT_SCENE_STALE") {
          const recoveryResult = await handleCombatFailureRecovery({ combatId: combatState.id, status: 409, errorCode: json.errorCode, error: json.error });
          if (recoveryResult === "redirected") {
            return;
          }
          if (_fromAuto) {
            return;
          }
          messageApi.warning(recoveryResult === "synced" ? "战斗场景已重新同步，请重新出手。" : json.error || "战斗状态已更新，请按最新战局重新操作。");
          return;
        }
        if (json.errorCode === "COMBAT_SESSION_FINISHED" && isCombatFinishedPayload(json.data)) {
          setAutoEnabled(false);
          return;
        }
        const recoveryResult = await handleCombatFailureRecovery({ combatId: combatState.id, status: 503, errorCode: json.errorCode, error: json.error });
        if (recoveryResult === "synced") {
          if (_fromAuto) {
            return;
          }
          messageApi.warning("战斗场景已重新同步，请重新出手。");
          return;
        }
        if (recoveryResult === "redirected") {
          return;
        }
        if (_fromAuto) {
          return;
        }
        messageApi.error(json.error || "战斗执行失败");
        return;
      }
      if (!json.data?.state) {
        if (_fromAuto) {
          return;
        }
        messageApi.error("战斗状态异常");
        return;
      }
      if (json.data.state.status !== "ongoing") {
        setAutoEnabled(false);
      }
    } catch {
      restorePendingClientSequence(actionMeta.clientSequence);
      markSceneStale();
      if (_fromAuto) {
        return;
      }
      messageApi.error("战斗执行失败");
    } finally {
      setActing(false);
    }
  }, [acting, applyAuthoritativeSync, combatState, createCombatActionMeta, handleCombatFailureRecovery, isMyTurn, markSceneStale, messageApi, movementPipelineActive, restorePendingClientSequence, submitColyseusCombatAction, submitHttpCombatAction]);

  const handleUseCombatItem = useCallback(async (itemId: string) => {
    if (!combatState || combatState.status !== "ongoing" || settling || acting || movementPipelineActive || !isMyTurn) {
      return;
    }
    if (!combatConsumables.find((item) => item.itemId === itemId && item.quantity > 0)) {
      messageApi.error("丹药数量不足");
      return;
    }

    setActing(true);
    const actionMeta = createCombatActionMeta();
    try {
      const useColyseusAction = shouldUseColyseusCombatAction();
      const colyseusJson = useColyseusAction
        ? await submitColyseusCombatAction({
          actionMeta,
          actionType: "item",
          itemId,
        })
        : null;
      const json = colyseusJson
        || await submitHttpCombatAction({
          actionMeta,
          actionType: "item",
          itemId,
        });
      applyAuthoritativeSync(json.data, {
        requestedClientSequence: actionMeta.clientSequence,
      });
      if (!json.success) {
        if (typeof json.data?.acceptedClientSequence !== "number") {
          restorePendingClientSequence(actionMeta.clientSequence);
        }
        if (json.errorCode === "COMBAT_SCENE_STALE") {
          messageApi.warning(json.error || "战斗状态已更新，请按最新战局重新操作。");
          return;
        }
        if (json.errorCode === "COMBAT_SESSION_FINISHED" && isCombatFinishedPayload(json.data)) {
          setAutoEnabled(false);
          return;
        }
        const recoveryResult = await handleCombatFailureRecovery({ combatId: combatState.id, status: 503, errorCode: json.errorCode, error: json.error });
        if (recoveryResult === "synced") {
          messageApi.warning("战斗场景已重新同步，请重新使用丹药。");
          return;
        }
        if (recoveryResult === "redirected") {
          return;
        }
        messageApi.error(json.error || "使用丹药失败");
        return;
      }
      if (!json.data?.state) {
        messageApi.error("战斗状态异常");
        return;
      }
      // HTTP 事务携带的帧组兜底消费，随后统一走背包刷新逻辑。
      applyStateRefreshFramesFromResponse(json.refreshFrames, applyStateRefreshFrame);
      applyCombatConsumableConsumed(itemId);
      if (json.data.state.status !== "ongoing") {
        setAutoEnabled(false);
      }
    } catch {
      restorePendingClientSequence(actionMeta.clientSequence);
      markSceneStale();
      messageApi.error("使用丹药失败");
    } finally {
      setActing(false);
    }
  }, [acting, applyAuthoritativeSync, applyCombatConsumableConsumed, applyStateRefreshFrame, combatConsumables, combatState, createCombatActionMeta, handleCombatFailureRecovery, isMyTurn, markSceneStale, messageApi, movementPipelineActive, restorePendingClientSequence, settling, submitColyseusCombatAction, submitHttpCombatAction]);

  useEffect(() => {
    if (!autoEnabled || !combatState || combatState.status !== "ongoing" || acting || movementPipelineActive || settling || !isMyTurn) {
      return;
    }
    if (!skillRotation.length) {
      setAutoEnabled(false);
      messageApi.warning("当前没有可用的出战技能顺序，请先前往神通页整理");
      return;
    }

    const timer = window.setTimeout(() => {
      const autoDecision = pickCombatAutoActionDecision({
        unit: combatState.player,
        skills: skillsData,
        preferredRotation: skillRotation,
        rotationCursor,
        actorIsPlayer: true,
        positions: combatScenePositions,
      });
      if (movementEnabled && !isPartyCombat) {
        const movementAnchorSkillId = pickCombatAutoMovementAnchorSkillId({
          unit: combatState.player,
          skills: skillsData,
          preferredRotation: skillRotation,
          rotationCursor,
        });
        const movementAnchorSkill = movementAnchorSkillId ? skillsData[movementAnchorSkillId] : null;
        const movementAnchorContact = combatScenePositions && movementAnchorSkillId
          ? resolveCombatSkillContact({
            actorIsPlayer: true,
            skillType: movementAnchorSkill?.skillType,
            skillId: movementAnchorSkillId,
            positions: combatScenePositions,
          })
          : null;

        if (combatScenePositions && movementAnchorSkillId && movementAnchorContact?.outcome === "miss") {
          const selectedSkillId = movementAnchorSkillId;
          const selectedSkill = movementAnchorSkill;
          if (selectedSkillId) {
            const movePlan = resolveCombatActorAutoMovementPlan({
              actorIsPlayer: true,
              currentActorXPercent: combatScenePositions.playerXPercent,
              currentActorYPercent: combatScenePositions.playerYPercent,
              currentTargetXPercent: combatScenePositions.enemyXPercent,
              currentTargetYPercent: combatScenePositions.enemyYPercent,
              preferredSkillId: selectedSkillId,
              preferredSkill: selectedSkill || null,
            });
            const moveKey = `${Math.round(movePlan.targetXPercent * 10) / 10}:${Math.round(movePlan.targetYPercent * 10) / 10}`;
            const now = Date.now();
            if (!lastAutoSeekRef.current || lastAutoSeekRef.current.key !== moveKey || now - lastAutoSeekRef.current.issuedAt >= 900) {
              lastAutoSeekRef.current = {
                key: moveKey,
                issuedAt: now,
              };
              void requestMove({
                xPercent: movePlan.targetXPercent,
                yPercent: movePlan.targetYPercent,
              });
            }
            return;
          }
        }
      }
      if (!autoDecision) {
        return;
      }
      const selectedSkillId = autoDecision.skillId;
      const selectedSkill = skillsData[selectedSkillId];
      if (!selectedSkill) {
        return;
      }
      lastAutoSeekRef.current = null;
      const selectedRotationIndex = skillRotation.indexOf(selectedSkillId);
      if (skillRotation.length > 0 && selectedRotationIndex >= 0) {
        setRotationCursor((selectedRotationIndex + 1) % skillRotation.length);
      }
      void handleAction("skill", selectedSkillId, true);
    }, 320);

    return () => window.clearTimeout(timer);
  }, [acting, autoEnabled, combatScenePositions, combatState, handleAction, isMyTurn, isPartyCombat, messageApi, movementEnabled, movementPipelineActive, requestMove, rotationCursor, settling, skillRotation, skillsData]);

  if (loading) {
    return (
      <>
        {contextHolder}
        <BattlePageStateCard mode="loading" />
      </>
    );
  }

  if (!combatState) {
    return (
      <>
        {contextHolder}
        <BattlePageStateCard
          mode="empty"
          title="战斗尚未建立"
          description={startupError || "当前无法进入普通战斗，请重新尝试。"}
          primaryActionLabel="重新进入"
          onPrimaryAction={() => void restartCombat()}
          secondaryActionLabel="返回上一页"
          onSecondaryAction={exitCombatScene}
        />
      </>
    );
  }

  const playerSkills = combatState.player.skills.map((skillId) => {
    const skill = skillsData[skillId];
    return skill ? { id: skillId, ...skill } : null;
  }).filter((skill): skill is { id: string } & SkillView => Boolean(skill));
  const playerSkillViews = playerSkills.map((skill) => ({ ...skill, cooldownLeft: Number(combatState.player.skillCooldowns?.[skill.id] || 0), disabled: Number(combatState.player.skillCooldowns?.[skill.id] || 0) > 0 || combatState.player.mp < (skill.mpCost || 0) || settling || acting || movementPipelineActive || autoEnabled || !isMyTurn }));
  const alliedParticipants = combatState.participants?.length ? combatState.participants : [combatState.player];
  const allySlotDisplay = [{ id: "slot-1", slotTitle: "1号位", unit: alliedParticipants[0] || null }, { id: "slot-2", slotTitle: "2号位", unit: alliedParticipants[1] || null }, { id: "slot-3", slotTitle: "3号位", unit: alliedParticipants[2] || null }];
  const turnDeadlineMs = combatState.turnDeadlineAt ? Math.max(0, Date.parse(combatState.turnDeadlineAt) - Date.now()) : 0;
  const turnBannerText = isPartyCombat ? `${isMyTurn ? "当前轮到你出手" : `当前轮到 ${alliedParticipants.find((unit) => unit.id === combatState.currentTurnPlayerId)?.name || "队友"}`}，剩余 ${combatState.turnDeadlineAt ? `${Math.ceil(turnDeadlineMs / 1000)}s` : "--"}` : "";
  const logSummary = logExpanded ? `共 ${combatState.log.length} 条战报` : (combatState.log[combatState.log.length - 1]?.message || "暂无战报");
  const renderCombatActionPanel = (className = "combat-action-panel") => (
    <BattleActionPanel
      className={className}
      title="出手安排"
      subtitle={isPartyCombat
        ? (autoEnabled ? "自动战斗中，会在你的回合按当前出战顺序自动施法，不再切换站位。" : "组队战已锁定站位，可手动施法，也可切换为自动回合出手。")
        : movementEnabled
          ? (autoEnabled ? "自动战斗中，会锁定当前怪物并自动追击到技能距离后再出手。" : "普通战支持点击舞台走位，自动战会先锁敌追击，再进入出手循环。")
          : (autoEnabled ? "当前已回退为固定站位对战，自动战斗只会按技能顺序出手，不再进行追击走位。" : "当前已回退为固定站位对战，不再进行场景走位。")}
      statusLabel={autoEnabled ? "自动中" : isMyTurn ? "你的回合" : "等待中"}
      statusHighlighted={autoEnabled}
      commandButtons={[
        {
          key: "auto",
          label: autoEnabled ? "停止自动" : "自动战斗",
          tone: autoEnabled ? "default" : "primary",
          disabled: autoBattleToggleDisabled,
          onClick: () => {
            if (autoEnabled) {
              stopAutoBattle();
              return;
            }
            startAutoBattle();
          },
        },
        ...(!isPartyCombat ? [{
          key: "surrender",
          label: "认输",
          tone: "danger" as const,
          disabled: settling || acting || movementPipelineActive || autoEnabled,
          onClick: () => {
            void handleAction("surrender");
          },
        }] : []),
        {
          key: "flee",
          label: isPartyCombat ? "全队撤离" : "立即撤离",
          tone: "danger",
          disabled: settling || acting || movementPipelineActive || autoEnabled,
          onClick: () => {
            void handleAction("flee");
          },
        },
      ]}
      skills={playerSkillViews.map((skill) => ({
        key: skill.id,
        tag: `MP ${skill.mpCost}`,
        disabled: skill.disabled,
        onClick: () => {
          void handleAction("skill", skill.id);
        },
        content: (
          <>
            <ThunderboltOutlined />
            <span>{skill.cooldownLeft > 0 ? `${skill.name} (${skill.cooldownLeft})` : skill.name}</span>
          </>
        ),
      }))}
      items={combatConsumables.map((item) => ({
        key: item.itemId,
        disabled: settling || acting || movementPipelineActive || autoEnabled || !isMyTurn,
        onClick: () => {
          void handleUseCombatItem(item.itemId);
        },
        content: (
          <>
            <ItemIcon iconUrl={item.iconUrl} size={18} />
            <span>{item.name}</span>
          </>
        ),
        meta: `x${item.quantity}`,
      }))}
      itemSectionHint={formatInventorySyncHint(combatInventoryRefreshedAt)}
      itemSectionDesktopToggle={isDesktopViewport ? {
        expanded: consumablesExpanded,
        onToggle: () => setConsumablesExpanded((current) => !current),
      } : undefined}
    />
  );

  return (
    <>
      {contextHolder}
      <UnifiedBattleShell
        topBanner={turnBannerText ? <div className="combat-sync-strip combat-sync-strip--banner"><span className="combat-sync-chip is-live">{turnBannerText} · {allySlotDisplay.length}人阵位</span></div> : null}
        header={(
          <BattleViewHeaderCard
            battleView={battleView}
            extraBadges={[
              sceneStreamState === "live" ? "实时已连接" : sceneStreamState === "connecting" ? "正在重连" : "等待修复",
            ]}
          />
        )}
        topHud={(
          <>
            <div className="combat-ally-slots">{allySlotDisplay.map((slot) => <div key={slot.id}>{slot.unit ? <CompactCombatUnitStatusCard unit={slot.unit} slotTitle={slot.slotTitle} badge={slot.id === "slot-1" ? sceneStatusBadge : null} /> : <div className="combat-status-card combat-status-card--empty"><div className="combat-status-head"><span className="combat-status-slot">{slot.slotTitle}</span><span className="combat-status-name">空位</span></div><div className="combat-status-vacancy">预留组队席位</div></div>}</div>)}</div>
            <div><CompactCombatUnitStatusCard unit={combatState.enemy} slotTitle="目标" className="combat-status-card--enemy" /></div>
          </>
        )}
        primaryContent={(
          <div className={`combat-stage is-${sceneStreamState}`}>
            {COMBAT_PHASER_SCENE_ENABLED ? (
              <CombatPhaserScene
                snapshot={combatRealtimeSceneEnvelope}
                fallbackUnits={stageUnits.map((unit) => ({
                  id: unit.id,
                  name: unit.name,
                  role: unit.role,
                  isDead: unit.isDead,
                }))}
                status={combatCommandRoomStatus}
                lastAck={combatRealtimeLastAck}
                onMove={handleCombatPhaserMove}
                onRepair={sendCombatRepair}
              />
            ) : (
              <>
                <BattleStageBackdropCanvas mode="combat" clashActive={Boolean(activeMotion && activeMotion.entryType !== "status")} sceneSnapshot={sceneSnapshot} renderPositionOverrides={stageRenderOverrides} units={backdropUnits} />
                <BattleStageEntityCanvas mode="combat" units={stageUnits} motion={stageMotion} popups={popups} sceneSnapshot={sceneSnapshot} renderPositionOverrides={stageRenderOverrides} />
                <div className="combat-stage-ambience" />
                {movementEnabled && !isPartyCombat ? (
                  <div
                    className="combat-stage-input-layer"
                    onPointerDown={handleStageMovePointerDown}
                    onKeyDown={(event) => {
                      if (moveControlDisabled) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        commitMoveTarget({
                          xPercent: 50,
                          yPercent: playerSceneYPercent,
                        });
                      }
                    }}
                    aria-label="点击舞台任意位置快速移动"
                    aria-disabled={moveControlDisabled}
                    role="button"
                    tabIndex={moveControlDisabled ? -1 : 0}
                  />
                ) : null}
              </>
            )}
            {combatState.status !== "ongoing" ? <div className="combat-finish-mask"><div className="combat-finish-title">{combatState.status === "player_win" ? "胜利" : combatState.status === "fled" ? "已脱离战斗" : "战斗失败"}</div></div> : null}
          </div>
        )}
        sideRailContent={(
          <>
            <CombatLogFloatingPanel
              entries={combatState.log}
              summary={logSummary}
              open={logExpanded}
              onOpenChange={(nextOpen) => {
                logAutoFollowRef.current = true;
                setLogExpanded(nextOpen);
              }}
              logRef={logRef}
              onLogScroll={() => {
                const node = logRef.current;
                if (node) {
                  logAutoFollowRef.current = node.scrollTop + node.clientHeight >= node.scrollHeight - 24;
                }
              }}
            />
            {renderCombatActionPanel()}
          </>
        )}
        mobileDock={renderCombatActionPanel("combat-action-panel combat-action-panel--mobile")}
      />
    </>
  );
}
