import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { listOpenWorldStorylines } from "@/modules/world/services/world-faction-storyline-service";

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mapId = String(searchParams.get("mapId") || "").trim() || player.currentMapId || "";
    if (!mapId) {
      return NextResponse.json({ success: false, error: "缺少地图标识" }, { status: 400 });
    }

    const storylines = await listOpenWorldStorylines({
      mapId,
      playerId: player.id,
    });
    return NextResponse.json({
      success: true,
      data: {
        mapId,
        storylines,
      },
    });
  } catch (error) {
    console.error("World storyline list error:", error);
    return NextResponse.json({ success: false, error: "获取街区故事链失败" }, { status: 500 });
  }
}
