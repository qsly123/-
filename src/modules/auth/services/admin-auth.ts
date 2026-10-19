import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/modules/auth/services/auth";

export async function requireAdminApi() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return {
      admin: null,
      response: NextResponse.json({ success: false, error: "无后台权限" }, { status: 403 }),
    };
  }

  return { admin, response: null };
}

