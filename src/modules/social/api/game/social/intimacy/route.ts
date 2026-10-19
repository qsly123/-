import { NextResponse } from "next/server";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { playerIntimacyRelations } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getPlayerMapByIds } from "@/modules/social/infrastructure/social-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const rows = await db.select({
      id: playerIntimacyRelations.id,
      playerAId: playerIntimacyRelations.playerAId,
      playerBId: playerIntimacyRelations.playerBId,
      requestedBy: playerIntimacyRelations.requestedBy,
      relationType: playerIntimacyRelations.relationType,
      status: playerIntimacyRelations.status,
      createdAt: playerIntimacyRelations.createdAt,
      updatedAt: playerIntimacyRelations.updatedAt,
      respondedAt: playerIntimacyRelations.respondedAt,
    }).from(playerIntimacyRelations).where(or(
      eq(playerIntimacyRelations.playerAId, player.id),
      eq(playerIntimacyRelations.playerBId, player.id),
    )).orderBy(desc(playerIntimacyRelations.updatedAt)).all();

    const targetIds = rows.map((row) => row.playerAId === player.id ? row.playerBId : row.playerAId);
    const profileMap = await getPlayerMapByIds(targetIds);

    const accepted: Array<{
      id: number;
      targetPlayerId: string;
      targetPlayerName: string;
      targetRealmName: string;
      relationType: string;
      createdAt: string;
      updatedAt: string;
    }> = [];

    const incomingPending: Array<{
      id: number;
      targetPlayerId: string;
      targetPlayerName: string;
      targetRealmName: string;
      relationType: string;
      createdAt: string;
      requestedBy: string;
    }> = [];

    const outgoingPending: Array<{
      id: number;
      targetPlayerId: string;
      targetPlayerName: string;
      targetRealmName: string;
      relationType: string;
      createdAt: string;
      requestedBy: string;
    }> = [];

    for (const row of rows) {
      const targetPlayerId = row.playerAId === player.id ? row.playerBId : row.playerAId;
      const target = profileMap.get(targetPlayerId);
      const targetPlayerName = target?.name || "未知修士";
      const targetRealmName = target?.realmName || "未知境界";

      if (row.status === "accepted") {
        accepted.push({
          id: row.id,
          targetPlayerId,
          targetPlayerName,
          targetRealmName,
          relationType: row.relationType,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        continue;
      }

      if (row.status !== "pending") {
        continue;
      }

      const record = {
        id: row.id,
        targetPlayerId,
        targetPlayerName,
        targetRealmName,
        relationType: row.relationType,
        createdAt: row.createdAt,
        requestedBy: row.requestedBy,
      };

      if (row.requestedBy === player.id) {
        outgoingPending.push(record);
      } else {
        incomingPending.push(record);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        accepted,
        incomingPending,
        outgoingPending,
      },
    });
  } catch (error) {
    console.error("Intimacy list error:", error);
    return NextResponse.json({ success: false, error: "获取亲密关系失败" }, { status: 500 });
  }
}
