/**
 * 附近频道边界 BotClient 场景断言（P2-A）。
 *
 * 本地可跑，不依赖 DB / Redis：`GAME_SERVER_AUTH_MODE` 缺省为 optional，
 * `REDIS_URL` 缺省时 game-server 单机启动。
 *
 * 运行：
 *   bun run apps/game-server/src/bot/system-b-nearby-chat.ts
 *
 * 覆盖：
 *  1. 一条附近消息只在客户端渲染一次（收到帧数 vs 去重后条数）
 *  2. 持久化 API 回灌与房间广播不产生重复
 *  3. 成员进出收到 social_event(10202)，成员变化后进度帧 12742 到达
 *  4. 重连后 replay 不重复刷屏
 */

import fs from "node:fs";
import path from "node:path";
import type { Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  type AnyStateRefreshEnvelope,
  type RealtimeInputAck,
  type SocialPresenceEnvelope,
} from "@immortality/shared-protocol";
import {
  NEARBY_CHAT_ECHO_MESSAGE_TYPE,
  resolveNearbyChatRenderKey,
  type NearbyChatEchoFrame,
} from "../rooms/nearby-chat-echo";
import { createLoadClient, waitForRoomMessage, withGameServerEndpoint } from "../load-utils";

const MAP_ID = "bot-nearby-map";
const SHARD_ID = "0";
const ACK_TIMEOUT_MS = 5000;
const SETTLE_MS = 600;

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

interface BotClient {
  playerId: string;
  room: ColyseusSdkRoom;
  echoes: NearbyChatEchoFrame[];
  socialEvents: Array<{ type: string; envelope: SocialPresenceEnvelope }>;
  progressFrames: AnyStateRefreshEnvelope[];
  otherFrames: AnyStateRefreshEnvelope[];
  nextSequence: () => number;
  sendNearbyMessage: (payload: Record<string, unknown>) => Promise<RealtimeInputAck>;
  sendRepair: () => Promise<RealtimeInputAck>;
  leave: () => Promise<void>;
}

async function joinSocialBot(endpoint: string, playerId: string): Promise<BotClient> {
  const client = createLoadClient(endpoint);
  const room = await client.joinOrCreate(GAME_ROOM_NAMES.social, {
    playerId,
    mapId: MAP_ID,
    shardId: SHARD_ID,
  });

  const bot: BotClient = {
    playerId,
    room,
    echoes: [],
    socialEvents: [],
    progressFrames: [],
    otherFrames: [],
    nextSequence: (() => {
      let sequence = 0;
      return () => {
        sequence += 1;
        return sequence;
      };
    })(),
    async sendNearbyMessage(payload) {
      const clientSequence = bot.nextSequence();
      const ackPromise = waitForRoomMessage<RealtimeInputAck>(
        room,
        "ack",
        (ack) => ack.acceptedSequence === clientSequence && ack.inputType === "nearbyMessage",
        ACK_TIMEOUT_MS,
      );
      room.send("input", createRealtimeClientInput({
        clientSequence,
        clientSceneTick: 0,
        actionId: `${playerId}-nearby-${clientSequence}`,
        clientSentAt: Date.now(),
        inputType: "nearbyMessage",
        payload,
      }));
      return ackPromise;
    },
    async sendRepair() {
      const clientSequence = bot.nextSequence();
      const ackPromise = waitForRoomMessage<RealtimeInputAck>(
        room,
        "ack",
        (ack) => ack.acceptedSequence === clientSequence && ack.inputType === "repair",
        ACK_TIMEOUT_MS,
      );
      room.send("input", createRealtimeClientInput({
        clientSequence,
        clientSceneTick: 0,
        actionId: `${playerId}-repair-${clientSequence}`,
        clientSentAt: Date.now(),
        inputType: "repair",
        payload: { trigger: "reconnect", reason: "social_room_reconnect" },
      }));
      return ackPromise;
    },
    async leave() {
      await room.leave(true);
    },
  };

  room.onMessage<NearbyChatEchoFrame>(NEARBY_CHAT_ECHO_MESSAGE_TYPE, (frame) => {
    bot.echoes.push(frame);
  });
  room.onMessage<SocialPresenceEnvelope>("social_event", (envelope) => {
    for (const event of envelope.events || []) {
      bot.socialEvents.push({ type: event.type, envelope });
    }
  });
  room.onMessage<AnyStateRefreshEnvelope>("progress_refresh", (frame) => {
    bot.progressFrames.push(frame);
  });
  room.onMessage<AnyStateRefreshEnvelope>("inventory_refresh", (frame) => {
    bot.otherFrames.push(frame);
  });
  room.onMessage<AnyStateRefreshEnvelope>("asset_refresh", (frame) => {
    bot.otherFrames.push(frame);
  });

  return bot;
}

/** 模拟客户端渲染去重：同一渲染键只渲染一次。 */
function dedupeRenderKeys(keys: Array<string | null>) {
  const rendered: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    rendered.push(key);
  }
  return rendered;
}

function progressScopes(frame: AnyStateRefreshEnvelope): string[] {
  const payload = frame.payload as { scopes?: string[] } | undefined;
  return Array.isArray(payload?.scopes) ? payload.scopes : [];
}

function progressReason(frame: AnyStateRefreshEnvelope): string {
  const payload = frame.payload as { reason?: string } | undefined;
  return String(payload?.reason || "");
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

function resolveRepoRoot() {
  const candidates = [
    // apps/game-server/src/bot -> 仓库根
    path.resolve(import.meta.dir, "..", "..", "..", ".."),
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src", "modules"))) {
      return candidate;
    }
  }
  return candidates[0];
}

/** 校验客户端镜像契约文件没有与服务端漂移。 */
export function assertClientContractMirror() {
  const relativePath = "src/modules/social/realtime/nearby-chat-echo.ts";
  const absolutePath = path.resolve(resolveRepoRoot(), relativePath);
  if (!fs.existsSync(absolutePath)) {
    assert("客户端回声契约镜像存在", false, `缺少 ${relativePath}`);
    return;
  }

  const text = fs.readFileSync(absolutePath, "utf8");
  const required = [
    `NEARBY_CHAT_ECHO_MESSAGE_TYPE = "${NEARBY_CHAT_ECHO_MESSAGE_TYPE}"`,
    'NEARBY_ACTIVITY_PROGRESS_SCOPE = "activity"',
    'message: "nearby_message"',
    'memberChanged: "nearby_member_changed"',
    'replay: "nearby_replay"',
    "roomMessageId",
  ];
  const missing = required.filter((fragment) => !text.includes(fragment));
  assert(
    "客户端回声契约镜像与服务端一致",
    missing.length === 0,
    missing.length === 0 ? "帧名 / scope / reason / 字段全部对齐" : `缺少: ${missing.join(", ")}`,
  );
}

export async function runScenarios(endpoint: string) {
  const sender = await joinSocialBot(endpoint, "bot-sender");
  const observer = await joinSocialBot(endpoint, "bot-observer");

  try {
    await sleep(SETTLE_MS);

    // ---------- 场景 1 / 2：一条消息只渲染一次 + 持久化与广播不重复 ----------
    const persistedMessageId = 90001;
    const dedupeKey = "bot-sender:cm-0001";
    const content = "附近频道边界验证消息";

    // 客户端真实链路：先 POST 核心 API 持久化（这里用持久化结果模拟），
    // 再让 SocialRoom 发同图广播回声。两条链路必须落到同一个渲染键。
    const persistedRenderKey = resolveNearbyChatRenderKey({
      dedupeKey,
      messageId: persistedMessageId,
    });
    const ack = await sender.sendNearbyMessage({
      message: content,
      messageId: persistedMessageId,
      dedupeKey,
    });

    assert("附近消息输入被房间接受", ack.accepted === true, `ack=${JSON.stringify(ack)}`);

    await waitFor(() => observer.echoes.length >= 1, ACK_TIMEOUT_MS, "observer echo");
    await sleep(SETTLE_MS);

    const matchingEchoes = observer.echoes.filter((echo) => echo.dedupeKey === dedupeKey);
    assert(
      "房间对同一条消息只广播一次回声",
      matchingEchoes.length === 1,
      `收到 ${matchingEchoes.length} 条回声（期望 1）`,
    );
    assert(
      "回声携带持久化 messageId 与 dedupeKey",
      matchingEchoes[0]?.messageId === persistedMessageId && matchingEchoes[0]?.dedupeKey === dedupeKey,
      `echo=${JSON.stringify(matchingEchoes[0] || null)}`,
    );
    assert(
      "房间不再用 social_event.nearby_message 重复广播",
      observer.socialEvents.filter((item) => item.type === "nearby_message").length === 0,
      `social_event nearby_message 计数=${observer.socialEvents.filter((item) => item.type === "nearby_message").length}`,
    );

    // 模拟客户端：SSE 回灌一条 + 房间回声一条，去重后应只剩一条。
    const echoRenderKey = resolveNearbyChatRenderKey({
      dedupeKey: matchingEchoes[0]?.dedupeKey ?? null,
      messageId: matchingEchoes[0]?.messageId ?? null,
      roomMessageId: matchingEchoes[0]?.roomMessageId ?? null,
    });
    const framesReceived = 2;
    const rendered = dedupeRenderKeys([persistedRenderKey, echoRenderKey]);
    assert(
      "一条附近消息只在客户端渲染一次",
      rendered.length === 1 && persistedRenderKey === echoRenderKey,
      `收到帧数=${framesReceived} 去重后条数=${rendered.length} 键=${String(persistedRenderKey)}`,
    );

    // 两条不同消息必须落在两个不同渲染键，证明去重没有过度合并。
    const secondAck = await sender.sendNearbyMessage({
      message: "第二条附近消息",
      messageId: 90002,
      dedupeKey: "bot-sender:cm-0002",
    });
    await waitFor(() => observer.echoes.length >= 2, ACK_TIMEOUT_MS, "second echo");
    await sleep(SETTLE_MS);
    const secondEcho = observer.echoes.find((echo) => echo.dedupeKey === "bot-sender:cm-0002");
    const secondRenderKey = resolveNearbyChatRenderKey({
      dedupeKey: secondEcho?.dedupeKey ?? null,
      messageId: secondEcho?.messageId ?? null,
      roomMessageId: secondEcho?.roomMessageId ?? null,
    });
    assert(
      "不同消息渲染键互不相同",
      Boolean(secondRenderKey) && secondRenderKey !== persistedRenderKey,
      `第二键=${String(secondRenderKey)}，第二 ack=${secondAck.accepted}`,
    );

    // ---------- 场景 3：成员进出 -> social_event(10202) + 进度帧 12742 ----------
    const progressBefore = observer.progressFrames.length;
    const socialEventsBefore = observer.socialEvents.length;

    const joiner = await joinSocialBot(endpoint, "bot-joiner");
    await waitFor(
      () => observer.socialEvents.some((item) => item.type === "presence_join"),
      ACK_TIMEOUT_MS,
      "presence_join",
    );
    await waitFor(
      () => observer.progressFrames.length > progressBefore,
      ACK_TIMEOUT_MS,
      "member join progress frame",
    );
    await sleep(SETTLE_MS);

    const joinEvents = observer.socialEvents.slice(socialEventsBefore).filter((item) => item.type === "presence_join");
    assert(
      "成员加入收到 social_event(10202) presence_join",
      joinEvents.length >= 1,
      `presence_join 计数=${joinEvents.length}（social_event opcode=${REALTIME_OPCODE_BY_OUTPUT_TYPE.social_event}）`,
    );

    const joinProgress = observer.progressFrames.slice(progressBefore);
    assert(
      "成员加入后进度帧 12742 到达",
      joinProgress.some((frame) => frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh),
      `progress_refresh 计数=${joinProgress.length} opcode=${REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh}`,
    );
    assert(
      "成员变化进度帧 scopes 含 activity",
      joinProgress.some((frame) => progressScopes(frame).includes("activity")),
      `scopes=${JSON.stringify(joinProgress.map((frame) => progressScopes(frame)))}`,
    );
    assert(
      "成员变化进度帧 reason=nearby_member_changed",
      joinProgress.some((frame) => progressReason(frame) === "nearby_member_changed"),
      `reasons=${JSON.stringify(joinProgress.map((frame) => progressReason(frame)))}`,
    );

    const progressBeforeLeave = observer.progressFrames.length;
    await joiner.leave();
    await waitFor(
      () => observer.socialEvents.some((item) => item.type === "presence_leave"),
      ACK_TIMEOUT_MS,
      "presence_leave",
    );
    await waitFor(
      () => observer.progressFrames.length > progressBeforeLeave,
      ACK_TIMEOUT_MS,
      "member leave progress frame",
    );
    await sleep(SETTLE_MS);

    const leaveProgress = observer.progressFrames.slice(progressBeforeLeave);
    assert(
      "成员离开后进度帧 12742 到达",
      leaveProgress.some((frame) => frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh),
      `progress_refresh 计数=${leaveProgress.length}`,
    );
    assert(
      "成员离开不伪造背包 / 资产刷新帧",
      observer.otherFrames.length === 0,
      `inventory/asset 帧计数=${observer.otherFrames.length}`,
    );

    // ---------- 场景 4：重连 replay 不重复刷屏 ----------
    const replayProgressBefore = sender.progressFrames.length;
    const repairAck = await sender.sendRepair();
    assert("repair 输入被接受", repairAck.accepted === true, `ack=${JSON.stringify(repairAck)}`);
    await waitFor(
      () => sender.progressFrames.length > replayProgressBefore,
      ACK_TIMEOUT_MS,
      "replay progress frame",
    );
    await sleep(SETTLE_MS);

    const replayFrames = sender.progressFrames.slice(replayProgressBefore);
    assert(
      "重连 repair 下发 progress_refresh(12742) 而不是只回 ACK",
      replayFrames.some((frame) => frame.opcode === REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh),
      `replay 帧计数=${replayFrames.length}`,
    );
    assert(
      "重连 replay reason=nearby_replay",
      replayFrames.some((frame) => progressReason(frame) === "nearby_replay"),
      `reasons=${JSON.stringify(replayFrames.map((frame) => progressReason(frame)))}`,
    );

    // 模拟锁屏回来：SSE 整段历史重灌两次 + 房间回声一次，去重后仍只渲染一条。
    const replayRendered = dedupeRenderKeys([
      resolveNearbyChatRenderKey({ dedupeKey, messageId: persistedMessageId }),
      resolveNearbyChatRenderKey({ dedupeKey, messageId: persistedMessageId }),
      echoRenderKey,
      resolveNearbyChatRenderKey({ dedupeKey: "bot-sender:cm-0002", messageId: 90002 }),
    ]);
    assert(
      "重连 replay 不重复刷屏",
      replayRendered.length === 2,
      `重灌 4 帧去重后=${replayRendered.length}（期望 2 条真实消息）`,
    );
  } finally {
    await sender.leave();
    await observer.leave();
  }
}

export function getAssertions() {
  return assertions.map((item) => ({ ...item }));
}

export function reportAndExit() {
  const failed = assertions.filter((item) => !item.ok);
  console.log(JSON.stringify({
    scenario: "system-b-nearby-chat",
    total: assertions.length,
    passed: assertions.length - failed.length,
    failed: failed.length,
    failures: failed.map((item) => ({ name: item.name, detail: item.detail })),
  }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

// 直接 `bun run` 本文件时自建本地 game-server（无需 DB / Redis）；
// 被其它 harness import 时不自动执行。
if (import.meta.main) {
  await withGameServerEndpoint(null, async (endpoint) => {
    console.log(`[bot] game-server endpoint=${endpoint}`);
    assertClientContractMirror();
    await runScenarios(endpoint);
  });
  reportAndExit();
  // 本地 game-server / SDK 可能残留长连接句柄，断言完成后直接退出。
  process.exit(process.exitCode ?? 0);
}
