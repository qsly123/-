/**
 * 播种炼器（打造）配方。
 *
 * 为什么需要这个脚本：
 *   `smithing_recipes` 是炼器服务用 raw SQL 动态建的表（`ensureSmithingCoreSchema`），
 *   而建表函数**只建表、不插任何配方**。库里这张表压根不存在，配方是 0 条 ——
 *   也就是说装备既没有掉落、也不在商铺，打造页又是空的，玩家根本拿不到装备。
 *   本脚本按「每件装备一条配方」把打造途径补上。
 *
 * 配方取材：用同段的材料（`item_four_realms_{lq|zj|jd|yy}_mat_xN`），
 * 主材料按装备稀有度取同档材料，辅料降一档；品质越高、用量越大、成功率越低。
 *
 * 用法：bun run scripts/seed-smithing.ts [--apply]
 * 默认 dry-run，加 --apply 写库。按 recipe_code 幂等 upsert。
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { ensureSmithingCoreSchema } from "@/modules/character/services/smithing-service";

/** 装备 id 里的段位（全拼）→ 材料 id 里的段位（缩写） */
const SEG_TO_MAT: Record<string, string> = {
  lianqi: "lq",
  zhuji: "zj",
  jiedan: "jd",
  yuanying: "yy",
};

const EQUIP_TYPES = ["weapon", "armor", "helmet", "shoes", "artifact"] as const;

/** 稀有度从低到高 */
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "hongmeng"];

const RARITY_RANK: Record<string, number> = {
  common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, hongmeng: 5,
};

interface ItemRow {
  id: string;
  name: string;
  itemType: string;
  rarity: string | null;
}

/** 主材料用量 / 成功率：品质越高越难做 */
function recipeTuning(rank: number) {
  const mainQuantity = 3 + rank * 2;          // common 3 → legendary 11
  const baseSuccessRate = Math.max(0.35, 0.88 - rank * 0.11);
  return { mainQuantity, baseSuccessRate };
}

async function loadItems() {
  const rows = await db.select({
    id: items.id,
    name: items.name,
    itemType: items.itemType,
    rarity: items.rarity,
  }).from(items).all();
  return rows as ItemRow[];
}

function segmentOf(id: string): string | null {
  for (const seg of Object.keys(SEG_TO_MAT)) {
    if (id.includes(`_${seg}_`)) return seg;
  }
  return null;
}

async function main() {
  await ensureSmithingCoreSchema();

  const all = await loadItems();

  // 离线包已经自带一部分配方（ensureSmithingCoreSchema 首次调用时会 seed 进去），
  // 这里只补「还没有配方」的装备，否则会给同一件装备造出多条重复配方。
  const existingRows = await db.execute(sql`SELECT result_item_id FROM smithing_recipes`);
  const alreadyCovered = new Set(
    (existingRows as unknown as Array<{ result_item_id: string }>).map((row) => row.result_item_id),
  );

  const equips = all
    .filter((item) => EQUIP_TYPES.includes(item.itemType as typeof EQUIP_TYPES[number]))
    .filter((item) => !alreadyCovered.has(item.id));

  // 材料按「段位 + 稀有度」分池
  const matPool = new Map<string, ItemRow[]>();
  for (const item of all) {
    if (item.itemType !== "material") continue;
    const match = /item_four_realms_(lq|zj|jd|yy)_mat_/.exec(item.id);
    const seg = match ? match[1] : null;
    if (!seg) continue;
    const rarity = item.rarity || "common";
    const key = `${seg}:${rarity}`;
    const list = matPool.get(key) || [];
    list.push(item);
    matPool.set(key, list);
  }

  /** 取一个材料：优先同档，没有就往低一档找（保证每段都能凑出配方） */
  const pickMaterial = (seg: string, rank: number, offset: number): ItemRow | null => {
    for (let r = rank; r >= 0; r -= 1) {
      const list = matPool.get(`${seg}:${RARITY_ORDER[r]}`);
      if (list && list.length > 0) return list[offset % list.length];
    }
    return null;
  };

  const recipes: Array<Record<string, unknown>> = [];
  const skipped: string[] = [];

  for (const equip of equips) {
    const segFull = segmentOf(equip.id);
    if (!segFull) {
      skipped.push(`${equip.name}（id 无段位标记）`);
      continue;
    }
    const seg = SEG_TO_MAT[segFull];
    const rank = RARITY_RANK[equip.rarity || "common"] ?? 0;
    const { mainQuantity, baseSuccessRate } = recipeTuning(rank);

    // 用装备 id 的序号做偏移，让同档装备不会全用同一件材料
    const offset = Number(/x(\d+)$/.exec(equip.id)?.[1] || equip.id.length);

    const main = pickMaterial(seg, rank, offset);
    if (!main) {
      skipped.push(`${equip.name}（${seg} 段没有可用材料）`);
      continue;
    }
    const auxA = pickMaterial(seg, rank - 1, offset + 1);
    const auxB = pickMaterial(seg, Math.max(0, rank - 2), offset + 2);

    const auxAQuantity = auxA ? Math.max(2, Math.round(mainQuantity * 0.6)) : 0;
    const auxBQuantity = auxB && rank >= 2 ? Math.max(2, Math.round(mainQuantity * 0.4)) : 0;

    recipes.push({
      recipe_code: `smith_${equip.id}`,
      result_item_id: equip.id,
      result_item_name: equip.name,
      result_quantity: 1,
      main_item_id: main.id,
      main_item_name: main.name,
      main_quantity: mainQuantity,
      base_success_rate: Number(baseSuccessRate.toFixed(2)),
      aux_a_item_id: auxA?.id || null,
      aux_a_item_name: auxA?.name || "",
      aux_a_quantity: auxAQuantity,
      aux_a_bonus_rate: auxA ? 0.06 : 0,
      aux_b_item_id: auxB?.id || null,
      aux_b_item_name: auxB?.name || "",
      aux_b_quantity: auxBQuantity,
      aux_b_bonus_rate: auxB ? 0.04 : 0,
      aux_c_item_id: null,
      aux_c_item_name: "",
      aux_c_quantity: 0,
      aux_c_bonus_rate: 0,
      enabled: true,
      sort_order: rank * 100 + offset,
    });
  }

  console.log(`待补装备 ${equips.length} 件（离线包已覆盖 ${alreadyCovered.size} 件，已跳过）`);
  console.log(`生成配方 ${recipes.length} 条，跳过 ${skipped.length} 条`);
  if (skipped.length > 0) {
    console.log(`  跳过样例：${skipped.slice(0, 5).join(" / ")}`);
  }

  // 按段位汇总，确认四段都覆盖到了
  const bySeg = new Map<string, number>();
  for (const recipe of recipes) {
    const segFull = segmentOf(String(recipe.result_item_id)) || "未知";
    bySeg.set(segFull, (bySeg.get(segFull) || 0) + 1);
  }
  for (const [seg, count] of [...bySeg.entries()].sort()) {
    console.log(`  ${seg}: ${count} 条`);
  }

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("\n dry-run：未写库。加 --apply 执行。");
    if (recipes.length > 0) {
      const sample = recipes[0];
      console.log(`  样例：${sample.result_item_name} ← ${sample.main_item_name} x${sample.main_quantity}`
        + `${sample.aux_a_item_name ? ` + ${sample.aux_a_item_name} x${sample.aux_a_quantity}` : ""}`
        + `  成功率 ${sample.base_success_rate}`);
    }
    return;
  }

  let created = 0;
  let updated = 0;
  for (const recipe of recipes) {
    const code = String(recipe.recipe_code);
    const existing = await db.execute(sql`
      SELECT id FROM smithing_recipes WHERE recipe_code = ${code} LIMIT 1
    `);
    const rows = (existing as unknown as { rows?: unknown[] }).rows || [];
    if (rows.length > 0) {
      await db.execute(sql`
        UPDATE smithing_recipes SET
          result_item_id = ${recipe.result_item_id as string},
          result_item_name = ${recipe.result_item_name as string},
          result_quantity = ${recipe.result_quantity as number},
          main_item_id = ${recipe.main_item_id as string},
          main_item_name = ${recipe.main_item_name as string},
          main_quantity = ${recipe.main_quantity as number},
          base_success_rate = ${recipe.base_success_rate as number},
          aux_a_item_id = ${(recipe.aux_a_item_id as string) || null},
          aux_a_item_name = ${recipe.aux_a_item_name as string},
          aux_a_quantity = ${recipe.aux_a_quantity as number},
          aux_a_bonus_rate = ${recipe.aux_a_bonus_rate as number},
          aux_b_item_id = ${(recipe.aux_b_item_id as string) || null},
          aux_b_item_name = ${recipe.aux_b_item_name as string},
          aux_b_quantity = ${recipe.aux_b_quantity as number},
          aux_b_bonus_rate = ${recipe.aux_b_bonus_rate as number},
          enabled = true,
          sort_order = ${recipe.sort_order as number},
          updated_at = NOW()::text
        WHERE recipe_code = ${code}
      `);
      updated += 1;
    } else {
      await db.execute(sql`
        INSERT INTO smithing_recipes (
          recipe_code, result_item_id, result_item_name, result_quantity,
          main_item_id, main_item_name, main_quantity, base_success_rate,
          aux_a_item_id, aux_a_item_name, aux_a_quantity, aux_a_bonus_rate,
          aux_b_item_id, aux_b_item_name, aux_b_quantity, aux_b_bonus_rate,
          aux_c_item_id, aux_c_item_name, aux_c_quantity, aux_c_bonus_rate,
          enabled, sort_order
        ) VALUES (
          ${code},
          ${recipe.result_item_id as string}, ${recipe.result_item_name as string}, ${recipe.result_quantity as number},
          ${recipe.main_item_id as string}, ${recipe.main_item_name as string}, ${recipe.main_quantity as number}, ${recipe.base_success_rate as number},
          ${(recipe.aux_a_item_id as string) || null}, ${recipe.aux_a_item_name as string}, ${recipe.aux_a_quantity as number}, ${recipe.aux_a_bonus_rate as number},
          ${(recipe.aux_b_item_id as string) || null}, ${recipe.aux_b_item_name as string}, ${recipe.aux_b_quantity as number}, ${recipe.aux_b_bonus_rate as number},
          ${(recipe.aux_c_item_id as string) || null}, ${recipe.aux_c_item_name as string}, ${recipe.aux_c_quantity as number}, ${recipe.aux_c_bonus_rate as number},
          true, ${recipe.sort_order as number}
        )
      `);
      created += 1;
    }
  }

  console.log(`\n写入完成：新增 ${created} 条，更新 ${updated} 条`);
}

await main();
