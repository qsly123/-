"use client";

import { useMemo } from "react";
import {
  getBattleSceneAnchorMap,
  type BattleSceneMode,
  type BattleSceneUnit,
} from "@/modules/combat/services/battle-scene";
import {
  resolveBattleSceneRenderUnits,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import {
  COMBAT_SCENE_RENDER_INTERPOLATION_DELAY_MS,
  COMBAT_SCENE_RENDER_MAX_EXTRAPOLATION_MS,
} from "@/modules/combat/services/combat-scene-config";
import { shouldAnimateBattleSceneSnapshot, useRenderClock } from "@/modules/combat/ui/hooks/useRenderClock";

type BattleSceneRenderAnchor = {
  xPercent: number;
  yPercent: number;
};

export function useBattleSceneRenderAnchorMap(params: {
  mode: BattleSceneMode;
  units: BattleSceneUnit[];
  sceneSnapshot?: BattleSceneSnapshot | null;
}) {
  const { mode, units, sceneSnapshot } = params;
  const shouldAnimate = useMemo(() => shouldAnimateBattleSceneSnapshot(sceneSnapshot), [sceneSnapshot]);
  const renderClock = useRenderClock(shouldAnimate);

  return useMemo(() => {
    const fallbackAnchorMap = getBattleSceneAnchorMap(mode, units);
    if (!sceneSnapshot) {
      return fallbackAnchorMap;
    }

    const renderUnits = resolveBattleSceneRenderUnits({
      snapshot: sceneSnapshot,
      renderTimeMs: renderClock,
      interpolationDelayMs: COMBAT_SCENE_RENDER_INTERPOLATION_DELAY_MS,
      maxExtrapolationMs: COMBAT_SCENE_RENDER_MAX_EXTRAPOLATION_MS,
    });

    const renderAnchorMap = new Map<string, BattleSceneRenderAnchor>(
      renderUnits.map((unit) => [
        unit.id,
        {
          xPercent: unit.renderXPercent,
          yPercent: unit.renderYPercent,
        },
      ]),
    );

    units.forEach((unit) => {
      if (!renderAnchorMap.has(unit.id)) {
        const fallbackAnchor = fallbackAnchorMap.get(unit.id);
        if (fallbackAnchor) {
          renderAnchorMap.set(unit.id, fallbackAnchor);
        }
      }
    });

    return renderAnchorMap;
  }, [mode, renderClock, sceneSnapshot, units]);
}
