import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerFirstEnabledHongmengTreasureState, getPlayerHongmengTreasureStateByItemId } from "@/modules/character/services/hongmeng-treasure-service";

export async function GET(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId")?.trim() || "";

  try {
    const treasure = itemId
      ? await getPlayerHongmengTreasureStateByItemId({ playerId: player.id, itemId })
      : await getPlayerFirstEnabledHongmengTreasureState(player.id);

    return NextResponse.json({
      success: true,
      data: { treasure },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取至宝状态失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

