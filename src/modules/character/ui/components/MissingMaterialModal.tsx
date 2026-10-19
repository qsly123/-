"use client";

import { useEffect, useState } from "react";
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

export interface MissingMaterial {
  itemId: string;
  itemName: string;
  required: number;
  owned: number;
  missing: number;
}

interface MissingMaterialModalProps {
  open: boolean;
  materials: MissingMaterial[];
  /** 弹框标题，例如「炼制 青箬法衣 还缺这些材料」 */
  title?: string;
  onClose: () => void;
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
    return [chanceText ? `掉率：${chanceText}` : null, quantityText].filter(Boolean).join(" | ");
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

/**
 * 材料不足弹框：列出缺哪些、缺多少，以及每样材料在哪能弄到。
 * 来源数据走 /api/game/items/{id}/sources（商店 / 怪物掉落 / 任务奖励）。
 */
export default function MissingMaterialModal({
  open,
  materials,
  title,
  onClose,
}: MissingMaterialModalProps) {
  const [loading, setLoading] = useState(false);
  const [sourceMap, setSourceMap] = useState<Record<string, ItemSourceEntry[]>>({});

  useEffect(() => {
    if (!open || materials.length === 0) {
      setLoading(false);
      setSourceMap({});
      return;
    }

    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      setSourceMap({});

      const entries = await Promise.all(
        materials.map(async (material) => {
          try {
            const response = await fetch(
              `/api/game/items/${encodeURIComponent(material.itemId)}/sources`,
              { cache: "no-store" },
            );
            const json = await response.json() as {
              success: boolean;
              data?: { sources?: ItemSourceEntry[] };
            };
            const sources = json.success && Array.isArray(json.data?.sources)
              ? json.data!.sources!
              : [];
            return [material.itemId, sources] as const;
          } catch {
            return [material.itemId, []] as const;
          }
        }),
      );

      if (!cancelled) {
        setSourceMap(Object.fromEntries(entries));
        setLoading(false);
      }
    };

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, [open, materials]);

  return (
    <Modal
      title={title || "材料不足"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={520}
    >
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      )}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {materials.map((material) => {
            const sources = sourceMap[material.itemId] || [];
            return (
              <div
                key={material.itemId}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #3a3228",
                  background: "rgba(24, 20, 14, 0.82)",
                }}
              >
                <Space size={6} wrap>
                  <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>{material.itemName}</Text>
                  <DarkTag color="#ff7875" style={{ fontSize: 10, padding: "0 4px" }}>
                    缺 {material.missing}
                  </DarkTag>
                  <Text style={{ color: "#8e856e", fontSize: 11 }}>
                    需 {material.required} · 有 {material.owned}
                  </Text>
                </Space>

                {sources.length === 0 ? (
                  <Text style={{ color: "#6b6355", fontSize: 12, display: "block", marginTop: 6 }}>
                    暂无已收录来源（可能在秘境或活动中产出）
                  </Text>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {sources.map((source, index) => {
                      const extraText = buildExtraText(source);
                      return (
                        <div key={`${source.type}-${source.sourceName}-${index}`}>
                          <Space size={5} wrap>
                            <DarkTag color={SOURCE_TAG_COLOR[source.type]} style={{ fontSize: 10, padding: "0 4px" }}>
                              {source.label}
                            </DarkTag>
                            <Text style={{ color: "#c9bf9f", fontSize: 12 }}>{source.sourceName}</Text>
                          </Space>
                          <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 2 }}>
                            {source.mapName ? `${source.mapName}` : "位置未标注"}
                            {extraText ? ` · ${extraText}` : ""}
                          </Text>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {materials.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<Text style={{ color: "#6b6355" }}>材料已齐备</Text>}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
