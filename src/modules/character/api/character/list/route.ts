import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getCurrentAccount } from "@/modules/auth/services/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, {
        status: 401,
        headers: NO_STORE_HEADERS,
      });
    }

    const list = await db.select({
      id: players.id,
      name: players.name,
      realmName: players.realmName,
      updatedAt: players.updatedAt,
      createdAt: players.createdAt,
    }).from(players)
      .where(eq(players.accountId, account.id))
      .orderBy(desc(players.updatedAt))
      .all();

    return NextResponse.json({
      success: true,
      data: {
        list: list.map((item) => ({
          id: item.id,
          name: item.name,
          realmName: item.realmName,
          updatedAt: item.updatedAt,
          createdAt: item.createdAt,
        })),
      },
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Character list error:", error);
    return NextResponse.json({ success: false, error: "获取角色列表失败" }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}
