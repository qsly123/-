/**
 * 清理验证期间领取的「逆天改命」气运。
 *
 * 必须用 removePlayerFortune（而非直接 DELETE），因为它会按属性账本逆运算回滚，
 * 直接删记录会让玩家的永久属性虚高。
 *
 * 用法：TARGET_PLAYER_ID=xxx bun run scripts/cleanup-test-reversal.ts
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playerFortunes } from "@/db/schema";
import { removePlayerFortune } from "@/modules/character/services/fortune-service";

const PLAYER_ID = String(process.env.TARGET_PLAYER_ID || "").trim();

if (!PLAYER_ID) {
  console.error("缺少 TARGET_PLAYER_ID");
  process.exit(1);
}

const rows = await db
  .select({
    id: playerFortunes.id,
    status: playerFortunes.status,
    sourceRef: playerFortunes.sourceRef,
  })
  .from(playerFortunes)
  .where(and(
    eq(playerFortunes.playerId, PLAYER_ID),
    eq(playerFortunes.sourceType, "breakthrough"),
  ))
  .all();

console.log(`发现 ${rows.length} 条逆天改命记录`);

for (const row of rows) {
  if (row.status !== "active") {
    console.log(`跳过非生效记录 #${row.id}（${row.status}）`);
    continue;
  }
  await removePlayerFortune({ playerId: PLAYER_ID, playerFortuneId: row.id });
  console.log(`已回滚 #${row.id}（${row.sourceRef}）`);
}

console.log("清理完成");
