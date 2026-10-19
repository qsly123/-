"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Modal, Space, Spin, Typography } from "antd";
import DarkTag from "@/modules/shared/ui/components/DarkTag";

const { Text } = Typography;

type ItemSourceType = "shop" | "monster_drop" | "spiritual_field" | "quest_reward";

interface ItemSourceEntry {
  type: ItemSourceType;
  itemId: string;
  label: string;
  sourceName: string;
  mapName?: string | null;
  npcName?: string | null;
  monsterName?: string | null;
  questName?: string | null;
  price?: number;
  chance?: number;
  minQuantity?: number;
  maxQuantity?: number;
  quantity?: number;
}

interface ItemSourceModalProps {
  open: boolean;
  itemId: string | null;
  itemName?: string | null;
  onClose: () => void;
  zIndex?: number;
}

const SOURCE_TAG_COLOR: Record<ItemSourceType, string> = {
  shop: "gold",
  monster_drop: "red",
  spiritual_field: "green",
  quest_reward: "blue",
};

function formatChance(chance: number | undefined) {
  if (chance === undefined || !Number.isFinite(chance)) {
    return null;
  }

  if (chance <= 1) {
    const percentValue = chance * 100;
    return `${percentValue.toFixed(percentValue % 1 === 0 ? 0 : 2)}%`;
  }

  return `${chance.toFixed(chance % 1 === 0 ? 0 : 2)}%`;
}

function buildExtraText(source: ItemSourceEntry) {
  if (source.type === "shop") {
    return typeof source.price === "number" ? `售价：${source.price} 灵石` : null;
  }

  if (source.type === "monster_drop") {
    const chanceText = formatChance(source.chance);
    const quantityText = typeof source.minQuantity === "number" && typeof source.maxQuantity === "number"
      ? (source.minQuantity === source.maxQuantity
        ? `数量 ${source.minQuantity}`
        : `数量 ${source.minQuantity}-${source.maxQuantity}`)
      : null;
    return [chanceText ? `掉率：${chanceText}` : null, quantityText]
      .filter(Boolean)
      .join(" | ");
  }

  if (source.type === "spiritual_field") {
    return typeof source.minQuantity === "number" && typeof source.maxQuantity === "number"
      ? `每收 ${source.minQuantity}-${source.maxQuantity}`
      : null;
  }

  if (source.type === "quest_reward") {
    return typeof source.quantity === "number" ? `奖励数量：${source.quantity}` : null;
  }

  return null;
}

export default function ItemSourceModal({
  open,
  itemId,
  itemName,
  onClose,
  zIndex,
}: ItemSourceModalProps) {
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<ItemSourceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !itemId) {
      setLoading(false);
      setSources([]);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchSources = async () => {
      setLoading(true);
      setSources([]);
      setError(null);

      try {
        const response = await fetch(`/api/game/items/${encodeURIComponent(itemId)}/sources`, {
          cache: "no-store",
        });
        const json = await response.json() as {
          success: boolean;
          error?: string;
          data?: { itemId: string; sources: ItemSourceEntry[] };
        };

        if (!json.success || !json.data) {
          throw new Error(json.error || "获取物品来源失败");
        }

        if (!cancelled) {
          setSources(Array.isArray(json.data.sources) ? json.data.sources : []);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "获取物品来源失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchSources();

    return () => {
      cancelled = true;
    };
  }, [open, itemId]);

  const title = useMemo(() => (
    itemName ? `物品来源 · ${itemName}` : "物品来源"
  ), [itemName]);

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      zIndex={zIndex}
    >
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      )}

      {!loading && error && (
        <Text style={{ color: "#d4545d" }}>{error}</Text>
      )}

      {!loading && !error && sources.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text style={{ color: "#6b6355" }}>暂无已收录来源</Text>}
        />
      )}

      {!loading && !error && sources.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((source, index) => {
            const extraText = buildExtraText(source);
            return (
              <div
                key={`${source.type}-${source.sourceName}-${source.mapName || "none"}-${index}`}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #3a3228",
                  background: "rgba(24, 20, 14, 0.82)",
                }}
              >
                <Space size={6} wrap>
                  <DarkTag color={SOURCE_TAG_COLOR[source.type]}>{source.label}</DarkTag>
                  <Text style={{ color: "#e8e0d0", fontWeight: 600 }}>{source.sourceName}</Text>
                </Space>
                {source.mapName && (
                  <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginTop: 6 }}>
                    地图：{source.mapName}
                  </Text>
                )}
                {extraText && (
                  <Text style={{ color: "#a09880", fontSize: 12, display: "block", marginTop: 4 }}>
                    {extraText}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
