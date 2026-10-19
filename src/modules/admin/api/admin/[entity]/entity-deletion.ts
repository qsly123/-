import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiGenerationJobs,
  aiMemories,
  accounts,
  bossInstances,
  cdkRedeemLogs,
  cdkCodes,
  chatMessages,
  combatLogs,
  dmConversationReads,
  dmConversations,
  dmMessages,
  mapEdges,
  mapInstanceMembers,
  mapInstanceMonsters,
  mapInstances,
  mapOpportunitySpawns,
  maps,
  marketListings,
  marketTradeRecords,
  monsters,
  npcs,
  oauthAccounts,
  partyEncounters,
  partyGroupMembers,
  partyGroups,
  partyInvites,
  playerAdultProfiles,
  playerCheckinLogs,
  playerCombatSettings,
  playerFortuneAttrLedger,
  playerFortunes,
  playerFriendships,
  playerHiddenCombatStats,
  playerIntimacyRelations,
  playerInventory,
  playerMails,
  playerHongmengTreasures,
  playerNpcBountyDaily,
  playerQuests,
  playerRandomEventCooldowns,
  playerSkills,
  playerSocialSettings,
  playerStatuses,
  playerTemporaryCosmeticGrants,
  playerUnlockedAvatarFrames,
  playerUnlockedAvatars,
  playerWorldEventOffers,
  playerWorldIncidents,
  playerWorldProfiles,
  players,
  quests,
  rechargeOrders,
  secretRealmRewardClaims,
  secretRealmRuns,
  secretRealmSpawns,
  sessions,
  storyProgress,
  temporaryMaps,
  temporaryMonsters,
  worldAdultEventLogs,
} from "@/db/schema";
import { forceCleanupSecretRealmInstances } from "@/modules/map/services/secret-realm-instance-service";

type DbErrorLike = {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
  cause?: unknown;
};

type SqlExecutor = Pick<typeof db, "execute">;
type FormatDeleteErrorOptions = {
  exposeConstraintDetails?: boolean;
};

const DELETE_RETRY_LIMIT = 2;

function getDbErrorInfo(error: unknown) {
  if (!error || typeof error !== "object") {
    return {};
  }

  const direct = error as DbErrorLike;
  const cause = direct.cause && typeof direct.cause === "object"
    ? direct.cause as DbErrorLike
    : undefined;

  return {
    code: typeof cause?.code === "string" ? cause.code : typeof direct.code === "string" ? direct.code : undefined,
    constraint: typeof cause?.constraint === "string"
      ? cause.constraint
      : typeof direct.constraint === "string"
        ? direct.constraint
        : undefined,
    detail: typeof cause?.detail === "string" ? cause.detail : typeof direct.detail === "string" ? direct.detail : undefined,
    message: typeof cause?.message === "string" ? cause.message : typeof direct.message === "string" ? direct.message : undefined,
  };
}

export function formatDeleteError(error: unknown, options: FormatDeleteErrorOptions = {}) {
  const info = getDbErrorInfo(error);
  if (info.code === "23503") {
    if (!options.exposeConstraintDetails) {
      return "删除失败：存在关联数据，请联系管理员处理";
    }
    const constraintInfo = info.constraint ? `（${info.constraint}）` : "";
    const detailInfo = info.detail ? `：${info.detail}` : "";
    return `删除失败：存在关联数据约束${constraintInfo}${detailInfo}`;
  }

  if (error instanceof Error) {
    if (error.message.includes("Failed query:")) {
      if (info.message) {
        return `删除失败：${info.message}`;
      }
      return "删除失败：数据库执行失败";
    }
    return error.message || "删除失败";
  }
  return "删除失败";
}

function buildSqlTextArray(values: string[]) {
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function shouldRetryDeleteTransaction(error: unknown) {
  const info = getDbErrorInfo(error);
  return info.code === "40P01" || info.code === "40001";
}

function getExecuteRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as Array<Record<string, unknown>>;
    }
  }

  return [];
}

async function doesTableExist(tx: SqlExecutor, tableName: string) {
  const result = await tx.execute(sql`select to_regclass(${`public.${tableName}`}) as table_name`);
  const [row] = getExecuteRows(result);
  return typeof row?.table_name === "string" && row.table_name.length > 0;
}

async function cleanupOptionalPlayerPluginRelations(tx: SqlExecutor, playerIds: string[]) {
  const playerIdArray = buildSqlTextArray(playerIds);

  if (await doesTableExist(tx, "player_alchemy_logs")) {
    await tx.execute(sql`DELETE FROM "player_alchemy_logs" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "player_smithing_logs")) {
    await tx.execute(sql`DELETE FROM "player_smithing_logs" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "player_double_cultivation_logs")) {
    await tx.execute(sql`
      DELETE FROM "player_double_cultivation_logs"
      WHERE "initiator_player_id" = ANY(${playerIdArray})
        OR "target_player_id" = ANY(${playerIdArray})
    `);
  }

  if (await doesTableExist(tx, "player_double_cultivation_requests")) {
    await tx.execute(sql`
      DELETE FROM "player_double_cultivation_requests"
      WHERE "player_a_id" = ANY(${playerIdArray})
        OR "player_b_id" = ANY(${playerIdArray})
        OR "requested_by" = ANY(${playerIdArray})
    `);
  }

  if (await doesTableExist(tx, "player_double_cultivation_daily")) {
    await tx.execute(sql`DELETE FROM "player_double_cultivation_daily" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "player_double_cultivation_player_stats")) {
    await tx.execute(sql`DELETE FROM "player_double_cultivation_player_stats" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "player_double_cultivation_sperm")) {
    await tx.execute(sql`DELETE FROM "player_double_cultivation_sperm" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "player_double_cultivation_uterus")) {
    await tx.execute(sql`DELETE FROM "player_double_cultivation_uterus" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "lundao_weekly_cosmetic_grants")) {
    await tx.execute(sql`DELETE FROM "lundao_weekly_cosmetic_grants" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "lundao_player_daily")) {
    await tx.execute(sql`DELETE FROM "lundao_player_daily" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "lundao_arena_slots")) {
    await tx.execute(sql`
      UPDATE "lundao_arena_slots"
      SET "player_id" = NULL
      WHERE "player_id" = ANY(${playerIdArray})
    `);
  }

  if (await doesTableExist(tx, "lundao_weekly_settlements")) {
    await tx.execute(sql`
      UPDATE "lundao_weekly_settlements"
      SET
        "top1_player_id" = CASE WHEN "top1_player_id" = ANY(${playerIdArray}) THEN NULL ELSE "top1_player_id" END,
        "top2_player_id" = CASE WHEN "top2_player_id" = ANY(${playerIdArray}) THEN NULL ELSE "top2_player_id" END,
        "top3_player_id" = CASE WHEN "top3_player_id" = ANY(${playerIdArray}) THEN NULL ELSE "top3_player_id" END
      WHERE "top1_player_id" = ANY(${playerIdArray})
         OR "top2_player_id" = ANY(${playerIdArray})
         OR "top3_player_id" = ANY(${playerIdArray})
    `);
  }

  if (await doesTableExist(tx, "plugin_spiritual_field_plots")) {
    await tx.execute(sql`DELETE FROM "plugin_spiritual_field_plots" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "plugin_spiritual_field_players")) {
    await tx.execute(sql`DELETE FROM "plugin_spiritual_field_players" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "plugin_gongfa_player_points")) {
    await tx.execute(sql`DELETE FROM "plugin_gongfa_player_points" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "plugin_gongfa_point_logs")) {
    await tx.execute(sql`DELETE FROM "plugin_gongfa_point_logs" WHERE "player_id" = ANY(${playerIdArray})`);
  }

  if (await doesTableExist(tx, "plugin_gongfa_player_progress")) {
    await tx.execute(sql`DELETE FROM "plugin_gongfa_player_progress" WHERE "player_id" = ANY(${playerIdArray})`);
  }
}

async function cleanupBossPlayerReferences(tx: SqlExecutor, playerIds: string[]) {
  for (const playerId of playerIds) {
    await tx.execute(sql`
      UPDATE "boss_instances"
      SET
        "damage_map" = COALESCE("damage_map", '{}'::jsonb) - ${playerId},
        "last_hit_player_id" = CASE
          WHEN "last_hit_player_id" = ${playerId} THEN NULL
          ELSE "last_hit_player_id"
        END
      WHERE "last_hit_player_id" = ${playerId}
         OR COALESCE("damage_map", '{}'::jsonb) ? ${playerId}
    `);
  }
}

async function deletePlayersWithRelationsOnce(playerIds: string[]) {
  await db.transaction(async (tx) => {
    const relatedConversations = await tx.select({ id: dmConversations.id }).from(dmConversations).where(or(
      inArray(dmConversations.playerAId, playerIds),
      inArray(dmConversations.playerBId, playerIds),
    )).all();
    const conversationIds = relatedConversations.map((row) => row.id);
    const ledPartyRows = await tx.select({ id: partyGroups.id }).from(partyGroups)
      .where(inArray(partyGroups.leaderPlayerId, playerIds))
      .all();
    const ledPartyIds = ledPartyRows.map((row) => row.id);
    const relatedMarketListingRows = await tx.select({ id: marketListings.id }).from(marketListings)
      .where(inArray(marketListings.sellerPlayerId, playerIds))
      .all();
    const relatedMarketListingIds = relatedMarketListingRows.map((row) => row.id);

    await tx.update(mapOpportunitySpawns)
      .set({ claimedByPlayerId: null })
      .where(inArray(mapOpportunitySpawns.claimedByPlayerId, playerIds))
      .run();
    await tx.delete(mapInstanceMembers)
      .where(inArray(mapInstanceMembers.playerId, playerIds))
      .run();
    await tx.update(mapInstances)
      .set({ ownerPlayerId: null })
      .where(inArray(mapInstances.ownerPlayerId, playerIds))
      .run();
    await tx.update(secretRealmSpawns)
      .set({ ownerPlayerId: null })
      .where(inArray(secretRealmSpawns.ownerPlayerId, playerIds))
      .run();
    await tx.update(secretRealmRuns)
      .set({ ownerPlayerId: null })
      .where(inArray(secretRealmRuns.ownerPlayerId, playerIds))
      .run();
    if (await doesTableExist(tx, "secret_realm_reward_claims")) {
      await tx.delete(secretRealmRewardClaims)
        .where(inArray(secretRealmRewardClaims.playerId, playerIds))
        .run();
    }
    await tx.delete(playerFriendships).where(or(
      inArray(playerFriendships.playerAId, playerIds),
      inArray(playerFriendships.playerBId, playerIds),
      inArray(playerFriendships.requestedBy, playerIds),
    )).run();
    await tx.delete(playerIntimacyRelations).where(or(
      inArray(playerIntimacyRelations.playerAId, playerIds),
      inArray(playerIntimacyRelations.playerBId, playerIds),
      inArray(playerIntimacyRelations.requestedBy, playerIds),
    )).run();
    await tx.delete(playerCombatSettings).where(inArray(playerCombatSettings.playerId, playerIds)).run();
    await tx.delete(playerHiddenCombatStats).where(inArray(playerHiddenCombatStats.playerId, playerIds)).run();
    await tx.delete(playerSocialSettings).where(inArray(playerSocialSettings.playerId, playerIds)).run();
    await tx.delete(playerHongmengTreasures).where(inArray(playerHongmengTreasures.playerId, playerIds)).run();
    await tx.delete(playerFortuneAttrLedger).where(inArray(playerFortuneAttrLedger.playerId, playerIds)).run();
    await tx.delete(playerFortunes).where(inArray(playerFortunes.playerId, playerIds)).run();
    await tx.delete(playerRandomEventCooldowns).where(inArray(playerRandomEventCooldowns.playerId, playerIds)).run();
    await tx.delete(playerSkills).where(inArray(playerSkills.playerId, playerIds)).run();
    await tx.delete(playerInventory).where(inArray(playerInventory.playerId, playerIds)).run();
    await tx.delete(playerTemporaryCosmeticGrants).where(inArray(playerTemporaryCosmeticGrants.playerId, playerIds)).run();
    await tx.delete(playerUnlockedAvatarFrames).where(inArray(playerUnlockedAvatarFrames.playerId, playerIds)).run();
    await tx.delete(playerUnlockedAvatars).where(inArray(playerUnlockedAvatars.playerId, playerIds)).run();
    await tx.delete(playerQuests).where(inArray(playerQuests.playerId, playerIds)).run();
    await tx.delete(storyProgress).where(inArray(storyProgress.playerId, playerIds)).run();
    await tx.delete(aiMemories).where(inArray(aiMemories.playerId, playerIds)).run();
    await tx.delete(cdkRedeemLogs).where(inArray(cdkRedeemLogs.playerId, playerIds)).run();
    await tx.delete(rechargeOrders).where(inArray(rechargeOrders.playerId, playerIds)).run();
    await tx.delete(playerCheckinLogs).where(inArray(playerCheckinLogs.playerId, playerIds)).run();
    await tx.delete(playerNpcBountyDaily).where(inArray(playerNpcBountyDaily.playerId, playerIds)).run();
    await tx.delete(playerMails).where(inArray(playerMails.playerId, playerIds)).run();
    await tx.delete(playerStatuses).where(inArray(playerStatuses.playerId, playerIds)).run();
    await tx.delete(worldAdultEventLogs).where(inArray(worldAdultEventLogs.playerId, playerIds)).run();
    await tx.delete(playerAdultProfiles).where(inArray(playerAdultProfiles.playerId, playerIds)).run();
    await tx.delete(playerWorldEventOffers).where(inArray(playerWorldEventOffers.playerId, playerIds)).run();
    await tx.delete(playerWorldIncidents).where(inArray(playerWorldIncidents.playerId, playerIds)).run();
    await tx.delete(playerWorldProfiles).where(inArray(playerWorldProfiles.playerId, playerIds)).run();
    await tx.delete(chatMessages).where(inArray(chatMessages.playerId, playerIds)).run();
    await tx.delete(combatLogs).where(inArray(combatLogs.playerId, playerIds)).run();
    await tx.delete(partyInvites).where(or(
      inArray(partyInvites.inviterId, playerIds),
      inArray(partyInvites.targetPlayerId, playerIds),
    )).run();
    await tx.delete(partyGroupMembers).where(inArray(partyGroupMembers.playerId, playerIds)).run();
    if (ledPartyIds.length > 0) {
      await tx.delete(partyInvites).where(inArray(partyInvites.partyId, ledPartyIds)).run();
      await tx.delete(partyEncounters).where(inArray(partyEncounters.partyId, ledPartyIds)).run();
      await tx.delete(partyGroupMembers).where(inArray(partyGroupMembers.partyId, ledPartyIds)).run();
      await tx.delete(partyGroups).where(inArray(partyGroups.id, ledPartyIds)).run();
    }
    await tx.delete(marketTradeRecords).where(or(
      inArray(marketTradeRecords.sellerPlayerId, playerIds),
      inArray(marketTradeRecords.buyerPlayerId, playerIds),
    )).run();
    if (relatedMarketListingIds.length > 0) {
      await tx.delete(marketTradeRecords).where(inArray(marketTradeRecords.listingId, relatedMarketListingIds)).run();
      await tx.delete(marketListings).where(inArray(marketListings.id, relatedMarketListingIds)).run();
    }
    await tx.delete(dmConversationReads).where(inArray(dmConversationReads.playerId, playerIds)).run();
    await tx.delete(dmMessages).where(inArray(dmMessages.senderPlayerId, playerIds)).run();
    if (conversationIds.length > 0) {
      await tx.delete(dmConversationReads).where(inArray(dmConversationReads.conversationId, conversationIds)).run();
      await tx.delete(dmMessages).where(inArray(dmMessages.conversationId, conversationIds)).run();
      await tx.delete(dmConversations).where(inArray(dmConversations.id, conversationIds)).run();
    }
    await cleanupBossPlayerReferences(tx, playerIds);
    await cleanupOptionalPlayerPluginRelations(tx, playerIds);

    if (playerIds.length === 1) {
      await tx.delete(players).where(eq(players.id, playerIds[0])).run();
    } else {
      await tx.delete(players).where(inArray(players.id, playerIds)).run();
    }
  });
}

export async function deletePlayersWithRelations(playerIds: string[]) {
  let lastError: unknown;

  for (let attempt = 0; attempt < DELETE_RETRY_LIMIT; attempt += 1) {
    try {
      await deletePlayersWithRelationsOnce(playerIds);
      return;
    } catch (error) {
      lastError = error;
      if (!shouldRetryDeleteTransaction(error) || attempt >= DELETE_RETRY_LIMIT - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  throw lastError;
}

export async function deleteAccountsWithRelations(accountIds: string[]) {
  const accountPlayers = await db.select({ id: players.id })
    .from(players)
    .where(inArray(players.accountId, accountIds))
    .all();
  const playerIds = accountPlayers.map((row) => row.id);

  if (playerIds.length > 0) {
    await deletePlayersWithRelations(playerIds);
  }

  await db.transaction(async (tx) => {
    const ownedCdkRows = await tx.select({ id: cdkCodes.id })
      .from(cdkCodes)
      .where(inArray(cdkCodes.createdBy, accountIds))
      .all();
    const ownedCdkIds = ownedCdkRows.map((row) => row.id);

    await tx.update(playerMails)
      .set({ sentBy: null })
      .where(inArray(playerMails.sentBy, accountIds))
      .run();
    await tx.delete(sessions).where(inArray(sessions.accountId, accountIds)).run();
    await tx.delete(oauthAccounts).where(inArray(oauthAccounts.accountId, accountIds)).run();
    await tx.delete(aiGenerationJobs).where(inArray(aiGenerationJobs.createdBy, accountIds)).run();

    if (ownedCdkIds.length > 0) {
      await tx.delete(cdkRedeemLogs).where(inArray(cdkRedeemLogs.cdkId, ownedCdkIds)).run();
      await tx.delete(cdkCodes).where(inArray(cdkCodes.id, ownedCdkIds)).run();
    }

    if (accountIds.length === 1) {
      await tx.delete(accounts).where(eq(accounts.id, accountIds[0])).run();
    } else {
      await tx.delete(accounts).where(inArray(accounts.id, accountIds)).run();
    }
  });
}

export async function deleteCdkCodesWithRelations(cdkIds: number[]) {
  await db.transaction(async (tx) => {
    await tx.delete(cdkRedeemLogs).where(inArray(cdkRedeemLogs.cdkId, cdkIds)).run();
    if (cdkIds.length === 1) {
      await tx.delete(cdkCodes).where(eq(cdkCodes.id, cdkIds[0])).run();
    } else {
      await tx.delete(cdkCodes).where(inArray(cdkCodes.id, cdkIds)).run();
    }
  });
}

export async function deleteNpcsWithRelations(npcIds: string[]) {
  await db.transaction(async (tx) => {
    const relatedQuestRows = await tx.select({ id: quests.id })
      .from(quests)
      .where(or(
        inArray(quests.acceptNpcId, npcIds),
        inArray(quests.completeNpcId, npcIds),
      ))
      .all();
    const relatedQuestIds = relatedQuestRows.map((row) => row.id);

    if (relatedQuestIds.length > 0) {
      await tx.delete(playerQuests).where(inArray(playerQuests.questId, relatedQuestIds)).run();
    }
    await tx.delete(aiMemories).where(inArray(aiMemories.npcId, npcIds)).run();
    await tx.delete(playerNpcBountyDaily).where(inArray(playerNpcBountyDaily.npcId, npcIds)).run();
    if (relatedQuestIds.length > 0) {
      await tx.delete(quests).where(inArray(quests.id, relatedQuestIds)).run();
    }

    if (npcIds.length === 1) {
      await tx.delete(npcs).where(eq(npcs.id, npcIds[0])).run();
    } else {
      await tx.delete(npcs).where(inArray(npcs.id, npcIds)).run();
    }
  });
}

export async function deleteMapsWithRelations(mapIds: string[]) {
  await db.transaction(async (tx) => {
    const mapNpcRows = await tx.select({ id: npcs.id })
      .from(npcs)
      .where(inArray(npcs.mapId, mapIds))
      .all();
    const mapNpcIds = mapNpcRows.map((row) => row.id);
    if (mapNpcIds.length > 0) {
      const relatedQuestRows = await tx.select({ id: quests.id })
        .from(quests)
        .where(or(
          inArray(quests.acceptNpcId, mapNpcIds),
          inArray(quests.completeNpcId, mapNpcIds),
        ))
        .all();
      const relatedQuestIds = relatedQuestRows.map((row) => row.id);

      if (relatedQuestIds.length > 0) {
        await tx.delete(playerQuests).where(inArray(playerQuests.questId, relatedQuestIds)).run();
      }
      await tx.delete(aiMemories).where(inArray(aiMemories.npcId, mapNpcIds)).run();
      await tx.delete(playerNpcBountyDaily).where(inArray(playerNpcBountyDaily.npcId, mapNpcIds)).run();
      if (relatedQuestIds.length > 0) {
        await tx.delete(quests).where(inArray(quests.id, relatedQuestIds)).run();
      }
      await tx.delete(npcs).where(inArray(npcs.id, mapNpcIds)).run();
    }

    await tx.delete(mapEdges)
      .where(or(inArray(mapEdges.mapAId, mapIds), inArray(mapEdges.mapBId, mapIds)))
      .run();
    await tx.delete(monsters).where(inArray(monsters.mapId, mapIds)).run();
    await tx.update(players).set({ currentMapId: null }).where(inArray(players.currentMapId, mapIds)).run();

    if (mapIds.length === 1) {
      await tx.delete(maps).where(eq(maps.id, mapIds[0])).run();
    } else {
      await tx.delete(maps).where(inArray(maps.id, mapIds)).run();
    }
  });
}

export async function deleteTemporaryMonstersWithRelations(monsterIds: string[]) {
  const uniqueMonsterIds = Array.from(new Set(monsterIds));
  if (uniqueMonsterIds.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    if (await doesTableExist(tx, "secret_realm_reward_claims")) {
      await tx.delete(secretRealmRewardClaims)
        .where(inArray(secretRealmRewardClaims.monsterId, uniqueMonsterIds))
        .run();
    }
    await tx.delete(bossInstances)
      .where(inArray(bossInstances.monsterId, uniqueMonsterIds))
      .run();
    await tx.delete(mapInstanceMonsters)
      .where(inArray(mapInstanceMonsters.monsterId, uniqueMonsterIds))
      .run();
    await tx.update(mapInstances)
      .set({ bossMonsterId: null })
      .where(inArray(mapInstances.bossMonsterId, uniqueMonsterIds))
      .run();

    if (uniqueMonsterIds.length === 1) {
      await tx.delete(temporaryMonsters).where(eq(temporaryMonsters.id, uniqueMonsterIds[0])).run();
    } else {
      await tx.delete(temporaryMonsters).where(inArray(temporaryMonsters.id, uniqueMonsterIds)).run();
    }
  });
}

export async function deleteTemporaryMapsWithRelations(mapIds: string[]) {
  const uniqueMapIds = Array.from(new Set(mapIds));
  if (uniqueMapIds.length === 0) {
    return;
  }

  const targetTemporaryMaps = await db.select({
    id: temporaryMaps.id,
    instanceId: temporaryMaps.instanceId,
  }).from(temporaryMaps)
    .where(inArray(temporaryMaps.id, uniqueMapIds))
    .all();

  const instanceIds = targetTemporaryMaps
    .map((row) => row.instanceId)
    .filter((value): value is string => Boolean(value));

  if (instanceIds.length > 0) {
    await forceCleanupSecretRealmInstances(instanceIds);
  }

  const remainingTargetMaps = await db.select({
    id: temporaryMaps.id,
    instanceId: temporaryMaps.instanceId,
  }).from(temporaryMaps)
    .where(inArray(temporaryMaps.id, uniqueMapIds))
    .all();

  const blockedMapIds = remainingTargetMaps
    .filter((row) => Boolean(row.instanceId))
    .map((row) => row.id);
  if (blockedMapIds.length > 0) {
    throw new Error(`仍有秘境实例占用这些临时地图，已停止删除: ${blockedMapIds.join(", ")}`);
  }

  const remainingMapIds = remainingTargetMaps.map((row) => row.id);
  const temporaryMonsterRows = remainingMapIds.length > 0
    ? await db.select({ id: temporaryMonsters.id })
      .from(temporaryMonsters)
      .where(inArray(temporaryMonsters.mapId, remainingMapIds))
      .all()
    : [];
  const temporaryMonsterIds = temporaryMonsterRows.map((row) => row.id);

  await db.transaction(async (tx) => {
    if (temporaryMonsterIds.length > 0 && remainingMapIds.length > 0) {
      if (await doesTableExist(tx, "secret_realm_reward_claims")) {
        await tx.delete(secretRealmRewardClaims)
          .where(inArray(secretRealmRewardClaims.monsterId, temporaryMonsterIds))
          .run();
      }
      await tx.delete(bossInstances)
        .where(inArray(bossInstances.monsterId, temporaryMonsterIds))
        .run();
      await tx.delete(mapInstanceMonsters)
        .where(inArray(mapInstanceMonsters.monsterId, temporaryMonsterIds))
        .run();
      await tx.delete(temporaryMonsters)
        .where(inArray(temporaryMonsters.id, temporaryMonsterIds))
        .run();
    }

    if (remainingMapIds.length > 0) {
      await tx.update(players)
        .set({ currentMapId: null, currentMapInstanceId: null })
        .where(inArray(players.currentMapId, remainingMapIds))
        .run();
    }

    if (remainingMapIds.length === 1) {
      await tx.delete(temporaryMaps).where(eq(temporaryMaps.id, remainingMapIds[0])).run();
    } else if (remainingMapIds.length > 1) {
      await tx.delete(temporaryMaps).where(inArray(temporaryMaps.id, remainingMapIds)).run();
    }
  });
}
