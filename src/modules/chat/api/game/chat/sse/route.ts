import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  getChatPresenceEvents,
  subscribeChatPresence,
} from "@/modules/chat/services/chat-presence";
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
        ...getChatPresenceEvents(),
      ];
    },
    subscribe(subscriber) {
      return subscribeChatPresence(subscriber);
    },
  });

  return createJsonSseResponse({
    request,
    runtime,
  });
}
