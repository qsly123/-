"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { message } from "antd";
import { useRouter } from "next/navigation";
import BattleActionPanel from "@/modules/combat/ui/components/BattleActionPanel";
import BattlePageStateCard from "@/modules/combat/ui/components/BattlePageStateCard";
import BattleStageBackdropCanvas from "@/modules/combat/ui/components/BattleStageBackdropCanvas";
import BattleStageEntityCanvas from "@/modules/combat/ui/components/BattleStageEntityCanvas";
import UnifiedBattleShell from "@/modules/combat/ui/components/UnifiedBattleShell";
import BattleViewHeaderCard from "@/modules/combat/ui/components/BattleViewHeaderCard";
import CompactCombatUnitStatusCard from "@/modules/combat/ui/components/CompactCombatUnitStatusCard";
import CombatLogFloatingPanel from "@/modules/combat/ui/components/CombatLogFloatingPanel";
import { usePvpBattleSceneController, type PvpBattleSceneResponse } from "@/modules/combat/ui/hooks/usePvpBattleSceneController";
import {
  formatInventorySyncHint,
  useCombatConsumableInventory,
} from "@/modules/combat/ui/hooks/useCombatConsumableInventory";
import { getSkillVisualEffectDurationMs } from "@/modules/shared/services/skill-visual-effect";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import type { RealtimeInputAck } from "@immortality/shared-protocol";
import type { CombatLogEntry, CombatSkillVisualEffect, CombatUnit } from "@/types/game";

type SkillView = {
  name: string;
  skillType: string;
  mpCost: number;
  cooldown: number;
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

function getOrbFallbackText(unit: CombatUnit) {
  const compactName = unit.name.replace(/\s+/g, "");
  return compactName ? compactName.slice(0, Math.min(2, compactName.length)) : unit.isPlayer ? "修士" : "敌手";
}

function shouldUsePvpColyseusAction() {
  return true;
}

function mapPvpAckReasonToErrorCode(reason?: string) {
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

function buildPvpResponseFromAck(ack: RealtimeInputAck): PvpBattleSceneResponse {
  const authoritativeState = ack.authoritativeState as Partial<NonNullable<PvpBattleSceneResponse["data"]> & {
    message?: string | null;
  }> | undefined;
  return {
    success: ack.accepted,
    error: ack.accepted ? undefined : authoritativeState?.message || "论道出手失败",
    errorCode: ack.accepted ? undefined : mapPvpAckReasonToErrorCode(ack.reason),
    data: {
      state: authoritativeState?.state,
      sceneSnapshot: authoritativeState?.sceneSnapshot,
      battleView: authoritativeState?.battleView,
      turnState: authoritativeState?.turnState,
      settlement: authoritativeState?.settlement,
      acceptedClientSequence: ack.acceptedSequence,
    },
  };
}

function buildPvpRealtimeUnavailableResponse(messageText: string): PvpBattleSceneResponse {
  return {
    success: false,
    error: messageText,
    errorCode: "COMBAT_REALTIME_UNAVAILABLE",
    data: {},
  };
}

export default function PvpBattlePage({ combatId }: { combatId: string }) {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [acting, setActing] = useState(false);
  const [activeMotion, setActiveMotion] = useState<MotionState | null>(null);
  const [popups, setPopups] = useState<PopupState[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lastAnimatedLogIndexRef = useRef(0);
  const popupIdRef = useRef(1);
  const motionIdRef = useRef(1);
  const animationQueueRef = useRef<CombatLogEntry[]>([]);
  const animationBusyRef = useRef(false);
  const activeMotionTimerRef = useRef<number | null>(null);
  const popupTimerRefs = useRef<number[]>([]);

  const controller = usePvpBattleSceneController({
    combatId,
    messageApi,
  });

  const latestCombatStateRef = useRef(controller.combatState);

  const {
    applyAuthoritativeSync,
    battleView,
    combatState,
    createCombatActionMeta,
    loading,
    pvpCommandRoomStatus,
    restorePendingClientSequence,
    restartScene,
    sceneSnapshot,
    sceneStreamState,
    sendPvpCommandAndWaitForAck,
    startupError,
    stateRefreshSignals,
    stateRefreshVersions,
  } = controller;

  // 论道丹药同样由服务端 inventory_refresh(10302) 帧驱动刷新，不允许只回 ACK。
  const {
    consumables: combatConsumables,
    applyConsumedItem: applyCombatConsumableConsumed,
    lastRefreshedAt: combatInventoryRefreshedAt,
  } = useCombatConsumableInventory({
    inventoryVersion: stateRefreshVersions.inventory,
    inventorySignal: stateRefreshSignals.inventory,
  });

  const clearTransientTimers = useCallback(() => {
    if (activeMotionTimerRef.current !== null) {
      window.clearTimeout(activeMotionTimerRef.current);
    }
    activeMotionTimerRef.current = null;
    popupTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    popupTimerRefs.current = [];
  }, []);

  const pushPopup = useCallback((targetId: string, label: string, kind: PopupState["kind"]) => {
    const id = popupIdRef.current++;
    const createdAtMs = Date.now();
    const durationMs = 1280;
    setPopups((current) => [...current, { id, targetId, label, kind, createdAtMs, durationMs }]);
    const timer = window.setTimeout(() => {
      setPopups((current) => current.filter((item) => item.id !== id));
      popupTimerRefs.current = popupTimerRefs.current.filter((item) => item !== timer);
    }, durationMs);
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
    if (combatState?.status === "ongoing") {
      return;
    }
    animationQueueRef.current = [];
    animationBusyRef.current = false;
    clearTransientTimers();
    setActiveMotion(null);
    setPopups([]);
  }, [clearTransientTimers, combatState?.status]);

  const exitCombatScene = useCallback(() => {
    router.push("/game/map");
  }, [router]);

  const handleAction = useCallback(async (action: "skill" | "surrender", skillId?: string) => {
    if (!combatState || combatState.status !== "ongoing" || acting) {
      return;
    }
    setActing(true);
    const actionMeta = createCombatActionMeta();
    try {
      const useColyseusAction = shouldUsePvpColyseusAction() && pvpCommandRoomStatus === "connected";
      const colyseusResult = useColyseusAction
        ? await sendPvpCommandAndWaitForAck({
          commandType: action,
          ...(skillId ? { skillId } : {}),
          ...(combatState.enemy.id ? { targetId: combatState.enemy.id } : {}),
        }, {
          clientSequence: actionMeta.clientSequence,
          clientSceneTick: actionMeta.clientSceneTick,
          actionId: actionMeta.actionId,
          clientSentAt: actionMeta.clientSentAt,
          timeoutMs: 3500,
        })
        : null;
      const json = colyseusResult
        ? buildPvpResponseFromAck(colyseusResult.ack)
        : buildPvpRealtimeUnavailableResponse("实时论道房间未连接，请稍后重试。");
      applyAuthoritativeSync(json.data);
      if (!json.success) {
        if (typeof json.data?.acceptedClientSequence !== "number") {
          restorePendingClientSequence(actionMeta.clientSequence);
        }
        messageApi.warning(json.error || "论道出手失败");
      }
    } catch {
      restorePendingClientSequence(actionMeta.clientSequence);
      messageApi.error("论道出手失败");
    } finally {
      setActing(false);
    }
  }, [acting, applyAuthoritativeSync, combatState, createCombatActionMeta, messageApi, pvpCommandRoomStatus, restorePendingClientSequence, sendPvpCommandAndWaitForAck]);

  const handleUseItem = useCallback(async (itemId: string) => {
    if (!combatState || combatState.status !== "ongoing" || acting) {
      return;
    }
    setActing(true);
    const actionMeta = createCombatActionMeta();
    try {
      const useColyseusAction = shouldUsePvpColyseusAction() && pvpCommandRoomStatus === "connected";
      const colyseusResult = useColyseusAction
        ? await sendPvpCommandAndWaitForAck({
          commandType: "item",
          itemId,
        }, {
          clientSequence: actionMeta.clientSequence,
          clientSceneTick: actionMeta.clientSceneTick,
          actionId: actionMeta.actionId,
          clientSentAt: actionMeta.clientSentAt,
          timeoutMs: 3500,
        })
        : null;
      const json = colyseusResult
        ? buildPvpResponseFromAck(colyseusResult.ack)
        : buildPvpRealtimeUnavailableResponse("实时论道房间未连接，请稍后再使用丹药。");
      applyAuthoritativeSync(json.data);
      if (!json.success) {
        if (typeof json.data?.acceptedClientSequence !== "number") {
          restorePendingClientSequence(actionMeta.clientSequence);
        }
        messageApi.warning(json.error || "丹药使用失败");
        return;
      }
      applyCombatConsumableConsumed(itemId);
    } catch {
      restorePendingClientSequence(actionMeta.clientSequence);
      messageApi.error("丹药使用失败");
    } finally {
      setActing(false);
    }
  }, [acting, applyAuthoritativeSync, applyCombatConsumableConsumed, combatState, createCombatActionMeta, messageApi, pvpCommandRoomStatus, restorePendingClientSequence, sendPvpCommandAndWaitForAck]);

  const sceneStatusBadge = sceneStreamState === "stale" ? "已断线" : sceneStreamState === "connecting" ? "同步中" : "实时";

  const skillViews = useMemo(() => {
    if (!combatState) {
      return [] as Array<{ id: string; cooldownLeft: number } & SkillView>;
    }
    return combatState.player.skills.map((skillId) => {
      const skill = (battleView?.modePayload?.skillsData as Record<string, SkillView> | undefined)?.[skillId];
      return {
        id: skillId,
        name: skill?.name || skillId,
        skillType: skill?.skillType || "attack",
        mpCost: Number(skill?.mpCost || 0),
        cooldown: Number(skill?.cooldown || 0),
        cooldownLeft: Number(combatState.player.skillCooldowns?.[skillId] || 0),
      };
    });
  }, [battleView?.modePayload, combatState]);

  const stageUnits = useMemo(() => {
    if (!combatState) {
      return [];
    }
    return [
      {
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
      },
      {
        id: combatState.player.id,
        name: combatState.player.name,
        role: "player" as const,
        avatarImageUrl: combatState.player.avatarImageUrl,
        avatarFrameImageUrl: combatState.player.avatarFrameImageUrl,
        fallbackText: getOrbFallbackText(combatState.player),
        isCurrent: battleView?.turnState?.currentTurnPlayerId === combatState.player.id,
        isDead: combatState.player.hp <= 0,
        hp: combatState.player.hp,
        maxHp: combatState.player.maxHp,
        mp: combatState.player.mp,
        maxMp: combatState.player.maxMp,
        activeEffects: combatState.player.activeEffects,
      },
    ];
  }, [battleView?.turnState?.currentTurnPlayerId, combatState]);

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

  const isMyTurn = battleView?.turnState?.currentTurnPlayerId === combatState?.player.id;
  const canAct = Boolean(combatState && combatState.status === "ongoing" && isMyTurn && !acting);
  const logSummary = logExpanded ? `共 ${combatState?.log.length || 0} 条战报` : (combatState?.log[combatState.log.length - 1]?.message || "暂无战报");
  const turnDeadlineMs = combatState?.turnDeadlineAt ? Math.max(0, Date.parse(combatState.turnDeadlineAt) - Date.now()) : 0;
  const turnBannerText = combatState?.status === "ongoing"
    ? isMyTurn
      ? `当前轮到你出手，剩余 ${combatState.turnDeadlineAt ? `${Math.ceil(turnDeadlineMs / 1000)}s` : "--"}`
      : `当前等待 ${combatState?.enemy.name || "对手"} 回应，剩余 ${combatState.turnDeadlineAt ? `${Math.ceil(turnDeadlineMs / 1000)}s` : "--"}`
    : "";

  const renderActionPanel = (className = "combat-action-panel") => (
    <BattleActionPanel
      className={className}
      title="论道出手"
      subtitle={combatState?.status === "ongoing" ? (isMyTurn ? "轮到你了，可以施法、服丹或认输。" : "等待对手回应。") : "本场论道已结束。可返回地图继续游历。"}
      statusLabel={sceneStatusBadge}
      statusHighlighted={Boolean(isMyTurn)}
      commandButtons={[
        {
          key: "repair",
          label: "重新同步",
          disabled: combatState?.status !== "ongoing" || acting,
          onClick: () => {
            void restartScene();
          },
        },
        {
          key: "surrender",
          label: "认输",
          tone: "danger",
          disabled: !canAct,
          onClick: () => {
            void handleAction("surrender");
          },
        },
      ]}
      skills={skillViews.map((skill) => ({
        key: skill.id,
        tag: `MP ${skill.mpCost}`,
        disabled: !canAct || skill.cooldownLeft > 0 || combatState!.player.mp < skill.mpCost,
        onClick: () => {
          void handleAction("skill", skill.id);
        },
        content: <span>{skill.cooldownLeft > 0 ? `${skill.name} (${skill.cooldownLeft})` : skill.name}</span>,
      }))}
      items={combatConsumables.map((item) => ({
        key: item.itemId,
        disabled: !canAct,
        onClick: () => {
          void handleUseItem(item.itemId);
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
      footerButtons={combatState?.status !== "ongoing" ? [
        {
          key: "back",
          label: "返回地图",
          tone: "primary",
          onClick: exitCombatScene,
        },
      ] : []}
    />
  );

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
          title="论道尚未建立"
          description={startupError || "当前无法进入论道，请重新尝试。"}
          primaryActionLabel="重新进入"
          onPrimaryAction={() => void restartScene()}
          secondaryActionLabel="返回地图"
          onSecondaryAction={exitCombatScene}
        />
      </>
    );
  }

  return (
    <>
      {contextHolder}
      <UnifiedBattleShell
        topBanner={turnBannerText ? <div className="combat-sync-strip combat-sync-strip--banner"><span className="combat-sync-chip is-live">{turnBannerText}</span></div> : null}
        header={(
          <BattleViewHeaderCard
            battleView={battleView}
            extraBadges={[sceneStreamState === "live" ? "实时已连接" : sceneStreamState === "connecting" ? "正在重连" : "等待修复"]}
          />
        )}
        topHud={(
          <>
            <div className="combat-ally-slots">
              <CompactCombatUnitStatusCard unit={combatState.player} slotTitle="自己" />
            </div>
            <div>
              <CompactCombatUnitStatusCard unit={combatState.enemy} slotTitle="对手" />
            </div>
          </>
        )}
        primaryContent={(
          <div className={`combat-stage is-${sceneStreamState}`}>
            <BattleStageBackdropCanvas mode="combat" clashActive={Boolean(activeMotion && activeMotion.entryType !== "status")} sceneSnapshot={sceneSnapshot} units={stageUnits.map((unit) => ({ id: unit.id, role: unit.role, isCurrent: unit.isCurrent }))} />
            <BattleStageEntityCanvas mode="combat" units={stageUnits} motion={stageMotion} popups={popups} sceneSnapshot={sceneSnapshot} />
            <div className="combat-stage-ambience" />
            {combatState.status !== "ongoing" ? (
              <div className="combat-finish-mask">
                <div className="combat-finish-title">{combatState.status === "player_win" ? "论道胜出" : combatState.status === "enemy_win" ? "论道落败" : "论道结束"}</div>
              </div>
            ) : null}
          </div>
        )}
        sideRailContent={(
          <>
            <CombatLogFloatingPanel
              entries={combatState.log}
              summary={logSummary}
              open={logExpanded}
              onOpenChange={setLogExpanded}
              logRef={logRef}
              onLogScroll={() => {}}
            />
            {renderActionPanel()}
          </>
        )}
        mobileDock={renderActionPanel("combat-action-panel combat-action-panel--mobile")}
      />
    </>
  );
}
