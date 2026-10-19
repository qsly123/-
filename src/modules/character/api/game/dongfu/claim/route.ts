import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { claimDongfuXp } from "@/modules/character/services/dongfu-service";

export async function POST() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const result = await claimDongfuXp(player);
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Dongfu claim error:", error);
    return NextResponse.json({ success: false, error: "领取洞府修为失败" }, { status: 500 });
  }
}
