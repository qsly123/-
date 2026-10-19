import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import type { CombatRepeatGuardPayload } from "@/types/game";

const PROBE_REPEAT_THRESHOLD = 10;
const BLOCK_REPEAT_THRESHOLD = 20;
const STATE_EXPIRE_MS = 30 * 60 * 1000;

type RepeatKillPatternType = CombatRepeatGuardPayload["patternType"];

type RepeatKillGuardState = {
  history: string[];
  mapId: string | null;
  promptAcknowledged: boolean;
  updatedAt: number;
};

type RepeatKillGuardAnalysis = {
  patternType: RepeatKillPatternType;
  repeatCount: number;
  monsterIds: string[];
};

type RepeatKillGuardGlobal = typeof globalThis & {
  __repeatKillGuardStore?: Map<string, RepeatKillGuardState>;
};

function getStore() {
  const globalStore = globalThis as RepeatKillGuardGlobal;
  globalStore.__repeatKillGuardStore = ensureGlobalMap<string, RepeatKillGuardState>(
    globalStore as Record<string, unknown>,
    "__repeatKillGuardStore",
  );
  return globalStore.__repeatKillGuardStore;
}

function createInitialState(mapId?: string | null): RepeatKillGuardState {
  return {
    history: [],
    mapId: mapId?.trim() || null,
    promptAcknowledged: false,
    updatedAt: Date.now(),
  };
}

function cleanupExpiredStates() {
  const store = getStore();
  const now = Date.now();
  for (const [playerId, state] of store.entries()) {
    if (now - state.updatedAt > STATE_EXPIRE_MS) {
      store.delete(playerId);
    }
  }
}

function analyzeRepeatHistory(history: string[]): RepeatKillGuardAnalysis | null {
  const normalizedHistory = history
    .filter((monsterId): monsterId is string => typeof monsterId === "string")
    .map((monsterId) => monsterId.trim())
    .filter(Boolean);

  if (normalizedHistory.length < 2) {
    return null;
  }

  const uniqueMonsterIds = Array.from(new Set(normalizedHistory));
  if (uniqueMonsterIds.length === 1) {
    return {
      patternType: "same_monster",
      repeatCount: normalizedHistory.length,
      monsterIds: uniqueMonsterIds,
    };
  }

  if (
    uniqueMonsterIds.length === 2
    && normalizedHistory.every((monsterId, index) => index === 0 || monsterId !== normalizedHistory[index - 1])
  ) {
    return {
      patternType: "alternating_pair",
      repeatCount: normalizedHistory.length,
      monsterIds: uniqueMonsterIds,
    };
  }

  return null;
}

function buildGuardMessage(params: {
  patternType: RepeatKillPatternType;
  repeatCount: number;
  blocked: boolean;
}) {
  if (params.blocked) {
    return params.patternType === "same_monster"
      ? `检测到你已连续重复击杀同一只怪物 ${params.repeatCount} 次，当前收益已暂停。切换地图、击杀其他非重复怪物，或断线重连后可恢复。`
      : `检测到你已在两只怪物之间来回重复击杀 ${params.repeatCount} 次，当前收益已暂停。切换地图、击杀其他非重复怪物，或断线重连后可恢复。`;
  }

  return params.patternType === "same_monster"
    ? `检测到你已连续重复击杀同一只怪物超过 ${PROBE_REPEAT_THRESHOLD} 次，请确认仍在正常操作。确认后本次结算不受影响。`
    : `检测到你已在两只怪物之间来回重复击杀超过 ${PROBE_REPEAT_THRESHOLD} 次，请确认仍在正常操作。确认后本次结算不受影响。`;
}

function buildGuardPayload(params: {
  analysis: RepeatKillGuardAnalysis;
  blocked: boolean;
}): CombatRepeatGuardPayload {
  return {
    status: params.blocked ? "reward_blocked" : "probe_required",
    patternType: params.analysis.patternType,
    repeatCount: params.analysis.repeatCount,
    monsterIds: params.analysis.monsterIds,
    message: buildGuardMessage({
      patternType: params.analysis.patternType,
      repeatCount: params.analysis.repeatCount,
      blocked: params.blocked,
    }),
  };
}

function resetStateForNewBehavior(state: RepeatKillGuardState, monsterId: string, mapId?: string | null) {
  state.history = [monsterId];
  state.mapId = mapId?.trim() || null;
  state.promptAcknowledged = false;
  state.updatedAt = Date.now();
}

export function trackRepeatKillGuard(params: {
  playerId: string;
  monsterId: string;
  mapId?: string | null;
}): CombatRepeatGuardPayload | null {
  cleanupExpiredStates();

  const monsterId = params.monsterId.trim();
  if (!monsterId) {
    return null;
  }

  const store = getStore();
  const state = store.get(params.playerId) || createInitialState(params.mapId);
  const normalizedMapId = params.mapId?.trim() || null;

  if (normalizedMapId && state.mapId && state.mapId !== normalizedMapId) {
    resetStateForNewBehavior(state, monsterId, normalizedMapId);
    store.set(params.playerId, state);
    return null;
  }

  const nextHistory = [...state.history, monsterId].slice(-BLOCK_REPEAT_THRESHOLD);
  const analysis = analyzeRepeatHistory(nextHistory);
  if (!analysis) {
    resetStateForNewBehavior(state, monsterId, normalizedMapId ?? state.mapId);
    store.set(params.playerId, state);
    return null;
  }

  state.history = nextHistory;
  state.mapId = normalizedMapId ?? state.mapId;
  state.updatedAt = Date.now();
  store.set(params.playerId, state);

  const requiresConfirmation = analysis.repeatCount > PROBE_REPEAT_THRESHOLD && !state.promptAcknowledged;
  const blocked = analysis.repeatCount >= BLOCK_REPEAT_THRESHOLD && state.promptAcknowledged;

  if (!requiresConfirmation && !blocked) {
    return null;
  }

  return buildGuardPayload({
    analysis,
    blocked,
  });
}

export function acknowledgeRepeatKillGuard(playerId: string): CombatRepeatGuardPayload | null {
  cleanupExpiredStates();

  const state = getStore().get(playerId);
  if (!state) {
    return null;
  }

  const analysis = analyzeRepeatHistory(state.history);
  if (!analysis || analysis.repeatCount <= PROBE_REPEAT_THRESHOLD) {
    return null;
  }

  state.promptAcknowledged = true;
  state.updatedAt = Date.now();

  return buildGuardPayload({
    analysis,
    blocked: analysis.repeatCount >= BLOCK_REPEAT_THRESHOLD,
  });
}

export function resetRepeatKillGuard(playerId: string) {
  getStore().delete(playerId);
}

export function getRepeatKillGuardThresholds() {
  return {
    probeRepeatThreshold: PROBE_REPEAT_THRESHOLD,
    blockRepeatThreshold: BLOCK_REPEAT_THRESHOLD,
  };
}
