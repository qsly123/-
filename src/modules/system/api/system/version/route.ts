import { NextResponse } from "next/server";
import { getDeploymentVersion } from "@/modules/system/services/deployment-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const version = await getDeploymentVersion();

  return NextResponse.json({
    success: true,
    data: {
      version,
    },
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
