import type { CSSProperties, KeyboardEvent } from "react";
import { Typography } from "antd";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import { RARITY_COLORS, RARITY_NAMES } from "@/modules/shared/constants";

const { Text } = Typography;

interface ItemBadgeProps {
  name: string;
  iconUrl?: string | null;
  rarity?: string | null;
  quantity?: number;
  iconSize?: number;
  showRarityLabel?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}

export default function ItemBadge({
  name,
  iconUrl,
  rarity,
  quantity,
  iconSize = 14,
  showRarityLabel = false,
  style,
  onClick,
}: ItemBadgeProps) {
  const badgeStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "1px 6px 1px 4px",
    border: "1px solid #3a3228",
    borderRadius: 5,
    background: "rgba(14, 14, 20, 0.62)",
    maxWidth: "100%",
    cursor: onClick ? "pointer" : "default",
    ...style,
  };

  const nameColor = RARITY_COLORS[rarity || ""] || "#e8e0d0";
  const rarityLabel = showRarityLabel ? RARITY_NAMES[rarity || ""] : "";
  const safeQuantity = Number(quantity || 0);

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!onClick) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onClick();
  };

  return (
    <span
      style={badgeStyle}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      <ItemIcon iconUrl={iconUrl} size={iconSize} borderColor="#5a4c3a" />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
          maxWidth: safeQuantity > 1 ? 176 : 192,
          flexShrink: 1,
        }}
      >
        <Text
          style={{
            color: nameColor,
            fontWeight: 600,
            fontSize: 12,
            lineHeight: 1.2,
            maxWidth: rarityLabel ? 126 : 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "inline-block",
            flexShrink: 1,
          }}
        >
          {name}
        </Text>
        {rarityLabel ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              padding: "0 4px",
              borderRadius: 999,
              border: `1px solid ${nameColor}55`,
              color: nameColor,
              background: "rgba(255, 255, 255, 0.04)",
              fontSize: 10,
              lineHeight: "14px",
              whiteSpace: "nowrap",
            }}
          >
            {rarityLabel}
          </span>
        ) : null}
      </span>
      {safeQuantity > 1 && (
        <Text style={{ color: "#8f8878", fontSize: 11, lineHeight: 1 }}>
          x{safeQuantity}
        </Text>
      )}
    </span>
  );
}
