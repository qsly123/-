/**
 * 丹药扩展：派丹药品级变体 + 新增解毒丹。
 *
 * 背景：丹药此前无品级之分，同一配方炼出即同质；丹毒只能挂机等 8 分钟/点，无解毒手段。
 *
 * 用法：
 *   bun run scripts/seed-pill-expansion.ts            # dry-run
 *   bun run scripts/seed-pill-expansion.ts --apply    # 写库
 *
 * 幂等：品级变体按确定性 id（原 id + 后缀）upsert，解毒丹按固定 id upsert。
 */

import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { items } from "../src/db/schema";
import {
  PILL_GRADES,
  PILL_GRADE_ID_SUFFIX,
  PILL_GRADE_MULTIPLIER,
  type PillGrade,
} from "../src/modules/character/services/pill-grade";
import type { ItemEffect } from "../src/types/game";

const apply = process.argv.includes("--apply");

/** 解毒丹：给丹毒一个主动解法，而不是只能挂机等。 */
const DETOX_PILLS = [
  {
    id: "pill_detox_qingling",
    name: "清灵丹",
    description: "性温和的解毒丹，可化去少量丹毒。",
    rarity: "common",
    price: 120,
    amount: 3,
  },
  {
    id: "pill_detox_dichen",
    name: "涤尘丹",
    description: "涤荡经脉中的丹毒，效力可观。",
    rarity: "rare",
    price: 420,
    amount: 8,
  },
  {
    id: "pill_detox_taiqqing",
    name: "太清涤毒丹",
    description: "太清秘制，可尽数化去一身丹毒。",
    rarity: "epic",
    price: 1200,
    amount: 20,
  },
];

/** 读取炼丹配方的产出物品（表可能尚未创建，容错返回空）。 */
async function loadAlchemyResultItemIds(): Promise<string[]> {
  try {
    const rows = await db.execute<{ result_item_id: string }>(
      sql`SELECT DISTINCT "result_item_id" FROM "alchemy_recipes" WHERE "enabled" = true`,
    );
    return (rows as unknown as { result_item_id: string }[])
      .map((row) => String(row?.result_item_id || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scaleEffects(effects: ItemEffect[] | null, multiplier: number): ItemEffect[] {
  if (!effects || effects.length === 0) return [];
  return effects.map((effect) => {
    // 非数值型效果（学技能 / 解锁头像）不随品级缩放
    if (
      effect.type === "learn_skill"
      || effect.type === "bind_skill"
      || effect.type === "unlock_avatar"
      || effect.type === "unlock_avatar_frame"
    ) {
      return effect;
    }
    const scaled = Math.max(1, Math.round(Number(effect.value || 0) * multiplier));
    return { ...effect, value: scaled };
  });
}

async function main(): Promise<void> {
  console.log(`丹药扩展，模式：${apply ? "写入" : "dry-run"}`);

  // 1. 解毒丹
  let detoxCreated = 0;
  for (const pill of DETOX_PILLS) {
    const exists = await db.select({ id: items.id }).from(items).where(sql`"id" = ${pill.id}`).get();
    if (exists) {
      console.log(`  = 解毒丹已存在：${pill.name}`);
      continue;
    }
    detoxCreated += 1;
    console.log(`  + 解毒丹 ${pill.name}（丹毒 -${pill.amount}）`);
    if (apply) {
      await db.insert(items).values({
        id: pill.id,
        name: pill.name,
        description: pill.description,
        itemType: "consumable",
        rarity: pill.rarity,
        effects: [{ type: "reduce_toxicity", value: pill.amount }],
        pillToxicity: 0,
        price: pill.price,
      });
    }
  }

  // 2. 品级变体
  const resultItemIds = await loadAlchemyResultItemIds();
  console.log(`炼丹产出物品：${resultItemIds.length} 个`);

  let variants = 0;
  for (const baseItemId of resultItemIds) {
    const base = await db.select().from(items).where(sql`"id" = ${baseItemId}`).get();
    if (!base) {
      console.log(`  ? 产出物品不存在，跳过：${baseItemId}`);
      continue;
    }

    for (const grade of PILL_GRADES) {
      if (grade === "中品") continue; // 中品沿用原物品
      const variantId = `${baseItemId}${PILL_GRADE_ID_SUFFIX[grade]}`;
      const exists = await db.select({ id: items.id }).from(items).where(sql`"id" = ${variantId}`).get();
      if (exists) continue;

      variants += 1;
      const multiplier = PILL_GRADE_MULTIPLIER[grade as PillGrade];
      console.log(`  + ${grade}·${base.name}（×${multiplier}）`);
      if (apply) {
        await db.insert(items).values({
          id: variantId,
          templateItemId: baseItemId,
          name: `${grade}·${base.name}`,
          iconUrl: base.iconUrl,
          description: `${base.description ?? base.name}（${grade}，药力 ${multiplier} 倍）`,
          itemType: base.itemType,
          rarity: base.rarity,
          effects: scaleEffects(base.effects as ItemEffect[] | null, multiplier),
          pillToxicity: base.pillToxicity,
          price: Math.max(1, Math.round(Number(base.price || 0) * multiplier)),
          stackable: base.stackable,
          isBound: base.isBound,
          minRealm: base.minRealm,
          maxRealm: base.maxRealm,
        });
      }
    }
  }

  console.log(`\n解毒丹 ${detoxCreated} / 品级变体 ${variants}${apply ? "，已写入" : "（加 --apply 生效）"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("丹药扩展失败：", error);
    process.exit(1);
  });
