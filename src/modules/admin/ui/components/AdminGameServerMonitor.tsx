"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, Descriptions, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { AdminGameServerHealthSnapshot } from "@/modules/admin/services/game-server-health";

const { Text, Title } = Typography;

type GameServerHealthResponse = {
  success: boolean;
  data?: AdminGameServerHealthSnapshot;
  error?: string;
};

type MetricItem = {
  key: string;
  label: string;
  value: number;
  precision?: number;
  suffix?: string;
};

type RejectReasonItem = {
  reason: string;
  count: number;
};

type RoomInstanceItem = NonNullable<NonNullable<AdminGameServerHealthSnapshot["health"]>["roomInstances"]>[number];
type ProcessItem = NonNullable<NonNullable<AdminGameServerHealthSnapshot["health"]>["processes"]>[number];

function formatTime(value: string | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds)) {
    return "-";
  }
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${rest}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${rest}s`;
  }
  return `${rest}s`;
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("zh-CN").format(Number.isFinite(value) ? Number(value) : 0);
}

function formatPercentRate(value: number | undefined) {
  return `${((Number.isFinite(value) ? Number(value) : 0) * 100).toFixed(2)}%`;
}

function formatReasonSummary(value: Record<string, number> | undefined) {
  const entries = Object.entries(value || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!entries.length) {
    return "-";
  }
  return entries.map(([reason, count]) => `${reason}:${formatNumber(count)}`).join(" / ");
}

function roomKindLabel(value: string) {
  if (value === "world_map") return "地图";
  if (value === "secret_realm") return "秘境";
  if (value === "combat") return "战斗";
  if (value === "boss") return "Boss";
  if (value === "pvp") return "PVP";
  if (value === "social") return "社交";
  return value;
}

function roomKindColor(value: string) {
  if (value === "world_map") return "green";
  if (value === "secret_realm") return "purple";
  if (value === "combat") return "blue";
  if (value === "boss") return "red";
  if (value === "pvp") return "magenta";
  if (value === "social") return "cyan";
  return "default";
}

function redisStatusLabel(status: string | undefined, enabled: boolean | undefined) {
  if (status === "ok") return "正常";
  if (status === "error") return "异常";
  if (status === "disabled" || enabled === false) return "未启用";
  if (enabled) return "已启用";
  return "-";
}

function redisStatusColor(status: string | undefined, enabled: boolean | undefined) {
  if (status === "ok") return "green";
  if (status === "error") return "red";
  if (status === "disabled" || enabled === false) return "default";
  if (enabled) return "gold";
  return "default";
}

export default function AdminGameServerMonitor() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AdminGameServerHealthSnapshot | null>(null);

  const fetchHealth = useCallback(async (options?: { silent?: boolean }) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/game-server/health", { cache: "no-store" });
      const result: GameServerHealthResponse = await response.json();
      if (result.success && result.data) {
        setSnapshot(result.data);
        if (!result.data.ok && !options?.silent) {
          message.warning(result.data.error || "game-server 当前不可用");
        }
        return;
      }
      if (!options?.silent) {
        message.error(result.error || "读取 game-server 状态失败");
      }
    } catch {
      if (!options?.silent) {
        message.error("读取 game-server 状态失败");
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchHealth();
    const timer = window.setInterval(() => {
      void fetchHealth({ silent: true });
    }, 10_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [fetchHealth]);

  const health = snapshot?.health || null;
  const metrics = health?.metrics || null;
  const redis = health?.redis || null;

  const metricItems = useMemo<MetricItem[]>(() => {
    if (!metrics) {
      return [];
    }
    return [
      { key: "roomsCreated", label: "房间创建", value: metrics.roomsCreated },
      { key: "onlineConnections", label: "在线连接", value: metrics.onlineConnections },
      { key: "peakOnlineConnections", label: "峰值在线", value: metrics.peakOnlineConnections },
      { key: "tickAvgMs", label: "tick 平均", value: metrics.tickAvgMs, precision: 3, suffix: "ms" },
      { key: "tickMaxMs", label: "tick 最大", value: metrics.tickMaxMs, precision: 3, suffix: "ms" },
      { key: "joins", label: "加入次数", value: metrics.joins },
      { key: "leaves", label: "离开次数", value: metrics.leaves },
      { key: "reconnectLeaves", label: "异常离线", value: metrics.reconnectLeaves },
      { key: "reconnectSuccesses", label: "重连成功", value: metrics.reconnectSuccesses },
      { key: "reconnectFailures", label: "重连失败", value: metrics.reconnectFailures },
      { key: "reconnectSuccessRate", label: "重连成功率", value: metrics.reconnectSuccessRate * 100, precision: 2, suffix: "%" },
      { key: "inputMessages", label: "输入消息", value: metrics.inputMessages },
      { key: "repairInputs", label: "repair", value: metrics.repairInputs },
      { key: "moveAccepted", label: "移动接受", value: metrics.moveAccepted },
      { key: "moveRejected", label: "移动拒绝", value: metrics.moveRejected },
      { key: "realtimeRejected", label: "协议拒绝", value: metrics.realtimeRejected },
      { key: "persistFailures", label: "落账失败", value: metrics.persistFailures },
      { key: "socialMessages", label: "社交消息", value: metrics.socialMessages },
      { key: "socialRejected", label: "社交拒绝", value: metrics.socialRejected },
      { key: "interactInputs", label: "交互输入", value: metrics.interactInputs },
      { key: "travelInputs", label: "传送输入", value: metrics.travelInputs },
      { key: "sectorSnapshotsSent", label: "snapshot", value: metrics.sectorSnapshotsSent },
      { key: "sectorDeltasSent", label: "delta", value: metrics.sectorDeltasSent },
      { key: "websocketUpgradeRequests", label: "WS upgrade", value: metrics.websocketUpgradeRequests },
      { key: "websocketConnections", label: "WS 连接", value: metrics.websocketConnections },
      { key: "websocketConnectionErrors", label: "WS 失败", value: metrics.websocketConnectionErrors },
      { key: "websocketClientErrors", label: "WS 错误", value: metrics.websocketClientErrors },
      { key: "websocketHeartbeatTerminations", label: "WS 超时终止", value: metrics.websocketHeartbeatTerminations },
      { key: "websocketHandshakeTimeouts", label: "WS 握手超时", value: metrics.websocketHandshakeTimeouts },
      { key: "websocketMissingSessionAndRoom", label: "WS fallback", value: metrics.websocketMissingSessionAndRoom },
      { key: "websocketFailedReconnects", label: "WS 重连失败", value: metrics.websocketFailedReconnects },
      { key: "websocketRoomConnectFailures", label: "WS 进房失败", value: metrics.websocketRoomConnectFailures },
    ];
  }, [metrics]);

  const toReasonRows = useCallback((reasons: Record<string, number> | undefined) => {
    if (!reasons) {
      return [];
    }
    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, []);

  const rejectReasons = useMemo<RejectReasonItem[]>(
    () => toReasonRows(metrics?.moveRejectedByReason),
    [metrics?.moveRejectedByReason, toReasonRows],
  );
  const realtimeRejectReasons = useMemo<RejectReasonItem[]>(
    () => toReasonRows(metrics?.realtimeRejectedByReason),
    [metrics?.realtimeRejectedByReason, toReasonRows],
  );
  const persistFailureReasons = useMemo<RejectReasonItem[]>(
    () => toReasonRows(metrics?.persistFailuresByReason),
    [metrics?.persistFailuresByReason, toReasonRows],
  );
  const socialRejectReasons = useMemo<RejectReasonItem[]>(
    () => toReasonRows(metrics?.socialRejectedByReason),
    [metrics?.socialRejectedByReason, toReasonRows],
  );
  const websocketErrorReasons = useMemo<RejectReasonItem[]>(
    () => toReasonRows(metrics?.websocketErrorByReason),
    [metrics?.websocketErrorByReason, toReasonRows],
  );

  const registeredRoomRows = useMemo(() => {
    return (health?.rooms || []).map((roomName) => ({
      roomName,
    }));
  }, [health?.rooms]);

  const processRows = useMemo<ProcessItem[]>(() => health?.processes || (health ? [{
    processId: health.processId,
    uptimeSeconds: health.uptimeSeconds,
    roomInstancesTotal: health.roomInstancesTotal || 0,
    roomInstancesTruncated: Boolean(health.roomInstancesTruncated),
    roomInstances: health.roomInstances || [],
    metrics: health.metrics,
  }] : []), [health]);
  const roomInstances = useMemo(() => {
    if (health?.roomInstances?.length) {
      return health.roomInstances;
    }
    return processRows.flatMap((process) => process.roomInstances || []);
  }, [health?.roomInstances, processRows]);
  const roomInstancesTotal = health?.roomInstancesTotal ?? roomInstances.length;
  const roomInstancesTruncated = Boolean(health?.roomInstancesTruncated);
  const mapShardRows = useMemo(
    () => roomInstances.filter((room) => room.roomKind === "world_map" || room.roomKind === "secret_realm"),
    [roomInstances],
  );
  const combatStatusRows = useMemo(
    () => roomInstances.filter((room) => room.roomKind === "boss" || room.roomKind === "pvp"),
    [roomInstances],
  );
  const socialRoomRows = useMemo(
    () => roomInstances.filter((room) => room.roomKind === "social"),
    [roomInstances],
  );

  const roomColumns: ColumnsType<{ roomName: string }> = [
    {
      title: "房间类型",
      dataIndex: "roomName",
      key: "roomName",
      render: (value: string) => <Tag color="gold">{value}</Tag>,
    },
  ];

  const roomInstanceColumns: ColumnsType<RoomInstanceItem> = [
    {
      title: "房间",
      dataIndex: "roomKind",
      key: "roomKind",
      render: (value: string, record) => (
        <Space orientation="vertical" size={0}>
          <Tag color={roomKindColor(value)}>{roomKindLabel(value)}</Tag>
          <Text code style={{ fontSize: 11 }}>{record.roomId}</Text>
        </Space>
      ),
    },
    {
      title: "人数",
      dataIndex: "clientCount",
      key: "clientCount",
      align: "right",
      render: (value: number, record) => `${formatNumber(value)} / ${formatNumber(record.peakClientCount)}`,
    },
    {
      title: "tick",
      dataIndex: "tickAvgMs",
      key: "tickAvgMs",
      align: "right",
      render: (value: number, record) => `${value.toFixed(3)} / ${record.tickMaxMs.toFixed(3)} ms`,
    },
    {
      title: "消息量",
      dataIndex: "inputMessages",
      key: "inputMessages",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "repair",
      dataIndex: "repairInputs",
      key: "repairInputs",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "重连",
      key: "reconnect",
      align: "right",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{formatPercentRate(record.reconnectSuccessRate)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatNumber(record.reconnectSuccesses)} / {formatNumber(record.reconnectFailures)}
          </Text>
        </Space>
      ),
    },
    {
      title: "拒绝 / 落账",
      key: "rejectPersist",
      align: "right",
      render: (_, record) => `${formatNumber(record.realtimeRejected)} / ${formatNumber(record.persistFailures)}`,
    },
    {
      title: "地图 / 分片",
      key: "mapShard",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{record.mapName || record.mapId || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>shard {record.shardId || "0"}</Text>
        </Space>
      ),
    },
    {
      title: "实体",
      dataIndex: "entityCount",
      key: "entityCount",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      render: (value: string) => formatTime(value),
    },
  ];

  const mapShardColumns: ColumnsType<RoomInstanceItem> = [
    {
      title: "地图分片",
      key: "mapShard",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{record.mapName || record.mapId || "-"}</Text>
          <Text code style={{ fontSize: 11 }}>{record.mapId}:{record.shardId}</Text>
        </Space>
      ),
    },
    {
      title: "类型",
      dataIndex: "roomKind",
      key: "roomKind",
      render: (value: string) => <Tag color={roomKindColor(value)}>{roomKindLabel(value)}</Tag>,
    },
    {
      title: "人数",
      dataIndex: "clientCount",
      key: "clientCount",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "tick 平均",
      dataIndex: "tickAvgMs",
      key: "tickAvgMs",
      align: "right",
      render: (value: number) => `${value.toFixed(3)}ms`,
    },
    {
      title: "消息量",
      dataIndex: "inputMessages",
      key: "inputMessages",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "repair",
      dataIndex: "repairInputs",
      key: "repairInputs",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "移动拒绝",
      key: "moveRejected",
      align: "right",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{formatNumber(record.moveRejected)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatReasonSummary(record.moveRejectedByReason)}</Text>
        </Space>
      ),
    },
    {
      title: "落账失败",
      key: "persistFailures",
      align: "right",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{formatNumber(record.persistFailures)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatReasonSummary(record.persistFailuresByReason)}</Text>
        </Space>
      ),
    },
  ];

  const combatStatusColumns: ColumnsType<RoomInstanceItem> = [
    {
      title: "房间",
      key: "room",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Tag color={roomKindColor(record.roomKind)}>{roomKindLabel(record.roomKind)}</Tag>
          <Text code style={{ fontSize: 11 }}>{record.roomId}</Text>
        </Space>
      ),
    },
    {
      title: "战斗",
      key: "combat",
      render: (_, record) => record.combatId || record.partyId || "-",
    },
    {
      title: "人数",
      dataIndex: "clientCount",
      key: "clientCount",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "tick",
      key: "tick",
      align: "right",
      render: (_, record) => `${record.tickAvgMs.toFixed(3)} / ${record.tickMaxMs.toFixed(3)} ms`,
    },
    {
      title: "消息量",
      dataIndex: "inputMessages",
      key: "inputMessages",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "重连成功率",
      key: "reconnect",
      align: "right",
      render: (_, record) => formatPercentRate(record.reconnectSuccessRate),
    },
    {
      title: "落账失败",
      dataIndex: "persistFailures",
      key: "persistFailures",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (value: RoomInstanceItem["status"]) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "运行中" : "已释放"}</Tag>,
    },
  ];

  const socialRoomColumns: ColumnsType<RoomInstanceItem> = [
    {
      title: "社交房间",
      key: "room",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text code style={{ fontSize: 11 }}>{record.roomId}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.mapId}:{record.shardId}</Text>
        </Space>
      ),
    },
    {
      title: "在线",
      dataIndex: "clientCount",
      key: "clientCount",
      align: "right",
      render: (value: number, record) => `${formatNumber(value)} / ${formatNumber(record.peakClientCount)}`,
    },
    {
      title: "消息量",
      dataIndex: "socialMessages",
      key: "socialMessages",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
    {
      title: "拒绝",
      key: "socialRejected",
      align: "right",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{formatNumber(record.socialRejected)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatReasonSummary(record.socialRejectedByReason)}</Text>
        </Space>
      ),
    },
    {
      title: "repair",
      dataIndex: "repairInputs",
      key: "repairInputs",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
  ];

  const processColumns: ColumnsType<ProcessItem> = [
    {
      title: "进程",
      dataIndex: "processId",
      key: "processId",
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: "运行时间",
      dataIndex: "uptimeSeconds",
      key: "uptimeSeconds",
      render: (value: number) => formatDuration(value),
    },
    {
      title: "房间",
      dataIndex: "roomInstancesTotal",
      key: "roomInstancesTotal",
      align: "right",
      render: (value: number, record) => (
        <Space size={6}>
          <Text>{formatNumber(value)}</Text>
          {record.roomInstancesTruncated ? <Tag color="gold">截断</Tag> : null}
        </Space>
      ),
    },
    {
      title: "在线",
      key: "onlineConnections",
      align: "right",
      render: (_, record) => formatNumber(record.metrics?.onlineConnections),
    },
    {
      title: "重连成功率",
      key: "reconnectSuccessRate",
      align: "right",
      render: (_, record) => formatPercentRate(record.metrics?.reconnectSuccessRate),
    },
    {
      title: "落账失败",
      key: "persistFailures",
      align: "right",
      render: (_, record) => formatNumber(record.metrics?.persistFailures),
    },
  ];

  const rejectColumns: ColumnsType<RejectReasonItem> = [
    {
      title: "拒绝原因",
      dataIndex: "reason",
      key: "reason",
    },
    {
      title: "次数",
      dataIndex: "count",
      key: "count",
      align: "right",
      render: (value: number) => formatNumber(value),
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card
        title={
          <Space>
            <Title level={5} style={{ margin: 0 }}>实时房间监控</Title>
            <Tag color={snapshot?.ok ? "green" : "red"}>
              {snapshot?.ok ? "在线" : "不可用"}
            </Tag>
          </Space>
        }
        extra={(
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void fetchHealth()}
          >
            刷新
          </Button>
        )}
        loading={loading && !snapshot}
      >
        <Descriptions column={{ xs: 1, md: 2, xl: 3 }} size="small" bordered>
          <Descriptions.Item label="检查时间">{formatTime(snapshot?.checkedAt)}</Descriptions.Item>
          <Descriptions.Item label="探测地址">
            <Text code>{snapshot?.url || "-"}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="HTTP 状态">{snapshot?.statusCode ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="延迟">{snapshot?.latencyMs === null || snapshot?.latencyMs === undefined ? "-" : `${snapshot.latencyMs}ms`}</Descriptions.Item>
          <Descriptions.Item label="进程">{health?.processId || "-"}</Descriptions.Item>
          <Descriptions.Item label="运行时间">{formatDuration(health?.uptimeSeconds)}</Descriptions.Item>
          <Descriptions.Item label="协议版本">{health?.protocolVersion ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="Redis">
            <Space size={6} wrap>
              <Tag color={redisStatusColor(redis?.status, health?.redisEnabled)}>
                {redisStatusLabel(redis?.status, health?.redisEnabled)}
              </Tag>
              {redis?.latencyMs !== null && redis?.latencyMs !== undefined ? (
                <Text type="secondary">{redis.latencyMs}ms</Text>
              ) : null}
              {redis?.checkedAt ? (
                <Text type="secondary">{formatTime(redis.checkedAt)}</Text>
              ) : null}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="活跃房间">
            <Space size={6} wrap>
              <Text>{formatNumber(roomInstancesTotal)}</Text>
              {roomInstancesTruncated ? <Tag color="gold">仅展示前 {formatNumber(roomInstances.length)} 个</Tag> : null}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="错误">
            {snapshot?.error ? <Text type="danger">{snapshot.error}</Text> : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Redis 错误">
            {redis?.error ? <Text type="danger">{redis.error}</Text> : "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[12, 12]}>
        {metricItems.map((item) => (
          <Col xs={12} sm={8} lg={6} xl={4} key={item.key}>
            <Card size="small">
              <Statistic title={item.label} value={item.value} precision={item.precision} suffix={item.suffix} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="房间类型">
            <Table
              rowKey="roomName"
              size="small"
              pagination={false}
              columns={roomColumns}
              dataSource={registeredRoomRows}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="移动拒绝原因">
            <Table
              rowKey="reason"
              size="small"
              pagination={false}
              columns={rejectColumns}
              dataSource={rejectReasons}
              locale={{ emptyText: "暂无拒绝记录" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="协议拒绝原因">
            <Table
              rowKey="reason"
              size="small"
              pagination={false}
              columns={rejectColumns}
              dataSource={realtimeRejectReasons}
              locale={{ emptyText: "暂无拒绝记录" }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="落账失败原因">
            <Table rowKey="reason" size="small" pagination={false} columns={rejectColumns} dataSource={persistFailureReasons} locale={{ emptyText: "暂无失败记录" }} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="社交拒绝原因">
            <Table rowKey="reason" size="small" pagination={false} columns={rejectColumns} dataSource={socialRejectReasons} locale={{ emptyText: "暂无拒绝记录" }} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="WebSocket 错误原因">
            <Table rowKey="reason" size="small" pagination={false} columns={rejectColumns} dataSource={websocketErrorReasons} locale={{ emptyText: "暂无错误记录" }} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="进程聚合">
        <Table
          rowKey="processId"
          size="small"
          pagination={false}
          columns={processColumns}
          dataSource={processRows}
          scroll={{ x: 760 }}
          locale={{ emptyText: "暂无进程数据" }}
        />
      </Card>

      <Card
        size="small"
        title={(
          <Space>
            <span>活跃房间实例</span>
            {roomInstancesTruncated ? <Tag color="gold">已截断</Tag> : null}
          </Space>
        )}
      >
        <Table
          rowKey="roomId"
          size="small"
          pagination={false}
          columns={roomInstanceColumns}
          dataSource={roomInstances}
          scroll={{ x: 920 }}
          locale={{ emptyText: "暂无活跃房间" }}
        />
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="地图分片状态">
            <Table
              rowKey="roomId"
              size="small"
              pagination={false}
              columns={mapShardColumns}
              dataSource={mapShardRows}
              locale={{ emptyText: "暂无地图分片" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Boss / PVP 房间状态">
            <Table
              rowKey="roomId"
              size="small"
              pagination={false}
              columns={combatStatusColumns}
              dataSource={combatStatusRows}
              locale={{ emptyText: "暂无 Boss / PVP 房间" }}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="SocialRoom 状态">
        <Table
          rowKey="roomId"
          size="small"
          pagination={false}
          columns={socialRoomColumns}
          dataSource={socialRoomRows}
          scroll={{ x: 760 }}
          locale={{ emptyText: "暂无 SocialRoom" }}
        />
      </Card>
    </Space>
  );
}
