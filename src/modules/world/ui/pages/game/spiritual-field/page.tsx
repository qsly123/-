"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Progress, Select, Space, Spin, Typography } from "antd";
import {
  ArrowLeftOutlined,
  FieldTimeOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import {
  buildCultivationActionButtonStyle,
  cultivationPageWideShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

const { Text } = Typography;

type SpiritualFieldSeed = {
  id: number;
  seedItemId: string;
  outputItemId: string;
  name: string;
  growthSeconds: number;
  minYield: number;
  maxYield: number;
  seedItemName: string;
  seedItemIconUrl: string | null;
  outputItemName: string;
  outputItemIconUrl: string | null;
  ownedQuantity: number;
};

type SpiritualFieldPlot = {
  id: number;
  plotIndex: number;
  status: "empty" | "growing" | "ready" | "harvested";
  seedItemId: string | null;
  outputItemId: string | null;
  seedName: string | null;
  plantedAt: string | null;
  readyAt: string | null;
  harvestedAt: string | null;
  growthSeconds: number;
  minYield: number;
  maxYield: number;
  remainingSeconds: number;
  progressPercent: number;
  seedItemName: string | null;
  outputItemName: string | null;
};

type SpiritualFieldBottle = {
  itemId: string;
  itemName: string;
  star: number;
  energy: number;
  energyCost: number;
  reduceSeconds: number;
} | null;

type SpiritualFieldView = {
  plotCount: number;
  seeds: SpiritualFieldSeed[];
  plots: SpiritualFieldPlot[];
  bottle: SpiritualFieldBottle;
};

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}时${minutes}分`;
  }
  return `${minutes}分`;
}

function formatStatus(status: SpiritualFieldPlot["status"]) {
  if (status === "ready") {
    return "可收获";
  }
  if (status === "growing") {
    return "生长中";
  }
  if (status === "harvested") {
    return "已收获";
  }
  return "空闲";
}

function statusColor(status: SpiritualFieldPlot["status"]) {
  if (status === "ready") {
    return "#52b788";
  }
  if (status === "growing") {
    return "#c9a84c";
  }
  if (status === "harvested") {
    return "#6b8cff";
  }
  return "#6b6355";
}

export default function SpiritualFieldPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [savingPlotId, setSavingPlotId] = useState<number | null>(null);
  const [selectedSeeds, setSelectedSeeds] = useState<Record<number, string>>({});
  const [view, setView] = useState<SpiritualFieldView | null>(null);

  const seedOptions = useMemo(() => (view?.seeds || []).map((seed) => ({
    value: seed.seedItemId,
    label: `${seed.seedItemName || seed.name} x${seed.ownedQuantity}`,
    disabled: seed.ownedQuantity <= 0,
  })), [view?.seeds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/game/spiritual-field", { cache: "no-store" });
      const json = await response.json();
      if (!json.success) {
        message.error(json.error || "获取灵田失败");
        return;
      }
      setView(json.data);
    } catch {
      message.error("获取灵田失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const doAction = async (plotId: number, action: "plant" | "harvest" | "accelerate") => {
    setSavingPlotId(plotId);
    try {
      const response = await fetch("/api/game/spiritual-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          plotId,
          seedItemId: selectedSeeds[plotId],
        }),
      });
      const json = await response.json();
      if (!json.success) {
        message.warning(json.error || "灵田操作失败");
        return;
      }
      setView(json.data);
      message.success(action === "plant" ? "灵种已种下" : action === "harvest" ? "收获完成" : "加速完成");
    } catch {
      message.error("灵田操作失败");
    } finally {
      setSavingPlotId(null);
    }
  };

  const renderPlot = (plot: SpiritualFieldPlot) => {
    const isBusy = savingPlotId === plot.id;
    const selectedSeed = selectedSeeds[plot.id] || "";
    const canPlant = (plot.status === "empty" || plot.status === "harvested") && Boolean(selectedSeed);
    const canAccelerate = plot.status === "growing" && Boolean(view?.bottle);
    const actionStyle = buildCultivationActionButtonStyle({ dreamy: true });
    const primaryStyle = buildCultivationActionButtonStyle({ active: true, dreamy: true });

    return (
      <Card
        key={plot.id}
        size="small"
        style={{ ...cultivationSectionCardStyle, borderRadius: 8, marginBottom: 8 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <Space size={5} wrap>
              <FieldTimeOutlined style={{ color: statusColor(plot.status) }} />
              <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>灵田 {plot.plotIndex}</Text>
              <DarkTag color={statusColor(plot.status)} style={{ fontSize: 10, padding: "0 4px" }}>
                {formatStatus(plot.status)}
              </DarkTag>
            </Space>
            <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 4 }}>
              {plot.seedName ? `${plot.seedName} -> ${plot.outputItemName || plot.outputItemId}` : "此地块暂无灵植"}
            </Text>
          </div>
          {plot.status === "ready" ? (
            <Button
              size="small"
              type="primary"
              loading={isBusy}
              style={primaryStyle}
              onClick={() => { void doAction(plot.id, "harvest"); }}
            >
              收获
            </Button>
          ) : null}
        </div>

        {plot.status === "growing" || plot.status === "ready" ? (
          <div style={{ marginTop: 8 }}>
            <Progress
              percent={plot.status === "ready" ? 100 : plot.progressPercent}
              size="small"
              showInfo={false}
              strokeColor={statusColor(plot.status)}
            />
            <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 4 }}>
              {plot.status === "ready" ? "灵植已经成熟" : `剩余 ${formatDuration(plot.remainingSeconds)}`}
              {" "}· 预计产量 {plot.minYield}-{plot.maxYield}
            </Text>
            {plot.status === "growing" ? (
              <Button
                block
                size="small"
                icon={<ThunderboltOutlined />}
                loading={isBusy}
                disabled={!canAccelerate}
                style={{ ...actionStyle, marginTop: 7 }}
                onClick={() => { void doAction(plot.id, "accelerate"); }}
              >
                掌天瓶加速
              </Button>
            ) : null}
          </div>
        ) : (
          <div style={{ ...cultivationSoftPanelStyle, padding: "7px", marginTop: 8 }}>
            <Select
              size="small"
              placeholder="选择灵种"
              value={selectedSeed || undefined}
              options={seedOptions}
              style={{ width: "100%", marginBottom: 7 }}
              onChange={(value) => setSelectedSeeds((prev) => ({ ...prev, [plot.id]: value }))}
            />
            <Button
              block
              size="small"
              type="primary"
              loading={isBusy}
              disabled={!canPlant}
              style={canPlant ? primaryStyle : actionStyle}
              onClick={() => { void doAction(plot.id, "plant"); }}
            >
              种下灵种
            </Button>
          </div>
        )}
      </Card>
    );
  };

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>;
  }

  return (
    <div style={{ ...cultivationPageWideShellStyle, padding: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/dongfu")}>
          返回洞府
        </Button>
      </div>

      <Card size="small" style={{ ...cultivationSectionCardStyle, borderRadius: 8, marginBottom: 8 }}>
        <Space size={6} wrap>
          <FieldTimeOutlined style={{ color: "#52b788" }} />
          <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>灵田</Text>
          <DarkTag color="#52b788">地块 {view?.plotCount || 0}</DarkTag>
          {view?.bottle ? (
            <DarkTag color="#c9a84c">
              {view.bottle.itemName} 能量 {view.bottle.energy}/{view.bottle.energyCost}
            </DarkTag>
          ) : (
            <DarkTag color="#6b6355">未持有掌天瓶</DarkTag>
          )}
        </Space>
        <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 5 }}>
          灵田已从历史插件迁入固定核心模块。种植扣除背包灵种，成熟收获直接进入背包，掌天瓶加速消耗服务端能量。
        </Text>
      </Card>

      <Card size="small" title={<Text style={{ color: "#e8e0d0" }}>可用灵种</Text>} style={{ ...cultivationSectionCardStyle, borderRadius: 8, marginBottom: 8 }}>
        {view?.seeds?.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {view.seeds.map((seed) => (
              <DarkTag key={seed.seedItemId} color={seed.ownedQuantity > 0 ? "#52b788" : "#6b6355"} style={{ fontSize: 10, padding: "0 4px" }}>
                {seed.seedItemName || seed.name} x{seed.ownedQuantity}
              </DarkTag>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无灵种配置</Text>} />
        )}
      </Card>

      {view?.plots?.length ? view.plots.map(renderPlot) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无灵田地块</Text>} />
      )}
    </div>
  );
}
