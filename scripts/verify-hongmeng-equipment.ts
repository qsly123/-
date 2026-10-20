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
  CRAFT_HONGMENG_CHANCE,
  RARITY_EFFECTIVE_MULT,
  computeStageMult,
  rollCraftRarityItemId,
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

  /* 每件仙品都要有同段同部位的鸿蒙目标（方案A 的品级掷骰依赖这些目标物品） */
  const broken: string[] = [];
  for (const item of legendary) {
    const target = rows.find((row) => row.rarity === "hongmeng"
      && row.itemType === item.itemType
      && (row.minRealm ?? 1) === (item.minRealm ?? 1));
    if (!target) {
      broken.push(item.name);
    }
  }
  step("每件仙品都有鸿蒙跃升目标", broken.length === 0,
    broken.length === 0 ? `${legendary.length}/${legendary.length} 通` : `断链：${broken.join("、")}`);

  /* 数值：鸿蒙 = 仙品 × (1.55 / 1.4)，差值来自生效品质倍率 */
  if (legendary.length > 0 && hongmeng.length > 0) {
    const sample = legendary.find((row) => row.itemType === "weapon") || legendary[0];
    const target = rows.find((row) => row.rarity === "hongmeng"
      && row.itemType === sample.itemType
      && (row.minRealm ?? 1) === (sample.minRealm ?? 1));
    const targetRow = target ?? null;
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

  /* 概率随机出品级（方案A）实测：仙品基准 ≈ 99.5% 留在仙品、0.5% 落鸿蒙 */
  const sample = legendary.find((row) => row.itemType === "weapon") || legendary[0];
  const SAMPLES = 4000;
  if (sample) {
    const counts = new Map<string, number>();
    for (let i = 0; i < SAMPLES; i += 1) {
      const picked = await rollCraftRarityItemId({ itemId: sample.id });
      const row = rows.find((r) => r.id === picked);
      counts.set(row?.rarity ?? picked, (counts.get(row?.rarity ?? picked) ?? 0) + 1);
    }
    const hongmengRate = (counts.get("hongmeng") ?? 0) / SAMPLES;
    step("仙品基准：鸿蒙率 ≈ 绝对概率 0.5%", Math.abs(hongmengRate - CRAFT_HONGMENG_CHANCE) < 0.004,
      `实测 ${(hongmengRate * 100).toFixed(2)}%（期望 ${(CRAFT_HONGMENG_CHANCE * 100).toFixed(1)}%，${SAMPLES} 次，样本：${sample.name}）`);
    const legendaryRate = (counts.get("legendary") ?? 0) / SAMPLES;
    step("仙品基准：步进权重不坍缩到鸿蒙", legendaryRate > 0.9,
      `留在仙品 ${(legendaryRate * 100).toFixed(1)}%`);
  }

  console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项未通过`);
}

await main();
