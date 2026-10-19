import { sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { ensureAlchemyCoreSchema } from "@/modules/character/services/alchemy-service";
import { ensureGongfaCoreSchema } from "@/modules/character/services/gongfa-service";
import { ensureSmithingCoreSchema } from "@/modules/character/services/smithing-service";

type RequiredTable = {
  tableName: string;
  columns: string[];
};

type ColumnRow = {
  table_name: string;
  column_name: string;
};

const strict = process.argv.includes("--strict");

const requiredTables: RequiredTable[] = [
  {
    tableName: "alchemy_recipes",
    columns: [
      "id",
      "recipe_code",
      "result_item_id",
      "result_item_name",
      "result_quantity",
      "main_item_id",
      "main_item_name",
      "main_quantity",
      "base_success_rate",
      "aux_a_item_id",
      "aux_a_item_name",
      "aux_a_quantity",
      "aux_a_bonus_rate",
      "aux_b_item_id",
      "aux_b_item_name",
      "aux_b_quantity",
      "aux_b_bonus_rate",
      "aux_c_item_id",
      "aux_c_item_name",
      "aux_c_quantity",
      "aux_c_bonus_rate",
      "enabled",
      "sort_order",
      "created_at",
      "updated_at",
    ],
  },
  {
    tableName: "player_alchemy_logs",
    columns: [
      "id",
      "player_id",
      "recipe_id",
      "result_item_id",
      "result_item_name",
      "success",
      "base_success_rate",
      "bonus_success_rate",
      "pity_bonus_rate",
      "final_success_rate",
      "roll",
      "created_at",
    ],
  },
  {
    tableName: "smithing_recipes",
    columns: [
      "id",
      "recipe_code",
      "result_item_id",
      "result_item_name",
      "result_quantity",
      "main_item_id",
      "main_item_name",
      "main_quantity",
      "base_success_rate",
      "aux_a_item_id",
      "aux_a_item_name",
      "aux_a_quantity",
      "aux_a_bonus_rate",
      "aux_b_item_id",
      "aux_b_item_name",
      "aux_b_quantity",
      "aux_b_bonus_rate",
      "aux_c_item_id",
      "aux_c_item_name",
      "aux_c_quantity",
      "aux_c_bonus_rate",
      "enabled",
      "sort_order",
      "created_at",
      "updated_at",
    ],
  },
  {
    tableName: "player_smithing_logs",
    columns: [
      "id",
      "player_id",
      "recipe_id",
      "result_item_id",
      "result_item_name",
      "success",
      "base_success_rate",
      "bonus_success_rate",
      "pity_bonus_rate",
      "final_success_rate",
      "roll",
      "created_at",
    ],
  },
  {
    tableName: "plugin_gongfa_player_points",
    columns: [
      "player_id",
      "points",
      "total_earned",
      "created_at",
      "updated_at",
    ],
  },
  {
    tableName: "plugin_gongfa_point_logs",
    columns: [
      "id",
      "player_id",
      "delta",
      "change_amount",
      "source",
      "reason",
      "source_ref",
      "extra_json",
      "created_at",
    ],
  },
];

function uniqueTableNames() {
  return Array.from(new Set(requiredTables.map((table) => table.tableName)));
}

async function loadExistingColumns() {
  const tableNames = uniqueTableNames();
  const rows = await db.execute<ColumnRow>(drizzleSql`
    SELECT "table_name","column_name"
    FROM information_schema.columns
    WHERE "table_schema" = 'public'
      AND "table_name" IN (${drizzleSql.join(tableNames.map((tableName) => drizzleSql`${tableName}`), drizzleSql`, `)})
    ORDER BY "table_name" ASC, "ordinal_position" ASC
  `);

  const columnMap = new Map<string, Set<string>>();
  for (const row of rows) {
    const tableColumns = columnMap.get(row.table_name) || new Set<string>();
    tableColumns.add(row.column_name);
    columnMap.set(row.table_name, tableColumns);
  }
  return columnMap;
}

async function main() {
  console.log("核心炼丹/炼器/功法旧表兼容审计：开始");
  await ensureAlchemyCoreSchema();
  await ensureSmithingCoreSchema();
  await ensureGongfaCoreSchema();

  const existingColumns = await loadExistingColumns();
  const missing: Array<{ tableName: string; columnName: string }> = [];

  for (const table of requiredTables) {
    const tableColumns = existingColumns.get(table.tableName) || new Set<string>();
    const tableMissing = table.columns.filter((column) => !tableColumns.has(column));
    if (tableMissing.length > 0) {
      for (const columnName of tableMissing) {
        missing.push({ tableName: table.tableName, columnName });
      }
      console.log(`- ${table.tableName}: 缺失 ${tableMissing.join(", ")}`);
      continue;
    }
    console.log(`- ${table.tableName}: OK`);
  }

  if (missing.length > 0) {
    console.log("");
    console.log("核心炼丹/炼器/功法旧表兼容审计：BLOCKED");
    process.exit(strict ? 1 : 0);
  }

  console.log("");
  console.log("核心炼丹/炼器/功法旧表兼容审计：PASS");
}

main().catch((error) => {
  console.error("核心炼丹/炼器/功法旧表兼容审计：ERROR");
  console.error(error);
  process.exit(1);
});
