"use client";

import { Button, Space, Typography } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, CompassOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";

const { Paragraph, Text, Title } = Typography;

type GameRouteErrorCardProps = {
  title?: string;
  description?: string;
  retryLabel?: string | null;
  backLabel?: string;
  mapLabel?: string;
  onRetry?: (() => void) | null;
};

export default function GameRouteErrorCard({
  title = "此处暂时无法继续",
  description = "发生了一点意外，你可以先返回上一页，或回到地图后再继续。",
  retryLabel = "重试",
  backLabel = "返回上一页",
  mapLabel = "返回地图",
  onRetry = null,
}: GameRouteErrorCardProps) {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        background: "radial-gradient(circle at top, rgba(36, 53, 94, 0.94) 0%, #0b1120 62%, #060913 100%)",
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
            <Text style={{ color: "#8ea6dc", fontSize: 12 }}>页面异常提示</Text>
            <Title level={4} style={{ margin: 0, color: "#f5f7ff" }}>
              {title}
            </Title>
            <Paragraph
              style={{
                margin: 0,
                color: "#c6d1f0",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {description}
            </Paragraph>
          </div>

          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {onRetry && retryLabel ? (
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                block
                onClick={onRetry}
                style={{
                  height: 42,
                  borderRadius: 12,
                }}
              >
                {retryLabel}
              </Button>
            ) : null}
            <Button
              icon={<ArrowLeftOutlined />}
              block
              onClick={() => router.back()}
              style={{
                height: 42,
                borderRadius: 12,
              }}
            >
              {backLabel}
            </Button>
            <Button
              icon={<CompassOutlined />}
              block
              onClick={() => router.push("/game/map")}
              style={{
                height: 42,
                borderRadius: 12,
              }}
            >
              {mapLabel}
            </Button>
          </Space>
        </Space>
      </div>
    </div>
  );
}
