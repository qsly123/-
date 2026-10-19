import {
  clampSpiritualSense as clampSpiritualSenseRuntime,
  filterMapPositionsByFogLevel as filterMapPositionsByFogLevelRuntime,
  filterMapSceneStateByVision as filterMapSceneStateByVisionRuntime,
  normalizeCenteredMapViewSize as normalizeCenteredMapViewSizeRuntime,
  resolveMapEntityFogLevel as resolveMapEntityFogLevelRuntime,
  resolveMapFogLevel as resolveMapFogLevelRuntime,
  resolveMapVisionProfile as resolveMapVisionProfileRuntime,
} from "./map-vision-runtime.mjs";
import type { MapSceneState } from "@/modules/map/services/map-scene-state";

export type MapFogLevel = "clear" | "shallow" | "hidden";

export type MapVisionProfile = {
  spiritualSense: number;
  clearViewSize: number;
  shallowViewSize: number | null;
};

export type MapViewSizeRange = {
  min: number;
  max: number;
  recommended: number;
};

export type MapVisionPosition = {
  positionX: number;
  positionY: number;
};

export function clampSpiritualSense(value: number) {
  return clampSpiritualSenseRuntime(value);
}

export function normalizeCenteredMapViewSize(value: number) {
  return normalizeCenteredMapViewSizeRuntime(value);
}

export function resolveMapVisionProfile(spiritualSense: number): MapVisionProfile {
  return resolveMapVisionProfileRuntime(spiritualSense) as MapVisionProfile;
}

export function resolveMapFogLevel(params: {
  deltaX: number;
  deltaY: number;
  profile: MapVisionProfile;
}): MapFogLevel {
  return resolveMapFogLevelRuntime(params) as MapFogLevel;
}

export function resolveMapEntityFogLevel(params: {
  playerX: number;
  playerY: number;
  targetX: number;
  targetY: number;
  spiritualSense: number;
}): MapFogLevel {
  return resolveMapEntityFogLevelRuntime(params) as MapFogLevel;
}

export function resolveMapViewSizeRange(params: {
  spiritualSense: number;
  mapWidth: number;
  mapHeight: number;
}): MapViewSizeRange {
  const profile = resolveMapVisionProfile(params.spiritualSense);
  const mapMaxDimension = Math.max(3, Math.floor(Math.max(params.mapWidth, params.mapHeight, 3)));
  const centeredMaxDimension = normalizeCenteredMapViewSize(mapMaxDimension);
  const clearSpan = Math.min(centeredMaxDimension, profile.clearViewSize);
  const recommended = normalizeCenteredMapViewSize(Math.min(
    centeredMaxDimension,
    Math.max(clearSpan, Math.min(9, centeredMaxDimension)),
  ));

  return {
    min: 3,
    max: centeredMaxDimension,
    recommended: Math.max(3, recommended),
  };
}

export function filterMapPositionsByFogLevel<T extends MapVisionPosition>(params: {
  origin: MapVisionPosition;
  list: T[];
  spiritualSense: number;
  visibleLevels: MapFogLevel[];
}) {
  return filterMapPositionsByFogLevelRuntime(params) as T[];
}

export function filterMapSceneStateByVision<T extends MapSceneState>(
  state: T,
  spiritualSense: number,
): T {
  return filterMapSceneStateByVisionRuntime(state, spiritualSense) as T;
}
