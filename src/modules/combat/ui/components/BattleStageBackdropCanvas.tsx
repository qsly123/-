"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { getBattleSceneAnchorMap } from "@/modules/combat/services/battle-scene";
import {
  resolveBattleSceneRenderUnits,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import {
  COMBAT_SCENE_RENDER_INTERPOLATION_DELAY_MS,
  COMBAT_SCENE_RENDER_MAX_EXTRAPOLATION_MS,
} from "@/modules/combat/services/combat-scene-config";
import { useObservedElementSize } from "@/modules/combat/ui/hooks/useObservedElementSize";
import { shouldAnimateBattleSceneSnapshot, useRenderClock } from "@/modules/combat/ui/hooks/useRenderClock";

type StageMode = "combat" | "boss";
type StageRole = "player" | "enemy" | "boss";

type StageUnit = {
  id: string;
  role: StageRole;
  slot?: number | null;
  isCurrent?: boolean;
  isActor?: boolean;
  isTarget?: boolean;
};

type StagePoint = {
  x: number;
  y: number;
};

function drawRoundedCapsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillStyle: string | CanvasGradient,
  strokeStyle?: string,
) {
  const radius = Math.min(height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawFloorGlow(
  ctx: CanvasRenderingContext2D,
  point: StagePoint,
  role: StageRole,
) {
  const glowWidth = role === "boss" ? 84 : 60;
  const glowHeight = role === "boss" ? 20 : 14;
  const gradient = ctx.createRadialGradient(point.x, point.y + 24, 4, point.x, point.y + 24, glowWidth / 2);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.38)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 24, glowWidth / 2, glowHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: StageMode,
  units: StageUnit[],
  renderUnits: Array<StageUnit & { renderXPercent: number; renderYPercent: number }>,
  clashActive: boolean,
) {
  void clashActive;
  const compact = width <= 900;
  ctx.clearRect(0, 0, width, height);

  const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
  if (mode === "combat") {
    baseGradient.addColorStop(0, "rgba(23, 29, 36, 0.96)");
    baseGradient.addColorStop(1, "rgba(11, 15, 19, 0.98)");
  } else {
    baseGradient.addColorStop(0, "rgba(20, 25, 33, 0.96)");
    baseGradient.addColorStop(1, "rgba(10, 14, 19, 0.98)");
  }
  ctx.fillStyle = baseGradient;
  ctx.fillRect(0, 0, width, height);

  const topWash = ctx.createRadialGradient(width * 0.22, height * 0.36, 16, width * 0.22, height * 0.36, width * 0.28);
  topWash.addColorStop(0, "rgba(68, 89, 110, 0.24)");
  topWash.addColorStop(1, "rgba(68, 89, 110, 0)");
  ctx.fillStyle = topWash;
  ctx.fillRect(0, 0, width, height);

  const bottomWash = ctx.createRadialGradient(width * 0.76, height * 0.72, 16, width * 0.76, height * 0.72, width * 0.24);
  bottomWash.addColorStop(0, "rgba(143, 110, 66, 0.12)");
  bottomWash.addColorStop(1, "rgba(143, 110, 66, 0)");
  ctx.fillStyle = bottomWash;
  ctx.fillRect(0, 0, width, height);

  const laneWidth = compact ? width * 0.12 : width * 0.15;
  const centerLaneWidth = compact ? width * 0.22 : width * 0.19;
  const laneTop = compact ? 58 : 70;
  const laneBottom = compact ? 80 : 92;
  const laneHeight = Math.max(120, height - laneTop - laneBottom);
  const lanes = compact
    ? [{ left: (width - centerLaneWidth) / 2, width: centerLaneWidth, opacity: 0.18 }]
    : [
        { left: width * 0.1, width: laneWidth, opacity: 0.12 },
        { left: (width - centerLaneWidth) / 2, width: centerLaneWidth, opacity: 0.2 },
        { left: width * 0.9 - laneWidth, width: laneWidth, opacity: 0.12 },
      ];

  lanes.forEach((lane) => {
    drawRoundedCapsule(
      ctx,
      lane.left,
      laneTop,
      lane.width,
      laneHeight,
      `rgba(255, 255, 255, ${lane.opacity * 0.28})`,
      `rgba(214, 196, 149, ${lane.opacity * 0.38})`,
    );
  });

  const axisGradient = ctx.createLinearGradient(width / 2, laneTop, width / 2, laneTop + laneHeight);
  axisGradient.addColorStop(0, "rgba(214, 196, 149, 0)");
  axisGradient.addColorStop(0.45, "rgba(214, 196, 149, 0.08)");
  axisGradient.addColorStop(1, "rgba(214, 196, 149, 0)");
  ctx.fillStyle = axisGradient;
  ctx.fillRect(width / 2 - 1, laneTop + 4, 2, laneHeight - 8);

  const renderUnitMap = new Map(renderUnits.map((unit) => [unit.id, unit]));

  units.forEach((unit) => {
    const renderUnit = renderUnitMap.get(unit.id);
    if (!renderUnit) {
      return;
    }
    const point = {
      x: width * (renderUnit.renderXPercent / 100),
      y: height * (renderUnit.renderYPercent / 100),
    };

    drawFloorGlow(ctx, point, unit.role);
  });
}

const BattleStageBackdropCanvas = memo(function BattleStageBackdropCanvas({
  mode,
  units,
  clashActive,
  sceneSnapshot,
  renderPositionOverrides,
  className,
}: {
  mode: StageMode;
  units: StageUnit[];
  clashActive: boolean;
  sceneSnapshot?: BattleSceneSnapshot | null;
  renderPositionOverrides?: Map<string, { xPercent: number; yPercent: number }> | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const devicePixelRatioRef = useRef(1);
  const previousSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const currentSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const {
    elementRef: containerRef,
    size,
  } = useObservedElementSize<HTMLDivElement>();

  const stableUnits = useMemo(() => units.map((unit) => ({
    ...unit,
    slot: typeof unit.slot === "number" ? unit.slot : null,
  })), [units]);

  useEffect(() => {
    if (!sceneSnapshot) {
      currentSnapshotRef.current = null;
      previousSnapshotRef.current = null;
      return;
    }

    if (currentSnapshotRef.current?.sequence !== sceneSnapshot.sequence) {
      previousSnapshotRef.current = currentSnapshotRef.current;
    }
    currentSnapshotRef.current = sceneSnapshot;
  }, [sceneSnapshot]);

  const shouldAnimate = Boolean(
    size.width > 0
    && size.height > 0
    && (clashActive || shouldAnimateBattleSceneSnapshot(sceneSnapshot)),
  );
  const renderClock = useRenderClock(shouldAnimate);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    devicePixelRatioRef.current = dpr;
    const nextWidth = Math.round(size.width * dpr);
    const nextHeight = Math.round(size.height * dpr);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  }, [size.height, size.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const dpr = devicePixelRatioRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fallbackAnchorMap = getBattleSceneAnchorMap(mode, stableUnits);
    const renderUnits = resolveBattleSceneRenderUnits({
      snapshot: currentSnapshotRef.current,
      previousSnapshot: previousSnapshotRef.current,
      renderTimeMs: renderClock,
      interpolationDelayMs: COMBAT_SCENE_RENDER_INTERPOLATION_DELAY_MS,
      maxExtrapolationMs: COMBAT_SCENE_RENDER_MAX_EXTRAPOLATION_MS,
    }).map((unit) => {
      const override = renderPositionOverrides?.get(unit.id);
      if (!override) {
        return unit;
      }
      return {
        ...unit,
        renderXPercent: override.xPercent,
        renderYPercent: override.yPercent,
      };
    });
    const renderUnitIds = new Set(renderUnits.map((unit) => unit.id));
    const mergedRenderUnits = [
      ...renderUnits,
      ...stableUnits
        .filter((unit) => !renderUnitIds.has(unit.id))
        .map((unit) => ({
          ...unit,
          renderXPercent: (renderPositionOverrides?.get(unit.id)?.xPercent ?? fallbackAnchorMap.get(unit.id)?.xPercent ?? 50),
          renderYPercent: (renderPositionOverrides?.get(unit.id)?.yPercent ?? fallbackAnchorMap.get(unit.id)?.yPercent ?? 50),
        })),
    ];
    drawBackdrop(ctx, size.width, size.height, mode, stableUnits, mergedRenderUnits, clashActive);
  }, [clashActive, mode, renderClock, renderPositionOverrides, size.height, size.width, stableUnits]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
      aria-hidden
    >
      <canvas ref={canvasRef} />
    </div>
  );
});

export default BattleStageBackdropCanvas;
