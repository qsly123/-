import { eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { getFourRealmsPack } from "@/db/offline-packs/four-realms-pack";
import { getRealmLabels } from "@/modules/character/services/realm-position";
import { items, players } from "@/db/schema";
import {
  getSmithingSpecBonus,
  grantSmithingSpecExp,
  rollUpgradedItemId,
  smithingSpecKeyForItemType,
  tuneEquipmentInstance,
} from "@/modules/character/services/equipment-instance-service";
import { grantRewardToPlayer } from "@/modules/character/services/reward-service";

type SqlExecutor = Pick<typeof db, "execute">;

type SmithingRecipeRow = {
  id: number | string;
  recipe_code: string | null;
  result_item_id: string;
  result_item_name: string | null;
  result_quantity: number | string;
  main_item_id: string;
  main_item_name: string | null;
  main_quantity: number | string;
  base_success_rate: number | string;
  aux_a_item_id: string | null;
  aux_a_item_name: string | null;
  aux_a_quantity: number | string | null;
  aux_a_bonus_rate: number | string | null;
  aux_b_item_id: string | null;
  aux_b_item_name: string | null;
  aux_b_quantity: number | string | null;
  aux_b_bonus_rate: number | string | null;
  aux_c_item_id: string | null;
  aux_c_item_name: string | null;
  aux_c_quantity: number | string | null;
  aux_c_bonus_rate: number | string | null;
  enabled: boolean;
  sort_order: number | string | null;
  result_item_icon_url?: string | null;
  result_item_type?: string | null;
  main_owned_quantity?: number | string | null;
  aux_a_owned_quantity?: number | string | null;
  aux_b_owned_quantity?: number | string | null;
  aux_c_owned_quantity?: number | string | null;
  result_min_realm?: number | string | null;
  material_min_realm?: number | string | null;
};

type SmithingLogRow = {
  success: boolean;
  created_at: string;
};

type InventoryQuantityRow = {
  quantity: number | string;
};

export type SmithingIngredientView = {
  itemId: string;
  itemName: string;
  quantity: number;
  ownedQuantity: number;
  enough: boolean;
  bonusRate: number;
  role: "main" | "auxA" | "auxB" | "auxC";
};

export type SmithingRecipeView = {
  id: string;
  resultItemId: string;
  resultItemName: string;
  resultItemIconUrl: string | null;
  resultItemType: string;
  resultQuantity: number;
  baseSuccessRate: number;
  currentSuccessRate: number;
  pityBonusRate: number;
  failureStreak: number;
  enabled: boolean;
  ingredients: SmithingIngredientView[];
  canCraft: boolean;
  /** 产物穿戴所需境界（null = 不限）。做出来穿不上时要提前告诉玩家。 */
  requiredRealm: number | null;
  /** 材料里门槛最高的那个境界（0 = 无门槛） */
  materialRequiredRealm: number;
  /** 上面两个境界的名称（「元婴初期」），直接给 UI 用，省得前端再算 */
  requiredRealmName: string | null;
  materialRequiredRealmName: string | null;
};

export type SmithingView = {
  playerRealm: number;
  playerRealmName: string;
  recipes: SmithingRecipeView[];
  recentLogs: Array<{
    recipeId: string;
    resultItemName: string;
    success: boolean;
    finalSuccessRate: number;
    createdAt: string;
  }>;
};

export type SmithingRecipeInput = {
  recipeCode?: unknown;
  resultItemId?: unknown;
  resultQuantity?: unknown;
  mainItemId?: unknown;
  mainQuantity?: unknown;
  baseSuccessRate?: unknown;
  auxAItemId?: unknown;
  auxAQuantity?: unknown;
  auxABonusRate?: unknown;
  auxBItemId?: unknown;
  auxBQuantity?: unknown;
  auxBBonusRate?: unknown;
  auxCItemId?: unknown;
  auxCQuantity?: unknown;
  auxCBonusRate?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
};

const SMITHING_PITY_STEP = 0.025;
const SMITHING_PITY_MAX = 0.15;
let ensureSmithingSchemaPromise: Promise<void> | null = null;

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

function clampRate(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(0.98, toNumber(value, fallback)));
}

function normalizeRecipeInput(input: SmithingRecipeInput) {
  const recipeCode = toText(input.recipeCode);
  const resultItemId = toText(input.resultItemId);
  const mainItemId = toText(input.mainItemId);
  if (!recipeCode) {
    throw new Error("配方编码不能为空");
  }
  if (!resultItemId) {
    throw new Error("产物物品 ID 不能为空");
  }
  if (!mainItemId) {
    throw new Error("主材料物品 ID 不能为空");
  }
  return {
    recipeCode,
    resultItemId,
    resultQuantity: Math.max(1, toInt(input.resultQuantity, 1)),
    mainItemId,
    mainQuantity: Math.max(1, toInt(input.mainQuantity, 1)),
    baseSuccessRate: clampRate(input.baseSuccessRate, 0.6),
    auxAItemId: toText(input.auxAItemId) || null,
    auxAQuantity: Math.max(0, toInt(input.auxAQuantity, 0)),
    auxABonusRate: clampRate(input.auxABonusRate, 0),
    auxBItemId: toText(input.auxBItemId) || null,
    auxBQuantity: Math.max(0, toInt(input.auxBQuantity, 0)),
    auxBBonusRate: clampRate(input.auxBBonusRate, 0),
    auxCItemId: toText(input.auxCItemId) || null,
    auxCQuantity: Math.max(0, toInt(input.auxCQuantity, 0)),
    auxCBonusRate: clampRate(input.auxCBonusRate, 0),
    enabled: input.enabled !== false,
    sortOrder: toInt(input.sortOrder, 0),
  };
}

async function ensureOfflinePackSmithingItems(executor: SqlExecutor = db) {
  const pack = getFourRealmsPack();
  const itemIds = new Set<string>();
  for (const recipe of pack.smithingRecipes) {
    itemIds.add(recipe.resultItemId);
    itemIds.add(recipe.mainItemId);
    if (recipe.auxAItemId) itemIds.add(recipe.auxAItemId);
    if (recipe.auxBItemId) itemIds.add(recipe.auxBItemId);
    if (recipe.auxCItemId) itemIds.add(recipe.auxCItemId);
  }

  for (const item of pack.items.filter((row) => itemIds.has(row.id))) {
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
        ${Number(item.pillToxicity || 0)},
        ${Number(item.price || 0)},
        ${item.stackable !== false},
        ${item.isBound === true},
        ${item.minRealm ?? null},
        ${item.maxRealm ?? null},
        'four_realms_pack',
        'smithing',
        NOW()::text
      )
      ON CONFLICT ("id") DO NOTHING
    `);
  }
}

async function seedBuiltinSmithingRecipes(executor: SqlExecutor = db) {
  await ensureOfflinePackSmithingItems(executor);
  const itemNameMap = new Map(getFourRealmsPack().items.map((item) => [item.id, item.name]));
  let sortOrder = 0;
  for (const recipe of getFourRealmsPack().smithingRecipes) {
    sortOrder += 10;
    await executor.execute(drizzleSql`
      INSERT INTO "smithing_recipes" (
        "recipe_code",
        "result_item_id","result_item_name","result_quantity",
        "main_item_id","main_item_name","main_quantity",
        "base_success_rate",
        "aux_a_item_id","aux_a_item_name","aux_a_quantity","aux_a_bonus_rate",
        "aux_b_item_id","aux_b_item_name","aux_b_quantity","aux_b_bonus_rate",
        "aux_c_item_id","aux_c_item_name","aux_c_quantity","aux_c_bonus_rate",
        "enabled","sort_order","created_at","updated_at"
      )
      SELECT
        ${recipe.id},
        ${recipe.resultItemId},${itemNameMap.get(recipe.resultItemId) || recipe.resultItemId},${recipe.resultQuantity},
        ${recipe.mainItemId},${itemNameMap.get(recipe.mainItemId) || recipe.mainItemId},${recipe.mainQuantity},
        ${recipe.baseSuccessRate},
        ${recipe.auxAItemId ?? null},${recipe.auxAItemId ? itemNameMap.get(recipe.auxAItemId) || recipe.auxAItemId : ""},${recipe.auxAQuantity ?? 0},${recipe.auxABonusRate ?? 0},
        ${recipe.auxBItemId ?? null},${recipe.auxBItemId ? itemNameMap.get(recipe.auxBItemId) || recipe.auxBItemId : ""},${recipe.auxBQuantity ?? 0},${recipe.auxBBonusRate ?? 0},
        ${recipe.auxCItemId ?? null},${recipe.auxCItemId ? itemNameMap.get(recipe.auxCItemId) || recipe.auxCItemId : ""},${recipe.auxCQuantity ?? 0},${recipe.auxCBonusRate ?? 0},
        true,${sortOrder},NOW()::text,NOW()::text
      WHERE NOT EXISTS (
        SELECT 1 FROM "smithing_recipes" WHERE "recipe_code" = ${recipe.id}
      )
    `);
  }
}

export async function ensureSmithingCoreSchema() {
  if (!ensureSmithingSchemaPromise) {
    ensureSmithingSchemaPromise = (async () => {
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "smithing_recipes" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "recipe_code" text,
          "result_item_id" text NOT NULL,
          "result_item_name" text NOT NULL DEFAULT '',
          "result_quantity" integer NOT NULL DEFAULT 1,
          "main_item_id" text NOT NULL,
          "main_item_name" text NOT NULL DEFAULT '',
          "main_quantity" integer NOT NULL DEFAULT 1,
          "base_success_rate" real NOT NULL DEFAULT 0.6,
          "aux_a_item_id" text,
          "aux_a_item_name" text NOT NULL DEFAULT '',
          "aux_a_quantity" integer NOT NULL DEFAULT 0,
          "aux_a_bonus_rate" real NOT NULL DEFAULT 0,
          "aux_b_item_id" text,
          "aux_b_item_name" text NOT NULL DEFAULT '',
          "aux_b_quantity" integer NOT NULL DEFAULT 0,
          "aux_b_bonus_rate" real NOT NULL DEFAULT 0,
          "aux_c_item_id" text,
          "aux_c_item_name" text NOT NULL DEFAULT '',
          "aux_c_quantity" integer NOT NULL DEFAULT 0,
          "aux_c_bonus_rate" real NOT NULL DEFAULT 0,
          "enabled" boolean NOT NULL DEFAULT true,
          "sort_order" integer NOT NULL DEFAULT 0,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "recipe_code" text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "result_item_id" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "result_item_name" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "result_quantity" integer NOT NULL DEFAULT 1`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "main_item_id" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "main_item_name" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "main_quantity" integer NOT NULL DEFAULT 1`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "base_success_rate" real NOT NULL DEFAULT 0.6`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_a_item_id" text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_a_item_name" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_a_quantity" integer NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_a_bonus_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_b_item_id" text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_b_item_name" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_b_quantity" integer NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_b_bonus_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_c_item_id" text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_c_item_name" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_c_quantity" integer NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "aux_c_bonus_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "created_at" text NOT NULL DEFAULT NOW()::text`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "smithing_recipes" ADD COLUMN IF NOT EXISTS "updated_at" text NOT NULL DEFAULT NOW()::text`));
      await db.execute(drizzleSql.raw(`CREATE INDEX IF NOT EXISTS "smithing_recipes_recipe_code_idx" ON "smithing_recipes" ("recipe_code")`));
      await db.execute(drizzleSql.raw(`
        CREATE TABLE IF NOT EXISTS "player_smithing_logs" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
          "recipe_id" text NOT NULL,
          "result_item_id" text NOT NULL,
          "result_item_name" text NOT NULL DEFAULT '',
          "success" boolean NOT NULL DEFAULT false,
          "base_success_rate" real NOT NULL DEFAULT 0,
          "bonus_success_rate" real NOT NULL DEFAULT 0,
          "pity_bonus_rate" real NOT NULL DEFAULT 0,
          "final_success_rate" real NOT NULL DEFAULT 0,
          "roll" real NOT NULL DEFAULT 0,
          "created_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "recipe_id" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "result_item_id" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "result_item_name" text NOT NULL DEFAULT ''`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "success" boolean NOT NULL DEFAULT false`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "base_success_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "bonus_success_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "pity_bonus_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "final_success_rate" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "roll" real NOT NULL DEFAULT 0`));
      await db.execute(drizzleSql.raw(`ALTER TABLE IF EXISTS "player_smithing_logs" ADD COLUMN IF NOT EXISTS "created_at" text NOT NULL DEFAULT NOW()::text`));
      await db.execute(drizzleSql.raw(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'player_smithing_logs' AND column_name = 'item_name'
          ) THEN
            UPDATE "player_smithing_logs"
            SET
              "recipe_id" = CASE WHEN "recipe_id" = '' THEN 'legacy:' || "id"::text ELSE "recipe_id" END,
              "result_item_name" = CASE WHEN "result_item_name" = '' THEN COALESCE("item_name", '') ELSE "result_item_name" END
            WHERE "recipe_id" = '' OR "result_item_name" = '';
          ELSE
            UPDATE "player_smithing_logs"
            SET "recipe_id" = CASE WHEN "recipe_id" = '' THEN 'legacy:' || "id"::text ELSE "recipe_id" END
            WHERE "recipe_id" = '';
          END IF;
        END $$;
      `));
      await db.execute(drizzleSql.raw(`CREATE INDEX IF NOT EXISTS "player_smithing_logs_player_recipe_idx" ON "player_smithing_logs" ("player_id", "recipe_id", "created_at")`));
      await seedBuiltinSmithingRecipes();
    })().catch((error) => {
      ensureSmithingSchemaPromise = null;
      throw error;
    });
  }
  return ensureSmithingSchemaPromise;
}

function buildIngredient(params: {
  itemId: string | null;
  itemName: string | null;
  quantity: unknown;
  ownedQuantity: unknown;
  bonusRate: unknown;
  role: SmithingIngredientView["role"];
}): SmithingIngredientView | null {
  const itemId = toText(params.itemId);
  const quantity = Math.max(0, toInt(params.quantity, 0));
  if (!itemId || quantity <= 0) {
    return null;
  }
  const ownedQuantity = Math.max(0, toInt(params.ownedQuantity, 0));
  return {
    itemId,
    itemName: toText(params.itemName) || itemId,
    quantity,
    ownedQuantity,
    enough: ownedQuantity >= quantity,
    bonusRate: clampRate(params.bonusRate, 0),
    role: params.role,
  };
}

function computeFailureStreak(logs: SmithingLogRow[]) {
  let count = 0;
  for (const log of logs) {
    if (log.success === true) {
      break;
    }
    count += 1;
  }
  return count;
}

function buildRecipeView(row: SmithingRecipeRow, failureStreak: number): SmithingRecipeView {
  const ingredients = [
    buildIngredient({ itemId: row.main_item_id, itemName: row.main_item_name, quantity: row.main_quantity, ownedQuantity: row.main_owned_quantity, bonusRate: 0, role: "main" }),
    buildIngredient({ itemId: row.aux_a_item_id, itemName: row.aux_a_item_name, quantity: row.aux_a_quantity, ownedQuantity: row.aux_a_owned_quantity, bonusRate: row.aux_a_bonus_rate, role: "auxA" }),
    buildIngredient({ itemId: row.aux_b_item_id, itemName: row.aux_b_item_name, quantity: row.aux_b_quantity, ownedQuantity: row.aux_b_owned_quantity, bonusRate: row.aux_b_bonus_rate, role: "auxB" }),
    buildIngredient({ itemId: row.aux_c_item_id, itemName: row.aux_c_item_name, quantity: row.aux_c_quantity, ownedQuantity: row.aux_c_owned_quantity, bonusRate: row.aux_c_bonus_rate, role: "auxC" }),
  ].filter((item): item is SmithingIngredientView => Boolean(item));
  const baseSuccessRate = clampRate(row.base_success_rate, 0);
  const ingredientBonus = ingredients.reduce((sum, item) => sum + (item.enough ? item.bonusRate : 0), 0);
  const pityBonusRate = Math.min(SMITHING_PITY_MAX, failureStreak * SMITHING_PITY_STEP);
  const currentSuccessRate = Math.min(0.98, baseSuccessRate + ingredientBonus + pityBonusRate);
  return {
    id: toText(row.recipe_code) || String(row.id),
    resultItemId: toText(row.result_item_id),
    resultItemName: toText(row.result_item_name) || toText(row.result_item_id),
    resultItemIconUrl: toText(row.result_item_icon_url) || null,
    resultItemType: toText(row.result_item_type) || "equipment",
    resultQuantity: Math.max(1, toInt(row.result_quantity, 1)),
    baseSuccessRate,
    currentSuccessRate,
    pityBonusRate,
    failureStreak,
    enabled: row.enabled === true,
    ingredients,
    canCraft: ingredients.length > 0 && ingredients.every((item) => item.enough),
    requiredRealm: row.result_min_realm === null || row.result_min_realm === undefined
      ? null
      : Math.max(0, toInt(row.result_min_realm, 0)),
    materialRequiredRealm: Math.max(0, toInt(row.material_min_realm, 0)),
    // 名称由 getPlayerSmithingView 批量填；后台列表用不到，给 null
    requiredRealmName: null,
    materialRequiredRealmName: null,
  };
}

async function selectRecipeRows(playerId: string, includeDisabled = false) {
  return db.execute<SmithingRecipeRow>(drizzleSql`
    SELECT
      r.*,
      result_item."icon_url" AS "result_item_icon_url",
      result_item."item_type" AS "result_item_type",
      COALESCE(main_inv."quantity", 0) AS "main_owned_quantity",
      COALESCE(aux_a_inv."quantity", 0) AS "aux_a_owned_quantity",
      COALESCE(aux_b_inv."quantity", 0) AS "aux_b_owned_quantity",
      COALESCE(aux_c_inv."quantity", 0) AS "aux_c_owned_quantity",
      result_item."min_realm" AS "result_min_realm",
      GREATEST(
        COALESCE(main_item."min_realm", 0),
        COALESCE(aux_a_item."min_realm", 0),
        COALESCE(aux_b_item."min_realm", 0),
        COALESCE(aux_c_item."min_realm", 0)
      ) AS "material_min_realm"
    FROM "smithing_recipes" r
    LEFT JOIN "items" result_item ON result_item."id" = r."result_item_id"
    LEFT JOIN "items" main_item ON main_item."id" = r."main_item_id"
    LEFT JOIN "items" aux_a_item ON aux_a_item."id" = r."aux_a_item_id"
    LEFT JOIN "items" aux_b_item ON aux_b_item."id" = r."aux_b_item_id"
    LEFT JOIN "items" aux_c_item ON aux_c_item."id" = r."aux_c_item_id"
    LEFT JOIN "player_inventory" main_inv ON main_inv."player_id" = ${playerId} AND main_inv."item_id" = r."main_item_id"
    LEFT JOIN "player_inventory" aux_a_inv ON aux_a_inv."player_id" = ${playerId} AND aux_a_inv."item_id" = r."aux_a_item_id"
    LEFT JOIN "player_inventory" aux_b_inv ON aux_b_inv."player_id" = ${playerId} AND aux_b_inv."item_id" = r."aux_b_item_id"
    LEFT JOIN "player_inventory" aux_c_inv ON aux_c_inv."player_id" = ${playerId} AND aux_c_inv."item_id" = r."aux_c_item_id"
    ${includeDisabled ? drizzleSql`` : drizzleSql`WHERE r."enabled" = true`}
    ORDER BY r."sort_order" ASC, r."id" ASC
  `);
}

async function getFailureStreakMap(playerId: string, recipeIds: string[]) {
  const map = new Map<string, number>();
  for (const recipeId of recipeIds) {
    const logs = await db.execute<SmithingLogRow>(drizzleSql`
      SELECT "success","created_at"
      FROM "player_smithing_logs"
      WHERE "player_id" = ${playerId} AND "recipe_id" = ${recipeId}
      ORDER BY "id" DESC
      LIMIT 10
    `);
    map.set(recipeId, computeFailureStreak(logs));
  }
  return map;
}

async function getRecentLogs(playerId: string) {
  return db.execute<{
    recipe_id: string;
    result_item_name: string;
    success: boolean;
    final_success_rate: number | string;
    created_at: string;
  }>(drizzleSql`
    SELECT "recipe_id","result_item_name","success","final_success_rate","created_at"
    FROM "player_smithing_logs"
    WHERE "player_id" = ${playerId}
    ORDER BY "id" DESC
    LIMIT 12
  `);
}

export async function getPlayerSmithingView(playerId: string): Promise<SmithingView> {
  await ensureSmithingCoreSchema();
  const rows = await selectRecipeRows(playerId, false);
  const recipeIds = rows.map((row) => toText(row.recipe_code) || String(row.id));
  const [failureStreakMap, recentLogs, playerRow] = await Promise.all([
    getFailureStreakMap(playerId, recipeIds),
    getRecentLogs(playerId),
    db.select({ realm: players.realm }).from(players).where(eq(players.id, playerId)).get(),
  ]);
  const playerRealm = Math.max(1, toInt(playerRow?.realm, 1));
  const views = rows.map((row) => {
    const recipeId = toText(row.recipe_code) || String(row.id);
    return buildRecipeView(row, failureStreakMap.get(recipeId) || 0);
  });

  // 境界名一次批量取（内部有缓存），别在循环里逐条查
  const labelMap = await getRealmLabels([
    playerRealm,
    ...views.map((view) => view.requiredRealm).filter((realm): realm is number => realm !== null),
    ...views.map((view) => view.materialRequiredRealm).filter((realm) => realm > 0),
  ]);

  return {
    playerRealm,
    playerRealmName: labelMap.get(playerRealm) ?? `境界 ${playerRealm}`,
    recipes: views.map((view) => ({
      ...view,
      requiredRealmName: view.requiredRealm === null
        ? null
        : labelMap.get(view.requiredRealm) ?? `境界 ${view.requiredRealm}`,
      materialRequiredRealmName: view.materialRequiredRealm <= 0
        ? null
        : labelMap.get(view.materialRequiredRealm) ?? `境界 ${view.materialRequiredRealm}`,
    })),
    recentLogs: recentLogs.map((log) => ({
      recipeId: log.recipe_id,
      resultItemName: log.result_item_name,
      success: log.success === true,
      finalSuccessRate: clampRate(log.final_success_rate, 0),
      createdAt: log.created_at,
    })),
  };
}

async function consumeIngredient(executor: SqlExecutor, playerId: string, ingredient: SmithingIngredientView) {
  const rows = await executor.execute<InventoryQuantityRow>(drizzleSql`
    SELECT "quantity"
    FROM "player_inventory"
    WHERE "player_id" = ${playerId} AND "item_id" = ${ingredient.itemId}
    FOR UPDATE
  `);
  const owned = Math.max(0, toInt(rows[0]?.quantity, 0));
  if (owned < ingredient.quantity) {
    throw new Error(`${ingredient.itemName} 不足`);
  }
  const nextQuantity = owned - ingredient.quantity;
  if (nextQuantity <= 0) {
    await executor.execute(drizzleSql`DELETE FROM "player_inventory" WHERE "player_id" = ${playerId} AND "item_id" = ${ingredient.itemId}`);
    return;
  }
  await executor.execute(drizzleSql`
    UPDATE "player_inventory"
    SET "quantity" = ${nextQuantity}
    WHERE "player_id" = ${playerId} AND "item_id" = ${ingredient.itemId}
  `);
}

export async function craftSmithingRecipe(params: {
  playerId: string;
  recipeId: string;
}) {
  await ensureSmithingCoreSchema();
  const recipeId = toText(params.recipeId);
  if (!recipeId) {
    throw new Error("配方 ID 不能为空");
  }

  /** 打造成功的产出，留到事务提交后再打磨实例（事务内读不到刚插入的行）。 */
  const crafted: { itemId?: string; specKey?: string } = {};

  await db.transaction(async (tx) => {
    const rows = await tx.execute<SmithingRecipeRow>(drizzleSql`
      SELECT
        r.*,
        result_item."icon_url" AS "result_item_icon_url",
        result_item."item_type" AS "result_item_type",
        COALESCE(main_inv."quantity", 0) AS "main_owned_quantity",
        COALESCE(aux_a_inv."quantity", 0) AS "aux_a_owned_quantity",
        COALESCE(aux_b_inv."quantity", 0) AS "aux_b_owned_quantity",
        COALESCE(aux_c_inv."quantity", 0) AS "aux_c_owned_quantity"
      FROM "smithing_recipes" r
      LEFT JOIN "items" result_item ON result_item."id" = r."result_item_id"
      LEFT JOIN "player_inventory" main_inv ON main_inv."player_id" = ${params.playerId} AND main_inv."item_id" = r."main_item_id"
      LEFT JOIN "player_inventory" aux_a_inv ON aux_a_inv."player_id" = ${params.playerId} AND aux_a_inv."item_id" = r."aux_a_item_id"
      LEFT JOIN "player_inventory" aux_b_inv ON aux_b_inv."player_id" = ${params.playerId} AND aux_b_inv."item_id" = r."aux_b_item_id"
      LEFT JOIN "player_inventory" aux_c_inv ON aux_c_inv."player_id" = ${params.playerId} AND aux_c_inv."item_id" = r."aux_c_item_id"
      WHERE (r."recipe_code" = ${recipeId} OR r."id"::text = ${recipeId})
        AND r."enabled" = true
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      throw new Error("炼器配方不存在或未启用");
    }

    const effectiveRecipeId = toText(row.recipe_code) || String(row.id);
    const recentLogs = await tx.execute<SmithingLogRow>(drizzleSql`
      SELECT "success","created_at"
      FROM "player_smithing_logs"
      WHERE "player_id" = ${params.playerId} AND "recipe_id" = ${effectiveRecipeId}
      ORDER BY "id" DESC
      LIMIT 10
    `);
    const recipe = buildRecipeView(row, computeFailureStreak(recentLogs));
    for (const ingredient of recipe.ingredients) {
      await consumeIngredient(tx, params.playerId, ingredient);
    }

    // 炼器专精：打造对应部位的成功率加成 + 品质跃升概率
    const specKey = smithingSpecKeyForItemType(toText(row.result_item_type) || "");
    const specBonus = await getSmithingSpecBonus({ playerId: params.playerId, specKey });

    const finalSuccessRate = Math.min(0.98, recipe.currentSuccessRate + specBonus.successBonusRate);
    const roll = Math.random();
    const success = roll <= finalSuccessRate;
    if (success) {
      let grantedItemId = recipe.resultItemId;
      // 跃升概率由 rollUpgradedItemId 统一裁决（跃升到鸿蒙要额外打折，见 HONGMENG_UPGRADE_CHANCE_MULT）
      grantedItemId = await rollUpgradedItemId({
        itemId: grantedItemId,
        rarityUpRate: specBonus.rarityUpRate,
      });
      await grantRewardToPlayer({
        tx,
        playerId: params.playerId,
        reward: {
          items: [{ itemId: grantedItemId, quantity: recipe.resultQuantity }],
        },
      });
      // 实例的阶段系数与词条要等事务提交后再写（否则读不到刚插入的行）
      crafted.itemId = grantedItemId;
      crafted.specKey = specKey;
    }

    await tx.execute(drizzleSql`
      INSERT INTO "player_smithing_logs" (
        "player_id","recipe_id","result_item_id","result_item_name","success",
        "base_success_rate","bonus_success_rate","pity_bonus_rate","final_success_rate","roll","created_at"
      )
      VALUES (
        ${params.playerId},
        ${effectiveRecipeId},
        ${recipe.resultItemId},
        ${recipe.resultItemName},
        ${success},
        ${recipe.baseSuccessRate},
        ${Math.max(0, recipe.currentSuccessRate - recipe.baseSuccessRate - recipe.pityBonusRate)},
        ${recipe.pityBonusRate},
        ${finalSuccessRate},
        ${roll},
        NOW()::text
      )
    `);
  });

  if (crafted.itemId) {
    const player = await db
      .select({ realm: players.realm })
      .from(players)
      .where(eq(players.id, params.playerId))
      .get();
    await tuneEquipmentInstance({
      playerId: params.playerId,
      itemId: crafted.itemId,
      playerRealm: Number(player?.realm || 1),
    });
    const granted = await db
      .select({ rarity: items.rarity })
      .from(items)
      .where(eq(items.id, crafted.itemId))
      .get();
    await grantSmithingSpecExp({
      playerId: params.playerId,
      specKey: crafted.specKey || "trinket",
      rarity: granted?.rarity || "common",
    });
  }

  return getPlayerSmithingView(params.playerId);
}

export async function listCoreSmithingRecipes(includeDisabled = false) {
  await ensureSmithingCoreSchema();
  const rows = await db.execute<SmithingRecipeRow>(drizzleSql`
    SELECT
      r.*,
      result_item."icon_url" AS "result_item_icon_url",
      result_item."item_type" AS "result_item_type",
      0 AS "main_owned_quantity",
      0 AS "aux_a_owned_quantity",
      0 AS "aux_b_owned_quantity",
      0 AS "aux_c_owned_quantity"
    FROM "smithing_recipes" r
    LEFT JOIN "items" result_item ON result_item."id" = r."result_item_id"
    ${includeDisabled ? drizzleSql`` : drizzleSql`WHERE r."enabled" = true`}
    ORDER BY r."sort_order" ASC, r."id" ASC
  `);
  return rows.map((row) => buildRecipeView(row, 0));
}

export async function upsertCoreSmithingRecipe(input: SmithingRecipeInput) {
  await ensureSmithingCoreSchema();
  const recipe = normalizeRecipeInput(input);
  const itemNameRows = await db.execute<{ id: string; name: string }>(drizzleSql`
    SELECT "id","name"
    FROM "items"
    WHERE "id" IN (
      ${recipe.resultItemId},
      ${recipe.mainItemId},
      ${recipe.auxAItemId || recipe.resultItemId},
      ${recipe.auxBItemId || recipe.resultItemId},
      ${recipe.auxCItemId || recipe.resultItemId}
    )
  `);
  const itemNameMap = new Map(itemNameRows.map((row) => [row.id, row.name]));
  if (!itemNameMap.has(recipe.resultItemId)) {
    throw new Error(`产物物品不存在：${recipe.resultItemId}`);
  }
  if (!itemNameMap.has(recipe.mainItemId)) {
    throw new Error(`主材料物品不存在：${recipe.mainItemId}`);
  }

  await db.execute(drizzleSql`DELETE FROM "smithing_recipes" WHERE "recipe_code" = ${recipe.recipeCode}`);
  await db.execute(drizzleSql`
    INSERT INTO "smithing_recipes" (
      "recipe_code",
      "result_item_id","result_item_name","result_quantity",
      "main_item_id","main_item_name","main_quantity",
      "base_success_rate",
      "aux_a_item_id","aux_a_item_name","aux_a_quantity","aux_a_bonus_rate",
      "aux_b_item_id","aux_b_item_name","aux_b_quantity","aux_b_bonus_rate",
      "aux_c_item_id","aux_c_item_name","aux_c_quantity","aux_c_bonus_rate",
      "enabled","sort_order","created_at","updated_at"
    )
    VALUES (
      ${recipe.recipeCode},
      ${recipe.resultItemId},${itemNameMap.get(recipe.resultItemId) || recipe.resultItemId},${recipe.resultQuantity},
      ${recipe.mainItemId},${itemNameMap.get(recipe.mainItemId) || recipe.mainItemId},${recipe.mainQuantity},
      ${recipe.baseSuccessRate},
      ${recipe.auxAItemId},${recipe.auxAItemId ? itemNameMap.get(recipe.auxAItemId) || recipe.auxAItemId : ""},${recipe.auxAQuantity},${recipe.auxABonusRate},
      ${recipe.auxBItemId},${recipe.auxBItemId ? itemNameMap.get(recipe.auxBItemId) || recipe.auxBItemId : ""},${recipe.auxBQuantity},${recipe.auxBBonusRate},
      ${recipe.auxCItemId},${recipe.auxCItemId ? itemNameMap.get(recipe.auxCItemId) || recipe.auxCItemId : ""},${recipe.auxCQuantity},${recipe.auxCBonusRate},
      ${recipe.enabled},${recipe.sortOrder},NOW()::text,NOW()::text
    )
  `);
  return listCoreSmithingRecipes(true);
}
