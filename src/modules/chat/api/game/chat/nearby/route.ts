import { NextResponse } from "next/server";
import { createStateRefreshFrameGroup } from "@immortality/shared-protocol";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { CHAT_CONTENT_MAX_LENGTH } from "@/modules/chat/services/chat-service";
import {
  createNearbyChatDedupeKey,
  createNearbyChatMessage,
  getNearbyChatStorageMode,
  listNearbyChatMessages,
  type NearbyChatScope,
} from "@/modules/chat/services/nearby-chat-service";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import { getOpenWorldDistrictRumor } from "@/modules/world/services/world-rumor-service";
import { getOpenWorldSchemaStatus } from "@/modules/world/services/world-schema";

function normalizeMapId(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function parseContent(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function normalizeNearbyScope(raw: unknown): NearbyChatScope {
  return raw === "district" ? "district" : "map";
}

/**
 * 解析发送方幂等键。
 *
 * 附近频道唯一写入口是本接口；`SocialRoom` 只广播回声。客户端重发同一条消息时
 * （弱网重试、SSE 断开后的补偿）必须携带同一个 `clientMessageId`，
 * 服务端据此命中唯一索引直接回读原消息，避免重复入库与重复刷屏。
 */
function resolveDedupeKey(playerId: string, rawClientMessageId: unknown) {
  const clientMessageId = String(rawClientMessageId || "").trim();
  if (!clientMessageId) {
    return null;
  }
  return createNearbyChatDedupeKey(playerId, clientMessageId);
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
      error: "只能查看当前所在地图的附近频道",
      status: 403,
    };
  }

  return {
    mapId: requestedMapId || currentMapId,
    error: "",
    status: 200,
  };
}

function resolveCurrentDistrictName(player: {
  currentMapId: string | null;
  positionX: number;
  positionY: number;
}) {
  const mapId = normalizeMapId(player.currentMapId || "");
  if (!mapId) {
    return null;
  }
  return resolveOpenWorldDistrictName({
    mapId,
    positionX: player.positionX,
    positionY: player.positionY,
  });
}

export async function GET(request: Request) {
  try {
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
    const currentDistrictName = resolveCurrentDistrictName(player);
    const runtimeMap = await getRuntimeMapById(resolved.mapId);
    const currentDistrictRumor = await getOpenWorldDistrictRumor(resolved.mapId, currentDistrictName);
    const messages = await listNearbyChatMessages(resolved.mapId, {
      scope,
      districtName: currentDistrictName,
    });

    return NextResponse.json({
      success: true,
      data: {
        playerId: player.id,
        mapId: resolved.mapId,
        mapName: runtimeMap?.name || resolved.mapId,
        scope,
        currentDistrictName,
        currentDistrictRumor,
        storageMode: getNearbyChatStorageMode(),
        schemaStatus: getOpenWorldSchemaStatus(),
        messages,
      },
    });
  } catch (error) {
    console.error("Nearby chat list error:", error);
    return NextResponse.json({ success: false, error: "获取附近消息失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const currentMapId = normalizeMapId(player.currentMapId);
    if (!currentMapId) {
      return NextResponse.json({ success: false, error: "当前不在可用地图中" }, { status: 400 });
    }

    const body = await request.json();
    const requestMapId = normalizeMapId(body?.mapId);
    const scope = normalizeNearbyScope(body?.scope);
    if (requestMapId && requestMapId !== currentMapId) {
      return NextResponse.json({ success: false, error: "只能向当前所在地图发送附近消息" }, { status: 403 });
    }

    const content = parseContent(body?.content);
    if (!content) {
      return NextResponse.json({ success: false, error: "消息不能为空" }, { status: 400 });
    }
    if (content.length > CHAT_CONTENT_MAX_LENGTH) {
      return NextResponse.json({ success: false, error: `消息不能超过 ${CHAT_CONTENT_MAX_LENGTH} 字` }, { status: 400 });
    }

    const senderName = (player.name || "无名修士").trim() || "无名修士";
    const runtimeMap = await getRuntimeMapById(currentMapId);
    const currentDistrictName = resolveCurrentDistrictName(player);
    const dedupeKey = resolveDedupeKey(player.id, body?.clientMessageId);
    const message = await createNearbyChatMessage({
      mapId: currentMapId,
      senderType: "player",
      playerId: player.id,
      senderName,
      content,
      ...(dedupeKey ? { dedupeKey } : {}),
    });

    if (!message) {
      return NextResponse.json({ success: false, error: "发送失败" }, { status: 500 });
    }

    // 附近频道消息属于世界动态进度变化，必须随响应下发 progress_refresh(12742) 帧组，
    // 不能只回成功标记，否则客户端纯渲染端会停在旧值。
    const stateRefreshFrames = createStateRefreshFrameGroup({
      playerId: player.id,
      roomId: `nearby:${currentMapId}`,
      reason: "nearby_message_sent",
      progress: {
        scopes: ["activity"],
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        message,
        /** 幂等命中：同一 clientMessageId 此前已入库，本次未新增消息。 */
        dedupeHit: Boolean(dedupeKey) && message.dedupeKey === dedupeKey,
        stateRefreshFrames,
        mapName: runtimeMap?.name || currentMapId,
        scope,
        currentDistrictName,
        currentDistrictRumor: await getOpenWorldDistrictRumor(currentMapId, currentDistrictName),
        storageMode: getNearbyChatStorageMode(),
        schemaStatus: getOpenWorldSchemaStatus(),
      },
    });
  } catch (error) {
    console.error("Nearby chat send error:", error);
    return NextResponse.json({ success: false, error: "发送失败" }, { status: 500 });
  }
}
