import {
  type BattleScenePositionOverride,
  type BattleSceneTimelineEvent,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import {
  buildBattleActionTimeline,
  createBattleSpatialRuntimeSnapshot,
} from "@/modules/combat/services/battle-spatial-runtime";
import {
  clampCombatSceneEnemyYPercent,
  clampCombatScenePlayerYPercent,
  clampCombatSceneXPercent,
  getCombatScenePositions,
  resolveCombatSkillContact,
  resolveEnemyAiMovementPlan,
} from "@/modules/combat/services/combat-spatial";
import {
  COMBAT_PLAYER_MOVE_SPEED_PERCENT_PER_SECOND,
  COMBAT_SOLO_MOVEMENT_ENABLED,
} from "@/modules/combat/services/combat-scene-config";
import { executeEnemyAutoTurn, pickCombatEnemySkillId } from "@/modules/combat/services/combat";
import type { CombatLogEntry, CombatState, CombatSkillVisualEffect, SkillEffect, SkillSourceType } from "@/types/game";
import type { DamageCalculator } from "@/modules/combat/services/damage-formula";
import {
  ensureGlobalArray,
  ensureGlobalMap,
  ensureGlobalSet,
} from "@/modules/shared/services/global-store";
import {
  deletePersistedRuntimeValue,
  listPersistedRuntimeValues,
  readPersistedRuntimeValue,
  writePersistedRuntimeValue,
} from "@/modules/shared/services/runtime-persisted-store";

export interface CombatSkillSnapshot {
  name: string;
  skillType: string;
  sourceType?: SkillSourceType;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffect[];
  target: string;
  visualEffect?: CombatSkillVisualEffect | null;
}

export interface PendingCombatSettleSnapshot {
  data: Record<string, unknown>;
  createdAt: number;
}

export interface SettledCombatSessionResult {
  combatId: string;
  state: CombatState;
  sceneSnapshot: BattleSceneSnapshot;
  settleSnapshot: PendingCombatSettleSnapshot;
  createdAt: number;
}

type CombatSceneMovementTarget = {
  xPercent?: number;
  yPercent?: number;
  speedXPercentPerSecond?: number;
  speedYPercentPerSecond?: number;
};

export interface PendingCombatSession {
  combatId: string;
  monsterId: string;
  createdAt: number;
  lastRuntimeUpdatedAt: number;
  lastEnemyActionAt: number;
  locked: boolean;
  lastAcceptedClientSequence: number;
  state: CombatState;
  skillsData: Record<string, CombatSkillSnapshot>;
  scenePositionOverrides: Record<string, BattleScenePositionOverride>;
  sceneMovementTargets: Record<string, CombatSceneMovementTarget>;
  sceneSnapshot: BattleSceneSnapshot;
  settleSnapshot?: PendingCombatSettleSnapshot | null;
}

type PlayerPendingCombatStore = Map<string, PendingCombatSession>;
type PendingCombatStore = Map<string, PlayerPendingCombatStore>;
type PendingCombatRuntimeSessionRef = {
  playerId: string;
  combatId: string;
};

type PendingCombatGlobal = typeof globalThis & {
  __pendingCombatStore?: PendingCombatStore;
  __settledCombatResultStore?: Map<string, SettledCombatSessionResult>;
  __pendingCombatSceneEvents?: PendingCombatSceneEvent[];
  __pendingCombatSceneSubscribers?: Set<PendingCombatSceneSubscriber>;
  __pendingCombatSceneSubscribersByCombatKey?: Map<string, Set<PendingCombatSceneSubscriber>>;
  __pendingCombatRuntimeSessions?: Map<string, PendingCombatRuntimeSessionRef>;
  __pendingCombatRuntimeRunningKeys?: Set<string>;
  __pendingCombatRuntimeScheduler?: ReturnType<typeof setTimeout> | null;
  __pendingCombatRuntimePersistedAt?: Map<string, number>;
};

export type PendingCombatSceneEvent = {
  playerId: string;
  combatId: string;
  snapshot: BattleSceneSnapshot;
  state: CombatState;
};

type PendingCombatSceneSubscriber = (event: PendingCombatSceneEvent) => void;

const PENDING_COMBAT_EXPIRE_MS = 10 * 60 * 1000;
const PENDING_COMBAT_RUNTIME_TICK_MS = 33;
const PENDING_COMBAT_RUNTIME_MIN_UPDATE_INTERVAL_MS = 24;
const PENDING_COMBAT_RUNTIME_PERSIST_THROTTLE_MS = 320;
const PENDING_COMBAT_AUTO_ATTACK_INTERVAL_MS = 1250;
const PENDING_COMBAT_ENEMY_AGGRO_DELAY_MS = 2600;
const PENDING_COMBAT_RUNTIME_NAMESPACE = "pending-combat-session";
const PENDING_COMBAT_SETTLED_RESULT_NAMESPACE = "pending-combat-settled-result";
const PENDING_COMBAT_FIXED_POSITION_MODE = !COMBAT_SOLO_MOVEMENT_ENABLED;
const PENDING_COMBAT_BACKGROUND_AUTO_ATTACK_ENABLED = false;
const PENDING_COMBAT_RUNTIME_DAMAGE_CALCULATOR_PROMISE = import("@/modules/combat/services/damage-formula")
  .then((module) => module.getCombatDamageCalculator())
  .catch((error) => {
    console.error("Pending combat runtime damage calculator load error:", error);
    return undefined;
  });

export function isPendingCombatFixedPositionModeEnabled() {
  return PENDING_COMBAT_FIXED_POSITION_MODE;
}

function getTimerKey(playerId: string, combatId: string) {
  return `${playerId}:${combatId}`;
}

function getRuntimePersistedAtStore() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatRuntimePersistedAt = ensureGlobalMap<string, number>(
    globalStore as Record<string, unknown>,
    "__pendingCombatRuntimePersistedAt",
  );
  return globalStore.__pendingCombatRuntimePersistedAt;
}

function getSettledCombatResultStore() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__settledCombatResultStore = ensureGlobalMap<string, SettledCombatSessionResult>(
    globalStore as Record<string, unknown>,
    "__settledCombatResultStore",
  );
  return globalStore.__settledCombatResultStore;
}

function deleteSettledCombatSessionResult(playerId: string, combatId: string) {
  const runtimeKey = getTimerKey(playerId, combatId);
  getSettledCombatResultStore().delete(runtimeKey);
  void deletePersistedRuntimeValue(PENDING_COMBAT_SETTLED_RESULT_NAMESPACE, runtimeKey);
}

function isExpiredSettledCombatResult(result: SettledCombatSessionResult, nowMs = Date.now()) {
  return nowMs - result.createdAt > PENDING_COMBAT_EXPIRE_MS;
}

function persistSettledCombatSessionResult(
  playerId: string,
  combatId: string,
  result: SettledCombatSessionResult | null,
) {
  const runtimeKey = getTimerKey(playerId, combatId);
  if (!result) {
    deleteSettledCombatSessionResult(playerId, combatId);
    return;
  }

  const store = getSettledCombatResultStore();
  store.set(runtimeKey, result);
  writePersistedRuntimeValue(PENDING_COMBAT_SETTLED_RESULT_NAMESPACE, runtimeKey, result, {
    ttlMs: PENDING_COMBAT_EXPIRE_MS,
  });
}

function hydrateSettledCombatSessionResult(playerId: string, combatId: string) {
  const runtimeKey = getTimerKey(playerId, combatId);
  const persisted = readPersistedRuntimeValue<SettledCombatSessionResult>(
    PENDING_COMBAT_SETTLED_RESULT_NAMESPACE,
    runtimeKey,
  );
  if (!persisted || isExpiredSettledCombatResult(persisted)) {
    deleteSettledCombatSessionResult(playerId, combatId);
    return null;
  }
  getSettledCombatResultStore().set(runtimeKey, persisted);
  return persisted;
}

function storeSettledCombatSessionResult(playerId: string, session: PendingCombatSession) {
  if (!session.settleSnapshot?.data || !session.sceneSnapshot) {
    return;
  }
  persistSettledCombatSessionResult(playerId, session.combatId, {
    combatId: session.combatId,
    state: structuredClone(session.state),
    sceneSnapshot: structuredClone(session.sceneSnapshot),
    settleSnapshot: structuredClone(session.settleSnapshot),
    createdAt: Date.now(),
  });
}

function persistPendingCombatSession(
  playerId: string,
  combatId: string,
  session: PendingCombatSession | null,
  options?: { force?: boolean },
) {
  const runtimeKey = getTimerKey(playerId, combatId);
  const persistedAtStore = getRuntimePersistedAtStore();
  if (!session) {
    persistedAtStore.delete(runtimeKey);
    void deletePersistedRuntimeValue(PENDING_COMBAT_RUNTIME_NAMESPACE, runtimeKey);
    return;
  }

  const nowMs = Date.now();
  const lastPersistedAt = persistedAtStore.get(runtimeKey) || 0;
  if (!options?.force && nowMs - lastPersistedAt < PENDING_COMBAT_RUNTIME_PERSIST_THROTTLE_MS) {
    return;
  }

  persistedAtStore.set(runtimeKey, nowMs);
  writePersistedRuntimeValue(PENDING_COMBAT_RUNTIME_NAMESPACE, runtimeKey, session, {
    ttlMs: PENDING_COMBAT_EXPIRE_MS,
  });
}

function hydratePendingCombatSession(playerId: string, combatId: string) {
  const runtimeKey = getTimerKey(playerId, combatId);
  const persisted = readPersistedRuntimeValue<PendingCombatSession>(PENDING_COMBAT_RUNTIME_NAMESPACE, runtimeKey);
  if (!persisted || isExpired(persisted)) {
    void deletePersistedRuntimeValue(PENDING_COMBAT_RUNTIME_NAMESPACE, runtimeKey);
    return null;
  }
  const restoredSession: PendingCombatSession = {
    ...persisted,
    locked: false,
  };
  const store = getStore();
  const playerStore = store.get(playerId) || new Map<string, PendingCombatSession>();
  playerStore.set(combatId, restoredSession);
  store.set(playerId, playerStore);
  ensurePendingCombatRuntimeTimer(playerId, combatId);
  return restoredSession;
}

function getRuntimeSessionStore() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatRuntimeSessions = ensureGlobalMap<string, PendingCombatRuntimeSessionRef>(
    globalStore as Record<string, unknown>,
    "__pendingCombatRuntimeSessions",
  );
  return globalStore.__pendingCombatRuntimeSessions;
}

function getRuntimeRunningKeyStore() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatRuntimeRunningKeys = ensureGlobalSet<string>(
    globalStore as Record<string, unknown>,
    "__pendingCombatRuntimeRunningKeys",
  );
  return globalStore.__pendingCombatRuntimeRunningKeys;
}

function clearPendingCombatRuntimeScheduler() {
  const globalStore = globalThis as PendingCombatGlobal;
  if (globalStore.__pendingCombatRuntimeScheduler) {
    clearTimeout(globalStore.__pendingCombatRuntimeScheduler);
    globalStore.__pendingCombatRuntimeScheduler = null;
  }
}

function hasPendingCombatSceneMovement(session: PendingCombatSession) {
  for (const unitId of Object.keys(session.sceneMovementTargets)) {
    const target = session.sceneMovementTargets[unitId];
    if (!target) {
      continue;
    }
    const current = getSceneUnitPosition(session, unitId);
    const targetX = typeof target.xPercent === "number" ? target.xPercent : current.xPercent;
    const targetY = typeof target.yPercent === "number" ? target.yPercent : current.yPercent;
    if (Math.abs(targetX - current.xPercent) > 0.01 || Math.abs(targetY - current.yPercent) > 0.01) {
      return true;
    }
  }
  return false;
}

function getPendingCombatEnemyAggroDelayMs(session: PendingCombatSession, nowMs: number) {
  return Math.max(0, (session.createdAt + PENDING_COMBAT_ENEMY_AGGRO_DELAY_MS) - nowMs);
}

function resolvePendingCombatRuntimeSchedulerDelay() {
  const sessionStore = getRuntimeSessionStore();
  if (sessionStore.size === 0) {
    return PENDING_COMBAT_RUNTIME_TICK_MS;
  }

  const nowMs = Date.now();
  let nextDelayMs = PENDING_COMBAT_AUTO_ATTACK_INTERVAL_MS;

  for (const sessionRef of sessionStore.values()) {
    const session = getStore().get(sessionRef.playerId)?.get(sessionRef.combatId);
    if (!session || session.state.status !== "ongoing") {
      continue;
    }
    if (session.locked || hasPendingCombatSceneMovement(session)) {
      nextDelayMs = Math.min(nextDelayMs, PENDING_COMBAT_RUNTIME_TICK_MS);
      continue;
    }
    const aggroDelayMs = getPendingCombatEnemyAggroDelayMs(session, nowMs);
    if (aggroDelayMs > 0) {
      nextDelayMs = Math.min(nextDelayMs, aggroDelayMs);
      continue;
    }
    const enemyActionDelayMs = Math.max(
      PENDING_COMBAT_RUNTIME_TICK_MS,
      PENDING_COMBAT_AUTO_ATTACK_INTERVAL_MS - Math.max(0, nowMs - session.lastEnemyActionAt),
    );
    nextDelayMs = Math.min(nextDelayMs, enemyActionDelayMs);
  }

  return Math.max(PENDING_COMBAT_RUNTIME_TICK_MS, nextDelayMs);
}

function schedulePendingCombatRuntimeScheduler() {
  const globalStore = globalThis as PendingCombatGlobal;
  if (globalStore.__pendingCombatRuntimeScheduler || getRuntimeSessionStore().size === 0) {
    return;
  }

  const scheduler = setTimeout(() => {
    globalStore.__pendingCombatRuntimeScheduler = null;
    runPendingCombatRuntimeScheduler();
  }, resolvePendingCombatRuntimeSchedulerDelay());

  if (typeof scheduler.unref === "function") {
    scheduler.unref();
  }

  globalStore.__pendingCombatRuntimeScheduler = scheduler;
}

function runPendingCombatRuntimeScheduler() {
  const sessionStore = getRuntimeSessionStore();
  if (sessionStore.size === 0) {
    clearPendingCombatRuntimeScheduler();
    return;
  }

  const runningKeyStore = getRuntimeRunningKeyStore();
  const nowMs = Date.now();

  for (const [timerKey, sessionRef] of sessionStore.entries()) {
    if (runningKeyStore.has(timerKey)) {
      continue;
    }

    const session = getStore().get(sessionRef.playerId)?.get(sessionRef.combatId);
    if (!session || !isPendingCombatRuntimeAdvanceDue(session, nowMs)) {
      continue;
    }

    runningKeyStore.add(timerKey);
    void advancePendingCombatSessionRuntime({
      playerId: sessionRef.playerId,
      combatId: sessionRef.combatId,
      nowMs,
    }).catch((error) => {
      console.error("Pending combat runtime tick error:", error);
    }).finally(() => {
      runningKeyStore.delete(timerKey);
    });
  }

  schedulePendingCombatRuntimeScheduler();
}

function getStore() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatStore = ensureGlobalMap<string, PlayerPendingCombatStore>(
    globalStore as Record<string, unknown>,
    "__pendingCombatStore",
  );
  return globalStore.__pendingCombatStore;
}

function getSceneEventLog() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatSceneEvents = ensureGlobalArray<PendingCombatSceneEvent>(
    globalStore as Record<string, unknown>,
    "__pendingCombatSceneEvents",
  );
  return globalStore.__pendingCombatSceneEvents;
}

function getSceneSubscribers() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatSceneSubscribers = ensureGlobalSet<PendingCombatSceneSubscriber>(
    globalStore as Record<string, unknown>,
    "__pendingCombatSceneSubscribers",
  );
  return globalStore.__pendingCombatSceneSubscribers;
}

function getSceneSubscribersByCombatKey() {
  const globalStore = globalThis as PendingCombatGlobal;
  globalStore.__pendingCombatSceneSubscribersByCombatKey = ensureGlobalMap<string, Set<PendingCombatSceneSubscriber>>(
    globalStore as Record<string, unknown>,
    "__pendingCombatSceneSubscribersByCombatKey",
  );
  return globalStore.__pendingCombatSceneSubscribersByCombatKey;
}

function deleteSession(playerId: string, combatId: string) {
  clearPendingCombatRuntimeTimer(playerId, combatId);
  persistPendingCombatSession(playerId, combatId, null);
  const store = getStore();
  const playerStore = store.get(playerId);
  if (!playerStore) return;
  playerStore.delete(combatId);
  if (playerStore.size === 0) {
    store.delete(playerId);
  }
}

function isExpired(session: PendingCombatSession, nowMs = Date.now()) {
  return nowMs - session.createdAt > PENDING_COMBAT_EXPIRE_MS;
}

function clearPendingCombatRuntimeTimer(playerId: string, combatId: string) {
  const timerStore = getRuntimeSessionStore();
  const timerKey = getTimerKey(playerId, combatId);
  if (timerStore.delete(timerKey)) {
    getRuntimeRunningKeyStore().delete(timerKey);
  }
  getRuntimePersistedAtStore().delete(timerKey);
  if (timerStore.size === 0) {
    clearPendingCombatRuntimeScheduler();
  }
}

function isPendingCombatRuntimeAdvanceDue(session: PendingCombatSession, nowMs: number) {
  if (session.locked || session.state.status !== "ongoing") {
    return false;
  }

  if (hasPendingCombatSceneMovement(session)) {
    return nowMs - session.lastRuntimeUpdatedAt >= PENDING_COMBAT_RUNTIME_MIN_UPDATE_INTERVAL_MS;
  }

  if (!PENDING_COMBAT_BACKGROUND_AUTO_ATTACK_ENABLED) {
    return false;
  }

  if (getPendingCombatEnemyAggroDelayMs(session, nowMs) > 0) {
    return false;
  }

  return nowMs - session.lastEnemyActionAt >= PENDING_COMBAT_AUTO_ATTACK_INTERVAL_MS;
}

function createCombatSceneSnapshotForState(
  params: {
    state: CombatState;
    scenePositionOverrides?: Record<string, BattleScenePositionOverride>;
    sceneMovementTargets?: Record<string, CombatSceneMovementTarget>;
    previousSnapshot?: BattleSceneSnapshot | null;
    sequence?: number;
    tick?: number;
    timeline?: BattleSceneTimelineEvent[];
  },
) {
  return createBattleSpatialRuntimeSnapshot({
    mode: "combat",
    battleMode: "solo",
    units: [
      {
        id: params.state.enemy.id,
        role: "enemy",
      },
      {
        id: params.state.player.id,
        role: "player",
        isCurrent: true,
      },
    ],
    sequence: params.sequence || 1,
    tick: params.tick,
    serverTimeMs: Date.now(),
    previousSnapshot: params.previousSnapshot,
    timeline: params.timeline,
    positionOverrides: params.scenePositionOverrides,
    movementTargetsByUnitId: params.sceneMovementTargets,
  });
}

function createInitialCombatScenePositionOverrides(state: CombatState) {
  if (PENDING_COMBAT_FIXED_POSITION_MODE) {
    return {
      [state.enemy.id]: {
        xPercent: clampCombatSceneXPercent(50),
        yPercent: clampCombatSceneEnemyYPercent(68),
      },
      [state.player.id]: {
        xPercent: 50,
        yPercent: clampCombatScenePlayerYPercent(80),
      },
    } satisfies Record<string, BattleScenePositionOverride>;
  }

  return {
    [state.enemy.id]: {
      // Open straight across from the player so the first approach reads as a
      // clear frontal chase instead of an immediate side-step into melee.
      xPercent: clampCombatSceneXPercent(50),
      yPercent: clampCombatSceneEnemyYPercent(54),
    },
    [state.player.id]: {
      xPercent: 50,
      yPercent: clampCombatScenePlayerYPercent(82),
    },
  } satisfies Record<string, BattleScenePositionOverride>;
}

function createInitialCombatSceneMovementTargets(
  state: CombatState,
  scenePositionOverrides: Record<string, BattleScenePositionOverride>,
) {
  return {
    [state.enemy.id]: {
      xPercent: scenePositionOverrides[state.enemy.id]?.xPercent ?? 50,
      yPercent: clampCombatSceneEnemyYPercent(scenePositionOverrides[state.enemy.id]?.yPercent ?? 12),
      speedXPercentPerSecond: 0,
      speedYPercentPerSecond: 0,
    },
    [state.player.id]: {
      xPercent: scenePositionOverrides[state.player.id]?.xPercent ?? 50,
      yPercent: clampCombatScenePlayerYPercent(scenePositionOverrides[state.player.id]?.yPercent ?? 84),
      speedXPercentPerSecond: 0,
      speedYPercentPerSecond: 0,
    },
  } satisfies Record<string, CombatSceneMovementTarget>;
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

function getSceneUnitPosition(session: PendingCombatSession, unitId: string) {
  const override = session.scenePositionOverrides[unitId];
  const snapshotUnit = session.sceneSnapshot.units.find((unit) => unit.id === unitId);
  return {
    xPercent: override?.xPercent ?? snapshotUnit?.xPercent ?? 50,
    yPercent: override?.yPercent ?? snapshotUnit?.yPercent ?? 50,
  };
}

function setSceneMovementTarget(
  session: PendingCombatSession,
  unitId: string,
  target: CombatSceneMovementTarget,
) {
  const current = session.sceneMovementTargets[unitId] || {};
  const normalized: CombatSceneMovementTarget = {
    xPercent: typeof target.xPercent === "number" ? target.xPercent : current.xPercent,
    yPercent: typeof target.yPercent === "number" ? target.yPercent : current.yPercent,
    speedXPercentPerSecond: typeof target.speedXPercentPerSecond === "number" ? target.speedXPercentPerSecond : current.speedXPercentPerSecond,
    speedYPercentPerSecond: typeof target.speedYPercentPerSecond === "number" ? target.speedYPercentPerSecond : current.speedYPercentPerSecond,
  };

  const changed = Math.abs((current.xPercent ?? normalized.xPercent ?? 0) - (normalized.xPercent ?? 0)) > 0.01
    || Math.abs((current.yPercent ?? normalized.yPercent ?? 0) - (normalized.yPercent ?? 0)) > 0.01
    || Math.abs((current.speedXPercentPerSecond ?? normalized.speedXPercentPerSecond ?? 0) - (normalized.speedXPercentPerSecond ?? 0)) > 0.01
    || Math.abs((current.speedYPercentPerSecond ?? normalized.speedYPercentPerSecond ?? 0) - (normalized.speedYPercentPerSecond ?? 0)) > 0.01;

  if (!changed) {
    return false;
  }

  session.sceneMovementTargets = {
    ...session.sceneMovementTargets,
    [unitId]: normalized,
  };
  return true;
}

function freezePendingCombatSceneMovement(session: PendingCombatSession) {
  const playerPosition = getSceneUnitPosition(session, session.state.player.id);
  const enemyPosition = getSceneUnitPosition(session, session.state.enemy.id);
  const playerChanged = setSceneMovementTarget(session, session.state.player.id, {
    xPercent: playerPosition.xPercent,
    yPercent: playerPosition.yPercent,
    speedXPercentPerSecond: 0,
    speedYPercentPerSecond: 0,
  });
  const enemyChanged = setSceneMovementTarget(session, session.state.enemy.id, {
    xPercent: enemyPosition.xPercent,
    yPercent: enemyPosition.yPercent,
    speedXPercentPerSecond: 0,
    speedYPercentPerSecond: 0,
  });
  return playerChanged || enemyChanged;
}

function syncPendingCombatSceneMovement(params: {
  session: PendingCombatSession;
  nowMs: number;
}) {
  const elapsedMs = Math.max(0, params.nowMs - params.session.lastRuntimeUpdatedAt);
  if (elapsedMs <= 0) {
    return false;
  }

  const elapsedSeconds = elapsedMs / 1000;
  let moved = false;

  for (const unitId of Object.keys(params.session.sceneMovementTargets)) {
    const target = params.session.sceneMovementTargets[unitId];
    if (!target) {
      continue;
    }

    const current = getSceneUnitPosition(params.session, unitId);
    const nextXPercent = typeof target.xPercent === "number"
      ? moveTowardTarget(current.xPercent, target.xPercent, (target.speedXPercentPerSecond || 0) * elapsedSeconds)
      : current.xPercent;
    const nextYPercent = typeof target.yPercent === "number"
      ? moveTowardTarget(current.yPercent, target.yPercent, (target.speedYPercentPerSecond || 0) * elapsedSeconds)
      : current.yPercent;

    if (Math.abs(nextXPercent - current.xPercent) <= 0.001 && Math.abs(nextYPercent - current.yPercent) <= 0.001) {
      continue;
    }

    params.session.scenePositionOverrides = {
      ...params.session.scenePositionOverrides,
      [unitId]: {
        xPercent: nextXPercent,
        yPercent: nextYPercent,
      },
    };

    const reachedTargetX = typeof target.xPercent !== "number" || Math.abs(nextXPercent - target.xPercent) <= 0.001;
    const reachedTargetY = typeof target.yPercent !== "number" || Math.abs(nextYPercent - target.yPercent) <= 0.001;
    if (
      reachedTargetX
      && reachedTargetY
      && (
        Math.abs(target.speedXPercentPerSecond || 0) > 0.001
        || Math.abs(target.speedYPercentPerSecond || 0) > 0.001
      )
    ) {
      params.session.sceneMovementTargets = {
        ...params.session.sceneMovementTargets,
        [unitId]: {
          ...target,
          xPercent: typeof target.xPercent === "number" ? target.xPercent : nextXPercent,
          yPercent: typeof target.yPercent === "number" ? target.yPercent : nextYPercent,
          speedXPercentPerSecond: 0,
          speedYPercentPerSecond: 0,
        },
      };
    }
    moved = true;
  }

  return moved;
}

function rebuildPendingCombatSceneSnapshot(params: {
  session: PendingCombatSession;
  timeline?: BattleSceneTimelineEvent[];
}) {
  const nextTick = (params.session.sceneSnapshot?.tick || 0) + 1;
  params.session.sceneSnapshot = createCombatSceneSnapshotForState({
    state: params.session.state,
    previousSnapshot: params.session.sceneSnapshot,
    scenePositionOverrides: params.session.scenePositionOverrides,
    sceneMovementTargets: params.session.sceneMovementTargets,
    sequence: (params.session.sceneSnapshot?.sequence || 0) + 1,
    tick: nextTick,
    timeline: params.timeline,
  });
}

function applyEnemyAiPositionStep(params: {
  session: PendingCombatSession;
  preferredSkillId?: string | null;
}) {
  if (PENDING_COMBAT_FIXED_POSITION_MODE) {
    return false;
  }
  if (params.session.state.status !== "ongoing") {
    return false;
  }

  const positions = getCombatScenePositions(params.session.state, params.session.scenePositionOverrides);
  const preferredSkillId = params.preferredSkillId || pickCombatEnemySkillId(
    params.session.state.enemy,
    params.session.skillsData,
    (params.session.sceneSnapshot?.tick || 0) + params.session.state.turn + 1,
  );
  const movementPlan = resolveEnemyAiMovementPlan({
    state: params.session.state,
    sceneTick: (params.session.sceneSnapshot?.tick || 0) + 1,
    currentEnemyXPercent: positions.enemyXPercent,
    currentEnemyYPercent: positions.enemyYPercent,
    currentPlayerXPercent: positions.playerXPercent,
    currentPlayerYPercent: positions.playerYPercent,
    preferredSkillId,
    preferredSkill: preferredSkillId ? params.session.skillsData[preferredSkillId] : null,
  });

  return setSceneMovementTarget(params.session, params.session.state.enemy.id, {
    xPercent: movementPlan.targetXPercent,
    yPercent: movementPlan.targetYPercent,
    speedXPercentPerSecond: movementPlan.horizontalSpeedPercentPerSecond,
    speedYPercentPerSecond: movementPlan.verticalSpeedPercentPerSecond,
  });
}

function createCombatTimelineForLogEntries(params: {
  state: CombatState;
  logEntries: CombatLogEntry[];
  baseStartMs: number;
}) {
  return buildBattleActionTimeline({
    runtimeId: params.state.id,
    turn: params.state.turn,
    entries: params.logEntries,
    startedAtMs: params.baseStartMs,
    windupMs: 90,
    activeMs: 170,
    recoverMs: 210,
    actorAdvancePercent: 0,
    itemAdvancePercent: 0,
    targetRecoilPercent: 0,
    spacingMs: 70,
  });
}

async function getPendingCombatRuntimeDamageCalculator() {
  return PENDING_COMBAT_RUNTIME_DAMAGE_CALCULATOR_PROMISE as Promise<DamageCalculator | undefined>;
}

async function advancePendingCombatSessionRuntime(params: {
  playerId: string;
  combatId: string;
  nowMs?: number;
}) {
  const session = getPendingCombatSession(params.playerId, params.combatId);
  if (!session || session.locked || session.state.status !== "ongoing") {
    if (session && session.state.status !== "ongoing") {
      clearPendingCombatRuntimeTimer(params.playerId, params.combatId);
    }
    return session;
  }

  const nowMs = params.nowMs ?? Date.now();
  if (nowMs - session.lastRuntimeUpdatedAt < PENDING_COMBAT_RUNTIME_MIN_UPDATE_INTERVAL_MS) {
    return session;
  }
  const moved = PENDING_COMBAT_FIXED_POSITION_MODE
    ? freezePendingCombatSceneMovement(session)
    : syncPendingCombatSceneMovement({ session, nowMs });
  const enemyTargetChanged = PENDING_COMBAT_FIXED_POSITION_MODE
    ? false
    : applyEnemyAiPositionStep({
      session,
      preferredSkillId: pickCombatEnemySkillId(
        session.state.enemy,
        session.skillsData,
        (session.sceneSnapshot?.tick || 0) + session.state.turn + 1,
      ),
    });

  const nextPositions = getCombatScenePositions(session.state, session.scenePositionOverrides);
  const preferredSkillId = pickCombatEnemySkillId(
    session.state.enemy,
    session.skillsData,
    (session.sceneSnapshot?.tick || 0) + session.state.turn + 1,
  );
  const preferredSkill = preferredSkillId ? session.skillsData[preferredSkillId] : null;
  const contact = resolveCombatSkillContact({
    actorIsPlayer: false,
    skillType: preferredSkill?.skillType,
    skillId: preferredSkillId || undefined,
    positions: nextPositions,
  });
  const canAutoAttack = contact.outcome !== "miss"
    && PENDING_COMBAT_BACKGROUND_AUTO_ATTACK_ENABLED
    && getPendingCombatEnemyAggroDelayMs(session, nowMs) <= 0
    && nowMs - session.lastEnemyActionAt >= PENDING_COMBAT_AUTO_ATTACK_INTERVAL_MS;

  if (canAutoAttack) {
    const damageCalculator = await getPendingCombatRuntimeDamageCalculator();
    const previousLogLength = session.state.log.length;
    executeEnemyAutoTurn(
      session.state,
      session.skillsData,
      damageCalculator,
      nextPositions,
      preferredSkillId,
    );
    session.lastEnemyActionAt = nowMs;
    session.lastRuntimeUpdatedAt = nowMs;

    const timeline = createCombatTimelineForLogEntries({
      state: session.state,
      logEntries: session.state.log.slice(previousLogLength),
      baseStartMs: nowMs + 60,
    });
    rebuildPendingCombatSceneSnapshot({
      session,
      timeline,
    });
    publishPendingCombatSceneEvent({
      playerId: params.playerId,
      combatId: params.combatId,
      snapshot: session.sceneSnapshot,
      state: session.state,
    });
    persistPendingCombatSession(params.playerId, params.combatId, session, { force: true });
    if (session.state.status !== "ongoing") {
      clearPendingCombatRuntimeTimer(params.playerId, params.combatId);
    }
    return session;
  }

  session.lastRuntimeUpdatedAt = nowMs;

  if (moved || enemyTargetChanged) {
    rebuildPendingCombatSceneSnapshot({ session });
    publishPendingCombatSceneEvent({
      playerId: params.playerId,
      combatId: params.combatId,
      snapshot: session.sceneSnapshot,
      state: session.state,
    });
    persistPendingCombatSession(params.playerId, params.combatId, session);
  }

  return session;
}

function ensurePendingCombatRuntimeTimer(playerId: string, combatId: string) {
  if (PENDING_COMBAT_FIXED_POSITION_MODE && !PENDING_COMBAT_BACKGROUND_AUTO_ATTACK_ENABLED) {
    return;
  }

  const timerStore = getRuntimeSessionStore();
  const timerKey = getTimerKey(playerId, combatId);
  if (timerStore.has(timerKey)) {
    return;
  }

  timerStore.set(timerKey, {
    playerId,
    combatId,
  });
  schedulePendingCombatRuntimeScheduler();
}

function publishPendingCombatSceneEvent(event: PendingCombatSceneEvent) {
  const dispatched = new Set<PendingCombatSceneSubscriber>();
  const subscribers = getSceneSubscribers();
  for (const subscriber of subscribers) {
    dispatched.add(subscriber);
    try {
      subscriber(event);
    } catch (error) {
      console.error("Pending combat scene subscriber error:", error);
    }
  }
  const combatSubscribers = getSceneSubscribersByCombatKey().get(getTimerKey(event.playerId, event.combatId));
  if (!combatSubscribers) {
    return;
  }
  for (const subscriber of combatSubscribers) {
    if (dispatched.has(subscriber)) {
      continue;
    }
    try {
      subscriber(event);
    } catch (error) {
      console.error("Pending combat scene subscriber error:", error);
    }
  }
}

function pruneExpiredSessions(playerId: string, nowMs = Date.now()) {
  const store = getStore();
  const playerStore = store.get(playerId);
  if (!playerStore) return;

  const expiredCombatIds: string[] = [];
  for (const [combatId, session] of playerStore.entries()) {
    if (isExpired(session, nowMs)) {
      expiredCombatIds.push(combatId);
    }
  }

  for (const combatId of expiredCombatIds) {
    deleteSession(playerId, combatId);
  }
}

export function setPendingCombatSession(
  playerId: string,
  session: Omit<
    PendingCombatSession,
    | "createdAt"
    | "lastRuntimeUpdatedAt"
    | "lastEnemyActionAt"
    | "locked"
    | "sceneSnapshot"
    | "lastAcceptedClientSequence"
    | "scenePositionOverrides"
    | "sceneMovementTargets"
  >,
) {
  const store = getStore();
  const playerStore = store.get(playerId) || new Map<string, PendingCombatSession>();
  pruneExpiredSessions(playerId);
  deleteSettledCombatSessionResult(playerId, session.combatId);
  const scenePositionOverrides = createInitialCombatScenePositionOverrides(session.state);
  const sceneMovementTargets = createInitialCombatSceneMovementTargets(session.state, scenePositionOverrides);
  const nextSession = {
    ...session,
    createdAt: Date.now(),
    lastRuntimeUpdatedAt: Date.now(),
    lastEnemyActionAt: 0,
    locked: false,
    lastAcceptedClientSequence: 0,
    scenePositionOverrides,
    sceneMovementTargets,
    sceneSnapshot: createCombatSceneSnapshotForState({
      state: session.state,
      scenePositionOverrides,
      sceneMovementTargets,
      tick: 0,
    }),
    settleSnapshot: null,
  };
  playerStore.set(session.combatId, nextSession);
  store.set(playerId, playerStore);
  persistPendingCombatSession(playerId, session.combatId, nextSession, { force: true });
  publishPendingCombatSceneEvent({
    playerId,
    combatId: session.combatId,
    snapshot: nextSession.sceneSnapshot,
    state: nextSession.state,
  });
  ensurePendingCombatRuntimeTimer(playerId, session.combatId);
  return nextSession;
}

export function getPendingCombatSession(playerId: string, combatId: string) {
  const store = getStore();
  const playerStore = store.get(playerId);
  if (!playerStore) {
    return hydratePendingCombatSession(playerId, combatId);
  }

  const pending = playerStore.get(combatId);
  if (!pending) {
    return hydratePendingCombatSession(playerId, combatId);
  }

  if (isExpired(pending)) {
    deleteSession(playerId, combatId);
    return null;
  }

  ensurePendingCombatRuntimeTimer(playerId, combatId);
  return pending;
}

export function hasPendingCombatSessionByCombatId(
  combatId: string,
  options?: { monsterId?: string | null },
) {
  const normalizedCombatId = combatId.trim();
  if (!normalizedCombatId) {
    return false;
  }
  const normalizedMonsterId = typeof options?.monsterId === "string" && options.monsterId.trim()
    ? options.monsterId.trim()
    : null;
  const matches = (session: PendingCombatSession | null | undefined) => Boolean(
    session
    && !isExpired(session)
    && session.combatId === normalizedCombatId
    && (!normalizedMonsterId || session.monsterId === normalizedMonsterId),
  );

  for (const playerStore of getStore().values()) {
    for (const session of playerStore.values()) {
      if (matches(session)) {
        return true;
      }
    }
  }

  const persistedSessions = listPersistedRuntimeValues<PendingCombatSession>(PENDING_COMBAT_RUNTIME_NAMESPACE);
  return persistedSessions.some((session) => matches(session));
}

export function consumePendingCombatSession(playerId: string, combatId: string) {
  const pending = getPendingCombatSession(playerId, combatId);
  if (!pending) {
    return null;
  }
  storeSettledCombatSessionResult(playerId, pending);
  deleteSession(playerId, combatId);
  return pending;
}

export function tryAcquirePendingCombatSessionLock(playerId: string, combatId: string) {
  const pending = getPendingCombatSession(playerId, combatId);
  if (!pending) {
    return false;
  }

  if (isExpired(pending)) {
    deleteSession(playerId, combatId);
    return false;
  }

  if (pending.locked) {
    return false;
  }

  pending.locked = true;
  persistPendingCombatSession(playerId, combatId, pending, { force: true });
  return true;
}

export function releasePendingCombatSessionLock(playerId: string, combatId: string) {
  const pending = getPendingCombatSession(playerId, combatId);
  if (!pending) {
    return;
  }

  pending.locked = false;
  persistPendingCombatSession(playerId, combatId, pending);
}

export function updatePendingCombatSessionState(
  playerId: string,
  combatId: string,
  state: CombatState,
  options?: { previousLogLength?: number; acceptedClientSequence?: number; preferredEnemySkillId?: string | null },
) {
  const pending = getPendingCombatSession(playerId, combatId);
  if (!pending) {
    return null;
  }

  const nowMs = Date.now();
  syncPendingCombatSceneMovement({ session: pending, nowMs });
  const previousLogLength = options?.previousLogLength ?? pending.state.log.length;
  const newLogEntries = state.log.slice(previousLogLength);
  const timeline = createCombatTimelineForLogEntries({
    state,
    logEntries: newLogEntries,
    baseStartMs: nowMs + 70,
  });
  pending.state = state;
  pending.settleSnapshot = null;
  if (typeof options?.acceptedClientSequence === "number") {
    pending.lastAcceptedClientSequence = options.acceptedClientSequence;
  }
  if (newLogEntries.some((entry) => entry.actorId === state.enemy.id && entry.entryType !== "system" && entry.entryType !== "status")) {
    pending.lastEnemyActionAt = nowMs;
  }
  applyEnemyAiPositionStep({
    session: pending,
    preferredSkillId: options?.preferredEnemySkillId,
  });
  pending.lastRuntimeUpdatedAt = nowMs;
  rebuildPendingCombatSceneSnapshot({
    session: pending,
    timeline,
  });
  publishPendingCombatSceneEvent({
    playerId,
    combatId,
    snapshot: pending.sceneSnapshot,
    state: pending.state,
  });
  if (pending.state.status !== "ongoing") {
    clearPendingCombatRuntimeTimer(playerId, combatId);
  }
  persistPendingCombatSession(playerId, combatId, pending);
  return pending;
}

export function getPendingCombatSessionSettleSnapshot(playerId: string, combatId: string) {
  return getPendingCombatSession(playerId, combatId)?.settleSnapshot || null;
}

export function getSettledCombatSessionResult(playerId: string, combatId: string) {
  const runtimeKey = getTimerKey(playerId, combatId);
  const store = getSettledCombatResultStore();
  const cached = store.get(runtimeKey);
  if (cached) {
    if (isExpiredSettledCombatResult(cached)) {
      deleteSettledCombatSessionResult(playerId, combatId);
      return null;
    }
    return cached;
  }
  return hydrateSettledCombatSessionResult(playerId, combatId);
}

export function updatePendingCombatSessionSettleSnapshot(
  playerId: string,
  combatId: string,
  data: Record<string, unknown>,
) {
  const pending = getPendingCombatSession(playerId, combatId);
  if (!pending) {
    return null;
  }

  pending.settleSnapshot = {
    data,
    createdAt: Date.now(),
  };
  persistPendingCombatSession(playerId, combatId, pending, { force: true });
  return pending.settleSnapshot;
}

export function movePendingCombatSceneUnit(params: {
  playerId: string;
  combatId: string;
  unitId: string;
  targetXPercent: number;
  targetYPercent: number;
  acceptedClientSequence?: number;
  preferredEnemySkillId?: string | null;
}) {
  const pending = getPendingCombatSession(params.playerId, params.combatId);
  if (!pending) {
    return null;
  }

  const currentOverride = pending.scenePositionOverrides[params.unitId];
  const currentSnapshotUnit = pending.sceneSnapshot.units.find((unit) => unit.id === params.unitId);
  if (!currentOverride && !currentSnapshotUnit) {
    return null;
  }

  const nowMs = Date.now();
  if (PENDING_COMBAT_FIXED_POSITION_MODE) {
    const movementReset = freezePendingCombatSceneMovement(pending);
    if (typeof params.acceptedClientSequence === "number") {
      pending.lastAcceptedClientSequence = params.acceptedClientSequence;
    }
    pending.lastRuntimeUpdatedAt = nowMs;
    if (movementReset) {
      rebuildPendingCombatSceneSnapshot({ session: pending });
      publishPendingCombatSceneEvent({
        playerId: params.playerId,
        combatId: params.combatId,
        snapshot: pending.sceneSnapshot,
        state: pending.state,
      });
      persistPendingCombatSession(params.playerId, params.combatId, pending, { force: true });
    } else {
      persistPendingCombatSession(params.playerId, params.combatId, pending);
    }
    return pending;
  }
  const movedDuringSync = syncPendingCombatSceneMovement({ session: pending, nowMs });
  const clampedTargetXPercent = clampCombatSceneXPercent(Math.round(params.targetXPercent * 10) / 10);
  const clampedTargetYPercent = clampCombatScenePlayerYPercent(Math.round(params.targetYPercent * 10) / 10);
  const playerTargetChanged = setSceneMovementTarget(pending, params.unitId, {
    xPercent: clampedTargetXPercent,
    yPercent: clampedTargetYPercent,
    speedXPercentPerSecond: COMBAT_PLAYER_MOVE_SPEED_PERCENT_PER_SECOND,
    speedYPercentPerSecond: COMBAT_PLAYER_MOVE_SPEED_PERCENT_PER_SECOND,
  });

  if (typeof params.acceptedClientSequence === "number") {
    pending.lastAcceptedClientSequence = params.acceptedClientSequence;
  }

  const enemyTargetChanged = applyEnemyAiPositionStep({
    session: pending,
    preferredSkillId: params.preferredEnemySkillId,
  });

  if (!movedDuringSync && !playerTargetChanged && !enemyTargetChanged) {
    pending.lastRuntimeUpdatedAt = nowMs;
    persistPendingCombatSession(params.playerId, params.combatId, pending);
    return pending;
  }

  pending.lastRuntimeUpdatedAt = nowMs;

  if (movedDuringSync || playerTargetChanged || enemyTargetChanged) {
    rebuildPendingCombatSceneSnapshot({ session: pending });

    publishPendingCombatSceneEvent({
      playerId: params.playerId,
      combatId: params.combatId,
      snapshot: pending.sceneSnapshot,
      state: pending.state,
    });
  }

  persistPendingCombatSession(params.playerId, params.combatId, pending);

  return pending;
}

export function getPendingCombatSceneSnapshot(playerId: string, combatId: string) {
  return getPendingCombatSession(playerId, combatId)?.sceneSnapshot || null;
}

export async function syncPendingCombatSessionRuntime(playerId: string, combatId: string) {
  return advancePendingCombatSessionRuntime({
    playerId,
    combatId,
    nowMs: Date.now(),
  });
}

export function getPendingCombatSceneEvents() {
  return getSceneEventLog();
}

export function subscribePendingCombatSceneEvents(subscriber: PendingCombatSceneSubscriber) {
  const subscribers = getSceneSubscribers();
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function subscribePendingCombatSceneEventsByCombat(
  playerId: string,
  combatId: string,
  subscriber: PendingCombatSceneSubscriber,
) {
  const combatKey = getTimerKey(playerId, combatId);
  const store = getSceneSubscribersByCombatKey();
  const subscribers = store.get(combatKey) || new Set<PendingCombatSceneSubscriber>();
  subscribers.add(subscriber);
  store.set(combatKey, subscribers);
  return () => {
    const current = store.get(combatKey);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      store.delete(combatKey);
    }
  };
}
