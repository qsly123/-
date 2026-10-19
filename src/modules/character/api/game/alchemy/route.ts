import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  craftAlchemyRecipe,
  getPlayerAlchemyView,
} from "@/modules/character/services/alchemy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      data: await getPlayerAlchemyView(player.id),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取炼丹失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as { action?: unknown; recipeId?: unknown };
    if (toText(body.action) !== "craft") {
      return NextResponse.json({ success: false, error: "不支持的炼丹操作" }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      data: await craftAlchemyRecipe({
        playerId: player.id,
        recipeId: toText(body.recipeId),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "炼丹失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
