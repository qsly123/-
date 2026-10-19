import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { negotiateWorldNpcAdultInteraction, type WorldAdultActionType } from "@/modules/world/services/world-adult-service";

const ALLOWED_ACTION_TYPES: WorldAdultActionType[] = [
  "seduce_invite",
  "dual_cultivation",
  "essence_drain",
  "dangerous_preference",
];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const actionType = String(body?.actionType || "").trim() as WorldAdultActionType;
    if (!ALLOWED_ACTION_TYPES.includes(actionType)) {
      return NextResponse.json({ success: false, error: "互动类型非法" }, { status: 400 });
    }

    const { id } = await params;
    const result = await negotiateWorldNpcAdultInteraction({
      playerId: player.id,
      npcId: id,
      actionType,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发起成人互动试探失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
