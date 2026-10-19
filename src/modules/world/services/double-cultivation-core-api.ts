import { eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getBreakthroughXpByPosition } from "@/modules/character/services/realm-service";
import type { PlayerProfileBottomContent } from "@/modules/shared/types/legacy-plugin";
import {
  getBuiltinDoubleCultivationAdultProfile,
  getBuiltinDoubleCultivationSupplementalStats,
} from "@/modules/world/services/double-cultivation-profile-stats";
import { ensureDoubleCultivationHostLedger } from "@/modules/world/services/double-cultivation-ledger";

const DOUBLE_CULTIVATION_PERCENT_STEPS = [3, 2.5, 2, 1.5, 1];
const DEFAULT_INTIMACY_THRESHOLDS = [50, 150, 300, 500];

function pickFirstRow<T>(result: unknown) {
  if (Array.isArray(result)) {
    return (result[0] as T | undefined) || null;
  }
  if (result && typeof result === "object") {
    const maybeRows = (result as { rows?: unknown }).rows;
    if (Array.isArray(maybeRows)) {
      return (maybeRows[0] as T | undefined) || null;
    }
  }
  return null;
}

function pickRows<T>(result: unknown) {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object") {
    const maybeRows = (result as { rows?: unknown }).rows;
    if (Array.isArray(maybeRows)) {
      return maybeRows as T[];
    }
  }
  return [] as T[];
}

function toNonNegativeBigInt(value: unknown) {
  if (typeof value === "bigint") {
    return value < 0n ? 0n : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return 0n;
    }
    return BigInt(Math.max(0, Math.floor(value)));
  }
  const text = String(value ?? "").trim();
  if (!text) {
    return 0n;
  }
  try {
    const parsed = BigInt(text);
    return parsed < 0n ? 0n : parsed;
  } catch {
    return 0n;
  }
}

function toSafeOutputNumber(value: bigint) {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maxSafe) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(value < 0n ? 0n : value);
}

function calcBaseGain(sourceXp: unknown, percent: number) {
  const safeXp = toNonNegativeBigInt(sourceXp);
  if (safeXp <= 0n || percent <= 0) {
    return 0n;
  }
  return (safeXp * BigInt(Math.max(0, Math.round(percent * 1000)))) / 100000n;
}

function getPercentByUsedCount(usedCount: number) {
  const index = Math.max(0, Math.floor(Number(usedCount) || 0));
  return DOUBLE_CULTIVATION_PERCENT_STEPS[index] || 0;
}

function normalizeUiGender(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "male" || normalized === "man" || normalized === "男") {
    return "男" as const;
  }
  if (normalized === "female" || normalized === "woman" || normalized === "女") {
    return "女" as const;
  }
  return null;
}

function resolveIntimacyLevel(score: number) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  let level = 0;
  for (const threshold of DEFAULT_INTIMACY_THRESHOLDS) {
    if (safeScore >= threshold) {
      level += 1;
      continue;
    }
    break;
  }
  return level;
}

function getShanghaiDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function resolveHistoryPartnerName(params: {
  playerId: string;
  initiatorPlayerId: string;
  targetPlayerId?: string | null;
  targetKind?: string | null;
  targetNameSnapshot?: string | null;
  playerNameMap: Map<string, string>;
}) {
  const targetKind = String(params.targetKind || "player").trim() || "player";
  const targetSnapshot = String(params.targetNameSnapshot || "").trim();
  if (targetKind !== "player") {
    return {
      partnerPlayerId: null,
      partnerPlayerName: targetSnapshot || (targetKind === "monster" ? "未知妖兽" : "未知修士"),
      targetKind,
    };
  }

  const partnerId = params.initiatorPlayerId === params.playerId
    ? String(params.targetPlayerId || "").trim()
    : String(params.initiatorPlayerId || "").trim();
  return {
    partnerPlayerId: partnerId || null,
    partnerPlayerName: params.playerNameMap.get(partnerId) || targetSnapshot || "未知修士",
    targetKind: "player" as const,
  };
}

function resolvePlayerPerspectiveFluidValues(params: {
  targetKind?: string | null;
  isInitiator: boolean;
  initiatorFluidMl?: number | null;
  targetFluidMl?: number | null;
}) {
  const initiatorFluidMl = Math.max(0, Math.floor(Number(params.initiatorFluidMl || 0)));
  const targetFluidMl = Math.max(0, Math.floor(Number(params.targetFluidMl || 0)));
  const targetKind = String(params.targetKind || "player").trim() || "player";

  if (targetKind !== "player") {
    return {
      myFluidMl: Math.max(initiatorFluidMl, targetFluidMl),
      partnerFluidMl: targetFluidMl > 0 ? targetFluidMl : initiatorFluidMl,
    };
  }

  return {
    myFluidMl: params.isInitiator ? initiatorFluidMl : targetFluidMl,
    partnerFluidMl: params.isInitiator ? targetFluidMl : initiatorFluidMl,
  };
}

export async function getDoubleCultivationOverview(playerId: string) {
  await ensureDoubleCultivationHostLedger();

  const player = await db.select({
    id: players.id,
    name: players.name,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
  }).from(players).where(eq(players.id, playerId)).get();

  if (!player) {
    throw new Error("玩家不存在");
  }

  const requestRows = pickRows<{
    id: number;
    player_a_id: string;
    player_b_id: string;
    requested_by: string;
    status: string;
    created_at: string;
    updated_at: string;
    responded_at?: string | null;
  }>(await db.execute(drizzleSql`
    SELECT
      "id",
      "player_a_id",
      "player_b_id",
      "requested_by",
      "status",
      "created_at",
      "updated_at",
      "responded_at"
    FROM "player_double_cultivation_requests"
    WHERE "player_a_id" = ${playerId}
       OR "player_b_id" = ${playerId}
    ORDER BY "updated_at" DESC
  `));

  const targetIds = Array.from(new Set(requestRows.map((row) => (
    row.player_a_id === playerId ? row.player_b_id : row.player_a_id
  )).filter(Boolean)));
  const profiles = targetIds.length > 0
    ? await db.select({
      id: players.id,
      name: players.name,
      realmName: players.realmName,
      gender: players.gender,
    }).from(players).where(inArray(players.id, targetIds)).all()
    : [];
  const profileMap = new Map(profiles.map((row) => [row.id, row]));

  const incomingPending: Array<Record<string, unknown>> = [];
  const outgoingPending: Array<Record<string, unknown>> = [];
  const latestProcessed: Array<Record<string, unknown>> = [];

  for (const row of requestRows) {
    const targetPlayerId = row.player_a_id === playerId ? row.player_b_id : row.player_a_id;
    const target = profileMap.get(targetPlayerId);
    const targetPlayerName = target?.name || "未知修士";
    const targetRealmName = target?.realmName || "未知境界";
    const targetGender = normalizeUiGender(target?.gender) || null;

    if (row.status === "pending") {
      const pendingData = {
        id: row.id,
        targetPlayerId,
        targetPlayerName,
        targetRealmName,
        targetGender,
        createdAt: row.created_at,
        requestedBy: row.requested_by,
      };
      if (row.requested_by === playerId) {
        outgoingPending.push(pendingData);
      } else {
        incomingPending.push(pendingData);
      }
      continue;
    }

    latestProcessed.push({
      id: row.id,
      targetPlayerId,
      targetPlayerName,
      targetRealmName,
      targetGender,
      status: row.status,
      updatedAt: row.updated_at,
      respondedAt: row.responded_at || null,
    });
  }

  const today = getShanghaiDateKey();
  const dailyRow = pickFirstRow<{
    used_count?: number | null;
    positive_gain_total?: string | null;
  }>(await db.execute(drizzleSql`
    SELECT "used_count", "positive_gain_total"::text AS "positive_gain_total"
    FROM "player_double_cultivation_daily"
    WHERE "player_id" = ${playerId}
      AND "date_key" = ${today}
    LIMIT 1
  `));
  const usedCount = Math.max(0, Math.floor(Number(dailyRow?.used_count || 0)));
  const positiveGainTotal = toNonNegativeBigInt(dailyRow?.positive_gain_total);
  const requiredXp = await getBreakthroughXpByPosition(player.realmMajor || 1, player.realmMinor || 1);
  const dailyGainCap = calcBaseGain(requiredXp, 10);
  const remainingGainCap = dailyGainCap > positiveGainTotal ? (dailyGainCap - positiveGainTotal) : 0n;

  const logRows = pickRows<{
    id: number;
    request_id?: number | null;
    initiator_player_id: string;
    target_player_id?: string | null;
    target_kind?: string | null;
    target_monster_id?: string | null;
    target_name_snapshot?: string | null;
    initiator_fluid_ml?: number | null;
    target_fluid_ml?: number | null;
    initiator_intimacy_score?: number | null;
    target_intimacy_score?: number | null;
    initiator_intimacy_level?: number | null;
    target_intimacy_level?: number | null;
    percent?: number | null;
    target_percent?: number | null;
    initiator_xp_gain?: string | number | null;
    target_xp_gain?: string | number | null;
    narrative?: string | null;
    date_key?: string | null;
    created_at: string;
    my_event_count_after?: number | null;
    my_intimacy_score_after?: number | null;
  }>(await db.execute(drizzleSql`
    SELECT
      "id",
      "request_id",
      "initiator_player_id",
      "target_player_id",
      "target_kind",
      "target_monster_id",
      "target_name_snapshot",
      "initiator_fluid_ml",
      "target_fluid_ml",
      "initiator_intimacy_score",
      "target_intimacy_score",
      "initiator_intimacy_level",
      "target_intimacy_level",
      "percent",
      "target_percent",
      "initiator_xp_gain"::text AS "initiator_xp_gain",
      "target_xp_gain"::text AS "target_xp_gain",
      "narrative",
      "date_key",
      "created_at",
      COUNT(*) OVER (ORDER BY "created_at" ASC, "id" ASC)::int AS "my_event_count_after",
      COALESCE(SUM(
        CASE
          WHEN "initiator_player_id" = ${playerId}
            THEN COALESCE("initiator_intimacy_score", 0)
          ELSE COALESCE("target_intimacy_score", 0)
        END
      ) OVER (ORDER BY "created_at" ASC, "id" ASC), 0)::int AS "my_intimacy_score_after"
    FROM "player_double_cultivation_logs"
    WHERE "initiator_player_id" = ${playerId}
       OR "target_player_id" = ${playerId}
    ORDER BY "created_at" DESC, "id" DESC
    LIMIT 50
  `));

  const historyPlayerIds = Array.from(new Set(logRows.flatMap((row) => [
    row.initiator_player_id,
    typeof row.target_player_id === "string" ? row.target_player_id : "",
  ]).filter(Boolean)));
  const historyPlayers = historyPlayerIds.length > 0
    ? await db.select({
      id: players.id,
      name: players.name,
    }).from(players).where(inArray(players.id, historyPlayerIds)).all()
    : [];
  const historyPlayerMap = new Map(historyPlayers.map((row) => [row.id, row.name || "未知修士"]));

  const history = logRows.map((row) => {
    const isInitiator = row.initiator_player_id === playerId;
    const partnerInfo = resolveHistoryPartnerName({
      playerId,
      initiatorPlayerId: row.initiator_player_id,
      targetPlayerId: row.target_player_id,
      targetKind: row.target_kind,
      targetNameSnapshot: row.target_name_snapshot,
      playerNameMap: historyPlayerMap,
    });
    const myPercent = isInitiator ? Number(row.percent || 0) : Number(row.target_percent || 0);
    const partnerPercent = isInitiator ? Number(row.target_percent || 0) : Number(row.percent || 0);
    const myXpGain = isInitiator ? toSafeOutputNumber(toNonNegativeBigInt(row.initiator_xp_gain)) : toSafeOutputNumber(toNonNegativeBigInt(row.target_xp_gain));
    const partnerXpGain = isInitiator ? toSafeOutputNumber(toNonNegativeBigInt(row.target_xp_gain)) : toSafeOutputNumber(toNonNegativeBigInt(row.initiator_xp_gain));
    const fluidValues = resolvePlayerPerspectiveFluidValues({
      targetKind: row.target_kind,
      isInitiator,
      initiatorFluidMl: row.initiator_fluid_ml,
      targetFluidMl: row.target_fluid_ml,
    });
    const myIntimacyDelta = isInitiator
      ? Math.max(0, Math.floor(Number(row.initiator_intimacy_score || 0)))
      : Math.max(0, Math.floor(Number(row.target_intimacy_score || 0)));
    const partnerIntimacyDelta = isInitiator
      ? Math.max(0, Math.floor(Number(row.target_intimacy_score || 0)))
      : Math.max(0, Math.floor(Number(row.initiator_intimacy_score || 0)));
    const myIntimacyLevelBefore = isInitiator
      ? Math.max(0, Math.floor(Number(row.initiator_intimacy_level || 0)))
      : Math.max(0, Math.floor(Number(row.target_intimacy_level || 0)));
    const partnerIntimacyLevelBefore = isInitiator
      ? Math.max(0, Math.floor(Number(row.target_intimacy_level || 0)))
      : Math.max(0, Math.floor(Number(row.initiator_intimacy_level || 0)));
    const myIntimacyScoreAfter = Math.max(0, Math.floor(Number(row.my_intimacy_score_after || 0)));
    return {
      id: row.id,
      requestId: row.request_id ?? null,
      partnerPlayerId: partnerInfo.partnerPlayerId,
      partnerPlayerName: partnerInfo.partnerPlayerName,
      targetKind: partnerInfo.targetKind,
      targetMonsterId: row.target_monster_id ?? null,
      isInitiator,
      myPercent,
      partnerPercent,
      myXpGain,
      partnerXpGain,
      myFluidMl: fluidValues.myFluidMl,
      partnerFluidMl: fluidValues.partnerFluidMl,
      myIntimacyDelta,
      partnerIntimacyDelta,
      myIntimacyLevelBefore,
      partnerIntimacyLevelBefore,
      myEventCountAfter: Math.max(0, Math.floor(Number(row.my_event_count_after || 0))),
      myIntimacyScoreAfter,
      myIntimacyLevelAfter: resolveIntimacyLevel(myIntimacyScoreAfter),
      narrative: String(row.narrative || ""),
      dateKey: row.date_key || "",
      createdAt: row.created_at,
    };
  });

  return {
    incomingPending,
    outgoingPending,
    latestProcessed,
    daily: {
      dateKey: today,
      usedCount,
      nextPercent: getPercentByUsedCount(usedCount),
      todayPercents: DOUBLE_CULTIVATION_PERCENT_STEPS,
      positiveGainTotal: toSafeOutputNumber(positiveGainTotal),
      gainCap: toSafeOutputNumber(dailyGainCap),
      remainingGainCap: toSafeOutputNumber(remainingGainCap),
    },
    history,
  };
}

export async function getDoubleCultivationStats(params: {
  playerId: string;
  gender?: unknown;
}) {
  await ensureDoubleCultivationHostLedger();

  const metricRow = pickFirstRow<{
    event_count?: number | null;
    fluid_ml_total?: number | null;
    intimacy_score?: number | null;
  }>(await db.execute(drizzleSql`
    SELECT
      COUNT(*)::int AS "event_count",
      COALESCE(SUM(
        CASE
          WHEN COALESCE("target_kind", 'player') = 'player' THEN
            CASE
              WHEN "initiator_player_id" = ${params.playerId}
                THEN COALESCE("initiator_fluid_ml", 0)
              ELSE COALESCE("target_fluid_ml", 0)
            END
          ELSE GREATEST(COALESCE("initiator_fluid_ml", 0), COALESCE("target_fluid_ml", 0))
        END
      ), 0)::int AS "fluid_ml_total",
      COALESCE(SUM(
        CASE
          WHEN "initiator_player_id" = ${params.playerId}
            THEN COALESCE("initiator_intimacy_score", 0)
          ELSE COALESCE("target_intimacy_score", 0)
        END
      ), 0)::int AS "intimacy_score"
    FROM "player_double_cultivation_logs"
    WHERE "initiator_player_id" = ${params.playerId}
       OR "target_player_id" = ${params.playerId}
  `));

  const intimacyStatsRow = pickFirstRow<{ intimacy_score?: number | null }>(await db.execute(drizzleSql`
    SELECT "intimacy_score"
    FROM "player_double_cultivation_player_stats"
    WHERE "player_id" = ${params.playerId}
    LIMIT 1
  `));

  const eventCount = Math.max(0, Math.floor(Number(metricRow?.event_count || 0)));
  const fluidMlTotal = Math.max(0, Math.floor(Number(metricRow?.fluid_ml_total || 0)));
  const intimacyScore = Math.max(
    0,
    Math.floor(Number(intimacyStatsRow?.intimacy_score ?? metricRow?.intimacy_score ?? 0)),
  );
  const intimacyLevel = resolveIntimacyLevel(intimacyScore);

  const firstHistoryRow = pickFirstRow<{
    initiator_player_id: string;
    target_player_id?: string | null;
    target_kind?: string | null;
    target_name_snapshot?: string | null;
  }>(await db.execute(drizzleSql`
    SELECT
      "initiator_player_id",
      "target_player_id",
      "target_kind",
      "target_name_snapshot"
    FROM "player_double_cultivation_logs"
    WHERE "initiator_player_id" = ${params.playerId}
       OR "target_player_id" = ${params.playerId}
    ORDER BY "created_at" ASC, "id" ASC
    LIMIT 1
  `));

  const frequentPartnerRows = pickRows<{
    partner_id?: string | null;
    target_kind?: string | null;
    partner_name?: string | null;
    total?: number | null;
  }>(await db.execute(drizzleSql`
    SELECT
      CASE
        WHEN COALESCE("target_kind", 'player') = 'player' THEN
          CASE
            WHEN "initiator_player_id" = ${params.playerId}
              THEN "target_player_id"
            ELSE "initiator_player_id"
          END
        ELSE NULL
      END AS "partner_id",
      COALESCE("target_kind", 'player') AS "target_kind",
      CASE
        WHEN COALESCE("target_kind", 'player') = 'player' THEN
          COALESCE("target_name_snapshot", '')
        ELSE COALESCE("target_name_snapshot", '')
      END AS "partner_name",
      COUNT(*)::int AS "total"
    FROM "player_double_cultivation_logs"
    WHERE "initiator_player_id" = ${params.playerId}
       OR "target_player_id" = ${params.playerId}
    GROUP BY 1, 2, 3
    ORDER BY "total" DESC
    LIMIT 1
  `));

  const frequentPartner = frequentPartnerRows[0] || null;
  const mostPartnerPlayer = frequentPartner?.partner_id
    ? await db.select({
      name: players.name,
    }).from(players).where(eq(players.id, frequentPartner.partner_id)).get()
    : null;

  const lastTimeRow = pickFirstRow<{ created_at?: string | null }>(await db.execute(drizzleSql`
    SELECT "created_at"
    FROM "player_double_cultivation_logs"
    WHERE "initiator_player_id" = ${params.playerId}
       OR "target_player_id" = ${params.playerId}
    ORDER BY "created_at" DESC, "id" DESC
    LIMIT 1
  `));

  const [adultProfile, supplementalStats] = await Promise.all([
    getBuiltinDoubleCultivationAdultProfile({
      playerId: params.playerId,
      intimacyScore,
    }),
    getBuiltinDoubleCultivationSupplementalStats(params),
  ]);

  let firstPartnerName = "暂无";
  if (firstHistoryRow) {
    if (String(firstHistoryRow.target_kind || "player") !== "player") {
      firstPartnerName = String(firstHistoryRow.target_name_snapshot || "未知修士");
    } else {
      const partnerId = firstHistoryRow.initiator_player_id === params.playerId
        ? String(firstHistoryRow.target_player_id || "")
        : String(firstHistoryRow.initiator_player_id || "");
      const partner = partnerId
        ? await db.select({
          name: players.name,
        }).from(players).where(eq(players.id, partnerId)).get()
        : null;
      firstPartnerName = partner?.name || String(firstHistoryRow.target_name_snapshot || "未知修士");
    }
  }

  const mostPartnerName = frequentPartner
    ? (String(frequentPartner.target_kind || "player") !== "player"
      ? String(frequentPartner.partner_name || "未知修士")
      : mostPartnerPlayer?.name || String(frequentPartner.partner_name || "未知修士"))
    : "暂无";

  return {
    metrics: {
      eventCount,
      fluidMlTotal,
      intimacyScore,
      intimacyLevel,
    },
    adultProfile,
    labels: {
      eventCount: "双修次数",
      fluidMlTotal: "累计灵液量",
      intimacyScore: "淫乱度",
      intimacyLevel: "淫乱度等级",
    },
    units: {
      eventCount: "次",
      fluidMlTotal: "ml",
      intimacyScore: "",
      intimacyLevel: "级",
    },
    firstPartnerName,
    mostPartnerName,
    lastTime: lastTimeRow?.created_at || null,
    gender: supplementalStats.gender,
    spermStorageMl: supplementalStats.spermStorageMl,
    spermRecoveryRemainingSeconds: supplementalStats.spermRecoveryRemainingSeconds,
    uterusStorageMl: supplementalStats.uterusStorageMl,
    uterusCapacityMl: supplementalStats.uterusCapacityMl,
    uterusDigestUnlocked: supplementalStats.uterusDigestUnlocked,
    uterusDigestSecondsPerMl: supplementalStats.uterusDigestSecondsPerMl,
    uterusDigestRemainingSeconds: supplementalStats.uterusDigestRemainingSeconds,
    uterusNextDigestAt: supplementalStats.uterusNextDigestAt,
    pregnancyStatus: supplementalStats.pregnancyStatus,
    pregnancyDisplayStatus: supplementalStats.pregnancyDisplayStatus,
    gongfaBonuses: supplementalStats.gongfaBonuses,
  };
}

export type DoubleCultivationStatsView = Awaited<ReturnType<typeof getDoubleCultivationStats>>;

function resolveDoubleCultivationProfileLabels(gender: unknown) {
  const normalizedGender = normalizeUiGender(gender);
  if (normalizedGender === "男") {
    return {
      intimacyScore: "Sex值",
      intimacyLevel: "Sex等级",
      stage: "当前状态",
      firstPartner: "初次对象",
      mostPartner: "最多对象",
    };
  }
  return {
    intimacyScore: "淫乱度",
    intimacyLevel: "淫乱等级",
    stage: "当前状态",
    firstPartner: "初次对象",
    mostPartner: "最多对象",
  };
}

export function buildDoubleCultivationProfileBottomContents(
  stats: DoubleCultivationStatsView,
): PlayerProfileBottomContent[] {
  const labels = resolveDoubleCultivationProfileLabels(stats.gender);
  const metricLabels = stats.labels || {};
  const units = stats.units || {};
  const adultProfile = stats.adultProfile;
  const lines = [
    `${metricLabels.eventCount || "双修次数"}：${Number(stats.metrics.eventCount || 0)}${units.eventCount || "次"}`,
    `${metricLabels.fluidMlTotal || "累计灵液量"}：${Number(stats.metrics.fluidMlTotal || 0)}${units.fluidMlTotal || "ml"}`,
    `${labels.intimacyLevel}：${Number(stats.metrics.intimacyLevel || 0)}${units.intimacyLevel || "级"}`,
    `${labels.intimacyScore}：${Number(stats.metrics.intimacyScore || 0)}${units.intimacyScore || ""}`,
    `堕落值：${adultProfile?.corruptionValue ?? 0}`,
    `魅力：${adultProfile?.allureValue ?? 0}`,
    `羞耻：${adultProfile?.shameValue ?? 0}`,
    `${labels.stage}：${adultProfile?.stageLabel || "暂无"}`,
    `${labels.firstPartner}：${stats.firstPartnerName || "暂无"}`,
    `${labels.mostPartner}：${stats.mostPartnerName || "暂无"}`,
    `最近双修：${stats.lastTime || "暂无"}`,
  ];

  return [{
    id: "double-cultivation-adult-stats",
    pluginId: "double-cultivation",
    title: "双修状态",
    subtitle: "固定核心玩法资料，展示双修次数、关系指标、堕落、魅力和羞耻。",
    contentType: "text",
    content: lines.join("\n"),
    height: 260,
  }];
}

export async function getIncomingDoubleCultivationNotificationCount(playerId: string) {
  await ensureDoubleCultivationHostLedger();
  const row = pickFirstRow<{ total?: number | null }>(await db.execute(drizzleSql`
    SELECT COUNT(*)::int AS "total"
    FROM "player_double_cultivation_requests"
    WHERE "status" = 'pending'
      AND (
        "player_a_id" = ${playerId}
        OR "player_b_id" = ${playerId}
      )
      AND "requested_by" <> ${playerId}
  `));
  return Math.max(0, Math.floor(Number(row?.total || 0)));
}
