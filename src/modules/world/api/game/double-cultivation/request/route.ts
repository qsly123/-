import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { requestDoubleCultivationHostCommand } from "@/modules/world/services/double-cultivation-actions";

function parseTargetInput(value: unknown) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as {
      targetPlayerId?: unknown;
      targetName?: unknown;
    };
    const targetInput = parseTargetInput(body.targetPlayerId) || parseTargetInput(body.targetName);
    if (!targetInput) {
      return NextResponse.json({ success: false, error: "缺少目标玩家" }, { status: 400 });
    }

    const result = await requestDoubleCultivationHostCommand({
      requesterId: player.id,
      targetInput,
    });

    return NextResponse.json({
      success: true,
      data: {
        request: result.request,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发起双修申请失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

