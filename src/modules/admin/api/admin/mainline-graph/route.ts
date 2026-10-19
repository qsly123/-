import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { quests } from "@/db/schema";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";

const MAIN_CATEGORY = "main";

interface MainQuestRow {
  id: string;
  name: string;
  minRealm: number;
  prerequisites: string[] | null;
}

interface MainlineEdge {
  fromQuestId: string;
  toQuestId: string;
}

interface ValidateResult {
  success: boolean;
  error?: string;
  predecessorByQuestId?: Map<string, string | null>;
}

function normalizePrerequisites(value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const questId = item.trim();
    if (!questId || seen.has(questId)) {
      continue;
    }
    seen.add(questId);
    result.push(questId);
  }

  return result;
}

function edgeKey(edge: MainlineEdge) {
  return `${edge.fromQuestId}::${edge.toQuestId}`;
}

function dedupEdges(edges: MainlineEdge[]) {
  const mapped = new Map<string, MainlineEdge>();
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (!mapped.has(key)) {
      mapped.set(key, edge);
    }
  }
  return [...mapped.values()];
}

function validateStrictMainlineChain(questIds: string[], edgesInput: MainlineEdge[]): ValidateResult {
  const questIdSet = new Set(questIds);
  const edges = dedupEdges(edgesInput);

  if (questIds.length === 0) {
    if (edges.length > 0) {
      return {
        success: false,
        error: "当前无主线任务，不能保存连线。",
      };
    }
    return {
      success: true,
      predecessorByQuestId: new Map<string, string | null>(),
    };
  }

  const incoming = new Map<string, string>();
  const outgoing = new Map<string, string>();

  for (const edge of edges) {
    const from = edge.fromQuestId.trim();
    const to = edge.toQuestId.trim();

    if (!from || !to) {
      return {
        success: false,
        error: "存在空的主线连线节点。",
      };
    }

    if (!questIdSet.has(from) || !questIdSet.has(to)) {
      return {
        success: false,
        error: "主线连线引用了不存在的任务。",
      };
    }

    if (from === to) {
      return {
        success: false,
        error: "主线连线不允许自环。",
      };
    }

    if (outgoing.has(from) && outgoing.get(from) !== to) {
      return {
        success: false,
        error: "每个主线任务只能有一个后继任务。",
      };
    }

    if (incoming.has(to) && incoming.get(to) !== from) {
      return {
        success: false,
        error: "每个主线任务只能有一个前置任务。",
      };
    }

    outgoing.set(from, to);
    incoming.set(to, from);
  }

  if (questIds.length === 1) {
    if (edges.length > 0) {
      return {
        success: false,
        error: "仅有一个主线任务时，不应存在连线。",
      };
    }
    return {
      success: true,
      predecessorByQuestId: new Map<string, string | null>([[questIds[0], null]]),
    };
  }

  if (edges.length !== questIds.length - 1) {
    return {
      success: false,
      error: "主线需为单链结构，连线数量必须等于任务数减一。",
    };
  }

  const startNodes = questIds.filter((questId) => !incoming.has(questId));
  const endNodes = questIds.filter((questId) => !outgoing.has(questId));

  if (startNodes.length !== 1) {
    return {
      success: false,
      error: "主线需且仅需一个起点任务。",
    };
  }

  if (endNodes.length !== 1) {
    return {
      success: false,
      error: "主线需且仅需一个终点任务。",
    };
  }

  const visited = new Set<string>();
  let cursor: string | undefined = startNodes[0];

  while (cursor) {
    if (visited.has(cursor)) {
      return {
        success: false,
        error: "主线连线存在环，无法保存。",
      };
    }
    visited.add(cursor);
    cursor = outgoing.get(cursor);
  }

  if (visited.size !== questIds.length) {
    return {
      success: false,
      error: "主线连线不连通，存在断点。",
    };
  }

  const predecessorByQuestId = new Map<string, string | null>();
  for (const questId of questIds) {
    predecessorByQuestId.set(questId, incoming.get(questId) || null);
  }

  return {
    success: true,
    predecessorByQuestId,
  };
}

async function loadMainQuests() {
  const rows = await db.select({
    id: quests.id,
    name: quests.name,
    minRealm: quests.minRealm,
    prerequisites: quests.prerequisites,
  })
    .from(quests)
    .where(eq(quests.questCategory, MAIN_CATEGORY))
    .orderBy(asc(quests.id))
    .all() as MainQuestRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    minRealm: Number(row.minRealm || 1),
    prerequisites: normalizePrerequisites(row.prerequisites),
  }));
}

function buildEdgesFromQuests(mainQuests: Array<{ id: string; prerequisites: string[] }>) {
  const questIdSet = new Set(mainQuests.map((quest) => quest.id));
  const edges: MainlineEdge[] = [];
  const issues: string[] = [];

  for (const quest of mainQuests) {
    for (const preId of quest.prerequisites) {
      if (!questIdSet.has(preId)) {
        issues.push(`任务 ${quest.id} 的前置任务 ${preId} 不在主线集合中`);
        continue;
      }
      edges.push({
        fromQuestId: preId,
        toQuestId: quest.id,
      });
    }
  }

  return {
    edges: dedupEdges(edges),
    issues,
  };
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  const mainQuests = await loadMainQuests();
  const { edges, issues } = buildEdgesFromQuests(mainQuests);
  const validateResult = validateStrictMainlineChain(
    mainQuests.map((quest) => quest.id),
    edges,
  );

  const combinedIssues = [...issues];
  if (!validateResult.success && validateResult.error) {
    combinedIssues.push(validateResult.error);
  }

  return NextResponse.json({
    success: true,
    data: {
      quests: mainQuests.map((quest) => ({
        id: quest.id,
        name: quest.name,
        minRealm: quest.minRealm,
      })),
      edges,
      isStrictChain: validateResult.success,
      issues: combinedIssues,
    },
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const rawEdges = Array.isArray(body?.edges) ? body.edges : null;

    if (!rawEdges) {
      return NextResponse.json({ success: false, error: "缺少 edges 数组" }, { status: 400 });
    }

    const edges: MainlineEdge[] = rawEdges.map((edge: Record<string, unknown>) => ({
      fromQuestId: String(edge?.fromQuestId || "").trim(),
      toQuestId: String(edge?.toQuestId || "").trim(),
    }));

    const mainQuests = await loadMainQuests();
    const questIds = mainQuests.map((quest) => quest.id);
    const validateResult = validateStrictMainlineChain(questIds, edges);

    if (!validateResult.success || !validateResult.predecessorByQuestId) {
      return NextResponse.json(
        { success: false, error: validateResult.error || "主线结构校验失败" },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      for (const questId of questIds) {
        const predecessor = validateResult.predecessorByQuestId?.get(questId) || null;
        const prerequisites = predecessor ? [predecessor] : [];

        await tx.update(quests)
          .set({
            prerequisites,
          })
          .where(and(eq(quests.id, questId), eq(quests.questCategory, MAIN_CATEGORY)))
          .run();
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        questCount: questIds.length,
        edgeCount: dedupEdges(edges).length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存主线编排失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
