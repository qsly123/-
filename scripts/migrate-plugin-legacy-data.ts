import { existsSync, readFileSync } from "fs";
import postgres from "postgres";

type LegacyPluginTable = {
  name: string;
  group: "plugin-platform" | "double-cultivation" | "gongfa" | "spiritual-field" | "alchemy-smithing" | "lundao";
  targetModule: string;
  migrationState: "readonly-legacy" | "core-table-kept" | "needs-core-migration";
  note: string;
};

const LEGACY_PLUGIN_TABLES: LegacyPluginTable[] = [
  {
    name: "plugin_packages",
    group: "plugin-platform",
    targetModule: "legacy/plugin",
    migrationState: "readonly-legacy",
    note: "插件包历史记录，只读保留，不再参与安装或启停。",
  },
  {
    name: "plugin_installs",
    group: "plugin-platform",
    targetModule: "legacy/plugin",
    migrationState: "readonly-legacy",
    note: "插件安装历史记录，只读保留。",
  },
  {
    name: "plugin_operation_logs",
    group: "plugin-platform",
    targetModule: "legacy/plugin",
    migrationState: "readonly-legacy",
    note: "插件操作日志，只读保留。",
  },
  {
    name: "player_double_cultivation_requests",
    group: "double-cultivation",
    targetModule: "src/modules/world",
    migrationState: "core-table-kept",
    note: "双修请求账本已由 world 核心服务接管，旧表名暂保留。",
  },
  {
    name: "player_double_cultivation_daily",
    group: "double-cultivation",
    targetModule: "src/modules/world",
    migrationState: "core-table-kept",
    note: "双修每日次数账本已由 world 核心服务接管，旧表名暂保留。",
  },
  {
    name: "player_double_cultivation_logs",
    group: "double-cultivation",
    targetModule: "src/modules/world",
    migrationState: "core-table-kept",
    note: "双修正式日志账本已由 world 核心服务接管，旧表名暂保留。",
  },
  {
    name: "player_double_cultivation_sperm",
    group: "double-cultivation",
    targetModule: "src/modules/world",
    migrationState: "core-table-kept",
    note: "双修资源账本已由 world 核心服务接管，旧表名暂保留。",
  },
  {
    name: "player_double_cultivation_uterus",
    group: "double-cultivation",
    targetModule: "src/modules/world",
    migrationState: "core-table-kept",
    note: "双修孕育展示账本已由 world 核心服务接管，旧表名暂保留。",
  },
  {
    name: "player_double_cultivation_player_stats",
    group: "double-cultivation",
    targetModule: "src/modules/world",
    migrationState: "core-table-kept",
    note: "双修亲密度账本已由 world 核心服务接管，旧表名暂保留。",
  },
  {
    name: "plugin_gongfa_books",
    group: "gongfa",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "功法书定义需迁入核心技能/功法配置表。",
  },
  {
    name: "plugin_gongfa_book_levels",
    group: "gongfa",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "功法等级定义需迁入核心技能/功法配置表。",
  },
  {
    name: "plugin_gongfa_level_bonus_items",
    group: "gongfa",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "功法等级属性加成需迁入核心属性聚合数据源。",
  },
  {
    name: "plugin_gongfa_player_progress",
    group: "gongfa",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "玩家功法进度需迁入核心玩家技能/功法进度表。",
  },
  {
    name: "plugin_gongfa_player_points",
    group: "gongfa",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "玩家功法点数需迁入核心成长资源表。",
  },
  {
    name: "plugin_gongfa_point_logs",
    group: "gongfa",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "玩家功法点流水需迁入核心成长流水表。",
  },
  {
    name: "plugin_spiritual_field_players",
    group: "spiritual-field",
    targetModule: "src/modules/world",
    migrationState: "needs-core-migration",
    note: "灵田玩家状态需迁入核心洞府/世界资源表。",
  },
  {
    name: "plugin_spiritual_field_plots",
    group: "spiritual-field",
    targetModule: "src/modules/world",
    migrationState: "needs-core-migration",
    note: "灵田地块需迁入核心洞府/世界资源表。",
  },
  {
    name: "plugin_spiritual_field_seeds",
    group: "spiritual-field",
    targetModule: "src/modules/world",
    migrationState: "needs-core-migration",
    note: "灵田种子定义需迁入核心物品/资源配置。",
  },
  {
    name: "alchemy_recipes",
    group: "alchemy-smithing",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "炼丹配方需迁入固定核心配方系统。",
  },
  {
    name: "smithing_recipes",
    group: "alchemy-smithing",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "炼器配方需迁入固定核心配方系统。",
  },
  {
    name: "player_alchemy_logs",
    group: "alchemy-smithing",
    targetModule: "src/modules/character",
    migrationState: "needs-core-migration",
    note: "玩家炼丹日志需迁入核心制作流水。",
  },
  {
    name: "lundao_arena_slots",
    group: "lundao",
    targetModule: "src/modules/social",
    migrationState: "needs-core-migration",
    note: "论道擂台槽位需迁入核心论道模块。",
  },
  {
    name: "lundao_player_daily",
    group: "lundao",
    targetModule: "src/modules/social",
    migrationState: "needs-core-migration",
    note: "论道每日数据需迁入核心论道模块。",
  },
  {
    name: "lundao_weekly_cosmetic_grants",
    group: "lundao",
    targetModule: "src/modules/social",
    migrationState: "needs-core-migration",
    note: "论道周奖励记录需迁入核心论道模块。",
  },
  {
    name: "lundao_weekly_settlements",
    group: "lundao",
    targetModule: "src/modules/social",
    migrationState: "needs-core-migration",
    note: "论道周结算需迁入核心论道模块。",
  },
];

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const localEnvPath = ".env.local";
  if (!existsSync(localEnvPath)) {
    return "";
  }

  const content = readFileSync(localEnvPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.startsWith("DATABASE_URL=")) {
      continue;
    }
    const value = line.slice("DATABASE_URL=".length).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  return "";
}

function assertSafeTableName(tableName: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
    throw new Error(`非法表名: ${tableName}`);
  }
}

async function tableExists(sql: postgres.Sql, tableName: string) {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

async function countTableRows(sql: postgres.Sql, tableName: string) {
  assertSafeTableName(tableName);
  const rows = await sql.unsafe<{ total: string }[]>(`SELECT count(*)::text AS "total" FROM "${tableName}"`);
  return rows[0]?.total || "0";
}

async function countPluginSystemConfigRows(sql: postgres.Sql) {
  if (!await tableExists(sql, "system_configs")) {
    return "0";
  }
  const rows = await sql<{ total: string }[]>`
    SELECT count(*)::text AS "total"
    FROM "system_configs"
    WHERE "key" LIKE 'PLUGIN\_%' ESCAPE '\'
       OR "group" = 'plugin'
  `;
  return rows[0]?.total || "0";
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法盘点历史插件数据。");
  }

  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const tables = [];
    for (const table of LEGACY_PLUGIN_TABLES) {
      const exists = await tableExists(sql, table.name);
      tables.push({
        ...table,
        exists,
        rowCount: exists ? await countTableRows(sql, table.name) : "0",
      });
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      mode: "dry-run",
      destructive: false,
      note: "本脚本只做历史插件数据盘点，不 drop 表、不迁移写入。真正迁移目标表确定后，在本清单上追加幂等写入步骤。",
      pluginSystemConfigRows: await countPluginSystemConfigRows(sql),
      tables,
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[plugin-legacy-migration] 历史插件数据盘点失败", error);
  process.exit(1);
});
