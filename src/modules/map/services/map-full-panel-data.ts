import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { mapEdges } from "@/db/schema";
import { getRealmFullNameByLinearRealm } from "@/modules/character/services/realm-service";
import { getPvpMapAvailability } from "@/modules/combat/services/pvp-map-config";
import {
  buildPartyMapTravelDisabledReason,
  listPartyMembersBelowMapRealm,
} from "@/modules/map/services/party-map-travel-restriction";
import { listVisibleSecretRealmSpawns } from "@/modules/map/services/secret-realm-spawn-service";
import { getCurrentSecretRealmForPlayer } from "@/modules/map/services/secret-realm-instance-service";
import { getMapTravelMode } from "@/modules/map/services/map-travel-mode";
import { listPortalTravelTargets } from "@/modules/map/services/map-portal";
import { loadMapReadModelCache } from "@/modules/map/services/map-read-model-cache";
import { canPlayerAccessSectMap } from "@/modules/sect/services/sect-service";
import { getPartyMovementContext } from "@/modules/social/infrastructure/party-service";
import { getSystemConfigValue } from "@/modules/system/services/system-config";
import { listRuntimeMapsByIds } from "@/modules/map/services/runtime-map-store";
import {
  canMapReceiveWorldAssassination,
  markOpenWorldPlayerPresence,
  peekPendingOpenWorldAssassinationForPlayer,
} from "@/modules/world/services/world-player-conflict-runtime";
import { getOpenWorldMapExplorationSummary, touchOpenWorldMapHeat } from "@/modules/world/services/world-map-service";
import {
  getSafePlayerWorldPressureSnapshot,
  listPlayerWorldContracts,
  listPlayerWorldEventOffers,
} from "@/modules/world/services/player-world-pressure-service";
import { listWorldAdultInvitesForMap } from "@/modules/world/services/world-adult-service";
import {
  getOpenWorldFactionPressureHints,
  listOpenWorldDistrictStates,
  listOpenWorldStorylines,
} from "@/modules/world/services/world-faction-storyline-service";
import { listOpenWorldObjectivePoints } from "@/modules/world/services/world-objective-points";
import { buildWorldSummaryView } from "@/modules/world/services/world-summary-service";

function parsePositiveIntEnv(name: string, fallbackValue: number, minValue = 1) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }
  return parsed;
}

const MAP_FULL_READ_MODEL_CACHE_TTL_MS = parsePositiveIntEnv("MAP_PANEL_READ_MODEL_CACHE_TTL_MS", 8_000, 200);

type MapPortalTileLite = {
  x: number;
  y: number;
  portalId?: string | null;
  portalName?: string | null;
  portalTargetMapId?: string | null;
  portalTargetName?: string | null;
  portalTargetPortalId?: string | null;
  imageUrl?: string | null;
};

type MapNpcLite = {
  id: string;
  name: string;
  title?: string | null;
  positionX: number;
  positionY: number;
  isShop: boolean;
  sourceType?: string | null;
  detailRoute?: string | null;
  currentActionLabel?: string | null;
};

type MapOpportunityLite = {
  spawnId: string;
  name: string;
  positionX: number;
  positionY: number;
};

type CurrentPlayerLite = {
  id: string;
  name: string | null;
  realm: number;
  realmMinor: number | null;
  positionX: number;
  positionY: number;
};

type RuntimeMapLite = {
  id: string;
  name: string;
  mapType: string;
};

type PlayerPortalLite = {
  x: number;
  y: number;
  portalId?: string | null;
  portalName?: string | null;
  targetMapId?: string | null;
  targetMapName?: string | null;
  targetPortalId?: string | null;
  imageUrl?: string | null;
} | null;

type LinkedMapView = {
  id: string;
  name: string;
  minRealm: string;
  minRealmValue: number;
  minRealmName?: string | null;
  mapType: string;
  fromPortalId?: string | null;
  fromPortalName?: string | null;
  targetPortalId?: string | null;
  targetPortalName?: string | null;
  available: boolean;
  disabledReason?: string | null;
  currentPortalMatched?: boolean;
};

type PortalView = {
  x: number;
  y: number;
  portalId: string;
  portalName: string;
  targetMapId: string;
  targetMapName: string;
  targetPortalId: string;
  imageUrl: string | null;
};

type TravelBundle = {
  linkedMaps: LinkedMapView[];
  portals: PortalView[];
  travelMode: string;
  linkedMapNameById: Record<string, string>;
};

type SecretRealmBundle = {
  secretRealms: Awaited<ReturnType<typeof listVisibleSecretRealmSpawns>>;
  rawCurrentSecretRealm: Awaited<ReturnType<typeof getCurrentSecretRealmForPlayer>>;
};

type WorldBaseBundle = {
  pvp: Awaited<ReturnType<typeof getPvpMapAvailability>>;
  publicAnnouncement: string;
  openWorldExploration: Awaited<ReturnType<typeof getOpenWorldMapExplorationSummary>>;
  worldObjectivePoints: Array<{
    id: string;
    label: string;
    pointType: string;
    pointTypeLabel: string;
    districtName: string;
    positionX: number;
    positionY: number;
    description: string;
    interactionHint: string | null;
  }>;
};

type WorldPlayerBundle = {
  worldPressureSnapshot: Awaited<ReturnType<typeof getSafePlayerWorldPressureSnapshot>>;
  adultInviteState: Awaited<ReturnType<typeof listWorldAdultInvitesForMap>>;
  districtStates: Awaited<ReturnType<typeof listOpenWorldDistrictStates>>;
  activeStorylines: Awaited<ReturnType<typeof listOpenWorldStorylines>>;
  factionPressureHints: Awaited<ReturnType<typeof getOpenWorldFactionPressureHints>>;
  activeWorldEventOffers: Awaited<ReturnType<typeof listPlayerWorldEventOffers>>;
  activeWorldContracts: Awaited<ReturnType<typeof listPlayerWorldContracts>>;
};

function stringifyCachePart(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function buildCacheKey(parts: unknown[]) {
  return parts.map((part) => stringifyCachePart(part)).join(":");
}

function buildBooleanToken(value: boolean) {
  return value ? "1" : "0";
}

function buildPortalSignature(portal: PlayerPortalLite) {
  if (!portal) {
    return "none";
  }
  return [
    portal.x,
    portal.y,
    portal.portalId || "",
    portal.targetMapId || "",
    portal.targetPortalId || "",
  ].join(",");
}

function buildPortalTilesSignature(portalTiles: MapPortalTileLite[]) {
  return portalTiles
    .map((tile) => [
      tile.x,
      tile.y,
      tile.portalId || "",
      tile.portalTargetMapId || "",
      tile.portalTargetPortalId || "",
    ].join(","))
    .sort()
    .join("|");
}

function buildPartySignature(playerId: string, members: Array<{
  id: string;
  realm: number;
}>) {
  if (!members.length) {
    return `solo:${playerId}`;
  }
  return members
    .map((member) => `${member.id}:${member.realm}`)
    .sort()
    .join("|");
}

async function loadCachedMapPanelSection<T>(params: {
  section: string;
  mapId: string;
  cacheTokens?: unknown[];
  loader: () => Promise<T>;
}) {
  return await loadMapReadModelCache<T>({
    cacheKey: buildCacheKey([
      "map:panel",
      params.mapId,
      params.section,
      ...(params.cacheTokens || []),
    ]),
    ttlMs: MAP_FULL_READ_MODEL_CACHE_TTL_MS,
    statGroup: `map-panel:${params.section}`,
    loader: params.loader,
  });
}

function normalizePortalTiles(portalTiles: MapPortalTileLite[]) {
  return portalTiles.map((tile) => ({
    ...tile,
    imageUrl: tile.imageUrl || undefined,
    portalId: tile.portalId || undefined,
    portalName: tile.portalName || undefined,
    portalTargetMapId: tile.portalTargetMapId || undefined,
    portalTargetName: tile.portalTargetName || undefined,
    portalTargetPortalId: tile.portalTargetPortalId || undefined,
  }));
}

async function loadTravelBundle(params: {
  playerId: string;
  playerRealm: number;
  mapId: string;
  playerPortal: PlayerPortalLite;
  portalTiles: MapPortalTileLite[];
  partyTravelMembers: Array<{
    id: string;
    name: string;
    realm: number;
    realmName: string | null;
  }>;
}) {
  const {
    playerId,
    playerRealm,
    mapId,
    playerPortal,
    portalTiles,
    partyTravelMembers,
  } = params;
  const normalizedPortalTiles = normalizePortalTiles(portalTiles);

  return await loadCachedMapPanelSection<TravelBundle>({
    section: "travel",
    mapId,
    cacheTokens: [
      playerId,
      playerRealm,
      buildPortalSignature(playerPortal),
      buildPortalTilesSignature(portalTiles),
      buildPartySignature(playerId, partyTravelMembers),
    ],
    loader: async () => {
      const portalTravelEntries = normalizedPortalTiles.flatMap((tile) => (
        listPortalTravelTargets(tile).map((target) => ({
          sourcePortal: tile,
          target,
        }))
      ));
      const linkedMapMetaMap = new Map<string, Awaited<ReturnType<typeof listRuntimeMapsByIds>>[number]>();
      const travelMode = await getMapTravelMode();
      const edges = await db.select().from(mapEdges).where(
        or(
          eq(mapEdges.mapAId, mapId),
          eq(mapEdges.mapBId, mapId),
        ),
      ).all();

      const linkedMapIds = Array.from(new Set(edges.map((edge) => (
        edge.mapAId === mapId ? edge.mapBId : edge.mapAId
      ))));
      const portalTargetMapIds = Array.from(new Set(
        portalTravelEntries
          .map((entry) => String(entry.target.mapId || "").trim())
          .filter(Boolean),
      ));
      const portalSourceMap = new Map(portalTravelEntries
        .map((entry) => {
          const targetMapId = String(entry.target.mapId || "").trim();
          if (!targetMapId) {
            return null;
          }
          return [targetMapId, entry] as const;
        })
        .filter((entry): entry is readonly [string, (typeof portalTravelEntries)[number]] => Boolean(entry)));
      const resolvedLinkedMapIds = travelMode === "portal"
        ? Array.from(new Set([...portalTargetMapIds, ...linkedMapIds]))
        : linkedMapIds;
      const referencedMapIds = Array.from(new Set([...linkedMapIds, ...portalTargetMapIds]));

      const linkedMapRows = referencedMapIds.length > 0
        ? await listRuntimeMapsByIds(referencedMapIds)
        : [];
      linkedMapRows.forEach((linkedMap) => {
        linkedMapMetaMap.set(linkedMap.id, linkedMap);
      });

      const linkedMaps = await Promise.all(linkedMapRows
        .filter((linkedMap) => resolvedLinkedMapIds.includes(linkedMap.id))
        .map(async (linkedMap) => {
          const minRealmName = await getRealmFullNameByLinearRealm(linkedMap.minRealm);
          const sectAccess = await canPlayerAccessSectMap({
            playerId,
            mapId: linkedMap.id,
          });
          const sourceEntry = portalSourceMap.get(linkedMap.id) || null;
          const sourcePortal = sourceEntry?.sourcePortal || null;
          const currentPortalTargetMapId = String(playerPortal?.targetMapId || "").trim();
          const usingExplicitPortalTarget = currentPortalTargetMapId.length > 0;
          const matchesCurrentPortal = Boolean(sourcePortal && playerPortal && (
            (sourcePortal.portalId && playerPortal.portalId && sourcePortal.portalId === playerPortal.portalId)
            || currentPortalTargetMapId === linkedMap.id
          ));

          let disabledReason: string | null = null;
          if (playerRealm < linkedMap.minRealm) {
            disabledReason = `需境界 ${minRealmName || linkedMap.minRealm}`;
          } else {
            const blockedMembers = listPartyMembersBelowMapRealm({
              members: partyTravelMembers,
              minRealm: linkedMap.minRealm,
            });
            if (blockedMembers.length > 0) {
              disabledReason = buildPartyMapTravelDisabledReason({
                requiredRealmName: minRealmName || String(linkedMap.minRealm),
                blockedMembers,
              });
            }
          }
          if (disabledReason === null && travelMode === "portal") {
            if (!playerPortal) {
              disabledReason = `需先站上 ${sourcePortal?.portalName || "传送阵"}`;
            } else if (usingExplicitPortalTarget) {
              if (!sourcePortal) {
                disabledReason = "当前地图未配置对应传送阵";
              } else if (!matchesCurrentPortal) {
                disabledReason = `需切换至 ${sourcePortal.portalName || "对应传送阵"}`;
              }
            } else if (!linkedMapIds.includes(linkedMap.id)) {
              disabledReason = "当前传送阵未配置可达地图";
            }
          }
          if (disabledReason === null && !sectAccess.allowed) {
            disabledReason = sectAccess.reason || "无权进入该宗门驻地";
          }

          return {
            ...linkedMap,
            minRealm: minRealmName || String(linkedMap.minRealm),
            minRealmValue: linkedMap.minRealm,
            minRealmName,
            fromPortalId: sourcePortal?.portalId || null,
            fromPortalName: sourcePortal?.portalName || null,
            targetPortalId: sourceEntry?.target.portalId || null,
            targetPortalName: sourceEntry?.target.mapName || null,
            available: disabledReason === null,
            disabledReason,
            currentPortalMatched: usingExplicitPortalTarget ? matchesCurrentPortal : false,
          };
        }));

      const portals = normalizedPortalTiles.map((tile) => {
        const targetMap = tile.portalTargetMapId ? linkedMapMetaMap.get(tile.portalTargetMapId) : null;
        return {
          x: tile.x,
          y: tile.y,
          portalId: tile.portalId || "",
          portalName: tile.portalName || `传送阵(${tile.x},${tile.y})`,
          targetMapId: tile.portalTargetMapId || "",
          targetMapName: tile.portalTargetName || targetMap?.name || "",
          targetPortalId: tile.portalTargetPortalId || "",
          imageUrl: tile.imageUrl || null,
        };
      });

      return {
        linkedMaps,
        portals,
        travelMode,
        linkedMapNameById: Object.fromEntries(linkedMapRows.map((linkedMap) => [linkedMap.id, linkedMap.name])),
      };
    },
  });
}

async function loadSecretRealmBundle(params: {
  playerId: string;
  mapId: string;
  allowSecretRealmSpawns: boolean;
  secretRealmMap: boolean;
  effectiveCurrentMapInstanceId: string | null;
}) {
  const {
    playerId,
    mapId,
    allowSecretRealmSpawns,
    secretRealmMap,
    effectiveCurrentMapInstanceId,
  } = params;

  return await loadCachedMapPanelSection<SecretRealmBundle>({
    section: "secret-realm",
    mapId,
    cacheTokens: [
      playerId,
      buildBooleanToken(allowSecretRealmSpawns),
      buildBooleanToken(secretRealmMap),
      effectiveCurrentMapInstanceId || "",
    ],
    loader: async () => {
      const [secretRealms, rawCurrentSecretRealm] = await Promise.all([
        allowSecretRealmSpawns
          ? listVisibleSecretRealmSpawns({
            mapId,
            playerId,
          })
          : Promise.resolve([]),
        getCurrentSecretRealmForPlayer(playerId),
      ]);

      return {
        secretRealms,
        rawCurrentSecretRealm,
      };
    },
  });
}

async function loadWorldBaseBundle(params: {
  map: RuntimeMapLite;
  includeWorldIntelDetails: boolean;
}) {
  const { map, includeWorldIntelDetails } = params;
  return await loadCachedMapPanelSection<WorldBaseBundle>({
    section: "world-base",
    mapId: map.id,
    cacheTokens: [
      map.mapType,
      buildBooleanToken(includeWorldIntelDetails),
    ],
    loader: async () => {
      const [pvp, publicAnnouncement, openWorldExploration] = await Promise.all([
        getPvpMapAvailability({
          mapId: map.id,
          mapType: map.mapType,
        }),
        getSystemConfigValue("GAME_PUBLIC_ANNOUNCEMENT").then((value) => value || ""),
        map.mapType === "open_world"
          ? getOpenWorldMapExplorationSummary(map.id).catch(() => null)
          : Promise.resolve(null),
      ]);

      const worldObjectivePoints = map.mapType === "open_world" && includeWorldIntelDetails
        ? listOpenWorldObjectivePoints(map.id).map((point) => ({
          id: point.id,
          label: point.label,
          pointType: point.pointType,
          pointTypeLabel: point.pointTypeLabel,
          districtName: point.districtName || "",
          positionX: point.positionX,
          positionY: point.positionY,
          description: point.description,
          interactionHint: point.interactionHint || null,
        }))
        : [];

      return {
        pvp,
        publicAnnouncement,
        openWorldExploration,
        worldObjectivePoints,
      };
    },
  });
}

async function loadWorldPlayerBundle(params: {
  playerId: string;
  map: RuntimeMapLite;
  includeWorldIntelDetails: boolean;
}) {
  const { playerId, map, includeWorldIntelDetails } = params;
  return await loadCachedMapPanelSection<WorldPlayerBundle>({
    section: "world-player",
    mapId: map.id,
    cacheTokens: [
      playerId,
      map.mapType,
      buildBooleanToken(includeWorldIntelDetails),
    ],
    loader: async () => {
      const [
        worldPressureSnapshot,
        adultInviteState,
        districtStates,
        activeStorylines,
        factionPressureHints,
        activeWorldEventOffers,
        activeWorldContracts,
      ] = await Promise.all([
        getSafePlayerWorldPressureSnapshot(playerId),
        map.mapType === "open_world"
          ? listWorldAdultInvitesForMap({
            playerId,
            mapId: map.id,
          }).catch(() => ({ invites: [], adultDangerHints: [] }))
          : Promise.resolve({ invites: [], adultDangerHints: [] }),
        map.mapType === "open_world" && includeWorldIntelDetails
          ? listOpenWorldDistrictStates({
            mapId: map.id,
            playerId,
          }).catch(() => [])
          : Promise.resolve([]),
        map.mapType === "open_world" && includeWorldIntelDetails
          ? listOpenWorldStorylines({
            mapId: map.id,
            playerId,
          }).catch(() => [])
          : Promise.resolve([]),
        map.mapType === "open_world"
          ? getOpenWorldFactionPressureHints({
            playerId,
            mapId: map.id,
          }).catch(() => [])
          : Promise.resolve([]),
        map.mapType === "open_world"
          ? listPlayerWorldEventOffers(playerId).catch(() => [])
          : Promise.resolve([]),
        map.mapType === "open_world"
          ? listPlayerWorldContracts(playerId).catch(() => [])
          : Promise.resolve([]),
      ]);

      return {
        worldPressureSnapshot,
        adultInviteState,
        districtStates,
        activeStorylines,
        factionPressureHints,
        activeWorldEventOffers,
        activeWorldContracts,
      };
    },
  });
}

export async function loadFullMapPanelData(params: {
  playerId: string;
  playerRealm: number;
  mapId: string;
  map: RuntimeMapLite;
  currentPlayer: CurrentPlayerLite;
  playerPortal: PlayerPortalLite;
  portalTiles: MapPortalTileLite[];
  sceneNpcs: MapNpcLite[];
  opportunities: MapOpportunityLite[];
  secretRealmMap: boolean;
  allowSecretRealmSpawns: boolean;
  effectiveCurrentMapInstanceId: string | null;
  includeWorldIntelDetails: boolean;
}) {
  const {
    playerId,
    playerRealm,
    mapId,
    map,
    currentPlayer,
    playerPortal,
    portalTiles,
    sceneNpcs,
    opportunities,
    secretRealmMap,
    allowSecretRealmSpawns,
    effectiveCurrentMapInstanceId,
    includeWorldIntelDetails,
  } = params;

  const partyMovementContext = await getPartyMovementContext(playerId);
  const partyTravelMembers = partyMovementContext?.members.map((member) => ({
    id: member.id,
    name: member.name,
    realm: member.realm,
    realmName: member.realmName,
  })) || [];

  const [travelBundle, secretRealmBundle, worldBaseBundle, worldPlayerBundle] = await Promise.all([
    loadTravelBundle({
      playerId,
      playerRealm,
      mapId,
      playerPortal,
      portalTiles,
      partyTravelMembers,
    }),
    loadSecretRealmBundle({
      playerId,
      mapId,
      allowSecretRealmSpawns,
      secretRealmMap,
      effectiveCurrentMapInstanceId,
    }),
    loadWorldBaseBundle({
      map,
      includeWorldIntelDetails,
    }),
    loadWorldPlayerBundle({
      playerId,
      map,
      includeWorldIntelDetails,
    }),
  ]);

  const currentSecretRealm = (
    secretRealmMap
    && effectiveCurrentMapInstanceId
    && secretRealmBundle.rawCurrentSecretRealm
    && secretRealmBundle.rawCurrentSecretRealm.instanceId === effectiveCurrentMapInstanceId
  )
    ? secretRealmBundle.rawCurrentSecretRealm
    : null;

  const canReceiveWorldAssassination = canMapReceiveWorldAssassination(map.mapType);
  const pendingAssassination = canReceiveWorldAssassination
    ? (() => {
      markOpenWorldPlayerPresence({
        playerId: currentPlayer.id,
        playerName: currentPlayer.name || "无名修士",
        mapId: map.id,
        mapName: map.name,
        mapType: map.mapType,
        positionX: currentPlayer.positionX,
        positionY: currentPlayer.positionY,
        realm: Math.max(1, Number(currentPlayer.realmMinor || currentPlayer.realm || 1)),
      });
      return peekPendingOpenWorldAssassinationForPlayer(currentPlayer.id);
    })()
    : null;

  if (map.mapType === "open_world") {
    void touchOpenWorldMapHeat({
      mapId: map.id,
      playerId: currentPlayer.id,
      reason: "map-enter",
      delta: 3,
    }).catch(() => null);
  }

  const worldSummary = buildWorldSummaryView({
    mapId: map.id,
    mapName: map.name,
    mapType: map.mapType,
    playerPositionX: currentPlayer.positionX,
    playerPositionY: currentPlayer.positionY,
    npcs: sceneNpcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      title: npc.title,
      positionX: npc.positionX,
      positionY: npc.positionY,
      isShop: npc.isShop,
      sourceType: npc.sourceType === "world" ? "world" : (npc.sourceType === "static" ? "static" : undefined),
      detailRoute: npc.detailRoute || null,
      currentActionLabel: npc.currentActionLabel || null,
    })),
    portals: travelBundle.portals,
    opportunities,
    pressureSnapshot: worldPlayerBundle.worldPressureSnapshot,
    eventOffers: worldPlayerBundle.activeWorldEventOffers,
    adultInvites: worldPlayerBundle.adultInviteState.invites,
    contracts: worldPlayerBundle.activeWorldContracts,
    openWorldExploration: worldBaseBundle.openWorldExploration,
  });

  return {
    playerPortal: playerPortal ? {
      ...playerPortal,
      targetMapName: playerPortal.targetMapName
        || travelBundle.linkedMapNameById[playerPortal.targetMapId || ""]
        || "",
    } : null,
    portals: travelBundle.portals,
    linkedMaps: travelBundle.linkedMaps,
    travelMode: travelBundle.travelMode,
    pvp: worldBaseBundle.pvp,
    secretRealms: secretRealmBundle.secretRealms,
    currentSecretRealm,
    publicAnnouncement: worldBaseBundle.publicAnnouncement,
    worldPressure: worldPlayerBundle.worldPressureSnapshot.pressure,
    reputationSummary: worldPlayerBundle.worldPressureSnapshot.reputation,
    trackingSignals: worldPlayerBundle.worldPressureSnapshot.trackingSignals,
    primaryObjective: worldSummary.primaryObjective,
    secondaryHooks: worldSummary.secondaryHooks,
    worldIntelLite: worldSummary.worldIntelLite,
    adultInvites: worldPlayerBundle.adultInviteState.invites,
    adultDangerHints: worldPlayerBundle.adultInviteState.adultDangerHints,
    worldObjectivePoints: worldBaseBundle.worldObjectivePoints,
    districtStates: worldPlayerBundle.districtStates,
    activeStorylines: worldPlayerBundle.activeStorylines,
    factionPressureHints: worldPlayerBundle.factionPressureHints,
    openWorldExploration: worldBaseBundle.openWorldExploration,
    travelGraphPreview: worldBaseBundle.openWorldExploration ? {
      currentMapId: map.id,
      currentMapName: map.name,
      regionBand: worldBaseBundle.openWorldExploration.regionBand,
      travelConnections: worldBaseBundle.openWorldExploration.travelConnections,
    } : null,
    mapHeatSummary: worldBaseBundle.openWorldExploration?.mapHeatSummary || null,
    pendingAssassination,
  };
}
