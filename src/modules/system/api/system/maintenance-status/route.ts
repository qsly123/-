import { NextResponse } from "next/server";
import { getGameMaintenanceStatus } from "@/modules/system/services/game-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  const status = await getGameMaintenanceStatus();

  return NextResponse.json({
    success: true,
    data: status,
  }, {
    headers: NO_STORE_HEADERS,
  });
}
