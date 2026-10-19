/**
 * 一次性数据修正：剥离存量角色基础属性里被拍平的灵根加成。
 *
 * 背景：灵根原本在建号时被一次性折算进基础属性（applySpiritualRootBonusToStats），
 * 改造后灵根改由统一修饰层常驻生效。若不剥离，存量角色会出现双重加成。
 *
 * 用法（在服务器项目根目录执行）：
 *   bun run scripts/strip-legacy-spiritual-root-bonus.ts           # dry-run，只打印前后对比
 *   bun run scripts/strip-legacy-spiritual-root-bonus.ts --apply   # 实际写库
 *
 * 注意：本脚本不是幂等的，只需要执行一次；执行后请勿重复运行。
 */

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { players } from "../src/db/schema";
import { mapSpiritualRootPercent } from "../src/modules/character/services/framework/spiritual-root.provider";
import type { StatKey } from "../src/modules/character/services/framework/stat-modifiers";

const apply = process.argv.includes("--apply");

/** 百分比键 → 需要回退的基础属性列。 */
const PERCENT_TO_COLUMNS: Record<StatKey, string[]> = {
  maxHp: ["maxHp", "hp"],
  maxMp: ["maxMp", "mp"],
  attack: ["attack"],
  defense: ["defense"],
  speed: ["speed"],
  luck: ["luck"],
  spiritualSense: ["spiritualSense"],
  armorPenetration: ["armorPenetration"],
  block: ["block"],
  skillDamageBonus: ["skillDamageBonus"],
  skillDamageReduction: ["skillDamageReduction"],
  artifactDamageBonus: ["artifactDamageBonus"],
  artifactDamageReduction: ["artifactDamageReduction"],
};

function stripValue(value: number, percent: number): number {
  if (!percent) return value;
  return Math.max(0, Math.round(value / (1 + percent)));
}

async function main(): Promise<void> {
  const rows = await db.select().from(players);
  console.log(`角色总数：${rows.length}，模式：${apply ? "写入" : "dry-run"}`);

  let changed = 0;

  for (const row of rows) {
    const percent = mapSpiritualRootPercent(row.spiritualRoot);
    const entries = Object.entries(percent) as [StatKey, number][];
    if (entries.length === 0) continue;

    const update: Record<string, number> = {};
    const before: Record<string, number> = {};

    for (const [statKey, ratio] of entries) {
      for (const column of PERCENT_TO_COLUMNS[statKey] ?? []) {
        const current = (row as unknown as Record<string, number>)[column];
        if (typeof current !== "number") continue;
        const next = stripValue(current, ratio);
        if (next === current) continue;
        before[column] = current;
        update[column] = next;
      }
    }

    // 当前值不应超过上限
    if (typeof update.maxHp === "number" && typeof row.hp === "number") {
      update.hp = Math.min(update.hp ?? row.hp, update.maxHp);
    }
    if (typeof update.maxMp === "number" && typeof row.mp === "number") {
      update.mp = Math.min(update.mp ?? row.mp, update.maxMp);
    }

    if (Object.keys(update).length === 0) continue;

    changed += 1;
    console.log(`\n[${row.id}] ${row.name ?? "(无名)"} 灵根=${row.spiritualRoot?.element ?? "?"}`);
    console.log(`  前: ${JSON.stringify(before)}`);
    console.log(`  后: ${JSON.stringify(update)}`);

    if (apply) {
      await db.update(players).set(update).where(eq(players.id, row.id));
    }
  }

  console.log(`\n需修正角色数：${changed}${apply ? "，已写入" : "（未写入，加 --apply 生效）"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("修正失败：", error);
    process.exit(1);
  });
