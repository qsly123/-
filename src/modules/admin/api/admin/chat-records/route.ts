import { NextResponse } from "next/server";
import { and, count, desc, eq, gte, inArray, like, lte, or, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, dmConversations, dmMessages, players } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { getPlayerMapByIds } from "@/modules/social/infrastructure/social-service";

type ChatTab = "world" | "dm";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

class ChatRecordError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseTab(value: unknown): ChatTab {
  if (value === "world" || value === "dm") {
    return value;
  }
  throw new ChatRecordError("tab 非法");
}

function parsePage(raw: string | null, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
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

function parseDateTime(value: unknown, fieldName: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw new ChatRecordError(`${fieldName} 非法`);
  }
  return new Date(timestamp).toISOString();
}

function parseIds(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as number[];
  }

  const dedup = new Set<number>();
  for (const value of raw) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new ChatRecordError("ids 非法");
    }
    dedup.add(Math.floor(parsed));
  }

  return [...dedup];
}

function buildWhereClause(conditions: SQLWrapper[]) {
  if (!conditions.length) {
    return undefined;
  }
  return and(...conditions);
}

function validateTimeRange(startAt?: string, endAt?: string) {
  if (startAt && endAt && startAt > endAt) {
    throw new ChatRecordError("开始时间不能晚于结束时间");
  }
}

async function listWorldRecords(input: {
  page: number;
  pageSize: number;
  keyword: string;
  startAt?: string;
  endAt?: string;
}) {
  const conditions: SQLWrapper[] = [];
  if (input.keyword) {
    const pattern = `%${input.keyword}%`;
    conditions.push(or(
      like(chatMessages.senderName, pattern),
      like(chatMessages.content, pattern),
      like(chatMessages.playerId, pattern),
    ) as SQLWrapper);
  }
  if (input.startAt) {
    conditions.push(gte(chatMessages.createdAt, input.startAt));
  }
  if (input.endAt) {
    conditions.push(lte(chatMessages.createdAt, input.endAt));
  }

  const whereClause = buildWhereClause(conditions);
  const totalRow = whereClause
    ? await db.select({ total: count() }).from(chatMessages).where(whereClause).get()
    : await db.select({ total: count() }).from(chatMessages).get();

  const total = totalRow?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / input.pageSize));
  const safePage = Math.min(input.page, maxPage);
  const offset = (safePage - 1) * input.pageSize;

  const rows = whereClause
    ? await db.select({
      id: chatMessages.id,
      messageType: chatMessages.messageType,
      playerId: chatMessages.playerId,
      senderName: chatMessages.senderName,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    }).from(chatMessages).where(whereClause).orderBy(desc(chatMessages.id)).limit(input.pageSize).offset(offset).all()
    : await db.select({
      id: chatMessages.id,
      messageType: chatMessages.messageType,
      playerId: chatMessages.playerId,
      senderName: chatMessages.senderName,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    }).from(chatMessages).orderBy(desc(chatMessages.id)).limit(input.pageSize).offset(offset).all();

  return {
    list: rows.map((row) => ({
      ...row,
      messageType: row.messageType === "system" ? "system" : "player",
    })),
    pagination: {
      page: safePage,
      pageSize: input.pageSize,
      total,
    },
  };
}

async function listDmRecords(input: {
  page: number;
  pageSize: number;
  keyword: string;
  startAt?: string;
  endAt?: string;
}) {
  const conditions: SQLWrapper[] = [];
  if (input.keyword) {
    const pattern = `%${input.keyword}%`;
    const senderRows = await db.select({ id: players.id })
      .from(players)
      .where(like(players.name, pattern))
      .limit(200)
      .all();

    const keywordConditions: SQLWrapper[] = [
      like(dmMessages.conversationId, pattern),
      like(dmMessages.senderPlayerId, pattern),
      like(dmMessages.content, pattern),
    ];

    if (senderRows.length > 0) {
      keywordConditions.push(inArray(dmMessages.senderPlayerId, senderRows.map((row) => row.id)));
    }

    conditions.push(or(...keywordConditions) as SQLWrapper);
  }
  if (input.startAt) {
    conditions.push(gte(dmMessages.createdAt, input.startAt));
  }
  if (input.endAt) {
    conditions.push(lte(dmMessages.createdAt, input.endAt));
  }

  const whereClause = buildWhereClause(conditions);
  const totalRow = whereClause
    ? await db.select({ total: count() }).from(dmMessages).where(whereClause).get()
    : await db.select({ total: count() }).from(dmMessages).get();

  const total = totalRow?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / input.pageSize));
  const safePage = Math.min(input.page, maxPage);
  const offset = (safePage - 1) * input.pageSize;

  const rows = whereClause
    ? await db.select({
      id: dmMessages.id,
      conversationId: dmMessages.conversationId,
      senderPlayerId: dmMessages.senderPlayerId,
      content: dmMessages.content,
      createdAt: dmMessages.createdAt,
    }).from(dmMessages).where(whereClause).orderBy(desc(dmMessages.id)).limit(input.pageSize).offset(offset).all()
    : await db.select({
      id: dmMessages.id,
      conversationId: dmMessages.conversationId,
      senderPlayerId: dmMessages.senderPlayerId,
      content: dmMessages.content,
      createdAt: dmMessages.createdAt,
    }).from(dmMessages).orderBy(desc(dmMessages.id)).limit(input.pageSize).offset(offset).all();

  const senderMap = await getPlayerMapByIds(rows.map((row) => row.senderPlayerId));
  return {
    list: rows.map((row) => ({
      ...row,
      senderName: senderMap.get(row.senderPlayerId)?.name || "未知修士",
    })),
    pagination: {
      page: safePage,
      pageSize: input.pageSize,
      total,
    },
  };
}

async function deleteWorldRecords(ids: number[], startAt?: string, endAt?: string) {
  if (ids.length > 0) {
    const deletedRows = await db.delete(chatMessages)
      .where(inArray(chatMessages.id, ids))
      .returning({ id: chatMessages.id })
      .all();
    return deletedRows.length;
  }

  const conditions: SQLWrapper[] = [];
  if (startAt) {
    conditions.push(gte(chatMessages.createdAt, startAt));
  }
  if (endAt) {
    conditions.push(lte(chatMessages.createdAt, endAt));
  }

  const whereClause = buildWhereClause(conditions);
  if (!whereClause) {
    return 0;
  }

  const deletedRows = await db.delete(chatMessages)
    .where(whereClause)
    .returning({ id: chatMessages.id })
    .all();
  return deletedRows.length;
}

async function deleteDmRecords(ids: number[], startAt?: string, endAt?: string) {
  const now = new Date().toISOString();

  return db.transaction(async (tx) => {
    let deletedRows: Array<{ id: number; conversationId: string }> = [];

    if (ids.length > 0) {
      deletedRows = await tx.delete(dmMessages)
        .where(inArray(dmMessages.id, ids))
        .returning({
          id: dmMessages.id,
          conversationId: dmMessages.conversationId,
        })
        .all();
    } else {
      const conditions: SQLWrapper[] = [];
      if (startAt) {
        conditions.push(gte(dmMessages.createdAt, startAt));
      }
      if (endAt) {
        conditions.push(lte(dmMessages.createdAt, endAt));
      }

      const whereClause = buildWhereClause(conditions);
      if (!whereClause) {
        return 0;
      }

      deletedRows = await tx.delete(dmMessages)
        .where(whereClause)
        .returning({
          id: dmMessages.id,
          conversationId: dmMessages.conversationId,
        })
        .all();
    }

    if (!deletedRows.length) {
      return 0;
    }

    const conversationIds = [...new Set(deletedRows.map((row) => row.conversationId))];
    const conversations = await tx.select({
      id: dmConversations.id,
      createdAt: dmConversations.createdAt,
    }).from(dmConversations).where(inArray(dmConversations.id, conversationIds)).all();

    for (const conversation of conversations) {
      const latestMessage = await tx.select({
        content: dmMessages.content,
        createdAt: dmMessages.createdAt,
      }).from(dmMessages).where(eq(dmMessages.conversationId, conversation.id)).orderBy(desc(dmMessages.id)).get();

      await tx.update(dmConversations).set({
        lastMessagePreview: latestMessage?.content || "",
        lastMessageAt: latestMessage?.createdAt || conversation.createdAt,
        updatedAt: now,
      }).where(eq(dmConversations.id, conversation.id)).run();
    }

    return deletedRows.length;
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const tab = parseTab(url.searchParams.get("tab") || "world");
    const page = parsePage(url.searchParams.get("page"), 1);
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));
    const keyword = (url.searchParams.get("keyword") || "").trim();
    const startAt = parseDateTime(url.searchParams.get("startAt"), "startAt");
    const endAt = parseDateTime(url.searchParams.get("endAt"), "endAt");
    validateTimeRange(startAt, endAt);

    const data = tab === "world"
      ? await listWorldRecords({ page, pageSize, keyword, startAt, endAt })
      : await listDmRecords({ page, pageSize, keyword, startAt, endAt });

    return NextResponse.json({
      success: true,
      data: {
        tab,
        ...data,
      },
    });
  } catch (error) {
    if (error instanceof ChatRecordError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Admin chat records list error:", error);
    return NextResponse.json({ success: false, error: "加载聊天记录失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const tab = parseTab(body?.tab);
    const ids = parseIds(body?.ids);
    const startAt = parseDateTime(body?.startAt, "startAt");
    const endAt = parseDateTime(body?.endAt, "endAt");
    validateTimeRange(startAt, endAt);

    if (!ids.length && !startAt && !endAt) {
      throw new ChatRecordError("请提供 ids 或时间范围");
    }

    const deletedCount = tab === "world"
      ? await deleteWorldRecords(ids, startAt, endAt)
      : await deleteDmRecords(ids, startAt, endAt);

    return NextResponse.json({
      success: true,
      data: {
        deletedCount,
      },
    });
  } catch (error) {
    if (error instanceof ChatRecordError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error("Admin chat records delete error:", error);
    return NextResponse.json({ success: false, error: "删除聊天记录失败" }, { status: 500 });
  }
}
