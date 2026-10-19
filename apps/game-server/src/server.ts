import { createServer } from "node:http";
import { Server, createEndpoint, createRouter } from "colyseus";
import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import { GAME_ROOM_NAMES, GAME_SERVER_PROTOCOL_VERSION, type GameServerHealth } from "@immortality/shared-protocol";
import { loadGameServerConfig, type GameServerConfig } from "./config";
import { SameCoreWebSocketTransport } from "./colyseus-same-core-websocket-transport";
import { BossRoom, CombatRoom, PvpRoom, SecretRealmRoom, SocialRoom, WorldMapRoom } from "./rooms";
import { getGameServerRoomRuntimeSnapshots, getGameServerRuntimeMetrics } from "./metrics";
import { assertRedisConnectionReady, measureRedisConnectionHealth } from "./redis-preflight";
import {
  createStateRefreshEndpoint,
  deliverStateRefreshPayload,
  STATE_REFRESH_TOPIC,
} from "./state-refresh-endpoint";

const HEALTH_ROOM_INSTANCES_LIMIT = 25;

function createHealthBodyFactory(config: GameServerConfig) {
  const startedAt = Date.now();

  return async () => {
    const roomInstances = getGameServerRoomRuntimeSnapshots();
    const metrics = getGameServerRuntimeMetrics();
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const truncated = roomInstances.length > HEALTH_ROOM_INSTANCES_LIMIT;
    const visibleRoomInstances = roomInstances.slice(0, HEALTH_ROOM_INSTANCES_LIMIT);
    return {
      ok: true,
      service: "game-server",
      protocolVersion: GAME_SERVER_PROTOCOL_VERSION,
      processId: config.processId,
      uptimeSeconds,
      rooms: config.rooms,
      roomInstancesTotal: roomInstances.length,
      roomInstancesTruncated: truncated,
      roomInstances: visibleRoomInstances,
      processes: [{
        processId: config.processId,
        uptimeSeconds,
        roomInstancesTotal: roomInstances.length,
        roomInstancesTruncated: truncated,
        roomInstances: visibleRoomInstances,
        metrics,
      }],
      redisEnabled: Boolean(config.redisUrl),
      redis: await measureRedisConnectionHealth(config.redisUrl),
      metrics,
    } satisfies GameServerHealth;
  };
}

function createJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function waitForGracefulShutdown(
  shutdown: Promise<void>,
  timeoutMs: number,
) {
  return await new Promise<"done" | "timeout">((resolve) => {
    const timeout = setTimeout(() => resolve("timeout"), timeoutMs);
    shutdown
      .then(() => {
        clearTimeout(timeout);
        resolve("done");
      })
      .catch((error) => {
        clearTimeout(timeout);
        console.warn("[game-server] graceful shutdown failed", error);
        resolve("done");
      });
  });
}

export function createGameServer(config = loadGameServerConfig()) {
  const httpServer = createServer();
  const transport = new SameCoreWebSocketTransport({ server: httpServer });
  const getHealthBody = createHealthBodyFactory(config);

  const server = new Server({
    transport,
    publicAddress: config.publicAddress,
    greet: false,
    ...(config.redisUrl
      ? {
        presence: new RedisPresence(config.redisUrl),
        driver: new RedisDriver(config.redisUrl),
      }
      : {}),
  });
  const publishStateRefresh = (payload: unknown) => {
    const presence = (server as unknown as {
      presence?: { publish?: (topic: string, data: unknown) => unknown };
    }).presence;
    if (!presence?.publish) {
      return;
    }
    try {
      void presence.publish(STATE_REFRESH_TOPIC, payload);
    } catch (error) {
      console.error("[game-server] state refresh publish failed", {
        logCategory: "game-server.state_refresh.publish_failed",
        error,
      });
    }
  };

  // 订阅必须在 listen 之后：无 Redis 时 presence 是 LocalPresence，
  // 只有 server.listen() 才会创建它，构造期订阅会静默落空（只广播不投递）。
  let stateRefreshSubscribed = false;
  function ensureStateRefreshSubscription(): boolean {
    if (stateRefreshSubscribed) {
      return true;
    }
    const presence = (server as unknown as {
      presence?: { subscribe?: (topic: string, callback: (payload: unknown) => void) => unknown };
    }).presence;
    if (!presence?.subscribe) {
      return false;
    }
    stateRefreshSubscribed = true;
    void presence.subscribe(STATE_REFRESH_TOPIC, (payload: unknown) => {
      deliverStateRefreshPayload(payload);
    });
    return true;
  }

  server.router = createRouter({
    health: createEndpoint("/health", { method: "GET" }, async () => createJsonResponse(await getHealthBody())),
    gameServerHealth: createEndpoint("/game-server/health", { method: "GET" }, async () => createJsonResponse(await getHealthBody())),
    stateRefresh: createStateRefreshEndpoint({
      token: process.env.GAME_SERVER_INTERNAL_TOKEN,
      // 本实例已在上面直接投递，这里只广播给其他实例。
      publish: (payload) => publishStateRefresh(payload),
    }),
  });

  server.define(GAME_ROOM_NAMES.worldMap, WorldMapRoom).filterBy(["mapId", "shardId"]);
  server.define(GAME_ROOM_NAMES.secretRealm, SecretRealmRoom).filterBy(["mapId", "shardId", "partyId"]);
  server.define(GAME_ROOM_NAMES.combat, CombatRoom).filterBy(["combatId", "partyId"]);
  server.define(GAME_ROOM_NAMES.boss, BossRoom).filterBy(["combatId"]);
  server.define(GAME_ROOM_NAMES.pvp, PvpRoom).filterBy(["combatId"]);
  server.define(GAME_ROOM_NAMES.social, SocialRoom).filterBy(["mapId", "shardId", "partyId", "sectId"]);

  return {
    config,
    httpServer,
    server,
    ensureStateRefreshSubscription,
    async listen() {
      await assertRedisConnectionReady(config.redisUrl);
      await server.listen(config.port, config.host);
      ensureStateRefreshSubscription();
      console.log(`[game-server] listening on ${config.host}:${config.port} redis=${config.redisUrl ? "on" : "off"}`);
    },
    async shutdown() {
      const shutdownResult = await waitForGracefulShutdown(server.gracefullyShutdown(false), 3000);
      if (shutdownResult === "timeout") {
        console.warn("[game-server] graceful shutdown timed out, forcing transport close");
        transport.shutdown();
      }
    },
  };
}
