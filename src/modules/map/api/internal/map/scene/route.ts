import { NextResponse } from "next/server";
import {
  createMapSceneSnapshot,
  type MapSceneState,
} from "@/modules/map/services/map-scene-state";
import { loadMapSceneContextForPlayer } from "@/modules/map/services/map-scene-loader";
import { filterMapSceneStateByVision, resolveMapVisionProfile } from "@/modules/map/services/map-vision";
import { getMapSceneTick } from "@/modules/map/services/map-scene-sync";
import { loadPlayerVisionState, type PlayerVisionState } from "@/modules/map/services/map-vision-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_REALTIME_TOKEN_HEADER = "x-internal-realtime-token";

function isAuthorizedInternalRequest(request: Request) {
  const expectedToken = (process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  const providedToken = (request.headers.get(INTERNAL_REALTIME_TOKEN_HEADER) || "").trim();
  return Boolean(expectedToken) && providedToken === expectedToken;
}

function createDefaultVisionState(): PlayerVisionState {
  return {
    spiritualSense: 0,
    visionProfile: resolveMapVisionProfile(0),
  };
}

async function loadRawSceneStateForPlayer(playerId: string): Promise<{
  currentMapId: string;
  playerRealm: number;
  sceneState: MapSceneState;
} | null> {
  return await loadMapSceneContextForPlayer(playerId);
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

  const initialSceneContext = await loadRawSceneStateForPlayer(playerId);
  if (!initialSceneContext) {
    return NextResponse.json({ success: false, error: "玩家不存在" }, { status: 404 });
  }

  const visionState = await loadPlayerVisionState(playerId) || createDefaultVisionState();
  const sequence = getMapSceneTick(initialSceneContext.currentMapId);
  const sceneSnapshot = createMapSceneSnapshot({
    state: filterMapSceneStateByVision(initialSceneContext.sceneState, visionState.spiritualSense),
    sequence,
    tick: sequence,
    serverTimeMs: Date.now(),
    includeMonsterDrops: false,
  });

  return NextResponse.json({
    success: true,
    data: {
      playerId,
      mapId: initialSceneContext.currentMapId,
      playerRealm: initialSceneContext.playerRealm,
      spiritualSense: visionState.spiritualSense,
      sceneSnapshot,
    },
  });
}
