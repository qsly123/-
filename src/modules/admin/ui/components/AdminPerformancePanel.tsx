"use client";

import { useMemo } from "react";
import { Bar, Column, Pie } from "@ant-design/plots";
import {
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";

const { Text } = Typography;

type RealtimeBandwidthPanelData = {
  totalMessages: number;
  fullMessages: number;
  deltaMessages: number;
  totalBytes: number;
  fullBytes: number;
  deltaBytes: number;
  potentialFullBytes: number;
  savedBytesEstimate: number;
  avgPayloadBytes: number;
  deltaHitRate: number;
  bandwidthHitRate: number;
};

type HttpCacheBandwidthPanelData = {
  totalAssetRequests: number;
  notModifiedHits: number;
  bytesServed: number;
  servedResponses: number;
  notModifiedHitRate: number;
  avgResponseBytes: number;
};

type RealtimeCodecPanelData = {
  messages: number;
  binaryMessages: number;
  textMessages: number;
  transportBytes: number;
  jsonBytes: number;
  savedBytes: number;
  compressionRate: number;
  binaryShare: number;
  encodeCount: number;
  encodeMsTotal: number;
  encodeMsMax: number;
  avgEncodeMs: number;
  encodeMsP95: number;
  decodeCount: number;
  decodeMsTotal: number;
  decodeMsMax: number;
  avgDecodeMs: number;
  decodeMsP95: number;
  serializeCount: number;
  serializeMsTotal: number;
  serializeMsMax: number;
  avgSerializeMs: number;
  serializeMsP95: number;
};

export type AdminPerformancePanelData = {
  generatedAt: string;
  uptimeSec: number;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    heapUsageRate: number;
  };
  eventLoop: {
    userCpuTimeMs: number;
    systemCpuTimeMs: number;
  };
  db: {
    ok: boolean;
    pingMs: number | null;
    error: string | null;
  };
  runtimeRoles: {
    bridgeLatencyMs: number | null;
    web: {
      ok: boolean;
      pid: number;
      uptimeSec: number;
      memory: {
        rssBytes: number;
        heapUsedBytes: number;
        heapTotalBytes: number;
      };
      cpu: {
        userCpuTimeMs: number;
        systemCpuTimeMs: number;
      };
    };
    realtime: {
      enabled: boolean;
      ok: boolean;
      pid: number | null;
      uptimeSec: number | null;
      port: number | null;
      memory: {
        rssBytes: number;
        heapUsedBytes: number;
        heapTotalBytes: number;
      } | null;
      cpu: {
        userCpuTimeMs: number;
        systemCpuTimeMs: number;
      } | null;
      error: string | null;
    };
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    databasePoolMax: number;
    nodeOptions: string;
    persistence: {
      activeRuntimeBaseDir: string | null;
      checkpointNamespaceCount: number;
      checkpointEntryCount: number;
      pendingNamespaceFlushes: number;
      runtimePersistDisabled: boolean;
    };
    readModelCache: {
      groups: Array<{
        group: string;
        hits: number;
        misses: number;
        invalidations: number;
        hitRate: number;
      }>;
      totalHits: number;
      totalMisses: number;
      totalInvalidations: number;
      totalHitRate: number;
    };
  };
  bandwidth: {
    realtime: RealtimeBandwidthPanelData;
    realtimeByTransport: {
      ws: RealtimeBandwidthPanelData;
      sse: RealtimeBandwidthPanelData;
    };
    httpCache: HttpCacheBandwidthPanelData;
  };
  codec: {
    total: RealtimeCodecPanelData;
    byTransport: {
      ws: RealtimeCodecPanelData;
      sse: RealtimeCodecPanelData;
    };
    byCodec: {
      json: RealtimeCodecPanelData;
      msgpack: RealtimeCodecPanelData;
    };
    byScene: {
      map: RealtimeCodecPanelData;
      combat: RealtimeCodecPanelData;
      boss: RealtimeCodecPanelData;
      unknown: RealtimeCodecPanelData;
    };
    fallbackReasons: Array<{ reason: string; count: number }>;
  };
  mapScene: {
    interaction: {
      ack: {
        total: number;
        accepted: number;
        rejected: number;
        resyncRequired: number;
        durationTotalMs: number;
        durationMaxMs: number;
        correctionDistanceTotal: number;
        smallCorrections: number;
        smoothCorrections: number;
        snapCorrections: number;
        acceptedRate: number;
        avgDurationMs: number;
        avgCorrectionDistance: number;
      };
      silentRefresh: {
        total: number;
        reasons: Array<{ reason: string; count: number }>;
      };
    };
    realtimeSync: {
      total: {
        directUpdates: number;
        watcherRefreshes: number;
        idleRefreshes: number;
        activePollChecks: number;
        idlePollChecks: number;
        watcherLagTotalMs: number;
        watcherLagMaxMs: number;
        totalRefreshes: number;
        directHitRate: number;
        watcherShare: number;
        avgWatcherLagMs: number;
        watcherReasonBreakdown: Array<{
          reason: string;
          count: number;
          avgLagMs: number;
          maxLagMs: number;
        }>;
      };
      byTransport: {
        ws: {
          directUpdates: number;
          watcherRefreshes: number;
          idleRefreshes: number;
          activePollChecks: number;
          idlePollChecks: number;
          watcherLagTotalMs: number;
          watcherLagMaxMs: number;
          totalRefreshes: number;
          directHitRate: number;
          watcherShare: number;
          avgWatcherLagMs: number;
          watcherReasonBreakdown: Array<{
            reason: string;
            count: number;
            avgLagMs: number;
            maxLagMs: number;
          }>;
        };
        sse: {
          directUpdates: number;
          watcherRefreshes: number;
          idleRefreshes: number;
          activePollChecks: number;
          idlePollChecks: number;
          watcherLagTotalMs: number;
          watcherLagMaxMs: number;
          totalRefreshes: number;
          directHitRate: number;
          watcherShare: number;
          avgWatcherLagMs: number;
          watcherReasonBreakdown: Array<{
            reason: string;
            count: number;
            avgLagMs: number;
            maxLagMs: number;
          }>;
        };
      };
      transport: {
        wsSceneOpens: number;
        sseFallbackOpens: number;
        totalSceneOpens: number;
        wsSceneRatio: number;
        sseFallbackRatio: number;
        sseFallbackReasonBreakdown: Array<{ reason: string; count: number }>;
      };
    };
    source: {
      total: number;
      hubHits: number;
      fallbackHits: number;
      hubHitRate: number;
      fallbackReasons: Array<{ reason: string; count: number }>;
      coldFallbackCount: number;
      coldFallbackReasons: Array<{ reason: string; count: number }>;
      sharedStateRequests: number;
      sharedStateWarmHits: number;
      sharedStateWarmHitRate: number;
      playerTransitionWarmHits: number;
      staleServedWhileRefreshCount: number;
      firstFrameBootstrapLatencyMs: number;
      firstFrameBootstrapMaxLatencyMs: number;
      topMaps: Array<{ mapId: string; hubHits: number; fallbackHits: number; total: number }>;
    };
    internalJson: {
      totalRequests: number;
      slowRequests: number;
      failedRequests: number;
      nonOkResponses: number;
      lastDurationMs: number;
      lastStatus: number | null;
      slowPaths: Array<{ path: string; count: number }>;
      failedPaths: Array<{ path: string; count: number }>;
      nonOkPaths: Array<{ path: string; count: number }>;
    };
    caches: {
      sharedStateCacheSize: number;
      sharedStateWarmCount: number;
      sharedStateLoadingCount: number;
      sceneContextCacheSize: number;
      sceneContextHotCount: number;
      socketPlayerCacheSize: number;
    };
    aoi: {
      tileSize: number;
      preloadRings: number;
      activeAreaKeyCount: number;
      activeAreaSubscriberCount: number;
      routedMessages: number;
      deliveredMessages: number;
      deliveryHitRate: number;
      topMaps: Array<{
        mapId: string;
        areaKeyCount: number;
        subscriberCount: number;
        signalSubscriberCount: number;
      }>;
    };
    visibility: {
      samples: number;
      filteredEntityCounts: {
        player: number;
        npc: number;
        monster: number;
        opportunity: number;
      };
    };
    sharedMaps: Array<{
      mapId: string;
      playerCount: number;
      npcCount: number;
      monsterCount: number;
      opportunityCount: number;
      updatedAt: string | null;
      expiresInMs: number;
      lastAccessAgoMs: number;
      lastSocketAccessAgoMs: number;
      lastRefreshReason: string | null;
    }>;
  };
  recentEvents: Array<{
    id: string;
    at: string;
    level: "info" | "warn" | "error";
    source: string;
    type: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
};

export type AdminPerformancePanelProps = {
  data: AdminPerformancePanelData | null;
  loading?: boolean;
};

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatBytes(bytes: number | null | undefined) {
  const next = Number(bytes || 0);
  if (!Number.isFinite(next) || next <= 0) {
    return "0 MB";
  }
  return `${(next / 1024 / 1024).toFixed(1)} MB`;
}

function formatBytesCompact(bytes: number | null | undefined) {
  const next = Number(bytes || 0);
  if (!Number.isFinite(next) || next <= 0) {
    return "0 B";
  }
  if (next < 1024) {
    return `${Math.round(next)} B`;
  }
  if (next < 1024 * 1024) {
    return `${(next / 1024).toFixed(1)} KB`;
  }
  if (next < 1024 * 1024 * 1024) {
    return `${(next / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(next / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatPercent(rate: number | null | undefined) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDurationMs(value: number | null | undefined) {
  const next = Number(value || 0);
  if (!Number.isFinite(next) || next <= 0) {
    return "0 ms";
  }
  if (next < 10) {
    return `${next.toFixed(2)} ms`;
  }
  if (next < 100) {
    return `${next.toFixed(1)} ms`;
  }
  if (next < 1000) {
    return `${Math.round(next)} ms`;
  }
  return `${(next / 1000).toFixed(1)} s`;
}

function formatUptime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分`;
  }
  if (hours > 0) {
    return `${hours}小时 ${minutes}分`;
  }
  return `${minutes}分`;
}

function levelColor(level: string) {
  if (level === "error") {
    return "red";
  }
  if (level === "warn") {
    return "gold";
  }
  return "blue";
}

export default function AdminPerformancePanel({
  data,
  loading,
}: AdminPerformancePanelProps) {
  const chartTextColor = "#d9d3c7";
  const chartMutedTextColor = "#b8b1a2";
  const chartAxisStrokeColor = "#2f3748";
  const chartGridColor = "rgba(128, 144, 172, 0.22)";

  const sourcePieData = useMemo(() => {
    if (!data) {
      return [];
    }
    return [
      { type: "Hub 命中", value: data.mapScene.source.hubHits },
      { type: "Fallback", value: data.mapScene.source.fallbackHits },
    ].filter((item) => item.value > 0);
  }, [data]);

  const fallbackReasonData = useMemo(
    () => data?.mapScene.source.fallbackReasons || [],
    [data],
  );
  const coldFallbackReasonData = useMemo(
    () => data?.mapScene.source.coldFallbackReasons || [],
    [data],
  );
  const watcherReasonData = useMemo(
    () => data?.mapScene.realtimeSync.total.watcherReasonBreakdown || [],
    [data],
  );
  const sseFallbackReasonData = useMemo(
    () => data?.mapScene.realtimeSync.transport.sseFallbackReasonBreakdown || [],
    [data],
  );

  const topMapData = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.mapScene.source.topMaps
      .flatMap((item) => ([
        { mapId: item.mapId, type: "Hub", value: item.hubHits },
        { mapId: item.mapId, type: "Fallback", value: item.fallbackHits },
      ]))
      .filter((item) => item.value > 0);
  }, [data]);

  const internalSlowPathData = useMemo(
    () => data?.mapScene.internalJson.slowPaths || [],
    [data],
  );
  const readModelCacheData = useMemo(
    () => data?.runtime.readModelCache.groups || [],
    [data],
  );
  const aoiTopMapData = useMemo(
    () => data?.mapScene.aoi.topMaps || [],
    [data],
  );
  const silentRefreshReasonText = useMemo(() => {
    const topReason = data?.mapScene.interaction.silentRefresh.reasons[0];
    if (!topReason) {
      return "暂无静默刷新记录";
    }
    return `${topReason.reason} · ${formatNumber(topReason.count)} 次`;
  }, [data]);
  const watcherReasonText = useMemo(() => {
    const topReason = data?.mapScene.realtimeSync.total.watcherReasonBreakdown[0];
    if (!topReason) {
      return "暂无 watcher 兜底命中";
    }
    return `${topReason.reason} · ${formatNumber(topReason.count)} 次 / 平均 ${formatDurationMs(topReason.avgLagMs)}`;
  }, [data]);
  const sseFallbackReasonText = useMemo(() => {
    const topReason = data?.mapScene.realtimeSync.transport.sseFallbackReasonBreakdown[0];
    if (!topReason) {
      return "暂无 SSE 降级";
    }
    return `${topReason.reason} · ${formatNumber(topReason.count)} 次`;
  }, [data]);

  const realtimeTransportShareData = useMemo(() => {
    if (!data) {
      return [];
    }
    return [
      { type: "WS", value: data.bandwidth.realtimeByTransport.ws.totalMessages },
      { type: "SSE", value: data.bandwidth.realtimeByTransport.sse.totalMessages },
    ].filter((item) => item.value > 0);
  }, [data]);
  const hasSourceSamples = Boolean(data && data.mapScene.source.total > 0);
  const hasAoiActivity = Boolean(data && (
    data.mapScene.aoi.activeAreaKeyCount > 0
    || data.mapScene.aoi.activeAreaSubscriberCount > 0
    || data.mapScene.aoi.routedMessages > 0
  ));
  const hasAckSamples = Boolean(data && data.mapScene.interaction.ack.total > 0);
  const hasRealtimeBandwidthSamples = Boolean(data && data.bandwidth.realtime.totalMessages > 0);
  const hasCodecSamples = Boolean(data && data.codec.total.messages > 0);
  const hasRealtimeSyncSamples = Boolean(data && (
    data.mapScene.realtimeSync.total.totalRefreshes > 0
    || data.mapScene.realtimeSync.total.activePollChecks > 0
    || data.mapScene.realtimeSync.total.idlePollChecks > 0
  ));
  const codecStatusText = useMemo(() => {
    if (!data || data.codec.total.messages < 1) {
      return "暂无 codec 样本";
    }
    if (data.codec.byCodec.msgpack.messages > 0) {
      return `MsgPack ${formatNumber(data.codec.byCodec.msgpack.messages)} / JSON ${formatNumber(data.codec.byCodec.json.messages)}`;
    }
    return "当前仍在走 JSON 文本帧";
  }, [data]);
  const codecFallbackText = useMemo(() => {
    const topReason = data?.codec.fallbackReasons[0];
    if (!topReason) {
      return "JSON 回退 0 次";
    }
    return `${topReason.reason} · ${formatNumber(topReason.count)} 次`;
  }, [data]);
  const codecSceneSummary = useMemo(() => {
    if (!data) {
      return [];
    }
    return [
      { label: "地图", value: data.codec.byScene.map.messages, binaryShare: data.codec.byScene.map.binaryShare, bytes: data.codec.byScene.map.transportBytes },
      { label: "战斗", value: data.codec.byScene.combat.messages, binaryShare: data.codec.byScene.combat.binaryShare, bytes: data.codec.byScene.combat.transportBytes },
      { label: "Boss", value: data.codec.byScene.boss.messages, binaryShare: data.codec.byScene.boss.binaryShare, bytes: data.codec.byScene.boss.transportBytes },
    ].filter((item) => item.value > 0);
  }, [data]);

  const pieConfig = useMemo(() => ({
    data: sourcePieData,
    angleField: "value",
    colorField: "type",
    height: 260,
    innerRadius: 0.62,
    color: ["#59c58d", "#ff8f70"],
    legend: {
      position: "bottom" as const,
      itemName: { style: { fill: chartTextColor } },
      itemValue: { style: { fill: chartMutedTextColor } },
    },
  }), [chartMutedTextColor, chartTextColor, sourcePieData]);

  const realtimeTransportShareConfig = useMemo(() => ({
    data: realtimeTransportShareData,
    angleField: "value",
    colorField: "type",
    height: 240,
    innerRadius: 0.62,
    color: ["#4da3ff", "#f0b74d"],
    legend: {
      position: "bottom" as const,
      itemName: { style: { fill: chartTextColor } },
      itemValue: { style: { fill: chartMutedTextColor } },
    },
  }), [chartMutedTextColor, chartTextColor, realtimeTransportShareData]);

  const fallbackReasonConfig = useMemo(() => ({
    data: fallbackReasonData,
    xField: "reason",
    yField: "count",
    color: "#f0b74d",
    height: 260,
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
    yAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
  }), [chartAxisStrokeColor, chartGridColor, chartTextColor, fallbackReasonData]);
  const watcherReasonConfig = useMemo(() => ({
    data: watcherReasonData,
    xField: "reason",
    yField: "count",
    color: "#8bb3ff",
    height: 260,
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
    yAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
  }), [chartAxisStrokeColor, chartGridColor, chartTextColor, watcherReasonData]);
  const sseFallbackReasonConfig = useMemo(() => ({
    data: sseFallbackReasonData,
    xField: "reason",
    yField: "count",
    color: "#f0b74d",
    height: 240,
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
    yAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
  }), [chartAxisStrokeColor, chartGridColor, chartTextColor, sseFallbackReasonData]);

  const topMapConfig = useMemo(() => ({
    data: topMapData,
    isGroup: true,
    xField: "value",
    yField: "mapId",
    seriesField: "type",
    color: ["#59c58d", "#ff8f70"],
    height: 320,
    legend: {
      position: "bottom" as const,
      itemName: { style: { fill: chartTextColor } },
      itemValue: { style: { fill: chartMutedTextColor } },
    },
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
    yAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
  }), [chartAxisStrokeColor, chartGridColor, chartMutedTextColor, chartTextColor, topMapData]);

  const internalSlowPathConfig = useMemo(() => ({
    data: internalSlowPathData,
    xField: "path",
    yField: "count",
    color: "#6f8fb3",
    height: 260,
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
    yAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
  }), [chartAxisStrokeColor, chartGridColor, chartTextColor, internalSlowPathData]);

  const readModelCacheConfig = useMemo(() => ({
    data: readModelCacheData,
    xField: "group",
    yField: "hitRate",
    color: "#4da3ff",
    height: 260,
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
    yAxis: {
      label: {
        style: { fill: chartTextColor, fontSize: 12 },
        formatter: (value: string) => `${(Number(value || 0) * 100).toFixed(0)}%`,
      },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
  }), [chartAxisStrokeColor, chartGridColor, chartTextColor, readModelCacheData]);

  const aoiTopMapConfig = useMemo(() => ({
    data: aoiTopMapData,
    isGroup: true,
    xField: "subscriberCount",
    yField: "mapId",
    seriesField: "type",
    color: ["#65d6a4", "#8bb3ff"],
    height: 280,
    legend: {
      position: "bottom" as const,
      itemName: { style: { fill: chartTextColor } },
      itemValue: { style: { fill: chartMutedTextColor } },
    },
    xAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      grid: { line: { style: { stroke: chartGridColor, lineDash: [4, 4] } } },
    },
    yAxis: {
      label: { style: { fill: chartTextColor, fontSize: 12 } },
      line: { style: { stroke: chartAxisStrokeColor } },
      tickLine: { style: { stroke: chartAxisStrokeColor } },
    },
  }), [aoiTopMapData, chartAxisStrokeColor, chartGridColor, chartMutedTextColor, chartTextColor]);

  const sharedMapColumns = useMemo(() => ([
    {
      title: "地图",
      dataIndex: "mapId",
      key: "mapId",
      width: 180,
      ellipsis: true,
    },
    {
      title: "玩家",
      dataIndex: "playerCount",
      key: "playerCount",
      width: 72,
    },
    {
      title: "怪物",
      dataIndex: "monsterCount",
      key: "monsterCount",
      width: 72,
    },
    {
      title: "NPC",
      dataIndex: "npcCount",
      key: "npcCount",
      width: 72,
    },
    {
      title: "机缘",
      dataIndex: "opportunityCount",
      key: "opportunityCount",
      width: 72,
    },
    {
      title: "最近刷新",
      dataIndex: "lastRefreshReason",
      key: "lastRefreshReason",
      width: 110,
      render: (value: string | null) => value || "-",
    },
    {
      title: "过期剩余",
      dataIndex: "expiresInMs",
      key: "expiresInMs",
      width: 100,
      render: (value: number) => formatDurationMs(value),
    },
    {
      title: "最后访问",
      dataIndex: "lastAccessAgoMs",
      key: "lastAccessAgoMs",
      width: 100,
      render: (value: number) => formatDurationMs(value),
    },
  ]), []);

  return (
    <Card
      title="性能分析"
      extra={(
        <Space size={12}>
          <Text style={{ color: "#b7af9f" }}>更新时间：{data ? formatTime(data.generatedAt) : "-"}</Text>
          <Tag color={data?.db.ok ? "green" : "red"}>
            {data?.db.ok ? "DB 正常" : "DB 告警"}
          </Tag>
        </Space>
      )}
      loading={loading && !data}
    >
      {!data ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无性能数据" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text style={{ color: "#b7af9f", fontSize: 12 }}>
            这里展示当前进程的地图命中、带宽节省、304 缓存命中、共享态缓存与最近异常流，便于直接盯实时同步和容器压力。
          </Text>

          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                {hasSourceSamples ? (
                  <>
                    <Statistic title="Hub 命中率" value={Number((data.mapScene.source.hubHitRate * 100).toFixed(1))} suffix="%" />
                    <Progress
                      percent={Number((data.mapScene.source.hubHitRate * 100).toFixed(1))}
                      strokeColor="#59c58d"
                      trailColor="rgba(255,255,255,0.08)"
                      size="small"
                    />
                    <Text style={{ color: "#b7af9f" }}>
                      Shared warm hit {formatPercent(data.mapScene.source.sharedStateWarmHitRate)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Statistic title="Hub 命中率" value="暂无样本" />
                    <Text style={{ color: "#b7af9f" }}>等待地图场景命中采样</Text>
                  </>
                )}
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Fallback 次数" value={formatNumber(data.mapScene.source.fallbackHits)} />
                <Text style={{ color: "#b7af9f" }}>
                  {hasSourceSamples
                    ? `总采样 ${formatNumber(data.mapScene.source.total)} 次 / 冷启动 ${formatNumber(data.mapScene.source.coldFallbackCount)} 次`
                    : "当前还没有地图命中采样"}
                </Text>
                <Text style={{ color: "#b7af9f" }}>
                  首帧引导 {formatDurationMs(data.mapScene.source.firstFrameBootstrapLatencyMs)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="内部慢请求" value={formatNumber(data.mapScene.internalJson.slowRequests)} />
                <Text style={{ color: "#b7af9f" }}>
                  非 2xx {formatNumber(data.mapScene.internalJson.nonOkResponses)} / 失败 {formatNumber(data.mapScene.internalJson.failedRequests)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="数据库探活" value={data.db.ok ? "正常" : "异常"} />
                <Text style={{ color: "#b7af9f" }}>
                  {data.db.ok ? `延迟 ${formatDurationMs(data.db.pingMs)}` : (data.db.error || "数据库探活失败")}
                </Text>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="RSS 内存" value={formatBytes(data.memory.rssBytes)} />
                <Text style={{ color: "#b7af9f" }}>
                  Heap {formatBytes(data.memory.heapUsedBytes)} / {formatBytes(data.memory.heapTotalBytes)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Heap 使用率" value={formatPercent(data.memory.heapUsageRate)} />
                <Progress
                  percent={Number((data.memory.heapUsageRate * 100).toFixed(1))}
                  status={data.memory.heapUsageRate >= 0.85 ? "exception" : "active"}
                  strokeColor={data.memory.heapUsageRate >= 0.85 ? "#ff7875" : "#4cc9a7"}
                  trailColor="rgba(255,255,255,0.08)"
                  size="small"
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="共享态缓存" value={formatNumber(data.mapScene.caches.sharedStateCacheSize)} />
                <Text style={{ color: "#b7af9f" }}>
                  热缓存 {formatNumber(data.mapScene.caches.sharedStateWarmCount)} / 加载中 {formatNumber(data.mapScene.caches.sharedStateLoadingCount)}
                </Text>
                <Text style={{ color: "#b7af9f" }}>
                  warm {formatPercent(data.mapScene.source.sharedStateWarmHitRate)} / stale 命中 {formatNumber(data.mapScene.source.staleServedWhileRefreshCount)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="进程运行时长" value={formatUptime(data.uptimeSec)} />
                <Text style={{ color: "#b7af9f" }}>
                  CPU 用户 {formatDurationMs(data.eventLoop.userCpuTimeMs)} / 内核 {formatDurationMs(data.eventLoop.systemCpuTimeMs)}
                </Text>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} xl={8}>
              <Card size="small">
                <Statistic title="Web Runtime" value={data.runtimeRoles.web.ok ? "正常" : "异常"} />
                <Text style={{ color: "#b7af9f" }}>
                  PID {formatNumber(data.runtimeRoles.web.pid)}
                  {" / "}
                  RSS {formatBytes(data.runtimeRoles.web.memory.rssBytes)}
                </Text>
                <br />
                <Text style={{ color: "#b7af9f" }}>
                  CPU 用户 {formatDurationMs(data.runtimeRoles.web.cpu.userCpuTimeMs)}
                  {" / "}
                  内核 {formatDurationMs(data.runtimeRoles.web.cpu.systemCpuTimeMs)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <Card size="small">
                <Statistic
                  title="Realtime Runtime"
                  value={!data.runtimeRoles.realtime.enabled
                    ? "未启用"
                    : (data.runtimeRoles.realtime.ok ? "正常" : "异常")}
                />
                <Text style={{ color: "#b7af9f" }}>
                  PID {data.runtimeRoles.realtime.pid ? formatNumber(data.runtimeRoles.realtime.pid) : "-"}
                  {" / "}
                  RSS {data.runtimeRoles.realtime.memory ? formatBytes(data.runtimeRoles.realtime.memory.rssBytes) : "-"}
                </Text>
                <br />
                <Text style={{ color: "#b7af9f" }}>
                  {data.runtimeRoles.realtime.cpu
                    ? `CPU 用户 ${formatDurationMs(data.runtimeRoles.realtime.cpu.userCpuTimeMs)} / 内核 ${formatDurationMs(data.runtimeRoles.realtime.cpu.systemCpuTimeMs)}`
                    : (data.runtimeRoles.realtime.error || "等待 realtime-runtime 探活")}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <Card size="small">
                <Statistic title="内部桥接延迟" value={formatDurationMs(data.runtimeRoles.bridgeLatencyMs)} />
                <Text style={{ color: "#b7af9f" }}>
                  端口 {data.runtimeRoles.realtime.port ?? 3101}
                  {" / "}
                  仍只对外暴露 3000
                </Text>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Checkpoint 命名空间" value={formatNumber(data.runtime.persistence.checkpointNamespaceCount)} />
                <Text style={{ color: "#b7af9f" }}>
                  Entry {formatNumber(data.runtime.persistence.checkpointEntryCount)}
                  {" / "}
                  Flush 等待 {formatNumber(data.runtime.persistence.pendingNamespaceFlushes)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="读模型缓存命中率" value={formatPercent(data.runtime.readModelCache.totalHitRate)} />
                <Text style={{ color: "#b7af9f" }}>
                  Hits {formatNumber(data.runtime.readModelCache.totalHits)}
                  {" / "}
                  Misses {formatNumber(data.runtime.readModelCache.totalMisses)}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                {hasAoiActivity ? (
                  <>
                    <Statistic title="AOI 广播命中率" value={formatPercent(data.mapScene.aoi.deliveryHitRate)} />
                    <Text style={{ color: "#b7af9f" }}>
                      Routed {formatNumber(data.mapScene.aoi.routedMessages)}
                      {" / "}
                      Delivered {formatNumber(data.mapScene.aoi.deliveredMessages)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Statistic title="AOI 广播命中率" value="暂无样本" />
                    <Text style={{ color: "#b7af9f" }}>当前没有 AOI 广播活动</Text>
                  </>
                )}
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="AOI 订阅扇区" value={formatNumber(data.mapScene.aoi.activeAreaKeyCount)} />
                <Text style={{ color: "#b7af9f" }}>
                  {hasAoiActivity
                    ? `订阅数 ${formatNumber(data.mapScene.aoi.activeAreaSubscriberCount)} / Tile ${formatNumber(data.mapScene.aoi.tileSize)}`
                    : "当前没有活跃 AOI 订阅"}
                </Text>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                title="地图 Realtime / ACK"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    ACK {formatNumber(data.mapScene.interaction.ack.accepted)}
                    {" / "}
                    总请求 {formatNumber(data.mapScene.interaction.ack.total)}
                  </Text>
                )}
              >
                {hasAckSamples ? (
                  <>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="ACK 命中率" value={Number((data.mapScene.interaction.ack.acceptedRate * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平均 ACK 延迟" value={formatDurationMs(data.mapScene.interaction.ack.avgDurationMs)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平均纠偏距离" value={data.mapScene.interaction.ack.avgCorrectionDistance} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="小纠偏" value={formatNumber(data.mapScene.interaction.ack.smallCorrections)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平滑纠偏" value={formatNumber(data.mapScene.interaction.ack.smoothCorrections)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="Snap 纠偏" value={formatNumber(data.mapScene.interaction.ack.snapCorrections)} />
                      </Col>
                    </Row>
                    <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
                      <Text style={{ color: "#b7af9f" }}>
                        Resync {formatNumber(data.mapScene.interaction.ack.resyncRequired)}
                        {" / "}
                        Reject {formatNumber(data.mapScene.interaction.ack.rejected)}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        这一组指标用于判断移动卡顿更偏向 ACK 链问题，还是 watcher/静默刷新问题。
                      </Text>
                    </Space>
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有移动 ACK 样本" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                size="small"
                title="地图 Realtime / 静默刷新"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    总触发 {formatNumber(data.mapScene.interaction.silentRefresh.total)}
                  </Text>
                )}
              >
                <Row gutter={[12, 12]}>
                  <Col xs={24} sm={12}>
                    <Statistic title="主要原因" value={silentRefreshReasonText} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="当前插值窗" value="120 ms" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="最大外推" value="80 ms" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="ACK 超时阈值" value="700 ms" />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                title="带宽分析 / Realtime"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    Full {formatNumber(data.bandwidth.realtime.fullMessages)} / Delta {formatNumber(data.bandwidth.realtime.deltaMessages)}
                  </Text>
                )}
              >
                {hasRealtimeBandwidthSamples ? (
                  <>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="带宽命中率" value={Number((data.bandwidth.realtime.bandwidthHitRate * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="Delta 命中率" value={Number((data.bandwidth.realtime.deltaHitRate * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平均包体积" value={formatBytesCompact(data.bandwidth.realtime.avgPayloadBytes)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="节省带宽" value={formatBytesCompact(data.bandwidth.realtime.savedBytesEstimate)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="Full 包体" value={formatBytesCompact(data.bandwidth.realtime.fullBytes)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="Delta 包体" value={formatBytesCompact(data.bandwidth.realtime.deltaBytes)} />
                      </Col>
                    </Row>
                    <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
                      <Text style={{ color: "#b7af9f" }}>
                        WS 平均 {formatBytesCompact(data.bandwidth.realtimeByTransport.ws.avgPayloadBytes)}
                        {" / "}
                        SSE 平均 {formatBytesCompact(data.bandwidth.realtimeByTransport.sse.avgPayloadBytes)}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        理论 Full 总包体 {formatBytesCompact(data.bandwidth.realtime.potentialFullBytes)}
                        {" / "}
                        scene snapshot 总数 {formatNumber(data.bandwidth.realtime.totalMessages)}
                      </Text>
                    </Space>
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 realtime 带宽样本" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                size="small"
                title="带宽分析 / 资源缓存"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    304 {formatNumber(data.bandwidth.httpCache.notModifiedHits)} / 总请求 {formatNumber(data.bandwidth.httpCache.totalAssetRequests)}
                  </Text>
                )}
              >
                <Row gutter={[12, 12]}>
                  <Col xs={24} sm={12}>
                    <Statistic title="304 命中率" value={Number((data.bandwidth.httpCache.notModifiedHitRate * 100).toFixed(1))} suffix="%" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="平均资源包体" value={formatBytesCompact(data.bandwidth.httpCache.avgResponseBytes)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="已发送字节" value={formatBytesCompact(data.bandwidth.httpCache.bytesServed)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="200 响应数" value={formatNumber(data.bandwidth.httpCache.servedResponses)} />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                title="Realtime Codec / 编解码"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    MsgPack {formatNumber(data.codec.byCodec.msgpack.messages)}
                    {" / "}
                    JSON {formatNumber(data.codec.byCodec.json.messages)}
                  </Text>
                )}
              >
                {hasCodecSamples ? (
                  <>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平均编码耗时" value={formatDurationMs(data.codec.total.avgEncodeMs)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平均解码耗时" value={formatDurationMs(data.codec.total.avgDecodeMs)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="单包序列化" value={formatDurationMs(data.codec.total.avgSerializeMs)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="编码最大耗时" value={formatDurationMs(data.codec.total.encodeMsMax)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="解码最大耗时" value={formatDurationMs(data.codec.total.decodeMsMax)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="WS Binary 协商成功率" value={Number((data.codec.byTransport.ws.binaryShare * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="编码 P95" value={formatDurationMs(data.codec.total.encodeMsP95)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="解码 P95" value={formatDurationMs(data.codec.total.decodeMsP95)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="序列化 P95" value={formatDurationMs(data.codec.total.serializeMsP95)} />
                      </Col>
                    </Row>
                    <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
                      <Text style={{ color: "#b7af9f" }}>
                        WS Binary {formatNumber(data.codec.byTransport.ws.binaryMessages)}
                        {" / "}
                        WS Text {formatNumber(data.codec.byTransport.ws.textMessages)}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        {codecStatusText}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        {codecFallbackText}
                      </Text>
                      {codecSceneSummary.map((item) => (
                        <Text key={item.label} style={{ color: "#b7af9f" }}>
                          {item.label}消息 {formatNumber(item.value)}
                          {" / "}
                          Binary {formatPercent(item.binaryShare)}
                          {" / "}
                          包体 {formatBytesCompact(item.bytes)}
                        </Text>
                      ))}
                    </Space>
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 codec 样本" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                size="small"
                title="Realtime Codec / 包体对比"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    总消息 {formatNumber(data.codec.total.messages)}
                  </Text>
                )}
              >
                {hasCodecSamples ? (
                  <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12}>
                      <Statistic title="编码前 JSON" value={formatBytesCompact(data.codec.total.jsonBytes)} />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Statistic title="编码后传输" value={formatBytesCompact(data.codec.total.transportBytes)} />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Statistic title="节省包体" value={formatBytesCompact(data.codec.total.savedBytes)} />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Statistic title="压缩收益" value={Number((data.codec.total.compressionRate * 100).toFixed(1))} suffix="%" />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Statistic title="MsgPack 包体" value={formatBytesCompact(data.codec.byCodec.msgpack.transportBytes)} />
                    </Col>
                    <Col xs={24} sm={12}>
                      <Statistic title="JSON 包体" value={formatBytesCompact(data.codec.byCodec.json.transportBytes)} />
                    </Col>
                    <Col xs={24}>
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        {codecSceneSummary.length > 0 ? codecSceneSummary.map((item) => (
                          <Text key={`codec-scene-${item.label}`} style={{ color: "#b7af9f" }}>
                            {item.label}前后包体：传输 {formatBytesCompact(item.bytes)}
                            {" / "}
                            Binary 成功率 {formatPercent(item.binaryShare)}
                          </Text>
                        )) : (
                          <Text style={{ color: "#b7af9f" }}>暂无按场景划分的 codec 样本</Text>
                        )}
                      </Space>
                    </Col>
                  </Row>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无包体对比样本" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title="Realtime 协议占比"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    WS {formatNumber(data.bandwidth.realtimeByTransport.ws.totalMessages)} / SSE {formatNumber(data.bandwidth.realtimeByTransport.sse.totalMessages)}
                  </Text>
                )}
              >
                {realtimeTransportShareData.length > 0 ? (
                  <Pie {...realtimeTransportShareConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无协议占比数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title="Realtime 协议包体"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    用于观察 WS 优先后，是否真的把实时包更多压到 WS
                  </Text>
                )}
              >
                <Row gutter={[12, 12]}>
                  <Col xs={24} sm={12}>
                    <Statistic title="WS 总包体" value={formatBytesCompact(data.bandwidth.realtimeByTransport.ws.totalBytes)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="SSE 总包体" value={formatBytesCompact(data.bandwidth.realtimeByTransport.sse.totalBytes)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="WS 平均包体" value={formatBytesCompact(data.bandwidth.realtimeByTransport.ws.avgPayloadBytes)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="SSE 平均包体" value={formatBytesCompact(data.bandwidth.realtimeByTransport.sse.avgPayloadBytes)} />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                title="地图 Realtime / 追平"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    Direct {formatNumber(data.mapScene.realtimeSync.total.directUpdates)}
                    {" / "}
                    Watcher {formatNumber(data.mapScene.realtimeSync.total.watcherRefreshes)}
                  </Text>
                )}
              >
                {hasRealtimeSyncSamples ? (
                  <>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="直接命中率" value={Number((data.mapScene.realtimeSync.total.directHitRate * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="Watcher 占比" value={Number((data.mapScene.realtimeSync.total.watcherShare * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="平均追平滞后" value={formatDurationMs(data.mapScene.realtimeSync.total.avgWatcherLagMs)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="最大追平滞后" value={formatDurationMs(data.mapScene.realtimeSync.total.watcherLagMaxMs)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="活跃轮询" value={formatNumber(data.mapScene.realtimeSync.total.activePollChecks)} />
                      </Col>
                      <Col xs={24} sm={12} xl={8}>
                        <Statistic title="空闲轮询" value={formatNumber(data.mapScene.realtimeSync.total.idlePollChecks)} />
                      </Col>
                    </Row>
                    <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
                      <Text style={{ color: "#b7af9f" }}>
                        总追平 {formatNumber(data.mapScene.realtimeSync.total.totalRefreshes)}
                        {" / "}
                        空闲整刷 {formatNumber(data.mapScene.realtimeSync.total.idleRefreshes)}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        {watcherReasonText}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        这一组指标专门用于判断地图慢刷新是否主要卡在 watcher 兜底，而不是协议包体本身。
                      </Text>
                    </Space>
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 direct / watcher 追平样本" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                size="small"
                title="地图 Realtime / 协议细分"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    WS watcher {formatNumber(data.mapScene.realtimeSync.byTransport.ws.watcherRefreshes)}
                    {" / "}
                    SSE watcher {formatNumber(data.mapScene.realtimeSync.byTransport.sse.watcherRefreshes)}
                  </Text>
                )}
              >
                {hasRealtimeSyncSamples ? (
                  <>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12}>
                        <Statistic title="WS Scene 占比" value={Number((data.mapScene.realtimeSync.transport.wsSceneRatio * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="SSE 回退占比" value={Number((data.mapScene.realtimeSync.transport.sseFallbackRatio * 100).toFixed(1))} suffix="%" />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="WS 直接更新" value={formatNumber(data.mapScene.realtimeSync.byTransport.ws.directUpdates)} />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="SSE 直接更新" value={formatNumber(data.mapScene.realtimeSync.byTransport.sse.directUpdates)} />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="WS 平均追平" value={formatDurationMs(data.mapScene.realtimeSync.byTransport.ws.avgWatcherLagMs)} />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="SSE 平均追平" value={formatDurationMs(data.mapScene.realtimeSync.byTransport.sse.avgWatcherLagMs)} />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="WS 活跃轮询" value={formatNumber(data.mapScene.realtimeSync.byTransport.ws.activePollChecks)} />
                      </Col>
                      <Col xs={24} sm={12}>
                        <Statistic title="SSE 活跃轮询" value={formatNumber(data.mapScene.realtimeSync.byTransport.sse.activePollChecks)} />
                      </Col>
                    </Row>
                    <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
                      <Text style={{ color: "#b7af9f" }}>
                        WS 连接 {formatNumber(data.mapScene.realtimeSync.transport.wsSceneOpens)}
                        {" / "}
                        SSE 回退 {formatNumber(data.mapScene.realtimeSync.transport.sseFallbackOpens)}
                      </Text>
                      <Text style={{ color: "#b7af9f" }}>
                        {sseFallbackReasonText}
                      </Text>
                    </Space>
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无协议追平细分样本" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={10}>
              <Card size="small" title="地图场景命中结构">
                {sourcePieData.length > 0 ? (
                  <Pie {...pieConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无命中数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={14}>
              <Card size="small" title="Fallback 原因分布">
                {fallbackReasonData.length > 0 ? (
                  <>
                    <Column {...fallbackReasonConfig} />
                    {coldFallbackReasonData.length > 0 ? (
                      <Space direction="vertical" size={4} style={{ marginTop: 12 }}>
                        <Text style={{ color: "#b7af9f" }}>
                          冷启动回退 {formatNumber(data.mapScene.source.coldFallbackCount)} 次
                        </Text>
                        <Text style={{ color: "#b7af9f" }}>
                          {coldFallbackReasonData[0].reason} · {formatNumber(coldFallbackReasonData[0].count)} 次
                        </Text>
                      </Space>
                    ) : null}
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 fallback 原因" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card
                size="small"
                title="Watcher 原因分布"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    {watcherReasonText}
                  </Text>
                )}
              >
                {watcherReasonData.length > 0 ? (
                  <Column {...watcherReasonConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 watcher 原因命中" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                size="small"
                title="地图可见性过滤"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    样本 {formatNumber(data.mapScene.visibility.samples)}
                  </Text>
                )}
              >
                <Row gutter={[12, 12]}>
                  <Col xs={12}>
                    <Statistic title="玩家" value={formatNumber(data.mapScene.visibility.filteredEntityCounts.player)} />
                  </Col>
                  <Col xs={12}>
                    <Statistic title="NPC" value={formatNumber(data.mapScene.visibility.filteredEntityCounts.npc)} />
                  </Col>
                  <Col xs={12}>
                    <Statistic title="怪物" value={formatNumber(data.mapScene.visibility.filteredEntityCounts.monster)} />
                  </Col>
                  <Col xs={12}>
                    <Statistic title="机缘" value={formatNumber(data.mapScene.visibility.filteredEntityCounts.opportunity)} />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={12}>
              <Card size="small" title="SSE 回退原因">
                {sseFallbackReasonData.length > 0 ? (
                  <Column {...sseFallbackReasonConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 SSE 回退" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title="首帧 / Shared State"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    player_transition warm {formatNumber(data.mapScene.source.playerTransitionWarmHits)}
                  </Text>
                )}
              >
                <Row gutter={[12, 12]}>
                  <Col xs={24} sm={12}>
                    <Statistic title="Shared Warm Hit" value={Number((data.mapScene.source.sharedStateWarmHitRate * 100).toFixed(1))} suffix="%" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="首帧平均引导" value={formatDurationMs(data.mapScene.source.firstFrameBootstrapLatencyMs)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="首帧最大引导" value={formatDurationMs(data.mapScene.source.firstFrameBootstrapMaxLatencyMs)} />
                  </Col>
                  <Col xs={24} sm={12}>
                    <Statistic title="Stale 命中" value={formatNumber(data.mapScene.source.staleServedWhileRefreshCount)} />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={14}>
              <Card size="small" title="热点地图命中 / 回退">
                {topMapData.length > 0 ? (
                  <Bar {...topMapConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无热点地图数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card size="small" title="内部慢请求路径">
                {internalSlowPathData.length > 0 ? (
                  <Column {...internalSlowPathConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无内部慢请求" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title="读模型缓存 / 命中率"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    失效 {formatNumber(data.runtime.readModelCache.totalInvalidations)}
                  </Text>
                )}
              >
                {readModelCacheData.length > 0 ? (
                  <Column {...readModelCacheConfig} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无读模型缓存数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title="AOI / 热点地图订阅"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    预取圈 {formatNumber(data.mapScene.aoi.preloadRings)}
                  </Text>
                )}
              >
                {aoiTopMapData.length > 0 ? (
                  <Bar {...aoiTopMapConfig} data={aoiTopMapData.flatMap((item) => ([
                    { mapId: item.mapId, type: "AOI", subscriberCount: item.subscriberCount },
                    { mapId: item.mapId, type: "Signal", subscriberCount: item.signalSubscriberCount },
                  ]))} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 AOI 订阅数据" />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={13}>
              <Card
                size="small"
                title="当前共享地图状态"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    Scene 缓存 {formatNumber(data.mapScene.caches.sceneContextCacheSize)} / 热 {formatNumber(data.mapScene.caches.sceneContextHotCount)} / Socket {formatNumber(data.mapScene.caches.socketPlayerCacheSize)}
                  </Text>
                )}
              >
                <Table
                  size="small"
                  rowKey="mapId"
                  pagination={false}
                  scroll={{ x: 760 }}
                  dataSource={data.mapScene.sharedMaps}
                  columns={sharedMapColumns}
                />
              </Card>
            </Col>
            <Col xs={24} xl={11}>
              <Card
                size="small"
                title="最近异常流"
                extra={(
                  <Text style={{ color: "#b7af9f" }}>
                    Node {data.runtime.nodeVersion} / Pool {formatNumber(data.runtime.databasePoolMax)}
                  </Text>
                )}
              >
                {data.recentEvents.length > 0 ? (
                  <List
                    size="small"
                    dataSource={data.recentEvents}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={4} style={{ width: "100%" }}>
                          <Space wrap size={[8, 4]}>
                            <Tag color={levelColor(item.level)}>{item.level.toUpperCase()}</Tag>
                            <Tag>{item.source}</Tag>
                            <Text style={{ color: "#b7af9f" }}>{formatTime(item.at)}</Text>
                          </Space>
                          <Text style={{ color: "#e8e0d0" }}>{item.message}</Text>
                          <Text style={{ color: "#9fb0c9", fontSize: 12 }}>
                            {Object.entries(item.data || {})
                              .slice(0, 6)
                              .map(([key, value]) => `${key}=${String(value)}`)
                              .join(" | ") || "-"}
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无异常事件" />
                )}
              </Card>
            </Col>
          </Row>
        </Space>
      )}
    </Card>
  );
}
