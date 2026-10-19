import {
  OPEN_WORLD_ACTION_LABELS,
  OPEN_WORLD_REALM_NAMES,
  normalizeOpenWorldAction,
  type OpenWorldNpcAction,
} from "@/modules/world/services/world-config";

type WorldNpcStatRecord = Record<string, number>;

export type OpenWorldNpcGrowthPathKey = "herbal" | "hunter" | "market" | "wanderer";

export type OpenWorldNpcGrowthPath = {
  key: OpenWorldNpcGrowthPathKey;
  name: string;
  favoredActions: OpenWorldNpcAction[];
  stageLabels: [string, string, string, string, string];
  breakthroughHint: string;
  breakthroughVerb: string;
};

export type OpenWorldNpcGrowthSummary = {
  pathKey: OpenWorldNpcGrowthPathKey;
  pathName: string;
  stageLabel: string;
  nextBreakthroughHint: string;
  currentProgress: number;
  nextThreshold: number;
  favoredActionLabel: string;
  dominantActionLabel: string;
};

export type OpenWorldNpcGrowthAdvanceResult = {
  realmMinor: number;
  realmName: string;
  statsSummary: WorldNpcStatRecord;
  growthSummary: OpenWorldNpcGrowthSummary;
  breakthroughLog: {
    logType: string;
    title: string;
    content: string;
    payloadJson: Record<string, unknown>;
  } | null;
};

const ACTION_EXP_KEYS: Record<OpenWorldNpcAction, keyof WorldNpcGrowthMetrics> = {
  idle: "idleExp",
  wander: "wanderExp",
  gather: "gatherExp",
  hunt: "huntExp",
  loot: "lootExp",
  return: "returnExp",
  stall: "stallExp",
  dead: "idleExp",
};

const ACTION_BASE_GAIN: Record<OpenWorldNpcAction, number> = {
  idle: 1,
  wander: 4,
  gather: 9,
  hunt: 11,
  loot: 7,
  return: 3,
  stall: 8,
  dead: 0,
};

const GROWTH_PATHS: Record<OpenWorldNpcGrowthPathKey, OpenWorldNpcGrowthPath> = {
  herbal: {
    key: "herbal",
    name: "草木采修",
    favoredActions: ["gather", "wander", "return"],
    stageLabels: ["识药学徒", "百草养息", "药行小成", "木元渐盛", "草木通灵"],
    breakthroughHint: "继续采药、识草、往返山野，药息自会推着他破关。",
    breakthroughVerb: "借百草药息冲开了新的窍关",
  },
  hunter: {
    key: "hunter",
    name: "斗猎磨骨",
    favoredActions: ["hunt", "loot", "wander"],
    stageLabels: ["试锋追迹", "血战磨骨", "猎意成势", "山野称雄", "凶名外扬"],
    breakthroughHint: "再猎几轮低阶妖物、收整战利，筋骨火候便会更足。",
    breakthroughVerb: "在一次追猎之后，硬生生磨出了更强的骨血",
  },
  market: {
    key: "market",
    name: "市井聚气",
    favoredActions: ["stall", "loot", "return"],
    stageLabels: ["小摊讨生", "市气聚财", "坊间成名", "掌势行商", "一方商魁"],
    breakthroughHint: "多摆摊、多周转、多收拢机缘，市井烟火里也能凝出修为。",
    breakthroughVerb: "借市井财气与人潮往来，悄然积出了新修为",
  },
  wanderer: {
    key: "wanderer",
    name: "杂修悟道",
    favoredActions: ["wander", "loot", "gather"],
    stageLabels: ["尘途摸索", "杂学汇流", "见闻结印", "散修扬名", "自辟一脉"],
    breakthroughHint: "继续四处游走、拾遗补缺，杂修的路本就靠经历堆出来。",
    breakthroughVerb: "凭东拼西凑的见闻与执念，硬是悟透了一层新路",
  },
};

type WorldNpcGrowthMetrics = {
  progress: number;
  threshold: number;
  idleExp: number;
  wanderExp: number;
  gatherExp: number;
  huntExp: number;
  lootExp: number;
  returnExp: number;
  stallExp: number;
};

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function clampRealmMinor(value: number) {
  return Math.max(1, Math.min(OPEN_WORLD_REALM_NAMES.length - 1, Math.floor(value)));
}

function buildRealmName(realmMinor: number) {
  return OPEN_WORLD_REALM_NAMES[clampRealmMinor(realmMinor)] || OPEN_WORLD_REALM_NAMES[1];
}

function buildGrowthThreshold(realmMinor: number) {
  const normalizedRealm = clampRealmMinor(realmMinor);
  return 42 + normalizedRealm * 22 + Math.max(0, normalizedRealm - 4) * 8;
}

function normalizeMetricValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeTraitTags(traitTags: string[] | null | undefined) {
  return Array.isArray(traitTags) ? traitTags.filter(Boolean) : [];
}

function buildGrowthMetrics(params: {
  seed: string;
  realmMinor: number;
  profession: string | null | undefined;
  statsSummary?: WorldNpcStatRecord | null;
}) {
  const normalizedRealm = clampRealmMinor(params.realmMinor);
  const path = resolveOpenWorldNpcGrowthPath(params.profession);
  const existing = params.statsSummary || {};
  const defaultThreshold = buildGrowthThreshold(normalizedRealm);
  const favoredBonus = path.favoredActions.reduce((sum, action, index) => (
    sum + ((hashSeed(`${params.seed}:favored:${index}`) % 6) + 2)
  ), 0);
  const seedProgress = Math.min(defaultThreshold - 1, (hashSeed(`${params.seed}:progress`) % 18) + favoredBonus);

  return {
    progress: normalizeMetricValue(existing.growthProgress, seedProgress),
    threshold: Math.max(12, normalizeMetricValue(existing.growthThreshold, defaultThreshold)),
    idleExp: normalizeMetricValue(existing.idleExp),
    wanderExp: normalizeMetricValue(existing.wanderExp, path.favoredActions.includes("wander") ? 6 : 0),
    gatherExp: normalizeMetricValue(existing.gatherExp, path.favoredActions.includes("gather") ? 10 : 0),
    huntExp: normalizeMetricValue(existing.huntExp, path.favoredActions.includes("hunt") ? 10 : 0),
    lootExp: normalizeMetricValue(existing.lootExp, path.favoredActions.includes("loot") ? 8 : 0),
    returnExp: normalizeMetricValue(existing.returnExp, path.favoredActions.includes("return") ? 6 : 0),
    stallExp: normalizeMetricValue(existing.stallExp, path.favoredActions.includes("stall") ? 8 : 0),
  } satisfies WorldNpcGrowthMetrics;
}

function buildTraitActionBonus(traitTags: string[], action: OpenWorldNpcAction) {
  let bonus = 0;
  if (traitTags.includes("机敏") && (action === "loot" || action === "wander")) {
    bonus += 2;
  }
  if (traitTags.includes("沉静") && (action === "gather" || action === "stall")) {
    bonus += 2;
  }
  if ((traitTags.includes("胆大") || traitTags.includes("狠辣")) && action === "hunt") {
    bonus += 2;
  }
  if ((traitTags.includes("念旧") || traitTags.includes("热心")) && action === "return") {
    bonus += 1;
  }
  if ((traitTags.includes("贪利") || traitTags.includes("爱酒")) && action === "stall") {
    bonus += 1;
  }
  return bonus;
}

function buildGrowthGain(params: {
  dnaSeed: string;
  profession: string | null | undefined;
  traitTags: string[];
  action: OpenWorldNpcAction;
  realmMinor: number;
}) {
  const action = normalizeOpenWorldAction(params.action);
  const path = resolveOpenWorldNpcGrowthPath(params.profession);
  const favoredBonus = path.favoredActions.includes(action) ? 3 : 0;
  const traitBonus = buildTraitActionBonus(params.traitTags, action);
  const realmBonus = Math.max(0, Math.floor(params.realmMinor / 3));
  const variance = hashSeed(`${params.dnaSeed}:${action}:${params.realmMinor}`) % 3;
  return ACTION_BASE_GAIN[action] + favoredBonus + traitBonus + realmBonus + variance;
}

function buildStageIndex(realmMinor: number) {
  if (realmMinor >= 8) {
    return 4;
  }
  if (realmMinor >= 6) {
    return 3;
  }
  if (realmMinor >= 4) {
    return 2;
  }
  if (realmMinor >= 2) {
    return 1;
  }
  return 0;
}

function buildDominantActionLabel(metrics: WorldNpcGrowthMetrics) {
  const candidates: Array<{ action: OpenWorldNpcAction; value: number }> = [
    { action: "wander", value: metrics.wanderExp },
    { action: "gather", value: metrics.gatherExp },
    { action: "hunt", value: metrics.huntExp },
    { action: "loot", value: metrics.lootExp },
    { action: "return", value: metrics.returnExp },
    { action: "stall", value: metrics.stallExp },
  ];
  const dominant = candidates.sort((left, right) => right.value - left.value)[0] || { action: "wander" as const, value: 0 };
  return OPEN_WORLD_ACTION_LABELS[dominant.action];
}

function mergeStatsWithMetrics(baseStats: WorldNpcStatRecord, metrics: WorldNpcGrowthMetrics) {
  return {
    ...baseStats,
    growthProgress: metrics.progress,
    growthThreshold: metrics.threshold,
    idleExp: metrics.idleExp,
    wanderExp: metrics.wanderExp,
    gatherExp: metrics.gatherExp,
    huntExp: metrics.huntExp,
    lootExp: metrics.lootExp,
    returnExp: metrics.returnExp,
    stallExp: metrics.stallExp,
  } satisfies WorldNpcStatRecord;
}

export function resolveOpenWorldNpcGrowthPath(profession: string | null | undefined): OpenWorldNpcGrowthPath {
  const normalized = String(profession || "").trim();
  if (normalized.includes("药") || normalized.includes("草")) {
    return GROWTH_PATHS.herbal;
  }
  if (normalized.includes("猎") || normalized.includes("巡山")) {
    return GROWTH_PATHS.hunter;
  }
  if (normalized.includes("商") || normalized.includes("摊")) {
    return GROWTH_PATHS.market;
  }
  return GROWTH_PATHS.wanderer;
}

export function buildOpenWorldNpcStats(seed: string, realmMinor: number) {
  const normalizedRealm = clampRealmMinor(realmMinor);
  const base = 118 + (hashSeed(seed) % 42);
  return {
    hp: base + normalizedRealm * 24,
    attack: 15 + normalizedRealm * 4,
    defense: 9 + normalizedRealm * 3,
    speed: 9 + normalizedRealm * 2,
    luck: 7 + (hashSeed(`${seed}:luck`) % 7),
    spiritualSense: 6 + normalizedRealm * 2,
    armorPenetration: Math.max(0, Math.floor((normalizedRealm - 1) / 2)),
    block: Math.min(22, 3 + normalizedRealm * 2),
    skillDamageBonus: Math.max(0, (normalizedRealm - 3) * 2),
    skillDamageReduction: Math.max(0, normalizedRealm - 2),
    artifactDamageBonus: Math.max(0, normalizedRealm - 4),
    artifactDamageReduction: Math.max(0, normalizedRealm - 4),
  } satisfies WorldNpcStatRecord;
}

export function buildInitialOpenWorldNpcStats(params: {
  seed: string;
  realmMinor: number;
  profession: string | null | undefined;
  traitTags: string[] | null | undefined;
}) {
  const baseStats = buildOpenWorldNpcStats(params.seed, params.realmMinor);
  const metrics = buildGrowthMetrics({
    seed: params.seed,
    realmMinor: params.realmMinor,
    profession: params.profession,
  });
  return mergeStatsWithMetrics(baseStats, metrics);
}

export function describeOpenWorldNpcGrowth(params: {
  dnaSeed: string;
  profession: string | null | undefined;
  traitTags: string[] | null | undefined;
  realmMinor: number;
  statsSummary?: WorldNpcStatRecord | null;
}) {
  const normalizedRealm = clampRealmMinor(params.realmMinor);
  const path = resolveOpenWorldNpcGrowthPath(params.profession);
  const metrics = buildGrowthMetrics({
    seed: params.dnaSeed,
    realmMinor: normalizedRealm,
    profession: params.profession,
    statsSummary: params.statsSummary,
  });
  const stageIndex = buildStageIndex(normalizedRealm);
  const favoredAction = path.favoredActions[0] || "wander";

  return {
    pathKey: path.key,
    pathName: path.name,
    stageLabel: path.stageLabels[stageIndex],
    nextBreakthroughHint: path.breakthroughHint,
    currentProgress: metrics.progress,
    nextThreshold: metrics.threshold,
    favoredActionLabel: OPEN_WORLD_ACTION_LABELS[favoredAction],
    dominantActionLabel: buildDominantActionLabel(metrics),
  } satisfies OpenWorldNpcGrowthSummary;
}

export function advanceOpenWorldNpcGrowth(params: {
  npcId: string;
  npcName: string;
  dnaSeed: string;
  profession: string | null | undefined;
  traitTags: string[] | null | undefined;
  realmMinor: number;
  currentAction: string | null | undefined;
  statsSummary?: WorldNpcStatRecord | null;
}) {
  const normalizedRealm = clampRealmMinor(params.realmMinor);
  const traitTags = normalizeTraitTags(params.traitTags);
  const action = normalizeOpenWorldAction(params.currentAction);
  const path = resolveOpenWorldNpcGrowthPath(params.profession);
  const metrics = buildGrowthMetrics({
    seed: params.dnaSeed,
    realmMinor: normalizedRealm,
    profession: params.profession,
    statsSummary: params.statsSummary,
  });
  const gain = buildGrowthGain({
    dnaSeed: params.dnaSeed,
    profession: params.profession,
    traitTags,
    action,
    realmMinor: normalizedRealm,
  });
  const actionExpKey = ACTION_EXP_KEYS[action];
  const nextMetrics: WorldNpcGrowthMetrics = {
    ...metrics,
    [actionExpKey]: metrics[actionExpKey] + gain,
    progress: metrics.progress + gain,
  };

  let nextRealmMinor = normalizedRealm;
  let breakthroughLog: OpenWorldNpcGrowthAdvanceResult["breakthroughLog"] = null;

  while (nextMetrics.progress >= nextMetrics.threshold && nextRealmMinor < (OPEN_WORLD_REALM_NAMES.length - 1)) {
    nextMetrics.progress -= nextMetrics.threshold;
    nextRealmMinor += 1;
    nextMetrics.threshold = buildGrowthThreshold(nextRealmMinor);
    breakthroughLog = {
      logType: "growth_breakthrough",
      title: "修行有成",
      content: `${params.npcName}${path.breakthroughVerb}，境界已迈入${buildRealmName(nextRealmMinor)}。`,
      payloadJson: {
        npcId: params.npcId,
        pathKey: path.key,
        pathName: path.name,
        action,
        actionLabel: OPEN_WORLD_ACTION_LABELS[action],
        previousRealmMinor: nextRealmMinor - 1,
        currentRealmMinor: nextRealmMinor,
        progressGain: gain,
      },
    };
  }

  const nextStats = mergeStatsWithMetrics(
    buildOpenWorldNpcStats(params.dnaSeed, nextRealmMinor),
    nextMetrics,
  );

  return {
    realmMinor: nextRealmMinor,
    realmName: buildRealmName(nextRealmMinor),
    statsSummary: nextStats,
    growthSummary: describeOpenWorldNpcGrowth({
      dnaSeed: params.dnaSeed,
      profession: params.profession,
      traitTags,
      realmMinor: nextRealmMinor,
      statsSummary: nextStats,
    }),
    breakthroughLog,
  } satisfies OpenWorldNpcGrowthAdvanceResult;
}

export function normalizeOpenWorldNpcGrowthStats(params: {
  dnaSeed: string;
  profession: string | null | undefined;
  traitTags: string[] | null | undefined;
  realmMinor: number;
  statsSummary?: WorldNpcStatRecord | null;
}) {
  const normalizedRealm = clampRealmMinor(params.realmMinor);
  const metrics = buildGrowthMetrics({
    seed: params.dnaSeed,
    realmMinor: normalizedRealm,
    profession: params.profession,
    statsSummary: params.statsSummary,
  });
  return mergeStatsWithMetrics(
    buildOpenWorldNpcStats(params.dnaSeed, normalizedRealm),
    metrics,
  );
}

export function getOpenWorldNpcRealmName(realmMinor: number) {
  return buildRealmName(realmMinor);
}
