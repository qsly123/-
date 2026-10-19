import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getCurrentAccount, setActivePlayer } from "@/modules/auth/services/auth";
import { getGameMaintenanceStatus } from "@/modules/system/services/game-maintenance";

export async function POST(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const maintenanceStatus = await getGameMaintenanceStatus();
    if (maintenanceStatus.enabled) {
      return NextResponse.json({
        success: false,
        error: maintenanceStatus.message,
        maintenance: true,
      }, { status: 503 });
    }

    const { playerId } = await request.json();
    if (!playerId || typeof playerId !== "string" || !playerId.trim()) {
      return NextResponse.json({ success: false, error: "缺少 playerId" }, { status: 400 });
    }

    const normalizedId = playerId.trim();
    const owned = await db.select({ id: players.id }).from(players).where(and(
      eq(players.id, normalizedId),
      eq(players.accountId, account.id),
    )).get();

    if (!owned) {
      return NextResponse.json({ success: false, error: "角色不存在" }, { status: 404 });
    }

    await setActivePlayer(normalizedId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Character select error:", error);
    return NextResponse.json({ success: false, error: "选择角色失败" }, { status: 500 });
  }
}
