"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildCombatBattleViewState } from "@/modules/combat/services/battle-view";
import {
  materializeBattleSceneSnapshot,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import { COMBAT_SOLO_MOVEMENT_ENABLED, COMBAT_PLAYER_MOVE_SPEED_PERCENT_PER_SECOND } from "@/modules/combat/services/combat-scene-config";
import {
  isOlderBattleSceneSnapshot,
  resolveBattleSceneSnapshotVersion,
} from "@/modules/combat/services/battle-scene-sync";
import { useCombatColyseusRoom } from "@/modules/combat/ui/hooks/useCombatColyseusRoom";
import { useForegroundRepairTrigger } from "@/modules/shared/ui/hooks/useForegroundRepairTrigger";
import { useRenderClock } from "@/modules/combat/ui/hooks/useRenderClock";
import { createActionRequestMeta } from "@/modules/shared/services/action-request";
import type { AnyStateRefreshEnvelope, RealtimeInputAck } from "@immortality/shared-protocol";
import type {
  BattleViewState,
  CombatSkillVisualEffect,
  CombatState,
  CombatTurnState,
  CombatUnit,
  SkillEffect,
} from "@/types/game";

export type SkillView = {
  name: string;
  skillType: string;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffect[];
  target: string;
  visualEffect?: CombatSkillVisualEffect | null;
};

type CombatApiErrorCode =
  | "ACTION_REQUEST_TIME_SKEW"
  | "COMBAT_SCENE_STALE"
  | "COMBAT_SESSION_MISSING"
  | "COMBAT_SESSION_FINISHED"
  | "COMBAT_SCENE_MISSING";

export type CombatActionApiResponse = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  /** HTTP 事务回传的资产 / 背包 / 进度刷新帧组，客户端必须消费后刷新对应 UI。 */
  refreshFrames?: AnyStateRefreshEnvelope[] | null;
  data?: {
    state?: CombatState;
    sceneSnapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState;
    acceptedClientSequence?: number;
    turnState?: CombatTurnState | null;
  };
};

type CombatSceneProbeResponse = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  data?: {
    snapshot?: BattleSceneSnapshot | null;
    state?: CombatState;
    battleView?: BattleViewState;
  };
};

type CombatStartResponse = {
  success?: boolean;
  error?: string;
  data?: {
    combatId: string;
    partyCombatId?: string;
    state?: CombatState;
    battleView?: BattleViewState;
    player: CombatUnit;
    enemy: CombatUnit;
    skillsData?: Record<string, SkillView>;
    skillRotation?: string[];
    sceneSnapshot?: BattleSceneSnapshot | null;
  };
};

function isCombatFinishedPayload(data?: CombatActionApiResponse["data"] | null) {
  return data?.state?.status && data.state.status !== "ongoing";
}

function moveTowardTarget(current: number, target: number, maxDelta: number) {
  if (!Number.isFinite(maxDelta) || maxDelta <= 0) {
    return current;
  }

  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }
  return current + (Math.sign(delta) * maxDelta);
}

function positionsAlmostEqual(
  left: { xPercent: number; yPercent: number },
  right: { xPercent: number; yPercent: number },
  epsilon = LOCAL_MOVE_PREDICTION_SETTLE_EPSILON,
) {
  return Math.abs(left.xPercent - right.xPercent) <= epsilon
    && Math.abs(left.yPercent - right.yPercent) <= epsilon;
}

type CombatSceneControllerMessageApi = {
  error: (content: string) => unknown;
  warning: (content: string) => unknown;
};

type RecoveryResult = "none" | "synced" | "redirected";

type UseCombatSceneControllerParams = {
  monsterId: string;
  messageApi: CombatSceneControllerMessageApi;
  onRecoveryRedirect?: (errorCode?: string) => void;
  onSessionStart?: () => void;
};

type CombatActionSyncPayload = CombatActionApiResponse["data"];
type CombatProbeSyncPayload = CombatSceneProbeResponse["data"];
type CombatMoveTarget = {
  xPercent: number;
  yPercent: number;
};
type CombatLocalMovePrediction = {
  combatId: string;
  originXPercent: number;
  originYPercent: number;
  targetXPercent: number;
  targetYPercent: number;
  startedAtMs: number;
};

const COMBAT_RECOVERY_ERROR_CODES = new Set<CombatApiErrorCode>([
  "ACTION_REQUEST_TIME_SKEW",
  "COMBAT_SCENE_STALE",
  "COMBAT_SESSION_MISSING",
  "COMBAT_SESSION_FINISHED",
  "COMBAT_SCENE_MISSING",
]);

const COMBAT_RECOVERY_REDIRECT_CODES = new Set<CombatApiErrorCode>([
  "COMBAT_SESSION_MISSING",
  "COMBAT_SESSION_FINISHED",
  "COMBAT_SCENE_MISSING",
]);

const COMBAT_RECOVERY_TEXT_MATCHERS = [
  "combat session",
  "combat scene",
  "战斗会话",
  "战斗场景",
];
const COMBAT_CONNECTION_REPAIR_MAX_GAP = 16;
const LOCAL_MOVE_PREDICTION_CORRECTION_THRESHOLD = 2.4;
const LOCAL_MOVE_PREDICTION_SETTLE_EPSILON = 0.45;
const INVALID_PARTY_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY = "game:invalid-boss-encounter-redirect-guard";
const INVALID_PARTY_ENCOUNTER_REDIRECT_GUARD_TTL_MS = 30_000;

function shouldUseColyseusSoloCombatMovement(activePartyCombatId?: string | null) {
  return !activePartyCombatId;
}

function shouldUseColyseusPartyCombatAdvance(activePartyCombatId?: string | null) {
  return Boolean(activePartyCombatId);
}

function mapCombatMovementAckReasonToErrorCode(reason?: string) {
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
    sceneSnapshot: BattleSceneSnapshot | null;
    battleView: BattleViewState;
    turnState: CombatTurnState | null;
    acceptedClientSequence: number;
    message: string | null;
  }> | undefined;
  return {
    success: ack.accepted,
    error: ack.accepted ? undefined : authoritativeState?.message || "战斗移动失败",
    errorCode: ack.accepted ? undefined : mapCombatMovementAckReasonToErrorCode(ack.reason),
    data: {
      state: authoritativeState?.state,
      sceneSnapshot: authoritativeState?.sceneSnapshot,
      battleView: authoritativeState?.battleView,
      turnState: authoritativeState?.turnState,
      acceptedClientSequence: authoritativeState?.acceptedClientSequence ?? ack.acceptedSequence,
    },
  };
}

function buildCombatMovementRealtimeUnavailableResponse(): CombatActionApiResponse {
  return {
    success: false,
    error: "实时战斗房间未连接，请稍后再移动。",
    errorCode: "COMBAT_REALTIME_UNAVAILABLE",
    data: {},
  };
}

async function readCombatMoveResponse(response: Response, fallbackError: string): Promise<CombatActionApiResponse> {
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

function buildInvalidPartyEncounterRoutePath(pathname: string, encounterId?: string | null) {
  const normalizedPath = pathname.trim();
  const normalizedEncounterId = typeof encounterId === "string" ? encounterId.trim() : "";
  if (!normalizedPath || !normalizedEncounterId) {
    return "";
  }
  return `${normalizedPath}?partyCombatId=${encodeURIComponent(normalizedEncounterId)}`;
}

function persistInvalidPartyEncounterRedirectGuard(params: {
  pathname: string;
  encounterId?: string | null;
}) {
  if (typeof window === "undefined") {
    return;
  }

  const routePath = buildInvalidPartyEncounterRoutePath(params.pathname, params.encounterId);
  const encounterId = typeof params.encounterId === "string" ? params.encounterId.trim() : "";
  if (!routePath || !encounterId) {
    return;
  }

  try {
    window.sessionStorage.setItem(INVALID_PARTY_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY, JSON.stringify({
      encounterId,
      routePath,
      expiresAt: Date.now() + INVALID_PARTY_ENCOUNTER_REDIRECT_GUARD_TTL_MS,
    }));
  } catch {
    // sessionStorage 不可用时忽略。
  }
}

function normalizeCombatRecoveryCode(errorCode?: unknown) {
  if (typeof errorCode !== "string") {
    return "UNKNOWN_COMBAT_ERROR";
  }

  const normalized = errorCode.trim().toUpperCase();
  return normalized || "UNKNOWN_COMBAT_ERROR";
}

function shouldProbeCombatSession(params: {
  status: number;
  errorCode?: unknown;
  error?: unknown;
}) {
  const normalizedCode = normalizeCombatRecoveryCode(params.errorCode);
  if (COMBAT_RECOVERY_ERROR_CODES.has(normalizedCode as CombatApiErrorCode)) {
    return true;
  }

  if (params.status === 404) {
    return true;
  }

  if (typeof params.error !== "string") {
    return false;
  }

  const normalizedError = params.error.toLowerCase();
  return COMBAT_RECOVERY_TEXT_MATCHERS.some((matcher) => normalizedError.includes(matcher));
}

function isCombatStateSettled(state?: CombatState | null) {
  return Boolean(state?.status && state.status !== "ongoing");
}

function createFallbackCombatState(params: {
  combatId: string;
  player: CombatUnit;
  enemy: CombatUnit;
}) {
  return {
    id: params.combatId,
    turn: 0,
    player: params.player,
    enemy: params.enemy,
    log: [{
      turn: 0,
      actorName: "系统",
      action: "战斗开始",
      entryType: "system" as const,
      targetId: params.enemy.id,
      message: `${params.enemy.name} 已进入战斗场景。`,
    }],
    status: "ongoing" as const,
  } satisfies CombatState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function useCombatSceneController(params: UseCombatSceneControllerParams) {
  const { monsterId, messageApi, onRecoveryRedirect, onSessionStart } = params;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialPartyCombatId = searchParams.get("partyCombatId")?.trim() || "";
  const initialObservedMonsterPositionX = searchParams.get("mx")?.trim() || "";
  const initialObservedMonsterPositionY = searchParams.get("my")?.trim() || "";
  const initialWorldAssassinationId = searchParams.get("worldAssassinationId")?.trim() || "";

  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [skillsData, setSkillsData] = useState<Record<string, SkillView>>({});
  const [skillRotation, setSkillRotation] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sceneSnapshot, setSceneSnapshot] = useState<BattleSceneSnapshot | null>(null);
  const [battleView, setBattleView] = useState<BattleViewState | null>(null);
  const [lastAcceptedClientSequence, setLastAcceptedClientSequence] = useState(0);
  const [nextClientSequence, setNextClientSequence] = useState(1);
  const [sceneStreamState, setSceneStreamState] = useState<"connecting" | "live" | "stale">("connecting");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [activePartyCombatId, setActivePartyCombatId] = useState(initialPartyCombatId);
  const [movePipelinePending, setMovePipelinePending] = useState(false);
  const [hasLocalMovePrediction, setHasLocalMovePrediction] = useState(false);

  const nextClientSequenceRef = useRef(1);
  const startupRequestRef = useRef(0);
  const startCombatRef = useRef<() => Promise<void>>(async () => {});
  const processQueuedMoveTargetRef = useRef<() => Promise<void>>(async () => {});
  const sceneSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const combatStateRef = useRef<CombatState | null>(null);
  const activePartyCombatIdRef = useRef(activePartyCombatId);
  const battleViewRef = useRef<BattleViewState | null>(null);
  const queuedMoveTargetRef = useRef<CombatMoveTarget | null>(null);
  const inFlightMoveTargetRef = useRef<CombatMoveTarget | null>(null);
  const moveRequestInFlightRef = useRef(false);
  const localMovePredictionRef = useRef<CombatLocalMovePrediction | null>(null);
  const repairRequestPendingRef = useRef(false);
  const lastRepairRequestKeyRef = useRef("");

  const syncMovePipelinePendingState = useCallback(() => {
    setMovePipelinePending(COMBAT_SOLO_MOVEMENT_ENABLED && (moveRequestInFlightRef.current || Boolean(queuedMoveTargetRef.current)));
  }, []);

  const resolveAuthoritativePlayerPosition = useCallback((
    snapshot?: BattleSceneSnapshot | null,
    state?: CombatState | null,
  ) => {
    const targetSnapshot = snapshot || sceneSnapshotRef.current;
    const targetState = state || combatStateRef.current;
    const playerId = targetState?.player.id;
    if (!playerId || !targetSnapshot) {
      return null;
    }
    const unit = targetSnapshot.units.find((item) => item.id === playerId);
    if (!unit) {
      return null;
    }
    return {
      xPercent: unit.xPercent,
      yPercent: unit.yPercent,
    } satisfies CombatMoveTarget;
  }, []);

  const resolveLocalMovePredictionPosition = useCallback((nowMs: number) => {
    const prediction = localMovePredictionRef.current;
    if (!prediction) {
      return null;
    }

    const elapsedSeconds = Math.max(0, nowMs - prediction.startedAtMs) / 1000;
    const maxDelta = COMBAT_PLAYER_MOVE_SPEED_PERCENT_PER_SECOND * elapsedSeconds;
    const xPercent = moveTowardTarget(prediction.originXPercent, prediction.targetXPercent, maxDelta);
    const yPercent = moveTowardTarget(prediction.originYPercent, prediction.targetYPercent, maxDelta);

    return {
      xPercent,
      yPercent,
      completed: positionsAlmostEqual(
        { xPercent, yPercent },
        {
          xPercent: prediction.targetXPercent,
          yPercent: prediction.targetYPercent,
        },
      ),
    };
  }, []);

  const clearLocalMovePrediction = useCallback(() => {
    localMovePredictionRef.current = null;
    setHasLocalMovePrediction(false);
  }, []);

  const retargetLocalMovePrediction = useCallback((target: CombatMoveTarget) => {
    if (!COMBAT_SOLO_MOVEMENT_ENABLED) {
      clearLocalMovePrediction();
      return;
    }
    const combatId = combatStateRef.current?.id;
    if (!combatId) {
      clearLocalMovePrediction();
      return;
    }

    const nowMs = Date.now();
    const currentPredicted = resolveLocalMovePredictionPosition(nowMs);
    const origin = currentPredicted
      ? {
        xPercent: currentPredicted.xPercent,
        yPercent: currentPredicted.yPercent,
      }
      : resolveAuthoritativePlayerPosition();

    if (!origin) {
      clearLocalMovePrediction();
      return;
    }

    localMovePredictionRef.current = {
      combatId,
      originXPercent: origin.xPercent,
      originYPercent: origin.yPercent,
      targetXPercent: target.xPercent,
      targetYPercent: target.yPercent,
      startedAtMs: nowMs,
    };
    setHasLocalMovePrediction(true);
  }, [clearLocalMovePrediction, resolveAuthoritativePlayerPosition, resolveLocalMovePredictionPosition]);

  const reconcileLocalMovePrediction = useCallback((
    snapshot?: BattleSceneSnapshot | null,
    state?: CombatState | null,
  ) => {
    const prediction = localMovePredictionRef.current;
    if (!prediction) {
      return;
    }

    const authoritativePosition = resolveAuthoritativePlayerPosition(snapshot, state);
    if (!authoritativePosition) {
      clearLocalMovePrediction();
      return;
    }

    const authoritativePlayerId = state?.player.id || combatStateRef.current?.player.id;
    const authoritativePlayerUnit = authoritativePlayerId && snapshot
      ? snapshot.units.find((unit) => unit.id === authoritativePlayerId) || null
      : null;
    const hasAuthoritativeActionTimeline = Boolean((snapshot?.timeline || []).some(
      (event) => (event.channel || "action") === "action",
    ));
    if (hasAuthoritativeActionTimeline) {
      clearLocalMovePrediction();
      return;
    }

    if (
      authoritativePlayerUnit
      && authoritativePlayerUnit.moveState !== "moving"
      && !moveRequestInFlightRef.current
      && !queuedMoveTargetRef.current
    ) {
      clearLocalMovePrediction();
      return;
    }

    const currentPredicted = resolveLocalMovePredictionPosition(Date.now());
    if (!currentPredicted) {
      clearLocalMovePrediction();
      return;
    }

    if (
      Math.abs(authoritativePosition.xPercent - currentPredicted.xPercent) > LOCAL_MOVE_PREDICTION_CORRECTION_THRESHOLD
      || Math.abs(authoritativePosition.yPercent - currentPredicted.yPercent) > LOCAL_MOVE_PREDICTION_CORRECTION_THRESHOLD
    ) {
      const latestTarget = queuedMoveTargetRef.current
        || inFlightMoveTargetRef.current
        || {
          xPercent: prediction.targetXPercent,
          yPercent: prediction.targetYPercent,
        };
      if (latestTarget && !positionsAlmostEqual(authoritativePosition, latestTarget)) {
        localMovePredictionRef.current = {
          ...prediction,
          originXPercent: authoritativePosition.xPercent,
          originYPercent: authoritativePosition.yPercent,
          targetXPercent: latestTarget.xPercent,
          targetYPercent: latestTarget.yPercent,
          startedAtMs: Date.now(),
        };
        setHasLocalMovePrediction(true);
        return;
      }

      clearLocalMovePrediction();
      return;
    }

    if (!moveRequestInFlightRef.current && !queuedMoveTargetRef.current) {
      if (
        positionsAlmostEqual(authoritativePosition, currentPredicted)
        || positionsAlmostEqual(authoritativePosition, {
          xPercent: prediction.targetXPercent,
          yPercent: prediction.targetYPercent,
        })
      ) {
        clearLocalMovePrediction();
      }
    }
  }, [
    clearLocalMovePrediction,
    resolveAuthoritativePlayerPosition,
    resolveLocalMovePredictionPosition,
  ]);

  useEffect(() => {
    setActivePartyCombatId(initialPartyCombatId);
  }, [initialPartyCombatId]);

  useEffect(() => {
    activePartyCombatIdRef.current = activePartyCombatId;
  }, [activePartyCombatId]);

  useEffect(() => {
    sceneSnapshotRef.current = sceneSnapshot;
  }, [sceneSnapshot]);

  useEffect(() => {
    combatStateRef.current = combatState;
  }, [combatState]);

  useEffect(() => {
    battleViewRef.current = battleView;
  }, [battleView]);

  useEffect(() => {
    queuedMoveTargetRef.current = null;
    inFlightMoveTargetRef.current = null;
    moveRequestInFlightRef.current = false;
    syncMovePipelinePendingState();
    clearLocalMovePrediction();
  }, [clearLocalMovePrediction, combatState?.id, combatState?.status, syncMovePipelinePendingState]);

  const sceneTick = sceneSnapshot?.tick ?? 0;
  const predictionRenderClockMs = useRenderClock(hasLocalMovePrediction);
  const predictedPlayerPosition = useMemo(() => {
    if (!hasLocalMovePrediction) {
      return null;
    }

    const nextPosition = resolveLocalMovePredictionPosition(predictionRenderClockMs);
    if (!nextPosition) {
      return null;
    }

    return {
      xPercent: nextPosition.xPercent,
      yPercent: nextPosition.yPercent,
    } satisfies CombatMoveTarget;
  }, [hasLocalMovePrediction, predictionRenderClockMs, resolveLocalMovePredictionPosition]);

  const resetClientSequence = useCallback(() => {
    nextClientSequenceRef.current = 1;
    setNextClientSequence(1);
    setLastAcceptedClientSequence(0);
  }, []);

  const syncAcceptedClientSequence = useCallback((
    acceptedClientSequence?: number,
    options?: { requestedClientSequence?: number },
  ) => {
    if (typeof acceptedClientSequence !== "number") {
      return;
    }

    setLastAcceptedClientSequence(acceptedClientSequence);
    const requestedClientSequence = options?.requestedClientSequence;
    const nextSequence = typeof requestedClientSequence === "number" && acceptedClientSequence < requestedClientSequence
      ? Math.max(1, acceptedClientSequence + 1)
      : Math.max(
        nextClientSequenceRef.current,
        acceptedClientSequence + 1,
      );
    nextClientSequenceRef.current = nextSequence;
    setNextClientSequence(nextSequence);
  }, []);

  const restorePendingClientSequence = useCallback((clientSequence?: number) => {
    if (typeof clientSequence !== "number") {
      return;
    }

    const nextSequence = Math.max(1, clientSequence);
    nextClientSequenceRef.current = nextSequence;
    setNextClientSequence(nextSequence);
  }, []);

  const createCombatActionMeta = useCallback(() => {
    const clientSequence = nextClientSequenceRef.current;
    const nextSequence = clientSequence + 1;
    nextClientSequenceRef.current = nextSequence;
    setNextClientSequence(nextSequence);
    const latestSceneTick = sceneSnapshotRef.current?.tick ?? 0;

    return createActionRequestMeta({
      clientSequence,
      clientSceneTick: latestSceneTick,
    });
  }, []);

  const resetRealtimeRepairState = useCallback(() => {
    repairRequestPendingRef.current = false;
    lastRepairRequestKeyRef.current = "";
  }, []);

  const resolveBattleView = useCallback((params?: {
    state?: CombatState | null;
    snapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState | null;
    turnState?: CombatTurnState | null;
  }) => {
    const nextState = params?.state || combatStateRef.current;
    const nextSnapshot = params?.snapshot ?? sceneSnapshotRef.current ?? null;
    const explicitBattleView = params?.battleView || null;
    const hasExplicitTurnState = Boolean(params && Object.prototype.hasOwnProperty.call(params, "turnState"));
    const nextTurnState = hasExplicitTurnState
      ? (params?.turnState ?? null)
      : explicitBattleView
        ? (explicitBattleView.turnState ?? null)
        : (battleViewRef.current?.turnState ?? null);

    if (explicitBattleView) {
      return {
        ...explicitBattleView,
        sceneSnapshot: nextSnapshot ?? explicitBattleView.sceneSnapshot ?? null,
        turnState: nextTurnState,
      } satisfies BattleViewState;
    }

    if (!nextState) {
      return battleViewRef.current;
    }

    const derivedBattleView = buildCombatBattleViewState({
      runtimeId: nextState.id,
      mode: nextState.mode === "party" || Boolean(activePartyCombatIdRef.current) ? "party" : "solo",
      state: nextState,
      sceneSnapshot: nextSnapshot,
      turnState: nextTurnState,
      viewerPlayerId: nextState.player.id,
    });

    return {
      ...derivedBattleView,
      modePayload: derivedBattleView.modePayload || battleViewRef.current?.modePayload || null,
    } satisfies BattleViewState;
  }, []);

  const probeCombatScene = useCallback(async () => {
    const combatId = combatStateRef.current?.id;
    if (!combatId) {
      return false;
    }

    const partyCombatId = activePartyCombatIdRef.current;
    const query = partyCombatId
      ? `partyCombatId=${encodeURIComponent(partyCombatId)}`
      : `combatId=${encodeURIComponent(combatId)}`;

    try {
      const response = await fetch(`/api/game/combat/scene?${query}`, {
        cache: "no-store",
      });
      const json = await response.json() as CombatSceneProbeResponse;

      if (!json.success) {
        const normalizedCode = normalizeCombatRecoveryCode(json.errorCode);
        if (response.status === 404 || COMBAT_RECOVERY_REDIRECT_CODES.has(normalizedCode as CombatApiErrorCode)) {
          if (partyCombatId) {
            persistInvalidPartyEncounterRedirectGuard({
              pathname,
              encounterId: partyCombatId,
            });
            setActivePartyCombatId("");
          }
          onRecoveryRedirect?.(normalizedCode);
        }
        return false;
      }

      resetRealtimeRepairState();
      if (json.data) {
        if (json.data.snapshot) {
          const materializedSnapshot = materializeBattleSceneSnapshot(
            sceneSnapshotRef.current,
            json.data.snapshot as BattleSceneSnapshot,
          );
          if (materializedSnapshot) {
            sceneSnapshotRef.current = materializedSnapshot;
            setSceneSnapshot(materializedSnapshot);
            setSceneStreamState("live");
            reconcileLocalMovePrediction(materializedSnapshot, json.data.state);
          }
        }
        if (json.data.state) {
          setCombatState(json.data.state);
        }
        setBattleView(resolveBattleView({
          state: json.data.state,
          snapshot: sceneSnapshotRef.current,
          battleView: json.data.battleView || null,
        }) || null);
      }
      return true;
    } catch {
      return false;
    }
  }, [onRecoveryRedirect, pathname, reconcileLocalMovePrediction, resetRealtimeRepairState, resolveBattleView]);

  const applyLiveSceneSync = useCallback((
    snapshot?: BattleSceneSnapshot | null,
    state?: CombatState,
  ) => {
    if (snapshot) {
      const currentSnapshotVersion = resolveBattleSceneSnapshotVersion(sceneSnapshotRef.current);
      const incomingSnapshotVersion = resolveBattleSceneSnapshotVersion(snapshot);
      const materializedSnapshot = materializeBattleSceneSnapshot(sceneSnapshotRef.current, snapshot);
      if (!materializedSnapshot) {
        const incomingBaseConnectionSequence = typeof snapshot.baseConnectionSequence === "number"
          ? Math.max(0, Math.floor(snapshot.baseConnectionSequence))
          : 0;
        const connectionGap = incomingBaseConnectionSequence - currentSnapshotVersion.connectionSequence;

        if (incomingSnapshotVersion.runtimeVersion > currentSnapshotVersion.runtimeVersion) {
          void probeCombatScene();
          return false;
        }

        if (connectionGap > 0 && connectionGap <= COMBAT_CONNECTION_REPAIR_MAX_GAP) {
          void probeCombatScene();
          return false;
        }

        if (incomingSnapshotVersion.sceneVersion > currentSnapshotVersion.sceneVersion) {
          void probeCombatScene();
          return false;
        }

        void probeCombatScene();
        return false;
      }
      if (isOlderBattleSceneSnapshot(materializedSnapshot, sceneSnapshotRef.current)) {
        return false;
      }
      resetRealtimeRepairState();
      sceneSnapshotRef.current = materializedSnapshot;
      setSceneSnapshot(materializedSnapshot);
      setSceneStreamState("live");
      reconcileLocalMovePrediction(materializedSnapshot, state);
    }

    if (state) {
      setCombatState(state);
    }
    setBattleView(resolveBattleView({
      state,
      snapshot: sceneSnapshotRef.current,
    }) || null);

    return true;
  }, [probeCombatScene, reconcileLocalMovePrediction, resetRealtimeRepairState, resolveBattleView]);

  const applyProbeSync = useCallback((data?: CombatProbeSyncPayload | null) => {
    if (!data) {
      return;
    }

    if (data.snapshot) {
      applyLiveSceneSync(data.snapshot as BattleSceneSnapshot, data.state);
      return;
    }

    if (data.state) {
      setCombatState(data.state);
    }
    setBattleView(resolveBattleView({
      state: data.state,
      battleView: data.battleView || null,
    }) || null);
  }, [applyLiveSceneSync, resolveBattleView]);

  const applyAuthoritativeSync = useCallback((
    data?: CombatActionSyncPayload | null,
    options?: { requestedClientSequence?: number },
  ) => {
    if (!data) {
      return;
    }

    syncAcceptedClientSequence(data.acceptedClientSequence, options);

    if (data.sceneSnapshot) {
      const materializedSnapshot = materializeBattleSceneSnapshot(
        sceneSnapshotRef.current,
        data.sceneSnapshot as BattleSceneSnapshot,
      );
      if (materializedSnapshot) {
        resetRealtimeRepairState();
        sceneSnapshotRef.current = materializedSnapshot;
        setSceneSnapshot(materializedSnapshot);
        setSceneStreamState("live");
        reconcileLocalMovePrediction(materializedSnapshot, data.state);
      }
    }

    if (data.state) {
      setCombatState(data.state);
    }
    setBattleView(resolveBattleView({
      state: data.state,
      snapshot: sceneSnapshotRef.current,
      battleView: data.battleView || null,
      turnState: data.turnState || null,
    }) || null);
  }, [reconcileLocalMovePrediction, resetRealtimeRepairState, resolveBattleView, syncAcceptedClientSequence]);

  const combatColyseusRoom = useCombatColyseusRoom({
    enabled: Boolean(combatState?.id && combatState.status === "ongoing"),
    combatId: combatState?.id || null,
    playerId: combatState?.player.id || null,
    partyId: activePartyCombatId || null,
    initialSequence: nextClientSequence,
  });

  useEffect(() => {
    const envelope = combatColyseusRoom.sceneSnapshot;
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    applyAuthoritativeSync({
      state: authoritativeState.state as CombatState | undefined,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
      acceptedClientSequence: envelope.acceptedSequence ?? undefined,
    });

    if (isRecord(authoritativeState.skillsData)) {
      setSkillsData(authoritativeState.skillsData as Record<string, SkillView>);
    }
    if (Array.isArray(authoritativeState.skillRotation)) {
      setSkillRotation(authoritativeState.skillRotation);
    }
    setSceneStreamState("live");
  }, [applyAuthoritativeSync, combatColyseusRoom.sceneSnapshot]);

  useEffect(() => {
    const envelope = combatColyseusRoom.lastTimelineEvent;
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    applyAuthoritativeSync({
      state: authoritativeState.state as CombatState | undefined,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
      acceptedClientSequence: envelope.acceptedSequence ?? undefined,
    });
    setSceneStreamState("live");
  }, [applyAuthoritativeSync, combatColyseusRoom.lastTimelineEvent]);

  useEffect(() => {
    const envelope = combatColyseusRoom.lastSettlement;
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    applyAuthoritativeSync({
      state: authoritativeState.state as CombatState | undefined,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
      acceptedClientSequence: envelope.acceptedSequence ?? undefined,
    });
    setSceneStreamState("live");
  }, [applyAuthoritativeSync, combatColyseusRoom.lastSettlement]);

  useEffect(() => {
    if (!combatState?.id || combatState.status !== "ongoing") {
      return;
    }
    if (combatColyseusRoom.status === "connected") {
      setSceneStreamState("live");
      return;
    }
    if (combatColyseusRoom.status === "connecting" || combatColyseusRoom.status === "idle") {
      setSceneStreamState("connecting");
      return;
    }
    if (combatColyseusRoom.status === "error" || combatColyseusRoom.status === "sdk_unavailable") {
      setSceneStreamState("stale");
    }
  }, [combatColyseusRoom.status, combatState?.id, combatState?.status]);

  const markSceneStale = useCallback(() => {
    setSceneStreamState("stale");
  }, []);

  const recoverMissingCombatSession = useCallback(async (
    combatId: string,
    fallbackErrorCode?: string,
  ): Promise<RecoveryResult> => {
    if (isCombatStateSettled(combatStateRef.current)) {
      return "none";
    }

    try {
      const query = activePartyCombatId
        ? `partyCombatId=${encodeURIComponent(activePartyCombatId)}`
        : `combatId=${encodeURIComponent(combatId)}`;
      const response = await fetch(`/api/game/combat/scene?${query}`, {
        cache: "no-store",
      });
      const json = await response.json() as CombatSceneProbeResponse;

      if (json.success && json.data?.snapshot && json.data?.state) {
        applyProbeSync(json.data);
        return "synced";
      }

      const normalizedCode = normalizeCombatRecoveryCode(json.errorCode || fallbackErrorCode);
      if (response.status === 404 || COMBAT_RECOVERY_REDIRECT_CODES.has(normalizedCode as CombatApiErrorCode)) {
        if (activePartyCombatId) {
          persistInvalidPartyEncounterRedirectGuard({
            pathname,
            encounterId: activePartyCombatId,
          });
          setActivePartyCombatId("");
        }
        onRecoveryRedirect?.(normalizedCode);
        return "redirected";
      }
    } catch {
      setSceneStreamState("stale");
    }

    return "none";
  }, [activePartyCombatId, applyProbeSync, onRecoveryRedirect, pathname]);

  const handleCombatFailureRecovery = useCallback(async (failure: {
    combatId: string;
    status: number;
    errorCode?: string;
    error?: string;
  }) => {
    if (!shouldProbeCombatSession(failure)) {
      return "none" as const;
    }

    return recoverMissingCombatSession(failure.combatId, failure.errorCode);
  }, [recoverMissingCombatSession]);

  const submitHttpCombatMove = useCallback(async (params: {
    combatId: string;
    target: CombatMoveTarget;
    actionMeta: ReturnType<typeof createCombatActionMeta>;
  }) => {
    const activePartyCombatId = activePartyCombatIdRef.current;
    if (activePartyCombatId) {
      return buildCombatMovementRealtimeUnavailableResponse();
    }

    const response = await fetch("/api/game/combat/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        combatId: params.combatId,
        targetXPercent: params.target.xPercent,
        targetYPercent: params.target.yPercent,
        clientSequence: params.actionMeta.clientSequence,
        clientSceneTick: params.actionMeta.clientSceneTick,
        actionId: params.actionMeta.actionId,
        clientSentAt: params.actionMeta.clientSentAt,
      }),
    });
    return readCombatMoveResponse(response, "移动失败");
  }, []);

  const startCombat = useCallback(async () => {
    const requestId = startupRequestRef.current + 1;
    startupRequestRef.current = requestId;
    setLoading(true);
    setStartupError(null);
    setBattleView(null);

    const isStaleRequest = () => startupRequestRef.current !== requestId;

    const runStartCombat = async (attempt: number): Promise<void> => {
      try {
        const response = await fetch("/api/game/combat/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            monsterId,
            ...(activePartyCombatId ? { partyCombatId: activePartyCombatId } : {}),
            ...(initialObservedMonsterPositionX ? { observedMonsterPositionX: Number(initialObservedMonsterPositionX) } : {}),
            ...(initialObservedMonsterPositionY ? { observedMonsterPositionY: Number(initialObservedMonsterPositionY) } : {}),
            ...(initialWorldAssassinationId ? { worldAssassinationId: initialWorldAssassinationId } : {}),
          }),
        });
        const text = await response.text();
        const json = text ? JSON.parse(text) as CombatStartResponse : null;

        if (isStaleRequest()) {
          return;
        }

        if (!response.ok || !json?.success || !json.data) {
          if (attempt < 1 && response.status >= 500) {
            await new Promise((resolve) => window.setTimeout(resolve, 260));
            if (!isStaleRequest()) {
              await runStartCombat(attempt + 1);
            }
            return;
          }

          const errorMessage = json?.error || `战斗启动失败${response.status ? ` (${response.status})` : ""}`;
          if (response.status === 404 && activePartyCombatId) {
            persistInvalidPartyEncounterRedirectGuard({
              pathname,
              encounterId: activePartyCombatId,
            });
            setActivePartyCombatId("");
          }
          setCombatState(null);
          setBattleView(null);
          setStartupError(errorMessage);
          messageApi.error(errorMessage);
          return;
        }

        const {
          combatId,
          partyCombatId: returnedPartyCombatId,
          state,
          player,
          enemy,
          skillsData: receivedSkillsData,
          skillRotation: receivedRotation,
          sceneSnapshot: receivedSceneSnapshot,
        } = json.data;
        const effectivePartyCombatId = returnedPartyCombatId || activePartyCombatId || "";

        setSkillsData(receivedSkillsData || {});
        setSkillRotation(Array.isArray(receivedRotation) ? receivedRotation : []);
        const initialSceneSnapshot = materializeBattleSceneSnapshot(
          null,
          (receivedSceneSnapshot as BattleSceneSnapshot | null) || null,
        );
        const resolvedState = state || createFallbackCombatState({
          combatId,
          player,
          enemy,
        });
        sceneSnapshotRef.current = initialSceneSnapshot;
        setSceneSnapshot(initialSceneSnapshot);
        setBattleView(resolveBattleView({
          state: resolvedState,
          snapshot: initialSceneSnapshot,
          battleView: json.data.battleView || null,
        }) || null);
        setSceneStreamState("connecting");
        resetClientSequence();
        onSessionStart?.();
        setActivePartyCombatId(effectivePartyCombatId);

        if (effectivePartyCombatId && initialPartyCombatId !== effectivePartyCombatId) {
          router.replace(`${pathname}?partyCombatId=${encodeURIComponent(effectivePartyCombatId)}`);
        }

        setCombatState(resolvedState);
      } catch {
        if (isStaleRequest()) {
          return;
        }

        if (attempt < 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 260));
          if (!isStaleRequest()) {
            await runStartCombat(attempt + 1);
          }
          return;
        }

        const errorMessage = "战斗启动失败，请稍后再试。";
        setCombatState(null);
        setBattleView(null);
        setStartupError(errorMessage);
        messageApi.error(errorMessage);
      }
    };

    try {
      await runStartCombat(0);
    } finally {
      if (!isStaleRequest()) {
        setLoading(false);
      }
    }
  }, [
    activePartyCombatId,
    initialObservedMonsterPositionX,
    initialObservedMonsterPositionY,
    initialWorldAssassinationId,
    initialPartyCombatId,
    messageApi,
    monsterId,
    onSessionStart,
    pathname,
    resetClientSequence,
    resolveBattleView,
    router,
  ]);

  useEffect(() => {
    startCombatRef.current = startCombat;
  }, [startCombat]);

  useEffect(() => {
    void startCombatRef.current();
  }, [initialPartyCombatId, monsterId]);

  useEffect(() => () => {
    startupRequestRef.current += 1;
  }, []);

  useEffect(() => {
    if (!combatState?.id) {
      return;
    }

    if (combatState.status !== "ongoing") {
      resetRealtimeRepairState();
      setSceneStreamState("live");
      return;
    }

    setSceneStreamState("connecting");

    if (!sceneSnapshotRef.current) {
      void probeCombatScene();
    }

    return () => {
      resetRealtimeRepairState();
    };
  }, [combatState?.id, combatState?.status, probeCombatScene, resetRealtimeRepairState]);

  // iOS 锁屏 / 切后台回到前台后，先把 HTTP 权威快照拉回来，再让 Colyseus
  // 房间补一帧 repair；两者共用 shared 前后台触发器，不区分平台。
  useForegroundRepairTrigger({
    enabled: Boolean(combatState?.id && combatState.status === "ongoing"),
    onRepair: (trigger, source) => {
      void probeCombatScene();
      combatColyseusRoom.sendRepair(trigger, `combat_${source}`);
    },
  });

  useEffect(() => {
    if (!activePartyCombatId || !combatState || combatState.status !== "ongoing" || !combatState.turnDeadlineAt) {
      return;
    }

    const delayMs = Math.max(0, Date.parse(combatState.turnDeadlineAt) - Date.now());
    const timer = window.setTimeout(async () => {
      const actionMeta = createCombatActionMeta();
      try {
        const useColyseusAdvance = shouldUseColyseusPartyCombatAdvance(activePartyCombatId)
          && combatColyseusRoom.status === "connected";
        const colyseusResult = useColyseusAdvance
          ? await combatColyseusRoom.sendCommandAndWaitForAck({
            commandType: "timeoutAdvance",
          }, {
            clientSequence: actionMeta.clientSequence,
            actionId: actionMeta.actionId,
            clientSentAt: actionMeta.clientSentAt,
            timeoutMs: 3500,
          })
          : null;
        const json = colyseusResult
          ? buildCombatActionResponseFromAck(colyseusResult.ack)
          : {
            success: false,
            error: "实时组队战斗房间未连接，请稍后重试。",
            errorCode: "COMBAT_REALTIME_UNAVAILABLE",
            data: {},
          } satisfies CombatActionApiResponse;
        if (!json.success) {
          if (typeof json.data?.acceptedClientSequence !== "number") {
            restorePendingClientSequence(actionMeta.clientSequence);
          }
          return;
        }

        applyAuthoritativeSync(json.data, {
          requestedClientSequence: actionMeta.clientSequence,
        });
      } catch {
        restorePendingClientSequence(actionMeta.clientSequence);
        setSceneStreamState("stale");
      }
    }, delayMs + 40);

    return () => window.clearTimeout(timer);
  }, [activePartyCombatId, applyAuthoritativeSync, combatColyseusRoom, combatState, createCombatActionMeta, restorePendingClientSequence]);

  const processQueuedMoveTarget = useCallback(async () => {
    if (!COMBAT_SOLO_MOVEMENT_ENABLED) {
      queuedMoveTargetRef.current = null;
      inFlightMoveTargetRef.current = null;
      moveRequestInFlightRef.current = false;
      clearLocalMovePrediction();
      syncMovePipelinePendingState();
      return;
    }
    if (moveRequestInFlightRef.current) {
      return;
    }

    const currentCombatState = combatStateRef.current;
    if (!currentCombatState || currentCombatState.status !== "ongoing") {
      queuedMoveTargetRef.current = null;
      inFlightMoveTargetRef.current = null;
      syncMovePipelinePendingState();
      return;
    }

    const nextTarget = queuedMoveTargetRef.current;
    if (!nextTarget) {
      syncMovePipelinePendingState();
      return;
    }

    if (activePartyCombatIdRef.current) {
      queuedMoveTargetRef.current = null;
      inFlightMoveTargetRef.current = null;
      clearLocalMovePrediction();
      syncMovePipelinePendingState();
      return;
    }

    queuedMoveTargetRef.current = null;
    inFlightMoveTargetRef.current = nextTarget;
    moveRequestInFlightRef.current = true;
    syncMovePipelinePendingState();

    const actionMeta = createCombatActionMeta();

    try {
      const activePartyCombatId = activePartyCombatIdRef.current;
      const useColyseusMovement = shouldUseColyseusSoloCombatMovement(activePartyCombatId)
        && combatColyseusRoom.status === "connected";
      const colyseusResult = useColyseusMovement
        ? await combatColyseusRoom.sendMovementAndWaitForAck({
          x: nextTarget.xPercent,
          y: nextTarget.yPercent,
          targetXPercent: nextTarget.xPercent,
          targetYPercent: nextTarget.yPercent,
        }, {
          clientSequence: actionMeta.clientSequence,
          actionId: actionMeta.actionId,
          clientSentAt: actionMeta.clientSentAt,
          timeoutMs: 3500,
        })
        : null;
      const json = colyseusResult
        ? buildCombatActionResponseFromAck(colyseusResult.ack)
        : await submitHttpCombatMove({
          combatId: currentCombatState.id,
          target: nextTarget,
          actionMeta,
        });

      applyAuthoritativeSync(json.data, {
        requestedClientSequence: actionMeta.clientSequence,
      });

      if (!json.success) {
        if (typeof json.data?.acceptedClientSequence !== "number") {
          restorePendingClientSequence(actionMeta.clientSequence);
        }

        if (json.errorCode === "COMBAT_SCENE_STALE") {
          clearLocalMovePrediction();
          messageApi.warning(json.error || "战斗状态已更新，请按最新战局重新操作。");
          return;
        }

        if (json.errorCode === "COMBAT_SESSION_FINISHED" && isCombatFinishedPayload(json.data)) {
          clearLocalMovePrediction();
          return;
        }

        const recoveryResult = await handleCombatFailureRecovery({
          combatId: currentCombatState.id,
          status: 503,
          errorCode: json.errorCode,
          error: json.error,
        });

        if (recoveryResult === "synced") {
          clearLocalMovePrediction();
          messageApi.warning("战斗场景已根据服务端状态重新同步。");
          return;
        }

        if (recoveryResult === "redirected") {
          clearLocalMovePrediction();
          return;
        }

        clearLocalMovePrediction();
        if (json.errorCode === "COMBAT_REALTIME_UNAVAILABLE") {
          messageApi.error(json.error || "移动请求失败");
        } else {
          messageApi.warning(json.error || "移动请求失败");
        }
      }
    } catch {
      restorePendingClientSequence(actionMeta.clientSequence);
      clearLocalMovePrediction();
      setSceneStreamState("stale");
    } finally {
      inFlightMoveTargetRef.current = null;
      moveRequestInFlightRef.current = false;
      syncMovePipelinePendingState();

      if (queuedMoveTargetRef.current) {
        void processQueuedMoveTargetRef.current();
      } else {
        reconcileLocalMovePrediction(sceneSnapshotRef.current, combatStateRef.current);
      }
    }
  }, [
    applyAuthoritativeSync,
    clearLocalMovePrediction,
    createCombatActionMeta,
    handleCombatFailureRecovery,
    messageApi,
    reconcileLocalMovePrediction,
    restorePendingClientSequence,
    submitHttpCombatMove,
    syncMovePipelinePendingState,
    combatColyseusRoom,
  ]);

  useEffect(() => {
    processQueuedMoveTargetRef.current = processQueuedMoveTarget;
  }, [processQueuedMoveTarget]);

  const requestMove = useCallback((target: CombatMoveTarget) => {
    if (!COMBAT_SOLO_MOVEMENT_ENABLED || !combatStateRef.current || combatStateRef.current.status !== "ongoing" || activePartyCombatIdRef.current) {
      queuedMoveTargetRef.current = null;
      inFlightMoveTargetRef.current = null;
      clearLocalMovePrediction();
      syncMovePipelinePendingState();
      return;
    }

    queuedMoveTargetRef.current = target;
    retargetLocalMovePrediction(target);
    syncMovePipelinePendingState();

    if (!moveRequestInFlightRef.current) {
      void processQueuedMoveTargetRef.current();
    }
  }, [clearLocalMovePrediction, retargetLocalMovePrediction, syncMovePipelinePendingState]);

  return {
    activePartyCombatId,
    applyAuthoritativeSync,
    battleView,
    combatState,
    combatCommandRoomStatus: combatColyseusRoom.status,
    combatRealtimeLastAck: combatColyseusRoom.lastAck,
    combatRealtimeSceneEnvelope: combatColyseusRoom.sceneSnapshot,
    sendCombatCommandAndWaitForAck: combatColyseusRoom.sendCommandAndWaitForAck,
    sendCombatRepair: combatColyseusRoom.sendRepair,
    stateRefreshSignals: combatColyseusRoom.stateRefreshSignals,
    stateRefreshVersions: combatColyseusRoom.stateRefreshVersions,
    applyStateRefreshFrame: combatColyseusRoom.applyStateRefreshFrame,
    createCombatActionMeta,
    handleCombatFailureRecovery,
    lastAcceptedClientSequence,
    loading,
    markSceneStale,
    nextClientSequence,
    movePipelinePending,
    predictedPlayerPosition,
    requestMove,
    restorePendingClientSequence,
    sceneSnapshot,
    sceneStreamState,
    sceneTick,
    syncAcceptedClientSequence,
    setCombatState,
    skillsData,
    skillRotation,
    startupError,
    restartCombat: startCombat,
  };
}
