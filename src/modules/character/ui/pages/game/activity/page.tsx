"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Space, Typography, message } from "antd";
import { CalendarOutlined } from "@ant-design/icons";
import type { ActivityPageBottomContent } from "@/modules/shared/types/legacy-plugin";
import NotificationDot from "@/modules/shared/ui/components/NotificationDot";
import {
  buildSandboxedHtmlCardDocument,
  SANDBOXED_HTML_CARD_IFRAME_PROPS,
} from "@/modules/shared/ui/services/plugin-embed";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";

const { Text } = Typography;

type CdkRewardItem = {
  itemId: string;
  quantity: number;
  itemName?: string;
};

type CdkReward = {
  gold?: number;
  xp?: number;
  items?: CdkRewardItem[];
};

function buildRewardSummary(reward: CdkReward) {
  const parts: string[] = [];

  if ((reward.gold || 0) > 0) {
    parts.push(`灵石+${reward.gold}`);
  }

  if ((reward.xp || 0) > 0) {
    parts.push(`修为+${reward.xp}`);
  }

  if (Array.isArray(reward.items) && reward.items.length > 0) {
    parts.push(reward.items
      .map((item) => `${item.itemName || item.itemId}x${item.quantity}`)
      .join("、"));
  }

  return parts.join("，");
}

function resolveActivityContentType(value: unknown): "text" | "html" | "url" {
  const type = String(value || "").trim().toLowerCase();
  if (type === "html" || type === "url") {
    return type;
  }
  return "text";
}

function normalizeContentHeight(value: unknown) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 220;
  }
  return Math.max(120, Math.min(960, parsed));
}

function isEmbedUrlAllowed(value: string) {
  if (!value) {
    return false;
  }
  if (value.startsWith("/")) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function renderPluginBottomContent(item: ActivityPageBottomContent) {
  const contentType = resolveActivityContentType(item.contentType);
  const content = String(item.content || "");
  const height = normalizeContentHeight(item.height);

  if (contentType === "url") {
    const url = String(item.contentUrl || "").trim() || content.trim();
    if (!isEmbedUrlAllowed(url)) {
      return <Text style={{ color: "#6b6355" }}>插件地址无效</Text>;
    }
    return (
      <iframe
        title={item.title || item.id}
        src={url}
        loading="lazy"
        style={{
          width: "100%",
          height,
          border: "none",
          borderRadius: 8,
          background: "#fff",
        }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
    );
  }

  if (contentType === "html") {
    if (!content.trim()) {
      return <Text style={{ color: "#6b6355" }}>暂无内容</Text>;
    }
    return (
      <iframe
        title={item.title || item.id}
        srcDoc={buildSandboxedHtmlCardDocument(content)}
        loading="lazy"
        {...SANDBOXED_HTML_CARD_IFRAME_PROPS}
        style={{
          width: "100%",
          height,
          border: "none",
          borderRadius: 8,
          background: "rgba(10, 12, 20, 0.92)",
        }}
      />
    );
  }

  return (
    <Text style={{ color: "#a09880", whiteSpace: "pre-wrap" }}>
      {content || "暂无内容"}
    </Text>
  );
}

export default function ActivityPage() {
  const router = useRouter();
  const { activityHasNotification } = useGameNotifications();
  const [cdkCode, setCdkCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const activityPluginBottomContents: ActivityPageBottomContent[] = [];
  const [messageApi, contextHolder] = message.useMessage();

  const handleRedeem = async () => {
    const code = cdkCode.trim();
    if (!code) {
      messageApi.error("请输入CDK");
      return;
    }

    try {
      setRedeeming(true);
      const res = await fetch("/api/game/cdk/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: { reward?: CdkReward };
      };

      if (!json.success) {
        messageApi.error(json.error || "兑换失败");
        return;
      }

      const summary = buildRewardSummary(json.data?.reward || {});
      messageApi.success(summary ? `兑换成功：${summary}` : "兑换成功");
      setCdkCode("");
    } catch {
      messageApi.error("兑换失败");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div
      style={{
        padding: "10px 8px 16px",
        maxWidth: 480,
        margin: "0 auto",
        background: "radial-gradient(120% 95% at 50% -15%, rgba(201,168,76,0.16), rgba(16,16,18,0.04) 42%), linear-gradient(180deg, #121216 0%, #0d0d0f 100%)",
      }}
    >
      {contextHolder}

      <Card
        size="small"
        style={{
          marginBottom: 8,
          background: "rgba(26, 26, 46, 0.9)",
          border: "none",
          boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
        }}
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", paddingRight: activityHasNotification ? 10 : 0 }}>
                <CalendarOutlined />
                <span style={{ marginLeft: 4 }}>每日签到</span>
                {activityHasNotification && <NotificationDot style={{ top: -1, right: 0 }} />}
              </span>
            </Text>
            <Button size="small" onClick={() => router.push("/game/activity/checkin")}>前往</Button>
          </div>
        </Space>
      </Card>

      <Card
        size="small"
        style={{
          marginBottom: 8,
          background: "rgba(26, 26, 46, 0.9)",
          border: "none",
          boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
        }}
      >
        <Text style={{ color: "#e8e0d0", fontWeight: 600, display: "block", marginBottom: 8 }}>
          CDK 兑换
        </Text>

        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={cdkCode}
            maxLength={64}
            placeholder="输入CDK兑换码"
            onChange={(e) => setCdkCode(e.target.value.toUpperCase())}
            onPressEnter={() => { void handleRedeem(); }}
          />
          <Button type="primary" loading={redeeming} onClick={() => { void handleRedeem(); }}>
            兑换
          </Button>
        </Space.Compact>

        <Text style={{ color: "#6b6355", fontSize: 11, display: "block", marginTop: 6 }}>
          兑换结果会即时发放到角色。
        </Text>
      </Card>

      {activityPluginBottomContents.map((item) => (
        <Card
          key={`${item.pluginId}:${item.id}`}
          size="small"
          style={{
            marginBottom: 8,
            background: "rgba(12, 14, 24, 0.92)",
            border: "none",
            boxShadow: "0 8px 18px rgba(0,0,0,0.28)",
          }}
        >
          {(item.title || item.subtitle) && (
            <div style={{ marginBottom: 8 }}>
              {item.title && (
                <Text style={{ color: "#e8e0d0", fontWeight: 600, display: "block" }}>
                  {item.title}
                </Text>
              )}
              {item.subtitle && (
                <Text style={{ color: "#6b6355", fontSize: 12 }}>
                  {item.subtitle}
                </Text>
              )}
            </div>
          )}
          {renderPluginBottomContent(item)}
        </Card>
      ))}
    </div>
  );
}
