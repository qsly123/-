import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { advanceEncounterSession } from "@/modules/map/services/map-encounter-session-service";
import { normalizeLegacyMapInteractRequest } from "@immortality/shared-protocol";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const rawBody = await request.json() as {
      sessionId?: unknown;
      choiceId?: unknown;
    };
    const normalizedProtocolInput = normalizeLegacyMapInteractRequest(rawBody, "encounter_choice");
    if (!normalizedProtocolInput.ok) {
      return NextResponse.json({
        success: false,
        error: normalizedProtocolInput.error,
        data: {
          realtimeAck: normalizedProtocolInput.ack,
        },
      }, { status: normalizedProtocolInput.status });
    }
    const body = normalizedProtocolInput.legacyBody as typeof rawBody;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const choiceId = typeof body.choiceId === "string" ? body.choiceId.trim() : "";
    if (!sessionId) {
      return NextResponse.json({ success: false, error: "缺少奇遇会话ID" }, { status: 400 });
    }
    if (!choiceId) {
      return NextResponse.json({ success: false, error: "缺少奇遇选项ID" }, { status: 400 });
    }

    const result = await advanceEncounterSession({
      playerId: player.id,
      playerName: player.name || "无名修士",
      playerRealmName: player.realmName,
      currentMapId: player.currentMapId || null,
      sessionId,
      choiceId,
    });

    return NextResponse.json({
      success: true,
      data: {
        encounterSession: result.encounterSession,
        stage: result.stage,
        finalEvent: result.finalEvent,
        sessionStatus: result.sessionStatus,
        protocol: normalizedProtocolInput.protocolMeta,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "奇遇推进失败";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 400 });
  }
}
