import { NextResponse } from "next/server";
import { and, count, desc, eq, like, or, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { avatarFrameAssets } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePage(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PAGE;
  }
  return Math.floor(parsed);
}

function parsePageSize(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.floor(parsed));
}

function parseBoolean(raw: unknown) {
  if (raw === true || raw === "true" || raw === 1 || raw === "1") {
    return true;
  }
  if (raw === false || raw === "false" || raw === 0 || raw === "0") {
    return false;
  }
  return undefined;
}

function parseSortOrder(raw: unknown) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeId(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function normalizeText(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get("page"));
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));
    const keyword = normalizeText(url.searchParams.get("keyword"));
    const enabled = parseBoolean(url.searchParams.get("enabled"));
    const isPublic = parseBoolean(url.searchParams.get("isPublic"));

    const conditions: SQLWrapper[] = [];
    if (keyword) {
      const pattern = `%${keyword}%`;
      conditions.push(or(
        like(avatarFrameAssets.id, pattern),
        like(avatarFrameAssets.name, pattern),
        like(avatarFrameAssets.imageUrl, pattern),
      ) as SQLWrapper);
    }
    if (enabled !== undefined) {
      conditions.push(eq(avatarFrameAssets.enabled, enabled));
    }
    if (isPublic !== undefined) {
      conditions.push(eq(avatarFrameAssets.isPublic, isPublic));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const totalRow = whereClause
      ? await db.select({ total: count() }).from(avatarFrameAssets).where(whereClause).get()
      : await db.select({ total: count() }).from(avatarFrameAssets).get();

    const total = Number(totalRow?.total || 0);
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, maxPage);
    const offset = (safePage - 1) * pageSize;

    const list = whereClause
      ? await db.select().from(avatarFrameAssets)
        .where(whereClause)
        .orderBy(avatarFrameAssets.sortOrder, desc(avatarFrameAssets.createdAt))
        .limit(pageSize)
        .offset(offset)
        .all()
      : await db.select().from(avatarFrameAssets)
        .orderBy(avatarFrameAssets.sortOrder, desc(avatarFrameAssets.createdAt))
        .limit(pageSize)
        .offset(offset)
        .all();

    return NextResponse.json({
      success: true,
      data: {
        list,
        pagination: {
          page: safePage,
          pageSize,
          total,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载头像框资源失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const id = normalizeId(body.id);
    const name = normalizeText(body.name);
    const imageUrl = normalizeText(body.imageUrl);
    const now = new Date().toISOString();

    if (!name) {
      return NextResponse.json({ success: false, error: "名称不能为空" }, { status: 400 });
    }
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: "图片地址不能为空" }, { status: 400 });
    }

    await db.insert(avatarFrameAssets).values({
      ...(id ? { id } : {}),
      name,
      imageUrl,
      isPublic: parseBoolean(body.isPublic) ?? true,
      enabled: parseBoolean(body.enabled) ?? true,
      sortOrder: parseSortOrder(body.sortOrder),
      createdAt: now,
      updatedAt: now,
    }).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建头像框资源失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const id = normalizeId(body.id);
    if (!id) {
      return NextResponse.json({ success: false, error: "缺少 id" }, { status: 400 });
    }

    const payload: Partial<typeof avatarFrameAssets.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      const value = normalizeText(body.name);
      if (!value) {
        return NextResponse.json({ success: false, error: "名称不能为空" }, { status: 400 });
      }
      payload.name = value;
    }
    if (body.imageUrl !== undefined) {
      const value = normalizeText(body.imageUrl);
      if (!value) {
        return NextResponse.json({ success: false, error: "图片地址不能为空" }, { status: 400 });
      }
      payload.imageUrl = value;
    }
    if (body.isPublic !== undefined) {
      payload.isPublic = parseBoolean(body.isPublic) ?? false;
    }
    if (body.enabled !== undefined) {
      payload.enabled = parseBoolean(body.enabled) ?? false;
    }
    if (body.sortOrder !== undefined) {
      payload.sortOrder = parseSortOrder(body.sortOrder);
    }

    await db.update(avatarFrameAssets).set(payload).where(eq(avatarFrameAssets.id, id)).run();
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新头像框资源失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as { id?: unknown };
    const id = normalizeId(body.id);
    if (!id) {
      return NextResponse.json({ success: false, error: "缺少 id" }, { status: 400 });
    }

    await db.delete(avatarFrameAssets).where(eq(avatarFrameAssets.id, id)).run();
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除头像框资源失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
