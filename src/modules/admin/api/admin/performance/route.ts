import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { collectRuntimePerformanceSnapshot } from "@/modules/system/services/runtime-performance";

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

    const data = await collectRuntimePerformanceSnapshot();
    return NextResponse.json({
      success: true,
      data,
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Admin performance stats error:", error);
    return NextResponse.json({
      success: false,
      error: "获取性能分析数据失败",
    }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}
