import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import next from "next";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = "production";
process.chdir(__dirname);

const dir = __dirname;
const currentPort = Number.parseInt(String(process.env.WEB_RUNTIME_PORT || process.env.PORT || "3000").trim(), 10) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const keepAliveTimeout = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);

function loadLocalEnvFile() {
  const envPath = path.join(dir, ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadNextConfig() {
  const configPath = path.join(dir, ".next", "required-server-files.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed.config || {};
}

function getRequestUrl(request) {
  const host = request.headers.host || "localhost";
  return new URL(request.url || "/", `http://${host}`);
}

function writeUpgradeError(socket, statusCode, message) {
  const statusText = message || "WebSocket Upgrade Unsupported";
  try {
    socket.write([
      `HTTP/1.1 ${statusCode} ${statusText}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(statusText)}`,
      "",
      statusText,
    ].join("\r\n"));
  } catch {
    // Ignore socket write races.
  } finally {
    socket.destroy();
  }
}

loadLocalEnvFile();
const nextConfig = loadNextConfig();
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

async function bootstrap() {
  const app = next({
    dev: false,
    dir,
    hostname,
    port: currentPort,
    conf: nextConfig,
  });

  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((request, response) => {
    const requestUrl = getRequestUrl(request);
    const parsedUrl = {
      pathname: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
    };

    Promise.resolve(handle(request, response, parsedUrl)).catch((error) => {
      console.error("[server] request handler error", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end("Internal Server Error");
      }
    });
  });

  if (Number.isFinite(keepAliveTimeout) && keepAliveTimeout >= 0) {
    server.keepAliveTimeout = keepAliveTimeout;
  }

  server.on("upgrade", (_request, socket) => {
    writeUpgradeError(socket, 426, "Legacy realtime websocket retired");
  });

  server.listen(currentPort, hostname, () => {
    console.log(`[server] ready on http://${hostname}:${currentPort}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] bootstrap failed", error);
  process.exit(1);
});
