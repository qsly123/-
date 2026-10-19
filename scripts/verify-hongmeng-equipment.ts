/**
 * 验证补齐的鸿蒙装备。
 *
 * 最容易出错的地方是**数值**：items.effects 按 4.6 生成，而 stage_mult 会除掉
 * RARITY_SEED_MULT.hongmeng 再乘生效倍率。两者一旦不同步，鸿蒙的基础值就会算错。
 * 所以这里直接拿真实装备算一遍，要求「鸿蒙基础值 = 仙品基础值 × (1.55 / 1.4)」。
 *
 * 用法：bun run scripts/verify-hongmeng-equipment.ts
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import {
  HONGMENG_UPGRADE_CHANCE_MULT,
  RARITY_EFFECTIVE_MULT,
  computeStageMult,
  findUpgradedItem,
  rollUpgradedItemId,
} from "@/modules/character/services/equipment-instance-service";

const EQUIPMENT_TYPES = ["weapon", "armor", "helmet", "shoes", "artifact"];

let failed = 0;
function step(title: string, pass: boolean, detail: string) {
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${title} —— ${detail}`);
  if (!pass) {
    failed += 1;
  }
}

/** 一件装备在自身段内的最终攻击/主属性值（ability 引擎那一套：items.effects × 阶段系数） */
function finalValue(row: {
  effects: unknown; rarity: string; minRealm: number | null; maxRealm: number | null;
}, realm: number): number {
  const effects = Array.isArray(row.effects) ? row.effects as Array<{ type?: string; value?: number }> : [];
  const primary = effects[0]?.value ?? 0;
  return primary * computeStageMult({
    itemMinRealm: row.minRealm,
    itemMaxRealm: row.maxRealm,
    playerRealm: realm,
    rarity: row.rarity,
  });
}

async function main() {
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      itemType: items.itemType,
      rarity: items.rarity,
      minRealm: items.minRealm,
      maxRealm: items.maxRealm,
      effects: items.effects,
    })
    .from(items)
    .where(inArray(items.itemType, EQUIPMENT_TYPES))
    .all();

  const hongmeng = rows.filter((row) => row.rarity === "hongmeng");
  const legendary = rows.filter((row) => row.rarity === "legendary");

  step("鸿蒙装备已补齐", hongmeng.length > 0, `${hongmeng.length} 件（仙品 ${legendary.length} 件）`);

  /* 每件仙品都要能跃升到鸿蒙，否则那条链路还是断的 */
  const broken: string[] = [];
  for (const item of legendary) {
    const upgraded = await findUpgradedItem({ itemId: item.id });
    if (!upgraded) {
      broken.push(item.name);
    }
  }
  step("每件仙品都有鸿蒙跃升目标", broken.length === 0,
    broken.length === 0 ? `${legendary.length}/${legendary.length} 通` : `断链：${broken.join("、")}`);

  /* 数值：鸿蒙 = 仙品 × (1.55 / 1.4)，差值来自生效品质倍率 */
  if (legendary.length > 0 && hongmeng.length > 0) {
    const sample = legendary.find((row) => row.itemType === "weapon") || legendary[0];
    const target = await findUpgradedItem({ itemId: sample.id });
    const targetRow = rows.find((row) => row.id === target);
    if (targetRow) {
      const realm = Number(sample.minRealm ?? 1);
      const legendValue = finalValue(sample, realm);
      const hongmengValue = finalValue(targetRow, realm);
      const expected = RARITY_EFFECTIVE_MULT.hongmeng / RARITY_EFFECTIVE_MULT.legendary;
      const actual = legendValue > 0 ? hongmengValue / legendValue : 0;
      step("鸿蒙基础值 = 仙品 × (1.55/1.4)", Math.abs(actual - expected) < 0.02,
        `${sample.name} ${Math.round(legendValue)} → ${targetRow.name} ${Math.round(hongmengValue)}（${actual.toFixed(3)}，期望 ${expected.toFixed(3)}）`);
    }
  }

  /* 跃升概率实测：满级专精 10%，跃升到鸿蒙要打折 */
  const targets = legendary;
  const SAMPLES = 4000;

  if (targets.length > 0) {
    let hits = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      const picked = targets[i % targets.length];
      const result = await rollUpgradedItemId({ itemId: picked.id, rarityUpRate: 0.1 });
      if (result !== picked.id) {
        hits += 1;
      }
    }
    const hitRate = hits / SAMPLES;
    const expected = 0.1 * HONGMENG_UPGRADE_CHANCE_MULT;
    step("跃升到鸿蒙的概率 = 专精概率 × 折扣", Math.abs(hitRate - expected) < expected * 0.4,
      `实测 ${(hitRate * 100).toFixed(2)}%（期望 ${(expected * 100).toFixed(1)}%，${SAMPLES} 次）`);
  }

  /* 对照组：极品→仙品不该被打折。
     注意只有「同段存在仙品」的极品才跃升得动——仙品全在元婴段，练气~结丹的极品其实是断的。 */
  let controlItem: (typeof rows)[number] | null = null;
  let upgradableEpic = 0;
  for (const row of rows) {
    if (row.rarity !== "epic") {
      continue;
    }
    if (await findUpgradedItem({ itemId: row.id })) {
      upgradableEpic += 1;
      if (!controlItem && row.itemType === "weapon") {
        controlItem = row;
      }
    }
  }
  const epicTotal = rows.filter((row) => row.rarity === "epic").length;
  console.log(`\n（背景）极品装备 ${epicTotal} 件，其中 ${upgradableEpic} 件能跃升到仙品——只有同段存在仙品才跃升得动`);

  if (controlItem) {
    let hits = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      const result = await rollUpgradedItemId({ itemId: controlItem.id, rarityUpRate: 0.1 });
      if (result !== controlItem.id) {
        hits += 1;
      }
    }
    const hitRate = hits / SAMPLES;
    step(`跃升到仙品不打折（对照组：${controlItem.name}）`, Math.abs(hitRate - 0.1) < 0.04,
      `实测 ${(hitRate * 100).toFixed(2)}%（期望 10%）`);
  }

  /* 综合出货：打造一件鸿蒙要多少次 */
  const craftSuccess = Math.min(0.98, 0.685 + 0.15); // 仙品配方平均成功率 + 满级专精加成
  const perCraft = craftSuccess * 0.1 * HONGMENG_UPGRADE_CHANCE_MULT;
  console.log(`\n=== 满级专精下打造一件鸿蒙 ===`);
  console.log(`  单次打造出鸿蒙 ≈ ${(perCraft * 100).toFixed(2)}%  → 平均 ${Math.round(1 / perCraft)} 次打造一件`);
  console.log(`  （仙品配方成功率 ${(craftSuccess * 100).toFixed(1)}% × 跃升 ${(0.1 * HONGMENG_UPGRADE_CHANCE_MULT * 100).toFixed(1)}%）`);
  for (const level of [1, 3, 5, 10]) {
    const rate = level * 0.01 * HONGMENG_UPGRADE_CHANCE_MULT;
    const success = Math.min(0.98, 0.685 + level * 0.015);
    console.log(`  专精 ${String(level).padStart(2)} 级：跃升 ${(rate * 100).toFixed(2)}%，平均 ${Math.round(1 / (success * rate))} 次打造一件`);
  }

  console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项未通过`);
}

await main();
