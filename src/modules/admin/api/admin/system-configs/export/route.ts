import { NextResponse } from "next/server";
import { db } from "@/db";
import { systemConfigs } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const rows = await db.select().from(systemConfigs).all();

    const exportData = rows.map((row) => ({
      key: row.key,
      value: row.value,
      group: row.group,
      isSecret: row.isSecret,
      description: row.description,
    }));

    const json = JSON.stringify(exportData, null, 2);
    const filename = `system-configs-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
