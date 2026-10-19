"use client";

import { Suspense, useEffect, useState } from "react";
import { Button, Input, Form, Typography, message, Space } from "antd";
import { MailOutlined, LockOutlined } from "@ant-design/icons";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const { Title, Text } = Typography;

type AuthOptionsResponse = {
  success: boolean;
  data?: {
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

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterPageInner />
    </Suspense>
  );
}

function RegisterPageInner() {
  const [loading, setLoading] = useState(false);
  const [gameTitle, setGameTitle] = useState(DEFAULT_GAME_TITLE);
  const [gameSubtitle, setGameSubtitle] = useState(DEFAULT_GAME_SUBTITLE);
  const searchParams = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();
  const next = getRedirectTarget(searchParams.get("next"));
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  useEffect(() => {
    let canceled = false;

    const fetchAuthOptions = async () => {
      try {
        const res = await fetch("/api/auth/options", { cache: "no-store" });
        const data = await res.json() as AuthOptionsResponse;
        if (!canceled && data.success) {
          setGameTitle((data.data?.gameTitle || DEFAULT_GAME_TITLE).trim() || DEFAULT_GAME_TITLE);
          setGameSubtitle((data.data?.gameSubtitle || DEFAULT_GAME_SUBTITLE).trim() || DEFAULT_GAME_SUBTITLE);
        }
      } catch {
        if (!canceled) {
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

  async function onFinish(values: { email: string; password: string; confirm: string }) {
    if (values.password !== values.confirm) {
      messageApi.error("两次密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email, password: values.password }),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success("注册成功");
        setTimeout(() => navigateWithDocumentRequest(next || "/"), 800);
      } else {
        messageApi.error(data.error || "注册失败");
      }
    } catch {
      messageApi.error("网络错误");
    } finally {
      setLoading(false);
    }
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
          <Form.Item name="email" rules={[
            { required: true, message: "请输入邮箱" },
            { type: "email", message: "邮箱格式不正确" },
          ]}>
            <Input prefix={<MailOutlined />} placeholder="邮箱" />
          </Form.Item>
          <Form.Item name="password" rules={[
            { required: true, message: "请输入密码" },
            { min: 6, message: "密码至少6位" },
          ]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码 (至少6位)" />
          </Form.Item>
          <Form.Item name="confirm" rules={[
            { required: true, message: "请确认密码" },
          ]}>
            <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              踏入修仙
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: "center" }}>
          <Space>
            <Text style={{ color: "#6b6355" }}>已有仙号？</Text>
            <Link href={loginHref} style={{ color: "#c9a84c" }}>直接登录</Link>
          </Space>
        </div>
      </div>
    </div>
  );
}
