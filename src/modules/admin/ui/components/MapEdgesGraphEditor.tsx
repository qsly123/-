"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Popconfirm, Space, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import DarkTag from "@/modules/shared/ui/components/DarkTag";

const { Text, Paragraph } = Typography;

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 560;
const NODE_RADIUS = 26;

interface MapNode {
  id: string;
  name: string;
  mapType: string;
  minRealm: number;
}

interface MapEdge {
  id: number;
  mapAId: string;
  mapBId: string;
}

interface NodeWithPosition extends MapNode {
  x: number;
  y: number;
}

interface AdminListResponse<T> {
  success: boolean;
  data?: {
    list: T[];
    pagination?: {
      page: number;
      pageSize: number;
      total: number;
    };
  };
  error?: string;
}

function normalizeMapNode(row: Record<string, unknown>): MapNode {
  return {
    id: String(row.id || ""),
    name: String(row.name || row.id || ""),
    mapType: String(row.mapType || "field"),
    minRealm: Number(row.minRealm || 1),
  };
}

function normalizeMapEdge(row: Record<string, unknown>): MapEdge | null {
  const id = Number(row.id);
  const mapAId = String(row.mapAId || "").trim();
  const mapBId = String(row.mapBId || "").trim();

  if (!Number.isFinite(id) || !mapAId || !mapBId) {
    return null;
  }

  return {
    id,
    mapAId,
    mapBId,
  };
}

function normalizeEdgePair(a: string, b: string) {
  return a.localeCompare(b) <= 0
    ? { mapAId: a, mapBId: b }
    : { mapAId: b, mapBId: a };
}

function edgeKey(a: string, b: string) {
  const pair = normalizeEdgePair(a, b);
  return `${pair.mapAId}::${pair.mapBId}`;
}

function buildNodeLayout(nodes: MapNode[]): NodeWithPosition[] {
  if (nodes.length === 0) {
    return [];
  }

  if (nodes.length === 1) {
    return [{
      ...nodes[0],
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
    }];
  }

  const radius = Math.max(
    120,
    Math.min((Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) / 2) - 80, 220),
  );

  return nodes.map((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.length - Math.PI / 2;
    return {
      ...node,
      x: CANVAS_WIDTH / 2 + Math.cos(angle) * radius,
      y: CANVAS_HEIGHT / 2 + Math.sin(angle) * radius,
    };
  });
}

async function fetchAllAdminRows(urlPrefix: string) {
  const rows: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "50",
    });

    const res = await fetch(`${urlPrefix}?${params.toString()}`);
    const json = await res.json() as AdminListResponse<Record<string, unknown>>;

    if (!json.success || !json.data?.list) {
      throw new Error(json.error || "加载失败");
    }

    rows.push(...json.data.list);

    const total = json.data.pagination?.total ?? rows.length;
    if (rows.length >= total || json.data.list.length === 0) {
      break;
    }

    page += 1;
  }

  return rows;
}

export default function MapEdgesGraphEditor() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [maps, setMaps] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [activeSourceMapId, setActiveSourceMapId] = useState<string | null>(null);
  const [activeEdgeId, setActiveEdgeId] = useState<number | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const [mapRows, edgeRows] = await Promise.all([
        fetchAllAdminRows("/api/admin/maps"),
        fetchAllAdminRows("/api/admin/mapEdges"),
      ]);

      const normalizedMaps = mapRows
        .map(normalizeMapNode)
        .filter((item) => item.id);

      const normalizedEdges = edgeRows
        .map(normalizeMapEdge)
        .filter((item): item is MapEdge => Boolean(item));

      setMaps(normalizedMaps);
      setEdges(normalizedEdges);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "加载图数据失败";
      message.error(errorMessage || "加载图数据失败");
      setMaps([]);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const nodes = useMemo(() => buildNodeLayout(maps), [maps]);

  const nodeMap = useMemo(() => {
    const mapped = new Map<string, NodeWithPosition>();
    nodes.forEach((node) => {
      mapped.set(node.id, node);
    });
    return mapped;
  }, [nodes]);

  const mapNameMap = useMemo(() => {
    const mapped = new Map<string, string>();
    maps.forEach((mapItem) => {
      mapped.set(mapItem.id, mapItem.name);
    });
    return mapped;
  }, [maps]);

  const connectedCount = useMemo(() => {
    const result = new Map<string, number>();
    maps.forEach((mapItem) => {
      result.set(mapItem.id, 0);
    });

    edges.forEach((edge) => {
      result.set(edge.mapAId, (result.get(edge.mapAId) || 0) + 1);
      result.set(edge.mapBId, (result.get(edge.mapBId) || 0) + 1);
    });

    return result;
  }, [maps, edges]);

  const mapColumns: ColumnsType<MapNode> = useMemo(() => {
    return [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        ellipsis: true,
        render: (value: string, record) => (
          <Text strong={record.id === activeSourceMapId}>{value}</Text>
        ),
      },
      {
        title: "ID",
        dataIndex: "id",
        key: "id",
        ellipsis: true,
        render: (value: string) => (
          <Text
            type="secondary"
            copyable={{ text: value }}
          >
            {value}
          </Text>
        ),
      },
      {
        title: "连边",
        key: "connected",
        width: 88,
        align: "right",
        render: (_, record) => (
          <DarkTag color="blue">{connectedCount.get(record.id) || 0} 条</DarkTag>
        ),
      },
    ];
  }, [activeSourceMapId, connectedCount]);

  const uniqueEdgeMap = useMemo(() => {
    const mapped = new Map<string, MapEdge>();
    edges.forEach((edge) => {
      const key = edgeKey(edge.mapAId, edge.mapBId);
      if (!mapped.has(key)) {
        mapped.set(key, edge);
      }
    });
    return mapped;
  }, [edges]);

  const duplicateEdges = useMemo(() => {
    const counter = new Map<string, number>();
    edges.forEach((edge) => {
      const key = edgeKey(edge.mapAId, edge.mapBId);
      counter.set(key, (counter.get(key) || 0) + 1);
    });

    return Array.from(counter.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key);
  }, [edges]);

  const renderEdges = useMemo(() => {
    return Array.from(uniqueEdgeMap.values()).filter((edge) => {
      return nodeMap.has(edge.mapAId) && nodeMap.has(edge.mapBId);
    });
  }, [nodeMap, uniqueEdgeMap]);

  const activeEdge = useMemo(() => {
    if (activeEdgeId === null) {
      return null;
    }
    return edges.find((edge) => edge.id === activeEdgeId) || null;
  }, [activeEdgeId, edges]);

  const createEdge = useCallback(async (mapIdA: string, mapIdB: string) => {
    if (!mapIdA || !mapIdB) {
      return;
    }

    if (mapIdA === mapIdB) {
      message.warning("同一地图无需连边");
      return;
    }

    const duplicated = uniqueEdgeMap.has(edgeKey(mapIdA, mapIdB));
    if (duplicated) {
      message.warning("该无向边已存在");
      return;
    }

    const pair = normalizeEdgePair(mapIdA, mapIdB);

    setSaving(true);
    try {
      const res = await fetch("/api/admin/mapEdges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pair),
      });
      const json = await res.json();

      if (!json?.success) {
        message.error(json?.error || "创建连边失败");
        return;
      }

      message.success("连边创建成功");
      setActiveSourceMapId(null);
      await loadGraph();
    } catch {
      message.error("创建连边失败");
    } finally {
      setSaving(false);
    }
  }, [loadGraph, message, uniqueEdgeMap]);

  const deleteEdge = useCallback(async (edgeId: number) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/mapEdges", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: edgeId }),
      });
      const json = await res.json();

      if (!json?.success) {
        message.error(json?.error || "删除连边失败");
        return;
      }

      message.success("连边已删除");
      setActiveEdgeId(null);
      setEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
    } catch {
      message.error("删除连边失败");
    } finally {
      setSaving(false);
    }
  }, [message]);

  return (
    <Card
      title="地图连边（节点管理）"
      extra={(
        <Space>
          {activeSourceMapId && (
            <DarkTag color="gold">
              已选起点：{mapNameMap.get(activeSourceMapId) || activeSourceMapId}
            </DarkTag>
          )}
          <Button loading={loading} onClick={() => void loadGraph()}>刷新</Button>
        </Space>
      )}
    >
      <Space align="start" size={16} style={{ width: "100%" }}>
        <div style={{ flex: 1 }}>
          <Paragraph type="secondary" style={{ marginTop: 0 }}>
            点击一个节点选起点，再点击另一个节点即可创建无向边；点击线条可选中边并删除。
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
            ) : maps.length === 0 ? (
              <div style={{ height: CANVAS_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Empty description="暂无地图" />
              </div>
            ) : (
              <div
                style={{
                  width: "100%",
                  maxWidth: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  margin: "0 auto",
                }}
              >
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                  style={{ display: "block" }}
                >
                  {renderEdges.map((edge) => {
                    const from = nodeMap.get(edge.mapAId);
                    const to = nodeMap.get(edge.mapBId);
                    if (!from || !to) {
                      return null;
                    }

                    const isActive = edge.id === activeEdgeId;

                    return (
                      <g key={`edge-${edge.id}`}>
                        <line
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke={isActive ? "#ff7875" : "#5b616a"}
                          strokeWidth={isActive ? 4 : 2}
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
                            setActiveEdgeId(edge.id);
                            setActiveSourceMapId(null);
                          }}
                        />
                      </g>
                    );
                  })}
                  {nodes.map((node) => {
                    const selected = activeSourceMapId === node.id;
                    const shortName = node.name.length > 4 ? `${node.name.slice(0, 4)}…` : node.name;

                    return (
                      <g
                        key={node.id}
                        style={{ cursor: saving ? "not-allowed" : "pointer" }}
                        onClick={() => {
                          if (saving) {
                            return;
                          }

                          if (activeSourceMapId && activeSourceMapId !== node.id) {
                            void createEdge(activeSourceMapId, node.id);
                            return;
                          }

                          if (activeSourceMapId === node.id) {
                            setActiveSourceMapId(null);
                            return;
                          }

                          setActiveSourceMapId(node.id);
                          setActiveEdgeId(null);
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

        <div style={{ width: 340 }}>
          <Space orientation="vertical" style={{ width: "100%" }}>
            <Card size="small" title="当前操作" loading={saving}>
              {activeEdge ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Text>
                    已选边：{mapNameMap.get(activeEdge.mapAId) || activeEdge.mapAId}
                    {" "}<Text type="secondary">↔</Text>{" "}
                    {mapNameMap.get(activeEdge.mapBId) || activeEdge.mapBId}
                  </Text>
                  <Popconfirm
                    title="确认删除该连边？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void deleteEdge(activeEdge.id)}
                  >
                    <Button danger>删除选中边</Button>
                  </Popconfirm>
                </Space>
              ) : activeSourceMapId ? (
                <Text type="secondary">已选起点，点击另一个节点创建连边</Text>
              ) : (
                <Text type="secondary">请先点击节点或边</Text>
              )}
            </Card>

            <Card size="small" title={`地图节点 (${maps.length})`}>
              <Table<MapNode>
                size="small"
                rowKey={(item) => item.id}
                columns={mapColumns}
                dataSource={maps}
                pagination={false}
                onRow={(item) => ({
                  onClick: () => {
                    setActiveSourceMapId(item.id);
                    setActiveEdgeId(null);
                  },
                  style: {
                    cursor: "pointer",
                    background: item.id === activeSourceMapId ? "rgba(201, 168, 76, 0.12)" : undefined,
                  },
                })}
              />
            </Card>

            {duplicateEdges.length > 0 && (
              <Card size="small" title="异常提示">
                <Text type="warning">存在重复无向边，建议删除冗余记录。</Text>
              </Card>
            )}
          </Space>
        </div>
      </Space>
    </Card>
  );
}
