/** 扫描所有 NPC：是否存在切比雪夫距离 ≤1 的可通行站位（没有 = 结构性不可达） */
import { getFourRealmsPack } from "@/db/offline-packs/four-realms-pack";

function main() {
  const pack = getFourRealmsPack();
  const tileMap = new Map<string, { walkable: boolean; type: string }>();
  for (const m of pack.maps) {
    for (const t of m.tilesData ?? []) {
      tileMap.set(`${m.id}:${t.x}:${t.y}`, { walkable: t.walkable !== false, type: t.type });
    }
  }

  const bad: string[] = [];
  for (const n of pack.npcs) {
    let reachableCount = 0;
    const neighborTypes = new Set<string>();
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const t = tileMap.get(`${n.mapId}:${n.positionX + dx}:${n.positionY + dy}`);
        if (!t) continue;
        neighborTypes.add(`${t.type}${t.walkable ? "" : "(不可走)"}`);
        if (t.walkable) reachableCount += 1;
      }
    }
    if (reachableCount === 0) {
      bad.push(`${n.name}(${n.mapId} @${n.positionX},${n.positionY}) ← 邻居: ${[...neighborTypes].join(",")}`);
    }
  }

  console.log(`共 ${pack.npcs.length} 个 NPC，结构性不可达 ${bad.length} 个：`);
  for (const line of bad) console.log(`  ✗ ${line}`);
  if (bad.length === 0) console.log("  全部可达");
}

main();
