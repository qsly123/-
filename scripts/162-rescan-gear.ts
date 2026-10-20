/**
 * 装备数值重扫：机制常数 + 数据库种子值 + 反推出的满装战力 + 现有怪数值。
 * 用来判断「装备改过之后，怪的数值要不要跟着重算」。
 */
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { items, monsters } from "@/db/schema";
import { computeStageMult, STAGE_STEP } from "@/modules/character/services/equipment-instance-service";

const RARITY_SEED = { rare: 1.7, epic: 2.6, legendary: 3.8 } as const;
const RARITY_CN = { rare: "上品", epic: "极品", legendary: "仙品" } as const;

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(1);
}

async function main() {
  // ---- 1. 机制常数（直接读源码文件，SEGMENT_SEED_MULT 未导出） ----
  const svcPath = path.resolve(process.cwd(), "src/modules/character/services/equipment-instance-service.ts");
  const src = fs.existsSync(svcPath) ? fs.readFileSync(svcPath, "utf8") : "";
  const segBlock = src.match(/const SEGMENT_SEED_MULT = \[([\s\S]{0,500}?)\] as const;/);
  console.log("=== 1. 机制常数 ===");
  console.log(`  STAGE_STEP = ${STAGE_STEP}`);
  if (segBlock) {
    console.log("  SEGMENT_SEED_MULT:");
    const rows = segBlock[1].match(/\{ min: \d+, max: \d+, mult: [\d.]+ \}/g) ?? [];
    for (const r of rows) console.log(`    ${r}`);
  }

  // ---- 2. 装备种子值 ----
  console.log("\n=== 2. 武器种子值（各段取一件） ===");
  const bands = [
    { label: "元婴", min: 21 }, { label: "化神", min: 25 }, { label: "炼虚", min: 29 },
    { label: "合体", min: 33 }, { label: "大乘", min: 37 }, { label: "渡劫", min: 41 },
  ];
  for (const band of bands) {
    const rows = await db.select({
      name: items.name, rarity: items.rarity, minRealm: items.minRealm, maxRealm: items.maxRealm, effects: items.effects,
    }).from(items)
      .where(sql`${items.itemType} = 'weapon' and ${items.minRealm} = ${band.min}`).all();
    const r = rows[0];
    if (!r) { console.log(`  ${band.label}(${band.min}) 无武器`); continue; }
    const fx = (r.effects || []) as Array<{ type: string; value: number }>;
    const atk = fx.find((e) => e.type === "boost_atk")?.value ?? 0;
    const pen = fx.find((e) => e.type === "boost_armor_penetration")?.value ?? 0;
    const hp = fx.find((e) => e.type === "boost_hp")?.value ?? 0;
    console.log(`  ${band.label}(${band.min}) ${r.name} ${r.rarity} maxRealm=${r.maxRealm ?? "null"} atk=${atk} pen=${pen} hp=${hp}`);
  }

  // ---- 3. stage_mult ----
  console.log("\n=== 3. stage_mult（装备 maxRealm 生效） ===");
  for (const band of bands) {
    const rows = await db.select({ name: items.name, maxRealm: items.maxRealm }).from(items)
      .where(sql`${items.itemType} = 'weapon' and ${items.minRealm} = ${band.min}`).all();
    const maxR = rows[0]?.maxRealm ?? null;
    const cells = (["rare", "epic", "legendary"] as const).map((rarity) => {
      const m = computeStageMult({ itemMinRealm: band.min, itemMaxRealm: maxR, playerRealm: band.min, rarity });
      return `${RARITY_CN[rarity]}=${fmt(m)}`;
    });
    console.log(`  ${band.label} 本段起始级(${band.min}) maxRealm=${maxR ?? "null"} ${cells.join("  ")}`);
  }

  // ---- 4. 满装一套的战力 ----
  async function geared(level: number, rarity: keyof typeof RARITY_SEED) {
    const band = [...bands].reverse().find((b) => level >= b.min) ?? bands[bands.length - 1];
    const rows = await db.select({ effects: items.effects, maxRealm: items.maxRealm }).from(items)
      .where(sql`${items.minRealm} = ${band.min} and ${items.itemType} in ('weapon','armor','helmet','shoes','artifact')`).all();
    const maxR = rows[0]?.maxRealm ?? null;
    const m = (RARITY_SEED[rarity] / RARITY_SEED.epic)
      * computeStageMult({ itemMinRealm: band.min, itemMaxRealm: maxR, playerRealm: level, rarity });
    const k = Math.pow(1.117, level - 25);
    const p = { atk: 458 * k, def: 231 * k, hp: 4513 * k, pen: 0 };
    for (const row of rows) {
      for (const e of (row.effects || []) as Array<{ type: string; value: number }>) {
        const v = e.value * m;
        if (e.type === "boost_atk") p.atk += v;
        else if (e.type === "boost_def") p.def += v;
        else if (e.type === "boost_hp") p.hp += v;
        else if (e.type === "boost_armor_penetration") p.pen += v;
      }
    }
    return p;
  }

  console.log("\n=== 4. 满装 vs 裸装（atk / hp / def） ===");
  for (const lv of [25, 30, 35, 40, 44]) {
    const k = Math.pow(1.117, lv - 25);
    const naked = { atk: 458 * k, hp: 4513 * k, def: 231 * k };
    const cells: string[] = [];
    for (const rarity of ["rare", "epic", "legendary"] as const) {
      const g = await geared(lv, rarity);
      cells.push(`${RARITY_CN[rarity]} atk=${fmt(g.atk)}(${(g.atk / naked.atk).toFixed(1)}×) hp=${fmt(g.hp)} def=${fmt(g.def)} pen=${fmt(g.pen)}`);
    }
    console.log(`  ${lv}级 裸装 atk=${fmt(naked.atk)} hp=${fmt(naked.hp)} def=${fmt(naked.def)}`);
    for (const c of cells) console.log(`      ${c}`);
  }

  // ---- 5. 现有怪数值 ----
  console.log("\n=== 5. 现有怪数值 ===");
  for (const lv of [25, 30, 35, 40, 44]) {
    const parts: string[] = [];
    for (const t of ["normal", "elite", "boss"]) {
      const rows = await db.select().from(monsters).where(sql`${monsters.level} = ${lv} and ${monsters.monsterType} = ${t}`).all();
      const m = rows[0];
      if (m) parts.push(`${t}: hp=${fmt(Number(m.hp))} atk=${fmt(Number(m.attack))} def=${fmt(Number(m.defense))} pen=${fmt(Number(m.armorPenetration))}`);
    }
    console.log(`  ${lv}级 ${parts.join(" | ")}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
