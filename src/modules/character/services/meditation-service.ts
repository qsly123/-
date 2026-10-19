import { createHmac, timingSafeEqual } from "crypto";

export const MEDITATION_COOKIE = "game_meditation_ticket";
export const MEDITATION_TOTAL_PERCENT = 100;
export const MEDITATION_DURATION_MS = 60 * 1000;
export const MEDITATION_MS_PER_PERCENT = MEDITATION_DURATION_MS / MEDITATION_TOTAL_PERCENT;
export const MEDITATION_COOKIE_MAX_AGE_SECONDS = 5 * 60;

type MeditationTicketPayload = {
  playerId: string;
  startedAt: string;
};

function getMeditationSecret() {
  return process.env.MEDITATION_SECRET
    || process.env.AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || "immortality-local-meditation-secret";
}

function signPayload(payload: string) {
  return createHmac("sha256", getMeditationSecret())
    .update(payload)
    .digest("base64url");
}

export function createMeditationTicket(payload: MeditationTicketPayload) {
  const rawPayload = JSON.stringify(payload);
  const encodedPayload = Buffer.from(rawPayload, "utf8").toString("base64url");
  const signature = signPayload(rawPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseMeditationTicket(ticket: string, expectedPlayerId: string): MeditationTicketPayload | null {
  const parts = ticket.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return null;
  }

  let rawPayload = "";
  try {
    rawPayload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSignature = signPayload(rawPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(rawPayload) as MeditationTicketPayload;
    if (!payload || payload.playerId !== expectedPlayerId || typeof payload.startedAt !== "string") {
      return null;
    }

    const startedAtMs = Date.parse(payload.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function resolveMeditationPercent(startedAt: string, nowMs = Date.now()) {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(
    0,
    Math.min(MEDITATION_TOTAL_PERCENT, Math.floor(elapsedMs / MEDITATION_MS_PER_PERCENT)),
  );
}

export function resolveMeditationReadyAt(startedAt: string) {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return new Date(Date.now() + MEDITATION_DURATION_MS).toISOString();
  }
  return new Date(startedAtMs + MEDITATION_DURATION_MS).toISOString();
}

export function calcMeditationRecovery(current: number, max: number, percent: number) {
  const normalizedCurrent = Math.max(0, Math.min(current, max));
  const normalizedPercent = Math.max(0, Math.min(MEDITATION_TOTAL_PERCENT, Math.floor(percent)));
  if (normalizedPercent <= 0 || max <= normalizedCurrent) {
    return {
      recovered: 0,
      next: normalizedCurrent,
    };
  }

  const intendedRecover = Math.max(1, Math.ceil((max * normalizedPercent) / 100));
  const recovered = Math.min(max - normalizedCurrent, intendedRecover);
  return {
    recovered,
    next: normalizedCurrent + recovered,
  };
}


