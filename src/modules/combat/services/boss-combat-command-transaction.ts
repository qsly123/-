import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bossInstances, combatRewardClaims, items, players, playerInventory, skills } from "@/db/schema";
import { applyPlayerDefeatRespawn } from "@/modules/character/services/player-death-respawn";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { applyFortuneEventEffects, applyXpRateForPlayer } from "@/modules/character/services/fortune-service";
import { consumePlayerStaminaForReward, consumePlayerStaminaForRewardTx, STAMINA_REWARD_COST } from "@/modules/character/services/stamina-service";
import { publishSystemAnnouncement } from "@/modules/chat/services/chat-service";
import { getCombatDamageCalculator } from "@/modules/combat/services/damage-formula";
import { applyCombatXpGap } from "@/modules/combat/services/combat-reward-scaling";
import { calculateCombatDamageOutcome } from "@/modules/combat/services/combat-mechanics";
import {
  ensureCombatRewardClaimSchema,
  getCombatRewardClaim,
  lockCombatRewardClaimForUpdateTx,
} from "@/modules/combat/services/combat-reward-claim-service";
import { incrementPlayerDeathCount } from "@/modules/combat/services/player-hidden-combat-stats";
import { runCombatSideEffectOnce } from "@/modules/combat/services/combat-side-effect-claim-service";
import {
  getSecretRealmContextByMonsterId,
  handleSecretRealmBossDefeated,
  moveSecretRealmPlayerToReturnPoint,
} from "@/modules/map/services/secret-realm-instance-service";
import { grantSecretRealmMonsterPlayerRewards } from "@/modules/map/services/secret-realm-drop-generation-service";
import { pickSharedEnemySkillId } from "@/modules/combat/services/combat-ai";
import { runCombatKillQuestProgressIntent } from "@/modules/combat/services/combat-quest-side-effect-intent";
import type { BattleCommandType } from "@/types/game";
import type { BossEvent, BossParticipant, CombatUnit, DropItem, SkillSourceType } from "@/types/game";
import {
  BASIC_MONSTER_SKILL_ID,
  createBuiltinMonsterBasicAttackSkill,
  normalizeCombatSkillCooldown,
  normalizeMonsterCombatSkillIds,
} from "@/modules/combat/services/monster-skill-utils";
import { resolveSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";

export type BossCommandAction = "skill" | "item";
export type BossRewardEntry = NonNullable<BossEvent["rewards"]>[number];
export type BossRewardClaimSnapshot = BossRewardEntry;
export type BossCounterResult = NonNullable<BossEvent["bossCounterResults"]>[number];

type BossRewardTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BossInstanceRow = typeof bossInstances.$inferSelect;

export interface NormalizedBossCommandRequest {
  isAdvance: boolean;
  action: BossCommandAction;
  skillId: string;
  itemId: string;
  requestPartyCombatId: string;
  actionId: string;
  clientSentAt?: number;
  clientSequence?: number;
  clientSceneTick?: number;
}

export interface BossCommandSkillSnapshotSource {
  id: string;
  name: string;
  skillType: string;
  mpCost: number;
  cooldown: number;
  target: string;
  damageBase: number;
  damageMultiplier: number;
  sourceType?: SkillSourceType;
  effects: unknown;
}

export interface BossKillSideEffectMonsterSource {
  id: string;
  name?: string | null;
}

export interface BossRewardMonsterSource extends BossKillSideEffectMonsterSource {
  xpReward: number;
  goldReward: number;
  drops?: unknown;
  /** 怪物等级，用于修为的跨境界调整；拿不到时按 0 处理（等同同级系数需调用方显式给出） */
  level?: number | null;
}

export interface BossInstanceLifecycleMonsterSource {
  id: string;
  name?: string | null;
  hp: number;
}

export interface BossCombatUnitMonsterSource extends BossInstanceLifecycleMonsterSource {
  iconUrl?: string | null;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
  skills: unknown;
}

export type BossDamageCommitResult =
  | {
    committed: false;
    respawnRemainingSeconds: number;
  }
  | {
    committed: true;
    lockedInstance: BossInstanceRow;
    newHp: number;
    damageMap: Record<string, number>;
    isBossDead: boolean;
    respawnRemainingSeconds: number;
  };

export interface BossInstanceLifecycleResult {
  instance: BossInstanceRow | null;
  respawnRemainingSeconds: number;
  shouldClearParticipants: boolean;
  spawned: boolean;
}

function getRespawnRemainingSeconds(nextSpawnAt: string | null | undefined, nowMs = Date.now()) {
  if (!nextSpawnAt) {
    return 0;
  }
  const next = Date.parse(nextSpawnAt);
  if (Number.isNaN(next)) {
    return 0;
  }
  return Math.max(0, Math.ceil((next - nowMs) / 1000));
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readClientSentAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function normalizeBossCommandRequestBody(rawBody: unknown): NormalizedBossCommandRequest {
  const body = rawBody && typeof rawBody === "object"
    ? rawBody as Record<string, unknown>
    : {};
  const isAdvance = body.advance === true;
  return {
    isAdvance,
    action: body.action === "item" && !isAdvance ? "item" : "skill",
    skillId: readString(body.skillId),
    itemId: readString(body.itemId),
    requestPartyCombatId: readString(body.partyCombatId),
    actionId: readString(body.actionId),
    clientSentAt: readClientSentAt(body.clientSentAt),
    clientSequence: readPositiveInteger(body.clientSequence),
    clientSceneTick: readNonNegativeInteger(body.clientSceneTick),
  };
}

export function mapBossCommandActionToBattleCommandType(params: {
  isAdvance: boolean;
  action: BossCommandAction;
}): BattleCommandType {
  if (params.isAdvance) {
    return "ready";
  }
  return params.action === "item" ? "use_item" : "cast_skill";
}

export function toBossCommandSkillSnapshot(skill: BossCommandSkillSnapshotSource) {
  const normalized = resolveSkillEffectsPayload(skill.effects, skill);
  return {
    id: skill.id,
    name: skill.name,
    skillType: skill.skillType,
    mpCost: skill.mpCost,
    cooldown: normalizeCombatSkillCooldown(skill.id, skill.cooldown),
    target: skill.target,
    damageBase: skill.damageBase,
    damageMultiplier: skill.damageMultiplier,
    sourceType: skill.sourceType,
    effects: normalized.effects,
    visualEffect: normalized.visualEffect,
  };
}

export async function loadBossSkillMap(skillIds: string[]) {
  const uniqueSkillIds = [...new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))];
  if (!uniqueSkillIds.length) {
    return {
      [BASIC_MONSTER_SKILL_ID]: toBossCommandSkillSnapshot(createBuiltinMonsterBasicAttackSkill()),
    } as Record<string, ReturnType<typeof toBossCommandSkillSnapshot>>;
  }
  const rows = await db.select().from(skills).where(inArray(skills.id, uniqueSkillIds)).all();
  const map = Object.fromEntries(rows.map((row) => [row.id, toBossCommandSkillSnapshot(row)]));
  if (!map[BASIC_MONSTER_SKILL_ID]) {
    map[BASIC_MONSTER_SKILL_ID] = toBossCommandSkillSnapshot(createBuiltinMonsterBasicAttackSkill());
  }
  return map;
}

export function tickBossSkillCooldowns(currentCooldowns: Record<string, number>) {
  const nextCooldowns: Record<string, number> = {};
  for (const [skillId, turns] of Object.entries(currentCooldowns || {})) {
    const nextTurns = Number(turns || 0) - 1;
    if (nextTurns > 0) {
      nextCooldowns[skillId] = nextTurns;
    }
  }
  return nextCooldowns;
}

export function createBossMonsterCombatUnit(monster: BossCombatUnitMonsterSource): CombatUnit {
  return {
    id: monster.id,
    name: monster.name || "世界首领",
    isPlayer: false,
    avatarImageUrl: monster.iconUrl || null,
    avatarFrameImageUrl: null,
    hp: monster.hp,
    maxHp: monster.hp,
    mp: 100,
    maxMp: 100,
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
    skills: normalizeMonsterCombatSkillIds(monster.skills),
    skillCooldowns: {},
    activeEffects: [],
    isStunned: false,
  };
}

export function createBossRoomCombatUnit(participant: BossParticipant): CombatUnit {
  return {
    id: participant.playerId,
    name: participant.playerName,
    isPlayer: true,
    avatarImageUrl: participant.avatarImageUrl || null,
    avatarFrameImageUrl: participant.avatarFrameImageUrl || null,
    hp: participant.hp,
    maxHp: participant.maxHp,
    mp: participant.mp,
    maxMp: participant.maxMp,
    attack: 0,
    defense: 0,
    speed: 0,
    luck: 0,
    spiritualSense: 0,
    armorPenetration: 0,
    block: 0,
    skillDamageBonus: 0,
    skillDamageReduction: 0,
    artifactDamageBonus: 0,
    artifactDamageReduction: 0,
    skills: ["skill_basic_attack"],
    skillCooldowns: { ...(participant.skillCooldowns || {}) },
    activeEffects: Array.isArray(participant.activeEffects)
      ? participant.activeEffects.map((effect) => ({ ...effect }))
      : [],
    isStunned: false,
  };
}

export async function buildBossNextIntent(params: {
  monster: BossCombatUnitMonsterSource;
  participants: BossParticipant[];
  bossMp: number;
  bossMaxMp: number;
  bossSkillCooldowns: Record<string, number>;
}) {
  const bossSkillMap = await loadBossSkillMap(normalizeMonsterCombatSkillIds(params.monster.skills));
  const bossCombatUnit = createBossMonsterCombatUnit(params.monster);
  bossCombatUnit.mp = params.bossMp;
  bossCombatUnit.maxMp = params.bossMaxMp;
  bossCombatUnit.skillCooldowns = params.bossSkillCooldowns || {};

  const selectedSkillId = pickSharedEnemySkillId({
    unit: bossCombatUnit,
    skills: bossSkillMap,
    aliveEnemyCount: params.participants.filter((participant) => participant.hp > 0).length,
  });
  const selectedSkill = selectedSkillId ? bossSkillMap[selectedSkillId] : null;

  return {
    skillId: selectedSkillId || null,
    skillName: selectedSkill?.name || "基础攻击",
    targetType: selectedSkill?.target === "all_enemies" ? "all_enemies" : "single",
  } as NonNullable<BossEvent["bossNextIntent"]>;
}

export async function resolveBossCounterAction(params: {
  monster: BossCombatUnitMonsterSource;
  participants: BossParticipant[];
  preferredTargetPlayerId: string;
  bossMp: number;
  bossMaxMp: number;
  bossSkillCooldowns: Record<string, number>;
}) {
  const aliveParticipants = params.participants.filter((participant) => participant.hp > 0);
  if (!aliveParticipants.length) {
    return {
      participants: params.participants,
      bossMp: params.bossMp,
      bossMaxMp: params.bossMaxMp,
      bossSkillCooldowns: params.bossSkillCooldowns,
      bossCounterDamage: 0,
      bossCounterSkillName: null,
      bossCounterResults: [] as BossCounterResult[],
    };
  }

  const bossSkillMap = await loadBossSkillMap(normalizeMonsterCombatSkillIds(params.monster.skills));
  const bossCombatUnit = createBossMonsterCombatUnit(params.monster);
  bossCombatUnit.mp = params.bossMp;
  bossCombatUnit.maxMp = params.bossMaxMp;
  bossCombatUnit.skillCooldowns = { ...params.bossSkillCooldowns };

  const selectedSkillId = pickSharedEnemySkillId({
    unit: bossCombatUnit,
    skills: bossSkillMap,
    aliveEnemyCount: aliveParticipants.length,
  });
  const selectedSkill = bossSkillMap[selectedSkillId];
  const damageCalculator = await getCombatDamageCalculator();
  const targetParticipants = selectedSkill?.target === "all_enemies"
    ? aliveParticipants
    : [aliveParticipants.find((participant) => participant.playerId === params.preferredTargetPlayerId) || aliveParticipants[0]].filter(Boolean);
  const bossCounterResults: BossCounterResult[] = [];
  const skillName = selectedSkill?.name || "基础攻击";

  if (selectedSkill) {
    bossCombatUnit.mp = Math.max(0, bossCombatUnit.mp - Math.max(0, Number(selectedSkill.mpCost || 0)));
    const normalizedCooldown = normalizeCombatSkillCooldown(selectedSkillId, Number(selectedSkill.cooldown || 0));
    if (normalizedCooldown > 0) {
      bossCombatUnit.skillCooldowns[selectedSkillId] = normalizedCooldown + 1;
    }
  }

  for (const participant of targetParticipants) {
    const defender = createBossRoomCombatUnit(participant);
    const result = calculateCombatDamageOutcome({
      attacker: bossCombatUnit,
      defender,
      damageBase: Number(selectedSkill?.damageBase || 0),
      damageMultiplier: Number(selectedSkill?.damageMultiplier || 1),
      damageCalculator,
      sourceType: selectedSkill?.sourceType || "monster",
    });
    bossCounterResults.push(await resolveBossParticipantStateAfterDamage({
      bossDisplayName: params.monster.name || "世界首领",
      participant,
      damage: result.totalDamage,
      hpDamage: result.hpDamage,
      mpDamage: result.mpDamage,
    }));
  }

  const timestamp = new Date().toISOString();
  const nextParticipants = params.participants
    .map((participant) => {
      const counter = bossCounterResults.find((item) => item.playerId === participant.playerId);
      if (!counter) {
        return participant;
      }
      if (counter.died) {
        return null;
      }
      return {
        ...participant,
        hp: counter.currentHp ?? participant.hp,
        mp: counter.currentMp ?? participant.mp,
        lastSeenAt: timestamp,
      };
    })
    .filter((participant): participant is BossParticipant => Boolean(participant));

  return {
    participants: nextParticipants,
    bossMp: bossCombatUnit.mp,
    bossMaxMp: bossCombatUnit.maxMp,
    bossSkillCooldowns: tickBossSkillCooldowns(bossCombatUnit.skillCooldowns),
    bossCounterDamage: bossCounterResults[0]?.damage || 0,
    bossCounterSkillName: skillName,
    bossCounterResults,
  };
}

export function toBossRewardCombatId(instanceId: number | string) {
  return `boss:${instanceId}`;
}

export async function commitBossDamageToInstance(params: {
  instanceId: number | string;
  actorPlayerId: string;
  damage: number;
  bossRespawnSeconds: number;
}): Promise<BossDamageCommitResult> {
  return db.transaction(async (tx) => {
    const lockedRows = await tx.execute(sql<BossInstanceRow[]>`
      select
        id,
        monster_id as "monsterId",
        current_hp as "currentHp",
        max_hp as "maxHp",
        last_hit_player_id as "lastHitPlayerId",
        status,
        damage_map as "damageMap",
        spawned_at as "spawnedAt",
        killed_at as "killedAt",
        next_spawn_at as "nextSpawnAt"
      from boss_instances
      where id = ${params.instanceId}
      for update
    `);
    const lockedInstance = (Array.isArray(lockedRows) ? lockedRows[0] : null) as BossInstanceRow | undefined;
    const remainingSeconds = getRespawnRemainingSeconds(lockedInstance?.nextSpawnAt);
    if (!lockedInstance || lockedInstance.status !== "alive" || lockedInstance.currentHp <= 0 || remainingSeconds > 0) {
      return {
        committed: false,
        respawnRemainingSeconds: Math.max(1, remainingSeconds || params.bossRespawnSeconds),
      };
    }

    const damageMap = { ...((lockedInstance.damageMap as Record<string, number>) || {}) };
    if (params.damage > 0) {
      damageMap[params.actorPlayerId] = (damageMap[params.actorPlayerId] || 0) + params.damage;
    }

    const newHp = Math.max(0, lockedInstance.currentHp - params.damage);
    const isBossDead = newHp <= 0;
    const killedAt = isBossDead ? new Date().toISOString() : null;
    const nextSpawnAt = isBossDead
      ? new Date(Date.now() + params.bossRespawnSeconds * 1000).toISOString()
      : null;

    await tx.update(bossInstances).set({
      currentHp: newHp,
      lastHitPlayerId: params.damage > 0 ? params.actorPlayerId : lockedInstance.lastHitPlayerId,
      damageMap,
      status: isBossDead ? "dead" : "alive",
      killedAt,
      nextSpawnAt,
    }).where(eq(bossInstances.id, lockedInstance.id)).run();

    return {
      committed: true,
      lockedInstance,
      newHp,
      damageMap,
      isBossDead,
      respawnRemainingSeconds: isBossDead ? params.bossRespawnSeconds : 0,
    };
  });
}

export async function resolveBossInstanceLifecycle(
  monster: BossInstanceLifecycleMonsterSource,
): Promise<BossInstanceLifecycleResult> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const aliveInstance = await db.select().from(bossInstances)
    .where(and(eq(bossInstances.monsterId, monster.id), eq(bossInstances.status, "alive")))
    .orderBy(desc(bossInstances.id))
    .get();

  if (aliveInstance) {
    const remaining = getRespawnRemainingSeconds(aliveInstance.nextSpawnAt, nowMs);
    if (remaining > 0) {
      return {
        instance: null,
        respawnRemainingSeconds: remaining,
        shouldClearParticipants: true,
        spawned: false,
      };
    }
    return {
      instance: aliveInstance,
      respawnRemainingSeconds: 0,
      shouldClearParticipants: false,
      spawned: false,
    };
  }

  const deadInstance = await db.select().from(bossInstances)
    .where(and(eq(bossInstances.monsterId, monster.id), eq(bossInstances.status, "dead")))
    .orderBy(desc(bossInstances.id))
    .get();

  if (!deadInstance) {
    await db.insert(bossInstances).values({
      monsterId: monster.id,
      currentHp: monster.hp,
      maxHp: monster.hp,
      status: "alive",
      damageMap: {},
      spawnedAt: nowIso,
      killedAt: null,
      nextSpawnAt: null,
    }).run();

    const createdInstance = await db.select().from(bossInstances)
      .where(and(eq(bossInstances.monsterId, monster.id), eq(bossInstances.status, "alive")))
      .orderBy(desc(bossInstances.id))
      .get();

    return {
      instance: createdInstance || null,
      respawnRemainingSeconds: 0,
      shouldClearParticipants: true,
      spawned: false,
    };
  }

  const remaining = getRespawnRemainingSeconds(deadInstance.nextSpawnAt, nowMs);
  if (remaining > 0) {
    return {
      instance: null,
      respawnRemainingSeconds: remaining,
      shouldClearParticipants: true,
      spawned: false,
    };
  }

  await db.update(bossInstances)
    .set({
      currentHp: monster.hp,
      maxHp: monster.hp,
      lastHitPlayerId: null,
      status: "alive",
      damageMap: {},
      spawnedAt: nowIso,
      killedAt: null,
      nextSpawnAt: null,
    })
    .where(eq(bossInstances.id, deadInstance.id))
    .run();

  const revivedInstance = await db.select().from(bossInstances).where(eq(bossInstances.id, deadInstance.id)).get();
  return {
    instance: revivedInstance || null,
    respawnRemainingSeconds: 0,
    shouldClearParticipants: true,
    spawned: true,
  };
}

export async function resolveBossParticipantStateAfterDamage(params: {
  bossDisplayName: string;
  participant: BossParticipant;
  damage: number;
  hpDamage: number;
  mpDamage: number;
}) {
  const playerRow = await getPlayerByIdCompat(params.participant.playerId);
  if (!playerRow) {
    return {
      playerId: params.participant.playerId,
      playerName: params.participant.playerName,
      slot: params.participant.slot,
      damage: params.damage,
      currentHp: Math.max(0, params.participant.hp - params.hpDamage),
      currentMp: Math.max(0, params.participant.mp - params.mpDamage),
      died: false,
    } satisfies BossCounterResult;
  }

  const nextHp = Math.max(0, params.participant.hp - params.hpDamage);
  let finalHp = nextHp;
  let finalMp = Math.max(0, params.participant.mp - params.mpDamage);
  let died = false;

  if (nextHp <= 0) {
    died = true;
    await incrementPlayerDeathCount(playerRow.id);
    finalHp = 1;
    finalMp = 1;
    const nowIso = new Date().toISOString();
    const secretRealmExit = await moveSecretRealmPlayerToReturnPoint({
      playerId: playerRow.id,
      hp: finalHp,
      mp: finalMp,
      nowIso,
    });
    const respawnTarget = !secretRealmExit
      ? await applyPlayerDefeatRespawn({
        playerId: playerRow.id,
        hp: finalHp,
        mp: finalMp,
        nowIso,
      })
      : null;

    await applyFortuneEventEffects({
      playerId: playerRow.id,
      trigger: "self_death",
    });
    void publishSystemAnnouncement(`【Boss战报】${playerRow.name || "无名修士"} 不敌 ${params.bossDisplayName}，气血与灵力均跌至 1 点，被送回了${respawnTarget?.mode === "sect" ? "宗门" : "出生点"}。`).catch((announcementError) => {
      console.error("Boss counter death announcement error:", announcementError);
    });
  } else {
    await db.update(players).set({
      hp: finalHp,
      mp: finalMp,
      updatedAt: new Date().toISOString(),
    }).where(eq(players.id, playerRow.id)).run();
  }

  return {
    playerId: params.participant.playerId,
    playerName: params.participant.playerName,
    slot: params.participant.slot,
    damage: params.damage,
    currentHp: finalHp,
    currentMp: finalMp,
    died,
  } satisfies BossCounterResult;
}

export function readBossRewardClaimSnapshot(claim?: {
  rewardSnapshot?: unknown;
} | null): BossRewardClaimSnapshot | null {
  const rewardSnapshot = claim?.rewardSnapshot;
  if (!rewardSnapshot || typeof rewardSnapshot !== "object") {
    return null;
  }

  const snapshot = rewardSnapshot as Partial<BossRewardClaimSnapshot>;
  if (typeof snapshot.playerId !== "string" || typeof snapshot.playerName !== "string") {
    return null;
  }

  return snapshot as BossRewardClaimSnapshot;
}

export async function upsertBossRewardInventoryItemTx(params: {
  tx: BossRewardTx;
  playerId: string;
  itemId: string;
  quantity: number;
}) {
  const existing = await params.tx.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, params.playerId), eq(playerInventory.itemId, params.itemId)))
    .get();
  if (existing) {
    await params.tx.update(playerInventory).set({
      quantity: existing.quantity + params.quantity,
    }).where(and(eq(playerInventory.playerId, params.playerId), eq(playerInventory.itemId, params.itemId))).run();
    return;
  }

  await params.tx.insert(playerInventory).values({
    playerId: params.playerId,
    itemId: params.itemId,
    quantity: params.quantity,
  }).run();
}

export async function settleBossRewardClaim(params: {
  combatId: string;
  playerId: string;
  opponentId: string;
  buildSnapshot: (tx: BossRewardTx) => Promise<BossRewardClaimSnapshot>;
}) {
  const schemaReady = await ensureCombatRewardClaimSchema();
  if (!schemaReady) {
    return {
      reward: await db.transaction(async (tx) => params.buildSnapshot(tx)),
      replayed: false,
    };
  }

  return db.transaction(async (tx) => {
    const nowIso = new Date().toISOString();
    await tx.insert(combatRewardClaims).values({
      combatId: params.combatId,
      playerId: params.playerId,
      opponentType: "boss",
      opponentId: params.opponentId,
      status: "pending",
      rewardSnapshot: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoNothing().run();

    const lockedClaim = await lockCombatRewardClaimForUpdateTx({
      tx,
      combatId: params.combatId,
      playerId: params.playerId,
    });
    const lockedReward = readBossRewardClaimSnapshot(lockedClaim);
    if (lockedClaim && lockedClaim.status !== "pending" && lockedReward) {
      return {
        reward: lockedReward,
        replayed: true,
      };
    }
    if (!lockedClaim) {
      throw new Error("Boss 奖励 claim 占位失败");
    }

    const reward = await params.buildSnapshot(tx);
    await tx.update(combatRewardClaims).set({
      opponentType: "boss",
      opponentId: params.opponentId,
      status: reward.noRewardReason ? "no_reward" : "claimed",
      rewardSnapshot: reward,
      claimedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(combatRewardClaims.id, lockedClaim.id)).run();

    return {
      reward,
      replayed: false,
    };
  });
}

export async function persistBossRewardClaimSnapshot(params: {
  combatId: string;
  playerId: string;
  opponentId: string;
  reward: BossRewardClaimSnapshot;
}) {
  if (!(await ensureCombatRewardClaimSchema())) {
    return params.reward;
  }

  return db.transaction(async (tx) => {
    const nowIso = new Date().toISOString();
    await tx.insert(combatRewardClaims).values({
      combatId: params.combatId,
      playerId: params.playerId,
      opponentType: "boss",
      opponentId: params.opponentId,
      status: "pending",
      rewardSnapshot: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoNothing().run();

    const lockedClaim = await lockCombatRewardClaimForUpdateTx({
      tx,
      combatId: params.combatId,
      playerId: params.playerId,
    });
    const lockedReward = readBossRewardClaimSnapshot(lockedClaim);
    if (lockedClaim && lockedClaim.status !== "pending" && lockedReward) {
      return lockedReward;
    }
    if (!lockedClaim) {
      throw new Error("Boss 奖励 claim 写入失败");
    }

    await tx.update(combatRewardClaims).set({
      opponentType: "boss",
      opponentId: params.opponentId,
      status: params.reward.noRewardReason ? "no_reward" : "claimed",
      rewardSnapshot: params.reward,
      claimedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(combatRewardClaims.id, lockedClaim.id)).run();

    return params.reward;
  });
}

export async function updateBossRewardClaimSnapshot(params: {
  combatId: string;
  playerId: string;
  opponentId: string;
  reward: BossRewardClaimSnapshot;
}) {
  if (!(await ensureCombatRewardClaimSchema())) {
    return params.reward;
  }

  const nowIso = new Date().toISOString();
  const updated = await db.update(combatRewardClaims).set({
    opponentType: "boss",
    opponentId: params.opponentId,
    status: params.reward.noRewardReason ? "no_reward" : "claimed",
    rewardSnapshot: params.reward,
    claimedAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(combatRewardClaims.combatId, params.combatId),
    eq(combatRewardClaims.playerId, params.playerId),
  )).returning().get();

  return readBossRewardClaimSnapshot(updated) || params.reward;
}

export async function applySecretRealmConsolationRewards(params: {
  combatId: string;
  monsterId: string;
  rewards: BossRewardEntry[];
  consolationRewardsByPlayerId?: Record<string, NonNullable<BossRewardEntry["drops"]>>;
}) {
  if (!params.consolationRewardsByPlayerId || !params.rewards.length) {
    return params.rewards;
  }

  const mergedRewards = params.rewards.map((entry) => {
    if (entry.isLastHit) {
      return entry;
    }

    const consolationDrops = params.consolationRewardsByPlayerId?.[entry.playerId] || [];
    if (!consolationDrops.length) {
      return entry;
    }

    return {
      ...entry,
      drops: [...(entry.drops || []), ...consolationDrops],
    };
  });

  await Promise.all(mergedRewards.map(async (entry) => {
    await updateBossRewardClaimSnapshot({
      combatId: params.combatId,
      playerId: entry.playerId,
      opponentId: params.monsterId,
      reward: entry,
    });
  }));

  return mergedRewards;
}

export async function runBossKillSideEffects(params: {
  combatId: string;
  monster: BossKillSideEffectMonsterSource;
  rewardedPlayerIds: string[];
  lastHitPlayerId?: string | null;
  lastHitPlayerName?: string | null;
  secretRealm: boolean;
}) {
  const tasks: Array<Promise<unknown>> = [];
  const rewardPlayerIds = [...new Set(params.rewardedPlayerIds.map((playerId) => playerId.trim()).filter(Boolean))];

  for (const playerId of rewardPlayerIds) {
    tasks.push(runCombatKillQuestProgressIntent({
      effectKeyPrefix: "boss-kill-quest",
      combatId: params.combatId,
      effectType: "boss_kill_quest",
      playerId,
      monsterId: params.monster.id,
    }));
    tasks.push(runCombatSideEffectOnce({
      effectKey: `boss-kill-fortune:${params.combatId}:${playerId}`,
      combatId: params.combatId,
      effectType: "boss_kill_fortune",
      playerId,
      task: () => applyFortuneEventEffects({
        playerId,
        trigger: "kill_monster",
      }),
    }));
  }

  const killerPlayerId = params.lastHitPlayerId?.trim() || null;
  const killerPlayerName = params.lastHitPlayerName?.trim()
    || (killerPlayerId ? (await getPlayerByIdCompat(killerPlayerId))?.name?.trim() : "")
    || "无名修士";
  tasks.push(runCombatSideEffectOnce({
    effectKey: `boss-kill-announce:${params.combatId}`,
    combatId: params.combatId,
    effectType: "boss_kill_announcement",
    playerId: killerPlayerId,
    task: () => publishSystemAnnouncement(`【${params.secretRealm ? "秘境之主" : "世界首领"}】${killerPlayerName} 成功讨伐了 ${params.monster.name || "世界首领"}。`),
  }));

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Boss kill side effect compensation error:", result.reason);
    }
  }
}

export async function distributeBossRewards(params: {
  monster: BossRewardMonsterSource;
  instanceId: number | string;
  participantPlayerIds: string[];
  lastHitPlayerId: string;
}) {
  const combatId = toBossRewardCombatId(params.instanceId);
  const participantIds = [...new Set(params.participantPlayerIds.map((id) => id.trim()).filter(Boolean))];
  const secretRealmContext = await getSecretRealmContextByMonsterId(params.monster.id);
  const rewardedPlayerIds: string[] = [];
  const rewards: BossRewardEntry[] = [];
  const shareCount = Math.max(1, participantIds.length);
  const baseShareXp = Math.floor(params.monster.xpReward / shareCount);
  const baseShareGold = Math.floor(params.monster.goldReward / shareCount);
  const drops = (params.monster.drops as DropItem[]) || [];

  for (const playerId of participantIds) {
    const isLastHit = playerId === params.lastHitPlayerId;
    const currentPlayer = await getPlayerByIdCompat(playerId);

    if (!currentPlayer) {
      rewards.push({
        playerId,
        playerName: "无名",
        xp: 0,
        gold: 0,
        isLastHit,
        rewarded: false,
      });
      continue;
    }

    const bonusXp = isLastHit ? Math.floor(params.monster.xpReward * 0.3) : 0;
    const bonusGold = isLastHit ? Math.floor(params.monster.goldReward * 0.3) : 0;
    const baseXp = baseShareXp + bonusXp;
    const finalGold = baseShareGold + bonusGold;
    const finalXp = baseXp > 0
      ? (await applyCombatXpGap(
        await applyXpRateForPlayer({
          playerId,
          baseXp,
          channel: "combat",
        }),
        Number(currentPlayer.realm ?? 0),
        Number(params.monster.level ?? currentPlayer.realm ?? 0),
      )).xp
      : 0;

    if (secretRealmContext) {
      const existingClaim = await getCombatRewardClaim({
        combatId,
        playerId,
      });
      const existingReward = readBossRewardClaimSnapshot(existingClaim);
      if (existingReward) {
        rewards.push(existingReward);
        continue;
      }

      const staminaConsumeResult = await consumePlayerStaminaForReward(playerId, STAMINA_REWARD_COST);
      if (!staminaConsumeResult.consumed) {
        const noRewardEntry: BossRewardEntry = {
          playerId,
          playerName: currentPlayer.name || "无名",
          xp: 0,
          gold: 0,
          isLastHit,
          rewarded: false,
          noRewardReason: "stamina_empty",
        };
        rewards.push(await persistBossRewardClaimSnapshot({
          combatId,
          playerId,
          opponentId: params.monster.id,
          reward: noRewardEntry,
        }));
        continue;
      }

      const secretRealmReward = await grantSecretRealmMonsterPlayerRewards({
        monsterId: params.monster.id,
        playerId,
        xp: finalXp,
        gold: finalGold,
        markMonsterDefeated: false,
      });
      const rewardEntry: BossRewardEntry = {
        playerId,
        playerName: currentPlayer.name || "无名",
        xp: secretRealmReward?.xp ?? finalXp,
        gold: secretRealmReward?.gold ?? finalGold,
        isLastHit,
        rewarded: true,
        staminaCost: STAMINA_REWARD_COST,
        staminaAfter: staminaConsumeResult.stamina,
        ...(secretRealmReward?.drops?.length ? { drops: secretRealmReward.drops } : {}),
        ...(secretRealmReward?.noRewardReason ? { noRewardReason: secretRealmReward.noRewardReason } : {}),
      };
      rewards.push(await persistBossRewardClaimSnapshot({
        combatId,
        playerId,
        opponentId: params.monster.id,
        reward: rewardEntry,
      }));
      if (!secretRealmReward?.reusedClaim) {
        rewardedPlayerIds.push(playerId);
      }
      continue;
    }

    const settled = await settleBossRewardClaim({
      combatId,
      playerId,
      opponentId: params.monster.id,
      buildSnapshot: async (tx) => {
        const staminaConsumeResult = await consumePlayerStaminaForRewardTx(tx, playerId, STAMINA_REWARD_COST);
        if (!staminaConsumeResult.consumed) {
          return {
            playerId,
            playerName: currentPlayer.name || "无名",
            xp: 0,
            gold: 0,
            isLastHit,
            rewarded: false,
            noRewardReason: "stamina_empty",
          };
        }

        const playerRow = await tx.select({
          cultivationXp: players.cultivationXp,
          gold: players.gold,
        }).from(players).where(eq(players.id, playerId)).get();
        if (!playerRow) {
          return {
            playerId,
            playerName: currentPlayer.name || "无名",
            xp: 0,
            gold: 0,
            isLastHit,
            rewarded: false,
          };
        }

        await tx.update(players).set({
          cultivationXp: Number(playerRow.cultivationXp || 0) + finalXp,
          gold: Number(playerRow.gold || 0) + finalGold,
          updatedAt: new Date().toISOString(),
        }).where(eq(players.id, playerId)).run();

        const droppedItems: NonNullable<BossRewardEntry["drops"]> = [];
        if (isLastHit) {
          for (const drop of drops) {
            if (Math.random() >= drop.chance) {
              continue;
            }

            const quantity = drop.minQuantity + Math.floor(Math.random() * (drop.maxQuantity - drop.minQuantity + 1));
            await upsertBossRewardInventoryItemTx({
              tx,
              playerId,
              itemId: drop.itemId,
              quantity,
            });
            const item = await tx.select({
              name: items.name,
              iconUrl: items.iconUrl,
              rarity: items.rarity,
            }).from(items).where(eq(items.id, drop.itemId)).get();

            droppedItems.push({
              itemId: drop.itemId,
              itemName: item?.name || drop.itemId,
              itemIconUrl: item?.iconUrl || null,
              quantity,
              itemRarity: item?.rarity || null,
            });
          }
        }

        return {
          playerId,
          playerName: currentPlayer.name || "无名",
          xp: finalXp,
          gold: finalGold,
          isLastHit,
          rewarded: true,
          staminaCost: STAMINA_REWARD_COST,
          staminaAfter: staminaConsumeResult.stamina,
          ...(droppedItems.length > 0 ? { drops: droppedItems } : {}),
        };
      },
    });

    rewards.push(settled.reward);
    if (!settled.replayed && settled.reward.rewarded !== false && !settled.reward.noRewardReason) {
      rewardedPlayerIds.push(playerId);
    }
  }

  return {
    rewards,
    rewardedPlayerIds,
  };
}

export async function settleBossDefeatRewardsAndSideEffects(params: {
  monster: BossRewardMonsterSource;
  instanceId: number | string;
  participantPlayerIds: string[];
  lastHitPlayerId: string;
  lastHitPlayerName?: string | null;
}) {
  const combatId = toBossRewardCombatId(params.instanceId);
  const secretRealmContext = await getSecretRealmContextByMonsterId(params.monster.id);
  const distributeResult = await distributeBossRewards({
    monster: params.monster,
    instanceId: params.instanceId,
    participantPlayerIds: params.participantPlayerIds,
    lastHitPlayerId: params.lastHitPlayerId,
  });
  let rewards = distributeResult.rewards;

  if (secretRealmContext) {
    const secretRealmSettleResult = await handleSecretRealmBossDefeated({
      bossMonsterId: params.monster.id,
      lastHitPlayerId: params.lastHitPlayerId,
      participantPlayerIds: params.participantPlayerIds,
    });
    if (secretRealmSettleResult?.consolationRewardsByPlayerId && rewards) {
      rewards = await applySecretRealmConsolationRewards({
        combatId,
        monsterId: params.monster.id,
        rewards,
        consolationRewardsByPlayerId: secretRealmSettleResult.consolationRewardsByPlayerId,
      });
    }
  }

  await runBossKillSideEffects({
    combatId,
    monster: params.monster,
    rewardedPlayerIds: rewards.filter((entry) => entry.rewarded !== false && !entry.noRewardReason).map((entry) => entry.playerId),
    lastHitPlayerId: params.lastHitPlayerId,
    lastHitPlayerName: params.lastHitPlayerName,
    secretRealm: Boolean(secretRealmContext),
  });

  return {
    rewards,
    secretRealm: Boolean(secretRealmContext),
  };
}
