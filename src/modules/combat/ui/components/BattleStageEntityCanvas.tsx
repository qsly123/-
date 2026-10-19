"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  getBattleSceneAnchorMap,
  type BattleSceneMode,
  type BattleSceneRole,
} from "@/modules/combat/services/battle-scene";
import {
  resolveBattleSceneRenderUnits,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import {
  COMBAT_SCENE_RENDER_INTERPOLATION_DELAY_MS,
  COMBAT_SCENE_RENDER_MAX_EXTRAPOLATION_MS,
} from "@/modules/combat/services/combat-scene-config";
import { resolvePersistentActiveEffectVisualEffect } from "@/modules/shared/services/skill-visual-effect-presets";
import {
  getSkillVisualEffectDurationMs,
  resolveSkillVisualEffectRenderMetrics,
} from "@/modules/shared/services/skill-visual-effect";
import { useObservedElementSize } from "@/modules/combat/ui/hooks/useObservedElementSize";
import { hasActiveBattleSceneTimeline, useRenderClock } from "@/modules/combat/ui/hooks/useRenderClock";
import type { ActiveEffect, CombatSkillVisualEffect } from "@/types/game";

type StageCanvasUnit = {
  id: string;
  name: string;
  role: BattleSceneRole;
  slot?: number | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  fallbackText: string;
  isCurrent?: boolean;
  isDead?: boolean;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  activeEffects?: ActiveEffect[];
};

type StageCanvasMotion = {
  id: number | string;
  actorId?: string | null;
  targetId?: string | null;
  durationMs?: number;
  visualEffect?: CombatSkillVisualEffect | null;
};

type StageCanvasPopup = {
  id: number | string;
  targetId: string;
  label: string;
  kind: "damage" | "heal" | "system";
  createdAtMs: number;
  durationMs?: number;
};

type CanvasPoint = {
  x: number;
  y: number;
};

type ImageCacheEntry = {
  image: HTMLImageElement;
  status: "loading" | "loaded" | "error";
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cloneStageUnitActiveEffects(activeEffects?: ActiveEffect[]) {
  return (activeEffects || []).map((effect) => ({ ...effect }));
}

function getUnitRadius(unit: StageCanvasUnit) {
  if (unit.role === "boss") {
    return 56;
  }
  return 36;
}

function getUnitShellGradient(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  radius: number,
  role: BattleSceneRole,
  isCurrent: boolean,
  isDead: boolean,
) {
  const gradient = ctx.createRadialGradient(
    point.x - radius * 0.28,
    point.y - radius * 0.34,
    radius * 0.08,
    point.x,
    point.y,
    radius,
  );

  if (isDead) {
    gradient.addColorStop(0, "rgba(228, 228, 228, 0.88)");
    gradient.addColorStop(0.34, "rgba(142, 142, 142, 0.86)");
    gradient.addColorStop(0.72, "rgba(66, 66, 66, 0.96)");
    gradient.addColorStop(1, "rgba(18, 18, 18, 1)");
    return gradient;
  }

  if (role === "boss") {
    gradient.addColorStop(0, "rgba(255, 239, 214, 0.94)");
    gradient.addColorStop(0.3, "rgba(196, 86, 72, 0.92)");
    gradient.addColorStop(0.7, "rgba(86, 22, 28, 0.98)");
    gradient.addColorStop(1, "rgba(22, 8, 12, 1)");
    return gradient;
  }

  if (role === "enemy") {
    gradient.addColorStop(0, "rgba(255, 236, 231, 0.9)");
    gradient.addColorStop(0.35, "rgba(171, 68, 74, 0.92)");
    gradient.addColorStop(0.72, "rgba(72, 18, 24, 0.98)");
    gradient.addColorStop(1, "rgba(18, 8, 12, 1)");
    return gradient;
  }

  if (isCurrent) {
    gradient.addColorStop(0, "rgba(247, 244, 233, 0.94)");
    gradient.addColorStop(0.34, "rgba(132, 148, 172, 0.86)");
    gradient.addColorStop(0.72, "rgba(36, 46, 62, 0.96)");
    gradient.addColorStop(1, "rgba(11, 15, 21, 1)");
    return gradient;
  }

  gradient.addColorStop(0, "rgba(245, 241, 221, 0.94)");
  gradient.addColorStop(0.34, "rgba(118, 132, 160, 0.88)");
  gradient.addColorStop(0.72, "rgba(34, 44, 60, 0.96)");
  gradient.addColorStop(1, "rgba(11, 15, 21, 1)");
  return gradient;
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  targetPoint: CanvasPoint,
  radius: number,
  role: BattleSceneRole,
  progress: number,
) {
  const dx = targetPoint.x - point.x;
  const dy = targetPoint.y - point.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    return;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const tailLength = radius * (role === "boss" ? 2.2 : 1.9);
  const alpha = 0.18 + (0.18 * Math.sin(progress * Math.PI));
  const gradient = ctx.createLinearGradient(
    point.x - nx * tailLength,
    point.y - ny * tailLength,
    point.x,
    point.y,
  );
  const midColor = role === "player"
    ? `rgba(236, 219, 178, ${alpha})`
    : `rgba(232, 128, 111, ${alpha})`;
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(0.48, midColor);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(
    point.x - nx * radius * 0.82,
    point.y - ny * radius * 0.82,
    radius * 0.58,
    tailLength,
    Math.atan2(dy, dx) + Math.PI / 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

function drawShadow(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  radius: number,
  isActor: boolean,
) {
  const shadowWidth = radius * (isActor ? 2.2 : 1.8);
  const shadowHeight = radius * (isActor ? 0.5 : 0.38);
  const gradient = ctx.createRadialGradient(
    point.x,
    point.y + radius + 10,
    2,
    point.x,
    point.y + radius + 10,
    shadowWidth,
  );
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.46)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + radius + 10, shadowWidth, shadowHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawImpactPulse(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  radius: number,
  role: BattleSceneRole,
  progress: number,
) {
  const pulse = Math.sin(progress * Math.PI);
  if (pulse <= 0.001) {
    return;
  }

  const spread = radius * (role === "boss" ? 0.9 : 0.7);
  const lineWidth = 3.8 - (pulse * 1.8);
  const outerRadius = radius + 10 + (spread * pulse);
  const color = role === "player"
    ? `rgba(243, 221, 165, ${0.34 * (1 - progress)})`
    : `rgba(242, 132, 118, ${0.36 * (1 - progress)})`;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(point.x, point.y, outerRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPopupLabel(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  label: string,
  kind: StageCanvasPopup["kind"],
  elapsedMs: number,
  durationMs: number,
  radius: number,
) {
  if (!label.trim() || elapsedMs < 0 || elapsedMs > durationMs) {
    return;
  }

  const progress = clamp(elapsedMs / durationMs, 0, 1);
  const riseDistance = 18 + (radius * 0.55);
  const yOffset = 6 - (riseDistance * progress);
  const scale = progress < 0.14
    ? 0.74 + (progress / 0.14) * 0.26
    : 1 + (0.03 * Math.sin(progress * Math.PI));
  const alpha = progress < 0.12
    ? progress / 0.12
    : progress > 0.72
      ? 1 - ((progress - 0.72) / 0.28)
      : 1;

  if (alpha <= 0.001) {
    return;
  }

  const fillStyle = kind === "damage"
    ? "#ffb0a3"
    : kind === "heal"
      ? "#bff6c8"
      : "#f7e8c3";

  ctx.save();
  ctx.translate(point.x, point.y + yOffset);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = "800 20px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(22, 14, 14, 0.92)";
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = fillStyle;
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawEffectSprite(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  point: CanvasPoint,
  effect: CombatSkillVisualEffect,
  elapsedMs: number,
  options?: {
    loop?: boolean;
    alphaMultiplier?: number;
  },
) {
  const sourceWidth = image.naturalWidth || image.width || effect.frameWidth || 0;
  const sourceHeight = image.naturalHeight || image.height || effect.frameHeight || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const renderMetrics = resolveSkillVisualEffectRenderMetrics(effect, {
    sourceWidth,
    sourceHeight,
  });
  const frameWidth = renderMetrics.frameWidth || sourceWidth;
  const frameHeight = renderMetrics.frameHeight || sourceHeight;
  const frameCount = Math.max(1, Math.floor(Number(effect.frameCount) || 1));
  const frameDurationMs = Math.max(40, Math.floor(Number(effect.frameDurationMs) || 70));
  const totalDurationMs = Math.max(220, getSkillVisualEffectDurationMs(effect) || frameDurationMs);
  if (!options?.loop && (elapsedMs < 0 || elapsedMs > totalDurationMs)) {
    return;
  }

  const normalizedElapsedMs = options?.loop
    ? ((elapsedMs % totalDurationMs) + totalDurationMs) % totalDurationMs
    : elapsedMs;
  const frameIndex = Math.min(frameCount - 1, Math.floor(normalizedElapsedMs / frameDurationMs));
  const sheetColumns = Math.max(1, Math.floor(sourceWidth / Math.max(1, frameWidth)));
  const sheetRows = Math.max(1, Math.floor(sourceHeight / Math.max(1, frameHeight)));
  const normalizedFrameIndex = Math.min(frameCount - 1, Math.min(frameIndex, (sheetColumns * sheetRows) - 1));
  const frameColumn = normalizedFrameIndex % sheetColumns;
  const frameRow = Math.floor(normalizedFrameIndex / sheetColumns);
  const progress = clamp(normalizedElapsedMs / totalDurationMs, 0, 1);
  const alphaMultiplier = clamp(Number(options?.alphaMultiplier) || 1, 0.12, 1);

  ctx.save();
  ctx.globalAlpha = options?.loop
    ? alphaMultiplier * (0.64 + (0.08 * Math.sin(progress * Math.PI * 2)))
    : alphaMultiplier * (0.96 - (progress * 0.12));
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(
    image,
    frameColumn * frameWidth,
    frameRow * frameHeight,
    frameWidth,
    frameHeight,
    point.x - (renderMetrics.drawWidth / 2) + renderMetrics.offsetX,
    point.y - (renderMetrics.drawHeight / 2) + renderMetrics.offsetY,
    renderMetrics.drawWidth,
    renderMetrics.drawHeight,
  );
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  radius: number,
  label: string,
  role: BattleSceneRole,
  isCurrent: boolean,
  isDead: boolean,
) {
  const displayLabel = label.trim();
  if (!displayLabel) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius - 1, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const labelHeight = role === "boss" ? 22 : 18;
  const labelWidth = radius * 1.72;
  const x = point.x - (labelWidth / 2);
  const y = point.y - radius + 5;
  const radiusValue = labelHeight / 2;
  const gradient = ctx.createLinearGradient(x, y, x, y + labelHeight);
  if (isDead) {
    gradient.addColorStop(0, "rgba(78, 78, 78, 0.9)");
    gradient.addColorStop(1, "rgba(24, 24, 24, 0.76)");
  } else if (role === "boss") {
    gradient.addColorStop(0, "rgba(88, 28, 28, 0.9)");
    gradient.addColorStop(1, "rgba(34, 10, 12, 0.72)");
  } else if (isCurrent) {
    gradient.addColorStop(0, "rgba(88, 70, 31, 0.86)");
    gradient.addColorStop(1, "rgba(24, 20, 14, 0.72)");
  } else {
    gradient.addColorStop(0, "rgba(29, 37, 49, 0.84)");
    gradient.addColorStop(1, "rgba(12, 16, 22, 0.68)");
  }

  ctx.beginPath();
  ctx.moveTo(x + radiusValue, y);
  ctx.lineTo(x + labelWidth - radiusValue, y);
  ctx.arcTo(x + labelWidth, y, x + labelWidth, y + radiusValue, radiusValue);
  ctx.lineTo(x + labelWidth, y + labelHeight - radiusValue);
  ctx.arcTo(x + labelWidth, y + labelHeight, x + labelWidth - radiusValue, y + labelHeight, radiusValue);
  ctx.lineTo(x + radiusValue, y + labelHeight);
  ctx.arcTo(x, y + labelHeight, x, y + labelHeight - radiusValue, radiusValue);
  ctx.lineTo(x, y + radiusValue);
  ctx.arcTo(x, y, x + radiusValue, y, radiusValue);
  ctx.closePath();

  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = isDead
    ? "rgba(255, 255, 255, 0.12)"
    : isCurrent
      ? "rgba(244, 212, 139, 0.32)"
      : "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = isDead ? "#d7d7d7" : role === "boss" ? "#f6d8d1" : "#f5ead0";
  ctx.font = role === "boss" ? "700 11px system-ui" : "700 10px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayLabel, point.x, y + (labelHeight / 2), labelWidth - 10);
  ctx.restore();
}

function drawFallbackText(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  text: string,
  radius: number,
  role: BattleSceneRole,
  isDead: boolean,
) {
  ctx.save();
  ctx.fillStyle = isDead
    ? "#d2d2d2"
    : role === "boss" || role === "enemy"
      ? "#f8d5cf"
      : "#f4e9c8";
  ctx.font = `700 ${Math.round(radius * 0.78)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, point.x, point.y + 1, radius * 1.3);
  ctx.restore();
}

function drawAvatarImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  point: CanvasPoint,
  radius: number,
  isDead: boolean,
) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const sourceSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = (sourceWidth - sourceSize) / 2;
  const sourceY = (sourceHeight - sourceSize) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (isDead) {
    ctx.filter = "grayscale(1) saturate(0.12) brightness(0.82)";
  }
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    point.x - radius,
    point.y - radius,
    radius * 2,
    radius * 2,
  );
  ctx.restore();
}

function hasAnimatedSnapshot(snapshot?: BattleSceneSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  if (hasActiveBattleSceneTimeline(snapshot)) {
    return true;
  }

  return snapshot.units.some((unit) => (
    Math.abs(unit.velocityXPercentPerSecond) > 0.01
    || Math.abs(unit.velocityYPercentPerSecond) > 0.01
  ));
}

const BattleStageEntityCanvas = memo(function BattleStageEntityCanvas({
  mode,
  units,
  motion,
  popups,
  sceneSnapshot,
  renderPositionOverrides,
  anchorOverrides,
  className,
}: {
  mode: BattleSceneMode;
  units: StageCanvasUnit[];
  motion?: StageCanvasMotion | null;
  popups?: StageCanvasPopup[];
  sceneSnapshot?: BattleSceneSnapshot | null;
  renderPositionOverrides?: Map<string, { xPercent: number; yPercent: number }> | null;
  anchorOverrides?: Map<string, { xPercent: number; yPercent: number }> | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const devicePixelRatioRef = useRef(1);
  const imageCacheRef = useRef<Map<string, ImageCacheEntry>>(new Map());
  const motionStartRef = useRef<number>(0);
  const prevMotionIdRef = useRef<string>("");
  const previousSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const currentSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const {
    elementRef: containerRef,
    size,
  } = useObservedElementSize<HTMLDivElement>();

  const stableUnits = useMemo(() => units.map((unit) => ({
    ...unit,
    slot: typeof unit.slot === "number" ? unit.slot : null,
    activeEffects: cloneStageUnitActiveEffects(unit.activeEffects),
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

  const ensureImage = (url?: string | null) => {
    if (!url) {
      return null;
    }

    const cached = imageCacheRef.current.get(url);
    if (cached) {
      return cached.status === "loaded" ? cached.image : null;
    }

    const image = new Image();
    imageCacheRef.current.set(url, { image, status: "loading" });
    image.onload = () => {
      const current = imageCacheRef.current.get(url);
      if (current) {
        current.status = "loaded";
      }
      setImageVersion((value) => value + 1);
    };
    image.onerror = () => {
      const current = imageCacheRef.current.get(url);
      if (current) {
        current.status = "error";
      }
      setImageVersion((value) => value + 1);
    };
    image.src = url;
    return null;
  };

  useEffect(() => {
    const motionId = motion ? String(motion.id) : "";
    if (motionId && motionId !== prevMotionIdRef.current) {
      prevMotionIdRef.current = motionId;
      motionStartRef.current = Date.now();
      return;
    }
    if (!motionId) {
      prevMotionIdRef.current = "";
      motionStartRef.current = 0;
    }
  }, [motion]);

  const shouldAnimate = Boolean(
    size.width > 0
    && size.height > 0
    && (
      Boolean(motion)
      || hasAnimatedSnapshot(sceneSnapshot)
      || (popups?.length || 0) > 0
      || stableUnits.some((unit) => (
        !unit.isDead
        && (unit.activeEffects || []).some((effect) => (
          effect.remainingTurns > 0
          && Boolean(resolvePersistentActiveEffectVisualEffect(effect.type)?.spriteUrl)
        ))
      ))
    ),
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
    ctx.clearRect(0, 0, size.width, size.height);

    const fallbackAnchorMap = getBattleSceneAnchorMap(mode, stableUnits);
    const resolvedAnchorMap = anchorOverrides
      ? new Map([
        ...fallbackAnchorMap.entries(),
        ...anchorOverrides.entries(),
      ])
      : fallbackAnchorMap;
    const stageUnitMap = new Map(stableUnits.map((unit) => [unit.id, unit]));
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
    const renderUnitMap = new Map(renderUnits.map((unit) => [unit.id, unit]));
    const targetUnit = motion?.targetId ? renderUnitMap.get(motion.targetId) : null;
    const actorUnit = motion?.actorId ? renderUnitMap.get(motion.actorId) : null;
    const elapsed = motion ? renderClock - motionStartRef.current : 0;
    const motionDurationMs = motion ? Math.max(120, Math.round(Number(motion.durationMs) || 440)) : 440;
    const progress = motion ? clamp(elapsed / motionDurationMs, 0, 1) : 0;
    const renderedPointMap = new Map<string, CanvasPoint>();
    const basePointMap = new Map(
      stableUnits.map((unit) => {
        const renderUnit = renderUnitMap.get(unit.id);
        const fallbackOverride = renderPositionOverrides?.get(unit.id);
        return [
          unit.id,
          renderUnit
            ? {
              x: size.width * (renderUnit.renderXPercent / 100),
              y: size.height * (renderUnit.renderYPercent / 100),
            }
            : fallbackOverride
              ? {
                x: size.width * (fallbackOverride.xPercent / 100),
                y: size.height * (fallbackOverride.yPercent / 100),
              }
              : {
                x: size.width * ((resolvedAnchorMap.get(unit.id)?.xPercent || 50) / 100),
                y: size.height * ((resolvedAnchorMap.get(unit.id)?.yPercent || 50) / 100),
              },
        ];
      }),
    );
    stableUnits.forEach((unit) => {
      const renderUnit = renderUnitMap.get(unit.id);
      const radius = getUnitRadius(unit);
      const anchor = renderPositionOverrides?.get(unit.id) || resolvedAnchorMap.get(unit.id) || { xPercent: 50, yPercent: 50 };
      const basePoint = renderUnit
        ? {
          x: size.width * (renderUnit.renderXPercent / 100),
          y: size.height * (renderUnit.renderYPercent / 100),
        }
        : {
          x: size.width * (anchor.xPercent / 100),
          y: size.height * (anchor.yPercent / 100),
        };

      const point = basePoint;
      renderedPointMap.set(unit.id, point);

      if (motion && targetUnit && motion.actorId === unit.id) {
        const targetPoint = basePointMap.get(targetUnit.id);
        if (targetPoint) {
          drawTrail(ctx, point, targetPoint, radius, unit.role, progress);
        }
      } else if (motion && actorUnit && motion.targetId === unit.id && motion.actorId !== unit.id) {
        void actorUnit;
      }

      drawShadow(ctx, point, radius, motion?.actorId === unit.id);

      const auraRadius = radius + (unit.role === "boss" ? 12 : 8);
      const aura = ctx.createRadialGradient(point.x, point.y, radius * 0.2, point.x, point.y, auraRadius);
      aura.addColorStop(
        0,
        unit.isDead
          ? "rgba(178, 178, 178, 0.08)"
          : unit.role === "player"
            ? "rgba(233, 214, 169, 0.12)"
            : "rgba(241, 145, 124, 0.1)",
      );
      aura.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.save();
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(point.x, point.y, auraRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const scale = motion?.targetId === unit.id
        ? 1 + (0.055 * Math.sin(progress * Math.PI))
        : motion?.actorId === unit.id
          ? 1 + (0.038 * Math.sin(progress * Math.PI))
          : 1;
      const scaledRadius = radius * scale;

      ctx.save();
      ctx.fillStyle = getUnitShellGradient(
        ctx,
        point,
        scaledRadius,
        unit.role,
        Boolean(unit.isCurrent),
        Boolean(unit.isDead),
      );
      ctx.beginPath();
      ctx.arc(point.x, point.y, scaledRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = unit.isDead
        ? "rgba(236, 236, 236, 0.18)"
        : unit.isCurrent
          ? "rgba(214, 225, 242, 0.42)"
          : "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = unit.isCurrent ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, scaledRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const avatarImage = ensureImage(unit.avatarImageUrl);
      const frameImage = ensureImage(unit.avatarFrameImageUrl);

      if (avatarImage) {
        drawAvatarImage(ctx, avatarImage, point, Math.max(10, scaledRadius - 4), Boolean(unit.isDead));
      } else {
        drawFallbackText(
          ctx,
          point,
          unit.fallbackText,
          Math.max(10, scaledRadius - 3),
          unit.role,
          Boolean(unit.isDead),
        );
      }

      if (frameImage) {
        const frameRadius = scaledRadius + 1.5;
        ctx.save();
        if (unit.isDead) {
          ctx.filter = "grayscale(1) saturate(0.15) brightness(0.86)";
          ctx.globalAlpha = 0.82;
        }
        ctx.drawImage(
          frameImage,
          point.x - frameRadius,
          point.y - frameRadius,
          frameRadius * 2,
          frameRadius * 2,
        );
        ctx.restore();
      }

      if (!unit.isDead) {
        for (const effect of unit.activeEffects || []) {
          if (effect.remainingTurns <= 0) {
            continue;
          }
          const persistentVisualEffect = resolvePersistentActiveEffectVisualEffect(effect.type);
          if (!persistentVisualEffect?.spriteUrl) {
            continue;
          }

          const persistentEffectImage = ensureImage(persistentVisualEffect.spriteUrl);
          if (!persistentEffectImage) {
            continue;
          }

          drawEffectSprite(
            ctx,
            persistentEffectImage,
            point,
            persistentVisualEffect,
            renderClock,
            {
              loop: true,
              alphaMultiplier: 0.7,
            },
          );
        }
      }

      drawLabel(
        ctx,
        point,
        scaledRadius,
        unit.name,
        unit.role,
        Boolean(unit.isCurrent),
        Boolean(unit.isDead),
      );
    });

    if (motion?.targetId) {
      const targetPoint = renderedPointMap.get(motion.targetId);
      const targetStageUnit = stageUnitMap.get(motion.targetId) || null;
      if (targetPoint && targetStageUnit) {
        drawImpactPulse(
          ctx,
          targetPoint,
          getUnitRadius(targetStageUnit),
          targetStageUnit.role,
          progress,
        );
      }
    }

    if (motion?.visualEffect?.spriteUrl) {
      const targetPoint = motion.targetId ? (renderedPointMap.get(motion.targetId) || null) : null;
      const actorPoint = motion.actorId ? (renderedPointMap.get(motion.actorId) || null) : null;
      const effectPoint = targetPoint || actorPoint;
      const effectImage = ensureImage(motion.visualEffect.spriteUrl);
      if (effectPoint && effectImage) {
        drawEffectSprite(ctx, effectImage, effectPoint, motion.visualEffect, elapsed);
      }
    }

    (popups || []).forEach((popup) => {
      const popupPoint = renderedPointMap.get(popup.targetId);
      const popupUnit = stageUnitMap.get(popup.targetId);
      if (!popupPoint || !popupUnit) {
        return;
      }

      drawPopupLabel(
        ctx,
        popupPoint,
        popup.label,
        popup.kind,
        renderClock - popup.createdAtMs,
        Math.max(320, Number(popup.durationMs) || 1280),
        getUnitRadius(popupUnit),
      );
    });
  }, [anchorOverrides, imageVersion, mode, motion, popups, renderClock, renderPositionOverrides, size.height, size.width, stableUnits]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 3,
      }}
      aria-hidden
    >
      <canvas ref={canvasRef} />
    </div>
  );
});

export default BattleStageEntityCanvas;
