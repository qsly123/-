"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Progress, Space, Spin, Typography } from "antd";
import {
  ArrowLeftOutlined,
  BookOutlined,
  RiseOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import { getGongfaBonusLabel } from "@/modules/shared/services/gongfa-bonus";
import {
  buildCultivationActionButtonStyle,
  cultivationPageWideShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

const { Text } = Typography;

type GongfaBonusItem = {
  key: string;
  label: string;
  value: number;
};

type GongfaLevelConfig = {
  levelIndex: number;
  layerLabel: string;
  upgradeCost: number;
  requirementType: string;
  requirementValue: number;
  requirementText: string;
  bonuses: Record<string, number>;
};

type PlayerGongfaRecord = {
  id: number;
  code: string;
  name: string;
  gongfaType: "normal" | "sex";
  description: string;
  tier: number;
  maxLevel: number;
  currentLevel: number;
  currentLayerLabel: string;
  nextLevel: GongfaLevelConfig | null;
  learned: boolean;
  maxed: boolean;
  activeBonuses: GongfaBonusItem[];
};

type GongfaView = {
  points: number;
  totalEarned: number;
  updatedAt: string | null;
  books: PlayerGongfaRecord[];
  totalBonuses: GongfaBonusItem[];
};

function formatBonusValue(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatBonusRecord(record: Record<string, number>) {
  return Object.entries(record)
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([key, value]) => `${getGongfaBonusLabel(key)} +${formatBonusValue(Number(value || 0))}`)
    .join(" / ");
}

export default function GongfaPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [view, setView] = useState<GongfaView | null>(null);

  const normalBooks = useMemo(
    () => (view?.books || []).filter((book) => book.gongfaType !== "sex"),
    [view?.books],
  );
  const sexBooks = useMemo(
    () => (view?.books || []).filter((book) => book.gongfaType === "sex"),
    [view?.books],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/game/gongfa");
      const json = await response.json();
      if (!json.success) {
        message.error(json.error || "获取功法失败");
        return;
      }
      setView(json.data);
    } catch {
      message.error("获取功法失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const upgrade = async (gongfaId: number) => {
    setSavingId(gongfaId);
    try {
      const response = await fetch("/api/game/gongfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upgrade", gongfaId }),
      });
      const json = await response.json();
      if (!json.success) {
        message.warning(json.error || "修炼功法失败");
        return;
      }
      setView(json.data);
      message.success("功法修炼成功");
    } catch {
      message.error("修炼功法失败");
    } finally {
      setSavingId(null);
    }
  };

  const renderBook = (book: PlayerGongfaRecord) => {
    const percent = Math.floor((Math.max(0, book.currentLevel) / Math.max(1, book.maxLevel)) * 100);
    const nextBonus = book.nextLevel ? formatBonusRecord(book.nextLevel.bonuses) : "";
    const canUpgrade = Boolean(book.nextLevel) && (view?.points || 0) >= (book.nextLevel?.upgradeCost || 0);

    return (
      <Card
        key={book.id}
        size="small"
        style={{
          ...cultivationSectionCardStyle,
          marginBottom: 8,
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <Space size={5} wrap>
              <BookOutlined style={{ color: book.gongfaType === "sex" ? "#e879a6" : "#c9a84c" }} />
              <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>{book.name}</Text>
              <DarkTag color={book.gongfaType === "sex" ? "#e879a6" : "#c9a84c"} style={{ fontSize: 10, padding: "0 4px" }}>
                {book.gongfaType === "sex" ? "双修功法" : `品阶 ${book.tier}`}
              </DarkTag>
            </Space>
            <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 4 }}>
              {book.description || "暂无功法描述"}
            </Text>
          </div>
          <Button
            size="small"
            type={canUpgrade ? "primary" : "default"}
            icon={<RiseOutlined />}
            loading={savingId === book.id}
            disabled={book.maxed || !book.nextLevel || savingId !== null}
            onClick={() => { void upgrade(book.id); }}
          >
            {book.maxed ? "圆满" : "修炼"}
          </Button>
        </div>

        <div style={{ marginTop: 8 }}>
          <Text style={{ color: "#a09880", fontSize: 11 }}>
            当前：{book.currentLayerLabel} · {book.currentLevel}/{book.maxLevel}
          </Text>
          <Progress
            percent={percent}
            showInfo={false}
            size="small"
            strokeColor={book.gongfaType === "sex" ? "#e879a6" : "#c9a84c"}
            style={{ margin: "4px 0" }}
          />
        </div>

        {book.activeBonuses.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {book.activeBonuses.map((bonus) => (
              <DarkTag key={`${book.id}-${bonus.key}`} color="#52b788" style={{ fontSize: 10, padding: "0 4px" }}>
                {bonus.label} +{formatBonusValue(bonus.value)}
              </DarkTag>
            ))}
          </div>
        ) : (
          <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 6 }}>尚未获得属性加成</Text>
        )}

        {book.nextLevel ? (
          <div style={{ ...cultivationSoftPanelStyle, padding: "6px 7px", marginTop: 7 }}>
            <Text style={{ color: "#c9a84c", fontSize: 11, display: "block" }}>
              下一层：{book.nextLevel.layerLabel} · 消耗 {book.nextLevel.upgradeCost} 功法点
            </Text>
            <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 2 }}>
              {nextBonus || "下一层暂无属性加成"}
            </Text>
          </div>
        ) : null}
      </Card>
    );
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ ...cultivationPageWideShellStyle, padding: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/character")}>
          返回角色
        </Button>
      </div>

      <Card size="small" style={{ ...cultivationSectionCardStyle, marginBottom: 8, borderRadius: 8 }}>
        <Space size={6} wrap>
          <ThunderboltOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>功法</Text>
          <DarkTag color="#c9a84c">功法点 {view?.points || 0}</DarkTag>
          <DarkTag color="#6b8cff">累计 {view?.totalEarned || 0}</DarkTag>
        </Space>
        <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 5 }}>
          功法点来自突破：每突破一个小境界 +1，突破到新大境界 +3。
        </Text>
      </Card>

      <Card size="small" title={<Text style={{ color: "#e8e0d0" }}>当前总加成</Text>} style={{ ...cultivationSectionCardStyle, marginBottom: 8, borderRadius: 8 }}>
        {view?.totalBonuses?.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {view.totalBonuses.map((bonus) => (
              <DarkTag key={bonus.key} color="#52b788" style={{ fontSize: 10, padding: "0 4px" }}>
                {bonus.label} +{formatBonusValue(bonus.value)}
              </DarkTag>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无功法加成</Text>} />
        )}
      </Card>

      <Card size="small" title={<Text style={{ color: "#e8e0d0" }}>核心功法</Text>} style={{ ...cultivationSectionCardStyle, marginBottom: 8, borderRadius: 8 }}>
        {normalBooks.length > 0 ? normalBooks.map(renderBook) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无核心功法</Text>} />
        )}
      </Card>

      <Card size="small" title={<Text style={{ color: "#e8e0d0" }}>双修功法</Text>} style={{ ...cultivationSectionCardStyle, marginBottom: 8, borderRadius: 8 }}>
        {sexBooks.length > 0 ? sexBooks.map(renderBook) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无双修功法</Text>} />
        )}
      </Card>

      <Button
        block
        icon={<BookOutlined />}
        style={{ ...buildCultivationActionButtonStyle({ dreamy: true }), minHeight: 42 }}
        onClick={() => router.push("/game/skills")}
      >
        查看神通配置
      </Button>
    </div>
  );
}
