/**
 * 数值体检：确认 25 级起的怪物数值有没有离谱。
 * 重点看两件事：
 *   1) 24 级（元婴，既有内容）→ 25 级（化神，新内容）有没有断崖
 *   2) 裸装玩家 / 上品一套 / 仙品一套 打同一只怪各要多少回合
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monsters, items } from "@/db/schema";
import { computeStageMult } from "@/modules/character/services/equipment-instance-service";

const CRIT_MULT = 1.5;
const PLAYER_SKILL_MUL = 1.4;
const RARITY_SEED = { rare: 1.7, epic: 2.6, legendary: 3.8 } as const;

const BANDS = [
  { key: "huashen", levels: [25, 28] },
  { key: "lianxu", levels: [29, 32] },
  { key: "heti", levels: [33, 36] },
  { key: "dacheng", levels: [37, 40] },
  { key: "dujie", levels: [41, 44] },
] as const;

function effectiveDefense(def: number, penEff: number): number {
  const p = Math.max(0, penEff);
  return Math.max(0, def * (1 - Math.min(0.8, p / (p + 500))));
}

function expectedDamage(
  a: { atk: number; pen: number; speed: number; luck: number },
  targetDef: number, penEff: number, skillMul: number,
): number {
  const atkTerm = a.atk + a.pen * 0.28 + a.speed * 0.2 + a.luck * 0.1;
  const critRate = Math.min(0.95, 0.05 + a.luck / (a.luck + 900));
  const critAvg = 1 + critRate * (CRIT_MULT - 1);
  return atkTerm * skillMul * (100 / (100 + effectiveDefense(targetDef, penEff))) * critAvg;
}

/** 裸装玩家：没有任何装备加成 */
function nakedPlayer(level: number) {
  const k = Math.pow(1.117, level - 25);
  return { atk: 458 * k, def: 231 * k, hp: 4513 * k, speed: 24 * k, luck: 30 * k, pen: 0 };
}

async function gearedPlayer(level: number, bandKey: string, rarity: keyof typeof RARITY_SEED) {
  const band = BANDS.find((b) => b.key === bandKey)!;
  const rows = await db.select({
    rarity: items.rarity, minRealm: items.minRealm, maxRealm: items.maxRealm, effects: items.effects,
  }).from(items)
    .where(sql`${items.id} like ${`item_four_realms_${bandKey}_%`} and ${items.itemType} in ('weapon','armor','helmet','shoes','artifact')`)
    .all();
  const m = (RARITY_SEED[rarity] / RARITY_SEED.epic) * computeStageMult({
    itemMinRealm: band.levels[0], itemMaxRealm: band.levels[1], playerRealm: level, rarity,
  });
  const p = nakedPlayer(level);
  for (const row of rows) {
    for (const e of (row.effects || []) as Array<{ type: string; value: number }>) {
      const v = e.value * m;
      if (e.type === "boost_atk") p.atk += v;
      else if (e.type === "boost_def") p.def += v;
      else if (e.type === "boost_hp") p.hp += v;
      else if (e.type === "boost_speed") p.speed += v;
      else if (e.type === "boost_luck") p.luck += v;
      else if (e.type === "boost_armor_penetration") p.pen += v;
    }
  }
  return p;
}

async function monster(level: number, type: string) {
  const rows = await db.select().from(monsters)
    .where(sql`${monsters.level} = ${level} and ${monsters.monsterType} = ${type}`).all();
  return rows[0];
}

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(Math.round(n));
}

async function main() {
  console.log("=== 1. 断崖检查：相邻境界普通怪血量 ===");
  let prev = 0;
  for (let lv = 21; lv <= 30; lv += 1) {
    const m = await monster(lv, "normal");
    if (!m) continue;
    const hp = Number(m.hp);
    const jump = prev ? `  ↑${(hp / prev).toFixed(2)}×` : "";
    console.log(`  ${lv}级 normal  hp=${fmt(hp).padStart(8)}  atk=${fmt(Number(m.attack)).padStart(8)}  def=${fmt(Number(m.defense)).padStart(6)}${jump}`);
    prev = hp;
  }

  console.log("\n=== 2. 同一个 25 级普通怪，三种玩家各要多少回合 ===");
  const m25 = await monster(25, "normal");
  const m24 = await monster(24, "boss");
  for (const [label, p] of [
    ["裸装  ", nakedPlayer(25)],
    ["上品  ", await gearedPlayer(25, "huashen", "rare")],
    ["仙品  ", await gearedPlayer(25, "huashen", "legendary")],
  ] as const) {
    const toKill = Number(m25.hp) / expectedDamage(p, Number(m25.defense), p.pen - Number(m25.block ?? 0) * 0.45, PLAYER_SKILL_MUL);
    const toDie = p.hp / expectedDamage(
      { atk: Number(m25.attack), pen: Number(m25.armorPenetration ?? 0), speed: Number(m25.speed ?? 0), luck: Number(m25.luck ?? 0) },
      p.def, Number(m25.armorPenetration ?? 0), 1.0);
    console.log(`  ${label} atk=${fmt(p.atk).padStart(8)} hp=${fmt(p.hp).padStart(8)} def=${fmt(p.def).padStart(8)} → 打死怪 ${toKill.toFixed(1)} 回合 / 自己撑 ${toDie.toFixed(1)} 回合`);
  }

  console.log("\n=== 3. 对照：24 级元婴 boss（既有内容）三种玩家 ===");
  if (m24) {
    console.log(`  24级boss hp=${fmt(Number(m24.hp))} atk=${fmt(Number(m24.attack))} def=${fmt(Number(m24.defense))}`);
    for (const [label, p] of [
      ["裸装  ", nakedPlayer(24)],
      ["上品  ", await gearedPlayer(25, "huashen", "rare")],
    ] as const) {
      const toKill = Number(m24.hp) / expectedDamage(p, Number(m24.defense), p.pen - Number(m24.block ?? 0) * 0.45, PLAYER_SKILL_MUL);
      console.log(`  ${label} → 打死 ${toKill.toFixed(1)} 回合`);
    }
  }

  console.log("\n=== 4. 全段血量一览（普通怪） ===");
  for (const band of BANDS) {
    for (const lv of [band.levels[0], band.levels[1]]) {
      const n = await monster(lv, "normal");
      const b = await monster(lv, "boss");
      if (n && b) {
        console.log(`  ${lv}级  normal hp=${fmt(Number(n.hp)).padStart(8)} atk=${fmt(Number(n.attack)).padStart(9)} | boss hp=${fmt(Number(b.hp)).padStart(8)} atk=${fmt(Number(b.attack)).padStart(9)}`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
