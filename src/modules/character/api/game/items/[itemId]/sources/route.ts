import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getItemByIdCompat } from "@/modules/character/services/pill-toxicity-schema-compat";
import { getItemSources } from "@/modules/character/services/item-source-service";

export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { itemId: rawItemId } = await params;
    const itemId = decodeURIComponent(rawItemId || "").trim();
    if (!itemId) {
      return NextResponse.json({ success: false, error: "缺少物品ID" }, { status: 400 });
    }

    const item = await getItemByIdCompat(itemId);
    if (!item) {
      return NextResponse.json({ success: false, error: "物品不存在" }, { status: 404 });
    }

    const sources = await getItemSources(itemId);
    return NextResponse.json({
      success: true,
      data: {
        itemId,
        sources,
      },
    });
  } catch (error) {
    console.error("Item sources error:", error);
    return NextResponse.json({ success: false, error: "获取物品来源失败" }, { status: 500 });
  }
}
