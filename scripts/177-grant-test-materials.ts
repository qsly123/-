/** 给测试道友补炼器材料：按启用配方把每种材料补齐到可打造 10 次的量 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory } from "@/db/schema";

const PLAYER_NAME = "测试道友";
const CRAFT_TIMES = 10;

type Row = Record<string, unknown>;
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const player = await db.execute<{ id: string; realm: number }>(sql`
    select "id", "realm" from "players" where "name" = ${PLAYER_NAME} limit 1
  `);
  const p = player[0];
  if (!p) {
    console.log(`找不到玩家「${PLAYER_NAME}」`);
    return;
  }
  console.log(`玩家 ${PLAYER_NAME} id=${p.id} realm=${p.realm}`);

  // 启用的炼器配方
  const recipes = await db.execute<Row>(sql`
    select "recipe_code","result_item_id","main_item_id","main_quantity",
           "aux_a_item_id","aux_a_quantity","aux_b_item_id","aux_b_quantity",
           "aux_c_item_id","aux_c_quantity"
    from "smithing_recipes" where "enabled" = true
  `);
  console.log(`启用配方 ${recipes.length} 个`);

  // 汇总每种材料需要的单次用量（取配方里出现过的最大单次需求）
  const need = new Map<string, number>();
  const addNeed = (itemId: unknown, qty: unknown) => {
    const id = typeof itemId === "string" ? itemId.trim() : "";
    const q = num(qty);
    if (!id || q <= 0) return;
    need.set(id, Math.max(need.get(id) ?? 0, q));
  };
  for (const r of recipes) {
    addNeed(r.main_item_id, r.main_quantity);
    addNeed(r.aux_a_item_id, r.aux_a_quantity);
    addNeed(r.aux_b_item_id, r.aux_b_quantity);
    addNeed(r.aux_c_item_id, r.aux_c_quantity);
  }

  // 物品名
  const nameRows = await db.select({ id: items.id, name: items.name }).from(items).all();
  const nameOf = new Map(nameRows.map((n) => [n.id, n.name]));

  const inv = await db.select({ itemId: playerInventory.itemId, quantity: playerInventory.quantity })
    .from(playerInventory).where(sql`${playerInventory.playerId} = ${p.id}`).all();
  const owned = new Map(inv.map((i) => [i.itemId, Number(i.quantity)]));

  console.log("\n材料补齐结果：");
  let granted = 0;
  for (const [itemId, perCraft] of [...need.entries()].sort()) {
    const target = perCraft * CRAFT_TIMES;
    const current = owned.get(itemId) ?? 0;
    if (current >= target) {
      console.log(`  跳过 ${nameOf.get(itemId) ?? itemId}：已有 ${current}（需 ${target}）`);
      continue;
    }
    if (owned.has(itemId)) {
      await db.execute(sql`
        update "player_inventory" set "quantity" = ${target}
        where "player_id" = ${p.id} and "item_id" = ${itemId}
      `);
    } else {
      await db.insert(playerInventory).values({
        playerId: p.id, itemId, quantity: target, equipped: false, refineLevel: 0, stageMult: 1,
      });
    }
    console.log(`  ✓ ${nameOf.get(itemId) ?? itemId}: ${current} → ${target}（单次需 ${perCraft}）`);
    granted += 1;
  }
  console.log(`\n完成：补齐 ${granted} 种材料，每种够打造 ${CRAFT_TIMES} 次`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
