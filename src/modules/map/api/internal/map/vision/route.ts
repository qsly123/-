import { NextResponse } from "next/server";
import { loadPlayerVisionState } from "@/modules/map/services/map-vision-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_REALTIME_TOKEN_HEADER = "x-internal-realtime-token";

function isAuthorizedInternalRequest(request: Request) {
  const expectedToken = (process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  const providedToken = (request.headers.get(INTERNAL_REALTIME_TOKEN_HEADER) || "").trim();
  return Boolean(expectedToken) && providedToken === expectedToken;
}

export async function GET(request: Request) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const playerId = requestUrl.searchParams.get("playerId")?.trim() || "";
  if (!playerId) {
    return NextResponse.json({ success: false, error: "缺少 playerId" }, { status: 400 });
  }

  const visionState = await loadPlayerVisionState(playerId);
  if (!visionState) {
    return NextResponse.json({ success: false, error: "玩家不存在" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: visionState,
  });
}
