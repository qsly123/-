import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerFirstEnabledHongmengTreasureState, upgradeHongmengTreasureStar } from "@/modules/character/services/hongmeng-treasure-service";

export async function POST(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const itemId = body && typeof body === "object" && !Array.isArray(body)
    ? String((body as { itemId?: unknown }).itemId || "").trim()
    : "";

  try {
    const resolvedItemId = itemId || (await getPlayerFirstEnabledHongmengTreasureState(player.id))?.itemId || "";
    if (!resolvedItemId) {
      return NextResponse.json({ success: false, error: "你尚未持有可升级的鸿蒙至宝。" }, { status: 400 });
    }

    const treasure = await upgradeHongmengTreasureStar({
      playerId: player.id,
      itemId: resolvedItemId,
    });

    return NextResponse.json({
      success: true,
      data: { treasure },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "升星失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

