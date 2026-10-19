import type {
  BattleDeathPenaltyIntent,
  BattleDropIntent,
  BattleRewardIntent,
  BattleSettlementIntent,
} from "@immortality/game-rules";
import type { RealtimeInputRejectReason } from "@immortality/shared-protocol";
import { and, eq, sql } from "drizzle-orm";

export type CombatSettlementPersistenceResult = {
  attempted: boolean;
  persisted: boolean;
  alreadyProcessed: boolean;
  reason?: RealtimeInputRejectReason | "database_unavailable";
  rewardClaimId?: string | null;
  sideEffectClaimed?: boolean;
};

function assertDatabaseUrlConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未配置");
  }
}

type CombatSettlementTx = Parameters<Parameters<Awaited<ReturnType<typeof loadCombatSettlementDb>>["db"]["transaction"]>[0]>[0];

async function loadCombatSettlementDb() {
  assertDatabaseUrlConfigured();
  const { db, schema } = await import("../../../src/db");
  return {
    db,
    combatRewardClaims: schema.combatRewardClaims,
    combatSideEffectClaims: schema.combatSideEffectClaims,
    items: schema.items,
    mapInstanceMembers: schema.mapInstanceMembers,
    mapInstances: schema.mapInstances,
    players: schema.players,
    playerInventory: schema.playerInventory,
  };
}

function toRewardSnapshot(params: {
  rewardIntent: BattleRewardIntent;
  dropIntent: BattleDropIntent;
  settlementIntent: BattleSettlementIntent;
  grantedItems?: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    itemIconUrl?: string | null;
  }>;
}) {
  return {
    xp: params.rewardIntent.xp,
    gold: params.rewardIntent.gold,
    drops: (params.grantedItems || params.dropIntent.items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemId,
      quantity: item.quantity,
      itemSourceType: item.reason,
    }))).map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      itemIconUrl: "itemIconUrl" in item ? item.itemIconUrl || null : null,
      itemSourceType: "itemSourceType" in item ? item.itemSourceType : "claim",
    })),
    message: `colyseus_settlement_intent:${params.settlementIntent.idempotencyKey}`,
  };
}

function hasRewardValue(params: {
  rewardIntent: BattleRewardIntent;
  dropIntent: BattleDropIntent;
}) {
  return params.rewardIntent.source !== "none"
    && (
      params.rewardIntent.xp > 0
      || params.rewardIntent.gold > 0
      || params.dropIntent.items.length > 0
    );
}

function createDeathPenaltyEffectKey(intent: BattleDeathPenaltyIntent) {
  return [
    "battle-death-penalty",
    intent.mode,
    intent.battleId,
    intent.playerId,
    intent.reason,
  ].join(":");
}

/**
 * 玩家在秘境实例内战败时，死亡回返目标应为秘境返回点（成员记录里的 returnMapId），
 * 而不是通用复活点；同时必须把成员记录置为 left，否则实例会因为“仍有活跃成员”
 * 被 repairSecretRealmInstanceStatusIfNeeded 无限续命。
 */
async function resolveSecretRealmDeathExitTarget(params: {
  tx: CombatSettlementTx;
  settlementDb: Awaited<ReturnType<typeof loadCombatSettlementDb>>;
  playerId: string;
  nowIso: string;
}): Promise<{ mapId: string; positionX: number; positionY: number } | null> {
  const { mapInstanceMembers, mapInstances } = params.settlementDb;

  const memberRows = await params.tx.select({
    instanceId: mapInstanceMembers.instanceId,
    returnMapId: mapInstanceMembers.returnMapId,
    returnPositionX: mapInstanceMembers.returnPositionX,
    returnPositionY: mapInstanceMembers.returnPositionY,
  }).from(mapInstanceMembers).where(and(
    eq(mapInstanceMembers.playerId, params.playerId),
    eq(mapInstanceMembers.status, "active"),
  )).all();
  if (memberRows.length === 0) {
    return null;
  }

  const member = memberRows[0];
  const instance = await params.tx.select({
    id: mapInstances.id,
    status: mapInstances.status,
    sourceMapId: mapInstances.sourceMapId,
    sourcePositionX: mapInstances.sourcePositionX,
    sourcePositionY: mapInstances.sourcePositionY,
  }).from(mapInstances).where(eq(mapInstances.id, member.instanceId)).get();

  const targetMapId = member.returnMapId || instance?.sourceMapId || null;
  if (!targetMapId) {
    return null;
  }

  await params.tx.update(mapInstanceMembers).set({
    status: "left",
    leftAt: params.nowIso,
    lastSeenAt: params.nowIso,
  }).where(and(
    eq(mapInstanceMembers.instanceId, member.instanceId),
    eq(mapInstanceMembers.playerId, params.playerId),
  )).run();

  if (instance && instance.status !== "completed" && instance.status !== "settling") {
    const remainingMembers = await params.tx.select({
      playerId: mapInstanceMembers.playerId,
    }).from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, instance.id),
      eq(mapInstanceMembers.status, "active"),
    )).all();
    if (remainingMembers.length === 0) {
      await params.tx.update(mapInstances).set({
        status: "expired",
        expiresAt: new Date(Date.parse(params.nowIso) + 120_000).toISOString(),
        updatedAt: params.nowIso,
      }).where(eq(mapInstances.id, instance.id)).run();
    }
  }

  const useReturnPoint = Boolean(member.returnMapId);
  return {
    mapId: targetMapId,
    positionX: useReturnPoint ? member.returnPositionX : (instance?.sourcePositionX ?? 0),
    positionY: useReturnPoint ? member.returnPositionY : (instance?.sourcePositionY ?? 0),
  };
}

async function applyDeathPenaltySideEffect(params: {
  tx: CombatSettlementTx;
  settlementDb: Awaited<ReturnType<typeof loadCombatSettlementDb>>;
  deathPenaltyIntent: BattleDeathPenaltyIntent | null;
  deathPenaltyTarget: {
    mapId: string;
    positionX: number;
    positionY: number;
  } | null;
  nowIso: string;
  incrementPlayerDeathCount: (
    playerId: string,
    executor: Parameters<Parameters<Awaited<ReturnType<typeof loadCombatSettlementDb>>["db"]["transaction"]>[0]>[0],
  ) => Promise<number>;
}) {
  if (!params.deathPenaltyIntent?.shouldApply || !params.deathPenaltyIntent.playerId) {
    return false;
  }

  const effectKey = createDeathPenaltyEffectKey(params.deathPenaltyIntent);
  const [insertedSideEffect] = await params.tx.insert(params.settlementDb.combatSideEffectClaims).values({
    effectKey,
    combatId: params.deathPenaltyIntent.battleId,
    playerId: params.deathPenaltyIntent.playerId,
    effectType: "death_penalty",
    status: "pending",
    claimedAt: null,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  }).onConflictDoNothing().returning({
    id: params.settlementDb.combatSideEffectClaims.id,
  });
  const [sideEffect] = insertedSideEffect
    ? [insertedSideEffect]
    : await params.tx.select({
      id: params.settlementDb.combatSideEffectClaims.id,
      status: params.settlementDb.combatSideEffectClaims.status,
    }).from(params.settlementDb.combatSideEffectClaims).where(eq(
      params.settlementDb.combatSideEffectClaims.effectKey,
      effectKey,
    )).limit(1);

  if (sideEffect?.id && (!("status" in sideEffect) || sideEffect.status !== "completed") && params.deathPenaltyTarget) {
    await params.incrementPlayerDeathCount(params.deathPenaltyIntent.playerId, params.tx);
    const secretRealmExit = await resolveSecretRealmDeathExitTarget({
      tx: params.tx,
      settlementDb: params.settlementDb,
      playerId: params.deathPenaltyIntent.playerId,
      nowIso: params.nowIso,
    });
    const deathTarget = secretRealmExit || params.deathPenaltyTarget;
    await params.tx.update(params.settlementDb.players).set({
      hp: 1,
      mp: 1,
      currentMapId: deathTarget.mapId,
      currentMapInstanceId: null,
      positionX: deathTarget.positionX,
      positionY: deathTarget.positionY,
      updatedAt: params.nowIso,
    }).where(eq(params.settlementDb.players.id, params.deathPenaltyIntent.playerId)).run();
    await params.tx.update(params.settlementDb.combatSideEffectClaims).set({
      status: "completed",
      claimedAt: params.nowIso,
      updatedAt: params.nowIso,
    }).where(eq(params.settlementDb.combatSideEffectClaims.effectKey, effectKey)).run();
  }

  return Boolean(sideEffect?.id);
}

export async function executeCombatSettlementTransaction(params: {
  settlementIntent: BattleSettlementIntent;
  rewardIntent: BattleRewardIntent;
  dropIntent: BattleDropIntent;
  deathPenaltyIntent: BattleDeathPenaltyIntent | null;
  opponentType?: string;
  opponentId?: string | null;
}): Promise<CombatSettlementPersistenceResult> {
  let settlementDb: Awaited<ReturnType<typeof loadCombatSettlementDb>>;
  try {
    settlementDb = await loadCombatSettlementDb();
  } catch (error) {
    console.warn("[game-server] combat settlement persistence degraded", {
      battleId: params.settlementIntent.battleId,
      reason: error instanceof Error ? error.message : "database_unavailable",
    });
    return {
      attempted: false,
      persisted: false,
      alreadyProcessed: false,
      reason: "database_unavailable",
    };
  }

  const nowIso = new Date(params.settlementIntent.occurredAt).toISOString();
  const playerId = params.rewardIntent.playerId || params.settlementIntent.winnerId || params.settlementIntent.loserId;
  if (!playerId) {
    return {
      attempted: true,
      persisted: false,
      alreadyProcessed: false,
      reason: "missing_actor",
    };
  }

  try {
    const deathPenaltyTarget = params.deathPenaltyIntent?.shouldApply && params.deathPenaltyIntent.playerId
      ? await import("../../../src/modules/character/services/player-death-respawn")
        .then((mod) => mod.resolvePlayerDefeatRespawnTarget(params.deathPenaltyIntent!.playerId))
      : null;
    const { incrementPlayerDeathCount } = await import("../../../src/modules/combat/services/player-hidden-combat-stats");

    return await settlementDb.db.transaction(async (tx) => {
      const shouldGrantReward = hasRewardValue({
        rewardIntent: params.rewardIntent,
        dropIntent: params.dropIntent,
      });
      const [player] = await tx.select({
        id: settlementDb.players.id,
      }).from(settlementDb.players).where(eq(settlementDb.players.id, playerId)).limit(1);
      if (!player) {
        return {
          attempted: true,
          persisted: false,
          alreadyProcessed: false,
          reason: "missing_actor",
        } satisfies CombatSettlementPersistenceResult;
      }

      const [insertedRewardClaim] = await tx.insert(settlementDb.combatRewardClaims).values({
        combatId: params.settlementIntent.battleId,
        playerId,
        opponentType: params.opponentType || params.settlementIntent.mode,
        opponentId: params.opponentId || null,
        status: "pending",
        rewardSnapshot: toRewardSnapshot({
          rewardIntent: params.rewardIntent,
          dropIntent: params.dropIntent,
          settlementIntent: params.settlementIntent,
        }),
        claimedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }).onConflictDoNothing().returning({
        id: settlementDb.combatRewardClaims.id,
      });

      if (!insertedRewardClaim?.id) {
        const [existingReward] = await tx.select({
          id: settlementDb.combatRewardClaims.id,
        }).from(settlementDb.combatRewardClaims).where(and(
          eq(settlementDb.combatRewardClaims.combatId, params.settlementIntent.battleId),
          eq(settlementDb.combatRewardClaims.playerId, playerId),
        )).limit(1);
        const sideEffectClaimed = await applyDeathPenaltySideEffect({
          tx,
          settlementDb,
          deathPenaltyIntent: params.deathPenaltyIntent,
          deathPenaltyTarget,
          nowIso,
          incrementPlayerDeathCount,
        });

        return {
          attempted: true,
          persisted: true,
          alreadyProcessed: true,
          rewardClaimId: existingReward?.id || null,
          sideEffectClaimed,
        } satisfies CombatSettlementPersistenceResult;
      }

      const grantedItems: Array<{
        itemId: string;
        itemName: string;
        quantity: number;
        itemIconUrl?: string | null;
      }> = [];

      if (shouldGrantReward) {
        if (params.rewardIntent.xp > 0 || params.rewardIntent.gold > 0) {
          await tx.update(settlementDb.players).set({
            cultivationXp: sql`${settlementDb.players.cultivationXp} + ${params.rewardIntent.xp}`,
            gold: sql`${settlementDb.players.gold} + ${params.rewardIntent.gold}`,
            updatedAt: nowIso,
          }).where(eq(settlementDb.players.id, playerId)).run();
        }

        for (const drop of params.dropIntent.items) {
          const [item] = await tx.select({
            name: settlementDb.items.name,
            iconUrl: settlementDb.items.iconUrl,
          }).from(settlementDb.items).where(eq(settlementDb.items.id, drop.itemId)).limit(1);
          if (!item) {
            throw new Error(`settlement_drop_item_missing:${drop.itemId}`);
          }

          await tx.insert(settlementDb.playerInventory).values({
            playerId,
            itemId: drop.itemId,
            quantity: drop.quantity,
          }).onConflictDoUpdate({
            target: [
              settlementDb.playerInventory.playerId,
              settlementDb.playerInventory.itemId,
            ],
            set: {
              quantity: sql`${settlementDb.playerInventory.quantity} + ${drop.quantity}`,
            },
          }).run();

          grantedItems.push({
            itemId: drop.itemId,
            itemName: item.name,
            quantity: drop.quantity,
            itemIconUrl: item.iconUrl || null,
          });
        }
      }

      await tx.update(settlementDb.combatRewardClaims).set({
        status: shouldGrantReward ? "claimed" : "no_reward",
        rewardSnapshot: toRewardSnapshot({
          rewardIntent: params.rewardIntent,
          dropIntent: params.dropIntent,
          settlementIntent: params.settlementIntent,
          grantedItems,
        }),
        claimedAt: shouldGrantReward ? nowIso : null,
        updatedAt: nowIso,
      }).where(eq(settlementDb.combatRewardClaims.id, insertedRewardClaim.id)).run();

      let sideEffectClaimed = false;
      if (params.deathPenaltyIntent?.shouldApply && params.deathPenaltyIntent.playerId) {
        sideEffectClaimed = await applyDeathPenaltySideEffect({
          tx,
          settlementDb,
          deathPenaltyIntent: params.deathPenaltyIntent,
          deathPenaltyTarget,
          nowIso,
          incrementPlayerDeathCount,
        });
      } else if (params.settlementIntent.idempotencyKey) {
        await tx.insert(settlementDb.combatSideEffectClaims).values({
          effectKey: params.settlementIntent.idempotencyKey,
          combatId: params.settlementIntent.battleId,
          playerId,
          effectType: "settlement_intent",
          status: "completed",
          claimedAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        }).onConflictDoNothing();
        sideEffectClaimed = true;
      }

      return {
        attempted: true,
        persisted: true,
        alreadyProcessed: false,
        rewardClaimId: insertedRewardClaim.id,
        sideEffectClaimed,
      } satisfies CombatSettlementPersistenceResult;
    });
  } catch (error) {
    console.warn("[game-server] combat settlement persistence degraded", {
      battleId: params.settlementIntent.battleId,
      reason: error instanceof Error ? error.message : "database_unavailable",
    });
    return {
      attempted: true,
      persisted: false,
      alreadyProcessed: false,
      reason: "database_unavailable",
    };
  }
}
