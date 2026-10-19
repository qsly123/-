"use client";

import { Suspense, useEffect, useState } from "react";
import { Button, Input, Form, Typography, message, Space } from "antd";
import { LockOutlined, LinkOutlined, MailOutlined } from "@ant-design/icons";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const { Title, Text } = Typography;

type AuthOptionsResponse = {
  success: boolean;
  data?: {
    linuxDoLoginEnabled?: boolean;
    gameTitle?: string;
    gameSubtitle?: string;
  };
};

const DEFAULT_GAME_TITLE = "灵虚·长生录";
const DEFAULT_GAME_SUBTITLE = "踏上修仙之路，问鼎长生大道";

function getRedirectTarget(rawNext: string | null): string | null {
  if (!rawNext) return null;
  if (!rawNext.startsWith("/")) return null;
  if (rawNext.startsWith("//")) return null;
  return rawNext;
}

function navigateWithDocumentRequest(target: string) {
  if (typeof window !== "undefined") {
    window.location.assign(target);
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const [loginLoading, setLoginLoading] = useState(false);
  const [linuxDoLoginEnabled, setLinuxDoLoginEnabled] = useState(false);
  const [gameTitle, setGameTitle] = useState(DEFAULT_GAME_TITLE);
  const [gameSubtitle, setGameSubtitle] = useState(DEFAULT_GAME_SUBTITLE);
  const searchParams = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();
  const next = getRedirectTarget(searchParams.get("next"));
  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";
  const bindEmailHref = next ? `/bind-email?next=${encodeURIComponent(next)}` : "/bind-email";

  useEffect(() => {
    let canceled = false;

    const fetchAuthOptions = async () => {
      try {
        const res = await fetch("/api/auth/options", { cache: "no-store" });
        const data = await res.json() as AuthOptionsResponse;
        if (!canceled && data.success) {
          setLinuxDoLoginEnabled(Boolean(data.data?.linuxDoLoginEnabled));
          setGameTitle((data.data?.gameTitle || DEFAULT_GAME_TITLE).trim() || DEFAULT_GAME_TITLE);
          setGameSubtitle((data.data?.gameSubtitle || DEFAULT_GAME_SUBTITLE).trim() || DEFAULT_GAME_SUBTITLE);
        }
      } catch {
        if (!canceled) {
          setLinuxDoLoginEnabled(false);
          setGameTitle(DEFAULT_GAME_TITLE);
          setGameSubtitle(DEFAULT_GAME_SUBTITLE);
        }
      }
    };

    void fetchAuthOptions();
    return () => {
      canceled = true;
    };
  }, []);

  async function onFinish(values: { email: string; password: string }) {
    setLoginLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success("登录成功");
        navigateWithDocumentRequest(next || "/");
      } else {
        messageApi.error(data.error || "登录失败");
      }
    } catch {
      messageApi.error("网络错误");
    } finally {
      setLoginLoading(false);
    }
  }

  function onLinuxDoLogin() {
    if (!linuxDoLoginEnabled) {
      messageApi.error("Linux.do 登录未开启");
      return;
    }
    window.location.href = next ? `/api/auth/linuxdo?next=${encodeURIComponent(next)}` : "/api/auth/linuxdo";
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      background: "linear-gradient(180deg, #0d0d0f 0%, #1a1a2e 50%, #16213e 100%)",
    }}>
      {contextHolder}
      <div style={{
        width: "100%",
        maxWidth: 360,
        padding: "32px 24px",
        background: "rgba(26, 26, 46, 0.9)",
        border: "1px solid #2a2520",
        borderRadius: 8,
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Title level={2} style={{ color: "#c9a84c", marginBottom: 4, fontWeight: 400 }}>
            {gameTitle}
          </Title>
          <Text style={{ color: "#6b6355", fontSize: 13 }}>{gameSubtitle}</Text>
        </div>

        <Form onFinish={onFinish} size="large" autoComplete="off">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="邮箱" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" loading={loginLoading} block>
              登入仙门
            </Button>
          </Form.Item>
          {linuxDoLoginEnabled && (
            <Form.Item style={{ marginBottom: 12 }}>
              <Button icon={<LinkOutlined />} onClick={onLinuxDoLogin} block>
                使用 Linux.do 登录
              </Button>
            </Form.Item>
          )}
        </Form>

        <div style={{ textAlign: "center" }}>
          <Space orientation="vertical" size={8}>
            <Space>
              <Text style={{ color: "#6b6355" }}>尚未入门？</Text>
              <Link href={registerHref} style={{ color: "#c9a84c" }}>注册新号</Link>
            </Space>
            <Space>
              <Text style={{ color: "#6b6355" }}>老用户迁移？</Text>
              <Link href={bindEmailHref} style={{ color: "#c9a84c" }}>绑定邮箱</Link>
            </Space>
          </Space>
        </div>
      </div>
    </div>
  );
}
