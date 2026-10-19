import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { withStateRefreshFrames } from "@/modules/shared/services/state-refresh-push";
import {
  pushSectProgressRefresh,
  pushSectStorageRefresh,
} from "@/modules/sect/services/sect-state-refresh-service";
import { listSectMemberPlayerIds } from "@/modules/sect/services/sect-presence-service";
import { getSectStorageSnapshot, getPlayerSectMembership } from "@/modules/sect/services/sect-service";
import { mutateSectStorage } from "@/modules/sect/services/sect-storage-service";

const RESOURCE_AFFECTED_ACTIONS = new Set(["donate_gold", "donate_item", "expand"]);

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const data = await getSectStorageSnapshot(player.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取宗门仓库失败";
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
      action?: "deposit" | "withdraw" | "expand" | "donate_gold" | "donate_item";
      itemId?: string;
      storageItemId?: number;
      quantity?: number;
    };
    const action = body.action || "deposit";
    await mutateSectStorage({
      playerId: player.id,
      action,
      itemId: body.itemId,
      storageItemId: body.storageItemId,
      quantity: body.quantity,
    });

    // 铁律：仓库 / 资源入库变更必须下发 10302 + 10510，不允许只回 ACK。
    const reason = `sect_storage_${action}`;
    const storageRefresh = await pushSectStorageRefresh({
      playerId: player.id,
      reason,
      ...(body.itemId ? { changedItemIds: [body.itemId] } : {}),
      ...(action === "donate_gold" && typeof body.quantity === "number"
        ? { currencies: { gold: body.quantity } }
        : {}),
    });

    let refreshFrames = storageRefresh.actorFrames;
    if (RESOURCE_AFFECTED_ACTIONS.has(action)) {
      const membership = await getPlayerSectMembership(player.id);
      const progressRefresh = await pushSectProgressRefresh({
        actorPlayerId: player.id,
        ...(membership?.sectId
          ? { memberPlayerIds: await listSectMemberPlayerIds(membership.sectId) }
          : {}),
        reason,
      });
      refreshFrames = [...refreshFrames, ...progressRefresh.actorFrames];
    }

    return NextResponse.json(withStateRefreshFrames({ success: true }, refreshFrames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "宗门仓库操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
