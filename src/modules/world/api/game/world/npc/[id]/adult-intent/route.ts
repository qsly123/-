import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getWorldNpcAdultIntent } from "@/modules/world/services/world-adult-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const detail = await getWorldNpcAdultIntent({
      playerId: player.id,
      npcId: id,
    });

    return NextResponse.json({
      success: true,
      data: detail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载成人互动信息失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
