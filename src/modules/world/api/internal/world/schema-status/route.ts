import { NextResponse } from "next/server";
import { getOpenWorldDashboardSummary } from "@/modules/world/services/world-map-service";
import { ensureOpenWorldSchema, getOpenWorldSchemaStatus } from "@/modules/world/services/world-schema";

export async function GET() {
  try {
    await ensureOpenWorldSchema();
    const dashboardSummary = await getOpenWorldDashboardSummary();
    return NextResponse.json({
      success: true,
      data: {
        schemaStatus: getOpenWorldSchemaStatus(),
        dashboardSummary,
      },
    });
  } catch (error) {
    console.error("Open world schema status error:", error);
    return NextResponse.json({ success: false, error: "获取开放世界状态失败" }, { status: 500 });
  }
}
