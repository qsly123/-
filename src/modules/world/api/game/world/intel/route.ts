import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { readThroughReadModelCache } from "@/modules/shared/services/read-model-cache";
import {
  buildWorldIntelCacheKey,
  getWorldIntelCacheTtlMs,
} from "@/modules/shared/services/read-model-cache-keys";
import { loadWorldIntelDetailView } from "@/modules/world/services/world-summary-service";

export async function GET(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedMapId = String(searchParams.get("mapId") || player.currentMapId || "").trim();
    if (!requestedMapId) {
      return NextResponse.json({ success: false, error: "缺少地图标识" }, { status: 400 });
    }

    const runtimeMap = await getRuntimeMapById(requestedMapId);
    if (!runtimeMap) {
      return NextResponse.json({ success: false, error: "地图不存在" }, { status: 404 });
    }

    const intel = await readThroughReadModelCache({
      key: buildWorldIntelCacheKey({
        playerId: player.id,
        mapId: runtimeMap.id,
      }),
      ttlMs: getWorldIntelCacheTtlMs(),
      statGroup: "world_intel",
      loader: async () => await loadWorldIntelDetailView({
        playerId: player.id,
        mapId: runtimeMap.id,
        mapType: runtimeMap.mapType,
      }),
    });

    return NextResponse.json({
      success: true,
      data: intel,
    });
  } catch (error) {
    console.error("World intel error:", error);
    return NextResponse.json({ success: false, error: "获取世界动静失败" }, { status: 500 });
  }
}
