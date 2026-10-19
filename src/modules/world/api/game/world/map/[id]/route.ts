import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getOpenWorldMapById } from "@/modules/world/services/world-map-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const map = await getOpenWorldMapById(id);
    if (!map) {
      return NextResponse.json({ success: false, error: "开放世界地图不存在" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: map,
    });
  } catch (error) {
    console.error("Open world map detail error:", error);
    return NextResponse.json({ success: false, error: "获取开放世界地图详情失败" }, { status: 500 });
  }
}
