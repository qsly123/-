import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { fetchGameServerHealthSnapshot } from "@/modules/admin/services/game-server-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (auth.response) {
      return auth.response;
    }

    const data = await fetchGameServerHealthSnapshot();
    return NextResponse.json({
      success: true,
      data,
    }, {
      status: data.ok ? 200 : 503,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[web] admin game-server health failed", {
      logCategory: "web.request.failed",
      route: "/api/admin/game-server/health",
      reason: "game_server_health_failed",
      error,
    });
    return NextResponse.json({
      success: false,
      error: "获取 game-server 状态失败",
    }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}
