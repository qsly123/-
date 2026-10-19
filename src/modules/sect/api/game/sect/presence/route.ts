import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  isSectPresenceCommand,
  resolveSectPresenceRoomOptions,
} from "@immortality/shared-protocol/sect-presence";
import { getPlayerSectMembership } from "@/modules/sect/services/sect-service";
import {
  countSectHomeOnlineMembers,
  loadSectPresenceSnapshot,
  markSectMemberOffline,
  persistSectMemberPresence,
} from "@/modules/sect/services/sect-presence-service";

/**
 * 宗门驻地 presence 低频接口。
 *
 * 实时房间是 presence 的权威来源，本接口只负责：
 * 1. 校验成员身份（防止非成员写入 presence）。
 * 2. 落库兜底值，避免重连窗口里成员列表全灰。
 * 3. 回传房间 join 上下文，保证客户端与服务端落在同一个宗门分片。
 */

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const membership = await getPlayerSectMembership(player.id);
    if (!membership) {
      return NextResponse.json({
        success: true,
        data: { sectId: null, roomOptions: null, members: [] },
      });
    }
    const [members, homeOnlineCount] = await Promise.all([
      loadSectPresenceSnapshot(membership.sectId),
      countSectHomeOnlineMembers(membership.sectId),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        sectId: membership.sectId,
        roomOptions: resolveSectPresenceRoomOptions(membership.sectId),
        homeOnlineCount,
        members,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取宗门在线状态失败";
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
      command?: string;
      atHome?: boolean;
      mapId?: string | null;
    };
    const membership = await getPlayerSectMembership(player.id);
    if (!membership) {
      return NextResponse.json({ success: false, error: "你尚未加入宗门" }, { status: 400 });
    }

    const command = isSectPresenceCommand(body.command) ? body.command : null;
    if (!command) {
      return NextResponse.json({ success: false, error: "不支持的驻地状态指令" }, { status: 400 });
    }

    if (command === "sect_presence_home_enter") {
      await persistSectMemberPresence({
        playerId: player.id,
        sectId: membership.sectId,
        atHome: true,
        connected: true,
        mapId: body.mapId ?? null,
      });
    } else if (command === "sect_presence_home_leave") {
      await persistSectMemberPresence({
        playerId: player.id,
        sectId: membership.sectId,
        atHome: false,
        connected: true,
        mapId: body.mapId ?? null,
      });
    } else {
      // 任命变化由 /api/game/sect/appoint 落库并推送，这里不重复写 presence。
      await persistSectMemberPresence({
        playerId: player.id,
        sectId: membership.sectId,
        atHome: Boolean(body.atHome),
        connected: true,
        mapId: body.mapId ?? null,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        sectId: membership.sectId,
        roomOptions: resolveSectPresenceRoomOptions(membership.sectId),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新宗门在线状态失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    await markSectMemberOffline(player.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "清理宗门在线状态失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
