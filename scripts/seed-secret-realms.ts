/**
 * 秘境扩充 —— 先补「分类维度」，再谈条数。
 *
 * 复核发现代码里定义了 5 个维度（现世方式 / 规模 / 稀有度 / 特殊类型 / 生成来源），
 * 但库里每个维度都只填了一部分：
 *   规模    small + large，缺 medium
 *   稀有度  rare + legendary，缺 common / epic（rare 到 legendary 中间断档）
 *   境界    两个模板 recommended_realm 都是 1
 *   来源    全是 fallback，AI 一次没成功过
 *
 * 本脚本补齐 medium 规模、common / epic 稀有度，并把推荐境界铺到练气→元婴，
 * 让「这次进去的是哪一种秘境」这件事有区分度。
 *
 * 生成走服务自带的 fallback 生成器（`forceFallback: true`，不依赖 LLM），
 * 因为它已经内建了地块生成 + 奖励计划 + 校验。生成后：
 *   1. 重命名为设定好的名字/主题/首领（fallback 的名字是随机拼的，不合设定）
 *   2. 若校验不通过（多半是孤立可通行格），填死孤岛后复验
 *   3. 仍不通过就再生成一次，最多重试 5 次
 *
 * 用法：
 *   bun run scripts/seed-secret-realms.ts --apply
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { secretRealmTemplates } from "@/db/schema";
import type { SecretRealmTemplateSnapshot } from "@/types/game";
import { generateSecretRealmTemplate } from "@/modules/map/services/secret-realm-generation-service";
import { validateSecretRealmSnapshot } from "@/modules/map/services/secret-realm-balance-service";

type Tile = { x: number; y: number; type: string; walkable: boolean };
type Point = { x: number; y: number };
type Snapshot = {
  width: number;
  height: number;
  entryPoint: Point;
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
    if (visited.has(key(cur))) continue;
    visited.add(key(cur));
    for (const next of [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]) {
      if (next.x < 0 || next.y < 0 || next.x >= snapshot.width || next.y >= snapshot.height) continue;
      if (visited.has(key(next))) continue;
      if (!isWalkable(tileMap.get(key(next)))) continue;
      queue.push(next);
    }
  }
  return visited;
}

/**
 * 修连通性：优先「挖通」而不是「填死」。
 *
 * 大地图上孤岛往往很大，全填掉会把阻塞率顶穿合法上限（large 上限 0.7），
 * 所以这里从孤岛朝主区挖一条最短通道（允许凿穿阻挡格）。
 * 挖通会降低阻塞率，若跌破下限再挑死胡同格补回来 —— 死胡同只有一个邻居，
 * 填掉它不影响任何连通性。
 */
function fixConnectivity(snapshot: Snapshot, minBlockedRatio: number): Snapshot {
  const tiles = new Map<string, Tile>();
  for (const tile of snapshot.tilesData) tiles.set(key(tile), { ...tile });

  const inBounds = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < snapshot.width && p.y < snapshot.height;
  const neighborsOf = (p: Point) => [
    { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 },
  ].filter(inBounds);

  let reachable = reachableFrom({ ...snapshot, tilesData: [...tiles.values()] }, snapshot.entryPoint);

  // 反复挖：每次处理当前最大的一个孤岛，直到没有孤岛
  for (let guard = 0; guard < 40; guard += 1) {
    const orphans = [...tiles.values()].filter((t) => isWalkable(t) && !reachable.has(key(t)));
    if (orphans.length === 0) break;

    // 多源 BFS：从孤岛出发，允许穿阻挡格，找到最近的主区点并回溯路径
    const prev = new Map<string, string>();
    const queue: Point[] = orphans.map((t) => ({ x: t.x, y: t.y }));
    const seen = new Set<string>(queue.map(key));
    let hit: string | null = null;
    while (queue.length > 0 && !hit) {
      const cur = queue.shift() as Point;
      for (const next of neighborsOf(cur)) {
        const nk = key(next);
        if (seen.has(nk)) continue;
        seen.add(nk);
        prev.set(nk, key(cur));
        if (reachable.has(nk)) { hit = nk; break; }
        queue.push(next);
      }
    }
    if (!hit) break; // 理论上不会发生（地图有限且主区非空）

    // 回溯路径，把路径上的阻挡格凿开
    let cursor: string | undefined = hit;
    while (cursor && !orphans.some((t) => key(t) === cursor)) {
      const tile = tiles.get(cursor);
      if (tile && !isWalkable(tile)) {
        tiles.set(cursor, { ...tile, type: "forest", walkable: true });
      }
      cursor = prev.get(cursor);
    }

    reachable = reachableFrom({ ...snapshot, tilesData: [...tiles.values()] }, snapshot.entryPoint);
  }

  // 挖通后若阻塞率跌破下限，用死胡同格补回来
  const total = Math.max(1, snapshot.width * snapshot.height);
  const blockedRatioOf = (list: Tile[]) => list.filter((t) => !isWalkable(t)).length / total;
  let list = [...tiles.values()];
  if (blockedRatioOf(list) < minBlockedRatio) {
    const deadEnds = list.filter((t) => {
      if (!isWalkable(t)) return false;
      if (key(t) === key(snapshot.entryPoint)) return false;
      return neighborsOf(t).filter((n) => isWalkable(tiles.get(key(n)))).length <= 1;
    });
    for (const tile of deadEnds) {
      if (blockedRatioOf(list) >= minBlockedRatio) break;
      tiles.set(key(tile), { ...tile, type: "mountain", walkable: false });
      list = [...tiles.values()];
    }
  }

  return { ...snapshot, tilesData: [...tiles.values()] };
}

interface RealmBlueprint {
  sizeTier: "small" | "medium" | "large";
  rarity: "common" | "rare" | "epic" | "legendary";
  recommendedRealm: number;
  name: string;
  theme: string;
  description: string;
  bossName: string;
  bossBackground: string;
}

const BLUEPRINTS: RealmBlueprint[] = [
  {
    sizeTier: "small", rarity: "common", recommendedRealm: 4,
    name: "毒瘴泥沼", theme: "黑松林泥沼",
    description: "松林深处的一片死水，终年冒着瘴气。林子里的人说：进去的猪没回来过，回来的都不是猪了。",
    bossName: "瘴母",
    bossBackground: "一团泡在泥里的东西，靠吸瘴气活着。它不一定是死的，也不一定是活的。",
  },
  {
    sizeTier: "medium", rarity: "common", recommendedRealm: 2,
    name: "石磨旧窑", theme: "青石里废窑",
    description: "废弃多年的陶窑，窑火早熄。村里孩子赌胆子才往里钻，钻进去的都说听见有人在拉风箱。",
    bossName: "窑灵",
    bossBackground: "烧窑人死在窑里，魂跟着最后一窑没能出窑的陶器一起封在了里头。",
  },
  {
    sizeTier: "medium", rarity: "rare", recommendedRealm: 13,
    name: "断碑荒冢", theme: "太行山碑冢",
    description: "半截石碑立在乱葬岗上，碑文被人凿去了。太行山的猎户绕着走，不是怕鬼，是怕读那段被凿掉的字。",
    bossName: "碑下尸将",
    bossBackground: "碑下埋的是个将军，被自己人凿了碑名。他站起来不为报仇，只为问一句为什么。",
  },
  {
    sizeTier: "medium", rarity: "epic", recommendedRealm: 15,
    name: "焚窑余烬", theme: "地火谷焚窑",
    description: "火脉旁的一座古窑，烧的不是陶，是铁。窑壁上还留着一代代匠人的手印，最上面那层是新的。",
    bossName: "余烬魔匠",
    bossBackground: "他把自己烧进了窑里，从此每一件出窑的兵器都带一点他的神智。",
  },
  {
    sizeTier: "large", rarity: "epic", recommendedRealm: 18,
    name: "沉雾古渡", theme: "雾海泽古渡",
    description: "雾里露出半截码头，缆绳还系在桩上，船却一条都不剩。雾海泽的人说，渡口还在等船。",
    bossName: "沉雾渡魂",
    bossBackground: "摆渡的等不到船，就自己变成了船。它载你过去，代价是你留下。",
  },
  {
    sizeTier: "large", rarity: "legendary", recommendedRealm: 22,
    name: "天裂残域", theme: "裂天墟残域",
    description: "天裂开又合上，合不严的地方留下这片残域。地上的石头都朝着一个方向倒，像是在躲什么。",
    bossName: "裂天残将",
    bossBackground: "当年守裂口的将领，天合了他没走。他还站在那儿，只是盔里已经没有人。",
  },
];

async function buildOne(bp: RealmBlueprint) {
  let lastReasons: string[] = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const record = await generateSecretRealmTemplate({
      recommendedRealm: bp.recommendedRealm,
      sizeTier: bp.sizeTier,
      rarity: bp.rarity,
      forceFallback: true,
    });

    const raw = await db.query.secretRealmTemplates.findFirst({
      where: eq(secretRealmTemplates.id, record.id),
    });
    if (!raw) continue;

    const snapshot = raw.snapshotJson as unknown as Snapshot;
    const sizeMin = bp.sizeTier === "large" ? 0.45 : bp.sizeTier === "medium" ? 0.4 : 0.36;
    let fixed = snapshot;
    let report = validateSecretRealmSnapshot(fixed as never, "fallback");
    if (!report.passed) {
      fixed = fixConnectivity(snapshot, sizeMin);
      report = validateSecretRealmSnapshot(fixed as never, "fallback");
    }
    if (!report.passed) {
      // 这一次生成的地块本身不合格，删掉重来
      lastReasons = report.reasons;
      await db.delete(secretRealmTemplates).where(eq(secretRealmTemplates.id, record.id)).run();
      continue;
    }

    await db.update(secretRealmTemplates).set({
      name: bp.name,
      description: bp.description,
      announcement: `${bp.name}现世，${bp.theme}方向气机翻涌，疑有异宝出世。`,
      theme: bp.theme,
      bossBackground: bp.bossBackground,
      bossPool: [bp.bossName],
      snapshotJson: fixed as unknown as SecretRealmTemplateSnapshot,
      validationReport: report,
      updatedAt: new Date().toISOString(),
    }).where(eq(secretRealmTemplates.id, record.id)).run();

    return { bp, passed: true, attempts: attempt, width: fixed.width, height: fixed.height, blocked: report.blockedRatio };
  }
  return { bp, passed: false, attempts: 5, width: 0, height: 0, blocked: 0, reasons: lastReasons };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("将新增秘境模板：");
    for (const bp of BLUEPRINTS) {
      console.log(`  [${bp.sizeTier}/${bp.rarity}] 境界${bp.recommendedRealm} ${bp.name}（${bp.theme}）首领：${bp.bossName}`);
    }
    console.log("  …（加 --apply 生成并写入）");
    return;
  }

  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
  for (const bp of BLUEPRINTS) {
    if (only && bp.name !== only) continue;
    const result = await buildOne(bp);
    if (result.passed) {
      console.log(`[ok] ${result.bp.name} ${result.width}x${result.height} 阻塞率${result.blocked.toFixed(3)}（第 ${result.attempts} 次生成通过）`);
    } else {
      console.log(`[失败] ${bp.name} 重试 ${result.attempts} 次仍未通过，最后原因：${JSON.stringify(result.reasons)}`);
    }
  }
  console.log("完成");
}

void main();
