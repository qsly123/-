import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  accelerateSpiritualFieldPlot,
  getPlayerSpiritualFieldView,
  harvestSpiritualFieldPlot,
  plantSpiritualFieldSeed,
} from "@/modules/world/services/spiritual-field-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function toText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    return NextResponse.json({
      success: true,
      data: await getPlayerSpiritualFieldView(player.id),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取灵田失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      action?: unknown;
      plotId?: unknown;
      seedItemId?: unknown;
    };
    const action = toText(body.action);
    const plotId = toInt(body.plotId);

    if (action === "plant") {
      return NextResponse.json({
        success: true,
        data: await plantSpiritualFieldSeed({
          playerId: player.id,
          plotId,
          seedItemId: toText(body.seedItemId),
        }),
      });
    }
    if (action === "harvest") {
      return NextResponse.json({
        success: true,
        data: await harvestSpiritualFieldPlot({
          playerId: player.id,
          plotId,
        }),
      });
    }
    if (action === "accelerate") {
      return NextResponse.json({
        success: true,
        data: await accelerateSpiritualFieldPlot({
          playerId: player.id,
          plotId,
        }),
      });
    }

    return NextResponse.json({ success: false, error: "不支持的灵田操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "灵田操作失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
