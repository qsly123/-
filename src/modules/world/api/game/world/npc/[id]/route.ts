import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getWorldNpcAdultIntent } from "@/modules/world/services/world-adult-service";
import { getWorldNpcDetail } from "@/modules/world/services/world-npc-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const [detail, adultIntent] = await Promise.all([
      getWorldNpcDetail(id, {
        playerId: player.id,
        realm: player.realm,
        spiritualSense: player.spiritualSense,
      }),
      getWorldNpcAdultIntent({
        playerId: player.id,
        npcId: id,
      }).catch(() => null),
    ]);

    if (!detail) {
      return NextResponse.json({ success: false, error: "世界 NPC 不存在" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...detail,
        adultIntent,
      },
    });
  } catch (error) {
    console.error("Open world npc detail error:", error);
    return NextResponse.json({ success: false, error: "获取世界 NPC 详情失败" }, { status: 500 });
  }
}
