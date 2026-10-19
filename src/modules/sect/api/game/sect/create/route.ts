import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { createSect } from "@/modules/sect/services/sect-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      sectName?: string;
      announcement?: string;
      mapId?: string;
      positionX?: number;
      positionY?: number;
    };
    const data = await createSect({
      playerId: player.id,
      sectName: String(body.sectName || ""),
      announcement: body.announcement,
      mapId: String(body.mapId || ""),
      positionX: Number(body.positionX || 0),
      positionY: Number(body.positionY || 0),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建宗门失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
