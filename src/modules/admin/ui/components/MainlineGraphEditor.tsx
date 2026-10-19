"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Empty, Popconfirm, Space, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import DarkTag from "@/modules/shared/ui/components/DarkTag";

const { Text, Paragraph } = Typography;

const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 560;
const NODE_RADIUS = 26;
const NODE_GAP = 140;
const NODE_SIDE_PADDING = 72;
const NODE_ROW_GAP = 132;
const NODE_TOP_PADDING = 90;
const NODE_BOTTOM_PADDING = 90;

interface MainQuestNode {
  id: string;
  name: string;
  minRealm: number;
}

interface MainlineEdge {
  fromQuestId: string;
  toQuestId: string;
}

interface NodeWithPosition extends MainQuestNode {
  x: number;
  y: number;
}

interface GraphLayout {
  nodes: NodeWithPosition[];
  canvasHeight: number;
}

interface MainlineGraphResponse {
  success: boolean;
  data?: {
    quests: MainQuestNode[];
    edges: MainlineEdge[];
    isStrictChain: boolean;
    issues: string[];
  };
  error?: string;
}

function normalizeNode(row: Partial<MainQuestNode>) {
  return {
    id: String(row.id || ""),
    name: String(row.name || row.id || ""),
    minRealm: Number(row.minRealm || 1),
  };
}

function normalizeEdge(row: Partial<MainlineEdge>): MainlineEdge | null {
  const fromQuestId = String(row.fromQuestId || "").trim();
  const toQuestId = String(row.toQuestId || "").trim();

  if (!fromQuestId || !toQuestId) {
    return null;
  }

  return { fromQuestId, toQuestId };
}

function edgeKey(edge: MainlineEdge) {
  return `${edge.fromQuestId}::${edge.toQuestId}`;
}

function calcNodesPerRow(canvasWidth: number) {
  const contentWidth = Math.max(canvasWidth - NODE_SIDE_PADDING * 2, NODE_GAP);
  return Math.max(1, Math.floor(contentWidth / NODE_GAP) + 1);
}

function buildNodeLayout(nodes: MainQuestNode[], canvasWidth: number): GraphLayout {
  if (nodes.length === 0) {
    return {
      nodes: [],
      canvasHeight: CANVAS_HEIGHT,
    };
  }

  const nodesPerRow = calcNodesPerRow(canvasWidth);
  const totalRows = Math.ceil(nodes.length / nodesPerRow);
  const contentWidth = Math.max(canvasWidth - NODE_SIDE_PADDING * 2, 0);
  const positioned: NodeWithPosition[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const row = Math.floor(index / nodesPerRow);
    const rowStart = row * nodesPerRow;
    const rowEnd = Math.min(rowStart + nodesPerRow, nodes.length);
    const rowCount = rowEnd - rowStart;
    const rowIndex = index - rowStart;

    // 蛇形排布：奇数行反向，减少跨行长回拉线。
    const visualColumn = row % 2 === 0 ? rowIndex : rowCount - rowIndex - 1;
    const x = rowCount === 1
      ? NODE_SIDE_PADDING + (contentWidth / 2)
      : NODE_SIDE_PADDING + (contentWidth * visualColumn) / (rowCount - 1);
    const y = totalRows === 1
      ? CANVAS_HEIGHT / 2
      : NODE_TOP_PADDING + row * NODE_ROW_GAP;

    positioned.push({
      ...node,
      x,
      y,
    });
  }

  const contentHeight = totalRows === 1
    ? CANVAS_HEIGHT
    : NODE_TOP_PADDING + Math.max(totalRows - 1, 0) * NODE_ROW_GAP + NODE_BOTTOM_PADDING;

  return {
    nodes: positioned,
    canvasHeight: Math.max(CANVAS_HEIGHT, contentHeight),
  };
}

function orderQuestsByEdges(quests: MainQuestNode[], edges: MainlineEdge[]) {
  if (quests.length <= 1) {
    return quests;
  }

  const sortedQuests = quests
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const questById = new Map<string, MainQuestNode>(
    sortedQuests.map((quest) => [quest.id, quest]),
  );

  const predecessorByQuestId = new Map<string, string>();
  const successorByQuestId = new Map<string, string>();

  dedupEdges(edges).forEach((edge) => {
    if (
      !questById.has(edge.fromQuestId)
      || !questById.has(edge.toQuestId)
      || edge.fromQuestId === edge.toQuestId
    ) {
      return;
    }
    if (!successorByQuestId.has(edge.fromQuestId)) {
      successorByQuestId.set(edge.fromQuestId, edge.toQuestId);
    }
    if (!predecessorByQuestId.has(edge.toQuestId)) {
      predecessorByQuestId.set(edge.toQuestId, edge.fromQuestId);
    }
  });

  const startQuest = sortedQuests.find((quest) => !predecessorByQuestId.has(quest.id));
  const ordered: MainQuestNode[] = [];
  const visited = new Set<string>();

  let cursor = startQuest?.id || sortedQuests[0].id;
  while (cursor && !visited.has(cursor)) {
    const currentQuest = questById.get(cursor);
    if (!currentQuest) {
      break;
    }
    ordered.push(currentQuest);
    visited.add(cursor);
    cursor = successorByQuestId.get(cursor) || "";
  }

  sortedQuests.forEach((quest) => {
    if (!visited.has(quest.id)) {
      ordered.push(quest);
    }
  });

  return ordered;
}

function sortEdges(edges: MainlineEdge[]) {
  return edges
    .slice()
    .sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
}

function dedupEdges(edges: MainlineEdge[]) {
  const mapped = new Map<string, MainlineEdge>();
  for (const edge of edges) {
    if (!mapped.has(edgeKey(edge))) {
      mapped.set(edgeKey(edge), edge);
    }
  }
  return [...mapped.values()];
}

export default function MainlineGraphEditor() {
  const { message } = App.useApp();
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quests, setQuests] = useState<MainQuestNode[]>([]);
  const [savedEdges, setSavedEdges] = useState<MainlineEdge[]>([]);
  const [edges, setEdges] = useState<MainlineEdge[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [activeSourceQuestId, setActiveSourceQuestId] = useState<string | null>(null);
  const [activeEdgeKey, setActiveEdgeKey] = useState<string | null>(null);
  const [graphViewportWidth, setGraphViewportWidth] = useState(CANVAS_WIDTH);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/mainline-graph", {
        method: "GET",
        cache: "no-store",
      });
      const result = await response.json() as MainlineGraphResponse;

      if (!result.success || !result.data) {
        throw new Error(result.error || "读取主线编排失败");
      }

      const normalizedNodes = (Array.isArray(result.data.quests) ? result.data.quests : [])
        .map((item) => normalizeNode(item))
        .filter((item) => item.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const normalizedEdges = dedupEdges(
        (Array.isArray(result.data.edges) ? result.data.edges : [])
          .map((item) => normalizeEdge(item))
          .filter((item): item is MainlineEdge => Boolean(item)),
      );

      setQuests(normalizedNodes);
      setSavedEdges(normalizedEdges);
      setEdges(normalizedEdges);
      setIssues(Array.isArray(result.data.issues) ? result.data.issues : []);
      setActiveSourceQuestId(null);
      setActiveEdgeKey(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "读取主线编排失败";
      message.error(errorMessage);
      setQuests([]);
      setSavedEdges([]);
      setEdges([]);
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const element = graphViewportRef.current;
    if (!element) {
      return;
    }

    const syncWidth = () => {
      const next = Math.floor(element.clientWidth);
      if (!Number.isFinite(next) || next <= 0) {
        return;
      }
      setGraphViewportWidth((current) => {
        const normalized = Math.max(CANVAS_WIDTH, next);
        return current === normalized ? current : normalized;
      });
    };

    syncWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        syncWidth();
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", syncWidth);
    return () => {
      window.removeEventListener("resize", syncWidth);
    };
  }, [loading, quests.length]);

  const orderedQuests = useMemo(() => {
    return orderQuestsByEdges(quests, edges);
  }, [quests, edges]);

  const graphCanvasWidth = useMemo(
    () => Math.max(CANVAS_WIDTH, graphViewportWidth),
    [graphViewportWidth],
  );

  const graphLayout = useMemo(
    () => buildNodeLayout(orderedQuests, graphCanvasWidth),
    [orderedQuests, graphCanvasWidth],
  );

  const nodes = graphLayout.nodes;
  const graphCanvasHeight = graphLayout.canvasHeight;

  const nodeMap = useMemo(() => {
    const mapped = new Map<string, NodeWithPosition>();
    nodes.forEach((node) => {
      mapped.set(node.id, node);
    });
    return mapped;
  }, [nodes]);

  const questNameMap = useMemo(() => {
    const mapped = new Map<string, string>();
    quests.forEach((quest) => {
      mapped.set(quest.id, quest.name);
    });
    return mapped;
  }, [quests]);

  const edgeByFrom = useMemo(() => {
    const mapped = new Map<string, MainlineEdge>();
    edges.forEach((edge) => {
      mapped.set(edge.fromQuestId, edge);
    });
    return mapped;
  }, [edges]);

  const edgeByTo = useMemo(() => {
    const mapped = new Map<string, MainlineEdge>();
    edges.forEach((edge) => {
      mapped.set(edge.toQuestId, edge);
    });
    return mapped;
  }, [edges]);

  const inOutCount = useMemo(() => {
    const mapped = new Map<string, { in: number; out: number }>();
    quests.forEach((quest) => {
      mapped.set(quest.id, { in: 0, out: 0 });
    });
    edges.forEach((edge) => {
      const from = mapped.get(edge.fromQuestId);
      if (from) {
        from.out += 1;
      }
      const to = mapped.get(edge.toQuestId);
      if (to) {
        to.in += 1;
      }
    });
    return mapped;
  }, [quests, edges]);

  const dirty = useMemo(() => {
    const savedKeys = sortEdges(savedEdges).map((edge) => edgeKey(edge)).join("|");
    const draftKeys = sortEdges(edges).map((edge) => edgeKey(edge)).join("|");
    return savedKeys !== draftKeys;
  }, [savedEdges, edges]);

  const renderEdges = useMemo(() => {
    return dedupEdges(edges).filter((edge) => {
      return nodeMap.has(edge.fromQuestId) && nodeMap.has(edge.toQuestId);
    });
  }, [edges, nodeMap]);

  const activeEdge = useMemo(() => {
    if (!activeEdgeKey) {
      return null;
    }
    return edges.find((edge) => edgeKey(edge) === activeEdgeKey) || null;
  }, [activeEdgeKey, edges]);

  const createEdge = useCallback((fromQuestId: string, toQuestId: string) => {
    if (!fromQuestId || !toQuestId) {
      return;
    }

    if (fromQuestId === toQuestId) {
      message.warning("同一任务不能连到自己");
      return;
    }

    if (edges.some((edge) => edge.fromQuestId === fromQuestId && edge.toQuestId === toQuestId)) {
      message.warning("该有向连线已存在");
      return;
    }

    const outEdge = edgeByFrom.get(fromQuestId);
    if (outEdge) {
      message.warning("一个节点只能有一个后继，请先删除旧连线");
      return;
    }

    const inEdge = edgeByTo.get(toQuestId);
    if (inEdge) {
      message.warning("一个节点只能有一个前置，请先删除旧连线");
      return;
    }

    setEdges((prev) => [...prev, { fromQuestId, toQuestId }]);
    setActiveSourceQuestId(null);
    setActiveEdgeKey(null);
  }, [edgeByFrom, edgeByTo, edges, message]);

  const deleteEdge = useCallback((targetKey: string) => {
    setEdges((prev) => prev.filter((edge) => edgeKey(edge) !== targetKey));
    setActiveEdgeKey(null);
  }, []);

  const saveGraph = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/mainline-graph", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          edges: dedupEdges(edges),
        }),
      });
      const result = await response.json();

      if (!result.success) {
        message.error(result.error || "保存主线编排失败");
        return;
      }

      message.success("主线编排已保存");
      await loadGraph();
    } catch {
      message.error("保存主线编排失败");
    } finally {
      setSaving(false);
    }
  }, [edges, loadGraph, message]);

  const columns: ColumnsType<MainQuestNode> = useMemo(() => {
    return [
      {
        title: "任务",
        dataIndex: "name",
        key: "name",
        ellipsis: true,
        render: (value: string, record) => (
          <Text strong={record.id === activeSourceQuestId}>{value}</Text>
        ),
      },
      {
        title: "境界",
        dataIndex: "minRealm",
        key: "minRealm",
        width: 88,
        align: "right",
        render: (value: number) => <DarkTag color="default">R{value}</DarkTag>,
      },
      {
        title: "入/出",
        key: "degree",
        width: 88,
        align: "right",
        render: (_, record) => {
          const count = inOutCount.get(record.id) || { in: 0, out: 0 };
          return <DarkTag color="blue">{count.in}/{count.out}</DarkTag>;
        },
      },
    ];
  }, [activeSourceQuestId, inOutCount]);

  return (
    <Card
      title="主线任务编排"
      extra={(
        <Space>
          {dirty && <DarkTag color="gold">有未保存变更</DarkTag>}
          <Button loading={loading} onClick={() => void loadGraph()}>重置</Button>
          <Button type="primary" disabled={!dirty || loading} loading={saving} onClick={() => void saveGraph()}>
            保存
          </Button>
        </Space>
      )}
    >
      <Space align="start" size={16} style={{ width: "100%" }}>
        <div style={{ flex: 1 }}>
          <Paragraph type="secondary" style={{ marginTop: 0 }}>
            点击一个节点选起点，再点击另一个节点创建有向连线（A → B 表示先完成 A，才能接 B）。点击线条可选中并删除。
          </Paragraph>

          <div
            style={{
              border: "1px solid #2a2520",
              borderRadius: 8,
              padding: 8,
              background: "#0d0d0f",
              minHeight: CANVAS_HEIGHT + 16,
            }}
          >
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: CANVAS_HEIGHT }}>
                <Spin />
              </div>
            ) : quests.length === 0 ? (
              <div style={{ height: CANVAS_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Empty description="暂无主线任务" />
              </div>
            ) : (
              <div
                ref={graphViewportRef}
                style={{ width: "100%", height: CANVAS_HEIGHT, overflowX: "auto", overflowY: "auto" }}
              >
                <svg
                  width={graphCanvasWidth}
                  height={graphCanvasHeight}
                  viewBox={`0 0 ${graphCanvasWidth} ${graphCanvasHeight}`}
                  style={{ display: "block", margin: "0 auto" }}
                >
                  <defs>
                    <marker id="mainline-arrow-normal" markerWidth="10" markerHeight="7" refX="8" refY="3.5" orient="auto">
                      <polygon points="0 0, 10 3.5, 0 7" fill="#5b616a" />
                    </marker>
                    <marker id="mainline-arrow-active" markerWidth="10" markerHeight="7" refX="8" refY="3.5" orient="auto">
                      <polygon points="0 0, 10 3.5, 0 7" fill="#ff7875" />
                    </marker>
                  </defs>
                  {renderEdges.map((edge) => {
                    const from = nodeMap.get(edge.fromQuestId);
                    const to = nodeMap.get(edge.toQuestId);
                    if (!from || !to) {
                      return null;
                    }

                    const key = edgeKey(edge);
                    const selected = key === activeEdgeKey;

                    return (
                      <g key={key}>
                        <line
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke={selected ? "#ff7875" : "#5b616a"}
                          strokeWidth={selected ? 4 : 2}
                          markerEnd={selected ? "url(#mainline-arrow-active)" : "url(#mainline-arrow-normal)"}
                        />
                        <line
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke="transparent"
                          strokeWidth={16}
                          pointerEvents="stroke"
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            if (saving) {
                              return;
                            }
                            setActiveEdgeKey(key);
                            setActiveSourceQuestId(null);
                          }}
                        />
                      </g>
                    );
                  })}
                  {nodes.map((node) => {
                    const selected = activeSourceQuestId === node.id;
                    const shortName = node.name.length > 5 ? `${node.name.slice(0, 5)}…` : node.name;

                    return (
                      <g
                        key={node.id}
                        style={{ cursor: saving ? "not-allowed" : "pointer" }}
                        onClick={() => {
                          if (saving) {
                            return;
                          }

                          if (activeSourceQuestId && activeSourceQuestId !== node.id) {
                            createEdge(activeSourceQuestId, node.id);
                            return;
                          }

                          if (activeSourceQuestId === node.id) {
                            setActiveSourceQuestId(null);
                            return;
                          }

                          setActiveSourceQuestId(node.id);
                          setActiveEdgeKey(null);
                        }}
                      >
                        <title>{`${node.name} (${node.id})`}</title>
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={NODE_RADIUS}
                          fill={selected ? "#3b2f15" : "#1a1a20"}
                          stroke={selected ? "#c9a84c" : "#3a3a3a"}
                          strokeWidth={selected ? 2 : 1}
                        />
                        <text
                          x={node.x}
                          y={node.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#f5f5f5"
                          fontSize={11}
                          style={{ userSelect: "none" }}
                        >
                          {shortName}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 360 }}>
          <Space orientation="vertical" style={{ width: "100%" }}>
            <Card size="small" title="当前操作" loading={saving}>
              {activeEdge ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Text>
                    已选边：{questNameMap.get(activeEdge.fromQuestId) || activeEdge.fromQuestId}
                    {" "}<Text type="secondary">→</Text>{" "}
                    {questNameMap.get(activeEdge.toQuestId) || activeEdge.toQuestId}
                  </Text>
                  <Popconfirm
                    title="确认删除该连线？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => deleteEdge(edgeKey(activeEdge))}
                  >
                    <Button danger>删除选中边</Button>
                  </Popconfirm>
                </Space>
              ) : activeSourceQuestId ? (
                <Text type="secondary">已选起点，点击另一个节点创建连线</Text>
              ) : (
                <Text type="secondary">请先点击节点或边</Text>
              )}
            </Card>

            <Card size="small" title={`主线任务 (${quests.length})`}>
              <Table<MainQuestNode>
                size="small"
                rowKey={(item) => item.id}
                columns={columns}
                dataSource={quests}
                pagination={false}
                onRow={(item) => ({
                  onClick: () => {
                    setActiveSourceQuestId(item.id);
                    setActiveEdgeKey(null);
                  },
                  style: {
                    cursor: "pointer",
                    background: item.id === activeSourceQuestId ? "rgba(201, 168, 76, 0.12)" : undefined,
                  },
                })}
              />
            </Card>

            {issues.length > 0 && (
              <Card size="small" title="配置提示">
                <Space orientation="vertical" size={4}>
                  {issues.map((issue) => (
                    <Text key={issue} type="warning">{issue}</Text>
                  ))}
                </Space>
              </Card>
            )}
          </Space>
        </div>
      </Space>
    </Card>
  );
}
