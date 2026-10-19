import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerSocialSettings } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { isDmPermission } from "@/modules/social/domain/social-types";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const row = await db.select({
      dmPermission: playerSocialSettings.dmPermission,
      updatedAt: playerSocialSettings.updatedAt,
    }).from(playerSocialSettings).where(eq(playerSocialSettings.playerId, player.id)).get();

    return NextResponse.json({
      success: true,
      data: {
        dmPermission: row?.dmPermission || "friends",
        updatedAt: row?.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("Social settings list error:", error);
    return NextResponse.json({ success: false, error: "获取社交设置失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const dmPermission = typeof body?.dmPermission === "string" ? body.dmPermission.trim() : "";
    if (!isDmPermission(dmPermission)) {
      return NextResponse.json({ success: false, error: "dmPermission 非法" }, { status: 400 });
    }

    const now = new Date().toISOString();
    await db.insert(playerSocialSettings).values({
      playerId: player.id,
      dmPermission,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: playerSocialSettings.playerId,
      set: {
        dmPermission,
        updatedAt: now,
      },
    }).run();

    return NextResponse.json({
      success: true,
      data: {
        dmPermission,
        updatedAt: now,
      },
    });
  } catch (error) {
    console.error("Social settings save error:", error);
    return NextResponse.json({ success: false, error: "保存社交设置失败" }, { status: 500 });
  }
}
