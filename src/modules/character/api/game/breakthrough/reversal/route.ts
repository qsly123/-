/**
 * 领取「逆天改命」天机词条。
 *
 * 前端在突破成功后拿到 `reversalOptions`，用其中的 id 回调本接口完成承接。
 * 同一境界只能领一次（`playerFortunes.sourceType/sourceRef` 防重）。
 */

import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  buildReversalSourceRef,
  claimReversalFortune,
} from "@/modules/character/services/reversal-service";

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      fortuneId?: unknown;
      realm?: unknown;
    } | null;

    const fortuneId = typeof body?.fortuneId === "string" ? body.fortuneId.trim() : "";
    if (!fortuneId) {
      return NextResponse.json({ success: false, error: "缺少天机词条 id" }, { status: 400 });
    }

    const realmValue = Number(body?.realm);
    if (!Number.isFinite(realmValue) || realmValue <= 0) {
      return NextResponse.json({ success: false, error: "缺少有效的境界值" }, { status: 400 });
    }

    const result = await claimReversalFortune({
      playerId: player.id,
      fortuneId,
      realmLinear: realmValue,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        sourceRef: buildReversalSourceRef(realmValue),
      },
    });
  } catch (error) {
    console.error("Reversal claim error:", error);
    const message = error instanceof Error ? error.message : "承接天机失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
