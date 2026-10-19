import { NextResponse } from "next/server";
import { runTiandaoTick } from "@/modules/world/services/tiandao-runtime";

export async function POST() {
  try {
    const result = await runTiandaoTick();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tiandao tick error:", error);
    return NextResponse.json({ success: false, error: "天道推演失败" }, { status: 500 });
  }
}
