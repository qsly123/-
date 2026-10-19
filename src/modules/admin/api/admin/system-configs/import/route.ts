import { NextResponse } from "next/server";
import { db } from "@/db";
import { systemConfigs } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { eq } from "drizzle-orm";

interface ImportItem {
  key: string;
  value: string;
  group: string;
  isSecret?: boolean;
  description?: string | null;
}

function validateItem(item: unknown, index: number): ImportItem {
  if (!item || typeof item !== "object") {
    throw new Error(`第 ${index + 1} 项不是有效的对象`);
  }

  const record = item as Record<string, unknown>;

  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key) {
    throw new Error(`第 ${index + 1} 项缺少 key`);
  }

  const value = record.value !== undefined && record.value !== null
    ? String(record.value)
    : "";
  if (!value) {
    throw new Error(`第 ${index + 1} 项（${key}）缺少 value`);
  }

  const group = typeof record.group === "string" ? record.group.trim() : "";
  if (!group) {
    throw new Error(`第 ${index + 1} 项（${key}）缺少 group`);
  }

  const isSecret = typeof record.isSecret === "boolean" ? record.isSecret : false;
  const description = typeof record.description === "string" && record.description.trim()
    ? record.description.trim()
    : null;

  return { key, value, group, isSecret, description };
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "请求体必须是 JSON 数组" },
        { status: 400 },
      );
    }

    if (body.length === 0) {
      return NextResponse.json(
        { success: false, error: "导入数据不能为空" },
        { status: 400 },
      );
    }

    const items = body.map((item, index) => validateItem(item, index));

    let created = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const item of items) {
        const now = new Date().toISOString();
        const existing = await tx
          .select({ key: systemConfigs.key })
          .from(systemConfigs)
          .where(eq(systemConfigs.key, item.key))
          .get();

        if (existing) {
          await tx
            .update(systemConfigs)
            .set({
              value: item.value,
              group: item.group,
              isSecret: item.isSecret ?? false,
              description: item.description ?? null,
              updatedAt: now,
            })
            .where(eq(systemConfigs.key, item.key))
            .run();
          updated++;
        } else {
          await tx
            .insert(systemConfigs)
            .values({
              key: item.key,
              value: item.value,
              group: item.group,
              isSecret: item.isSecret ?? false,
              description: item.description ?? null,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          created++;
        }
      }
    });

    return NextResponse.json({
      success: true,
      data: { total: items.length, created, updated },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
