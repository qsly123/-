import type { GameServerHealth } from "@immortality/shared-protocol";

export interface AdminGameServerHealthSnapshot {
  ok: boolean;
  checkedAt: string;
  url: string;
  latencyMs: number | null;
  statusCode: number | null;
  health: GameServerHealth | null;
  error?: string;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isDockerBridgeAddress(value: string) {
  return /^https?:\/\/172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+(?::\d+)?(?:\/|$)/.test(value);
}

function appendGameServerHealthPath(value: string) {
  const url = trimTrailingSlash(value);
  return url.endsWith("/game-server/health") ? url : `${url}/game-server/health`;
}

export function resolveGameServerHealthUrlFromEnv(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const internalUrl = String(env.GAME_SERVER_INTERNAL_URL || "").trim();
  const explicitHealthUrl = String(env.GAME_SERVER_HEALTH_URL || "").trim();
  if (explicitHealthUrl) {
    if (internalUrl && isDockerBridgeAddress(explicitHealthUrl)) {
      return appendGameServerHealthPath(internalUrl);
    }
    return explicitHealthUrl;
  }

  if (internalUrl) {
    return appendGameServerHealthPath(internalUrl);
  }

  const publicUrl = String(env.GAME_SERVER_PUBLIC_URL || env.GAME_SERVER_URL || "").trim();
  if (publicUrl) {
    return appendGameServerHealthPath(publicUrl);
  }

  const port = Number.parseInt(String(env.GAME_SERVER_PORT || "3201").trim(), 10) || 3201;
  return `http://127.0.0.1:${port}/game-server/health`;
}

export function resolveGameServerHealthUrl() {
  return resolveGameServerHealthUrlFromEnv(process.env);
}

export async function fetchGameServerHealthSnapshot(): Promise<AdminGameServerHealthSnapshot> {
  const url = resolveGameServerHealthUrl();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as GameServerHealth | null;
    const latencyMs = Date.now() - startedAt;
    const ok = response.ok && body?.ok === true;

    return {
      ok,
      checkedAt: new Date().toISOString(),
      url,
      latencyMs,
      statusCode: response.status,
      health: body,
      error: ok ? undefined : "game-server health returned degraded status",
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      url,
      latencyMs: Date.now() - startedAt,
      statusCode: null,
      health: null,
      error: error instanceof Error ? error.message : "game-server health unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}
