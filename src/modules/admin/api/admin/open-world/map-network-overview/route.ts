import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { getOpenWorldMapNetworkOverview } from "@/modules/world/services/world-map-service";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const overview = await getOpenWorldMapNetworkOverview();
    return NextResponse.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    console.error("Open world map network overview error:", error);
    return NextResponse.json({ success: false, error: "获取开放世界地图路网总览失败" }, { status: 500 });
  }
}
