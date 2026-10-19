/**
 * 验证 25~44 级的战斗平衡。
 *
 * 与旧版 verify-monster-balance.ts 的区别：旧版拿裸装玩家比 `atk - def`，
 * 忽略了装备 stage_mult、破防、暴击、技能倍率、百分比减伤——结论是错的。
 *
 * 本脚本用真实的 computeStageMult 算出「本段装备一身」的玩家，
 * 再按战斗服务的完整伤害管线算双方回合数：
 *   ((atk + 破防×0.28 + 速度×0.2 + 气运×0.1) × 技能倍率 + base) × 100/(100+有效防御) × 暴击期望
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monsters, items } from "@/db/schema";
import { computeStageMult } from "@/modules/character/services/equipment-instance-service";

const CRIT_MULT = 1.5;
const PLAYER_SKILL_MUL = 1.4;
const RARITY_SEED = { rare: 1.7, epic: 2.6, legendary: 3.8 } as const;
const RARITY_LABEL = { rare: "上品", epic: "极品", legendary: "仙品" } as const;

const BANDS = [
  { key: "huashen", label: "化神", levels: [25, 28] },
  { key: "lianxu", label: "炼虚", levels: [29, 32] },
  { key: "heti", label: "合体", levels: [33, 36] },
  { key: "dacheng", label: "大乘", levels: [37, 40] },
  { key: "dujie", label: "渡劫", levels: [41, 44] },
] as const;

/** 怪目前 skills 是空的（只会普攻），所以技能倍率按 1.0 算 */
const MONSTER_SKILL_MUL = 1.0;

function effectiveDefense(def: number, penEff: number): number {
  const p = Math.max(0, penEff);
  return Math.max(0, def * (1 - Math.min(0.8, p / (p + 500))));
}

function expectedDamage(
  a: { atk: number; pen: number; speed: number; luck: number },
  targetDef: number,
  penEff: number,
  skillMul: number,
): number {
  const atkTerm = a.atk + a.pen * 0.28 + a.speed * 0.2 + a.luck * 0.1;
  const critRate = Math.min(0.95, 0.05 + a.luck / (a.luck + 900));
  const critAvg = 1 + critRate * (CRIT_MULT - 1);
  return atkTerm * skillMul * (100 / (100 + effectiveDefense(targetDef, penEff))) * critAvg;
}

type Eff = { type: string; value: number };

/** 从 DB 读本段装备，用真实 computeStageMult 算出「一身某品级」的玩家属性 */
async function gearedPlayer(level: number, bandKey: string, rarity: keyof typeof RARITY_SEED) {
  const band = BANDS.find((b) => b.key === bandKey)!;
  const rows = await db.select({
    itemType: items.itemType, rarity: items.rarity,
    minRealm: items.minRealm, maxRealm: items.maxRealm, effects: items.effects,
  }).from(items)
    .where(sql`${items.id} like ${`item_four_realms_${bandKey}_%`} and ${items.itemType} in ('weapon','armor','helmet','shoes','artifact')`)
    .all();

  const m = (RARITY_SEED[rarity] / RARITY_SEED.epic) * computeStageMult({
    itemMinRealm: band.levels[0],
    itemMaxRealm: band.levels[1],
    playerRealm: level,
    rarity,
  });

  const k = Math.pow(1.117, level - 25);
  const acc = { atk: 458 * k, def: 231 * k, hp: 4513 * k, speed: 24 * k, luck: 30 * k, pen: 0 };
  for (const row of rows) {
    for (const e of (row.effects || []) as Eff[]) {
      const v = e.value * m;
      if (e.type === "boost_atk") acc.atk += v;
      else if (e.type === "boost_def") acc.def += v;
      else if (e.type === "boost_hp") acc.hp += v;
      else if (e.type === "boost_speed") acc.speed += v;
      else if (e.type === "boost_luck") acc.luck += v;
      else if (e.type === "boost_armor_penetration") acc.pen += v;
    }
  }
  return acc;
}

async function main() {
  let failed = 0;
  console.log("=== 25~44 级战斗平衡（完整伤害管线）===");
  console.log("品级：普通怪→上品一套，精英→极品，boss→仙品\n");

  for (const band of BANDS) {
    for (const level of [band.levels[0], band.levels[1]]) {
      const types = ["normal", "elite", "boss"] as const;
      const anchor = { normal: "rare", elite: "epic", boss: "legendary" } as const;

      for (const type of types) {
        const mon = await db.select().from(monsters)
          .where(sql`${monsters.level} = ${level} and ${monsters.monsterType} = ${type}`)
          .all();
        if (mon.length === 0) continue;
        const m = mon[0];
        const p = await gearedPlayer(level, band.key, anchor[type]);

        const toKill = Number(m.hp) / expectedDamage(p, Number(m.defense), p.pen - Number(m.block ?? 0) * 0.45, PLAYER_SKILL_MUL);
        const toDie = p.hp / expectedDamage(
          { atk: Number(m.attack), pen: Number(m.armorPenetration ?? 0), speed: Number(m.speed ?? 0), luck: Number(m.luck ?? 0) },
          p.def, Number(m.armorPenetration ?? 0), MONSTER_SKILL_MUL,
        );

        const win = toKill < toDie;
        const ok = win;
        if (!ok) failed += 1;
        console.log(
          `[${ok ? "PASS" : "FAIL"}] ${band.label}${level} ${type.padEnd(6)} ${RARITY_LABEL[anchor[type]]}一套 ` +
          `| 打死怪 ${toKill.toFixed(1)} 回合 / 自己撑 ${toDie.toFixed(1)} 回合 → ${win ? "打得过" : "打不过"}`,
        );
      }
    }
  }

  console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项未通过`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
