import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getCurrentAccount, clearActivePlayer } from "@/modules/auth/services/auth";
import { deletePlayersWithRelations, formatDeleteError } from "@/modules/admin/api/admin/[entity]/entity-deletion";
import { ACTIVE_PLAYER_COOKIE } from "@/modules/shared/constants";

function getLatestCookieValue(cookieStore: Awaited<ReturnType<typeof cookies>>, key: string): string | null {
  const values = cookieStore.getAll(key);
  if (values.length === 0) {
    return null;
  }
  return values[values.length - 1]?.value ?? null;
}

export async function POST(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { playerId } = await request.json() as { playerId?: unknown };
    const normalizedId = String(playerId || "").trim();
    if (!normalizedId) {
      return NextResponse.json({ success: false, error: "缺少 playerId" }, { status: 400 });
    }

    const owned = await db.select({ id: players.id }).from(players).where(and(
      eq(players.id, normalizedId),
      eq(players.accountId, account.id),
    )).get();
    if (!owned) {
      return NextResponse.json({ success: false, error: "角色不存在" }, { status: 404 });
    }

    const cookieStore = await cookies();
    const activePlayerId = getLatestCookieValue(cookieStore, ACTIVE_PLAYER_COOKIE);

    await deletePlayersWithRelations([normalizedId]);
    if (activePlayerId === normalizedId) {
      await clearActivePlayer();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Character delete error:", error);
    return NextResponse.json({
      success: false,
      error: formatDeleteError(error, { exposeConstraintDetails: false }),
    }, { status: 500 });
  }
}
