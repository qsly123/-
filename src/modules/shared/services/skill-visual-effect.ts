import type {
  CombatSkillVisualEffect,
  SkillEffect,
  SkillEffectsPayload,
} from "@/types/game";
import { inferSkillVisualEffect, type SkillVisualEffectResolverInput } from "@/modules/shared/services/skill-visual-effect-presets";

type SkillVisualEffectFormFields = {
  visualEffectSpriteUrl?: unknown;
  visualEffectFrameWidth?: unknown;
  visualEffectFrameHeight?: unknown;
  visualEffectFrameCount?: unknown;
  visualEffectFrameDurationMs?: unknown;
  visualEffectScale?: unknown;
  visualEffectOffsetX?: unknown;
  visualEffectOffsetY?: unknown;
};

type SkillVisualEffectContextLike = SkillVisualEffectResolverInput | Record<string, unknown> | null | undefined;

const DEFAULT_VISUAL_EFFECT_RENDER_BIAS = {
  xRatio: 0.1,
  yRatio: 0.14,
} as const;

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPositiveInteger(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

type SkillVisualEffectRenderMetricsOptions = {
  sourceWidth?: number;
  sourceHeight?: number;
  fallbackFrameWidth?: number;
  fallbackFrameHeight?: number;
};

function normalizeSkillEffect(input: unknown): SkillEffect | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const row = input as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type.trim() : "";
  if (!type) {
    return null;
  }

  const value = toFiniteNumber(row.value);
  const duration = toPositiveInteger(row.duration);
  const chance = toFiniteNumber(row.chance);

  return {
    type,
    value: value ?? 0,
    duration: duration ?? 1,
    chance: chance === undefined ? 1 : Math.max(0, Math.min(1, chance)),
  };
}

function normalizeSkillEffects(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as SkillEffect[];
  }

  return input
    .map((row) => normalizeSkillEffect(row))
    .filter((row): row is SkillEffect => Boolean(row));
}

function normalizeVisualEffect(input: unknown): CombatSkillVisualEffect | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const row = input as Record<string, unknown>;
  const spriteUrl = typeof row.spriteUrl === "string" ? row.spriteUrl.trim() : "";
  if (!spriteUrl) {
    return null;
  }

  const frameWidth = toPositiveInteger(row.frameWidth);
  const frameHeight = toPositiveInteger(row.frameHeight);
  const frameCount = toPositiveInteger(row.frameCount);
  const frameDurationMs = toPositiveInteger(row.frameDurationMs);
  const scale = toFiniteNumber(row.scale);
  const offsetX = toFiniteNumber(row.offsetX);
  const offsetY = toFiniteNumber(row.offsetY);

  return {
    spriteUrl,
    ...(frameWidth ? { frameWidth } : {}),
    ...(frameHeight ? { frameHeight } : {}),
    ...(frameCount ? { frameCount } : {}),
    ...(frameDurationMs ? { frameDurationMs } : {}),
    ...(scale && scale > 0 ? { scale } : {}),
    ...(offsetX !== undefined ? { offsetX } : {}),
    ...(offsetY !== undefined ? { offsetY } : {}),
  };
}

function toResolverInput(context: SkillVisualEffectContextLike): SkillVisualEffectResolverInput | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }

  const row = context as Record<string, unknown>;
  const skillId = typeof row.skillId === "string"
    ? row.skillId
    : typeof row.id === "string"
      ? row.id
      : null;

  return {
    skillId,
    name: typeof row.name === "string" ? row.name : null,
    description: typeof row.description === "string" ? row.description : null,
    skillType: typeof row.skillType === "string" ? row.skillType : null,
    element: typeof row.element === "string" ? row.element : null,
    target: typeof row.target === "string" ? row.target : null,
    sourceType: typeof row.sourceType === "string" ? row.sourceType : null,
  };
}

export function normalizeSkillEffectsPayload(raw: unknown): SkillEffectsPayload {
  if (Array.isArray(raw)) {
    return {
      effects: normalizeSkillEffects(raw),
      visualEffect: null,
    };
  }

  if (!raw || typeof raw !== "object") {
    return {
      effects: [],
      visualEffect: null,
    };
  }

  const payload = raw as Record<string, unknown>;
  return {
    effects: normalizeSkillEffects(payload.effects),
    visualEffect: normalizeVisualEffect(payload.visualEffect),
  };
}

export function resolveSkillVisualEffectRenderMetrics(
  effect: CombatSkillVisualEffect | null | undefined,
  options?: SkillVisualEffectRenderMetricsOptions,
) {
  const frameWidth = toPositiveInteger(effect?.frameWidth)
    ?? toPositiveInteger(options?.fallbackFrameWidth)
    ?? toPositiveInteger(options?.sourceWidth)
    ?? 0;
  const frameHeight = toPositiveInteger(effect?.frameHeight)
    ?? toPositiveInteger(options?.fallbackFrameHeight)
    ?? toPositiveInteger(options?.sourceHeight)
    ?? 0;
  const scale = Math.max(0.5, toFiniteNumber(effect?.scale) ?? 1);
  const drawWidth = frameWidth * scale;
  const drawHeight = frameHeight * scale;
  const offsetX = (toFiniteNumber(effect?.offsetX) ?? 0) + (drawWidth * DEFAULT_VISUAL_EFFECT_RENDER_BIAS.xRatio);
  const offsetY = (toFiniteNumber(effect?.offsetY) ?? 0) + (drawHeight * DEFAULT_VISUAL_EFFECT_RENDER_BIAS.yRatio);

  return {
    frameWidth,
    frameHeight,
    scale,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
  };
}

export function resolveSkillEffectsPayload(
  raw: unknown,
  skillMeta?: SkillVisualEffectContextLike,
): SkillEffectsPayload {
  const normalized = normalizeSkillEffectsPayload(raw);
  const resolverInput = toResolverInput(skillMeta);
  if (normalized.visualEffect || !resolverInput) {
    return normalized;
  }

  return {
    effects: normalized.effects,
    visualEffect: inferSkillVisualEffect(resolverInput),
  };
}

export function pickSkillStatusEffects(raw: unknown) {
  return normalizeSkillEffectsPayload(raw).effects;
}

export function pickSkillVisualEffect(raw: unknown) {
  return normalizeSkillEffectsPayload(raw).visualEffect;
}

export function resolveSkillVisualEffect(raw: unknown, skillMeta?: SkillVisualEffectContextLike) {
  return resolveSkillEffectsPayload(raw, skillMeta).visualEffect;
}

export function getSkillVisualEffectDurationMs(effect: CombatSkillVisualEffect | null | undefined) {
  if (!effect) {
    return 0;
  }

  const frameCount = Math.max(1, Math.floor(Number(effect.frameCount) || 1));
  const frameDurationMs = Math.max(40, Math.floor(Number(effect.frameDurationMs) || 70));
  return frameCount * frameDurationMs;
}

export function buildSkillEffectsPayload(
  effectsRaw: unknown,
  visualEffectFields: SkillVisualEffectFormFields,
  context?: SkillVisualEffectContextLike,
) {
  const normalizedEffects = Array.isArray(effectsRaw)
    ? normalizeSkillEffects(effectsRaw)
    : normalizeSkillEffectsPayload(effectsRaw).effects;
  const visualEffect = normalizeVisualEffect({
    spriteUrl: visualEffectFields.visualEffectSpriteUrl,
    frameWidth: visualEffectFields.visualEffectFrameWidth,
    frameHeight: visualEffectFields.visualEffectFrameHeight,
    frameCount: visualEffectFields.visualEffectFrameCount,
    frameDurationMs: visualEffectFields.visualEffectFrameDurationMs,
    scale: visualEffectFields.visualEffectScale,
    offsetX: visualEffectFields.visualEffectOffsetX,
    offsetY: visualEffectFields.visualEffectOffsetY,
  });

  if (!visualEffect) {
    const resolverInput = toResolverInput(context || visualEffectFields);
    const inferredVisualEffect = resolverInput ? inferSkillVisualEffect(resolverInput) : null;
    if (!inferredVisualEffect) {
      return normalizedEffects;
    }

    return {
      effects: normalizedEffects,
      visualEffect: inferredVisualEffect,
    } satisfies SkillEffectsPayload;
  }

  return {
    effects: normalizedEffects,
    visualEffect,
  } satisfies SkillEffectsPayload;
}

export function splitSkillEffectsPayload(raw: unknown, context?: SkillVisualEffectContextLike) {
  const { effects, visualEffect } = resolveSkillEffectsPayload(raw, context);
  return {
    effects,
    visualEffectSpriteUrl: visualEffect?.spriteUrl,
    visualEffectFrameWidth: visualEffect?.frameWidth,
    visualEffectFrameHeight: visualEffect?.frameHeight,
    visualEffectFrameCount: visualEffect?.frameCount,
    visualEffectFrameDurationMs: visualEffect?.frameDurationMs,
    visualEffectScale: visualEffect?.scale,
    visualEffectOffsetX: visualEffect?.offsetX,
    visualEffectOffsetY: visualEffect?.offsetY,
  };
}
