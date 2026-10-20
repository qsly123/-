/**
 * 沉星秘境可达性诊断（2026-10-20）
 *
 * 玩家反馈：秘境里全是房子和山，走不出去。
 * 本脚本回答三件事：
 *   1. 这张图在哪（world_map_instances / maps / temporary_maps）
 *   2. 瓦片构成：可走 / 建筑 / 山 各多少
 *   3. 从玩家当前位置 BFS：能走多大一片？传送门够得着吗？
 *
 * 用法：npx tsx scripts/193-secret-realm-reachability.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Tile = {
  x: number;
  y: number;
  type: string;
  walkable?: boolean;
  portalId?: string;
  portalName?: string;
};

function histogram(tiles: Tile[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tile of tiles) {
    const key = `${tile.type}${tile.walkable === false ? "(不可走)" : tile.walkable === true ? "" : "(未标)"}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function bfs(tiles: Tile[], startX: number, startY: number): { reachable: Set<string>; count: number } {
  const walkable = new Set<string>();
  for (const tile of tiles) {
    // 未标 walkable 的按 type 判断：房子/山/水一律不可走
    const w = tile.walkable ?? !/building|house|mountain|water|wall|rock|tree/i.test(tile.type);
    if (w) walkable.add(`${tile.x},${tile.y}`);
  }
  const seen = new Set<string>();
  if (!walkable.has(`${startX},${startY}`)) {
    return { reachable: seen, count: 0 };
  }
  const queue: Array<[number, number]> = [[startX, startY]];
  seen.add(`${startX},${startY}`);
  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${x + dx},${y + dy}`;
      if (walkable.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push([x + dx, y + dy]);
      }
    }
  }
  return { reachable: seen, count: seen.size };
}

async function main() {
  // 1. 定位这张图
  const found = await db.execute(sql`
    select 'world_map_instances' as src, id, name, width, height from world_map_instances where name like '%沉星%'
    union all
    select 'maps', id, name, width, height from maps where name like '%沉星%'
    union all
    select 'temporary_maps', id, name, width, height from temporary_maps where name like '%沉星%'
  `);
  const rows = (found as unknown as { rows: Array<Record<string, unknown>> }).rows
    ?? (found as unknown as Array<Record<string, unknown>>);
  console.log("=== 命中地图 ===");
  console.log(JSON.stringify(rows, null, 2));

  // 2. 玩家当前位置
  const players = await db.execute(sql`
    select id, name, current_map_id, current_map_instance_id, position_x, position_y
    from players where name = '测试道友'
  `);
  const pRows = (players as unknown as { rows: Array<Record<string, unknown>> }).rows
    ?? (players as unknown as Array<Record<string, unknown>>);
  const player = pRows[0];
  console.log("=== 测试道友 ===");
  console.log(JSON.stringify(player, null, 2));
  if (!player) return;

  const instanceId = String(player.current_map_instance_id || player.current_map_id || "");

  // 3. 取瓦片
  let tileRows: Array<{ tiles_data: Tile[]; width: number; height: number; name: string }> = [];
  for (const table of ["world_map_instances", "maps", "temporary_maps"]) {
    const res = await db.execute(sql.raw(`
      select name, width, height, tiles_data from "${table}" where id = '${instanceId}'
    `));
    const list = (res as unknown as { rows: Array<Record<string, unknown>> }).rows
      ?? (res as unknown as Array<Record<string, unknown>>);
    if (list.length > 0) {
      tileRows = list as unknown as typeof tileRows;
      console.log(`\n（瓦片来源表：${table}）`);
      break;
    }
  }
  if (tileRows.length === 0) {
    console.log("未取到瓦片数据");
    return;
  }
  const info = tileRows[0];
  const tiles: Tile[] = Array.isArray(info.tiles_data) ? info.tiles_data : [];
  console.log(`\n=== ${info.name} ${info.width}×${info.height}，瓦片 ${tiles.length} 个 ===`);
  const hist = histogram(tiles);
  for (const [key, count] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }

  // 4. BFS
  const px = Number(player.position_x ?? 0);
  const py = Number(player.position_y ?? 0);
  const { reachable, count } = bfs(tiles, px, py);
  console.log(`\n=== 从玩家位置 (${px},${py}) 出发 ===`);
  console.log(`  可达格数：${count} / 瓦片总数 ${tiles.length}`);
  if (count === 0) {
    console.log("  ⚠ 玩家脚下这格本身就不可走——生成时把人放进了障碍物里");
    const near = tiles.filter((t) => Math.abs(t.x - px) <= 2 && Math.abs(t.y - py) <= 2);
    console.log("  周围 5×5：" + near.map((t) => `(${t.x},${t.y})${t.type}`).join(" "));
  }

  // 5. 传送门
  const portalRes = await db.execute(sql`
    select portal_name, position_x, position_y, target_world_map_id, target_position_x, target_position_y
    from world_map_portals where world_map_id = ${instanceId}
  `);
  const pList = (portalRes as unknown as { rows: Array<Record<string, unknown>> }).rows
    ?? (portalRes as unknown as Array<Record<string, unknown>>);
  console.log(`\n=== 传送门（${pList.length} 个） ===`);
  for (const portal of pList) {
    const x = Number(portal.position_x);
    const y = Number(portal.position_y);
    const ok = reachable.has(`${x},${y}`);
    const tile = tiles.find((t) => t.x === x && t.y === y);
    console.log(`  ${portal.portal_name} (${x},${y}) 可达=${ok ? "是" : "否"} 瓦片=${tile ? tile.type : "无"} → ${portal.target_world_map_id}`);
  }

  const portalTiles = tiles.filter((t) => t.portalId || /portal|gate|exit|传送/i.test(t.type));
  console.log(`\n瓦片里带传送门属性的格子：${portalTiles.length} 个`);
  for (const t of portalTiles.slice(0, 20)) {
    console.log(`  (${t.x},${t.y}) ${t.type} ${t.portalName ?? ""} 可达=${reachable.has(`${t.x},${t.y}`) ? "是" : "否"}`);
  }

  // 6. 出口：地图边界上的可走格
  const edge = [...reachable].filter((key) => {
    const [x, y] = key.split(",").map(Number);
    return x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1;
  });
  console.log(`\n可达区域里位于地图边界的格子：${edge.length} 个`);
}

main().then(() => process.exit(0)).catch((error) => { console.error("ERR:", String(error)); process.exit(1); });
