"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Space, Spin, Typography, message } from "antd";
import { ArrowLeftOutlined, CalendarOutlined } from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";

const { Text, Title } = Typography;
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

type RewardItem = {
  itemId: string;
  quantity: number;
  itemName?: string;
  itemIconUrl?: string | null;
};

type RewardData = {
  gold?: number;
  xp?: number;
  items?: RewardItem[];
};

type CheckinDayData = {
  date: string;
  day: number;
  dayIndex: number;
  weekdayLabel: string;
  claimed: boolean;
  canClaim: boolean;
  isToday: boolean;
  isFuture: boolean;
  status: "claimed" | "claimable" | "future" | "missed";
  rewardEnabled: boolean;
  reward: RewardData;
};

type CheckinListResponse = {
  success: boolean;
  error?: string;
  data?: {
    month: string;
    today: string;
    canClaimToday: boolean;
    days: CheckinDayData[];
  };
};

type CheckinClaimResponse = {
  success: boolean;
  error?: string;
  data?: {
    checkinDate: string;
    dayIndex: number;
    reward: {
      gold: number;
      xp: number;
      items: RewardItem[];
    };
  };
};

function buildRewardSummary(reward: RewardData) {
  const parts: string[] = [];
  if ((reward.gold || 0) > 0) {
    parts.push(`灵石+${reward.gold}`);
  }
  if ((reward.xp || 0) > 0) {
    parts.push(`修为+${reward.xp}`);
  }
  if (reward.items?.length) {
    parts.push(reward.items.map((item) => `${item.itemName || "未知物品"}x${item.quantity}`).join("、"));
  }
  return parts.join("，");
}

function renderRewardContent(reward: RewardData) {
  const items = reward.items || [];
  if ((reward.gold || 0) <= 0 && (reward.xp || 0) <= 0 && items.length === 0) {
    return <Text style={{ color: "#a09880", display: "block" }}>无奖励</Text>;
  }

  return (
    <Space size={[8, 4]} wrap>
      {(reward.gold || 0) > 0 && <Text style={{ color: "#a09880" }}>灵石+{reward.gold}</Text>}
      {(reward.xp || 0) > 0 && <Text style={{ color: "#a09880" }}>修为+{reward.xp}</Text>}
      {items.map((item) => (
        <ItemBadge
          key={`${item.itemId}-${item.quantity}`}
          name={item.itemName || "未知物品"}
          iconUrl={item.itemIconUrl}
          quantity={item.quantity}
          iconSize={12}
        />
      ))}
    </Space>
  );
}

function shiftMonth(monthKey: string, delta: number) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return monthKey;
  }

  const target = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextYear = target.getUTCFullYear();
  const nextMonth = target.getUTCMonth() + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function formatMonthTitle(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year}年${month}月`;
}

function getMonthLeadingEmptyCount(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return 0;
  }

  const weekDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 周日=0
  return weekDay === 0 ? 6 : weekDay - 1; // 周一=0
}

function getStatusText(day: CheckinDayData) {
  if (day.claimed) {
    return "已签";
  }
  if (day.canClaim) {
    return "可签";
  }
  if (day.isFuture) {
    return "未到";
  }
  return "漏签";
}

function getStatusColor(day: CheckinDayData) {
  if (day.claimed) {
    return "#52b788";
  }
  if (day.canClaim) {
    return "#c9a84c";
  }
  if (day.isFuture) {
    return "#6b6355";
  }
  return "#d4545d";
}

function getCellStyle(day: CheckinDayData | null, selected = false): CSSProperties {
  if (!day) {
    return {
      minHeight: 72,
      border: "1px solid transparent",
      borderRadius: 6,
      background: "transparent",
    };
  }

  if (day.status === "claimed") {
    return {
      minHeight: 72,
      border: `1px solid ${selected ? "#7fd0a0" : "#2f6b45"}`,
      borderRadius: 6,
      background: selected ? "rgba(35, 66, 47, 0.55)" : "rgba(35, 66, 47, 0.35)",
      padding: 6,
    };
  }

  if (day.status === "claimable") {
    return {
      minHeight: 72,
      border: `1px solid ${selected ? "#f1d78c" : "#c9a84c"}`,
      borderRadius: 6,
      background: selected ? "rgba(56, 44, 21, 0.62)" : "rgba(56, 44, 21, 0.42)",
      padding: 6,
    };
  }

  if (day.status === "future") {
    return {
      minHeight: 72,
      border: `1px solid ${selected ? "#5b5347" : "#2a2520"}`,
      borderRadius: 6,
      background: selected ? "rgba(32, 32, 56, 0.7)" : "rgba(26, 26, 46, 0.55)",
      padding: 6,
      opacity: 0.75,
    };
  }

  return {
    minHeight: 72,
    border: `1px solid ${selected ? "#9c6c6c" : "#2a2520"}`,
    borderRadius: 6,
    background: selected ? "rgba(52, 32, 40, 0.7)" : "rgba(26, 26, 46, 0.5)",
    padding: 6,
  };
}

export default function CheckinPage() {
  const router = useRouter();
  const { refreshNotifications } = useGameNotifications();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [monthKey, setMonthKey] = useState("");
  const [todayKey, setTodayKey] = useState("");
  const [selectedDateKey, setSelectedDateKey] = useState("");
  const [days, setDays] = useState<CheckinDayData[]>([]);

  const fetchCheckin = useCallback(async (targetMonth?: string) => {
    setLoading(true);
    try {
      const query = targetMonth ? `?month=${encodeURIComponent(targetMonth)}` : "";
      const response = await fetch(`/api/game/checkin${query}`, { cache: "no-store" });
      const result = await response.json() as CheckinListResponse;
      if (!result.success || !result.data) {
        messageApi.error(result.error || "加载签到信息失败");
        return;
      }

      setMonthKey(result.data.month);
      setTodayKey(result.data.today);
      setDays(result.data.days || []);
    } catch {
      messageApi.error("加载签到信息失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchCheckin();
  }, [fetchCheckin]);

  const todayRecord = useMemo(
    () => days.find((item) => item.date === todayKey) || null,
    [days, todayKey]
  );

  useEffect(() => {
    if (!days.length) {
      setSelectedDateKey("");
      return;
    }

    if (selectedDateKey && days.some((item) => item.date === selectedDateKey)) {
      return;
    }

    const target = days.find((item) => item.date === todayKey) || days[0];
    setSelectedDateKey(target?.date || "");
  }, [days, todayKey, selectedDateKey]);

  const selectedRecord = useMemo(
    () => days.find((item) => item.date === selectedDateKey) || null,
    [days, selectedDateKey]
  );

  const calendarCells = useMemo(() => {
    if (!monthKey || !days.length) {
      return [] as Array<CheckinDayData | null>;
    }

    const dayMap = new Map<number, CheckinDayData>(days.map((day) => [day.day, day]));
    const leadingEmpty = getMonthLeadingEmptyCount(monthKey);
    const cells: Array<CheckinDayData | null> = Array.from({ length: leadingEmpty }, () => null);

    for (let day = 1; day <= days.length; day += 1) {
      cells.push(dayMap.get(day) || null);
    }

    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    return cells;
  }, [days, monthKey]);

  const handleClaim = async () => {
    if (!todayRecord?.canClaim) {
      return;
    }

    setClaiming(true);
    try {
      const response = await fetch("/api/game/checkin", {
        method: "POST",
      });
      const result = await response.json() as CheckinClaimResponse;
      if (!result.success) {
        messageApi.error(result.error || "签到失败");
        return;
      }

      const summary = buildRewardSummary(result.data?.reward || {});
      messageApi.success(summary ? `签到成功：${summary}` : "签到成功");
      await fetchCheckin(monthKey);
      await refreshNotifications();
    } catch {
      messageApi.error("签到失败");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div style={{ padding: "8px", maxWidth: 480, margin: "0 auto" }}>
      {contextHolder}

      <Card
        size="small"
        style={{
          marginBottom: 8,
          background: "rgba(26, 26, 46, 0.9)",
          border: "1px solid #2a2520",
        }}
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space size={6}>
              <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/activity")}>
                返回活动
              </Button>
              <Title level={5} style={{ margin: 0, color: "#c9a84c" }}>
                <CalendarOutlined /> 每日签到
              </Title>
            </Space>
            <DarkTag color={todayRecord?.claimed ? "green" : todayRecord?.canClaim ? "gold" : "default"}>
              {todayRecord?.claimed ? "今日已签" : todayRecord?.canClaim ? "今日可签" : "今日不可签"}
            </DarkTag>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space size={8}>
              <Button size="small" onClick={() => void fetchCheckin(shiftMonth(monthKey, -1))} disabled={!monthKey || loading}>
                上个月
              </Button>
              <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>{monthKey ? formatMonthTitle(monthKey) : "-"}</Text>
              <Button size="small" onClick={() => void fetchCheckin(shiftMonth(monthKey, 1))} disabled={!monthKey || loading}>
                下个月
              </Button>
            </Space>
            <Button
              type="primary"
              size="small"
              loading={claiming}
              disabled={!todayRecord?.canClaim}
              onClick={() => void handleClaim()}
            >
              今日签到
            </Button>
          </div>

        </Space>
      </Card>

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
          <Spin />
        </div>
      )}

      {!loading && (
        <Card
          size="small"
          style={{
            background: "rgba(26, 26, 46, 0.9)",
            border: "1px solid #2a2520",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginBottom: 6 }}>
            {WEEKDAY_LABELS.map((label) => (
              <Text key={label} style={{ color: "#6b6355", textAlign: "center", fontSize: 11 }}>
                {label}
              </Text>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
            {calendarCells.map((day, index) => (
              day ? (
                <button
                  key={`${monthKey}-cell-${index}`}
                  type="button"
                  onClick={() => setSelectedDateKey(day.date)}
                  style={{
                    ...getCellStyle(day, selectedDateKey === day.date),
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    fontFamily: "inherit",
                  }}
                >
                  <Text style={{ color: day.isToday ? "#c9a84c" : "#e8e0d0", fontSize: 12, fontWeight: 600 }}>
                    {day.day}
                  </Text>
                  <Text style={{ color: getStatusColor(day), fontSize: 11 }}>
                    {getStatusText(day)}
                  </Text>
                </button>
              ) : (
                <div key={`${monthKey}-cell-${index}`} style={getCellStyle(null)} />
              )
            ))}
          </div>

          {selectedRecord && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2520" }}>
              <Text style={{ color: "#e8e0d0", fontWeight: 600, display: "block", marginBottom: 4 }}>
                {selectedRecord.date}（{selectedRecord.weekdayLabel}）
              </Text>
              <Text style={{ color: getStatusColor(selectedRecord), display: "block", marginBottom: 4 }}>
                状态：{getStatusText(selectedRecord)}
              </Text>
              <div style={{ wordBreak: "break-word" }}>
                <Text style={{ color: "#a09880", display: "block", marginBottom: 2 }}>奖励：</Text>
                {renderRewardContent(selectedRecord.reward)}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
