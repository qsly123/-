import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  listCoreSpiritualFieldSeeds,
  upsertCoreSpiritualFieldSeed,
  type SpiritualFieldSeedInput,
} from "@/modules/world/services/spiritual-field-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    return NextResponse.json({
      success: true,
      data: {
        seeds: await listCoreSpiritualFieldSeeds(true),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取灵田配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as SpiritualFieldSeedInput;
    return NextResponse.json({
      success: true,
      data: {
        seeds: await upsertCoreSpiritualFieldSeed(body),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存灵田配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
