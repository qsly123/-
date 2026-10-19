import { createGameServer } from "./server";
import { ensureLocalPresenceStateRefreshBridge } from "./local-presence-refresh-bridge";

const gameServer = createGameServer();

await gameServer.listen();

// 无 Redis 单实例时 LocalPresence 在 listen 之后才存在，这里补挂刷新帧订阅。
ensureLocalPresenceStateRefreshBridge(gameServer);

async function shutdown(signal: string) {
  console.log(`[game-server] received ${signal}, shutting down...`);
  await gameServer.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
