import { decideBattleMovement, getBattleRuleset as getProtocolBattleRuleset } from "@immortality/game-rules";
import { getBattleRuleset } from "@/modules/combat/services/battle-ruleset";
import {
  type BattleScenePositionOverride,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import {
  buildBattleActionTimeline,
  createBattleSpatialRuntimeSnapshot,
} from "@/modules/combat/services/battle-spatial-runtime";
import {
  calculateCombatDamageOutcome,
  calculateHealAmount,
  normalizeShieldRatioForDisplay,
} from "@/modules/combat/services/combat-mechanics";
import {
  clampCombatSceneEnemyYPercent,
  clampCombatScenePlayerYPercent,
  clampCombatSceneXPercent,
} from "@/modules/combat/services/combat-spatial";
import type { DamageCalculator } from "@/modules/combat/services/damage-formula";
import { normalizeCombatSkillCooldown } from "@/modules/combat/services/monster-skill-utils";
import type { PvpSkillSnapshot } from "@/modules/combat/services/pvp-simulator";
import {
  deletePersistedRuntimeValue,
  readPersistedRuntimeValue,
  writePersistedRuntimeValue,
} from "@/modules/shared/services/runtime-persisted-store";
import { STATUS_NAMES } from "@/modules/shared/constants";
import type {
  ActiveEffect,
  BattleRuntime,
  BattleViewState,
  CombatLogEntry,
  CombatState,
  CombatTurnState,
  CombatUnit,
  SkillEffect,
} from "@/types/game";

const PVP_RUNTIME_NAMESPACE = "pvp-runtime";
const PVP_RUNTIME_EXPIRE_MS = 30 * 60 * 1000;
const PVP_TURN_DURATION_MS = 12_000;

type PvpRuntimeGlobal = typeof globalThis & {
  __pvpRuntimeStore?: Map<string, PvpCombatRuntime>;
  __pvpRuntimeSubscribers?: Map<string, Set<PvpRuntimeSubscriber>>;
  __pvpRuntimeLocks?: Set<string>;
};

export type PvpRuntimeEvent = {
  runtimeId: string;
  type: "scene" | "settlement" | "closed";
};

type PvpRuntimeSubscriber = (event: PvpRuntimeEvent) => void;

export type PvpSettlementReason = "defeated" | "surrender" | "timeout" | "disconnect_timeout";

export type PvpSettlementSnapshot = {
  winnerPlayerId: string;
  winnerName: string;
  loserPlayerId: string;
  loserName: string;
  loserRespawn: {
    mode: string;
    mapId: string;
    positionX: number;
    positionY: number;
  };
  resultByPlayerId: Record<string, "win" | "lose">;
  reason: PvpSettlementReason;
  settledAt: string;
};

export type PvpCombatRuntime = {
  combatId: string;
  mapId: string;
  createdAt: number;
  updatedAt: number;
  challengerPlayerId: string;
  targetPlayerId: string;
  state: CombatState;
  turnState: CombatTurnState;
  skillsData: Record<string, PvpSkillSnapshot>;
  skillRotationsByPlayerId: Record<string, string[]>;
  lastAcceptedClientSequenceByPlayerId: Record<string, number>;
  sceneSnapshotsByPlayerId: Record<string, BattleSceneSnapshot | null>;
  scenePositionOverridesByViewerId: Record<string, Record<string, BattleScenePositionOverride>>;
  initialState: {
    challenger: CombatUnit;
    target: CombatUnit;
  };
  settlement: PvpSettlementSnapshot | null;
};

export type PvpViewerSceneData = {
  runtime: PvpCombatRuntime;
  state: CombatState;
  sceneSnapshot: BattleSceneSnapshot | null;
  battleView: BattleViewState;
  battleRuntime: BattleRuntime;
  turnState: CombatTurnState;
  settlement: PvpSettlementSnapshot | null;
};

type PvpActionResult =
  | {
    success: true;
    runtime: PvpCombatRuntime;
    timeline: ReturnType<typeof buildBattleActionTimeline>;
    settlementTriggered: boolean;
  }
  | {
    success: false;
    error: string;
  };

type PvpMovementResult =
  | {
    success: true;
    runtime: PvpCombatRuntime;
    actorPosition: BattleScenePositionOverride;
  }
  | {
    success: false;
    error: string;
  };

function getGlobalStore() {
  const globalStore = globalThis as PvpRuntimeGlobal;
  if (!globalStore.__pvpRuntimeStore) {
    globalStore.__pvpRuntimeStore = new Map<string, PvpCombatRuntime>();
  }
  return globalStore.__pvpRuntimeStore;
}

function getSubscriberStore() {
  const globalStore = globalThis as PvpRuntimeGlobal;
  if (!globalStore.__pvpRuntimeSubscribers) {
    globalStore.__pvpRuntimeSubscribers = new Map<string, Set<PvpRuntimeSubscriber>>();
  }
  return globalStore.__pvpRuntimeSubscribers;
}

function getLockStore() {
  const globalStore = globalThis as PvpRuntimeGlobal;
  if (!globalStore.__pvpRuntimeLocks) {
    globalStore.__pvpRuntimeLocks = new Set<string>();
  }
  return globalStore.__pvpRuntimeLocks;
}

async function withRuntimeLock<TResult>(
  combatId: string,
  handler: () => Promise<TResult>,
): Promise<
  | { success: true; value: TResult }
  | { success: false; error: string }
> {
  const lockStore = getLockStore();
  if (lockStore.has(combatId)) {
    return {
      success: false,
      error: "论道动作处理中，请稍后再试",
    };
  }

  lockStore.add(combatId);
  try {
    return {
      success: true,
      value: await handler(),
    };
  } finally {
    lockStore.delete(combatId);
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneUnit(unit: CombatUnit): CombatUnit {
  return {
    ...unit,
    skills: [...unit.skills],
    skillCooldowns: { ...(unit.skillCooldowns || {}) },
    activeEffects: (unit.activeEffects || []).map((effect) => ({ ...effect })),
  };
}

function cloneRuntime(runtime: PvpCombatRuntime) {
  return cloneValue(runtime);
}

function createInitialPvpScenePositionOverrides(params: {
  challengerPlayerId: string;
  targetPlayerId: string;
}) {
  return {
    [params.challengerPlayerId]: {
      [params.challengerPlayerId]: {
        xPercent: clampCombatSceneXPercent(50),
        yPercent: clampCombatScenePlayerYPercent(76),
      },
      [params.targetPlayerId]: {
        xPercent: clampCombatSceneXPercent(50),
        yPercent: clampCombatSceneEnemyYPercent(14),
      },
    },
    [params.targetPlayerId]: {
      [params.targetPlayerId]: {
        xPercent: clampCombatSceneXPercent(50),
        yPercent: clampCombatScenePlayerYPercent(76),
      },
      [params.challengerPlayerId]: {
        xPercent: clampCombatSceneXPercent(50),
        yPercent: clampCombatSceneEnemyYPercent(14),
      },
    },
  } satisfies Record<string, Record<string, BattleScenePositionOverride>>;
}

function ensurePvpScenePositionOverrides(runtime: PvpCombatRuntime) {
  if (
    runtime.scenePositionOverridesByViewerId?.[runtime.challengerPlayerId]?.[runtime.challengerPlayerId]
    && runtime.scenePositionOverridesByViewerId?.[runtime.targetPlayerId]?.[runtime.targetPlayerId]
  ) {
    return runtime.scenePositionOverridesByViewerId;
  }

  runtime.scenePositionOverridesByViewerId = createInitialPvpScenePositionOverrides({
    challengerPlayerId: runtime.challengerPlayerId,
    targetPlayerId: runtime.targetPlayerId,
  });
  return runtime.scenePositionOverridesByViewerId;
}

function createDeadlineIso(nowMs = Date.now()) {
  return new Date(nowMs + PVP_TURN_DURATION_MS).toISOString();
}

function pushLog(log: CombatLogEntry[], entry: CombatLogEntry) {
  log.push(entry);
}

function cloneActiveEffectsSnapshot(activeEffects?: ActiveEffect[]) {
  return (activeEffects || []).map((effect) => ({ ...effect }));
}

function withUnitSnapshots(
  entry: CombatLogEntry,
  actor?: CombatUnit | null,
  target?: CombatUnit | null,
) {
  return {
    ...entry,
    ...(actor ? { actorActiveEffects: cloneActiveEffectsSnapshot(actor.activeEffects) } : {}),
    ...(target ? { targetActiveEffects: cloneActiveEffectsSnapshot(target.activeEffects) } : {}),
  } satisfies CombatLogEntry;
}

function getStatusName(type: string) {
  return STATUS_NAMES[type] || type;
}

function isRuntimeExpired(runtime: PvpCombatRuntime | null | undefined, nowMs = Date.now()) {
  if (!runtime) {
    return true;
  }
  return (runtime.updatedAt + PVP_RUNTIME_EXPIRE_MS) <= nowMs;
}

function buildTurnState(runtime: Pick<PvpCombatRuntime, "challengerPlayerId" | "targetPlayerId">, currentTurnPlayerId?: string | null) {
  const turnOrder = [runtime.challengerPlayerId, runtime.targetPlayerId];
  const normalizedCurrentTurnPlayerId = typeof currentTurnPlayerId === "string" && turnOrder.includes(currentTurnPlayerId)
    ? currentTurnPlayerId
    : turnOrder[0];
  return {
    turnOrder,
    currentTurnPlayerId: normalizedCurrentTurnPlayerId,
    turnIndex: Math.max(0, turnOrder.indexOf(normalizedCurrentTurnPlayerId)),
    turnDeadlineAt: createDeadlineIso(),
    eligibleMemberIds: turnOrder,
  } satisfies CombatTurnState;
}

function isDamageSkill(skill?: PvpSkillSnapshot | null) {
  return Boolean(
    skill
    && (
      skill.skillType === "attack"
      || skill.skillType === "dot"
      || skill.skillType === "aoe"
      || skill.skillType === "debuff"
    ),
  );
}

function isOffensiveSkill(skill?: PvpSkillSnapshot | null) {
  return Boolean(
    skill
    && (
      isDamageSkill(skill)
      || skill.skillType === "utility"
    ),
  );
}

function canUsePvpSkill(unit: CombatUnit, skillId: string, skill?: PvpSkillSnapshot | null) {
  if (!skill) {
    return false;
  }
  const cooldownLeft = Number(unit.skillCooldowns?.[skillId] || 0);
  return cooldownLeft <= 0 && unit.mp >= Math.max(0, Number(skill.mpCost || 0));
}

function getOrderedSkillIdsForTimeout(runtime: PvpCombatRuntime, actor: CombatUnit) {
  const preferredRotation = runtime.skillRotationsByPlayerId[actor.id] || [];
  const orderedSkillIds = preferredRotation.length > 0
    ? preferredRotation.filter((skillId) => actor.skills.includes(skillId))
    : [];
  const unique = new Set<string>(orderedSkillIds);
  actor.skills.forEach((skillId) => {
    if (!unique.has(skillId)) {
      unique.add(skillId);
      orderedSkillIds.push(skillId);
    }
  });
  if (!orderedSkillIds.length) {
    orderedSkillIds.push("skill_basic_attack");
  }
  return orderedSkillIds;
}

function pickPvpTimeoutSkillId(runtime: PvpCombatRuntime, actor: CombatUnit) {
  const orderedSkillIds = getOrderedSkillIdsForTimeout(runtime, actor);
  const basicAttack = orderedSkillIds.find((skillId) => skillId === "skill_basic_attack");
  if (basicAttack && canUsePvpSkill(actor, basicAttack, runtime.skillsData[basicAttack] || null)) {
    return basicAttack;
  }

  const zeroCostDamageSkill = orderedSkillIds.find((skillId) => {
    const skill = runtime.skillsData[skillId] || null;
    return isDamageSkill(skill) && canUsePvpSkill(actor, skillId, skill) && Number(skill?.mpCost || 0) <= 0;
  });
  if (zeroCostDamageSkill) {
    return zeroCostDamageSkill;
  }

  const firstUsableDamageSkill = orderedSkillIds.find((skillId) => {
    const skill = runtime.skillsData[skillId] || null;
    return isDamageSkill(skill) && canUsePvpSkill(actor, skillId, skill);
  });
  if (firstUsableDamageSkill) {
    return firstUsableDamageSkill;
  }

  const firstUsableOffensiveSkill = orderedSkillIds.find((skillId) => {
    const skill = runtime.skillsData[skillId] || null;
    return isOffensiveSkill(skill) && canUsePvpSkill(actor, skillId, skill);
  });
  if (firstUsableOffensiveSkill) {
    return firstUsableOffensiveSkill;
  }

  return basicAttack || orderedSkillIds[0] || null;
}

function getViewerAndOpponent(runtime: PvpCombatRuntime, viewerPlayerId: string) {
  const challenger = runtime.state.player;
  const target = runtime.state.enemy;
  if (viewerPlayerId === runtime.targetPlayerId) {
    return {
      viewer: target,
      opponent: challenger,
      viewerWon: runtime.state.status === "enemy_win",
    };
  }
  return {
    viewer: challenger,
    opponent: target,
    viewerWon: runtime.state.status === "player_win",
  };
}

function buildViewerCombatState(runtime: PvpCombatRuntime, viewerPlayerId: string) {
  const { viewer, opponent } = getViewerAndOpponent(runtime, viewerPlayerId);
  return {
    ...cloneValue(runtime.state),
    player: cloneUnit(viewer),
    enemy: cloneUnit(opponent),
    participants: [cloneUnit(viewer), cloneUnit(opponent)],
  } satisfies CombatState;
}

function buildPvpRuntimeBattleViewState(runtime: PvpCombatRuntime, viewerPlayerId: string, snapshot?: BattleSceneSnapshot | null): BattleViewState {
  const { viewer, opponent, viewerWon } = getViewerAndOpponent(runtime, viewerPlayerId);
  const isViewerTurn = runtime.turnState.currentTurnPlayerId === viewer.id;
  const isOngoing = runtime.state.status === "ongoing";
  return {
    runtimeId: runtime.combatId,
    mode: "pvp",
    runtimeState: isOngoing ? "active" : "finished",
    title: "实时论道",
    subtitle: `${viewer.name} vs ${opponent.name}`,
    statusText: isOngoing
      ? (isViewerTurn ? "当前轮到你出手" : `当前轮到 ${opponent.name}`)
      : (viewerWon ? "本场论道你已取胜" : "本场论道你已落败"),
    hero: {
      id: viewer.id,
      name: viewer.name,
      role: "player",
      currentHp: viewer.hp,
      maxHp: viewer.maxHp,
      currentMp: viewer.mp,
      maxMp: viewer.maxMp,
      avatarImageUrl: viewer.avatarImageUrl,
      avatarFrameImageUrl: viewer.avatarFrameImageUrl,
      isCurrent: isViewerTurn,
    },
    target: {
      id: opponent.id,
      name: opponent.name,
      role: "enemy",
      currentHp: opponent.hp,
      maxHp: opponent.maxHp,
      currentMp: opponent.mp,
      maxMp: opponent.maxMp,
      avatarImageUrl: opponent.avatarImageUrl,
      avatarFrameImageUrl: opponent.avatarFrameImageUrl,
      isCurrent: runtime.turnState.currentTurnPlayerId === opponent.id,
    },
    participants: [
      {
        id: viewer.id,
        name: viewer.name,
        role: "player",
        slot: 0,
        currentHp: viewer.hp,
        maxHp: viewer.maxHp,
        currentMp: viewer.mp,
        maxMp: viewer.maxMp,
        avatarImageUrl: viewer.avatarImageUrl,
        avatarFrameImageUrl: viewer.avatarFrameImageUrl,
        isCurrent: isViewerTurn,
      },
      {
        id: opponent.id,
        name: opponent.name,
        role: "enemy",
        slot: 1,
        currentHp: opponent.hp,
        maxHp: opponent.maxHp,
        currentMp: opponent.mp,
        maxMp: opponent.maxMp,
        avatarImageUrl: opponent.avatarImageUrl,
        avatarFrameImageUrl: opponent.avatarFrameImageUrl,
        isCurrent: runtime.turnState.currentTurnPlayerId === opponent.id,
      },
    ],
    turnState: cloneValue(runtime.turnState),
    sceneSnapshot: snapshot || null,
    modePayload: {
      settlement: runtime.settlement,
      viewerPlayerId,
      opponentPlayerId: opponent.id,
    },
  };
}

function buildPvpBattleRuntimeFromView(params: {
  battleView: BattleViewState;
  sceneSnapshot: BattleSceneSnapshot | null;
  turnState: CombatTurnState;
  settlement: PvpSettlementSnapshot | null;
  payload?: Record<string, unknown> | null;
}): BattleRuntime {
  return {
    runtimeId: params.battleView.runtimeId,
    mode: params.battleView.mode,
    state: params.battleView.runtimeState,
    sceneVersion: params.sceneSnapshot?.sceneVersion ?? params.sceneSnapshot?.sequence ?? 0,
    tick: params.sceneSnapshot?.tick ?? 0,
    ruleset: getBattleRuleset(params.battleView.mode),
    participants: params.battleView.participants,
    battleView: params.battleView,
    turnState: params.turnState,
    sceneSnapshot: params.sceneSnapshot,
    settlement: params.settlement,
    payload: params.payload || params.battleView.modePayload || null,
  };
}

function buildViewerSceneSnapshot(
  runtime: PvpCombatRuntime,
  viewerPlayerId: string,
  timeline?: ReturnType<typeof buildBattleActionTimeline>,
) {
  const { viewer, opponent } = getViewerAndOpponent(runtime, viewerPlayerId);
  const positionOverrides = ensurePvpScenePositionOverrides(runtime)[viewerPlayerId] || {};
  const previousSnapshot = runtime.sceneSnapshotsByPlayerId[viewerPlayerId] || null;
  const nextSnapshot = createBattleSpatialRuntimeSnapshot({
    mode: "combat",
    battleMode: "pvp",
    units: [
      {
        id: viewer.id,
        name: viewer.name,
        role: "player",
        avatarImageUrl: viewer.avatarImageUrl,
        avatarFrameImageUrl: viewer.avatarFrameImageUrl,
        isCurrent: runtime.turnState.currentTurnPlayerId === viewer.id,
      },
      {
        id: opponent.id,
        name: opponent.name,
        role: "enemy",
        avatarImageUrl: opponent.avatarImageUrl,
        avatarFrameImageUrl: opponent.avatarFrameImageUrl,
        isCurrent: runtime.turnState.currentTurnPlayerId === opponent.id,
      },
    ],
    sequence: (previousSnapshot?.sequence || 0) + 1,
    tick: (previousSnapshot?.tick || 0) + 1,
    serverTimeMs: Date.now(),
    previousSnapshot,
    positionOverrides,
    timeline: timeline || [],
  });
  runtime.sceneSnapshotsByPlayerId[viewerPlayerId] = nextSnapshot;
  return nextSnapshot;
}

function getPvpOpponentPlayerId(runtime: PvpCombatRuntime, playerId: string) {
  return playerId === runtime.challengerPlayerId ? runtime.targetPlayerId : runtime.challengerPlayerId;
}

function mirrorPvpOpponentPosition(position: BattleScenePositionOverride) {
  const xPercent = typeof position.xPercent === "number" ? position.xPercent : 50;
  const yPercent = typeof position.yPercent === "number" ? position.yPercent : 76;
  return {
    xPercent: clampCombatSceneXPercent(100 - xPercent),
    yPercent: clampCombatSceneEnemyYPercent(100 - yPercent),
  } satisfies BattleScenePositionOverride;
}

function buildPvpTimelineEntries(params: {
  combatId: string;
  entries: CombatLogEntry[];
  startedAtMs: number;
}) {
  const lastTurn = params.entries[params.entries.length - 1]?.turn || 0;
  return buildBattleActionTimeline({
    runtimeId: params.combatId,
    turn: lastTurn,
    entries: params.entries,
    startedAtMs: params.startedAtMs,
    windupMs: 80,
    activeMs: 160,
    recoverMs: 220,
    actorAdvancePercent: 0,
    itemAdvancePercent: 0,
    targetRecoilPercent: 0,
    spacingMs: 0,
  });
}

function processEffects(unit: CombatUnit, log: CombatLogEntry[], turn: number) {
  const nextEffects: ActiveEffect[] = [];

  for (const effect of unit.activeEffects || []) {
    if (effect.type === "poison" || effect.type === "burn") {
      const totalDamage = Math.max(0, Math.floor(Number(effect.value || 0)));
      if (totalDamage > 0) {
        unit.hp = Math.max(0, unit.hp - totalDamage);
        pushLog(log, withUnitSnapshots({
          turn,
          actorName: unit.name,
          action: effect.type === "poison" ? "中毒" : "灼烧",
          entryType: "status",
          actorId: unit.id,
          targetId: unit.id,
          damage: totalDamage,
          actorCurrentHp: unit.hp,
          actorCurrentMp: unit.mp,
          targetCurrentHp: unit.hp,
          targetCurrentMp: unit.mp,
          message: `${unit.name} 受到${effect.type === "poison" ? "中毒" : "灼烧"}影响，损失 ${totalDamage} 点气血。`,
        }, unit, unit));
      }
    } else if (effect.type === "regen") {
      const healAmount = Math.max(0, Math.floor(Number(effect.value || 0)));
      if (healAmount > 0) {
        const beforeHp = unit.hp;
        unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
        pushLog(log, withUnitSnapshots({
          turn,
          actorName: unit.name,
          action: "恢复",
          entryType: "status",
          actorId: unit.id,
          targetId: unit.id,
          heal: unit.hp - beforeHp,
          actorCurrentHp: unit.hp,
          actorCurrentMp: unit.mp,
          targetCurrentHp: unit.hp,
          targetCurrentMp: unit.mp,
          message: `${unit.name} 恢复了 ${unit.hp - beforeHp} 点气血。`,
        }, unit, unit));
      }
    }

    const nextEffect = {
      ...effect,
      remainingTurns: effect.remainingTurns - 1,
    } satisfies ActiveEffect;
    if (nextEffect.remainingTurns > 0) {
      nextEffects.push(nextEffect);
    }
  }

  unit.activeEffects = nextEffects;
  unit.isStunned = nextEffects.some((effect) => effect.type === "freeze" || effect.type === "stun");
}

function tickCooldowns(unit: CombatUnit) {
  const nextCooldowns: Record<string, number> = {};
  for (const [skillId, turns] of Object.entries(unit.skillCooldowns || {})) {
    const nextValue = Math.max(0, Number(turns || 0) - 1);
    if (nextValue > 0) {
      nextCooldowns[skillId] = nextValue;
    }
  }
  unit.skillCooldowns = nextCooldowns;
}

function applySkillEffects(params: {
  effects: SkillEffect[];
  target: CombatUnit;
  caster: CombatUnit;
  skillId: string;
  turn: number;
  log: CombatLogEntry[];
}) {
  for (const effect of params.effects) {
    const chance = Number.isFinite(effect.chance) ? Number(effect.chance) : 1;
    if (Math.random() > Math.max(0, Math.min(1, chance))) {
      continue;
    }

    const activeEffect: ActiveEffect = {
      type: effect.type,
      value: effect.value,
      remainingTurns: effect.duration,
      sourceSkillId: params.skillId,
    };
    const existingIndex = params.target.activeEffects.findIndex((item) => item.type === activeEffect.type);
    if (existingIndex >= 0) {
      params.target.activeEffects[existingIndex] = activeEffect;
    } else {
      params.target.activeEffects.push(activeEffect);
    }
    pushLog(params.log, withUnitSnapshots({
      turn: params.turn,
      actorName: params.caster.name,
      action: params.skillId,
      entryType: "status",
      actorId: params.caster.id,
      targetId: params.target.id,
      skillId: params.skillId,
      effects: [getStatusName(activeEffect.type)],
      actorCurrentHp: params.caster.hp,
      actorCurrentMp: params.caster.mp,
      targetCurrentHp: params.target.hp,
      targetCurrentMp: params.target.mp,
      message: `${params.caster.name} 为 ${params.target.name} 附加了 ${getStatusName(activeEffect.type)}。`,
    }, params.caster, params.target));
  }
}

function loadRuntime(combatId: string) {
  const runtimeStore = getGlobalStore();
  const cached = runtimeStore.get(combatId);
  if (cached && !isRuntimeExpired(cached)) {
    return cloneRuntime(cached);
  }

  const persisted = readPersistedRuntimeValue<PvpCombatRuntime>(PVP_RUNTIME_NAMESPACE, combatId);
  if (!persisted || isRuntimeExpired(persisted)) {
    runtimeStore.delete(combatId);
    void deletePersistedRuntimeValue(PVP_RUNTIME_NAMESPACE, combatId).catch(() => null);
    return null;
  }

  const hydrated = cloneRuntime({
    ...persisted,
    scenePositionOverridesByViewerId: persisted.scenePositionOverridesByViewerId
      || createInitialPvpScenePositionOverrides({
        challengerPlayerId: persisted.challengerPlayerId,
        targetPlayerId: persisted.targetPlayerId,
      }),
    updatedAt: Date.now(),
  });
  runtimeStore.set(combatId, cloneRuntime(hydrated));
  return hydrated;
}

function persistRuntime(runtime: PvpCombatRuntime) {
  const nextRuntime = cloneRuntime({
    ...runtime,
    updatedAt: Date.now(),
  });
  getGlobalStore().set(nextRuntime.combatId, cloneRuntime(nextRuntime));
  void writePersistedRuntimeValue(PVP_RUNTIME_NAMESPACE, nextRuntime.combatId, nextRuntime, {
    ttlMs: PVP_RUNTIME_EXPIRE_MS,
  }).catch(() => null);
  return nextRuntime;
}

function notifySubscribers(combatId: string, event: PvpRuntimeEvent) {
  const subscribers = getSubscriberStore().get(combatId);
  if (!subscribers?.size) {
    return;
  }
  subscribers.forEach((subscriber) => {
    try {
      subscriber(event);
    } catch (error) {
      console.error("PVP runtime subscriber error:", {
        combatId,
        error,
      });
    }
  });
}

function resolveWinnerByState(runtime: PvpCombatRuntime) {
  if (runtime.state.enemy.hp <= 0) {
    runtime.state.status = "player_win";
    return;
  }
  if (runtime.state.player.hp <= 0) {
    runtime.state.status = "enemy_win";
  }
}

function createInitialSceneSnapshots(runtime: PvpCombatRuntime) {
  buildViewerSceneSnapshot(runtime, runtime.challengerPlayerId, []);
  buildViewerSceneSnapshot(runtime, runtime.targetPlayerId, []);
}

function rotateTurn(runtime: PvpCombatRuntime, nextPlayerId?: string | null) {
  runtime.turnState = buildTurnState(runtime, nextPlayerId);
}

function executeSkillAction(params: {
  runtime: PvpCombatRuntime;
  actorPlayerId: string;
  skillId: string;
  skill: PvpSkillSnapshot;
  damageCalculator?: DamageCalculator;
}) {
  const actorIsChallenger = params.actorPlayerId === params.runtime.challengerPlayerId;
  const actor = actorIsChallenger ? params.runtime.state.player : params.runtime.state.enemy;
  const target = actorIsChallenger ? params.runtime.state.enemy : params.runtime.state.player;
  const turn = params.runtime.state.turn;
  const cooldownLeft = Number(actor.skillCooldowns?.[params.skillId] || 0);

  if (cooldownLeft > 0) {
    return {
      success: false,
      error: `${params.skill.name} 冷却中，剩余 ${cooldownLeft} 回合`,
    } as const;
  }
  if (actor.mp < params.skill.mpCost) {
    return {
      success: false,
      error: "灵力不足",
    } as const;
  }

  actor.mp -= params.skill.mpCost;
  const effectTarget = params.skill.target === "self" ? actor : target;
  let hasPrimaryActionLog = false;

  if (
    params.skill.skillType === "attack"
    || params.skill.skillType === "dot"
    || params.skill.skillType === "aoe"
    || params.skill.skillType === "debuff"
  ) {
    if (params.skill.damageBase > 0 || params.skill.damageMultiplier > 0) {
      const result = calculateCombatDamageOutcome({
        attacker: actor,
        defender: target,
        damageBase: params.skill.damageBase,
        damageMultiplier: params.skill.damageMultiplier,
        damageCalculator: params.damageCalculator,
        sourceType: params.skill.sourceType,
      });
      const tags = [
        result.isCritical ? "暴击" : "",
        result.isBlocked ? "格挡" : "",
        result.mpDamage > 0 ? `护盾分担灵力 ${result.mpDamage}` : "",
      ].filter(Boolean).join("，");
      pushLog(params.runtime.state.log, withUnitSnapshots({
        turn,
        actorName: actor.name,
        action: params.skill.name,
        entryType: "skill",
        actorId: actor.id,
        targetId: target.id,
        skillId: params.skillId,
        skillName: params.skill.name,
        visualEffect: params.skill.visualEffect,
        damage: result.totalDamage,
        actorCurrentHp: actor.hp,
        actorCurrentMp: actor.mp,
        targetCurrentHp: target.hp,
        targetCurrentMp: target.mp,
        message: `${actor.name} 使用 ${params.skill.name}，对 ${target.name} 造成 ${result.totalDamage} 点伤害${tags ? `（${tags}）` : ""}。`,
      }, actor, target));
      hasPrimaryActionLog = true;
    }
  }

  if (params.skill.skillType === "heal") {
    const healAmount = calculateHealAmount(actor, params.skill.sourceType);
    actor.hp = Math.min(actor.maxHp, actor.hp + healAmount);
    pushLog(params.runtime.state.log, withUnitSnapshots({
      turn,
      actorName: actor.name,
      action: params.skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: actor.id,
      skillId: params.skillId,
      skillName: params.skill.name,
      visualEffect: params.skill.visualEffect,
      heal: healAmount,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: actor.hp,
      targetCurrentMp: actor.mp,
      message: `${actor.name} 使用 ${params.skill.name}，恢复 ${healAmount} 点气血。`,
    }, actor, actor));
    hasPrimaryActionLog = true;
  }

  if (params.skill.skillType === "shield") {
    const shieldEffect = params.skill.effects.find((effect) => effect.type === "shield");
    const ratio = normalizeShieldRatioForDisplay(Number(shieldEffect?.value || 0));
    pushLog(params.runtime.state.log, withUnitSnapshots({
      turn,
      actorName: actor.name,
      action: params.skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: effectTarget.id,
      skillId: params.skillId,
      skillName: params.skill.name,
      visualEffect: params.skill.visualEffect,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: effectTarget.hp,
      targetCurrentMp: effectTarget.mp,
      message: ratio > 0
        ? `${actor.name} 使用 ${params.skill.name}，开启 ${ratio}% 伤害转移灵力护盾。`
        : `${actor.name} 使用 ${params.skill.name}。`,
    }, actor, effectTarget));
    hasPrimaryActionLog = true;
  }

  if (!hasPrimaryActionLog) {
    pushLog(params.runtime.state.log, withUnitSnapshots({
      turn,
      actorName: actor.name,
      action: params.skill.name,
      entryType: "skill",
      actorId: actor.id,
      targetId: effectTarget.id,
      skillId: params.skillId,
      skillName: params.skill.name,
      visualEffect: params.skill.visualEffect,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: effectTarget.hp,
      targetCurrentMp: effectTarget.mp,
      message: `${actor.name} 使用了 ${params.skill.name}。`,
    }, actor, effectTarget));
  }

  if (params.skill.effects?.length) {
    applySkillEffects({
      effects: params.skill.effects,
      target: effectTarget,
      caster: actor,
      skillId: params.skillId,
      turn,
      log: params.runtime.state.log,
    });
  }

  const normalizedCooldown = normalizeCombatSkillCooldown(params.skillId, params.skill.cooldown);
  if (normalizedCooldown > 0) {
    actor.skillCooldowns[params.skillId] = normalizedCooldown + 1;
  }

  resolveWinnerByState(params.runtime);
  return {
    success: true,
  } as const;
}

function executeItemAction(params: {
  runtime: PvpCombatRuntime;
  actorPlayerId: string;
  itemName: string;
  effects: Array<{ type: string; value: number }>;
}) {
  const actorIsChallenger = params.actorPlayerId === params.runtime.challengerPlayerId;
  const actor = actorIsChallenger ? params.runtime.state.player : params.runtime.state.enemy;
  const turn = params.runtime.state.turn;
  let recovered = false;

  for (const effect of params.effects) {
    if (effect.type === "heal_hp") {
      const beforeHp = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(0, Math.floor(Number(effect.value || 0))));
      const healAmount = actor.hp - beforeHp;
      if (healAmount > 0) {
        recovered = true;
        pushLog(params.runtime.state.log, withUnitSnapshots({
          turn,
          actorName: actor.name,
          action: params.itemName,
          entryType: "item",
          actorId: actor.id,
          targetId: actor.id,
          heal: healAmount,
          actorCurrentHp: actor.hp,
          actorCurrentMp: actor.mp,
          targetCurrentHp: actor.hp,
          targetCurrentMp: actor.mp,
          message: `${actor.name} 服用了 ${params.itemName}，恢复 ${healAmount} 点气血。`,
        }, actor, actor));
      }
    }
    if (effect.type === "heal_mp") {
      const beforeMp = actor.mp;
      actor.mp = Math.min(actor.maxMp, actor.mp + Math.max(0, Math.floor(Number(effect.value || 0))));
      const restoreAmount = actor.mp - beforeMp;
      if (restoreAmount > 0) {
        recovered = true;
        pushLog(params.runtime.state.log, withUnitSnapshots({
          turn,
          actorName: actor.name,
          action: params.itemName,
          entryType: "item",
          actorId: actor.id,
          targetId: actor.id,
          actorCurrentHp: actor.hp,
          actorCurrentMp: actor.mp,
          targetCurrentHp: actor.hp,
          targetCurrentMp: actor.mp,
          message: `${actor.name} 服用了 ${params.itemName}，恢复 ${restoreAmount} 点灵力。`,
        }, actor, actor));
      }
    }
  }

  if (!recovered) {
    pushLog(params.runtime.state.log, withUnitSnapshots({
      turn,
      actorName: actor.name,
      action: params.itemName,
      entryType: "item",
      actorId: actor.id,
      targetId: actor.id,
      actorCurrentHp: actor.hp,
      actorCurrentMp: actor.mp,
      targetCurrentHp: actor.hp,
      targetCurrentMp: actor.mp,
      message: `${actor.name} 使用了 ${params.itemName}，但没有获得有效恢复。`,
    }, actor, actor));
  }

  return {
    success: true,
  } as const;
}

async function finalizeRuntimeSettlement(
  runtime: PvpCombatRuntime,
  options?: {
    reason?: PvpSettlementReason;
    loserPlayerId?: string | null;
  },
) {
  if (runtime.settlement) {
    return runtime;
  }

  const [
    { eq, inArray },
    { db },
    { combatLogs, playerMails, players },
    { resolvePlayerDefeatRespawnTarget },
    { applyFortuneEventEffects },
    { incrementPlayerDeathCount },
    { publishMapPresencePlayerPosition },
    { warmMapSceneSharedStateForMapId },
    { publishSocialEvent },
    { runCombatSideEffectTransactionOnce },
  ] = await Promise.all([
    import("drizzle-orm"),
    import("@/db"),
    import("@/db/schema"),
    import("@/modules/character/services/player-death-respawn"),
    import("@/modules/character/services/fortune-service"),
    import("@/modules/combat/services/player-hidden-combat-stats"),
    import("@/modules/map/services/map-presence"),
    import("@/modules/map/services/map-scene-hub"),
    import("@/modules/social/realtime/social-presence"),
    import("@/modules/combat/services/combat-side-effect-claim-service"),
  ]);

  const explicitLoserPlayerId = options?.loserPlayerId && isPvpCombatParticipant(runtime, options.loserPlayerId)
    ? options.loserPlayerId
    : null;
  const loserPlayerId = explicitLoserPlayerId
    || (runtime.state.status === "player_win" ? runtime.targetPlayerId : runtime.challengerPlayerId);
  const winnerPlayerId = loserPlayerId === runtime.challengerPlayerId
    ? runtime.targetPlayerId
    : runtime.challengerPlayerId;
  if (winnerPlayerId === runtime.challengerPlayerId) {
    runtime.state.status = "player_win";
  } else {
    runtime.state.status = "enemy_win";
  }
  const winnerName = winnerPlayerId === runtime.challengerPlayerId
    ? runtime.state.player.name
    : runtime.state.enemy.name;
  const loserName = loserPlayerId === runtime.challengerPlayerId
    ? runtime.state.player.name
    : runtime.state.enemy.name;
  const settlementReason = options?.reason || "defeated";
  const nowIso = new Date().toISOString();
  const loserRespawn = await resolvePlayerDefeatRespawnTarget(loserPlayerId);
  const loserRows = await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
  }).from(players).where(inArray(players.id, [winnerPlayerId, loserPlayerId])).all();
  const loserSource = loserRows.find((row) => row.id === loserPlayerId);

  let winnerFortuneResult: unknown = null;
  let loserFortuneResult: unknown = null;
  let settlementSideEffectExecuted = false;

  const settlementSideEffect = await runCombatSideEffectTransactionOnce({
    effectKey: `pvp-result:${runtime.combatId}`,
    combatId: runtime.combatId,
    effectType: "pvp_result_settlement",
    playerId: loserPlayerId,
    task: async (tx) => {
      await incrementPlayerDeathCount(loserPlayerId, tx);
      await tx.update(players).set({
        hp: 1,
        mp: 1,
        currentMapId: loserRespawn.mapId,
        currentMapInstanceId: null,
        positionX: loserRespawn.positionX,
        positionY: loserRespawn.positionY,
        updatedAt: nowIso,
      }).where(eq(players.id, loserPlayerId)).run();

      winnerFortuneResult = await applyFortuneEventEffects({
        playerId: winnerPlayerId,
        trigger: "kill_player",
        tx,
      });
      loserFortuneResult = await applyFortuneEventEffects({
        playerId: loserPlayerId,
        trigger: "self_death",
        tx,
      });

      await tx.insert(playerMails).values({
        playerId: loserPlayerId,
        title: "野外切磋落败",
        content: `你在野外切磋中被 ${winnerName} 击败，已被送回${loserRespawn.mode === "sect" ? "宗门" : "出生点"}。`,
        reward: {},
        createdAt: nowIso,
      }).run();

      await tx.insert(combatLogs).values([
        {
          playerId: winnerPlayerId,
          opponentType: "player",
          opponentId: loserPlayerId,
          result: "win",
          details: {
            mode: "pvp",
            combatId: runtime.combatId,
            mapId: runtime.mapId,
            reason: settlementReason,
            winnerPlayerId,
            loserPlayerId,
            turns: runtime.state.turn,
            myFinalHp: winnerPlayerId === runtime.challengerPlayerId ? runtime.state.player.hp : runtime.state.enemy.hp,
            myFinalMp: winnerPlayerId === runtime.challengerPlayerId ? runtime.state.player.mp : runtime.state.enemy.mp,
            opponentFinalHp: loserPlayerId === runtime.challengerPlayerId ? runtime.state.player.hp : runtime.state.enemy.hp,
            opponentFinalMp: loserPlayerId === runtime.challengerPlayerId ? runtime.state.player.mp : runtime.state.enemy.mp,
            myFortuneApplied: winnerFortuneResult,
          },
          createdAt: nowIso,
        },
        {
          playerId: loserPlayerId,
          opponentType: "player",
          opponentId: winnerPlayerId,
          result: "lose",
          details: {
            mode: "pvp",
            combatId: runtime.combatId,
            mapId: runtime.mapId,
            reason: settlementReason,
            winnerPlayerId,
            loserPlayerId,
            turns: runtime.state.turn,
            myFinalHp: loserPlayerId === runtime.challengerPlayerId ? runtime.state.player.hp : runtime.state.enemy.hp,
            myFinalMp: loserPlayerId === runtime.challengerPlayerId ? runtime.state.player.mp : runtime.state.enemy.mp,
            opponentFinalHp: winnerPlayerId === runtime.challengerPlayerId ? runtime.state.player.hp : runtime.state.enemy.hp,
            opponentFinalMp: winnerPlayerId === runtime.challengerPlayerId ? runtime.state.player.mp : runtime.state.enemy.mp,
            myFortuneApplied: loserFortuneResult,
          },
          createdAt: nowIso,
        },
      ]).run();
    },
  });
  settlementSideEffectExecuted = settlementSideEffect.executed;

  if (settlementSideEffectExecuted) {
    await warmMapSceneSharedStateForMapId({
      mapId: loserRespawn.mapId,
      reason: "player_transition",
    }).catch((error) => {
      console.error("PVP loser respawn map prewarm error:", {
        loserPlayerId,
        mapId: loserRespawn.mapId,
        error,
      });
    });

    if (loserSource) {
      publishMapPresencePlayerPosition({
        id: loserPlayerId,
        name: loserSource.name || "",
        gender: loserSource.gender,
        realm: loserSource.realm,
        realmMajor: loserSource.realmMajor,
        realmMinor: loserSource.realmMinor,
        realmName: loserSource.realmName || "凡人",
        mapId: loserRespawn.mapId,
        prevMapId: runtime.mapId,
        positionX: loserRespawn.positionX,
        positionY: loserRespawn.positionY,
      });
    }

    publishSocialEvent([loserPlayerId], {
      type: "notification",
      data: {
        kind: "pvp_defeat",
        title: "野外切磋落败",
        content: `你在野外切磋中被 ${winnerName} 击败，已被送回${loserRespawn.mode === "sect" ? "宗门" : "出生点"}。`,
        createdAt: nowIso,
      },
    });
  }

  runtime.settlement = {
    winnerPlayerId,
    winnerName,
    loserPlayerId,
    loserName,
    loserRespawn: {
      mode: loserRespawn.mode,
      mapId: loserRespawn.mapId,
      positionX: loserRespawn.positionX,
      positionY: loserRespawn.positionY,
    },
    resultByPlayerId: {
      [winnerPlayerId]: "win",
      [loserPlayerId]: "lose",
    },
    reason: settlementReason,
    settledAt: nowIso,
  };

  return runtime;
}

export function getPvpCombatRuntime(combatId: string) {
  return loadRuntime(combatId);
}

export function isPvpCombatParticipant(runtime: PvpCombatRuntime, playerId: string) {
  return runtime.challengerPlayerId === playerId || runtime.targetPlayerId === playerId;
}

export function getLastAcceptedPvpClientSequence(combatId: string, playerId: string) {
  const runtime = loadRuntime(combatId);
  if (!runtime) {
    return 0;
  }
  return Number(runtime.lastAcceptedClientSequenceByPlayerId[playerId] || 0);
}

export function acceptPvpClientSequence(combatId: string, playerId: string, clientSequence: number) {
  const runtime = loadRuntime(combatId);
  if (!runtime) {
    return null;
  }
  runtime.lastAcceptedClientSequenceByPlayerId[playerId] = clientSequence;
  return persistRuntime(runtime);
}

export function buildPvpViewerSceneData(combatId: string, viewerPlayerId: string): PvpViewerSceneData | null {
  const runtime = loadRuntime(combatId);
  if (!runtime || !isPvpCombatParticipant(runtime, viewerPlayerId)) {
    return null;
  }
  const sceneSnapshot = runtime.sceneSnapshotsByPlayerId[viewerPlayerId] || buildViewerSceneSnapshot(runtime, viewerPlayerId, []);
  const battleView = buildPvpRuntimeBattleViewState(runtime, viewerPlayerId, sceneSnapshot);
  return {
    runtime,
    state: buildViewerCombatState(runtime, viewerPlayerId),
    sceneSnapshot,
    battleView,
    battleRuntime: buildPvpBattleRuntimeFromView({
      battleView,
      sceneSnapshot,
      turnState: runtime.turnState,
      settlement: runtime.settlement ? { ...runtime.settlement } : null,
      payload: {
        settlement: runtime.settlement,
        viewerPlayerId,
      },
    }),
    turnState: cloneValue(runtime.turnState),
    settlement: runtime.settlement ? cloneValue(runtime.settlement) : null,
  };
}

export async function createPvpCombatRuntime(params: {
  combatId: string;
  mapId: string;
  challengerPlayerId: string;
  targetPlayerId: string;
  challenger: CombatUnit;
  target: CombatUnit;
  skillsData: Record<string, PvpSkillSnapshot>;
  challengerRotation: string[];
  targetRotation: string[];
}) {
  const runtime: PvpCombatRuntime = {
    combatId: params.combatId,
    mapId: params.mapId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    challengerPlayerId: params.challengerPlayerId,
    targetPlayerId: params.targetPlayerId,
    state: {
      id: params.combatId,
      turn: 0,
      player: cloneUnit(params.challenger),
      enemy: cloneUnit(params.target),
      participants: [cloneUnit(params.challenger), cloneUnit(params.target)],
      log: [{
        turn: 0,
        actorName: "系统",
        action: "切磋开始",
        entryType: "system",
        message: `${params.challenger.name} 与 ${params.target.name} 开始实时论道。`,
      }],
      status: "ongoing",
    },
    turnState: buildTurnState({
      challengerPlayerId: params.challengerPlayerId,
      targetPlayerId: params.targetPlayerId,
    }, params.challengerPlayerId),
    skillsData: cloneValue(params.skillsData),
    skillRotationsByPlayerId: {
      [params.challengerPlayerId]: [...params.challengerRotation],
      [params.targetPlayerId]: [...params.targetRotation],
    },
    lastAcceptedClientSequenceByPlayerId: {
      [params.challengerPlayerId]: 0,
      [params.targetPlayerId]: 0,
    },
    sceneSnapshotsByPlayerId: {
      [params.challengerPlayerId]: null,
      [params.targetPlayerId]: null,
    },
    scenePositionOverridesByViewerId: createInitialPvpScenePositionOverrides({
      challengerPlayerId: params.challengerPlayerId,
      targetPlayerId: params.targetPlayerId,
    }),
    initialState: {
      challenger: cloneUnit(params.challenger),
      target: cloneUnit(params.target),
    },
    settlement: null,
  };

  createInitialSceneSnapshots(runtime);
  const persisted = persistRuntime(runtime);
  notifySubscribers(persisted.combatId, {
    runtimeId: persisted.combatId,
    type: "scene",
  });
  return persisted;
}

export async function performPvpCombatAction(params: {
  combatId: string;
  actorPlayerId: string;
  actionType: "skill" | "item" | "surrender" | "ready";
  skillId?: string;
  itemName?: string;
  itemEffects?: Array<{ type: string; value: number }>;
  damageCalculator?: DamageCalculator;
  settlementReason?: PvpSettlementReason;
}) {
  const locked = await withRuntimeLock(params.combatId, async () => {
    const runtime = loadRuntime(params.combatId);
    if (!runtime) {
      return {
        success: false,
        error: "论道会话不存在",
      } satisfies PvpActionResult;
    }
    if (!isPvpCombatParticipant(runtime, params.actorPlayerId)) {
      return {
        success: false,
        error: "你不在这场论道中",
      } satisfies PvpActionResult;
    }
    if (runtime.state.status !== "ongoing") {
      return {
        success: false,
        error: "论道已结束",
      } satisfies PvpActionResult;
    }
    if (runtime.turnState.currentTurnPlayerId !== params.actorPlayerId) {
      return {
        success: false,
        error: "当前还未轮到你出手",
      } satisfies PvpActionResult;
    }

    runtime.state.turn += 1;
    const actorIsChallenger = params.actorPlayerId === runtime.challengerPlayerId;
    const actor = actorIsChallenger ? runtime.state.player : runtime.state.enemy;
    const target = actorIsChallenger ? runtime.state.enemy : runtime.state.player;
    const previousLogLength = runtime.state.log.length;

    tickCooldowns(actor);
    processEffects(actor, runtime.state.log, runtime.state.turn);
    if (actor.hp <= 0) {
      runtime.state.status = actorIsChallenger ? "enemy_win" : "player_win";
    }

    if (runtime.state.status === "ongoing" && actor.isStunned) {
      actor.isStunned = false;
      pushLog(runtime.state.log, withUnitSnapshots({
        turn: runtime.state.turn,
        actorName: actor.name,
        action: "受控",
        entryType: "system",
        actorId: actor.id,
        targetId: actor.id,
        message: `${actor.name} 受到控制，本回合无法行动。`,
      }, actor, actor));
    } else if (runtime.state.status === "ongoing") {
      if (params.actionType === "surrender") {
        runtime.state.status = actorIsChallenger ? "enemy_win" : "player_win";
        pushLog(runtime.state.log, withUnitSnapshots({
          turn: runtime.state.turn,
          actorName: actor.name,
          action: "认输",
          entryType: "system",
          actorId: actor.id,
          targetId: target.id,
          message: `${actor.name} 主动认输，本场论道就此结束。`,
        }, actor, target));
      } else if (params.actionType === "ready") {
        pushLog(runtime.state.log, withUnitSnapshots({
          turn: runtime.state.turn,
          actorName: actor.name,
          action: "停手",
          entryType: "system",
          actorId: actor.id,
          targetId: target.id,
          message: `${actor.name} 暂缓出手，轮转继续。`,
        }, actor, target));
      } else if (params.actionType === "item") {
        if (!params.itemName || !params.itemEffects?.length) {
          return {
            success: false,
            error: "缺少丹药数据",
          } satisfies PvpActionResult;
        }
        const itemResult = executeItemAction({
          runtime,
          actorPlayerId: params.actorPlayerId,
          itemName: params.itemName,
          effects: params.itemEffects,
        });
        if (!itemResult.success) {
          return itemResult;
        }
      } else {
        const skillId = params.skillId?.trim() || "";
        const skill = skillId ? runtime.skillsData[skillId] : null;
        if (!skillId || !skill) {
          return {
            success: false,
            error: "神通不存在",
          } satisfies PvpActionResult;
        }
        const skillResult = executeSkillAction({
          runtime,
          actorPlayerId: params.actorPlayerId,
          skillId,
          skill,
          damageCalculator: params.damageCalculator,
        });
        if (!skillResult.success) {
          return skillResult;
        }
      }
    }

    let settlementTriggered = false;
    if (runtime.state.status === "ongoing") {
      rotateTurn(runtime, actorIsChallenger ? runtime.targetPlayerId : runtime.challengerPlayerId);
    } else {
      rotateTurn(runtime, null);
      await finalizeRuntimeSettlement(runtime, {
        reason: params.settlementReason
          || (params.actionType === "surrender" ? "surrender" : params.actionType === "ready" ? "timeout" : "defeated"),
      });
      settlementTriggered = true;
    }

    const nextEntries = runtime.state.log.slice(previousLogLength);
    const timeline = buildPvpTimelineEntries({
      combatId: runtime.combatId,
      entries: nextEntries,
      startedAtMs: Date.now(),
    });
    buildViewerSceneSnapshot(runtime, runtime.challengerPlayerId, timeline);
    buildViewerSceneSnapshot(runtime, runtime.targetPlayerId, timeline);

    const persisted = persistRuntime(runtime);
    notifySubscribers(persisted.combatId, {
      runtimeId: persisted.combatId,
      type: "scene",
    });
    if (settlementTriggered) {
      notifySubscribers(persisted.combatId, {
        runtimeId: persisted.combatId,
        type: "settlement",
      });
    }

    return {
      success: true,
      runtime: persisted,
      timeline,
      settlementTriggered,
    } satisfies PvpActionResult;
  });
  if (!locked.success) {
    return {
      success: false,
      error: locked.error,
    } satisfies PvpActionResult;
  }
  return locked.value;
}

export async function performPvpCombatMovement(params: {
  combatId: string;
  actorPlayerId: string;
  targetXPercent: number;
  targetYPercent: number;
}) {
  const locked = await withRuntimeLock(params.combatId, async () => {
    const runtime = loadRuntime(params.combatId);
    if (!runtime) {
      return {
        success: false,
        error: "论道会话不存在",
      } satisfies PvpMovementResult;
    }
    if (!isPvpCombatParticipant(runtime, params.actorPlayerId)) {
      return {
        success: false,
        error: "你不在这场论道中",
      } satisfies PvpMovementResult;
    }
    if (runtime.state.status !== "ongoing") {
      return {
        success: false,
        error: "论道已结束",
      } satisfies PvpMovementResult;
    }

    const positionOverridesByViewerId = ensurePvpScenePositionOverrides(runtime);
    const actorViewerOverrides = positionOverridesByViewerId[params.actorPlayerId] || {};
    const actorSnapshot = runtime.sceneSnapshotsByPlayerId[params.actorPlayerId]
      || buildViewerSceneSnapshot(runtime, params.actorPlayerId, []);
    const actorSnapshotUnit = actorSnapshot.units.find((unit) => unit.id === params.actorPlayerId);
    const currentPosition = actorViewerOverrides[params.actorPlayerId] || {
      xPercent: actorSnapshotUnit?.xPercent ?? 50,
      yPercent: actorSnapshotUnit?.yPercent ?? 76,
    };
    const targetPosition = {
      x: clampCombatSceneXPercent(Math.round(params.targetXPercent * 10) / 10),
      y: clampCombatScenePlayerYPercent(Math.round(params.targetYPercent * 10) / 10),
    };
    const decision = decideBattleMovement({
      ruleset: getProtocolBattleRuleset("pvp"),
      from: {
        x: Number(currentPosition.xPercent ?? 50),
        y: Number(currentPosition.yPercent ?? 76),
      },
      to: targetPosition,
    });
    if (!decision.accepted) {
      return {
        success: false,
        error: decision.reason || "invalid_position",
      } satisfies PvpMovementResult;
    }

    const actorPosition = {
      xPercent: decision.position.x,
      yPercent: decision.position.y,
    } satisfies BattleScenePositionOverride;
    const opponentPlayerId = getPvpOpponentPlayerId(runtime, params.actorPlayerId);
    positionOverridesByViewerId[params.actorPlayerId] = {
      ...positionOverridesByViewerId[params.actorPlayerId],
      [params.actorPlayerId]: actorPosition,
    };
    positionOverridesByViewerId[opponentPlayerId] = {
      ...positionOverridesByViewerId[opponentPlayerId],
      [params.actorPlayerId]: mirrorPvpOpponentPosition(actorPosition),
    };

    buildViewerSceneSnapshot(runtime, runtime.challengerPlayerId, []);
    buildViewerSceneSnapshot(runtime, runtime.targetPlayerId, []);

    const persisted = persistRuntime(runtime);
    notifySubscribers(persisted.combatId, {
      runtimeId: persisted.combatId,
      type: "scene",
    });

    return {
      success: true,
      runtime: persisted,
      actorPosition,
    } satisfies PvpMovementResult;
  });
  if (!locked.success) {
    return {
      success: false,
      error: locked.error,
    } satisfies PvpMovementResult;
  }
  return locked.value;
}

export async function advancePvpCombatTimeout(combatId: string) {
  const runtime = loadRuntime(combatId);
  if (!runtime) {
    return {
      success: false,
      error: "论道会话不存在",
    } as const;
  }
  if (runtime.state.status !== "ongoing" || !runtime.turnState.currentTurnPlayerId) {
    return {
      success: false,
      error: "当前论道无需推进",
    } as const;
  }
  if (runtime.turnState.turnDeadlineAt && Date.parse(runtime.turnState.turnDeadlineAt) > Date.now()) {
    return {
      success: false,
      error: "当前回合尚未超时",
    } as const;
  }

  const actorPlayerId = runtime.turnState.currentTurnPlayerId;
  const actor = actorPlayerId === runtime.challengerPlayerId
    ? runtime.state.player
    : runtime.state.enemy;
  if (!actor || actor.hp <= 0) {
    return {
      success: false,
      error: "当前回合角色无法行动",
    } as const;
  }

  const skillId = pickPvpTimeoutSkillId(runtime, actor);
  const result = await performPvpCombatAction({
    combatId,
    actorPlayerId,
    actionType: skillId ? "skill" : "ready",
    settlementReason: "timeout",
    ...(skillId ? { skillId } : {}),
  });
  return result;
}

export async function settlePvpCombatDisconnect(params: {
  combatId: string;
  disconnectedPlayerId: string;
}) {
  const locked = await withRuntimeLock(params.combatId, async () => {
    const runtime = loadRuntime(params.combatId);
    if (!runtime) {
      return {
        success: false,
        error: "论道会话不存在",
      } as const;
    }
    if (!isPvpCombatParticipant(runtime, params.disconnectedPlayerId)) {
      return {
        success: false,
        error: "掉线玩家不在这场论道中",
      } as const;
    }
    if (runtime.settlement) {
      return {
        success: true,
        runtime,
        settlementTriggered: false,
      } as const;
    }
    if (runtime.state.status === "ongoing") {
      runtime.state.status = params.disconnectedPlayerId === runtime.challengerPlayerId ? "enemy_win" : "player_win";
      runtime.state.turn += 1;
      const loserName = params.disconnectedPlayerId === runtime.challengerPlayerId
        ? runtime.state.player.name
        : runtime.state.enemy.name;
      const winner = params.disconnectedPlayerId === runtime.challengerPlayerId
        ? runtime.state.enemy
        : runtime.state.player;
      pushLog(runtime.state.log, withUnitSnapshots({
        turn: runtime.state.turn,
        actorName: "系统",
        action: "掉线裁定",
        entryType: "system",
        actorId: params.disconnectedPlayerId,
        targetId: winner.id,
        message: `${loserName} 长时间断线，本场论道按掉线判负。`,
      }, winner, winner));
    }

    rotateTurn(runtime, null);
    await finalizeRuntimeSettlement(runtime, {
      reason: "disconnect_timeout",
      loserPlayerId: params.disconnectedPlayerId,
    });
    buildViewerSceneSnapshot(runtime, runtime.challengerPlayerId, []);
    buildViewerSceneSnapshot(runtime, runtime.targetPlayerId, []);
    const persisted = persistRuntime(runtime);
    notifySubscribers(persisted.combatId, {
      runtimeId: persisted.combatId,
      type: "scene",
    });
    notifySubscribers(persisted.combatId, {
      runtimeId: persisted.combatId,
      type: "settlement",
    });
    return {
      success: true,
      runtime: persisted,
      settlementTriggered: true,
    } as const;
  });
  if (!locked.success) {
    return {
      success: false,
      error: locked.error,
    } as const;
  }
  return locked.value;
}

export async function syncPvpCombatRuntime(combatId: string, options?: { maxTimeoutSteps?: number }) {
  const maxTimeoutSteps = Math.max(1, Math.min(8, Number(options?.maxTimeoutSteps || 3)));
  let runtime = loadRuntime(combatId);
  if (!runtime) {
    return null;
  }

  for (let step = 0; step < maxTimeoutSteps; step += 1) {
    if (!runtime) {
      return null;
    }
    if (
      runtime.state.status !== "ongoing"
      || !runtime.turnState.turnDeadlineAt
      || Date.parse(runtime.turnState.turnDeadlineAt) > Date.now()
    ) {
      return runtime;
    }

    const advanced = await advancePvpCombatTimeout(combatId);
    if (!advanced.success) {
      break;
    }
    runtime = loadRuntime(combatId);
  }

  return loadRuntime(combatId);
}

export function subscribePvpCombatRuntime(combatId: string, subscriber: PvpRuntimeSubscriber) {
  const store = getSubscriberStore();
  const existing = store.get(combatId) || new Set<PvpRuntimeSubscriber>();
  existing.add(subscriber);
  store.set(combatId, existing);

  return () => {
    const current = store.get(combatId);
    if (!current) {
      return;
    }
    current.delete(subscriber);
    if (!current.size) {
      store.delete(combatId);
    }
  };
}

export async function closePvpCombatRuntime(combatId: string) {
  getGlobalStore().delete(combatId);
  notifySubscribers(combatId, {
    runtimeId: combatId,
    type: "closed",
  });
  await deletePersistedRuntimeValue(PVP_RUNTIME_NAMESPACE, combatId).catch(() => null);
}
