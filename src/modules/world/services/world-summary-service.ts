import type { PlayerWorldContractItem, PlayerWorldEventOfferItem, PlayerWorldPressureSnapshot } from "@/modules/world/services/player-world-pressure-service";
import { listPlayerWorldContracts, listPlayerWorldEventOffers } from "@/modules/world/services/player-world-pressure-service";
import type { WorldAdultInviteView } from "@/modules/world/services/world-adult-service";
import { listOpenWorldDistrictStates, listOpenWorldStorylines } from "@/modules/world/services/world-faction-storyline-service";
import { listOpenWorldObjectivePoints } from "@/modules/world/services/world-objective-points";
import { getOpenWorldMapById, getOpenWorldMapExplorationSummary } from "@/modules/world/services/world-map-service";

type SummaryMapType = string;

export type WorldSummaryNpc = {
  id: string;
  name: string;
  title?: string | null;
  positionX: number;
  positionY: number;
  isShop?: boolean;
  sourceType?: "static" | "world";
  detailRoute?: string | null;
  currentActionLabel?: string | null;
};

export type WorldSummaryPortal = {
  x: number;
  y: number;
  portalId: string;
  portalName: string;
  targetMapId: string;
  targetMapName: string;
};

export type WorldSummaryOpportunity = {
  spawnId: string;
  name: string;
  positionX: number;
  positionY: number;
};

export type WorldPrimaryObjectiveView = {
  sourceType: "contract" | "storyline" | "objective_point" | "opportunity" | "npc" | "travel" | "exploration";
  sourceTypeLabel: string;
  title: string;
  summary: string;
  targetLabel: string | null;
  locationLabel: string | null;
  actionLabel: string | null;
  rewardPreview: string | null;
  targetRoute: string | null;
  positionX: number | null;
  positionY: number | null;
};

export type WorldSecondaryHookView = {
  id: string;
  hookType: "actionable" | "npc" | "place" | "rumor";
  hookTypeLabel: string;
  title: string;
  summary: string;
  targetLabel: string | null;
  locationLabel: string | null;
  guideText: string | null;
  distance: number | null;
  actionLabel: string | null;
  secondaryActionLabel: string | null;
  actionKind?: "route" | "world_offer" | "adult_invite" | null;
  actionRefId?: string | null;
  targetRoute: string | null;
  positionX: number | null;
  positionY: number | null;
};

export type WorldIntelLiteView = {
  summary: string;
  backgroundRumor: string | null;
  keyNpcLabels: string[];
  keyPlaceLabels: string[];
  foldedHint: string;
};

export type WorldSummaryView = {
  primaryObjective: WorldPrimaryObjectiveView | null;
  secondaryHooks: WorldSecondaryHookView[];
  worldIntelLite: WorldIntelLiteView | null;
};

export type WorldIntelDetailView = {
  eventOffers: PlayerWorldEventOfferItem[];
  contracts: PlayerWorldContractItem[];
  districtStates: Awaited<ReturnType<typeof listOpenWorldDistrictStates>>;
  storylines: Awaited<ReturnType<typeof listOpenWorldStorylines>>;
  objectivePoints: ReturnType<typeof listOpenWorldObjectivePoints>;
};

type WorldExplorationLite = {
  regionBand: string;
  heatTier: "hot" | "warm" | "cold";
  heatTierLabel: string;
  travelConnections: Array<{
    role: "main" | "return" | "branch";
    targetMapId: string;
    targetMapName: string;
    travelType: "portal" | "road" | "rift";
    label: string;
    summary: string;
    heatTierHint: string;
  }>;
  rumorHooks: string[];
  encounterHooks: string[];
  secretRealmHooks: string[];
  mapHeatSummary: {
    heatTier: "hot" | "warm" | "cold";
    heatTierLabel: string;
    heatScore: number;
    dangerLevel: number;
    mysteryLevel: number;
    summary: string;
  } | null;
};

type BuildWorldSummaryViewParams = {
  mapId: string;
  mapName: string;
  mapType: SummaryMapType;
  playerPositionX: number;
  playerPositionY: number;
  npcs: WorldSummaryNpc[];
  portals: WorldSummaryPortal[];
  opportunities: WorldSummaryOpportunity[];
  pressureSnapshot: PlayerWorldPressureSnapshot;
  eventOffers: PlayerWorldEventOfferItem[];
  adultInvites: WorldAdultInviteView[];
  contracts: PlayerWorldContractItem[];
  openWorldExploration?: WorldExplorationLite | null;
};

type LoadWorldSummaryViewParams = Omit<BuildWorldSummaryViewParams, "contracts" | "eventOffers"> & {
  playerId: string;
};

const WORLD_SECONDARY_HOOK_MAX = 6;
const WORLD_VISIBLE_EVENT_LIMIT_WITH_PRIMARY = 1;
const WORLD_VISIBLE_EVENT_LIMIT_WITHOUT_PRIMARY = 2;

function calcDistance(ax: number, ay: number, bx: number | null | undefined, by: number | null | undefined) {
  if (typeof bx !== "number" || typeof by !== "number") {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function resolveNpcDetailRoute(npcId: string, explicitRoute?: string | null) {
  if (explicitRoute) {
    return explicitRoute;
  }
  const normalizedNpcId = String(npcId || "").trim();
  if (!normalizedNpcId) {
    return null;
  }
  return normalizedNpcId.includes(":")
    ? `/game/world/npc/${encodeURIComponent(normalizedNpcId)}`
    : `/game/npc/${encodeURIComponent(normalizedNpcId)}`;
}

function buildRewardPreview(contract: PlayerWorldContractItem | null) {
  if (!contract) {
    return null;
  }
  const parts: string[] = [];
  if (contract.rewardGold > 0) {
    parts.push(`灵石 ${contract.rewardGold}`);
  }
  if (contract.rewardLingYu > 0) {
    parts.push(`灵玉 ${contract.rewardLingYu}`);
  }
  return parts.length > 0 ? `做完可得 ${parts.join(" · ")}` : null;
}

function pushSecondaryHook(
  rows: WorldSecondaryHookView[],
  nextHook: WorldSecondaryHookView | null,
  maxCount = WORLD_SECONDARY_HOOK_MAX,
) {
  if (!nextHook || rows.length >= maxCount) {
    return;
  }
  if (rows.some((row) => row.id === nextHook.id)) {
    return;
  }
  rows.push(nextHook);
}

function normalizeGuideDistance(
  playerPositionX: number,
  playerPositionY: number,
  targetPositionX: number | null,
  targetPositionY: number | null,
) {
  const distance = calcDistance(playerPositionX, playerPositionY, targetPositionX, targetPositionY);
  return Number.isFinite(distance) ? distance : null;
}

function buildEventOfferSecondaryHook(params: BuildWorldSummaryViewParams, offer: PlayerWorldEventOfferItem): WorldSecondaryHookView {
  const isCurrentMapTarget = !offer.guideMapId || offer.guideMapId === params.mapId;
  const positionX = isCurrentMapTarget ? offer.guidePositionX : null;
  const positionY = isCurrentMapTarget ? offer.guidePositionY : null;
  const distance = normalizeGuideDistance(
    params.playerPositionX,
    params.playerPositionY,
    positionX,
    positionY,
  );
  const guideSegments = [
    offer.guideSummary,
    offer.guideTargetLabel ? `找谁：${offer.guideTargetLabel}` : null,
    offer.guideLocationLabel ? `去哪：${offer.guideLocationLabel}` : null,
    isCurrentMapTarget && typeof positionX === "number" && typeof positionY === "number"
      ? `坐标：${positionX},${positionY}`
      : null,
    typeof distance === "number" ? (distance <= 1 ? "你已经在推进范围附近。" : `离你约 ${distance} 格。`) : null,
  ].filter(Boolean);

  return {
    id: `offer:${offer.id}`,
    hookType: "actionable",
    hookTypeLabel: "可响应",
    title: offer.offerTypeLabel,
    summary: offer.summary,
    targetLabel: offer.guideTargetLabel,
    locationLabel: offer.guideLocationLabel,
    guideText: guideSegments.join(" "),
    distance,
    actionLabel: "接受来信",
    secondaryActionLabel: "拒绝",
    actionKind: "world_offer",
    actionRefId: offer.id,
    targetRoute: offer.guideRoute,
    positionX,
    positionY,
  };
}

function buildPrimaryObjective(params: BuildWorldSummaryViewParams): WorldPrimaryObjectiveView | null {
  const activeContracts = params.contracts.filter((contract) => contract.contractStatus === "active");
  const currentMapContract = activeContracts.find((contract) => (
    contract.canAdvanceByObjective
    && contract.currentObjectiveMapId === params.mapId
    && contract.currentObjectivePointLabel
  ));
  if (currentMapContract) {
    return {
      sourceType: "contract",
      sourceTypeLabel: "街区主目标",
      title: currentMapContract.title,
      summary: currentMapContract.currentObjectiveHint
        || currentMapContract.progressLabel
        || `前往 ${currentMapContract.currentObjectivePointLabel} 推进这条线。`,
      targetLabel: currentMapContract.currentObjectivePointLabel,
      locationLabel: currentMapContract.currentObjectiveDistrictName
        || currentMapContract.currentObjectiveMapName
        || params.mapName,
      actionLabel: currentMapContract.currentObjectiveActionLabel || "推进目标",
      rewardPreview: buildRewardPreview(currentMapContract),
      targetRoute: null,
      positionX: null,
      positionY: null,
    };
  }

  const currentMapMeetContract = activeContracts.find((contract) => (
    contract.canAdvanceByTalking
    && contract.targetNpcId
    && (!contract.targetMapId || contract.targetMapId === params.mapId)
  ));
  if (currentMapMeetContract) {
    const targetNpc = params.npcs.find((npc) => npc.id === currentMapMeetContract.targetNpcId) || null;
    return {
      sourceType: "contract",
      sourceTypeLabel: "街区主目标",
      title: currentMapMeetContract.title,
      summary: currentMapMeetContract.progressLabel || `去找 ${currentMapMeetContract.targetNpcName || "线人"} 递话。`,
      targetLabel: currentMapMeetContract.targetNpcName,
      locationLabel: currentMapMeetContract.targetDistrictName || params.mapName,
      actionLabel: currentMapMeetContract.actionLabel || "递上暗语",
      rewardPreview: buildRewardPreview(currentMapMeetContract),
      targetRoute: currentMapMeetContract.targetNpcId
        ? resolveNpcDetailRoute(currentMapMeetContract.targetNpcId, targetNpc?.detailRoute || null)
        : null,
      positionX: targetNpc?.positionX ?? null,
      positionY: targetNpc?.positionY ?? null,
    };
  }

  const offMapContract = activeContracts.find((contract) => (
    contract.contractStatus === "active"
    && (
      (contract.canAdvanceByObjective && contract.currentObjectiveMapId && contract.currentObjectiveMapId !== params.mapId)
      || (contract.canAdvanceByTalking && contract.targetMapId && contract.targetMapId !== params.mapId)
    )
  ));
  if (offMapContract) {
    const locationLabel = offMapContract.currentObjectiveMapName
      || offMapContract.targetMapName
      || "外地界";
    return {
      sourceType: "travel",
      sourceTypeLabel: "下一步去向",
      title: offMapContract.title,
      summary: offMapContract.progressLabel || `先赶往 ${locationLabel}，这条线才接得上。`,
      targetLabel: offMapContract.currentObjectivePointLabel || offMapContract.targetNpcName,
      locationLabel,
      actionLabel: "动身前往",
      rewardPreview: buildRewardPreview(offMapContract),
      targetRoute: null,
      positionX: null,
      positionY: null,
    };
  }

  const nearestOpportunity = [...params.opportunities]
    .sort((left, right) => (
      calcDistance(params.playerPositionX, params.playerPositionY, left.positionX, left.positionY)
      - calcDistance(params.playerPositionX, params.playerPositionY, right.positionX, right.positionY)
    ))[0];
  if (nearestOpportunity) {
    return {
      sourceType: "opportunity",
      sourceTypeLabel: "当前机缘",
      title: nearestOpportunity.name,
      summary: "先靠近这处机缘点，看看天道会在此推演出什么变化。",
      targetLabel: nearestOpportunity.name,
      locationLabel: `${nearestOpportunity.positionX},${nearestOpportunity.positionY}`,
      actionLabel: "前去感应",
      rewardPreview: null,
      targetRoute: null,
      positionX: nearestOpportunity.positionX,
      positionY: nearestOpportunity.positionY,
    };
  }

  const nearestNpc = [...params.npcs]
    .sort((left, right) => (
      calcDistance(params.playerPositionX, params.playerPositionY, left.positionX, left.positionY)
      - calcDistance(params.playerPositionX, params.playerPositionY, right.positionX, right.positionY)
    ))[0];
  if (nearestNpc) {
    return {
      sourceType: "npc",
      sourceTypeLabel: "附近人物",
      title: nearestNpc.name,
      summary: nearestNpc.currentActionLabel
        ? `${nearestNpc.name} 此刻正在${nearestNpc.currentActionLabel}，先接近此人，也许能摸到此地的线头。`
        : nearestNpc.isShop
          ? `${nearestNpc.name} 还守在摊前，先去看看此地的消息与货路。`
          : `先去找 ${nearestNpc.name} 打个照面，看看此地的风向落在谁身上。`,
      targetLabel: nearestNpc.name,
      locationLabel: `${nearestNpc.positionX},${nearestNpc.positionY}`,
      actionLabel: nearestNpc.isShop ? "前去问价" : "前去接触",
      rewardPreview: null,
      targetRoute: resolveNpcDetailRoute(nearestNpc.id, nearestNpc.detailRoute || null),
      positionX: nearestNpc.positionX,
      positionY: nearestNpc.positionY,
    };
  }

  const nearestPortal = [...params.portals]
    .sort((left, right) => (
      calcDistance(params.playerPositionX, params.playerPositionY, left.x, left.y)
      - calcDistance(params.playerPositionX, params.playerPositionY, right.x, right.y)
    ))[0];
  if (nearestPortal) {
    return {
      sourceType: "travel",
      sourceTypeLabel: "去路提示",
      title: nearestPortal.portalName,
      summary: `若想换片地界，可以先去 ${nearestPortal.portalName}，它通往 ${nearestPortal.targetMapName}。`,
      targetLabel: nearestPortal.targetMapName,
      locationLabel: `${nearestPortal.x},${nearestPortal.y}`,
      actionLabel: "前往阵点",
      rewardPreview: null,
      targetRoute: null,
      positionX: nearestPortal.x,
      positionY: nearestPortal.y,
    };
  }

  const firstTravelConnection = params.openWorldExploration?.travelConnections[0];
  if (firstTravelConnection) {
    return {
      sourceType: "exploration",
      sourceTypeLabel: "界域动向",
      title: firstTravelConnection.label,
      summary: firstTravelConnection.summary,
      targetLabel: firstTravelConnection.targetMapName,
      locationLabel: params.openWorldExploration?.regionBand || params.mapName,
      actionLabel: "查看去路",
      rewardPreview: null,
      targetRoute: null,
      positionX: null,
      positionY: null,
    };
  }

  return null;
}

function buildSecondaryHooks(params: BuildWorldSummaryViewParams, primaryObjective: WorldPrimaryObjectiveView | null) {
  const hooks: WorldSecondaryHookView[] = [];

  const firstEventOffer = params.eventOffers[0];
  if (firstEventOffer) {
    pushSecondaryHook(hooks, buildEventOfferSecondaryHook(params, firstEventOffer));
  }

  const firstInvite = params.adultInvites[0];
  if (firstInvite) {
    const inviteNpc = params.npcs.find((npc) => npc.id === firstInvite.npcId) || null;
    const inviteDistance = inviteNpc
      ? normalizeGuideDistance(
        params.playerPositionX,
        params.playerPositionY,
        inviteNpc.positionX,
        inviteNpc.positionY,
      )
      : null;
    pushSecondaryHook(hooks, {
      id: `adult:${firstInvite.eventLogId}`,
      hookType: "actionable",
      hookTypeLabel: "可响应",
      title: firstInvite.title,
      summary: firstInvite.summary,
      targetLabel: firstInvite.npcName,
      locationLabel: inviteNpc?.currentActionLabel || params.mapName,
      guideText: inviteNpc
        ? `${firstInvite.npcName} 就在附近，先按坐标靠过去，再看清全文决定如何回应。`
        : "先点开邀约查看全文，再决定是否回应对方。",
      distance: inviteDistance,
      actionLabel: "查看邀约",
      secondaryActionLabel: null,
      actionKind: "adult_invite",
      actionRefId: firstInvite.eventLogId,
      targetRoute: resolveNpcDetailRoute(firstInvite.npcId),
      positionX: inviteNpc?.positionX ?? null,
      positionY: inviteNpc?.positionY ?? null,
    });
  }

  const nearbyNpc = [...params.npcs]
    .filter((npc) => npc.name !== primaryObjective?.targetLabel)
    .sort((left, right) => (
      calcDistance(params.playerPositionX, params.playerPositionY, left.positionX, left.positionY)
      - calcDistance(params.playerPositionX, params.playerPositionY, right.positionX, right.positionY)
    ))[0];
  if (nearbyNpc) {
    pushSecondaryHook(hooks, {
      id: `npc:${nearbyNpc.id}`,
      hookType: "npc",
      hookTypeLabel: "关键人物",
      title: nearbyNpc.name,
      summary: nearbyNpc.currentActionLabel
        ? `此人正在${nearbyNpc.currentActionLabel}。`
        : nearbyNpc.isShop
          ? "这人还守着摊位，常能问出本地口风。"
          : "先记住这张脸，很多线索都得从人身上开口。",
      targetLabel: nearbyNpc.name,
      locationLabel: `${nearbyNpc.positionX},${nearbyNpc.positionY}`,
      guideText: nearbyNpc.isShop ? "先靠近摊位再开口。" : "靠近后可直接查看人物或尝试交谈。",
      distance: normalizeGuideDistance(
        params.playerPositionX,
        params.playerPositionY,
        nearbyNpc.positionX,
        nearbyNpc.positionY,
      ),
      actionLabel: "查看人物",
      secondaryActionLabel: null,
      actionKind: "route",
      actionRefId: nearbyNpc.id,
      targetRoute: resolveNpcDetailRoute(nearbyNpc.id, nearbyNpc.detailRoute || null),
      positionX: nearbyNpc.positionX,
      positionY: nearbyNpc.positionY,
    });
  }

  const keyPlace = params.openWorldExploration?.travelConnections[0];
  if (keyPlace) {
    pushSecondaryHook(hooks, {
      id: `travel:${keyPlace.targetMapId}`,
      hookType: "place",
      hookTypeLabel: "关键地点",
      title: keyPlace.label,
      summary: keyPlace.summary,
      targetLabel: keyPlace.targetMapName,
      locationLabel: params.openWorldExploration?.regionBand || params.mapName,
      guideText: "先记下这条去路，需要换图时再沿传送阵或路网动身。",
      distance: null,
      actionLabel: "记下去路",
      secondaryActionLabel: null,
      actionKind: null,
      actionRefId: null,
      targetRoute: null,
      positionX: null,
      positionY: null,
    });
  } else {
    const nearbyPortal = [...params.portals]
      .sort((left, right) => (
        calcDistance(params.playerPositionX, params.playerPositionY, left.x, left.y)
        - calcDistance(params.playerPositionX, params.playerPositionY, right.x, right.y)
      ))[0];
    if (nearbyPortal) {
      pushSecondaryHook(hooks, {
        id: `portal:${nearbyPortal.portalId}`,
        hookType: "place",
        hookTypeLabel: "关键地点",
        title: nearbyPortal.portalName,
        summary: `此阵可通往 ${nearbyPortal.targetMapName}。`,
        targetLabel: nearbyPortal.targetMapName,
        locationLabel: `${nearbyPortal.x},${nearbyPortal.y}`,
        guideText: "先靠近阵点，再决定是否换图。",
        distance: normalizeGuideDistance(
          params.playerPositionX,
          params.playerPositionY,
          nearbyPortal.x,
          nearbyPortal.y,
        ),
        actionLabel: "查看阵点",
        secondaryActionLabel: null,
        actionKind: null,
        actionRefId: null,
        targetRoute: null,
        positionX: nearbyPortal.x,
        positionY: nearbyPortal.y,
      });
    }
  }

  if (hooks.length < 2) {
    const rumorSummary = String(
      params.pressureSnapshot.pressure.summary
      || params.openWorldExploration?.rumorHooks[0]
      || params.pressureSnapshot.trackingSignals[0]?.summary
      || "",
    ).trim();
    if (rumorSummary) {
      pushSecondaryHook(hooks, {
        id: "rumor:background",
        hookType: "rumor",
        hookTypeLabel: "背景风声",
        title: params.pressureSnapshot.pressure.tierLabel || "世界动静",
        summary: rumorSummary,
        targetLabel: null,
        locationLabel: null,
        guideText: "这是背景风声，不是立即可接的事件；想看更多后续，可展开世界动静。",
        distance: null,
        actionLabel: null,
        secondaryActionLabel: null,
        actionKind: null,
        actionRefId: null,
        targetRoute: null,
        positionX: null,
        positionY: null,
      });
    }
  }

  return hooks.slice(0, WORLD_SECONDARY_HOOK_MAX);
}

function buildWorldIntelLite(
  params: BuildWorldSummaryViewParams,
  primaryObjective: WorldPrimaryObjectiveView | null,
  secondaryHooks: WorldSecondaryHookView[],
): WorldIntelLiteView | null {
  const visibleEventBudget = primaryObjective
    ? WORLD_VISIBLE_EVENT_LIMIT_WITH_PRIMARY
    : WORLD_VISIBLE_EVENT_LIMIT_WITHOUT_PRIMARY;
  const visibleSecondaryCount = Math.min(secondaryHooks.length, visibleEventBudget);
  const queuedSecondaryCount = Math.max(0, secondaryHooks.length - visibleSecondaryCount);
  const keyNpcLabels = params.npcs
    .slice()
    .sort((left, right) => (
      calcDistance(params.playerPositionX, params.playerPositionY, left.positionX, left.positionY)
      - calcDistance(params.playerPositionX, params.playerPositionY, right.positionX, right.positionY)
    ))
    .slice(0, 3)
    .map((npc) => npc.name);
  const keyPlaceLabels = [
    ...(params.openWorldExploration?.travelConnections || []).slice(0, 2).map((connection) => connection.label),
    ...params.portals.slice(0, 1).map((portal) => portal.portalName),
  ].filter(Boolean);

  const actionableCount = params.eventOffers.length
    + params.adultInvites.length
    + params.contracts.filter((contract) => contract.contractStatus === "active").length;
  const placeCount = params.portals.length + (params.openWorldExploration?.travelConnections.length || 0);
  const summaryParts = [
    primaryObjective
      ? "眼下先办这 1 件事"
      : actionableCount > 0
        ? `眼下先挑 ${Math.min(actionableCount, WORLD_VISIBLE_EVENT_LIMIT_WITHOUT_PRIMARY)} 条动静`
        : null,
    queuedSecondaryCount > 0 ? `另有 ${queuedSecondaryCount} 条后续会缓些浮上来` : null,
    placeCount > 0 && !primaryObjective ? `${Math.min(placeCount, 2)} 处去路可转` : null,
  ].filter(Boolean) as string[];
  const backgroundRumor = String(
    primaryObjective || visibleSecondaryCount > 0
      ? ""
      : params.openWorldExploration?.rumorHooks[0]
        || params.pressureSnapshot.pressure.summary
        || params.pressureSnapshot.trackingSignals[0]?.summary
        || secondaryHooks.find((hook) => hook.hookType === "rumor")?.summary
    || "",
  ).trim() || null;

  if (summaryParts.length <= 0 && !backgroundRumor && keyNpcLabels.length <= 0 && keyPlaceLabels.length <= 0) {
    return null;
  }

  return {
    summary: summaryParts.slice(0, 3).join(" · ") || "此地眼下并无过多波澜。",
    backgroundRumor,
    keyNpcLabels,
    keyPlaceLabels,
    foldedHint: queuedSecondaryCount > 0
      ? `其余 ${queuedSecondaryCount} 条动静已转入后列，会在你停留或处理当前事项后再慢些浮上来。`
      : "展开后可继续查看街区局势、故事链、暗线委托与额外风声。",
  };
}

export function buildWorldSummaryView(params: BuildWorldSummaryViewParams): WorldSummaryView {
  const primaryObjective = buildPrimaryObjective(params);
  const secondaryHooks = buildSecondaryHooks(params, primaryObjective);
  const worldIntelLite = buildWorldIntelLite(params, primaryObjective, secondaryHooks);
  return {
    primaryObjective,
    secondaryHooks,
    worldIntelLite,
  };
}

export async function loadWorldSummaryView(params: LoadWorldSummaryViewParams): Promise<WorldSummaryView> {
  const [eventOffers, contracts] = params.mapType === "open_world"
    ? await Promise.all([
      listPlayerWorldEventOffers(params.playerId).catch(() => []),
      listPlayerWorldContracts(params.playerId).catch(() => []),
    ])
    : [[], []];
  return buildWorldSummaryView({
    ...params,
    eventOffers,
    contracts,
  });
}

export async function loadWorldIntelDetailView(params: {
  playerId: string;
  mapId: string;
  mapType: SummaryMapType;
}): Promise<WorldIntelDetailView> {
  if (params.mapType !== "open_world") {
    return {
      eventOffers: [],
      contracts: [],
      districtStates: [],
      storylines: [],
      objectivePoints: [],
    };
  }

  const [eventOffers, contracts, districtStates, storylines] = await Promise.all([
    listPlayerWorldEventOffers(params.playerId).catch(() => []),
    listPlayerWorldContracts(params.playerId).catch(() => []),
    listOpenWorldDistrictStates({
      mapId: params.mapId,
      playerId: params.playerId,
    }).catch(() => []),
    listOpenWorldStorylines({
      mapId: params.mapId,
      playerId: params.playerId,
    }).catch(() => []),
  ]);

  return {
    eventOffers,
    contracts,
    districtStates,
    storylines,
    objectivePoints: listOpenWorldObjectivePoints(params.mapId),
  };
}

export async function loadRemoteMapWorldSummary(params: {
  playerId: string;
  mapId: string;
  mapType: SummaryMapType;
  mapName: string;
  pressureSnapshot: PlayerWorldPressureSnapshot;
}) {
  const openWorldExploration = params.mapType === "open_world"
    ? await getOpenWorldMapExplorationSummary(params.mapId).catch(() => null)
    : null;
  const remoteMap = params.mapType === "open_world"
    ? await getOpenWorldMapById(params.mapId).catch(() => null)
    : null;
  return buildWorldSummaryView({
    mapId: params.mapId,
    mapName: params.mapName,
    mapType: params.mapType,
    playerPositionX: 0,
    playerPositionY: 0,
    npcs: [],
    portals: [],
    opportunities: [],
    pressureSnapshot: params.pressureSnapshot,
    eventOffers: params.mapType === "open_world"
      ? await listPlayerWorldEventOffers(params.playerId).catch(() => [])
      : [],
    adultInvites: [],
    contracts: params.mapType === "open_world"
      ? await listPlayerWorldContracts(params.playerId).catch(() => [])
      : [],
    openWorldExploration: (openWorldExploration || remoteMap)
      ? {
        regionBand: remoteMap?.regionBand || openWorldExploration?.regionBand || params.mapName,
        heatTier: openWorldExploration?.heatTier || "cold",
        heatTierLabel: openWorldExploration?.heatTierLabel || "冷图",
        travelConnections: openWorldExploration?.travelConnections || [],
        rumorHooks: openWorldExploration?.rumorHooks || [],
        encounterHooks: openWorldExploration?.encounterHooks || [],
        secretRealmHooks: openWorldExploration?.secretRealmHooks || [],
        mapHeatSummary: openWorldExploration?.mapHeatSummary || null,
      }
      : null,
  });
}
