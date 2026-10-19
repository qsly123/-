"use client";

import { Tag } from "antd";
import type { TagProps } from "antd";

const THEME_ACCENTS: Record<string, string> = {
  gold: "#c9a84c",
  blue: "#457b9d",
  green: "#52b788",
  red: "#d4545d",

  success: "#52b788",
  error: "#d4545d",
  warning: "#e8d282",
  processing: "#457b9d",
  info: "#457b9d",

  magenta: "#eb2f96",
  volcano: "#fa541c",
  orange: "#fa8c16",
  lime: "#a0d911",
  cyan: "#13c2c2",
  geekblue: "#2f54eb",
  purple: "#722ed1",
};

function isCssColor(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("#")
    || trimmed.startsWith("rgb(")
    || trimmed.startsWith("rgba(")
    || trimmed.startsWith("hsl(")
    || trimmed.startsWith("hsla(")
  );
}

function resolveAccentColor(color: TagProps["color"]) {
  if (!color || color === "default") {
    return null;
  }

  const raw = String(color).trim();
  if (!raw || raw === "default") {
    return null;
  }

  if (isCssColor(raw)) {
    return raw;
  }

  return THEME_ACCENTS[raw] || raw;
}

export default function DarkTag({ color, style, ...props }: TagProps) {
  const accentColor = resolveAccentColor(color);

  return (
    <Tag
      {...props}
      style={{
        ...style,
        ...(accentColor ? { borderColor: accentColor, color: accentColor } : null),
      }}
    />
  );
}

