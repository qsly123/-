import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { resolveOpenWorldAssassinationChoice } from "@/modules/world/services/world-player-conflict-runtime";
import { applyPlayerWorldIncident } from "@/modules/world/services/player-world-pressure-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as {
      eventId?: unknown;
      action?: unknown;
    } | null;
    const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
    const action = body?.action === "escape" || body?.action === "fight"
      ? body.action
      : null;
    if (!eventId || !action) {
      return NextResponse.json({ success: false, error: "缺少有效的刺杀应对参数" }, { status: 400 });
    }

    const result = resolveOpenWorldAssassinationChoice({
      playerId: player.id,
      eventId,
      action,
    });
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    if (action === "escape") {
      await applyPlayerWorldIncident({
        playerId: player.id,
        incidentType: "escaped",
        sourceType: "assassination_response",
        sourceId: eventId,
        severity: result.escaped ? 2 : 3,
        summary: result.escaped
          ? "你在杀机逼近前强行遁走，风声却仍未彻底散去。"
          : "你试图遁逃却被对方锁住气机，追缉随之升级。",
        payloadJson: {
          action,
          escaped: result.escaped,
        },
      });
    }

    if (result.combatRequired) {
      await applyPlayerWorldIncident({
        playerId: player.id,
        incidentType: "assassination",
        sourceType: "assassination_response",
        sourceId: result.event?.npcId || eventId,
        severity: action === "fight" ? 4 : 3,
        summary: action === "fight"
          ? "你选择正面迎战来袭者，暗袭已转成明面厮杀。"
          : "遁逃失败后，你被迫转入正面厮杀。",
        payloadJson: {
          action,
          worldAssassinationId: result.event?.id || null,
          monsterId: result.monsterId || null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        escaped: result.escaped,
        combatRequired: result.combatRequired,
        narrative: result.narrative,
        worldAssassinationId: result.event?.id || null,
        monsterId: result.monsterId || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "刺杀应对失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
