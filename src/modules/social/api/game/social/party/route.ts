import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  getPartySnapshot,
  kickPartyMember,
  leaveParty,
} from "@/modules/social/infrastructure/party-service";

export async function GET() {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const snapshot = await getPartySnapshot(player.id);
  return NextResponse.json({
    success: true,
    data: snapshot,
  });
}

export async function POST(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const body = await request.json() as {
    action?: unknown;
    targetPlayerId?: unknown;
  };
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const targetPlayerId = typeof body.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";

  if (action === "leave") {
    const result = await leaveParty(player.id);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        party: result.party,
      },
    });
  }

  if (action === "kick") {
    const result = await kickPartyMember({
      leaderPlayerId: player.id,
      targetPlayerId,
    });
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        party: result.party,
      },
    });
  }

  return NextResponse.json({ success: false, error: "未知队伍操作" }, { status: 400 });
}
