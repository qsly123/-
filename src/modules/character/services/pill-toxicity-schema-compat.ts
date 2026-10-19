import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, players } from "@/db/schema";

type ColumnExecutor = {
  execute?: typeof db.execute;
};
type QueryExecutor = Pick<typeof db, "select"> & ColumnExecutor;
type MutationExecutor = ColumnExecutor;
type PlayerRow = typeof players.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type PlayerInsertInput = typeof players.$inferInsert;
type ItemInsertInput = typeof items.$inferInsert;
type DatabaseErrorShape = { code?: unknown; message?: unknown; cause?: unknown };

let playerPillToxicityColumnsAvailable: boolean | null = null;
let itemPillToxicityColumnAvailable: boolean | null = null;
let playerColumnSetCache: Set<string> | null = null;
let itemColumnSetCache: Set<string> | null = null;

const OPTIONAL_PLAYER_COLUMNS = [
  "pill_toxicity",
  "pill_toxicity_updated_at",
  "current_map_instance_id",
  "secret_realm_pity_counter",
  "secret_realm_hongmeng_pity_counter",
  "secret_realm_last_personal_spawn_at",
  "wild_wolf_valley_mob_bottle_pity_counter",
  "wild_wolf_valley_boss_bottle_pity_counter",
] as const;
const OPTIONAL_ITEM_COLUMNS = [
  "pill_toxicity",
  "template_item_id",
  "source_type",
  "source_instance_id",
  "source_monster_id",
  "source_player_id",
  "source_category",
  "generated_seed",
  "source_meta",
] as const;

function extractDatabaseError(error: unknown): DatabaseErrorShape | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const root = error as DatabaseErrorShape;
  if (typeof root.code === "string") {
    return root;
  }
  if (root.cause && typeof root.cause === "object") {
    const nested = extractDatabaseError(root.cause);
    if (nested) {
      return nested;
    }
  }
  if (typeof root.message === "string") {
    return root;
  }
  return null;
}

function includesText(value: unknown, keyword: string) {
  return typeof value === "string" && value.toLowerCase().includes(keyword.toLowerCase());
}

function getExecuteRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }

  return [];
}

async function getPlayerColumnSet(queryDb: ColumnExecutor = db) {
  if (playerColumnSetCache) {
    return playerColumnSetCache;
  }

  const execute = typeof queryDb.execute === "function"
    ? queryDb.execute.bind(queryDb)
    : db.execute.bind(db);
  const result = await execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
  `);

  playerColumnSetCache = new Set(
    getExecuteRows<{ column_name?: string }>(result)
      .map((row) => String(row.column_name || "").trim())
      .filter(Boolean),
  );

  return playerColumnSetCache;
}

async function getItemColumnSet(queryDb: ColumnExecutor = db) {
  if (itemColumnSetCache) {
    return itemColumnSetCache;
  }

  const execute = typeof queryDb.execute === "function"
    ? queryDb.execute.bind(queryDb)
    : db.execute.bind(db);
  const result = await execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
  `);

  itemColumnSetCache = new Set(
    getExecuteRows<{ column_name?: string }>(result)
      .map((row) => String(row.column_name || "").trim())
      .filter(Boolean),
  );

  return itemColumnSetCache;
}

export async function getItemColumnSetCompat(queryDb: ColumnExecutor = db) {
  return await getItemColumnSet(queryDb);
}

function isOptionalPlayerColumnAvailable(columnSet: Set<string>, columnName: typeof OPTIONAL_PLAYER_COLUMNS[number]) {
  return columnSet.has(columnName);
}

export function isMissingPlayerPillToxicityColumnError(error: unknown) {
  const dbError = extractDatabaseError(error);
  if (!dbError || dbError.code !== "42703") {
    return false;
  }
  return OPTIONAL_PLAYER_COLUMNS.some((columnName) => includesText(dbError.message, columnName));
}

export function isMissingItemPillToxicityColumnError(error: unknown) {
  const dbError = extractDatabaseError(error);
  if (!dbError || dbError.code !== "42703") {
    return false;
  }
  return OPTIONAL_ITEM_COLUMNS.some((columnName) => includesText(dbError.message, columnName));
}

export function isMissingPillToxicityConfigTableError(error: unknown) {
  const dbError = extractDatabaseError(error);
  if (!dbError || dbError.code !== "42P01") {
    return false;
  }
  return includesText(dbError.message, "pill_toxicity_configs");
}

export function isPlayerPillToxicitySchemaMissing() {
  return playerPillToxicityColumnsAvailable === false;
}

export function isItemPillToxicitySchemaMissing() {
  return itemPillToxicityColumnAvailable === false;
}

function buildLegacyPlayerSelect(nowIso: string) {
  const columnSet = playerColumnSetCache ?? new Set<string>();
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
    pillToxicity: isOptionalPlayerColumnAvailable(columnSet, "pill_toxicity")
      ? players.pillToxicity
      : sql<number>`0`.mapWith(Number),
    pillToxicityUpdatedAt: isOptionalPlayerColumnAvailable(columnSet, "pill_toxicity_updated_at")
      ? players.pillToxicityUpdatedAt
      : sql<string>`${nowIso}`,
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
    currentMapInstanceId: isOptionalPlayerColumnAvailable(columnSet, "current_map_instance_id")
      ? players.currentMapInstanceId
      : sql<string | null>`null`,
    secretRealmPityCounter: isOptionalPlayerColumnAvailable(columnSet, "secret_realm_pity_counter")
      ? players.secretRealmPityCounter
      : sql<number>`0`.mapWith(Number),
    secretRealmHongmengPityCounter: isOptionalPlayerColumnAvailable(columnSet, "secret_realm_hongmeng_pity_counter")
      ? players.secretRealmHongmengPityCounter
      : sql<number>`0`.mapWith(Number),
    secretRealmLastPersonalSpawnAt: isOptionalPlayerColumnAvailable(columnSet, "secret_realm_last_personal_spawn_at")
      ? players.secretRealmLastPersonalSpawnAt
      : sql<string | null>`null`,
    wildWolfValleyMobBottlePityCounter: isOptionalPlayerColumnAvailable(columnSet, "wild_wolf_valley_mob_bottle_pity_counter")
      ? players.wildWolfValleyMobBottlePityCounter
      : sql<number>`0`.mapWith(Number),
    wildWolfValleyBossBottlePityCounter: isOptionalPlayerColumnAvailable(columnSet, "wild_wolf_valley_boss_bottle_pity_counter")
      ? players.wildWolfValleyBossBottlePityCounter
      : sql<number>`0`.mapWith(Number),
    positionX: players.positionX,
    positionY: players.positionY,
    isAlive: players.isAlive,
    createdAt: players.createdAt,
    updatedAt: players.updatedAt,
  };
}

async function getPlayerByIdLegacy(playerId: string, queryDb: QueryExecutor): Promise<PlayerRow | null> {
  await getPlayerColumnSet(queryDb);
  const nowIso = new Date().toISOString();
  const row = await queryDb.select(buildLegacyPlayerSelect(nowIso))
    .from(players)
    .where(eq(players.id, playerId))
    .get();
  return row as PlayerRow | null;
}

async function getPlayersByIdsLegacy(playerIds: string[], queryDb: QueryExecutor): Promise<PlayerRow[]> {
  if (!playerIds.length) {
    return [];
  }
  await getPlayerColumnSet(queryDb);
  const nowIso = new Date().toISOString();
  const rows = await queryDb.select(buildLegacyPlayerSelect(nowIso))
    .from(players)
    .where(inArray(players.id, playerIds))
    .all();
  return rows as PlayerRow[];
}

function buildLegacyItemSelect() {
  const columnSet = itemColumnSetCache ?? new Set<string>();
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
    pillToxicity: columnSet.has("pill_toxicity")
      ? items.pillToxicity
      : sql<number>`1`.mapWith(Number),
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

function normalizeAiAlchemyItemRarity<T extends ItemRow | null>(row: T): T {
  if (!row) {
    return row;
  }
  const sourceType = String(row.sourceType || "").trim();
  const rarity = String(row.rarity || "").trim();
  const pillToxicity = Number(row.pillToxicity ?? 0);
  if (sourceType !== "ai_alchemy" || pillToxicity > 0 || rarity === "hongmeng") {
    return row;
  }
  return {
    ...row,
    rarity: "hongmeng",
  } as T;
}

function normalizeAiAlchemyItemRarities(rows: ItemRow[]) {
  return rows.map((row) => normalizeAiAlchemyItemRarity(row));
}

async function getItemByIdLegacy(itemId: string, queryDb: QueryExecutor): Promise<ItemRow | null> {
  await getItemColumnSet(queryDb);
  const row = await queryDb.select(buildLegacyItemSelect())
    .from(items)
    .where(eq(items.id, itemId))
    .get();
  return row as ItemRow | null;
}

async function getItemsByIdsLegacy(itemIds: string[], queryDb: QueryExecutor): Promise<ItemRow[]> {
  if (!itemIds.length) {
    return [];
  }
  await getItemColumnSet(queryDb);
  const rows = await queryDb.select(buildLegacyItemSelect())
    .from(items)
    .where(inArray(items.id, itemIds))
    .all();
  return rows as ItemRow[];
}

export async function getPlayerByIdCompat(playerId: string, queryDb: QueryExecutor = db): Promise<PlayerRow | null> {
  try {
    const row = await getPlayerByIdLegacy(playerId, queryDb);
    const columnSet = await getPlayerColumnSet(queryDb);
    playerPillToxicityColumnsAvailable = OPTIONAL_PLAYER_COLUMNS.every((columnName) => columnSet.has(columnName));
    return row ?? null;
  } catch (error) {
    if (!isMissingPlayerPillToxicityColumnError(error)) {
      throw error;
    }
    playerPillToxicityColumnsAvailable = false;
    return getPlayerByIdLegacy(playerId, queryDb);
  }
}

export async function getPlayersByIdsCompat(playerIds: string[], queryDb: QueryExecutor = db): Promise<PlayerRow[]> {
  if (!playerIds.length) {
    return [];
  }
  try {
    const rows = await getPlayersByIdsLegacy(playerIds, queryDb);
    const columnSet = await getPlayerColumnSet(queryDb);
    playerPillToxicityColumnsAvailable = OPTIONAL_PLAYER_COLUMNS.every((columnName) => columnSet.has(columnName));
    return rows;
  } catch (error) {
    if (!isMissingPlayerPillToxicityColumnError(error)) {
      throw error;
    }
    playerPillToxicityColumnsAvailable = false;
    return getPlayersByIdsLegacy(playerIds, queryDb);
  }
}

export async function getItemByIdCompat(itemId: string, queryDb: QueryExecutor = db): Promise<ItemRow | null> {
  try {
    const row = await getItemByIdLegacy(itemId, queryDb);
    const columnSet = await getItemColumnSet(queryDb);
    itemPillToxicityColumnAvailable = OPTIONAL_ITEM_COLUMNS.every((columnName) => columnSet.has(columnName));
    return normalizeAiAlchemyItemRarity(row ?? null);
  } catch (error) {
    if (!isMissingItemPillToxicityColumnError(error)) {
      throw error;
    }
    itemPillToxicityColumnAvailable = false;
    return normalizeAiAlchemyItemRarity(await getItemByIdLegacy(itemId, queryDb));
  }
}

export async function getItemsByIdsCompat(itemIds: string[], queryDb: QueryExecutor = db): Promise<ItemRow[]> {
  if (!itemIds.length) {
    return [];
  }
  try {
    const rows = await getItemsByIdsLegacy(itemIds, queryDb);
    const columnSet = await getItemColumnSet(queryDb);
    itemPillToxicityColumnAvailable = OPTIONAL_ITEM_COLUMNS.every((columnName) => columnSet.has(columnName));
    return normalizeAiAlchemyItemRarities(rows);
  } catch (error) {
    if (!isMissingItemPillToxicityColumnError(error)) {
      throw error;
    }
    itemPillToxicityColumnAvailable = false;
    return normalizeAiAlchemyItemRarities(await getItemsByIdsLegacy(itemIds, queryDb));
  }
}

function buildPlayerInsertEntries(input: PlayerInsertInput) {
  const nowIso = new Date().toISOString();
  const createdAt = input.createdAt ?? nowIso;
  const updatedAt = input.updatedAt ?? createdAt;
  return [
    ["id", input.id],
    ["account_id", input.accountId],
    ["name", input.name],
    ["gender", input.gender],
    ["avatar_id", input.avatarId],
    ["avatar_frame_id", input.avatarFrameId],
    ["spiritual_root", input.spiritualRoot],
    ["realm", input.realm],
    ["realm_major", input.realmMajor],
    ["realm_minor", input.realmMinor],
    ["realm_name", input.realmName],
    ["cultivation_xp", input.cultivationXp],
    ["pill_toxicity", input.pillToxicity],
    ["pill_toxicity_updated_at", input.pillToxicityUpdatedAt],
    ["dongfu_last_claim_at", input.dongfuLastClaimAt],
    ["hp", input.hp],
    ["max_hp", input.maxHp],
    ["mp", input.mp],
    ["max_mp", input.maxMp],
    ["attack", input.attack],
    ["defense", input.defense],
    ["speed", input.speed],
    ["luck", input.luck],
    ["spiritual_sense", input.spiritualSense],
    ["armor_penetration", input.armorPenetration],
    ["block", input.block],
    ["skill_damage_bonus", input.skillDamageBonus],
    ["skill_damage_reduction", input.skillDamageReduction],
    ["artifact_damage_bonus", input.artifactDamageBonus],
    ["artifact_damage_reduction", input.artifactDamageReduction],
    ["breakthrough_bonus_rate", input.breakthroughBonusRate],
    ["gold", input.gold],
    ["ling_yu", input.lingYu],
    ["stamina", input.stamina],
    ["stamina_updated_at", input.staminaUpdatedAt],
    ["current_main_quest_id", input.currentMainQuestId],
    ["current_map_id", input.currentMapId],
    ["current_map_instance_id", input.currentMapInstanceId],
    ["secret_realm_pity_counter", input.secretRealmPityCounter],
    ["secret_realm_last_personal_spawn_at", input.secretRealmLastPersonalSpawnAt],
    ["position_x", input.positionX],
    ["position_y", input.positionY],
    ["is_alive", input.isAlive],
    // players.last_seen_at 是 NOT NULL 且无数据库默认值，漏列会导致创建角色直接失败。
    ["last_seen_at", input.lastSeenAt ?? nowIso],
    ["created_at", createdAt],
    ["updated_at", updatedAt],
  ] as const;
}

function buildItemInsertEntries(input: ItemInsertInput) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return [
    ["id", input.id],
    ["template_item_id", input.templateItemId],
    ["name", input.name],
    ["icon_url", input.iconUrl],
    ["description", input.description],
    ["item_type", input.itemType],
    ["rarity", input.rarity],
    ["effects", input.effects],
    ["pill_toxicity", input.pillToxicity],
    ["price", input.price],
    ["stackable", input.stackable],
    ["is_bound", input.isBound],
    ["min_realm", input.minRealm],
    ["max_realm", input.maxRealm],
    ["source_type", input.sourceType],
    ["source_instance_id", input.sourceInstanceId],
    ["source_monster_id", input.sourceMonsterId],
    ["source_player_id", input.sourcePlayerId],
    ["source_category", input.sourceCategory],
    ["generated_seed", input.generatedSeed],
    ["source_meta", input.sourceMeta],
    ["created_at", createdAt],
  ] as const;
}

function normalizeInsertValue(value: unknown) {
  if (value === undefined) {
    return value;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

export async function insertPlayerCompat(input: PlayerInsertInput, executor: MutationExecutor = db) {
  const columnSet = await getPlayerColumnSet(executor);
  const entries = buildPlayerInsertEntries(input)
    .map(([columnName, value]) => [columnName, normalizeInsertValue(value)] as const)
    .filter(([columnName, value]) => columnSet.has(columnName) && value !== undefined);

  if (!entries.length) {
    throw new Error("players 表字段检查失败，无法插入角色数据");
  }

  const execute = typeof executor.execute === "function"
    ? executor.execute.bind(executor)
    : db.execute.bind(db);

  await execute(sql`
    insert into "players" (${sql.join(entries.map(([columnName]) => sql.identifier(columnName)), sql`, `)})
    values (${sql.join(entries.map(([, value]) => sql`${value}`), sql`, `)})
  `);
}

export async function insertItemCompat(input: ItemInsertInput, executor: MutationExecutor = db) {
  const columnSet = await getItemColumnSet(executor);
  const entries = buildItemInsertEntries(input)
    .map(([columnName, value]) => [columnName, normalizeInsertValue(value)] as const)
    .filter(([columnName, value]) => columnSet.has(columnName) && value !== undefined);

  if (!entries.length) {
    throw new Error("items 表字段检查失败，无法插入物品数据");
  }

  const execute = typeof executor.execute === "function"
    ? executor.execute.bind(executor)
    : db.execute.bind(db);

  await execute(sql`
    insert into "items" (${sql.join(entries.map(([columnName]) => sql.identifier(columnName)), sql`, `)})
    values (${sql.join(entries.map(([, value]) => sql`${value}`), sql`, `)})
  `);
}
