/* Game shared constants */

export const ELEMENTS = ["金", "木", "水", "火", "土"] as const;

export const VARIANT_ELEMENTS = ["雷", "冰", "风", "暗", "光"] as const;

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "hongmeng"] as const;
export const RARITY_NAMES: Record<string, string> = {
  common: "凡品",
  uncommon: "良品",
  rare: "上品",
  epic: "极品",
  legendary: "仙品",
  hongmeng: "鸿蒙",
};
export const RARITY_COLORS: Record<string, string> = {
  common: "#a0a0a0",
  uncommon: "#2ecc71",
  rare: "#3498db",
  epic: "#9b59b6",
  legendary: "#f39c12",
  hongmeng: "#ff3b30",
};

export const ITEM_TYPES = [
  "weapon",
  "armor",
  "helmet",
  "shoes",
  "artifact",
  "consumable",
  "skill_book",
  "material",
  "quest",
] as const;

export const ITEM_TYPE_NAMES: Record<string, string> = {
  weapon: "武器",
  armor: "铠甲",
  helmet: "头盔",
  shoes: "鞋子",
  artifact: "法宝",
  ring: "戒指",
  necklace: "项链",
  consumable: "消耗品",
  skill_book: "神通书",
  material: "材料",
  quest: "任务",
};

export const BASE_EQUIPMENT_ITEM_TYPES = ["weapon", "helmet", "armor", "shoes"] as const;
export const ARTIFACT_EQUIP_SLOTS = ["artifact_1", "artifact_2", "artifact_3", "artifact_4"] as const;
export const MAX_EQUIPPED_SHENTONG_SKILLS = 8;
export const MAX_ARTIFACT_SKILL_COUNT = ARTIFACT_EQUIP_SLOTS.length;
export const MAX_PLAYER_COMBAT_SKILL_COUNT = MAX_EQUIPPED_SHENTONG_SKILLS + MAX_ARTIFACT_SKILL_COUNT;

export type BaseEquipmentItemType = (typeof BASE_EQUIPMENT_ITEM_TYPES)[number];
export type ArtifactEquipSlot = (typeof ARTIFACT_EQUIP_SLOTS)[number];

export const EQUIPPABLE_ITEM_TYPES = [...BASE_EQUIPMENT_ITEM_TYPES, "artifact"] as const;

const EQUIPPABLE_ITEM_TYPE_SET = new Set<string>(EQUIPPABLE_ITEM_TYPES);
const ARTIFACT_EQUIP_SLOT_SET = new Set<string>(ARTIFACT_EQUIP_SLOTS);

export type EquippableItemType = (typeof EQUIPPABLE_ITEM_TYPES)[number];

export function isEquippableItemType(itemType: string): itemType is EquippableItemType {
  return EQUIPPABLE_ITEM_TYPE_SET.has(itemType);
}

export function isArtifactEquipSlot(slot: string): slot is ArtifactEquipSlot {
  return ARTIFACT_EQUIP_SLOT_SET.has(slot);
}

export const SKILL_TYPES = ["attack", "buff", "debuff", "heal", "dot", "aoe", "shield"] as const;
export const SKILL_TYPE_NAMES: Record<string, string> = {
  attack: "攻击",
  buff: "增益",
  debuff: "减益",
  heal: "治疗",
  dot: "持续伤害",
  aoe: "群攻",
  shield: "护盾",
};

export const STATUS_EFFECTS = [
  "poison",
  "burn",
  "freeze",
  "stun",
  "shield",
  "defDown",
  "atkUp",
  "regen",
  "defUp",
  "atkDown",
  "speedDown",
] as const;

export const STATUS_NAMES: Record<string, string> = {
  poison: "中毒",
  burn: "灼烧",
  freeze: "冰冻",
  stun: "眩晕",
  shield: "护盾",
  defDown: "破防",
  atkUp: "攻击提升",
  regen: "恢复",
  defUp: "防御提升",
  atkDown: "攻击下降",
  speedDown: "遁速下降",
};

export const MONSTER_TYPES = ["normal", "elite", "boss"] as const;
export const MONSTER_TYPE_NAMES: Record<string, string> = {
  normal: "普通",
  elite: "精英",
  boss: "首领",
};

export const MAP_TYPES = ["city", "field", "dungeon", "secret", "secret_realm_instance", "open_world", "sect"] as const;
export const MAP_TYPE_NAMES: Record<string, string> = {
  city: "城镇",
  field: "野外",
  dungeon: "秘境",
  secret: "隐藏",
  secret_realm_instance: "秘境实例",
  open_world: "开放世界",
  sect: "宗门",
};

export const QUEST_TYPES = ["talk", "kill", "collect", "detect", "bounty"] as const;
export const QUEST_TYPE_NAMES: Record<string, string> = {
  talk: "对话",
  kill: "击杀",
  collect: "收集",
  detect: "探索",
  bounty: "悬赏",
};

export const QUEST_CATEGORIES = ["main", "side"] as const;
export const QUEST_CATEGORY_NAMES: Record<string, string> = {
  main: "主线",
  side: "支线",
};

export const TILE_TYPES = [
  "empty",
  "mountain",
  "water",
  "building",
  "portal",
  "grass",
  "forest",
  "road",
  "decor",
] as const;

export const SESSION_COOKIE = "immortality_session";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const ACTIVE_PLAYER_COOKIE = "immortality_active_player";

export const LINUXDO_OAUTH_STATE_COOKIE = "linuxdo_oauth_state";
export const LINUXDO_OAUTH_STATE_MAX_AGE = 10 * 60 * 1000;
export const LINUXDO_OAUTH_NEXT_COOKIE = "linuxdo_oauth_next";
