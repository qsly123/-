import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { combatRewardClaims } from "@/db/schema";
import type { CombatSettleResultSnapshot } from "@/types/game";

type CombatRewardClaimTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CombatRewardClaimSchemaGlobal = typeof globalThis & {
  __immortalityCombatRewardClaimSchemaSql?: ReturnType<typeof postgres>;
  __immortalityCombatRewardClaimSchemaEnsurePromise?: Promise<boolean>;
  __immortalityCombatRewardClaimSchemaReady?: boolean;
};

function getSchemaSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法初始化战斗奖励 claim 表。");
  }

  const globalStore = globalThis as CombatRewardClaimSchemaGlobal;
  globalStore.__immortalityCombatRewardClaimSchemaSql = globalStore.__immortalityCombatRewardClaimSchemaSql || postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return globalStore.__immortalityCombatRewardClaimSchemaSql;
}

export async function ensureCombatRewardClaimSchema() {
  const globalStore = globalThis as CombatRewardClaimSchemaGlobal;
  if (globalStore.__immortalityCombatRewardClaimSchemaReady) {
    return true;
  }
  if (globalStore.__immortalityCombatRewardClaimSchemaEnsurePromise) {
    return globalStore.__immortalityCombatRewardClaimSchemaEnsurePromise;
  }

  globalStore.__immortalityCombatRewardClaimSchemaEnsurePromise = (async () => {
    try {
      const sql = getSchemaSqlClient();
      await sql.begin(async (transaction) => {
        await transaction.unsafe(`
          CREATE TABLE IF NOT EXISTS combat_reward_claims (
            id text PRIMARY KEY,
            combat_id text NOT NULL,
            player_id text NOT NULL REFERENCES players(id),
            opponent_type text NOT NULL DEFAULT 'monster',
            opponent_id text,
            status text NOT NULL DEFAULT 'pending',
            reward_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
            claimed_at text,
            created_at text NOT NULL DEFAULT now()::text,
            updated_at text NOT NULL DEFAULT now()::text
          )
        `);
        await transaction.unsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS combat_reward_claims_combat_player_unique
          ON combat_reward_claims (combat_id, player_id)
        `);
        await transaction.unsafe(`
          CREATE INDEX IF NOT EXISTS combat_reward_claims_player_idx
          ON combat_reward_claims (player_id)
        `);
        await transaction.unsafe(`
          CREATE INDEX IF NOT EXISTS combat_reward_claims_opponent_idx
          ON combat_reward_claims (opponent_type, opponent_id)
        `);
      });
      globalStore.__immortalityCombatRewardClaimSchemaReady = true;
      return true;
    } catch (error) {
      console.error("Combat reward claim schema ensure error:", error);
      globalStore.__immortalityCombatRewardClaimSchemaReady = false;
      return false;
    } finally {
      globalStore.__immortalityCombatRewardClaimSchemaEnsurePromise = undefined;
    }
  })();

  return globalStore.__immortalityCombatRewardClaimSchemaEnsurePromise;
}

export async function getCombatRewardClaim(params: {
  combatId: string;
  playerId: string;
}) {
  if (!(await ensureCombatRewardClaimSchema())) {
    return null;
  }

  return db.select().from(combatRewardClaims).where(and(
    eq(combatRewardClaims.combatId, params.combatId),
    eq(combatRewardClaims.playerId, params.playerId),
  )).get();
}

function getRows<T>(result: unknown): T[] {
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

export async function lockCombatRewardClaimForUpdateTx(params: {
  tx: CombatRewardClaimTx;
  combatId: string;
  playerId: string;
}) {
  const rows = await params.tx.execute(sql<typeof combatRewardClaims.$inferSelect[]>`
    select
      id,
      combat_id as "combatId",
      player_id as "playerId",
      opponent_type as "opponentType",
      opponent_id as "opponentId",
      status,
      reward_snapshot as "rewardSnapshot",
      claimed_at as "claimedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from combat_reward_claims
    where combat_id = ${params.combatId}
      and player_id = ${params.playerId}
    for update
  `);
  return getRows<typeof combatRewardClaims.$inferSelect>(rows)[0] || null;
}

export function readCombatRewardClaimSnapshot(claim?: {
  rewardSnapshot?: CombatSettleResultSnapshot | null;
} | null) {
  return (claim?.rewardSnapshot || null) as CombatSettleResultSnapshot | null;
}
