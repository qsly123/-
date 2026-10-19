import { Client as ColyseusSdkClient, type Room as ColyseusSdkRoom } from "@colyseus/sdk";
import { RedisDriver } from "@colyseus/redis-driver";
import { GAME_ROOM_NAMES } from "@immortality/shared-protocol";

interface SpawnedGameServer {
  name: string;
  port: number;
  process: ReturnType<typeof Bun.spawn>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePort(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function createEndpoint(port: number) {
  return `ws://127.0.0.1:${port}`;
}

async function waitForHealth(port: number, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/game-server/health`);
      if (response.ok) {
        const body = await response.json() as { ok?: boolean; redisEnabled?: boolean };
        if (body.ok && body.redisEnabled) {
          return body;
        }
        lastError = `health not ready: ${JSON.stringify(body)}`;
      } else {
        lastError = `health status ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await Bun.sleep(150);
  }

  throw new Error(`game-server health timed out on port ${port}: ${lastError}`);
}

function spawnGameServer(params: {
  name: string;
  port: number;
  redisUrl: string;
}) {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", "src/index.ts"],
    cwd: import.meta.dir.replace(/\\src$/, "").replace(/\/src$/, ""),
    env: {
      ...process.env,
      GAME_SERVER_HOST: "127.0.0.1",
      GAME_SERVER_PORT: String(params.port),
      GAME_SERVER_PUBLIC_ADDRESS: `127.0.0.1:${params.port}`,
      GAME_SERVER_AUTH_MODE: "optional",
      GAME_SERVER_PROCESS_ID: params.name,
      REDIS_URL: params.redisUrl,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  return {
    name: params.name,
    port: params.port,
    process: child,
  } satisfies SpawnedGameServer;
}

async function shutdownGameServer(server: SpawnedGameServer) {
  server.process.kill("SIGTERM");
  await Promise.race([
    server.process.exited,
    Bun.sleep(3000),
  ]);
}

async function leaveRoom(room: ColyseusSdkRoom | null) {
  try {
    await room?.leave();
  } catch {
    // best-effort cleanup for smoke rooms
  }
}

const redisUrl = process.env.REDIS_URL?.trim();
assert(redisUrl, "REDIS_URL is required for game:smoke:redis-multi");

const portA = parsePort("GAME_SMOKE_REDIS_MULTI_PORT_A", 3211);
const portB = parsePort("GAME_SMOKE_REDIS_MULTI_PORT_B", 3212);
assert(portA !== portB, "redis multi smoke requires two different ports");

const serverA = spawnGameServer({
  name: `redis-multi-a-${Date.now()}`,
  port: portA,
  redisUrl,
});
const serverB = spawnGameServer({
  name: `redis-multi-b-${Date.now()}`,
  port: portB,
  redisUrl,
});
const redisDriver = new RedisDriver(redisUrl);
let roomA: ColyseusSdkRoom | null = null;
let roomViaB: ColyseusSdkRoom | null = null;

try {
  await Promise.all([
    waitForHealth(portA),
    waitForHealth(portB),
  ]);

  const clientA = new ColyseusSdkClient(createEndpoint(portA));
  roomA = await clientA.joinOrCreate(GAME_ROOM_NAMES.worldMap, {
    mapId: `redis-multi-smoke-${Date.now()}`,
    shardId: "0",
    playerId: "redis-multi-player-a",
  });

  const queriedRoom = await redisDriver.findOne({
    roomId: roomA.roomId,
  });
  assert(queriedRoom?.roomId === roomA.roomId, "RedisDriver must find room created by instance A");
  assert(queriedRoom.name === GAME_ROOM_NAMES.worldMap, "queried room must keep world_map name");

  const clientB = new ColyseusSdkClient(createEndpoint(portB));
  roomViaB = await clientB.joinById(roomA.roomId, {
    playerId: "redis-multi-player-b",
  });
  assert(roomViaB.roomId === roomA.roomId, "instance B must join room created by instance A via Redis driver/presence");

  const rooms = await redisDriver.query({
    name: GAME_ROOM_NAMES.worldMap,
  });
  assert(
    rooms.some((room) => room.roomId === roomA?.roomId),
    "RedisDriver query must include the shared world_map room",
  );

  console.log(JSON.stringify({
    ok: true,
    scenario: "redis_multi_instance_room_query",
    portA,
    portB,
    roomId: roomA.roomId,
    queriedRooms: rooms.length,
  }, null, 2));
} finally {
  await leaveRoom(roomViaB);
  await leaveRoom(roomA);
  await redisDriver.shutdown();
  await Promise.all([
    shutdownGameServer(serverA),
    shutdownGameServer(serverB),
  ]);
}
