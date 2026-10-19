import { eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { syncPregnancyStatusFromUterusState } from "@/modules/character/services/player-status";

export type WorldNpcDoubleCultivationLinkageResult = {
  settled: boolean;
  settledVia?: "host_ledger" | null;
  log?: {
    id?: number | null;
    sourceRef?: string | null;
    sourceTargetId?: string | null;
    targetKind?: string | null;
    targetMonsterId?: string | null;
    targetNameSnapshot?: string | null;
    initiatorFluidMl?: number | null;
    targetFluidMl?: number | null;
  } | null;
  player?: {
    gain?: number | null;
  } | null;
  intimacy?: {
    scoreDelta?: number | null;
    currentLevel?: number | null;
  } | null;
  pregnancyStatus?: {
    stageKey?: string | null;
    statusKey?: string | null;
  } | null;
  fertilizationDisplayStatus?: {
    stageKey?: string | null;
    statusKey?: string | null;
  } | null;
  statusEffectsApplied?: string[] | null;
  sourceRef?: string | null;
  sourceTargetId?: string | null;
};

type DoubleCultivationLogRow = {
  id: number;
  source_ref?: string | null;
  source_target_id?: string | null;
  target_kind?: string | null;
  target_monster_id?: string | null;
  target_name_snapshot?: string | null;
  initiator_fluid_ml?: number | null;
  target_fluid_ml?: number | null;
  initiator_intimacy_score?: number | null;
  initiator_xp_gain?: number | string | null;
};

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DOUBLE_CULTIVATION_PERCENT_STEPS = [3, 2.5, 2, 1.5, 1];
const DOUBLE_CULTIVATION_DAILY_GAIN_CAP_PERCENT = 10;
const WORLD_NPC_DOUBLE_CULTIVATION_GAIN_SCALE = 0.4;
const DEFAULT_INTIMACY_THRESHOLDS = [50, 150, 300, 500];
const DEFAULT_SPERM_STORAGE_ML = 50;
const DEFAULT_UTERUS_CAPACITY_ML = 120;

let ensureDoubleCultivationHostLedgerPromise: Promise<void> | null = null;

function isUniqueViolationError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = String((error as { code?: unknown }).code || "").trim();
  if (code === "23505") {
    return true;
  }
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return message.includes("duplicate key") || message.includes("unique constraint");
}

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
    timeZone: SHANGHAI_TIME_ZONE,
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

function calcWorldNpcDoubleCultivationBaseGain(sourceXp: unknown, percent: number) {
  if (!(percent > 0)) {
    return 0n;
  }
  const raw = calcBaseGain(sourceXp, percent * WORLD_NPC_DOUBLE_CULTIVATION_GAIN_SCALE);
  return raw > 0n ? raw : 1n;
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

function resolveFluidMl(params: {
  playerGender: "male" | "female";
  actionType?: string | null;
}) {
  const actionType = String(params.actionType || "").trim();
  if (params.playerGender === "male") {
    if (actionType === "dangerous_preference") {
      return 12;
    }
    if (actionType === "essence_drain") {
      return 10;
    }
    return 9;
  }
  if (actionType === "dangerous_preference") {
    return 16;
  }
  if (actionType === "essence_drain") {
    return 12;
  }
  return 9;
}

function resolveIntimacyScoreDelta(actionType?: string | null) {
  const normalized = String(actionType || "").trim();
  if (normalized === "dangerous_preference") {
    return 4;
  }
  if (normalized === "essence_drain") {
    return 3;
  }
  return 2;
}

function buildHostNarrative(params: {
  playerName: string;
  npcName: string;
  actionType?: string | null;
}) {
  const actionType = String(params.actionType || "").trim();
  if (actionType === "dangerous_preference") {
    return `${params.playerName}与${params.npcName}在危险暧昧的拉扯中完成了一次更深的双修试炼，余韵久久不散。`;
  }
  if (actionType === "essence_drain") {
    return `${params.playerName}与${params.npcName}在灵机纠缠中完成了一次偏向采补意味的双修，体内气息久久翻腾。`;
  }
  return `${params.playerName}与${params.npcName}在开放世界中完成了一次双修，彼此气机短暂交融并留下了清晰余韵。`;
}

function buildPromptSnapshot(params: {
  playerName: string;
  npcName: string;
  playerRealmName: string;
  npcRealmName: string;
  actionType?: string | null;
}) {
  return [
    "开放世界 NPC 双修核心账本。",
    `发起者：${params.playerName}（${params.playerRealmName}）`,
    `对象：${params.npcName}（${params.npcRealmName}）`,
    `动作：${String(params.actionType || "dual_cultivation").trim() || "dual_cultivation"}`,
  ].join("\n");
}

export async function ensureDoubleCultivationHostLedger() {
  if (!ensureDoubleCultivationHostLedgerPromise) {
    ensureDoubleCultivationHostLedgerPromise = (async () => {
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_requests" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_a_id" text NOT NULL REFERENCES "players"("id"),
          "player_b_id" text NOT NULL REFERENCES "players"("id"),
          "requested_by" text NOT NULL REFERENCES "players"("id"),
          "status" text NOT NULL DEFAULT 'pending',
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          "responded_at" text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_daily" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id"),
          "date_key" text NOT NULL,
          "used_count" integer NOT NULL DEFAULT 0,
          "positive_gain_total" bigint NOT NULL DEFAULT 0,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_logs" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "request_id" integer,
          "initiator_player_id" text NOT NULL REFERENCES "players"("id"),
          "target_player_id" text,
          "source_ref" text,
          "source_target_id" text,
          "target_kind" text NOT NULL DEFAULT 'player',
          "target_monster_id" text,
          "target_name_snapshot" text NOT NULL DEFAULT '',
          "initiator_fluid_ml" integer NOT NULL DEFAULT 0,
          "target_fluid_ml" integer NOT NULL DEFAULT 0,
          "initiator_intimacy_score" integer NOT NULL DEFAULT 0,
          "target_intimacy_score" integer NOT NULL DEFAULT 0,
          "initiator_intimacy_level" integer NOT NULL DEFAULT 0,
          "target_intimacy_level" integer NOT NULL DEFAULT 0,
          "percent" real NOT NULL DEFAULT 0,
          "target_percent" real NOT NULL DEFAULT 0,
          "initiator_xp_gain" bigint NOT NULL DEFAULT 0,
          "target_xp_gain" bigint NOT NULL DEFAULT 0,
          "narrative" text NOT NULL DEFAULT '',
          "prompt_snapshot" text NOT NULL DEFAULT '',
          "date_key" text NOT NULL DEFAULT '',
          "created_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_sperm" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id"),
          "storage_ml" integer NOT NULL DEFAULT 50,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_uterus" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id"),
          "storage_ml" integer NOT NULL DEFAULT 0,
          "capacity_ml" integer NOT NULL DEFAULT 120,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          "last_digest_at" text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_double_cultivation_player_stats" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id"),
          "intimacy_score" integer NOT NULL DEFAULT 0,
          "note" text NOT NULL DEFAULT '',
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        ALTER TABLE IF EXISTS "player_double_cultivation_logs"
        ADD COLUMN IF NOT EXISTS "source_ref" text
      `));
      await db.execute(drizzleSql.raw(`
        ALTER TABLE IF EXISTS "player_double_cultivation_logs"
        ADD COLUMN IF NOT EXISTS "source_target_id" text
      `));
      await db.execute(drizzleSql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS "player_double_cultivation_requests_pair_unique"
        ON "player_double_cultivation_requests" ("player_a_id", "player_b_id")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_requests_status_idx"
        ON "player_double_cultivation_requests" ("status", "updated_at")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_requests_player_a_idx"
        ON "player_double_cultivation_requests" ("player_a_id")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_requests_player_b_idx"
        ON "player_double_cultivation_requests" ("player_b_id")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_requests_requested_by_idx"
        ON "player_double_cultivation_requests" ("requested_by")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_logs_source_ref_idx"
        ON "player_double_cultivation_logs" ("source_ref")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS "player_double_cultivation_logs_initiator_source_ref_unique"
        ON "player_double_cultivation_logs" ("initiator_player_id", "source_ref")
        WHERE "source_ref" IS NOT NULL
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_logs_initiator_idx"
        ON "player_double_cultivation_logs" ("initiator_player_id")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "player_double_cultivation_daily_player_date_idx"
        ON "player_double_cultivation_daily" ("player_id", "date_key")
      `));
    })().catch((error) => {
      ensureDoubleCultivationHostLedgerPromise = null;
      throw error;
    });
  }
  await ensureDoubleCultivationHostLedgerPromise;
}

async function loadExistingWorldNpcLog(params: {
  playerId: string;
  sourceRef?: string | null;
}) {
  if (!params.sourceRef) {
    return null;
  }
  await ensureDoubleCultivationHostLedger();
  const rows = await db.execute<DoubleCultivationLogRow>(drizzleSql`
    SELECT
      "id",
      "source_ref",
      "source_target_id",
      "target_kind",
      "target_monster_id",
      "target_name_snapshot",
      "initiator_fluid_ml",
      "target_fluid_ml",
      "initiator_intimacy_score",
      "initiator_xp_gain"
    FROM "player_double_cultivation_logs"
    WHERE "initiator_player_id" = ${params.playerId}
      AND "source_ref" = ${params.sourceRef}
    ORDER BY "id" DESC
    LIMIT 1
  `);
  return pickFirstRow<DoubleCultivationLogRow>(rows);
}

async function loadCurrentIntimacyScore(playerId: string) {
  const rows = await db.execute<{ intimacy_score?: number | null }>(drizzleSql`
    SELECT "intimacy_score"
    FROM "player_double_cultivation_player_stats"
    WHERE "player_id" = ${playerId}
    LIMIT 1
  `);
  const first = pickFirstRow<{ intimacy_score?: number | null }>(rows);
  return Math.max(0, Math.floor(Number(first?.intimacy_score || 0)));
}

function buildExistingResult(params: {
  log: DoubleCultivationLogRow;
  intimacyScore: number;
}): WorldNpcDoubleCultivationLinkageResult {
  return {
    settled: true,
    settledVia: "host_ledger",
    log: {
      id: params.log.id,
      sourceRef: params.log.source_ref ?? null,
      sourceTargetId: params.log.source_target_id ?? null,
      targetKind: params.log.target_kind ?? "world_npc",
      targetMonsterId: params.log.target_monster_id ?? null,
      targetNameSnapshot: params.log.target_name_snapshot ?? null,
      initiatorFluidMl: params.log.initiator_fluid_ml ?? 0,
      targetFluidMl: params.log.target_fluid_ml ?? 0,
    },
    player: {
      gain: Number(params.log.initiator_xp_gain || 0),
    },
    intimacy: {
      scoreDelta: params.log.initiator_intimacy_score ?? 0,
      currentLevel: resolveIntimacyLevel(params.intimacyScore),
    },
    sourceRef: params.log.source_ref ?? null,
    sourceTargetId: params.log.source_target_id ?? null,
    statusEffectsApplied: [],
  } satisfies WorldNpcDoubleCultivationLinkageResult;
}

async function loadWorldNpcLedgerPlayer(playerId: string) {
  return await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realmName: players.realmName,
    cultivationXp: players.cultivationXp,
  }).from(players).where(eq(players.id, playerId)).get();
}

export async function settleWorldNpcDoubleCultivationHostLedger(params: {
  playerId: string;
  targetNpcId: string;
  targetNpcName: string;
  targetNpcGender: string;
  targetNpcRealmName?: string | null;
  actionType?: string | null;
  sourceRef?: string | null;
  sourceTargetId?: string | null;
}): Promise<WorldNpcDoubleCultivationLinkageResult> {
  await ensureDoubleCultivationHostLedger();

  const player = await loadWorldNpcLedgerPlayer(params.playerId);
  if (!player) {
    throw new Error("发起者不存在");
  }

  const playerGender = normalizeGender(player.gender);
  const targetGender = normalizeGender(params.targetNpcGender);
  if (!playerGender || !targetGender || playerGender === targetGender) {
    throw new Error("世界 NPC 双修只支持男女异性");
  }

  const existingLog = await loadExistingWorldNpcLog({
    playerId: params.playerId,
    sourceRef: params.sourceRef,
  });
  if (existingLog) {
    const intimacyScore = await loadCurrentIntimacyScore(params.playerId);
    return buildExistingResult({
      log: existingLog,
      intimacyScore,
    });
  }

  const nowIso = new Date().toISOString();
  const dateKey = getShanghaiDateKey();
  const sourceRef = String(params.sourceRef || "").trim() || null;
  const sourceTargetId = String(params.sourceTargetId || "").trim() || null;
  const targetNpcName = String(params.targetNpcName || "").trim() || "无名修士";
  const targetNpcRealmName = String(params.targetNpcRealmName || "").trim() || "尘世散修";
  const usedCountRows = await db.execute<{ used_count?: number | null; positive_gain_total?: string | number | null }>(drizzleSql`
    SELECT "used_count", "positive_gain_total"::text AS "positive_gain_total"
    FROM "player_double_cultivation_daily"
    WHERE "player_id" = ${params.playerId}
      AND "date_key" = ${dateKey}
    ORDER BY "id" DESC
    LIMIT 1
  `);
  const dailyRow = pickFirstRow<{ used_count?: number | null; positive_gain_total?: string | number | null }>(usedCountRows);
  const usedCountBefore = Math.max(0, Math.floor(Number(dailyRow?.used_count || 0)));
  const percent = getPercentByUsedCount(usedCountBefore);
  const currentXp = toNonNegativeBigInt(player.cultivationXp);
  const dailyCap = calcBaseGain(currentXp, DOUBLE_CULTIVATION_DAILY_GAIN_CAP_PERCENT);
  const gainedToday = toNonNegativeBigInt(dailyRow?.positive_gain_total);
  const remainingDailyCap = dailyCap > gainedToday ? (dailyCap - gainedToday) : 0n;
  let gain = calcWorldNpcDoubleCultivationBaseGain(currentXp, percent);
  if (gain > remainingDailyCap) {
    gain = remainingDailyCap;
  }
  if (gain < 0n) {
    gain = 0n;
  }

  const intimacyScoreDelta = resolveIntimacyScoreDelta(params.actionType);
  const previousIntimacyScore = await loadCurrentIntimacyScore(params.playerId);
  const nextIntimacyScore = previousIntimacyScore + intimacyScoreDelta;
  const initiatorIntimacyLevel = resolveIntimacyLevel(previousIntimacyScore);
  const narrative = buildHostNarrative({
    playerName: player.name || "无名修士",
    npcName: targetNpcName,
    actionType: params.actionType,
  });
  const promptSnapshot = buildPromptSnapshot({
    playerName: player.name || "无名修士",
    npcName: targetNpcName,
    playerRealmName: String(player.realmName || "凡人"),
    npcRealmName: targetNpcRealmName,
    actionType: params.actionType,
  });

  let initiatorFluidMl = 0;
  let targetFluidMl = 0;
  let pregnancyStatus: WorldNpcDoubleCultivationLinkageResult["pregnancyStatus"] = null;
  let fertilizationDisplayStatus: WorldNpcDoubleCultivationLinkageResult["fertilizationDisplayStatus"] = null;

  try {
    await db.transaction(async (tx) => {
      const existingDailyRows = await tx.execute<{ id?: number | null }>(drizzleSql`
        SELECT "id"
        FROM "player_double_cultivation_daily"
        WHERE "player_id" = ${params.playerId}
          AND "date_key" = ${dateKey}
        ORDER BY "id" DESC
        LIMIT 1
      `);
      const existingDaily = pickFirstRow<{ id?: number | null }>(existingDailyRows);
      if (existingDaily?.id) {
        await tx.execute(drizzleSql`
          UPDATE "player_double_cultivation_daily"
          SET
            "used_count" = GREATEST(0, COALESCE("used_count", 0)) + 1,
            "positive_gain_total" = COALESCE("positive_gain_total", 0) + (${gain.toString()})::bigint,
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
            ${params.playerId},
            ${dateKey},
            1,
            (${gain.toString()})::bigint,
            ${nowIso},
            ${nowIso}
          )
        `);
      }

      if (gain > 0n) {
        await tx.execute(drizzleSql`
          UPDATE "players"
          SET
            "cultivation_xp" = COALESCE("cultivation_xp", 0) + (${gain.toString()})::bigint,
            "updated_at" = ${nowIso}
          WHERE "id" = ${params.playerId}
        `);
      }

      const statsRows = await tx.execute<{ player_id?: string | null }>(drizzleSql`
        SELECT "player_id"
        FROM "player_double_cultivation_player_stats"
        WHERE "player_id" = ${params.playerId}
        LIMIT 1
      `);
      const existingStats = pickFirstRow<{ player_id?: string | null }>(statsRows);
      if (existingStats?.player_id) {
        await tx.execute(drizzleSql`
          UPDATE "player_double_cultivation_player_stats"
          SET
            "intimacy_score" = GREATEST(0, COALESCE("intimacy_score", 0) + ${intimacyScoreDelta}),
            "note" = '开放世界双修累计',
            "updated_at" = ${nowIso}
          WHERE "player_id" = ${params.playerId}
        `);
      } else {
        await tx.execute(drizzleSql`
          INSERT INTO "player_double_cultivation_player_stats" (
            "player_id",
            "intimacy_score",
            "note",
            "updated_at"
          ) VALUES (
            ${params.playerId},
            ${intimacyScoreDelta},
            '开放世界双修累计',
            ${nowIso}
          )
        `);
      }

      const fluidMl = resolveFluidMl({
        playerGender,
        actionType: params.actionType,
      });

      if (playerGender === "male") {
        const spermRows = await tx.execute<{ storage_ml?: number | null }>(drizzleSql`
          SELECT "storage_ml"
          FROM "player_double_cultivation_sperm"
          WHERE "player_id" = ${params.playerId}
          LIMIT 1
        `);
        const spermRow = pickFirstRow<{ storage_ml?: number | null }>(spermRows);
        const currentStorage = Math.max(0, Math.floor(Number(spermRow?.storage_ml ?? DEFAULT_SPERM_STORAGE_ML)));
        initiatorFluidMl = currentStorage >= fluidMl ? fluidMl : 0;
        const nextStorage = Math.max(0, currentStorage - initiatorFluidMl);
        if (spermRow) {
          await tx.execute(drizzleSql`
            UPDATE "player_double_cultivation_sperm"
            SET
              "storage_ml" = ${nextStorage},
              "updated_at" = ${nowIso}
            WHERE "player_id" = ${params.playerId}
          `);
        } else {
          await tx.execute(drizzleSql`
            INSERT INTO "player_double_cultivation_sperm" (
              "player_id",
              "storage_ml",
              "updated_at"
            ) VALUES (
              ${params.playerId},
              ${nextStorage},
              ${nowIso}
            )
          `);
        }
      } else {
        targetFluidMl = fluidMl;
        const uterusRows = await tx.execute<{
          storage_ml?: number | null;
          capacity_ml?: number | null;
        }>(drizzleSql`
          SELECT "storage_ml", "capacity_ml"
          FROM "player_double_cultivation_uterus"
          WHERE "player_id" = ${params.playerId}
          LIMIT 1
        `);
        const uterusRow = pickFirstRow<{
          storage_ml?: number | null;
          capacity_ml?: number | null;
        }>(uterusRows);
        const storageMl = Math.max(0, Math.floor(Number(uterusRow?.storage_ml || 0)));
        const capacityMl = Math.max(1, Math.floor(Number(uterusRow?.capacity_ml || DEFAULT_UTERUS_CAPACITY_ML)));
        const nextStorageMl = Math.max(0, Math.min(capacityMl, storageMl + targetFluidMl));
        if (uterusRow) {
          await tx.execute(drizzleSql`
            UPDATE "player_double_cultivation_uterus"
            SET
              "storage_ml" = ${nextStorageMl},
              "capacity_ml" = ${capacityMl},
              "updated_at" = ${nowIso},
              "last_digest_at" = NULL
            WHERE "player_id" = ${params.playerId}
          `);
        } else {
          await tx.execute(drizzleSql`
            INSERT INTO "player_double_cultivation_uterus" (
              "player_id",
              "storage_ml",
              "capacity_ml",
              "updated_at",
              "last_digest_at"
            ) VALUES (
              ${params.playerId},
              ${nextStorageMl},
              ${capacityMl},
              ${nowIso},
              NULL
            )
          `);
        }
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
          NULL,
          ${params.playerId},
          NULL,
          ${sourceRef},
          ${sourceTargetId},
          'world_npc',
          ${params.targetNpcId},
          ${targetNpcName},
          ${initiatorFluidMl},
          ${targetFluidMl},
          ${intimacyScoreDelta},
          0,
          ${initiatorIntimacyLevel},
          0,
          ${percent},
          0,
          (${gain.toString()})::bigint,
          0,
          ${narrative},
          ${promptSnapshot},
          ${dateKey},
          ${nowIso}
        )
      `);
    });
  } catch (error) {
    if (sourceRef && isUniqueViolationError(error)) {
      const duplicatedLog = await loadExistingWorldNpcLog({
        playerId: params.playerId,
        sourceRef,
      });
      if (duplicatedLog) {
        const intimacyScore = await loadCurrentIntimacyScore(params.playerId);
        return buildExistingResult({
          log: duplicatedLog,
          intimacyScore,
        });
      }
    }
    throw error;
  }

  const finalLog = await loadExistingWorldNpcLog({
    playerId: params.playerId,
    sourceRef,
  });
  if (!finalLog) {
    throw new Error("世界 NPC 双修正式账本写入失败");
  }

  if (playerGender === "female" && targetGender === "male") {
    const uterusRows = await db.execute<{
      storage_ml?: number | null;
      capacity_ml?: number | null;
    }>(drizzleSql`
      SELECT "storage_ml", "capacity_ml"
      FROM "player_double_cultivation_uterus"
      WHERE "player_id" = ${params.playerId}
      LIMIT 1
    `);
    const uterusRow = pickFirstRow<{
      storage_ml?: number | null;
      capacity_ml?: number | null;
    }>(uterusRows);
    const pregnancySettle = await syncPregnancyStatusFromUterusState({
      femalePlayerId: params.playerId,
      uterusStorageMl: Math.max(0, Math.floor(Number(uterusRow?.storage_ml || 0))),
      uterusCapacityMl: Math.max(1, Math.floor(Number(uterusRow?.capacity_ml || DEFAULT_UTERUS_CAPACITY_ML))),
      absorbedMl: targetFluidMl,
      sourceRef,
      sourceType: "open_world_adult",
      sourcePluginId: "double-cultivation",
      sourceTargetKind: "world_npc",
      sourceTargetId: params.targetNpcId,
    });
    pregnancyStatus = pregnancySettle.pregnancyStatus
      ? {
        stageKey: pregnancySettle.pregnancyStatus.stageKey || null,
        statusKey: pregnancySettle.pregnancyStatus.statusKey || null,
      }
      : null;
    fertilizationDisplayStatus = pregnancySettle.fertilizationDisplayStatus
      ? {
        stageKey: pregnancySettle.fertilizationDisplayStatus.stageKey || null,
        statusKey: pregnancySettle.fertilizationDisplayStatus.statusKey || null,
      }
      : null;
  }

  return {
    settled: true,
    settledVia: "host_ledger",
    log: {
      id: finalLog.id,
      sourceRef: finalLog.source_ref ?? sourceRef,
      sourceTargetId: finalLog.source_target_id ?? sourceTargetId,
      targetKind: finalLog.target_kind ?? "world_npc",
      targetMonsterId: finalLog.target_monster_id ?? params.targetNpcId,
      targetNameSnapshot: finalLog.target_name_snapshot ?? targetNpcName,
      initiatorFluidMl: finalLog.initiator_fluid_ml ?? initiatorFluidMl,
      targetFluidMl: finalLog.target_fluid_ml ?? targetFluidMl,
    },
    player: {
      gain: toSafeOutputNumber(gain),
    },
    intimacy: {
      scoreDelta: intimacyScoreDelta,
      currentLevel: resolveIntimacyLevel(nextIntimacyScore),
    },
    pregnancyStatus,
    fertilizationDisplayStatus,
    statusEffectsApplied: [],
    sourceRef,
    sourceTargetId,
  } satisfies WorldNpcDoubleCultivationLinkageResult;
}

export async function settleMapMonsterDoubleCultivationHostLedger(params: {
  playerId: string;
  targetMonsterId: string;
  targetMonsterName: string;
  targetMonsterType?: string | null;
  targetMonsterRealmName?: string | null;
  actionType?: string | null;
  sourceRef?: string | null;
  sourceTargetId?: string | null;
}): Promise<WorldNpcDoubleCultivationLinkageResult> {
  await ensureDoubleCultivationHostLedger();

  const player = await loadWorldNpcLedgerPlayer(params.playerId);
  if (!player) {
    throw new Error("发起者不存在");
  }

  const playerGender = normalizeGender(player.gender);
  if (!playerGender) {
    throw new Error("当前角色性别未设置，无法执行人兽双修");
  }

  const existingLog = await loadExistingWorldNpcLog({
    playerId: params.playerId,
    sourceRef: params.sourceRef,
  });
  if (existingLog) {
    const intimacyScore = await loadCurrentIntimacyScore(params.playerId);
    return buildExistingResult({
      log: existingLog,
      intimacyScore,
    });
  }

  const nowIso = new Date().toISOString();
  const dateKey = getShanghaiDateKey();
  const sourceRef = String(params.sourceRef || "").trim() || null;
  const sourceTargetId = String(params.sourceTargetId || "").trim() || params.targetMonsterId;
  const targetMonsterName = String(params.targetMonsterName || "").trim() || "无名妖兽";
  const targetMonsterType = String(params.targetMonsterType || "").trim() || "normal";
  const targetMonsterRealmName = String(params.targetMonsterRealmName || "").trim() || (
    targetMonsterType === "boss" ? "山野霸主" : targetMonsterType === "elite" ? "山野灵境" : "山野妖域"
  );

  const usedCountRows = await db.execute<{ used_count?: number | null; positive_gain_total?: string | number | null }>(drizzleSql`
    SELECT "used_count", "positive_gain_total"::text AS "positive_gain_total"
    FROM "player_double_cultivation_daily"
    WHERE "player_id" = ${params.playerId}
      AND "date_key" = ${dateKey}
    ORDER BY "id" DESC
    LIMIT 1
  `);
  const dailyRow = pickFirstRow<{ used_count?: number | null; positive_gain_total?: string | number | null }>(usedCountRows);
  const usedCountBefore = Math.max(0, Math.floor(Number(dailyRow?.used_count || 0)));
  const percent = getPercentByUsedCount(usedCountBefore);
  const currentXp = toNonNegativeBigInt(player.cultivationXp);
  const dailyCap = calcBaseGain(currentXp, DOUBLE_CULTIVATION_DAILY_GAIN_CAP_PERCENT);
  const gainedToday = toNonNegativeBigInt(dailyRow?.positive_gain_total);
  const remainingDailyCap = dailyCap > gainedToday ? (dailyCap - gainedToday) : 0n;
  let gain = calcWorldNpcDoubleCultivationBaseGain(currentXp, percent);
  if (gain > remainingDailyCap) {
    gain = remainingDailyCap;
  }
  if (gain < 0n) {
    gain = 0n;
  }

  const intimacyScoreDelta = Math.max(3, resolveIntimacyScoreDelta(params.actionType));
  const previousIntimacyScore = await loadCurrentIntimacyScore(params.playerId);
  const nextIntimacyScore = previousIntimacyScore + intimacyScoreDelta;
  const initiatorIntimacyLevel = resolveIntimacyLevel(previousIntimacyScore);
  const narrative = `${player.name || "无名修士"}与${targetMonsterName}完成了一次人兽双修，异类妖气与体内灵机短暂交缠，余韵久久未散。`;
  const promptSnapshot = [
    "随机事件人兽双修核心账本。",
    `发起者：${player.name || "无名修士"}（${String(player.realmName || "凡人")}）`,
    `目标：${targetMonsterName}（${targetMonsterRealmName}）`,
    `怪物类型：${targetMonsterType || "normal"}`,
    `动作：${String(params.actionType || "random_event_beast_cultivation").trim() || "random_event_beast_cultivation"}`,
  ].join("\n");

  let initiatorFluidMl = 0;
  let targetFluidMl = 0;
  let pregnancyStatus: WorldNpcDoubleCultivationLinkageResult["pregnancyStatus"] = null;
  let fertilizationDisplayStatus: WorldNpcDoubleCultivationLinkageResult["fertilizationDisplayStatus"] = null;

  try {
    await db.transaction(async (tx) => {
      const existingDailyRows = await tx.execute<{ id?: number | null }>(drizzleSql`
        SELECT "id"
        FROM "player_double_cultivation_daily"
        WHERE "player_id" = ${params.playerId}
          AND "date_key" = ${dateKey}
        ORDER BY "id" DESC
        LIMIT 1
      `);
      const existingDaily = pickFirstRow<{ id?: number | null }>(existingDailyRows);
      if (existingDaily?.id) {
        await tx.execute(drizzleSql`
          UPDATE "player_double_cultivation_daily"
          SET
            "used_count" = GREATEST(0, COALESCE("used_count", 0)) + 1,
            "positive_gain_total" = COALESCE("positive_gain_total", 0) + (${gain.toString()})::bigint,
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
            ${params.playerId},
            ${dateKey},
            1,
            (${gain.toString()})::bigint,
            ${nowIso},
            ${nowIso}
          )
        `);
      }

      if (gain > 0n) {
        await tx.execute(drizzleSql`
          UPDATE "players"
          SET
            "cultivation_xp" = COALESCE("cultivation_xp", 0) + (${gain.toString()})::bigint,
            "updated_at" = ${nowIso}
          WHERE "id" = ${params.playerId}
        `);
      }

      const statsRows = await tx.execute<{ player_id?: string | null }>(drizzleSql`
        SELECT "player_id"
        FROM "player_double_cultivation_player_stats"
        WHERE "player_id" = ${params.playerId}
        LIMIT 1
      `);
      const existingStats = pickFirstRow<{ player_id?: string | null }>(statsRows);
      if (existingStats?.player_id) {
        await tx.execute(drizzleSql`
          UPDATE "player_double_cultivation_player_stats"
          SET
            "intimacy_score" = GREATEST(0, COALESCE("intimacy_score", 0) + ${intimacyScoreDelta}),
            "note" = '随机事件人兽双修累计',
            "updated_at" = ${nowIso}
          WHERE "player_id" = ${params.playerId}
        `);
      } else {
        await tx.execute(drizzleSql`
          INSERT INTO "player_double_cultivation_player_stats" (
            "player_id",
            "intimacy_score",
            "note",
            "updated_at"
          ) VALUES (
            ${params.playerId},
            ${intimacyScoreDelta},
            '随机事件人兽双修累计',
            ${nowIso}
          )
        `);
      }

      const fluidMl = resolveFluidMl({
        playerGender,
        actionType: params.actionType,
      });

      if (playerGender === "male") {
        const spermRows = await tx.execute<{ storage_ml?: number | null }>(drizzleSql`
          SELECT "storage_ml"
          FROM "player_double_cultivation_sperm"
          WHERE "player_id" = ${params.playerId}
          LIMIT 1
        `);
        const spermRow = pickFirstRow<{ storage_ml?: number | null }>(spermRows);
        const currentStorage = Math.max(0, Math.floor(Number(spermRow?.storage_ml ?? DEFAULT_SPERM_STORAGE_ML)));
        initiatorFluidMl = currentStorage >= fluidMl ? fluidMl : 0;
        const nextStorage = Math.max(0, currentStorage - initiatorFluidMl);
        if (spermRow) {
          await tx.execute(drizzleSql`
            UPDATE "player_double_cultivation_sperm"
            SET
              "storage_ml" = ${nextStorage},
              "updated_at" = ${nowIso}
            WHERE "player_id" = ${params.playerId}
          `);
        } else {
          await tx.execute(drizzleSql`
            INSERT INTO "player_double_cultivation_sperm" (
              "player_id",
              "storage_ml",
              "updated_at"
            ) VALUES (
              ${params.playerId},
              ${nextStorage},
              ${nowIso}
            )
          `);
        }
      } else {
        targetFluidMl = fluidMl;
        const uterusRows = await tx.execute<{
          storage_ml?: number | null;
          capacity_ml?: number | null;
        }>(drizzleSql`
          SELECT "storage_ml", "capacity_ml"
          FROM "player_double_cultivation_uterus"
          WHERE "player_id" = ${params.playerId}
          LIMIT 1
        `);
        const uterusRow = pickFirstRow<{
          storage_ml?: number | null;
          capacity_ml?: number | null;
        }>(uterusRows);
        const storageMl = Math.max(0, Math.floor(Number(uterusRow?.storage_ml || 0)));
        const capacityMl = Math.max(1, Math.floor(Number(uterusRow?.capacity_ml || DEFAULT_UTERUS_CAPACITY_ML)));
        const nextStorageMl = Math.max(0, Math.min(capacityMl, storageMl + targetFluidMl));
        if (uterusRow) {
          await tx.execute(drizzleSql`
            UPDATE "player_double_cultivation_uterus"
            SET
              "storage_ml" = ${nextStorageMl},
              "capacity_ml" = ${capacityMl},
              "updated_at" = ${nowIso},
              "last_digest_at" = NULL
            WHERE "player_id" = ${params.playerId}
          `);
        } else {
          await tx.execute(drizzleSql`
            INSERT INTO "player_double_cultivation_uterus" (
              "player_id",
              "storage_ml",
              "capacity_ml",
              "updated_at",
              "last_digest_at"
            ) VALUES (
              ${params.playerId},
              ${nextStorageMl},
              ${capacityMl},
              ${nowIso},
              NULL
            )
          `);
        }
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
          NULL,
          ${params.playerId},
          NULL,
          ${sourceRef},
          ${sourceTargetId},
          'monster',
          ${params.targetMonsterId},
          ${targetMonsterName},
          ${initiatorFluidMl},
          ${targetFluidMl},
          ${intimacyScoreDelta},
          0,
          ${initiatorIntimacyLevel},
          0,
          ${percent},
          0,
          (${gain.toString()})::bigint,
          0,
          ${narrative},
          ${promptSnapshot},
          ${dateKey},
          ${nowIso}
        )
      `);
    });
  } catch (error) {
    if (sourceRef && isUniqueViolationError(error)) {
      const duplicatedLog = await loadExistingWorldNpcLog({
        playerId: params.playerId,
        sourceRef,
      });
      if (duplicatedLog) {
        const intimacyScore = await loadCurrentIntimacyScore(params.playerId);
        return buildExistingResult({
          log: duplicatedLog,
          intimacyScore,
        });
      }
    }
    throw error;
  }

  const finalLog = await loadExistingWorldNpcLog({
    playerId: params.playerId,
    sourceRef,
  });
  if (!finalLog) {
    throw new Error("人兽双修正式账本写入失败");
  }

  if (playerGender === "female") {
    const uterusRows = await db.execute<{
      storage_ml?: number | null;
      capacity_ml?: number | null;
    }>(drizzleSql`
      SELECT "storage_ml", "capacity_ml"
      FROM "player_double_cultivation_uterus"
      WHERE "player_id" = ${params.playerId}
      LIMIT 1
    `);
    const uterusRow = pickFirstRow<{
      storage_ml?: number | null;
      capacity_ml?: number | null;
    }>(uterusRows);
    const pregnancySettle = await syncPregnancyStatusFromUterusState({
      femalePlayerId: params.playerId,
      uterusStorageMl: Math.max(0, Math.floor(Number(uterusRow?.storage_ml || 0))),
      uterusCapacityMl: Math.max(1, Math.floor(Number(uterusRow?.capacity_ml || DEFAULT_UTERUS_CAPACITY_ML))),
      absorbedMl: targetFluidMl,
      sourceRef,
      sourceType: "double_cultivation_beast",
      sourcePluginId: "double-cultivation",
      sourceTargetKind: "monster",
      sourceTargetId: params.targetMonsterId,
    });
    pregnancyStatus = pregnancySettle.pregnancyStatus
      ? {
        stageKey: pregnancySettle.pregnancyStatus.stageKey || null,
        statusKey: pregnancySettle.pregnancyStatus.statusKey || null,
      }
      : null;
    fertilizationDisplayStatus = pregnancySettle.fertilizationDisplayStatus
      ? {
        stageKey: pregnancySettle.fertilizationDisplayStatus.stageKey || null,
        statusKey: pregnancySettle.fertilizationDisplayStatus.statusKey || null,
      }
      : null;
  }

  return {
    settled: true,
    settledVia: "host_ledger",
    log: {
      id: finalLog.id,
      sourceRef: finalLog.source_ref ?? sourceRef,
      sourceTargetId: finalLog.source_target_id ?? sourceTargetId,
      targetKind: finalLog.target_kind ?? "monster",
      targetMonsterId: finalLog.target_monster_id ?? params.targetMonsterId,
      targetNameSnapshot: finalLog.target_name_snapshot ?? targetMonsterName,
      initiatorFluidMl: finalLog.initiator_fluid_ml ?? initiatorFluidMl,
      targetFluidMl: finalLog.target_fluid_ml ?? targetFluidMl,
    },
    player: {
      gain: toSafeOutputNumber(gain),
    },
    intimacy: {
      scoreDelta: intimacyScoreDelta,
      currentLevel: resolveIntimacyLevel(nextIntimacyScore),
    },
    pregnancyStatus,
    fertilizationDisplayStatus,
    statusEffectsApplied: [],
    sourceRef,
    sourceTargetId,
  } satisfies WorldNpcDoubleCultivationLinkageResult;
}
