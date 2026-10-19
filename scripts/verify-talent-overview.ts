/**
 * 临时验证脚本：确认天赋总览（道途展示页的数据源）输出正确。
 *
 * 库里 player_talents 是 0 条（还没有人选过天赋），所以没法直接看真实数据。
 * 这里借第一个玩家临时写入三层天赋，打印总览结果后立即删除，不留痕迹。
 *
 * 用法：bun run scripts/verify-talent-overview.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerTalents, players, talentPaths } from "@/db/schema";
import {
  getPlayerTalentOverview,
  resolveStagePercent,
} from "@/modules/character/services/talent-service";

const player = await db.select({ id: players.id, name: players.name, realmMajor: players.realmMajor })
  .from(players).limit(1).get();

if (!player) {
  console.log("库里没有玩家，无法验证");
  process.exit(0);
}

console.log(`借用的玩家：${player.name}（当前大境界 major=${player.realmMajor}）`);

await db.insert(playerTalents).values([
  { playerId: player.id, pathKey: "combat", kind: "direction", chosenAtRealm: 13, chosenAtMajor: 2 },
  { playerId: player.id, pathKey: "sword", kind: "path", chosenAtRealm: 17, chosenAtMajor: 3 },
  { playerId: player.id, pathKey: "sword_jianxin", kind: "daoxin", chosenAtRealm: 21, chosenAtMajor: 4 },
]).run();

const overview = await getPlayerTalentOverview(player.id);
console.log("\n== 总览输出（展示页拿到的就是这份） ==");
console.log(`当前境界 major=${overview.major}`);
for (const node of overview.nodes) {
  console.log(`  [${node.kind}] ${node.name}  生效加成=${JSON.stringify(node.currentPercent)}`);
}
console.log(`  合计=${JSON.stringify(overview.totalPercent)}`);
console.log(`  层解锁=${JSON.stringify(overview.layerUnlock)}`);

// 玩家境界不够时加成是空的，这里额外按 major=4 单算一次，确认曲线本身正确
console.log("\n== 各节点在元婴(major 4)的加成（校验曲线数值） ==");
const paths = await db.select().from(talentPaths).all();
for (const path of paths) {
  const percent = resolveStagePercent(path.stageCurve, 4);
  const keys = Object.keys(percent);
  if (keys.length > 0) {
    console.log(`  ${path.name.padEnd(6, "　")} => ${keys.map((k) => `${k}:${percent[k as keyof typeof percent]}`).join(" ")}`);
  }
}

await db.delete(playerTalents).where(eq(playerTalents.playerId, player.id)).run();
const remain = await db.select().from(playerTalents).all();
console.log(`\n已清理测试数据，player_talents 剩余 ${remain.length} 条`);
