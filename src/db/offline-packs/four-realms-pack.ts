import type {
  EventJudgeConditions,
  ItemEffect,
  QuestRequirement,
  QuestReward,
  RealmRewardRule,
  SkillEffect,
  SkillEffectsPayload,
  TileData,
} from "@/types/game";
import {
  getOfficialXpPillToxicity,
  getOfficialXpPillValue,
} from "@/modules/shared/services/alchemy-balance";

const COMBAT_DAMAGE_FORMULA_KEY = "COMBAT_DAMAGE_FORMULA";

function normalizeOfflinePackToken(value: unknown) {
  const text = String(value || "").trim().replace(/[^a-zA-Z0-9]+/g, "_");
  return text.replace(/^_+|_+$/g, "").toUpperCase();
}

function buildOfflinePackPluginSystemConfigKey(pluginId: string, localKey: string) {
  const normalizedPluginId = normalizeOfflinePackToken(pluginId);
  const normalizedLocalKey = normalizeOfflinePackToken(localKey);
  if (!normalizedPluginId || !normalizedLocalKey) {
    return "";
  }
  return `PLUGIN_${normalizedPluginId}_${normalizedLocalKey}`;
}

type MajorName =
  | "练气"
  | "筑基"
  | "结丹"
  | "元婴"
  | "化神"
  | "炼虚"
  | "合体"
  | "大乘"
  | "渡劫";

type ItemStageKey = "lianqi" | "zhuji" | "jiedan" | "yuanying";

type OfflineRealmStage = {
  name: string;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[];
};

type OfflineRealmMajor = {
  order: number;
  name: MajorName;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
  stages: OfflineRealmStage[];
};

type OfflineMap = {
  id: string;
  name: string;
  description: string;
  backgroundImageUrl: string | null;
  width: number;
  height: number;
  minRealm: number;
  mapType: "city" | "field" | "dungeon" | "secret";
  tilesData: TileData[];
};

type OfflineMapEdge = {
  mapAId: string;
  mapBId: string;
};

type OfflineNpc = {
  id: string;
  name: string;
  title: string;
  description: string;
  avatarImageUrl: string | null;
  portraitImageUrl: string | null;
  mapId: string;
  positionX: number;
  positionY: number;
  personality: string;
  isShop: boolean;
  shopItems: { itemId: string; price: number }[];
  bountyEnabled: boolean;
  bountyDailyLimit: number;
};

type OfflineSkill = {
  id: string;
  name: string;
  description: string;
  skillType: "attack" | "buff" | "debuff" | "heal" | "dot" | "aoe" | "shield";
  element: string | null;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffectsPayload | SkillEffect[] | null;
  minRealm: number | null;
  maxRealm: number | null;
  target: "self" | "enemy" | "all_enemies";
};

type OfflineItem = {
  id: string;
  name: string;
  iconUrl: string | null;
  description: string;
  itemType: "weapon" | "armor" | "helmet" | "shoes" | "artifact" | "consumable" | "skill_book" | "material" | "quest";
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
  effects: ItemEffect[];
  price: number;
  stackable: boolean;
  isBound: boolean;
  minRealm: number | null;
  maxRealm: number | null;
  pillToxicity?: number;
};

type OfflineMonster = {
  id: string;
  name: string;
  iconUrl: string | null;
  description: string;
  monsterType: "normal" | "elite" | "boss";
  level: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
  skills: string[];
  drops: { itemId: string; chance: number; minQuantity: number; maxQuantity: number }[];
  xpReward: number;
  goldReward: number;
  mapId: string;
  positionX: number;
  positionY: number;
  aiMoveIntervalMinSeconds: number | null;
  aiMoveIntervalMaxSeconds: number | null;
  aiMoveRange: number | null;
  respawnSeconds: number;
};

type OfflineQuest = {
  id: string;
  name: string;
  description: string;
  questCategory: "main";
  questType: "talk" | "kill" | "collect" | "detect";
  acceptNpcId: string;
  completeNpcId: string;
  acceptStory: string;
  completeStory: string;
  requirements: QuestRequirement[];
  rewards: QuestReward;
  prerequisites: string[];
  minRealm: number;
  maxRealm: number | null;
  repeatable: false;
};

type OfflineRandomEvent = {
  id: string;
  name: string;
  description: string | null;
  iconImageUrl: string | null;
  imageUrls: string[] | null;
  eventType: "opportunity" | "encounter";
  probability: number;
  spawnIntervalSeconds: number | null;
  durationSeconds: number | null;
  minRealm: number;
  maxRealm: number | null;
  mapType: string | null;
  mapIds: string[] | null;
  judgeConditions: EventJudgeConditions | null;
  rewards: QuestReward;
  aiPrompt: string | null;
};

type OfflineFortune = {
  id: string;
  name: string;
  description: string;
  gender: "男" | "女" | null;
  enabled: boolean;
  isHidden: boolean;
  isStarter: boolean;
  starterWeight: number;
  grade: "white" | "blue" | "purple" | "gold" | "red";
  durationSeconds: number;
  attrEffects: Record<string, number>;
  eventEffects: Record<string, unknown>;
  specialEffects: Record<string, unknown>;
};

type OfflinePillToxicityConfig = {
  key: string;
  maxToxicity: number;
  recoverIntervalMinutes: number;
};

type OfflineSystemConfig = {
  key: string;
  value: string;
  group: string;
  isSecret: boolean;
  description: string;
};

type OfflineIconAsset = {
  id: string;
  sourcePath: string;
  publicPath: string;
  usage: "item" | "skill" | "map";
  note: string;
};

type StageBenchmark = {
  linearRealm: number;
  realmName: string;
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
  combatPower: number;
};

type OfflineRecipe = {
  id: string;
  resultItemId: string;
  resultQuantity: number;
  mainItemId: string;
  mainQuantity: number;
  baseSuccessRate: number;
  auxAItemId?: string;
  auxAQuantity?: number;
  auxABonusRate?: number;
  auxBItemId?: string;
  auxBQuantity?: number;
  auxBBonusRate?: number;
  auxCItemId?: string;
  auxCQuantity?: number;
  auxCBonusRate?: number;
};

type OfflineSpiritualFieldSeed = {
  seedItemId: string;
  outputItemId: string;
  name: string;
  growthSeconds: number;
  minYield: number;
  maxYield: number;
  maxPlotsPerPlayer: number | null;
  enabled: boolean;
  dropThemeTags?: ("forest" | "water" | "pill" | "growth" | "ore" | "ruins")[];
  secretRealmWeight?: number;
};

type OfflineHongmengTreasureStarConfig = {
  star: number;
  energyCap: number;
  regenSecondsPerEnergy: number;
};

type OfflineHongmengTreasureUpgradeCost = {
  fromStar: number;
  costItemId: string;
  costQuantity: number;
};

type OfflineHongmengTreasureConfig = {
  itemId: string;
  enabled: boolean;
  maxStar: number;
  starConfigs: OfflineHongmengTreasureStarConfig[];
  upgradeCosts: OfflineHongmengTreasureUpgradeCost[];
  spiritualFieldEnergyCost: number;
  spiritualFieldReduceSeconds: number;
};

type FourRealmsPack = {
  metadata: {
    id: string;
    version: string;
    generatedAt: string;
    mode: "offline-only";
    style: string;
    pace: string;
    storyline: string;
    questCount: number;
    firstFourMainQuestCount: number;
    linearRealmCount: number;
  };
  realmMajors: OfflineRealmMajor[];
  maps: OfflineMap[];
  mapEdges: OfflineMapEdge[];
  npcs: OfflineNpc[];
  skills: OfflineSkill[];
  items: OfflineItem[];
  monsters: OfflineMonster[];
  quests: OfflineQuest[];
  fortunes: OfflineFortune[];
  randomEvents: OfflineRandomEvent[];
  systemConfigs: OfflineSystemConfig[];
  pillToxicityConfigs: OfflinePillToxicityConfig[];
  alchemyRecipes: OfflineRecipe[];
  smithingRecipes: OfflineRecipe[];
  spiritualFieldSeeds: OfflineSpiritualFieldSeed[];
  hongmengTreasureConfigs: OfflineHongmengTreasureConfig[];
  iconAssets: OfflineIconAsset[];
  stageBenchmarks: StageBenchmark[];
};

const PACK_GENERATED_AT = "2026-03-13T11:30:00.000+08:00";

const mapIds = {
  penglai: "map_four_realms_penglai_island",
  qingshili: "map_four_realms_qingshili",
  liuduji: "map_four_realms_liuduji",
  heisonglin: "map_four_realms_heisonglin",
  shigudong: "map_four_realms_shigudong",
  taihang: "map_four_realms_taihang",
  chisha: "map_four_realms_chisha_post",
  dihuogu: "map_four_realms_dihuogu",
  wuhaize: "map_four_realms_wuhaize",
  yehe: "map_four_realms_yehe_catacomb",
  bianfeng: "map_four_realms_bianfeng_city",
  yunmen: "map_four_realms_yunmen_peak",
  lietianxu: "map_four_realms_lietianxu",
} as const;

const npcIds = {
  yuweng: "npc_four_realms_yuweng",
  zhouniangzi: "npc_four_realms_zhouniangzi",
  menglao: "npc_four_realms_menglao",
  dingxunhai: "npc_four_realms_dingxunhai",
  wangergou: "npc_four_realms_wangergou",
  jiangwangbei: "npc_four_realms_jiangwangbei",
  rendanniang: "npc_four_realms_rendanniang",
  chiyan: "npc_four_realms_chiyan",
  oldWang: "npc_four_realms_old_wangergou",
  lishixiong: "npc_four_realms_lishixiong",
  liuniang: "npc_four_realms_liuniang",
  yuedingshan: "npc_four_realms_yuedingshan",
  ali: "npc_four_realms_ali",
  yunlao: "npc_four_realms_yunlao",
} as const;

const skillIds = {
  lqSword: "skill_four_realms_qianchao_jianqi",
  lqShield: "skill_four_realms_xuanshui_huti",
  lqTalisman: "skill_four_realms_lingsha_fuyu",
  lqNeedle: "skill_four_realms_yousi_zhenjue",
  zjBlade: "skill_four_realms_posha_daolun",
  zjSeal: "skill_four_realms_xueying_fufu",
  zjShield: "skill_four_realms_guiyuan_dunguang",
  zjNeedle: "skill_four_realms_chuanxin_zhenyu",
  jdFire: "skill_four_realms_wenxin_lihuo",
  jdSeal: "skill_four_realms_jielv_jianyin",
  jdShield: "skill_four_realms_huichen_hupo",
  jdMind: "skill_four_realms_huannian_shihun",
  yySword: "skill_four_realms_zhencheng_jianhe",
  yyWish: "skill_four_realms_zhongsheng_yuandun",
  yySeal: "skill_four_realms_zhaogu_lingfu",
  yyNeedle: "skill_four_realms_xingmang_shehun",
} as const;

const questIds = {
  lianqi: Array.from({ length: 12 }, (_, index) => `quest_main_lianqi_${String(index + 1).padStart(2, "0")}`),
  zhuji: Array.from({ length: 14 }, (_, index) => `quest_main_zhuji_${String(index + 1).padStart(2, "0")}`),
  jiedan: Array.from({ length: 15 }, (_, index) => `quest_main_jiedan_${String(index + 1).padStart(2, "0")}`),
  yuanying: Array.from({ length: 20 }, (_, index) => `quest_main_yuanying_${String(index + 1).padStart(2, "0")}`),
} as const;

const fortuneIds = {
  fangu: "fortune_four_realms_fangu_jianren",
  qingqi: "fortune_four_realms_qingqi_changxi",
  qingshen: "fortune_four_realms_qingshen_sheying",
  muming: "fortune_four_realms_muming_xinjing",
  shouwen: "fortune_four_realms_shouwen_yichen",
  tuxi: "fortune_four_realms_tuxi_huti",
  tuna: "fortune_four_realms_tuna_mianchang",
  fuyuan: "fortune_four_realms_yunshui_fuyuan",
  shouzhuo: "fortune_four_realms_shouzhuo_guiyuan",
  danlu: "fortune_four_realms_danlu_qinhe",
  dongfu: "fortune_four_realms_dongfu_naling",
  fengmang: "fortune_four_realms_fengmang_neilian",
  changye: "fortune_four_realms_changye_bujuan",
  xindeng: "fortune_four_realms_xindeng_zizhao",
  danhua: "fortune_four_realms_danhua_neiyun",
  jingang: "fortune_four_realms_jingang_gen",
  qingmu: "fortune_four_realms_qingmu_lingxin",
  ruoshui: "fortune_four_realms_ruoshui_hansui",
  lihuo: "fortune_four_realms_lihuo_zangfeng",
  houde: "fortune_four_realms_houde_zaiwu",
  jianshi: "fortune_four_realms_jianshi_ruzhong",
  fazang: "fortune_four_realms_fazang_yunliu",
  xingchi: "fortune_four_realms_xingchi_dianche",
  zhuyue: "fortune_four_realms_zhuyue_huiguang",
  cangyuan: "fortune_four_realms_cangyuan_shouyi",
  taixuan: "fortune_four_realms_taixuan_mingxin",
  jianxin: "fortune_four_realms_jianxin_wuchen",
  fuhai: "fortune_four_realms_fuhai_shenzhao",
  yuling: "fortune_four_realms_yuling_huixi",
  guichen: "fortune_four_realms_guichen_qingpo",
  jintaixiao: "fortune_four_realms_jintai_xiaohan",
  zhoutian: "fortune_four_realms_zhoutian_qihui",
  tianming: "fortune_four_realms_tianming_hongyuan",
  chiyuan: "fortune_four_realms_chiyuan_beixin",
} as const;

const iconCatalog = {
  sword: {
    id: "weapon-sword",
    sourcePath: "img/icon/装备 武器 法宝/N32501.png",
    publicPath: "/uploads/cosmetics/item/four-realms/weapon-sword.png",
    usage: "item",
    note: "预览确认后用于剑系主武图标",
  },
  blade: {
    id: "weapon-blade",
    sourcePath: "img/icon/装备 武器 法宝/N33101.png",
    publicPath: "/uploads/cosmetics/item/four-realms/weapon-blade.png",
    usage: "item",
    note: "预览确认后用于刀系主武图标",
  },
  needle: {
    id: "weapon-needle",
    sourcePath: "img/icon/装备 武器 法宝/N32310.png",
    publicPath: "/uploads/cosmetics/item/four-realms/weapon-needle.png",
    usage: "item",
    note: "预览确认后用于针类主武图标",
  },
  talisman: {
    id: "artifact-talisman",
    sourcePath: "img/icon/装备 武器 法宝/N33010.png",
    publicPath: "/uploads/cosmetics/item/four-realms/artifact-talisman.png",
    usage: "item",
    note: "预览确认后用于符器法宝图标",
  },
  robe: {
    id: "armor-robe",
    sourcePath: "img/icon/装备 武器 法宝/N33000.png",
    publicPath: "/uploads/cosmetics/item/four-realms/armor-robe.png",
    usage: "item",
    note: "预览确认后用于法衣图标",
  },
  helmet: {
    id: "armor-helmet",
    sourcePath: "img/icon/装备 武器 法宝/N32601.png",
    publicPath: "/uploads/cosmetics/item/four-realms/armor-helmet.png",
    usage: "item",
    note: "预览确认后用于冠类图标",
  },
  shield: {
    id: "artifact-shield",
    sourcePath: "img/icon/装备 武器 法宝/N33114.png",
    publicPath: "/uploads/cosmetics/item/four-realms/artifact-shield.png",
    usage: "item",
    note: "预览确认后用于盾器法宝图标",
  },
  focus: {
    id: "weapon-focus",
    sourcePath: "img/icon/装备 武器 法宝/31263.png",
    publicPath: "/uploads/cosmetics/item/ai-smithing/focus/31263.png",
    usage: "item",
    note: "预览确认后用于法修法器/法珠图标",
  },
  swordBox: {
    id: "artifact-sword-box",
    sourcePath: "img/icon/装备 武器 法宝/31280.png",
    publicPath: "/uploads/cosmetics/item/ai-smithing/sword-box/1011_0.png",
    usage: "item",
    note: "预览确认后用于剑修剑匣类法宝图标",
  },
  bloodBanner: {
    id: "artifact-blood-banner",
    sourcePath: "img/icon/装备 武器 法宝/1019_2.png",
    publicPath: "/uploads/cosmetics/item/ai-smithing/blood-banner/31284.png",
    usage: "item",
    note: "预览确认后用于血防流战幡类法宝图标",
  },
  swiftRing: {
    id: "artifact-swift-ring",
    sourcePath: "img/icon/装备 武器 法宝/1003_0.png",
    publicPath: "/uploads/cosmetics/item/ai-smithing/swift-ring/1003_2.png",
    usage: "item",
    note: "预览确认后用于疾法/短诀流灵环图标",
  },
  elixirBlue: {
    id: "pill-blue",
    sourcePath: "img/icon/100201.png",
    publicPath: "/uploads/cosmetics/item/four-realms/pill-blue.png",
    usage: "item",
    note: "预览确认后用于修为丹图标",
  },
  elixirRed: {
    id: "pill-red",
    sourcePath: "img/icon/100300.png",
    publicPath: "/uploads/cosmetics/item/four-realms/pill-red.png",
    usage: "item",
    note: "预览确认后用于突破辅丹图标",
  },
  elixirBottle: {
    id: "pill-bottle",
    sourcePath: "img/icon/30025.png",
    publicPath: "/uploads/cosmetics/item/four-realms/pill-bottle.png",
    usage: "item",
    note: "预览确认后用于恢复丹药图标",
  },
  materialOrb: {
    id: "material-orb",
    sourcePath: "img/icon/100401.png",
    publicPath: "/uploads/cosmetics/item/four-realms/material-orb.png",
    usage: "item",
    note: "预览确认后用于晶核/魔髓类材料图标",
  },
  materialJade: {
    id: "material-jade",
    sourcePath: "img/icon/101612.png",
    publicPath: "/uploads/cosmetics/item/four-realms/material-jade.png",
    usage: "item",
    note: "预览确认后用于玉简/玄玉类材料图标",
  },
  skillBurst: {
    id: "skill-burst",
    sourcePath: "img/icon/技能图标/10204.png",
    publicPath: "/uploads/cosmetics/skill-effect/four-realms/skill-burst.png",
    usage: "skill",
    note: "预览确认后用于爆发型技能特效图标",
  },
  skillPierce: {
    id: "skill-pierce",
    sourcePath: "img/icon/技能图标/11111.png",
    publicPath: "/uploads/cosmetics/skill-effect/four-realms/skill-pierce.png",
    usage: "skill",
    note: "预览确认后用于剑气/穿刺型技能特效图标",
  },
  skillWater: {
    id: "skill-water",
    sourcePath: "img/icon/技能图标/14203.png",
    publicPath: "/uploads/cosmetics/skill-effect/four-realms/skill-water.png",
    usage: "skill",
    note: "预览确认后用于护盾/灵水型技能特效图标",
  },
  skillArc: {
    id: "skill-arc",
    sourcePath: "img/icon/技能图标/20005.png",
    publicPath: "/uploads/cosmetics/skill-effect/four-realms/skill-arc.png",
    usage: "skill",
    note: "预览确认后用于符箓/雷弧型技能特效图标",
  },
  spriteBarrier: {
    id: "skill-sprite-barrier",
    sourcePath: "img/技能特效/30FPS_AC2Q017_Barrier.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_AC2Q017_Barrier.png",
    usage: "skill",
    note: "护盾类雪碧图，适合盾器与护体神通。",
  },
  spriteWater: {
    id: "skill-sprite-water",
    sourcePath: "img/技能特效/30FPS_ACQ020_Water.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ020_Water.png",
    usage: "skill",
    note: "水法与剑河类雪碧图。",
  },
  spriteFire: {
    id: "skill-sprite-fire",
    sourcePath: "img/技能特效/30FPS_ACQ021_Fire.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ021_Fire.png",
    usage: "skill",
    note: "火行攻法雪碧图，适合离火与爆发型术法。",
  },
  spriteLightning: {
    id: "skill-sprite-lightning",
    sourcePath: "img/技能特效/30FPS_ACQ023_LightningA.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ023_LightningA.png",
    usage: "skill",
    note: "雷光/符箓破阵类雪碧图。",
  },
  spriteThrust: {
    id: "skill-sprite-thrust",
    sourcePath: "img/技能特效/30FPS_ACQ003_Thrust1.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ003_Thrust1.png",
    usage: "skill",
    note: "剑气、刀轮、针类穿刺雪碧图。",
  },
  spritePoison: {
    id: "skill-sprite-poison",
    sourcePath: "img/技能特效/30FPS_ACQ012_Poison.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ012_Poison.png",
    usage: "skill",
    note: "毒、蚀魂、持续伤害类雪碧图。",
  },
  spriteSleep: {
    id: "skill-sprite-sleep",
    sourcePath: "img/技能特效/30FPS_ACQ013_Sleep.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_ACQ013_Sleep.png",
    usage: "skill",
    note: "心魔、迟滞、昏沉类雪碧图。",
  },
  spriteTempest: {
    id: "skill-sprite-tempest",
    sourcePath: "img/技能特效/30FPS_AC3T018_Tempest.png",
    publicPath: "/uploads/cosmetics/skill-sprite/four-realms/30FPS_AC3T018_Tempest.png",
    usage: "skill",
    note: "大范围风暴/战场压制雪碧图。",
  },
  emoteAlert: {
    id: "map-emote-alert",
    sourcePath: "img/角色地图标签/emo01_01.png",
    publicPath: "/uploads/cosmetics/map-emote/four-realms/emo01_01.png",
    usage: "map",
    note: "惊觉/发现提示。",
  },
  emoteQuestion: {
    id: "map-emote-question",
    sourcePath: "img/角色地图标签/emo08_01.png",
    publicPath: "/uploads/cosmetics/map-emote/four-realms/emo08_01.png",
    usage: "map",
    note: "可疑/追查提示。",
  },
  emoteSleep: {
    id: "map-emote-sleep",
    sourcePath: "img/角色地图标签/emo12_01.png",
    publicPath: "/uploads/cosmetics/map-emote/four-realms/emo12_01.png",
    usage: "map",
    note: "昏沉/心神受扰提示。",
  },
  emoteAnger: {
    id: "map-emote-anger",
    sourcePath: "img/角色地图标签/emo20_01.png",
    publicPath: "/uploads/cosmetics/map-emote/four-realms/emo20_01.png",
    usage: "map",
    note: "追杀/逼迫提示。",
  },
  emoteThought: {
    id: "map-emote-thought",
    sourcePath: "img/角色地图标签/emo23_anim01.png",
    publicPath: "/uploads/cosmetics/map-emote/four-realms/emo23_anim01.png",
    usage: "map",
    note: "旧事回响/传闻提示。",
  },
  emoteImpact: {
    id: "map-emote-impact",
    sourcePath: "img/角色地图标签/emo24_01.png",
    publicPath: "/uploads/cosmetics/map-emote/four-realms/emo24_01.png",
    usage: "map",
    note: "突发冲击/奇遇开启提示。",
  },
} satisfies Record<string, OfflineIconAsset>;

const iconAssets = Object.values(iconCatalog);

const linearRealms = {
  lianqi: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, perfection: 12 },
  zhuji: { early: 13, middle: 14, late: 15, perfection: 16 },
  jiedan: { early: 17, middle: 18, late: 19, perfection: 20 },
  yuanying: { early: 21, middle: 22, late: 23, perfection: 24 },
} as const;

const realmDisplayByLinear: Record<number, string> = {
  1: "练气一层",
  2: "练气二层",
  3: "练气三层",
  4: "练气四层",
  5: "练气五层",
  6: "练气六层",
  7: "练气七层",
  8: "练气八层",
  9: "练气九层",
  10: "练气十层",
  11: "练气十一层",
  12: "练气圆满",
  13: "筑基初期",
  14: "筑基中期",
  15: "筑基后期",
  16: "筑基圆满",
  17: "结丹初期",
  18: "结丹中期",
  19: "结丹后期",
  20: "结丹圆满",
  21: "元婴初期",
  22: "元婴中期",
  23: "元婴后期",
  24: "元婴圆满",
};

const stageId = (major: string, name: string) => `realm_stage_${major}_${name}`;

function rewardRule(attr: RealmRewardRule["attr"], valueMin: number, valueMax: number, probabilityMin = 0.16, probabilityMax = 0.35): RealmRewardRule {
  return { attr, probabilityMin, probabilityMax, valueMin, valueMax };
}

function makeRealmRequirement(quantity: number): QuestRequirement {
  return {
    type: "realm",
    targetId: stageId("linear", String(quantity)),
    targetName: realmDisplayByLinear[quantity] || `境界 ${quantity}`,
    quantity,
  };
}

function makeTalkRequirement(targetId: string, targetName: string, quantity = 1): QuestRequirement {
  return { type: "talk", targetId, targetName, quantity };
}

function makeKillRequirement(targetId: string, targetName: string, quantity: number): QuestRequirement {
  return { type: "kill", targetId, targetName, quantity };
}

function makeCollectRequirement(targetId: string, targetName: string, quantity: number): QuestRequirement {
  return { type: "collect", targetId, targetName, quantity };
}

function statEffect(type: ItemEffect["type"], value: number, extra: Partial<ItemEffect> = {}): ItemEffect {
  return { type, value, ...extra };
}

function powerToCombatPower(stats: Omit<StageBenchmark, "realmName" | "linearRealm" | "combatPower">) {
  return Math.max(
    0,
    Math.floor(
      stats.maxHp
      + stats.maxMp
      + stats.attack * 20
      + stats.defense * 15
      + stats.speed * 120
      + stats.luck * 120
      + stats.spiritualSense * 6
      + stats.armorPenetration * 10
      + stats.block * 10
      + stats.skillDamageBonus * 8
      + stats.skillDamageReduction * 8
      + stats.artifactDamageBonus * 6
      + stats.artifactDamageReduction * 6,
    ),
  );
}

function spriteSkillVisual(
  spriteUrl: string,
  options: {
    columns: number;
    rows: number;
    frameSize?: number;
    frameDurationMs?: number;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
  },
): SkillEffectsPayload["visualEffect"] {
  const frameSize = options.frameSize ?? 192;
  return {
    spriteUrl,
    frameWidth: frameSize,
    frameHeight: frameSize,
    frameCount: Math.max(1, options.columns * options.rows),
    frameDurationMs: options.frameDurationMs ?? 50,
    scale: options.scale ?? 0.95,
    offsetX: options.offsetX ?? 0,
    offsetY: options.offsetY ?? 0,
  };
}

type TilePatch = {
  x: number;
  y: number;
  type: TileData["type"];
  walkable?: boolean;
  description?: string;
  imageUrl?: string;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
  portalTargetPortalId?: string;
  portalTargetName?: string;
};

function clampRect(width: number, height: number, x1: number, y1: number, x2: number, y2: number) {
  return {
    x1: Math.max(0, Math.min(width - 1, Math.min(x1, x2))),
    y1: Math.max(0, Math.min(height - 1, Math.min(y1, y2))),
    x2: Math.max(0, Math.min(width - 1, Math.max(x1, x2))),
    y2: Math.max(0, Math.min(height - 1, Math.max(y1, y2))),
  };
}

function rectPatch(
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  patch: Omit<TilePatch, "x" | "y">,
): TilePatch[] {
  const rect = clampRect(width, height, x1, y1, x2, y2);
  const list: TilePatch[] = [];
  for (let y = rect.y1; y <= rect.y2; y += 1) {
    for (let x = rect.x1; x <= rect.x2; x += 1) {
      list.push({ x, y, ...patch });
    }
  }
  return list;
}

function linePatch(
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  patch: Omit<TilePatch, "x" | "y">,
): TilePatch[] {
  const list: TilePatch[] = [];
  const stepCount = Math.max(Math.abs(endX - startX), Math.abs(endY - startY), 1);
  for (let index = 0; index <= stepCount; index += 1) {
    const x = Math.round(startX + ((endX - startX) * index) / stepCount);
    const y = Math.round(startY + ((endY - startY) * index) / stepCount);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    list.push({ x, y, ...patch });
  }
  return list;
}

function buildTilesData(
  width: number,
  height: number,
  baseType: TileData["type"],
  patches: TilePatch[],
): TileData[] {
  const map = new Map<string, TileData>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      map.set(`${x},${y}`, { x, y, type: baseType, walkable: true });
    }
  }

  for (const patch of patches) {
    if (patch.x < 0 || patch.y < 0 || patch.x >= width || patch.y >= height) {
      continue;
    }
      map.set(`${patch.x},${patch.y}`, {
      x: patch.x,
      y: patch.y,
      type: patch.type,
      walkable: patch.walkable ?? (patch.type !== "building" && patch.type !== "mountain" && patch.type !== "water"),
      description: patch.description,
      imageUrl: patch.imageUrl,
      portalId: patch.portalId,
      portalName: patch.portalName,
      portalTargetMapId: patch.portalTargetMapId,
      portalTargetPortalId: patch.portalTargetPortalId,
      portalTargetName: patch.portalTargetName,
    });
  }

  return Array.from(map.values());
}

const mapMarkerCatalog = {
  seaGate: "/uploads/cosmetics/map-marker/faction-and-region/T1201.png",
  village: "/uploads/cosmetics/map-marker/faction-and-region/T1202.png",
  camp: "/uploads/cosmetics/map-marker/faction-and-region/T1205.png",
  peak: "/uploads/cosmetics/map-marker/faction-and-region/T1210.png",
  fort: "/uploads/cosmetics/map-marker/faction-and-region/T1216.png",
  war: "/uploads/cosmetics/map-marker/faction-and-region/gang_icon_1.png",
} as const;

function portalPatch(params: {
  x: number;
  y: number;
  portalId: string;
  portalName: string;
  targetMapId: string;
  targetPortalId: string;
  targetPortalName: string;
  imageUrl?: string;
  description: string;
}): TilePatch {
  return {
    x: params.x,
    y: params.y,
    type: "portal",
    walkable: true,
    description: params.description,
    imageUrl: params.imageUrl || mapMarkerCatalog.seaGate,
    portalId: params.portalId,
    portalName: params.portalName,
    portalTargetMapId: params.targetMapId,
    portalTargetPortalId: params.targetPortalId,
    portalTargetName: params.targetPortalName,
  };
}

function markerPatch(params: {
  x: number;
  y: number;
  type?: TileData["type"];
  walkable?: boolean;
  description: string;
  imageUrl: string;
}): TilePatch {
  return {
    x: params.x,
    y: params.y,
    type: params.type || "building",
    walkable: params.walkable,
    description: params.description,
    imageUrl: params.imageUrl,
  };
}

const DONGFU_TARGET_HOURS_PER_DAY = 24;
const DAILY_XP_PILL_LIMIT = 20;
const DONGFU_XP_RATIO_PER_HOUR = 0.015;

const xpPillValueByStage = {
  lianqi: getOfficialXpPillValue("lianqi"),
  zhuji: getOfficialXpPillValue("zhuji"),
  jiedan: getOfficialXpPillValue("jiedan"),
  yuanying: getOfficialXpPillValue("yuanying"),
} as const;

const pacingTargetDays = {
  lianqi: [0.24, 0.26, 0.29, 0.32, 0.35, 0.38, 0.42, 0.46, 0.5, 0.54, 0.58, 0.66],
  zhuji: [0.84, 0.95, 1.06, 1.2],
  jiedan: [1, 1.08, 1.18, 1.29],
  yuanying: [1.48, 1.58, 1.68, 1.86],
  huashen: [2.5, 2.6, 2.65, 2.67],
} as const;

function roundRequiredXp(value: number) {
  return Math.max(1, Math.round(value / 100) * 100);
}

function buildRequiredXpByTargetDays(dailyPillXp: number, targetDays: readonly number[]) {
  return targetDays.map((days) => {
    const dongfuDailyRatio = DONGFU_TARGET_HOURS_PER_DAY * DONGFU_XP_RATIO_PER_HOUR;
    const denominator = Math.max(0.05, 1 - dongfuDailyRatio * days);
    return roundRequiredXp((dailyPillXp * days) / denominator);
  });
}

const realmRequiredXp = {
  lianqi: buildRequiredXpByTargetDays(DAILY_XP_PILL_LIMIT * xpPillValueByStage.lianqi, pacingTargetDays.lianqi),
  zhuji: buildRequiredXpByTargetDays(DAILY_XP_PILL_LIMIT * xpPillValueByStage.zhuji, pacingTargetDays.zhuji),
  jiedan: buildRequiredXpByTargetDays(DAILY_XP_PILL_LIMIT * xpPillValueByStage.jiedan, pacingTargetDays.jiedan),
  yuanying: buildRequiredXpByTargetDays(DAILY_XP_PILL_LIMIT * xpPillValueByStage.yuanying, pacingTargetDays.yuanying),
  huashen: buildRequiredXpByTargetDays(DAILY_XP_PILL_LIMIT * xpPillValueByStage.yuanying, pacingTargetDays.huashen),
  lianxuLock: [7200000, 8800000, 10600000, 12800000],
  hetiLock: [16800000, 20200000, 24300000, 29200000],
  dashengLock: [38800000, 46600000, 55900000, 67100000],
  dujieLock: [88000000, 106000000, 127000000, 152000000],
} as const;

const realmMajors: OfflineRealmMajor[] = [
  {
    order: 1,
    name: "练气",
    baseHp: 260,
    baseMp: 160,
    baseAtk: 28,
    baseDef: 14,
    baseSpiritualSense: 1,
    stages: [
      { name: "一层", requiredXp: realmRequiredXp.lianqi[0], successRate: 0.98, failXpLossRate: 0.04, rewardRules: [rewardRule("hp", 2, 4), rewardRule("mp", 1, 2), rewardRule("atk", 1, 1, 0.08, 0.12)] },
      { name: "二层", requiredXp: realmRequiredXp.lianqi[1], successRate: 0.97, failXpLossRate: 0.05, rewardRules: [rewardRule("hp", 2, 4), rewardRule("mp", 1, 2), rewardRule("def", 1, 1, 0.08, 0.12)] },
      { name: "三层", requiredXp: realmRequiredXp.lianqi[2], successRate: 0.96, failXpLossRate: 0.06, rewardRules: [rewardRule("hp", 2, 4), rewardRule("atk", 1, 1, 0.1, 0.14), rewardRule("speed", 1, 1, 0.06, 0.1)] },
      { name: "四层", requiredXp: realmRequiredXp.lianqi[3], successRate: 0.95, failXpLossRate: 0.07, rewardRules: [rewardRule("hp", 2, 4), rewardRule("mp", 1, 2), rewardRule("luck", 1, 1, 0.06, 0.1)] },
      { name: "五层", requiredXp: realmRequiredXp.lianqi[4], successRate: 0.94, failXpLossRate: 0.08, rewardRules: [rewardRule("hp", 3, 5), rewardRule("atk", 1, 2, 0.1, 0.14), rewardRule("def", 1, 1, 0.08, 0.12)] },
      { name: "六层", requiredXp: realmRequiredXp.lianqi[5], successRate: 0.93, failXpLossRate: 0.09, rewardRules: [rewardRule("hp", 3, 5), rewardRule("mp", 1, 2), rewardRule("speed", 1, 1, 0.08, 0.12)] },
      { name: "七层", requiredXp: realmRequiredXp.lianqi[6], successRate: 0.91, failXpLossRate: 0.11, rewardRules: [rewardRule("hp", 3, 5), rewardRule("atk", 1, 2, 0.1, 0.14), rewardRule("luck", 1, 1, 0.08, 0.12)] },
      { name: "八层", requiredXp: realmRequiredXp.lianqi[7], successRate: 0.89, failXpLossRate: 0.12, rewardRules: [rewardRule("hp", 3, 5), rewardRule("def", 1, 2, 0.1, 0.14), rewardRule("mp", 1, 2)] },
      { name: "九层", requiredXp: realmRequiredXp.lianqi[8], successRate: 0.87, failXpLossRate: 0.13, rewardRules: [rewardRule("hp", 3, 5), rewardRule("atk", 1, 2, 0.1, 0.14), rewardRule("speed", 1, 1, 0.08, 0.12)] },
      { name: "十层", requiredXp: realmRequiredXp.lianqi[9], successRate: 0.85, failXpLossRate: 0.14, rewardRules: [rewardRule("hp", 4, 6), rewardRule("mp", 1, 2), rewardRule("def", 1, 2, 0.1, 0.14)] },
      { name: "十一层", requiredXp: realmRequiredXp.lianqi[10], successRate: 0.83, failXpLossRate: 0.15, rewardRules: [rewardRule("hp", 4, 6), rewardRule("atk", 1, 2, 0.1, 0.14), rewardRule("luck", 1, 1, 0.08, 0.12)] },
      { name: "圆满", requiredXp: realmRequiredXp.lianqi[11], successRate: 0.8, failXpLossRate: 0.18, rewardRules: [rewardRule("hp", 5, 8), rewardRule("atk", 2, 2, 0.12, 0.16), rewardRule("def", 1, 2, 0.1, 0.14)] },
    ],
  },
  {
    order: 2,
    name: "筑基",
    baseHp: 560,
    baseMp: 320,
    baseAtk: 56,
    baseDef: 28,
    baseSpiritualSense: 3,
    stages: [
      { name: "初期", requiredXp: realmRequiredXp.zhuji[0], successRate: 0.76, failXpLossRate: 0.18, rewardRules: [rewardRule("hp", 6, 9), rewardRule("atk", 2, 3, 0.1, 0.14), rewardRule("def", 2, 2, 0.1, 0.14)] },
      { name: "中期", requiredXp: realmRequiredXp.zhuji[1], successRate: 0.72, failXpLossRate: 0.2, rewardRules: [rewardRule("hp", 7, 10), rewardRule("mp", 3, 5), rewardRule("speed", 1, 1, 0.08, 0.12)] },
      { name: "后期", requiredXp: realmRequiredXp.zhuji[2], successRate: 0.68, failXpLossRate: 0.22, rewardRules: [rewardRule("hp", 7, 10), rewardRule("atk", 2, 3, 0.1, 0.14), rewardRule("luck", 1, 1, 0.08, 0.12)] },
      { name: "圆满", requiredXp: realmRequiredXp.zhuji[3], successRate: 0.63, failXpLossRate: 0.25, rewardRules: [rewardRule("hp", 8, 12), rewardRule("atk", 3, 4, 0.12, 0.16), rewardRule("def", 2, 3, 0.1, 0.14)] },
    ],
  },
  {
    order: 3,
    name: "结丹",
    baseHp: 1120,
    baseMp: 640,
    baseAtk: 112,
    baseDef: 56,
    baseSpiritualSense: 6,
    stages: [
      { name: "初期", requiredXp: realmRequiredXp.jiedan[0], successRate: 0.6, failXpLossRate: 0.26, rewardRules: [rewardRule("hp", 12, 18), rewardRule("atk", 4, 5, 0.1, 0.14), rewardRule("def", 3, 4, 0.1, 0.14)] },
      { name: "中期", requiredXp: realmRequiredXp.jiedan[1], successRate: 0.56, failXpLossRate: 0.28, rewardRules: [rewardRule("hp", 13, 19), rewardRule("mp", 5, 8), rewardRule("speed", 1, 2, 0.08, 0.12)] },
      { name: "后期", requiredXp: realmRequiredXp.jiedan[2], successRate: 0.52, failXpLossRate: 0.3, rewardRules: [rewardRule("hp", 14, 20), rewardRule("atk", 4, 6, 0.1, 0.14), rewardRule("luck", 1, 2, 0.08, 0.12)] },
      { name: "圆满", requiredXp: realmRequiredXp.jiedan[3], successRate: 0.48, failXpLossRate: 0.33, rewardRules: [rewardRule("hp", 16, 22), rewardRule("atk", 5, 7, 0.12, 0.16), rewardRule("def", 4, 5, 0.1, 0.14)] },
    ],
  },
  {
    order: 4,
    name: "元婴",
    baseHp: 2240,
    baseMp: 1280,
    baseAtk: 224,
    baseDef: 112,
    baseSpiritualSense: 10,
    stages: [
      { name: "初期", requiredXp: realmRequiredXp.yuanying[0], successRate: 0.45, failXpLossRate: 0.35, rewardRules: [rewardRule("hp", 20, 28), rewardRule("atk", 6, 8, 0.1, 0.14), rewardRule("def", 4, 6, 0.1, 0.14)] },
      { name: "中期", requiredXp: realmRequiredXp.yuanying[1], successRate: 0.42, failXpLossRate: 0.37, rewardRules: [rewardRule("hp", 22, 30), rewardRule("mp", 8, 12), rewardRule("speed", 1, 2, 0.08, 0.12)] },
      { name: "后期", requiredXp: realmRequiredXp.yuanying[2], successRate: 0.39, failXpLossRate: 0.39, rewardRules: [rewardRule("hp", 24, 32), rewardRule("atk", 7, 9, 0.1, 0.14), rewardRule("luck", 1, 2, 0.08, 0.12)] },
      { name: "圆满", requiredXp: realmRequiredXp.yuanying[3], successRate: 0.35, failXpLossRate: 0.42, rewardRules: [rewardRule("hp", 26, 36), rewardRule("atk", 8, 10, 0.12, 0.16), rewardRule("def", 5, 7, 0.1, 0.14)] },
    ],
  },
  { order: 5, name: "化神", baseHp: 4480, baseMp: 2560, baseAtk: 448, baseDef: 224, baseSpiritualSense: 16, stages: ["初期", "中期", "后期", "圆满"].map((name, index) => ({ name, requiredXp: realmRequiredXp.huashen[index], successRate: 0.32 - index * 0.02, failXpLossRate: 0.44 + index * 0.02, rewardRules: [rewardRule("hp", 34 + index * 2, 44 + index * 2), rewardRule("atk", 10 + index, 12 + index), rewardRule("def", 6 + index, 8 + index)] })) },
  { order: 6, name: "炼虚", baseHp: 8960, baseMp: 5120, baseAtk: 896, baseDef: 448, baseSpiritualSense: 18, stages: ["初期", "中期", "后期", "圆满"].map((name, index) => ({ name, requiredXp: realmRequiredXp.lianxuLock[index], successRate: 0.12 - index * 0.01, failXpLossRate: 0.58 + index * 0.02, rewardRules: [rewardRule("hp", 50 + index * 4, 64 + index * 4), rewardRule("atk", 14 + index * 2, 18 + index * 2), rewardRule("def", 8 + index, 10 + index)] })) },
  { order: 7, name: "合体", baseHp: 17920, baseMp: 10240, baseAtk: 1792, baseDef: 896, baseSpiritualSense: 19, stages: ["初期", "中期", "后期", "圆满"].map((name, index) => ({ name, requiredXp: realmRequiredXp.hetiLock[index], successRate: 0.08 - index * 0.005, failXpLossRate: 0.62 + index * 0.02, rewardRules: [rewardRule("hp", 74 + index * 4, 92 + index * 4), rewardRule("atk", 22 + index * 2, 28 + index * 2), rewardRule("def", 12 + index, 16 + index)] })) },
  { order: 8, name: "大乘", baseHp: 35840, baseMp: 20480, baseAtk: 3584, baseDef: 1792, baseSpiritualSense: 20, stages: ["初期", "中期", "后期", "圆满"].map((name, index) => ({ name, requiredXp: realmRequiredXp.dashengLock[index], successRate: 0.05 - index * 0.003, failXpLossRate: 0.66 + index * 0.02, rewardRules: [rewardRule("hp", 110 + index * 6, 134 + index * 6), rewardRule("atk", 32 + index * 3, 40 + index * 3), rewardRule("def", 18 + index * 2, 22 + index * 2)] })) },
  { order: 9, name: "渡劫", baseHp: 71680, baseMp: 40960, baseAtk: 7168, baseDef: 3584, baseSpiritualSense: 20, stages: ["初期", "中期", "后期", "圆满"].map((name, index) => ({ name, requiredXp: realmRequiredXp.dujieLock[index], successRate: 0.03 - index * 0.002, failXpLossRate: 0.7 + index * 0.02, rewardRules: [rewardRule("hp", 160 + index * 8, 196 + index * 8), rewardRule("atk", 48 + index * 4, 60 + index * 4), rewardRule("def", 26 + index * 2, 32 + index * 2)] })) },
];

const mapRumorSeeds: Record<string, { headline: string; rumors: string[] }> = {
  [mapIds.penglai]: {
    headline: "海雾里先丢的从来不是路，是命。",
    rumors: [
      "有人说蓬莱岛近来总有人夜里出海，回来时船上只剩血。",
      "药铺后院收的不是草，是那些活着回来的命根子。",
      "渔翁看似凡人，却总能提前知道哪片海面要死人。",
    ],
  },
  [mapIds.qingshili]: {
    headline: "青石里还点着灯，说明人心还没全灭。",
    rumors: [
      "青石里每逢大雾，总有人在村口听见哭声，却看不见人。",
      "云老闭门多年，直到这次村里真死人了，才承认避世无用。",
      "边锋城来的军报总比哭声晚一步。",
    ],
  },
  [mapIds.liuduji]: {
    headline: "柳渡集卖的从来不只消息，也卖人情的分量。",
    rumors: [
      "柳娘手里藏着一份名单，谁该救、谁还能救，她比宗门还清楚。",
      "有人在柳渡集见过李师兄，他站在雨里很久都没进门。",
      "王二狗这辈子只盼再见恩公一次。",
    ],
  },
  [mapIds.heisonglin]: {
    headline: "黑松林不怕迷路，怕的是知道前面有人却还得过去。",
    rumors: [
      "林子里的毒蜂近来不叮兽，只追带血味的人。",
      "劫修在林中设了收命的路卡，专抢初入道门之人。",
      "有人说石骨洞的入口会自己换位置。",
    ],
  },
  [mapIds.shigudong]: {
    headline: "石骨洞里最硬的不是石，是那群人心。",
    rumors: [
      "洞里有人把凡人尸骨和矿泥捏成了土偶。",
      "进去的人若带着好法器，十有八九出不来。",
      "练气圆满散修手里藏着一份抢来的旧经卷。",
    ],
  },
  [mapIds.taihang]: {
    headline: "太行山左右两线，一边见血，一边见心。",
    rumors: [
      "右线最近失踪的凡人越来越多，连樵夫都不敢单独进山。",
      "左线旧村里还留着当年救人的痕迹，只是故人都老了。",
      "李师兄在山里留了三次情面，第四次便未必还留得住。",
    ],
  },
  [mapIds.chisha]: {
    headline: "赤砂驿不养闲人，能活下来的都知道补给比豪言更值钱。",
    rumors: [
      "赤砂驿脚夫里混着魔修耳目，凡人车队常在这里被盯上。",
      "任丹娘炼丹只看火候不看情面，坏了规矩的人一概不见。",
      "荒驿最怕的不是断粮，是夜里有人敲门求救。",
    ],
  },
  [mapIds.dihuogu]: {
    headline: "地火谷里炉火能炼器，也能炼命。",
    rumors: [
      "魔修曾在谷里布炉阵，用凡人生魂催火。",
      "守火人池焰杀过的人比说过的话还多。",
      "谷底余火能铸宝，也能烧出满山怨气。",
    ],
  },
  [mapIds.wuhaize]: {
    headline: "雾海泽最会放大人心里那点不敢认的念头。",
    rumors: [
      "有人在泽边看见自己年轻时最不想回头的一幕。",
      "泽里古木成魅，最会顺着心缝钻进去。",
      "若在这里动了杀心，心魔便会记住你的脸。",
    ],
  },
  [mapIds.yehe]: {
    headline: "夜河古冢不说话，却比任何人都更会记仇。",
    rumors: [
      "古冢水里埋着旧执法令，夜里会自己浮上来。",
      "离心焰灵最爱烧人执念最深的那一处。",
      "若在古冢前还说自己无愧于心，多半离心魔不远了。",
    ],
  },
  [mapIds.bianfeng]: {
    headline: "边锋城不是仙家福地，却有人愿在这里替众生挡死。",
    rumors: [
      "岳定山已经写好了遗书，却还在城头亲自巡墙。",
      "城里那只小狐狸能提前闻到魔修味道，救过不少人。",
      "若这一城真守住了，修仙界有些规矩也该换一换了。",
    ],
  },
  [mapIds.yunmen]: {
    headline: "云门峰山门高，门里的心却未必比山更高。",
    rumors: [
      "求援的人排到山脚，开门的人却说顺应天命。",
      "有人拿一城生死当筹码，只为保住宗门根基。",
      "柳娘留下的信物若真递进去，也未必换得来开山门。",
    ],
  },
  [mapIds.lietianxu]: {
    headline: "裂天墟像一道旧伤，越往里越像看见修仙界的真相。",
    rumors: [
      "墟里还留着古战时被撕开的天光裂痕。",
      "血罗刹退时曾在这里留过一面血旗。",
      "有人说真正的前辈一直在暗处看，看的不是胜负，是你到底护谁。",
    ],
  },
};

const npcBarkSeeds: Record<string, { mood: string; lines: string[] }> = {
  [npcIds.yuweng]: { mood: "看透险恶", lines: ["海上风平，不等于人心也平。", "你若想活久些，先学会分辨谁在笑里藏刀。"] },
  [npcIds.zhouniangzi]: { mood: "嘴硬心细", lines: ["药钱可以欠，命别欠给劫修。", "别拿破草糊弄我，真想活命就把火候和分寸学明白。"] },
  [npcIds.menglao]: { mood: "务实火爆", lines: ["器是拿来保命的，不是拿人命去喂的。", "你手要是不稳，再好的材料也能炼成废铁。"] },
  [npcIds.dingxunhai]: { mood: "守责焦灼", lines: ["我守岛，不代表我看不出谁在吃人。", "有些人披着修士皮，干的却是豺狼事。"] },
  [npcIds.wangergou]: { mood: "凡人倔强", lines: ["凡人也是命，总不能因为不会飞就该死。", "仙长，你若肯管，我们这些人就还有明天。"] },
  [npcIds.jiangwangbei]: { mood: "补给先行", lines: ["嘴上说救人没用，车粮和水袋到位才是真的。", "我只认一件事，前线断不得。"] },
  [npcIds.rendanniang]: { mood: "技术派", lines: ["丹炉不会替你圆谎，药材好坏一开盖就知道。", "要么按方子来，要么别进我这丹房。"] },
  [npcIds.chiyan]: { mood: "谷火一般", lines: ["地火不分善恶，拿它做什么，才见人心。", "我见过太多人借炉火行恶，你最好别让我把你归成那一类。"] },
  [npcIds.oldWang]: { mood: "温厚感恩", lines: ["恩公能来，我这一生便算圆了。", "凡人虽短命，也能把善意一代代留下去。"] },
  [npcIds.lishixiong]: { mood: "立场两难", lines: ["我不是来逼你低头的，可我也不能当没看见。", "你若不走，我便只能陪着你把这一步走到最难处。"] },
  [npcIds.liuniang]: { mood: "圆融果断", lines: ["酒可以晚喝，名单和退路不能晚备。", "散修活在夹缝里，能替人留条路就是大本事。"] },
  [npcIds.yuedingshan]: { mood: "守城不退", lines: ["城在人在，城破人亡。", "仙长若肯站城头，老夫便带八百子弟兵陪你守到底。"] },
  [npcIds.ali]: { mood: "依赖机警", lines: ["呜……", "它总会先朝魔气最浓的方向炸起尾巴。"] },
  [npcIds.yunlao]: { mood: "醒悟自责", lines: ["我以为关门自守便能躲过劫，终究还是错了。", "覆巢之下无完卵，小友，你走的路比我对。"] },
};

const eventStoryboardSeeds: Record<string, { title: string; summary: string; shots: string[]; images: string[] }> = {
  event_four_realms_lq_tidal_cache: {
    title: "潮痕旧匣",
    summary: "一只被海雾浸透的旧木匣卡在礁缝里，里面没有灵石，只有还能入药的海雾草。",
    shots: ["浪头退去，礁石间露出半截木匣。", "你拨开湿盐和贝壳，只见几株仍带灵气的海雾草。", "木匣早烂透了，像是谁死前也没来得及取回。"],
    images: [iconCatalog.emoteThought.publicPath, iconCatalog.emoteImpact.publicPath],
  },
  event_four_realms_lq_heisong_note: {
    title: "黑松误路",
    summary: "林中误路本该丢命，却因一截旧木牌避开毒雾，只换回几件零碎。",
    shots: ["风一卷，烂木牌在黑松下翻了个面。", "你顺着旧刻痕绕开毒雾和劫修踩过的路。", "最后捡回来的东西不值钱，却值一条命。"],
    images: [iconCatalog.emoteQuestion.publicPath, iconCatalog.emoteAlert.publicPath],
  },
  event_four_realms_zj_blood_ledger: {
    title: "血账残页",
    summary: "荒道上的血账残页写满凡人买卖与献祭去向，让人一眼心冷。",
    shots: ["风沙压着一张未干的残页。", "纸上不见道义，只见时辰、人数与去向。", "你把残页收起时，第一次确定这不是零星恶事。"],
    images: [iconCatalog.emoteAlert.publicPath, iconCatalog.emoteAnger.publicPath],
  },
  event_four_realms_zj_fire_route: {
    title: "地火余烬",
    summary: "循着残烬找到魔修废弃转运点，带回还能炼器的地火晶核。",
    shots: ["地火余灰尚温，脚印却已散尽。", "废弃的转运架旁，几块晶核还在泛红。", "你知道这里刚送走的不只是材料。"],
    images: [iconCatalog.emoteImpact.publicPath, iconCatalog.emoteAlert.publicPath],
  },
  event_four_realms_jd_old_letter: {
    title: "旧信未焚",
    summary: "没烧净的旧信轻得像纸，重得像凡人一生的托付。",
    shots: ["一角信纸从风里翻到脚边。", "信上尽是凡人之间最朴素的叮嘱。", "你把它折好收起时，心里那点犹疑又重了一分。"],
    images: [iconCatalog.emoteThought.publicPath, iconCatalog.emoteSleep.publicPath],
  },
  event_four_realms_jd_night_echo: {
    title: "夜河回声",
    summary: "夜河古冢回声应心，不给修为，只给一线清明。",
    shots: ["夜河水面像一面不愿说真话的镜。", "你听见的不是别人，是自己最不肯承认的念头。", "回声散去，只留下一点能稳住心神的冷意。"],
    images: [iconCatalog.emoteThought.publicPath, iconCatalog.emoteSleep.publicPath],
  },
  event_four_realms_yy_city_supply: {
    title: "守城遗箱",
    summary: "旧仓塌角，露出一箱仍能救命的守城军资。",
    shots: ["边锋城旧仓塌了一角，尘灰落得满地都是。", "木箱里没有灵石，只有能让人多活一阵的硬东西。", "这一箱东西不增修为，却够一段城墙多撑一夜。"],
    images: [iconCatalog.emoteImpact.publicPath, iconCatalog.emoteAlert.publicPath],
  },
  event_four_realms_yy_fox_warning: {
    title: "狐火预警",
    summary: "顺着阿狸留下的痕迹看破伏兵，只带回一批反制材料。",
    shots: ["细小爪痕停在半截残墙前。", "你顺着气味绕开伏兵视野，反在死角里看见他们。", "阿狸不懂战法，却替你提前救下了很多人。"],
    images: [iconCatalog.emoteQuestion.publicPath, iconCatalog.emoteAlert.publicPath],
  },
};

function buildMapDescription(baseDescription: string, mapId: string) {
  const rumor = mapRumorSeeds[mapId];
  if (!rumor) {
    return baseDescription;
  }
  return `${baseDescription} 传闻：${rumor.headline} ${rumor.rumors[0]}`;
}

function buildNpcPersonality(basePersonality: string, npcId: string) {
  const bark = npcBarkSeeds[npcId];
  if (!bark) {
    return basePersonality;
  }
  return `${basePersonality}；临场对白基调：${bark.mood}。常说：“${bark.lines.join("”“")}”`;
}

function buildEncounterPrompt(eventId: string, baseDescription: string) {
  const storyboard = eventStoryboardSeeds[eventId];
  if (!storyboard) {
    return baseDescription;
  }
  return [
    `事件标题：${storyboard.title}`,
    `事件简介：${storyboard.summary}`,
    `基础说明：${baseDescription}`,
    "请保持凡人流修仙风格，不要写系统提示，不要写现代口吻。",
    "分镜锚点：",
    ...storyboard.shots.map((shot, index) => `${index + 1}. ${shot}`),
  ].join("\n");
}

const mapTilesById: Record<string, TileData[]> = {
  [mapIds.penglai]: buildTilesData(18, 26, "empty", [
    ...rectPatch(18, 26, 0, 23, 17, 25, { type: "water", walkable: false, description: "蓬莱外海的潮水直拍岛沿。" }),
    ...rectPatch(18, 26, 1, 13, 3, 15, { type: "building", walkable: false, description: "渔家矮屋，挂着晾网和旧灯。" }),
    ...rectPatch(18, 26, 8, 5, 10, 7, { type: "building", walkable: false, description: "周娘子的海雾药铺。" }),
    ...rectPatch(18, 26, 12, 8, 14, 10, { type: "building", walkable: false, description: "孟老的海匠坊，炉火终日不熄。" }),
    ...rectPatch(18, 26, 14, 13, 16, 15, { type: "building", walkable: false, description: "岛卫值守棚屋，挂着旧旗。" }),
    ...linePatch(18, 26, 4, 22, 13, 11, { type: "grass", walkable: true, description: "踩得发亮的石板路。" }),
    markerPatch({ x: 2, y: 14, description: "渔家矮屋，挂着晾网和旧灯。", imageUrl: mapMarkerCatalog.village }),
    markerPatch({ x: 9, y: 6, description: "周娘子的海雾药铺。", imageUrl: mapMarkerCatalog.village }),
    markerPatch({ x: 13, y: 9, description: "孟老的海匠坊，炉火终日不熄。", imageUrl: mapMarkerCatalog.camp }),
    portalPatch({ x: 4, y: 21, portalId: "portal_penglai_to_qingshili", portalName: "北礁渡阵", targetMapId: mapIds.qingshili, targetPortalId: "portal_qingshili_to_penglai", targetPortalName: "青石海口阵", imageUrl: mapMarkerCatalog.seaGate, description: "通往青石里的渡海阵眼，潮雾最重时也不会偏航。" }),
    portalPatch({ x: 13, y: 12, portalId: "portal_penglai_to_liuduji", portalName: "南风商渡阵", targetMapId: mapIds.liuduji, targetPortalId: "portal_liuduji_to_penglai", targetPortalName: "柳渡海桥阵", imageUrl: mapMarkerCatalog.camp, description: "往返柳渡集的商旅传送阵，常有散修与船商借道。" }),
  ]),
  [mapIds.qingshili]: buildTilesData(18, 22, "empty", [
    ...rectPatch(18, 22, 13, 0, 17, 4, { type: "water", walkable: false, description: "村边海口，雾重时什么也看不清。" }),
    ...rectPatch(18, 22, 2, 6, 4, 8, { type: "building", walkable: false, description: "青石里旧民居，墙上还留着烟火痕。" }),
    ...rectPatch(18, 22, 6, 10, 8, 12, { type: "building", walkable: false, description: "被仓促修补过的村舍。" }),
    ...rectPatch(18, 22, 11, 6, 13, 8, { type: "building", walkable: false, description: "云老昔日闭关的小院。" }),
    ...linePatch(18, 22, 1, 18, 13, 7, { type: "grass", walkable: true, description: "沿着青石和碎贝铺开的村路。" }),
    markerPatch({ x: 3, y: 7, description: "青石里旧民居，墙上还留着烟火痕。", imageUrl: mapMarkerCatalog.village }),
    markerPatch({ x: 12, y: 7, description: "云老昔日闭关的小院。", imageUrl: mapMarkerCatalog.peak }),
    portalPatch({ x: 12, y: 5, portalId: "portal_qingshili_to_penglai", portalName: "青石海口阵", targetMapId: mapIds.penglai, targetPortalId: "portal_penglai_to_qingshili", targetPortalName: "北礁渡阵", imageUrl: mapMarkerCatalog.seaGate, description: "退潮时最稳的海口阵，可直达蓬莱岛。" }),
    portalPatch({ x: 4, y: 18, portalId: "portal_qingshili_to_bianfeng", portalName: "石里远城阵", targetMapId: mapIds.bianfeng, targetPortalId: "portal_bianfeng_to_qingshili", targetPortalName: "东门乡援阵", imageUrl: mapMarkerCatalog.fort, description: "战时留下的远距阵眼，可直接连到边锋城东门。" }),
  ]),
  [mapIds.liuduji]: buildTilesData(18, 24, "empty", [
    ...rectPatch(18, 24, 14, 16, 17, 23, { type: "water", walkable: false, description: "渡口木桩外便是深水。" }),
    ...rectPatch(18, 24, 10, 7, 13, 10, { type: "building", walkable: false, description: "柳渡客栈，散修与商旅都在此歇脚。" }),
    ...rectPatch(18, 24, 3, 12, 5, 14, { type: "building", walkable: false, description: "王二狗暂住的小院，陈设朴素。" }),
    ...rectPatch(18, 24, 7, 4, 8, 6, { type: "building", walkable: false, description: "茶摊和信铺挤在一起。" }),
    ...linePatch(18, 24, 1, 20, 13, 9, { type: "grass", walkable: true, description: "踩烂了又晒干的渡口土路。" }),
    markerPatch({ x: 11, y: 8, description: "柳渡客栈，散修与商旅都在此歇脚。", imageUrl: mapMarkerCatalog.village }),
    markerPatch({ x: 4, y: 13, description: "王二狗暂住的小院，陈设朴素。", imageUrl: mapMarkerCatalog.village }),
    portalPatch({ x: 13, y: 18, portalId: "portal_liuduji_to_penglai", portalName: "柳渡海桥阵", targetMapId: mapIds.penglai, targetPortalId: "portal_penglai_to_liuduji", targetPortalName: "南风商渡阵", imageUrl: mapMarkerCatalog.seaGate, description: "海路商旅最常走的海桥阵。" }),
    portalPatch({ x: 15, y: 11, portalId: "portal_liuduji_to_heisonglin", portalName: "黑松驿路阵", targetMapId: mapIds.heisonglin, targetPortalId: "portal_heisonglin_to_liuduji", targetPortalName: "林口回路阵", imageUrl: mapMarkerCatalog.camp, description: "沿林外驿路布下的小型传送阵。" }),
    portalPatch({ x: 2, y: 20, portalId: "portal_liuduji_to_taihang", portalName: "太行南麓阵", targetMapId: mapIds.taihang, targetPortalId: "portal_taihang_to_liuduji", targetPortalName: "南麓接引阵", imageUrl: mapMarkerCatalog.peak, description: "连入太行山南麓山道的长途阵。" }),
    portalPatch({ x: 15, y: 7, portalId: "portal_liuduji_to_yehe", portalName: "夜河旧冢阵", targetMapId: mapIds.yehe, targetPortalId: "portal_yehe_to_liuduji", targetPortalName: "渡集回返阵", imageUrl: mapMarkerCatalog.war, description: "只在夜里稳定的旧阵，常带着阴寒河气。" }),
    portalPatch({ x: 6, y: 20, portalId: "portal_liuduji_to_bianfeng", portalName: "守城驰援阵", targetMapId: mapIds.bianfeng, targetPortalId: "portal_bianfeng_to_liuduji", targetPortalName: "西门驰援阵", imageUrl: mapMarkerCatalog.fort, description: "大战时临时扩容的驰援阵，能直抵边锋城。" }),
  ]),
  [mapIds.heisonglin]: buildTilesData(22, 22, "grass", [
    ...rectPatch(22, 22, 0, 0, 3, 21, { type: "forest", description: "黑松贴得极密，潮湿阴冷。" }),
    ...rectPatch(22, 22, 18, 0, 21, 21, { type: "forest", description: "松针与毒雾积在一起，视线很差。" }),
    ...rectPatch(22, 22, 8, 4, 12, 6, { type: "mountain", walkable: false, description: "塌树和断石堵住了林间老路。" }),
    ...rectPatch(22, 22, 5, 14, 9, 16, { type: "forest", description: "毒蜂常在这片林影中盘旋。" }),
    ...linePatch(22, 22, 4, 18, 17, 8, { type: "grass", walkable: true, description: "被人和兽反复踩出的窄路。" }),
    portalPatch({ x: 4, y: 18, portalId: "portal_heisonglin_to_liuduji", portalName: "林口回路阵", targetMapId: mapIds.liuduji, targetPortalId: "portal_liuduji_to_heisonglin", targetPortalName: "黑松驿路阵", imageUrl: mapMarkerCatalog.camp, description: "设在林口的保命回返阵。" }),
    portalPatch({ x: 17, y: 8, portalId: "portal_heisonglin_to_shigudong", portalName: "石骨深探阵", targetMapId: mapIds.shigudong, targetPortalId: "portal_shigudong_to_heisonglin", targetPortalName: "洞外回身阵", imageUrl: mapMarkerCatalog.war, description: "深入石骨洞前的最后一处稳定阵眼。" }),
  ]),
  [mapIds.shigudong]: buildTilesData(20, 24, "empty", [
    ...rectPatch(20, 24, 0, 0, 19, 1, { type: "mountain", walkable: false, description: "坍塌后的石壁封住了上层矿道。" }),
    ...rectPatch(20, 24, 2, 6, 6, 8, { type: "building", walkable: false, description: "劫修堆放赃物和尸骨的木棚。" }),
    ...rectPatch(20, 24, 12, 12, 15, 14, { type: "building", walkable: false, description: "粗陋祭台，地上发黑。" }),
    ...rectPatch(20, 24, 7, 17, 10, 19, { type: "mountain", walkable: false, description: "石骨犬牙般伸出，逼人绕路。" }),
    ...linePatch(20, 24, 2, 20, 16, 18, { type: "grass", walkable: true, description: "洞底被拖出来的一条血泥路。" }),
    markerPatch({ x: 13, y: 13, description: "粗陋祭台，地上发黑。", imageUrl: mapMarkerCatalog.war }),
    portalPatch({ x: 2, y: 20, portalId: "portal_shigudong_to_heisonglin", portalName: "洞外回身阵", targetMapId: mapIds.heisonglin, targetPortalId: "portal_heisonglin_to_shigudong", targetPortalName: "石骨深探阵", imageUrl: mapMarkerCatalog.camp, description: "只容一人借力回返的紧急阵眼。" }),
  ]),
  [mapIds.taihang]: buildTilesData(50, 50, "grass", [
    ...rectPatch(50, 50, 0, 0, 4, 49, { type: "mountain", walkable: false, description: "太行山西侧山脊陡得近乎直立。" }),
    ...rectPatch(50, 50, 45, 0, 49, 49, { type: "mountain", walkable: false, description: "右线断崖直插云雾，夜里常有哭声随风下坠。" }),
    ...rectPatch(50, 50, 8, 11, 14, 16, { type: "building", walkable: false, description: "左线旧村废屋，墙上仍挂着旧符。" }),
    ...rectPatch(50, 50, 35, 28, 41, 33, { type: "building", walkable: false, description: "魔修临时据点，拿凡人当牲口使。" }),
    ...rectPatch(50, 50, 19, 18, 30, 26, { type: "forest", description: "山道这里最容易藏人，也最容易埋伏。" }),
    ...rectPatch(50, 50, 18, 6, 31, 10, { type: "forest", description: "高处老林遮天蔽日，左线右线都要从这里分岔。" }),
    ...linePatch(50, 50, 24, 46, 24, 30, { type: "grass", walkable: true, description: "从南麓一路往山心延展的主山道。" }),
    ...linePatch(50, 50, 24, 30, 11, 12, { type: "grass", walkable: true, description: "通往左线旧村与雾海泽方向的山径。" }),
    ...linePatch(50, 50, 24, 30, 40, 12, { type: "grass", walkable: true, description: "通往右线魔修地带与赤砂驿方向的石阶路。" }),
    markerPatch({ x: 11, y: 13, description: "左线旧村废屋，墙上仍挂着旧符。", imageUrl: mapMarkerCatalog.village }),
    markerPatch({ x: 38, y: 30, description: "魔修临时据点，拿凡人当牲口使。", imageUrl: mapMarkerCatalog.war }),
    markerPatch({ x: 24, y: 24, description: "太行山腰岔口，一念向左，一念向右。", imageUrl: mapMarkerCatalog.peak }),
    portalPatch({ x: 24, y: 46, portalId: "portal_taihang_to_liuduji", portalName: "南麓接引阵", targetMapId: mapIds.liuduji, targetPortalId: "portal_liuduji_to_taihang", targetPortalName: "太行南麓阵", imageUrl: mapMarkerCatalog.fort, description: "太行山南麓的大型接引阵，是山内外补给与求援的总入口。" }),
    portalPatch({ x: 11, y: 12, portalId: "portal_taihang_to_wuhaize", portalName: "左线雾泽阵", targetMapId: mapIds.wuhaize, targetPortalId: "portal_wuhaize_to_taihang", targetPortalName: "泽口返山阵", imageUrl: mapMarkerCatalog.seaGate, description: "顺着左线旧村一路布下的雾泽阵，可直达雾海泽。" }),
    portalPatch({ x: 40, y: 12, portalId: "portal_taihang_to_chisha", portalName: "右线赤砂阵", targetMapId: mapIds.chisha, targetPortalId: "portal_chisha_to_taihang", targetPortalName: "赤砂回山阵", imageUrl: mapMarkerCatalog.camp, description: "右线山道尽头的传送阵，连向赤砂驿与魔修调查线。" }),
  ]),
  [mapIds.chisha]: buildTilesData(18, 22, "empty", [
    ...rectPatch(18, 22, 4, 4, 8, 7, { type: "building", walkable: false, description: "赤砂驿主站，存粮和水囊都压在这里。" }),
    ...rectPatch(18, 22, 11, 8, 13, 9, { type: "building", walkable: false, description: "任丹娘的赤砂丹房。" }),
    ...rectPatch(18, 22, 1, 0, 2, 21, { type: "mountain", walkable: false, description: "风沙把石棱磨得极薄。" }),
    ...rectPatch(18, 22, 15, 0, 17, 21, { type: "mountain", walkable: false, description: "荒驿边缘尽是风蚀断岩。" }),
    ...linePatch(18, 22, 3, 19, 13, 10, { type: "grass", walkable: true, description: "脚夫和行商踩出来的主驿道。" }),
    markerPatch({ x: 6, y: 5, description: "赤砂驿主站，存粮和水囊都压在这里。", imageUrl: mapMarkerCatalog.camp }),
    markerPatch({ x: 12, y: 8, description: "任丹娘的赤砂丹房。", imageUrl: mapMarkerCatalog.village }),
    portalPatch({ x: 13, y: 10, portalId: "portal_chisha_to_taihang", portalName: "赤砂回山阵", targetMapId: mapIds.taihang, targetPortalId: "portal_taihang_to_chisha", targetPortalName: "右线赤砂阵", imageUrl: mapMarkerCatalog.camp, description: "赤砂驿回返太行山右线的传送阵。" }),
    portalPatch({ x: 4, y: 18, portalId: "portal_chisha_to_dihuogu", portalName: "地火运料阵", targetMapId: mapIds.dihuogu, targetPortalId: "portal_dihuogu_to_chisha", targetPortalName: "谷前回驿阵", imageUrl: mapMarkerCatalog.war, description: "平时运送矿料和丹材的地火谷传送阵。" }),
  ]),
  [mapIds.dihuogu]: buildTilesData(24, 24, "empty", [
    ...rectPatch(24, 24, 0, 0, 23, 1, { type: "mountain", walkable: false, description: "谷顶焦黑的断壁压得人喘不过气。" }),
    ...rectPatch(24, 24, 8, 6, 14, 8, { type: "building", walkable: false, description: "废弃炉阵，仍有余温。" }),
    ...rectPatch(24, 24, 15, 13, 19, 16, { type: "building", walkable: false, description: "魔修存放祭具与矿料的石棚。" }),
    ...rectPatch(24, 24, 3, 17, 6, 20, { type: "mountain", walkable: false, description: "被炸裂的地火脉口，绕行更稳。" }),
    ...linePatch(24, 24, 2, 20, 18, 10, { type: "grass", walkable: true, description: "高温与碎石逼出的一条狭路。" }),
    markerPatch({ x: 11, y: 7, description: "废弃炉阵，仍有余温。", imageUrl: mapMarkerCatalog.war }),
    portalPatch({ x: 2, y: 20, portalId: "portal_dihuogu_to_chisha", portalName: "谷前回驿阵", targetMapId: mapIds.chisha, targetPortalId: "portal_chisha_to_dihuogu", targetPortalName: "地火运料阵", imageUrl: mapMarkerCatalog.camp, description: "回返赤砂驿的运料阵眼。" }),
    portalPatch({ x: 18, y: 10, portalId: "portal_dihuogu_to_bianfeng", portalName: "战时援城阵", targetMapId: mapIds.bianfeng, targetPortalId: "portal_bianfeng_to_dihuogu", targetPortalName: "西墙谷援阵", imageUrl: mapMarkerCatalog.fort, description: "大战时专门开辟的援城阵，可将地火资源送往边锋城。" }),
  ]),
  [mapIds.wuhaize]: buildTilesData(22, 24, "grass", [
    ...rectPatch(22, 24, 4, 4, 8, 7, { type: "water", walkable: false, description: "泽水像一面会吞声的镜。" }),
    ...rectPatch(22, 24, 13, 8, 17, 11, { type: "water", walkable: false, description: "浮萍底下常藏着木魅根须。" }),
    ...rectPatch(22, 24, 1, 15, 4, 20, { type: "forest", description: "老木缠雾，最适合滋生心魇。" }),
    ...linePatch(22, 24, 2, 21, 18, 6, { type: "grass", walkable: true, description: "一条勉强还能辨认的旧泽道。" }),
    portalPatch({ x: 18, y: 6, portalId: "portal_wuhaize_to_taihang", portalName: "泽口返山阵", targetMapId: mapIds.taihang, targetPortalId: "portal_taihang_to_wuhaize", targetPortalName: "左线雾泽阵", imageUrl: mapMarkerCatalog.seaGate, description: "雾海泽与太行山左线之间的返山阵。" }),
    portalPatch({ x: 2, y: 21, portalId: "portal_wuhaize_to_yehe", portalName: "古冢沉水阵", targetMapId: mapIds.yehe, targetPortalId: "portal_yehe_to_wuhaize", targetPortalName: "夜河出泽阵", imageUrl: mapMarkerCatalog.war, description: "沿旧泽道通往夜河古冢的阴阵。" }),
  ]),
  [mapIds.yehe]: buildTilesData(22, 24, "empty", [
    ...rectPatch(22, 24, 0, 0, 21, 1, { type: "mountain", walkable: false, description: "古冢石脊抬得很高，像谁都不肯再低头。" }),
    ...rectPatch(22, 24, 5, 5, 8, 8, { type: "building", walkable: false, description: "塌了一半的冢室石门。" }),
    ...rectPatch(22, 24, 13, 11, 16, 14, { type: "building", walkable: false, description: "夜河边的镇墓台，旧符未灭。" }),
    ...rectPatch(22, 24, 9, 17, 12, 20, { type: "water", walkable: false, description: "夜河支流阴冷刺骨，不宜涉入。" }),
    ...linePatch(22, 24, 2, 20, 17, 6, { type: "grass", walkable: true, description: "沿着碑影和残骨错开的活路。" }),
    markerPatch({ x: 6, y: 6, description: "塌了一半的冢室石门。", imageUrl: mapMarkerCatalog.peak }),
    portalPatch({ x: 17, y: 6, portalId: "portal_yehe_to_wuhaize", portalName: "夜河出泽阵", targetMapId: mapIds.wuhaize, targetPortalId: "portal_wuhaize_to_yehe", targetPortalName: "古冢沉水阵", imageUrl: mapMarkerCatalog.seaGate, description: "顺着雾海泽旧泽道回返的传送阵。" }),
    portalPatch({ x: 2, y: 20, portalId: "portal_yehe_to_liuduji", portalName: "渡集回返阵", targetMapId: mapIds.liuduji, targetPortalId: "portal_liuduji_to_yehe", targetPortalName: "夜河旧冢阵", imageUrl: mapMarkerCatalog.camp, description: "柳渡集旧修留下的回返阵，阵纹早已发暗。" }),
  ]),
  [mapIds.bianfeng]: buildTilesData(20, 28, "empty", [
    ...rectPatch(20, 28, 0, 0, 19, 0, { type: "building", walkable: false, description: "边锋北城墙，砖缝里都是血。" }),
    ...rectPatch(20, 28, 0, 27, 19, 27, { type: "building", walkable: false, description: "边锋南墙，常年顶风。" }),
    ...rectPatch(20, 28, 0, 0, 0, 27, { type: "building", walkable: false, description: "侧墙高耸，投下长影。" }),
    ...rectPatch(20, 28, 19, 0, 19, 27, { type: "building", walkable: false, description: "侧墙高耸，投下长影。" }),
    ...rectPatch(20, 28, 8, 0, 11, 0, { type: "empty", walkable: true, description: "北城门洞，能看见血火战场。" }),
    ...rectPatch(20, 28, 8, 27, 11, 27, { type: "empty", walkable: true, description: "南门通往城内主街。" }),
    ...rectPatch(20, 28, 3, 5, 6, 8, { type: "building", walkable: false, description: "兵甲库与粮棚。" }),
    ...rectPatch(20, 28, 12, 11, 15, 14, { type: "building", walkable: false, description: "临时伤兵营和药灶。" }),
    ...linePatch(20, 28, 9, 25, 9, 2, { type: "grass", walkable: true, description: "贯穿城中的守战主街。" }),
    markerPatch({ x: 4, y: 6, description: "兵甲库与粮棚。", imageUrl: mapMarkerCatalog.fort }),
    markerPatch({ x: 13, y: 12, description: "临时伤兵营和药灶。", imageUrl: mapMarkerCatalog.village }),
    portalPatch({ x: 15, y: 20, portalId: "portal_bianfeng_to_qingshili", portalName: "东门乡援阵", targetMapId: mapIds.qingshili, targetPortalId: "portal_qingshili_to_bianfeng", targetPortalName: "石里远城阵", imageUrl: mapMarkerCatalog.fort, description: "边锋城东门直通青石里的乡援阵。" }),
    portalPatch({ x: 3, y: 20, portalId: "portal_bianfeng_to_liuduji", portalName: "西门驰援阵", targetMapId: mapIds.liuduji, targetPortalId: "portal_liuduji_to_bianfeng", targetPortalName: "守城驰援阵", imageUrl: mapMarkerCatalog.fort, description: "柳渡集散修驰援边锋城的阵眼。" }),
    portalPatch({ x: 9, y: 3, portalId: "portal_bianfeng_to_yunmen", portalName: "北门云门阵", targetMapId: mapIds.yunmen, targetPortalId: "portal_yunmen_to_bianfeng", targetPortalName: "山门下城阵", imageUrl: mapMarkerCatalog.peak, description: "通往云门峰的求援阵，也是最让人心寒的一道门。" }),
    portalPatch({ x: 9, y: 24, portalId: "portal_bianfeng_to_lietianxu", portalName: "南门裂墟阵", targetMapId: mapIds.lietianxu, targetPortalId: "portal_lietianxu_to_bianfeng", targetPortalName: "墟前回城阵", imageUrl: mapMarkerCatalog.war, description: "战事最急时才会启用的南向秘阵。" }),
    portalPatch({ x: 9, y: 8, portalId: "portal_bianfeng_to_dihuogu", portalName: "西墙谷援阵", targetMapId: mapIds.dihuogu, targetPortalId: "portal_dihuogu_to_bianfeng", targetPortalName: "战时援城阵", imageUrl: mapMarkerCatalog.camp, description: "专门接应地火谷资源的后勤阵眼。" }),
  ]),
  [mapIds.yunmen]: buildTilesData(20, 24, "grass", [
    ...rectPatch(20, 24, 0, 0, 19, 2, { type: "mountain", walkable: false, description: "云门峰高处常年云压山门。" }),
    ...rectPatch(20, 24, 7, 5, 12, 8, { type: "building", walkable: false, description: "云门前殿，门未开，人先冷了。" }),
    ...rectPatch(20, 24, 3, 10, 5, 14, { type: "forest", description: "松下石阶潮湿，求援者常站在这里等天黑。" }),
    ...linePatch(20, 24, 9, 22, 9, 4, { type: "grass", walkable: true, description: "通往山门的一条长阶。" }),
    markerPatch({ x: 9, y: 6, description: "云门前殿，门未开，人先冷了。", imageUrl: mapMarkerCatalog.peak }),
    portalPatch({ x: 9, y: 22, portalId: "portal_yunmen_to_bianfeng", portalName: "山门下城阵", targetMapId: mapIds.bianfeng, targetPortalId: "portal_bianfeng_to_yunmen", targetPortalName: "北门云门阵", imageUrl: mapMarkerCatalog.fort, description: "从云门峰山门直下边锋城的求援阵。" }),
  ]),
  [mapIds.lietianxu]: buildTilesData(24, 24, "empty", [
    ...rectPatch(24, 24, 2, 3, 7, 5, { type: "mountain", walkable: false, description: "裂天墟旧战残壁，锋利得像刀。" }),
    ...rectPatch(24, 24, 14, 13, 20, 15, { type: "mountain", walkable: false, description: "塌下来的天裂碎石堆成死角。" }),
    ...rectPatch(24, 24, 9, 8, 13, 10, { type: "water", walkable: false, description: "像天缝一般的幽蓝裂隙。" }),
    ...linePatch(24, 24, 3, 20, 19, 6, { type: "grass", walkable: true, description: "古战遗路尚能容人勉强穿行。" }),
    portalPatch({ x: 3, y: 20, portalId: "portal_lietianxu_to_bianfeng", portalName: "墟前回城阵", targetMapId: mapIds.bianfeng, targetPortalId: "portal_bianfeng_to_lietianxu", targetPortalName: "南门裂墟阵", imageUrl: mapMarkerCatalog.fort, description: "裂天墟前线回返边锋城的稳固阵眼。" }),
  ]),
};

const maps: OfflineMap[] = [
  { id: mapIds.penglai, name: "蓬莱岛", description: buildMapDescription("海雾终年不散的海岛坊市，散修、渔民与低阶修士混居，是练气主线的主舞台。", mapIds.penglai), backgroundImageUrl: null, width: 18, height: 26, minRealm: 1, mapType: "city", tilesData: mapTilesById[mapIds.penglai] },
  { id: mapIds.qingshili, name: "青石里", description: buildMapDescription("背山临海的小村，凡人烟火未灭，也是后来元婴篇第一处受难之地。", mapIds.qingshili), backgroundImageUrl: null, width: 18, height: 22, minRealm: 2, mapType: "city", tilesData: mapTilesById[mapIds.qingshili] },
  { id: mapIds.liuduji, name: "柳渡集", description: buildMapDescription("渡口商旅往来的集市，消息与人情都在这里流转。", mapIds.liuduji), backgroundImageUrl: null, width: 18, height: 24, minRealm: 4, mapType: "city", tilesData: mapTilesById[mapIds.liuduji] },
  { id: mapIds.heisonglin, name: "黑松林", description: buildMapDescription("阴湿黑松密布，早年多药草，如今却被低阶劫修与异兽盘踞。", mapIds.heisonglin), backgroundImageUrl: null, width: 22, height: 22, minRealm: 4, mapType: "field", tilesData: mapTilesById[mapIds.heisonglin] },
  { id: mapIds.shigudong, name: "石骨洞", description: buildMapDescription("旧矿洞坍塌后形成的血腥窟穴，练气篇终局追索之地。", mapIds.shigudong), backgroundImageUrl: null, width: 20, height: 24, minRealm: 8, mapType: "dungeon", tilesData: mapTilesById[mapIds.shigudong] },
  { id: mapIds.taihang, name: "太行山", description: buildMapDescription("一山双线，右线查魔修献祭，左线收人情因果，是筑基与结丹主舞台。扩成五十见方后，阵点与山道终于能把左右两线真正分开。", mapIds.taihang), backgroundImageUrl: null, width: 50, height: 50, minRealm: 13, mapType: "field", tilesData: mapTilesById[mapIds.taihang] },
  { id: mapIds.chisha, name: "赤砂驿", description: buildMapDescription("荒驿立在风沙中，补给、军务与消息都在此转手。", mapIds.chisha), backgroundImageUrl: null, width: 18, height: 22, minRealm: 14, mapType: "city", tilesData: mapTilesById[mapIds.chisha] },
  { id: mapIds.dihuogu, name: "地火谷", description: buildMapDescription("地火喷薄，献祭与炼器同样需要它的火脉，是筑基终局战区与元婴战争资源区。", mapIds.dihuogu), backgroundImageUrl: null, width: 24, height: 24, minRealm: 15, mapType: "dungeon", tilesData: mapTilesById[mapIds.dihuogu] },
  { id: mapIds.wuhaize, name: "雾海泽", description: buildMapDescription("泽气如海，最适合人心浮动时听见自己的回声。", mapIds.wuhaize), backgroundImageUrl: null, width: 22, height: 24, minRealm: 17, mapType: "field", tilesData: mapTilesById[mapIds.wuhaize] },
  { id: mapIds.yehe, name: "夜河古冢", description: buildMapDescription("古冢沉水，阴骨不化，是结丹篇心魔外化的证据之地。", mapIds.yehe), backgroundImageUrl: null, width: 22, height: 24, minRealm: 18, mapType: "dungeon", tilesData: mapTilesById[mapIds.yehe] },
  { id: mapIds.bianfeng, name: "边锋城", description: buildMapDescription("大劫压境时的边疆要塞，凡人、散修与妖兽幼崽共同守住最后防线。", mapIds.bianfeng), backgroundImageUrl: null, width: 20, height: 28, minRealm: 20, mapType: "city", tilesData: mapTilesById[mapIds.bianfeng] },
  { id: mapIds.yunmen, name: "云门峰", description: buildMapDescription("高门大宗的观望之地，也是元婴篇求援碰壁的所在。", mapIds.yunmen), backgroundImageUrl: null, width: 20, height: 24, minRealm: 22, mapType: "field", tilesData: mapTilesById[mapIds.yunmen] },
  { id: mapIds.lietianxu, name: "裂天墟", description: buildMapDescription("高压战区，裂隙与古战遗痕并存，如今只服务元婴战争线。", mapIds.lietianxu), backgroundImageUrl: null, width: 24, height: 24, minRealm: 24, mapType: "secret", tilesData: mapTilesById[mapIds.lietianxu] },
];

const mapEdges: OfflineMapEdge[] = [
  { mapAId: mapIds.penglai, mapBId: mapIds.qingshili },
  { mapAId: mapIds.penglai, mapBId: mapIds.liuduji },
  { mapAId: mapIds.liuduji, mapBId: mapIds.heisonglin },
  { mapAId: mapIds.heisonglin, mapBId: mapIds.shigudong },
  { mapAId: mapIds.liuduji, mapBId: mapIds.taihang },
  { mapAId: mapIds.taihang, mapBId: mapIds.chisha },
  { mapAId: mapIds.chisha, mapBId: mapIds.dihuogu },
  { mapAId: mapIds.taihang, mapBId: mapIds.wuhaize },
  { mapAId: mapIds.wuhaize, mapBId: mapIds.yehe },
  { mapAId: mapIds.liuduji, mapBId: mapIds.yehe },
  { mapAId: mapIds.qingshili, mapBId: mapIds.bianfeng },
  { mapAId: mapIds.liuduji, mapBId: mapIds.bianfeng },
  { mapAId: mapIds.bianfeng, mapBId: mapIds.yunmen },
  { mapAId: mapIds.bianfeng, mapBId: mapIds.lietianxu },
  { mapAId: mapIds.dihuogu, mapBId: mapIds.bianfeng },
];

const stageItemNames = {
  lianqi: {
    sword: "潮纹青锋",
    blade: "断潮短刀",
    needle: "游丝玄针",
    talisman: "海雾符匣",
    shield: "玄贝小盾",
    focus: "听潮法珠",
    swordBox: "引锋剑匣",
    bloodBanner: "镇潮骨幡",
    swiftRing: "踏波灵环",
    robe: "青箬法衣",
    helmet: "蓑羽斗笠",
    shoes: "踏浪靴",
    signature: "渔火古灯",
    xpPill: "凝露丹",
    breakPill: "护脉清元散",
    healPill: "回灵散",
    skillBook: "《牵潮剑气残卷》",
    materials: ["海雾草", "潮纹寒铁", "石骨碎片", "蚁酸囊", "庚金砂", "青藤芯", "玄水珠", "地火屑", "黄土晶"],
  },
  zhuji: {
    sword: "赤砂鸣锋",
    blade: "斩煞刀",
    needle: "裂魂针",
    talisman: "镇魔符盘",
    shield: "玄火龟盾",
    focus: "地火灵尺",
    swordBox: "斩煞剑匣",
    bloodBanner: "镇血战幡",
    swiftRing: "逐焰风环",
    robe: "玄砂法袍",
    helmet: "镇煞冠",
    shoes: "履火靴",
    signature: "地火镇魂镜",
    xpPill: "筑元丹",
    breakPill: "凝煞护脉丹",
    healPill: "赤砂回元丹",
    skillBook: "《破煞刀轮秘谱》",
    materials: ["赤砂玄铁", "地火晶核", "血纹符皮", "阴魂骨", "赤庚金精", "枯木心", "寒泉髓", "离火砾", "厚土魄"],
  },
  jiedan: {
    sword: "问心青岚剑",
    blade: "断情戒刀",
    needle: "回风细针",
    talisman: "戒律灵符",
    shield: "返照玄盾",
    focus: "观心法印",
    swordBox: "青岚剑匣",
    bloodBanner: "镇魄玄幡",
    swiftRing: "回风遁环",
    robe: "云纹道衣",
    helmet: "静心冠",
    shoes: "踏尘履",
    signature: "观心古鉴",
    xpPill: "蕴丹金液",
    breakPill: "定心清魄丹",
    healPill: "回天灵膏",
    skillBook: "《问心离火经卷》",
    materials: ["雾海灵莲", "夜河骨晶", "戒律玄铁", "心魇残页", "金霞石", "青冥木髓", "玄露真水", "离心火晶", "坤灵息壤"],
  },
  yuanying: {
    sword: "镇城天河剑",
    blade: "破军血牙刀",
    needle: "摄魄星针",
    talisman: "护城灵符阵",
    shield: "岳家玄盾",
    focus: "镇城道璧",
    swordBox: "天河剑匣",
    bloodBanner: "守疆玄幡",
    swiftRing: "逐星雷环",
    robe: "玄霄战袍",
    helmet: "镇岳金冠",
    shoes: "逐云战履",
    signature: "众生愿灯",
    xpPill: "婴元天露",
    breakPill: "护婴真髓丹",
    healPill: "九转回命散",
    skillBook: "《镇城剑河图》",
    materials: ["边锋铁胆", "云门风羽", "裂天玄晶", "血河魔髓", "妖狐灵毛", "太白庚金", "建木心纹", "北溟寒髓", "太阳真炎砂", "后土元壤"],
  },
} as const;

const stageMinRealm: Record<ItemStageKey, number> = { lianqi: 1, zhuji: 13, jiedan: 17, yuanying: 21 };
const stageRarity: Record<ItemStageKey, OfflineItem["rarity"]> = { lianqi: "uncommon", zhuji: "rare", jiedan: "epic", yuanying: "legendary" };

function stageScalar(stage: ItemStageKey) {
  return { lianqi: 1, zhuji: 2, jiedan: 3, yuanying: 4 }[stage];
}

function stageXpPillValue(stage: ItemStageKey) {
  return xpPillValueByStage[stage];
}

function stageSenseGearValue(stage: ItemStageKey, kind: "minor" | "major") {
  const values = {
    minor: { lianqi: 1, zhuji: 1, jiedan: 2, yuanying: 2 },
    major: { lianqi: 1, zhuji: 2, jiedan: 2, yuanying: 3 },
  } as const;
  return values[kind][stage];
}

function stageRareCombatValue(stage: ItemStageKey, kind: "small" | "medium") {
  const values = {
    small: { lianqi: 1, zhuji: 2, jiedan: 2, yuanying: 3 },
    medium: { lianqi: 2, zhuji: 3, jiedan: 4, yuanying: 5 },
  } as const;
  return values[kind][stage];
}

function stageSkillRouteValue(stage: ItemStageKey, kind: "small" | "medium") {
  const values = {
    small: { lianqi: 1, zhuji: 2, jiedan: 3, yuanying: 4 },
    medium: { lianqi: 2, zhuji: 3, jiedan: 4, yuanying: 5 },
  } as const;
  return values[kind][stage];
}

function stageItemId(stage: ItemStageKey, kind: string) {
  return `item_four_realms_${stage}_${kind}`;
}

function stageMaterialIds(stage: ItemStageKey) {
  return stageItemNames[stage].materials.map((_, index) => stageItemId(stage, `material_${index + 1}`));
}

const spiritualFieldItemIds = {
  lianqiSeed: stageItemId("lianqi", "seed_herb"),
  zhujiSeed: stageItemId("zhuji", "seed_herb"),
  zhujiHerb: stageItemId("zhuji", "material_herb"),
  jiedanSeed: stageItemId("jiedan", "seed_herb"),
  jiedanSeedQingluo: stageItemId("jiedan", "seed_qingluo_vine"),
  jiedanSeedYuexi: stageItemId("jiedan", "seed_yuexi_orchid"),
  jiedanSeedJinyang: stageItemId("jiedan", "seed_jinyang_spike"),
  yuanyingSeed: stageItemId("yuanying", "seed_herb"),
  yuanyingSeedXuanshuang: stageItemId("yuanying", "seed_xuanshuang_ganoderma"),
  yuanyingSeedJiuxiao: stageItemId("yuanying", "seed_jiuxiao_sunbloom"),
  yuanyingSeedTaiyin: stageItemId("yuanying", "seed_taiyin_dragonwort"),
  yuanyingHerb: stageItemId("yuanying", "material_herb"),
  hongmengBottle: "item_hongmeng_zhangtian_bottle",
} as const;

function resolveItemPillToxicity(item: OfflineItem) {
  const hasXpEffect = item.effects.some((effect) => effect.type === "boost_xp" && Number(effect.value || 0) > 0);
  if (!hasXpEffect) {
    return 0;
  }
  return getOfficialXpPillToxicity();
}

function buildStageItems(
  stage: ItemStageKey,
  skillBookSkillId: string,
  talismanSkillId: string,
  shieldSkillId: string,
  signatureSkillId: string,
  needleSkillId: string,
): OfflineItem[] {
  const scalar = stageScalar(stage);
  const names = stageItemNames[stage];
  const minRealm = stageMinRealm[stage];
  const rarity = stageRarity[stage];
  const materials = names.materials.map((materialName, index) => ({
    id: stageItemId(stage, `material_${index + 1}`),
    name: materialName,
    iconUrl: index % 2 === 0 ? iconCatalog.materialOrb.publicPath : iconCatalog.materialJade.publicPath,
    description: `${materialName}是${names.signature}与本阶段丹药、法宝的核心材料。`,
    itemType: "material" as const,
    rarity,
    effects: [],
    price: 24 * scalar,
    stackable: true,
    isBound: false,
    minRealm: minRealm - 1,
    maxRealm: stage === "lianqi" ? linearRealms.zhuji.early - 1 : null,
  }));

  return [
    { id: stageItemId(stage, "weapon_sword"), name: names.sword, iconUrl: iconCatalog.sword.publicPath, description: `偏重剑气与神识的${stage === "lianqi" ? "低阶" : "本阶"}主武，适合稳扎稳打的修士。`, itemType: "weapon", rarity, effects: [statEffect("boost_atk", 8 * scalar), statEffect("boost_spiritual_sense", stageSenseGearValue(stage, "minor"))], price: 180 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "weapon_blade"), name: names.blade, iconUrl: iconCatalog.blade.publicPath, description: "走高攻破阵一路的刀器，适合对付同阶防修与魔修。", itemType: "weapon", rarity, effects: [statEffect("boost_atk", 10 * scalar), statEffect("boost_armor_penetration", stageRareCombatValue(stage, "medium"))], price: 190 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "weapon_needle"), name: names.needle, iconUrl: iconCatalog.needle.publicPath, description: "细针如丝，偏向速度与穿透，适合精确斩杀。", itemType: "weapon", rarity, effects: [statEffect("boost_atk", 7 * scalar), statEffect("boost_speed", 2 * scalar), statEffect("boost_armor_penetration", stageRareCombatValue(stage, "small"))], price: 188 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "weapon_focus"), name: names.focus, iconUrl: iconCatalog.focus.publicPath, description: "偏法修一路的法器主武，适合走神识、神通增伤与稳定压制。", itemType: "weapon", rarity, effects: [statEffect("boost_atk", 6 * scalar), statEffect("boost_spiritual_sense", stageSenseGearValue(stage, "major")), statEffect("boost_skill_damage_bonus", stageSkillRouteValue(stage, "small"))], price: 212 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "artifact_talisman"), name: names.talisman, iconUrl: iconCatalog.talisman.publicPath, description: "以灵符成阵的法宝，兼顾神识与法术压制，自带固定符术。", itemType: "artifact", rarity, effects: [statEffect("boost_spiritual_sense", stageSenseGearValue(stage, "minor")), statEffect("boost_def", 2 * scalar), statEffect("bind_skill", 1, { skillId: talismanSkillId })], price: 240 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "artifact_shield"), name: names.shield, iconUrl: iconCatalog.shield.publicPath, description: "稳守一路的盾器法宝，自带护盾神通，可用灵气先行抵消一部分本该落到气血上的伤害。", itemType: "artifact", rarity, effects: [statEffect("boost_def", 7 * scalar), statEffect("boost_block", stageRareCombatValue(stage, "medium")), statEffect("bind_skill", 1, { skillId: shieldSkillId })], price: 230 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "artifact_sword_box"), name: names.swordBox, iconUrl: iconCatalog.swordBox.publicPath, description: "剑修流的本命剑匣，重在压缩一口剑势与神通爆发，自带固定攻伐神通。", itemType: "artifact", rarity, effects: [statEffect("boost_atk", 5 * scalar), statEffect("boost_skill_damage_bonus", stageSkillRouteValue(stage, "medium")), statEffect("bind_skill", 1, { skillId: skillBookSkillId })], price: 272 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "artifact_blood_banner"), name: names.bloodBanner, iconUrl: iconCatalog.bloodBanner.publicPath, description: "存血厚防一路的战幡法宝，主打正面顶线与持续承伤，自带护体神通。", itemType: "artifact", rarity, effects: [statEffect("boost_hp", 56 * scalar), statEffect("boost_def", 4 * scalar), statEffect("boost_skill_damage_reduction", stageSkillRouteValue(stage, "small")), statEffect("bind_skill", 1, { skillId: shieldSkillId })], price: 286 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "artifact_swift_ring"), name: names.swiftRing, iconUrl: iconCatalog.swiftRing.publicPath, description: "疾法与短诀流的灵环法宝，偏向先手、频繁起势与追击收割，自带针诀类固定神通。", itemType: "artifact", rarity, effects: [statEffect("boost_speed", 3 * scalar), statEffect("boost_luck", scalar), statEffect("boost_skill_damage_bonus", stageSkillRouteValue(stage, "small")), statEffect("bind_skill", 1, { skillId: needleSkillId })], price: 258 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "armor_robe"), name: names.robe, iconUrl: iconCatalog.robe.publicPath, description: "本阶段主防具法衣，偏向气血与正面承伤。", itemType: "armor", rarity, effects: [statEffect("boost_hp", 40 * scalar), statEffect("boost_def", 5 * scalar)], price: 160 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "armor_helmet"), name: names.helmet, iconUrl: iconCatalog.helmet.publicPath, description: "冠类护具，帮助修士稳住心神与神识。", itemType: "helmet", rarity, effects: [statEffect("boost_def", 4 * scalar), statEffect("boost_spiritual_sense", stageSenseGearValue(stage, "minor"))], price: 140 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "armor_shoes"), name: names.shoes, iconUrl: iconCatalog.robe.publicPath, description: "履类护具，主打身法、气机流转与追击能力。", itemType: "shoes", rarity, effects: [statEffect("boost_speed", 2 * scalar), statEffect("boost_luck", scalar)], price: 132 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "artifact_signature"), name: names.signature, iconUrl: iconCatalog.materialJade.publicPath, description: "该阶段的标志性法宝，兼具护持与主动神通，同样拥有固定绑定技能。", itemType: "artifact", rarity, effects: [statEffect("boost_spiritual_sense", stageSenseGearValue(stage, "major")), statEffect("boost_hp", 18 * scalar), statEffect("boost_def", 3 * scalar), statEffect("bind_skill", 1, { skillId: signatureSkillId })], price: 320 * scalar, stackable: false, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "pill_xp"), name: names.xpPill, iconUrl: iconCatalog.elixirBlue.publicPath, description: "常规修为丹，用于平稳推升当前阶段修为。", itemType: "consumable", rarity, effects: [statEffect("boost_xp", stageXpPillValue(stage))], price: 68 * scalar, stackable: true, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "pill_break"), name: names.breakPill, iconUrl: iconCatalog.elixirRed.publicPath, description: "辅助突破的丹药，适合用在圆满前后的卡级节点。", itemType: "consumable", rarity, effects: [statEffect("boost_breakthrough", 0.04 + scalar * 0.02)], price: 88 * scalar, stackable: true, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "pill_heal"), name: names.healPill, iconUrl: iconCatalog.elixirBottle.publicPath, description: "战斗恢复丹药，同时回复气血与灵力，适合精英战与Boss战。", itemType: "consumable", rarity, effects: [statEffect("heal_hp", 80 * scalar), statEffect("heal_mp", 50 * scalar)], price: 76 * scalar, stackable: true, isBound: false, minRealm, maxRealm: null },
    { id: stageItemId(stage, "skill_book"), name: names.skillBook, iconUrl: iconCatalog.materialJade.publicPath, description: "记录本阶段核心攻伐神通的经卷，可供修士直接参悟。", itemType: "skill_book", rarity, effects: [statEffect("learn_skill", 1, { skillId: skillBookSkillId })], price: 210 * scalar, stackable: true, isBound: false, minRealm, maxRealm: null },
    ...materials,
  ];
}

const baseItems: OfflineItem[] = [
  ...buildStageItems("lianqi", skillIds.lqSword, skillIds.lqTalisman, skillIds.lqShield, skillIds.lqShield, skillIds.lqNeedle),
  ...buildStageItems("zhuji", skillIds.zjBlade, skillIds.zjSeal, skillIds.zjShield, skillIds.zjShield, skillIds.zjNeedle),
  ...buildStageItems("jiedan", skillIds.jdFire, skillIds.jdSeal, skillIds.jdShield, skillIds.jdShield, skillIds.jdMind),
  ...buildStageItems("yuanying", skillIds.yySword, skillIds.yySeal, skillIds.yyWish, skillIds.yyWish, skillIds.yyNeedle),
  { id: spiritualFieldItemIds.lianqiSeed, name: "海雾草种", iconUrl: iconCatalog.materialOrb.publicPath, description: "蓬莱岛药农留下的低阶灵种，可在洞府灵田里培育出海雾草。", itemType: "material", rarity: "common", effects: [], price: 18, stackable: true, isBound: false, minRealm: 1, maxRealm: 12 },
  { id: spiritualFieldItemIds.zhujiSeed, name: "赤髓芝种", iconUrl: iconCatalog.materialOrb.publicPath, description: "需借地火余温催养的灵种，适合筑基期在灵田中长期培育。", itemType: "material", rarity: "uncommon", effects: [], price: 42, stackable: true, isBound: false, minRealm: 13, maxRealm: 16 },
  { id: spiritualFieldItemIds.zhujiHerb, name: "赤髓芝", iconUrl: iconCatalog.materialOrb.publicPath, description: "蕴有地火余脉的药芝，是筑基期修为丹与回元丹的重要药引。", itemType: "material", rarity: "rare", effects: [], price: 58, stackable: true, isBound: false, minRealm: 13, maxRealm: 16 },
  { id: spiritualFieldItemIds.jiedanSeed, name: "雾海灵莲子", iconUrl: iconCatalog.materialOrb.publicPath, description: "要在清静灵脉中慢养的莲种，最适合结丹修士的洞府药圃。", itemType: "material", rarity: "rare", effects: [], price: 86, stackable: true, isBound: false, minRealm: 17, maxRealm: 20 },
  { id: spiritualFieldItemIds.jiedanSeedQingluo, name: "青萝藤种", iconUrl: iconCatalog.materialJade.publicPath, description: "藤性极韧的结丹灵种，常在荒林秘境的木水灵脉中孕成。", itemType: "material", rarity: "rare", effects: [], price: 98, stackable: true, isBound: false, minRealm: 17, maxRealm: 20 },
  { id: spiritualFieldItemIds.jiedanSeedYuexi, name: "月汐兰种", iconUrl: iconCatalog.materialOrb.publicPath, description: "受水府月潮滋养的灵种，成熟缓慢，却常结出丹房喜用的净灵药材。", itemType: "material", rarity: "rare", effects: [], price: 104, stackable: true, isBound: false, minRealm: 17, maxRealm: 20 },
  { id: spiritualFieldItemIds.jiedanSeedJinyang, name: "金阳穗种", iconUrl: iconCatalog.materialJade.publicPath, description: "吸火煞与矿气而生的高阶穗种，适合愿意用掌天瓶加速温养的结丹修士。", itemType: "material", rarity: "epic", effects: [], price: 128, stackable: true, isBound: false, minRealm: 17, maxRealm: 20 },
  { id: spiritualFieldItemIds.yuanyingSeed, name: "守心雪参种", iconUrl: iconCatalog.materialOrb.publicPath, description: "边锋旧库中保存下来的高阶灵种，需以稳固灵田日夜温养。", itemType: "material", rarity: "epic", effects: [], price: 132, stackable: true, isBound: false, minRealm: 21, maxRealm: 24 },
  { id: spiritualFieldItemIds.yuanyingSeedXuanshuang, name: "玄霜芝种", iconUrl: iconCatalog.materialJade.publicPath, description: "元婴修士争抢的药谷异种，霜气入髓，适合长时培育后再用掌天瓶收尾。", itemType: "material", rarity: "epic", effects: [], price: 156, stackable: true, isBound: false, minRealm: 21, maxRealm: 24 },
  { id: spiritualFieldItemIds.yuanyingSeedJiuxiao, name: "九霄葵籽", iconUrl: iconCatalog.materialOrb.publicPath, description: "得晴空雷火和药泉灵息共育的奇籽，成熟极慢，却能稳定产出元婴级主材。", itemType: "material", rarity: "epic", effects: [], price: 168, stackable: true, isBound: false, minRealm: 21, maxRealm: 24 },
  { id: spiritualFieldItemIds.yuanyingSeedTaiyin, name: "太阴龙葵种", iconUrl: iconCatalog.materialJade.publicPath, description: "极稀罕的元婴传说灵种，往往只在高危秘境与遗府残脉中觅得一二。", itemType: "material", rarity: "legendary", effects: [], price: 220, stackable: true, isBound: false, minRealm: 21, maxRealm: 24 },
  { id: spiritualFieldItemIds.yuanyingHerb, name: "守心雪参", iconUrl: iconCatalog.materialOrb.publicPath, description: "在大战边地也能稳住心魄的高阶灵参，是元婴期婴元丹方的主药。", itemType: "material", rarity: "legendary", effects: [], price: 168, stackable: true, isBound: false, minRealm: 21, maxRealm: 24 },
  { id: spiritualFieldItemIds.hongmengBottle, name: "掌天瓶", iconUrl: "/uploads/cosmetics/item/1773116471626-91e64c2f.png", description: "混沌初开后孕出的鸿蒙至宝，可积蓄时序灵能，浇灌灵田并催熟灵植。", itemType: "material", rarity: "hongmeng", effects: [], price: 0, stackable: false, isBound: true, minRealm: null, maxRealm: null },
  { id: "item_four_realms_quest_magic_rope", name: "带血麻绳", iconUrl: iconCatalog.materialJade.publicPath, description: "王二狗带来的凡人遗物，是筑基篇追查魔修献祭的第一件证物。", itemType: "quest", rarity: "common", effects: [], price: 0, stackable: true, isBound: true, minRealm: 13, maxRealm: null },
  { id: "item_four_realms_quest_sacrificial_chart", name: "献祭阵图", iconUrl: iconCatalog.materialJade.publicPath, description: "以生魂与精血换取修为的阵图残卷，是定罪魔修的关键证据。", itemType: "quest", rarity: "rare", effects: [], price: 0, stackable: true, isBound: true, minRealm: 15, maxRealm: null },
  { id: "item_four_realms_quest_village_notes", name: "乡塾旧札", iconUrl: iconCatalog.materialJade.publicPath, description: "王二狗这些年教书育人的旧笔记，记录着凡人也能留下的善行。", itemType: "quest", rarity: "rare", effects: [], price: 0, stackable: true, isBound: true, minRealm: 17, maxRealm: null },
  { id: "item_four_realms_quest_righteous_token", name: "正道信物", iconUrl: iconCatalog.materialJade.publicPath, description: "柳娘托付的联络信物，足以叩开真正愿意出手的前辈之门。", itemType: "quest", rarity: "epic", effects: [], price: 0, stackable: true, isBound: true, minRealm: 21, maxRealm: null },
];

const items: OfflineItem[] = baseItems.map((item): OfflineItem => ({
  ...item,
  pillToxicity: resolveItemPillToxicity(item),
}));

const npcAvatarCatalog: Record<string, string> = {
  [npcIds.yuweng]: "/uploads/cosmetics/npc-avatar/1772440383898-682885ee.png",
  [npcIds.zhouniangzi]: "/uploads/cosmetics/npc-avatar/1772178157632-42abe020.png",
  [npcIds.menglao]: "/uploads/cosmetics/npc-avatar/1772440383898-682885ee.png",
  [npcIds.dingxunhai]: "/uploads/cosmetics/npc-avatar/1772440602200-e90d1b0a.png",
  [npcIds.wangergou]: "/uploads/cosmetics/npc-avatar/1772440528439-a2ba13dd.png",
  [npcIds.jiangwangbei]: "/uploads/cosmetics/npc-avatar/1772440602200-e90d1b0a.png",
  [npcIds.rendanniang]: "/uploads/cosmetics/npc-avatar/1772178157632-42abe020.png",
  [npcIds.chiyan]: "/uploads/cosmetics/npc-avatar/1772440528439-a2ba13dd.png",
  [npcIds.oldWang]: "/uploads/cosmetics/npc-avatar/1772440383898-682885ee.png",
  [npcIds.lishixiong]: "/uploads/cosmetics/npc-avatar/1772178025458-cd6da3a5.png",
  [npcIds.liuniang]: "/uploads/cosmetics/npc-avatar/1772440647352-696038d5.png",
  [npcIds.yuedingshan]: "/uploads/cosmetics/npc-avatar/1772440602200-e90d1b0a.png",
  [npcIds.ali]: "/uploads/cosmetics/npc-avatar/1772177813661-a4ec785b.png",
  [npcIds.yunlao]: "/uploads/cosmetics/npc-avatar/1772440383898-682885ee.png",
};

const npcs: OfflineNpc[] = [
  { id: npcIds.yuweng, name: "渔翁", title: "蓬莱老渔", description: "话不多，看得远。明明是凡人出身，却比许多修士更懂修仙界的险恶与分寸。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.penglai, positionX: 4, positionY: 16, personality: "慢语、谨慎、看透人心", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.zhouniangzi, name: "周娘子", title: "海雾药铺掌柜", description: "蓬莱岛药铺掌柜，嘴上精明，心里却常替凡人留一线活路。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.penglai, positionX: 9, positionY: 7, personality: "利落、谨慎、认货不认嘴", isShop: true, shopItems: [{ itemId: stageItemId("lianqi", "pill_xp"), price: 72 }, { itemId: stageItemId("lianqi", "pill_heal"), price: 84 }, { itemId: spiritualFieldItemIds.lianqiSeed, price: 22 }], bountyEnabled: false, bountyDailyLimit: 0 },
  // 位置 (13,11)：海匠坊 (x12-14,y8-10) 南门口的石板路端点。
  // 不能放在坊内正中 (13,9)——周围 8 格全是 walkable:false 的建筑，交互距离 ≤1 导致结构性不可达（2026-10-20 线上反馈）。
  { id: npcIds.menglao, name: "孟老", title: "海匠坊主", description: "炼器手法古板却很稳，最厌恶拿凡人之命换法器灵性的行径。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.penglai, positionX: 13, positionY: 11, personality: "务实、火爆、看重手艺", isShop: true, shopItems: [{ itemId: stageItemId("lianqi", "weapon_sword"), price: 210 }, { itemId: stageItemId("lianqi", "armor_robe"), price: 180 }], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.dingxunhai, name: "丁巡海", title: "岛卫队长", description: "蓬莱岛护卫队长，面对散修勒索时常左右为难，却还守着一口气。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.penglai, positionX: 15, positionY: 15, personality: "重职责、知轻重、厌恶劫修", isShop: false, shopItems: [], bountyEnabled: true, bountyDailyLimit: 2 },
  { id: npcIds.wangergou, name: "王二狗", title: "太行山樵子", description: "出身寒微，却始终把凡人之命看作命。筑基篇因魔修掳人而求助于你。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.taihang, positionX: 7, positionY: 18, personality: "耿直、倔强、认死理", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.jiangwangbei, name: "江望北", title: "赤砂驿驿丞", description: "边地行军出身，做事只问补给能否接上，不信空话。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.chisha, positionX: 8, positionY: 8, personality: "纪律、效率、代价透明", isShop: false, shopItems: [], bountyEnabled: true, bountyDailyLimit: 2 },
  { id: npcIds.rendanniang, name: "任丹娘", title: "赤砂丹房掌柜", description: "擅长火候控制，对劣质材料与混乱配方零容忍。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.chisha, positionX: 12, positionY: 10, personality: "快节奏、技术派、嘴硬心细", isShop: true, shopItems: [{ itemId: stageItemId("zhuji", "pill_xp"), price: 156 }, { itemId: stageItemId("zhuji", "pill_break"), price: 180 }, { itemId: stageItemId("zhuji", "pill_heal"), price: 170 }, { itemId: spiritualFieldItemIds.zhujiSeed, price: 58 }], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.chiyan, name: "池焰", title: "地火谷守火人", description: "性子烈如谷火，但凡事都讲结果。见过太多魔修拿地火当屠刀。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.dihuogu, positionX: 11, positionY: 17, personality: "火爆、公正、重结果", isShop: true, shopItems: [{ itemId: stageItemId("zhuji", "artifact_signature"), price: 620 }, { itemId: stageItemId("zhuji", "weapon_blade"), price: 420 }], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.oldWang, name: "王二狗", title: "垂暮老者", description: "当年被你救下的孩童，如今白发苍苍，仍把“凡人也有未来”活成了一辈子的答案。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.liuduji, positionX: 6, positionY: 14, personality: "正直、温厚、至死不改初心", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.lishixiong, name: "李师兄", title: "执法堂长老", description: "当年与你并肩救人，如今身在执法堂，重情却不得不守法。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.taihang, positionX: 16, positionY: 8, personality: "重情、克制、立场矛盾", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.liuniang, name: "柳娘", title: "柳渡客栈掌柜", description: "表面经营客栈，实则替散修传消息、给凡人留退路。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.liuduji, positionX: 12, positionY: 9, personality: "圆融、果决、愿替弱者担责", isShop: true, shopItems: [{ itemId: stageItemId("jiedan", "pill_xp"), price: 320 }, { itemId: stageItemId("jiedan", "pill_heal"), price: 330 }, { itemId: stageItemId("yuanying", "pill_heal"), price: 520 }, { itemId: spiritualFieldItemIds.jiedanSeed, price: 102 }, { itemId: spiritualFieldItemIds.yuanyingSeed, price: 168 }], bountyEnabled: true, bountyDailyLimit: 1 },
  { id: npcIds.yuedingshan, name: "岳定山", title: "边锋城主", description: "年近七旬仍披甲守城。明知仙凡之差如天堑，仍愿与八百子弟兵同死一处。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.bianfeng, positionX: 9, positionY: 6, personality: "刚烈、守土、无惧身死", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.ali, name: "阿狸", title: "妖狐幼崽", description: "父母死于魔修之手，受伤逃入边锋城。虽无言，却比许多人更知感恩。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.bianfeng, positionX: 14, positionY: 17, personality: "机敏、依赖、愿意守护同伴", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
  { id: npcIds.yunlao, name: "云老", title: "青石里隐修", description: "青石里唯一幸存的长者，曾以为避世便是自保，直到亲眼见到覆巢之下无完卵。", avatarImageUrl: null, portraitImageUrl: null, mapId: mapIds.qingshili, positionX: 5, positionY: 11, personality: "沉默、自责、终于醒悟", isShop: false, shopItems: [], bountyEnabled: false, bountyDailyLimit: 0 },
].map((npc) => {
  const portrait = npcAvatarCatalog[npc.id] || null;
  return {
    ...npc,
    personality: buildNpcPersonality(npc.personality, npc.id),
    avatarImageUrl: portrait,
    portraitImageUrl: portrait,
  };
});

const skills: OfflineSkill[] = [
  { id: skillIds.lqSword, name: "牵潮剑气", description: "以潮息牵引剑气，一线贯穿敌手，是练气期最稳的正面攻势。", skillType: "attack", element: "水", damageBase: 24, damageMultiplier: 1.15, mpCost: 16, cooldown: 1, effects: { effects: [{ type: "speedDown", value: 8, duration: 1, chance: 0.35 }], visualEffect: spriteSkillVisual(iconCatalog.spriteThrust.publicPath, { columns: 5, rows: 3, scale: 0.78, offsetY: -12 }) }, minRealm: 1, maxRealm: 16, target: "enemy" },
  { id: skillIds.lqShield, name: "玄水护体", description: "聚灵水成幕，以灵气先行承压，抵掉一部分本该落到气血上的伤害，是低境界的保命手段。", skillType: "shield", element: "水", damageBase: 0, damageMultiplier: 0, mpCost: 18, cooldown: 2, effects: { effects: [{ type: "shield", value: 35, duration: 2, chance: 1 }], visualEffect: spriteSkillVisual(iconCatalog.spriteBarrier.publicPath, { columns: 6, rows: 8, scale: 0.84, offsetY: -8 }) }, minRealm: 1, maxRealm: 16, target: "self" },
  { id: skillIds.lqTalisman, name: "灵砂符雨", description: "挥符成雨，细而密，适合压制成群同阶敌手。", skillType: "aoe", element: "土", damageBase: 16, damageMultiplier: 0.92, mpCost: 24, cooldown: 3, effects: { effects: [{ type: "defDown", value: 10, duration: 1, chance: 0.3 }], visualEffect: spriteSkillVisual(iconCatalog.spriteLightning.publicPath, { columns: 5, rows: 10, scale: 0.82, offsetY: -6 }) }, minRealm: 1, maxRealm: 16, target: "all_enemies" },
  { id: skillIds.lqNeedle, name: "游丝针诀", description: "细针入脉，伤势不显却会持续发作，适合拉扯与消耗。", skillType: "dot", element: null, damageBase: 12, damageMultiplier: 0.9, mpCost: 14, cooldown: 2, effects: { effects: [{ type: "poison", value: 12, duration: 2, chance: 0.6 }], visualEffect: spriteSkillVisual(iconCatalog.spritePoison.publicPath, { columns: 5, rows: 9, scale: 0.8, offsetY: -6 }) }, minRealm: 2, maxRealm: 14, target: "enemy" },
  { id: skillIds.zjBlade, name: "破煞刀轮", description: "刀势成轮，专破魔煞与防御，是筑基期斩魔第一手。", skillType: "attack", element: "火", damageBase: 42, damageMultiplier: 1.22, mpCost: 24, cooldown: 2, effects: { effects: [{ type: "defDown", value: 16, duration: 1, chance: 0.45 }], visualEffect: spriteSkillVisual(iconCatalog.spriteThrust.publicPath, { columns: 5, rows: 3, scale: 0.92, offsetY: -10 }) }, minRealm: 13, maxRealm: 20, target: "enemy" },
  { id: skillIds.zjSeal, name: "血影符缚", description: "借符意摄魂，令敌气机迟滞、攻势受阻。", skillType: "debuff", element: "暗", damageBase: 18, damageMultiplier: 0.88, mpCost: 26, cooldown: 3, effects: { effects: [{ type: "atkDown", value: 18, duration: 2, chance: 0.55 }], visualEffect: spriteSkillVisual(iconCatalog.spriteLightning.publicPath, { columns: 5, rows: 10, scale: 0.78, offsetY: -4 }) }, minRealm: 13, maxRealm: 20, target: "enemy" },
  { id: skillIds.zjShield, name: "归元盾光", description: "灵光化盾，先抽灵气顶住冲击，再替肉身挡下余波，专为筑基篇高压精英战准备。", skillType: "shield", element: "土", damageBase: 0, damageMultiplier: 0, mpCost: 28, cooldown: 3, effects: { effects: [{ type: "shield", value: 45, duration: 2, chance: 1 }, { type: "defUp", value: 12, duration: 2, chance: 1 }], visualEffect: spriteSkillVisual(iconCatalog.spriteBarrier.publicPath, { columns: 6, rows: 8, scale: 0.9, offsetY: -8 }) }, minRealm: 13, maxRealm: 20, target: "self" },
  { id: skillIds.zjNeedle, name: "穿心针雨", description: "针光密集，最适合收割高攻低防的人形魔修。", skillType: "aoe", element: null, damageBase: 28, damageMultiplier: 1, mpCost: 30, cooldown: 3, effects: { effects: [{ type: "speedDown", value: 14, duration: 1, chance: 0.4 }], visualEffect: spriteSkillVisual(iconCatalog.spriteThrust.publicPath, { columns: 5, rows: 3, scale: 1.02, offsetY: -6 }) }, minRealm: 14, maxRealm: 20, target: "all_enemies" },
  { id: skillIds.jdFire, name: "问心离火", description: "离火照心，不斩肉身先斩杂念，是结丹篇最具主题性的攻法。", skillType: "dot", element: "火", damageBase: 58, damageMultiplier: 1.24, mpCost: 36, cooldown: 2, effects: { effects: [{ type: "burn", value: 24, duration: 2, chance: 0.65 }], visualEffect: spriteSkillVisual(iconCatalog.spriteFire.publicPath, { columns: 5, rows: 10, scale: 0.88, offsetY: -10 }) }, minRealm: 17, maxRealm: 24, target: "enemy" },
  { id: skillIds.jdSeal, name: "戒律剑印", description: "宗门执法一脉惯用术印，能压人心神，也能压人退路。", skillType: "debuff", element: "金", damageBase: 26, damageMultiplier: 0.94, mpCost: 32, cooldown: 3, effects: { effects: [{ type: "stun", value: 1, duration: 1, chance: 0.28 }, { type: "defDown", value: 18, duration: 2, chance: 0.4 }], visualEffect: spriteSkillVisual(iconCatalog.spriteLightning.publicPath, { columns: 5, rows: 10, scale: 0.8, offsetY: -4 }) }, minRealm: 17, maxRealm: 24, target: "enemy" },
  { id: skillIds.jdShield, name: "回尘护魄", description: "以灵息反照魂魄，让灵气先替肉身受难，既是护身术，也是压住心魔的一口气。", skillType: "shield", element: "水", damageBase: 0, damageMultiplier: 0, mpCost: 40, cooldown: 4, effects: { effects: [{ type: "shield", value: 55, duration: 2, chance: 1 }, { type: "regen", value: 18, duration: 2, chance: 1 }], visualEffect: spriteSkillVisual(iconCatalog.spriteBarrier.publicPath, { columns: 6, rows: 8, scale: 0.96, offsetY: -10 }) }, minRealm: 17, maxRealm: 24, target: "self" },
  { id: skillIds.jdMind, name: "幻念蚀魂", description: "心魔系敌人的代表术法，不靠蛮力，而靠层层压迫你自己。", skillType: "dot", element: "暗", damageBase: 40, damageMultiplier: 1.06, mpCost: 34, cooldown: 2, effects: { effects: [{ type: "atkDown", value: 20, duration: 2, chance: 0.5 }, { type: "speedDown", value: 18, duration: 2, chance: 0.4 }], visualEffect: spriteSkillVisual(iconCatalog.spriteSleep.publicPath, { columns: 5, rows: 6, scale: 0.76, offsetY: -2 }) }, minRealm: 18, maxRealm: 24, target: "enemy" },
  { id: skillIds.yySword, name: "镇城剑河", description: "将众人愿力并入剑势，一剑起时如大河横城，是元婴篇核心杀招。", skillType: "aoe", element: "水", damageBase: 88, damageMultiplier: 1.36, mpCost: 52, cooldown: 3, effects: { effects: [{ type: "defDown", value: 22, duration: 2, chance: 0.45 }], visualEffect: spriteSkillVisual(iconCatalog.spriteWater.publicPath, { columns: 5, rows: 10, scale: 1.02, offsetY: -10 }) }, minRealm: 21, maxRealm: null, target: "all_enemies" },
  { id: skillIds.yyWish, name: "众生愿盾", description: "以守城之志化盾，让灵气先承大半杀力，护的不只是自身，而是背后一城凡人。", skillType: "shield", element: "土", damageBase: 0, damageMultiplier: 0, mpCost: 58, cooldown: 4, effects: { effects: [{ type: "shield", value: 65, duration: 2, chance: 1 }, { type: "defUp", value: 20, duration: 2, chance: 1 }], visualEffect: spriteSkillVisual(iconCatalog.spriteBarrier.publicPath, { columns: 6, rows: 8, scale: 1, offsetY: -12 }) }, minRealm: 21, maxRealm: null, target: "self" },
  { id: skillIds.yySeal, name: "照骨灵符", description: "专照魔气与血煞弱点的符术，适合大战中的定点破阵。", skillType: "debuff", element: "光", damageBase: 42, damageMultiplier: 1, mpCost: 46, cooldown: 3, effects: { effects: [{ type: "defDown", value: 28, duration: 2, chance: 0.6 }], visualEffect: spriteSkillVisual(iconCatalog.spriteLightning.publicPath, { columns: 5, rows: 10, scale: 0.9, offsetY: -6 }) }, minRealm: 21, maxRealm: null, target: "enemy" },
  { id: skillIds.yyNeedle, name: "星芒摄魄针", description: "一击直指神魂，是对血罗刹麾下高机动魔修的最好克制。", skillType: "attack", element: null, damageBase: 74, damageMultiplier: 1.28, mpCost: 44, cooldown: 2, effects: { effects: [{ type: "stun", value: 1, duration: 1, chance: 0.24 }, { type: "speedDown", value: 20, duration: 1, chance: 0.4 }], visualEffect: spriteSkillVisual(iconCatalog.spriteTempest.publicPath, { columns: 5, rows: 18, scale: 0.62, offsetY: -14 }) }, minRealm: 22, maxRealm: null, target: "enemy" },
];

function makeStageBenchmark(config: {
  linearRealm: number;
  realmName: string;
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration?: number;
  block?: number;
}) {
  const entry = {
    linearRealm: config.linearRealm,
    realmName: config.realmName,
    maxHp: config.maxHp,
    maxMp: config.maxMp,
    attack: config.attack,
    defense: config.defense,
    speed: config.speed,
    luck: config.luck,
    spiritualSense: config.spiritualSense,
    armorPenetration: config.armorPenetration ?? 0,
    block: config.block ?? 0,
    skillDamageBonus: 0,
    skillDamageReduction: 0,
    artifactDamageBonus: 0,
    artifactDamageReduction: 0,
    combatPower: 0,
  } satisfies StageBenchmark;

  return {
    ...entry,
    combatPower: powerToCombatPower({
      maxHp: entry.maxHp,
      maxMp: entry.maxMp,
      attack: entry.attack,
      defense: entry.defense,
      speed: entry.speed,
      luck: entry.luck,
      spiritualSense: entry.spiritualSense,
      armorPenetration: entry.armorPenetration,
      block: entry.block,
      skillDamageBonus: entry.skillDamageBonus,
      skillDamageReduction: entry.skillDamageReduction,
      artifactDamageBonus: entry.artifactDamageBonus,
      artifactDamageReduction: entry.artifactDamageReduction,
    }),
  };
}

function scaleBenchmarkBase(base: {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
}, multiplier: number) {
  return {
    maxHp: Math.floor(base.maxHp * multiplier),
    maxMp: Math.floor(base.maxMp * multiplier),
    attack: Math.floor(base.attack * multiplier),
    defense: Math.floor(base.defense * multiplier),
    speed: Math.max(base.speed, Math.floor(base.speed * multiplier)),
    luck: Math.max(base.luck, Math.floor(base.luck * multiplier)),
    spiritualSense: base.spiritualSense,
  };
}

const stageBenchmarks: StageBenchmark[] = [
  ...["一层", "二层", "三层", "四层", "五层", "六层", "七层", "八层", "九层", "十层", "十一层", "圆满"]
    .map((name, index) => {
      const stats = scaleBenchmarkBase(
        { maxHp: 300, maxMp: 180, attack: 30, defense: 15, speed: 10, luck: 5, spiritualSense: 1 },
        1 + index * 0.015,
      );
      return makeStageBenchmark({
        linearRealm: index + 1,
        realmName: `练气${name}`,
        ...stats,
      });
    }),
  ...["初期", "中期", "后期", "圆满"]
    .map((name, index) => {
      const stats = scaleBenchmarkBase(
        { maxHp: 620, maxMp: 360, attack: 62, defense: 31, speed: 12, luck: 6, spiritualSense: 3 },
        1 + index * 0.018,
      );
      return makeStageBenchmark({
        linearRealm: 13 + index,
        realmName: `筑基${name}`,
        ...stats,
      });
    }),
  ...["初期", "中期", "后期", "圆满"]
    .map((name, index) => {
      const stats = scaleBenchmarkBase(
        { maxHp: 1280, maxMp: 720, attack: 128, defense: 64, speed: 14, luck: 7, spiritualSense: 6 },
        1 + index * 0.018,
      );
      return makeStageBenchmark({
        linearRealm: 17 + index,
        realmName: `结丹${name}`,
        ...stats,
      });
    }),
  ...["初期", "中期", "后期", "圆满"]
    .map((name, index) => {
      const stats = scaleBenchmarkBase(
        { maxHp: 2560, maxMp: 1440, attack: 256, defense: 128, speed: 16, luck: 8, spiritualSense: 10 },
        1 + index * 0.02,
      );
      return makeStageBenchmark({
        linearRealm: 21 + index,
        realmName: `元婴${name}`,
        ...stats,
      });
    }),
];

function findBenchmark(linearRealm: number) {
  return stageBenchmarks.find((entry) => entry.linearRealm === linearRealm) || stageBenchmarks[0];
}

function scaleMonsterStats(benchmark: StageBenchmark, ratio: number, archetype: "human" | "beast" | "mind") {
  const base = {
    hp: benchmark.maxHp * ratio,
    attack: benchmark.attack * ratio,
    defense: benchmark.defense * ratio,
    speed: benchmark.speed * ratio,
    luck: benchmark.luck * ratio,
    spiritualSense: benchmark.spiritualSense * ratio,
    armorPenetration: benchmark.armorPenetration * ratio,
    block: benchmark.block * ratio,
    skillDamageBonus: benchmark.skillDamageBonus * ratio,
    skillDamageReduction: benchmark.skillDamageReduction * ratio,
    artifactDamageBonus: benchmark.artifactDamageBonus * ratio,
    artifactDamageReduction: benchmark.artifactDamageReduction * ratio,
    mp: benchmark.maxMp * ratio,
  };

  if (archetype === "human") {
    base.hp *= 0.86;
    base.attack *= 1.18;
    base.speed *= 1.12;
    base.defense *= 0.96;
    base.armorPenetration *= 1.18;
    base.block *= 0.82;
  } else if (archetype === "beast") {
    base.hp *= 1.24;
    base.attack *= 1.06;
    base.defense *= 1.08;
    base.speed *= 0.92;
    base.block *= 1.1;
    base.armorPenetration *= 0.92;
  } else {
    base.hp *= 0.96;
    base.attack *= 1.06;
    base.defense *= 0.94;
    base.speed *= 1.02;
    base.spiritualSense *= 1.3;
    base.skillDamageBonus *= 1.3;
    base.skillDamageReduction *= 1.18;
    base.artifactDamageReduction *= 1.12;
  }

  return {
    hp: Math.max(80, Math.floor(base.hp)),
    attack: Math.max(12, Math.floor(base.attack)),
    defense: Math.max(6, Math.floor(base.defense)),
    speed: Math.max(6, Math.floor(base.speed)),
    luck: Math.max(0, Math.floor(base.luck)),
    spiritualSense: Math.max(0, Math.floor(base.spiritualSense)),
    armorPenetration: Math.max(0, Math.floor(base.armorPenetration)),
    block: Math.max(0, Math.floor(base.block)),
    skillDamageBonus: Math.max(0, Math.floor(base.skillDamageBonus)),
    skillDamageReduction: Math.max(0, Math.floor(base.skillDamageReduction)),
    artifactDamageBonus: Math.max(0, Math.floor(base.artifactDamageBonus)),
    artifactDamageReduction: Math.max(0, Math.floor(base.artifactDamageReduction)),
    maxMp: Math.max(0, Math.floor(base.mp)),
  };
}

function makeMonster(config: {
  id: string;
  name: string;
  description: string;
  monsterType: "normal" | "elite" | "boss";
  linearRealm: number;
  ratio: number;
  archetype: "human" | "beast" | "mind";
  iconUrl?: string | null;
  mapId: string;
  positionX: number;
  positionY: number;
  skills: string[];
  dropItemIds: Array<{ itemId: string; chance: number; minQuantity: number; maxQuantity: number }>;
  xpReward: number;
  goldReward: number;
  respawnSeconds: number;
}) {
  const benchmark = findBenchmark(config.linearRealm);
  const stats = scaleMonsterStats(benchmark, config.ratio, config.archetype);
  const defaultIconByArchetype: Record<"human" | "beast" | "mind", string> = {
    human: "/uploads/cosmetics/npc-avatar/1772440528439-a2ba13dd.png",
    beast: "/uploads/cosmetics/monster/1773285328664-1352bdbd.png",
    mind: "/uploads/cosmetics/monster/1773285495109-711aa39d.png",
  };
  const bossOverride = config.monsterType === "boss"
    ? "/uploads/cosmetics/monster/1773285316352-2aca1d38.png"
    : null;
  return {
    id: config.id,
    name: config.name,
    iconUrl: config.iconUrl || bossOverride || defaultIconByArchetype[config.archetype],
    description: config.description,
    monsterType: config.monsterType,
    level: config.linearRealm,
    hp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    luck: stats.luck,
    spiritualSense: stats.spiritualSense,
    armorPenetration: stats.armorPenetration,
    block: stats.block,
    skillDamageBonus: stats.skillDamageBonus,
    skillDamageReduction: stats.skillDamageReduction,
    artifactDamageBonus: stats.artifactDamageBonus,
    artifactDamageReduction: stats.artifactDamageReduction,
    skills: config.skills,
    drops: config.dropItemIds,
    xpReward: 0,
    goldReward: config.goldReward,
    mapId: config.mapId,
    positionX: config.positionX,
    positionY: config.positionY,
    aiMoveIntervalMinSeconds: config.monsterType === "boss" ? null : 12,
    aiMoveIntervalMaxSeconds: config.monsterType === "boss" ? null : 26,
    aiMoveRange: config.monsterType === "boss" ? null : 4,
    respawnSeconds: config.respawnSeconds,
  } satisfies OfflineMonster;
}

const lianqiMaterialIds = stageMaterialIds("lianqi");
const zhujiMaterialIds = stageMaterialIds("zhuji");
const jiedanMaterialIds = stageMaterialIds("jiedan");
const yuanyingMaterialIds = stageMaterialIds("yuanying");
const lianqiElementalMaterialIds = { metal: lianqiMaterialIds[4], wood: lianqiMaterialIds[5], water: lianqiMaterialIds[6], fire: lianqiMaterialIds[7], earth: lianqiMaterialIds[8] } as const;
const zhujiElementalMaterialIds = { metal: zhujiMaterialIds[4], wood: zhujiMaterialIds[5], water: zhujiMaterialIds[6], fire: zhujiMaterialIds[7], earth: zhujiMaterialIds[8] } as const;
const jiedanElementalMaterialIds = { metal: jiedanMaterialIds[4], wood: jiedanMaterialIds[5], water: jiedanMaterialIds[6], fire: jiedanMaterialIds[7], earth: jiedanMaterialIds[8] } as const;
const yuanyingElementalMaterialIds = { metal: yuanyingMaterialIds[5], wood: yuanyingMaterialIds[6], water: yuanyingMaterialIds[7], fire: yuanyingMaterialIds[8], earth: yuanyingMaterialIds[9] } as const;

const monsters: OfflineMonster[] = [
  makeMonster({ id: "mon_four_realms_lq_haitao_lingluo", name: "海潮灵螺", description: "受海雾灵气滋养的低阶水妖，行动缓慢却耐打。", monsterType: "normal", linearRealm: 2, ratio: 0.82, archetype: "beast", mapId: mapIds.penglai, positionX: 12, positionY: 16, skills: [skillIds.lqShield], dropItemIds: [{ itemId: lianqiMaterialIds[0], chance: 0.58, minQuantity: 1, maxQuantity: 2 }], xpReward: 36, goldReward: 14, respawnSeconds: 80 }),
  makeMonster({ id: "mon_four_realms_lq_jinbei_jiaxie", name: "金背礁蟹", description: "常伏在礁石缝里的硬壳妖蟹，蟹背凝出些许庚金寒芒。", monsterType: "normal", linearRealm: 3, ratio: 0.84, archetype: "beast", mapId: mapIds.penglai, positionX: 6, positionY: 12, skills: [skillIds.lqShield], dropItemIds: [{ itemId: lianqiElementalMaterialIds.metal, chance: 0.6, minQuantity: 1, maxQuantity: 2 }], xpReward: 44, goldReward: 16, respawnSeconds: 82 }),
  makeMonster({ id: "mon_four_realms_lq_chanwu_tengyao", name: "缠雾藤妖", description: "海雾里滋生出的藤蔓妖植，会顺着灵气最浓的地方悄悄攀附。", monsterType: "normal", linearRealm: 4, ratio: 0.85, archetype: "beast", mapId: mapIds.qingshili, positionX: 10, positionY: 13, skills: [skillIds.lqTalisman], dropItemIds: [{ itemId: lianqiElementalMaterialIds.wood, chance: 0.62, minQuantity: 1, maxQuantity: 2 }], xpReward: 52, goldReward: 18, respawnSeconds: 84 }),
  makeMonster({ id: "mon_four_realms_lq_heisong_dufeng", name: "黑松毒蜂", description: "被灵气催肥后的毒蜂群，行动迅疾，是练气中段的速度压迫来源。", monsterType: "normal", linearRealm: 5, ratio: 0.86, archetype: "beast", mapId: mapIds.heisonglin, positionX: 15, positionY: 9, skills: [skillIds.lqNeedle], dropItemIds: [{ itemId: lianqiMaterialIds[3], chance: 0.52, minQuantity: 1, maxQuantity: 2 }], xpReward: 62, goldReward: 18, respawnSeconds: 85 }),
  makeMonster({ id: "mon_four_realms_lq_chaoyan_shuipo", name: "潮眼水魄", description: "海雾积成的残灵，平日如一团暗水，临敌时会突然扑面压来。", monsterType: "normal", linearRealm: 6, ratio: 0.88, archetype: "mind", mapId: mapIds.liuduji, positionX: 8, positionY: 11, skills: [skillIds.lqShield], dropItemIds: [{ itemId: lianqiElementalMaterialIds.water, chance: 0.58, minQuantity: 1, maxQuantity: 2 }], xpReward: 74, goldReward: 20, respawnSeconds: 88 }),
  makeMonster({ id: "mon_four_realms_lq_huizao_huoxi", name: "灰灶火蜥", description: "常钻旧灶灰与地缝余热中的小妖，扑杀时带着灼烧灵气。", monsterType: "elite", linearRealm: 7, ratio: 1.08, archetype: "beast", mapId: mapIds.heisonglin, positionX: 7, positionY: 8, skills: [skillIds.lqNeedle, skillIds.lqSword], dropItemIds: [{ itemId: lianqiElementalMaterialIds.fire, chance: 0.72, minQuantity: 1, maxQuantity: 2 }], xpReward: 102, goldReward: 30, respawnSeconds: 110 }),
  makeMonster({ id: "mon_four_realms_lq_jiaoan_jiexiu", name: "礁岸劫修", description: "专挑凡人与弱散修下手的练气散修，出手狠毒，攻高防薄。", monsterType: "elite", linearRealm: 8, ratio: 1.12, archetype: "human", mapId: mapIds.heisonglin, positionX: 18, positionY: 14, skills: [skillIds.lqSword, skillIds.lqNeedle], dropItemIds: [{ itemId: lianqiMaterialIds[1], chance: 0.66, minQuantity: 1, maxQuantity: 2 }], xpReward: 128, goldReward: 36, respawnSeconds: 120 }),
  makeMonster({ id: "mon_four_realms_lq_yanke_tuou", name: "岩壳土偶", description: "被散修粗陋祭法驱动的石偶，走得慢，却很难被正面打穿。", monsterType: "elite", linearRealm: 9, ratio: 1.1, archetype: "mind", mapId: mapIds.shigudong, positionX: 6, positionY: 16, skills: [skillIds.lqShield, skillIds.lqTalisman], dropItemIds: [{ itemId: lianqiElementalMaterialIds.earth, chance: 0.78, minQuantity: 1, maxQuantity: 3 }], xpReward: 138, goldReward: 40, respawnSeconds: 128 }),
  makeMonster({ id: "mon_four_realms_lq_shigu_xunfu", name: "石骨巡蝠", description: "栖在石骨洞深处的异蝠，专趁人受伤时扑击吸血。", monsterType: "elite", linearRealm: 10, ratio: 1.08, archetype: "beast", mapId: mapIds.shigudong, positionX: 11, positionY: 11, skills: [skillIds.lqTalisman], dropItemIds: [{ itemId: lianqiMaterialIds[2], chance: 0.74, minQuantity: 1, maxQuantity: 3 }], xpReward: 146, goldReward: 42, respawnSeconds: 135 }),
  makeMonster({ id: "mon_four_realms_lq_shigudong_jianxiu", name: "练气圆满散修", description: "石骨洞幕后黑手，专抢新入道修士的机缘与命。", monsterType: "boss", linearRealm: 12, ratio: 1.5, archetype: "human", mapId: mapIds.shigudong, positionX: 16, positionY: 18, skills: [skillIds.lqSword, skillIds.lqTalisman, skillIds.lqShield], dropItemIds: [{ itemId: stageItemId("lianqi", "skill_book"), chance: 0.3, minQuantity: 1, maxQuantity: 1 }, { itemId: lianqiMaterialIds[2], chance: 1, minQuantity: 3, maxQuantity: 5 }, { itemId: stageItemId("lianqi", "artifact_signature"), chance: 0.12, minQuantity: 1, maxQuantity: 1 }], xpReward: 320, goldReward: 120, respawnSeconds: 480 }),
  makeMonster({ id: "mon_four_realms_zj_xuewen_yigui", name: "血纹役鬼", description: "被魔修禁制驱使的役鬼，擅长缠斗与消耗。", monsterType: "normal", linearRealm: 13, ratio: 0.8, archetype: "mind", mapId: mapIds.taihang, positionX: 18, positionY: 18, skills: [skillIds.zjSeal], dropItemIds: [{ itemId: zhujiMaterialIds[2], chance: 0.56, minQuantity: 1, maxQuantity: 2 }], xpReward: 180, goldReward: 48, respawnSeconds: 95 }),
  makeMonster({ id: "mon_four_realms_zj_gengsha_tieshi", name: "庚煞铁尸", description: "尸身里被灌入庚金煞气的傀尸，骨硬手狠，最适合拆人兵刃。", monsterType: "normal", linearRealm: 13, ratio: 0.84, archetype: "mind", mapId: mapIds.chisha, positionX: 9, positionY: 15, skills: [skillIds.zjBlade], dropItemIds: [{ itemId: zhujiElementalMaterialIds.metal, chance: 0.6, minQuantity: 1, maxQuantity: 2 }], xpReward: 188, goldReward: 50, respawnSeconds: 96 }),
  makeMonster({ id: "mon_four_realms_zj_liegu_moquan", name: "裂骨魔犬", description: "吞食祭品血肉后的异犬，血厚扑杀猛，是筑基篇的压血线怪。", monsterType: "normal", linearRealm: 14, ratio: 0.88, archetype: "beast", mapId: mapIds.taihang, positionX: 8, positionY: 20, skills: [skillIds.zjBlade], dropItemIds: [{ itemId: zhujiMaterialIds[3], chance: 0.52, minQuantity: 1, maxQuantity: 2 }], xpReward: 196, goldReward: 52, respawnSeconds: 100 }),
  makeMonster({ id: "mon_four_realms_zj_kuteng_shigu", name: "枯藤噬骨藤", description: "地火谷外枯木里滋出的魔藤，最喜顺着伤口汲取血气。", monsterType: "normal", linearRealm: 14, ratio: 0.86, archetype: "beast", mapId: mapIds.taihang, positionX: 12, positionY: 21, skills: [skillIds.zjSeal], dropItemIds: [{ itemId: zhujiElementalMaterialIds.wood, chance: 0.62, minQuantity: 1, maxQuantity: 2 }], xpReward: 204, goldReward: 54, respawnSeconds: 102 }),
  makeMonster({ id: "mon_four_realms_zj_hanquan_yuanling", name: "寒泉怨灵", description: "被献祭者怨气缠在寒泉余脉中生出的水灵，最擅长拖人入持久战。", monsterType: "normal", linearRealm: 15, ratio: 0.9, archetype: "mind", mapId: mapIds.chisha, positionX: 14, positionY: 10, skills: [skillIds.zjShield], dropItemIds: [{ itemId: zhujiElementalMaterialIds.water, chance: 0.6, minQuantity: 1, maxQuantity: 2 }], xpReward: 220, goldReward: 58, respawnSeconds: 110 }),
  makeMonster({ id: "mon_four_realms_zj_yidao_motu", name: "驿道魔徒", description: "伪装成脚夫与行商的魔修外围，出手阴狠，擅长突袭凡人队伍。", monsterType: "elite", linearRealm: 15, ratio: 1.14, archetype: "human", mapId: mapIds.chisha, positionX: 15, positionY: 14, skills: [skillIds.zjBlade, skillIds.zjSeal], dropItemIds: [{ itemId: zhujiMaterialIds[0], chance: 0.72, minQuantity: 1, maxQuantity: 2 }], xpReward: 268, goldReward: 76, respawnSeconds: 140 }),
  makeMonster({ id: "mon_four_realms_zj_lihuo_wugong", name: "离火蜈蚣", description: "常盘在地火缝隙中的异虫，扑出时火毒齐下，是地火谷的危险路障。", monsterType: "elite", linearRealm: 15, ratio: 1.12, archetype: "beast", mapId: mapIds.dihuogu, positionX: 10, positionY: 12, skills: [skillIds.zjNeedle, skillIds.zjBlade], dropItemIds: [{ itemId: zhujiElementalMaterialIds.fire, chance: 0.78, minQuantity: 1, maxQuantity: 2 }], xpReward: 286, goldReward: 80, respawnSeconds: 148 }),
  makeMonster({ id: "mon_four_realms_zj_luzhen_kanshou", name: "炉阵看守", description: "负责看守地火炉阵的魔修，伤害极高，是筑基篇越级教育怪之一。", monsterType: "elite", linearRealm: 16, ratio: 1.22, archetype: "human", mapId: mapIds.dihuogu, positionX: 13, positionY: 9, skills: [skillIds.zjBlade, skillIds.zjNeedle], dropItemIds: [{ itemId: zhujiMaterialIds[1], chance: 0.84, minQuantity: 1, maxQuantity: 3 }], xpReward: 320, goldReward: 88, respawnSeconds: 160 }),
  makeMonster({ id: "mon_four_realms_zj_houtu_mogui", name: "厚土魔傀", description: "用祭品残骨混合矿泥捏成的战傀，行动笨重，却能硬顶多数同阶攻势。", monsterType: "elite", linearRealm: 16, ratio: 1.18, archetype: "mind", mapId: mapIds.dihuogu, positionX: 7, positionY: 18, skills: [skillIds.zjShield], dropItemIds: [{ itemId: zhujiElementalMaterialIds.earth, chance: 0.84, minQuantity: 1, maxQuantity: 3 }], xpReward: 308, goldReward: 86, respawnSeconds: 158 }),
  makeMonster({ id: "mon_four_realms_zj_moxiu_shounao", name: "筑基魔修首脑", description: "以凡人生魂与精血为资粮的主犯，筑基圆满卡级Boss。", monsterType: "boss", linearRealm: 16, ratio: 1.62, archetype: "human", mapId: mapIds.dihuogu, positionX: 18, positionY: 18, skills: [skillIds.zjBlade, skillIds.zjSeal, skillIds.zjShield], dropItemIds: [{ itemId: "item_four_realms_quest_sacrificial_chart", chance: 1, minQuantity: 1, maxQuantity: 1 }, { itemId: stageItemId("zhuji", "skill_book"), chance: 0.34, minQuantity: 1, maxQuantity: 1 }, { itemId: stageItemId("zhuji", "artifact_signature"), chance: 0.12, minQuantity: 1, maxQuantity: 1 }], xpReward: 520, goldReward: 180, respawnSeconds: 600 }),
  makeMonster({ id: "mon_four_realms_jd_xinmo_canying", name: "心魔残影", description: "由犹疑、怨恨与愧疚化出的幻象，不是真敌，却最会伤人。", monsterType: "normal", linearRealm: 17, ratio: 0.84, archetype: "mind", mapId: mapIds.wuhaize, positionX: 14, positionY: 12, skills: [skillIds.jdMind], dropItemIds: [{ itemId: jiedanMaterialIds[3], chance: 0.58, minQuantity: 1, maxQuantity: 2 }], xpReward: 286, goldReward: 82, respawnSeconds: 110 }),
  makeMonster({ id: "mon_four_realms_jd_jinxia_xunren", name: "金霞巡刃", description: "夜河古冢里游离的金气所化，化形如刃，专斩护体不稳之人。", monsterType: "normal", linearRealm: 17, ratio: 0.86, archetype: "human", mapId: mapIds.yehe, positionX: 15, positionY: 7, skills: [skillIds.jdSeal], dropItemIds: [{ itemId: jiedanElementalMaterialIds.metal, chance: 0.6, minQuantity: 1, maxQuantity: 2 }], xpReward: 298, goldReward: 86, respawnSeconds: 112 }),
  makeMonster({ id: "mon_four_realms_jd_zhifa_waiwei", name: "执法堂外门", description: "奉命缉拿的执法修士，立场坚定，不愿听任何情面之辞。", monsterType: "normal", linearRealm: 18, ratio: 0.9, archetype: "human", mapId: mapIds.taihang, positionX: 20, positionY: 9, skills: [skillIds.jdSeal], dropItemIds: [{ itemId: jiedanMaterialIds[2], chance: 0.54, minQuantity: 1, maxQuantity: 2 }], xpReward: 310, goldReward: 90, respawnSeconds: 120 }),
  makeMonster({ id: "mon_four_realms_jd_qingming_mumei", name: "青冥木魅", description: "雾海深处的古木残灵，表面温和，实则最会缠住人的心与路。", monsterType: "normal", linearRealm: 18, ratio: 0.88, archetype: "beast", mapId: mapIds.wuhaize, positionX: 7, positionY: 10, skills: [skillIds.jdMind], dropItemIds: [{ itemId: jiedanElementalMaterialIds.wood, chance: 0.62, minQuantity: 1, maxQuantity: 2 }], xpReward: 320, goldReward: 92, respawnSeconds: 122 }),
  makeMonster({ id: "mon_four_realms_jd_xuanlu_shuimei", name: "玄露水魅", description: "夜河古冢渗出的阴寒露气所化，最擅长拖缓对手节奏。", monsterType: "normal", linearRealm: 18, ratio: 0.9, archetype: "mind", mapId: mapIds.liuduji, positionX: 9, positionY: 18, skills: [skillIds.jdShield], dropItemIds: [{ itemId: jiedanElementalMaterialIds.water, chance: 0.6, minQuantity: 1, maxQuantity: 2 }], xpReward: 332, goldReward: 94, respawnSeconds: 124 }),
  makeMonster({ id: "mon_four_realms_jd_jielv_jianshi", name: "戒律剑侍", description: "执法堂精英弟子，讲规矩，也最擅长用规矩把人逼到墙角。", monsterType: "elite", linearRealm: 19, ratio: 1.12, archetype: "human", mapId: mapIds.liuduji, positionX: 13, positionY: 16, skills: [skillIds.jdSeal, skillIds.jdFire], dropItemIds: [{ itemId: jiedanMaterialIds[0], chance: 0.72, minQuantity: 1, maxQuantity: 2 }], xpReward: 388, goldReward: 112, respawnSeconds: 150 }),
  makeMonster({ id: "mon_four_realms_jd_lixin_yanling", name: "离心焰灵", description: "问心关口最怕的焰灵之一，专烧念头不稳之处。", monsterType: "elite", linearRealm: 19, ratio: 1.16, archetype: "mind", mapId: mapIds.yehe, positionX: 13, positionY: 13, skills: [skillIds.jdFire, skillIds.jdMind], dropItemIds: [{ itemId: jiedanElementalMaterialIds.fire, chance: 0.8, minQuantity: 1, maxQuantity: 2 }], xpReward: 402, goldReward: 116, respawnSeconds: 154 }),
  makeMonster({ id: "mon_four_realms_jd_guanzhao_xinmo", name: "观照心魔", description: "结丹圆满前最危险的无形之敌，会放大你最不愿面对的那一念。", monsterType: "elite", linearRealm: 20, ratio: 1.22, archetype: "mind", mapId: mapIds.yehe, positionX: 10, positionY: 18, skills: [skillIds.jdMind, skillIds.jdShield], dropItemIds: [{ itemId: jiedanMaterialIds[1], chance: 0.88, minQuantity: 1, maxQuantity: 3 }], xpReward: 430, goldReward: 126, respawnSeconds: 160 }),
  makeMonster({ id: "mon_four_realms_jd_kunling_shijiang", name: "坤灵石将", description: "古冢镇墓石俑通灵后成的重甲石将，硬得像一条死规矩。", monsterType: "elite", linearRealm: 20, ratio: 1.2, archetype: "beast", mapId: mapIds.yehe, positionX: 5, positionY: 15, skills: [skillIds.jdShield], dropItemIds: [{ itemId: jiedanElementalMaterialIds.earth, chance: 0.84, minQuantity: 1, maxQuantity: 3 }], xpReward: 424, goldReward: 124, respawnSeconds: 158 }),
  makeMonster({ id: "mon_four_realms_jd_zhinian_xinmo", name: "执念心魔", description: "在病榻与法度之间被逼出的终极幻象，是结丹篇的现实与道心合体Boss。", monsterType: "boss", linearRealm: 20, ratio: 1.56, archetype: "mind", mapId: mapIds.liuduji, positionX: 6, positionY: 19, skills: [skillIds.jdMind, skillIds.jdFire, skillIds.jdSeal], dropItemIds: [{ itemId: "item_four_realms_quest_village_notes", chance: 1, minQuantity: 1, maxQuantity: 1 }, { itemId: stageItemId("jiedan", "skill_book"), chance: 0.34, minQuantity: 1, maxQuantity: 1 }, { itemId: stageItemId("jiedan", "artifact_signature"), chance: 0.12, minQuantity: 1, maxQuantity: 1 }], xpReward: 720, goldReward: 220, respawnSeconds: 660 }),
  makeMonster({ id: "mon_four_realms_yy_hehuan_xuenu", name: "合欢血奴", description: "被炼成行军耗材的魔奴，只会向生者扑咬。", monsterType: "normal", linearRealm: 21, ratio: 0.82, archetype: "mind", mapId: mapIds.qingshili, positionX: 15, positionY: 14, skills: [skillIds.yySeal], dropItemIds: [{ itemId: yuanyingMaterialIds[3], chance: 0.62, minQuantity: 1, maxQuantity: 2 }], xpReward: 420, goldReward: 118, respawnSeconds: 120 }),
  makeMonster({ id: "mon_four_realms_yy_taibai_mofeng", name: "太白魔锋", description: "魔修军中以庚金杀气祭出的飞锋，穿阵时最喜欢先拆前排盾势。", monsterType: "normal", linearRealm: 21, ratio: 0.86, archetype: "human", mapId: mapIds.lietianxu, positionX: 11, positionY: 8, skills: [skillIds.yyNeedle], dropItemIds: [{ itemId: yuanyingElementalMaterialIds.metal, chance: 0.62, minQuantity: 1, maxQuantity: 2 }], xpReward: 436, goldReward: 122, respawnSeconds: 124 }),
  makeMonster({ id: "mon_four_realms_yy_mohua_xuanlang", name: "魔化玄狼", description: "被魔气侵蚀的妖兽，冲阵能力极强，是边锋城城墙外最常见的压迫源。", monsterType: "normal", linearRealm: 22, ratio: 0.9, archetype: "beast", mapId: mapIds.bianfeng, positionX: 17, positionY: 16, skills: [skillIds.yyNeedle], dropItemIds: [{ itemId: yuanyingMaterialIds[4], chance: 0.58, minQuantity: 1, maxQuantity: 2 }], xpReward: 446, goldReward: 124, respawnSeconds: 130 }),
  makeMonster({ id: "mon_four_realms_yy_jianmu_canling", name: "建木残灵", description: "边地古木在魔气与杀伐中扭曲出的残灵，既能缠敌，也会吸走灵力。", monsterType: "normal", linearRealm: 22, ratio: 0.9, archetype: "beast", mapId: mapIds.qingshili, positionX: 9, positionY: 9, skills: [skillIds.yySeal], dropItemIds: [{ itemId: yuanyingElementalMaterialIds.wood, chance: 0.64, minQuantity: 1, maxQuantity: 2 }], xpReward: 458, goldReward: 126, respawnSeconds: 132 }),
  makeMonster({ id: "mon_four_realms_yy_beiming_hanjiao", name: "北溟寒鲛", description: "边海被魔气惊起的寒鲛残魂，来去如流，专擅撕开阵脚。", monsterType: "normal", linearRealm: 22, ratio: 0.92, archetype: "beast", mapId: mapIds.bianfeng, positionX: 12, positionY: 20, skills: [skillIds.yyWish], dropItemIds: [{ itemId: yuanyingElementalMaterialIds.water, chance: 0.62, minQuantity: 1, maxQuantity: 2 }], xpReward: 468, goldReward: 128, respawnSeconds: 134 }),
  makeMonster({ id: "mon_four_realms_yy_caiposhi", name: "合欢采魄使", description: "擅长掠魂夺魄的高机动魔修，专门狩猎散修与负伤修士。", monsterType: "elite", linearRealm: 23, ratio: 1.16, archetype: "human", mapId: mapIds.liuduji, positionX: 17, positionY: 8, skills: [skillIds.yyNeedle, skillIds.yySeal], dropItemIds: [{ itemId: yuanyingMaterialIds[1], chance: 0.72, minQuantity: 1, maxQuantity: 2 }], xpReward: 560, goldReward: 152, respawnSeconds: 160 }),
  makeMonster({ id: "mon_four_realms_yy_zhenyan_liejiu", name: "真炎裂鹫", description: "裂天墟上空盘旋的魔化凶禽，一扑而下时足以把城头烧出豁口。", monsterType: "elite", linearRealm: 23, ratio: 1.18, archetype: "beast", mapId: mapIds.yunmen, positionX: 14, positionY: 5, skills: [skillIds.yySword, skillIds.yySeal], dropItemIds: [{ itemId: yuanyingElementalMaterialIds.fire, chance: 0.8, minQuantity: 1, maxQuantity: 2 }], xpReward: 576, goldReward: 156, respawnSeconds: 164 }),
  makeMonster({ id: "mon_four_realms_yy_xuehe_yaoya", name: "血河妖鸦", description: "成群结阵的高空妖鸦，会在大战中撕开城墙上的薄弱处。", monsterType: "elite", linearRealm: 24, ratio: 1.2, archetype: "beast", mapId: mapIds.yunmen, positionX: 8, positionY: 10, skills: [skillIds.yySword], dropItemIds: [{ itemId: yuanyingMaterialIds[0], chance: 0.8, minQuantity: 1, maxQuantity: 3 }], xpReward: 620, goldReward: 166, respawnSeconds: 170 }),
  makeMonster({ id: "mon_four_realms_yy_houtu_zhanou", name: "后土战傀", description: "魔修军以边地城砖、尸骨与土煞拼起的战傀，是硬吃不得的攻城重器。", monsterType: "elite", linearRealm: 24, ratio: 1.22, archetype: "mind", mapId: mapIds.lietianxu, positionX: 16, positionY: 15, skills: [skillIds.yyWish, skillIds.yySeal], dropItemIds: [{ itemId: yuanyingElementalMaterialIds.earth, chance: 0.84, minQuantity: 1, maxQuantity: 3 }], xpReward: 636, goldReward: 170, respawnSeconds: 176 }),
  makeMonster({ id: "mon_four_realms_yy_xueluosha", name: "血罗刹", description: "合欢宗长老，残忍而狡诈，麾下筑基、结丹魔修与妖兽军皆受其调遣。", monsterType: "boss", linearRealm: 24, ratio: 1.68, archetype: "human", mapId: mapIds.bianfeng, positionX: 18, positionY: 20, skills: [skillIds.yySword, skillIds.yySeal, skillIds.yyNeedle, skillIds.yyWish], dropItemIds: [{ itemId: "item_four_realms_quest_righteous_token", chance: 1, minQuantity: 1, maxQuantity: 1 }, { itemId: stageItemId("yuanying", "skill_book"), chance: 0.4, minQuantity: 1, maxQuantity: 1 }, { itemId: stageItemId("yuanying", "artifact_signature"), chance: 0.14, minQuantity: 1, maxQuantity: 1 }, { itemId: yuanyingMaterialIds[2], chance: 0.75, minQuantity: 1, maxQuantity: 2 }], xpReward: 1080, goldReward: 360, respawnSeconds: 900 }),
];

function makeQuest(config: Omit<OfflineQuest, "questCategory" | "repeatable" | "prerequisites"> & { prerequisites?: string[] }): OfflineQuest {
  return { ...config, questCategory: "main", repeatable: false, prerequisites: config.prerequisites || [] };
}

const mainQuestRewards = {
  small: (_xp: number, gold: number, itemsList: QuestReward["items"] = []) => ({ xp: 0, gold, items: itemsList }),
  medium: (_xp: number, gold: number, itemsList: QuestReward["items"] = []) => ({ xp: 0, gold, items: itemsList }),
  boss: (_xp: number, gold: number, itemsList: QuestReward["items"] = []) => ({ xp: 0, gold, items: itemsList }),
};

const quests: OfflineQuest[] = [
  makeQuest({ id: questIds.lianqi[0], name: "海风第一问", description: "在蓬莱岛正式迈入修仙界，先从认识渔翁与岛上规矩开始。", questType: "talk", acceptNpcId: npcIds.yuweng, completeNpcId: npcIds.yuweng, acceptStory: "渔翁把你领到海边，只问了一句：“你是来求长生，还是先求活命？”", completeStory: "你记下了蓬莱岛的规矩，也知道了在这里没有人会白白护着你。", requirements: [makeTalkRequirement(npcIds.yuweng, "渔翁")], rewards: mainQuestRewards.small(40, 18, [{ itemId: stageItemId("lianqi", "pill_xp"), quantity: 2 }]), minRealm: 1, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[1], name: "海雾药单", description: "替周娘子补齐海雾草，顺带熟悉蓬莱岛外缘与采药路线。", questType: "collect", acceptNpcId: npcIds.zhouniangzi, completeNpcId: npcIds.zhouniangzi, acceptStory: "周娘子把药篓一推，淡淡道：“修士想活得久，先学会把药认全。”", completeStory: "她并未夸你，只是把几枚灵石和两粒凝露丹推了回来，算作你第一次在修仙界换来的报酬。", requirements: [makeCollectRequirement(lianqiMaterialIds[0], "海雾草", 4)], rewards: mainQuestRewards.small(56, 24, [{ itemId: stageItemId("lianqi", "pill_xp"), quantity: 2 }]), prerequisites: [questIds.lianqi[0]], minRealm: 1, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[2], name: "潮湾试锋", description: "清理海湾边缘的海潮灵螺，第一次真正以法术与妖物对抗。", questType: "kill", acceptNpcId: npcIds.dingxunhai, completeNpcId: npcIds.dingxunhai, acceptStory: "丁巡海不肯废话，只把一柄旧刀往你怀里一塞：“能不能活着回来，看你自己的本事。”", completeStory: "第一场小战结束，你的手还在发抖，但也终于明白法术不是用来看的。", requirements: [makeKillRequirement("mon_four_realms_lq_haitao_lingluo", "海潮灵螺", 4)], rewards: mainQuestRewards.small(78, 32, [{ itemId: stageItemId("lianqi", "weapon_blade"), quantity: 1 }]), prerequisites: [questIds.lianqi[1]], minRealm: 2, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[3], name: "黑松林的哭声", description: "黑松林外有人失踪，去找渔翁问路，再把线索带回来。", questType: "talk", acceptNpcId: npcIds.yuweng, completeNpcId: npcIds.zhouniangzi, acceptStory: "渔翁说黑松林里从来不缺狼，也从来不缺比狼更狠的人。", completeStory: "周娘子听完只叹了一声，她知道下一步已经不是单纯的采药活计了。", requirements: [makeTalkRequirement(npcIds.yuweng, "渔翁"), makeTalkRequirement(npcIds.zhouniangzi, "周娘子")], rewards: mainQuestRewards.small(92, 36, [{ itemId: stageItemId("lianqi", "armor_helmet"), quantity: 1 }]), prerequisites: [questIds.lianqi[2]], minRealm: 3, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[4], name: "追索采药人", description: "深入黑松林，清理黑松毒蜂，寻找失踪采药人的踪迹。", questType: "kill", acceptNpcId: npcIds.zhouniangzi, completeNpcId: npcIds.dingxunhai, acceptStory: "周娘子把失踪者名单压在案上，声音不大：“别只把他们当数字。”", completeStory: "丁巡海看见你带回的破布和血迹，脸色越发难看，蓬莱岛外的麻烦已经不是妖患那么简单。", requirements: [makeKillRequirement("mon_four_realms_lq_heisong_dufeng", "黑松毒蜂", 6)], rewards: mainQuestRewards.medium(128, 48, [{ itemId: stageItemId("lianqi", "armor_robe"), quantity: 1 }]), prerequisites: [questIds.lianqi[3]], minRealm: 4, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[5], name: "练气五层·稳脉观潮", description: "把自身修为稳到练气五层，再去碰更深处的人祸。", questType: "detect", acceptNpcId: npcIds.yuweng, completeNpcId: npcIds.yuweng, acceptStory: "渔翁摇头：“再往前，就不是运气能救你的地方了。”", completeStory: "你体内灵力终于稳住，能清楚感到自己不再只是个任人驱使的新手。", requirements: [makeRealmRequirement(linearRealms.lianqi.five)], rewards: mainQuestRewards.medium(120, 52, [{ itemId: stageItemId("lianqi", "pill_break"), quantity: 1 }]), prerequisites: [questIds.lianqi[4]], minRealm: 5, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[6], name: "散修勒索", description: "岛外散修开始明着勒索凡人和小修士，去收集他们留下的令牌与痕迹。", questType: "collect", acceptNpcId: npcIds.dingxunhai, completeNpcId: npcIds.menglao, acceptStory: "丁巡海压低声音：“我能拦一次，拦不了第二次。证据得有人带回来。”", completeStory: "孟老认出了令牌上的刻痕，那不是普通散修，而是惯于夺宝杀人的一伙亡命徒。", requirements: [makeCollectRequirement(lianqiMaterialIds[1], "潮纹寒铁", 3)], rewards: mainQuestRewards.medium(148, 60, [{ itemId: stageItemId("lianqi", "weapon_sword"), quantity: 1 }]), prerequisites: [questIds.lianqi[5]], minRealm: 5, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[7], name: "护住渔村老小", description: "礁岸劫修开始对凡人下手，必须先挡住这一波袭扰。", questType: "kill", acceptNpcId: npcIds.menglao, completeNpcId: npcIds.yuweng, acceptStory: "孟老把炉火压下去，只说了四个字：“先保住人。”", completeStory: "渔翁看着那些惊魂未定的凡人，第一次正面告诉你：弱的时候，善意会被当作价码。", requirements: [makeKillRequirement("mon_four_realms_lq_jiaoan_jiexiu", "礁岸劫修", 4)], rewards: mainQuestRewards.medium(188, 72, [{ itemId: stageItemId("lianqi", "artifact_talisman"), quantity: 1 }]), prerequisites: [questIds.lianqi[6]], minRealm: 6, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[8], name: "石骨洞前的血迹", description: "顺着散修踪迹追到石骨洞，先把洞外残留的证据带回来。", questType: "collect", acceptNpcId: npcIds.yuweng, completeNpcId: npcIds.dingxunhai, acceptStory: "渔翁望着石骨洞的方向，罕见地沉默了片刻：“里面那位，专挑好欺负的下手。”", completeStory: "丁巡海看着洞口带回的残骨和血迹，终于确定这一切早就不是临时起意。", requirements: [makeCollectRequirement(lianqiMaterialIds[2], "石骨碎片", 5)], rewards: mainQuestRewards.medium(210, 78, [{ itemId: stageItemId("lianqi", "artifact_shield"), quantity: 1 }]), prerequisites: [questIds.lianqi[7]], minRealm: 8, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[9], name: "洞中遗箓", description: "深入石骨洞，击退巡蝠，拼出散修的夺宝与杀人证据。", questType: "kill", acceptNpcId: npcIds.dingxunhai, completeNpcId: npcIds.yuweng, acceptStory: "丁巡海把退路给你看得很清楚：“打不过就撤，但证据一定要带出来。”", completeStory: "你拼出那些破碎手札，终于知道幕后黑手是如何一步步逼死弱者的。", requirements: [makeKillRequirement("mon_four_realms_lq_shigu_xunfu", "石骨巡蝠", 3)], rewards: mainQuestRewards.medium(236, 88, [{ itemId: stageItemId("lianqi", "skill_book"), quantity: 1 }]), prerequisites: [questIds.lianqi[8]], minRealm: 9, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[10], name: "洞底恶客", description: "直面盘踞石骨洞的练气圆满散修，为凡人与散修讨一个说法。", questType: "kill", acceptNpcId: npcIds.yuweng, completeNpcId: npcIds.yuweng, acceptStory: "渔翁把旧灯递给你：“去吧，这次不是为了灵石，是为了让他们知道凡人也不是想杀就杀。”", completeStory: "散修伏诛，洞底只剩潮声与血味。你第一次真正看见修仙界最冷的那一面。", requirements: [makeKillRequirement("mon_four_realms_lq_shigudong_jianxiu", "练气圆满散修", 1)], rewards: mainQuestRewards.boss(360, 120, [{ itemId: stageItemId("lianqi", "artifact_signature"), quantity: 1 }]), prerequisites: [questIds.lianqi[9]], minRealm: 11, maxRealm: null }),
  makeQuest({ id: questIds.lianqi[11], name: "练气圆满·人心如刃", description: "把修为稳到练气圆满，收束初入修仙界这一章，也正式认清“实力为王”的真相。", questType: "detect", acceptNpcId: npcIds.yuweng, completeNpcId: npcIds.yuweng, acceptStory: "渔翁说，记住今天不是为了学会冷血，而是为了以后有资格不冷血。", completeStory: "你站在海风里，终于明白修仙界的人心比石骨洞更阴冷。若无实力，善意只会被人拿来践踏。", requirements: [makeRealmRequirement(linearRealms.lianqi.perfection)], rewards: mainQuestRewards.boss(280, 96, [{ itemId: stageItemId("zhuji", "pill_break"), quantity: 1 }]), prerequisites: [questIds.lianqi[10]], minRealm: 12, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[0], name: "太行山来信", description: "王二狗带着凡人失踪的消息赶到，请你前往太行山右线探查真相。", questType: "talk", acceptNpcId: npcIds.wangergou, completeNpcId: npcIds.wangergou, acceptStory: "王二狗攥着带血麻绳，第一句话便是：“仙长，凡人也是命。”", completeStory: "你接下这桩事，不只是因为魔修，更因为那句“凡人也是命”让你想起了蓬莱岛曾经护住的那些人。", requirements: [makeTalkRequirement(npcIds.wangergou, "王二狗")], rewards: mainQuestRewards.small(180, 72, [{ itemId: "item_four_realms_quest_magic_rope", quantity: 1 }]), prerequisites: [questIds.lianqi[11]], minRealm: 13, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[1], name: "凶蜂阻道", description: "先清掉太行山右线阻路的异蜂群，替后续搜救打开通路。", questType: "kill", acceptNpcId: npcIds.wangergou, completeNpcId: npcIds.jiangwangbei, acceptStory: "王二狗知道自己打不过，只能把希望压在你身上。", completeStory: "江望北听完路况汇报，只说驿路还能守一阵，但人命未必等得起。", requirements: [makeKillRequirement("mon_four_realms_zj_liegu_moquan", "裂骨魔犬", 4)], rewards: mainQuestRewards.small(220, 84, [{ itemId: stageItemId("zhuji", "weapon_sword"), quantity: 1 }]), prerequisites: [questIds.zhuji[0]], minRealm: 13, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[2], name: "血迹向右岭", description: "沿血迹搜索，收集凡人被掳后留下的痕迹与绳结。", questType: "collect", acceptNpcId: npcIds.jiangwangbei, completeNpcId: npcIds.jiangwangbei, acceptStory: "江望北把路线画得很清楚：“我要的是证据，不是猜测。”", completeStory: "证据越来越多，太行山右线失踪案终于从流言变成了一条明确的魔修链路。", requirements: [makeCollectRequirement("item_four_realms_quest_magic_rope", "带血麻绳", 1), makeCollectRequirement(zhujiMaterialIds[2], "血纹符皮", 3)], rewards: mainQuestRewards.small(238, 90, [{ itemId: stageItemId("zhuji", "armor_robe"), quantity: 1 }]), prerequisites: [questIds.zhuji[1]], minRealm: 13, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[3], name: "凡人之命", description: "回去告诉王二狗查到的真相，决定继续追下去。", questType: "talk", acceptNpcId: npcIds.wangergou, completeNpcId: npcIds.wangergou, acceptStory: "你本以为王二狗会退缩，他却只是红着眼问：“还能救回来几个？”", completeStory: "他的执拗让你意识到，凡人没有修为，却一样会把未来押在别人的选择上。", requirements: [makeTalkRequirement(npcIds.wangergou, "王二狗")], rewards: mainQuestRewards.small(210, 80, [{ itemId: stageItemId("zhuji", "pill_xp"), quantity: 3 }]), prerequisites: [questIds.zhuji[2]], minRealm: 14, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[4], name: "赤砂驿借道", description: "去赤砂驿补给，顺带打通地火谷的前线补给线。", questType: "talk", acceptNpcId: npcIds.jiangwangbei, completeNpcId: npcIds.rendanniang, acceptStory: "江望北给了你一块临时行牌：“进谷后别讲义气，先讲效率。”", completeStory: "任丹娘接过行牌，立刻开始清点地火谷还能调动的丹材与火候。", requirements: [makeTalkRequirement(npcIds.jiangwangbei, "江望北"), makeTalkRequirement(npcIds.rendanniang, "任丹娘")], rewards: mainQuestRewards.medium(236, 96, [{ itemId: stageItemId("zhuji", "pill_heal"), quantity: 2 }]), prerequisites: [questIds.zhuji[3]], minRealm: 14, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[5], name: "筑基中期·炉火观形", description: "在进谷之前先把修为稳到筑基中期，别拿自己和凡人的命去赌。", questType: "detect", acceptNpcId: npcIds.rendanniang, completeNpcId: npcIds.rendanniang, acceptStory: "任丹娘看你一眼：“还差一点火候，强闯地火谷只会多添一具尸体。”", completeStory: "你稳住了体内灵力流转，终于能承受地火谷里的炽烈火脉。", requirements: [makeRealmRequirement(linearRealms.zhuji.middle)], rewards: mainQuestRewards.medium(240, 100, [{ itemId: stageItemId("zhuji", "pill_break"), quantity: 1 }]), prerequisites: [questIds.zhuji[4]], minRealm: 14, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[6], name: "驿路补给线", description: "击退驿道魔徒，替凡人与补给车队守住进谷路线。", questType: "kill", acceptNpcId: npcIds.jiangwangbei, completeNpcId: npcIds.jiangwangbei, acceptStory: "江望北把刀按在桌上：“你要救人，先把这条路守住。”", completeStory: "驿路暂时稳住，赤砂驿终于能把药与符送向地火谷。", requirements: [makeKillRequirement("mon_four_realms_zj_yidao_motu", "驿道魔徒", 5)], rewards: mainQuestRewards.medium(280, 110, [{ itemId: stageItemId("zhuji", "weapon_blade"), quantity: 1 }]), prerequisites: [questIds.zhuji[5]], minRealm: 15, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[7], name: "地火谷外的囚笼", description: "收集地火谷外散落的囚具与阴魂骨，确认献祭不是单点恶案。", questType: "collect", acceptNpcId: npcIds.rendanniang, completeNpcId: npcIds.chiyan, acceptStory: "任丹娘把药囊塞给你：“把该带回来的证据全带回来。”", completeStory: "池焰看着那几副囚具，拳头握得发白，终于彻底相信地火被人拿来炼命。", requirements: [makeCollectRequirement(zhujiMaterialIds[3], "阴魂骨", 4)], rewards: mainQuestRewards.medium(296, 116, [{ itemId: stageItemId("zhuji", "artifact_shield"), quantity: 1 }]), prerequisites: [questIds.zhuji[6]], minRealm: 15, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[8], name: "炉阵下的生魂符", description: "清理役鬼，夺取生魂符纹，证明魔修确实以献祭增修。", questType: "kill", acceptNpcId: npcIds.chiyan, completeNpcId: npcIds.chiyan, acceptStory: "池焰压着火气说：“今天不是炼器，是收尸。”", completeStory: "你从役鬼体内剖出了生魂符纹，所有猜测都在这一刻坐实。", requirements: [makeKillRequirement("mon_four_realms_zj_xuewen_yigui", "血纹役鬼", 6)], rewards: mainQuestRewards.medium(320, 124, [{ itemId: stageItemId("zhuji", "artifact_talisman"), quantity: 1 }]), prerequisites: [questIds.zhuji[7]], minRealm: 15, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[9], name: "献祭阵图", description: "夺下献祭阵图，这是之后斩魔定罪的最关键一环。", questType: "collect", acceptNpcId: npcIds.chiyan, completeNpcId: npcIds.jiangwangbei, acceptStory: "池焰说，只要阵图还在，魔修就还能继续抓人。", completeStory: "江望北把阵图摊开，驿丞第一次露出真正的杀气。", requirements: [makeCollectRequirement("item_four_realms_quest_sacrificial_chart", "献祭阵图", 1)], rewards: mainQuestRewards.medium(340, 132, [{ itemId: stageItemId("zhuji", "armor_helmet"), quantity: 1 }]), prerequisites: [questIds.zhuji[8]], minRealm: 16, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[10], name: "夜破献祭台", description: "乘夜突袭祭坛，先斩掉炉阵看守，打乱献祭节奏。", questType: "kill", acceptNpcId: npcIds.jiangwangbei, completeNpcId: npcIds.chiyan, acceptStory: "江望北说得很干脆：“今晚不动手，明早就会多一批死人。”", completeStory: "看守被斩，祭坛阵序开始紊乱，谷中囚犯终于有了生机。", requirements: [makeKillRequirement("mon_four_realms_zj_luzhen_kanshou", "炉阵看守", 2)], rewards: mainQuestRewards.medium(360, 142, [{ itemId: stageItemId("zhuji", "weapon_needle"), quantity: 1 }]), prerequisites: [questIds.zhuji[9]], minRealm: 16, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[11], name: "营救凡人", description: "把被关押的凡人送出谷外，并亲口把他们交回活人手里。", questType: "talk", acceptNpcId: npcIds.wangergou, completeNpcId: npcIds.wangergou, acceptStory: "王二狗不肯躲在后面，他坚持要亲自认人、亲自接人。", completeStory: "你把活着的人带回来时，王二狗哭得像个孩子，却又笑得像捡回了整个世界。", requirements: [makeTalkRequirement(npcIds.wangergou, "王二狗")], rewards: mainQuestRewards.medium(320, 126, [{ itemId: stageItemId("zhuji", "armor_shoes"), quantity: 1 }]), prerequisites: [questIds.zhuji[10]], minRealm: 16, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[12], name: "斩落魔首", description: "直捣谷底，击败筑基魔修首脑，为这条献祭链做一个了断。", questType: "kill", acceptNpcId: npcIds.chiyan, completeNpcId: npcIds.wangergou, acceptStory: "池焰把谷火暂时压住，给你争来最后的窗口：“去，把账算清。”", completeStory: "魔首倒下，献祭链条断裂。被救出的凡人看着你和王二狗，第一次真正相信修士也能为他们而战。", requirements: [makeKillRequirement("mon_four_realms_zj_moxiu_shounao", "筑基魔修首脑", 1)], rewards: mainQuestRewards.boss(560, 188, [{ itemId: stageItemId("zhuji", "artifact_signature"), quantity: 1 }]), prerequisites: [questIds.zhuji[11]], minRealm: 16, maxRealm: null }),
  makeQuest({ id: questIds.zhuji[13], name: "筑基圆满·凡人亦命", description: "把修为稳到筑基圆满，收束这一章，也把“凡人也是命”刻进后面的路。", questType: "detect", acceptNpcId: npcIds.wangergou, completeNpcId: npcIds.wangergou, acceptStory: "王二狗郑重其事地给你磕了个头，却又说自己只是一个凡人，受不起仙长的恩。", completeStory: "你第一次真正明白，救人不是施舍，而是在替自己的道心立一根不肯后退的骨头。", requirements: [makeRealmRequirement(linearRealms.zhuji.perfection)], rewards: mainQuestRewards.boss(360, 140, [{ itemId: stageItemId("jiedan", "pill_break"), quantity: 1 }]), prerequisites: [questIds.zhuji[12]], minRealm: 16, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[0], name: "左岭旧路", description: "沿太行山左线重走旧路，看看那些当年被你救下的人都过成了什么样。", questType: "talk", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.liuniang, acceptStory: "柳娘替你温了一壶酒，只说：“有些人情，迟早得回头看看。”", completeStory: "左线风景未变，人却都老了。你开始意识到修士的一次善念，会在凡人一生里发酵很久。", requirements: [makeTalkRequirement(npcIds.liuniang, "柳娘")], rewards: mainQuestRewards.small(360, 140, [{ itemId: stageItemId("jiedan", "pill_xp"), quantity: 2 }]), prerequisites: [questIds.zhuji[13]], minRealm: 17, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[1], name: "再见王二狗", description: "去见已经垂暮的王二狗，听他讲这些年凡人的生活与选择。", questType: "talk", acceptNpcId: npcIds.oldWang, completeNpcId: npcIds.oldWang, acceptStory: "白发苍苍的王二狗一眼就认出了你，仿佛几十年不过转身之间。", completeStory: "他没有抱怨命苦，只是认真告诉你：凡人虽无灵根，也可以把日子过得堂堂正正。", requirements: [makeTalkRequirement(npcIds.oldWang, "垂暮王二狗")], rewards: mainQuestRewards.small(388, 148, [{ itemId: "item_four_realms_quest_village_notes", quantity: 1 }]), prerequisites: [questIds.jiedan[0]], minRealm: 17, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[2], name: "乡塾灯火", description: "帮王二狗收拢旧札，看看他如何把仙人的恩情化成凡人之间的善。", questType: "collect", acceptNpcId: npcIds.oldWang, completeNpcId: npcIds.liuniang, acceptStory: "王二狗把发黄的旧纸放到你手里，笑说自己这一生没白活。", completeStory: "柳娘翻着这些旧札，轻轻叹道：“有些人没有灵根，却活得比许多修士更像个人。”", requirements: [makeCollectRequirement("item_four_realms_quest_village_notes", "乡塾旧札", 1)], rewards: mainQuestRewards.small(412, 156, [{ itemId: stageItemId("jiedan", "armor_robe"), quantity: 1 }]), prerequisites: [questIds.jiedan[1]], minRealm: 17, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[3], name: "冢前白纸钱", description: "夜河古冢怨气翻涌，去清掉扰人的心魔残影。", questType: "kill", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.liuniang, acceptStory: "柳娘说近来夜河古冢老有人梦魇，像是旧因果在找上门来。", completeStory: "你斩掉几道心魔残影，心里却一点也不轻松，因为它们喊出的全是你最熟悉的话。", requirements: [makeKillRequirement("mon_four_realms_jd_xinmo_canying", "心魔残影", 4)], rewards: mainQuestRewards.small(438, 164, [{ itemId: stageItemId("jiedan", "pill_heal"), quantity: 2 }]), prerequisites: [questIds.jiedan[2]], minRealm: 17, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[4], name: "结丹中期·照见旧因", description: "先把修为稳到结丹中期，再继续面对那些你欠下或得到的人情账。", questType: "detect", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.liuniang, acceptStory: "柳娘说有些人情不怕晚，就怕你自己先没本事扛。", completeStory: "你能明显感觉到心神更稳了，也终于不再轻易被旧事拖走全部情绪。", requirements: [makeRealmRequirement(linearRealms.jiedan.middle)], rewards: mainQuestRewards.small(420, 168, [{ itemId: stageItemId("jiedan", "pill_break"), quantity: 1 }]), prerequisites: [questIds.jiedan[3]], minRealm: 18, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[5], name: "柳渡旧恩", description: "回柳渡集理清旧账，看看昔日种下的善念都落到了谁身上。", questType: "talk", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.oldWang, acceptStory: "柳娘报了几个人名，都是曾被你顺手救过的凡人或散修。", completeStory: "你发现所谓“昔日善果”并不华丽，不过是一家火没断、一条路还在、一群孩子能继续念书。", requirements: [makeTalkRequirement(npcIds.oldWang, "垂暮王二狗"), makeTalkRequirement(npcIds.liuniang, "柳娘")], rewards: mainQuestRewards.medium(450, 176, [{ itemId: stageItemId("jiedan", "weapon_sword"), quantity: 1 }]), prerequisites: [questIds.jiedan[4]], minRealm: 18, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[6], name: "人情账", description: "在柳渡集与凡人村落之间收拢旧信与旧账，拼出一条完整的人情线。", questType: "collect", acceptNpcId: npcIds.oldWang, completeNpcId: npcIds.liuniang, acceptStory: "王二狗把名单写得很认真，说自己一生没什么能拿得出手，只能把这份心意留下。", completeStory: "这些旧账单、书信与借据加起来，比任何天材地宝都更像“活过”的证据。", requirements: [makeCollectRequirement(jiedanMaterialIds[0], "雾海灵莲", 3), makeCollectRequirement(jiedanMaterialIds[2], "戒律玄铁", 2)], rewards: mainQuestRewards.medium(474, 184, [{ itemId: stageItemId("jiedan", "artifact_talisman"), quantity: 1 }]), prerequisites: [questIds.jiedan[5]], minRealm: 18, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[7], name: "柳渡余温", description: "回客栈与柳娘对话，确认有人已经盯上你与王二狗这条线。", questType: "talk", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.liuniang, acceptStory: "柳娘这次没劝你避事，只是提醒你执法堂的人已经在查。", completeStory: "话说到这里，你终于知道那场真正的冲突已经不远了。", requirements: [makeTalkRequirement(npcIds.liuniang, "柳娘")], rewards: mainQuestRewards.medium(468, 188, [{ itemId: stageItemId("jiedan", "armor_helmet"), quantity: 1 }]), prerequisites: [questIds.jiedan[6]], minRealm: 18, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[8], name: "李师兄到来", description: "与李师兄见面，听他说明执法堂立场，也正视你与宗门的冲突。", questType: "talk", acceptNpcId: npcIds.lishixiong, completeNpcId: npcIds.lishixiong, acceptStory: "李师兄见到你后先沉默，再叹气：“师门法度如此，我来之前就知道这趟不好做。”", completeStory: "他没有黑化，也没有退让。你第一次真正面对一个既是故人又是对手的人。", requirements: [makeTalkRequirement(npcIds.lishixiong, "李师兄")], rewards: mainQuestRewards.medium(488, 196, [{ itemId: stageItemId("jiedan", "pill_xp"), quantity: 3 }]), prerequisites: [questIds.jiedan[7]], minRealm: 19, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[9], name: "戒律压境", description: "执法堂弟子开始逼近柳渡集，你必须先挡住这一轮现实压力。", questType: "kill", acceptNpcId: npcIds.lishixiong, completeNpcId: npcIds.liuniang, acceptStory: "李师兄没有拔剑，只是告诉你下面的人不会像他这样留情。", completeStory: "你击退了第一批执法弟子，却也等于把事态彻底推到了无法回头的位置。", requirements: [makeKillRequirement("mon_four_realms_jd_zhifa_waiwei", "执法堂外门", 6)], rewards: mainQuestRewards.medium(520, 208, [{ itemId: stageItemId("jiedan", "weapon_blade"), quantity: 1 }]), prerequisites: [questIds.jiedan[8]], minRealm: 19, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[10], name: "心魔初生", description: "在雾海泽与夜河古冢之间清理渐起的心魔残影。", questType: "kill", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.lishixiong, acceptStory: "柳娘看得很明白，你现在最怕的不是别人，而是你自己那一点动摇。", completeStory: "李师兄看出你心神不稳，却只能装作没看见，因为他同样被规矩困住。", requirements: [makeKillRequirement("mon_four_realms_jd_xinmo_canying", "心魔残影", 6)], rewards: mainQuestRewards.medium(548, 216, [{ itemId: stageItemId("jiedan", "artifact_shield"), quantity: 1 }]), prerequisites: [questIds.jiedan[9]], minRealm: 19, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[11], name: "结丹后期·守心如一", description: "再进一步，把修为稳到结丹后期，否则你还撑不起后面的选择。", questType: "detect", acceptNpcId: npcIds.lishixiong, completeNpcId: npcIds.lishixiong, acceptStory: "李师兄明知你将来会与执法堂起冲突，却仍旧希望你别死在心魔前。", completeStory: "你稳住了神魂波动，终于没有在对峙前先被自己击垮。", requirements: [makeRealmRequirement(linearRealms.jiedan.late)], rewards: mainQuestRewards.medium(520, 200, [{ itemId: stageItemId("jiedan", "pill_break"), quantity: 1 }]), prerequisites: [questIds.jiedan[10]], minRealm: 19, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[12], name: "病榻前夜", description: "回王二狗家中守最后一夜，把话说完，也把心里最重的事面对完。", questType: "talk", acceptNpcId: npcIds.oldWang, completeNpcId: npcIds.oldWang, acceptStory: "王二狗已近油尽灯枯，却还惦记着有没有给你添麻烦。", completeStory: "你陪他坐了一夜，外面是执法堂的脚步声，屋里只剩凡人一生的谢意。", requirements: [makeTalkRequirement(npcIds.oldWang, "垂暮王二狗")], rewards: mainQuestRewards.medium(540, 206, [{ itemId: stageItemId("jiedan", "skill_book"), quantity: 1 }]), prerequisites: [questIds.jiedan[11]], minRealm: 19, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[13], name: "结丹圆满·问心关", description: "把修为推进到结丹圆满，真正站到“心中道义”与“宗门规矩”之间。", questType: "detect", acceptNpcId: npcIds.oldWang, completeNpcId: npcIds.oldWang, acceptStory: "凡人的寿数已经快走到尽头，你却还要在这一夜里做完自己的决定。", completeStory: "结丹圆满的门槛已经在眼前，而你比任何时候都清楚，下一步不是修为问题，而是你肯不肯承认自己的心。", requirements: [makeRealmRequirement(linearRealms.jiedan.perfection)], rewards: mainQuestRewards.medium(560, 214, [{ itemId: stageItemId("jiedan", "artifact_signature"), quantity: 1 }]), prerequisites: [questIds.jiedan[12]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.jiedan[14], name: "病榻诀别", description: "在病榻前与李师兄及执法堂对峙，守住凡人善念，并在心魔撕扯中完成固定正史结丹。", questType: "kill", acceptNpcId: npcIds.lishixiong, completeNpcId: npcIds.oldWang, acceptStory: "李师兄最后一次劝你随他回去，你却知道今日若退，往后便再没有资格说自己修的是道义。", completeStory: "你没有交人，也没有让路。王二狗在人世的最后一眼看见的，是你替他守住了那句“凡人也有未来”。心魔随之化形，你在巨大的撕扯中结丹成功。", requirements: [makeKillRequirement("mon_four_realms_jd_zhinian_xinmo", "执念心魔", 1), makeTalkRequirement(npcIds.oldWang, "垂暮王二狗")], rewards: mainQuestRewards.boss(860, 280, [{ itemId: stageItemId("yuanying", "pill_break"), quantity: 1 }]), prerequisites: [questIds.jiedan[13]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[0], name: "青石里求援", description: "先去青石里，确认魔修兵锋已经压到散修隐居之所。", questType: "talk", acceptNpcId: npcIds.yunlao, completeNpcId: npcIds.yunlao, acceptStory: "青石里遍地焦痕，云老看着你时满是羞惭与后悔。", completeStory: "你知道这已不是一个村、一条路的事情，而是整片凡俗地界都在被吞。", rewards: mainQuestRewards.small(620, 240, [{ itemId: stageItemId("yuanying", "pill_xp"), quantity: 2 }]), requirements: [makeTalkRequirement(npcIds.yunlao, "云老")], prerequisites: [questIds.jiedan[14]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[1], name: "迟来的尸首", description: "收拢青石里残存的血河魔髓与焦黑残片，确认魔修军的行进方式。", questType: "collect", acceptNpcId: npcIds.yunlao, completeNpcId: npcIds.liuniang, acceptStory: "云老把记录魔修弱点的玉简托给你，喃喃道自己错得太久了。", completeStory: "你带着焦黑残片回到柳渡集，终于拼出了合欢宗魔修军的推进脉络。", rewards: mainQuestRewards.small(648, 248, [{ itemId: yuanyingMaterialIds[3], quantity: 2 }]), requirements: [makeCollectRequirement(yuanyingMaterialIds[3], "血河魔髓", 3)], prerequisites: [questIds.yuanying[0]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[2], name: "柳渡集的火光", description: "回柳渡集与柳娘合流，确认第二处要地也已被魔修盯上。", questType: "talk", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.liuniang, acceptStory: "柳娘照旧给你倒酒，却把门外的求援名单一张张排开。", completeStory: "柳渡集还能守一阵，但若无人统合，各路散修只会各自溃散。", rewards: mainQuestRewards.small(676, 256, [{ itemId: stageItemId("yuanying", "pill_heal"), quantity: 2 }]), requirements: [makeTalkRequirement(npcIds.liuniang, "柳娘")], prerequisites: [questIds.yuanying[1]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[3], name: "城门未闭", description: "赶到边锋城，与岳定山会面，确认凡人军仍在守城。", questType: "talk", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "岳定山明知守不住，却还是把城门守得笔直：“城在人在。”", completeStory: "你第一次真正意识到，凡人的勇气也足以照亮修仙者的道心。", rewards: mainQuestRewards.small(710, 266, [{ itemId: stageItemId("yuanying", "armor_robe"), quantity: 1 }]), requirements: [makeTalkRequirement(npcIds.yuedingshan, "岳定山")], prerequisites: [questIds.yuanying[2]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[4], name: "妖崽入城", description: "救下被追杀的阿狸，并说服城中人暂时收留这只妖狐幼崽。", questType: "talk", acceptNpcId: npcIds.ali, completeNpcId: npcIds.ali, acceptStory: "阿狸浑身是血缩在角落里，明明是妖，却比城外那些魔修更像个无辜的孩子。", completeStory: "你伸手抱起阿狸时，终于意识到这场守护从来不分人妖。", rewards: mainQuestRewards.small(736, 274, [{ itemId: yuanyingMaterialIds[4], quantity: 2 }]), requirements: [makeTalkRequirement(npcIds.ali, "阿狸")], prerequisites: [questIds.yuanying[3]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[5], name: "结丹圆满·守城前夜", description: "把修为稳在结丹圆满，把所有可用的人与物都先聚拢起来。", questType: "detect", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "岳定山看着你只问了一句：“仙长，你会走吗？”", completeStory: "你没有等宗门命令，而是决定留下。自此，元婴篇正式从“求仙”转向“护众生”。", rewards: mainQuestRewards.medium(720, 280, [{ itemId: stageItemId("yuanying", "pill_break"), quantity: 1 }]), requirements: [makeRealmRequirement(linearRealms.jiedan.perfection)], prerequisites: [questIds.yuanying[4]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[6], name: "整合流亡散修", description: "先在柳渡集与边锋城之间招拢还愿意战的散修。", questType: "talk", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.yuedingshan, acceptStory: "柳娘把散修名单全交给你，说她能做的已经不多，剩下看你敢不敢扛。", completeStory: "你把一群彼此不信任的散修先聚到了一起，这比杀几头妖兽更难。", rewards: mainQuestRewards.medium(760, 292, [{ itemId: stageItemId("yuanying", "weapon_sword"), quantity: 1 }]), requirements: [makeTalkRequirement(npcIds.liuniang, "柳娘"), makeTalkRequirement(npcIds.yuedingshan, "岳定山")], prerequisites: [questIds.yuanying[5]], minRealm: 20, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[7], name: "凡人也是壁垒", description: "训练凡人士兵与民兵，让边锋城真正具备守上一战的骨架。", questType: "talk", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "岳定山把八百子弟兵交到你面前，意思很明白：仙人若不退，他也绝不退。", completeStory: "你发现凡人的勇气并不比修士弱，他们缺的只是有人愿意站在前面把战法讲明白。", rewards: mainQuestRewards.medium(786, 300, [{ itemId: stageItemId("yuanying", "armor_helmet"), quantity: 1 }]), requirements: [makeTalkRequirement(npcIds.yuedingshan, "岳定山")], prerequisites: [questIds.yuanying[6]], minRealm: 21, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[8], name: "妖兽也可守城", description: "借阿狸的感知去联络尚未彻底魔化的妖兽幼崽与边地灵兽。", questType: "talk", acceptNpcId: npcIds.ali, completeNpcId: npcIds.ali, acceptStory: "阿狸蹭着你的袖口，像是在用最直接的方式告诉你：它们也想活。", completeStory: "你说服了几只灵智初开的幼崽留下帮忙，守城阵线第一次真正有了“众生”之意。", rewards: mainQuestRewards.medium(808, 308, [{ itemId: yuanyingMaterialIds[4], quantity: 3 }]), requirements: [makeTalkRequirement(npcIds.ali, "阿狸")], prerequisites: [questIds.yuanying[7]], minRealm: 21, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[9], name: "初战血奴", description: "先清掉攻到青石里边缘的合欢血奴，稳住最薄弱的一环。", questType: "kill", acceptNpcId: npcIds.yunlao, completeNpcId: npcIds.yunlao, acceptStory: "云老不再说避世，只是低头请你把剩下的人带活下去。", completeStory: "青石里暂时稳住，云老也终于承认，真正的修行从来不是只护自己。", rewards: mainQuestRewards.medium(840, 316, [{ itemId: stageItemId("yuanying", "artifact_talisman"), quantity: 1 }]), requirements: [makeKillRequirement("mon_four_realms_yy_hehuan_xuenu", "合欢血奴", 6)], prerequisites: [questIds.yuanying[8]], minRealm: 21, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[10], name: "元婴初成·众心归一", description: "在第一场真正的守城战中稳住修为，完成破丹成婴的第一步。", questType: "detect", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "城墙外火光漫天，你终于不再只把这场战事当作他人的灾难。", completeStory: "在血与火中，你体内丹碎婴生，正式踏入元婴初期。从这一刻起，你护的已不只是自己一人。", rewards: mainQuestRewards.medium(900, 330, [{ itemId: stageItemId("yuanying", "weapon_blade"), quantity: 1 }]), requirements: [makeRealmRequirement(linearRealms.yuanying.early)], prerequisites: [questIds.yuanying[9]], minRealm: 21, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[11], name: "云门碰壁", description: "前往云门峰求援，却亲眼见识正道宗门的冷漠与算计。", questType: "talk", acceptNpcId: npcIds.yunlao, completeNpcId: npcIds.yunlao, acceptStory: "你明知未必有用，还是决定去问一问，至少给边锋城一个交代。", completeStory: "云门峰山门未开，人却早把话说绝。你知道接下来的路只能靠自己了。", rewards: mainQuestRewards.medium(860, 318, [{ itemId: yuanyingMaterialIds[1], quantity: 3 }]), requirements: [makeTalkRequirement(npcIds.yunlao, "云老")], prerequisites: [questIds.yuanying[10]], minRealm: 21, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[12], name: "地火谷筹兵", description: "从地火谷取回还能用的地火晶与军械材料，为大战前线做最后准备。", questType: "collect", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.liuniang, acceptStory: "岳定山让你自己做主，凡人军已经没有挑三拣四的资格。", completeStory: "柳娘把能调动的人手全压了上来，柳渡集也正式把最后的底牌交给了你。", rewards: mainQuestRewards.medium(888, 326, [{ itemId: stageItemId("yuanying", "artifact_shield"), quantity: 1 }]), requirements: [makeCollectRequirement(yuanyingMaterialIds[0], "边锋铁胆", 3), makeCollectRequirement(yuanyingMaterialIds[1], "云门风羽", 2)], prerequisites: [questIds.yuanying[11]], minRealm: 22, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[13], name: "防线建立", description: "把散修、凡人士兵与妖兽幼崽三方真正编进一条防线。", questType: "talk", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "岳定山把城防图交给你后，便不再多言，因为接下来这座城的生死已经与你绑在一起。", completeStory: "边锋城第一次不再只靠凡人硬扛，而是有了真正的修士战法与预警体系。", rewards: mainQuestRewards.medium(916, 336, [{ itemId: stageItemId("yuanying", "armor_shoes"), quantity: 1 }]), requirements: [makeTalkRequirement(npcIds.yuedingshan, "岳定山"), makeTalkRequirement(npcIds.ali, "阿狸")], prerequisites: [questIds.yuanying[12]], minRealm: 22, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[14], name: "柳娘断后", description: "柳渡集遭到突袭，必须回援并掩护柳娘完成最后一次转移。", questType: "kill", acceptNpcId: npcIds.liuniang, completeNpcId: npcIds.liuniang, acceptStory: "柳娘头一次没再招呼你喝酒，只说后路与名单都在这里，不能断。", completeStory: "你击退了追兵，却也知道柳娘再撑不了太久。她把那枚正道信物托付给你，等于把身后的路也一并交给了你。", rewards: mainQuestRewards.medium(948, 348, [{ itemId: "item_four_realms_quest_righteous_token", quantity: 1 }]), requirements: [makeKillRequirement("mon_four_realms_yy_caiposhi", "合欢采魄使", 4)], prerequisites: [questIds.yuanying[13]], minRealm: 22, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[15], name: "云老醒悟", description: "回青石里见云老，确认他愿意把最后的魔修弱点玉简与人手都交出来。", questType: "talk", acceptNpcId: npcIds.yunlao, completeNpcId: npcIds.yunlao, acceptStory: "云老像是一夜之间老了很多，他终于把自己藏着的东西全拿了出来。", completeStory: "你接过玉简，也接过一个前辈迟来的认错。此后这条路，再没有“我只顾自己”可以退。", rewards: mainQuestRewards.medium(920, 344, [{ itemId: stageItemId("yuanying", "skill_book"), quantity: 1 }]), requirements: [makeTalkRequirement(npcIds.yunlao, "云老")], prerequisites: [questIds.yuanying[14]], minRealm: 22, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[16], name: "元婴后期·血火连营", description: "把修为推到元婴后期，准备迎接血罗刹的大军压境。", questType: "detect", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "边锋城已经没有退路，岳定山只盼你还能再往前走一步。", completeStory: "你能清楚感到自身法力的量级再上一个台阶，也足以扛住真正的大战一波。", rewards: mainQuestRewards.medium(980, 360, [{ itemId: stageItemId("yuanying", "artifact_signature"), quantity: 1 }]), requirements: [makeRealmRequirement(linearRealms.yuanying.late)], prerequisites: [questIds.yuanying[15]], minRealm: 23, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[17], name: "边锋守战", description: "顶住第一轮魔化玄狼与血河妖鸦的联合冲击，守住城墙。", questType: "kill", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "城楼战鼓响起，凡人与散修第一次真正站到一条线上。", completeStory: "城墙没有丢，边锋城所有人都看见了，修士也可以站在最前面替他们挡。", rewards: mainQuestRewards.medium(1020, 376, [{ itemId: stageItemId("yuanying", "weapon_needle"), quantity: 1 }]), requirements: [makeKillRequirement("mon_four_realms_yy_mohua_xuanlang", "魔化玄狼", 6), makeKillRequirement("mon_four_realms_yy_xuehe_yaoya", "血河妖鸦", 3)], prerequisites: [questIds.yuanying[16]], minRealm: 23, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[18], name: "元婴圆满·守城道心", description: "把修为推进到元婴圆满，让自身真正配得上“一方守护者”的份量。", questType: "detect", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yuedingshan, acceptStory: "凡人军与散修都已把性命押在你身上，你也必须把道心押到底。", completeStory: "你终于站到了元婴圆满，知道自己接下来面对的已不是一城一地，而是整个修仙界那套冰冷规矩。", rewards: mainQuestRewards.medium(1040, 384, [{ itemId: stageItemId("yuanying", "pill_break"), quantity: 1 }]), requirements: [makeRealmRequirement(linearRealms.yuanying.perfection)], prerequisites: [questIds.yuanying[17]], minRealm: 24, maxRealm: null }),
  makeQuest({ id: questIds.yuanying[19], name: "血罗刹压境", description: "与血罗刹决战，击退魔修军，也在理念上彻底告别“只为自己求仙”的旧路。", questType: "kill", acceptNpcId: npcIds.yuedingshan, completeNpcId: npcIds.yunlao, acceptStory: "血罗刹亲临城下，正道宗门仍旧闭门不出。所有人都在等你给出最后一个答案。", completeStory: "血罗刹败退，边锋城未陷。暗中观察的前辈终于现身认可，你也真正从“求仙”走到了“成其为仙”。大道抉择已定，此后所修，不再只为一己安乐。", rewards: mainQuestRewards.boss(1520, 520, [{ itemId: stageItemId("yuanying", "weapon_sword"), quantity: 1 }, { itemId: stageItemId("yuanying", "skill_book"), quantity: 1 }]), requirements: [makeKillRequirement("mon_four_realms_yy_xueluosha", "血罗刹", 1)], prerequisites: [questIds.yuanying[18]], minRealm: 24, maxRealm: null }),
];

const fortunes: OfflineFortune[] = [
  {
    id: fortuneIds.fangu,
    name: "凡骨坚忍",
    description: "出身寻常，却极能熬苦。肉身与心气都比旁人更扛得住风雨。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 13,
    grade: "white",
    durationSeconds: 0,
    attrEffects: { maxHp: 20, defense: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.qingqi,
    name: "清气长息",
    description: "呼吸绵长，吐纳较稳，灵力运转不易紊乱。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 13,
    grade: "white",
    durationSeconds: 0,
    attrEffects: { maxMp: 18, mp: 18 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.qingshen,
    name: "轻身涉影",
    description: "脚步偏轻，遇险时总能比旁人快上半拍。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 12,
    grade: "white",
    durationSeconds: 0,
    attrEffects: { speed: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.muming,
    name: "目明心静",
    description: "心神不易浮躁，看人看事往往更准几分。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 12,
    grade: "white",
    durationSeconds: 0,
    attrEffects: { luck: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.shouwen,
    name: "手稳意沉",
    description: "出手不花哨，却够稳够狠，适合走一条脚踏实地的修行路。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 12,
    grade: "white",
    durationSeconds: 0,
    attrEffects: { attack: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.tuxi,
    name: "土息护体",
    description: "先天气机偏厚，遇到正面冲撞时更不容易散架。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 11,
    grade: "white",
    durationSeconds: 0,
    attrEffects: { defense: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.tuna,
    name: "吐纳绵长",
    description: "灵息细水长流，鏖战与长途奔波都更有余裕。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 9,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { hp: 8, mp: 8, maxMp: 6 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.fuyuan,
    name: "云水福缘",
    description: "命数里常有一缕温和福气，虽不惊人，却胜在长久。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 8,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { luck: 4 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.shouzhuo,
    name: "守拙归元",
    description: "不喜冒进，反而在稳扎稳打中更容易守住根基。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 8,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { maxHp: 16, defense: 1 },
    eventEffects: {},
    specialEffects: { breakthroughSuccessRate: 0.02 },
  },
  {
    id: fortuneIds.danlu,
    name: "丹炉亲和",
    description: "对药性格外敏感，吞服修为丹时更能把药力吃透一些。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 7,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: {},
    eventEffects: {},
    specialEffects: { pillXpRate: 0.03 },
  },
  {
    id: fortuneIds.dongfu,
    name: "洞府纳灵",
    description: "静坐时更容易敛住四周灵气，适合走稳步积蓄的路子。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 7,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: {},
    eventEffects: {},
    specialEffects: { dongfuLingqiRate: 0.03 },
  },
  {
    id: fortuneIds.fengmang,
    name: "锋芒内敛",
    description: "表面不显，真到交手时却常能把力道压得更准更实。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 7,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { attack: 4 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.changye,
    name: "长夜不倦",
    description: "熬得住夜、守得住场，越是漫长局面越能显出你的底气。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 4,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { maxHp: 24, maxMp: 20, defense: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.xindeng,
    name: "心灯自照",
    description: "一念能返照自身，不容易被外物牵着鼻子走。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 4,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { speed: 3, luck: 3 },
    eventEffects: {},
    specialEffects: { breakthroughSuccessRate: 0.03 },
  },
  {
    id: fortuneIds.danhua,
    name: "丹华内蕴",
    description: "天生更能藏住药力，适合走丹药养道的修行法门。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 3,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: {},
    eventEffects: {},
    specialEffects: { pillXpRate: 0.05, breakthroughSuccessRate: 0.03 },
  },
  {
    id: fortuneIds.jingang,
    name: "金刚根骨",
    description: "骨节硬实，受力时不易散架，天生适合走厚甲硬扛的路子。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 7,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { maxHp: 12, defense: 1, block: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.qingmu,
    name: "青木养息",
    description: "气机里藏着一点温养之意，灵息恢复更绵长，也更耐磨。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 7,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { maxHp: 10, spiritualSense: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.ruoshui,
    name: "若水涵髓",
    description: "灵力如水，善于蓄而不躁，适合走法修与持久斗法路线。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 7,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { maxMp: 10, mp: 10, skillDamageReduction: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.lihuo,
    name: "离火藏锋",
    description: "火性不浮，锋意反藏在里面，出手时会比常人更狠更快。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 6,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { attack: 3, speed: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.houde,
    name: "厚德载物",
    description: "根底厚重，承压时不轻易溃散，像是一块能慢慢蓄力的厚土。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 6,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { maxHp: 18, defense: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.jianshi,
    name: "坚石如钟",
    description: "肉身与器骨都有些坚实根性，走破阵路线时更容易硬顶一口气。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 6,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { attack: 2, armorPenetration: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.fazang,
    name: "法藏云流",
    description: "神识与灵息更容易凝成一体，施法时更稳，也更容易留住后劲。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 6,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { spiritualSense: 2, skillDamageBonus: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.xingchi,
    name: "星驰电脉",
    description: "气血奔走极快，临敌起势和追击收割时都更利落。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 6,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { speed: 2, attack: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.zhuyue,
    name: "逐月回光",
    description: "心神偏明，逢险时总能比别人更早看到一线空处。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 6,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { luck: 2, maxMp: 8 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.cangyuan,
    name: "藏渊守一",
    description: "不显山不露水，却擅长在最难的时候把那口气咬住。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 5,
    grade: "blue",
    durationSeconds: 0,
    attrEffects: { maxHp: 12, block: 1, skillDamageReduction: 1 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.taixuan,
    name: "太玄明心",
    description: "天生心念澄澈，神识转得快，遇事也更容易看到一层更深的理路。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 3,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { spiritualSense: 3, skillDamageBonus: 2 },
    eventEffects: {},
    specialEffects: { breakthroughSuccessRate: 0.02 },
  },
  {
    id: fortuneIds.jianxin,
    name: "剑心无尘",
    description: "一念如剑，不必多话，最适合走直来直去却极见功力的剑修路数。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 3,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { attack: 4, armorPenetration: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.fuhai,
    name: "覆海神照",
    description: "一身法力极能铺陈，一旦起势，便能把整段斗法拉进自己的节奏里。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 3,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { maxMp: 24, spiritualSense: 2, skillDamageBonus: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.yuling,
    name: "御灵回息",
    description: "对天地灵气的牵引格外顺手，无论洞府静修还是拉扯斗法都更舒服。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 2,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { speed: 4, luck: 4 },
    eventEffects: {},
    specialEffects: { dongfuLingqiRate: 0.02 },
  },
  {
    id: fortuneIds.guichen,
    name: "归尘清魄",
    description: "越是风波压身，越能守住本心与护体灵光，是很少见的稳重命格。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 2,
    grade: "purple",
    durationSeconds: 0,
    attrEffects: { maxHp: 28, defense: 2, block: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.jintaixiao,
    name: "金台晓寒",
    description: "心气与锋意常在一线清明之处，出手时自带凌厉压迫。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 1,
    grade: "gold",
    durationSeconds: 0,
    attrEffects: { attack: 5, spiritualSense: 4, armorPenetration: 2, skillDamageBonus: 2 },
    eventEffects: {},
    specialEffects: {},
  },
  {
    id: fortuneIds.zhoutian,
    name: "周天气回",
    description: "天生周天气脉流转顺畅，最擅长把漫长苦修与正面鏖战都熬成自己的主场。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 1,
    grade: "gold",
    durationSeconds: 0,
    attrEffects: { maxHp: 36, maxMp: 32, defense: 3, skillDamageReduction: 2 },
    eventEffects: {},
    specialEffects: { dongfuLingqiRate: 0.04 },
  },
  {
    id: fortuneIds.tianming,
    name: "天命弘愿",
    description: "逢险常有一线天意偏向，若肯守心而行，往往能把机缘吃得更透。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 1,
    grade: "gold",
    durationSeconds: 0,
    attrEffects: { luck: 6, spiritualSense: 4 },
    eventEffects: {},
    specialEffects: { pillXpRate: 0.04, breakthroughSuccessRate: 0.04 },
  },
  {
    id: fortuneIds.chiyuan,
    name: "赤元悲心",
    description: "命里自带一股不肯后退的热意，越是绝境，越会逼出更重的一击与更大的担当。",
    gender: null,
    enabled: true,
    isHidden: false,
    isStarter: true,
    starterWeight: 1,
    grade: "red",
    durationSeconds: 0,
    attrEffects: { attack: 6, speed: 4, skillDamageBonus: 3, artifactDamageBonus: 2 },
    eventEffects: {},
    specialEffects: { breakthroughSuccessRate: 0.03, dongfuLingqiRate: 0.03 },
  },
];

const randomEvents: OfflineRandomEvent[] = [
  {
    id: "event_pregnancy_stage4_blood_pulse",
    name: "血脉微鼓",
    description: "阶段 4 专用孕育事件，占位为固定 encounter，默认不参与自然刷新，仅供系统按 ID 定向调用。",
    iconImageUrl: iconCatalog.skillBurst.publicPath,
    imageUrls: null,
    eventType: "encounter",
    probability: 0,
    spawnIntervalSeconds: null,
    durationSeconds: null,
    minRealm: 1,
    maxRealm: null,
    mapType: null,
    mapIds: null,
    judgeConditions: null,
    rewards: {
      xp: 0,
      gold: 0,
    },
    aiPrompt: null,
  },
  {
    id: "event_pregnancy_stage5_spirit_tide",
    name: "灵潮拍脉",
    description: "阶段 5 专用孕育事件，占位为固定 encounter，默认不参与自然刷新，仅供系统按 ID 定向调用。",
    iconImageUrl: iconCatalog.skillArc.publicPath,
    imageUrls: null,
    eventType: "encounter",
    probability: 0,
    spawnIntervalSeconds: null,
    durationSeconds: null,
    minRealm: 1,
    maxRealm: null,
    mapType: null,
    mapIds: null,
    judgeConditions: null,
    rewards: {
      xp: 0,
      gold: 0,
    },
    aiPrompt: null,
  },
  {
    id: "event_pregnancy_stage6_dream_trace",
    name: "梦痕回照",
    description: "阶段 6 专用孕育事件，占位为固定 encounter，默认不参与自然刷新，仅供系统按 ID 定向调用。",
    iconImageUrl: iconCatalog.materialOrb.publicPath,
    imageUrls: null,
    eventType: "encounter",
    probability: 0,
    spawnIntervalSeconds: null,
    durationSeconds: null,
    minRealm: 1,
    maxRealm: null,
    mapType: null,
    mapIds: null,
    judgeConditions: null,
    rewards: {
      xp: 0,
      gold: 0,
    },
    aiPrompt: null,
  },
  {
    id: "event_four_realms_lq_tidal_cache",
    name: "潮痕旧匣",
    description: "礁石缝里卡着一只旧木匣，里头没有灵石，只有几株被海潮浸透却仍可入药的海雾草。",
    iconImageUrl: iconCatalog.materialOrb.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_lq_tidal_cache.images,
    eventType: "opportunity",
    probability: 0.12,
    spawnIntervalSeconds: 900,
    durationSeconds: 900,
    minRealm: 1,
    maxRealm: 12,
    mapType: null,
    mapIds: [mapIds.penglai],
    judgeConditions: null,
    rewards: { xp: 0, gold: 24, items: [{ itemId: lianqiMaterialIds[0], quantity: 2 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_lq_tidal_cache", "礁石缝里卡着一只旧木匣，里头没有灵石，只有几株被海潮浸透却仍可入药的海雾草。"),
  },
  {
    id: "event_four_realms_lq_heisong_note",
    name: "黑松误路",
    description: "你在黑松林里捡到一截记路木牌，顺着它避开了毒雾，却只换来几件还能用的零碎。",
    iconImageUrl: iconCatalog.skillArc.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_lq_heisong_note.images,
    eventType: "encounter",
    probability: 0.08,
    spawnIntervalSeconds: 1800,
    durationSeconds: null,
    minRealm: 4,
    maxRealm: 12,
    mapType: null,
    mapIds: [mapIds.heisonglin],
    judgeConditions: null,
    rewards: { xp: 0, gold: 30, items: [{ itemId: lianqiMaterialIds[3], quantity: 1 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_lq_heisong_note", "你在黑松林里捡到一截记路木牌，顺着它避开了毒雾，却只换来几件还能用的零碎。"),
  },
  {
    id: "event_four_realms_zj_blood_ledger",
    name: "血账残页",
    description: "荒道边压着一张血迹未干的残页，上面记着凡人买卖的时辰与去向，看得人心头发冷。",
    iconImageUrl: iconCatalog.materialJade.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_zj_blood_ledger.images,
    eventType: "opportunity",
    probability: 0.1,
    spawnIntervalSeconds: 1200,
    durationSeconds: 1200,
    minRealm: 13,
    maxRealm: 16,
    mapType: null,
    mapIds: [mapIds.taihang, mapIds.chisha],
    judgeConditions: null,
    rewards: { xp: 0, gold: 58, items: [{ itemId: zhujiMaterialIds[2], quantity: 2 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_zj_blood_ledger", "荒道边压着一张血迹未干的残页，上面记着凡人买卖的时辰与去向，看得人心头发冷。"),
  },
  {
    id: "event_four_realms_zj_fire_route",
    name: "地火余烬",
    description: "你循着未灭的地火残烬找到了魔修废弃的转运点，拿回几块还能炼器的晶核。",
    iconImageUrl: iconCatalog.skillBurst.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_zj_fire_route.images,
    eventType: "encounter",
    probability: 0.07,
    spawnIntervalSeconds: 2400,
    durationSeconds: null,
    minRealm: 14,
    maxRealm: 16,
    mapType: null,
    mapIds: [mapIds.dihuogu],
    judgeConditions: null,
    rewards: { xp: 0, gold: 66, items: [{ itemId: zhujiMaterialIds[1], quantity: 1 }, { itemId: stageItemId("zhuji", "pill_heal"), quantity: 1 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_zj_fire_route", "你循着未灭的地火残烬找到了魔修废弃的转运点，拿回几块还能炼器的晶核。"),
  },
  {
    id: "event_four_realms_jd_old_letter",
    name: "旧信未焚",
    description: "风里卷来一封没烧净的旧信，字里行间全是凡人之间的相互托付，轻得像纸，重得像一生。",
    iconImageUrl: iconCatalog.materialJade.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_jd_old_letter.images,
    eventType: "opportunity",
    probability: 0.09,
    spawnIntervalSeconds: 1500,
    durationSeconds: 1200,
    minRealm: 17,
    maxRealm: 20,
    mapType: null,
    mapIds: [mapIds.liuduji],
    judgeConditions: null,
    rewards: { xp: 0, gold: 88, items: [{ itemId: jiedanMaterialIds[0], quantity: 1 }, { itemId: jiedanMaterialIds[3], quantity: 1 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_jd_old_letter", "风里卷来一封没烧净的旧信，字里行间全是凡人之间的相互托付，轻得像纸，重得像一生。"),
  },
  {
    id: "event_four_realms_jd_night_echo",
    name: "夜河回声",
    description: "夜河古冢里忽有回声应你心念，你没有得来修为，只多带走了一丝能稳住心神的清明。",
    iconImageUrl: iconCatalog.skillWater.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_jd_night_echo.images,
    eventType: "encounter",
    probability: 0.06,
    spawnIntervalSeconds: 2700,
    durationSeconds: null,
    minRealm: 18,
    maxRealm: 20,
    mapType: null,
    mapIds: [mapIds.yehe, mapIds.wuhaize],
    judgeConditions: null,
    rewards: { xp: 0, gold: 96, items: [{ itemId: stageItemId("jiedan", "pill_heal"), quantity: 1 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_jd_night_echo", "夜河古冢里忽有回声应你心念，你没有得来修为，只多带走了一丝能稳住心神的清明。"),
  },
  {
    id: "event_four_realms_yy_city_supply",
    name: "守城遗箱",
    description: "边锋城旧仓塌了一角，你从碎木里翻出一箱还能用的守城军资，尽是能救命却不涨修为的硬东西。",
    iconImageUrl: iconCatalog.shield.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_yy_city_supply.images,
    eventType: "opportunity",
    probability: 0.08,
    spawnIntervalSeconds: 1800,
    durationSeconds: 1500,
    minRealm: 21,
    maxRealm: 24,
    mapType: null,
    mapIds: [mapIds.bianfeng],
    judgeConditions: null,
    rewards: { xp: 0, gold: 132, items: [{ itemId: yuanyingMaterialIds[0], quantity: 2 }, { itemId: stageItemId("yuanying", "pill_heal"), quantity: 1 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_yy_city_supply", "边锋城旧仓塌了一角，你从碎木里翻出一箱还能用的守城军资，尽是能救命却不涨修为的硬东西。"),
  },
  {
    id: "event_four_realms_yy_fox_warning",
    name: "狐火预警",
    description: "阿狸留下的气味把你引到一处伏兵死角，你提前看破了魔修布置，只带走一些可用于反制的材料。",
    iconImageUrl: iconCatalog.needle.publicPath,
    imageUrls: eventStoryboardSeeds.event_four_realms_yy_fox_warning.images,
    eventType: "encounter",
    probability: 0.05,
    spawnIntervalSeconds: 3000,
    durationSeconds: null,
    minRealm: 22,
    maxRealm: 24,
    mapType: null,
    mapIds: [mapIds.bianfeng, mapIds.qingshili, mapIds.liuduji],
    judgeConditions: null,
    rewards: { xp: 0, gold: 148, items: [{ itemId: yuanyingMaterialIds[4], quantity: 1 }, { itemId: yuanyingMaterialIds[2], quantity: 1 }] },
    aiPrompt: buildEncounterPrompt("event_four_realms_yy_fox_warning", "阿狸留下的气味把你引到一处伏兵死角，你提前看破了魔修布置，只带走一些可用于反制的材料。"),
  },
];

const pillToxicityConfigs: OfflinePillToxicityConfig[] = [
  {
    key: "default",
    maxToxicity: 20,
    recoverIntervalMinutes: 8,
  },
];

const newDamageFormula = "max(1, ((atk + armorPenetration * 0.3 + speed * 0.2 + luck * 0.08) * mul + base) * (100 / (100 + max(0, effectiveDef * 0.92))) * rand)";

const alchemyRecipes: OfflineRecipe[] = [
  { id: "alchemy_lianqi_xp", resultItemId: stageItemId("lianqi", "pill_xp"), resultQuantity: 1, mainItemId: lianqiMaterialIds[0], mainQuantity: 3, baseSuccessRate: 0.76, auxAItemId: lianqiMaterialIds[3], auxAQuantity: 1, auxABonusRate: 0.08 },
  { id: "alchemy_lianqi_break", resultItemId: stageItemId("lianqi", "pill_break"), resultQuantity: 1, mainItemId: lianqiMaterialIds[1], mainQuantity: 2, baseSuccessRate: 0.62, auxAItemId: lianqiMaterialIds[0], auxAQuantity: 2, auxABonusRate: 0.08, auxBItemId: lianqiMaterialIds[2], auxBQuantity: 1, auxBBonusRate: 0.06 },
  { id: "alchemy_lianqi_heal", resultItemId: stageItemId("lianqi", "pill_heal"), resultQuantity: 1, mainItemId: lianqiMaterialIds[0], mainQuantity: 2, baseSuccessRate: 0.72, auxAItemId: lianqiMaterialIds[3], auxAQuantity: 1, auxABonusRate: 0.05 },
  { id: "alchemy_zhuji_xp", resultItemId: stageItemId("zhuji", "pill_xp"), resultQuantity: 1, mainItemId: spiritualFieldItemIds.zhujiHerb, mainQuantity: 2, baseSuccessRate: 0.72, auxAItemId: zhujiMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.08 },
  { id: "alchemy_zhuji_break", resultItemId: stageItemId("zhuji", "pill_break"), resultQuantity: 1, mainItemId: zhujiMaterialIds[2], mainQuantity: 2, baseSuccessRate: 0.58, auxAItemId: zhujiMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.08, auxBItemId: zhujiMaterialIds[3], auxBQuantity: 2, auxBBonusRate: 0.07 },
  { id: "alchemy_zhuji_heal", resultItemId: stageItemId("zhuji", "pill_heal"), resultQuantity: 1, mainItemId: spiritualFieldItemIds.zhujiHerb, mainQuantity: 1, baseSuccessRate: 0.68, auxAItemId: zhujiMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.06 },
  { id: "alchemy_jiedan_xp", resultItemId: stageItemId("jiedan", "pill_xp"), resultQuantity: 1, mainItemId: jiedanMaterialIds[0], mainQuantity: 2, baseSuccessRate: 0.68, auxAItemId: jiedanMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.08 },
  { id: "alchemy_jiedan_break", resultItemId: stageItemId("jiedan", "pill_break"), resultQuantity: 1, mainItemId: jiedanMaterialIds[3], mainQuantity: 2, baseSuccessRate: 0.54, auxAItemId: jiedanMaterialIds[2], auxAQuantity: 1, auxABonusRate: 0.08, auxBItemId: jiedanMaterialIds[1], auxBQuantity: 1, auxBBonusRate: 0.08 },
  { id: "alchemy_jiedan_heal", resultItemId: stageItemId("jiedan", "pill_heal"), resultQuantity: 1, mainItemId: jiedanMaterialIds[0], mainQuantity: 1, baseSuccessRate: 0.64, auxAItemId: jiedanMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.06 },
  { id: "alchemy_yuanying_xp", resultItemId: stageItemId("yuanying", "pill_xp"), resultQuantity: 1, mainItemId: spiritualFieldItemIds.yuanyingHerb, mainQuantity: 2, baseSuccessRate: 0.62, auxAItemId: yuanyingMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.08 },
  { id: "alchemy_yuanying_break", resultItemId: stageItemId("yuanying", "pill_break"), resultQuantity: 1, mainItemId: yuanyingMaterialIds[3], mainQuantity: 2, baseSuccessRate: 0.48, auxAItemId: yuanyingMaterialIds[2], auxAQuantity: 1, auxABonusRate: 0.09, auxBItemId: yuanyingMaterialIds[4], auxBQuantity: 1, auxBBonusRate: 0.08 },
  { id: "alchemy_yuanying_heal", resultItemId: stageItemId("yuanying", "pill_heal"), resultQuantity: 1, mainItemId: spiritualFieldItemIds.yuanyingHerb, mainQuantity: 1, baseSuccessRate: 0.6, auxAItemId: yuanyingMaterialIds[1], auxAQuantity: 1, auxABonusRate: 0.06 },
];

function buildSmithingRecipes(stage: ItemStageKey): OfflineRecipe[] {
  const materialIds = stageMaterialIds(stage);
  const prefix = `smithing_${stage}`;
  return [
    { id: `${prefix}_weapon_sword`, resultItemId: stageItemId(stage, "weapon_sword"), resultQuantity: 1, mainItemId: materialIds[0], mainQuantity: 3, baseSuccessRate: 0.72, auxAItemId: materialIds[1], auxAQuantity: 2, auxABonusRate: 0.08 },
    { id: `${prefix}_weapon_blade`, resultItemId: stageItemId(stage, "weapon_blade"), resultQuantity: 1, mainItemId: materialIds[1], mainQuantity: 3, baseSuccessRate: 0.7, auxAItemId: materialIds[0], auxAQuantity: 2, auxABonusRate: 0.08 },
    { id: `${prefix}_weapon_needle`, resultItemId: stageItemId(stage, "weapon_needle"), resultQuantity: 1, mainItemId: materialIds[1], mainQuantity: 2, baseSuccessRate: 0.68, auxAItemId: materialIds[Math.min(2, materialIds.length - 1)], auxAQuantity: 1, auxABonusRate: 0.06 },
    { id: `${prefix}_weapon_focus`, resultItemId: stageItemId(stage, "weapon_focus"), resultQuantity: 1, mainItemId: materialIds[Math.min(5, materialIds.length - 1)], mainQuantity: 2, baseSuccessRate: 0.66, auxAItemId: materialIds[Math.min(6, materialIds.length - 1)], auxAQuantity: 2, auxABonusRate: 0.08, auxBItemId: materialIds[2], auxBQuantity: 1, auxBBonusRate: 0.06 },
    { id: `${prefix}_artifact_talisman`, resultItemId: stageItemId(stage, "artifact_talisman"), resultQuantity: 1, mainItemId: materialIds[2], mainQuantity: 2, baseSuccessRate: 0.66, auxAItemId: materialIds[0], auxAQuantity: 2, auxABonusRate: 0.08 },
    { id: `${prefix}_artifact_shield`, resultItemId: stageItemId(stage, "artifact_shield"), resultQuantity: 1, mainItemId: materialIds[1], mainQuantity: 2, baseSuccessRate: 0.66, auxAItemId: materialIds[2], auxAQuantity: 2, auxABonusRate: 0.08 },
    { id: `${prefix}_artifact_sword_box`, resultItemId: stageItemId(stage, "artifact_sword_box"), resultQuantity: 1, mainItemId: materialIds[Math.min(4, materialIds.length - 1)], mainQuantity: 2, baseSuccessRate: 0.62, auxAItemId: materialIds[0], auxAQuantity: 2, auxABonusRate: 0.08, auxBItemId: materialIds[2], auxBQuantity: 1, auxBBonusRate: 0.06 },
    { id: `${prefix}_artifact_blood_banner`, resultItemId: stageItemId(stage, "artifact_blood_banner"), resultQuantity: 1, mainItemId: materialIds[Math.min(8, materialIds.length - 1)], mainQuantity: 2, baseSuccessRate: 0.6, auxAItemId: materialIds[Math.min(7, materialIds.length - 1)], auxAQuantity: 2, auxABonusRate: 0.08, auxBItemId: materialIds[3], auxBQuantity: 1, auxBBonusRate: 0.06 },
    { id: `${prefix}_artifact_swift_ring`, resultItemId: stageItemId(stage, "artifact_swift_ring"), resultQuantity: 1, mainItemId: materialIds[Math.min(6, materialIds.length - 1)], mainQuantity: 2, baseSuccessRate: 0.64, auxAItemId: materialIds[Math.min(5, materialIds.length - 1)], auxAQuantity: 1, auxABonusRate: 0.06, auxBItemId: materialIds[Math.min(7, materialIds.length - 1)], auxBQuantity: 1, auxBBonusRate: 0.06 },
    { id: `${prefix}_armor_robe`, resultItemId: stageItemId(stage, "armor_robe"), resultQuantity: 1, mainItemId: materialIds[0], mainQuantity: 2, baseSuccessRate: 0.78, auxAItemId: materialIds[3], auxAQuantity: 1, auxABonusRate: 0.05 },
    { id: `${prefix}_armor_helmet`, resultItemId: stageItemId(stage, "armor_helmet"), resultQuantity: 1, mainItemId: materialIds[2], mainQuantity: 1, baseSuccessRate: 0.8, auxAItemId: materialIds[0], auxAQuantity: 1, auxABonusRate: 0.04 },
    { id: `${prefix}_armor_shoes`, resultItemId: stageItemId(stage, "armor_shoes"), resultQuantity: 1, mainItemId: materialIds[Math.min(3, materialIds.length - 1)], mainQuantity: 2, baseSuccessRate: 0.8, auxAItemId: materialIds[0], auxAQuantity: 1, auxABonusRate: 0.04 },
    { id: `${prefix}_artifact_signature`, resultItemId: stageItemId(stage, "artifact_signature"), resultQuantity: 1, mainItemId: materialIds[2], mainQuantity: 3, baseSuccessRate: 0.58, auxAItemId: materialIds[1], auxAQuantity: 2, auxABonusRate: 0.08, auxBItemId: materialIds[Math.min(3, materialIds.length - 1)], auxBQuantity: 1, auxBBonusRate: 0.08 },
  ];
}

const smithingRecipes: OfflineRecipe[] = [
  ...buildSmithingRecipes("lianqi"),
  ...buildSmithingRecipes("zhuji"),
  ...buildSmithingRecipes("jiedan"),
  ...buildSmithingRecipes("yuanying"),
];

const spiritualFieldSeeds: OfflineSpiritualFieldSeed[] = [
  { seedItemId: spiritualFieldItemIds.lianqiSeed, outputItemId: lianqiMaterialIds[0], name: "海雾草", growthSeconds: 6 * 60 * 60, minYield: 2, maxYield: 4, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["forest", "growth"], secretRealmWeight: 1 },
  { seedItemId: spiritualFieldItemIds.zhujiSeed, outputItemId: spiritualFieldItemIds.zhujiHerb, name: "赤髓芝", growthSeconds: 8 * 60 * 60, minYield: 2, maxYield: 4, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["pill", "ore"], secretRealmWeight: 1 },
  { seedItemId: spiritualFieldItemIds.jiedanSeed, outputItemId: jiedanMaterialIds[0], name: "雾海灵莲", growthSeconds: 10 * 60 * 60, minYield: 1, maxYield: 3, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["water", "pill", "growth"], secretRealmWeight: 2 },
  { seedItemId: spiritualFieldItemIds.jiedanSeedQingluo, outputItemId: jiedanMaterialIds[1], name: "青萝藤", growthSeconds: 12 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["forest", "growth"], secretRealmWeight: 3 },
  { seedItemId: spiritualFieldItemIds.jiedanSeedYuexi, outputItemId: jiedanMaterialIds[2], name: "月汐兰", growthSeconds: 14 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["water", "pill"], secretRealmWeight: 3 },
  { seedItemId: spiritualFieldItemIds.jiedanSeedJinyang, outputItemId: jiedanMaterialIds[7], name: "金阳穗", growthSeconds: 16 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["ore", "ruins"], secretRealmWeight: 2 },
  { seedItemId: spiritualFieldItemIds.yuanyingSeed, outputItemId: spiritualFieldItemIds.yuanyingHerb, name: "守心雪参", growthSeconds: 18 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["pill", "growth"], secretRealmWeight: 2 },
  { seedItemId: spiritualFieldItemIds.yuanyingSeedXuanshuang, outputItemId: yuanyingMaterialIds[1], name: "玄霜芝", growthSeconds: 20 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["water", "pill", "growth"], secretRealmWeight: 3 },
  { seedItemId: spiritualFieldItemIds.yuanyingSeedJiuxiao, outputItemId: yuanyingMaterialIds[5], name: "九霄葵", growthSeconds: 22 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: null, enabled: true, dropThemeTags: ["forest", "ore", "ruins"], secretRealmWeight: 3 },
  { seedItemId: spiritualFieldItemIds.yuanyingSeedTaiyin, outputItemId: spiritualFieldItemIds.yuanyingHerb, name: "太阴龙葵", growthSeconds: 24 * 60 * 60, minYield: 1, maxYield: 2, maxPlotsPerPlayer: 1, enabled: true, dropThemeTags: ["pill", "ruins", "water"], secretRealmWeight: 4 },
];

const hongmengTreasureConfigs: OfflineHongmengTreasureConfig[] = [
  {
    itemId: spiritualFieldItemIds.hongmengBottle,
    enabled: true,
    maxStar: 5,
    starConfigs: [
      { star: 0, energyCap: 200, regenSecondsPerEnergy: 480 },
      { star: 1, energyCap: 250, regenSecondsPerEnergy: 450 },
      { star: 2, energyCap: 300, regenSecondsPerEnergy: 420 },
      { star: 3, energyCap: 350, regenSecondsPerEnergy: 360 },
      { star: 4, energyCap: 450, regenSecondsPerEnergy: 300 },
      { star: 5, energyCap: 500, regenSecondsPerEnergy: 180 },
    ],
    upgradeCosts: [],
    spiritualFieldEnergyCost: 60,
    spiritualFieldReduceSeconds: 3600,
  },
];

const ALCHEMY_KEY = buildOfflinePackPluginSystemConfigKey("alchemy", "RECIPES_JSON") || "PLUGIN_ALCHEMY_RECIPES_JSON";
const SMITHING_KEY = buildOfflinePackPluginSystemConfigKey("smithing", "RECIPES_JSON") || "PLUGIN_SMITHING_RECIPES_JSON";
const DONGFU_CAP_HOURS_KEY = "DONGFU_CAP_HOURS";
const DONGFU_XP_RATIO_PER_HOUR_KEY = "DONGFU_XP_RATIO_PER_HOUR";
const DONGFU_MIN_XP_PER_HOUR_KEY = "DONGFU_MIN_XP_PER_HOUR";
const GAME_START_MAP_ID_KEY = "GAME_START_MAP_ID";
const GAME_START_POSITION_X_KEY = "GAME_START_POSITION_X";
const GAME_START_POSITION_Y_KEY = "GAME_START_POSITION_Y";
const GAME_START_BASE_SKILL_ID_KEY = "GAME_START_BASE_SKILL_ID";
const GAME_START_INVENTORY_JSON_KEY = "GAME_START_INVENTORY_JSON";
const GAME_PUBLIC_ANNOUNCEMENT_KEY = "GAME_PUBLIC_ANNOUNCEMENT";
const WORLD_FLAVOR_LLM_BASE_URL_KEY = "WORLD_FLAVOR_LLM_BASE_URL";
const WORLD_FLAVOR_LLM_API_KEY_KEY = "WORLD_FLAVOR_LLM_API_KEY";
const WORLD_FLAVOR_LLM_MODEL_KEY = "WORLD_FLAVOR_LLM_MODEL";
const SMITHING_LLM_BASE_URL_KEY = "SMITHING_LLM_BASE_URL";
const SMITHING_LLM_API_KEY_KEY = "SMITHING_LLM_API_KEY";
const SMITHING_LLM_MODEL_KEY = "SMITHING_LLM_MODEL";
const ALCHEMY_LLM_BASE_URL_KEY = "ALCHEMY_LLM_BASE_URL";
const ALCHEMY_LLM_API_KEY_KEY = "ALCHEMY_LLM_API_KEY";
const ALCHEMY_LLM_MODEL_KEY = "ALCHEMY_LLM_MODEL";

const systemConfigs: OfflineSystemConfig[] = [
  { key: GAME_START_MAP_ID_KEY, value: mapIds.penglai, group: "game", isSecret: false, description: "四境线开局地图，删档重开后默认从蓬莱岛入世。" },
  { key: GAME_START_POSITION_X_KEY, value: "3", group: "game", isSecret: false, description: "四境线开局 X 坐标，位于蓬莱岛渔港上岸点。" },
  { key: GAME_START_POSITION_Y_KEY, value: "22", group: "game", isSecret: false, description: "四境线开局 Y 坐标，靠近渔翁与主路入口。" },
  { key: GAME_START_BASE_SKILL_ID_KEY, value: skillIds.lqSword, group: "game", isSecret: false, description: "四境线开局基础神通，默认授予《牵潮剑气》。" },
  { key: GAME_START_INVENTORY_JSON_KEY, value: "[]", group: "game", isSecret: false, description: "四境线删档重开后默认不额外塞旧新手村道具。" },
  { key: GAME_PUBLIC_ANNOUNCEMENT_KEY, value: "四境正史已重编完成。修为只来自洞府打坐与修为丹，诸位入世后请先在蓬莱岛立身。", group: "game", isSecret: false, description: "四境线公共公告。" },
  { key: COMBAT_DAMAGE_FORMULA_KEY, value: newDamageFormula, group: "game", isSecret: false, description: "四境重构后的中速博弈伤害公式，当前主打攻击、破防与平滑防御衰减。" },
  { key: DONGFU_CAP_HOURS_KEY, value: "36", group: "game", isSecret: false, description: "洞府离线平衡可储存时长，统一对齐为 36 小时，允许玩家隔天上线也不至于立刻溢出。" },
  { key: DONGFU_XP_RATIO_PER_HOUR_KEY, value: String(DONGFU_XP_RATIO_PER_HOUR), group: "game", isSecret: false, description: "四境重构后的洞府修为比例。按每日自然累积 24 小时洞府收益与 20 枚修为丹共同校准，练气到化神约 20 天，化神到炼虚约 10 天以上。" },
  { key: DONGFU_MIN_XP_PER_HOUR_KEY, value: "1", group: "game", isSecret: false, description: "洞府最低每小时修为收益，保持 1 点兜底。" },
  { key: "PLAYER_PREGNANCY_STAGE7_FORTUNE_ID", value: "", group: "game", isSecret: false, description: "阶段 7 命中后系统可授予的专属气运 ID，留空表示默认不额外发放。" },
  { key: WORLD_FLAVOR_LLM_BASE_URL_KEY, value: "", group: "llm", isSecret: false, description: "世界风味模型 base URL，可按需在后台单独配置。" },
  { key: WORLD_FLAVOR_LLM_API_KEY_KEY, value: "", group: "llm", isSecret: true, description: "世界风味模型 API Key，可按需在后台单独配置。" },
  { key: WORLD_FLAVOR_LLM_MODEL_KEY, value: "", group: "llm", isSecret: false, description: "世界风味模型名，留空回退通用模型。" },
  { key: SMITHING_LLM_BASE_URL_KEY, value: "", group: "llm", isSecret: false, description: "AI 炼器模型 base URL，可独立于通用/世界风味模型配置。" },
  { key: SMITHING_LLM_API_KEY_KEY, value: "", group: "llm", isSecret: true, description: "AI 炼器模型 API Key，可独立于通用/世界风味模型配置。" },
  { key: SMITHING_LLM_MODEL_KEY, value: "", group: "llm", isSecret: false, description: "AI 炼器模型名，留空回退世界风味模型。" },
  { key: ALCHEMY_LLM_BASE_URL_KEY, value: "", group: "llm", isSecret: false, description: "AI 炼丹模型 base URL，可独立于通用/世界风味模型配置。" },
  { key: ALCHEMY_LLM_API_KEY_KEY, value: "", group: "llm", isSecret: true, description: "AI 炼丹模型 API Key，可独立于通用/世界风味模型配置。" },
  { key: ALCHEMY_LLM_MODEL_KEY, value: "", group: "llm", isSecret: false, description: "AI 炼丹模型名，留空回退世界风味模型。" },
  { key: ALCHEMY_KEY, value: JSON.stringify(alchemyRecipes, null, 2), group: "plugin", isSecret: false, description: "四境离线炼丹配方，重点覆盖修为丹、突破辅丹与战斗恢复丹。" },
  { key: SMITHING_KEY, value: JSON.stringify(smithingRecipes, null, 2), group: "plugin", isSecret: false, description: "四境离线炼器配方，形成掉落材料 -> 炼制成品的闭环。" },
];

export const fourRealmsPack: FourRealmsPack = {
  metadata: {
    id: "four-realms-offline-pack",
    version: "2026.03.15-pregnancy-cleanup-and-cap-fixes",
    generatedAt: PACK_GENERATED_AT,
    mode: "offline-only",
    style: "散修凡人流",
    pace: "20日登化神，化神后长墙",
    storyline: "固定正史",
    questCount: quests.length,
    firstFourMainQuestCount: quests.length,
    linearRealmCount: realmMajors.reduce((sum, major) => sum + major.stages.length, 0),
  },
  realmMajors,
  maps,
  mapEdges,
  npcs,
  skills,
  items,
  monsters,
  quests,
  fortunes,
  randomEvents,
  systemConfigs,
  pillToxicityConfigs,
  alchemyRecipes,
  smithingRecipes,
  spiritualFieldSeeds,
  hongmengTreasureConfigs,
  iconAssets,
  stageBenchmarks,
};

export function getFourRealmsPack() {
  return fourRealmsPack;
}
