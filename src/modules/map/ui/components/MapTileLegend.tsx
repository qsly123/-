"use client";

import { Space, Typography } from "antd";
import { TILE_COLORS, TILE_ICONS, TILE_LABELS, TILE_LEGEND_TYPES } from "@/modules/map/services/map-tile-visual";

const { Text } = Typography;

interface MapTileLegendProps {
  title?: string;
  types?: string[];
  tileSize?: number;
  colorMap?: Record<string, string>;
  borderColor?: string;
}

export default function MapTileLegend({
  title = "地形图例：",
  types,
  tileSize = 12,
  colorMap,
  borderColor = "#1f1b17",
}: MapTileLegendProps) {
  const legendTypes = (types && types.length > 0 ? types : Array.from(TILE_LEGEND_TYPES))
    .filter((type, index, arr) => arr.indexOf(type) === index);

  return (
    <Space wrap size={12}>
      {title ? <Text type="secondary">{title}</Text> : null}
      {legendTypes.map((type) => (
        <Space key={type} size={4}>
          <span
            style={{
              width: tileSize + 2,
              height: tileSize + 2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${borderColor}`,
              background: colorMap?.[type] || TILE_COLORS[type] || "#1a1a2e",
              lineHeight: 1,
              fontSize: tileSize,
            }}
          >
            <span aria-hidden="true">{TILE_ICONS[type] || ""}</span>
          </span>
          <Text type="secondary">{TILE_LABELS[type] || type}</Text>
        </Space>
      ))}
    </Space>
  );
}
