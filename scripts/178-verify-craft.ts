/** 端到端验证打造：直接调 craftSmithingRecipe（与 API 同一条代码路径） */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { craftSmithingRecipe } from "@/modules/character/services/smithing-service";

async function main() {
  const rows = await db.execute<{ id: string }>(sql`select "id" from "players" where "name" = '测试道友' limit 1`);
  const playerId = rows[0]?.id;
  if (!playerId) { console.log("找不到测试道友"); return; }

  const recipeRows = await db.execute<{ recipe_code: string; result_item_id: string }>(sql`
    select "recipe_code","result_item_id" from "smithing_recipes"
    where "enabled" = true and "recipe_code" = 'recipe_huashen_weapon'
    limit 1
  `);
  const recipeId = recipeRows[0]?.recipe_code || String(recipeRows[0]?.recipe_code ?? "");
  if (!recipeId) { console.log("没找到化神配方"); return; }
  console.log(`配方 ${recipeId} → ${recipeRows[0].result_item_id}`);

  const started = Date.now();
  const view = await craftSmithingRecipe({ playerId, recipeId });
  console.log(`打造成功，耗时 ${Date.now() - started}ms（若死锁会一直挂住不返回）`);
  const log = view.recentLogs?.[0];
  console.log(`结果: ${log ? (log.success ? "成品" : "失败") : "无日志"} 成功率=${log?.finalSuccessRate ?? "-"}`);
  console.log(`剩余配方数: ${view.recipes?.length ?? "-"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
