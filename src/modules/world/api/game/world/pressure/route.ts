import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerWorldPressure } from "@/modules/world/services/player-world-pressure-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const data = await getPlayerWorldPressure(player.id);
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("World pressure error:", error);
    return NextResponse.json({ success: false, error: "获取世界压力失败" }, { status: 500 });
  }
}
