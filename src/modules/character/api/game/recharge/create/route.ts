import { NextResponse } from "next/server";

const RECHARGE_DISABLED_RESPONSE = {
  success: true,
  data: {
    ldcRechargeEnabled: false,
  },
} as const;

export async function GET() {
  return NextResponse.json(RECHARGE_DISABLED_RESPONSE, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST() {
  return NextResponse.json({
    success: false,
    error: "公益版本已关闭充值功能",
  }, { status: 410 });
}
