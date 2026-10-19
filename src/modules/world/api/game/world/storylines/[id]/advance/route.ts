import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { advanceOpenWorldStoryline } from "@/modules/world/services/world-faction-storyline-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const result = await advanceOpenWorldStoryline({
      playerId: player.id,
      storylineId: id,
    });
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "推进街区故事链失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
