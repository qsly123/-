"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { CombatSkillVisualEffect } from "@/types/game";
import {
  getSkillVisualEffectDurationMs,
  resolveSkillVisualEffectRenderMetrics,
} from "@/modules/shared/services/skill-visual-effect";

function getFrameIndex(
  elapsedMs: number,
  frameCount: number,
  frameDurationMs: number,
) {
  if (frameCount <= 1) {
    return 0;
  }

  return Math.min(frameCount - 1, Math.floor(elapsedMs / frameDurationMs));
}

export default function AnimatedSpriteBurst({
  effect,
  motionId,
  className,
  style,
}: {
  effect: CombatSkillVisualEffect;
  motionId: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [frame, setFrame] = useState(0);
  const [active, setActive] = useState(false);
  const [sheetSize, setSheetSize] = useState<{ spriteUrl: string; width: number; height: number } | null>(null);
  const resolvedSheetSize = effect.spriteUrl && sheetSize?.spriteUrl === effect.spriteUrl
    ? sheetSize
    : null;

  const renderMetrics = useMemo(() => resolveSkillVisualEffectRenderMetrics(effect, {
    fallbackFrameWidth: resolvedSheetSize?.width || 168,
    fallbackFrameHeight: resolvedSheetSize?.height || 168,
  }), [effect, resolvedSheetSize?.height, resolvedSheetSize?.width]);
  const frameWidth = renderMetrics.frameWidth || 168;
  const frameHeight = renderMetrics.frameHeight || 168;
  const frameCount = Math.max(1, effect.frameCount || 1);
  const frameDurationMs = Math.max(40, effect.frameDurationMs || 70);
  const totalDurationMs = Math.max(220, getSkillVisualEffectDurationMs(effect));
  const useSpriteSheet = Boolean(effect.frameWidth && effect.frameHeight && frameCount > 1);
  const bloomScale = Math.max(1.12, renderMetrics.scale + 0.18);
  const sheetColumns = Math.max(1, Math.floor((resolvedSheetSize?.width || frameWidth) / Math.max(1, frameWidth)));
  const sheetRows = Math.max(1, Math.floor((resolvedSheetSize?.height || frameHeight) / Math.max(1, frameHeight)));
  const safeFrame = Math.min(frame, Math.max(0, (sheetColumns * sheetRows) - 1));

  useEffect(() => {
    let rafId = 0;
    let mounted = true;
    const startAt = performance.now();

    const activateId = window.setTimeout(() => {
      if (mounted) {
        setActive(true);
      }
    }, 16);

    const tick = (now: number) => {
      if (!mounted) {
        return;
      }

      const elapsed = now - startAt;
      setFrame(getFrameIndex(elapsed, frameCount, frameDurationMs));

      if (elapsed < totalDurationMs) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      mounted = false;
      window.clearTimeout(activateId);
      window.cancelAnimationFrame(rafId);
    };
  }, [frameCount, frameDurationMs, motionId, totalDurationMs]);

  useEffect(() => {
    const spriteUrl = effect.spriteUrl;
    if (!spriteUrl) {
      return;
    }

    let mounted = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!mounted) {
        return;
      }
      setSheetSize({
        spriteUrl,
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
      });
    };
    image.onerror = () => {
      void mounted;
    };
    image.src = spriteUrl;

    return () => {
      mounted = false;
    };
  }, [effect.spriteUrl]);

  const sharedBackground = useMemo(() => ({
    backgroundImage: `url(${effect.spriteUrl})`,
    backgroundRepeat: "no-repeat" as const,
    backgroundPosition: useSpriteSheet
      ? `-${(safeFrame % sheetColumns) * frameWidth}px -${Math.floor(safeFrame / sheetColumns) * frameHeight}px`
      : "center",
    backgroundSize: useSpriteSheet
      ? `${resolvedSheetSize?.width || frameWidth * sheetColumns}px ${resolvedSheetSize?.height || frameHeight * sheetRows}px`
      : "contain",
  }), [
    effect.spriteUrl,
    frameHeight,
    frameWidth,
    resolvedSheetSize?.height,
    resolvedSheetSize?.width,
    safeFrame,
    sheetColumns,
    sheetRows,
    useSpriteSheet,
  ]);

  const transform = `translate(${renderMetrics.offsetX}px, ${renderMetrics.offsetY}px) scale(${renderMetrics.scale})`;

  return (
    <div
      className={["battle-sprite-burst", active ? "is-active" : "", className || ""].filter(Boolean).join(" ")}
      style={{
        width: frameWidth,
        height: frameHeight,
        marginLeft: -(frameWidth / 2),
        marginTop: -(frameHeight / 2),
        transform,
        ...style,
      }}
    >
      <div
        className="battle-sprite-burst__glow"
        style={{
          ...sharedBackground,
          transform: `scale(${bloomScale})`,
        }}
      />
      <div className="battle-sprite-burst__core" style={sharedBackground} />
    </div>
  );
}
