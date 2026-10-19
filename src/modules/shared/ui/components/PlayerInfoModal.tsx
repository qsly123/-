"use client";

import { useEffect, useState } from "react";
import { MessageOutlined } from "@ant-design/icons";
import { Button, Modal, Space, Spin, Typography } from "antd";
import { useRouter } from "next/navigation";
import PlayerProfileContent, {
  type PlayerProfileContentModel,
} from "@/modules/shared/ui/components/PlayerProfileContent";

const { Text } = Typography;

type PlayerInfoScope = "nearby" | "public";

type PlayerProfile = PlayerProfileContentModel & {
  gender?: string | null;
  avatarId?: string | null;
  avatarFrameId?: string | null;
};

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  data?: T;
};

interface PlayerInfoModalProps {
  open: boolean;
  playerId: string | null;
  onClose: () => void;
  scope?: PlayerInfoScope;
  onPrivateChat?: (playerId: string, playerName: string) => void;
}

export default function PlayerInfoModal({
  open,
  playerId,
  onClose,
  scope = "public",
  onPrivateChat,
}: PlayerInfoModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);

  const handleOpenPrivateChat = () => {
    if (!profile?.id) {
      return;
    }

    onClose();
    if (onPrivateChat) {
      onPrivateChat(profile.id, profile.name);
      return;
    }

    router.push(`/game/chat?tab=dm&targetPlayerId=${encodeURIComponent(profile.id)}`);
  };

  useEffect(() => {
    if (!open || !playerId) {
      return;
    }

    let cancelled = false;
    const query = scope === "public" ? "?scope=public" : "";

    const fetchProfile = async () => {
      setLoading(true);
      setErrorText("");
      setProfile(null);

      try {
        const res = await fetch(`/api/game/player/${encodeURIComponent(playerId)}${query}`, { cache: "no-store" });
        const json = await res.json() as ApiResponse<PlayerProfile>;
        if (cancelled) {
          return;
        }

        if (json.success && json.data) {
          setProfile(json.data);
          return;
        }

        setErrorText(json.error || "无法查看该玩家");
      } catch {
        if (!cancelled) {
          setErrorText("加载玩家信息失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchProfile();

    return () => {
      cancelled = true;
    };
  }, [open, playerId, scope]);

  return (
    <Modal
      title={profile ? (
        <Space size={6}>
          <span>玩家信息 · </span>
          <Text style={{ color: "#e8e0d0" }}>{profile.name}</Text>
        </Space>
      ) : "玩家信息"}
      width="min(360px, calc(100vw - 24px))"
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="关闭"
      cancelButtonProps={{ style: { display: "none" } }}
    >
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : profile ? (
        <div style={{ maxHeight: "min(60vh, 440px)", overflowY: "auto", paddingRight: 2 }}>
          <PlayerProfileContent
            profile={profile}
            showAvatar
            topActions={(
              <Button
                type="primary"
                icon={<MessageOutlined />}
                onClick={handleOpenPrivateChat}
              >
                私聊
              </Button>
            )}
          />
        </div>
      ) : (
        <Text style={{ color: "#6b6355" }}>{errorText || "暂无玩家信息"}</Text>
      )}
    </Modal>
  );
}
