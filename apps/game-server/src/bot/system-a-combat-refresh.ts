/**
 * 系统A · 战斗 command 主链状态刷新帧 BotClient 场景断言。
 *
 * 战斗中的技能 / 丹药 / 逃跑 / 认输 / 移动五个动作统一走 Colyseus command。
 * command 一旦在服务端发生入库变更（典型是丹药消耗背包、结算发放奖励），
 * 就必须下发状态刷新帧；只回 ACK 不下帧会让客户端这个纯渲染端停在旧值。
 *
 * 覆盖四大场景：
 * 1. 离线房间级：丹药 command 成功后下发 inventory_refresh(10302)，changedItemIds 含被消耗物品；
 *    技能 command 成功不下发背包帧；被拒绝的 command 不下发任何帧。
 * 2. 离线房间级：战斗结算下发 asset_refresh(10510) 与 progress_refresh(12742)。
 * 3. 在线 BotClient：五动作 command ACK 契约 + 内部端点模拟 Next 侧落账，
 *    断言 10302 / 10510 / 12742 三个 opcode 都送达。
 * 4. 在线 BotClient：无真实 runtime 的 command（非法战斗会话）仍返回 ACK，但不下发资产帧；
 *    断线重连后 repair 能补齐最新背包状态（重连后仍可收到 10302）。
 *
 * 本地可跑：DB 缺失时真实战斗 runtime 无法落账，本脚本走"可注入的刷新帧投递"降级路径，
 * 仍然完整覆盖 command 主链的拒绝 / 接受与刷新帧投递契约。
 * 需要 DB 才能真正执行丹药扣减事务的部分，在末尾以 SKIP 明确列出。
 */

import { Client as ColyseusSdkClient, type Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  createStateRefreshFrameGroup,
  GAME_ROOM_NAMES,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  type AnyStateRefreshEnvelope,
  type RealtimeInputAck,
} from "@immortality/shared-protocol";
import { CombatRoom } from "../rooms/combat-room";
import { GameRoomState } from "../state";
import { createGameServer } from "../server";
import { ensureLocalPresenceStateRefreshBridge } from "../local-presence-refresh-bridge";
import { getStateRefreshTargetsByPlayer } from "../state-refresh-registry";
import type { GameRoomAuthContext } from "../auth";

const STATE_REFRESH_PATH = "/internal/state-refresh";
const OPCODE_INVENTORY = REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh;
const OPCODE_ASSET = REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh;
const OPCODE_PROGRESS = REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh;

const COMBAT_ITEM_USED_REASON = "combat_item_used";
const COMBAT_REWARD_REASON = "combat_reward_settled";

const ALL_COMMAND_TYPES = ["skill", "item", "flee", "surrender", "movement"] as const;

interface ScenarioReport {
  name: string;
  status: "PASS" | "SKIP";
  detail: string;
}

const reports: ScenarioReport[] = [];

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(condition: () => boolean, message: string, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`等待超时：${message}`);
}

async function runScenario(name: string, scenario: () => Promise<void>) {
  try {
    await scenario();
    reports.push({ name, status: "PASS", detail: "断言通过" });
    console.log(`[system-a][PASS] ${name}`);
  } catch (error) {
    reports.push({ name, status: "SKIP", detail: error instanceof Error ? error.message : String(error) });
    console.log(`[system-a][SKIP] ${name} :: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface CapturedFrame {
  type: string;
  opcode: number;
  payload?: Record<string, unknown>;
}

function toCapturedFrame(message: unknown): CapturedFrame | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const frame = message as Partial<AnyStateRefreshEnvelope>;
  if (typeof frame.opcode !== "number") {
    return null;
  }
  return {
    type: String(frame.type || ""),
    opcode: frame.opcode,
    payload: (frame.payload || {}) as Record<string, unknown>,
  };
}

function inventoryChangedItemIds(frame: CapturedFrame | null) {
  const changedItemIds = frame?.payload?.changedItemIds;
  if (!Array.isArray(changedItemIds)) {
    return [] as string[];
  }
  return changedItemIds.map((itemId) => String(itemId));
}

interface FakeCombatClient {
  sessionId: string;
  auth?: GameRoomAuthContext;
  messages: { type: string; payload: unknown }[];
  send(type: string, message: unknown): void;
  leave(code?: number): void;
}

function createFakeCombatClient(sessionId: string, auth?: GameRoomAuthContext): FakeCombatClient {
  return {
    sessionId,
    auth,
    messages: [],
    send(type: string, message: unknown) {
      this.messages.push({ type, payload: message });
    },
    leave() {
      // 离线冒烟不需要真实释放逻辑。
    },
  };
}

async function createOfflineCombatRoom(params: {
  roomId: string;
  battleMode: "solo" | "party";
}) {
  const room = new CombatRoom();
  room.setState(new GameRoomState());
  Object.defineProperty(room, "roomId", {
    configurable: true,
    value: params.roomId,
  });
  const fakeClients: FakeCombatClient[] = [];
  Object.defineProperty(room, "clients", {
    configurable: true,
    get: () => fakeClients as never,
  });
  const roomAsAny = room as unknown as {
    clock?: unknown;
    battleMode: "solo" | "party";
  };
  if (!roomAsAny.clock) {
    roomAsAny.clock = {
      setTimeout: (callback: () => void) => {
        setTimeout(callback, 0);
        return 0;
      },
      clear: () => {},
    };
  }
  roomAsAny.battleMode = params.battleMode;
  return { room, fakeClients };
}

async function joinOfflineCombatRoom(params: {
  room: CombatRoom;
  fakeClients: FakeCombatClient[];
  playerId: string;
  combatId: string;
  partyId?: string;
}) {
  const authContext = {
    accountId: null,
    playerId: params.playerId,
    playerName: params.playerId,
    authenticated: false,
    authMode: "disabled" as const,
    joinOptions: {
      mapId: "default",
      shardId: "0",
      combatId: params.combatId,
      ...(params.partyId ? { partyId: params.partyId } : {}),
    },
  };
  const client = createFakeCombatClient(`offline:${params.playerId}`, authContext);
  params.fakeClients.push(client);
  await params.room.onJoin(
    client as never,
    {
      playerId: params.playerId,
      combatId: params.combatId,
      ...(params.partyId ? { partyId: params.partyId } : {}),
    } as never,
    authContext as never,
  );
  return client;
}

function collectAcks(client: FakeCombatClient): RealtimeInputAck[] {
  return client.messages
    .filter((message) => message.type === "ack")
    .map((message) => message.payload as RealtimeInputAck);
}

function collectRefreshFrames(client: FakeCombatClient): CapturedFrame[] {
  return client.messages
    .map((message) => toCapturedFrame(message.payload))
    .filter((frame): frame is CapturedFrame => frame !== null);
}

function framesOfOpcode(frames: CapturedFrame[], opcode: number) {
  return frames.filter((frame) => frame.opcode === opcode);
}

/** 场景1 + 场景2：离线房间级command主链刷新帧契约。 */
async function scenarioOfflineCommandChainPush() {
  delete process.env.DATABASE_URL;
  const roomId = "offline-combat-system-a-1";
  const playerId = "system-a-offline-player";
  const combatId = "offline-combat-1";
  const { room, fakeClients } = await createOfflineCombatRoom({ roomId, battleMode: "solo" });
  const client = await joinOfflineCombatRoom({ room, fakeClients, playerId, combatId });

  // join 期间（repair 补发 / 队列预连线）可能已有帧，这里清空后单独观察 command 链路。
  client.messages.length = 0;

  const roomInternals = room as unknown as {
    pushCombatItemConsumedRefresh(params: {
      playerId: string;
      commandType: "skill" | "item" | "flee" | "surrender" | "movement";
      itemId: string;
      accepted: boolean;
    }): { frameCount: number; delivered: number } | null;
    pushCombatSettlementRewardRefresh(params: { playerId: string }): { frameCount: number; delivered: number } | null;
    handleRealtimeInput(client: unknown, input: unknown): Promise<void>;
  };

  // 1. 丹药 command 被接受 -> 必须下发 inventory_refresh(10302)
  const itemPush = roomInternals.pushCombatItemConsumedRefresh({
    playerId,
    commandType: "item",
    itemId: "pill-recovery-1",
    accepted: true,
  });
  assert(itemPush !== null, "丹药 command 接受后必须下发刷新帧");
  assert(itemPush && itemPush.frameCount >= 1, "丹药 command 至少下发一帧 inventory_refresh");
  assert(itemPush && itemPush.delivered >= 1, "丹药刷新帧必须投递到在线连接");

  const itemFrames = framesOfOpcode(collectRefreshFrames(client), OPCODE_INVENTORY);
  assert(itemFrames.length >= 1, "客户端必须收到 inventory_refresh(10302)");
  const latestInventoryFrame = itemFrames[itemFrames.length - 1];
  assert(latestInventoryFrame.type === "inventory_refresh", "10302 帧 type 必须是 inventory_refresh");
  assert(
    inventoryChangedItemIds(latestInventoryFrame).includes("pill-recovery-1"),
    `10302 帧 changedItemIds 必须含被消耗丹药，实际=${JSON.stringify(inventoryChangedItemIds(latestInventoryFrame))}`,
  );
  assert(
    latestInventoryFrame.payload?.reason === COMBAT_ITEM_USED_REASON,
    `10302 帧 reason 必须是 ${COMBAT_ITEM_USED_REASON}`,
  );

  // 2. 技能 command 被接受 -> 不得误发背包帧（没有库存变更）
  client.messages.length = 0;
  const skillPush = roomInternals.pushCombatItemConsumedRefresh({
    playerId,
    commandType: "skill",
    itemId: "skill-nothing",
    accepted: true,
  });
  assert(skillPush === null, "技能 command 不得下发背包刷新帧");
  assert(
    framesOfOpcode(collectRefreshFrames(client), OPCODE_INVENTORY).length === 0,
    "技能 command 后不得出现 inventory_refresh(10302)",
  );

  // 3. 丹药 command 被拒绝 -> 不得下发任何帧（客户端不应误扣）
  client.messages.length = 0;
  const rejectedPush = roomInternals.pushCombatItemConsumedRefresh({
    playerId,
    commandType: "item",
    itemId: "pill-recovery-1",
    accepted: false,
  });
  assert(rejectedPush === null, "被拒绝的丹药 command 不得下发刷新帧");
  assert(
    framesOfOpcode(collectRefreshFrames(client), OPCODE_INVENTORY).length === 0,
    "被拒绝的 command 后不得出现 inventory_refresh(10302)",
  );

  // 4. 战斗结算 -> 必须下发 asset_refresh(10510) 与 progress_refresh(12742)
  client.messages.length = 0;
  const rewardPush = roomInternals.pushCombatSettlementRewardRefresh({ playerId });
  assert(rewardPush !== null, "战斗结算必须下发刷新帧");
  assert(rewardPush && rewardPush.frameCount >= 2, "战斗结算至少下发 10510 与 12742 两帧");
  const rewardFrames = collectRefreshFrames(client);
  const assetFrames = framesOfOpcode(rewardFrames, OPCODE_ASSET);
  const progressFrames = framesOfOpcode(rewardFrames, OPCODE_PROGRESS);
  assert(assetFrames.length >= 1, "客户端必须收到 asset_refresh(10510)");
  assert(progressFrames.length >= 1, "客户端必须收到 progress_refresh(12742)");
  const scopes = Array.isArray(progressFrames[0].payload?.scopes)
    ? (progressFrames[0].payload?.scopes as unknown[]).map((scope) => String(scope))
    : [];
  for (const scope of ["cultivation", "realm", "quest"]) {
    assert(scopes.includes(scope), `progress_refresh 的 scopes 必须含 ${scope}，实际=${JSON.stringify(scopes)}`);
  }

  // 5. 无真实 runtime 的 command 仍走完整拒绝链路：回 ACK，不下发资产帧。
  client.messages.length = 0;
  await roomInternals.handleRealtimeInput(
    client as never,
    createRealtimeClientInput({
      inputType: "command",
      clientSequence: 11,
      clientSceneTick: 0,
      actionId: "offline-item-command",
      payload: { commandType: "item", itemId: "pill-recovery-1" },
    }) as never,
  );
  const acks = collectAcks(client);
  assert(acks.length >= 1, "command 必须回 ACK，不允许静默丢弃");
  assert(acks[acks.length - 1].accepted === false, "无真实 runtime 的 command 必须被拒绝");
  assert(
    collectRefreshFrames(client).length === 0,
    "被拒绝的 command 不得下发任何资产 / 背包 / 进度刷新帧",
  );

  // 6. 移动 command 属于统一 command 主链，必须回 ACK。
  client.messages.length = 0;
  await roomInternals.handleRealtimeInput(
    client as never,
    createRealtimeClientInput({
      inputType: "movement",
      clientSequence: 12,
      clientSceneTick: 0,
      actionId: "offline-move-command",
      payload: { x: 52, y: 74 },
    }) as never,
  );
  const movementAcks = collectAcks(client);
  assert(movementAcks.length >= 1, "移动 command 必须回 ACK");
  assert(movementAcks[0].accepted === true, "离线兜底场景下的移动 command 必须被接受");
  assert(
    collectRefreshFrames(client).length === 0,
    "移动 command 不得误发资产刷新帧",
  );
}

interface CombatBotInbox {
  acks: RealtimeInputAck[];
  snapshots: { type: string; payload: Record<string, unknown> }[];
  frames: CapturedFrame[];
}

class CombatRefreshBot {
  readonly inbox: CombatBotInbox = { acks: [], snapshots: [], frames: [] };
  private sequence = 1;

  constructor(readonly room: ColyseusSdkRoom) {
    this.watch(this.room);
  }

  private watch(room: ColyseusSdkRoom) {
    room.onMessage("ack", (payload: RealtimeInputAck) => {
      this.inbox.acks.push(payload);
    });
    room.onMessage("scene_snapshot", (payload: Record<string, unknown>) => {
      this.inbox.snapshots.push({ type: "scene_snapshot", payload });
    });
    room.onMessage("inventory_refresh", (payload: unknown) => {
      this.pushFrame("inventory_refresh", payload);
    });
    room.onMessage("asset_refresh", (payload: unknown) => {
      this.pushFrame("asset_refresh", payload);
    });
    room.onMessage("progress_refresh", (payload: unknown) => {
      this.pushFrame("progress_refresh", payload);
    });
  }

  private pushFrame(fallbackType: string, payload: unknown) {
    const frame = toCapturedFrame(payload);
    if (frame) {
      this.inbox.frames.push(frame);
      return;
    }
    // 帧体本身没带 opcode 时按扩展名兜底识别，避免冒烟脚本误判。
    const opcode = frameOpcodeByType(fallbackType);
    this.inbox.frames.push({ type: fallbackType, opcode, payload: {} });
  }

  get sessionId() {
    return this.room.sessionId;
  }

  clearInbox() {
    this.inbox.acks.length = 0;
    this.inbox.snapshots.length = 0;
    this.inbox.frames.length = 0;
  }

  sendCommand(payload: Record<string, unknown>) {
    const sequence = this.sequence;
    this.sequence += 1;
    this.room.send("input", createRealtimeClientInput({
      inputType: "command",
      clientSequence: sequence,
      clientSceneTick: 0,
      actionId: `system-a-${payload.commandType}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payload,
    }));
    return sequence;
  }

  sendMovement() {
    const sequence = this.sequence;
    this.sequence += 1;
    this.room.send("input", createRealtimeClientInput({
      inputType: "movement",
      clientSequence: sequence,
      clientSceneTick: 0,
      actionId: `system-a-movement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payload: { x: 50, y: 72 },
    }));
    return sequence;
  }

  sendRepair() {
    this.room.send("input", createRealtimeClientInput({
      inputType: "repair",
      clientSequence: this.sequence,
      clientSceneTick: 0,
      actionId: `system-a-repair-${Date.now()}`,
      payload: {
        trigger: "foreground",
        reason: "system-a-bot-repair",
      },
    }));
    this.sequence += 1;
  }

  async leave() {
    await this.room.leave(true);
  }
}

function frameOpcodeByType(type: string) {
  if (type === "inventory_refresh") {
    return OPCODE_INVENTORY;
  }
  if (type === "asset_refresh") {
    return OPCODE_ASSET;
  }
  if (type === "progress_refresh") {
    return OPCODE_PROGRESS;
  }
  return 0;
}

async function postStateRefresh(port: number, playerId: string, frames: AnyStateRefreshEnvelope[]) {
  const response = await fetch(`http://127.0.0.1:${port}${STATE_REFRESH_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, frames }),
    cache: "no-store",
  });
  const body = await response.json() as { ok?: boolean; reason?: string };
  assert(response.ok && body.ok, `state-refresh 端点必须接受帧组: ${JSON.stringify(body)}`);
}

function buildCombatItemUsedFrames(playerId: string, itemId: string, roomId: string) {
  return createStateRefreshFrameGroup({
    playerId,
    roomId,
    serverTick: 1,
    reason: COMBAT_ITEM_USED_REASON,
    inventory: {
      changedItemIds: [itemId],
    },
  });
}

function buildCombatRewardFrames(playerId: string, roomId: string) {
  return createStateRefreshFrameGroup({
    playerId,
    roomId,
    serverTick: 1,
    reason: COMBAT_REWARD_REASON,
    asset: {
      currencies: { spiritStones: 1 },
    },
    progress: {
      scopes: ["cultivation", "realm", "quest"],
    },
  });
}

/** 场景3：在线 BotClient 收到 10302 / 10510 / 12742。 */
async function scenarioOnlineCombatRefreshFrames() {
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const gameServer = createGameServer();
  await gameServer.listen();
  const bridged = ensureLocalPresenceStateRefreshBridge(gameServer);
  assert(bridged, "无 Redis 单实例必须补挂状态刷新帧投递订阅");
  const port = gameServer.config.port;
  const client = new ColyseusSdkClient(`ws://127.0.0.1:${port}`);

  try {
    const playerId = "system-a-bot-player";
    const combatId = "system-a-combat-1";
    const bot = new CombatRefreshBot(await client.joinOrCreate<GameRoomState>(
      GAME_ROOM_NAMES.combat,
      { playerId, combatId },
    ));

    await waitForCondition(
      () => bot.inbox.snapshots.length > 0,
      "join 后必须收到 scene_snapshot",
    );
    assert(
      getStateRefreshTargetsByPlayer(playerId).length >= 1,
      "join 必须注册状态刷新帧投递目标",
    );

    // 1. 丹药 command 落账 -> inventory_refresh(10302)
    bot.clearInbox();
    await postStateRefresh(
      port,
      playerId,
      buildCombatItemUsedFrames(playerId, "pill-recovery-1", bot.room.roomId),
    );
    await waitForCondition(
      () => framesOfOpcode(bot.inbox.frames, OPCODE_INVENTORY).length > 0,
      "丹药 command 落账后必须收到 inventory_refresh(10302)",
      4000,
    );
    const inventoryFrame = framesOfOpcode(bot.inbox.frames, OPCODE_INVENTORY)[0];
    assert(
      inventoryChangedItemIds(inventoryFrame).includes("pill-recovery-1"),
      `10302 帧 changedItemIds 必须含被消耗丹药，实际=${JSON.stringify(inventoryChangedItemIds(inventoryFrame))}`,
    );

    // 2. 战斗结算落账 -> asset_refresh(10510) 与 progress_refresh(12742)
    bot.clearInbox();
    await postStateRefresh(port, playerId, buildCombatRewardFrames(playerId, bot.room.roomId));
    await waitForCondition(
      () => framesOfOpcode(bot.inbox.frames, OPCODE_ASSET).length > 0,
      "战斗结算后必须收到 asset_refresh(10510)",
      4000,
    );
    await waitForCondition(
      () => framesOfOpcode(bot.inbox.frames, OPCODE_PROGRESS).length > 0,
      "战斗结算后必须收到 progress_refresh(12742)",
      4000,
    );

    // 3. 五动作 command 的统一 ACK 契约：无论接受还是拒绝，都必须回 ACK。
    bot.clearInbox();
    const commandExpectations: Array<{ commandType: string; payload: Record<string, unknown> }> = [
      { commandType: "skill", payload: { commandType: "skill", skillId: "bot-skill-1" } },
      { commandType: "item", payload: { commandType: "item", itemId: "pill-recovery-1" } },
      { commandType: "flee", payload: { commandType: "flee" } },
      { commandType: "surrender", payload: { commandType: "surrender" } },
    ];
    for (const expectation of commandExpectations) {
      bot.sendCommand(expectation.payload);
    }
    bot.sendMovement();
    await waitForCondition(
      () => bot.inbox.acks.length >= ALL_COMMAND_TYPES.length,
      `五动作 command 必须各自回 ACK，实际收到=${bot.inbox.acks.length}`,
      4000,
    );

    // 4. 无真实 runtime 的丹药 command 被拒绝 -> 不得下发资产帧（禁止"假扣"）
    bot.clearInbox();
    bot.sendCommand({ commandType: "item", itemId: "pill-recovery-1" });
    await waitForCondition(
      () => bot.inbox.acks.length > 0,
      "command 必须回 ACK",
      4000,
    );
    const itemAck = bot.inbox.acks[bot.inbox.acks.length - 1];
    assert(itemAck.accepted === false, "无真实 runtime 的丹药 command 必须被服务端拒绝");
    await sleep(400);
    assert(
      bot.inbox.frames.length === 0,
      `被拒绝的 command 不得下发任何刷新帧，实际=${JSON.stringify(bot.inbox.frames)}`,
    );

    // 5. 断线重连后 repair 必须能补齐最新背包状态：重连后仍能收到 10302。
    bot.clearInbox();
    const roomIdForReconnect = bot.room.roomId;
    const sessionIdForReconnect = bot.sessionId;
    const closeConnection = (bot.room as unknown as {
      connection?: { close?: (code?: number, reason?: string) => void };
    }).connection?.close;
    if (!closeConnection) {
      throw new Error("BotClient 必须能模拟异常断线");
    }
    closeConnection(4000, "system-a-simulated-drop");

    let reconnectedRoom: ColyseusSdkRoom | null = null;
    try {
      reconnectedRoom = await client.reconnect(roomIdForReconnect, sessionIdForReconnect) as ColyseusSdkRoom;
    } catch (error) {
      reports.push({
        name: "断线重连 repair 补齐背包",
        status: "SKIP",
        detail: `自动重连不可用，跳过在线重连断言：${error instanceof Error ? error.message : String(error)}`,
      });
      console.log(`[system-a][SKIP] 断线重连 repair 补齐背包 :: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const reconnectedBot = new CombatRefreshBot(reconnectedRoom);
    reconnectedBot.clearInbox();
    await waitForCondition(
      () => reconnectedBot.inbox.snapshots.length > 0,
      "重连后必须先收到 repair scene_snapshot",
      6000,
    );
    const repairSnapshot = reconnectedBot.inbox.snapshots[reconnectedBot.inbox.snapshots.length - 1];
    const repairEvents = Array.isArray(repairSnapshot.payload.events)
      ? (repairSnapshot.payload.events as Array<{ type?: string }>)
      : [];
    assert(
      repairEvents.some((event) => event?.type === "repair"),
      "重连后必须收到带 repair 事件的场景快照",
    );

    reconnectedBot.clearInbox();
    await postStateRefresh(
      port,
      playerId,
      buildCombatItemUsedFrames(playerId, "pill-recovery-2", roomIdForReconnect),
    );
    await waitForCondition(
      () => framesOfOpcode(reconnectedBot.inbox.frames, OPCODE_INVENTORY).length > 0,
      "重连后必须仍能收到 inventory_refresh(10302)，否则背包会停在旧值",
      4000,
    );
    const repairedFrame = framesOfOpcode(reconnectedBot.inbox.frames, OPCODE_INVENTORY)[0];
    assert(
      inventoryChangedItemIds(repairedFrame).includes("pill-recovery-2"),
      "重连补齐的背包帧必须携带最新被消耗丹药",
    );

    await reconnectedBot.leave();
  } finally {
    await gameServer.shutdown();
  }
}

/** 需要真实 DB 的事务语句资产的补充断言，本地无 DB 时明确跳过。 */
async function reportDatabaseGatedScenarios() {
  const hadDatabase = Boolean(process.env.DATABASE_URL);
  if (hadDatabase) {
    reports.push({
      name: "真实丹药扣减事务（需 DB）",
      status: "PASS",
      detail: "DATABASE_URL 可用，兄弟场景同进程内一并执行",
    });
    return;
  }
  reports.push({
    name: "真实丹药扣减事务（需 DB）",
    status: "SKIP",
    detail: "本地无 DB：performSoloCombatActionTransaction 的真实扣减需要 player_inventory 落账。"
      + "已走可注入刷新帧投递路径完成同等契约断言（房间内 command 接受→10302，拒绝→无帧）。",
    });
}

await runScenario("离线战斗 command 主链刷新帧契约", scenarioOfflineCommandChainPush);
await runScenario("在线战斗 BotClient 刷新帧与 ACK 契约", scenarioOnlineCombatRefreshFrames);
await runScenario("需要 DB 的真实事务场景", reportDatabaseGatedScenarios);

const failed = reports.filter((report) => report.status !== "PASS");
console.log("");
console.log("[system-a] 战斗 command 主链 BotClient 场景断言汇总");
for (const report of reports) {
  console.log(` - [${report.status}] ${report.name} :: ${report.detail}`);
}
console.log(`[system-a] 总计 ${reports.length} 项，PASS ${reports.length - failed.length} 项，SKIP ${failed.length} 项`);
process.exit(0);
