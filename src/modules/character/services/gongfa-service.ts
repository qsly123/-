import { sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import {
  getGongfaBonusLabel,
  normalizeGongfaBonusRecord,
} from "@/modules/shared/services/gongfa-bonus";
import { ensureDoubleCultivationHostLedger } from "@/modules/world/services/double-cultivation-ledger";

type SqlExecutor = Pick<typeof db, "execute">;

export type GongfaType = "normal" | "sex";
export type GongfaRequirementType = "none" | "intimacyLevel" | "doubleCultivationCount" | "intimacyScore" | "countOrScore";

type GongfaBookRow = {
  id: number;
  code: string;
  name: string;
  gongfa_type: string;
  description: string | null;
  tier: number;
  max_level: number;
  cover_image_url: string | null;
  sort_order: number;
  enabled: boolean;
};

type GongfaLevelRow = {
  gongfa_id: number;
  level_index: number;
  layer_label: string | null;
  upgrade_cost: number;
  requirement_type: string | null;
  requirement_value: number | null;
  requirement_text: string | null;
  enabled: boolean;
};

type GongfaBonusRow = {
  gongfa_id: number;
  level_index: number;
  attr_key: string;
  attr_value: number | string;
  enabled: boolean;
};

type GongfaProgressRow = {
  gongfa_id: number;
  level: number;
  updated_at: string | null;
};

type GongfaPointRow = {
  points: number;
  total_earned: number | null;
  updated_at: string | null;
};

type DoubleCultivationRequirementSnapshot = {
  intimacyScore: number;
  intimacyLevel: number;
  doubleCultivationCount: number;
};

export interface GongfaLevelConfig {
  levelIndex: number;
  layerLabel: string;
  upgradeCost: number;
  requirementType: GongfaRequirementType;
  requirementValue: number;
  requirementText: string;
  bonuses: Record<string, number>;
}

export interface GongfaBookRecord {
  id: number;
  code: string;
  name: string;
  gongfaType: GongfaType;
  description: string;
  tier: number;
  sortOrder: number;
  coverImageUrl: string | null;
  enabled: boolean;
  maxLevel: number;
  levelConfig: GongfaLevelConfig[];
}

export interface PlayerGongfaRecord extends GongfaBookRecord {
  currentLevel: number;
  currentLayerLabel: string;
  nextLevel: GongfaLevelConfig | null;
  learned: boolean;
  maxed: boolean;
  activeBonuses: Array<{
    key: string;
    label: string;
    value: number;
  }>;
}

export interface PlayerGongfaView {
  points: number;
  totalEarned: number;
  updatedAt: string | null;
  books: PlayerGongfaRecord[];
  totalBonuses: Array<{
    key: string;
    label: string;
    value: number;
  }>;
}

export interface GongfaBookInput {
  id?: unknown;
  code?: unknown;
  name?: unknown;
  gongfaType?: unknown;
  description?: unknown;
  tier?: unknown;
  sortOrder?: unknown;
  coverImageUrl?: unknown;
  enabled?: unknown;
  levelConfig?: unknown;
}

let ensureGongfaSchemaPromise: Promise<void> | null = null;
const DOUBLE_CULTIVATION_INTIMACY_THRESHOLDS = [50, 150, 300, 500];

function toText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value: unknown, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function normalizeGongfaType(value: unknown): GongfaType {
  return value === "sex" ? "sex" : "normal";
}

function normalizeRequirementType(value: unknown): GongfaRequirementType {
  if (
    value === "intimacyLevel"
    || value === "doubleCultivationCount"
    || value === "intimacyScore"
    || value === "countOrScore"
  ) {
    return value;
  }
  return "none";
}

function resolveDoubleCultivationIntimacyLevel(score: number) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  let level = 0;
  for (const threshold of DOUBLE_CULTIVATION_INTIMACY_THRESHOLDS) {
    if (safeScore >= threshold) {
      level += 1;
      continue;
    }
    break;
  }
  return level;
}

async function loadDoubleCultivationRequirementSnapshot(
  executor: SqlExecutor,
  playerId: string,
): Promise<DoubleCultivationRequirementSnapshot> {
  const [scoreRows, countRows] = await Promise.all([
    executor.execute<{ intimacy_score: number | string | null }>(drizzleSql`
      SELECT COALESCE("intimacy_score", 0) AS "intimacy_score"
      FROM "player_double_cultivation_player_stats"
      WHERE "player_id" = ${playerId}
      LIMIT 1
    `),
    executor.execute<{ total: number | string }>(drizzleSql`
      SELECT count(*)::int AS "total"
      FROM "player_double_cultivation_logs"
      WHERE "initiator_player_id" = ${playerId}
         OR "target_player_id" = ${playerId}
    `),
  ]);
  const intimacyScore = Math.max(0, toInt(scoreRows[0]?.intimacy_score, 0));
  return {
    intimacyScore,
    intimacyLevel: resolveDoubleCultivationIntimacyLevel(intimacyScore),
    doubleCultivationCount: Math.max(0, toInt(countRows[0]?.total, 0)),
  };
}

function assertGongfaRequirementSatisfied(
  level: GongfaLevelRow | undefined,
  snapshot: DoubleCultivationRequirementSnapshot,
) {
  const requirementType = normalizeRequirementType(level?.requirement_type);
  if (requirementType === "none") {
    return;
  }

  const requirementValue = Math.max(0, toInt(level?.requirement_value, 0));
  const requirementText = toText(level?.requirement_text);
  const suffix = requirementText ? `：${requirementText}` : "";

  if (requirementType === "intimacyLevel" && snapshot.intimacyLevel < requirementValue) {
    throw new Error(`双修亲密等级不足，需要 ${requirementValue} 级${suffix}`);
  }
  if (requirementType === "doubleCultivationCount" && snapshot.doubleCultivationCount < requirementValue) {
    throw new Error(`双修次数不足，需要 ${requirementValue} 次${suffix}`);
  }
  if (requirementType === "intimacyScore" && snapshot.intimacyScore < requirementValue) {
    throw new Error(`双修亲密度不足，需要 ${requirementValue} 点${suffix}`);
  }
  if (
    requirementType === "countOrScore"
    && snapshot.doubleCultivationCount < requirementValue
    && snapshot.intimacyScore < requirementValue
  ) {
    throw new Error(`双修条件不足，需要 ${requirementValue} 次或 ${requirementValue} 点亲密度${suffix}`);
  }
}

function normalizeLevelConfig(raw: unknown, gongfaType: GongfaType): GongfaLevelConfig[] {
  const rows = Array.isArray(raw) ? raw : [];
  const normalized = rows
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item, index): GongfaLevelConfig => {
      const row = item as Record<string, unknown>;
      const requirementType = gongfaType === "sex"
        ? normalizeRequirementType(row.requirementType)
        : "none";
      return {
        levelIndex: index + 1,
        layerLabel: toText(row.layerLabel) || `第${index + 1}层`,
        upgradeCost: gongfaType === "sex" ? 0 : Math.max(1, toInt(row.upgradeCost, 1)),
        requirementType,
        requirementValue: requirementType === "none" ? 0 : Math.max(0, toInt(row.requirementValue, 0)),
        requirementText: requirementType === "none" ? "" : toText(row.requirementText),
        bonuses: normalizeGongfaBonusRecord(row.bonuses),
      };
    });

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      levelIndex: 1,
      layerLabel: "第1层",
      upgradeCost: gongfaType === "sex" ? 0 : 1,
      requirementType: "none",
      requirementValue: 0,
      requirementText: "",
      bonuses: {},
    },
  ];
}

function normalizeBookInput(input: GongfaBookInput) {
  const gongfaType = normalizeGongfaType(input.gongfaType);
  return {
    code: toText(input.code),
    name: toText(input.name),
    gongfaType,
    description: toText(input.description),
    tier: Math.max(1, toInt(input.tier, 1)),
    sortOrder: toInt(input.sortOrder, 0),
    coverImageUrl: toText(input.coverImageUrl) || null,
    enabled: input.enabled !== false,
    levelConfig: normalizeLevelConfig(input.levelConfig, gongfaType),
  };
}

function buildBookRecord(book: GongfaBookRow, levelRows: GongfaLevelRow[], bonusRows: GongfaBonusRow[]): GongfaBookRecord {
  const gongfaType = normalizeGongfaType(book.gongfa_type);
  const maxLevel = Math.max(
    1,
    toInt(book.max_level, 1),
    ...levelRows.map((row) => Math.max(1, toInt(row.level_index, 1))),
  );

  const levelConfig = Array.from({ length: maxLevel }, (_, index): GongfaLevelConfig => {
    const levelIndex = index + 1;
    const levelRow = levelRows.find((item) => toInt(item.level_index, 0) === levelIndex);
    const levelBonusRows = bonusRows.filter((item) => toInt(item.level_index, 0) === levelIndex);
    const bonuses = normalizeGongfaBonusRecord(levelBonusRows.reduce<Record<string, number>>((acc, item) => {
      const key = toText(item.attr_key);
      if (key) {
        acc[key] = toNumber(item.attr_value, 0);
      }
      return acc;
    }, {}));
    const requirementType = gongfaType === "sex" ? normalizeRequirementType(levelRow?.requirement_type) : "none";

    return {
      levelIndex,
      layerLabel: toText(levelRow?.layer_label) || `第${levelIndex}层`,
      upgradeCost: gongfaType === "sex" ? 0 : Math.max(1, toInt(levelRow?.upgrade_cost, 1)),
      requirementType,
      requirementValue: requirementType === "none" ? 0 : Math.max(0, toInt(levelRow?.requirement_value, 0)),
      requirementText: requirementType === "none" ? "" : toText(levelRow?.requirement_text),
      bonuses,
    };
  });

  return {
    id: toInt(book.id, 0),
    code: toText(book.code),
    name: toText(book.name),
    gongfaType,
    description: toText(book.description),
    tier: Math.max(1, toInt(book.tier, 1)),
    sortOrder: toInt(book.sort_order, 0),
    coverImageUrl: toText(book.cover_image_url) || null,
    enabled: book.enabled === true,
    maxLevel,
    levelConfig,
  };
}

function bonusRecordToList(record: Record<string, number>) {
  return Object.entries(normalizeGongfaBonusRecord(record))
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([key, value]) => ({
      key,
      label: getGongfaBonusLabel(key) || key,
      value,
    }));
}

async function seedDefaultGongfaBooks(executor: SqlExecutor = db) {
  const rows = await executor.execute<{ total: number }>(drizzleSql`
    SELECT count(*)::int AS "total" FROM "plugin_gongfa_books"
  `);
  if (Number(rows[0]?.total || 0) > 0) {
    return;
  }

  await executor.execute(drizzleSql`
    INSERT INTO "plugin_gongfa_books" (
      "code","name","gongfa_type","description","tier","max_level","sort_order","enabled","created_at","updated_at"
    )
    VALUES
      ('core_body_foundation','太初炼体诀','normal','固定核心功法：提升气血、防御与攻击，是旧插件功法迁入后的基础成长线。',1,3,10,true,NOW()::text,NOW()::text),
      ('core_spirit_wind','御风凝神篇','normal','固定核心功法：提升速度、神识与神通增伤，服务实时战斗主链。',2,3,20,true,NOW()::text,NOW()::text),
      ('core_dual_yin_yang','阴阳同参诀','sex','固定核心功法：承接双修相关加成，不再通过插件 Hook 注入。',2,3,30,true,NOW()::text,NOW()::text)
    ON CONFLICT ("code") DO NOTHING
  `);

  const books = await executor.execute<{ id: number; code: string; gongfa_type: string }>(drizzleSql`
    SELECT "id","code","gongfa_type" FROM "plugin_gongfa_books"
    WHERE "code" IN ('core_body_foundation','core_spirit_wind','core_dual_yin_yang')
  `);

  for (const book of books) {
    const configs = book.code === "core_body_foundation"
      ? [
        { label: "筑基", cost: 1, bonuses: { maxHp: 80, defense: 8 } },
        { label: "锻骨", cost: 2, bonuses: { maxHp: 140, attack: 10 } },
        { label: "凝血", cost: 3, bonuses: { maxHp: 220, defense: 18 } },
      ]
      : book.code === "core_spirit_wind"
        ? [
          { label: "听风", cost: 1, bonuses: { speed: 4, spiritualSense: 6 } },
          { label: "御气", cost: 2, bonuses: { speed: 8, skillDamageBonus: 3 } },
          { label: "凝神", cost: 3, bonuses: { spiritualSense: 16, skillDamageBonus: 5 } },
        ]
        : [
          { label: "同息", cost: 0, bonuses: { "双修修为提升倍率": 3, "男性精液恢复增幅": 5 } },
          { label: "合意", cost: 0, bonuses: { "双修修为提升倍率": 6, "子宫精液转化效率增幅": 5 } },
          { label: "归元", cost: 0, bonuses: { "双修修为提升倍率": 10, "男性精液容量增幅": 8 } },
        ];

    for (const [index, config] of configs.entries()) {
      const levelIndex = index + 1;
      await executor.execute(drizzleSql`
        INSERT INTO "plugin_gongfa_book_levels" (
          "gongfa_id","level_index","layer_label","upgrade_cost","requirement_type","requirement_value","requirement_text","enabled","created_at","updated_at"
        )
        VALUES (
          ${book.id},${levelIndex},${config.label},${book.gongfa_type === "sex" ? 0 : config.cost},NULL,NULL,NULL,true,NOW()::text,NOW()::text
        )
        ON CONFLICT ("gongfa_id","level_index") DO NOTHING
      `);

      let sortOrder = 0;
      for (const [attrKey, attrValue] of Object.entries(config.bonuses)) {
        sortOrder += 1;
        await executor.execute(drizzleSql`
          INSERT INTO "plugin_gongfa_level_bonus_items" (
            "gongfa_id","level_index","attr_key","attr_unit","attr_value","sort_order","enabled","created_at","updated_at"
          )
          VALUES (
            ${book.id},${levelIndex},${attrKey},'点',${Number(attrValue)},${sortOrder},true,NOW()::text,NOW()::text
          )
          ON CONFLICT ("gongfa_id","level_index","attr_key") DO NOTHING
        `);
      }
    }
  }
}

export async function ensureGongfaCoreSchema() {
  if (!ensureGongfaSchemaPromise) {
    ensureGongfaSchemaPromise = (async () => {
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_gongfa_books" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "code" text NOT NULL UNIQUE,
          "name" text NOT NULL,
          "gongfa_type" text NOT NULL DEFAULT 'normal',
          "description" text NOT NULL DEFAULT '',
          "tier" integer NOT NULL DEFAULT 1,
          "max_level" integer NOT NULL DEFAULT 1,
          "level_labels_json" text,
          "level_cost_json" text,
          "level_bonus_json" text,
          "cover_image_url" text,
          "sort_order" integer NOT NULL DEFAULT 0,
          "enabled" boolean NOT NULL DEFAULT true,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_gongfa_book_levels" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "gongfa_id" integer NOT NULL REFERENCES "plugin_gongfa_books"("id") ON DELETE CASCADE,
          "level_index" integer NOT NULL,
          "layer_label" text NOT NULL DEFAULT '',
          "upgrade_cost" integer NOT NULL DEFAULT 1,
          "requirement_type" text,
          "requirement_value" integer,
          "requirement_text" text,
          "enabled" boolean NOT NULL DEFAULT true,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          UNIQUE ("gongfa_id","level_index")
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_gongfa_level_bonus_items" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "gongfa_id" integer NOT NULL REFERENCES "plugin_gongfa_books"("id") ON DELETE CASCADE,
          "level_index" integer NOT NULL,
          "attr_key" text NOT NULL,
          "attr_unit" text NOT NULL DEFAULT '点',
          "attr_value" double precision NOT NULL DEFAULT 0,
          "sort_order" integer NOT NULL DEFAULT 0,
          "enabled" boolean NOT NULL DEFAULT true,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          UNIQUE ("gongfa_id","level_index","attr_key")
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_gongfa_player_progress" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
          "gongfa_id" integer NOT NULL REFERENCES "plugin_gongfa_books"("id") ON DELETE CASCADE,
          "level" integer NOT NULL DEFAULT 0,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          UNIQUE ("player_id","gongfa_id")
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_gongfa_player_points" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id") ON DELETE CASCADE,
          "points" bigint NOT NULL DEFAULT 0,
          "total_earned" bigint NOT NULL DEFAULT 0,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_gongfa_point_logs" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
          "delta" bigint NOT NULL DEFAULT 0,
          "change_amount" bigint NOT NULL DEFAULT 0,
          "source" text NOT NULL DEFAULT '',
          "reason" text NOT NULL DEFAULT '',
          "source_ref" text,
          "extra_json" text,
          "created_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_player_points" ADD COLUMN IF NOT EXISTS "total_earned" bigint NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_player_points" ALTER COLUMN "points" TYPE bigint USING "points"::bigint`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_player_points" ALTER COLUMN "total_earned" TYPE bigint USING "total_earned"::bigint`));
      await db.execute(drizzleSql.raw(`
        UPDATE "plugin_gongfa_player_points"
        SET "total_earned" = GREATEST("total_earned", "points", 0)
        WHERE "total_earned" <= 0 AND "points" > 0
      `));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ADD COLUMN IF NOT EXISTS "delta" bigint NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ADD COLUMN IF NOT EXISTS "change_amount" bigint NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ADD COLUMN IF NOT EXISTS "source_ref" text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ADD COLUMN IF NOT EXISTS "extra_json" text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ALTER COLUMN "delta" TYPE bigint USING "delta"::bigint`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "plugin_gongfa_point_logs" ALTER COLUMN "change_amount" TYPE bigint USING "change_amount"::bigint`));
      await db.execute(drizzleSql.raw(`
        UPDATE "plugin_gongfa_point_logs"
        SET
          "delta" = CASE WHEN "delta" = 0 AND "change_amount" <> 0 THEN "change_amount" ELSE "delta" END,
          "change_amount" = CASE WHEN "change_amount" = 0 AND "delta" <> 0 THEN "delta" ELSE "change_amount" END,
          "source_ref" = CASE WHEN "source_ref" IS NULL AND "source" <> '' THEN "source" ELSE "source_ref" END
        WHERE ("delta" = 0 AND "change_amount" <> 0)
           OR ("change_amount" = 0 AND "delta" <> 0)
           OR ("source_ref" IS NULL AND "source" <> '')
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "plugin_gongfa_progress_player_idx"
        ON "plugin_gongfa_player_progress" ("player_id")
      `));
      await seedDefaultGongfaBooks();
    })().catch((error) => {
      ensureGongfaSchemaPromise = null;
      throw error;
    });
  }
  return ensureGongfaSchemaPromise;
}

/**
 * 汇总玩家已修炼功法在当前层数下的**战斗属性**加成（绝对值，按层累积）。
 *
 * 只保留能映射到战斗属性的 key：双修类功法（如「双修修为提升倍率」）会被
 * `normalizeGongfaBonusRecord` 自动过滤掉，不会污染战斗属性。
 * 这些加成此前没有任何消费方（升级只改 level、不写基础属性），
 * 因此由 gongfa provider 输出时不会与既有逻辑重复计算。
 */
export async function getPlayerGongfaCombatBonus(
  playerId: string,
): Promise<Record<string, number>> {
  try {
    await ensureGongfaCoreSchema();
  } catch (error) {
    console.error(
      "[gongfa] 功法表初始化失败，跳过该层：",
      error instanceof Error ? error.message : String(error),
    );
    return {};
  }

  try {
    const rows = await db.execute<{ attr_key: string; total_value: number | string }>(drizzleSql`
      SELECT b."attr_key" AS "attr_key", SUM(b."attr_value") AS "total_value"
      FROM "plugin_gongfa_player_progress" p
      JOIN "plugin_gongfa_level_bonus_items" b
        ON b."gongfa_id" = p."gongfa_id"
        AND b."level_index" <= p."level"
        AND b."enabled" = true
      JOIN "plugin_gongfa_books" bk
        ON bk."id" = p."gongfa_id"
        AND bk."enabled" = true
      WHERE p."player_id" = ${playerId} AND p."level" > 0
      GROUP BY b."attr_key"
    `);

    const raw: Record<string, number> = {};
    for (const row of rows) {
      const key = String(row?.attr_key || "").trim();
      if (!key) {
        continue;
      }
      raw[key] = Number(row?.total_value || 0);
    }
    return normalizeGongfaBonusRecord(raw);
  } catch (error) {
    console.error(
      "[gongfa] 功法加成汇总失败，跳过该层：",
      error instanceof Error ? error.message : String(error),
    );
    return {};
  }
}

export async function listCoreGongfaBooks(includeDisabled = false) {
  await ensureGongfaCoreSchema();
  const [bookRows, levelRows, bonusRows] = await Promise.all([
    db.execute<GongfaBookRow>(drizzleSql`
      SELECT "id","code","name","gongfa_type","description","tier","max_level","cover_image_url","sort_order","enabled"
      FROM "plugin_gongfa_books"
      ${includeDisabled ? drizzleSql`` : drizzleSql`WHERE "enabled" = true`}
      ORDER BY "tier" ASC, "sort_order" ASC, "id" ASC
    `),
    db.execute<GongfaLevelRow>(drizzleSql`
      SELECT "gongfa_id","level_index","layer_label","upgrade_cost","requirement_type","requirement_value","requirement_text","enabled"
      FROM "plugin_gongfa_book_levels"
      WHERE "enabled" = true
      ORDER BY "gongfa_id" ASC, "level_index" ASC
    `),
    db.execute<GongfaBonusRow>(drizzleSql`
      SELECT "gongfa_id","level_index","attr_key","attr_value","enabled"
      FROM "plugin_gongfa_level_bonus_items"
      WHERE "enabled" = true
      ORDER BY "gongfa_id" ASC, "level_index" ASC, "sort_order" ASC, "id" ASC
    `),
  ]);

  return bookRows.map((book) => buildBookRecord(
    book,
    levelRows.filter((item) => toInt(item.gongfa_id, 0) === toInt(book.id, 0)),
    bonusRows.filter((item) => toInt(item.gongfa_id, 0) === toInt(book.id, 0)),
  ));
}

export async function getPlayerGongfaView(playerId: string): Promise<PlayerGongfaView> {
  await ensureGongfaCoreSchema();
  await db.execute(drizzleSql`
    INSERT INTO "plugin_gongfa_player_points" ("player_id","points","total_earned","created_at","updated_at")
    VALUES (${playerId},0,0,NOW()::text,NOW()::text)
    ON CONFLICT ("player_id") DO NOTHING
  `);

  const [books, progressRows, pointRows] = await Promise.all([
    listCoreGongfaBooks(false),
    db.execute<GongfaProgressRow>(drizzleSql`
      SELECT "gongfa_id","level","updated_at"
      FROM "plugin_gongfa_player_progress"
      WHERE "player_id" = ${playerId}
    `),
    db.execute<GongfaPointRow>(drizzleSql`
      SELECT "points","total_earned","updated_at"
      FROM "plugin_gongfa_player_points"
      WHERE "player_id" = ${playerId}
      LIMIT 1
    `),
  ]);

  const progressMap = new Map(progressRows.map((row) => [toInt(row.gongfa_id, 0), row]));
  const totalBonusRecord: Record<string, number> = {};
  const records = books.map((book): PlayerGongfaRecord => {
    const currentLevel = Math.max(0, Math.min(book.maxLevel, toInt(progressMap.get(book.id)?.level, 0)));
    const activeBonusRecord: Record<string, number> = {};
    for (const level of book.levelConfig) {
      if (level.levelIndex > currentLevel) {
        continue;
      }
      for (const [key, value] of Object.entries(level.bonuses)) {
        activeBonusRecord[key] = Number((Number(activeBonusRecord[key] || 0) + Number(value || 0)).toFixed(4));
        totalBonusRecord[key] = Number((Number(totalBonusRecord[key] || 0) + Number(value || 0)).toFixed(4));
      }
    }

    return {
      ...book,
      currentLevel,
      currentLayerLabel: currentLevel > 0
        ? book.levelConfig.find((item) => item.levelIndex === currentLevel)?.layerLabel || `第${currentLevel}层`
        : "未入门",
      nextLevel: book.levelConfig.find((item) => item.levelIndex === currentLevel + 1) || null,
      learned: currentLevel > 0,
      maxed: currentLevel >= book.maxLevel,
      activeBonuses: bonusRecordToList(activeBonusRecord),
    };
  });
  const points = pointRows[0];

  return {
    points: Math.max(0, toInt(points?.points, 0)),
    totalEarned: Math.max(0, toInt(points?.total_earned, 0)),
    updatedAt: points?.updated_at || null,
    books: records,
    totalBonuses: bonusRecordToList(totalBonusRecord),
  };
}

export async function upgradePlayerGongfa(playerId: string, gongfaId: number) {
  if (gongfaId < 1) {
    throw new Error("功法 ID 非法");
  }
  await ensureGongfaCoreSchema();
  await ensureDoubleCultivationHostLedger();

  await db.transaction(async (tx) => {
    const bookRows = await tx.execute<GongfaBookRow>(drizzleSql`
      SELECT "id","code","name","gongfa_type","description","tier","max_level","cover_image_url","sort_order","enabled"
      FROM "plugin_gongfa_books"
      WHERE "id" = ${gongfaId} AND "enabled" = true
      LIMIT 1
    `);
    const book = bookRows[0];
    if (!book) {
      throw new Error("功法不存在或未启用");
    }

    await tx.execute(drizzleSql`
      INSERT INTO "plugin_gongfa_player_points" ("player_id","points","total_earned","created_at","updated_at")
      VALUES (${playerId},0,0,NOW()::text,NOW()::text)
      ON CONFLICT ("player_id") DO NOTHING
    `);
    await tx.execute(drizzleSql`
      INSERT INTO "plugin_gongfa_player_progress" ("player_id","gongfa_id","level","created_at","updated_at")
      VALUES (${playerId},${gongfaId},0,NOW()::text,NOW()::text)
      ON CONFLICT ("player_id","gongfa_id") DO NOTHING
    `);

    const [progressRows, pointRows, levelRows] = await Promise.all([
      tx.execute<GongfaProgressRow>(drizzleSql`
        SELECT "gongfa_id","level","updated_at"
        FROM "plugin_gongfa_player_progress"
        WHERE "player_id" = ${playerId} AND "gongfa_id" = ${gongfaId}
        FOR UPDATE
      `),
      tx.execute<GongfaPointRow>(drizzleSql`
        SELECT "points","total_earned","updated_at"
        FROM "plugin_gongfa_player_points"
        WHERE "player_id" = ${playerId}
        FOR UPDATE
      `),
      tx.execute<GongfaLevelRow>(drizzleSql`
        SELECT "gongfa_id","level_index","layer_label","upgrade_cost","requirement_type","requirement_value","requirement_text","enabled"
        FROM "plugin_gongfa_book_levels"
        WHERE "gongfa_id" = ${gongfaId} AND "enabled" = true
        ORDER BY "level_index" ASC
      `),
    ]);

    const currentLevel = Math.max(0, toInt(progressRows[0]?.level, 0));
    const maxLevel = Math.max(1, toInt(book.max_level, 1));
    if (currentLevel >= maxLevel) {
      throw new Error("该功法已修炼至最高层");
    }

    const nextLevelIndex = currentLevel + 1;
    const nextLevel = levelRows.find((item) => toInt(item.level_index, 0) === nextLevelIndex);
    if (normalizeGongfaType(book.gongfa_type) === "sex") {
      assertGongfaRequirementSatisfied(
        nextLevel,
        await loadDoubleCultivationRequirementSnapshot(tx, playerId),
      );
    }
    const upgradeCost = normalizeGongfaType(book.gongfa_type) === "sex"
      ? 0
      : Math.max(1, toInt(nextLevel?.upgrade_cost, 1));
    const currentPoints = Math.max(0, toInt(pointRows[0]?.points, 0));
    if (currentPoints < upgradeCost) {
      throw new Error(`功法点不足，需要 ${upgradeCost} 点`);
    }

    await tx.execute(drizzleSql`
      UPDATE "plugin_gongfa_player_points"
      SET "points" = "points" - ${upgradeCost}, "updated_at" = NOW()::text
      WHERE "player_id" = ${playerId}
    `);
    await tx.execute(drizzleSql`
      UPDATE "plugin_gongfa_player_progress"
      SET "level" = ${nextLevelIndex}, "updated_at" = NOW()::text
      WHERE "player_id" = ${playerId} AND "gongfa_id" = ${gongfaId}
    `);
    await tx.execute(drizzleSql`
      INSERT INTO "plugin_gongfa_point_logs" (
        "player_id","delta","change_amount","source","reason","source_ref","created_at"
      )
      VALUES (
        ${playerId},
        ${-upgradeCost},
        ${-upgradeCost},
        'gongfa_upgrade',
        ${`修炼功法：${book.name}`},
        ${`gongfa:${gongfaId}:level:${nextLevelIndex}`},
        NOW()::text
      )
    `);
  });

  return getPlayerGongfaView(playerId);
}

async function syncBookLevelConfig(
  executor: SqlExecutor,
  bookId: number,
  gongfaType: GongfaType,
  levelConfig: GongfaLevelConfig[],
) {
  const labels = levelConfig.map((item) => item.layerLabel);
  const costs = levelConfig.map((item) => gongfaType === "sex" ? 0 : Math.max(1, item.upgradeCost));
  const bonuses = levelConfig.map((item) => normalizeGongfaBonusRecord(item.bonuses));

  await executor.execute(drizzleSql`
    UPDATE "plugin_gongfa_books"
    SET "max_level" = ${levelConfig.length},
        "level_labels_json" = ${JSON.stringify(labels)},
        "level_cost_json" = ${JSON.stringify(costs)},
        "level_bonus_json" = ${JSON.stringify(bonuses)},
        "updated_at" = NOW()::text
    WHERE "id" = ${bookId}
  `);
  await executor.execute(drizzleSql`DELETE FROM "plugin_gongfa_book_levels" WHERE "gongfa_id" = ${bookId}`);
  await executor.execute(drizzleSql`DELETE FROM "plugin_gongfa_level_bonus_items" WHERE "gongfa_id" = ${bookId}`);

  for (const level of levelConfig) {
    const requirementType = gongfaType === "sex" ? level.requirementType : "none";
    await executor.execute(drizzleSql`
      INSERT INTO "plugin_gongfa_book_levels" (
        "gongfa_id","level_index","layer_label","upgrade_cost","requirement_type","requirement_value","requirement_text","enabled","created_at","updated_at"
      )
      VALUES (
        ${bookId},
        ${level.levelIndex},
        ${level.layerLabel},
        ${gongfaType === "sex" ? 0 : Math.max(1, level.upgradeCost)},
        ${requirementType === "none" ? null : requirementType},
        ${requirementType === "none" ? null : Math.max(0, level.requirementValue)},
        ${requirementType === "none" ? null : level.requirementText || null},
        true,
        NOW()::text,
        NOW()::text
      )
    `);

    let sortOrder = 0;
    for (const [rawKey, rawValue] of Object.entries(normalizeGongfaBonusRecord(level.bonuses))) {
      const key = toText(rawKey);
      const value = toNumber(rawValue, 0);
      if (!key || value === 0) {
        continue;
      }
      sortOrder += 1;
      await executor.execute(drizzleSql`
        INSERT INTO "plugin_gongfa_level_bonus_items" (
          "gongfa_id","level_index","attr_key","attr_unit","attr_value","sort_order","enabled","created_at","updated_at"
        )
        VALUES (${bookId},${level.levelIndex},${key},'点',${value},${sortOrder},true,NOW()::text,NOW()::text)
      `);
    }
  }
}

export async function createCoreGongfaBook(input: GongfaBookInput) {
  await ensureGongfaCoreSchema();
  const normalized = normalizeBookInput(input);
  if (!normalized.code) {
    throw new Error("功法编码不能为空");
  }
  if (!normalized.name) {
    throw new Error("功法名称不能为空");
  }

  await db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: number }>(drizzleSql`
      INSERT INTO "plugin_gongfa_books" (
        "code","name","gongfa_type","description","tier","max_level","cover_image_url","sort_order","enabled","created_at","updated_at"
      )
      VALUES (
        ${normalized.code},${normalized.name},${normalized.gongfaType},${normalized.description},${normalized.tier},
        ${normalized.levelConfig.length},${normalized.coverImageUrl},${normalized.sortOrder},${normalized.enabled},NOW()::text,NOW()::text
      )
      RETURNING "id"
    `);
    const bookId = toInt(inserted[0]?.id, 0);
    if (bookId < 1) {
      throw new Error("创建功法失败");
    }
    await syncBookLevelConfig(tx, bookId, normalized.gongfaType, normalized.levelConfig);
  });
}

export async function updateCoreGongfaBook(id: number, input: GongfaBookInput) {
  if (id < 1) {
    throw new Error("功法 ID 非法");
  }
  await ensureGongfaCoreSchema();
  const normalized = normalizeBookInput(input);
  if (!normalized.code) {
    throw new Error("功法编码不能为空");
  }
  if (!normalized.name) {
    throw new Error("功法名称不能为空");
  }

  await db.transaction(async (tx) => {
    const updated = await tx.execute<{ id: number }>(drizzleSql`
      UPDATE "plugin_gongfa_books"
      SET "code" = ${normalized.code},
          "name" = ${normalized.name},
          "gongfa_type" = ${normalized.gongfaType},
          "description" = ${normalized.description},
          "tier" = ${normalized.tier},
          "cover_image_url" = ${normalized.coverImageUrl},
          "sort_order" = ${normalized.sortOrder},
          "enabled" = ${normalized.enabled},
          "updated_at" = NOW()::text
      WHERE "id" = ${id}
      RETURNING "id"
    `);
    if (updated.length < 1) {
      throw new Error("功法不存在");
    }
    await syncBookLevelConfig(tx, id, normalized.gongfaType, normalized.levelConfig);
  });
}

/* ------------------------------------------------------------------ 功法点产出 */

/**
 * 突破成功时发放的功法点。
 * 小境界 +1、跨大境界 +3：全库 3 本功法共 9 级、每级消耗 1~3 点，
 * 练气到元婴共 44 个境界位，够点满还有富余，但不会一步登天。
 */
export const GONGFA_POINTS_PER_MINOR_BREAKTHROUGH = 1;
export const GONGFA_POINTS_PER_MAJOR_BREAKTHROUGH = 3;

/**
 * 发放功法点（在此之前全项目只有消耗、没有任何产出，玩家永远点不满）。
 * 同时写 plugin_gongfa_point_logs，便于追溯来源。
 */
export async function grantGongfaPoints(params: {
  playerId: string;
  amount: number;
  source: string;
  reason?: string;
  sourceRef?: string | null;
}): Promise<number> {
  const amount = Math.max(0, Math.floor(Number(params.amount) || 0));
  if (amount <= 0) {
    return 0;
  }

  await ensureGongfaCoreSchema();

  await db.execute(drizzleSql`
    INSERT INTO "plugin_gongfa_player_points" ("player_id","points","total_earned","created_at","updated_at")
    VALUES (${params.playerId},0,0,NOW()::text,NOW()::text)
    ON CONFLICT ("player_id") DO NOTHING
  `);
  await db.execute(drizzleSql`
    UPDATE "plugin_gongfa_player_points"
    SET "points" = "points" + ${amount},
        "total_earned" = "total_earned" + ${amount},
        "updated_at" = NOW()::text
    WHERE "player_id" = ${params.playerId}
  `);
  await db.execute(drizzleSql`
    INSERT INTO "plugin_gongfa_point_logs"
      ("player_id","delta","change_amount","source","reason","source_ref","created_at")
    VALUES (
      ${params.playerId}, ${amount}, ${amount}, ${params.source},
      ${params.reason || ""}, ${params.sourceRef ?? null}, NOW()::text
    )
  `);

  return amount;
}
