import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置，无法执行市场表结构自举");
}

const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const MARKET_DEPENDENCY_TABLES = [
  "players",
  "items",
  "market_listings",
];
const MARKET_SCHEMA_PATCH_FILE = "0061_market_listing_visibility_and_expiry.sql";

async function hasAllDependencyTables() {
  const rows = await sql`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${MARKET_DEPENDENCY_TABLES})
  `;
  return Number(rows[0]?.value || 0) === MARKET_DEPENDENCY_TABLES.length;
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

async function bootstrapMarketSchema() {
  const dependencyReady = await hasAllDependencyTables();
  if (!dependencyReady) {
    console.log("[market-bootstrap] 未检测到 players/items/market_listings 依赖表，跳过市场表结构自举。");
    return;
  }

  const missingVisibleAt = !(await hasColumn("market_listings", "visible_at"));
  const missingExpiresAt = !(await hasColumn("market_listings", "expires_at"));
  if (!missingVisibleAt && !missingExpiresAt) {
    console.log("[market-bootstrap] 市场表结构已是最新状态，跳过自举。");
    return;
  }

  await applySqlFile(MARKET_SCHEMA_PATCH_FILE);

  if (!(await hasColumn("market_listings", "visible_at"))) {
    throw new Error("市场挂单表补丁执行后仍未检测到 visible_at");
  }
  if (!(await hasColumn("market_listings", "expires_at"))) {
    throw new Error("市场挂单表补丁执行后仍未检测到 expires_at");
  }

  console.log(`[market-bootstrap] 市场表结构已完成自举，执行文件: ${MARKET_SCHEMA_PATCH_FILE}`);
}

try {
  await bootstrapMarketSchema();
} finally {
  await sql.end();
}
