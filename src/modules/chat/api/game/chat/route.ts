import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import {
  CHAT_CONTENT_MAX_LENGTH,
  createChatMessage,
  listChatMessagesByType,
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

    const messages = await listChatMessagesByType("player");

    return NextResponse.json({
      success: true,
      data: {
        playerId: player.id,
        messages,
      },
    });
  } catch (e) {
    console.error("Chat list error:", e);
    return NextResponse.json({ success: false, error: "获取聊天记录失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = await req.json();
    const content = parseContent(body?.content);
    if (!content) {
      return NextResponse.json({ success: false, error: "消息不能为空" }, { status: 400 });
    }
    if (content.length > CHAT_CONTENT_MAX_LENGTH) {
      return NextResponse.json({ success: false, error: `消息不能超过 ${CHAT_CONTENT_MAX_LENGTH} 字` }, { status: 400 });
    }

    const senderName = (player.name || "无名修士").trim() || "无名修士";
    const message = await createChatMessage({
      messageType: "player",
      playerId: player.id,
      senderName,
      content,
    });

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
    console.error("Chat send error:", e);
    return NextResponse.json({ success: false, error: "发送失败" }, { status: 500 });
  }
}
