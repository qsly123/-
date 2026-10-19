import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { dmConversations, playerFriendships, playerSocialSettings, players } from "@/db/schema";
import { normalizePairPlayerIds, type DmPermission } from "@/modules/social/domain/social-types";

export interface SimplePlayerProfile {
  id: string;
  name: string;
  realmName: string;
}

export function parseOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export async function findPlayerByIdOrName(input: {
  targetPlayerId?: unknown;
  targetName?: unknown;
}) {
  const targetPlayerId = parseOptionalText(input.targetPlayerId);
  if (targetPlayerId) {
    const byId = await db.select({
      id: players.id,
      name: players.name,
      realmName: players.realmName,
    }).from(players).where(eq(players.id, targetPlayerId)).get();
    if (byId) {
      return byId;
    }
  }

  const targetName = parseOptionalText(input.targetName);
  if (!targetName) {
    return null;
  }

  return db.select({
    id: players.id,
    name: players.name,
    realmName: players.realmName,
  }).from(players).where(eq(players.name, targetName)).get();
}

export async function getPlayerMapByIds(playerIds: string[]) {
  if (!playerIds.length) {
    return new Map<string, SimplePlayerProfile>();
  }

  const uniqueIds = [...new Set(playerIds.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map<string, SimplePlayerProfile>();
  }

  const rows = await db.select({
    id: players.id,
    name: players.name,
    realmName: players.realmName,
  }).from(players).where(inArray(players.id, uniqueIds)).all();

  return new Map(rows.map((row) => [row.id, row]));
}

export async function getAcceptedFriendshipByPair(playerId: string, targetPlayerId: string) {
  const pair = normalizePairPlayerIds(playerId, targetPlayerId);
  return db.select({
    id: playerFriendships.id,
    status: playerFriendships.status,
  }).from(playerFriendships).where(and(
    eq(playerFriendships.playerAId, pair.playerAId),
    eq(playerFriendships.playerBId, pair.playerBId),
    eq(playerFriendships.status, "accepted"),
  )).get();
}

export async function getConversationByPair(playerId: string, targetPlayerId: string) {
  const pair = normalizePairPlayerIds(playerId, targetPlayerId);
  return db.select().from(dmConversations).where(and(
    eq(dmConversations.playerAId, pair.playerAId),
    eq(dmConversations.playerBId, pair.playerBId),
  )).get();
}

export async function getPlayerDmPermission(playerId: string): Promise<DmPermission> {
  const setting = await db.select({
    dmPermission: playerSocialSettings.dmPermission,
  }).from(playerSocialSettings).where(eq(playerSocialSettings.playerId, playerId)).get();

  if (!setting) {
    return "friends";
  }

  if (setting.dmPermission === "all" || setting.dmPermission === "none") {
    return setting.dmPermission;
  }
  return "friends";
}

export async function getConversationByIdForPlayer(conversationId: string, playerId: string) {
  return db.select().from(dmConversations).where(and(
    eq(dmConversations.id, conversationId),
    or(
      eq(dmConversations.playerAId, playerId),
      eq(dmConversations.playerBId, playerId),
    ),
  )).get();
}
