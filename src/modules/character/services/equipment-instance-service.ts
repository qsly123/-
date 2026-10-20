/**
 * 装备实例：阶段系数 + 专精词条。
 *
 * 两件事，都挂在**实例**（player_inventory 行）上，items 表不动：
 *
 * 1. **阶段系数**（stage_mult）
 *    装备的基础值在 items.effects 里是写死的（按大境界段 × 品质倍率生成的），
 *    同样是「筑基凡品剑」，筑基初期打造和筑基中期打造拿到的一模一样。
 *    这里按玩家当前小境界给实例乘一个系数，让「什么时候打出来」也影响强弱。
 *
 * 2. **专精词条**（affixes）
 *    只有极品（epic）及以上才有词条，仙品 > 极品。分数值 / 概率 / 技能三类。
 *    词条**全池可出**（不按流派切分，否则装备绑死流派、交易所没法流通），
 *    流派只在 AFFIX_PATH_PREFERENCE 里做加权。
 *
 * 历史注记：曾有过第三件事「炼器专精」（player_smithing_specializations，
 * 打造涨熟练度、提升成功率与品质跃升概率），2026-10-20 按产品决策（方案A）移除——
 * 打造品级改为概率随机（rollCraftRarityItemId），专精成为不可见的长线肝度，体验差。
 * 旧表留在库里无引用，无副作用。
 *
 * ## 数值递进为什么长这样
 *
 * 需求给了两条硬规则（用「筑基」举例，初期=13、中期=14）：
 *   A. 中期下品 > 初期上品
 *   B. 中期上品 > 初期神话
 *
 * 这两条规则**数学上要求「每阶的增幅」大于「品级之间的倍率差」**。
 * 装备生成时用的品质倍率是 0.7 / 1 / 1.7 / 2.6 / 3.8，上品/下品 = 2.43 倍；
 * 若每阶也按 2.5 倍递增，从练气一层到元婴末期要乘 2.5^43，直接溢出 int。
 * 所以这里**把品级的倍率差压缩**（0.85~1.55，极差 1.8 倍），
 * 阶段步长取 1.4 —— 两条规则都成立（A 余量 6%，B 余量 12%），数值也不溢出。
 *
 * 代价要说清楚：品级对**基础值**的影响变小了（仙品只比凡品高 65%）。
 * 品级的价值主要体现在**词条**上（凡品~上品根本没有词条），这是有意的取舍。
 */

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { isDamagePercentageStat } from "@/modules/character/services/equipment-stat-rules";
import {
  items,
  playerInventory,
  playerSmithingSpecializations,
  playerTalents,
  players,
  skills,
} from "@/db/schema";

/* ------------------------------------------------------------------ 数值阶梯 */

/** 每一阶（线性境界 +1）的增幅。需求的两条递进规则要求它 > 品级倍率差。 */
export const STAGE_STEP = 1.4;

/**
 * 生效的品质倍率（压缩后）。
 * 注意与生成装备时用的旧倍率（0.7/1/1.7/2.6/3.8）不同——旧倍率已经烘进 items.effects，
 * 在算 stage_mult 时会把它除掉，换成这套。
 */
export const RARITY_EFFECTIVE_MULT: Record<string, number> = {
  common: 0.85, // 下品
  uncommon: 1, // 中品
  rare: 1.12, // 上品
  epic: 1.25, // 史诗（极品）
  legendary: 1.4, // 神话（仙品）
  hongmeng: 1.55, // 鸿蒙
};

/** 生成装备时用的旧品质倍率，用于反解出「段倍率 × 品质」之外的部分。 */
export const RARITY_SEED_MULT: Record<string, number> = {
  common: 0.7,
  uncommon: 1,
  rare: 1.7,
  epic: 2.6,
  legendary: 3.8,
  // 鸿蒙的原始数据比仙品更强（items.effects 按 4.6 生成，见 scripts/seed-hongmeng-equipment.ts）。
  // 这个值参与 stage_mult 的反解，改了就等于改最终数值——动了记得同步那些装备的 effects。
  hongmeng: 4.6,
};

/** 生成装备时的境界段倍率（见 scripts/seed-equipment.ts 的 SEGMENTS）。 */
const SEGMENT_SEED_MULT = [
  { min: 1, max: 12, mult: 1 }, // 练气
  { min: 13, max: 16, mult: 2 }, // 筑基
  { min: 17, max: 20, mult: 3.5 }, // 结丹
  { min: 21, max: 44, mult: 6 }, // 元婴
] as const;

/** 品级顺序，用于打造时的品质跃升。 */
export const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "hongmeng"] as const;

export function powerOfRealm(realmLinear: number): number {
  const realm = Math.max(1, Math.floor(Number(realmLinear) || 1));
  return Math.pow(STAGE_STEP, realm - 1);
}

function segmentSeedMult(minRealm: number | null): number {
  const value = Math.max(1, Math.floor(Number(minRealm) || 1));
  return SEGMENT_SEED_MULT.find((segment) => value >= segment.min && value <= segment.max)?.mult ?? 1;
}

/**
 * 算实例的阶段系数：最终值 = items.effects 里的值 × 本系数
 *                = 部位基数 × POWER(境界) × 生效品质倍率
 *
 * 玩家境界会被夹到装备自己的可用区间（minRealm~maxRealm）内，
 * 否则拿元婴期的境界去打练气装备，练气装备会强得离谱。
 */
export function computeStageMult(params: {
  itemMinRealm?: number | null;
  itemMaxRealm?: number | null;
  playerRealm: number;
  rarity: string;
}): number {
  const min = Math.max(1, Math.floor(Number(params.itemMinRealm) || 1));
  const max = Math.max(min, Math.floor(Number(params.itemMaxRealm) || 44));
  const realm = Math.min(Math.max(Math.floor(Number(params.playerRealm) || 1), min), max);

  const seedRarity = RARITY_SEED_MULT[params.rarity] ?? 1;
  const effectiveRarity = RARITY_EFFECTIVE_MULT[params.rarity] ?? 1;
  const denominator = segmentSeedMult(min) * seedRarity;

  return (powerOfRealm(realm) / denominator) * effectiveRarity;
}

/** 会走「阶段系数 + 词条」的部位。 */
export const EQUIPMENT_ITEM_TYPES = new Set(["weapon", "armor", "helmet", "shoes", "artifact"]);

/* ------------------------------------------------------------------ 词条 */

export type EquipmentAffixKind = "stat" | "rate" | "skill";

export interface EquipmentAffixEntry {
  kind: EquipmentAffixKind;
  /** stat: 属性键；rate: 概率键；skill: 固定 "skill"。 */
  key: string;
  label: string;
  flat?: number;
  percent?: number;
  chance?: number;
  skillId?: string;
  skillName?: string;
}

/** 概率类词条键（消费端见 getPlayerEquipmentRateBonuses 的调用方）。 */
export const RATE_AFFIX_LABELS: Record<string, string> = {
  rate_crit: "暴击率",
  rate_block: "格挡率",
  rate_alchemy_success: "炼丹成功率",
  rate_smithing_success: "炼器成功率",
};

interface AffixDef {
  kind: EquipmentAffixKind;
  key: string;
  label: string;
  /** flat 的基数（会随境界放大）；percent/chance 的基数（不随境界放大）。技能类词条没有数值。 */
  base?: number;
  mode?: "flat" | "percent";
  skillTypes?: string[];
}

/** 同词条的数值：仙品 > 极品。导出给调参脚本对比品级用。 */
export const AFFIX_TIER_MULT: Record<string, number> = {
  epic: 1,
  legendary: 1.6,
  hongmeng: 2.4,
};

/** 每个品级给几条词条：极品以下一条都没有。 */
const AFFIX_COUNT_BY_RARITY: Record<string, number> = {
  common: 0,
  uncommon: 0,
  rare: 0,
  epic: 1,
  legendary: 2,
  hongmeng: 3,
};

/**
 * 统一词条池：**不分流派，所有人都能掷出全部词条**。
 *
 * 为什么不按流派分池：分池会让装备绑死流派——剑修打的装备永远只有穿透/暴击，
 * 体修买了没用，交易所里等于只能同流派内部流通。装备要能自由买卖，
 * 词条就必须全池可出。流派改由 AFFIX_PATH_PREFERENCE 只做**加权**（不排他）。
 */
const AFFIX_POOL: AffixDef[] = [
  // 数值类 · 固定值（随境界放大）
  { kind: "stat", key: "attack", label: "攻击", base: 4, mode: "flat" },
  { kind: "stat", key: "maxHp", label: "气血", base: 30, mode: "flat" },
  { kind: "stat", key: "defense", label: "防御", base: 3, mode: "flat" },
  { kind: "stat", key: "maxMp", label: "灵力", base: 18, mode: "flat" },
  { kind: "stat", key: "block", label: "格挡", base: 1.5, mode: "flat" },
  { kind: "stat", key: "armorPenetration", label: "破甲", base: 2, mode: "flat" },
  { kind: "stat", key: "speed", label: "速度", base: 1.5, mode: "flat" },
  { kind: "stat", key: "luck", label: "幸运", base: 1, mode: "flat" },
  { kind: "stat", key: "spiritualSense", label: "神识", base: 3, mode: "flat" },
  // 数值类 · 百分比（不随境界放大）
  { kind: "stat", key: "skillDamageBonus", label: "神通增伤", base: 0.02, mode: "percent" },
  { kind: "stat", key: "skillDamageReduction", label: "神通减伤", base: 0.02, mode: "percent" },
  { kind: "stat", key: "artifactDamageBonus", label: "法宝增伤", base: 0.02, mode: "percent" },
  { kind: "stat", key: "artifactDamageReduction", label: "法宝减伤", base: 0.02, mode: "percent" },
  // 概率类
  { kind: "rate", key: "rate_crit", label: "暴击率", base: 0.03 },
  { kind: "rate", key: "rate_block", label: "格挡率", base: 0.03 },
  { kind: "rate", key: "rate_alchemy_success", label: "炼丹成功率", base: 0.03 },
  { kind: "rate", key: "rate_smithing_success", label: "炼器成功率", base: 0.03 },
  // 技能类：多条不同「器灵」名，随机掷到哪个就是哪个（一件装备最多一条）
  { kind: "skill", key: "skill", label: "剑意附体", skillTypes: ["attack"] },
  { kind: "skill", key: "skill", label: "护体罡气", skillTypes: ["defense", "buff"] },
  { kind: "skill", key: "skill", label: "丹息回春", skillTypes: ["heal", "support"] },
  { kind: "skill", key: "skill", label: "符箓通灵", skillTypes: ["attack", "buff"] },
  { kind: "skill", key: "skill", label: "旁通之术", skillTypes: ["attack"] },
];

/**
 * 流派偏好：只是**加权**，不是排他。
 * 本流派词条权重 ×PATH_PREFERRED_WEIGHT，其余词条照常可出（权重 1）。
 */
const AFFIX_PATH_PREFERENCE: Record<string, string[]> = {
  sword: ["attack", "armorPenetration", "skillDamageBonus", "speed", "rate_crit"],
  body: ["maxHp", "defense", "block", "skillDamageReduction", "rate_block"],
  pill: ["maxHp", "maxMp", "skillDamageReduction", "luck", "rate_alchemy_success"],
  talisman: ["spiritualSense", "maxMp", "skillDamageBonus", "artifactDamageBonus", "rate_smithing_success"],
};

const PATH_PREFERRED_WEIGHT = 2.5;

/** 加权洗牌：本流派词条更容易出，但池子里每一条都可能被掷到。 */
function weightedShuffle(pool: AffixDef[], pathKey: string | null): AffixDef[] {
  const preferred = new Set(AFFIX_PATH_PREFERENCE[pathKey ?? ""] ?? []);
  const remaining = [...pool];
  const result: AffixDef[] = [];

  while (remaining.length > 0) {
    const weights = remaining.map((def) => (preferred.has(def.key) ? PATH_PREFERRED_WEIGHT : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;
    let pickedIndex = remaining.length - 1;
    for (let i = 0; i < remaining.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) {
        pickedIndex = i;
        break;
      }
    }
    result.push(remaining[pickedIndex]);
    remaining.splice(pickedIndex, 1);
  }

  return result;
}

/** 玩家已选的流派 key，没选过返回 null。 */
export async function getPlayerPathKey(playerId: string): Promise<string | null> {
  const row = await db
    .select({ pathKey: playerTalents.pathKey })
    .from(playerTalents)
    .where(and(eq(playerTalents.playerId, playerId), eq(playerTalents.kind, "path")))
    .get();
  return row?.pathKey ?? null;
}

async function pickSkillForAffix(params: {
  playerRealm: number;
  skillTypes: string[];
  fallbackLabel: string;
}): Promise<{ skillId: string; skillName: string } | null> {
  const realm = Math.max(1, Math.floor(params.playerRealm));
  const rows = await db
    .select({ id: skills.id, name: skills.name, skillType: skills.skillType })
    .from(skills)
    .where(and(
      or(isNull(skills.minRealm), lte(skills.minRealm, realm)),
    ))
    .limit(60)
    .all();
  if (rows.length === 0) {
    return null;
  }

  const preferred = rows.filter((row) => params.skillTypes.includes(String(row.skillType || "")));
  const pool = preferred.length > 0 ? preferred : rows;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return { skillId: picked.id, skillName: picked.name || params.fallbackLabel };
}

/**
 * 掷词条。极品（epic）以下一条都没有；仙品的同词条数值高于极品。
 * 数值类随境界放大，概率 / 技能类不放大（否则后期概率会爆表）。
 * 全池可出：流派只影响权重，任何流派都可能掷出任何词条。
 */
export async function rollEquipmentAffixes(params: {
  rarity: string;
  playerRealm: number;
  pathKey: string | null;
}): Promise<EquipmentAffixEntry[]> {
  const count = AFFIX_COUNT_BY_RARITY[params.rarity] ?? 0;
  if (count <= 0) {
    return [];
  }

  const tierMult = AFFIX_TIER_MULT[params.rarity] ?? 1;
  const power = powerOfRealm(params.playerRealm);
  // 全池可出，流派只做加权（装备要能在交易所自由流通，不能绑流派）
  const shuffled = weightedShuffle(AFFIX_POOL, params.pathKey);

  const output: EquipmentAffixEntry[] = [];
  for (const def of shuffled) {
    if (output.length >= count) {
      break;
    }
    if (output.some((entry) => entry.key === def.key && entry.kind === def.kind)) {
      continue;
    }

    const base = def.base ?? 0;
    if (def.kind === "stat") {
      if (def.mode === "percent") {
        output.push({
          kind: "stat",
          key: def.key,
          label: def.label,
          // 伤害增减使用百分点，普通属性才使用相对百分比。
          ...(isDamagePercentageStat(def.key)
            ? { flat: Math.round(base * tierMult * 10000) / 100 }
            : { percent: Math.round(base * tierMult * 10000) / 10000 }),
        });
      } else {
        output.push({
          kind: "stat",
          key: def.key,
          label: def.label,
          flat: Math.max(1, Math.round(base * tierMult * power)),
        });
      }
      continue;
    }

    if (def.kind === "rate") {
      output.push({
        kind: "rate",
        key: def.key,
        label: def.label,
        chance: Math.round(base * tierMult * 10000) / 10000,
      });
      continue;
    }

    const skill = await pickSkillForAffix({
      playerRealm: params.playerRealm,
      skillTypes: def.skillTypes ?? ["attack"],
      fallbackLabel: def.label,
    });
    if (skill) {
      output.push({
        kind: "skill",
        key: "skill",
        label: def.label,
        skillId: skill.skillId,
        skillName: skill.skillName,
      });
    }
  }

  return output;
}

/**
 * 给一件刚到手的装备打上阶段系数与词条。
 *
 * 同一件装备一个玩家只会有一行（player_inventory 有唯一约束），
 * 所以重复打造同一件等于**重铸**：系数与词条会被新的覆盖。
 */
export async function tuneEquipmentInstance(params: {
  playerId: string;
  itemId: string;
  playerRealm: number;
  /** 发放装备常常在事务里，传事务进来才能读到刚插入的行。 */
  tx?: unknown;
}): Promise<{ stageMult: number; affixes: EquipmentAffixEntry[] } | null> {
  const ex = (params.tx as typeof db | undefined) ?? db;

  const item = await ex
    .select({
      id: items.id,
      rarity: items.rarity,
      minRealm: items.minRealm,
      maxRealm: items.maxRealm,
    })
    .from(items)
    .where(eq(items.id, params.itemId))
    .get();
  if (!item) {
    return null;
  }

  const pathKey = await getPlayerPathKey(params.playerId);
  const stageMult = computeStageMult({
    itemMinRealm: item.minRealm,
    itemMaxRealm: item.maxRealm,
    playerRealm: params.playerRealm,
    rarity: item.rarity,
  });
  const affixes = await rollEquipmentAffixes({
    rarity: item.rarity,
    playerRealm: params.playerRealm,
    pathKey,
  });

  await ex.update(playerInventory)
    .set({
      stageMult,
      stageRealm: Math.floor(params.playerRealm),
      affixes: affixes.length > 0 ? affixes : null,
    })
    .where(and(
      eq(playerInventory.playerId, params.playerId),
      eq(playerInventory.itemId, params.itemId),
    ))
    .run();

  return { stageMult, affixes };
}

/** 身上已装备的装备带来的各类概率加成（暴击 / 格挡 / 炼丹 / 炼器）。 */
export async function getPlayerEquipmentRateBonuses(playerId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ affixes: playerInventory.affixes })
    .from(playerInventory)
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.equipped, true)))
    .all();

  const output: Record<string, number> = {};
  for (const row of rows) {
    const affixes = (row.affixes ?? []) as EquipmentAffixEntry[];
    for (const affix of affixes) {
      if (affix.kind !== "rate" || typeof affix.chance !== "number") {
        continue;
      }
      output[affix.key] = (output[affix.key] ?? 0) + affix.chance;
    }
  }
  return output;
}

/** 战斗用的两个概率加成（暴击 / 格挡），给战斗单位构造处用。 */
export async function getPlayerCombatRateBonuses(playerId: string): Promise<{
  critBonus: number;
  blockBonus: number;
}> {
  const rates = await getPlayerEquipmentRateBonuses(playerId);
  return {
    critBonus: Number(rates.rate_crit || 0),
    blockBonus: Number(rates.rate_block || 0),
  };
}

/**
 * 打造品级权重（方案A，2026-10-20）：以配方产物自身品级为基准档，只升不降。
 *
 * - 步进权重（相对基准档 +0/+1/+2/+3 档）：55% / 25% / 12% / 8%；
 *   步进**最高只到仙品**——超出可达档位的份额回落到基准档。
 * - 鸿蒙（装备天花板）不吃步进权重，走独立绝对概率 CRAFT_HONGMENG_CHANCE。
 *   否则以仙品为基准的配方会把 +1~+5 的权重全部坍缩到鸿蒙（45% 出货，天花板报废）。
 *
 * 各基准档的实际分布：
 *   凡品基准: 凡55/良25/上12/极8/仙0(无货则回退)/鸿0.5%
 *   极品基准: 极75/仙25/鸿0.5%
 *   仙品基准: 仙99.5/鸿0.5%   ← 约 200 次打造一件鸿蒙
 */
export const CRAFT_RARITY_STEP_WEIGHTS = [0.55, 0.25, 0.12, 0.08] as const;
export const CRAFT_HONGMENG_CHANCE = 0.005;

/**
 * 打造时掷品级，返回实际发放的 itemId。
 *
 * 替换原「炼器专精品质跃升」机制（专精已按产品决策移除，见
 * docs/current/content-expansion-plan.md 方案A）。目标品级找不到对应物品时
 * 逐档向下回退，保证总能落到一个真实存在的装备。
 */
export async function rollCraftRarityItemId(params: {
  /** 配方产物的物品 id（其品级即基准档） */
  itemId: string;
}): Promise<string> {
  const base = await db
    .select({ itemType: items.itemType, rarity: items.rarity, minRealm: items.minRealm })
    .from(items)
    .where(eq(items.id, params.itemId))
    .get();
  if (!base) {
    return params.itemId;
  }
  const baseIndex = RARITY_ORDER.indexOf(base.rarity as typeof RARITY_ORDER[number]);
  if (baseIndex < 0) {
    return params.itemId;
  }

  const topIndex = RARITY_ORDER.length - 1; // hongmeng
  const stepCeiling = baseIndex < topIndex ? topIndex - 1 : baseIndex; // 步进最高到仙品
  const maxStep = stepCeiling - baseIndex;

  // 基准档质量 = 自身权重 + 所有不可达档位回落
  let baseMass = CRAFT_RARITY_STEP_WEIGHTS[0];
  for (let k = maxStep + 1; k < CRAFT_RARITY_STEP_WEIGHTS.length; k += 1) {
    baseMass += CRAFT_RARITY_STEP_WEIGHTS[k];
  }

  let targetIndex = baseIndex;
  const hongmengRoll = Math.random();
  if (baseIndex < topIndex && hongmengRoll < CRAFT_HONGMENG_CHANCE) {
    targetIndex = topIndex;
  } else {
    // 先判「落在基准档」：漏掉这一步的话，最后一个可达档位的累积概率必然到 1，
    // roll < 1 恒成立 → 每次打造都直接跳到最高可达档（线上实测 10 次出 8 件仙品）。
    const roll = Math.random();
    if (roll >= baseMass) {
      let cumulative = baseMass;
      for (let step = 1; step <= maxStep; step += 1) {
        cumulative += CRAFT_RARITY_STEP_WEIGHTS[step];
        if (roll < cumulative) {
          targetIndex = baseIndex + step;
          break;
        }
      }
    }
  }

  const minRealm = base.minRealm ?? 1;
  while (targetIndex >= 0) {
    const rarity = RARITY_ORDER[targetIndex];
    const candidate = await db
      .select({ id: items.id })
      .from(items)
      .where(and(
        eq(items.itemType, base.itemType),
        eq(items.rarity, rarity),
        eq(items.minRealm, minRealm),
      ))
      .limit(1)
      .get();
    if (candidate) {
      return candidate.id;
    }
    targetIndex -= 1; // 该段没有这个品级的装备，向下一档找
  }
  return params.itemId;
}

/* ------------------------------------------------------------------ 建表 */

let ensurePromise: Promise<void> | null = null;

/**
 * 运行时补齐实例相关列与专精表（老库没有）。
 *
 * 必须整体包在事务里并设 lock_timeout：ALTER player_inventory 需要 ACCESS EXCLUSIVE，
 * 若恰好有并发事务（如炼制扣材料）持有该表的行锁，ALTER 会无限等待，
 * 且锁队列是公平的——后续所有 inventory 查询都排在它后面，全站装备接口一起挂
 * （线上 2026-10-20 00:14 事故）。lock_timeout 让它 2 秒拿不到锁就快速失败，
 * ensurePromise 随之重置，下次调用重试，最坏只影响单次请求。
 */
export async function ensureEquipmentInstanceSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '2s'`));
      await tx.execute(sql.raw(`ALTER TABLE "player_inventory" ADD COLUMN IF NOT EXISTS "stage_mult" real NOT NULL DEFAULT 1`));
      await tx.execute(sql.raw(`ALTER TABLE "player_inventory" ADD COLUMN IF NOT EXISTS "stage_realm" integer`));
    }).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
