import { asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  players,
  worldMapInstances,
  worldNpcLifeLogs,
  worldNpcProfiles,
  worldNpcRuntime,
} from "@/db/schema";
import { createTiandaoNearbyChatMessage, createWorldNpcNearbyChatMessage } from "@/modules/world/services/world-nearby-chat";
import { ensureOpenWorldBootstrap } from "@/modules/world/services/world-map-service";
import {
  isWorldNpcThreatActive,
  reincarnateWorldNpc,
  reinforceWorldNpcFactionSupport,
} from "@/modules/world/services/world-npc-service";
import { ensureOpenWorldDistrictRumors } from "@/modules/world/services/world-rumor-service";
import {
  OPEN_WORLD_ACTIVE_NPC_LIMIT,
  buildOpenWorldNpcActionLabel,
  resolveOpenWorldNpcDisposition,
  warmOpenWorldAiKeywordPool,
} from "@/modules/world/services/world-config";
import {
  generateOpenWorldNpcBark,
  generateOpenWorldTiandaoEvent,
} from "@/modules/world/services/world-ai-generation";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import { advanceOpenWorldNpcGrowth } from "@/modules/world/services/world-npc-growth";
import {
  buildWorldMapBlockedTileKeySet,
  resolveNearestWorldMapWalkablePosition,
} from "@/modules/world/services/world-map-walkable";
import {
  listOnlineWorldConflictPlayers,
  queueOpenWorldAssassinationEvent,
} from "@/modules/world/services/world-player-conflict-runtime";
import { applyPlayerWorldIncident } from "@/modules/world/services/player-world-pressure-service";
import { processNpcMarketPurchases } from "@/modules/character/services/market-service";

const ACTION_CYCLE = ["wander", "gather", "hunt", "loot", "return", "stall"] as const;
type OnlineWorldConflictPlayer = ReturnType<typeof listOnlineWorldConflictPlayers>[number];
type TiandaoBlockedTileCacheEntry = {
  cacheKey: string;
  blockedTileKeys: Set<string>;
};
type TiandaoBlockedTileCacheGlobal = typeof globalThis & {
  __tiandaoBlockedTileCacheByMapId?: Map<string, TiandaoBlockedTileCacheEntry>;
};

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function clampToMap(value: number, max: number) {
  return Math.max(1, Math.min(max - 2, value));
}

function resolveOpenWorldMapDisplayName(mapName: string | null | undefined, mapId: string | null | undefined) {
  const normalizedName = String(mapName || "").trim();
  if (normalizedName) {
    return normalizedName;
  }
  const normalizedMapId = String(mapId || "").trim();
  if (normalizedMapId.startsWith("world_open_")) {
    return "此方天地";
  }
  return normalizedMapId || "此地";
}

function getTiandaoBlockedTileCache() {
  const globalStore = globalThis as TiandaoBlockedTileCacheGlobal;
  globalStore.__tiandaoBlockedTileCacheByMapId = globalStore.__tiandaoBlockedTileCacheByMapId || new Map<string, TiandaoBlockedTileCacheEntry>();
  return globalStore.__tiandaoBlockedTileCacheByMapId;
}

function getCachedBlockedTileKeysForMap(mapRow: typeof worldMapInstances.$inferSelect) {
  const cache = getTiandaoBlockedTileCache();
  const cacheKey = `${String(mapRow.updatedAt || mapRow.createdAt || "")}:${mapRow.width}x${mapRow.height}`;
  const cached = cache.get(mapRow.id);
  if (cached && cached.cacheKey === cacheKey) {
    return cached.blockedTileKeys;
  }
  const blockedTileKeys = buildWorldMapBlockedTileKeySet(mapRow.tilesData, mapRow.width, mapRow.height);
  cache.set(mapRow.id, {
    cacheKey,
    blockedTileKeys,
  });
  return blockedTileKeys;
}

function buildNextAction(seed: string) {
  return ACTION_CYCLE[hashSeed(seed) % ACTION_CYCLE.length];
}

function moveByAction(params: {
  x: number;
  y: number;
  action: typeof ACTION_CYCLE[number];
  width: number;
  height: number;
  seed: string;
}) {
  const drift = (hashSeed(`${params.seed}:${params.action}`) % 3) - 1;
  if (params.action === "gather") {
    return {
      x: clampToMap(params.x + drift, params.width),
      y: clampToMap(params.y + 1, params.height),
    };
  }
  if (params.action === "hunt") {
    return {
      x: clampToMap(params.x + 1, params.width),
      y: clampToMap(params.y + drift, params.height),
    };
  }
  if (params.action === "return") {
    return {
      x: clampToMap(params.x - 1, params.width),
      y: clampToMap(params.y + drift, params.height),
    };
  }
  if (params.action === "stall") {
    return {
      x: params.x,
      y: params.y,
    };
  }
  return {
    x: clampToMap(params.x + drift, params.width),
    y: clampToMap(params.y + ((hashSeed(`${params.seed}:vertical`) % 3) - 1), params.height),
  };
}

function moveTowardTarget(params: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
}) {
  const stepX = params.targetX === params.x ? 0 : (params.targetX > params.x ? 1 : -1);
  const stepY = params.targetY === params.y ? 0 : (params.targetY > params.y ? 1 : -1);
  return {
    x: clampToMap(params.x + stepX, params.width),
    y: clampToMap(params.y + stepY, params.height),
  };
}

function resolveNpcStepPosition(params: {
  currentX: number;
  currentY: number;
  desiredX: number;
  desiredY: number;
  width: number;
  height: number;
  blockedTileKeys: Set<string>;
  avoidPoints?: Array<{ x: number; y: number }>;
}) {
  const preferred = {
    x: clampToMap(params.desiredX, params.width),
    y: clampToMap(params.desiredY, params.height),
  };
  const candidatePoints = [
    preferred,
    { x: preferred.x, y: params.currentY },
    { x: params.currentX, y: preferred.y },
    { x: params.currentX, y: params.currentY },
  ];

  return resolveNearestWorldMapWalkablePosition({
    preferred,
    width: params.width,
    height: params.height,
    blockedTileKeys: params.blockedTileKeys,
    candidatePoints,
    maxRadius: 2,
    avoidPoints: params.avoidPoints,
    minDistanceFromAvoidPoints: 2,
  });
}

function chebyshevDistance(leftX: number, leftY: number, rightX: number, rightY: number) {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
}

function clampChance(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveAssassinationThreatLevel(score: number) {
  if (score >= 82) {
    return "high" as const;
  }
  if (score >= 60) {
    return "medium" as const;
  }
  return "low" as const;
}

async function tryQueueWorldNpcAssassination(params: {
  mapRow: typeof worldMapInstances.$inferSelect;
  npcRow: {
    profile: typeof worldNpcProfiles.$inferSelect;
    runtime: typeof worldNpcRuntime.$inferSelect;
  };
  nextPosition: {
    x: number;
    y: number;
  };
  onlinePlayers: OnlineWorldConflictPlayer[];
}) {
  if (params.onlinePlayers.length <= 0) {
    return false;
  }

  const disposition = resolveOpenWorldNpcDisposition({
    faction: params.npcRow.profile.faction,
    profession: params.npcRow.profile.profession,
    traitTags: params.npcRow.profile.traitTags,
    realmMinor: params.npcRow.profile.realmMinor,
  });
  if (disposition.alignment === "orthodox" || disposition.assassinationBias < 0.08) {
    return false;
  }

  const districtName = resolveOpenWorldDistrictName({
    mapId: params.mapRow.id,
    positionX: params.nextPosition.x,
    positionY: params.nextPosition.y,
  });
  const candidates = params.onlinePlayers
    .map((player) => {
      const sameMap = player.mapId === params.mapRow.id;
      const distance = sameMap
        ? chebyshevDistance(
          params.nextPosition.x,
          params.nextPosition.y,
          player.positionX,
          player.positionY,
        )
        : null;
      const realmGap = Math.max(-3, Math.min(4, params.npcRow.profile.realmMinor - player.realm));
      const opportunityScore = disposition.shadowScore
        + realmGap * 9
        + (sameMap ? 12 : -8)
        - (distance === null ? 0 : Math.max(0, distance - 5) * 4);
      return {
        player,
        sameMap,
        distance,
        realmGap,
        opportunityScore,
      };
    })
    .filter((entry) => entry.distance === null || entry.distance <= 18)
    .filter((entry) => entry.opportunityScore >= (entry.sameMap ? 42 : 48))
    .sort((left, right) => (
      Number(right.sameMap) - Number(left.sameMap)
      || right.opportunityScore - left.opportunityScore
      || (left.distance ?? 99) - (right.distance ?? 99)
    ));
  const target = candidates[0];
  if (!target) {
    return false;
  }

  const attemptChance = clampChance(
    disposition.assassinationBias
    + Math.max(0, target.realmGap) * 0.09
    - Math.max(0, (target.distance ?? 4) - 4) * 0.012
    - (target.sameMap ? 0 : 0.08),
    disposition.alignment === "shadow" ? 0.18 : 0.1,
    disposition.alignment === "shadow" ? 0.72 : 0.48,
  );
  const attemptRoll = hashSeed(
    `${params.npcRow.profile.id}:${target.player.playerId}:${Date.now() >> 16}:${params.nextPosition.x}:${params.nextPosition.y}`,
  ) % 100;
  if (attemptRoll >= Math.round(attemptChance * 100)) {
    return false;
  }

  const threatScore = disposition.shadowScore
    + Math.max(0, target.realmGap) * 11
    + Math.max(0, 8 - (target.distance ?? 6)) * 2
    + (target.sameMap ? 6 : 0);
  const threatLevel = resolveAssassinationThreatLevel(threatScore);
  const escapeChance = clampChance(
    0.58
    - Math.max(0, target.realmGap) * 0.1
    + Math.max(0, (target.distance ?? 5) - 3) * 0.015
    - disposition.shadowScore * 0.0022,
    0.14,
    0.74,
  );
  const targetLocationLabel = target.player.mapName || "你当前落脚之地";
  const eventDistrictName = target.sameMap ? districtName : null;
  const probeSummary = target.sameMap
    ? (
      disposition.alignment === "shadow"
        ? `${params.npcRow.profile.name}多半已在${districtName || "暗处"}盯了你一阵，像是在掂量下手的时机。`
        : `${params.npcRow.profile.name}反复打量你的气机，像是在权衡你是否值得冒险出手。`
    )
    : `${params.npcRow.profile.name}像是顺着你的气机一路摸到了${targetLocationLabel}附近，正在试探你是否露出破绽。`;
  const assassinationSummary = threatLevel === "high"
    ? `${params.npcRow.profile.name}的杀机已经逼近，若不能及时抽身，多半会被强行拖入厮杀。`
    : threatLevel === "medium"
      ? `${params.npcRow.profile.name}收起了表面客气，正在沿着你的行迹缓慢逼来。`
      : `${params.npcRow.profile.name}动了歹念，却还在试探你的虚实。`;
  const intro = target.sameMap
    ? `${params.npcRow.profile.name}来自${disposition.alignmentLabel}一侧，方才像是不经意地打探了你的行踪。`
    : `${params.npcRow.profile.name}来自${disposition.alignmentLabel}一侧，像是顺着旧风声一路追到了${targetLocationLabel}。`;
  const queued = queueOpenWorldAssassinationEvent({
    playerId: target.player.playerId,
    mapId: target.player.mapId,
    npcId: params.npcRow.profile.id,
    npcName: params.npcRow.profile.name,
    npcRealmName: params.npcRow.profile.realmName,
    npcFaction: params.npcRow.profile.faction,
    npcProfession: params.npcRow.profile.profession,
    districtName: eventDistrictName,
    threatLevel,
    probeSummary,
    assassinationSummary,
    intro,
    escapeChance,
  });
  if (!queued.queued) {
    return false;
  }

  await applyPlayerWorldIncident({
    playerId: target.player.playerId,
    incidentType: "tracking_notice",
    sourceType: "world_npc",
    sourceId: params.npcRow.profile.id,
    mapId: params.mapRow.id,
    districtName,
    severity: threatLevel === "high" ? 4 : threatLevel === "medium" ? 3 : 2,
    summary: threatLevel === "high"
      ? `${params.npcRow.profile.name}已沿着你的行迹追到${targetLocationLabel}附近，对你起了杀心。`
      : `${params.npcRow.profile.name}正在${targetLocationLabel}附近试探你的行迹。`,
    payloadJson: {
      npcId: params.npcRow.profile.id,
      npcName: params.npcRow.profile.name,
      threatLevel,
      districtName: eventDistrictName,
      targetMapId: target.player.mapId,
      targetMapName: targetLocationLabel,
      sameMap: target.sameMap,
    },
    sendMail: threatLevel === "high",
  });

  await db.insert(worldNpcLifeLogs).values({
    npcId: params.npcRow.profile.id,
    logType: threatLevel === "high" ? "assassination_intent" : "shadow_probe",
    title: threatLevel === "high" ? "暗中起杀心" : "暗中打探",
    content: threatLevel === "high"
      ? `${params.npcRow.profile.name}在${districtName || "附近"}锁定了${target.player.playerName}的气机，准备择机下手。`
      : `${params.npcRow.profile.name}在${districtName || "附近"}暗中试探了${target.player.playerName}的虚实。`,
    payloadJson: {
      playerId: target.player.playerId,
      playerName: target.player.playerName,
      districtName,
      disposition: disposition.alignment,
      shadowScore: disposition.shadowScore,
      threatLevel,
      escapeChance,
    },
    createdAt: new Date().toISOString(),
  }).run();

  return true;
}

export async function runTiandaoTick() {
  await warmOpenWorldAiKeywordPool();
  await processNpcMarketPurchases({ limit: 6 });
  if (!(await ensureOpenWorldBootstrap())) {
    return {
      success: false,
      summary: {
        worldTime: new Date().toISOString(),
        activeMapCount: 0,
        frozenMapCount: 0,
        npcEventCount: 0,
        reincarnationCount: 0,
        lifeLogCount: 0,
      },
    };
  }

  const mapRows = await db.select().from(worldMapInstances).orderBy(asc(worldMapInstances.createdAt)).all();
  const mapIds = mapRows.map((row) => row.id);
  const onlineWorldConflictPlayers = listOnlineWorldConflictPlayers();
  const [playerRows, npcRows] = await Promise.all([
    mapIds.length > 0
      ? db.select({
        id: players.id,
        currentMapId: players.currentMapId,
        positionX: players.positionX,
        positionY: players.positionY,
      }).from(players).where(inArray(players.currentMapId, mapIds)).all()
      : Promise.resolve([]),
    db.select({
      profile: worldNpcProfiles,
      runtime: worldNpcRuntime,
    }).from(worldNpcProfiles)
      .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
      .all(),
  ]);

  const playerCountByMap = new Map<string, number>();
  const playerById = new Map<string, { currentMapId: string | null; positionX: number; positionY: number }>();
  for (const row of playerRows) {
    const currentMapId = String(row.currentMapId || "").trim();
    playerById.set(row.id, {
      currentMapId: currentMapId || null,
      positionX: row.positionX,
      positionY: row.positionY,
    });
    if (!currentMapId) {
      continue;
    }
    playerCountByMap.set(currentMapId, (playerCountByMap.get(currentMapId) || 0) + 1);
  }

  const mapMeta = new Map(mapRows.map((row) => [row.id, row]));
  const npcRowsByMapId = new Map<string, typeof npcRows>();
  const deadNpcRows: typeof npcRows = [];
  for (const npcRow of npcRows) {
    if (npcRow.profile.status === "dead") {
      deadNpcRows.push(npcRow);
      continue;
    }
    const currentRows = npcRowsByMapId.get(npcRow.runtime.currentMapId) || [];
    currentRows.push(npcRow);
    npcRowsByMapId.set(npcRow.runtime.currentMapId, currentRows);
  }
  let npcEventCount = 0;
  let reincarnationCount = 0;
  let aiBarkCount = 0;
  let rumorRefreshCount = 0;
  let activeMapCount = 0;
  let frozenMapCount = 0;

  for (const mapRow of mapRows) {
    const blockedTileKeys = getCachedBlockedTileKeysForMap(mapRow);
    const playerCount = playerCountByMap.get(mapRow.id) || 0;
    let assassinationQueuedForMap = false;
    const nextStatus = playerCount > 0 ? "active" : "frozen";
    if (nextStatus === "active") {
      activeMapCount += 1;
    } else {
      frozenMapCount += 1;
    }
    if (mapRow.status !== nextStatus) {
      await db.update(worldMapInstances).set({
        status: nextStatus,
        frozenAt: nextStatus === "frozen" ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      }).where(eq(worldMapInstances.id, mapRow.id)).run();

      if (nextStatus === "frozen" || nextStatus === "active") {
        const eventResult = await generateOpenWorldTiandaoEvent({
          eventType: nextStatus === "frozen" ? "map_frozen" : "map_active",
          mapName: mapRow.name,
          mapArchetype: mapRow.archetype,
          detail: nextStatus === "frozen"
            ? `${mapRow.name}因无人驻足而归于静默。`
            : `${mapRow.name}再度被修士气机惊醒，尘嚣渐起。`,
        });
        await createTiandaoNearbyChatMessage({
          mapId: mapRow.id,
          content: eventResult.content,
        });
      }
    }

    const rumorRefresh = await ensureOpenWorldDistrictRumors(mapRow.id);
    if (rumorRefresh.refreshed && rumorRefresh.rumors.length > 0) {
      rumorRefreshCount += 1;
      const primaryRumor = rumorRefresh.rumors.find((entry) => entry.heat === "high")
        || rumorRefresh.rumors[0];
      await createTiandaoNearbyChatMessage({
        mapId: mapRow.id,
        districtName: primaryRumor.districtName,
        content: `【街谈风闻】${primaryRumor.districtName}近来都在传：${primaryRumor.content}`,
      });
      npcEventCount += 1;
    }

    const mapNpcRows = npcRowsByMapId.get(mapRow.id) || [];
    const sortedAliveNpcRows = [...mapNpcRows].sort((left, right) => left.profile.id.localeCompare(right.profile.id));
    const currentSafePositionByNpcId = new Map<string, { x: number; y: number }>();
    for (const npcRow of sortedAliveNpcRows) {
      currentSafePositionByNpcId.set(npcRow.profile.id, resolveNearestWorldMapWalkablePosition({
        preferred: {
          x: npcRow.runtime.positionX,
          y: npcRow.runtime.positionY,
        },
        width: mapRow.width,
        height: mapRow.height,
        blockedTileKeys,
      }));
    }
    const nextReservedPositionByNpcId = new Map<string, { x: number; y: number }>();

    for (let index = 0; index < sortedAliveNpcRows.length; index += 1) {
      const row = sortedAliveNpcRows[index];
      const shouldActivate = nextStatus === "active" && index < OPEN_WORLD_ACTIVE_NPC_LIMIT;
      if (row.runtime.isActivated !== shouldActivate) {
        await db.update(worldNpcRuntime).set({
          isActivated: shouldActivate,
          updatedAt: new Date().toISOString(),
        }).where(eq(worldNpcRuntime.npcId, row.profile.id)).run();
      }

      if (!shouldActivate) {
        continue;
      }

      const actionSeed = `${row.profile.dnaSeed}:${Date.now() >> 16}:${index}`;
      const threatActive = isWorldNpcThreatActive(row.runtime);
      const threatTargetId = String(row.runtime.currentTargetId || "").trim();
      const threatTargetPlayer = threatActive ? playerById.get(threatTargetId) : null;
      const threatTargetOnSameMap = threatActive
        && threatTargetPlayer
        && threatTargetPlayer.currentMapId === mapRow.id;
      const safeCurrentPosition = currentSafePositionByNpcId.get(row.profile.id) || resolveNearestWorldMapWalkablePosition({
        preferred: {
          x: row.runtime.positionX,
          y: row.runtime.positionY,
        },
        width: mapRow.width,
        height: mapRow.height,
        blockedTileKeys,
      });
      const avoidPoints = sortedAliveNpcRows
        .filter((candidate) => candidate.profile.id !== row.profile.id)
        .map((candidate) => (
          nextReservedPositionByNpcId.get(candidate.profile.id)
          || currentSafePositionByNpcId.get(candidate.profile.id)
        ))
        .filter((point): point is { x: number; y: number } => Boolean(point));
      const nextAction = threatTargetOnSameMap ? "hunt" : buildNextAction(actionSeed);
      const desiredNextPosition = threatTargetOnSameMap
        ? moveTowardTarget({
          x: safeCurrentPosition.x,
          y: safeCurrentPosition.y,
          targetX: threatTargetPlayer.positionX,
          targetY: threatTargetPlayer.positionY,
          width: mapRow.width,
          height: mapRow.height,
        })
        : moveByAction({
          x: safeCurrentPosition.x,
          y: safeCurrentPosition.y,
          action: nextAction,
          width: mapRow.width,
          height: mapRow.height,
          seed: actionSeed,
        });
      const nextPosition = resolveNpcStepPosition({
        currentX: safeCurrentPosition.x,
        currentY: safeCurrentPosition.y,
        desiredX: desiredNextPosition.x,
        desiredY: desiredNextPosition.y,
        width: mapRow.width,
        height: mapRow.height,
        blockedTileKeys,
        avoidPoints,
      });
      nextReservedPositionByNpcId.set(row.profile.id, nextPosition);
      const growthResult = advanceOpenWorldNpcGrowth({
        npcId: row.profile.id,
        npcName: row.profile.name,
        dnaSeed: row.profile.dnaSeed,
        profession: row.profile.profession,
        traitTags: row.profile.traitTags,
        realmMinor: row.profile.realmMinor,
        currentAction: nextAction,
        statsSummary: row.profile.statsSummary,
      });

      const now = new Date().toISOString();
      const shouldClearThreat = row.runtime.currentTargetType === "player_hostility"
        && (!threatActive || !threatTargetPlayer || threatTargetPlayer.currentMapId !== mapRow.id);
      await Promise.all([
        db.update(worldNpcRuntime).set({
          positionX: nextPosition.x,
          positionY: nextPosition.y,
          currentAction: nextAction,
          currentActionLabel: threatTargetOnSameMap
            ? "追缉仇敌"
            : buildOpenWorldNpcActionLabel({
              action: nextAction,
              seed: `${row.profile.dnaSeed}:tick:${index}`,
              profession: row.profile.profession,
              faction: row.profile.faction,
              traitTags: row.profile.traitTags,
            }),
          currentTargetType: shouldClearThreat ? null : row.runtime.currentTargetType,
          currentTargetId: shouldClearThreat ? null : row.runtime.currentTargetId,
          nextActionAt: shouldClearThreat ? null : row.runtime.nextActionAt,
          lastActionAt: now,
          updatedAt: now,
        }).where(eq(worldNpcRuntime.npcId, row.profile.id)).run(),
        db.update(worldNpcProfiles).set({
          realmMinor: growthResult.realmMinor,
          realmName: growthResult.realmName,
          statsSummary: growthResult.statsSummary,
          updatedAt: now,
        }).where(eq(worldNpcProfiles.id, row.profile.id)).run(),
      ]);

      if (threatTargetOnSameMap && threatTargetId) {
        const supportResult = await reinforceWorldNpcFactionSupport({
          mapId: mapRow.id,
          playerId: threatTargetId,
          sourceNpcId: row.profile.id,
          sourceNpcName: row.profile.name,
          sourceFaction: row.profile.faction,
          sourceDistrictName: resolveOpenWorldDistrictName({
            mapId: mapRow.id,
            positionX: nextPosition.x,
            positionY: nextPosition.y,
          }),
          sourcePositionX: nextPosition.x,
          sourcePositionY: nextPosition.y,
        });
        npcEventCount += supportResult.supportCount;
      }

      if (shouldClearThreat && threatTargetId) {
        await db.insert(worldNpcLifeLogs).values({
          npcId: row.profile.id,
          logType: "hostility_faded",
          title: "仇怨渐散",
          content: `${row.profile.name}再也寻不到那股来犯气机，戒备心终于缓了下来。`,
          payloadJson: {
            targetPlayerId: threatTargetId,
          },
          createdAt: now,
        }).run();
        npcEventCount += 1;
      }

      if (growthResult.breakthroughLog) {
        await db.insert(worldNpcLifeLogs).values({
          npcId: row.profile.id,
          logType: growthResult.breakthroughLog.logType,
          title: growthResult.breakthroughLog.title,
          content: growthResult.breakthroughLog.content,
          payloadJson: growthResult.breakthroughLog.payloadJson,
          createdAt: now,
        }).run();
        npcEventCount += 1;
      }

      if (
        !assassinationQueuedForMap
        && nextStatus === "active"
        && onlineWorldConflictPlayers.length > 0
        && !threatTargetOnSameMap
        && !row.runtime.occupiedByCombatId
      ) {
        const queuedAssassination = await tryQueueWorldNpcAssassination({
          mapRow,
          npcRow: row,
          nextPosition,
          onlinePlayers: onlineWorldConflictPlayers,
        });
        if (queuedAssassination) {
          assassinationQueuedForMap = true;
          npcEventCount += 1;
        }
      }

      if ((hashSeed(`${actionSeed}:bark`) % 7) === 0) {
        const currentDistrictName = resolveOpenWorldDistrictName({
          mapId: mapRow.id,
          positionX: nextPosition.x,
          positionY: nextPosition.y,
        });
        const barkResult = aiBarkCount < 2
          ? await generateOpenWorldNpcBark({
            seed: actionSeed,
            mapName: mapRow.name,
            mapArchetype: mapRow.archetype,
            currentDistrictName,
            npcName: row.profile.name,
            profession: row.profile.profession || "散修",
            realmName: growthResult.realmName,
            personalitySummary: row.profile.personalitySummary,
            currentActionLabel: threatTargetOnSameMap
              ? "追缉仇敌"
              : buildOpenWorldNpcActionLabel({
                action: nextAction,
                seed: `${row.profile.dnaSeed}:bark:${index}`,
                profession: row.profile.profession,
                faction: row.profile.faction,
                traitTags: row.profile.traitTags,
              }),
          })
          : {
            content: threatTargetOnSameMap
              ? `${row.profile.name}神色戒备，像是在追索一股熟悉的来犯气机。`
              : `${row.profile.name}${buildOpenWorldNpcActionLabel({
                action: nextAction,
                seed: `${row.profile.dnaSeed}:fallback-bark:${index}`,
                profession: row.profile.profession,
                faction: row.profile.faction,
                traitTags: row.profile.traitTags,
              })}，还顺手惦记着几分人情往来。`,
          };
        if (aiBarkCount < 2) {
          aiBarkCount += 1;
        }
        await createWorldNpcNearbyChatMessage({
          mapId: mapRow.id,
          npcId: row.profile.id,
          senderName: row.profile.name,
          content: barkResult.content,
        });
        npcEventCount += 1;
      }
    }
  }

  for (const row of deadNpcRows) {
    const updatedAt = Date.parse(String(row.runtime.updatedAt || ""));
    if (Number.isFinite(updatedAt) && (Date.now() - updatedAt) < 30_000) {
      continue;
    }
    const result = await reincarnateWorldNpc(row.profile.id);
    if (!result) {
      continue;
    }
    reincarnationCount += 1;
    const currentMapRow = mapMeta.get(row.runtime.currentMapId);
    const currentMapName = resolveOpenWorldMapDisplayName(currentMapRow?.name, row.runtime.currentMapId);
    const eventResult = await generateOpenWorldTiandaoEvent({
      eventType: "reincarnation",
      mapName: currentMapName,
      mapArchetype: currentMapRow?.archetype || "边荒据点",
      actorName: result.name,
      detail: `${result.name}承接旧缘，于${currentMapName}再度入世。`,
    });
    await createTiandaoNearbyChatMessage({
      mapId: row.runtime.currentMapId,
      content: eventResult.content,
    });
  }

  const lifeLogCountRow = await db.select({
    value: count(),
  }).from(worldNpcLifeLogs).get();

  return {
    success: true,
    summary: {
      worldTime: new Date().toISOString(),
      activeMapCount,
      frozenMapCount,
      npcEventCount,
      rumorRefreshCount,
      reincarnationCount,
      lifeLogCount: Number(lifeLogCountRow?.value || 0),
    },
  };
}
