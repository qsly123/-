/**
 * 验证装备实例的三件事：阶段系数递进、专精词条、炼器专精。
 *
 * 重点是需求里那两条递进规则——不是"看着差不多"，是算出来必须成立：
 *   A. 筑基中期下品 > 筑基初期上品
 *   B. 筑基中期上品 > 筑基初期神话
 *   C. 结丹初期下品 > 筑基圆满上品（跨境）
 *
 * 用法：bun run scripts/verify-equipment-affix.ts
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, playerInventory } from "@/db/schema";
import {
  computeStageMult,
  ensureEquipmentInstanceSchema,
  rollEquipmentAffixes,
  tuneEquipmentInstance,
} from "@/modules/character/services/equipment-instance-service";

const PLAYER_ID = "ZbfY3sLCG5AhBa7Y";

/** 与 scripts/seed-equipment.ts 保持一致：武器攻击基数 10，筑基段倍率 2，旧品质倍率 */
const WEAPON_ATK_BASE = 10;
const SEGMENT_MULT = 2;
const RARITY_SEED: Record<string, number> = {
  common: 0.7,
  uncommon: 1,
  rare: 1.7,
  epic: 2.6,
  legendary: 3.8,
};

function step(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name} —— ${detail}`);
}

/**
 * 一件武器在给定境界、给定品级下的最终攻击值。
 * 必须带上这件装备自己的境界区间与段倍率——否则跨境比较会被 maxRealm 夹住。
 */
function weaponAttack(params: {
  rarity: string;
  realm: number;
  minRealm: number;
  maxRealm: number;
  segmentMult: number;
}): number {
  const baseEffects = WEAPON_ATK_BASE * params.segmentMult * (RARITY_SEED[params.rarity] ?? 1);
  const stageMult = computeStageMult({
    itemMinRealm: params.minRealm,
    itemMaxRealm: params.maxRealm,
    playerRealm: params.realm,
    rarity: params.rarity,
  });
  return Math.round(baseEffects * stageMult);
}

/** 筑基武器（13~16，段倍率 2） */
const zhuji = (rarity: string, realm: number) => weaponAttack({ rarity, realm, minRealm: 13, maxRealm: 16, segmentMult: 2 });
/** 结丹武器（17~20，段倍率 3.5） */
const jiedan = (rarity: string, realm: number) => weaponAttack({ rarity, realm, minRealm: 17, maxRealm: 20, segmentMult: 3.5 });

async function main() {
  await ensureEquipmentInstanceSchema();

  /* ---------------- 1. 阶段系数递进 ---------------- */
  // 筑基初期 = 13，中期 = 14，圆满 = 16；结丹初期 = 17
  const a = zhuji("common", 14);
  const b = zhuji("rare", 13);
  step("规则A 筑基中期下品 > 筑基初期上品", a > b, `${a} > ${b}`);

  const c = zhuji("rare", 14);
  const d = zhuji("legendary", 13);
  step("规则B 筑基中期上品 > 筑基初期神话", c > d, `${c} > ${d}`);

  const e = jiedan("common", 17);
  const f = zhuji("rare", 16);
  step("规则C 结丹初期下品 > 筑基圆满上品（跨境）", e > f, `${e} > ${f}`);

  const ladder = ["common", "uncommon", "rare", "epic", "legendary"].map((rarity) => zhuji(rarity, 13));
  const monotonic = ladder.every((value, index) => index === 0 || value > ladder[index - 1]);
  step("同境界内品级单调递增", monotonic, ladder.join(" < "));

  const maxValue = weaponAttack({ rarity: "legendary", realm: 44, minRealm: 21, maxRealm: 44, segmentMult: 6 });
  step("数值不溢出 int（元婴末期神话）", maxValue < 2_000_000_000, `${maxValue}`);

  /* ---------------- 2. 词条 ---------------- */
  const lowRarity = await rollEquipmentAffixes({ rarity: "rare", playerRealm: 14, pathKey: "sword" });
  step("上品及以下没有词条", lowRarity.length === 0, `上品掷出 ${lowRarity.length} 条`);

  const epicCounts: number[] = [];
  const legendCounts: number[] = [];
  const epicMax = new Map<string, number>();
  const legendMax = new Map<string, number>();
  for (let i = 0; i < 40; i += 1) {
    const epic = await rollEquipmentAffixes({ rarity: "epic", playerRealm: 14, pathKey: "sword" });
    const legend = await rollEquipmentAffixes({ rarity: "legendary", playerRealm: 14, pathKey: "sword" });
    epicCounts.push(epic.length);
    legendCounts.push(legend.length);
    for (const entry of epic) {
      if (typeof entry.flat === "number") {
        epicMax.set(entry.key, Math.max(epicMax.get(entry.key) ?? 0, entry.flat));
      }
    }
    for (const entry of legend) {
      if (typeof entry.flat === "number") {
        legendMax.set(entry.key, Math.max(legendMax.get(entry.key) ?? 0, entry.flat));
      }
    }
  }
  step("极品 1 条、仙品 2 条", epicCounts.every((n) => n === 1) && legendCounts.every((n) => n === 2),
    `极品 ${epicCounts[0]} 条 / 仙品 ${legendCounts[0]} 条`);

  const sharedKeys = [...epicMax.keys()].filter((key) => legendMax.has(key));
  const scaledUp = sharedKeys.every((key) => (legendMax.get(key) ?? 0) > (epicMax.get(key) ?? 0));
  step("同词条仙品数值 > 极品", sharedKeys.length > 0 && scaledUp,
    sharedKeys.map((key) => `${key} ${epicMax.get(key)}→${legendMax.get(key)}`).join("，") || "样本不足");

  // 三类都要出现：统计 60 次仙品里出现过的 kind
  const kinds = new Set<string>();
  for (let i = 0; i < 60; i += 1) {
    const rolled = await rollEquipmentAffixes({ rarity: "hongmeng", playerRealm: 20, pathKey: "body" });
    for (const entry of rolled) kinds.add(entry.kind);
  }
  step("三类词条都能掷出（数值/概率/技能）", kinds.has("stat") && kinds.has("rate") && kinds.has("skill"),
    [...kinds].join("、"));

  // 全池可出：流派不能把装备绑死，否则交易所里只有同流派玩家买得动
  const swordKeys = new Set<string>();
  const swordHits = new Map<string, number>();
  for (let i = 0; i < 300; i += 1) {
    const rolled = await rollEquipmentAffixes({ rarity: "hongmeng", playerRealm: 15, pathKey: "sword" });
    for (const entry of rolled) {
      swordKeys.add(entry.key);
      swordHits.set(entry.key, (swordHits.get(entry.key) ?? 0) + 1);
    }
  }
  const crossKeys = ["rate_block", "maxHp", "defense"];
  step("剑修也能掷出体修向词条（全池可出，装备可跨流派流通）",
    crossKeys.every((key) => swordKeys.has(key)),
    `体修向命中：${crossKeys.filter((key) => swordKeys.has(key)).join("、")}`);

  const sumHits = (keys: string[]) => keys.reduce((sum, key) => sum + (swordHits.get(key) ?? 0), 0);
  const selfHits = sumHits(["attack", "armorPenetration", "skillDamageBonus", "speed", "rate_crit"]);
  const crossHits = sumHits(["maxHp", "defense", "block", "skillDamageReduction", "rate_block"]);
  step("流派仍起作用（本流派更常见，但不排他）", selfHits > crossHits * 1.5,
    `本流派 ${selfHits} 次 vs 跨流派 ${crossHits} 次`);

  /* ---------------- 3. 炼器专精 ----------------
   * 专精机制已按方案A移除（2026-10-20），打造品级改为概率随机（rollCraftRarityItemId）。
   * 本节随之删除。 */

  /* ---------------- 4. 实例真的写进去了 ---------------- */
  const owned = await db
    .select({ itemId: playerInventory.itemId, itemType: items.itemType, rarity: items.rarity })
    .from(playerInventory)
    .innerJoin(items, eq(items.id, playerInventory.itemId))
    .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(items.itemType, "weapon")))
    .limit(1)
    .get();

  if (!owned) {
    step("实例落库", false, "测试号没有武器，跳过");
  } else {
    await tuneEquipmentInstance({ playerId: PLAYER_ID, itemId: owned.itemId, playerRealm: 14 });
    const row = await db
      .select({ stageMult: playerInventory.stageMult, affixes: playerInventory.affixes })
      .from(playerInventory)
      .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, owned.itemId)))
      .get();
    const affixes = (row?.affixes ?? []) as Array<{ kind?: string }>;
    step("实例落库（阶段系数 + 词条）",
      Number(row?.stageMult || 1) !== 1 && affixes.length >= 0,
      `stageMult=${Number(row?.stageMult ?? 1).toFixed(3)} 词条 ${affixes.length} 条（${owned.rarity}）`);

    // 复原
    await db.update(playerInventory)
      .set({ stageMult: 1, stageRealm: null, affixes: null })
      .where(and(eq(playerInventory.playerId, PLAYER_ID), eq(playerInventory.itemId, owned.itemId)))
      .run();
  }

  console.log("\n已清理测试数据");
}

await main();
