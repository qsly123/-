import type {
  SectBuildingType,
  SectLevel,
  SectPermissionKey,
  SectResourceSnapshot,
  SectRoleKey,
} from "@/types/game";

export const SECT_CREATE_MIN_REALM_CONFIG_KEY = "SECT_CREATE_MIN_REALM";
export const SECT_INACTIVE_TRANSFER_DAYS_CONFIG_KEY = "SECT_INACTIVE_TRANSFER_DAYS";

export const SECT_DEFAULT_CREATE_MIN_REALM = 17;
export const SECT_DEFAULT_INACTIVE_TRANSFER_DAYS = 7;
export const SECT_CREATE_GOLD_COST = 20_000;
export const SECT_MAX_STORAGE_CAPACITY = 500;
export const SECT_DEFAULT_STORAGE_CAPACITY = 20;
export const SECT_MAX_LEVEL: SectLevel = 5;
export const SECT_LEVEL_ORDER: SectLevel[] = [1, 2, 3, 4, 5];
export const SECT_GOVERNANCE_ROLE_ORDER: SectRoleKey[] = [
  "leader",
  "vice_leader",
  "grand_elder",
  "elder",
  "inner_disciple",
];

export const SECT_ROLE_ORDER: SectRoleKey[] = [
  "leader",
  "vice_leader",
  "grand_elder",
  "elder",
  "inner_disciple",
  "outer_disciple",
  "handyman",
];

export const SECT_ROLE_LABELS: Record<SectRoleKey, string> = {
  leader: "宗主",
  vice_leader: "副宗主",
  grand_elder: "大长老",
  elder: "长老",
  inner_disciple: "内门弟子",
  outer_disciple: "外门弟子",
  handyman: "杂役弟子",
  handyman_disciple: "杂役弟子",
};

export const SECT_ROLE_PERMISSION_DEFAULTS: Record<SectRoleKey, SectPermissionKey[]> = {
  leader: [
    "review_join",
    "review_visit",
    "appoint_member",
    "manage_storage",
    "edit_map",
    "expand_sect",
    "manage_notice",
    "manage_buildings",
  ],
  vice_leader: [
    "review_join",
    "review_visit",
    "appoint_member",
    "manage_storage",
    "edit_map",
    "expand_sect",
    "manage_notice",
    "manage_buildings",
  ],
  grand_elder: [
    "review_join",
    "review_visit",
    "appoint_member",
    "manage_storage",
    "edit_map",
    "manage_notice",
    "manage_buildings",
  ],
  elder: [
    "review_join",
    "review_visit",
    "manage_storage",
  ],
  inner_disciple: [
    "review_visit",
  ],
  outer_disciple: [],
  handyman: [],
  handyman_disciple: [],
};

export const SECT_PERMISSION_LABELS: Record<SectPermissionKey, string> = {
  review_join: "审核入宗申请",
  review_visit: "审核访客申请",
  appoint_member: "任命宗门职位",
  manage_storage: "管理宗门仓库",
  edit_map: "改造宗门地块",
  expand_sect: "扩建宗门驻地",
  manage_notice: "修改宗门公告",
  manage_buildings: "管理宗门建筑",
};

export const SECT_LEVEL_CONFIG: Record<SectLevel, {
  mapSize: number;
  memberLimit: number;
  expandCost: Pick<SectResourceSnapshot, "spiritStone" | "wood" | "stone" | "sectMaterial">;
}> = {
  1: {
    mapSize: 6,
    memberLimit: 10,
    expandCost: { spiritStone: 0, wood: 0, stone: 0, sectMaterial: 0 },
  },
  2: {
    mapSize: 8,
    memberLimit: 12,
    expandCost: { spiritStone: 1200, wood: 180, stone: 180, sectMaterial: 80 },
  },
  3: {
    mapSize: 10,
    memberLimit: 15,
    expandCost: { spiritStone: 2200, wood: 260, stone: 260, sectMaterial: 150 },
  },
  4: {
    mapSize: 12,
    memberLimit: 18,
    expandCost: { spiritStone: 3600, wood: 360, stone: 360, sectMaterial: 240 },
  },
  5: {
    mapSize: 15,
    memberLimit: 20,
    expandCost: { spiritStone: 5600, wood: 520, stone: 520, sectMaterial: 360 },
  },
};

export const SECT_BUILDING_LABELS: Record<SectBuildingType, string> = {
  portal: "传送阵",
  main_hall: "大殿",
  storage: "仓库",
  lingqi_peak: "灵气峰",
};

export const SECT_BUILDING_DEFAULTS: Array<{
  buildingType: SectBuildingType;
  name: string;
  level: number;
  positionX: number;
  positionY: number;
  description: string;
}> = [
  {
    buildingType: "portal",
    name: "宗门传送阵",
    level: 1,
    positionX: 0,
    positionY: 0,
    description: "连接外界的宗门传送阵，不可拆除。",
  },
  {
    buildingType: "main_hall",
    name: "大殿",
    level: 1,
    positionX: 2,
    positionY: 2,
    description: "处理宗门公告、招募与任命。",
  },
  {
    buildingType: "storage",
    name: "宗门仓库",
    level: 1,
    positionX: 4,
    positionY: 1,
    description: "存放宗门公共物资，默认 20 格。",
  },
  {
    buildingType: "lingqi_peak",
    name: "灵气峰",
    level: 1,
    positionX: 4,
    positionY: 4,
    description: "为全部成员提供洞府灵气加成。",
  },
];

export function getSectLevelConfig(level: SectLevel) {
  return SECT_LEVEL_CONFIG[level];
}

export function getSectRoleLabel(roleKey: SectRoleKey) {
  return SECT_ROLE_LABELS[roleKey] || roleKey;
}

export function getSectPermissionLabel(permissionKey: SectPermissionKey) {
  return SECT_PERMISSION_LABELS[permissionKey] || permissionKey;
}

export function getLingqiPeakBonusRate(level: number) {
  return 0.05 + (Math.max(1, Math.floor(level || 1)) - 1) * 0.03;
}

export function getStorageExpandCost(nextCapacity: number) {
  const delta = Math.max(1, nextCapacity - SECT_DEFAULT_STORAGE_CAPACITY);
  return {
    spiritStone: 150 + delta * 6,
    wood: 8 + Math.floor(delta * 0.4),
    stone: 8 + Math.floor(delta * 0.4),
    sectMaterial: 4 + Math.floor(delta * 0.25),
  };
}
