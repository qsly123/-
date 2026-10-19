export function clampSpiritualSense(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(20, Math.floor(value)));
}

export function normalizeCenteredMapViewSize(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const normalized = Math.max(1, Math.floor(value));
  return normalized % 2 === 0 ? Math.max(1, normalized - 1) : normalized;
}

export function resolveMapVisionProfile(spiritualSense) {
  const normalizedSense = clampSpiritualSense(spiritualSense);
  const clearViewSize = normalizeCenteredMapViewSize(3 + Math.floor((normalizedSense * 17) / 20));

  if (normalizedSense >= 20) {
    return {
      spiritualSense: normalizedSense,
      clearViewSize,
      shallowViewSize: null,
    };
  }

  return {
    spiritualSense: normalizedSense,
    clearViewSize,
    shallowViewSize: normalizeCenteredMapViewSize(10 + Math.floor((normalizedSense * 10) / 20)),
  };
}

function isWithinViewSpan(delta, viewSize) {
  const centeredViewSize = normalizeCenteredMapViewSize(viewSize);
  const radius = Math.floor(centeredViewSize / 2);
  return delta >= -radius && delta <= radius;
}

export function resolveMapFogLevel(params) {
  if (
    isWithinViewSpan(params.deltaX, params.profile.clearViewSize)
    && isWithinViewSpan(params.deltaY, params.profile.clearViewSize)
  ) {
    return "clear";
  }

  if (
    params.profile.shallowViewSize === null
    || (
      isWithinViewSpan(params.deltaX, params.profile.shallowViewSize)
      && isWithinViewSpan(params.deltaY, params.profile.shallowViewSize)
    )
  ) {
    return "shallow";
  }

  return "hidden";
}

export function resolveMapEntityFogLevel(params) {
  const profile = resolveMapVisionProfile(params.spiritualSense);
  return resolveMapFogLevel({
    deltaX: params.targetX - params.playerX,
    deltaY: params.targetY - params.playerY,
    profile,
  });
}

export function filterMapPositionsByFogLevel(params) {
  const profile = resolveMapVisionProfile(params.spiritualSense);
  const visibleLevelSet = new Set(params.visibleLevels);

  return params.list.filter((item) => (
    visibleLevelSet.has(resolveMapFogLevel({
      deltaX: item.positionX - params.origin.positionX,
      deltaY: item.positionY - params.origin.positionY,
      profile,
    }))
  ));
}

export function filterMapSceneStateByVision(state, spiritualSense) {
  const origin = {
    positionX: state.selfPlayer.positionX,
    positionY: state.selfPlayer.positionY,
  };

  return {
    ...state,
    otherPlayers: filterMapPositionsByFogLevel({
      origin,
      list: state.otherPlayers,
      spiritualSense,
      visibleLevels: ["clear"],
    }),
    npcs: filterMapPositionsByFogLevel({
      origin,
      list: state.npcs,
      spiritualSense,
      visibleLevels: ["clear", "shallow"],
    }),
    opportunities: filterMapPositionsByFogLevel({
      origin,
      list: state.opportunities,
      spiritualSense,
      visibleLevels: ["clear"],
    }),
    monsters: filterMapPositionsByFogLevel({
      origin,
      list: state.monsters,
      spiritualSense,
      visibleLevels: ["clear", "shallow"],
    }),
  };
}
