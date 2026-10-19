import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { listPlayerWorldEventOffers } from "@/modules/world/services/player-world-pressure-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const offers = await listPlayerWorldEventOffers(player.id);
    return NextResponse.json({
      success: true,
      data: {
        offers,
      },
    });
  } catch (error) {
    console.error("World event offers error:", error);
    return NextResponse.json({ success: false, error: "获取灰色邀约失败" }, { status: 500 });
  }
}
