"use client";

import type { CSSProperties } from "react";
import { useResolvedAssetUrl } from "@/modules/shared/ui/hooks/useResolvedAssetUrl";

interface ItemIconProps {
  iconUrl?: string | null;
  size?: number;
  borderColor?: string;
  style?: CSSProperties;
}

export default function ItemIcon({
  iconUrl,
  size = 18,
  borderColor = "#2a2520",
  style,
}: ItemIconProps) {
  const resolvedIconUrl = useResolvedAssetUrl(iconUrl);

  if (!resolvedIconUrl) {
    return null;
  }

  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 4,
        border: `1px solid ${borderColor}`,
        backgroundImage: `url(${resolvedIconUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
