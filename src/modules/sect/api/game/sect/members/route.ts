import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getSectMembersSnapshot } from "@/modules/sect/services/sect-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const data = await getSectMembersSnapshot(player.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取成员失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
