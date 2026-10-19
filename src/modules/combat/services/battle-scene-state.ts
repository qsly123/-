import {
  getBattleSceneAnchorMap,
  type BattleSceneMode,
  type BattleSceneMoveState,
  type BattleSceneUnit,
} from "@/modules/combat/services/battle-scene";
import {
  REALTIME_ENTITY_SCHEMA,
  REALTIME_ENTITY_SCHEMA_VERSION,
} from "@/modules/shared/services/realtime-scene-schema.mjs";

export type BattleSceneStateUnit = BattleSceneUnit & {
  xPercent: number;
  yPercent: number;
  velocityXPercentPerSecond: number;
  velocityYPercentPerSecond: number;
  headingDegrees: number;
  moveState: BattleSceneMoveState;
  targetXPercent: number;
  targetYPercent: number;
};

export type BattleSceneTimelineEvent = {
  id: string;
  channel?: "action" | "movement";
  actorId: string;
  targetId?: string | null;
  startedAtMs: number;
  windupMs: number;
  activeMs: number;
  recoverMs: number;
  actorAdvancePercent: number;
  targetRecoilPercent: number;
};

export type BattleSceneSnapshot = {
  entitySchema?: string;
  entitySchemaVersion?: number;
  codecSchema?: string;
  battleMode?: "solo" | "party" | "boss" | "pvp";
  runtimeVersion?: number;
  sceneVersion?: number;
  sequence: number;
  connectionSequence?: number;
  baseConnectionSequence?: number;
  tick: number;
  entitiesRevision?: number;
  serverTimeMs: number;
  mode?: "full" | "delta" | "repair";
  removedUnitIds?: string[];
  units: BattleSceneStateUnit[];
  timeline?: BattleSceneTimelineEvent[];
};

export type BattleScenePositionOverride = {
  xPercent?: number;
  yPercent?: number;
};

export type BattleSceneRenderUnit = BattleSceneStateUnit & {
  renderXPercent: number;
  renderYPercent: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampPercent(value: number) {
  return clamp(value, 0, 100);
}

function indexUnitsById<T extends { id: string }>(units: T[]) {
  return new Map(units.map((unit) => [unit.id, unit]));
}

function normalizeFiniteNumber(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeBattleSceneUnit(unit: BattleSceneStateUnit): BattleSceneStateUnit {
  const normalizedMoveState: BattleSceneMoveState = unit.moveState === "moving" || unit.moveState === "locked" || unit.moveState === "attacking"
    ? unit.moveState
    : "idle";
  return {
    ...unit,
    xPercent: normalizeFiniteNumber(unit.xPercent, 0),
    yPercent: normalizeFiniteNumber(unit.yPercent, 0),
    velocityXPercentPerSecond: normalizeFiniteNumber(unit.velocityXPercentPerSecond, 0),
    velocityYPercentPerSecond: normalizeFiniteNumber(unit.velocityYPercentPerSecond, 0),
    headingDegrees: normalizeFiniteNumber(unit.headingDegrees, 0),
    moveState: normalizedMoveState,
    targetXPercent: normalizeFiniteNumber(unit.targetXPercent, unit.xPercent),
    targetYPercent: normalizeFiniteNumber(unit.targetYPercent, unit.yPercent),
  };
}

function normalizeBattleSceneTimelineEvent(event: BattleSceneTimelineEvent): BattleSceneTimelineEvent {
  return {
    ...event,
    channel: event.channel === "movement" ? "movement" : "action",
    startedAtMs: Math.max(0, Math.floor(normalizeFiniteNumber(event.startedAtMs, 0))),
    windupMs: Math.max(0, Math.floor(normalizeFiniteNumber(event.windupMs, 0))),
    activeMs: Math.max(0, Math.floor(normalizeFiniteNumber(event.activeMs, 0))),
    recoverMs: Math.max(0, Math.floor(normalizeFiniteNumber(event.recoverMs, 0))),
    actorAdvancePercent: normalizeFiniteNumber(event.actorAdvancePercent, 0),
    targetRecoilPercent: normalizeFiniteNumber(event.targetRecoilPercent, 0),
  };
}

function normalizeSceneSequence(value: number | undefined, fallback = 0) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? Math.max(0, Math.floor(nextValue)) : fallback;
}

function cloneBattleSceneUnit(unit: BattleSceneStateUnit) {
  return {
    ...unit,
  };
}

function cloneBattleSceneTimelineEvent(event: BattleSceneTimelineEvent) {
  return {
    ...event,
  };
}

function areNullableStringsEqual(left: string | null | undefined, right: string | null | undefined) {
  return (left || null) === (right || null);
}

function areBattleSceneTimelineEventsEqual(
  previousEvent: BattleSceneTimelineEvent | undefined,
  nextEvent: BattleSceneTimelineEvent,
) {
  if (!previousEvent) {
    return false;
  }
  return previousEvent.id === nextEvent.id
    && (previousEvent.channel || "action") === (nextEvent.channel || "action")
    && previousEvent.actorId === nextEvent.actorId
    && areNullableStringsEqual(previousEvent.targetId, nextEvent.targetId)
    && previousEvent.startedAtMs === nextEvent.startedAtMs
    && previousEvent.windupMs === nextEvent.windupMs
    && previousEvent.activeMs === nextEvent.activeMs
    && previousEvent.recoverMs === nextEvent.recoverMs
    && previousEvent.actorAdvancePercent === nextEvent.actorAdvancePercent
    && previousEvent.targetRecoilPercent === nextEvent.targetRecoilPercent;
}

export function cloneBattleSceneSnapshot(snapshot: BattleSceneSnapshot | null | undefined) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    removedUnitIds: Array.isArray(snapshot.removedUnitIds) ? [...snapshot.removedUnitIds] : [],
    units: Array.isArray(snapshot.units) ? snapshot.units.map((unit) => cloneBattleSceneUnit(unit)) : [],
    timeline: Array.isArray(snapshot.timeline)
      ? snapshot.timeline.map((event) => cloneBattleSceneTimelineEvent(event))
      : [],
  } satisfies BattleSceneSnapshot;
}

function areBattleSceneUnitsEqual(
  previousUnit: BattleSceneStateUnit | undefined,
  nextUnit: BattleSceneStateUnit,
) {
  if (!previousUnit) {
    return false;
  }
  return previousUnit.id === nextUnit.id
    && areNullableStringsEqual(previousUnit.name, nextUnit.name)
    && previousUnit.role === nextUnit.role
    && (previousUnit.slot ?? null) === (nextUnit.slot ?? null)
    && areNullableStringsEqual(previousUnit.avatarImageUrl, nextUnit.avatarImageUrl)
    && areNullableStringsEqual(previousUnit.avatarFrameImageUrl, nextUnit.avatarFrameImageUrl)
    && Boolean(previousUnit.isCurrent) === Boolean(nextUnit.isCurrent)
    && previousUnit.xPercent === nextUnit.xPercent
    && previousUnit.yPercent === nextUnit.yPercent
    && previousUnit.velocityXPercentPerSecond === nextUnit.velocityXPercentPerSecond
    && previousUnit.velocityYPercentPerSecond === nextUnit.velocityYPercentPerSecond
    && previousUnit.headingDegrees === nextUnit.headingDegrees
    && previousUnit.moveState === nextUnit.moveState
    && previousUnit.targetXPercent === nextUnit.targetXPercent
    && previousUnit.targetYPercent === nextUnit.targetYPercent;
}

function areBattleSceneTimelinesEqual(
  previousTimeline: BattleSceneTimelineEvent[] | undefined,
  nextTimeline: BattleSceneTimelineEvent[] | undefined,
) {
  const left = Array.isArray(previousTimeline) ? previousTimeline : [];
  const right = Array.isArray(nextTimeline) ? nextTimeline : [];
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areBattleSceneTimelineEventsEqual(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function resolveFallbackHeadingDegrees(role: BattleSceneUnit["role"]) {
  if (role === "enemy" || role === "boss") {
    return 90;
  }
  return -90;
}

function resolveHeadingDegrees(params: {
  role: BattleSceneUnit["role"];
  currentXPercent: number;
  currentYPercent: number;
  targetXPercent: number;
  targetYPercent: number;
  velocityXPercentPerSecond: number;
  velocityYPercentPerSecond: number;
  previousUnit?: BattleSceneStateUnit;
  explicitHeadingDegrees?: number | null;
}) {
  if (Number.isFinite(params.explicitHeadingDegrees)) {
    return Number(params.explicitHeadingDegrees);
  }

  const targetDx = params.targetXPercent - params.currentXPercent;
  const targetDy = params.targetYPercent - params.currentYPercent;
  if (Math.abs(targetDx) > 0.02 || Math.abs(targetDy) > 0.02) {
    return Math.atan2(targetDy, targetDx) * (180 / Math.PI);
  }

  if (Math.abs(params.velocityXPercentPerSecond) > 0.01 || Math.abs(params.velocityYPercentPerSecond) > 0.01) {
    return Math.atan2(params.velocityYPercentPerSecond, params.velocityXPercentPerSecond) * (180 / Math.PI);
  }

  if (params.previousUnit) {
    return params.previousUnit.headingDegrees;
  }

  return resolveFallbackHeadingDegrees(params.role);
}

function resolveMoveState(params: {
  currentXPercent: number;
  currentYPercent: number;
  targetXPercent: number;
  targetYPercent: number;
  velocityXPercentPerSecond: number;
  velocityYPercentPerSecond: number;
  explicitMoveState?: BattleSceneMoveState | null;
}): BattleSceneMoveState {
  if (params.explicitMoveState === "locked" || params.explicitMoveState === "attacking") {
    return params.explicitMoveState;
  }
  if (params.explicitMoveState === "moving") {
    return "moving";
  }

  const hasTargetGap = Math.abs(params.targetXPercent - params.currentXPercent) > 0.05
    || Math.abs(params.targetYPercent - params.currentYPercent) > 0.05;
  if (hasTargetGap) {
    return "moving";
  }

  const hasVelocity = Math.abs(params.velocityXPercentPerSecond) > 0.01
    || Math.abs(params.velocityYPercentPerSecond) > 0.01;
  return hasVelocity ? "moving" : "idle";
}

export function createBattleSceneDeltaSnapshot(
  previousSnapshot: BattleSceneSnapshot | null | undefined,
  nextSnapshot: BattleSceneSnapshot,
  options?: { mode?: "delta" | "repair" },
) {
  const clonedNextSnapshot = cloneBattleSceneSnapshot(nextSnapshot);
  if (!clonedNextSnapshot) {
    return null;
  }

  if (!previousSnapshot) {
    return {
      ...clonedNextSnapshot,
      mode: "full",
      removedUnitIds: [],
    } satisfies BattleSceneSnapshot;
  }

  const previousUnitsById = indexUnitsById(previousSnapshot.units || []);
  const nextUnitsById = indexUnitsById(clonedNextSnapshot.units || []);
  const changedUnits = clonedNextSnapshot.units.filter((unit) => !areBattleSceneUnitsEqual(previousUnitsById.get(unit.id), unit));
  const removedUnitIds = (previousSnapshot.units || [])
    .filter((unit) => !nextUnitsById.has(unit.id))
    .map((unit) => unit.id);
  const timelineChanged = !areBattleSceneTimelinesEqual(previousSnapshot.timeline, clonedNextSnapshot.timeline);

  return {
    entitySchema: clonedNextSnapshot.entitySchema,
    entitySchemaVersion: clonedNextSnapshot.entitySchemaVersion,
    codecSchema: clonedNextSnapshot.codecSchema,
    battleMode: clonedNextSnapshot.battleMode,
    runtimeVersion: normalizeSceneSequence(clonedNextSnapshot.runtimeVersion, previousSnapshot.runtimeVersion ?? 1),
    sceneVersion: normalizeSceneSequence(clonedNextSnapshot.sceneVersion, previousSnapshot.sceneVersion ?? clonedNextSnapshot.sequence),
    sequence: clonedNextSnapshot.sequence,
    connectionSequence: normalizeSceneSequence(
      clonedNextSnapshot.connectionSequence,
      clonedNextSnapshot.sequence,
    ),
    baseConnectionSequence: normalizeSceneSequence(
      previousSnapshot.connectionSequence,
      previousSnapshot.sequence,
    ),
    tick: clonedNextSnapshot.tick,
    entitiesRevision: normalizeSceneSequence(
      clonedNextSnapshot.entitiesRevision,
      clonedNextSnapshot.connectionSequence ?? clonedNextSnapshot.sequence,
    ),
    serverTimeMs: clonedNextSnapshot.serverTimeMs,
    mode: options?.mode || "delta",
    removedUnitIds,
    units: changedUnits,
    ...(timelineChanged
      ? {
        timeline: (clonedNextSnapshot.timeline || []).map((event) => normalizeBattleSceneTimelineEvent(event)),
      }
      : {}),
  } satisfies BattleSceneSnapshot;
}

export function hasMeaningfulBattleSceneDeltaSnapshot(snapshot: BattleSceneSnapshot | null | undefined) {
  if (!snapshot || (snapshot.mode !== "delta" && snapshot.mode !== "repair")) {
    return false;
  }

  return (snapshot.units?.length || 0) > 0
    || (snapshot.removedUnitIds?.length || 0) > 0
    || Array.isArray(snapshot.timeline);
}

export function createBattleSceneSnapshot(params: {
  mode: BattleSceneMode;
  units: BattleSceneUnit[];
  sequence: number;
  tick?: number;
  serverTimeMs: number;
  previousSnapshot?: BattleSceneSnapshot | null;
  timeline?: BattleSceneTimelineEvent[];
  positionOverrides?: Record<string, BattleScenePositionOverride>;
  battleMode?: "solo" | "party" | "boss" | "pvp";
}) {
  const anchorMap = getBattleSceneAnchorMap(params.mode, params.units);
  const previousUnits = indexUnitsById(params.previousSnapshot?.units || []);
  const previousTimeMs = params.previousSnapshot?.serverTimeMs || 0;
  const elapsedMs = Math.max(1, params.serverTimeMs - previousTimeMs);
  const elapsedSeconds = elapsedMs / 1000;

  const units = params.units.map((unit) => {
    const anchor = anchorMap.get(unit.id) || { xPercent: 50, yPercent: 50 };
    const override = params.positionOverrides?.[unit.id];
    const resolvedXPercent = clampPercent(override?.xPercent ?? anchor.xPercent);
    const resolvedYPercent = clampPercent(override?.yPercent ?? anchor.yPercent);
    const previousUnit = previousUnits.get(unit.id);
    const velocityXPercentPerSecond = previousUnit
      ? (resolvedXPercent - previousUnit.xPercent) / elapsedSeconds
      : 0;
    const velocityYPercentPerSecond = previousUnit
      ? (resolvedYPercent - previousUnit.yPercent) / elapsedSeconds
      : 0;
    const targetXPercent = clampPercent(
      normalizeFiniteNumber(unit.targetXPercent ?? previousUnit?.targetXPercent, resolvedXPercent),
    );
    const targetYPercent = clampPercent(
      normalizeFiniteNumber(unit.targetYPercent ?? previousUnit?.targetYPercent, resolvedYPercent),
    );
    const headingDegrees = resolveHeadingDegrees({
      role: unit.role,
      currentXPercent: resolvedXPercent,
      currentYPercent: resolvedYPercent,
      targetXPercent,
      targetYPercent,
      velocityXPercentPerSecond,
      velocityYPercentPerSecond,
      previousUnit,
      explicitHeadingDegrees: unit.headingDegrees,
    });
    const moveState = resolveMoveState({
      currentXPercent: resolvedXPercent,
      currentYPercent: resolvedYPercent,
      targetXPercent,
      targetYPercent,
      velocityXPercentPerSecond,
      velocityYPercentPerSecond,
      explicitMoveState: unit.moveState,
    });

    return {
      ...unit,
      xPercent: resolvedXPercent,
      yPercent: resolvedYPercent,
      velocityXPercentPerSecond,
      velocityYPercentPerSecond,
      headingDegrees,
      moveState,
      targetXPercent,
      targetYPercent,
    };
  });

  return {
    entitySchema: REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: REALTIME_ENTITY_SCHEMA_VERSION,
    battleMode: params.battleMode,
    runtimeVersion: normalizeSceneSequence(params.previousSnapshot?.runtimeVersion, 1),
    sceneVersion: normalizeSceneSequence(params.previousSnapshot?.sceneVersion, 0) + 1,
    sequence: params.sequence,
    connectionSequence: params.sequence,
    baseConnectionSequence: params.previousSnapshot?.connectionSequence ?? params.previousSnapshot?.sequence,
    tick: params.tick ?? params.sequence,
    entitiesRevision: normalizeSceneSequence(params.previousSnapshot?.entitiesRevision, 0) + 1,
    serverTimeMs: params.serverTimeMs,
    mode: "full",
    removedUnitIds: [],
    units,
    timeline: params.timeline || [],
  } satisfies BattleSceneSnapshot;
}

export function materializeBattleSceneSnapshot(
  previousSnapshot: BattleSceneSnapshot | null | undefined,
  incomingSnapshot: BattleSceneSnapshot | null | undefined,
) {
  if (!incomingSnapshot) {
    return null;
  }

  const mode = incomingSnapshot.mode || "full";
  const incomingConnectionSequence = normalizeSceneSequence(
    incomingSnapshot.connectionSequence,
    incomingSnapshot.sequence,
  );
  const previousConnectionSequence = normalizeSceneSequence(
    previousSnapshot?.connectionSequence,
    previousSnapshot?.sequence,
  );
  const incomingBaseConnectionSequence = normalizeSceneSequence(
    incomingSnapshot.baseConnectionSequence,
    incomingConnectionSequence,
  );

  if ((mode === "delta" || mode === "repair") && previousSnapshot) {
    if (incomingBaseConnectionSequence !== previousConnectionSequence) {
      return null;
    }
  }

  if (!previousSnapshot || mode === "full") {
    return {
      ...incomingSnapshot,
      runtimeVersion: normalizeSceneSequence(incomingSnapshot.runtimeVersion, previousSnapshot?.runtimeVersion ?? 1),
      sceneVersion: normalizeSceneSequence(incomingSnapshot.sceneVersion, previousSnapshot?.sceneVersion ?? incomingSnapshot.sequence),
      connectionSequence: incomingConnectionSequence,
      battleMode: incomingSnapshot.battleMode ?? previousSnapshot?.battleMode,
      baseConnectionSequence: incomingSnapshot.baseConnectionSequence,
      entitiesRevision: normalizeSceneSequence(
        incomingSnapshot.entitiesRevision,
        incomingSnapshot.connectionSequence ?? incomingSnapshot.sequence ?? incomingSnapshot.units.length,
      ),
      mode,
      removedUnitIds: Array.isArray(incomingSnapshot.removedUnitIds) ? [...incomingSnapshot.removedUnitIds] : [],
      units: (incomingSnapshot.units || []).map((unit) => normalizeBattleSceneUnit(unit)),
      timeline: (incomingSnapshot.timeline || []).map((event) => normalizeBattleSceneTimelineEvent(event)),
    } satisfies BattleSceneSnapshot;
  }

  const previousUnitsById = indexUnitsById(previousSnapshot.units || []);
  for (const unit of incomingSnapshot.units || []) {
    previousUnitsById.set(unit.id, normalizeBattleSceneUnit(unit));
  }
  for (const removedUnitId of incomingSnapshot.removedUnitIds || []) {
    previousUnitsById.delete(removedUnitId);
  }

  const orderedUnits: BattleSceneStateUnit[] = [];
  const emittedIds = new Set<string>();
  for (const unit of incomingSnapshot.units || []) {
    const nextUnit = previousUnitsById.get(unit.id);
    if (!nextUnit || emittedIds.has(unit.id)) {
      continue;
    }
    orderedUnits.push(nextUnit);
    emittedIds.add(unit.id);
  }
  for (const unit of previousSnapshot.units || []) {
    const nextUnit = previousUnitsById.get(unit.id);
    if (!nextUnit || emittedIds.has(unit.id)) {
      continue;
    }
    orderedUnits.push(nextUnit);
    emittedIds.add(unit.id);
  }

  return {
    ...previousSnapshot,
    ...incomingSnapshot,
    runtimeVersion: normalizeSceneSequence(incomingSnapshot.runtimeVersion, previousSnapshot.runtimeVersion ?? 1),
    sceneVersion: normalizeSceneSequence(incomingSnapshot.sceneVersion, previousSnapshot.sceneVersion ?? previousSnapshot.sequence),
    connectionSequence: normalizeSceneSequence(
      incomingSnapshot.connectionSequence,
      incomingSnapshot.sequence ?? previousSnapshot.connectionSequence ?? previousSnapshot.sequence,
    ),
      battleMode: incomingSnapshot.battleMode ?? previousSnapshot.battleMode,
      baseConnectionSequence: incomingSnapshot.baseConnectionSequence ?? previousSnapshot.connectionSequence,
      entitiesRevision: normalizeSceneSequence(
        incomingSnapshot.entitiesRevision,
        previousSnapshot.entitiesRevision ?? previousSnapshot.connectionSequence ?? previousSnapshot.sequence,
      ),
      mode,
      removedUnitIds: Array.isArray(incomingSnapshot.removedUnitIds) ? [...incomingSnapshot.removedUnitIds] : [],
      units: orderedUnits,
      timeline: Array.isArray(incomingSnapshot.timeline)
        ? incomingSnapshot.timeline.map((event) => normalizeBattleSceneTimelineEvent(event))
        : (previousSnapshot.timeline || []).map((event) => normalizeBattleSceneTimelineEvent(event)),
    } satisfies BattleSceneSnapshot;
}

function resolveBaseRenderUnits(params: {
  snapshot: BattleSceneSnapshot;
  previousSnapshot?: BattleSceneSnapshot | null;
  sampleTimeMs: number;
  maxExtrapolationMs: number;
}) {
  const { snapshot, previousSnapshot, sampleTimeMs, maxExtrapolationMs } = params;
  const previousUnits = indexUnitsById(previousSnapshot?.units || []);

  if (
    previousSnapshot
    && previousSnapshot.sequence !== snapshot.sequence
    && sampleTimeMs <= snapshot.serverTimeMs
    && snapshot.serverTimeMs > previousSnapshot.serverTimeMs
  ) {
    const progress = clamp(
      (sampleTimeMs - previousSnapshot.serverTimeMs) / (snapshot.serverTimeMs - previousSnapshot.serverTimeMs),
      0,
      1,
    );

    return snapshot.units.map((unit) => {
      const previousUnit = previousUnits.get(unit.id);
      if (!previousUnit) {
        return {
          ...unit,
          renderXPercent: unit.xPercent,
          renderYPercent: unit.yPercent,
        };
      }

      return {
        ...unit,
        renderXPercent: clampPercent(previousUnit.xPercent + ((unit.xPercent - previousUnit.xPercent) * progress)),
        renderYPercent: clampPercent(previousUnit.yPercent + ((unit.yPercent - previousUnit.yPercent) * progress)),
      };
    });
  }

  const extrapolationSeconds = clamp(
    sampleTimeMs - snapshot.serverTimeMs,
    0,
    maxExtrapolationMs,
  ) / 1000;

  return snapshot.units.map((unit) => {
    const extrapolatedXPercent = unit.xPercent + (unit.velocityXPercentPerSecond * extrapolationSeconds);
    const extrapolatedYPercent = unit.yPercent + (unit.velocityYPercentPerSecond * extrapolationSeconds);
    const shouldClampToTarget = unit.moveState === "moving" || unit.moveState === "attacking";

    return {
      ...unit,
      renderXPercent: shouldClampToTarget
        ? clampRenderAxisTowardTarget({
          current: unit.xPercent,
          target: unit.targetXPercent,
          next: extrapolatedXPercent,
        })
        : clampPercent(extrapolatedXPercent),
      renderYPercent: shouldClampToTarget
        ? clampRenderAxisTowardTarget({
          current: unit.yPercent,
          target: unit.targetYPercent,
          next: extrapolatedYPercent,
        })
        : clampPercent(extrapolatedYPercent),
    };
  });
}

function easeOutSine(value: number) {
  return Math.sin((value * Math.PI) / 2);
}

function easeInOutSine(value: number) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function clampRenderAxisTowardTarget(params: {
  current: number;
  target: number;
  next: number;
}) {
  const minValue = Math.min(params.current, params.target);
  const maxValue = Math.max(params.current, params.target);
  return clampPercent(clamp(params.next, minValue, maxValue));
}

function applyTimelineToRenderUnits(
  units: BattleSceneRenderUnit[],
  timeline: BattleSceneTimelineEvent[],
  sampleTimeMs: number,
) {
  if (!timeline.length || !units.length) {
    return units;
  }

  const activeEvent = timeline.find((event) => {
    const totalDuration = event.windupMs + event.activeMs + event.recoverMs;
    return sampleTimeMs >= event.startedAtMs && sampleTimeMs <= (event.startedAtMs + totalDuration);
  });

  if (!activeEvent) {
    return units;
  }

  if ((activeEvent.channel || "action") !== "movement") {
    return units;
  }

  const renderUnitMap = indexUnitsById(units);
  const actorUnit = renderUnitMap.get(activeEvent.actorId);
  if (!actorUnit) {
    return units;
  }

  const targetUnit = activeEvent.targetId ? renderUnitMap.get(activeEvent.targetId) : null;
  const totalDuration = Math.max(1, activeEvent.windupMs + activeEvent.activeMs + activeEvent.recoverMs);
  const elapsedMs = clamp(sampleTimeMs - activeEvent.startedAtMs, 0, totalDuration);
  const approachEndMs = Math.max(1, activeEvent.windupMs + activeEvent.activeMs);

  const actorProgress = elapsedMs <= approachEndMs
    ? easeOutSine(elapsedMs / approachEndMs)
    : 1 - easeInOutSine((elapsedMs - approachEndMs) / Math.max(1, activeEvent.recoverMs));

  const targetProgress = elapsedMs <= activeEvent.windupMs
    ? 0
    : Math.sin(
      clamp(
        (elapsedMs - activeEvent.windupMs) / Math.max(1, activeEvent.activeMs + activeEvent.recoverMs),
        0,
        1,
      ) * Math.PI,
    );

  let vectorX = 0;
  let vectorY = activeEvent.actorAdvancePercent >= 0 ? -1 : 1;

  if (targetUnit) {
    const dx = targetUnit.renderXPercent - actorUnit.renderXPercent;
    const dy = targetUnit.renderYPercent - actorUnit.renderYPercent;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.0001) {
      vectorX = dx / distance;
      vectorY = dy / distance;
    }
  }

  return units.map((unit) => {
    if (unit.id === activeEvent.actorId) {
      return {
        ...unit,
        renderXPercent: clampPercent(unit.renderXPercent + (vectorX * activeEvent.actorAdvancePercent * actorProgress)),
        renderYPercent: clampPercent(unit.renderYPercent + (vectorY * activeEvent.actorAdvancePercent * actorProgress)),
      };
    }

    if (activeEvent.targetId && unit.id === activeEvent.targetId) {
      return {
        ...unit,
        renderXPercent: clampPercent(unit.renderXPercent + (vectorX * activeEvent.targetRecoilPercent * targetProgress)),
        renderYPercent: clampPercent(unit.renderYPercent + (vectorY * activeEvent.targetRecoilPercent * targetProgress)),
      };
    }

    return unit;
  });
}

export function resolveBattleSceneRenderUnits(params: {
  snapshot?: BattleSceneSnapshot | null;
  previousSnapshot?: BattleSceneSnapshot | null;
  renderTimeMs: number;
  interpolationDelayMs?: number;
  maxExtrapolationMs?: number;
}) {
  const snapshot = params.snapshot;
  if (!snapshot) {
    return [] as BattleSceneRenderUnit[];
  }

  const previousSnapshot = params.previousSnapshot;
  const interpolationDelayMs = params.interpolationDelayMs ?? 48;
  const maxExtrapolationMs = params.maxExtrapolationMs ?? 96;
  const sampleTimeMs = params.renderTimeMs - interpolationDelayMs;
  const baseUnits = resolveBaseRenderUnits({
    snapshot,
    previousSnapshot,
    sampleTimeMs,
    maxExtrapolationMs,
  });

  return applyTimelineToRenderUnits(baseUnits, snapshot.timeline || [], sampleTimeMs);
}
