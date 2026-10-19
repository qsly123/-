"use client";

import { useState } from "react";
import { Space, Typography } from "antd";
import ItemDetailModal from "@/modules/character/ui/components/ItemDetailModal";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";

const { Text } = Typography;

export type RewardDropListEntry = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  quantity: number;
  itemRarity?: string | null;
};

interface RewardDropListProps {
  drops?: RewardDropListEntry[] | null;
  emptyText?: string;
  iconSize?: number;
}

export default function RewardDropList({
  drops,
  emptyText = "无",
  iconSize = 16,
}: RewardDropListProps) {
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const safeDrops = Array.isArray(drops) ? drops.filter((drop) => Boolean(drop?.itemId)) : [];

  if (safeDrops.length < 1) {
    return <Text style={{ color: "#6b6355" }}>{emptyText}</Text>;
  }

  return (
    <>
      <Space wrap size={[8, 8]} style={{ width: "100%" }}>
        {safeDrops.map((drop, index) => (
          <ItemBadge
            key={`${drop.itemId}-${index}-${drop.quantity}`}
            name={drop.itemName}
            iconUrl={drop.itemIconUrl}
            rarity={drop.itemRarity}
            quantity={drop.quantity}
            iconSize={iconSize}
            showRarityLabel
            onClick={() => setDetailItemId(drop.itemId)}
          />
        ))}
      </Space>
      <ItemDetailModal
        open={Boolean(detailItemId)}
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
        zIndex={2600}
      />
    </>
  );
}
