"use client";

import { useState, type CSSProperties } from "react";
import GameImage from "@/modules/shared/ui/components/GameImage";

interface PlayerAvatarProps {
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  size?: number;
  fallbackText?: string;
  fallbackColor?: string;
  fallbackFontSize?: number;
  fallbackFontWeight?: number;
  borderColor?: string;
  background?: string;
  style?: CSSProperties;
}

export default function PlayerAvatar({
  avatarImageUrl,
  avatarFrameImageUrl,
  size = 32,
  fallbackText = "修士",
  fallbackColor = "#6b6355",
  fallbackFontSize,
  fallbackFontWeight = 500,
  borderColor = "#2a2520",
  background = "rgba(26, 26, 46, 0.9)",
  style,
}: PlayerAvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const avatarInset = avatarFrameImageUrl ? Math.max(2, Math.round(size * 0.08)) : 0;
  const shouldRenderAvatarImage = Boolean(avatarImageUrl) && failedAvatarUrl !== avatarImageUrl;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        position: "relative",
        flex: "0 0 auto",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: avatarInset,
          borderRadius: 999,
          overflow: "hidden",
          border: `1px solid ${borderColor}`,
          background,
        }}
      >
        {shouldRenderAvatarImage ? (
          <GameImage
            src={avatarImageUrl}
            alt=""
            fill
            sizes={`${size}px`}
            style={{ objectFit: "cover", display: "block" }}
            onError={() => setFailedAvatarUrl(avatarImageUrl || null)}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: fallbackColor,
              fontSize: fallbackFontSize ?? Math.max(10, Math.floor(size * 0.32)),
              fontWeight: fallbackFontWeight,
            }}
          >
            {fallbackText}
          </div>
        )}
      </div>
      {avatarFrameImageUrl && (
        <div
          aria-hidden
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <GameImage
            src={avatarFrameImageUrl}
            alt=""
            fill
            sizes={`${size}px`}
            style={{
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>
      )}
    </div>
  );
}
