"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GAME_ROOM_NAMES,
  type CombatCommandPayload,
} from "@immortality/shared-protocol";
import { createActionRequestMeta } from "@/modules/shared/services/action-request";
import {
  buildBattleRepairRequestPayload,
  resolveBattleSceneSnapshotVersion,
} from "@/modules/combat/services/battle-scene-sync";
import { useCombatColyseusRoom } from "@/modules/combat/ui/hooks/useCombatColyseusRoom";
import { useForegroundRepairTrigger } from "@/modules/shared/ui/hooks/useForegroundRepairTrigger";
import type {
  BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import type { BattleViewState, CombatState, CombatTurnState } from "@/types/game";

export type PvpBattleSceneResponse = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  data?: {
    state?: CombatState;
    snapshot?: BattleSceneSnapshot | null;
    sceneSnapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState | null;
    turnState?: CombatTurnState | null;
    acceptedClientSequence?: number;
    settlement?: Record<string, unknown> | null;
  };
};

type MessageApi = {
  error: (content: string) => unknown;
  warning: (content: string) => unknown;
};

export function usePvpBattleSceneController(params: {
  combatId: string;
  messageApi: MessageApi;
}) {
  const { combatId, messageApi } = params;
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [battleView, setBattleView] = useState<BattleViewState | null>(null);
  const [sceneSnapshot, setSceneSnapshot] = useState<BattleSceneSnapshot | null>(null);
  const [turnState, setTurnState] = useState<CombatTurnState | null>(null);
  const [sceneStreamState, setSceneStreamState] = useState<"connecting" | "live" | "stale">("connecting");
  const [lastAcceptedClientSequence, setLastAcceptedClientSequence] = useState(0);

  const nextClientSequenceRef = useRef(1);
  const sceneSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const combatStateRef = useRef<CombatState | null>(null);
  const battleViewRef = useRef<BattleViewState | null>(null);
  const repairRequestPendingRef = useRef(false);
  const lastRepairRequestKeyRef = useRef("");

  useEffect(() => {
    sceneSnapshotRef.current = sceneSnapshot;
  }, [sceneSnapshot]);

  useEffect(() => {
    combatStateRef.current = combatState;
  }, [combatState]);

  useEffect(() => {
    battleViewRef.current = battleView;
  }, [battleView]);

  const resetRepairState = useCallback(() => {
    repairRequestPendingRef.current = false;
    lastRepairRequestKeyRef.current = "";
  }, []);

  const applyAuthoritativeSync = useCallback((data?: PvpBattleSceneResponse["data"]) => {
    if (!data) {
      return;
    }

    const nextSnapshot = data.sceneSnapshot ?? data.snapshot ?? null;
    if (nextSnapshot) {
      sceneSnapshotRef.current = nextSnapshot;
      setSceneSnapshot(nextSnapshot);
    }
    if (data.state) {
      combatStateRef.current = data.state;
      setCombatState(data.state);
    }
    if (data.battleView) {
      battleViewRef.current = data.battleView;
      setBattleView(data.battleView);
    }
    if (data.turnState !== undefined) {
      setTurnState(data.turnState ?? null);
    }
    if (typeof data.acceptedClientSequence === "number") {
      setLastAcceptedClientSequence(data.acceptedClientSequence);
      nextClientSequenceRef.current = Math.max(nextClientSequenceRef.current, data.acceptedClientSequence + 1);
    }
  }, []);

  const fetchScene = useCallback(async () => {
    const response = await fetch(`/api/game/combat/scene?pvpCombatId=${encodeURIComponent(combatId)}`);
    const json = await response.json() as PvpBattleSceneResponse;
    if (!response.ok || !json.success || !json.data?.state) {
      throw new Error(json.error || "论道场景加载失败");
    }
    applyAuthoritativeSync(json.data);
    resetRepairState();
    return json.data;
  }, [applyAuthoritativeSync, combatId, resetRepairState]);

  const requestRepair = useCallback(async (reason: string) => {
    const repairPayload = buildBattleRepairRequestPayload({
      runtimeId: combatId,
      mode: "pvp",
      snapshot: sceneSnapshotRef.current,
      lastConnectionSequence: resolveBattleSceneSnapshotVersion(sceneSnapshotRef.current).connectionSequence,
      reason,
    });
    const repairKey = JSON.stringify(repairPayload);
    if (repairRequestPendingRef.current && lastRepairRequestKeyRef.current === repairKey) {
      return;
    }

    repairRequestPendingRef.current = true;
    lastRepairRequestKeyRef.current = repairKey;

    try {
      await fetchScene();
      setSceneStreamState("live");
    } catch {
      setSceneStreamState("stale");
    } finally {
      repairRequestPendingRef.current = false;
    }
  }, [combatId, fetchScene]);

  const restartScene = useCallback(async () => {
    setLoading(true);
    setStartupError(null);
    try {
      await fetchScene();
      setSceneStreamState("connecting");
    } catch (error) {
      const message = error instanceof Error ? error.message : "论道场景加载失败";
      setStartupError(message);
      messageApi.error(message);
    } finally {
      setLoading(false);
    }
  }, [fetchScene, messageApi]);

  const createCombatActionMeta = useCallback(() => {
    const clientSequence = nextClientSequenceRef.current;
    nextClientSequenceRef.current += 1;
    return createActionRequestMeta({
      clientSequence,
      clientSceneTick: sceneSnapshotRef.current?.tick ?? 0,
    });
  }, []);

  const restorePendingClientSequence = useCallback((clientSequence?: number) => {
    if (typeof clientSequence !== "number") {
      return;
    }
    nextClientSequenceRef.current = Math.max(1, clientSequence);
  }, []);

  const pvpColyseusRoom = useCombatColyseusRoom({
    enabled: Boolean(combatId && combatState?.player.id && combatState.status === "ongoing"),
    roomName: GAME_ROOM_NAMES.pvp,
    combatId,
    playerId: combatState?.player.id || null,
    initialSequence: nextClientSequenceRef.current,
  });
  const pvpColyseusStatus = pvpColyseusRoom.status;
  const sendPvpCommand = pvpColyseusRoom.sendCommand;
  const sendPvpCommandAndWaitForAck = pvpColyseusRoom.sendCommandAndWaitForAck;

  useEffect(() => {
    void restartScene();
  }, [restartScene]);

  useEffect(() => {
    const envelope = pvpColyseusRoom.sceneSnapshot;
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    applyAuthoritativeSync({
      state: authoritativeState.state as CombatState | undefined,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | null | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
      settlement: authoritativeState.settlement as Record<string, unknown> | null | undefined,
      acceptedClientSequence: envelope.acceptedSequence ?? undefined,
    });
    setSceneStreamState("live");
  }, [applyAuthoritativeSync, pvpColyseusRoom.sceneSnapshot]);

  useEffect(() => {
    const envelope = pvpColyseusRoom.lastTimelineEvent;
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    applyAuthoritativeSync({
      state: authoritativeState.state as CombatState | undefined,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | null | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
      settlement: authoritativeState.settlement as Record<string, unknown> | null | undefined,
      acceptedClientSequence: envelope.acceptedSequence ?? undefined,
    });
    setSceneStreamState("live");
  }, [applyAuthoritativeSync, pvpColyseusRoom.lastTimelineEvent]);

  useEffect(() => {
    const envelope = pvpColyseusRoom.lastSettlement;
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    applyAuthoritativeSync({
      state: authoritativeState.state as CombatState | undefined,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | null | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
      settlement: authoritativeState.settlement as Record<string, unknown> | null | undefined,
      acceptedClientSequence: envelope.acceptedSequence ?? undefined,
    });
    setSceneStreamState("live");
  }, [applyAuthoritativeSync, pvpColyseusRoom.lastSettlement]);

  useEffect(() => {
    if (!combatState?.id || combatState.status !== "ongoing") {
      return;
    }
    if (pvpColyseusRoom.status === "connected") {
      resetRepairState();
      setSceneStreamState("live");
      return;
    }
    if (pvpColyseusRoom.status === "connecting" || pvpColyseusRoom.status === "idle") {
      setSceneStreamState("connecting");
      return;
    }
    if (pvpColyseusRoom.status === "error" || pvpColyseusRoom.status === "sdk_unavailable") {
      setSceneStreamState("stale");
    }
  }, [combatState?.id, combatState?.status, pvpColyseusRoom.status, resetRepairState]);

  useEffect(() => {
    if (!combatState?.id || combatState.status !== "ongoing") {
      return;
    }
    let fallbackTimer: number | null = null;
    fallbackTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (sceneStreamState === "stale") {
        void requestRepair("stale_interval");
      }
    }, 5_000);

    return () => {
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, [combatState?.id, combatState?.status, requestRepair, sceneStreamState]);

  // 前后台恢复统一 repair：先拉 HTTP 权威快照，再让 Colyseus 房间补一帧。
  // shared hook 内部已合并 visibilitychange / pageshow / focus，不区分平台。
  useForegroundRepairTrigger({
    enabled: Boolean(combatState?.id && combatState.status === "ongoing"),
    onRepair: (trigger, source) => {
      void requestRepair(source);
      pvpColyseusRoom.sendRepair(trigger, `pvp_${source}`);
    },
  });

  useEffect(() => {
    if (!combatState || combatState.status !== "ongoing" || !turnState?.turnDeadlineAt) {
      return;
    }

    const delayMs = Math.max(0, Date.parse(turnState.turnDeadlineAt) - Date.now());
    const timer = window.setTimeout(() => {
      if (pvpColyseusStatus !== "connected") {
        setSceneStreamState("stale");
        void requestRepair("turn_timeout_colyseus_unavailable");
        return;
      }

      const input = sendPvpCommand({
        commandType: "timeoutAdvance",
        timeoutAdvance: true,
      } satisfies CombatCommandPayload);
      if (!input) {
        setSceneStreamState("stale");
        void requestRepair("turn_timeout_colyseus_missing_connection");
      }
    }, delayMs + 40);

    return () => window.clearTimeout(timer);
  }, [combatState, pvpColyseusStatus, requestRepair, sendPvpCommand, turnState?.turnDeadlineAt]);

  return {
    applyAuthoritativeSync,
    battleView,
    combatState,
    createCombatActionMeta,
    lastAcceptedClientSequence,
    loading,
    restorePendingClientSequence,
    restartScene,
    sceneSnapshot,
    sceneStreamState,
    pvpCommandRoomStatus: pvpColyseusStatus,
    sendPvpCommandAndWaitForAck,
    startupError,
    turnState,
    stateRefreshSignals: pvpColyseusRoom.stateRefreshSignals,
    stateRefreshVersions: pvpColyseusRoom.stateRefreshVersions,
    applyStateRefreshFrame: pvpColyseusRoom.applyStateRefreshFrame,
  };
}
