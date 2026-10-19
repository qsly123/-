import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  marketListings,
  playerInventory,
  players,
  systemConfigs,
} from "../src/db/schema";

const PORT = Number(process.env.SMOKE_TEST_PORT || 3101);
const BASE_URL = process.env.SMOKE_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.SMOKE_TEST_REUSE_SERVER === "1";
const TEST_ACCOUNT_COUNT = 6;
const TMP_DIR = path.resolve(process.cwd(), ".tmp");
const STDOUT_LOG_PATH = path.join(TMP_DIR, "local-multi-account-smoke.stdout.log");
const STDERR_LOG_PATH = path.join(TMP_DIR, "local-multi-account-smoke.stderr.log");
const REPORT_LOG_PATH = path.join(TMP_DIR, "local-multi-account-smoke.report.log");
const MATERIAL_IDS = [
  "item_four_realms_lianqi_material_1",
  "item_four_realms_lianqi_material_2",
  "item_four_realms_lianqi_material_3",
  "item_four_realms_lianqi_material_4",
] as const;

function createSmokeActionMeta(params: { clientSequence: number; clientSceneTick: number }) {
  return {
    actionId: `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    clientSentAt: Date.now(),
    clientSequence: params.clientSequence,
    clientSceneTick: params.clientSceneTick,
  };
}

type ApiEnvelope<T = unknown> = {
  success: boolean;
  error?: string;
  maintenance?: boolean;
  data?: T;
};

type SmokeFailure = {
  step: string;
  error: string;
};

type SmokeNote = {
  step: string;
  message: string;
};

type CreatedAccount = {
  index: number;
  email: string;
  password: string;
  playerName: string;
  gender: "男" | "女";
  playerId: string;
  client: ApiClient;
};

type AuthMeData = {
  id: string;
  name: string;
  currentMapId: string | null;
  positionX: number;
  positionY: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
};

type InventoryData = {
  items: Array<{
    itemId: string;
    quantity: number;
    equipped: boolean;
    itemType: string;
    isBound: boolean;
  }>;
  gold: number;
};

type MapData = {
  map: {
    id: string;
    width: number;
    height: number;
    tilesData: Array<{ x: number; y: number; walkable?: boolean }> | null;
  };
  player: {
    positionX: number;
    positionY: number;
  };
  linkedMaps: Array<{
    id: string;
    available?: boolean;
    disabledReason?: string | null;
  }>;
  portals: Array<{
    x: number;
    y: number;
    targetMapId: string;
  }>;
  monsters: Array<{
    id: string;
    positionX: number;
    positionY: number;
  }>;
  sceneSnapshot: {
    tick: number;
  };
};

type CombatStartData = {
  combatId?: string;
  partyCombatId?: string;
  state: {
    player: {
      skills: string[];
    };
  };
  sceneSnapshot?: {
    tick: number;
  };
  turnState?: {
    currentTurnPlayerId?: string;
  };
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  expectedStatus?: number[];
};

type AiCraftResult = {
  success: boolean;
  resultItemId: string | null;
  resultItemName?: string | null;
  successRate?: number;
};

class CookieJar {
  private cookies = new Map<string, string>();

  apply(response: Response) {
    const setCookieValues = getSetCookieValues(response);
    for (const rawCookie of setCookieValues) {
      const firstPair = rawCookie.split(";")[0] || "";
      const equalIndex = firstPair.indexOf("=");
      if (equalIndex <= 0) {
        continue;
      }
      const key = firstPair.slice(0, equalIndex).trim();
      const value = firstPair.slice(equalIndex + 1).trim();
      if (!key) {
        continue;
      }
      if (!value) {
        this.cookies.delete(key);
        continue;
      }
      this.cookies.set(key, value);
    }
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

class ApiClient {
  readonly label: string;
  private readonly jar = new CookieJar();

  constructor(label: string) {
    this.label = label;
  }

  async request<T = unknown>(pathname: string, options: RequestOptions = {}) {
    const method = options.method || (options.body === undefined ? "GET" : "POST");
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const cookieHeader = this.jar.toHeader();
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
      cache: "no-store",
    });
    this.jar.apply(response);

    const expectedStatuses = options.expectedStatus || [200];
    const text = await response.text();
    let payload: ApiEnvelope<T> | null = null;

    if (text) {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    }

    if (!expectedStatuses.includes(response.status)) {
      throw new Error(
        `${this.label} ${method} ${pathname} HTTP ${response.status}: ${payload?.error || text || "未知错误"}`,
      );
    }

    return {
      status: response.status,
      json: payload as ApiEnvelope<T>,
    };
  }
}

function getSetCookieValues(response: Response) {
  const candidate = response.headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  if (typeof candidate.getSetCookie === "function") {
    return candidate.getSetCookie();
  }

  if (typeof candidate.raw === "function") {
    const rawHeaders = candidate.raw();
    if (Array.isArray(rawHeaders["set-cookie"])) {
      return rawHeaders["set-cookie"];
    }
  }

  const merged = response.headers.get("set-cookie");
  if (!merged) {
    return [];
  }

  return merged.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function writeReport(message: string) {
  ensureTmpDir();
  appendFileSync(REPORT_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function nowId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

async function waitForServerReady() {
  const probeClient = new ApiClient("probe");
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 120000) {
    try {
      const response = await probeClient.request("/api/auth/me", {
        method: "GET",
        expectedStatus: [200, 401, 409, 503],
      });
      if (response.status >= 200) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(1000);
  }

  throw new Error(`本地服务启动超时: ${lastError || "120 秒内未响应"}`);
}

async function ensureServerRunning() {
  let existingServerReady = false;

  try {
    await waitForServerReady();
    existingServerReady = true;
  } catch {
    existingServerReady = false;
  }

  if (existingServerReady) {
    if (!REUSE_EXISTING_SERVER) {
      throw new Error(
        `检测到 ${BASE_URL} 已有可响应服务。为避免误复用旧构件，烟测默认不复用现有服务；请先停止本地服务后重试，或显式设置 SMOKE_TEST_REUSE_SERVER=1。`,
      );
    }
    return {
      process: null as ChildProcess | null,
      reused: true,
    };
  }

  ensureTmpDir();
  const stdoutStream = createWriteStream(STDOUT_LOG_PATH, { flags: "a" });
  const stderrStream = createWriteStream(STDERR_LOG_PATH, { flags: "a" });
  const child = spawn("cmd.exe", ["/c", "bun run start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DB_AUTO_MIGRATE_ON_BOOT: process.env.DB_AUTO_MIGRATE_ON_BOOT || "0",
      FOUR_REALMS_APPLY_ON_BOOT: process.env.FOUR_REALMS_APPLY_ON_BOOT || "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  try {
    await waitForServerReady();
    return {
      process: child,
      reused: false,
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stopProcessTree(child: ChildProcess | null) {
  if (!child?.pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  child.kill("SIGTERM");
}

async function getSystemConfigValue(key: string) {
  const row = await db.select({
    key: systemConfigs.key,
    value: systemConfigs.value,
  }).from(systemConfigs).where(eq(systemConfigs.key, key)).get();

  return row?.value ?? null;
}

async function upsertSystemConfig(input: {
  key: string;
  value: string;
  group?: string;
  description?: string;
}) {
  const nowIso = new Date().toISOString();
  await db.insert(systemConfigs).values({
    key: input.key,
    value: input.value,
    group: input.group || "gameplay",
    description: input.description || null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: systemConfigs.key,
    set: {
      value: input.value,
      updatedAt: nowIso,
      group: input.group || "gameplay",
      description: input.description || null,
    },
  }).run();
}

async function setMaintenanceEnabled(enabled: boolean) {
  const previousEnabled = await getSystemConfigValue("GAME_MAINTENANCE_ENABLED");
  const previousMessage = await getSystemConfigValue("GAME_MAINTENANCE_MESSAGE");

  await upsertSystemConfig({
    key: "GAME_MAINTENANCE_ENABLED",
    value: enabled ? "true" : "false",
    group: "gameplay",
    description: "游戏维护开关",
  });

  if (!previousMessage) {
    await upsertSystemConfig({
      key: "GAME_MAINTENANCE_MESSAGE",
      value: "服务器维护中，请稍后再入世。维护期间将暂时无法进入游戏。",
      group: "gameplay",
      description: "游戏维护提示文案",
    });
  }

  return {
    previousEnabled,
    previousMessage,
  };
}

async function restoreMaintenanceState(snapshot: {
  previousEnabled: string | null;
  previousMessage: string | null;
}) {
  if (snapshot.previousEnabled !== null) {
    await upsertSystemConfig({
      key: "GAME_MAINTENANCE_ENABLED",
      value: snapshot.previousEnabled,
      group: "gameplay",
      description: "游戏维护开关",
    });
  }
  if (snapshot.previousMessage !== null) {
    await upsertSystemConfig({
      key: "GAME_MAINTENANCE_MESSAGE",
      value: snapshot.previousMessage,
      group: "gameplay",
      description: "游戏维护提示文案",
    });
  }
}

async function assertSuccess<T>(client: ApiClient, path: string, options: RequestOptions = {}) {
  const response = await client.request<T>(path, options);
  if (!response.json?.success) {
    throw new Error(`${client.label} ${path} 业务失败: ${response.json?.error || "未知错误"}`);
  }
  return response.json.data as T;
}

async function requestAllowingBusinessFailure<T>(
  client: ApiClient,
  path: string,
  options: RequestOptions = {},
) {
  const response = await client.request<T>(path, {
    ...options,
    expectedStatus: options.expectedStatus || [200, 400, 401, 403, 404, 409],
  });
  return response.json;
}

async function createAccount(index: number, suffix: string): Promise<CreatedAccount> {
  const client = new ApiClient(`账号${index}`);
  const email = `smoke-${suffix}-${index}@example.com`;
  const password = `Smoke!${suffix}${index}`;
  const gender = index % 2 === 0 ? "男" : "女";
  const playerName = `烟测${suffix.slice(-4)}${index}`;

  await assertSuccess(client, "/api/auth/register", {
    method: "POST",
    body: {
      email,
      password,
    },
  });

  const preview = await assertSuccess<{
    previewToken: string;
    starterFortuneOptions: Array<{ id: string }>;
    requiredSelectCount: number;
  }>(client, "/api/character/create/preview", {
    method: "POST",
    body: {
      gender,
      wish: `${gender}修士，求道问长生，愿稳扎稳打`,
    },
  });

  const selectedStarterFortuneIds = preview.starterFortuneOptions
    .slice(0, preview.requiredSelectCount)
    .map((item) => item.id);

  await assertSuccess(client, "/api/character/create", {
    method: "POST",
    body: {
      name: playerName,
      gender,
      previewToken: preview.previewToken,
      selectedStarterFortuneIds,
      avatarId: null,
    },
  });

  const me = await assertSuccess<AuthMeData>(client, "/api/auth/me");

  return {
    index,
    email,
    password,
    playerName,
    gender,
    playerId: me.id,
    client,
  };
}

async function ensurePlayerGold(playerId: string, gold: number) {
  await db.update(players).set({
    gold,
    updatedAt: new Date().toISOString(),
  }).where(eq(players.id, playerId)).run();
}

async function damagePlayerForMeditation(playerId: string) {
  const row = await db.select({
    id: players.id,
    maxHp: players.maxHp,
    maxMp: players.maxMp,
  }).from(players).where(eq(players.id, playerId)).get();
  if (!row) {
    throw new Error("玩家不存在，无法设置打坐测试状态");
  }

  await db.update(players).set({
    hp: Math.max(1, Math.floor(row.maxHp * 0.6)),
    mp: Math.max(0, Math.floor(row.maxMp * 0.4)),
    updatedAt: new Date().toISOString(),
  }).where(eq(players.id, playerId)).run();
}

async function grantItems(playerId: string, itemsToGrant: Array<{ itemId: string; quantity: number }>) {
  for (const entry of itemsToGrant) {
    const existing = await db.select({
      quantity: playerInventory.quantity,
    }).from(playerInventory).where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.itemId, entry.itemId),
    )).get();

    if (existing) {
      await db.update(playerInventory).set({
        quantity: existing.quantity + entry.quantity,
      }).where(and(
        eq(playerInventory.playerId, playerId),
        eq(playerInventory.itemId, entry.itemId),
      )).run();
    } else {
      await db.insert(playerInventory).values({
        playerId,
        itemId: entry.itemId,
        quantity: entry.quantity,
        equipped: false,
        equipSlot: null,
      }).run();
    }
  }
}

async function getInventoryMap(client: ApiClient) {
  const inventory = await assertSuccess<InventoryData>(client, "/api/game/inventory");
  return new Map(inventory.items.map((item) => [item.itemId, item]));
}

async function craftAiItemWithRetries(params: {
  client: ApiClient;
  playerId: string;
  endpoint: string;
  requestBody: {
    mainItemId: string;
    auxItemIds: string[];
  };
  maxAttempts?: number;
}) {
  const maxAttempts = Math.max(1, params.maxAttempts || 5);
  let lastFailureMessage = "未知原因";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await grantItems(params.playerId, MATERIAL_IDS.map((itemId) => ({
      itemId,
      quantity: 6,
    })));

    const before = await getInventoryMap(params.client);
    const json = await requestAllowingBusinessFailure<AiCraftResult>(params.client, params.endpoint, {
      method: "POST",
      body: params.requestBody,
      expectedStatus: [200],
    });

    if (!json.success) {
      throw new Error(json.error || "AI 炼制请求失败");
    }

    const result = json.data;
    if (!result) {
      throw new Error("AI 炼制缺少返回数据");
    }

    const after = await getInventoryMap(params.client);
    const craftedById = result.resultItemId ? after.get(result.resultItemId) || null : null;
    const craftedByDiff = await (async () => {
      for (const [itemId, item] of after.entries()) {
        const previous = before.get(itemId);
        if (!previous || item.quantity > previous.quantity) {
          return item;
        }
      }
      return null;
    })();

    if (result.success && (craftedById || craftedByDiff)) {
      const craftedItem = craftedById || craftedByDiff;
      if (!craftedItem) {
        throw new Error("AI 炼制成功但未找到新增物品");
      }
      return {
        craftedItem,
        attempts: attempt,
        result,
      };
    }

    const rateText = typeof result.successRate === "number"
      ? `${Math.round(result.successRate * 100)}%`
      : "未知";
    lastFailureMessage = result.success
      ? "返回成功但背包未检测到成品"
      : `第 ${attempt} 次未成，成功率 ${rateText}`;
  }

  throw new Error(`AI 炼制连续 ${maxAttempts} 次未获得成品：${lastFailureMessage}`);
}

function pickAdjacentWalkableTile(mapData: MapData) {
  const playerX = mapData.player.positionX;
  const playerY = mapData.player.positionY;
  const walkableSet = new Set(
    (mapData.map.tilesData || [])
      .filter((tile) => tile.walkable !== false)
      .map((tile) => `${tile.x},${tile.y}`),
  );

  const candidates = [
    [playerX + 1, playerY],
    [playerX - 1, playerY],
    [playerX, playerY + 1],
    [playerX, playerY - 1],
  ];

  for (const [x, y] of candidates) {
    if (x < 0 || y < 0 || x >= mapData.map.width || y >= mapData.map.height) {
      continue;
    }
    if ((mapData.map.tilesData || []).length === 0 || walkableSet.has(`${x},${y}`)) {
      return { x, y };
    }
  }

  return null;
}

async function setPlayerPosition(playerId: string, input: {
  mapId: string;
  x: number;
  y: number;
}) {
  await db.update(players).set({
    currentMapId: input.mapId,
    positionX: input.x,
    positionY: input.y,
    updatedAt: new Date().toISOString(),
  }).where(eq(players.id, playerId)).run();
}

async function moveNearMonster(client: ApiClient, playerId: string) {
  const mapData = await assertSuccess<MapData>(client, "/api/game/map");
  const monster = mapData.monsters[0];
  if (!monster) {
    return null;
  }

  const targetX = Math.max(0, monster.positionX - 1);
  const targetY = monster.positionY;
  await setPlayerPosition(playerId, {
    mapId: mapData.map.id,
    x: targetX,
    y: targetY,
  });

  return monster.id;
}

async function getFirstSpiritualSeed() {
  const rows = await db.execute<{
    seed_item_id: string;
  }>(sql`
    SELECT "seed_item_id"
    FROM "plugin_spiritual_field_seeds"
    WHERE "enabled" = true
    ORDER BY "id" ASC
    LIMIT 1
  `);

  return rows[0]?.seed_item_id || null;
}

async function forceSpiritualFieldMature(playerId: string, slotIndex: number) {
  const matureAt = new Date(Date.now() - 5000).toISOString();
  await db.execute(sql`
    UPDATE "plugin_spiritual_field_plots"
    SET "mature_at" = ${matureAt}, "status" = 'growing'
    WHERE "player_id" = ${playerId} AND "slot_index" = ${slotIndex}
  `);
}

const legacyPluginSmokeHelpers = [
  craftAiItemWithRetries,
  getFirstSpiritualSeed,
  forceSpiritualFieldMature,
];
void legacyPluginSmokeHelpers;

async function findConversationIdFor(client: ApiClient, targetPlayerId: string) {
  const data = await assertSuccess<{
    conversations: Array<{ id: string; targetPlayerId: string }>;
  }>(client, "/api/game/social/dm/conversations");
  return data.conversations.find((item) => item.targetPlayerId === targetPlayerId)?.id || null;
}

async function getPartyInviteId(client: ApiClient) {
  const data = await assertSuccess<{
    incomingInvites: Array<{ id: string }>;
  }>(client, "/api/game/social/party");
  return data.incomingInvites[0]?.id || null;
}

async function getMapData(client: ApiClient) {
  return assertSuccess<MapData>(client, "/api/game/map");
}

async function closeDbClient() {
  const client = (db as unknown as {
    $client?: {
      end?: (options?: { timeout?: number }) => Promise<unknown> | unknown;
    };
  }).$client;

  if (client && typeof client.end === "function") {
    await client.end({ timeout: 1 });
  }
}

async function run() {
  ensureTmpDir();

  const failures: SmokeFailure[] = [];
  const notes: SmokeNote[] = [];
  const suffix = nowId();
  const maintenanceSnapshot = await setMaintenanceEnabled(false);
  const server = await ensureServerRunning();

  const trackFailure = (step: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ step, error: message });
    writeReport(`[FAIL] ${step}: ${message}`);
    console.error(`[FAIL] ${step}: ${message}`);
  };

  const trackNote = (step: string, message: string) => {
    notes.push({ step, message });
    writeReport(`[NOTE] ${step}: ${message}`);
    console.log(`[NOTE] ${step}: ${message}`);
  };

  const runStep = async (step: string, job: () => Promise<void>) => {
    writeReport(`[STEP] ${step}`);
    console.log(`[STEP] ${step}`);
    try {
      await job();
      writeReport(`[PASS] ${step}`);
      console.log(`[PASS] ${step}`);
    } catch (error) {
      trackFailure(step, error);
    }
  };

  try {
    const accounts: CreatedAccount[] = [];

    await runStep("创建 6 个测试账号并创角", async () => {
      for (let index = 1; index <= TEST_ACCOUNT_COUNT; index += 1) {
        const account = await createAccount(index, suffix);
        accounts.push(account);
      }
    });

    const [accountA, accountB, accountC, accountD, accountE, accountF] = accounts;
    void accountC;
    void accountF;
    if (accounts.length < TEST_ACCOUNT_COUNT) {
      throw new Error("测试账号创建未完成，无法继续执行烟测");
    }

    for (const account of accounts) {
      await runStep(`${account.client.label} 基础接口`, async () => {
        await assertSuccess(account.client, "/api/auth/me");
        await assertSuccess(account.client, "/api/game/inventory");
        await assertSuccess(account.client, "/api/game/skills");
        await assertSuccess(account.client, "/api/game/fortune");
        await assertSuccess(account.client, "/api/game/rankings");
        await assertSuccess(account.client, "/api/game/quest/list");
        await assertSuccess(account.client, "/api/game/dongfu");
        await assertSuccess(account.client, "/api/game/map");
        await assertSuccess(account.client, "/api/game/social/settings");
      });
    }

    await runStep("账号1 洞府领取", async () => {
      await assertSuccess(accountA.client, "/api/game/dongfu/claim", {
        method: "POST",
        body: {},
      });
    });

    await runStep("账号1 打坐开始与收功", async () => {
      await damagePlayerForMeditation(accountA.playerId);
      await assertSuccess(accountA.client, "/api/game/meditation", {
        method: "POST",
        body: { action: "start" },
      });
      await delay(1200);
      await assertSuccess(accountA.client, "/api/game/meditation", {
        method: "POST",
        body: { action: "claim" },
      });
    });

    await runStep("插件总览接口已退役", async () => {
      trackNote("插件总览接口已退役", "插件 API 已归档，烟测不再访问 /api/game/plugins/*。功法、论道、炼丹、炼器、灵田需等待固定核心模块接管后恢复端到端验证。");
    });

    const craftedWeaponItemId: string | null = null;
    const craftedPillItemId: string | null = null;

    await runStep("账号1 AI 炼器成功链路", async () => {
      trackNote("账号1 AI 炼器成功链路", "旧插件炼器接口已退役，等待核心炼器模块接入后恢复。");
    });

    await runStep("账号1 AI 炼丹成功链路", async () => {
      trackNote("账号1 AI 炼丹成功链路", "旧插件炼丹接口已退役，等待核心炼丹模块接入后恢复。");
    });

    await runStep("账号1 装备与卸下炼器产物", async () => {
      if (!craftedWeaponItemId) {
        trackNote("账号1 装备与卸下炼器产物", "缺少核心炼器产物，已跳过装备验证。");
        return;
      }
      await assertSuccess(accountA.client, "/api/game/inventory", {
        method: "POST",
        body: {
          action: "equip",
          itemId: craftedWeaponItemId,
        },
      });
      await assertSuccess(accountA.client, "/api/game/inventory", {
        method: "POST",
        body: {
          action: "unequip",
          itemId: craftedWeaponItemId,
        },
      });
    });

    await runStep("账号1 使用炼丹产物", async () => {
      if (!craftedPillItemId) {
        trackNote("账号1 使用炼丹产物", "缺少核心炼丹产物，已跳过丹药使用验证。");
        return;
      }
      const result = await requestAllowingBusinessFailure(accountA.client, "/api/game/inventory", {
        method: "POST",
        body: {
          action: "use",
          itemId: craftedPillItemId,
        },
        expectedStatus: [200, 400],
      });
      if (!result.success) {
        throw new Error(result.error || "炼丹产物使用失败");
      }
    });

    await runStep("好友申请、接受与私聊", async () => {
      const friendRequest = await requestAllowingBusinessFailure<{
        friendship: { id: number };
      }>(accountA.client, "/api/game/social/friends/request", {
        method: "POST",
        body: {
          targetPlayerId: accountB.playerId,
        },
        expectedStatus: [200],
      });
      if (!friendRequest.success || !friendRequest.data?.friendship?.id) {
        throw new Error(friendRequest.error || "好友申请失败");
      }

      await assertSuccess(accountB.client, "/api/game/social/friends");

      await assertSuccess(accountB.client, "/api/game/social/friends/respond", {
        method: "POST",
        body: {
          friendshipId: friendRequest.data.friendship.id,
          action: "accept",
        },
      });

      await assertSuccess(accountA.client, "/api/game/social/friends");

      await assertSuccess(accountA.client, "/api/game/social/dm/send", {
        method: "POST",
        body: {
          targetPlayerId: accountB.playerId,
          content: `烟测消息 ${suffix}`,
        },
      });

      const conversationId = await findConversationIdFor(accountA.client, accountB.playerId);
      if (!conversationId) {
        throw new Error("未找到私聊会话");
      }

      await assertSuccess(accountA.client, `/api/game/social/dm/messages?conversationId=${encodeURIComponent(conversationId)}`);
      await assertSuccess(accountB.client, `/api/game/social/dm/messages?conversationId=${encodeURIComponent(conversationId)}`);
    });

    await runStep("组队邀请与接受", async () => {
      const mapA = await getMapData(accountA.client);
      await setPlayerPosition(accountA.playerId, {
        mapId: mapA.map.id,
        x: mapA.player.positionX,
        y: mapA.player.positionY,
      });
      await setPlayerPosition(accountB.playerId, {
        mapId: mapA.map.id,
        x: Math.min(mapA.map.width - 1, mapA.player.positionX + 1),
        y: mapA.player.positionY,
      });

      await assertSuccess(accountA.client, "/api/game/social/party/invite", {
        method: "POST",
        body: {
          targetPlayerId: accountB.playerId,
        },
      });

      const inviteId = await getPartyInviteId(accountB.client);
      if (!inviteId) {
        throw new Error("未找到组队邀请");
      }

      await assertSuccess(accountB.client, "/api/game/social/party/respond", {
        method: "POST",
        body: {
          inviteId,
          accept: true,
        },
      });

      await assertSuccess(accountA.client, "/api/game/social/party");
      await assertSuccess(accountB.client, "/api/game/social/party");
    });

    await runStep("市场上架与购买", async () => {
      if (!craftedWeaponItemId) {
        trackNote("市场交易炼器产物", "缺少核心炼器产物，已跳过市场交易验证。");
        return;
      }

      await ensurePlayerGold(accountA.playerId, 1200);
      await ensurePlayerGold(accountB.playerId, 1200);

      const myInventory = await getInventoryMap(accountA.client);
      const current = myInventory.get(craftedWeaponItemId);
      if (!current) {
        throw new Error("账号1 背包中缺少待上架物品");
      }
      if (current.equipped) {
        await assertSuccess(accountA.client, "/api/game/inventory", {
          method: "POST",
          body: {
            action: "unequip",
            itemId: craftedWeaponItemId,
          },
        });
      }

      const listing = await assertSuccess<{ listingId: number }>(accountA.client, "/api/game/market/listings", {
        method: "POST",
        body: {
          itemId: craftedWeaponItemId,
          quantity: 1,
          unitPrice: 88,
        },
      });

      await assertSuccess(accountB.client, "/api/game/market/listings");
      await assertSuccess(accountB.client, `/api/game/market/listings/${listing.listingId}/buy`, {
        method: "POST",
        body: {
          quantity: 1,
        },
      });

      const buyerInventory = await getInventoryMap(accountB.client);
      if (!buyerInventory.has(craftedWeaponItemId)) {
        throw new Error("购买后账号2 背包未收到物品");
      }
    });

    await runStep("灵田种植与收获", async () => {
      trackNote("灵田种植与收获", "旧插件灵田接口已退役，等待核心灵田模块接入后恢复。");
    });

    await runStep("地图移动与传送", async () => {
      const mapData = await getMapData(accountD.client);
      const nextTile = pickAdjacentWalkableTile(mapData);
      if (!nextTile) {
        throw new Error("当前地图附近没有可用于烟测的相邻可走格");
      }

      await assertSuccess(accountD.client, "/api/game/map/move", {
        method: "POST",
        body: {
          x: nextTile.x,
          y: nextTile.y,
          ...createSmokeActionMeta({
            clientSequence: 1,
            clientSceneTick: mapData.sceneSnapshot.tick,
          }),
        },
      });

      const refreshedMap = await getMapData(accountD.client);
      const availableLinkedMapIds = new Set(
        refreshedMap.linkedMaps
          .filter((linkedMap) => linkedMap.available !== false)
          .map((linkedMap) => linkedMap.id),
      );
      const availablePortal = refreshedMap.portals.find((portal) => (
        Boolean(portal.targetMapId) && availableLinkedMapIds.has(portal.targetMapId)
      )) || null;
      const availableLinkedMap = refreshedMap.linkedMaps.find((linkedMap) => linkedMap.available !== false) || null;

      if (availablePortal) {
        await setPlayerPosition(accountD.playerId, {
          mapId: refreshedMap.map.id,
          x: availablePortal.x,
          y: availablePortal.y,
        });
        await assertSuccess(accountD.client, "/api/game/map/travel", {
          method: "POST",
          body: {
            mapId: availablePortal.targetMapId,
            ...createSmokeActionMeta({
              clientSequence: 2,
              clientSceneTick: refreshedMap.sceneSnapshot.tick,
            }),
          },
        });
      } else if (refreshedMap.portals.length === 0 && availableLinkedMap) {
        await assertSuccess(accountD.client, "/api/game/map/travel", {
          method: "POST",
          body: {
            mapId: availableLinkedMap.id,
            ...createSmokeActionMeta({
              clientSequence: 2,
              clientSceneTick: refreshedMap.sceneSnapshot.tick,
            }),
          },
        });
      } else if (availableLinkedMap) {
        trackNote("地图移动与传送", "当前地图传送阵存在，但可到达目标需要指定阵点或额外条件，已完成移动烟测后跳过切图");
      } else {
        trackNote("地图移动与传送", "当前地图所有传送目标均受境界或条件限制，已完成移动烟测后跳过切图");
      }
    });

    await runStep("普通战斗开始、场景读取与出手", async () => {
      const monsterId = await moveNearMonster(accountE.client, accountE.playerId);
      if (!monsterId) {
        trackNote("普通战斗开始、场景读取与出手", "当前地图没有可见怪物，已跳过战斗烟测");
        return;
      }

      const start = await assertSuccess<CombatStartData>(accountE.client, "/api/game/combat/start", {
        method: "POST",
        body: {
          monsterId,
        },
      });

      if (!start.combatId) {
        throw new Error("战斗启动后未返回 combatId");
      }

      const scene = await assertSuccess<{
        snapshot: { tick: number };
      }>(accountE.client, `/api/game/combat/scene?combatId=${encodeURIComponent(start.combatId)}`);

      const skillId = start.state.player.skills[0];
      if (!skillId) {
        throw new Error("玩家没有可用技能，无法执行战斗动作");
      }

      await assertSuccess(accountE.client, "/api/game/combat/action", {
        method: "POST",
        body: {
          combatId: start.combatId,
          action: "skill",
          skillId,
          actionId: `smoke-${suffix}-combat`,
          clientSentAt: Date.now(),
          clientSequence: 1,
          clientSceneTick: scene.snapshot.tick,
        },
      });
    });

    await runStep("组队战斗分支", async () => {
      const mapData = await getMapData(accountA.client);
      const monster = mapData.monsters[0];
      if (!monster) {
        trackNote("组队战斗分支", "当前地图没有可见怪物，已跳过组队战斗烟测");
        return;
      }

      const nearX = Math.max(0, monster.positionX - 1);
      const nearY = monster.positionY;
      await setPlayerPosition(accountA.playerId, {
        mapId: mapData.map.id,
        x: nearX,
        y: nearY,
      });
      await setPlayerPosition(accountB.playerId, {
        mapId: mapData.map.id,
        x: nearX,
        y: nearY,
      });

      const start = await assertSuccess<CombatStartData>(accountA.client, "/api/game/combat/start", {
        method: "POST",
        body: {
          monsterId: monster.id,
        },
      });

      if (!start.partyCombatId) {
        trackNote("组队战斗分支", "当前条件下未触发组队战斗，普通战斗分支已单独通过");
        return;
      }

      const sceneA = await assertSuccess<{
        snapshot: { tick: number };
        turnState?: { currentTurnPlayerId?: string };
        state: { player: { skills: string[] } };
      }>(accountA.client, `/api/game/combat/scene?partyCombatId=${encodeURIComponent(start.partyCombatId)}`);

      const actor = sceneA.turnState?.currentTurnPlayerId === accountB.playerId ? accountB : accountA;
      const actorScene = actor.playerId === accountA.playerId
        ? sceneA
        : await assertSuccess<{
          snapshot: { tick: number };
          turnState?: { currentTurnPlayerId?: string };
          state: { player: { skills: string[] } };
        }>(actor.client, `/api/game/combat/scene?partyCombatId=${encodeURIComponent(start.partyCombatId)}`);

      const actorSkillId = actorScene.state.player.skills[0];
      if (!actorSkillId) {
        throw new Error("组队战斗玩家缺少技能");
      }

      await assertSuccess(actor.client, "/api/game/combat/action", {
        method: "POST",
        body: {
          partyCombatId: start.partyCombatId,
          monsterId: monster.id,
          action: "skill",
          skillId: actorSkillId,
          actionId: `smoke-${suffix}-party-combat-${actor.index}`,
          clientSentAt: Date.now(),
          clientSequence: 1,
          clientSceneTick: actorScene.snapshot.tick,
        },
      });
    });

    await runStep("账号6 插件页扩展接口已退役", async () => {
      trackNote("账号6 插件页扩展接口已退役", "活动页、角色页、洞府页、通知插件扩展接口已归档，H5 客户端不再请求。");
    });

    const activeListings = await db.select({
      id: marketListings.id,
    }).from(marketListings).where(eq(marketListings.status, "active")).all();
    if (activeListings.length > 0) {
      trackNote("市场尾态", `仍存在 ${activeListings.length} 条 active 挂单，请按需要自行清理测试数据`);
    }

    console.log("\n===== 烟测结果 =====");
    console.log(`基础地址: ${BASE_URL}`);
    console.log(`服务模式: ${server.reused ? "复用现有本地服务" : "脚本拉起本地生产服务"}`);
    console.log(`测试账号数: ${accounts.length}`);
    console.log(`失败数: ${failures.length}`);

    if (notes.length > 0) {
      console.log("\n--- 备注 ---");
      for (const note of notes) {
        console.log(`- ${note.step}: ${note.message}`);
      }
    }

    if (failures.length > 0) {
      console.log("\n--- 失败项 ---");
      for (const failure of failures) {
        console.log(`- ${failure.step}: ${failure.error}`);
      }
      return 1;
    }

    console.log("\n全部核心烟测通过。");
    writeReport("全部核心烟测通过。");
    return 0;
  } finally {
    try {
      await restoreMaintenanceState(maintenanceSnapshot);
    } catch (error) {
      console.error("恢复维护开关失败:", error);
    }

    if (server.process) {
      await stopProcessTree(server.process);
      await delay(1000);
    }

    try {
      await closeDbClient();
    } catch (error) {
      console.error("关闭脚本数据库连接失败:", error);
    }
  }
}

const exitCode = await run();
process.exit(exitCode);
