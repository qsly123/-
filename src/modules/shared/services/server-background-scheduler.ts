type BackgroundJobTimer = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

type BackgroundJobState = {
  key: string;
  timeout: BackgroundJobTimer | null;
  interval: BackgroundJobTimer | null;
  running: boolean;
  intervalMs: number;
  firstDelayMs: number;
  startedAtMs: number;
};

type BackgroundJobStore = Map<string, BackgroundJobState>;

type BackgroundSchedulerGlobal = typeof globalThis & {
  __immortalityBackgroundJobStore?: BackgroundJobStore;
};

export type EnsureRecurringBackgroundJobInput = {
  key: string;
  firstDelayMs?: number;
  intervalMs: number;
  run: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  unref?: boolean;
};

export type BackgroundJobSnapshot = {
  key: string;
  running: boolean;
  hasTimeout: boolean;
  hasInterval: boolean;
  intervalMs: number;
  firstDelayMs: number;
  startedAtMs: number;
};

function normalizeJobKey(value: unknown) {
  return String(value || "").trim();
}

function getBackgroundJobStore() {
  const globalStore = globalThis as BackgroundSchedulerGlobal;
  if (!(globalStore.__immortalityBackgroundJobStore instanceof Map)) {
    globalStore.__immortalityBackgroundJobStore = new Map<string, BackgroundJobState>();
  }
  return globalStore.__immortalityBackgroundJobStore;
}

function maybeUnrefTimer(timer: BackgroundJobTimer | null | undefined, enabled: boolean) {
  if (!timer || enabled === false) {
    return;
  }
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function clearBackgroundJobState(state: BackgroundJobState) {
  if (state.timeout) {
    clearTimeout(state.timeout as ReturnType<typeof setTimeout>);
    state.timeout = null;
  }
  if (state.interval) {
    clearInterval(state.interval as ReturnType<typeof setInterval>);
    state.interval = null;
  }
  state.running = false;
}

export function stopRecurringBackgroundJob(key: string) {
  const normalizedKey = normalizeJobKey(key);
  if (!normalizedKey) {
    return false;
  }

  const store = getBackgroundJobStore();
  const state = store.get(normalizedKey);
  if (!state) {
    return false;
  }

  clearBackgroundJobState(state);
  store.delete(normalizedKey);
  return true;
}

export function ensureRecurringBackgroundJob(input: EnsureRecurringBackgroundJobInput) {
  const key = normalizeJobKey(input.key);
  const intervalMs = Math.max(1_000, Math.floor(Number(input.intervalMs || 0)));
  const firstDelayMs = Math.max(0, Math.floor(Number(input.firstDelayMs || 0)));

  if (!key) {
    throw new Error("后台调度器任务 key 不能为空");
  }

  const store = getBackgroundJobStore();
  const existing = store.get(key);
  if (existing) {
    return existing;
  }

  const state: BackgroundJobState = {
    key,
    timeout: null,
    interval: null,
    running: false,
    intervalMs,
    firstDelayMs,
    startedAtMs: Date.now(),
  };

  const runSafely = async () => {
    if (state.running) {
      return;
    }
    state.running = true;
    try {
      await input.run();
    } catch (error) {
      if (typeof input.onError === "function") {
        input.onError(error);
      } else {
        console.error(`[background-scheduler] job=${key} failed:`, error);
      }
    } finally {
      state.running = false;
    }
  };

  const startInterval = () => {
    if (state.interval) {
      return;
    }
    state.interval = setInterval(() => {
      void runSafely();
    }, intervalMs);
    maybeUnrefTimer(state.interval, input.unref !== false);
  };

  state.timeout = setTimeout(() => {
    state.timeout = null;
    void runSafely();
    startInterval();
  }, firstDelayMs);
  maybeUnrefTimer(state.timeout, input.unref !== false);

  store.set(key, state);
  return state;
}

export function listRecurringBackgroundJobs(): BackgroundJobSnapshot[] {
  return Array.from(getBackgroundJobStore().values()).map((state) => ({
    key: state.key,
    running: state.running,
    hasTimeout: Boolean(state.timeout),
    hasInterval: Boolean(state.interval),
    intervalMs: state.intervalMs,
    firstDelayMs: state.firstDelayMs,
    startedAtMs: state.startedAtMs,
  }));
}
