import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getDoubleCultivationStats } from "@/modules/world/services/double-cultivation-core-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: await getDoubleCultivationStats({
        playerId: player.id,
        gender: player.gender,
      }),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Double cultivation stats error:", error);
    return NextResponse.json({ success: false, error: "获取双修状态失败" }, { status: 500 });
  }
}

