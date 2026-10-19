import { and, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bossInstances,
  mapInstanceMembers,
  mapInstanceMonsters,
  mapInstances,
  maps,
  playerInventory,
  players,
  secretRealmRewardClaims,
  secretRealmRuns,
  secretRealmSpawns,
  secretRealmTemplates,
  temporaryMaps,
  temporaryMonsters,
} from "@/db/schema";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import { getPlayerCosmeticMapByIds } from "@/modules/character/services/player-cosmetic-profile";
import {
  publishMapPresencePlayerPosition,
  publishMapRefresh,
} from "@/modules/map/services/map-presence";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { getPortalTileAt } from "@/modules/map/services/map-portal";
import {
  SECRET_REALM_INSTANCE_LIFETIME_MS,
  SECRET_REALM_SETTLE_LIFETIME_MS,
  listReachablePoints,
  normalizeSecretRealmRarity,
  normalizeSecretRealmSizeTier,
  randomInt,
} from "@/modules/map/services/secret-realm-balance-service";
import { buildSecretRealmDropIntel } from "@/modules/map/services/secret-realm-drop-intel";
import { buildSecretRealmLootBlueprint } from "@/modules/map/services/secret-realm-drop-generation-service";
import {
  createInitialSecretRealmBossGateStatus,
  isSecretRealmBossGateGuard,
  normalizeSecretRealmBossGateStatus,
  resolveSecretRealmBossGateRule,
  unlockSecretRealmBossGateDoors,
} from "@/modules/map/services/secret-realm-boss-gate-service";
import { insertMapInstanceMonsterCompat } from "@/modules/map/services/map-instance-monster-schema-compat";
import {
  HONGMENG_BOTTLE_ITEM_ID,
  WILD_WOLF_VALLEY_INSTANCE_LIFETIME_MS,
  getWildWolfValleyBottleChance,
  getSecretRealmSpecialHint,
  resolveSecretRealmSpecialType,
} from "@/modules/map/services/secret-realm-specials";
import {
  buildSecretRealmSeedFocusView,
  buildSecretRealmThemeProfile,
} from "@/modules/map/services/secret-realm-theme-profile-service";
import type { SecretRealmCurrentView } from "@/modules/map/services/secret-realm-types";
import { isSecretRealmMapType } from "@/modules/map/services/secret-realm-types";
import {
  incrementSecretRealmPityCounter,
  markSecretRealmSpawnCompleted,
  markSecretRealmSpawnEntered,
} from "@/modules/map/services/secret-realm-spawn-service";
import {
  getRuntimeMonsterById,
  pickTemporaryMonsterIconUrl,
} from "@/modules/map/services/runtime-monster-store";
import { clearMonsterAiRuntimeForMap, clearMonsterAiRuntimeForMonsters } from "@/modules/map/services/monster-ai";
import { resetRepeatKillGuard } from "@/modules/combat/services/repeat-kill-guard";
import {
  advanceMapSceneTick,
  ensureMapSceneTick,
  resetMapClientSequence,
} from "@/modules/map/services/map-scene-sync";
import { getPartyMovementContext } from "@/modules/social/infrastructure/party-service";
import type {
  SecretRealmBossGateStatus,
  SecretRealmRewardClaim,
  SecretRealmMonsterPlan,
  SecretRealmPoint,
  SecretRealmRunSummary,
  SecretRealmTemplateSnapshot,
  TileData,
} from "@/types/game";

type PlayerRow = typeof players.$inferSelect;
type SecretRealmTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SecretRealmConsolationDrop = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  quantity: number;
};

type SecretRealmMonsterRuntime = {
  instanceId: string;
  mapId: string;
  role: SecretRealmMonsterPlan["role"];
  monsterStatus: string;
  instanceStatus: string;
  runId: string | null;
};

type SecretRealmMonsterFlavor = {
  name: string;
  labels: string[];
  description: string;
  statMultiplier: {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
  };
};

export type SecretRealmRuntimeCleanupResult = {
  cleanedInstanceCount: number;
  cleanedMonsterCount: number;
  cleanedMapCount: number;
  cleanedRunCount: number;
  cleanedMemberCount: number;
  cleanedLinkMonsterCount: number;
};

type SecretRealmEvacuationMember = {
  playerId: string;
  name: string | null;
  gender: PlayerRow["gender"];
  realm: number;
  realmMajor: number;
  realmMinor: number;
  realmName: string | null;
  returnMapId: string | null;
  returnPositionX: number | null;
  returnPositionY: number | null;
};

type SecretRealmPlayerReturnResult = {
  mapId: string | null;
  positionX: number;
  positionY: number;
  repairedStaleReference?: boolean;
  previousMapId?: string | null;
  alreadyLeft?: boolean;
};

function createEmptySecretRealmCleanupResult(): SecretRealmRuntimeCleanupResult {
  return {
    cleanedInstanceCount: 0,
    cleanedMonsterCount: 0,
    cleanedMapCount: 0,
    cleanedRunCount: 0,
    cleanedMemberCount: 0,
    cleanedLinkMonsterCount: 0,
  };
}

function mergeSecretRealmCleanupResult(
  target: SecretRealmRuntimeCleanupResult,
  partial?: Partial<SecretRealmRuntimeCleanupResult> | null,
) {
  if (!partial) {
    return target;
  }

  target.cleanedInstanceCount += partial.cleanedInstanceCount || 0;
  target.cleanedMonsterCount += partial.cleanedMonsterCount || 0;
  target.cleanedMapCount += partial.cleanedMapCount || 0;
  target.cleanedRunCount += partial.cleanedRunCount || 0;
  target.cleanedMemberCount += partial.cleanedMemberCount || 0;
  target.cleanedLinkMonsterCount += partial.cleanedLinkMonsterCount || 0;
  return target;
}

type SecretRealmCleanupResult = {
  cleanedInstanceCount: number;
  cleanedMonsterCount: number;
  cleanedMapCount: number;
  cleanedBrokenInstanceCount: number;
  cleanedOrphanMonsterCount: number;
  cleanedOrphanMapCount: number;
  cleanedOrphanRunCount: number;
  cleanedOrphanInstanceMonsterCount: number;
};

const SECRET_REALM_RUNTIME_ORPHAN_GRACE_MS = 10 * 60 * 1000;

function toExpiryIso(durationMs: number) {
  return new Date(Date.now() + durationMs).toISOString();
}

function resolveSecretRealmInstanceLifetimeMs(params: {
  specialType: ReturnType<typeof resolveSecretRealmSpecialType>;
}) {
  if (params.specialType === "wild_wolf_valley") {
    return WILD_WOLF_VALLEY_INSTANCE_LIFETIME_MS;
  }
  return SECRET_REALM_INSTANCE_LIFETIME_MS;
}

function truncateDisplayText(value: string, maxLength: number) {
  return Array.from(value.trim()).slice(0, maxLength).join("");
}

function buildSecretRealmMonsterThemeCore(theme: string) {
  const normalized = truncateDisplayText(theme.replace(/\s+/g, ""), 2);
  return normalized || "秘境";
}

function clampSecretRealmMonsterName(name: string) {
  const normalized = truncateDisplayText(name.replace(/\s+/g, ""), 6);
  return normalized || "秘境妖";
}

function pickByIndex<T>(values: T[], index: number) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("pickByIndex requires non-empty values");
  }
  const normalizedIndex = Math.abs(Math.trunc(index)) % values.length;
  return values[normalizedIndex] as T;
}

function normalizeMonsterThemeFamily(theme: string) {
  const profile = buildSecretRealmThemeProfile(theme);
  if (profile.themeTags.includes("荒林")) {
    return "forest" as const;
  }
  if (profile.themeTags.includes("药气")) {
    return "pill" as const;
  }
  if (profile.themeTags.includes("矿脉")) {
    return "ore" as const;
  }
  if (profile.themeTags.includes("残煞")) {
    return "blight" as const;
  }
  return "default" as const;
}

function buildSecretRealmMonsterFlavor(params: {
  theme: string;
  rarity: string;
  role: SecretRealmMonsterPlan["role"];
  index: number;
  bossPool: string[];
}) : SecretRealmMonsterFlavor {
  const themeCore = buildSecretRealmMonsterThemeCore(params.theme);
  const family = normalizeMonsterThemeFamily(params.theme);
  const rarityOffset = params.rarity === "legendary"
    ? 3
    : params.rarity === "epic"
      ? 2
      : params.rarity === "rare"
        ? 1
        : 0;
  const pickIndex = params.index + themeCore.length + rarityOffset;

  const familyConfig = family === "forest"
    ? {
      normalSuffixes: ["藤妖", "木魅", "苔灵", "雾狼", "花魈"],
      elitePrefixes: ["厉", "玄", "鬼", "毒"],
      eliteSuffixes: ["木魅", "藤妖", "雾狼", "花魈"],
      bossFallbacks: ["木君", "藤王", "雾主", "妖主"],
      labels: ["荒林", "木脉"],
      description: "受林瘴与草木灵机侵染，行迹飘忽，常借藤影袭人。",
      statMultiplier: { hp: 0.97, attack: 1.02, defense: 0.96, speed: 1.12 },
      guardNames: ["锁藤卫", "镇枝卫", "封脉卫"],
      guardDescription: "木脉阵纹盘绕其躯，若不先诛，深处封印便难松动。",
    }
    : family === "pill"
      ? {
        normalSuffixes: ["药傀", "泉灵", "丹魄", "露妖", "水魅"],
        elitePrefixes: ["异", "玄", "厉", "蛊"],
        eliteSuffixes: ["药傀", "丹魄", "泉灵", "水魅"],
        bossFallbacks: ["药主", "丹灵", "泉君", "瘴母"],
        labels: ["药气", "丹瘴"],
        description: "丹炉余烬与泉脉药气化妖成形，出手绵密，久战最磨人。",
        statMultiplier: { hp: 1.01, attack: 0.98, defense: 1.02, speed: 1.04 },
        guardNames: ["锁泉卫", "镇丹卫", "封药卫"],
        guardDescription: "药气阵眼寄于其身，若不先斩，Boss 封界仍会闭合不散。",
      }
      : family === "ore"
        ? {
          normalSuffixes: ["石魈", "矿傀", "火奴", "铁卫", "砂灵"],
          elitePrefixes: ["鎏", "裂", "熔", "玄"],
          eliteSuffixes: ["矿傀", "石魈", "火奴", "铁卫"],
          bossFallbacks: ["石君", "矿王", "火将", "古卫"],
          labels: ["矿脉", "器坊"],
          description: "岩火、矿髓与旧器残意纠缠不散，身躯厚重，最擅正面强压。",
          statMultiplier: { hp: 1.11, attack: 1.02, defense: 1.13, speed: 0.92 },
          guardNames: ["锁阵卫", "镇关卫", "封碑卫"],
          guardDescription: "此獠执掌矿脉阵眼，甲壳沉重，未尽诛绝前封门不会松开。",
        }
        : family === "blight"
          ? {
            normalSuffixes: ["尸傀", "瘴灵", "碑魇", "怨魂", "骨妖"],
            elitePrefixes: ["厉", "噬", "幽", "厄"],
            eliteSuffixes: ["尸傀", "瘴灵", "碑魇", "怨魂"],
            bossFallbacks: ["尸王", "瘴主", "碑君", "鬼母"],
            labels: ["残煞", "尸瘴"],
            description: "旧禁制与死煞久积成灾，气息阴冷，常以狠厉手段先发制人。",
            statMultiplier: { hp: 1.03, attack: 1.12, defense: 0.95, speed: 1.01 },
            guardNames: ["锁煞卫", "镇尸卫", "封魇卫"],
            guardDescription: "死煞阵纹与其魂核勾连，不先毁去，封印便会反复聚合。",
          }
          : {
            normalSuffixes: ["妖灵", "魇灵", "巡煞", "山魈", "影魅"],
            elitePrefixes: ["异", "厉", "玄", "魁"],
            eliteSuffixes: ["妖灵", "巡煞", "影魅", "山魈"],
            bossFallbacks: ["妖主", "魇王", "煞君", "古主"],
            labels: ["秘境", "异种"],
            description: "受秘境乱流滋养的异种，形态难定，胜在诡变多端。",
            statMultiplier: { hp: 1, attack: 1, defense: 1, speed: 1 },
            guardNames: ["封印卫", "镇关卫", "锁阵卫"],
            guardDescription: "此獠执掌封印阵眼，未尽诛绝前，Boss 结界不会散去。",
          };

  if (params.role === "boss") {
    return {
      name: clampSecretRealmMonsterName(params.bossPool[0] || `${themeCore}${pickByIndex(familyConfig.bossFallbacks, pickIndex)}`),
      labels: [...familyConfig.labels, "首领"],
      description: `${familyConfig.description}${params.bossPool[0] ? " 它已将整座秘境的煞气尽数攫为己用。" : " 它盘踞深处，已成此境真正的祸首。"}`
        .slice(0, 60),
      statMultiplier: {
        hp: Math.max(1, familyConfig.statMultiplier.hp + 0.08),
        attack: Math.max(1, familyConfig.statMultiplier.attack + 0.1),
        defense: Math.max(1, familyConfig.statMultiplier.defense + 0.08),
        speed: Math.max(0.92, familyConfig.statMultiplier.speed),
      },
    };
  }

  if (params.role === "elite") {
    const elitePrefix = pickByIndex(familyConfig.elitePrefixes, pickIndex);
    const eliteSuffix = pickByIndex(familyConfig.eliteSuffixes, pickIndex + 1);
    return {
      name: clampSecretRealmMonsterName(`${elitePrefix}${themeCore}${eliteSuffix}`),
      labels: [...familyConfig.labels, "精英"],
      description: `${familyConfig.description} 它在群怪中最先成势，身上已凝出异化征兆。`.slice(0, 60),
      statMultiplier: {
        hp: Math.max(0.96, familyConfig.statMultiplier.hp + 0.04),
        attack: Math.max(0.96, familyConfig.statMultiplier.attack + 0.05),
        defense: Math.max(0.96, familyConfig.statMultiplier.defense + 0.05),
        speed: Math.max(0.9, familyConfig.statMultiplier.speed + 0.02),
      },
    };
  }

  return {
    name: clampSecretRealmMonsterName(`${themeCore}${pickByIndex(familyConfig.normalSuffixes, pickIndex)}`),
    labels: [...familyConfig.labels, "杂兵"],
    description: familyConfig.description,
    statMultiplier: familyConfig.statMultiplier,
  };
}

function buildSecretRealmBossGateGuardFlavor(params: {
  theme: string;
  index: number;
}) : SecretRealmMonsterFlavor {
  const themeCore = buildSecretRealmMonsterThemeCore(params.theme);
  const family = normalizeMonsterThemeFamily(params.theme);
  const pickIndex = params.index + themeCore.length;
  const familyConfig = buildSecretRealmMonsterFlavor({
    theme: params.theme,
    rarity: "rare",
    role: "elite",
    index: params.index,
    bossPool: [],
  });

  const guardPool = family === "forest"
    ? ["锁藤卫", "镇枝卫", "封脉卫"]
    : family === "pill"
      ? ["锁泉卫", "镇丹卫", "封药卫"]
      : family === "ore"
        ? ["锁阵卫", "镇关卫", "封碑卫"]
        : family === "blight"
          ? ["锁煞卫", "镇尸卫", "封魇卫"]
          : ["封印卫", "镇关卫", "锁阵卫"];

  const guardDescription = family === "forest"
    ? "木脉阵纹盘绕其躯，若不先诛，深处封印便难松动。"
    : family === "pill"
      ? "药气阵眼寄于其身，若不先斩，Boss 封界仍会闭合不散。"
      : family === "ore"
        ? "此獠执掌矿脉阵眼，甲壳沉重，未尽诛绝前封门不会松开。"
        : family === "blight"
          ? "死煞阵纹与其魂核勾连，不先毁去，封印便会反复聚合。"
          : "此獠执掌封印阵眼，未尽诛绝前，Boss 结界不会散去。";

  return {
    name: clampSecretRealmMonsterName(pickByIndex(guardPool, pickIndex) || `${themeCore}卫`),
    labels: [...familyConfig.labels.filter((label) => label !== "精英"), "封印守卫"],
    description: guardDescription,
    statMultiplier: {
      hp: Math.max(1, familyConfig.statMultiplier.hp + 0.06),
      attack: Math.max(1, familyConfig.statMultiplier.attack + 0.04),
      defense: Math.max(1, familyConfig.statMultiplier.defense + 0.08),
      speed: Math.max(0.9, familyConfig.statMultiplier.speed),
    },
  };
}

function applySecretRealmMonsterFlavorStats(params: {
  baseStats: ReturnType<typeof scaleMonsterStats>;
  flavor: SecretRealmMonsterFlavor;
}) {
  return {
    hp: Math.max(1, Math.round(params.baseStats.hp * params.flavor.statMultiplier.hp)),
    attack: Math.max(1, Math.round(params.baseStats.attack * params.flavor.statMultiplier.attack)),
    defense: Math.max(1, Math.round(params.baseStats.defense * params.flavor.statMultiplier.defense)),
    speed: Math.max(1, Math.round(params.baseStats.speed * params.flavor.statMultiplier.speed)),
    level: params.baseStats.level,
  };
}

function buildPointKey(point: SecretRealmPoint | TileData) {
  return `${point.x},${point.y}`;
}

function buildTileMap(tilesData: TileData[]) {
  return new Map(tilesData.map((tile) => [buildPointKey(tile), tile]));
}

function isWalkableTile(tile: TileData | undefined) {
  return tile?.walkable !== false;
}

function getOrthogonalNeighbors(point: SecretRealmPoint, width: number, height: number) {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ].filter((candidate) => (
    candidate.x >= 0
    && candidate.x < width
    && candidate.y >= 0
    && candidate.y < height
  ));
}

function getSurroundingNeighbors(point: SecretRealmPoint, width: number, height: number) {
  const candidates: SecretRealmPoint[] = [];
  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) {
        continue;
      }
      const nextPoint = {
        x: point.x + deltaX,
        y: point.y + deltaY,
      };
      if (
        nextPoint.x < 0
        || nextPoint.x >= width
        || nextPoint.y < 0
        || nextPoint.y >= height
      ) {
        continue;
      }
      candidates.push(nextPoint);
    }
  }
  return candidates;
}

function getPointDistance(left: SecretRealmPoint, right: SecretRealmPoint) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function buildShortestWalkablePath(snapshot: {
  width: number;
  height: number;
  tilesData: TileData[];
}, start: SecretRealmPoint, target: SecretRealmPoint) {
  const tileMap = buildTileMap(snapshot.tilesData);
  if (!isWalkableTile(tileMap.get(buildPointKey(start))) || !isWalkableTile(tileMap.get(buildPointKey(target)))) {
    return [] as SecretRealmPoint[];
  }

  const queue: SecretRealmPoint[] = [start];
  const visited = new Set<string>([buildPointKey(start)]);
  const previous = new Map<string, SecretRealmPoint | null>([[buildPointKey(start), null]]);

  while (queue.length > 0) {
    const current = queue.shift() as SecretRealmPoint;
    if (current.x === target.x && current.y === target.y) {
      break;
    }

    for (const next of getOrthogonalNeighbors(current, snapshot.width, snapshot.height)) {
      const key = buildPointKey(next);
      if (visited.has(key) || !isWalkableTile(tileMap.get(key))) {
        continue;
      }
      visited.add(key);
      previous.set(key, current);
      queue.push(next);
    }
  }

  const targetKey = buildPointKey(target);
  if (!previous.has(targetKey)) {
    return [];
  }

  const path: SecretRealmPoint[] = [];
  let cursor: SecretRealmPoint | null = target;
  while (cursor) {
    path.push(cursor);
    cursor = previous.get(buildPointKey(cursor)) || null;
  }
  return path.reverse();
}

function pickBossGateGuardPoints(params: {
  candidatePoints: SecretRealmPoint[];
  mainPath: SecretRealmPoint[];
  entryPoint: SecretRealmPoint;
  bossPoint: SecretRealmPoint;
  count: number;
}) {
  const available = [...params.candidatePoints];
  const selected: SecretRealmPoint[] = [];
  const fractions = Array.from({ length: params.count }, (_, index) => ((index + 1) / (params.count + 1)));

  for (const fraction of fractions) {
    const targetIndex = Math.min(
      Math.max(1, Math.round((params.mainPath.length - 2) * fraction)),
      Math.max(1, params.mainPath.length - 2),
    );
    const anchor = params.mainPath[targetIndex] || params.mainPath[Math.max(1, params.mainPath.length - 2)] || params.entryPoint;
    let pickedIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index] as SecretRealmPoint;
      const entryDistance = getPointDistance(candidate, params.entryPoint);
      const bossDistance = getPointDistance(candidate, params.bossPoint);
      if (entryDistance < 4 || bossDistance < 3) {
        continue;
      }
      const score = getPointDistance(candidate, anchor) + (selected.some((point) => getPointDistance(point, candidate) < 4) ? 20 : 0);
      if (score < bestScore) {
        bestScore = score;
        pickedIndex = index;
      }
    }

    if (pickedIndex >= 0) {
      selected.push(available.splice(pickedIndex, 1)[0] as SecretRealmPoint);
    }
  }

  while (selected.length < params.count && available.length > 0) {
    const fallbackIndex = available.findIndex((candidate) => (
      getPointDistance(candidate, params.entryPoint) >= 4
      && getPointDistance(candidate, params.bossPoint) >= 3
      && !selected.some((point) => getPointDistance(point, candidate) < 4)
    ));
    if (fallbackIndex < 0) {
      break;
    }
    selected.push(available.splice(fallbackIndex, 1)[0] as SecretRealmPoint);
  }

  return {
    selected,
    remainingCandidates: available,
  };
}

function applyBossGateSeal(params: {
  snapshot: {
    width: number;
    height: number;
    bossPoint: SecretRealmPoint;
    entryPoint: SecretRealmPoint;
    tilesData: TileData[];
  };
}) {
  const mainPath = buildShortestWalkablePath(params.snapshot, params.snapshot.entryPoint, params.snapshot.bossPoint);
  const tileMap = buildTileMap(params.snapshot.tilesData);
  let sealedDoorTiles = getSurroundingNeighbors(params.snapshot.bossPoint, params.snapshot.width, params.snapshot.height)
    .map((point) => tileMap.get(buildPointKey(point)) || null)
    .filter((tile): tile is TileData => tile !== null && tile.walkable !== false)
    .map((tile) => ({ ...tile }));

  if (sealedDoorTiles.length === 0 && mainPath.length >= 2) {
    const fallbackDoor = tileMap.get(buildPointKey(mainPath[mainPath.length - 2] as SecretRealmPoint));
    if (fallbackDoor && fallbackDoor.walkable !== false) {
      sealedDoorTiles = [{ ...fallbackDoor }];
    }
  }

  const sealedKeys = new Set(sealedDoorTiles.map((tile) => buildPointKey(tile)));
  const tilesData = params.snapshot.tilesData.map((tile) => {
    if (!sealedKeys.has(buildPointKey(tile))) {
      return tile;
    }
    return {
      ...tile,
      walkable: false,
      description: "Boss 封印未破，暂不可入内。",
    };
  });

  return {
    mainPath,
    sealedDoorTiles,
    tilesData,
  };
}

function parseIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function isOlderThan(value: string | null | undefined, cutoffMs: number) {
  const parsed = parseIsoTimestamp(value);
  return Number.isFinite(parsed) && parsed <= cutoffMs;
}

function normalizeSecretRealmSnapshotForInstance(snapshot: SecretRealmTemplateSnapshot) {
  const reachablePoints = listReachablePoints(snapshot, snapshot.entryPoint);
  const reachableKeys = new Set(reachablePoints.map((point) => buildPointKey(point)));
  const requiredPointKeys = [
    buildPointKey(snapshot.entryPoint),
    buildPointKey(snapshot.returnPoint),
    buildPointKey(snapshot.bossPoint),
  ];

  if (requiredPointKeys.some((key) => !reachableKeys.has(key))) {
    throw new Error("秘境模板存在关键点不可达，无法创建实例");
  }

  return {
    reachablePoints,
    tilesData: snapshot.tilesData.map((tile) => (
      reachableKeys.has(buildPointKey(tile))
        ? tile
        : {
          ...tile,
          walkable: false,
        }
    )),
  };
}

async function lockSecretRealmSpawnTx(tx: SecretRealmTx, spawnId: string) {
  const rows = await tx.execute<{
    id: string;
    template_id: string;
    map_id: string;
    spawn_type: string;
    status: string;
    owner_player_id: string | null;
    visible_player_ids: string[] | null;
    position_x: number;
    position_y: number;
    instance_id: string | null;
  }>(sql`
    SELECT
      "id",
      "template_id",
      "map_id",
      "spawn_type",
      "status",
      "owner_player_id",
      "visible_player_ids",
      "position_x",
      "position_y",
      "instance_id"
    FROM "secret_realm_spawns"
    WHERE "id" = ${spawnId}
    FOR UPDATE
  `);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    templateId: row.template_id,
    mapId: row.map_id,
    spawnType: row.spawn_type,
    status: row.status,
    ownerPlayerId: row.owner_player_id,
    visiblePlayerIds: Array.isArray(row.visible_player_ids) ? row.visible_player_ids : [],
    positionX: Number(row.position_x || 0),
    positionY: Number(row.position_y || 0),
    instanceId: row.instance_id,
  };
}

function buildRealmPortalTiles(params: {
  snapshot: Pick<SecretRealmTemplateSnapshot, "returnPoint"> & {
    tilesData: TileData[];
  };
  sourceMapId: string;
  sourceMapName: string;
}) {
  return params.snapshot.tilesData.map((tile) => {
    if (tile.x === params.snapshot.returnPoint.x && tile.y === params.snapshot.returnPoint.y) {
      return {
        ...tile,
        type: "portal",
        walkable: true,
        portalId: "secret-realm-return",
        portalName: "回返阵",
        portalTargetMapId: params.sourceMapId,
        portalTargetPortalId: "",
        portalTargetName: params.sourceMapName,
      };
    }
    return tile;
  });
}

async function isPlayerStandingOnSecretRealmReturnPortal(params: {
  player: Pick<PlayerRow, "positionX" | "positionY">;
  instance: Pick<typeof mapInstances.$inferSelect, "mapId" | "returnPortalX" | "returnPortalY">;
}) {
  const playerX = Number(params.player.positionX);
  const playerY = Number(params.player.positionY);
  if (!Number.isFinite(playerX) || !Number.isFinite(playerY)) {
    return false;
  }

  if (
    playerX === Number(params.instance.returnPortalX)
    && playerY === Number(params.instance.returnPortalY)
  ) {
    return true;
  }

  const temporaryMap = await db.select({
    tilesData: temporaryMaps.tilesData,
  }).from(temporaryMaps).where(eq(temporaryMaps.id, params.instance.mapId)).get();

  if (!temporaryMap?.tilesData) {
    return false;
  }

  const currentTile = getPortalTileAt(temporaryMap.tilesData, playerX, playerY);
  if (!currentTile) {
    return false;
  }

  return currentTile.portalId === "secret-realm-return" || currentTile.portalName === "回返阵";
}

async function unlockSecretRealmBossGateDoorsTx(params: {
  tx: SecretRealmTx;
  mapId: string;
  bossGate: SecretRealmBossGateStatus | null;
  nowIso: string;
}) {
  const gate = normalizeSecretRealmBossGateStatus(params.bossGate);
  if (!gate?.isUnlocked) {
    return false;
  }

  const currentMap = await params.tx.select({
    tilesData: temporaryMaps.tilesData,
  }).from(temporaryMaps).where(eq(temporaryMaps.id, params.mapId)).get();
  if (!currentMap?.tilesData) {
    return false;
  }

  const restoredTiles = unlockSecretRealmBossGateDoors({
    tilesData: Array.isArray(currentMap.tilesData) ? currentMap.tilesData : [],
    gate,
  });

  await params.tx.update(temporaryMaps).set({
    tilesData: restoredTiles,
    updatedAt: params.nowIso,
  }).where(eq(temporaryMaps.id, params.mapId)).run();
  return true;
}

function scaleMonsterStats(params: {
  recommendedRealm: number;
  rarity: string;
  role: SecretRealmMonsterPlan["role"];
}) {
  const realmFactor = Math.max(1, params.recommendedRealm);
  const rarityFactor = params.rarity === "legendary"
    ? 1.6
    : params.rarity === "epic"
      ? 1.38
      : params.rarity === "rare"
        ? 1.16
        : 1;
  const roleFactor = params.role === "boss" ? 3.8 : params.role === "elite" ? 2.1 : 1;

  return {
    hp: Math.round((110 + realmFactor * 65) * rarityFactor * roleFactor),
    attack: Math.round((16 + realmFactor * 8) * rarityFactor * (params.role === "boss" ? 2.8 : params.role === "elite" ? 1.8 : 1.2)),
    defense: Math.round((10 + realmFactor * 6) * rarityFactor * (params.role === "boss" ? 2.6 : params.role === "elite" ? 1.7 : 1.1)),
    speed: Math.round((8 + realmFactor * 2) * (params.role === "boss" ? 1.2 : 1)),
    level: realmFactor,
  };
}

async function getSecretRealmMonsterRuntime(monsterId: string): Promise<SecretRealmMonsterRuntime | null> {
  const runtime = await db.select({
    instanceId: mapInstanceMonsters.instanceId,
    mapId: mapInstances.mapId,
    role: mapInstanceMonsters.role,
    monsterStatus: mapInstanceMonsters.status,
    instanceStatus: mapInstances.status,
    runId: secretRealmRuns.id,
  }).from(mapInstanceMonsters)
    .innerJoin(mapInstances, eq(mapInstances.id, mapInstanceMonsters.instanceId))
    .leftJoin(secretRealmRuns, eq(secretRealmRuns.instanceId, mapInstances.id))
    .where(eq(mapInstanceMonsters.monsterId, monsterId))
    .get();
  if (!runtime) {
    return null;
  }
  return {
    ...runtime,
    role: runtime.role as SecretRealmMonsterPlan["role"],
  };
}

async function getSecretRealmRunSummary(runId: string): Promise<SecretRealmRunSummary> {
  const row = await db.select({
    summaryJson: secretRealmRuns.summaryJson,
  }).from(secretRealmRuns).where(eq(secretRealmRuns.id, runId)).get();
  return (row?.summaryJson || {}) as SecretRealmRunSummary;
}

async function repairSecretRealmInstanceStatusIfNeeded(params: {
  instanceId: string;
  playerId?: string;
}) {
  const instance = await db.select()
    .from(mapInstances)
    .where(eq(mapInstances.id, params.instanceId))
    .get();
  if (!instance) {
    return null;
  }

  if (instance.status === "active") {
    return instance;
  }
  if (instance.completedAt || instance.status === "completed" || instance.status === "settling") {
    return instance;
  }

  const [activeMembers, playersInInstance] = await Promise.all([
    db.select({
      playerId: mapInstanceMembers.playerId,
    }).from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, params.instanceId),
      eq(mapInstanceMembers.status, "active"),
    )).all(),
    db.select({
      id: players.id,
    }).from(players).where(eq(players.currentMapInstanceId, params.instanceId)).all(),
  ]);

  const activePlayerIds = new Set<string>([
    ...activeMembers.map((row) => row.playerId),
    ...playersInInstance.map((row) => row.id),
  ]);

  if (params.playerId && !activePlayerIds.has(params.playerId)) {
    return instance;
  }
  if (activePlayerIds.size === 0) {
    return instance;
  }

  const nowIso = new Date().toISOString();
  await db.update(mapInstances).set({
    status: "active",
    expiresAt: toExpiryIso(SECRET_REALM_INSTANCE_LIFETIME_MS),
    updatedAt: nowIso,
  }).where(eq(mapInstances.id, params.instanceId)).run();

  return await db.select()
    .from(mapInstances)
    .where(eq(mapInstances.id, params.instanceId))
    .get();
}

async function createSecretRealmMapInstance(params: {
  spawn: typeof secretRealmSpawns.$inferSelect;
  template: typeof secretRealmTemplates.$inferSelect;
}) {
  const snapshot = params.template.snapshotJson as SecretRealmTemplateSnapshot;
  const normalizedSnapshot = normalizeSecretRealmSnapshotForInstance(snapshot);
  const instance = await db.transaction(async (tx) => {
    const lockedSpawn = await lockSecretRealmSpawnTx(tx, params.spawn.id);
    if (!lockedSpawn || lockedSpawn.status === "expired" || lockedSpawn.status === "completed") {
      throw new Error("秘境入口已消散");
    }

    const existingInstance = lockedSpawn.instanceId
      ? await tx.select().from(mapInstances).where(eq(mapInstances.id, lockedSpawn.instanceId)).get()
      : null;
    if (existingInstance?.status === "active") {
      return existingInstance;
    }

    const sourceMap = await tx.select({
      id: maps.id,
      name: maps.name,
    }).from(maps).where(eq(maps.id, lockedSpawn.mapId)).get();
    if (!sourceMap) {
      throw new Error("秘境来源地图不存在");
    }

    const specialType = resolveSecretRealmSpecialType({
      name: params.template.name,
      tags: params.template.tags,
    });
    const instanceLifetimeMs = resolveSecretRealmInstanceLifetimeMs({
      specialType,
    });
    const gateRule = resolveSecretRealmBossGateRule({
      width: snapshot.width,
      height: snapshot.height,
      specialType,
    });
    const sealedBossGate = applyBossGateSeal({
      snapshot: {
        width: snapshot.width,
        height: snapshot.height,
        bossPoint: snapshot.bossPoint,
        entryPoint: snapshot.entryPoint,
        tilesData: normalizedSnapshot.tilesData,
      },
    });

    const createdAt = new Date().toISOString();
    const expiresAt = toExpiryIso(instanceLifetimeMs);
    const instanceMap = await tx.insert(temporaryMaps).values({
      instanceId: null,
      name: `${params.template.name}·秘境`,
      description: params.template.description,
      width: snapshot.width,
      height: snapshot.height,
      minRealm: params.template.recommendedRealm,
      mapType: "secret_realm_instance",
      backgroundImageUrl: null,
      tilesData: buildRealmPortalTiles({
        snapshot: {
          returnPoint: snapshot.returnPoint,
          tilesData: sealedBossGate.tilesData,
        },
        sourceMapId: sourceMap.id,
        sourceMapName: sourceMap.name,
      }),
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    }).returning().get();

    if (!instanceMap) {
      throw new Error("秘境实例地图创建失败");
    }

    const createdInstance = await tx.insert(mapInstances).values({
      mapId: instanceMap.id,
      sourceSpawnId: lockedSpawn.id,
      templateId: params.template.id,
      instanceType: "secret_realm",
      accessType: lockedSpawn.spawnType,
      status: "active",
      ownerPlayerId: lockedSpawn.ownerPlayerId,
      sourceMapId: lockedSpawn.mapId,
      sourceMapName: sourceMap.name,
      sourcePositionX: lockedSpawn.positionX,
      sourcePositionY: lockedSpawn.positionY,
      returnPortalX: snapshot.returnPoint.x,
      returnPortalY: snapshot.returnPoint.y,
      bossMonsterId: null,
      rarity: params.template.rarity,
      recommendedRealm: params.template.recommendedRealm,
      expiresAt,
      settledAt: null,
      completedAt: null,
      createdAt,
      updatedAt: createdAt,
    }).returning().get();

    if (!createdInstance) {
      throw new Error("秘境实例创建失败");
    }

    await tx.update(temporaryMaps).set({
      instanceId: createdInstance.id,
      updatedAt: createdAt,
    }).where(eq(temporaryMaps.id, instanceMap.id)).run();

    await tx.update(secretRealmSpawns).set({
      instanceId: createdInstance.id,
      enteredAt: createdAt,
      updatedAt: createdAt,
    }).where(eq(secretRealmSpawns.id, lockedSpawn.id)).run();

    const reservedKeys = new Set([
      buildPointKey(snapshot.entryPoint),
      buildPointKey(snapshot.returnPoint),
      buildPointKey(snapshot.bossPoint),
      ...sealedBossGate.sealedDoorTiles.map((tile) => buildPointKey(tile)),
    ]);
    const candidatePoints = normalizedSnapshot.reachablePoints.filter((point) => !reservedKeys.has(buildPointKey(point)));
    const guardSelection = pickBossGateGuardPoints({
      candidatePoints,
      mainPath: sealedBossGate.mainPath,
      entryPoint: snapshot.entryPoint,
      bossPoint: snapshot.bossPoint,
      count: gateRule.guardRequired,
    });
    const bossGuardPoints = guardSelection.selected;
    const bossGuardPointMap = new Map<string, SecretRealmPoint>(
      bossGuardPoints.map((point, index) => [`guard_${index + 1}`, point]),
    );
    const remainingCandidatePoints = guardSelection.remainingCandidates;
    const bossPool = Array.isArray(params.template.bossPool) ? params.template.bossPool : [];

    let bossMonsterId: string | null = null;
    const bossGateGuardMonsterIds: string[] = [];
    const totalNonBossMonsterCount = (snapshot.monsterPlan || [])
      .filter((plan) => plan.role !== "boss")
      .reduce((sum, plan) => sum + Math.max(0, Number(plan.count || 0)), 0) + bossGuardPoints.length;
    for (const plan of snapshot.monsterPlan || []) {
      for (let index = 0; index < plan.count; index += 1) {
        const point = plan.role === "boss"
          ? snapshot.bossPoint
          : remainingCandidatePoints.splice(randomInt(0, Math.max(0, remainingCandidatePoints.length - 1)), 1)[0] || snapshot.entryPoint;
        const monsterFlavor = buildSecretRealmMonsterFlavor({
          theme: params.template.theme,
          rarity: params.template.rarity,
          role: plan.role,
          index,
          bossPool,
        });
        const lootBlueprint = buildSecretRealmLootBlueprint({
          seed: `${createdInstance.id}:${plan.role}:${index}:${params.template.theme}`,
          role: plan.role,
          rewardPlan: snapshot.rewardPlan,
          theme: params.template.theme,
          labels: [...(plan.labels || []), ...(monsterFlavor.labels || []), monsterFlavor.name],
          instanceRarity: params.template.rarity,
          recommendedRealm: params.template.recommendedRealm,
        });
        const stats = applySecretRealmMonsterFlavorStats({
          baseStats: scaleMonsterStats({
            recommendedRealm: params.template.recommendedRealm,
            rarity: params.template.rarity,
            role: plan.role,
          }),
          flavor: monsterFlavor,
        });

        const monsterCreated = await tx.insert(temporaryMonsters).values({
          instanceId: createdInstance.id,
          name: monsterFlavor.name,
          iconUrl: await pickTemporaryMonsterIconUrl(
            plan.role === "boss" ? "boss" : plan.role === "elite" ? "elite" : "normal",
          ),
          description: plan.role === "boss"
            ? `${params.template.bossBackground} ${monsterFlavor.description}`.trim().slice(0, 80)
            : monsterFlavor.description,
          monsterType: plan.role === "boss" ? "boss" : plan.role === "elite" ? "elite" : "normal",
          level: stats.level,
          hp: stats.hp,
          attack: stats.attack,
          defense: stats.defense,
          speed: stats.speed,
          luck: plan.role === "boss" ? 10 : 4,
          spiritualSense: 0,
          armorPenetration: plan.role === "boss" ? 6 : 1,
          block: plan.role === "boss" ? 6 : 0,
          skillDamageBonus: 0,
          skillDamageReduction: 0,
          artifactDamageBonus: 0,
          artifactDamageReduction: 0,
          skills: [],
          drops: [],
          xpReward: 0,
          goldReward: plan.role === "boss"
            ? Math.round(snapshot.rewardPlan.budget / 3)
            : Math.max(8, Math.round(snapshot.rewardPlan.budget / 18)),
          mapId: instanceMap.id,
          positionX: point.x,
          positionY: point.y,
          currentPositionX: point.x,
          currentPositionY: point.y,
          nextAiMoveAt: null,
          positionUpdatedAt: createdAt,
          aiMoveIntervalMinSeconds: plan.role === "boss" ? 999999 : 6,
          aiMoveIntervalMaxSeconds: plan.role === "boss" ? 999999 : 10,
          aiMoveRange: plan.role === "boss" ? 0 : 4,
          respawnSeconds: 999999,
          expiresAt: createdInstance.expiresAt,
          createdAt,
          updatedAt: createdAt,
        }).returning().get();

        if (!monsterCreated) {
          continue;
        }

        if (plan.role === "boss") {
          bossMonsterId = monsterCreated.id;
        }

        await insertMapInstanceMonsterCompat({
          instanceId: createdInstance.id,
          monsterId: monsterCreated.id,
          role: plan.role,
          rarity: params.template.rarity,
          spawnX: point.x,
          spawnY: point.y,
          rewardPlan: snapshot.rewardPlan,
          lootBlueprintJson: lootBlueprint,
          status: "alive",
          defeatedAt: null,
          createdAt,
          updatedAt: createdAt,
        }, tx);
      }
    }

    for (let index = 0; index < bossGuardPoints.length; index += 1) {
      const point = bossGuardPointMap.get(`guard_${index + 1}`) || bossGuardPoints[index];
      if (!point) {
        continue;
      }

      const guardFlavor = buildSecretRealmBossGateGuardFlavor({
        theme: params.template.theme,
        index,
      });
      const lootBlueprint = buildSecretRealmLootBlueprint({
        seed: `${createdInstance.id}:boss-gate-guard:${index}:${params.template.theme}`,
        role: "elite",
        rewardPlan: snapshot.rewardPlan,
        theme: params.template.theme,
        labels: ["封印守卫", "中层守关", ...(guardFlavor.labels || []), guardFlavor.name],
        instanceRarity: params.template.rarity,
        recommendedRealm: params.template.recommendedRealm,
      });
      const stats = applySecretRealmMonsterFlavorStats({
        baseStats: scaleMonsterStats({
          recommendedRealm: params.template.recommendedRealm,
          rarity: params.template.rarity,
          role: "elite",
        }),
        flavor: guardFlavor,
      });
      const guardCreated = await tx.insert(temporaryMonsters).values({
        instanceId: createdInstance.id,
        name: guardFlavor.name,
        iconUrl: await pickTemporaryMonsterIconUrl("elite"),
        description: guardFlavor.description,
        monsterType: "elite",
        level: stats.level + 1,
        hp: Math.round(stats.hp * 1.12),
        attack: Math.round(stats.attack * 1.08),
        defense: Math.round(stats.defense * 1.08),
        speed: stats.speed,
        luck: 5,
        spiritualSense: 0,
        armorPenetration: 2,
        block: 1,
        skillDamageBonus: 0,
        skillDamageReduction: 0,
        artifactDamageBonus: 0,
        artifactDamageReduction: 0,
        skills: [],
        drops: [],
        xpReward: 0,
        goldReward: Math.max(10, Math.round(snapshot.rewardPlan.budget / 16)),
        mapId: instanceMap.id,
        positionX: point.x,
        positionY: point.y,
        currentPositionX: point.x,
        currentPositionY: point.y,
        nextAiMoveAt: null,
        positionUpdatedAt: createdAt,
        aiMoveIntervalMinSeconds: 5,
        aiMoveIntervalMaxSeconds: 8,
        aiMoveRange: 3,
        respawnSeconds: 999999,
        expiresAt: createdInstance.expiresAt,
        createdAt,
        updatedAt: createdAt,
      }).returning().get();

      if (!guardCreated) {
        continue;
      }

      bossGateGuardMonsterIds.push(guardCreated.id);
      await insertMapInstanceMonsterCompat({
        instanceId: createdInstance.id,
        monsterId: guardCreated.id,
        role: "elite",
        rarity: params.template.rarity,
        spawnX: point.x,
        spawnY: point.y,
        rewardPlan: snapshot.rewardPlan,
        lootBlueprintJson: lootBlueprint,
        status: "alive",
        defeatedAt: null,
        createdAt,
        updatedAt: createdAt,
      }, tx);
    }

    await tx.update(mapInstances).set({
      bossMonsterId,
      updatedAt: new Date().toISOString(),
    }).where(eq(mapInstances.id, createdInstance.id)).run();

    await tx.insert(secretRealmRuns).values({
      instanceId: createdInstance.id,
      templateId: params.template.id,
      spawnType: lockedSpawn.spawnType,
      ownerPlayerId: lockedSpawn.ownerPlayerId,
      status: "ongoing",
      summaryJson: {
        coreRewardOwnerPlayerId: null,
        participantPlayerIds: [],
        pityGrantedPlayerIds: [],
        bossMonsterId,
        bossDefeatedAt: null,
        bossGate: createInitialSecretRealmBossGateStatus({
          width: snapshot.width,
          height: snapshot.height,
          totalNonBossMonsterCount,
          guardMonsterIds: bossGateGuardMonsterIds,
          sealedDoorTiles: sealedBossGate.sealedDoorTiles,
          specialType,
        }),
      },
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
    }).run();

    return {
      ...createdInstance,
      bossMonsterId,
      updatedAt: createdAt,
    };
  });

  await markSecretRealmSpawnEntered(params.spawn.id, instance.id);

  return instance;
}

async function resolveEntryMembers(player: PlayerRow, spawn: typeof secretRealmSpawns.$inferSelect) {
  const entryPlayers: PlayerRow[] = [player];
  const partyContext = await getPartyMovementContext(player.id);
  if (!partyContext || partyContext.leaderPlayerId !== player.id) {
    return entryPlayers;
  }

  for (const member of partyContext.members) {
    if (member.id === player.id || member.currentMapId !== player.currentMapId) {
      continue;
    }
    if (Math.max(Math.abs(member.positionX - player.positionX), Math.abs(member.positionY - player.positionY)) > 1) {
      continue;
    }
    if (spawn.spawnType === "personal") {
      const visiblePlayerIds = Array.isArray(spawn.visiblePlayerIds) ? spawn.visiblePlayerIds : [];
      if (!visiblePlayerIds.includes(member.id)) {
        continue;
      }
    }

    const memberRow = await db.select().from(players).where(eq(players.id, member.id)).get();
    if (memberRow) {
      entryPlayers.push(memberRow);
    }
  }

  return entryPlayers;
}

async function movePlayersIntoInstance(params: {
  instance: typeof mapInstances.$inferSelect;
  members: PlayerRow[];
}) {
  const nowIso = new Date().toISOString();
  const cosmetics = await getPlayerCosmeticMapByIds(params.members.map((member) => member.id));

  for (const member of params.members) {
    const previousMapId = member.currentMapId || "map_starter_village";
    await db.insert(mapInstanceMembers).values({
      instanceId: params.instance.id,
      playerId: member.id,
      status: "active",
      role: member.id === params.members[0]?.id ? "leader" : "member",
      returnMapId: member.currentMapId,
      returnMapName: null,
      returnPositionX: member.positionX,
      returnPositionY: member.positionY,
      joinedAt: nowIso,
      leftAt: null,
      lastSeenAt: nowIso,
    }).onConflictDoUpdate({
      target: [mapInstanceMembers.instanceId, mapInstanceMembers.playerId],
      set: {
        status: "active",
        returnMapId: member.currentMapId,
        returnPositionX: member.positionX,
        returnPositionY: member.positionY,
        leftAt: null,
        lastSeenAt: nowIso,
      },
    }).run();

    await db.update(players).set({
      currentMapId: params.instance.mapId,
      currentMapInstanceId: params.instance.id,
      positionX: params.instance.returnPortalX,
      positionY: params.instance.returnPortalY,
      updatedAt: nowIso,
    }).where(eq(players.id, member.id)).run();

    ensureMapSceneTick(previousMapId);
    ensureMapSceneTick(params.instance.mapId);
    advanceMapSceneTick(previousMapId);
    advanceMapSceneTick(params.instance.mapId);
    resetMapClientSequence(member.id, params.instance.mapId);
    resetRepeatKillGuard(member.id);

    const cosmetic = cosmetics.get(member.id);
    publishMapPresencePlayerPosition({
      id: member.id,
      name: member.name || "",
      gender: member.gender,
      avatarImageUrl: cosmetic?.avatarImageUrl || null,
      avatarFrameImageUrl: cosmetic?.avatarFrameImageUrl || null,
      realm: member.realm,
      realmMajor: member.realmMajor,
      realmMinor: member.realmMinor,
      realmName: member.realmName || "凡人",
      mapId: params.instance.mapId,
      prevMapId: previousMapId,
      positionX: params.instance.returnPortalX,
      positionY: params.instance.returnPortalY,
    });
  }
}

async function evacuateSecretRealmMembers(params: {
  instance: typeof mapInstances.$inferSelect;
  nowIso?: string;
}) {
  const nowIso = params.nowIso || new Date().toISOString();
  const activeMembers = await db.select({
    playerId: players.id,
    name: players.name,
    gender: players.gender,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    returnMapId: mapInstanceMembers.returnMapId,
    returnPositionX: mapInstanceMembers.returnPositionX,
    returnPositionY: mapInstanceMembers.returnPositionY,
  }).from(mapInstanceMembers)
    .innerJoin(players, eq(players.id, mapInstanceMembers.playerId))
    .where(and(
      eq(mapInstanceMembers.instanceId, params.instance.id),
      eq(mapInstanceMembers.status, "active"),
    ))
    .all();

  const playersInInstance = await db.select({
    playerId: players.id,
    name: players.name,
    gender: players.gender,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
  }).from(players)
    .where(eq(players.currentMapInstanceId, params.instance.id))
    .all();

  const activeMemberIds = new Set(activeMembers.map((member) => member.playerId));
  const strandedPlayers: SecretRealmEvacuationMember[] = playersInInstance
    .filter((player) => !activeMemberIds.has(player.playerId))
    .map((player) => ({
      ...player,
      returnMapId: null,
      returnPositionX: null,
      returnPositionY: null,
    }));

  const evacuationMembers: SecretRealmEvacuationMember[] = [
    ...activeMembers,
    ...strandedPlayers,
  ];

  if (evacuationMembers.length === 0) {
    return [];
  }

  for (const member of evacuationMembers) {
    const targetMapId = member.returnMapId || params.instance.sourceMapId;
    if (!targetMapId) {
      continue;
    }
    const targetPositionX = member.returnMapId && member.returnPositionX !== null
      ? member.returnPositionX
      : params.instance.sourcePositionX;
    const targetPositionY = member.returnMapId && member.returnPositionY !== null
      ? member.returnPositionY
      : params.instance.sourcePositionY;

    await db.update(players).set({
      currentMapId: targetMapId,
      currentMapInstanceId: null,
      positionX: targetPositionX,
      positionY: targetPositionY,
      updatedAt: nowIso,
    }).where(eq(players.id, member.playerId)).run();

    await db.update(mapInstanceMembers).set({
      status: "left",
      leftAt: nowIso,
      lastSeenAt: nowIso,
    }).where(and(
      eq(mapInstanceMembers.instanceId, params.instance.id),
      eq(mapInstanceMembers.playerId, member.playerId),
    )).run();
  }

  const affectedMapIds = Array.from(new Set([
    params.instance.mapId,
    ...evacuationMembers
      .map((member) => member.returnMapId || params.instance.sourceMapId)
      .filter((mapId): mapId is string => Boolean(mapId)),
  ]));
  affectedMapIds.forEach((mapId) => ensureMapSceneTick(mapId));
  affectedMapIds.forEach((mapId) => advanceMapSceneTick(mapId));
  const targetMapIds = Array.from(new Set(evacuationMembers
    .map((member) => member.returnMapId || params.instance.sourceMapId)
    .filter((mapId): mapId is string => Boolean(mapId))));
  await Promise.allSettled(targetMapIds.map((mapId) => warmMapSceneSharedStateForMapId({
    mapId,
    reason: "player_transition",
  }))).then((results) => {
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error("Secret realm evacuate map prewarm error:", {
          mapId: targetMapIds[index] || null,
          error: result.reason,
        });
      }
    });
  });

  const cosmetics = await getPlayerCosmeticMapByIds(evacuationMembers.map((member) => member.playerId));
  for (const member of evacuationMembers) {
    const targetMapId = member.returnMapId || params.instance.sourceMapId;
    if (!targetMapId) {
      continue;
    }
    const targetPositionX = member.returnMapId && member.returnPositionX !== null
      ? member.returnPositionX
      : params.instance.sourcePositionX;
    const targetPositionY = member.returnMapId && member.returnPositionY !== null
      ? member.returnPositionY
      : params.instance.sourcePositionY;

    resetMapClientSequence(member.playerId, targetMapId);
    resetRepeatKillGuard(member.playerId);

    const cosmetic = cosmetics.get(member.playerId);
    publishMapPresencePlayerPosition({
      id: member.playerId,
      name: member.name || "",
      gender: member.gender,
      avatarImageUrl: cosmetic?.avatarImageUrl || null,
      avatarFrameImageUrl: cosmetic?.avatarFrameImageUrl || null,
      realm: member.realm,
      realmMajor: member.realmMajor,
      realmMinor: member.realmMinor,
      realmName: member.realmName || "凡人",
      mapId: targetMapId,
      prevMapId: params.instance.mapId,
      positionX: targetPositionX,
      positionY: targetPositionY,
    });
  }

  return evacuationMembers;
}

/**
 * 历史数据/实时移动曾把 players.current_map_instance_id 写成占位值（如 "default"），
 * 导致秘境链路（current / leave / 死亡回返）整体失效：玩家明明在秘境实例地图里，
 * 系统却认为他已经离开。这里用 map_instance_members 的 active 记录兜底反查真实实例，
 * 并顺手把玩家行的实例引用修回去。
 */
const SECRET_REALM_PLACEHOLDER_INSTANCE_IDS = new Set(["default", "none", "null"]);

export async function resolvePlayerSecretRealmInstanceId(params: {
  playerId: string;
  currentMapInstanceId?: string | null;
  repairPlayerRow?: boolean;
  nowIso?: string;
}): Promise<string | null> {
  const raw = (params.currentMapInstanceId || "").trim();
  if (raw && !SECRET_REALM_PLACEHOLDER_INSTANCE_IDS.has(raw.toLowerCase())) {
    return raw;
  }

  const activeMembers = await db.select({
    instanceId: mapInstanceMembers.instanceId,
    joinedAt: mapInstanceMembers.joinedAt,
  }).from(mapInstanceMembers).where(and(
    eq(mapInstanceMembers.playerId, params.playerId),
    eq(mapInstanceMembers.status, "active"),
  )).all();
  if (activeMembers.length === 0) {
    return null;
  }

  const latest = activeMembers.reduce<{ instanceId: string; joinedAt: string } | null>((latestRow, row) => {
    if (!latestRow) {
      return row;
    }
    return Date.parse(row.joinedAt) > Date.parse(latestRow.joinedAt) ? row : latestRow;
  }, null);
  const resolvedInstanceId = latest?.instanceId || null;
  if (!resolvedInstanceId) {
    return null;
  }

  if (params.repairPlayerRow !== false) {
    await db.update(players).set({
      currentMapInstanceId: resolvedInstanceId,
      updatedAt: params.nowIso || new Date().toISOString(),
    }).where(eq(players.id, params.playerId)).run();
  }
  return resolvedInstanceId;
}

export async function moveSecretRealmPlayerToReturnPoint(params: {
  playerId: string;
  nowIso?: string;
  hp?: number;
  mp?: number;
}): Promise<SecretRealmPlayerReturnResult | null> {
  const player = await db.select().from(players).where(eq(players.id, params.playerId)).get();
  if (!player) {
    return null;
  }

  const instanceId = await resolvePlayerSecretRealmInstanceId({
    playerId: player.id,
    currentMapInstanceId: player.currentMapInstanceId,
    nowIso: params.nowIso,
  });
  if (!instanceId) {
    return null;
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const [instance, memberRow] = await Promise.all([
    db.select().from(mapInstances).where(eq(mapInstances.id, instanceId)).get(),
    db.select().from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, instanceId),
      eq(mapInstanceMembers.playerId, player.id),
    )).get(),
  ]);

  const previousMapId = instance?.mapId || player.currentMapId;
  const targetMapId = memberRow?.returnMapId || instance?.sourceMapId || player.currentMapId;
  const targetPositionX = memberRow?.returnPositionX ?? instance?.sourcePositionX ?? player.positionX;
  const targetPositionY = memberRow?.returnPositionY ?? instance?.sourcePositionY ?? player.positionY;

  if (!targetMapId) {
    await db.update(players).set({
      currentMapInstanceId: null,
      ...(params.hp !== undefined ? { hp: params.hp } : {}),
      ...(params.mp !== undefined ? { mp: params.mp } : {}),
      updatedAt: nowIso,
    }).where(eq(players.id, player.id)).run();

    if (memberRow) {
      await db.update(mapInstanceMembers).set({
        status: "left",
        leftAt: nowIso,
        lastSeenAt: nowIso,
      }).where(and(
        eq(mapInstanceMembers.instanceId, memberRow.instanceId),
        eq(mapInstanceMembers.playerId, player.id),
      )).run();
    }

    return {
      mapId: player.currentMapId,
      positionX: player.positionX,
      positionY: player.positionY,
      repairedStaleReference: true,
      previousMapId,
    };
  }

  await db.update(players).set({
    currentMapId: targetMapId,
    currentMapInstanceId: null,
    positionX: targetPositionX,
    positionY: targetPositionY,
    ...(params.hp !== undefined ? { hp: params.hp } : {}),
    ...(params.mp !== undefined ? { mp: params.mp } : {}),
    updatedAt: nowIso,
  }).where(eq(players.id, player.id)).run();

  if (memberRow) {
    await db.update(mapInstanceMembers).set({
      status: "left",
      leftAt: nowIso,
      lastSeenAt: nowIso,
    }).where(and(
      eq(mapInstanceMembers.instanceId, memberRow.instanceId),
      eq(mapInstanceMembers.playerId, player.id),
    )).run();
  }

  if (instance) {
    const activeMembers = await db.select({
      playerId: mapInstanceMembers.playerId,
    }).from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, instance.id),
      eq(mapInstanceMembers.status, "active"),
    )).all();

    if (activeMembers.length === 0 && instance.status !== "completed" && instance.status !== "settling") {
      await db.update(mapInstances).set({
        status: "expired",
        expiresAt: toExpiryIso(SECRET_REALM_SETTLE_LIFETIME_MS),
        updatedAt: nowIso,
      }).where(eq(mapInstances.id, instance.id)).run();
    }
  }

  const affectedMapIds = Array.from(new Set([previousMapId, targetMapId].filter((mapId): mapId is string => Boolean(mapId))));
  affectedMapIds.forEach((mapId) => ensureMapSceneTick(mapId));
  affectedMapIds.forEach((mapId) => advanceMapSceneTick(mapId));
  resetMapClientSequence(player.id, targetMapId);
  resetRepeatKillGuard(player.id);
  await warmMapSceneSharedStateForMapId({
    mapId: targetMapId,
    reason: "player_transition",
  }).catch((error) => {
    console.error("Secret realm return map prewarm error:", {
      playerId: player.id,
      mapId: targetMapId,
      error,
    });
  });

  const cosmeticMap = await getPlayerCosmeticMapByIds([player.id]);
  const cosmetic = cosmeticMap.get(player.id);
  publishMapPresencePlayerPosition({
    id: player.id,
    name: player.name || "",
    gender: player.gender,
    avatarImageUrl: cosmetic?.avatarImageUrl || null,
    avatarFrameImageUrl: cosmetic?.avatarFrameImageUrl || null,
    realm: player.realm,
    realmMajor: player.realmMajor,
    realmMinor: player.realmMinor,
    realmName: player.realmName || "凡人",
    mapId: targetMapId,
    prevMapId: previousMapId || targetMapId,
    positionX: targetPositionX,
    positionY: targetPositionY,
  });

  return {
    mapId: targetMapId,
    positionX: targetPositionX,
    positionY: targetPositionY,
    repairedStaleReference: !instance || !memberRow,
    previousMapId,
  };
}

export async function repairStaleSecretRealmReferenceForPlayer(params: {
  playerId: string;
  player?: PlayerRow | null;
  currentMapType?: string | null;
  nowIso?: string;
}) {
  const player = params.player ?? await db.select().from(players).where(eq(players.id, params.playerId)).get();
  if (!player?.currentMapInstanceId) {
    return false;
  }

  const currentMapType = params.currentMapType
    ?? (player.currentMapId
      ? ((await db.select({ mapType: maps.mapType }).from(maps).where(eq(maps.id, player.currentMapId)).get())?.mapType
        ?? (await db.select({ mapType: temporaryMaps.mapType }).from(temporaryMaps)
          .where(eq(temporaryMaps.id, player.currentMapId)).get())?.mapType)
      : null)
    ?? null;
  if (isSecretRealmMapType(currentMapType)) {
    return false;
  }

  const nowIso = params.nowIso || new Date().toISOString();
  // 实例引用可能是占位值（历史数据/实时移动覆写），按成员记录反查真实实例再清理，
  // 否则会留下永远 active 的成员行，导致实例永不过期。
  const resolvedInstanceId = await resolvePlayerSecretRealmInstanceId({
    playerId: player.id,
    currentMapInstanceId: player.currentMapInstanceId,
    repairPlayerRow: false,
    nowIso,
  });

  await db.update(players).set({
    currentMapInstanceId: null,
    updatedAt: nowIso,
  }).where(eq(players.id, player.id)).run();

  if (resolvedInstanceId) {
    await db.update(mapInstanceMembers).set({
      status: "left",
      leftAt: nowIso,
      lastSeenAt: nowIso,
    }).where(and(
      eq(mapInstanceMembers.instanceId, resolvedInstanceId),
      eq(mapInstanceMembers.playerId, player.id),
      eq(mapInstanceMembers.status, "active"),
    )).run();
  }

  return true;
}

async function collectSecretRealmRuntimeCounts(instance: typeof mapInstances.$inferSelect) {
  const [runRows, memberRows, linkMonsterRows, temporaryMonsterRows, temporaryMapRows] = await Promise.all([
    db.select({
      id: secretRealmRuns.id,
    }).from(secretRealmRuns).where(eq(secretRealmRuns.instanceId, instance.id)).all(),
    db.select({
      playerId: mapInstanceMembers.playerId,
    }).from(mapInstanceMembers).where(eq(mapInstanceMembers.instanceId, instance.id)).all(),
    db.select({
      monsterId: mapInstanceMonsters.monsterId,
    }).from(mapInstanceMonsters).where(eq(mapInstanceMonsters.instanceId, instance.id)).all(),
    db.select({
      id: temporaryMonsters.id,
    }).from(temporaryMonsters).where(or(
      eq(temporaryMonsters.instanceId, instance.id),
      eq(temporaryMonsters.mapId, instance.mapId),
    )).all(),
    db.select({
      id: temporaryMaps.id,
    }).from(temporaryMaps).where(or(
      eq(temporaryMaps.instanceId, instance.id),
      eq(temporaryMaps.id, instance.mapId),
    )).all(),
  ]);

  return {
    cleanedRunCount: runRows.length,
    cleanedMemberCount: memberRows.length,
    cleanedLinkMonsterCount: linkMonsterRows.length,
    cleanedMonsterCount: temporaryMonsterRows.length,
    cleanedMapCount: temporaryMapRows.length,
  };
}

async function tryFinalizeSecretRealmInstanceCleanup(params: {
  instance: typeof mapInstances.$inferSelect;
  nowIso: string;
}) {
  await evacuateSecretRealmMembers({
    instance: params.instance,
    nowIso: params.nowIso,
  });

  const [remainingMembers, remainingPlayers] = await Promise.all([
    db.select({
      playerId: mapInstanceMembers.playerId,
    }).from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, params.instance.id),
      eq(mapInstanceMembers.status, "active"),
    )).all(),
    db.select({
      id: players.id,
    }).from(players).where(eq(players.currentMapInstanceId, params.instance.id)).all(),
  ]);

  if (remainingMembers.length > 0 || remainingPlayers.length > 0) {
    return null;
  }

  const counts = await collectSecretRealmRuntimeCounts(params.instance);
  await purgeSecretRealmInstanceRuntime({
    instance: params.instance,
  });

  return {
    cleanedInstanceCount: 1,
    ...counts,
  } satisfies SecretRealmRuntimeCleanupResult;
}

async function purgeSecretRealmInstanceRuntime(params: {
  instance: typeof mapInstances.$inferSelect;
}) {
  const nowIso = new Date().toISOString();
  const temporaryMonsterRows = await db.select({
    id: temporaryMonsters.id,
  }).from(temporaryMonsters).where(or(
    eq(temporaryMonsters.instanceId, params.instance.id),
    eq(temporaryMonsters.mapId, params.instance.mapId),
  )).all();
  const temporaryMonsterIds = temporaryMonsterRows.map((row) => row.id);

  await db.transaction(async (tx) => {
    await tx.delete(secretRealmRewardClaims)
      .where(eq(secretRealmRewardClaims.instanceId, params.instance.id))
      .run();

    if (temporaryMonsterIds.length > 0) {
      await tx.delete(bossInstances)
        .where(inArray(bossInstances.monsterId, temporaryMonsterIds))
        .run();
    }

    await tx.delete(secretRealmRuns)
      .where(eq(secretRealmRuns.instanceId, params.instance.id))
      .run();

    await tx.delete(mapInstanceMonsters)
      .where(eq(mapInstanceMonsters.instanceId, params.instance.id))
      .run();

    await tx.delete(mapInstanceMembers)
      .where(eq(mapInstanceMembers.instanceId, params.instance.id))
      .run();

    await tx.delete(temporaryMonsters)
      .where(or(
        eq(temporaryMonsters.instanceId, params.instance.id),
        eq(temporaryMonsters.mapId, params.instance.mapId),
      ))
      .run();

    await tx.delete(temporaryMaps)
      .where(or(
        eq(temporaryMaps.instanceId, params.instance.id),
        eq(temporaryMaps.id, params.instance.mapId),
      ))
      .run();

    await tx.delete(mapInstances)
      .where(eq(mapInstances.id, params.instance.id))
      .run();

    const spawnFilters = [
      eq(secretRealmSpawns.instanceId, params.instance.id),
    ];
    if (params.instance.sourceSpawnId) {
      spawnFilters.push(eq(secretRealmSpawns.id, params.instance.sourceSpawnId));
    }
    // 全局入口被“进入后离开/团灭”回收实例时不应直接消散：只要还在存活期内就保持 active，
    // 否则整张地图会失去入口，直到下一次刷新冷却结束（玩家体感就是“再也进不去秘境”）。
    await tx.update(secretRealmSpawns).set({
      instanceId: null,
      status: sql`CASE
        WHEN ${secretRealmSpawns.status} = 'completed' THEN 'completed'
        WHEN ${secretRealmSpawns.spawnType} = 'personal' THEN 'expired'
        WHEN ${secretRealmSpawns.expiresAt} <= ${nowIso} THEN 'expired'
        ELSE 'active'
      END`,
      updatedAt: nowIso,
    }).where(or(...spawnFilters)).run();
  });

  clearMonsterAiRuntimeForMap({
    mapId: params.instance.mapId,
    monsterIds: temporaryMonsterIds,
  });
}

async function cleanupOrphanedSecretRealmRuntime(nowIso: string): Promise<{
  cleanedBrokenInstanceCount: number;
  cleanedMonsterCountFromBrokenInstances: number;
  cleanedMapCountFromBrokenInstances: number;
  cleanedOrphanMonsterCount: number;
  cleanedOrphanMapCount: number;
  cleanedOrphanRunCount: number;
  cleanedOrphanInstanceMonsterCount: number;
}> {
  const orphanGraceCutoffMs = Date.parse(nowIso) - SECRET_REALM_RUNTIME_ORPHAN_GRACE_MS;

  const currentInstances = await db.select()
    .from(mapInstances)
    .where(eq(mapInstances.instanceType, "secret_realm"))
    .all();

  const currentTemporaryMaps = await db.select({
    id: temporaryMaps.id,
    instanceId: temporaryMaps.instanceId,
    createdAt: temporaryMaps.createdAt,
  }).from(temporaryMaps).all();

  const temporaryMapIds = new Set(currentTemporaryMaps.map((row) => row.id));
  const brokenInstances = currentInstances.filter((instance) => (
    !temporaryMapIds.has(instance.mapId) && isOlderThan(instance.createdAt, orphanGraceCutoffMs)
  ));

  let cleanedBrokenInstanceCount = 0;
  let cleanedMonsterCountFromBrokenInstances = 0;
  let cleanedMapCountFromBrokenInstances = 0;

  for (const instance of brokenInstances) {
    if (instance.status === "active") {
      await db.update(mapInstances).set({
        status: "expired",
        updatedAt: nowIso,
      }).where(eq(mapInstances.id, instance.id)).run();
      instance.status = "expired";
      instance.updatedAt = nowIso;
    }

    await evacuateSecretRealmMembers({
      instance,
      nowIso,
    });

    const [remainingMembers, remainingPlayers, temporaryMonsterRows, temporaryMapRows] = await Promise.all([
      db.select({
        playerId: mapInstanceMembers.playerId,
      }).from(mapInstanceMembers).where(and(
        eq(mapInstanceMembers.instanceId, instance.id),
        eq(mapInstanceMembers.status, "active"),
      )).all(),
      db.select({
        id: players.id,
      }).from(players).where(eq(players.currentMapInstanceId, instance.id)).all(),
      db.select({
        id: temporaryMonsters.id,
      }).from(temporaryMonsters).where(or(
        eq(temporaryMonsters.instanceId, instance.id),
        eq(temporaryMonsters.mapId, instance.mapId),
      )).all(),
      db.select({
        id: temporaryMaps.id,
      }).from(temporaryMaps).where(or(
        eq(temporaryMaps.instanceId, instance.id),
        eq(temporaryMaps.id, instance.mapId),
      )).all(),
    ]);

    if (remainingMembers.length > 0 || remainingPlayers.length > 0) {
      continue;
    }

    await purgeSecretRealmInstanceRuntime({ instance });
    cleanedBrokenInstanceCount += 1;
    cleanedMonsterCountFromBrokenInstances += temporaryMonsterRows.length;
    cleanedMapCountFromBrokenInstances += temporaryMapRows.length;
  }

  const [remainingInstances, remainingTemporaryMaps, remainingTemporaryMonsters, remainingInstanceMonsters, remainingRuns] = await Promise.all([
    db.select()
      .from(mapInstances)
      .where(eq(mapInstances.instanceType, "secret_realm"))
      .all(),
    db.select({
      id: temporaryMaps.id,
      instanceId: temporaryMaps.instanceId,
      createdAt: temporaryMaps.createdAt,
    }).from(temporaryMaps).all(),
    db.select({
      id: temporaryMonsters.id,
      instanceId: temporaryMonsters.instanceId,
      mapId: temporaryMonsters.mapId,
      createdAt: temporaryMonsters.createdAt,
    }).from(temporaryMonsters).all(),
    db.select({
      id: mapInstanceMonsters.id,
      instanceId: mapInstanceMonsters.instanceId,
      monsterId: mapInstanceMonsters.monsterId,
    }).from(mapInstanceMonsters).all(),
    db.select({
      id: secretRealmRuns.id,
      instanceId: secretRealmRuns.instanceId,
    }).from(secretRealmRuns).all(),
  ]);

  const remainingInstanceIds = new Set(remainingInstances.map((row) => row.id));
  const remainingInstanceMapIds = new Set(remainingInstances.map((row) => row.mapId));
  const remainingTemporaryMapIds = new Set(remainingTemporaryMaps.map((row) => row.id));

  const orphanedTemporaryMapRows = remainingTemporaryMaps.filter((row) => (
    (row.instanceId && !remainingInstanceIds.has(row.instanceId) && isOlderThan(row.createdAt, orphanGraceCutoffMs))
    || (!remainingInstanceMapIds.has(row.id) && isOlderThan(row.createdAt, orphanGraceCutoffMs))
  ));
  const orphanedTemporaryMapIds = orphanedTemporaryMapRows.map((row) => row.id);
  const orphanedTemporaryMapIdSet = new Set(orphanedTemporaryMapIds);

  const orphanedTemporaryMonsterRows = remainingTemporaryMonsters.filter((row) => (
    (row.instanceId && !remainingInstanceIds.has(row.instanceId) && isOlderThan(row.createdAt, orphanGraceCutoffMs))
    || orphanedTemporaryMapIdSet.has(row.mapId)
    || (!remainingTemporaryMapIds.has(row.mapId) && isOlderThan(row.createdAt, orphanGraceCutoffMs))
  ));
  const orphanedTemporaryMonsterIds = orphanedTemporaryMonsterRows.map((row) => row.id);
  const orphanedTemporaryMonsterIdSet = new Set(orphanedTemporaryMonsterIds);
  const remainingTemporaryMonsterIds = new Set(remainingTemporaryMonsters.map((row) => row.id));

  const orphanedInstanceMonsterIds = remainingInstanceMonsters
    .filter((row) => !remainingInstanceIds.has(row.instanceId) || orphanedTemporaryMonsterIdSet.has(row.monsterId) || !remainingTemporaryMonsterIds.has(row.monsterId))
    .map((row) => row.id);

  const orphanedRunIds = remainingRuns
    .filter((row) => !remainingInstanceIds.has(row.instanceId))
    .map((row) => row.id);
  const orphanedClaimRows = await db.select({
    id: secretRealmRewardClaims.id,
    instanceId: secretRealmRewardClaims.instanceId,
    runId: secretRealmRewardClaims.runId,
    monsterId: secretRealmRewardClaims.monsterId,
  }).from(secretRealmRewardClaims).all();
  const orphanedRunIdSet = new Set(orphanedRunIds);
  const orphanedClaimIds = orphanedClaimRows
    .filter((row) => (
      !remainingInstanceIds.has(row.instanceId)
      || (row.runId ? orphanedRunIdSet.has(row.runId) : false)
      || orphanedTemporaryMonsterIdSet.has(row.monsterId)
    ))
    .map((row) => row.id);

  if (
    orphanedTemporaryMonsterIds.length === 0
    && orphanedTemporaryMapIds.length === 0
    && orphanedInstanceMonsterIds.length === 0
    && orphanedRunIds.length === 0
    && orphanedClaimIds.length === 0
  ) {
    return {
      cleanedBrokenInstanceCount,
      cleanedMonsterCountFromBrokenInstances,
      cleanedMapCountFromBrokenInstances,
      cleanedOrphanMonsterCount: 0,
      cleanedOrphanMapCount: 0,
      cleanedOrphanRunCount: 0,
      cleanedOrphanInstanceMonsterCount: 0,
    };
  }

  await db.transaction(async (tx) => {
    if (orphanedClaimIds.length > 0) {
      await tx.delete(secretRealmRewardClaims)
        .where(inArray(secretRealmRewardClaims.id, orphanedClaimIds))
        .run();
    }

    if (orphanedTemporaryMonsterIds.length > 0) {
      await tx.delete(bossInstances)
        .where(inArray(bossInstances.monsterId, orphanedTemporaryMonsterIds))
        .run();
    }

    if (orphanedRunIds.length > 0) {
      await tx.delete(secretRealmRuns)
        .where(inArray(secretRealmRuns.id, orphanedRunIds))
        .run();
    }

    if (orphanedInstanceMonsterIds.length > 0) {
      await tx.delete(mapInstanceMonsters)
        .where(inArray(mapInstanceMonsters.id, orphanedInstanceMonsterIds))
        .run();
    }

    if (orphanedTemporaryMonsterIds.length > 0) {
      await tx.delete(temporaryMonsters)
        .where(inArray(temporaryMonsters.id, orphanedTemporaryMonsterIds))
        .run();
    }

    if (orphanedTemporaryMapIds.length > 0) {
      await tx.delete(temporaryMaps)
        .where(inArray(temporaryMaps.id, orphanedTemporaryMapIds))
        .run();
    }
  });

  const orphanedMonsterIdsByMap = orphanedTemporaryMonsterRows.reduce((acc, row) => {
    const current = acc.get(row.mapId) || [];
    current.push(row.id);
    acc.set(row.mapId, current);
    return acc;
  }, new Map<string, string[]>());

  orphanedMonsterIdsByMap.forEach((monsterIds, mapId) => {
    clearMonsterAiRuntimeForMap({
      mapId,
      monsterIds,
    });
  });

  return {
    cleanedBrokenInstanceCount,
    cleanedMonsterCountFromBrokenInstances,
    cleanedMapCountFromBrokenInstances,
    cleanedOrphanMonsterCount: orphanedTemporaryMonsterIds.length,
    cleanedOrphanMapCount: orphanedTemporaryMapIds.length,
    cleanedOrphanRunCount: orphanedRunIds.length,
    cleanedOrphanInstanceMonsterCount: orphanedInstanceMonsterIds.length,
  };
}

export async function cleanupExpiredSecretRealmInstances(nowIso = new Date().toISOString()): Promise<SecretRealmCleanupResult> {
  const expiredInstances = await db.select()
    .from(mapInstances)
    .where(and(
      eq(mapInstances.instanceType, "secret_realm"),
      lte(mapInstances.expiresAt, nowIso),
    ))
    .all();

  let cleanedInstanceCount = 0;
  let cleanedMonsterCount = 0;
  let cleanedMapCount = 0;

  for (const instance of expiredInstances) {
    if (instance.status === "active") {
      await db.update(mapInstances).set({
        status: "expired",
        updatedAt: nowIso,
      }).where(eq(mapInstances.id, instance.id)).run();
      instance.status = "expired";
      instance.updatedAt = nowIso;
    }

    const cleanupResult = await tryFinalizeSecretRealmInstanceCleanup({
      instance,
      nowIso,
    });
    if (!cleanupResult) {
      continue;
    }

    cleanedInstanceCount += cleanupResult.cleanedInstanceCount;
    cleanedMonsterCount += cleanupResult.cleanedMonsterCount;
    cleanedMapCount += cleanupResult.cleanedMapCount;
  }

  const orphanCleanupResult = await cleanupOrphanedSecretRealmRuntime(nowIso);

  return {
    cleanedInstanceCount,
    cleanedMonsterCount: cleanedMonsterCount + orphanCleanupResult.cleanedMonsterCountFromBrokenInstances,
    cleanedMapCount: cleanedMapCount + orphanCleanupResult.cleanedMapCountFromBrokenInstances,
    cleanedBrokenInstanceCount: orphanCleanupResult.cleanedBrokenInstanceCount,
    cleanedOrphanMonsterCount: orphanCleanupResult.cleanedOrphanMonsterCount,
    cleanedOrphanMapCount: orphanCleanupResult.cleanedOrphanMapCount,
    cleanedOrphanRunCount: orphanCleanupResult.cleanedOrphanRunCount,
    cleanedOrphanInstanceMonsterCount: orphanCleanupResult.cleanedOrphanInstanceMonsterCount,
  };
}

export async function forceCleanupSecretRealmInstances(
  instanceIds: string[],
  nowIso = new Date().toISOString(),
): Promise<SecretRealmRuntimeCleanupResult> {
  const uniqueInstanceIds = Array.from(new Set(
    instanceIds
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  ));

  const summary = createEmptySecretRealmCleanupResult();
  if (uniqueInstanceIds.length === 0) {
    return summary;
  }

  const instances = await db.select()
    .from(mapInstances)
    .where(inArray(mapInstances.id, uniqueInstanceIds))
    .all();

  for (const instance of instances) {
    const cleanupResult = await tryFinalizeSecretRealmInstanceCleanup({
      instance,
      nowIso,
    });
    mergeSecretRealmCleanupResult(summary, cleanupResult);
  }

  return summary;
}

export async function enterSecretRealm(params: {
  playerId: string;
  spawnId: string;
}) {
  const player = await db.select().from(players).where(eq(players.id, params.playerId)).get();
  if (!player) {
    throw new Error("玩家不存在");
  }

  const spawn = await db.select().from(secretRealmSpawns).where(eq(secretRealmSpawns.id, params.spawnId)).get();
  if (!spawn || spawn.status === "expired" || spawn.status === "completed") {
    throw new Error("秘境入口已消散");
  }
  if (spawn.mapId !== player.currentMapId) {
    throw new Error("你不在秘境入口所在地图");
  }
  if (spawn.spawnType === "personal") {
    const visiblePlayerIds = Array.isArray(spawn.visiblePlayerIds) ? spawn.visiblePlayerIds : [];
    if (spawn.ownerPlayerId !== player.id && !visiblePlayerIds.includes(player.id)) {
      throw new Error("此秘境入口对你不可见");
    }
  }

  const template = await db.select().from(secretRealmTemplates).where(eq(secretRealmTemplates.id, spawn.templateId)).get();
  if (!template) {
    throw new Error("秘境模板不存在");
  }

  let instance = spawn.instanceId
    ? await db.select().from(mapInstances).where(eq(mapInstances.id, spawn.instanceId)).get()
    : null;
  if (instance && instance.status !== "active") {
    instance = await repairSecretRealmInstanceStatusIfNeeded({
      instanceId: instance.id,
      playerId: player.id,
    });
  }
  if (instance && instance.status !== "active") {
    instance = null;
  }
  if (!instance) {
    instance = await createSecretRealmMapInstance({ spawn, template });
  }
  if (!instance) {
    throw new Error("秘境实例创建失败");
  }

  const members = await resolveEntryMembers(player, spawn);
  await movePlayersIntoInstance({
    instance,
    members,
  });

  if (spawn.spawnType === "personal") {
    await db.update(secretRealmSpawns).set({
      status: "entered",
      enteredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(secretRealmSpawns.id, spawn.id)).run();
  }

  return {
    instanceId: instance.id,
    mapId: instance.mapId,
    mapName: `${template.name}·秘境`,
  };
}

export async function leaveSecretRealmForPlayer(playerId: string): Promise<SecretRealmPlayerReturnResult> {
  const player = await db.select().from(players).where(eq(players.id, playerId)).get();
  if (!player) {
    throw new Error("玩家不存在");
  }
  const instanceId = await resolvePlayerSecretRealmInstanceId({
    playerId: player.id,
    currentMapInstanceId: player.currentMapInstanceId,
  });
  if (!instanceId) {
    return {
      mapId: player.currentMapId,
      positionX: player.positionX,
      positionY: player.positionY,
      alreadyLeft: true,
    };
  }

  const [instance, memberRow] = await Promise.all([
    db.select().from(mapInstances).where(eq(mapInstances.id, instanceId)).get(),
    db.select().from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, instanceId),
      eq(mapInstanceMembers.playerId, player.id),
    )).get(),
  ]);

  if (!instance || !memberRow || !memberRow.returnMapId) {
    const repaired = await moveSecretRealmPlayerToReturnPoint({
      playerId: player.id,
    });
    if (repaired) {
      return repaired;
    }
    return {
      mapId: player.currentMapId,
      positionX: player.positionX,
      positionY: player.positionY,
      alreadyLeft: true,
    };
  }

  const instanceSettled = Boolean(instance.completedAt) || instance.status === "completed" || instance.status === "settling";
  const standingOnReturnPortal = await isPlayerStandingOnSecretRealmReturnPortal({
    player,
    instance,
  });
  if (!instanceSettled && !standingOnReturnPortal) {
    throw new Error("需站在回返阵上，或等待 Boss 结算后才能离开。");
  }

  const leaveResult = await moveSecretRealmPlayerToReturnPoint({
    playerId: player.id,
  });
  if (leaveResult) {
    return leaveResult;
  }
  return {
    mapId: player.currentMapId,
    positionX: player.positionX,
    positionY: player.positionY,
    alreadyLeft: true,
  };
}

export async function getCurrentSecretRealmForPlayer(playerId: string): Promise<SecretRealmCurrentView | null> {
  const player = await db.select().from(players).where(eq(players.id, playerId)).get();
  if (!player) {
    return null;
  }

  const instanceId = await resolvePlayerSecretRealmInstanceId({
    playerId,
    currentMapInstanceId: player.currentMapInstanceId,
  });
  if (!instanceId) {
    return null;
  }

  await repairSecretRealmInstanceStatusIfNeeded({
    instanceId,
    playerId,
  });

  const instance = await db.select({
    id: mapInstances.id,
    mapId: mapInstances.mapId,
    sourceSpawnId: mapInstances.sourceSpawnId,
    templateId: mapInstances.templateId,
    status: mapInstances.status,
    accessType: mapInstances.accessType,
    ownerPlayerId: mapInstances.ownerPlayerId,
    recommendedRealm: mapInstances.recommendedRealm,
    rarity: mapInstances.rarity,
    expiresAt: mapInstances.expiresAt,
    completedAt: mapInstances.completedAt,
    bossMonsterId: mapInstances.bossMonsterId,
    sourceMapId: mapInstances.sourceMapId,
    sourceMapName: mapInstances.sourceMapName,
    returnPortalX: mapInstances.returnPortalX,
    returnPortalY: mapInstances.returnPortalY,
    name: secretRealmTemplates.name,
    description: secretRealmTemplates.description,
    announcementText: secretRealmTemplates.announcement,
    theme: secretRealmTemplates.theme,
    sizeTier: secretRealmTemplates.sizeTier,
    tags: secretRealmTemplates.tags,
    snapshotJson: secretRealmTemplates.snapshotJson,
  }).from(mapInstances)
    .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, mapInstances.templateId))
    .where(eq(mapInstances.id, instanceId))
    .get();

  if (!instance || !instance.sourceSpawnId || !instance.templateId) {
    await moveSecretRealmPlayerToReturnPoint({
      playerId,
    });
    return null;
  }

  const [members, run, bossMonster, bossLootRow] = await Promise.all([
    db.select({
      playerId: mapInstanceMembers.playerId,
    }).from(mapInstanceMembers).where(and(
      eq(mapInstanceMembers.instanceId, instance.id),
      eq(mapInstanceMembers.status, "active"),
    )).all(),
    db.select({
      summaryJson: secretRealmRuns.summaryJson,
    }).from(secretRealmRuns).where(eq(secretRealmRuns.instanceId, instance.id)).get(),
    instance.bossMonsterId
      ? getRuntimeMonsterById(instance.bossMonsterId)
      : Promise.resolve(null),
    instance.bossMonsterId
      ? db.select({
        lootBlueprintJson: mapInstanceMonsters.lootBlueprintJson,
      }).from(mapInstanceMonsters).where(and(
        eq(mapInstanceMonsters.instanceId, instance.id),
        eq(mapInstanceMonsters.monsterId, instance.bossMonsterId),
      )).get()
      : Promise.resolve(null),
  ]);

  const summary = (run?.summaryJson || {}) as SecretRealmRunSummary;
  const bossAlive = Boolean(instance.bossMonsterId) && !instance.completedAt;
  const standingOnReturnPortal = await isPlayerStandingOnSecretRealmReturnPortal({
    player,
    instance,
  });
  const canLeaveNow = (
    instance.status === "completed"
    || instance.status === "settling"
    || Boolean(instance.completedAt)
    || standingOnReturnPortal
  );
  const specialType = resolveSecretRealmSpecialType({
    name: instance.name,
    tags: instance.tags,
  });
  const bossGateStatus = normalizeSecretRealmBossGateStatus(summary.bossGate || null);
  const seedFocusView = buildSecretRealmSeedFocusView({
    theme: instance.theme,
    labels: Array.isArray(instance.tags) ? instance.tags.filter((tag): tag is string => typeof tag === "string") : [],
    recommendedRealm: instance.recommendedRealm,
    specialType,
  });
  const recommendedRealmName = await getRealmFullNameByLinearRealm(Math.max(1, Number(instance.recommendedRealm || 1)))
    .catch(() => `境界 ${Math.max(1, Number(instance.recommendedRealm || 1))}`);
  const wildWolfValleyBottleOwned = specialType === "wild_wolf_valley"
    ? await db.select({
      quantity: playerInventory.quantity,
    }).from(playerInventory).where(and(
      eq(playerInventory.playerId, playerId),
      eq(playerInventory.itemId, HONGMENG_BOTTLE_ITEM_ID),
    )).get().then((row) => Number(row?.quantity || 0) > 0)
    : false;
  const wildWolfValleyMobBottleChance = specialType === "wild_wolf_valley" && !wildWolfValleyBottleOwned
    ? getWildWolfValleyBottleChance({
      role: "normal",
      counter: Math.max(0, Number(player.wildWolfValleyMobBottlePityCounter || 0)),
    })
    : undefined;
  const wildWolfValleyBossBottleChance = specialType === "wild_wolf_valley" && !wildWolfValleyBottleOwned
    ? getWildWolfValleyBottleChance({
      role: "boss",
      counter: Math.max(0, Number(player.wildWolfValleyBossBottlePityCounter || 0)),
    })
    : undefined;
  const dropIntelPreview = bossLootRow?.lootBlueprintJson
    ? buildSecretRealmDropIntel(bossLootRow.lootBlueprintJson)
    : (instance.snapshotJson?.rewardPlan
      ? buildSecretRealmDropIntel(buildSecretRealmLootBlueprint({
        seed: `secret-realm-current-preview:${instance.id}:${instance.templateId}`,
        role: "boss",
        rewardPlan: instance.snapshotJson.rewardPlan,
        theme: instance.theme,
        labels: [instance.name, instance.description],
        instanceRarity: String(instance.rarity || "common"),
        recommendedRealm: Math.max(1, Number(instance.recommendedRealm || 1)),
      }))
      : []);

  return {
    instanceId: instance.id,
    mapId: instance.mapId,
    spawnId: instance.sourceSpawnId,
    templateId: instance.templateId,
    announcementText: instance.announcementText,
    theme: instance.theme,
    name: instance.name,
    description: instance.description,
    bossName: bossMonster?.name || "秘境之主",
    spawnType: instance.accessType === "personal" ? "personal" : "global",
    sizeTier: normalizeSecretRealmSizeTier(instance.sizeTier),
    rarity: normalizeSecretRealmRarity(instance.rarity),
    recommendedRealm: instance.recommendedRealm,
    recommendedRealmName,
    status: instance.status === "expired"
      ? "expired"
      : instance.status === "completed"
        ? "completed"
        : instance.status === "settling"
          ? "settling"
          : "active",
    ownerPlayerId: instance.ownerPlayerId,
    expiresAt: instance.expiresAt,
    memberPlayerIds: members.map((member) => member.playerId),
    memberCount: members.length,
    bossMonsterId: instance.bossMonsterId,
    bossAlive,
    bossDefeatedAt: summary.bossDefeatedAt || instance.completedAt || null,
    coreRewardOwnerPlayerId: summary.coreRewardOwnerPlayerId || null,
    sourceMapId: instance.sourceMapId,
    sourceMapName: instance.sourceMapName,
    returnPortalX: instance.returnPortalX,
    returnPortalY: instance.returnPortalY,
    canLeaveNow,
    specialType,
    showAttentionDot: Boolean(specialType),
    specialHint: getSecretRealmSpecialHint(specialType),
    wildWolfValleyBottleOwned,
    wildWolfValleyMobBottleChance,
    wildWolfValleyBossBottleChance,
    bossGateStatus,
    seedFocusTags: seedFocusView.seedFocusTags,
    hasHighTierSeedChance: seedFocusView.hasHighTierSeedChance,
    dropIntelPreview,
  };
}

export async function getSecretRealmContextByMonsterId(monsterId: string) {
  return await db.select({
    instanceId: mapInstances.id,
    spawnId: mapInstances.sourceSpawnId,
    accessType: mapInstances.accessType,
    templateName: secretRealmTemplates.name,
    bossBackground: secretRealmTemplates.bossBackground,
  }).from(mapInstanceMonsters)
    .innerJoin(mapInstances, eq(mapInstances.id, mapInstanceMonsters.instanceId))
    .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, mapInstances.templateId))
    .where(and(
      eq(mapInstanceMonsters.monsterId, monsterId),
      eq(mapInstanceMonsters.role, "boss"),
    ))
    .get();
}

export async function canChallengeSecretRealmBoss(monsterId: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const row = await db.select({
    instanceStatus: mapInstances.status,
    completedAt: mapInstances.completedAt,
    summaryJson: secretRealmRuns.summaryJson,
  }).from(mapInstanceMonsters)
    .innerJoin(mapInstances, eq(mapInstances.id, mapInstanceMonsters.instanceId))
    .leftJoin(secretRealmRuns, eq(secretRealmRuns.instanceId, mapInstances.id))
    .where(and(
      eq(mapInstanceMonsters.monsterId, monsterId),
      eq(mapInstanceMonsters.role, "boss"),
    ))
    .get();

  if (!row) {
    return { allowed: true };
  }
  if (row.instanceStatus !== "active" || Boolean(row.completedAt)) {
    return {
      allowed: false,
      reason: "该秘境已结束，无法再次挑战 Boss。",
    };
  }

  const bossGate = normalizeSecretRealmBossGateStatus((row.summaryJson as SecretRealmRunSummary | null)?.bossGate || null);
  if (bossGate && !bossGate.isUnlocked) {
    return {
      allowed: false,
      reason: `Boss 封印未破，还需击败 ${bossGate.remainingGuardCount} 个守卫，或再击败 ${bossGate.remainingClearCount} 只怪物，使剩余怪物降到半数以下。`,
    };
  }

  return { allowed: true };
}

export async function canStartCombatWithSecretRealmMonster(monsterId: string): Promise<{
  allowed: boolean;
  reason?: string;
  repairedInstanceId?: string | null;
}> {
  const runtime = await getSecretRealmMonsterRuntime(monsterId);
  if (!runtime) {
    return { allowed: true };
  }
  if (runtime.role === "boss") {
    return await canChallengeSecretRealmBoss(monsterId);
  }
  if (runtime.monsterStatus !== "alive") {
    return {
      allowed: false,
      reason: "这只秘境怪物已被击杀，当前秘境内不会复活。",
    };
  }
  if (runtime.instanceStatus !== "active") {
    const repairedInstance = await repairSecretRealmInstanceStatusIfNeeded({
      instanceId: runtime.instanceId,
    });
    if (repairedInstance?.status === "active") {
      return {
        allowed: true,
        repairedInstanceId: repairedInstance.id,
      };
    }
    return {
      allowed: false,
      reason: "该秘境已结束结算，无法再次挑战这只怪物。",
    };
  }
  return { allowed: true };
}

export async function markSecretRealmMonsterDefeated(params: {
  monsterId: string;
  defeatedByPlayerId: string;
}) {
  const runtime = await getSecretRealmMonsterRuntime(params.monsterId);
  if (!runtime || runtime.role === "boss") {
    return runtime;
  }

  const nowIso = new Date().toISOString();
  if (runtime.monsterStatus !== "alive") {
    return runtime;
  }

  await db.update(mapInstanceMonsters).set({
    status: "dead",
    defeatedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(mapInstanceMonsters.monsterId, params.monsterId)).run();

  if (runtime.runId) {
    const summary = await getSecretRealmRunSummary(runtime.runId);
    const defeatedMonsterIds = Array.from(new Set([
      ...(Array.isArray(summary.defeatedMonsterIds) ? summary.defeatedMonsterIds : []),
      params.monsterId,
    ]));
    const bossGate = normalizeSecretRealmBossGateStatus(summary.bossGate || null);
    const defeatedGuardMonsterIds = isSecretRealmBossGateGuard(summary, params.monsterId)
      ? Array.from(new Set([...(bossGate?.defeatedGuardMonsterIds || []), params.monsterId]))
      : (bossGate?.defeatedGuardMonsterIds || []);
    const nextBossGate = bossGate ? {
      ...bossGate,
      guardDefeated: Math.min(bossGate.guardRequired, defeatedGuardMonsterIds.length),
      defeatedGuardMonsterIds,
      clearDefeated: Math.min(bossGate.clearRequired, defeatedMonsterIds.length),
    } satisfies SecretRealmBossGateStatus : null;
    if (nextBossGate) {
      nextBossGate.isUnlocked = nextBossGate.guardDefeated >= nextBossGate.guardRequired || nextBossGate.clearDefeated >= nextBossGate.clearRequired;
      nextBossGate.remainingGuardCount = Math.max(0, nextBossGate.guardRequired - nextBossGate.guardDefeated);
      nextBossGate.remainingClearCount = Math.max(0, nextBossGate.clearRequired - nextBossGate.clearDefeated);
      if (nextBossGate.isUnlocked && !nextBossGate.unlockedAt) {
        nextBossGate.unlockedAt = nowIso;
      }
    }

    await db.update(secretRealmRuns).set({
      summaryJson: {
        ...summary,
        defeatedMonsterIds,
        defeatedMonsterCount: defeatedMonsterIds.length,
        lastDefeatedMonsterAt: nowIso,
        bossGate: nextBossGate,
      },
      updatedAt: nowIso,
    }).where(eq(secretRealmRuns.id, runtime.runId)).run();

    if (nextBossGate?.isUnlocked && !bossGate?.isUnlocked) {
      await db.transaction(async (tx) => {
        await unlockSecretRealmBossGateDoorsTx({
          tx,
          mapId: runtime.mapId,
          bossGate: nextBossGate,
          nowIso,
        });
      });
    }
  }

  clearMonsterAiRuntimeForMonsters({
    mapId: runtime.mapId,
    monsterIds: [params.monsterId],
  });
  advanceMapSceneTick(runtime.mapId);
  publishMapRefresh({
    mapId: runtime.mapId,
    reason: "monster_defeat",
  });

  return {
    ...runtime,
    monsterStatus: "dead",
  };
}

export async function recordSecretRealmMonsterRewardClaim(params: {
  monsterId: string;
  playerId: string;
  xp: number;
  gold: number;
  drops: SecretRealmRewardClaim["drops"];
  noRewardReason?: SecretRealmRewardClaim["noRewardReason"];
}) {
  const runtime = await getSecretRealmMonsterRuntime(params.monsterId);
  if (!runtime?.runId) {
    return;
  }

  const nowIso = new Date().toISOString();
  const summary = await getSecretRealmRunSummary(runtime.runId);
  const participantPlayerIds = Array.from(new Set([
    ...(Array.isArray(summary.participantPlayerIds) ? summary.participantPlayerIds : []),
    params.playerId,
  ]));

  await db.update(secretRealmRuns).set({
    summaryJson: {
      ...summary,
      participantPlayerIds,
    },
    updatedAt: nowIso,
  }).where(eq(secretRealmRuns.id, runtime.runId)).run();
}

export async function handleSecretRealmBossDefeated(params: {
  bossMonsterId: string;
  lastHitPlayerId: string;
  participantPlayerIds: string[];
}): Promise<{
  pityGrantedPlayerIds: string[];
  consolationRewardsByPlayerId: Record<string, SecretRealmConsolationDrop[]>;
} | null> {
  const bossContext = await db.select({
    instanceId: mapInstanceMonsters.instanceId,
    mapId: mapInstances.mapId,
    spawnId: mapInstances.sourceSpawnId,
    spawnType: mapInstances.accessType,
    instanceStatus: mapInstances.status,
    instanceCompletedAt: mapInstances.completedAt,
    runId: secretRealmRuns.id,
    runStatus: secretRealmRuns.status,
  }).from(mapInstanceMonsters)
    .innerJoin(mapInstances, eq(mapInstances.id, mapInstanceMonsters.instanceId))
    .leftJoin(secretRealmRuns, eq(secretRealmRuns.instanceId, mapInstances.id))
    .where(and(
      eq(mapInstanceMonsters.monsterId, params.bossMonsterId),
      eq(mapInstanceMonsters.role, "boss"),
    ))
    .get();

  if (!bossContext || !bossContext.spawnId) {
    return null;
  }

  if (
    bossContext.instanceStatus === "completed"
    || Boolean(bossContext.instanceCompletedAt)
    || bossContext.runStatus === "completed"
  ) {
    const previousSummary = bossContext.runId ? await getSecretRealmRunSummary(bossContext.runId) : {};
    return {
      pityGrantedPlayerIds: Array.isArray(previousSummary.pityGrantedPlayerIds) ? previousSummary.pityGrantedPlayerIds : [],
      consolationRewardsByPlayerId: {},
    };
  }

  const nowIso = new Date().toISOString();
  const pityGrantedPlayerIds = bossContext.spawnType === "global"
    ? params.participantPlayerIds.filter((playerId) => playerId !== params.lastHitPlayerId)
    : [];

  const settledInstance = await db.transaction(async (tx) => {
    const updatedInstance = await tx.update(mapInstances).set({
      status: "completed",
      settledAt: nowIso,
      completedAt: nowIso,
      expiresAt: toExpiryIso(SECRET_REALM_SETTLE_LIFETIME_MS),
      updatedAt: nowIso,
    }).where(and(
      eq(mapInstances.id, bossContext.instanceId),
      ne(mapInstances.status, "completed"),
    )).returning({
      id: mapInstances.id,
    }).get();
    if (!updatedInstance) {
      return null;
    }

    await tx.update(mapInstanceMonsters).set({
      status: "dead",
      defeatedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(mapInstanceMonsters.monsterId, params.bossMonsterId)).run();

    if (bossContext.runId) {
      const rows = await tx.execute<{ summary_json: SecretRealmRunSummary | null }>(
        sql`
          SELECT "summary_json"
          FROM "secret_realm_runs"
          WHERE "id" = ${bossContext.runId}
          FOR UPDATE
        `,
      );
      const previousSummary = (rows[0]?.summary_json || {}) as SecretRealmRunSummary;
      const defeatedMonsterIds = Array.from(new Set([
        ...(Array.isArray(previousSummary.defeatedMonsterIds) ? previousSummary.defeatedMonsterIds : []),
        params.bossMonsterId,
      ]));
      const summary: SecretRealmRunSummary = {
        ...previousSummary,
        coreRewardOwnerPlayerId: params.lastHitPlayerId,
        participantPlayerIds: params.participantPlayerIds,
        pityGrantedPlayerIds,
        bossMonsterId: params.bossMonsterId,
        bossDefeatedAt: nowIso,
        defeatedMonsterIds,
        defeatedMonsterCount: defeatedMonsterIds.length,
        lastDefeatedMonsterAt: nowIso,
      };

      await tx.update(secretRealmRuns).set({
        status: "completed",
        summaryJson: summary,
        updatedAt: nowIso,
        finishedAt: nowIso,
      }).where(eq(secretRealmRuns.id, bossContext.runId)).run();
    }

    return updatedInstance;
  });
  if (!settledInstance) {
    const previousSummary = bossContext.runId ? await getSecretRealmRunSummary(bossContext.runId) : {};
    return {
      pityGrantedPlayerIds: Array.isArray(previousSummary.pityGrantedPlayerIds) ? previousSummary.pityGrantedPlayerIds : [],
      consolationRewardsByPlayerId: {},
    };
  }

  try {
    await markSecretRealmSpawnCompleted(bossContext.spawnId);
  } catch (error) {
    console.error("Secret realm boss settle spawn complete error:", error);
  }

  if (pityGrantedPlayerIds.length > 0) {
    try {
      await incrementSecretRealmPityCounter(pityGrantedPlayerIds);
    } catch (error) {
      console.error("Secret realm boss settle pity error:", error);
    }
  }

  try {
    const completedInstance = await db.select()
      .from(mapInstances)
      .where(eq(mapInstances.id, bossContext.instanceId))
      .get();
    if (completedInstance) {
      await evacuateSecretRealmMembers({
        instance: completedInstance,
        nowIso,
      });
    }
  } catch (error) {
    console.error("Secret realm boss settle evacuate members error:", error);
  }

  try {
    clearMonsterAiRuntimeForMonsters({
      mapId: bossContext.mapId,
      monsterIds: [params.bossMonsterId],
    });
    advanceMapSceneTick(bossContext.mapId);
    publishMapRefresh({
      mapId: bossContext.mapId,
      reason: "monster_defeat",
    });
  } catch (error) {
    console.error("Secret realm boss settle refresh error:", error);
  }

  return {
    pityGrantedPlayerIds,
    consolationRewardsByPlayerId: {},
  };
}
