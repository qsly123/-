import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { withStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import { pushSectAssetAndProgressRefresh } from "@/modules/sect/services/sect-state-refresh-service";
import { listSectMemberPlayerIds } from "@/modules/sect/services/sect-presence-service";
import { expandSect, getPlayerSectMembership } from "@/modules/sect/services/sect-service";

export async function POST() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    await expandSect(player.id);

    // 铁律：扩建消耗宗门资源并改变宗门进度，必须下发 10510 + 12742(scopes 含 sect)。
    const membership = await getPlayerSectMembership(player.id);
    const refresh = await pushSectAssetAndProgressRefresh({
      actorPlayerId: player.id,
      ...(membership?.sectId
        ? { memberPlayerIds: await listSectMemberPlayerIds(membership.sectId) }
        : {}),
      reason: "sect_expand",
    });

    return NextResponse.json(withStateRefreshFrames({ success: true }, refresh.actorFrames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "扩建失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
