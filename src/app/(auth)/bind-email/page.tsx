"use client";

import { Suspense, useState } from "react";
import { Button, Input, Form, Typography, message, Space } from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const { Title, Text } = Typography;

function getRedirectTarget(rawNext: string | null): string | null {
  if (!rawNext) return null;
  if (!rawNext.startsWith("/")) return null;
  if (rawNext.startsWith("//")) return null;
  return rawNext;
}

export default function BindEmailPage() {
  return (
    <Suspense fallback={null}>
      <BindEmailPageInner />
    </Suspense>
  );
}

function BindEmailPageInner() {
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getRedirectTarget(searchParams.get("next"));
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  async function onFinish(values: { username: string; password: string; email: string }) {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/bind-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success("绑定成功，请使用邮箱登录");
        setTimeout(() => router.push(loginHref), 800);
      } else {
        messageApi.error(data.error || "绑定失败");
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
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Title level={2} style={{ color: "#c9a84c", marginBottom: 4, fontWeight: 400 }}>
            老用户迁移
          </Title>
          <Text style={{ color: "#6b6355", fontSize: 13 }}>
            使用旧用户名与密码绑定邮箱
          </Text>
        </div>

        <Form onFinish={onFinish} size="large" autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: "请输入旧用户名" }]}>
            <Input prefix={<UserOutlined />} placeholder="旧用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: "请输入旧密码" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="旧密码" />
          </Form.Item>
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "请输入绑定邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="绑定邮箱" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Button htmlType="submit" loading={loading} block>
              绑定邮箱
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: "center" }}>
          <Space>
            <Text style={{ color: "#6b6355" }}>已完成迁移？</Text>
            <Link href={loginHref} style={{ color: "#c9a84c" }}>返回登录</Link>
          </Space>
        </div>
      </div>
    </div>
  );
}
