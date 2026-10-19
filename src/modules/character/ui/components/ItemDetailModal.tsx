"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Space, Spin, Typography } from "antd";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import {
  buildItemEffectExtraText,
} from "@/modules/character/services/item-effect-display";
import {
  buildEquipmentEffectDetailLines,
  buildEquipmentEffectSummaryLines,
} from "@/modules/character/services/equipment-effect-tier-display";
import { ITEM_TYPE_NAMES, RARITY_COLORS, RARITY_NAMES } from "@/modules/shared/constants";

const { Text } = Typography;

interface ItemEffectEntry {
  type?: string;
  value?: number;
  skillId?: string;
  skillName?: string | null;
  avatarId?: string;
  avatarName?: string | null;
  avatarFrameId?: string;
  avatarFrameName?: string | null;
  duration?: number;
  label?: string;
  text?: string;
  extraText?: string;
}

interface HongmengTreasureDetail {
  star: number;
  energy: number;
  energyCap: number;
  regenSecondsPerEnergy: number;
  nextRegenInSeconds: number | null;
}

interface ItemDetail {
  itemId: string;
  quantity: number;
  equipped: boolean;
  equipSlot?: string | null;
  name: string;
  iconUrl?: string | null;
  description?: string | null;
  itemType: string;
  rarity: string;
  price: number;
  stackable?: boolean | null;
  minRealm?: number | null;
  maxRealm?: number | null;
  pillToxicity?: number | null;
  minRealmName?: string | null;
  maxRealmName?: string | null;
  effects?: ItemEffectEntry[] | null;
  effectTextLines?: string[] | null;
  isHongmengTreasure?: boolean;
  hongmengTreasure?: HongmengTreasureDetail | null;
}

interface ItemDetailModalProps {
  open: boolean;
  itemId: string | null;
  onClose: () => void;
  zIndex?: number;
}

const ITEM_DETAIL_MODAL_BASE_Z_INDEX = 2200;

function formatDurationText(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (safeSeconds <= 0) {
    return "0秒";
  }

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);

  return parts.join("");
}

function buildRealmLimitText(item: ItemDetail | null) {
  if (!item) return "无";

  const minLabel = item.minRealmName || (item.minRealm !== null && item.minRealm !== undefined ? String(item.minRealm) : "");
  const maxLabel = item.maxRealmName || (item.maxRealm !== null && item.maxRealm !== undefined ? String(item.maxRealm) : "");

  if (!minLabel && !maxLabel) return "无";
  if (minLabel && maxLabel) return `${minLabel} - ${maxLabel}`;
  if (minLabel) return `最低 ${minLabel}`;
  return `最高 ${maxLabel}`;
}

export default function ItemDetailModal({ open, itemId, onClose, zIndex }: ItemDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedZIndex = typeof zIndex === "number"
    ? Math.max(zIndex, ITEM_DETAIL_MODAL_BASE_Z_INDEX)
    : ITEM_DETAIL_MODAL_BASE_Z_INDEX;

  useEffect(() => {
    if (!open || !itemId) {
      setLoading(false);
      setItem(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchItemDetail = async () => {
      setLoading(true);
      setError(null);
      setItem(null);

      try {
        const response = await fetch(`/api/game/inventory/${encodeURIComponent(itemId)}`);
        const json = await response.json() as { success: boolean; error?: string; data?: ItemDetail };
        if (!json.success || !json.data) {
          throw new Error(json.error || "获取物品详情失败");
        }
        if (!cancelled) {
          setItem(json.data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "获取物品详情失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchItemDetail();

    return () => {
      cancelled = true;
    };
  }, [open, itemId]);

  const effects = useMemo(() => {
    if (!item || !Array.isArray(item.effects)) {
      return [] as ItemEffectEntry[];
    }
    return item.effects;
  }, [item]);

  const effectDetailLines = useMemo(() => buildEquipmentEffectDetailLines({
    itemType: item?.itemType,
    minRealm: item?.minRealm,
  }, effects), [effects, item?.itemType, item?.minRealm]);
  const effectSummaryLines = useMemo(() => buildEquipmentEffectSummaryLines({
    itemType: item?.itemType,
    minRealm: item?.minRealm,
  }, effects), [effects, item?.itemType, item?.minRealm]);
  const realmLimitText = useMemo(() => buildRealmLimitText(item), [item]);

  return (
    <Modal
      title={item ? `物品详情 · ${item.name}` : "物品详情"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      zIndex={resolvedZIndex}
    >
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      )}

      {!loading && error && <Text style={{ color: "#d4545d" }}>{error}</Text>}

      {!loading && !error && item && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <ItemBadge
              name={item.name}
              iconUrl={item.iconUrl}
              rarity={item.rarity}
              quantity={item.quantity}
              iconSize={22}
            />
            <Space size={4} wrap>
              <DarkTag color={RARITY_COLORS[item.rarity]}>{RARITY_NAMES[item.rarity] || item.rarity}</DarkTag>
              <DarkTag color="#6b6355">
                {item.isHongmengTreasure ? "鸿蒙至宝" : (ITEM_TYPE_NAMES[item.itemType] || item.itemType)}
              </DarkTag>
              {item.equipped && <DarkTag color="gold">已装备</DarkTag>}
              {item.quantity > 1 && <DarkTag color="#6b6355">数量 x{item.quantity}</DarkTag>}
            </Space>
          </div>

          <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>
            {item.description || "暂无介绍"}
          </Text>

          {item.isHongmengTreasure ? (
            <>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>鸿蒙信息</Text>
              <Text style={{ color: "#a09880", display: "block" }}>星级：{item.hongmengTreasure?.star ?? 0}</Text>
              <Text style={{ color: "#a09880", display: "block" }}>
                能量：{item.hongmengTreasure?.energy ?? 0}/{item.hongmengTreasure?.energyCap ?? 0}
              </Text>
              <Text style={{ color: "#a09880", display: "block" }}>
                恢复时间：每 {formatDurationText(item.hongmengTreasure?.regenSecondsPerEnergy ?? 0)} 恢复 1 点
              </Text>
            </>
          ) : (
            <>
              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>基础信息</Text>
              <Text style={{ color: "#a09880", display: "block" }}>可堆叠：{item.stackable ? "是" : "否"}</Text>
              {item.itemType === "consumable" && Number(item.pillToxicity || 0) > 0 && (
                <Text style={{ color: "#a09880", display: "block" }}>
                  丹毒值：+{item.pillToxicity}（仅增加修为的丹药生效）
                </Text>
              )}
              <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>境界限制：{realmLimitText}</Text>

              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>效果明细</Text>
              {effectDetailLines.length > 0 ? (
                <div style={{ marginBottom: 12 }}>
                  {effectDetailLines.map((effectLine, index) => {
                    const rawEffect = effects[index];
                    const extraText = effectLine.extraText || (rawEffect ? buildItemEffectExtraText(rawEffect) : "");
                    return (
                      <Text key={`${item.itemId}-effect-${effectLine.key}`} style={{ color: effectLine.color, display: "block" }}>
                        {index + 1}. {effectLine.text || "特殊效果"}
                        {extraText ? (
                        <span style={{ color: "#6b6355" }}>
                          {" "}（{extraText}）
                        </span>
                        ) : null}
                      </Text>
                    );
                  })}
                </div>
              ) : (
                <Text style={{ color: "#6b6355", display: "block", marginBottom: 12 }}>无</Text>
              )}

              <Text style={{ color: "#c9a84c", fontSize: 13, display: "block", marginBottom: 4 }}>加成汇总</Text>
              {effectSummaryLines.length > 0 ? (
                effectSummaryLines.map((line) => (
                  <Text key={`${item.itemId}-summary-${line.key}`} style={{ color: line.color, display: "block" }}>
                    {line.text}
                  </Text>
                ))
              ) : (
                <Text style={{ color: "#6b6355", display: "block" }}>无直接属性加成</Text>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
