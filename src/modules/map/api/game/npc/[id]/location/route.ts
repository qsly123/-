import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { maps, npcs } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });

    const { id: npcId } = await params;
    const npc = await db.select({
      id: npcs.id,
      name: npcs.name,
      mapId: npcs.mapId,
      positionX: npcs.positionX,
      positionY: npcs.positionY,
    }).from(npcs)
      .where(eq(npcs.id, npcId))
      .get();

    if (!npc) return NextResponse.json({ success: false, error: "NPC不存在" }, { status: 404 });

    const map = npc.mapId
      ? await db.select({ id: maps.id, name: maps.name })
        .from(maps)
        .where(eq(maps.id, npc.mapId))
        .get()
      : null;

    return NextResponse.json({
      success: true,
      data: {
        npcId: npc.id,
        npcName: npc.name,
        mapId: npc.mapId,
        mapName: map?.name || null,
        positionX: npc.positionX,
        positionY: npc.positionY,
      },
    });
  } catch (e) {
    console.error("NPC location error:", e);
    return NextResponse.json({ success: false, error: "获取NPC位置失败" }, { status: 500 });
  }
}
