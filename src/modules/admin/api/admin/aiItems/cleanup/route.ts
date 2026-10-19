import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  cleanupAiGeneratedItems,
  getAiItemCleanupOverview,
} from "@/modules/admin/services/ai-item-admin-service";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const rawMinAgeHours = url.searchParams.get("minAgeHours");
    const minAgeHours = rawMinAgeHours === null ? undefined : Number(rawMinAgeHours);
    const data = await getAiItemCleanupOverview({
      sourceType: url.searchParams.get("sourceType"),
      rarity: url.searchParams.get("rarity"),
      minAgeHours: Number.isFinite(minAgeHours) ? minAgeHours : undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取AI物品清理概览失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const result = await cleanupAiGeneratedItems({
      sourceType: typeof body?.sourceType === "string" ? body.sourceType : null,
      rarity: typeof body?.rarity === "string" ? body.rarity : null,
      minAgeHours: body?.minAgeHours,
      deleteLimit: body?.deleteLimit,
      dryRun: Boolean(body?.dryRun),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI物品清理失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
