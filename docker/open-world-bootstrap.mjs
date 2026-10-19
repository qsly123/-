import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置，无法执行开放世界表结构自举");
}

const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const OPEN_WORLD_REQUIRED_TABLES = [
  "world_map_instances",
  "world_map_portals",
  "world_npc_profiles",
  "world_npc_runtime",
  "world_npc_inventory",
  "world_npc_life_logs",
  "world_local_messages",
];
const OPEN_WORLD_DEPENDENCY_TABLES = [
  "players",
  "items",
];

async function hasAllRequiredOpenWorldTables() {
  const rows = await sql`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${OPEN_WORLD_REQUIRED_TABLES})
  `;
  return Number(rows[0]?.value || 0) === OPEN_WORLD_REQUIRED_TABLES.length;
}

async function hasAllDependencyTables() {
  const rows = await sql`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${OPEN_WORLD_DEPENDENCY_TABLES})
  `;
  return Number(rows[0]?.value || 0) === OPEN_WORLD_DEPENDENCY_TABLES.length;
}

async function hasColumn(tableName, columnName) {
  const rows = await sql`
    select count(*)::int as value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
  `;
  return Number(rows[0]?.value || 0) > 0;
}

async function applySqlFile(fileName) {
  const migrationPath = path.join(process.cwd(), "drizzle", fileName);
  const migrationText = await fs.readFile(migrationPath, "utf8");
  const statements = migrationText
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter(Boolean);

  await sql.begin(async (transaction) => {
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
}

async function bootstrapOpenWorldSchema() {
  const dependencyReady = await hasAllDependencyTables();
  if (!dependencyReady) {
    console.log("[open-world-bootstrap] 未检测到 players/items 核心表，跳过开放世界自举，等待基础迁移完成后再执行。");
    return;
  }

  const appliedFiles = [];
  const hadBaseTable = await hasAllRequiredOpenWorldTables();
  if (!hadBaseTable) {
    await applySqlFile("0058_open_world_tiandao.sql");
    appliedFiles.push("0058_open_world_tiandao.sql");
  }

  if (!(await hasColumn("world_local_messages", "district_name"))) {
    await applySqlFile("0059_open_world_nearby_district_scope.sql");
    appliedFiles.push("0059_open_world_nearby_district_scope.sql");
  }
  if (!(await hasColumn("world_map_instances", "meta_json"))) {
    await applySqlFile("0060_open_world_ai_meta.sql");
    appliedFiles.push("0060_open_world_ai_meta.sql");
  }

  if (!(await hasAllRequiredOpenWorldTables())) {
    throw new Error("开放世界表结构自举执行后仍未检测到完整的 world_* 关键表");
  }
  if (!(await hasColumn("world_local_messages", "district_name"))) {
    throw new Error("开放世界附近频道街区字段补丁执行后仍未检测到 district_name");
  }
  if (!(await hasColumn("world_map_instances", "meta_json"))) {
    throw new Error("开放世界地图 AI 元数据补丁执行后仍未检测到 meta_json");
  }

  if (appliedFiles.length <= 0) {
    console.log("[open-world-bootstrap] 开放世界表结构已是最新状态，跳过自举。");
    return;
  }

  console.log(`[open-world-bootstrap] 开放世界表结构已完成自举，执行文件: ${appliedFiles.join(", ")}`);
}

try {
  await bootstrapOpenWorldSchema();
} finally {
  await sql.end();
}
