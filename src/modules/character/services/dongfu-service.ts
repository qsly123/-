import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getBreakthroughRateByPosition, getBreakthroughXpByPosition } from "@/modules/character/services/realm-service";
import { getPlayerFortuneSpecialEffectSum } from "@/modules/character/services/fortune-service";
import { buildPlayerPillToxicityStatus } from "@/modules/character/services/pill-toxicity-service";
import { getPlayerStatusFlowEffectSum, syncPlayerStatuses } from "@/modules/character/services/player-status";
import { getSectDongfuBonusRate } from "@/modules/sect/services/sect-service";
import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { DONGFU_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

const DONGFU_RATIO_PER_HOUR = 0.05;
const DONGFU_CAP_HOURS = 36;
const DONGFU_MIN_XP_PER_HOUR = 1;
const ONE_HOUR_MS = 60 * 60 * 1000;
const DONGFU_SETTINGS_CACHE_TTL_MS = 30 * 1000;
const DONGFU_LINGQI_BONUS_KEY = "\洞\府\灵\气\增\幅";

type DongfuPlayerSource = Pick<
  typeof players.$inferSelect,
  "id" | "realmMajor" | "realmMinor" | "cultivationXp" | "breakthroughBonusRate" | "dongfuLastClaimAt" | "pillToxicity" | "pillToxicityUpdatedAt"
>;

export interface DongfuSnapshot {
  realmMajor: number;
  realmMinor: number;
  cultivationXp: number;
  breakthroughRequiredXp: number;
  breakthroughBaseRate: number;
  breakthroughBonusRate: number;
  breakthroughSuccessRate: number;
  baseDongfuRatioPerHour: number;
  dongfuRatioPerHour: number;
  fortuneDongfuLingqiRate: number;
  statusDongfuLingqiRate: number;
  sectDongfuLingqiRate: number;
  gongfaDongfuLingqiBonusPercent: number;
  dongfuLingqiBonusRate: number;
  dongfuLingqiBonusSources: string[];
  dongfuCapHours: number;
  dongfuRatePerHourXp: number;
  dongfuAccumulatedMs: number;
  dongfuPendingXp: number;
  dongfuLastClaimAt: string;
  pillToxicity: number;
  pillToxicityLimit: number;
  pillToxicityRecoverIntervalMinutes: number;
  nextPillToxicityRecoverInSeconds: number | null;
}

export interface DongfuClaimResult {
  claimedXp: number;
  cultivationXp: number;
  dongfuLastClaimAt: string;
  snapshot: DongfuSnapshot;
}

interface DongfuSettings {
  ratioPerHour: number;
  capHours: number;
  minXpPerHour: number;
  capMs: number;
}

const DEFAULT_DONGFU_SETTINGS: DongfuSettings = {
  ratioPerHour: DONGFU_RATIO_PER_HOUR,
  capHours: DONGFU_CAP_HOURS,
  minXpPerHour: DONGFU_MIN_XP_PER_HOUR,
  capMs: DONGFU_CAP_HOURS * ONE_HOUR_MS,
};

let dongfuSettingsCache: {
  value: DongfuSettings;
  expiresAt: number;
} | null = null;

function toSafeInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function normalizePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function getDongfuSettings(): Promise<DongfuSettings> {
  const nowMs = Date.now();
  if (dongfuSettingsCache && dongfuSettingsCache.expiresAt > nowMs) {
    return dongfuSettingsCache.value;
  }

  const configMap = await getSystemConfigMap(DONGFU_CONFIG_KEYS);
  const ratioPerHour = normalizePositiveNumber(configMap.DONGFU_XP_RATIO_PER_HOUR, DEFAULT_DONGFU_SETTINGS.ratioPerHour);
  const capHours = normalizePositiveInt(configMap.DONGFU_CAP_HOURS, DEFAULT_DONGFU_SETTINGS.capHours);
  const minXpPerHour = normalizePositiveInt(configMap.DONGFU_MIN_XP_PER_HOUR, DEFAULT_DONGFU_SETTINGS.minXpPerHour);

  const settings: DongfuSettings = {
    ratioPerHour,
    capHours,
    minXpPerHour,
    capMs: capHours * ONE_HOUR_MS,
  };
  dongfuSettingsCache = {
    value: settings,
    expiresAt: nowMs + DONGFU_SETTINGS_CACHE_TTL_MS,
  };
  return settings;
}

function resolveClaimAtIso(raw: string | null | undefined, nowIso: string) {
  if (!raw || typeof raw !== "string") {
    return nowIso;
  }
  const text = raw.trim();
  if (!text) {
    return nowIso;
  }
  const parsedMs = Date.parse(text);
  if (!Number.isFinite(parsedMs)) {
    return nowIso;
  }
  return text;
}

function computeDongfuGain(params: {
  claimAtIso: string;
  nowMs: number;
  ratePerHourXp: number;
  capMs: number;
}) {
  const claimAtMs = Date.parse(params.claimAtIso);
  const elapsedMs = Math.max(0, params.nowMs - claimAtMs);
  const cappedElapsedMs = Math.min(params.capMs, elapsedMs);
  const pendingXp = Math.floor((cappedElapsedMs / ONE_HOUR_MS) * params.ratePerHourXp);
  return {
    cappedElapsedMs,
    pendingXp: Math.max(0, pendingXp),
  };
}

async function getGongfaDongfuLingqiBonusPercent(playerId: string) {
  try {
    const rows = await db.execute<{ total: number | string }>(sql`
      SELECT COALESCE(SUM("attr_value"), 0)::float8 AS "total"
      FROM "plugin_gongfa_level_bonus_items" AS "bonus"
      INNER JOIN "plugin_gongfa_player_progress" AS "progress"
        ON "progress"."gongfa_id" = "bonus"."gongfa_id"
       AND "progress"."player_id" = ${playerId}
       AND "bonus"."level_index" <= "progress"."level"
      INNER JOIN "plugin_gongfa_books" AS "books"
        ON "books"."id" = "progress"."gongfa_id"
       AND "books"."enabled" = true
      WHERE "bonus"."enabled" = true
        AND "bonus"."attr_key" = ${DONGFU_LINGQI_BONUS_KEY}
    `);
    const value = Number(rows[0]?.total || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export async function buildDongfuSnapshot(player: DongfuPlayerSource, now = new Date()): Promise<DongfuSnapshot> {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const settings = await getDongfuSettings();
  await syncPlayerStatuses(player.id);
  const major = Math.max(1, toSafeInt(player.realmMajor, 1));
  const minor = Math.max(1, toSafeInt(player.realmMinor, 1));
  const cultivationXp = Math.max(0, toSafeInt(player.cultivationXp, 0));

  const [
    requiredXp,
    baseRate,
    fortuneBreakthroughBonusRate,
    fortuneDongfuLingqiRate,
    statusDongfuLingqiRate,
    sectDongfuLingqiRate,
    gongfaDongfuLingqiBonusPercent,
    pillToxicityStatus,
  ] = await Promise.all([
    getBreakthroughXpByPosition(major, minor),
    getBreakthroughRateByPosition(major, minor),
    getPlayerFortuneSpecialEffectSum({
      playerId: player.id,
      key: "breakthroughSuccessRate",
    }),
    getPlayerFortuneSpecialEffectSum({
      playerId: player.id,
      key: "dongfuLingqiRate",
    }),
    getPlayerStatusFlowEffectSum({
      playerId: player.id,
      key: "dongfuLingqiRate",
    }),
    getSectDongfuBonusRate(player.id),
    getGongfaDongfuLingqiBonusPercent(player.id),
    buildPlayerPillToxicityStatus(player, now),
  ]);

  const breakthroughRequiredXp = Math.max(1, toSafeInt(requiredXp, 1));
  const breakthroughBaseRate = Math.max(0, Number(baseRate || 0));
  const breakthroughBonusRate = Math.max(0, Number(player.breakthroughBonusRate || 0) + fortuneBreakthroughBonusRate);
  const breakthroughSuccessRate = Math.min(0.95, breakthroughBaseRate + breakthroughBonusRate);
  const dongfuLingqiBonusRate = Number(fortuneDongfuLingqiRate || 0)
    + Number(statusDongfuLingqiRate || 0)
    + Number(sectDongfuLingqiRate || 0)
    + (Number(gongfaDongfuLingqiBonusPercent || 0) / 100);
  const dongfuRatioPerHour = Math.max(0, settings.ratioPerHour * (1 + dongfuLingqiBonusRate));
  const dongfuRatePerHourXp = Math.max(settings.minXpPerHour, Math.floor(breakthroughRequiredXp * dongfuRatioPerHour));

  const claimAtIso = resolveClaimAtIso(player.dongfuLastClaimAt, nowIso);
  const gain = computeDongfuGain({
    claimAtIso,
    nowMs,
    ratePerHourXp: dongfuRatePerHourXp,
    capMs: settings.capMs,
  });

  return {
    realmMajor: major,
    realmMinor: minor,
    cultivationXp,
    breakthroughRequiredXp,
    breakthroughBaseRate,
    breakthroughBonusRate,
    breakthroughSuccessRate,
    baseDongfuRatioPerHour: settings.ratioPerHour,
    dongfuRatioPerHour,
    fortuneDongfuLingqiRate: Number(fortuneDongfuLingqiRate || 0),
    statusDongfuLingqiRate: Number(statusDongfuLingqiRate || 0),
    sectDongfuLingqiRate: Number(sectDongfuLingqiRate || 0),
    gongfaDongfuLingqiBonusPercent: Number(gongfaDongfuLingqiBonusPercent || 0),
    dongfuLingqiBonusRate,
    dongfuLingqiBonusSources: [
      Number(fortuneDongfuLingqiRate || 0) > 0 ? "气运" : "",
      Number(statusDongfuLingqiRate || 0) > 0 ? "状态" : "",
      Number(sectDongfuLingqiRate || 0) > 0 ? "宗门灵气峰" : "",
      Number(gongfaDongfuLingqiBonusPercent || 0) > 0 ? "功法" : "",
    ].filter(Boolean),
    dongfuCapHours: settings.capHours,
    dongfuRatePerHourXp,
    dongfuAccumulatedMs: gain.cappedElapsedMs,
    dongfuPendingXp: gain.pendingXp,
    dongfuLastClaimAt: claimAtIso,
    pillToxicity: pillToxicityStatus.current,
    pillToxicityLimit: pillToxicityStatus.max,
    pillToxicityRecoverIntervalMinutes: pillToxicityStatus.recoverIntervalMinutes,
    nextPillToxicityRecoverInSeconds: pillToxicityStatus.nextRecoverInSeconds,
  };
}

export async function claimDongfuXp(player: DongfuPlayerSource): Promise<DongfuClaimResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const snapshot = await buildDongfuSnapshot(player, now);
  const claimedXp = snapshot.dongfuPendingXp;

  if (claimedXp <= 0) {
    return {
      claimedXp: 0,
      cultivationXp: snapshot.cultivationXp,
      dongfuLastClaimAt: snapshot.dongfuLastClaimAt,
      snapshot,
    };
  }

  const cultivationXp = snapshot.cultivationXp + claimedXp;
  await db.update(players).set({
    cultivationXp,
    dongfuLastClaimAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(players.id, player.id)).run();

  return {
    claimedXp,
    cultivationXp,
    dongfuLastClaimAt: nowIso,
    snapshot: {
      ...snapshot,
      cultivationXp,
      dongfuPendingXp: 0,
      dongfuAccumulatedMs: 0,
      dongfuLastClaimAt: nowIso,
    },
  };
}
