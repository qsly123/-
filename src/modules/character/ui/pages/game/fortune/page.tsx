"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftOutlined, StarOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Modal, Space, Spin, Typography, message } from "antd";
import {
  buildFortuneAttrLines,
  buildFortuneEventSections,
  buildFortuneSpecialLines,
} from "@/modules/character/ui/components/fortune-effect-utils";
import type { AttributeDelta, FortuneEventEffects, FortuneSpecialEffects } from "@/types/game";
import {
  buildCultivationActionButtonStyle,
  buildCultivationRevealStyle,
  cultivationCompactBarStyle,
  cultivationPageShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

const { Text, Title } = Typography;

type AttributeEffects = AttributeDelta;
type SpecialEffects = FortuneSpecialEffects;

type FortuneItem = {
  playerFortuneId: number;
  fortuneId: string;
  name: string;
  description: string | null;
  grade: string;
  enabled: boolean;
  expiresAt: string | null;
  acquiredAt: string;
  remainingSeconds: number | null;
  attrEffects: AttributeEffects;
  accumulatedAttrEffects: AttributeEffects;
  eventEffects: FortuneEventEffects;
  specialEffects: SpecialEffects;
};

type FortuneSummary = {
  attrEffects: AttributeEffects;
  specialEffects: Required<SpecialEffects>;
};

function formatRemaining(remainingSeconds: number | null) {
  if (remainingSeconds === null) {
    return "永久";
  }
  if (remainingSeconds <= 0) {
    return "已到期";
  }
  const day = Math.floor(remainingSeconds / 86400);
  const hour = Math.floor((remainingSeconds % 86400) / 3600);
  const minute = Math.floor((remainingSeconds % 3600) / 60);
  if (day > 0) {
    return `${day}天${hour}小时`;
  }
  if (hour > 0) {
    return `${hour}小时${minute}分钟`;
  }
  return `${Math.max(1, minute)}分钟`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getGradeStyle(grade: string) {
  if (grade === "red") return { color: "#ff4d4f", borderColor: "rgba(255, 77, 79, 0.35)" };
  if (grade === "gold") return { color: "#f7d774", borderColor: "rgba(247, 215, 116, 0.35)" };
  if (grade === "purple") return { color: "#d18bff", borderColor: "rgba(209, 139, 255, 0.35)" };
  if (grade === "blue") return { color: "#7eb9ff", borderColor: "rgba(126, 185, 255, 0.35)" };
  return { color: "#d9d9d9", borderColor: "rgba(217, 217, 217, 0.25)" };
}

export default function FortunePage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [lingYu, setLingYu] = useState(0);
  const [fortunes, setFortunes] = useState<FortuneItem[]>([]);
  const [summary, setSummary] = useState<FortuneSummary | null>(null);
  const [detailFortune, setDetailFortune] = useState<FortuneItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, fortuneRes] = await Promise.all([
        fetch("/api/auth/me?view=summary", { cache: "no-store" }),
        fetch("/api/game/fortune", { cache: "no-store" }),
      ]);
      const profileJson = await profileRes.json() as {
        success: boolean;
        data?: { lingYu?: number };
      };
      const fortuneJson = await fortuneRes.json() as {
        success: boolean;
        error?: string;
        data?: {
          fortunes?: FortuneItem[];
          summary?: FortuneSummary;
        };
      };

      if (profileJson.success) {
        setLingYu(Number(profileJson.data?.lingYu || 0));
      }
      if (!fortuneJson.success || !fortuneJson.data) {
        throw new Error(fortuneJson.error || "加载气运失败");
      }

      setFortunes(Array.isArray(fortuneJson.data.fortunes) ? fortuneJson.data.fortunes : []);
      setSummary(fortuneJson.data.summary || null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载气运失败");
      setFortunes([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const summaryAttrLines = useMemo(() => buildFortuneAttrLines(summary?.attrEffects), [summary]);
  const summarySpecialLines = useMemo(() => buildFortuneSpecialLines(summary?.specialEffects), [summary]);
  const detailAttrLines = useMemo(() => buildFortuneAttrLines(detailFortune?.attrEffects), [detailFortune]);
  const detailAccumulatedLines = useMemo(() => buildFortuneAttrLines(detailFortune?.accumulatedAttrEffects), [detailFortune]);
  const detailSpecialLines = useMemo(() => buildFortuneSpecialLines(detailFortune?.specialEffects), [detailFortune]);
  const detailEventLines = useMemo(() => buildFortuneEventSections(detailFortune?.eventEffects), [detailFortune]);
  const actionButtonStyle = {
    ...buildCultivationActionButtonStyle(),
    minHeight: 30,
  } as const;

  return (
    <div style={{ ...cultivationPageShellStyle, ...buildCultivationRevealStyle(0) }}>
      {contextHolder}

      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} style={actionButtonStyle} onClick={() => router.push("/game/character")}>
          返回角色
        </Button>
      </div>

      <Card
        size="small"
        style={{ ...cultivationCompactBarStyle, ...buildCultivationRevealStyle(30), marginBottom: 8, borderRadius: 16 }}
      >
        <Title level={5} style={{ margin: 0, color: "#c9a84c" }}>
          <StarOutlined /> 我的气运
        </Title>
        <Text style={{ color: "#a09880", fontSize: 12 }}>当前灵玉：{lingYu}</Text>
      </Card>

      <Card
        size="small"
        style={{ ...cultivationSectionCardStyle, ...buildCultivationRevealStyle(70), marginBottom: 8, borderRadius: 16 }}
      >
        <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 8 }}>效果总汇</Text>
        {summaryAttrLines.length < 1 && summarySpecialLines.length < 1 ? (
          <Text style={{ color: "#6b6355", fontSize: 12 }}>暂无生效气运</Text>
        ) : (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {summaryAttrLines.map((line) => (
              <Text key={line} style={{ color: "#a09880", fontSize: 12 }}>{line}</Text>
            ))}
            {summarySpecialLines.map((line) => (
              <Text key={line} style={{ color: "#52b788", fontSize: 12 }}>{line}</Text>
            ))}
          </Space>
        )}
      </Card>

      <Card
        size="small"
        style={{ ...cultivationSectionCardStyle, ...buildCultivationRevealStyle(110), borderRadius: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={{ color: "#c9a84c", fontSize: 13 }}>已持有气运</Text>
          <Button size="small" style={actionButtonStyle} onClick={() => void fetchData()}>刷新</Button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spin />
          </div>
        ) : fortunes.length < 1 ? (
          <Empty description={<Text style={{ color: "#6b6355" }}>暂无气运</Text>} />
        ) : (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {fortunes.map((fortune) => {
              const gradeStyle = getGradeStyle(fortune.grade);
              return (
                <Card
                  key={fortune.playerFortuneId}
                  size="small"
                  style={{
                    ...cultivationSoftPanelStyle,
                    borderColor: gradeStyle.borderColor,
                    cursor: "pointer",
                    borderRadius: 14,
                  }}
                  onClick={() => setDetailFortune(fortune)}
                >
                  <Text style={{ color: gradeStyle.color, fontWeight: 600 }}>{fortune.name}</Text>
                  <Text style={{ display: "block", color: "#6b6355", fontSize: 11 }}>
                    时效：{formatRemaining(fortune.remainingSeconds)}
                  </Text>
                  {fortune.description && (
                    <Text style={{ display: "block", color: "#a09880", fontSize: 12, marginTop: 6 }}>
                      {fortune.description}
                    </Text>
                  )}
                </Card>
              );
            })}
          </Space>
        )}
      </Card>

      <Modal
        title={detailFortune ? `气运详情 · ${detailFortune.name}` : "气运详情"}
        open={Boolean(detailFortune)}
        onCancel={() => setDetailFortune(null)}
        footer={null}
        destroyOnHidden
      >
        {detailFortune && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>基础信息</Text>
              <Text style={{ color: "#a09880", display: "block" }}>状态：{detailFortune.enabled ? "已启用" : "未启用"}</Text>
              <Text style={{ color: "#a09880", display: "block" }}>时效：{formatRemaining(detailFortune.remainingSeconds)}</Text>
              <Text style={{ color: "#a09880", display: "block" }}>获得时间：{formatDateTime(detailFortune.acquiredAt)}</Text>
              <Text style={{ color: "#a09880", display: "block", marginTop: 8 }}>
                {detailFortune.description || "暂无介绍"}
              </Text>
            </div>

            <div>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>属性加成</Text>
              {detailAttrLines.length > 0 ? detailAttrLines.map((line) => (
                <Text key={line} style={{ color: "#a09880", display: "block" }}>{line}</Text>
              )) : <Text style={{ color: "#6b6355", display: "block" }}>无</Text>}
            </div>

            <div>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>累计属性加成</Text>
              {detailAccumulatedLines.length > 0 ? detailAccumulatedLines.map((line) => (
                <Text key={line} style={{ color: "#a09880", display: "block" }}>{line}</Text>
              )) : <Text style={{ color: "#6b6355", display: "block" }}>无</Text>}
            </div>

            <div>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>特殊效果</Text>
              {detailSpecialLines.length > 0 ? detailSpecialLines.map((line) => (
                <Text key={line} style={{ color: "#52b788", display: "block" }}>{line}</Text>
              )) : <Text style={{ color: "#6b6355", display: "block" }}>无</Text>}
            </div>

            <div>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>事件效果</Text>
              {detailEventLines.length > 0 ? detailEventLines.map((event) => (
                <div key={event.label}>
                  <Text style={{ color: "#a09880", display: "block" }}>{event.label}</Text>
                  {event.lines.map((line) => (
                    <Text key={`${event.label}-${line}`} style={{ color: "#6b6355", display: "block" }}>{line}</Text>
                  ))}
                </div>
              )) : <Text style={{ color: "#6b6355", display: "block" }}>无</Text>}
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}
