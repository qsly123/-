import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

type MarketSchemaGlobalStore = typeof globalThis & {
  __immortalityMarketSchemaSql?: ReturnType<typeof postgres>;
  __immortalityMarketSchemaEnsurePromise?: Promise<boolean>;
  __immortalityMarketSchemaReady?: boolean;
  __immortalityMarketSchemaStatus?: MarketSchemaStatus;
};

export type MarketSchemaBootstrapMode =
  | "unknown"
  | "existing"
  | "patched"
  | "failed";

export type MarketSchemaStatus = {
  ready: boolean;
  baseTableReady: boolean;
  visibleAtReady: boolean;
  expiresAtReady: boolean;
  bootstrapMode: MarketSchemaBootstrapMode;
  appliedFiles: string[];
  checkedAt: string | null;
  fallbackReason: string | null;
};

const MARKET_REQUIRED_TABLE = "market_listings";
const MARKET_DEPENDENCY_TABLES = [
  "players",
  "items",
  "market_listings",
] as const;
const MARKET_SCHEMA_PATCH_FILE = "0061_market_listing_visibility_and_expiry.sql";

function getSchemaSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法初始化市场表结构自举");
  }

  const globalStore = globalThis as MarketSchemaGlobalStore;
  globalStore.__immortalityMarketSchemaSql = globalStore.__immortalityMarketSchemaSql || postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return globalStore.__immortalityMarketSchemaSql;
}

function getDefaultMarketSchemaStatus(): MarketSchemaStatus {
  return {
    ready: false,
    baseTableReady: false,
    visibleAtReady: false,
    expiresAtReady: false,
    bootstrapMode: "unknown",
    appliedFiles: [],
    checkedAt: null,
    fallbackReason: null,
  };
}

async function hasAllDependencyTables() {
  const sql = getSchemaSqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${MARKET_DEPENDENCY_TABLES as unknown as string[]})
  `;
  return Number(rows[0]?.value || 0) === MARKET_DEPENDENCY_TABLES.length;
}

async function hasMarketListingsTable() {
  const sql = getSchemaSqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = ${MARKET_REQUIRED_TABLE}
  `;
  return Number(rows[0]?.value || 0) > 0;
}

async function hasColumn(tableName: string, columnName: string) {
  const sql = getSchemaSqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
  `;
  return Number(rows[0]?.value || 0) > 0;
}

async function applyMarketSqlFile(fileName: string) {
  const sql = getSchemaSqlClient();
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

export function getMarketSchemaStatus(): MarketSchemaStatus {
  const globalStore = globalThis as MarketSchemaGlobalStore;
  return globalStore.__immortalityMarketSchemaStatus || getDefaultMarketSchemaStatus();
}

export async function ensureMarketListingSchema() {
  const globalStore = globalThis as MarketSchemaGlobalStore;
  const currentStatus = getMarketSchemaStatus();
  if (
    globalStore.__immortalityMarketSchemaReady
    && currentStatus.visibleAtReady
    && currentStatus.expiresAtReady
  ) {
    return true;
  }
  if (globalStore.__immortalityMarketSchemaEnsurePromise) {
    return globalStore.__immortalityMarketSchemaEnsurePromise;
  }

  globalStore.__immortalityMarketSchemaEnsurePromise = (async () => {
    try {
      const checkedAt = new Date().toISOString();
      const appliedFiles: string[] = [];
      const dependencyReady = await hasAllDependencyTables();
      if (!dependencyReady) {
        const status: MarketSchemaStatus = {
          ...getDefaultMarketSchemaStatus(),
          bootstrapMode: "failed",
          checkedAt,
          fallbackReason: "未检测到 players/items/market_listings 依赖表，跳过市场表结构自举",
        };
        globalStore.__immortalityMarketSchemaReady = false;
        globalStore.__immortalityMarketSchemaStatus = status;
        return false;
      }

      const hadBaseTable = await hasMarketListingsTable();
      let bootstrapMode: MarketSchemaBootstrapMode = "existing";

      const missingVisibleAt = !(await hasColumn(MARKET_REQUIRED_TABLE, "visible_at"));
      const missingExpiresAt = !(await hasColumn(MARKET_REQUIRED_TABLE, "expires_at"));
      if (missingVisibleAt || missingExpiresAt) {
        await applyMarketSqlFile(MARKET_SCHEMA_PATCH_FILE);
        appliedFiles.push(MARKET_SCHEMA_PATCH_FILE);
        bootstrapMode = hadBaseTable ? "patched" : "failed";
      }

      const [baseTableReady, visibleAtReady, expiresAtReady] = await Promise.all([
        hasMarketListingsTable(),
        hasColumn(MARKET_REQUIRED_TABLE, "visible_at"),
        hasColumn(MARKET_REQUIRED_TABLE, "expires_at"),
      ]);
      const readyAfterBootstrap = baseTableReady && visibleAtReady && expiresAtReady;
      const status: MarketSchemaStatus = {
        ready: readyAfterBootstrap,
        baseTableReady,
        visibleAtReady,
        expiresAtReady,
        bootstrapMode: readyAfterBootstrap ? bootstrapMode : "failed",
        appliedFiles,
        checkedAt,
        fallbackReason: readyAfterBootstrap ? null : "市场表结构仍缺少 visible_at 或 expires_at",
      };

      globalStore.__immortalityMarketSchemaStatus = status;
      globalStore.__immortalityMarketSchemaReady = readyAfterBootstrap;
      return readyAfterBootstrap;
    } catch (error) {
      console.error("Market schema ensure error:", error);
      globalStore.__immortalityMarketSchemaReady = false;
      globalStore.__immortalityMarketSchemaStatus = {
        ...getDefaultMarketSchemaStatus(),
        bootstrapMode: "failed",
        checkedAt: new Date().toISOString(),
        fallbackReason: error instanceof Error ? error.message : "市场表结构自举失败",
      };
      return false;
    } finally {
      globalStore.__immortalityMarketSchemaEnsurePromise = undefined;
    }
  })();

  return globalStore.__immortalityMarketSchemaEnsurePromise;
}
