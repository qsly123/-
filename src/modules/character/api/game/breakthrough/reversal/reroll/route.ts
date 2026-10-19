/**
 * 逆天改命刷新：突破后的三选一每个境界可以刷新一次。
 * 次数限制在服务端（player_reversal_rerolls 表兜底），前端按钮只是引导。
 */

import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { rerollReversalOptions } from "@/modules/character/services/reversal-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { realmLinear?: unknown };
    const realmValue = Number(body.realmLinear);
    if (!Number.isFinite(realmValue) || realmValue <= 0) {
      return NextResponse.json({ success: false, error: "缺少有效的境界值" }, { status: 400 });
    }

    const result = await rerollReversalOptions({
      playerId: player.id,
      gender: player.gender,
      realmLinear: realmValue,
    });

    if (!result.allowed) {
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: { options: result.options, message: result.message },
    });
  } catch (error) {
    console.error("[reversal-reroll] 刷新失败", error);
    return NextResponse.json({ success: false, error: "刷新失败，请稍后再试" }, { status: 500 });
  }
}
