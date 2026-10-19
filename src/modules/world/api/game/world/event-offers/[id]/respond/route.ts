import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { isPlayerWorldError, respondPlayerWorldEventOffer } from "@/modules/world/services/player-world-pressure-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    const action = body?.action === "accept" || body?.action === "reject"
      ? body.action
      : null;
    if (!action) {
      return NextResponse.json({ success: false, error: "缺少有效的邀约响应动作" }, { status: 400 });
    }

    const result = await respondPlayerWorldEventOffer({
      playerId: player.id,
      offerId: id,
      action,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        resultSummary: result.narrative,
        rewards: result.reward,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "响应灰色邀约失败";
    const status = isPlayerWorldError(error) ? error.status : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
