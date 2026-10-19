import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  createCoreGongfaBook,
  listCoreGongfaBooks,
  updateCoreGongfaBook,
  type GongfaBookInput,
} from "@/modules/character/services/gongfa-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    return NextResponse.json({
      success: true,
      data: {
        books: await listCoreGongfaBooks(true),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取功法配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as GongfaBookInput;
    await createCoreGongfaBook(body);
    return NextResponse.json({ success: true, data: { books: await listCoreGongfaBooks(true) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建功法失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as GongfaBookInput;
    const id = Math.floor(Number(body.id || 0));
    await updateCoreGongfaBook(id, body);
    return NextResponse.json({ success: true, data: { books: await listCoreGongfaBooks(true) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存功法失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
