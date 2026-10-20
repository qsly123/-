/**
 * 补扫：元婴段(21)全套装备 + 各段全套 → 与现有怪重算战斗回合数。
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { items, monsters } from "@/db/schema";
import { computeStageMult } from "@/modules/character/services/equipment-instance-service";

const RARITY_SEED = { rare: 1.7, epic: 2.6, legendary: 3.8 } as const;
const CRIT_MULT = 1.5;
const PLAYER_SKILL_MUL = 1.4;
const MONSTER_SKILL_MUL = 1.3;

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return String(Math.round(n));
}
function effDef(def: number, pen: number): number {
  const p = Math.max(0, pen);
  return Math.max(0, def * (1 - Math.min(0.8, p / (p + 500))));
}
function dmg(a: { atk: number; pen: number; speed: number; luck: number }, targetDef: number, penEff: number, skillMul: number): number {
  const atkTerm = a.atk + a.pen * 0.28 + a.speed * 0.2 + a.luck * 0.1;
  const critRate = Math.min(0.95, 0.05 + a.luck / (a.luck + 900));
  const critAvg = 1 + critRate * (CRIT_MULT - 1);
  return atkTerm * skillMul * (100 / (100 + effDef(targetDef, penEff))) * critAvg;
}

async function gearRows(minRealm: number) {
  return db.select({
    name: items.name, rarity: items.rarity, itemType: items.itemType,
    minRealm: items.minRealm, maxRealm: items.maxRealm, effects: items.effects,
  }).from(items)
    .where(sql`${items.minRealm} = ${minRealm} and ${items.itemType} in ('weapon','armor','helmet','shoes','artifact')`)
    .orderBy(items.itemType).all();
}

async function setStats(rows: Awaited<ReturnType<typeof gearRows>>, level: number, rarity: keyof typeof RARITY_SEED) {
  const maxR = rows[0]?.maxRealm ?? null;
  const m = (RARITY_SEED[rarity] / RARITY_SEED.epic)
    * computeStageMult({ itemMinRealm: rows[0].minRealm, itemMaxRealm: maxR, playerRealm: level, rarity });
  const k = Math.pow(1.117, level - 25);
  const p = { atk: 458 * k, def: 231 * k, hp: 4513 * k, speed: 24 * k, luck: 30 * k, pen: 0 };
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

async function main() {
  console.log("=== 元婴段(21)全套 ===");
  const yy = await gearRows(21);
  for (const r of yy) {
    const fx = (r.effects || []) as Array<{ type: string; value: number }>;
    const sum = fx.map((e) => `${e.type.replace("boost_", "")}=${e.value}`).join(",");
    console.log(`  ${r.itemType.padEnd(8)} ${r.name} ${r.rarity} max=${r.maxRealm ?? "null"} [${sum}]`);
  }

  console.log("\n=== 元婴装穿到 25 级 vs 化神装 ===");
  const hs = await gearRows(25);
  for (const rarity of ["rare", "epic", "legendary"] as const) {
    const a = await setStats(yy, 25, rarity);
    const b = await setStats(hs, 25, rarity);
    console.log(`  ${rarity.padEnd(9)} 元婴装 atk=${fmt(a.atk)} hp=${fmt(a.hp)} def=${fmt(a.def)} | 化神装 atk=${fmt(b.atk)} hp=${fmt(b.hp)} def=${fmt(b.def)}`);
  }

  console.log("\n=== 现有怪 vs 满装玩家（回合数，目标 普通4/精英10/boss15） ===");
  const anchor = { normal: "rare", elite: "epic", boss: "legendary" } as const;
  for (const lv of [25, 28, 32, 36, 40, 44]) {
    const bandMin = [25, 29, 33, 37, 41].filter((m) => m <= lv).pop() ?? 21;
    const rows = await gearRows(bandMin);
    for (const t of ["normal", "elite", "boss"] as const) {
      const mRows = await db.select().from(monsters).where(sql`${monsters.level} = ${lv} and ${monsters.monsterType} = ${t}`).all();
      const m = mRows[0];
      if (!m) continue;
      const p = await setStats(rows, lv, anchor[t]);
      const toKill = Number(m.hp) / dmg(p, Number(m.defense), p.pen - Number(m.block) * 0.45, PLAYER_SKILL_MUL);
      const toDie = p.hp / dmg(
        { atk: Number(m.attack), pen: Number(m.armorPenetration), speed: Number(m.speed), luck: Number(m.luck) },
        p.def, Number(m.armorPenetration), MONSTER_SKILL_MUL);
      console.log(`  ${lv}级 ${t.padEnd(6)} 打死怪 ${fmt(toKill)} 回合 / 自己撑 ${toDie > 99999 ? "∞(怪无威胁)" : fmt(toDie)} 回合   [怪hp=${fmt(Number(m.hp))} atk=${fmt(Number(m.attack))}]`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
