import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { listOpenWorldMaps } from "@/modules/world/services/world-map-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const maps = await listOpenWorldMaps();
    return NextResponse.json({
      success: true,
      data: {
        maps,
      },
    });
  } catch (error) {
    console.error("Open world maps error:", error);
    return NextResponse.json({ success: false, error: "获取开放世界地图失败" }, { status: 500 });
  }
}
