import type { OpenWorldRebuildSummary } from "@/modules/world/services/world-rebuild-service";
import { rebuildOpenWorldFromWorldBook } from "@/modules/world/services/world-rebuild-service";

export type OpenWorldRebuildJobStatus = "idle" | "running" | "completed" | "failed";

export type OpenWorldRebuildRuntimeLog = {
  at: string;
  phase: string;
  phaseLabel: string;
  detail: string;
};

export type OpenWorldRebuildRuntimeState = {
  jobId: string | null;
  status: OpenWorldRebuildJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  phase: string;
  phaseLabel: string;
  detail: string;
  current: number;
  total: number;
  progressPercent: number;
  summary: OpenWorldRebuildSummary | null;
  error: string | null;
  logs: OpenWorldRebuildRuntimeLog[];
};

type OpenWorldRebuildRuntimeStore = {
  activePromise: Promise<void> | null;
  state: OpenWorldRebuildRuntimeState;
};

const rebuildRuntimeStore = globalThis as typeof globalThis & {
  __openWorldRebuildRuntimeStore__?: OpenWorldRebuildRuntimeStore;
};

function createInitialState(): OpenWorldRebuildRuntimeState {
  return {
    jobId: null,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    phase: "idle",
    phaseLabel: "未开始",
    detail: "尚未开始重制开放世界",
    current: 0,
    total: 1,
    progressPercent: 0,
    summary: null,
    error: null,
    logs: [],
  };
}

function getStore() {
  if (!rebuildRuntimeStore.__openWorldRebuildRuntimeStore__) {
    rebuildRuntimeStore.__openWorldRebuildRuntimeStore__ = {
      activePromise: null,
      state: createInitialState(),
    };
  }
  return rebuildRuntimeStore.__openWorldRebuildRuntimeStore__;
}

function updateState(partial: Partial<OpenWorldRebuildRuntimeState>) {
  const store = getStore();
  store.state = {
    ...store.state,
    ...partial,
  };
}

function pushLogEntry(entry: Omit<OpenWorldRebuildRuntimeLog, "at">) {
  const store = getStore();
  const nextLog: OpenWorldRebuildRuntimeLog = {
    at: new Date().toISOString(),
    ...entry,
  };
  store.state = {
    ...store.state,
    logs: [nextLog, ...store.state.logs].slice(0, 10),
  };
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolvePhaseBasePercent(phase: string) {
  if (phase === "queued") {
    return 2;
  }
  if (phase === "schema-check") {
    return 8;
  }
  if (phase === "bootstrap") {
    return 40;
  }
  if (phase === "rumor-refresh") {
    return 75;
  }
  if (phase === "faction-refresh") {
    return 92;
  }
  if (phase === "completed") {
    return 100;
  }
  return 0;
}

function resolveProgressPercent(phase: string, current?: number, total?: number) {
  if (phase === "completed") {
    return 100;
  }
  if (phase === "failed") {
    return 100;
  }

  const safeCurrent = Number.isFinite(current) ? Number(current) : 0;
  const safeTotal = Number.isFinite(total) && Number(total) > 0 ? Number(total) : 1;
  const ratio = Math.max(0, Math.min(1, safeCurrent / safeTotal));

  if (phase === "schema-check") {
    return clampPercent(3 + ratio * 12);
  }
  if (phase === "bootstrap") {
    return clampPercent(18 + ratio * 40);
  }
  if (phase === "rumor-refresh") {
    return clampPercent(58 + ratio * 24);
  }
  if (phase === "faction-refresh") {
    return clampPercent(84 + ratio * 12);
  }
  return resolvePhaseBasePercent(phase);
}

export function getOpenWorldRebuildRuntimeState() {
  return getStore().state;
}

export function startOpenWorldRebuildJob() {
  const store = getStore();
  if (store.activePromise) {
    return store.state;
  }

  const jobId = `open-world-rebuild:${Date.now()}`;
  const startedAt = new Date().toISOString();
  updateState({
    jobId,
    status: "running",
    startedAt,
    finishedAt: null,
    phase: "queued",
    phaseLabel: "任务排队",
    detail: "开放世界重制任务已入列，正在准备天道与地图数据",
    current: 0,
    total: 1,
    progressPercent: 2,
    summary: null,
    error: null,
    logs: [],
  });
  pushLogEntry({
    phase: "queued",
    phaseLabel: "任务排队",
    detail: "开放世界重制任务已启动，等待进入执行阶段",
  });

  store.activePromise = rebuildOpenWorldFromWorldBook({
    onProgress(progress) {
      const phaseLabel = progress.phaseLabel || progress.phase;
      const current = Number.isFinite(progress.current) ? Number(progress.current) : 0;
      const total = Number.isFinite(progress.total) && Number(progress.total) > 0 ? Number(progress.total) : 1;
      updateState({
        jobId,
        status: "running",
        startedAt,
        phase: progress.phase,
        phaseLabel,
        detail: progress.detail,
        current,
        total,
        progressPercent: resolveProgressPercent(progress.phase, current, total),
      });
      pushLogEntry({
        phase: progress.phase,
        phaseLabel,
        detail: progress.detail,
      });
    },
  }).then((summary) => {
    updateState({
      jobId,
      status: summary.rebuilt ? "completed" : "failed",
      finishedAt: new Date().toISOString(),
      phase: summary.rebuilt ? "completed" : "failed",
      phaseLabel: summary.rebuilt ? "已完成" : "失败",
      detail: summary.rebuilt
        ? `已完成 ${summary.mapCount} 张地图与 ${summary.refreshedStorylineCount} 条故事链刷新`
        : "开放世界重制未完成，基础表结构或引导未就绪",
      current: 1,
      total: 1,
      progressPercent: 100,
      summary,
      error: summary.rebuilt ? null : "开放世界世界书重制失败，表结构或基础引导尚未就绪",
    });
    pushLogEntry({
      phase: summary.rebuilt ? "completed" : "failed",
      phaseLabel: summary.rebuilt ? "已完成" : "失败",
      detail: summary.rebuilt
        ? `重制完成：${summary.mapCount} 张地图、${summary.rumorRefreshCount} 组风闻、${summary.refreshedStorylineCount} 条故事链已刷新`
        : "开放世界世界书重制失败，表结构或基础引导尚未就绪",
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "重制开放世界失败";
    updateState({
      jobId,
      status: "failed",
      finishedAt: new Date().toISOString(),
      phase: "failed",
      phaseLabel: "失败",
      detail: message,
      current: 1,
      total: 1,
      progressPercent: 100,
      summary: null,
      error: message,
    });
    pushLogEntry({
      phase: "failed",
      phaseLabel: "失败",
      detail: message,
    });
  }).finally(() => {
    store.activePromise = null;
  });

  return getStore().state;
}
