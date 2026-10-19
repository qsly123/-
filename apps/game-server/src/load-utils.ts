import { Client as ColyseusSdkClient, type Room as ColyseusSdkRoom } from "@colyseus/sdk";
import { loadGameServerConfig } from "./config";
import { createGameServer } from "./server";

export interface LoadCommonConfig {
  targetUrl: string | null;
  totalConnections: number;
  concurrency: number;
  timeoutMs: number;
  mapId: string;
  shardId: string;
}

export interface LoadFailure {
  index: number;
  message: string;
}

export function parsePositiveIntEnv(name: string, fallback: number, min = 1) {
  const raw = process.env[name];
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

export function loadCommonConfig(defaultConnections: number): LoadCommonConfig {
  const totalConnections = parsePositiveIntEnv("GAME_LOAD_CONNECTIONS", defaultConnections);
  return {
    targetUrl: process.env.GAME_LOAD_TARGET_URL?.trim() || null,
    totalConnections,
    concurrency: Math.min(
      parsePositiveIntEnv("GAME_LOAD_CONCURRENCY", Math.min(5, totalConnections)),
      totalConnections,
    ),
    timeoutMs: parsePositiveIntEnv("GAME_LOAD_TIMEOUT_MS", 5000, 500),
    mapId: process.env.GAME_LOAD_MAP_ID?.trim() || "load-map",
    shardId: process.env.GAME_LOAD_SHARD_ID?.trim() || "0",
  };
}

export function percentile(values: number[], rate: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * rate) - 1),
  );
  return sorted[index] || 0;
}

export function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function createLatencyStats(values: number[]) {
  return {
    avg: average(values),
    p95: percentile(values, 0.95),
  };
}

export function waitForRoomMessage<TPayload>(
  room: ColyseusSdkRoom,
  type: string,
  predicate: (payload: TPayload) => boolean,
  timeoutMs: number,
) {
  return new Promise<TPayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);

    const unsubscribe = room.onMessage<TPayload>(type, (payload) => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload);
    });
  });
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runPool<TSample>(
  config: Pick<LoadCommonConfig, "totalConnections" | "concurrency">,
  runVirtualClient: (index: number) => Promise<TSample>,
) {
  const samples: TSample[] = [];
  const failures: LoadFailure[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < config.totalConnections) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        samples.push(await runVirtualClient(index));
      } catch (error) {
        failures.push({
          index,
          message: toErrorMessage(error),
        });
      }
    }
  }

  await Promise.all(Array.from(
    { length: config.concurrency },
    () => worker(),
  ));

  return { samples, failures };
}

export async function fetchHealth(endpoint: string) {
  const httpEndpoint = endpoint.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  const response = await fetch(`${httpEndpoint.replace(/\/$/, "")}/game-server/health`);
  if (!response.ok) {
    return null;
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed_to_parse_health_json: ${message}; length=${text.length}; head=${text.slice(0, 120)}; tail=${text.slice(-120)}`);
  }
}

export async function withGameServerEndpoint<T>(
  targetUrl: string | null,
  run: (endpoint: string) => Promise<T>,
) {
  let localServer: ReturnType<typeof createGameServer> | null = null;
  let endpoint = targetUrl;

  try {
    if (!endpoint) {
      const gameServerConfig = loadGameServerConfig();
      const localPort = parsePositiveIntEnv("GAME_LOAD_LOCAL_PORT", gameServerConfig.port);
      localServer = createGameServer({
        ...gameServerConfig,
        port: localPort,
      });
      await localServer.listen();
      endpoint = `ws://127.0.0.1:${localServer.config.port}`;
    }

    return await run(endpoint);
  } finally {
    await localServer?.shutdown();
  }
}

export function createLoadClient(endpoint: string) {
  return new ColyseusSdkClient(endpoint);
}
