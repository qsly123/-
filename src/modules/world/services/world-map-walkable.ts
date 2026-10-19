import type { TileData } from "@/types/game";

type Point = {
  x: number;
  y: number;
};

type WalkablePositionParams = {
  x: number;
  y: number;
  width: number;
  height: number;
  blockedTileKeys: Set<string>;
};

type ResolveNearestWalkableParams = {
  preferred: Point;
  width: number;
  height: number;
  blockedTileKeys: Set<string>;
  candidatePoints?: Point[];
  maxRadius?: number;
  reservedTileKeys?: Set<string>;
  avoidPoints?: Point[];
  minDistanceFromAvoidPoints?: number;
};

const DEFAULT_NEAREST_SEARCH_RADIUS = 24;

function buildTileKey(x: number, y: number) {
  return `${x},${y}`;
}

function clampToWorldMap(value: number, max: number) {
  return Math.max(1, Math.min(max - 2, value));
}

function normalizeTileList(tilesData: TileData[] | unknown) {
  return Array.isArray(tilesData) ? tilesData as TileData[] : [];
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function dedupePoints(points: Point[]) {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = buildTileKey(point.x, point.y);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function chebyshevDistance(left: Point, right: Point) {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
  );
}

function isCandidateAvailable(params: {
  point: Point;
  width: number;
  height: number;
  blockedTileKeys: Set<string>;
  reservedTileKeys?: Set<string>;
  avoidPoints?: Point[];
  minDistanceFromAvoidPoints?: number;
}) {
  if (!isWorldMapWalkablePosition({
    x: params.point.x,
    y: params.point.y,
    width: params.width,
    height: params.height,
    blockedTileKeys: params.blockedTileKeys,
  })) {
    return false;
  }

  const tileKey = buildTileKey(params.point.x, params.point.y);
  if (params.reservedTileKeys?.has(tileKey)) {
    return false;
  }

  const minDistance = Math.max(0, Math.floor(Number(params.minDistanceFromAvoidPoints || 0)));
  if (minDistance > 0) {
    const avoidPoints = dedupePoints((params.avoidPoints || []).map((point) => ({
      x: clampToWorldMap(point.x, params.width),
      y: clampToWorldMap(point.y, params.height),
    })));
    if (avoidPoints.some((occupiedPoint) => chebyshevDistance(occupiedPoint, params.point) < minDistance)) {
      return false;
    }
  }

  return true;
}

export function buildWorldMapBlockedTileKeySet(tilesData: TileData[] | unknown, width: number, height: number) {
  const blockedTileKeys = new Set<string>();
  const tiles = normalizeTileList(tilesData);

  for (const tile of tiles) {
    if (
      Number.isInteger(tile?.x)
      && Number.isInteger(tile?.y)
      && tile.x >= 0
      && tile.x < width
      && tile.y >= 0
      && tile.y < height
      && tile.walkable === false
    ) {
      blockedTileKeys.add(buildTileKey(tile.x, tile.y));
    }
  }

  return blockedTileKeys;
}

export function isWorldMapWalkablePosition(params: WalkablePositionParams) {
  const x = clampToWorldMap(params.x, params.width);
  const y = clampToWorldMap(params.y, params.height);
  return !params.blockedTileKeys.has(buildTileKey(x, y));
}

export function resolveNearestWorldMapWalkablePosition(params: ResolveNearestWalkableParams) {
  const preferred = {
    x: clampToWorldMap(params.preferred.x, params.width),
    y: clampToWorldMap(params.preferred.y, params.height),
  };
  const maxRadius = Math.max(1, params.maxRadius ?? DEFAULT_NEAREST_SEARCH_RADIUS);
  const candidatePoints = dedupePoints((params.candidatePoints || []).map((point) => ({
    x: clampToWorldMap(point.x, params.width),
    y: clampToWorldMap(point.y, params.height),
  })));

  if (isCandidateAvailable({
    point: preferred,
    width: params.width,
    height: params.height,
    blockedTileKeys: params.blockedTileKeys,
    reservedTileKeys: params.reservedTileKeys,
    avoidPoints: params.avoidPoints,
    minDistanceFromAvoidPoints: params.minDistanceFromAvoidPoints,
  })) {
    return preferred;
  }

  const sortedCandidates = candidatePoints
    .map((point) => ({
      point,
      distance: Math.max(
        Math.abs(point.x - preferred.x),
        Math.abs(point.y - preferred.y),
      ),
    }))
    .sort((left, right) => left.distance - right.distance);

  for (const candidate of sortedCandidates) {
    if (isCandidateAvailable({
      point: candidate.point,
      width: params.width,
      height: params.height,
      blockedTileKeys: params.blockedTileKeys,
      reservedTileKeys: params.reservedTileKeys,
      avoidPoints: params.avoidPoints,
      minDistanceFromAvoidPoints: params.minDistanceFromAvoidPoints,
    })) {
      return candidate.point;
    }
  }

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let y = preferred.y - radius; y <= preferred.y + radius; y += 1) {
      for (let x = preferred.x - radius; x <= preferred.x + radius; x += 1) {
        if (
          Math.max(Math.abs(x - preferred.x), Math.abs(y - preferred.y)) !== radius
        ) {
          continue;
        }
        const candidate = {
          x: clampToWorldMap(x, params.width),
          y: clampToWorldMap(y, params.height),
        };
        if (isCandidateAvailable({
          point: candidate,
          width: params.width,
          height: params.height,
          blockedTileKeys: params.blockedTileKeys,
          reservedTileKeys: params.reservedTileKeys,
          avoidPoints: params.avoidPoints,
          minDistanceFromAvoidPoints: params.minDistanceFromAvoidPoints,
        })) {
          return candidate;
        }
      }
    }
  }

  for (let y = 1; y < params.height - 1; y += 1) {
    for (let x = 1; x < params.width - 1; x += 1) {
      if (isCandidateAvailable({
        point: { x, y },
        width: params.width,
        height: params.height,
        blockedTileKeys: params.blockedTileKeys,
        reservedTileKeys: params.reservedTileKeys,
        avoidPoints: params.avoidPoints,
        minDistanceFromAvoidPoints: params.minDistanceFromAvoidPoints,
      })) {
        return { x, y };
      }
    }
  }

  return preferred;
}

export function resolveOpenWorldNpcSpawnPoint(params: {
  seed: string;
  index: number;
  preferredPoints: Point[];
  tilesData: TileData[] | unknown;
  width: number;
  height: number;
  occupiedPoints?: Point[];
  minDistanceFromOccupiedPoints?: number;
}) {
  const blockedTileKeys = buildWorldMapBlockedTileKeySet(params.tilesData, params.width, params.height);
  const normalizedPreferredPoints = dedupePoints(params.preferredPoints.map((point) => ({
    x: clampToWorldMap(point.x, params.width),
    y: clampToWorldMap(point.y, params.height),
  })));
  const walkablePreferredPoints = normalizedPreferredPoints.filter((point) => isCandidateAvailable({
    point,
    width: params.width,
    height: params.height,
    blockedTileKeys,
    avoidPoints: params.occupiedPoints,
    minDistanceFromAvoidPoints: params.minDistanceFromOccupiedPoints,
  }));

  if (walkablePreferredPoints.length > 0) {
    const preferredIndex = (hashSeed(`${params.seed}:${params.index}`) + params.index) % walkablePreferredPoints.length;
    return walkablePreferredPoints[preferredIndex];
  }

  const fallbackBasePoint = normalizedPreferredPoints[params.index % Math.max(1, normalizedPreferredPoints.length)] || {
    x: Math.floor(params.width / 2),
    y: Math.floor(params.height / 2),
  };
  return resolveNearestWorldMapWalkablePosition({
    preferred: fallbackBasePoint,
    width: params.width,
    height: params.height,
    blockedTileKeys,
    candidatePoints: normalizedPreferredPoints,
    avoidPoints: params.occupiedPoints,
    minDistanceFromAvoidPoints: params.minDistanceFromOccupiedPoints,
  });
}
