"use client";

import { Typography } from "antd";
import type { PlayerProfileAction } from "@/modules/shared/types/legacy-plugin";
import {
  buildSandboxedHtmlCardDocument,
  SANDBOXED_HTML_INTERACTIVE_IFRAME_PROPS,
} from "@/modules/shared/ui/services/plugin-embed";

const { Text } = Typography;

const DEFAULT_WEB_MODAL_WIDTH = 760;
const DEFAULT_WEB_HEIGHT = 360;

function normalizePositiveInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(min, Math.min(max, parsed));
}

function resolveContentType(action: PlayerProfileAction): "text" | "html" | "url" {
  const type = String(action.contentType || "").trim().toLowerCase();
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

function resolveEmbedUrl(action: PlayerProfileAction): string {
  const fromField = String(action.contentUrl || "").trim();
  if (isEmbedUrlAllowed(fromField)) {
    return fromField;
  }
  const fromContent = String(action.content || "").trim();
  if (isEmbedUrlAllowed(fromContent)) {
    return fromContent;
  }
  return "";
}

export function resolvePlayerProfileActionModalWidth(action: PlayerProfileAction): number | undefined {
  const customWidth = normalizePositiveInteger(action.modalWidth, 360, 1280);
  if (customWidth) {
    return customWidth;
  }
  const type = resolveContentType(action);
  if (type === "text") {
    return undefined;
  }
  return DEFAULT_WEB_MODAL_WIDTH;
}

export default function PlayerProfileActionModalContent({ action }: { action: PlayerProfileAction }) {
  const type = resolveContentType(action);
  const content = String(action.content || "");
  const embedTitle = action.title || action.label || action.id;
  const frameHeight = normalizePositiveInteger(action.modalHeight, 180, 960) || DEFAULT_WEB_HEIGHT;

  if (type === "url") {
    const url = resolveEmbedUrl(action);
    if (!url) {
      return <Text style={{ color: "#6b6355" }}>插件内容地址无效</Text>;
    }
    return (
      <iframe
        title={embedTitle}
        src={url}
        loading="lazy"
        style={{
          width: "100%",
          height: frameHeight,
          border: "none",
          borderRadius: 8,
          background: "#fff",
        }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
    );
  }

  if (type === "html") {
    if (!content.trim()) {
      return <Text style={{ color: "#6b6355" }}>暂无内容</Text>;
    }
    return (
      <iframe
        title={embedTitle}
        srcDoc={buildSandboxedHtmlCardDocument(content)}
        loading="lazy"
        style={{
          width: "100%",
          height: frameHeight,
          border: "none",
          borderRadius: 8,
          background: "#fff",
        }}
        {...SANDBOXED_HTML_INTERACTIVE_IFRAME_PROPS}
      />
    );
  }

  return (
    <Text style={{ whiteSpace: "pre-wrap", color: action.color || "#d4545d" }}>
      {content || "暂无内容"}
    </Text>
  );
}
