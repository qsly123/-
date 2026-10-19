import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { resolveWorldNpcAdultInteraction, type WorldAdultResolveDecision } from "@/modules/world/services/world-adult-service";

const ALLOWED_DECISIONS: WorldAdultResolveDecision[] = [
  "accept",
  "reject",
  "counter_drain",
  "report",
  "ignore",
];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const eventLogId = String(body?.eventLogId || "").trim();
    const decision = String(body?.decision || "").trim() as WorldAdultResolveDecision;

    if (!eventLogId) {
      return NextResponse.json({ success: false, error: "缺少互动记录" }, { status: 400 });
    }
    if (!ALLOWED_DECISIONS.includes(decision)) {
      return NextResponse.json({ success: false, error: "处理方式非法" }, { status: 400 });
    }

    const { id } = await params;
    const result = await resolveWorldNpcAdultInteraction({
      playerId: player.id,
      npcId: id,
      eventLogId,
      decision,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "结算成人互动失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
