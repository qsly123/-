/**
 * 验证「打怪 → 掉材料 → 打造 → 穿上」这条链是不是真的通。
 *
 * 用测试号「测试道友」，注入/发放后跑完恢复原样。
 * 脚本先打印掉落与装备槽的真实结构（避免我猜字段猜错），再实发验证。
 *
 * 用法：bun run scripts/battle-chain-check.ts
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, monsters, playerInventory, players } from "@/db/schema";
import { grantRewardToPlayer } from "@/modules/character/services/reward-service";
import { craftSmithingRecipe } from "@/modules/character/services/smithing-service";

const PLAYER_ID = "ZbfY3sLCG5AhBa7Y";

/** 恢复用：记录跑之前这些物品在背包里的数量 */
const touched = new Map<string, number | null>(); // itemId -> 原数量（null = 原本没有）

async function snapshot(itemIds: string[]) {
  for (const itemId of itemIds) {
    if (touched.has(itemId)) continue;
    const row = await db.select().from(playerInventory)
      .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, itemId))).get();
    touched.set(itemId, row ? row.quantity : null);
  }
}

async function owned(itemId: string): Promise<number> {
  const row = await db.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, itemId))).get();
  return row?.quantity ?? 0;
}

function step(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name} —— ${detail}`);
}

async function main() {
  const player = await db.select().from(players).where(eq(players.id, PLAYER_ID)).get();
  if (!player) {
    console.log("找不到测试号");
    return;
  }

  // ---------- 0. 先摸清结构 ----------
  const monsterRows = await db.select({ id: monsters.id, name: monsters.name, drops: monsters.drops })
    .from(monsters).all();
  const withDrops = monsterRows.filter((m) => m.drops && String(m.drops).length > 2);
  console.log(`怪物总数 ${monsterRows.length}，有掉落配置 ${withDrops.length} 只`);
  console.log(`掉落结构样例：${withDrops[0]?.name} => ${JSON.stringify(withDrops[0]?.drops).slice(0, 160)}`);

  const equippedRows = await db.select({ equipSlot: playerInventory.equipSlot, itemId: playerInventory.itemId })
    .from(playerInventory).where(eq(playerInventory.equipped, true)).all();
  console.log(`已装备记录 ${equippedRows.length} 条，equip_slot 取值样例：`
    + `${[...new Set(equippedRows.map((r) => r.equipSlot))].join(" / ") || "(无)"}\n`);

  // ---------- 1. 掉落发放：按怪物掉落表 roll 一次并发给玩家 ----------
  const target = withDrops[0];
  if (!target) {
    step("掉落发放", false, "没有任何怪物配了掉落");
    return;
  }

  // 掉落表形态可能是数组，也可能是 {items:[...]}，两种都兼容
  const raw = target.drops as unknown;
  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw as Array<Record<string, unknown>>
    : ((raw as { items?: Array<Record<string, unknown>> })?.items ?? []);

  const granted: Array<{ itemId: string; quantity: number }> = [];
  for (const entry of list) {
    const itemId = String(entry.itemId ?? entry.item_id ?? entry.id ?? "");
    if (!itemId) continue;
    const chance = Number(entry.chance ?? entry.rate ?? entry.probability ?? 1);
    // 概率字段可能是 0-1，也可能是 0-100
    const roll = Math.random() < (chance > 1 ? chance / 100 : chance);
    if (roll) {
      granted.push({ itemId, quantity: Math.max(1, Math.round(Number(entry.quantity ?? entry.count ?? 1))) });
    }
  }

  const itemIds = granted.map((entry) => entry.itemId);
  await snapshot(itemIds);

  if (granted.length === 0) {
    step("掉落发放", false, `${target.name} 的掉落表本次没 roll 出东西（概率所致，重跑可能不同）`);
  } else {
    const before = new Map<string, number>();
    for (const id of itemIds) before.set(id, await owned(id));

    await grantRewardToPlayer({ playerId: PLAYER_ID, reward: { items: granted } });

    const after = new Map<string, number>();
    for (const id of itemIds) after.set(id, await owned(id));
    const changed = granted.filter((entry) => (after.get(entry.itemId) ?? 0) > (before.get(entry.itemId) ?? 0));
    const names = await db.select({ id: items.id, name: items.name }).from(items).all();
    const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? id;
    step("掉落发放", changed.length === granted.length,
      `${target.name} 掉落 ${granted.length} 种 → 实际进背包 ${changed.length} 种`
      + `（${granted.map((g) => `${nameOf(g.itemId)}x${g.quantity}`).join("、")}）`);
  }

  // ---------- 2. 用掉落来的材料打造一件装备 ----------
  const recipeRows = await db.execute(`
    SELECT recipe_code, result_item_id, result_item_name, main_item_id, main_quantity,
           aux_a_item_id, aux_a_quantity
    FROM smithing_recipes WHERE enabled = true
    ORDER BY sort_order LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  const recipe = recipeRows[0];

  if (!recipe) {
    step("打造装备", false, "没有可用配方");
  } else {
    const mainId = String(recipe.main_item_id);
    const mainQty = Number(recipe.main_quantity || 1);
    const auxId = recipe.aux_a_item_id ? String(recipe.aux_a_item_id) : null;
    const auxQty = Number(recipe.aux_a_quantity || 0);
    await snapshot([mainId, ...(auxId ? [auxId] : []), String(recipe.result_item_id)]);

    // 补齐材料（验证的是打造链路本身能不能跑通，不是凑材料的过程）
    if ((await owned(mainId)) < mainQty) {
      await grantRewardToPlayer({ playerId: PLAYER_ID, reward: { items: [{ itemId: mainId, quantity: mainQty }] } });
    }
    if (auxId && auxQty > 0 && (await owned(auxId)) < auxQty) {
      await grantRewardToPlayer({ playerId: PLAYER_ID, reward: { items: [{ itemId: auxId, quantity: auxQty }] } });
    }

    const equipBefore = await owned(String(recipe.result_item_id));
    try {
      await craftSmithingRecipe({ playerId: PLAYER_ID, recipeId: String(recipe.recipe_code) });
    } catch (error) {
      step("打造装备", false, `抛错：${error instanceof Error ? error.message : String(error)}`);
    }
    const logs = await db.execute(`
      SELECT success, result_item_name FROM player_smithing_logs
      WHERE player_id = '${PLAYER_ID}' ORDER BY id DESC LIMIT 1
    `) as unknown as Array<Record<string, unknown>>;
    const log = logs[0];
    const gained = await owned(String(recipe.result_item_id)) > equipBefore;
    step("打造装备", Boolean(log?.success) && gained,
      `${recipe.result_item_name} → 日志${log?.success ? "成功" : "失败"}，`
      + `背包${gained ? "确实多了一件" : "没有增加"}`);
  }

  // ---------- 3. 穿上：验证打造出来的装备能装备 ----------
  const equipTarget = String(recipe?.result_item_id || "");
  const equipItem = await db.select().from(items).where(eq(items.id, equipTarget)).get();
  if (!equipItem) {
    step("穿戴装备", false, "拿不到刚打造的装备记录");
  } else {
    const slot = equipItem.itemType;
    await db.update(playerInventory)
      .set({ equipped: true, equipSlot: slot })
      .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, equipTarget))).run();
    const row = await db.select().from(playerInventory)
      .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, equipTarget))).get();
    step("穿戴装备", Boolean(row?.equipped),
      `${equipItem.name}（${slot}）→ equipped=${row?.equipped ?? false} slot=${row?.equipSlot ?? "-"}`);
  }

  // ---------- 恢复 ----------
  for (const [itemId, original] of touched) {
    if (original === null) {
      await db.delete(playerInventory)
        .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, itemId))).run();
    } else {
      await db.update(playerInventory).set({ quantity: original, equipped: false, equipSlot: null })
        .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, itemId))).run();
    }
  }
  console.log(`\n已恢复测试号背包（${touched.size} 项）`);
}

await main();
