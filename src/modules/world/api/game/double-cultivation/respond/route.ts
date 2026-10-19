import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { respondDoubleCultivationHostCommand } from "@/modules/world/services/double-cultivation-actions";

function parseRespondAction(value: unknown): "accept" | "reject" | null {
  if (value === "accept" || value === "reject") {
    return value;
  }
  return null;
}

function parseRequestId(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as {
      requestId?: unknown;
      action?: unknown;
    };
    const requestId = parseRequestId(body.requestId);
    const action = parseRespondAction(body.action);
    if (!requestId) {
      return NextResponse.json({ success: false, error: "requestId 非法" }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ success: false, error: "action 非法" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: await respondDoubleCultivationHostCommand({
        playerId: player.id,
        requestId,
        action,
      }),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理双修申请失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

