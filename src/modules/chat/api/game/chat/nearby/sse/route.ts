import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  subscribeNearbyChatPresence,
  type NearbyChatPresenceMessage,
} from "@/modules/chat/services/nearby-chat-presence";
import {
  getNearbyChatStorageMode,
  listNearbyChatMessages,
  type NearbyChatScope,
} from "@/modules/chat/services/nearby-chat-service";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { createJsonSseResponse } from "@/modules/shared/services/realtime-transport";
import { createSceneStreamRuntime } from "@/modules/shared/services/scene-stream-runtime";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import { getOpenWorldDistrictRumor } from "@/modules/world/services/world-rumor-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NearbyChatSseEvent =
  | {
    type: "connected";
    mapId: string;
    mapName: string;
    scope: NearbyChatScope;
    currentDistrictName: string | null;
    currentDistrictRumor: {
      districtName: string;
      title: string;
      content: string;
      heat: "low" | "medium" | "high";
      updatedAt: string;
      source: "ai" | "fallback";
    } | null;
    storageMode: "database" | "memory";
  }
  | NearbyChatPresenceMessage;

function normalizeMapId(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function normalizeNearbyScope(raw: unknown): NearbyChatScope {
  return raw === "district" ? "district" : "map";
}

function resolveNearbyMapId(request: Request, currentMapId: string) {
  if (!currentMapId) {
    return {
      mapId: "",
      error: "当前不在可用地图中",
      status: 400,
    };
  }

  const requestedMapId = normalizeMapId(new URL(request.url).searchParams.get("mapId"));
  if (requestedMapId && currentMapId && requestedMapId !== currentMapId) {
    return {
      mapId: "",
      error: "只能订阅当前所在地图的附近频道",
      status: 403,
    };
  }

  return {
    mapId: requestedMapId || currentMapId,
    error: "",
    status: 200,
  };
}

export async function GET(request: Request) {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  const currentMapId = normalizeMapId(player.currentMapId);
  const resolved = resolveNearbyMapId(request, currentMapId);
  if (!resolved.mapId) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status });
  }
  const scope = normalizeNearbyScope(new URL(request.url).searchParams.get("scope"));
  const runtimeMap = await getRuntimeMapById(resolved.mapId);
  const currentDistrictName = resolveOpenWorldDistrictName({
    mapId: resolved.mapId,
    positionX: player.positionX,
    positionY: player.positionY,
  });
  const currentDistrictRumor = await getOpenWorldDistrictRumor(resolved.mapId, currentDistrictName);

  const runtime = createSceneStreamRuntime<null, unknown, NearbyChatSseEvent>({
    async getInitialEvents() {
      const messages = await listNearbyChatMessages(resolved.mapId, {
        scope,
        districtName: currentDistrictName,
      });
      return [
        {
          type: "connected",
          mapId: resolved.mapId,
          mapName: runtimeMap?.name || resolved.mapId,
          scope,
          currentDistrictName,
          currentDistrictRumor,
          storageMode: getNearbyChatStorageMode(),
        },
        ...messages.map((item) => ({
          type: "nearby_message" as const,
          data: item,
        })),
      ];
    },
    subscribe(subscriber) {
      return subscribeNearbyChatPresence(resolved.mapId, (message) => {
        if (scope === "district" && message.data.districtName !== currentDistrictName) {
          return;
        }
        subscriber(message);
      });
    },
  });

  return createJsonSseResponse({
    request,
    runtime,
  });
}
