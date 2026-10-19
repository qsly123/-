import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { SYSTEM_CONFIG_ITEMS } from "@/modules/system/services/system-config-keys";

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
        items: [...SYSTEM_CONFIG_ITEMS],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取系统配置项失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
