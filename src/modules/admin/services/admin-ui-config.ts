import type { AdminEntity } from "@/modules/admin/services/admin-entities";
import { STATUS_EFFECTS, STATUS_NAMES } from "@/modules/shared/constants";
import { getTileTypeOptions } from "@/modules/map/services/map-tile-visual";
import {
  getSectPermissionLabel,
  getSectRoleLabel,
  SECT_ROLE_ORDER,
  SECT_ROLE_PERMISSION_DEFAULTS,
} from "@/modules/sect/services/sect-constants";

export interface AdminSelectOption {
  label: string;
  value: string;
}

export type AdminFieldType = "text" | "textarea" | "number" | "boolean" | "json" | "select";

export type JsonPrimitiveType = "string" | "number" | "boolean";

export interface AdminRelationConfig {
  entity: AdminEntity;
  labelKey: string;
}

export interface JsonSchemaField {
  key: string;
  label: string;
  type: JsonPrimitiveType;
  columnWidth?: number;
  required?: boolean;
  multiple?: boolean;
  relation?: AdminRelationConfig;
  relationByField?: {
    key: string;
    mapping: Record<string, AdminRelationConfig>;
  };
  visibleByField?: {
    key: string;
    values: string[];
  };
  visibleWhenRelationMatched?: boolean;
  syncLabelTo?: string;
  options?: AdminSelectOption[];
}

export interface AdminJsonSchema {
  kind: "array-object" | "array-string" | "object" | "reward-object" | "event-reward-object" | "fortune-event-effects" | "fortune-special-effects" | "event-judge-conditions" | "double-cultivation-secret-stats" | "gongfa-level-config" | "pregnancy-system-config";
  itemLabel?: string;
  fields?: JsonSchemaField[];
  relation?: AdminRelationConfig;
  options?: AdminSelectOption[];
}

export interface AdminFieldConfig {
  key: string;
  label: string;
  type: AdminFieldType;
  required?: boolean;
  readOnlyOnEdit?: boolean;
  multiple?: boolean;
  options?: AdminSelectOption[];
  placeholder?: string;
  relation?: AdminRelationConfig;
  jsonSchema?: AdminJsonSchema;
}

export interface AdminQuickFilterConfig {
  key: string;
  label: string;
  options: AdminSelectOption[];
}

export interface AdminUiConfig {
  disableCreate?: boolean;
  disableDelete?: boolean;
  tableFields: string[];
  formFields: AdminFieldConfig[];
  quickFilters?: AdminQuickFilterConfig[];
  extraFieldLabels?: Record<string, string>;
}

export const MAP_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "城镇", value: "city" },
  { label: "野外", value: "field" },
  { label: "秘境", value: "dungeon" },
  { label: "隐藏", value: "secret" },
  { label: "临时秘境", value: "secret_realm_instance" },
  { label: "宗门驻地", value: "sect" },
];

const MONSTER_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "普通", value: "normal" },
  { label: "精英", value: "elite" },
  { label: "首领", value: "boss" },
];

const ITEM_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "兵器", value: "weapon" },
  { label: "防具", value: "armor" },
  { label: "头盔", value: "helmet" },
  { label: "鞋子", value: "shoes" },
  { label: "法宝", value: "artifact" },
  { label: "丹药", value: "consumable" },
  { label: "神通书", value: "skill_book" },
  { label: "材料", value: "material" },
  { label: "任务", value: "quest" },
];

const RARITY_OPTIONS: AdminSelectOption[] = [
  { label: "凡品", value: "common" },
  { label: "良品", value: "uncommon" },
  { label: "上品", value: "rare" },
  { label: "极品", value: "epic" },
  { label: "仙品", value: "legendary" },
  { label: "鸿蒙", value: "hongmeng" },
];

const SKILL_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "攻击", value: "attack" },
  { label: "增益", value: "buff" },
  { label: "减益", value: "debuff" },
  { label: "治疗", value: "heal" },
  { label: "持续伤害", value: "dot" },
  { label: "群攻", value: "aoe" },
];

const SKILL_TARGET_OPTIONS: AdminSelectOption[] = [
  { label: "自己", value: "self" },
  { label: "敌方单体", value: "enemy" },
  { label: "敌方群体", value: "all_enemies" },
];

const QUEST_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "传话", value: "talk" },
  { label: "击杀", value: "kill" },
  { label: "收集", value: "collect" },
  { label: "检测", value: "detect" },
  { label: "悬赏", value: "bounty" },
];

const QUEST_CATEGORY_OPTIONS: AdminSelectOption[] = [
  { label: "主线", value: "main" },
  { label: "支线", value: "side" },
];

const EVENT_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "遭遇", value: "encounter" },
  { label: "机缘", value: "opportunity" },
];

const ENCOUNTER_MODE_OPTIONS: AdminSelectOption[] = [
  { label: "单段", value: "single" },
  { label: "链式", value: "chain" },
];

const FORTUNE_GRADE_OPTIONS: AdminSelectOption[] = [
  { label: "红", value: "red" },
  { label: "金", value: "gold" },
  { label: "紫", value: "purple" },
  { label: "蓝", value: "blue" },
  { label: "白", value: "white" },
];

const FORTUNE_GENDER_OPTIONS: AdminSelectOption[] = [
  { label: "不限", value: "" },
  { label: "男", value: "男" },
  { label: "女", value: "女" },
];

const ELEMENT_OPTIONS: AdminSelectOption[] = [
  { label: "金", value: "金" },
  { label: "木", value: "木" },
  { label: "水", value: "水" },
  { label: "火", value: "火" },
  { label: "土", value: "土" },
  { label: "雷", value: "雷" },
  { label: "冰", value: "冰" },
  { label: "风", value: "风" },
  { label: "暗", value: "暗" },
  { label: "光", value: "光" },
];

const BOOLEAN_FILTER_OPTIONS: AdminSelectOption[] = [
  { label: "是", value: "true" },
  { label: "否", value: "false" },
];

const SECT_ROLE_OPTIONS: AdminSelectOption[] = SECT_ROLE_ORDER.map((roleKey) => ({
  label: getSectRoleLabel(roleKey),
  value: roleKey,
}));

const SECT_PERMISSION_OPTIONS: AdminSelectOption[] = Array.from(new Set(
  Object.values(SECT_ROLE_PERMISSION_DEFAULTS).flat(),
)).map((permissionKey) => ({
  label: getSectPermissionLabel(permissionKey),
  value: permissionKey,
}));

const AI_ITEM_SOURCE_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "秘境掉落", value: "secret_realm" },
  { label: "AI炼器", value: "ai_smithing" },
  { label: "AI炼丹", value: "ai_alchemy" },
  { label: "灵田升品", value: "spiritual_field_quality_upgrade" },
  { label: "历史炼丹遗留", value: "legacy_ai_alchemy" },
];

const AI_ITEM_CLEANUP_STATE_OPTIONS: AdminSelectOption[] = [
  { label: "可清理", value: "candidate" },
  { label: "仍被引用", value: "protected" },
  { label: "历史待归档", value: "legacy_unknown" },
];

const AI_ITEM_SOURCE_TYPE_FORM_OPTIONS = AI_ITEM_SOURCE_TYPE_OPTIONS.filter((option) => option.value !== "legacy_ai_alchemy");

const SYSTEM_CONFIG_GROUP_OPTIONS: AdminSelectOption[] = [
  { label: "LLM", value: "llm" },
  { label: "OAuth", value: "oauth" },
  { label: "游戏", value: "game" },
  { label: "提示词", value: "prompt" },
];

const QUEST_REQUIREMENT_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "传话", value: "talk" },
  { label: "击杀", value: "kill" },
  { label: "收集", value: "collect" },
  { label: "境界", value: "realm" },
  { label: "战力", value: "power" },
];

const TILE_TYPE_OPTIONS: AdminSelectOption[] = getTileTypeOptions();

const ITEM_EFFECT_TYPE_OPTIONS: AdminSelectOption[] = [
  { label: "回复气血", value: "heal_hp" },
  { label: "回复灵力", value: "heal_mp" },
  { label: "回复体力", value: "heal_stamina" },
  { label: "突破加成", value: "boost_breakthrough" },
  { label: "攻击加成", value: "boost_atk" },
  { label: "防御加成", value: "boost_def" },
  { label: "增加修为", value: "boost_xp" },
  { label: "最大气血加成", value: "boost_hp" },
  { label: "最大灵力加成", value: "boost_mp" },
  { label: "遁速加成", value: "boost_speed" },
  { label: "幸运加成", value: "boost_luck" },
  { label: "参悟神通", value: "learn_skill" },
  { label: "绑定神通", value: "bind_skill" },
  { label: "激活头像", value: "unlock_avatar" },
  { label: "激活头像框", value: "unlock_avatar_frame" },
];

const ITEM_EFFECT_VALUE_VISIBLE_TYPES = ITEM_EFFECT_TYPE_OPTIONS
  .map((option) => option.value)
  .filter((value) => value !== "learn_skill" && value !== "bind_skill" && value !== "unlock_avatar" && value !== "unlock_avatar_frame");

const SKILL_EFFECT_TYPE_OPTIONS: AdminSelectOption[] = STATUS_EFFECTS.map((value) => ({
  label: STATUS_NAMES[value] ?? value,
  value,
}));

const MAP_TILE_JSON_FIELDS: JsonSchemaField[] = [
  { key: "x", label: "X", type: "number", required: true, columnWidth: 80 },
  { key: "y", label: "Y", type: "number", required: true, columnWidth: 80 },
  { key: "type", label: "类型", type: "string", required: true, options: TILE_TYPE_OPTIONS, columnWidth: 140 },
  { key: "walkable", label: "可通行", type: "boolean", columnWidth: 100 },
  { key: "description", label: "描述", type: "string", columnWidth: 220 },
  { key: "imageUrl", label: "ICON/图片", type: "string", columnWidth: 280 },
  {
    key: "portalId",
    label: "本阵ID",
    type: "string",
    columnWidth: 220,
    visibleWhenRelationMatched: true,
    visibleByField: {
      key: "type",
      values: ["portal"],
    },
  },
  {
    key: "portalName",
    label: "传送阵名",
    type: "string",
    columnWidth: 220,
    visibleWhenRelationMatched: true,
    visibleByField: {
      key: "type",
      values: ["portal"],
    },
  },
  {
    key: "portalTargetMapId",
    label: "目标地图",
    type: "string",
    columnWidth: 260,
    relation: { entity: "maps", labelKey: "name" },
    syncLabelTo: "portalTargetName",
    visibleWhenRelationMatched: true,
    visibleByField: {
      key: "type",
      values: ["portal"],
    },
  },
  {
    key: "portalTargetPortalId",
    label: "目标阵ID",
    type: "string",
    columnWidth: 220,
    visibleWhenRelationMatched: true,
    visibleByField: {
      key: "type",
      values: ["portal"],
    },
  },
  {
    key: "portalTargetName",
    label: "目标地图名",
    type: "string",
    columnWidth: 220,
    visibleWhenRelationMatched: true,
    visibleByField: {
      key: "type",
      values: ["portal"],
    },
  },
];

export const ADMIN_UI_CONFIG: Record<AdminEntity, AdminUiConfig> = {
  maps: {
    tableFields: ["id", "name", "mapType", "width", "height", "minRealm"],
    quickFilters: [
      { key: "mapType", label: "地图类型", options: MAP_TYPE_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "description", label: "描述", type: "textarea" },
      { key: "width", label: "宽度", type: "number", required: true },
      { key: "height", label: "高度", type: "number", required: true },
      { key: "minRealm", label: "最低境界", type: "number", required: true },
      { key: "mapType", label: "地图类型", type: "select", options: MAP_TYPE_OPTIONS, required: true },
      { key: "backgroundImageUrl", label: "背景图地址", type: "text", placeholder: "例如 /uploads/cosmetics/map-background/xxx.webp" },
      {
        key: "tilesData",
        label: "地块实体",
        type: "json",
        placeholder: '[{"x":1,"y":1,"type":"portal","walkable":true,"description":"渡口阵眼","imageUrl":"/uploads/cosmetics/map-marker/sea-gate.webp","portalId":"portal_a","portalName":"北礁渡阵","portalTargetMapId":"map_qingshili","portalTargetPortalId":"portal_b","portalTargetName":"青石里"}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "地块",
          fields: MAP_TILE_JSON_FIELDS,
        },
      },
    ],
  },
  temporaryMaps: {
    disableCreate: true,
    tableFields: ["id", "instanceId", "name", "mapType", "width", "height", "expiresAt"],
    quickFilters: [
      { key: "mapType", label: "地图类型", options: MAP_TYPE_OPTIONS },
    ],
    extraFieldLabels: {
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "instanceId", label: "实例ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "description", label: "描述", type: "textarea" },
      { key: "width", label: "宽度", type: "number", required: true },
      { key: "height", label: "高度", type: "number", required: true },
      { key: "minRealm", label: "最低境界", type: "number", required: true },
      { key: "mapType", label: "地图类型", type: "select", options: MAP_TYPE_OPTIONS, required: true },
      { key: "backgroundImageUrl", label: "背景图地址", type: "text", placeholder: "例如 /uploads/cosmetics/map-background/xxx.webp" },
      { key: "expiresAt", label: "过期时间", type: "text" },
      {
        key: "tilesData",
        label: "地块实体",
        type: "json",
        placeholder: '[{"x":1,"y":1,"type":"portal","walkable":true,"description":"回返阵","imageUrl":"/uploads/cosmetics/map-marker/return-gate.webp","portalId":"portal_return","portalName":"回返阵","portalTargetMapId":"map_starter_village","portalTargetPortalId":"portal_entry","portalTargetName":"新手村"}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "地块",
          fields: MAP_TILE_JSON_FIELDS,
        },
      },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  mapEdges: {
    tableFields: ["id", "mapAId", "mapBId"],
    formFields: [
      { key: "id", label: "ID", type: "number", readOnlyOnEdit: true, required: false },
      { key: "mapAId", label: "地图A", type: "text", required: true, relation: { entity: "maps", labelKey: "name" } },
      { key: "mapBId", label: "地图B", type: "text", required: true, relation: { entity: "maps", labelKey: "name" } },
    ],
  },
  sects: {
    tableFields: ["id", "name", "state", "level", "mapSize", "memberLimit", "externalMapId"],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "宗门名", type: "text", required: true },
      { key: "announcement", label: "公告", type: "textarea" },
      { key: "description", label: "描述", type: "textarea" },
      { key: "state", label: "状态", type: "text", required: true },
      { key: "externalMapId", label: "外部地图", type: "text", relation: { entity: "maps", labelKey: "name" } },
      { key: "externalPositionX", label: "入口X", type: "number", required: true },
      { key: "externalPositionY", label: "入口Y", type: "number", required: true },
      { key: "homeMapId", label: "宗门地图", type: "text", relation: { entity: "maps", labelKey: "name" } },
      { key: "founderPlayerId", label: "创建者", type: "text", relation: { entity: "players", labelKey: "name" } },
      { key: "governorPlayerId", label: "当前掌权者", type: "text", relation: { entity: "players", labelKey: "name" } },
      { key: "level", label: "等级", type: "number", required: true },
      { key: "mapSize", label: "尺寸", type: "number", required: true },
      { key: "memberLimit", label: "人数上限", type: "number", required: true },
      { key: "storageCapacity", label: "仓库容量", type: "number", required: true },
      { key: "joinApprovalEnabled", label: "入宗需审批", type: "boolean", required: true },
      { key: "visitorApprovalEnabled", label: "访客需审批", type: "boolean", required: true },
    ],
  },
  sectMembers: {
    tableFields: ["playerId", "sectId", "roleKey", "joinedAt", "appointedByPlayerId"],
    formFields: [
      { key: "playerId", label: "玩家", type: "text", relation: { entity: "players", labelKey: "name" }, required: true, readOnlyOnEdit: true },
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true },
      { key: "roleKey", label: "职位", type: "select", required: true, options: SECT_ROLE_OPTIONS },
      { key: "joinedAt", label: "加入时间", type: "text", readOnlyOnEdit: true },
      { key: "appointedByPlayerId", label: "任命者", type: "text", relation: { entity: "players", labelKey: "name" } },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  sectRolePermissions: {
    tableFields: ["sectId", "roleKey", "permissionKey", "enabled", "updatedAt"],
    formFields: [
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true },
      { key: "roleKey", label: "职位", type: "select", options: SECT_ROLE_OPTIONS, required: true },
      { key: "permissionKey", label: "权限", type: "select", options: SECT_PERMISSION_OPTIONS, required: true },
      { key: "enabled", label: "是否启用", type: "boolean", required: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  sectApplications: {
    tableFields: ["id", "sectId", "playerId", "type", "status", "createdAt", "respondedAt"],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true },
      { key: "playerId", label: "申请人", type: "text", relation: { entity: "players", labelKey: "name" }, required: true },
      { key: "type", label: "类型", type: "text", required: true },
      { key: "status", label: "状态", type: "text", required: true },
      { key: "note", label: "附言", type: "textarea" },
      { key: "reviewedByPlayerId", label: "审批人", type: "text", relation: { entity: "players", labelKey: "name" } },
      { key: "respondedAt", label: "处理时间", type: "text", readOnlyOnEdit: true },
      { key: "expiresAt", label: "过期时间", type: "text" },
    ],
  },
  sectBuildings: {
    tableFields: ["sectId", "buildingType", "name", "level", "positionX", "positionY"],
    formFields: [
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true },
      { key: "buildingType", label: "建筑类型", type: "text", required: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "level", label: "等级", type: "number", required: true },
      { key: "positionX", label: "X", type: "number", required: true },
      { key: "positionY", label: "Y", type: "number", required: true },
      { key: "description", label: "说明", type: "textarea" },
      { key: "meta", label: "扩展数据", type: "json" },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  sectResources: {
    tableFields: ["sectId", "spiritStone", "wood", "stone", "sectMaterial", "storageCapacity"],
    formFields: [
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true, readOnlyOnEdit: true },
      { key: "spiritStone", label: "灵石", type: "number", required: true },
      { key: "wood", label: "木材", type: "number", required: true },
      { key: "stone", label: "石料", type: "number", required: true },
      { key: "sectMaterial", label: "宗门材料", type: "number", required: true },
      { key: "storageCapacity", label: "仓库容量", type: "number", required: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  sectStorageItems: {
    tableFields: ["id", "sectId", "slotIndex", "itemId", "quantity", "updatedAt"],
    formFields: [
      { key: "id", label: "ID", type: "number", readOnlyOnEdit: true },
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true },
      { key: "slotIndex", label: "槽位", type: "number", required: true },
      { key: "itemId", label: "物品", type: "text", relation: { entity: "items", labelKey: "name" }, required: true },
      { key: "quantity", label: "数量", type: "number", required: true },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  sectLogs: {
    tableFields: ["id", "sectId", "actorPlayerId", "actionType", "createdAt"],
    formFields: [
      { key: "id", label: "ID", type: "number", readOnlyOnEdit: true },
      { key: "sectId", label: "宗门", type: "text", relation: { entity: "sects", labelKey: "name" }, required: true },
      { key: "actorPlayerId", label: "操作人", type: "text", relation: { entity: "players", labelKey: "name" } },
      { key: "actionType", label: "动作类型", type: "text", required: true },
      { key: "detail", label: "详情", type: "json" },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  npcs: {
    tableFields: [
      "id",
      "name",
      "title",
      "avatarImageUrl",
      "portraitImageUrl",
      "mapId",
      "positionX",
      "positionY",
      "isShop",
      "bountyEnabled",
      "bountyDailyLimit",
    ],
    quickFilters: [
      { key: "isShop", label: "商店NPC", options: BOOLEAN_FILTER_OPTIONS },
      { key: "bountyEnabled", label: "悬赏NPC", options: BOOLEAN_FILTER_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "title", label: "称号", type: "text" },
      { key: "description", label: "描述", type: "textarea" },
      { key: "avatarImageUrl", label: "头像地址", type: "text", placeholder: "例如 /uploads/cosmetics/npc-avatar/xxx.webp" },
      { key: "portraitImageUrl", label: "立绘地址", type: "text", placeholder: "例如 /uploads/cosmetics/npc-portrait/xxx.webp" },
      { key: "mapId", label: "地图", type: "text", relation: { entity: "maps", labelKey: "name" } },
      { key: "positionX", label: "X坐标", type: "number" },
      { key: "positionY", label: "Y坐标", type: "number" },
      { key: "personality", label: "AI人格", type: "textarea" },
      { key: "isShop", label: "商店NPC", type: "boolean", required: true },
      { key: "bountyEnabled", label: "悬赏NPC", type: "boolean", required: true },
      { key: "bountyDailyLimit", label: "每日悬赏次数", type: "number", required: true },
      {
        key: "shopItems",
        label: "商店物品",
        type: "json",
        placeholder: '[{"itemId":"item_healing_pill_low","price":50}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "商品",
          fields: [
            { key: "itemId", label: "物品", type: "string", required: true, relation: { entity: "items", labelKey: "name" } },
            { key: "price", label: "价格", type: "number", required: true },
          ],
        },
      },
    ],
  },
  accounts: {
    disableCreate: true,
    tableFields: ["id", "email", "username", "isAdmin", "createdAt"],
    quickFilters: [
      { key: "isAdmin", label: "管理员", options: BOOLEAN_FILTER_OPTIONS },
    ],
    extraFieldLabels: {
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "text", required: true, readOnlyOnEdit: true },
      { key: "email", label: "邮箱", type: "text" },
      { key: "username", label: "用户名", type: "text" },
      { key: "password", label: "新密码", type: "text", placeholder: "留空则不修改" },
      { key: "isAdmin", label: "管理员", type: "boolean", required: true },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  players: {
    disableCreate: true,
    tableFields: ["id", "accountId", "name", "realmName", "cultivationXp", "pillToxicity", "gold", "lingYu", "isAlive", "createdAt"],
    quickFilters: [
      { key: "isAlive", label: "存活", options: BOOLEAN_FILTER_OPTIONS },
    ],
    extraFieldLabels: {
      createdAt: "创建时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "text", required: true, readOnlyOnEdit: true },
      { key: "accountId", label: "所属账号", type: "text", required: true, readOnlyOnEdit: true, relation: { entity: "accounts", labelKey: "email" } },
      { key: "name", label: "角色名", type: "text", required: true },
      { key: "gender", label: "性别", type: "text" },
      { key: "realm", label: "境界等级", type: "number", required: true },
      { key: "realmMajor", label: "大境界序号", type: "number", required: true },
      { key: "realmMinor", label: "境界重数", type: "number", required: true },
      { key: "realmName", label: "境界名称", type: "text", required: true },
      { key: "cultivationXp", label: "修为", type: "number", required: true },
      { key: "pillToxicity", label: "当前丹毒", type: "number", required: true },
      { key: "hp", label: "气血", type: "number", required: true },
      { key: "maxHp", label: "最大气血", type: "number", required: true },
      { key: "mp", label: "灵力", type: "number", required: true },
      { key: "maxMp", label: "最大灵力", type: "number", required: true },
      { key: "attack", label: "攻击", type: "number", required: true },
      { key: "defense", label: "防御", type: "number", required: true },
      { key: "speed", label: "遁速", type: "number", required: true },
      { key: "luck", label: "幸运", type: "number", required: true },
      { key: "gold", label: "灵石", type: "number", required: true },
      { key: "lingYu", label: "灵玉", type: "number", required: true, readOnlyOnEdit: true },
      { key: "pillToxicityUpdatedAt", label: "丹毒结算时间", type: "text", readOnlyOnEdit: true },
      { key: "currentMapId", label: "当前地图", type: "text", relation: { entity: "maps", labelKey: "name" } },
      { key: "positionX", label: "X坐标", type: "number", required: true },
      { key: "positionY", label: "Y坐标", type: "number", required: true },
      { key: "isAlive", label: "存活", type: "boolean", required: true },
    ],
  },
  fortunes: {
    tableFields: ["id", "name", "gender", "enabled", "isHidden", "isStarter", "starterWeight", "grade", "durationSeconds", "updatedAt"],
    quickFilters: [
      { key: "enabled", label: "是否启用", options: BOOLEAN_FILTER_OPTIONS },
      { key: "isHidden", label: "隐藏气运", options: BOOLEAN_FILTER_OPTIONS },
      { key: "isStarter", label: "开局气运", options: BOOLEAN_FILTER_OPTIONS },
    ],
    extraFieldLabels: {
      gender: "适用性别",
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "气运名称", type: "text", required: true },
      { key: "description", label: "简介", type: "textarea" },
      { key: "gender", label: "适用性别", type: "select", options: FORTUNE_GENDER_OPTIONS },
      { key: "enabled", label: "是否生效", type: "boolean", required: true },
      { key: "isHidden", label: "是否隐藏气运", type: "boolean", required: true },
      { key: "isStarter", label: "是否开局气运", type: "boolean", required: true },
      { key: "starterWeight", label: "开局出现权重", type: "number", required: true },
      { key: "grade", label: "品级", type: "select", options: FORTUNE_GRADE_OPTIONS, required: true },
      { key: "durationSeconds", label: "时效(秒,0=永久)", type: "number", required: true },
      {
        key: "attrEffects",
        label: "属性加成",
        type: "json",
        placeholder: "{\"attack\":10,\"maxHp\":100}",
        jsonSchema: {
          kind: "object",
          fields: [
            { key: "hp", label: "hp", type: "number" },
            { key: "maxHp", label: "maxHp", type: "number" },
            { key: "mp", label: "mp", type: "number" },
            { key: "maxMp", label: "maxMp", type: "number" },
            { key: "attack", label: "attack", type: "number" },
            { key: "defense", label: "defense", type: "number" },
            { key: "speed", label: "speed", type: "number" },
            { key: "luck", label: "luck", type: "number" },
          ],
        },
      },
      {
        key: "eventEffects",
        label: "特殊事件加成",
        type: "json",
        placeholder: "{\"killMonster\":{\"attack\":1},\"selfDeath\":{\"luck\":2}}",
        jsonSchema: {
          kind: "fortune-event-effects",
        },
      },
      {
        key: "specialEffects",
        label: "特殊效果加成",
        type: "json",
        placeholder: "{\"combatXpRate\":0.2,\"questXpRate\":0.1}",
        jsonSchema: {
          kind: "fortune-special-effects",
        },
      },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  items: {
    tableFields: ["id", "name", "iconUrl", "itemType", "pillToxicity", "rarity", "stackable", "isBound", "minRealm", "maxRealm"],
    quickFilters: [
      { key: "itemType", label: "物品类型", options: ITEM_TYPE_OPTIONS },
      { key: "rarity", label: "品质", options: RARITY_OPTIONS },
      { key: "isBound", label: "绑定", options: BOOLEAN_FILTER_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "iconUrl", label: "图标地址", type: "text", placeholder: "例如 /uploads/cosmetics/item/xxx.webp" },
      { key: "description", label: "描述", type: "textarea" },
      { key: "itemType", label: "物品类型", type: "select", options: ITEM_TYPE_OPTIONS, required: true },
      { key: "rarity", label: "品质", type: "select", options: RARITY_OPTIONS, required: true },
      {
        key: "effects",
        label: "效果",
        type: "json",
        placeholder: '[{"type":"heal_hp","value":30},{"type":"learn_skill","skillId":"skill_wind_cut"},{"type":"unlock_avatar","avatarId":"avatar_xxx"}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "效果",
          fields: [
            { key: "type", label: "类型", type: "string", required: true, options: ITEM_EFFECT_TYPE_OPTIONS, columnWidth: 180 },
            {
              key: "skillId",
              label: "神通ID",
              type: "string",
              columnWidth: 260,
              visibleWhenRelationMatched: true,
              relationByField: {
                key: "type",
                mapping: {
                  learn_skill: { entity: "skills", labelKey: "name" },
                  bind_skill: { entity: "skills", labelKey: "name" },
                },
              },
            },
            {
              key: "avatarId",
              label: "头像ID",
              type: "string",
              columnWidth: 260,
              visibleWhenRelationMatched: true,
              visibleByField: {
                key: "type",
                values: ["unlock_avatar"],
              },
            },
            {
              key: "avatarFrameId",
              label: "头像框ID",
              type: "string",
              columnWidth: 260,
              visibleWhenRelationMatched: true,
              visibleByField: {
                key: "type",
                values: ["unlock_avatar_frame"],
              },
            },
            {
              key: "value",
              label: "值",
              type: "number",
              required: true,
              visibleWhenRelationMatched: true,
              visibleByField: {
                key: "type",
                values: ITEM_EFFECT_VALUE_VISIBLE_TYPES,
              },
            },
          ],
        },
      },
      { key: "pillToxicity", label: "丹毒值", type: "number", required: true, placeholder: "修为丹默认 1，仅对增加修为的丹药生效" },
      { key: "stackable", label: "可堆叠", type: "boolean", required: true },
      { key: "isBound", label: "绑定物品", type: "boolean", required: true },
      { key: "minRealm", label: "最低境界", type: "number" },
      { key: "maxRealm", label: "最高境界", type: "number" },
    ],
  },
  aiItems: {
    disableCreate: true,
    disableDelete: true,
    tableFields: [
      "id",
      "name",
      "iconUrl",
      "itemType",
      "rarity",
      "sourceType",
      "sourceCategory",
      "sourcePlayerId",
      "cleanupState",
      "createdAt",
    ],
    quickFilters: [
      { key: "sourceType", label: "来源", options: AI_ITEM_SOURCE_TYPE_OPTIONS },
      { key: "itemType", label: "物品类型", options: ITEM_TYPE_OPTIONS },
      { key: "rarity", label: "品质", options: RARITY_OPTIONS },
      { key: "cleanupState", label: "清理状态", options: AI_ITEM_CLEANUP_STATE_OPTIONS },
    ],
    extraFieldLabels: {
      cleanupState: "清理状态",
      sourceType: "来源类型",
      sourceInstanceId: "来源秘境",
      sourceMonsterId: "来源怪物",
      sourcePlayerId: "来源玩家",
      sourceCategory: "来源分类",
      generatedSeed: "生成种子",
      referenceCount: "引用数",
      referenceSummary: "引用详情",
      createdAt: "创建时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "iconUrl", label: "图标地址", type: "text", placeholder: "例如 /uploads/cosmetics/item/xxx.webp" },
      { key: "description", label: "描述", type: "textarea" },
      { key: "itemType", label: "物品类型", type: "select", options: ITEM_TYPE_OPTIONS, required: true },
      { key: "rarity", label: "品质", type: "select", options: RARITY_OPTIONS, required: true },
      { key: "sourceType", label: "来源类型", type: "select", options: AI_ITEM_SOURCE_TYPE_FORM_OPTIONS, required: true },
      { key: "sourceCategory", label: "来源分类", type: "text" },
      { key: "sourcePlayerId", label: "来源玩家", type: "text", relation: { entity: "players", labelKey: "name" } },
      { key: "sourceInstanceId", label: "来源秘境", type: "text" },
      { key: "sourceMonsterId", label: "来源怪物", type: "text" },
      { key: "generatedSeed", label: "生成种子", type: "text" },
      {
        key: "sourceMeta",
        label: "来源元数据",
        type: "json",
        placeholder: "{\"route\":\"swift_ring\",\"element\":\"water\"}",
        jsonSchema: {
          kind: "object",
          fields: [],
        },
      },
      {
        key: "effects",
        label: "效果",
        type: "json",
        placeholder: '[{"type":"heal_hp","value":30}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "效果",
          fields: [
            { key: "type", label: "类型", type: "string", required: true, options: ITEM_EFFECT_TYPE_OPTIONS, columnWidth: 180 },
            {
              key: "skillId",
              label: "神通ID",
              type: "string",
              columnWidth: 260,
              visibleWhenRelationMatched: true,
              relationByField: {
                key: "type",
                mapping: {
                  learn_skill: { entity: "skills", labelKey: "name" },
                  bind_skill: { entity: "skills", labelKey: "name" },
                },
              },
            },
            {
              key: "avatarId",
              label: "头像ID",
              type: "string",
              columnWidth: 260,
              visibleWhenRelationMatched: true,
              visibleByField: {
                key: "type",
                values: ["unlock_avatar"],
              },
            },
            {
              key: "avatarFrameId",
              label: "头像框ID",
              type: "string",
              columnWidth: 260,
              visibleWhenRelationMatched: true,
              visibleByField: {
                key: "type",
                values: ["unlock_avatar_frame"],
              },
            },
            {
              key: "value",
              label: "值",
              type: "number",
              required: true,
              visibleWhenRelationMatched: true,
              visibleByField: {
                key: "type",
                values: ITEM_EFFECT_VALUE_VISIBLE_TYPES,
              },
            },
          ],
        },
      },
      { key: "pillToxicity", label: "丹毒值", type: "number", required: true },
      { key: "stackable", label: "可堆叠", type: "boolean", required: true },
      { key: "isBound", label: "绑定物品", type: "boolean", required: true },
      { key: "minRealm", label: "最低境界", type: "number" },
      { key: "maxRealm", label: "最高境界", type: "number" },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  pillToxicityConfigs: {
    disableCreate: true,
    disableDelete: true,
    tableFields: ["key", "maxToxicity", "recoverIntervalMinutes", "updatedAt"],
    extraFieldLabels: {
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "key", label: "配置键", type: "text", required: true, readOnlyOnEdit: true },
      { key: "maxToxicity", label: "丹毒上限", type: "number", required: true },
      { key: "recoverIntervalMinutes", label: "恢复间隔(分钟/点)", type: "number", required: true },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  hongmengTreasures: {
    tableFields: [
      "itemId",
      "enabled",
      "maxStar",
      "spiritualFieldEnergyCost",
      "spiritualFieldReduceSeconds",
      "updatedAt",
    ],
    quickFilters: [
      { key: "enabled", label: "启用", options: BOOLEAN_FILTER_OPTIONS },
    ],
    formFields: [
      {
        key: "itemId",
        label: "至宝物品",
        type: "text",
        required: true,
        readOnlyOnEdit: true,
        relation: { entity: "items", labelKey: "name" },
      },
      { key: "enabled", label: "启用", type: "boolean", required: true },
      { key: "maxStar", label: "最高星级", type: "number", required: true },
      {
        key: "starConfigs",
        label: "星级配置",
        type: "json",
        placeholder: '[{"star":0,"energyCap":200,"regenSecondsPerEnergy":480}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "星级",
          fields: [
            { key: "star", label: "星级", type: "number", required: true, columnWidth: 120 },
            { key: "energyCap", label: "能量上限", type: "number", required: true, columnWidth: 140 },
            { key: "regenSecondsPerEnergy", label: "恢复间隔(秒/点)", type: "number", required: true, columnWidth: 180 },
          ],
        },
      },
      {
        key: "upgradeCosts",
        label: "升星消耗",
        type: "json",
        placeholder: '[{"fromStar":0,"costItemId":"item_xxx","costQuantity":1}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "消耗",
          fields: [
            { key: "fromStar", label: "当前星级", type: "number", required: true, columnWidth: 120 },
            {
              key: "costItemId",
              label: "消耗物品",
              type: "string",
              required: true,
              columnWidth: 260,
              relation: { entity: "items", labelKey: "name" },
            },
            { key: "costQuantity", label: "数量", type: "number", required: true, columnWidth: 120 },
          ],
        },
      },
      { key: "spiritualFieldEnergyCost", label: "灵田浇灌消耗能量", type: "number", required: true },
      { key: "spiritualFieldReduceSeconds", label: "灵田浇灌缩短时间(秒)", type: "number", required: true },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  skills: {
    tableFields: ["id", "name", "skillType", "element", "damageBase", "mpCost", "cooldown", "minRealm", "maxRealm"],
    quickFilters: [
      { key: "skillType", label: "神通类型", options: SKILL_TYPE_OPTIONS },
      { key: "element", label: "元素", options: ELEMENT_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "description", label: "描述", type: "textarea" },
      { key: "skillType", label: "神通类型", type: "select", options: SKILL_TYPE_OPTIONS, required: true },
      { key: "element", label: "元素", type: "select", options: ELEMENT_OPTIONS },
      { key: "damageBase", label: "基础伤害", type: "number", required: true },
      { key: "damageMultiplier", label: "伤害倍率", type: "number", required: true },
      { key: "mpCost", label: "消耗灵力", type: "number", required: true },
      { key: "cooldown", label: "冷却", type: "number", required: true },
      {
        key: "effects",
        label: "效果",
        type: "json",
        placeholder: '[{"type":"burn","value":5,"duration":3,"chance":0.3}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "效果",
          fields: [
            { key: "type", label: "类型", type: "string", required: true, options: SKILL_EFFECT_TYPE_OPTIONS },
            { key: "value", label: "值", type: "number", required: true },
            { key: "duration", label: "持续", type: "number", required: true },
            { key: "chance", label: "概率", type: "number", required: true },
          ],
        },
      },
      { key: "minRealm", label: "最低境界", type: "number" },
      { key: "maxRealm", label: "最高境界", type: "number" },
      { key: "target", label: "目标类型", type: "select", options: SKILL_TARGET_OPTIONS, required: true },
    ],
  },
  monsters: {
    tableFields: [
      "id",
      "name",
      "iconUrl",
      "monsterType",
      "level",
      "mapId",
      "positionX",
      "positionY",
      "aiMoveIntervalMinSeconds",
      "aiMoveIntervalMaxSeconds",
      "aiMoveRange",
    ],
    quickFilters: [
      { key: "monsterType", label: "怪物类型", options: MONSTER_TYPE_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "iconUrl", label: "图标地址", type: "text", placeholder: "例如 /uploads/cosmetics/monster/xxx.webp" },
      { key: "description", label: "描述", type: "textarea" },
      { key: "monsterType", label: "怪物类型", type: "select", options: MONSTER_TYPE_OPTIONS, required: true },
      { key: "level", label: "等级", type: "number", required: true },
      { key: "hp", label: "气血", type: "number", required: true },
      { key: "attack", label: "攻击", type: "number", required: true },
      { key: "defense", label: "防御", type: "number", required: true },
      { key: "speed", label: "遁速", type: "number", required: true },
      {
        key: "skills",
        label: "神通列表",
        type: "json",
        placeholder: '["skill_basic_attack"]',
        jsonSchema: {
          kind: "array-string",
          relation: { entity: "skills", labelKey: "name" },
        },
      },
      {
        key: "drops",
        label: "掉落列表",
        type: "json",
        placeholder: '[{"itemId":"item_healing_pill_low","chance":0.5,"minQuantity":1,"maxQuantity":2}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "掉落",
          fields: [
            { key: "itemId", label: "物品", type: "string", required: true, relation: { entity: "items", labelKey: "name" } },
            { key: "chance", label: "概率", type: "number", required: true },
            { key: "minQuantity", label: "最小数", type: "number", required: true },
            { key: "maxQuantity", label: "最大数", type: "number", required: true },
          ],
        },
      },
      { key: "xpReward", label: "经验奖励", type: "number", required: true },
      { key: "goldReward", label: "灵石奖励", type: "number", required: true },
      { key: "mapId", label: "地图", type: "text", required: true, relation: { entity: "maps", labelKey: "name" } },
      { key: "positionX", label: "X坐标", type: "number", required: true },
      { key: "positionY", label: "Y坐标", type: "number", required: true },
      { key: "aiMoveIntervalMinSeconds", label: "巡逻最短间隔(秒)", type: "number", placeholder: "留空则默认 3" },
      { key: "aiMoveIntervalMaxSeconds", label: "巡逻最长间隔(秒)", type: "number", placeholder: "留空则默认 6" },
      { key: "aiMoveRange", label: "巡逻范围(格)", type: "number", placeholder: "留空则默认 6，0 表示不移动" },
      { key: "respawnSeconds", label: "重生秒数", type: "number", required: true },
    ],
  },
  temporaryMonsters: {
    disableCreate: true,
    tableFields: [
      "id",
      "instanceId",
      "name",
      "iconUrl",
      "monsterType",
      "level",
      "mapId",
      "positionX",
      "positionY",
      "expiresAt",
    ],
    quickFilters: [
      { key: "monsterType", label: "怪物类型", options: MONSTER_TYPE_OPTIONS },
    ],
    extraFieldLabels: {
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "instanceId", label: "实例ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "名称", type: "text", required: true },
      { key: "iconUrl", label: "图标地址", type: "text", placeholder: "例如 /uploads/cosmetics/monster/xxx.webp" },
      { key: "description", label: "描述", type: "textarea" },
      { key: "monsterType", label: "怪物类型", type: "select", options: MONSTER_TYPE_OPTIONS, required: true },
      { key: "level", label: "等级", type: "number", required: true },
      { key: "hp", label: "气血", type: "number", required: true },
      { key: "attack", label: "攻击", type: "number", required: true },
      { key: "defense", label: "防御", type: "number", required: true },
      { key: "speed", label: "遁速", type: "number", required: true },
      {
        key: "skills",
        label: "神通列表",
        type: "json",
        placeholder: '["skill_basic_attack"]',
        jsonSchema: {
          kind: "array-string",
          relation: { entity: "skills", labelKey: "name" },
        },
      },
      {
        key: "drops",
        label: "掉落列表",
        type: "json",
        placeholder: '[{"itemId":"item_healing_pill_low","chance":0.5,"minQuantity":1,"maxQuantity":2}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "掉落",
          fields: [
            { key: "itemId", label: "物品", type: "string", required: true, relation: { entity: "items", labelKey: "name" } },
            { key: "chance", label: "概率", type: "number", required: true },
            { key: "minQuantity", label: "最小数", type: "number", required: true },
            { key: "maxQuantity", label: "最大数", type: "number", required: true },
          ],
        },
      },
      { key: "xpReward", label: "经验奖励", type: "number", required: true },
      { key: "goldReward", label: "灵石奖励", type: "number", required: true },
      { key: "mapId", label: "临时地图", type: "text", required: true, relation: { entity: "temporaryMaps", labelKey: "name" } },
      { key: "positionX", label: "X坐标", type: "number", required: true },
      { key: "positionY", label: "Y坐标", type: "number", required: true },
      { key: "currentPositionX", label: "当前X坐标", type: "number" },
      { key: "currentPositionY", label: "当前Y坐标", type: "number" },
      { key: "nextAiMoveAt", label: "下次AI移动时间", type: "text" },
      { key: "positionUpdatedAt", label: "位置更新时间", type: "text" },
      { key: "aiMoveIntervalMinSeconds", label: "巡逻最短间隔(秒)", type: "number", placeholder: "留空则默认 3" },
      { key: "aiMoveIntervalMaxSeconds", label: "巡逻最长间隔(秒)", type: "number", placeholder: "留空则默认 6" },
      { key: "aiMoveRange", label: "巡逻范围(格)", type: "number", placeholder: "留空则默认 6，0 表示不移动" },
      { key: "respawnSeconds", label: "重生秒数", type: "number", required: true },
      { key: "expiresAt", label: "过期时间", type: "text" },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  quests: {
    tableFields: ["id", "name", "questCategory", "questType", "acceptNpcId", "completeNpcId", "minRealm", "maxRealm", "repeatable"],
    quickFilters: [
      { key: "questCategory", label: "任务分类", options: QUEST_CATEGORY_OPTIONS },
      { key: "questType", label: "任务类型", options: QUEST_TYPE_OPTIONS },
      { key: "repeatable", label: "可重复", options: BOOLEAN_FILTER_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "任务名称", type: "text", required: true },
      { key: "description", label: "任务描述", type: "textarea" },
      { key: "questCategory", label: "任务分类", type: "select", options: QUEST_CATEGORY_OPTIONS, required: true },
      { key: "questType", label: "任务类型", type: "select", options: QUEST_TYPE_OPTIONS, required: true },
      { key: "acceptNpcId", label: "接取NPC", type: "text", required: true, relation: { entity: "npcs", labelKey: "name" } },
      { key: "completeNpcId", label: "完成NPC", type: "text", required: true, relation: { entity: "npcs", labelKey: "name" } },
      { key: "acceptStory", label: "接取剧情", type: "textarea" },
      { key: "completeStory", label: "完成剧情", type: "textarea" },
      {
        key: "requirements",
        label: "任务要求",
        type: "json",
        placeholder: '[{"type":"kill","targetId":"monster_wolf","targetName":"野狼","quantity":3},{"type":"power","targetName":"综合战力","quantity":5000}]',
        jsonSchema: {
          kind: "array-object",
          itemLabel: "条件",
          fields: [
            { key: "type", label: "类型", type: "string", required: true, options: QUEST_REQUIREMENT_TYPE_OPTIONS },
            {
              key: "targetId",
              label: "目标ID",
              type: "string",
              required: true,
              relationByField: {
                key: "type",
                mapping: {
                  talk: { entity: "npcs", labelKey: "name" },
                  kill: { entity: "monsters", labelKey: "name" },
                  collect: { entity: "items", labelKey: "name" },
                },
              },
              visibleWhenRelationMatched: true,
              syncLabelTo: "targetName",
            },
            { key: "targetName", label: "目标名/要求说明", type: "string", required: true },
            { key: "quantity", label: "要求值", type: "number", required: true },
          ],
        },
      },
      {
        key: "rewards",
        label: "任务奖励",
        type: "json",
        placeholder: '{"xp":100,"gold":50,"items":[{"itemId":"item_healing_pill_low","quantity":1}],"fortuneIds":["fortune_demo"]}',
        jsonSchema: {
          kind: "reward-object",
        },
      },
      {
        key: "prerequisites",
        label: "前置任务",
        type: "json",
        placeholder: '["quest_first_hunt"]',
        jsonSchema: {
          kind: "array-string",
          relation: { entity: "quests", labelKey: "name" },
        },
      },
      { key: "minRealm", label: "最低境界", type: "number", required: true },
      { key: "maxRealm", label: "最高境界", type: "number" },
      { key: "repeatable", label: "可重复", type: "boolean", required: true },
    ],
  },
  randomEvents: {
    tableFields: [
      "id",
      "name",
      "eventType",
      "encounterMode",
      "probability",
      "spawnIntervalSeconds",
      "durationSeconds",
      "minRealm",
      "maxRealm",
      "mapTypes",
      "mapIds",
    ],
    quickFilters: [
      { key: "eventType", label: "事件类型", options: EVENT_TYPE_OPTIONS },
      { key: "mapType", label: "地图类型", options: MAP_TYPE_OPTIONS },
    ],
    formFields: [
      { key: "id", label: "ID", type: "text", readOnlyOnEdit: true },
      { key: "name", label: "事件名称", type: "text", required: true },
      { key: "description", label: "事件描述", type: "textarea" },
      { key: "iconImageUrl", label: "机缘图标", type: "text", placeholder: "例如 /uploads/cosmetics/event-icon/xxx.webp" },
      {
        key: "imageUrls",
        label: "事件插图",
        type: "json",
        placeholder: '["/uploads/cosmetics/event-illustration/xxx.webp"]',
        jsonSchema: {
          kind: "array-string",
        },
      },
      { key: "eventType", label: "事件类型", type: "select", options: EVENT_TYPE_OPTIONS, required: true },
      { key: "encounterMode", label: "遭遇模式", type: "select", options: ENCOUNTER_MODE_OPTIONS, required: true },
      { key: "encounterStageCount", label: "链式段数", type: "number", placeholder: "链式遭遇限定 2-4，默认 3" },
      { key: "encounterChoiceCount", label: "每段选项数", type: "number", placeholder: "链式遭遇限定 2-3，默认 2" },
      { key: "probability", label: "触发概率（0~1）", type: "number", required: true, placeholder: "例如 0.01 表示 1%" },
      { key: "spawnIntervalSeconds", label: "事件间隔(秒)", type: "number", placeholder: "遭遇事件表示触发间隔，机缘事件表示刷新间隔" },
      { key: "durationSeconds", label: "存活时长(秒)", type: "number" },
      { key: "minRealm", label: "最低境界", type: "number", required: true },
      { key: "maxRealm", label: "最高境界", type: "number" },
      {
        key: "mapTypes",
        label: "地图类型",
        type: "select",
        options: MAP_TYPE_OPTIONS,
        multiple: true,
        placeholder: "可选择多个地图类型",
      },
      {
        key: "mapIds",
        label: "指定地图",
        type: "json",
        placeholder: '["map_blackpine_forest","map_redsand_post"]',
        jsonSchema: {
          kind: "array-string",
          relation: { entity: "maps", labelKey: "name" },
        },
      },
      {
        key: "judgeConditions",
        label: "判定条件",
        type: "json",
        placeholder: '{"gender":"女","fortuneConditions":[{"fortuneId":"fortune_a","hasFortune":true},{"fortuneId":"fortune_b","hasFortune":false}],"pluginConditions":{"double-cultivation":{"minIntimacyScore":100}}}',
        jsonSchema: {
          kind: "event-judge-conditions",
        },
      },
      {
        key: "rewards",
        label: "事件奖励",
        type: "json",
        placeholder: '{"xp":30,"gold":20,"items":[{"itemId":"item_spirit_herb","quantity":1}],"fortuneIds":["fortune_demo"],"removeFortuneIds":["fortune_bad"],"actions":[{"type":"battle","monsterId":"monster_wolf"},{"type":"teleport","mapId":"map_starter_village"}]}',
        jsonSchema: {
          kind: "event-reward-object",
        },
      },
      { key: "aiPrompt", label: "AI叙事提示词", type: "textarea" },
    ],
  },
  checkinRewardRules: {
    disableCreate: true,
    disableDelete: true,
    tableFields: ["dayIndex", "enabled", "reward", "updatedAt"],
    quickFilters: [
      { key: "enabled", label: "是否启用", options: BOOLEAN_FILTER_OPTIONS },
    ],
    extraFieldLabels: {
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "dayIndex", label: "日序(1=周一)", type: "number", required: true, readOnlyOnEdit: true },
      { key: "enabled", label: "启用", type: "boolean", required: true },
      {
        key: "reward",
        label: "签到奖励",
        type: "json",
        required: true,
        placeholder: "{\"gold\":100,\"xp\":50,\"items\":[{\"itemId\":\"item_healing_pill_low\",\"quantity\":1}]}",
        jsonSchema: {
          kind: "reward-object",
        },
      },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  cdkCodes: {
    disableCreate: true,
    tableFields: ["id", "code", "maxUses", "usedCount", "expiresAt", "enabled", "createdBy", "createdAt"],
    quickFilters: [
      { key: "enabled", label: "是否启用", options: BOOLEAN_FILTER_OPTIONS },
    ],
    extraFieldLabels: {
      createdBy: "创建人",
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "id", label: "ID", type: "number", readOnlyOnEdit: true, required: false },
      { key: "code", label: "CDK", type: "text", required: true, readOnlyOnEdit: true },
      { key: "maxUses", label: "总可用次数", type: "number", required: true },
      { key: "usedCount", label: "已使用次数", type: "number", required: true },
      { key: "expiresAt", label: "过期时间", type: "text" },
      { key: "enabled", label: "启用", type: "boolean", required: true },
      {
        key: "reward",
        label: "奖励",
        type: "json",
        placeholder: '{"gold":100,"xp":50,"items":[{"itemId":"item_healing_pill_low","quantity":2}]}',
        jsonSchema: {
          kind: "reward-object",
        },
      },
      { key: "createdBy", label: "创建人", type: "text", readOnlyOnEdit: true, relation: { entity: "accounts", labelKey: "email" } },
      { key: "createdAt", label: "创建时间", type: "text", readOnlyOnEdit: true },
      { key: "updatedAt", label: "更新时间", type: "text", readOnlyOnEdit: true },
    ],
  },
  systemConfigs: {
    tableFields: ["key", "value", "group", "isSecret", "description", "updatedAt"],
    quickFilters: [
      { key: "group", label: "分组", options: SYSTEM_CONFIG_GROUP_OPTIONS },
      { key: "isSecret", label: "敏感配置", options: BOOLEAN_FILTER_OPTIONS },
    ],
    extraFieldLabels: {
      createdAt: "创建时间",
      updatedAt: "更新时间",
    },
    formFields: [
      { key: "key", label: "配置键", type: "text", required: true, readOnlyOnEdit: true },
      { key: "value", label: "配置值", type: "textarea", required: true },
      { key: "group", label: "分组", type: "select", options: SYSTEM_CONFIG_GROUP_OPTIONS, required: true },
      { key: "isSecret", label: "敏感配置", type: "boolean", required: true },
      { key: "description", label: "说明", type: "textarea" },
    ],
  },
};

const fortuneSpecialEffectsField = ADMIN_UI_CONFIG.fortunes.formFields.find((field) => field.key === "specialEffects");
if (fortuneSpecialEffectsField?.jsonSchema?.kind === "object") {
  const specialEffectFields = fortuneSpecialEffectsField.jsonSchema.fields || [];
  const appendSpecialEffectField = (key: string, label: string) => {
    if (specialEffectFields.some((field) => field.key === key)) {
      return;
    }
    specialEffectFields.push({ key, label, type: "number" });
  };

  appendSpecialEffectField("doubleCultivationXpRate", "双修修为加成倍率");
  appendSpecialEffectField("breakthroughSuccessRate", "突破境界加成倍率");
}

export function getAdminFieldLabel(config: AdminUiConfig, field: string) {
  const matched = config.formFields.find((item) => item.key === field);
  if (matched) {
    return matched.label;
  }
  return config.extraFieldLabels?.[field] || field;
}

const fortuneDongfuField = ADMIN_UI_CONFIG.fortunes.formFields.find((field) => field.key === "specialEffects");
if (fortuneDongfuField?.jsonSchema?.kind === "object") {
  const fields = fortuneDongfuField.jsonSchema.fields || [];
  if (!fields.some((field) => field.key === "dongfuLingqiRate")) {
    fields.push({
      key: "dongfuLingqiRate",
      label: "洞府灵气加成倍率",
      type: "number",
    });
  }
}

const normalizedFortuneDongfuField = ADMIN_UI_CONFIG.fortunes.formFields.find((field) => field.key === "specialEffects");
if (normalizedFortuneDongfuField?.jsonSchema?.kind === "object") {
  const targetField = normalizedFortuneDongfuField.jsonSchema.fields?.find((field) => field.key === "dongfuLingqiRate");
  if (targetField) {
    targetField.label = "洞府灵气加成倍率";
  }
}

const normalizedFortuneSpecialEffectsField = ADMIN_UI_CONFIG.fortunes.formFields.find((field) => field.key === "specialEffects");
if (normalizedFortuneSpecialEffectsField?.jsonSchema?.kind === "object") {
  const normalizedLabels: Record<string, string> = {
    doubleCultivationXpRate: "\双\修\修\为\加\成\倍\率",
    breakthroughSuccessRate: "\突\破\境\界\加\成\倍\率",
    dongfuLingqiRate: "\洞\府\灵\气\加\成\倍\率",
  };
  for (const field of normalizedFortuneSpecialEffectsField.jsonSchema.fields || []) {
    const label = normalizedLabels[field.key];
    if (label) {
      field.label = label;
    }
  }
}

const skillVisualEffectInsertAnchor = ADMIN_UI_CONFIG.skills.formFields.findIndex((field) => field.key === "minRealm");
if (skillVisualEffectInsertAnchor >= 0) {
  const visualEffectFields: AdminFieldConfig[] = [
    {
      key: "visualEffectSpriteUrl",
      label: "特效雪碧图",
      type: "text",
      placeholder: "例如 /uploads/cosmetics/skill-effect/xxx.png",
    },
    { key: "visualEffectFrameWidth", label: "单帧宽度", type: "number" },
    { key: "visualEffectFrameHeight", label: "单帧高度", type: "number" },
    { key: "visualEffectFrameCount", label: "总帧数", type: "number" },
    { key: "visualEffectFrameDurationMs", label: "单帧时长(ms)", type: "number" },
    { key: "visualEffectScale", label: "特效缩放", type: "number" },
    { key: "visualEffectOffsetX", label: "水平偏移", type: "number" },
    { key: "visualEffectOffsetY", label: "垂直偏移", type: "number" },
  ];

  for (const field of visualEffectFields.reverse()) {
    if (!ADMIN_UI_CONFIG.skills.formFields.some((item) => item.key === field.key)) {
      ADMIN_UI_CONFIG.skills.formFields.splice(skillVisualEffectInsertAnchor, 0, field);
    }
  }
}

function upsertSelectOption(options: AdminSelectOption[], value: string, label: string) {
  const existing = options.find((option) => option.value === value);
  if (existing) {
    existing.label = label;
    return;
  }
  options.push({ value, label });
}

function setFieldLabel(fields: AdminFieldConfig[], key: string, label: string) {
  const field = fields.find((item) => item.key === key);
  if (field) {
    field.label = label;
  }
}

function insertFieldAfter(fields: AdminFieldConfig[], afterKey: string, field: AdminFieldConfig) {
  if (fields.some((item) => item.key === field.key)) {
    return;
  }
  const anchorIndex = fields.findIndex((item) => item.key === afterKey);
  if (anchorIndex >= 0) {
    fields.splice(anchorIndex + 1, 0, field);
    return;
  }
  fields.push(field);
}

function ensureObjectSchemaField(config: AdminFieldConfig | undefined, field: JsonSchemaField) {
  if (config?.jsonSchema?.kind !== "object") {
    return;
  }
  const fields = config.jsonSchema.fields || [];
  const existing = fields.find((item) => item.key === field.key);
  if (existing) {
    existing.label = field.label;
    existing.type = field.type;
    return;
  }
  fields.push(field);
}

upsertSelectOption(SKILL_TYPE_OPTIONS, "shield", "护盾");

upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_speed", "遁速加成");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_spiritual_sense", "神识加成");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_armor_penetration", "破防加成");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_block", "格挡加成");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_skill_damage_bonus", "神通增伤");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_skill_damage_reduction", "神通减伤");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_artifact_damage_bonus", "法宝增伤");
upsertSelectOption(ITEM_EFFECT_TYPE_OPTIONS, "boost_artifact_damage_reduction", "法宝减伤");

for (const value of [
  "boost_speed",
  "boost_spiritual_sense",
  "boost_armor_penetration",
  "boost_block",
  "boost_skill_damage_bonus",
  "boost_skill_damage_reduction",
  "boost_artifact_damage_bonus",
  "boost_artifact_damage_reduction",
]) {
  if (!ITEM_EFFECT_VALUE_VISIBLE_TYPES.includes(value)) {
    ITEM_EFFECT_VALUE_VISIBLE_TYPES.push(value);
  }
}

setFieldLabel(ADMIN_UI_CONFIG.players.formFields, "speed", "遁速");
setFieldLabel(ADMIN_UI_CONFIG.monsters.formFields, "speed", "遁速");
setFieldLabel(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "speed", "遁速");

insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "luck", { key: "spiritualSense", label: "神识", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "spiritualSense", { key: "armorPenetration", label: "破防", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "armorPenetration", { key: "block", label: "格挡", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "block", { key: "skillDamageBonus", label: "神通增伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "skillDamageBonus", { key: "skillDamageReduction", label: "神通减伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "skillDamageReduction", { key: "artifactDamageBonus", label: "法宝增伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.players.formFields, "artifactDamageBonus", { key: "artifactDamageReduction", label: "法宝减伤", type: "number", required: true });

insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "speed", { key: "luck", label: "幸运", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "luck", { key: "spiritualSense", label: "神识", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "spiritualSense", { key: "armorPenetration", label: "破防", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "armorPenetration", { key: "block", label: "格挡", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "block", { key: "skillDamageBonus", label: "神通增伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "skillDamageBonus", { key: "skillDamageReduction", label: "神通减伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "skillDamageReduction", { key: "artifactDamageBonus", label: "法宝增伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.monsters.formFields, "artifactDamageBonus", { key: "artifactDamageReduction", label: "法宝减伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "speed", { key: "luck", label: "幸运", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "luck", { key: "spiritualSense", label: "神识", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "spiritualSense", { key: "armorPenetration", label: "破防", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "armorPenetration", { key: "block", label: "格挡", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "block", { key: "skillDamageBonus", label: "神通增伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "skillDamageBonus", { key: "skillDamageReduction", label: "神通减伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "skillDamageReduction", { key: "artifactDamageBonus", label: "法宝增伤", type: "number", required: true });
insertFieldAfter(ADMIN_UI_CONFIG.temporaryMonsters.formFields, "artifactDamageBonus", { key: "artifactDamageReduction", label: "法宝减伤", type: "number", required: true });

const fortuneAttrEffectsField = ADMIN_UI_CONFIG.fortunes.formFields.find((field) => field.key === "attrEffects");
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "speed", label: "遁速", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "luck", label: "幸运", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "spiritualSense", label: "神识", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "armorPenetration", label: "破防", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "block", label: "格挡", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "skillDamageBonus", label: "神通增伤", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "skillDamageReduction", label: "神通减伤", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "artifactDamageBonus", label: "法宝增伤", type: "number" });
ensureObjectSchemaField(fortuneAttrEffectsField, { key: "artifactDamageReduction", label: "法宝减伤", type: "number" });

const skillEffectsField = ADMIN_UI_CONFIG.skills.formFields.find((field) => field.key === "effects");
if (skillEffectsField?.jsonSchema?.kind === "array-object") {
  const durationField = skillEffectsField.jsonSchema.fields?.find((field) => field.key === "duration");
  if (durationField) {
    durationField.label = "持续/比例";
  }
}
