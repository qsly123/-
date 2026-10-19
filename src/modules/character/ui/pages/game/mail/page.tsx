"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Space, Spin, Typography, message } from "antd";
import { ArrowLeftOutlined, MailOutlined } from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";

const { Text } = Typography;

type MailRewardItem = {
  itemId: string;
  quantity: number;
  itemName?: string;
  itemIconUrl?: string | null;
};

type MailReward = {
  gold?: number;
  xp?: number;
  items?: MailRewardItem[];
};

type MailItem = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  claimedAt: string | null;
  reward: MailReward;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function hasRewardValue(reward: MailReward) {
  return Boolean((reward.gold || 0) > 0 || (reward.xp || 0) > 0 || (reward.items?.length || 0) > 0);
}

function buildRewardSummary(reward: MailReward) {
  const parts: string[] = [];
  if ((reward.gold || 0) > 0) {
    parts.push(`灵石+${reward.gold}`);
  }
  if ((reward.xp || 0) > 0) {
    parts.push(`修为+${reward.xp}`);
  }
  if (reward.items?.length) {
    parts.push(reward.items.map((item) => `${item.itemName || item.itemId}x${item.quantity}`).join("、"));
  }
  return parts.join("，");
}

function renderRewardContent(reward: MailReward) {
  const items = reward.items || [];
  return (
    <Space size={[8, 4]} wrap>
      {(reward.gold || 0) > 0 && <Text style={{ color: "#c9a84c", fontSize: 12 }}>灵石+{reward.gold}</Text>}
      {(reward.xp || 0) > 0 && <Text style={{ color: "#c9a84c", fontSize: 12 }}>修为+{reward.xp}</Text>}
      {items.map((item) => (
        <ItemBadge
          key={`${item.itemId}-${item.quantity}`}
          name={item.itemName || item.itemId}
          iconUrl={item.itemIconUrl}
          quantity={item.quantity}
          iconSize={12}
        />
      ))}
    </Space>
  );
}

export default function MailPage() {
  const router = useRouter();
  const { refreshNotifications } = useGameNotifications();
  const [list, setList] = useState<MailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchMails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/game/mail/list", { cache: "no-store" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { mails: MailItem[] };
      };

      if (!json.success) {
        messageApi.error(json.error || "加载邮件失败");
        return;
      }

      setList(json.data?.mails || []);
    } catch {
      messageApi.error("加载邮件失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchMails();
  }, [fetchMails]);

  const unreadCount = useMemo(() => list.filter((mail) => !mail.claimedAt).length, [list]);

  const handleClaim = async (mailId: number) => {
    setClaimingId(mailId);
    try {
      const res = await fetch("/api/game/mail/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailId }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: {
          reward: {
            gold: number;
            xp: number;
            items: MailRewardItem[];
          };
        };
      };

      if (!json.success) {
        messageApi.error(json.error || "领取失败");
        return;
      }

      const reward: MailReward = json.data?.reward || {};
      const summary = buildRewardSummary(reward);
      messageApi.success(summary ? `领取成功：${summary}` : "已标记已读");
      await fetchMails();
      await refreshNotifications();
    } catch {
      messageApi.error("领取失败");
    } finally {
      setClaimingId(null);
    }
  };

  const handleDelete = async (mailId: number) => {
    setDeletingId(mailId);
    try {
      const res = await fetch("/api/game/mail/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailId }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (!json.success) {
        messageApi.error(json.error || "删除失败");
        return;
      }

      messageApi.success("删除成功");
      await fetchMails();
      await refreshNotifications();
    } catch {
      messageApi.error("删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>;
  }

  return (
    <div style={{ padding: "8px" }}>
      {contextHolder}
      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/character")}>
          返回角色
        </Button>
      </div>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
        padding: "4px 8px",
        background: "rgba(26, 26, 46, 0.8)",
        borderRadius: 4,
        border: "1px solid #2a2520",
      }}>
        <Space size={6}>
          <MailOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#a09880" }}>邮件</Text>
          <DarkTag color={unreadCount > 0 ? "gold" : "default"}>未读 {unreadCount}</DarkTag>
        </Space>
        <Button size="small" onClick={() => void fetchMails()}>刷新</Button>
      </div>

      {list.length === 0 && (
        <Empty description={<Text style={{ color: "#6b6355" }}>暂无邮件</Text>} />
      )}

      {list.map((mail) => {
        const hasReward = hasRewardValue(mail.reward || {});
        const claimed = !!mail.claimedAt;

        return (
          <Card
            key={mail.id}
            size="small"
            style={{
              marginBottom: 6,
              background: "rgba(26, 26, 46, 0.9)",
              border: `1px solid ${claimed ? "#2f6b45" : "#2a2520"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>{mail.title}</Text>
              <DarkTag color={claimed ? "green" : "blue"}>{claimed ? "已领取" : (hasReward ? "可领取" : "未读")}</DarkTag>
            </div>

            {mail.content && (
              <Text style={{ color: "#a09880", display: "block", marginTop: 6, whiteSpace: "pre-wrap" }}>
                {mail.content}
              </Text>
            )}

            <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 6 }}>
              发送时间：{formatTime(mail.createdAt)}
            </Text>

            {hasReward && (
              <div style={{ marginTop: 4 }}>
                <Text style={{ color: "#c9a84c", fontSize: 12, display: "block", marginBottom: 2 }}>
                  附件：
                </Text>
                {renderRewardContent(mail.reward)}
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <Space size={8}>
                <Button
                  size="small"
                  type={claimed ? "default" : "primary"}
                  disabled={claimed}
                  loading={claimingId === mail.id}
                  onClick={() => void handleClaim(mail.id)}
                >
                  {claimed ? "已领取" : (hasReward ? "领取奖励" : "标记已读")}
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={!claimed}
                  loading={deletingId === mail.id}
                  onClick={() => void handleDelete(mail.id)}
                >
                  删除
                </Button>
              </Space>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
