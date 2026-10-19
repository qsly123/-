import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, skills } from "@/db/schema";
import { getPlayerActiveSkillEntries } from "@/modules/character/services/player-active-skills";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getPlayerCosmeticProfileById } from "@/modules/character/services/player-cosmetic-profile";
import {
  buildPlayerStatsSnapshot,
  buildPlayerStatsSnapshotWithEquipment,
} from "@/modules/character/services/player-stats";
import { mapSpiritualRootPercent } from "@/modules/character/services/framework";
import { calculateHealAmount } from "@/modules/combat/services/combat-mechanics";
import { getCombatDamageCalculator } from "@/modules/combat/services/damage-formula";
import {
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import {
  buildBattleActionTimeline,
  createBattleSpatialRuntimeSnapshot,
} from "@/modules/combat/services/battle-spatial-runtime";
import {
  createPartyEncounter,
  getPartyEncounterById,
  updatePartyEncounter,
} from "@/modules/social/infrastructure/party-service";
import { getRuntimeMonsterById } from "@/modules/map/services/runtime-monster-store";
import { resolveSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import {
  readPersistedRuntimeValue,
  writePersistedRuntimeValue,
} from "@/modules/shared/services/runtime-persisted-store";
import type {
  CombatLogEntry,
  CombatSkillVisualEffect,
  CombatState,
  CombatTurnState,
  CombatUnit,
  SkillEffect,
  SkillSourceType,
} from "@/types/game";
import { calculateCombatDamageOutcome } from "@/modules/combat/services/combat-mechanics";
import { applyShieldMitigation, normalizeShieldRatioForDisplay } from "@/modules/combat/services/combat-mechanics";
import { STATUS_NAMES } from "@/modules/shared/constants";
import {
  pickSharedEnemySkillId,
  pickTimedAutoActionSkillId,
  type CombatAiSkillSnapshot,
} from "@/modules/combat/services/combat-ai";
import {
  BASIC_MONSTER_SKILL_ID,
  createBuiltinMonsterBasicAttackSkill,
  ensureCombatSkillIdsWithBasicAttack,
  normalizeCombatSkillCooldown,
  normalizeMonsterCombatSkillIds,
} from "@/modules/combat/services/monster-skill-utils";
import { resolveCombatRealmByMapId } from "@/modules/combat/services/combat-realm-utils";

const TURN_DURATION_MS = 12_000;
const PARTY_COMBAT_STATE_TTL_MS = 10 * 60 * 1000;
const PARTY_COMBAT_RUNTIME_NAMESPACE = "party-combat-route-state";

type PartyCombatRouteState = {
  encounterLocks: Set<string>;
  acceptedSequences: Map<string, { value: number; updatedAtMs: number }>;
  sceneSubscribers: Map<string, Set<PartyCombatSceneSubscriber>>;
};

type PartyCombatRouteGlobal = typeof globalThis & {
  __partyCombatRouteState?: PartyCombatRouteState;
};

export type PartyCombatSceneEvent = {
  encounterId: string;
  state: CombatState;
  turnState: CombatTurnState;
  sceneSnapshot: BattleSceneSnapshot | null;
};

type PartyCombatSceneSubscriber = (event: PartyCombatSceneEvent) => void;

type SkillSnapshot = CombatAiSkillSnapshot & {
  id: string;
  skillType: string;
  sourceType?: SkillSourceType;
  damageBase: number;
  damageMultiplier: number;
  cooldown: number;
  effects: SkillEffect[];
  target: string;
  visualEffect?: CombatSkillVisualEffect | null;
};

type PartyEncounterRecord = Awaited<ReturnType<typeof getPartyEncounterById>>;

function createDeadlineIso() {
  return new Date(Date.now() + TURN_DURATION_MS).toISOString();
}

function getPartyCombatRouteState() {
  const globalStore = globalThis as PartyCombatRouteGlobal;
  if (!globalStore.__partyCombatRouteState) {
    globalStore.__partyCombatRouteState = {
      encounterLocks: new Set<string>(),
      acceptedSequences: new Map<string, { value: number; updatedAtMs: number }>(),
      sceneSubscribers: new Map<string, Set<PartyCombatSceneSubscriber>>(),
    };
  }
  globalStore.__partyCombatRouteState.sceneSubscribers = ensureGlobalMap<string, Set<PartyCombatSceneSubscriber>>(
    globalStore.__partyCombatRouteState,
    "sceneSubscribers",
  );
  return globalStore.__partyCombatRouteState;
}

function getPartySequenceKey(encounterId: string, playerId: string) {
  return `${encounterId}:${playerId}`;
}

function publishPartyCombatSceneEvent(event: PartyCombatSceneEvent) {
  const subscribers = getPartyCombatRouteState().sceneSubscribers.get(event.encounterId);
  if (!subscribers) {
    return;
  }
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch (error) {
      console.error("Party combat scene subscriber error:", error);
    }
  }
}

function pruneExpiredAcceptedSequences(state: PartyCombatRouteState, nowMs: number) {
  for (const [key, value] of state.acceptedSequences.entries()) {
    if (nowMs - value.updatedAtMs > PARTY_COMBAT_STATE_TTL_MS) {
      state.acceptedSequences.delete(key);
    }
  }
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function getStatusName(type: string) {
  return STATUS_NAMES[type] || type;
}

function toSkillSnapshot(
  skill: typeof skills.$inferSelect & { sourceType?: SkillSourceType },
): SkillSnapshot {
  const normalized = resolveSkillEffectsPayload(skill.effects, skill);
  return {
    id: skill.id,
    name: skill.name,
    skillType: skill.skillType,
    sourceType: skill.sourceType,
    damageBase: skill.damageBase,
    damageMultiplier: skill.damageMultiplier,
    mpCost: skill.mpCost,
    cooldown: normalizeCombatSkillCooldown(skill.id, skill.cooldown),
    effects: normalized.effects,
    target: skill.target,
    visualEffect: normalized.visualEffect,
  };
}

function buildTurnState(state: CombatState, previous?: CombatTurnState | null): CombatTurnState {
  const aliveIds = (state.participants || [])
    .filter((unit) => unit.hp > 0)
    .map((unit) => unit.id);
  const previousOrder = previous?.turnOrder || [];
  const nextOrder = previousOrder.filter((playerId) => aliveIds.includes(playerId));
  for (const playerId of aliveIds) {
    if (!nextOrder.includes(playerId)) {
      nextOrder.push(playerId);
    }
  }

  if (!nextOrder.length) {
    return {
      turnOrder: [],
      currentTurnPlayerId: null,
      turnIndex: 0,
      turnDeadlineAt: null,
      eligibleMemberIds: state.eligibleMemberIds || [],
    };
  }

  let nextTurnIndex = Number(previous?.turnIndex || 0);
  let currentTurnPlayerId = previous?.currentTurnPlayerId || nextOrder[0];
  if (!currentTurnPlayerId || !nextOrder.includes(currentTurnPlayerId)) {
    nextTurnIndex = nextTurnIndex % nextOrder.length;
    currentTurnPlayerId = nextOrder[nextTurnIndex] || nextOrder[0];
  }

  return {
    turnOrder: nextOrder,
    currentTurnPlayerId,
    turnIndex: nextTurnIndex,
    turnDeadlineAt: previous?.turnDeadlineAt || createDeadlineIso(),
    eligibleMemberIds: state.eligibleMemberIds || [],
  };
}

function advanceTurnState(state: CombatState, turnState: CombatTurnState): CombatTurnState {
  const aliveIds = (state.participants || [])
    .filter((unit) => unit.hp > 0)
    .map((unit) => unit.id);
  if (!aliveIds.length) {
    return {
      turnOrder: [],
      currentTurnPlayerId: null,
      turnIndex: 0,
      turnDeadlineAt: null,
      eligibleMemberIds: turnState.eligibleMemberIds || state.eligibleMemberIds || [],
    };
  }

  const turnOrder = turnState.turnOrder.filter((playerId) => aliveIds.includes(playerId));
  for (const playerId of aliveIds) {
    if (!turnOrder.includes(playerId)) {
      turnOrder.push(playerId);
    }
  }

  const nextTurnIndex = turnOrder.length > 0
    ? (turnState.turnIndex + 1) % turnOrder.length
    : 0;

  return {
    turnOrder,
    currentTurnPlayerId: turnOrder[nextTurnIndex] || null,
    turnIndex: nextTurnIndex,
    turnDeadlineAt: turnOrder.length > 0 ? createDeadlineIso() : null,
    eligibleMemberIds: turnState.eligibleMemberIds || state.eligibleMemberIds || [],
  };
}

function syncTurnStateToState(state: CombatState, turnState: CombatTurnState) {
  state.mode = "party";
  state.turnOrder = turnState.turnOrder;
  state.currentTurnPlayerId = turnState.currentTurnPlayerId;
  state.turnIndex = turnState.turnIndex;
  state.turnDeadlineAt = turnState.turnDeadlineAt;
  state.eligibleMemberIds = turnState.eligibleMemberIds || state.eligibleMemberIds;
}

function buildTimeline(
  state: CombatState,
  entries: CombatLogEntry[],
  startedAtMs: number,
) {
  return buildBattleActionTimeline({
    runtimeId: state.id,
    turn: state.turn,
    entries,
    startedAtMs,
    windupMs: 70,
    activeMs: 160,
    recoverMs: 180,
    actorAdvancePercent: 0,
    itemAdvancePercent: 0,
    targetRecoilPercent: 0,
    spacingMs: 20,
  });
}

function createPartySceneSnapshot(params: {
  state: CombatState;
  previousSnapshot?: BattleSceneSnapshot | null;
  timelineEntries?: CombatLogEntry[];
}) {
  return createBattleSpatialRuntimeSnapshot({
    mode: "combat",
    battleMode: "party",
    units: [
      {
        id: params.state.enemy.id,
        role: "enemy",
      },
      ...((params.state.participants || []).map((unit, index) => ({
        id: unit.id,
        role: "player" as const,
        slot: index,
        isCurrent: unit.id === params.state.currentTurnPlayerId,
      }))),
    ],
    sequence: (params.previousSnapshot?.sequence || 0) + 1,
    tick: (params.previousSnapshot?.tick || 0) + 1,
    serverTimeMs: Date.now(),
    previousSnapshot: params.previousSnapshot || undefined,
    timeline: buildTimeline(params.state, params.timelineEntries || [], Date.now()),
  });
}

async function loadPlayerStats(player: typeof players.$inferSelect) {
  try {
    return await buildPlayerStatsSnapshot(player);
  } catch {
    return buildPlayerStatsSnapshotWithEquipment(
      player,
      null,
      null,
      null,
      mapSpiritualRootPercent(player.spiritualRoot),
    );
  }
}

async function buildParticipantUnit(playerId: string): Promise<CombatUnit | null> {
  const row = await getPlayerByIdCompat(playerId);
  if (!row) {
    return null;
  }

  const [stats, cosmetics, skillRows] = await Promise.all([
    loadPlayerStats(row),
    getPlayerCosmeticProfileById(playerId),
    getPlayerActiveSkillEntries({ playerId, realm: row.realm }).catch(() => []),
  ]);

  const skillIds = ensureCombatSkillIdsWithBasicAttack(
    skillRows.length > 0 ? skillRows.map((skill) => skill.id) : ["skill_basic_attack"],
  );
  return {
    id: row.id,
    name: row.name || "无名修士",
    isPlayer: true,
    realm: row.realm,
    avatarImageUrl: cosmetics.avatarImageUrl,
    avatarFrameImageUrl: cosmetics.avatarFrameImageUrl,
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

async function buildEnemyUnit(monsterId: string): Promise<CombatUnit | null> {
  const monster = await getRuntimeMonsterById(monsterId);
  if (!monster) {
    return null;
  }
  const enemyRealm = await resolveCombatRealmByMapId(monster.mapId);

  return {
    id: monster.id,
    name: monster.name,
    isPlayer: false,
    realm: enemyRealm,
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

async function loadPlayerSkillSnapshotMap(unit: CombatUnit) {
  const playerRow = await db.select({
    id: players.id,
    realm: players.realm,
  }).from(players).where(eq(players.id, unit.id)).get();
  if (!playerRow) {
    return {} as Record<string, SkillSnapshot>;
  }

  const learnedSkills = await getPlayerActiveSkillEntries({
    playerId: unit.id,
    realm: playerRow.realm,
  }).catch(() => []);
  const map: Record<string, SkillSnapshot> = {};
  for (const skill of learnedSkills) {
    map[skill.id] = toSkillSnapshot(skill);
  }

  const missingIds = unit.skills.filter((skillId) => !map[skillId]);
  if (missingIds.length > 0) {
    const missingRows = await db.select().from(skills)
      .where(inArray(skills.id, missingIds))
      .all();
    for (const skill of missingRows) {
      map[skill.id] = toSkillSnapshot(skill);
    }
  }

  return map;
}

async function loadEnemySkillSnapshotMap(unit: CombatUnit) {
  const rows = await db.select().from(skills)
    .where(inArray(skills.id, unit.skills.length > 0 ? unit.skills : ["skill_basic_attack"]))
    .all();
  const map = Object.fromEntries(rows.map((skill) => [skill.id, toSkillSnapshot({
    ...skill,
    sourceType: "monster",
  })])) as Record<string, SkillSnapshot>;
  if (!map[BASIC_MONSTER_SKILL_ID]) {
    map[BASIC_MONSTER_SKILL_ID] = toSkillSnapshot(createBuiltinMonsterBasicAttackSkill());
  }
  return map;
}

function pushLog(log: CombatLogEntry[], entry: CombatLogEntry) {
  log.push(entry);
}

function applySkillEffects(params: {
  effects: SkillEffect[];
  actor: CombatUnit;
  targets: CombatUnit[];
  skillId: string;
  turn: number;
  log: CombatLogEntry[];
}) {
  for (const target of params.targets) {
    for (const effect of params.effects) {
      if (Math.random() > effect.chance) {
        continue;
      }
      const nextEffect = {
        type: effect.type,
        value: effect.value,
        remainingTurns: effect.duration,
        sourceSkillId: params.skillId,
      };
      const existingIndex = target.activeEffects.findIndex((item) => item.type === effect.type);
      if (existingIndex >= 0) {
        target.activeEffects[existingIndex] = nextEffect;
      } else {
        target.activeEffects.push(nextEffect);
      }
      const effectName = getStatusName(effect.type);
      pushLog(params.log, {
        turn: params.turn,
        actorName: params.actor.name,
        action: `施加${effectName}`,
        entryType: "status",
        actorId: params.actor.id,
        targetId: target.id,
        skillId: params.skillId,
        effects: [effectName],
        targetCurrentHp: target.hp,
        targetCurrentMp: target.mp,
        message: `${params.actor.name} 对 ${target.name} 施加了${effectName}，持续 ${effect.duration} 回合。`,
      });
    }
  }
}

function processEffects(unit: CombatUnit, log: CombatLogEntry[], turn: number) {
  for (const effect of unit.activeEffects) {
    switch (effect.type) {
      case "poison":
      case "burn": {
        const result = applyShieldMitigation(unit, effect.value);
        pushLog(log, {
          turn,
          actorName: unit.name,
          action: getStatusName(effect.type),
          entryType: "status",
          actorId: unit.id,
          targetId: unit.id,
          damage: result.totalDamage,
          actorCurrentHp: unit.hp,
          actorCurrentMp: unit.mp,
          targetCurrentHp: unit.hp,
          targetCurrentMp: unit.mp,
          message: `${unit.name} 受到${getStatusName(effect.type)}伤害 ${result.totalDamage}。`,
        });
        break;
      }
      case "regen": {
        const healValue = Math.max(0, Math.floor(Number(effect.value) || 0));
        if (healValue > 0) {
          unit.hp = Math.min(unit.maxHp, unit.hp + healValue);
          pushLog(log, {
            turn,
            actorName: unit.name,
            action: "回春",
            entryType: "status",
            actorId: unit.id,
            targetId: unit.id,
            heal: healValue,
            actorCurrentHp: unit.hp,
            targetCurrentHp: unit.hp,
            message: `${unit.name} 恢复了 ${healValue} 点气血。`,
          });
        }
        break;
      }
      case "freeze":
      case "stun":
        unit.isStunned = true;
        break;
      default:
        break;
    }

    effect.remainingTurns -= 1;
  }

  unit.activeEffects = unit.activeEffects.filter((effect) => effect.remainingTurns > 0);
  unit.isStunned = unit.activeEffects.some((effect) => effect.type === "freeze" || effect.type === "stun");
}

function tickCooldowns(unit: CombatUnit) {
  const nextCooldowns: Record<string, number> = {};
  for (const [skillId, turns] of Object.entries(unit.skillCooldowns || {})) {
    const nextTurns = Number(turns || 0) - 1;
    if (nextTurns > 0) {
      nextCooldowns[skillId] = nextTurns;
    }
  }
  unit.skillCooldowns = nextCooldowns;
}

function getPrimaryTarget(state: CombatState, preferredPlayerId?: string | null) {
  const aliveParticipants = (state.participants || []).filter((unit) => unit.hp > 0);
  if (!aliveParticipants.length) {
    return null;
  }
  if (preferredPlayerId) {
    const preferred = aliveParticipants.find((unit) => unit.id === preferredPlayerId);
    if (preferred) {
      return preferred;
    }
  }
  return aliveParticipants[0];
}

function applyItemAction(params: {
  actor: CombatUnit;
  turn: number;
  itemName: string;
  effects: Array<{ type: string; value: number }>;
  log: CombatLogEntry[];
}) {
  const hpBefore = params.actor.hp;
  const mpBefore = params.actor.mp;
  for (const effect of params.effects) {
    if (effect.type === "heal_hp") {
      params.actor.hp = Math.min(params.actor.maxHp, params.actor.hp + Math.max(0, effect.value));
    }
    if (effect.type === "heal_mp") {
      params.actor.mp = Math.min(params.actor.maxMp, params.actor.mp + Math.max(0, effect.value));
    }
  }
  pushLog(params.log, {
    turn: params.turn,
    actorName: params.actor.name,
    action: params.itemName,
    entryType: "item",
    actorId: params.actor.id,
    targetId: params.actor.id,
    heal: Math.max(0, (params.actor.hp - hpBefore) + (params.actor.mp - mpBefore)),
    actorCurrentHp: params.actor.hp,
    actorCurrentMp: params.actor.mp,
    targetCurrentHp: params.actor.hp,
    targetCurrentMp: params.actor.mp,
    message: `${params.actor.name} 使用了${params.itemName}。`,
  });
}

async function applySkillAction(params: {
  state: CombatState;
  actor: CombatUnit;
  actorIsPlayer: boolean;
  skillId: string;
  skill: SkillSnapshot;
  log: CombatLogEntry[];
  turn: number;
  preferredTargetPlayerId?: string | null;
}) {
  const damageCalculator = await getCombatDamageCalculator();
  const skillId = params.skillId;
  const skill = params.skill;
  const actor = params.actor;
  if ((actor.skillCooldowns?.[skillId] || 0) > 0) {
    pushLog(params.log, {
      turn: params.turn,
      actorName: actor.name,
      action: "技能冷却",
      entryType: "system",
      actorId: actor.id,
      skillId,
      skillName: skill.name,
      message: `${skill.name} 仍在冷却中。`,
    });
    return;
  }
  if (actor.mp < skill.mpCost) {
    pushLog(params.log, {
      turn: params.turn,
      actorName: actor.name,
      action: "灵力不足",
      entryType: "system",
      actorId: actor.id,
      skillId,
      skillName: skill.name,
      message: `${actor.name} 灵力不足，无法施展 ${skill.name}。`,
    });
    return;
  }

  actor.mp -= skill.mpCost;

  if (skill.skillType === "heal") {
    const healTargets = skill.target === "all_allies"
      ? (params.actorIsPlayer ? (params.state.participants || []).filter((unit) => unit.hp > 0) : [params.state.enemy])
      : [actor];
    const healAmount = calculateHealAmount(actor, skill.sourceType);
    for (const target of healTargets) {
      const beforeHp = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healAmount);
      pushLog(params.log, {
        turn: params.turn,
        actorName: actor.name,
        action: skill.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: target.id,
        skillId,
        skillName: skill.name,
        heal: target.hp - beforeHp,
        visualEffect: skill.visualEffect || null,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: target.hp,
        targetCurrentMp: target.mp,
        message: `${actor.name} 施展 ${skill.name}，为 ${target.name} 恢复 ${target.hp - beforeHp} 点气血。`,
      });
    }
  } else if (skill.skillType === "shield") {
    const shieldEffect = skill.effects.find((effect) => effect.type === "shield");
    const target = actor;
    pushLog(params.log, {
      turn: params.turn,
      actorName: actor.name,
      action: skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: target.id,
      skillId,
      skillName: skill.name,
      visualEffect: skill.visualEffect || null,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: target.hp,
      targetCurrentMp: target.mp,
      message: `${actor.name} 施展 ${skill.name}，开启 ${normalizeShieldRatioForDisplay(Number(shieldEffect?.value || 0))}% 护盾。`,
    });
    applySkillEffects({
      effects: skill.effects,
      actor,
      targets: [target],
      skillId,
      turn: params.turn,
      log: params.log,
    });
  } else {
    const targets = params.actorIsPlayer
      ? [params.state.enemy]
      : skill.target === "all_enemies"
        ? (params.state.participants || []).filter((unit) => unit.hp > 0)
        : [getPrimaryTarget(params.state, params.preferredTargetPlayerId)].filter((unit): unit is CombatUnit => Boolean(unit));

    for (const target of targets) {
      const result = calculateCombatDamageOutcome({
        attacker: actor,
        defender: target,
        damageBase: skill.damageBase,
        damageMultiplier: skill.damageMultiplier,
        damageCalculator,
        sourceType: skill.sourceType,
      });
      pushLog(params.log, {
        turn: params.turn,
        actorName: actor.name,
        action: skill.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: target.id,
        skillId,
        skillName: skill.name,
        damage: result.totalDamage,
        visualEffect: skill.visualEffect || null,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: target.hp,
        targetCurrentMp: target.mp,
        message: `${actor.name} 施展 ${skill.name}，对 ${target.name} 造成 ${result.totalDamage} 点伤害。`,
      });
    }

    if (skill.effects.length > 0) {
      applySkillEffects({
        effects: skill.effects,
        actor,
        targets,
        skillId,
        turn: params.turn,
        log: params.log,
      });
    }
  }

  const normalizedCooldown = normalizeCombatSkillCooldown(skillId, skill.cooldown);
  if (normalizedCooldown > 0) {
    actor.skillCooldowns[skillId] = normalizedCooldown + 1;
  }
}

function markBattleResult(state: CombatState) {
  const aliveParticipants = (state.participants || []).filter((unit) => unit.hp > 0);
  if (state.enemy.hp <= 0) {
    state.status = "player_win";
    return;
  }
  if (!aliveParticipants.length) {
    state.status = "enemy_win";
    return;
  }
  state.status = "ongoing";
}

function readEncounterState(encounter: NonNullable<PartyEncounterRecord>) {
  const rawState = encounter.stateJson;
  const rawTurnState = encounter.turnStateJson;
  const rawSceneSnapshot = encounter.sceneSnapshotJson;
  if (!rawState || typeof rawState !== "object") {
    return null;
  }
  const state = cloneState(rawState as unknown as CombatState);
  const turnState = buildTurnState(
    state,
    rawTurnState && typeof rawTurnState === "object"
      ? cloneState(rawTurnState as unknown as CombatTurnState)
      : null,
  );
  if (state.status !== "ongoing") {
    turnState.currentTurnPlayerId = null;
    turnState.turnDeadlineAt = null;
  }
  syncTurnStateToState(state, turnState);

  return {
    state,
    turnState,
    sceneSnapshot: rawSceneSnapshot && typeof rawSceneSnapshot === "object"
      ? cloneState(rawSceneSnapshot as BattleSceneSnapshot)
      : null,
  };
}

export async function getPartyCombatRuntime(
  encounterId: string,
  options?: {
    includeResolved?: boolean;
  },
) {
  const encounter = await getPartyEncounterById(encounterId);
  if (!encounter) {
    return null;
  }
  if (!options?.includeResolved && encounter.status !== "ongoing") {
    return null;
  }
  const parsed = readEncounterState(encounter);
  if (!parsed) {
    return null;
  }
  return {
    encounter,
    ...parsed,
  };
}

export async function getPartyCombatEncounterRuntime(params: {
  encounterId: string;
  allowStatuses?: Array<"ongoing" | "resolved" | "abandoned">;
}) {
  const encounter = await getPartyEncounterById(params.encounterId);
  if (!encounter) {
    return null;
  }

  const allowStatuses = params.allowStatuses || ["ongoing"];
  if (!allowStatuses.includes(encounter.status as "ongoing" | "resolved" | "abandoned")) {
    return null;
  }

  const parsed = readEncounterState(encounter);
  if (!parsed) {
    return null;
  }

  return {
    encounter,
    ...parsed,
  };
}

export function isPartyCombatParticipant(params: {
  state: CombatState;
  playerId: string;
}) {
  return Boolean(
    params.state.eligibleMemberIds?.includes(params.playerId)
    || params.state.participants?.some((unit) => unit.id === params.playerId),
  );
}

export function tryAcquirePartyCombatEncounterLock(encounterId: string) {
  const state = getPartyCombatRouteState();
  if (state.encounterLocks.has(encounterId)) {
    return false;
  }
  state.encounterLocks.add(encounterId);
  return true;
}

export function releasePartyCombatEncounterLock(encounterId: string) {
  getPartyCombatRouteState().encounterLocks.delete(encounterId);
}

export function getLastAcceptedPartyCombatClientSequence(encounterId: string, playerId: string) {
  const state = getPartyCombatRouteState();
  pruneExpiredAcceptedSequences(state, Date.now());
  const sequenceKey = getPartySequenceKey(encounterId, playerId);
  const current = state.acceptedSequences.get(sequenceKey);
  if (current) {
    return current.value;
  }
  const persisted = readPersistedRuntimeValue<{ value: number; updatedAtMs: number }>(
    PARTY_COMBAT_RUNTIME_NAMESPACE,
    `seq:${sequenceKey}`,
  );
  if (persisted) {
    state.acceptedSequences.set(sequenceKey, persisted);
    return persisted.value;
  }
  return 0;
}

export function acceptPartyCombatClientSequence(encounterId: string, playerId: string, clientSequence: number) {
  const state = getPartyCombatRouteState();
  pruneExpiredAcceptedSequences(state, Date.now());
  const sequenceKey = getPartySequenceKey(encounterId, playerId);
  const value = {
    value: clientSequence,
    updatedAtMs: Date.now(),
  };
  state.acceptedSequences.set(sequenceKey, value);
  writePersistedRuntimeValue(PARTY_COMBAT_RUNTIME_NAMESPACE, `seq:${sequenceKey}`, value, {
    ttlMs: PARTY_COMBAT_STATE_TTL_MS,
  });
}

export function subscribePartyCombatSceneEvents(
  encounterId: string,
  subscriber: PartyCombatSceneSubscriber,
) {
  const state = getPartyCombatRouteState();
  const subscribers = state.sceneSubscribers.get(encounterId) || new Set<PartyCombatSceneSubscriber>();
  subscribers.add(subscriber);
  state.sceneSubscribers.set(encounterId, subscribers);
  return () => {
    const current = state.sceneSubscribers.get(encounterId);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (current.size === 0) {
      state.sceneSubscribers.delete(encounterId);
    }
  };
}

export async function createNormalPartyCombat(params: {
  encounterId?: string;
  partyId: string;
  monsterId: string;
  eligibleMemberIds: string[];
}) {
  const participants = (await Promise.all(
    params.eligibleMemberIds.map((playerId) => buildParticipantUnit(playerId)),
  )).filter((unit): unit is CombatUnit => Boolean(unit));
  const enemy = await buildEnemyUnit(params.monsterId);
  if (!participants.length || !enemy) {
    return null;
  }

  const state: CombatState = {
    id: params.encounterId || crypto.randomUUID(),
    turn: 0,
    player: participants[0],
    enemy,
    mode: "party",
    participants,
    eligibleMemberIds: participants.map((unit) => unit.id),
    settledPlayerIds: [],
    log: [{
      turn: 0,
      actorName: "系统",
      action: "战斗开始",
      entryType: "system",
      targetId: enemy.id,
      message: `${enemy.name} 挡住去路，队伍战斗开始。`,
    }],
    status: "ongoing",
  };

  const turnState = buildTurnState(state, null);
  syncTurnStateToState(state, turnState);
  const sceneSnapshot = createPartySceneSnapshot({ state, previousSnapshot: null, timelineEntries: [] });

  const encounter = await createPartyEncounter({
    partyId: params.partyId,
    encounterType: "normal",
    monsterId: params.monsterId,
    state,
    turnState,
    sceneSnapshot: sceneSnapshot as unknown as Record<string, unknown>,
    eligibleMemberIds: participants.map((unit) => unit.id),
  });
  if (encounter) {
    publishPartyCombatSceneEvent({
      encounterId: encounter.id,
      state,
      turnState,
      sceneSnapshot,
    });
  }
  return encounter;
}

export function buildPartyCombatViewState(state: CombatState, viewerPlayerId: string) {
  const nextState = cloneState(state);
  const viewer = nextState.participants?.find((unit) => unit.id === viewerPlayerId);
  if (viewer) {
    nextState.player = viewer;
  }
  return nextState;
}

export async function syncPartyCombatEncounter(params: {
  encounterId: string;
  state: CombatState;
  turnState: CombatTurnState;
  previousSnapshot?: BattleSceneSnapshot | null;
  timelineEntries?: CombatLogEntry[];
  status?: "ongoing" | "resolved" | "abandoned";
}) {
  syncTurnStateToState(params.state, params.turnState);
  const sceneSnapshot = createPartySceneSnapshot({
    state: params.state,
    previousSnapshot: params.previousSnapshot || null,
    timelineEntries: params.timelineEntries || [],
  });
  const nextView = await updatePartyEncounter({
    encounterId: params.encounterId,
    state: params.state,
    turnState: params.turnState,
    sceneSnapshot: sceneSnapshot as unknown as Record<string, unknown>,
    status: params.status,
  });
  publishPartyCombatSceneEvent({
    encounterId: params.encounterId,
    state: cloneState(params.state),
    turnState: cloneState(params.turnState),
    sceneSnapshot,
  });
  return {
    encounterView: nextView,
    sceneSnapshot,
  };
}

export async function performPartyCombatAction(params: {
  encounterId: string;
  actorPlayerId: string;
  actionType: "skill" | "item";
  skillId?: string;
  itemName?: string;
  itemEffects?: Array<{ type: string; value: number }>;
}) {
  const runtime = await getPartyCombatRuntime(params.encounterId);
  if (!runtime) {
    return { success: false as const, error: "组队战斗不存在或已结束" };
  }

  const state = cloneState(runtime.state);
  const turnState = cloneState(runtime.turnState);
  syncTurnStateToState(state, turnState);

  if (state.status !== "ongoing") {
    return { success: false as const, error: "战斗已结束" };
  }
  if (turnState.currentTurnPlayerId !== params.actorPlayerId) {
    return { success: false as const, error: "当前还未轮到你出手" };
  }

  const actor = (state.participants || []).find((unit) => unit.id === params.actorPlayerId);
  if (!actor || actor.hp <= 0) {
    return { success: false as const, error: "当前角色无法行动" };
  }

  state.turn += 1;
  const logStartIndex = state.log.length;
  processEffects(actor, state.log, state.turn);
  processEffects(state.enemy, state.log, state.turn);
  markBattleResult(state);

  if (state.status === "ongoing") {
    if (actor.isStunned) {
      actor.isStunned = false;
      pushLog(state.log, {
        turn: state.turn,
        actorName: actor.name,
        action: "行动受阻",
        entryType: "status",
        actorId: actor.id,
        targetId: actor.id,
        message: `${actor.name} 被控制，未能出手。`,
      });
    } else if (params.actionType === "item") {
      applyItemAction({
        actor,
        turn: state.turn,
        itemName: params.itemName || "丹药",
        effects: params.itemEffects || [],
        log: state.log,
      });
    } else {
      const skillMap = await loadPlayerSkillSnapshotMap(actor);
      const selectedSkillId = params.skillId || "skill_basic_attack";
      const selectedSkill = skillMap[selectedSkillId];
      if (!selectedSkill) {
        return { success: false as const, error: "当前技能不存在" };
      }
      await applySkillAction({
        state,
        actor,
        actorIsPlayer: true,
        skillId: selectedSkillId,
        skill: selectedSkill,
        log: state.log,
        turn: state.turn,
      });
    }

    markBattleResult(state);
  }

  if (state.status === "ongoing" && state.enemy.hp > 0) {
    const enemySkillMap = await loadEnemySkillSnapshotMap(state.enemy);
    const enemySkillId = pickSharedEnemySkillId({
      unit: state.enemy,
      skills: enemySkillMap,
      aliveEnemyCount: (state.participants || []).filter((unit) => unit.hp > 0).length,
    });
    const enemySkill = enemySkillMap[enemySkillId];
    if (state.enemy.isStunned) {
      state.enemy.isStunned = false;
      pushLog(state.log, {
        turn: state.turn,
        actorName: state.enemy.name,
        action: "行动受阻",
        entryType: "status",
        actorId: state.enemy.id,
        targetId: state.enemy.id,
        message: `${state.enemy.name} 行动受阻，未能反击。`,
      });
    } else if (enemySkill) {
      await applySkillAction({
        state,
        actor: state.enemy,
        actorIsPlayer: false,
        skillId: enemySkillId,
        skill: enemySkill,
        log: state.log,
        turn: state.turn,
        preferredTargetPlayerId: params.actorPlayerId,
      });
    }
  }

  tickCooldowns(actor);
  tickCooldowns(state.enemy);
  markBattleResult(state);

  const nextTurnState = state.status === "ongoing"
    ? advanceTurnState(state, turnState)
    : {
      ...turnState,
      currentTurnPlayerId: null,
      turnDeadlineAt: null,
    };
  syncTurnStateToState(state, nextTurnState);
  const timelineEntries = state.log.slice(logStartIndex);
  const persisted = await syncPartyCombatEncounter({
    encounterId: runtime.encounter.id,
    state,
    turnState: nextTurnState,
    previousSnapshot: runtime.sceneSnapshot,
    timelineEntries,
    status: state.status === "ongoing" ? "ongoing" : "resolved",
  });

  return {
    success: true as const,
    state,
    turnState: nextTurnState,
    sceneSnapshot: persisted.sceneSnapshot,
  };
}

export async function performPartyCombatFlee(params: {
  encounterId: string;
  actorPlayerId: string;
}) {
  const runtime = await getPartyCombatRuntime(params.encounterId);
  if (!runtime) {
    return { success: false as const, error: "组队战斗不存在或已结束" };
  }

  const state = cloneState(runtime.state);
  const turnState = cloneState(runtime.turnState);
  syncTurnStateToState(state, turnState);

  if (state.status !== "ongoing") {
    return { success: false as const, error: "战斗已结束" };
  }

  const actor = (state.participants || []).find((unit) => unit.id === params.actorPlayerId);
  if (!actor) {
    return { success: false as const, error: "你不在本次组队战名单中" };
  }

  state.turn += 1;
  state.status = "fled";
  pushLog(state.log, {
    turn: state.turn,
    actorName: "系统",
    action: "撤离战斗",
    entryType: "system",
    actorId: actor.id,
    targetId: state.enemy.id,
    message: `${actor.name} 发起撤离，队伍已脱离当前战斗。`,
  });

  const nextTurnState: CombatTurnState = {
    ...turnState,
    currentTurnPlayerId: null,
    turnDeadlineAt: null,
  };
  syncTurnStateToState(state, nextTurnState);
  const persisted = await syncPartyCombatEncounter({
    encounterId: runtime.encounter.id,
    state,
    turnState: nextTurnState,
    previousSnapshot: runtime.sceneSnapshot,
    timelineEntries: [],
    status: "abandoned",
  });

  return {
    success: true as const,
    state,
    turnState: nextTurnState,
    sceneSnapshot: persisted.sceneSnapshot,
  };
}

export async function advancePartyCombatTimeout(encounterId: string) {
  const runtime = await getPartyCombatRuntime(encounterId);
  if (!runtime) {
    return { success: false as const, error: "组队战斗不存在或已结束" };
  }
  if (runtime.state.status !== "ongoing" || !runtime.turnState.currentTurnPlayerId) {
    return { success: false as const, error: "当前战斗无需推进" };
  }
  if (runtime.turnState.turnDeadlineAt && Date.parse(runtime.turnState.turnDeadlineAt) > Date.now()) {
    return { success: false as const, error: "当前回合尚未超时" };
  }

  const actor = runtime.state.participants?.find((unit) => unit.id === runtime.turnState.currentTurnPlayerId);
  if (!actor) {
    return { success: false as const, error: "当前回合角色不存在" };
  }
  const skillMap = await loadPlayerSkillSnapshotMap(actor);
  const skillId = pickTimedAutoActionSkillId({
    unit: actor,
    skills: skillMap,
  });

  return performPartyCombatAction({
    encounterId,
    actorPlayerId: actor.id,
    actionType: "skill",
    skillId,
  });
}
