import { cleanupAiGeneratedItems } from "@/modules/admin/services/ai-item-admin-service";

const AI_ITEM_AUTO_CLEANUP_THROTTLE_MS = 60 * 60 * 1000;
const AI_ITEM_AUTO_CLEANUP_MIN_AGE_HOURS = 6;
const AI_ITEM_AUTO_CLEANUP_DELETE_LIMIT = 500;

type AiItemAutoCleanupGlobal = typeof globalThis & {
  __immortalityAiItemAutoCleanupPromise?: Promise<AiItemAutoCleanupResult> | null;
  __immortalityAiItemAutoCleanupLastRunAt?: number;
  __immortalityAiItemAutoCleanupLastResult?: AiItemAutoCleanupResult | null;
};

export type AiItemAutoCleanupResult = {
  executed: boolean;
  executedAt: string | null;
  trigger: string;
  minAgeHours: number;
  deleteLimit: number;
  deletedCount: number;
  deletedIds: string[];
  skippedReason?: "throttled" | "failed";
};

export type AiItemAutoCleanupState = {
  inFlight: boolean;
  lastResult: AiItemAutoCleanupResult | null;
};

type ScheduleAiItemAutoCleanupInput = {
  trigger?: string;
  force?: boolean;
};

function buildSkippedResult(input: {
  trigger: string;
  skippedReason: "throttled" | "failed";
}): AiItemAutoCleanupResult {
  return {
    executed: false,
    executedAt: null,
    trigger: input.trigger,
    minAgeHours: AI_ITEM_AUTO_CLEANUP_MIN_AGE_HOURS,
    deleteLimit: AI_ITEM_AUTO_CLEANUP_DELETE_LIMIT,
    deletedCount: 0,
    deletedIds: [],
    skippedReason: input.skippedReason,
  };
}

async function runAiItemAutoCleanup(trigger: string): Promise<AiItemAutoCleanupResult> {
  const executedAt = new Date().toISOString();
  const result = await cleanupAiGeneratedItems({
    minAgeHours: AI_ITEM_AUTO_CLEANUP_MIN_AGE_HOURS,
    deleteLimit: AI_ITEM_AUTO_CLEANUP_DELETE_LIMIT,
    dryRun: false,
  });

  if (result.deletedCount > 0) {
    console.info(
      `[ai-item-auto-cleanup] trigger=${trigger} deleted=${result.deletedCount} candidate=${result.candidateCount} protected=${result.protectedCount}`,
    );
  }

  return {
    executed: true,
    executedAt,
    trigger,
    minAgeHours: AI_ITEM_AUTO_CLEANUP_MIN_AGE_HOURS,
    deleteLimit: AI_ITEM_AUTO_CLEANUP_DELETE_LIMIT,
    deletedCount: result.deletedCount,
    deletedIds: result.deletedIds,
  };
}

export function scheduleAiItemAutoCleanup(input: ScheduleAiItemAutoCleanupInput = {}) {
  const trigger = String(input.trigger || "unknown").trim() || "unknown";
  const globalStore = globalThis as AiItemAutoCleanupGlobal;
  const nowMs = Date.now();
  const lastRunAt = globalStore.__immortalityAiItemAutoCleanupLastRunAt || 0;

  if (globalStore.__immortalityAiItemAutoCleanupPromise) {
    return globalStore.__immortalityAiItemAutoCleanupPromise;
  }

  if (!input.force && nowMs - lastRunAt < AI_ITEM_AUTO_CLEANUP_THROTTLE_MS) {
    const result = buildSkippedResult({
      trigger,
      skippedReason: "throttled",
    });
    globalStore.__immortalityAiItemAutoCleanupLastResult = result;
    return Promise.resolve(result);
  }

  globalStore.__immortalityAiItemAutoCleanupPromise = runAiItemAutoCleanup(trigger)
    .then((result) => {
      if (result.executed) {
        globalStore.__immortalityAiItemAutoCleanupLastRunAt = Date.now();
      }
      globalStore.__immortalityAiItemAutoCleanupLastResult = result;
      return result;
    })
    .catch((error) => {
      console.error(`[ai-item-auto-cleanup] trigger=${trigger} failed:`, error);
      const result = buildSkippedResult({
        trigger,
        skippedReason: "failed",
      });
      globalStore.__immortalityAiItemAutoCleanupLastResult = result;
      return result;
    })
    .finally(() => {
      globalStore.__immortalityAiItemAutoCleanupPromise = null;
    });

  return globalStore.__immortalityAiItemAutoCleanupPromise;
}

export function getAiItemAutoCleanupState(): AiItemAutoCleanupState {
  const globalStore = globalThis as AiItemAutoCleanupGlobal;
  return {
    inFlight: Boolean(globalStore.__immortalityAiItemAutoCleanupPromise),
    lastResult: globalStore.__immortalityAiItemAutoCleanupLastResult || null,
  };
}
