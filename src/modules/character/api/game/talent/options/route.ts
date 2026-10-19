/** 查询当前可作出的流派抉择（境界达标且该抉择点未选）。 */

import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  getAvailableTalentOptions,
  getPlayerRealmMajor,
  getPlayerTalentKeys,
  resolveStagePercent,
} from "@/modules/character/services/talent-service";

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const [major, options, chosenKeys] = await Promise.all([
      getPlayerRealmMajor(player.id),
      getAvailableTalentOptions(player.id),
      getPlayerTalentKeys(player.id),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        major,
        chosenKeys,
        options: options.map((option) => ({
          key: option.key,
          name: option.name,
          kind: option.kind,
          parentKey: option.parentKey,
          description: option.description,
          unlockMajor: option.unlockMajor,
          // 当前境界实际生效的加成，用于抉择时展示收益
          currentPercent: resolveStagePercent(option.stageCurve, major),
        })),
      },
    });
  } catch (error) {
    console.error("Talent options error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取流派失败" },
      { status: 500 },
    );
  }
}
