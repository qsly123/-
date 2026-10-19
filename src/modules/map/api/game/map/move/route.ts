import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { db } from "@/db";
import {
  partyGroupMembers,
  partyGroups,
  playerFortunes,
  playerRandomEventCooldowns,
  players,
  randomEvents,
} from "@/db/schema";
import { eq, and, gt, inArray, sql } from "drizzle-orm";
import { publishMapPresencePlayerPosition } from "@/modules/map/services/map-presence";
import {
  applyRandomEventRewards,
  matchRandomEventTargetMap,
  pickRandomEventImageUrl,
  type RandomEventRewardInput,
} from "@/modules/map/services/random-event-service";
import { clearPendingMapEvent, setPendingMapEvent } from "@/modules/map/services/pending-map-event";
import { getPlayerCosmeticMapByIds, getPlayerCosmeticProfileFromIds } from "@/modules/character/services/player-cosmetic-profile";
import {
  hasActiveOpportunityHintAtPosition,
  queueOpportunitySpawnsForMap,
  tryClaimOpportunity,
} from "@/modules/map/services/opportunity-service";
import { judgeCoreRandomEventConditions } from "@/modules/world/services/double-cultivation-random-event";
import { getRuntimeMapById } from "@/modules/map/services/runtime-map-store";
import {
  acceptMapClientSequence,
  advanceMapSceneTick,
  advanceMapSceneTickForPositions,
  getLastAcceptedMapClientSequence,
  getMapSceneTick,
  resetMapClientSequence,
} from "@/modules/map/services/map-scene-sync";
import { isExpectedRequestAbortError } from "@/modules/shared/services/request-abort";
import { recordRuntimeMapMoveAck } from "@/modules/system/services/runtime-map-interaction-stats";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { normalizeLegacyMapMoveRequest } from "@immortality/shared-protocol";

type TileEntity = {
  x: number;
  y: number;
  type: string;
  walkable?: boolean;
  description?: string;
};

type NormalizedEventJudgeConditions = {
  gender?: "男" | "女";
  fortuneConditions: Array<{ fortuneId: string; hasFortune: boolean }>;
  pluginConditions: Record<string, unknown>;
};

const MAP_MOVE_SMALL_CORRECTION_MAX_TILES = parsePositiveIntEnv("MAP_MOVE_SMALL_CORRECTION_MAX_TILES", 1);
const MAP_MOVE_SMOOTH_CORRECTION_MAX_TILES = parsePositiveIntEnv("MAP_MOVE_SMOOTH_CORRECTION_MAX_TILES", 2);
const MAP_MOVE_ENCOUNTER_CHECK_INTERVAL_MS = parsePositiveIntEnv("MAP_MOVE_ENCOUNTER_CHECK_INTERVAL_MS", 5000);
const MAP_MOVE_ENCOUNTER_TEMPLATE_CACHE_TTL_MS = parsePositiveIntEnv("MAP_MOVE_ENCOUNTER_TEMPLATE_CACHE_TTL_MS", 10000);
const MAP_MOVE_PARTY_CONTEXT_CACHE_TTL_MS = parsePositiveIntEnv("MAP_MOVE_PARTY_CONTEXT_CACHE_TTL_MS", 1200);
const MAP_RUNTIME_VERSION = parsePositiveIntEnv("REALTIME_RUNTIME_VERSION", Math.floor(Date.now() / 1000));

type EncounterEventTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  eventType: string;
  probability: unknown;
  imageUrls: string[] | null;
  aiPrompt: string | null;
  rewards: RandomEventRewardInput | null;
  minRealm: number;
  maxRealm: number | null;
  mapType: string | null;
  mapTypes: string[] | null;
  mapIds: string[] | null;
  spawnIntervalSeconds: number | null;
  judgeConditions: unknown;
};

type MapMoveRuntimeGlobal = typeof globalThis & {
  __mapMoveEncounterCheckAtByPlayerId?: Map<string, number>;
  __mapMoveEncounterTemplateCache?: {
    loadedAtMs: number;
    value: EncounterEventTemplateRow[];
  };
  __mapMovePartyMovementContextCache?: Map<string, {
    expiresAtMs: number;
    value: PartyMovementContextLite | null;
  }>;
  __mapMoveBlockedTileLookupByMapId?: Map<string, {
    mapVersion: string;
    blockedTiles: Set<string>;
  }>;
};

type PartyMovementMemberLite = {
  id: string;
  name: string;
  gender: string | null;
  realm: number;
  realmMajor: number | null;
  realmMinor: number | null;
  realmName: string;
  currentMapId: string | null;
  positionX: number;
  positionY: number;
};

type PartyMovementContextLite = {
  partyId: string;
  leaderPlayerId: string;
  members: PartyMovementMemberLite[];
};

function parsePositiveIntEnv(name: string, fallbackValue: number) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallbackValue;
  }
  return parsed;
}

function calcGridDistance(from: { x: number; y: number }, to: { x: number; y: number }) {
  return Math.max(
    Math.abs(from.x - to.x),
    Math.abs(from.y - to.y),
  );
}

function getEncounterCheckStore() {
  const globalStore = globalThis as MapMoveRuntimeGlobal;
  globalStore.__mapMoveEncounterCheckAtByPlayerId = ensureGlobalMap<string, number>(
    globalStore as Record<string, unknown>,
    "__mapMoveEncounterCheckAtByPlayerId",
  );
  return globalStore.__mapMoveEncounterCheckAtByPlayerId;
}

function getPartyMovementContextCacheStore() {
  const globalStore = globalThis as MapMoveRuntimeGlobal;
  globalStore.__mapMovePartyMovementContextCache = ensureGlobalMap<string, {
    expiresAtMs: number;
    value: PartyMovementContextLite | null;
  }>(
    globalStore as Record<string, unknown>,
    "__mapMovePartyMovementContextCache",
  );
  return globalStore.__mapMovePartyMovementContextCache;
}

async function getCachedPartyMovementContext(playerId: string) {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    return null;
  }

  const cacheStore = getPartyMovementContextCacheStore();
  const nowMs = Date.now();
  const cached = cacheStore.get(normalizedPlayerId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  const membership = await db.select({
    partyId: partyGroupMembers.partyId,
  }).from(partyGroupMembers)
    .where(eq(partyGroupMembers.playerId, normalizedPlayerId))
    .get();

  if (!membership) {
    cacheStore.set(normalizedPlayerId, {
      expiresAtMs: nowMs + MAP_MOVE_PARTY_CONTEXT_CACHE_TTL_MS,
      value: null,
    });
    return null;
  }

  const party = await db.select({
    id: partyGroups.id,
    leaderPlayerId: partyGroups.leaderPlayerId,
  }).from(partyGroups)
    .where(and(
      eq(partyGroups.id, membership.partyId),
      eq(partyGroups.status, "active"),
    ))
    .get();

  if (!party) {
    cacheStore.set(normalizedPlayerId, {
      expiresAtMs: nowMs + MAP_MOVE_PARTY_CONTEXT_CACHE_TTL_MS,
      value: null,
    });
    return null;
  }

  const memberRows = await db.select({
    playerId: partyGroupMembers.playerId,
    slotOrder: partyGroupMembers.slotOrder,
  }).from(partyGroupMembers)
    .where(eq(partyGroupMembers.partyId, party.id))
    .all();

  const orderedPlayerIds = memberRows
    .slice()
    .sort((left, right) => left.slotOrder - right.slotOrder)
    .map((member) => member.playerId);

  if (!orderedPlayerIds.length) {
    cacheStore.set(normalizedPlayerId, {
      expiresAtMs: nowMs + MAP_MOVE_PARTY_CONTEXT_CACHE_TTL_MS,
      value: null,
    });
    return null;
  }

  const playerRows = await db.select({
    id: players.id,
    name: players.name,
    gender: players.gender,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
    currentMapId: players.currentMapId,
    positionX: players.positionX,
    positionY: players.positionY,
  }).from(players)
    .where(inArray(players.id, orderedPlayerIds))
    .all();

  const playerRowMap = new Map(playerRows.map((row) => [row.id, row]));
  const members = orderedPlayerIds
    .map((memberId) => playerRowMap.get(memberId))
    .filter((member): member is typeof playerRows[number] => Boolean(member))
    .map((member) => ({
      id: member.id,
      name: member.name || "",
      gender: member.gender,
      realm: member.realm,
      realmMajor: member.realmMajor,
      realmMinor: member.realmMinor,
      realmName: member.realmName || "凡人",
      currentMapId: member.currentMapId,
      positionX: member.positionX,
      positionY: member.positionY,
    }));

  const context: PartyMovementContextLite = {
    partyId: party.id,
    leaderPlayerId: party.leaderPlayerId,
    members,
  };

  cacheStore.set(normalizedPlayerId, {
    expiresAtMs: nowMs + MAP_MOVE_PARTY_CONTEXT_CACHE_TTL_MS,
    value: context,
  });
  return context;
}

function shouldRunEncounterCheck(playerId: string, nowMs: number) {
  const store = getEncounterCheckStore();
  const lastCheckedAtMs = Number(store.get(playerId) || 0);
  if (lastCheckedAtMs > 0 && nowMs - lastCheckedAtMs < MAP_MOVE_ENCOUNTER_CHECK_INTERVAL_MS) {
    return false;
  }
  store.set(playerId, nowMs);
  return true;
}

function getBlockedTileLookupStore() {
  const globalStore = globalThis as MapMoveRuntimeGlobal;
  globalStore.__mapMoveBlockedTileLookupByMapId = ensureGlobalMap<string, {
    mapVersion: string;
    blockedTiles: Set<string>;
  }>(
    globalStore as Record<string, unknown>,
    "__mapMoveBlockedTileLookupByMapId",
  );
  return globalStore.__mapMoveBlockedTileLookupByMapId;
}

function resolveBlockedTileLookup(map: {
  id: string;
  width: number;
  height: number;
  updatedAt?: unknown;
  tilesData?: unknown;
}) {
  const tileEntities = Array.isArray(map.tilesData) ? map.tilesData as TileEntity[] : [];
  const mapVersion = [
    String(map.updatedAt || ""),
    String(map.width || 0),
    String(map.height || 0),
    String(tileEntities.length),
  ].join("|");
  const store = getBlockedTileLookupStore();
  const cached = store.get(map.id);
  if (cached && cached.mapVersion === mapVersion) {
    return cached.blockedTiles;
  }

  const blockedTiles = new Set<string>();
  for (const tile of tileEntities) {
    if (!tile || tile.walkable !== false) {
      continue;
    }
    blockedTiles.add(`${tile.x}:${tile.y}`);
  }

  store.set(map.id, {
    mapVersion,
    blockedTiles,
  });
  return blockedTiles;
}

async function listCachedEncounterEventTemplates() {
  const globalStore = globalThis as MapMoveRuntimeGlobal;
  const cached = globalStore.__mapMoveEncounterTemplateCache;
  const nowMs = Date.now();
  if (
    cached
    && Array.isArray(cached.value)
    && nowMs - Number(cached.loadedAtMs || 0) < MAP_MOVE_ENCOUNTER_TEMPLATE_CACHE_TTL_MS
  ) {
    return cached.value;
  }

  const rows = await db.select({
    id: randomEvents.id,
    name: randomEvents.name,
    description: randomEvents.description,
    eventType: randomEvents.eventType,
    probability: randomEvents.probability,
    imageUrls: randomEvents.imageUrls,
    aiPrompt: randomEvents.aiPrompt,
    rewards: randomEvents.rewards,
    minRealm: randomEvents.minRealm,
    maxRealm: randomEvents.maxRealm,
    mapType: randomEvents.mapType,
    mapTypes: randomEvents.mapTypes,
    mapIds: randomEvents.mapIds,
    spawnIntervalSeconds: randomEvents.spawnIntervalSeconds,
    judgeConditions: randomEvents.judgeConditions,
  }).from(randomEvents).where(eq(randomEvents.eventType, "encounter")).all();

  globalStore.__mapMoveEncounterTemplateCache = {
    loadedAtMs: nowMs,
    value: rows,
  };

  return rows;
}

function resolveCorrectionKind(distance: number) {
  if (distance <= 0) {
    return "none" as const;
  }
  if (distance <= MAP_MOVE_SMALL_CORRECTION_MAX_TILES) {
    return "small" as const;
  }
  if (distance <= MAP_MOVE_SMOOTH_CORRECTION_MAX_TILES) {
    return "smooth" as const;
  }
  return "snap" as const;
}

function parseEventJudgeConditions(raw: unknown): NormalizedEventJudgeConditions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      fortuneConditions: [],
      pluginConditions: {},
    };
  }

  const value = raw as Record<string, unknown>;
  const gender = value.gender === "男" || value.gender === "女"
    ? value.gender
    : undefined;

  const fortuneConditions: Array<{ fortuneId: string; hasFortune: boolean }> = [];
  const rawConditions = Array.isArray(value.fortuneConditions) ? value.fortuneConditions : [];

  rawConditions
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .forEach((item) => {
      const row = item as Record<string, unknown>;
      const fortuneId = typeof row.fortuneId === "string" ? row.fortuneId.trim() : "";
      if (!fortuneId) {
        return;
      }
      fortuneConditions.push({
        fortuneId,
        hasFortune: row.hasFortune !== false,
      });
    });

  const pluginConditionsRaw = value.pluginConditions;
  const pluginConditions = !pluginConditionsRaw || typeof pluginConditionsRaw !== "object" || Array.isArray(pluginConditionsRaw)
    ? {}
    : Object.fromEntries(
      Object.entries(pluginConditionsRaw as Record<string, unknown>)
        .map(([pluginId, condition]) => [String(pluginId || "").trim(), condition] as const)
        .filter(([pluginId]) => pluginId.length > 0),
    );

  return {
    gender,
    fortuneConditions,
    pluginConditions,
  };
}

function matchEventJudgeConditions(params: {
  judgeConditions: NormalizedEventJudgeConditions;
  playerGender: string | null | undefined;
  activeFortuneIdSet: Set<string>;
}) {
  const { judgeConditions, playerGender, activeFortuneIdSet } = params;

  if (judgeConditions.gender && judgeConditions.gender !== playerGender) {
    return false;
  }

  for (const condition of judgeConditions.fortuneConditions) {
    const hasFortune = activeFortuneIdSet.has(condition.fortuneId);
    if (condition.hasFortune !== hasFortune) {
      return false;
    }
  }

  return true;
}

function toPositiveInt(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

let encounterCooldownTableReady: Promise<void> | null = null;

async function ensureEncounterCooldownTable() {
  if (!encounterCooldownTableReady) {
    encounterCooldownTableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "player_random_event_cooldowns" (
          "player_id" text NOT NULL,
          "event_id" text NOT NULL,
          "last_triggered_at" text NOT NULL,
          "next_available_at" text NOT NULL,
          "created_at" text DEFAULT now()::text NOT NULL,
          "updated_at" text DEFAULT now()::text NOT NULL,
          CONSTRAINT "player_random_event_cooldowns_player_id_event_id_pk" PRIMARY KEY("player_id","event_id"),
          CONSTRAINT "player_random_event_cooldowns_player_id_players_id_fk"
            FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
          CONSTRAINT "player_random_event_cooldowns_event_id_random_events_id_fk"
            FOREIGN KEY ("event_id") REFERENCES "random_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "player_random_event_cooldowns_player_next_available_idx"
        ON "player_random_event_cooldowns" ("player_id", "next_available_at");
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "player_random_event_cooldowns_event_next_available_idx"
        ON "player_random_event_cooldowns" ("event_id", "next_available_at");
      `);
    })().catch((error) => {
      encounterCooldownTableReady = null;
      throw error;
    });
  }

  await encounterCooldownTableReady;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const player = await getCurrentPlayer(request);
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    if (
      process.env.WORLD_MAP_LEGACY_MOVE_DISABLED === "1"
      || process.env.NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE === "main"
    ) {
      return NextResponse.json({
        success: false,
        error: "旧地图移动接口已停用，请使用 Colyseus WorldMapRoom move 输入",
        data: {
          legacyMoveDisabled: true,
          migrationTarget: "WorldMapRoom.move",
        },
      }, { status: 410 });
    }

    const rawBody = await request.json() as {
      x?: unknown;
      y?: unknown;
      fromX?: unknown;
      fromY?: unknown;
      clientSequence?: unknown;
    };
    const normalizedProtocolInput = normalizeLegacyMapMoveRequest(rawBody);
    if (!normalizedProtocolInput.ok) {
      return NextResponse.json({
        success: false,
        error: normalizedProtocolInput.error,
        data: {
          realtimeAck: normalizedProtocolInput.ack,
        },
      }, { status: normalizedProtocolInput.status });
    }
    const body = normalizedProtocolInput.legacyBody as typeof rawBody;
    const x = typeof body.x === "number" && Number.isFinite(body.x) ? body.x : Number.NaN;
    const y = typeof body.y === "number" && Number.isFinite(body.y) ? body.y : Number.NaN;
    const fromX = typeof body.fromX === "number" && Number.isFinite(body.fromX) ? body.fromX : Number.NaN;
    const fromY = typeof body.fromY === "number" && Number.isFinite(body.fromY) ? body.fromY : Number.NaN;
    const clientSequence = typeof body.clientSequence === "number" && Number.isInteger(body.clientSequence) && body.clientSequence > 0
      ? body.clientSequence
      : undefined;

    const mapId = player.currentMapId || "map_starter_village";
    const map = await getRuntimeMapById(mapId);
    if (!map) {
      return NextResponse.json({ success: false, error: "地图不存在" }, { status: 404 });
    }

    // Validate move request and sync metadata.
    const dx = Math.abs(x - player.positionX);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return NextResponse.json({ success: false, error: "移动坐标无效" }, { status: 400 });
    }
    if (typeof clientSequence !== "number") {
      return NextResponse.json({ success: false, error: "缺少客户端移动序号，请刷新页面后重试" }, { status: 400 });
    }

    let lastAcceptedClientSequence = getLastAcceptedMapClientSequence(player.id, mapId);
    const serverSceneTick = getMapSceneTick(mapId);
    const clientSourceMatchesAuthoritativePosition = Number.isInteger(fromX)
      && Number.isInteger(fromY)
      && fromX === player.positionX
      && fromY === player.positionY;
    const buildSyncResponse = (params: {
      status: number;
      error: string;
      acceptedClientSequence?: number;
      resyncRequired?: boolean;
      resyncReason?: string;
    }) => NextResponse.json({
      success: false,
      error: params.error,
      data: {
        moved: false,
        runtimeVersion: MAP_RUNTIME_VERSION,
        newX: player.positionX,
        newY: player.positionY,
        authoritativePosition: {
          x: player.positionX,
          y: player.positionY,
        },
        acceptedClientSequence: params.acceptedClientSequence ?? lastAcceptedClientSequence,
        serverSceneTick,
        sceneVersion: serverSceneTick,
          serverTimeMs: Date.now(),
          resyncRequired: params.resyncRequired === true,
          resyncReason: params.resyncReason || null,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      }, { status: params.status });
    if (clientSequence === 1 && clientSourceMatchesAuthoritativePosition) {
      resetMapClientSequence(player.id, mapId);
      lastAcceptedClientSequence = 0;
    }
    if (clientSequence <= lastAcceptedClientSequence) {
      return buildSyncResponse({
        status: 409,
        error: "移动序列已过期，重复或乱序请求已被忽略",
      });
    }
    if (clientSequence > lastAcceptedClientSequence + 1) {
      if (clientSourceMatchesAuthoritativePosition) {
        lastAcceptedClientSequence = clientSequence - 1;
      } else {
        return buildSyncResponse({
          status: 409,
          error: "移动序号跳帧，请等待上一帧确认后再继续移动",
        });
      }
    }
    const acknowledgeRejectedMove = (error: string, status = 409) => {
      acceptMapClientSequence(player.id, mapId, clientSequence);
      lastAcceptedClientSequence = clientSequence;
      const correctionDistance = calcGridDistance(
        { x, y },
        { x: player.positionX, y: player.positionY },
      );
      recordRuntimeMapMoveAck({
        accepted: false,
        durationMs: Date.now() - startedAt,
        correctionDistance,
        correctionKind: resolveCorrectionKind(correctionDistance),
        resyncRequired: status === 409,
      });
      return buildSyncResponse({
        status,
        error,
        acceptedClientSequence: clientSequence,
        resyncRequired: status === 409,
        resyncReason: status === 409 ? "sequence_resync" : "validation_rejected",
      });
    };

    const partyMovementContext = await getCachedPartyMovementContext(player.id);
    if (partyMovementContext && partyMovementContext.leaderPlayerId !== player.id) {
      return acknowledgeRejectedMove("组队状态下仅队长可移动，队员会自动跟随队长", 403);
    }

    const dy = Math.abs(y - player.positionY);
    const isStationaryInteraction = dx === 0 && dy === 0;
    const isAdjacent = dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
    if (!isAdjacent && !isStationaryInteraction) {
      return acknowledgeRejectedMove("只能移动到相邻格子", 400);
    }

    // 验证边界
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
      return acknowledgeRejectedMove("超出地图边界", 400);
    }

    const blockedTiles = resolveBlockedTileLookup(map);
    const isWalkable = (tileX: number, tileY: number) => {
      if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) {
        return false;
      }
      return !blockedTiles.has(`${tileX}:${tileY}`);
    };

    // 验证目标格可行走（稀疏实体：未配置格子默认可走）
    if (!isWalkable(x, y)) {
      return acknowledgeRejectedMove("此处无法通行", 400);
    }

    // 禁止穿角：斜向移动时，横向与纵向相邻格都必须可通行
    if (dx === 1 && dy === 1) {
      const horizontalWalkable = isWalkable(x, player.positionY);
      const verticalWalkable = isWalkable(player.positionX, y);
      if (!horizontalWalkable || !verticalWalkable) {
        return acknowledgeRejectedMove("斜向移动被障碍阻挡", 400);
      }
    }

    const acceptedClientSequence = clientSequence;
    acceptMapClientSequence(player.id, mapId, acceptedClientSequence);
    let nextServerSceneTick = getMapSceneTick(mapId);
    const followingMembers = isStationaryInteraction
      ? []
      : (
        partyMovementContext
          ? partyMovementContext.members.filter((member) => member.id !== player.id)
          : []
      );

    if (!isStationaryInteraction) {
      const movedAt = new Date().toISOString();
      const playerCosmeticPromise = player.avatarId || player.avatarFrameId
        ? getPlayerCosmeticProfileFromIds({
          avatarId: player.avatarId,
          avatarFrameId: player.avatarFrameId,
        })
        : Promise.resolve({ avatarImageUrl: null, avatarFrameImageUrl: null });
      const followingMemberCosmeticPromise = followingMembers.length > 0
        ? getPlayerCosmeticMapByIds(followingMembers.map((member) => member.id))
        : Promise.resolve(new Map<string, Awaited<ReturnType<typeof getPlayerCosmeticProfileFromIds>>>());
      const writeTasks: Array<Promise<unknown>> = [
        db.update(players)
          .set({ positionX: x, positionY: y, updatedAt: movedAt })
          .where(eq(players.id, player.id))
          .run(),
      ];
      if (followingMembers.length > 0) {
        writeTasks.push(
          db.update(players)
            .set({
              currentMapId: mapId,
              positionX: x,
              positionY: y,
              updatedAt: movedAt,
            })
            .where(inArray(players.id, followingMembers.map((member) => member.id)))
            .run(),
        );
      }
      await Promise.all(writeTasks);

      nextServerSceneTick = advanceMapSceneTick(mapId);
      advanceMapSceneTickForPositions({
        mapId,
        tick: nextServerSceneTick,
        positions: [
          {
            positionX: player.positionX,
            positionY: player.positionY,
          },
          {
            positionX: x,
            positionY: y,
          },
          ...followingMembers.flatMap((member) => [
            {
              positionX: member.positionX,
              positionY: member.positionY,
            },
            {
              positionX: x,
              positionY: y,
            },
          ]),
        ],
      });

      const [playerCosmetic, followingMemberCosmeticMap] = await Promise.all([
        playerCosmeticPromise,
        followingMemberCosmeticPromise,
      ]);

      publishMapPresencePlayerPosition({
        id: player.id,
        name: player.name || "",
        gender: player.gender,
        avatarImageUrl: playerCosmetic.avatarImageUrl,
        avatarFrameImageUrl: playerCosmetic.avatarFrameImageUrl,
        realm: player.realm,
        realmMajor: player.realmMajor,
        realmMinor: player.realmMinor,
        realmName: player.realmName || "凡人",
        mapId,
        prevMapId: mapId,
        positionX: x,
        positionY: y,
        prevPositionX: player.positionX,
        prevPositionY: player.positionY,
      });
      if (followingMembers.length > 0) {
        for (const member of followingMembers) {
          const cosmetic = followingMemberCosmeticMap.get(member.id);
          publishMapPresencePlayerPosition({
            id: member.id,
            name: member.name || "",
            gender: member.gender,
            realm: member.realm,
            realmMajor: member.realmMajor,
            realmMinor: member.realmMinor,
            realmName: member.realmName || "凡人",
            mapId,
            prevMapId: member.currentMapId || mapId,
            positionX: x,
            positionY: y,
            prevPositionX: member.positionX,
            prevPositionY: member.positionY,
            avatarImageUrl: cosmetic?.avatarImageUrl || null,
            avatarFrameImageUrl: cosmetic?.avatarFrameImageUrl || null,
          });
          clearPendingMapEvent(member.id);
        }
      }

      // 每次移动后清掉旧的待结算事件
      clearPendingMapEvent(player.id);
    }

    const shouldUseLegacyOpportunities = map.mapType !== "open_world" && map.mapType !== "secret_realm_instance";

    if (shouldUseLegacyOpportunities) {
      queueOpportunitySpawnsForMap({
        mapId: map.id,
        mapData: {
          id: map.id,
          width: map.width,
          height: map.height,
          mapType: map.mapType,
          tilesData: map.tilesData,
        },
      });
    }

    const opportunityResult = shouldUseLegacyOpportunities
      ? (
        await hasActiveOpportunityHintAtPosition({
          mapId: map.id,
          positionX: x,
          positionY: y,
        })
          ? await tryClaimOpportunity({
            playerId: player.id,
            playerRealm: player.realm,
            mapId: map.id,
            positionX: x,
            positionY: y,
          })
          : { status: "none" } as const
      )
      : { status: "none" } as const;
    if (opportunityResult.status === "claimed") {
      if (isStationaryInteraction) {
        nextServerSceneTick = advanceMapSceneTick(mapId);
      }
      recordRuntimeMapMoveAck({
        accepted: true,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        success: true,
        data: {
          moved: !isStationaryInteraction,
          runtimeVersion: MAP_RUNTIME_VERSION,
          newX: x,
          newY: y,
          authoritativePosition: {
            x,
            y,
          },
          event: opportunityResult.event,
          acceptedClientSequence,
          serverSceneTick: nextServerSceneTick,
          sceneVersion: nextServerSceneTick,
          serverTimeMs: Date.now(),
          resyncRequired: false,
          resyncReason: null,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      });
    }

    // 检查随机事件
    let event = null;

    let message: string | undefined;
    if (opportunityResult.status === "lost") {
      message = "机缘已被其他修士捷足先登";
    } else if (opportunityResult.status === "blocked") {
      message = opportunityResult.message || "当前无法触发该机缘";
    }
    if (isStationaryInteraction) {
      recordRuntimeMapMoveAck({
        accepted: true,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        success: true,
        data: {
          moved: false,
          runtimeVersion: MAP_RUNTIME_VERSION,
          newX: x,
          newY: y,
          authoritativePosition: {
            x,
            y,
          },
          event,
          acceptedClientSequence,
          serverSceneTick: nextServerSceneTick,
          sceneVersion: nextServerSceneTick,
          serverTimeMs: Date.now(),
          resyncRequired: false,
          resyncReason: null,
          protocol: normalizedProtocolInput.protocolMeta,
          ...(message ? { message } : {}),
        },
      });
    }
    if (!shouldRunEncounterCheck(player.id, Date.now())) {
      recordRuntimeMapMoveAck({
        accepted: true,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        success: true,
        data: {
          moved: true,
          runtimeVersion: MAP_RUNTIME_VERSION,
          newX: x,
          newY: y,
          authoritativePosition: {
            x,
            y,
          },
          event,
          acceptedClientSequence,
          serverSceneTick: nextServerSceneTick,
          sceneVersion: nextServerSceneTick,
          serverTimeMs: Date.now(),
          resyncRequired: false,
          resyncReason: null,
          protocol: normalizedProtocolInput.protocolMeta,
          ...(message ? { message } : {}),
        },
      });
    }

    const events = (await listCachedEncounterEventTemplates()).filter((evt) => (
      evt.minRealm <= player.realm
      && (evt.maxRealm === null || evt.maxRealm >= player.realm)
    ));

    const needsFortuneJudge = events.some((evt) => {
      const judgeConditions = parseEventJudgeConditions(evt.judgeConditions);
      return judgeConditions.fortuneConditions.length > 0;
    });
    const activeFortuneIdSet = needsFortuneJudge
      ? new Set((await db.select({
        fortuneId: playerFortunes.fortuneId,
      }).from(playerFortunes).where(and(
        eq(playerFortunes.playerId, player.id),
        eq(playerFortunes.status, "active"),
      )).all()).map((row) => row.fortuneId))
      : new Set<string>();

    const candidateEvents: typeof events = [];
    for (const evt of events) {
      const judgeConditions = parseEventJudgeConditions(evt.judgeConditions);

      if (!matchRandomEventTargetMap({
        currentMapId: map.id,
        currentMapType: map.mapType,
        mapIds: evt.mapIds,
        mapTypes: evt.mapTypes,
        legacyMapType: evt.mapType,
      })) {
        continue;
      }

      if (!matchEventJudgeConditions({
        judgeConditions,
        playerGender: player.gender,
        activeFortuneIdSet,
      })) {
        continue;
      }

      const pluginJudgeKeys = Object.keys(judgeConditions.pluginConditions);
      if (pluginJudgeKeys.length > 0) {
        const pluginJudgeResult = await judgeCoreRandomEventConditions({
          playerId: player.id,
          pluginConditions: judgeConditions.pluginConditions,
        });
        if (!pluginJudgeResult.passed) {
          continue;
        }
      }

      candidateEvents.push(evt);
    }

    if (candidateEvents.length > 0) {
      await ensureEncounterCooldownTable();
      const nowIso = new Date().toISOString();
      const cooldownEventIds = candidateEvents
        .filter((evt) => toPositiveInt(evt.spawnIntervalSeconds) !== null)
        .map((evt) => evt.id);

      let availableEvents = candidateEvents;
      if (cooldownEventIds.length > 0) {
        const cooldownRows = await db.select({
          eventId: playerRandomEventCooldowns.eventId,
        }).from(playerRandomEventCooldowns).where(and(
          eq(playerRandomEventCooldowns.playerId, player.id),
          inArray(playerRandomEventCooldowns.eventId, cooldownEventIds),
          gt(playerRandomEventCooldowns.nextAvailableAt, nowIso),
        )).all();

        const blockedEventIdSet = new Set(cooldownRows.map((row) => row.eventId));
        availableEvents = candidateEvents.filter((evt) => !blockedEventIdSet.has(evt.id));
      }

      const probabilities = availableEvents.map((evt) => {
        const value = Number(evt.probability);
        if (!Number.isFinite(value) || value <= 0) return 0;
        return Math.min(1, value);
      });
      const triggerProbability = Math.max(...probabilities);
      const totalWeight = probabilities.reduce((sum, value) => sum + value, 0);

      if (triggerProbability > 0 && totalWeight > 0 && Math.random() < triggerProbability) {
        let pickedIndex = 0;
        let cursor = Math.random() * totalWeight;
        for (let index = 0; index < probabilities.length; index += 1) {
          cursor -= probabilities[index];
          if (cursor <= 0) {
            pickedIndex = index;
            break;
          }
        }

        const evt = availableEvents[pickedIndex];
        const cooldownSeconds = toPositiveInt(evt.spawnIntervalSeconds);
        if (cooldownSeconds !== null) {
          const triggeredAt = new Date().toISOString();
          const nextAvailableAt = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
          await db.insert(playerRandomEventCooldowns).values({
            playerId: player.id,
            eventId: evt.id,
            lastTriggeredAt: triggeredAt,
            nextAvailableAt,
            createdAt: triggeredAt,
            updatedAt: triggeredAt,
          }).onConflictDoUpdate({
            target: [playerRandomEventCooldowns.playerId, playerRandomEventCooldowns.eventId],
            set: {
              lastTriggeredAt: triggeredAt,
              nextAvailableAt,
              updatedAt: triggeredAt,
            },
          }).run();
        }

        if (evt.aiPrompt) {
          setPendingMapEvent(player.id, evt.id);
          event = {
            id: evt.id,
            name: evt.name,
            type: evt.eventType,
            pendingAi: true,
          };
        } else {
          const rewards = evt.rewards as RandomEventRewardInput | null;
          const rewardsWithName = await applyRandomEventRewards({
            playerId: player.id,
            rewards,
            sourceRef: evt.id,
          });

          event = {
            name: evt.name,
            type: evt.eventType,
            narrative: evt.description || "你遇到了一件奇事...",
            imageUrl: pickRandomEventImageUrl(evt.imageUrls),
            rewards: rewardsWithName,
          };
        }
      }
    }

    recordRuntimeMapMoveAck({
      accepted: true,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      success: true,
      data: {
        moved: true,
        runtimeVersion: MAP_RUNTIME_VERSION,
        newX: x,
        newY: y,
        authoritativePosition: {
          x,
          y,
        },
        event,
        acceptedClientSequence,
        serverSceneTick: nextServerSceneTick,
        sceneVersion: nextServerSceneTick,
        serverTimeMs: Date.now(),
        resyncRequired: false,
        resyncReason: null,
        protocol: normalizedProtocolInput.protocolMeta,
        ...(message ? { message } : {}),
      },
    });
  } catch (e) {
    if (isExpectedRequestAbortError(e)) {
      return new Response(null, { status: 499 });
    }
    console.error("Move error:", e);
    recordRuntimeMapMoveAck({
      accepted: false,
      durationMs: Date.now() - startedAt,
      correctionDistance: 0,
      correctionKind: "none",
      resyncRequired: false,
    });
    return NextResponse.json({ success: false, error: "移动失败" }, { status: 500 });
  }
}
