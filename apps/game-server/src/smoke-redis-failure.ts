import { assertRedisConnectionReady } from "./redis-preflight";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

let failedAsExpected = false;

try {
  await assertRedisConnectionReady(
    process.env.GAME_SMOKE_BAD_REDIS_URL || "redis://127.0.0.1:1",
    { timeoutMs: 500 },
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failedAsExpected = message.includes("game_server_redis_unavailable");
  if (!failedAsExpected) {
    throw error;
  }
  console.log(JSON.stringify({
    ok: true,
    scenario: "redis_failure_preflight",
    message,
  }, null, 2));
}

assert(failedAsExpected, "game-server must fail explicitly when REDIS_URL is unreachable");
