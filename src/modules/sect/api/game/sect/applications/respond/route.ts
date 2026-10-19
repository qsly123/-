import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { withStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import { pushSectProgressRefresh } from "@/modules/sect/services/sect-state-refresh-service";
import { listSectMemberPlayerIds } from "@/modules/sect/services/sect-presence-service";
import { getPlayerSectMembership, respondToSectApplication } from "@/modules/sect/services/sect-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      applicationId?: string;
      action?: "approve" | "reject";
      decision?: "approved" | "rejected";
    };
    const normalizedAction = body.action
      ? body.action
      : (body.decision === "approved" ? "approve" : (body.decision === "rejected" ? "reject" : null));
    if (!body.applicationId || !normalizedAction) {
      return NextResponse.json({ success: false, error: "缺少有效的申请参数" }, { status: 400 });
    }
    await respondToSectApplication({
      playerId: player.id,
      applicationId: String(body.applicationId),
      action: normalizedAction,
    });

    // 铁律：审批改变成员构成 / 权限，必须下发 12742 且 scopes 含 sect。
    const membership = await getPlayerSectMembership(player.id);
    const refresh = await pushSectProgressRefresh({
      actorPlayerId: player.id,
      ...(membership?.sectId
        ? { memberPlayerIds: await listSectMemberPlayerIds(membership.sectId) }
        : {}),
      reason: `sect_application_${normalizedAction}`,
    });

    return NextResponse.json(withStateRefreshFrames({ success: true }, refresh.actorFrames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理申请失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
