"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Typography, Button, Space, Spin, Empty, message, Select, App, InputNumber, Modal, Checkbox } from "antd";
import { ArrowLeftOutlined, SkinOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import { ITEM_TYPE_NAMES, isEquippableItemType } from "@/modules/shared/constants";
import ItemDetailModal from "@/modules/character/ui/components/ItemDetailModal";
import {
  buildQuickSellPreview,
  hasActiveQuickSellFilters,
  normalizeQuickSellFilters,
  QUICK_SELL_ITEM_TYPES,
  QUICK_SELL_RARITIES,
  type QuickSellFilterState,
} from "@/modules/character/services/inventory-quick-sell";
import {
  buildCultivationActionButtonStyle,
  buildCultivationRevealStyle,
  cultivationCompactBarStyle,
  cultivationPageWideShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

const { Text } = Typography;

const RARITY_COLORS: Record<string, string> = {
  common: "#a0a0a0",
  uncommon: "#2ecc71",
  rare: "#3498db",
  epic: "#9b59b6",
  legendary: "#f39c12",
  hongmeng: "#ff3b30",
};

const RARITY_NAMES: Record<string, string> = {
  common: "凡品",
  uncommon: "良品",
  rare: "上品",
  epic: "极品",
  legendary: "仙品",
  hongmeng: "鸿蒙",
};

type InventoryFilter = "all" | "equip" | "consumable" | "skill_book" | "material";

interface HongmengTreasurePreview {
  star: number;
  energy: number;
  energyCap: number;
  regenSecondsPerEnergy: number;
  nextRegenInSeconds: number | null;
}

interface PillToxicityStatus {
  current: number;
  max: number;
  recoverIntervalMinutes: number;
  nextRecoverInSeconds: number | null;
  isFull: boolean;
}

interface InventoryItem {
  itemId: string;
  quantity: number;
  equipped: boolean;
  id: string;
  name: string;
  description: string;
  iconUrl?: string | null;
  itemType: string;
  rarity: string;
  price: number;
  stackable?: boolean;
  minRealm?: number | null;
  maxRealm?: number | null;
  pillToxicity?: number;
  effects: unknown[];
  isHongmengTreasure?: boolean;
  hongmengTreasure?: HongmengTreasurePreview | null;
}

const QUICK_SELL_HINT = "快捷出售按参考价 30% 回收";

function compareInventoryItems(left: InventoryItem, right: InventoryItem) {
  const leftHongmeng = left.rarity === "hongmeng" ? 1 : 0;
  const rightHongmeng = right.rarity === "hongmeng" ? 1 : 0;
  if (leftHongmeng !== rightHongmeng) {
    return rightHongmeng - leftHongmeng;
  }

  const leftTreasure = left.isHongmengTreasure ? 1 : 0;
  const rightTreasure = right.isHongmengTreasure ? 1 : 0;
  if (leftTreasure !== rightTreasure) {
    return rightTreasure - leftTreasure;
  }

  if (left.equipped !== right.equipped) {
    return left.equipped ? -1 : 1;
  }

  return left.itemId.localeCompare(right.itemId, "zh-CN");
}

function formatDurationText(totalSeconds: number): string {
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

export default function InventoryPage() {
  const router = useRouter();
  const { modal } = App.useApp();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [gold, setGold] = useState(0);
  const [lingYu, setLingYu] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [pillToxicity, setPillToxicity] = useState<PillToxicityStatus | null>(null);
  const [quickSellOpen, setQuickSellOpen] = useState(false);
  const [quickSellSubmitting, setQuickSellSubmitting] = useState(false);
  const [quickSellFilters, setQuickSellFilters] = useState<QuickSellFilterState>({
    itemTypes: [],
    rarities: [],
  });
  const [messageApi, contextHolder] = message.useMessage();

  const fetchInventory = useCallback(async () => {
    try {
      const res = await fetch("/api/game/inventory");
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setGold(json.data.gold);
        setLingYu(json.data.lingYu || 0);
        setPillToxicity(json.data.pillToxicity || null);
      } else {
        messageApi.error(json.error || "获取背包失败");
      }
    } catch {
      messageApi.error("获取背包失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchInventory();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchInventory]);

  const quickSellPreview = useMemo(
    () => buildQuickSellPreview(items, quickSellFilters),
    [items, quickSellFilters],
  );
  const quickSellHasActiveFilters = hasActiveQuickSellFilters(quickSellFilters);

  const handleAction = async (action: string, itemId: string, dropQuantity?: number) => {
    try {
      const res = await fetch("/api/game/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          itemId,
          ...(action === "drop" ? { dropQuantity } : {}),
        }),
      });
      const json = await res.json();
      if (json.success) {
        messageApi.success(json.data.message);
        void fetchInventory();
      } else {
        messageApi.error(json.error);
      }
    } catch {
      messageApi.error("操作失败");
    }
  };

  const handleDropClick = (item: InventoryItem, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();

    let quantity = 1;

    modal.confirm({
      title: `确认丢弃 ${item.name}？`,
      content: (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text style={{ color: "#a09880" }}>丢弃数量</Text>
          <InputNumber
            min={1}
            max={item.quantity}
            defaultValue={1}
            precision={0}
            style={{ width: 120 }}
            onChange={(value) => {
              quantity = Number(value || 1);
            }}
          />
          <Text style={{ color: "#6b6355" }}>/ {item.quantity}</Text>
        </div>
      ),
      okText: "确认",
      cancelText: "取消",
      onOk: () => {
        const finalQuantity = Number.isInteger(quantity) ? quantity : 1;
        return handleAction("drop", item.itemId, finalQuantity);
      },
    });
  };

  const handleQuickSellSelectAll = () => {
    setQuickSellFilters({
      itemTypes: [...QUICK_SELL_ITEM_TYPES],
      rarities: [...QUICK_SELL_RARITIES],
    });
  };

  const handleQuickSellClear = () => {
    setQuickSellFilters({
      itemTypes: [],
      rarities: [],
    });
  };

  const handleQuickSellSubmit = async () => {
    if (!quickSellHasActiveFilters) {
      messageApi.warning("请先勾选至少一种类型或品质");
      return;
    }
    if (quickSellPreview.entries.length <= 0) {
      messageApi.warning("当前筛选下无可出售物品");
      return;
    }

    modal.confirm({
      title: "确认快捷出售",
      okText: "确认出售",
      cancelText: "取消",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={{ color: "#a09880" }}>
            命中 {quickSellPreview.soldStackCount} 种物品，共 {quickSellPreview.soldItemCount} 件
          </Text>
          <Text style={{ color: "#c9a84c" }}>
            预计获得 {quickSellPreview.goldGained} 灵石
          </Text>
          <Text style={{ color: "#8f8776", fontSize: 12 }}>
            禁售规则：已装备、鸿蒙至宝、任务物品、参考价无效或回收价低于 1 的物品不会被出售。
          </Text>
          <Text style={{ color: "#8f8776", fontSize: 12 }}>
            {QUICK_SELL_HINT}
          </Text>
        </div>
      ),
      onOk: async () => {
        setQuickSellSubmitting(true);
        try {
          const res = await fetch("/api/game/inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "quick_sell",
              filters: normalizeQuickSellFilters(quickSellFilters),
            }),
          });
          const json = await res.json();
          if (!json.success) {
            messageApi.error(json.error || "快捷出售失败");
            return;
          }
          messageApi.success(
            json.data?.message
              || `快捷出售成功，出售 ${json.data?.soldStackCount || 0} 种物品，共 ${json.data?.soldItemCount || 0} 件，获得 ${json.data?.goldGained || 0} 灵石`,
          );
          setQuickSellOpen(false);
          void fetchInventory();
        } catch {
          messageApi.error("快捷出售失败");
        } finally {
          setQuickSellSubmitting(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <div style={{ ...cultivationPageWideShellStyle, display: "flex", justifyContent: "center", padding: "40px 8px" }}>
        <Spin />
      </div>
    );
  }

  const counts = {
    all: items.length,
    equip: items.filter((item) => isEquippableItemType(item.itemType)).length,
    consumable: items.filter((item) => item.itemType === "consumable").length,
    skill_book: items.filter((item) => item.itemType === "skill_book").length,
    material: items.filter((item) => item.itemType === "material" || item.itemType === "quest").length,
  };

  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "equip") return isEquippableItemType(item.itemType);
    if (filter === "consumable") return item.itemType === "consumable";
    if (filter === "skill_book") return item.itemType === "skill_book";
    if (filter === "material") return item.itemType === "material" || item.itemType === "quest";
    return true;
  }).sort(compareInventoryItems);
  const backButtonStyle = {
    ...buildCultivationActionButtonStyle(),
    minHeight: 30,
    padding: "0 12px",
  } as const;
  const quickActionButtonStyle = {
    ...buildCultivationActionButtonStyle(),
    minHeight: 32,
    padding: "0 12px",
  } as const;

  const renderItem = (item: InventoryItem) => (
    <Card
      key={item.itemId}
      size="small"
      style={{
        marginBottom: 4,
        ...cultivationSectionCardStyle,
        background: item.equipped
          ? "linear-gradient(180deg, rgba(58, 47, 19, 0.94) 0%, rgba(28, 24, 20, 0.96) 100%)"
          : cultivationSectionCardStyle.background,
        border: `1px solid ${item.equipped ? "rgba(201, 168, 76, 0.32)" : "rgba(58, 51, 41, 0.9)"}`,
        borderRadius: 14,
        cursor: "pointer",
      }}
      onClick={() => setDetailItemId(item.itemId)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={4}>
            <ItemBadge
              name={item.name}
              iconUrl={item.iconUrl}
              rarity={item.rarity}
              quantity={item.quantity}
              iconSize={16}
            />
            <DarkTag color={RARITY_COLORS[item.rarity]} style={{ fontSize: 10, padding: "0 3px" }}>
              {RARITY_NAMES[item.rarity] || item.rarity}
            </DarkTag>
            <DarkTag color="#6b6355" style={{ fontSize: 10, padding: "0 3px" }}>
              {item.isHongmengTreasure ? "鸿蒙至宝" : (ITEM_TYPE_NAMES[item.itemType] || item.itemType)}
            </DarkTag>
            {item.equipped && (
              <DarkTag color="gold" style={{ fontSize: 10, padding: "0 3px" }}>
                已装备
              </DarkTag>
            )}
            {item.itemType === "consumable" && Number(item.pillToxicity || 0) > 0 && (
              <DarkTag color="#8f5f2a" style={{ fontSize: 10, padding: "0 3px" }}>
                丹毒+{item.pillToxicity}
              </DarkTag>
            )}
          </Space>
          <Text style={{ color: "#6b6355", fontSize: 11, display: "block" }}>
            {item.description || "暂无介绍"}
          </Text>
          {item.hongmengTreasure && (
            <Text style={{ color: "#a09880", fontSize: 11, display: "block" }}>
              {`星级 ${item.hongmengTreasure.star} | 能量 ${item.hongmengTreasure.energy}/${item.hongmengTreasure.energyCap} | 每${formatDurationText(item.hongmengTreasure.regenSecondsPerEnergy)}恢复1点`}
            </Text>
          )}
        </div>
        <Space size={4}>
          {(item.itemType === "consumable" || item.itemType === "skill_book") && (
            <Button size="small" onClick={(e) => { e.stopPropagation(); void handleAction("use", item.itemId); }}>
              使用
            </Button>
          )}
          {isEquippableItemType(item.itemType) && (
            item.equipped
              ? <Button size="small" onClick={(e) => { e.stopPropagation(); void handleAction("unequip", item.itemId); }}>卸下</Button>
              : <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); void handleAction("equip", item.itemId); }}>装备</Button>
          )}
          {!item.isHongmengTreasure && (
            <Button
              size="small"
              danger
              onClick={(e) => handleDropClick(item, e)}
            >
              丢弃
            </Button>
          )}
        </Space>
      </div>
    </Card>
  );

  return (
    <div style={{ ...cultivationPageWideShellStyle, ...buildCultivationRevealStyle(0) }}>
      {contextHolder}
      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} style={backButtonStyle} onClick={() => router.push("/game/character")}>
          返回角色
        </Button>
      </div>
      <div
        style={{
          ...cultivationCompactBarStyle,
          ...buildCultivationRevealStyle(30),
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Text style={{ color: "#a09880" }}><SkinOutlined /> 背包</Text>
        <Space size={8}>
          <Text style={{ color: "#c9a84c" }}>灵石：{gold}</Text>
          <Text style={{ color: "#52b788" }}>灵玉：{lingYu}</Text>
        </Space>
      </div>

      {pillToxicity && (
        <div
          style={{
            ...cultivationSoftPanelStyle,
            ...buildCultivationRevealStyle(70),
            marginBottom: 8,
            padding: "8px 10px",
            background: pillToxicity.isFull ? "rgba(95, 36, 36, 0.88)" : "rgba(58, 35, 20, 0.88)",
            border: `1px solid ${pillToxicity.isFull ? "#8f3c3c" : "#5a3d22"}`,
          }}
        >
          <Text style={{ color: pillToxicity.isFull ? "#ffd6d6" : "#f2d29b", display: "block" }}>
            当前丹毒：{pillToxicity.current}/{pillToxicity.max}
          </Text>
          <Text style={{ color: "#c8b08a", fontSize: 12, display: "block" }}>
            每 {pillToxicity.recoverIntervalMinutes} 分钟恢复 1 点
            {pillToxicity.nextRecoverInSeconds
              ? `，下次恢复约 ${Math.ceil(pillToxicity.nextRecoverInSeconds / 60)} 分钟后`
              : "，当前可继续服丹"}
          </Text>
        </div>
      )}

      <div
        style={{
          ...cultivationSectionCardStyle,
          ...buildCultivationRevealStyle(110),
          marginBottom: 8,
          padding: "8px",
          borderRadius: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ color: "#a09880" }}>
          显示 {filteredItems.length}/{items.length} 件
        </Text>
        <Space size={6} wrap>
          <Select
            size="small"
            value={filter}
            style={{ width: 170 }}
            onChange={(value) => setFilter(value as InventoryFilter)}
            options={[
              { label: `全部 (${counts.all})`, value: "all" },
              { label: `装备 (${counts.equip})`, value: "equip" },
              { label: `丹药 (${counts.consumable})`, value: "consumable" },
              { label: `神通书 (${counts.skill_book})`, value: "skill_book" },
              { label: `材料 (${counts.material})`, value: "material" },
            ]}
          />
          <Button
            size="small"
            style={quickActionButtonStyle}
            onClick={() => setQuickSellOpen(true)}
          >
            快捷出售
          </Button>
        </Space>
      </div>

      {filteredItems.length > 0
        ? filteredItems.map(renderItem)
        : <Empty description={<Text style={{ color: "#6b6355" }}>当前筛选下暂无物品</Text>} />}

      <Modal
        open={quickSellOpen}
        title="快捷出售"
        okText="出售"
        cancelText="取消"
        confirmLoading={quickSellSubmitting}
        okButtonProps={{
          disabled: !quickSellHasActiveFilters || quickSellPreview.entries.length <= 0 || quickSellSubmitting,
        }}
        onCancel={() => {
          if (!quickSellSubmitting) {
            setQuickSellOpen(false);
          }
        }}
        onOk={() => void handleQuickSellSubmit()}
        width="min(420px, calc(100vw - 24px))"
        styles={{
          body: {
            paddingTop: 12,
          },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text style={{ color: "#8f8776", fontSize: 12 }}>{QUICK_SELL_HINT}</Text>
            <Space size={8}>
              <Button size="small" type="link" onClick={handleQuickSellSelectAll} style={{ paddingInline: 0 }}>
                全选
              </Button>
              <Button size="small" type="link" onClick={handleQuickSellClear} style={{ paddingInline: 0 }}>
                清空
              </Button>
            </Space>
          </div>

          <div
            style={{
              ...cultivationSoftPanelStyle,
              padding: "10px 12px",
            }}
          >
            <Text style={{ color: "#a09880", display: "block", marginBottom: 8 }}>按类型筛选</Text>
            <Checkbox.Group
              value={quickSellFilters.itemTypes || []}
              onChange={(values) => setQuickSellFilters((current) => ({
                ...current,
                itemTypes: values.map((value) => String(value)),
              }))}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {QUICK_SELL_ITEM_TYPES.map((itemType) => (
                  <Checkbox key={itemType} value={itemType}>
                    {ITEM_TYPE_NAMES[itemType] || itemType}
                  </Checkbox>
                ))}
              </div>
            </Checkbox.Group>
          </div>

          <div
            style={{
              ...cultivationSoftPanelStyle,
              padding: "10px 12px",
            }}
          >
            <Text style={{ color: "#a09880", display: "block", marginBottom: 8 }}>按品质筛选</Text>
            <Checkbox.Group
              value={quickSellFilters.rarities || []}
              onChange={(values) => setQuickSellFilters((current) => ({
                ...current,
                rarities: values.map((value) => String(value)),
              }))}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {QUICK_SELL_RARITIES.map((rarity) => (
                  <Checkbox key={rarity} value={rarity}>
                    <span style={{ color: RARITY_COLORS[rarity] || "#d9d9d9" }}>
                      {RARITY_NAMES[rarity] || rarity}
                    </span>
                  </Checkbox>
                ))}
              </div>
            </Checkbox.Group>
          </div>

          <div
            style={{
              ...cultivationSoftPanelStyle,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <Text style={{ color: "#a09880" }}>
              命中 {quickSellPreview.soldStackCount} 种物品 / 总出售 {quickSellPreview.soldItemCount} 件
            </Text>
            <Text style={{ color: "#c9a84c" }}>
              预计获得 {quickSellPreview.goldGained} 灵石
            </Text>
            <Text style={{ color: "#8f8776", fontSize: 12 }}>
              仅会出售符合规则的整组物品；已装备、鸿蒙至宝、任务物品和无有效参考价物品将自动排除。
            </Text>
          </div>
        </div>
      </Modal>

      <ItemDetailModal
        open={Boolean(detailItemId)}
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
      />
    </div>
  );
}
