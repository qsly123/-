import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { withStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import { pushSectProgressRefresh } from "@/modules/sect/services/sect-state-refresh-service";
import { listSectMemberPlayerIds } from "@/modules/sect/services/sect-presence-service";
import { appointSectMember, getPlayerSectMembership } from "@/modules/sect/services/sect-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      targetPlayerId?: string;
      roleKey?: "leader" | "vice_leader" | "grand_elder" | "elder" | "inner_disciple" | "outer_disciple" | "handyman";
    };
    await appointSectMember({
      playerId: player.id,
      targetPlayerId: String(body.targetPlayerId || ""),
      roleKey: (body.roleKey || "outer_disciple"),
    });

    // 铁律：任命 / 权限变化必须下发 12742 且 scopes 含 sect，不允许只回 ACK。
    const membership = await getPlayerSectMembership(player.id);
    const refresh = await pushSectProgressRefresh({
      actorPlayerId: player.id,
      ...(membership?.sectId
        ? { memberPlayerIds: await listSectMemberPlayerIds(membership.sectId) }
        : {}),
      reason: "sect_appoint",
    });

    return NextResponse.json(withStateRefreshFrames({ success: true }, refresh.actorFrames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "任命失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
