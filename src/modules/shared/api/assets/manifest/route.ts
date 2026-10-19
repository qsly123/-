import { NextResponse } from "next/server";
import { getManagedAssetManifest } from "@/modules/shared/services/managed-asset-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = await getManagedAssetManifest();

  return NextResponse.json(
    {
      success: true,
      data: manifest,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
