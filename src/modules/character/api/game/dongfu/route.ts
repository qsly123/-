import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { buildDongfuSnapshot } from "@/modules/character/services/dongfu-service";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const snapshot = await buildDongfuSnapshot(player);
    return NextResponse.json({
      success: true,
      data: {
        playerName: player.name,
        gender: player.gender,
        realmName: player.realmName,
        ...snapshot,
      },
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Dongfu snapshot error:", error);
    return NextResponse.json({ success: false, error: "获取洞府信息失败" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
