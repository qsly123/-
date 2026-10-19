/**
 * 品级对比：鸿蒙 vs 仙品（以及极品）到底强多少。
 *
 * 问这个问题时真正想知道的不是"倍率是多少"，而是
 * "我拿到一件鸿蒙，相当于几件仙品"。所以这里把基础值和词条分开算，
 * 再合成一件装备的总贡献。
 *
 * 用法：bun run scripts/compare-rarity-tiers.ts
 */
import {
  AFFIX_TIER_MULT,
  RARITY_EFFECTIVE_MULT,
  RARITY_SEED_MULT,
  computeStageMult,
  rollEquipmentAffixes,
} from "@/modules/character/services/equipment-instance-service";

/** 与 scripts/seed-equipment.ts 一致：武器攻击基数 10，筑基段倍率 2 */
const WEAPON_ATK_BASE = 10;
const SEGMENT_MULT = 2;

/** 一件武器在给定境界的基础攻击值（items.effects 值 × 阶段系数） */
function baseAttack(rarity: string, realm: number): number {
  const seed = RARITY_SEED_MULT[rarity] ?? 1;
  const effectsValue = WEAPON_ATK_BASE * SEGMENT_MULT * seed;
  return Math.round(effectsValue * computeStageMult({
    itemMinRealm: 13,
    itemMaxRealm: 16,
    playerRealm: realm,
    rarity,
  }));
}

async function sampleAffix(params: {
  rarity: string;
  realm: number;
  times: number;
}): Promise<{
  attackAvg: number;
  attackHitRate: number;
  chanceAvg: Map<string, number>;
  totalFlatAvg: number;
}> {
  let attackSum = 0;
  let attackHits = 0;
  let flatSum = 0;
  const chanceSum = new Map<string, number>();
  const chanceHits = new Map<string, number>();

  for (let i = 0; i < params.times; i += 1) {
    const affixes = await rollEquipmentAffixes({
      rarity: params.rarity,
      playerRealm: params.realm,
      pathKey: "sword",
    });
    let hasAttack = false;
    for (const affix of affixes) {
      if (affix.key === "attack" && typeof affix.flat === "number") {
        attackSum += affix.flat;
        hasAttack = true;
      }
      if (typeof affix.flat === "number") {
        flatSum += affix.flat;
      }
      if (typeof affix.chance === "number") {
        chanceSum.set(affix.key, (chanceSum.get(affix.key) ?? 0) + affix.chance);
        chanceHits.set(affix.key, (chanceHits.get(affix.key) ?? 0) + 1);
      }
    }
    if (hasAttack) {
      attackHits += 1;
    }
  }

  const chanceAvg = new Map<string, number>();
  for (const [key, sum] of chanceSum) {
    chanceAvg.set(key, sum / Math.max(1, chanceHits.get(key) ?? 1));
  }

  return {
    attackAvg: attackHits > 0 ? attackSum / attackHits : 0,
    attackHitRate: attackHits / params.times,
    chanceAvg,
    totalFlatAvg: flatSum / params.times,
  };
}

async function main() {
  console.log("=== 常量 ===");
  for (const rarity of ["rare", "epic", "legendary", "hongmeng"]) {
    console.log(
      `${rarity.padEnd(10)} 生效品质倍率 ${RARITY_EFFECTIVE_MULT[rarity]}`
      + ` | 生成倍率 ${RARITY_SEED_MULT[rarity]}`
      + ` | 词条数 ${({ rare: 0, epic: 1, legendary: 2, hongmeng: 3 })[rarity]}`
      + ` | 同词条数值 ×${AFFIX_TIER_MULT[rarity] ?? 1}`,
    );
  }

  const realm = 14; // 筑基中期
  console.log(`\n=== 筑基中期（境界 ${realm}）一件武器 ===`);

  const rows: Array<{ rarity: string; base: number; attack: number; total: number }> = [];
  for (const rarity of ["epic", "legendary", "hongmeng"]) {
    const base = baseAttack(rarity, realm);
    const sample = await sampleAffix({ rarity, realm, times: 300 });
    rows.push({
      rarity,
      base,
      attack: Math.round(sample.attackAvg),
      total: base + Math.round(sample.totalFlatAvg),
    });
    console.log(
      `${rarity.padEnd(10)} 基础攻击 ${base}`
      + ` | 攻击词条 ${Math.round(sample.attackAvg)}（${Math.round(sample.attackHitRate * 100)}% 概率掷到）`
      + ` | 全部词条固定值和 ${Math.round(sample.totalFlatAvg)}`,
    );
    for (const [key, value] of sample.chanceAvg) {
      console.log(`           ${key} 平均 ${(value * 100).toFixed(2)}%`);
    }
  }

  const legend = rows.find((row) => row.rarity === "legendary");
  const hongmeng = rows.find((row) => row.rarity === "hongmeng");
  if (!legend || !hongmeng) {
    return;
  }

  console.log("\n=== 鸿蒙 vs 仙品 ===");
  console.log(`基础值：${hongmeng.base} vs ${legend.base}  → +${(((hongmeng.base / legend.base) - 1) * 100).toFixed(1)}%`);
  console.log(`同词条数值：×${AFFIX_TIER_MULT.hongmeng} vs ×${AFFIX_TIER_MULT.legendary}  → 单条 +${(((AFFIX_TIER_MULT.hongmeng / AFFIX_TIER_MULT.legendary) - 1) * 100).toFixed(0)}%`);
  console.log(`词条条数：3 vs 2  → 词条总量约 ${(3 * AFFIX_TIER_MULT.hongmeng / (2 * AFFIX_TIER_MULT.legendary)).toFixed(2)} 倍`);
  console.log(`一件装备合计（基础 + 全部词条固定值）：${hongmeng.total} vs ${legend.total}  → +${(((hongmeng.total / legend.total) - 1) * 100).toFixed(1)}%`);
}

await main();
