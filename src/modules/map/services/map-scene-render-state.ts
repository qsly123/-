import type {
  MapSceneEntity,
  MapSceneSnapshot,
} from "@/modules/map/services/map-scene-state";

export type MapSceneSelfCorrection = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAtMs: number;
  durationMs: number;
};

export type MapSceneRenderEntity = MapSceneEntity & {
  renderPositionX: number;
  renderPositionY: number;
  snappedRenderX: number;
  snappedRenderY: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampProgress(value: number) {
  return clamp(value, 0, 1);
}

function clampExtrapolationMs(value: number, maxExtrapolationMs: number) {
  return clamp(value, 0, maxExtrapolationMs);
}

function roundGridCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

function indexEntitiesById<T extends { id: string }>(entities: T[]) {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function resolveCorrectionPosition(params: {
  entity: MapSceneEntity;
  correction?: MapSceneSelfCorrection | null;
  renderTimeMs: number;
}) {
  const correction = params.correction;
  if (!correction || params.entity.entityType !== "self") {
    return {
      x: params.entity.positionX,
      y: params.entity.positionY,
    };
  }

  const durationMs = Math.max(1, correction.durationMs);
  const progress = clampProgress((params.renderTimeMs - correction.startedAtMs) / durationMs);
  const easedProgress = 1 - ((1 - progress) * (1 - progress));

  return {
    x: correction.fromX + ((correction.toX - correction.fromX) * easedProgress),
    y: correction.fromY + ((correction.toY - correction.fromY) * easedProgress),
  };
}

function resolveInterpolatedPosition(params: {
  currentEntity: MapSceneEntity;
  previousEntity?: MapSceneEntity | null;
  currentSnapshot: MapSceneSnapshot;
  previousSnapshot?: MapSceneSnapshot | null;
  sampleTimeMs: number;
  maxExtrapolationMs: number;
}) {
  const {
    currentEntity,
    previousEntity,
    currentSnapshot,
    previousSnapshot,
    sampleTimeMs,
    maxExtrapolationMs,
  } = params;

  if (
    previousSnapshot
    && previousEntity
    && previousSnapshot.sequence !== currentSnapshot.sequence
    && sampleTimeMs <= currentSnapshot.serverTimeMs
    && currentSnapshot.serverTimeMs > previousSnapshot.serverTimeMs
  ) {
    const progress = clampProgress(
      (sampleTimeMs - previousSnapshot.serverTimeMs)
      / (currentSnapshot.serverTimeMs - previousSnapshot.serverTimeMs),
    );
    return {
      x: previousEntity.positionX + ((currentEntity.positionX - previousEntity.positionX) * progress),
      y: previousEntity.positionY + ((currentEntity.positionY - previousEntity.positionY) * progress),
    };
  }

  const extrapolationSeconds = clampExtrapolationMs(
    sampleTimeMs - currentSnapshot.serverTimeMs,
    maxExtrapolationMs,
  ) / 1000;

  return {
    x: currentEntity.positionX + ((currentEntity.velocityXPerSecond || 0) * extrapolationSeconds),
    y: currentEntity.positionY + ((currentEntity.velocityYPerSecond || 0) * extrapolationSeconds),
  };
}

export function resolveMapSceneRenderEntities(params: {
  snapshot?: MapSceneSnapshot | null;
  previousSnapshot?: MapSceneSnapshot | null;
  renderTimeMs: number;
  interpolationDelayMs?: number;
  maxExtrapolationMs?: number;
  playerInterpolationDelayMs?: number;
  playerMaxExtrapolationMs?: number;
  selfCorrection?: MapSceneSelfCorrection | null;
}) {
  const snapshot = params.snapshot;
  if (!snapshot) {
    return [] as MapSceneRenderEntity[];
  }

  const previousSnapshot = params.previousSnapshot;
  const interpolationDelayMs = params.interpolationDelayMs ?? 120;
  const maxExtrapolationMs = params.maxExtrapolationMs ?? 80;
  const playerInterpolationDelayMs = params.playerInterpolationDelayMs ?? 40;
  const playerMaxExtrapolationMs = params.playerMaxExtrapolationMs ?? 140;
  const comparablePreviousSnapshot = previousSnapshot?.mapId === snapshot.mapId
    ? previousSnapshot
    : null;
  const previousEntityMap = indexEntitiesById(comparablePreviousSnapshot?.entities || []);

  return snapshot.entities.map((entity) => {
    const previousEntity = previousEntityMap.get(entity.id) || null;
    const nextPosition = entity.entityType === "self"
      ? resolveCorrectionPosition({
        entity,
        correction: params.selfCorrection,
        renderTimeMs: params.renderTimeMs,
      })
      : resolveInterpolatedPosition({
        currentEntity: entity,
        previousEntity,
        currentSnapshot: snapshot,
        previousSnapshot: comparablePreviousSnapshot,
        sampleTimeMs: params.renderTimeMs - (
          entity.entityType === "player"
            ? playerInterpolationDelayMs
            : interpolationDelayMs
        ),
        maxExtrapolationMs: entity.entityType === "player"
          ? playerMaxExtrapolationMs
          : maxExtrapolationMs,
      });

    return {
      ...entity,
      renderPositionX: nextPosition.x,
      renderPositionY: nextPosition.y,
      snappedRenderX: roundGridCoordinate(nextPosition.x),
      snappedRenderY: roundGridCoordinate(nextPosition.y),
    } satisfies MapSceneRenderEntity;
  });
}

export function isMapSceneSelfCorrectionActive(
  correction?: MapSceneSelfCorrection | null,
  nowMs = Date.now(),
) {
  if (!correction) {
    return false;
  }
  return nowMs < correction.startedAtMs + Math.max(1, correction.durationMs);
}
