"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StateRefreshSignal } from "@/modules/shared/ui/hooks/useStateRefreshFrames";

/**
 * 战斗页丹药列表 + 背包刷新帧联动。
 *
 * 丹药 command 走的是统一 Colyseus command，服务端只回 ACK 是不够的：
 * 服务端会在库存真实扣减后下发 inventory_refresh(10302)。本 hook 订阅该帧，
 * 立即在界面上扣减对应丹药数量，再以服务端库存为准做一次回填，
 * 保证"用完丹药后背包数字即时变化"，且断线重连补齐后不会回退到旧值。
 */

export interface CombatConsumableItem {
  itemId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
}

type InventoryApiEffect = {
  type?: string;
  value?: number;
};

type InventoryApiItem = {
  itemId?: string;
  name?: string;
  iconUrl?: string | null;
  quantity?: number;
  itemType?: string;
  effects?: InventoryApiEffect[];
};

type InventoryApiResponse = {
  success?: boolean;
  data?: {
    items?: InventoryApiItem[];
  };
};

function hasCombatRecoveryEffect(item: InventoryApiItem) {
  return (item.effects || []).some((effect) => (
    (effect.type === "heal_hp" || effect.type === "heal_mp")
    && Number(effect.value || 0) > 0
  ));
}

function toCombatConsumables(items: InventoryApiItem[]): CombatConsumableItem[] {
  return items
    .filter((item) => item.itemId
      && Number(item.quantity || 0) > 0
      && item.itemType === "consumable"
      && hasCombatRecoveryEffect(item))
    .map((item) => ({
      itemId: String(item.itemId),
      name: String(item.name || item.itemId),
      iconUrl: typeof item.iconUrl === "string" ? item.iconUrl : null,
      quantity: Number(item.quantity || 0),
    }));
}

/** 把最近一次背包同步时间渲染成可见提示，避免出现"只打日志"的隐式刷新。 */
export function formatInventorySyncHint(lastRefreshedAt: number) {
  if (!lastRefreshedAt) {
    return "左右滑动";
  }
  const refreshedAt = new Date(lastRefreshedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `背包已同步 ${pad(refreshedAt.getHours())}:${pad(refreshedAt.getMinutes())}:${pad(refreshedAt.getSeconds())}`;
}

export function useCombatConsumableInventory(params: {
  inventoryVersion: number;
  inventorySignal?: StateRefreshSignal | null;
  enabled?: boolean;
}) {
  const { inventoryVersion, inventorySignal, enabled = true } = params;
  const [consumables, setConsumables] = useState<CombatConsumableItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(0);
  const knownVersionRef = useRef(0);
  const requestRef = useRef(0);

  const refreshConsumables = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setRefreshing(true);
    try {
      const response = await fetch("/api/game/inventory", { cache: "no-store" });
      const json = await response.json() as InventoryApiResponse;
      if (requestId !== requestRef.current) {
        return;
      }
      if (!json.success) {
        return;
      }
      const items = Array.isArray(json.data?.items) ? json.data.items : [];
      setConsumables(toCombatConsumables(items));
      setLastRefreshedAt(Date.now());
    } catch {
      // 拉取失败保持上一次可见值，等待下一次刷新帧触发重试。
    } finally {
      if (requestId === requestRef.current) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refreshConsumables();
  }, [enabled, refreshConsumables]);

  useEffect(() => {
    if (!enabled || inventoryVersion <= 0) {
      return;
    }
    if (inventoryVersion <= knownVersionRef.current) {
      return;
    }
    knownVersionRef.current = inventoryVersion;

    // 收到背包刷新帧：先用 changedItemIds 做即时扣减，保证肉眼可见的数量变化。
    const changedItemIds = new Set(inventorySignal?.changedItemIds || []);
    if (changedItemIds.size > 0) {
      setConsumables((current) => current
        .map((item) => (changedItemIds.has(item.itemId)
          ? { ...item, quantity: Math.max(0, item.quantity - 1) }
          : item))
        .filter((item) => item.quantity > 0));
    }
    setLastRefreshedAt(Date.now());
    // 再以服务端库存为准回填，避免本地乐观值与真实库存长期不一致。
    void refreshConsumables();
  }, [enabled, inventorySignal, inventoryVersion, refreshConsumables]);

  /** HTTP 兜底链路没有刷新帧时，由页面在 command 成功后调用，保持同一套 UI 行为。 */
  const applyConsumedItem = useCallback((itemId: string) => {
    setConsumables((current) => current
      .map((item) => (item.itemId === itemId
        ? { ...item, quantity: Math.max(0, item.quantity - 1) }
        : item))
      .filter((item) => item.quantity > 0));
    void refreshConsumables();
  }, [refreshConsumables]);

  return {
    consumables,
    refreshing,
    lastRefreshedAt,
    refreshConsumables,
    applyConsumedItem,
  };
}
