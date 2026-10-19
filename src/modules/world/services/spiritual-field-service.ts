import { sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { getFourRealmsPack } from "@/db/offline-packs/four-realms-pack";
import { grantRewardToPlayer } from "@/modules/character/services/reward-service";
import {
  recoverHongmengTreasureEnergySnapshot,
} from "@/modules/character/services/hongmeng-treasure-service";

type SqlExecutor = Pick<typeof db, "execute">;

type SpiritualFieldSeedRow = {
  id: number;
  seed_item_id: string;
  output_item_id: string;
  name: string;
  growth_seconds: number | string;
  min_yield: number | string;
  max_yield: number | string;
  max_plots_per_player: number | string | null;
  enabled: boolean;
  drop_theme_tags: unknown;
  secret_realm_weight: number | string | null;
  seed_item_name: string | null;
  seed_item_icon_url: string | null;
  output_item_name: string | null;
  output_item_icon_url: string | null;
  owned_quantity?: number | string | null;
};

type SpiritualFieldPlotRow = {
  id: number;
  player_id: string;
  plot_index: number | string;
  status: string;
  seed_item_id: string | null;
  output_item_id: string | null;
  seed_name: string | null;
  planted_at: string | null;
  ready_at: string | null;
  harvested_at: string | null;
  growth_seconds: number | string | null;
  min_yield: number | string | null;
  max_yield: number | string | null;
  updated_at: string | null;
  seed_item_name: string | null;
  seed_item_icon_url: string | null;
  output_item_name: string | null;
  output_item_icon_url: string | null;
};

type SpiritualFieldPlayerRow = {
  player_id: string;
  plot_count: number | string;
  updated_at: string | null;
};

type InventoryQuantityRow = {
  quantity: number | string;
};

type BottleRow = {
  item_id: string;
  item_name: string;
  star: number | string;
  energy: number | string;
  energy_updated_at: string | null;
  star_configs: unknown;
  spiritual_field_energy_cost: number | string;
  spiritual_field_reduce_seconds: number | string;
};

export type SpiritualFieldSeedInput = {
  seedItemId?: unknown;
  outputItemId?: unknown;
  name?: unknown;
  growthSeconds?: unknown;
  minYield?: unknown;
  maxYield?: unknown;
  maxPlotsPerPlayer?: unknown;
  enabled?: unknown;
  dropThemeTags?: unknown;
  secretRealmWeight?: unknown;
};

export type SpiritualFieldSeedView = {
  id: number;
  seedItemId: string;
  outputItemId: string;
  name: string;
  growthSeconds: number;
  minYield: number;
  maxYield: number;
  maxPlotsPerPlayer: number | null;
  enabled: boolean;
  dropThemeTags: string[];
  secretRealmWeight: number;
  seedItemName: string;
  seedItemIconUrl: string | null;
  outputItemName: string;
  outputItemIconUrl: string | null;
  ownedQuantity: number;
};

export type SpiritualFieldPlotView = {
  id: number;
  plotIndex: number;
  status: "empty" | "growing" | "ready" | "harvested";
  seedItemId: string | null;
  outputItemId: string | null;
  seedName: string | null;
  plantedAt: string | null;
  readyAt: string | null;
  harvestedAt: string | null;
  growthSeconds: number;
  minYield: number;
  maxYield: number;
  remainingSeconds: number;
  progressPercent: number;
  seedItemName: string | null;
  seedItemIconUrl: string | null;
  outputItemName: string | null;
  outputItemIconUrl: string | null;
};

export type SpiritualFieldBottleView = {
  itemId: string;
  itemName: string;
  star: number;
  energy: number;
  energyCost: number;
  reduceSeconds: number;
} | null;

export type SpiritualFieldView = {
  plotCount: number;
  seeds: SpiritualFieldSeedView[];
  plots: SpiritualFieldPlotView[];
  bottle: SpiritualFieldBottleView;
};

let ensureSpiritualFieldSchemaPromise: Promise<void> | null = null;

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

function parseDateMs(value: unknown) {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.map((item) => toText(item)).filter(Boolean);
}

function normalizeSeedInput(input: SpiritualFieldSeedInput) {
  const seedItemId = toText(input.seedItemId);
  const outputItemId = toText(input.outputItemId);
  const name = toText(input.name);
  const growthSeconds = Math.max(60, toInt(input.growthSeconds, 6 * 60 * 60));
  const minYield = Math.max(1, toInt(input.minYield, 1));
  const maxYield = Math.max(minYield, toInt(input.maxYield, minYield));
  const maxPlotsPerPlayerRaw = input.maxPlotsPerPlayer === null || input.maxPlotsPerPlayer === ""
    ? null
    : toInt(input.maxPlotsPerPlayer, 0);

  if (!seedItemId) {
    throw new Error("灵种物品 ID 不能为空");
  }
  if (!outputItemId) {
    throw new Error("产物物品 ID 不能为空");
  }
  if (!name) {
    throw new Error("灵种名称不能为空");
  }

  return {
    seedItemId,
    outputItemId,
    name,
    growthSeconds,
    minYield,
    maxYield,
    maxPlotsPerPlayer: maxPlotsPerPlayerRaw && maxPlotsPerPlayerRaw > 0 ? maxPlotsPerPlayerRaw : null,
    enabled: input.enabled !== false,
    dropThemeTags: normalizeTags(input.dropThemeTags),
    secretRealmWeight: Math.max(1, toInt(input.secretRealmWeight, 1)),
  };
}

function buildSeedView(row: SpiritualFieldSeedRow): SpiritualFieldSeedView {
  return {
    id: toInt(row.id, 0),
    seedItemId: toText(row.seed_item_id),
    outputItemId: toText(row.output_item_id),
    name: toText(row.name),
    growthSeconds: Math.max(60, toInt(row.growth_seconds, 60)),
    minYield: Math.max(1, toInt(row.min_yield, 1)),
    maxYield: Math.max(1, toInt(row.max_yield, 1)),
    maxPlotsPerPlayer: row.max_plots_per_player == null ? null : Math.max(1, toInt(row.max_plots_per_player, 1)),
    enabled: row.enabled === true,
    dropThemeTags: normalizeTags(row.drop_theme_tags),
    secretRealmWeight: Math.max(1, toInt(row.secret_realm_weight, 1)),
    seedItemName: toText(row.seed_item_name) || toText(row.name),
    seedItemIconUrl: toText(row.seed_item_icon_url) || null,
    outputItemName: toText(row.output_item_name) || toText(row.output_item_id),
    outputItemIconUrl: toText(row.output_item_icon_url) || null,
    ownedQuantity: Math.max(0, toInt(row.owned_quantity, 0)),
  };
}

function resolvePlotStatus(row: SpiritualFieldPlotRow, nowMs: number): SpiritualFieldPlotView["status"] {
  const storedStatus = toText(row.status);
  if (!row.seed_item_id || storedStatus === "empty") {
    return "empty";
  }
  if (storedStatus === "harvested") {
    return "harvested";
  }
  const readyMs = parseDateMs(row.ready_at);
  if (readyMs > 0 && readyMs <= nowMs) {
    return "ready";
  }
  return "growing";
}

function buildPlotView(row: SpiritualFieldPlotRow, nowMs = Date.now()): SpiritualFieldPlotView {
  const plantedMs = parseDateMs(row.planted_at);
  const readyMs = parseDateMs(row.ready_at);
  const growthSeconds = Math.max(60, toInt(row.growth_seconds, readyMs > plantedMs ? Math.ceil((readyMs - plantedMs) / 1000) : 60));
  const remainingSeconds = readyMs > 0 ? Math.max(0, Math.ceil((readyMs - nowMs) / 1000)) : 0;
  const elapsedSeconds = plantedMs > 0 ? Math.max(0, Math.floor((nowMs - plantedMs) / 1000)) : 0;
  const status = resolvePlotStatus(row, nowMs);

  return {
    id: toInt(row.id, 0),
    plotIndex: Math.max(1, toInt(row.plot_index, 1)),
    status,
    seedItemId: toText(row.seed_item_id) || null,
    outputItemId: toText(row.output_item_id) || null,
    seedName: toText(row.seed_name) || null,
    plantedAt: toText(row.planted_at) || null,
    readyAt: toText(row.ready_at) || null,
    harvestedAt: toText(row.harvested_at) || null,
    growthSeconds,
    minYield: Math.max(1, toInt(row.min_yield, 1)),
    maxYield: Math.max(1, toInt(row.max_yield, 1)),
    remainingSeconds,
    progressPercent: status === "empty" || status === "harvested"
      ? 0
      : Math.max(0, Math.min(100, Math.floor((elapsedSeconds / Math.max(1, growthSeconds)) * 100))),
    seedItemName: toText(row.seed_item_name) || null,
    seedItemIconUrl: toText(row.seed_item_icon_url) || null,
    outputItemName: toText(row.output_item_name) || null,
    outputItemIconUrl: toText(row.output_item_icon_url) || null,
  };
}

function normalizeStarConfigs(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is { star: number; energyCap: number; regenSecondsPerEnergy: number } => (
      item !== null && typeof item === "object"
    ))
    : [];
}

function resolveBottleStarConfig(starConfigs: unknown, star: number) {
  const configs = normalizeStarConfigs(starConfigs);
  const matched = configs.find((item) => Number(item.star) === star);
  return {
    energyCap: Math.max(1, toInt(matched?.energyCap, 200)),
    regenSecondsPerEnergy: Math.max(1, toInt(matched?.regenSecondsPerEnergy, 8 * 60)),
  };
}

async function ensureOfflinePackItems(executor: SqlExecutor = db) {
  const pack = getFourRealmsPack();
  const spiritualItemIds = new Set<string>();
  for (const seed of pack.spiritualFieldSeeds) {
    spiritualItemIds.add(seed.seedItemId);
    spiritualItemIds.add(seed.outputItemId);
  }
  for (const config of pack.hongmengTreasureConfigs) {
    spiritualItemIds.add(config.itemId);
  }

  for (const item of pack.items.filter((row) => spiritualItemIds.has(row.id))) {
    await executor.execute(drizzleSql`
      INSERT INTO "items" (
        "id","name","icon_url","description","item_type","rarity","effects","pill_toxicity","price","stackable","is_bound","min_realm","max_realm","source_type","source_category","created_at"
      )
      VALUES (
        ${item.id},
        ${item.name},
        ${item.iconUrl},
        ${item.description},
        ${item.itemType},
        ${item.rarity},
        ${JSON.stringify(item.effects || [])}::jsonb,
        ${Number(item.pillToxicity || 1)},
        ${Number(item.price || 0)},
        ${item.stackable !== false},
        ${item.isBound === true},
        ${item.minRealm ?? null},
        ${item.maxRealm ?? null},
        'four_realms_pack',
        'spiritual_field',
        NOW()::text
      )
      ON CONFLICT ("id") DO NOTHING
    `);
  }
}

async function seedBuiltinSpiritualFieldConfigs(executor: SqlExecutor = db) {
  const pack = getFourRealmsPack();
  await ensureOfflinePackItems(executor);

  for (const seed of pack.spiritualFieldSeeds) {
    await executor.execute(drizzleSql`
      INSERT INTO "plugin_spiritual_field_seeds" (
        "seed_item_id","output_item_id","name","growth_seconds","min_yield","max_yield","max_plots_per_player","enabled","drop_theme_tags","secret_realm_weight","created_at","updated_at"
      )
      VALUES (
        ${seed.seedItemId},
        ${seed.outputItemId},
        ${seed.name},
        ${seed.growthSeconds},
        ${seed.minYield},
        ${seed.maxYield},
        ${seed.maxPlotsPerPlayer},
        ${seed.enabled},
        ${JSON.stringify(seed.dropThemeTags || [])}::jsonb,
        ${Math.max(1, Number(seed.secretRealmWeight || 1))},
        NOW()::text,
        NOW()::text
      )
      ON CONFLICT ("seed_item_id") DO UPDATE
      SET "output_item_id" = EXCLUDED."output_item_id",
          "name" = EXCLUDED."name",
          "growth_seconds" = EXCLUDED."growth_seconds",
          "min_yield" = EXCLUDED."min_yield",
          "max_yield" = EXCLUDED."max_yield",
          "max_plots_per_player" = EXCLUDED."max_plots_per_player",
          "enabled" = EXCLUDED."enabled",
          "drop_theme_tags" = EXCLUDED."drop_theme_tags",
          "secret_realm_weight" = EXCLUDED."secret_realm_weight",
          "updated_at" = NOW()::text
    `);
  }

  for (const config of pack.hongmengTreasureConfigs) {
    await executor.execute(drizzleSql`
      INSERT INTO "hongmeng_treasure_configs" (
        "item_id","enabled","max_star","star_configs","upgrade_costs","spiritual_field_energy_cost","spiritual_field_reduce_seconds","created_at","updated_at"
      )
      VALUES (
        ${config.itemId},
        ${config.enabled},
        ${config.maxStar},
        ${JSON.stringify(config.starConfigs || [])}::jsonb,
        ${JSON.stringify(config.upgradeCosts || [])}::jsonb,
        ${config.spiritualFieldEnergyCost},
        ${config.spiritualFieldReduceSeconds},
        NOW()::text,
        NOW()::text
      )
      ON CONFLICT ("item_id") DO NOTHING
    `);
  }
}

export async function ensureSpiritualFieldCoreSchema() {
  if (!ensureSpiritualFieldSchemaPromise) {
    ensureSpiritualFieldSchemaPromise = (async () => {
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_spiritual_field_seeds" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "seed_item_id" text NOT NULL UNIQUE,
          "output_item_id" text NOT NULL,
          "name" text NOT NULL,
          "growth_seconds" integer NOT NULL DEFAULT 21600,
          "min_yield" integer NOT NULL DEFAULT 1,
          "max_yield" integer NOT NULL DEFAULT 1,
          "max_plots_per_player" integer,
          "enabled" boolean NOT NULL DEFAULT true,
          "drop_theme_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "secret_realm_weight" integer NOT NULL DEFAULT 1,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_spiritual_field_players" (
          "player_id" text PRIMARY KEY REFERENCES "players"("id") ON DELETE CASCADE,
          "plot_count" integer NOT NULL DEFAULT 3,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "plugin_spiritual_field_plots" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
          "plot_index" integer NOT NULL,
          "status" text NOT NULL DEFAULT 'empty',
          "seed_item_id" text,
          "output_item_id" text,
          "seed_name" text,
          "planted_at" text,
          "ready_at" text,
          "harvested_at" text,
          "growth_seconds" integer,
          "min_yield" integer,
          "max_yield" integer,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text,
          UNIQUE ("player_id","plot_index")
        )
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "plugin_spiritual_field_plots_player_idx"
        ON "plugin_spiritual_field_plots" ("player_id")
      `));
      await db.execute(drizzleSql.raw(`
        CREATE INDEX IF NOT EXISTS "plugin_spiritual_field_plots_seed_idx"
        ON "plugin_spiritual_field_plots" ("seed_item_id")
      `));
      await seedBuiltinSpiritualFieldConfigs();
    })().catch((error) => {
      ensureSpiritualFieldSchemaPromise = null;
      throw error;
    });
  }
  return ensureSpiritualFieldSchemaPromise;
}

async function ensurePlayerFieldRows(playerId: string, executor: SqlExecutor = db) {
  await executor.execute(drizzleSql`
    INSERT INTO "plugin_spiritual_field_players" ("player_id","plot_count","created_at","updated_at")
    VALUES (${playerId},3,NOW()::text,NOW()::text)
    ON CONFLICT ("player_id") DO NOTHING
  `);
  const rows = await executor.execute<SpiritualFieldPlayerRow>(drizzleSql`
    SELECT "player_id","plot_count","updated_at"
    FROM "plugin_spiritual_field_players"
    WHERE "player_id" = ${playerId}
    LIMIT 1
  `);
  const plotCount = Math.max(1, toInt(rows[0]?.plot_count, 3));
  for (let plotIndex = 1; plotIndex <= plotCount; plotIndex += 1) {
    await executor.execute(drizzleSql`
      INSERT INTO "plugin_spiritual_field_plots" ("player_id","plot_index","status","created_at","updated_at")
      VALUES (${playerId},${plotIndex},'empty',NOW()::text,NOW()::text)
      ON CONFLICT ("player_id","plot_index") DO NOTHING
    `);
  }
  return plotCount;
}

export async function listCoreSpiritualFieldSeeds(includeDisabled = false): Promise<SpiritualFieldSeedView[]> {
  await ensureSpiritualFieldCoreSchema();
  const rows = await db.execute<SpiritualFieldSeedRow>(drizzleSql`
    SELECT
      s."id",
      s."seed_item_id",
      s."output_item_id",
      s."name",
      s."growth_seconds",
      s."min_yield",
      s."max_yield",
      s."max_plots_per_player",
      s."enabled",
      COALESCE(s."drop_theme_tags", '[]'::jsonb) AS "drop_theme_tags",
      COALESCE(s."secret_realm_weight", 1) AS "secret_realm_weight",
      seed_item."name" AS "seed_item_name",
      seed_item."icon_url" AS "seed_item_icon_url",
      output_item."name" AS "output_item_name",
      output_item."icon_url" AS "output_item_icon_url",
      0 AS "owned_quantity"
    FROM "plugin_spiritual_field_seeds" s
    LEFT JOIN "items" seed_item ON seed_item."id" = s."seed_item_id"
    LEFT JOIN "items" output_item ON output_item."id" = s."output_item_id"
    ${includeDisabled ? drizzleSql`` : drizzleSql`WHERE s."enabled" = true`}
    ORDER BY s."id" ASC
  `);
  return rows.map(buildSeedView);
}

async function getBottleView(playerId: string): Promise<SpiritualFieldBottleView> {
  const rows = await db.execute<BottleRow>(drizzleSql`
    SELECT
      c."item_id",
      i."name" AS "item_name",
      COALESCE(t."star", 0) AS "star",
      COALESCE(t."energy", 0) AS "energy",
      t."energy_updated_at",
      c."star_configs",
      c."spiritual_field_energy_cost",
      c."spiritual_field_reduce_seconds"
    FROM "hongmeng_treasure_configs" c
    INNER JOIN "items" i ON i."id" = c."item_id"
    INNER JOIN "player_inventory" inv
      ON inv."item_id" = c."item_id"
     AND inv."player_id" = ${playerId}
     AND inv."quantity" > 0
    LEFT JOIN "player_hongmeng_treasures" t
      ON t."item_id" = c."item_id"
     AND t."player_id" = ${playerId}
    WHERE c."enabled" = true
    ORDER BY c."item_id" ASC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const star = Math.max(0, toInt(row.star, 0));
  const config = resolveBottleStarConfig(row.star_configs, star);
  const recovered = recoverHongmengTreasureEnergySnapshot({
    energy: row.energy_updated_at ? toInt(row.energy, 0) : config.energyCap,
    energyUpdatedAt: row.energy_updated_at,
    energyCap: config.energyCap,
    regenSecondsPerEnergy: config.regenSecondsPerEnergy,
  });
  return {
    itemId: row.item_id,
    itemName: row.item_name,
    star,
    energy: recovered.energy,
    energyCost: Math.max(1, toInt(row.spiritual_field_energy_cost, 60)),
    reduceSeconds: Math.max(60, toInt(row.spiritual_field_reduce_seconds, 3600)),
  };
}

export async function getPlayerSpiritualFieldView(playerId: string): Promise<SpiritualFieldView> {
  await ensureSpiritualFieldCoreSchema();
  const plotCount = await ensurePlayerFieldRows(playerId);
  const [seedRows, plotRows, bottle] = await Promise.all([
    db.execute<SpiritualFieldSeedRow>(drizzleSql`
      SELECT
        s."id",
        s."seed_item_id",
        s."output_item_id",
        s."name",
        s."growth_seconds",
        s."min_yield",
        s."max_yield",
        s."max_plots_per_player",
        s."enabled",
        COALESCE(s."drop_theme_tags", '[]'::jsonb) AS "drop_theme_tags",
        COALESCE(s."secret_realm_weight", 1) AS "secret_realm_weight",
        seed_item."name" AS "seed_item_name",
        seed_item."icon_url" AS "seed_item_icon_url",
        output_item."name" AS "output_item_name",
        output_item."icon_url" AS "output_item_icon_url",
        COALESCE(inv."quantity", 0) AS "owned_quantity"
      FROM "plugin_spiritual_field_seeds" s
      LEFT JOIN "items" seed_item ON seed_item."id" = s."seed_item_id"
      LEFT JOIN "items" output_item ON output_item."id" = s."output_item_id"
      LEFT JOIN "player_inventory" inv
        ON inv."item_id" = s."seed_item_id"
       AND inv."player_id" = ${playerId}
      WHERE s."enabled" = true
      ORDER BY s."id" ASC
    `),
    db.execute<SpiritualFieldPlotRow>(drizzleSql`
      SELECT
        p."id",
        p."player_id",
        p."plot_index",
        p."status",
        p."seed_item_id",
        p."output_item_id",
        p."seed_name",
        p."planted_at",
        p."ready_at",
        p."harvested_at",
        p."growth_seconds",
        p."min_yield",
        p."max_yield",
        p."updated_at",
        seed_item."name" AS "seed_item_name",
        seed_item."icon_url" AS "seed_item_icon_url",
        output_item."name" AS "output_item_name",
        output_item."icon_url" AS "output_item_icon_url"
      FROM "plugin_spiritual_field_plots" p
      LEFT JOIN "items" seed_item ON seed_item."id" = p."seed_item_id"
      LEFT JOIN "items" output_item ON output_item."id" = p."output_item_id"
      WHERE p."player_id" = ${playerId}
      ORDER BY p."plot_index" ASC
    `),
    getBottleView(playerId),
  ]);
  const nowMs = Date.now();

  return {
    plotCount,
    seeds: seedRows.map(buildSeedView),
    plots: plotRows.map((row) => buildPlotView(row, nowMs)),
    bottle,
  };
}

export async function plantSpiritualFieldSeed(params: {
  playerId: string;
  plotId: number;
  seedItemId: string;
}) {
  await ensureSpiritualFieldCoreSchema();
  const seedItemId = toText(params.seedItemId);
  if (!seedItemId) {
    throw new Error("请选择灵种");
  }
  if (params.plotId < 1) {
    throw new Error("灵田地块非法");
  }

  await db.transaction(async (tx) => {
    await ensurePlayerFieldRows(params.playerId, tx);
    const [plotRows, seedRows, invRows] = await Promise.all([
      tx.execute<SpiritualFieldPlotRow>(drizzleSql`
        SELECT *
        FROM "plugin_spiritual_field_plots"
        WHERE "id" = ${params.plotId} AND "player_id" = ${params.playerId}
        FOR UPDATE
      `),
      tx.execute<SpiritualFieldSeedRow>(drizzleSql`
        SELECT
          s.*,
          seed_item."name" AS "seed_item_name",
          seed_item."icon_url" AS "seed_item_icon_url",
          output_item."name" AS "output_item_name",
          output_item."icon_url" AS "output_item_icon_url",
          0 AS "owned_quantity"
        FROM "plugin_spiritual_field_seeds" s
        LEFT JOIN "items" seed_item ON seed_item."id" = s."seed_item_id"
        LEFT JOIN "items" output_item ON output_item."id" = s."output_item_id"
        WHERE s."seed_item_id" = ${seedItemId} AND s."enabled" = true
        LIMIT 1
      `),
      tx.execute<InventoryQuantityRow>(drizzleSql`
        SELECT "quantity"
        FROM "player_inventory"
        WHERE "player_id" = ${params.playerId} AND "item_id" = ${seedItemId}
        FOR UPDATE
      `),
    ]);

    const plot = plotRows[0];
    if (!plot) {
      throw new Error("灵田地块不存在");
    }
    const plotStatus = resolvePlotStatus(plot, Date.now());
    if (plotStatus !== "empty" && plotStatus !== "harvested") {
      throw new Error("该地块已有灵植正在生长");
    }

    const seed = seedRows[0];
    if (!seed) {
      throw new Error("灵种不存在或未启用");
    }
    const owned = Math.max(0, toInt(invRows[0]?.quantity, 0));
    if (owned < 1) {
      throw new Error("背包中没有该灵种");
    }

    const nextOwned = owned - 1;
    if (nextOwned <= 0) {
      await tx.execute(drizzleSql`
        DELETE FROM "player_inventory"
        WHERE "player_id" = ${params.playerId} AND "item_id" = ${seedItemId}
      `);
    } else {
      await tx.execute(drizzleSql`
        UPDATE "player_inventory"
        SET "quantity" = ${nextOwned}
        WHERE "player_id" = ${params.playerId} AND "item_id" = ${seedItemId}
      `);
    }

    const now = new Date();
    const growthSeconds = Math.max(60, toInt(seed.growth_seconds, 60));
    const readyAt = new Date(now.getTime() + growthSeconds * 1000).toISOString();
    await tx.execute(drizzleSql`
      UPDATE "plugin_spiritual_field_plots"
      SET "status" = 'growing',
          "seed_item_id" = ${seed.seed_item_id},
          "output_item_id" = ${seed.output_item_id},
          "seed_name" = ${seed.name},
          "planted_at" = ${now.toISOString()},
          "ready_at" = ${readyAt},
          "harvested_at" = NULL,
          "growth_seconds" = ${growthSeconds},
          "min_yield" = ${Math.max(1, toInt(seed.min_yield, 1))},
          "max_yield" = ${Math.max(1, toInt(seed.max_yield, 1))},
          "updated_at" = ${now.toISOString()}
      WHERE "id" = ${params.plotId} AND "player_id" = ${params.playerId}
    `);
  });

  return getPlayerSpiritualFieldView(params.playerId);
}

export async function harvestSpiritualFieldPlot(params: {
  playerId: string;
  plotId: number;
}) {
  await ensureSpiritualFieldCoreSchema();
  if (params.plotId < 1) {
    throw new Error("灵田地块非法");
  }

  await db.transaction(async (tx) => {
    const plotRows = await tx.execute<SpiritualFieldPlotRow>(drizzleSql`
      SELECT *
      FROM "plugin_spiritual_field_plots"
      WHERE "id" = ${params.plotId} AND "player_id" = ${params.playerId}
      FOR UPDATE
    `);
    const plot = plotRows[0];
    if (!plot || !plot.seed_item_id || !plot.output_item_id) {
      throw new Error("该地块没有可收获灵植");
    }
    const status = resolvePlotStatus(plot, Date.now());
    if (status !== "ready") {
      throw new Error("灵植尚未成熟");
    }

    const minYield = Math.max(1, toInt(plot.min_yield, 1));
    const maxYield = Math.max(minYield, toInt(plot.max_yield, minYield));
    const quantity = minYield + Math.floor(Math.random() * (maxYield - minYield + 1));
    await grantRewardToPlayer({
      tx,
      playerId: params.playerId,
      reward: {
        items: [{ itemId: plot.output_item_id, quantity }],
      },
    });

    const nowIso = new Date().toISOString();
    await tx.execute(drizzleSql`
      UPDATE "plugin_spiritual_field_plots"
      SET "status" = 'harvested',
          "harvested_at" = ${nowIso},
          "updated_at" = ${nowIso}
      WHERE "id" = ${params.plotId} AND "player_id" = ${params.playerId}
    `);
  });

  return getPlayerSpiritualFieldView(params.playerId);
}

export async function accelerateSpiritualFieldPlot(params: {
  playerId: string;
  plotId: number;
}) {
  await ensureSpiritualFieldCoreSchema();
  if (params.plotId < 1) {
    throw new Error("灵田地块非法");
  }

  await db.transaction(async (tx) => {
    const plotRows = await tx.execute<SpiritualFieldPlotRow>(drizzleSql`
      SELECT *
      FROM "plugin_spiritual_field_plots"
      WHERE "id" = ${params.plotId} AND "player_id" = ${params.playerId}
      FOR UPDATE
    `);
    const plot = plotRows[0];
    if (!plot || !plot.seed_item_id) {
      throw new Error("该地块没有可加速灵植");
    }
    const status = resolvePlotStatus(plot, Date.now());
    if (status !== "growing") {
      throw new Error("只有生长中的灵植可以加速");
    }

    const bottleRows = await tx.execute<BottleRow>(drizzleSql`
      SELECT
        c."item_id",
        i."name" AS "item_name",
        COALESCE(t."star", 0) AS "star",
        COALESCE(t."energy", 0) AS "energy",
        t."energy_updated_at",
        c."star_configs",
        c."spiritual_field_energy_cost",
        c."spiritual_field_reduce_seconds"
      FROM "hongmeng_treasure_configs" c
      INNER JOIN "items" i ON i."id" = c."item_id"
      INNER JOIN "player_inventory" inv
        ON inv."item_id" = c."item_id"
       AND inv."player_id" = ${params.playerId}
       AND inv."quantity" > 0
      LEFT JOIN "player_hongmeng_treasures" t
        ON t."item_id" = c."item_id"
       AND t."player_id" = ${params.playerId}
      WHERE c."enabled" = true
      ORDER BY c."item_id" ASC
      LIMIT 1
    `);
    const bottle = bottleRows[0];
    if (!bottle) {
      throw new Error("未持有可用于灵田加速的鸿蒙至宝");
    }

    const star = Math.max(0, toInt(bottle.star, 0));
    const starConfig = resolveBottleStarConfig(bottle.star_configs, star);
    const recovered = recoverHongmengTreasureEnergySnapshot({
      energy: bottle.energy_updated_at ? toInt(bottle.energy, 0) : starConfig.energyCap,
      energyUpdatedAt: bottle.energy_updated_at,
      energyCap: starConfig.energyCap,
      regenSecondsPerEnergy: starConfig.regenSecondsPerEnergy,
    });
    const cost = Math.max(1, toInt(bottle.spiritual_field_energy_cost, 60));
    if (recovered.energy < cost) {
      throw new Error(`至宝能量不足，需要 ${cost} 点`);
    }

    await tx.execute(drizzleSql`
      INSERT INTO "player_hongmeng_treasures" (
        "player_id","item_id","star","energy","energy_updated_at","created_at","updated_at"
      )
      VALUES (
        ${params.playerId},${bottle.item_id},${star},${recovered.energy - cost},${recovered.energyUpdatedAt},NOW()::text,NOW()::text
      )
      ON CONFLICT ("player_id","item_id") DO UPDATE
      SET "energy" = ${recovered.energy - cost},
          "energy_updated_at" = ${recovered.energyUpdatedAt},
          "updated_at" = NOW()::text
    `);

    const readyMs = parseDateMs(plot.ready_at);
    const reduceSeconds = Math.max(60, toInt(bottle.spiritual_field_reduce_seconds, 3600));
    const nextReadyAt = new Date(Math.max(Date.now(), readyMs - reduceSeconds * 1000)).toISOString();
    await tx.execute(drizzleSql`
      UPDATE "plugin_spiritual_field_plots"
      SET "ready_at" = ${nextReadyAt}, "updated_at" = NOW()::text
      WHERE "id" = ${params.plotId} AND "player_id" = ${params.playerId}
    `);
  });

  return getPlayerSpiritualFieldView(params.playerId);
}

export async function upsertCoreSpiritualFieldSeed(input: SpiritualFieldSeedInput) {
  await ensureSpiritualFieldCoreSchema();
  const normalized = normalizeSeedInput(input);
  await db.execute(drizzleSql`
    INSERT INTO "plugin_spiritual_field_seeds" (
      "seed_item_id","output_item_id","name","growth_seconds","min_yield","max_yield","max_plots_per_player","enabled","drop_theme_tags","secret_realm_weight","created_at","updated_at"
    )
    VALUES (
      ${normalized.seedItemId},
      ${normalized.outputItemId},
      ${normalized.name},
      ${normalized.growthSeconds},
      ${normalized.minYield},
      ${normalized.maxYield},
      ${normalized.maxPlotsPerPlayer},
      ${normalized.enabled},
      ${JSON.stringify(normalized.dropThemeTags)}::jsonb,
      ${normalized.secretRealmWeight},
      NOW()::text,
      NOW()::text
    )
    ON CONFLICT ("seed_item_id") DO UPDATE
    SET "output_item_id" = EXCLUDED."output_item_id",
        "name" = EXCLUDED."name",
        "growth_seconds" = EXCLUDED."growth_seconds",
        "min_yield" = EXCLUDED."min_yield",
        "max_yield" = EXCLUDED."max_yield",
        "max_plots_per_player" = EXCLUDED."max_plots_per_player",
        "enabled" = EXCLUDED."enabled",
        "drop_theme_tags" = EXCLUDED."drop_theme_tags",
        "secret_realm_weight" = EXCLUDED."secret_realm_weight",
        "updated_at" = NOW()::text
  `);
  return listCoreSpiritualFieldSeeds(true);
}
