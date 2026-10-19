import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const DEFAULT_MIGRATIONS_SCHEMA = process.env.DB_MIGRATIONS_SCHEMA || "drizzle";
const DEFAULT_MIGRATIONS_TABLE = process.env.DB_MIGRATIONS_TABLE || "__drizzle_migrations";

if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置，无法执行迁移");
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

async function resolveMigrationRegistry() {
  const [drizzleSchemaRows, publicSchemaRows] = await Promise.all([
    sql`
      select to_regclass(${`${DEFAULT_MIGRATIONS_SCHEMA}.${DEFAULT_MIGRATIONS_TABLE}`}) as value
    `,
    sql`
      select to_regclass('public.__drizzle_migrations') as value
    `,
  ]);

  if (drizzleSchemaRows[0]?.value) {
    return {
      exists: true,
      schema: DEFAULT_MIGRATIONS_SCHEMA,
      table: DEFAULT_MIGRATIONS_TABLE,
    };
  }

  if (publicSchemaRows[0]?.value) {
    return {
      exists: true,
      schema: "public",
      table: DEFAULT_MIGRATIONS_TABLE,
    };
  }

  return {
    exists: false,
    schema: DEFAULT_MIGRATIONS_SCHEMA,
    table: DEFAULT_MIGRATIONS_TABLE,
  };
}

async function hasExistingCoreTables() {
  const existingCoreTableRows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('accounts', 'players', 'maps', 'items', 'system_configs')
    limit 5
  `;
  return (existingCoreTableRows?.length || 0) > 0;
}

async function readLatestMigrationMeta() {
  const journalPath = path.resolve(process.cwd(), "drizzle", "meta", "_journal.json");
  const journalText = await readFile(journalPath, "utf8");
  const journal = JSON.parse(journalText);
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const latestEntry = entries
    .filter((entry) => typeof entry?.when === "number" && typeof entry?.tag === "string")
    .sort((left, right) => Number(left.when) - Number(right.when))
    .at(-1);

  if (!latestEntry) {
    throw new Error("未找到可用于建立迁移基线的 drizzle/meta/_journal.json 记录");
  }

  return {
    tag: String(latestEntry.tag),
    createdAt: Number(latestEntry.when),
  };
}

async function createLegacyMigrationBaseline(registry) {
  const latestMigration = await readLatestMigrationMeta();
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql.unsafe(`"${registry.schema}"`)}`;
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${registry.schema}"."${registry.table}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  await sql.unsafe(`
    insert into "${registry.schema}"."${registry.table}" ("hash", "created_at")
    values ($1, $2)
  `, [`legacy-baseline:${latestMigration.tag}`, latestMigration.createdAt]);
  console.log(`[migration] 检测到旧库缺少迁移表，已建立迁移基线: ${registry.schema}.${registry.table} -> ${latestMigration.tag}`);
}

try {
  const registry = await resolveMigrationRegistry();
  if (!registry.exists) {
    if (await hasExistingCoreTables()) {
      await createLegacyMigrationBaseline(registry);
    } else {
      console.log("[migration] 未检测到历史业务表，按全新库执行 Drizzle 迁移。");
    }
  }

  await migrate(db, {
    migrationsFolder: "./drizzle",
    migrationsSchema: registry.schema,
    migrationsTable: registry.table,
  });
  console.log(`[migration] 数据库迁移完成，使用迁移表: ${registry.schema}.${registry.table}`);
} finally {
  await sql.end();
}
