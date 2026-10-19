import { pgTable, text, integer, bigint, real, boolean, jsonb, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type {
  AttributeDelta,
  CdkReward,
  EventJudgeConditions,
  FortuneEventEffects,
  FortuneSpecialEffects,
  SpiritualRoot,
  SkillEffect,
  SkillEffectsPayload,
  DropItem,
  QuestRequirement,
  QuestReward,
  ItemEffect,
  RealmRewardRule,
  CombatSettleResultSnapshot,
  SecretRealmRewardPlan,
  SecretRealmLootBlueprint,
  SecretRealmRewardSnapshot,
  SecretRealmRunSummary,
  SecretRealmTemplateSnapshot,
  SecretRealmValidationReport,
  TileData,
  PlayerStatusFlowEffects,
  PregnancyStatusPayload,
  SectBuildingType,
  SectPermissionKey,
  SectRoleKey,
} from "@/types/game";

type WorldMapMetaJson = {
  layoutVersion?: number;
  theme?: string;
  districts?: string[];
  buildingTags?: string[];
  resourceThemes?: string[];
  npcCrowds?: string[];
  rumorSeeds?: string[];
  regionBand?: string;
  heatTier?: string;
  heatScore?: number;
  dangerLevel?: number;
  mysteryLevel?: number;
  travelConnections?: Array<{
    role?: string;
    targetMapId?: string;
    targetMapName?: string;
    travelType?: string;
    label?: string;
    summary?: string;
    heatTierHint?: string;
  }>;
  encounterHooks?: string[];
  secretRealmHooks?: string[];
  aiSource?: "ai" | "fallback";
  generatedAt?: string;
};

type AdultProfileMetaJson = {
  summary?: string;
  dispositionLabel?: string;
  preferenceHints?: string[];
  roleTags?: string[];
  preferenceTags?: string[];
  corruptionStageLabel?: string;
  aiSource?: "ai" | "fallback";
  generatedAt?: string;
};

type AdultEventStatChangesJson = {
  player?: Record<string, number>;
  npc?: Record<string, number>;
  world?: Record<string, number>;
};

type WorldFactionInfluenceRulesJson = {
  lawfulBase?: number;
  grayBase?: number;
  demonicBase?: number;
  localControlBase?: number;
  incidentWeights?: Record<string, number>;
  storylineBias?: Record<string, number>;
};

type WorldDistrictStateHooksJson = {
  hotspotTitles?: string[];
  rumorHints?: string[];
  nextHooks?: string[];
  lastIncidentTypes?: string[];
};

type WorldStorylinePayloadJson = {
  storylineType?: string;
  stageList?: string[];
  stageSummaryList?: string[];
  currentObjectivePointId?: string | null;
  currentObjectivePointLabel?: string | null;
  currentObjectiveDistrictName?: string | null;
  currentObjectiveMapId?: string | null;
  linkedOfferIds?: string[];
  linkedIncidentTypes?: string[];
  tags?: string[];
  aiNextMove?: string;
};

/* ============================
   账号/角色相关
   ============================ */

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const avatarAssets = pgTable("avatar_assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  gender: text("gender").notNull(), // 男/女
  isPublic: boolean("is_public").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("avatar_assets_gender_idx").on(table.gender),
  index("avatar_assets_public_enabled_idx").on(table.isPublic, table.enabled),
  index("avatar_assets_sort_order_idx").on(table.sortOrder),
]);

export const avatarFrameAssets = pgTable("avatar_frame_assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  isPublic: boolean("is_public").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("avatar_frame_assets_public_enabled_idx").on(table.isPublic, table.enabled),
  index("avatar_frame_assets_sort_order_idx").on(table.sortOrder),
]);

export const players = pgTable("players", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  // 角色数据
  name: text("name").notNull().unique(),
  gender: text("gender"),
  avatarId: text("avatar_id").references(() => avatarAssets.id),
  avatarFrameId: text("avatar_frame_id").references(() => avatarFrameAssets.id),
  spiritualRoot: jsonb("spiritual_root").$type<SpiritualRoot>(),
  realm: integer("realm").notNull().default(1),
  realmMajor: integer("realm_major").notNull().default(1),
  realmMinor: integer("realm_minor").notNull().default(1),
  realmName: text("realm_name").notNull().default("练气期一重"),
  cultivationXp: bigint("cultivation_xp", { mode: "number" }).notNull().default(0),
  pillToxicity: integer("pill_toxicity").notNull().default(0),
  pillToxicityUpdatedAt: text("pill_toxicity_updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  dongfuLastClaimAt: text("dongfu_last_claim_at").notNull().$defaultFn(() => new Date().toISOString()),
  hp: integer("hp").notNull().default(100),
  maxHp: integer("max_hp").notNull().default(100),
  mp: integer("mp").notNull().default(50),
  maxMp: integer("max_mp").notNull().default(50),
  attack: integer("attack").notNull().default(10),
  defense: integer("defense").notNull().default(5),
  speed: integer("speed").notNull().default(5),
  luck: integer("luck").notNull().default(5),
  spiritualSense: integer("spiritual_sense").notNull().default(0),
  armorPenetration: integer("armor_penetration").notNull().default(0),
  block: integer("block").notNull().default(0),
  skillDamageBonus: integer("skill_damage_bonus").notNull().default(0),
  skillDamageReduction: integer("skill_damage_reduction").notNull().default(0),
  artifactDamageBonus: integer("artifact_damage_bonus").notNull().default(0),
  artifactDamageReduction: integer("artifact_damage_reduction").notNull().default(0),
  breakthroughBonusRate: real("breakthrough_bonus_rate").notNull().default(0),
  gold: integer("gold").notNull().default(0),
  lingYu: integer("ling_yu").notNull().default(0),
  stamina: integer("stamina").notNull().default(100),
  staminaUpdatedAt: text("stamina_updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  currentMainQuestId: text("current_main_quest_id"),
  currentMapId: text("current_map_id"),
  currentMapInstanceId: text("current_map_instance_id"),
  secretRealmPityCounter: integer("secret_realm_pity_counter").notNull().default(0),
  secretRealmHongmengPityCounter: integer("secret_realm_hongmeng_pity_counter").notNull().default(0),
  secretRealmLastPersonalSpawnAt: text("secret_realm_last_personal_spawn_at"),
  wildWolfValleyMobBottlePityCounter: integer("wild_wolf_valley_mob_bottle_pity_counter").notNull().default(0),
  wildWolfValleyBossBottlePityCounter: integer("wild_wolf_valley_boss_bottle_pity_counter").notNull().default(0),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  isAlive: boolean("is_alive").notNull().default(true),
  lastSeenAt: text("last_seen_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("players_account_id_idx").on(table.accountId),
  index("players_current_map_id_idx").on(table.currentMapId),
]);

export const playerStatuses = pgTable("player_statuses", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  playerId: text("player_id").notNull().references(() => players.id),
  statusKey: text("status_key").notNull(),
  title: text("title").notNull(),
  stageKey: text("stage_key").notNull(),
  stageIndex: integer("stage_index").notNull().default(1),
  iconImageUrl: text("icon_image_url"),
  sourceType: text("source_type"),
  sourcePluginId: text("source_plugin_id"),
  sourceRef: text("source_ref"),
  startedAt: text("started_at").notNull().$defaultFn(() => new Date().toISOString()),
  nextStageAt: text("next_stage_at"),
  expiresAt: text("expires_at"),
  attrEffects: jsonb("attr_effects").$type<AttributeDelta>().notNull().default({}),
  flowEffects: jsonb("flow_effects").$type<PlayerStatusFlowEffects>().notNull().default({}),
  payload: jsonb("payload").$type<PregnancyStatusPayload | Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_statuses_player_status_idx").on(table.playerId, table.statusKey),
  index("player_statuses_player_expires_idx").on(table.playerId, table.expiresAt),
  index("player_statuses_next_stage_idx").on(table.nextStageAt),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const oauthAccounts = pgTable("oauth_accounts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerUserId: text("provider_user_id").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("oauth_accounts_provider_provider_user_id_unique").on(table.provider, table.providerUserId),
  index("oauth_accounts_account_id_idx").on(table.accountId),
]);

/* ============================
   境界配置
   ============================ */

export const realmMajors = pgTable("realm_majors", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  order: integer("order").notNull(),
  name: text("name").notNull(),
  baseHp: integer("base_hp").notNull().default(100),
  baseMp: integer("base_mp").notNull().default(50),
  baseAtk: integer("base_atk").notNull().default(10),
  baseDef: integer("base_def").notNull().default(5),
  baseSpiritualSense: integer("base_spiritual_sense").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const realmStages = pgTable("realm_stages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  majorId: integer("major_id").notNull().references(() => realmMajors.id),
  minor: integer("minor").notNull(),
  name: text("name").notNull().default("一重"),
  requiredXp: bigint("required_xp", { mode: "number" }).notNull().default(100),
  successRate: real("success_rate").notNull().default(0.9),
  failXpLossRate: real("fail_xp_loss_rate").notNull().default(0.2),
  rewardRules: jsonb("reward_rules").$type<RealmRewardRule[]>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

/* ============================
   游戏世界
   ============================ */

export const maps = pgTable("maps", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  backgroundImageUrl: text("background_image_url"),
  width: integer("width").notNull().default(10),
  height: integer("height").notNull().default(10),
  minRealm: integer("min_realm").notNull().default(1),
  mapType: text("map_type").notNull().default("field"),
  tilesData: jsonb("tiles_data").$type<TileData[]>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const temporaryMaps = pgTable("temporary_maps", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  instanceId: text("instance_id"),
  name: text("name").notNull(),
  description: text("description"),
  backgroundImageUrl: text("background_image_url"),
  width: integer("width").notNull().default(10),
  height: integer("height").notNull().default(10),
  minRealm: integer("min_realm").notNull().default(1),
  mapType: text("map_type").notNull().default("secret_realm_instance"),
  tilesData: jsonb("tiles_data").$type<TileData[]>(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("temporary_maps_instance_idx").on(table.instanceId),
  index("temporary_maps_expires_idx").on(table.expiresAt),
]);

export const mapEdges = pgTable("map_edges", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  mapAId: text("map_a_id").notNull().references(() => maps.id),
  mapBId: text("map_b_id").notNull().references(() => maps.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

/* ============================
   宗门系统
   ============================ */

export const sects = pgTable("sects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  announcement: text("announcement"),
  description: text("description"),
  state: text("state").notNull().default("active"),
  externalMapId: text("external_map_id").notNull().references(() => maps.id),
  externalPositionX: integer("external_position_x").notNull().default(0),
  externalPositionY: integer("external_position_y").notNull().default(0),
  homeMapId: text("home_map_id").notNull().references(() => maps.id),
  founderPlayerId: text("founder_player_id").notNull().references(() => players.id),
  governorPlayerId: text("governor_player_id").references(() => players.id),
  level: integer("level").notNull().default(1),
  mapSize: integer("map_size").notNull().default(6),
  memberLimit: integer("member_limit").notNull().default(10),
  storageCapacity: integer("storage_capacity").notNull().default(20),
  joinApprovalEnabled: boolean("join_approval_enabled").notNull().default(true),
  visitorApprovalEnabled: boolean("visitor_approval_enabled").notNull().default(true),
  emptySinceAt: text("empty_since_at"),
  governanceRefreshedAt: text("governance_refreshed_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("sects_home_map_unique_idx").on(table.homeMapId),
  uniqueIndex("sects_external_position_unique_idx").on(table.externalMapId, table.externalPositionX, table.externalPositionY),
  index("sects_state_idx").on(table.state),
  index("sects_empty_since_idx").on(table.emptySinceAt),
  index("sects_founder_idx").on(table.founderPlayerId),
  index("sects_governor_idx").on(table.governorPlayerId),
]);

export const sectMembers = pgTable("sect_members", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  sectId: text("sect_id").notNull().references(() => sects.id),
  roleKey: text("role_key").notNull().default("outer_disciple"),
  joinedAt: text("joined_at").notNull().$defaultFn(() => new Date().toISOString()),
  appointedByPlayerId: text("appointed_by_player_id").references(() => players.id),
  /**
   * presence 字段：宗门成员在线 / 驻地在场状态。
   * 实时房间是权威来源，这里只做断线后的兜底读，写入允许 best-effort。
   */
  presenceState: text("presence_state").notNull().default("offline"),
  presenceAtHome: boolean("presence_at_home").notNull().default(false),
  presenceMapId: text("presence_map_id"),
  presenceUpdatedAt: text("presence_updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("sect_members_sect_player_unique_idx").on(table.sectId, table.playerId),
  index("sect_members_sect_role_idx").on(table.sectId, table.roleKey),
  index("sect_members_sect_presence_idx").on(table.sectId, table.presenceState),
  index("sect_members_sect_home_idx").on(table.sectId, table.presenceAtHome),
]);

export const sectRolePermissions = pgTable("sect_role_permissions", {
  sectId: text("sect_id").notNull().references(() => sects.id),
  roleKey: text("role_key").$type<SectRoleKey>().notNull(),
  permissionKey: text("permission_key").$type<SectPermissionKey>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.sectId, table.roleKey, table.permissionKey] }),
  index("sect_role_permissions_role_idx").on(table.sectId, table.roleKey),
]);

export const sectApplications = pgTable("sect_applications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sectId: text("sect_id").notNull().references(() => sects.id),
  playerId: text("player_id").notNull().references(() => players.id),
  type: text("type").notNull().default("join"),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  reviewedByPlayerId: text("reviewed_by_player_id").references(() => players.id),
  respondedAt: text("responded_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("sect_applications_sect_status_idx").on(table.sectId, table.type, table.status),
  index("sect_applications_player_status_idx").on(table.playerId, table.status),
]);

export const sectBuildings = pgTable("sect_buildings", {
  sectId: text("sect_id").notNull().references(() => sects.id),
  buildingType: text("building_type").$type<SectBuildingType>().notNull(),
  name: text("name").notNull(),
  level: integer("level").notNull().default(1),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  description: text("description"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.sectId, table.buildingType] }),
]);

export const sectResources = pgTable("sect_resources", {
  sectId: text("sect_id").primaryKey().references(() => sects.id),
  spiritStone: integer("spirit_stone").notNull().default(0),
  wood: integer("wood").notNull().default(0),
  stone: integer("stone").notNull().default(0),
  sectMaterial: integer("sect_material").notNull().default(0),
  storageCapacity: integer("storage_capacity").notNull().default(20),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const sectStorageItems = pgTable("sect_storage_items", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  sectId: text("sect_id").notNull().references(() => sects.id),
  slotIndex: integer("slot_index").notNull(),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: integer("quantity").notNull().default(1),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("sect_storage_items_slot_unique_idx").on(table.sectId, table.slotIndex),
  index("sect_storage_items_sect_idx").on(table.sectId),
]);

export const sectLogs = pgTable("sect_logs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  sectId: text("sect_id").notNull().references(() => sects.id),
  actorPlayerId: text("actor_player_id").references(() => players.id),
  actionType: text("action_type").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("sect_logs_sect_created_idx").on(table.sectId, table.createdAt),
]);

export const worldMapInstances = pgTable("world_map_instances", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  archetype: text("archetype").notNull(),
  seed: text("seed").notNull(),
  status: text("status").notNull().default("active"),
  width: integer("width").notNull().default(128),
  height: integer("height").notNull().default(128),
  minRealm: integer("min_realm").notNull().default(1),
  heatTier: text("heat_tier").notNull().default("cold"),
  heatScore: integer("heat_score").notNull().default(0),
  regionBand: text("region_band").notNull().default("凡尘城镇带"),
  dangerLevel: integer("danger_level").notNull().default(0),
  mysteryLevel: integer("mystery_level").notNull().default(0),
  description: text("description"),
  backgroundImageUrl: text("background_image_url"),
  metaJson: jsonb("meta_json").$type<WorldMapMetaJson>().notNull().default({}),
  travelConnectionsJson: jsonb("travel_connections_json").$type<WorldMapMetaJson["travelConnections"]>().notNull().default([]),
  rumorHooksJson: jsonb("rumor_hooks_json").$type<string[]>().notNull().default([]),
  encounterHooksJson: jsonb("encounter_hooks_json").$type<string[]>().notNull().default([]),
  secretRealmHooksJson: jsonb("secret_realm_hooks_json").$type<string[]>().notNull().default([]),
  tilesData: jsonb("tiles_data").$type<TileData[]>(),
  spawnMapId: text("spawn_map_id"),
  spawnPositionX: integer("spawn_position_x").notNull().default(8),
  spawnPositionY: integer("spawn_position_y").notNull().default(8),
  frozenAt: text("frozen_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_map_instances_status_idx").on(table.status),
  index("world_map_instances_expires_idx").on(table.expiresAt),
  index("world_map_instances_archetype_idx").on(table.archetype),
  index("world_map_instances_heat_tier_idx").on(table.heatTier),
  index("world_map_instances_region_band_idx").on(table.regionBand),
]);

export const worldMapPortals = pgTable("world_map_portals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  worldMapId: text("world_map_id").notNull().references(() => worldMapInstances.id),
  portalName: text("portal_name").notNull(),
  positionX: integer("position_x").notNull(),
  positionY: integer("position_y").notNull(),
  targetWorldMapId: text("target_world_map_id").notNull().references(() => worldMapInstances.id),
  targetPositionX: integer("target_position_x").notNull(),
  targetPositionY: integer("target_position_y").notNull(),
  bidirectionalGroupKey: text("bidirectional_group_key").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_map_portals_map_idx").on(table.worldMapId),
  index("world_map_portals_target_idx").on(table.targetWorldMapId),
  index("world_map_portals_group_idx").on(table.bidirectionalGroupKey),
]);

export const worldNpcProfiles = pgTable("world_npc_profiles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  worldMapId: text("world_map_id").notNull().references(() => worldMapInstances.id),
  name: text("name").notNull(),
  gender: text("gender"),
  originType: text("origin_type"),
  profession: text("profession"),
  faction: text("faction"),
  realmName: text("realm_name").notNull().default("练气期一重"),
  realmMajor: integer("realm_major").notNull().default(1),
  realmMinor: integer("realm_minor").notNull().default(1),
  personalitySummary: text("personality_summary").notNull().default(""),
  dnaSeed: text("dna_seed").notNull(),
  traitTags: jsonb("trait_tags").$type<string[]>().notNull().default([]),
  behaviorWeights: jsonb("behavior_weights").$type<Record<string, number>>().notNull().default({}),
  statsSummary: jsonb("stats_summary").$type<Record<string, number>>().notNull().default({}),
  lifeStage: text("life_stage").notNull().default("adult"),
  reincarnationCount: integer("reincarnation_count").notNull().default(0),
  isKillable: boolean("is_killable").notNull().default(true),
  status: text("status").notNull().default("active"),
  avatarImageUrl: text("avatar_image_url"),
  portraitImageUrl: text("portrait_image_url"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_npc_profiles_world_map_idx").on(table.worldMapId),
  index("world_npc_profiles_status_idx").on(table.status),
  index("world_npc_profiles_realm_idx").on(table.realmMajor, table.realmMinor),
]);

export const worldNpcRuntime = pgTable("world_npc_runtime", {
  npcId: text("npc_id").primaryKey().references(() => worldNpcProfiles.id),
  currentMapId: text("current_map_id").notNull().references(() => worldMapInstances.id),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  currentAction: text("current_action").notNull().default("idle"),
  currentTargetType: text("current_target_type"),
  currentTargetId: text("current_target_id"),
  currentActionLabel: text("current_action_label"),
  isActivated: boolean("is_activated").notNull().default(false),
  occupiedByCombatId: text("occupied_by_combat_id"),
  nextActionAt: text("next_action_at"),
  lastActionAt: text("last_action_at"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_npc_runtime_map_idx").on(table.currentMapId),
  index("world_npc_runtime_action_idx").on(table.currentAction),
  index("world_npc_runtime_combat_idx").on(table.occupiedByCombatId),
]);

export const worldNpcInventory = pgTable("world_npc_inventory", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  npcId: text("npc_id").notNull().references(() => worldNpcProfiles.id),
  itemId: text("item_id").notNull().references(() => items.id),
  itemNameSnapshot: text("item_name_snapshot"),
  itemIconUrl: text("item_icon_url"),
  quantity: integer("quantity").notNull().default(1),
  isEquipped: boolean("is_equipped").notNull().default(false),
  isLootable: boolean("is_lootable").notNull().default(true),
  slotType: text("slot_type"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_npc_inventory_npc_idx").on(table.npcId),
  index("world_npc_inventory_item_idx").on(table.itemId),
]);

export const worldNpcLifeLogs = pgTable("world_npc_life_logs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  npcId: text("npc_id").notNull().references(() => worldNpcProfiles.id),
  logType: text("log_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_npc_life_logs_npc_idx").on(table.npcId),
  index("world_npc_life_logs_type_idx").on(table.logType),
  index("world_npc_life_logs_created_idx").on(table.createdAt),
]);

export const worldLocalMessages = pgTable("world_local_messages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  mapId: text("map_id").notNull(),
  districtName: text("district_name"),
  speakerType: text("speaker_type").notNull().default("player"),
  speakerPlayerId: text("speaker_player_id").references(() => players.id),
  speakerNpcId: text("speaker_npc_id").references(() => worldNpcProfiles.id),
  speakerName: text("speaker_name").notNull(),
  content: text("content").notNull(),
  /**
   * 附近频道消息幂等键。
   *
   * 边界约定：附近频道的持久化唯一入口是核心 API `POST /api/game/chat/nearby`，
   * `SocialRoom` 只做同图实时广播回声，不写库。因此同一条消息会同时出现在
   * 「SSE 持久化回灌」和「房间广播回声」两条链路上，客户端必须靠本键去重，
   * 保证一条消息只渲染一次。
   *
   * 键由发送方生成：`${playerId}:${clientMessageId}`。NULL 不参与唯一冲突，
   * 因此旧数据与 NPC / 天道系统消息无需回填。
   */
  dedupeKey: text("dedupe_key"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_local_messages_map_id_idx").on(table.mapId, table.id),
  index("world_local_messages_map_district_id_idx").on(table.mapId, table.districtName, table.id),
  index("world_local_messages_created_idx").on(table.createdAt),
  uniqueIndex("world_local_messages_dedupe_key_unique_idx").on(table.mapId, table.dedupeKey),
]);

export const playerWorldProfiles = pgTable("player_world_profiles", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  notorietyScore: integer("notoriety_score").notNull().default(0),
  bountyHeat: integer("bounty_heat").notNull().default(0),
  shadowFavor: integer("shadow_favor").notNull().default(0),
  lawfulPressure: integer("lawful_pressure").notNull().default(0),
  activeAlertTier: text("active_alert_tier").notNull().default("observe"),
  activeWatcherCount: integer("active_watcher_count").notNull().default(0),
  lastDecayAt: text("last_decay_at").notNull().$defaultFn(() => new Date().toISOString()),
  flagsJson: jsonb("flags_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_world_profiles_alert_idx").on(table.activeAlertTier),
  index("player_world_profiles_bounty_idx").on(table.bountyHeat),
  index("player_world_profiles_shadow_idx").on(table.shadowFavor),
]);

export const playerWorldIncidents = pgTable("player_world_incidents", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  incidentType: text("incident_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  mapId: text("map_id"),
  districtName: text("district_name"),
  severity: integer("severity").notNull().default(1),
  summary: text("summary").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_world_incidents_player_created_idx").on(table.playerId, table.createdAt),
  index("player_world_incidents_player_type_idx").on(table.playerId, table.incidentType),
  index("player_world_incidents_map_idx").on(table.mapId),
]);

export const playerWorldEventOffers = pgTable("player_world_event_offers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  playerId: text("player_id").notNull().references(() => players.id),
  offerType: text("offer_type").notNull(),
  sourceFaction: text("source_faction"),
  sourceNpcId: text("source_npc_id").references(() => worldNpcProfiles.id),
  status: text("status").notNull().default("pending"),
  summary: text("summary").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: text("expires_at").notNull(),
  respondedAt: text("responded_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_world_event_offers_player_status_idx").on(table.playerId, table.status),
  index("player_world_event_offers_expires_idx").on(table.expiresAt),
  index("player_world_event_offers_type_idx").on(table.offerType),
]);

export const worldFactions = pgTable("world_factions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tone: text("tone").notNull().default(""),
  description: text("description").notNull().default(""),
  surfaceLabel: text("surface_label"),
  aiPromptHint: text("ai_prompt_hint"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  influenceRulesJson: jsonb("influence_rules_json").$type<WorldFactionInfluenceRulesJson>().notNull().default({}),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_factions_category_idx").on(table.category),
  index("world_factions_enabled_idx").on(table.isEnabled),
]);

export const worldDistrictStates = pgTable("world_district_states", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => worldMapInstances.id),
  districtName: text("district_name").notNull(),
  districtIndex: integer("district_index").notNull().default(0),
  dominantFactionId: text("dominant_faction_id").references(() => worldFactions.id),
  lawfulInfluence: integer("lawful_influence").notNull().default(0),
  grayInfluence: integer("gray_influence").notNull().default(0),
  demonicInfluence: integer("demonic_influence").notNull().default(0),
  localControl: integer("local_control").notNull().default(0),
  tensionLevel: integer("tension_level").notNull().default(0),
  tensionTag: text("tension_tag"),
  hotspotSummary: text("hotspot_summary"),
  activeHooksJson: jsonb("active_hooks_json").$type<WorldDistrictStateHooksJson>().notNull().default({}),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("world_district_states_map_district_unique_idx").on(table.mapId, table.districtName),
  index("world_district_states_map_idx").on(table.mapId),
  index("world_district_states_dominant_idx").on(table.dominantFactionId),
]);

export const worldStorylines = pgTable("world_storylines", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => worldMapInstances.id),
  districtStateId: text("district_state_id").references(() => worldDistrictStates.id),
  districtName: text("district_name").notNull(),
  storylineType: text("storyline_type").notNull(),
  status: text("status").notNull().default("active"),
  sourceFactionId: text("source_faction_id").references(() => worldFactions.id),
  stageIndex: integer("stage_index").notNull().default(1),
  stageKey: text("stage_key").notNull(),
  stageTitle: text("stage_title").notNull(),
  summary: text("summary").notNull().default(""),
  objectivePointId: text("objective_point_id"),
  keyNpcIdsJson: jsonb("key_npc_ids_json").$type<string[]>().notNull().default([]),
  payloadJson: jsonb("payload_json").$type<WorldStorylinePayloadJson>().notNull().default({}),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_storylines_map_status_idx").on(table.mapId, table.status),
  index("world_storylines_type_idx").on(table.storylineType),
  index("world_storylines_faction_idx").on(table.sourceFactionId),
  index("world_storylines_district_idx").on(table.districtName),
]);

export const worldStorylineParticipants = pgTable("world_storyline_participants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  storylineId: text("storyline_id").notNull().references(() => worldStorylines.id),
  participantType: text("participant_type").notNull(),
  participantId: text("participant_id").notNull(),
  factionId: text("faction_id").references(() => worldFactions.id),
  roleLabel: text("role_label"),
  status: text("status").notNull().default("active"),
  metaJson: jsonb("meta_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("world_storyline_participants_unique_idx").on(table.storylineId, table.participantType, table.participantId),
  index("world_storyline_participants_storyline_idx").on(table.storylineId),
  index("world_storyline_participants_faction_idx").on(table.factionId),
]);

export const playerAdultProfiles = pgTable("player_adult_profiles", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  corruptionValue: integer("corruption_value").notNull().default(0),
  allureValue: integer("allure_value").notNull().default(0),
  shameValue: integer("shame_value").notNull().default(100),
  adultPreferenceTags: jsonb("adult_preference_tags").$type<string[]>().notNull().default([]),
  metaJson: jsonb("meta_json").$type<AdultProfileMetaJson>().notNull().default({}),
  lastAdultActionAt: text("last_adult_action_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_adult_profiles_corruption_idx").on(table.corruptionValue),
  index("player_adult_profiles_allure_idx").on(table.allureValue),
]);

export const worldNpcAdultProfiles = pgTable("world_npc_adult_profiles", {
  npcId: text("npc_id").primaryKey().references(() => worldNpcProfiles.id),
  desireValue: integer("desire_value").notNull().default(0),
  corruptionValue: integer("corruption_value").notNull().default(0),
  cautionValue: integer("caution_value").notNull().default(0),
  adultRoleTags: jsonb("adult_role_tags").$type<string[]>().notNull().default([]),
  adultPreferenceTags: jsonb("adult_preference_tags").$type<string[]>().notNull().default([]),
  metaJson: jsonb("meta_json").$type<AdultProfileMetaJson>().notNull().default({}),
  lastInviteAt: text("last_invite_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_npc_adult_profiles_corruption_idx").on(table.corruptionValue),
  index("world_npc_adult_profiles_desire_idx").on(table.desireValue),
]);

export const worldAdultEventLogs = pgTable("world_adult_event_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  playerId: text("player_id").notNull().references(() => players.id),
  worldNpcId: text("world_npc_id").notNull().references(() => worldNpcProfiles.id),
  mapId: text("map_id"),
  districtName: text("district_name"),
  eventType: text("event_type").notNull(),
  actionType: text("action_type").notNull(),
  initiatedBy: text("initiated_by").notNull().default("player"),
  negotiationOutcome: text("negotiation_outcome"),
  resolutionDecision: text("resolution_decision"),
  status: text("status").notNull().default("pending"),
  accepted: boolean("accepted").notNull().default(false),
  summary: text("summary").notNull().default(""),
  atmosphereSummary: text("atmosphere_summary"),
  resultSummary: text("result_summary"),
  statChangesJson: jsonb("stat_changes_json").$type<AdultEventStatChangesJson>().notNull().default({}),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: text("expires_at"),
  respondedAt: text("responded_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("world_adult_event_logs_player_status_idx").on(table.playerId, table.status),
  index("world_adult_event_logs_npc_created_idx").on(table.worldNpcId, table.createdAt),
  index("world_adult_event_logs_map_created_idx").on(table.mapId, table.createdAt),
]);

export const npcs = pgTable("npcs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  title: text("title"),
  description: text("description"),
  avatarImageUrl: text("avatar_image_url"),
  portraitImageUrl: text("portrait_image_url"),
  mapId: text("map_id").references(() => maps.id),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  personality: text("personality").notNull(),
  isShop: boolean("is_shop").notNull().default(false),
  shopItems: jsonb("shop_items").$type<{ itemId: string; price: number }[]>(),
  bountyEnabled: boolean("bounty_enabled").notNull().default(false),
  bountyDailyLimit: integer("bounty_daily_limit").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const monsters = pgTable("monsters", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  iconUrl: text("icon_url"),
  description: text("description"),
  monsterType: text("monster_type").notNull().default("normal"), // normal/elite/boss
  level: integer("level").notNull().default(1),
  hp: integer("hp").notNull().default(50),
  attack: integer("attack").notNull().default(8),
  defense: integer("defense").notNull().default(3),
  speed: integer("speed").notNull().default(5),
  luck: integer("luck").notNull().default(0),
  spiritualSense: integer("spiritual_sense").notNull().default(0),
  armorPenetration: integer("armor_penetration").notNull().default(0),
  block: integer("block").notNull().default(0),
  skillDamageBonus: integer("skill_damage_bonus").notNull().default(0),
  skillDamageReduction: integer("skill_damage_reduction").notNull().default(0),
  artifactDamageBonus: integer("artifact_damage_bonus").notNull().default(0),
  artifactDamageReduction: integer("artifact_damage_reduction").notNull().default(0),
  skills: jsonb("skills").$type<string[]>(),
  drops: jsonb("drops").$type<DropItem[]>(),
  xpReward: integer("xp_reward").notNull().default(10),
  goldReward: integer("gold_reward").notNull().default(5),
  mapId: text("map_id").notNull().references(() => maps.id),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  currentPositionX: integer("current_position_x"),
  currentPositionY: integer("current_position_y"),
  nextAiMoveAt: text("next_ai_move_at"),
  positionUpdatedAt: text("position_updated_at"),
  aiMoveIntervalMinSeconds: integer("ai_move_interval_min_seconds"),
  aiMoveIntervalMaxSeconds: integer("ai_move_interval_max_seconds"),
  aiMoveRange: integer("ai_move_range"),
  respawnSeconds: integer("respawn_seconds").notNull().default(60),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const temporaryMonsters = pgTable("temporary_monsters", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  instanceId: text("instance_id"),
  name: text("name").notNull(),
  iconUrl: text("icon_url"),
  description: text("description"),
  monsterType: text("monster_type").notNull().default("normal"),
  level: integer("level").notNull().default(1),
  hp: integer("hp").notNull().default(50),
  attack: integer("attack").notNull().default(8),
  defense: integer("defense").notNull().default(3),
  speed: integer("speed").notNull().default(5),
  luck: integer("luck").notNull().default(0),
  spiritualSense: integer("spiritual_sense").notNull().default(0),
  armorPenetration: integer("armor_penetration").notNull().default(0),
  block: integer("block").notNull().default(0),
  skillDamageBonus: integer("skill_damage_bonus").notNull().default(0),
  skillDamageReduction: integer("skill_damage_reduction").notNull().default(0),
  artifactDamageBonus: integer("artifact_damage_bonus").notNull().default(0),
  artifactDamageReduction: integer("artifact_damage_reduction").notNull().default(0),
  skills: jsonb("skills").$type<string[]>(),
  drops: jsonb("drops").$type<DropItem[]>(),
  xpReward: integer("xp_reward").notNull().default(10),
  goldReward: integer("gold_reward").notNull().default(5),
  mapId: text("map_id").notNull(),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  currentPositionX: integer("current_position_x"),
  currentPositionY: integer("current_position_y"),
  nextAiMoveAt: text("next_ai_move_at"),
  positionUpdatedAt: text("position_updated_at"),
  aiMoveIntervalMinSeconds: integer("ai_move_interval_min_seconds"),
  aiMoveIntervalMaxSeconds: integer("ai_move_interval_max_seconds"),
  aiMoveRange: integer("ai_move_range"),
  respawnSeconds: integer("respawn_seconds").notNull().default(60),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("temporary_monsters_instance_idx").on(table.instanceId),
  index("temporary_monsters_map_idx").on(table.mapId),
  index("temporary_monsters_type_idx").on(table.monsterType),
  index("temporary_monsters_expires_idx").on(table.expiresAt),
]);

export const bossInstances = pgTable("boss_instances", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  monsterId: text("monster_id").notNull(),
  currentHp: integer("current_hp").notNull(),
  maxHp: integer("max_hp").notNull(),
  lastHitPlayerId: text("last_hit_player_id"),
  status: text("status").notNull().default("alive"), // alive/dead
  damageMap: jsonb("damage_map").$type<Record<string, number>>(), // playerId -> total damage
  spawnedAt: text("spawned_at").notNull().$defaultFn(() => new Date().toISOString()),
  killedAt: text("killed_at"),
  nextSpawnAt: text("next_spawn_at"),
});

export const secretRealmTemplates = pgTable("secret_realm_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sourceType: text("source_type").notNull().default("fallback"),
  status: text("status").notNull().default("ready"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  announcement: text("announcement").notNull().default(""),
  theme: text("theme").notNull().default("幽谷古境"),
  bossBackground: text("boss_background").notNull().default(""),
  sizeTier: text("size_tier").notNull().default("small"),
  rarity: text("rarity").notNull().default("common"),
  recommendedRealm: integer("recommended_realm").notNull().default(1),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  rewardBudget: integer("reward_budget").notNull().default(100),
  snapshotJson: jsonb("snapshot_json").$type<SecretRealmTemplateSnapshot>().notNull(),
  bossPool: jsonb("boss_pool").$type<string[]>().notNull().default([]),
  validationReport: jsonb("validation_report").$type<SecretRealmValidationReport>(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("secret_realm_templates_status_idx").on(table.status),
  index("secret_realm_templates_realm_size_idx").on(table.recommendedRealm, table.sizeTier),
  index("secret_realm_templates_rarity_idx").on(table.rarity),
]);

export const secretRealmSpawns = pgTable("secret_realm_spawns", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateId: text("template_id").notNull().references(() => secretRealmTemplates.id),
  mapId: text("map_id").notNull().references(() => maps.id),
  instanceId: text("instance_id"),
  spawnType: text("spawn_type").notNull().default("global"),
  status: text("status").notNull().default("active"),
  ownerPlayerId: text("owner_player_id").references(() => players.id),
  visiblePlayerIds: jsonb("visible_player_ids").$type<string[]>().notNull().default([]),
  positionX: integer("position_x").notNull(),
  positionY: integer("position_y").notNull(),
  spawnedAt: text("spawned_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  enteredAt: text("entered_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("secret_realm_spawns_map_status_idx").on(table.mapId, table.status),
  index("secret_realm_spawns_owner_status_idx").on(table.ownerPlayerId, table.status),
  index("secret_realm_spawns_expires_idx").on(table.expiresAt),
]);

export const mapInstances = pgTable("map_instances", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mapId: text("map_id").notNull(),
  sourceSpawnId: text("source_spawn_id").references(() => secretRealmSpawns.id),
  templateId: text("template_id").references(() => secretRealmTemplates.id),
  instanceType: text("instance_type").notNull().default("secret_realm"),
  accessType: text("access_type").notNull().default("global"),
  status: text("status").notNull().default("active"),
  ownerPlayerId: text("owner_player_id").references(() => players.id),
  sourceMapId: text("source_map_id").references(() => maps.id),
  sourceMapName: text("source_map_name"),
  sourcePositionX: integer("source_position_x").notNull().default(0),
  sourcePositionY: integer("source_position_y").notNull().default(0),
  returnPortalX: integer("return_portal_x").notNull().default(0),
  returnPortalY: integer("return_portal_y").notNull().default(0),
  bossMonsterId: text("boss_monster_id"),
  rarity: text("rarity").notNull().default("common"),
  recommendedRealm: integer("recommended_realm").notNull().default(1),
  expiresAt: text("expires_at").notNull(),
  settledAt: text("settled_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("map_instances_map_status_idx").on(table.mapId, table.status),
  index("map_instances_source_spawn_idx").on(table.sourceSpawnId),
  index("map_instances_owner_status_idx").on(table.ownerPlayerId, table.status),
  index("map_instances_expires_idx").on(table.expiresAt),
]);

export const mapInstanceMembers = pgTable("map_instance_members", {
  instanceId: text("instance_id").notNull().references(() => mapInstances.id),
  playerId: text("player_id").notNull().references(() => players.id),
  status: text("status").notNull().default("active"),
  role: text("role").notNull().default("member"),
  returnMapId: text("return_map_id").references(() => maps.id),
  returnMapName: text("return_map_name"),
  returnPositionX: integer("return_position_x").notNull().default(0),
  returnPositionY: integer("return_position_y").notNull().default(0),
  joinedAt: text("joined_at").notNull().$defaultFn(() => new Date().toISOString()),
  leftAt: text("left_at"),
  lastSeenAt: text("last_seen_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.instanceId, table.playerId] }),
  index("map_instance_members_player_status_idx").on(table.playerId, table.status),
]);

export const mapInstanceMonsters = pgTable("map_instance_monsters", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  instanceId: text("instance_id").notNull().references(() => mapInstances.id),
  monsterId: text("monster_id").notNull(),
  role: text("role").notNull().default("normal"),
  rarity: text("rarity").notNull().default("common"),
  spawnX: integer("spawn_x").notNull().default(0),
  spawnY: integer("spawn_y").notNull().default(0),
  rewardPlan: jsonb("reward_plan").$type<SecretRealmRewardPlan>(),
  lootBlueprintJson: jsonb("loot_blueprint_json").$type<SecretRealmLootBlueprint>(),
  status: text("status").notNull().default("alive"),
  defeatedAt: text("defeated_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("map_instance_monsters_instance_role_idx").on(table.instanceId, table.role),
  index("map_instance_monsters_monster_idx").on(table.monsterId),
]);

export const secretRealmRuns = pgTable("secret_realm_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  instanceId: text("instance_id").notNull().references(() => mapInstances.id),
  templateId: text("template_id").references(() => secretRealmTemplates.id),
  spawnType: text("spawn_type").notNull().default("global"),
  ownerPlayerId: text("owner_player_id").references(() => players.id),
  status: text("status").notNull().default("ongoing"),
  summaryJson: jsonb("summary_json").$type<SecretRealmRunSummary>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  finishedAt: text("finished_at"),
}, (table) => [
  index("secret_realm_runs_instance_status_idx").on(table.instanceId, table.status),
  index("secret_realm_runs_owner_status_idx").on(table.ownerPlayerId, table.status),
]);

export const secretRealmRewardClaims = pgTable("secret_realm_reward_claims", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("run_id").references(() => secretRealmRuns.id),
  instanceId: text("instance_id").notNull().references(() => mapInstances.id),
  monsterId: text("monster_id").notNull(),
  playerId: text("player_id").notNull().references(() => players.id),
  role: text("role").notNull().default("normal"),
  status: text("status").notNull().default("claimed"),
  xp: integer("xp").notNull().default(0),
  gold: integer("gold").notNull().default(0),
  noRewardReason: text("no_reward_reason"),
  rewardSnapshot: jsonb("reward_snapshot").$type<SecretRealmRewardSnapshot>().notNull().default({ xp: 0, gold: 0, drops: [] }),
  grantedItemIds: jsonb("granted_item_ids").$type<string[]>().notNull().default([]),
  claimedAt: text("claimed_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("secret_realm_reward_claims_instance_monster_player_unique").on(table.instanceId, table.monsterId, table.playerId),
  index("secret_realm_reward_claims_run_idx").on(table.runId),
  index("secret_realm_reward_claims_player_idx").on(table.playerId),
  index("secret_realm_reward_claims_monster_idx").on(table.monsterId),
]);

/* ============================
   技能与物品
   ============================ */

export const skills = pgTable("skills", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  skillType: text("skill_type").notNull().default("attack"),
  element: text("element"),
  damageBase: integer("damage_base").notNull().default(0),
  damageMultiplier: real("damage_multiplier").notNull().default(1.0),
  mpCost: integer("mp_cost").notNull().default(10),
  cooldown: integer("cooldown").notNull().default(0),
  effects: jsonb("effects").$type<SkillEffect[] | SkillEffectsPayload | null>(),
  minRealm: integer("min_realm"),
  maxRealm: integer("max_realm"),
  target: text("target").notNull().default("enemy"), // self/enemy/all_enemies
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const items = pgTable("items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateItemId: text("template_item_id"),
  name: text("name").notNull(),
  iconUrl: text("icon_url"),
  description: text("description"),
  itemType: text("item_type").notNull().default("consumable"),
  rarity: text("rarity").notNull().default("common"),
  effects: jsonb("effects").$type<ItemEffect[]>(),
  pillToxicity: integer("pill_toxicity").notNull().default(1),
  price: integer("price").notNull().default(0),
  stackable: boolean("stackable").notNull().default(true),
  isBound: boolean("is_bound").notNull().default(false),
  minRealm: integer("min_realm"),
  maxRealm: integer("max_realm"),
  sourceType: text("source_type"),
  sourceInstanceId: text("source_instance_id"),
  sourceMonsterId: text("source_monster_id"),
  sourcePlayerId: text("source_player_id"),
  sourceCategory: text("source_category"),
  generatedSeed: text("generated_seed"),
  sourceMeta: jsonb("source_meta").$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("items_template_item_idx").on(table.templateItemId),
  index("items_source_instance_idx").on(table.sourceInstanceId),
  index("items_source_type_idx").on(table.sourceType),
  index("items_source_player_idx").on(table.sourcePlayerId),
]);

export const pillToxicityConfigs = pgTable("pill_toxicity_configs", {
  key: text("key").primaryKey(),
  maxToxicity: integer("max_toxicity").notNull().default(20),
  recoverIntervalMinutes: integer("recover_interval_minutes").notNull().default(8),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export type HongmengTreasureStarConfig = {
  star: number;
  energyCap: number;
  regenSecondsPerEnergy: number;
};

export type HongmengTreasureUpgradeCost = {
  fromStar: number;
  costItemId: string;
  costQuantity: number;
};

export const hongmengTreasureConfigs = pgTable("hongmeng_treasure_configs", {
  itemId: text("item_id").primaryKey().references(() => items.id),
  enabled: boolean("enabled").notNull().default(true),
  maxStar: integer("max_star").notNull().default(5),
  starConfigs: jsonb("star_configs").$type<HongmengTreasureStarConfig[] | null>(),
  upgradeCosts: jsonb("upgrade_costs").$type<HongmengTreasureUpgradeCost[] | null>(),
  spiritualFieldEnergyCost: integer("spiritual_field_energy_cost").notNull().default(60),
  spiritualFieldReduceSeconds: integer("spiritual_field_reduce_seconds").notNull().default(60 * 60),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("hongmeng_treasure_configs_enabled_idx").on(table.enabled),
]);

export const playerHongmengTreasures = pgTable("player_hongmeng_treasures", {
  playerId: text("player_id").notNull().references(() => players.id),
  itemId: text("item_id").notNull().references(() => items.id),
  star: integer("star").notNull().default(0),
  energy: integer("energy").notNull().default(0),
  energyUpdatedAt: text("energy_updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.playerId, table.itemId] }),
  index("player_hongmeng_treasures_player_idx").on(table.playerId),
]);

export const playerSkills = pgTable("player_skills", {
  playerId: text("player_id").notNull().references(() => players.id),
  skillId: text("skill_id").notNull().references(() => skills.id),
  level: integer("level").notNull().default(1),
});

export const playerInventory = pgTable("player_inventory", {
  playerId: text("player_id").notNull().references(() => players.id),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: integer("quantity").notNull().default(1),
  equipped: boolean("equipped").notNull().default(false),
  equipSlot: text("equip_slot"),
  /** 强化（精炼）等级，0 表示未强化。 */
  refineLevel: integer("refine_level").notNull().default(0),
  /**
   * 阶段系数：装备基础值在 items.effects 里是写死的，
   * 这里按玩家当时的小境界给实例一个倍率（见 equipment-instance-service）。
   */
  stageMult: real("stage_mult").notNull().default(1),
  /** 生成该系数时玩家的境界，便于回溯与展示。 */
  stageRealm: integer("stage_realm"),
  /**
   * 随机词条：只有极品及以上才有，分数值 / 概率 / 技能三类。
   * 老的行只有 key/flat/percent（数值类），按 kind 缺省为 stat 兼容。
   */
  affixes: jsonb("affixes").$type<{
    kind?: string;
    key: string;
    label?: string;
    flat?: number;
    percent?: number;
    chance?: number;
    skillId?: string;
    skillName?: string;
  }[]>(),
}, (table) => [
  index("player_inventory_player_id_idx").on(table.playerId),
  uniqueIndex("player_inventory_player_item_unique_idx").on(table.playerId, table.itemId),
  index("player_inventory_player_equipped_idx").on(table.playerId, table.equipped),
]);

/**
 * 炼器专精：按装备部位（兵刃 / 甲胄 / 法器 / 饰品）分别积累熟练度。
 * 等级越高，打造该部位的成功率与品质跃升概率越高。
 */
export const playerSmithingSpecializations = pgTable("player_smithing_specializations", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  specKey: text("spec_key").notNull(),
  level: integer("level").notNull().default(1),
  exp: integer("exp").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("player_smithing_specs_unique_idx").on(table.playerId, table.specKey),
]);

export const playerUnlockedAvatars = pgTable("player_unlocked_avatars", {
  playerId: text("player_id").notNull().references(() => players.id),
  avatarId: text("avatar_id").notNull().references(() => avatarAssets.id),
  sourceItemId: text("source_item_id").references(() => items.id),
  unlockedAt: text("unlocked_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.playerId, table.avatarId] }),
  index("player_unlocked_avatars_player_idx").on(table.playerId),
  index("player_unlocked_avatars_avatar_idx").on(table.avatarId),
]);

export const playerUnlockedAvatarFrames = pgTable("player_unlocked_avatar_frames", {
  playerId: text("player_id").notNull().references(() => players.id),
  avatarFrameId: text("avatar_frame_id").notNull().references(() => avatarFrameAssets.id),
  sourceItemId: text("source_item_id").references(() => items.id),
  unlockedAt: text("unlocked_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.playerId, table.avatarFrameId] }),
  index("player_unlocked_avatar_frames_player_idx").on(table.playerId),
  index("player_unlocked_avatar_frames_frame_idx").on(table.avatarFrameId),
]);

export const playerTemporaryCosmeticGrants = pgTable("player_temporary_cosmetic_grants", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  avatarId: text("avatar_id").references(() => avatarAssets.id),
  avatarFrameId: text("avatar_frame_id").references(() => avatarFrameAssets.id),
  sourceItemId: text("source_item_id").references(() => items.id),
  insertedAvatarUnlock: boolean("inserted_avatar_unlock").notNull().default(false),
  insertedAvatarFrameUnlock: boolean("inserted_avatar_frame_unlock").notNull().default(false),
  grantedAt: text("granted_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  index("player_temp_cosmetic_grants_player_idx").on(table.playerId),
  index("player_temp_cosmetic_grants_avatar_idx").on(table.avatarId),
  index("player_temp_cosmetic_grants_frame_idx").on(table.avatarFrameId),
  index("player_temp_cosmetic_grants_expires_idx").on(table.expiresAt),
]);

export const marketListings = pgTable("market_listings", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  sellerPlayerId: text("seller_player_id").notNull().references(() => players.id),
  itemId: text("item_id").notNull().references(() => items.id),
  unitPrice: integer("unit_price").notNull(),
  quantityTotal: integer("quantity_total").notNull(),
  quantityRemaining: integer("quantity_remaining").notNull(),
  status: text("status").notNull().default("active"), // active/sold_out/cancelled/expired
  visibleAt: text("visible_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("market_listings_status_created_at_idx").on(table.status, table.createdAt),
  index("market_listings_seller_status_idx").on(table.sellerPlayerId, table.status),
  index("market_listings_item_status_idx").on(table.itemId, table.status),
  index("market_listings_status_visible_expires_idx").on(table.status, table.visibleAt, table.expiresAt),
]);

export const marketTradeRecords = pgTable("market_trade_records", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  listingId: integer("listing_id").notNull().references(() => marketListings.id),
  sellerPlayerId: text("seller_player_id").notNull().references(() => players.id),
  buyerPlayerId: text("buyer_player_id").notNull().references(() => players.id),
  itemId: text("item_id").notNull().references(() => items.id),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  gross: integer("gross").notNull(),
  fee: integer("fee").notNull(),
  sellerNet: integer("seller_net").notNull(),
  sellerReadAt: text("seller_read_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("market_trade_records_seller_read_idx").on(table.sellerPlayerId, table.sellerReadAt),
  index("market_trade_records_seller_created_idx").on(table.sellerPlayerId, table.createdAt),
  index("market_trade_records_buyer_created_idx").on(table.buyerPlayerId, table.createdAt),
  index("market_trade_records_item_created_idx").on(table.itemId, table.createdAt),
  index("market_trade_records_listing_idx").on(table.listingId),
]);

/* ============================
   任务与剧情
   ============================ */

export const quests = pgTable("quests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  questCategory: text("quest_category").notNull().default("side"),
  questType: text("quest_type").notNull().default("kill"),
  acceptNpcId: text("accept_npc_id").notNull().references(() => npcs.id),
  completeNpcId: text("complete_npc_id").notNull().references(() => npcs.id),
  acceptStory: text("accept_story"),
  completeStory: text("complete_story"),
  requirements: jsonb("requirements").$type<QuestRequirement[]>(),
  rewards: jsonb("rewards").$type<QuestReward>(),
  prerequisites: jsonb("prerequisites").$type<string[]>(),
  minRealm: integer("min_realm").notNull().default(1),
  maxRealm: integer("max_realm"),
  repeatable: boolean("repeatable").notNull().default(false),
  /**
   * 重复周期：none=不可重复；daily=每日可办一次（需 repeatable=true）。
   * 按 Asia/Shanghai 自然日计算，避免无限刷奖励。
   */
  repeatCycle: text("repeat_cycle").notNull().default("none"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const playerQuests = pgTable("player_quests", {
  playerId: text("player_id").notNull().references(() => players.id),
  questId: text("quest_id").notNull().references(() => quests.id),
  status: text("status").notNull().default("available"), // available/active/completed/failed
  progress: jsonb("progress").$type<Record<string, number>>(),
  acceptedAt: text("accepted_at"),
  completedAt: text("completed_at"),
});

export const playerNpcBountyDaily = pgTable("player_npc_bounty_daily", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  npcId: text("npc_id").notNull(),
  dateKey: text("date_key").notNull(), // YYYY-MM-DD, Asia/Shanghai
  usedCount: integer("used_count").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("player_npc_bounty_daily_player_npc_date_unique").on(table.playerId, table.npcId, table.dateKey),
  index("player_npc_bounty_daily_player_idx").on(table.playerId),
  index("player_npc_bounty_daily_npc_date_idx").on(table.npcId, table.dateKey),
]);

export const storyProgress = pgTable("story_progress", {
  playerId: text("player_id").notNull().references(() => players.id),
  storyId: text("story_id").notNull(),
  branch: text("branch").notNull().default("main"),
  chapter: integer("chapter").notNull().default(1),
  choices: jsonb("choices").$type<Record<string, string>>(),
});

/* ============================
   AI 记忆
   ============================ */

export const aiMemories = pgTable("ai_memories", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  npcId: text("npc_id").notNull().references(() => npcs.id),
  playerId: text("player_id").notNull().references(() => players.id),
  role: text("role").notNull(), // user/assistant
  content: text("content").notNull(),
  summary: text("summary"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const aiGenerationJobs = pgTable("ai_generation_jobs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(), // batch/worldpack
  status: text("status").notNull().default("pending"), // pending/running/succeeded/failed
  requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
  progressPayload: jsonb("progress_payload").$type<Record<string, unknown>>(),
  resultPayload: jsonb("result_payload").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  createdBy: text("created_by").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const mapDailyRumors = pgTable("map_daily_rumors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  mapId: text("map_id").notNull().references(() => maps.id),
  dateKey: text("date_key").notNull(), // YYYY-MM-DD, Asia/Shanghai
  summaryVersion: text("summary_version").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("map_daily_rumors_map_date_unique").on(table.mapId, table.dateKey),
  index("map_daily_rumors_map_date_idx").on(table.mapId, table.dateKey),
  index("map_daily_rumors_date_idx").on(table.dateKey),
]);

/* ============================
   插件系统
   ============================ */

export const pluginPackages = pgTable("plugin_packages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  pluginId: text("plugin_id").notNull(),
  version: text("version").notNull(),
  sourceType: text("source_type").notNull().default("upload"), // upload/builtin
  builtinKey: text("builtin_key"),
  filePath: text("file_path"),
  extractPath: text("extract_path"),
  serverEntry: text("server_entry").notNull().default("dist/server.js"),
  sha256: text("sha256"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  uploadedBy: text("uploaded_by").references(() => accounts.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("plugin_packages_plugin_id_version_unique").on(table.pluginId, table.version),
  index("plugin_packages_plugin_id_idx").on(table.pluginId),
  index("plugin_packages_source_type_idx").on(table.sourceType),
]);

export const pluginInstalls = pgTable("plugin_installs", {
  pluginId: text("plugin_id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => pluginPackages.id),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>(),
  installedBy: text("installed_by").references(() => accounts.id),
  installedAt: text("installed_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("plugin_installs_enabled_idx").on(table.enabled),
  index("plugin_installs_package_id_idx").on(table.packageId),
]);

export const pluginOperationLogs = pgTable("plugin_operation_logs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  pluginId: text("plugin_id").notNull(),
  operation: text("operation").notNull(), // upload/install/enable/disable/uninstall/cleanup
  status: text("status").notNull(), // success/failed
  message: text("message"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  operatorAccountId: text("operator_account_id").references(() => accounts.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("plugin_operation_logs_plugin_id_idx").on(table.pluginId),
  index("plugin_operation_logs_created_at_idx").on(table.createdAt),
]);

/* ============================
   系统配置
   ============================ */

export const systemConfigs = pgTable("system_configs", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  group: text("group").notNull(),
  isSecret: boolean("is_secret").notNull().default(false),
  description: text("description"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("system_configs_group_idx").on(table.group),
]);

/* ============================
   随机事件
   ============================ */

export const randomEvents = pgTable("random_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  iconImageUrl: text("icon_image_url"),
  imageUrls: jsonb("image_urls").$type<string[]>(),
  eventType: text("event_type").notNull().default("encounter"),
  probability: real("probability").notNull().default(0.1),
  spawnIntervalSeconds: integer("spawn_interval_seconds"),
  durationSeconds: integer("duration_seconds"),
  minRealm: integer("min_realm").notNull().default(1),
  maxRealm: integer("max_realm"),
  mapType: text("map_type"),
  mapTypes: jsonb("map_types").$type<string[]>(),
  mapIds: jsonb("map_ids").$type<string[]>(),
  encounterMode: text("encounter_mode").notNull().default("single"),
  encounterStageCount: integer("encounter_stage_count").notNull().default(3),
  encounterChoiceCount: integer("encounter_choice_count").notNull().default(2),
  judgeConditions: jsonb("judge_conditions").$type<EventJudgeConditions>(),
  rewards: jsonb("rewards").$type<QuestReward>(),
  aiPrompt: text("ai_prompt"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const playerRandomEventCooldowns = pgTable("player_random_event_cooldowns", {
  playerId: text("player_id").notNull().references(() => players.id),
  eventId: text("event_id").notNull().references(() => randomEvents.id),
  lastTriggeredAt: text("last_triggered_at").notNull(),
  nextAvailableAt: text("next_available_at").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.playerId, table.eventId] }),
  index("player_random_event_cooldowns_player_next_available_idx").on(table.playerId, table.nextAvailableAt),
  index("player_random_event_cooldowns_event_next_available_idx").on(table.eventId, table.nextAvailableAt),
]);

export const mapOpportunitySpawns = pgTable("map_opportunity_spawns", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text("event_id").notNull().references(() => randomEvents.id),
  mapId: text("map_id").notNull().references(() => maps.id),
  positionX: integer("position_x").notNull(),
  positionY: integer("position_y").notNull(),
  spawnedAt: text("spawned_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  claimedByPlayerId: text("claimed_by_player_id").references(() => players.id),
  claimedAt: text("claimed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("map_opportunity_spawns_map_expires_claimed_idx").on(table.mapId, table.expiresAt, table.claimedAt),
  index("map_opportunity_spawns_event_spawned_idx").on(table.eventId, table.spawnedAt),
  index("map_opportunity_spawns_claimed_by_player_idx").on(table.claimedByPlayerId),
]);

export const playerMapEventSessions = pgTable("player_map_event_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  playerId: text("player_id").notNull().references(() => players.id),
  eventId: text("event_id").notNull().references(() => randomEvents.id),
  status: text("status").notNull().default("active"),
  currentStageIndex: integer("current_stage_index").notNull().default(0),
  sessionPayloadJson: jsonb("session_payload_json").$type<Record<string, unknown>>().notNull().default({}),
  selectedPathJson: jsonb("selected_path_json").$type<Record<string, unknown>[]>().notNull().default([]),
  expiresAt: text("expires_at").notNull(),
  rewardAppliedAt: text("reward_applied_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_map_event_sessions_player_status_idx").on(table.playerId, table.status),
  index("player_map_event_sessions_player_expires_idx").on(table.playerId, table.expiresAt),
  index("player_map_event_sessions_event_status_idx").on(table.eventId, table.status),
]);

export const mapRealtimeEventLogs = pgTable("map_realtime_event_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  idempotencyKey: text("idempotency_key").notNull(),
  roomId: text("room_id").notNull(),
  playerId: text("player_id").notNull().references(() => players.id),
  mapId: text("map_id"),
  targetMapId: text("target_map_id"),
  entityId: text("entity_id"),
  actionId: text("action_id").notNull(),
  inputType: text("input_type").notNull(),
  status: text("status").notNull().default("accepted"),
  reason: text("reason"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("map_realtime_event_logs_idempotency_unique").on(table.idempotencyKey),
  index("map_realtime_event_logs_player_created_idx").on(table.playerId, table.createdAt),
  index("map_realtime_event_logs_room_created_idx").on(table.roomId, table.createdAt),
  index("map_realtime_event_logs_map_created_idx").on(table.mapId, table.createdAt),
]);

/* ============================
   气运系统
   ============================ */

export const fortunes = pgTable("fortunes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  description: text("description"),
  gender: text("gender"), // 男/女，null=不限
  enabled: boolean("enabled").notNull().default(true),
  isHidden: boolean("is_hidden").notNull().default(false),
  isStarter: boolean("is_starter").notNull().default(false),
  starterWeight: real("starter_weight").notNull().default(0),
  grade: text("grade").notNull().default("white"), // red/gold/purple/blue/white
  durationSeconds: integer("duration_seconds").notNull().default(0), // 0=永久
  /**
   * 逆天改命分池用：general=通用池；sword/body/pill/talisman=对应流派池。
   * 未选道途只从 general 抽，选定道途后从 general + 已选方向抽。
   * 列由 reversal-service 的 ensureReversalSchema 运行时补齐（老库没有这列）。
   */
  category: text("category").notNull().default("general"),
  attrEffects: jsonb("attr_effects").$type<AttributeDelta>().notNull().default({}),
  eventEffects: jsonb("event_effects").$type<FortuneEventEffects>().notNull().default({}),
  specialEffects: jsonb("special_effects").$type<FortuneSpecialEffects>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("fortunes_enabled_idx").on(table.enabled),
  index("fortunes_starter_idx").on(table.isStarter, table.enabled),
  index("fortunes_grade_idx").on(table.grade),
]);

export const playerFortunes = pgTable("player_fortunes", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  fortuneId: text("fortune_id").notNull().references(() => fortunes.id),
  sourceType: text("source_type").notNull().default("system"), // starter/quest/random_event/admin/system
  sourceRef: text("source_ref"),
  status: text("status").notNull().default("active"), // active/expired/removed
  acquiredAt: text("acquired_at").notNull().$defaultFn(() => new Date().toISOString()),
  expiresAt: text("expires_at"),
  endedAt: text("ended_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_fortunes_player_status_idx").on(table.playerId, table.status),
  index("player_fortunes_fortune_status_idx").on(table.fortuneId, table.status),
  index("player_fortunes_expires_at_idx").on(table.expiresAt),
]);

/**
 * 逆天改命刷新记录：每个线性境界只允许刷新一次三选一。
 * 唯一约束 (player_id, realm_linear) 兜底防并发；表由 reversal-service 运行时建。
 */
export const playerReversalRerolls = pgTable("player_reversal_rerolls", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  realmLinear: integer("realm_linear").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("player_reversal_rerolls_unique_idx").on(table.playerId, table.realmLinear),
]);

/**
 * 修炼流派（天赋）定义。
 *
 * kind = direction：筑基抉择的**方向**（斗战 / 长生），只给很小的倾向，主要决定后续可选流派；
 * kind = path：结丹抉择的**流派**（剑修 / 体修 / 丹修 / 符修），给主加成。
 *
 * stageCurve 按大境界分段：`{ fromMajor, percent }`，取 `fromMajor <= 当前大境界` 的最大一段。
 * 用它实现「流派强弱随阶段轮换」——例如体修前期收益高、后期相对走低，
 * 剑修前期平淡、中后期抬升，而不是全程恒定加成。
 */
export const talentPaths = pgTable("talent_paths", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // direction / path
  /** path 隶属于哪个 direction；direction 为空。 */
  parentKey: text("parent_key"),
  description: text("description"),
  /** 抉择点所在大境界：direction=2（筑基），path=3（结丹）。 */
  unlockMajor: integer("unlock_major").notNull().default(2),
  stageCurve: jsonb("stage_curve").$type<{
    fromMajor: number;
    percent: Record<string, number>;
  }[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("talent_paths_kind_idx").on(table.kind, table.enabled),
]);

/** 玩家已作出的流派抉择；(player_id, kind) 唯一，保证每个抉择点只能选一次。 */
export const playerTalents = pgTable("player_talents", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  pathKey: text("path_key").notNull(),
  kind: text("kind").notNull(), // direction / path
  /** 抉择发生时的线性境界与大境界，便于回溯。 */
  chosenAtRealm: integer("chosen_at_realm").notNull(),
  chosenAtMajor: integer("chosen_at_major").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("player_talents_player_kind_idx").on(table.playerId, table.kind),
  index("player_talents_player_idx").on(table.playerId),
]);

export const playerFortuneAttrLedger = pgTable("player_fortune_attr_ledger", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  playerFortuneId: integer("player_fortune_id").notNull().references(() => playerFortunes.id),
  triggerType: text("trigger_type").notNull(), // grant/kill_player/kill_monster/self_death
  deltaHp: integer("delta_hp").notNull().default(0),
  deltaMaxHp: integer("delta_max_hp").notNull().default(0),
  deltaMp: integer("delta_mp").notNull().default(0),
  deltaMaxMp: integer("delta_max_mp").notNull().default(0),
  deltaAttack: integer("delta_attack").notNull().default(0),
  deltaDefense: integer("delta_defense").notNull().default(0),
  deltaSpeed: integer("delta_speed").notNull().default(0),
  deltaLuck: integer("delta_luck").notNull().default(0),
  deltaSpiritualSense: integer("delta_spiritual_sense").notNull().default(0),
  deltaArmorPenetration: integer("delta_armor_penetration").notNull().default(0),
  deltaBlock: integer("delta_block").notNull().default(0),
  deltaSkillDamageBonus: integer("delta_skill_damage_bonus").notNull().default(0),
  deltaSkillDamageReduction: integer("delta_skill_damage_reduction").notNull().default(0),
  deltaArtifactDamageBonus: integer("delta_artifact_damage_bonus").notNull().default(0),
  deltaArtifactDamageReduction: integer("delta_artifact_damage_reduction").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_fortune_attr_ledger_player_idx").on(table.playerId),
  index("player_fortune_attr_ledger_player_fortune_idx").on(table.playerFortuneId),
  index("player_fortune_attr_ledger_created_at_idx").on(table.createdAt),
]);

/* ============================
   CDK 礼品兑换
   ============================ */

export const cdkCodes = pgTable("cdk_codes", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  code: text("code").notNull(),
  reward: jsonb("reward").$type<CdkReward>().notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: text("expires_at"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("cdk_codes_code_unique").on(table.code),
  index("cdk_codes_created_by_idx").on(table.createdBy),
  index("cdk_codes_enabled_idx").on(table.enabled),
]);

export const cdkRedeemLogs = pgTable("cdk_redeem_logs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  code: text("code").notNull(),
  cdkId: integer("cdk_id").notNull().references(() => cdkCodes.id),
  playerId: text("player_id").notNull().references(() => players.id),
  rewardSnapshot: jsonb("reward_snapshot").$type<CdkReward>().notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("cdk_redeem_logs_cdk_id_player_id_unique").on(table.cdkId, table.playerId),
  index("cdk_redeem_logs_cdk_id_idx").on(table.cdkId),
  index("cdk_redeem_logs_player_id_idx").on(table.playerId),
]);

/* ============================
   灵玉充值
   ============================ */

export const rechargeOrders = pgTable("recharge_orders", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  outTradeNo: text("out_trade_no").notNull(),
  tradeNo: text("trade_no"),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"), // pending/paid/failed
  notifyPayload: jsonb("notify_payload").$type<Record<string, string>>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  paidAt: text("paid_at"),
}, (table) => [
  unique("recharge_orders_out_trade_no_unique").on(table.outTradeNo),
  index("recharge_orders_player_id_idx").on(table.playerId),
  index("recharge_orders_status_idx").on(table.status),
  index("recharge_orders_created_at_idx").on(table.createdAt),
]);

/* ============================
   站内邮件
   ============================ */

export const playerMails = pgTable("player_mails", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  title: text("title").notNull(),
  content: text("content"),
  reward: jsonb("reward").$type<CdkReward>(),
  claimedAt: text("claimed_at"),
  sentBy: text("sent_by").references(() => accounts.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("player_mails_player_id_idx").on(table.playerId),
  index("player_mails_claimed_at_idx").on(table.claimedAt),
  index("player_mails_created_at_idx").on(table.createdAt),
]);

/* ============================
   每日签到
   ============================ */

export const checkinRewardRules = pgTable("checkin_reward_rules", {
  dayIndex: integer("day_index").primaryKey(), // 1-7, 周一到周日
  reward: jsonb("reward").$type<CdkReward>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const playerCheckinLogs = pgTable("player_checkin_logs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  checkinDate: text("checkin_date").notNull(), // YYYY-MM-DD, Asia/Shanghai
  dayIndex: integer("day_index").notNull(), // 1-7, 周一到周日
  rewardSnapshot: jsonb("reward_snapshot").$type<CdkReward>().notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("player_checkin_logs_player_id_checkin_date_unique").on(table.playerId, table.checkinDate),
  index("player_checkin_logs_player_id_idx").on(table.playerId),
  index("player_checkin_logs_checkin_date_idx").on(table.checkinDate),
]);

/* ============================
   世界聊天
   ============================ */

export const chatMessages = pgTable("chat_messages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  messageType: text("message_type").notNull().default("player"), // player/system
  playerId: text("player_id").references(() => players.id),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("chat_messages_created_at_idx").on(table.createdAt),
  index("chat_messages_type_id_idx").on(table.messageType, table.id),
]);

/* ============================
   社交系统
   ============================ */

export const playerFriendships = pgTable("player_friendships", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerAId: text("player_a_id").notNull().references(() => players.id),
  playerBId: text("player_b_id").notNull().references(() => players.id),
  requestedBy: text("requested_by").notNull().references(() => players.id),
  status: text("status").notNull().default("pending"), // pending/accepted/rejected/canceled
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  respondedAt: text("responded_at"),
}, (table) => [
  unique("player_friendships_pair_unique").on(table.playerAId, table.playerBId),
  index("player_friendships_status_updated_at_idx").on(table.status, table.updatedAt),
  index("player_friendships_player_a_id_idx").on(table.playerAId),
  index("player_friendships_player_b_id_idx").on(table.playerBId),
  index("player_friendships_requested_by_idx").on(table.requestedBy),
]);

export const playerIntimacyRelations = pgTable("player_intimacy_relations", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerAId: text("player_a_id").notNull().references(() => players.id),
  playerBId: text("player_b_id").notNull().references(() => players.id),
  requestedBy: text("requested_by").notNull().references(() => players.id),
  relationType: text("relation_type").notNull(), // dao_lv/jie_yi/shi_tu
  status: text("status").notNull().default("pending"), // pending/accepted/rejected/canceled
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  respondedAt: text("responded_at"),
}, (table) => [
  unique("player_intimacy_relations_pair_unique").on(table.playerAId, table.playerBId),
  index("player_intimacy_relations_status_type_idx").on(table.status, table.relationType),
  index("player_intimacy_relations_player_a_id_idx").on(table.playerAId),
  index("player_intimacy_relations_player_b_id_idx").on(table.playerBId),
  index("player_intimacy_relations_requested_by_idx").on(table.requestedBy),
]);

export const playerSocialSettings = pgTable("player_social_settings", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  dmPermission: text("dm_permission").notNull().default("friends"), // all/friends/none
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const playerCombatSettings = pgTable("player_combat_settings", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  skillRotation: jsonb("skill_rotation").$type<string[]>().notNull().default([]),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const playerHiddenCombatStats = pgTable("player_hidden_combat_stats", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  wildDefeatCount: integer("wild_defeat_count").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const dmConversations = pgTable("dm_conversations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  playerAId: text("player_a_id").notNull().references(() => players.id),
  playerBId: text("player_b_id").notNull().references(() => players.id),
  lastMessageAt: text("last_message_at").notNull().$defaultFn(() => new Date().toISOString()),
  lastMessagePreview: text("last_message_preview").notNull().default(""),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("dm_conversations_pair_unique").on(table.playerAId, table.playerBId),
  index("dm_conversations_last_message_at_idx").on(table.lastMessageAt),
  index("dm_conversations_player_a_updated_at_idx").on(table.playerAId, table.updatedAt),
  index("dm_conversations_player_b_updated_at_idx").on(table.playerBId, table.updatedAt),
]);

export const dmMessages = pgTable("dm_messages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => dmConversations.id),
  senderPlayerId: text("sender_player_id").notNull().references(() => players.id),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("dm_messages_conversation_id_id_idx").on(table.conversationId, table.id),
  index("dm_messages_created_at_idx").on(table.createdAt),
]);

export const dmConversationReads = pgTable("dm_conversation_reads", {
  conversationId: text("conversation_id").notNull().references(() => dmConversations.id),
  playerId: text("player_id").notNull().references(() => players.id),
  lastReadMessageId: integer("last_read_message_id"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.playerId] }),
  index("dm_conversation_reads_player_id_idx").on(table.playerId),
]);

export const partyGroups = pgTable("party_groups", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  leaderPlayerId: text("leader_player_id").notNull().references(() => players.id),
  status: text("status").notNull().default("active"), // active/disbanded
  activeEncounterId: text("active_encounter_id"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("party_groups_leader_player_id_idx").on(table.leaderPlayerId),
  index("party_groups_status_updated_at_idx").on(table.status, table.updatedAt),
]);

export const partyGroupMembers = pgTable("party_group_members", {
  partyId: text("party_id").notNull().references(() => partyGroups.id),
  playerId: text("player_id").notNull().references(() => players.id),
  slotOrder: integer("slot_order").notNull().default(0),
  joinedAt: text("joined_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.partyId, table.playerId] }),
  unique("party_group_members_player_unique").on(table.playerId),
  index("party_group_members_party_slot_idx").on(table.partyId, table.slotOrder),
]);

export const partyInvites = pgTable("party_invites", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  inviterId: text("inviter_id").notNull().references(() => players.id),
  targetPlayerId: text("target_player_id").notNull().references(() => players.id),
  partyId: text("party_id").references(() => partyGroups.id),
  status: text("status").notNull().default("pending"), // pending/accepted/rejected/expired/canceled
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  respondedAt: text("responded_at"),
}, (table) => [
  index("party_invites_target_status_idx").on(table.targetPlayerId, table.status),
  index("party_invites_inviter_status_idx").on(table.inviterId, table.status),
  index("party_invites_party_status_idx").on(table.partyId, table.status),
]);

export const partyEncounters = pgTable("party_encounters", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  partyId: text("party_id").notNull().references(() => partyGroups.id),
  encounterType: text("encounter_type").notNull(), // normal/boss
  monsterId: text("monster_id").notNull(),
  status: text("status").notNull().default("ongoing"), // ongoing/resolved/abandoned
  stateJson: jsonb("state_json").$type<Record<string, unknown> | null>(),
  sceneSnapshotJson: jsonb("scene_snapshot_json").$type<Record<string, unknown> | null>(),
  turnStateJson: jsonb("turn_state_json").$type<Record<string, unknown> | null>(),
  eligibleMemberIdsJson: jsonb("eligible_member_ids_json").$type<string[] | null>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("party_encounters_party_status_idx").on(table.partyId, table.status),
  index("party_encounters_monster_status_idx").on(table.monsterId, table.status),
  index("party_encounters_type_status_idx").on(table.encounterType, table.status),
]);

/* ============================
   战斗日志
   ============================ */

export const combatLogs = pgTable("combat_logs", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  opponentType: text("opponent_type"), // monster/boss/player
  opponentId: text("opponent_id"),
  result: text("result"), // win/lose/flee
  details: jsonb("details"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const combatRewardClaims = pgTable("combat_reward_claims", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  combatId: text("combat_id").notNull(),
  playerId: text("player_id").notNull().references(() => players.id),
  opponentType: text("opponent_type").notNull().default("monster"),
  opponentId: text("opponent_id"),
  status: text("status").notNull().default("pending"),
  rewardSnapshot: jsonb("reward_snapshot").$type<CombatSettleResultSnapshot>().notNull().default({}),
  claimedAt: text("claimed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("combat_reward_claims_combat_player_unique").on(table.combatId, table.playerId),
  index("combat_reward_claims_player_idx").on(table.playerId),
  index("combat_reward_claims_opponent_idx").on(table.opponentType, table.opponentId),
]);

export const combatSideEffectClaims = pgTable("combat_side_effect_claims", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  effectKey: text("effect_key").notNull(),
  combatId: text("combat_id").notNull(),
  playerId: text("player_id").references(() => players.id),
  effectType: text("effect_type").notNull(),
  status: text("status").notNull().default("pending"),
  claimedAt: text("claimed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  unique("combat_side_effect_claims_effect_key_unique").on(table.effectKey),
  index("combat_side_effect_claims_combat_idx").on(table.combatId),
  index("combat_side_effect_claims_player_idx").on(table.playerId),
]);

/* ============================
   Relations
   ============================ */

export const accountsRelations = relations(accounts, ({ many }) => ({
  sessions: many(sessions),
  oauthAccounts: many(oauthAccounts),
  players: many(players),
  aiGenerationJobs: many(aiGenerationJobs),
  uploadedPluginPackages: many(pluginPackages),
  pluginInstalls: many(pluginInstalls),
  pluginOperationLogs: many(pluginOperationLogs),
  cdkCodes: many(cdkCodes),
  sentMails: many(playerMails),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  account: one(accounts, {
    fields: [players.accountId],
    references: [accounts.id],
  }),
  avatar: one(avatarAssets, {
    fields: [players.avatarId],
    references: [avatarAssets.id],
  }),
  avatarFrame: one(avatarFrameAssets, {
    fields: [players.avatarFrameId],
    references: [avatarFrameAssets.id],
  }),
  skills: many(playerSkills),
  inventory: many(playerInventory),
  unlockedAvatars: many(playerUnlockedAvatars),
  unlockedAvatarFrames: many(playerUnlockedAvatarFrames),
  temporaryCosmeticGrants: many(playerTemporaryCosmeticGrants),
  statuses: many(playerStatuses),
  quests: many(playerQuests),
  combatLogs: many(combatLogs),
  aiMemories: many(aiMemories),
  cdkRedeemLogs: many(cdkRedeemLogs),
  rechargeOrders: many(rechargeOrders),
  mails: many(playerMails),
  checkinLogs: many(playerCheckinLogs),
  npcBountyDaily: many(playerNpcBountyDaily),
  worldProfile: one(playerWorldProfiles, {
    fields: [players.id],
    references: [playerWorldProfiles.playerId],
  }),
  worldIncidents: many(playerWorldIncidents),
  worldEventOffers: many(playerWorldEventOffers),
  fortunes: many(playerFortunes),
  fortuneAttrLedgers: many(playerFortuneAttrLedger),
  chatMessages: many(chatMessages),
  friendshipsAsA: many(playerFriendships, { relationName: "friendship_player_a" }),
  friendshipsAsB: many(playerFriendships, { relationName: "friendship_player_b" }),
  friendshipRequests: many(playerFriendships, { relationName: "friendship_requested_by" }),
  intimacyAsA: many(playerIntimacyRelations, { relationName: "intimacy_player_a" }),
  intimacyAsB: many(playerIntimacyRelations, { relationName: "intimacy_player_b" }),
  intimacyRequests: many(playerIntimacyRelations, { relationName: "intimacy_requested_by" }),
  socialSetting: one(playerSocialSettings, {
    fields: [players.id],
    references: [playerSocialSettings.playerId],
  }),
  combatSetting: one(playerCombatSettings, {
    fields: [players.id],
    references: [playerCombatSettings.playerId],
  }),
  hiddenCombatStats: one(playerHiddenCombatStats, {
    fields: [players.id],
    references: [playerHiddenCombatStats.playerId],
  }),
  dmConversationsAsA: many(dmConversations, { relationName: "dm_player_a" }),
  dmConversationsAsB: many(dmConversations, { relationName: "dm_player_b" }),
  dmMessagesSent: many(dmMessages),
  dmConversationReads: many(dmConversationReads),
  marketListingsAsSeller: many(marketListings),
  marketTradeRecordsAsSeller: many(marketTradeRecords, { relationName: "market_trade_seller" }),
  marketTradeRecordsAsBuyer: many(marketTradeRecords, { relationName: "market_trade_buyer" }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  account: one(accounts, {
    fields: [sessions.accountId],
    references: [accounts.id],
  }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  account: one(accounts, {
    fields: [oauthAccounts.accountId],
    references: [accounts.id],
  }),
}));

export const aiGenerationJobsRelations = relations(aiGenerationJobs, ({ one }) => ({
  creator: one(accounts, {
    fields: [aiGenerationJobs.createdBy],
    references: [accounts.id],
  }),
}));

export const pluginPackagesRelations = relations(pluginPackages, ({ one, many }) => ({
  uploader: one(accounts, {
    fields: [pluginPackages.uploadedBy],
    references: [accounts.id],
  }),
  installs: many(pluginInstalls),
}));

export const pluginInstallsRelations = relations(pluginInstalls, ({ one }) => ({
  package: one(pluginPackages, {
    fields: [pluginInstalls.packageId],
    references: [pluginPackages.id],
  }),
  installer: one(accounts, {
    fields: [pluginInstalls.installedBy],
    references: [accounts.id],
  }),
}));

export const pluginOperationLogsRelations = relations(pluginOperationLogs, ({ one }) => ({
  operator: one(accounts, {
    fields: [pluginOperationLogs.operatorAccountId],
    references: [accounts.id],
  }),
}));

export const cdkCodesRelations = relations(cdkCodes, ({ one, many }) => ({
  creator: one(accounts, {
    fields: [cdkCodes.createdBy],
    references: [accounts.id],
  }),
  redeemLogs: many(cdkRedeemLogs),
}));

export const cdkRedeemLogsRelations = relations(cdkRedeemLogs, ({ one }) => ({
  cdkCode: one(cdkCodes, {
    fields: [cdkRedeemLogs.cdkId],
    references: [cdkCodes.id],
  }),
  player: one(players, {
    fields: [cdkRedeemLogs.playerId],
    references: [players.id],
  }),
}));

export const rechargeOrdersRelations = relations(rechargeOrders, ({ one }) => ({
  player: one(players, {
    fields: [rechargeOrders.playerId],
    references: [players.id],
  }),
}));

export const playerMailsRelations = relations(playerMails, ({ one }) => ({
  player: one(players, {
    fields: [playerMails.playerId],
    references: [players.id],
  }),
  sender: one(accounts, {
    fields: [playerMails.sentBy],
    references: [accounts.id],
  }),
}));

export const playerCheckinLogsRelations = relations(playerCheckinLogs, ({ one }) => ({
  player: one(players, {
    fields: [playerCheckinLogs.playerId],
    references: [players.id],
  }),
}));

export const fortunesRelations = relations(fortunes, ({ many }) => ({
  playerFortunes: many(playerFortunes),
}));

export const playerFortunesRelations = relations(playerFortunes, ({ one, many }) => ({
  player: one(players, {
    fields: [playerFortunes.playerId],
    references: [players.id],
  }),
  fortune: one(fortunes, {
    fields: [playerFortunes.fortuneId],
    references: [fortunes.id],
  }),
  attrLedgers: many(playerFortuneAttrLedger),
}));

export const playerFortuneAttrLedgerRelations = relations(playerFortuneAttrLedger, ({ one }) => ({
  player: one(players, {
    fields: [playerFortuneAttrLedger.playerId],
    references: [players.id],
  }),
  playerFortune: one(playerFortunes, {
    fields: [playerFortuneAttrLedger.playerFortuneId],
    references: [playerFortunes.id],
  }),
}));

export const playerNpcBountyDailyRelations = relations(playerNpcBountyDaily, ({ one }) => ({
  player: one(players, {
    fields: [playerNpcBountyDaily.playerId],
    references: [players.id],
  }),
}));

export const worldFactionsRelations = relations(worldFactions, ({ many }) => ({
  districtStates: many(worldDistrictStates),
  storylines: many(worldStorylines),
  participants: many(worldStorylineParticipants),
}));

export const worldDistrictStatesRelations = relations(worldDistrictStates, ({ one, many }) => ({
  map: one(worldMapInstances, {
    fields: [worldDistrictStates.mapId],
    references: [worldMapInstances.id],
  }),
  dominantFaction: one(worldFactions, {
    fields: [worldDistrictStates.dominantFactionId],
    references: [worldFactions.id],
  }),
  storylines: many(worldStorylines),
}));

export const worldStorylinesRelations = relations(worldStorylines, ({ one, many }) => ({
  map: one(worldMapInstances, {
    fields: [worldStorylines.mapId],
    references: [worldMapInstances.id],
  }),
  districtState: one(worldDistrictStates, {
    fields: [worldStorylines.districtStateId],
    references: [worldDistrictStates.id],
  }),
  sourceFaction: one(worldFactions, {
    fields: [worldStorylines.sourceFactionId],
    references: [worldFactions.id],
  }),
  participants: many(worldStorylineParticipants),
}));

export const worldStorylineParticipantsRelations = relations(worldStorylineParticipants, ({ one }) => ({
  storyline: one(worldStorylines, {
    fields: [worldStorylineParticipants.storylineId],
    references: [worldStorylines.id],
  }),
  faction: one(worldFactions, {
    fields: [worldStorylineParticipants.factionId],
    references: [worldFactions.id],
  }),
}));

export const playerWorldProfilesRelations = relations(playerWorldProfiles, ({ one, many }) => ({
  player: one(players, {
    fields: [playerWorldProfiles.playerId],
    references: [players.id],
  }),
  incidents: many(playerWorldIncidents),
  eventOffers: many(playerWorldEventOffers),
}));

export const playerWorldIncidentsRelations = relations(playerWorldIncidents, ({ one }) => ({
  player: one(players, {
    fields: [playerWorldIncidents.playerId],
    references: [players.id],
  }),
}));

export const playerWorldEventOffersRelations = relations(playerWorldEventOffers, ({ one }) => ({
  player: one(players, {
    fields: [playerWorldEventOffers.playerId],
    references: [players.id],
  }),
  sourceNpc: one(worldNpcProfiles, {
    fields: [playerWorldEventOffers.sourceNpcId],
    references: [worldNpcProfiles.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  player: one(players, {
    fields: [chatMessages.playerId],
    references: [players.id],
  }),
}));

export const playerFriendshipsRelations = relations(playerFriendships, ({ one }) => ({
  playerA: one(players, {
    relationName: "friendship_player_a",
    fields: [playerFriendships.playerAId],
    references: [players.id],
  }),
  playerB: one(players, {
    relationName: "friendship_player_b",
    fields: [playerFriendships.playerBId],
    references: [players.id],
  }),
  requester: one(players, {
    relationName: "friendship_requested_by",
    fields: [playerFriendships.requestedBy],
    references: [players.id],
  }),
}));

export const playerIntimacyRelationsRelations = relations(playerIntimacyRelations, ({ one }) => ({
  playerA: one(players, {
    relationName: "intimacy_player_a",
    fields: [playerIntimacyRelations.playerAId],
    references: [players.id],
  }),
  playerB: one(players, {
    relationName: "intimacy_player_b",
    fields: [playerIntimacyRelations.playerBId],
    references: [players.id],
  }),
  requester: one(players, {
    relationName: "intimacy_requested_by",
    fields: [playerIntimacyRelations.requestedBy],
    references: [players.id],
  }),
}));

export const playerSocialSettingsRelations = relations(playerSocialSettings, ({ one }) => ({
  player: one(players, {
    fields: [playerSocialSettings.playerId],
    references: [players.id],
  }),
}));

export const playerCombatSettingsRelations = relations(playerCombatSettings, ({ one }) => ({
  player: one(players, {
    fields: [playerCombatSettings.playerId],
    references: [players.id],
  }),
}));

export const playerHiddenCombatStatsRelations = relations(playerHiddenCombatStats, ({ one }) => ({
  player: one(players, {
    fields: [playerHiddenCombatStats.playerId],
    references: [players.id],
  }),
}));

export const dmConversationsRelations = relations(dmConversations, ({ one, many }) => ({
  playerA: one(players, {
    relationName: "dm_player_a",
    fields: [dmConversations.playerAId],
    references: [players.id],
  }),
  playerB: one(players, {
    relationName: "dm_player_b",
    fields: [dmConversations.playerBId],
    references: [players.id],
  }),
  messages: many(dmMessages),
  reads: many(dmConversationReads),
}));

export const dmMessagesRelations = relations(dmMessages, ({ one }) => ({
  conversation: one(dmConversations, {
    fields: [dmMessages.conversationId],
    references: [dmConversations.id],
  }),
  sender: one(players, {
    fields: [dmMessages.senderPlayerId],
    references: [players.id],
  }),
}));

export const dmConversationReadsRelations = relations(dmConversationReads, ({ one }) => ({
  conversation: one(dmConversations, {
    fields: [dmConversationReads.conversationId],
    references: [dmConversations.id],
  }),
  player: one(players, {
    fields: [dmConversationReads.playerId],
    references: [players.id],
  }),
}));

export const mapsRelations = relations(maps, ({ many }) => ({
  npcs: many(npcs),
  monsters: many(monsters),
  edgesAsA: many(mapEdges, { relationName: "map_a" }),
  edgesAsB: many(mapEdges, { relationName: "map_b" }),
}));

export const avatarAssetsRelations = relations(avatarAssets, ({ many }) => ({
  selectedByPlayers: many(players),
  unlockedByPlayers: many(playerUnlockedAvatars),
}));

export const avatarFrameAssetsRelations = relations(avatarFrameAssets, ({ many }) => ({
  selectedByPlayers: many(players),
  unlockedByPlayers: many(playerUnlockedAvatarFrames),
}));

export const playerUnlockedAvatarsRelations = relations(playerUnlockedAvatars, ({ one }) => ({
  player: one(players, {
    fields: [playerUnlockedAvatars.playerId],
    references: [players.id],
  }),
  avatar: one(avatarAssets, {
    fields: [playerUnlockedAvatars.avatarId],
    references: [avatarAssets.id],
  }),
  sourceItem: one(items, {
    fields: [playerUnlockedAvatars.sourceItemId],
    references: [items.id],
  }),
}));

export const playerStatusesRelations = relations(playerStatuses, ({ one }) => ({
  player: one(players, {
    fields: [playerStatuses.playerId],
    references: [players.id],
  }),
}));

export const playerUnlockedAvatarFramesRelations = relations(playerUnlockedAvatarFrames, ({ one }) => ({
  player: one(players, {
    fields: [playerUnlockedAvatarFrames.playerId],
    references: [players.id],
  }),
  avatarFrame: one(avatarFrameAssets, {
    fields: [playerUnlockedAvatarFrames.avatarFrameId],
    references: [avatarFrameAssets.id],
  }),
  sourceItem: one(items, {
    fields: [playerUnlockedAvatarFrames.sourceItemId],
    references: [items.id],
  }),
}));

export const playerTemporaryCosmeticGrantsRelations = relations(playerTemporaryCosmeticGrants, ({ one }) => ({
  player: one(players, {
    fields: [playerTemporaryCosmeticGrants.playerId],
    references: [players.id],
  }),
  avatar: one(avatarAssets, {
    fields: [playerTemporaryCosmeticGrants.avatarId],
    references: [avatarAssets.id],
  }),
  avatarFrame: one(avatarFrameAssets, {
    fields: [playerTemporaryCosmeticGrants.avatarFrameId],
    references: [avatarFrameAssets.id],
  }),
  sourceItem: one(items, {
    fields: [playerTemporaryCosmeticGrants.sourceItemId],
    references: [items.id],
  }),
}));

export const mapEdgesRelations = relations(mapEdges, ({ one }) => ({
  mapA: one(maps, {
    relationName: "map_a",
    fields: [mapEdges.mapAId],
    references: [maps.id],
  }),
  mapB: one(maps, {
    relationName: "map_b",
    fields: [mapEdges.mapBId],
    references: [maps.id],
  }),
}));

export const npcsRelations = relations(npcs, ({ one }) => ({
  map: one(maps, {
    fields: [npcs.mapId],
    references: [maps.id],
  }),
}));

export const monstersRelations = relations(monsters, ({ one }) => ({
  map: one(maps, {
    fields: [monsters.mapId],
    references: [maps.id],
  }),
}));

export const marketListingsRelations = relations(marketListings, ({ one, many }) => ({
  seller: one(players, {
    fields: [marketListings.sellerPlayerId],
    references: [players.id],
  }),
  item: one(items, {
    fields: [marketListings.itemId],
    references: [items.id],
  }),
  trades: many(marketTradeRecords),
}));

export const marketTradeRecordsRelations = relations(marketTradeRecords, ({ one }) => ({
  listing: one(marketListings, {
    fields: [marketTradeRecords.listingId],
    references: [marketListings.id],
  }),
  seller: one(players, {
    relationName: "market_trade_seller",
    fields: [marketTradeRecords.sellerPlayerId],
    references: [players.id],
  }),
  buyer: one(players, {
    relationName: "market_trade_buyer",
    fields: [marketTradeRecords.buyerPlayerId],
    references: [players.id],
  }),
  item: one(items, {
    fields: [marketTradeRecords.itemId],
    references: [items.id],
  }),
}));

export const realmMajorsRelations = relations(realmMajors, ({ many }) => ({
  stages: many(realmStages),
}));

export const realmStagesRelations = relations(realmStages, ({ one }) => ({
  major: one(realmMajors, {
    fields: [realmStages.majorId],
    references: [realmMajors.id],
  }),
}));
