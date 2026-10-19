import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mapInstanceMonsters } from "@/db/schema";

type ColumnExecutor = {
  execute?: typeof db.execute;
};

type MutationExecutor = ColumnExecutor;
type MapInstanceMonsterInsertInput = typeof mapInstanceMonsters.$inferInsert;

let mapInstanceMonsterColumnSetCache: Set<string> | null = null;

function getExecuteRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }
  return [];
}

function normalizeInsertValue(value: unknown) {
  if (value === undefined) {
    return value;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function buildMapInstanceMonsterInsertEntries(input: MapInstanceMonsterInsertInput) {
  const id = input.id || randomUUID();
  return [
    ["id", id],
    ["instance_id", input.instanceId],
    ["monster_id", input.monsterId],
    ["role", input.role],
    ["rarity", input.rarity],
    ["spawn_x", input.spawnX],
    ["spawn_y", input.spawnY],
    ["reward_plan", input.rewardPlan],
    ["loot_blueprint_json", input.lootBlueprintJson],
    ["status", input.status],
    ["defeated_at", input.defeatedAt],
    ["created_at", input.createdAt],
    ["updated_at", input.updatedAt],
  ] as const;
}

export async function getMapInstanceMonsterColumnSet(executor: ColumnExecutor = db) {
  if (mapInstanceMonsterColumnSetCache) {
    return mapInstanceMonsterColumnSetCache;
  }

  const execute = typeof executor.execute === "function"
    ? executor.execute.bind(executor)
    : db.execute.bind(db);
  const result = await execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'map_instance_monsters'
  `);

  mapInstanceMonsterColumnSetCache = new Set(
    getExecuteRows<{ column_name?: string }>(result)
      .map((row) => String(row.column_name || "").trim())
      .filter(Boolean),
  );

  return mapInstanceMonsterColumnSetCache;
}

export async function supportsMapInstanceMonsterLootBlueprint(executor: ColumnExecutor = db) {
  const columnSet = await getMapInstanceMonsterColumnSet(executor);
  return columnSet.has("loot_blueprint_json");
}

export async function insertMapInstanceMonsterCompat(input: MapInstanceMonsterInsertInput, executor: MutationExecutor = db) {
  const columnSet = await getMapInstanceMonsterColumnSet(executor);
  const entries = buildMapInstanceMonsterInsertEntries(input)
    .map(([columnName, value]) => [columnName, normalizeInsertValue(value)] as const)
    .filter(([columnName, value]) => columnSet.has(columnName) && value !== undefined);

  if (!entries.length) {
    throw new Error("map_instance_monsters 表字段检查失败，无法插入实例怪物数据");
  }

  const execute = typeof executor.execute === "function"
    ? executor.execute.bind(executor)
    : db.execute.bind(db);

  await execute(sql`
    insert into "map_instance_monsters" (${sql.join(entries.map(([columnName]) => sql.identifier(columnName)), sql`, `)})
    values (${sql.join(entries.map(([, value]) => sql`${value}`), sql`, `)})
  `);
}
