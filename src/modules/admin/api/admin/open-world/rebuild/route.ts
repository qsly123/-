import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  getOpenWorldRebuildRuntimeState,
  startOpenWorldRebuildJob,
} from "@/modules/world/services/world-rebuild-runtime";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const state = getOpenWorldRebuildRuntimeState();
  return NextResponse.json({
    success: true,
    data: state,
  });
}

export async function POST() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const state = startOpenWorldRebuildJob();

    return NextResponse.json({
      success: true,
      data: state,
    }, { status: 202 });
  } catch (error) {
    console.error("Open world rebuild error:", error);
    return NextResponse.json({ success: false, error: "重制开放世界失败" }, { status: 500 });
  }
}
