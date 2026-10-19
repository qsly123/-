import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  getSocialPresenceEvents,
  subscribeSocialPresence,
} from "@/modules/social/realtime/social-presence";
import { createJsonSseResponse } from "@/modules/shared/services/realtime-transport";
import { createSceneStreamRuntime } from "@/modules/shared/services/scene-stream-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const runtime = createSceneStreamRuntime<null, unknown, unknown>({
    async getInitialEvents() {
      return [
        { type: "connected" },
        ...getSocialPresenceEvents(player.id),
      ];
    },
    subscribe(subscriber) {
      return subscribeSocialPresence(player.id, subscriber);
    },
  });

  return createJsonSseResponse({
    request,
    runtime,
  });
}
