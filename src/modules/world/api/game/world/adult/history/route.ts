import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { listWorldAdultHistory } from "@/modules/world/services/world-adult-service";

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const url = new URL(request.url);
    const npcId = url.searchParams.get("npcId")?.trim() || null;
    const history = await listWorldAdultHistory({
      playerId: player.id,
      npcId,
    });

    return NextResponse.json({
      success: true,
      data: {
        history,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载成人互动记录失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
