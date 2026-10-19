import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { leaveSecretRealmForPlayer } from "@/modules/map/services/secret-realm-instance-service";

export async function POST() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const leaveResult = await leaveSecretRealmForPlayer(player.id);
    if (leaveResult.mapId) {
      await warmMapSceneSharedStateForMapId({
        mapId: leaveResult.mapId,
        reason: "player_transition",
      }).catch((error) => {
        console.error("Secret realm leave map prewarm error:", error);
      });
    }
    return NextResponse.json({
      success: true,
      data: leaveResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "离开秘境失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
