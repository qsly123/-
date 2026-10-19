import { eq } from "drizzle-orm";
import { db } from "@/db";
import { maps, monsters, npcs, quests } from "@/db/schema";
import { getFourRealmsPack } from "@/db/offline-packs/four-realms-pack";

export type ItemSourceType = "shop" | "monster_drop" | "spiritual_field" | "quest_reward";

export interface ItemSourceEntry {
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

type ShopItemRecord = {
  itemId: string;
  price: number;
};

type MonsterDropRecord = {
  itemId: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
};

type QuestRewardItemRecord = {
  itemId: string;
  quantity: number;
};

const SOURCE_ORDER: Record<ItemSourceType, number> = {
  shop: 0,
  monster_drop: 1,
  spiritual_field: 2,
  quest_reward: 3,
};

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toShopItems(input: unknown): ShopItemRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const itemId = typeof (entry as { itemId?: unknown }).itemId === "string"
        ? (entry as { itemId: string }).itemId.trim()
        : "";
      const price = toFiniteNumber((entry as { price?: unknown }).price);
      if (!itemId || price === null) {
        return null;
      }

      return {
        itemId,
        price: Math.max(0, Math.floor(price)),
      };
    })
    .filter((entry): entry is ShopItemRecord => entry !== null);
}

function toMonsterDrops(input: unknown): MonsterDropRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const itemId = typeof (entry as { itemId?: unknown }).itemId === "string"
        ? (entry as { itemId: string }).itemId.trim()
        : "";
      const chance = toFiniteNumber((entry as { chance?: unknown }).chance);
      const minQuantity = toFiniteNumber((entry as { minQuantity?: unknown }).minQuantity);
      const maxQuantity = toFiniteNumber((entry as { maxQuantity?: unknown }).maxQuantity);
      if (!itemId || chance === null || minQuantity === null || maxQuantity === null) {
        return null;
      }

      return {
        itemId,
        chance,
        minQuantity: Math.max(0, Math.floor(minQuantity)),
        maxQuantity: Math.max(0, Math.floor(maxQuantity)),
      };
    })
    .filter((entry): entry is MonsterDropRecord => entry !== null);
}

function toQuestRewardItems(input: unknown): QuestRewardItemRecord[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }

  const rewardItems = (input as { items?: unknown }).items;
  if (!Array.isArray(rewardItems)) {
    return [];
  }

  return rewardItems
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const itemId = typeof (entry as { itemId?: unknown }).itemId === "string"
        ? (entry as { itemId: string }).itemId.trim()
        : "";
      const quantity = toFiniteNumber((entry as { quantity?: unknown }).quantity);
      if (!itemId || quantity === null) {
        return null;
      }

      return {
        itemId,
        quantity: Math.max(0, Math.floor(quantity)),
      };
    })
    .filter((entry): entry is QuestRewardItemRecord => entry !== null);
}

function buildDedupeKey(entry: ItemSourceEntry) {
  return [
    entry.type,
    entry.sourceName,
    entry.mapName || "",
    entry.price ?? "",
    entry.chance ?? "",
    entry.minQuantity ?? "",
    entry.maxQuantity ?? "",
    entry.quantity ?? "",
  ].join("|");
}

function compareSources(left: ItemSourceEntry, right: ItemSourceEntry) {
  const typeOrder = SOURCE_ORDER[left.type] - SOURCE_ORDER[right.type];
  if (typeOrder !== 0) {
    return typeOrder;
  }

  const nameOrder = left.sourceName.localeCompare(right.sourceName, "zh-CN");
  if (nameOrder !== 0) {
    return nameOrder;
  }

  return (left.mapName || "").localeCompare(right.mapName || "", "zh-CN");
}

export async function getItemSources(itemId: string): Promise<ItemSourceEntry[]> {
  const targetItemId = itemId.trim();
  if (!targetItemId) {
    return [];
  }

  const [shopRows, monsterRows, questRows] = await Promise.all([
    db.select({
      npcId: npcs.id,
      npcName: npcs.name,
      mapName: maps.name,
      shopItems: npcs.shopItems,
    })
      .from(npcs)
      .leftJoin(maps, eq(npcs.mapId, maps.id))
      .where(eq(npcs.isShop, true))
      .all(),
    db.select({
      monsterId: monsters.id,
      monsterName: monsters.name,
      mapName: maps.name,
      drops: monsters.drops,
    })
      .from(monsters)
      .leftJoin(maps, eq(monsters.mapId, maps.id))
      .all(),
    db.select({
      questId: quests.id,
      questName: quests.name,
      rewards: quests.rewards,
    })
      .from(quests)
      .all(),
  ]);

  const sources: ItemSourceEntry[] = [];
  const dedupe = new Set<string>();

  for (const row of shopRows) {
    const matched = toShopItems(row.shopItems).filter((entry) => entry.itemId === targetItemId);
    for (const entry of matched) {
      const source: ItemSourceEntry = {
        type: "shop",
        itemId: targetItemId,
        label: "商店售卖",
        sourceName: row.npcName,
        mapName: row.mapName || null,
        npcName: row.npcName,
        price: entry.price,
      };
      const key = buildDedupeKey(source);
      if (!dedupe.has(key)) {
        dedupe.add(key);
        sources.push(source);
      }
    }
  }

  for (const row of monsterRows) {
    const matched = toMonsterDrops(row.drops).filter((entry) => entry.itemId === targetItemId);
    for (const entry of matched) {
      const source: ItemSourceEntry = {
        type: "monster_drop",
        itemId: targetItemId,
        label: "怪物掉落",
        sourceName: row.monsterName,
        mapName: row.mapName || null,
        monsterName: row.monsterName,
        chance: entry.chance,
        minQuantity: entry.minQuantity,
        maxQuantity: entry.maxQuantity,
      };
      const key = buildDedupeKey(source);
      if (!dedupe.has(key)) {
        dedupe.add(key);
        sources.push(source);
      }
    }
  }

  // 灵田：种子 → 产物的映射在离线包里（plugin_spiritual_field_seeds 要进了灵田页才会建，不能依赖它）
  for (const seed of getFourRealmsPack().spiritualFieldSeeds) {
    if (seed.enabled === false) {
      continue;
    }

    const isOutput = seed.outputItemId === targetItemId;
    const isSeed = seed.seedItemId === targetItemId;
    if (!isOutput && !isSeed) {
      continue;
    }

    const source: ItemSourceEntry = {
      type: "spiritual_field",
      itemId: targetItemId,
      label: isOutput ? "灵田种植" : "灵田灵种",
      sourceName: isOutput ? `洞府灵田 · ${seed.name}` : `种下可得 ${seed.name}`,
      minQuantity: seed.minYield,
      maxQuantity: seed.maxYield,
    };
    const key = buildDedupeKey(source);
    if (!dedupe.has(key)) {
      dedupe.add(key);
      sources.push(source);
    }
  }

  for (const row of questRows) {
    const matched = toQuestRewardItems(row.rewards).filter((entry) => entry.itemId === targetItemId);
    for (const entry of matched) {
      const source: ItemSourceEntry = {
        type: "quest_reward",
        itemId: targetItemId,
        label: "任务奖励",
        sourceName: row.questName,
        questName: row.questName,
        quantity: entry.quantity,
      };
      const key = buildDedupeKey(source);
      if (!dedupe.has(key)) {
        dedupe.add(key);
        sources.push(source);
      }
    }
  }

  return sources.sort(compareSources);
}
