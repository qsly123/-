"use client";

import { useState } from "react";
import { Button, Typography } from "antd";
import type { PlayerProfileBottomContent } from "@/modules/shared/types/legacy-plugin";
import {
  buildSandboxedHtmlCardDocument,
  SANDBOXED_HTML_INTERACTIVE_IFRAME_PROPS,
} from "@/modules/shared/ui/services/plugin-embed";

const { Text } = Typography;

const DEFAULT_BOTTOM_CONTENT_HEIGHT = 220;

function normalizePositiveInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(min, Math.min(max, parsed));
}

function resolveBottomContentType(value: unknown): "text" | "html" | "url" {
  const type = String(value || "").trim().toLowerCase();
  if (type === "html" || type === "url") {
    return type;
  }
  return "text";
}

function isEmbedUrlAllowed(url: string): boolean {
  if (!url) {
    return false;
  }
  if (url.startsWith("/")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveBottomContentUrl(item: PlayerProfileBottomContent): string {
  const fromField = String(item.contentUrl || "").trim();
  if (isEmbedUrlAllowed(fromField)) {
    return fromField;
  }
  const fromContent = String(item.content || "").trim();
  if (isEmbedUrlAllowed(fromContent)) {
    return fromContent;
  }
  return "";
}

interface PlayerProfileBottomContentListProps {
  contents?: PlayerProfileBottomContent[] | null;
  defaultCollapsed?: boolean;
}

export default function PlayerProfileBottomContentList({
  contents,
  defaultCollapsed = true,
}: PlayerProfileBottomContentListProps) {
  const items = Array.isArray(contents) ? contents : [];
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  if (items.length < 1) {
    return null;
  }

  const toggleExpanded = (key: string) => {
    setExpandedMap((current) => ({
      ...current,
      [key]: !(current[key] ?? !defaultCollapsed),
    }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((item) => {
        const contentType = resolveBottomContentType(item.contentType);
        const content = String(item.content || "");
        const frameHeight = normalizePositiveInteger(item.height, 120, 960) || DEFAULT_BOTTOM_CONTENT_HEIGHT;
        const key = `${item.pluginId}:${item.id}`;
        const title = String(item.title || "").trim();
        const subtitle = String(item.subtitle || "").trim();
        const isExpanded = expandedMap[key] ?? !defaultCollapsed;
        const previewText = contentType === "text"
          ? content.replace(/\s+/g, " ").trim().slice(0, 72)
          : (subtitle || title || "点击展开查看详情");

        return (
          <div
            key={key}
            style={{
              position: "relative",
              overflow: "hidden",
              border: "1px solid rgba(214, 196, 149, 0.12)",
              borderRadius: 16,
              padding: 12,
              background: "linear-gradient(180deg, rgba(27, 21, 17, 0.94), rgba(13, 18, 28, 0.98))",
              display: "grid",
              gap: 8,
              boxShadow: "0 14px 28px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -38,
                right: -24,
                width: 110,
                height: 110,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(228, 196, 123, 0.12), transparent 68%)",
                pointerEvents: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
                {title ? (
                  <Text style={{ color: "#efe3c0", display: "block", fontWeight: 700, fontSize: 13 }}>
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text style={{ color: "#a49c8b", display: "block", fontSize: 11 }}>
                    {subtitle}
                  </Text>
                ) : null}
                {!isExpanded ? (
                  <Text style={{ color: "#8f8879", display: "block", fontSize: 11, lineHeight: 1.45 }}>
                    {previewText || "点击展开查看详情"}
                    {previewText ? "..." : ""}
                  </Text>
                ) : null}
              </div>
              <Button
                size="small"
                type="default"
                onClick={() => toggleExpanded(key)}
                style={{
                  minHeight: 32,
                  paddingInline: 12,
                  borderRadius: 999,
                  borderColor: "rgba(214, 196, 149, 0.16)",
                  background: "linear-gradient(180deg, rgba(53, 39, 24, 0.92), rgba(23, 25, 32, 0.98))",
                  color: "#ead3a0",
                  flexShrink: 0,
                  boxShadow: "0 10px 16px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                {isExpanded ? "收起" : "展开"}
              </Button>
            </div>

            {!isExpanded ? null : (
              <>
                {contentType === "url" ? (
                  (() => {
                    const url = resolveBottomContentUrl(item);
                    if (!url) {
                      return <Text style={{ color: "#6b6355" }}>资料内容链接无效</Text>;
                    }
                    return (
                      <iframe
                        title={title || item.id}
                        src={url}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: frameHeight,
                          border: "none",
                          borderRadius: 10,
                          background: "#fff",
                        }}
                        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                      />
                    );
                  })()
                ) : null}

                {contentType === "html" ? (
                  content.trim() ? (
                    <iframe
                      title={title || item.id}
                      srcDoc={buildSandboxedHtmlCardDocument(content)}
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: frameHeight,
                        border: "none",
                        borderRadius: 10,
                        background: "#fff",
                      }}
                      {...SANDBOXED_HTML_INTERACTIVE_IFRAME_PROPS}
                    />
                  ) : (
                    <Text style={{ color: "#6b6355" }}>暂无内容</Text>
                  )
                ) : null}

                {contentType === "text" ? (
                  <Text style={{ whiteSpace: "pre-wrap", color: "#b3a996", lineHeight: 1.6 }}>
                    {content.trim() || "暂无内容"}
                  </Text>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
