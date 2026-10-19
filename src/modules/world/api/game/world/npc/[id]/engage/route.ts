import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { assertCanEngageWorldNpc } from "@/modules/world/services/world-npc-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id: rawId } = await params;
    const id = rawId.includes("%")
      ? (() => {
        try {
          return decodeURIComponent(rawId).trim();
        } catch {
          return rawId.trim();
        }
      })()
      : rawId.trim();
    const result = await assertCanEngageWorldNpc({
      playerId: player.id,
      npcId: id,
    });

    return NextResponse.json({
      success: true,
      data: {
        npcId: id,
        monsterId: result.monsterId,
        combatApiPath: "/api/game/combat/start",
        combatPathPrefix: "/game/combat",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发起交战失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
