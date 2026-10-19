import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { withStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import { pushSectProgressRefresh } from "@/modules/sect/services/sect-state-refresh-service";
import { listSectMemberPlayerIds } from "@/modules/sect/services/sect-presence-service";
import { getPlayerSectMembership, getSectDashboard, leaveSect } from "@/modules/sect/services/sect-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const data = await getSectDashboard(player.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Sect dashboard error:", error);
    return NextResponse.json({ success: false, error: "获取宗门信息失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as {
      action?: "leave";
    };
    if (body.action !== "leave") {
      return NextResponse.json({ success: false, error: "不支持的宗门操作" }, { status: 400 });
    }

    // 退出宗门会改变原宗门成员构成，先把成员列表读出来再落账。
    const membership = await getPlayerSectMembership(player.id);
    const memberPlayerIds = membership?.sectId
      ? await listSectMemberPlayerIds(membership.sectId)
      : [];
    await leaveSect(player.id);

    // 铁律：成员构成变化必须下发 12742 且 scopes 含 sect，不允许只回 ACK。
    const refresh = await pushSectProgressRefresh({
      actorPlayerId: player.id,
      memberPlayerIds,
      reason: "sect_leave",
    });

    return NextResponse.json(withStateRefreshFrames({ success: true }, refresh.actorFrames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "宗门操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
