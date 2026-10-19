/** 查询玩家已选定的道途（常驻展示用，与 options 的"待抉择"相对）。 */

import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerTalentOverview } from "@/modules/character/services/talent-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: await getPlayerTalentOverview(player.id),
    });
  } catch (error) {
    console.error("Talent overview error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取道途失败" },
      { status: 500 },
    );
  }
}
