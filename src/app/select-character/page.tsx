"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Popconfirm, Spin, Typography, Space, message } from "antd";
import { UserOutlined, PlusOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";

const { Title, Text } = Typography;

type CharacterItem = {
  id: string;
  name: string;
  realmName: string;
  updatedAt: string;
  createdAt: string;
};

type CharacterListResponse = {
  success: boolean;
  error?: string;
  data?: {
    list: CharacterItem[];
  };
};

type CharacterSelectResponse = {
  success: boolean;
  error?: string;
  maintenance?: boolean;
};

function navigateWithDocumentRequest(target: string) {
  if (typeof window !== "undefined") {
    window.location.assign(target);
  }
}

export default function SelectCharacterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [list, setList] = useState<CharacterItem[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const loginRedirectHref = "/login?next=%2Fselect-character";

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/character/list", { cache: "no-store" });
      if (res.status === 401) {
        router.replace(loginRedirectHref);
        return;
      }
      const json = await res.json() as CharacterListResponse;
      if (!json.success) {
        messageApi.error(json.error || "加载失败");
        return;
      }
      setList(json.data?.list || []);
    } catch {
      messageApi.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [loginRedirectHref, messageApi, router]);

  const selectCharacter = useCallback(async (playerId: string) => {
    if (selectingId) return;
    setSelectingId(playerId);
    try {
      const res = await fetch("/api/character/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      if (res.status === 401) {
        router.replace(loginRedirectHref);
        return;
      }
      const json = await res.json() as CharacterSelectResponse;
      if (!json.success) {
        if (json.maintenance) {
          messageApi.warning(json.error || "服务器维护中，请稍后再入世。");
          return;
        }
        messageApi.error(json.error || "选择失败");
        return;
      }
      navigateWithDocumentRequest("/game/map");
    } catch {
      messageApi.error("网络错误");
    } finally {
      setSelectingId(null);
    }
  }, [loginRedirectHref, messageApi, router, selectingId]);

  const deleteCharacter = useCallback(async (playerId: string) => {
    if (!playerId || deletingId) {
      return;
    }
    setDeletingId(playerId);
    try {
      const res = await fetch("/api/character/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      if (res.status === 401) {
        router.replace(loginRedirectHref);
        return;
      }
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        messageApi.error(json.error || "删除失败");
        return;
      }
      messageApi.success("角色已删除");
      await fetchList();
    } catch {
      messageApi.error("网络错误");
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, fetchList, loginRedirectHref, messageApi, router]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const empty = useMemo(() => !loading && list.length === 0, [loading, list.length]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "20px",
      background: "linear-gradient(180deg, #0d0d0f 0%, #1a1a2e 50%, #16213e 100%)",
    }}>
      {contextHolder}
      <div style={{ width: "100%", maxWidth: 420, paddingTop: 20 }}>
        <Title level={3} style={{ color: "#c9a84c", textAlign: "center", marginBottom: 16 }}>
          选择角色
        </Title>

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Spin />
          </div>
        )}

        {empty && (
          <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}>
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Text style={{ color: "#a09880" }}>
                该账号下还没有角色。
              </Text>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/create-character")} block>
                创建新角色
              </Button>
            </Space>
          </Card>
        )}

        {!loading && list.length > 0 && (
          <Card style={{ background: "rgba(26, 26, 46, 0.9)", border: "1px solid #2a2520" }}>
            <div>
              {list.map((item, index) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 0",
                    borderBottom: index === list.length - 1 ? "none" : "1px solid #2a2520",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <UserOutlined style={{ color: "#c9a84c", fontSize: 18 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <Text style={{ color: "#c9a84c" }}>{item.name}</Text>
                      <Text style={{ color: "#6b6355", fontSize: 12 }}>{item.realmName}</Text>
                    </div>
                  </div>

                  <Space size={6}>
                    <Button
                      type="primary"
                      size="small"
                      loading={selectingId === item.id}
                      disabled={Boolean(deletingId)}
                      onClick={() => void selectCharacter(item.id)}
                    >
                      进入
                    </Button>
                    <Popconfirm
                      title="删除角色"
                      description={`确认删除角色「${item.name}」？此操作不可恢复。`}
                      okText="确认删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true, loading: deletingId === item.id }}
                      disabled={Boolean(selectingId) || Boolean(deletingId)}
                      onConfirm={() => void deleteCharacter(item.id)}
                    >
                      <Button
                        size="small"
                        danger
                        disabled={Boolean(selectingId) || Boolean(deletingId)}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <Button icon={<PlusOutlined />} onClick={() => router.push("/create-character")} block>
                创建新角色
              </Button>
            </div>

            <div style={{ marginTop: 12 }}>
              <Button onClick={() => void fetchList()} block>
                刷新列表
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
