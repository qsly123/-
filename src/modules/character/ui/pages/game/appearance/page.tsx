"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftOutlined, CheckCircleOutlined, LockOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Space, Spin, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import GameImage from "@/modules/shared/ui/components/GameImage";

const { Text, Title } = Typography;

type AvatarItem = {
  id: string;
  name: string;
  imageUrl: string;
  gender: "男" | "女";
  isPublic: boolean;
  isUnlocked: boolean;
  sortOrder: number;
};

type AvatarFrameItem = {
  id: string;
  name: string;
  imageUrl: string;
  isPublic: boolean;
  isUnlocked: boolean;
  sortOrder: number;
};

type CosmeticsResponse = {
  success: boolean;
  error?: string;
  data?: {
    selectedAvatarId: string | null;
    selectedAvatarFrameId: string | null;
    avatars: AvatarItem[];
    avatarFrames: AvatarFrameItem[];
  };
};

function CosmeticPreview({
  avatarUrl,
  avatarFrameUrl,
}: {
  avatarUrl?: string | null;
  avatarFrameUrl?: string | null;
}) {
  return (
    <div
      style={{
        width: 96,
        height: 96,
        position: "relative",
        borderRadius: 12,
        border: "1px solid #2a2520",
        overflow: "hidden",
        background: "rgba(26, 26, 46, 0.9)",
      }}
    >
      {avatarUrl ? (
        <GameImage
          src={avatarUrl}
          alt=""
          fill
          sizes="96px"
          style={{ objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#6b6355", fontSize: 12 }}>
          未设置头像
        </div>
      )}
      {avatarFrameUrl && (
        <GameImage
          src={avatarFrameUrl}
          alt=""
          fill
          sizes="96px"
          style={{
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

function CosmeticCard({
  title,
  imageUrl,
  selected,
  locked,
  onSelect,
  loading,
}: {
  title: string;
  imageUrl: string;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  loading?: boolean;
}) {
  return (
    <Card
      size="small"
      hoverable={!locked}
      onClick={() => {
        if (!locked && !loading) {
          onSelect();
        }
      }}
      style={{
        width: "100%",
        opacity: locked ? 0.6 : 1,
        cursor: locked ? "not-allowed" : "pointer",
        background: selected ? "rgba(201, 168, 76, 0.14)" : "rgba(26, 26, 46, 0.9)",
        border: selected ? "1px solid #6b5a2f" : "1px solid #2a2520",
      }}
      bodyStyle={{ padding: 10 }}
    >
      <div style={{ position: "relative", width: "100%", paddingBottom: "100%", marginBottom: 8 }}>
        <GameImage
          src={imageUrl}
          alt={title}
          fill
          sizes="(max-width: 560px) 30vw, 160px"
          style={{
            objectFit: "cover",
            borderRadius: 8,
            border: "1px solid #2a2520",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ color: "#e8e0d0", fontSize: 12 }} ellipsis={{ tooltip: title }}>{title}</Text>
        {locked ? (
          <LockOutlined style={{ color: "#d4545d", fontSize: 12 }} />
        ) : selected ? (
          <CheckCircleOutlined style={{ color: "#52b788", fontSize: 12 }} />
        ) : (
          <SaveOutlined style={{ color: "#6b6355", fontSize: 12 }} />
        )}
      </div>
    </Card>
  );
}

export default function AppearancePage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [savingAvatarId, setSavingAvatarId] = useState<string | null>(null);
  const [savingAvatarFrameId, setSavingAvatarFrameId] = useState<string | null>(null);
  const [data, setData] = useState<{
    selectedAvatarId: string | null;
    selectedAvatarFrameId: string | null;
    avatars: AvatarItem[];
    avatarFrames: AvatarFrameItem[];
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/game/cosmetics", { cache: "no-store" });
      const json = await res.json() as CosmeticsResponse;
      if (!json.success || !json.data) {
        messageApi.error(json.error || "加载装扮失败");
        setData(null);
        return;
      }
      setData(json.data);
    } catch {
      messageApi.error("加载装扮失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const selectedAvatar = useMemo(
    () => data?.avatars.find((item) => item.id === data.selectedAvatarId) || null,
    [data],
  );
  const selectedAvatarFrame = useMemo(
    () => data?.avatarFrames.find((item) => item.id === data.selectedAvatarFrameId) || null,
    [data],
  );
  const unlockedAvatars = useMemo(
    () => data?.avatars.filter((item) => item.isUnlocked) || [],
    [data],
  );
  const unlockedAvatarFrames = useMemo(
    () => data?.avatarFrames.filter((item) => item.isUnlocked) || [],
    [data],
  );

  const handleSelectAvatar = async (avatarId: string | null) => {
    setSavingAvatarId(avatarId || "__clear__");
    try {
      const res = await fetch("/api/game/cosmetics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        messageApi.error(json.error || "设置头像失败");
        return;
      }
      messageApi.success("头像已更新");
      await fetchData();
    } catch {
      messageApi.error("设置头像失败");
    } finally {
      setSavingAvatarId(null);
    }
  };

  const handleSelectAvatarFrame = async (avatarFrameId: string | null) => {
    setSavingAvatarFrameId(avatarFrameId || "__clear__");
    try {
      const res = await fetch("/api/game/cosmetics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarFrameId }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        messageApi.error(json.error || "设置头像框失败");
        return;
      }
      messageApi.success("头像框已更新");
      await fetchData();
    } catch {
      messageApi.error("设置头像框失败");
    } finally {
      setSavingAvatarFrameId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ padding: 8, maxWidth: 560, margin: "0 auto" }}>
      {contextHolder}
      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/character")}>
          返回角色
        </Button>
      </div>

      <Card
        size="small"
        style={{ marginBottom: 8, background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}
      >
        <Space size={12} align="center">
          <CosmeticPreview avatarUrl={selectedAvatar?.imageUrl} avatarFrameUrl={selectedAvatarFrame?.imageUrl} />
          <div>
            <Title level={5} style={{ margin: 0, color: "#c9a84c" }}>角色装扮</Title>
            <Text style={{ color: "#a09880", display: "block" }}>
              头像：{selectedAvatar?.name || "未设置"}
            </Text>
            <Text style={{ color: "#a09880", display: "block" }}>
              头像框：{selectedAvatarFrame?.name || "未设置"}
            </Text>
          </div>
        </Space>
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#c9a84c" }}>头像</Text>}
        style={{ marginBottom: 8, background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}
      >
        {!data || unlockedAvatars.length === 0 ? (
          <Empty description={<Text style={{ color: "#6b6355" }}>暂无可用头像</Text>} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {unlockedAvatars.map((item) => (
              <CosmeticCard
                key={item.id}
                title={item.name}
                imageUrl={item.imageUrl}
                locked={!item.isUnlocked}
                selected={data.selectedAvatarId === item.id}
                loading={savingAvatarId === item.id}
                onSelect={() => {
                  void handleSelectAvatar(item.id);
                }}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        size="small"
        title={<Text style={{ color: "#c9a84c" }}>头像框</Text>}
        extra={
          <Button
            size="small"
            loading={savingAvatarFrameId === "__clear__"}
            onClick={() => {
              void handleSelectAvatarFrame(null);
            }}
          >
            清空头像框
          </Button>
        }
        style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}
      >
        {!data || unlockedAvatarFrames.length === 0 ? (
          <Empty description={<Text style={{ color: "#6b6355" }}>暂无可用头像框</Text>} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {unlockedAvatarFrames.map((item) => (
              <CosmeticCard
                key={item.id}
                title={item.name}
                imageUrl={item.imageUrl}
                locked={!item.isUnlocked}
                selected={data.selectedAvatarFrameId === item.id}
                loading={savingAvatarFrameId === item.id}
                onSelect={() => {
                  void handleSelectAvatarFrame(item.id);
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
