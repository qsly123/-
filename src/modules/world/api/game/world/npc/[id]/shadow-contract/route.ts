import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { advancePlayerWorldNpcContract, isPlayerWorldError } from "@/modules/world/services/player-world-pressure-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null) as { offerId?: unknown } | null;
    const offerId = typeof body?.offerId === "string" && body.offerId.trim()
      ? body.offerId.trim()
      : null;

    const result = await advancePlayerWorldNpcContract({
      playerId: player.id,
      npcId: id,
      offerId,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        resultSummary: result.summary,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "推进暗线委托失败";
    const status = isPlayerWorldError(error) ? error.status : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
