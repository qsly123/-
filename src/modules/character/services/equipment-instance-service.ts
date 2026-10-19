/**
 * 装备实例：阶段系数 + 专精词条 + 炼器专精。
 *
 * 三件事，都挂在**实例**（player_inventory 行）上，items 表不动：
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
 * 3. **炼器专精**（player_smithing_specializations）
 *    按装备部位分兵刃 / 甲胄 / 法器 / 饰品，打造对应部位涨熟练度，
 *    专精等级提高该部位的打造成功率与「品质跃升」概率。
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

/* ------------------------------------------------------------------ 炼器专精 */

export const SMITHING_SPEC_NAMES: Record<string, string> = {
  blade: "兵刃",
  armor: "甲胄",
  artifact: "法器",
  trinket: "饰品",
};

/** 满级上限与每级收益。 */
export const SMITHING_SPEC_MAX_LEVEL = 10;
const SMITHING_SPEC_EXP_PER_LEVEL = 100;
const SUCCESS_RATE_PER_LEVEL = 0.015;
const RARITY_UP_PER_LEVEL = 0.01;

export function smithingSpecKeyForItemType(itemType: string): string {
  if (itemType === "weapon") return "blade";
  if (itemType === "armor" || itemType === "helmet") return "armor";
  if (itemType === "artifact") return "artifact";
  return "trinket";
}

export interface SmithingSpecView {
  specKey: string;
  specName: string;
  level: number;
  exp: number;
  expToNext: number;
  /** 打造该部位时额外加的成功率。 */
  successBonusRate: number;
  /** 打造该部位时品质跃升一档的概率。 */
  rarityUpRate: number;
}

export async function getPlayerSmithingSpecs(playerId: string): Promise<SmithingSpecView[]> {
  await ensureEquipmentInstanceSchema();
  const rows = await db
    .select()
    .from(playerSmithingSpecializations)
    .where(eq(playerSmithingSpecializations.playerId, playerId))
    .all();

  const map = new Map(rows.map((row) => [row.specKey, row]));
  return Object.keys(SMITHING_SPEC_NAMES).map((specKey) => {
    const row = map.get(specKey);
    const exp = Number(row?.exp || 0);
    const level = Math.min(
      SMITHING_SPEC_MAX_LEVEL,
      Math.max(1, 1 + Math.floor(exp / SMITHING_SPEC_EXP_PER_LEVEL)),
    );
    return {
      specKey,
      specName: SMITHING_SPEC_NAMES[specKey],
      level,
      exp,
      expToNext: level >= SMITHING_SPEC_MAX_LEVEL ? 0 : SMITHING_SPEC_EXP_PER_LEVEL - (exp % SMITHING_SPEC_EXP_PER_LEVEL),
      successBonusRate: Math.round(level * SUCCESS_RATE_PER_LEVEL * 10000) / 10000,
      rarityUpRate: Math.round(level * RARITY_UP_PER_LEVEL * 10000) / 10000,
    };
  });
}

export async function getSmithingSpecBonus(params: {
  playerId: string;
  specKey: string;
}): Promise<{ successBonusRate: number; rarityUpRate: number }> {
  const specs = await getPlayerSmithingSpecs(params.playerId);
  const spec = specs.find((entry) => entry.specKey === params.specKey);
  return {
    successBonusRate: spec?.successBonusRate ?? 0,
    rarityUpRate: spec?.rarityUpRate ?? 0,
  };
}

/** 打造成功后涨熟练度：品级越高经验越多。 */
export async function grantSmithingSpecExp(params: {
  playerId: string;
  specKey: string;
  rarity: string;
}): Promise<void> {
  await ensureEquipmentInstanceSchema();
  const gain = 10 + Math.max(0, RARITY_ORDER.indexOf(params.rarity as typeof RARITY_ORDER[number])) * 6;

  await db.execute(sql`
    INSERT INTO "player_smithing_specializations" ("player_id", "spec_key", "level", "exp", "created_at", "updated_at")
    VALUES (${params.playerId}, ${params.specKey}, 1, ${gain}, NOW()::text, NOW()::text)
    ON CONFLICT ("player_id", "spec_key")
    DO UPDATE SET "exp" = "player_smithing_specializations"."exp" + ${gain}, "updated_at" = NOW()::text
  `);
}

/**
 * 品质跃升：找同部位同段、高一个品级的替代装备。
 * 找不到就返回 null（说明这件已经是该段该部位的最高品级）。
 */
export async function findUpgradedItem(params: {
  itemId: string;
}): Promise<string | null> {
  const item = await db
    .select({
      itemType: items.itemType,
      rarity: items.rarity,
      minRealm: items.minRealm,
    })
    .from(items)
    .where(eq(items.id, params.itemId))
    .get();
  if (!item) {
    return null;
  }

  const index = RARITY_ORDER.indexOf(item.rarity as typeof RARITY_ORDER[number]);
  if (index < 0 || index >= RARITY_ORDER.length - 1) {
    return null;
  }
  const nextRarity = RARITY_ORDER[index + 1];

  const candidate = await db
    .select({ id: items.id })
    .from(items)
    .where(and(
      eq(items.itemType, item.itemType),
      eq(items.rarity, nextRarity),
      eq(items.minRealm, item.minRealm ?? 1),
    ))
    .limit(1)
    .get();

  return candidate?.id ?? null;
}

/**
 * 跃升到**鸿蒙**时的概率折扣：把专精的跃升概率（每级 1%，满级 10%）
 * 再乘这个系数。鸿蒙是装备天花板，得真的稀有。
 *
 * ×0.2 → 满级专精也只有 2%。想更狠就往下调：
 *   0.1 → 满级 1%（约 120 次打造一件）  0.2 → 2%（约 60 次）  0.5 → 5%（约 24 次）
 */
export const HONGMENG_UPGRADE_CHANCE_MULT = 0.2;

/**
 * 掷一次品质跃升，返回实际发放的 itemId（没跃升就返回原 id）。
 *
 * 把概率判断也收在这里，是为了让「跃升到鸿蒙更难」只有一处实现——
 * 调用方只管把自己的 rarityUpRate 传进来。
 */
export async function rollUpgradedItemId(params: {
  itemId: string;
  rarityUpRate: number;
}): Promise<string> {
  const rate = Number(params.rarityUpRate) || 0;
  if (rate <= 0) {
    return params.itemId;
  }

  const current = await db
    .select({ rarity: items.rarity })
    .from(items)
    .where(eq(items.id, params.itemId))
    .get();
  if (!current) {
    return params.itemId;
  }

  const index = RARITY_ORDER.indexOf(current.rarity as typeof RARITY_ORDER[number]);
  if (index < 0 || index >= RARITY_ORDER.length - 1) {
    return params.itemId; // 已是最高品级
  }

  const nextRarity = RARITY_ORDER[index + 1];
  const chance = nextRarity === "hongmeng" ? rate * HONGMENG_UPGRADE_CHANCE_MULT : rate;
  if (Math.random() >= chance) {
    return params.itemId;
  }

  const upgraded = await findUpgradedItem({ itemId: params.itemId });
  return upgraded ?? params.itemId;
}

/* ------------------------------------------------------------------ 建表 */

let ensurePromise: Promise<void> | null = null;

/** 运行时补齐实例相关列与专精表（老库没有）。 */
export async function ensureEquipmentInstanceSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.execute(sql.raw(`ALTER TABLE "player_inventory" ADD COLUMN IF NOT EXISTS "stage_mult" real NOT NULL DEFAULT 1`));
      await db.execute(sql.raw(`ALTER TABLE "player_inventory" ADD COLUMN IF NOT EXISTS "stage_realm" integer`));
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS "player_smithing_specializations" (
          "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "player_id" text NOT NULL REFERENCES "players"("id"),
          "spec_key" text NOT NULL,
          "level" integer NOT NULL DEFAULT 1,
          "exp" integer NOT NULL DEFAULT 0,
          "created_at" text NOT NULL DEFAULT NOW()::text,
          "updated_at" text NOT NULL DEFAULT NOW()::text
        )
      `));
      await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "player_smithing_specs_unique_idx" ON "player_smithing_specializations" ("player_id", "spec_key")`));
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
