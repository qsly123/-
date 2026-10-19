/**
 * 验证逆天改命三项新机制（跑完清理）：
 * 1. 分池：未选道途只出 general
 * 2. 刷新：每境界一次，第二次被拒
 * 3. 精进：已拥有的永久天机再承接 → 属性按品阶追加，且记在原账上
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { fortunes, playerFortuneAttrLedger, playerFortunes, players } from "@/db/schema";
import {
  buildReversalSourceRef,
  claimReversalFortune,
  rerollReversalOptions,
  rollReversalOptions,
} from "@/modules/character/services/reversal-service";

const PLAYER_ID = "ZbfY3sLCG5AhBa7Y";
const REALM = 990001; // 用一个不存在的境界，避免污染真实数据

function step(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name} —— ${detail}`);
}

async function main() {
  // ---------- 1. 分池（测试号已选 path=sword，池应为 general + sword） ----------
  const options = await rollReversalOptions({ playerId: PLAYER_ID, gender: "男" });
  const cats = await db.select({ id: fortunes.id, category: fortunes.category })
    .from(fortunes).all();
  const catOf = new Map(cats.map((row) => [row.id, row.category]));
  const poolCategories = new Set(["general", "sword"]);
  const outOfPool = options.filter((option) => !poolCategories.has(catOf.get(option.id) ?? ""));
  const inPathPool = options.filter((option) => catOf.get(option.id) === "sword");
  step("分池（sword 流派池生效）", outOfPool.length === 0 && options.length > 0,
    `抽到 ${options.length} 条（sword 池词条 ${inPathPool.length} 条），出池 ${outOfPool.length} 条`);

  // ---------- 2. 刷新限制 ----------
  const first = await rerollReversalOptions({ playerId: PLAYER_ID, gender: "男", realmLinear: REALM });
  const second = await rerollReversalOptions({ playerId: PLAYER_ID, gender: "男", realmLinear: REALM });
  step("刷新限制（一次有效，二次被拒）", first.allowed && !second.allowed,
    `第一次 allowed=${first.allowed}（${first.options.length} 条），第二次 allowed=${second.allowed}（${second.message}）`);

  // ---------- 3. 精进 ----------
  // 给测试号塞一条永久气运（坚石如钟，blue），再 claim 同一条 → 应走精进
  const target = await db.select().from(fortunes)
    .where(and(eq(fortunes.name, "坚石如钟"), eq(fortunes.durationSeconds, 0))).get();
  if (!target) {
    step("精进", false, "找不到测试用气运「坚石如钟」");
  } else {
    const insertedRow = await db.insert(playerFortunes).values({
      playerId: PLAYER_ID,
      fortuneId: target.id,
      sourceType: "system",
      sourceRef: "verify-upgrade",
      status: "active",
    }).returning({ id: playerFortunes.id }).get();
    if (!insertedRow) throw new Error("插入测试气运失败");
    const inserted = insertedRow;

    const before = await db.select().from(players).where(eq(players.id, PLAYER_ID)).get();
    const beforeAttack = Number(before?.attack || 0);
    const beforePen = Number(before?.armorPenetration || 0);

    const result = await claimReversalFortune({
      playerId: PLAYER_ID,
      fortuneId: target.id,
      realmLinear: REALM,
    });

    const after = await db.select().from(players).where(eq(players.id, PLAYER_ID)).get();
    const afterAttack = Number(after?.attack || 0);
    const afterPen = Number(after?.armorPenetration || 0);
    const ledgerCount = await db.select({ id: playerFortuneAttrLedger.id })
      .from(playerFortuneAttrLedger)
      .where(eq(playerFortuneAttrLedger.playerFortuneId, inserted.id)).all();

    // blue 系数 0.3：attack 2×0.3=0.6→保底 1；armorPenetration 1×0.3=0.3→保底 1
    const base = target.attrEffects as Record<string, number>;
    const expectAttack = Number(base.attack || 0) > 0
      ? Math.max(1, Math.round(Number(base.attack) * 0.3))
      : 0;
    const expectPen = Number(base.armorPenetration || 0) > 0
      ? Math.max(1, Math.round(Number(base.armorPenetration) * 0.3))
      : 0;

    step("精进（重复承接 → 属性追加）",
      result.granted
        && result.message.includes("精进")
        && afterAttack - beforeAttack === expectAttack
        && afterPen - beforePen === expectPen
        && ledgerCount.length === 1,
      `${result.message} 攻击 +${afterAttack - beforeAttack}（期望 ${expectAttack}）`
      + ` 破甲 +${afterPen - beforePen}（期望 ${expectPen}） 账目 ${ledgerCount.length} 笔`);

    // ---------- 清理 ----------
    await db.delete(playerFortuneAttrLedger)
      .where(eq(playerFortuneAttrLedger.playerFortuneId, inserted.id)).run();
    await db.delete(playerFortunes).where(eq(playerFortunes.id, inserted.id)).run();
    await db.update(players).set({
      attack: beforeAttack,
      armorPenetration: beforePen,
      hp: Number(before?.hp || 0),
    }).where(eq(players.id, PLAYER_ID)).run();
  }

  // ---------- 清理刷新记录 ----------
  await db.execute(`DELETE FROM player_reversal_rerolls WHERE player_id = '${PLAYER_ID}' AND realm_linear = ${REALM}`.trim() as never);
  console.log("\n已清理测试数据");
}

await main();
