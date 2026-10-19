import type {
  AttributeDelta,
  FortuneEventAttributeDelta,
  FortuneModifierValue,
  FortuneRateModifierValue,
} from "@/types/game";

export const FORTUNE_ATTRIBUTE_KEYS = [
  "hp",
  "maxHp",
  "mp",
  "maxMp",
  "attack",
  "defense",
  "speed",
  "luck",
  "spiritualSense",
  "armorPenetration",
  "block",
  "skillDamageBonus",
  "skillDamageReduction",
  "artifactDamageBonus",
  "artifactDamageReduction",
] as const;

export type FortuneAttributeKey = typeof FORTUNE_ATTRIBUTE_KEYS[number];

export type NormalizedFortuneModifier = {
  flat: number;
  percent: number;
};

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function parsePercentText(value: string) {
  const trimmed = value.trim();
  if (!trimmed.endsWith("%")) {
    return null;
  }
  const parsed = Number(trimmed.slice(0, -1).trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseModifierNumber(value: unknown) {
  if (typeof value === "string") {
    const percent = parsePercentText(value);
    if (percent !== null) {
      return {
        kind: "percent" as const,
        value: percent,
      };
    }
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return {
    kind: "flat" as const,
    value: parsed,
  };
}

export function normalizeFortuneModifierValue(value: FortuneModifierValue | null | undefined): NormalizedFortuneModifier {
  if (value === null || value === undefined || value === "") {
    return { flat: 0, percent: 0 };
  }

  if (typeof value === "number" || typeof value === "string") {
    const parsed = parseModifierNumber(value);
    if (!parsed) {
      return { flat: 0, percent: 0 };
    }
    return parsed.kind === "percent"
      ? { flat: 0, percent: parsed.value }
      : { flat: parsed.value, percent: 0 };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { flat: 0, percent: 0 };
  }

  const typed = value as Record<string, unknown>;
  const flatCandidate = parseModifierNumber(
    typed.flat ?? typed.value ?? typed.amount,
  );
  const percentCandidate = parseModifierNumber(
    typed.percent ?? typed.rate ?? typed.pct,
  );

  return {
    flat: flatCandidate && flatCandidate.kind === "flat" ? flatCandidate.value : 0,
    percent: percentCandidate
      ? percentCandidate.kind === "percent"
        ? percentCandidate.value
        : percentCandidate.value
      : 0,
  };
}

export function hasMeaningfulFortuneModifier(value: FortuneModifierValue | null | undefined) {
  const normalized = normalizeFortuneModifierValue(value);
  return normalized.flat !== 0 || normalized.percent !== 0;
}

export function serializeFortuneModifierValue(value: {
  flat?: unknown;
  percent?: unknown;
}) {
  const flat = Number(value.flat);
  const percent = Number(value.percent);
  const hasFlat = Number.isFinite(flat) && flat !== 0;
  const hasPercent = Number.isFinite(percent) && percent !== 0;

  if (hasFlat && !hasPercent) {
    return flat;
  }

  if (!hasFlat && !hasPercent) {
    return undefined;
  }

  const output: Record<string, number> = {};
  if (hasFlat) {
    output.flat = flat;
  }
  if (hasPercent) {
    output.percent = percent;
  }
  return output;
}

export function normalizeFortuneEventAttributeDelta(
  input: FortuneEventAttributeDelta | AttributeDelta | null | undefined,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {} as Partial<Record<FortuneAttributeKey, NormalizedFortuneModifier>>;
  }

  const typed = input as Record<string, unknown>;
  const output: Partial<Record<FortuneAttributeKey, NormalizedFortuneModifier>> = {};
  for (const key of FORTUNE_ATTRIBUTE_KEYS) {
    const normalized = normalizeFortuneModifierValue(typed[key] as FortuneModifierValue | undefined);
    if (normalized.flat !== 0 || normalized.percent !== 0 || Object.prototype.hasOwnProperty.call(typed, key)) {
      output[key] = normalized;
    }
  }
  return output;
}

export function normalizeFortuneRateValue(value: FortuneRateModifierValue | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const percent = parsePercentText(value);
    if (percent !== null) {
      return percent / 100;
    }
    return toFiniteNumber(value);
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  const typed = value as Record<string, unknown>;
  const rawValue = typed.value ?? typed.flat ?? typed.amount;
  const directValue = toFiniteNumber(rawValue);
  const percentValue = toFiniteNumber(typed.percent ?? typed.rate ?? typed.pct);
  return directValue + percentValue / 100;
}
