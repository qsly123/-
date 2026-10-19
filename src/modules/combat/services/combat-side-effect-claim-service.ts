import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { combatSideEffectClaims } from "@/db/schema";

const SIDE_EFFECT_RETRY_STALE_MS = 5_000;
type CombatSideEffectTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CombatSideEffectSchemaGlobal = typeof globalThis & {
  __immortalityCombatSideEffectSchemaSql?: ReturnType<typeof postgres>;
  __immortalityCombatSideEffectSchemaEnsurePromise?: Promise<boolean>;
  __immortalityCombatSideEffectSchemaReady?: boolean;
};

function getSchemaSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法初始化战斗副作用 claim 表。");
  }

  const globalStore = globalThis as CombatSideEffectSchemaGlobal;
  globalStore.__immortalityCombatSideEffectSchemaSql = globalStore.__immortalityCombatSideEffectSchemaSql || postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return globalStore.__immortalityCombatSideEffectSchemaSql;
}

export async function ensureCombatSideEffectClaimSchema() {
  const globalStore = globalThis as CombatSideEffectSchemaGlobal;
  if (globalStore.__immortalityCombatSideEffectSchemaReady) {
    return true;
  }
  if (globalStore.__immortalityCombatSideEffectSchemaEnsurePromise) {
    return globalStore.__immortalityCombatSideEffectSchemaEnsurePromise;
  }

  globalStore.__immortalityCombatSideEffectSchemaEnsurePromise = (async () => {
    try {
      const sql = getSchemaSqlClient();
      await sql.begin(async (transaction) => {
        await transaction.unsafe(`
          CREATE TABLE IF NOT EXISTS combat_side_effect_claims (
            id text PRIMARY KEY,
            effect_key text NOT NULL,
            combat_id text NOT NULL,
            player_id text REFERENCES players(id),
            effect_type text NOT NULL,
            status text NOT NULL DEFAULT 'pending',
            claimed_at text,
            created_at text NOT NULL DEFAULT now()::text,
            updated_at text NOT NULL DEFAULT now()::text
          )
        `);
        await transaction.unsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS combat_side_effect_claims_effect_key_unique
          ON combat_side_effect_claims (effect_key)
        `);
        await transaction.unsafe(`
          CREATE INDEX IF NOT EXISTS combat_side_effect_claims_combat_idx
          ON combat_side_effect_claims (combat_id)
        `);
        await transaction.unsafe(`
          CREATE INDEX IF NOT EXISTS combat_side_effect_claims_player_idx
          ON combat_side_effect_claims (player_id)
        `);
      });
      globalStore.__immortalityCombatSideEffectSchemaReady = true;
      return true;
    } catch (error) {
      console.error("Combat side effect claim schema ensure error:", error);
      globalStore.__immortalityCombatSideEffectSchemaReady = false;
      return false;
    } finally {
      globalStore.__immortalityCombatSideEffectSchemaEnsurePromise = undefined;
    }
  })();

  return globalStore.__immortalityCombatSideEffectSchemaEnsurePromise;
}

export async function runCombatSideEffectOnce(params: {
  effectKey: string;
  combatId: string;
  effectType: string;
  playerId?: string | null;
  task: () => Promise<unknown>;
  retryStaleMs?: number;
}) {
  const schemaReady = await ensureCombatSideEffectClaimSchema();
  if (!schemaReady) {
    await params.task();
    return { executed: true, replayed: false };
  }

  const retryStaleMs = Math.max(1_000, params.retryStaleMs ?? SIDE_EFFECT_RETRY_STALE_MS);
  const nowIso = new Date().toISOString();
  const existing = await db.select().from(combatSideEffectClaims).where(eq(combatSideEffectClaims.effectKey, params.effectKey)).get();
  if (existing?.status === "completed") {
    return { executed: false, replayed: true };
  }

  if (!existing) {
    await db.insert(combatSideEffectClaims).values({
      effectKey: params.effectKey,
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoNothing().run();
  } else if (
    existing.status === "pending"
    && nowIso
    && (Date.now() - Date.parse(existing.updatedAt || existing.createdAt || nowIso)) < retryStaleMs
  ) {
    return { executed: false, replayed: true };
  } else {
    await db.update(combatSideEffectClaims).set({
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "pending",
      updatedAt: nowIso,
    }).where(and(
      eq(combatSideEffectClaims.effectKey, params.effectKey),
      eq(combatSideEffectClaims.status, existing.status),
    )).run();
  }

  try {
    await params.task();
    await db.update(combatSideEffectClaims).set({
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "completed",
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(combatSideEffectClaims.effectKey, params.effectKey)).run();
    return { executed: true, replayed: false };
  } catch (error) {
    await db.update(combatSideEffectClaims).set({
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "pending",
      updatedAt: new Date().toISOString(),
    }).where(eq(combatSideEffectClaims.effectKey, params.effectKey)).run().catch(() => {});
    throw error;
  }
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

export async function runCombatSideEffectTransactionOnce<T>(params: {
  effectKey: string;
  combatId: string;
  effectType: string;
  playerId?: string | null;
  task: (tx: CombatSideEffectTx) => Promise<T>;
  retryStaleMs?: number;
}): Promise<{ executed: boolean; replayed: boolean; result: T | null }> {
  const schemaReady = await ensureCombatSideEffectClaimSchema();
  if (!schemaReady) {
    return {
      executed: true,
      replayed: false,
      result: await db.transaction((tx) => params.task(tx)),
    };
  }

  const retryStaleMs = Math.max(1_000, params.retryStaleMs ?? SIDE_EFFECT_RETRY_STALE_MS);
  return db.transaction(async (tx) => {
    const nowIso = new Date().toISOString();
    const insertedClaim = await tx.insert(combatSideEffectClaims).values({
      effectKey: params.effectKey,
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoNothing().returning({ id: combatSideEffectClaims.id }).get();

    const lockedRows = await tx.execute(sql<typeof combatSideEffectClaims.$inferSelect[]>`
      select
        id,
        effect_key as "effectKey",
        combat_id as "combatId",
        player_id as "playerId",
        effect_type as "effectType",
        status,
        claimed_at as "claimedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from combat_side_effect_claims
      where effect_key = ${params.effectKey}
      for update
    `);
    const claim = getRows<typeof combatSideEffectClaims.$inferSelect>(lockedRows)[0];
    if (!claim) {
      throw new Error("战斗副作用 claim 锁定失败");
    }

    if (claim.status === "completed") {
      return { executed: false, replayed: true, result: null };
    }

    const lastTouchedAt = Date.parse(claim.updatedAt || claim.createdAt || nowIso);
    if (
      !insertedClaim
      && claim.status === "pending"
      && Number.isFinite(lastTouchedAt)
      && Date.now() - lastTouchedAt < retryStaleMs
      && claim.combatId === params.combatId
      && claim.effectType === params.effectType
    ) {
      return { executed: false, replayed: true, result: null };
    }

    await tx.update(combatSideEffectClaims).set({
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "pending",
      updatedAt: nowIso,
    }).where(eq(combatSideEffectClaims.id, claim.id)).run();

    const result = await params.task(tx);
    const completedAt = new Date().toISOString();
    await tx.update(combatSideEffectClaims).set({
      combatId: params.combatId,
      playerId: params.playerId || null,
      effectType: params.effectType,
      status: "completed",
      claimedAt: completedAt,
      updatedAt: completedAt,
    }).where(eq(combatSideEffectClaims.id, claim.id)).run();

    return { executed: true, replayed: false, result };
  });
}
