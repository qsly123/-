/**
 * 打印沉星秘境（临时图）的瓦片平面图 + 连通分量 + 传送门。
 * 用法：npx tsx scripts/194-dump-secret-realm.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Tile = {
  x: number; y: number; type: string; walkable?: boolean;
  eventId?: string; portalId?: string; portalName?: string;
  portalTargetMapId?: string; description?: string;
};

const SYMBOL: Record<string, string> = {
  empty: "·", grass: "·", path: "·", road: "·", stone: "·",
  building: "房", house: "房", wall: "墙",
  mountain: "山", rock: "山", hill: "山",
  water: "水", river: "水",
  tree: "树", forest: "树",
  portal: "门", gate: "门", exit: "门",
};

function isWalkable(tile: Tile): boolean {
  if (typeof tile.walkable === "boolean") return tile.walkable;
  return !/building|house|mountain|water|wall|rock|river|hill/i.test(tile.type);
}

async function main() {
  const res = await db.execute(sql`
    select id, name, width, height, tiles_data, min_realm, map_type
    from temporary_maps where name like '%沉星%'
    union all
    select id, name, width, height, tiles_data, min_realm, 'map' from maps where name like '%沉星%'
  `);
  const list = (res as unknown as { rows: Array<Record<string, unknown>> }).rows
    ?? (res as unknown as Array<Record<string, unknown>>);
  for (const mapRow of list as unknown as Array<{ id: string; name: string; width: number; height: number; tiles_data: Tile[] }>) {
    const tiles: Tile[] = Array.isArray(mapRow.tiles_data) ? mapRow.tiles_data : [];
    console.log(`\n=== ${mapRow.name} (${mapRow.id}) ${mapRow.width}×${mapRow.height}，瓦片 ${tiles.length} ===`);
    const hist = new Map<string, number>();
    for (const t of tiles) hist.set(t.type, (hist.get(t.type) ?? 0) + 1);
    console.log("构成：" + [...hist.entries()].map(([k, v]) => `${k}=${v}`).join(" / "));

    const grid: string[][] = Array.from({ length: mapRow.height }, () => Array(mapRow.width).fill("?"));
    for (const t of tiles) {
      if (grid[t.y] && t.x < mapRow.width) {
        const base = SYMBOL[t.type] ?? t.type.slice(0, 1);
        grid[t.y][t.x] = t.portalId || t.type === "portal" ? "门" : base;
      }
    }
    console.log("平面图（房/山/水=不可走，门=传送门，·=可走）：");
    console.log("    " + Array.from({ length: mapRow.width }, (_, i) => i % 10).join(""));
    grid.forEach((row, y) => console.log(String(y).padStart(3) + " " + row.join("")));

    // 传送门详情
    const portals = tiles.filter((t) => t.portalId || t.type === "portal" || t.eventId);
    console.log("\n特殊格：");
    for (const t of portals) {
      console.log(`  (${t.x},${t.y}) type=${t.type} portalId=${t.portalId ?? "-"} name=${t.portalName ?? "-"} target=${t.portalTargetMapId ?? "-"} event=${t.eventId ?? "-"} 可走=${isWalkable(t)}`);
    }

    // 连通分量
    const walkable = new Set(tiles.filter(isWalkable).map((t) => `${t.x},${t.y}`));
    const seen = new Set<string>();
    const comps: Array<Set<string>> = [];
    for (const key of walkable) {
      if (seen.has(key)) continue;
      const comp = new Set<string>();
      const queue = [key];
      seen.add(key);
      while (queue.length > 0) {
        const [x, y] = (queue.shift() as string).split(",").map(Number);
        comp.add(`${x},${y}`);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const k = `${x + dx},${y + dy}`;
          if (walkable.has(k) && !seen.has(k)) { seen.add(k); queue.push(k); }
        }
      }
      comps.push(comp);
    }
    console.log(`\n连通区域 ${comps.length} 块：` + comps.map((c) => c.size).sort((a, b) => b - a).join(" / "));
    for (const t of portals) {
      const comp = comps.find((c) => c.has(`${t.x},${t.y}`));
      console.log(`  传送门(${t.x},${t.y}) ${t.portalName ?? ""} 所在连通块大小=${comp ? comp.size : "不在可走区域"}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", String(e)); process.exit(1); });
