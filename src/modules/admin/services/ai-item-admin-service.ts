import { and, count, desc, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import {
  cdkCodes,
  checkinRewardRules,
  hongmengTreasureConfigs,
  items,
  marketListings,
  marketTradeRecords,
  playerHongmengTreasures,
  playerInventory,
  playerMails,
  playerSkills,
  playerTemporaryCosmeticGrants,
  playerUnlockedAvatarFrames,
  playerUnlockedAvatars,
  sectStorageItems,
  skills,
  worldNpcInventory,
} from "@/db/schema";
import { parsePage, parsePageSize } from "@/modules/admin/api/admin/[entity]/route-helpers";

export const AI_ITEM_SOURCE_TYPES = ["secret_realm", "ai_smithing", "ai_alchemy", "spiritual_field_quality_upgrade"] as const;
export const AI_ITEM_CLEANUP_STATES = ["candidate", "protected", "legacy_unknown"] as const;
export const LEGACY_AI_ALCHEMY_ID_PREFIX = "item_ai_alchemy_";
export const LEGACY_AI_SMITHING_ID_PREFIX = "item_ai_smithing_";
export const SECRET_REALM_ITEM_ID_PREFIX = "item_secret_realm_";
export const SPIRITUAL_FIELD_QUALITY_ITEM_ID_PREFIX = "item_sf_quality_";
const BACKFILL_THROTTLE_MS = 5 * 60 * 1000;
const REFERENCE_QUERY_CHUNK_SIZE = 200;
const DEFAULT_CLEANUP_MIN_AGE_HOURS = 6;
const DEFAULT_CLEANUP_DELETE_LIMIT = 500;

const AI_ITEM_ID_PREFIX_TO_SOURCE_TYPE = [
  {
    prefix: LEGACY_AI_ALCHEMY_ID_PREFIX,
    sourceType: "ai_alchemy",
  },
  {
    prefix: LEGACY_AI_SMITHING_ID_PREFIX,
    sourceType: "ai_smithing",
  },
  {
    prefix: SECRET_REALM_ITEM_ID_PREFIX,
    sourceType: "secret_realm",
  },
  {
    prefix: SPIRITUAL_FIELD_QUALITY_ITEM_ID_PREFIX,
    sourceType: "spiritual_field_quality_upgrade",
  },
] as const;

export type AiItemCleanupState = (typeof AI_ITEM_CLEANUP_STATES)[number];

type CleanupStatsGlobal = typeof globalThis & {
  __immortalityAiItemBackfillPromise?: Promise<number> | null;
  __immortalityAiItemBackfillLastRunAt?: number;
};

export type AiItemAdminRow = typeof items.$inferSelect & {
  cleanupState: AiItemCleanupState;
  referenceCount: number;
  referenceSummary: string[];
};

export type AiItemAdminSummary = {
  totalAiItems: number;
  todayCreatedCount: number;
  reclaimableCount: number;
  bySource: Record<string, number>;
  byRarity: Record<string, number>;
  byCleanupState: Record<AiItemCleanupState, number>;
};

export type AiItemCleanupPreview = {
  totalMatched: number;
  candidateCount: number;
  protectedCount: number;
  legacyUnknownCount: number;
  sourceBreakdown: Record<string, number>;
  rarityBreakdown: Record<string, number>;
  topFrequencyBuckets: Array<{
    bucket: string;
    count: number;
  }>;
};

export type AiItemCleanupExecuteResult = AiItemCleanupPreview & {
  deletedCount: number;
  deletedIds: string[];
};

type AiItemReferenceSummary = {
  total: number;
  labels: string[];
};

type RewardLikeItem = {
  itemId?: unknown;
};

type RewardLikePayload = {
  items?: RewardLikeItem[] | null;
};

type CleanupFilterInput = {
  sourceType?: string | null;
  rarity?: string | null;
  minAgeHours?: number | null;
  deleteLimit?: number | null;
};

type AiItemAdminListResult = {
  list: AiItemAdminRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  meta: {
    stats: AiItemAdminSummary;
  };
};

function normalizeTextFilter(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function normalizePositiveInteger(value: string | number | null | undefined, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function resolveAiSourceTypeByItemId(itemId: string | null | undefined) {
  const normalized = String(itemId || "").trim();
  for (const item of AI_ITEM_ID_PREFIX_TO_SOURCE_TYPE) {
    if (normalized.startsWith(item.prefix)) {
      return item.sourceType;
    }
  }
  return null;
}

function isLegacyUnknownAiItem(row: typeof items.$inferSelect) {
  const sourceType = String(row.sourceType || "").trim();
  return !sourceType && !!resolveAiSourceTypeByItemId(row.id);
}

export function buildAiItemsCondition(): SQLWrapper {
  return or(
    inArray(items.sourceType, [...AI_ITEM_SOURCE_TYPES]),
    ...AI_ITEM_ID_PREFIX_TO_SOURCE_TYPE.map((item) => like(items.id, `${item.prefix}%`)),
  ) as SQLWrapper;
}

export function buildFormalItemsCondition(): SQLWrapper {
  const sourceTypeList = sql.join(
    AI_ITEM_SOURCE_TYPES.map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`
    ${and(
      ...AI_ITEM_ID_PREFIX_TO_SOURCE_TYPE.map((item) => sql`${items.id} not like ${`${item.prefix}%`}`),
    )}
    and coalesce(nullif(btrim(${items.sourceType}), ''), '__formal__') not in (${sourceTypeList})
  `;
}

function buildSourceTypeFilter(sourceType?: string | null): SQLWrapper | undefined {
  const normalized = normalizeTextFilter(sourceType);
  if (!normalized) {
    return undefined;
  }
  if (normalized === "legacy_ai_alchemy") {
    return and(
      like(items.id, `${LEGACY_AI_ALCHEMY_ID_PREFIX}%`),
      or(
        sql`${items.sourceType} is null`,
        sql`btrim(${items.sourceType}) = ''`,
      ),
    ) as SQLWrapper;
  }
  if (normalized === "legacy_ai_smithing") {
    return and(
      like(items.id, `${LEGACY_AI_SMITHING_ID_PREFIX}%`),
      or(
        sql`${items.sourceType} is null`,
        sql`btrim(${items.sourceType}) = ''`,
      ),
    ) as SQLWrapper;
  }
  if ((AI_ITEM_SOURCE_TYPES as readonly string[]).includes(normalized)) {
    return eq(items.sourceType, normalized);
  }
  return undefined;
}

function buildAiItemKeywordCondition(keyword: string): SQLWrapper | undefined {
  const normalized = keyword.trim();
  if (!normalized) {
    return undefined;
  }
  return or(
    like(items.id, `%${normalized}%`),
    like(items.name, `%${normalized}%`),
    like(items.description, `%${normalized}%`),
    like(items.itemType, `%${normalized}%`),
    like(items.rarity, `%${normalized}%`),
    like(items.sourceType, `%${normalized}%`),
    like(items.sourceCategory, `%${normalized}%`),
    like(items.generatedSeed, `%${normalized}%`),
  ) as SQLWrapper;
}

function parseCreatedAtMs(createdAt: string | null | undefined) {
  if (!createdAt) {
    return 0;
  }
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCleanupState(row: typeof items.$inferSelect, referenceSummary: AiItemReferenceSummary): AiItemCleanupState {
  if (referenceSummary.total > 0) {
    return "protected";
  }
  if (isLegacyUnknownAiItem(row)) {
    return "legacy_unknown";
  }
  return "candidate";
}

function buildFrequencyBucket(row: typeof items.$inferSelect) {
  const sourceType = String(row.sourceType || resolveAiSourceTypeByItemId(row.id) || "unknown").trim() || "unknown";
  const sourceMeta = row.sourceMeta && typeof row.sourceMeta === "object"
    ? row.sourceMeta as Record<string, unknown>
    : null;
  const route = typeof sourceMeta?.route === "string" ? sourceMeta.route.trim() : "";
  const element = typeof sourceMeta?.element === "string" ? sourceMeta.element.trim() : "";
  return [
    sourceType,
    String(row.itemType || ""),
    String(row.rarity || ""),
    String(row.sourceCategory || ""),
    route,
    element,
  ].join("|");
}

function mergeCountRowMap(target: Map<string, number>, rows: Array<{ itemId: string; count: number }>) {
  for (const row of rows) {
    target.set(row.itemId, (target.get(row.itemId) || 0) + Number(row.count || 0));
  }
}

function chunkIds(itemIds: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < itemIds.length; index += REFERENCE_QUERY_CHUNK_SIZE) {
    chunks.push(itemIds.slice(index, index + REFERENCE_QUERY_CHUNK_SIZE));
  }
  return chunks;
}

function buildRawTextColumnInCondition(columnName: string, values: string[]): SQLWrapper {
  if (values.length === 0) {
    return sql`1 = 0`;
  }
  return sql`${sql.raw(columnName)} in (${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
}

function extractRewardItemIds(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [] as string[];
  }

  const reward = input as RewardLikePayload;
  if (!Array.isArray(reward.items)) {
    return [] as string[];
  }

  const itemIds = new Set<string>();
  for (const item of reward.items) {
    const itemId = typeof item?.itemId === "string" ? item.itemId.trim() : "";
    if (itemId) {
      itemIds.add(itemId);
    }
  }

  return [...itemIds];
}

function countRewardReferencesByItemIds(itemIds: string[], rewardRows: Array<{ reward: unknown }>) {
  const targetIds = new Set(itemIds);
  const counter = new Map<string, number>();

  for (const row of rewardRows) {
    for (const itemId of extractRewardItemIds(row.reward)) {
      if (!targetIds.has(itemId)) {
        continue;
      }
      counter.set(itemId, (counter.get(itemId) || 0) + 1);
    }
  }

  return counter;
}

async function queryReferenceCounts(
  itemIds: string[],
  query: (chunk: string[]) => Promise<Array<{ itemId: string; count: number }>>,
) {
  const counter = new Map<string, number>();
  for (const chunk of chunkIds(itemIds)) {
    const rows = await query(chunk);
    mergeCountRowMap(counter, rows);
  }
  return counter;
}

async function queryOptionalReferenceCounts(
  itemIds: string[],
  query: (chunk: string[]) => Promise<Array<{ itemId: string; count: number }>>,
) {
  try {
    return await queryReferenceCounts(itemIds, query);
  } catch {
    return new Map<string, number>();
  }
}

async function collectAiItemReferenceSummaries(itemIds: string[]) {
  if (itemIds.length === 0) {
    return new Map<string, AiItemReferenceSummary>();
  }
  const nowIso = new Date().toISOString();
  const [
    inventoryCounts,
    hongmengConfigCounts,
    hongmengOwnerCounts,
    marketListingCounts,
    marketTradeCounts,
    avatarUnlockCounts,
    avatarFrameUnlockCounts,
    temporaryCosmeticCounts,
    npcInventoryCounts,
    sectStorageCounts,
    spiritualFieldPlotSeedCounts,
    spiritualFieldPlotOutputCounts,
    spiritualFieldSeedConfigSeedCounts,
    spiritualFieldSeedConfigOutputCounts,
    pendingMailRows,
    activeCdkRows,
    enabledCheckinRuleRows,
  ] = await Promise.all([
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: playerInventory.itemId,
        count: count(),
      }).from(playerInventory)
        .where(inArray(playerInventory.itemId, chunk))
        .groupBy(playerInventory.itemId)
        .all();
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: hongmengTreasureConfigs.itemId,
        count: count(),
      }).from(hongmengTreasureConfigs)
        .where(inArray(hongmengTreasureConfigs.itemId, chunk))
        .groupBy(hongmengTreasureConfigs.itemId)
        .all();
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: playerHongmengTreasures.itemId,
        count: count(),
      }).from(playerHongmengTreasures)
        .where(inArray(playerHongmengTreasures.itemId, chunk))
        .groupBy(playerHongmengTreasures.itemId)
        .all();
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: marketListings.itemId,
        count: count(),
      }).from(marketListings)
        .where(inArray(marketListings.itemId, chunk))
        .groupBy(marketListings.itemId)
        .all();
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: marketTradeRecords.itemId,
        count: count(),
      }).from(marketTradeRecords)
        .where(inArray(marketTradeRecords.itemId, chunk))
        .groupBy(marketTradeRecords.itemId)
        .all();
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: playerUnlockedAvatars.sourceItemId,
        count: count(),
      }).from(playerUnlockedAvatars)
        .where(inArray(playerUnlockedAvatars.sourceItemId, chunk))
        .groupBy(playerUnlockedAvatars.sourceItemId)
        .all()
        .then((rows) => rows.map((row) => ({ itemId: String(row.itemId || ""), count: Number(row.count || 0) })).filter((row) => row.itemId));
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: playerUnlockedAvatarFrames.sourceItemId,
        count: count(),
      }).from(playerUnlockedAvatarFrames)
        .where(inArray(playerUnlockedAvatarFrames.sourceItemId, chunk))
        .groupBy(playerUnlockedAvatarFrames.sourceItemId)
        .all()
        .then((rows) => rows.map((row) => ({ itemId: String(row.itemId || ""), count: Number(row.count || 0) })).filter((row) => row.itemId));
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: playerTemporaryCosmeticGrants.sourceItemId,
        count: count(),
      }).from(playerTemporaryCosmeticGrants)
        .where(inArray(playerTemporaryCosmeticGrants.sourceItemId, chunk))
        .groupBy(playerTemporaryCosmeticGrants.sourceItemId)
        .all()
        .then((rows) => rows.map((row) => ({ itemId: String(row.itemId || ""), count: Number(row.count || 0) })).filter((row) => row.itemId));
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: worldNpcInventory.itemId,
        count: count(),
      }).from(worldNpcInventory)
        .where(inArray(worldNpcInventory.itemId, chunk))
        .groupBy(worldNpcInventory.itemId)
        .all();
    }),
    queryReferenceCounts(itemIds, async (chunk) => {
      return await db.select({
        itemId: sectStorageItems.itemId,
        count: count(),
      }).from(sectStorageItems)
        .where(inArray(sectStorageItems.itemId, chunk))
        .groupBy(sectStorageItems.itemId)
        .all();
    }),
    queryOptionalReferenceCounts(itemIds, async (chunk) => {
      const rows = await db.execute<{ itemId: string; count: number }>(
        sql`
          SELECT "seed_item_id" AS "itemId", COUNT(*)::int AS "count"
          FROM "plugin_spiritual_field_plots"
          WHERE ${buildRawTextColumnInCondition(`"seed_item_id"`, chunk)}
          GROUP BY "seed_item_id"
        `,
      );
      return Array.from(rows || []).map((row) => ({
        itemId: String(row.itemId || "").trim(),
        count: Number(row.count || 0),
      })).filter((row) => row.itemId);
    }),
    queryOptionalReferenceCounts(itemIds, async (chunk) => {
      const rows = await db.execute<{ itemId: string; count: number }>(
        sql`
          SELECT "output_item_id" AS "itemId", COUNT(*)::int AS "count"
          FROM "plugin_spiritual_field_plots"
          WHERE ${buildRawTextColumnInCondition(`"output_item_id"`, chunk)}
          GROUP BY "output_item_id"
        `,
      );
      return Array.from(rows || []).map((row) => ({
        itemId: String(row.itemId || "").trim(),
        count: Number(row.count || 0),
      })).filter((row) => row.itemId);
    }),
    queryOptionalReferenceCounts(itemIds, async (chunk) => {
      const rows = await db.execute<{ itemId: string; count: number }>(
        sql`
          SELECT "seed_item_id" AS "itemId", COUNT(*)::int AS "count"
          FROM "plugin_spiritual_field_seeds"
          WHERE ${buildRawTextColumnInCondition(`"seed_item_id"`, chunk)}
          GROUP BY "seed_item_id"
        `,
      );
      return Array.from(rows || []).map((row) => ({
        itemId: String(row.itemId || "").trim(),
        count: Number(row.count || 0),
      })).filter((row) => row.itemId);
    }),
    queryOptionalReferenceCounts(itemIds, async (chunk) => {
      const rows = await db.execute<{ itemId: string; count: number }>(
        sql`
          SELECT "output_item_id" AS "itemId", COUNT(*)::int AS "count"
          FROM "plugin_spiritual_field_seeds"
          WHERE ${buildRawTextColumnInCondition(`"output_item_id"`, chunk)}
          GROUP BY "output_item_id"
        `,
      );
      return Array.from(rows || []).map((row) => ({
        itemId: String(row.itemId || "").trim(),
        count: Number(row.count || 0),
      })).filter((row) => row.itemId);
    }),
    db.select({ reward: playerMails.reward })
      .from(playerMails)
      .where(isNull(playerMails.claimedAt))
      .all(),
    db.select({ reward: cdkCodes.reward })
      .from(cdkCodes)
      .where(and(
        eq(cdkCodes.enabled, true),
        or(
          isNull(cdkCodes.expiresAt),
          gte(cdkCodes.expiresAt, nowIso),
        ),
      ))
      .all(),
    db.select({ reward: checkinRewardRules.reward })
      .from(checkinRewardRules)
      .where(eq(checkinRewardRules.enabled, true))
      .all(),
  ]);
  const pendingMailCounts = countRewardReferencesByItemIds(itemIds, pendingMailRows);
  const activeCdkCounts = countRewardReferencesByItemIds(itemIds, activeCdkRows);
  const enabledCheckinRuleCounts = countRewardReferencesByItemIds(itemIds, enabledCheckinRuleRows);

  const summaries = new Map<string, AiItemReferenceSummary>();
  for (const itemId of itemIds) {
    const labels: string[] = [];
    const inventoryCount = inventoryCounts.get(itemId) || 0;
    const hongmengConfigCount = hongmengConfigCounts.get(itemId) || 0;
    const hongmengOwnerCount = hongmengOwnerCounts.get(itemId) || 0;
    const marketListingCount = marketListingCounts.get(itemId) || 0;
    const marketTradeCount = marketTradeCounts.get(itemId) || 0;
    const avatarUnlockCount = avatarUnlockCounts.get(itemId) || 0;
    const avatarFrameUnlockCount = avatarFrameUnlockCounts.get(itemId) || 0;
    const temporaryCosmeticCount = temporaryCosmeticCounts.get(itemId) || 0;
    const npcInventoryCount = npcInventoryCounts.get(itemId) || 0;
    const sectStorageCount = sectStorageCounts.get(itemId) || 0;
    const spiritualFieldPlotSeedCount = spiritualFieldPlotSeedCounts.get(itemId) || 0;
    const spiritualFieldPlotOutputCount = spiritualFieldPlotOutputCounts.get(itemId) || 0;
    const spiritualFieldSeedConfigSeedCount = spiritualFieldSeedConfigSeedCounts.get(itemId) || 0;
    const spiritualFieldSeedConfigOutputCount = spiritualFieldSeedConfigOutputCounts.get(itemId) || 0;
    const pendingMailCount = pendingMailCounts.get(itemId) || 0;
    const activeCdkCount = activeCdkCounts.get(itemId) || 0;
    const enabledCheckinRuleCount = enabledCheckinRuleCounts.get(itemId) || 0;

    if (inventoryCount > 0) {
      labels.push(`背包:${inventoryCount}`);
    }
    if (hongmengConfigCount > 0) {
      labels.push(`鸿蒙配置:${hongmengConfigCount}`);
    }
    if (hongmengOwnerCount > 0) {
      labels.push(`鸿蒙持有:${hongmengOwnerCount}`);
    }
    if (marketListingCount > 0) {
      labels.push(`市场上架:${marketListingCount}`);
    }
    if (marketTradeCount > 0) {
      labels.push(`成交留痕:${marketTradeCount}`);
    }
    if (avatarUnlockCount > 0) {
      labels.push(`头像解锁:${avatarUnlockCount}`);
    }
    if (avatarFrameUnlockCount > 0) {
      labels.push(`头像框解锁:${avatarFrameUnlockCount}`);
    }
    if (temporaryCosmeticCount > 0) {
      labels.push(`临时外观:${temporaryCosmeticCount}`);
    }
    if (npcInventoryCount > 0) {
      labels.push(`NPC持有:${npcInventoryCount}`);
    }
    if (sectStorageCount > 0) {
      labels.push(`宗门仓库:${sectStorageCount}`);
    }
    if (spiritualFieldPlotSeedCount > 0) {
      labels.push(`灵田播种:${spiritualFieldPlotSeedCount}`);
    }
    if (spiritualFieldPlotOutputCount > 0) {
      labels.push(`灵田产物:${spiritualFieldPlotOutputCount}`);
    }
    if (spiritualFieldSeedConfigSeedCount > 0) {
      labels.push(`灵田种子配置:${spiritualFieldSeedConfigSeedCount}`);
    }
    if (spiritualFieldSeedConfigOutputCount > 0) {
      labels.push(`灵田产出配置:${spiritualFieldSeedConfigOutputCount}`);
    }
    if (pendingMailCount > 0) {
      labels.push(`待领邮件:${pendingMailCount}`);
    }
    if (activeCdkCount > 0) {
      labels.push(`有效CDK:${activeCdkCount}`);
    }
    if (enabledCheckinRuleCount > 0) {
      labels.push(`签到配置:${enabledCheckinRuleCount}`);
    }

    summaries.set(itemId, {
      total: inventoryCount
        + hongmengConfigCount
        + hongmengOwnerCount
        + marketListingCount
        + marketTradeCount
        + avatarUnlockCount
        + avatarFrameUnlockCount
        + temporaryCosmeticCount
        + npcInventoryCount
        + sectStorageCount
        + spiritualFieldPlotSeedCount
        + spiritualFieldPlotOutputCount
        + spiritualFieldSeedConfigSeedCount
        + spiritualFieldSeedConfigOutputCount
        + pendingMailCount
        + activeCdkCount
        + enabledCheckinRuleCount,
      labels,
    });
  }

  return summaries;
}

function extractBoundSkillIdsFromItemRow(row: Pick<typeof items.$inferSelect, "effects" | "sourceMeta">) {
  const skillIds = new Set<string>();
  const effects = Array.isArray(row.effects) ? row.effects : [];
  for (const effect of effects) {
    if (effect && effect.type === "bind_skill" && typeof effect.skillId === "string" && effect.skillId.trim()) {
      skillIds.add(effect.skillId.trim());
    }
  }

  const sourceMeta = row.sourceMeta && typeof row.sourceMeta === "object"
    ? row.sourceMeta as Record<string, unknown>
    : null;
  if (sourceMeta && typeof sourceMeta.boundSkillId === "string" && sourceMeta.boundSkillId.trim()) {
    skillIds.add(sourceMeta.boundSkillId.trim());
  }

  return [...skillIds];
}

function buildSummary(rows: AiItemAdminRow[], minAgeHours: number): AiItemAdminSummary {
  const now = Date.now();
  const minimumCreatedAt = now - (minAgeHours * 60 * 60 * 1000);
  const summary: AiItemAdminSummary = {
    totalAiItems: rows.length,
    todayCreatedCount: 0,
    reclaimableCount: 0,
    bySource: {},
    byRarity: {},
    byCleanupState: {
      candidate: 0,
      protected: 0,
      legacy_unknown: 0,
    },
  };

  const todayPrefix = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    const sourceType = String(row.sourceType || "").trim() || resolveAiSourceTypeByItemId(row.id) || "unknown";
    const rarity = String(row.rarity || "").trim() || "unknown";
    summary.bySource[sourceType] = (summary.bySource[sourceType] || 0) + 1;
    summary.byRarity[rarity] = (summary.byRarity[rarity] || 0) + 1;
    summary.byCleanupState[row.cleanupState] += 1;
    if (String(row.createdAt || "").startsWith(todayPrefix)) {
      summary.todayCreatedCount += 1;
    }
    if (row.cleanupState === "candidate" && parseCreatedAtMs(row.createdAt) <= minimumCreatedAt) {
      summary.reclaimableCount += 1;
    }
  }

  return summary;
}

function buildCleanupPreview(rows: AiItemAdminRow[]) {
  const preview: AiItemCleanupPreview = {
    totalMatched: rows.length,
    candidateCount: 0,
    protectedCount: 0,
    legacyUnknownCount: 0,
    sourceBreakdown: {},
    rarityBreakdown: {},
    topFrequencyBuckets: [],
  };
  const frequencyCounter = new Map<string, number>();

  for (const row of rows) {
    const sourceType = String(row.sourceType || "").trim() || resolveAiSourceTypeByItemId(row.id) || "unknown";
    const rarity = String(row.rarity || "").trim() || "unknown";
    preview.sourceBreakdown[sourceType] = (preview.sourceBreakdown[sourceType] || 0) + 1;
    preview.rarityBreakdown[rarity] = (preview.rarityBreakdown[rarity] || 0) + 1;
    if (row.cleanupState === "candidate") {
      preview.candidateCount += 1;
      frequencyCounter.set(buildFrequencyBucket(row), (frequencyCounter.get(buildFrequencyBucket(row)) || 0) + 1);
    } else if (row.cleanupState === "protected") {
      preview.protectedCount += 1;
    } else {
      preview.legacyUnknownCount += 1;
    }
  }

  preview.topFrequencyBuckets = Array.from(frequencyCounter.entries())
    .map(([bucket, value]) => ({ bucket, count: value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return preview;
}

async function loadAiItemRows(filters: {
  sourceType?: string | null;
  rarity?: string | null;
  keyword?: string | null;
}) {
  await ensureLegacyAiItemsBackfilled();

  const conditions: SQLWrapper[] = [buildAiItemsCondition()];
  const sourceTypeCondition = buildSourceTypeFilter(filters.sourceType);
  if (sourceTypeCondition) {
    conditions.push(sourceTypeCondition);
  }
  const rarity = normalizeTextFilter(filters.rarity);
  if (rarity) {
    conditions.push(eq(items.rarity, rarity));
  }
  const keywordCondition = buildAiItemKeywordCondition(String(filters.keyword || ""));
  if (keywordCondition) {
    conditions.push(keywordCondition);
  }

  const whereClause = (conditions.length === 1 ? conditions[0] : and(...conditions)) as SQLWrapper;
  const rows = await db.select()
    .from(items)
    .where(whereClause as never)
    .orderBy(desc(items.createdAt))
    .all();

  const references = await collectAiItemReferenceSummaries(rows.map((row) => row.id));
  return rows.map((row) => {
    const referenceSummary = references.get(row.id) || { total: 0, labels: [] };
    return {
      ...row,
      sourceType: String(row.sourceType || "").trim() || resolveAiSourceTypeByItemId(row.id) || row.sourceType,
      cleanupState: getCleanupState(row, referenceSummary),
      referenceCount: referenceSummary.total,
      referenceSummary: referenceSummary.labels,
    } satisfies AiItemAdminRow;
  });
}

export async function queryAiItemAdminList(searchParams: URLSearchParams, defaultPage: number): Promise<AiItemAdminListResult> {
  const page = parsePage(searchParams.get("page"), defaultPage);
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const keyword = (searchParams.get("keyword") || "").trim();
  const cleanupStateFilter = normalizeTextFilter(searchParams.get("cleanupState"));
  const minAgeHours = normalizePositiveInteger(searchParams.get("minAgeHours"), DEFAULT_CLEANUP_MIN_AGE_HOURS);

  let rows = await loadAiItemRows({
    sourceType: searchParams.get("sourceType"),
    rarity: searchParams.get("rarity"),
    keyword,
  });

  if (cleanupStateFilter && (AI_ITEM_CLEANUP_STATES as readonly string[]).includes(cleanupStateFilter)) {
    rows = rows.filter((row) => row.cleanupState === cleanupStateFilter);
  }

  const total = rows.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, maxPage);
  const offset = (safePage - 1) * pageSize;

  return {
    list: rows.slice(offset, offset + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      total,
    },
    meta: {
      stats: buildSummary(rows, minAgeHours),
    },
  };
}

export async function getAiItemCleanupOverview(filters: CleanupFilterInput = {}) {
  const minAgeHours = normalizePositiveInteger(filters.minAgeHours, DEFAULT_CLEANUP_MIN_AGE_HOURS);
  const rows = await loadAiItemRows({
    sourceType: filters.sourceType,
    rarity: filters.rarity,
    keyword: null,
  });
  const minimumCreatedAt = Date.now() - (minAgeHours * 60 * 60 * 1000);
  const eligibleRows = rows.filter((row) => (
    row.cleanupState !== "protected"
    || row.referenceCount === 0
  ));
  const previewRows = eligibleRows.filter((row) => (
    row.cleanupState !== "candidate"
    || parseCreatedAtMs(row.createdAt) <= minimumCreatedAt
  ));

  return {
    stats: buildSummary(rows, minAgeHours),
    preview: buildCleanupPreview(previewRows),
  };
}

export async function cleanupAiGeneratedItems(input: CleanupFilterInput & { dryRun?: boolean }) {
  const minAgeHours = normalizePositiveInteger(input.minAgeHours, DEFAULT_CLEANUP_MIN_AGE_HOURS);
  const deleteLimit = normalizePositiveInteger(input.deleteLimit, DEFAULT_CLEANUP_DELETE_LIMIT);
  const minimumCreatedAt = Date.now() - (minAgeHours * 60 * 60 * 1000);
  const rows = await loadAiItemRows({
    sourceType: input.sourceType,
    rarity: input.rarity,
    keyword: null,
  });

  const candidateRows = rows
    .filter((row) => row.cleanupState === "candidate")
    .filter((row) => parseCreatedAtMs(row.createdAt) <= minimumCreatedAt);

  const frequencyCounter = new Map<string, number>();
  for (const row of candidateRows) {
    const bucket = buildFrequencyBucket(row);
    frequencyCounter.set(bucket, (frequencyCounter.get(bucket) || 0) + 1);
  }

  const sortedRows = [...candidateRows].sort((a, b) => {
    const frequencyDelta = (frequencyCounter.get(buildFrequencyBucket(b)) || 0) - (frequencyCounter.get(buildFrequencyBucket(a)) || 0);
    if (frequencyDelta !== 0) {
      return frequencyDelta;
    }
    return parseCreatedAtMs(a.createdAt) - parseCreatedAtMs(b.createdAt);
  });

  const deleteRows = sortedRows.slice(0, deleteLimit);
  const deletedIds = deleteRows.map((row) => row.id);
  const deletedSkillIds = [...new Set(deleteRows.flatMap((row) => extractBoundSkillIdsFromItemRow(row)))];
  const preview = buildCleanupPreview(rows.filter((row) => (
    row.cleanupState === "protected"
    || (row.cleanupState === "candidate" && parseCreatedAtMs(row.createdAt) <= minimumCreatedAt)
    || row.cleanupState === "legacy_unknown"
  )));

  if (!input.dryRun && deletedIds.length > 0) {
    await db.transaction(async (tx) => {
      if (deletedIds.length === 1) {
        await tx.delete(marketTradeRecords).where(eq(marketTradeRecords.itemId, deletedIds[0])).run();
        await tx.delete(items).where(eq(items.id, deletedIds[0])).run();
      } else {
        await tx.delete(marketTradeRecords).where(inArray(marketTradeRecords.itemId, deletedIds)).run();
        await tx.delete(items).where(inArray(items.id, deletedIds)).run();
      }

      if (deletedSkillIds.length > 0) {
        const remainingSmithingRows = await tx.select({
          id: items.id,
          effects: items.effects,
          sourceMeta: items.sourceMeta,
        }).from(items)
          .where(eq(items.sourceType, "ai_smithing"))
          .all();
        const remainingSkillIds = new Set(
          remainingSmithingRows.flatMap((row) => extractBoundSkillIdsFromItemRow(row)),
        );
        const orphanSkillIds = deletedSkillIds.filter((skillId) => !remainingSkillIds.has(skillId));

        if (orphanSkillIds.length === 1) {
          await tx.delete(playerSkills).where(eq(playerSkills.skillId, orphanSkillIds[0])).run();
          await tx.delete(skills).where(eq(skills.id, orphanSkillIds[0])).run();
        } else if (orphanSkillIds.length > 1) {
          await tx.delete(playerSkills).where(inArray(playerSkills.skillId, orphanSkillIds)).run();
          await tx.delete(skills).where(inArray(skills.id, orphanSkillIds)).run();
        }
      }
    });
  }

  return {
    ...preview,
    deletedCount: input.dryRun ? 0 : deletedIds.length,
    deletedIds: input.dryRun ? [] : deletedIds,
  } satisfies AiItemCleanupExecuteResult;
}

export async function ensureLegacyAiAlchemyItemsBackfilled() {
  return await ensureLegacyAiItemsBackfilled();
}

export async function ensureLegacyAiItemsBackfilled() {
  const cleanupGlobal = globalThis as CleanupStatsGlobal;
  const now = Date.now();
  if (
    cleanupGlobal.__immortalityAiItemBackfillPromise
    && cleanupGlobal.__immortalityAiItemBackfillLastRunAt
    && cleanupGlobal.__immortalityAiItemBackfillLastRunAt + BACKFILL_THROTTLE_MS > now
  ) {
    return await cleanupGlobal.__immortalityAiItemBackfillPromise;
  }

  if (
    cleanupGlobal.__immortalityAiItemBackfillLastRunAt
    && cleanupGlobal.__immortalityAiItemBackfillLastRunAt + BACKFILL_THROTTLE_MS > now
  ) {
    return 0;
  }

  cleanupGlobal.__immortalityAiItemBackfillLastRunAt = now;
  cleanupGlobal.__immortalityAiItemBackfillPromise = (async () => {
    let updatedCount = 0;

    for (const item of AI_ITEM_ID_PREFIX_TO_SOURCE_TYPE) {
      const result = await db.execute(sql`
        update "items"
        set "source_type" = ${item.sourceType}
        where "id" like ${`${item.prefix}%`}
          and (
            "source_type" is null
            or btrim("source_type") = ''
          )
        returning "id"
      `);
      const rows = Array.isArray(result)
        ? result
        : result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows?: unknown[] }).rows)
          ? (result as { rows: unknown[] }).rows
          : [];
      updatedCount += rows.length;
    }

    return updatedCount;
  })()
    .finally(() => {
      cleanupGlobal.__immortalityAiItemBackfillPromise = null;
    });

  return await cleanupGlobal.__immortalityAiItemBackfillPromise;
}
