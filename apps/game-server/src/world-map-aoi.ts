import {
  WORLD_MAP_AOI_RADIUS,
  WORLD_MAP_SECTOR_SIZE,
} from "@immortality/shared-protocol";
import type {
  WorldMapAoiEntity,
  WorldMapSectorAuthoritativeState,
  WorldMapSectorEnvelope,
  WorldMapSectorEvent,
} from "@immortality/shared-protocol";
import type { GameEntityState, GameRoomState } from "./state";

export interface WorldMapAoiState {
  sectorKeys: Set<string>;
  visibleEntityIds: Set<string>;
  visibleEntitySignatures: Map<string, string>;
}

export function getWorldMapSectorKey(position: { x: number; y: number }) {
  const sectorX = Math.floor(position.x / WORLD_MAP_SECTOR_SIZE);
  const sectorY = Math.floor(position.y / WORLD_MAP_SECTOR_SIZE);
  return `${sectorX}:${sectorY}`;
}

export function getWorldMapAoiSectorKeys(position: { x: number; y: number }) {
  const centerX = Math.floor(position.x / WORLD_MAP_SECTOR_SIZE);
  const centerY = Math.floor(position.y / WORLD_MAP_SECTOR_SIZE);
  const keys = new Set<string>();

  for (let y = centerY - WORLD_MAP_AOI_RADIUS; y <= centerY + WORLD_MAP_AOI_RADIUS; y += 1) {
    for (let x = centerX - WORLD_MAP_AOI_RADIUS; x <= centerX + WORLD_MAP_AOI_RADIUS; x += 1) {
      keys.add(`${x}:${y}`);
    }
  }

  return keys;
}

export function toWorldMapAoiEntity(entity: GameEntityState): WorldMapAoiEntity {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    x: entity.x,
    y: entity.y,
    velocityX: entity.velocityX,
    velocityY: entity.velocityY,
    updatedAt: entity.updatedAt,
    sectorKey: getWorldMapSectorKey(entity),
  };
}

export function collectVisibleWorldMapEntities(params: {
  entities: Iterable<GameEntityState>;
  sectorKeys: ReadonlySet<string>;
}) {
  const visibleEntities: WorldMapAoiEntity[] = [];

  for (const entity of params.entities) {
    const aoiEntity = toWorldMapAoiEntity(entity);
    if (params.sectorKeys.has(aoiEntity.sectorKey)) {
      visibleEntities.push(aoiEntity);
    }
  }

  return visibleEntities;
}

function createWorldMapAoiEntitySignature(entity: WorldMapAoiEntity) {
  return [
    entity.id,
    entity.kind,
    entity.name,
    entity.x,
    entity.y,
    entity.velocityX,
    entity.velocityY,
    entity.updatedAt,
    entity.sectorKey,
  ].join("|");
}

export function createWorldMapAoiState(params: {
  self: GameEntityState;
  entities: Iterable<GameEntityState>;
  privateEntities?: Iterable<GameEntityState>;
}) {
  const sectorKeys = getWorldMapAoiSectorKeys(params.self);
  const visibleEntities = collectVisibleWorldMapEntities({
    entities: [
      ...params.entities,
      ...(params.privateEntities ? [...params.privateEntities] : []),
    ],
    sectorKeys,
  });

  return {
    sectorKeys,
    visibleEntityIds: new Set(visibleEntities.map((entity) => entity.id)),
    visibleEntitySignatures: new Map(visibleEntities.map((entity) => [
      entity.id,
      createWorldMapAoiEntitySignature(entity),
    ] as const)),
  } satisfies WorldMapAoiState;
}

function createSectorAuthoritativeState(params: {
  roomState: GameRoomState;
  sectorKeys: ReadonlySet<string>;
  entities: WorldMapAoiEntity[];
}): WorldMapSectorAuthoritativeState {
  return {
    mapId: params.roomState.mapId,
    shardId: params.roomState.shardId,
    sectorSize: WORLD_MAP_SECTOR_SIZE,
    subscribedSectorKeys: [...params.sectorKeys].sort(),
    entities: params.entities,
  };
}

export function createWorldMapSectorSnapshot(params: {
  roomId: string;
  roomState: GameRoomState;
  self: GameEntityState;
  privateEntities?: Iterable<GameEntityState>;
  acceptedSequence?: number | null;
}): WorldMapSectorEnvelope {
  const sectorKeys = getWorldMapAoiSectorKeys(params.self);
  const entities = collectVisibleWorldMapEntities({
    entities: [
      ...params.roomState.entities.values(),
      ...(params.privateEntities ? [...params.privateEntities] : []),
    ],
    sectorKeys,
  });

  return {
    type: "sector_snapshot",
    serverTick: params.roomState.serverTick,
    roomId: params.roomId,
    snapshotVersion: params.roomState.snapshotVersion,
    acceptedSequence: params.acceptedSequence ?? null,
    authoritativeState: createSectorAuthoritativeState({
      roomState: params.roomState,
      sectorKeys,
      entities,
    }),
    events: [],
  };
}

export function createWorldMapSectorDelta(params: {
  roomId: string;
  roomState: GameRoomState;
  previousAoi: WorldMapAoiState | null;
  nextAoi: WorldMapAoiState;
  privateEntities?: Iterable<GameEntityState>;
  acceptedSequence?: number | null;
}): WorldMapSectorEnvelope | null {
  const previousVisibleIds = params.previousAoi?.visibleEntityIds || new Set<string>();
  const nextVisibleIds = params.nextAoi.visibleEntityIds;
  const nextVisibleEntities = collectVisibleWorldMapEntities({
    entities: [
      ...params.roomState.entities.values(),
      ...(params.privateEntities ? [...params.privateEntities] : []),
    ],
    sectorKeys: params.nextAoi.sectorKeys,
  });
  const nextVisibleEntityMap = new Map(nextVisibleEntities.map((entity) => [entity.id, entity] as const));
  const events: WorldMapSectorEvent[] = [];

  for (const entityId of previousVisibleIds) {
    if (!nextVisibleIds.has(entityId)) {
      events.push({ type: "entity_leave", entityId });
    }
  }

  for (const entityId of nextVisibleIds) {
    if (!previousVisibleIds.has(entityId)) {
      const entity = nextVisibleEntityMap.get(entityId);
      if (entity) {
        events.push({ type: "entity_enter", entity });
      }
      continue;
    }

    const entity = nextVisibleEntityMap.get(entityId);
    const previousSignature = params.previousAoi?.visibleEntitySignatures.get(entityId);
    const nextSignature = entity ? createWorldMapAoiEntitySignature(entity) : null;
    if (entity && previousSignature && nextSignature !== previousSignature) {
      events.push({ type: "entity_update", entity });
    }
  }

  const previousSectorSignature = params.previousAoi
    ? [...params.previousAoi.sectorKeys].sort().join("|")
    : "";
  const nextSectorSignature = [...params.nextAoi.sectorKeys].sort().join("|");
  const previousVisibleSignature = params.previousAoi
    ? [...params.previousAoi.visibleEntitySignatures.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entityId, signature]) => `${entityId}=${signature}`)
      .join("||")
    : "";
  const nextVisibleSignature = [...params.nextAoi.visibleEntitySignatures.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityId, signature]) => `${entityId}=${signature}`)
    .join("||");
  if (
    events.length === 0
    && previousSectorSignature === nextSectorSignature
    && previousVisibleSignature === nextVisibleSignature
  ) {
    return null;
  }

  return {
    type: "sector_delta",
    serverTick: params.roomState.serverTick,
    roomId: params.roomId,
    snapshotVersion: params.roomState.snapshotVersion,
    acceptedSequence: params.acceptedSequence ?? null,
    authoritativeState: createSectorAuthoritativeState({
      roomState: params.roomState,
      sectorKeys: params.nextAoi.sectorKeys,
      entities: nextVisibleEntities,
    }),
    events,
  };
}
