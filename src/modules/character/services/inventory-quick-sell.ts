import { ITEM_TYPES, RARITIES } from "@/modules/shared/constants";

export type QuickSellFilterState = {
  itemTypes?: string[];
  rarities?: string[];
};

export type QuickSellInventoryItem = {
  itemId: string;
  quantity: number;
  equipped?: boolean;
  itemType?: string | null;
  rarity?: string | null;
  price?: number | null;
  isHongmengTreasure?: boolean;
};

export type QuickSellPreviewEntry<TItem extends QuickSellInventoryItem = QuickSellInventoryItem> = {
  item: TItem;
  unitSellPrice: number;
  totalSellPrice: number;
};

export type QuickSellPreviewResult<TItem extends QuickSellInventoryItem = QuickSellInventoryItem> = {
  entries: QuickSellPreviewEntry<TItem>[];
  soldStackCount: number;
  soldItemCount: number;
  goldGained: number;
};

const QUICK_SELL_RATE = 0.3;

const QUICK_SELL_ITEM_TYPE_SET = new Set<string>(
  ITEM_TYPES.filter((itemType) => itemType !== "quest"),
);

const QUICK_SELL_RARITY_SET = new Set<string>(
  RARITIES.filter((rarity) => rarity !== "hongmeng"),
);

export const QUICK_SELL_ITEM_TYPES = Array.from(QUICK_SELL_ITEM_TYPE_SET);
export const QUICK_SELL_RARITIES = Array.from(QUICK_SELL_RARITY_SET);

function uniqueValidValues(values: string[] | undefined, validSet: Set<string>) {
  const result: string[] = [];
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized || !validSet.has(normalized) || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
  }
  return result;
}

export function normalizeQuickSellFilters(filters?: QuickSellFilterState | null) {
  return {
    itemTypes: uniqueValidValues(filters?.itemTypes, QUICK_SELL_ITEM_TYPE_SET),
    rarities: uniqueValidValues(filters?.rarities, QUICK_SELL_RARITY_SET),
  };
}

export function hasActiveQuickSellFilters(filters?: QuickSellFilterState | null) {
  const normalized = normalizeQuickSellFilters(filters);
  return normalized.itemTypes.length > 0 || normalized.rarities.length > 0;
}

export function resolveQuickSellUnitPrice(price: number | null | undefined) {
  const normalizedPrice = Math.max(0, Math.floor(Number(price) || 0));
  if (normalizedPrice < 3) {
    return 0;
  }
  return Math.max(1, Math.floor(normalizedPrice * QUICK_SELL_RATE));
}

export function isQuickSellEligibleItem(item: QuickSellInventoryItem) {
  const itemType = String(item.itemType || "").trim();
  if (!item.itemId || Math.floor(Number(item.quantity) || 0) <= 0) {
    return false;
  }
  if (item.equipped) {
    return false;
  }
  if (item.isHongmengTreasure) {
    return false;
  }
  if (itemType === "quest") {
    return false;
  }
  if (!QUICK_SELL_ITEM_TYPE_SET.has(itemType)) {
    return false;
  }
  if (resolveQuickSellUnitPrice(item.price) < 1) {
    return false;
  }
  return true;
}

export function matchesQuickSellFilters(item: QuickSellInventoryItem, filters?: QuickSellFilterState | null) {
  const normalized = normalizeQuickSellFilters(filters);
  if (normalized.itemTypes.length === 0 && normalized.rarities.length === 0) {
    return false;
  }

  const itemType = String(item.itemType || "").trim();
  const rarity = String(item.rarity || "").trim();
  const matchesItemType = normalized.itemTypes.length === 0 || normalized.itemTypes.includes(itemType);
  const matchesRarity = normalized.rarities.length === 0 || normalized.rarities.includes(rarity);

  return matchesItemType && matchesRarity;
}

export function buildQuickSellPreview<TItem extends QuickSellInventoryItem>(
  items: TItem[],
  filters?: QuickSellFilterState | null,
): QuickSellPreviewResult<TItem> {
  const entries = items
    .filter((item) => isQuickSellEligibleItem(item) && matchesQuickSellFilters(item, filters))
    .map((item) => {
      const unitSellPrice = resolveQuickSellUnitPrice(item.price);
      return {
        item,
        unitSellPrice,
        totalSellPrice: unitSellPrice * Math.max(0, Math.floor(Number(item.quantity) || 0)),
      };
    });

  return {
    entries,
    soldStackCount: entries.length,
    soldItemCount: entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(Number(entry.item.quantity) || 0)), 0),
    goldGained: entries.reduce((sum, entry) => sum + entry.totalSellPrice, 0),
  };
}
