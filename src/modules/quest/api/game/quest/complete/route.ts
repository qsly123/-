import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { completeQuestForPlayer } from "@/modules/quest/services/quest-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const { questId, npcId } = await request.json();
    if (!questId || !npcId) {
      return NextResponse.json({ success: false, error: "参数缺失" }, { status: 400 });
    }

    const result = await completeQuestForPlayer({
      playerId: player.id,
      questId,
      npcId,
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || "完成任务失败" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        questId: result.data?.questId,
        questName: result.data?.questName,
        rewards: result.data?.rewards,
        hint: result.data?.hint,
        story: result.data?.story,
      },
    });
  } catch (e) {
    console.error("Quest complete error:", e);
    return NextResponse.json({ success: false, error: "完成任务失败" }, { status: 500 });
  }
}
