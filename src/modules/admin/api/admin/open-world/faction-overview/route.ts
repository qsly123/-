import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { getOpenWorldFactionAdminOverview } from "@/modules/world/services/world-faction-storyline-service";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const overview = await getOpenWorldFactionAdminOverview();
    return NextResponse.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    console.error("Open world faction overview error:", error);
    return NextResponse.json({ success: false, error: "获取势力与街区总览失败" }, { status: 500 });
  }
}
