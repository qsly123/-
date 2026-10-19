"use client";

import type { CSSProperties } from "react";

type NotificationDotProps = {
  size?: number;
  style?: CSSProperties;
};

export default function NotificationDot({ size = 7, style }: NotificationDotProps) {
  return (
    <span
      style={{
        position: "absolute",
        top: -2,
        right: -4,
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#d4545d",
        boxShadow: "0 0 0 1px #0d0d0f",
        ...style,
      }}
    />
  );
}
