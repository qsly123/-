import { and, eq, gt, inArray, isNull, or, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { playerStatuses, randomEvents } from "@/db/schema";
import {
  createDefaultPregnancySystemConfig,
  PREGNANCY_STATUS_KEY,
  PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY,
  PREGNANCY_STAGE_EVENT_IDS,
  PREGNANCY_STATUS_STAGE_KEYS,
  PREGNANCY_STATUS_SOURCE_PLUGIN_ID,
  PREGNANCY_STATUS_TITLE,
} from "@/modules/character/constants/pregnancy-system";
import { grantFortunesToPlayer } from "@/modules/character/services/fortune-service";
import {
  createOrRestoreEncounterSession,
  getActiveEncounterSessionForPlayer,
} from "@/modules/map/services/map-encounter-session-service";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import type {
  AttributeDelta,
  PlayerStatusFlowEffects,
  PlayerStatusView,
  PregnancyStatusPayload,
  PregnancySystemConfig,
} from "@/types/game";

type DbExecutor = Pick<typeof db, "select" | "update" | "insert" | "delete" | "execute">;

type PlayerStatusRow = typeof playerStatuses.$inferSelect;

export interface PlayerStatusAttrBonus {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
}

export interface PregnancySettleResult {
  triggered: boolean;
  skippedReason?: string;
  pregnancyStatus: PlayerStatusView | null;
  fertilizationDisplayStatus: PlayerStatusView | null;
  statusEffectsApplied: string[];
  chanceRate: number;
  rollValue: number | null;
  absorbedMl: number;
  effectiveAbsorbedMl: number;
}

type ActivePlayerStatusSnapshot = {
  now: Date;
  rows: PlayerStatusRow[];
};

export type PlayerStatusContext = {
  getSnapshot: () => Promise<ActivePlayerStatusSnapshot>;
  getStatuses: () => Promise<PlayerStatusView[]>;
  getAttrBonus: () => Promise<PlayerStatusAttrBonus>;
  getFlowEffectSum: (key: keyof PlayerStatusFlowEffects) => Promise<number>;
};

let playerStatusesTableAvailable: boolean | null = null;

const EMPTY_STATUS_BONUS: PlayerStatusAttrBonus = {
  maxHp: 0,
  maxMp: 0,
  attack: 0,
  defense: 0,
  speed: 0,
  luck: 0,
  spiritualSense: 0,
  armorPenetration: 0,
  block: 0,
  skillDamageBonus: 0,
  skillDamageReduction: 0,
  artifactDamageBonus: 0,
  artifactDamageReduction: 0,
};

const STATIC_PREGNANCY_CONFIG = createDefaultPregnancySystemConfig();
const PREGNANCY_SIDE_EFFECT_PROCESSING_TTL_MS = 10 * 60 * 1000;

function toSafeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function toSafeInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

type DatabaseErrorShape = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function extractDatabaseError(error: unknown): DatabaseErrorShape | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const root = error as DatabaseErrorShape;
  if (typeof root.code === "string") {
    return root;
  }
  if (root.cause && typeof root.cause === "object") {
    return extractDatabaseError(root.cause);
  }
  if (typeof root.message === "string") {
    return root;
  }
  return null;
}

function includesText(value: unknown, keyword: string) {
  return typeof value === "string" && value.toLowerCase().includes(keyword.toLowerCase());
}

function isMissingPlayerStatusesTableError(error: unknown) {
  const dbError = extractDatabaseError(error);
  if (!dbError || dbError.code !== "42P01") {
    return false;
  }
  return includesText(dbError.message, "player_statuses");
}

function normalizeAttrDelta(input: unknown): Required<AttributeDelta> {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return {
    hp: toSafeInt(value.hp),
    maxHp: toSafeInt(value.maxHp),
    mp: toSafeInt(value.mp),
    maxMp: toSafeInt(value.maxMp),
    attack: toSafeInt(value.attack),
    defense: toSafeInt(value.defense),
    speed: toSafeInt(value.speed),
    luck: toSafeInt(value.luck),
    spiritualSense: toSafeInt(value.spiritualSense),
    armorPenetration: toSafeInt(value.armorPenetration),
    block: toSafeInt(value.block),
    skillDamageBonus: toSafeInt(value.skillDamageBonus),
    skillDamageReduction: toSafeInt(value.skillDamageReduction),
    artifactDamageBonus: toSafeInt(value.artifactDamageBonus),
    artifactDamageReduction: toSafeInt(value.artifactDamageReduction),
  };
}

function normalizeFlowEffects(input: unknown): Required<PlayerStatusFlowEffects> {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return {
    dongfuLingqiRate: toSafeNumber(value.dongfuLingqiRate),
    breakthroughSuccessRate: toSafeNumber(value.breakthroughSuccessRate),
    doubleCultivationXpRate: toSafeNumber(value.doubleCultivationXpRate),
  };
}

function buildDurationMs(hours: unknown, progressRate = 0) {
  const safeHours = Math.max(0, toSafeNumber(hours));
  void progressRate;
  return Math.max(0, Math.round(safeHours * 60 * 60 * 1000));
}

export async function resolvePregnancySystemConfig() {
  return STATIC_PREGNANCY_CONFIG;
}

function formatSignedValue(value: number) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function formatPercent(value: number) {
  const percent = value * 100;
  const rounded = Math.abs(percent) >= 1 ? percent.toFixed(0) : percent.toFixed(1);
  return `${percent >= 0 ? "+" : ""}${rounded}%`;
}

export function buildPlayerStatusEffectSummary(input: {
  attrEffects?: AttributeDelta | null;
  flowEffects?: PlayerStatusFlowEffects | null;
}) {
  const attr = normalizeAttrDelta(input.attrEffects || {});
  const flow = normalizeFlowEffects(input.flowEffects || {});
  const lines: string[] = [];

  const attrLabels: Array<[keyof Required<AttributeDelta>, string]> = [
    ["maxHp", "气血上限"],
    ["maxMp", "灵力上限"],
    ["attack", "攻击"],
    ["defense", "防御"],
    ["speed", "遁速"],
    ["luck", "幸运"],
    ["spiritualSense", "神识"],
    ["armorPenetration", "破甲"],
    ["block", "格挡"],
    ["skillDamageBonus", "术伤加成"],
    ["skillDamageReduction", "术伤减免"],
    ["artifactDamageBonus", "法宝增伤"],
    ["artifactDamageReduction", "法宝减伤"],
  ];

  for (const [key, label] of attrLabels) {
    const value = attr[key];
    if (!value) {
      continue;
    }
    lines.push(`${label} ${formatSignedValue(value)}`);
  }

  if (flow.dongfuLingqiRate) {
    lines.push(`洞府灵气 ${formatPercent(flow.dongfuLingqiRate)}`);
  }
  if (flow.breakthroughSuccessRate) {
    lines.push(`突破成功 ${formatPercent(flow.breakthroughSuccessRate)}`);
  }
  if (flow.doubleCultivationXpRate) {
    lines.push(`双修修为 ${formatPercent(flow.doubleCultivationXpRate)}`);
  }

  return lines;
}

function buildRemainingSeconds(row: PlayerStatusRow, nowMs: number) {
  const nextStageMs = row.nextStageAt ? Date.parse(row.nextStageAt) : NaN;
  if (Number.isFinite(nextStageMs)) {
    return Math.max(0, Math.floor((nextStageMs - nowMs) / 1000));
  }
  const expiresMs = row.expiresAt ? Date.parse(row.expiresAt) : NaN;
  if (Number.isFinite(expiresMs)) {
    return Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  }
  return null;
}

function resolveStatusPayload(row: PlayerStatusRow) {
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
    return null;
  }
  return row.payload as Record<string, unknown>;
}

function resolveStatusTitles(row: PlayerStatusRow) {
  const payload = resolveStatusPayload(row);
  const payloadStatusTitle = typeof payload?.statusTitle === "string" ? payload.statusTitle.trim() : "";
  const payloadStageTitle = typeof payload?.stageTitle === "string" ? payload.stageTitle.trim() : "";
  const fallbackStatusTitle = row.statusKey === PREGNANCY_STATUS_KEY ? PREGNANCY_STATUS_TITLE : row.title;
  return {
    statusTitle: payloadStatusTitle || fallbackStatusTitle,
    stageTitle: payloadStageTitle || row.title,
    payload,
  };
}

function toPlayerStatusView(row: PlayerStatusRow, now = new Date()): PlayerStatusView {
  const attrEffects = normalizeAttrDelta(row.attrEffects || {});
  const flowEffects = normalizeFlowEffects(row.flowEffects || {});
  const titles = resolveStatusTitles(row);
  return {
    id: row.id,
    playerId: row.playerId,
    statusKey: row.statusKey,
    title: titles.statusTitle,
    stageTitle: titles.stageTitle,
    stageKey: row.stageKey,
    stageIndex: row.stageIndex,
    iconImageUrl: row.iconImageUrl,
    sourceType: row.sourceType,
    sourcePluginId: row.sourcePluginId,
    sourceRef: row.sourceRef,
    startedAt: row.startedAt,
    nextStageAt: row.nextStageAt,
    expiresAt: row.expiresAt,
    attrEffects,
    flowEffects,
    payload: titles.payload,
    remainingSeconds: buildRemainingSeconds(row, now.getTime()),
    effectSummary: buildPlayerStatusEffectSummary({
      attrEffects,
      flowEffects,
    }),
  };
}

export function isPregnancyExclusiveStage(config: PregnancySystemConfig, stageKey: string | null | undefined) {
  const normalizedStageKey = String(stageKey || "").trim();
  if (!normalizedStageKey) {
    return false;
  }
  return normalizedStageKey === String(config.exclusiveEventStageKey || "").trim();
}

export function buildFemalePregnancyDisplayStatus(config: PregnancySystemConfig): PlayerStatusView {
  const previewStage = getStageByIndex(config, 1);
  return {
    id: "pregnancy-preview",
    playerId: "",
    statusKey: config.statusKey,
    title: config.statusTitle,
    stageTitle: previewStage.title,
    stageKey: previewStage.key,
    stageIndex: 1,
    iconImageUrl: previewStage.iconImageUrl,
    sourceType: null,
    sourcePluginId: config.sourcePluginId,
    sourceRef: null,
    startedAt: "",
    nextStageAt: null,
    expiresAt: null,
    attrEffects: normalizeAttrDelta(previewStage.attrEffects || {}),
    flowEffects: normalizeFlowEffects(previewStage.flowEffects || {}),
    payload: {
      isPreview: true,
      canTriggerExclusiveEvents: false,
      statusTitle: config.statusTitle,
      stageTitle: previewStage.title,
    },
    remainingSeconds: null,
    effectSummary: [],
  };
}

function buildPregnancyDisplayStatusByStageKey(config: PregnancySystemConfig, stageKey: string): PlayerStatusView | null {
  const stageIndex = findStageIndexByKey(config, stageKey);
  if (!stageIndex) {
    return null;
  }
  const stage = getStageByIndex(config, stageIndex);
  return {
    id: `pregnancy-display-${stage.key}`,
    playerId: "",
    statusKey: config.statusKey,
    title: config.statusTitle,
    stageTitle: stage.title,
    stageKey: stage.key,
    stageIndex,
    iconImageUrl: stage.iconImageUrl,
    sourceType: null,
    sourcePluginId: config.sourcePluginId,
    sourceRef: null,
    startedAt: "",
    nextStageAt: null,
    expiresAt: null,
    attrEffects: normalizeAttrDelta(stage.attrEffects || {}),
    flowEffects: normalizeFlowEffects(stage.flowEffects || {}),
    payload: {
      isPreview: true,
      statusTitle: config.statusTitle,
      stageTitle: stage.title,
    },
    remainingSeconds: null,
    effectSummary: [],
  };
}

async function listActiveStatusRows(params: {
  playerIds: string[];
  tx?: DbExecutor;
  nowIso?: string;
}) {
  const tx = params.tx || db;
  const nowIso = params.nowIso || new Date().toISOString();
  if (params.playerIds.length < 1) {
    return [];
  }
  if (playerStatusesTableAvailable === false) {
    return [];
  }

  try {
    const rows = await tx.select().from(playerStatuses).where(and(
      inArray(playerStatuses.playerId, params.playerIds),
      or(
        isNull(playerStatuses.expiresAt),
        gt(playerStatuses.expiresAt, nowIso),
      ),
    )).all();
    playerStatusesTableAvailable = true;
    return rows;
  } catch (error) {
    if (!isMissingPlayerStatusesTableError(error)) {
      throw error;
    }
    playerStatusesTableAvailable = false;
    return [];
  }
}

function addStatusBonus(target: PlayerStatusAttrBonus, delta: Required<AttributeDelta>) {
  target.maxHp += delta.maxHp;
  target.maxMp += delta.maxMp;
  target.attack += delta.attack;
  target.defense += delta.defense;
  target.speed += delta.speed;
  target.luck += delta.luck;
  target.spiritualSense += delta.spiritualSense;
  target.armorPenetration += delta.armorPenetration;
  target.block += delta.block;
  target.skillDamageBonus += delta.skillDamageBonus;
  target.skillDamageReduction += delta.skillDamageReduction;
  target.artifactDamageBonus += delta.artifactDamageBonus;
  target.artifactDamageReduction += delta.artifactDamageReduction;
}

function buildPregnancyPayload(input: Partial<PregnancyStatusPayload>) {
  return {
    ...input,
  } satisfies PregnancyStatusPayload;
}

function getStageByIndex(config: PregnancySystemConfig, stageIndex: number) {
  const safeIndex = Math.max(1, Math.min(config.stages.length, stageIndex));
  return config.stages[safeIndex - 1];
}

function isFinalPregnancyStage(config: PregnancySystemConfig, stageIndex: number) {
  return stageIndex >= config.stages.length;
}

function canTriggerPregnancyExclusiveEvents(config: PregnancySystemConfig, stageKey: string) {
  return isPregnancyExclusiveStage(config, stageKey);
}

function buildPregnancyNextStageAt(params: {
  config: PregnancySystemConfig;
  stageIndex: number;
  progressRate: number;
  anchorIso: string;
}) {
  if (isFinalPregnancyStage(params.config, params.stageIndex)) {
    return null;
  }
  const stage = getStageByIndex(params.config, params.stageIndex);
  const anchorMs = Date.parse(params.anchorIso) || Date.now();
  return new Date(anchorMs + buildDurationMs(stage.durationHours, params.progressRate)).toISOString();
}

function resolvePregnancyInitialStageIndex(params: {
  config: PregnancySystemConfig;
  uterusStorageMl: number;
  uterusCapacityMl: number;
}) {
  void params.uterusStorageMl;
  void params.uterusCapacityMl;
  return Math.max(1, findStageIndexByKey(params.config, PREGNANCY_STATUS_STAGE_KEYS.stage4) || 4);
}

function resolvePregnancyEntryDisplayStageKey(params: {
  config: PregnancySystemConfig;
  uterusStorageMl: number;
  uterusCapacityMl: number;
}) {
  const capacityMl = Math.max(1, Math.floor(params.uterusCapacityMl || 0));
  const storageMl = Math.max(0, Math.floor(params.uterusStorageMl || 0));
  const fillRatio = storageMl / capacityMl;
  return fillRatio > params.config.lowFluidStageRatio
    ? PREGNANCY_STATUS_STAGE_KEYS.highFluid
    : PREGNANCY_STATUS_STAGE_KEYS.lowFluid;
}

function findStageIndexByKey(config: PregnancySystemConfig, stageKey: string) {
  const normalizedStageKey = String(stageKey || "").trim();
  if (!normalizedStageKey) {
    return null;
  }
  const index = config.stages.findIndex((stage) => stage.key === normalizedStageKey);
  return index >= 0 ? index + 1 : null;
}

function resolvePregnancyNextStageIndex(config: PregnancySystemConfig, row: Pick<PlayerStatusRow, "stageIndex" | "stageKey">) {
  const stage4Index = findStageIndexByKey(config, PREGNANCY_STATUS_STAGE_KEYS.stage4);
  if (stage4Index && row.stageIndex < stage4Index) {
    return stage4Index;
  }
  return Math.min(config.stages.length, row.stageIndex + 1);
}

function resolvePregnancyStageEventId(stageKey: string) {
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage4) {
    return PREGNANCY_STAGE_EVENT_IDS.stage4;
  }
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage5) {
    return PREGNANCY_STAGE_EVENT_IDS.stage5;
  }
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage6) {
    return PREGNANCY_STAGE_EVENT_IDS.stage6;
  }
  return null;
}

function getPregnancyStageEventMarkerKey(stageKey: string) {
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage4) {
    return "stage4EventTriggeredAt";
  }
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage5) {
    return "stage5EventTriggeredAt";
  }
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage6) {
    return "stage6EventTriggeredAt";
  }
  return null;
}

function getPregnancyStageEventProcessingKey(stageKey: string) {
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage4) {
    return "stage4EventProcessingAt";
  }
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage5) {
    return "stage5EventProcessingAt";
  }
  if (stageKey === PREGNANCY_STATUS_STAGE_KEYS.stage6) {
    return "stage6EventProcessingAt";
  }
  return null;
}

function hasFreshPregnancyProcessingToken(value: unknown, nowMs = Date.now()) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const tokenMs = Date.parse(value);
  if (!Number.isFinite(tokenMs)) {
    return false;
  }
  return (nowMs - tokenMs) < PREGNANCY_SIDE_EFFECT_PROCESSING_TTL_MS;
}

function buildPregnancyStatusPayloadPatch(params: {
  row: PlayerStatusRow;
  config: PregnancySystemConfig;
  patch: Partial<PregnancyStatusPayload>;
}) {
  return buildPregnancyPayload({
    ...(resolveStatusPayload(params.row) || {}),
    ...params.patch,
    statusTitle: params.config.statusTitle,
    stageTitle: resolveStatusTitles(params.row).stageTitle,
  });
}

type PendingPregnancySideEffect = {
  type: "stage_event" | "stage7_fortune";
  stageKey: string;
  markerKey: keyof PregnancyStatusPayload;
  processingKey: keyof PregnancyStatusPayload;
};

type ClaimedPregnancySideEffect = PendingPregnancySideEffect & {
  token: string;
};

function resolvePendingPregnancySideEffect(params: {
  row: PlayerStatusRow;
  config: PregnancySystemConfig;
  nowMs: number;
}) {
  const payload = (resolveStatusPayload(params.row) || {}) as PregnancyStatusPayload;
  const stageOrder = [
    PREGNANCY_STATUS_STAGE_KEYS.stage4,
    PREGNANCY_STATUS_STAGE_KEYS.stage5,
    PREGNANCY_STATUS_STAGE_KEYS.stage6,
  ];

  for (const stageKey of stageOrder) {
    const stageIndex = findStageIndexByKey(params.config, stageKey);
    const markerKey = getPregnancyStageEventMarkerKey(stageKey);
    const processingKey = getPregnancyStageEventProcessingKey(stageKey);
    if (!stageIndex || !markerKey || !processingKey || params.row.stageIndex < stageIndex) {
      continue;
    }
    if (typeof payload[markerKey] === "string" && String(payload[markerKey]).trim()) {
      continue;
    }
    if (hasFreshPregnancyProcessingToken(payload[processingKey], params.nowMs)) {
      return null;
    }
    return {
      type: "stage_event",
      stageKey,
      markerKey,
      processingKey,
    } satisfies PendingPregnancySideEffect;
  }

  const pregnantStageIndex = findStageIndexByKey(params.config, PREGNANCY_STATUS_STAGE_KEYS.pregnant);
  if (
    pregnantStageIndex
    && params.row.stageIndex >= pregnantStageIndex
    && !(typeof payload.stage7FortuneHandledAt === "string" && payload.stage7FortuneHandledAt.trim())
  ) {
    if (hasFreshPregnancyProcessingToken(payload.stage7FortuneProcessingAt, params.nowMs)) {
      return null;
    }
    return {
      type: "stage7_fortune",
      stageKey: PREGNANCY_STATUS_STAGE_KEYS.pregnant,
      markerKey: "stage7FortuneHandledAt",
      processingKey: "stage7FortuneProcessingAt",
    } satisfies PendingPregnancySideEffect;
  }

  return null;
}

function buildPregnancySideEffectLockKey(playerId: string, statusId: string) {
  return `pregnancy-side-effects:${playerId}:${statusId}`;
}

async function tryAcquirePregnancySideEffectLock(tx: DbExecutor, lockKey: string) {
  const result = await tx.execute(
    drizzleSql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked`,
  ) as Array<{ locked?: boolean | null }> | { rows?: Array<{ locked?: boolean | null }> };
  if (Array.isArray(result)) {
    return result[0]?.locked === true;
  }
  return Array.isArray(result?.rows) && result.rows[0]?.locked === true;
}

function isPregnancyEncounterUnavailableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("0057")
    || message.includes("player_map_event_sessions")
    || message.includes("链式奇遇功能尚未完成数据库迁移");
}

async function claimPregnancySideEffect(params: {
  playerId: string;
  config: PregnancySystemConfig;
}): Promise<{
  row: PlayerStatusRow | null;
  sideEffect: ClaimedPregnancySideEffect | null;
}> {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  let claimedRow: PlayerStatusRow | null = null;
  let sideEffect: ClaimedPregnancySideEffect | null = null;

  await db.transaction(async (tx) => {
    const rows = await listActiveStatusRows({
      playerIds: [params.playerId],
      tx,
      nowIso,
    });
    const row = rows.find((item) => item.statusKey === params.config.statusKey) ?? null;
    if (!row) {
      return;
    }

    const locked = await tryAcquirePregnancySideEffectLock(
      tx,
      buildPregnancySideEffectLockKey(params.playerId, row.id),
    );
    if (!locked) {
      claimedRow = row;
      return;
    }
    const lockedRows = await listActiveStatusRows({
      playerIds: [params.playerId],
      tx,
      nowIso,
    });
    const lockedRow = lockedRows.find((item) => item.id === row.id) ?? null;
    if (!lockedRow) {
      return;
    }

    const pending = resolvePendingPregnancySideEffect({
      row: lockedRow,
      config: params.config,
      nowMs,
    });
    if (!pending) {
      claimedRow = lockedRow;
      return;
    }

    const token = nowIso;
    const patch = {
      [pending.processingKey]: token,
    } as Partial<PregnancyStatusPayload>;
    const nextPayload = buildPregnancyStatusPayloadPatch({
      row: lockedRow,
      config: params.config,
      patch,
    });

    await tx.update(playerStatuses).set({
      payload: nextPayload,
      updatedAt: nowIso,
    }).where(eq(playerStatuses.id, lockedRow.id)).run();

    claimedRow = {
      ...lockedRow,
      payload: nextPayload,
      updatedAt: nowIso,
    };
    sideEffect = {
      ...pending,
      token,
    };
  });

  return {
    row: claimedRow,
    sideEffect,
  };
}

async function finalizePregnancySideEffect(params: {
  playerId: string;
  rowId: string;
  config: PregnancySystemConfig;
  sideEffect: ClaimedPregnancySideEffect;
  patch?: Partial<PregnancyStatusPayload>;
}) {
  const nowIso = new Date().toISOString();
  let finalRow: PlayerStatusRow | null = null;

  await db.transaction(async (tx) => {
    const locked = await tryAcquirePregnancySideEffectLock(
      tx,
      buildPregnancySideEffectLockKey(params.playerId, params.rowId),
    );
    if (!locked) {
      return;
    }
    const rows = await listActiveStatusRows({
      playerIds: [params.playerId],
      tx,
      nowIso,
    });
    const row = rows.find((item) => item.id === params.rowId) ?? null;
    if (!row) {
      return;
    }

    const payload = (resolveStatusPayload(row) || {}) as PregnancyStatusPayload;
    if (String(payload[params.sideEffect.processingKey] || "").trim() !== params.sideEffect.token.trim()) {
      finalRow = row;
      return;
    }

    const nextPayload = buildPregnancyStatusPayloadPatch({
      row,
      config: params.config,
      patch: {
        [params.sideEffect.processingKey]: null,
        ...(params.patch || {}),
      } as Partial<PregnancyStatusPayload>,
    });

    await tx.update(playerStatuses).set({
      payload: nextPayload,
      updatedAt: nowIso,
    }).where(eq(playerStatuses.id, row.id)).run();

    finalRow = {
      ...row,
      payload: nextPayload,
      updatedAt: nowIso,
    };
  });

  return finalRow;
}

async function executePregnancyStageEventSideEffect(params: {
  playerId: string;
  config: PregnancySystemConfig;
  sideEffect: ClaimedPregnancySideEffect;
}) {
  const markerKey = getPregnancyStageEventMarkerKey(params.sideEffect.stageKey);
  const eventId = resolvePregnancyStageEventId(params.sideEffect.stageKey);
  if (!markerKey || !eventId) {
    return null;
  }

  const player = await getPlayerByIdCompat(params.playerId);
  if (!player?.currentMapId) {
    return null;
  }

  try {
    const activeEncounter = await getActiveEncounterSessionForPlayer(params.playerId, player.currentMapId);
    if (activeEncounter?.sessionStatus === "active") {
      return null;
    }
  } catch (error) {
    if (isPregnancyEncounterUnavailableError(error)) {
      return null;
    }
    throw error;
  }

  const eventRow = await db.select().from(randomEvents).where(eq(randomEvents.id, eventId)).get();
  if (!eventRow) {
    return null;
  }

  try {
    await createOrRestoreEncounterSession({
      playerId: params.playerId,
      playerName: player.name || "无名修士",
      playerRealmName: player.realmName || "凡人",
      currentMapId: player.currentMapId,
      eventRow,
    });
  } catch (error) {
    if (isPregnancyEncounterUnavailableError(error)) {
      return null;
    }
    throw error;
  }

  return {
    [markerKey]: new Date().toISOString(),
  } as Partial<PregnancyStatusPayload>;
}

async function executePregnancyStage7FortuneSideEffect(params: {
  playerId: string;
  rowId: string;
}) {
  const nowIso = new Date().toISOString();
  const configuredFortuneId = String(await getSystemConfigValue(PREGNANCY_STAGE7_FORTUNE_CONFIG_KEY) || "").trim();
  if (!configuredFortuneId) {
    return {
      stage7FortuneHandledAt: nowIso,
      stage7FortuneId: null,
      stage7FortuneAction: "skipped",
      stage7FortuneReason: "missing_config",
    } satisfies Partial<PregnancyStatusPayload>;
  }

  const grantResult = (await grantFortunesToPlayer({
    playerId: params.playerId,
    fortuneIds: [configuredFortuneId],
    sourceType: "system",
    sourceRef: `pregnancy:${params.rowId}:stage7`,
  }))[0];

  return {
    stage7FortuneHandledAt: nowIso,
    stage7FortuneGrantedAt: grantResult && grantResult.action !== "skipped" ? nowIso : undefined,
    stage7FortuneId: configuredFortuneId,
    stage7FortuneAction: grantResult?.action || "skipped",
    stage7FortuneReason: grantResult?.reason || null,
  } satisfies Partial<PregnancyStatusPayload>;
}

async function processPregnancyStageSideEffects(params: {
  playerId: string;
  config: PregnancySystemConfig;
}) {
  const claimed = await claimPregnancySideEffect({
    playerId: params.playerId,
    config: params.config,
  });
  if (!claimed?.row) {
    return null;
  }

  if (!claimed.sideEffect) {
    return claimed.row;
  }

  const sideEffect = claimed.sideEffect;

  try {
    const patch = sideEffect.type === "stage_event"
      ? await executePregnancyStageEventSideEffect({
        playerId: params.playerId,
        config: params.config,
        sideEffect,
      })
      : await executePregnancyStage7FortuneSideEffect({
        playerId: params.playerId,
        rowId: claimed.row.id,
      });
    return await finalizePregnancySideEffect({
      playerId: params.playerId,
      rowId: claimed.row.id,
      config: params.config,
      sideEffect,
      patch: patch ?? undefined,
    });
  } catch (error) {
    await finalizePregnancySideEffect({
      playerId: params.playerId,
      rowId: claimed.row.id,
      config: params.config,
      sideEffect,
    });
    throw error;
  }
}

async function expirePregnancyStatusRow(params: {
  tx: DbExecutor;
  row: PlayerStatusRow;
  config: PregnancySystemConfig;
  nowIso: string;
  reason: string;
  uterusStorageMl?: number;
  uterusCapacityMl?: number;
}) {
  const nextPayload = {
    ...(resolveStatusPayload(params.row) || {}),
    expiredReason: params.reason,
    expiredAt: params.nowIso,
    uterusStorageMl: Math.max(0, Math.floor(Number(params.uterusStorageMl || 0))),
    uterusCapacityMl: Math.max(0, Math.floor(Number(params.uterusCapacityMl || 0))),
    uterusFillRatio: Math.max(
      0,
      Number(params.uterusCapacityMl || 0) > 0
        ? Number(params.uterusStorageMl || 0) / Number(params.uterusCapacityMl || 1)
        : 0,
    ),
    canTriggerExclusiveEvents: false,
    statusTitle: params.config.statusTitle,
    stageTitle: resolveStatusTitles(params.row).stageTitle,
  };

  await params.tx.update(playerStatuses).set({
    title: params.config.statusTitle,
    expiresAt: params.nowIso,
    nextStageAt: null,
    payload: nextPayload,
    updatedAt: params.nowIso,
  }).where(eq(playerStatuses.id, params.row.id)).run();
}

async function transitionPregnancyStatusRow(params: {
  tx: DbExecutor;
  row: PlayerStatusRow;
  config: PregnancySystemConfig;
  nextStageIndex: number;
  nowIso: string;
  anchorIso?: string;
}) {
  const nextStage = getStageByIndex(params.config, params.nextStageIndex);
  const baseAnchorIso = params.anchorIso || params.nowIso;
  const nextStageAt = buildPregnancyNextStageAt({
    config: params.config,
    stageIndex: params.nextStageIndex,
    progressRate: 0,
    anchorIso: baseAnchorIso,
  });
  const nextPayload = {
    ...(resolveStatusPayload(params.row) || {}),
    canTriggerExclusiveEvents: canTriggerPregnancyExclusiveEvents(params.config, nextStage.key),
    statusTitle: params.config.statusTitle,
    stageTitle: nextStage.title,
  };

  await params.tx.update(playerStatuses).set({
    title: params.config.statusTitle,
    stageKey: nextStage.key,
    stageIndex: params.nextStageIndex,
    iconImageUrl: nextStage.iconImageUrl,
    nextStageAt,
    attrEffects: nextStage.attrEffects,
    flowEffects: nextStage.flowEffects,
    payload: nextPayload,
    updatedAt: params.nowIso,
  }).where(eq(playerStatuses.id, params.row.id)).run();

  return {
    ...params.row,
    title: params.config.statusTitle,
    stageKey: nextStage.key,
    stageIndex: params.nextStageIndex,
    iconImageUrl: nextStage.iconImageUrl,
    nextStageAt,
    attrEffects: nextStage.attrEffects,
    flowEffects: nextStage.flowEffects,
    payload: nextPayload,
    updatedAt: params.nowIso,
  } satisfies PlayerStatusRow;
}

async function advancePregnancyStatusRow(params: {
  tx: DbExecutor;
  row: PlayerStatusRow;
  config: PregnancySystemConfig;
  nowIso: string;
}) {
  let currentRow = params.row;

  while (
    currentRow.nextStageAt
    && !isFinalPregnancyStage(params.config, currentRow.stageIndex)
    && Date.parse(currentRow.nextStageAt) <= Date.parse(params.nowIso)
  ) {
    const nextStageIndex = resolvePregnancyNextStageIndex(params.config, currentRow);
    currentRow = await transitionPregnancyStatusRow({
      tx: params.tx,
      row: currentRow,
      config: params.config,
      nextStageIndex,
      nowIso: params.nowIso,
      anchorIso: currentRow.nextStageAt,
    });
  }
}

export async function syncPlayerStatuses(playerId: string) {
  const config = await resolvePregnancySystemConfig();
  if (!config.enabled) {
    return [];
  }
  if (playerStatusesTableAvailable === false) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const existingRows = await listActiveStatusRows({
    playerIds: [playerId],
    nowIso,
  });
  if (existingRows.length < 1) {
    return [];
  }
  const pregnancyRows = existingRows.filter((row) => row.statusKey === config.statusKey);
  if (pregnancyRows.length < 1) {
    return existingRows.map((row) => toPlayerStatusView(row));
  }

  await db.transaction(async (tx) => {
    for (const row of pregnancyRows) {
      await advancePregnancyStatusRow({
        tx,
        row,
        config,
        nowIso,
      });
    }
  });

  await processPregnancyStageSideEffects({
    playerId,
    config,
  });

  return getPlayerStatuses(playerId, {
    skipSync: true,
  });
}

async function loadActiveStatusSnapshot(playerId: string, options?: {
  skipSync?: boolean;
}): Promise<ActivePlayerStatusSnapshot> {
  if (!options?.skipSync) {
    await syncPlayerStatuses(playerId);
  }
  const now = new Date();
  const rows = await listActiveStatusRows({
    playerIds: [playerId],
    nowIso: now.toISOString(),
  });
  return {
    now,
    rows,
  };
}

function buildPlayerStatusAttrBonusFromRows(rows: PlayerStatusRow[]) {
  const total = { ...EMPTY_STATUS_BONUS };
  for (const row of rows) {
    addStatusBonus(total, normalizeAttrDelta(row.attrEffects || {}));
  }
  return total;
}

export function createPlayerStatusContext(playerId: string, options?: {
  skipSync?: boolean;
}): PlayerStatusContext {
  let snapshotPromise: Promise<ActivePlayerStatusSnapshot> | null = null;
  let statusesPromise: Promise<PlayerStatusView[]> | null = null;
  let attrBonusPromise: Promise<PlayerStatusAttrBonus> | null = null;
  const getSnapshot = async () => {
    if (!snapshotPromise) {
      snapshotPromise = loadActiveStatusSnapshot(playerId, options);
    }
    return await snapshotPromise;
  };

  return {
    getSnapshot,
    getStatuses: async () => {
      if (!statusesPromise) {
        statusesPromise = getSnapshot().then((snapshot) => snapshot.rows
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map((row) => toPlayerStatusView(row, snapshot.now)));
      }
      return await statusesPromise;
    },
    getAttrBonus: async () => {
      if (!attrBonusPromise) {
        attrBonusPromise = getSnapshot().then((snapshot) => buildPlayerStatusAttrBonusFromRows(snapshot.rows));
      }
      return await attrBonusPromise;
    },
    getFlowEffectSum: async (key) => {
      const snapshot = await getSnapshot();
      return snapshot.rows.reduce((sum, row) => {
        const flow = normalizeFlowEffects(row.flowEffects || {});
        return sum + toSafeNumber(flow[key]);
      }, 0);
    },
  };
}

export async function getPlayerStatuses(playerId: string, options?: {
  skipSync?: boolean;
}) {
  return await createPlayerStatusContext(playerId, options).getStatuses();
}

export async function getPlayersStatusMap(playerIds: string[]) {
  const uniqueIds = [...new Set(playerIds.map((id) => String(id || "").trim()).filter(Boolean))];
  for (const playerId of uniqueIds) {
    await syncPlayerStatuses(playerId);
  }
  const now = new Date();
  const rows = await listActiveStatusRows({
    playerIds: uniqueIds,
    nowIso: now.toISOString(),
  });
  const map = new Map<string, PlayerStatusView[]>();
  for (const row of rows) {
    const current = map.get(row.playerId) || [];
    current.push(toPlayerStatusView(row, now));
    map.set(row.playerId, current);
  }
  for (const [playerId, list] of map.entries()) {
    map.set(playerId, list.sort((left, right) => left.stageIndex - right.stageIndex));
  }
  return map;
}

export async function getPlayerStatusAttrBonus(playerId: string) {
  return await createPlayerStatusContext(playerId).getAttrBonus();
}

export async function getPlayerStatusFlowEffectSum(params: {
  playerId: string;
  key: keyof PlayerStatusFlowEffects;
}) {
  return await createPlayerStatusContext(params.playerId).getFlowEffectSum(params.key);
}

export async function syncPregnancyStatusFromUterusState(params: {
  femalePlayerId?: string | null;
  uterusStorageMl?: number | null;
  uterusCapacityMl?: number | null;
  absorbedMl?: number | null;
  sourceRef?: string | null;
  sourceType?: string | null;
  sourcePluginId?: string | null;
  sourceTargetKind?: "player" | "monster" | "world_npc" | null;
  sourceTargetId?: string | null;
}) {
  const config = await resolvePregnancySystemConfig();
  const uterusStorageMl = Math.max(0, Math.floor(toSafeNumber(params.uterusStorageMl, 0)));
  const uterusCapacityMl = Math.max(1, Math.floor(toSafeNumber(params.uterusCapacityMl, 120)));
  const absorbedMl = Math.max(0, Math.floor(toSafeNumber(params.absorbedMl, 0)));
  const uterusFillRatio = uterusCapacityMl > 0 ? uterusStorageMl / uterusCapacityMl : 0;
  const entryDisplayStage = resolvePregnancyEntryDisplayStageKey({
    config,
    uterusStorageMl,
    uterusCapacityMl,
  });
  let fertilizationDisplayStatus = uterusStorageMl > 0
    ? buildPregnancyDisplayStatusByStageKey(config, entryDisplayStage)
    : null;

  if (playerStatusesTableAvailable === false) {
    return {
      triggered: false,
      skippedReason: "status_table_missing",
      pregnancyStatus: null,
      fertilizationDisplayStatus,
      statusEffectsApplied: [],
      chanceRate: 0,
      rollValue: null,
      absorbedMl,
      effectiveAbsorbedMl: uterusStorageMl,
    } satisfies PregnancySettleResult;
  }

  if (!config.enabled) {
    return {
      triggered: false,
      skippedReason: "system_disabled",
      pregnancyStatus: null,
      fertilizationDisplayStatus,
      statusEffectsApplied: [],
      chanceRate: 0,
      rollValue: null,
      absorbedMl,
      effectiveAbsorbedMl: uterusStorageMl,
    } satisfies PregnancySettleResult;
  }

  const femalePlayerId = String(params.femalePlayerId || "").trim();
  if (!femalePlayerId) {
    return {
      triggered: false,
      skippedReason: "missing_female_player",
      pregnancyStatus: null,
      fertilizationDisplayStatus,
      statusEffectsApplied: [],
      chanceRate: 0,
      rollValue: null,
      absorbedMl,
      effectiveAbsorbedMl: uterusStorageMl,
    } satisfies PregnancySettleResult;
  }

  await syncPlayerStatuses(femalePlayerId);

  const femalePlayer = await getPlayerByIdCompat(femalePlayerId);
  if (!femalePlayer || femalePlayer.gender !== "女") {
    return {
      triggered: false,
      skippedReason: "not_female_player",
      pregnancyStatus: null,
      fertilizationDisplayStatus,
      statusEffectsApplied: [],
      chanceRate: 0,
      rollValue: null,
      absorbedMl,
      effectiveAbsorbedMl: uterusStorageMl,
    } satisfies PregnancySettleResult;
  }

  const initialStageIndex = resolvePregnancyInitialStageIndex({
    config,
    uterusStorageMl,
    uterusCapacityMl,
  });
  const nowIso = new Date().toISOString();
  const currentRows = await listActiveStatusRows({
    playerIds: [femalePlayerId],
    nowIso,
  });
  const activePregnancy = currentRows.find((row) => row.statusKey === config.statusKey) ?? null;
  const finalStageIndex = config.stages.length;
  if (activePregnancy && activePregnancy.stageIndex >= finalStageIndex) {
    fertilizationDisplayStatus = null;
  }

  if (uterusStorageMl <= 0) {
    if (!activePregnancy || activePregnancy.stageIndex >= finalStageIndex) {
      return {
        triggered: false,
        skippedReason: "no_retained_fluid",
        pregnancyStatus: activePregnancy ? toPlayerStatusView(activePregnancy) : null,
        fertilizationDisplayStatus: null,
        statusEffectsApplied: activePregnancy ? toPlayerStatusView(activePregnancy).effectSummary || [] : [],
        chanceRate: 0,
        rollValue: null,
        absorbedMl,
        effectiveAbsorbedMl: 0,
      } satisfies PregnancySettleResult;
    }

    await db.transaction(async (tx) => {
      await expirePregnancyStatusRow({
        tx,
        row: activePregnancy,
        config,
        nowIso,
        reason: "uterus_cleared",
        uterusStorageMl,
        uterusCapacityMl,
      });
    });
    const statuses = await getPlayerStatuses(femalePlayerId, { skipSync: true });
    return {
      triggered: true,
      skippedReason: "uterus_cleared",
      pregnancyStatus: statuses.find((item) => item.statusKey === config.statusKey) || null,
      fertilizationDisplayStatus: null,
      statusEffectsApplied: [],
      chanceRate: 0,
      rollValue: null,
      absorbedMl,
      effectiveAbsorbedMl: 0,
    } satisfies PregnancySettleResult;
  }

  const targetStage = getStageByIndex(config, initialStageIndex);
  const payload = buildPregnancyPayload({
    absorbedMl,
    effectiveAbsorbedMl: uterusStorageMl,
    uterusStorageMl,
    uterusCapacityMl,
    uterusFillRatio,
    entryDisplayStage,
    canTriggerExclusiveEvents: canTriggerPregnancyExclusiveEvents(config, targetStage.key),
    statusTitle: config.statusTitle,
    stageTitle: targetStage.title,
    sourceLogId: params.sourceRef || null,
    sourceTargetKind: params.sourceTargetKind || null,
    sourceTargetId: params.sourceTargetId || null,
    stage4EventId: PREGNANCY_STAGE_EVENT_IDS.stage4,
    stage5EventId: PREGNANCY_STAGE_EVENT_IDS.stage5,
    stage6EventId: PREGNANCY_STAGE_EVENT_IDS.stage6,
  });
  const nextStageAt = buildPregnancyNextStageAt({
    config,
    stageIndex: initialStageIndex,
    progressRate: 0,
    anchorIso: nowIso,
  });

  let insertedOrUpdated = false;
  let finalRow: PlayerStatusRow | null = activePregnancy;
  try {
    const lockKey = `pregnancy:${femalePlayerId}:${config.statusKey}`;
    await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const lockedRows = await listActiveStatusRows({
        playerIds: [femalePlayerId],
        tx,
        nowIso,
      });
      const lockedPregnancy = lockedRows.find((row) => row.statusKey === config.statusKey) ?? null;
      finalRow = lockedPregnancy;

      if (!lockedPregnancy) {
        finalRow = (await tx.insert(playerStatuses).values({
          playerId: femalePlayerId,
          statusKey: config.statusKey,
          title: config.statusTitle,
          stageKey: targetStage.key,
          stageIndex: initialStageIndex,
          iconImageUrl: targetStage.iconImageUrl,
          sourceType: params.sourceType || "double_cultivation",
          sourcePluginId: params.sourcePluginId || PREGNANCY_STATUS_SOURCE_PLUGIN_ID,
          sourceRef: params.sourceRef || null,
          startedAt: nowIso,
          nextStageAt,
          expiresAt: null,
          attrEffects: targetStage.attrEffects,
          flowEffects: targetStage.flowEffects,
          payload,
          createdAt: nowIso,
          updatedAt: nowIso,
        }).returning().get()) ?? null;
        insertedOrUpdated = Boolean(finalRow);
        return;
      }

      if (lockedPregnancy.stageIndex >= finalStageIndex) {
        const shouldRefreshFinalPayload = (
          Number((resolveStatusPayload(lockedPregnancy)?.uterusStorageMl as number | undefined) || 0) !== uterusStorageMl
          || Number((resolveStatusPayload(lockedPregnancy)?.uterusCapacityMl as number | undefined) || 0) !== uterusCapacityMl
          || String((resolveStatusPayload(lockedPregnancy)?.entryDisplayStage as string | undefined) || "") !== entryDisplayStage
        );
        if (!shouldRefreshFinalPayload) {
          finalRow = lockedPregnancy;
          return;
        }
        const finalPayload = buildPregnancyPayload({
          ...(resolveStatusPayload(lockedPregnancy) || {}),
          ...payload,
          canTriggerExclusiveEvents: canTriggerPregnancyExclusiveEvents(config, lockedPregnancy.stageKey),
          stageTitle: resolveStatusTitles(lockedPregnancy).stageTitle,
        });
        await tx.update(playerStatuses).set({
          payload: finalPayload,
          updatedAt: nowIso,
        }).where(eq(playerStatuses.id, lockedPregnancy.id)).run();
        finalRow = {
          ...lockedPregnancy,
          payload: finalPayload,
          updatedAt: nowIso,
        };
        insertedOrUpdated = true;
        return;
      }

      const shouldRealignEarlyStage = lockedPregnancy.stageIndex < initialStageIndex;
      const shouldRefreshPayload = (
        Number((resolveStatusPayload(lockedPregnancy)?.uterusStorageMl as number | undefined) || 0) !== uterusStorageMl
        || Number((resolveStatusPayload(lockedPregnancy)?.uterusCapacityMl as number | undefined) || 0) !== uterusCapacityMl
        || String((resolveStatusPayload(lockedPregnancy)?.entryDisplayStage as string | undefined) || "") !== entryDisplayStage
        || String(lockedPregnancy.sourceRef || "") !== String(params.sourceRef || "")
      );

      if (!shouldRealignEarlyStage && !shouldRefreshPayload) {
        finalRow = lockedPregnancy;
        return;
      }

      const realignedStageIndex = shouldRealignEarlyStage ? initialStageIndex : lockedPregnancy.stageIndex;
      const realignedStage = getStageByIndex(config, realignedStageIndex);
      const realignedPayload = buildPregnancyPayload({
        ...(resolveStatusPayload(lockedPregnancy) || {}),
        ...payload,
        canTriggerExclusiveEvents: canTriggerPregnancyExclusiveEvents(config, realignedStage.key),
        stageTitle: realignedStage.title,
      });
      const realignedNextStageAt = shouldRealignEarlyStage
        ? buildPregnancyNextStageAt({
          config,
          stageIndex: realignedStageIndex,
          progressRate: 0,
          anchorIso: nowIso,
        })
        : lockedPregnancy.nextStageAt;

      await tx.update(playerStatuses).set({
        title: config.statusTitle,
        stageKey: realignedStage.key,
        stageIndex: realignedStageIndex,
        iconImageUrl: realignedStage.iconImageUrl,
        sourceRef: params.sourceRef || lockedPregnancy.sourceRef,
        nextStageAt: realignedNextStageAt,
        startedAt: shouldRealignEarlyStage ? nowIso : lockedPregnancy.startedAt,
        attrEffects: realignedStage.attrEffects,
        flowEffects: realignedStage.flowEffects,
        payload: realignedPayload,
        updatedAt: nowIso,
      }).where(eq(playerStatuses.id, lockedPregnancy.id)).run();

      finalRow = {
        ...lockedPregnancy,
        title: config.statusTitle,
        stageKey: realignedStage.key,
        stageIndex: realignedStageIndex,
        iconImageUrl: realignedStage.iconImageUrl,
        sourceRef: params.sourceRef || lockedPregnancy.sourceRef,
        startedAt: shouldRealignEarlyStage ? nowIso : lockedPregnancy.startedAt,
        nextStageAt: realignedNextStageAt,
        attrEffects: realignedStage.attrEffects,
        flowEffects: realignedStage.flowEffects,
        payload: realignedPayload,
        updatedAt: nowIso,
      };
      insertedOrUpdated = true;
    });
    playerStatusesTableAvailable = true;
  } catch (error) {
    if (!isMissingPlayerStatusesTableError(error)) {
      throw error;
    }
    playerStatusesTableAvailable = false;
    return {
      triggered: false,
      skippedReason: "status_table_missing",
      pregnancyStatus: null,
      fertilizationDisplayStatus,
      statusEffectsApplied: [],
      chanceRate: 0,
      rollValue: null,
      absorbedMl,
      effectiveAbsorbedMl: uterusStorageMl,
    } satisfies PregnancySettleResult;
  }

  const sideEffectRow = await processPregnancyStageSideEffects({
    playerId: femalePlayerId,
    config,
  });
  const finalStatuses = await getPlayerStatuses(femalePlayerId, { skipSync: true });
  const refreshedStatus = finalStatuses.find((item) => item.statusKey === config.statusKey) || null;
  if (sideEffectRow && sideEffectRow.stageIndex >= finalStageIndex) {
    fertilizationDisplayStatus = null;
  }
  return {
    triggered: insertedOrUpdated,
    skippedReason: insertedOrUpdated ? undefined : "already_tracking",
    pregnancyStatus: refreshedStatus,
    fertilizationDisplayStatus,
    statusEffectsApplied: refreshedStatus?.effectSummary || [],
    chanceRate: 1,
    rollValue: 0,
    absorbedMl,
    effectiveAbsorbedMl: uterusStorageMl,
  } satisfies PregnancySettleResult;
}

export async function settlePregnancyFromDoubleCultivation(params: {
  femalePlayerId?: string | null;
  malePlayerId?: string | null;
  sourceRef?: string | null;
  sourceType?: string | null;
  sourcePluginId?: string | null;
  sourceTargetKind?: "player" | "monster" | "world_npc" | null;
  sourceTargetId?: string | null;
  absorbedMl?: number | null;
  uterusStorageMl?: number | null;
  uterusCapacityMl?: number | null;
}) {
  return syncPregnancyStatusFromUterusState({
    femalePlayerId: params.femalePlayerId,
    uterusStorageMl: params.uterusStorageMl ?? params.absorbedMl ?? 0,
    uterusCapacityMl: params.uterusCapacityMl ?? 120,
    absorbedMl: params.absorbedMl,
    sourceRef: params.sourceRef,
    sourceType: params.sourceType,
    sourcePluginId: params.sourcePluginId,
    sourceTargetKind: params.sourceTargetKind,
    sourceTargetId: params.sourceTargetId,
  });
}

export async function getPlayerStatusSummaryForProfile(playerId: string) {
  const rows = await getPlayerStatuses(playerId);
  return rows;
}
