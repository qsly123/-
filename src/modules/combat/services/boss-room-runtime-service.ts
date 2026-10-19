import { createBossSceneSnapshot, getBossSceneSnapshot, publishBossEvent } from "@/modules/combat/services/boss-scene-runtime";
import {
  readPersistedRuntimeValue,
  writePersistedRuntimeValue,
} from "@/modules/shared/services/runtime-persisted-store";
import type { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import type { ActiveEffect, BossEvent, BossParticipant, CombatTurnState } from "@/types/game";

const MAX_BOSS_PARTICIPANTS = 3;
const BOSS_PARTICIPANT_TTL_MS = 45_000;
const BOSS_SLOT_PRIORITY = [1, 0, 2] as const;
const BOSS_TURN_DURATION_MS = 12_000;
const BOSS_ROOM_RUNTIME_NAMESPACE = "boss-room-runtime";

type BossGlobal = typeof globalThis & {
  __bossRooms?: Record<string, BossRoomState>;
};

export type BossRoomParticipantState = Required<
  Pick<
    BossParticipant,
    "playerId" | "playerName" | "slot" | "hp" | "maxHp" | "mp" | "maxMp"
  >
> & {
  skillCooldowns: Record<string, number>;
  avatarImageUrl: string | null;
  avatarFrameImageUrl: string | null;
  joinedAt: string;
  lastSeenAt: string;
  activeEffects: ActiveEffect[];
};

export type BossRoomState = {
  participants: BossRoomParticipantState[];
  turnState: CombatTurnState | null;
  bossMp: number;
  bossMaxMp: number;
  bossSkillCooldowns: Record<string, number>;
};

function getBossGlobal() {
  return globalThis as BossGlobal;
}

function persistBossRoomStore(store: Record<string, BossRoomState>) {
  writePersistedRuntimeValue(BOSS_ROOM_RUNTIME_NAMESPACE, "rooms", store);
}

function sortParticipants(participants: BossRoomParticipantState[]) {
  return [...participants].sort((left, right) => {
    if (left.slot !== right.slot) {
      return left.slot - right.slot;
    }
    return Date.parse(left.joinedAt) - Date.parse(right.joinedAt);
  });
}

export function cloneActiveEffects(activeEffects?: ActiveEffect[] | null) {
  return (activeEffects || []).map((effect) => ({ ...effect }));
}

export function tickBossParticipantActiveEffects(activeEffects?: ActiveEffect[] | null) {
  return cloneActiveEffects(activeEffects)
    .map((effect) => ({
      ...effect,
      remainingTurns: Math.max(0, effect.remainingTurns - 1),
    }))
    .filter((effect) => effect.remainingTurns > 0);
}

export function serializeBossParticipants(participants: BossRoomParticipantState[]): BossParticipant[] {
  return sortParticipants(participants).map((participant) => ({
    playerId: participant.playerId,
    playerName: participant.playerName,
    slot: participant.slot,
    hp: participant.hp,
    maxHp: participant.maxHp,
    mp: participant.mp,
    maxMp: participant.maxMp,
    skillCooldowns: { ...(participant.skillCooldowns || {}) },
    avatarImageUrl: participant.avatarImageUrl,
    avatarFrameImageUrl: participant.avatarFrameImageUrl,
    joinedAt: participant.joinedAt,
    activeEffects: cloneActiveEffects(participant.activeEffects),
  }));
}

export function buildBossSceneSnapshotPayload(params: {
  bossId: string;
  bossName?: string | null;
  participants: BossParticipant[];
  turnState?: CombatTurnState | null;
}) {
  const previousSnapshot = getBossSceneSnapshot(params.bossId);
  const resolvedBossName = params.bossName?.trim()
    || previousSnapshot?.units.find((unit) => unit.role === "boss")?.name
    || "世界首领";
  return createBossSceneSnapshot({
    bossId: params.bossId,
    bossName: resolvedBossName,
    participants: params.participants,
    turnState: params.turnState,
    previousSnapshot,
  });
}

export function emitBossEvent(event: BossEvent) {
  publishBossEvent(event);
}

export function getBossRoomStore() {
  const bossGlobal = getBossGlobal();
  if (!bossGlobal.__bossRooms) {
    bossGlobal.__bossRooms = readPersistedRuntimeValue<Record<string, BossRoomState>>(
      BOSS_ROOM_RUNTIME_NAMESPACE,
      "rooms",
    ) || {};
  }
  return bossGlobal.__bossRooms;
}

export function getBossRoomState(bossId: string): BossRoomState {
  const store = getBossRoomStore();
  store[bossId] = store[bossId] || {
    participants: [],
    turnState: null,
    bossMp: 100,
    bossMaxMp: 100,
    bossSkillCooldowns: {},
  };
  return store[bossId];
}

export function setBossRoomParticipants(bossId: string, participants: BossRoomParticipantState[]) {
  const store = getBossRoomStore();
  if (!participants.length) {
    delete store[bossId];
    persistBossRoomStore(store);
    return [];
  }
  const nextParticipants = sortParticipants(participants);
  const currentRoom = getBossRoomState(bossId);
  store[bossId] = {
    ...currentRoom,
    participants: nextParticipants,
  };
  persistBossRoomStore(store);
  return nextParticipants;
}

export function pruneExpiredBossParticipants(bossId: string, nowMs = Date.now()) {
  const room = getBossRoomState(bossId);
  const nextParticipants = room.participants.filter((participant) => {
    const lastSeenMs = Date.parse(participant.lastSeenAt);
    if (Number.isNaN(lastSeenMs)) {
      return false;
    }
    return nowMs - lastSeenMs <= BOSS_PARTICIPANT_TTL_MS;
  });
  const changed = nextParticipants.length !== room.participants.length;
  return {
    changed,
    participants: setBossRoomParticipants(bossId, nextParticipants),
  };
}

export function getActiveBossParticipants(bossId: string) {
  return serializeBossParticipants(pruneExpiredBossParticipants(bossId).participants);
}

function createTurnDeadlineAt() {
  return new Date(Date.now() + BOSS_TURN_DURATION_MS).toISOString();
}

function buildBossTurnState(
  participants: BossRoomParticipantState[],
  previousTurnState: CombatTurnState | null,
): CombatTurnState | null {
  const turnOrder = sortParticipants(participants)
    .filter((participant) => participant.hp > 0)
    .map((participant) => participant.playerId);

  if (!turnOrder.length) {
    return null;
  }

  const previousOrder = previousTurnState?.turnOrder || [];
  const normalizedOrder = previousOrder.filter((playerId) => turnOrder.includes(playerId));
  for (const playerId of turnOrder) {
    if (!normalizedOrder.includes(playerId)) {
      normalizedOrder.push(playerId);
    }
  }

  const existingCurrent = previousTurnState?.currentTurnPlayerId;
  const currentTurnPlayerId = existingCurrent && normalizedOrder.includes(existingCurrent)
    ? existingCurrent
    : normalizedOrder[0];
  const turnIndex = Math.max(0, normalizedOrder.indexOf(currentTurnPlayerId));

  return {
    turnOrder: normalizedOrder,
    currentTurnPlayerId,
    turnIndex,
    turnDeadlineAt: previousTurnState?.turnDeadlineAt || createTurnDeadlineAt(),
  };
}

export function syncBossTurnState(bossId: string) {
  const room = getBossRoomState(bossId);
  const nextTurnState = buildBossTurnState(room.participants, room.turnState);
  room.turnState = nextTurnState;
  persistBossRoomStore(getBossRoomStore());
  return nextTurnState;
}

export function advanceBossTurnState(bossId: string) {
  const room = getBossRoomState(bossId);
  const currentTurnState = buildBossTurnState(room.participants, room.turnState);
  if (!currentTurnState || currentTurnState.turnOrder.length === 0) {
    room.turnState = null;
    return null;
  }

  const nextIndex = (currentTurnState.turnIndex + 1) % currentTurnState.turnOrder.length;
  const nextTurnState: CombatTurnState = {
    ...currentTurnState,
    turnIndex: nextIndex,
    currentTurnPlayerId: currentTurnState.turnOrder[nextIndex] || null,
    turnDeadlineAt: createTurnDeadlineAt(),
  };
  room.turnState = nextTurnState;
  persistBossRoomStore(getBossRoomStore());
  return nextTurnState;
}

export function resetBossRuntimeState(bossId: string) {
  const room = getBossRoomState(bossId);
  room.turnState = null;
  room.bossMp = room.bossMaxMp;
  room.bossSkillCooldowns = {};
  persistBossRoomStore(getBossRoomStore());
}

export function setBossRuntimeState(bossId: string, params: {
  bossMp?: number;
  bossMaxMp?: number;
  bossSkillCooldowns?: Record<string, number>;
}) {
  const room = getBossRoomState(bossId);
  if (typeof params.bossMp === "number") {
    room.bossMp = params.bossMp;
  }
  if (typeof params.bossMaxMp === "number") {
    room.bossMaxMp = params.bossMaxMp;
  }
  if (params.bossSkillCooldowns) {
    room.bossSkillCooldowns = params.bossSkillCooldowns;
  }
  persistBossRoomStore(getBossRoomStore());
}

export function emitBossParticipantsUpdate(bossId: string) {
  const turnState = syncBossTurnState(bossId);
  const participants = getActiveBossParticipants(bossId);
  const sceneSnapshot = buildBossSceneSnapshotPayload({
    bossId,
    participants,
    turnState,
  });
  emitBossEvent({
    type: "participants_update",
    bossId,
    participants,
    turnState,
    sceneSnapshot,
  });
}

function pickBossSlot(participants: BossRoomParticipantState[]) {
  const occupiedSlots = new Set(participants.map((participant) => participant.slot));
  return BOSS_SLOT_PRIORITY.find((slot) => !occupiedSlots.has(slot)) ?? 0;
}

export async function joinOrRefreshBossParticipant(args: {
  bossId: string;
  player: {
    id: string;
    name?: string | null;
  };
  playerStats: Awaited<ReturnType<typeof buildPlayerStatsSnapshot>>;
}) {
  const { bossId, player, playerStats } = args;
  const now = new Date().toISOString();
  const { changed: prunedChanged, participants } = pruneExpiredBossParticipants(bossId);
  const currentParticipants = [...participants];
  const currentIndex = currentParticipants.findIndex((participant) => participant.playerId === player.id);
  const { getPlayerCosmeticProfileById } = await import("@/modules/character/services/player-cosmetic-profile");
  const cosmeticProfile = await getPlayerCosmeticProfileById(player.id);

  if (currentIndex >= 0) {
    currentParticipants[currentIndex] = {
      ...currentParticipants[currentIndex],
      playerName: player.name || "无名修士",
      hp: playerStats.total.hp,
      maxHp: playerStats.total.maxHp,
      mp: playerStats.total.mp,
      maxMp: playerStats.total.maxMp,
      skillCooldowns: { ...(currentParticipants[currentIndex].skillCooldowns || {}) },
      avatarImageUrl: cosmeticProfile.avatarImageUrl,
      avatarFrameImageUrl: cosmeticProfile.avatarFrameImageUrl,
      lastSeenAt: now,
      activeEffects: cloneActiveEffects(currentParticipants[currentIndex].activeEffects),
    };
    const nextParticipants = setBossRoomParticipants(bossId, currentParticipants);
    if (prunedChanged) {
      emitBossParticipantsUpdate(bossId);
    }
    return {
      joined: true,
      roomFull: false,
      mySlot: currentParticipants[currentIndex].slot,
      participants: serializeBossParticipants(nextParticipants),
    };
  }

  if (currentParticipants.length >= MAX_BOSS_PARTICIPANTS) {
    if (prunedChanged) {
      emitBossParticipantsUpdate(bossId);
    }
    return {
      joined: false,
      roomFull: true,
      mySlot: null,
      participants: serializeBossParticipants(currentParticipants),
    };
  }

  const slot = pickBossSlot(currentParticipants);
  currentParticipants.push({
    playerId: player.id,
    playerName: player.name || "无名修士",
    slot,
    hp: playerStats.total.hp,
    maxHp: playerStats.total.maxHp,
    mp: playerStats.total.mp,
    maxMp: playerStats.total.maxMp,
    skillCooldowns: {},
    avatarImageUrl: cosmeticProfile.avatarImageUrl,
    avatarFrameImageUrl: cosmeticProfile.avatarFrameImageUrl,
    joinedAt: now,
    lastSeenAt: now,
    activeEffects: [],
  });
  const nextParticipants = setBossRoomParticipants(bossId, currentParticipants);
  emitBossParticipantsUpdate(bossId);

  return {
    joined: true,
    roomFull: false,
    mySlot: slot,
    participants: serializeBossParticipants(nextParticipants),
  };
}

export function patchBossParticipant(
  bossId: string,
  playerId: string,
  patch: Partial<Omit<BossRoomParticipantState, "playerId" | "slot" | "joinedAt">>,
) {
  const { participants } = pruneExpiredBossParticipants(bossId);
  const currentParticipants = [...participants];
  const currentIndex = currentParticipants.findIndex((participant) => participant.playerId === playerId);
  if (currentIndex < 0) {
    return serializeBossParticipants(currentParticipants);
  }
  currentParticipants[currentIndex] = {
    ...currentParticipants[currentIndex],
    ...patch,
    activeEffects: patch.activeEffects
      ? cloneActiveEffects(patch.activeEffects)
      : cloneActiveEffects(currentParticipants[currentIndex].activeEffects),
  };
  return serializeBossParticipants(setBossRoomParticipants(bossId, currentParticipants));
}

export function removeBossParticipant(bossId: string, playerId: string, emitUpdate = true) {
  const { participants } = pruneExpiredBossParticipants(bossId);
  const nextParticipants = participants.filter((participant) => participant.playerId !== playerId);
  const changed = nextParticipants.length !== participants.length;
  const payload = serializeBossParticipants(setBossRoomParticipants(bossId, nextParticipants));
  if (changed && emitUpdate) {
    emitBossParticipantsUpdate(bossId);
  }
  return payload;
}

export function clearBossParticipants(bossId: string, emitUpdate = true) {
  const payload = getActiveBossParticipants(bossId);
  setBossRoomParticipants(bossId, []);
  if (emitUpdate && payload.length) {
    emitBossParticipantsUpdate(bossId);
  }
  return payload;
}

export async function fillBossRoomWithPlayerIds(params: {
  bossId: string;
  playerIds: string[];
}) {
  if (!params.playerIds.length) {
    return getActiveBossParticipants(params.bossId);
  }

  const room = getBossRoomState(params.bossId);
  const currentParticipants = [...room.participants];
  let changed = false;

  for (const playerId of params.playerIds) {
    if (currentParticipants.some((participant) => participant.playerId === playerId)) {
      continue;
    }
    if (currentParticipants.length >= MAX_BOSS_PARTICIPANTS) {
      break;
    }

    const [
      { getPlayerByIdCompat },
      { buildPlayerStatsSnapshot },
      { getPlayerCosmeticProfileById },
    ] = await Promise.all([
      import("@/modules/character/services/pill-toxicity-schema-compat"),
      import("@/modules/character/services/player-stats"),
      import("@/modules/character/services/player-cosmetic-profile"),
    ]);
    const playerRow = await getPlayerByIdCompat(playerId);
    if (!playerRow) {
      continue;
    }
    const [stats, cosmetics] = await Promise.all([
      buildPlayerStatsSnapshot(playerRow),
      getPlayerCosmeticProfileById(playerId),
    ]);
    const timestamp = new Date().toISOString();

    currentParticipants.push({
      playerId,
      playerName: playerRow.name || "无名修士",
      slot: pickBossSlot(currentParticipants),
      hp: stats.total.hp,
      maxHp: stats.total.maxHp,
      mp: stats.total.mp,
      maxMp: stats.total.maxMp,
      skillCooldowns: {},
      avatarImageUrl: cosmetics.avatarImageUrl,
      avatarFrameImageUrl: cosmetics.avatarFrameImageUrl,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
      activeEffects: [],
    });
    changed = true;
  }

  const nextParticipants = serializeBossParticipants(setBossRoomParticipants(params.bossId, currentParticipants));
  if (changed) {
    emitBossParticipantsUpdate(params.bossId);
  }
  return nextParticipants;
}

export async function performBossLeaveCommandTransaction(params: {
  bossId: string;
  playerId: string;
}) {
  const participants = removeBossParticipant(params.bossId, params.playerId, true);
  return {
    participants,
    turnState: syncBossTurnState(params.bossId),
    sceneSnapshot: buildBossSceneSnapshotPayload({
      bossId: params.bossId,
      participants,
      turnState: getBossRoomState(params.bossId).turnState,
    }),
  };
}
