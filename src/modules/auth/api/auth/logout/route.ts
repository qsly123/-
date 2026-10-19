import { NextResponse } from "next/server";
import { logoutPlayer } from "@/modules/auth/services/auth";

export async function POST() {
  try {
    await logoutPlayer();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "登出失败" }, { status: 500 });
  }
}
