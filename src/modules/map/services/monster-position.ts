import { getRuntimeMonsterById, listRuntimeMonstersByMapId } from "@/modules/map/services/runtime-monster-store";

export const DEFAULT_MAP_ID = "map_starter_village";
export const DEFAULT_MONSTER_INTERACTION_DISTANCE = 1;

export type MonsterPositionSource = {
  mapId: string;
  positionX: number;
  positionY: number;
  currentPositionX: number | null;
  currentPositionY: number | null;
};

export type MonsterPositionSnapshot = {
  id: string;
  mapId: string;
  monsterType: string;
  spawnX: number;
  spawnY: number;
  positionX: number;
  positionY: number;
};

export function resolveMonsterCurrentPosition(source: MonsterPositionSource) {
  return {
    positionX: source.currentPositionX ?? source.positionX,
    positionY: source.currentPositionY ?? source.positionY,
  };
}

export function getMonsterChebyshevDistance(params: {
  playerPositionX: number;
  playerPositionY: number;
  monsterPositionX: number;
  monsterPositionY: number;
}) {
  return Math.max(
    Math.abs(params.playerPositionX - params.monsterPositionX),
    Math.abs(params.playerPositionY - params.monsterPositionY),
  );
}

export function isPlayerNearMonster(params: {
  playerMapId: string | null;
  playerPositionX: number;
  playerPositionY: number;
  monster: MonsterPositionSource;
  maxDistance?: number;
}) {
  const playerMapId = params.playerMapId || DEFAULT_MAP_ID;
  if (playerMapId !== params.monster.mapId) {
    return {
      allowed: false,
      reason: "map" as const,
      distance: Number.POSITIVE_INFINITY,
      ...resolveMonsterCurrentPosition(params.monster),
    };
  }

  const monsterPosition = resolveMonsterCurrentPosition(params.monster);
  const distance = getMonsterChebyshevDistance({
    playerPositionX: params.playerPositionX,
    playerPositionY: params.playerPositionY,
    monsterPositionX: monsterPosition.positionX,
    monsterPositionY: monsterPosition.positionY,
  });

  return {
    allowed: distance <= (params.maxDistance ?? DEFAULT_MONSTER_INTERACTION_DISTANCE),
    reason: distance <= (params.maxDistance ?? DEFAULT_MONSTER_INTERACTION_DISTANCE) ? null : "distance" as const,
    distance,
    ...monsterPosition,
  };
}

export async function getMonsterPositionSnapshot(monsterId: string): Promise<MonsterPositionSnapshot | null> {
  const row = await getRuntimeMonsterById(monsterId);

  if (!row) {
    return null;
  }

  const currentPosition = resolveMonsterCurrentPosition(row);
  return {
    id: row.id,
    mapId: row.mapId,
    monsterType: row.monsterType,
    spawnX: row.positionX,
    spawnY: row.positionY,
    positionX: currentPosition.positionX,
    positionY: currentPosition.positionY,
  };
}

export async function listMonsterPositionSnapshotsByMap(mapId: string): Promise<MonsterPositionSnapshot[]> {
  const rows = await listRuntimeMonstersByMapId(mapId);

  return rows.map((row) => {
    const currentPosition = resolveMonsterCurrentPosition(row);
    return {
      id: row.id,
      mapId: row.mapId,
      monsterType: row.monsterType,
      spawnX: row.positionX,
      spawnY: row.positionY,
      positionX: currentPosition.positionX,
      positionY: currentPosition.positionY,
    } satisfies MonsterPositionSnapshot;
  });
}
