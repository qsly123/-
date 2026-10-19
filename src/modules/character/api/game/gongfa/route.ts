import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  getPlayerGongfaView,
  upgradePlayerGongfa,
} from "@/modules/character/services/gongfa-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: await getPlayerGongfaView(player.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取功法失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as { action?: unknown; gongfaId?: unknown };
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action !== "upgrade") {
      return NextResponse.json({ success: false, error: "不支持的功法操作" }, { status: 400 });
    }

    const gongfaId = Math.floor(Number(body.gongfaId || 0));
    return NextResponse.json({
      success: true,
      data: await upgradePlayerGongfa(player.id, gongfaId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修炼功法失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
