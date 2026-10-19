import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getSectEditSnapshot, mutateSectMap } from "@/modules/sect/services/sect-edit-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const data = await getSectEditSnapshot(player.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取宗门编辑信息失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }
    const body = await request.json() as {
      action?: "move_building" | "paint_tile" | "update_portal_meta";
      buildingType?: "portal" | "main_hall" | "storage" | "lingqi_peak";
      positionX?: number;
      positionY?: number;
      tileType?: "road" | "decor" | "grass" | "forest";
      description?: string;
      portalName?: string;
    };
    await mutateSectMap({
      playerId: player.id,
      action: body.action || "paint_tile",
      buildingType: body.buildingType,
      positionX: body.positionX,
      positionY: body.positionY,
      tileType: body.tileType,
      description: body.description,
      portalName: body.portalName,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "宗门地图编辑失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
