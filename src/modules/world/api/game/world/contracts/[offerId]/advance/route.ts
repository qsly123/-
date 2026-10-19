import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  advancePlayerWorldObjectiveContract,
  isPlayerWorldError,
} from "@/modules/world/services/player-world-pressure-service";

export async function POST(_request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { offerId } = await params;
    const result = await advancePlayerWorldObjectiveContract({
      playerId: player.id,
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
    const message = error instanceof Error ? error.message : "推进街区目标失败";
    const status = isPlayerWorldError(error) ? error.status : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
