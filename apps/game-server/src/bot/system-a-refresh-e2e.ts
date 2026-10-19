/**
 * 系统A · 战斗刷新帧端到端断言（真实 game-server + SDK，不需要 DB）。
 *
 * 与 `system-a-combat-refresh.ts` 的区别：那个脚本依赖 `pending_combat` 会话
 * hydrate，本地无 DB 时房间走 fallback runtime，command 一律被拒，只能 SKIP。
 * 本脚本只验证 P1-B 里最硬的那条契约——
 *
 *   落账变更 → 推对应刷新帧 → 客户端真的收到（不是只回 ACK）
 *
 * 这条链路不经过战斗 runtime，因此在无 DB / 无 Redis 的单实例下也能真跑、真断言。
 */

import { Client, type Room as ColyseusSdkRoom } from "@colyseus/sdk";
import {
  createStateRefreshFrameGroup,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
} from "@immortality/shared-protocol";
import { createGameServer } from "../server";
import { GAME_ROOM_NAMES } from "@immortality/shared-protocol";

const OPCODE_INVENTORY = REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh;
const OPCODE_ASSET = REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh;
const OPCODE_PROGRESS = REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh;

interface CapturedFrame {
  opcode: number;
  type: string;
  payload: Record<string, unknown>;
}

const results: Array<{ name: string; passed: boolean; detail: string }> = [];

function assert(name: string, condition: boolean, detail = "") {
  results.push({ name, passed: condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  return predicate();
}

async function postStateRefresh(
  port: number,
  playerId: string,
  frames: ReturnType<typeof createStateRefreshFrameGroup>,
) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/state-refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, frames }),
  });
  return response.status;
}

async function main() {
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const gameServer = createGameServer();
  await gameServer.listen();
  const port = gameServer.config.port;
  const client = new Client(`ws://127.0.0.1:${port}`);
  const playerId = "system-a-e2e-player";

  let room: ColyseusSdkRoom | null = null;
  const frames: CapturedFrame[] = [];

  try {
    room = await client.joinOrCreate(GAME_ROOM_NAMES.combat, {
      playerId,
      combatId: "system-a-e2e-combat",
    });

    for (const type of ["inventory_refresh", "asset_refresh", "progress_refresh"]) {
      room.onMessage(type, (payload: unknown) => {
        const frame = payload as { opcode?: number; type?: string; payload?: Record<string, unknown> };
        frames.push({
          opcode: Number(frame?.opcode || 0),
          type: String(frame?.type || type),
          payload: (frame?.payload || {}) as Record<string, unknown>,
        });
      });
    }

    assert("BotClient 能 join 战斗房间", Boolean(room?.roomId), `roomId=${room?.roomId}`);

    // 1. 丹药消耗落账 -> 10302
    const itemFrames = createStateRefreshFrameGroup({
      playerId,
      reason: "combat_item_used",
      inventory: { changedItemIds: ["pill-recovery-1"] },
    });
    const itemStatus = await postStateRefresh(port, playerId, itemFrames);
    assert("丹药落账端点接受帧组", itemStatus === 200, `http=${itemStatus}`);

    const gotInventory = await waitFor(
      () => frames.some((frame) => frame.opcode === OPCODE_INVENTORY),
    );
    assert("丹药落账后客户端收到 inventory_refresh(10302)", gotInventory);
    const inventoryFrame = frames.find((frame) => frame.opcode === OPCODE_INVENTORY);
    assert(
      "10302 帧 changedItemIds 含被消耗丹药",
      JSON.stringify(inventoryFrame?.payload?.changedItemIds || []).includes("pill-recovery-1"),
      `changedItemIds=${JSON.stringify(inventoryFrame?.payload?.changedItemIds || [])}`,
    );
    assert(
      "10302 帧 reason=combat_item_used",
      inventoryFrame?.payload?.reason === "combat_item_used",
      `reason=${String(inventoryFrame?.payload?.reason)}`,
    );

    // 2. 战斗结算落账 -> 10510 + 12742
    frames.length = 0;
    const rewardFrames = createStateRefreshFrameGroup({
      playerId,
      reason: "combat_reward_settled",
      asset: { currencies: { spiritStone: 120 } },
      progress: { scopes: ["cultivation", "realm", "quest"] },
    });
    await postStateRefresh(port, playerId, rewardFrames);

    assert(
      "战斗结算后客户端收到 asset_refresh(10510)",
      await waitFor(() => frames.some((frame) => frame.opcode === OPCODE_ASSET)),
    );
    assert(
      "战斗结算后客户端收到 progress_refresh(12742)",
      await waitFor(() => frames.some((frame) => frame.opcode === OPCODE_PROGRESS)),
    );
    const progressFrame = frames.find((frame) => frame.opcode === OPCODE_PROGRESS);
    const scopes = JSON.stringify(progressFrame?.payload?.scopes || []);
    assert(
      "12742 帧 scopes 含 cultivation/realm/quest",
      ["cultivation", "realm", "quest"].every((scope) => scopes.includes(scope)),
      `scopes=${scopes}`,
    );

    // 3. 不推帧就不该有帧：静默窗口内不应凭空出现刷新帧
    frames.length = 0;
    await sleep(600);
    assert("未落账时不下发任何刷新帧", frames.length === 0, `frames=${frames.length}`);
  } finally {
    if (room) {
      await room.leave(true).catch(() => undefined);
    }
    await gameServer.shutdown().catch(() => undefined);
  }

  const passed = results.filter((item) => item.passed).length;
  const failed = results.length - passed;
  console.log(JSON.stringify({
    scenario: "system-a-refresh-e2e",
    total: results.length,
    passed,
    failed,
    failures: results.filter((item) => !item.passed).map((item) => item.name),
  }, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
