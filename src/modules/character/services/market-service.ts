import { and, asc, eq, lte, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { items, marketListings, playerMails, players, worldNpcProfiles } from "@/db/schema";
import { ensureMarketListingSchema } from "@/modules/character/services/market-schema";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import { getCachedOpenWorldAiKeywordPool, warmOpenWorldAiKeywordPool } from "@/modules/world/services/world-config";

export const MARKET_FEE_PERCENT_KEY = "MARKET_FEE_PERCENT";
export const DEFAULT_MARKET_FEE_PERCENT = 5;
export const MARKET_DAILY_BUY_LIMIT = 10;
export const MARKET_DAILY_BUY_RULE_TEXT = "限购10次";
export const MARKET_INT_MAX = 2147483647;
export const MARKET_LISTING_BUFFER_MS = 5 * 60 * 1000;
export const MARKET_LISTING_TTL_MS = 24 * 60 * 60 * 1000;

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const EXPIRED_MARKET_LISTING_BATCH_LIMIT = 100;
const NPC_MARKET_SWEEP_INTERVAL_MS = 90 * 1000;
const NPC_MARKET_BATCH_LIMIT = 6;
const NPC_MARKET_GUARANTEED_BUY_MS = 30 * 60 * 1000;
const NPC_MARKET_DISCOUNT_TIER_2_MS = 2 * 60 * 60 * 1000;
const NPC_MARKET_DISCOUNT_TIER_3_MS = 6 * 60 * 60 * 1000;
const NPC_MARKET_DISCOUNT_TIER_4_MS = 12 * 60 * 60 * 1000;

type NpcMarketBuyerSnapshot = {
  name: string;
  profession: string;
};

type NpcMarketPurchaseResult = {
  processedCount: number;
  listingIds: number[];
};

type NpcMarketSweepGlobalStore = typeof globalThis & {
  __immortalityNpcMarketSweepReadyUntil?: number;
  __immortalityNpcMarketSweepPromise?: Promise<NpcMarketPurchaseResult>;
};

export interface MarketListingSchedule {
  createdAt: string;
  visibleAt: string;
  expiresAt: string;
}

export interface ProcessExpiredMarketListingsParams {
  listingId?: number;
  sellerPlayerId?: string;
  now?: Date;
  limit?: number;
}

export interface ProcessExpiredMarketListingsResult {
  processedCount: number;
  listingIds: number[];
}

export function parsePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MARKET_INT_MAX) {
    return null;
  }
  return Math.floor(parsed);
}

export function parseMarketFeePercent(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MARKET_FEE_PERCENT;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 100) {
    return 100;
  }
  return parsed;
}

export async function getMarketFeePercent() {
  const raw = await getSystemConfigValue(MARKET_FEE_PERCENT_KEY);
  return parseMarketFeePercent(raw);
}

export function buildMarketListingSchedule(createdAt = new Date()): MarketListingSchedule {
  const createdAtIso = createdAt.toISOString();
  return {
    createdAt: createdAtIso,
    visibleAt: new Date(createdAt.getTime() + MARKET_LISTING_BUFFER_MS).toISOString(),
    expiresAt: new Date(createdAt.getTime() + MARKET_LISTING_TTL_MS).toISOString(),
  };
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function getNpcMarketSweepGlobalStore() {
  return globalThis as NpcMarketSweepGlobalStore;
}

function normalizeNpcBuyerLabel(snapshot: NpcMarketBuyerSnapshot | null, seed: string) {
  const keywordPool = getCachedOpenWorldAiKeywordPool();
  const buyerTitlePool = keywordPool.marketBuyerTitles;
  const fallbackTitle = buyerTitlePool[hashSeed(`${seed}:title`) % Math.max(1, buyerTitlePool.length)] || "行脚商";
  const buyerName = String(snapshot?.name || "").trim();
  const buyerProfession = String(snapshot?.profession || "").trim() || fallbackTitle;
  return buyerName ? `${buyerProfession}${buyerName}` : `一名${fallbackTitle}`;
}

function isNpcMarketBlockedItem(params: {
  itemId: string;
  itemType: string | null;
  sourceType: string | null;
}) {
  const itemId = String(params.itemId || "").trim();
  const itemType = String(params.itemType || "").trim().toLowerCase();
  const sourceType = String(params.sourceType || "").trim().toLowerCase();
  if (!itemId) {
    return true;
  }
  if (sourceType) {
    return true;
  }
  if (itemId.startsWith("item_ai_") || itemId.startsWith("item_sf_") || itemId.startsWith("item_hongmeng_")) {
    return true;
  }
  if (itemType.includes("quest") || itemType.includes("hongmeng") || itemType.includes("treasure")) {
    return true;
  }
  return false;
}

function resolveNpcMarketDemandRule(params: {
  unitPrice: number;
  referencePrice: number;
  createdAt: string;
  itemType: string | null;
  now: Date;
}) {
  const referencePrice = Math.max(0, Math.floor(params.referencePrice));
  const unitPrice = Math.max(0, Math.floor(params.unitPrice));
  if (referencePrice <= 0 || unitPrice <= 0) {
    return null;
  }

  const listedAtMs = Date.parse(params.createdAt);
  if (!Number.isFinite(listedAtMs)) {
    return null;
  }

  const itemType = String(params.itemType || "").trim().toLowerCase();
  const listedDurationMs = params.now.getTime() - listedAtMs;
  const ratio = unitPrice / referencePrice;
  const isDailyGoods = itemType.includes("material")
    || itemType.includes("seed")
    || itemType.includes("consumable")
    || itemType.includes("herb");

  if (listedDurationMs >= NPC_MARKET_GUARANTEED_BUY_MS && ratio <= 0.1) {
    return { chance: 1, tierLabel: "抄底收走" };
  }
  if (listedDurationMs >= NPC_MARKET_DISCOUNT_TIER_2_MS && ratio <= 0.25) {
    return { chance: 0.65, tierLabel: "低价抢收" };
  }
  if (listedDurationMs >= NPC_MARKET_DISCOUNT_TIER_3_MS && ratio <= 0.4) {
    return { chance: 0.35, tierLabel: "顺手捡漏" };
  }
  if (isDailyGoods && listedDurationMs >= NPC_MARKET_DISCOUNT_TIER_4_MS && ratio <= 0.6) {
    return { chance: 0.12, tierLabel: "补货带走" };
  }
  return null;
}

async function listNpcMarketBuyerSnapshots() {
  await warmOpenWorldAiKeywordPool();
  const rows = await db.select({
    name: worldNpcProfiles.name,
    profession: worldNpcProfiles.profession,
  }).from(worldNpcProfiles)
    .where(eq(worldNpcProfiles.status, "active"))
    .limit(24)
    .all();
  return rows
    .map((row) => ({
      name: String(row.name || "").trim(),
      profession: String(row.profession || "").trim() || "行脚商",
    }))
    .filter((row) => row.name || row.profession);
}

function getShanghaiDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";

  return {
    dateKey: `${year}-${month}-${day}`,
  };
}

export function getMarketDailyBuyWindow(date = new Date()) {
  const { dateKey } = getShanghaiDateParts(date);
  const startAt = new Date(`${dateKey}T00:00:00+08:00`);
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);

  return {
    dateKey,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  };
}

export async function processExpiredMarketListings(
  params: ProcessExpiredMarketListingsParams = {},
): Promise<ProcessExpiredMarketListingsResult> {
  if (!(await ensureMarketListingSchema())) {
    return {
      processedCount: 0,
      listingIds: [],
    };
  }

  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(params.limit ?? EXPIRED_MARKET_LISTING_BATCH_LIMIT, 200));
  const conditions: SQLWrapper[] = [
    eq(marketListings.status, "active"),
    lte(marketListings.expiresAt, nowIso),
  ];

  if (params.listingId) {
    conditions.push(eq(marketListings.id, params.listingId));
  }
  if (params.sellerPlayerId) {
    conditions.push(eq(marketListings.sellerPlayerId, params.sellerPlayerId));
  }

  const candidates = await db.select({
    id: marketListings.id,
  })
    .from(marketListings)
    .where(and(...conditions))
    .orderBy(asc(marketListings.expiresAt), asc(marketListings.id))
    .limit(limit)
    .all();

  const listingIds: number[] = [];
  for (const candidate of candidates) {
    const processed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${candidate.id})`);

      const listing = await tx.select({
        id: marketListings.id,
        sellerPlayerId: marketListings.sellerPlayerId,
        itemId: marketListings.itemId,
        itemName: items.name,
        quantityRemaining: marketListings.quantityRemaining,
        status: marketListings.status,
        expiresAt: marketListings.expiresAt,
      })
        .from(marketListings)
        .innerJoin(items, eq(marketListings.itemId, items.id))
        .where(eq(marketListings.id, candidate.id))
        .get();

      if (!listing || listing.status !== "active" || listing.expiresAt > nowIso) {
        return null;
      }

      await tx.update(marketListings)
        .set({
          status: "expired",
          updatedAt: nowIso,
        })
        .where(eq(marketListings.id, listing.id))
        .run();

      const quantityRemaining = Math.max(0, listing.quantityRemaining);
      if (quantityRemaining > 0) {
        await tx.insert(playerMails).values({
          playerId: listing.sellerPlayerId,
          title: "交易市场挂单到期退还",
          content: `你在交易市场上架的${listing.itemName}已超过24小时未售出，剩余${quantityRemaining}件已通过邮件退还，请及时查收。`,
          reward: {
            items: [
              {
                itemId: listing.itemId,
                quantity: quantityRemaining,
              },
            ],
          },
          createdAt: nowIso,
        }).run();
      }

      return listing.id;
    });

    if (processed) {
      listingIds.push(processed);
    }
  }

  return {
    processedCount: listingIds.length,
    listingIds,
  };
}

export async function processNpcMarketPurchases(params?: {
  now?: Date;
  limit?: number;
  force?: boolean;
}): Promise<NpcMarketPurchaseResult> {
  if (!(await ensureMarketListingSchema())) {
    return {
      processedCount: 0,
      listingIds: [],
    };
  }

  const globalStore = getNpcMarketSweepGlobalStore();
  const now = params?.now || new Date();
  const limit = Math.max(1, Math.min(params?.limit ?? NPC_MARKET_BATCH_LIMIT, 20));
  if (!params?.force) {
    if (globalStore.__immortalityNpcMarketSweepPromise) {
      return await globalStore.__immortalityNpcMarketSweepPromise;
    }
    if ((globalStore.__immortalityNpcMarketSweepReadyUntil || 0) > now.getTime()) {
      return {
        processedCount: 0,
        listingIds: [],
      };
    }
  }

  const runner = (async () => {
    const nowIso = now.toISOString();
    const buyerSnapshots = await listNpcMarketBuyerSnapshots();
    const candidates = await db.select({
      id: marketListings.id,
      sellerPlayerId: marketListings.sellerPlayerId,
      itemId: marketListings.itemId,
      unitPrice: marketListings.unitPrice,
      quantityRemaining: marketListings.quantityRemaining,
      status: marketListings.status,
      visibleAt: marketListings.visibleAt,
      expiresAt: marketListings.expiresAt,
      createdAt: marketListings.createdAt,
      itemName: items.name,
      itemType: items.itemType,
      itemPrice: items.price,
      itemBound: items.isBound,
      itemSourceType: items.sourceType,
    })
      .from(marketListings)
      .innerJoin(items, eq(items.id, marketListings.itemId))
      .where(and(
        eq(marketListings.status, "active"),
        lte(marketListings.visibleAt, nowIso),
      ))
      .orderBy(asc(marketListings.createdAt), asc(marketListings.id))
      .limit(limit * 8)
      .all();

    const processedListingIds: number[] = [];
    for (const candidate of candidates) {
      if (processedListingIds.length >= limit) {
        break;
      }
      if (
        candidate.status !== "active"
        || candidate.visibleAt > nowIso
        || candidate.expiresAt <= nowIso
        || candidate.quantityRemaining <= 0
        || candidate.itemBound
        || isNpcMarketBlockedItem({
          itemId: candidate.itemId,
          itemType: candidate.itemType,
          sourceType: candidate.itemSourceType,
        })
      ) {
        continue;
      }

      const rule = resolveNpcMarketDemandRule({
        unitPrice: candidate.unitPrice,
        referencePrice: candidate.itemPrice,
        createdAt: candidate.createdAt,
        itemType: candidate.itemType,
        now,
      });
      if (!rule) {
        continue;
      }

      const roll = (hashSeed(`npc-market:${candidate.id}:${Math.floor(now.getTime() / NPC_MARKET_SWEEP_INTERVAL_MS)}`) % 100) / 100;
      if (roll > rule.chance) {
        continue;
      }

      const processedId = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${candidate.id})`);

        const latest = await tx.select({
          id: marketListings.id,
          sellerPlayerId: marketListings.sellerPlayerId,
          itemId: marketListings.itemId,
          unitPrice: marketListings.unitPrice,
          quantityRemaining: marketListings.quantityRemaining,
          status: marketListings.status,
          visibleAt: marketListings.visibleAt,
          expiresAt: marketListings.expiresAt,
          createdAt: marketListings.createdAt,
          itemName: items.name,
          itemType: items.itemType,
          itemPrice: items.price,
          itemBound: items.isBound,
          itemSourceType: items.sourceType,
          sellerGold: players.gold,
        })
          .from(marketListings)
          .innerJoin(items, eq(items.id, marketListings.itemId))
          .innerJoin(players, eq(players.id, marketListings.sellerPlayerId))
          .where(eq(marketListings.id, candidate.id))
          .get();

        if (
          !latest
          || latest.status !== "active"
          || latest.visibleAt > nowIso
          || latest.expiresAt <= nowIso
          || latest.quantityRemaining <= 0
          || latest.itemBound
          || isNpcMarketBlockedItem({
            itemId: latest.itemId,
            itemType: latest.itemType,
            sourceType: latest.itemSourceType,
          })
        ) {
          return null;
        }

        const latestRule = resolveNpcMarketDemandRule({
          unitPrice: latest.unitPrice,
          referencePrice: latest.itemPrice,
          createdAt: latest.createdAt,
          itemType: latest.itemType,
          now,
        });
        if (!latestRule) {
          return null;
        }

        const trade = calcMarketTradeAmounts(latest.unitPrice, latest.quantityRemaining, await getMarketFeePercent());
        const buyerLabel = normalizeNpcBuyerLabel(
          buyerSnapshots.length > 0
            ? buyerSnapshots[hashSeed(`npc-market:${latest.id}:buyer`) % buyerSnapshots.length] || null
            : null,
          `npc-market:${latest.id}`,
        );

        await tx.update(players).set({
          gold: latest.sellerGold + trade.sellerNet,
          updatedAt: nowIso,
        }).where(eq(players.id, latest.sellerPlayerId)).run();

        await tx.update(marketListings).set({
          quantityRemaining: 0,
          status: "sold_out",
          updatedAt: nowIso,
        }).where(eq(marketListings.id, latest.id)).run();

        await tx.insert(playerMails).values({
          playerId: latest.sellerPlayerId,
          title: "坊间有人低价收走了你的货物",
          content: `${buyerLabel}见你挂出的${latest.itemName}价位极低，以“${latestRule.tierLabel}”的名义整单买走。你已到手${trade.sellerNet}灵石，市场抽成${trade.fee}灵石。`,
          createdAt: nowIso,
        }).run();

        return latest.id;
      });

      if (processedId) {
        processedListingIds.push(processedId);
      }
    }

    return {
      processedCount: processedListingIds.length,
      listingIds: processedListingIds,
    };
  })();

  globalStore.__immortalityNpcMarketSweepPromise = runner;
  try {
    const result = await runner;
    globalStore.__immortalityNpcMarketSweepReadyUntil = now.getTime() + NPC_MARKET_SWEEP_INTERVAL_MS;
    return result;
  } finally {
    if (globalStore.__immortalityNpcMarketSweepPromise === runner) {
      globalStore.__immortalityNpcMarketSweepPromise = undefined;
    }
  }
}

export function calcMarketTradeAmounts(unitPrice: number, quantity: number, feePercent: number) {
  const gross = unitPrice * quantity;
  const fee = Math.floor(gross * (feePercent / 100));
  const sellerNet = gross - fee;
  return {
    gross,
    fee,
    sellerNet,
  };
}
