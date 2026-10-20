import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { normalizeLegacyMapInteractRequest } from "@immortality/shared-protocol";
import { tryClaimOpportunity } from "@/modules/map/services/opportunity-service";
import { startMapActionIdempotency, finishMapActionIdempotency } from "@/modules/map/services/map-action-idempotency";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer(request);
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    const body = await request.json() as { mapId?: unknown; x?: unknown; y?: unknown };
    const normalized = normalizeLegacyMapInteractRequest(body, "claim_opportunity");
    if (!normalized.ok) return NextResponse.json({ success: false, error: normalized.error }, { status: normalized.status });
    const sync = { acceptedClientSequence: normalized.input.clientSequence,
      authoritativePosition: { x: player.positionX, y: player.positionY }, protocol: normalized.protocolMeta };
    // 只信服务器已持久化的位置；请求中的坐标用于发现过期的到达通知。
    if (!player.currentMapId || body.mapId !== player.currentMapId
      || body.x !== player.positionX || body.y !== player.positionY) {
      return NextResponse.json({ success: false, error: "位置已变化，请重新靠近机缘", data: sync }, { status: 409 });
    }
    const action = await startMapActionIdempotency({ scope: "map-opportunity-claim", roomId: "next-api:map-opportunity-claim",
      playerId: player.id, actionId: normalized.input.actionId, inputType: "claim_opportunity",
      mapId: player.currentMapId, payload: { ...body } });
    if (action.status === "accepted") return NextResponse.json({ success: true, data: { ...action.result, ...sync, alreadyProcessed: true } });
    if (action.status !== "started") return NextResponse.json({ success: false,
      error: action.status === "pending" ? "机缘正在结算，请稍后确认" : action.reason || "机缘领取失败", data: sync }, { status: 409 });
    const result = await tryClaimOpportunity({ playerId: player.id, playerRealm: player.realm,
      mapId: player.currentMapId, positionX: player.positionX, positionY: player.positionY });
    const data = { ...sync, event: result.event, status: result.status,
      message: result.status === "blocked" ? result.message : result.status === "lost" ? "机缘已被其他修士捷足先登" : undefined };
    await finishMapActionIdempotency({ idempotencyKey: action.idempotencyKey, status: "accepted", result: data });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    // 不回滚已领取标记或自动重复发奖；保留pending日志供核对。
    console.error("[map-opportunity-claim] settlement failed", error);
    return NextResponse.json({ success: false, error: "机缘结算未完成，请稍后确认" }, { status: 500 });
  }
}
