import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/modules/auth/services/auth";
import { consumeCharacterPreviewSession, createCharacterPreviewSession } from "@/modules/character/services/character-create-preview";
import { getStarterFortuneOptions } from "@/modules/character/services/fortune-service";

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

export async function POST(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await request.json() as {
      previewToken?: unknown;
      lockedStarterFortuneIds?: unknown;
    };
    const previewToken = normalizeText(body.previewToken);
    const lockedStarterFortuneIds = normalizeIdList(body.lockedStarterFortuneIds).slice(0, 1);
    if (!previewToken) {
      return NextResponse.json({ success: false, error: "预览令牌缺失" }, { status: 400 });
    }

    const previewSession = consumeCharacterPreviewSession({
      token: previewToken,
      accountId: account.id,
    });
    if (!previewSession) {
      return NextResponse.json({ success: false, error: "开局预览已失效，请重新觉醒灵根" }, { status: 400 });
    }

    const lockedStarterFortuneIdSet = new Set(lockedStarterFortuneIds);
    const lockedStarterFortuneOptions = previewSession.starterOptions.filter((option) => lockedStarterFortuneIdSet.has(option.id));
    const refreshLimit = Math.max(previewSession.starterOptions.length - lockedStarterFortuneOptions.length, 0);
    const refreshedStarterFortuneOptions = await getStarterFortuneOptions(refreshLimit, previewSession.gender, {
      excludeIds: lockedStarterFortuneOptions.map((option) => option.id),
    });
    const starterFortuneOptions = [...lockedStarterFortuneOptions, ...refreshedStarterFortuneOptions];
    const nextPreviewToken = createCharacterPreviewSession({
      accountId: account.id,
      gender: previewSession.gender,
      spiritualRoot: previewSession.spiritualRoot,
      starterOptions: starterFortuneOptions,
    });

    return NextResponse.json({
      success: true,
      data: {
        previewToken: nextPreviewToken,
        starterFortuneOptions,
        requiredSelectCount: Math.min(3, starterFortuneOptions.length),
      },
    });
  } catch (error) {
    console.error("Refresh starter fortune error:", error);
    return NextResponse.json({ success: false, error: "刷新气运失败" }, { status: 500 });
  }
}
