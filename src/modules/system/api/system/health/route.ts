import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/modules/auth/services/auth";
import { collectRuntimeHealthSnapshot } from "@/modules/system/services/runtime-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const INTERNAL_REALTIME_TOKEN_HEADER = "x-internal-realtime-token";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function isAuthorizedInternalRequest(request: Request) {
  const expectedToken = String(process.env.REALTIME_INTERNAL_TOKEN || process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  const providedToken = String(request.headers.get(INTERNAL_REALTIME_TOKEN_HEADER) || "").trim();
  return Boolean(expectedToken) && providedToken === expectedToken;
}

function buildPublicHealthPayload(status: "ok" | "degraded") {
  return {
    success: true,
    data: {
      status,
      public: true,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wantsDb = url.searchParams.get("db") === "1";
  const scope = String(url.searchParams.get("scope") || "").trim();
  const realtimeRuntimeEnabled = String(process.env.REALTIME_RUNTIME_ENABLED || "").trim() === "1";
  const realtimeRuntimePort = Number.parseInt(String(process.env.REALTIME_RUNTIME_PORT || "3101").trim(), 10) || 3101;
  const internalToken = String(process.env.REALTIME_INTERNAL_TOKEN || process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  const internalRequest = isAuthorizedInternalRequest(request);
  const admin = internalRequest ? null : await getCurrentAdmin().catch(() => null);
  const canReadDetailedHealth = internalRequest || Boolean(admin);
  const includeDb = canReadDetailedHealth && wantsDb;

  try {
    if (!canReadDetailedHealth) {
      const data = await collectRuntimeHealthSnapshot({ includeDb: false });
      const statusCode = data.status === "ok" ? 200 : 503;
      return NextResponse.json(buildPublicHealthPayload(data.status), {
        status: statusCode,
        headers: NO_STORE_HEADERS,
      });
    }

    if (scope === "realtime") {
      const realtimeResponse = await fetch(`http://127.0.0.1:${realtimeRuntimePort}/_internal/runtime/health`, {
        headers: {
          [INTERNAL_REALTIME_TOKEN_HEADER]: internalToken,
        },
        cache: "no-store",
      });
      const realtimeJson = await realtimeResponse.json();
      return NextResponse.json(realtimeJson, {
        status: realtimeResponse.ok ? 200 : 503,
        headers: NO_STORE_HEADERS,
      });
    }

    const data = await collectRuntimeHealthSnapshot({ includeDb });
    if (scope === "web" || !realtimeRuntimeEnabled) {
      const statusCode = includeDb && data.status !== "ok" ? 503 : 200;
      return NextResponse.json({
        success: true,
        data,
      }, {
        status: statusCode,
        headers: NO_STORE_HEADERS,
      });
    }

    let realtime = null;
    let statusCode = includeDb && data.status !== "ok" ? 503 : 200;
    try {
      const realtimeResponse = await fetch(`http://127.0.0.1:${realtimeRuntimePort}/_internal/runtime/health`, {
        headers: {
          [INTERNAL_REALTIME_TOKEN_HEADER]: internalToken,
        },
        cache: "no-store",
      });
      const realtimeJson = await realtimeResponse.json().catch(() => null);
      realtime = realtimeJson?.data || null;
      if (!realtimeResponse.ok) {
        statusCode = 503;
      }
    } catch (error) {
      realtime = {
        ok: false,
        error: error instanceof Error ? error.message : "realtime health unavailable",
      };
      statusCode = 503;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...data,
        runtimeRoles: {
          web: {
            ok: data.status === "ok",
            pid: data.pid,
          },
          realtime,
        },
      },
    }, {
      status: statusCode,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("System health error:", error);
    return NextResponse.json({
      success: false,
      error: "系统健康检查失败",
    }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}
