import http from "http";

process.env.NODE_ENV = "production";

const currentPort = Number.parseInt(String(process.env.REALTIME_RUNTIME_PORT || "3101").trim(), 10) || 3101;
const hostname = process.env.REALTIME_RUNTIME_HOST || "127.0.0.1";
const keepAliveTimeout = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
const startedAtMs = Date.now();
const INTERNAL_REALTIME_TOKEN_HEADER = "x-internal-realtime-token";

function getRequestUrl(request) {
  const host = request.headers.host || "localhost";
  return new URL(request.url || "/", `http://${host}`);
}

function verifyInternalRealtimeToken(request) {
  const expectedToken = String(process.env.REALTIME_INTERNAL_TOKEN || process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  if (!expectedToken) {
    return true;
  }
  const providedToken = String(request.headers[INTERNAL_REALTIME_TOKEN_HEADER] || "").trim();
  return providedToken === expectedToken;
}

function writeJsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  response.end(body);
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

function buildRealtimeHealthPayload() {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  return {
    success: true,
    data: {
      ok: true,
      role: "realtime-runtime-legacy-health",
      pid: process.pid,
      port: currentPort,
      uptimeSec: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
      checkedAt: new Date().toISOString(),
      memory: {
        rssBytes: memoryUsage.rss,
        heapUsedBytes: memoryUsage.heapUsed,
        heapTotalBytes: memoryUsage.heapTotal,
      },
      cpu: {
        userCpuTimeMs: Math.round(cpuUsage.user / 1000),
        systemCpuTimeMs: Math.round(cpuUsage.system / 1000),
      },
      legacyRealtime: {
        mapSse: "retired",
        mapWs: "retired",
        combatSceneSse: "retired",
        combatSceneWs: "retired",
        bossSse: "retired",
        bossWs: "retired",
      },
    },
  };
}

function buildRealtimePerformancePayload() {
  return {
    success: true,
    data: {
      recentEvents: [],
      realtimeRuntime: {
        role: "legacy-health-only",
        oldMapRealtime: "retired",
        oldCombatRealtime: "retired",
        oldBossRealtime: "retired",
      },
    },
  };
}

async function bootstrap() {
  const server = http.createServer((request, response) => {
    const requestUrl = getRequestUrl(request);
    if (!verifyInternalRealtimeToken(request)) {
      writeJsonResponse(response, 401, {
        success: false,
        error: "unauthorized",
      });
      return;
    }

    if (requestUrl.pathname === "/_internal/runtime/health") {
      writeJsonResponse(response, 200, buildRealtimeHealthPayload());
      return;
    }

    if (requestUrl.pathname === "/_internal/runtime/performance") {
      writeJsonResponse(response, 200, buildRealtimePerformancePayload());
      return;
    }

    writeJsonResponse(response, 404, {
      success: false,
      error: "not_found",
    });
  });

  if (Number.isFinite(keepAliveTimeout) && keepAliveTimeout >= 0) {
    server.keepAliveTimeout = keepAliveTimeout;
  }

  server.on("upgrade", (_request, socket) => {
    writeUpgradeError(socket, 426, "Legacy realtime websocket retired");
  });

  server.listen(currentPort, hostname, () => {
    console.log(`[realtime-server] legacy realtime retired; health stub ready on http://${hostname}:${currentPort}`);
  });
}

bootstrap().catch((error) => {
  console.error("[realtime-server] bootstrap failed", error);
  process.exit(1);
});
