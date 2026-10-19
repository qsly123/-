/**
 * 装备词条对战力的强化，对比怪物属性到底有多离谱。
 *
 * 关心的不是"词条加了多少点"，而是换算成玩家能**越几级打怪**——
 * 境界压制是这个游戏的核心节奏，词条一旦能顶掉几级，节奏就废了。
 *
 * 用法：bun run scripts/verify-affix-vs-monster.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monsters } from "@/db/schema";
import {
  AFFIX_TIER_MULT,
  RARITY_SEED_MULT,
  computeStageMult,
  rollEquipmentAffixes,
} from "@/modules/character/services/equipment-instance-service";

/** 与 scripts/seed-equipment.ts 一致：武器攻击基数 10，筑基段倍率 2 */
const WEAPON_ATK_BASE = 10;
const SEGMENT_MULT = 2;

async function main() {
  /* ---------------- 1. 怪物属性随等级的真实增长 ---------------- */
  const rows = await db
    .select({
      level: monsters.level,
      count: sql<number>`count(*)::int`,
      hp: sql<number>`round(avg(${monsters.hp}))::int`,
      attack: sql<number>`round(avg(${monsters.attack}))::int`,
      defense: sql<number>`round(avg(${monsters.defense}))::int`,
    })
    .from(monsters)
    .groupBy(monsters.level)
    .orderBy(monsters.level)
    .all();

  console.log("=== 怪物属性（按等级平均） ===");
  for (const row of rows) {
    console.log(`等级 ${String(row.level).padStart(2)} | ${row.count} 只 | 血量 ${String(row.hp).padStart(6)} | 攻击 ${String(row.attack).padStart(5)} | 防御 ${String(row.defense).padStart(4)}`);
  }

  // 相邻等级的成长倍率（取中位数，避免单点怪物配置抖动）
  const hpRatios: number[] = [];
  const atkRatios: number[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].level !== rows[i - 1].level + 1) continue;
    if (rows[i - 1].hp > 0) hpRatios.push(rows[i].hp / rows[i - 1].hp);
    if (rows[i - 1].attack > 0) atkRatios.push(rows[i].attack / rows[i - 1].attack);
  }
  const median = (values: number[]) => {
    if (values.length === 0) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const monsterHpStep = median(hpRatios);
  const monsterAtkStep = median(atkRatios);
  console.log(`\n怪物每级成长：血量 ×${monsterHpStep.toFixed(3)}，攻击 ×${monsterAtkStep.toFixed(3)}（相邻等级倍率中位数，${hpRatios.length} 组）`);

  /* ---------------- 2. 玩家侧：装备 + 词条 ---------------- */
  const realm = 14; // 筑基中期
  console.log(`\n=== 境界 ${realm}（筑基中期）玩家的武器攻击构成 ===`);

  // items.effects 里的值 = 部位基数 × 段倍率 × 旧品质倍率，再乘实例阶段系数
  const baseOf = (rarity: string) => Math.round(
    WEAPON_ATK_BASE
    * SEGMENT_MULT
    * (RARITY_SEED_MULT[rarity] ?? 1)
    * computeStageMult({ itemMinRealm: 13, itemMaxRealm: 16, playerRealm: realm, rarity }),
  );

  const samples: Record<string, { attackAvg: number; hitRate: number }> = {};
  for (const rarity of ["common", "epic", "legendary", "hongmeng"]) {
    let sum = 0;
    let hits = 0;
    for (let i = 0; i < 300; i += 1) {
      const affixes = await rollEquipmentAffixes({ rarity, playerRealm: realm, pathKey: "sword" });
      const attack = affixes.find((entry) => entry.key === "attack");
      if (attack && typeof attack.flat === "number") {
        sum += attack.flat;
        hits += 1;
      }
    }
    samples[rarity] = { attackAvg: hits > 0 ? sum / hits : 0, hitRate: hits / 300 };
  }

  for (const rarity of ["common", "epic", "legendary", "hongmeng"]) {
    const base = baseOf(rarity);
    const sample = samples[rarity];
    // 5 个部位都可能掷出攻击词条（每件最多 1 条），期望值 = 5 × 命中率 × 单条数值
    const expectAffix = 5 * sample.hitRate * sample.attackAvg;
    const total = base + expectAffix;
    console.log(
      `${rarity.padEnd(10)} 武器基础 ${String(base).padStart(5)}`
      + ` | 单条攻击词条 ${String(Math.round(sample.attackAvg)).padStart(4)}（命中率 ${(sample.hitRate * 100).toFixed(0)}%）`
      + ` | 全身期望 ${String(Math.round(total)).padStart(5)}`,
    );
  }

  /* ---------------- 3. 换算：词条 = 越几级 ---------------- */
  const commonBase = baseOf("common");
  const hongmengTotal = baseOf("hongmeng") + 5 * samples.hongmeng.hitRate * samples.hongmeng.attackAvg;
  const ratio = hongmengTotal / commonBase;
  const realmEquivalent = Math.log(ratio) / Math.log(monsterHpStep);

  console.log(`\n=== 换算 ===`);
  console.log(`凡品无词条 → 鸿蒙满词条：攻击 ${Math.round(commonBase)} → ${Math.round(hongmengTotal)}（×${ratio.toFixed(2)}）`);
  console.log(`按怪物血量每级 ×${monsterHpStep.toFixed(3)} 折算 ≈ 越 ${realmEquivalent.toFixed(1)} 个境界`);

  const singleAffixRatio = (baseOf("hongmeng") + samples.hongmeng.attackAvg) / baseOf("hongmeng");
  console.log(`单看一条鸿蒙攻击词条：相当于越 ${(Math.log(singleAffixRatio) / Math.log(monsterHpStep)).toFixed(1)} 个境界`);

  console.log(`\n（参考）同品级数值倍率：极品 ×${AFFIX_TIER_MULT.epic} / 仙品 ×${AFFIX_TIER_MULT.legendary} / 鸿蒙 ×${AFFIX_TIER_MULT.hongmeng}`);
  console.log(`（参考）玩家装备每升 1 境界成长：×1.4（阶段步长设计值）`);
}

await main();
