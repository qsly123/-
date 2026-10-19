import { createGameServer } from "./server";
import { Client as ColyseusSdkClient, type Room as ColyseusSdkRoom } from "@colyseus/sdk";
import { BossRoom } from "./rooms/boss-room";
import { CombatRoom } from "./rooms/combat-room";
import { PvpRoom } from "./rooms/pvp-room";
import { SocialRoom } from "./rooms/social-room";
import { WorldMapRoom } from "./rooms/world-map-room";
import { GameEntityState, GameRoomState } from "./state";
import {
  calculateBattleDamage,
  buildCombatDamageCalculator,
  createBattleDropIntent,
  createBattleRewardIntent,
  createBattleSettlementIntent,
  decideBattleMovement,
  decideCombatCommand,
  decideGridMovement,
  decidePvpTimeoutAdvance,
  getBattleRuntimeRuleset,
  getBattleRuleset,
  normalizeCombatDamageFormula,
} from "@immortality/game-rules";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  validateRealtimeClientInput,
} from "@immortality/shared-protocol";
import { authenticateGameRoomJoin, normalizeJoinRoomOptions, parseCookieHeader } from "./auth";
import { loadWorldMapRoomData, type WorldMapEntityRecord } from "./world-map-data";
import {
  createWorldMapAoiState,
  createWorldMapSectorDelta,
} from "./world-map-aoi";
import { createCombatState } from "../../../src/modules/combat/services/combat";
import {
  getPendingCombatSession,
  setPendingCombatSession,
  updatePendingCombatSessionState,
} from "../../../src/modules/combat/services/pending-combat-session";
import type { CombatUnit } from "../../../src/types/game";

type SmokeClient = Parameters<WorldMapRoom["onJoin"]>[0];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function waitForSdkMessage<TPayload>(
  room: ColyseusSdkRoom,
  type: string,
  predicate: (payload: TPayload) => boolean,
  timeoutMs = 2500,
) {
  return new Promise<TPayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for SDK message ${type}`));
    }, timeoutMs);

    const unsubscribe = room.onMessage<TPayload>(type, (payload) => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload);
    });
  });
}

function waitForAsyncHandlers() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitForCondition(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1000,
  intervalMs = 10,
) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function createSmokeCombatUnit(params: {
  id: string;
  name: string;
  isPlayer: boolean;
  hp?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  skills?: string[];
}): CombatUnit {
  const hp = params.hp ?? 100;
  return {
    id: params.id,
    name: params.name,
    isPlayer: params.isPlayer,
    hp,
    maxHp: hp,
    mp: 100,
    maxMp: 100,
    attack: params.attack ?? 20,
    defense: params.defense ?? 5,
    speed: params.speed ?? 10,
    luck: 0,
    spiritualSense: 0,
    armorPenetration: 0,
    block: 0,
    skillDamageBonus: 0,
    skillDamageReduction: 0,
    artifactDamageBonus: 0,
    artifactDamageReduction: 0,
    skills: params.skills || [],
    skillCooldowns: {},
    activeEffects: [],
    isStunned: false,
  };
}

function isolateSmokeExternalServices() {
  if (process.env.GAME_SMOKE_USE_EXTERNAL_SERVICES === "1") {
    return;
  }
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
}

function smokeMovementRules() {
  const invalidNaN = decideGridMovement({
    from: { x: 0, y: 0 },
    to: { x: Number.NaN, y: 0 },
  });
  assert(!invalidNaN.accepted && invalidNaN.reason === "invalid_position", "NaN movement must be rejected");

  const invalidFraction = decideGridMovement({
    from: { x: 0, y: 0 },
    to: { x: 0.5, y: 0 },
  });
  assert(!invalidFraction.accepted && invalidFraction.reason === "invalid_position", "fractional grid movement must be rejected");

  const occupied = decideGridMovement({
    from: { x: 0, y: 0 },
    to: { x: 1, y: 0 },
    occupiedTiles: new Set(["1:0"]),
  });
  assert(!occupied.accepted && occupied.reason === "blocked", "occupied movement must be rejected");

  const diagonalAdjacent = decideGridMovement({
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
  });
  assert(diagonalAdjacent.accepted, "adjacent diagonal movement must match legacy H5 map movement");

  const diagonalTooFar = decideGridMovement({
    from: { x: 0, y: 0 },
    to: { x: 2, y: 1 },
  });
  assert(!diagonalTooFar.accepted && diagonalTooFar.reason === "too_far", "diagonal movement beyond one tile must be rejected");

  const diagonalCornerCut = decideGridMovement({
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
    blockedTiles: new Set(["1:0"]),
  });
  assert(!diagonalCornerCut.accepted && diagonalCornerCut.reason === "blocked", "diagonal movement must not cut through blocking corners");
}

function smokeBattleRules() {
  const soloRuleset = getBattleRuleset("solo");
  const pvpRuleset = getBattleRuleset("pvp");

  const acceptedCommand = decideCombatCommand({
    actorId: "actor",
    targetId: "target",
    commandType: "basicAttack",
    nowMs: Date.now(),
    ruleset: soloRuleset,
    distance: {
      dx: 1,
      dy: 1,
      direct: 1.4,
    },
  });
  assert(acceptedCommand.accepted, "basic attack with target in range must be accepted");

  const missingTarget = decideCombatCommand({
    actorId: "actor",
    commandType: "skill",
    nowMs: Date.now(),
    ruleset: soloRuleset,
  });
  assert(!missingTarget.accepted && missingTarget.reason === "missing_target", "skill without target must be rejected");

  const outOfRange = decideCombatCommand({
    actorId: "actor",
    targetId: "target",
    commandType: "basicAttack",
    nowMs: Date.now(),
    ruleset: soloRuleset,
    distance: {
      dx: 99,
      dy: 0,
      direct: 99,
    },
  });
  assert(!outOfRange.accepted && outOfRange.reason === "out_of_range", "out-of-range attack must be rejected");

  const movement = decideBattleMovement({
    ruleset: soloRuleset,
    from: { x: 50, y: 76 },
    to: { x: 53.5, y: 76 },
  });
  assert(movement.accepted && movement.position.x === 53.5, "battle movement must support percent coordinates");

  const damage = calculateBattleDamage({
    attack: 10,
    defense: 5,
  });
  assert(damage.damage > 0 && damage.effectiveDefense === 5, "battle damage must produce positive damage");

  const formulaCalculator = buildCombatDamageCalculator("max(1, atk + base - def)");
  assert(
    formulaCalculator({
      atk: 10,
      def: 3,
      base: 2,
      mul: 1,
      rand: 1,
      speed: 0,
      luck: 0,
      spiritualSense: 0,
      armorPenetration: 0,
      block: 0,
      senseDiff: 0,
      effectiveDef: 3,
    }) === 9,
    "shared damage formula calculator must evaluate configured formulas",
  );
  assert(
    normalizeCombatDamageFormula("") === normalizeCombatDamageFormula(null),
    "empty damage formula must normalize to default formula",
  );

  const runtimeRuleset = getBattleRuntimeRuleset("solo");
  assert(runtimeRuleset.allowedCommands.includes("cast_skill"), "runtime ruleset must keep legacy cast_skill command");
  assert(runtimeRuleset.spatialPolicy?.defaultContactRangePercent === 10, "runtime ruleset must preserve legacy solo contact range");

  const settlement = createBattleSettlementIntent({
    battleId: "battle-1",
    mode: "solo",
    winnerId: "winner",
    loserId: "loser",
    reason: "victory",
    occurredAt: 1,
  });
  assert(settlement.idempotencyKey.includes("battle-1"), "settlement intent must include stable battle id");
  const duplicateSettlement = createBattleSettlementIntent({
    battleId: "battle-1",
    mode: "solo",
    winnerId: "winner",
    loserId: "loser",
    reason: "victory",
    occurredAt: 999,
  });
  assert(
    duplicateSettlement.idempotencyKey === settlement.idempotencyKey,
    "settlement intent idempotency key must be stable across retries",
  );
  const rewardIntent = createBattleRewardIntent({
    battleId: "battle-1",
    mode: "solo",
    playerId: "winner",
    reason: "victory",
    xp: 10,
    gold: 5,
  });
  assert(rewardIntent.idempotencyKey.includes("battle-1"), "reward intent must include stable battle id");
  assert(rewardIntent.xp === 10 && rewardIntent.gold === 5, "reward intent must carry reward totals");
  const dropIntent = createBattleDropIntent({
    battleId: "battle-1",
    mode: "solo",
    playerId: "winner",
    reason: "victory",
    items: [{ itemId: "item-1", quantity: 2, reason: "guaranteed" }],
  });
  assert(dropIntent.items.length === 1 && dropIntent.items[0]?.quantity === 2, "drop intent must carry drop items");

  const timeout = decidePvpTimeoutAdvance({
    ruleset: pvpRuleset,
    nowMs: 20_000,
    lastInputAtMs: 0,
  });
  assert(timeout.shouldAdvance && timeout.reason === "timeout", "pvp timeout must advance when overdue");
}

function smokeInputValidation() {
  const invalidMissingMeta = validateRealtimeClientInput({
    inputType: "move",
    payload: { x: 1, y: 0 },
  });
  assert(!invalidMissingMeta.ok, "input without required realtime metadata must be rejected");
  assert(invalidMissingMeta.ack.reason === "invalid_input", "invalid metadata must return invalid_input");

  const validInput = validateRealtimeClientInput({
    clientSequence: 1,
    clientSceneTick: 0,
    actionId: "smoke-valid-input",
    clientSentAt: Date.now(),
    inputType: "move",
    payload: { x: 1, y: 0 },
  });
  assert(validInput.ok && validInput.input.inputType === "move", "valid realtime input must pass validation");
}

async function smokeJoinAuthHelpers() {
  const normalized = normalizeJoinRoomOptions({
    mapId: "world-1",
    shardId: "shard-1",
    playerId: "player-1",
    partyId: "party-1",
    sectId: "sect-1",
  });
  assert(normalized.mapId === "world-1", "valid mapId must survive join normalization");
  assert(normalized.playerId === "player-1", "valid playerId must survive join normalization");
  assert(normalized.partyId === "party-1", "valid partyId must survive join normalization");
  assert(normalized.sectId === "sect-1", "valid sectId must survive join normalization");

  const invalid = normalizeJoinRoomOptions({
    mapId: "../bad",
    playerId: "bad player",
  });
  assert(invalid.mapId === "default", "invalid mapId must fall back to default");
  assert(!invalid.playerId, "invalid playerId must be dropped");

  const cookies = parseCookieHeader("a=1; immortality_session=s1; immortality_session=s2; immortality_active_player=p1");
  assert(cookies.get("immortality_session")?.at(-1) === "s2", "cookie parser must keep latest duplicate value");
  assert(cookies.get("immortality_active_player")?.at(-1) === "p1", "cookie parser must read active player");

  const auth = await authenticateGameRoomJoin({
    options: { mapId: "world-1" },
    fallbackPlayerId: "smoke-client",
    authMode: "optional",
    context: {
      headers: new Headers(),
      ip: "127.0.0.1",
    },
  });
  assert(!auth.authenticated, "optional auth without cookies must create fallback auth");
  assert(auth.playerId === "smoke-client", "fallback auth must use client session id");

  let mismatchRejected = false;
  try {
    await authenticateGameRoomJoin({
      options: {
        sessionToken: "session-1",
        playerId: "player-from-options",
      },
      fallbackPlayerId: "smoke-client",
      authMode: "required",
      context: {
        headers: new Headers({
          cookie: "immortality_session=session-1; immortality_active_player=player-from-cookie",
        }),
        ip: "127.0.0.1",
      },
    });
  } catch (error) {
    mismatchRejected = error instanceof Error && error.message === "game_server_player_cookie_mismatch";
  }
  assert(mismatchRejected, "join auth must reject playerId that conflicts with active player cookie");
}

function smokeRoomInvalidMoveAck() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";

  const sent: Array<{ type: string; body: { accepted?: boolean; reason?: string } }> = [];
  const client = {
    sessionId: "smoke-client",
    send(type: string, body: { accepted?: boolean; reason?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;

  room.onJoin(client, { playerId: "smoke-player" });
  room["handleRealtimeInput"](client, {
    clientSequence: 7,
    clientSceneTick: 0,
    actionId: "smoke-invalid-move",
    clientSentAt: Date.now(),
    inputType: "move",
    payload: { x: Number.NaN, y: 0 },
  });

  const ack = sent.at(-1);
  const entity = room.state.entities.get(client.sessionId);
  assert(ack?.type === "ack", "invalid move must return an ack");
  assert(ack.body.accepted === false, "invalid move ack must be rejected");
  assert(ack.body.reason === "invalid_position", "invalid move ack must expose invalid_position");
  assert(entity?.x === 0 && entity.y === 0, "invalid move must not mutate authoritative position");
}

function smokeRoomOutOfBoundsMoveAck() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";
  room.state.mapWidth = 1;
  room.state.mapHeight = 1;

  const sent: Array<{ type: string; body: { accepted?: boolean; reason?: string } }> = [];
  const client = {
    sessionId: "smoke-client",
    send(type: string, body: { accepted?: boolean; reason?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;

  room.onJoin(client, { playerId: "smoke-player" });
  room["handleRealtimeInput"](client, {
    clientSequence: 8,
    clientSceneTick: 0,
    actionId: "smoke-out-of-bounds-move",
    clientSentAt: Date.now(),
    inputType: "move",
    payload: { x: 1, y: 0 },
  });

  const ack = sent.at(-1);
  const entity = room.state.entities.get(client.sessionId);
  assert(ack?.type === "ack", "out-of-bounds move must return an ack");
  assert(ack.body.accepted === false, "out-of-bounds move ack must be rejected");
  assert(ack.body.reason === "out_of_bounds", "out-of-bounds move ack must expose out_of_bounds");
  assert(entity?.x === 0 && entity.y === 0, "out-of-bounds move must not mutate authoritative position");
}

function smokeRoomAcceptedAndBlockedMoveAck() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";
  room.state.mapWidth = 4;
  room.state.mapHeight = 4;

  const monster = createSmokeEntity({
    id: "monster:blocker",
    kind: "monster",
    x: 2,
    y: 0,
  });
  room.state.entities.set("monster-session", monster);

  const sent: Array<{ type: string; body: { accepted?: boolean; reason?: string; acceptedSequence?: number } }> = [];
  const client = {
    sessionId: "smoke-client",
    send(type: string, body: { accepted?: boolean; reason?: string; acceptedSequence?: number }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;

  room.onJoin(client, { playerId: "smoke-player" });
  room["handleRealtimeInput"](client, {
    clientSequence: 81,
    clientSceneTick: 0,
    actionId: "smoke-accepted-move",
    clientSentAt: Date.now(),
    inputType: "move",
    payload: { x: 1, y: 0 },
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 82,
    clientSceneTick: 0,
    actionId: "smoke-blocked-move",
    clientSentAt: Date.now(),
    inputType: "move",
    payload: { x: 2, y: 0 },
  });

  const entity = room.state.entities.get(client.sessionId);
  const ackBySequence = new Map(sent
    .filter((message) => message.type === "ack")
    .map((message) => [message.body.acceptedSequence, message.body]));
  assert(ackBySequence.get(81)?.accepted === true, "legal move must be accepted");
  assert(ackBySequence.get(82)?.accepted === false, "moving into monster tile must be rejected");
  assert(ackBySequence.get(82)?.reason === "blocked", "moving into monster tile must expose blocked");
  assert(entity?.x === 1 && entity.y === 0, "blocked move must keep last accepted authoritative position");
}

function createSmokeEntity(params: {
  id: string;
  kind?: string;
  x: number;
  y: number;
}) {
  const entity = new GameEntityState();
  entity.id = params.id;
  entity.kind = params.kind || "player";
  entity.name = params.id;
  entity.x = params.x;
  entity.y = params.y;
  entity.updatedAt = Date.now();
  return entity;
}

function smokeWorldMapAoiDelta() {
  const state = new GameRoomState();
  state.mapId = "smoke-map";
  state.shardId = "0";
  state.mapWidth = 128;
  state.mapHeight = 128;

  const self = createSmokeEntity({ id: "self", x: 0, y: 0 });
  const other = createSmokeEntity({ id: "monster:other", kind: "monster", x: 32, y: 0 });
  state.entities.set("self-session", self);
  state.entities.set("other-session", other);

  const previousAoi = createWorldMapAoiState({
    self,
    entities: state.entities.values(),
  });
  self.x = 16;
  const nextAoi = createWorldMapAoiState({
    self,
    entities: state.entities.values(),
  });
  const delta = createWorldMapSectorDelta({
    roomId: "smoke-room",
    roomState: state,
    previousAoi,
    nextAoi,
    acceptedSequence: 9,
  });

  assert(delta?.type === "sector_delta", "AOI sector change must create sector_delta");
  assert(delta.acceptedSequence === 9, "AOI delta must carry accepted sequence");
  assert(delta.events.some((event) => (
    event.type === "entity_enter"
    && event.entity.id === "monster:other"
    && event.entity.kind === "monster"
  )), "AOI delta must include monster entity_enter");
}

function smokeWorldMapSameAoiEntityUpdateDelta() {
  const state = new GameRoomState();
  state.mapId = "smoke-map";
  state.shardId = "0";
  state.mapWidth = 128;
  state.mapHeight = 128;

  const self = createSmokeEntity({ id: "self", x: 0, y: 0 });
  const other = createSmokeEntity({ id: "other", x: 1, y: 0 });
  state.entities.set("self-session", self);
  state.entities.set("other-session", other);

  const previousAoi = createWorldMapAoiState({
    self,
    entities: state.entities.values(),
  });
  other.x = 2;
  other.velocityX = 1;
  other.updatedAt = Date.now() + 1;
  state.snapshotVersion += 1;

  const nextAoi = createWorldMapAoiState({
    self,
    entities: state.entities.values(),
  });
  const delta = createWorldMapSectorDelta({
    roomId: "smoke-room",
    roomState: state,
    previousAoi,
    nextAoi,
    acceptedSequence: 91,
  });

  assert(delta?.type === "sector_delta", "same-AOI entity movement must create sector_delta");
  assert(delta.events.some((event) => (
    event.type === "entity_update"
    && event.entity.id === "other"
    && event.entity.x === 2
  )), "same-AOI entity movement must include entity_update");
}

async function smokeRoomJoinSectorSnapshot() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";
  room.state.mapWidth = 64;
  room.state.mapHeight = 64;

  const records: WorldMapEntityRecord[] = [
    {
      id: "npc:smoke-npc",
      kind: "npc",
      name: "smoke-npc",
      positionX: 1,
      positionY: 0,
    },
    {
      id: "monster:smoke-monster",
      kind: "monster",
      name: "smoke-monster",
      positionX: 2,
      positionY: 0,
    },
    {
      id: "opportunity:smoke-opportunity",
      kind: "opportunity",
      name: "smoke-opportunity",
      positionX: 3,
      positionY: 0,
    },
    {
      id: "portal:smoke-portal",
      kind: "portal",
      name: "smoke-portal",
      positionX: 4,
      positionY: 0,
    },
    {
      id: "secret_realm:smoke-secret-realm",
      kind: "secret_realm",
      name: "smoke-secret-realm",
      positionX: 5,
      positionY: 0,
    },
    {
      id: "reputation_event:smoke-reputation",
      kind: "reputation_event",
      name: "smoke-reputation",
      positionX: 6,
      positionY: 0,
    },
    {
      id: "world_commission:smoke-commission",
      kind: "world_commission",
      name: "smoke-commission",
      positionX: 7,
      positionY: 0,
    },
    {
      id: "sect_home:smoke-sect",
      kind: "sect_home",
      name: "smoke-sect",
      positionX: 8,
      positionY: 0,
    },
  ];
  (room as unknown as { applyStaticMapEntities(records: WorldMapEntityRecord[]): void })
    .applyStaticMapEntities(records);

  const sent: Array<{
    type: string;
    body: {
      type?: string;
      authoritativeState?: {
        entities?: Array<{ id: string; kind: string }>;
      };
    };
  }> = [];
  const client = {
    sessionId: "smoke-client",
    send(type: string, body: { type?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;
  room.clients.push(client);

  await room.onJoin(client, { playerId: "smoke-player" });
  await waitForCondition(
    () => sent.some((message) => message.type === "sector_snapshot" && message.body.type === "sector_snapshot"),
    "joining WorldMapRoom must send sector_snapshot",
  );
  const snapshot = sent.find((message) => message.type === "sector_snapshot" && message.body.type === "sector_snapshot");
  assert(snapshot, "joining WorldMapRoom must send sector_snapshot");
  const visibleEntities = snapshot.body.authoritativeState?.entities || [];
  assert(visibleEntities.some((entity) => entity.id === "npc:smoke-npc" && entity.kind === "npc"), "sector_snapshot must include visible npc");
  assert(visibleEntities.some((entity) => entity.id === "monster:smoke-monster" && entity.kind === "monster"), "sector_snapshot must include visible monster");
  assert(visibleEntities.some((entity) => entity.id === "opportunity:smoke-opportunity" && entity.kind === "opportunity"), "sector_snapshot must include visible opportunity");
  assert(visibleEntities.some((entity) => entity.id === "portal:smoke-portal" && entity.kind === "portal"), "sector_snapshot must include visible portal");
  assert(visibleEntities.some((entity) => entity.id === "secret_realm:smoke-secret-realm" && entity.kind === "secret_realm"), "sector_snapshot must include visible secret realm");
  assert(visibleEntities.some((entity) => entity.id === "reputation_event:smoke-reputation" && entity.kind === "reputation_event"), "sector_snapshot must include visible reputation event");
  assert(visibleEntities.some((entity) => entity.id === "world_commission:smoke-commission" && entity.kind === "world_commission"), "sector_snapshot must include visible world commission");
  assert(visibleEntities.some((entity) => entity.id === "sect_home:smoke-sect" && entity.kind === "sect_home"), "sector_snapshot must include visible sect home");
}

function smokeWorldMapRefreshedEntityVelocity() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";
  room.state.mapWidth = 64;
  room.state.mapHeight = 64;

  const records: WorldMapEntityRecord[] = [{
    id: "npc:moving",
    kind: "npc",
    name: "moving",
    positionX: 1,
    positionY: 1,
  }];
  const applyStaticMapEntities = (room as unknown as {
    applyStaticMapEntities(records: WorldMapEntityRecord[]): void;
  }).applyStaticMapEntities.bind(room);
  applyStaticMapEntities(records);
  applyStaticMapEntities([{
    ...records[0],
    positionX: 3,
    positionY: 2,
  }]);

  const entity = room.state.entities.get("npc:moving");
  assert(entity?.x === 3 && entity.y === 2, "refreshed static entity must keep latest position");
  assert(entity.velocityX === 2 && entity.velocityY === 1, "refreshed static entity must expose movement velocity");
}

function smokeRoomRepairSectorSnapshot() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";
  room.state.mapWidth = 64;
  room.state.mapHeight = 64;

  const sent: Array<{
    type: string;
    body: {
      accepted?: boolean;
      acceptedSequence?: number | null;
      type?: string;
    };
  }> = [];
  const client = {
    sessionId: "smoke-client",
    send(type: string, body: { accepted?: boolean; acceptedSequence?: number | null; type?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;

  room.onJoin(client, { playerId: "smoke-player" });
  room["handleRealtimeInput"](client, {
    clientSequence: 10,
    clientSceneTick: 0,
    actionId: "smoke-repair",
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  });

  assert(sent.some((message) => (
    message.type === "ack"
    && message.body.accepted === true
    && message.body.acceptedSequence === 10
  )), "repair input must return accepted ack");
  assert(sent.some((message) => (
    message.type === "sector_snapshot"
    && message.body.type === "sector_snapshot"
    && message.body.acceptedSequence === 10
  )), "repair input must return sector_snapshot with accepted sequence");
}

function smokeRoomInteractAndTravelAcks() {
  const room = new WorldMapRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "world_map";
  room.state.mapId = "smoke-map";
  room.state.shardId = "0";
  room.state.mapWidth = 64;
  room.state.mapHeight = 64;

  const records: WorldMapEntityRecord[] = [
    {
      id: "portal:near",
      kind: "portal",
      name: "near",
      positionX: 1,
      positionY: 0,
    },
    {
      id: "opportunity:far",
      kind: "opportunity",
      name: "far",
      positionX: 10,
      positionY: 0,
    },
  ];
  (room as unknown as { applyStaticMapEntities(records: WorldMapEntityRecord[]): void })
    .applyStaticMapEntities(records);

  const sent: Array<{ type: string; body: { accepted?: boolean; reason?: string; acceptedSequence?: number } }> = [];
  const client = {
    sessionId: "smoke-client",
    send(type: string, body: { accepted?: boolean; reason?: string; acceptedSequence?: number }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;

  room.onJoin(client, { playerId: "smoke-player" });

  room["handleRealtimeInput"](client, {
    clientSequence: 11,
    clientSceneTick: 0,
    actionId: "smoke-interact-invalid",
    clientSentAt: Date.now(),
    inputType: "interact",
    payload: {},
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 12,
    clientSceneTick: 0,
    actionId: "smoke-interact-missing",
    clientSentAt: Date.now(),
    inputType: "interact",
    payload: { entityId: "missing" },
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 13,
    clientSceneTick: 0,
    actionId: "smoke-interact-far",
    clientSentAt: Date.now(),
    inputType: "interact",
    payload: { entityId: "opportunity:far" },
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 15,
    clientSceneTick: 0,
    actionId: "smoke-travel-invalid",
    clientSentAt: Date.now(),
    inputType: "travel",
    payload: {},
  });
  const ackBySequence = new Map(sent
    .filter((message) => message.type === "ack")
    .map((message) => [message.body.acceptedSequence, message.body]));
  assert(ackBySequence.get(11)?.reason === "invalid_payload", "invalid interact payload must be rejected");
  assert(ackBySequence.get(12)?.reason === "target_missing", "missing interact target must be rejected");
  assert(ackBySequence.get(13)?.reason === "too_far", "far interact target must be rejected");
  assert(ackBySequence.get(15)?.reason === "invalid_payload", "invalid travel payload must be rejected");
}

function smokeSocialRoomPresenceAndNearbyMessage() {
  const room = new SocialRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "social";
  room.state.mapId = "world-1";
  room.state.shardId = "0";

  const sentA: Array<{
    type: string;
    body: {
      accepted?: boolean;
      acceptedSequence?: number;
      reason?: string;
      type?: string;
      authoritativeState?: {
        nearbyPlayers?: Array<{ playerId: string }>;
        partyMembers?: Array<{ playerId: string }>;
        sectMembers?: Array<{ playerId: string }>;
        migrationNote?: string;
      };
      events?: Array<{ type?: string; message?: string }>;
    };
  }> = [];
  const sentB: typeof sentA = [];
  const clientA = {
    sessionId: "social-a",
    send(type: string, body: typeof sentA[number]["body"]) {
      sentA.push({ type, body });
    },
  } as unknown as SmokeClient;
  const clientB = {
    sessionId: "social-b",
    send(type: string, body: typeof sentA[number]["body"]) {
      sentB.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [clientA, clientB],
    configurable: true,
  });

  room.onJoin(clientA, {
    playerId: "player-a",
    mapId: "world-1",
    shardId: "0",
    partyId: "party-1",
    sectId: "sect-1",
  });
  room.onJoin(clientB, {
    playerId: "player-b",
    mapId: "world-1",
    shardId: "0",
    partyId: "party-1",
    sectId: "sect-1",
  });
  room["handleRealtimeInput"](clientA, {
    clientSequence: 301,
    clientSceneTick: 0,
    actionId: "smoke-social-repair",
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  });
  room["handleRealtimeInput"](clientA, {
    clientSequence: 302,
    clientSceneTick: 0,
    actionId: "smoke-social-nearby",
    clientSentAt: Date.now(),
    inputType: "nearbyMessage",
    payload: { message: "hello nearby" },
  });
  room["handleRealtimeInput"](clientA, {
    clientSequence: 303,
    clientSceneTick: 0,
    actionId: "smoke-social-party-command",
    clientSentAt: Date.now(),
    inputType: "partyCommand",
    payload: { command: "leave" },
  });

  const repairAck = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 301);
  assert(repairAck?.body.accepted === true, "social repair must return accepted ack");
  assert(
    repairAck.body.authoritativeState?.nearbyPlayers?.some((player) => player.playerId === "player-b"),
    "social repair must include nearby same-map player",
  );
  assert(
    repairAck.body.authoritativeState?.partyMembers?.some((player) => player.playerId === "player-b"),
    "social repair must include same-party presence",
  );
  assert(
    repairAck.body.authoritativeState?.sectMembers?.some((player) => player.playerId === "player-b"),
    "social repair must include same-sect presence",
  );

  const nearbyAck = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 302);
  assert(nearbyAck?.body.accepted === true, "nearby message must return accepted ack");
  // P2-A 边界：房间只广播 nearby_chat_echo 回声帧（不写库），持久化由核心 API + SSE 负责。
  const nearbyEcho = sentB.find((message) => message.type === "nearby_chat_echo") as {
    body?: { content?: string };
  } | undefined;
  assert(nearbyEcho?.body?.content === "hello nearby", "nearby message must broadcast echo to same map shard");
  assert(!sentB.some((message) => (
    message.type === "social_event"
    && message.body.events?.some((event) => event.type === "nearby_message")
  )), "nearby message must not duplicate via social_event");

  const partyAck = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 303);
  assert(partyAck?.body.accepted === false, "party business command must not fake DB success yet");
  assert(partyAck.body.reason === "unsupported_input", "party business command must return explicit unsupported ack");
  assert(Boolean(partyAck.body.authoritativeState?.migrationNote), "party command ack must explain low-frequency API boundary");
}

async function smokeCombatRoomAcks() {
  const room = new CombatRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "combat";

  const sent: Array<{ type: string; body: { accepted?: boolean; reason?: string; acceptedSequence?: number; authoritativeState?: Record<string, unknown>; type?: string } }> = [];
  const client = {
    sessionId: "smoke-combat-client",
    send(type: string, body: { accepted?: boolean; reason?: string; acceptedSequence?: number; authoritativeState?: Record<string, unknown>; type?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [client],
    configurable: true,
  });

  room.onJoin(client, { playerId: "smoke-combat-player" });
  const target = createSmokeEntity({
    id: "enemy",
    kind: "combatant",
    x: 50,
    y: 70,
  });
  room.state.entities.set("enemy-session", target);

  room["handleRealtimeInput"](client, {
    clientSequence: 201,
    clientSceneTick: 0,
    actionId: "smoke-combat-move",
    clientSentAt: Date.now(),
    inputType: "movement",
    payload: { x: 51.5, y: 76 },
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 202,
    clientSceneTick: 0,
    actionId: "smoke-combat-missing-target",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "skill" },
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 203,
    clientSceneTick: 0,
    actionId: "smoke-combat-basic",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "basicAttack", targetId: "enemy" },
  });
  room["handleRealtimeInput"](client, {
    clientSequence: 204,
    clientSceneTick: 0,
    actionId: "smoke-combat-flee",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "flee" },
  });
  await waitForAsyncHandlers();

  const ackBySequence = new Map(sent
    .filter((message) => message.type === "ack")
    .map((message) => [message.body.acceptedSequence, message.body]));
  assert(
    ackBySequence.get(201)?.accepted === false && ackBySequence.get(201)?.reason === "invalid_payload",
    "combat movement without solo runtime must be rejected without timing out",
  );
  assert(ackBySequence.get(202)?.accepted === false && ackBySequence.get(202)?.reason === "missing_target", "combat skill without target must be rejected");
  assert(
    ackBySequence.get(203)?.accepted === false && ackBySequence.get(203)?.reason === "invalid_payload",
    "combat basic attack without solo runtime must be rejected without fallback intent",
  );
  assert(
    ackBySequence.get(204)?.accepted === false && ackBySequence.get(204)?.reason === "invalid_payload",
    "combat flee without solo runtime must be rejected without fallback settlement",
  );
  assert(
    ackBySequence.get(204)?.authoritativeState?.acceptedClientSequence === 204,
    "combat missing-runtime reject must carry current input sequence plus server accepted marker",
  );
  assert(
    !ackBySequence.get(204)?.authoritativeState?.settlementIntent,
    "combat missing-runtime flee must not create settlement intent",
  );
}

async function smokeCombatRoomSoloRuntimeCommand() {
  const combatId = "smoke-solo-runtime-combat";
  const playerId = "smoke-solo-runtime-player";
  const enemyId = "smoke-solo-runtime-enemy";
  const skillId = "smoke-solo-runtime-skill";
  const state = createCombatState(
    combatId,
    createSmokeCombatUnit({
      id: playerId,
      name: "烟测玩家",
      isPlayer: true,
      attack: 40,
      speed: 20,
      skills: [skillId],
    }),
    createSmokeCombatUnit({
      id: enemyId,
      name: "烟测敌人",
      isPlayer: false,
      hp: 320,
      defense: 1,
      speed: 1,
      skills: [],
    }),
  );
  setPendingCombatSession(playerId, {
    combatId,
    monsterId: enemyId,
    state,
    skillsData: {
      [skillId]: {
        name: "烟测神通",
        skillType: "attack",
        damageBase: 12,
        damageMultiplier: 1.2,
        mpCost: 0,
        cooldown: 0,
        effects: [],
        target: "enemy",
      },
    },
  });

  const room = new CombatRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "combat";
  Object.defineProperty(room, "roomId", {
    value: "smoke-solo-runtime-room",
    configurable: true,
  });

  const sent: Array<{ type: string; body: { accepted?: boolean; acceptedSequence?: number; authoritativeState?: Record<string, unknown>; type?: string } }> = [];
  const client = {
    sessionId: "smoke-solo-runtime-client",
    send(type: string, body: { accepted?: boolean; acceptedSequence?: number; authoritativeState?: Record<string, unknown>; type?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [client],
    configurable: true,
  });

  await room.onJoin(client, { playerId, combatId });
  for (const entity of room.state.entities.values()) {
    if (entity.id === enemyId) {
      entity.y = 70;
    }
  }

  room["handleRealtimeInput"](client, {
    clientSequence: 1,
    clientSceneTick: 0,
    actionId: "smoke-solo-runtime-move",
    clientSentAt: Date.now(),
    inputType: "movement",
    payload: { targetXPercent: 48.5, targetYPercent: 81.5 },
  });
  await waitForAsyncHandlers();

  const movedPending = getPendingCombatSession(playerId, combatId);
  const moveAck = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 1);
  assert(moveAck?.body.accepted === true, `solo CombatRoom movement must be accepted: ${JSON.stringify(sent)}`);
  assert(movedPending?.lastAcceptedClientSequence === 1, "solo CombatRoom movement must commit accepted sequence");
  assert(Boolean(movedPending?.sceneSnapshot), "solo CombatRoom movement must keep real pending combat scene snapshot");

  room["handleRealtimeInput"](client, {
    clientSequence: 2,
    clientSceneTick: movedPending?.sceneSnapshot.tick || 0,
    actionId: "smoke-solo-runtime-skill",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "skill", skillId, targetId: enemyId },
  });
  await waitForAsyncHandlers();

  const pending = getPendingCombatSession(playerId, combatId);
  const ack = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 2);
  assert(ack?.body.accepted === true, `solo CombatRoom skill command must be accepted: ${JSON.stringify(sent)}`);
  assert(pending?.state.turn === 1, "solo CombatRoom skill command must advance real pending combat turn");
  assert((pending?.state.enemy.hp ?? 320) < 320, "solo CombatRoom skill command must apply real executeTurn damage");
  assert(pending?.lastAcceptedClientSequence === 2, "solo CombatRoom skill command must commit accepted sequence");
  const ackSceneTick = Number((ack.body.authoritativeState?.sceneSnapshot as { tick?: number } | undefined)?.tick);
  assert(
    Number.isFinite(ackSceneTick) && ackSceneTick === pending.sceneSnapshot.tick,
    `solo CombatRoom skill ack scene tick must match pending runtime tick: ack=${ackSceneTick}, pending=${pending?.sceneSnapshot.tick}`,
  );
  assert(sent.some((message) => (
    message.type === "timeline_event"
    && message.body.type === "timeline_event"
    && message.body.acceptedSequence === 2
  )), "solo CombatRoom skill command must emit timeline event after real runtime execution");

  room["handleRealtimeInput"](client, {
    clientSequence: 3,
    clientSceneTick: ackSceneTick,
    actionId: "smoke-solo-runtime-followup-skill",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "skill", skillId, targetId: enemyId },
  });
  await waitForAsyncHandlers();

  const followupPending = getPendingCombatSession(playerId, combatId);
  const followupAck = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 3);
  assert(followupAck?.body.accepted === true, `solo CombatRoom follow-up skill must accept ack scene tick: ${JSON.stringify(sent)}`);
  assert(followupPending?.state.turn === 2, "solo CombatRoom follow-up skill must advance with ack scene tick");
  assert(followupPending?.lastAcceptedClientSequence === 3, "solo CombatRoom follow-up skill must commit accepted sequence");

  const delayedClientSceneTick = followupPending?.sceneSnapshot.tick || 0;
  for (let i = 0; i < 8; i += 1) {
    const currentPending = getPendingCombatSession(playerId, combatId);
    assert(currentPending, "solo CombatRoom delayed tick smoke requires pending session");
    updatePendingCombatSessionState(
      playerId,
      combatId,
      structuredClone(currentPending.state),
      { previousLogLength: currentPending.state.log.length },
    );
  }
  const advancedPending = getPendingCombatSession(playerId, combatId);
  assert(
    (advancedPending?.sceneSnapshot.tick || 0) - delayedClientSceneTick > 5,
    "solo CombatRoom smoke must advance server scene tick beyond the old five-tick stale window",
  );

  room["handleRealtimeInput"](client, {
    clientSequence: 4,
    clientSceneTick: delayedClientSceneTick,
    actionId: "smoke-solo-runtime-delayed-skill",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "skill", skillId, targetId: enemyId },
  });
  await waitForAsyncHandlers();

  const delayedAck = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 4);
  assert(delayedAck?.body.accepted === true, `solo CombatRoom command must tolerate normal runtime tick drift: ${JSON.stringify(sent)}`);

  room["handleRealtimeInput"](client, {
    clientSequence: 5,
    clientSceneTick: getPendingCombatSession(playerId, combatId)?.sceneSnapshot.tick || 0,
    actionId: "smoke-solo-runtime-surrender",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "surrender" },
  });
  await waitForAsyncHandlers();

  const surrenderedPending = getPendingCombatSession(playerId, combatId);
  const surrenderAck = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 5);
  assert(surrenderAck?.body.accepted === true, `solo CombatRoom surrender command must be accepted: ${JSON.stringify(sent)}`);
  assert(surrenderedPending?.state.status === "enemy_win", "solo CombatRoom surrender must finish pending combat as enemy_win");
  assert(surrenderedPending?.lastAcceptedClientSequence === 5, "solo CombatRoom surrender must commit accepted sequence");
  assert(
    (surrenderAck.body.authoritativeState?.settlementIntent as { reason?: string } | undefined)?.reason === "surrender",
    "solo CombatRoom surrender must return surrender settlement reason",
  );
  assert(sent.some((message) => (
    message.type === "settlement"
    && message.body.type === "settlement"
    && message.body.acceptedSequence === 5
  )), "solo CombatRoom surrender must emit settlement event");
}

async function smokePvpRoomSurrenderIntent() {
  const room = new PvpRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "pvp";

  const sent: Array<{ type: string; body: { accepted?: boolean; acceptedSequence?: number; authoritativeState?: { settlementIntent?: { reason?: string; idempotencyKey?: string }; rewardIntent?: unknown; dropIntent?: unknown; settlementPersistence?: unknown; deathPenaltyIntent?: { reason?: string } }; type?: string } }> = [];
  const client = {
    sessionId: "smoke-pvp-client",
    send(type: string, body: { accepted?: boolean; acceptedSequence?: number; authoritativeState?: { settlementIntent?: { reason?: string; idempotencyKey?: string }; rewardIntent?: unknown; dropIntent?: unknown; settlementPersistence?: unknown; deathPenaltyIntent?: { reason?: string } }; type?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [client],
    configurable: true,
  });

  room.onJoin(client, { playerId: "smoke-pvp-player" });
  room["handleRealtimeInput"](client, {
    clientSequence: 211,
    clientSceneTick: 0,
    actionId: "smoke-pvp-surrender",
    clientSentAt: Date.now(),
    inputType: "surrender",
    payload: {},
  });
  await waitForAsyncHandlers();

  const ack = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 211);
  assert(ack?.body.accepted === true, "pvp surrender must be accepted as settlement intent");
  assert(ack.body.authoritativeState?.settlementIntent?.reason === "surrender", "pvp surrender must return settlement intent");
  assert(Boolean(ack.body.authoritativeState?.settlementIntent?.idempotencyKey), "pvp surrender settlement intent must expose idempotency key");
  assert(Boolean(ack.body.authoritativeState?.rewardIntent), "pvp surrender must return reward intent boundary");
  assert(Boolean(ack.body.authoritativeState?.dropIntent), "pvp surrender must return drop intent boundary");
  assert(Boolean(ack.body.authoritativeState?.settlementPersistence), "pvp surrender must return settlement persistence status");
  assert(ack.body.authoritativeState?.deathPenaltyIntent?.reason === "surrender", "pvp surrender must return death penalty intent");
  assert(sent.some((message) => (
    message.type === "scene_snapshot"
    && message.body.type === "scene_snapshot"
    && message.body.acceptedSequence === 211
  )), "pvp surrender must emit scene_snapshot");
}

async function smokePvpRoomRuntimeMovement() {
  const {
    createPvpCombatRuntime,
    getPvpCombatRuntime,
  } = await import("../../../src/modules/combat/services/pvp-runtime-service");
  const room = new PvpRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "pvp";

  const combatId = "smoke-pvp-runtime-movement";
  const playerAId = "smoke-pvp-mover-a";
  const playerBId = "smoke-pvp-mover-b";
  await createPvpCombatRuntime({
    combatId,
    mapId: "smoke-map",
    challengerPlayerId: playerAId,
    targetPlayerId: playerBId,
    challenger: createSmokeCombatUnit({
      id: playerAId,
      name: "烟测论道甲",
      isPlayer: true,
      speed: 20,
    }),
    target: createSmokeCombatUnit({
      id: playerBId,
      name: "烟测论道乙",
      isPlayer: true,
      speed: 20,
    }),
    skillsData: {},
    challengerRotation: [],
    targetRotation: [],
  });

  const sentA: Array<{ type: string; body: { accepted?: boolean; acceptedSequence?: number; reason?: string; authoritativeState?: { sceneSnapshot?: { units?: Array<{ id: string; xPercent: number; yPercent: number }> } } } }> = [];
  const sentB: Array<{ type: string; body: { type?: string; authoritativeState?: { sceneSnapshot?: { units?: Array<{ id: string; xPercent: number; yPercent: number }> } } } }> = [];
  const clientA = {
    sessionId: "smoke-pvp-runtime-client-a",
    send(type: string, body: { accepted?: boolean; acceptedSequence?: number; reason?: string; authoritativeState?: { sceneSnapshot?: { units?: Array<{ id: string; xPercent: number; yPercent: number }> } } }) {
      sentA.push({ type, body });
    },
  } as unknown as SmokeClient;
  const clientB = {
    sessionId: "smoke-pvp-runtime-client-b",
    send(type: string, body: { type?: string; authoritativeState?: { sceneSnapshot?: { units?: Array<{ id: string; xPercent: number; yPercent: number }> } } }) {
      sentB.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [clientA, clientB],
  });

  await room.onJoin(clientA, { playerId: playerAId, combatId });
  await room.onJoin(clientB, { playerId: playerBId, combatId });
  room["handleRealtimeInput"](clientA, {
    clientSequence: 301,
    clientSceneTick: 0,
    actionId: "smoke-pvp-runtime-movement",
    clientSentAt: Date.now(),
    inputType: "movement",
    payload: { targetXPercent: 52, targetYPercent: 76 },
  });
  await waitForCondition(
    () => sentA.some((message) => message.type === "ack" && message.body.acceptedSequence === 301),
    `pvp runtime movement ack timed out: ${JSON.stringify(sentA)}`,
  );

  const ack = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 301);
  assert(ack?.body.accepted === true, `pvp runtime movement must be accepted: ${JSON.stringify(sentA)}`);
  const runtime = getPvpCombatRuntime(combatId);
  assert(runtime?.lastAcceptedClientSequenceByPlayerId[playerAId] === 301, "pvp runtime movement must commit accepted sequence");
  const actorOwnUnit = runtime?.sceneSnapshotsByPlayerId[playerAId]?.units.find((unit) => unit.id === playerAId);
  const actorForOpponentUnit = runtime?.sceneSnapshotsByPlayerId[playerBId]?.units.find((unit) => unit.id === playerAId);
  assert(actorOwnUnit?.xPercent === 52 && actorOwnUnit.yPercent === 76, "pvp runtime movement must update actor own scene snapshot");
  assert(actorForOpponentUnit?.xPercent === 48 && actorForOpponentUnit.yPercent === 24, "pvp runtime movement must mirror actor position for opponent view");
  await waitForCondition(
    () => sentB.some((message) => (
      message.type === "scene_snapshot"
      && message.body.authoritativeState?.sceneSnapshot?.units?.some((unit) => unit.id === playerAId && unit.xPercent === 48)
    )),
    `pvp runtime movement opponent scene snapshot timed out: ${JSON.stringify(sentB)}`,
  );
  assert(sentB.some((message) => (
    message.type === "scene_snapshot"
    && message.body.authoritativeState?.sceneSnapshot?.units?.some((unit) => unit.id === playerAId && unit.xPercent === 48)
  )), `pvp runtime movement must broadcast mirrored scene snapshot to opponent: ${JSON.stringify(sentB)}`);
}

async function smokePvpRoomTimeoutAdvanceIntent() {
  const room = new PvpRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "pvp";
  (room as unknown as { lastInputAtMs: number }).lastInputAtMs = 0;

  const sent: Array<{ type: string; body: { accepted?: boolean; acceptedSequence?: number; authoritativeState?: { settlementIntent?: { reason?: string; idempotencyKey?: string }; timeoutDecision?: { shouldAdvance?: boolean; reason?: string }; settlementPersistence?: { persisted?: boolean } }; type?: string } }> = [];
  const client = {
    sessionId: "smoke-pvp-timeout-client",
    send(type: string, body: { accepted?: boolean; acceptedSequence?: number; authoritativeState?: { settlementIntent?: { reason?: string; idempotencyKey?: string }; timeoutDecision?: { shouldAdvance?: boolean; reason?: string }; settlementPersistence?: { persisted?: boolean } }; type?: string }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [client],
    configurable: true,
  });

  room.onJoin(client, { playerId: "smoke-pvp-timeout-player" });
  (room as unknown as { lastInputAtMs: number }).lastInputAtMs = 0;
  room["handleRealtimeInput"](client, {
    clientSequence: 212,
    clientSceneTick: 0,
    actionId: "smoke-pvp-timeout-advance",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "timeoutAdvance", timeoutAdvance: true },
  });
  await waitForAsyncHandlers();

  const ack = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 212);
  assert(ack?.body.accepted === true, "pvp timeoutAdvance must be accepted when timeout is due");
  assert(ack.body.authoritativeState?.timeoutDecision?.shouldAdvance === true, "pvp timeoutAdvance must expose timeout decision");
  assert(ack.body.authoritativeState?.settlementIntent?.reason === "timeout", "pvp timeoutAdvance must return timeout settlement intent");
  assert(Boolean(ack.body.authoritativeState?.settlementIntent?.idempotencyKey), "pvp timeoutAdvance settlement must expose idempotency key");
  assert(Boolean(ack.body.authoritativeState?.settlementPersistence), "pvp timeoutAdvance must return settlement persistence status");
  assert(sent.some((message) => (
    message.type === "settlement"
    && message.body.type === "settlement"
    && message.body.acceptedSequence === 212
  )), "pvp timeoutAdvance must emit settlement envelope");
  assert(
    (room as unknown as { pendingSettlementJobs: Map<string, unknown> }).pendingSettlementJobs.size >= 1,
    "pvp timeoutAdvance must queue pending settlement when persistence is unavailable",
  );
  await room.onDispose();
}

async function smokeCombatRoomPartyMode() {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const room = new CombatRoom();
  try {
    room.setState(new GameRoomState());
    room.state.roomKind = "combat";
    (room as unknown as { battleMode: "party" }).battleMode = "party";

    const sentA: Array<{ type: string; body: { accepted?: boolean; reason?: string; acceptedSequence?: number; type?: string; authoritativeState?: { mode?: string; entities?: Array<{ id: string }>; message?: string; migrationNote?: string } } }> = [];
    const sentB: typeof sentA = [];
    const clientA = {
      sessionId: "smoke-party-client-a",
      send(type: string, body: typeof sentA[number]["body"]) {
        sentA.push({ type, body });
      },
    } as unknown as SmokeClient;
    const clientB = {
      sessionId: "smoke-party-client-b",
      send(type: string, body: typeof sentA[number]["body"]) {
        sentB.push({ type, body });
      },
    } as unknown as SmokeClient;
    Object.defineProperty(room, "clients", {
      value: [clientA, clientB],
      configurable: true,
    });

    await room.onJoin(clientA, { playerId: "smoke-party-player-a", partyId: "smoke-party", combatId: "smoke-party-combat" });
    await room.onJoin(clientB, { playerId: "smoke-party-player-b", partyId: "smoke-party", combatId: "smoke-party-combat" });
    room["handleRealtimeInput"](clientA, {
      clientSequence: 231,
      clientSceneTick: 0,
      actionId: "smoke-party-repair",
      clientSentAt: Date.now(),
      inputType: "repair",
      payload: {},
    });
    room["handleRealtimeInput"](clientA, {
      clientSequence: 232,
      clientSceneTick: 0,
      actionId: "smoke-party-timeout-advance-no-db",
      clientSentAt: Date.now(),
      inputType: "command",
      payload: { commandType: "timeoutAdvance", timeoutAdvance: true },
    });
    room["handleRealtimeInput"](clientA, {
      clientSequence: 233,
      clientSceneTick: 0,
      actionId: "smoke-party-skill-no-db",
      clientSentAt: Date.now(),
      inputType: "command",
      payload: { commandType: "skill", skillId: "skill_basic_attack" },
    });
    room["handleRealtimeInput"](clientA, {
      clientSequence: 234,
      clientSceneTick: 0,
      actionId: "smoke-party-movement-disabled",
      clientSentAt: Date.now(),
      inputType: "movement",
      payload: { x: 55, y: 75, targetXPercent: 55, targetYPercent: 75 },
    });
    await waitForAsyncHandlers();

    const snapshot = sentA.filter((message) => message.type === "scene_snapshot" && message.body.type === "scene_snapshot").at(-1);
    const entities = snapshot?.body.authoritativeState?.entities || [];
    const timeoutAck = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 232);
    const skillAck = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 233);
    const movementAck = sentA.find((message) => message.type === "ack" && message.body.acceptedSequence === 234);
    assert(snapshot?.body.authoritativeState?.mode === "party", "party CombatRoom must expose party mode");
    assert(entities.some((entity) => entity.id === "smoke-party-player-a"), "party CombatRoom snapshot must include first member");
    assert(entities.some((entity) => entity.id === "smoke-party-player-b"), "party CombatRoom snapshot must include second member");
    assert(entities.some((entity) => entity.id.startsWith("party-enemy:")), "party CombatRoom snapshot must include authoritative party target");
    assert(timeoutAck?.body.accepted === false, "party timeoutAdvance must not fake success without database");
    assert(timeoutAck.body.reason === "unsupported_input", "party timeoutAdvance without database must expose unsupported_input");
    assert(skillAck?.body.accepted === false, "party action must not fake success without database");
    assert(skillAck.body.reason === "unsupported_input", "party action without database must expose unsupported_input");
    assert(movementAck?.body.accepted === false, "party movement must stay disabled until real positioning is designed");
    assert(movementAck.body.reason === "unsupported_input", "party movement must return explicit unsupported_input");
    assert(Boolean(movementAck.body.authoritativeState?.migrationNote), "party movement rejection must explain fixed no-positioning policy");
  } finally {
    if (typeof previousDatabaseUrl === "string") {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}

async function smokeBossRoomCommandAndSnapshot() {
  const room = new BossRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "boss";

  const sent: Array<{ type: string; body: { accepted?: boolean; reason?: string; acceptedSequence?: number; type?: string; authoritativeState?: { mode?: string; runtimeSource?: string; migrationNote?: string; participants?: unknown[] } } }> = [];
  const client = {
    sessionId: "smoke-boss-client",
    send(type: string, body: { accepted?: boolean; reason?: string; acceptedSequence?: number; type?: string; authoritativeState?: { mode?: string; runtimeSource?: string; migrationNote?: string; participants?: unknown[] } }) {
      sent.push({ type, body });
    },
  } as unknown as SmokeClient;
  Object.defineProperty(room, "clients", {
    value: [client],
    configurable: true,
  });

  room.onJoin(client, { playerId: "smoke-boss-player", combatId: "smoke-boss" });
  const boss = createSmokeEntity({
    id: "boss",
    kind: "combatant",
    x: 50,
    y: 65,
  });
  room.state.entities.set("boss-session", boss);
  room["handleRealtimeInput"](client, {
    clientSequence: 221,
    clientSceneTick: 0,
    actionId: "smoke-boss-skill",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "skill", targetId: "boss" },
  });
  await waitForAsyncHandlers();

  const ack = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 221);
  assert(ack?.body.accepted === false, "boss skill command must not fake success before real transaction migration");
  assert(ack.body.reason === "unsupported_input", "boss command boundary must expose unsupported_input");
  assert(ack.body.authoritativeState?.mode === "boss", "boss command ack must expose boss mode");
  assert(ack.body.authoritativeState?.runtimeSource === "boss_core_service", "boss command ack must point to core service boundary");
  assert(Boolean(ack.body.authoritativeState?.migrationNote), "boss command ack must explain transaction migration boundary");

  room["handleRealtimeInput"](client, {
    clientSequence: 222,
    clientSceneTick: 0,
    actionId: "smoke-boss-flee",
    clientSentAt: Date.now(),
    inputType: "command",
    payload: { commandType: "flee" },
  });
  await waitForAsyncHandlers();

  const fleeAck = sent.find((message) => message.type === "ack" && message.body.acceptedSequence === 222);
  assert(fleeAck?.body.accepted === true, "boss flee command must be accepted by core leave service");
  assert(fleeAck.body.authoritativeState?.runtimeSource === "boss_core_service", "boss flee command must not use legacy HTTP bridge");
  assert(Array.isArray(fleeAck.body.authoritativeState?.participants), "boss flee command must return participants");
}

function smokePvpTimeoutRoomDecision() {
  const room = new PvpRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "pvp";

  const decision = room.getCurrentTimeoutDecision(20_000, 0);
  assert(decision?.shouldAdvance === true && decision.reason === "timeout", "pvp room timeout decision must advance when overdue");
}

async function smokeCombatRoomReconnectRepair() {
  const room = new CombatRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "combat";

  const originalSent: Array<{ type: string; body: { type?: string } }> = [];
  const reconnectSent: Array<{ type: string; body: { type?: string } }> = [];
  const originalClient = {
    sessionId: "smoke-combat-reconnect-client",
    send(type: string, body: { type?: string }) {
      originalSent.push({ type, body });
    },
  } as unknown as SmokeClient;
  const reconnectClient = {
    sessionId: "smoke-combat-reconnect-client",
    send(type: string, body: { type?: string }) {
      reconnectSent.push({ type, body });
    },
  } as unknown as SmokeClient;

  (room as unknown as {
    allowReconnection(client: SmokeClient, seconds: number): Promise<SmokeClient>;
  }).allowReconnection = async (client, seconds) => {
    assert(client.sessionId === originalClient.sessionId, "reconnect must preserve combat session id");
    assert(seconds >= 1, "reconnect grace must use a positive timeout");
    return reconnectClient;
  };

  room.onJoin(originalClient, { playerId: "smoke-combat-reconnect-player" });
  await room.onLeave(originalClient, 1006);

  assert(
    room.state.entities.has(originalClient.sessionId),
    "combat reconnect grace must keep authoritative entity after successful reconnect",
  );
  assert(reconnectSent.some((message) => (
    message.type === "scene_snapshot"
    && message.body.type === "scene_snapshot"
  )), "combat reconnect must emit repair scene_snapshot to reconnected client");
}

async function smokeWorldMapDataFallback() {
  const data = await loadWorldMapRoomData({
    mapId: "smoke-map",
  });
  assert(data.map.id === "smoke-map", "world map data fallback must keep requested map id");
  assert(data.map.width > 0 && data.map.height > 0, "world map data fallback must provide usable dimensions");
}

async function smokeOfficialSdkWorldMapJoin(port: number) {
  const client = new ColyseusSdkClient(`ws://127.0.0.1:${port}`);
  const room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
    mapId: "smoke-map",
    shardId: "0",
    playerId: "smoke-sdk-player",
  });

  assert(Boolean(room.roomId), "official SDK join must return a room id");
  assert(Boolean(room.sessionId), "official SDK join must return a session id");

  const ackPromise = waitForSdkMessage<{
    accepted?: boolean;
    acceptedSequence?: number;
  }>(
    room,
    "ack",
    (payload) => payload.accepted === true && payload.acceptedSequence === 101,
  );
  const snapshotPromise = waitForSdkMessage<{
    type?: string;
    acceptedSequence?: number | null;
  }>(
    room,
    "sector_snapshot",
    (payload) => payload.type === "sector_snapshot" && payload.acceptedSequence === 101,
  );

  room.send("input", createRealtimeClientInput({
    clientSequence: 101,
    clientSceneTick: 0,
    actionId: "smoke-sdk-repair",
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  }));

  await ackPromise;
  await snapshotPromise;

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  const healthBody = await healthResponse.json() as {
    roomInstances?: Array<{
      roomId?: string;
      roomKind?: string;
      clientCount?: number;
      inputMessages?: number;
      tickAvgMs?: number;
    }>;
  };
  const worldMapRoom = healthBody.roomInstances?.find((item) => item.roomId === room.roomId);
  assert(worldMapRoom?.roomKind === GAME_ROOM_NAMES.worldMap, "health must expose active WorldMapRoom instance");
  assert((worldMapRoom.clientCount || 0) >= 1, "room health must expose per-room client count");
  assert((worldMapRoom.inputMessages || 0) >= 1, "room health must expose per-room input messages");
  assert(typeof worldMapRoom.tickAvgMs === "number", "room health must expose per-room tick timing");

  await room.leave();
}

isolateSmokeExternalServices();
smokeMovementRules();
smokeBattleRules();
smokeInputValidation();
await smokeJoinAuthHelpers();
await smokeWorldMapDataFallback();
smokeRoomInvalidMoveAck();
smokeRoomOutOfBoundsMoveAck();
smokeRoomAcceptedAndBlockedMoveAck();
smokeWorldMapAoiDelta();
smokeWorldMapSameAoiEntityUpdateDelta();
await smokeRoomJoinSectorSnapshot();
smokeWorldMapRefreshedEntityVelocity();
smokeRoomRepairSectorSnapshot();
smokeRoomInteractAndTravelAcks();
smokeSocialRoomPresenceAndNearbyMessage();
await smokeCombatRoomAcks();
await smokeCombatRoomSoloRuntimeCommand();
await smokePvpRoomSurrenderIntent();
await smokePvpRoomRuntimeMovement();
  await smokePvpRoomTimeoutAdvanceIntent();
  await smokeCombatRoomPartyMode();
await smokeBossRoomCommandAndSnapshot();
smokePvpTimeoutRoomDecision();
await smokeCombatRoomReconnectRepair();

const gameServer = createGameServer();
await gameServer.listen();

const url = `http://127.0.0.1:${gameServer.config.port}/health`;

try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`health returned ${response.status}`);
  }
  const body = await response.json() as {
    ok?: boolean;
    rooms?: unknown[];
    redisEnabled?: boolean;
    redis?: {
      enabled?: boolean;
      status?: string;
      latencyMs?: number | null;
      checkedAt?: string | null;
      error?: string;
    };
    metrics?: {
      websocketUpgradeRequests?: number;
      websocketConnections?: number;
      websocketConnectionErrors?: number;
      websocketClientErrors?: number;
      websocketHeartbeatTerminations?: number;
    };
  };
  if (!body.ok || !Array.isArray(body.rooms) || body.rooms.length < 1) {
    throw new Error("health payload invalid");
  }
  if (body.redisEnabled !== false || body.redis?.enabled !== false || body.redis.status !== "disabled") {
    throw new Error("health payload must expose disabled Redis health when REDIS_URL is not configured");
  }
  if (!body.metrics || typeof body.metrics !== "object") {
    throw new Error("health payload must include runtime metrics");
  }
  if (
    typeof body.metrics.websocketUpgradeRequests !== "number"
    || typeof body.metrics.websocketConnections !== "number"
    || typeof body.metrics.websocketConnectionErrors !== "number"
    || typeof body.metrics.websocketClientErrors !== "number"
    || typeof body.metrics.websocketHeartbeatTerminations !== "number"
  ) {
    throw new Error("health metrics must include websocket transport counters");
  }
  await smokeOfficialSdkWorldMapJoin(gameServer.config.port);
  console.log(`[game-server:smoke] ok rooms=${body.rooms.length}`);
} finally {
  await gameServer.shutdown();
}
