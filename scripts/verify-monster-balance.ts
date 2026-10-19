/**
 * 怪物战力平衡核对：真实玩家的战斗属性 vs 同等级怪物。
 *
 * 关键：不能用 players.attack 这种裸列去比，那是基础属性；
 * 战斗用的是 buildPlayerStatsSnapshot（叠了装备 / 功法 / 状态 / 灵根百分比）。
 *
 * 用法：bun run scripts/verify-monster-balance.ts
 */
import { db } from "@/db";
import { players, monsters, items } from "@/db/schema";
import { sql } from "drizzle-orm";
import { buildPlayerStatsSnapshot } from "@/modules/character/services/player-stats";
import { getPlayerSmithingView } from "@/modules/character/services/smithing-service";
import { getPlayerAlchemyView } from "@/modules/character/services/alchemy-service";

let failed = 0;

function step(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failed += 1;
  }
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` —— ${detail}` : ""}`);
}

/**
 * 回合数对拼：谁先被打死。
 * 伤害用 (攻击 − 防御) 粗算，跟战斗系统主伤害口径一致（技能/暴击另算）。
 */
function simulate(
  player: { hp: number; atk: number; def: number },
  monster: { hp: number; atk: number; def: number },
) {
  const playerDamage = Math.max(1, player.atk - monster.def);
  const monsterDamage = Math.max(1, monster.atk - player.def);
  return {
    turnsToKillMonster: Math.ceil(monster.hp / playerDamage),
    turnsPlayerSurvives: Math.ceil(player.hp / monsterDamage),
    playerDamage,
    monsterDamage,
  };
}

async function main() {
  console.log("=== 玩家战斗属性 vs 同等级怪物 ===\n");

  const playerRows = await db.select().from(players).orderBy(players.realm).limit(10).all();

  for (const row of playerRows) {
    const snapshot = await buildPlayerStatsSnapshot(row);
    const total = snapshot.total as unknown as Record<string, number | undefined>;
    const pAtk = Math.round(Number(total.attack ?? row.attack ?? 0));
    const pDef = Math.round(Number(total.defense ?? row.defense ?? 0));
    const pHp = Math.round(Number(total.maxHp ?? row.maxHp ?? 0));

    // 只对普通怪：精英/boss 本来就该让玩家吃亏，拿它们当基准会把平衡压歪
    const monsterRows = await db.select({
      hp: monsters.hp, attack: monsters.attack, defense: monsters.defense,
    })
      .from(monsters)
      .where(sql`${monsters.level} = ${Number(row.realm)} and ${monsters.monsterType} = 'normal'`)
      .all();

    if (monsterRows.length === 0) {
      console.log(`${row.name}（境界 ${row.realm}）：无同级普通怪 —— 跳过\n`);
      continue;
    }

    const avgHp = monsterRows.reduce((sum, m) => sum + Number(m.hp), 0) / monsterRows.length;
    const avgAtk = monsterRows.reduce((sum, m) => sum + Number(m.attack), 0) / monsterRows.length;
    const avgDef = monsterRows.reduce((sum, m) => sum + Number(m.defense), 0) / monsterRows.length;

    const result = simulate(
      { hp: pHp, atk: pAtk, def: pDef },
      { hp: avgHp, atk: avgAtk, def: avgDef },
    );

    // 打赢的条件：玩家在死之前砍死怪
    const wins = result.turnsToKillMonster < result.turnsPlayerSurvives;
    console.log(`${row.name}（境界 ${row.realm}，战斗属性 hp=${pHp} atk=${pAtk} def=${pDef}）`);
    console.log(`  同级怪平均 hp=${Math.round(avgHp)} atk=${Math.round(avgAtk)} def=${Math.round(avgDef)}`);
    step(
      `  打死怪 ${result.turnsToKillMonster} 回合 / 自己撑 ${result.turnsPlayerSurvives} 回合`,
      wins,
      wins ? "打得过" : "打不过（玩家先死）",
    );
    console.log("");
  }

  /* ---------- 每段的怪是否明显强于上一段 ---------- */
  console.log("=== 段间强度递增 ===");
  const bands: Array<{ label: string; from: number; to: number }> = [
    { label: "练气", from: 2, to: 12 },
    { label: "筑基", from: 13, to: 16 },
    { label: "结丹", from: 17, to: 20 },
    { label: "元婴", from: 21, to: 24 },
    { label: "化神", from: 25, to: 28 },
    { label: "炼虚", from: 29, to: 32 },
    { label: "合体", from: 33, to: 36 },
    { label: "大乘", from: 37, to: 40 },
    { label: "渡劫", from: 41, to: 44 },
  ];

  let prevPower = 0;
  for (const band of bands) {
    const rows = await db.select({ hp: monsters.hp, attack: monsters.attack, defense: monsters.defense })
      .from(monsters).where(sql`${monsters.level} >= ${band.from} and ${monsters.level} <= ${band.to}`).all();
    if (rows.length === 0) {
      step(`${band.label} 有怪`, false, "一只都没有");
      continue;
    }
    const hp = rows.reduce((s, m) => s + Number(m.hp), 0) / rows.length;
    const atk = rows.reduce((s, m) => s + Number(m.attack), 0) / rows.length;
    const def = rows.reduce((s, m) => s + Number(m.defense), 0) / rows.length;
    // 粗略战力：血量权重低，攻防是主要杀伤
    const power = atk * 10 + def * 5 + hp * 0.3;
    const ratio = prevPower > 0 ? power / prevPower : 0;
    console.log(`  ${band.label}：hp=${Math.round(hp)} atk=${Math.round(atk)} def=${Math.round(def)}`
      + ` 战力≈${Math.round(power)}${prevPower > 0 ? `（上一段 ×${ratio.toFixed(2)}）` : ""}`);
    if (prevPower > 0) {
      step(`  ${band.label} 强于上一段`, ratio > 1.2, `×${ratio.toFixed(2)}`);
    }
    prevPower = power;
  }

  /* ---------- 材料 / 装备 / 配方闭环 ---------- */
  console.log("\n=== 材料 → 装备 → 配方 闭环 ===");

  const materialRows = await db.select({ id: items.id, itemType: items.itemType, minRealm: items.minRealm })
    .from(items)
    .where(sql`${items.id} like 'item_four_realms_huashen_material%' or ${items.id} like 'item_four_realms_lianxu_material%' or ${items.id} like 'item_four_realms_heti_material%' or ${items.id} like 'item_four_realms_dacheng_material%' or ${items.id} like 'item_four_realms_dujie_material%'`)
    .all();
  const badType = materialRows.filter((row) => row.itemType !== "material");
  step("高段材料 item_type 都是 material", badType.length === 0 && materialRows.length > 0,
    `${materialRows.length} 个材料，${badType.length} 个类型写错`);

  const gearRows = await db.select({ id: items.id, itemType: items.itemType, effects: items.effects })
    .from(items)
    .where(sql`${items.minRealm} >= 25 and ${items.itemType} in ('weapon','armor','helmet','shoes','artifact')`)
    .all();
  const emptyEffects = gearRows.filter((row) => {
    const list = (row.effects as Array<unknown>) || [];
    return list.length === 0;
  });
  step("高段装备都有属性 effects", gearRows.length > 0 && emptyEffects.length === 0,
    `${gearRows.length} 件装备，${emptyEffects.length} 件无属性`);

  const smithRows = await db.execute(sql`
    select count(*)::int as n from smithing_recipes r
    join items i on i.id = r.result_item_id
    where i.min_realm >= 25
  `);
  const alchemyRows = await db.execute(sql`
    select count(*)::int as n from alchemy_recipes r
    join items i on i.id = r.result_item_id
    where i.min_realm >= 25
  `);
  const smithCount = Number((smithRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  const alchemyCount = Number((alchemyRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  step("25+ 炼器配方齐全（每段 5 件）", smithCount >= 25, `${smithCount} 条`);
  step("25+ 炼丹配方齐全（每段 2 种）", alchemyCount >= 10, `${alchemyCount} 条`);

  // 配方引用的材料必须真的存在，否则玩家看着配方干瞪眼
  const missingMat = await db.execute(sql`
    select count(*)::int as n from smithing_recipes r
    where r.main_item_id is not null
      and not exists (select 1 from items i where i.id = r.main_item_id)
  `);
  const missingAlchemyMat = await db.execute(sql`
    select count(*)::int as n from alchemy_recipes r
    where r.main_item_id is not null
      and not exists (select 1 from items i where i.id = r.main_item_id)
  `);
  const missingCount = Number((missingMat as unknown as Array<{ n: number }>)[0]?.n ?? 0)
    + Number((missingAlchemyMat as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  step("配方主材料都真实存在", missingCount === 0, `${missingCount} 条配方引用了不存在的材料`);

  const recipeMat = await db.execute(sql`
    select count(*)::int as n from smithing_recipes
    where main_item_id like '%_material_%' and (
      main_item_id like 'item_four_realms_huashen%' or main_item_id like 'item_four_realms_lianxu%'
      or main_item_id like 'item_four_realms_heti%' or main_item_id like 'item_four_realms_dacheng%'
      or main_item_id like 'item_four_realms_dujie%')
  `);
  const usedCount = Number((recipeMat as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  step("新材料被配方用到（不是死材料）", usedCount >= 25, `${usedCount} 条配方消耗新材料`);

  // 光有数据没用，页面 service 得真能吐出来
  const highPlayer = await db.select({ id: players.id }).from(players)
    .where(sql`${players.realm} >= 25`).limit(1).get();
  if (highPlayer) {
    const smithView = await getPlayerSmithingView(highPlayer.id);
    const highRecipes = smithView.recipes.filter((r) => (r.requiredRealm ?? 0) >= 25);
    const named = highRecipes.filter((r) => r.requiredRealmName).length;
    step("炼器页能列出 25+ 配方且带境界名", highRecipes.length >= 25 && named === highRecipes.length,
      `${highRecipes.length} 条，${named} 条有境界名`);

    const alchemyView = await getPlayerAlchemyView(highPlayer.id);
    const highPills = alchemyView.recipes.filter((r) => (r.requiredRealm ?? 0) >= 25);
    step("炼丹页能列出 25+ 配方", highPills.length >= 10, `${highPills.length} 条`);
  }

  console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项未通过`);
  await Promise.resolve(process.exit(failed === 0 ? 0 : 1));
}

await main();
