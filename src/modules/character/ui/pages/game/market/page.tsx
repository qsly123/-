"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  message,
} from "antd";
import { ShopOutlined } from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import ItemDetailModal from "@/modules/character/ui/components/ItemDetailModal";
import { ITEM_TYPE_NAMES } from "@/modules/shared/constants";
import { useGameNotifications } from "@/modules/shared/ui/contexts/GameNotificationContext";

const { Text } = Typography;
const { Search } = Input;

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

type MarketListing = {
  id: number;
  sellerPlayerId: string;
  sellerName: string;
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  itemType: string;
  rarity: string;
  isBound: boolean;
  unitPrice: number;
  quantityTotal: number;
  quantityRemaining: number;
  status: "active" | "sold_out" | "cancelled" | "expired";
  visibleAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  isMine: boolean;
};

type MarketListResponse = {
  success: boolean;
  error?: string;
  data?: {
    list: MarketListing[];
    feePercent: number;
    dailyBuyLimit?: number;
    dailyBuyRuleText?: string;
    playerGold: number;
    worldPenaltySummary?: {
      baseFeePercent: number;
      extraFeePercent: number;
      finalFeePercent: number;
      level: "none" | "mild" | "medium" | "high";
      summary: string;
      hints: string[];
    };
    pagination: {
      page: number;
      pageSize: number;
      total: number;
    };
  };
};

type InventoryItem = {
  itemId: string;
  quantity: number;
  equipped: boolean;
  name: string;
  iconUrl?: string | null;
  itemType: string;
  rarity: string;
  isBound?: boolean;
};

type InventoryResponse = {
  success: boolean;
  error?: string;
  data?: {
    items: InventoryItem[];
  };
};

type MarketTradeRecord = {
  id: number;
  side: "sell" | "buy";
  counterpartyPlayerId: string;
  counterpartyName: string;
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  quantity: number;
  unitPrice: number;
  gross: number;
  fee: number;
  sellerNet: number;
  isSellerUnread: boolean;
  createdAt: string;
};

type MarketTradesResponse = {
  success: boolean;
  error?: string;
  data?: {
    unreadCount: number;
    list: MarketTradeRecord[];
  };
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isListingBuffering(listing: MarketListing, now = Date.now()) {
  if (listing.status !== "active") {
    return false;
  }
  const visibleAt = new Date(listing.visibleAt).getTime();
  return Number.isFinite(visibleAt) && visibleAt > now;
}

function isListingBuyable(listing: MarketListing, now = Date.now()) {
  if (listing.status !== "active") {
    return false;
  }
  const visibleAt = new Date(listing.visibleAt).getTime();
  const expiresAt = new Date(listing.expiresAt).getTime();
  return (!Number.isFinite(visibleAt) || visibleAt <= now)
    && (!Number.isFinite(expiresAt) || expiresAt > now);
}

function statusToTag(listing: MarketListing) {
  if (listing.status === "expired") {
    return <DarkTag color="volcano">已过期</DarkTag>;
  }
  if (listing.status === "sold_out") {
    return <DarkTag color="blue">已售罄</DarkTag>;
  }
  if (listing.status === "cancelled") {
    return <DarkTag color="default">已下架</DarkTag>;
  }
  if (isListingBuffering(listing)) {
    return <DarkTag color="orange">缓冲中</DarkTag>;
  }
  return <DarkTag color="green">在售</DarkTag>;
}

export default function MarketPage() {
  const { modal } = App.useApp();
  const [messageApi, contextHolder] = message.useMessage();
  const { refreshNotifications } = useGameNotifications();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [list, setList] = useState<MarketListing[]>([]);
  const [trades, setTrades] = useState<MarketTradeRecord[]>([]);
  const [tradeUnreadCount, setTradeUnreadCount] = useState(0);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [feePercent, setFeePercent] = useState(5);
  const [dailyBuyRuleText, setDailyBuyRuleText] = useState("限购10次");
  const [worldPenaltySummary, setWorldPenaltySummary] = useState<NonNullable<MarketListResponse["data"]>["worldPenaltySummary"] | null>(null);
  const [playerGold, setPlayerGold] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [myOnly, setMyOnly] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [inventoryOptions, setInventoryOptions] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const selectedItemId = Form.useWatch<string>("itemId", form);
  const selectedItem = useMemo(
    () => inventoryOptions.find((item) => item.itemId === selectedItemId),
    [inventoryOptions, selectedItemId],
  );

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (myOnly) {
        params.set("myOnly", "true");
      }
      if (keyword.trim()) {
        params.set("keyword", keyword.trim());
      }

      const res = await fetch(`/api/game/market/listings?${params.toString()}`, { cache: "no-store" });
      const json = await res.json() as MarketListResponse;

      if (!json.success) {
        messageApi.error(json.error || "加载市场失败");
        return;
      }

      setList(json.data?.list || []);
      setFeePercent(Number(json.data?.feePercent || 0));
      setDailyBuyRuleText(json.data?.dailyBuyRuleText || "限购10次");
      setWorldPenaltySummary(json.data?.worldPenaltySummary || null);
      setPlayerGold(Number(json.data?.playerGold || 0));
      setTotal(Number(json.data?.pagination?.total || 0));
      setPage(Number(json.data?.pagination?.page || 1));
      setPageSize(Number(json.data?.pagination?.pageSize || 20));
    } catch {
      messageApi.error("加载市场失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, messageApi, myOnly, page, pageSize]);

  useEffect(() => {
    void fetchListings();
  }, [fetchListings]);

  const fetchTrades = useCallback(async () => {
    setTradeLoading(true);
    try {
      const res = await fetch("/api/game/market/trades?limit=20", { cache: "no-store" });
      const json = await res.json() as MarketTradesResponse;
      if (!json.success) {
        messageApi.error(json.error || "加载交易记录失败");
        return;
      }
      setTrades(json.data?.list || []);
      setTradeUnreadCount(Math.max(0, Number(json.data?.unreadCount || 0)));
    } catch {
      messageApi.error("加载交易记录失败");
    } finally {
      setTradeLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    let canceled = false;

    const markTradeRead = async () => {
      try {
        const res = await fetch("/api/game/market/trades", { method: "POST" });
        const json = await res.json() as { success: boolean };
        if (!json.success || canceled) {
          return;
        }
        await refreshNotifications();
        await fetchTrades();
      } catch {
        // 自动已读失败时不打断页面主流程
      }
    };

    void markTradeRead();
    return () => {
      canceled = true;
    };
  }, [fetchTrades, refreshNotifications]);

  const fetchTradableInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const res = await fetch("/api/game/inventory", { cache: "no-store" });
      const json = await res.json() as InventoryResponse;
      if (!json.success) {
        throw new Error(json.error || "加载背包失败");
      }

      const options = (json.data?.items || []).filter((item) => {
        return Number(item.quantity || 0) > 0 && !item.equipped && !item.isBound;
      });

      setInventoryOptions(options);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载背包失败");
    } finally {
      setInventoryLoading(false);
    }
  }, [messageApi]);

  const openCreateModal = async () => {
    form.resetFields();
    await fetchTradableInventory();
    setCreateOpen(true);
  };

  const handleCreateListing = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const res = await fetch("/api/game/market/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: values.itemId,
          unitPrice: values.unitPrice,
          quantity: values.quantity,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string; data?: { message?: string } };
      if (!json.success) {
        messageApi.error(json.error || "上架失败");
        return;
      }

      messageApi.success(json.data?.message || "上架成功");
      setCreateOpen(false);
      form.resetFields();
      await fetchListings();
      await fetchTrades();
    } catch {
      // 表单校验失败不提示
    } finally {
      setSubmitting(false);
    }
  }, [fetchListings, fetchTrades, form, messageApi]);

  const handleCancelListing = useCallback((listing: MarketListing) => {
    modal.confirm({
      title: `确认下架 ${listing.itemName}？`,
      content: `将返还 ${listing.quantityRemaining} 件到背包。`,
      okText: "下架",
      cancelText: "取消",
      onOk: async () => {
        const res = await fetch(`/api/game/market/listings/${listing.id}/cancel`, {
          method: "POST",
        });
        const json = await res.json() as { success: boolean; error?: string; data?: { message?: string } };
        if (!json.success) {
          messageApi.error(json.error || "下架失败");
          return;
        }
        messageApi.success(json.data?.message || "下架成功");
        await fetchListings();
        await fetchTrades();
      },
    });
  }, [fetchListings, fetchTrades, messageApi, modal]);

  const handleBuyListing = useCallback((listing: MarketListing) => {
    let quantity = 1;

    modal.confirm({
      title: `购买 ${listing.itemName}`,
      content: (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text style={{ color: "#a09880" }}>购买数量</Text>
          <InputNumber
            min={1}
            max={listing.quantityRemaining}
            defaultValue={1}
            precision={0}
            style={{ width: 120 }}
            onChange={(value) => {
              const parsed = Number(value || 1);
              if (!Number.isInteger(parsed) || parsed < 1) {
                quantity = 1;
                return;
              }
              quantity = Math.min(parsed, listing.quantityRemaining);
            }}
          />
          <Text style={{ color: "#6b6355" }}>/ {listing.quantityRemaining}</Text>
        </div>
      ),
      okText: "购买",
      cancelText: "取消",
      onOk: async () => {
        const finalQty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
        const res = await fetch(`/api/game/market/listings/${listing.id}/buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: finalQty }),
        });
        const json = await res.json() as { success: boolean; error?: string; data?: { message?: string } };
        if (!json.success) {
          messageApi.error(json.error || "购买失败");
          return;
        }
        messageApi.success(json.data?.message || "购买成功");
        await fetchListings();
        await fetchTrades();
      },
    });
  }, [fetchListings, fetchTrades, messageApi, modal]);

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div>;
  }

  return (
    <div style={{ padding: 8 }}>
      {contextHolder}

      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginBottom: 8,
        padding: "8px 9px",
        background: "rgba(26, 26, 46, 0.8)",
        borderRadius: 8,
        border: "1px solid #2a2520",
      }}>
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ShopOutlined style={{ color: "#c9a84c", fontSize: 16, flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.02 }}>
              <Text style={{ color: "#d7c8a2", fontSize: 12 }}>交易</Text>
              <Text style={{ color: "#f0dfb0", fontSize: 15, fontWeight: 600 }}>市场</Text>
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 999,
              border: "1px solid rgba(201, 168, 76, 0.2)",
              background: "rgba(35, 28, 16, 0.5)",
              maxWidth: "100%",
            }}
          >
            <Text style={{ color: "#9f967d", fontSize: 11, lineHeight: 1.1 }}>灵石</Text>
            <Text style={{ color: "#c9a84c", fontSize: 14, fontWeight: 600, lineHeight: 1.1 }}>
              {playerGold}
            </Text>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <DarkTag color="gold">手续费 {feePercent}%</DarkTag>
          {worldPenaltySummary?.extraFeePercent ? (
            <DarkTag color={worldPenaltySummary.level === "high" ? "red" : "orange"}>
              风声加价 +{worldPenaltySummary.extraFeePercent}%
            </DarkTag>
          ) : null}
          <DarkTag color="orange">{dailyBuyRuleText}</DarkTag>
          <DarkTag color="cyan">公示5分钟</DarkTag>
          <DarkTag color="volcano">24小时到期退回</DarkTag>
        </div>
      </div>

      {worldPenaltySummary && (
        <div style={{
          marginBottom: 8,
          padding: 8,
          background: "rgba(32, 23, 18, 0.72)",
          borderRadius: 4,
          border: "1px solid #4a3322",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}>
          <Text style={{ color: "#d9c1a0", fontSize: 12 }}>{worldPenaltySummary.summary}</Text>
          {worldPenaltySummary.hints.slice(0, 2).map((hint) => (
            <Text key={hint} style={{ color: "#b59d86", fontSize: 11 }}>{hint}</Text>
          ))}
        </div>
      )}

      <div style={{
        marginBottom: 8,
        padding: 8,
        background: "rgba(26, 26, 46, 0.8)",
        borderRadius: 4,
        border: "1px solid #2a2520",
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <Search
          allowClear
          value={keywordInput}
          placeholder="按物品名搜索"
          style={{ width: 220 }}
          onChange={(event) => setKeywordInput(event.target.value)}
          onSearch={() => {
            setPage(1);
            setKeyword(keywordInput.trim());
          }}
        />
        <Space size={6}>
          <Text style={{ color: "#a09880" }}>只看我的</Text>
          <Switch
            checked={myOnly}
            onChange={(checked) => {
              setPage(1);
              setMyOnly(checked);
            }}
          />
        </Space>
        <Button
          size="small"
          onClick={() => {
            setTradeModalOpen(true);
            void fetchTrades();
          }}
        >
          交易记录
        </Button>
        {tradeUnreadCount > 0 && <DarkTag color="red">卖出未读 {tradeUnreadCount}</DarkTag>}
        <Button size="small" onClick={() => void fetchListings()}>刷新</Button>
        <Button size="small" type="primary" onClick={() => void openCreateModal()}>
          我要上架
        </Button>
      </div>

      {list.length === 0 && (
        <Empty description={<Text style={{ color: "#6b6355" }}>暂无挂单</Text>} />
      )}

      {list.map((listing) => (
        <Card
          key={listing.id}
          size="small"
          style={{
            marginBottom: 6,
            background: "rgba(26, 26, 46, 0.9)",
            border: "1px solid #2a2520",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space size={6}>
              <span
                role="button"
                tabIndex={0}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                onClick={() => setDetailItemId(listing.itemId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setDetailItemId(listing.itemId);
                  }
                }}
              >
                <ItemBadge
                  name={listing.itemName}
                  iconUrl={listing.itemIconUrl}
                  rarity={listing.rarity}
                  iconSize={16}
                />
              </span>
              <DarkTag color={RARITY_COLORS[listing.rarity]}>{RARITY_NAMES[listing.rarity] || listing.rarity}</DarkTag>
              <DarkTag color="#6b6355">{ITEM_TYPE_NAMES[listing.itemType] || listing.itemType}</DarkTag>
              {statusToTag(listing)}
            </Space>
            <Text style={{ color: "#c9a84c", fontWeight: 600 }}>{listing.unitPrice} 灵石/件</Text>
          </div>

          <Text style={{ color: "#a09880", display: "block", marginTop: 6 }}>
            卖家：{listing.sellerName} | 剩余：{listing.quantityRemaining}/{listing.quantityTotal}
          </Text>
          <Text style={{ color: "#6b6355", display: "block", marginTop: 2, fontSize: 11 }}>
            上架时间：{formatTime(listing.createdAt)}
          </Text>
          <Text style={{ color: "#6b6355", display: "block", marginTop: 2, fontSize: 11 }}>
            公开时间：{formatTime(listing.visibleAt)} | 到期时间：{formatTime(listing.expiresAt)}
          </Text>

          <div style={{ marginTop: 8 }}>
            {listing.isMine ? (
              <Space size={8}>
                <DarkTag color="blue">我的挂单</DarkTag>
                {isListingBuffering(listing) && <DarkTag color="orange">缓冲中，不在公开列表显示</DarkTag>}
                {listing.status === "active" && (
                  <Button size="small" danger onClick={() => handleCancelListing(listing)}>
                    下架
                  </Button>
                )}
              </Space>
            ) : (
              isListingBuyable(listing) && (
                <Button size="small" type="primary" onClick={() => handleBuyListing(listing)}>
                  购买
                </Button>
              )
            )}
          </div>
        </Card>
      ))}

      {total > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Pagination
            size="small"
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={[10, 20, 50]}
            onChange={(nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            }}
          />
        </div>
      )}

      <Modal
        title="交易记录"
        open={tradeModalOpen}
        onCancel={() => setTradeModalOpen(false)}
        footer={[
          <Button
            key="refresh"
            onClick={() => void fetchTrades()}
          >
            刷新记录
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setTradeModalOpen(false)}
          >
            关闭
          </Button>,
        ]}
        width={760}
        destroyOnHidden
      >
        {tradeLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
            <Spin size="small" />
          </div>
        ) : trades.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text style={{ color: "#6b6355" }}>暂无交易记录</Text>}
          />
        ) : (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {trades.map((trade) => (
              <div
                key={trade.id}
                style={{
                  padding: 8,
                  border: "1px solid #2a2520",
                  borderRadius: 4,
                  background: "rgba(13, 13, 15, 0.4)",
                }}
              >
                <Space size={6} wrap>
                  <DarkTag color={trade.side === "sell" ? "gold" : "blue"}>
                    {trade.side === "sell" ? "卖出" : "买入"}
                  </DarkTag>
                  {trade.isSellerUnread && <DarkTag color="red">新成交</DarkTag>}
                  <span
                    role="button"
                    tabIndex={0}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    onClick={() => setDetailItemId(trade.itemId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setDetailItemId(trade.itemId);
                      }
                    }}
                  >
                    <ItemBadge
                      name={trade.itemName}
                      iconUrl={trade.itemIconUrl}
                      quantity={trade.quantity}
                      iconSize={14}
                    />
                  </span>
                </Space>
                <Text style={{ color: "#a09880", display: "block", marginTop: 4 }}>
                  对方：{trade.counterpartyName} | 单价：{trade.unitPrice} | 总额：{trade.gross}
                </Text>
                <Text style={{ color: "#6b6355", display: "block", marginTop: 2, fontSize: 11 }}>
                  {trade.side === "sell" ? `手续费 ${trade.fee}，实得 ${trade.sellerNet}` : `支出 ${trade.gross}`} | 成交时间：{formatTime(trade.createdAt)}
                </Text>
              </div>
            ))}
          </Space>
        )}
      </Modal>

      <Modal
        title="上架物品"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreateListing()}
        okText="确认上架"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Spin spinning={inventoryLoading}>
          <Form form={form} layout="vertical">
            <Text style={{ color: "#a09880", display: "block", marginBottom: 12 }}>
              上架后有 5 分钟缓冲期，期间不会在公开市场显示；每笔挂单 24 小时后到期，剩余物品会通过邮件退还。
            </Text>
            <Form.Item
              label="选择物品"
              name="itemId"
              rules={[{ required: true, message: "请选择物品" }]}
            >
              <Select
                placeholder="请选择可交易物品"
                options={inventoryOptions.map((item) => ({
                  label: (
                    <ItemBadge
                      name={item.name}
                      iconUrl={item.iconUrl}
                      rarity={item.rarity}
                      quantity={item.quantity}
                      iconSize={14}
                    />
                  ),
                  value: item.itemId,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="单价（灵石）"
              name="unitPrice"
              rules={[{ required: true, message: "请输入单价" }]}
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label="数量"
              name="quantity"
              rules={[{ required: true, message: "请输入数量" }]}
            >
              <InputNumber
                min={1}
                max={selectedItem?.quantity || 1}
                precision={0}
                style={{ width: "100%" }}
              />
            </Form.Item>
          </Form>
        </Spin>
      </Modal>

      <ItemDetailModal
        open={Boolean(detailItemId)}
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
        zIndex={1200}
      />
    </div>
  );
}
