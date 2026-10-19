import { NextResponse } from "next/server";
import { bindEmailForLegacyAccount } from "@/modules/auth/services/auth";

export async function POST(request: Request) {
  try {
    const { username, password, email } = await request.json();

    if (!username || !password || !email) {
      return NextResponse.json({ success: false, error: "请输入旧用户名、密码和邮箱" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ success: false, error: "密码至少6位" }, { status: 400 });
    }

    const result = await bindEmailForLegacyAccount(username, password, email);
    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: { accountId: result.accountId } });
  } catch {
    return NextResponse.json({ success: false, error: "绑定失败" }, { status: 500 });
  }
}
