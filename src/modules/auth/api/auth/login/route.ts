import { NextResponse } from "next/server";
import { loginPlayerByEmail } from "@/modules/auth/services/auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: "请输入邮箱和密码" }, { status: 400 });
    }

    const result = await loginPlayerByEmail(email, password);
    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: { accountId: result.accountId },
    });
  } catch {
    return NextResponse.json({ success: false, error: "登录失败" }, { status: 500 });
  }
}
