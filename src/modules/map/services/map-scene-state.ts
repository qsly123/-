import {
  REALTIME_ENTITY_SCHEMA,
  REALTIME_ENTITY_SCHEMA_VERSION,
} from "@/modules/shared/services/realtime-scene-schema.mjs";

export type MapScenePlayer = {
  id: string;
  name: string;
  gender?: string | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  realm: number;
  realmMajor?: number | null;
  realmMinor?: number | null;
  realmName?: string | null;
  positionX: number;
  positionY: number;
};

export type MapSceneOpportunity = {
  spawnId: string;
  eventId: string;
  name: string;
  iconImageUrl?: string | null;
  minRealm: number;
  maxRealm: number | null;
  positionX: number;
  positionY: number;
  expiresAt: string;
};

export type MapSceneNpc = {
  id: string;
  name: string;
  title?: string | null;
  avatarImageUrl?: string | null;
  positionX: number;
  positionY: number;
  isShop: boolean;
  sourceType?: "static" | "world";
  detailRoute?: string | null;
  realmName?: string | null;
  currentActionLabel?: string | null;
  isKillable?: boolean;
  status?: string | null;
};

export type MapSceneMonsterDrop = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  itemRarity?: string | null;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
};

export type MapSceneMonsterDropIntel = {
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
  rarityLabel: string;
  chanceText: string;
  quantityText: string;
};

export type MapSceneMonster = {
  id: string;
  name: string;
  avatarImageUrl?: string | null;
  monsterType: string;
  level: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  drops: MapSceneMonsterDrop[];
  dropIntel?: MapSceneMonsterDropIntel[];
  positionX: number;
  positionY: number;
};

export type MapScenePlayerEntity = {
  entityType: "self" | "player";
  mapId: string;
  velocityXPerSecond: number;
  velocityYPerSecond: number;
} & MapScenePlayer;

export type MapSceneOpportunityEntity = {
  id: string;
  entityType: "opportunity";
  mapId: string;
  velocityXPerSecond: number;
  velocityYPerSecond: number;
} & MapSceneOpportunity;

export type MapSceneNpcEntity = {
  entityType: "npc";
  mapId: string;
  velocityXPerSecond: number;
  velocityYPerSecond: number;
} & MapSceneNpc;

export type MapSceneMonsterEntity = Omit<MapSceneMonster, "drops" | "dropIntel"> & {
  entityType: "monster";
  mapId: string;
  velocityXPerSecond: number;
  velocityYPerSecond: number;
  drops?: MapSceneMonsterDrop[];
  dropIntel?: MapSceneMonsterDropIntel[];
};

export type MapSceneEntity =
  | MapScenePlayerEntity
  | MapSceneOpportunityEntity
  | MapSceneNpcEntity
  | MapSceneMonsterEntity;

export type MapSceneSnapshot = {
  entitySchema?: string;
  entitySchemaVersion?: number;
  runtimeVersion?: number;
  sequence: number;
  connectionSequence?: number;
  tick: number;
  sceneVersion: number;
  entitiesRevision: number;
  serverTimeMs: number;
  mapId: string;
  mode?: "full" | "delta" | "sector_snapshot" | "sector_delta";
  baseSequence?: number;
  baseConnectionSequence?: number;
  subscribedSectorKeys?: string[];
  removedEntityIds?: string[];
  entities: MapSceneEntity[];
};

export type MapSceneState = {
  mapId: string;
  selfPlayer: MapScenePlayer;
  otherPlayers: MapScenePlayer[];
  npcs: MapSceneNpc[];
  monsters: MapSceneMonster[];
  opportunities: MapSceneOpportunity[];
};

export type MapSceneStreamEvent =
  | { type: "connected"; mapId?: string }
  | { type: "scene_snapshot"; snapshot: MapSceneSnapshot }
  | { type: "map_refresh"; mapId: string; reason: "secret_realm" | "monster_defeat" };

export type MapScenePresenceEvent =
  | {
    type: "snapshot";
    data: {
      mapId: string;
      players: MapScenePlayer[];
    };
  }
  | {
    type: "player_position";
    data: MapScenePlayer & {
      mapId: string;
      prevMapId: string;
    };
  }
  | {
    type: "self_position";
    data: {
      mapId: string;
      prevMapId: string;
      positionX: number;
      positionY: number;
    };
  }
  | {
    type: "opportunity_snapshot";
    data: {
      mapId: string;
      list: MapSceneOpportunity[];
    };
  }
  | {
    type: "monster_position";
    data: {
      id: string;
      mapId: string;
      positionX: number;
      positionY: number;
    };
  }
  | {
    type: "opportunity_spawned";
    data: MapSceneOpportunity & {
      mapId: string;
    };
  }
  | {
    type: "opportunity_claimed";
    data: {
      mapId: string;
      spawnId: string;
      eventId: string;
      claimedByPlayerId: string;
      positionX: number;
      positionY: number;
    };
  };

function parseOpportunityExpiresAtMs(expiresAt: string | null | undefined) {
  const normalized = String(expiresAt || "").trim();
  if (!normalized) {
    return 0;
  }
  const value = Date.parse(normalized);
  return Number.isFinite(value) ? value : 0;
}

function isOpportunityExpired(opportunity: Pick<MapSceneOpportunity, "expiresAt">, nowMs = Date.now()) {
  const expiresAtMs = parseOpportunityExpiresAtMs(opportunity.expiresAt);
  return expiresAtMs > 0 && expiresAtMs <= nowMs;
}

function filterActiveOpportunities(opportunities: MapSceneOpportunity[], nowMs = Date.now()) {
  return opportunities.filter((opportunity) => !isOpportunityExpired(opportunity, nowMs));
}

function filterActiveOpportunityEntities(entities: MapSceneEntity[], nowMs = Date.now()) {
  return entities.filter((entity) => (
    entity.entityType !== "opportunity" || !isOpportunityExpired(entity, nowMs)
  ));
}

function canSeeOpportunityByRealm(params: {
  playerRealm: number;
  minRealm: number;
  maxRealm: number | null;
}) {
  if (params.playerRealm < params.minRealm) {
    return false;
  }
  if (params.maxRealm !== null && params.playerRealm > params.maxRealm) {
    return false;
  }
  return true;
}

function indexEntitiesById<T extends { id: string }>(entities: T[]) {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function areMonsterDropsEqual(
  left: MapSceneMonsterDrop[] | undefined,
  right: MapSceneMonsterDrop[] | undefined,
) {
  if (!Array.isArray(left) && !Array.isArray(right)) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const previousDrop = left[index];
    const nextDrop = right[index];
    if (
      previousDrop.itemId !== nextDrop.itemId
      || previousDrop.itemName !== nextDrop.itemName
      || previousDrop.itemIconUrl !== nextDrop.itemIconUrl
      || previousDrop.itemRarity !== nextDrop.itemRarity
      || previousDrop.chance !== nextDrop.chance
      || previousDrop.minQuantity !== nextDrop.minQuantity
      || previousDrop.maxQuantity !== nextDrop.maxQuantity
    ) {
      return false;
    }
  }
  return true;
}

function areMonsterDropIntelEqual(
  left: MapSceneMonsterDropIntel[] | undefined,
  right: MapSceneMonsterDropIntel[] | undefined,
) {
  if (!Array.isArray(left) && !Array.isArray(right)) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const previousIntel = left[index];
    const nextIntel = right[index];
    if (
      previousIntel.label !== nextIntel.label
      || previousIntel.rarity !== nextIntel.rarity
      || previousIntel.rarityLabel !== nextIntel.rarityLabel
      || previousIntel.chanceText !== nextIntel.chanceText
      || previousIntel.quantityText !== nextIntel.quantityText
    ) {
      return false;
    }
  }
  return true;
}

function areSceneEntitiesEqual(
  previousEntity: MapSceneEntity | null | undefined,
  nextEntity: MapSceneEntity | null | undefined,
) {
  if (!previousEntity || !nextEntity) {
    return false;
  }
  if (
    previousEntity.entityType !== nextEntity.entityType
    || previousEntity.id !== nextEntity.id
    || previousEntity.mapId !== nextEntity.mapId
    || previousEntity.positionX !== nextEntity.positionX
    || previousEntity.positionY !== nextEntity.positionY
    || previousEntity.velocityXPerSecond !== nextEntity.velocityXPerSecond
    || previousEntity.velocityYPerSecond !== nextEntity.velocityYPerSecond
  ) {
    return false;
  }

  switch (nextEntity.entityType) {
    case "self":
    case "player": {
      const previousPlayer = previousEntity as MapScenePlayerEntity;
      const nextPlayer = nextEntity as MapScenePlayerEntity;
      return (
        previousPlayer.name === nextPlayer.name
        && previousPlayer.gender === nextPlayer.gender
        && previousPlayer.avatarImageUrl === nextPlayer.avatarImageUrl
        && previousPlayer.avatarFrameImageUrl === nextPlayer.avatarFrameImageUrl
        && previousPlayer.realm === nextPlayer.realm
        && previousPlayer.realmMajor === nextPlayer.realmMajor
        && previousPlayer.realmMinor === nextPlayer.realmMinor
        && previousPlayer.realmName === nextPlayer.realmName
      );
    }
    case "npc": {
      const previousNpc = previousEntity as MapSceneNpcEntity;
      const nextNpc = nextEntity as MapSceneNpcEntity;
      return (
        previousNpc.name === nextNpc.name
        && previousNpc.title === nextNpc.title
        && previousNpc.avatarImageUrl === nextNpc.avatarImageUrl
        && previousNpc.isShop === nextNpc.isShop
        && previousNpc.sourceType === nextNpc.sourceType
        && previousNpc.detailRoute === nextNpc.detailRoute
        && previousNpc.realmName === nextNpc.realmName
        && previousNpc.currentActionLabel === nextNpc.currentActionLabel
        && previousNpc.isKillable === nextNpc.isKillable
        && previousNpc.status === nextNpc.status
      );
    }
    case "monster": {
      const previousMonster = previousEntity as MapSceneMonsterEntity;
      const nextMonster = nextEntity as MapSceneMonsterEntity;
      return (
        previousMonster.name === nextMonster.name
        && previousMonster.avatarImageUrl === nextMonster.avatarImageUrl
        && previousMonster.monsterType === nextMonster.monsterType
        && previousMonster.level === nextMonster.level
        && previousMonster.hp === nextMonster.hp
        && previousMonster.attack === nextMonster.attack
        && previousMonster.defense === nextMonster.defense
        && previousMonster.speed === nextMonster.speed
        && areMonsterDropsEqual(previousMonster.drops, nextMonster.drops)
        && areMonsterDropIntelEqual(previousMonster.dropIntel, nextMonster.dropIntel)
      );
    }
    case "opportunity": {
      const previousOpportunity = previousEntity as MapSceneOpportunityEntity;
      const nextOpportunity = nextEntity as MapSceneOpportunityEntity;
      return (
        previousOpportunity.spawnId === nextOpportunity.spawnId
        && previousOpportunity.eventId === nextOpportunity.eventId
        && previousOpportunity.name === nextOpportunity.name
        && previousOpportunity.iconImageUrl === nextOpportunity.iconImageUrl
        && previousOpportunity.minRealm === nextOpportunity.minRealm
        && previousOpportunity.maxRealm === nextOpportunity.maxRealm
        && previousOpportunity.expiresAt === nextOpportunity.expiresAt
      );
    }
    default:
      return false;
  }
}

function createPlayerEntity(params: {
  player: MapScenePlayer;
  entityType: "self" | "player";
  mapId: string;
  previousEntity?: MapSceneEntity | null;
  elapsedSeconds: number;
}) {
  return {
    ...params.player,
    entityType: params.entityType,
    mapId: params.mapId,
    velocityXPerSecond: params.previousEntity
      ? (params.player.positionX - params.previousEntity.positionX) / params.elapsedSeconds
      : 0,
    velocityYPerSecond: params.previousEntity
      ? (params.player.positionY - params.previousEntity.positionY) / params.elapsedSeconds
      : 0,
  } satisfies MapSceneEntity;
}

function createOpportunityEntity(params: {
  opportunity: MapSceneOpportunity;
  mapId: string;
  previousEntity?: MapSceneEntity | null;
  elapsedSeconds: number;
}) {
  return {
    ...params.opportunity,
    id: params.opportunity.spawnId,
    entityType: "opportunity",
    mapId: params.mapId,
    velocityXPerSecond: params.previousEntity
      ? (params.opportunity.positionX - params.previousEntity.positionX) / params.elapsedSeconds
      : 0,
    velocityYPerSecond: params.previousEntity
      ? (params.opportunity.positionY - params.previousEntity.positionY) / params.elapsedSeconds
      : 0,
  } satisfies MapSceneEntity;
}

function createNpcEntity(params: {
  npc: MapSceneNpc;
  mapId: string;
  previousEntity?: MapSceneEntity | null;
  elapsedSeconds: number;
}) {
  return {
    ...params.npc,
    entityType: "npc",
    mapId: params.mapId,
    velocityXPerSecond: params.previousEntity
      ? (params.npc.positionX - params.previousEntity.positionX) / params.elapsedSeconds
      : 0,
    velocityYPerSecond: params.previousEntity
      ? (params.npc.positionY - params.previousEntity.positionY) / params.elapsedSeconds
      : 0,
  } satisfies MapSceneEntity;
}

function createMonsterEntity(params: {
  monster: MapSceneMonster;
  mapId: string;
  previousEntity?: MapSceneEntity | null;
  elapsedSeconds: number;
  includeDrops?: boolean;
}) {
  const baseEntity: MapSceneMonsterEntity = {
    ...params.monster,
    entityType: "monster",
    mapId: params.mapId,
    velocityXPerSecond: params.previousEntity
      ? (params.monster.positionX - params.previousEntity.positionX) / params.elapsedSeconds
      : 0,
    velocityYPerSecond: params.previousEntity
      ? (params.monster.positionY - params.previousEntity.positionY) / params.elapsedSeconds
      : 0,
  };

  if (params.includeDrops === false) {
    delete baseEntity.drops;
  }

  return baseEntity satisfies MapSceneEntity;
}

export function createMapSceneState(params: MapSceneState) {
  return {
    mapId: params.mapId,
    selfPlayer: params.selfPlayer,
    otherPlayers: params.otherPlayers,
    npcs: params.npcs,
    monsters: params.monsters,
    opportunities: filterActiveOpportunities(params.opportunities),
  } satisfies MapSceneState;
}

export function createMapSceneSnapshot(params: {
  state: MapSceneState;
  sequence: number;
  tick?: number;
  serverTimeMs: number;
  previousSnapshot?: MapSceneSnapshot | null;
  includeMonsterDrops?: boolean;
}) {
  const previousSnapshot = params.previousSnapshot;
  const previousEntityMap = indexEntitiesById(previousSnapshot?.entities || []);
  const elapsedSeconds = Math.max(
    0.001,
    (params.serverTimeMs - (previousSnapshot?.serverTimeMs || params.serverTimeMs - 16)) / 1000,
  );

  const totalEntityCount = 1
    + params.state.otherPlayers.length
    + params.state.npcs.length
    + params.state.monsters.length
    + params.state.opportunities.length;
  const entities: MapSceneEntity[] = new Array(totalEntityCount);
  let nextEntityIndex = 0;

  entities[nextEntityIndex] = createPlayerEntity({
    player: params.state.selfPlayer,
    entityType: "self",
    mapId: params.state.mapId,
    previousEntity: previousEntityMap.get(params.state.selfPlayer.id) || null,
    elapsedSeconds,
  });
  nextEntityIndex += 1;

  params.state.otherPlayers.forEach((player) => {
    entities[nextEntityIndex] = createPlayerEntity({
      player,
      entityType: "player",
      mapId: params.state.mapId,
      previousEntity: previousEntityMap.get(player.id) || null,
      elapsedSeconds,
    });
    nextEntityIndex += 1;
  });

  params.state.npcs.forEach((npc) => {
    entities[nextEntityIndex] = createNpcEntity({
      npc,
      mapId: params.state.mapId,
      previousEntity: previousEntityMap.get(npc.id) || null,
      elapsedSeconds,
    });
    nextEntityIndex += 1;
  });

  params.state.monsters.forEach((monster) => {
    entities[nextEntityIndex] = createMonsterEntity({
      monster,
      mapId: params.state.mapId,
      previousEntity: previousEntityMap.get(monster.id) || null,
      elapsedSeconds,
      includeDrops: params.includeMonsterDrops !== false,
    });
    nextEntityIndex += 1;
  });

  params.state.opportunities.forEach((opportunity) => {
    entities[nextEntityIndex] = createOpportunityEntity({
      opportunity,
      mapId: params.state.mapId,
      previousEntity: previousEntityMap.get(opportunity.spawnId) || null,
      elapsedSeconds,
    });
    nextEntityIndex += 1;
  });

  return {
    entitySchema: REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: REALTIME_ENTITY_SCHEMA_VERSION,
    runtimeVersion: previousSnapshot?.runtimeVersion ?? 0,
    sequence: params.sequence,
    connectionSequence: params.sequence,
    tick: params.tick ?? params.sequence,
    sceneVersion: params.tick ?? params.sequence,
    entitiesRevision: params.sequence,
    serverTimeMs: params.serverTimeMs,
    mapId: params.state.mapId,
    mode: "full",
    removedEntityIds: [],
    entities: filterActiveOpportunityEntities(entities),
  } satisfies MapSceneSnapshot;
}

export function createMapSceneDeltaSnapshot(params: {
  previousSnapshot: MapSceneSnapshot;
  nextSnapshot: MapSceneSnapshot;
}) {
  const previousSnapshot = params.previousSnapshot;
  const nextSnapshot = params.nextSnapshot;
  if (previousSnapshot.mapId !== nextSnapshot.mapId) {
    return {
      ...nextSnapshot,
      mode: "full",
      removedEntityIds: [],
    } satisfies MapSceneSnapshot;
  }

  const previousEntityMap = indexEntitiesById(previousSnapshot.entities);
  const nextEntityMap = indexEntitiesById(nextSnapshot.entities);
  const changedEntities = nextSnapshot.entities.filter((entity) => (
    !areSceneEntitiesEqual(previousEntityMap.get(entity.id), entity)
  ));
  const removedEntityIds = previousSnapshot.entities
    .filter((entity) => !nextEntityMap.has(entity.id))
    .map((entity) => entity.id);

  return {
    entitySchema: nextSnapshot.entitySchema ?? previousSnapshot.entitySchema ?? REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: nextSnapshot.entitySchemaVersion ?? previousSnapshot.entitySchemaVersion ?? REALTIME_ENTITY_SCHEMA_VERSION,
    runtimeVersion: nextSnapshot.runtimeVersion ?? previousSnapshot.runtimeVersion ?? 0,
    sequence: nextSnapshot.sequence,
    connectionSequence: nextSnapshot.connectionSequence ?? nextSnapshot.sequence,
    tick: nextSnapshot.tick,
    sceneVersion: nextSnapshot.sceneVersion ?? nextSnapshot.tick,
    entitiesRevision: nextSnapshot.entitiesRevision ?? nextSnapshot.sequence,
    serverTimeMs: nextSnapshot.serverTimeMs,
    mapId: nextSnapshot.mapId,
    mode: "delta",
    baseSequence: previousSnapshot.sequence,
    baseConnectionSequence: previousSnapshot.connectionSequence ?? previousSnapshot.sequence,
    subscribedSectorKeys: nextSnapshot.subscribedSectorKeys ?? previousSnapshot.subscribedSectorKeys ?? [],
    removedEntityIds,
    entities: changedEntities,
  } satisfies MapSceneSnapshot;
}

export function materializeMapSceneSnapshot(params: {
  previousSnapshot?: MapSceneSnapshot | null;
  incomingSnapshot: MapSceneSnapshot;
}) {
  const { previousSnapshot, incomingSnapshot } = params;
  const nowMs = Date.now();
  if (incomingSnapshot.mode !== "delta" && incomingSnapshot.mode !== "sector_delta") {
    return {
      entitySchema: incomingSnapshot.entitySchema ?? previousSnapshot?.entitySchema ?? REALTIME_ENTITY_SCHEMA,
      entitySchemaVersion: incomingSnapshot.entitySchemaVersion
        ?? previousSnapshot?.entitySchemaVersion
        ?? REALTIME_ENTITY_SCHEMA_VERSION,
      ...incomingSnapshot,
      runtimeVersion: incomingSnapshot.runtimeVersion ?? previousSnapshot?.runtimeVersion ?? 0,
      connectionSequence: incomingSnapshot.connectionSequence ?? incomingSnapshot.sequence,
      sceneVersion: incomingSnapshot.sceneVersion ?? incomingSnapshot.tick,
      entitiesRevision: incomingSnapshot.entitiesRevision ?? incomingSnapshot.sequence,
      mode: incomingSnapshot.mode === "sector_snapshot" ? "sector_snapshot" : "full",
      subscribedSectorKeys: incomingSnapshot.subscribedSectorKeys ?? previousSnapshot?.subscribedSectorKeys ?? [],
      removedEntityIds: [],
      entities: filterActiveOpportunityEntities(incomingSnapshot.entities, nowMs),
    } satisfies MapSceneSnapshot;
  }

  if (!previousSnapshot || previousSnapshot.mapId !== incomingSnapshot.mapId) {
    return null;
  }
  const expectedBaseConnectionSequence = previousSnapshot.connectionSequence ?? previousSnapshot.sequence;
  const incomingBaseConnectionSequence = typeof incomingSnapshot.baseConnectionSequence === "number"
    ? Math.floor(incomingSnapshot.baseConnectionSequence)
    : null;
  if (
    (
      incomingBaseConnectionSequence !== null
        ? incomingBaseConnectionSequence !== Math.floor(expectedBaseConnectionSequence)
        : (
          typeof incomingSnapshot.baseSequence !== "number"
          || Math.floor(incomingSnapshot.baseSequence) !== Math.floor(previousSnapshot.sequence)
        )
    )
  ) {
    return null;
  }

  const removedIds = new Set(
    Array.isArray(incomingSnapshot.removedEntityIds)
      ? incomingSnapshot.removedEntityIds
      : [],
  );
  const nextEntityMap = indexEntitiesById(previousSnapshot.entities);
  removedIds.forEach((entityId) => {
    nextEntityMap.delete(entityId);
  });
  incomingSnapshot.entities.forEach((entity) => {
    if (entity.entityType === "opportunity" && isOpportunityExpired(entity, nowMs)) {
      nextEntityMap.delete(entity.id);
      removedIds.add(entity.id);
      return;
    }
    nextEntityMap.set(entity.id, entity);
  });

  const nextEntities = previousSnapshot.entities
    .filter((entity) => !removedIds.has(entity.id))
    .map((entity) => nextEntityMap.get(entity.id) || entity);
  incomingSnapshot.entities.forEach((entity) => {
    if (entity.entityType === "opportunity" && isOpportunityExpired(entity, nowMs)) {
      return;
    }
    if (previousSnapshot.entities.some((previousEntity) => previousEntity.id === entity.id)) {
      return;
    }
    nextEntities.push(entity);
  });

  return {
    entitySchema: incomingSnapshot.entitySchema ?? previousSnapshot.entitySchema ?? REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: incomingSnapshot.entitySchemaVersion
      ?? previousSnapshot.entitySchemaVersion
      ?? REALTIME_ENTITY_SCHEMA_VERSION,
    runtimeVersion: incomingSnapshot.runtimeVersion ?? previousSnapshot.runtimeVersion ?? 0,
    sequence: incomingSnapshot.sequence,
    connectionSequence: incomingSnapshot.connectionSequence ?? incomingSnapshot.sequence,
    tick: incomingSnapshot.tick,
    sceneVersion: incomingSnapshot.sceneVersion ?? incomingSnapshot.tick,
    entitiesRevision: incomingSnapshot.entitiesRevision ?? incomingSnapshot.sequence,
    serverTimeMs: incomingSnapshot.serverTimeMs,
    mapId: incomingSnapshot.mapId,
    mode: incomingSnapshot.mode === "sector_delta" ? "sector_snapshot" : "full",
    subscribedSectorKeys: incomingSnapshot.subscribedSectorKeys ?? previousSnapshot.subscribedSectorKeys ?? [],
    removedEntityIds: [],
    entities: filterActiveOpportunityEntities(nextEntities, nowMs),
  } satisfies MapSceneSnapshot;
}

export function buildMapSceneStateFromMapData(params: {
  mapId: string;
  player: MapScenePlayer;
  otherPlayers: MapScenePlayer[];
  npcs: MapSceneNpc[];
  monsters: MapSceneMonster[];
  opportunities: MapSceneOpportunity[];
}) {
  return createMapSceneState({
    mapId: params.mapId,
    selfPlayer: params.player,
    otherPlayers: params.otherPlayers,
    npcs: params.npcs,
    monsters: params.monsters,
    opportunities: params.opportunities,
  });
}

export function reduceMapSceneStateWithPresenceEvent(params: {
  state: MapSceneState;
  event: MapScenePresenceEvent;
  playerRealm: number;
}) {
  const { state, event, playerRealm } = params;
  const activeOpportunities = filterActiveOpportunities(state.opportunities);

  if (event.type === "self_position") {
    return {
      ...state,
      mapId: event.data.mapId,
      selfPlayer: {
        ...state.selfPlayer,
        positionX: event.data.positionX,
        positionY: event.data.positionY,
      },
      otherPlayers: event.data.mapId === state.mapId ? state.otherPlayers : [],
      npcs: event.data.mapId === state.mapId ? state.npcs : [],
      monsters: event.data.mapId === state.mapId ? state.monsters : [],
      opportunities: event.data.mapId === state.mapId ? activeOpportunities : [],
    } satisfies MapSceneState;
  }

  if (event.type === "snapshot") {
    if (event.data.mapId !== state.mapId) {
      return state;
    }
    return {
      ...state,
      otherPlayers: event.data.players,
    } satisfies MapSceneState;
  }

  if (event.type === "player_position") {
    const changed = event.data;
    const inCurrentMap = changed.mapId === state.mapId;
    const leftCurrentMap = changed.prevMapId === state.mapId;
    if (!inCurrentMap && !leftCurrentMap) {
      return state;
    }

    const nextPlayers = state.otherPlayers.filter((player) => player.id !== changed.id);
    if (!inCurrentMap || !changed.name) {
      return {
        ...state,
        otherPlayers: nextPlayers,
      } satisfies MapSceneState;
    }

    return {
      ...state,
      otherPlayers: [
        ...nextPlayers,
        {
          id: changed.id,
          name: changed.name,
          gender: changed.gender,
          avatarImageUrl: changed.avatarImageUrl,
          avatarFrameImageUrl: changed.avatarFrameImageUrl,
          realm: changed.realm,
          realmMajor: changed.realmMajor,
          realmMinor: changed.realmMinor,
          realmName: changed.realmName,
          positionX: changed.positionX,
          positionY: changed.positionY,
        },
      ],
    } satisfies MapSceneState;
  }

  if (event.type === "monster_position") {
    if (event.data.mapId !== state.mapId) {
      return state;
    }
    const currentMonster = state.monsters.find((item) => item.id === event.data.id);
    if (!currentMonster) {
      return state;
    }
    const monster = {
      ...currentMonster,
      positionX: event.data.positionX,
      positionY: event.data.positionY,
    } satisfies MapSceneMonster;
    return {
      ...state,
      monsters: [
        ...state.monsters.filter((item) => item.id !== monster.id),
        monster,
      ],
    } satisfies MapSceneState;
  }

  if (event.type === "opportunity_snapshot") {
    if (event.data.mapId !== state.mapId) {
      return state;
    }
    return {
      ...state,
      opportunities: filterActiveOpportunities(event.data.list).filter((item) => canSeeOpportunityByRealm({
        playerRealm,
        minRealm: item.minRealm,
        maxRealm: item.maxRealm,
      })),
    } satisfies MapSceneState;
  }

  if (event.type === "opportunity_spawned") {
    const { mapId, ...spawnedItem } = event.data;
    if (mapId !== state.mapId) {
      return state;
    }
    if (!canSeeOpportunityByRealm({
      playerRealm,
      minRealm: spawnedItem.minRealm,
      maxRealm: spawnedItem.maxRealm,
    })) {
      return state;
    }
    if (isOpportunityExpired(spawnedItem)) {
      return {
        ...state,
        opportunities: activeOpportunities,
      } satisfies MapSceneState;
    }

    return {
      ...state,
      opportunities: [
        ...activeOpportunities.filter((item) => item.spawnId !== spawnedItem.spawnId),
        spawnedItem,
      ],
    } satisfies MapSceneState;
  }

  if (event.type === "opportunity_claimed") {
    if (event.data.mapId !== state.mapId) {
      return state;
    }
    return {
      ...state,
      opportunities: activeOpportunities.filter((item) => item.spawnId !== event.data.spawnId),
    } satisfies MapSceneState;
  }

  return state;
}

export function applyMapSceneSnapshotToMapData<
  T extends {
    map: { id: string };
    player: { positionX: number; positionY: number };
    otherPlayers: MapScenePlayer[];
    npcs: MapSceneNpc[];
    monsters: MapSceneMonster[];
    opportunities: MapSceneOpportunity[];
  },
>(data: T, snapshot: MapSceneSnapshot): T {
  if (data.map.id !== snapshot.mapId) {
    return data;
  }
  const nowMs = Date.now();

  const selfEntity = snapshot.entities.find(
    (entity): entity is MapScenePlayerEntity => entity.entityType === "self",
  ) || null;
  const otherPlayers: MapScenePlayer[] = [];
  const npcs: MapSceneNpc[] = [];
  const monsters: MapSceneMonster[] = [];
  const opportunities: MapSceneOpportunity[] = [];
  let previousMonstersById: Map<string, MapSceneMonster> | null = null;

  snapshot.entities.forEach((entity) => {
    if (entity.entityType === "self") {
      return;
    }

    if (entity.entityType === "player") {
      otherPlayers.push({
        id: entity.id,
        name: entity.name,
        gender: entity.gender,
        avatarImageUrl: entity.avatarImageUrl,
        avatarFrameImageUrl: entity.avatarFrameImageUrl,
        realm: entity.realm,
        realmMajor: entity.realmMajor,
        realmMinor: entity.realmMinor,
        realmName: entity.realmName || "",
        positionX: entity.positionX,
        positionY: entity.positionY,
      });
      return;
    }

    if (entity.entityType === "npc") {
      npcs.push({
        id: entity.id,
        name: entity.name,
        title: entity.title,
        avatarImageUrl: entity.avatarImageUrl,
        positionX: entity.positionX,
        positionY: entity.positionY,
        isShop: entity.isShop,
        sourceType: entity.sourceType,
        detailRoute: entity.detailRoute,
        realmName: entity.realmName,
        currentActionLabel: entity.currentActionLabel,
        isKillable: entity.isKillable,
        status: entity.status,
      });
      return;
    }

    if (entity.entityType === "monster") {
      if (!previousMonstersById) {
        previousMonstersById = new Map(
          data.monsters.map((monster) => [monster.id, monster] as const),
        );
      }
      const previousMonster = previousMonstersById.get(entity.id);
      monsters.push({
        ...(previousMonster || {
          id: entity.id,
          name: entity.name,
          avatarImageUrl: entity.avatarImageUrl,
          monsterType: entity.monsterType,
          level: entity.level,
          hp: entity.hp,
          attack: entity.attack,
          defense: entity.defense,
          speed: entity.speed,
          drops: entity.drops ?? [],
          dropIntel: entity.dropIntel ?? [],
        }),
        name: entity.name,
        avatarImageUrl: entity.avatarImageUrl,
        monsterType: entity.monsterType,
        level: entity.level,
        hp: entity.hp,
        attack: entity.attack,
        defense: entity.defense,
        speed: entity.speed,
        drops: entity.drops ?? previousMonster?.drops ?? [],
        dropIntel: entity.dropIntel ?? previousMonster?.dropIntel ?? [],
        positionX: entity.positionX,
        positionY: entity.positionY,
      });
      return;
    }

    if (entity.entityType === "opportunity") {
      if (isOpportunityExpired(entity, nowMs)) {
        return;
      }
      opportunities.push({
        spawnId: entity.spawnId,
        eventId: entity.eventId,
        name: entity.name,
        iconImageUrl: entity.iconImageUrl,
        minRealm: entity.minRealm,
        maxRealm: entity.maxRealm,
        positionX: entity.positionX,
        positionY: entity.positionY,
        expiresAt: entity.expiresAt,
      });
    }
  });

  const nextPlayer = selfEntity
    ? {
      ...data.player,
      positionX: selfEntity.positionX,
      positionY: selfEntity.positionY,
    } as T["player"]
    : data.player;

  return {
    ...data,
    player: nextPlayer,
    otherPlayers,
    npcs,
    monsters,
    opportunities,
  } as T;
}
