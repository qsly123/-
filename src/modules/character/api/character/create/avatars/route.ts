import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentAccount } from "@/modules/auth/services/auth";
import { db } from "@/db";
import { avatarAssets } from "@/db/schema";

function normalizeGender(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isValidGender(value: string) {
  return value === "男" || value === "女";
}

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const searchParams = new URL(request.url).searchParams;
    const gender = normalizeGender(searchParams.get("gender"));
    if (!isValidGender(gender)) {
      return NextResponse.json({ success: false, error: "性别仅支持男/女" }, { status: 400 });
    }

    const avatars = await db.select({
      id: avatarAssets.id,
      name: avatarAssets.name,
      imageUrl: avatarAssets.imageUrl,
      sortOrder: avatarAssets.sortOrder,
    }).from(avatarAssets)
      .where(and(
        eq(avatarAssets.enabled, true),
        eq(avatarAssets.isPublic, true),
        eq(avatarAssets.gender, gender),
      ))
      .orderBy(asc(avatarAssets.sortOrder), asc(avatarAssets.createdAt))
      .all();

    return NextResponse.json({
      success: true,
      data: {
        avatars,
      },
    });
  } catch (error) {
    console.error("Create avatars error:", error);
    return NextResponse.json({ success: false, error: "获取可用头像失败" }, { status: 500 });
  }
}
