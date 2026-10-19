import postgres from "postgres";

type PlayerInventoryIntegrityGlobalStore = typeof globalThis & {
  __immortalityPlayerInventorySql?: ReturnType<typeof postgres>;
  __immortalityPlayerInventoryEnsurePromise?: Promise<boolean>;
  __immortalityPlayerInventoryReady?: boolean;
  __immortalityPlayerInventoryCheckedAt?: string | null;
};

const PLAYER_INVENTORY_TABLE = "player_inventory";
const PLAYER_INVENTORY_UNIQUE_INDEX = "player_inventory_player_item_unique_idx";

function getInventorySqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法校验背包唯一约束");
  }

  const globalStore = globalThis as PlayerInventoryIntegrityGlobalStore;
  globalStore.__immortalityPlayerInventorySql = globalStore.__immortalityPlayerInventorySql || postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return globalStore.__immortalityPlayerInventorySql;
}

async function hasPlayerInventoryTable() {
  const sql = getInventorySqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from information_schema.tables
    where table_schema = 'public'
      and table_name = ${PLAYER_INVENTORY_TABLE}
  `;
  return Number(rows[0]?.value || 0) > 0;
}

async function hasPlayerInventoryUniqueIndex() {
  const sql = getInventorySqlClient();
  const rows = await sql<{ value: number }[]>`
    select count(*)::int as value
    from pg_indexes
    where schemaname = 'public'
      and tablename = ${PLAYER_INVENTORY_TABLE}
      and indexname = ${PLAYER_INVENTORY_UNIQUE_INDEX}
  `;
  return Number(rows[0]?.value || 0) > 0;
}

async function dedupePlayerInventoryRows() {
  const sql = getInventorySqlClient();
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      WITH duplicated AS (
        SELECT
          player_id,
          item_id,
          SUM(quantity)::int AS total_quantity,
          BOOL_OR(equipped) AS any_equipped,
          (
            ARRAY_REMOVE(
              ARRAY_AGG(equip_slot ORDER BY equipped DESC, ctid),
              NULL
            )
          )[1] AS selected_equip_slot,
          MIN(ctid)::text AS keep_ctid
        FROM public.player_inventory
        GROUP BY player_id, item_id
        HAVING COUNT(*) > 1
      )
      UPDATE public.player_inventory AS inventory
      SET
        quantity = duplicated.total_quantity,
        equipped = duplicated.any_equipped,
        equip_slot = CASE
          WHEN duplicated.any_equipped THEN duplicated.selected_equip_slot
          ELSE NULL
        END
      FROM duplicated
      WHERE inventory.ctid::text = duplicated.keep_ctid
    `);

    await tx.unsafe(`
      WITH duplicated AS (
        SELECT
          player_id,
          item_id,
          MIN(ctid)::text AS keep_ctid
        FROM public.player_inventory
        GROUP BY player_id, item_id
        HAVING COUNT(*) > 1
      )
      DELETE FROM public.player_inventory AS inventory
      USING duplicated
      WHERE inventory.player_id = duplicated.player_id
        AND inventory.item_id = duplicated.item_id
        AND inventory.ctid::text <> duplicated.keep_ctid
    `);

    await tx.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${PLAYER_INVENTORY_UNIQUE_INDEX}
      ON public.player_inventory ("player_id", "item_id")
    `);
  });
}

export async function ensurePlayerInventoryIntegrity() {
  const globalStore = globalThis as PlayerInventoryIntegrityGlobalStore;
  if (globalStore.__immortalityPlayerInventoryReady) {
    return true;
  }
  if (globalStore.__immortalityPlayerInventoryEnsurePromise) {
    return globalStore.__immortalityPlayerInventoryEnsurePromise;
  }

  globalStore.__immortalityPlayerInventoryEnsurePromise = (async () => {
    try {
      if (!(await hasPlayerInventoryTable())) {
        globalStore.__immortalityPlayerInventoryReady = false;
        globalStore.__immortalityPlayerInventoryCheckedAt = new Date().toISOString();
        return false;
      }

      if (!(await hasPlayerInventoryUniqueIndex())) {
        await dedupePlayerInventoryRows();
      }

      const ready = await hasPlayerInventoryUniqueIndex();
      globalStore.__immortalityPlayerInventoryReady = ready;
      globalStore.__immortalityPlayerInventoryCheckedAt = new Date().toISOString();
      return ready;
    } catch (error) {
      console.error("[player-inventory-integrity] ensure failed:", error);
      globalStore.__immortalityPlayerInventoryReady = false;
      globalStore.__immortalityPlayerInventoryCheckedAt = new Date().toISOString();
      return false;
    } finally {
      globalStore.__immortalityPlayerInventoryEnsurePromise = undefined;
    }
  })();

  return globalStore.__immortalityPlayerInventoryEnsurePromise;
}
