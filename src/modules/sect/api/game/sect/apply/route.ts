import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { applyToSect } from "@/modules/sect/services/sect-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      sectId?: string;
      note?: string;
    };
    await applyToSect({
      playerId: player.id,
      sectId: String(body.sectId || ""),
      type: "join",
      note: body.note,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交申请失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
