import { and, eq, inArray } from "drizzle-orm";
import { getBattleRuleset, type BattleMode } from "@immortality/game-rules";
import type {
  CombatSceneAuthoritativeState,
  CombatSceneEntity,
} from "@immortality/shared-protocol";
import type { BattleSceneSnapshot } from "../../../src/modules/combat/services/battle-scene-state";
import { buildCombatBattleViewState, buildBossBattleViewState } from "../../../src/modules/combat/services/battle-view";
import type {
  BossParticipant,
  CombatState,
  CombatUnit,
} from "../../../src/types/game";

export type CombatRuntimeHydrationContext = {
  mode: BattleMode;
  playerId: string;
  playerName: string;
  combatId?: string;
  partyId?: string;
  roomId: string;
};

type PendingCombatSessionLike = {
  combatId: string;
  state: CombatState;
  sceneSnapshot?: BattleSceneSnapshot | null;
  skillsData?: unknown;
};

export type CombatRuntimeHydrationResult = {
  mode: BattleMode;
  source: NonNullable<CombatSceneAuthoritativeState["runtimeSource"]>;
  entities: CombatSceneEntity[];
  authoritativeState: CombatSceneAuthoritativeState;
};

function cloneUnknown<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return structuredClone(value);
}

function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getUnitPosition(snapshot: BattleSceneSnapshot | null | undefined, unitId: string, fallback: {
  x: number;
  y: number;
}) {
  const unit = snapshot?.units?.find((item) => item.id === unitId);
  if (!unit) {
    return {
      ...fallback,
      velocityX: 0,
      velocityY: 0,
    };
  }
  return {
    x: Number.isFinite(unit.xPercent) ? unit.xPercent : fallback.x,
    y: Number.isFinite(unit.yPercent) ? unit.yPercent : fallback.y,
    velocityX: Number.isFinite(unit.velocityXPercentPerSecond) ? unit.velocityXPercentPerSecond : 0,
    velocityY: Number.isFinite(unit.velocityYPercentPerSecond) ? unit.velocityYPercentPerSecond : 0,
  };
}

function buildBattleRuntimeFromBattleView(params: {
  battleView: {
    runtimeId: string;
    mode: BattleMode;
    runtimeState: unknown;
    participants?: unknown[];
    sceneSnapshot?: unknown;
    turnState?: unknown;
    settlement?: unknown;
    modePayload?: unknown;
  };
  sceneSnapshot?: unknown;
  turnState?: unknown;
  settlement?: unknown;
  payload?: unknown;
}) {
  const sceneSnapshot = params.sceneSnapshot
    ?? params.battleView.sceneSnapshot
    ?? null;
  const sceneRecord = sceneSnapshot && typeof sceneSnapshot === "object"
    ? sceneSnapshot as { sceneVersion?: number; sequence?: number; tick?: number }
    : {};

  return {
    runtimeId: params.battleView.runtimeId,
    mode: params.battleView.mode,
    state: params.battleView.runtimeState,
    sceneVersion: sceneRecord.sceneVersion ?? sceneRecord.sequence ?? 0,
    tick: sceneRecord.tick ?? 0,
    ruleset: getBattleRuleset(params.battleView.mode),
    participants: params.battleView.participants || [],
    battleView: params.battleView,
    turnState: params.turnState ?? params.battleView.turnState ?? null,
    sceneSnapshot,
    settlement: params.settlement || null,
    payload: params.payload || params.battleView.modePayload || null,
  };
}

function unitToEntity(params: {
  unit: CombatUnit;
  role: "player" | "enemy" | "boss";
  slot?: number | null;
  isCurrent?: boolean;
  snapshot?: BattleSceneSnapshot | null;
  fallback: { x: number; y: number };
}): CombatSceneEntity {
  const position = getUnitPosition(params.snapshot, params.unit.id, params.fallback);
  return {
    id: params.unit.id,
    kind: "combatant",
    role: params.role,
    name: params.unit.name || params.unit.id,
    x: position.x,
    y: position.y,
    velocityX: position.velocityX || 0,
    velocityY: position.velocityY || 0,
    updatedAt: Date.now(),
    hp: Number(params.unit.hp || 0),
    maxHp: Number(params.unit.maxHp || 0),
    mp: Number(params.unit.mp || 0),
    maxMp: Number(params.unit.maxMp || 0),
    isCurrent: Boolean(params.isCurrent),
  };
}

function stateToCombatEntities(params: {
  state: CombatState;
  snapshot?: BattleSceneSnapshot | null;
  viewerPlayerId: string;
  mode: BattleMode;
}) {
  const participants = params.state.participants?.length
    ? params.state.participants
    : [params.state.player];
  const turnOwnerId = params.state.currentTurnPlayerId || params.state.player.id;
  const playerEntities = participants.map((unit, index) => unitToEntity({
    unit,
    role: "player",
    slot: index,
    isCurrent: unit.id === turnOwnerId || unit.id === params.viewerPlayerId,
    snapshot: params.snapshot,
    fallback: {
      x: participants.length > 1 ? 42 + (index * 8) : 50,
      y: params.mode === "boss" ? 72 : 84,
    },
  }));
  const enemyRole = params.mode === "boss" ? "boss" : "enemy";
  const enemyEntity = unitToEntity({
    unit: params.state.enemy,
    role: enemyRole,
    snapshot: params.snapshot,
    fallback: {
      x: 50,
      y: params.mode === "boss" ? 22 : 16,
    },
  });
  return [enemyEntity, ...playerEntities];
}

function createAuthoritativeState(params: {
  mode: BattleMode;
  source: NonNullable<CombatSceneAuthoritativeState["runtimeSource"]>;
  entities: CombatSceneEntity[];
  state?: unknown;
  sceneSnapshot?: unknown;
  battleView?: unknown;
  battleRuntime?: unknown;
  skillsData?: unknown;
  inventoryItems?: unknown;
  skillRotation?: string[];
  turnState?: unknown;
  settlement?: unknown;
  participants?: unknown;
  claimState?: unknown;
  matchContext?: unknown;
  timeoutDecision?: unknown;
}): CombatSceneAuthoritativeState {
  return {
    mode: params.mode,
    ruleset: getBattleRuleset(params.mode),
    entities: params.entities,
    runtimeSource: params.source,
    state: params.state,
    sceneSnapshot: params.sceneSnapshot,
    battleView: params.battleView,
    battleRuntime: params.battleRuntime,
    skillsData: params.skillsData,
    inventoryItems: params.inventoryItems,
    skillRotation: params.skillRotation,
    turnState: params.turnState,
    settlement: params.settlement,
    participants: params.participants,
    claimState: params.claimState,
    matchContext: params.matchContext,
    timeoutDecision: params.timeoutDecision,
  };
}

function buildPendingCombatPayload(params: {
  context: CombatRuntimeHydrationContext;
  session: PendingCombatSessionLike;
}) {
  const state = cloneUnknown(params.session.state);
  const sceneSnapshot = cloneUnknown(params.session.sceneSnapshot);
  const battleView = buildCombatBattleViewState({
    runtimeId: params.session.combatId,
    mode: "solo",
    state,
    sceneSnapshot,
    viewerPlayerId: params.context.playerId,
  });
  const battleRuntime = buildBattleRuntimeFromBattleView({
    battleView,
    sceneSnapshot,
  });
  const entities = stateToCombatEntities({
    state,
    snapshot: sceneSnapshot,
    viewerPlayerId: params.context.playerId,
    mode: "solo",
  });
  return {
    mode: "solo" as const,
    source: "pending_combat" as const,
    entities,
    authoritativeState: createAuthoritativeState({
      mode: "solo",
      source: "pending_combat",
      entities,
      state,
      sceneSnapshot,
      battleView,
      battleRuntime,
      skillsData: cloneUnknown(params.session.skillsData),
      skillRotation: Array.isArray(state.player?.skills) ? state.player.skills : [],
      turnState: null,
    }),
  } satisfies CombatRuntimeHydrationResult;
}

async function loadPlayerCombatInventoryItems(playerId: string) {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const { db, schema } = await import("@immortality/db");
  const rows = await db.select({
    itemId: schema.playerInventory.itemId,
    quantity: schema.playerInventory.quantity,
    name: schema.items.name,
    iconUrl: schema.items.iconUrl,
    itemType: schema.items.itemType,
    rarity: schema.items.rarity,
    effects: schema.items.effects,
  }).from(schema.playerInventory)
    .innerJoin(schema.items, eq(schema.playerInventory.itemId, schema.items.id))
    .where(and(
      eq(schema.playerInventory.playerId, playerId),
      eq(schema.items.itemType, "consumable"),
    ))
    .all();

  return rows
    .filter((row) => row.quantity > 0)
    .map((row) => ({
      itemId: row.itemId,
      name: row.name,
      iconUrl: row.iconUrl,
      quantity: row.quantity,
      itemType: row.itemType,
      rarity: row.rarity,
      effects: row.effects || [],
    }));
}

async function hydratePendingCombat(context: CombatRuntimeHydrationContext) {
  if (!context.combatId || context.mode !== "solo") {
    return null;
  }
  const {
    getPendingCombatSession,
    syncPendingCombatSessionRuntime,
  } = await import("../../../src/modules/combat/services/pending-combat-session");
  const session = await syncPendingCombatSessionRuntime(context.playerId, context.combatId)
    || getPendingCombatSession(context.playerId, context.combatId);
  if (!session) {
    return null;
  }
  const payload = buildPendingCombatPayload({ context, session });
  const inventoryItems = await loadPlayerCombatInventoryItems(context.playerId).catch((error) => {
    console.warn("[game-server] combat inventory hydrate failed", {
      playerId: context.playerId,
      combatId: context.combatId,
      error: error instanceof Error ? error.message : error,
    });
    return [];
  });
  return {
    ...payload,
    authoritativeState: {
      ...payload.authoritativeState,
      inventoryItems,
    },
  } satisfies CombatRuntimeHydrationResult;
}

async function hydratePartyCombat(context: CombatRuntimeHydrationContext) {
  const encounterId = context.partyId || context.combatId;
  if (!encounterId || context.mode !== "party") {
    return null;
  }
  if (!isDatabaseConfigured()) {
    return null;
  }
  const {
    buildPartyCombatViewState,
    getPartyCombatEncounterRuntime,
  } = await import("../../../src/modules/combat/services/party-combat-service");
  const runtime = await getPartyCombatEncounterRuntime({
    encounterId,
    allowStatuses: ["ongoing", "resolved", "abandoned"],
  });
  if (!runtime) {
    return null;
  }
  const state = buildPartyCombatViewState(runtime.state, context.playerId);
  const sceneSnapshot = cloneUnknown(runtime.sceneSnapshot);
  const turnState = cloneUnknown(runtime.turnState);
  const battleView = buildCombatBattleViewState({
    runtimeId: runtime.encounter.id,
    mode: "party",
    state,
    sceneSnapshot,
    turnState,
    viewerPlayerId: context.playerId,
  });
  const battleRuntime = buildBattleRuntimeFromBattleView({
    battleView,
    sceneSnapshot,
    turnState,
  });
  const entities = stateToCombatEntities({
    state,
    snapshot: sceneSnapshot,
    viewerPlayerId: context.playerId,
    mode: "party",
  });
  return {
    mode: "party" as const,
    source: "party_encounter" as const,
    entities,
    authoritativeState: createAuthoritativeState({
      mode: "party",
      source: "party_encounter",
      entities,
      state,
      sceneSnapshot,
      battleView,
      battleRuntime,
      turnState,
      participants: state.participants,
      matchContext: {
        encounterId: runtime.encounter.id,
        partyId: runtime.encounter.partyId,
        encounterType: runtime.encounter.encounterType,
        status: runtime.encounter.status,
      },
    }),
  } satisfies CombatRuntimeHydrationResult;
}

async function hydrateBossRoom(context: CombatRuntimeHydrationContext) {
  if (context.mode !== "boss") {
    return null;
  }
  if (!isDatabaseConfigured()) {
    return null;
  }
  const normalizedId = String(context.combatId || "").trim();
  if (!normalizedId) {
    return null;
  }
  const { db, schema } = await import("@immortality/db");
  const numericInstanceId = Number(normalizedId);
  const instance = Number.isInteger(numericInstanceId)
    ? await db.select().from(schema.bossInstances).where(eq(schema.bossInstances.id, numericInstanceId)).get()
    : null;
  const monsterId = instance?.monsterId || normalizedId;
  const monster = await db.select().from(schema.monsters).where(eq(schema.monsters.id, monsterId)).get();
  if (!instance && !monster) {
    return null;
  }
  const damageMap = (instance?.damageMap && typeof instance.damageMap === "object")
    ? instance.damageMap
    : {};
  const bossCombatId = String(instance?.id || monsterId);
  const rewardClaim = await db.select().from(schema.combatRewardClaims).where(and(
    eq(schema.combatRewardClaims.combatId, bossCombatId),
    eq(schema.combatRewardClaims.playerId, context.playerId),
  )).get().catch(() => null);
  const participantIds = Object.keys(damageMap);
  const playerRows = participantIds.length
    ? await db.select().from(schema.players).where(inArray(schema.players.id, participantIds)).all()
    : [];
  const participants: BossParticipant[] = playerRows.map((player, index) => ({
    playerId: player.id,
    playerName: player.name,
    slot: index,
    hp: player.hp,
    maxHp: player.maxHp,
    mp: player.mp,
    maxMp: player.maxMp,
    avatarImageUrl: null,
    avatarFrameImageUrl: null,
  }));
  if (!participants.some((participant) => participant.playerId === context.playerId)) {
    participants.push({
      playerId: context.playerId,
      playerName: context.playerName,
      slot: participants.length,
      hp: 1,
      maxHp: 1,
      mp: 0,
      maxMp: 0,
      avatarImageUrl: null,
      avatarFrameImageUrl: null,
    });
  }
  const bossUnit: CombatUnit = {
    id: `boss:${instance?.id || monsterId}`,
    name: monster?.name || "世界首领",
    isPlayer: false,
    realm: monster?.level || 1,
    avatarImageUrl: monster?.iconUrl || null,
    avatarFrameImageUrl: null,
    hp: instance?.currentHp ?? monster?.hp ?? 1,
    maxHp: instance?.maxHp ?? monster?.hp ?? 1,
    mp: 100,
    maxMp: 100,
    attack: monster?.attack || 1,
    defense: monster?.defense || 0,
    speed: monster?.speed || 1,
    luck: monster?.luck || 0,
    spiritualSense: monster?.spiritualSense || 0,
    armorPenetration: monster?.armorPenetration || 0,
    block: monster?.block || 0,
    skillDamageBonus: monster?.skillDamageBonus || 0,
    skillDamageReduction: monster?.skillDamageReduction || 0,
    artifactDamageBonus: monster?.artifactDamageBonus || 0,
    artifactDamageReduction: monster?.artifactDamageReduction || 0,
    skills: Array.isArray(monster?.skills) ? monster.skills : [],
    skillCooldowns: {},
    activeEffects: [],
    isStunned: false,
  };
  const entities: CombatSceneEntity[] = [
    unitToEntity({
      unit: bossUnit,
      role: "boss",
      fallback: { x: 50, y: 22 },
    }),
    ...participants.map((participant, index) => ({
      id: participant.playerId,
      kind: "combatant",
      role: "player",
      name: participant.playerName,
      x: index === 0 ? 50 : index === 1 ? 26 : 74,
      y: index === 0 ? 72 : 66,
      velocityX: 0,
      velocityY: 0,
      updatedAt: Date.now(),
      hp: participant.hp,
      maxHp: participant.maxHp,
      mp: participant.mp,
      maxMp: participant.maxMp,
      isCurrent: participant.playerId === context.playerId,
    } satisfies CombatSceneEntity)),
  ];
  const battleView = buildBossBattleViewState({
    runtimeId: bossCombatId,
    bossName: bossUnit.name,
    currentHp: bossUnit.hp,
    maxHp: bossUnit.maxHp,
    participants,
    viewerPlayerId: context.playerId,
    modePayload: {
      instanceId: instance?.id || null,
      monsterId,
      status: instance?.status || (bossUnit.hp > 0 ? "alive" : "dead"),
      lastHitPlayerId: instance?.lastHitPlayerId || null,
      damageMap,
      nextSpawnAt: instance?.nextSpawnAt || null,
    },
  });
  const battleRuntime = buildBattleRuntimeFromBattleView({
    battleView,
    sceneSnapshot: null,
    payload: battleView.modePayload,
  });
  return {
    mode: "boss" as const,
    source: "boss_instance" as const,
    entities,
    authoritativeState: createAuthoritativeState({
      mode: "boss",
      source: "boss_instance",
      entities,
      battleView,
      battleRuntime,
      participants,
      claimState: {
        damageMap,
        rewardClaim,
        viewerDamage: typeof damageMap[context.playerId] === "number" ? damageMap[context.playerId] : 0,
        viewerClaimStatus: rewardClaim?.status || null,
        viewerClaimedAt: rewardClaim?.claimedAt || null,
        lastHitPlayerId: instance?.lastHitPlayerId || null,
        status: instance?.status || "unknown",
      },
    }),
  } satisfies CombatRuntimeHydrationResult;
}

async function hydratePvpRoom(context: CombatRuntimeHydrationContext) {
  if (!context.combatId || context.mode !== "pvp") {
    return null;
  }
  const {
    buildPvpViewerSceneData,
    syncPvpCombatRuntime,
  } = await import("../../../src/modules/combat/services/pvp-runtime-service");
  await syncPvpCombatRuntime(context.combatId, { maxTimeoutSteps: 2 }).catch(() => null);
  const data = buildPvpViewerSceneData(context.combatId, context.playerId);
  if (!data) {
    return null;
  }
  const state = cloneUnknown(data.state);
  const sceneSnapshot = cloneUnknown(data.sceneSnapshot);
  const entities = stateToCombatEntities({
    state,
    snapshot: sceneSnapshot,
    viewerPlayerId: context.playerId,
    mode: "pvp",
  });
  return {
    mode: "pvp" as const,
    source: "pvp_runtime" as const,
    entities,
    authoritativeState: createAuthoritativeState({
      mode: "pvp",
      source: "pvp_runtime",
      entities,
      state,
      sceneSnapshot,
      battleView: cloneUnknown(data.battleView),
      battleRuntime: cloneUnknown(data.battleRuntime),
      turnState: cloneUnknown(data.turnState),
      settlement: cloneUnknown(data.settlement),
      skillsData: data.battleView?.modePayload && typeof data.battleView.modePayload === "object"
        ? (data.battleView.modePayload as Record<string, unknown>).skillsData
        : undefined,
      matchContext: {
        combatId: data.runtime.combatId,
        mapId: data.runtime.mapId,
        challengerPlayerId: data.runtime.challengerPlayerId,
        targetPlayerId: data.runtime.targetPlayerId,
        rankingContext: {
          status: "not_configured",
          reason: "当前仓库尚未提供 PVP 排名/elo schema 或 service，Colyseus 只透出真实匹配与 runtime 上下文。",
        },
        timeout: data.runtime.turnState,
      },
      timeoutDecision: data.runtime.turnState,
    }),
  } satisfies CombatRuntimeHydrationResult;
}

function createFallbackRuntime(context: CombatRuntimeHydrationContext): CombatRuntimeHydrationResult {
  const entities: CombatSceneEntity[] = [{
    id: context.playerId,
    kind: "combatant",
    role: "player",
    name: context.playerName || context.playerId,
    x: 50,
    y: 76,
    velocityX: 0,
    velocityY: 0,
    updatedAt: Date.now(),
    isCurrent: true,
  }];
  return {
    mode: context.mode,
    source: "fallback",
    entities,
    authoritativeState: createAuthoritativeState({
      mode: context.mode,
      source: "fallback",
      entities,
    }),
  };
}

async function tryHydrateCombatRuntime(
  source: string,
  context: CombatRuntimeHydrationContext,
  hydrate: () => Promise<CombatRuntimeHydrationResult | null>,
) {
  try {
    return await hydrate();
  } catch (error) {
    console.warn("[game-server] combat runtime source degraded", {
      source,
      mode: context.mode,
      combatId: context.combatId,
      partyId: context.partyId,
      reason: error instanceof Error ? error.message : "runtime_hydration_failed",
    });
    return null;
  }
}

export async function hydrateCombatRuntime(context: CombatRuntimeHydrationContext) {
  const result = await tryHydrateCombatRuntime("party_encounter", context, () => hydratePartyCombat(context))
    || await tryHydrateCombatRuntime("pending_combat", context, () => hydratePendingCombat(context))
    || await tryHydrateCombatRuntime("boss_instance", context, () => hydrateBossRoom(context))
    || await tryHydrateCombatRuntime("pvp_runtime", context, () => hydratePvpRoom(context));
  return result || createFallbackRuntime(context);
}
