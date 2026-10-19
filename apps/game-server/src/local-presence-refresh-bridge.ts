import {
  deliverStateRefreshPayload,
  STATE_REFRESH_TOPIC,
} from "./state-refresh-endpoint";

/**
 * 单实例（无 Redis）状态刷新帧投递补挂。
 *
 * 问题：无 Redis 时 Colyseus 的 presence 是 LocalPresence，而 LocalPresence
 * 只有在 `server.listen()` 之后才被创建。`createGameServer()` 里的订阅发生在
 * listen 之前，会静默落空，结果 `/internal/state-refresh` 只广播不投递：
 * 客户端是纯渲染端，于是界面停在旧值。
 *
 * 本文件在 listen 之后补挂订阅，保证本地单实例开发 / 冒烟也能收到刷新帧。
 * 多实例（RedisPresence）由 createGameServer 里的订阅负责，这里不重复挂，
 * 否则同一份帧会被投递两次。
 */

const bridged = new WeakSet<object>();

export function ensureLocalPresenceStateRefreshBridge(gameServer: {
  ensureStateRefreshSubscription?: () => boolean;
  config?: { redisUrl?: string };
  server?: unknown;
}): boolean {
  if (!gameServer) {
    return false;
  }
  // 地基已在 listen 之后提供统一订阅入口，直接委托，避免两处各挂一次导致重复投递。
  if (typeof gameServer.ensureStateRefreshSubscription === "function") {
    return gameServer.ensureStateRefreshSubscription();
  }
  // 兼容旧 gameServer 形状（无委托入口）时的兜底。
  if (gameServer.config?.redisUrl) {
    return false;
  }
  const server = gameServer.server as {
    presence?: {
      subscribe?: (topic: string, callback: (payload: unknown) => void) => unknown;
    };
  } | undefined;
  const presence = server?.presence;
  if (!presence?.subscribe || typeof presence.subscribe !== "function") {
    return false;
  }
  const key = presence as unknown as object;
  if (bridged.has(key)) {
    return false;
  }
  bridged.add(key);
  presence.subscribe(STATE_REFRESH_TOPIC, (payload: unknown) => {
    deliverStateRefreshPayload(payload);
  });
  return true;
}
