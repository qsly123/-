/**
 * 验证两件事：
 * 1. 炼丹/炼器用到的材料，有多少能查到"去哪弄"（来源覆盖率）。
 *    覆盖率低的话，"缺料弹框"就会大面积显示"暂无收录来源"，等于没用。
 * 2. 功法点发放是否真的落到 plugin_gongfa_player_points 与 point_logs。
 *
 * 用法：bun run scripts/verify-material-sources.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { getItemSources } from "@/modules/character/services/item-source-service";
import { grantGongfaPoints } from "@/modules/character/services/gongfa-service";

const PLAYER_ID = "ZbfY3sLCG5AhBa7Y";

type IngredientRow = {
  item_id: string;
};

async function loadIngredientIds(): Promise<string[]> {
  const ids = new Set<string>();

  const alchemyRows = await db.execute<IngredientRow>(`
    SELECT "main_item_id" AS "item_id" FROM "alchemy_recipes" WHERE "main_item_id" IS NOT NULL
    UNION SELECT "aux_a_item_id" FROM "alchemy_recipes" WHERE "aux_a_item_id" IS NOT NULL
    UNION SELECT "aux_b_item_id" FROM "alchemy_recipes" WHERE "aux_b_item_id" IS NOT NULL
    UNION SELECT "aux_c_item_id" FROM "alchemy_recipes" WHERE "aux_c_item_id" IS NOT NULL
  ` as never).catch(() => [] as IngredientRow[]);

  const smithingRows = await db.execute<IngredientRow>(`
    SELECT "main_item_id" AS "item_id" FROM "smithing_recipes" WHERE "main_item_id" IS NOT NULL
    UNION SELECT "aux_a_item_id" FROM "smithing_recipes" WHERE "aux_a_item_id" IS NOT NULL
    UNION SELECT "aux_b_item_id" FROM "smithing_recipes" WHERE "aux_b_item_id" IS NOT NULL
    UNION SELECT "aux_c_item_id" FROM "smithing_recipes" WHERE "aux_c_item_id" IS NOT NULL
  ` as never).catch(() => [] as IngredientRow[]);

  for (const row of [...alchemyRows, ...smithingRows]) {
    const id = String(row.item_id || "").trim();
    if (id) {
      ids.add(id);
    }
  }

  return [...ids];
}

async function main() {
  const ingredientIds = await loadIngredientIds();
  console.log(`炼丹/炼器用到的材料共 ${ingredientIds.length} 种\n`);

  const nameMap = new Map<string, string>();
  const itemRows = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .all();
  for (const row of itemRows) {
    nameMap.set(row.id, row.name);
  }

  const withSource: string[] = [];
  const withoutSource: string[] = [];
  let sourceTotal = 0;

  for (const itemId of ingredientIds) {
    const sources = await getItemSources(itemId);
    sourceTotal += sources.length;
    if (sources.length > 0) {
      withSource.push(nameMap.get(itemId) || itemId);
    } else {
      withoutSource.push(nameMap.get(itemId) || itemId);
    }
  }

  const rate = ingredientIds.length > 0
    ? Math.round((withSource.length / ingredientIds.length) * 100)
    : 0;
  console.log(`[${rate >= 60 ? "PASS" : "WARN"}] 来源覆盖率 ${withSource.length}/${ingredientIds.length}（${rate}%），共 ${sourceTotal} 条来源`);
  console.log(`查得到来源的（前 12）：${withSource.slice(0, 12).join("、")}`);
  console.log(`\n查不到来源的（${withoutSource.length} 种）：${withoutSource.slice(0, 25).join("、")}`);

  // 抽一个能查到的材料，看看来源长什么样
  const sample = ingredientIds.find(async () => false);
  void sample;
  for (const itemId of ingredientIds) {
    const sources = await getItemSources(itemId);
    if (sources.length > 0) {
      console.log(`\n样例「${nameMap.get(itemId) || itemId}」的来源：`);
      for (const source of sources.slice(0, 4)) {
        console.log(`  [${source.label}] ${source.sourceName} @ ${source.mapName || "位置未标注"}`);
      }
      break;
    }
  }

  /* ---------------- 功法点发放 ---------------- */
  const before = await db.execute<{ points: string | number }>(`
    SELECT COALESCE("points",0) AS "points" FROM "plugin_gongfa_player_points" WHERE "player_id" = '${PLAYER_ID}'
  ` as never).catch(() => [] as { points: string | number }[]);
  const beforePoints = Number(before[0]?.points || 0);

  const granted = await grantGongfaPoints({
    playerId: PLAYER_ID,
    amount: 1,
    source: "breakthrough",
    reason: "验证脚本：模拟突破",
    sourceRef: "realm:test",
  });

  const after = await db.execute<{ points: string | number }>(`
    SELECT COALESCE("points",0) AS "points" FROM "plugin_gongfa_player_points" WHERE "player_id" = '${PLAYER_ID}'
  ` as never).catch(() => [] as { points: string | number }[]);
  const afterPoints = Number(after[0]?.points || 0);

  const logs = await db.execute<{ source: string }>(`
    SELECT "source" FROM "plugin_gongfa_point_logs" WHERE "player_id" = '${PLAYER_ID}' ORDER BY "id" DESC LIMIT 3
  ` as never).catch(() => [] as { source: string }[]);

  const ok = granted === 1 && afterPoints === beforePoints + 1 && logs.length > 0;
  console.log(`\n[${ok ? "PASS" : "FAIL"}] 功法点发放：${beforePoints} → ${afterPoints}（发 ${granted}），日志 ${logs.length} 条`);

  /* ---------------- 诊断：灵田类材料为什么查不到来源 ---------------- */
  const pluginTables = await db.execute<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'plugin%'
    ORDER BY table_name
  ` as never).catch(() => [] as { table_name: string }[]);
  console.log(`\nplugin 表（${pluginTables.length}）：${pluginTables.map((row) => row.table_name).join("、")}`);

  const noSourceNames = ["赤髓芝", "守心雪参", "冰心草种", "咸风草种", "火晶草种"];
  for (const name of noSourceNames) {
    const row = itemRows.find((entry) => entry.name === name);
    if (!row) {
      continue;
    }
    const detail = await db
      .select({ itemType: items.itemType, description: items.description })
      .from(items)
      .where(eq(items.id, row.id))
      .get();
    console.log(`  「${name}」itemType=${detail?.itemType} 描述=${detail?.description || "无"}`);
  }

  // 复原：把验证加的点扣回去，并删掉验证日志
  await db.execute(`
    UPDATE "plugin_gongfa_player_points" SET "points" = "points" - 1, "total_earned" = "total_earned" - 1 WHERE "player_id" = '${PLAYER_ID}'
  ` as never).catch(() => undefined);
  await db.execute(`
    DELETE FROM "plugin_gongfa_point_logs" WHERE "player_id" = '${PLAYER_ID}' AND "source_ref" = 'realm:test'
  ` as never).catch(() => undefined);
  console.log("已清理验证数据");
}

await main();
