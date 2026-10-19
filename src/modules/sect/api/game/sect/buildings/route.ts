import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { withStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import { pushSectProgressRefresh } from "@/modules/sect/services/sect-state-refresh-service";
import { listSectMemberPlayerIds } from "@/modules/sect/services/sect-presence-service";
import { mutateSectBuildingState } from "@/modules/sect/services/sect-edit-service";
import { getPlayerSectMembership, getSectBuildingsSnapshot } from "@/modules/sect/services/sect-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const data = await getSectBuildingsSnapshot(player.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取宗门建筑失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      action?: "upgrade_lingqi_peak" | "update_announcement" | "toggle_permission";
      roleKey?: "leader" | "vice_leader" | "grand_elder" | "elder" | "inner_disciple" | "outer_disciple" | "handyman";
      permissionKey?: "review_join" | "review_visit" | "appoint_member" | "manage_buildings" | "manage_storage" | "manage_notice" | "expand_sect" | "edit_map";
      enabled?: boolean;
      announcement?: string;
    };
    await mutateSectBuildingState({
      playerId: player.id,
      action: body.action || "upgrade_lingqi_peak",
      roleKey: body.roleKey,
      permissionKey: body.permissionKey,
      enabled: body.enabled,
      announcement: body.announcement,
    });

    // 铁律：建筑 / 公告 / 权限变化属于宗门进度变更，必须下发 12742(scopes 含 sect)。
    const membership = await getPlayerSectMembership(player.id);
    const refresh = await pushSectProgressRefresh({
      actorPlayerId: player.id,
      ...(membership?.sectId
        ? { memberPlayerIds: await listSectMemberPlayerIds(membership.sectId) }
        : {}),
      reason: `sect_building_${body.action || "upgrade_lingqi_peak"}`,
    });

    return NextResponse.json(withStateRefreshFrames({ success: true }, refresh.actorFrames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "宗门建筑操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
