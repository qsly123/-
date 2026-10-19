import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bossInstances, partyEncounters, partyGroups, players, playerInventory } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerActiveSkillEntries } from "@/modules/character/services/player-active-skills";
import { getItemByIdCompat, getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import { guardPlayerAction } from "@/modules/combat/services/action-guard";
import { getCombatDamageCalculator } from "@/modules/combat/services/damage-formula";
import {
  getBossSceneSnapshot,
  setBossSceneSnapshot,
} from "@/modules/combat/services/boss-scene-runtime";
import { buildBattleCommandResult, createBattleCommand } from "@/modules/combat/services/battle-command";
import { buildBossBattleRuntimePayload } from "@/modules/combat/services/boss-battle-runtime";
import {
  buildBattleCommandRouteResponse,
  type BattleActionRouteData,
  validateBattleCommandRouteSync,
} from "@/modules/combat/services/battle-command-executor";
import { publishCombatRefreshFrames } from "@/modules/combat/services/combat-state-refresh-publish";
import {
  calculateCombatDamageOutcome,
  calculateHealAmount,
} from "@/modules/combat/services/combat-mechanics";
import {
  BASIC_ATTACK_RUNTIME_COOLDOWN,
  ensureCombatSkillIdsWithBasicAttack,
  normalizeCombatSkillCooldown,
} from "@/modules/combat/services/monster-skill-utils";
import { resolveCombatRealmByMapId } from "@/modules/combat/services/combat-realm-utils";
import {
  canChallengeSecretRealmBoss,
  getSecretRealmContextByMonsterId,
} from "@/modules/map/services/secret-realm-instance-service";
import {
  getRuntimeMonsterById,
  type RuntimeMonsterRecord,
} from "@/modules/map/services/runtime-monster-store";
import {
  createPartyEncounter,
  getActivePartyEncounterByPlayerId,
  getEligiblePartyMembersNearMonster,
  getPartyEncounterById,
  getPartyGroupByPlayerId,
  updatePartyEncounter,
} from "@/modules/social/infrastructure/party-service";
import { resolveSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";
import { pickTimedAutoActionSkillId } from "@/modules/combat/services/combat-ai";
import {
  getCombatRewardClaim,
} from "@/modules/combat/services/combat-reward-claim-service";
import {
  acceptBossClientSequence,
  getLastAcceptedBossClientSequence,
} from "@/modules/combat/services/boss-command-sequence";
import {
  buildBossNextIntent,
  commitBossDamageToInstance,
  createBossMonsterCombatUnit,
  createBossRoomCombatUnit,
  mapBossCommandActionToBattleCommandType,
  normalizeBossCommandRequestBody,
  readBossRewardClaimSnapshot,
  resolveBossCounterAction,
  resolveBossInstanceLifecycle,
  runBossKillSideEffects,
  settleBossDefeatRewardsAndSideEffects,
  tickBossSkillCooldowns,
  toBossCommandSkillSnapshot,
  toBossRewardCombatId,
} from "@/modules/combat/services/boss-combat-command-transaction";
import {
  advanceBossTurnState,
  buildBossSceneSnapshotPayload,
  clearBossParticipants,
  cloneActiveEffects,
  emitBossEvent,
  fillBossRoomWithPlayerIds,
  getActiveBossParticipants as getActiveParticipants,
  getBossRoomState,
  joinOrRefreshBossParticipant,
  patchBossParticipant,
  performBossLeaveCommandTransaction,
  resetBossRuntimeState,
  serializeBossParticipants as serializeParticipants,
  setBossRoomParticipants,
  setBossRuntimeState,
  syncBossTurnState,
  tickBossParticipantActiveEffects,
  type BossRoomParticipantState,
} from "@/modules/combat/services/boss-room-runtime-service";
import type {
  BossEvent,
  BossParticipant,
  CombatSkillVisualEffect,
  CombatTurnState,
  CombatUnit,
  ItemEffect,
} from "@/types/game";

const MAX_BOSS_CLIENT_SCENE_TICK_LAG = 5;

type BossRewardEntry = NonNullable<BossEvent["rewards"]>[number];
type BossInstanceRow = typeof bossInstances.$inferSelect;
type BossMonsterRecord = RuntimeMonsterRecord;

type BossCounterResult = NonNullable<BossEvent["bossCounterResults"]>[number];
function buildBossRouteData(params: {
  runtimeId: string;
  bossName: string;
  currentHp: number;
  maxHp: number;
  participants: BossParticipant[];
  turnState?: CombatTurnState | null;
  sceneSnapshot?: ReturnType<typeof getBossSceneSnapshot>;
  viewerPlayerId?: string | null;
  statusText?: string | null;
  modePayload?: Record<string, unknown> | null;
}): BattleActionRouteData {
  const { battleView, battleRuntime } = buildBossBattleRuntimePayload({
    runtimeId: params.runtimeId,
    bossName: params.bossName,
    currentHp: params.currentHp,
    maxHp: params.maxHp,
    participants: params.participants,
    turnState: params.turnState || null,
    sceneSnapshot: params.sceneSnapshot || null,
    viewerPlayerId: params.viewerPlayerId,
    statusText: params.statusText || null,
    modePayload: params.modePayload || null,
  });

  return {
    state: null,
    battleView,
    battleRuntime,
    sceneSnapshot: params.sceneSnapshot || null,
    turnState: params.turnState || null,
  };
}

async function findLatestBossRewardReplay(params: {
  monsterId: string;
  playerId: string;
  respawnRemainingSeconds?: number;
}) {
  const deadInstance = await db.select().from(bossInstances)
    .where(and(eq(bossInstances.monsterId, params.monsterId), eq(bossInstances.status, "dead")))
    .orderBy(desc(bossInstances.id))
    .get();
  if (!deadInstance) {
    return null;
  }

  const rewardClaim = await getCombatRewardClaim({
    combatId: toBossRewardCombatId(deadInstance.id),
    playerId: params.playerId,
  });
  const reward = readBossRewardClaimSnapshot(rewardClaim);
  if (!reward) {
    return null;
  }

  const resolvedRespawnSeconds = typeof params.respawnRemainingSeconds === "number"
    ? params.respawnRemainingSeconds
    : getRespawnRemainingSeconds(deadInstance.nextSpawnAt, Date.now());

  return {
    reward,
    deadInstance,
    respawnRemainingSeconds: Math.max(1, resolvedRespawnSeconds),
  };
}

function buildBossRewardReplayResponse(params: {
  monsterId: string;
  monsterName: string;
  reward: BossRewardEntry;
  respawnRemainingSeconds: number;
  partyCombatId?: string | null;
  message?: string;
  viewerPlayerId?: string | null;
}) {
  const { battleView, battleRuntime } = buildBossBattleRuntimePayload({
    runtimeId: params.monsterId,
    bossName: params.monsterName,
    currentHp: 0,
    maxHp: 1,
    participants: [],
    turnState: null,
    sceneSnapshot: getBossSceneSnapshot(params.monsterId),
    viewerPlayerId: params.viewerPlayerId,
    statusText: "首领已被击败",
    modePayload: {
      partyCombatId: params.partyCombatId || null,
      joined: false,
      roomFull: false,
      canAttack: false,
      replayed: true,
    },
  });
  const commandResult = buildBattleCommandResult({
    accepted: true,
    runtimeId: params.monsterId,
    mode: "boss",
    battleRuntime,
    battleView,
    serverSceneTick: battleRuntime.sceneSnapshot?.tick ?? 0,
    message: params.message || "首领奖励已回放",
    payload: {
      replayed: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      actionType: "skill",
      partyCombatId: params.partyCombatId || null,
      bossDead: true,
      rewards: [params.reward],
      respawnRemainingSeconds: Math.max(1, params.respawnRemainingSeconds),
      participants: [],
      roomFull: false,
      joined: false,
      canAttack: false,
      replayed: true,
      battleView,
      battleRuntime,
      commandResult,
      ...(params.message ? { message: params.message } : {}),
    },
  });
}

function readPartyCombatId(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("partyCombatId")?.trim() || "";
}

function isRealmMatched(realm: number, minRealm: number | null | undefined, maxRealm: number | null | undefined) {
  if (minRealm !== null && minRealm !== undefined && realm < minRealm) {
    return false;
  }
  if (maxRealm !== null && maxRealm !== undefined && realm > maxRealm) {
    return false;
  }
  return true;
}

function getRespawnRemainingSeconds(nextSpawnAt: string | null | undefined, nowMs = Date.now()) {
  if (!nextSpawnAt) {
    return 0;
  }
  const spawnMs = Date.parse(nextSpawnAt);
  if (Number.isNaN(spawnMs)) {
    return 0;
  }
  if (spawnMs <= nowMs) {
    return 0;
  }
  return Math.ceil((spawnMs - nowMs) / 1000);
}

async function getBossMonsterRecord(monsterId: string) {
  const monster = await getRuntimeMonsterById(monsterId);
  if (!monster || monster.monsterType !== "boss") {
    return null;
  }
  return monster;
}

function isSecretRealmBossSettledReason(reason?: string | null) {
  if (!reason) {
    return false;
  }
  return reason.includes("该秘境已结束") || reason.includes("无法再次挑战 Boss");
}

function buildSecretRealmBossUnavailableResponse(args: {
  error: string;
  status: number;
  settled: boolean;
  bossUnavailableReason: "secret_realm_settled" | "secret_realm_runtime_missing";
}) {
  return NextResponse.json({
    success: false,
    error: args.error,
    redirectToMap: true,
    settled: args.settled,
    bossUnavailableReason: args.bossUnavailableReason,
  }, { status: args.status });
}

async function clearInvalidBossPartyEncounter(params: {
  encounterId?: string | null;
  monsterId: string;
  resolved?: boolean;
}) {
  const encounterId = typeof params.encounterId === "string" ? params.encounterId.trim() : "";
  if (!encounterId) {
    return;
  }

  const encounter = await getPartyEncounterById(encounterId);
  if (!encounter || encounter.status !== "ongoing" || encounter.encounterType !== "boss" || encounter.monsterId !== params.monsterId) {
    return;
  }

  const timestamp = new Date().toISOString();
  await db.update(partyEncounters).set({
    status: params.resolved ? "resolved" : "abandoned",
    resolvedAt: timestamp,
    updatedAt: timestamp,
  }).where(eq(partyEncounters.id, encounter.id)).run();

  await db.update(partyGroups).set({
    activeEncounterId: null,
    updatedAt: timestamp,
  }).where(and(
    eq(partyGroups.id, encounter.partyId),
    eq(partyGroups.activeEncounterId, encounter.id),
  )).run();
}

async function resolveMissingSecretRealmBossResponse(monsterId: string) {
  const secretRealmContext = await getSecretRealmContextByMonsterId(monsterId);
  if (!secretRealmContext) {
    return null;
  }

  const secretRealmBossAccess = await canChallengeSecretRealmBoss(monsterId);
  const settled = isSecretRealmBossSettledReason(secretRealmBossAccess.reason);
  return buildSecretRealmBossUnavailableResponse({
    error: settled
      ? (secretRealmBossAccess.reason || "该秘境已结束，已返回地图。")
      : "该秘境首领状态已刷新，请返回地图后重新进入。",
    status: settled ? 410 : 409,
    settled,
    bossUnavailableReason: settled ? "secret_realm_settled" : "secret_realm_runtime_missing",
  });
}

function createBossPlayerCombatUnit(args: {
  playerId: string;
  playerName: string;
  stats: Awaited<ReturnType<typeof buildPlayerStatsSnapshot>>;
  skillIds: string[];
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
}): CombatUnit {
  const { playerId, playerName, stats, skillIds, avatarImageUrl, avatarFrameImageUrl } = args;
  return {
    id: playerId,
    name: playerName,
    isPlayer: true,
    avatarImageUrl: avatarImageUrl || null,
    avatarFrameImageUrl: avatarFrameImageUrl || null,
    hp: stats.total.hp,
    maxHp: stats.total.maxHp,
    mp: stats.total.mp,
    maxMp: stats.total.maxMp,
    attack: stats.total.attack,
    defense: stats.total.defense,
    speed: stats.total.speed,
    luck: stats.total.luck,
    spiritualSense: stats.total.spiritualSense,
    armorPenetration: stats.total.armorPenetration,
    block: stats.total.block,
    skillDamageBonus: stats.total.skillDamageBonus,
    skillDamageReduction: stats.total.skillDamageReduction,
    artifactDamageBonus: stats.total.artifactDamageBonus,
    artifactDamageReduction: stats.total.artifactDamageReduction,
    skills: skillIds,
    skillCooldowns: {},
    activeEffects: [],
    isStunned: false,
  };
}

function buildBossEncounterState(params: {
  encounterId: string;
  monster: BossMonsterRecord;
  instance: BossInstanceRow;
  participants: BossParticipant[];
  turnState: CombatTurnState | null;
  eligibleMemberIds: string[];
}) {
  const bossUnit = createBossMonsterCombatUnit(params.monster);
  const room = getBossRoomState(params.monster.id);
  bossUnit.hp = params.instance.currentHp;
  bossUnit.maxHp = params.instance.maxHp;
  bossUnit.mp = room.bossMp;
  bossUnit.maxMp = room.bossMaxMp;
  bossUnit.skillCooldowns = { ...room.bossSkillCooldowns };

  const participantUnits = params.participants.map(createBossRoomCombatUnit);
  return {
    id: params.encounterId,
    turn: params.turnState?.turnIndex || 0,
    player: participantUnits[0] || createBossRoomCombatUnit({
      playerId: "viewer",
      playerName: "道友",
      slot: 0,
      hp: 0,
      maxHp: 0,
      mp: 0,
      maxMp: 0,
    }),
    enemy: bossUnit,
    mode: "party" as const,
    participants: participantUnits,
    turnOrder: params.turnState?.turnOrder || participantUnits.map((unit) => unit.id),
    currentTurnPlayerId: params.turnState?.currentTurnPlayerId || null,
    turnIndex: params.turnState?.turnIndex || 0,
    turnDeadlineAt: params.turnState?.turnDeadlineAt || null,
    eligibleMemberIds: params.eligibleMemberIds,
    log: [{
      turn: params.turnState?.turnIndex || 0,
      actorName: "系统",
      action: "Boss战",
      entryType: "system" as const,
      targetId: params.monster.id,
      message: `${params.monster.name} 的战斗正在进行中。`,
    }],
    status: params.instance.currentHp <= 0
      ? "player_win" as const
      : participantUnits.some((unit) => unit.hp > 0)
        ? "ongoing" as const
        : "enemy_win" as const,
  };
}

async function syncBossPartyEncounter(params: {
  encounterId: string;
  monster: BossMonsterRecord;
  instance: BossInstanceRow;
  participants: BossParticipant[];
  turnState: CombatTurnState | null;
  eligibleMemberIds: string[];
  status?: "ongoing" | "resolved" | "abandoned";
}) {
  const state = buildBossEncounterState({
    encounterId: params.encounterId,
    monster: params.monster,
    instance: params.instance,
    participants: params.participants,
    turnState: params.turnState,
    eligibleMemberIds: params.eligibleMemberIds,
  });
  const effectiveTurnState = params.turnState || {
    turnOrder: params.participants.map((participant) => participant.playerId),
    currentTurnPlayerId: null,
    turnIndex: 0,
    turnDeadlineAt: null,
    eligibleMemberIds: params.eligibleMemberIds,
  };
  await updatePartyEncounter({
    encounterId: params.encounterId,
    state,
    turnState: effectiveTurnState,
    eligibleMemberIds: params.eligibleMemberIds,
    status: params.status,
  });
}

async function ensureBossPartyEncounter(params: {
  request: Request;
  monster: BossMonsterRecord;
  instance: BossInstanceRow;
  player: NonNullable<Awaited<ReturnType<typeof getCurrentPlayer>>>;
  participants: BossParticipant[];
  turnState: CombatTurnState | null;
}) {
  const explicitEncounterId = readPartyCombatId(params.request);
  const fallbackEligibleMemberIds = params.participants.map((participant) => participant.playerId);

  if (explicitEncounterId) {
    const encounter = await getPartyEncounterById(explicitEncounterId);
    if (encounter && encounter.status === "ongoing" && encounter.monsterId === params.monster.id) {
      const eligibleMemberIds = Array.isArray(encounter.eligibleMemberIdsJson)
        ? encounter.eligibleMemberIdsJson as string[]
        : fallbackEligibleMemberIds;
      await syncBossPartyEncounter({
        encounterId: encounter.id,
        monster: params.monster,
        instance: params.instance,
        participants: params.participants,
        turnState: params.turnState,
        eligibleMemberIds,
      });
      return {
        partyCombatId: encounter.id,
        eligibleMemberIds,
        participants: params.participants,
      };
    }
  }

  const activeEncounter = await getActivePartyEncounterByPlayerId(params.player.id);
  if (activeEncounter?.status === "ongoing" && activeEncounter.encounterType === "boss" && activeEncounter.monsterId === params.monster.id) {
    const encounterEligibleMemberIds = Array.isArray(activeEncounter.eligibleMemberIdsJson)
      ? activeEncounter.eligibleMemberIdsJson
      : [];
    const eligibleMemberIds = encounterEligibleMemberIds.length
      ? encounterEligibleMemberIds
      : fallbackEligibleMemberIds;
    await syncBossPartyEncounter({
      encounterId: activeEncounter.id,
      monster: params.monster,
      instance: params.instance,
      participants: params.participants,
      turnState: params.turnState,
      eligibleMemberIds,
    });
    return {
      partyCombatId: activeEncounter.id,
      eligibleMemberIds,
      participants: params.participants,
    };
  }

  const party = await getPartyGroupByPlayerId(params.player.id);
  if (!party || party.leaderPlayerId !== params.player.id) {
    return {
      partyCombatId: "",
      eligibleMemberIds: fallbackEligibleMemberIds,
      participants: params.participants,
    };
  }

  const eligibleMemberIds = await getEligiblePartyMembersNearMonster({
    leaderPlayerId: params.player.id,
    monsterId: params.monster.id,
  });
  if (!eligibleMemberIds.includes(params.player.id) || eligibleMemberIds.length <= 1) {
    return {
      partyCombatId: "",
      eligibleMemberIds: fallbackEligibleMemberIds,
      participants: params.participants,
    };
  }

  const nextParticipants = await fillBossRoomWithPlayerIds({
    bossId: params.monster.id,
    playerIds: eligibleMemberIds,
  });
  const nextTurnState = syncBossTurnState(params.monster.id);
  const createdState = buildBossEncounterState({
    encounterId: crypto.randomUUID(),
    monster: params.monster,
    instance: params.instance,
    participants: nextParticipants,
    turnState: nextTurnState,
    eligibleMemberIds,
  });
  const created = await createPartyEncounter({
    partyId: party.id,
    encounterType: "boss",
    monsterId: params.monster.id,
    state: createdState,
    turnState: nextTurnState || {
      turnOrder: nextParticipants.map((participant) => participant.playerId),
      currentTurnPlayerId: null,
      turnIndex: 0,
      turnDeadlineAt: null,
      eligibleMemberIds,
    },
    eligibleMemberIds,
  });

  return {
    partyCombatId: created?.id || "",
    eligibleMemberIds,
    participants: nextParticipants,
  };
}

async function consumeOneItem(playerId: string, itemId: string, quantity: number) {
  if (quantity <= 1) {
    await db.delete(playerInventory)
      .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
      .run();
    return;
  }

  await db.update(playerInventory).set({ quantity: quantity - 1 })
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId)))
    .run();
}

async function applyBossCounterAction(params: {
  bossId: string;
  monster: BossMonsterRecord;
  participants: BossParticipant[];
  preferredTargetPlayerId: string;
}) {
  const room = getBossRoomState(params.bossId);
  const counterResult = await resolveBossCounterAction({
    monster: params.monster,
    participants: params.participants,
    preferredTargetPlayerId: params.preferredTargetPlayerId,
    bossMp: room.bossMp,
    bossMaxMp: room.bossMaxMp,
    bossSkillCooldowns: room.bossSkillCooldowns,
  });

  const timestamp = new Date().toISOString();
  setBossRoomParticipants(params.bossId, counterResult.participants.map((participant) => ({
    ...participant,
    joinedAt: participant.joinedAt || timestamp,
    lastSeenAt: timestamp,
    activeEffects: cloneActiveEffects(participant.activeEffects),
  } as BossRoomParticipantState)));
  setBossRuntimeState(params.bossId, {
    bossMp: counterResult.bossMp,
    bossMaxMp: counterResult.bossMaxMp,
    bossSkillCooldowns: counterResult.bossSkillCooldowns,
  });

  return {
    participants: serializeParticipants(getBossRoomState(params.bossId).participants),
    bossCounterDamage: counterResult.bossCounterDamage,
    bossCounterSkillName: counterResult.bossCounterSkillName,
    bossCounterResults: counterResult.bossCounterResults,
  };
}

async function resolveRouteBossInstance(monster: BossMonsterRecord): Promise<{
  instance: BossInstanceRow | null;
  respawnRemainingSeconds: number;
}> {
  const lifecycle = await resolveBossInstanceLifecycle(monster);
  if (lifecycle.shouldClearParticipants) {
    clearBossParticipants(monster.id, false);
  }
  if (lifecycle.spawned) {
    const spawnedSceneSnapshot = buildBossSceneSnapshotPayload({
      bossId: monster.id,
      bossName: monster.name,
      participants: [],
      turnState: null,
    });
    emitBossEvent({
      type: "boss_spawn",
      bossId: monster.id,
      currentHp: monster.hp,
      maxHp: monster.hp,
      participants: [],
      sceneSnapshot: spawnedSceneSnapshot,
    });
  }

  return {
    instance: lifecycle.instance,
    respawnRemainingSeconds: lifecycle.respawnRemainingSeconds,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer(req);
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const playerStats = await buildPlayerStatsSnapshot(player);

    const { id: monsterId } = await params;
    const explicitEncounterId = readPartyCombatId(req);
    const monster = await getBossMonsterRecord(monsterId);
    if (!monster) {
      await clearInvalidBossPartyEncounter({
        encounterId: explicitEncounterId,
        monsterId,
      });
      const missingSecretRealmResponse = await resolveMissingSecretRealmBossResponse(monsterId);
      if (missingSecretRealmResponse) {
        return missingSecretRealmResponse;
      }
      return NextResponse.json({ success: false, error: "首领不存在" }, { status: 404 });
    }
    const secretRealmBossAccess = await canChallengeSecretRealmBoss(monsterId);
    if (!secretRealmBossAccess.allowed) {
      if (isSecretRealmBossSettledReason(secretRealmBossAccess.reason)) {
        await clearInvalidBossPartyEncounter({
          encounterId: explicitEncounterId,
          monsterId,
          resolved: true,
        });
        return buildSecretRealmBossUnavailableResponse({
          error: secretRealmBossAccess.reason || "该秘境已结束，已返回地图。",
          status: 410,
          settled: true,
          bossUnavailableReason: "secret_realm_settled",
        });
      }
      return NextResponse.json({ success: false, error: secretRealmBossAccess.reason || "Boss 封印未破" }, { status: 403 });
    }

    const { instance, respawnRemainingSeconds } = await resolveRouteBossInstance(monster);

    const playerSkillRows = await getPlayerActiveSkillEntries({
      playerId: player.id,
      realm: player.realm,
    });
    const skillIds = playerSkillRows.map((row) => row.id);
    const skillsMap: Record<string, ReturnType<typeof toBossCommandSkillSnapshot>> = {};
    for (const row of playerSkillRows) {
      skillsMap[row.id] = toBossCommandSkillSnapshot(row);
    }

    const participation = instance
      ? await joinOrRefreshBossParticipant({ bossId: monsterId, player, playerStats })
      : {
        joined: false,
        roomFull: false,
        mySlot: null,
        participants: getActiveParticipants(monsterId),
      };

    let participants = participation.participants;
    let turnState = instance ? syncBossTurnState(monsterId) : null;
    let partyCombatId = "";
    let eligibleMemberIds = participants.map((participant) => participant.playerId);

    if (instance) {
      const encounterContext = await ensureBossPartyEncounter({
        request: req,
        monster,
        instance,
        player,
        participants,
        turnState,
      });
      participants = encounterContext.participants;
      eligibleMemberIds = encounterContext.eligibleMemberIds;
      partyCombatId = encounterContext.partyCombatId;
      turnState = syncBossTurnState(monsterId);
    }

    const bossRoom = getBossRoomState(monsterId);
    const bossNextIntent = instance
      ? await buildBossNextIntent({
        monster,
        participants,
        bossMp: bossRoom.bossMp,
        bossMaxMp: bossRoom.bossMaxMp,
        bossSkillCooldowns: bossRoom.bossSkillCooldowns,
      })
      : null;
    const canAttack = Boolean(
      instance
      && participation.joined
      && playerStats.total.hp > 0
      && turnState?.currentTurnPlayerId === player.id,
    );
    const sceneSnapshot = buildBossSceneSnapshotPayload({
      bossId: monsterId,
      bossName: monster.name,
      participants,
      turnState,
    });
    setBossSceneSnapshot(monsterId, sceneSnapshot);
    const { battleView: bossBattleView, battleRuntime } = buildBossBattleRuntimePayload({
      runtimeId: monsterId,
      bossName: monster.name,
      currentHp: instance?.currentHp ?? 0,
      maxHp: instance?.maxHp ?? monster.hp,
      participants,
      turnState,
      sceneSnapshot,
      viewerPlayerId: player.id,
      statusText: instance ? (instance.currentHp > 0 ? "首领交战中" : "首领已被击败") : "等待首领重生",
      modePayload: {
        partyCombatId: partyCombatId || null,
        joined: participation.joined,
        roomFull: participation.roomFull,
        canAttack,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        monster: {
          id: monster.id,
          name: monster.name,
          description: monster.description,
          avatarImageUrl: monster.iconUrl || null,
          hp: monster.hp,
          attack: monster.attack,
          defense: monster.defense,
          speed: monster.speed,
          luck: monster.luck,
          spiritualSense: monster.spiritualSense,
          armorPenetration: monster.armorPenetration,
          block: monster.block,
          skillDamageBonus: monster.skillDamageBonus,
          skillDamageReduction: monster.skillDamageReduction,
          artifactDamageBonus: monster.artifactDamageBonus,
          artifactDamageReduction: monster.artifactDamageReduction,
        },
        instance: instance ? {
          currentHp: instance.currentHp,
          maxHp: instance.maxHp,
          status: instance.status,
          damageMap: instance.damageMap,
        } : null,
        partyCombatId: partyCombatId || null,
        respawnRemainingSeconds,
        participants,
        joined: participation.joined,
        roomFull: participation.roomFull,
        mySlot: participation.mySlot,
        canAttack,
        battleView: bossBattleView,
        battleRuntime,
        sceneSnapshot,
        turnState: turnState ? {
          ...turnState,
          eligibleMemberIds,
        } : null,
        bossNextIntent,
        player: {
          id: player.id,
          name: player.name,
          hp: playerStats.total.hp,
          maxHp: playerStats.total.maxHp,
          mp: playerStats.total.mp,
          maxMp: playerStats.total.maxMp,
          attack: playerStats.total.attack,
          defense: playerStats.total.defense,
          speed: playerStats.total.speed,
          luck: playerStats.total.luck,
          spiritualSense: playerStats.total.spiritualSense,
          armorPenetration: playerStats.total.armorPenetration,
          block: playerStats.total.block,
          skillDamageBonus: playerStats.total.skillDamageBonus,
          skillDamageReduction: playerStats.total.skillDamageReduction,
          artifactDamageBonus: playerStats.total.artifactDamageBonus,
          artifactDamageReduction: playerStats.total.artifactDamageReduction,
          skills: skillIds,
        },
        skillsData: skillsMap,
      },
    });
  } catch (error) {
    console.error("Boss data error:", error);
    return NextResponse.json({ success: false, error: "获取 Boss 信息失败" }, { status: 500 });
  }
}


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer(req);
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const playerStats = await buildPlayerStatsSnapshot(player);
    const playerCosmetics = await getPlayerCosmeticProfileById(player.id);
    const { id: monsterId } = await params;
    const commandRequest = normalizeBossCommandRequestBody(await req.json().catch(() => ({})));
    const {
      isAdvance,
      action,
      itemId,
      requestPartyCombatId,
      actionId,
      clientSentAt,
      clientSequence,
      clientSceneTick,
    } = commandRequest;
    let { skillId } = commandRequest;

    if (!isAdvance) {
      const guarded = guardPlayerAction({
        playerId: player.id,
        scope: "boss",
        encounterId: monsterId,
        actionId: actionId || undefined,
        clientSentAt,
      });
      if (!guarded.allowed) {
        return NextResponse.json({
          success: false,
          error: guarded.error,
          errorCode: guarded.errorCode,
        }, { status: guarded.status });
      }
    }

    const monster = await getBossMonsterRecord(monsterId);
    if (!monster) {
      await clearInvalidBossPartyEncounter({
        encounterId: requestPartyCombatId,
        monsterId,
      });
      const missingSecretRealmResponse = await resolveMissingSecretRealmBossResponse(monsterId);
      if (missingSecretRealmResponse) {
        return missingSecretRealmResponse;
      }
      return NextResponse.json({ success: false, error: "Boss 不存在" }, { status: 404 });
    }
    const secretRealmBossAccess = await canChallengeSecretRealmBoss(monsterId);
    if (!secretRealmBossAccess.allowed) {
      if (isSecretRealmBossSettledReason(secretRealmBossAccess.reason)) {
        const replay = await findLatestBossRewardReplay({
          monsterId,
          playerId: player.id,
        });
        await clearInvalidBossPartyEncounter({
          encounterId: requestPartyCombatId,
          monsterId,
          resolved: true,
        });
        if (replay) {
          await runBossKillSideEffects({
            combatId: toBossRewardCombatId(replay.deadInstance.id),
            monster,
            rewardedPlayerIds: replay.reward.rewarded === false ? [] : [player.id],
            lastHitPlayerId: replay.deadInstance.lastHitPlayerId,
            lastHitPlayerName: replay.reward.isLastHit ? player.name : null,
            secretRealm: true,
          });
          return buildBossRewardReplayResponse({
            monsterId,
            monsterName: monster.name,
            reward: replay.reward,
            respawnRemainingSeconds: replay.respawnRemainingSeconds,
            partyCombatId: requestPartyCombatId || null,
            viewerPlayerId: player.id,
            message: secretRealmBossAccess.reason || "该秘境已结束，已返回地图。",
          });
        }
        return buildSecretRealmBossUnavailableResponse({
          error: secretRealmBossAccess.reason || "该秘境已结束，已返回地图。",
          status: 410,
          settled: true,
          bossUnavailableReason: "secret_realm_settled",
        });
      }
      return NextResponse.json({ success: false, error: secretRealmBossAccess.reason || "Boss 封印未破" }, { status: 403 });
    }

    const bossDisplayName = (monster.name || "世界首领").trim() || "世界首领";
    const { instance, respawnRemainingSeconds } = await resolveRouteBossInstance(monster);
    if (!instance) {
      const waitSeconds = Math.max(1, respawnRemainingSeconds);
      const replay = await findLatestBossRewardReplay({
        monsterId,
        playerId: player.id,
        respawnRemainingSeconds: waitSeconds,
      });
      if (replay) {
        await runBossKillSideEffects({
          combatId: toBossRewardCombatId(replay.deadInstance.id),
          monster,
          rewardedPlayerIds: replay.reward.rewarded === false ? [] : [player.id],
          lastHitPlayerId: replay.deadInstance.lastHitPlayerId,
          lastHitPlayerName: replay.reward.isLastHit ? player.name : null,
          secretRealm: Boolean(await getSecretRealmContextByMonsterId(monsterId)),
        });
        return buildBossRewardReplayResponse({
          monsterId,
          monsterName: monster.name,
          reward: replay.reward,
          respawnRemainingSeconds: replay.respawnRemainingSeconds,
          partyCombatId: requestPartyCombatId || null,
          viewerPlayerId: player.id,
        });
      }
      return NextResponse.json({
        success: false,
        error: `首领已被击败，约 ${waitSeconds} 秒后重生`,
        respawnRemainingSeconds: waitSeconds,
      }, { status: 400 });
    }

    const participation = await joinOrRefreshBossParticipant({ bossId: monsterId, player, playerStats });
    if (!participation.joined) {
      return NextResponse.json({
        success: false,
        error: "当前首领房间已满，最多 3 人同时挑战",
        participants: participation.participants,
      }, { status: 403 });
    }

    let participants = participation.participants;
    let turnState = syncBossTurnState(monsterId);
    const encounterContext = await ensureBossPartyEncounter({
      request: requestPartyCombatId
        ? new Request(`${req.url}?partyCombatId=${encodeURIComponent(requestPartyCombatId)}`)
        : req,
      monster,
      instance,
      player,
      participants,
      turnState,
    });
    participants = encounterContext.participants;
    turnState = syncBossTurnState(monsterId);
    const partyCombatId = encounterContext.partyCombatId || requestPartyCombatId || "";
    const eligibleMemberIds = encounterContext.eligibleMemberIds;
    const currentSceneSnapshot = getBossSceneSnapshot(monsterId);
    const currentCanAttack = Boolean(
      instance
      && participation.joined
      && playerStats.total.hp > 0
      && turnState?.currentTurnPlayerId === player.id,
    );
    const currentRouteData = buildBossRouteData({
      runtimeId: monsterId,
      bossName: monster.name,
      currentHp: instance.currentHp,
      maxHp: instance.maxHp,
      participants,
      turnState,
      sceneSnapshot: currentSceneSnapshot,
      viewerPlayerId: player.id,
      statusText: instance.currentHp > 0 ? "首领交战中" : "首领已被击败",
      modePayload: {
        partyCombatId: partyCombatId || null,
        joined: participation.joined,
        roomFull: participation.roomFull,
        canAttack: currentCanAttack,
      },
    });
    const routeCommand = createBattleCommand({
      runtimeId: monsterId,
      mode: "boss",
      type: mapBossCommandActionToBattleCommandType({
        isAdvance,
        action,
      }),
      actorId: turnState?.currentTurnPlayerId || player.id,
      payload: {
        ...(skillId ? { skillId } : {}),
        ...(itemId ? { itemId } : {}),
        ...(isAdvance ? { advance: true } : {}),
      },
      actionId: actionId || null,
      clientSentAt,
      clientSequence,
      clientSceneTick,
    });
    const lastAcceptedClientSequence = getLastAcceptedBossClientSequence(monsterId, player.id);
    const currentServerSceneTick = currentRouteData.sceneSnapshot?.tick ?? 0;
    const buildBossSyncErrorResponse = (params: {
      status: number;
      error: string;
      errorCode?: string;
      acceptedClientSequence?: number;
      payload?: Record<string, unknown> | null;
    }) => buildBattleCommandRouteResponse({
      success: false,
      status: params.status,
      error: params.error,
      errorCode: params.errorCode,
      runtimeId: monsterId,
      mode: "boss",
      command: routeCommand,
      routeData: currentRouteData,
      acceptedClientSequence: params.acceptedClientSequence ?? lastAcceptedClientSequence,
      serverSceneTick: currentServerSceneTick,
      payload: params.payload || null,
    });
    const buildBossAcknowledgedErrorResponse = (params: {
      status: number;
      error: string;
      errorCode?: string;
      payload?: Record<string, unknown> | null;
    }) => {
      if (typeof clientSequence === "number") {
        acceptBossClientSequence(monsterId, player.id, clientSequence);
      }
      return buildBossSyncErrorResponse({
        status: params.status,
        error: params.error,
        errorCode: params.errorCode,
        acceptedClientSequence: typeof clientSequence === "number" ? clientSequence : lastAcceptedClientSequence,
        payload: params.payload || null,
      });
    };

    if (typeof clientSequence !== "number") {
      return buildBossSyncErrorResponse({
        status: 400,
        error: "缺少客户端动作序列，请刷新页面后重试",
      });
    }
    if (typeof clientSceneTick !== "number") {
      return buildBossSyncErrorResponse({
        status: 400,
        error: "缺少场景同步帧序号，请等待同步后重试",
      });
    }
    const syncValidation = validateBattleCommandRouteSync({
      clientSequence,
      clientSceneTick,
      serverSceneTick: currentServerSceneTick,
      lastAcceptedClientSequence,
      maxClientSceneTickLag: MAX_BOSS_CLIENT_SCENE_TICK_LAG,
    });
    // 同步错误文案由 validateBattleCommandRouteSync 统一维护。
    if (syncValidation) {
      return buildBossSyncErrorResponse({
        status: syncValidation.status,
        error: syncValidation.error,
        errorCode: syncValidation.errorCode,
      });
    }
    if (clientSequence <= lastAcceptedClientSequence) {
      return buildBossSyncErrorResponse({
        status: 409,
        error: "动作序列已过期，重复或乱序请求已被拦截",
      });
    }
    if (clientSequence > lastAcceptedClientSequence + 1) {
      return buildBossSyncErrorResponse({
        status: 409,
        error: "动作序号跳帧，请等待上一帧确认后再继续出手",
      });
    }
    if (clientSceneTick > currentServerSceneTick) {
      return buildBossSyncErrorResponse({
        status: 409,
        error: "客户端场景时间异常，请刷新页面后重试",
        errorCode: "ACTION_REQUEST_TIME_SKEW",
      });
    }
    if (currentServerSceneTick - clientSceneTick > MAX_BOSS_CLIENT_SCENE_TICK_LAG) {
      return buildBossSyncErrorResponse({
        status: 409,
        error: "战斗状态已更新，请等待场景同步后再出手",
        errorCode: "COMBAT_SCENE_STALE",
      });
    }

    if (!turnState?.currentTurnPlayerId) {
      return buildBossSyncErrorResponse({
        status: 400,
        error: "当前回合尚未初始化",
      });
    }
    if (!isAdvance && turnState.currentTurnPlayerId !== player.id) {
      return buildBossSyncErrorResponse({
        status: 400,
        error: "当前还未轮到你出手",
      });
    }
    if (isAdvance && turnState.turnDeadlineAt && Date.parse(turnState.turnDeadlineAt) > Date.now()) {
      return buildBossSyncErrorResponse({
        status: 400,
        error: "当前回合尚未超时",
      });
    }

    const actorPlayerId = isAdvance ? turnState.currentTurnPlayerId : player.id;
    if (!actorPlayerId) {
      return buildBossAcknowledgedErrorResponse({
        status: 400,
        error: "当前回合角色不存在",
      });
    }
    const actorPlayer = actorPlayerId === player.id
      ? player
      : await getPlayerByIdCompat(actorPlayerId);
    if (!actorPlayer) {
      return buildBossAcknowledgedErrorResponse({
        status: 400,
        error: "当前回合角色不存在",
      });
    }
    const actorStats = actorPlayerId === player.id
      ? playerStats
      : await buildPlayerStatsSnapshot(actorPlayer);
    const actorCosmetics = actorPlayerId === player.id
      ? playerCosmetics
      : await getPlayerCosmeticProfileById(actorPlayer.id);
    const actorDisplayName = (actorPlayer.name || "无名修士").trim() || "无名修士";

    const damageCalculator = await getCombatDamageCalculator();
    const activeSkills = await getPlayerActiveSkillEntries({
      playerId: actorPlayer.id,
      realm: actorPlayer.realm,
    });
    const activeSkillIds = activeSkills.map((entry) => entry.id);
    const skillMap = new Map(activeSkills.map((entry) => [entry.id, entry]));
    const aiSkillMap = {
      skill_basic_attack: {
        id: "skill_basic_attack",
        name: "基础攻击",
        mpCost: 0,
        cooldown: BASIC_ATTACK_RUNTIME_COOLDOWN,
        target: "enemy",
      },
      ...Object.fromEntries(activeSkills.map((entry) => [entry.id, toBossCommandSkillSnapshot(entry)])),
    };
    const actorCombatUnit = createBossPlayerCombatUnit({
      playerId: actorPlayer.id,
      playerName: actorDisplayName,
      stats: actorStats,
      skillIds: ensureCombatSkillIdsWithBasicAttack(activeSkillIds.length ? activeSkillIds : ["skill_basic_attack"]),
      avatarImageUrl: actorCosmetics.avatarImageUrl,
      avatarFrameImageUrl: actorCosmetics.avatarFrameImageUrl,
    });
    actorCombatUnit.realm = actorPlayer.realm;
    const actorParticipant = participants.find((participant) => participant.playerId === actorPlayer.id) || null;
    actorCombatUnit.skillCooldowns = { ...(actorParticipant?.skillCooldowns || {}) };
    actorCombatUnit.activeEffects = tickBossParticipantActiveEffects(actorParticipant?.activeEffects);
    actorCombatUnit.isStunned = actorCombatUnit.activeEffects.some((effect) => (
      effect.type === "freeze" || effect.type === "stun"
    ));
    if (isAdvance) {
      skillId = pickTimedAutoActionSkillId({
        unit: actorCombatUnit,
        skills: aiSkillMap,
      });
    }

    const bossCombatUnit = createBossMonsterCombatUnit(monster);
    bossCombatUnit.realm = await resolveCombatRealmByMapId(monster.mapId);
    bossCombatUnit.hp = instance.currentHp;
    bossCombatUnit.maxHp = instance.maxHp;

    let actionName = "基础攻击";
    let dmg = 0;
    let bossDmg = 0;
    let recoveredHp = 0;
    let recoveredMp = 0;
    let skillOutcome: "damage" | "heal" | "utility" = "damage";
    let actionVisualEffect: CombatSkillVisualEffect | null = null;
    let usedItemEffects: Array<{ type: string; value: number }> = [];
    let pendingItemConsumeQuantity: number | null = null;

    if (action === "item") {
      if (!itemId) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "缺少丹药 ID",
        });
      }

      const inventoryEntry = await db.select().from(playerInventory)
        .where(and(eq(playerInventory.playerId, actorPlayer.id), eq(playerInventory.itemId, itemId)))
        .get();
      if (!inventoryEntry || inventoryEntry.quantity <= 0) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "丹药不存在或数量不足",
        });
      }

      const item = await getItemByIdCompat(itemId);
      if (!item || item.itemType !== "consumable") {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "战斗中只能使用恢复类丹药",
        });
      }
      if (!isRealmMatched(actorPlayer.realm, item.minRealm, item.maxRealm)) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "境界不足，无法使用该丹药",
        });
      }

      usedItemEffects = ((item.effects as ItemEffect[]) || [])
        .filter((effect) => (effect.type === "heal_hp" || effect.type === "heal_mp") && Number(effect.value) > 0)
        .map((effect) => ({ type: effect.type, value: Number(effect.value) }));
      if (!usedItemEffects.length) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "当前首领战仅支持恢复气血或灵力丹药",
        });
      }

      pendingItemConsumeQuantity = inventoryEntry.quantity;
      actionName = item.name;
      const healHp = usedItemEffects
        .filter((effect) => effect.type === "heal_hp")
        .reduce((sum, effect) => sum + effect.value, 0);
      const healMp = usedItemEffects
        .filter((effect) => effect.type === "heal_mp")
        .reduce((sum, effect) => sum + effect.value, 0);
      const hpAfterUse = Math.min(actorStats.total.maxHp, actorCombatUnit.hp + healHp);
      const mpAfterUse = Math.min(actorStats.total.maxMp, actorCombatUnit.mp + healMp);
      recoveredHp = hpAfterUse - actorCombatUnit.hp;
      recoveredMp = mpAfterUse - actorCombatUnit.mp;
      actorCombatUnit.hp = hpAfterUse;
      actorCombatUnit.mp = mpAfterUse;
      skillOutcome = "utility";
    } else {
      const skill = skillId ? (skillMap.get(skillId) || null) : null;
      actionVisualEffect = skill ? (resolveSkillEffectsPayload(skill.effects, skill).visualEffect || null) : null;
      if (skillId && skillId !== "skill_basic_attack" && !skill) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "尚未掌握该神通",
        });
      }
      if (skill && !isRealmMatched(actorPlayer.realm, skill.minRealm, skill.maxRealm)) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "境界不足，无法施展该神通",
        });
      }

      const mpCost = skill?.mpCost ?? 0;
      if (actorCombatUnit.mp < mpCost) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: "灵力不足",
        });
      }

      const cooldownLeft = Number(actorCombatUnit.skillCooldowns?.[skillId || ""] || 0);
      if (skillId && cooldownLeft > 0) {
        return buildBossAcknowledgedErrorResponse({
          status: 400,
          error: `神通冷却中，还需 ${cooldownLeft} 回合`,
        });
      }

      actorCombatUnit.mp = Math.max(0, actorCombatUnit.mp - mpCost);
      actionName = skill?.name || "基础攻击";
      const skillType = skill?.skillType ?? "attack";
      const normalizedCooldown = skillId
        ? normalizeCombatSkillCooldown(skillId, skill?.cooldown ?? BASIC_ATTACK_RUNTIME_COOLDOWN)
        : 0;
      if (skillId && normalizedCooldown > 0) {
        actorCombatUnit.skillCooldowns[skillId] = normalizedCooldown + 1;
      }

      if (skillType === "heal") {
        const healAmount = calculateHealAmount(actorCombatUnit, skill?.sourceType);
        const hpAfterUse = Math.min(actorStats.total.maxHp, actorCombatUnit.hp + healAmount);
        recoveredHp = hpAfterUse - actorCombatUnit.hp;
        actorCombatUnit.hp = hpAfterUse;
        skillOutcome = "heal";
      } else if (skillType === "attack" || skillType === "dot" || skillType === "aoe" || skillType === "debuff") {
        const damageResult = calculateCombatDamageOutcome({
          attacker: actorCombatUnit,
          defender: bossCombatUnit,
          damageBase: skill?.damageBase ?? 5,
          damageMultiplier: skill?.damageMultiplier ?? 1,
          damageCalculator,
          sourceType: skill?.sourceType,
        });
        dmg = damageResult.totalDamage;
        skillOutcome = "damage";
      } else {
        skillOutcome = "utility";
      }
    }

    const bossRespawnSeconds = Math.max(0, monster.respawnSeconds);
    const bossCommitResult = await commitBossDamageToInstance({
      instanceId: instance.id,
      actorPlayerId: actorPlayer.id,
      damage: dmg,
      bossRespawnSeconds,
    });

    if (!bossCommitResult.committed) {
      const waitSeconds = Math.max(1, bossCommitResult.respawnRemainingSeconds);
      return buildBossAcknowledgedErrorResponse({
        status: 400,
        error: `Boss 已被击败，约 ${waitSeconds} 秒后重生`,
        payload: {
          respawnRemainingSeconds: waitSeconds,
        },
      });
    }

    const { lockedInstance, newHp, damageMap, isBossDead } = bossCommitResult;
    if (pendingItemConsumeQuantity !== null) {
      await consumeOneItem(actorPlayer.id, itemId, pendingItemConsumeQuantity);
    }

    await db.update(players).set({
      hp: actorCombatUnit.hp,
      mp: actorCombatUnit.mp,
      updatedAt: new Date().toISOString(),
    }).where(eq(players.id, actorPlayer.id)).run();

    const refreshedParticipants = patchBossParticipant(monsterId, actorPlayer.id, {
      playerName: actorDisplayName,
      hp: actorCombatUnit.hp,
      maxHp: actorStats.total.maxHp,
      mp: actorCombatUnit.mp,
      maxMp: actorStats.total.maxMp,
      lastSeenAt: new Date().toISOString(),
      activeEffects: actorCombatUnit.activeEffects,
      skillCooldowns: tickBossSkillCooldowns(actorCombatUnit.skillCooldowns),
    });

    let participantsPayload = refreshedParticipants;
    let bossCounterSkillName: string | null = null;
    let bossCounterResults: BossCounterResult[] = [];
    if (!isBossDead) {
      const counterOutcome = await applyBossCounterAction({
        bossId: monsterId,
        monster,
        participants: refreshedParticipants,
        preferredTargetPlayerId: actorPlayer.id,
      });
      participantsPayload = counterOutcome.participants;
      bossDmg = counterOutcome.bossCounterDamage;
      bossCounterSkillName = counterOutcome.bossCounterSkillName;
      bossCounterResults = counterOutcome.bossCounterResults;
    }

    turnState = isBossDead ? null : advanceBossTurnState(monsterId);
    const nextBossRoom = getBossRoomState(monsterId);
    const nextBossIntent = isBossDead
      ? null
      : await buildBossNextIntent({
        monster,
        participants: participantsPayload,
        bossMp: nextBossRoom.bossMp,
        bossMaxMp: nextBossRoom.bossMaxMp,
        bossSkillCooldowns: nextBossRoom.bossSkillCooldowns,
      });
    const sceneSnapshot = buildBossSceneSnapshotPayload({
      bossId: monsterId,
      bossName: monster.name,
      participants: participantsPayload,
      turnState,
    });
    setBossSceneSnapshot(monsterId, sceneSnapshot);
    const nextInstance = {
      ...lockedInstance,
      currentHp: newHp,
      maxHp: lockedInstance.maxHp,
      status: isBossDead ? "dead" : "alive",
    } as BossInstanceRow;
    const rewardParticipantIds = [...new Set([
      ...participantsPayload.map((participant) => participant.playerId),
      ...Object.keys(damageMap),
    ])];

    let rewards: BossRewardEntry[] | undefined;
    if (isBossDead) {
      const settlementResult = await settleBossDefeatRewardsAndSideEffects({
        monster,
        instanceId: lockedInstance.id,
        participantPlayerIds: rewardParticipantIds,
        lastHitPlayerId: actorPlayer.id,
        lastHitPlayerName: actorDisplayName,
      });
      rewards = settlementResult.rewards;
    }

    if (partyCombatId) {
      await syncBossPartyEncounter({
        encounterId: partyCombatId,
        monster,
        instance: nextInstance,
        participants: participantsPayload,
        turnState,
        eligibleMemberIds,
        status: isBossDead ? "resolved" : "ongoing",
      });
    }

    if (isBossDead) {
      resetBossRuntimeState(monsterId);
      emitBossEvent({
        type: "boss_dead",
        bossId: monsterId,
        currentHp: newHp,
        maxHp: lockedInstance.maxHp,
        playerId: actorPlayer.id,
        lastHitPlayer: actorDisplayName,
        playerDamage: dmg,
        playerName: actorDisplayName,
        actionType: action,
        ...(skillId ? { skillId } : {}),
        skillName: actionName,
        skillOutcome,
        recoveredHp,
        recoveredMp,
        bossCounterDamage: bossDmg,
        bossCounterSkillName,
        bossCounterResults,
        visualEffect: actionVisualEffect,
        rewards,
        participants: participantsPayload,
        turnState,
        bossNextIntent: null,
        respawnRemainingSeconds: bossRespawnSeconds,
        sceneSnapshot,
      });
      clearBossParticipants(monsterId, true);
    } else {
      emitBossEvent({
        type: "hp_update",
        bossId: monsterId,
        currentHp: newHp,
        maxHp: lockedInstance.maxHp,
        playerId: actorPlayer.id,
        lastHitPlayer: actorDisplayName,
        playerDamage: dmg,
        playerName: actorDisplayName,
        actionType: action,
        ...(skillId ? { skillId } : {}),
        skillName: actionName,
        skillOutcome,
        recoveredHp,
        recoveredMp,
        bossCounterDamage: bossDmg,
        bossCounterSkillName,
        bossCounterResults,
        visualEffect: actionVisualEffect,
        participants: participantsPayload,
        turnState,
        bossNextIntent: nextBossIntent,
        sceneSnapshot,
      });
    }

    const viewerRow = await db.select({
      hp: players.hp,
      mp: players.mp,
    }).from(players).where(eq(players.id, player.id)).get();
    const viewerCounterResult = bossCounterResults.find((result) => result.playerId === player.id);
    const viewerDied = Boolean(viewerCounterResult?.died);
    const joined = participantsPayload.some((participant) => participant.playerId === player.id);
    const viewerParticipant = participantsPayload.find((participant) => participant.playerId === player.id);
    const viewerHp = viewerRow?.hp ?? viewerParticipant?.hp ?? playerStats.total.hp;
    const viewerMp = viewerRow?.mp ?? viewerParticipant?.mp ?? playerStats.total.mp;
    const viewerCanAttack = !isBossDead && !viewerDied && turnState?.currentTurnPlayerId === player.id;
    let dieMessage: string | undefined;
    if (viewerDied) {
      dieMessage = `你不敌 ${bossDisplayName}，已被送离战场。`;
    }
    const { battleView: bossBattleView, battleRuntime } = buildBossBattleRuntimePayload({
      runtimeId: monsterId,
      bossName: monster.name,
      currentHp: newHp,
      maxHp: lockedInstance.maxHp,
      participants: participantsPayload,
      turnState,
      sceneSnapshot,
      viewerPlayerId: player.id,
      statusText: isBossDead ? "首领已被击败" : "首领交战中",
      modePayload: {
        partyCombatId: partyCombatId || null,
        joined,
        roomFull: false,
        canAttack: viewerCanAttack,
        bossNextIntent: nextBossIntent,
      },
    });
    const command = createBattleCommand({
      runtimeId: monsterId,
      mode: "boss",
      type: mapBossCommandActionToBattleCommandType({
        isAdvance,
        action,
      }),
      actorId: actorPlayer.id,
      payload: {
        ...(skillId ? { skillId } : {}),
        ...(itemId ? { itemId } : {}),
        ...(isAdvance ? { advance: true } : {}),
      },
      actionId: actionId || null,
      clientSentAt,
      clientSequence,
      clientSceneTick,
    });
    acceptBossClientSequence(monsterId, player.id, clientSequence);
    // Boss 事务一旦成功：消耗丹药必须补发背包帧，首领被击杀结算必须补发资产 / 进度帧。
    const bossRefreshFrames = await publishCombatRefreshFrames({
      playerId: actorPlayer.id,
      roomId: monsterId,
      serverTick: battleRuntime.sceneSnapshot?.tick ?? 0,
      consumedItemIds: pendingItemConsumeQuantity !== null && itemId ? [itemId] : [],
      settled: isBossDead,
    });
    return buildBattleCommandRouteResponse({
      success: true,
      runtimeId: monsterId,
      mode: "boss",
      command,
      routeData: {
        state: null,
        battleView: bossBattleView,
        battleRuntime,
        sceneSnapshot,
        turnState,
      },
      acceptedClientSequence: clientSequence,
      serverSceneTick: battleRuntime.sceneSnapshot?.tick ?? 0,
      refreshFrames: bossRefreshFrames,
      payload: {
        actionType: action,
        partyCombatId: partyCombatId || null,
        damage: dmg,
        bossHp: newHp,
        bossMaxHp: lockedInstance.maxHp,
        bossDead: isBossDead,
        bossCounterDamage: bossDmg,
        bossCounterSkillName,
        bossCounterResults,
        playerId: actorPlayer.id,
        playerHp: viewerHp,
        playerMp: viewerMp,
        skillName: actionName,
        skillOutcome,
        recoveredHp,
        recoveredMp,
        itemEffects: usedItemEffects,
        rewards: isBossDead ? (rewards ?? null) : null,
        respawnRemainingSeconds: isBossDead ? bossRespawnSeconds : 0,
        participants: participantsPayload,
        roomFull: false,
        joined,
        canAttack: viewerCanAttack,
        battleView: bossBattleView,
        battleRuntime,
        sceneSnapshot,
        turnState,
        bossNextIntent: nextBossIntent,
        died: viewerDied,
        message: dieMessage,
      },
    });
  } catch (error) {
    console.error("Boss attack error:", error);
    return NextResponse.json({ success: false, error: "攻击失败" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer(req);
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id: monsterId } = await params;
    const { participants, turnState, sceneSnapshot } = await performBossLeaveCommandTransaction({
      bossId: monsterId,
      playerId: player.id,
    });
    return NextResponse.json({
      success: true,
      data: {
        participants,
        turnState,
        sceneSnapshot,
      },
    });
  } catch (error) {
    console.error("Boss leave error:", error);
    return NextResponse.json({ success: false, error: "离开首领房间失败" }, { status: 500 });
  }
}
