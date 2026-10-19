import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  partyEncounters,
  partyGroupMembers,
  partyGroups,
  partyInvites,
  players,
} from "@/db/schema";
import { calculateCombatPower } from "@/modules/character/services/combat-power";
import { getPlayerByIdCompat, getPlayersByIdsCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { getMonsterPositionSnapshot } from "@/modules/map/services/monster-position";
import { getRuntimeMonsterById } from "@/modules/map/services/runtime-monster-store";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import type {
  PartyEncounterView,
  PartyGroupStatus,
  PartyInviteStatus,
  PartyInviteView,
  PartyMemberView,
  PartySnapshot,
  PartyView,
} from "@/modules/social/domain/party-types";
import type { CombatState, CombatTurnState } from "@/types/game";

const MAX_PARTY_MEMBERS = 3;
const PARTY_INVITE_TTL_MS = 2 * 60 * 1000;

type PlayerPresenceRecord = {
  id: string;
  name: string;
  gender: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string;
  currentMapId: string | null;
  positionX: number;
  positionY: number;
};

type PartyEncounterStatus = "ongoing" | "resolved" | "abandoned";

type PartyEncounterRow = typeof partyEncounters.$inferSelect;
type PartyGroupRow = typeof partyGroups.$inferSelect;
type PartyInviteRow = typeof partyInvites.$inferSelect;
type PartyGroupMemberRow = typeof partyGroupMembers.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function isExpiredIsoTimestamp(value: string, nowMs = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return timestamp <= nowMs;
}

function buildEncounterRoutePath(encounter: {
  encounterType: string;
  monsterId: string;
  id: string;
}) {
  if (encounter.encounterType === "boss") {
    return `/game/boss/${encounter.monsterId}?partyCombatId=${encodeURIComponent(encounter.id)}`;
  }
  return `/game/combat/${encounter.monsterId}?partyCombatId=${encodeURIComponent(encounter.id)}`;
}

function parseCombatState(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as CombatState;
}

function parseTurnState(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as CombatTurnState;
}

function normalizeEncounterEligibleMemberIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function getEncounterSettledPlayerIds(
  state: CombatState | null,
  eligibleMemberIds: string[],
) {
  const settled = new Set<string>();
  if (Array.isArray(state?.settledPlayerIds)) {
    for (const playerId of state.settledPlayerIds) {
      if (typeof playerId === "string" && playerId.trim()) {
        settled.add(playerId.trim());
      }
    }
  }
  if (state?.status === "player_win" && Array.isArray(state.rewards)) {
    for (const reward of state.rewards) {
      const playerId = typeof reward?.playerId === "string" ? reward.playerId.trim() : "";
      if (playerId) {
        settled.add(playerId);
      }
    }
  }

  if (!eligibleMemberIds.length) {
    return Array.from(settled);
  }
  return eligibleMemberIds.filter((playerId) => settled.has(playerId));
}

function shouldKeepResolvedEncounterActive(params: {
  status: PartyEncounterStatus;
  state: CombatState | null;
  eligibleMemberIds: string[];
}) {
  if (params.status !== "resolved") {
    return false;
  }
  if (!params.state) {
    return false;
  }
  if (!params.eligibleMemberIds.length) {
    return false;
  }
  return getEncounterSettledPlayerIds(params.state, params.eligibleMemberIds).length < params.eligibleMemberIds.length;
}

async function getPlayerPresenceMap(playerIds: string[]) {
  const uniqueIds = [...new Set(playerIds.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map<string, PlayerPresenceRecord>();
  }

  const rows = await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
  }).from(players).where(inArray(players.id, uniqueIds)).all();

  return new Map(rows.map((row) => [row.id, row]));
}

function arePlayersAdjacent(left: PlayerPresenceRecord, right: PlayerPresenceRecord) {
  if ((left.currentMapId || "") !== (right.currentMapId || "")) {
    return false;
  }

  return Math.max(
    Math.abs(left.positionX - right.positionX),
    Math.abs(left.positionY - right.positionY),
  ) <= 1;
}

async function getPartyMembershipRows(partyId: string) {
  return db.select().from(partyGroupMembers)
    .where(eq(partyGroupMembers.partyId, partyId))
    .all();
}

async function getActivePartyById(partyId: string) {
  return (await db.select().from(partyGroups)
    .where(and(
      eq(partyGroups.id, partyId),
      eq(partyGroups.status, "active"),
    ))
    .get()) ?? null;
}

async function healPartyGroupState(party: PartyGroupRow): Promise<PartyGroupRow | null> {
  const memberRows = (await getPartyMembershipRows(party.id))
    .slice()
    .sort((left, right) => left.slotOrder - right.slotOrder);

  if (!memberRows.length) {
    await disbandParty(party.id);
    return null;
  }

  const playerMap = await getPlayerPresenceMap(memberRows.map((member) => member.playerId));
  const validMemberRows = memberRows.filter((member) => playerMap.has(member.playerId));
  const invalidMemberIds = memberRows
    .filter((member) => !playerMap.has(member.playerId))
    .map((member) => member.playerId);

  if (invalidMemberIds.length > 0) {
    await db.delete(partyGroupMembers).where(and(
      eq(partyGroupMembers.partyId, party.id),
      inArray(partyGroupMembers.playerId, invalidMemberIds),
    )).run();
  }

  if (!validMemberRows.length) {
    await disbandParty(party.id);
    return null;
  }

  const orderedMemberIds = validMemberRows.map((member) => member.playerId);
  const nextLeaderPlayerId = orderedMemberIds.includes(party.leaderPlayerId)
    ? party.leaderPlayerId
    : orderedMemberIds[0];
  const needsReorder = validMemberRows.some((member, index) => member.slotOrder !== index);
  const leaderChanged = nextLeaderPlayerId !== party.leaderPlayerId;

  if (needsReorder) {
    await reorderPartyMembers(party.id, orderedMemberIds);
  }

  if (invalidMemberIds.length > 0 || needsReorder || leaderChanged) {
    if (leaderChanged) {
      await cancelPendingInvitesForParty(party.id);
    }
    await db.update(partyGroups).set({
      leaderPlayerId: nextLeaderPlayerId,
      updatedAt: nowIso(),
    }).where(eq(partyGroups.id, party.id)).run();

    return await getActivePartyById(party.id);
  }

  return party;
}

export async function getPartyMovementContext(playerId: string) {
  const party = await getPartyGroupByPlayerId(playerId);
  if (!party) {
    return null;
  }

  const memberRows = await getPartyMembershipRows(party.id);
  const orderedMemberRows = memberRows
    .slice()
    .sort((left, right) => left.slotOrder - right.slotOrder);
  const playerMap = await getPlayerPresenceMap(orderedMemberRows.map((member) => member.playerId));
  const members = orderedMemberRows
    .map((member) => playerMap.get(member.playerId))
    .filter((member): member is PlayerPresenceRecord => Boolean(member));

  return {
    partyId: party.id,
    leaderPlayerId: party.leaderPlayerId,
    members,
  };
}

async function getPendingInviteRows() {
  return db.select().from(partyInvites)
    .where(eq(partyInvites.status, "pending"))
    .all();
}

async function getPendingInviteRowsByTargetPlayerId(targetPlayerId: string) {
  return db.select().from(partyInvites)
    .where(and(
      eq(partyInvites.targetPlayerId, targetPlayerId),
      eq(partyInvites.status, "pending"),
    ))
    .all();
}

async function updatePendingInviteStatus(
  inviteIds: string[],
  status: Extract<PartyInviteStatus, "expired" | "canceled">,
) {
  const uniqueInviteIds = [...new Set(inviteIds.map((inviteId) => inviteId.trim()).filter(Boolean))];
  if (!uniqueInviteIds.length) {
    return;
  }

  const timestamp = nowIso();
  await db.update(partyInvites).set({
    status,
    respondedAt: timestamp,
    updatedAt: timestamp,
  }).where(and(
    eq(partyInvites.status, "pending"),
    inArray(partyInvites.id, uniqueInviteIds),
  )).run();
}

async function cancelPendingInvitesForParty(partyId: string) {
  const inviteRows = await getPendingInviteRows();
  const inviteIds = inviteRows
    .filter((invite) => invite.partyId === partyId)
    .map((invite) => invite.id);
  await updatePendingInviteStatus(inviteIds, "canceled");
}

export async function getPartyGroupByPlayerId(playerId: string) {
  const membership = await db.select().from(partyGroupMembers)
    .where(eq(partyGroupMembers.playerId, playerId))
    .get();
  if (!membership) {
    return null;
  }

  const party = await getActivePartyById(membership.partyId);
  if (!party) {
    await db.delete(partyGroupMembers)
      .where(eq(partyGroupMembers.playerId, playerId))
      .run();
    return null;
  }

  const healedParty = await healPartyGroupState(party);
  if (!healedParty) {
    return null;
  }

  const latestMembership = await db.select().from(partyGroupMembers)
    .where(and(
      eq(partyGroupMembers.partyId, healedParty.id),
      eq(partyGroupMembers.playerId, playerId),
    ))
    .get();

  return latestMembership ? healedParty : null;
}

async function buildPartyMemberView(params: {
  playerId: string;
  leaderPlayerId: string;
  joinedAt: string;
}) : Promise<PartyMemberView | null> {
  const row = await getPlayerByIdCompat(params.playerId);
  if (!row || !row.name) {
    return null;
  }

  const [stats, cosmetics] = await Promise.all([
    buildPlayerStatsSnapshot(row),
    getPlayerCosmeticProfileById(row.id),
  ]);

  return {
    playerId: row.id,
    name: row.name,
    realmName: row.realmName || "无名境界",
    combatPower: calculateCombatPower(stats.total),
    maxHp: stats.total.maxHp,
    maxMp: stats.total.maxMp,
    currentMapId: row.currentMapId || null,
    positionX: row.positionX,
    positionY: row.positionY,
    avatarImageUrl: cosmetics.avatarImageUrl,
    avatarFrameImageUrl: cosmetics.avatarFrameImageUrl,
    isLeader: row.id === params.leaderPlayerId,
    joinedAt: params.joinedAt,
  };
}

async function buildPartyView(party: PartyGroupRow | null): Promise<PartyView | null> {
  if (!party) {
    return null;
  }

  const memberRows = await getPartyMembershipRows(party.id);
  const members = (await Promise.all(
    memberRows
      .sort((left, right) => left.slotOrder - right.slotOrder)
      .map((member) => buildPartyMemberView({
        playerId: member.playerId,
        leaderPlayerId: party.leaderPlayerId,
        joinedAt: member.joinedAt,
      })),
  )).filter((member): member is PartyMemberView => Boolean(member));

  return {
    id: party.id,
    leaderPlayerId: party.leaderPlayerId,
    createdAt: party.createdAt,
    members,
  };
}

async function buildInviteView(invite: PartyInviteRow): Promise<PartyInviteView | null> {
  const playerMap = await getPlayerPresenceMap([invite.inviterId, invite.targetPlayerId]);
  const inviter = playerMap.get(invite.inviterId);
  const target = playerMap.get(invite.targetPlayerId);
  if (!inviter || !target) {
    return null;
  }

  const memberCount = invite.partyId
    ? (await getPartyMembershipRows(invite.partyId)).length
    : 1;

  return {
    id: invite.id,
    inviterId: invite.inviterId,
    inviterName: inviter.name || "无名道友",
    targetPlayerId: invite.targetPlayerId,
    targetPlayerName: target.name || "无名道友",
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    status: invite.status as PartyInviteStatus,
    memberCount,
  };
}

async function buildEncounterView(encounter: PartyEncounterRow | null): Promise<PartyEncounterView | null> {
  if (!encounter) {
    return null;
  }

  return {
    id: encounter.id,
    partyId: encounter.partyId,
    encounterType: encounter.encounterType as "normal" | "boss",
    monsterId: encounter.monsterId,
    status: encounter.status as "ongoing" | "resolved" | "abandoned",
    routePath: buildEncounterRoutePath(encounter),
    state: parseCombatState(encounter.stateJson),
    turnState: parseTurnState(encounter.turnStateJson),
    eligibleMemberIds: Array.isArray(encounter.eligibleMemberIdsJson) ? encounter.eligibleMemberIdsJson : [],
    sceneSnapshot: encounter.sceneSnapshotJson || null,
  };
}

export async function pruneExpiredPartyInvites() {
  const pendingRows = await getPendingInviteRows();
  if (!pendingRows.length) {
    return;
  }

  const nowMs = Date.now();
  const expiredInviteIds: string[] = [];
  const canceledInviteIds: string[] = [];
  const partyCache = new Map<string, Promise<PartyGroupRow | null>>();
  const memberCache = new Map<string, Promise<PartyGroupMemberRow[]>>();
  const targetPartyCache = new Map<string, Promise<PartyGroupRow | null>>();
  const validPendingInvitesByPartyId = new Map<string, PartyInviteRow[]>();

  const getPartyById = (partyId: string | null) => {
    if (!partyId) {
      return Promise.resolve(null);
    }
    if (!partyCache.has(partyId)) {
      partyCache.set(
        partyId,
        db.select().from(partyGroups)
          .where(and(
            eq(partyGroups.id, partyId),
            eq(partyGroups.status, "active"),
          ))
          .get()
          .then((row) => row ?? null),
      );
    }
    return partyCache.get(partyId)!;
  };

  const getPartyMembers = (partyId: string) => {
    if (!memberCache.has(partyId)) {
      memberCache.set(partyId, getPartyMembershipRows(partyId));
    }
    return memberCache.get(partyId)!;
  };

  const getTargetParty = (playerId: string) => {
    if (!targetPartyCache.has(playerId)) {
      targetPartyCache.set(playerId, getPartyGroupByPlayerId(playerId));
    }
    return targetPartyCache.get(playerId)!;
  };

  for (const invite of pendingRows) {
    if (isExpiredIsoTimestamp(invite.expiresAt, nowMs)) {
      expiredInviteIds.push(invite.id);
      continue;
    }

    const party = await getPartyById(invite.partyId);
    if (!party || party.leaderPlayerId !== invite.inviterId) {
      canceledInviteIds.push(invite.id);
      continue;
    }

    const [memberRows, targetParty] = await Promise.all([
      getPartyMembers(party.id),
      getTargetParty(invite.targetPlayerId),
    ]);
    if (!memberRows.some((member) => member.playerId === invite.inviterId)) {
      canceledInviteIds.push(invite.id);
      continue;
    }
    if (targetParty) {
      canceledInviteIds.push(invite.id);
      continue;
    }

    const partyInviteRows = validPendingInvitesByPartyId.get(party.id) || [];
    partyInviteRows.push(invite);
    validPendingInvitesByPartyId.set(party.id, partyInviteRows);
  }

  for (const [partyId, inviteRows] of validPendingInvitesByPartyId.entries()) {
    const memberRows = await getPartyMembers(partyId);
    const availableSlots = MAX_PARTY_MEMBERS - memberRows.length;
    if (availableSlots <= 0) {
      canceledInviteIds.push(...inviteRows.map((invite) => invite.id));
      continue;
    }

    const overflowInviteIds = inviteRows
      .sort((left, right) => (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0))
      .slice(availableSlots)
      .map((invite) => invite.id);
    canceledInviteIds.push(...overflowInviteIds);
  }

  await updatePendingInviteStatus(expiredInviteIds, "expired");
  await updatePendingInviteStatus(canceledInviteIds, "canceled");
}

async function pruneIncomingPartyInvitesForPlayer(playerId: string) {
  const pendingRows = await getPendingInviteRowsByTargetPlayerId(playerId);
  if (!pendingRows.length) {
    return;
  }

  const nowMs = Date.now();
  const expiredInviteIds: string[] = [];
  const canceledInviteIds: string[] = [];
  const targetParty = await getPartyGroupByPlayerId(playerId);
  const partyCache = new Map<string, Promise<PartyGroupRow | null>>();
  const memberCache = new Map<string, Promise<PartyGroupMemberRow[]>>();

  const getPartyById = (partyId: string | null) => {
    if (!partyId) {
      return Promise.resolve(null);
    }
    if (!partyCache.has(partyId)) {
      partyCache.set(
        partyId,
        db.select().from(partyGroups)
          .where(and(
            eq(partyGroups.id, partyId),
            eq(partyGroups.status, "active"),
          ))
          .get()
          .then((row) => row ?? null),
      );
    }
    return partyCache.get(partyId)!;
  };

  const getPartyMembers = (partyId: string) => {
    if (!memberCache.has(partyId)) {
      memberCache.set(partyId, getPartyMembershipRows(partyId));
    }
    return memberCache.get(partyId)!;
  };

  for (const invite of pendingRows) {
    if (isExpiredIsoTimestamp(invite.expiresAt, nowMs)) {
      expiredInviteIds.push(invite.id);
      continue;
    }

    if (targetParty) {
      canceledInviteIds.push(invite.id);
      continue;
    }

    const party = await getPartyById(invite.partyId);
    if (!party || party.leaderPlayerId !== invite.inviterId) {
      canceledInviteIds.push(invite.id);
      continue;
    }

    const memberRows = await getPartyMembers(party.id);
    if (!memberRows.some((member) => member.playerId === invite.inviterId) || memberRows.length >= MAX_PARTY_MEMBERS) {
      canceledInviteIds.push(invite.id);
    }
  }

  await updatePendingInviteStatus(expiredInviteIds, "expired");
  await updatePendingInviteStatus(canceledInviteIds, "canceled");
}

async function getActiveEncounterByPartyId(partyId: string) {
  const party = await db.select().from(partyGroups).where(eq(partyGroups.id, partyId)).get();
  if (!party?.activeEncounterId) {
    return null;
  }

  const encounter = await db.select().from(partyEncounters)
    .where(eq(partyEncounters.id, party.activeEncounterId))
    .get();

  if (!encounter) {
    await db.update(partyGroups).set({
      activeEncounterId: null,
      updatedAt: nowIso(),
    }).where(eq(partyGroups.id, partyId)).run();
    return null;
  }

  const state = parseCombatState(encounter.stateJson);
  const eligibleMemberIds = normalizeEncounterEligibleMemberIds(encounter.eligibleMemberIdsJson);

  if (!state) {
    await closePartyEncounter({
      encounterId: encounter.id,
      status: "abandoned",
    });
    return null;
  }

  if (encounter.status === "resolved") {
    if (shouldKeepResolvedEncounterActive({
      status: "resolved",
      state,
      eligibleMemberIds,
    })) {
      return encounter;
    }

    await db.update(partyGroups).set({
      activeEncounterId: null,
      updatedAt: nowIso(),
    }).where(eq(partyGroups.id, partyId)).run();
    return null;
  }

  if (encounter.status !== "ongoing" || state.status !== "ongoing") {
    await closePartyEncounter({
      encounterId: encounter.id,
      status: state.status === "player_win" ? "resolved" : "abandoned",
      state,
      turnState: parseTurnState(encounter.turnStateJson),
      sceneSnapshot: encounter.sceneSnapshotJson || null,
      eligibleMemberIds,
    });
    return null;
  }

  if (encounter.encounterType === "normal") {
    const monster = await getRuntimeMonsterById(encounter.monsterId);
    if (!monster || monster.monsterType === "boss") {
      await closePartyEncounter({
        encounterId: encounter.id,
        status: "abandoned",
      });
      return null;
    }
  }

  return encounter;
}

export async function getActivePartyEncounterByPlayerId(playerId: string) {
  const party = await getPartyGroupByPlayerId(playerId);
  if (!party) {
    return null;
  }

  return getActiveEncounterByPartyId(party.id);
}

export async function getPartySnapshot(playerId: string): Promise<PartySnapshot> {
  await pruneIncomingPartyInvitesForPlayer(playerId);
  const party = await getPartyGroupByPlayerId(playerId);
  const inviteRows = await getPendingInviteRowsByTargetPlayerId(playerId);

  const incomingInvites = (await Promise.all(
    inviteRows.map((invite) => buildInviteView(invite)),
  )).filter((invite): invite is PartyInviteView => Boolean(invite));

  const activeEncounter = party
    ? await buildEncounterView(await getActiveEncounterByPartyId(party.id))
    : null;

  return {
    party: await buildPartyView(party),
    incomingInvites,
    activeEncounter,
  };
}

async function getOrCreatePartyForLeader(leaderPlayerId: string) {
  const existingParty = await getPartyGroupByPlayerId(leaderPlayerId);
  if (existingParty) {
    return existingParty;
  }

  const createdAt = nowIso();
  const partyId = crypto.randomUUID();
  await db.insert(partyGroups).values({
    id: partyId,
    leaderPlayerId,
    status: "active",
    createdAt,
    updatedAt: createdAt,
  }).run();
  await db.insert(partyGroupMembers).values({
    partyId,
    playerId: leaderPlayerId,
    slotOrder: 0,
    joinedAt: createdAt,
  }).run();

  return db.select().from(partyGroups).where(eq(partyGroups.id, partyId)).get();
}

async function countPartyMembers(partyId: string) {
  const memberRows = await getPartyMembershipRows(partyId);
  return memberRows.length;
}

async function clearPendingInvitesForPlayer(playerId: string) {
  const inviteRows = await getPendingInviteRows();
  const inviteIds = inviteRows
    .filter((invite) => invite.inviterId === playerId || invite.targetPlayerId === playerId)
    .map((invite) => invite.id);
  await updatePendingInviteStatus(inviteIds, "canceled");
}

export async function createPartyInvite(params: {
  inviterId: string;
  targetPlayerId: string;
}) {
  await pruneExpiredPartyInvites();
  const inviterId = params.inviterId.trim();
  const targetPlayerId = params.targetPlayerId.trim();
  if (!inviterId || !targetPlayerId) {
    return { success: false, error: "邀请目标不存在" as const };
  }
  if (inviterId === targetPlayerId) {
    return { success: false, error: "不能邀请自己组队" as const };
  }

  const existingParty = await getPartyGroupByPlayerId(inviterId);
  if (existingParty && existingParty.leaderPlayerId !== inviterId) {
    return { success: false, error: "只有队长可以继续邀请其他道友" as const };
  }
  if (await getPartyGroupByPlayerId(targetPlayerId)) {
    return { success: false, error: "对方已有队伍" as const };
  }

  const playerMap = await getPlayerPresenceMap([inviterId, targetPlayerId]);
  const inviter = playerMap.get(inviterId);
  const target = playerMap.get(targetPlayerId);
  if (!inviter || !target) {
    return { success: false, error: "邀请目标不存在" as const };
  }
  if ((inviter.currentMapId || "") !== (target.currentMapId || "")) {
    return { success: false, error: "对方不在同一张地图，无法发起组队邀请" as const };
  }
  if (Math.max(Math.abs(inviter.positionX - target.positionX), Math.abs(inviter.positionY - target.positionY)) > 1) {
    return { success: false, error: "对方不在附近，请靠近后再邀请" as const };
  }

  const duplicate = await db.select().from(partyInvites)
    .where(and(
      eq(partyInvites.inviterId, inviterId),
      eq(partyInvites.targetPlayerId, targetPlayerId),
      eq(partyInvites.status, "pending"),
    ))
    .get();
  if (duplicate) {
    return { success: false, error: "组队邀请已发出，请等待对方回应" as const };
  }

  const inviterParty = existingParty || await getOrCreatePartyForLeader(inviterId);
  if (!inviterParty) {
    return { success: false, error: "队伍创建失败" as const };
  }

  const [partyMemberCount, pendingInviteRows] = await Promise.all([
    countPartyMembers(inviterParty.id),
    getPendingInviteRows(),
  ]);
  const partyPendingInviteCount = pendingInviteRows.filter((invite) => invite.partyId === inviterParty.id).length;
  if (partyMemberCount + partyPendingInviteCount >= MAX_PARTY_MEMBERS) {
    return { success: false, error: "队伍已满，最多只能三人同行" as const };
  }

  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + PARTY_INVITE_TTL_MS).toISOString();
  const inviteId = crypto.randomUUID();
  await db.insert(partyInvites).values({
    id: inviteId,
    inviterId,
    targetPlayerId,
    partyId: inviterParty.id,
    status: "pending",
    expiresAt,
    createdAt,
    updatedAt: createdAt,
  }).run();

  const invite = await db.select().from(partyInvites).where(eq(partyInvites.id, inviteId)).get();
  return {
    success: true as const,
    invite: invite ? await buildInviteView(invite) : null,
  };
}

export async function respondPartyInvite(params: {
  playerId: string;
  inviteId: string;
  accept: boolean;
}) {
  await pruneExpiredPartyInvites();
  const invite = await db.select().from(partyInvites).where(eq(partyInvites.id, params.inviteId)).get();
  if (!invite || invite.targetPlayerId !== params.playerId) {
    return { success: false, error: "组队邀请不存在或已失效" as const };
  }
  if (invite.status !== "pending" || isExpiredIsoTimestamp(invite.expiresAt)) {
    await updatePendingInviteStatus([invite.id], "expired");
    return { success: false, error: "组队邀请已过期" as const };
  }

  if (!params.accept) {
    const respondedAt = nowIso();
    await db.update(partyInvites).set({
      status: "rejected",
      respondedAt,
      updatedAt: respondedAt,
    }).where(eq(partyInvites.id, invite.id)).run();
    return { success: true as const, party: null };
  }

  if (await getPartyGroupByPlayerId(params.playerId)) {
    return { success: false, error: "你已在其他队伍中" as const };
  }

  const party = invite.partyId
    ? await db.select().from(partyGroups)
      .where(and(
        eq(partyGroups.id, invite.partyId),
        eq(partyGroups.status, "active"),
      ))
      .get()
    : null;
  if (!party || party.leaderPlayerId !== invite.inviterId) {
    await updatePendingInviteStatus([invite.id], "canceled");
    return { success: false, error: "邀请者已不具备组队权限" as const };
  }

  const playerMap = await getPlayerPresenceMap([invite.inviterId, params.playerId]);
  const inviter = playerMap.get(invite.inviterId);
  const target = playerMap.get(params.playerId);
  if (!inviter || !target) {
    return { success: false, error: "组队双方状态已变更，请重新邀请" as const };
  }
  if (!arePlayersAdjacent(inviter, target)) {
    return { success: false, error: "只有在队长附近才能加入队伍" as const };
  }

  const acceptResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${partyGroups} WHERE ${partyGroups.id} = ${party.id} FOR UPDATE`);

    const latestInvite = await tx.select().from(partyInvites)
      .where(eq(partyInvites.id, invite.id))
      .get();
    if (!latestInvite || latestInvite.targetPlayerId !== params.playerId) {
      return { success: false as const, error: "组队邀请不存在或已失效" as const };
    }
    if (latestInvite.status !== "pending" || isExpiredIsoTimestamp(latestInvite.expiresAt)) {
      await tx.update(partyInvites).set({
        status: "expired",
        respondedAt: nowIso(),
        updatedAt: nowIso(),
      }).where(eq(partyInvites.id, latestInvite.id)).run();
      return { success: false as const, error: "组队邀请已过期" as const };
    }

    const latestParty = await tx.select().from(partyGroups)
      .where(and(
        eq(partyGroups.id, party.id),
        eq(partyGroups.status, "active"),
      ))
      .get();
    if (!latestParty || latestParty.leaderPlayerId !== invite.inviterId) {
      await tx.update(partyInvites).set({
        status: "canceled",
        respondedAt: nowIso(),
        updatedAt: nowIso(),
      }).where(eq(partyInvites.id, latestInvite.id)).run();
      return { success: false as const, error: "邀请者已不具备组队权限" as const };
    }

    const existingMembership = await tx.select().from(partyGroupMembers)
      .where(eq(partyGroupMembers.playerId, params.playerId))
      .get();
    if (existingMembership) {
      return { success: false as const, error: "你已在其他队伍中" as const };
    }

    const memberRows = await tx.select().from(partyGroupMembers)
      .where(eq(partyGroupMembers.partyId, party.id))
      .all();
    if (memberRows.length >= MAX_PARTY_MEMBERS) {
      return { success: false as const, error: "队伍已满，请等待新的邀请" as const };
    }

    const joinedAt = nowIso();
    await tx.insert(partyGroupMembers).values({
      partyId: party.id,
      playerId: params.playerId,
      slotOrder: memberRows.length,
      joinedAt,
    }).run();
    await tx.update(partyGroups).set({
      updatedAt: joinedAt,
    }).where(eq(partyGroups.id, party.id)).run();
    await tx.update(partyInvites).set({
      status: "accepted",
      respondedAt: joinedAt,
      updatedAt: joinedAt,
    }).where(eq(partyInvites.id, latestInvite.id)).run();

    return {
      success: true as const,
      memberCountAfterJoin: memberRows.length + 1,
    };
  });
  if (!acceptResult.success) {
    if (acceptResult.error === "队伍已满，请等待新的邀请") {
      await cancelPendingInvitesForParty(party.id);
    }
    return acceptResult;
  }

  await clearPendingInvitesForPlayer(params.playerId);
  if (acceptResult.memberCountAfterJoin >= MAX_PARTY_MEMBERS) {
    await cancelPendingInvitesForParty(party.id);
  }

  const latestParty = await db.select().from(partyGroups).where(eq(partyGroups.id, party.id)).get();
  return {
    success: true as const,
    party: await buildPartyView(latestParty ?? null),
  };
}

async function reorderPartyMembers(partyId: string, remainingPlayerIds: string[]) {
  for (let index = 0; index < remainingPlayerIds.length; index += 1) {
    await db.update(partyGroupMembers).set({
      slotOrder: index,
    }).where(and(
      eq(partyGroupMembers.partyId, partyId),
      eq(partyGroupMembers.playerId, remainingPlayerIds[index]),
    )).run();
  }
}

async function disbandParty(partyId: string) {
  const timestamp = nowIso();
  await clearPartyEncounterByPartyId(partyId);
  await cancelPendingInvitesForParty(partyId);
  await db.update(partyGroups).set({
    status: "disbanded" as PartyGroupStatus,
    activeEncounterId: null,
    updatedAt: timestamp,
  }).where(eq(partyGroups.id, partyId)).run();
  await db.delete(partyGroupMembers).where(eq(partyGroupMembers.partyId, partyId)).run();
}

export async function leaveParty(playerId: string) {
  const party = await getPartyGroupByPlayerId(playerId);
  if (!party) {
    return { success: false, error: "当前不在队伍中" as const };
  }

  await clearPartyEncounterByPartyId(party.id);

  const memberRows = await getPartyMembershipRows(party.id);
  const remainingMembers = memberRows
    .filter((member) => member.playerId !== playerId)
    .sort((left, right) => left.slotOrder - right.slotOrder);

  await db.delete(partyGroupMembers).where(and(
    eq(partyGroupMembers.partyId, party.id),
    eq(partyGroupMembers.playerId, playerId),
  )).run();
  await clearPendingInvitesForPlayer(playerId);

  if (!remainingMembers.length) {
    await disbandParty(party.id);
    return { success: true as const, party: null };
  }

  const nextLeaderPlayerId = party.leaderPlayerId === playerId
    ? remainingMembers[0].playerId
    : party.leaderPlayerId;
  await reorderPartyMembers(party.id, remainingMembers.map((member) => member.playerId));
  if (nextLeaderPlayerId !== party.leaderPlayerId) {
    await cancelPendingInvitesForParty(party.id);
  }
  await db.update(partyGroups).set({
    leaderPlayerId: nextLeaderPlayerId,
    updatedAt: nowIso(),
  }).where(eq(partyGroups.id, party.id)).run();

  const latestParty = await db.select().from(partyGroups).where(eq(partyGroups.id, party.id)).get();
  return {
    success: true as const,
    party: await buildPartyView(latestParty ?? null),
  };
}

export async function kickPartyMember(params: {
  leaderPlayerId: string;
  targetPlayerId: string;
}) {
  const party = await getPartyGroupByPlayerId(params.leaderPlayerId);
  if (!party || party.leaderPlayerId !== params.leaderPlayerId) {
    return { success: false, error: "只有队长可以请离队员" as const };
  }
  if (params.targetPlayerId === params.leaderPlayerId) {
    return { success: false, error: "请使用退出队伍功能" as const };
  }

  const memberRows = await getPartyMembershipRows(party.id);
  const exists = memberRows.some((member) => member.playerId === params.targetPlayerId);
  if (!exists) {
    return { success: false, error: "目标队员不存在" as const };
  }

  await clearPartyEncounterByPartyId(party.id);

  await db.delete(partyGroupMembers).where(and(
    eq(partyGroupMembers.partyId, party.id),
    eq(partyGroupMembers.playerId, params.targetPlayerId),
  )).run();
  await reorderPartyMembers(
    party.id,
    memberRows
      .filter((member) => member.playerId !== params.targetPlayerId)
      .map((member) => member.playerId),
  );
  await clearPendingInvitesForPlayer(params.targetPlayerId);
  await db.update(partyGroups).set({
    updatedAt: nowIso(),
  }).where(eq(partyGroups.id, party.id)).run();

  const latestParty = await db.select().from(partyGroups).where(eq(partyGroups.id, party.id)).get();
  return {
    success: true as const,
    party: await buildPartyView(latestParty ?? null),
  };
}

export async function createPartyEncounter(params: {
  partyId: string;
  encounterType: "normal" | "boss";
  monsterId: string;
  state: CombatState;
  turnState: CombatTurnState;
  sceneSnapshot?: Record<string, unknown> | null;
  eligibleMemberIds: string[];
}) {
  const timestamp = nowIso();
  const encounterId = crypto.randomUUID();
  await db.insert(partyEncounters).values({
    id: encounterId,
    partyId: params.partyId,
    encounterType: params.encounterType,
    monsterId: params.monsterId,
    status: "ongoing",
    stateJson: params.state as unknown as Record<string, unknown>,
    sceneSnapshotJson: params.sceneSnapshot || null,
    turnStateJson: params.turnState as unknown as Record<string, unknown>,
    eligibleMemberIdsJson: params.eligibleMemberIds,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  await db.update(partyGroups).set({
    activeEncounterId: encounterId,
    updatedAt: timestamp,
  }).where(eq(partyGroups.id, params.partyId)).run();

  const encounter = await db.select().from(partyEncounters).where(eq(partyEncounters.id, encounterId)).get();
  return buildEncounterView(encounter || null);
}

export async function getPartyEncounterById(encounterId: string) {
  const encounter = await db.select().from(partyEncounters).where(eq(partyEncounters.id, encounterId)).get();
  return encounter || null;
}

export async function updatePartyEncounter(params: {
  encounterId: string;
  state: CombatState;
  turnState: CombatTurnState;
  sceneSnapshot?: Record<string, unknown> | null;
  eligibleMemberIds?: string[];
  status?: "ongoing" | "resolved" | "abandoned";
}) {
  const timestamp = nowIso();
  const encounter = await db.select().from(partyEncounters).where(eq(partyEncounters.id, params.encounterId)).get();
  if (!encounter) {
    return null;
  }

  const nextStatus = (params.status || encounter.status) as PartyEncounterStatus;
  const nextEligibleMemberIds = normalizeEncounterEligibleMemberIds(
    params.eligibleMemberIds ?? encounter.eligibleMemberIdsJson,
  );
  await db.update(partyEncounters).set({
    stateJson: params.state as unknown as Record<string, unknown>,
    turnStateJson: params.turnState as unknown as Record<string, unknown>,
    sceneSnapshotJson: params.sceneSnapshot ?? encounter.sceneSnapshotJson,
    eligibleMemberIdsJson: nextEligibleMemberIds,
    status: nextStatus,
    updatedAt: timestamp,
    resolvedAt: nextStatus === "ongoing" ? null : timestamp,
  }).where(eq(partyEncounters.id, params.encounterId)).run();

  const keepResolvedEncounterActive = shouldKeepResolvedEncounterActive({
    status: nextStatus,
    state: params.state,
    eligibleMemberIds: nextEligibleMemberIds,
  });
  await db.update(partyGroups).set({
    activeEncounterId: nextStatus === "ongoing" || keepResolvedEncounterActive ? encounter.id : null,
    updatedAt: timestamp,
  }).where(eq(partyGroups.id, encounter.partyId)).run();

  return buildEncounterView(
    (await db.select().from(partyEncounters).where(eq(partyEncounters.id, params.encounterId)).get()) ?? null,
  );
}

export async function closePartyEncounter(params: {
  encounterId: string;
  status?: "resolved" | "abandoned";
  state?: CombatState | null;
  turnState?: CombatTurnState | null;
  sceneSnapshot?: Record<string, unknown> | null;
  eligibleMemberIds?: string[];
}) {
  const encounter = await db.select().from(partyEncounters).where(eq(partyEncounters.id, params.encounterId)).get();
  if (!encounter) {
    return null;
  }

  const timestamp = nowIso();
  const nextStatus = (params.status || "abandoned") as PartyEncounterStatus;
  const nextState = (params.state ?? parseCombatState(encounter.stateJson)) as CombatState | null;
  const nextEligibleMemberIds = normalizeEncounterEligibleMemberIds(
    params.eligibleMemberIds ?? encounter.eligibleMemberIdsJson,
  );
  await db.update(partyEncounters).set({
    stateJson: (nextState ?? encounter.stateJson) as Record<string, unknown>,
    turnStateJson: (params.turnState ?? encounter.turnStateJson) as Record<string, unknown>,
    sceneSnapshotJson: params.sceneSnapshot ?? encounter.sceneSnapshotJson,
    eligibleMemberIdsJson: nextEligibleMemberIds,
    status: nextStatus,
    updatedAt: timestamp,
    resolvedAt: timestamp,
  }).where(eq(partyEncounters.id, params.encounterId)).run();

  const keepResolvedEncounterActive = shouldKeepResolvedEncounterActive({
    status: nextStatus,
    state: nextState,
    eligibleMemberIds: nextEligibleMemberIds,
  });
  await db.update(partyGroups).set({
    activeEncounterId: keepResolvedEncounterActive ? encounter.id : null,
    updatedAt: timestamp,
  }).where(eq(partyGroups.id, encounter.partyId)).run();

  return buildEncounterView(
    (await db.select().from(partyEncounters).where(eq(partyEncounters.id, params.encounterId)).get()) ?? null,
  );
}

export async function getEligiblePartyMembersNearMonster(params: {
  leaderPlayerId: string;
  monsterId: string;
}) {
  const leaderParty = await getPartyGroupByPlayerId(params.leaderPlayerId);
  const monster = await getMonsterPositionSnapshot(params.monsterId);
  if (!monster) {
    return [];
  }

  if (!leaderParty) {
    return [params.leaderPlayerId];
  }

  const memberRows = await getPartyMembershipRows(leaderParty.id);
  const playerMap = await getPlayerPresenceMap(memberRows.map((member) => member.playerId));
  return memberRows
    .sort((left, right) => left.slotOrder - right.slotOrder)
    .map((member) => playerMap.get(member.playerId))
    .filter((member): member is PlayerPresenceRecord => Boolean(member))
    .filter((member) => (
      member.currentMapId === monster.mapId
      && Math.max(
        Math.abs(member.positionX - monster.positionX),
        Math.abs(member.positionY - monster.positionY),
      ) <= 1
    ))
    .map((member) => member.id);
}

export async function clearPartyEncounterByPartyId(partyId: string) {
  const encounter = await getActiveEncounterByPartyId(partyId);
  if (!encounter) {
    return;
  }

  const timestamp = nowIso();
  await db.update(partyEncounters).set({
    status: "abandoned",
    resolvedAt: timestamp,
    updatedAt: timestamp,
  }).where(eq(partyEncounters.id, encounter.id)).run();
  await db.update(partyGroups).set({
    activeEncounterId: null,
    updatedAt: timestamp,
  }).where(eq(partyGroups.id, partyId)).run();
}

export async function getPartyMemberIds(partyId: string) {
  const memberRows = await getPartyMembershipRows(partyId);
  return memberRows
    .sort((left, right) => left.slotOrder - right.slotOrder)
    .map((member) => member.playerId);
}

export async function getPartyMembersForEncounter(partyId: string, eligibleMemberIds: string[]) {
  const memberRows = await getPartyMembershipRows(partyId);
  const filteredMemberRows = memberRows
    .filter((member) => eligibleMemberIds.includes(member.playerId))
    .sort((left, right) => left.slotOrder - right.slotOrder);

  const playerIds = filteredMemberRows.map((member) => member.playerId);
  if (!playerIds.length) {
    return [];
  }

  const playerRows = await getPlayersByIdsCompat(playerIds);
  const rowMap = new Map(playerRows.map((row) => [row.id, row]));

  return filteredMemberRows
    .map((member) => rowMap.get(member.playerId))
    .filter(Boolean);
}
