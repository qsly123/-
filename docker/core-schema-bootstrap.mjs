import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置，无法执行核心表结构自举");
}

const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

async function hasTable(tableName) {
  const rows = await sql`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = ${tableName}
  `;
  return Number(rows[0]?.value || 0) > 0;
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

async function countPlayersWithMissingLastSeen() {
  const rows = await sql`
    select count(*)::int as value
    from "players"
    where "last_seen_at" is null
       or btrim("last_seen_at") = ''
  `;
  return Number(rows[0]?.value || 0);
}

async function countPlayersWithMissingIntegerColumn(columnName) {
  const rows = await sql.unsafe(`
    select count(*)::int as value
    from "players"
    where "${columnName}" is null
  `);
  return Number(rows[0]?.value || 0);
}

async function bootstrapPlayersLastSeenAt() {
  if (await hasColumn("players", "last_seen_at")) {
    return false;
  }

  await sql.begin(async (transaction) => {
    await transaction`
      alter table "players"
      add column if not exists "last_seen_at" text
    `;
    await transaction`
      alter table "players"
      alter column "last_seen_at" set default now()::text
    `;
    await transaction`
      update "players"
      set "last_seen_at" = coalesce(
        nullif("updated_at", ''),
        nullif("created_at", ''),
        now()::text
      )
      where "last_seen_at" is null
         or btrim("last_seen_at") = ''
    `;
    await transaction`
      alter table "players"
      alter column "last_seen_at" set not null
    `;
  });

  if (!(await hasColumn("players", "last_seen_at"))) {
    throw new Error("核心表结构自举执行后仍未检测到 players.last_seen_at");
  }

  const missingCount = await countPlayersWithMissingLastSeen();
  if (missingCount > 0) {
    throw new Error(`核心表结构自举执行后仍有 ${missingCount} 条 players.last_seen_at 为空`);
  }

  return true;
}

async function bootstrapPlayersIntegerColumn(columnName) {
  if (await hasColumn("players", columnName)) {
    return false;
  }

  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      alter table "players"
      add column if not exists "${columnName}" integer
    `);
    await transaction.unsafe(`
      update "players"
      set "${columnName}" = 0
      where "${columnName}" is null
    `);
    await transaction.unsafe(`
      alter table "players"
      alter column "${columnName}" set default 0
    `);
    await transaction.unsafe(`
      alter table "players"
      alter column "${columnName}" set not null
    `);
  });

  if (!(await hasColumn("players", columnName))) {
    throw new Error(`核心表结构自举执行后仍未检测到 players.${columnName}`);
  }

  const missingCount = await countPlayersWithMissingIntegerColumn(columnName);
  if (missingCount > 0) {
    throw new Error(`核心表结构自举执行后仍有 ${missingCount} 条 players.${columnName} 为空`);
  }

  return true;
}

async function bootstrapPlayersCoreColumns() {
  const hasPlayersTable = await hasTable("players");
  if (!hasPlayersTable) {
    console.log("[core-schema-bootstrap] 未检测到 players 核心表，跳过核心表结构自举。");
    return;
  }

  const bootstrappedColumns = [];

  if (await bootstrapPlayersLastSeenAt()) {
    bootstrappedColumns.push("players.last_seen_at");
  }

  for (const columnName of [
    "secret_realm_hongmeng_pity_counter",
    "wild_wolf_valley_mob_bottle_pity_counter",
    "wild_wolf_valley_boss_bottle_pity_counter",
  ]) {
    if (await bootstrapPlayersIntegerColumn(columnName)) {
      bootstrappedColumns.push(`players.${columnName}`);
    }
  }

  if (bootstrappedColumns.length === 0) {
    console.log("[core-schema-bootstrap] 玩家核心表结构已是最新状态，跳过自举。");
    return;
  }

  console.log(`[core-schema-bootstrap] 玩家核心表结构已完成自举，补齐列: ${bootstrappedColumns.join(", ")}`);
}

try {
  await bootstrapPlayersCoreColumns();
} finally {
  await sql.end();
}
