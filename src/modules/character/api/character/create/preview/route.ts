import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/modules/auth/services/auth";
import { generateSpiritualRoot } from "@/modules/ai/services/ai";
import { buildInitialPlayerBaseStats } from "@/modules/character/services/player-initial-stats";
import { createCharacterPreviewSession } from "@/modules/character/services/character-create-preview";
import { getStarterFortuneOptions } from "@/modules/character/services/fortune-service";
import type { SpiritualRoot } from "@/types/game";

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isValidGender(value: string) {
  return value === "男" || value === "女";
}

export async function POST(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as {
      gender?: unknown;
      wish?: unknown;
    };

    const gender = normalizeText(body.gender);
    const wish = normalizeText(body.wish);

    if (!gender || !wish) {
      return NextResponse.json({ success: false, error: "请填写完整信息" }, { status: 400 });
    }
    if (!isValidGender(gender)) {
      return NextResponse.json({ success: false, error: "性别仅支持男/女" }, { status: 400 });
    }

    const spiritualRoot: SpiritualRoot = await generateSpiritualRoot(wish);
    const stats = await buildInitialPlayerBaseStats(spiritualRoot);
    const starterFortuneOptions = await getStarterFortuneOptions(5, gender);
    const previewToken = createCharacterPreviewSession({
      accountId: account.id,
      gender,
      spiritualRoot,
      starterOptions: starterFortuneOptions,
    });

    return NextResponse.json({
      success: true,
      data: {
        spiritualRoot,
        starterFortuneOptions,
        requiredSelectCount: Math.min(3, starterFortuneOptions.length),
        previewToken,
        stats: {
          hp: stats.hp,
          mp: stats.mp,
          attack: stats.attack,
          defense: stats.defense,
          speed: stats.speed,
          luck: stats.luck,
        },
      },
    });
  } catch (error) {
    console.error("Character preview error:", error);
    return NextResponse.json({ success: false, error: "生成开局预览失败" }, { status: 500 });
  }
}
