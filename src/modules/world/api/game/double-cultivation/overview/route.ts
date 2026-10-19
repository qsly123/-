import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getDoubleCultivationOverview } from "@/modules/world/services/double-cultivation-core-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: await getDoubleCultivationOverview(player.id),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Double cultivation overview error:", error);
    return NextResponse.json({ success: false, error: "获取双修总览失败" }, { status: 500 });
  }
}

