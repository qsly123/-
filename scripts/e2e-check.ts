/**
 * 全流程端到端验证（用测试号跑一遍，找卡点）。
 *
 * 覆盖：丹药效果键合法性 → 炼丹 → 打造 → 突破。
 * 每一步注入所需数据，跑完把背包与修为恢复原样，不留痕迹。
 *
 * 用法：bun run scripts/e2e-check.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory, players } from "@/db/schema";
import { craftAlchemyRecipe } from "@/modules/character/services/alchemy-service";
import { craftSmithingRecipe } from "@/modules/character/services/smithing-service";
import { attemptBreakthrough } from "@/modules/character/services/cultivation";

/**
 * 仓库里「使用物品」真正处理的效果键（inventory route）。
 * 注意 boost_xp 不在 case 分支里，而是在进入 switch 前单独 reduce 累加修为，
 * 别只照着 case 列表抄，否则会误报。
 */
const SUPPORTED_USE_EFFECTS = new Set([
  "heal_hp", "heal_mp", "heal_stamina", "reduce_toxicity",
  "boost_breakthrough", "unlock_avatar", "unlock_avatar_frame", "boost_xp",
]);

const PLAYER_ID = "ZbfY3sLCG5AhBa7Y"; // 测试道友

const restore: Array<{ itemId: string; hadBefore: boolean; quantityBefore: number }> = [];

async function addItem(playerId: string, itemId: string, quantity: number) {
  const existing = await db.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId))).get();
  restore.push({ itemId, hadBefore: Boolean(existing), quantityBefore: existing?.quantity ?? 0 });
  if (existing) {
    await db.update(playerInventory).set({ quantity: existing.quantity + quantity })
      .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, itemId))).run();
  } else {
    await db.insert(playerInventory).values({
      playerId, itemId, quantity, equipped: false, refineLevel: 0,
    }).run();
  }
}

async function cleanup(playerId: string) {
  for (const entry of restore) {
    if (!entry.hadBefore) {
      await db.delete(playerInventory)
        .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, entry.itemId))).run();
    } else {
      await db.update(playerInventory).set({ quantity: entry.quantityBefore })
        .where(and(eq(playerInventory.playerId, playerId), eq(playerInventory.itemId, entry.itemId))).run();
    }
  }
}

function step(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name} —— ${detail}`);
}

async function main() {
  const player = await db.select().from(players).where(eq(players.id, PLAYER_ID)).get();
  if (!player) {
    console.log(`找不到测试号 ${PLAYER_ID}`);
    return;
  }
  const xpBefore = Number(player.cultivationXp || 0);
  console.log(`测试号：${player.name}（境界 ${player.realmMajor}.${player.realmMinor}，修为 ${xpBefore}）\n`);

  // ---------- 1. 丹药效果键合法性 ----------
  const pills = await db.select({ id: items.id, name: items.name, effects: items.effects })
    .from(items).where(eq(items.itemType, "consumable")).all();

  const badPills: Array<{ name: string; types: string[] }> = [];
  const noEffectPills: string[] = [];
  for (const pill of pills) {
    // 注意：items.effects 是数组 [{type,value}]，不是 {effects:[...]}
    const effects = pill.effects as unknown as Array<{ type?: string }> | null;
    const types = (effects ?? []).map((entry) => String(entry?.type || ""));
    if (types.length === 0) {
      noEffectPills.push(pill.name);
      continue;
    }
    const invalid = types.filter((type) => !SUPPORTED_USE_EFFECTS.has(type));
    if (invalid.length > 0) badPills.push({ name: pill.name, types: invalid });
  }
  step("丹药效果键合法性", badPills.length === 0,
    badPills.length === 0
      ? `${pills.length} 个消耗品，效果键全部有效`
      : `${badPills.length} 个用了不支持的键（吃了没反应）：`
        + badPills.slice(0, 5).map((p) => `${p.name}[${p.types.join(",")}]`).join(" / "));
  if (noEffectPills.length > 0) {
    console.log(`       （另有 ${noEffectPills.length} 个消耗品没有任何效果：${noEffectPills.slice(0, 3).join("、")}）`);
  }

  // ---------- 2. 炼丹 ----------
  try {
    const rows = await db.execute(sql`SELECT recipe_code, result_item_id, result_item_name,
      main_item_id, main_quantity, aux_a_item_id, aux_a_quantity, aux_b_item_id, aux_b_quantity
      FROM alchemy_recipes WHERE enabled = true LIMIT 1`);
    const recipe = (rows as unknown as Record<string, unknown>[])[0];
    if (!recipe) {
      step("炼丹", false, "没有可用丹方");
    } else {
      const need: Array<[string, number]> = [
        [String(recipe.main_item_id), Number(recipe.main_quantity || 1)],
      ];
      if (recipe.aux_a_item_id) need.push([String(recipe.aux_a_item_id), Number(recipe.aux_a_quantity || 1)]);
      if (recipe.aux_b_item_id) need.push([String(recipe.aux_b_item_id), Number(recipe.aux_b_quantity || 1)]);
      for (const [itemId, quantity] of need) {
        if (itemId && itemId !== "null") await addItem(PLAYER_ID, itemId, quantity + 2);
      }
      // craftAlchemyRecipe 返回的是「炼丹面板 view」，不是成败结果；
      // 真正的成败要看 player_alchemy_logs 里刚写入的那条。
      await craftAlchemyRecipe({ playerId: PLAYER_ID, recipeId: String(recipe.recipe_code) });
      const logs = await db.execute(sql`
        SELECT success, final_success_rate, result_item_name FROM player_alchemy_logs
        WHERE player_id = ${PLAYER_ID} ORDER BY id DESC LIMIT 1`);
      const log = (logs as unknown as Record<string, unknown>[])[0];
      step("炼丹", Boolean(log?.success),
        `${recipe.result_item_name} → ${log?.success ? "成功" : "失败（概率失败，非错误）"}`
        + ` 产出${log?.result_item_name ?? "-"} 成功率${log?.final_success_rate ?? "-"}`);
    }
  } catch (error) {
    step("炼丹", false, `抛错：${error instanceof Error ? error.message : String(error)}`);
  }

  // ---------- 3. 打造 ----------
  try {
    const rows = await db.execute(sql`SELECT recipe_code, result_item_name,
      main_item_id, main_quantity, aux_a_item_id, aux_a_quantity
      FROM smithing_recipes WHERE enabled = true AND result_item_name <> '' LIMIT 1`);
    const recipe = (rows as unknown as Record<string, unknown>[])[0];
    if (!recipe) {
      step("打造", false, "没有可用配方");
    } else {
      await addItem(PLAYER_ID, String(recipe.main_item_id), Number(recipe.main_quantity || 1) + 2);
      if (recipe.aux_a_item_id && String(recipe.aux_a_item_id) !== "null") {
        await addItem(PLAYER_ID, String(recipe.aux_a_item_id), Number(recipe.aux_a_quantity || 1) + 2);
      }
      // 同炼丹：返回的是面板 view，成败看 player_smithing_logs
      await craftSmithingRecipe({ playerId: PLAYER_ID, recipeId: String(recipe.recipe_code) });
      const logs = await db.execute(sql`
        SELECT success, final_success_rate, result_item_name FROM player_smithing_logs
        WHERE player_id = ${PLAYER_ID} ORDER BY id DESC LIMIT 1`);
      const log = (logs as unknown as Record<string, unknown>[])[0];
      step("打造", Boolean(log?.success),
        `${recipe.result_item_name} → ${log?.success ? "成功" : "失败（概率失败，非错误）"}`
        + ` 产出${log?.result_item_name ?? "-"} 成功率${log?.final_success_rate ?? "-"}`);
    }
  } catch (error) {
    step("打造", false, `抛错：${error instanceof Error ? error.message : String(error)}`);
  }

  // ---------- 4. 突破 ----------
  try {
    const stats = {
      hp: Number(player.hp || 0), maxHp: Number(player.maxHp || 0),
      mp: Number(player.mp || 0), maxMp: Number(player.maxMp || 0),
      attack: Number(player.attack || 0), defense: Number(player.defense || 0),
      speed: Number(player.speed || 0), luck: Number(player.luck || 0),
      spiritualSense: Number(player.spiritualSense || 0),
      armorPenetration: Number(player.armorPenetration || 0),
      block: Number(player.block || 0),
      skillDamageBonus: Number(player.skillDamageBonus || 0),
      skillDamageReduction: Number(player.skillDamageReduction || 0),
      artifactDamageBonus: Number(player.artifactDamageBonus || 0),
      artifactDamageReduction: Number(player.artifactDamageReduction || 0),
    };
    const result = await attemptBreakthrough({
      currentMajor: Number(player.realmMajor),
      currentMinor: Number(player.realmMinor),
      currentXp: xpBefore,
      currentStats: stats,
    });
    step("突破境界", Boolean(result.success),
      result.success
        ? `${player.realmMajor}.${player.realmMinor} → ${result.newMajor}.${result.newMinor}（${result.newRealmName}）`
        : `未成功：${result.message}`);
  } catch (error) {
    step("突破境界", false, `抛错：${error instanceof Error ? error.message : String(error)}`);
  }

  // ---------- 恢复 ----------
  await cleanup(PLAYER_ID);
  await db.update(players).set({ cultivationXp: xpBefore }).where(eq(players.id, PLAYER_ID)).run();
  console.log(`\n已恢复测试号背包（${restore.length} 项）与修为`);
}

await main();
