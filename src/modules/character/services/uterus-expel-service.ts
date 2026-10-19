import { createHmac, timingSafeEqual } from "crypto";

export const UTERUS_EXPEL_COOKIE = "game_uterus_expel_ticket";
export const UTERUS_EXPEL_DURATION_MS = 60 * 1000;
export const UTERUS_EXPEL_COOKIE_MAX_AGE_SECONDS = 5 * 60;

type UterusExpelTicketPayload = {
  playerId: string;
  startedAt: string;
};

function getUterusExpelSecret() {
  return process.env.UTERUS_EXPEL_SECRET
    || process.env.MEDITATION_SECRET
    || process.env.AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || "immortality-local-uterus-expel-secret";
}

function signPayload(payload: string) {
  return createHmac("sha256", getUterusExpelSecret())
    .update(payload)
    .digest("base64url");
}

export function createUterusExpelTicket(payload: UterusExpelTicketPayload) {
  const rawPayload = JSON.stringify(payload);
  const encodedPayload = Buffer.from(rawPayload, "utf8").toString("base64url");
  const signature = signPayload(rawPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseUterusExpelTicket(ticket: string, expectedPlayerId: string): UterusExpelTicketPayload | null {
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
    const payload = JSON.parse(rawPayload) as UterusExpelTicketPayload;
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

export function resolveUterusExpelPercent(startedAt: string, nowMs = Date.now()) {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, Math.min(100, Math.floor((elapsedMs / UTERUS_EXPEL_DURATION_MS) * 100)));
}

export function resolveUterusExpelReadyAt(startedAt: string) {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return new Date(Date.now() + UTERUS_EXPEL_DURATION_MS).toISOString();
  }
  return new Date(startedAtMs + UTERUS_EXPEL_DURATION_MS).toISOString();
}
