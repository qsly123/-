import { Socket, createConnection } from "node:net";
import { connect as createTlsConnection } from "node:tls";

export interface RedisPreflightOptions {
  timeoutMs?: number;
}

export interface RedisHealthSnapshot {
  enabled: boolean;
  status: "disabled" | "ok" | "error";
  latencyMs: number | null;
  checkedAt: string | null;
  error?: string;
}

function encodeRedisCommand(parts: string[]) {
  return [
    `*${parts.length}`,
    ...parts.flatMap((part) => [
      `$${Buffer.byteLength(part)}`,
      part,
    ]),
    "",
  ].join("\r\n");
}

function createRedisSocket(url: URL, timeoutMs: number) {
  const port = Number(url.port || 6379);
  const host = url.hostname || "127.0.0.1";

  if (url.protocol === "rediss:") {
    return createTlsConnection({
      host,
      port,
      servername: host,
      timeout: timeoutMs,
    });
  }

  return createConnection({
    host,
    port,
    timeout: timeoutMs,
  });
}

function readRedisLine(socket: Socket, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.off("close", onClose);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lineEnd = buffer.indexOf("\r\n");
      if (lineEnd === -1) {
        return;
      }
      cleanup();
      resolve(buffer.slice(0, lineEnd));
    };
    const onError = (error: Error) => fail(error);
    const onTimeout = () => fail(new Error("redis_preflight_timeout"));
    const onClose = () => fail(new Error("redis_preflight_closed"));
    const timeout = setTimeout(onTimeout, timeoutMs);

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.once("close", onClose);
  });
}

async function sendRedisCommand(socket: Socket, command: string[], timeoutMs: number) {
  socket.write(encodeRedisCommand(command));
  const line = await readRedisLine(socket, timeoutMs);
  if (line.startsWith("-")) {
    throw new Error(line.slice(1) || "redis_preflight_error");
  }
  return line;
}

function waitForSocketConnect(socket: Socket, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("redis_preflight_timeout"));
    };
    const timeout = setTimeout(onTimeout, timeoutMs);

    socket.once("connect", onConnect);
    socket.once("secureConnect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

async function pingRedisConnection(
  redisUrl: string | undefined,
  options: RedisPreflightOptions = {},
) {
  if (!redisUrl) {
    return;
  }

  const timeoutMs = options.timeoutMs || 2000;
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error("invalid REDIS_URL");
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`unsupported protocol ${url.protocol}`);
  }

  const socket = createRedisSocket(url, timeoutMs);
  try {
    await waitForSocketConnect(socket, timeoutMs);

    const username = decodeURIComponent(url.username || "");
    const password = decodeURIComponent(url.password || "");
    if (password) {
      const authCommand = username ? ["AUTH", username, password] : ["AUTH", password];
      const authLine = await sendRedisCommand(socket, authCommand, timeoutMs);
      if (authLine !== "+OK") {
        throw new Error(`unexpected AUTH response ${authLine}`);
      }
    }

    const pingLine = await sendRedisCommand(socket, ["PING"], timeoutMs);
    if (pingLine !== "+PONG") {
      throw new Error(`unexpected PING response ${pingLine}`);
    }
  } finally {
    socket.destroy();
  }
}

export async function assertRedisConnectionReady(
  redisUrl: string | undefined,
  options: RedisPreflightOptions = {},
) {
  if (!redisUrl) {
    return;
  }

  try {
    await pingRedisConnection(redisUrl, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[game-server] redis preflight failed", {
      logCategory: "redis.error",
      reason: "game_server_redis_unavailable",
      error: message,
    });
    throw new Error(`game_server_redis_unavailable: ${message}`);
  }
}

export async function measureRedisConnectionHealth(
  redisUrl: string | undefined,
  options: RedisPreflightOptions = {},
): Promise<RedisHealthSnapshot> {
  if (!redisUrl) {
    return {
      enabled: false,
      status: "disabled",
      latencyMs: null,
      checkedAt: null,
    };
  }

  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    await pingRedisConnection(redisUrl, {
      timeoutMs: options.timeoutMs || 1000,
    });
    return {
      enabled: true,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      latencyMs: Date.now() - startedAt,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
