/**
 * 验证「境界名 / 打怪跨境修为 / 修为丹跨段亏损」三件事，用真实配置与真实丹药数据。
 *
 * 用法：bun run scripts/verify-realm-gate-and-xp.ts
 */
import { db } from "@/db";
import { items, players, monsters, maps } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getPlayerSmithingView } from "@/modules/character/services/smithing-service";
import { getRealmLabel, getRealmTable } from "@/modules/character/services/realm-position";
import { applyCombatXpGap, resolveCombatXpGap } from "@/modules/combat/services/combat-reward-scaling";
import { applyPillCrossRealm } from "@/modules/character/services/pill-cross-realm";

let failed = 0;
function step(title: string, pass: boolean, detail: string) {
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${title} —— ${detail}`);
  if (!pass) {
    failed += 1;
  }
}

async function main() {
  /* ---------- 境界名 ---------- */
  const table = await getRealmTable();
  step("境界表可用", table.length >= 44, `${table.length} 个境界（${table[0]?.label} ~ ${table[table.length - 1]?.label}）`);

  const majorCounts = new Map<string, number>();
  for (const pos of table) {
    majorCounts.set(pos.majorName, (majorCounts.get(pos.majorName) ?? 0) + 1);
  }
  console.log(`  段位：${[...majorCounts].map(([name, count]) => `${name}${count}`).join(" · ")}`);
  console.log(`  抽样：${[1, 12, 13, 14, 17, 21].map((r) => `${r}=${table[r - 1]?.label}`).join(" ")}`);

  step("练气 1-12 是一段、筑基 13-16 是下一段",
    table[0]?.major === 1 && table[11]?.major === 1 && table[12]?.major === 2,
    `${await getRealmLabel(1)}（段 ${table[0]?.major}） / ${await getRealmLabel(13)}（段 ${table[12]?.major}）`);

  /* ---------- 打怪跨境修为 ---------- */
  console.log("\n=== 打怪修为（玩家境界 → 怪物等级）===");
  const combatCases: Array<{ player: number; monster: number; expect: number; note: string }> = [
    { player: 13, monster: 14, expect: 1.2, note: "筑基初期 打 筑基中期" },
    { player: 14, monster: 13, expect: 0.8, note: "筑基中期 打 筑基初期" },
    { player: 13, monster: 12, expect: 0, note: "筑基初期 打 练气圆满" },
    { player: 13, monster: 9, expect: 0, note: "筑基初期 打 练气九层" },
    { player: 12, monster: 13, expect: 1.2, note: "练气圆满 打 筑基初期" },
    { player: 17, monster: 20, expect: 1.6, note: "结丹初期 打 结丹圆满" },
    { player: 21, monster: 20, expect: 0, note: "元婴初期 打 结丹圆满" },
  ];
  for (const testCase of combatCases) {
    const gap = await resolveCombatXpGap(testCase.player, testCase.monster);
    const applied = await applyCombatXpGap(1000, testCase.player, testCase.monster);
    const ok = Math.abs(gap.multiplier - testCase.expect) < 0.01;
    step(`${testCase.note} → ×${testCase.expect.toFixed(1)}`, ok,
      `实测 ×${gap.multiplier.toFixed(2)}（${gap.label}，1000 修为 → ${applied.xp}）`);
  }

  /* ---------- 修为丹跨段亏损 ---------- */
  console.log("\n=== 修为丹跨境界服用 ===");
  const pillNames = ["凝露丹", "筑元丹", "蕴丹金液", "婴元天露", "回灵散", "赤砂回元丹"];
  const pillRows = await db.select({ name: items.name, minRealm: items.minRealm, effects: items.effects })
    .from(items)
    .where(inArray(items.name, pillNames))
    .all();

  const pillMap = new Map<string, { minRealm: number | null; xp: number; heal: number }>();
  for (const row of pillRows) {
    const effects = (row.effects as Array<{ type?: string; value?: number }>) || [];
    const xp = effects.reduce((sum, eff) => (eff.type === "boost_xp" ? sum + Number(eff.value || 0) : sum), 0);
    const heal = effects.reduce((sum, eff) => (eff.type === "heal_hp" ? sum + Number(eff.value || 0) : sum), 0);
    pillMap.set(row.name, { minRealm: row.minRealm, xp, heal });
  }
  step("取到各段修为丹", pillMap.size === pillNames.length,
    pillNames.map((name) => `${name}=${pillMap.get(name)?.xp ?? "?"}`).join(" "));

  const pillCases: Array<{ player: number; pill: string; expectRate: number }> = [
    { player: 1, pill: "凝露丹", expectRate: 1 },
    { player: 1, pill: "筑元丹", expectRate: 0.8 },
    { player: 1, pill: "蕴丹金液", expectRate: 0.64 },
    { player: 1, pill: "婴元天露", expectRate: 0.512 },
    { player: 13, pill: "筑元丹", expectRate: 1 },
    { player: 13, pill: "凝露丹", expectRate: 1 },
    { player: 21, pill: "婴元天露", expectRate: 1 },
  ];
  for (const testCase of pillCases) {
    const pill = pillMap.get(testCase.pill);
    if (!pill) {
      continue;
    }
    const result = await applyPillCrossRealm({
      value: pill.xp,
      playerRealm: testCase.player,
      itemMinRealm: pill.minRealm,
    });
    const playerLabel = await getRealmLabel(testCase.player);
    const ok = Math.abs(result.rate - testCase.expectRate) < 0.001;
    step(`${playerLabel} 吃 ${testCase.pill}`, ok,
      `${pill.xp} → ${result.value}（×${result.rate.toFixed(3)}，期望 ×${testCase.expectRate}）`);
  }

  /* ---------- 回血丹：也不拦境界，回复量按同规则折算 ---------- */
  console.log("\n=== 回血丹跨境界服用（回复量） ===");
  const healCases: Array<{ player: number; pill: string; expectRate: number }> = [
    { player: 1, pill: "回灵散", expectRate: 1 },
    { player: 1, pill: "赤砂回元丹", expectRate: 0.8 },
    { player: 13, pill: "赤砂回元丹", expectRate: 1 },
  ];
  for (const testCase of healCases) {
    const pill = pillMap.get(testCase.pill);
    if (!pill) {
      continue;
    }
    const result = await applyPillCrossRealm({
      value: pill.heal,
      playerRealm: testCase.player,
      itemMinRealm: pill.minRealm,
    });
    const playerLabel = await getRealmLabel(testCase.player);
    const ok = Math.abs(result.rate - testCase.expectRate) < 0.001;
    step(`${playerLabel} 吃 ${testCase.pill}（回血）`, ok,
      `${pill.heal} → ${result.value}（×${result.rate.toFixed(3)}，期望 ×${testCase.expectRate}）`);
  }

  /* ---------- 破境丹必须继续受境界拦截 ---------- */
  console.log("\n=== 破境丹（仍拦境界） ===");
  const breakthroughNames = ["护脉清元散", "固基丹", "凝煞护脉丹"];
  const breakthroughRows = await db.select({ name: items.name, effects: items.effects })
    .from(items).where(inArray(items.name, breakthroughNames)).all();
  for (const row of breakthroughRows) {
    const effects = (row.effects as Array<{ type?: string }>) || [];
    // 不含恢复类 effect → 服用路径上 isRecoveryConsumable=false → 仍走境界区间拦截
    const wouldSkipGate = effects.some((eff) => (
      eff.type === "boost_xp" || eff.type === "heal_hp" || eff.type === "heal_mp"
    ));
    step(`${row.name} 仍受境界拦截`, !wouldSkipGate && effects.some((eff) => eff.type === "boost_breakthrough"),
      `effects=${effects.map((eff) => eff.type).join(",")}`);
  }

  /* ---------- 怪物覆盖 ---------- */
  console.log("\n=== 怪物覆盖（25 级以上是否补齐）===");
  const monsterRows = await db.select({
    level: monsters.level,
    xpReward: monsters.xpReward,
    mapId: monsters.mapId,
  }).from(monsters).all();
  const levelsWithMonsters = new Set(monsterRows.map((row) => Number(row.level)));
  const missingLevels = [];
  for (let level = 2; level <= 44; level += 1) {
    if (!levelsWithMonsters.has(level)) {
      missingLevels.push(level);
    }
  }
  const noXp = monsterRows.filter((row) => Number(row.xpReward) <= 0).length;
  const noMap = monsterRows.filter((row) => !row.mapId).length;
  step("2~44 级每级都有怪", missingLevels.length === 0,
    `共 ${monsterRows.length} 只，缺级：${missingLevels.length ? missingLevels.join(",") : "无"}`);
  step("没有 xp_reward 为 0 的怪（打怪必须给修为）", noXp === 0, `${noXp} 只为 0`);
  step("没有无归属地图的怪", noMap === 0, `${noMap} 只无地图`);

  /* ---------- 新地图传送链 ---------- */
  console.log("\n=== 高境界地图链条 ===");
  const mapRows = await db.select({ id: maps.id, name: maps.name, minRealm: maps.minRealm, tilesData: maps.tilesData })
    .from(maps).orderBy(maps.minRealm).all();
  const highMaps = mapRows.filter((row) => Number(row.minRealm) >= 25);
  step("高境界地图已建", highMaps.length >= 5,
    `${highMaps.length} 张：${highMaps.map((row) => `${row.name}(${row.minRealm})`).join(" → ")}`);

  for (const map of highMaps) {
    const tiles = (Array.isArray(map.tilesData) ? map.tilesData : []) as Array<{
      type?: string; portalId?: string; portalTargetMapId?: string; portalTargetPortalId?: string;
    }>;
    const portals = tiles.filter((tile) => tile.type === "portal");
    // 出口必须互指：目标地图里要有一个传送门指回这张图
    let reachable = 0;
    for (const portal of portals) {
      const target = mapRows.find((row) => row.id === portal.portalTargetMapId);
      if (!target) {
        continue;
      }
      const targetTiles = (Array.isArray(target.tilesData) ? target.tilesData : []) as Array<{
        type?: string; portalId?: string;
      }>;
      const back = targetTiles.some((tile) => tile.type === "portal" && tile.portalId === portal.portalTargetPortalId);
      if (back) {
        reachable += 1;
      }
    }
    step(`${map.name} 传送门双向可达`, portals.length > 0 && reachable === portals.length,
      `${reachable}/${portals.length} 个传送门有对应回程阵`);
  }

  /* ---------- 炼器页拿得到境界名 ---------- */
  const anyPlayer = await db.select({ id: players.id }).from(players).limit(1).get();
  if (anyPlayer) {
    const view = await getPlayerSmithingView(anyPlayer.id);
    const named = view.recipes.filter((row) => row.requiredRealmName).length;
    step("炼器配方带境界名（不是数字）",
      named > 0 && !/^\d+$/.test(view.playerRealmName),
      `玩家 ${view.playerRealmName}，${named}/${view.recipes.length} 条有境界名`);
    const sample = view.recipes.find((row) => row.requiredRealmName);
    if (sample) {
      console.log(`  示例：${sample.resultItemName} 需 ${sample.requiredRealmName}，`
        + `材料需 ${sample.materialRequiredRealmName ?? "-"}，当前 ${view.playerRealmName}`);
    }
  }

  console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项未通过`);
}

await main();
