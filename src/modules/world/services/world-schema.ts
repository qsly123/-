import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

type WorldSchemaGlobalStore = typeof globalThis & {
  __immortalityOpenWorldSchemaSql?: ReturnType<typeof postgres>;
  __immortalityOpenWorldSchemaEnsurePromise?: Promise<boolean>;
  __immortalityOpenWorldSchemaReady?: boolean;
  __immortalityOpenWorldSchemaStatus?: OpenWorldSchemaStatus;
};

export type OpenWorldSchemaBootstrapMode =
  | "unknown"
  | "existing"
  | "bootstrapped"
  | "patched"
  | "failed";

export type OpenWorldSchemaStatus = {
  ready: boolean;
  baseTableReady: boolean;
  nearbyDistrictColumnReady: boolean;
  nearbyDedupeKeyReady: boolean;
  playerWorldOfferRespondedAtReady: boolean;
  factionStorylineTablesReady: boolean;
  phase5MapFieldsReady: boolean;
  bootstrapMode: OpenWorldSchemaBootstrapMode;
  appliedFiles: string[];
  checkedAt: string | null;
  fallbackReason: string | null;
};

const OPEN_WORLD_BASE_SCHEMA_SQL_FILE = "0058_open_world_tiandao.sql";
const OPEN_WORLD_PHASE3_SCHEMA_SQL_CANDIDATES = [
  "0062_player_world_pressure_and_offers.sql",
  "0062_player_world_pressure.sql",
] as const;
const OPEN_WORLD_PHASE3_RESPONDED_AT_SQL_CANDIDATES = [
  "0063_player_world_offer_responded_at.sql",
  "0062_player_world_pressure_and_offers.sql",
] as const;
const OPEN_WORLD_ADULT_SCHEMA_SQL_FILE = "0064_open_world_adult_system.sql";
const OPEN_WORLD_PHASE4_FACTION_STORYLINE_SQL_FILE = "0065_open_world_faction_storylines.sql";
const OPEN_WORLD_PHASE5_MAP_NETWORK_SQL_FILE = "0067_open_world_phase5_map_network.sql";
const OPEN_WORLD_NEARBY_DEDUPE_KEY_SQL_FILE = "0071_nearby_chat_dedupe_key.sql";
const OPEN_WORLD_REQUIRED_TABLES = [
  "world_map_instances",
  "world_map_portals",
  "world_npc_profiles",
  "world_npc_runtime",
  "world_npc_inventory",
  "world_npc_life_logs",
  "world_local_messages",
  "player_world_profiles",
  "player_world_incidents",
  "player_world_event_offers",
  "world_factions",
  "world_district_states",
  "world_storylines",
  "world_storyline_participants",
  "player_adult_profiles",
  "world_npc_adult_profiles",
  "world_adult_event_logs",
] as const;

function getSchemaSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法初始化开放世界表结构。");
  }

  const globalStore = globalThis as WorldSchemaGlobalStore;
  globalStore.__immortalityOpenWorldSchemaSql = globalStore.__immortalityOpenWorldSchemaSql || postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return globalStore.__immortalityOpenWorldSchemaSql;
}

async function getExistingOpenWorldTableCount() {
  const sql = getSchemaSqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${OPEN_WORLD_REQUIRED_TABLES as unknown as string[]})
  `;
  return Number(rows[0]?.value || 0);
}

async function hasAllRequiredOpenWorldTables() {
  return (await getExistingOpenWorldTableCount()) === OPEN_WORLD_REQUIRED_TABLES.length;
}

async function hasRequiredOpenWorldTable(tableName: (typeof OPEN_WORLD_REQUIRED_TABLES)[number]) {
  const sql = getSchemaSqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = ${tableName}
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

async function applyOpenWorldSqlFile(fileName: string) {
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

async function resolveExistingSqlFile(fileNames: readonly string[]) {
  for (const fileName of fileNames) {
    try {
      await fs.access(path.join(process.cwd(), "drizzle", fileName));
      return fileName;
    } catch {
      continue;
    }
  }
  return null;
}

function getDefaultOpenWorldSchemaStatus(): OpenWorldSchemaStatus {
  return {
    ready: false,
    baseTableReady: false,
    nearbyDistrictColumnReady: false,
    nearbyDedupeKeyReady: false,
    playerWorldOfferRespondedAtReady: false,
    factionStorylineTablesReady: false,
    phase5MapFieldsReady: false,
    bootstrapMode: "unknown",
    appliedFiles: [],
    checkedAt: null,
    fallbackReason: null,
  };
}

export function getOpenWorldSchemaStatus(): OpenWorldSchemaStatus {
  const globalStore = globalThis as WorldSchemaGlobalStore;
  return globalStore.__immortalityOpenWorldSchemaStatus || getDefaultOpenWorldSchemaStatus();
}

export async function ensureOpenWorldSchema() {
  const globalStore = globalThis as WorldSchemaGlobalStore;
  const currentStatus = getOpenWorldSchemaStatus();
  if (
    globalStore.__immortalityOpenWorldSchemaReady
    && currentStatus.nearbyDistrictColumnReady
    && currentStatus.nearbyDedupeKeyReady
    && currentStatus.playerWorldOfferRespondedAtReady
    && currentStatus.factionStorylineTablesReady
    && currentStatus.phase5MapFieldsReady
  ) {
    return true;
  }
  if (globalStore.__immortalityOpenWorldSchemaEnsurePromise) {
    return globalStore.__immortalityOpenWorldSchemaEnsurePromise;
  }

  globalStore.__immortalityOpenWorldSchemaEnsurePromise = (async () => {
    try {
      const checkedAt = new Date().toISOString();
      const appliedFiles: string[] = [];
      const hadAllTables = await hasAllRequiredOpenWorldTables();
      const hadBaseWorldTables = await hasRequiredOpenWorldTable("world_map_instances");
      const phase3SchemaFile = await resolveExistingSqlFile(OPEN_WORLD_PHASE3_SCHEMA_SQL_CANDIDATES);
      const phase3RespondedAtFile = await resolveExistingSqlFile(OPEN_WORLD_PHASE3_RESPONDED_AT_SQL_CANDIDATES);
      let bootstrapMode: OpenWorldSchemaBootstrapMode = hadAllTables ? "existing" : "bootstrapped";

      if (!hadBaseWorldTables) {
        await applyOpenWorldSqlFile(OPEN_WORLD_BASE_SCHEMA_SQL_FILE);
        appliedFiles.push(OPEN_WORLD_BASE_SCHEMA_SQL_FILE);
      }

      const missingPhase3WorldTables = !(
        await hasRequiredOpenWorldTable("player_world_profiles")
        && await hasRequiredOpenWorldTable("player_world_incidents")
        && await hasRequiredOpenWorldTable("player_world_event_offers")
      );
      if (missingPhase3WorldTables) {
        if (!phase3SchemaFile) {
          throw new Error("缺少开放世界第三阶段表结构 SQL 文件");
        }
        await applyOpenWorldSqlFile(phase3SchemaFile);
        appliedFiles.push(phase3SchemaFile);
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingNearbyDistrictColumn = !(await hasColumn("world_local_messages", "district_name"));
      if (missingNearbyDistrictColumn) {
        await applyOpenWorldSqlFile("0059_open_world_nearby_district_scope.sql");
        appliedFiles.push("0059_open_world_nearby_district_scope.sql");
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingMapMetaJsonColumn = !(await hasColumn("world_map_instances", "meta_json"));
      if (missingMapMetaJsonColumn) {
        await applyOpenWorldSqlFile("0060_open_world_ai_meta.sql");
        appliedFiles.push("0060_open_world_ai_meta.sql");
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingNearbyDedupeKeyColumn = !(await hasColumn("world_local_messages", "dedupe_key"));
      if (missingNearbyDedupeKeyColumn) {
        await applyOpenWorldSqlFile(OPEN_WORLD_NEARBY_DEDUPE_KEY_SQL_FILE);
        appliedFiles.push(OPEN_WORLD_NEARBY_DEDUPE_KEY_SQL_FILE);
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingPlayerWorldOfferRespondedAt = !(await hasColumn("player_world_event_offers", "responded_at"));
      if (missingPlayerWorldOfferRespondedAt) {
        if (!phase3RespondedAtFile) {
          throw new Error("缺少开放世界邀约 responded_at 补丁 SQL 文件");
        }
        await applyOpenWorldSqlFile(phase3RespondedAtFile);
        appliedFiles.push(phase3RespondedAtFile);
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingAdultTables = !(
        await hasRequiredOpenWorldTable("player_adult_profiles")
        && await hasRequiredOpenWorldTable("world_npc_adult_profiles")
        && await hasRequiredOpenWorldTable("world_adult_event_logs")
      );
      if (missingAdultTables) {
        await applyOpenWorldSqlFile(OPEN_WORLD_ADULT_SCHEMA_SQL_FILE);
        appliedFiles.push(OPEN_WORLD_ADULT_SCHEMA_SQL_FILE);
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingFactionStorylineTables = !(
        await hasRequiredOpenWorldTable("world_factions")
        && await hasRequiredOpenWorldTable("world_district_states")
        && await hasRequiredOpenWorldTable("world_storylines")
        && await hasRequiredOpenWorldTable("world_storyline_participants")
      );
      if (missingFactionStorylineTables) {
        await applyOpenWorldSqlFile(OPEN_WORLD_PHASE4_FACTION_STORYLINE_SQL_FILE);
        appliedFiles.push(OPEN_WORLD_PHASE4_FACTION_STORYLINE_SQL_FILE);
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const missingPhase5MapFields = !(
        await hasColumn("world_map_instances", "heat_tier")
        && await hasColumn("world_map_instances", "travel_connections_json")
      );
      if (missingPhase5MapFields) {
        await applyOpenWorldSqlFile(OPEN_WORLD_PHASE5_MAP_NETWORK_SQL_FILE);
        appliedFiles.push(OPEN_WORLD_PHASE5_MAP_NETWORK_SQL_FILE);
        if (hadBaseWorldTables) {
          bootstrapMode = "patched";
        }
      }

      const [baseTableReady, nearbyDistrictColumnReady, nearbyDedupeKeyReady, mapMetaJsonReady, playerWorldOfferRespondedAtReady, factionStorylineTablesReady, phase5MapFieldsReady] = await Promise.all([
        hasAllRequiredOpenWorldTables(),
        hasColumn("world_local_messages", "district_name"),
        hasColumn("world_local_messages", "dedupe_key"),
        hasColumn("world_map_instances", "meta_json"),
        hasColumn("player_world_event_offers", "responded_at"),
        hasRequiredOpenWorldTable("world_storylines"),
        hasColumn("world_map_instances", "heat_tier"),
      ]);
      const readyAfterBootstrap = baseTableReady
        && nearbyDistrictColumnReady
        && nearbyDedupeKeyReady
        && mapMetaJsonReady
        && playerWorldOfferRespondedAtReady
        && factionStorylineTablesReady
        && phase5MapFieldsReady;
      const status: OpenWorldSchemaStatus = {
        ready: readyAfterBootstrap,
        baseTableReady,
        nearbyDistrictColumnReady,
        nearbyDedupeKeyReady,
        playerWorldOfferRespondedAtReady,
        factionStorylineTablesReady,
        phase5MapFieldsReady,
        bootstrapMode: readyAfterBootstrap ? bootstrapMode : "failed",
        appliedFiles,
        checkedAt,
        fallbackReason: readyAfterBootstrap ? null : "开放世界表结构尚未完整就绪",
      };
      globalStore.__immortalityOpenWorldSchemaStatus = status;
      globalStore.__immortalityOpenWorldSchemaReady = readyAfterBootstrap;
      return readyAfterBootstrap;
    } catch (error) {
      console.error("Open world schema ensure error:", error);
      globalStore.__immortalityOpenWorldSchemaReady = false;
      globalStore.__immortalityOpenWorldSchemaStatus = {
        ...getDefaultOpenWorldSchemaStatus(),
        bootstrapMode: "failed",
        checkedAt: new Date().toISOString(),
        fallbackReason: error instanceof Error ? error.message : "开放世界表结构检查失败",
      };
      return false;
    } finally {
      globalStore.__immortalityOpenWorldSchemaEnsurePromise = undefined;
    }
  })();

  return globalStore.__immortalityOpenWorldSchemaEnsurePromise;
}
