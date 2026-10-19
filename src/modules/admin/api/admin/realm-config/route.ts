import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  createRealmMajor,
  deleteRealmMajor,
  listRealmConfigMajors,
  updateRealmMajor,
} from "@/modules/admin/services/realm-config-mutation";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const majors = await listRealmConfigMajors();
    return NextResponse.json({
      success: true,
      data: { majors },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取境界配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const payload = body?.major ?? body;
    const major = await createRealmMajor(payload);

    return NextResponse.json({
      success: true,
      data: { major },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "新增大境界失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const payload = body?.major ?? body;
    const major = await updateRealmMajor(payload);

    return NextResponse.json({
      success: true,
      data: { major },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "境界配置更新失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const payload = (body?.majorId ?? body?.id ?? body) as unknown;
    const result = await deleteRealmMajor(payload);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除大境界失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
