/**
 * 播种修炼流派（天赋）定义。
 *
 * 用法：bun run scripts/seed-talent-paths.ts [--apply]
 * 默认 dry-run，加 --apply 写库。按 key 幂等 upsert。
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { talentPaths } from "@/db/schema";

type CurveEntry = { fromMajor: number; percent: Record<string, number> };

interface SeedPath {
  key: string;
  name: string;
  kind: "direction" | "path" | "daoxin";
  parentKey?: string;
  description: string;
  unlockMajor: number;
  curve: CurveEntry[];
}

/** 筑基（major 2）抉择：只给很小的倾向，主要决定后续可选流派。 */
const DIRECTIONS: SeedPath[] = [
  {
    key: "combat",
    name: "斗战",
    kind: "direction",
    description: "以攻伐证道，出手即分生死。后续可入剑修、体修。",
    unlockMajor: 2,
    curve: [{ fromMajor: 2, percent: { attack: 0.02, speed: 0.02 } }],
  },
  {
    key: "longevity",
    name: "长生",
    kind: "direction",
    description: "以性命为本，先求不败而后求胜。后续可入丹修、符修。",
    unlockMajor: 2,
    curve: [{ fromMajor: 2, percent: { maxHp: 0.03, maxMp: 0.03 } }],
  },
];

/**
 * 结丹（major 3）抉择：主加成，按大境界分段。
 *
 * 强势期轮换的设计意图：
 * - 体修前期百分比最高、后期走低 → 前期强；
 * - 剑修前期平淡、元婴（major 4）后明显抬升 → 中后期成型；
 * - 丹修全程平稳；
 * - 符修后期发力，且**刻意不给神识**（治疗公式 +2.15/点 会让符修错变成奶妈）。
 */
const PATHS: SeedPath[] = [
  {
    key: "sword",
    name: "剑修",
    kind: "path",
    parentKey: "combat",
    description: "一剑破万法。输出与穿透并重，元婴后剑势大成，但身板脆、耗法力。",
    unlockMajor: 3,
    curve: [
      { fromMajor: 3, percent: { attack: 0.06, armorPenetration: 0.04 } },
      { fromMajor: 4, percent: { attack: 0.1, armorPenetration: 0.08, speed: 0.04 } },
    ],
  },
  {
    key: "body",
    name: "体修",
    kind: "path",
    parentKey: "combat",
    description: "以身铸墙，反守为攻。前期血厚防高极难撼动，后期优势相对收敛。",
    unlockMajor: 3,
    curve: [
      { fromMajor: 3, percent: { maxHp: 0.12, defense: 0.1, block: 0.06 } },
      { fromMajor: 4, percent: { maxHp: 0.08, defense: 0.06, block: 0.04 } },
    ],
  },
  {
    key: "pill",
    name: "丹修",
    kind: "path",
    parentKey: "longevity",
    description: "以药续命，胜在持久。气血法力兼修，全程平稳，不依赖爆发。",
    unlockMajor: 3,
    curve: [
      { fromMajor: 3, percent: { maxHp: 0.06, maxMp: 0.05 } },
      { fromMajor: 4, percent: { maxHp: 0.07, maxMp: 0.06 } },
    ],
  },
  {
    key: "talisman",
    name: "符修",
    kind: "path",
    parentKey: "longevity",
    description: "以符御敌，洞察先机。法力深厚、法宝增伤，后期可观；身板偏脆。",
    unlockMajor: 3,
    curve: [
      { fromMajor: 3, percent: { maxMp: 0.05, artifactDamageBonus: 0.03 } },
      { fromMajor: 4, percent: { maxMp: 0.09, artifactDamageBonus: 0.08 } },
    ],
  },
];

/**
 * 元婴（major 4）抉择：道心。
 *
 * 这一层原先是空的 —— 玩家结丹选完流派后，一直到满级都不再有抉择点。
 * 补上后每层各一次：道途（筑基）→ 流派（结丹）→ 道心（元婴）。
 *
 * 每个流派给两条：一条纯强化，一条「带代价的偏锋」（用负面属性换更高的正面收益），
 * 让元婴这次抉择真的有取舍，而不是单纯选大的。
 *
 * 数值护栏（见 talent-service.ts 头部注释）：
 *   - 只输出 percent，不写回基础属性
 *   - 单节点正负相抵后的净收益控制在 ±15% 以内
 *   - 符修不给 spiritualSense（治疗公式 +2.15/点 会让它错变成奶妈）
 */
const DAOXINS: SeedPath[] = [
  {
    key: "sword_jianxin",
    name: "剑心通明",
    kind: "daoxin",
    parentKey: "sword",
    description: "心如明镜，剑即心、心即剑。出手更准，破甲更利，招式也更重。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { attack: 0.07, armorPenetration: 0.05, skillDamageBonus: 0.03 } }],
  },
  {
    key: "sword_pianfeng",
    name: "剑走偏锋",
    kind: "daoxin",
    parentKey: "sword",
    description: "只求一击必杀，不惜自身。剑更狠、身更快，但这条命也轻了。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { attack: 0.11, speed: 0.06, maxHp: -0.05 } }],
  },
  {
    key: "body_budong",
    name: "不动明王",
    kind: "daoxin",
    parentKey: "body",
    description: "如山不动，如王镇世。任你千招万式，我只守这一身。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { maxHp: 0.07, defense: 0.05, block: 0.03 } }],
  },
  {
    key: "body_xuezhan",
    name: "血战十式",
    kind: "daoxin",
    parentKey: "body",
    description: "以血换血。防守松了，拳头却沉了——反正体修也没打算站着挨打。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { attack: 0.07, maxHp: 0.05, defense: -0.04 } }],
  },
  {
    key: "pill_yizhe",
    name: "医者仁心",
    kind: "daoxin",
    parentKey: "pill",
    description: "先能活，才谈赢。气血法力都厚一分，挨的打也轻一分。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { maxHp: 0.06, maxMp: 0.05, skillDamageReduction: 0.03 } }],
  },
  {
    key: "pill_dushou",
    name: "毒手药王",
    kind: "daoxin",
    parentKey: "pill",
    description: "药能救人，亦能杀人。同一双手，换个方子就是另一门生意。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { attack: 0.06, maxMp: 0.05, artifactDamageBonus: 0.04 } }],
  },
  {
    key: "talisman_fuzhen",
    name: "符阵宗师",
    kind: "daoxin",
    parentKey: "talisman",
    description: "一纸符诏可镇一城。法力愈深，符阵愈重，压下去就起不来。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { maxMp: 0.07, artifactDamageBonus: 0.06 } }],
  },
  {
    key: "talisman_yufu",
    name: "御符如臂",
    kind: "daoxin",
    parentKey: "talisman",
    description: "符不在多，在于快。出手比对手想得还早，符就够用了。",
    unlockMajor: 4,
    curve: [{ fromMajor: 4, percent: { speed: 0.05, maxMp: 0.05, artifactDamageBonus: 0.03 } }],
  },
];

const apply = process.argv.includes("--apply");
const all = [...DIRECTIONS, ...PATHS, ...DAOXINS];

console.log(`流派定义：${all.length} 条（方向 ${DIRECTIONS.length} / 流派 ${PATHS.length} / 道心 ${DAOXINS.length}）`);
for (const item of all) {
  console.log(`  [${item.kind}] ${item.name} (${item.key}) 解锁=major ${item.unlockMajor}`);
}

if (!apply) {
  console.log("\n dry-run：未写库。加 --apply 执行。");
  process.exit(0);
}

for (const item of all) {
  const existing = await db
    .select({ id: talentPaths.id })
    .from(talentPaths)
    .where(eq(talentPaths.key, item.key))
    .get();

  if (existing) {
    await db.update(talentPaths).set({
      name: item.name,
      kind: item.kind,
      parentKey: item.parentKey || null,
      description: item.description,
      unlockMajor: item.unlockMajor,
      stageCurve: item.curve,
      enabled: true,
    }).where(eq(talentPaths.key, item.key)).run();
    console.log(`更新：${item.name}`);
  } else {
    await db.insert(talentPaths).values({
      key: item.key,
      name: item.name,
      kind: item.kind,
      parentKey: item.parentKey || null,
      description: item.description,
      unlockMajor: item.unlockMajor,
      stageCurve: item.curve,
      enabled: true,
    }).run();
    console.log(`新增：${item.name}`);
  }
}

console.log("播种完成");
