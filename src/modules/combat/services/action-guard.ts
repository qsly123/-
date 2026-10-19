type ActionGuardScope = "combat" | "boss";

export type ActionGuardErrorCode =
  | "ACTION_REQUEST_TIME_SKEW"
  | "DUPLICATE_ACTION_REQUEST"
  | "ACTION_RATE_LIMITED";

type PlayerActionWindow = {
  lastActionAt: number;
  recentActionIds: Map<string, number>;
};

type ActionGuardStore = typeof globalThis & {
  __combatActionGuardStore?: Map<string, PlayerActionWindow>;
};

const ACTION_ID_TTL_MS = 12_000;
const MAX_CLIENT_CLOCK_SKEW_MS = 20_000;
const ACTION_WINDOW_TTL_MS = 10 * 60 * 1000;
const SCOPE_MIN_INTERVAL_MS: Record<ActionGuardScope, number> = {
  combat: 140,
  boss: 180,
};

function getActionGuardStore() {
  const root = globalThis as ActionGuardStore;
  root.__combatActionGuardStore = root.__combatActionGuardStore || new Map();
  return root.__combatActionGuardStore;
}

function pruneRecentActionIds(windowState: PlayerActionWindow, nowMs: number) {
  for (const [actionId, createdAt] of windowState.recentActionIds.entries()) {
    if (nowMs - createdAt > ACTION_ID_TTL_MS) {
      windowState.recentActionIds.delete(actionId);
    }
  }
}

function pruneExpiredActionWindows(store: Map<string, PlayerActionWindow>, nowMs: number) {
  for (const [storeKey, windowState] of store.entries()) {
    if (nowMs - windowState.lastActionAt > ACTION_WINDOW_TTL_MS && windowState.recentActionIds.size === 0) {
      store.delete(storeKey);
    }
  }
}

export function guardPlayerAction(params: {
  playerId: string;
  scope: ActionGuardScope;
  encounterId: string;
  actionId?: string;
  clientSentAt?: number;
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const storeKey = `${params.scope}:${params.encounterId}:${params.playerId}`;
  const store = getActionGuardStore();
  pruneExpiredActionWindows(store, nowMs);
  const windowState = store.get(storeKey) || {
    lastActionAt: 0,
    recentActionIds: new Map<string, number>(),
  };

  pruneRecentActionIds(windowState, nowMs);

  if (typeof params.clientSentAt === "number" && Number.isFinite(params.clientSentAt)) {
    const skew = Math.abs(nowMs - params.clientSentAt);
    if (skew > MAX_CLIENT_CLOCK_SKEW_MS) {
      return {
        allowed: false,
        status: 400,
        errorCode: "ACTION_REQUEST_TIME_SKEW" as const,
        error: "动作请求时间异常，请刷新页面后重试",
      };
    }
  }

  if (params.actionId) {
    if (windowState.recentActionIds.has(params.actionId)) {
      return {
        allowed: false,
        status: 409,
        errorCode: "DUPLICATE_ACTION_REQUEST" as const,
        error: "检测到重复动作请求，已拦截",
      };
    }
    windowState.recentActionIds.set(params.actionId, nowMs);
  }

  const minIntervalMs = SCOPE_MIN_INTERVAL_MS[params.scope];
  if (windowState.lastActionAt > 0 && nowMs - windowState.lastActionAt < minIntervalMs) {
    return {
      allowed: false,
      status: 429,
      errorCode: "ACTION_RATE_LIMITED" as const,
      error: "动作过于频繁，请稍后再试",
    };
  }

  windowState.lastActionAt = nowMs;
  store.set(storeKey, windowState);

  return {
    allowed: true,
    status: 200,
  };
}
