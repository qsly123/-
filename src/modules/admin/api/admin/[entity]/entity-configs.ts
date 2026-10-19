import { eq, like, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import {
  accounts,
  cdkCodes,
  checkinRewardRules,
  fortunes,
  hongmengTreasureConfigs,
  items,
  mapEdges,
  maps,
  monsters,
  npcs,
  pillToxicityConfigs,
  players,
  quests,
  randomEvents,
  sectApplications,
  sectBuildings,
  sectLogs,
  sectMembers,
  sectRolePermissions,
  sectResources,
  sectStorageItems,
  sects,
  skills,
  systemConfigs,
  temporaryMaps,
  temporaryMonsters,
} from "@/db/schema";
import { isAdminEntity, type AdminEntity } from "@/modules/admin/services/admin-entities";
import {
  buildAiItemsCondition,
  buildFormalItemsCondition,
  queryAiItemAdminList,
} from "@/modules/admin/services/ai-item-admin-service";
import { resolveRandomEventMapTypes } from "@/modules/map/services/random-event-service";
import { splitSkillEffectsPayload } from "@/modules/shared/services/skill-visual-effect";

type AdminTable =
  | typeof maps
  | typeof temporaryMaps
  | typeof mapEdges
  | typeof sects
  | typeof sectMembers
  | typeof sectRolePermissions
  | typeof sectApplications
  | typeof sectBuildings
  | typeof sectResources
  | typeof sectStorageItems
  | typeof sectLogs
  | typeof npcs
  | typeof accounts
  | typeof players
  | typeof fortunes
  | typeof items
  | typeof pillToxicityConfigs
  | typeof hongmengTreasureConfigs
  | typeof skills
  | typeof monsters
  | typeof temporaryMonsters
  | typeof quests
  | typeof randomEvents
  | typeof checkinRewardRules
  | typeof cdkCodes
  | typeof systemConfigs;

export type CustomListQueryResult = {
  list: unknown[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  meta?: Record<string, unknown>;
};

export type ListConfig = {
  table: AdminTable;
  idColumn: unknown;
  searchBuilder: (keyword: string) => SQLWrapper | undefined;
  orderColumn: unknown;
  orderDirection?: "asc" | "desc";
  baseWhere?: SQLWrapper | (() => SQLWrapper | undefined) | undefined;
  filterBuilders?: Record<string, (value: string) => SQLWrapper | undefined>;
  readOnlyCreate?: boolean;
  readOnlyDelete?: boolean;
  sanitizeList?: (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  sanitizeOne?: (row: Record<string, unknown>) => Record<string, unknown>;
  customQuery?: (searchParams: URLSearchParams, defaultPage: number) => Promise<CustomListQueryResult>;
};

function parseBooleanFilter(value: string) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

const ENTITY_CONFIG: Partial<Record<AdminEntity, ListConfig>> = {
  maps: {
    table: maps,
    idColumn: maps.id,
    orderColumn: maps.createdAt,
    filterBuilders: {
      mapId: (value) => eq(maps.id, value),
      mapType: (value) => eq(maps.mapType, value),
    },
    searchBuilder: (keyword) => or(
      like(maps.id, `%${keyword}%`),
      like(maps.name, `%${keyword}%`),
      like(maps.description, `%${keyword}%`),
    ),
  },
  sects: {
    table: sects,
    idColumn: sects.id,
    orderColumn: sects.createdAt,
    filterBuilders: {
      state: (value) => eq(sects.state, value as never),
      founderPlayerId: (value) => eq(sects.founderPlayerId, value),
      governorPlayerId: (value) => eq(sects.governorPlayerId, value),
      externalMapId: (value) => eq(sects.externalMapId, value),
    },
    searchBuilder: (keyword) => or(
      like(sects.id, `%${keyword}%`),
      like(sects.name, `%${keyword}%`),
      like(sects.announcement, `%${keyword}%`),
      like(sects.description, `%${keyword}%`),
      like(sects.externalMapId, `%${keyword}%`),
      like(sects.homeMapId, `%${keyword}%`),
    ),
  },
  sectMembers: {
    table: sectMembers,
    idColumn: sectMembers.playerId,
    orderColumn: sectMembers.joinedAt,
    readOnlyCreate: true,
    readOnlyDelete: true,
    filterBuilders: {
      sectId: (value) => eq(sectMembers.sectId, value),
      roleKey: (value) => eq(sectMembers.roleKey, value as never),
      playerId: (value) => eq(sectMembers.playerId, value),
    },
    searchBuilder: (keyword) => or(
      like(sectMembers.playerId, `%${keyword}%`),
      like(sectMembers.sectId, `%${keyword}%`),
      like(sectMembers.roleKey, `%${keyword}%`),
      like(sectMembers.appointedByPlayerId, `%${keyword}%`),
    ),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: row.playerId,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: row.playerId,
    }),
  },
  sectRolePermissions: {
    table: sectRolePermissions,
    idColumn: sectRolePermissions.sectId,
    orderColumn: sectRolePermissions.updatedAt,
    filterBuilders: {
      sectId: (value) => eq(sectRolePermissions.sectId, value),
      roleKey: (value) => eq(sectRolePermissions.roleKey, value as never),
      permissionKey: (value) => eq(sectRolePermissions.permissionKey, value as never),
    },
    searchBuilder: (keyword) => or(
      like(sectRolePermissions.sectId, `%${keyword}%`),
      like(sectRolePermissions.roleKey, `%${keyword}%`),
      like(sectRolePermissions.permissionKey, `%${keyword}%`),
    ),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: `${row.sectId}:${row.roleKey}:${row.permissionKey}`,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: `${row.sectId}:${row.roleKey}:${row.permissionKey}`,
    }),
  },
  sectApplications: {
    table: sectApplications,
    idColumn: sectApplications.id,
    orderColumn: sectApplications.createdAt,
    filterBuilders: {
      sectId: (value) => eq(sectApplications.sectId, value),
      playerId: (value) => eq(sectApplications.playerId, value),
      type: (value) => eq(sectApplications.type, value as never),
      status: (value) => eq(sectApplications.status, value as never),
    },
    searchBuilder: (keyword) => or(
      like(sectApplications.id, `%${keyword}%`),
      like(sectApplications.sectId, `%${keyword}%`),
      like(sectApplications.playerId, `%${keyword}%`),
      like(sectApplications.type, `%${keyword}%`),
      like(sectApplications.status, `%${keyword}%`),
      like(sectApplications.note, `%${keyword}%`),
    ),
  },
  sectBuildings: {
    table: sectBuildings,
    idColumn: sectBuildings.sectId,
    orderColumn: sectBuildings.updatedAt,
    readOnlyCreate: true,
    readOnlyDelete: true,
    filterBuilders: {
      sectId: (value) => eq(sectBuildings.sectId, value),
      buildingType: (value) => eq(sectBuildings.buildingType, value as never),
    },
    searchBuilder: (keyword) => or(
      like(sectBuildings.sectId, `%${keyword}%`),
      like(sectBuildings.buildingType, `%${keyword}%`),
      like(sectBuildings.name, `%${keyword}%`),
      like(sectBuildings.description, `%${keyword}%`),
    ),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: `${row.sectId}:${row.buildingType}`,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: `${row.sectId}:${row.buildingType}`,
    }),
  },
  sectResources: {
    table: sectResources,
    idColumn: sectResources.sectId,
    orderColumn: sectResources.updatedAt,
    readOnlyCreate: true,
    readOnlyDelete: true,
    filterBuilders: {
      sectId: (value) => eq(sectResources.sectId, value),
    },
    searchBuilder: (keyword) => like(sectResources.sectId, `%${keyword}%`),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: row.sectId,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: row.sectId,
    }),
  },
  sectStorageItems: {
    table: sectStorageItems,
    idColumn: sectStorageItems.id,
    orderColumn: sectStorageItems.updatedAt,
    filterBuilders: {
      sectId: (value) => eq(sectStorageItems.sectId, value),
      itemId: (value) => eq(sectStorageItems.itemId, value),
    },
    searchBuilder: (keyword) => or(
      like(sectStorageItems.sectId, `%${keyword}%`),
      like(sectStorageItems.itemId, `%${keyword}%`),
    ),
  },
  sectLogs: {
    table: sectLogs,
    idColumn: sectLogs.id,
    orderColumn: sectLogs.createdAt,
    readOnlyCreate: true,
    filterBuilders: {
      sectId: (value) => eq(sectLogs.sectId, value),
      actorPlayerId: (value) => eq(sectLogs.actorPlayerId, value),
      actionType: (value) => eq(sectLogs.actionType, value),
    },
    searchBuilder: (keyword) => or(
      like(sectLogs.sectId, `%${keyword}%`),
      like(sectLogs.actorPlayerId, `%${keyword}%`),
      like(sectLogs.actionType, `%${keyword}%`),
    ),
  },
  temporaryMaps: {
    table: temporaryMaps,
    idColumn: temporaryMaps.id,
    orderColumn: temporaryMaps.createdAt,
    readOnlyCreate: true,
    filterBuilders: {
      instanceId: (value) => eq(temporaryMaps.instanceId, value),
      mapType: (value) => eq(temporaryMaps.mapType, value),
    },
    searchBuilder: (keyword) => or(
      like(temporaryMaps.id, `%${keyword}%`),
      like(temporaryMaps.instanceId, `%${keyword}%`),
      like(temporaryMaps.name, `%${keyword}%`),
      like(temporaryMaps.description, `%${keyword}%`),
      like(temporaryMaps.mapType, `%${keyword}%`),
    ),
  },
  mapEdges: {
    table: mapEdges,
    idColumn: mapEdges.id,
    orderColumn: mapEdges.createdAt,
    searchBuilder: (keyword) => or(
      like(mapEdges.mapAId, `%${keyword}%`),
      like(mapEdges.mapBId, `%${keyword}%`),
    ),
  },
  npcs: {
    table: npcs,
    idColumn: npcs.id,
    orderColumn: npcs.createdAt,
    filterBuilders: {
      mapId: (value) => eq(npcs.mapId, value),
      isShop: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(npcs.isShop, boolValue);
      },
      bountyEnabled: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(npcs.bountyEnabled, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(npcs.id, `%${keyword}%`),
      like(npcs.name, `%${keyword}%`),
      like(npcs.title, `%${keyword}%`),
      like(npcs.description, `%${keyword}%`),
    ),
  },
  accounts: {
    table: accounts,
    idColumn: accounts.id,
    orderColumn: accounts.createdAt,
    readOnlyCreate: true,
    filterBuilders: {
      isAdmin: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(accounts.isAdmin, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(accounts.id, `%${keyword}%`),
      like(accounts.email, `%${keyword}%`),
      like(accounts.username, `%${keyword}%`),
    ),
    sanitizeList: (rows) => rows.map((row) => {
      const safe = { ...row };
      delete safe.passwordHash;
      return safe;
    }),
    sanitizeOne: (row) => {
      const safe = { ...row };
      delete safe.passwordHash;
      return safe;
    },
  },
  players: {
    table: players,
    idColumn: players.id,
    orderColumn: players.createdAt,
    readOnlyCreate: true,
    filterBuilders: {
      isAlive: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(players.isAlive, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(players.id, `%${keyword}%`),
      like(players.accountId, `%${keyword}%`),
      like(players.name, `%${keyword}%`),
      like(players.realmName, `%${keyword}%`),
    ),
  },
  fortunes: {
    table: fortunes,
    idColumn: fortunes.id,
    orderColumn: fortunes.createdAt,
    filterBuilders: {
      enabled: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(fortunes.enabled, boolValue);
      },
      isHidden: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(fortunes.isHidden, boolValue);
      },
      isStarter: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(fortunes.isStarter, boolValue);
      },
      grade: (value) => eq(fortunes.grade, value),
    },
    searchBuilder: (keyword) => or(
      like(fortunes.id, `%${keyword}%`),
      like(fortunes.name, `%${keyword}%`),
      like(fortunes.description, `%${keyword}%`),
      like(fortunes.grade, `%${keyword}%`),
    ),
  },
  items: {
    table: items,
    idColumn: items.id,
    orderColumn: items.createdAt,
    baseWhere: buildFormalItemsCondition,
    filterBuilders: {
      itemType: (value) => eq(items.itemType, value),
      rarity: (value) => eq(items.rarity, value),
      isBound: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(items.isBound, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(items.id, `%${keyword}%`),
      like(items.name, `%${keyword}%`),
      like(items.description, `%${keyword}%`),
      like(items.itemType, `%${keyword}%`),
      like(items.rarity, `%${keyword}%`),
    ),
  },
  aiItems: {
    table: items,
    idColumn: items.id,
    orderColumn: items.createdAt,
    baseWhere: buildAiItemsCondition,
    readOnlyCreate: true,
    readOnlyDelete: true,
    customQuery: queryAiItemAdminList,
    filterBuilders: {
      itemType: (value) => eq(items.itemType, value),
      rarity: (value) => eq(items.rarity, value),
      sourceType: () => undefined,
      cleanupState: () => undefined,
    },
    searchBuilder: (keyword) => or(
      like(items.id, `%${keyword}%`),
      like(items.name, `%${keyword}%`),
      like(items.description, `%${keyword}%`),
      like(items.itemType, `%${keyword}%`),
      like(items.rarity, `%${keyword}%`),
      like(items.sourceType, `%${keyword}%`),
      like(items.sourceCategory, `%${keyword}%`),
      like(items.generatedSeed, `%${keyword}%`),
    ),
  },
  pillToxicityConfigs: {
    table: pillToxicityConfigs,
    idColumn: pillToxicityConfigs.key,
    orderColumn: pillToxicityConfigs.updatedAt,
    readOnlyCreate: true,
    readOnlyDelete: true,
    searchBuilder: (keyword) => like(pillToxicityConfigs.key, `%${keyword}%`),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: row.key,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: row.key,
    }),
  },
  hongmengTreasures: {
    table: hongmengTreasureConfigs,
    idColumn: hongmengTreasureConfigs.itemId,
    orderColumn: hongmengTreasureConfigs.updatedAt,
    filterBuilders: {
      enabled: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(hongmengTreasureConfigs.enabled, boolValue);
      },
    },
    searchBuilder: (keyword) => like(hongmengTreasureConfigs.itemId, `%${keyword}%`),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: row.itemId,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: row.itemId,
    }),
  },
  skills: {
    table: skills,
    idColumn: skills.id,
    orderColumn: skills.createdAt,
    filterBuilders: {
      skillType: (value) => eq(skills.skillType, value),
      element: (value) => eq(skills.element, value),
    },
    searchBuilder: (keyword) => or(
      like(skills.id, `%${keyword}%`),
      like(skills.name, `%${keyword}%`),
      like(skills.description, `%${keyword}%`),
      like(skills.skillType, `%${keyword}%`),
      like(skills.element, `%${keyword}%`),
    ),
  },
  monsters: {
    table: monsters,
    idColumn: monsters.id,
    orderColumn: monsters.createdAt,
    filterBuilders: {
      mapId: (value) => eq(monsters.mapId, value),
      monsterType: (value) => eq(monsters.monsterType, value),
    },
    searchBuilder: (keyword) => or(
      like(monsters.id, `%${keyword}%`),
      like(monsters.name, `%${keyword}%`),
      like(monsters.description, `%${keyword}%`),
      like(monsters.monsterType, `%${keyword}%`),
    ),
  },
  temporaryMonsters: {
    table: temporaryMonsters,
    idColumn: temporaryMonsters.id,
    orderColumn: temporaryMonsters.createdAt,
    readOnlyCreate: true,
    filterBuilders: {
      instanceId: (value) => eq(temporaryMonsters.instanceId, value),
      mapId: (value) => eq(temporaryMonsters.mapId, value),
      monsterType: (value) => eq(temporaryMonsters.monsterType, value),
    },
    searchBuilder: (keyword) => or(
      like(temporaryMonsters.id, `%${keyword}%`),
      like(temporaryMonsters.instanceId, `%${keyword}%`),
      like(temporaryMonsters.name, `%${keyword}%`),
      like(temporaryMonsters.description, `%${keyword}%`),
      like(temporaryMonsters.monsterType, `%${keyword}%`),
    ),
  },
  quests: {
    table: quests,
    idColumn: quests.id,
    orderColumn: quests.createdAt,
    filterBuilders: {
      questCategory: (value) => eq(quests.questCategory, value),
      questType: (value) => eq(quests.questType, value),
      repeatable: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(quests.repeatable, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(quests.id, `%${keyword}%`),
      like(quests.name, `%${keyword}%`),
      like(quests.description, `%${keyword}%`),
      like(quests.questCategory, `%${keyword}%`),
      like(quests.questType, `%${keyword}%`),
      like(quests.acceptNpcId, `%${keyword}%`),
      like(quests.completeNpcId, `%${keyword}%`),
    ),
  },
  randomEvents: {
    table: randomEvents,
    idColumn: randomEvents.id,
    orderColumn: randomEvents.createdAt,
    filterBuilders: {
      eventType: (value) => eq(randomEvents.eventType, value),
      mapType: (value) => or(
        eq(randomEvents.mapType, value),
        sql`coalesce(${randomEvents.mapTypes}, '[]'::jsonb) @> ${JSON.stringify([value])}::jsonb`,
      ),
    },
    searchBuilder: (keyword) => or(
      like(randomEvents.id, `%${keyword}%`),
      like(randomEvents.name, `%${keyword}%`),
      like(randomEvents.description, `%${keyword}%`),
      like(randomEvents.eventType, `%${keyword}%`),
      like(randomEvents.aiPrompt, `%${keyword}%`),
    ),
  },
  checkinRewardRules: {
    table: checkinRewardRules,
    idColumn: checkinRewardRules.dayIndex,
    orderColumn: checkinRewardRules.createdAt,
    readOnlyCreate: true,
    readOnlyDelete: true,
    filterBuilders: {
      enabled: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(checkinRewardRules.enabled, boolValue);
      },
    },
    searchBuilder: (keyword) => {
      const normalized = keyword.trim();
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        return eq(checkinRewardRules.dayIndex, Math.floor(parsed));
      }
      if (normalized === "true" || normalized === "false") {
        return eq(checkinRewardRules.enabled, normalized === "true");
      }
      return undefined;
    },
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: row.dayIndex,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: row.dayIndex,
    }),
  },
  cdkCodes: {
    table: cdkCodes,
    idColumn: cdkCodes.id,
    orderColumn: cdkCodes.createdAt,
    readOnlyCreate: true,
    filterBuilders: {
      enabled: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(cdkCodes.enabled, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(cdkCodes.code, `%${keyword}%`),
      like(cdkCodes.createdBy, `%${keyword}%`),
    ),
  },
  systemConfigs: {
    table: systemConfigs,
    idColumn: systemConfigs.key,
    orderColumn: systemConfigs.createdAt,
    filterBuilders: {
      group: (value) => eq(systemConfigs.group, value),
      isSecret: (value) => {
        const boolValue = parseBooleanFilter(value);
        if (boolValue === null) {
          return undefined;
        }
        return eq(systemConfigs.isSecret, boolValue);
      },
    },
    searchBuilder: (keyword) => or(
      like(systemConfigs.key, `%${keyword}%`),
      like(systemConfigs.value, `%${keyword}%`),
      like(systemConfigs.group, `%${keyword}%`),
      like(systemConfigs.description, `%${keyword}%`),
    ),
    sanitizeList: (rows) => rows.map((row) => ({
      ...row,
      id: row.key,
    })),
    sanitizeOne: (row) => ({
      ...row,
      id: row.key,
    }),
  },
};

function sanitizeRandomEventRow(row: Record<string, unknown>) {
  const safe = { ...row };
  const mapTypes = resolveRandomEventMapTypes({
    mapTypes: row.mapTypes,
    mapType: row.mapType,
  });
  safe.mapTypes = mapTypes;
  safe.mapType = mapTypes[0] || null;
  return safe;
}

export function resolveEntity(entityValue: string) {
  if (!isAdminEntity(entityValue)) {
    return null;
  }
  const config = ENTITY_CONFIG[entityValue];
  if (!config) {
    return null;
  }
  return {
    entity: entityValue,
    config,
  };
}

function sanitizeSkillRow(row: Record<string, unknown>) {
  const safe = { ...row };
  const split = splitSkillEffectsPayload(row.effects, row);
  safe.effects = split.effects;
  safe.visualEffectSpriteUrl = split.visualEffectSpriteUrl;
  safe.visualEffectFrameWidth = split.visualEffectFrameWidth;
  safe.visualEffectFrameHeight = split.visualEffectFrameHeight;
  safe.visualEffectFrameCount = split.visualEffectFrameCount;
  safe.visualEffectFrameDurationMs = split.visualEffectFrameDurationMs;
  safe.visualEffectScale = split.visualEffectScale;
  safe.visualEffectOffsetX = split.visualEffectOffsetX;
  safe.visualEffectOffsetY = split.visualEffectOffsetY;
  return safe;
}

if (ENTITY_CONFIG.skills) {
  ENTITY_CONFIG.skills.sanitizeList = (rows) => rows.map((row) => sanitizeSkillRow(row));
  ENTITY_CONFIG.skills.sanitizeOne = (row) => sanitizeSkillRow(row);
}

if (ENTITY_CONFIG.randomEvents) {
  ENTITY_CONFIG.randomEvents.sanitizeList = (rows) => rows.map((row) => sanitizeRandomEventRow(row));
  ENTITY_CONFIG.randomEvents.sanitizeOne = (row) => sanitizeRandomEventRow(row);
}
