import { cookies } from "next/headers";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { accounts, oauthAccounts, players, sessions } from "@/db/schema";
import {
  ACTIVE_PLAYER_COOKIE,
  LINUXDO_OAUTH_STATE_COOKIE,
  LINUXDO_OAUTH_STATE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/modules/shared/constants";
import { getPlayerByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getRealmFullNameByPosition, toLinearRealm } from "@/modules/character/services/realm-service";
import { recoverPlayerStamina } from "@/modules/character/services/stamina-service";
import { recoverPlayerPillToxicity } from "@/modules/character/services/pill-toxicity-service";
import { LINUXDO_OAUTH_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";
import { getRequiredSystemConfigMap } from "@/modules/system/services/system-config";
import { resolveCookieSecureFlag } from "@/modules/shared/services/cookie-security";

const LINUXDO_PROVIDER = "linuxdo";
type QueryExecutor = Pick<typeof db, "select">;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_BOOTSTRAP_LOCK_KEY = 2026031201;
const PASSWORD_HASH_PREFIX = "scrypt";

type SqlExecutor = Pick<typeof db, "execute">;

type LinuxDoOAuthConfig = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userEndpoint: string;
  redirectUri: string;
  scope: string;
};

type RecoverablePlayer = NonNullable<Awaited<ReturnType<typeof getPlayerByIdCompat>>>;
let hasWarnedMissingPlayerLastSeenColumn = false;
type AuthRuntimeGlobal = typeof globalThis & {
  __playerLastSeenTouchAtById?: Map<string, number>;
};

function getPlayerLastSeenTouchStore() {
  const runtime = globalThis as AuthRuntimeGlobal;
  if (!runtime.__playerLastSeenTouchAtById) {
    runtime.__playerLastSeenTouchAtById = new Map<string, number>();
  }
  return runtime.__playerLastSeenTouchAtById;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const normalizedHash = String(passwordHash || "").trim();
  if (!normalizedHash) {
    return false;
  }

  const [prefix, salt, storedHash] = normalizedHash.split("$");
  if (prefix === PASSWORD_HASH_PREFIX && salt && storedHash) {
    const derivedKey = scryptSync(password, salt, 64);
    const storedBuffer = Buffer.from(storedHash, "hex");
    if (storedBuffer.length !== derivedKey.length) {
      return false;
    }
    return timingSafeEqual(derivedKey, storedBuffer);
  }

  return md5(password) === normalizedHash;
}

function isLegacyPasswordHash(passwordHash: string) {
  return !String(passwordHash || "").startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

async function acquireAdminBootstrapLock(tx: SqlExecutor) {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_LOCK_KEY})`);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

async function getLinuxDoOAuthConfig(): Promise<LinuxDoOAuthConfig> {
  const config = await getRequiredSystemConfigMap(LINUXDO_OAUTH_CONFIG_KEYS);
  return {
    clientId: config.LINUXDO_CLIENT_ID,
    clientSecret: config.LINUXDO_CLIENT_SECRET,
    authorizationEndpoint: config.LINUXDO_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: config.LINUXDO_TOKEN_ENDPOINT,
    userEndpoint: config.LINUXDO_USER_ENDPOINT,
    redirectUri: config.LINUXDO_REDIRECT_URI,
    scope: config.LINUXDO_SCOPE,
  };
}

export async function getLinuxDoRedirectOrigin(): Promise<string> {
  const config = await getLinuxDoOAuthConfig();
  return new URL(config.redirectUri).origin;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function extractLinuxDoUserId(payload: unknown): string | null {
  if (!isObject(payload)) return null;

  const candidates = [payload.id, payload.sub, payload.user_id, payload.uid];
  for (const candidate of candidates) {
    const parsed = toNonEmptyString(candidate);
    if (parsed) return parsed;
  }

  if (isObject(payload.user)) {
    return extractLinuxDoUserId(payload.user);
  }
  return null;
}

async function exchangeLinuxDoToken(code: string, config: LinuxDoOAuthConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });

  const tokenRes = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    throw new Error(`Linux.do token 请求失败: ${tokenRes.status}`);
  }

  const tokenPayload: unknown = await tokenRes.json();
  if (!isObject(tokenPayload)) {
    throw new Error("Linux.do token 响应格式错误");
  }

  const accessToken = toNonEmptyString(tokenPayload.access_token);
  if (!accessToken) {
    throw new Error("Linux.do 未返回 access_token");
  }

  return accessToken;
}

async function fetchLinuxDoUserId(accessToken: string, config: LinuxDoOAuthConfig): Promise<string> {
  const userRes = await fetch(config.userEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!userRes.ok) {
    throw new Error(`Linux.do user 请求失败: ${userRes.status}`);
  }

  const userPayload: unknown = await userRes.json();
  const providerUserId = extractLinuxDoUserId(userPayload);
  if (!providerUserId) {
    throw new Error("Linux.do user 响应缺少用户 ID");
  }

  return providerUserId;
}

async function findLinuxDoAccount(providerUserId: string, queryDb: QueryExecutor = db) {
  const mapping = await queryDb
    .select()
    .from(oauthAccounts)
    .where(and(
      eq(oauthAccounts.provider, LINUXDO_PROVIDER),
      eq(oauthAccounts.providerUserId, providerUserId),
    ))
    .get();

  if (!mapping) {
    return null;
  }

  const account = await queryDb.select().from(accounts).where(eq(accounts.id, mapping.accountId)).get();
  if (!account) {
    throw new Error("Linux.do 账号映射异常：账号不存在");
  }

  return { accountId: account.id };
}

async function findOrCreateAccountByLinuxDo(providerUserId: string) {
  const existing = await findLinuxDoAccount(providerUserId);
  if (existing) {
    return existing;
  }

  try {
    return await db.transaction(async (tx) => {
      await acquireAdminBootstrapLock(tx);
      const duplicatedCheck = await findLinuxDoAccount(providerUserId, tx);
      if (duplicatedCheck) {
        return duplicatedCheck;
      }

      const accountCount = await tx.select({ total: count() }).from(accounts).get();
      const isAdmin = (accountCount?.total ?? 0) === 0;
      const accountId = nanoid(16);
      const passwordHash = hashPassword(nanoid(32));

      await tx.insert(accounts).values({
        id: accountId,
        username: null,
        email: null,
        passwordHash,
        isAdmin,
        updatedAt: new Date().toISOString(),
      }).run();

      await tx.insert(oauthAccounts).values({
        id: nanoid(16),
        provider: LINUXDO_PROVIDER,
        providerUserId,
        accountId,
      }).run();

      return { accountId };
    });
  } catch (error) {
    const rootError = isObject(error) ? error : null;
    const rootCause = rootError && isObject(rootError.cause) ? rootError.cause : rootError;
    const code = rootCause ? toNonEmptyString(rootCause.code) : null;
    const constraint = rootCause ? toNonEmptyString(rootCause.constraint_name) : null;

    if (code !== "23505" || constraint !== "oauth_accounts_provider_provider_user_id_unique") {
      throw error;
    }

    const mapped = await findLinuxDoAccount(providerUserId);
    if (mapped) {
      return mapped;
    }

    throw error;
  }
}

async function getCookieOptions() {
  return {
    httpOnly: true,
    secure: await resolveCookieSecureFlag(),
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE / 1000,
    path: "/",
  };
}

function getLatestCookieValue(cookieStore: Awaited<ReturnType<typeof cookies>>, key: string): string | null {
  const values = cookieStore.getAll(key);
  if (values.length === 0) {
    return null;
  }
  return values[values.length - 1]?.value ?? null;
}

function parseCookieHeader(cookieHeader: string): Map<string, string[]> {
  const cookieMap = new Map<string, string[]>();
  const raw = String(cookieHeader || "").trim();
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
    const nextValues = cookieMap.get(key) || [];
    nextValues.push(decodeURIComponent(value));
    cookieMap.set(key, nextValues);
  }

  return cookieMap;
}

function getLatestCookieValueFromHeader(request: Request | null | undefined, key: string): string | null {
  const cookieHeader = request?.headers?.get("cookie") || "";
  const values = parseCookieHeader(cookieHeader).get(key);
  if (!values || values.length === 0) {
    return null;
  }
  return values[values.length - 1] ?? null;
}



/** 创建会话（账号级） */
export async function createSession(accountId: string): Promise<string> {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE).toISOString();

  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.accountId, accountId)).run();
    await tx.insert(sessions).values({
      id: token,
      accountId,
      expiresAt,
    }).run();
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, await getCookieOptions());
  // 登录/注册后强制重新选角色，避免跨账号残留 activePlayerId
  cookieStore.delete(ACTIVE_PLAYER_COOKIE);

  return token;
}

export async function setActivePlayer(playerId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PLAYER_COOKIE, playerId, await getCookieOptions());
}

export async function clearActivePlayer() {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_PLAYER_COOKIE);
}

/** 获取当前登录账号 */
export async function getCurrentAccount(request?: Request | null) {
  const token = request
    ? getLatestCookieValueFromHeader(request, SESSION_COOKIE)
    : getLatestCookieValue(await cookies(), SESSION_COOKIE);
  if (!token) return null;

  const session = await db.select().from(sessions).where(eq(sessions.id, token)).get();
  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, token)).run();
    return null;
  }

  const account = await db.select().from(accounts).where(eq(accounts.id, session.accountId)).get();
  if (!account) {
    await db.delete(sessions).where(eq(sessions.id, token)).run();
    return null;
  }

  return account;
}

async function safelyRecoverCurrentPlayer(player: RecoverablePlayer): Promise<RecoverablePlayer> {
  let currentPlayer = player;

  try {
    const major = currentPlayer.realmMajor || 1;
    const minor = currentPlayer.realmMinor || 1;
    const normalizedRealm = await toLinearRealm(major, minor);
    const normalizedRealmName = await getRealmFullNameByPosition(major, minor);

    if (currentPlayer.realm !== normalizedRealm || currentPlayer.realmName !== normalizedRealmName) {
      currentPlayer = {
        ...currentPlayer,
        realm: normalizedRealm,
        realmName: normalizedRealmName,
      };
    }
  } catch (error) {
    console.error("[auth] normalize current player realm failed:", currentPlayer.id, error);
  }

  try {
    currentPlayer = await recoverPlayerStamina(currentPlayer, { persist: false });
  } catch (error) {
    console.error("[auth] recover current player stamina failed:", currentPlayer.id, error);
  }

  try {
    currentPlayer = await recoverPlayerPillToxicity(currentPlayer, new Date(), { persist: false });
  } catch (error) {
    console.error("[auth] recover current player pill toxicity failed:", currentPlayer.id, error);
  }

  return currentPlayer;
}

async function touchPlayerLastSeen(playerId: string, lastSeenAt?: string | null) {
  const touchStore = getPlayerLastSeenTouchStore();
  const lastTouchedAtMs = Number(touchStore.get(playerId) || 0);
  if (lastTouchedAtMs > 0 && Date.now() - lastTouchedAtMs < 5 * 60 * 1000) {
    return;
  }

  const lastSeenMs = Date.parse(String(lastSeenAt || ""));
  if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < 5 * 60 * 1000) {
    touchStore.set(playerId, Date.now());
    return;
  }
  const nowIso = new Date().toISOString();
  try {
    await db.update(players).set({
      lastSeenAt: nowIso,
    }).where(eq(players.id, playerId)).run();
    touchStore.set(playerId, Date.now());
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error
      ? (error as { cause?: { code?: string; message?: string } }).cause
      : undefined;
    const message = error instanceof Error ? error.message : String(error || "");
    const causeMessage = typeof cause?.message === "string" ? cause.message : "";
    const isMissingLastSeenColumn = cause?.code === "42703"
      && (message.includes("last_seen_at") || causeMessage.includes("last_seen_at"));

    if (isMissingLastSeenColumn) {
      if (!hasWarnedMissingPlayerLastSeenColumn) {
        hasWarnedMissingPlayerLastSeenColumn = true;
        console.warn("[auth] players.last_seen_at 缺失，已跳过最后在线时间刷新；请确认容器已执行核心表结构自举。");
      }
      return;
    }

    console.error("[auth] 更新玩家最后在线时间失败", error);
  }
}

/** 获取当前选择的角色 */
export async function getCurrentPlayer(request?: Request | null) {
  const account = await getCurrentAccount(request);
  if (!account) return null;

  const activePlayerId = request
    ? getLatestCookieValueFromHeader(request, ACTIVE_PLAYER_COOKIE)
    : getLatestCookieValue(await cookies(), ACTIVE_PLAYER_COOKIE);
  if (!activePlayerId) return null;

  const player = await getPlayerByIdCompat(activePlayerId);
  if (!player) {
    return null;
  }
  if (player.accountId !== account.id) {
    return null;
  }
  const recoveredPlayer = await safelyRecoverCurrentPlayer(player);
  await touchPlayerLastSeen(recoveredPlayer.id, recoveredPlayer.lastSeenAt);
  return recoveredPlayer;
}

/** 获取当前管理员（账号级） */
export async function getCurrentAdmin() {
  const account = await getCurrentAccount();
  if (!account || !account.isAdmin) {
    return null;
  }
  return account;
}

/** 注册（邮箱） */
export async function registerPlayerByEmail(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return { error: "邮箱格式不正确" };
  }

  try {
    const accountId = await db.transaction(async (tx) => {
      await acquireAdminBootstrapLock(tx);

      const existing = await tx.select().from(accounts).where(eq(accounts.email, normalizedEmail)).get();
      if (existing) {
        return null;
      }

      const accountCount = await tx.select({ total: count() }).from(accounts).get();
      const isAdmin = (accountCount?.total ?? 0) === 0;
      const id = nanoid(16);

      await tx.insert(accounts).values({
        id,
        username: null,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        isAdmin,
        updatedAt: new Date().toISOString(),
      }).run();

      return id;
    });

    if (!accountId) {
      return { error: "该邮箱已被注册" };
    }

    await createSession(accountId);
    return { accountId };
  } catch (error) {
    const rootError = isObject(error) ? error : null;
    const rootCause = rootError && isObject(rootError.cause) ? rootError.cause : rootError;
    const code = rootCause ? toNonEmptyString(rootCause.code) : null;
    if (code === "23505") {
      return { error: "该邮箱已被注册" };
    }
    throw error;
  }
}

/** 登录（邮箱） */
export async function loginPlayerByEmail(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return { error: "邮箱或密码错误" };
  }

  const account = await db.select().from(accounts).where(eq(accounts.email, normalizedEmail)).get();
  if (!account) {
    return { error: "邮箱或密码错误" };
  }

  const valid = verifyPassword(password, account.passwordHash);
  if (!valid) {
    return { error: "邮箱或密码错误" };
  }

  if (isLegacyPasswordHash(account.passwordHash)) {
    await db.update(accounts).set({
      passwordHash: hashPassword(password),
      updatedAt: new Date().toISOString(),
    }).where(eq(accounts.id, account.id)).run();
  }

  await createSession(account.id);
  return { accountId: account.id };
}

/** 旧账号绑定邮箱（仅绑定，不创建会话） */
export async function bindEmailForLegacyAccount(username: string, password: string, email: string) {
  const normalizedUsername = username.trim();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedUsername) {
    return { error: "请输入旧用户名" };
  }
  if (!isValidEmail(normalizedEmail)) {
    return { error: "邮箱格式不正确" };
  }

  const account = await db.select().from(accounts).where(eq(accounts.username, normalizedUsername)).get();
  if (!account) {
    return { error: "旧用户名或密码错误" };
  }

  const valid = verifyPassword(password, account.passwordHash);
  if (!valid) {
    return { error: "旧用户名或密码错误" };
  }

  if (isLegacyPasswordHash(account.passwordHash)) {
    await db.update(accounts).set({
      passwordHash: hashPassword(password),
      updatedAt: new Date().toISOString(),
    }).where(eq(accounts.id, account.id)).run();
  }

  if (account.email) {
    return { error: "该账号已绑定邮箱" };
  }

  const duplicated = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, normalizedEmail)).get();
  if (duplicated) {
    return { error: "该邮箱已被其他账号绑定" };
  }

  await db.update(accounts).set({
    email: normalizedEmail,
    updatedAt: new Date().toISOString(),
  }).where(eq(accounts.id, account.id)).run();

  return { accountId: account.id };
}

/** 获取 Linux.do 授权地址并写入 state cookie */
export async function getLinuxDoAuthorizeUrl() {
  const config = await getLinuxDoOAuthConfig();
  const state = nanoid(24);
  const cookieStore = await cookies();

  cookieStore.set(LINUXDO_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: await resolveCookieSecureFlag(),
    sameSite: "lax",
    maxAge: LINUXDO_OAUTH_STATE_MAX_AGE / 1000,
    path: "/",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
  });

  return `${config.authorizationEndpoint}?${params.toString()}`;
}

/** 处理 Linux.do 回调并创建本地会话 */
export async function loginByLinuxDo(code: string, state: string) {
  const cookieStore = await cookies();
  const savedState = getLatestCookieValue(cookieStore, LINUXDO_OAUTH_STATE_COOKIE);
  cookieStore.delete(LINUXDO_OAUTH_STATE_COOKIE);

  if (!savedState || !state || savedState !== state) {
    throw new Error("Linux.do state 校验失败");
  }

  const config = await getLinuxDoOAuthConfig();
  const accessToken = await exchangeLinuxDoToken(code, config);
  const providerUserId = await fetchLinuxDoUserId(accessToken, config);
  const account = await findOrCreateAccountByLinuxDo(providerUserId);

  await createSession(account.accountId);
  return account;
}

/** 登出 */
export async function logoutPlayer() {
  const cookieStore = await cookies();
  const token = getLatestCookieValue(cookieStore, SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, token)).run();
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(ACTIVE_PLAYER_COOKIE);
}
