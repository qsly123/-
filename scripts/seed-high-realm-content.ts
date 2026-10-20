/**
 * 补齐高境界内容：化神(25-28) / 炼虚(29-32) / 合体(33-36) / 大乘(37-40) / 渡劫(41-44)。
 *
 * 现状（改之前，实测）：
 *   - 怪物只有 80 只，等级 2~24，25 级以上一只都没有
 *   - 地图只有 13 张，minRealm 最高 24，25 级玩家无处可去
 *   - **全部 80 只怪 xp_reward = 0**：打怪一滴修为都不给，
 *     所以之前加的「跨境修为折算」实际作用在 0 上
 *
 * 本脚本做四件事（全部幂等，可重复执行）：
 *   1. 按等级给所有怪物写入 xp_reward（含现有 80 只）
 *   2. 新建 5 张高境界地图，与裂天墟(minRealm 24)串成一条链
 *   3. 新建 120 只高境界怪物，挂到对应地图上
 *   4. 新掉落的段位材料（炼器 2 + 炼丹 2 / 段）
 *
 * 用法：bun run scripts/seed-high-realm-content.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { maps, mapEdges, monsters, items } from "@/db/schema";
import type { ItemEffect } from "@/types/game";
import { RARITY_SEED_MULT, computeStageMult } from "@/modules/character/services/equipment-instance-service";

/* ------------------------------------------------------------------ */
/* 数值曲线                                                             */
/* ------------------------------------------------------------------ */

/** 段位：线性境界 25~44，每段 4 级 */
const BANDS = [
  { key: "huashen", label: "化神", levels: [25, 26, 27, 28] },
  { key: "lianxu", label: "炼虚", levels: [29, 30, 31, 32] },
  { key: "heti", label: "合体", levels: [33, 34, 35, 36] },
  { key: "dacheng", label: "大乘", levels: [37, 38, 39, 40] },
  { key: "dujie", label: "渡劫", levels: [41, 42, 43, 44] },
] as const;

/** 既有怪物实测均值：练气 460/39/19、筑基 1027/94/43、结丹 1681/164/75、元婴 3163/303/144 */
const HP_BASE = [
  { maxLevel: 12, from: 300, to: 620 },
  { maxLevel: 16, from: 1000, to: 1400 },
  { maxLevel: 20, from: 1600, to: 1900 },
  { maxLevel: 24, from: 3000, to: 3400 },
  { maxLevel: 28, from: 5200, to: 8200 },
  { maxLevel: 32, from: 9000, to: 14000 },
  { maxLevel: 36, from: 16000, to: 24000 },
  { maxLevel: 40, from: 28000, to: 42000 },
  { maxLevel: 44, from: 48000, to: 72000 },
];

const ATK_BASE = [
  { maxLevel: 12, from: 26, to: 62 },
  { maxLevel: 16, from: 90, to: 130 },
  { maxLevel: 20, from: 150, to: 190 },
  { maxLevel: 24, from: 280, to: 340 },
  { maxLevel: 28, from: 480, to: 760 },
  { maxLevel: 32, from: 830, to: 1300 },
  { maxLevel: 36, from: 1450, to: 2200 },
  { maxLevel: 40, from: 2500, to: 3800 },
  { maxLevel: 44, from: 4300, to: 6500 },
];

const DEF_BASE = [
  { maxLevel: 12, from: 13, to: 31 },
  { maxLevel: 16, from: 42, to: 60 },
  { maxLevel: 20, from: 70, to: 88 },
  { maxLevel: 24, from: 130, to: 160 },
  { maxLevel: 28, from: 230, to: 360 },
  { maxLevel: 32, from: 400, to: 620 },
  { maxLevel: 36, from: 700, to: 1050 },
  { maxLevel: 40, from: 1200, to: 1800 },
  { maxLevel: 44, from: 2100, to: 3100 },
];

/**
 * 打怪修为曲线。
 * 参照系：洞府每小时产「突破需求的 5%」（20 小时升一级），
 * 修为丹练气 1600 / 筑基 3200 / 结丹 4800 / 元婴 6400。
 * 这里取「同级修为丹的约 1/8」，让打怪是主动收入但不当主力：
 *   练气 100→200（升一级约 50 只）、元婴 520→800（升一级约 600 只，主力转洞府）
 */
const XP_BASE = [
  { maxLevel: 12, from: 100, to: 200 },
  { maxLevel: 16, from: 240, to: 400 },
  { maxLevel: 20, from: 360, to: 600 },
  { maxLevel: 24, from: 520, to: 800 },
  { maxLevel: 28, from: 900, to: 1400 },
  { maxLevel: 32, from: 1500, to: 2300 },
  { maxLevel: 36, from: 2500, to: 3800 },
  { maxLevel: 40, from: 4200, to: 6400 },
  { maxLevel: 44, from: 7000, to: 10500 },
];

/** 灵石：实测练气 42 / 筑基 79 / 结丹 103 / 元婴 138，之后按段 ×1.3 */
const GOLD_BASE = [
  { maxLevel: 12, from: 30, to: 55 },
  { maxLevel: 16, from: 70, to: 90 },
  { maxLevel: 20, from: 95, to: 115 },
  { maxLevel: 24, from: 125, to: 155 },
  { maxLevel: 28, from: 165, to: 200 },
  { maxLevel: 32, from: 215, to: 260 },
  { maxLevel: 36, from: 280, to: 340 },
  { maxLevel: 40, from: 365, to: 440 },
  { maxLevel: 44, from: 475, to: 570 },
];

function interpolate(table: Array<{ maxLevel: number; from: number; to: number }>, level: number): number {
  for (const band of table) {
    if (level > band.maxLevel) {
      continue;
    }
    const prevMax = table[table.indexOf(band) - 1]?.maxLevel ?? 0;
    const span = band.maxLevel - prevMax;
    const step = (band.to - band.from) / Math.max(1, span - 1);
    return band.from + (level - prevMax - 1) * step;
  }
  const last = table[table.length - 1];
  return last.to;
}

/** 精英更硬更值钱，boss 再上一档 */
const TYPE_MULT = {
  normal: { hp: 1, atk: 1, def: 1, xp: 1, gold: 1 },
  elite: { hp: 1.35, atk: 1.2, def: 1.15, xp: 1.6, gold: 1.7 },
  boss: { hp: 1.8, atk: 1.45, def: 1.3, xp: 2.5, gold: 3 },
} as const;

/* ------------------------------------------------------------------ */
/* 25 级起：怪的数值由「本段装备一身的参考玩家」反推                      */
/* ------------------------------------------------------------------ */

/**
 * 为什么不能按裸装成长外推（实测，25 级化神极品装备）：
 *   幽冥血刃 atk 54 → 13908、幽冥魔铠 hp 272 → 70053、def 34 → 8757（stage_mult = 257.5）
 *   而裸装玩家 atk 只有 458。穿上品一套后 atk≈24000 / hp≈67000 / def≈14000，
 *   且 stage_mult = 1.4^(境界-1)，**每升一级 ×1.4**；裸装只 ×1.117/级。
 *   若怪仍按裸装曲线涨，到 44 级两点差上百倍：玩家一击秒怪，
 *   而怪的破防是写死的 level*0.4（44 级才 17），打玩家 14000 防御只有 0.7% 伤害——两头都不成立。
 *
 * 所以怪的数值直接反推，且反推基准随装备一起涨，保证每个境界难度一致：
 *   怪 hp  = 参考玩家每回合期望伤害 × 减伤系数 × 目标击杀回合数
 *   怪 atk = 参考玩家血量 / 目标存活回合数 / 减伤系数 / 怪的技能倍率
 * 普通怪锚定「上品一套」、精英锚定「极品」、boss 锚定「仙品」。
 */

/** 暴击伤害倍率 */
const CRIT_MULT = 1.5;
/** 玩家主力技能倍率（元婴天裂斩 1.4；法宝带的技能同档） */
const PLAYER_SKILL_MUL = 1.4;
/** 怪会放技能，不能只按普攻算 */
const MONSTER_SKILL_MUL = 1.3;

/** 生成装备时烘进 items.effects 的品级种子倍率（equipment-instance-service 的 RARITY_SEED_MULT） */
const RARITY_SEED = { rare: 1.7, epic: 2.6, legendary: 3.8 } as const;

/** 目标回合数：toKill = 玩家打死怪要几回合；toDie = 玩家被怪打死能撑几回合 */
const TARGET_ROUNDS = {
  normal: { toKill: 4, toDie: 40 },
  elite: { toKill: 10, toDie: 24 },
  boss: { toKill: 15, toDie: 22 },
} as const;

/** 三种怪分别锚定的品级：上品打普通、极品打精英、仙品打 boss */
const ANCHOR_RARITY = { normal: "rare", elite: "epic", boss: "legendary" } as const;

/**
 * 真实管线修正系数（2026-10-19 实测，scripts/164-real-pipeline-balance.ts）。
 * 解析模型漏了真实属性聚合里的系统加成（其他 provider 给的 atk 约 +20%、
 * 神伤 13.4%、高气运在高气运roll下必暴击），真实玩家比模型强约 2 倍：
 *   实测化神 epic 一套（精炼0）打 25 级怪：普通 2.0 回合(目标4)、精英 5.5(目标10)、
 *   玩家撑 25.7 回合(normal，目标40)/13.4(elite，目标24)。
 * hp 系数 = 目标击杀回合 / 实测击杀回合（怪血偏低，×2.0/1.82）；
 * attack 系数 = 实测存活回合 / 目标存活回合（怪打得太疼，÷1.56/1.79）。
 * boss 无 25 级样本，沿用 elite 系数。
 */
const REAL_PIPELINE_HP_FACTOR = { normal: 2.0, elite: 1.82, boss: 1.82 } as const;
const REAL_PIPELINE_ATK_FACTOR = { normal: 0.64, elite: 0.56, boss: 0.56 } as const;

/**
 * monsters 的 hp/attack/defense 等列是 integer（int32，上限 2147483647）。
 * stage_mult = 1.4^(境界-1) 是指数增长，而「怪要打穿玩家防御所需的攻击」≈ 玩家血量×玩家防御，
 * 即 1.4^境界 的平方 —— 约 36 级起就会捅破 int32，这里必须截断。
 * 截断的后果是：高段怪打不动满装玩家（只能靠 hp 撑回合数），这是 1.4^境界 + int32 的固有上限，
 * 真要解决得把列改成 bigint 或下调 STAGE_STEP，不在本次范围内。
 */
function clampInt32(value: number): number {
  return Math.max(1, Math.min(2147483647, Math.round(value)));
}

/** 有效防御：破防按 penEff/(penEff+500) 比例无视，最多无视 80% */
function effectiveDefense(def: number, penEff: number): number {
  const p = Math.max(0, penEff);
  return Math.max(0, def * (1 - Math.min(0.8, p / (p + 500))));
}

/** 本段装备一身在 level 级时的战斗属性（用真实的 computeStageMult，避免公式漂移） */
function gearedPlayer(level: number, rarity: keyof typeof RARITY_SEED) {
  const band = BANDS.find((b) => level >= b.levels[0] && level <= b.levels[3]) ?? BANDS[BANDS.length - 1];
  const v = GEAR_VALUE[band.key];
  // items.effects 是按 epic 种子烘的，换品级要按种子比例换算
  const m = (RARITY_SEED[rarity] / RARITY_SEED.epic) * computeStageMult({
    itemMinRealm: band.levels[0],
    itemMaxRealm: band.levels[3],
    playerRealm: level,
    rarity,
  });
  // 裸装基础值（实测 25 级 atk 458 / def 231 / hp 4513），随境界 ×1.117/级
  const k = Math.pow(1.117, level - 25);
  return {
    atk: 458 * k + (v.atk + v.artifactAtk) * m,
    def: 231 * k + (v.armorDef + v.helmDef) * m,
    hp: 4513 * k + v.hp * m,
    speed: 24 * k + v.speed * m,
    luck: 30 * k + v.luck * m,
    pen: (v.weaponPen + v.artifactPen) * m,
  };
}

/** 每回合期望伤害：含破防/速度/气运加成、技能倍率、暴击期望、百分比减伤 */
function expectedDamage(
  a: { atk: number; pen: number; speed: number; luck: number; skillMul: number; flatBase: number },
  targetDef: number,
  penEff: number,
): number {
  const atkTerm = a.atk + a.pen * 0.28 + a.speed * 0.2 + a.luck * 0.1;
  const critRate = Math.min(0.95, 0.05 + a.luck / (a.luck + 900));
  const critAvg = 1 + critRate * (CRIT_MULT - 1);
  const mitigation = 100 / (100 + effectiveDefense(targetDef, penEff));
  return (atkTerm * a.skillMul + a.flatBase) * mitigation * critAvg;
}

function buildStats(level: number, type: keyof typeof TYPE_MULT) {
  const mult = TYPE_MULT[type];
  const xpReward = Math.round(interpolate(XP_BASE, level) * mult.xp);
  const goldReward = Math.round(interpolate(GOLD_BASE, level) * mult.gold);

  // 24 级及以下沿用既有实测曲线，不动原平衡
  if (level < 25) {
    return {
      hp: Math.round(interpolate(HP_BASE, level) * mult.hp),
      attack: Math.round(interpolate(ATK_BASE, level) * mult.atk),
      defense: Math.round(interpolate(DEF_BASE, level) * mult.def),
      armorPenetration: Math.floor(level * 0.4),
      speed: 30 + Math.floor(level / 2),
      luck: 5 + Math.floor(level / 4),
      spiritualSense: Math.floor(level * 1.5),
      block: Math.floor(level * 0.3),
      xpReward,
      goldReward,
    };
  }

  const p = gearedPlayer(level, ANCHOR_RARITY[type]);
  const target = TARGET_ROUNDS[type];

  /**
   * 防御必须是「常量级」，不能跟着攻击等比放大。
   * 减伤是 100/(100+effDef) 的百分比模型：def 若随攻击一起涨，减伤会趋近 0，
   * 玩家 dps 反而退化成常数 —— 实测就是 25→36 级 hp 只涨 1.7 倍、攻击却涨一万倍。
   * 取 effDef≈233（减伤约 30%），破防最多无视 80%，故 def = 233 / 0.2 ≈ 1165。
   */
  const defense = 1165;
  const block = Math.round(p.def * 0.2);
  // 怪的破防取参考玩家防御的 2 倍，否则打上万防御的玩家只有 0.7% 伤害、玩家根本不掉血
  const armorPenetration = Math.round(p.def * 2);

  // 玩家打怪：怪的格挡会削玩家的破防
  const dps = expectedDamage(
    { atk: p.atk, pen: p.pen, speed: p.speed, luck: p.luck, skillMul: PLAYER_SKILL_MUL, flatBase: 0 },
    defense,
    p.pen - block * 0.45,
  );
  const hp = clampInt32(dps * target.toKill * REAL_PIPELINE_HP_FACTOR[type]);

  // 怪打玩家（玩家本段装备无格挡，penEff 即破防本身）
  const playerMit = 100 / (100 + effectiveDefense(p.def, armorPenetration));
  const attack = clampInt32(p.hp / target.toDie / playerMit / MONSTER_SKILL_MUL * REAL_PIPELINE_ATK_FACTOR[type]);

  return {
    hp,
    attack,
    defense,
    armorPenetration,
    speed: Math.round(p.speed * 0.5),
    luck: Math.round(p.luck * 0.5),
    spiritualSense: Math.round(p.atk * 0.15),
    block,
    xpReward,
    goldReward,
  };
}

/* ------------------------------------------------------------------ */
/* 怪物名单（每级 6 只：4 普通 + 2 精英，段末那级把 1 只精英换成 boss） */
/* ------------------------------------------------------------------ */

const MONSTER_NAMES: Record<string, string[][]> = {
  huashen: [
    ["幽冥鬼卒", "蚀骨阴兵", "血河怨魂", "阴煞行者", "腐骨魔蛛", "冥途引魂使"],
    ["九幽煞将", "噬魂魔鸦", "幽泉螭吻", "冥火鬼修", "沉沦魔仆", "摄魄妖藤"],
    ["黄泉摆渡人", "幽冥骨将", "阴罗刹", "万魂幡主", "蚀心魔女", "幽渊魔鲤"],
    ["幽冥殿主", "九幽冥帅", "渊底古魔", "幽都鬼帝", "冥河老祖", "万魂之主"],
  ],
  lianxu: [
    ["太虚灵傀", "虚空游魂", "幻尘魔", "虚影刺客", "无相幻兽", "罡风精灵"],
    ["太虚剑魔", "虚空兽", "幻境妖姬", "破界魔兵", "虚灵守卫", "混沌气旋"],
    ["虚空巨兽", "太虚道魔", "幻灭魔君", "虚空吞噬者", "裂隙魔眼", "无量虚影"],
    ["太虚尊者", "虚空古兽", "混沌元魔", "破界魔尊", "无量道人", "太虚古神"],
  ],
  heti: [
    ["荒原狼王", "铁背犀兕", "烈焰狮鹫", "毒沼巨蟒", "狂沙蝎王", "裂地熊妖"],
    ["吞天巨蟒", "雷翼鹏鸟", "荒古蛮牛", "幽影猎豹", "熔岩巨兽", "图腾守卫"],
    ["远古龙龟", "九头相柳", "荒原兽王", "血鬃狮王", "山岳巨猿", "噬金蚁后"],
    ["万兽之主", "荒古穷奇", "吞天巨兽", "万兽图腾", "远古凶犼", "荒原兽神"],
  ],
  dacheng: [
    ["云海鲲鹏", "九霄雷将", "天罡神将", "罡风虎", "凌霄剑灵", "玄天真君"],
    ["破军星君", "天河市舶", "九霄雷部", "玄霄魔将", "云中君", "天枢守卫"],
    ["大乘魔君", "九霄战神", "混元道人", "太乙散仙", "玄都统领", "天狼星主"],
    ["九霄帝君", "大乘道尊", "混元天尊", "太乙道祖", "玄都天主", "九霄神王"],
  ],
  dujie: [
    ["劫云魔将", "应劫凶兽", "天雷战傀", "灭世魔兵", "劫火麒麟", "雷池守卫"],
    ["天劫执法", "九天真魔", "混沌凶神", "劫渊魔君", "太古雷兽", "灭道修士"],
    ["应劫真魔", "灭世天妖", "混沌祖龙", "劫灭道人", "太古凶神", "天道守卫"],
    ["渡劫天魔", "亘古邪神", "灭世凶神", "应劫道尊", "混沌魔祖", "天道化身"],
  ],
};

/* ------------------------------------------------------------------ */
/* 高段装备 / 丹药                                                      */
/* 每段 5 件装备 + 2 种丹药。属性值按元婴段实测基准外推（每段 ×1.7）：   */
/* 元婴(21)：武器 atk32 / 甲胄 hp160+def20 / 头盔 def16 / 靴 speed8+luck4 / 法宝 atk28 */
/* ------------------------------------------------------------------ */

/**
 * 注意 weaponPen / artifactPen（破防）不能省。
 * 减伤公式是 effDef = def × (1 - min(0.8, pen/(pen+500)))；玩家穿满一套后 def 上万，
 * 若破防为 0，怪打玩家只有 100/(100+14000) ≈ 0.7% 伤害——玩家根本不掉血，战斗没有意义。
 * 元婴武器（裂天断刃 atk156/pen47）就是这个量级，本表按 atk 的约 1/4 配破防。
 */
const GEAR_VALUE = {
  huashen: { atk: 54, weaponPen: 14, hp: 272, armorDef: 34, helmDef: 27, speed: 14, luck: 7, artifactAtk: 48, artifactPen: 12, sense: 3 },
  lianxu: { atk: 92, weaponPen: 23, hp: 462, armorDef: 58, helmDef: 46, speed: 24, luck: 12, artifactAtk: 82, artifactPen: 20, sense: 5 },
  heti: { atk: 156, weaponPen: 39, hp: 785, armorDef: 99, helmDef: 78, speed: 41, luck: 20, artifactAtk: 139, artifactPen: 34, sense: 8 },
  dacheng: { atk: 265, weaponPen: 66, hp: 1335, armorDef: 168, helmDef: 133, speed: 70, luck: 34, artifactAtk: 236, artifactPen: 58, sense: 13 },
  dujie: { atk: 450, weaponPen: 112, hp: 2270, armorDef: 285, helmDef: 226, speed: 119, luck: 58, artifactAtk: 401, artifactPen: 98, sense: 22 },
} as const;

const GEAR_NAMES = {
  huashen: { weapon: "幽冥血刃", armor: "幽冥魔铠", helmet: "幽冥鬼面", shoes: "幽冥魔履", artifact: "摄魂幡" },
  lianxu: { weapon: "太虚断刃", armor: "太虚幻甲", helmet: "太虚灵冠", shoes: "太虚踏云履", artifact: "太虚镇灵塔" },
  heti: { weapon: "裂骨血斧", armor: "万兽血铠", helmet: "兽王战盔", shoes: "荒原疾影靴", artifact: "万兽镇魂印" },
  dacheng: { weapon: "九霄斩天剑", armor: "九霄云纹甲", helmet: "九霄星冠", shoes: "九霄踏云靴", artifact: "九霄镇天印" },
  dujie: { weapon: "劫灭魔刃", armor: "应劫玄甲", helmet: "应劫战盔", shoes: "劫云踏空靴", artifact: "灭世劫幡" },
} as const;

/** 修为丹 / 回血丹。元婴基准：婴元天露 xp6400、九转回命散 hp320+mp200，每段 ×1.45 */
const PILL_VALUE = {
  huashen: { xp: 9600, heal: 480, mp: 300 },
  lianxu: { xp: 14000, heal: 700, mp: 440 },
  heti: { xp: 20000, heal: 1000, mp: 640 },
  dacheng: { xp: 29000, heal: 1450, mp: 920 },
  dujie: { xp: 42000, heal: 2100, mp: 1340 },
} as const;

const MONSTER_DESCRIPTIONS: Record<string, string> = {
  huashen: "幽冥魔渊中游荡的阴煞之物，周身缠绕着化神期才有的尸气与怨念。",
  lianxu: "太虚幻境里的虚空造物，身形虚实不定，寻常攻击难以命中。",
  heti: "万兽荒原的蛮荒巨兽，皮糙肉厚，合体期修士亦要避其锋芒。",
  dacheng: "九霄云海上的天兵神将，身负大乘威压，寻常修士难以直视。",
  dujie: "天劫道场中应劫而生的存在，每一击都带着天道雷劫的余威。",
};

/* ------------------------------------------------------------------ */
/* 地图                                                                 */
/* ------------------------------------------------------------------ */

const MAPS = [
  { id: "map_high_realm_youming", name: "幽冥魔渊", minRealm: 25, band: "huashen", desc: "阴气汇聚的九幽入口，化神期修士历练的第一处险地。" },
  { id: "map_high_realm_taixu", name: "太虚幻境", minRealm: 29, band: "lianxu", desc: "空间裂隙交织的幻境，虚实难辨，炼虚期方可踏足。" },
  { id: "map_high_realm_wanshou", name: "万兽荒原", minRealm: 33, band: "heti", desc: "蛮兽盘踞的无垠荒野，这里只有力量能说话。" },
  { id: "map_high_realm_jiuxiao", name: "九霄云海", minRealm: 37, band: "dacheng", desc: "云海之上的天兵驻地，大乘修士方有资格登临。" },
  { id: "map_high_realm_tianjie", name: "天劫道场", minRealm: 41, band: "dujie", desc: "天道降劫之地，踏入者皆是与天争命的渡劫修士。" },
] as const;

const LIETIANXU_ID = "map_four_realms_lietianxu";
const MAP_WIDTH = 24;
const MAP_HEIGHT = 24;

type TileData = {
  x: number;
  y: number;
  type: string;
  walkable: boolean;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
  portalTargetPortalId?: string;
};

/** 确定性伪随机，保证每次生成同样的地形 */
function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildMapTiles(
  seed: number,
  portals: Array<{ x: number; y: number; portalId: string; portalName: string; targetMapId: string; targetPortalId: string }>,
): TileData[] {
  const tiles: TileData[] = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const isEdge = x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1;
      if (isEdge) {
        tiles.push({ x, y, type: "mountain", walkable: false });
        continue;
      }
      tiles.push({ x, y, type: "grass", walkable: true });
    }
  }

  // 散布障碍：山石与深水，占内圈约 10%，避开传送门附近
  const isNearPortal = (x: number, y: number) => portals.some((p) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2);
  for (let y = 1; y < MAP_HEIGHT - 1; y += 1) {
    for (let x = 1; x < MAP_WIDTH - 1; x += 1) {
      const roll = pseudoRandom(seed + x * 31 + y * 17);
      if (roll < 0.07 && !isNearPortal(x, y)) {
        const index = tiles.findIndex((tile) => tile.x === x && tile.y === y);
        tiles[index] = { x, y, type: "mountain", walkable: false };
      } else if (roll > 0.965 && !isNearPortal(x, y)) {
        const index = tiles.findIndex((tile) => tile.x === x && tile.y === y);
        tiles[index] = { x, y, type: "water", walkable: false };
      }
    }
  }

  for (const portal of portals) {
    const index = tiles.findIndex((tile) => tile.x === portal.x && tile.y === portal.y);
    tiles[index] = {
      x: portal.x,
      y: portal.y,
      type: "portal",
      walkable: true,
      portalId: portal.portalId,
      portalName: portal.portalName,
      portalTargetMapId: portal.targetMapId,
      portalTargetPortalId: portal.targetPortalId,
    };
  }

  return tiles;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

let createdMaps = 0;
let createdMonsters = 0;
let createdMaterials = 0;
let createdGear = 0;
let createdRecipes = 0;
let xpUpdated = 0;

/**
 * 材料。
 * 注意 itemType 只能是 "material"（装备/消耗品才是 weapon/armor/... 那些）——
 * 我第一版写成了 "smithing_material" / "alchemy_material"，那是凭空造的类型，
 * 炼器/炼丹页按 item_type 取材料时会取不到，这里一并修正。
 */
async function upsertMaterials() {
  for (const band of BANDS) {
    const materials = [
      { name: `${band.label}玄铁`, usage: "炼器主材，用于锻造本阶兵刃与护甲。" },
      { name: `${band.label}灵晶`, usage: "炼器辅材，能稳住本阶法器的灵性。" },
      { name: `${band.label}灵草`, usage: "炼丹主材，本阶丹药的药引。" },
      { name: `${band.label}妖丹`, usage: "炼丹辅材，取自本阶妖兽内丹。" },
    ];
    for (const [index, material] of materials.entries()) {
      const id = `item_four_realms_${band.key}_material_${index + 1}`;
      await db.insert(items).values({
        id,
        name: material.name,
        description: material.usage,
        itemType: "material",
        rarity: "rare",
        minRealm: band.levels[0],
        stackable: true,
        isBound: false,
        price: 60 + index * 10 + (BANDS.indexOf(band) * 40),
      }).onConflictDoUpdate({
        target: items.id,
        set: { itemType: "material", name: material.name, description: material.usage },
      }).run();
      createdMaterials += 1;
    }
  }
}

/** 装备 + 丹药。没有这些，高段材料就是死材料，玩家也永远打不过高段怪 */
async function upsertGearAndPills() {
  for (const [bandIndex, band] of BANDS.entries()) {
    const value = GEAR_VALUE[band.key];
    const names = GEAR_NAMES[band.key];
    const pill = PILL_VALUE[band.key];

    const gears: Array<{
      id: string;
      name: string;
      itemType: "weapon" | "armor" | "helmet" | "shoes" | "artifact" | "consumable";
      description: string;
      effects: ItemEffect[];
      price: number;
    }> = [
      {
        id: `item_four_realms_${band.key}_weapon`,
        name: names.weapon,
        itemType: "weapon",
        description: `${band.label}期主兵，锋芒内敛，出手必见血。`,
        effects: [
          { type: "boost_atk", value: value.atk },
          { type: "boost_armor_penetration", value: value.weaponPen },
          { type: "boost_spiritual_sense", value: value.sense },
        ],
        price: 260 + BANDS.indexOf(band) * 180,
      },
      {
        id: `item_four_realms_${band.key}_armor`,
        name: names.armor,
        itemType: "armor",
        description: `以${band.label}期妖兽皮骨炼成的护甲，可硬接本阶术法。`,
        effects: [
          { type: "boost_hp", value: value.hp },
          { type: "boost_def", value: value.armorDef },
        ],
        price: 240 + BANDS.indexOf(band) * 170,
      },
      {
        id: `item_four_realms_${band.key}_helmet`,
        name: names.helmet,
        itemType: "helmet",
        description: `护住识海的${band.label}期战盔。`,
        effects: [
          { type: "boost_def", value: value.helmDef },
          { type: "boost_spiritual_sense", value: value.sense },
        ],
        price: 200 + BANDS.indexOf(band) * 150,
      },
      {
        id: `item_four_realms_${band.key}_shoes`,
        name: names.shoes,
        itemType: "shoes",
        description: `踏空而行的${band.label}期战履。`,
        effects: [
          { type: "boost_speed", value: value.speed },
          { type: "boost_luck", value: value.luck },
        ],
        price: 190 + BANDS.indexOf(band) * 140,
      },
      {
        id: `item_four_realms_${band.key}_artifact`,
        name: names.artifact,
        itemType: "artifact",
        description: `${band.label}期法器，攻守兼备。`,
        effects: [
          { type: "boost_atk", value: value.artifactAtk },
          { type: "boost_armor_penetration", value: value.artifactPen },
          { type: "boost_skill_damage_bonus", value: Math.max(1, Math.round(value.sense * 1.5)) },
        ],
        price: 300 + BANDS.indexOf(band) * 200,
      },
      {
        id: `item_four_realms_${band.key}_xp_pill`,
        name: `${band.label}元露`,
        itemType: "consumable",
        description: `${band.label}期修士常用的修为丹药。`,
        effects: [{ type: "boost_xp", value: pill.xp }],
        price: 120 + BANDS.indexOf(band) * 90,
      },
      {
        id: `item_four_realms_${band.key}_heal_pill`,
        name: `${band.label}回命散`,
        itemType: "consumable",
        description: `${band.label}期疗伤丹药，可同时回复气血与灵力。`,
        effects: [
          { type: "heal_hp", value: pill.heal },
          { type: "heal_mp", value: pill.mp },
        ],
        price: 110 + BANDS.indexOf(band) * 80,
      },
    ];

    for (const gear of gears) {
      const isConsumable = gear.itemType === "consumable";
      await db.insert(items).values({
        id: gear.id,
        name: gear.name,
        description: gear.description,
        itemType: gear.itemType,
        rarity: "epic",
        minRealm: band.levels[0],
        // maxRealm 必须写死为本段末级：stage_mult = 1.4^(境界-1)，
        // 不封顶的话化神装到渡劫期会被放大 1.4^19 ≈ 600 倍，彻底失控。
        maxRealm: band.levels[3],
        stackable: isConsumable,
        isBound: false,
        price: gear.price,
        effects: gear.effects,
      }).onConflictDoUpdate({
        target: items.id,
        set: {
          name: gear.name,
          description: gear.description,
          itemType: gear.itemType,
          minRealm: band.levels[0],
          maxRealm: band.levels[3],
          stackable: isConsumable,
          price: gear.price,
          effects: gear.effects,
        },
      }).run();
      createdGear += 1;

      if (isConsumable) continue;

      // 品级变体（方案A，2026-10-20）：打造掷品级需要同段同部位存在各品级物品。
      // effects 按 RARITY_SEED_MULT 比例缩放——computeStageMult 反解时按同表除回，
      // 最终生效值 = 基数 × POWER(境界) × RARITY_EFFECTIVE_MULT，与主线装备完全同构。
      const rarityLabels: Record<string, string> = {
        common: "凡品", uncommon: "良品", rare: "上品", epic: "极品", legendary: "仙品", hongmeng: "鸿蒙",
      };
      for (const rarity of ["common", "uncommon", "rare", "legendary", "hongmeng"] as const) {
        const ratio = RARITY_SEED_MULT[rarity] / RARITY_SEED_MULT.epic;
        const variantEffects = gear.effects.map((effect) => ({
          ...effect,
          value: Math.max(1, Math.round(effect.value * ratio)),
        }));
        const variantId = `${gear.id}_${rarity}`;
        await db.insert(items).values({
          id: variantId,
          name: `${gear.name}·${rarityLabels[rarity]}`,
          description: gear.description,
          itemType: gear.itemType,
          rarity,
          minRealm: band.levels[0],
          maxRealm: band.levels[3],
          stackable: false,
          isBound: false,
          price: Math.max(1, Math.round(gear.price * ratio)),
          effects: variantEffects,
        }).onConflictDoUpdate({
          target: items.id,
          set: {
            name: `${gear.name}·${rarityLabels[rarity]}`,
            itemType: gear.itemType,
            minRealm: band.levels[0],
            maxRealm: band.levels[3],
            price: Math.max(1, Math.round(gear.price * ratio)),
            effects: variantEffects,
          },
        }).run();
        createdGear += 1;
      }
    }
  }
}

/**
 * 配方：让材料有出口，玩家才有变强的路径。
 * 这两张表没有 Drizzle 模型（在 schema.ts 里没有），跟 smithing-service 一样走 raw SQL，
 * 用 recipe_code 做幂等键。
 */
async function upsertRecipes() {
  for (const [bandIndex, band] of BANDS.entries()) {
    const mat = (n: number) => `item_four_realms_${band.key}_material_${n}`;
    const matName = (n: number) => (
      [`${band.label}玄铁`, `${band.label}灵晶`, `${band.label}灵草`, `${band.label}妖丹`][n - 1]
    );

    const smithing = [
      { slot: "weapon", main: 1, mainQty: 3, aux: 2, auxQty: 2, rate: 0.72 },
      { slot: "armor", main: 2, mainQty: 3, aux: 1, auxQty: 2, rate: 0.7 },
      { slot: "helmet", main: 2, mainQty: 2, aux: 3, auxQty: 1, rate: 0.68 },
      { slot: "shoes", main: 1, mainQty: 2, aux: 4, auxQty: 1, rate: 0.66 },
      { slot: "artifact", main: 2, mainQty: 2, aux: 4, auxQty: 2, rate: 0.66 },
    ];

    for (const [slotIndex, recipe] of smithing.entries()) {
      const resultId = `item_four_realms_${band.key}_${recipe.slot}`;
      const resultName = GEAR_NAMES[band.key][recipe.slot as keyof typeof GEAR_NAMES.huashen];
      const code = `recipe_${band.key}_${recipe.slot}`;
      await db.execute(sql`
        INSERT INTO "smithing_recipes" (
          "recipe_code",
          "result_item_id","result_item_name","result_quantity",
          "main_item_id","main_item_name","main_quantity",
          "base_success_rate",
          "aux_a_item_id","aux_a_item_name","aux_a_quantity","aux_a_bonus_rate",
          "enabled","sort_order","created_at","updated_at"
        )
        VALUES (
          ${code},
          ${resultId},${resultName},1,
          ${mat(recipe.main)},${matName(recipe.main)},${recipe.mainQty},
          ${recipe.rate},
          ${mat(recipe.aux)},${matName(recipe.aux)},${recipe.auxQty},0,
          true,${bandIndex * 10 + slotIndex},NOW()::text,NOW()::text
        )
        -- 必须写冲突目标：recipe_code 无唯一约束时裸 DO NOTHING 永远不生效，
        -- seed 脚本每跑一次就把全部配方再插一遍（线上曾积到 5 份）
        ON CONFLICT ("recipe_code") DO NOTHING
      `);
      createdRecipes += 1;
    }

    const alchemy = [
      { kind: "xp_pill", name: `${band.label}元露`, main: 3, mainQty: 2, aux: 4, auxQty: 1, rate: 0.62 },
      { kind: "heal_pill", name: `${band.label}回命散`, main: 3, mainQty: 1, aux: 4, auxQty: 1, rate: 0.6 },
    ];

    for (const [pillIndex, recipe] of alchemy.entries()) {
      const code = `recipe_${band.key}_${recipe.kind}`;
      await db.execute(sql`
        INSERT INTO "alchemy_recipes" (
          "recipe_code",
          "result_item_id","result_item_name","result_quantity",
          "main_item_id","main_item_name","main_quantity",
          "base_success_rate",
          "aux_a_item_id","aux_a_item_name","aux_a_quantity","aux_a_bonus_rate",
          "enabled","sort_order","created_at","updated_at"
        )
        VALUES (
          ${code},
          ${`item_four_realms_${band.key}_${recipe.kind}`},${recipe.name},1,
          ${mat(recipe.main)},${matName(recipe.main)},${recipe.mainQty},
          ${recipe.rate},
          ${mat(recipe.aux)},${matName(recipe.aux)},${recipe.auxQty},0,
          true,${bandIndex * 10 + pillIndex},NOW()::text,NOW()::text
        )
        ON CONFLICT ("recipe_code") DO NOTHING
      `);
      createdRecipes += 1;
    }
  }
}

async function upsertMapsAndEdges() {
  for (const [index, map] of MAPS.entries()) {
    const nextMap = MAPS[index + 1];
    // 入口（回裂天墟或上一张图）+ 出口（去下一张图）
    const entryTargetId = index === 0 ? LIETIANXU_ID : MAPS[index - 1].id;
    const entryPortalId = `portal_${map.id}_to_${entryTargetId}`;
    const entryTargetPortalId = index === 0
      ? `portal_lietianxu_to_${map.id}`
      : `portal_${MAPS[index - 1].id}_to_${map.id}`;

    const portals = [{
      x: 3,
      y: 20,
      portalId: entryPortalId,
      portalName: `回返${index === 0 ? "裂天墟" : MAPS[index - 1].name}的传送阵`,
      targetMapId: entryTargetId,
      targetPortalId: entryTargetPortalId,
    }];

    if (nextMap) {
      portals.push({
        x: 20,
        y: 3,
        portalId: `portal_${map.id}_to_${nextMap.id}`,
        portalName: `前往${nextMap.name}的传送阵`,
        targetMapId: nextMap.id,
        targetPortalId: `portal_${nextMap.id}_to_${map.id}`,
      });
    }

    const tilesData = buildMapTiles(index * 97 + 13, portals);
    const existing = await db.select({ id: maps.id }).from(maps).where(sql`${maps.id} = ${map.id}`).get();
    if (!existing) {
      createdMaps += 1;
    }
    await db.insert(maps).values({
      id: map.id,
      name: map.name,
      description: map.desc,
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      minRealm: map.minRealm,
      mapType: "field",
      tilesData,
    }).onConflictDoUpdate({
      target: maps.id,
      set: { name: map.name, description: map.desc, minRealm: map.minRealm, tilesData, width: MAP_WIDTH, height: MAP_HEIGHT },
    }).run();

    // 上一张图（或裂天墟）侧要加一个指向这张图的传送门，否则玩家走不过来
    const backMapId = index === 0 ? LIETIANXU_ID : MAPS[index - 1].id;
    const backPortalId = index === 0
      ? `portal_lietianxu_to_${map.id}`
      : `portal_${MAPS[index - 1].id}_to_${map.id}`;
    const backTargetPortalId = entryPortalId;
    await addPortalToMap(backMapId, {
      x: index === 0 ? 5 : 20,
      y: index === 0 ? 3 : 20,
      portalId: backPortalId,
      portalName: `前往${map.name}的传送阵`,
      targetMapId: map.id,
      targetPortalId: backTargetPortalId,
    });

    await db.insert(mapEdges).values({ mapAId: backMapId, mapBId: map.id })
      .onConflictDoNothing().run();
  }
}

async function addPortalToMap(mapId: string, portal: {
  x: number; y: number; portalId: string; portalName: string; targetMapId: string; targetPortalId: string;
}) {
  const row = await db.select({ tilesData: maps.tilesData }).from(maps).where(sql`${maps.id} = ${mapId}`).get();
  if (!row) {
    console.log(`  [跳过] 地图 ${mapId} 不存在，无法挂传送门`);
    return;
  }
  const tiles = (Array.isArray(row.tilesData) ? row.tilesData : []) as TileData[];
  if (tiles.some((tile) => tile.portalId === portal.portalId)) {
    return;
  }
  const width = tiles.length > 0 ? Math.max(...tiles.map((tile) => tile.x)) + 1 : MAP_WIDTH;
  const height = tiles.length > 0 ? Math.max(...tiles.map((tile) => tile.y)) + 1 : MAP_HEIGHT;
  const safeX = Math.min(Math.max(1, portal.x), width - 2);
  const safeY = Math.min(Math.max(1, portal.y), height - 2);
  const index = tiles.findIndex((tile) => tile.x === safeX && tile.y === safeY);
  const next = [...tiles];
  next[index] = {
    x: safeX,
    y: safeY,
    type: "portal",
    walkable: true,
    portalId: portal.portalId,
    portalName: portal.portalName,
    portalTargetMapId: portal.targetMapId,
    portalTargetPortalId: portal.targetPortalId,
  };
  await db.update(maps).set({ tilesData: next }).where(sql`${maps.id} = ${mapId}`).run();
}

/** 段内怪物坐标：在内圈均匀铺开，避开传送门两格内 */
function monsterPosition(mapIndex: number, ordinal: number): { x: number; y: number } {
  const x = 3 + ((ordinal * 5 + mapIndex * 2) % 18);
  const y = 3 + ((ordinal * 7 + mapIndex * 3) % 18);
  return { x: Math.min(20, x), y: Math.min(20, y) };
}

async function upsertMonsters() {
  for (const [mapIndex, map] of MAPS.entries()) {
    const band = BANDS.find((item) => item.key === map.band)!;
    const names = MONSTER_NAMES[map.band];
    let ordinal = 0;
    for (const [levelIndex, level] of band.levels.entries()) {
      for (const [nameIndex, name] of names[levelIndex].entries()) {
        const isLastLevel = levelIndex === 3;
        const type: keyof typeof TYPE_MULT = isLastLevel && nameIndex >= 5
          ? "boss"
          : nameIndex >= 4
            ? "elite"
            : "normal";
        const id = `monster_high_realm_${map.band}_${level}_${nameIndex + 1}`;
        const stats = buildStats(level, type);
        const position = monsterPosition(mapIndex, ordinal);
        const materialIndex = (levelIndex % 4) + 1;
        const drops = [
          {
            chance: 0.45 + levelIndex * 0.05,
            itemId: `item_four_realms_${map.band}_material_${materialIndex}`,
            minQuantity: 1,
            maxQuantity: type === "boss" ? 3 : 2,
          },
          {
            chance: 0.25,
            itemId: `item_four_realms_${map.band}_material_${(materialIndex % 4) + 1}`,
            minQuantity: 1,
            maxQuantity: 1,
          },
        ];

        const existing = await db.select({ id: monsters.id }).from(monsters).where(sql`${monsters.id} = ${id}`).get();
        const values = {
          name,
          description: MONSTER_DESCRIPTIONS[map.band],
          monsterType: type,
          level,
          hp: stats.hp,
          attack: stats.attack,
          defense: stats.defense,
          // 25 级起这些都由 buildStats 按参考玩家反推（写死成 level*系数 在高段等于没有）
          speed: stats.speed,
          luck: stats.luck,
          spiritualSense: stats.spiritualSense,
          armorPenetration: stats.armorPenetration,
          block: stats.block,
          skillDamageBonus: Math.floor(level * 0.6),
          skillDamageReduction: Math.floor(level * 0.4),
          artifactDamageBonus: Math.floor(level * 0.3),
          artifactDamageReduction: Math.floor(level * 0.2),
          xpReward: stats.xpReward,
          goldReward: stats.goldReward,
          mapId: map.id,
          positionX: position.x,
          positionY: position.y,
          respawnSeconds: type === "boss" ? 900 : type === "elite" ? 420 : 240,
          drops,
          skills: [],
        };

        if (!existing) {
          createdMonsters += 1;
          await db.insert(monsters).values({ id, ...values }).run();
        } else {
          await db.update(monsters).set(values).where(sql`${monsters.id} = ${id}`).run();
        }
        ordinal += 1;
      }
    }
  }
}

/** 给所有现有怪物按等级补 xp_reward（原来全是 0，打怪一滴修为都不给） */
async function backfillXpReward() {
  const rows = await db.select({ id: monsters.id, level: monsters.level, monsterType: monsters.monsterType })
    .from(monsters).all();

  for (const row of rows) {
    const level = Number(row.level) || 1;
    const type = (["normal", "elite", "boss"].includes(String(row.monsterType))
      ? String(row.monsterType)
      : "normal") as keyof typeof TYPE_MULT;
    const stats = buildStats(level, type);
    const existing = await db.select({ xpReward: monsters.xpReward, goldReward: monsters.goldReward })
      .from(monsters).where(sql`${monsters.id} = ${row.id}`).get();
    if (existing && existing.xpReward === stats.xpReward && existing.goldReward > 0) {
      continue;
    }
    await db.update(monsters).set({
      xpReward: stats.xpReward,
      // 灵石缺失的也一并补上（有的话）
      goldReward: existing && existing.goldReward > 0 ? existing.goldReward : stats.goldReward,
    }).where(sql`${monsters.id} = ${row.id}`).run();
    xpUpdated += 1;
  }
}

async function main() {
  console.log("=== 高境界内容补齐（化神 ~ 渡劫）===\n");

  console.log("1) 段位材料");
  await upsertMaterials();
  console.log(`   材料 ${createdMaterials} 个（item_type=material）`);

  console.log("2) 装备与丹药");
  await upsertGearAndPills();
  console.log(`   装备/丹药 ${createdGear} 件`);

  console.log("3) 配方（材料→装备/丹药）");
  await upsertRecipes();
  console.log(`   配方 ${createdRecipes} 条`);

  console.log("4) 地图与传送网络");
  await upsertMapsAndEdges();
  console.log(`   新建地图 ${createdMaps} 张（另给裂天墟/相邻图挂了入口传送门）`);

  console.log("5) 怪物（25 级以上按玩家成长曲线定数值）");
  await upsertMonsters();
  console.log(`   新建/更新怪物 ${createdMonsters} 只`);

  console.log("6) 补写 xp_reward（原为全 0）");
  await backfillXpReward();
  console.log(`   更新 ${xpUpdated} 只`);

  const total = await db.select({ count: sql<number>`count(*)::int` }).from(monsters).get();
  console.log(`\n怪物总数：${total?.count ?? 0}`);
}

main().then(() => process.exit(0)).catch((error) => { console.error("ERR:", String(error)); process.exit(1); });
