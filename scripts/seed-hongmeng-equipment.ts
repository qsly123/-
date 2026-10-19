/**
 * 补鸿蒙装备：给每一件仙品配一件「同部位同段」的鸿蒙，作为品质跃升的目标。
 *
 * 在此之前装备库里**一件鸿蒙都没有**，导致 findUpgradedItem 永远返回 null，
 * 仙品就是天花板。本脚本补齐数据，让"仙品配方 + 专精跃升 → 鸿蒙"这条路通。
 *
 * 鸿蒙的稀有度**不靠件数控制**（件数与仙品等量），而是靠 `HONGMENG_UPGRADE_CHANCE_MULT`
 * 把跃升概率压到极低。
 *
 * 注意：items.effects 用 HONGMENG_SEED_MULT 生成，必须与服务里的
 * RARITY_SEED_MULT.hongmeng 保持一致，否则 stage_mult 反解会算错基础值。
 *
 * 用法：
 *   bun run scripts/seed-hongmeng-equipment.ts           # 预览
 *   bun run scripts/seed-hongmeng-equipment.ts --apply   # 写入
 */
import { and, eq, inArray, sql as countSql } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";

const EQUIPMENT_TYPES = ["weapon", "armor", "helmet", "shoes", "artifact"] as const;

const SEGMENT_LABEL: Record<number, string> = {
  1: "练气", 13: "筑基", 17: "结丹", 21: "元婴",
};

/** 生成装备时的品质倍率；必须与 equipment-instance-service 的 RARITY_SEED_MULT.hongmeng 一致 */
const HONGMENG_SEED_MULT = 4.6;

/** 每件仙品对应的鸿蒙名字/描述。key 是仙品的 items.id */
const HONGMENG_NAMES: Record<string, { name: string; desc: string }> = {
  item_four_realms_yuanying_weapon_sword: {
    name: "未判天河",
    desc: "河出天山，水色未分。剑成那天炉里没有火，只有一条河的响声。（鸿蒙）",
  },
  item_four_realms_yuanying_weapon_needle: {
    name: "劫芒",
    desc: "针长三寸，投出去看不见。见着的时候，人已经不再动。（鸿蒙）",
  },
  item_four_realms_yuanying_weapon_blade: {
    name: "裂军鸿牙",
    desc: "刀身十九道齿口，每一道都是一个没能回来的人。比破军更重，重得要两只手。（鸿蒙）",
  },
  item_four_realms_yuanying_weapon_focus: {
    name: "混元道璧",
    desc: "璧上没有纹，看久了会觉得自己也在里面。守城的人最后都学会了不看它。（鸿蒙）",
  },
  item_four_realms_yuanying_artifact_talisman: {
    name: "太初符阵",
    desc: "三百六十道符自己会排布，摆完了无人看得懂。守城时它亮过一次。（鸿蒙）",
  },
  item_four_realms_yuanying_artifact_sword_box: {
    name: "无极剑匣",
    desc: "匣里能放九柄剑，放进去的多，取出来的少。有人说匣底通向别处。（鸿蒙）",
  },
  item_four_realms_yuanying_artifact_swift_ring: {
    name: "开元雷环",
    desc: "环转起来先有光，后有雷。听见雷的时候，雷已经过去了。（鸿蒙）",
  },
  item_four_realms_yuanying_artifact_signature: {
    name: "浮黎愿灯",
    desc: "灯芯从没换过。许愿的人换了很多茬，火苗一直是那一朵。（鸿蒙）",
  },
  item_four_realms_yuanying_artifact_shield: {
    name: "玄黄盾",
    desc: "盾面一层黄一层黑，据说取自天地初开那两色。挡过一次天劫，之后再没人敢用。（鸿蒙）",
  },
  item_four_realms_yuanying_artifact_blood_banner: {
    name: "洪荒守疆幡",
    desc: "幡面是疆域图，绣的山河会随年景变色。要乱的时候，它先暗。（鸿蒙）",
  },
  item_four_realms_yuanying_armor_helmet: {
    name: "不周金冠",
    desc: "冠重十九斤，戴上去脖子先服软。戴上它的人决定过很多事，包括不再摘下。（鸿蒙）",
  },
  item_four_realms_yuanying_armor_robe: {
    name: "元初霄袍",
    desc: "袍色每天变一点，从黑到青到白。穿它的人说：它记得每一战。（鸿蒙）",
  },
  item_four_realms_yuanying_armor_shoes: {
    name: "乘炁履",
    desc: "落地没有声，也没有印。追得上你的人，本来也不需要落在地上。（鸿蒙）",
  },
};

async function main() {
  const apply = process.argv.includes("--apply");

  const legendaryRows = await db
    .select({
      id: items.id,
      name: items.name,
      itemType: items.itemType,
      rarity: items.rarity,
      minRealm: items.minRealm,
      maxRealm: items.maxRealm,
      price: items.price,
      effects: items.effects,
      description: items.description,
    })
    .from(items)
    .where(and(
      eq(items.rarity, "legendary"),
      inArray(items.itemType, [...EQUIPMENT_TYPES]),
    ))
    .all();

  /* 先看清楚「部位×段」的品级断层：低층段若没有仙品，极品就跃升不上去 */
  const matrixRows = await db
    .select({
      itemType: items.itemType,
      minRealm: items.minRealm,
      rarity: items.rarity,
      cnt: countSql<number>`count(*)::int`,
    })
    .from(items)
    .where(inArray(items.itemType, [...EQUIPMENT_TYPES]))
    .groupBy(items.itemType, items.minRealm, items.rarity)
    .all();

  const matrix = new Map<string, Map<string, number>>();
  for (const row of matrixRows) {
    const combo = `${row.itemType}@${row.minRealm ?? 0}`;
    if (!matrix.has(combo)) matrix.set(combo, new Map());
    matrix.get(combo)!.set(String(row.rarity), Number(row.cnt || 0));
  }
  console.log("=== 部位×段的品级分布 ===");
  for (const [combo, counts] of [...matrix].sort()) {
    const [itemType, minRealm] = combo.split("@");
    const cells = ["common", "uncommon", "rare", "epic", "legendary", "hongmeng"]
      .map((rarity) => `${rarity.slice(0, 4)}:${counts.get(rarity) ?? 0}`)
      .join(" ");
    console.log(`  ${itemType.padEnd(8)} ${(SEGMENT_LABEL[Number(minRealm)] || minRealm).padEnd(4)} ${cells}`);
  }
  console.log("");

  console.log(`现有仙品装备 ${legendaryRows.length} 件\n`);

  const missingName: string[] = [];
  const rows: (typeof items.$inferInsert)[] = [];

  for (const row of legendaryRows) {
    const profile = HONGMENG_NAMES[row.id];
    if (!profile) {
      missingName.push(`${row.id}  ${row.name}（${row.itemType} ${row.minRealm}-${row.maxRealm}）`);
      continue;
    }

    const effects = (row.effects || []).map((effect) => ({
      ...effect,
      // 仙品的 effects 是按 3.8 生成的，鸿蒙按 4.6 等比放大
      value: Math.round(Number(effect.value || 0) * (HONGMENG_SEED_MULT / 3.8)),
    }));

    const id = `${row.id}_hongmeng`;
    rows.push({
      id,
      name: profile.name,
      description: profile.desc,
      itemType: row.itemType,
      rarity: "hongmeng",
      effects,
      price: Math.round(Number(row.price || 0) * (HONGMENG_SEED_MULT / 3.8)),
      stackable: false,
      isBound: false,
      minRealm: row.minRealm,
      maxRealm: row.maxRealm,
    });

    console.log(`  [${row.itemType} ${row.minRealm}-${row.maxRealm}] ${row.name} → ${profile.name}`);
    console.log(`      effects ${JSON.stringify(effects)}`);
  }

  if (missingName.length > 0) {
    console.log(`\n还没定名字的 ${missingName.length} 件：`);
    for (const line of missingName) {
      console.log(`  ${line}`);
    }
  }

  if (!apply) {
    console.log(`\n将写入 ${rows.length} 件鸿蒙装备（加 --apply 写入）`);
    return;
  }

  for (const row of rows) {
    await db.insert(items)
      .values(row)
      .onConflictDoUpdate({ target: items.id, set: row })
      .run();
  }
  console.log(`\n写入完成：${rows.length} 件鸿蒙装备`);
}

await main();
