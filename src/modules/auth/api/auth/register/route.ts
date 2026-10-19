import { NextResponse } from "next/server";
import { registerPlayerByEmail } from "@/modules/auth/services/auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: "请输入邮箱和密码" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ success: false, error: "密码至少6位" }, { status: 400 });
    }

    const result = await registerPlayerByEmail(email, password);
    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: { accountId: result.accountId } });
  } catch {
    return NextResponse.json({ success: false, error: "注册失败" }, { status: 500 });
  }
}
