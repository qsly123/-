import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { respondPartyInvite } from "@/modules/social/infrastructure/party-service";

export async function POST(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const body = await request.json() as {
    inviteId?: unknown;
    accept?: unknown;
  };
  const inviteId = typeof body.inviteId === "string" ? body.inviteId.trim() : "";
  const accept = body.accept === true;
  if (!inviteId) {
    return NextResponse.json({ success: false, error: "缺少邀请标识" }, { status: 400 });
  }

  const result = await respondPartyInvite({
    playerId: player.id,
    inviteId,
    accept,
  });
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      party: result.party || null,
    },
  });
}
