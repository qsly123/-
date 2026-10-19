import { sql } from "drizzle-orm";
import { fourRealmsPack } from "../src/db/offline-packs/four-realms-pack";
import { pruneFourRealmsLegacyData } from "./lib/four-realms-legacy-prune";

const PACK_APPLY_VERSION_KEY = "FOUR_REALMS_LAST_APPLIED_VERSION";
const RESET_PLAYER_DATA_ON_APPLY = process.env.FOUR_REALMS_RESET_PLAYER_DATA === "1";
const LEGACY_PREGNANCY_SYSTEM_CONFIG_KEYS = [
  "PLAYER_PREGNANCY_SYSTEM_JSON",
];
const LEGACY_PREGNANCY_FORTUNE_IDS = [
  "fortune_pregnancy_female_yugong_chenglu",
  "fortune_pregnancy_female_chunxi_yuntai",
  "fortune_pregnancy_female_xiangsui_ninggong",
  "fortune_pregnancy_female_qigu_roulu",
  "fortune_pregnancy_male_chiyang_suihai",
  "fortune_pregnancy_male_longjing_manqiao",
  "fortune_pregnancy_male_jinguan_yulu",
  "fortune_pregnancy_male_yuqi_cuiyang",
  "669f9abd-60a3-4403-bd4d-aa8ddf9ef9a0",
  "92e536d5-2172-4bcb-a05a-95d72f63d49e",
];
const LEGACY_PREGNANCY_RANDOM_EVENT_IDS = [
  "event_pregnancy_female_lianyue_chenglu",
  "event_pregnancy_female_jiangzhang_yuwen",
  "event_pregnancy_female_huawu_qingong",
  "event_pregnancy_female_chundeng_wuyin",
  "event_pregnancy_male_yezhang_liuhen",
  "event_pregnancy_male_nuanxiang_cuijing",
  "event_pregnancy_male_jinque_suolu",
  "event_pregnancy_male_luoqin_zongqi",
];

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

async function doesTableExist(db: Awaited<ReturnType<typeof loadDb>>, tableName: string) {
  const result = await db.execute(sql`select to_regclass(${`public.${tableName}`}) as table_name`);
  const [row] = getExecuteRows<{ table_name?: string | null }>(result);
  return typeof row?.table_name === "string" && row.table_name.length > 0;
}

async function doesColumnExist(
  db: Awaited<ReturnType<typeof loadDb>>,
  tableName: string,
  columnName: string,
) {
  const result = await db.execute(sql`
    select 1 as present
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `);
  return getExecuteRows<{ present?: number }>(result).length > 0;
}

async function ensurePillToxicitySchema(db: Awaited<ReturnType<typeof loadDb>>) {
  if (!(await doesColumnExist(db, "players", "pill_toxicity"))) {
    await db.execute(sql`alter table "players" add column if not exists "pill_toxicity" integer not null default 0`);
  }
  if (!(await doesColumnExist(db, "players", "pill_toxicity_updated_at"))) {
    await db.execute(sql`alter table "players" add column if not exists "pill_toxicity_updated_at" text not null default NOW()::text`);
  }
  await db.execute(sql`
    update "players"
    set
      "pill_toxicity" = coalesce("pill_toxicity", 0),
      "pill_toxicity_updated_at" = coalesce(nullif("pill_toxicity_updated_at", ''), NOW()::text)
  `);

  if (!(await doesColumnExist(db, "items", "pill_toxicity"))) {
    await db.execute(sql`alter table "items" add column if not exists "pill_toxicity" integer not null default 1`);
  }

  if (!(await doesTableExist(db, "pill_toxicity_configs"))) {
    await db.execute(sql`
      create table if not exists "pill_toxicity_configs" (
        "key" text primary key not null,
        "max_toxicity" integer not null default 20,
        "recover_interval_minutes" integer not null default 8,
        "created_at" text not null,
        "updated_at" text not null
      )
    `);
  }

  await db.execute(sql`
    insert into "pill_toxicity_configs" (
      "key",
      "max_toxicity",
      "recover_interval_minutes",
      "created_at",
      "updated_at"
    )
    values (
      'default',
      20,
      8,
      NOW()::text,
      NOW()::text
    )
    on conflict ("key") do nothing
  `);
}

async function countPlayers(db: Awaited<ReturnType<typeof loadDb>>) {
  const result = await db.execute(sql`select count(*)::int as c from "players"`);
  const [row] = getExecuteRows<{ c?: number | string | bigint }>(result);
  return Number(row?.c || 0);
}

async function resetPlayerProgressIfNeeded(db: Awaited<ReturnType<typeof loadDb>>) {
  const playerCountBefore = await countPlayers(db);

  if (!RESET_PLAYER_DATA_ON_APPLY) {
    return {
      executed: false,
      playerCountBefore,
      truncatedTables: [] as string[],
    };
  }

  const candidateTables = [
    "boss_instances",
    "market_trade_records",
    "market_listings",
    "player_temporary_cosmetic_grants",
    "player_unlocked_avatar_frames",
    "player_unlocked_avatars",
    "player_inventory",
    "player_skills",
    "player_hongmeng_treasures",
    "player_quests",
    "player_npc_bounty_daily",
    "player_random_event_cooldowns",
    "map_opportunity_spawns",
    "player_fortune_attr_ledger",
    "player_fortunes",
    "cdk_redeem_logs",
    "recharge_orders",
    "player_mails",
    "player_checkin_logs",
    "chat_messages",
    "player_friendships",
    "player_intimacy_relations",
    "player_social_settings",
    "player_combat_settings",
    "dm_conversation_reads",
    "dm_messages",
    "dm_conversations",
    "party_group_members",
    "party_invites",
    "party_encounters",
    "party_groups",
    "combat_logs",
    "player_alchemy_logs",
    "player_smithing_logs",
    "plugin_gongfa_player_progress",
    "plugin_gongfa_player_points",
    "plugin_gongfa_point_logs",
    "plugin_spiritual_field_plots",
    "plugin_spiritual_field_players",
    "player_double_cultivation_logs",
    "player_double_cultivation_daily",
    "player_double_cultivation_requests",
    "player_double_cultivation_player_stats",
    "player_double_cultivation_uterus",
    "player_double_cultivation_sperm",
    "lundao_weekly_cosmetic_grants",
    "lundao_player_daily",
    "lundao_weekly_settlements",
    "plugin_immortal_raid_runs",
    "plugin_immortal_raid_scores",
    "players",
  ];

  const existingTables: string[] = [];
  for (const tableName of candidateTables) {
    if (await doesTableExist(db, tableName)) {
      existingTables.push(tableName);
    }
  }

  if (existingTables.length > 0) {
    await db.execute(sql`
      truncate table ${sql.join(existingTables.map((tableName) => sql.identifier(tableName)), sql`, `)}
      restart identity cascade
    `);
  }

  if (await doesTableExist(db, "lundao_arena_slots")) {
    await db.execute(sql`truncate table "lundao_arena_slots" restart identity`);
    await db.execute(sql`
      insert into "lundao_arena_slots" ("position", "player_id", "updated_at")
      select gs, null, NOW()::text
      from generate_series(1, 100) as gs
      on conflict ("position") do nothing
    `);
  }

  return {
    executed: true,
    playerCountBefore,
    truncatedTables: existingTables,
  };
}

async function upsertMaps(db: Awaited<ReturnType<typeof loadDb>>) {
  const { maps } = await import("../src/db/schema");
  for (const row of fourRealmsPack.maps) {
    await db.insert(maps).values(row).onConflictDoUpdate({
      target: maps.id,
      set: {
        name: row.name,
        description: row.description,
        backgroundImageUrl: row.backgroundImageUrl,
        width: row.width,
        height: row.height,
        minRealm: row.minRealm,
        mapType: row.mapType,
        tilesData: row.tilesData,
      },
    }).run();
  }
}

async function upsertNpcs(db: Awaited<ReturnType<typeof loadDb>>) {
  const { npcs } = await import("../src/db/schema");
  for (const row of fourRealmsPack.npcs) {
    await db.insert(npcs).values(row).onConflictDoUpdate({
      target: npcs.id,
      set: {
        name: row.name,
        title: row.title,
        description: row.description,
        avatarImageUrl: row.avatarImageUrl,
        portraitImageUrl: row.portraitImageUrl,
        mapId: row.mapId,
        positionX: row.positionX,
        positionY: row.positionY,
        personality: row.personality,
        isShop: row.isShop,
        shopItems: row.shopItems,
        bountyEnabled: row.bountyEnabled,
        bountyDailyLimit: row.bountyDailyLimit,
      },
    }).run();
  }
}

async function upsertSkills(db: Awaited<ReturnType<typeof loadDb>>) {
  const { skills } = await import("../src/db/schema");
  for (const row of fourRealmsPack.skills) {
    await db.insert(skills).values(row).onConflictDoUpdate({
      target: skills.id,
      set: {
        name: row.name,
        description: row.description,
        skillType: row.skillType,
        element: row.element,
        damageBase: row.damageBase,
        damageMultiplier: row.damageMultiplier,
        mpCost: row.mpCost,
        cooldown: row.cooldown,
        effects: row.effects,
        minRealm: row.minRealm,
        maxRealm: row.maxRealm,
        target: row.target,
      },
    }).run();
  }
}

async function upsertItems(db: Awaited<ReturnType<typeof loadDb>>) {
  const { items } = await import("../src/db/schema");
  for (const row of fourRealmsPack.items) {
    await db.insert(items).values(row).onConflictDoUpdate({
      target: items.id,
      set: {
        name: row.name,
        iconUrl: row.iconUrl,
        description: row.description,
        itemType: row.itemType,
        rarity: row.rarity,
        effects: row.effects,
        price: row.price,
        stackable: row.stackable,
        isBound: row.isBound,
        minRealm: row.minRealm,
        maxRealm: row.maxRealm,
        pillToxicity: row.pillToxicity ?? 0,
      },
    }).run();
  }
}

async function upsertMonsters(db: Awaited<ReturnType<typeof loadDb>>) {
  const { monsters } = await import("../src/db/schema");
  for (const row of fourRealmsPack.monsters) {
    await db.insert(monsters).values(row).onConflictDoUpdate({
      target: monsters.id,
      set: {
        name: row.name,
        iconUrl: row.iconUrl,
        description: row.description,
        monsterType: row.monsterType,
        level: row.level,
        hp: row.hp,
        attack: row.attack,
        defense: row.defense,
        speed: row.speed,
        luck: row.luck,
        spiritualSense: row.spiritualSense,
        armorPenetration: row.armorPenetration,
        block: row.block,
        skillDamageBonus: row.skillDamageBonus,
        skillDamageReduction: row.skillDamageReduction,
        artifactDamageBonus: row.artifactDamageBonus,
        artifactDamageReduction: row.artifactDamageReduction,
        skills: row.skills,
        drops: row.drops,
        xpReward: row.xpReward,
        goldReward: row.goldReward,
        mapId: row.mapId,
        positionX: row.positionX,
        positionY: row.positionY,
        aiMoveIntervalMinSeconds: row.aiMoveIntervalMinSeconds,
        aiMoveIntervalMaxSeconds: row.aiMoveIntervalMaxSeconds,
        aiMoveRange: row.aiMoveRange,
        respawnSeconds: row.respawnSeconds,
      },
    }).run();
  }
}

async function upsertQuests(db: Awaited<ReturnType<typeof loadDb>>) {
  const { quests } = await import("../src/db/schema");
  for (const row of fourRealmsPack.quests) {
    await db.insert(quests).values(row).onConflictDoUpdate({
      target: quests.id,
      set: {
        name: row.name,
        description: row.description,
        questCategory: row.questCategory,
        questType: row.questType,
        acceptNpcId: row.acceptNpcId,
        completeNpcId: row.completeNpcId,
        acceptStory: row.acceptStory,
        completeStory: row.completeStory,
        requirements: row.requirements,
        rewards: row.rewards,
        prerequisites: row.prerequisites,
        minRealm: row.minRealm,
        maxRealm: row.maxRealm,
        repeatable: row.repeatable,
      },
    }).run();
  }
}

async function upsertFortunes(db: Awaited<ReturnType<typeof loadDb>>) {
  const { fortunes } = await import("../src/db/schema");
  for (const row of fourRealmsPack.fortunes) {
    await db.insert(fortunes).values(row).onConflictDoUpdate({
      target: fortunes.id,
      set: {
        name: row.name,
        description: row.description,
        gender: row.gender,
        enabled: row.enabled,
        isHidden: row.isHidden,
        isStarter: row.isStarter,
        starterWeight: row.starterWeight,
        grade: row.grade,
        durationSeconds: row.durationSeconds,
        attrEffects: row.attrEffects,
        eventEffects: row.eventEffects,
        specialEffects: row.specialEffects,
        updatedAt: new Date().toISOString(),
      },
    }).run();
  }
}

async function upsertRandomEvents(db: Awaited<ReturnType<typeof loadDb>>) {
  const { randomEvents } = await import("../src/db/schema");
  for (const row of fourRealmsPack.randomEvents) {
    await db.insert(randomEvents).values(row).onConflictDoUpdate({
      target: randomEvents.id,
      set: {
        name: row.name,
        description: row.description,
        iconImageUrl: row.iconImageUrl,
        imageUrls: row.imageUrls,
        eventType: row.eventType,
        probability: row.probability,
        spawnIntervalSeconds: row.spawnIntervalSeconds,
        durationSeconds: row.durationSeconds,
        minRealm: row.minRealm,
        maxRealm: row.maxRealm,
        mapType: row.mapType,
        mapIds: row.mapIds,
        judgeConditions: row.judgeConditions,
        rewards: row.rewards,
        aiPrompt: row.aiPrompt,
      },
    }).run();
  }
}

async function upsertPillToxicityConfigs(db: Awaited<ReturnType<typeof loadDb>>) {
  const { pillToxicityConfigs } = await import("../src/db/schema");
  for (const row of fourRealmsPack.pillToxicityConfigs) {
    await db.insert(pillToxicityConfigs).values({
      ...row,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: pillToxicityConfigs.key,
      set: {
        maxToxicity: row.maxToxicity,
        recoverIntervalMinutes: row.recoverIntervalMinutes,
        updatedAt: new Date().toISOString(),
      },
    }).run();
  }
}

async function upsertSystemConfigs(db: Awaited<ReturnType<typeof loadDb>>) {
  const { systemConfigs } = await import("../src/db/schema");
  for (const row of fourRealmsPack.systemConfigs) {
    await db.insert(systemConfigs).values(row).onConflictDoUpdate({
      target: systemConfigs.key,
      set: {
        value: row.value,
        group: row.group,
        isSecret: row.isSecret,
        description: row.description,
        updatedAt: new Date().toISOString(),
      },
    }).run();
  }
}

async function upsertHongmengTreasureConfigs(db: Awaited<ReturnType<typeof loadDb>>) {
  const { hongmengTreasureConfigs } = await import("../src/db/schema");
  const nowIso = new Date().toISOString();
  for (const row of fourRealmsPack.hongmengTreasureConfigs) {
    await db.insert(hongmengTreasureConfigs).values({
      itemId: row.itemId,
      enabled: row.enabled,
      maxStar: row.maxStar,
      starConfigs: row.starConfigs,
      upgradeCosts: row.upgradeCosts,
      spiritualFieldEnergyCost: row.spiritualFieldEnergyCost,
      spiritualFieldReduceSeconds: row.spiritualFieldReduceSeconds,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoUpdate({
      target: hongmengTreasureConfigs.itemId,
      set: {
        enabled: row.enabled,
        maxStar: row.maxStar,
        starConfigs: row.starConfigs,
        upgradeCosts: row.upgradeCosts,
        spiritualFieldEnergyCost: row.spiritualFieldEnergyCost,
        spiritualFieldReduceSeconds: row.spiritualFieldReduceSeconds,
        updatedAt: nowIso,
      },
    }).run();
  }
}

function buildItemNameMap() {
  const map = new Map<string, string>();
  for (const item of fourRealmsPack.items) {
    map.set(item.id, item.name);
  }
  return map;
}

async function rebuildSpiritualFieldSeeds(db: Awaited<ReturnType<typeof loadDb>>) {
  const tableName = "plugin_spiritual_field_seeds";
  if (!(await doesTableExist(db, tableName))) {
    return false;
  }

  const nowIso = new Date().toISOString();
  await db.execute(sql`delete from ${sql.identifier(tableName)}`);

  for (const row of fourRealmsPack.spiritualFieldSeeds) {
    await db.execute(sql`
      insert into ${sql.identifier(tableName)}
        ("seed_item_id", "output_item_id", "name", "growth_seconds", "min_yield", "max_yield", "max_plots_per_player", "enabled", "created_at", "updated_at")
      values
        (${row.seedItemId}, ${row.outputItemId}, ${row.name}, ${row.growthSeconds}, ${row.minYield}, ${row.maxYield}, ${row.maxPlotsPerPlayer}, ${row.enabled}, ${nowIso}, ${nowIso})
    `);
  }

  return true;
}

async function rebuildRecipeTable(
  db: Awaited<ReturnType<typeof loadDb>>,
  tableName: "alchemy_recipes" | "smithing_recipes",
  recipes: typeof fourRealmsPack.alchemyRecipes,
) {
  if (!(await doesTableExist(db, tableName))) {
    return false;
  }

  const itemNameMap = buildItemNameMap();
  const nowIso = new Date().toISOString();
  await db.execute(sql`delete from ${sql.identifier(tableName)}`);

  for (const row of recipes) {
    await db.execute(sql`
      insert into ${sql.identifier(tableName)}
        (
          "result_item_id", "result_item_name", "result_quantity",
          "main_item_id", "main_item_name", "main_quantity",
          "base_success_rate",
          "aux_a_item_id", "aux_a_item_name", "aux_a_quantity", "aux_a_bonus_rate",
          "aux_b_item_id", "aux_b_item_name", "aux_b_quantity", "aux_b_bonus_rate",
          "aux_c_item_id", "aux_c_item_name", "aux_c_quantity", "aux_c_bonus_rate",
          "created_at", "updated_at"
        )
      values
        (
          ${row.resultItemId}, ${itemNameMap.get(row.resultItemId) || row.resultItemId}, ${row.resultQuantity},
          ${row.mainItemId}, ${itemNameMap.get(row.mainItemId) || row.mainItemId}, ${row.mainQuantity},
          ${row.baseSuccessRate},
          ${row.auxAItemId ?? null}, ${row.auxAItemId ? (itemNameMap.get(row.auxAItemId) || row.auxAItemId) : ""}, ${row.auxAQuantity ?? 0}, ${row.auxABonusRate ?? 0},
          ${row.auxBItemId ?? null}, ${row.auxBItemId ? (itemNameMap.get(row.auxBItemId) || row.auxBItemId) : ""}, ${row.auxBQuantity ?? 0}, ${row.auxBBonusRate ?? 0},
          ${row.auxCItemId ?? null}, ${row.auxCItemId ? (itemNameMap.get(row.auxCItemId) || row.auxCItemId) : ""}, ${row.auxCQuantity ?? 0}, ${row.auxCBonusRate ?? 0},
          ${nowIso}, ${nowIso}
        )
    `);
  }

  return true;
}

async function getAppliedVersion(db: Awaited<ReturnType<typeof loadDb>>) {
  const { systemConfigs } = await import("../src/db/schema");
  const row = await db.select({
    value: systemConfigs.value,
  }).from(systemConfigs)
    .where((await import("drizzle-orm")).eq(systemConfigs.key, PACK_APPLY_VERSION_KEY))
    .get();

  return row?.value || null;
}

async function markAppliedVersion(db: Awaited<ReturnType<typeof loadDb>>) {
  const { systemConfigs } = await import("../src/db/schema");
  const nowIso = new Date().toISOString();
  await db.insert(systemConfigs).values({
    key: PACK_APPLY_VERSION_KEY,
    value: fourRealmsPack.metadata.version,
    group: "game",
    isSecret: false,
    description: "四境离线包最近一次自动导入的版本号。",
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: systemConfigs.key,
    set: {
      value: fourRealmsPack.metadata.version,
      group: "game",
      isSecret: false,
      description: "四境离线包最近一次自动导入的版本号。",
      updatedAt: nowIso,
    },
  }).run();
}

async function rebuildMapEdges(db: Awaited<ReturnType<typeof loadDb>>) {
  const { inArray, or } = await import("drizzle-orm");
  const { mapEdges } = await import("../src/db/schema");
  const scopedMapIds = fourRealmsPack.maps.map((map) => map.id);
  await db.delete(mapEdges)
    .where(or(
      inArray(mapEdges.mapAId, scopedMapIds),
      inArray(mapEdges.mapBId, scopedMapIds),
    ))
    .run();

  for (const edge of fourRealmsPack.mapEdges) {
    await db.insert(mapEdges).values(edge).run();
  }
}

async function prepareRealmConfigImport(db: Awaited<ReturnType<typeof loadDb>>) {
  const { inArray, or } = await import("drizzle-orm");
  const {
    fortunes,
    playerFortuneAttrLedger,
    playerFortunes,
    hongmengTreasureConfigs,
    items,
    mapEdges,
    maps,
    monsters,
    npcs,
    quests,
    randomEvents,
    skills,
    systemConfigs,
  } = await import("../src/db/schema");

  const scopedMapIds = fourRealmsPack.maps.map((row) => row.id);
  const scopedNpcIds = fourRealmsPack.npcs.map((row) => row.id);
  const scopedSkillIds = fourRealmsPack.skills.map((row) => row.id);
  const scopedItemIds = fourRealmsPack.items.map((row) => row.id);
  const scopedMonsterIds = fourRealmsPack.monsters.map((row) => row.id);
  const scopedQuestIds = fourRealmsPack.quests.map((row) => row.id);
  const scopedRandomEventIds = fourRealmsPack.randomEvents.map((row) => row.id);
  const legacyFortuneIds = [...new Set(LEGACY_PREGNANCY_FORTUNE_IDS)];
  const legacyRandomEventIds = [...new Set(LEGACY_PREGNANCY_RANDOM_EVENT_IDS)];

  if (legacyFortuneIds.length > 0) {
    const legacyPlayerFortuneRows = await db.select({
      id: playerFortunes.id,
    }).from(playerFortunes).where(inArray(playerFortunes.fortuneId, legacyFortuneIds)).all();
    const legacyPlayerFortuneIds = legacyPlayerFortuneRows.map((row) => row.id);
    if (legacyPlayerFortuneIds.length > 0) {
      await db.delete(playerFortuneAttrLedger)
        .where(inArray(playerFortuneAttrLedger.playerFortuneId, legacyPlayerFortuneIds))
        .run();
      await db.delete(playerFortunes)
        .where(inArray(playerFortunes.id, legacyPlayerFortuneIds))
        .run();
    }
    await db.delete(fortunes).where(inArray(fortunes.id, legacyFortuneIds)).run();
  }

  if (legacyRandomEventIds.length > 0) {
    await db.delete(randomEvents).where(inArray(randomEvents.id, legacyRandomEventIds)).run();
  }

  if (LEGACY_PREGNANCY_SYSTEM_CONFIG_KEYS.length > 0) {
    await db.delete(systemConfigs).where(inArray(systemConfigs.key, LEGACY_PREGNANCY_SYSTEM_CONFIG_KEYS)).run();
  }

  if (scopedRandomEventIds.length > 0) {
    await db.delete(randomEvents).where(inArray(randomEvents.id, scopedRandomEventIds)).run();
  }
  if (scopedQuestIds.length > 0) {
    await db.delete(quests).where(inArray(quests.id, scopedQuestIds)).run();
  }
  if (scopedMonsterIds.length > 0) {
    await db.delete(monsters).where(inArray(monsters.id, scopedMonsterIds)).run();
  }
  if (scopedNpcIds.length > 0) {
    await db.delete(npcs).where(inArray(npcs.id, scopedNpcIds)).run();
  }
  const scopedHongmengItemIds = fourRealmsPack.hongmengTreasureConfigs.map((row) => row.itemId);
  if (scopedHongmengItemIds.length > 0) {
    await db.delete(hongmengTreasureConfigs).where(inArray(hongmengTreasureConfigs.itemId, scopedHongmengItemIds)).run();
  }
  if (scopedSkillIds.length > 0) {
    await db.delete(skills).where(inArray(skills.id, scopedSkillIds)).run();
  }
  if (scopedItemIds.length > 0) {
    await db.delete(items).where(inArray(items.id, scopedItemIds)).run();
  }
  if (scopedMapIds.length > 0) {
    await db.delete(mapEdges).where(or(
      inArray(mapEdges.mapAId, scopedMapIds),
      inArray(mapEdges.mapBId, scopedMapIds),
    )).run();
    await db.delete(maps).where(inArray(maps.id, scopedMapIds)).run();
  }
}

async function loadDb() {
  const { db } = await import("../src/db");
  return db;
}

async function main() {
  if (process.env.FOUR_REALMS_APPLY !== "1") {
    console.log(JSON.stringify({
      applied: false,
      reason: "未设置 FOUR_REALMS_APPLY=1，仅允许显式开关后写库",
      packId: fourRealmsPack.metadata.id,
    }, null, 2));
    return;
  }

  const db = await loadDb();
  const forceApply = process.env.FOUR_REALMS_APPLY_FORCE === "1";
  const appliedVersion = await getAppliedVersion(db);
  if (!forceApply && appliedVersion === fourRealmsPack.metadata.version) {
    console.log(JSON.stringify({
      applied: false,
      reason: "同版本四境离线包已导入，自动跳过",
      packId: fourRealmsPack.metadata.id,
      version: fourRealmsPack.metadata.version,
    }, null, 2));
    return;
  }

  const { importRealmConfig } = await import("../src/modules/admin/services/realm-config-mutation");

  await ensurePillToxicitySchema(db);
  const resetPlayerProgress = await resetPlayerProgressIfNeeded(db);
  const prunedLegacyData = resetPlayerProgress.executed
    ? await pruneFourRealmsLegacyData({
      execute: true,
      allowPlayers: false,
      db,
    })
    : null;
  await prepareRealmConfigImport(db);
  await importRealmConfig(fourRealmsPack.realmMajors);
  await upsertMaps(db);
  await upsertNpcs(db);
  await upsertSkills(db);
  await upsertItems(db);
  await upsertMonsters(db);
  await upsertQuests(db);
  await upsertFortunes(db);
  await upsertRandomEvents(db);
  await upsertSystemConfigs(db);
  await upsertPillToxicityConfigs(db);
  await upsertHongmengTreasureConfigs(db);
  const seededSpiritualFieldSeeds = await rebuildSpiritualFieldSeeds(db);
  const seededAlchemyRecipes = await rebuildRecipeTable(db, "alchemy_recipes", fourRealmsPack.alchemyRecipes);
  const seededSmithingRecipes = await rebuildRecipeTable(db, "smithing_recipes", fourRealmsPack.smithingRecipes);
  await rebuildMapEdges(db);
  await markAppliedVersion(db);

  console.log(JSON.stringify({
    applied: true,
    forceApply,
    version: fourRealmsPack.metadata.version,
    resetPlayerProgress,
    prunedLegacyData,
    realmMajors: fourRealmsPack.realmMajors.length,
    maps: fourRealmsPack.maps.length,
    npcs: fourRealmsPack.npcs.length,
    skills: fourRealmsPack.skills.length,
    items: fourRealmsPack.items.length,
    monsters: fourRealmsPack.monsters.length,
    quests: fourRealmsPack.quests.length,
    fortunes: fourRealmsPack.fortunes.length,
    randomEvents: fourRealmsPack.randomEvents.length,
    systemConfigs: fourRealmsPack.systemConfigs.length,
    pillToxicityConfigs: fourRealmsPack.pillToxicityConfigs.length,
    hongmengTreasureConfigs: fourRealmsPack.hongmengTreasureConfigs.length,
    spiritualFieldSeeds: fourRealmsPack.spiritualFieldSeeds.length,
    seededSpiritualFieldSeeds,
    seededAlchemyRecipes,
    seededSmithingRecipes,
  }, null, 2));
}

main().catch((error) => {
  if (error instanceof Error && error.message.includes("删除失败，存在直接引用")) {
    console.error("[four-realms] 应用失败：检测到旧角色/旧境界引用。若当前就是删档重开，请在启动环境中额外设置 FOUR_REALMS_RESET_PLAYER_DATA=1 后重试。");
  }
  console.error("[four-realms] 应用失败", error);
  process.exit(1);
});
