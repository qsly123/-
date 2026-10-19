import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  acknowledgeRepeatKillGuard,
  getRepeatKillGuardThresholds,
  resetRepeatKillGuard,
} from "@/modules/combat/services/repeat-kill-guard";

type RepeatGuardRequestBody = {
  action?: unknown;
};

export async function POST(request: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as RepeatGuardRequestBody | null;
    const action = typeof body?.action === "string" ? body.action.trim() : "";

    if (action === "acknowledge") {
      const guard = acknowledgeRepeatKillGuard(player.id);
      return NextResponse.json({
        success: true,
        data: {
          acknowledged: true,
          antiRepeatGuard: guard,
          thresholds: getRepeatKillGuardThresholds(),
        },
      });
    }

    if (action === "reset") {
      resetRepeatKillGuard(player.id);
      return NextResponse.json({
        success: true,
        data: {
          reset: true,
          thresholds: getRepeatKillGuardThresholds(),
        },
      });
    }

    return NextResponse.json({ success: false, error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    console.error("Combat repeat guard route error:", error);
    return NextResponse.json({ success: false, error: "重复击杀守卫处理失败" }, { status: 500 });
  }
}
