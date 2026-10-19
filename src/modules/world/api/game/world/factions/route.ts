import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { listOpenWorldFactionsForPlayer } from "@/modules/world/services/world-faction-storyline-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const factions = await listOpenWorldFactionsForPlayer(player.id);
    return NextResponse.json({
      success: true,
      data: {
        factions,
      },
    });
  } catch (error) {
    console.error("World factions error:", error);
    return NextResponse.json({ success: false, error: "获取势力列表失败" }, { status: 500 });
  }
}
