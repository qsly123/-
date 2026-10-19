import { Client as ColyseusSdkClient, type Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  createStateRefreshFrameGroup,
  GAME_ROOM_NAMES,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  type AnyStateRefreshEnvelope,
  type RealtimeInputAck,
  type SocialPresenceEnvelope,
  type SocialPresenceEvent,
} from "@immortality/shared-protocol";
import {
  resolveSectPresenceRoomOptions,
  type SectPresenceEvent,
  type SectPresenceMemberView,
  type SocialPresenceEnvelopeWithSect,
} from "@immortality/shared-protocol/sect-presence";
import { SocialRoom } from "../rooms/social-room";
import { collectStaleSectPresenceSessionIds } from "../rooms/social-sect-presence";
import { GameRoomState } from "../state";
import { createGameServer } from "../server";
import { ensureLocalPresenceStateRefreshBridge } from "../local-presence-refresh-bridge";

/**
 * 系统C · 宗门驻地 / 成员 presence BotClient 场景断言。
 *
 * 覆盖：
 * 1. 成员上线 / 下线收到 social_event(10202)，成员列表正确增减。
 * 2. 切换驻地收到宗门 presence 广播。
 * 3. 仓库存取后收到 inventory_refresh(10302) 与 asset_refresh(10510)。
 * 4. 任命 / 权限变化收到 progress_refresh(12742) 且 scopes 含 sect。
 * 5. 重连 repair 后成员 presence 不残留离线成员。
 *
 * 本地可跑：不依赖 DB / Redis，仓储事务用内部 state-refresh 端点模拟 Next 侧落账推送。
 */

const SECT_ID = "bot-sect-1";
const STATE_REFRESH_PATH = "/internal/state-refresh";

type SocialRoomPayload = SocialPresenceEnvelopeWithSect & {
  sectPresence?: SectPresenceMemberView[];
};

interface BotInbox {
  events: SocialRoomPayload[];
  snapshots: SocialRoomPayload[];
  acks: RealtimeInputAck[];
  refreshFrames: AnyStateRefreshEnvelope[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  predicate: () => boolean,
  message: string,
  timeoutMs = 3000,
) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`${message} (timeout ${timeoutMs}ms)`);
    }
    await sleep(10);
  }
}

function findEvent(
  inbox: BotInbox,
  predicate: (event: SocialPresenceEvent | SectPresenceEvent) => boolean,
) {
  for (const payload of inbox.events) {
    for (const event of payload.events || []) {
      if (predicate(event)) {
        return event;
      }
    }
  }
  return null;
}

/**
 * 最近一帧权威状态。
 *
 * social_event 与 social_snapshot 都携带完整 authoritativeState，
 * 广播走的是 social_event，因此不能只看 snapshot。
 */
function latestPayload(inbox: BotInbox): SocialRoomPayload | null {
  return inbox.events.at(-1) || inbox.snapshots.at(-1) || null;
}

function sectMemberIds(payload: SocialRoomPayload | null) {
  return new Set((payload?.authoritativeState?.sectMembers || []).map((member) => member.playerId));
}

function sectPresenceIds(payload: SocialRoomPayload | null) {
  return new Set((payload?.sectPresence || []).map((member) => member.playerId));
}

/* ============================
   离线房间级场景（无 DB / Redis / 网络）
   ============================ */

type FakeClient = Parameters<SocialRoom["onJoin"]>[0];

function createFakeClient(sessionId: string, sink: BotInbox): FakeClient {
  return {
    sessionId,
    send(type: string, body: unknown) {
      if (type === "social_event") {
        sink.events.push(body as SocialRoomPayload);
        return;
      }
      if (type === "social_snapshot") {
        sink.snapshots.push(body as SocialRoomPayload);
        return;
      }
      if (type === "ack") {
        sink.acks.push(body as RealtimeInputAck);
      }
    },
  } as unknown as FakeClient;
}

function createOfflineRoom(clients: FakeClient[]) {
  const room = new SocialRoom();
  room.setState(new GameRoomState());
  room.state.roomKind = "social";
  room.state.mapId = `sect:${SECT_ID}`;
  room.state.shardId = "sect";
  Object.defineProperty(room, "roomId", {
    value: "offline-sect-room",
    configurable: true,
  });
  Object.defineProperty(room, "clients", {
    value: clients,
    configurable: true,
    writable: true,
  });
  return room;
}

function joinOffline(room: SocialRoom, client: FakeClient, playerId: string) {
  const options = resolveSectPresenceRoomOptions(SECT_ID);
  room.onJoin(client, {
    playerId,
    mapId: options.mapId,
    shardId: options.shardId,
    sectId: options.sectId,
  });
}

function sendOfflineCommand(room: SocialRoom, client: FakeClient, payload: Record<string, unknown>, sequence: number) {
  room["handleRealtimeInput"](client, {
    clientSequence: sequence,
    clientSceneTick: 0,
    actionId: `system-c-${sequence}`,
    clientSentAt: Date.now(),
    inputType: "command",
    payload,
  });
}

function scenarioMemberJoinLeaveAndRoleBroadcast() {
  const inboxA: BotInbox = { events: [], snapshots: [], acks: [], refreshFrames: [] };
  const inboxB: BotInbox = { events: [], snapshots: [], acks: [], refreshFrames: [] };
  const clientA = createFakeClient("offline-a", inboxA);
  const clientB = createFakeClient("offline-b", inboxB);
  const clients: FakeClient[] = [];
  const room = createOfflineRoom(clients);

  clients.push(clientA);
  joinOffline(room, clientA, "player-a");
  clients.push(clientB);
  joinOffline(room, clientB, "player-b");

  // 1. 上线：A 收到 B 的 presence 广播，且宗门成员列表包含 B。
  const joinEvent = findEvent(inboxA, (event) => event.type === "sect_presence_join");
  assert(joinEvent, "成员上线必须广播 sect_presence_join（social_event 10202）");
  assert(
    findEvent(inboxA, (event) => event.type === "presence_join"),
    "成员上线必须同时广播通用 presence_join",
  );
  assert(
    sectMemberIds(latestPayload(inboxA)).has("player-b"),
    "成员上线后 A 的宗门成员列表必须包含 B",
  );
  assert(
    sectPresenceIds(latestPayload(inboxA)).has("player-b"),
    "成员上线后 A 的宗门 presence 列表必须包含 B",
  );
  assert(
    (latestPayload(inboxA)?.sectPresence || []).every((member) => member.atHome),
    "进入宗门 presence 房间默认应视为在驻地",
  );

  // 2. 切换驻地：B 离场后 A 必须看到 atHome=false。
  sendOfflineCommand(room, clientB, { command: "sect_presence_home_leave" }, 11);
  const leaveHomeEvent = findEvent(inboxA, (event) => event.type === "sect_presence_home_changed");
  assert(leaveHomeEvent, "切换驻地必须广播 sect_presence_home_changed");
  assert(
    leaveHomeEvent && leaveHomeEvent.type === "sect_presence_home_changed" && leaveHomeEvent.atHome === false,
    "离开驻地事件必须携带 atHome=false",
  );
  assert(
    (latestPayload(inboxA)?.sectPresence || []).some(
      (member) => member.playerId === "player-b" && member.atHome === false,
    ),
    "B 离场后 A 的 presence 列表必须把 B 标为不在驻地",
  );

  sendOfflineCommand(room, clientB, { command: "sect_presence_home_enter" }, 12);
  assert(
    findEvent(inboxA, (event) => (
      event.type === "sect_presence_home_changed" && event.atHome === true
    )),
    "回到驻地必须广播 atHome=true",
  );

  // 3. 任命变化：同宗门成员都要收到广播。
  sendOfflineCommand(room, clientB, {
    command: "sect_presence_role_changed",
    targetPlayerId: "player-c",
    roleKey: "elder",
  }, 13);
  const roleEvent = findEvent(inboxA, (event) => event.type === "sect_presence_role_changed");
  assert(roleEvent, "任命变化必须广播 sect_presence_role_changed");
  assert(
    roleEvent && roleEvent.type === "sect_presence_role_changed" && roleEvent.roleKey === "elder",
    "任命广播必须携带目标职阶",
  );

  // 4. 下线：B 离开后 A 的成员列表必须减掉 B。
  room.onLeave(clientB, 1000);
  clients.splice(clients.indexOf(clientB), 1);
  const leaveEvent = findEvent(inboxA, (event) => event.type === "sect_presence_leave");
  assert(leaveEvent, "成员下线必须广播 sect_presence_leave");
  assert(
    !sectMemberIds(latestPayload(inboxA)).has("player-b"),
    "成员下线后 A 的宗门成员列表必须移除 B",
  );

  console.log("[system-c][offline] 成员上下线 / 切换驻地 / 任命广播 ok");
}

function scenarioRepairPrunesStalePresence() {
  const inboxA: BotInbox = { events: [], snapshots: [], acks: [], refreshFrames: [] };
  const clientA = createFakeClient("offline-repair-a", inboxA);
  const clients: FakeClient[] = [];
  const room = createOfflineRoom(clients);
  clients.push(clientA);
  joinOffline(room, clientA, "player-a");

  // 注入一个"连接已断但 context 残留"的幽灵成员，模拟重连窗口异常。
  const contexts = (room as unknown as {
    contexts: Map<string, {
      sessionId: string;
      playerId: string;
      name: string;
      mapId: string;
      shardId: string;
      partyId: string | null;
      sectId: string | null;
      atHome: boolean;
      joinedAt: number;
      updatedAt: number;
      presenceUpdatedAt: number;
    }>;
  }).contexts;
  contexts.set("ghost-session", {
    sessionId: "ghost-session",
    playerId: "player-ghost",
    name: "player-ghost",
    mapId: `sect:${SECT_ID}`,
    shardId: "sect",
    partyId: null,
    sectId: SECT_ID,
    atHome: true,
    joinedAt: Date.now(),
    updatedAt: Date.now(),
    presenceUpdatedAt: Date.now(),
  });

  assert(
    collectStaleSectPresenceSessionIds(contexts, new Set(["offline-repair-a"])).includes("ghost-session"),
    "幽灵连接必须被判定为残留 presence",
  );

  room["handleRealtimeInput"](clientA, {
    clientSequence: 21,
    clientSceneTick: 0,
    actionId: "system-c-repair",
    clientSentAt: Date.now(),
    inputType: "repair",
    payload: {},
  });

  const snapshot = latestPayload(inboxA);
  assert(snapshot, "repair 必须回送 social_snapshot");
  assert(
    !sectMemberIds(snapshot).has("player-ghost"),
    "repair 后成员列表不能残留离线幽灵成员",
  );
  assert(
    !sectPresenceIds(snapshot).has("player-ghost"),
    "repair 后宗门 presence 列表不能残留离线幽灵成员",
  );
  assert(sectMemberIds(snapshot).has("player-a"), "repair 后自己仍应在成员列表里");

  console.log("[system-c][offline] repair 清理残留 presence ok");
}

function scenarioPresenceDeliveryFilter() {
  const inboxSect: BotInbox = { events: [], snapshots: [], acks: [], refreshFrames: [] };
  const inboxOutsider: BotInbox = { events: [], snapshots: [], acks: [], refreshFrames: [] };
  const clientSect = createFakeClient("offline-sect-member", inboxSect);
  const clientOutsider = createFakeClient("offline-outsider", inboxOutsider);
  const clients: FakeClient[] = [];
  const room = createOfflineRoom(clients);

  clients.push(clientSect);
  joinOffline(room, clientSect, "player-a");
  clients.push(clientOutsider);
  room.onJoin(clientOutsider, {
    playerId: "player-outsider",
    mapId: `sect:${SECT_ID}`,
    shardId: "sect",
    sectId: "other-sect",
  });

  assert(
    findEvent(inboxOutsider, (event) => event.type === "sect_presence_join") === null,
    "非同宗门连接不能收到宗门 presence 广播",
  );

  console.log("[system-c][offline] presence 投递过滤 ok");
}

/* ============================
   在线 BotClient 场景（真实 game-server + SDK）
   ============================ */

class SectPresenceBot {
  readonly inbox: BotInbox = { events: [], snapshots: [], acks: [], refreshFrames: [] };
  private sequence = 0;

  private constructor(
    readonly playerId: string,
    private readonly room: ColyseusSdkRoom,
  ) {
    this.room.onMessage("social_event", (payload: SocialRoomPayload) => {
      this.inbox.events.push(payload);
    });
    this.room.onMessage("social_snapshot", (payload: SocialRoomPayload) => {
      this.inbox.snapshots.push(payload);
    });
    this.room.onMessage("ack", (payload: RealtimeInputAck) => {
      this.inbox.acks.push(payload);
    });
    for (const type of ["inventory_refresh", "asset_refresh", "progress_refresh"]) {
      this.room.onMessage(type, (payload: AnyStateRefreshEnvelope) => {
        this.inbox.refreshFrames.push(payload);
      });
    }
  }

  static async join(params: {
    client: ColyseusSdkClient;
    playerId: string;
    sectId: string;
  }): Promise<SectPresenceBot> {
    const options = resolveSectPresenceRoomOptions(params.sectId);
    const room = await params.client.joinOrCreate<SocialPresenceEnvelope["authoritativeState"]>(
      GAME_ROOM_NAMES.social,
      {
        playerId: params.playerId,
        mapId: options.mapId,
        shardId: options.shardId,
        sectId: options.sectId,
      },
    );
    return new SectPresenceBot(params.playerId, room);
  }

  private nextInput(inputType: "command" | "repair", payload: Record<string, unknown>) {
    this.sequence += 1;
    const input = createRealtimeClientInput({
      clientSequence: this.sequence,
      clientSceneTick: 0,
      actionId: `system-c-${this.playerId}-${this.sequence}`,
      clientSentAt: Date.now(),
      inputType,
      payload,
    });
    this.room.send("input", input);
    return input;
  }

  sendSectPresenceCommand(command: string, payload: Record<string, unknown> = {}) {
    return this.nextInput("command", { command, ...payload });
  }

  repair() {
    return this.nextInput("repair", { trigger: "bot", reason: "system_c_repair" });
  }

  async leave() {
    await this.room.leave(true);
  }
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

async function runBotScenarios() {
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const gameServer = createGameServer();
  await gameServer.listen();
  // 无 Redis 单实例需要补挂 presence 订阅，否则刷新帧只广播不投递。
  const bridged = ensureLocalPresenceStateRefreshBridge(gameServer);
  assert(bridged, "无 Redis 单实例必须补挂状态刷新帧投递订阅");
  const port = gameServer.config.port;
  const client = new ColyseusSdkClient(`ws://127.0.0.1:${port}`);

  try {
    const botA = await SectPresenceBot.join({ client, playerId: "bot-sect-a", sectId: SECT_ID });
    await waitForCondition(
      () => botA.inbox.snapshots.length > 0,
      "Bot A join 后必须收到 social_snapshot",
    );

    // 1. 成员上线
    const botB = await SectPresenceBot.join({ client, playerId: "bot-sect-b", sectId: SECT_ID });
    await waitForCondition(
      () => findEvent(botA.inbox, (event) => event.type === "sect_presence_join") !== null,
      "成员上线必须广播 sect_presence_join（social_event 10202）",
    );
    await waitForCondition(
      () => sectMemberIds(latestPayload(botA.inbox)).has("bot-sect-b"),
      "成员上线后 A 的宗门成员列表必须包含 B",
    );
    assert(
      sectPresenceIds(latestPayload(botA.inbox)).size >= 2,
      "成员上线后 A 的宗门 presence 列表必须同时包含 A 与 B",
    );

    // 2. 切换驻地
    botB.sendSectPresenceCommand("sect_presence_home_leave");
    await waitForCondition(
      () => findEvent(botA.inbox, (event) => (
        event.type === "sect_presence_home_changed" && event.atHome === false
      )) !== null,
      "切换驻地必须广播 sect_presence_home_changed(atHome=false)",
    );
    botB.sendSectPresenceCommand("sect_presence_home_enter");
    await waitForCondition(
      () => findEvent(botA.inbox, (event) => (
        event.type === "sect_presence_home_changed" && event.atHome === true
      )) !== null,
      "回到驻地必须广播 sect_presence_home_changed(atHome=true)",
    );

    // 3. 仓库存取：必须收到 10302 + 10510
    botA.inbox.refreshFrames.length = 0;
    await postStateRefresh(port, botA.playerId, createStateRefreshFrameGroup({
      playerId: botA.playerId,
      reason: "sect_storage_deposit",
      inventory: { changedItemIds: ["item-1"] },
      asset: { currencies: { gold: 100 } },
    }));
    await waitForCondition(
      () => botA.inbox.refreshFrames.some((frame) => frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh),
      "仓库存取必须下发 inventory_refresh(10302)",
    );
    await waitForCondition(
      () => botA.inbox.refreshFrames.some((frame) => frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh),
      "仓库存取必须下发 asset_refresh(10510)",
    );

    // 4. 任命 / 权限变化：必须收到 12742 且 scopes 含 sect
    botA.inbox.refreshFrames.length = 0;
    await postStateRefresh(port, botA.playerId, createStateRefreshFrameGroup({
      playerId: botA.playerId,
      reason: "sect_appoint",
      progress: { scopes: ["sect"] },
    }));
    await waitForCondition(
      () => botA.inbox.refreshFrames.some((frame) => frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh),
      "任命变化必须下发 progress_refresh(12742)",
    );
    const progressFrame = botA.inbox.refreshFrames.find((frame) => (
      frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh
    ));
    const scopes = (progressFrame?.payload as { scopes?: string[] } | undefined)?.scopes || [];
    assert(scopes.includes("sect"), `progress_refresh 的 scopes 必须含 sect: ${JSON.stringify(scopes)}`);

    // 5. 成员下线 + 重连 repair 后不残留离线成员
    await botB.leave();
    await waitForCondition(
      () => findEvent(botA.inbox, (event) => event.type === "sect_presence_leave") !== null,
      "成员下线必须广播 sect_presence_leave",
    );
    await waitForCondition(
      () => !sectMemberIds(latestPayload(botA.inbox)).has("bot-sect-b"),
      "成员下线后 A 的宗门成员列表必须移除 B",
    );

    const botBReconnect = await SectPresenceBot.join({ client, playerId: "bot-sect-b", sectId: SECT_ID });
    await waitForCondition(
      () => sectMemberIds(latestPayload(botA.inbox)).has("bot-sect-b"),
      "重连后 B 必须重新出现在 A 的成员列表里",
    );

    // 断线 + repair：repair 回来的列表不能包含已离线的成员
    await botBReconnect.leave();
    await waitForCondition(
      () => !sectMemberIds(latestPayload(botA.inbox)).has("bot-sect-b"),
      "再次下线后 A 的成员列表必须移除 B",
    );
    botA.inbox.snapshots.length = 0;
    botA.repair();
    await waitForCondition(
      () => botA.inbox.snapshots.length > 0,
      "repair 必须回送 social_snapshot",
    );
    const repaired = latestPayload(botA.inbox);
    assert(
      !sectMemberIds(repaired).has("bot-sect-b"),
      "repair 后成员列表不能残留已离线成员",
    );
    assert(
      !sectPresenceIds(repaired).has("bot-sect-b"),
      "repair 后宗门 presence 列表不能残留已离线成员",
    );
    assert(sectMemberIds(repaired).has("bot-sect-a"), "repair 后自己必须仍在成员列表里");

    await botA.leave();
    console.log("[system-c][bot] 在线 BotClient 宗门 presence 场景 ok");
  } finally {
    await gameServer.shutdown();
  }
}

scenarioMemberJoinLeaveAndRoleBroadcast();
scenarioRepairPrunesStalePresence();
scenarioPresenceDeliveryFilter();
await runBotScenarios();

console.log("[system-c] sect presence BotClient 场景断言全部通过");
