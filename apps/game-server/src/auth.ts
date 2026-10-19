import type { AuthContext } from "colyseus";
import type { JoinRoomOptions } from "@immortality/shared-protocol";

const SESSION_COOKIE = "immortality_session";
const ACTIVE_PLAYER_COOKIE = "immortality_active_player";

export type GameServerAuthMode = "required" | "optional" | "disabled";

export interface NormalizedJoinRoomOptions {
  sessionToken?: string;
  playerId?: string;
  mapId: string;
  shardId: string;
  combatId?: string;
  partyId?: string;
  sectId?: string;
}

export interface GameRoomAuthContext {
  accountId: string | null;
  playerId: string;
  playerName: string;
  authenticated: boolean;
  authMode: GameServerAuthMode;
  joinOptions: NormalizedJoinRoomOptions;
}

function normalizeOptionalId(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > 128 || !/^[\w:.-]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeRequiredRoomId(value: unknown, fallback: string) {
  const normalized = normalizeOptionalId(value);
  if (!normalized) {
    return fallback;
  }
  return normalized;
}

export function normalizeJoinRoomOptions(options: JoinRoomOptions = {}): NormalizedJoinRoomOptions {
  return {
    sessionToken: normalizeOptionalId(options.sessionToken),
    playerId: normalizeOptionalId(options.playerId),
    mapId: normalizeRequiredRoomId(options.mapId, "default"),
    shardId: normalizeRequiredRoomId(options.shardId, "0"),
    combatId: normalizeOptionalId(options.combatId),
    partyId: normalizeOptionalId(options.partyId),
    sectId: normalizeOptionalId(options.sectId),
  };
}

export function parseCookieHeader(cookieHeader: string) {
  const cookieMap = new Map<string, string[]>();
  const raw = cookieHeader.trim();
  if (!raw) {
    return cookieMap;
  }

  for (const chunk of raw.split(";")) {
    const separatorIndex = chunk.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    const values = cookieMap.get(key) || [];
    values.push(decodeURIComponent(value));
    cookieMap.set(key, values);
  }

  return cookieMap;
}

function getLatestCookieValue(cookieMap: Map<string, string[]>, key: string) {
  const values = cookieMap.get(key);
  if (!values || values.length === 0) {
    return undefined;
  }
  return values[values.length - 1];
}

export function resolveGameServerAuthMode(authModeOverride?: GameServerAuthMode) {
  if (authModeOverride) {
    return authModeOverride;
  }

  const configured = String(process.env.GAME_SERVER_AUTH_MODE || "").trim().toLowerCase();
  if (configured === "required" || configured === "optional" || configured === "disabled") {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "required" : "optional";
}

function readAuthTokens(options: NormalizedJoinRoomOptions, context: AuthContext) {
  const cookieHeader = context.headers.get("cookie") || "";
  const cookies = parseCookieHeader(cookieHeader);
  const cookieActivePlayerId = getLatestCookieValue(cookies, ACTIVE_PLAYER_COOKIE);
  const requestedPlayerId = options.playerId;

  if (cookieActivePlayerId && requestedPlayerId && cookieActivePlayerId !== requestedPlayerId) {
    throw new Error("game_server_player_cookie_mismatch");
  }

  return {
    sessionToken: options.sessionToken
      || normalizeOptionalId(context.token)
      || getLatestCookieValue(cookies, SESSION_COOKIE),
    activePlayerId: cookieActivePlayerId || requestedPlayerId,
  };
}

function assertDatabaseUrlConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未配置");
  }
}

async function loadAuthDb() {
  assertDatabaseUrlConfigured();
  const [{ and, eq }, { db, schema }] = await Promise.all([
    import("drizzle-orm"),
    import("../../../src/db"),
  ]);
  const { accounts, players, sessions } = schema;
  return {
    and,
    eq,
    db,
    accounts,
    players,
    sessions,
  };
}

function createFallbackAuth(params: {
  fallbackPlayerId: string;
  mode: GameServerAuthMode;
  joinOptions: NormalizedJoinRoomOptions;
}): GameRoomAuthContext {
  const playerId = params.joinOptions.playerId || normalizeOptionalId(params.fallbackPlayerId) || "guest";
  return {
    accountId: null,
    playerId,
    playerName: playerId,
    authenticated: false,
    authMode: params.mode,
    joinOptions: params.joinOptions,
  };
}

export async function authenticateGameRoomJoin(params: {
  options?: JoinRoomOptions;
  context: AuthContext;
  fallbackPlayerId: string;
  authMode?: GameServerAuthMode;
}): Promise<GameRoomAuthContext> {
  const mode = resolveGameServerAuthMode(params.authMode);
  const joinOptions = normalizeJoinRoomOptions(params.options || {});

  if (mode === "disabled") {
    return createFallbackAuth({
      fallbackPlayerId: params.fallbackPlayerId,
      mode,
      joinOptions,
    });
  }

  const { sessionToken, activePlayerId } = readAuthTokens(joinOptions, params.context);
  if (!sessionToken || !activePlayerId) {
    if (mode === "optional") {
      return createFallbackAuth({
        fallbackPlayerId: params.fallbackPlayerId,
        mode,
        joinOptions,
      });
    }
    throw new Error("game_server_auth_missing");
  }

  const authDb = await loadAuthDb();
  const session = await authDb.db.select().from(authDb.sessions).where(authDb.eq(authDb.sessions.id, sessionToken)).get();
  if (!session) {
    throw new Error("game_server_session_not_found");
  }

  if (new Date(session.expiresAt) < new Date()) {
    throw new Error("game_server_session_expired");
  }

  const account = await authDb.db.select().from(authDb.accounts).where(authDb.eq(authDb.accounts.id, session.accountId)).get();
  if (!account) {
    throw new Error("game_server_account_not_found");
  }

  const player = await authDb.db.select().from(authDb.players).where(authDb.and(
    authDb.eq(authDb.players.id, activePlayerId),
    authDb.eq(authDb.players.accountId, account.id),
  )).get();
  if (!player) {
    throw new Error("game_server_player_not_found");
  }

  return {
    accountId: account.id,
    playerId: player.id,
    playerName: player.name,
    authenticated: true,
    authMode: mode,
    joinOptions: {
      ...joinOptions,
      sessionToken,
      playerId: player.id,
    },
  };
}
