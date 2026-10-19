"use client";

import { useEffect } from "react";
import { Button, Space, Typography } from "antd";
import { HomeOutlined, ReloadOutlined } from "@ant-design/icons";

const { Paragraph, Text, Title } = Typography;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#060913" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 16px",
            background: "radial-gradient(circle at top, rgba(39, 57, 102, 0.92) 0%, #0a1120 60%, #05070f 100%)",
          }}
        >
          <div
            style={{
              width: "min(100%, 420px)",
              padding: "22px 18px",
              borderRadius: 18,
              border: "1px solid rgba(92, 113, 170, 0.38)",
              background: "linear-gradient(180deg, rgba(15, 23, 43, 0.96) 0%, rgba(8, 13, 26, 0.98) 100%)",
              boxShadow: "0 18px 42px rgba(0, 0, 0, 0.32)",
            }}
          >
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Text style={{ color: "#8ea6dc", fontSize: 12 }}>全局异常提示</Text>
                <Title level={4} style={{ margin: 0, color: "#f5f7ff" }}>
                  页面出了点岔子
                </Title>
                <Paragraph
                  style={{
                    margin: 0,
                    color: "#c6d1f0",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {error.message || "系统处理当前请求时中断了，你可以先重试，或回到游戏主页继续。"}
                </Paragraph>
              </div>

              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Button type="primary" icon={<ReloadOutlined />} block onClick={reset} style={{ height: 42, borderRadius: 12 }}>
                  重试
                </Button>
                <Button icon={<HomeOutlined />} block href="/game/map" style={{ height: 42, borderRadius: 12 }}>
                  返回地图
                </Button>
              </Space>
            </Space>
          </div>
        </div>
      </body>
    </html>
  );
}
