/** 作出流派抉择（每个抉择点只能选一次）。 */

import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { chooseTalent } from "@/modules/character/services/talent-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { pathKey?: unknown } | null;
    const pathKey = typeof body?.pathKey === "string" ? body.pathKey.trim() : "";
    if (!pathKey) {
      return NextResponse.json({ success: false, error: "缺少流派标识" }, { status: 400 });
    }

    const result = await chooseTalent(player.id, pathKey);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Talent choose error:", error);
    const message = error instanceof Error ? error.message : "抉择失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
