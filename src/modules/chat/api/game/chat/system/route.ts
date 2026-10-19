import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  CHAT_CONTENT_MAX_LENGTH,
  listChatMessagesByType,
  publishSystemAnnouncement,
} from "@/modules/chat/services/chat-service";

function parseContent(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const messages = await listChatMessagesByType("system");

    return NextResponse.json({
      success: true,
      data: {
        messages,
      },
    });
  } catch (e) {
    console.error("System chat list error:", e);
    return NextResponse.json({ success: false, error: "获取系统消息失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await req.json();
    const content = parseContent(body?.content);
    if (!content) {
      return NextResponse.json({ success: false, error: "消息不能为空" }, { status: 400 });
    }
    if (content.length > CHAT_CONTENT_MAX_LENGTH) {
      return NextResponse.json({ success: false, error: `消息不能超过 ${CHAT_CONTENT_MAX_LENGTH} 字` }, { status: 400 });
    }

    const message = await publishSystemAnnouncement(content);
    if (!message) {
      return NextResponse.json({ success: false, error: "发送失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        message,
      },
    });
  } catch (e) {
    console.error("System chat send error:", e);
    return NextResponse.json({ success: false, error: "发送失败" }, { status: 500 });
  }
}
