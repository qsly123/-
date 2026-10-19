import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { playerHiddenCombatStats } from "@/db/schema";

type HiddenCombatStatsExecutor = Pick<typeof db, "execute" | "select">;
type HiddenCombatStatsRow = typeof playerHiddenCombatStats.$inferSelect;

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

function buildDefaultHiddenCombatStats(playerId: string): HiddenCombatStatsRow {
  const nowIso = new Date().toISOString();
  return {
    playerId,
    wildDefeatCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function getPlayerHiddenCombatStats(
  playerId: string,
  executor: HiddenCombatStatsExecutor = db,
): Promise<HiddenCombatStatsRow> {
  const row = await executor.select()
    .from(playerHiddenCombatStats)
    .where(eq(playerHiddenCombatStats.playerId, playerId))
    .get();

  if (!row) {
    return buildDefaultHiddenCombatStats(playerId);
  }

  return row;
}

export async function incrementPlayerDeathCount(
  playerId: string,
  executor: HiddenCombatStatsExecutor = db,
) {
  const nowIso = new Date().toISOString();
  const result = await executor.execute(sql`
    insert into "player_hidden_combat_stats" (
      "player_id",
      "wild_defeat_count",
      "created_at",
      "updated_at"
    )
    values (
      ${playerId},
      1,
      ${nowIso},
      ${nowIso}
    )
    on conflict ("player_id") do update
    set
      "wild_defeat_count" = "player_hidden_combat_stats"."wild_defeat_count" + 1,
      "updated_at" = ${nowIso}
    returning "wild_defeat_count"
  `);

  const [row] = getExecuteRows<{ wild_defeat_count?: unknown }>(result);
  const nextCount = Number(row?.wild_defeat_count ?? 0);
  return Number.isFinite(nextCount) ? Math.max(0, Math.floor(nextCount)) : 0;
}

export async function incrementWildDefeatCount(
  playerId: string,
  executor: HiddenCombatStatsExecutor = db,
) {
  return incrementPlayerDeathCount(playerId, executor);
}
