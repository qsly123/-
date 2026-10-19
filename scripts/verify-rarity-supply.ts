/**
 * 仙品 / 鸿蒙到底怎么出、概率多大。
 *
 * 关键前提：装备品级**不是打造时随机的**，而是配方产物写死的（result_item_id），
 * 掉落和商店同理。所以"出货概率"要分三条路分别统计：打造、掉落、商店。
 * 唯一带随机的是炼器专精的「品质跃升」（每级 +1%，满级 10%，且只能升一档）。
 *
 * 用法：bun run scripts/verify-rarity-supply.ts
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, monsters, npcs } from "@/db/schema";

const EQUIPMENT_TYPES = ["weapon", "armor", "helmet", "shoes", "artifact"];
const RARITY_LABEL: Record<string, string> = {
  common: "凡品", uncommon: "良品", rare: "上品",
  epic: "极品", legendary: "仙品", hongmeng: "鸿蒙",
};
const HIGH_TIER = new Set(["legendary", "hongmeng"]);

type RarityCount = { rarity: string; cnt: number };

function printDistribution(title: string, rows: RarityCount[]) {
  const total = rows.reduce((sum, row) => sum + row.cnt, 0);
  if (total === 0) {
    console.log(`\n${title}：无数据`);
    return;
  }
  const high = rows.filter((row) => HIGH_TIER.has(row.rarity)).reduce((sum, row) => sum + row.cnt, 0);
  console.log(`\n${title}（共 ${total}）`);
  for (const row of rows) {
    const label = RARITY_LABEL[row.rarity] || row.rarity;
    console.log(`  ${label.padEnd(4)} ${String(row.cnt).padStart(4)}  ${((row.cnt / total) * 100).toFixed(1)}%`);
  }
  console.log(`  → 仙品及以上：${high} 件，占 ${((high / total) * 100).toFixed(1)}%`);
}

async function main() {
  /* 装备总盘 */
  const equipment = await db
    .select({
      rarity: items.rarity,
      cnt: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(inArray(items.itemType, EQUIPMENT_TYPES))
    .groupBy(items.rarity)
    .all();
  printDistribution("装备库里各品级件数", equipment);

  /* 全部物品的品级映射，给掉落/商店用 */
  const itemMeta = await db
    .select({ id: items.id, rarity: items.rarity, itemType: items.itemType, name: items.name })
    .from(items)
    .all();
  const rarityOf = new Map(itemMeta.map((row) => [row.id, row.rarity || "common"]));
  const isEquip = new Map(itemMeta.map((row) => [row.id, EQUIPMENT_TYPES.includes(String(row.itemType || ""))]));

  /* 打造：配方产物 */
  const recipeRows = await db.execute<RarityCount>(`
    SELECT i."rarity" AS "rarity", count(*)::int AS "cnt"
    FROM "smithing_recipes" r
    JOIN "items" i ON i."id" = r."result_item_id"
    GROUP BY i."rarity"
    ORDER BY i."rarity"
  ` as never).catch(() => [] as RarityCount[]);
  printDistribution("炼器配方产物品级（打造出什么品级，写死在配方里）", recipeRows);

  /* 掉落 */
  const monsterRows = await db
    .select({ name: monsters.name, drops: monsters.drops })
    .from(monsters)
    .all();
  const dropCount = new Map<string, number>();
  const dropRateSum = new Map<string, number>();
  let dropWithRate = 0;
  let dropEquipTotal = 0;
  for (const monster of monsterRows) {
    const drops: Array<{ itemId?: string; chance?: number }> = Array.isArray(monster.drops) ? monster.drops : [];
    for (const drop of drops) {
      const itemId = String(drop.itemId ?? "").trim();
      if (!itemId || !isEquip.get(itemId)) continue;
      const rarity = rarityOf.get(itemId) || "common";
      dropCount.set(rarity, (dropCount.get(rarity) ?? 0) + 1);
      dropEquipTotal += 1;
      const rate = Number(drop.chance ?? NaN);
      if (Number.isFinite(rate)) {
        dropRateSum.set(rarity, (dropRateSum.get(rarity) ?? 0) + rate);
        dropWithRate += 1;
      }
    }
  }
  printDistribution("怪物掉落表里的装备条目", [...dropCount].map(([rarity, cnt]) => ({ rarity, cnt })));
  if (dropWithRate > 0 && dropRateSum.size > 0) {
    console.log("  掉落概率字段（按品级求和，含概率的条目）：");
    for (const [rarity, sum] of dropRateSum) {
      const cnt = dropCount.get(rarity) ?? 1;
      console.log(`    ${(RARITY_LABEL[rarity] || rarity).padEnd(4)} ${cnt} 条，概率合计 ${(sum * 100).toFixed(1)}%（平均 ${((sum / cnt) * 100).toFixed(2)}%）`);
    }
  } else {
    console.log(`  掉落条目里没读到概率字段（${dropEquipTotal} 条装备掉落，可能只有 itemId）`);
  }

  /* 商店 */
  const shopRows = await db
    .select({ shopItems: npcs.shopItems })
    .from(npcs)
    .all();
  const shopCount = new Map<string, number>();
  for (const row of shopRows) {
    const entries = Array.isArray(row.shopItems) ? row.shopItems as Array<Record<string, unknown>> : [];
    for (const entry of entries) {
      const itemId = String(entry.itemId ?? entry.item_id ?? "").trim();
      if (!itemId || !isEquip.get(itemId)) continue;
      const rarity = rarityOf.get(itemId) || "common";
      shopCount.set(rarity, (shopCount.get(rarity) ?? 0) + 1);
    }
  }
  printDistribution("商店售卖的装备条目", [...shopCount].map(([rarity, cnt]) => ({ rarity, cnt })));

  /* 打造成功率：配方列名不固定，先探再统计 */
  const sample = await db.execute<Record<string, unknown>>(`SELECT * FROM "smithing_recipes" LIMIT 1` as never)
    .catch(() => [] as Record<string, unknown>[]);
  const columnNames = sample[0] ? Object.keys(sample[0]) : [];
  const successColumn = columnNames.find((name) => /success/i.test(name));
  if (successColumn && sample[0]) {
    const sampleValue = sample[0][successColumn];
    console.log(`\n=== 打造「成功率」字段：${successColumn}（样例值 ${String(sampleValue)}）===`);
    const rateRows = await db.execute<{ rarity: string; minRate: number; maxRate: number; avgRate: number }>(`
      SELECT i."rarity" AS "rarity",
             min(r."${successColumn}")::float AS "minRate",
             max(r."${successColumn}")::float AS "maxRate",
             round(avg(r."${successColumn}")::numeric, 3)::float AS "avgRate"
      FROM "smithing_recipes" r
      JOIN "items" i ON i."id" = r."result_item_id"
      GROUP BY i."rarity"
      ORDER BY i."rarity"
    ` as never).catch(() => [] as { rarity: string; minRate: number; maxRate: number; avgRate: number }[]);
    for (const row of rateRows) {
      const label = RARITY_LABEL[row.rarity] || row.rarity;
      console.log(`  ${label.padEnd(4)} 成功率 ${(row.minRate * 100).toFixed(1)}% ~ ${(row.maxRate * 100).toFixed(1)}%（平均 ${(row.avgRate * 100).toFixed(1)}%）`);
    }
  } else {
    console.log(`\n配方表字段：${columnNames.join(", ") || "读取失败"}`);
  }

  /* 品质跃升（唯一带随机的地方） */
  console.log("\n=== 炼器专精·品质跃升（唯一的随机升品级通道） ===");
  console.log("  每级 +1% 跃升概率，满级 10 级 → 10%");
  console.log("  跃升只能升一档（findUpgradedItem 取下一档），极品→仙品、仙品→鸿蒙，不能连跳");
  console.log("  满级打造一件「极品」配方：10% 变仙品；打造「仙品」配方：10% 变鸿蒙");
}

await main();
