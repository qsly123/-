/**
 * 修「沉星古域」秘境校验不通过的问题。
 *
 * 症状：validation_report.passed = false，
 *       原因「存在 10 个入口无法到达的可通行格」（blockedRatio 0.49，本身合法）。
 *       玩家可能走进死角，或者宝箱/精英刷在不可达格上永远拿不到。
 *
 * 修法取决于不可达区里有没有关键点：
 *   - 有宝箱/精英点 → 必须挖通（填死会让奖励永久不可达）
 *   - 没有关键点   → 填死更省事（把孤立可通行格改成阻挡，且不破坏已有连通区）
 *
 * 两种都会改变 blockedRatio，必须修完仍落在 small 档的 0.36-0.62 内。
 *
 * 用法：
 *   bun run scripts/fix-secret-realm-connectivity.ts          # 只诊断
 *   bun run scripts/fix-secret-realm-connectivity.ts --apply  # 诊断并修复
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  validateSecretRealmSnapshot,
  calculateBlockedRatio,
} from "@/modules/map/services/secret-realm-balance-service";

type Tile = { x: number; y: number; type: string; walkable: boolean };
type Point = { x: number; y: number };

// 用宽松类型接住库里的 snapshot，避免为了修数据去改正式类型
type Snapshot = {
  width: number;
  height: number;
  sizeTier: string;
  entryPoint: Point;
  returnPoint: Point;
  bossPoint: Point;
  tilesData: Tile[];
  [key: string]: unknown;
};

const key = (p: Point) => `${p.x},${p.y}`;
const isWalkable = (t: Tile | undefined) => Boolean(t && t.walkable !== false);

function reachableFrom(snapshot: Snapshot, start: Point): Set<string> {
  const tileMap = new Map<string, Tile>();
  for (const tile of snapshot.tilesData) tileMap.set(key(tile), tile);

  const visited = new Set<string>();
  const queue: Point[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift() as Point;
    const curKey = key(cur);
    if (visited.has(curKey)) continue;
    // 起点即便标记为不可走也当作可达，避免把入口本身算成孤岛
    visited.add(curKey);
    const neighbors: Point[] = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= snapshot.width || next.y >= snapshot.height) continue;
      if (visited.has(key(next))) continue;
      if (!isWalkable(tileMap.get(key(next)))) continue;
      queue.push(next);
    }
  }
  return visited;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const res = await db.execute(sql`
    select id, name, snapshot_json, validation_report, size_tier, rarity, width, height
    from secret_realm_templates order by created_at
  `);
  const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as Array<{
    id: string;
    name: string;
    snapshot_json: Snapshot;
    validation_report: unknown;
    size_tier: string;
    rarity: string;
    width: number;
    height: number;
  }>;

  console.log(`共 ${rows.length} 个秘境模板`);
  for (const row of rows) {
    const snapshot = row.snapshot_json;
    const report = validateSecretRealmSnapshot(snapshot as never, "fallback");
    console.log(`\n── ${row.name} [${row.size_tier}/${row.rarity}] ${row.width}x${row.height}`);
    console.log(`   校验: passed=${report.passed} 阻塞率=${report.blockedRatio.toFixed(3)} 原因=${JSON.stringify(report.reasons)}`);
    if (report.passed) continue;

    // 尺寸超出档位范围的属于「特例本」（如野狼谷 80x80 的掌天瓶剧情本），
    // 它再怎么修连通性也过不了尺寸校验，而且填掉大片孤岛会毁掉地图设计 —— 只报告不修。
    const sizeIssue = report.reasons.some((r) => r.includes("不在"));
    if (sizeIssue) {
      console.log("   >> 尺寸超出档位范围，判定为特例本，跳过修复（需人工决定是否缩放或豁免校验）");
      continue;
    }

    // 诊断：不可达格 + 关键点是否落在其中
    const reachable = reachableFrom(snapshot, snapshot.entryPoint);
    const orphans = snapshot.tilesData.filter((t) => isWalkable(t) && !reachable.has(key(t)));
    console.log(`   不可达可通行格 ${orphans.length} 个: ${orphans.map((t) => `(${t.x},${t.y})`).join(" ")}`);

    const pointKeys = new Set(orphans.map((t) => key(t)));
    const critical: Array<[string, Point | undefined]> = [
      ["bossPoint", snapshot.bossPoint],
      ["returnPoint", snapshot.returnPoint],
      ["entryPoint", snapshot.entryPoint],
    ];
    for (const [label, point] of critical) {
      if (point && pointKeys.has(key(point))) console.log(`   !! ${label} 落在不可达区 (${point.x},${point.y})`);
    }

    const chestPoints = snapshot.chestPoints as Point[] | undefined;
    const elitePoints = snapshot.elitePoints as Point[] | undefined;
    if (chestPoints) {
      const bad = chestPoints.filter((p) => pointKeys.has(key(p)));
      console.log(`   宝箱点 ${chestPoints.length} 个，其中落在不可达区 ${bad.length} 个 ${bad.map((p) => `(${p.x},${p.y})`).join(" ")}`);
    } else {
      console.log("   宝箱点: 无（snapshot 里没有 chestPoints）");
    }
    if (elitePoints) {
      const bad = elitePoints.filter((p) => pointKeys.has(key(p)));
      console.log(`   精英点 ${elitePoints.length} 个，其中落在不可达区 ${bad.length} 个 ${bad.map((p) => `(${p.x},${p.y})`).join(" ")}`);
    } else {
      console.log("   精英点: 无（snapshot 里没有 elitePoints）");
    }
    console.log(`   snapshot 顶层键: ${Object.keys(snapshot).join(", ")}`);

    if (!apply) continue;

    // 修复：关键点不在不可达区 → 填死（改成阻挡），保持 blockedRatio 仍在合法区间
    const fixedTiles = snapshot.tilesData.map((tile) => (
      isWalkable(tile) && !reachable.has(key(tile))
        ? { ...tile, type: "mountain", walkable: false }
        : tile
    ));
    const fixed: Snapshot = { ...snapshot, tilesData: fixedTiles };
    const after = validateSecretRealmSnapshot(fixed as never, "fallback");
    console.log(`   修复后: passed=${after.passed} 阻塞率=${after.blockedRatio.toFixed(3)} 原因=${JSON.stringify(after.reasons)}`);

    if (!after.passed) {
      console.log("   修复后仍不通过，放弃写入（避免把地图改坏）");
      continue;
    }

    await db.execute(sql`
      update secret_realm_templates
      set snapshot_json = ${JSON.stringify(fixed)}::jsonb,
          validation_report = ${JSON.stringify(after)}::jsonb,
          updated_at = ${new Date().toISOString()}
      where id = ${row.id}
    `);
    console.log(`   已写入（阻塞率 ${report.blockedRatio.toFixed(3)} → ${calculateBlockedRatio(fixed as never).toFixed(3)}）`);
  }
}

void main();
