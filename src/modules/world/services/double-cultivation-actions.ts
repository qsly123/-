import { eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { items, players } from "@/db/schema";
import { syncPregnancyStatusFromUterusState } from "@/modules/character/services/player-status";
import { getBreakthroughXpByPosition } from "@/modules/character/services/realm-service";
import { grantRewardToPlayer, type GrantedReward } from "@/modules/character/services/reward-service";
import { ensureDoubleCultivationHostLedger } from "@/modules/world/services/double-cultivation-ledger";

const DOUBLE_CULTIVATION_PERCENT_STEPS = [3, 2.5, 2, 1.5, 1];
const DOUBLE_CULTIVATION_DAILY_GAIN_CAP_PERCENT = 10;
const DEFAULT_SPERM_STORAGE_ML = 50;
const DEFAULT_UTERUS_CAPACITY_ML = 120;
const DEFAULT_PLAYER_PLAYER_FLUID_ML = 9;
const DEFAULT_PLAYER_PLAYER_INTIMACY_DELTA = 2;

const EXPEL_SEMEN_ITEM_ID = "d3b725f7-ae2f-4efd-a640-86a191ec33fe";
const EXPEL_SEMEN_ITEM_NAME = "精液";
const EXPEL_MIN_ML = 3;
const EXPEL_MAX_ML = 7;

type DoubleCultivationRequestRow = {
  id: number;
  player_a_id: string;
  player_b_id: string;
  requested_by: string;
  status: string;
  created_at: string;
  updated_at: string;
  responded_at?: string | null;
};

type HostRespondResult = {
  request: DoubleCultivationRequestRow;
  settled: boolean;
  log?: {
    id: number;
    requestId: number | null;
    initiatorPlayerId: string;
    targetPlayerId: string | null;
    targetKind: string;
    targetNameSnapshot: string;
    initiatorFluidMl: number;
    targetFluidMl: number;
    initiatorIntimacyScore: number;
    targetIntimacyScore: number;
    percent: number;
    targetPercent: number;
    initiatorXpGain: number;
    targetXpGain: number;
    dateKey: string;
    createdAt: string;
  } | null;
  pregnancyStatus: {
    stageKey?: string | null;
    statusKey?: string | null;
  } | null;
  fertilizationDisplayStatus: {
    stageKey?: string | null;
    statusKey?: string | null;
  } | null;
  statusEffectsApplied: string[];
};

export type HostUterusExpelResult = {
  expelledMl: number;
  uterusStorageMl: number;
  uterusCapacityMl: number;
  reward: GrantedReward;
};

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

function normalizeGender(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "男" || normalized === "male" || normalized === "man") {
    return "male" as const;
  }
  if (normalized === "女" || normalized === "female" || normalized === "woman") {
    return "female" as const;
  }
  return null;
}

function isOppositeGender(left: unknown, right: unknown) {
  const leftGender = normalizeGender(left);
  const rightGender = normalizeGender(right);
  return Boolean(leftGender && rightGender && leftGender !== rightGender);
}

function normalizePairPlayerIds(left: string, right: string) {
  return left.localeCompare(right) <= 0
    ? { playerAId: left, playerBId: right }
    : { playerAId: right, playerBId: left };
}

function parseTargetInput(value: unknown) {
  return String(value || "").trim();
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

function getPercentByUsedCount(usedCount: number) {
  const index = Math.max(0, Math.floor(Number(usedCount) || 0));
  return DOUBLE_CULTIVATION_PERCENT_STEPS[index] || 0;
}

function calcBaseGain(sourceXp: unknown, percent: number) {
  const safeXp = toNonNegativeBigInt(sourceXp);
  if (safeXp <= 0n || percent <= 0) {
    return 0n;
  }
  return (safeXp * BigInt(Math.max(0, Math.round(percent * 1000)))) / 100000n;
}

async function findTargetPlayer(targetInput: string) {
  const trimmed = parseTargetInput(targetInput);
  if (!trimmed) {
    return null;
  }

  const byId = await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realmName: players.realmName,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    cultivationXp: players.cultivationXp,
  }).from(players).where(eq(players.id, trimmed)).get();
  if (byId) {
    return byId;
  }

  return await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realmName: players.realmName,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    cultivationXp: players.cultivationXp,
  }).from(players).where(eq(players.name, trimmed)).get();
}

async function loadCurrentRequestByPair(playerAId: string, playerBId: string) {
  return pickFirstRow<DoubleCultivationRequestRow>(await db.execute(drizzleSql`
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
    WHERE "player_a_id" = ${playerAId}
      AND "player_b_id" = ${playerBId}
    LIMIT 1
  `));
}

async function updateRequestStatus(params: {
  requestId: number;
  status: "accepted" | "rejected";
}) {
  const nowIso = new Date().toISOString();
  const result = await db.execute(drizzleSql`
    UPDATE "player_double_cultivation_requests"
    SET
      "status" = ${params.status},
      "updated_at" = ${nowIso},
      "responded_at" = ${nowIso}
    WHERE "id" = ${params.requestId}
      AND "status" = 'pending'
    RETURNING
      "id",
      "player_a_id",
      "player_b_id",
      "requested_by",
      "status",
      "created_at",
      "updated_at",
      "responded_at"
  `);
  return pickFirstRow<DoubleCultivationRequestRow>(result);
}

function buildPlayerNarrative(params: {
  initiatorName: string;
  targetName: string;
}) {
  return `${params.initiatorName}与${params.targetName}在洞府中完成了一次双修，彼此气机交融，余韵尚未散去。`;
}

async function ensureExpelledSemenItem(input: {
  nowIso: string;
  tx?: Pick<typeof db, "select" | "insert">;
}) {
  const executor = input.tx || db;
  const existing = await executor.select({
    id: items.id,
  }).from(items).where(eq(items.id, EXPEL_SEMEN_ITEM_ID)).get();
  if (existing) {
    return;
  }

  await executor.insert(items).values({
    id: EXPEL_SEMEN_ITEM_ID,
    name: EXPEL_SEMEN_ITEM_NAME,
    iconUrl: null,
    description: "女修在洞府中主动排出的留存精液，可作为特殊材料留存。",
    itemType: "material",
    rarity: "common",
    effects: [],
    pillToxicity: 0,
    price: 0,
    stackable: true,
    isBound: false,
    minRealm: null,
    maxRealm: null,
    createdAt: input.nowIso,
  }).run();
}

function rollExpelledMl() {
  return EXPEL_MIN_ML + Math.floor(Math.random() * (EXPEL_MAX_ML - EXPEL_MIN_ML + 1));
}

export async function requestDoubleCultivationHostCommand(params: {
  requesterId: string;
  targetInput: string;
}) {
  await ensureDoubleCultivationHostLedger();

  const requester = await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
  }).from(players).where(eq(players.id, params.requesterId)).get();

  if (!requester) {
    throw new Error("发起者不存在");
  }

  const target = await findTargetPlayer(params.targetInput);
  if (!target) {
    throw new Error("目标玩家不存在");
  }
  if (target.id === requester.id) {
    throw new Error("不能和自己双修");
  }
  if (!isOppositeGender(requester.gender, target.gender)) {
    throw new Error("双修只支持男女异性");
  }

  const pair = normalizePairPlayerIds(requester.id, target.id);
  const existing = await loadCurrentRequestByPair(pair.playerAId, pair.playerBId);
  if (existing?.status === "pending") {
    if (existing.requested_by === requester.id) {
      return {
        request: existing,
        requester,
        target,
      };
    }
    throw new Error("对方已向你发起双修申请，请先处理");
  }

  const nowIso = new Date().toISOString();
  let request: DoubleCultivationRequestRow | null = null;
  if (existing?.id) {
    request = pickFirstRow<DoubleCultivationRequestRow>(await db.execute(drizzleSql`
      UPDATE "player_double_cultivation_requests"
      SET
        "requested_by" = ${requester.id},
        "status" = 'pending',
        "updated_at" = ${nowIso},
        "responded_at" = NULL
      WHERE "id" = ${existing.id}
      RETURNING
        "id",
        "player_a_id",
        "player_b_id",
        "requested_by",
        "status",
        "created_at",
        "updated_at",
        "responded_at"
    `));
  } else {
    request = pickFirstRow<DoubleCultivationRequestRow>(await db.execute(drizzleSql`
      INSERT INTO "player_double_cultivation_requests" (
        "player_a_id",
        "player_b_id",
        "requested_by",
        "status",
        "created_at",
        "updated_at",
        "responded_at"
      ) VALUES (
        ${pair.playerAId},
        ${pair.playerBId},
        ${requester.id},
        'pending',
        ${nowIso},
        ${nowIso},
        NULL
      )
      RETURNING
        "id",
        "player_a_id",
        "player_b_id",
        "requested_by",
        "status",
        "created_at",
        "updated_at",
        "responded_at"
    `));
  }

  if (!request) {
    throw new Error("创建双修申请失败");
  }

  return {
    request,
    requester,
    target,
  };
}

export async function respondDoubleCultivationHostCommand(params: {
  playerId: string;
  requestId: number;
  action: "accept" | "reject";
}): Promise<HostRespondResult> {
  await ensureDoubleCultivationHostLedger();

  const request = pickFirstRow<DoubleCultivationRequestRow>(await db.execute(drizzleSql`
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
    WHERE "id" = ${params.requestId}
      AND (
        "player_a_id" = ${params.playerId}
        OR "player_b_id" = ${params.playerId}
      )
    LIMIT 1
  `));

  if (!request) {
    throw new Error("双修申请不存在");
  }
  if (request.status !== "pending") {
    throw new Error("该申请已处理");
  }
  if (request.requested_by === params.playerId) {
    throw new Error("不能处理自己发起的申请");
  }

  if (params.action === "reject") {
    const rejected = await updateRequestStatus({
      requestId: request.id,
      status: "rejected",
    });
    if (!rejected) {
      throw new Error("该申请已处理");
    }
    return {
      request: rejected,
      settled: false,
      log: null,
      pregnancyStatus: null,
      fertilizationDisplayStatus: null,
      statusEffectsApplied: [],
    };
  }

  const [playerA, playerB] = await Promise.all([
    db.select({
      id: players.id,
      name: players.name,
      gender: players.gender,
      realmName: players.realmName,
      realmMajor: players.realmMajor,
      realmMinor: players.realmMinor,
      cultivationXp: players.cultivationXp,
    }).from(players).where(eq(players.id, request.player_a_id)).get(),
    db.select({
      id: players.id,
      name: players.name,
      gender: players.gender,
      realmName: players.realmName,
      realmMajor: players.realmMajor,
      realmMinor: players.realmMinor,
      cultivationXp: players.cultivationXp,
    }).from(players).where(eq(players.id, request.player_b_id)).get(),
  ]);

  if (!playerA || !playerB) {
    throw new Error("玩家不存在");
  }
  if (!isOppositeGender(playerA.gender, playerB.gender)) {
    throw new Error("双修只支持男女异性");
  }

  const playerAGender = normalizeGender(playerA.gender);
  const malePlayer = playerAGender === "male" ? playerA : playerB;
  const femalePlayer = playerAGender === "female" ? playerA : playerB;

  const dateKey = getShanghaiDateKey();
  const nowIso = new Date().toISOString();
  const initiator = request.requested_by === playerA.id ? playerA : playerB;
  const target = initiator.id === playerA.id ? playerB : playerA;

  const [dailyA, dailyB, intimacyA, intimacyB, rejectedRequest] = await Promise.all([
    pickFirstRow<{ used_count?: number | null; positive_gain_total?: string | null }>(await db.execute(drizzleSql`
      SELECT "used_count", "positive_gain_total"::text AS "positive_gain_total"
      FROM "player_double_cultivation_daily"
      WHERE "player_id" = ${playerA.id}
        AND "date_key" = ${dateKey}
      LIMIT 1
    `)),
    pickFirstRow<{ used_count?: number | null; positive_gain_total?: string | null }>(await db.execute(drizzleSql`
      SELECT "used_count", "positive_gain_total"::text AS "positive_gain_total"
      FROM "player_double_cultivation_daily"
      WHERE "player_id" = ${playerB.id}
        AND "date_key" = ${dateKey}
      LIMIT 1
    `)),
    pickFirstRow<{ intimacy_score?: number | null }>(await db.execute(drizzleSql`
      SELECT "intimacy_score"
      FROM "player_double_cultivation_player_stats"
      WHERE "player_id" = ${playerA.id}
      LIMIT 1
    `)),
    pickFirstRow<{ intimacy_score?: number | null }>(await db.execute(drizzleSql`
      SELECT "intimacy_score"
      FROM "player_double_cultivation_player_stats"
      WHERE "player_id" = ${playerB.id}
      LIMIT 1
    `)),
    updateRequestStatus({
      requestId: request.id,
      status: "accepted",
    }),
  ]);

  if (!rejectedRequest) {
    throw new Error("该申请已处理");
  }

  const percentA = getPercentByUsedCount(Math.max(0, Math.floor(Number(dailyA?.used_count || 0))));
  const percentB = getPercentByUsedCount(Math.max(0, Math.floor(Number(dailyB?.used_count || 0))));

  const requiredXpA = await getBreakthroughXpByPosition(playerA.realmMajor || 1, playerA.realmMinor || 1);
  const requiredXpB = await getBreakthroughXpByPosition(playerB.realmMajor || 1, playerB.realmMinor || 1);
  const gainCapA = calcBaseGain(requiredXpA, DOUBLE_CULTIVATION_DAILY_GAIN_CAP_PERCENT);
  const gainCapB = calcBaseGain(requiredXpB, DOUBLE_CULTIVATION_DAILY_GAIN_CAP_PERCENT);
  const remainingA = gainCapA > toNonNegativeBigInt(dailyA?.positive_gain_total)
    ? (gainCapA - toNonNegativeBigInt(dailyA?.positive_gain_total))
    : 0n;
  const remainingB = gainCapB > toNonNegativeBigInt(dailyB?.positive_gain_total)
    ? (gainCapB - toNonNegativeBigInt(dailyB?.positive_gain_total))
    : 0n;
  const gainA = calcBaseGain(playerA.cultivationXp, percentA) > remainingA
    ? remainingA
    : calcBaseGain(playerA.cultivationXp, percentA);
  const gainB = calcBaseGain(playerB.cultivationXp, percentB) > remainingB
    ? remainingB
    : calcBaseGain(playerB.cultivationXp, percentB);

  const intimacyScoreA = Math.max(0, Math.floor(Number(intimacyA?.intimacy_score || 0)));
  const intimacyScoreB = Math.max(0, Math.floor(Number(intimacyB?.intimacy_score || 0)));

  let femaleStorageMl = 0;
  let femaleCapacityMl = DEFAULT_UTERUS_CAPACITY_ML;
  let femaleAbsorbedMl = 0;

  const spermRow = malePlayer
    ? pickFirstRow<{ storage_ml?: number | null }>(await db.execute(drizzleSql`
      SELECT "storage_ml"
      FROM "player_double_cultivation_sperm"
      WHERE "player_id" = ${malePlayer.id}
      LIMIT 1
    `))
    : null;

  const uterusRow = femalePlayer
    ? pickFirstRow<{ storage_ml?: number | null; capacity_ml?: number | null }>(await db.execute(drizzleSql`
      SELECT "storage_ml", "capacity_ml"
      FROM "player_double_cultivation_uterus"
      WHERE "player_id" = ${femalePlayer.id}
      LIMIT 1
    `))
    : null;

  const currentSpermStorage = Math.max(0, Math.floor(Number(spermRow?.storage_ml ?? DEFAULT_SPERM_STORAGE_ML)));
  const maleFluidMl = Math.min(DEFAULT_PLAYER_PLAYER_FLUID_ML, currentSpermStorage);
  const nextSpermStorage = Math.max(0, currentSpermStorage - maleFluidMl);

  if (femalePlayer) {
    const currentUterusStorage = Math.max(0, Math.floor(Number(uterusRow?.storage_ml || 0)));
    femaleCapacityMl = Math.max(1, Math.floor(Number(uterusRow?.capacity_ml || DEFAULT_UTERUS_CAPACITY_ML)));
    femaleAbsorbedMl = Math.min(maleFluidMl, Math.max(0, femaleCapacityMl - currentUterusStorage));
    femaleStorageMl = Math.min(femaleCapacityMl, currentUterusStorage + femaleAbsorbedMl);
  }

  await db.transaction(async (tx) => {
    for (const player of [
      { row: playerA, gain: gainA, intimacyDelta: DEFAULT_PLAYER_PLAYER_INTIMACY_DELTA, dateRow: dailyA },
      { row: playerB, gain: gainB, intimacyDelta: DEFAULT_PLAYER_PLAYER_INTIMACY_DELTA, dateRow: dailyB },
    ]) {
      const existingDaily = pickFirstRow<{ id?: number | null }>(await tx.execute(drizzleSql`
        SELECT "id"
        FROM "player_double_cultivation_daily"
        WHERE "player_id" = ${player.row.id}
          AND "date_key" = ${dateKey}
        LIMIT 1
      `));
      if (existingDaily?.id) {
        await tx.execute(drizzleSql`
          UPDATE "player_double_cultivation_daily"
          SET
            "used_count" = GREATEST(0, COALESCE("used_count", 0)) + 1,
            "positive_gain_total" = COALESCE("positive_gain_total", 0) + (${player.gain.toString()})::bigint,
            "updated_at" = ${nowIso}
          WHERE "id" = ${existingDaily.id}
        `);
      } else {
        await tx.execute(drizzleSql`
          INSERT INTO "player_double_cultivation_daily" (
            "player_id",
            "date_key",
            "used_count",
            "positive_gain_total",
            "created_at",
            "updated_at"
          ) VALUES (
            ${player.row.id},
            ${dateKey},
            1,
            (${player.gain.toString()})::bigint,
            ${nowIso},
            ${nowIso}
          )
        `);
      }

      if (player.gain > 0n) {
        await tx.execute(drizzleSql`
          UPDATE "players"
          SET
            "cultivation_xp" = COALESCE("cultivation_xp", 0) + (${player.gain.toString()})::bigint,
            "updated_at" = ${nowIso}
          WHERE "id" = ${player.row.id}
        `);
      }

      await tx.execute(drizzleSql`
        INSERT INTO "player_double_cultivation_player_stats" (
          "player_id",
          "intimacy_score",
          "note",
          "updated_at"
        ) VALUES (
          ${player.row.id},
          ${player.intimacyDelta},
          '玩家双修累计',
          ${nowIso}
        )
        ON CONFLICT ("player_id")
        DO UPDATE SET
          "intimacy_score" = GREATEST(0, COALESCE("player_double_cultivation_player_stats"."intimacy_score", 0) + ${player.intimacyDelta}),
          "note" = '玩家双修累计',
          "updated_at" = ${nowIso}
      `);
    }

    if (malePlayer) {
      await tx.execute(drizzleSql`
        INSERT INTO "player_double_cultivation_sperm" (
          "player_id",
          "storage_ml",
          "updated_at"
        ) VALUES (
          ${malePlayer.id},
          ${nextSpermStorage},
          ${nowIso}
        )
        ON CONFLICT ("player_id")
        DO UPDATE SET
          "storage_ml" = ${nextSpermStorage},
          "updated_at" = ${nowIso}
      `);
    }

    if (femalePlayer) {
      await tx.execute(drizzleSql`
        INSERT INTO "player_double_cultivation_uterus" (
          "player_id",
          "storage_ml",
          "capacity_ml",
          "updated_at",
          "last_digest_at"
        ) VALUES (
          ${femalePlayer.id},
          ${femaleStorageMl},
          ${femaleCapacityMl},
          ${nowIso},
          NULL
        )
        ON CONFLICT ("player_id")
        DO UPDATE SET
          "storage_ml" = ${femaleStorageMl},
          "capacity_ml" = ${femaleCapacityMl},
          "updated_at" = ${nowIso},
          "last_digest_at" = NULL
      `);
    }

    await tx.execute(drizzleSql`
      INSERT INTO "player_double_cultivation_logs" (
        "request_id",
        "initiator_player_id",
        "target_player_id",
        "source_ref",
        "source_target_id",
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
        "initiator_xp_gain",
        "target_xp_gain",
        "narrative",
        "prompt_snapshot",
        "date_key",
        "created_at"
      ) VALUES (
        ${request.id},
        ${initiator.id},
        ${target.id},
        NULL,
        NULL,
        'player',
        NULL,
        ${target.name || "无名修士"},
        ${initiator.id === malePlayer?.id ? maleFluidMl : 0},
        ${target.id === malePlayer?.id ? maleFluidMl : 0},
        ${DEFAULT_PLAYER_PLAYER_INTIMACY_DELTA},
        ${DEFAULT_PLAYER_PLAYER_INTIMACY_DELTA},
        ${intimacyScoreA},
        ${intimacyScoreB},
        ${initiator.id === playerA.id ? percentA : percentB},
        ${target.id === playerA.id ? percentA : percentB},
        (${(initiator.id === playerA.id ? gainA : gainB).toString()})::bigint,
        (${(target.id === playerA.id ? gainA : gainB).toString()})::bigint,
        ${buildPlayerNarrative({
          initiatorName: initiator.name || "无名修士",
          targetName: target.name || "无名修士",
        })},
        ${`双修发起者：${initiator.name || "无名修士"}\n双修对象：${target.name || "无名修士"}`},
        ${dateKey},
        ${nowIso}
      )
    `);
  });

  const log = pickFirstRow<{
    id: number;
    request_id?: number | null;
    initiator_player_id: string;
    target_player_id?: string | null;
    target_kind?: string | null;
    target_name_snapshot?: string | null;
    initiator_fluid_ml?: number | null;
    target_fluid_ml?: number | null;
    initiator_intimacy_score?: number | null;
    target_intimacy_score?: number | null;
    percent?: number | null;
    target_percent?: number | null;
    initiator_xp_gain?: string | null;
    target_xp_gain?: string | null;
    date_key?: string | null;
    created_at?: string | null;
  }>(await db.execute(drizzleSql`
    SELECT
      "id",
      "request_id",
      "initiator_player_id",
      "target_player_id",
      "target_kind",
      "target_name_snapshot",
      "initiator_fluid_ml",
      "target_fluid_ml",
      "initiator_intimacy_score",
      "target_intimacy_score",
      "percent",
      "target_percent",
      "initiator_xp_gain"::text AS "initiator_xp_gain",
      "target_xp_gain"::text AS "target_xp_gain",
      "date_key",
      "created_at"
    FROM "player_double_cultivation_logs"
    WHERE "request_id" = ${request.id}
    ORDER BY "id" DESC
    LIMIT 1
  `));

  if (!log) {
    throw new Error("双修日志写入失败");
  }

  let pregnancyStatus: HostRespondResult["pregnancyStatus"] = null;
  let fertilizationDisplayStatus: HostRespondResult["fertilizationDisplayStatus"] = null;
  if (femalePlayer && malePlayer) {
    const pregnancyResult = await syncPregnancyStatusFromUterusState({
      femalePlayerId: femalePlayer.id,
      uterusStorageMl: femaleStorageMl,
      uterusCapacityMl: femaleCapacityMl,
      absorbedMl: femaleAbsorbedMl,
      sourceRef: String(log.id),
      sourceType: "double_cultivation",
      sourcePluginId: "double-cultivation",
      sourceTargetKind: "player",
      sourceTargetId: malePlayer.id,
    });
    pregnancyStatus = pregnancyResult.pregnancyStatus
      ? {
        stageKey: pregnancyResult.pregnancyStatus.stageKey || null,
        statusKey: pregnancyResult.pregnancyStatus.statusKey || null,
      }
      : null;
    fertilizationDisplayStatus = pregnancyResult.fertilizationDisplayStatus
      ? {
        stageKey: pregnancyResult.fertilizationDisplayStatus.stageKey || null,
        statusKey: pregnancyResult.fertilizationDisplayStatus.statusKey || null,
      }
      : null;
  }

  return {
    request: rejectedRequest,
    settled: true,
    log: {
      id: log.id,
      requestId: log.request_id ?? null,
      initiatorPlayerId: log.initiator_player_id,
      targetPlayerId: log.target_player_id ?? null,
      targetKind: log.target_kind || "player",
      targetNameSnapshot: log.target_name_snapshot || "无名修士",
      initiatorFluidMl: Math.max(0, Math.floor(Number(log.initiator_fluid_ml || 0))),
      targetFluidMl: Math.max(0, Math.floor(Number(log.target_fluid_ml || 0))),
      initiatorIntimacyScore: Math.max(0, Math.floor(Number(log.initiator_intimacy_score || 0))),
      targetIntimacyScore: Math.max(0, Math.floor(Number(log.target_intimacy_score || 0))),
      percent: Number(log.percent || 0),
      targetPercent: Number(log.target_percent || 0),
      initiatorXpGain: toSafeOutputNumber(toNonNegativeBigInt(log.initiator_xp_gain)),
      targetXpGain: toSafeOutputNumber(toNonNegativeBigInt(log.target_xp_gain)),
      dateKey: String(log.date_key || "").trim(),
      createdAt: String(log.created_at || "").trim() || nowIso,
    },
    pregnancyStatus,
    fertilizationDisplayStatus,
    statusEffectsApplied: [],
  };
}

export async function executeUterusExpelHostCommand(params: {
  playerId: string;
}): Promise<HostUterusExpelResult> {
  await ensureDoubleCultivationHostLedger();

  const player = await db.select({
    id: players.id,
    gender: players.gender,
  }).from(players).where(eq(players.id, params.playerId)).get();

  if (!player) {
    throw new Error("玩家不存在");
  }
  if (normalizeGender(player.gender) !== "female") {
    throw new Error("只有女修可以排精");
  }

  const uterusRow = pickFirstRow<{ storage_ml?: number | null; capacity_ml?: number | null }>(await db.execute(drizzleSql`
    SELECT "storage_ml", "capacity_ml"
    FROM "player_double_cultivation_uterus"
    WHERE "player_id" = ${params.playerId}
    LIMIT 1
  `));
  const currentStorage = Math.max(0, Math.floor(Number(uterusRow?.storage_ml || 0)));
  const currentCapacity = Math.max(1, Math.floor(Number(uterusRow?.capacity_ml || DEFAULT_UTERUS_CAPACITY_ML)));
  if (currentStorage <= 0) {
    throw new Error("当前子宫内没有可排出的精液");
  }

  const expelledMl = Math.min(currentStorage, rollExpelledMl());
  const nextStorage = Math.max(0, currentStorage - expelledMl);
  const nowIso = new Date().toISOString();

  const reward = await db.transaction(async (tx) => {
    await tx.execute(drizzleSql`
      UPDATE "player_double_cultivation_uterus"
      SET
        "storage_ml" = ${nextStorage},
        "capacity_ml" = ${currentCapacity},
        "updated_at" = ${nowIso},
        "last_digest_at" = NULL
      WHERE "player_id" = ${params.playerId}
    `);

    await ensureExpelledSemenItem({ nowIso, tx });
    return await grantRewardToPlayer({
      playerId: params.playerId,
      reward: {
        items: [{
          itemId: EXPEL_SEMEN_ITEM_ID,
          quantity: Math.max(1, expelledMl),
        }],
      },
      tx,
    });
  });

  await syncPregnancyStatusFromUterusState({
    femalePlayerId: params.playerId,
    uterusStorageMl: nextStorage,
    uterusCapacityMl: currentCapacity,
    absorbedMl: 0,
    sourceType: "double_cultivation_expel",
    sourcePluginId: "double-cultivation",
  });

  return {
    expelledMl,
    uterusStorageMl: nextStorage,
    uterusCapacityMl: currentCapacity,
    reward,
  };
}
