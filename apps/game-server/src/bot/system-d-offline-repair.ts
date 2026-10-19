/**
 * 系统D：离线恢复 / repair 补齐链路 BotClient 场景断言（P2-B）。
 *
 * 本地可跑，不依赖 DB / Redis：`GAME_SERVER_AUTH_MODE` 缺省为 optional，
 * `REDIS_URL` 缺省时 game-server 单机启动。
 *
 * 运行：
 *   bun run apps/game-server/src/bot/system-d-offline-repair.ts
 *
 * 覆盖：
 *  1. 模拟断网后重连，join 成功且收到 sector_snapshot(10002) 或 scene_snapshot(10001)
 *  2. 触发 foreground_restore repair，断言收到 repair 结果且补齐最新状态
 *  3. repair 后若服务端有资产变更，断言收到 10302 / 10510 / 12742
 *  4. 连续两次 repair 不产生重复状态（幂等）
 */

import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  createRealtimeRepairPayload,
  GAME_ROOM_NAMES,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  type AnyStateRefreshEnvelope,
  type RealtimeInputAck,
  type RealtimeRepairTrigger,
  type WorldMapSectorEnvelope,
} from "@immortality/shared-protocol";
import {
  getPlayerRefreshDigestStats,
  recordPlayerRefreshDigest,
  resetPlayerRefreshDigests,
} from "../player-refresh-digest";
import { createLoadClient, waitForRoomMessage, withGameServerEndpoint } from "../load-utils";

const MAP_ID = "bot-offline-map";
const SHARD_ID = "0";
const ACK_TIMEOUT_MS = 6000;
const SETTLE_MS = 350;

/** 刷新帧 opcode -> 语义，断言输出直接贴真机验收。 */
const REFRESH_OPCODES = {
  inventory: REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh,
  asset: REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh,
  progress: REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh,
} as const;

interface Assertion {
  name: string;
  ok: boolean;
  detail: string;
}

const assertions: Assertion[] = [];

function assert(name: string, ok: boolean, detail: string) {
  assertions.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface BotRepairResult {
  ack: RealtimeInputAck;
  snapshot: WorldMapSectorEnvelope;
  refreshFrames: AnyStateRefreshEnvelope[];
  opcodes: number[];
}

interface BotClient {
  playerId: string;
  room: ColyseusSdkRoom;
  snapshots: WorldMapSectorEnvelope[];
  refreshFrames: AnyStateRefreshEnvelope[];
  nextSequence: () => number;
  sendRepair: (
    trigger: RealtimeRepairTrigger,
    reason?: string,
  ) => Promise<BotRepairResult>;
  /** 模拟 iOS 锁屏 / 切后台被系统掐断连接：不发送 leave，直接断开传输层。 */
  dropConnection: () => Promise<void>;
  leave: () => Promise<void>;
}

async function joinWorldMapBot(endpoint: string, playerId: string): Promise<BotClient> {
  const client = createLoadClient(endpoint);
  const room = await client.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
    playerId,
    mapId: MAP_ID,
    shardId: SHARD_ID,
  });

  const bot: BotClient = {
    playerId,
    room,
    snapshots: [],
    refreshFrames: [],
    nextSequence: (() => {
      let sequence = 0;
      return () => {
        sequence += 1;
        return sequence;
      };
    })(),
    async sendRepair(trigger, reason) {
      const sequence = bot.nextSequence();
      const ackPromise = waitForRoomMessage<RealtimeInputAck>(
        room,
        "ack",
        (payload) => payload.acceptedSequence === sequence && payload.inputType === "repair",
        ACK_TIMEOUT_MS,
      );
      const snapshotPromise = waitForRoomMessage<WorldMapSectorEnvelope>(
        room,
        "sector_snapshot",
        (payload) => payload.type === "sector_snapshot" && payload.acceptedSequence === sequence,
        ACK_TIMEOUT_MS,
      );
      const framesBefore = bot.refreshFrames.length;

      room.send("input", createRealtimeClientInput({
        clientSequence: sequence,
        clientSceneTick: 0,
        actionId: `${playerId}-repair-${sequence}`,
        clientSentAt: Date.now(),
        inputType: "repair",
        payload: createRealtimeRepairPayload({
          trigger,
          ...(reason ? { reason } : {}),
          lastServerTick: 0,
          lastSnapshotVersion: 0,
        }),
      }));

      const ack = await ackPromise;
      const snapshot = await snapshotPromise;
      await sleep(SETTLE_MS);
      const refreshFrames = bot.refreshFrames.slice(framesBefore);

      return {
        ack,
        snapshot,
        refreshFrames,
        opcodes: refreshFrames.map((frame) => frame.opcode),
      };
    },
    async dropConnection() {
      // leave(false) 等价于"客户端进程被系统冻结"：服务端不会收到 leave 报文。
      await room.leave(false);
    },
    async leave() {
      await room.leave(true);
    },
  };

  room.onMessage<WorldMapSectorEnvelope>("sector_snapshot", (payload) => {
    bot.snapshots.push(payload);
  });
  room.onMessage<AnyStateRefreshEnvelope>("inventory_refresh", (payload) => {
    bot.refreshFrames.push(payload);
  });
  room.onMessage<AnyStateRefreshEnvelope>("asset_refresh", (payload) => {
    bot.refreshFrames.push(payload);
  });
  room.onMessage<AnyStateRefreshEnvelope>("progress_refresh", (payload) => {
    bot.refreshFrames.push(payload);
  });

  return bot;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(40);
  }
  console.warn(`  (wait timeout: ${label})`);
  return false;
}

/** sector_snapshot 的权威实体表里找自己：id 即 playerId。 */
function findSelf(
  snapshot: WorldMapSectorEnvelope | null,
  playerId: string,
) {
  const entities = snapshot?.authoritativeState?.entities || [];
  return entities.find((entity) => entity.id === playerId) || null;
}

async function runScenarios(endpoint: string) {
  const remoteEndpoint = Boolean(process.env.GAME_LOAD_TARGET_URL?.trim());
  const playerId = "bot-system-d";

  // ---------- 场景 1：模拟断网后重连，join 成功且收到 10002 / 10001 ----------
  let bot = await joinWorldMapBot(endpoint, playerId);
  const joinSnapshot = await waitForRoomMessage<WorldMapSectorEnvelope>(
    bot.room,
    "sector_snapshot",
    (payload) => payload.type === "sector_snapshot",
    ACK_TIMEOUT_MS,
  );

  assert(
    "首次 join 收到 sector_snapshot(10002)",
    joinSnapshot.type === "sector_snapshot",
    `type=${joinSnapshot.type} opcode=${REALTIME_OPCODE_BY_OUTPUT_TYPE.sector_snapshot} snapshotVersion=${joinSnapshot.snapshotVersion}`,
  );
  assert(
    "快照含自身实体权威坐标",
    Boolean(findSelf(joinSnapshot, playerId)),
    `self=${JSON.stringify(findSelf(joinSnapshot, playerId))}`,
  );

  await bot.dropConnection();
  await sleep(SETTLE_MS);

  // 换一个全新的 SDK client 重连：模拟 iOS 被冻结后 App 重新拉起的新连接。
  bot = await joinWorldMapBot(endpoint, playerId);
  const rejoined = await waitFor(
    () => bot.snapshots.length >= 1 && Boolean(findSelf(bot.snapshots[bot.snapshots.length - 1], playerId)),
    ACK_TIMEOUT_MS,
    "rejoin sector_snapshot",
  );
  const reconnectSnapshot = bot.snapshots[bot.snapshots.length - 1] || null;
  const acceptedSnapshotTypes: string[] = ["sector_snapshot", "scene_snapshot"];
  const reconnectSnapshotType = String(reconnectSnapshot?.type || "");

  assert(
    "模拟断网后重连 join 成功并收到 sector_snapshot(10002) 或 scene_snapshot(10001)",
    rejoined && acceptedSnapshotTypes.includes(reconnectSnapshotType),
    `rejoined=${rejoined} type=${reconnectSnapshotType} snapshotVersion=${reconnectSnapshot?.snapshotVersion}`,
  );
  const acceptedSnapshotOpcodes: number[] = [
    REALTIME_OPCODE_BY_OUTPUT_TYPE.scene_snapshot,
    REALTIME_OPCODE_BY_OUTPUT_TYPE.sector_snapshot,
  ];
  const reconnectOpcode = Number(
    REALTIME_OPCODE_BY_OUTPUT_TYPE[
      reconnectSnapshotType as keyof typeof REALTIME_OPCODE_BY_OUTPUT_TYPE
    ] || 0,
  );

  assert(
    "重连快照 opcode 落在 10001 / 10002 白名单",
    acceptedSnapshotOpcodes.includes(reconnectOpcode),
    `type=${reconnectSnapshotType} opcode=${reconnectOpcode}`,
  );

  // ---------- 场景 2：foreground_restore repair 被接受且补齐最新状态 ----------
  const foregroundRepair = await bot.sendRepair("foreground_restore", "ios_lock_screen_return");

  assert(
    "foreground_restore repair 被服务端接受",
    foregroundRepair.ack.accepted === true,
    `ack=${JSON.stringify(foregroundRepair.ack)}`,
  );
  assert(
    "repair 补齐返回与本端序列对齐的权威快照",
    foregroundRepair.snapshot.acceptedSequence === foregroundRepair.ack.acceptedSequence
      && foregroundRepair.snapshot.snapshotVersion >= 1,
    `ackSequence=${foregroundRepair.ack.acceptedSequence} snapshotSequence=${foregroundRepair.snapshot.acceptedSequence} snapshotVersion=${foregroundRepair.snapshot.snapshotVersion}`,
  );
  assert(
    "repair 快照回带自身实体坐标（不是只回 ACK）",
    Boolean(findSelf(foregroundRepair.snapshot, playerId)),
    `self=${JSON.stringify(findSelf(foregroundRepair.snapshot, playerId))}`,
  );

  // ---------- 场景 4：连续两次 repair 不产生重复状态（幂等） ----------
  const secondRepair = await bot.sendRepair("foreground_restore", "ios_lock_screen_return_twice");

  assert(
    "第二次 foreground_restore repair 仍被接受",
    secondRepair.ack.accepted === true,
    `ack=${JSON.stringify(secondRepair.ack)}`,
  );
  assert(
    "连续两次 repair 不产生重复刷新帧（幂等）",
    secondRepair.refreshFrames.length === 0,
    `第二次刷新帧数=${secondRepair.refreshFrames.length}（第一次=${foregroundRepair.refreshFrames.length}）`,
  );
  assert(
    "两次 repair 的快照内容一致（未引入漂移）",
    JSON.stringify(secondRepair.snapshot.authoritativeState)
      === JSON.stringify(foregroundRepair.snapshot.authoritativeState),
    `第一次快照键=${Object.keys(foregroundRepair.snapshot.authoritativeState || {}).length} 第二次=${Object.keys(secondRepair.snapshot.authoritativeState || {}).length}`,
  );

  await bot.leave();

  // ---------- 场景 3：repair 后服务端有资产变更 -> 收到 10302 / 10510 / 12742 ----------
  if (remoteEndpoint) {
    console.log(
      "SKIP | repair 后资产变更刷新帧 | 远端 game-server 目标下无法注入服务端资产变更，"
        + "请去掉 GAME_LOAD_TARGET_URL 后以本地内置 game-server 重跑",
    );
  } else {
    const assetBot = await joinWorldMapBot(endpoint, "bot-system-d-asset");
    try {
      await waitFor(
        () => assetBot.snapshots.length >= 1,
        ACK_TIMEOUT_MS,
        "asset bot join snapshot",
      );
      // 首次 repair 会消费掉 join 时挂的基线摘要，保证下面的断言只反映"资产变更"。
      const baselineRepair = await assetBot.sendRepair("initial_join", "baseline");
      assert(
        "基线 repair 下发刷新帧（禁止只回 ACK）",
        baselineRepair.refreshFrames.length > 0,
        `刷新帧=${baselineRepair.refreshFrames.length} opcodes=${JSON.stringify(baselineRepair.opcodes)}`,
      );

      const framesBeforeChange = assetBot.refreshFrames.length;
      // 模拟断连窗口内的资产入库变更：核心事务成功落账后记录摘要。
      recordPlayerRefreshDigest({
        playerId: "bot-system-d-asset",
        inventory: { changedItemIds: ["herb_bot_01"] },
        asset: { currencies: { spirit_stone: 1888 } },
        progress: { scopes: ["cultivation", "realm"] },
      });

      const assetRepair = await assetBot.sendRepair("foreground_restore", "asset_changed_while_offline");
      const changedFrames = assetBot.refreshFrames.slice(framesBeforeChange);
      const changedOpcodes = new Set(changedFrames.map((frame) => frame.opcode));

      assert(
        "asset_refresh(10510) 到达",
        changedOpcodes.has(REFRESH_OPCODES.asset),
        `opcodes=${JSON.stringify(Array.from(changedOpcodes))}`,
      );
      assert(
        "inventory_refresh(10302) 到达",
        changedOpcodes.has(REFRESH_OPCODES.inventory),
        `opcodes=${JSON.stringify(Array.from(changedOpcodes))}`,
      );
      assert(
        "progress_refresh(12742) 到达",
        changedOpcodes.has(REFRESH_OPCODES.progress),
        `opcodes=${JSON.stringify(Array.from(changedOpcodes))}`,
      );
      assert(
        "刷新帧 reason 携带 repair:foreground_restore",
        changedFrames.some((frame) => String((frame.payload as { reason?: string } | undefined)?.reason || "")
          .startsWith("repair:foreground_restore")),
        `reasons=${JSON.stringify(changedFrames.map((frame) => String((frame.payload as { reason?: string } | undefined)?.reason || "")))}`,
      );
      assert(
        "资产变更刷新帧携带变更内容",
        changedFrames.some((frame) => {
          const payload = frame.payload as { currencies?: Record<string, number> } | undefined;
          return Number(payload?.currencies?.spirit_stone || 0) === 1888;
        }) && changedFrames.some((frame) => {
          const payload = frame.payload as { changedItemIds?: string[] } | undefined;
          return (payload?.changedItemIds || []).includes("herb_bot_01");
        }),
        `assetRepair ack=${assetRepair.ack.accepted} 帧数=${changedFrames.length}`,
      );

      // 再补两次 repair，确认资产变更消费完后不会重复下发。
      const drainRepair = await assetBot.sendRepair("foreground_restore", "drain");
      assert(
        "资产变更消费完后 repair 不再重复下发（幂等）",
        drainRepair.refreshFrames.length === 0,
        `刷新帧数=${drainRepair.refreshFrames.length}`,
      );
    } finally {
      await assetBot.leave();
    }
  }
}

resetPlayerRefreshDigests();

await withGameServerEndpoint(
  process.env.GAME_LOAD_TARGET_URL?.trim() || null,
  async (endpoint) => {
  console.log(`[bot] game-server endpoint=${endpoint}`);
  await runScenarios(endpoint);
});

const stats = getPlayerRefreshDigestStats();
console.log(`[bot] digest stats=${JSON.stringify(stats)}`);

const failed = assertions.filter((item) => !item.ok);
console.log(JSON.stringify({
  scenario: "system-d-offline-repair",
  total: assertions.length,
  passed: assertions.length - failed.length,
  failed: failed.length,
  failures: failed.map((item) => ({ name: item.name, detail: item.detail })),
}, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
