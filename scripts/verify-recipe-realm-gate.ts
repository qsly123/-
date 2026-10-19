/**
 * 低境界玩家能不能真的做出高品级装备。
 *
 * 配方本身不过滤境界（smithing_recipes 没有境界列），所以真正的门槛在：
 *   1. 材料的 minRealm —— 材料的来源（掉落/商店）是不是在高境界地图
 *   2. 产物的 minRealm —— 做出来了练气玩家也穿不上
 * 本脚本把这两层一次查清。
 *
 * 用法：bun run scripts/verify-recipe-realm-gate.ts
 */
import { db } from "@/db";

type Row = {
  result_name: string;
  result_rarity: string;
  result_min_realm: number | null;
  main_name: string | null;
  main_min_realm: number | null;
  aux_a_name: string | null;
  aux_a_min_realm: number | null;
  aux_b_name: string | null;
  aux_b_min_realm: number | null;
  aux_c_name: string | null;
  aux_c_min_realm: number | null;
};

const RECIPE_SQL = `
  SELECT
    res."name" AS "result_name",
    res."rarity" AS "result_rarity",
    res."min_realm" AS "result_min_realm",
    m."name" AS "main_name", m."min_realm" AS "main_min_realm",
    a."name" AS "aux_a_name", a."min_realm" AS "aux_a_min_realm",
    b."name" AS "aux_b_name", b."min_realm" AS "aux_b_min_realm",
    c."name" AS "aux_c_name", c."min_realm" AS "aux_c_min_realm"
  FROM "smithing_recipes" r
  JOIN "items" res ON res."id" = r."result_item_id"
  LEFT JOIN "items" m ON m."id" = r."main_item_id"
  LEFT JOIN "items" a ON a."id" = r."aux_a_item_id"
  LEFT JOIN "items" b ON b."id" = r."aux_b_item_id"
  LEFT JOIN "items" c ON c."id" = r."aux_c_item_id"
  WHERE res."rarity" IN ('legendary','hongmeng','epic')
  ORDER BY res."rarity", res."min_realm", res."name"
`;

async function main() {
  const rows = await db.execute<Row>(RECIPE_SQL as never).catch(() => [] as Row[]);
  if (rows.length === 0) {
    console.log("查不到配方（表或列不存在）");
    return;
  }

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = String(row.result_rarity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [rarity, list] of groups) {
    console.log(`\n=== 产物品级：${rarity}（${list.length} 个配方）===`);
    for (const row of list) {
      const materials = [
        row.main_name ? `${row.main_name}(≥${row.main_min_realm ?? "-"})` : null,
        row.aux_a_name ? `${row.aux_a_name}(≥${row.aux_a_min_realm ?? "-"})` : null,
        row.aux_b_name ? `${row.aux_b_name}(≥${row.aux_b_min_realm ?? "-"})` : null,
        row.aux_c_name ? `${row.aux_c_name}(≥${row.aux_c_min_realm ?? "-"})` : null,
      ].filter(Boolean);
      const highest = Math.max(
        Number(row.main_min_realm ?? 0),
        Number(row.aux_a_min_realm ?? 0),
        Number(row.aux_b_min_realm ?? 0),
        Number(row.aux_c_min_realm ?? 0),
      );
      console.log(
        `  ${String(row.result_name).padEnd(10)} 产物≥${row.result_min_realm ?? "-"}`
        + ` | 材料最高门槛 ≥${highest || "-"} | ${materials.join(" + ")}`,
      );
    }
  }
}

await main();
