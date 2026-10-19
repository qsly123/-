import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { createPartyInvite } from "@/modules/social/infrastructure/party-service";

export async function POST(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const body = await request.json() as {
    targetPlayerId?: unknown;
  };
  const targetPlayerId = typeof body.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";
  if (!targetPlayerId) {
    return NextResponse.json({ success: false, error: "缺少邀请目标" }, { status: 400 });
  }

  const result = await createPartyInvite({
    inviterId: player.id,
    targetPlayerId,
  });
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      invite: result.invite,
    },
  });
}
