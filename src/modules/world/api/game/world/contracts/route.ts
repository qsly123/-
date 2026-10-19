import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { isPlayerWorldError, listPlayerWorldContracts } from "@/modules/world/services/player-world-pressure-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const contracts = await listPlayerWorldContracts(player.id);
    return NextResponse.json({
      success: true,
      data: {
        contracts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取暗线委托失败";
    const status = isPlayerWorldError(error) ? error.status : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
