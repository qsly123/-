import { and, asc, count, desc, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { items, pillToxicityConfigs, players } from "@/db/schema";
import {
  getItemColumnSetCompat,
  isMissingItemPillToxicityColumnError,
  isMissingPillToxicityConfigTableError,
  isMissingPlayerPillToxicityColumnError,
} from "@/modules/character/services/pill-toxicity-schema-compat";
import type { CustomListQueryResult, ListConfig } from "./entity-configs";
import { parsePage, parsePageSize } from "./route-helpers";

interface QueryEntityListResult {
  list: unknown[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  meta?: Record<string, unknown>;
}

function buildLegacyPlayerAdminSelect() {
  return {
    id: players.id,
    accountId: players.accountId,
    name: players.name,
    gender: players.gender,
    avatarId: players.avatarId,
    avatarFrameId: players.avatarFrameId,
    spiritualRoot: players.spiritualRoot,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    cultivationXp: players.cultivationXp,
    pillToxicity: sql<number>`0`.mapWith(Number),
    pillToxicityUpdatedAt: players.updatedAt,
    dongfuLastClaimAt: players.dongfuLastClaimAt,
    hp: players.hp,
    maxHp: players.maxHp,
    mp: players.mp,
    maxMp: players.maxMp,
    attack: players.attack,
    defense: players.defense,
    speed: players.speed,
    luck: players.luck,
    spiritualSense: players.spiritualSense,
    armorPenetration: players.armorPenetration,
    block: players.block,
    skillDamageBonus: players.skillDamageBonus,
    skillDamageReduction: players.skillDamageReduction,
    artifactDamageBonus: players.artifactDamageBonus,
    artifactDamageReduction: players.artifactDamageReduction,
    breakthroughBonusRate: players.breakthroughBonusRate,
    gold: players.gold,
    lingYu: players.lingYu,
    stamina: players.stamina,
    staminaUpdatedAt: players.staminaUpdatedAt,
    currentMainQuestId: players.currentMainQuestId,
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
    isAlive: players.isAlive,
    createdAt: players.createdAt,
    updatedAt: players.updatedAt,
  };
}

function buildLegacyItemAdminSelect(columnSet: Set<string>) {
  return {
    id: items.id,
    templateItemId: columnSet.has("template_item_id")
      ? items.templateItemId
      : sql<string | null>`null`,
    name: items.name,
    iconUrl: items.iconUrl,
    description: items.description,
    itemType: items.itemType,
    rarity: items.rarity,
    effects: items.effects,
    pillToxicity: sql<number>`1`.mapWith(Number),
    price: items.price,
    stackable: items.stackable,
    isBound: items.isBound,
    minRealm: items.minRealm,
    maxRealm: items.maxRealm,
    sourceType: columnSet.has("source_type")
      ? items.sourceType
      : sql<string | null>`null`,
    sourceInstanceId: columnSet.has("source_instance_id")
      ? items.sourceInstanceId
      : sql<string | null>`null`,
    sourceMonsterId: columnSet.has("source_monster_id")
      ? items.sourceMonsterId
      : sql<string | null>`null`,
    sourcePlayerId: columnSet.has("source_player_id")
      ? items.sourcePlayerId
      : sql<string | null>`null`,
    sourceCategory: columnSet.has("source_category")
      ? items.sourceCategory
      : sql<string | null>`null`,
    generatedSeed: columnSet.has("generated_seed")
      ? items.generatedSeed
      : sql<string | null>`null`,
    sourceMeta: columnSet.has("source_meta")
      ? items.sourceMeta
      : sql<Record<string, unknown> | null>`null`,
    createdAt: items.createdAt,
  };
}

function buildDefaultPillToxicityConfigRow() {
  const nowIso = new Date().toISOString();
  return {
    key: "default",
    id: "default",
    maxToxicity: 20,
    recoverIntervalMinutes: 8,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function normalizeAiAlchemyAdminItemRarity(row: unknown) {
  if (!row || typeof row !== "object") {
    return row;
  }
  const record = row as Record<string, unknown>;
  const sourceType = String(record.sourceType || "").trim();
  const rarity = String(record.rarity || "").trim();
  const pillToxicity = Number(record.pillToxicity ?? 0);
  if (sourceType !== "ai_alchemy" || pillToxicity > 0 || rarity === "hongmeng") {
    return row;
  }
  return {
    ...record,
    rarity: "hongmeng",
  };
}

export async function queryEntityList(
  config: ListConfig,
  searchParams: URLSearchParams,
  defaultPage: number,
): Promise<QueryEntityListResult> {
  if (config.customQuery) {
    return await config.customQuery(searchParams, defaultPage) as CustomListQueryResult;
  }

  const page = parsePage(searchParams.get("page"), defaultPage);
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const keyword = (searchParams.get("keyword") || "").trim();

  const filters: SQLWrapper[] = [];
  const baseWhere = typeof config.baseWhere === "function"
    ? config.baseWhere()
    : config.baseWhere;
  if (baseWhere) {
    filters.push(baseWhere);
  }
  if (keyword) {
    const condition = config.searchBuilder(keyword);
    if (condition) {
      filters.push(condition);
    }
  }

  if (config.filterBuilders) {
    for (const [key, buildFilter] of Object.entries(config.filterBuilders)) {
      const rawValue = (searchParams.get(key) || "").trim();
      if (!rawValue) {
        continue;
      }

      const condition = buildFilter(rawValue);
      if (condition) {
        filters.push(condition);
      }
    }
  }

  const whereClause = filters.length ? and(...filters) : undefined;
  let totalRow:
    | {
      total: number;
    }
    | undefined;
  try {
    totalRow = whereClause
      ? await db.select({ total: count() }).from(config.table).where(whereClause).get()
      : await db.select({ total: count() }).from(config.table).get();
  } catch (error) {
    if (!(config.table === pillToxicityConfigs && isMissingPillToxicityConfigTableError(error))) {
      throw error;
    }
    totalRow = { total: 1 };
  }

  const total = totalRow?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, maxPage);
  const offset = (safePage - 1) * pageSize;
  const orderByClause = config.orderDirection === "asc"
    ? asc(config.orderColumn as never)
    : desc(config.orderColumn as never);

  let rawRows: unknown[];
  try {
    rawRows = whereClause
      ? await db.select().from(config.table)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset)
        .all()
      : await db.select().from(config.table)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset)
        .all();
  } catch (error) {
    if (config.table === players && isMissingPlayerPillToxicityColumnError(error)) {
      rawRows = whereClause
        ? await db.select(buildLegacyPlayerAdminSelect()).from(players)
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset)
          .groupBy(
            players.id,
            players.accountId,
            players.name,
            players.gender,
            players.avatarId,
            players.avatarFrameId,
            players.spiritualRoot,
            players.realm,
            players.realmMajor,
            players.realmMinor,
            players.realmName,
            players.cultivationXp,
            players.updatedAt,
            players.dongfuLastClaimAt,
            players.hp,
            players.maxHp,
            players.mp,
            players.maxMp,
            players.attack,
            players.defense,
            players.speed,
            players.luck,
            players.spiritualSense,
            players.armorPenetration,
            players.block,
            players.skillDamageBonus,
            players.skillDamageReduction,
            players.artifactDamageBonus,
            players.artifactDamageReduction,
            players.breakthroughBonusRate,
            players.gold,
            players.lingYu,
            players.stamina,
            players.staminaUpdatedAt,
            players.currentMainQuestId,
            players.currentMapId,
            players.positionX,
            players.positionY,
            players.isAlive,
            players.createdAt,
          )
          .all()
        : await db.select(buildLegacyPlayerAdminSelect()).from(players)
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset)
          .groupBy(
            players.id,
            players.accountId,
            players.name,
            players.gender,
            players.avatarId,
            players.avatarFrameId,
            players.spiritualRoot,
            players.realm,
            players.realmMajor,
            players.realmMinor,
            players.realmName,
            players.cultivationXp,
            players.updatedAt,
            players.dongfuLastClaimAt,
            players.hp,
            players.maxHp,
            players.mp,
            players.maxMp,
            players.attack,
            players.defense,
            players.speed,
            players.luck,
            players.spiritualSense,
            players.armorPenetration,
            players.block,
            players.skillDamageBonus,
            players.skillDamageReduction,
            players.artifactDamageBonus,
            players.artifactDamageReduction,
            players.breakthroughBonusRate,
            players.gold,
            players.lingYu,
            players.stamina,
            players.staminaUpdatedAt,
            players.currentMainQuestId,
            players.currentMapId,
            players.positionX,
            players.positionY,
            players.isAlive,
            players.createdAt,
          )
          .all();
      if (whereClause) {
        rawRows = rawRows as unknown[];
      }
    } else if (config.table === items && isMissingItemPillToxicityColumnError(error)) {
      const itemColumnSet = await getItemColumnSetCompat(db);
      rawRows = whereClause
        ? await db.select(buildLegacyItemAdminSelect(itemColumnSet)).from(items)
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset)
          .all()
        : await db.select(buildLegacyItemAdminSelect(itemColumnSet)).from(items)
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset)
          .all();
    } else if (config.table === pillToxicityConfigs && isMissingPillToxicityConfigTableError(error)) {
      rawRows = [buildDefaultPillToxicityConfigRow()];
    } else {
      throw error;
    }
  }

  const list = config.sanitizeList
    ? config.sanitizeList(rawRows as Record<string, unknown>[])
    : rawRows;
  const normalizedList = config.table === items
    ? (list as unknown[]).map((row) => normalizeAiAlchemyAdminItemRarity(row))
    : list;

  return {
    list: normalizedList,
    pagination: {
      page: safePage,
      pageSize,
      total,
    },
  };
}
