import { randomUUID } from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  buildUploadsPublicUrl,
  getPreferredUploadsRoot,
} from "@/modules/shared/services/upload-storage";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPE_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function normalizeCategory(value: unknown) {
  if (value === "avatar") {
    return "avatar";
  }
  if (value === "avatar-frame") {
    return "avatar-frame";
  }
  if (value === "npc-avatar") {
    return "npc-avatar";
  }
  if (value === "npc-portrait") {
    return "npc-portrait";
  }
  if (value === "item") {
    return "item";
  }
  if (value === "monster") {
    return "monster";
  }
  if (value === "map-background") {
    return "map-background";
  }
  if (value === "event-illustration") {
    return "event-illustration";
  }
  if (value === "event-icon") {
    return "event-icon";
  }
  if (value === "skill-effect") {
    return "skill-effect";
  }
  if (value === "gongfa") {
    return "gongfa";
  }
  return "common";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const formData = await request.formData();
    const category = normalizeCategory(formData.get("category"));
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "缺少文件" }, { status: 400 });
    }

    const extension = ALLOWED_MIME_TYPE_TO_EXT[file.type];
    if (!extension) {
      return NextResponse.json({ success: false, error: "仅支持 png/jpg/webp/gif" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "文件不能超过 5MB" }, { status: 400 });
    }

    const uploadsRoot = await getPreferredUploadsRoot();
    const folder = path.join(uploadsRoot, "cosmetics", category);
    await mkdir(folder, { recursive: true });

    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
    const fullPath = path.join(folder, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);

    const imageUrl = buildUploadsPublicUrl("cosmetics", category, filename);
    return NextResponse.json({
      success: true,
      data: {
        imageUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
