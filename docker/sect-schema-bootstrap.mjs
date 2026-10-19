import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置，无法执行宗门表结构自举");
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

async function bootstrapSectTables() {
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      create table if not exists "sects" (
        "id" text primary key,
        "name" text not null unique,
        "announcement" text,
        "description" text,
        "state" text not null default 'active',
        "external_map_id" text not null references "maps"("id"),
        "external_position_x" integer not null default 0,
        "external_position_y" integer not null default 0,
        "home_map_id" text not null references "maps"("id"),
        "founder_player_id" text not null references "players"("id"),
        "governor_player_id" text references "players"("id"),
        "level" integer not null default 1,
        "map_size" integer not null default 6,
        "member_limit" integer not null default 10,
        "storage_capacity" integer not null default 20,
        "join_approval_enabled" boolean not null default true,
        "visitor_approval_enabled" boolean not null default true,
        "empty_since_at" text,
        "governance_refreshed_at" text not null default now()::text,
        "created_at" text not null default now()::text,
        "updated_at" text not null default now()::text
      )
    `);

    await tx.unsafe(`
      alter table "sects"
      add column if not exists "empty_since_at" text
    `);

    await tx.unsafe(`
      create unique index if not exists "sects_home_map_unique_idx"
      on "sects" ("home_map_id")
    `);
    await tx.unsafe(`
      create unique index if not exists "sects_external_position_unique_idx"
      on "sects" ("external_map_id", "external_position_x", "external_position_y")
    `);
    await tx.unsafe(`
      create index if not exists "sects_state_idx"
      on "sects" ("state")
    `);
    await tx.unsafe(`
      create index if not exists "sects_empty_since_idx"
      on "sects" ("empty_since_at")
    `);
    await tx.unsafe(`
      create index if not exists "sects_founder_idx"
      on "sects" ("founder_player_id")
    `);
    await tx.unsafe(`
      create index if not exists "sects_governor_idx"
      on "sects" ("governor_player_id")
    `);

    await tx.unsafe(`
      create table if not exists "sect_members" (
        "player_id" text primary key references "players"("id"),
        "sect_id" text not null references "sects"("id"),
        "role_key" text not null default 'outer_disciple',
        "joined_at" text not null default now()::text,
        "appointed_by_player_id" text references "players"("id"),
        "updated_at" text not null default now()::text
      )
    `);
    await tx.unsafe(`
      create unique index if not exists "sect_members_sect_player_unique_idx"
      on "sect_members" ("sect_id", "player_id")
    `);
    await tx.unsafe(`
      create index if not exists "sect_members_sect_role_idx"
      on "sect_members" ("sect_id", "role_key")
    `);

    await tx.unsafe(`
      create table if not exists "sect_role_permissions" (
        "sect_id" text not null references "sects"("id"),
        "role_key" text not null,
        "permission_key" text not null,
        "enabled" boolean not null default true,
        "updated_at" text not null default now()::text,
        primary key ("sect_id", "role_key", "permission_key")
      )
    `);
    await tx.unsafe(`
      create index if not exists "sect_role_permissions_role_idx"
      on "sect_role_permissions" ("sect_id", "role_key")
    `);

    await tx.unsafe(`
      create table if not exists "sect_applications" (
        "id" text primary key,
        "sect_id" text not null references "sects"("id"),
        "player_id" text not null references "players"("id"),
        "type" text not null default 'join',
        "status" text not null default 'pending',
        "note" text,
        "reviewed_by_player_id" text references "players"("id"),
        "responded_at" text,
        "expires_at" text,
        "created_at" text not null default now()::text,
        "updated_at" text not null default now()::text
      )
    `);
    await tx.unsafe(`
      create index if not exists "sect_applications_sect_status_idx"
      on "sect_applications" ("sect_id", "type", "status")
    `);
    await tx.unsafe(`
      create index if not exists "sect_applications_player_status_idx"
      on "sect_applications" ("player_id", "status")
    `);

    await tx.unsafe(`
      create table if not exists "sect_buildings" (
        "sect_id" text not null references "sects"("id"),
        "building_type" text not null,
        "name" text not null,
        "level" integer not null default 1,
        "position_x" integer not null default 0,
        "position_y" integer not null default 0,
        "description" text,
        "meta" jsonb not null default '{}'::jsonb,
        "updated_at" text not null default now()::text,
        primary key ("sect_id", "building_type")
      )
    `);

    await tx.unsafe(`
      create table if not exists "sect_resources" (
        "sect_id" text primary key references "sects"("id"),
        "spirit_stone" integer not null default 0,
        "wood" integer not null default 0,
        "stone" integer not null default 0,
        "sect_material" integer not null default 0,
        "storage_capacity" integer not null default 20,
        "updated_at" text not null default now()::text
      )
    `);

    await tx.unsafe(`
      create table if not exists "sect_storage_items" (
        "id" integer generated always as identity primary key,
        "sect_id" text not null references "sects"("id"),
        "slot_index" integer not null,
        "item_id" text not null references "items"("id"),
        "quantity" integer not null default 1,
        "created_at" text not null default now()::text,
        "updated_at" text not null default now()::text
      )
    `);
    await tx.unsafe(`
      create unique index if not exists "sect_storage_items_slot_unique_idx"
      on "sect_storage_items" ("sect_id", "slot_index")
    `);
    await tx.unsafe(`
      create index if not exists "sect_storage_items_sect_idx"
      on "sect_storage_items" ("sect_id")
    `);

    await tx.unsafe(`
      create table if not exists "sect_logs" (
        "id" integer generated always as identity primary key,
        "sect_id" text not null references "sects"("id"),
        "actor_player_id" text references "players"("id"),
        "action_type" text not null,
        "detail" jsonb not null default '{}'::jsonb,
        "created_at" text not null default now()::text
      )
    `);
    await tx.unsafe(`
      create index if not exists "sect_logs_sect_created_idx"
      on "sect_logs" ("sect_id", "created_at")
    `);
  });
}

async function run() {
  const requiredTables = [
    "sects",
    "sect_members",
    "sect_role_permissions",
    "sect_applications",
    "sect_buildings",
    "sect_resources",
    "sect_storage_items",
    "sect_logs",
  ];
  const requiredColumns = [
    { tableName: "sects", columnName: "empty_since_at" },
  ];

  const missingBefore = [];
  for (const tableName of requiredTables) {
    if (!(await hasTable(tableName))) {
      missingBefore.push(tableName);
    }
  }
  const missingColumnsBefore = [];
  for (const entry of requiredColumns) {
    if (!(await hasColumn(entry.tableName, entry.columnName))) {
      missingColumnsBefore.push(`${entry.tableName}.${entry.columnName}`);
    }
  }

  if (missingBefore.length === 0 && missingColumnsBefore.length === 0) {
    console.log("[sect-schema-bootstrap] 宗门表结构已是最新状态，跳过自举。");
    return;
  }

  await bootstrapSectTables();

  const missingAfter = [];
  for (const tableName of requiredTables) {
    if (!(await hasTable(tableName))) {
      missingAfter.push(tableName);
    }
  }
  const missingColumnsAfter = [];
  for (const entry of requiredColumns) {
    if (!(await hasColumn(entry.tableName, entry.columnName))) {
      missingColumnsAfter.push(`${entry.tableName}.${entry.columnName}`);
    }
  }

  if (missingAfter.length > 0 || missingColumnsAfter.length > 0) {
    throw new Error(`宗门表结构自举后仍缺失内容: ${[...missingAfter, ...missingColumnsAfter].join(", ")}`);
  }

  const fixedTargets = [...missingBefore, ...missingColumnsBefore];
  console.log(`[sect-schema-bootstrap] 宗门表结构已完成自举，补齐内容: ${fixedTargets.join(", ")}`);
}

try {
  await run();
} finally {
  await sql.end();
}
