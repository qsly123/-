/** 检查重校准后各段怪的 hp/atk 与 int32 截断位置 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monsters } from "@/db/schema";

const CAP = 2147483647;
function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(Math.round(n));
}

async function main() {
  for (const lv of [25, 30, 34, 36, 38, 40, 44]) {
    const parts: string[] = [];
    for (const t of ["normal", "elite", "boss"]) {
      const rows = await db.select().from(monsters)
        .where(sql`${monsters.level} = ${lv} and ${monsters.monsterType} = ${t}`).all();
      const m = rows[0];
      if (!m) continue;
      const capHp = Number(m.hp) >= CAP ? " hp顶格" : "";
      const capAtk = Number(m.attack) >= CAP ? " atk顶格" : "";
      parts.push(`${t}: hp=${fmt(Number(m.hp))} atk=${fmt(Number(m.attack))}${capHp}${capAtk}`);
    }
    console.log(`${lv}级 ${parts.join(" | ")}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
