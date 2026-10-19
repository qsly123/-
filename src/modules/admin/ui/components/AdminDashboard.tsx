"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, Row, Space, Typography } from "antd";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import type { AdminDashboardChartsProps } from "@/modules/admin/ui/components/AdminDashboardCharts";
import type {
  AdminPerformancePanelData,
  AdminPerformancePanelProps,
} from "@/modules/admin/ui/components/AdminPerformancePanel";

const { Text, Title } = Typography;
const DashboardCharts = dynamic<AdminDashboardChartsProps>(
  () => import("@/modules/admin/ui/components/AdminDashboardCharts"),
  { ssr: false },
);
const AdminPerformancePanel = dynamic<AdminPerformancePanelProps>(
  () => import("@/modules/admin/ui/components/AdminPerformancePanel"),
  { ssr: false },
);

type DashboardData = {
  generatedAt: string;
  users: {
    totalAccounts: number;
    totalCharacters: number;
    accountsWithCharacters: number;
    accountsWithoutCharacters: number;
    onlineSessions: number;
    adminAccounts: number;
    aliveCharacters: number;
    deadCharacters: number;
  };
  content: {
    mapCount: number;
    npcCount: number;
    monsterCount: number;
    questCount: number;
    eventCount: number;
    skillCount: number;
    itemCount: number;
  };
  activity: {
    totalCombats: number;
    todayCombats: number;
    todayNewAccounts: number;
    todayNewCharacters: number;
    last7DaysNewAccounts: number;
    last7DaysNewCharacters: number;
    last7DaysCombats: number;
    trend7d: Array<{
      date: string;
      newAccounts: number;
      newCharacters: number;
      combats: number;
    }>;
  };
};

type DashboardResponse = {
  success: boolean;
  data?: DashboardData;
  error?: string;
};

type PerformanceResponse = {
  success: boolean;
  data?: AdminPerformancePanelData;
  error?: string;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTime(value: string) {
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

function MetricGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
}) {
  const readableSecondaryText = "#b7af9f";

  return (
    <Card size="small" title={title}>
      <Space orientation="vertical" style={{ width: "100%" }} size={10}>
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: readableSecondaryText }}>{item.label}</Text>
            <Text style={{ color: "#c9a84c", fontWeight: 600 }}>
              {formatNumber(item.value)}
            </Text>
          </div>
        ))}
      </Space>
    </Card>
  );
}

export default function AdminDashboard() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DashboardData | null>(null);
  const [performance, setPerformance] = useState<AdminPerformancePanelData | null>(null);

  const fetchStats = useCallback(async (options?: { silent?: boolean }) => {
    setLoading(true);
    try {
      const [dashboardResult, performanceResult] = await Promise.allSettled([
        fetch("/api/admin/dashboard", { cache: "no-store" }),
        fetch("/api/admin/performance", { cache: "no-store" }),
      ]);

      let hasError = false;

      if (dashboardResult.status === "fulfilled") {
        const data: DashboardResponse = await dashboardResult.value.json();
        if (data.success && data.data) {
          setStats(data.data);
        } else {
          hasError = true;
        }
      } else {
        hasError = true;
      }

      if (performanceResult.status === "fulfilled") {
        const data: PerformanceResponse = await performanceResult.value.json();
        if (data.success && data.data) {
          setPerformance(data.data);
        } else {
          hasError = true;
        }
      } else {
        hasError = true;
      }

      if (hasError && !options?.silent) {
        message.error("部分后台分析数据加载失败");
      }
    } catch {
      if (!options?.silent) {
        message.error("加载仪表盘失败");
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchStats();
    const timer = window.setInterval(() => {
      void fetchStats({ silent: true });
    }, 20_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchStats]);

  const accountRoleItems = useMemo(() => {
    if (!stats) return [];

    return [
      { label: "总账号", value: stats.users.totalAccounts },
      { label: "总角色", value: stats.users.totalCharacters },
      { label: "有角色账号", value: stats.users.accountsWithCharacters },
      { label: "无角色账号", value: stats.users.accountsWithoutCharacters },
      { label: "在线会话", value: stats.users.onlineSessions },
      { label: "管理员账号", value: stats.users.adminAccounts },
      { label: "存活角色", value: stats.users.aliveCharacters },
    ];
  }, [stats]);

  const contentItems = useMemo(() => {
    if (!stats) return [];

    return [
      { label: "地图", value: stats.content.mapCount },
      { label: "NPC", value: stats.content.npcCount },
      { label: "怪物", value: stats.content.monsterCount },
      { label: "任务", value: stats.content.questCount },
      { label: "事件", value: stats.content.eventCount },
      { label: "神通", value: stats.content.skillCount },
      { label: "物品", value: stats.content.itemCount },
    ];
  }, [stats]);

  const activityItems = useMemo(() => {
    if (!stats) return [];

    return [
      { label: "总战斗", value: stats.activity.totalCombats },
      { label: "今日战斗", value: stats.activity.todayCombats },
      { label: "今日新增账号", value: stats.activity.todayNewAccounts },
      { label: "今日新增角色", value: stats.activity.todayNewCharacters },
      { label: "7日新增账号", value: stats.activity.last7DaysNewAccounts },
      { label: "7日新增角色", value: stats.activity.last7DaysNewCharacters },
      { label: "7日战斗", value: stats.activity.last7DaysCombats },
    ];
  }, [stats]);

  const accountCoverageItems = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "有角色账号", value: stats.users.accountsWithCharacters },
      { label: "无角色账号", value: stats.users.accountsWithoutCharacters },
    ];
  }, [stats]);

  const characterStatusItems = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "存活角色", value: stats.users.aliveCharacters },
      { label: "阵亡角色", value: stats.users.deadCharacters },
    ];
  }, [stats]);

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>后台仪表盘</Title>
          <DarkTag color="gold">V1</DarkTag>
        </Space>
      }
      extra={
        <Space>
          <Text style={{ color: "#b7af9f" }}>
            更新时间：{stats ? formatTime(stats.generatedAt) : "-"}
          </Text>
          <Button loading={loading} onClick={() => void fetchStats()}>
            刷新
          </Button>
        </Space>
      }
      loading={loading && !stats}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Text style={{ color: "#b7af9f", fontSize: 12 }}>
          今日数据从服务器本地时间 00:00 开始统计；趋势图展示最近 7 天。
        </Text>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={8}>
            <MetricGroup title="账号与角色" items={accountRoleItems} />
          </Col>
          <Col xs={24} xl={8}>
            <MetricGroup title="内容" items={contentItems} />
          </Col>
          <Col xs={24} xl={8}>
            <MetricGroup title="活跃" items={activityItems} />
          </Col>
        </Row>

        <DashboardCharts
          contentItems={contentItems}
          trend7d={stats?.activity.trend7d || []}
          accountCoverageItems={accountCoverageItems}
          characterStatusItems={characterStatusItems}
        />

        <AdminPerformancePanel data={performance} loading={loading} />
      </Space>
    </Card>
  );
}
