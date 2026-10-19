"use client";

import { memo, startTransition, useDeferredValue, useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { App, Typography, Spin, Button, Space, message, Modal, Collapse, type CollapseProps } from "antd";
import {
  EnvironmentOutlined, ReloadOutlined, LogoutOutlined,
  MessageOutlined,
  UserAddOutlined,
  HeartOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  LeftOutlined,
  RightOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import MapGrid from "@/modules/map/ui/components/MapGrid";
import type { MapGridCellClickPayload } from "@/modules/map/ui/components/MapGrid";
import WorldMapPhaserScene from "@/modules/map/ui/components/WorldMapPhaserScene";
import EventModal, {
  type EventModalData,
  type EventResultData,
} from "@/modules/map/ui/components/EventModal";
import ItemDetailModal from "@/modules/character/ui/components/ItemDetailModal";
import {
  createMapSceneSnapshot,
  buildMapSceneStateFromMapData,
  type MapSceneSnapshot,
} from "@/modules/map/services/map-scene-state";
import type { MapSceneSelfCorrection } from "@/modules/map/services/map-scene-render-state";
import {
  filterMapPositionsByFogLevel,
  normalizeCenteredMapViewSize,
  resolveMapViewSizeRange,
} from "@/modules/map/services/map-vision";
import {
  useMapSceneController,
  type MapMoveRequestExecutor,
} from "@/modules/map/ui/hooks/useMapSceneController";
import {
  useWorldMapColyseusAoi,
  resolveWorldMapColyseusMode,
  type WorldMapColyseusAoiSnapshot,
} from "@/modules/map/ui/hooks/useWorldMapColyseusAoi";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import PlayerProfileContent, {
  type PlayerProfileContentModel,
} from "@/modules/shared/ui/components/PlayerProfileContent";
import ScrollableContent from "@/modules/shared/ui/components/ScrollableContent";
import PartyFloatingPanel from "@/modules/social/ui/PartyFloatingPanel";
import type { PartySnapshot } from "@/modules/social/domain/party-types";
import { useSocialRoomPresence } from "@/modules/social/ui/hooks/useSocialRoomPresence";
import { openJsonEventStream } from "@/modules/shared/services/realtime-channel";
import { createActionRequestMeta } from "@/modules/shared/services/action-request";
import { MAP_TYPE_NAMES, MONSTER_TYPE_NAMES } from "@/modules/shared/constants";
import type { MapEncounterSessionView, MapEncounterStageView } from "@/types/game";

const { Text } = Typography;
const MONSTER_TYPE_TAG_COLORS: Record<string, "default" | "blue" | "purple" | "red"> = {
  normal: "default",
  elite: "purple",
  boss: "red",
};
const SECRET_REALM_SIZE_LABELS = {
  small: "小型",
  medium: "中型",
  large: "大型",
} as const;
const SECRET_REALM_RARITY_LABELS = {
  common: "凡品",
  rare: "上品",
  epic: "极品",
  legendary: "仙品",
} as const;
const MIN_VIEW_SIZE = 3;
const MAX_VIEW_SIZE = 99;
const VIEW_SIZE_STEP = 2;
const MAP_VIEW_SIZE_STORAGE_KEY = "immortality:map:view-size";
const INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY = "game:invalid-boss-encounter-redirect-guard";
const PARTY_FAST_POLL_INTERVAL_MS = 3000;
const PARTY_SLOW_POLL_INTERVAL_MS = 12000;
const PARTY_SILENT_REFRESH_MIN_INTERVAL_MS = 2500;
const SECRET_REALM_PANEL_SYNC_INTERVAL_MS = 2500;
const MAX_QUEUED_MAP_MOVE_DISTANCE = 4;
const HONGMENG_ANNOUNCEMENT_DURATION_MS = 12_000;
const HONGMENG_ANNOUNCEMENT_RECENT_WINDOW_MS = 20_000;
const DEFAULT_COMPACT_VIEWPORT = true;
const DEFAULT_MOBILE_VIEWPORT_HEIGHT = 760;
const WORLD_MAP_COLYSEUS_MODE = resolveWorldMapColyseusMode();
const WORLD_MAP_PHASER_SCENE_ENABLED = process.env.NEXT_PUBLIC_WORLD_MAP_PHASER_SCENE === "1";
const WORLD_MAP_COLYSEUS_SHADOW_DRIFT_GRACE_MS = 800;
const WORLD_MAP_COLYSEUS_SHADOW_DRIFT_REPAIR_INTERVAL_MS = 5_000;
const WORLD_MAP_MOVE_CONNECTION_WAIT_MS = 2200;
const WORLD_MAP_MOVE_CONNECTION_POLL_MS = 80;

type ChatAnnouncementSseEvent =
  | { type: "connected" }
  | {
    type: "chat_message";
    data: {
      id: number;
      messageType: "player" | "system";
      senderName: string;
      content: string;
      createdAt: string;
    };
  };

type TemporaryAnnouncementState = {
  id: string;
  content: string;
};

type ColyseusShadowMoveState = {
  requestedAt: number;
  clientSequence: number;
  targetX: number;
  targetY: number;
  authoritativeX: number;
  authoritativeY: number;
  sent: boolean;
};

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function isHongmengTreasureAnnouncementMessage(event: ChatAnnouncementSseEvent): event is Extract<ChatAnnouncementSseEvent, { type: "chat_message" }> {
  if (event.type !== "chat_message") {
    return false;
  }
  const senderName = String(event.data.senderName || "").trim();
  const content = String(event.data.content || "").trim();
  if (!content) {
    return false;
  }
  if (senderName !== "天道") {
    return false;
  }
  return content.includes("鸿蒙至宝") && content.includes("掌天瓶");
}

interface MapData {
  map: {
    id: string; name: string; description: string;
    backgroundImageUrl?: string | null;
    width: number; height: number; mapType: string;
    tilesData: {
      x: number;
      y: number;
      type: string;
      walkable?: boolean;
      description?: string;
      imageUrl?: string;
      portalId?: string;
      portalName?: string;
      portalTargetMapId?: string;
      portalTargetPortalId?: string;
      portalTargetName?: string;
    }[];
  };
  player: {
    id: string;
    positionX: number;
    positionY: number;
    currentMapInstanceId?: string | null;
    name: string;
    gender?: string | null;
    avatarImageUrl?: string | null;
    avatarFrameImageUrl?: string | null;
    realm: number;
    realmMajor?: number | null;
    realmMinor?: number | null;
    realmName?: string;
    combatPower: number;
    spiritualSense: number;
    gold: number;
    lingYu: number;
    stamina: number;
    staminaMax: number;
  };
  travelMode: "direct" | "portal";
  playerOnPortal: boolean;
  playerPortal?: {
    x: number;
    y: number;
    portalId: string;
    portalName: string;
    targetMapId: string;
    targetMapName: string;
    targetPortalId: string;
    imageUrl?: string | null;
  } | null;
  portals: Array<{
    x: number;
    y: number;
    portalId: string;
    portalName: string;
    targetMapId: string;
    targetMapName: string;
    targetPortalId: string;
    imageUrl?: string | null;
  }>;
  linkedMaps: {
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
  }[];
  npcs: {
    id: string;
    name: string;
    title: string;
    avatarImageUrl?: string | null;
    positionX: number;
    positionY: number;
    isShop: boolean;
    sourceType?: "static" | "world";
    detailRoute?: string | null;
    realmName?: string | null;
    currentActionLabel?: string | null;
    isKillable?: boolean;
    status?: string | null;
  }[];
  monsters: {
    id: string;
    name: string;
    avatarImageUrl?: string | null;
    monsterType: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    drops: {
      itemId: string;
      itemName: string;
      itemIconUrl?: string | null;
      itemRarity?: string | null;
      chance: number;
      minQuantity: number;
      maxQuantity: number;
    }[];
    dropIntel?: {
      label: string;
      rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
      rarityLabel: string;
      chanceText: string;
      quantityText: string;
    }[];
    positionX: number;
    positionY: number;
  }[];
  otherPlayers: {
    id: string;
    name: string;
    gender?: string | null;
    avatarImageUrl?: string | null;
    avatarFrameImageUrl?: string | null;
    realm: number;
    realmMajor?: number | null;
    realmMinor?: number | null;
    realmName: string;
    positionX: number;
    positionY: number;
  }[];
  opportunities: {
    spawnId: string;
    eventId: string;
    name: string;
    iconImageUrl?: string | null;
    minRealm: number;
    maxRealm: number | null;
    positionX: number;
    positionY: number;
    expiresAt: string;
  }[];
  activeEncounterSession?: {
    encounterSession: MapEncounterSessionView;
    stage?: MapEncounterStageView;
    finalEvent?: EventResultData | null;
    sessionStatus: "active" | "completed" | "expired";
  } | null;
  secretRealms: Array<{
    id: string;
    templateId: string;
    mapId: string;
    mapName: string;
    spawnType: "global" | "personal";
    visibilityScope: "world" | "owner" | "party";
    status: "active" | "entered" | "completed" | "expired";
    name: string;
    description: string;
    announcementText: string;
    bossName: string;
    sizeTier: "small" | "medium" | "large";
    rarity: "common" | "rare" | "epic" | "legendary";
    recommendedRealm: number;
    recommendedRealmName?: string;
    rewardBudget: number;
    positionX: number;
    positionY: number;
    expiresAt: string;
    ownerPlayerId: string | null;
    partyId: string | null;
    mapInstanceId: string | null;
    specialType?: "wild_wolf_valley" | null;
    showAttentionDot?: boolean;
    specialHint?: string | null;
    seedFocusTags?: string[];
    hasHighTierSeedChance?: boolean;
    dropIntelPreview?: Array<{
      label: string;
      rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
      rarityLabel: string;
      chanceText: string;
      quantityText: string;
    }>;
  }>;
  currentSecretRealm?: {
    instanceId: string;
    mapId: string;
    spawnId: string;
    templateId: string;
    announcementText: string;
    theme: string;
    status: "active" | "settling" | "completed" | "expired";
    spawnType: "global" | "personal";
    name: string;
    description: string;
    bossName: string;
    rarity: "common" | "rare" | "epic" | "legendary";
    sizeTier: "small" | "medium" | "large";
    recommendedRealm: number;
    recommendedRealmName?: string;
    ownerPlayerId: string | null;
    memberPlayerIds: string[];
    memberCount: number;
    bossMonsterId: string | null;
    bossAlive: boolean;
    bossDefeatedAt: string | null;
    coreRewardOwnerPlayerId: string | null;
    sourceMapId: string | null;
    sourceMapName: string | null;
    returnPortalX: number;
    returnPortalY: number;
    canLeaveNow: boolean;
    expiresAt: string;
    specialType?: "wild_wolf_valley" | null;
    showAttentionDot?: boolean;
    specialHint?: string | null;
    wildWolfValleyBottleOwned?: boolean;
    wildWolfValleyMobBottleChance?: number;
    wildWolfValleyBossBottleChance?: number;
    seedFocusTags?: string[];
    hasHighTierSeedChance?: boolean;
    bossGateStatus?: {
      isUnlocked: boolean;
      guardRequired: number;
      guardDefeated: number;
      totalNonBossMonsterCount?: number;
      clearRequired: number;
      clearDefeated: number;
      remainingGuardCount: number;
      remainingClearCount: number;
    } | null;
    dropIntelPreview?: Array<{
      label: string;
      rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
      rarityLabel: string;
      chanceText: string;
      quantityText: string;
    }>;
  } | null;
  publicAnnouncement?: string;
  worldPressure?: {
    notorietyScore: number;
    bountyHeat: number;
    shadowFavor: number;
    lawfulPressure: number;
    activeAlertTier: "observe" | "rumor" | "stalk" | "bounty" | "ambush";
    activeWatcherCount: number;
    tierLabel: string;
    tierDescription: string;
    summary: string;
    lawfulSummary: string;
    shadowSummary: string;
    nextRiskLabel: string;
  };
  reputationSummary?: {
    overallLabel: string;
    overallSummary: string;
    socialFlavorLabel: string;
    adultStageLabel: string;
    notorietyLabel: string;
    shadowLabel: string;
    sensualLabel: string;
    willIgnorePlayer: boolean;
    needsBrokerRelief: boolean;
    canInviteTreasureHunt: boolean;
    canGiftLingShi: boolean;
    canInviteDualCultivation: boolean;
    forcedAdultRisk: boolean;
    repairHint: string;
    repairActions: string[];
    worldBehaviorHints: string[];
  } | null;
  primaryObjective?: {
    sourceType: "contract" | "storyline" | "objective_point" | "opportunity" | "npc" | "travel" | "exploration";
    sourceTypeLabel: string;
    title: string;
    summary: string;
    targetLabel?: string | null;
    locationLabel?: string | null;
    actionLabel?: string | null;
    rewardPreview?: string | null;
    targetRoute?: string | null;
    positionX?: number | null;
    positionY?: number | null;
  } | null;
  secondaryHooks?: Array<{
    id: string;
    hookType: "actionable" | "npc" | "place" | "rumor";
    hookTypeLabel: string;
    title: string;
    summary: string;
    targetLabel?: string | null;
    locationLabel?: string | null;
    guideText?: string | null;
    distance?: number | null;
    actionLabel?: string | null;
    secondaryActionLabel?: string | null;
    actionKind?: "route" | "world_offer" | "adult_invite" | null;
    actionRefId?: string | null;
    targetRoute?: string | null;
    positionX?: number | null;
    positionY?: number | null;
  }>;
  worldIntelLite?: {
    summary: string;
    backgroundRumor?: string | null;
    keyNpcLabels?: string[];
    keyPlaceLabels?: string[];
    foldedHint?: string;
  } | null;
  trackingSignals?: Array<{
    stage: "observe" | "rumor" | "stalk" | "bounty" | "ambush";
    stageLabel: string;
    severity: "low" | "medium" | "high";
    title: string;
    summary: string;
    incidentType: string | null;
    sourceType: string | null;
    mapId: string | null;
    districtName: string | null;
    createdAt: string;
  }>;
  worldObjectivePoints?: Array<{
    id: string;
    label: string;
    pointType: "rumor_stela" | "shadow_contact" | "black_market_stall" | "hidden_shrine" | "smuggling_gate";
    pointTypeLabel: string;
    districtName: string | null;
    positionX: number;
    positionY: number;
    description: string;
    interactionHint: string;
  }>;
  districtStates?: Array<{
    id: string;
    mapId: string;
    districtName: string;
    districtIndex: number;
    dominantFactionId: string | null;
    dominantFactionName: string;
    dominantFactionCategory: string;
    dominantFactionLabel: string;
    tensionTag: string;
    hotspotSummary: string;
    dangerLevel: number;
    dangerLabel: string;
    influenceBreakdown: {
      lawful: number;
      gray: number;
      demonic: number;
      localControl: number;
    };
    objectivePoints: Array<{
      id: string;
      label: string;
      pointTypeLabel: string;
    }>;
    activeStorylineCount: number;
    activeHooks: {
      hotspotTitles?: string[];
      rumorHints?: string[];
      nextHooks?: string[];
      lastIncidentTypes?: string[];
    };
    updatedAt: string;
  }>;
  activeStorylines?: Array<{
    id: string;
    mapId: string;
    districtName: string;
    storylineType: string;
    storylineTypeLabel: string;
    stageIndex: number;
    stageLabel: string;
    title: string;
    summary: string;
    status: string;
    sourceFactionId: string | null;
    sourceFactionName: string;
    sourceFactionLabel: string;
    objectivePointId: string | null;
    objectivePointLabel: string | null;
    objectiveDistrictName: string | null;
    objectiveMapId?: string | null;
    objectivePositionX?: number | null;
    objectivePositionY?: number | null;
    linkedNpcIds: string[];
    linkedNpcNames: string[];
    canAdvance: boolean;
    availableActionLabel: string;
    advanceHint: string;
    playerMomentumTags: string[];
    updatedAt: string;
  }>;
  factionPressureHints?: string[];
  openWorldExploration?: {
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
    };
  } | null;
  travelGraphPreview?: {
    currentMapId: string;
    currentMapName: string;
    regionBand: string;
    travelConnections: Array<{
      role: "main" | "return" | "branch";
      targetMapId: string;
      targetMapName: string;
      travelType: "portal" | "road" | "rift";
      label: string;
      summary: string;
      heatTierHint: string;
    }>;
  } | null;
  mapHeatSummary?: {
    heatTier: "hot" | "warm" | "cold";
    heatTierLabel: string;
    heatScore: number;
    dangerLevel: number;
    mysteryLevel: number;
    summary: string;
  } | null;
  adultInvites?: Array<{
    eventLogId: string;
    npcId: string;
    npcName: string;
    actionType: "seduce_invite" | "dual_cultivation" | "essence_drain" | "dangerous_preference";
    actionLabel: string;
    title: string;
    summary: string;
    atmosphere: string;
    dispositionLabel: string;
    responseOptions: string[];
    expiresAt: string | null;
    createdAt: string;
  }>;
  adultDangerHints?: string[];
  pendingAssassination?: {
    id: string;
    npcId: string;
    npcName: string;
    npcRealmName: string;
    npcFaction?: string | null;
    npcProfession?: string | null;
    districtName?: string | null;
    threatLevel: "low" | "medium" | "high";
    threatLabel: string;
    probeSummary: string;
    assassinationSummary: string;
    intro: string;
    escapeChancePercent: number;
    escapeDifficultyLabel: string;
    createdAt: string;
  } | null;
  pvp?: {
    enabled: boolean;
    source: "map-id" | "map-type" | null;
  };
  sceneTick?: number;
  sceneServerTimeMs?: number;
  sceneSnapshot?: MapSceneSnapshot | null;
}

type MapSceneData = Pick<MapData,
  "map"
  | "player"
  | "playerOnPortal"
  | "playerPortal"
  | "portals"
  | "npcs"
  | "monsters"
  | "otherPlayers"
  | "opportunities"
  | "activeEncounterSession"
  | "sceneTick"
  | "sceneServerTimeMs"
  | "sceneSnapshot"
>;

type MapPanelData = Pick<MapData,
  "travelMode"
  | "linkedMaps"
  | "secretRealms"
  | "currentSecretRealm"
  | "publicAnnouncement"
  | "worldPressure"
  | "reputationSummary"
  | "primaryObjective"
  | "secondaryHooks"
  | "worldIntelLite"
  | "trackingSignals"
  | "worldObjectivePoints"
  | "districtStates"
  | "activeStorylines"
  | "factionPressureHints"
  | "openWorldExploration"
  | "travelGraphPreview"
  | "mapHeatSummary"
  | "adultInvites"
  | "adultDangerHints"
  | "pendingAssassination"
  | "pvp"
>;

type MapApiData = MapSceneData & Partial<MapPanelData>;
type NearbyMapEntity =
  | (MapData["npcs"][number] & { entityType: "npc" })
  | (MapData["monsters"][number] & { entityType: "monster" });

const EMPTY_MAP_PANEL_DATA: MapPanelData = {
  travelMode: "direct",
  linkedMaps: [],
  secretRealms: [],
  currentSecretRealm: null,
  publicAnnouncement: "",
  worldPressure: undefined,
  reputationSummary: null,
  primaryObjective: null,
  secondaryHooks: [],
  worldIntelLite: null,
  trackingSignals: [],
  worldObjectivePoints: [],
  districtStates: [],
  activeStorylines: [],
  factionPressureHints: [],
  openWorldExploration: null,
  travelGraphPreview: null,
  mapHeatSummary: null,
  adultInvites: [],
  adultDangerHints: [],
  pendingAssassination: null,
  pvp: undefined,
};

type PendingAssassinationData = NonNullable<MapData["pendingAssassination"]>;
type AdultInviteData = NonNullable<MapData["adultInvites"]>[number];

type WorldEventOfferData = {
  id: string;
  offerType:
    | "black_market_trade"
    | "shadow_intel"
    | "cultivator_hunt"
    | "demonic_temptation"
    | "pressure_cleanse"
    | "rumor_silence"
    | "lawful_mediation"
    | "consensual_dual_cultivation"
    | "gift_lingyu"
    | "treasure_invite"
    | "broker_relief";
  offerTypeLabel: string;
  sourceFaction?: string | null;
  sourceNpcId?: string | null;
  sourceNpcName?: string | null;
  storylineId?: string | null;
  storylineTypeLabel?: string | null;
  storylineStageLabel?: string | null;
  storylineDistrictName?: string | null;
  summary: string;
  detail: string;
  riskLabel: string;
  guideTargetLabel?: string | null;
  guideLocationLabel?: string | null;
  guideActionLabel?: string | null;
  guideSummary?: string | null;
  guideRoute?: string | null;
  guideMapId?: string | null;
  guidePositionX?: number | null;
  guidePositionY?: number | null;
  guideRequiresAccept?: boolean;
  expiresAt: string;
  createdAt: string;
};

type WorldContractData = {
  offerId: string;
  offerType:
    | "black_market_trade"
    | "shadow_intel"
    | "cultivator_hunt"
    | "demonic_temptation"
    | "pressure_cleanse"
    | "rumor_silence"
    | "lawful_mediation"
    | "consensual_dual_cultivation"
    | "gift_lingyu"
    | "treasure_invite"
    | "broker_relief";
  offerTypeLabel: string;
  sourceFaction?: string | null;
  storylineId?: string | null;
  contractType: "meet_contact" | "hunt_target" | "dead_drop_delivery" | "surveil_target" | "escort_cargo" | "treasure_probe";
  contractStatus: "active" | "completed" | "failed";
  title: string;
  summary: string;
  detail: string;
  progressLabel: string;
  actionLabel?: string | null;
  targetNpcId?: string | null;
  targetNpcName?: string | null;
  targetMapId?: string | null;
  targetMapName?: string | null;
  targetDistrictName?: string | null;
  targetPositionX?: number | null;
  targetPositionY?: number | null;
  rewardGold: number;
  rewardLingYu: number;
  canAdvanceByTalking: boolean;
  canAdvanceByObjective: boolean;
  currentObjectivePointId?: string | null;
  currentObjectivePointLabel?: string | null;
  currentObjectivePointType?: "rumor_stela" | "shadow_contact" | "black_market_stall" | "hidden_shrine" | "smuggling_gate" | null;
  currentObjectiveMapId?: string | null;
  currentObjectiveMapName?: string | null;
  currentObjectiveDistrictName?: string | null;
  currentObjectivePositionX?: number | null;
  currentObjectivePositionY?: number | null;
  currentObjectiveActionLabel?: string | null;
  currentObjectiveHint?: string | null;
  objectiveStepStatus?: string | null;
  completedAt?: string | null;
  updatedAt: string;
};

type ReputationRepairGuideEntry =
  | {
    key: string;
    source: "offer";
    title: string;
    summary: string;
    offer: WorldEventOfferData;
  }
  | {
    key: string;
    source: "contract";
    title: string;
    summary: string;
    contract: WorldContractData;
  }
  | {
    key: string;
    source: "fallback";
    title: string;
    summary: string;
  };

type EventGuideCard = {
  targetLabel?: string | null;
  locationLabel?: string | null;
  actionLabel?: string | null;
  summary?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  distance?: number | null;
};

interface PendingAiEventData {
  id: string;
  name: string;
  type: string;
  pendingAi: true;
}

interface EncounterSessionResponseData {
  encounterSession: MapEncounterSessionView;
  stage?: MapEncounterStageView;
  finalEvent?: EventResultData | null;
  sessionStatus: "active" | "completed" | "expired";
}

type TravelTargetCard = MapData["linkedMaps"][number];
type TravelPortalCard = NonNullable<MapData["playerPortal"]>;

function pickMapSceneData(data: MapApiData): MapSceneData {
  return {
    map: data.map,
    player: data.player,
    playerOnPortal: data.playerOnPortal,
    playerPortal: data.playerPortal,
    portals: data.portals,
    npcs: data.npcs,
    monsters: data.monsters,
    otherPlayers: data.otherPlayers,
    opportunities: data.opportunities,
    activeEncounterSession: data.activeEncounterSession,
    sceneTick: data.sceneTick,
    sceneServerTimeMs: data.sceneServerTimeMs,
    sceneSnapshot: data.sceneSnapshot,
  };
}

function pickMapPanelData(
  data: Partial<MapPanelData>,
  fallback?: MapPanelData | null,
): MapPanelData {
  return {
    travelMode: data.travelMode ?? fallback?.travelMode ?? "direct",
    linkedMaps: Array.isArray(data.linkedMaps) ? data.linkedMaps : (fallback?.linkedMaps ?? []),
    secretRealms: Array.isArray(data.secretRealms) ? data.secretRealms : (fallback?.secretRealms ?? []),
    currentSecretRealm: data.currentSecretRealm ?? fallback?.currentSecretRealm ?? null,
    publicAnnouncement: typeof data.publicAnnouncement === "string"
      ? data.publicAnnouncement
      : (fallback?.publicAnnouncement ?? ""),
    worldPressure: data.worldPressure ?? fallback?.worldPressure,
    reputationSummary: data.reputationSummary ?? fallback?.reputationSummary ?? null,
    primaryObjective: data.primaryObjective ?? fallback?.primaryObjective ?? null,
    secondaryHooks: Array.isArray(data.secondaryHooks) ? data.secondaryHooks : (fallback?.secondaryHooks ?? []),
    worldIntelLite: data.worldIntelLite ?? fallback?.worldIntelLite ?? null,
    trackingSignals: Array.isArray(data.trackingSignals) ? data.trackingSignals : (fallback?.trackingSignals ?? []),
    worldObjectivePoints: Array.isArray(data.worldObjectivePoints) ? data.worldObjectivePoints : (fallback?.worldObjectivePoints ?? []),
    districtStates: Array.isArray(data.districtStates) ? data.districtStates : (fallback?.districtStates ?? []),
    activeStorylines: Array.isArray(data.activeStorylines) ? data.activeStorylines : (fallback?.activeStorylines ?? []),
    factionPressureHints: Array.isArray(data.factionPressureHints) ? data.factionPressureHints : (fallback?.factionPressureHints ?? []),
    openWorldExploration: data.openWorldExploration ?? fallback?.openWorldExploration ?? null,
    travelGraphPreview: data.travelGraphPreview ?? fallback?.travelGraphPreview ?? null,
    mapHeatSummary: data.mapHeatSummary ?? fallback?.mapHeatSummary ?? null,
    adultInvites: Array.isArray(data.adultInvites) ? data.adultInvites : (fallback?.adultInvites ?? []),
    adultDangerHints: Array.isArray(data.adultDangerHints) ? data.adultDangerHints : (fallback?.adultDangerHints ?? []),
    pendingAssassination: data.pendingAssassination ?? fallback?.pendingAssassination ?? null,
    pvp: data.pvp ?? fallback?.pvp,
  };
}

function getEncounterLoadingText(eventType?: string, stage: "initial" | "resolving" = "initial") {
  if (eventType === "opportunity") {
    return stage === "initial" ? "正在感应机缘" : "正在生成机缘";
  }
  return stage === "initial" ? "正在感应奇遇" : "正在推演奇遇";
}

type NearbyPlayerProfile = PlayerProfileContentModel & {
  gender?: string | null;
};

function isPendingAiEventData(event: EventResultData | PendingAiEventData): event is PendingAiEventData {
  return "pendingAi" in event && event.pendingAi === true;
}

function inviteSupportsResponse(
  invite: Pick<NonNullable<MapData["adultInvites"]>[number], "responseOptions">,
  label: string,
) {
  return Array.isArray(invite.responseOptions) && invite.responseOptions.includes(label);
}

const adultInviteChipStyle: CSSProperties = {
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  lineHeight: 1.45,
  paddingInline: 8,
  paddingBlock: 2,
};

const scrollableTextStyle: CSSProperties = {
  paddingRight: 4,
  paddingBottom: 6,
  maxHeight: "min(52vh, 420px)",
};

const touchFriendlyScrollableCardStyle: CSSProperties = {
  touchAction: "pan-y",
  WebkitUserSelect: "none",
  userSelect: "none",
  pointerEvents: "auto",
};

const intelTextBlockStyle: CSSProperties = {
  display: "block",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  lineHeight: 1.58,
};

const intelBodyTextStyle: CSSProperties = {
  ...intelTextBlockStyle,
  fontSize: 12,
};

const intelMutedTextStyle: CSSProperties = {
  ...intelTextBlockStyle,
  fontSize: 11,
};

const intelTinyTextStyle: CSSProperties = {
  ...intelTextBlockStyle,
  fontSize: 10,
};

const invitePreviewTextStyle: CSSProperties = {
  ...intelMutedTextStyle,
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
};

const sceneToolButtonStyle = {
  color: "#b8c5e6",
  borderColor: "rgba(69, 85, 128, 0.72)",
  background: "linear-gradient(180deg, rgba(24, 31, 51, 0.96), rgba(12, 17, 30, 0.96))",
  width: 24,
  height: 24,
  padding: 0,
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 6px 12px rgba(4, 7, 16, 0.16)",
} as const;

const sceneViewportCardStyle = {
  padding: 4,
  background: "linear-gradient(180deg, rgba(14, 18, 31, 0.94), rgba(8, 11, 21, 0.96))",
  borderRadius: 10,
  border: "1px solid rgba(46, 57, 88, 0.92)",
  boxShadow: "inset 0 1px 0 rgba(214, 223, 255, 0.06), inset 0 0 0 1px rgba(104, 118, 160, 0.12), 0 10px 24px rgba(4, 7, 16, 0.14)",
} as const;

const sceneSlimSectionStyle = {
  marginTop: 6,
  padding: "7px 8px",
  background: "linear-gradient(180deg, rgba(18, 23, 38, 0.94), rgba(10, 13, 24, 0.92))",
  borderRadius: 12,
  border: "1px solid rgba(64, 76, 110, 0.72)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
} as const;

const WORLD_INTEL_PREVIEW_LIMITS = {
  adultInvites: 1,
  adultDangerHints: 1,
  objectivePoints: 3,
  districtStates: 2,
  storylines: 2,
  factionHints: 2,
  travelConnections: 2,
  rumorHooks: 2,
  encounterHooks: 2,
  secretRealmHooks: 2,
  trackingSignals: 1,
  worldEventOffers: 1,
  worldContracts: 2,
};


function buildEncounterModalData(payload: EncounterSessionResponseData | null | undefined): EventModalData | null {
  if (!payload?.encounterSession) {
    return null;
  }
  if (payload.sessionStatus === "active" && payload.stage) {
    return {
      mode: "encounter-stage",
      encounterSession: payload.encounterSession,
      stage: payload.stage,
    };
  }
  if (payload.sessionStatus === "completed" && payload.finalEvent) {
    return payload.finalEvent;
  }
  if (payload.sessionStatus === "expired") {
    return {
      name: payload.encounterSession.eventName,
      type: payload.encounterSession.eventType,
      narrative: "奇遇已散，余波尽去，这段机缘不会再补发奖赏。",
      imageUrl: null,
      rewards: null,
    };
  }
  return null;
}

function isEncounterStageModalData(event: EventModalData | null): event is Extract<EventModalData, { mode: "encounter-stage" }> {
  return Boolean(event && "mode" in event && event.mode === "encounter-stage");
}

function calcMonsterCombatPower(stats: {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}) {
  return stats.hp
    + stats.attack * 20
    + stats.defense * 15
    + stats.speed * 120;
}

function calcChebyshevDistance(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function resolveEventGuideDistance(
  playerX: number,
  playerY: number,
  positionX: number | null | undefined,
  positionY: number | null | undefined,
) {
  if (typeof positionX !== "number" || typeof positionY !== "number") {
    return null;
  }
  return calcChebyshevDistance(playerX, playerY, positionX, positionY);
}

function hasEventGuideCard(guide: EventGuideCard | null | undefined) {
  return Boolean(
    guide
    && (
      guide.targetLabel
      || guide.locationLabel
      || guide.actionLabel
      || guide.summary
      || (typeof guide.positionX === "number" && typeof guide.positionY === "number")
      || typeof guide.distance === "number"
    )
  );
}

function resolveWorldContractTypeShortLabel(contractType: WorldContractData["contractType"]) {
  switch (contractType) {
    case "meet_contact":
      return "接头";
    case "hunt_target":
      return "猎修";
    case "dead_drop_delivery":
      return "藏物";
    case "surveil_target":
      return "监听";
    case "treasure_probe":
      return "探宝";
    default:
      return "黑货";
  }
}

function resolveWorldContractStepLabel(contract: WorldContractData) {
  if (contract.contractType === "escort_cargo") {
    return contract.objectiveStepStatus === "to_destination" ? "运货中" : "取货中";
  }
  if (contract.contractType === "dead_drop_delivery") {
    return "藏物中";
  }
  if (contract.contractType === "surveil_target") {
    return "监听中";
  }
  if (contract.contractType === "treasure_probe") {
    return "探宝中";
  }
  if (contract.contractType === "hunt_target") {
    return "追猎中";
  }
  return "接线中";
}

function isReputationRepairOfferType(
  offerType: WorldEventOfferData["offerType"] | WorldContractData["offerType"],
) {
  return offerType === "broker_relief"
    || offerType === "gift_lingyu"
    || offerType === "treasure_invite"
    || offerType === "consensual_dual_cultivation";
}

function resolveDistrictDangerColor(label: string) {
  if (label === "杀机四伏") {
    return "red";
  }
  if (label === "暗潮翻涌") {
    return "gold";
  }
  return "blue";
}

function resolveStorylineStatusLabel(status: string) {
  if (status === "completed") {
    return "已收束";
  }
  if (status === "failed") {
    return "已断裂";
  }
  return "推进中";
}

function resolveHeatTierTagColor(heatTier: "hot" | "warm" | "cold") {
  if (heatTier === "hot") {
    return "red";
  }
  if (heatTier === "warm") {
    return "gold";
  }
  return "blue";
}

function resolveTravelTypeLabel(travelType: "portal" | "road" | "rift") {
  if (travelType === "portal") {
    return "定向传送阵";
  }
  if (travelType === "rift") {
    return "秘境裂隙";
  }
  return "驿路/货道";
}

function formatDropChance(chance: number) {
  return `${(chance * 100).toFixed(2)}%`;
}

function getSecretRealmIntelTextColor(rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng") {
  switch (rarity) {
    case "hongmeng":
      return "#ff8fc7";
    case "legendary":
      return "#f3c86d";
    case "epic":
      return "#d4a7ff";
    case "rare":
      return "#8cc8ff";
    case "uncommon":
      return "#9fd98b";
    default:
      return "#d7ccb2";
  }
}

function renderSecretRealmDropIntelPreview(dropIntelPreview?: Array<{
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
  rarityLabel: string;
  chanceText: string;
  quantityText: string;
}>): ReactNode {
  if (!Array.isArray(dropIntelPreview) || dropIntelPreview.length < 1) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      <Text style={{ color: "#d8c6a1", fontSize: 12 }}>
        Boss 掉落预览
      </Text>
      {dropIntelPreview.map((entry, index) => (
        <Text key={`${entry.label}-${index}`} style={{ color: getSecretRealmIntelTextColor(entry.rarity), fontSize: 12 }}>
          {entry.chanceText} · {entry.label} · 数量 {entry.quantityText}
        </Text>
      ))}
      <Text style={{ color: "#8e856f", fontSize: 12 }}>
        Boss 主要掉上品、极品，偶有仙品，并有极低概率自然掉落鸿蒙灵材。
      </Text>
    </div>
  );
}

function getSecretRealmRecommendedRealmText(secretRealm: {
  recommendedRealm: number;
  recommendedRealmName?: string;
}) {
  return secretRealm.recommendedRealmName?.trim() || `境界 ${secretRealm.recommendedRealm}`;
}

function buildSecretRealmBossGateMessage(bossGateStatus?: {
  isUnlocked: boolean;
  guardRequired: number;
  guardDefeated: number;
  totalNonBossMonsterCount?: number;
  clearRequired: number;
  clearDefeated: number;
  remainingGuardCount: number;
  remainingClearCount: number;
} | null) {
  if (!bossGateStatus || bossGateStatus.isUnlocked) {
    return "";
  }
  const totalNonBossMonsterCount = Math.max(0, Number(bossGateStatus.totalNonBossMonsterCount || 0));
  const remainingNonBossMonsterCount = Math.max(0, totalNonBossMonsterCount - bossGateStatus.clearDefeated);
  return `Boss 封印未破，还需击败 ${bossGateStatus.remainingGuardCount} 个守卫，或再击败 ${bossGateStatus.remainingClearCount} 只怪物，使剩余怪物降到半数以下。当前守卫 ${bossGateStatus.guardDefeated}/${bossGateStatus.guardRequired}，已击败怪物 ${bossGateStatus.clearDefeated}/${bossGateStatus.clearRequired}，剩余怪物 ${remainingNonBossMonsterCount}。`;
}

function isPortalTileAtPosition(params: {
  tiles: Array<{ x: number; y: number; type: string; walkable?: boolean }>;
  x: number;
  y: number;
}) {
  return params.tiles.some((tile) => (
    tile.x === params.x
    && tile.y === params.y
    && tile.type === "portal"
    && tile.walkable !== false
  ));
}

function findPortalAtPosition(data: Pick<MapData, "player" | "portals"> | null): TravelPortalCard | null {
  if (!data) {
    return null;
  }

  const matchedPortal = data.portals.find((portal) => (
    portal.x === data.player.positionX
    && portal.y === data.player.positionY
  ));

  if (!matchedPortal) {
    return null;
  }

  return {
    x: matchedPortal.x,
    y: matchedPortal.y,
    portalId: matchedPortal.portalId,
    portalName: matchedPortal.portalName,
    targetMapId: matchedPortal.targetMapId,
    targetMapName: matchedPortal.targetMapName,
    targetPortalId: matchedPortal.targetPortalId,
    imageUrl: matchedPortal.imageUrl,
  };
}

function resolveLiveTravelTarget(params: {
  target: TravelTargetCard;
  playerRealm: number;
  travelMode: MapData["travelMode"];
  currentPortal: TravelPortalCard | null;
}): TravelTargetCard {
  const { target, playerRealm, travelMode, currentPortal } = params;
  const currentPortalTargetMapId = String(currentPortal?.targetMapId || "").trim();
  const usingExplicitPortalTarget = currentPortalTargetMapId.length > 0;
  const presetDisabledReason = String(target.disabledReason || "").trim();
  const keepServerDisabledReason = presetDisabledReason.startsWith("队伍未全员达 ");
  const matchesCurrentPortal = Boolean(currentPortal && (
    (target.fromPortalId && currentPortal.portalId && target.fromPortalId === currentPortal.portalId)
    || currentPortalTargetMapId === target.id
  ));

  let disabledReason: string | null = keepServerDisabledReason ? presetDisabledReason : null;
  if (!disabledReason && playerRealm < target.minRealmValue) {
    disabledReason = `需境界 ${target.minRealm}`;
  } else if (!disabledReason && travelMode === "portal") {
    if (!currentPortal) {
      disabledReason = `需先站上 ${target.fromPortalName || "传送阵"}`;
    } else if (usingExplicitPortalTarget && !matchesCurrentPortal) {
      disabledReason = `需切换至 ${target.fromPortalName || "对应传送阵"}`;
    }
  }

  return {
    ...target,
    available: disabledReason === null,
    disabledReason,
    currentPortalMatched: usingExplicitPortalTarget ? matchesCurrentPortal : false,
  };
}

function getCompactTravelStatus(target: TravelTargetCard, moving: boolean) {
  if (moving && target.available) {
    return "传送中";
  }

  const rawText = String(target.disabledReason || "").trim();
  if (!rawText) {
    return target.currentPortalMatched ? "当前可传" : "可前往";
  }
  if (rawText.startsWith("需境界 ")) {
    return rawText.replace("需境界 ", "需");
  }
  if (rawText.startsWith("需先站上 ")) {
    return rawText.replace("需先站上 ", "上");
  }
  if (rawText.startsWith("需切换至 ")) {
    return rawText.replace("需切换至 ", "切到");
  }
  if (rawText.startsWith("队伍未全员达 ")) {
    return "队伍未达";
  }
  if (rawText === "当前地图未配置对应传送阵") {
    return "未配阵点";
  }
  if (rawText === "当前传送阵未配置可达地图") {
    return "阵点未连";
  }

  return rawText.replace("对应传送阵", "对应阵");
}

function getTravelActionLabel(target: TravelTargetCard, moving: boolean) {
  if (moving && target.available) {
    return "传送";
  }
  return target.available ? "前往" : "未达";
}

function normalizeViewSize(value: number, minViewSize = MIN_VIEW_SIZE, maxViewSize = MAX_VIEW_SIZE) {
  if (!Number.isFinite(value)) {
    return minViewSize;
  }

  const snapped = Math.round(value / VIEW_SIZE_STEP) * VIEW_SIZE_STEP;
  const centeredMinViewSize = normalizeCenteredMapViewSize(minViewSize);
  const centeredMaxViewSize = normalizeCenteredMapViewSize(maxViewSize);
  const centeredSnapped = normalizeCenteredMapViewSize(snapped);

  return Math.max(centeredMinViewSize, Math.min(centeredMaxViewSize, centeredSnapped));
}

function readPersistedViewSize() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(MAP_VIEW_SIZE_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsedValue = Number.parseInt(rawValue, 10);
    if (Number.isNaN(parsedValue)) {
      return null;
    }

    return normalizeViewSize(parsedValue);
  } catch {
    return null;
  }
}

function persistViewSize(viewSize: number) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(MAP_VIEW_SIZE_STORAGE_KEY, String(normalizeViewSize(viewSize)));
  } catch {
    // 本地存储不可用时忽略，继续使用当前视图大小。
  }
}

function normalizeRoutePath(path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "/";
  }

  return trimmedPath.length > 1 ? trimmedPath.replace(/\/+$/, "") : trimmedPath;
}

function readInvalidBossEncounterRedirectGuard(): {
  encounterId: string;
  routePath: string;
  expiresAt: number;
} | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as {
      encounterId?: unknown;
      routePath?: unknown;
      expiresAt?: unknown;
    };
    const encounterId = typeof parsed.encounterId === "string" ? parsed.encounterId.trim() : "";
    const routePath = typeof parsed.routePath === "string" ? normalizeRoutePath(parsed.routePath) : "";
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
    if (!encounterId || !routePath || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY);
      return null;
    }

    return {
      encounterId,
      routePath,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function clearInvalidBossEncounterRedirectGuard() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY);
  } catch {
    // sessionStorage 不可用时忽略。
  }
}

function buildSceneSnapshotFromMapData(
  nextData: MapSceneData,
  options?: {
    previousSnapshot?: MapSceneSnapshot | null;
    sequence?: number;
    tick?: number;
    serverTimeMs?: number;
    preferEmbeddedSnapshot?: boolean;
  },
) {
  const previousSnapshot = options?.previousSnapshot ?? null;
  const preferEmbeddedSnapshot = options?.preferEmbeddedSnapshot !== false;
  if (
    preferEmbeddedSnapshot
    && nextData.sceneSnapshot
    && typeof options?.sequence !== "number"
    && typeof options?.tick !== "number"
  ) {
    return nextData.sceneSnapshot;
  }

  const previousSequence = previousSnapshot?.sequence ?? 0;
  const previousTick = previousSnapshot?.tick ?? 0;
  const embeddedSequence = nextData.sceneSnapshot?.sequence ?? nextData.sceneTick ?? 0;
  const embeddedTick = nextData.sceneSnapshot?.tick ?? nextData.sceneTick ?? 0;
  const nextSequence = typeof options?.sequence === "number"
    ? options.sequence
    : Math.max(previousSequence + 1, embeddedSequence, 1);
  const nextTick = typeof options?.tick === "number"
    ? options.tick
    : Math.max(previousTick + 1, embeddedTick, nextSequence, 1);
  const serverTimeMs = options?.serverTimeMs
    ?? nextData.sceneSnapshot?.serverTimeMs
    ?? nextData.sceneServerTimeMs
    ?? Date.now();

  return createMapSceneSnapshot({
    state: buildMapSceneStateFromMapData({
      mapId: nextData.map.id,
      player: {
        id: nextData.player.id,
        name: nextData.player.name || "",
        gender: nextData.player.gender,
        avatarImageUrl: nextData.player.avatarImageUrl,
        avatarFrameImageUrl: nextData.player.avatarFrameImageUrl,
        realm: nextData.player.realm,
        realmMajor: nextData.player.realmMajor,
        realmMinor: nextData.player.realmMinor,
        realmName: nextData.player.realmName || "未知境界",
        positionX: nextData.player.positionX,
        positionY: nextData.player.positionY,
      },
      otherPlayers: nextData.otherPlayers,
      npcs: nextData.npcs,
      monsters: nextData.monsters,
      opportunities: nextData.opportunities,
    }),
    sequence: nextSequence,
    tick: nextTick,
    serverTimeMs,
    previousSnapshot,
  });
}

function normalizeWorldMapAoiEntityId(entityId: string, prefix: string) {
  return entityId.startsWith(prefix) ? entityId.slice(prefix.length) : entityId;
}

function isFiniteWorldMapAoiPosition(entity: { x: number; y: number }) {
  return Number.isFinite(entity.x) && Number.isFinite(entity.y);
}

function isInteractiveWorldMapAoiEntity(kind: string) {
  return kind === "opportunity"
    || kind === "limited_opportunity"
    || kind === "world_commission"
    || kind === "reputation_event"
    || kind === "sect_activity"
    || kind === "event_portal"
    || kind === "secret_realm"
    || kind === "portal"
    || kind === "sect_home"
    || kind === "temporary_blocker"
    || kind === "sealed_area";
}

function buildMapSceneDataWithColyseusAoi(params: {
  data: MapSceneData;
  aoi: Pick<
    WorldMapColyseusAoiSnapshot,
    "status" | "mapId" | "serverTick" | "snapshotVersion" | "subscribedSectorKeys" | "entities"
  >;
  previousSnapshot?: MapSceneSnapshot | null;
}) {
  const { data, aoi } = params;
  if (
    aoi.status !== "connected"
    || !aoi.mapId
    || aoi.mapId !== data.map.id
    || aoi.entities.length === 0
  ) {
    return null;
  }

  const playerEntities = aoi.entities.filter((entity) => (
    entity.kind === "player"
    && entity.id !== data.player.id
    && isFiniteWorldMapAoiPosition(entity)
  ));
  const npcPositionById = new Map(
    aoi.entities
      .filter((entity) => entity.kind === "npc" && isFiniteWorldMapAoiPosition(entity))
      .map((entity) => [normalizeWorldMapAoiEntityId(entity.id, "npc:"), entity] as const),
  );
  const monsterPositionById = new Map(
    aoi.entities
      .filter((entity) => entity.kind === "monster" && isFiniteWorldMapAoiPosition(entity))
      .map((entity) => [normalizeWorldMapAoiEntityId(entity.id, "monster:"), entity] as const),
  );
  const opportunityPositionById = new Map(
    aoi.entities
      .filter((entity) => entity.kind === "opportunity" && isFiniteWorldMapAoiPosition(entity))
      .map((entity) => [normalizeWorldMapAoiEntityId(entity.id, "opportunity:"), entity] as const),
  );
  const existingPlayerById = new Map(data.otherPlayers.map((player) => [player.id, player] as const));

  const nextData: MapSceneData = {
    ...data,
    otherPlayers: playerEntities.map((entity) => {
      const previous = existingPlayerById.get(entity.id);
      return {
        id: entity.id,
        name: previous?.name || entity.name || "道友",
        gender: previous?.gender,
        avatarImageUrl: previous?.avatarImageUrl,
        avatarFrameImageUrl: previous?.avatarFrameImageUrl,
        realm: previous?.realm ?? 0,
        realmMajor: previous?.realmMajor,
        realmMinor: previous?.realmMinor,
        realmName: previous?.realmName || "未知境界",
        positionX: entity.x,
        positionY: entity.y,
      };
    }),
    npcs: npcPositionById.size > 0
      ? data.npcs
        .filter((npc) => npcPositionById.has(npc.id))
        .map((npc) => {
          const entity = npcPositionById.get(npc.id);
          return entity ? {
            ...npc,
            name: npc.name || entity.name,
            positionX: entity.x,
            positionY: entity.y,
          } : npc;
        })
      : data.npcs,
    monsters: monsterPositionById.size > 0
      ? data.monsters
        .filter((monster) => monsterPositionById.has(monster.id))
        .map((monster) => {
          const entity = monsterPositionById.get(monster.id);
          return entity ? {
            ...monster,
            name: monster.name || entity.name,
            positionX: entity.x,
            positionY: entity.y,
          } : monster;
        })
      : data.monsters,
    opportunities: opportunityPositionById.size > 0
      ? data.opportunities
        .filter((opportunity) => opportunityPositionById.has(opportunity.spawnId))
        .map((opportunity) => {
          const entity = opportunityPositionById.get(opportunity.spawnId);
          return entity ? {
            ...opportunity,
            name: opportunity.name || entity.name,
            positionX: entity.x,
            positionY: entity.y,
          } : opportunity;
        })
      : data.opportunities,
  };

  const previousSnapshot = params.previousSnapshot?.mapId === data.map.id
    ? params.previousSnapshot
    : null;
  const nextSequence = Math.max(
    previousSnapshot?.sequence ?? 0,
    data.sceneSnapshot?.sequence ?? 0,
    aoi.snapshotVersion,
    aoi.serverTick,
    0,
  ) + 1;
  const nextTick = Math.max(
    previousSnapshot?.tick ?? 0,
    data.sceneSnapshot?.tick ?? 0,
    aoi.serverTick,
    nextSequence,
  );
  const nextSnapshot = buildSceneSnapshotFromMapData(nextData, {
    previousSnapshot,
    sequence: nextSequence,
    tick: nextTick,
    serverTimeMs: Date.now(),
    preferEmbeddedSnapshot: false,
  }) as MapSceneSnapshot;

  nextSnapshot.mode = "sector_snapshot";
  nextSnapshot.subscribedSectorKeys = [...aoi.subscribedSectorKeys];

  return {
    ...nextData,
    sceneTick: nextSnapshot.tick,
    sceneServerTimeMs: nextSnapshot.serverTimeMs,
    sceneSnapshot: nextSnapshot,
  } satisfies MapSceneData;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildQueuedMapMovePath(
  currentData: MapSceneData,
  from: { x: number; y: number },
  target: { x: number; y: number },
) {
  const mapWidth = currentData.map.width;
  const mapHeight = currentData.map.height;
  const tileMap = new Map(
    currentData.map.tilesData.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  );
  const startKey = `${from.x},${from.y}`;
  const targetKey = `${target.x},${target.y}`;
  const targetDistance = Math.max(Math.abs(target.x - from.x), Math.abs(target.y - from.y));
  const searchMinX = Math.max(0, from.x - MAX_QUEUED_MAP_MOVE_DISTANCE);
  const searchMaxX = Math.min(mapWidth - 1, from.x + MAX_QUEUED_MAP_MOVE_DISTANCE);
  const searchMinY = Math.max(0, from.y - MAX_QUEUED_MAP_MOVE_DISTANCE);
  const searchMaxY = Math.min(mapHeight - 1, from.y + MAX_QUEUED_MAP_MOVE_DISTANCE);

  const isWalkable = (x: number, y: number) => {
    if (
      x < 0
      || x >= mapWidth
      || y < 0
      || y >= mapHeight
      || x < searchMinX
      || x > searchMaxX
      || y < searchMinY
      || y > searchMaxY
    ) {
      return false;
    }
    const tile = tileMap.get(`${x},${y}`);
    return tile?.walkable ?? true;
  };

  if (targetDistance > MAX_QUEUED_MAP_MOVE_DISTANCE || !isWalkable(target.x, target.y)) {
    return [] as Array<{ x: number; y: number }>;
  }

  const directions = [
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  const heuristic = (x: number, y: number) => Math.max(Math.abs(target.x - x), Math.abs(target.y - y));
  const frontier = [{ x: from.x, y: from.y, cost: 0, score: heuristic(from.x, from.y) }];
  const bestCost = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const searchWindowSize = (searchMaxX - searchMinX + 1) * (searchMaxY - searchMinY + 1);
  const maxIterations = Math.max(64, searchWindowSize * 2);
  let iterations = 0;

  while (frontier.length > 0 && iterations < maxIterations) {
    iterations += 1;
    frontier.sort((left, right) => left.score - right.score);
    const current = frontier.shift();
    if (!current) {
      break;
    }
    const currentKey = `${current.x},${current.y}`;
    if (currentKey === targetKey) {
      const path: Array<{ x: number; y: number }> = [];
      let traceKey = targetKey;
      while (traceKey !== startKey) {
        const [traceX, traceY] = traceKey.split(",").map((value) => Number(value));
        path.push({ x: traceX, y: traceY });
        const previousKey = previous.get(traceKey);
        if (!previousKey) {
          return [];
        }
        traceKey = previousKey;
      }
      const normalizedPath = path.reverse();
      return normalizedPath.length > MAX_QUEUED_MAP_MOVE_DISTANCE ? [] : normalizedPath;
    }

    for (const direction of directions) {
      const nextX = current.x + direction.x;
      const nextY = current.y + direction.y;
      const nextKey = `${nextX},${nextY}`;
      if (!isWalkable(nextX, nextY)) {
        continue;
      }
      if (Math.abs(direction.x) === 1 && Math.abs(direction.y) === 1) {
        if (!isWalkable(current.x + direction.x, current.y) || !isWalkable(current.x, current.y + direction.y)) {
          continue;
        }
      }

      const nextCost = current.cost + (Math.abs(direction.x) === 1 && Math.abs(direction.y) === 1 ? 1.4 : 1);
      const knownCost = bestCost.get(nextKey);
      if (typeof knownCost === "number" && knownCost <= nextCost) {
        continue;
      }

      bestCost.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      frontier.push({
        x: nextX,
        y: nextY,
        cost: nextCost,
        score: nextCost + heuristic(nextX, nextY),
      });
    }
  }

  return [] as Array<{ x: number; y: number }>;
}

function filterVisibleMapData(nextData: MapSceneData): MapSceneData {
  const origin = {
    positionX: nextData.player.positionX,
    positionY: nextData.player.positionY,
  };
  const spiritualSense = nextData.player.spiritualSense ?? 0;

  return {
    ...nextData,
    npcs: filterMapPositionsByFogLevel({
      origin,
      list: nextData.npcs,
      spiritualSense,
      visibleLevels: ["clear", "shallow"],
    }),
    monsters: filterMapPositionsByFogLevel({
      origin,
      list: nextData.monsters,
      spiritualSense,
      visibleLevels: ["clear", "shallow"],
    }),
    otherPlayers: filterMapPositionsByFogLevel({
      origin,
      list: nextData.otherPlayers,
      spiritualSense,
      visibleLevels: ["clear"],
    }),
    opportunities: filterMapPositionsByFogLevel({
      origin,
      list: nextData.opportunities,
      spiritualSense,
      visibleLevels: ["clear"],
    }),
  };
}

type MapSceneHeaderProps = {
  mapName: string;
  mapType: string;
  pvpEnabledOnCurrentMap: boolean;
  hasCurrentSecretRealm: boolean;
  visibleAnnouncementText: string;
  isTemporaryAnnouncementActive: boolean;
  temporaryAnnouncementId: string | null;
  isCompactViewport: boolean;
  hasSecretRealmIntel: boolean;
  hasSecretRealmAttentionDot: boolean;
  logoutLoading: boolean;
  onOpenViewSettings(): void;
  onOpenSecretRealmIntel(): void;
  onRefreshMap(): void;
  onLogout(): void;
};

const MapSceneHeader = memo(function MapSceneHeader({
  mapName,
  mapType,
  pvpEnabledOnCurrentMap,
  hasCurrentSecretRealm,
  visibleAnnouncementText,
  isTemporaryAnnouncementActive,
  temporaryAnnouncementId,
  isCompactViewport,
  hasSecretRealmIntel,
  hasSecretRealmAttentionDot,
  logoutLoading,
  onOpenViewSettings,
  onOpenSecretRealmIntel,
  onRefreshMap,
  onLogout,
}: MapSceneHeaderProps) {
  const announcementToneClassName = isTemporaryAnnouncementActive
    ? "map-topbar__announcement map-topbar__announcement--temporary"
    : "map-topbar__announcement map-topbar__announcement--world";
  const actionButtonClassName = "map-topbar__actionButton map-topbar__actionButton--compact";
  const canOpenSecretRealmIntel = hasSecretRealmIntel;

  return (
    <>
      <div className={`map-topbar${isCompactViewport ? " map-topbar--compactViewport" : ""}`}>
        <div className="map-topbar__main">
          <div className="map-topbar__titleShell">
            <div className="map-topbar__titleIcon" aria-hidden="true">
              <EnvironmentOutlined />
            </div>
            <div className="map-topbar__titleContent">
              <Text className="map-topbar__eyebrow">当前所在</Text>
              <Text className="map-topbar__name">{mapName}</Text>
            </div>
          </div>
          <div className="map-topbar__meta">
            <DarkTag color={mapType === "city" ? "gold" : "green"}>
              {MAP_TYPE_NAMES[mapType] || "未知地图类型"}
            </DarkTag>
            <DarkTag color={pvpEnabledOnCurrentMap ? "red" : "blue"}>
              {pvpEnabledOnCurrentMap ? "可PVP" : "禁PVP"}
            </DarkTag>
            {hasCurrentSecretRealm ? (
              <span className="map-topbar__statusChip map-topbar__statusChip--realm">秘境波动</span>
            ) : (
              <span className="map-topbar__statusChip">灵脉平稳</span>
            )}
          </div>
        </div>
        <div className="map-topbar__actions">
          <Button
            size="small"
            onClick={onOpenViewSettings}
            className={actionButtonClassName}
            title="打开视野设置"
          >
            <span className="map-topbar__actionText">视野</span>
          </Button>
          <Button
            size="small"
            onClick={canOpenSecretRealmIntel ? onOpenSecretRealmIntel : undefined}
            disabled={!canOpenSecretRealmIntel}
            className={`${actionButtonClassName} map-topbar__actionButton--realm${hasCurrentSecretRealm ? " is-active" : ""}`}
            title={canOpenSecretRealmIntel ? "打开秘境情报" : "当前暂无秘境情报"}
          >
            <span className="map-topbar__actionLabel">秘境</span>
            {hasSecretRealmAttentionDot ? <span className="map-topbar__attentionDot" /> : null}
          </Button>
          <Button
            size="small"
            onClick={onRefreshMap}
            className={actionButtonClassName}
            title="刷新地图"
          >
            <ReloadOutlined />
            <span className="map-topbar__actionText">刷新</span>
          </Button>
          <Button
            size="small"
            loading={logoutLoading}
            onClick={onLogout}
            className={`${actionButtonClassName} map-topbar__actionButton--danger`}
            title="离开地图"
          >
            <LogoutOutlined />
            <span className="map-topbar__actionText">退出</span>
          </Button>
        </div>
      </div>

      {visibleAnnouncementText ? (
        <div className={`${announcementToneClassName}${isCompactViewport ? " map-topbar__announcement--compact" : ""}`}>
          <div className="map-topbar__announcementGlow" aria-hidden="true" />
          <div className="map-topbar__announcementInner">
            <div className="map-topbar__announcementTrack">
              {isTemporaryAnnouncementActive ? (
                <div
                  key={temporaryAnnouncementId || (isCompactViewport ? "temporary-announcement-mobile" : "temporary-announcement")}
                  className="hongmeng-announcement-marquee map-topbar__announcementMarquee"
                >
                  公告：{visibleAnnouncementText}
                </div>
              ) : (
                <Text className="map-topbar__announcementText">
                  公告：{visibleAnnouncementText}
                </Text>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <style jsx>{`
        .map-topbar {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(132px, 164px);
          align-items: stretch;
          gap: 10px;
          margin-bottom: 8px;
          padding: 10px 11px;
          background:
            radial-gradient(circle at top center, rgba(201, 168, 76, 0.14), transparent 34%),
            linear-gradient(180deg, rgba(27, 32, 45, 0.96), rgba(14, 17, 26, 0.98));
          border-radius: 16px;
          border: 1px solid rgba(118, 135, 160, 0.2);
          box-shadow:
            inset 0 1px 0 rgba(240, 248, 255, 0.05),
            0 12px 24px rgba(0, 0, 0, 0.24);
          overflow: hidden;
        }

        .map-topbar__main {
          position: relative;
          z-index: 1;
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
          gap: 7px;
          padding: 10px 11px;
          border-radius: 14px;
          border: 1px solid rgba(64, 76, 110, 0.78);
          background:
            linear-gradient(180deg, rgba(21, 26, 42, 0.96), rgba(11, 15, 27, 0.94));
          box-shadow:
            inset 0 1px 0 rgba(240, 248, 255, 0.05),
            0 8px 18px rgba(4, 7, 16, 0.16);
        }

        .map-topbar__titleShell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .map-topbar__titleIcon {
          flex: 0 0 auto;
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #e8d282;
          font-size: 16px;
          background:
            linear-gradient(180deg, rgba(78, 64, 31, 0.88), rgba(32, 24, 13, 0.92));
          border: 1px solid rgba(202, 168, 76, 0.48);
          box-shadow:
            inset 0 1px 0 rgba(255, 235, 184, 0.18),
            0 6px 14px rgba(14, 10, 4, 0.26);
        }

        .map-topbar__titleContent {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .map-topbar__eyebrow {
          color: rgba(186, 195, 224, 0.72);
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .map-topbar__meta {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: flex-end;
          align-content: flex-start;
          min-width: 0;
          gap: 6px;
        }

        .map-topbar__meta :global(.ant-tag) {
          border-radius: 999px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .map-topbar__actions {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          align-content: center;
          padding: 8px;
          border-radius: 14px;
          border: 1px solid rgba(64, 76, 110, 0.72);
          background:
            linear-gradient(180deg, rgba(18, 23, 38, 0.94), rgba(10, 13, 24, 0.92));
          box-shadow:
            inset 0 1px 0 rgba(240, 248, 255, 0.04),
            0 8px 18px rgba(4, 7, 16, 0.14);
        }

        .map-topbar__name {
          color: #e8d282;
          font-weight: 700;
          font-size: 16px;
          line-height: 1.1;
          max-width: min(46vw, 300px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-shadow: 0 1px 12px rgba(232, 210, 130, 0.22);
        }

        .map-topbar__statusChip {
          display: inline-flex;
          align-items: center;
          height: 23px;
          padding: 0 10px;
          border-radius: 999px;
          color: #cdd8ff;
          font-size: 11px;
          line-height: 1;
          background: rgba(20, 28, 52, 0.92);
          border: 1px solid rgba(76, 98, 158, 0.62);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        .map-topbar__statusChip--realm {
          color: #f4dd9a;
          background: rgba(54, 42, 15, 0.92);
          border-color: rgba(153, 125, 54, 0.72);
        }

        .map-topbar__actions :global(.map-topbar__actionButton) {
          position: relative;
          width: 100%;
          min-width: 0;
          min-height: 34px;
          height: 34px;
          padding: 0 10px;
          border-radius: 12px;
          color: #d8d7ca;
          border-color: rgba(59, 70, 100, 0.86);
          background:
            linear-gradient(180deg, rgba(23, 29, 46, 0.96), rgba(13, 16, 27, 0.96));
          box-shadow:
            inset 0 1px 0 rgba(240, 248, 255, 0.05),
            0 8px 18px rgba(7, 9, 18, 0.22);
          transition:
            transform 0.18s ease,
            border-color 0.18s ease,
            color 0.18s ease,
            box-shadow 0.18s ease,
            background 0.18s ease;
        }

        .map-topbar__actions :global(.map-topbar__actionButton:hover),
        .map-topbar__actions :global(.map-topbar__actionButton:focus) {
          color: #f2e0a8;
          border-color: rgba(152, 126, 61, 0.88);
          background:
            linear-gradient(180deg, rgba(43, 36, 25, 0.96), rgba(21, 18, 17, 0.96));
          box-shadow:
            inset 0 1px 0 rgba(255, 240, 204, 0.16),
            0 8px 18px rgba(11, 10, 8, 0.32);
          transform: translateY(-1px);
        }

        .map-topbar__actions :global(.map-topbar__actionButton--compact) {
          padding: 0 10px;
          font-size: 12px;
        }

        .map-topbar__actions :global(.map-topbar__actionButton--realm) {
          color: #d2dcff;
          border-color: rgba(71, 89, 145, 0.84);
          background:
            linear-gradient(180deg, rgba(24, 35, 62, 0.96), rgba(14, 20, 36, 0.96));
        }

        .map-topbar__actions :global(.map-topbar__actionButton--realm.is-active) {
          color: #f2dc97;
          border-color: rgba(172, 138, 61, 0.82);
          background:
            linear-gradient(180deg, rgba(67, 53, 19, 0.98), rgba(33, 26, 13, 0.98));
          box-shadow:
            inset 0 1px 0 rgba(255, 240, 205, 0.22),
            0 8px 18px rgba(32, 23, 8, 0.34);
        }

        .map-topbar__actions :global(.map-topbar__actionButton--danger) {
          color: #e1b0b2;
          border-color: rgba(112, 57, 61, 0.82);
          background:
            linear-gradient(180deg, rgba(64, 24, 30, 0.96), rgba(26, 14, 18, 0.96));
        }

        .map-topbar__actionLabel {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .map-topbar__actionText,
        .map-topbar__actionLabel {
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }

        .map-topbar__actions :global(.ant-btn) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }

        .map-topbar__attentionDot {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ff6d74;
          box-shadow: 0 0 10px rgba(255, 92, 106, 0.82);
        }

        .map-topbar__announcement {
          position: relative;
          margin-bottom: 8px;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(77, 94, 138, 0.78);
          background:
            radial-gradient(circle at top left, rgba(201, 168, 76, 0.08), transparent 34%),
            linear-gradient(135deg, rgba(22, 30, 52, 0.96), rgba(11, 15, 29, 0.95));
          box-shadow:
            inset 0 1px 0 rgba(214, 226, 255, 0.08),
            0 10px 22px rgba(7, 11, 24, 0.22);
        }

        .map-topbar__announcement--temporary {
          border-color: rgba(178, 113, 77, 0.74);
          background:
            radial-gradient(circle at top left, rgba(239, 175, 126, 0.1), transparent 34%),
            linear-gradient(135deg, rgba(85, 33, 25, 0.97), rgba(33, 14, 16, 0.95));
        }

        .map-topbar__announcementGlow {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(110, 147, 255, 0.12), transparent 42%),
            radial-gradient(circle at left center, rgba(120, 176, 255, 0.14), transparent 34%);
          pointer-events: none;
        }

        .map-topbar__announcement--temporary .map-topbar__announcementGlow {
          background:
            linear-gradient(90deg, rgba(255, 191, 124, 0.12), transparent 42%),
            radial-gradient(circle at left center, rgba(255, 171, 116, 0.18), transparent 34%);
        }

        .map-topbar__announcementInner {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 0;
          min-width: 0;
          padding: 5px 6px;
        }

        .map-topbar__announcementTrack {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          padding: 5px 8px;
          border-radius: 8px;
          border: 1px solid rgba(69, 85, 132, 0.48);
          background: linear-gradient(180deg, rgba(18, 25, 44, 0.68), rgba(11, 16, 30, 0.78));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .map-topbar__announcementMarquee,
        .map-topbar__announcementText {
          display: inline-flex;
          align-items: center;
          color: #d8e4ff;
          font-size: 11px;
          line-height: 1.35;
          font-weight: 600;
        }

        .map-topbar__announcementMarquee {
          white-space: nowrap;
          font-weight: 600;
          padding-right: 48px;
        }

        .map-topbar__announcement--temporary .map-topbar__announcementMarquee,
        .map-topbar__announcement--temporary .map-topbar__announcementText {
          color: #ffe5d2;
        }

        .map-topbar__announcement--temporary .map-topbar__announcementTrack {
          border-color: rgba(149, 93, 70, 0.54);
          background: linear-gradient(180deg, rgba(52, 24, 23, 0.72), rgba(30, 16, 18, 0.8));
        }

        .map-topbar--compactViewport {
          margin-bottom: 4px;
          padding: 4px;
          gap: 4px;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: stretch;
        }

        .map-topbar--compactViewport .map-topbar__main {
          gap: 3px 6px;
          padding: 5px 6px;
          border-radius: 10px;
        }

        .map-topbar--compactViewport .map-topbar__titleShell {
          gap: 5px;
        }

        .map-topbar--compactViewport .map-topbar__titleIcon {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          font-size: 10px;
        }

        .map-topbar--compactViewport .map-topbar__name {
          font-size: 12px;
          max-width: min(42vw, 188px);
        }

        .map-topbar--compactViewport .map-topbar__meta {
          gap: 2px 3px;
          max-width: min(31vw, 112px);
        }

        .map-topbar--compactViewport .map-topbar__statusChip {
          height: 17px;
          padding: 0 5px;
          font-size: 8px;
        }

        .map-topbar--compactViewport .map-topbar__actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 3px;
          padding: 3px;
          overflow: hidden;
          min-width: 110px;
          border-radius: 9px;
          scrollbar-width: none;
          -ms-overflow-style: none;
          border: 1px solid rgba(64, 76, 110, 0.72);
          background: linear-gradient(180deg, rgba(18, 23, 38, 0.94), rgba(10, 13, 24, 0.92));
          box-shadow: inset 0 1px 0 rgba(240, 248, 255, 0.04), 0 8px 18px rgba(4, 7, 16, 0.14);
        }

        .map-topbar--compactViewport .map-topbar__actions::-webkit-scrollbar {
          display: none;
        }

        .map-topbar--compactViewport .map-topbar__actions :global(.map-topbar__actionButton) {
          width: 100%;
          min-width: 0;
          min-height: 23px;
          height: 23px;
          padding: 0 4px;
          border-radius: 7px;
          font-size: 8px;
        }

        .map-topbar--compactViewport .map-topbar__actions :global(.map-topbar__actionButton .anticon) {
          font-size: 9px;
        }

        .map-topbar--compactViewport .map-topbar__actions :global(.map-topbar__actionButton .ant-btn-icon) {
          margin-inline-end: 3px;
        }

        .map-topbar--compactViewport .map-topbar__eyebrow {
          font-size: 8px;
          letter-spacing: 0.12em;
        }

        .map-topbar--compactViewport .map-topbar__meta :global(.ant-tag) {
          height: 18px;
          line-height: 16px;
          padding: 0 6px;
          font-size: 9px;
        }

        .map-topbar__announcement--compact {
          margin-bottom: 4px;
        }

        .map-topbar__announcement--compact .map-topbar__announcementInner {
          padding: 4px 5px;
        }

        .map-topbar__announcement--compact .map-topbar__announcementTrack {
          padding: 3px 6px;
          border-radius: 7px;
        }

        .map-topbar__announcement--compact .map-topbar__announcementMarquee,
        .map-topbar__announcement--compact .map-topbar__announcementText {
          font-size: 8px;
          line-height: 1.2;
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .map-topbar:not(.map-topbar--compactViewport) {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
            padding: 9px;
          }

          .map-topbar__main {
            gap: 7px;
          }

          .map-topbar__titleShell {
            gap: 8px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__actions {
            width: 100%;
          }

          .map-topbar__name {
            max-width: min(72vw, 260px);
          }

          .map-topbar__announcementInner {
            padding: 6px 8px;
          }
        }

        @media (max-width: 480px) {
          .map-topbar:not(.map-topbar--compactViewport) {
            padding: 9px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__main {
            padding: 9px 10px;
            border-radius: 13px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__titleIcon {
            width: 30px;
            height: 30px;
            border-radius: 10px;
            font-size: 14px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__eyebrow {
            font-size: 9px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__meta {
            gap: 4px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
            padding: 7px;
            border-radius: 13px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__actions :global(.map-topbar__actionButton) {
            min-height: 36px;
            height: 36px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__actions :global(.map-topbar__actionButton--compact) {
            padding: 0 9px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__name {
            max-width: calc(100vw - 136px);
            font-size: 15px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__statusChip {
            padding: 0 8px;
            font-size: 10px;
          }

          .map-topbar:not(.map-topbar--compactViewport) .map-topbar__announcement {
            border-radius: 10px;
          }

          .map-topbar__announcement--compact .map-topbar__announcementInner {
            align-items: stretch;
          }
        }
      `}</style>
    </>
  );
});

type MapSceneViewportProps = {
  data: MapSceneData;
  isCompactViewport: boolean;
  canLocalMove: boolean;
  previousSceneSnapshot: MapSceneSnapshot | null;
  selfRenderCorrection: MapSceneSelfCorrection | null;
  viewSize: number;
  phaserEnabled: boolean;
  maxDisplayHeight?: number;
  colyseusStatus: WorldMapColyseusAoiSnapshot["status"];
  colyseusWeakNetwork: boolean;
  colyseusLastAck: WorldMapColyseusAoiSnapshot["lastAck"];
  onTileClick(x: number, y: number): void;
  onCellClick(cell: MapGridCellClickPayload): boolean | void;
  onRepair(): void;
};

const MapSceneViewport = memo(function MapSceneViewport({
  data,
  isCompactViewport,
  canLocalMove,
  previousSceneSnapshot,
  selfRenderCorrection,
  viewSize,
  phaserEnabled,
  maxDisplayHeight,
  colyseusStatus,
  colyseusWeakNetwork,
  colyseusLastAck,
  onTileClick,
  onCellClick,
  onRepair,
}: MapSceneViewportProps) {
  return (
    <div style={{
      ...sceneViewportCardStyle,
      position: isCompactViewport ? "sticky" : "relative",
      top: isCompactViewport ? 8 : undefined,
      zIndex: isCompactViewport ? 18 : undefined,
    }}>
      {phaserEnabled ? (
        <WorldMapPhaserScene
          mapId={data.map.id}
          width={data.map.width}
          height={data.map.height}
          player={{
            positionX: data.player.positionX,
            positionY: data.player.positionY,
          }}
          sceneSnapshot={data.sceneSnapshot ?? null}
          previousSceneSnapshot={previousSceneSnapshot}
          selfRenderCorrection={selfRenderCorrection}
          entities={data.sceneSnapshot?.entities.map((entity) => ({
            id: entity.id,
            kind: entity.entityType,
            name: entity.id,
            x: entity.positionX,
            y: entity.positionY,
          })) || []}
          connectionStatus={colyseusStatus}
          weakNetwork={colyseusWeakNetwork}
          lastAck={colyseusLastAck}
          onTileClick={onTileClick}
          onRepair={onRepair}
        />
      ) : (
        <MapGrid
          mapId={data.map.id}
          tiles={data.map.tilesData}
          width={data.map.width}
          height={data.map.height}
          mapType={data.map.mapType}
          backgroundImageUrl={data.map.backgroundImageUrl}
          sceneSnapshot={data.sceneSnapshot}
          previousSceneSnapshot={previousSceneSnapshot}
          selfRenderCorrection={selfRenderCorrection}
          npcs={data.npcs}
          monsters={data.monsters}
          onTileClick={onTileClick}
          onCellClick={onCellClick}
          viewSize={viewSize}
          maxMoveDistance={MAX_QUEUED_MAP_MOVE_DISTANCE}
          spiritualSense={data.player.spiritualSense}
          allowPlayerMove={canLocalMove}
          maxDisplayHeight={maxDisplayHeight}
        />
      )}
    </div>
  );
});

type MapSceneNearbySectionProps = {
  adjacentEntities: NearbyMapEntity[];
  nearbyPlayers: MapData["otherPlayers"];
  isCompactViewport: boolean;
  onMonsterInteract(monster: MapData["monsters"][number]): void;
  onViewPlayer(playerId: string): void;
  onOpenNpcDetail(npc: MapData["npcs"][number]): void;
};

const MapSceneNearbySection = memo(function MapSceneNearbySection({
  adjacentEntities,
  nearbyPlayers,
  isCompactViewport,
  onMonsterInteract,
  onViewPlayer,
  onOpenNpcDetail,
}: MapSceneNearbySectionProps) {
  const compactSectionStyle: CSSProperties = isCompactViewport
    ? {
      ...sceneSlimSectionStyle,
      marginTop: 4,
      padding: "4px 5px",
      borderRadius: 10,
      background: "rgba(13, 15, 28, 0.92)",
      border: "1px solid rgba(42, 51, 79, 0.88)",
    }
    : sceneSlimSectionStyle;
  const compactHeaderTextStyle: CSSProperties = {
    color: "#9ca6c0",
    fontSize: isCompactViewport ? 11 : 12,
  };
  const compactHintTextStyle: CSSProperties = {
    ...intelTinyTextStyle,
    color: "#6f7b97",
    fontSize: isCompactViewport ? 9 : intelTinyTextStyle.fontSize,
  };
  const compactEntityCardWidth = isCompactViewport ? 138 : 172;
  const compactPlayerCardWidth = isCompactViewport ? 158 : 208;
  const nearbyEntityRailRef = useRef<HTMLDivElement | null>(null);
  const nearbyPlayerRailRef = useRef<HTMLDivElement | null>(null);
  const scrollHorizontalRailBy = useCallback((railRef: { current: HTMLDivElement | null }, delta: number) => {
    const railNode = railRef.current;
    if (!railNode) {
      return;
    }
    railNode.scrollBy({ left: delta, behavior: "smooth" });
  }, []);
  const handleHorizontalRailWheel = useCallback((railRef: { current: HTMLDivElement | null }, event: ReactWheelEvent<HTMLDivElement>) => {
    const railNode = railRef.current;
    if (!railNode || isCompactViewport) {
      return;
    }

    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();
    scrollHorizontalRailBy(railRef, event.deltaY);
  }, [isCompactViewport, scrollHorizontalRailBy]);

  return (
    <>
      {adjacentEntities.length > 0 ? (
        <div className={`map-nearby-section${isCompactViewport ? " is-compact" : ""}`} style={compactSectionStyle}>
          <div className="map-nearby-section__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: isCompactViewport ? 4 : 6 }}>
            <Text className="map-nearby-section__title" style={compactHeaderTextStyle}>{`附近 NPC 与妖兽 · ${adjacentEntities.length}`}</Text>
            <div className="map-nearby-section__headerTools" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {!isCompactViewport ? (
                <Button
                  className="map-nearby-section__scrollButton"
                  size="small"
                  icon={<LeftOutlined />}
                  onClick={() => scrollHorizontalRailBy(nearbyEntityRailRef, -220)}
                  style={{ ...sceneToolButtonStyle, width: 22, minWidth: 22, height: 22 }}
                />
              ) : null}
              {!isCompactViewport ? (
                <Button
                  className="map-nearby-section__scrollButton"
                  size="small"
                  icon={<RightOutlined />}
                  onClick={() => scrollHorizontalRailBy(nearbyEntityRailRef, 220)}
                  style={{ ...sceneToolButtonStyle, width: 22, minWidth: 22, height: 22 }}
                />
              ) : null}
              <Text className="map-nearby-section__hint" style={compactHintTextStyle}>{isCompactViewport ? "轻触交互" : "轻点即可交互"}</Text>
            </div>
          </div>
          <div
            ref={nearbyEntityRailRef}
            className="map-nearby-entity-rail"
            onWheel={(event) => handleHorizontalRailWheel(nearbyEntityRailRef, event)}
            style={{
              display: "flex",
              gap: isCompactViewport ? 6 : 8,
              overflowX: "auto",
              paddingBottom: isCompactViewport ? 2 : 4,
              scrollSnapType: "x proximity",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-x",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              cursor: isCompactViewport ? "auto" : "ew-resize",
            }}
          >
            {adjacentEntities.map((entity) => (
              <button
                className={`map-nearby-card map-nearby-card--${entity.entityType}${isCompactViewport ? " is-compact" : ""}`}
                key={`${entity.entityType}:${entity.id}`}
                type="button"
                onClick={() => {
                  if (entity.entityType === "npc") {
                    onOpenNpcDetail(entity);
                    return;
                  }
                  onMonsterInteract(entity);
                }}
                style={{
                  minWidth: compactEntityCardWidth,
                  flex: `0 0 ${compactEntityCardWidth}px`,
                  scrollSnapAlign: "start",
                  textAlign: "left",
                  borderRadius: isCompactViewport ? 10 : 12,
                  padding: isCompactViewport ? "8px 9px" : "10px 12px",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: isCompactViewport ? 6 : 8 }}>
                  {entity.entityType === "npc" ? (
                    <div className="map-nearby-card__avatarShell map-nearby-card__avatarShell--npc">
                      <PlayerAvatar
                        size={isCompactViewport ? 22 : 26}
                        avatarImageUrl={entity.avatarImageUrl}
                        fallbackText={(entity.name || "商").trim().slice(0, 1) || "商"}
                        fallbackColor="#f3d7a6"
                        fallbackFontWeight={700}
                        borderColor="#8a6a2a"
                        background="rgba(66, 46, 20, 0.9)"
                      />
                    </div>
                  ) : (
                    <div className="map-nearby-card__avatarShell map-nearby-card__avatarShell--monster">
                      <div style={{
                        width: isCompactViewport ? 22 : 26,
                        height: isCompactViewport ? 22 : 26,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(113, 46, 46, 0.82)",
                        color: "#ffd4d4",
                        fontSize: isCompactViewport ? 10 : 11,
                        fontWeight: 700,
                      }}>
                        妖
                      </div>
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text className="map-nearby-card__title" style={{ ...intelBodyTextStyle, fontSize: isCompactViewport ? 11 : intelBodyTextStyle.fontSize, color: entity.entityType === "npc" ? "#eff3ff" : "#ffe7e7", fontWeight: 600 }}>
                      {entity.entityType === "npc" ? entity.name : `妖兽 · ${entity.name}`}
                    </Text>
                    <Text className="map-nearby-card__subtitle" style={{ ...intelTinyTextStyle, fontSize: isCompactViewport ? 9 : intelTinyTextStyle.fontSize, color: entity.entityType === "npc" ? "#9fb0dc" : "#d7a7a7" }}>
                      {entity.entityType === "npc" ? "点击查看人物详情" : "点击发起交互或战斗"}
                    </Text>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {nearbyPlayers.length > 0 ? (
        <div className={`map-nearby-section${isCompactViewport ? " is-compact" : ""}`} style={compactSectionStyle}>
          <div className="map-nearby-section__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: isCompactViewport ? 4 : 6 }}>
            <Text className="map-nearby-section__title" style={compactHeaderTextStyle}>{`附近道友 · ${nearbyPlayers.length}`}</Text>
            <div className="map-nearby-section__headerTools" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {!isCompactViewport ? (
                <Button
                  className="map-nearby-section__scrollButton"
                  size="small"
                  icon={<LeftOutlined />}
                  onClick={() => scrollHorizontalRailBy(nearbyPlayerRailRef, -240)}
                  style={{ ...sceneToolButtonStyle, width: 22, minWidth: 22, height: 22 }}
                />
              ) : null}
              {!isCompactViewport ? (
                <Button
                  className="map-nearby-section__scrollButton"
                  size="small"
                  icon={<RightOutlined />}
                  onClick={() => scrollHorizontalRailBy(nearbyPlayerRailRef, 240)}
                  style={{ ...sceneToolButtonStyle, width: 22, minWidth: 22, height: 22 }}
                />
              ) : null}
              <Text className="map-nearby-section__hint" style={compactHintTextStyle}>{isCompactViewport ? "左右轻扫" : "左右轻扫查看"}</Text>
            </div>
          </div>
          <div
            ref={nearbyPlayerRailRef}
            className="mobile-map-player-carousel"
            onWheel={(event) => handleHorizontalRailWheel(nearbyPlayerRailRef, event)}
            style={{
              display: "flex",
              gap: isCompactViewport ? 6 : 8,
              overflowX: "auto",
              paddingBottom: isCompactViewport ? 2 : 4,
              scrollSnapType: "x proximity",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-x",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              cursor: isCompactViewport ? "auto" : "ew-resize",
            }}
          >
            {nearbyPlayers.map((player) => (
              <button
                className={`map-nearby-card map-nearby-card--player${isCompactViewport ? " is-compact" : ""}`}
                key={player.id}
                type="button"
                onClick={() => onViewPlayer(player.id)}
                style={{
                  minWidth: compactPlayerCardWidth,
                  flex: `0 0 ${compactPlayerCardWidth}px`,
                  scrollSnapAlign: "start",
                  textAlign: "left",
                  borderRadius: isCompactViewport ? 10 : 12,
                  padding: isCompactViewport ? "8px 9px" : "10px 12px",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: isCompactViewport ? 6 : 8 }}>
                  <div className="map-nearby-card__avatarShell map-nearby-card__avatarShell--player">
                    <PlayerAvatar
                      size={isCompactViewport ? 24 : 28}
                      avatarImageUrl={player.avatarImageUrl}
                      avatarFrameImageUrl={player.avatarFrameImageUrl}
                      fallbackText={(player.name || "修").trim().slice(0, 1) || "修"}
                      fallbackColor="#d4defe"
                      fallbackFontWeight={600}
                      borderColor="#3b4c75"
                      background="rgba(20, 27, 46, 0.9)"
                    />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text className="map-nearby-card__title" style={{ ...intelBodyTextStyle, fontSize: isCompactViewport ? 11 : intelBodyTextStyle.fontSize, color: "#eff3ff", fontWeight: 600 }}>
                      {player.name || "无名修士"}
                    </Text>
                    <Text className="map-nearby-card__subtitle" style={{ ...intelTinyTextStyle, fontSize: isCompactViewport ? 9 : intelTinyTextStyle.fontSize, color: "#9fb0dc" }}>
                      {player.realmName || "未知境界"}
                    </Text>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
});

export default function MapPage() {
  const [sceneData, setSceneData] = useState<MapSceneData | null>(null);
  const [rawPanelData, setRawPanelData] = useState<MapPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [encounterLoadingVisible, setEncounterLoadingVisible] = useState(false);
  const [encounterLoadingText, setEncounterLoadingText] = useState("正在感应奇遇");
  const [encounterLoadingDots, setEncounterLoadingDots] = useState("");
  const [event, setEvent] = useState<EventModalData | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [encounterChoiceLoading, setEncounterChoiceLoading] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [playerProfileOpen, setPlayerProfileOpen] = useState(false);
  const [playerProfileLoading, setPlayerProfileLoading] = useState(false);
  const [friendApplyLoading, setFriendApplyLoading] = useState(false);
  const [partyInviteLoading, setPartyInviteLoading] = useState(false);
  const [doubleCultivationRequestLoading, setDoubleCultivationRequestLoading] = useState(false);
  const [pvpLoading, setPvpLoading] = useState(false);
  const [playerProfile, setPlayerProfile] = useState<NearbyPlayerProfile | null>(null);
  const [partySnapshot, setPartySnapshot] = useState<PartySnapshot | null>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  const [partyPanelOpen, setPartyPanelOpen] = useState(true);
  const [partyActionLoadingKey, setPartyActionLoadingKey] = useState<string | null>(null);
  const [viewSize, setViewSize] = useState(MIN_VIEW_SIZE);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [mobileMapIntelOpen, setMobileMapIntelOpen] = useState<"intel" | "travel" | null>(null);
  const [actionRailOverlayKey, setActionRailOverlayKey] = useState<string | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(DEFAULT_COMPACT_VIEWPORT);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_MOBILE_VIEWPORT_HEIGHT);
  const [secretRealmIntelOpen, setSecretRealmIntelOpen] = useState(false);
  const [temporaryAnnouncement, setTemporaryAnnouncement] = useState<TemporaryAnnouncementState | null>(null);
  const [pendingAssassinationModal, setPendingAssassinationModal] = useState<PendingAssassinationData | null>(null);
  const [assassinationActionLoading, setAssassinationActionLoading] = useState<"escape" | "fight" | null>(null);
  const [worldIntelDetailsLoading, setWorldIntelDetailsLoading] = useState(false);
  const [worldIntelDetailsMapId, setWorldIntelDetailsMapId] = useState<string | null>(null);
  const [worldIntelLoadError, setWorldIntelLoadError] = useState<string | null>(null);
  const [worldEventOffers, setWorldEventOffers] = useState<WorldEventOfferData[]>([]);
  const [worldContracts, setWorldContracts] = useState<WorldContractData[]>([]);
  const [worldIntelDistrictStates, setWorldIntelDistrictStates] = useState<NonNullable<MapData["districtStates"]>>([]);
  const [worldIntelStorylines, setWorldIntelStorylines] = useState<NonNullable<MapData["activeStorylines"]>>([]);
  const [worldIntelObjectivePoints, setWorldIntelObjectivePoints] = useState<NonNullable<MapData["worldObjectivePoints"]>>([]);
  const [worldOfferActionLoadingId, setWorldOfferActionLoadingId] = useState<string | null>(null);
  const [worldContractActionLoadingId, setWorldContractActionLoadingId] = useState<string | null>(null);
  const [worldStorylineActionLoadingId, setWorldStorylineActionLoadingId] = useState<string | null>(null);
  const [adultInviteActionLoadingId, setAdultInviteActionLoadingId] = useState<string | null>(null);
  const [adultInviteDetail, setAdultInviteDetail] = useState<AdultInviteData | null>(null);
  const playerProfileRequestIdRef = useRef(0);
  const playerProfileAbortControllerRef = useRef<AbortController | null>(null);
  const playerProfileCacheRef = useRef<Map<string, NearbyPlayerProfile>>(new Map());
  const pendingEncounterRedirectRef = useRef<string | null>(null);
  const overlayStripRef = useRef<HTMLDivElement | null>(null);
  const initializedViewSizeRef = useRef(false);
  const pageVisibleRef = useRef(true);
  const temporaryAnnouncementTimerRef = useRef<number | null>(null);
  const latestHongmengAnnouncementIdRef = useRef(0);
  const partySnapshotInFlightRef = useRef(false);
  const partySnapshotQueuedRef = useRef(false);
  const partySnapshotLastFetchedAtRef = useRef(0);
  const partySnapshotQueuedTimerRef = useRef<number | null>(null);
  const secretRealmPanelRequestIdRef = useRef(0);
  const secretRealmPanelInFlightRef = useRef(false);
  const secretRealmPanelLastFetchedAtRef = useRef(0);
  const worldIntelRequestIdRef = useRef(0);
  const worldIntelAbortControllerRef = useRef<AbortController | null>(null);
  const colyseusSceneSnapshotRef = useRef<MapSceneSnapshot | null>(null);
  const colyseusShadowMoveStateRef = useRef<ColyseusShadowMoveState | null>(null);
  const colyseusShadowDriftRepairAtRef = useRef(0);
  const worldMapColyseusAoiRef = useRef<ReturnType<typeof useWorldMapColyseusAoi> | null>(null);
  const socialRoomPartyRepairKeyRef = useRef("");
  const router = useRouter();
  const pathname = usePathname();
  const { modal } = App.useApp();
  const [messageApi, contextHolder] = message.useMessage();
  const deferredPanelData = useDeferredValue(rawPanelData);
  const panelData = deferredPanelData ?? rawPanelData ?? EMPTY_MAP_PANEL_DATA;
  const data = sceneData;
  const currentMapId = sceneData?.map.id;
  const currentPlayerId = sceneData?.player?.id ?? "";
  const currentMapShardId = sceneData?.player.currentMapInstanceId || "default";
  const currentPartyId = partySnapshot?.party?.id ?? null;
  const pvpEnabledOnCurrentMap = Boolean(panelData.pvp?.enabled);
  const viewSizeRange = useMemo(() => resolveMapViewSizeRange({
    spiritualSense: sceneData?.player.spiritualSense ?? 0,
    mapWidth: sceneData?.map.width ?? MIN_VIEW_SIZE,
    mapHeight: sceneData?.map.height ?? MIN_VIEW_SIZE,
  }), [sceneData?.map.height, sceneData?.map.width, sceneData?.player.spiritualSense]);
  const activeEncounter = partySnapshot?.activeEncounter ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsCompactViewport(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewportHeight = () => {
      setViewportHeight(Math.round(window.visualViewport?.height || window.innerHeight || 0));
    };
    syncViewportHeight();

    window.addEventListener("resize", syncViewportHeight);
    window.visualViewport?.addEventListener("resize", syncViewportHeight);
    return () => {
      window.removeEventListener("resize", syncViewportHeight);
      window.visualViewport?.removeEventListener("resize", syncViewportHeight);
    };
  }, []);

  useEffect(() => {
    setMobileMapIntelOpen(null);
    setActionRailOverlayKey(null);
  }, [currentMapId]);

  useEffect(() => {
    if (!sceneData) {
      setRawPanelData(null);
    }
  }, [sceneData]);

  const scrollHorizontalRailBy = useCallback((railRef: { current: HTMLDivElement | null }, delta: number) => {
    const railNode = railRef.current;
    if (!railNode) {
      return;
    }
    railNode.scrollBy({ left: delta, behavior: "smooth" });
  }, []);
  const handleHorizontalRailWheel = useCallback((railRef: { current: HTMLDivElement | null }, event: ReactWheelEvent<HTMLDivElement>) => {
    const railNode = railRef.current;
    if (!railNode || isCompactViewport) {
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 2) {
      return;
    }
    event.preventDefault();
    railNode.scrollBy({ left: delta, behavior: "auto" });
  }, [isCompactViewport]);

  const shouldUseFastPartyPolling = Boolean(partySnapshot?.party) || Boolean(activeEncounter);
  const partyPollInterval = shouldUseFastPartyPolling
    ? PARTY_FAST_POLL_INTERVAL_MS
    : PARTY_SLOW_POLL_INTERVAL_MS;
  const playerOnPortal = data
    ? isPortalTileAtPosition({
      tiles: data.map.tilesData,
      x: data.player.positionX,
      y: data.player.positionY,
    })
    : false;
  const currentPlayerPortal = useMemo(() => findPortalAtPosition(data), [data]);
  const currentTravelMode = panelData.travelMode;
  const rawCurrentSecretRealm = (panelData.currentSecretRealm ?? null) as NonNullable<MapData["currentSecretRealm"]> | null;
  const playerCurrentMapInstanceId = (data?.player.currentMapInstanceId || "").trim();
  const currentSecretRealm = (
    data?.map.mapType === "secret_realm_instance"
    && playerCurrentMapInstanceId
    && rawCurrentSecretRealm
    && rawCurrentSecretRealm.instanceId === playerCurrentMapInstanceId
  )
    ? rawCurrentSecretRealm
    : null;
  const isStandingOnSecretRealmReturnPortal = Boolean(
    currentSecretRealm
    && data
    && Number(data.player.positionX) === Number(currentSecretRealm.returnPortalX)
    && Number(data.player.positionY) === Number(currentSecretRealm.returnPortalY),
  );
  const currentSecretRealmCanLeaveNow = Boolean(
    currentSecretRealm
    && (
      currentSecretRealm.canLeaveNow
      || isStandingOnSecretRealmReturnPortal
    )
  );
  const shouldSyncCurrentSecretRealmPanel = Boolean(
    data?.map.mapType === "secret_realm_instance"
    || playerCurrentMapInstanceId
    || rawPanelData?.currentSecretRealm,
  );
  const visibleAnnouncementText = String(temporaryAnnouncement?.content || panelData.publicAnnouncement || "").trim();
  const isTemporaryAnnouncementActive = Boolean(temporaryAnnouncement?.content?.trim());
  const visibleLinkedMaps = useMemo(() => {
    if (!data) {
      return [];
    }
    const liveLinkedMaps = panelData.linkedMaps.map((target) => resolveLiveTravelTarget({
      target,
      playerRealm: data.player.realm,
      travelMode: currentTravelMode,
      currentPortal: currentPlayerPortal,
    }));
    if (currentTravelMode !== "portal") {
      return liveLinkedMaps;
    }
    if (!playerOnPortal || !currentPlayerPortal) {
      return liveLinkedMaps;
    }

    const currentTargetMapId = String(currentPlayerPortal.targetMapId || "").trim();
    if (!currentTargetMapId) {
      return liveLinkedMaps;
    }

    return liveLinkedMaps.filter((linkedMap) => (
      Boolean(linkedMap.currentPortalMatched)
      || (currentTargetMapId.length > 0 && linkedMap.id === currentTargetMapId)
    ));
  }, [currentPlayerPortal, currentTravelMode, data, panelData.linkedMaps, playerOnPortal]);
  const showTravelSection = data
    ? (
      currentTravelMode === "portal"
        ? playerOnPortal && visibleLinkedMaps.length > 0
        : visibleLinkedMaps.length > 0
    )
    : false;
  const openWorldEntranceHint = useMemo(() => {
    if (!data || playerOnPortal) {
      return null;
    }
    const openWorldTarget = visibleLinkedMaps.find((target) => target.mapType === "open_world");
    if (!openWorldTarget) {
      return null;
    }
    const relatedPortal = data.portals.find((portal) => portal.targetMapId === openWorldTarget.id) || null;
    if (!relatedPortal) {
      return null;
    }
    return {
      mapName: openWorldTarget.name,
      portalName: relatedPortal.portalName || "天道界门",
      x: relatedPortal.x,
      y: relatedPortal.y,
    };
  }, [data, playerOnPortal, visibleLinkedMaps]);
  const travelGraphPreview = panelData.travelGraphPreview || null;
  const showTravelQuickPanel = showTravelSection
    || Boolean(openWorldEntranceHint)
    || Boolean(
      data?.map.mapType === "open_world"
      && (
        (panelData.travelGraphPreview?.travelConnections?.length || 0) > 0
        || (panelData.openWorldExploration?.travelConnections?.length || 0) > 0
      ),
    );
  const activeAdultInvites = useMemo(() => {
    const rows = Array.isArray(panelData.adultInvites) ? panelData.adultInvites : [];
    const dedupedRows = Array.from(new Map(
      [...rows]
        .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))
        .map((invite) => [invite.npcId, invite]),
    ).values());
    return dedupedRows.slice(0, WORLD_INTEL_PREVIEW_LIMITS.adultInvites);
  }, [panelData.adultInvites]);
  useEffect(() => {
    if (!adultInviteDetail) {
      return;
    }
    if (!activeAdultInvites.some((invite) => invite.eventLogId === adultInviteDetail.eventLogId)) {
      setAdultInviteDetail(null);
    }
  }, [activeAdultInvites, adultInviteDetail]);
  const adultDangerHints = useMemo(() => (
    Array.isArray(panelData.adultDangerHints)
      ? panelData.adultDangerHints
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, WORLD_INTEL_PREVIEW_LIMITS.adultDangerHints)
      : []
  ), [panelData.adultDangerHints]);
  const worldObjectivePointRows = useMemo(() => {
    if (worldIntelDetailsMapId === currentMapId) {
      return worldIntelObjectivePoints;
    }
    return Array.isArray(panelData.worldObjectivePoints) ? panelData.worldObjectivePoints : [];
  }, [currentMapId, panelData.worldObjectivePoints, worldIntelDetailsMapId, worldIntelObjectivePoints]);
  const districtStateRows = useMemo(() => {
    if (worldIntelDetailsMapId === currentMapId) {
      return worldIntelDistrictStates;
    }
    return Array.isArray(panelData.districtStates) ? panelData.districtStates : [];
  }, [currentMapId, panelData.districtStates, worldIntelDetailsMapId, worldIntelDistrictStates]);
  const activeStorylineRows = useMemo(() => {
    if (worldIntelDetailsMapId === currentMapId) {
      return worldIntelStorylines;
    }
    return Array.isArray(panelData.activeStorylines) ? panelData.activeStorylines : [];
  }, [currentMapId, panelData.activeStorylines, worldIntelDetailsMapId, worldIntelStorylines]);
  const worldObjectivePoints = useMemo(() => (
    Array.isArray(worldObjectivePointRows)
      ? worldObjectivePointRows.slice(0, WORLD_INTEL_PREVIEW_LIMITS.objectivePoints)
      : []
  ), [worldObjectivePointRows]);
  const districtStates = useMemo(() => (
    Array.isArray(districtStateRows)
      ? districtStateRows.slice(0, WORLD_INTEL_PREVIEW_LIMITS.districtStates)
      : []
  ), [districtStateRows]);
  const activeStorylines = useMemo(() => (
    Array.isArray(activeStorylineRows)
      ? activeStorylineRows.slice(0, WORLD_INTEL_PREVIEW_LIMITS.storylines)
      : []
  ), [activeStorylineRows]);
  const activeStorylineById = useMemo(() => (
    new Map(activeStorylines.map((storyline) => [storyline.id, storyline]))
  ), [activeStorylines]);
  const factionPressureHints = useMemo(() => (
    Array.isArray(panelData.factionPressureHints)
      ? panelData.factionPressureHints.slice(0, WORLD_INTEL_PREVIEW_LIMITS.factionHints)
      : []
  ), [panelData.factionPressureHints]);
  const openWorldExploration = panelData.openWorldExploration || null;
  const mapHeatSummary = panelData.mapHeatSummary || openWorldExploration?.mapHeatSummary || null;
  const travelGraphConnections = useMemo(() => (
    Array.isArray(travelGraphPreview?.travelConnections)
      ? travelGraphPreview.travelConnections.slice(0, WORLD_INTEL_PREVIEW_LIMITS.travelConnections)
      : []
  ), [travelGraphPreview]);
  const rumorHooks = useMemo(() => (
    Array.isArray(openWorldExploration?.rumorHooks)
      ? openWorldExploration.rumorHooks.slice(0, WORLD_INTEL_PREVIEW_LIMITS.rumorHooks)
      : []
  ), [openWorldExploration]);
  const encounterHooks = useMemo(() => (
    Array.isArray(openWorldExploration?.encounterHooks)
      ? openWorldExploration.encounterHooks.slice(0, WORLD_INTEL_PREVIEW_LIMITS.encounterHooks)
      : []
  ), [openWorldExploration]);
  const secretRealmHooks = useMemo(() => (
    Array.isArray(openWorldExploration?.secretRealmHooks)
      ? openWorldExploration.secretRealmHooks.slice(0, WORLD_INTEL_PREVIEW_LIMITS.secretRealmHooks)
      : []
  ), [openWorldExploration]);
  const objectivePointById = useMemo(() => (
    new Map(worldObjectivePoints.map((point) => [point.id, point]))
  ), [worldObjectivePoints]);
  const trackingSignalsPreview = useMemo(() => (
    Array.isArray(panelData.trackingSignals)
      ? panelData.trackingSignals.slice(0, WORLD_INTEL_PREVIEW_LIMITS.trackingSignals)
      : []
  ), [panelData.trackingSignals]);
  const worldPressureDetailLines = useMemo(() => {
    if (!panelData.worldPressure) {
      return [];
    }
    const rawLines = [
      panelData.worldPressure.tierDescription,
      panelData.worldPressure.nextRiskLabel,
      panelData.worldPressure.lawfulSummary,
      panelData.worldPressure.shadowSummary,
    ]
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .filter((line) => line !== panelData.worldPressure?.summary.trim());

    return Array.from(new Set([...rawLines, ...factionPressureHints]));
  }, [factionPressureHints, panelData.worldPressure]);
  const reputationDetailLines = useMemo(() => {
    if (!panelData.reputationSummary) {
      return [];
    }
    return [
      `当前风评：${panelData.reputationSummary.notorietyLabel}`,
      `灰线路数：${panelData.reputationSummary.shadowLabel}`,
      `情名风评：${panelData.reputationSummary.sensualLabel}`,
      panelData.reputationSummary.socialFlavorLabel,
      ...panelData.reputationSummary.worldBehaviorHints,
      panelData.reputationSummary.needsBrokerRelief ? panelData.reputationSummary.repairHint : "",
    ]
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .filter((line) => line !== panelData.reputationSummary?.overallSummary.trim());
  }, [panelData.reputationSummary]);
  const activeWorldContracts = useMemo(() => (
    worldContracts.filter((contract) => contract.contractStatus === "active")
  ), [worldContracts]);
  const reputationRepairGuidanceEntries = useMemo<ReputationRepairGuideEntry[]>(() => {
    if (!panelData.reputationSummary?.repairActions.length) {
      return [];
    }

    const entries: ReputationRepairGuideEntry[] = [];
    const repairContracts = activeWorldContracts.filter((contract) => isReputationRepairOfferType(contract.offerType));
    repairContracts.slice(0, 2).forEach((contract) => {
      const targetPlace = contract.currentObjectiveDistrictName
        || contract.targetDistrictName
        || contract.currentObjectiveMapName
        || contract.targetMapName
        || "开放世界";
      const summary = contract.canAdvanceByObjective
        ? contract.currentObjectiveMapId && contract.currentObjectiveMapId !== currentMapId
          ? `这条门路已经落成委托，先去 ${contract.currentObjectiveMapName || "指定地界"} 的 ${contract.currentObjectivePointLabel || "目标点"}。`
          : contract.currentObjectivePointLabel
            ? `这条门路已经落成委托，先去 ${targetPlace} 的 ${contract.currentObjectivePointLabel}。`
            : `这条门路已经落成委托，先去 ${targetPlace} 把后手做完。`
        : contract.targetNpcName
          ? `这条门路已经落成委托，先去 ${targetPlace} 找 ${contract.targetNpcName}。`
          : `这条门路已经落成委托，去 ${targetPlace} 把这件事办妥。`;

      entries.push({
        key: `contract:${contract.offerId}`,
        source: "contract",
        title: contract.title,
        summary,
        contract,
      });
    });

    if (entries.length < 3) {
      worldEventOffers
        .filter((offer) => isReputationRepairOfferType(offer.offerType))
        .slice(0, 3 - entries.length)
        .forEach((offer) => {
          const summary = offer.offerType === "broker_relief"
            ? "这是最快的修关系入口，接下后会生成牙子递话委托。"
            : offer.offerType === "gift_lingyu"
              ? "接下后会生成赔礼送礼的实际门路，用灵石把话头先压软。"
              : offer.offerType === "consensual_dual_cultivation"
                ? "接下后会落成可执行的合意双修门路，可直接拿来压风声。"
                : "接下后会生成真实探宝线，借机缘和利益把关系重新拉回去。";
          entries.push({
            key: `offer:${offer.id}`,
            source: "offer",
            title: offer.offerTypeLabel,
            summary,
            offer,
          });
        });
    }

    if (entries.length === 0) {
      entries.push({
        key: "fallback",
        source: "fallback",
        title: "先从任务与地图情报入手",
        summary: "当前没有直接挂到你身上的修关系门路时，可以先去任务页查看世界委托，或在地图情报里找灰巷牙子、卖讯修士和可接触的缓和入口。",
      });
    }

    return entries;
  }, [activeWorldContracts, currentMapId, panelData.reputationSummary, worldEventOffers]);
  const objectivePointContractMap = useMemo(() => {
    const entries = new Map<string, WorldContractData[]>();
    activeWorldContracts.forEach((contract) => {
      if (
        contract.canAdvanceByObjective
        && contract.currentObjectiveMapId === currentMapId
        && contract.currentObjectivePointId
      ) {
        const list = entries.get(contract.currentObjectivePointId) || [];
        list.push(contract);
        entries.set(contract.currentObjectivePointId, list);
      }
    });
    return entries;
  }, [activeWorldContracts, currentMapId]);
  const secondaryHookRows = useMemo(() => (
    Array.isArray(panelData.secondaryHooks) ? panelData.secondaryHooks : []
  ), [panelData.secondaryHooks]);
  const visibleSecondaryHooks = secondaryHookRows;
  const hasMapIntelPanel = Boolean(
    data?.map.description
    || openWorldExploration
    || travelGraphPreview
    || mapHeatSummary,
  );
  const mapIntelSummary = useMemo(() => {
    const parts: string[] = [];
    if (openWorldExploration?.regionBand) {
      parts.push(openWorldExploration.regionBand);
    }
    if (mapHeatSummary?.heatTierLabel) {
      parts.push(mapHeatSummary.heatTierLabel);
    }
    if (travelGraphPreview?.travelConnections?.length) {
      parts.push(`可达 ${travelGraphPreview.travelConnections.length} 处`);
    }

    return parts.join(" · ") || "这张地图的地理脉络已整理在此。";
  }, [mapHeatSummary?.heatTierLabel, openWorldExploration?.regionBand, travelGraphPreview?.travelConnections?.length]);
  const fetchWorldIntelDetails = useCallback(async (options?: {
    force?: boolean;
  }) => {
    const mapId = String(sceneData?.map.id || "").trim();
    if (!mapId || sceneData?.map.mapType !== "open_world") {
      worldIntelAbortControllerRef.current?.abort();
      worldIntelAbortControllerRef.current = null;
      setWorldIntelLoadError(null);
      setWorldEventOffers([]);
      setWorldContracts([]);
      setWorldIntelDistrictStates([]);
      setWorldIntelStorylines([]);
      setWorldIntelObjectivePoints([]);
      setWorldIntelDetailsMapId(null);
      return;
    }
    if (!options?.force && worldIntelDetailsMapId === mapId) {
      return;
    }

    const requestId = worldIntelRequestIdRef.current + 1;
    worldIntelRequestIdRef.current = requestId;
    worldIntelAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    worldIntelAbortControllerRef.current = abortController;
    setWorldIntelDetailsLoading(true);
    setWorldIntelLoadError(null);
    try {
      const response = await fetch(`/api/game/world/intel?mapId=${encodeURIComponent(mapId)}`, {
        cache: "no-store",
        signal: abortController.signal,
      });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: {
          eventOffers?: WorldEventOfferData[];
          contracts?: WorldContractData[];
          districtStates?: NonNullable<MapData["districtStates"]>;
          storylines?: NonNullable<MapData["activeStorylines"]>;
          objectivePoints?: NonNullable<MapData["worldObjectivePoints"]>;
        };
      };
      if (abortController.signal.aborted || worldIntelRequestIdRef.current !== requestId) {
        return;
      }
      if (!response.ok || !json.success) {
        throw new Error(json.error || "获取世界动静失败");
      }

      setWorldEventOffers(Array.isArray(json.data?.eventOffers) ? json.data.eventOffers : []);
      setWorldContracts(Array.isArray(json.data?.contracts) ? json.data.contracts : []);
      setWorldIntelDistrictStates(Array.isArray(json.data?.districtStates) ? json.data.districtStates : []);
      setWorldIntelStorylines(Array.isArray(json.data?.storylines) ? json.data.storylines : []);
      setWorldIntelObjectivePoints(Array.isArray(json.data?.objectivePoints) ? json.data.objectivePoints : []);
      setWorldIntelDetailsMapId(mapId);
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      console.error("Map world intel detail error:", error);
      setWorldIntelLoadError("世界动静暂未接上，可稍后重试。");
    } finally {
      if (worldIntelAbortControllerRef.current === abortController) {
        worldIntelAbortControllerRef.current = null;
      }
      if (!abortController.signal.aborted && worldIntelRequestIdRef.current === requestId) {
        setWorldIntelDetailsLoading(false);
      }
    }
  }, [sceneData?.map.id, sceneData?.map.mapType, worldIntelDetailsMapId]);

  useEffect(() => {
    worldIntelAbortControllerRef.current?.abort();
    worldIntelAbortControllerRef.current = null;
    setWorldIntelDetailsLoading(false);

    if (!sceneData?.player?.id || sceneData?.map.mapType !== "open_world") {
      setWorldIntelLoadError(null);
      setWorldEventOffers([]);
      setWorldContracts([]);
      setWorldIntelDistrictStates([]);
      setWorldIntelStorylines([]);
      setWorldIntelObjectivePoints([]);
      setWorldIntelDetailsMapId(null);
      return;
    }
    setWorldIntelLoadError(null);
    setWorldEventOffers([]);
    setWorldContracts([]);
    setWorldIntelDistrictStates([]);
    setWorldIntelStorylines([]);
    setWorldIntelObjectivePoints([]);
    setWorldIntelDetailsMapId(null);
  }, [sceneData?.map.id, sceneData?.map.mapType, sceneData?.player?.id]);

  useEffect(() => (
    () => {
      worldIntelAbortControllerRef.current?.abort();
      worldIntelAbortControllerRef.current = null;
    }
  ), []);

  useEffect(() => {
    if (!sceneData?.player?.id || sceneData?.map.mapType !== "open_world") {
      return;
    }
    void fetchWorldIntelDetails();
  }, [fetchWorldIntelDetails, sceneData?.map.id, sceneData?.map.mapType, sceneData?.player?.id]);

  useEffect(() => {
    if (!data?.activeEncounterSession || eventOpen || event) {
      return;
    }
    const restoredEvent = buildEncounterModalData(data.activeEncounterSession);
    if (restoredEvent) {
      setEvent(restoredEvent);
      setEventOpen(true);
    }
  }, [data?.activeEncounterSession, event, eventOpen]);

  useEffect(() => {
    const nextPending = panelData.pendingAssassination || null;
    if (!nextPending) {
      if (!assassinationActionLoading) {
        setPendingAssassinationModal(null);
      }
      return;
    }

    setPendingAssassinationModal((current) => {
      if (current?.id === nextPending.id) {
        return current;
      }
      return nextPending;
    });
  }, [assassinationActionLoading, panelData.pendingAssassination]);

  const closePlayerProfileModal = useCallback(() => {
    playerProfileRequestIdRef.current += 1;
    playerProfileAbortControllerRef.current?.abort();
    playerProfileAbortControllerRef.current = null;
    setPlayerProfileOpen(false);
    setPlayerProfileLoading(false);
  }, []);

  const removeOpportunityAtCurrentPlayerTile = useCallback(() => {
    setSceneData((current) => {
      if (!current) {
        return current;
      }

      const nextOpportunities = current.opportunities.filter((opportunity) => !(
        opportunity.positionX === current.player.positionX
        && opportunity.positionY === current.player.positionY
      ));
      if (nextOpportunities.length === current.opportunities.length) {
        return current;
      }

      const nextData: MapSceneData = {
        ...current,
        opportunities: nextOpportunities,
      };
      const previousSnapshot = current.sceneSnapshot ?? null;
      const nextSnapshot: MapSceneSnapshot = buildSceneSnapshotFromMapData(nextData, {
        previousSnapshot,
        sequence: previousSnapshot?.sequence,
        tick: previousSnapshot?.tick,
        serverTimeMs: previousSnapshot?.serverTimeMs ?? current.sceneServerTimeMs ?? Date.now(),
        preferEmbeddedSnapshot: false,
      }) as MapSceneSnapshot;

      if (previousSnapshot) {
        if (typeof previousSnapshot.runtimeVersion === "number") {
          nextSnapshot.runtimeVersion = previousSnapshot.runtimeVersion;
        }
        if (typeof previousSnapshot.sceneVersion === "number") {
          nextSnapshot.sceneVersion = previousSnapshot.sceneVersion;
        }
        if (typeof previousSnapshot.entitiesRevision === "number") {
          nextSnapshot.entitiesRevision = previousSnapshot.entitiesRevision;
        }
        if (typeof previousSnapshot.connectionSequence === "number") {
          nextSnapshot.connectionSequence = previousSnapshot.connectionSequence;
        }
        if ("subscribedSectorKeys" in previousSnapshot && Array.isArray(previousSnapshot.subscribedSectorKeys)) {
          nextSnapshot.subscribedSectorKeys = [...previousSnapshot.subscribedSectorKeys];
        }
      }

      return {
        ...nextData,
        sceneSnapshot: nextSnapshot,
      };
    });
  }, []);

  const handleMapMoveEvent = useCallback(async (eventPayload: unknown) => {
    if (!eventPayload) {
      return;
    }

    removeOpportunityAtCurrentPlayerTile();

    if (isPendingAiEventData(eventPayload as EventResultData | PendingAiEventData)) {
      const pendingEvent = eventPayload as PendingAiEventData;
      setEncounterLoadingText(getEncounterLoadingText(pendingEvent.type, "initial"));
      setEncounterLoadingVisible(true);
      const switchTextTimer = window.setTimeout(() => {
        setEncounterLoadingText(getEncounterLoadingText(pendingEvent.type, "resolving"));
      }, 900);

      try {
        const res = await fetch("/api/game/map/event/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: pendingEvent.id,
            ...createActionRequestMeta({
              clientSequence: 0,
              clientSceneTick: sceneData?.sceneSnapshot?.sceneVersion ?? sceneData?.sceneSnapshot?.tick ?? 0,
            }),
          }),
        });
        const json = await res.json() as {
          success: boolean;
          error?: string;
          data?: {
            event?: EventResultData | null;
            encounterSession?: MapEncounterSessionView;
            stage?: MapEncounterStageView;
            finalEvent?: EventResultData | null;
            sessionStatus?: "active" | "completed" | "expired";
          };
        };

        if (json.success && json.data?.event) {
          setEvent(json.data.event);
          setEventOpen(true);
        } else if (json.success) {
          const encounterModal = buildEncounterModalData({
            encounterSession: json.data?.encounterSession as MapEncounterSessionView,
            stage: json.data?.stage,
            finalEvent: json.data?.finalEvent || null,
            sessionStatus: json.data?.sessionStatus || "active",
          });
          if (encounterModal) {
            setEvent(encounterModal);
            setEventOpen(true);
          } else {
            messageApi.warning("解析遭遇失败");
          }
        } else {
          messageApi.warning(json.error || "解析遭遇失败");
        }
      } catch {
        messageApi.error("解析遭遇失败");
      } finally {
        window.clearTimeout(switchTextTimer);
        setEncounterLoadingVisible(false);
        setEncounterLoadingText(getEncounterLoadingText());
      }
      return;
    }

    setEvent(eventPayload as EventResultData);
    setEventOpen(true);
  }, [messageApi, removeOpportunityAtCurrentPlayerTile, sceneData?.sceneSnapshot?.sceneVersion, sceneData?.sceneSnapshot?.tick]);

  const refreshCurrentSecretRealmPanelData = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    const silent = options?.silent ?? true;
    const force = options?.force ?? false;
    if (!shouldSyncCurrentSecretRealmPanel) {
      return false;
    }
    if (secretRealmPanelInFlightRef.current) {
      return false;
    }
    if (!force && Date.now() - secretRealmPanelLastFetchedAtRef.current < SECRET_REALM_PANEL_SYNC_INTERVAL_MS) {
      return false;
    }

    secretRealmPanelInFlightRef.current = true;
    const requestId = ++secretRealmPanelRequestIdRef.current;
    try {
      const res = await fetch("/api/game/secret-realm/current", { cache: "no-store" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: MapData["currentSecretRealm"];
      };
      if (secretRealmPanelRequestIdRef.current !== requestId) {
        return false;
      }
      if (!json.success) {
        if (!silent) {
          messageApi.warning(json.error || "刷新秘境状态失败");
        }
        return false;
      }

      secretRealmPanelLastFetchedAtRef.current = Date.now();
      startTransition(() => {
        setRawPanelData((current) => {
          if (!current && !json.data) {
            return current;
          }
          const basePanelData = current ?? EMPTY_MAP_PANEL_DATA;
          return {
            ...basePanelData,
            currentSecretRealm: json.data ?? null,
          };
        });
      });
      return true;
    } catch {
      if (!silent) {
        messageApi.error("刷新秘境状态失败");
      }
      return false;
    } finally {
      if (secretRealmPanelRequestIdRef.current === requestId) {
        secretRealmPanelInFlightRef.current = false;
      }
    }
  }, [messageApi, shouldSyncCurrentSecretRealmPanel]);

  const handleMapFetchSuccess = useCallback((nextData: MapApiData, options: { silent: boolean; didMapChange: boolean }) => {
    if (options.silent) {
      if (options.didMapChange) {
        startTransition(() => {
          setRawPanelData(null);
        });
      } else if (shouldSyncCurrentSecretRealmPanel) {
        void refreshCurrentSecretRealmPanelData({ silent: true });
      }
      return;
    }

    startTransition(() => {
      setRawPanelData((current) => pickMapPanelData(
        nextData,
        options.didMapChange ? null : current,
      ));
    });
  }, [refreshCurrentSecretRealmPanelData, shouldSyncCurrentSecretRealmPanel]);

  const worldMapColyseusAoi = useWorldMapColyseusAoi({
    enabled: WORLD_MAP_COLYSEUS_MODE !== "off" && Boolean(currentMapId && sceneData?.player.id),
    mapId: currentMapId,
    playerId: sceneData?.player.id,
    shardId: currentMapShardId,
    initialSequence: 0,
  });

  useEffect(() => {
    worldMapColyseusAoiRef.current = worldMapColyseusAoi;
  }, [worldMapColyseusAoi]);

  const socialRoomPresence = useSocialRoomPresence({
    enabled: Boolean(currentPlayerId && currentMapId),
    playerId: currentPlayerId,
    mapId: currentMapId,
    shardId: currentMapShardId,
    partyId: currentPartyId,
  });
  const {
    status: socialRoomPresenceStatus,
    repair: repairSocialRoomPresence,
  } = socialRoomPresence;

  useEffect(() => {
    if (socialRoomPresenceStatus !== "connected" || !currentPlayerId || !currentMapId) {
      return;
    }

    const repairKey = [
      currentPlayerId,
      currentMapId,
      currentMapShardId,
      currentPartyId || "",
    ].join("|");
    if (socialRoomPartyRepairKeyRef.current === repairKey) {
      return;
    }
    socialRoomPartyRepairKeyRef.current = repairKey;
    repairSocialRoomPresence();
  }, [
    currentMapId,
    currentMapShardId,
    currentPartyId,
    currentPlayerId,
    repairSocialRoomPresence,
    socialRoomPresenceStatus,
  ]);

  const handleAuthoritativeMoveForColyseus = useCallback((move: {
    from: { x: number; y: number };
    target: { x: number; y: number };
    authoritativePosition: { x: number; y: number };
    clientSequence: number;
    serverSceneTick?: number;
  }) => {
    if (WORLD_MAP_COLYSEUS_MODE === "off") {
      return;
    }

    const connection = worldMapColyseusAoiRef.current;
    const sentInput = connection?.sendMove({
      x: move.authoritativePosition.x,
      y: move.authoritativePosition.y,
      fromX: move.from.x,
      fromY: move.from.y,
    }, {
      clientSequence: move.clientSequence,
      clientSceneTick: move.serverSceneTick,
    }) ?? null;

    colyseusShadowMoveStateRef.current = {
      requestedAt: Date.now(),
      clientSequence: sentInput?.clientSequence ?? move.clientSequence,
      targetX: move.target.x,
      targetY: move.target.y,
      authoritativeX: move.authoritativePosition.x,
      authoritativeY: move.authoritativePosition.y,
      sent: Boolean(sentInput),
    };
  }, []);

  const waitForWorldMapConnection = useCallback(async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < WORLD_MAP_MOVE_CONNECTION_WAIT_MS) {
      const connection = worldMapColyseusAoiRef.current;
      if (connection?.status === "connected") {
        return connection;
      }
      await sleep(WORLD_MAP_MOVE_CONNECTION_POLL_MS);
    }
    return worldMapColyseusAoiRef.current?.status === "connected"
      ? worldMapColyseusAoiRef.current
      : null;
  }, []);

  const buildWorldMapTransportUnavailableResult = useCallback((request: Parameters<MapMoveRequestExecutor>[0]): Awaited<ReturnType<MapMoveRequestExecutor>> => ({
    success: false,
    error: "地图房间正在重连，移动未提交",
    status: 503,
    data: {
      newX: request.from.x,
      newY: request.from.y,
      acceptedClientSequence: request.clientSequence - 1,
      serverSceneTick: worldMapColyseusAoiRef.current?.serverTick || 0,
      authoritativePosition: request.from,
      transportUnavailable: true,
      resyncRequired: false,
      resyncReason: "world_map_room_reconnecting",
    },
  }), []);

  const executeColyseusMapMoveRequest = useCallback<MapMoveRequestExecutor>(async (request) => {
    if (request.stationaryInteraction) {
      const connection = worldMapColyseusAoiRef.current?.status === "connected"
        ? worldMapColyseusAoiRef.current
        : await waitForWorldMapConnection();
      const targetEntity = connection?.entities.find((entity) => (
        isInteractiveWorldMapAoiEntity(entity.kind)
        && entity.x === request.from.x
        && entity.y === request.from.y
      )) || null;
      if (!targetEntity) {
        return {
          success: true,
          status: 200,
          data: {
            newX: request.from.x,
            newY: request.from.y,
            acceptedClientSequence: request.clientSequence,
            serverSceneTick: connection?.serverTick || 0,
            authoritativePosition: request.from,
            message: "当前位置没有可交互目标",
          },
        };
      }

      const sentInteract = connection?.sendInteractAndWait({
        entityId: targetEntity.id,
        interactionType: "claim",
      }, {
        clientSequence: request.clientSequence,
        clientSceneTick: connection?.serverTick || 0,
      }) ?? null;

      if (!sentInteract) {
        return buildWorldMapTransportUnavailableResult(request);
      }

      const ack = await sentInteract.ackPromise;
      const claimed = ack.authoritativeState
        && typeof ack.authoritativeState === "object"
        && "claimed" in ack.authoritativeState
        ? ack.authoritativeState.claimed === true
        : ack.accepted;
      return {
        success: ack.accepted,
        error: ack.accepted ? undefined : (
          ack.reason === "target_missing"
            ? "机缘已消失"
            : ack.reason === "too_far"
              ? "距离目标过远"
              : ack.reason === "permission_denied"
                ? "目标区域被封锁"
                : "交互失败"
        ),
        status: ack.accepted ? 200 : 409,
        data: {
          newX: request.from.x,
          newY: request.from.y,
          message: ack.accepted ? (claimed ? "机缘已收入囊中" : "已确认地图事件") : undefined,
          acceptedClientSequence: ack.acceptedSequence,
          serverSceneTick: ack.serverTick,
          sceneVersion: ack.serverTick,
          serverTimeMs: Date.now(),
          authoritativePosition: request.from,
          resyncRequired: !ack.accepted && ack.reason === "stale_state",
          resyncReason: ack.reason,
        },
      };
    }

    const connection = worldMapColyseusAoiRef.current?.status === "connected"
      ? worldMapColyseusAoiRef.current
      : await waitForWorldMapConnection();
    const sentMove = connection?.sendMoveAndWait({
      x: request.target.x,
      y: request.target.y,
      fromX: request.from.x,
      fromY: request.from.y,
    }, {
      clientSequence: request.clientSequence,
      clientSceneTick: connection.serverTick,
    }) ?? null;

    if (!sentMove) {
      return buildWorldMapTransportUnavailableResult(request);
    }

    const ack = await sentMove.ackPromise;
    const authoritativePosition = ack.authoritativeState
      && typeof ack.authoritativeState.x === "number"
      && typeof ack.authoritativeState.y === "number"
      ? {
        x: ack.authoritativeState.x,
        y: ack.authoritativeState.y,
      }
      : request.from;

    return {
      success: ack.accepted,
      error: ack.accepted ? undefined : (
        ack.reason === "too_far"
          ? "移动距离过远，已按服务端位置纠偏"
          : ack.reason === "blocked"
            ? "目标位置被阻挡"
            : ack.reason === "out_of_bounds"
              ? "目标位置超出地图边界"
              : ack.reason === "persist_failed"
                ? "移动落账失败，请稍后重试"
                : "无法移动"
      ),
      status: ack.accepted ? 200 : 409,
      data: {
        newX: authoritativePosition.x,
        newY: authoritativePosition.y,
        acceptedClientSequence: ack.acceptedSequence,
        serverSceneTick: ack.serverTick,
        sceneVersion: ack.serverTick,
        serverTimeMs: Date.now(),
        authoritativePosition,
        resyncRequired: !ack.accepted && ack.reason === "stale_state",
        resyncReason: ack.reason,
      },
    };
  }, [buildWorldMapTransportUnavailableResult, waitForWorldMapConnection]);

  const {
    dataRef,
    partySnapshotRef,
    predictedPlayerPositionRef,
    getPlannedPlayerPosition,
    handleMove: handleMapMove,
    handleStationaryInteract,
    fetchMap: fetchMapData,
    previousSceneSnapshot,
    selfRenderCorrection,
  } = useMapSceneController<MapSceneData, MapApiData>({
    data: sceneData,
    partySnapshot,
    setData: setSceneData,
    setLoading,
    setMoving,
    filterVisibleMapData,
    buildSceneSnapshotFromMapData,
    resolveMovePath: buildQueuedMapMovePath,
    onMoveEvent: handleMapMoveEvent,
    messageApi,
    extractSceneData: pickMapSceneData,
    onFetchSuccess: handleMapFetchSuccess,
    onAuthoritativeMove: handleAuthoritativeMoveForColyseus,
    executeMoveRequest: executeColyseusMapMoveRequest,
  });
  const fetchMap = fetchMapData;
  const {
    status: worldMapColyseusAoiStatus,
    mapId: worldMapColyseusAoiMapId,
    serverTick: worldMapColyseusAoiServerTick,
    snapshotVersion: worldMapColyseusAoiSnapshotVersion,
    subscribedSectorKeys: worldMapColyseusAoiSubscribedSectorKeys,
    entities: worldMapColyseusAoiEntities,
    lastAck: worldMapColyseusAoiLastAck,
    weakNetwork: worldMapColyseusAoiWeakNetwork,
    sendRepair: sendWorldMapColyseusRepair,
  } = worldMapColyseusAoi;
  const handleWorldMapColyseusRepair = useCallback(() => {
    sendWorldMapColyseusRepair("manual", "phaser_status_tap");
  }, [sendWorldMapColyseusRepair]);

  useEffect(() => {
    const shadowMove = colyseusShadowMoveStateRef.current;
    if (!shadowMove?.sent || !currentPlayerId || worldMapColyseusAoiStatus !== "connected") {
      return;
    }

    const selfEntity = worldMapColyseusAoiEntities.find((entity) => (
      entity.kind === "player"
      && entity.id === currentPlayerId
    ));
    if (!selfEntity) {
      return;
    }

    const driftX = Math.abs(selfEntity.x - shadowMove.authoritativeX);
    const driftY = Math.abs(selfEntity.y - shadowMove.authoritativeY);
    if (driftX === 0 && driftY === 0) {
      colyseusShadowMoveStateRef.current = null;
      return;
    }

    const now = Date.now();
    if (now - shadowMove.requestedAt < WORLD_MAP_COLYSEUS_SHADOW_DRIFT_GRACE_MS) {
      return;
    }
    if (now - colyseusShadowDriftRepairAtRef.current < WORLD_MAP_COLYSEUS_SHADOW_DRIFT_REPAIR_INTERVAL_MS) {
      return;
    }

    colyseusShadowDriftRepairAtRef.current = now;
    console.warn("[map] colyseus shadow position drift", {
      playerId: currentPlayerId,
      clientSequence: shadowMove.clientSequence,
      target: { x: shadowMove.targetX, y: shadowMove.targetY },
      legacyAuthoritative: {
        x: shadowMove.authoritativeX,
        y: shadowMove.authoritativeY,
      },
      colyseusAuthoritative: {
        x: selfEntity.x,
        y: selfEntity.y,
      },
      drift: { x: driftX, y: driftY },
    });
    sendWorldMapColyseusRepair("server_request", "shadow_position_drift");
  }, [
    currentPlayerId,
    sendWorldMapColyseusRepair,
    worldMapColyseusAoiEntities,
    worldMapColyseusAoiStatus,
  ]);

  const mapViewData = useMemo(() => {
    if (!data) {
      return null;
    }

    return buildMapSceneDataWithColyseusAoi({
      data,
      aoi: {
        status: worldMapColyseusAoiStatus,
        mapId: worldMapColyseusAoiMapId,
        serverTick: worldMapColyseusAoiServerTick,
        snapshotVersion: worldMapColyseusAoiSnapshotVersion,
        subscribedSectorKeys: worldMapColyseusAoiSubscribedSectorKeys,
        entities: worldMapColyseusAoiEntities,
      },
      previousSnapshot: colyseusSceneSnapshotRef.current
        ?? data.sceneSnapshot
        ?? previousSceneSnapshot,
    }) ?? data;
  }, [
    data,
    previousSceneSnapshot,
    worldMapColyseusAoiEntities,
    worldMapColyseusAoiMapId,
    worldMapColyseusAoiServerTick,
    worldMapColyseusAoiSnapshotVersion,
    worldMapColyseusAoiStatus,
    worldMapColyseusAoiSubscribedSectorKeys,
  ]);

  useEffect(() => {
    if (mapViewData?.sceneSnapshot?.mode !== "sector_snapshot") {
      return;
    }
    colyseusSceneSnapshotRef.current = mapViewData.sceneSnapshot;
  }, [mapViewData?.sceneSnapshot]);

  useEffect(() => {
    colyseusSceneSnapshotRef.current = null;
  }, [currentMapId]);

  const fetchPartySnapshot = useCallback(async (silent = true) => {
    if (silent && Date.now() - partySnapshotLastFetchedAtRef.current < PARTY_SILENT_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    if (partySnapshotInFlightRef.current) {
      if (!silent) {
        partySnapshotQueuedRef.current = true;
      }
      return;
    }

    partySnapshotInFlightRef.current = true;
    const shouldShowLoading = !silent || partySnapshotRef.current === null;
    if (shouldShowLoading) {
      setPartyLoading(true);
    }
    try {
      const res = await fetch("/api/game/social/party", { cache: "no-store" });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: PartySnapshot;
      };
      if (json.success && json.data) {
        partySnapshotLastFetchedAtRef.current = Date.now();
        setPartySnapshot(json.data);
        return;
      }
      if (!silent) {
        messageApi.warning(json.error || "刷新队伍信息失败");
      }
    } catch {
      if (!silent) {
        messageApi.error("刷新队伍信息失败");
      }
    } finally {
      partySnapshotInFlightRef.current = false;
      if (shouldShowLoading) {
        setPartyLoading(false);
      }
      if (partySnapshotQueuedRef.current) {
        partySnapshotQueuedRef.current = false;
        if (partySnapshotQueuedTimerRef.current !== null) {
          window.clearTimeout(partySnapshotQueuedTimerRef.current);
        }
        partySnapshotQueuedTimerRef.current = window.setTimeout(() => {
          partySnapshotQueuedTimerRef.current = null;
          void fetchPartySnapshot();
        }, PARTY_SILENT_REFRESH_MIN_INTERVAL_MS);
      }
    }
  }, [messageApi, partySnapshotRef]);

  useEffect(() => { void fetchPartySnapshot(); }, [fetchPartySnapshot]);

  useEffect(() => (
    () => {
      if (partySnapshotQueuedTimerRef.current !== null) {
        window.clearTimeout(partySnapshotQueuedTimerRef.current);
        partySnapshotQueuedTimerRef.current = null;
      }
    }
  ), []);

  useEffect(() => {
    pageVisibleRef.current = isDocumentVisible();

    const syncVisibility = () => {
      pageVisibleRef.current = isDocumentVisible();
      if (pageVisibleRef.current) {
        void fetchPartySnapshot();
        void refreshCurrentSecretRealmPanelData({ silent: true, force: true });
      }
    };

    const handleVisibilityChange = () => {
      if (!isDocumentVisible()) {
        pageVisibleRef.current = false;
        return;
      }
      syncVisibility();
    };

    window.addEventListener("focus", syncVisibility);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", syncVisibility);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchPartySnapshot, refreshCurrentSecretRealmPanelData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!pageVisibleRef.current) {
        return;
      }
      void fetchPartySnapshot();
    }, partyPollInterval);

    return () => window.clearInterval(timer);
  }, [fetchPartySnapshot, partyPollInterval]);

  useEffect(() => {
    if (!shouldSyncCurrentSecretRealmPanel) {
      return;
    }

    void refreshCurrentSecretRealmPanelData({ silent: true, force: true });
    const timer = window.setInterval(() => {
      if (!pageVisibleRef.current) {
        return;
      }
      void refreshCurrentSecretRealmPanelData({ silent: true });
    }, SECRET_REALM_PANEL_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refreshCurrentSecretRealmPanelData, shouldSyncCurrentSecretRealmPanel]);

  const showTemporaryHongmengAnnouncement = useCallback((content: string) => {
    const normalizedContent = String(content || "").trim();
    if (!normalizedContent) {
      return;
    }

    if (temporaryAnnouncementTimerRef.current !== null) {
      window.clearTimeout(temporaryAnnouncementTimerRef.current);
      temporaryAnnouncementTimerRef.current = null;
    }

    setTemporaryAnnouncement({
      id: `${Date.now()}:${normalizedContent}`,
      content: normalizedContent,
    });

    temporaryAnnouncementTimerRef.current = window.setTimeout(() => {
      setTemporaryAnnouncement((current) => (
        current?.content === normalizedContent ? null : current
      ));
      temporaryAnnouncementTimerRef.current = null;
    }, HONGMENG_ANNOUNCEMENT_DURATION_MS);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof openJsonEventStream<ChatAnnouncementSseEvent>> | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const clearRetryTimer = () => {
      if (retryTimer === null) {
        return;
      }
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      channel?.close();
      channel = openJsonEventStream<ChatAnnouncementSseEvent>({
        url: "/api/game/chat/sse",
        onMessage: (payload) => {
          if (!isHongmengTreasureAnnouncementMessage(payload)) {
            return;
          }

          const messageId = Number(payload.data.id || 0);
          if (messageId > 0 && messageId <= latestHongmengAnnouncementIdRef.current) {
            return;
          }

          const createdAtMs = Date.parse(payload.data.createdAt || "");
          if (
            Number.isFinite(createdAtMs)
            && (Date.now() - createdAtMs) > HONGMENG_ANNOUNCEMENT_RECENT_WINDOW_MS
          ) {
            latestHongmengAnnouncementIdRef.current = Math.max(latestHongmengAnnouncementIdRef.current, messageId);
            return;
          }

          latestHongmengAnnouncementIdRef.current = Math.max(latestHongmengAnnouncementIdRef.current, messageId);
          showTemporaryHongmengAnnouncement(payload.data.content);
        },
        onError: () => {
          channel?.close();
          channel = null;
          if (closed || retryTimer !== null) {
            return;
          }
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (!closed) {
              connect();
            }
          }, 2000);
        },
      });
    };

    connect();

    return () => {
      closed = true;
      clearRetryTimer();
      channel?.close();
      channel = null;
    };
  }, [showTemporaryHongmengAnnouncement]);

  useEffect(() => {
    return () => {
      if (temporaryAnnouncementTimerRef.current !== null) {
        window.clearTimeout(temporaryAnnouncementTimerRef.current);
        temporaryAnnouncementTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!activeEncounter?.routePath || !currentPlayerId) {
      pendingEncounterRedirectRef.current = null;
      return;
    }

    if (activeEncounter.status !== "ongoing" || activeEncounter.state?.status !== "ongoing") {
      pendingEncounterRedirectRef.current = null;
      return;
    }

    if (!activeEncounter.eligibleMemberIds.includes(currentPlayerId)) {
      pendingEncounterRedirectRef.current = null;
      return;
    }

    const nextRoute = normalizeRoutePath(activeEncounter.routePath);
    const currentRoute = normalizeRoutePath(pathname || "/");
    const redirectGuard = readInvalidBossEncounterRedirectGuard();

    if (redirectGuard) {
      const matchesGuard = redirectGuard.encounterId === activeEncounter.id || redirectGuard.routePath === nextRoute;
      if (matchesGuard) {
        pendingEncounterRedirectRef.current = null;
        return;
      }
      clearInvalidBossEncounterRedirectGuard();
    }

    if (nextRoute === currentRoute) {
      pendingEncounterRedirectRef.current = null;
      return;
    }

    if (pendingEncounterRedirectRef.current === nextRoute) {
      return;
    }

    pendingEncounterRedirectRef.current = nextRoute;
    router.replace(activeEncounter.routePath);
  }, [activeEncounter, currentPlayerId, pathname, router]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const persistedViewSize = readPersistedViewSize();
    const nextViewSize = normalizeViewSize(
      initializedViewSizeRef.current
        ? viewSize
        : persistedViewSize ?? viewSizeRange.recommended,
      viewSizeRange.min,
      viewSizeRange.max,
    );

    initializedViewSizeRef.current = true;
    if (nextViewSize !== viewSize) {
      setViewSize(nextViewSize);
    }
    persistViewSize(nextViewSize);
  }, [data, viewSize, viewSizeRange.max, viewSizeRange.min, viewSizeRange.recommended]);

  useEffect(() => {
    if (!encounterLoadingVisible) {
      setEncounterLoadingDots("");
      return;
    }

    const timer = window.setInterval(() => {
      setEncounterLoadingDots((prev) => (prev.length >= 3 ? "" : `${prev}.`));
    }, 250);

    return () => window.clearInterval(timer);
  }, [encounterLoadingVisible]);

  const changeViewSize = useCallback((delta: number) => {
    setViewSize((prev) => {
      const nextViewSize = normalizeViewSize(
        prev + delta,
        viewSizeRange.min,
        viewSizeRange.max,
      );
      persistViewSize(nextViewSize);
      return nextViewSize;
    });
  }, [viewSizeRange.max, viewSizeRange.min]);

  const handleLogout = useCallback(() => {
    if (logoutLoading) return;

    modal.confirm({
      title: "离开地图？",
      content: "现在离开会中断当前实时场景连接，是否继续？",
      okText: "确认离开",
      cancelText: "继续停留",
      okButtonProps: { danger: true },
      async onOk() {
        setLogoutLoading(true);
        try {
          const res = await fetch("/api/auth/logout", { method: "POST" });
          const json = await res.json();
          if (json.success) {
            messageApi.success("已退出登录");
            router.push("/login");
            return;
          }
          messageApi.error(json.error || "退出登录失败");
        } catch {
          messageApi.error("退出登录失败");
        } finally {
          setLogoutLoading(false);
        }
      },
    });
  }, [logoutLoading, messageApi, modal, router]);

  const handleTravel = useCallback(async (targetMapId: string, targetMapName: string) => {
    if (moving || !data) return;
    if (currentTravelMode === "portal" && !isPortalTileAtPosition({
      tiles: data.map.tilesData,
      x: data.player.positionX,
      y: data.player.positionY,
    })) {
      messageApi.warning("请先站上传送阵，再前往其他地图。");
      return;
    }
    setMoving(true);
    try {
      const res = await fetch("/api/game/map/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: targetMapId,
          ...createActionRequestMeta({
            clientSequence: 0,
            clientSceneTick: sceneData?.sceneSnapshot?.sceneVersion ?? sceneData?.sceneSnapshot?.tick ?? 0,
          }),
        }),
      });
      const json = await res.json();
      if (json.success) {
        messageApi.success(`已前往 ${targetMapName}`);
        await fetchMap();
      } else {
        messageApi.warning(json.error || "前往目标地图失败");
      }
    } catch {
      messageApi.error("前往目标地图失败");
    } finally {
      setMoving(false);
    }
  }, [
    moving,
    currentTravelMode,
    data,
    messageApi,
    fetchMap,
    sceneData?.sceneSnapshot?.sceneVersion,
    sceneData?.sceneSnapshot?.tick,
  ]);

  const handleEnterSecretRealm = useCallback(async (spawnId: string, realmName: string) => {
    if (moving) {
      return;
    }

    setMoving(true);
    try {
      const res = await fetch("/api/game/secret-realm/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spawnId }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success(`已进入 ${realmName}`);
        await fetchMap();
      } else {
        messageApi.warning(json.error || "进入秘境失败");
      }
    } catch {
      messageApi.error("进入秘境失败");
    } finally {
      setMoving(false);
    }
  }, [fetchMap, messageApi, moving]);

  const handleLeaveSecretRealm = useCallback(async () => {
    if (moving) {
      return;
    }

    setMoving(true);
    try {
      const res = await fetch("/api/game/secret-realm/leave", {
        method: "POST",
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };
      if (json.success) {
        messageApi.success("已离开秘境");
        await fetchMap();
      } else {
        messageApi.warning(json.error || "离开秘境失败");
      }
    } catch {
      messageApi.error("离开秘境失败");
    } finally {
      setMoving(false);
    }
  }, [fetchMap, messageApi, moving]);

  const handleEncounterChoice = useCallback(async (choiceId: string) => {
    if (!event || !isEncounterStageModalData(event) || encounterChoiceLoading) {
      return;
    }

    setEncounterChoiceLoading(true);
    try {
      const res = await fetch("/api/game/map/event/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: event.encounterSession.sessionId,
          choiceId,
          ...createActionRequestMeta({
            clientSequence: 0,
            clientSceneTick: sceneData?.sceneSnapshot?.sceneVersion ?? sceneData?.sceneSnapshot?.tick ?? 0,
          }),
        }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        data?: {
          encounterSession?: MapEncounterSessionView;
          stage?: MapEncounterStageView;
          finalEvent?: EventResultData | null;
          sessionStatus?: "active" | "completed" | "expired";
        };
      };
      if (!json.success) {
        messageApi.warning(json.error || "推进奇遇失败");
        return;
      }

      const nextEvent = buildEncounterModalData({
        encounterSession: json.data?.encounterSession as MapEncounterSessionView,
        stage: json.data?.stage,
        finalEvent: json.data?.finalEvent || null,
        sessionStatus: json.data?.sessionStatus || "active",
      });
      if (!nextEvent) {
        messageApi.warning("奇遇后续未返回有效内容");
        return;
      }

      setEvent(nextEvent);
      setEventOpen(true);
    } catch {
      messageApi.error("推进奇遇失败");
    } finally {
      setEncounterChoiceLoading(false);
    }
  }, [
    encounterChoiceLoading,
    event,
    messageApi,
    sceneData?.sceneSnapshot?.sceneVersion,
    sceneData?.sceneSnapshot?.tick,
  ]);

  const handleEventModalClose = useCallback(() => {
    if (isEncounterStageModalData(event)) {
      return;
    }
    setEventOpen(false);
    setEncounterChoiceLoading(false);

    const actions = event?.rewards?.actions || [];
    const battlePath = actions
      .filter((action) => action.type === "battle")
      .map((action) => String(action.navigatePath || "").trim())
      .find((path) => path.startsWith("/game/"));
    if (battlePath) {
      router.push(battlePath);
      return;
    }

    const hasTeleportAction = actions.some((action) => action.type === "teleport");
    if (hasTeleportAction) {
      void fetchMap();
      return;
    }
    void fetchMap({ silent: true, reason: "event_modal_close" });
  }, [event, fetchMap, router]);

  const handleAssassinationChoice = useCallback(async (action: "escape" | "fight") => {
    if (!pendingAssassinationModal || assassinationActionLoading) {
      return;
    }

    setAssassinationActionLoading(action);
    try {
      const response = await fetch("/api/game/world/assassination/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: pendingAssassinationModal.id,
          action,
        }),
      });
      const json = await response.json() as {
        success?: boolean;
        error?: string;
        data?: {
          escaped?: boolean;
          combatRequired?: boolean;
          narrative?: string;
          worldAssassinationId?: string | null;
          monsterId?: string | null;
        };
      };
      if (!json.success || !json.data) {
        messageApi.warning(json.error || "应对刺杀失败");
        return;
      }

      const narrative = String(json.data.narrative || "").trim();
      if (json.data.escaped) {
        if (narrative) {
          messageApi.success(narrative);
        }
        setPendingAssassinationModal(null);
        await fetchMap({ silent: true, reason: "assassination_escape" });
        return;
      }

      if (json.data.combatRequired && json.data.monsterId && json.data.worldAssassinationId) {
        if (narrative) {
          if (action === "escape") {
            messageApi.warning(narrative);
          } else {
            messageApi.info(narrative);
          }
        }
        setPendingAssassinationModal(null);
        router.push(
          `/game/combat/${json.data.monsterId}?worldAssassinationId=${encodeURIComponent(json.data.worldAssassinationId)}`,
        );
        return;
      }

      messageApi.warning("刺杀局势未能正确推进，请稍后重试。");
    } catch {
      messageApi.error("应对刺杀失败");
    } finally {
      setAssassinationActionLoading(null);
    }
  }, [assassinationActionLoading, fetchMap, messageApi, pendingAssassinationModal, router]);
  const handleWorldOfferResponse = useCallback(async (offerId: string, action: "accept" | "reject") => {
    if (worldOfferActionLoadingId) {
      return;
    }

    setWorldOfferActionLoadingId(offerId);
    try {
      const response = await fetch(`/api/game/world/event-offers/${encodeURIComponent(offerId)}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: {
          resultSummary?: string;
        };
      };
      if (!json.success) {
        messageApi.warning(json.error || "处理暗线来信失败");
        return;
      }
      setWorldEventOffers((current) => current.filter((offer) => offer.id !== offerId));
      messageApi.success(json.data?.resultSummary || (action === "accept" ? "你接下了这封暗线来信。" : "你回绝了这封暗线来信。"));
      if (sceneData?.map.mapType === "open_world") {
        void fetchWorldIntelDetails({ force: true });
      }
      void fetchMap({ silent: true, reason: "world_offer_response" });
    } catch {
      messageApi.warning("处理暗线来信失败");
    } finally {
      setWorldOfferActionLoadingId(null);
    }
  }, [fetchMap, fetchWorldIntelDetails, messageApi, sceneData?.map.mapType, worldOfferActionLoadingId]);
  const handleWorldContractAdvance = useCallback(async (offerId: string) => {
    if (worldContractActionLoadingId) {
      return;
    }

    setWorldContractActionLoadingId(offerId);
    try {
      const response = await fetch(`/api/game/world/contracts/${encodeURIComponent(offerId)}/advance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: {
          completed?: boolean;
          resultSummary?: string;
        };
      };
      if (!json.success) {
        messageApi.warning(json.error || "推进街区目标失败");
        return;
      }
      messageApi.success(json.data?.resultSummary || "街区目标已推进。");
      if (sceneData?.map.mapType === "open_world") {
        void fetchWorldIntelDetails({ force: true });
      }
      void fetchMap({ silent: true, reason: "world_contract_advance" });
    } catch {
      messageApi.warning("推进街区目标失败");
    } finally {
      setWorldContractActionLoadingId(null);
    }
  }, [fetchMap, fetchWorldIntelDetails, messageApi, sceneData?.map.mapType, worldContractActionLoadingId]);
  const handleAdvanceWorldStoryline = useCallback(async (storylineId: string) => {
    if (worldStorylineActionLoadingId) {
      return;
    }

    setWorldStorylineActionLoadingId(storylineId);
    try {
      const response = await fetch(`/api/game/world/storylines/${encodeURIComponent(storylineId)}/advance`, {
        method: "POST",
      });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: {
          stageTitle?: string;
          summary?: string;
          completed?: boolean;
        };
      };
      if (!json.success) {
        messageApi.warning(json.error || "推进街区故事链失败");
        return;
      }
      messageApi.success(
        json.data?.completed
          ? (json.data?.summary || "这条街区故事链已经收束。")
          : (json.data?.summary || json.data?.stageTitle || "这条街区故事链又往前滑了一步。"),
      );
      if (sceneData?.map.mapType === "open_world") {
        void fetchWorldIntelDetails({ force: true });
      }
      void fetchMap({ silent: true, reason: "world_storyline_advance" });
    } catch {
      messageApi.warning("推进街区故事链失败");
    } finally {
      setWorldStorylineActionLoadingId(null);
    }
  }, [fetchMap, fetchWorldIntelDetails, messageApi, sceneData?.map.mapType, worldStorylineActionLoadingId]);
  const handleAdultInviteResponse = useCallback(async (params: {
    npcId: string;
    eventLogId: string;
    decision: "accept" | "reject" | "counter_drain" | "ignore";
  }) => {
    if (adultInviteActionLoadingId) {
      return;
    }

    setAdultInviteActionLoadingId(params.eventLogId);
    try {
      const response = await fetch(`/api/game/world/npc/${encodeURIComponent(params.npcId)}/adult-resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventLogId: params.eventLogId,
          decision: params.decision,
        }),
      });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: {
          accepted: boolean;
          title?: string;
          summary?: string;
          atmosphere?: string;
          worldConsequence?: string;
          changeHints?: string[];
          pregnancy?: {
            triggered: boolean;
            summary: string;
          } | null;
        };
      };
      if (!json.success || !json.data) {
        messageApi.warning(json.error || "处理邀约失败");
        return;
      }

      setRawPanelData((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          adultInvites: Array.isArray(current.adultInvites)
            ? current.adultInvites.filter((invite) => invite.eventLogId !== params.eventLogId)
            : [],
        };
      });
      setAdultInviteDetail((current) => (
        current?.eventLogId === params.eventLogId ? null : current
      ));

      modal.info({
        title: json.data.title || "互动结果",
        width: "min(520px, calc(100vw - 24px))",
        okText: "知道了",
        content: (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text style={{ color: "#d7dfef" }}>{json.data.summary || "这次互动已经处理完毕。"}</Text>
            {json.data.atmosphere ? (
              <Text style={{ color: "#8f96ab", fontSize: 12 }}>{json.data.atmosphere}</Text>
            ) : null}
            {json.data.worldConsequence ? (
              <Text style={{ color: "#d7b76f", fontSize: 12 }}>{json.data.worldConsequence}</Text>
            ) : null}
            {Array.isArray(json.data.changeHints) && json.data.changeHints.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {json.data.changeHints.slice(0, 3).map((hint) => (
                  <Text key={hint} style={{ color: "#c8d2f0", fontSize: 12 }}>
                    {hint}
                  </Text>
                ))}
              </div>
            ) : null}
            {json.data.pregnancy?.summary ? (
              <Text style={{ color: "#d9a063", fontSize: 12 }}>{json.data.pregnancy.summary}</Text>
            ) : null}
          </Space>
        ),
      });

      void fetchMap({ silent: true, reason: "adult_invite_resolve" });
    } catch {
      messageApi.warning("处理邀约失败");
    } finally {
      setAdultInviteActionLoadingId(null);
    }
  }, [adultInviteActionLoadingId, fetchMap, messageApi, modal]);

  const handleViewPlayer = useCallback(async (playerId: string) => {
    const requestId = playerProfileRequestIdRef.current + 1;
    playerProfileRequestIdRef.current = requestId;
    playerProfileAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    playerProfileAbortControllerRef.current = abortController;

    const cachedProfile = playerProfileCacheRef.current.get(playerId) || null;

    setPlayerProfileOpen(true);
    setPlayerProfileLoading(!cachedProfile);
    setFriendApplyLoading(false);
    setDoubleCultivationRequestLoading(false);
    setPvpLoading(false);
    setPlayerProfile(cachedProfile);

    try {
      const profileResult = await fetch(`/api/game/player/${playerId}`, {
        cache: "no-store",
        signal: abortController.signal,
      });

      if (playerProfileRequestIdRef.current !== requestId) {
        return;
      }

      const profileJson = await profileResult.json() as {
        success: boolean;
        error?: string;
        data?: NearbyPlayerProfile;
      };

      if (playerProfileRequestIdRef.current !== requestId) {
        return;
      }

      if (profileJson?.success && profileJson.data) {
        playerProfileCacheRef.current.set(playerId, profileJson.data);
        setPlayerProfile(profileJson.data);
      } else if (!cachedProfile) {
        setPlayerProfile(null);
        messageApi.warning(profileJson?.error || "加载角色信息失败");
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        return;
      }
      messageApi.error("加载角色信息失败");
    } finally {
      if (playerProfileRequestIdRef.current === requestId) {
        playerProfileAbortControllerRef.current = null;
        setPlayerProfileLoading(false);
      }
    }
  }, [messageApi]);

  useEffect(() => (
    () => {
      playerProfileAbortControllerRef.current?.abort();
    }
  ), []);

  const handleApplyFriend = useCallback(async () => {
    if (!playerProfile || friendApplyLoading) return;

    setFriendApplyLoading(true);
    try {
      const res = await fetch("/api/game/social/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId: playerProfile.id }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success(`已向 ${playerProfile.name} 发送好友申请`);
      } else {
        messageApi.warning(json.error || "发送好友申请失败");
      }
    } catch {
      messageApi.error("发送好友申请失败");
    } finally {
      setFriendApplyLoading(false);
    }
  }, [friendApplyLoading, messageApi, playerProfile]);

  const handleInviteParty = useCallback(async () => {
    if (!playerProfile || partyInviteLoading) {
      return;
    }

    setPartyInviteLoading(true);
    try {
      const res = await fetch("/api/game/social/party/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId: playerProfile.id }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success(`已向 ${playerProfile.name} 发出组队邀请`);
        void fetchPartySnapshot();
      } else {
        messageApi.warning(json.error || "发送组队邀请失败");
      }
    } catch {
      messageApi.error("发送组队邀请失败");
    } finally {
      setPartyInviteLoading(false);
    }
  }, [fetchPartySnapshot, messageApi, partyInviteLoading, playerProfile]);

  const handleRequestDoubleCultivation = useCallback(async () => {
    if (!playerProfile || doubleCultivationRequestLoading) {
      return;
    }

    setDoubleCultivationRequestLoading(true);
    try {
      const res = await fetch("/api/game/double-cultivation/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId: playerProfile.id }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success(`已向 ${playerProfile.name} 发出双修申请`);
      } else {
        messageApi.warning(json.error || "发起双修申请失败");
      }
    } catch {
      messageApi.error("发起双修申请失败");
    } finally {
      setDoubleCultivationRequestLoading(false);
    }
  }, [doubleCultivationRequestLoading, messageApi, playerProfile]);

  const handleOpenPrivateChat = useCallback(() => {
    if (!playerProfile?.id) {
      return;
    }

    setPlayerProfileOpen(false);
    router.push(`/game/chat?tab=dm&targetPlayerId=${encodeURIComponent(playerProfile.id)}`);
  }, [playerProfile, router]);

  const handleStartPvp = useCallback(async () => {
    if (!playerProfile || pvpLoading) return;
    if (!pvpEnabledOnCurrentMap) {
      messageApi.warning("当前地图未开放切磋");
      return;
    }

    setPvpLoading(true);
      try {
        const res = await fetch("/api/game/pvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPlayerId: playerProfile.id }),
        });
        const json = await res.json() as {
          success: boolean;
          error?: string;
          data?: {
            combatId?: string;
          };
        };

        if (!json.success || !json.data?.combatId) {
          messageApi.warning(json.error || "发起切磋失败");
          return;
        }

        setPlayerProfileOpen(false);
        router.push(`/game/pvp/${encodeURIComponent(json.data.combatId)}`);
      } catch {
        messageApi.error("发起切磋失败");
      } finally {
        setPvpLoading(false);
      }
    }, [messageApi, playerProfile, pvpEnabledOnCurrentMap, pvpLoading, router]);

  const handleRespondPartyInvite = useCallback(async (inviteId: string, accept: boolean) => {
    const loadingKey = `respond:${inviteId}:${accept ? "accept" : "reject"}`;
    setPartyActionLoadingKey(loadingKey);
    try {
      const res = await fetch("/api/game/social/party/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, accept }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success(accept ? "已接受组队邀请" : "已拒绝组队邀请");
        void fetchPartySnapshot(false);
      } else {
        messageApi.warning(json.error || "处理组队邀请失败");
      }
    } catch {
      messageApi.error("处理组队邀请失败");
    } finally {
      setPartyActionLoadingKey(null);
    }
  }, [fetchPartySnapshot, messageApi]);

  const handleLeaveParty = useCallback(async () => {
    setPartyActionLoadingKey("leave");
    try {
      const res = await fetch("/api/game/social/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success("已离开队伍");
        void fetchPartySnapshot(false);
      } else {
        messageApi.warning(json.error || "离开队伍失败");
      }
    } catch {
      messageApi.error("离开队伍失败");
    } finally {
      setPartyActionLoadingKey(null);
    }
  }, [fetchPartySnapshot, messageApi]);

  const handleKickPartyMember = useCallback(async (targetPlayerId: string) => {
    const loadingKey = `kick:${targetPlayerId}`;
    setPartyActionLoadingKey(loadingKey);
    try {
      const res = await fetch("/api/game/social/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kick", targetPlayerId }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
      };

      if (json.success) {
        messageApi.success("已移出队员");
        void fetchPartySnapshot(false);
      } else {
        messageApi.warning(json.error || "移出队员失败");
      }
    } catch {
      messageApi.error("移出队员失败");
    } finally {
      setPartyActionLoadingKey(null);
    }
  }, [fetchPartySnapshot, messageApi]);

  const handleMonsterInteract = useCallback((monster: {
    id: string;
    name: string;
    monsterType: string;
    level: number;
    positionX: number;
    positionY: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    drops?: {
      itemId: string;
      itemName: string;
      itemIconUrl?: string | null;
      itemRarity?: string | null;
      chance: number;
      minQuantity: number;
      maxQuantity: number;
    }[];
    dropIntel?: {
      label: string;
      rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
      rarityLabel: string;
      chanceText: string;
      quantityText: string;
    }[];
  }) => {
    const isBoss = monster.monsterType === "boss";
    const lockedSecretRealmBossMessage = isBoss
      && currentSecretRealm?.bossMonsterId === monster.id
      && currentSecretRealm.bossGateStatus
      && !currentSecretRealm.bossGateStatus.isUnlocked
      ? buildSecretRealmBossGateMessage(currentSecretRealm.bossGateStatus)
      : "";
    if (lockedSecretRealmBossMessage) {
      modal.info({
        title: `首领封印未破 · ${monster.name}`,
        okText: "知道了",
        content: (
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            <Text style={{ color: "#f0c48f", fontSize: 12 }}>
              {lockedSecretRealmBossMessage}
            </Text>
            <Text style={{ color: "#8f96ab", fontSize: 12 }}>
              可先点击 Boss 房周围的封印墙查看提示，或前往清理守卫与普通妖兽推进封印进度。
            </Text>
          </Space>
        ),
      });
      return;
    }
    const drops = monster.drops || [];
    const dropIntel = monster.dropIntel && monster.dropIntel.length > 0
      ? monster.dropIntel
      : (isBoss ? (currentSecretRealm?.dropIntelPreview || []) : []);
    const isWildWolfExtraBottle = currentSecretRealm?.specialType === "wild_wolf_valley"
      && !currentSecretRealm.wildWolfValleyBottleOwned;
    const wildWolfValleyChance = isWildWolfExtraBottle
      ? (isBoss
        ? Number(currentSecretRealm?.wildWolfValleyBossBottleChance || 0)
        : Number(currentSecretRealm?.wildWolfValleyMobBottleChance || 0))
      : 0;
    modal.confirm({
      title: `${isBoss ? "挑战首领" : "挑战妖兽"} · ${monster.name}`,
      okText: isBoss ? "进入首领战" : "开始战斗",
      cancelText: "取消",
      content: (
        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Space size={6}>
            <Text style={{ color: "#a09880", fontSize: 12 }}>怪物类型</Text>
            <DarkTag color={MONSTER_TYPE_TAG_COLORS[monster.monsterType] || "default"}>
              {MONSTER_TYPE_NAMES[monster.monsterType] || "未知怪物类型"}
            </DarkTag>
          </Space>
          <Text style={{ color: "#a09880", fontSize: 12 }}>
            等级 {monster.level}
          </Text>
          <Text style={{ color: "#e8e0d0", fontSize: 12 }}>
            气血 {monster.hp}
          </Text>
          <Text style={{ color: "#e8e0d0", fontSize: 12 }}>
            攻击 {monster.attack} / 防御 {monster.defense} / 速度 {monster.speed}
          </Text>
          <Text style={{ color: "#e8d282", fontSize: 12 }}>
            战力 {calcMonsterCombatPower(monster).toLocaleString()}
          </Text>
          <Collapse
            ghost
            size="small"
            defaultActiveKey={[]}
            items={[
              {
                key: "drops",
                label: <Text style={{ color: "#a09880", fontSize: 12 }}>可能掉落</Text>,
                children: isWildWolfExtraBottle
                  ? (
                    <Space orientation="vertical" size={3} style={{ width: "100%" }}>
                      <Text style={{ color: "#e8d282", fontSize: 12 }}>
                        未持有掌天瓶时，本次仍会掉落正常秘境奖励，并额外判定掌天瓶机缘。
                      </Text>
                      <Text style={{ color: "#ffb3b3", fontSize: 12 }}>
                        {isBoss ? "Boss" : "小怪"}额外掌天瓶概率 {formatDropChance(wildWolfValleyChance)}
                      </Text>
                      <Text style={{ color: "#8e856f", fontSize: 12 }}>
                        若已经持有掌天瓶，则只保留正常秘境掉落，不再继续判定掌天瓶。
                      </Text>
                    </Space>
                  )
                  : drops.length > 0
                  ? (
                    <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                      {drops.map((drop, index) => (
                        <Text key={`${drop.itemId}-${index}`} style={{ color: "#e8e0d0", fontSize: 12 }}>
                          <ItemBadge
                            name={drop.itemName}
                            iconUrl={drop.itemIconUrl}
                            rarity={drop.itemRarity}
                            onClick={() => setDetailItemId(drop.itemId)}
                            style={{ marginRight: 4, verticalAlign: "text-bottom" }}
                            iconSize={12}
                            showRarityLabel
                          />
                          {`概率 ${formatDropChance(drop.chance)} / 数量 `}
                          {drop.minQuantity === drop.maxQuantity ? drop.minQuantity : `${drop.minQuantity}-${drop.maxQuantity}`}
                        </Text>
                      ))}
                    </Space>
                  )
                  : dropIntel.length > 0
                    ? (
                      <Space orientation="vertical" size={3} style={{ width: "100%" }}>
                        <Text style={{ color: "#8e856f", fontSize: 12 }}>
                          秘境天机遮掩，只能窥见大致品级与类别。
                        </Text>
                        {dropIntel.map((entry, index) => (
                          <Text key={`${entry.label}-${index}`} style={{ color: getSecretRealmIntelTextColor(entry.rarity), fontSize: 12 }}>
                            {entry.chanceText} · {entry.label} · 数量 {entry.quantityText}
                          </Text>
                        ))}
                        <Text style={{ color: "#8e856f", fontSize: 12 }}>
                          {isBoss
                            ? "Boss 主要掉上品、极品，偶有仙品，并有极低概率自然掉落鸿蒙灵材。"
                            : "小怪以凡品、良品、上品、极品为主；鸿蒙材料不会在小怪结算中出现。"}
                        </Text>
                      </Space>
                    )
                    : (
                      <Text style={{ color: "#6b6355", fontSize: 12 }}>
                        {currentSecretRealm
                          ? (isBoss
                            ? "此首领多半产出上品、极品，偶有仙品，并有极低概率现出鸿蒙灵材。"
                            : "此妖兽多半产出凡品、良品灵材，偶有更高品级之物。")
                          : "暂无掉落情报。"}
                      </Text>
                    ),
              },
            ]}
          />
        </Space>
      ),
      onOk: () => {
        const monsterRouteQuery = `?mx=${monster.positionX}&my=${monster.positionY}`;
        if (isBoss) {
          router.push(`/game/boss/${monster.id}${monsterRouteQuery}`);
          return;
        }
        router.push(`/game/combat/${monster.id}${monsterRouteQuery}`);
      },
    });
  }, [currentSecretRealm, modal, router]);

  const handleMapCellClick = useCallback((cell: MapGridCellClickPayload) => {
    const currentData = dataRef.current;
    if (currentData) {
      const isCurrentTile = currentData.player.positionX === cell.x && currentData.player.positionY === cell.y;
      if (isCurrentTile) {
        const currentAoiEntity = worldMapColyseusAoiRef.current?.entities.find((entity) => (
          isInteractiveWorldMapAoiEntity(entity.kind)
          && entity.x === cell.x
          && entity.y === cell.y
        ));
        if (currentAoiEntity) {
          handleStationaryInteract(cell.x, cell.y);
          return true;
        }
        const currentOpportunity = currentData.opportunities.find((opportunity) => (
          opportunity.positionX === cell.x && opportunity.positionY === cell.y
        ));
        if (currentOpportunity) {
          handleStationaryInteract(cell.x, cell.y);
          return true;
        }
      }
    }

    if (cell.canMove) {
      return false;
    }
    if (cell.tileDescription?.includes("Boss 封印未破")) {
      messageApi.warning(
        buildSecretRealmBossGateMessage(currentSecretRealm?.bossGateStatus) || cell.tileDescription.trim(),
      );
      return true;
    }
    if (!cell.tileWalkable && cell.tileDescription?.trim()) {
      messageApi.warning(cell.tileDescription.trim());
      return true;
    }
    if (!cell.tileWalkable) {
      messageApi.warning("此处被禁制阻隔，暂时无法通行。");
      return true;
    }
    return false;
  }, [currentSecretRealm?.bossGateStatus, dataRef, handleStationaryInteract, messageApi]);

  const moveDir = useCallback((dx: number, dy: number) => {
    const currentData = dataRef.current;
    if (!currentData) {
      return;
    }

    const basePosition = getPlannedPlayerPosition() ?? predictedPlayerPositionRef.current ?? {
      x: currentData.player.positionX,
      y: currentData.player.positionY,
    };
    handleMapMove(basePosition.x + dx, basePosition.y + dy);
  }, [dataRef, getPlannedPlayerPosition, handleMapMove, predictedPlayerPositionRef]);

  // 键盘方向键和 WASD 控制移动。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case "arrowup": case "w": moveDir(0, -1); break;
        case "arrowdown": case "s": moveDir(0, 1); break;
        case "arrowleft": case "a": moveDir(-1, 0); break;
        case "arrowright": case "d": moveDir(1, 0); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveDir]);

  const adjacentEntities = useMemo(() => {
    const activeData = mapViewData ?? data;
    if (!activeData) {
      return [] as NearbyMapEntity[];
    }

    return [
      ...activeData.npcs.filter((npc) => (
        Math.max(
          Math.abs(npc.positionX - activeData.player.positionX),
          Math.abs(npc.positionY - activeData.player.positionY),
        ) <= 1
      )).map((npc) => ({ ...npc, entityType: "npc" as const })),
      ...activeData.monsters.filter((monster) => (
        Math.max(
          Math.abs(monster.positionX - activeData.player.positionX),
          Math.abs(monster.positionY - activeData.player.positionY),
        ) <= 1
      )).map((monster) => ({ ...monster, entityType: "monster" as const })),
    ];
  }, [data, mapViewData]);

  const nearbyPlayers = useMemo(() => {
    const activeData = mapViewData ?? data;
    if (!activeData) {
      return [] as MapData["otherPlayers"];
    }

    return activeData.otherPlayers.filter((player) => (
      Math.max(
        Math.abs(player.positionX - activeData.player.positionX),
        Math.abs(player.positionY - activeData.player.positionY),
      ) <= 1
    ));
  }, [data, mapViewData]);
  const openViewSettings = useCallback(() => {
    setViewSettingsOpen(true);
  }, []);
  const openSecretRealmIntel = useCallback(() => {
    setSecretRealmIntelOpen(true);
  }, []);
  const handleRefreshMap = useCallback(() => {
    void fetchMap();
  }, [fetchMap]);
  const handleOpenNearbyNpcDetail = useCallback((npc: MapData["npcs"][number]) => {
    router.push(npc.detailRoute || (npc.sourceType === "world"
      ? `/game/world/npc/${encodeURIComponent(npc.id)}`
      : `/game/npc/${encodeURIComponent(npc.id)}`));
  }, [router]);

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}><Spin size="large" /></div>;
  }

  if (!data) {
    return <div style={{ textAlign: "center", padding: 40, color: "#6b6355" }}>地图加载失败</div>;
  }
  const activeMapViewData = mapViewData ?? data;
  const activeMapPreviousSceneSnapshot = activeMapViewData.sceneSnapshot?.mode === "sector_snapshot"
    ? (colyseusSceneSnapshotRef.current ?? previousSceneSnapshot)
    : previousSceneSnapshot;
  const hasSecretRealmIntel = Boolean(currentSecretRealm || panelData.secretRealms.length > 0);
  const hasSecretRealmAttentionDot = Boolean(
    currentSecretRealm?.showAttentionDot
    || panelData.secretRealms.some((secretRealm) => secretRealm.showAttentionDot),
  );
  const canLocalMove = !partySnapshot?.party || partySnapshot.party.leaderPlayerId === data.player.id;
  const compactSceneMaxHeight = isCompactViewport
    ? Math.max(252, Math.min(336, Math.round((viewportHeight || 760) * 0.4)))
    : undefined;
  const intelCardStyle = {
    border: "1px solid rgba(100, 118, 173, 0.28)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "rgba(17, 22, 41, 0.82)",
  } as const;
  const intelActionWrapStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } as const;
  const nearbyNpcById = new Map(data.npcs.map((npc) => [npc.id, npc]));
  const activeAdultInviteById = new Map(activeAdultInvites.map((invite) => [invite.eventLogId, invite]));
  const resolveGuideCard = (guide: EventGuideCard | null | undefined): EventGuideCard | null => {
    if (!guide) {
      return null;
    }
    return {
      ...guide,
      distance: typeof guide.distance === "number"
        ? guide.distance
        : resolveEventGuideDistance(
          data.player.positionX,
          data.player.positionY,
          guide.positionX,
          guide.positionY,
        ),
    };
  };
  const buildPrimaryObjectiveGuide = () => resolveGuideCard(panelData.primaryObjective ? {
    targetLabel: panelData.primaryObjective.targetLabel,
    locationLabel: panelData.primaryObjective.locationLabel,
    actionLabel: panelData.primaryObjective.actionLabel || "按主目标往下推进",
    summary: panelData.primaryObjective.rewardPreview || panelData.primaryObjective.summary,
    positionX: panelData.primaryObjective.positionX,
    positionY: panelData.primaryObjective.positionY,
  } : null);
  const buildSecondaryHookGuide = (hook: NonNullable<MapData["secondaryHooks"]>[number]) => {
    if (hook.actionKind === "adult_invite" && hook.actionRefId) {
      const invite = activeAdultInviteById.get(hook.actionRefId) || null;
      const inviteNpc = invite ? nearbyNpcById.get(invite.npcId) || null : null;
      return resolveGuideCard({
        targetLabel: hook.targetLabel || invite?.npcName || null,
        locationLabel: hook.locationLabel || inviteNpc?.currentActionLabel || data.map.name,
        actionLabel: "先查看全文，再决定接受、婉拒或反制",
        summary: hook.guideText || (
          inviteNpc
            ? `${inviteNpc.name} 就在附近，先靠过去看清局势，再决定回不回应。`
            : "先点开邀约查看全文，再决定如何回应。"
        ),
        positionX: typeof hook.positionX === "number" ? hook.positionX : inviteNpc?.positionX ?? null,
        positionY: typeof hook.positionY === "number" ? hook.positionY : inviteNpc?.positionY ?? null,
        distance: hook.distance,
      });
    }

    return resolveGuideCard({
      targetLabel: hook.targetLabel,
      locationLabel: hook.locationLabel,
      actionLabel: hook.actionLabel || (hook.actionKind === "world_offer" ? "先回应此事，再顺着门路去办" : "查看目标"),
      summary: hook.guideText,
      positionX: hook.positionX,
      positionY: hook.positionY,
      distance: hook.distance,
    });
  };
  const buildWorldOfferGuide = (offer: WorldEventOfferData) => resolveGuideCard({
    targetLabel: offer.guideTargetLabel || offer.sourceNpcName || null,
    locationLabel: offer.guideLocationLabel || offer.storylineDistrictName || offer.sourceFaction || null,
    actionLabel: offer.guideActionLabel || (offer.guideRequiresAccept ? "先接受这封来信，再按指引去办" : "照着这条门路直接推进"),
    summary: offer.guideSummary || offer.detail,
    positionX: offer.guidePositionX,
    positionY: offer.guidePositionY,
  });
  const buildAdultInviteGuide = (invite: AdultInviteData | null | undefined) => {
    if (!invite) {
      return null;
    }
    const inviteNpc = nearbyNpcById.get(invite.npcId) || null;
    return resolveGuideCard({
      targetLabel: invite.npcName,
      locationLabel: inviteNpc?.currentActionLabel || data.map.name,
      actionLabel: "先查看全文，再决定接受、婉拒或反向诱导",
      summary: inviteNpc
        ? `${invite.npcName} 现在就在附近，你可以先过去看清情形再决定回应。`
        : "先点开邀约看清来意，再决定是否回应。",
      positionX: inviteNpc?.positionX ?? null,
      positionY: inviteNpc?.positionY ?? null,
    });
  };
  const buildWorldContractGuide = (contract: WorldContractData) => {
    const currentObjectivePoint = contract.currentObjectivePointId
      ? objectivePointById.get(contract.currentObjectivePointId) || null
      : null;
    const currentObjectivePositionX = currentObjectivePoint?.positionX ?? contract.currentObjectivePositionX ?? null;
    const currentObjectivePositionY = currentObjectivePoint?.positionY ?? contract.currentObjectivePositionY ?? null;
    const currentObjectiveOnCurrentMap = !contract.currentObjectiveMapId || contract.currentObjectiveMapId === currentMapId;
    const currentObjectiveDistance = currentObjectiveOnCurrentMap
      ? resolveEventGuideDistance(
        data.player.positionX,
        data.player.positionY,
        currentObjectivePositionX,
        currentObjectivePositionY,
      )
      : null;
    const targetNpc = contract.targetNpcId ? nearbyNpcById.get(contract.targetNpcId) || null : null;
    const targetPositionX = targetNpc?.positionX ?? contract.targetPositionX ?? null;
    const targetPositionY = targetNpc?.positionY ?? contract.targetPositionY ?? null;
    const targetOnCurrentMap = Boolean(targetNpc) || !contract.targetMapId || contract.targetMapId === currentMapId;

    if (contract.canAdvanceByObjective) {
      return resolveGuideCard({
        targetLabel: contract.currentObjectivePointLabel || contract.targetNpcName || contract.title,
        locationLabel: contract.currentObjectiveDistrictName || contract.currentObjectiveMapName || contract.targetDistrictName || contract.targetMapName || data.map.name,
        actionLabel: currentObjectiveDistance !== null && currentObjectiveDistance <= 1
          ? (contract.currentObjectiveActionLabel || "已经到位，直接推进这一步")
          : currentObjectiveOnCurrentMap
            ? `先靠近 ${contract.currentObjectivePointLabel || "目标点"}`
            : `先前往 ${contract.currentObjectiveMapName || "指定地界"}`,
        summary: currentObjectiveDistance !== null && currentObjectiveDistance <= 1
          ? "你已经站到推进范围内，可以直接把这一手做完。"
          : contract.currentObjectiveHint || contract.progressLabel,
        positionX: currentObjectiveOnCurrentMap ? currentObjectivePositionX : null,
        positionY: currentObjectiveOnCurrentMap ? currentObjectivePositionY : null,
        distance: currentObjectiveDistance,
      });
    }

    return resolveGuideCard({
      targetLabel: contract.targetNpcName || contract.currentObjectivePointLabel || contract.title,
      locationLabel: contract.targetDistrictName || contract.targetMapName || data.map.name,
      actionLabel: contract.canAdvanceByTalking
        ? `先去找 ${contract.targetNpcName || "目标人物"}`
        : (contract.actionLabel || "先查看目标再动手"),
      summary: contract.currentObjectiveHint || contract.progressLabel,
      positionX: targetOnCurrentMap ? targetPositionX : null,
      positionY: targetOnCurrentMap ? targetPositionY : null,
    });
  };
  const buildStorylineGuide = (storyline: NonNullable<MapData["activeStorylines"]>[number]) => {
    const objectivePoint = storyline.objectivePointId
      ? objectivePointById.get(storyline.objectivePointId) || null
      : null;
    const linkedNpc = storyline.linkedNpcIds
      .map((npcId) => nearbyNpcById.get(npcId) || null)
      .find((npc): npc is MapData["npcs"][number] => Boolean(npc));
    const objectiveMapId = storyline.objectiveMapId || storyline.mapId;
    const objectiveOnCurrentMap = !objectiveMapId || objectiveMapId === currentMapId;
    const objectivePositionX = objectivePoint?.positionX ?? storyline.objectivePositionX ?? linkedNpc?.positionX ?? null;
    const objectivePositionY = objectivePoint?.positionY ?? storyline.objectivePositionY ?? linkedNpc?.positionY ?? null;
    const distance = objectiveOnCurrentMap
      ? resolveEventGuideDistance(
        data.player.positionX,
        data.player.positionY,
        objectivePositionX,
        objectivePositionY,
      )
      : null;
    const focusLabel = storyline.objectivePointLabel || linkedNpc?.name || storyline.linkedNpcNames[0] || storyline.title;
    return resolveGuideCard({
      targetLabel: focusLabel,
      locationLabel: storyline.objectiveDistrictName || storyline.districtName || data.map.name,
      actionLabel: storyline.canAdvance
        ? (distance !== null && distance <= 1
          ? (storyline.availableActionLabel || "已经到位，可以推进故事链")
          : `先去 ${focusLabel}`)
        : `先按线索摸到 ${focusLabel}`,
      summary: distance !== null && distance <= 1 && storyline.canAdvance
        ? "你已经踩到这一阶段的推进点，可以直接把故事往下推。"
        : storyline.advanceHint,
      positionX: objectiveOnCurrentMap ? objectivePositionX : null,
      positionY: objectiveOnCurrentMap ? objectivePositionY : null,
      distance,
    });
  };
  const buildPendingAssassinationGuide = (assassination: PendingAssassinationData | null) => {
    if (!assassination) {
      return null;
    }
    const assassinNpc = nearbyNpcById.get(assassination.npcId) || null;
    return resolveGuideCard({
      targetLabel: assassination.npcName,
      locationLabel: assassination.districtName || data.map.name,
      actionLabel: assassinNpc
        ? "目标已逼近，先决定迎战还是立刻遁逃"
        : "杀机正在逼近，先在迎战和遁逃之间做选择",
      summary: assassinNpc
        ? `${assassination.npcName} 就在当前地图，可按坐标直接判断是否接战。`
        : "这股杀机已经锁到你身上，你需要立刻做出处理。",
      positionX: assassinNpc?.positionX ?? null,
      positionY: assassinNpc?.positionY ?? null,
    });
  };
  const renderGuideBlock = (
    guide: EventGuideCard | null | undefined,
    options?: {
      marginTop?: number;
      title?: string;
      summaryColor?: string;
      stepColor?: string;
    },
  ) => {
    if (!hasEventGuideCard(guide)) {
      return null;
    }
    const marginTop = options?.marginTop ?? 8;
    const title = options?.title || "行动引导";
    return (
      <div style={{ ...intelCardStyle, marginTop, display: "flex", flexDirection: "column", gap: 6 }}>
        <Text style={{ ...intelTinyTextStyle, color: "#f0d5a0" }}>{title}</Text>
        <Space size={6} wrap>
          {guide?.targetLabel ? <DarkTag color="blue">{`找谁：${guide.targetLabel}`}</DarkTag> : null}
          {guide?.locationLabel ? <DarkTag color="gold">{`去哪：${guide.locationLabel}`}</DarkTag> : null}
          {typeof guide?.positionX === "number" && typeof guide?.positionY === "number" ? (
            <DarkTag color="default">{`坐标 ${guide.positionX},${guide.positionY}`}</DarkTag>
          ) : null}
          {typeof guide?.distance === "number" ? (
            <DarkTag color="default">{guide.distance <= 1 ? "已到附近" : `距你 ${guide.distance} 格`}</DarkTag>
          ) : null}
        </Space>
        {guide?.actionLabel ? (
          <Text style={{ ...intelTinyTextStyle, color: options?.stepColor || "#e7d9aa" }}>
            当前步骤：{guide.actionLabel}
          </Text>
        ) : null}
        {guide?.summary ? (
          <Text style={{ ...intelTinyTextStyle, color: options?.summaryColor || "#d3dcf6" }}>
            {guide.summary}
          </Text>
        ) : null}
      </div>
    );
  };
  const adultInviteDetailGuide = buildAdultInviteGuide(adultInviteDetail);
  const pendingAssassinationGuide = buildPendingAssassinationGuide(pendingAssassinationModal);
  const worldIntelCollapseItems: NonNullable<CollapseProps["items"]> = [];

  if (worldIntelLoadError) {
    worldIntelCollapseItems.push({
      key: "intel-load-error",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="gold">情报待重连</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#f0dcc8", flex: 1, minWidth: 0 }}>
            {worldIntelLoadError}
          </Text>
        </div>
      ),
      children: (
        <div style={intelCardStyle}>
          <Text style={{ ...intelMutedTextStyle, color: "#d9c4b2" }}>
            地图主流程不会被这次失败打断；若你要查看委托、故事链或暗线来信细节，可手动重试一次。
          </Text>
          <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
            <Button
              size="small"
              type="primary"
              loading={worldIntelDetailsLoading}
              onClick={() => void fetchWorldIntelDetails({ force: true })}
            >
              重试加载
            </Button>
          </div>
        </div>
      ),
    });
  }

  if (panelData.worldPressure) {
    worldIntelCollapseItems.push({
      key: "pressure",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color={panelData.worldPressure.activeAlertTier === "ambush" ? "red" : panelData.worldPressure.activeAlertTier === "bounty" ? "gold" : "blue"}>
            {panelData.worldPressure.tierLabel}
          </DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#dde6ff", flex: 1, minWidth: 0 }}>
            {panelData.worldPressure.summary}
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {worldPressureDetailLines.map((line) => (
              <Text key={line} style={{ ...intelMutedTextStyle, color: "#d6def5" }}>{line}</Text>
            ))}
            {trackingSignalsPreview.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {trackingSignalsPreview.map((signal, index) => (
                  <div key={`${signal.createdAt}-${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <DarkTag color={signal.severity === "high" ? "red" : signal.severity === "medium" ? "gold" : "default"}>
                      {signal.stageLabel}
                    </DarkTag>
                    <Text style={{ ...intelMutedTextStyle, color: "#c8d2f0", flex: 1, minWidth: 0 }}>
                      {signal.summary}
                    </Text>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (panelData.reputationSummary) {
    worldIntelCollapseItems.push({
      key: "reputation",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color={panelData.reputationSummary.willIgnorePlayer ? "red" : panelData.reputationSummary.canInviteDualCultivation ? "magenta" : "purple"}>
            {panelData.reputationSummary.overallLabel}
          </DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#eadcf4", flex: 1, minWidth: 0 }}>
            {panelData.reputationSummary.overallSummary}
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reputationDetailLines.map((line) => (
              <Text key={line} style={{ ...intelMutedTextStyle, color: "#e0d0eb" }}>{line}</Text>
            ))}
            {panelData.reputationSummary.repairActions.length > 0 ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {panelData.reputationSummary.repairActions.map((action) => (
                  <DarkTag key={action} color="gold">{action}</DarkTag>
                ))}
              </div>
            ) : null}
            {reputationRepairGuidanceEntries.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Text style={{ ...intelBodyTextStyle, color: "#f4dd9a", fontWeight: 600 }}>
                  现在就能这样处理
                </Text>
                {reputationRepairGuidanceEntries.map((entry) => {
                  if (entry.source === "contract") {
                    const contract = entry.contract;
                    const currentObjectivePoint = contract.currentObjectivePointId
                      ? objectivePointById.get(contract.currentObjectivePointId) || null
                      : null;
                    const objectiveDistance = currentObjectivePoint && data
                      ? calcChebyshevDistance(data.player.positionX, data.player.positionY, currentObjectivePoint.positionX, currentObjectivePoint.positionY)
                      : null;
                    const canAdvanceObjectiveHere = Boolean(
                      contract.canAdvanceByObjective
                      && currentObjectivePoint
                      && objectiveDistance !== null
                      && objectiveDistance <= 1,
                    );

                    return (
                      <div
                        key={entry.key}
                        style={{
                          ...intelCardStyle,
                          border: "1px solid rgba(168, 138, 77, 0.46)",
                          background: "rgba(28, 23, 12, 0.74)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <DarkTag color="purple">已挂到任务</DarkTag>
                          <DarkTag>{contract.offerTypeLabel}</DarkTag>
                          <DarkTag color="blue">{resolveWorldContractStepLabel(contract)}</DarkTag>
                        </div>
                        <Text style={{ ...intelBodyTextStyle, color: "#f8edc8", marginTop: 8, fontWeight: 600 }}>
                          {entry.title}
                        </Text>
                        <Text style={{ ...intelMutedTextStyle, color: "#e2d8b4", marginTop: 6 }}>
                          {entry.summary}
                        </Text>
                        {contract.currentObjectiveHint ? (
                          <Text style={{ ...intelTinyTextStyle, color: "#d8cda5", marginTop: 6 }}>
                            {contract.currentObjectiveHint}
                          </Text>
                        ) : null}
                        <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
                          {canAdvanceObjectiveHere ? (
                            <Button
                              size="small"
                              type="primary"
                              loading={worldContractActionLoadingId === contract.offerId}
                              disabled={Boolean(worldContractActionLoadingId)}
                              onClick={() => void handleWorldContractAdvance(contract.offerId)}
                            >
                              {contract.currentObjectiveActionLabel || "立即推进"}
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => router.push("/game/quests")}
                            >
                              打开任务页
                            </Button>
                          )}
                          {contract.targetNpcId ? (
                            <Button
                              size="small"
                              onClick={() => router.push(`/game/world/npc/${encodeURIComponent(contract.targetNpcId || "")}`)}
                            >
                              查看目标
                            </Button>
                          ) : null}
                          {contract.canAdvanceByObjective && currentObjectivePoint ? (
                            <Text style={{ ...intelTinyTextStyle, color: "#d8cda5" }}>
                              {objectiveDistance !== null
                                ? objectiveDistance <= 1
                                  ? "你已经站到可推进范围了。"
                                  : `坐标 ${currentObjectivePoint.positionX},${currentObjectivePoint.positionY} · 还差 ${objectiveDistance} 格`
                                : `坐标 ${currentObjectivePoint.positionX},${currentObjectivePoint.positionY}`}
                            </Text>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  if (entry.source === "offer") {
                    const offer = entry.offer;
                    return (
                      <div
                        key={entry.key}
                        style={{
                          ...intelCardStyle,
                          border: "1px solid rgba(140, 102, 170, 0.46)",
                          background: "rgba(24, 17, 35, 0.78)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <DarkTag color="purple">可立即接取</DarkTag>
                          <DarkTag>{offer.offerTypeLabel}</DarkTag>
                          {offer.sourceFaction ? <DarkTag color="blue">{offer.sourceFaction}</DarkTag> : null}
                        </div>
                        <Text style={{ ...intelBodyTextStyle, color: "#f4ebff", marginTop: 8, fontWeight: 600 }}>
                          {entry.title}
                        </Text>
                        <Text style={{ ...intelMutedTextStyle, color: "#ddd1ef", marginTop: 6 }}>
                          {entry.summary}
                        </Text>
                        <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
                          <Button
                            size="small"
                            type="primary"
                            loading={worldOfferActionLoadingId === offer.id}
                            disabled={Boolean(worldOfferActionLoadingId)}
                            onClick={() => void handleWorldOfferResponse(offer.id, "accept")}
                          >
                            立即接取
                          </Button>
                          <Button
                            size="small"
                            onClick={() => setActionRailOverlayKey(`world-offer:${offer.id}`)}
                          >
                            查看来信
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={entry.key}
                      style={{
                        ...intelCardStyle,
                        border: "1px solid rgba(91, 104, 144, 0.42)",
                        background: "rgba(15, 20, 34, 0.78)",
                      }}
                    >
                      <Text style={{ ...intelBodyTextStyle, color: "#eef2ff", fontWeight: 600 }}>
                        {entry.title}
                      </Text>
                      <Text style={{ ...intelMutedTextStyle, color: "#c5d0ea", marginTop: 6 }}>
                        {entry.summary}
                      </Text>
                      <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
                        <Button size="small" type="primary" onClick={() => router.push("/game/quests")}>
                          打开任务页
                        </Button>
                        <Button size="small" onClick={() => setMobileMapIntelOpen("intel")}>
                          打开情报
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (travelGraphConnections.length > 0 && travelGraphPreview) {
    worldIntelCollapseItems.push({
      key: "travel-graph",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="blue">界域路网</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#d4ddf5", flex: 1, minWidth: 0 }}>
            {travelGraphPreview.regionBand}当前可直达的下一跳已经整理在这里，跑图不必只靠硬记。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mapHeatSummary ? (
              <div style={{
                ...intelCardStyle,
                ...touchFriendlyScrollableCardStyle,
                border: "1px solid rgba(88, 112, 166, 0.4)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <DarkTag color={resolveHeatTierTagColor(mapHeatSummary.heatTier)}>{mapHeatSummary.heatTierLabel}</DarkTag>
                  <DarkTag color="gold">热度 {mapHeatSummary.heatScore}</DarkTag>
                  <Text style={{ ...intelMutedTextStyle, color: "#d6def5" }}>
                    危险 {mapHeatSummary.dangerLevel} / 神秘 {mapHeatSummary.mysteryLevel}
                  </Text>
                </div>
                <Text style={{ ...intelMutedTextStyle, color: "#c8d2f0", marginTop: 6 }}>
                  {mapHeatSummary.summary}
                </Text>
              </div>
            ) : null}
            {travelGraphConnections.map((connection) => (
              <div
                key={`${travelGraphPreview.currentMapId}:${connection.role}:${connection.targetMapId}`}
                style={{
                  ...touchFriendlyScrollableCardStyle,
                  padding: "8px 9px",
                  borderRadius: 6,
                  border: "1px solid rgba(74, 101, 148, 0.48)",
                  background: "rgba(13, 19, 34, 0.82)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <DarkTag color={connection.role === "main" ? "red" : connection.role === "return" ? "blue" : "gold"}>
                    {connection.role === "main" ? "主去向" : connection.role === "return" ? "回返去向" : "支线去向"}
                  </DarkTag>
                  <DarkTag>{resolveTravelTypeLabel(connection.travelType)}</DarkTag>
                  {connection.heatTierHint ? <DarkTag color="purple">{connection.heatTierHint}</DarkTag> : null}
                </div>
                <Text style={{ ...intelBodyTextStyle, color: "#e8f0ff" }}>
                  {connection.label} {"→"} {connection.targetMapName}
                </Text>
                <Text style={{ ...intelMutedTextStyle, color: "#c0cae4" }}>{connection.summary}</Text>
              </div>
            ))}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (rumorHooks.length > 0) {
    worldIntelCollapseItems.push({
      key: "rumor-hooks",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="gold">本图奇闻</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#f0dfb0", flex: 1, minWidth: 0 }}>
            这张图最近最值得顺手盯的异常线索，都在这里先给你点出来。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rumorHooks.map((hook, index) => (
              <div
                key={`${travelGraphPreview?.currentMapId || currentMapId}:rumor-hook:${index}`}
                style={{
                  padding: "8px 9px",
                  borderRadius: 6,
                  border: "1px solid rgba(136, 112, 53, 0.42)",
                  background: "rgba(33, 27, 14, 0.78)",
                }}
              >
                <Text style={{ ...intelBodyTextStyle, color: "#f2e2b2" }}>{hook}</Text>
              </div>
            ))}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (encounterHooks.length > 0 || secretRealmHooks.length > 0 || mapHeatSummary) {
    worldIntelCollapseItems.push({
      key: "secret-realm-hooks",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="purple">秘境与异动</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#e0d5f2", flex: 1, minWidth: 0 }}>
            本图奇遇与秘境入口的母题会在这里持续冒头，热度越高越容易变成真入口。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {encounterHooks.length > 0 ? (
              <div style={intelCardStyle}>
                <Text style={{ ...intelBodyTextStyle, color: "#f2ddff" }}>
                  本图奇遇
                </Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {encounterHooks.map((hook, index) => (
                    <Text key={`encounter-hook:${index}`} style={{ ...intelMutedTextStyle, color: "#d8c9ec" }}>
                      {hook}
                    </Text>
                  ))}
                </div>
              </div>
            ) : null}
            {secretRealmHooks.length > 0 ? (
              <div style={{
                ...intelCardStyle,
                border: "1px solid rgba(115, 90, 123, 0.5)",
                background: "rgba(17, 12, 23, 0.8)",
              }}>
                <Text style={{ ...intelBodyTextStyle, color: "#f0e7ff" }}>
                  本图秘境入口
                </Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {secretRealmHooks.map((hook, index) => (
                    <Text key={`secret-realm-hook:${index}`} style={{ ...intelMutedTextStyle, color: "#d7c8eb" }}>
                      {hook}
                    </Text>
                  ))}
                </div>
              </div>
            ) : null}
            {mapHeatSummary ? (
              <Text style={{ ...intelMutedTextStyle, color: "#aab5d4" }}>
                当前地图热度为 {mapHeatSummary.heatScore}，当玩家、奇遇、委托和秘境异动持续堆叠时，这张图会更容易被抬回热图层。
              </Text>
            ) : null}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (districtStates.length > 0) {
    worldIntelCollapseItems.push({
      key: "district-states",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="blue">街区局势</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#d4ddf5", flex: 1, minWidth: 0 }}>
            每条街都有主导势力与风向，跑图时能明显看出哪边正在压场。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {districtStates.map((district) => (
              <div
                key={district.id}
                style={{
                  padding: "8px 9px",
                  borderRadius: 6,
                  border: "1px solid rgba(74, 101, 148, 0.48)",
                  background: "rgba(13, 19, 34, 0.82)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <DarkTag color="blue">{district.districtName}</DarkTag>
                  <DarkTag color="purple">{district.dominantFactionLabel}</DarkTag>
                  <DarkTag color={resolveDistrictDangerColor(district.dangerLabel)}>{district.dangerLabel}</DarkTag>
                <Text style={{ ...intelMutedTextStyle, color: "#8fb7ff" }}>{district.tensionTag}</Text>
                </div>
                <Text style={{ ...intelBodyTextStyle, color: "#e8f0ff" }}>{district.hotspotSummary}</Text>
                {Array.isArray(district.activeHooks?.nextHooks) && district.activeHooks.nextHooks.length > 0 ? (
                  <Text style={{ ...intelMutedTextStyle, color: "#c0cae4" }}>
                    后手：{district.activeHooks.nextHooks.slice(0, 2).join("；")}
                  </Text>
                ) : null}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={{ ...intelMutedTextStyle, color: "#9fb0d4" }}>
                    势力面：守序 {district.influenceBreakdown.lawful} / 灰线 {district.influenceBreakdown.gray} / 魔修 {district.influenceBreakdown.demonic}
                  </Text>
                  <Text style={{ ...intelTinyTextStyle, color: "#7f8ba8" }}>
                    故事链 {district.activeStorylineCount} 条
                  </Text>
                </div>
                {district.objectivePoints.length > 0 ? (
                  <Text style={{ ...intelTinyTextStyle, color: "#d7c48a" }}>
                    关键点：{district.objectivePoints.map((point) => `${point.label}(${point.pointTypeLabel})`).join("、")}
                  </Text>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (activeStorylines.length > 0) {
    worldIntelCollapseItems.push({
      key: "storylines",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="purple">街区故事链</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#e0d5f2", flex: 1, minWidth: 0 }}>
            同一街区的灰活、清剿与旁门动作会逐步串成连续剧情。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeStorylines.map((storyline) => {
              const storylineGuide = buildStorylineGuide(storyline);
              return (
                <div
                  key={storyline.id}
                  style={{
                    padding: "8px 9px",
                    borderRadius: 6,
                    border: "1px solid rgba(115, 90, 123, 0.5)",
                    background: "rgba(17, 12, 23, 0.8)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <DarkTag color="purple">{storyline.storylineTypeLabel}</DarkTag>
                    <DarkTag color="blue">{storyline.districtName}</DarkTag>
                    <DarkTag>{storyline.sourceFactionLabel}</DarkTag>
                    <DarkTag color={storyline.canAdvance ? "green" : "default"}>{resolveStorylineStatusLabel(storyline.status)}</DarkTag>
                  </div>
                  <Text style={{ ...intelBodyTextStyle, color: "#f0e7ff" }}>
                    {storyline.stageLabel} · {storyline.summary}
                  </Text>
                  {storyline.objectivePointLabel ? (
                    <Text style={{ ...intelMutedTextStyle, color: "#c7b8de" }}>
                      当前目标：{storyline.objectivePointLabel}{storyline.objectiveDistrictName ? ` · ${storyline.objectiveDistrictName}` : ""}
                    </Text>
                  ) : null}
                  {storyline.linkedNpcNames.length > 0 ? (
                    <Text style={{ ...intelMutedTextStyle, color: "#9fa7b9" }}>
                      牵连人物：{storyline.linkedNpcNames.join("、")}
                    </Text>
                  ) : null}
                  <Text style={{ ...intelMutedTextStyle, color: "#b5a8c9" }}>{storyline.advanceHint}</Text>
                  {renderGuideBlock(storylineGuide, {
                    marginTop: 0,
                    summaryColor: "#d8cfee",
                  })}
                  {storyline.playerMomentumTags.length > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {storyline.playerMomentumTags.map((tag) => (
                        <DarkTag key={`${storyline.id}:${tag}`} color="blue">{tag}</DarkTag>
                      ))}
                    </div>
                  ) : null}
                  {storyline.canAdvance ? (
                    <div style={intelActionWrapStyle}>
                      <Button
                        size="small"
                        type="primary"
                        loading={worldStorylineActionLoadingId === storyline.id}
                        disabled={Boolean(worldStorylineActionLoadingId)}
                        onClick={() => void handleAdvanceWorldStoryline(storyline.id)}
                      >
                        {storyline.availableActionLabel || "推进故事链"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (worldObjectivePoints.length > 0) {
    worldIntelCollapseItems.push({
      key: "objective-points",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="blue">街区目标</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#d4ddf5", flex: 1, minWidth: 0 }}>
            这些地标会承接风声、灰活与街区后手，靠近后才能动手推进。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {worldObjectivePoints.map((point) => {
              const relatedContracts = objectivePointContractMap.get(point.id) || [];
              const distance = data
                ? calcChebyshevDistance(data.player.positionX, data.player.positionY, point.positionX, point.positionY)
                : null;
              return (
                <div key={point.id} style={{
                padding: "8px 9px",
                borderRadius: 6,
                border: "1px solid rgba(74, 101, 148, 0.48)",
                background: "rgba(13, 19, 34, 0.82)",
                display: "flex",
                flexDirection: "column",
                gap: 5,
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <DarkTag color="blue">{point.pointTypeLabel}</DarkTag>
                  {point.districtName ? <DarkTag>{point.districtName}</DarkTag> : null}
                  <Text style={{ ...intelMutedTextStyle, color: "#8fb7ff" }}>坐标 {point.positionX},{point.positionY}</Text>
                  {distance !== null ? (
                    <Text style={{ ...intelMutedTextStyle, color: distance <= 1 ? "#9fe0a8" : "#a7b4d8" }}>
                      {distance <= 1 ? "你已靠近" : `距你 ${distance} 格`}
                    </Text>
                  ) : null}
                </div>
                <Text style={{ ...intelBodyTextStyle, color: "#e8f0ff" }}>{point.label}</Text>
                <Text style={{ ...intelMutedTextStyle, color: "#c0cae4" }}>{point.description}</Text>
                <Text style={{ ...intelMutedTextStyle, color: "#94a3c7" }}>{point.interactionHint}</Text>
                {relatedContracts.length > 0 ? (
                  <Text style={{ ...intelTinyTextStyle, color: "#d7c48a" }}>
                    命中委托：{relatedContracts.map((contract) => contract.title).join("、")}
                  </Text>
                ) : (
                  <Text style={{ ...intelTinyTextStyle, color: "#7f8ba8" }}>
                    当前没有挂在你身上的街区委托命中此地标。
                  </Text>
                )}
                </div>
              );
            })}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (activeAdultInvites.length > 0) {
    worldIntelCollapseItems.push({
      key: "adult-invites",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="magenta">私密邀约</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#f2dbe5", flex: 1, minWidth: 0 }}>
            附近有人借气氛递来一封私信，只有明确接受才会继续。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {adultDangerHints.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {adultDangerHints.map((hint) => (
                  <Text key={hint} style={{ ...intelMutedTextStyle, color: "#cdb0bf" }}>{hint}</Text>
                ))}
              </div>
            ) : null}
            <Collapse
              ghost
              size="small"
              items={activeAdultInvites.map((invite) => {
                const inviteGuide = buildAdultInviteGuide(invite);
                return {
                  key: invite.eventLogId,
                  label: (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <DarkTag color="magenta" style={adultInviteChipStyle}>{invite.actionLabel}</DarkTag>
                      <DarkTag style={adultInviteChipStyle}>{invite.npcName}</DarkTag>
                      <Text style={{ color: "#d8b6c6", fontSize: 11, overflowWrap: "anywhere", wordBreak: "break-word" }}>{invite.dispositionLabel}</Text>
                    </div>
                  ),
                  children: (
                    <div style={{
                      padding: "4px 2px 2px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}>
                      <Text style={{ ...intelBodyTextStyle, color: "#f7e6ed" }}>{invite.title}</Text>
                      <Text style={{ ...invitePreviewTextStyle, color: "#dbc6cf" }}>{invite.summary}</Text>
                      <Text style={{ ...invitePreviewTextStyle, color: "#a8939d", WebkitLineClamp: 4 }}>{invite.atmosphere}</Text>
                      {renderGuideBlock(inviteGuide, {
                        marginTop: 0,
                        summaryColor: "#dbc6cf",
                      })}
                      <div style={intelActionWrapStyle}>
                        <Button
                          size="small"
                          onClick={() => setAdultInviteDetail(invite)}
                        >
                          查看全文
                        </Button>
                        {inviteSupportsResponse(invite, "接受") ? (
                          <Button
                            size="small"
                            type="primary"
                            loading={adultInviteActionLoadingId === invite.eventLogId}
                            disabled={Boolean(adultInviteActionLoadingId)}
                            onClick={() => void handleAdultInviteResponse({
                              npcId: invite.npcId,
                              eventLogId: invite.eventLogId,
                              decision: "accept",
                            })}
                          >
                            接受
                          </Button>
                        ) : null}
                        {inviteSupportsResponse(invite, "婉拒") ? (
                          <Button
                            size="small"
                            disabled={Boolean(adultInviteActionLoadingId)}
                            onClick={() => void handleAdultInviteResponse({
                              npcId: invite.npcId,
                              eventLogId: invite.eventLogId,
                              decision: "reject",
                            })}
                          >
                            婉拒
                          </Button>
                        ) : null}
                        {inviteSupportsResponse(invite, "反向诱导") ? (
                          <Button
                            size="small"
                            danger
                            ghost
                            disabled={Boolean(adultInviteActionLoadingId)}
                            onClick={() => void handleAdultInviteResponse({
                              npcId: invite.npcId,
                              eventLogId: invite.eventLogId,
                              decision: "counter_drain",
                            })}
                          >
                            反向诱导
                          </Button>
                        ) : null}
                        {inviteSupportsResponse(invite, "无视") ? (
                          <Button
                            size="small"
                            type="dashed"
                            disabled={Boolean(adultInviteActionLoadingId)}
                            onClick={() => void handleAdultInviteResponse({
                              npcId: invite.npcId,
                              eventLogId: invite.eventLogId,
                              decision: "ignore",
                            })}
                          >
                            无视
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          disabled={Boolean(adultInviteActionLoadingId)}
                          onClick={() => router.push(`/game/world/npc/${encodeURIComponent(invite.npcId)}`)}
                        >
                          查看此人
                        </Button>
                      </div>
                      <Text style={{ ...intelTinyTextStyle, color: "#8f85a1" }}>
                        截止 {new Date(invite.expiresAt || invite.createdAt).toLocaleString("zh-CN", { hour12: false })}
                      </Text>
                    </div>
                  ),
                };
              })}
            />
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (worldEventOffers.length > 0) {
    worldIntelCollapseItems.push({
      key: "shadow-offers",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="purple">暗线来信</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#e0d5f2", flex: 1, minWidth: 0 }}>
            暗线里有人递来一张见不得光的帖子。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {worldEventOffers.slice(0, WORLD_INTEL_PREVIEW_LIMITS.worldEventOffers).map((offer) => {
              const linkedStoryline = offer.storylineId
                ? activeStorylineById.get(offer.storylineId) || null
                : null;
              const offerGuide = buildWorldOfferGuide(offer);
              return (
              <div key={offer.id} style={{
              padding: "8px 9px",
              borderRadius: 6,
              border: "1px solid rgba(115, 90, 123, 0.5)",
              background: "rgba(17, 12, 23, 0.8)",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <DarkTag color="purple">{offer.offerTypeLabel}</DarkTag>
                {offer.sourceFaction ? <DarkTag>{offer.sourceFaction}</DarkTag> : null}
                {offer.storylineTypeLabel ? <DarkTag color="blue">{offer.storylineTypeLabel}</DarkTag> : null}
                {offer.storylineDistrictName ? <DarkTag color="gold">{offer.storylineDistrictName}</DarkTag> : null}
              <Text style={{ ...intelMutedTextStyle, color: "#d7ccea" }}>{offer.riskLabel}</Text>
              </div>
              <Text style={{ ...intelBodyTextStyle, color: "#f0e7ff" }}>{offer.summary}</Text>
              <Text style={{ ...intelMutedTextStyle, color: "#b5a8c9" }}>{offer.detail}</Text>
              {renderGuideBlock(offerGuide, {
                marginTop: 0,
                summaryColor: "#d7ccea",
              })}
              {linkedStoryline ? (
                <Text style={{ ...intelTinyTextStyle, color: "#9fb0d4" }}>
                  这封来信挂在 {linkedStoryline.districtName} 的 {linkedStoryline.storylineTypeLabel} 上，当前已走到 {linkedStoryline.stageLabel}。
                </Text>
              ) : offer.storylineStageLabel ? (
                <Text style={{ ...intelTinyTextStyle, color: "#9fb0d4" }}>
                  这封来信已和街区故事链接线，当前阶段：{offer.storylineStageLabel}。
                </Text>
              ) : null}
              <div style={intelActionWrapStyle}>
                <Button
                  size="small"
                  type="primary"
                  loading={worldOfferActionLoadingId === offer.id}
                  disabled={Boolean(worldOfferActionLoadingId)}
                  onClick={() => void handleWorldOfferResponse(offer.id, "accept")}
                >
                  接受
                </Button>
                <Button
                  size="small"
                  danger
                  ghost
                  disabled={Boolean(worldOfferActionLoadingId)}
                  onClick={() => void handleWorldOfferResponse(offer.id, "reject")}
                >
                  拒绝
                </Button>
                {offer.guideRoute ? (
                  <Button size="small" onClick={() => router.push(offer.guideRoute || "/game/map")}>
                    查看目标
                  </Button>
                ) : null}
                <Text style={{ ...intelTinyTextStyle, color: "#8f85a1" }}>
                  截止 {new Date(offer.expiresAt).toLocaleString("zh-CN", { hour12: false })}
                </Text>
              </div>
              </div>
              );
            })}
          </div>
        </ScrollableContent>
      ),
    });
  }

  if (activeWorldContracts.length > 0) {
    worldIntelCollapseItems.push({
      key: "shadow-contracts",
      label: (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DarkTag color="purple">暗线委托</DarkTag>
          <Text style={{ ...intelBodyTextStyle, color: "#e0d5f2", flex: 1, minWidth: 0 }}>
            这些灰线买卖已经挂到你身上，得亲自去把后手做完。
          </Text>
        </div>
      ),
      children: (
        <ScrollableContent style={scrollableTextStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeWorldContracts.slice(0, WORLD_INTEL_PREVIEW_LIMITS.worldContracts).map((contract) => {
              const currentObjectivePoint = contract.currentObjectivePointId
                ? objectivePointById.get(contract.currentObjectivePointId) || null
                : null;
              const linkedStoryline = contract.storylineId
                ? activeStorylineById.get(contract.storylineId) || null
                : null;
              const contractGuide = buildWorldContractGuide(contract);
              const currentObjectivePositionX = currentObjectivePoint?.positionX ?? contract.currentObjectivePositionX ?? null;
              const currentObjectivePositionY = currentObjectivePoint?.positionY ?? contract.currentObjectivePositionY ?? null;
              const objectiveDistance = resolveEventGuideDistance(
                data.player.positionX,
                data.player.positionY,
                currentObjectivePositionX,
                currentObjectivePositionY,
              );
              const canAdvanceObjectiveHere = Boolean(
                contract.canAdvanceByObjective
                && objectiveDistance !== null
                && objectiveDistance <= 1,
              );

              return (
                <div key={contract.offerId} style={{
                padding: "8px 9px",
                borderRadius: 6,
                border: "1px solid rgba(115, 90, 123, 0.5)",
                background: "rgba(17, 12, 23, 0.8)",
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <DarkTag color="purple">{contract.offerTypeLabel}</DarkTag>
                  <DarkTag>{resolveWorldContractTypeShortLabel(contract.contractType)}</DarkTag>
                  <DarkTag color="blue">{resolveWorldContractStepLabel(contract)}</DarkTag>
                  {contract.sourceFaction ? <DarkTag>{contract.sourceFaction}</DarkTag> : null}
                  {(contract.currentObjectiveDistrictName || contract.targetDistrictName) ? (
                    <DarkTag color="blue">{contract.currentObjectiveDistrictName || contract.targetDistrictName}</DarkTag>
                  ) : null}
                </div>
                <Text style={{ ...intelBodyTextStyle, color: "#f0e7ff" }}>{contract.title}</Text>
                <Text style={{ ...intelMutedTextStyle, color: "#d7ccea" }}>{contract.summary}</Text>
                <Text style={{ ...intelMutedTextStyle, color: "#b5a8c9" }}>{contract.progressLabel}</Text>
                {linkedStoryline ? (
                  <Text style={{ ...intelTinyTextStyle, color: "#9fb0d4" }}>
                    你这桩暗线委托正在推动 {linkedStoryline.districtName} 的 {linkedStoryline.storylineTypeLabel}，当前阶段是 {linkedStoryline.stageLabel}。
                  </Text>
                ) : null}
                {contract.currentObjectiveHint ? (
                  <Text style={{ ...intelTinyTextStyle, color: "#95a5c8" }}>
                    {contract.currentObjectiveHint}
                  </Text>
                ) : null}
                {renderGuideBlock(contractGuide, {
                  marginTop: 0,
                  summaryColor: "#d7ccea",
                })}
                <Text style={{ ...intelTinyTextStyle, color: "#8f85a1" }}>
                  尾款：金 {contract.rewardGold} / 灵玉 {contract.rewardLingYu}
                </Text>
                <div style={intelActionWrapStyle}>
                  {contract.targetNpcId ? (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      onClick={() => router.push(`/game/world/npc/${contract.targetNpcId}`)}
                    >
                      查看目标
                    </Button>
                  ) : null}
                  {contract.canAdvanceByObjective ? (
                    canAdvanceObjectiveHere ? (
                      <Button
                        size="small"
                        type="primary"
                        loading={worldContractActionLoadingId === contract.offerId}
                        disabled={Boolean(worldContractActionLoadingId)}
                        onClick={() => void handleWorldContractAdvance(contract.offerId)}
                      >
                        {contract.currentObjectiveActionLabel || "推进目标"}
                      </Button>
                    ) : (
                      <Text style={{ ...intelTinyTextStyle, color: "#d7c48a" }}>
                        {contract.currentObjectiveMapId && contract.currentObjectiveMapId !== currentMapId
                          ? `先前往 ${contract.currentObjectiveMapName || "指定地界"} 的 ${contract.currentObjectivePointLabel || "目标点"}`
                          : typeof currentObjectivePositionX === "number" && typeof currentObjectivePositionY === "number"
                            ? `先前往 ${currentObjectivePositionX},${currentObjectivePositionY}`
                            : `先靠近 ${contract.currentObjectivePointLabel || "目标点"}`}
                      </Text>
                    )
                  ) : null}
                  {!contract.canAdvanceByObjective && contract.targetMapName ? (
                    <Text style={{ ...intelTinyTextStyle, color: "#8f85a1" }}>
                      地点：{contract.targetMapName}{contract.targetDistrictName ? ` · ${contract.targetDistrictName}` : ""}
                    </Text>
                  ) : null}
                  {contract.canAdvanceByObjective && objectiveDistance !== null ? (
                    <Text style={{ ...intelTinyTextStyle, color: objectiveDistance <= 1 ? "#9fe0a8" : "#8f85a1" }}>
                      {objectiveDistance <= 1
                        ? "已到可推进范围"
                        : `距目标 ${objectiveDistance} 格 · ${currentObjectivePositionX},${currentObjectivePositionY}`}
                    </Text>
                  ) : null}
                </div>
                </div>
              );
            })}
          </div>
        </ScrollableContent>
      ),
    });
  }

  const quickPanelButtons: Array<{
    key: "intel" | "travel";
    label: string;
    count?: number;
  }> = [];

  if (hasMapIntelPanel) {
    quickPanelButtons.push({ key: "intel", label: "情报" });
  }
  if (showTravelQuickPanel) {
    quickPanelButtons.push({ key: "travel", label: "传送阵", count: visibleLinkedMaps.length || undefined });
  }
  const allActionRailEntries: Array<{
    key: string;
    badgeLabel: string;
    badgeColor?: "default" | "blue" | "gold" | "purple" | "magenta" | "red";
    cornerLabel?: string;
    title: string;
    summary: string;
    tileBorder: string;
    tileBackground: string;
    detailContent: ReactNode;
  }> = [];
  const summarizedSecondaryHookIds = new Set(visibleSecondaryHooks.map((hook) => hook.id));
  const summarizedWorldOfferIds = new Set(
    visibleSecondaryHooks
      .filter((hook) => hook.id.startsWith("offer:"))
      .map((hook) => hook.id.slice("offer:".length)),
  );
  const summarizedAdultInviteIds = new Set(
    visibleSecondaryHooks
      .filter((hook) => hook.id.startsWith("adult:"))
      .map((hook) => hook.id.slice("adult:".length)),
  );
  const primaryObjectiveContractTitle = panelData.primaryObjective?.sourceType === "contract"
    ? panelData.primaryObjective.title
    : null;

  if (panelData.primaryObjective) {
    allActionRailEntries.push({
      key: "primary-objective",
      badgeLabel: panelData.primaryObjective.sourceTypeLabel || "主目标",
      badgeColor: "blue",
      cornerLabel: typeof panelData.primaryObjective.positionX === "number" && typeof panelData.primaryObjective.positionY === "number"
        ? `${panelData.primaryObjective.positionX},${panelData.primaryObjective.positionY}`
        : panelData.primaryObjective.locationLabel || undefined,
      title: panelData.primaryObjective.title,
      summary: panelData.primaryObjective.summary,
      tileBorder: "1px solid rgba(78, 117, 182, 0.6)",
      tileBackground: "linear-gradient(180deg, rgba(13, 22, 41, 0.94), rgba(10, 16, 31, 0.92))",
      detailContent: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={intelCardStyle}>
            <Space size={6} wrap>
              <DarkTag color="blue">{panelData.primaryObjective.sourceTypeLabel || "当前主目标"}</DarkTag>
              {panelData.primaryObjective.locationLabel ? <DarkTag color="gold">{panelData.primaryObjective.locationLabel}</DarkTag> : null}
              {panelData.primaryObjective.targetLabel ? <DarkTag>{panelData.primaryObjective.targetLabel}</DarkTag> : null}
              {typeof panelData.primaryObjective.positionX === "number" && typeof panelData.primaryObjective.positionY === "number" ? (
                <DarkTag color="default">{`${panelData.primaryObjective.positionX},${panelData.primaryObjective.positionY}`}</DarkTag>
              ) : null}
            </Space>
            <Text style={{ ...intelBodyTextStyle, color: "#eef4ff", fontWeight: 600, marginTop: 8 }}>
              {panelData.primaryObjective.title}
            </Text>
            <Text style={{ ...intelMutedTextStyle, color: "#c7d3f1", marginTop: 6 }}>
              {panelData.primaryObjective.summary}
            </Text>
            {renderGuideBlock(buildPrimaryObjectiveGuide(), {
              title: "主目标引导",
              summaryColor: "#c7d3f1",
              stepColor: "#e7d9aa",
            })}
            {panelData.primaryObjective.targetRoute ? (
              <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => router.push(panelData.primaryObjective?.targetRoute || "/game/map")}
                >
                  {panelData.primaryObjective.actionLabel || "前往查看"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ),
    });
  }

  visibleSecondaryHooks.forEach((hook) => {
    const hookGuide = buildSecondaryHookGuide(hook);
    const hookDistance = typeof hook.distance === "number"
      ? hook.distance
      : (typeof hook.positionX === "number" && typeof hook.positionY === "number"
        ? calcChebyshevDistance(data.player.positionX, data.player.positionY, hook.positionX, hook.positionY)
        : null);
    allActionRailEntries.push({
      key: `secondary-hook:${hook.id}`,
      badgeLabel: hook.hookTypeLabel,
      badgeColor: hook.hookType === "actionable" ? "purple" : hook.hookType === "rumor" ? "gold" : "default",
      cornerLabel: typeof hook.positionX === "number" && typeof hook.positionY === "number"
        ? `${hook.positionX},${hook.positionY}`
        : undefined,
      title: hook.title,
      summary: hook.summary,
      tileBorder: "1px solid rgba(70, 84, 126, 0.56)",
      tileBackground: "rgba(14, 19, 35, 0.92)",
      detailContent: (
        <div style={intelCardStyle}>
          <Space size={6} wrap>
            <DarkTag color={hook.hookType === "actionable" ? "purple" : hook.hookType === "rumor" ? "gold" : "default"}>
              {hook.hookTypeLabel}
            </DarkTag>
            {typeof hook.positionX === "number" && typeof hook.positionY === "number" ? (
              <DarkTag color="default">{`${hook.positionX},${hook.positionY}`}</DarkTag>
            ) : null}
          </Space>
          <Text style={{ ...intelBodyTextStyle, color: "#edf2ff", fontWeight: 600, marginTop: 8 }}>
            {hook.title}
          </Text>
          <Text style={{ ...intelMutedTextStyle, color: "#b9c6e6", marginTop: 6 }}>
            {hook.summary}
          </Text>
          {renderGuideBlock({
            ...hookGuide,
            distance: typeof hookGuide?.distance === "number" ? hookGuide.distance : hookDistance,
          }, {
            summaryColor: "#d3dcf6",
          })}
          <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
            {hook.actionKind === "world_offer" && hook.actionRefId ? (
              <>
                <Button
                  size="small"
                  type="primary"
                  loading={worldOfferActionLoadingId === hook.actionRefId}
                  disabled={Boolean(worldOfferActionLoadingId)}
                  onClick={() => void handleWorldOfferResponse(hook.actionRefId || "", "accept")}
                >
                  {hook.actionLabel || "接受"}
                </Button>
                <Button
                  size="small"
                  danger
                  ghost
                  disabled={Boolean(worldOfferActionLoadingId)}
                  onClick={() => void handleWorldOfferResponse(hook.actionRefId || "", "reject")}
                >
                  {hook.secondaryActionLabel || "拒绝"}
                </Button>
                {hook.targetRoute ? (
                  <Button size="small" onClick={() => router.push(hook.targetRoute || "/game/map")}>
                    查看目标
                  </Button>
                ) : null}
              </>
            ) : hook.actionKind === "adult_invite" && hook.actionRefId ? (
              <Button
                size="small"
                onClick={() => {
                  const invite = activeAdultInvites.find((entry) => entry.eventLogId === hook.actionRefId) || null;
                  if (invite) {
                    setAdultInviteDetail(invite);
                    return;
                  }
                  if (hook.targetRoute) {
                    router.push(hook.targetRoute);
                  }
                }}
              >
                {hook.actionLabel || "查看"}
              </Button>
            ) : hook.targetRoute ? (
              <Button size="small" onClick={() => router.push(hook.targetRoute || "/game/map")}>
                {hook.actionLabel || "查看"}
              </Button>
            ) : null}
          </div>
        </div>
      ),
    });
  });

  activeWorldContracts.forEach((contract) => {
    if (primaryObjectiveContractTitle && contract.title === primaryObjectiveContractTitle) {
      return;
    }
    const currentObjectivePoint = contract.currentObjectivePointId
      ? objectivePointById.get(contract.currentObjectivePointId) || null
      : null;
    const currentObjectivePositionX = currentObjectivePoint?.positionX ?? contract.currentObjectivePositionX ?? null;
    const currentObjectivePositionY = currentObjectivePoint?.positionY ?? contract.currentObjectivePositionY ?? null;
    const objectiveDistance = resolveEventGuideDistance(
      data.player.positionX,
      data.player.positionY,
      currentObjectivePositionX,
      currentObjectivePositionY,
    );
    const canAdvanceObjectiveHere = Boolean(
      contract.canAdvanceByObjective
      && objectiveDistance !== null
      && objectiveDistance <= 1,
    );
    const contractGuide = buildWorldContractGuide(contract);

    allActionRailEntries.push({
      key: `world-contract:${contract.offerId}`,
      badgeLabel: "委托",
      badgeColor: "purple",
      cornerLabel: contract.canAdvanceByObjective
        && typeof currentObjectivePositionX === "number"
        && typeof currentObjectivePositionY === "number"
        ? `${currentObjectivePositionX},${currentObjectivePositionY}`
        : undefined,
      title: contract.title,
      summary: contract.currentObjectiveHint || contract.summary,
      tileBorder: "1px solid rgba(122, 84, 148, 0.58)",
      tileBackground: "rgba(21, 14, 31, 0.94)",
      detailContent: (
        <div style={intelCardStyle}>
          <Space size={6} wrap>
            <DarkTag color="purple">委托</DarkTag>
            <DarkTag>{resolveWorldContractTypeShortLabel(contract.contractType)}</DarkTag>
            <DarkTag color="blue">{resolveWorldContractStepLabel(contract)}</DarkTag>
          </Space>
          <Text style={{ ...intelBodyTextStyle, color: "#f4ebff", fontWeight: 600, marginTop: 8 }}>
            {contract.title}
          </Text>
          <Text style={{ ...intelMutedTextStyle, color: "#d7ccea", marginTop: 6 }}>
            {contract.summary}
          </Text>
          <Text style={{ ...intelTinyTextStyle, color: "#b6a9cb", marginTop: 6 }}>
            {contract.currentObjectiveHint || contract.progressLabel}
          </Text>
          {renderGuideBlock(contractGuide, {
            summaryColor: "#d7ccea",
          })}
          <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
            {canAdvanceObjectiveHere ? (
              <Button
                size="small"
                type="primary"
                loading={worldContractActionLoadingId === contract.offerId}
                disabled={Boolean(worldContractActionLoadingId)}
                onClick={() => void handleWorldContractAdvance(contract.offerId)}
              >
                {contract.currentObjectiveActionLabel || "推进目标"}
              </Button>
            ) : contract.targetNpcId ? (
              <Button
                size="small"
                onClick={() => router.push(`/game/world/npc/${encodeURIComponent(contract.targetNpcId || "")}`)}
              >
                查看目标
              </Button>
            ) : (
              <Button
                size="small"
                onClick={() => {
                  setMobileMapIntelOpen("intel");
                  setActionRailOverlayKey(null);
                }}
              >
                查看线索
              </Button>
            )}
            {contract.canAdvanceByObjective && objectiveDistance !== null ? (
              <Text style={{ ...intelTinyTextStyle, color: objectiveDistance <= 1 ? "#9fe0a8" : "#9fb0dc" }}>
                {objectiveDistance <= 1
                  ? "已到推进范围"
                  : `${currentObjectivePositionX},${currentObjectivePositionY} · 距 ${objectiveDistance} 格`}
              </Text>
            ) : null}
          </div>
        </div>
      ),
    });
  });

  worldEventOffers.forEach((offer) => {
    if (summarizedSecondaryHookIds.has(`offer:${offer.id}`) || summarizedWorldOfferIds.has(offer.id)) {
      return;
    }
    const offerGuide = buildWorldOfferGuide(offer);
    allActionRailEntries.push({
      key: `world-offer:${offer.id}`,
      badgeLabel: "来信",
      badgeColor: "purple",
      cornerLabel: offer.storylineDistrictName || offer.sourceFaction || undefined,
      title: offer.offerTypeLabel,
      summary: offer.summary,
      tileBorder: "1px solid rgba(133, 95, 152, 0.58)",
      tileBackground: "rgba(23, 15, 31, 0.94)",
      detailContent: (
        <div style={intelCardStyle}>
          <Space size={6} wrap>
            <DarkTag color="purple">暗线来信</DarkTag>
            <DarkTag>{offer.offerTypeLabel}</DarkTag>
            {offer.sourceFaction ? <DarkTag color="blue">{offer.sourceFaction}</DarkTag> : null}
          </Space>
          <Text style={{ ...intelBodyTextStyle, color: "#f4ebff", fontWeight: 600, marginTop: 8 }}>
            {offer.summary}
          </Text>
          <Text style={{ ...intelMutedTextStyle, color: "#d7ccea", marginTop: 6 }}>
            {offer.detail}
          </Text>
          {renderGuideBlock(offerGuide, {
            summaryColor: "#d9d1ea",
          })}
          <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
            <Button
              size="small"
              type="primary"
              loading={worldOfferActionLoadingId === offer.id}
              disabled={Boolean(worldOfferActionLoadingId)}
              onClick={() => void handleWorldOfferResponse(offer.id, "accept")}
            >
              接受
            </Button>
            <Button
              size="small"
              danger
              ghost
              disabled={Boolean(worldOfferActionLoadingId)}
              onClick={() => void handleWorldOfferResponse(offer.id, "reject")}
            >
              拒绝
            </Button>
            {offer.guideRoute ? (
              <Button size="small" onClick={() => router.push(offer.guideRoute || "/game/map")}>
                查看目标
              </Button>
            ) : null}
          </div>
        </div>
      ),
    });
  });

  activeAdultInvites.forEach((invite) => {
    if (summarizedSecondaryHookIds.has(`adult:${invite.eventLogId}`) || summarizedAdultInviteIds.has(invite.eventLogId)) {
      return;
    }
    const inviteGuide = buildAdultInviteGuide(invite);
    allActionRailEntries.push({
      key: `adult-invite:${invite.eventLogId}`,
      badgeLabel: "邀约",
      badgeColor: "magenta",
      cornerLabel: invite.npcName,
      title: invite.actionLabel,
      summary: invite.summary,
      tileBorder: "1px solid rgba(158, 90, 128, 0.56)",
      tileBackground: "rgba(30, 15, 24, 0.94)",
      detailContent: (
        <div style={intelCardStyle}>
          <Space size={6} wrap>
            <DarkTag color="magenta">{invite.actionLabel}</DarkTag>
            <DarkTag>{invite.npcName}</DarkTag>
            <Text style={{ ...intelTinyTextStyle, color: "#d9b6c8" }}>{invite.dispositionLabel}</Text>
          </Space>
          <Text style={{ ...intelBodyTextStyle, color: "#f8eaf0", fontWeight: 600, marginTop: 8 }}>
            {invite.title}
          </Text>
          <Text style={{ ...invitePreviewTextStyle, color: "#ddc3cf", marginTop: 6 }}>
            {invite.summary}
          </Text>
          {renderGuideBlock(inviteGuide, {
            summaryColor: "#ddc3cf",
          })}
          <div style={{ ...intelActionWrapStyle, marginTop: 8 }}>
            <Button
              size="small"
              onClick={() => setAdultInviteDetail(invite)}
            >
              查看全文
            </Button>
            {inviteSupportsResponse(invite, "接受") ? (
              <Button
                size="small"
                type="primary"
                loading={adultInviteActionLoadingId === invite.eventLogId}
                disabled={Boolean(adultInviteActionLoadingId)}
                onClick={() => void handleAdultInviteResponse({
                  npcId: invite.npcId,
                  eventLogId: invite.eventLogId,
                  decision: "accept",
                })}
              >
                接受
              </Button>
            ) : null}
            {inviteSupportsResponse(invite, "婉拒") ? (
              <Button
                size="small"
                disabled={Boolean(adultInviteActionLoadingId)}
                onClick={() => void handleAdultInviteResponse({
                  npcId: invite.npcId,
                  eventLogId: invite.eventLogId,
                  decision: "reject",
                })}
              >
                婉拒
              </Button>
            ) : (
              <Button
                size="small"
                onClick={() => router.push(`/game/world/npc/${encodeURIComponent(invite.npcId)}`)}
              >
                查看此人
              </Button>
            )}
          </div>
        </div>
      ),
    });
  });

  if (allActionRailEntries.length < 1 && panelData.worldIntelLite) {
    const fallbackWorldIntelLite = {
      ...panelData.worldIntelLite,
      keyNpcLabels: panelData.worldIntelLite.keyNpcLabels || [],
      keyPlaceLabels: panelData.worldIntelLite.keyPlaceLabels || [],
    };
    allActionRailEntries.push({
      key: "world-intel-lite",
      badgeLabel: "动静",
      badgeColor: "gold",
      cornerLabel: fallbackWorldIntelLite.keyPlaceLabels?.[0] || undefined,
      title: fallbackWorldIntelLite.summary || "当前动静",
      summary: fallbackWorldIntelLite.backgroundRumor || fallbackWorldIntelLite.foldedHint || "这张地图暂时还没有更多主动事件浮上来。",
      tileBorder: "1px solid rgba(122, 108, 60, 0.52)",
      tileBackground: "rgba(28, 24, 14, 0.94)",
      detailContent: (
        <div style={intelCardStyle}>
          <Space size={6} wrap>
            <DarkTag color="gold">当前动静</DarkTag>
            {fallbackWorldIntelLite.keyNpcLabels.slice(0, 2).map((label) => (
              <DarkTag key={`npc:${label}`}>{label}</DarkTag>
            ))}
            {fallbackWorldIntelLite.keyPlaceLabels.slice(0, 2).map((label) => (
              <DarkTag key={`place:${label}`} color="blue">{label}</DarkTag>
            ))}
          </Space>
          <Text style={{ ...intelBodyTextStyle, color: "#f3edd7", fontWeight: 600, marginTop: 8 }}>
            {fallbackWorldIntelLite.summary || "当前动静"}
          </Text>
          {fallbackWorldIntelLite.backgroundRumor ? (
            <Text style={{ ...intelMutedTextStyle, color: "#dacda6", marginTop: 6 }}>
              {fallbackWorldIntelLite.backgroundRumor}
            </Text>
          ) : null}
          <Text style={{ ...intelTinyTextStyle, color: "#b9ab82", marginTop: 6 }}>
            {fallbackWorldIntelLite.foldedHint || "其余动态会继续按节奏浮上来。"}
          </Text>
        </div>
      ),
    });
  }

  const actionRailCards = allActionRailEntries;
  const selectedActionRailEntry = allActionRailEntries.find((entry) => entry.key === actionRailOverlayKey) || null;
  const quickPanelStripWidth = isCompactViewport ? "calc(100% - 8px)" : "min(440px, calc(100vw - 152px))";
  const mapOverlayReserveHeight = isCompactViewport ? 30 : 40;
  const overlayStripEntries: Array<
    | {
      kind: "panel";
      key: "intel" | "travel";
      label: string;
      count?: number;
    }
    | {
      kind: "action";
      key: string;
      label: string;
      count?: number;
    }
  > = [
    ...quickPanelButtons.map((entry) => ({
      kind: "panel" as const,
      key: entry.key,
      label: entry.label,
      count: entry.count,
    })),
    ...actionRailCards.map((entry) => ({
      kind: "action" as const,
      key: entry.key,
      label: entry.title,
    })),
  ];
  let mobileMapOverlayCardBody: ReactNode = null;
  if (mobileMapIntelOpen === "intel") {
    mobileMapOverlayCardBody = (
      <ScrollableContent maxHeight={isCompactViewport ? "min(38vh, 320px)" : "min(44vh, 420px)"} style={{ paddingRight: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={intelCardStyle}>
            <Space size={6} wrap>
              <DarkTag color={data.map.mapType === "open_world" ? "green" : "blue"}>
                {MAP_TYPE_NAMES[data.map.mapType] || "地图"}
              </DarkTag>
              {openWorldExploration?.regionBand ? <DarkTag color="blue">{openWorldExploration.regionBand}</DarkTag> : null}
              {mapHeatSummary ? <DarkTag color={resolveHeatTierTagColor(mapHeatSummary.heatTier)}>{mapHeatSummary.heatTierLabel}</DarkTag> : null}
            </Space>
            <Text style={{ ...intelBodyTextStyle, color: "#eef4ff", fontWeight: 600, marginTop: 8 }}>
              {data.map.name}
            </Text>
            <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2", marginTop: 6 }}>
              {mapIntelSummary}
            </Text>
          </div>
          {data.map.description ? (
            <div style={intelCardStyle}>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2" }}>{data.map.description}</Text>
            </div>
          ) : null}
          {mapHeatSummary ? (
            <div style={intelCardStyle}>
              <Space size={6} wrap>
                <DarkTag color="gold">热度 {mapHeatSummary.heatScore}</DarkTag>
                <DarkTag color={mapHeatSummary.dangerLevel >= 7 ? "red" : mapHeatSummary.dangerLevel >= 4 ? "gold" : "blue"}>
                  危险 {mapHeatSummary.dangerLevel}
                </DarkTag>
                <DarkTag color={mapHeatSummary.mysteryLevel >= 7 ? "purple" : "default"}>
                  神秘 {mapHeatSummary.mysteryLevel}
                </DarkTag>
              </Space>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2", marginTop: 6 }}>
                {mapHeatSummary.summary}
              </Text>
            </div>
          ) : null}
          {travelGraphPreview?.travelConnections?.length ? (
            <div style={intelCardStyle}>
              <Text style={{ ...intelBodyTextStyle, color: "#eef4ff", fontWeight: 600 }}>
                路网概览
              </Text>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2", marginTop: 6 }}>
                此地当前可顺着路网转向 {travelGraphPreview.travelConnections.length} 处地界。具体去向已收进上方“传送阵”入口。
              </Text>
            </div>
          ) : null}
          {hasMapIntelPanel ? (
            <div style={intelCardStyle}>
              <Text style={{ ...intelMutedTextStyle, color: "#9fb0dc" }}>
                公告下方的横向动态条会直接列出此地图当前所有委托、来信、邀约与主线后手。左右滑动即可逐条查看，不再另外塞进世界动静。
              </Text>
              <Text style={{ ...intelTinyTextStyle, color: "#7788ad", marginTop: 6 }}>
                {worldIntelDetailsLoading
                  ? "动态条正在同步这张图的最新事件……"
                  : `当前已并入 ${allActionRailEntries.length} 条动态；地图资料分组 ${worldIntelCollapseItems.length} 组已收口到轻情报显示。`}
              </Text>
            </div>
          ) : (
            <div style={intelCardStyle}>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2" }}>
                这张图的基础脉络尚未整理出更多信息，先沿着公告下方的动态条继续探索即可。
              </Text>
            </div>
          )}
        </div>
      </ScrollableContent>
    );
  } else if (mobileMapIntelOpen === "travel") {
    mobileMapOverlayCardBody = (
      <ScrollableContent maxHeight={isCompactViewport ? "min(34vh, 280px)" : "min(40vh, 360px)"} style={{ paddingRight: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {currentTravelMode === "portal" ? (
            <div style={intelCardStyle}>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2" }}>
                传送模式下，需先站上传送阵，才会显露可直达的去处。
              </Text>
            </div>
          ) : null}
          {openWorldEntranceHint ? (
            <div style={intelCardStyle}>
              <Space size={6} wrap>
                <DarkTag color="gold">开放世界入口</DarkTag>
                <DarkTag>{openWorldEntranceHint.portalName}</DarkTag>
              </Space>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2", marginTop: 6 }}>
                前往 {openWorldEntranceHint.portalName}（{openWorldEntranceHint.x},{openWorldEntranceHint.y}），即可进入 {openWorldEntranceHint.mapName}。
              </Text>
            </div>
          ) : null}
          {visibleLinkedMaps.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: isCompactViewport ? "1fr 1fr" : "repeat(auto-fit, minmax(156px, 1fr))", gap: 8 }}>
              {visibleLinkedMaps.map((target) => {
                const disabled = moving || !target.available;
                return (
                  <button
                    key={target.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => void handleTravel(target.id, target.name)}
                    style={{
                      ...intelCardStyle,
                      padding: "8px 9px",
                      textAlign: "left",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.7 : 1,
                      color: "#dce5ff",
                    }}
                  >
                    <Text style={{ ...intelBodyTextStyle, color: "#eef3ff", fontWeight: 600 }}>{target.name}</Text>
                    <Text style={{ ...intelTinyTextStyle, color: "#9fb0dc", marginTop: 4 }}>境界：{target.minRealm}</Text>
                    <Text style={{ ...intelTinyTextStyle, color: "#c9d3ef", marginTop: 4 }}>{getCompactTravelStatus(target, moving)}</Text>
                    <Text style={{ ...intelTinyTextStyle, color: "#e8d282", marginTop: 4 }}>{getTravelActionLabel(target, moving)}</Text>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={intelCardStyle}>
              <Text style={{ ...intelMutedTextStyle, color: "#c7d2f2" }}>
                眼下没有可直接跳转的去处，先靠近阵点或继续沿街区主线推进。
              </Text>
            </div>
          )}
        </div>
      </ScrollableContent>
    );
  }
  const selectedActionRailContent = selectedActionRailEntry ? (
    <ScrollableContent maxHeight={isCompactViewport ? "min(38vh, 320px)" : "min(44vh, 420px)"} style={{ paddingRight: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {selectedActionRailEntry.detailContent}
      </div>
    </ScrollableContent>
  ) : null;
  const mapFloatingCardBody = selectedActionRailContent || mobileMapOverlayCardBody;
  const mapSceneHeaderNode = (
    <MapSceneHeader
      mapName={data.map.name}
      mapType={data.map.mapType}
      pvpEnabledOnCurrentMap={pvpEnabledOnCurrentMap}
      hasCurrentSecretRealm={Boolean(currentSecretRealm)}
      visibleAnnouncementText={visibleAnnouncementText}
      isTemporaryAnnouncementActive={isTemporaryAnnouncementActive}
      temporaryAnnouncementId={temporaryAnnouncement?.id ?? null}
      isCompactViewport={isCompactViewport}
      hasSecretRealmIntel={hasSecretRealmIntel}
      hasSecretRealmAttentionDot={hasSecretRealmAttentionDot}
      logoutLoading={logoutLoading}
      onOpenViewSettings={openViewSettings}
      onOpenSecretRealmIntel={openSecretRealmIntel}
      onRefreshMap={handleRefreshMap}
      onLogout={handleLogout}
    />
  );
  const mapSceneViewportNode = (
    <div
      className={`map-scene-shell${isCompactViewport ? " is-compact" : ""}`}
      style={{
        position: "relative",
        marginBottom: isCompactViewport ? 6 : 8,
        paddingTop: mapOverlayReserveHeight,
        paddingBottom: 2,
      }}
    >
      {(overlayStripEntries.length > 0 || mapFloatingCardBody) ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 26,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: isCompactViewport ? 6 : 8,
            width: "100%",
            pointerEvents: "none",
          }}
        >
          {overlayStripEntries.length > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: quickPanelStripWidth,
                maxWidth: "100%",
                padding: isCompactViewport ? "0 2px" : 0,
                pointerEvents: "auto",
              }}
            >
              {!isCompactViewport ? (
                <Button
                  size="small"
                  icon={<LeftOutlined />}
                  onClick={() => scrollHorizontalRailBy(overlayStripRef, -180)}
                  style={{ ...sceneToolButtonStyle, width: 24, minWidth: 24, height: 24 }}
                />
              ) : null}
              <div
                ref={overlayStripRef}
                className="mobile-map-overlay-tab-strip"
                onWheel={(event) => handleHorizontalRailWheel(overlayStripRef, event)}
                style={{
                  display: "flex",
                  gap: 5,
                  flex: 1,
                  overflowX: "auto",
                  padding: isCompactViewport ? 1 : 4,
                  borderRadius: 999,
                  border: "1px solid rgba(77, 94, 138, 0.62)",
                  background: "radial-gradient(circle at top center, rgba(201, 168, 76, 0.08), transparent 56%), rgba(9, 12, 22, 0.84)",
                  boxShadow: "0 10px 22px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255,255,255,0.04)",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-x",
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                  cursor: isCompactViewport ? "auto" : "ew-resize",
                }}
              >
                {overlayStripEntries.map((entry) => {
                  const active = entry.kind === "panel"
                    ? mobileMapIntelOpen === entry.key
                    : entry.kind === "action"
                      ? actionRailOverlayKey === entry.key
                      : false;
                  return (
                    <button
                      className={`map-overlay-pill${active ? " is-active" : ""}${isCompactViewport ? " is-compact" : ""}`}
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        if (entry.kind === "panel") {
                          setActionRailOverlayKey(null);
                          setMobileMapIntelOpen((prev) => prev === entry.key ? null : entry.key);
                          return;
                        }
                        setMobileMapIntelOpen(null);
                        setActionRailOverlayKey((current) => current === entry.key ? null : entry.key);
                      }}
                      style={{
                        flex: "0 0 auto",
                        minWidth: entry.kind === "panel" ? (isCompactViewport ? 76 : 64) : (isCompactViewport ? 82 : 70),
                        maxWidth: entry.kind === "panel" ? (isCompactViewport ? 108 : 88) : (isCompactViewport ? 114 : 92),
                        minHeight: isCompactViewport ? 24 : 26,
                        border: active ? "1px solid rgba(213, 182, 103, 0.72)" : "1px solid rgba(86, 103, 147, 0.72)",
                        background: active ? "rgba(56, 44, 18, 0.94)" : "rgba(13, 18, 33, 0.88)",
                        color: active ? "#f0d48f" : "#d9e3ff",
                        borderRadius: 999,
                        padding: isCompactViewport ? "3px 8px" : "4px 9px",
                        fontSize: isCompactViewport ? 10 : 11,
                        lineHeight: 1,
                        whiteSpace: "nowrap",
                        boxShadow: active ? "0 5px 12px rgba(213, 182, 103, 0.14)" : "0 4px 10px rgba(0, 0, 0, 0.22)",
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 0,
                        textAlign: "center",
                        overflow: "hidden",
                      }}
                    >
                      <span className="map-overlay-pill__label" style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {entry.label}{typeof entry.count === "number" ? ` · ${entry.count}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!isCompactViewport ? (
                <Button
                  size="small"
                  icon={<RightOutlined />}
                  onClick={() => scrollHorizontalRailBy(overlayStripRef, 180)}
                  style={{ ...sceneToolButtonStyle, width: 24, minWidth: 24, height: 24 }}
                />
              ) : null}
            </div>
          ) : null}
          {mapFloatingCardBody ? (
            <div
              className="mobile-map-overlay-card jelly-pop"
              style={{
                width: quickPanelStripWidth,
                maxWidth: "100%",
                maxHeight: isCompactViewport ? "min(40vh, 280px)" : "min(52vh, 460px)",
                borderRadius: 16,
                border: "1px solid rgba(77, 94, 138, 0.82)",
                background: "radial-gradient(circle at top center, rgba(201, 168, 76, 0.08), transparent 34%), linear-gradient(180deg, rgba(12, 16, 29, 0.97), rgba(8, 11, 21, 0.98))",
                boxShadow: "0 14px 36px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(214, 226, 255, 0.06)",
                padding: "10px 10px 8px",
                backdropFilter: "blur(10px)",
                overflow: "hidden",
                touchAction: "pan-y",
                pointerEvents: "auto",
              }}
            >
              {mapFloatingCardBody}
            </div>
          ) : null}
        </div>
      ) : null}

      <MapSceneViewport
        data={activeMapViewData}
        isCompactViewport={isCompactViewport}
        canLocalMove={canLocalMove}
        previousSceneSnapshot={activeMapPreviousSceneSnapshot}
        selfRenderCorrection={selfRenderCorrection}
        viewSize={viewSize}
        phaserEnabled={WORLD_MAP_PHASER_SCENE_ENABLED}
        maxDisplayHeight={compactSceneMaxHeight}
        colyseusStatus={worldMapColyseusAoiStatus}
        colyseusWeakNetwork={worldMapColyseusAoiWeakNetwork}
        colyseusLastAck={worldMapColyseusAoiLastAck}
        onTileClick={handleMapMove}
        onCellClick={handleMapCellClick}
        onRepair={handleWorldMapColyseusRepair}
      />
    </div>
  );
  const nearbySectionNode = (
    <MapSceneNearbySection
      adjacentEntities={adjacentEntities}
      nearbyPlayers={nearbyPlayers}
      isCompactViewport={isCompactViewport}
      onMonsterInteract={handleMonsterInteract}
      onViewPlayer={handleViewPlayer}
      onOpenNpcDetail={handleOpenNearbyNpcDetail}
    />
  );

  return (
    <div className={`map-page-shell${isCompactViewport ? " is-compact" : ""}`} style={{ padding: isCompactViewport ? "4px" : "8px" }}>
      {contextHolder}

      {data?.player?.id ? (
        <PartyFloatingPanel
          snapshot={partySnapshot}
          loading={partyLoading}
          open={partyPanelOpen}
          currentPlayerId={data.player.id}
          actionLoadingKey={partyActionLoadingKey}
          onOpenChange={setPartyPanelOpen}
          onLeave={() => void handleLeaveParty()}
          onKick={(playerId) => void handleKickPartyMember(playerId)}
          onRespondInvite={(inviteId, accept) => void handleRespondPartyInvite(inviteId, accept)}
        />
      ) : null}

      {encounterLoadingVisible && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 1200,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "rgba(13, 13, 15, 0.72)",
          backdropFilter: "blur(2px)",
          padding: 16,
        }}>
          <div style={{
            width: "min(420px, 100%)",
            borderRadius: 8,
            border: "1px solid #6b5a2f",
            background: "rgba(26, 26, 46, 0.92)",
            padding: "20px 16px",
            textAlign: "center",
          }}>
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Spin size="large" />
              <Text style={{ color: "#c9a84c", fontSize: 16, fontWeight: 500 }}>
                {encounterLoadingText}{encounterLoadingDots}
              </Text>
              <Text style={{ color: "#a09880", fontSize: 12 }}>
                正在同步场景，请稍候...
              </Text>
            </Space>
          </div>
        </div>
      )}

      {mapSceneHeaderNode}
      {mapSceneViewportNode}
      {nearbySectionNode}

      {/* 随机事件结果弹窗 */}
      <Modal
        title={adultInviteDetail ? `待回应 · ${adultInviteDetail.actionLabel}` : "私密邀约"}
        open={Boolean(adultInviteDetail)}
        onCancel={() => setAdultInviteDetail(null)}
        footer={adultInviteDetail ? [
          <Button key="detail-close" onClick={() => setAdultInviteDetail(null)}>
            收起
          </Button>,
          <Button
            key="detail-view-npc"
            onClick={() => {
              if (!adultInviteDetail) {
                return;
              }
              setAdultInviteDetail(null);
              router.push(`/game/world/npc/${encodeURIComponent(adultInviteDetail.npcId)}`);
            }}
          >
            查看此人
          </Button>,
          inviteSupportsResponse(adultInviteDetail, "无视") ? (
            <Button
              key="detail-ignore"
              type="dashed"
              disabled={Boolean(adultInviteActionLoadingId)}
              onClick={() => {
                if (!adultInviteDetail) {
                  return;
                }
                void handleAdultInviteResponse({
                  npcId: adultInviteDetail.npcId,
                  eventLogId: adultInviteDetail.eventLogId,
                  decision: "ignore",
                });
              }}
            >
              无视
            </Button>
          ) : null,
          inviteSupportsResponse(adultInviteDetail, "反向诱导") ? (
            <Button
              key="detail-counter"
              danger
              ghost
              disabled={Boolean(adultInviteActionLoadingId)}
              onClick={() => {
                if (!adultInviteDetail) {
                  return;
                }
                void handleAdultInviteResponse({
                  npcId: adultInviteDetail.npcId,
                  eventLogId: adultInviteDetail.eventLogId,
                  decision: "counter_drain",
                });
              }}
            >
              反向诱导
            </Button>
          ) : null,
          inviteSupportsResponse(adultInviteDetail, "婉拒") ? (
            <Button
              key="detail-reject"
              disabled={Boolean(adultInviteActionLoadingId)}
              onClick={() => {
                if (!adultInviteDetail) {
                  return;
                }
                void handleAdultInviteResponse({
                  npcId: adultInviteDetail.npcId,
                  eventLogId: adultInviteDetail.eventLogId,
                  decision: "reject",
                });
              }}
            >
              婉拒
            </Button>
          ) : null,
          inviteSupportsResponse(adultInviteDetail, "接受") ? (
            <Button
              key="detail-accept"
              type="primary"
              loading={adultInviteActionLoadingId === adultInviteDetail.eventLogId}
              disabled={Boolean(adultInviteActionLoadingId) && adultInviteActionLoadingId !== adultInviteDetail.eventLogId}
              onClick={() => {
                if (!adultInviteDetail) {
                  return;
                }
                void handleAdultInviteResponse({
                  npcId: adultInviteDetail.npcId,
                  eventLogId: adultInviteDetail.eventLogId,
                  decision: "accept",
                });
              }}
            >
              接受
            </Button>
          ) : null,
        ] : null}
        width="min(560px, calc(100vw - 24px))"
      >
        {adultInviteDetail ? (
          <ScrollableContent maxHeight="min(62vh, 560px)" style={{ paddingRight: 4 }}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <DarkTag color="magenta">{adultInviteDetail.actionLabel}</DarkTag>
                <DarkTag>{adultInviteDetail.npcName}</DarkTag>
                <Text style={{ color: "#d9b6c8", fontSize: 12 }}>{adultInviteDetail.dispositionLabel}</Text>
              </Space>
              <div style={intelCardStyle}>
                <Text style={{ ...intelTinyTextStyle, color: "#f0d5a0", display: "block", marginBottom: 6 }}>
                  邀约标题
                </Text>
                <Text style={{ ...intelBodyTextStyle, color: "#f8eaf0" }}>{adultInviteDetail.title}</Text>
              </div>
              <div style={intelCardStyle}>
                <Text style={{ ...intelTinyTextStyle, color: "#f0d5a0", display: "block", marginBottom: 6 }}>
                  来信内容
                </Text>
                <Text style={{ ...intelBodyTextStyle, color: "#ddc3cf" }}>{adultInviteDetail.summary}</Text>
              </div>
              <div style={intelCardStyle}>
                <Text style={{ ...intelTinyTextStyle, color: "#f0d5a0", display: "block", marginBottom: 6 }}>
                  当下气氛
                </Text>
                <Text style={{ ...intelBodyTextStyle, color: "#c8b1bc" }}>{adultInviteDetail.atmosphere}</Text>
              </div>
              {renderGuideBlock(adultInviteDetailGuide, {
                marginTop: 0,
                title: "赴约引导",
                summaryColor: "#dbc6cf",
              })}
              <Text style={{ ...intelTinyTextStyle, color: "#8f85a1" }}>
                截止 {new Date(adultInviteDetail.expiresAt || adultInviteDetail.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </Text>
            </Space>
          </ScrollableContent>
        ) : null}
      </Modal>
      <Modal
        title={pendingAssassinationModal ? `暗袭将至 · ${pendingAssassinationModal.npcName}` : "暗袭将至"}
        open={Boolean(pendingAssassinationModal)}
        closable={false}
        maskClosable={false}
        keyboard={false}
        onCancel={() => undefined}
        okButtonProps={{ style: { display: "none" } }}
        cancelButtonProps={{ style: { display: "none" } }}
        footer={pendingAssassinationModal ? [
          <Button
            key="escape"
            onClick={() => void handleAssassinationChoice("escape")}
            loading={assassinationActionLoading === "escape"}
            disabled={Boolean(assassinationActionLoading)}
          >
            冒险遁逃
          </Button>,
          <Button
            key="fight"
            danger
            type="primary"
            onClick={() => void handleAssassinationChoice("fight")}
            loading={assassinationActionLoading === "fight"}
            disabled={Boolean(assassinationActionLoading)}
          >
            迎战
          </Button>,
        ] : null}
        width="min(560px, calc(100vw - 24px))"
      >
        {pendingAssassinationModal ? (
          <ScrollableContent
            maxHeight="min(56vh, 420px)"
            style={{ paddingRight: 4 }}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space size={[6, 6]} wrap>
                <DarkTag color={pendingAssassinationModal.threatLevel === "high" ? "red" : pendingAssassinationModal.threatLevel === "medium" ? "purple" : "default"}>
                  {pendingAssassinationModal.threatLabel}
                </DarkTag>
                <DarkTag color="blue">{pendingAssassinationModal.npcRealmName}</DarkTag>
                {pendingAssassinationModal.npcFaction ? <DarkTag>{pendingAssassinationModal.npcFaction}</DarkTag> : null}
                {pendingAssassinationModal.npcProfession ? <DarkTag>{pendingAssassinationModal.npcProfession}</DarkTag> : null}
                {pendingAssassinationModal.districtName ? <DarkTag>{pendingAssassinationModal.districtName}</DarkTag> : null}
              </Space>
              <Text style={{ color: "#d7dfef", fontSize: 13 }}>
                {pendingAssassinationModal.intro}
              </Text>
              {renderGuideBlock(pendingAssassinationGuide, {
                marginTop: 0,
                title: "迎敌引导",
                summaryColor: "#d7dfef",
              })}
              <div style={intelCardStyle}>
                <Text style={{ color: "#f0d5a0", fontSize: 12, display: "block" }}>
                  暗中打探
                </Text>
                <Text style={{ color: "#b8c2d9", fontSize: 12, display: "block", marginTop: 6 }}>
                  {pendingAssassinationModal.probeSummary}
                </Text>
              </div>
              <div style={{
                ...intelCardStyle,
                border: "1px solid rgba(162, 78, 78, 0.35)",
                background: "rgba(47, 20, 20, 0.78)",
              }}>
                <Text style={{ color: "#ffbdbd", fontSize: 12, display: "block" }}>
                  杀机走势
                </Text>
                <Text style={{ color: "#e7d6d6", fontSize: 12, display: "block", marginTop: 6 }}>
                  {pendingAssassinationModal.assassinationSummary}
                </Text>
              </div>
              <Text style={{ color: "#d7b76f", fontSize: 12 }}>
                遁逃成功率约 {pendingAssassinationModal.escapeChancePercent}% · {pendingAssassinationModal.escapeDifficultyLabel}
              </Text>
              <Text style={{ color: "#8f96ab", fontSize: 12 }}>
                你若遁逃失败，将被强制拖入战斗。
              </Text>
            </Space>
          </ScrollableContent>
        ) : null}
      </Modal>

      <EventModal
        event={event}
        open={eventOpen}
        onClose={handleEventModalClose}
        onChoice={handleEncounterChoice}
        choiceLoading={encounterChoiceLoading}
      />

      <Modal
        title="视野设置"
        open={viewSettingsOpen}
        footer={null}
        onCancel={() => setViewSettingsOpen(false)}
        width="min(420px, calc(100vw - 24px))"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={intelCardStyle}>
            <Text style={{ color: "#d8e3ff", fontSize: 13, display: "block" }}>
              当前视野 {viewSize}x{viewSize}
            </Text>
            <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
              神识 {data.player.spiritualSense} · 可调整范围 {viewSizeRange.min} - {viewSizeRange.max}（按居中奇数窗口）
            </Text>
          </div>
          <Space size={8} wrap style={{ justifyContent: "space-between", width: "100%" }}>
            <Button
              icon={<ZoomInOutlined />}
              disabled={viewSize <= viewSizeRange.min}
              onClick={() => changeViewSize(-VIEW_SIZE_STEP)}
            >
              缩小视野
            </Button>
            <Button
              icon={<ZoomOutOutlined />}
              disabled={viewSize >= viewSizeRange.max}
              onClick={() => changeViewSize(VIEW_SIZE_STEP)}
            >
              扩大视野
            </Button>
          </Space>
          <Text style={{ color: "#8f96ab", fontSize: 12 }}>
            视野窗口会始终以角色为中心，按 3 / 5 / 7 这类奇数尺寸对称展开。
          </Text>
        </div>
      </Modal>

      <Modal
        title="秘境情报"
        open={secretRealmIntelOpen}
        footer={null}
        onCancel={() => setSecretRealmIntelOpen(false)}
        width="min(720px, calc(100vw - 24px))"
      >
        <ScrollableContent
          maxHeight="min(62vh, 560px)"
          style={{ paddingRight: 4 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {currentSecretRealm ? (
            <div
              style={{
                ...intelCardStyle,
                border: "1px solid rgba(197, 158, 72, 0.45)",
                background: "rgba(42, 36, 18, 0.82)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Text style={{ color: "#f5d98a", fontSize: 13 }}>
                  当前秘境：{currentSecretRealm.name}
                </Text>
                <Button
                  size="small"
                  danger
                  disabled={moving || !currentSecretRealmCanLeaveNow}
                  onClick={() => void handleLeaveSecretRealm()}
                >
                  离开秘境
                </Button>
              </div>
              <Text style={{ color: "#aeb9d9", fontSize: 12, display: "block", marginTop: 6 }}>
                {currentSecretRealm.spawnType === "personal" ? "个人补偿秘境" : "全局争夺秘境"} · {SECRET_REALM_SIZE_LABELS[currentSecretRealm.sizeTier]} · {SECRET_REALM_RARITY_LABELS[currentSecretRealm.rarity]} · 推荐境界 {getSecretRealmRecommendedRealmText(currentSecretRealm)}
              </Text>
              {currentSecretRealm.specialType === "wild_wolf_valley" ? (
                <Text style={{ color: "#ffb3b3", fontSize: 12, display: "block", marginTop: 6 }}>
                  {currentSecretRealm.wildWolfValleyBottleOwned
                    ? "超大型野狼谷 · 80x80 · 已持有掌天瓶，当前已恢复普通秘境掉落。"
                    : `超大型野狼谷 · 80x80 · 正常秘境掉落照常发放，并额外判定掌天瓶机缘。当前小怪 ${formatDropChance(Number(currentSecretRealm.wildWolfValleyMobBottleChance || 0))} / Boss ${formatDropChance(Number(currentSecretRealm.wildWolfValleyBossBottleChance || 0))}。`}
                </Text>
              ) : null}
              <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                {currentSecretRealm.description}
              </Text>
              <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                Boss：{currentSecretRealm.bossName} · 成员 {currentSecretRealm.memberPlayerIds.length} 人
              </Text>
              {currentSecretRealm.seedFocusTags && currentSecretRealm.seedFocusTags.length > 0 ? (
                <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                  灵种倾向：{currentSecretRealm.seedFocusTags.join("、")}
                </Text>
              ) : null}
              {currentSecretRealm.hasHighTierSeedChance ? (
                <Text style={{ color: "#8fd6a3", fontSize: 12, display: "block", marginTop: 6 }}>
                  此境藏有高阶灵种机缘，越靠近结丹、元婴阶段，掌天瓶的缩时价值越高。
                </Text>
              ) : null}
              {renderSecretRealmDropIntelPreview(currentSecretRealm.dropIntelPreview)}
              <Text style={{ color: "#8e856f", fontSize: 12, display: "block", marginTop: 6 }}>
                全境掉落口径：小怪以凡品、良品、上品、极品为主；Boss 偶有仙品，并有极低概率自然掉落鸿蒙灵材。
              </Text>
              <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                {currentSecretRealm.announcementText}
              </Text>
              {currentSecretRealm.bossGateStatus ? (
                currentSecretRealm.bossGateStatus.isUnlocked ? (
                  <Text style={{ color: "#8fd6a3", fontSize: 12, display: "block", marginTop: 6 }}>
                    Boss 封印已破，可以前往挑战。
                  </Text>
                ) : (
                  <Text style={{ color: "#f0c48f", fontSize: 12, display: "block", marginTop: 6 }}>
                    {buildSecretRealmBossGateMessage(currentSecretRealm.bossGateStatus)}
                  </Text>
                )
              ) : null}
              {currentSecretRealm.specialHint ? (
                <Text style={{ color: "#d9a063", fontSize: 12, display: "block", marginTop: 6 }}>
                  {currentSecretRealm.specialHint}
                </Text>
              ) : null}
              {!currentSecretRealmCanLeaveNow ? (
                <Text style={{ color: "#d9a063", fontSize: 12, display: "block", marginTop: 6 }}>
                  需站在回返阵上，或等待 Boss 结算后才能离开。
                </Text>
              ) : null}
            </div>
          ) : null}

          {panelData.secretRealms.length > 0 ? (
            panelData.secretRealms.map((secretRealm) => (
              <div
                key={secretRealm.id}
                style={{
                  ...intelCardStyle,
                  background: secretRealm.spawnType === "personal"
                    ? "rgba(27, 47, 34, 0.78)"
                    : "rgba(31, 29, 18, 0.78)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Text style={{ color: secretRealm.specialType === "wild_wolf_valley" ? "#ff9d9d" : (secretRealm.spawnType === "personal" ? "#8ee3a7" : "#f4d686"), fontSize: 13 }}>
                    {secretRealm.name}
                  </Text>
                  <Button
                    size="small"
                    disabled={moving || Boolean(currentSecretRealm)}
                    onClick={() => void handleEnterSecretRealm(secretRealm.id, secretRealm.name)}
                  >
                    进入
                  </Button>
                </div>
                <Text style={{ color: "#aeb9d9", fontSize: 12, display: "block", marginTop: 6 }}>
                  {secretRealm.spawnType === "personal" ? "个人秘境" : "全局秘境"} · {SECRET_REALM_SIZE_LABELS[secretRealm.sizeTier]} · {SECRET_REALM_RARITY_LABELS[secretRealm.rarity]} · 推荐境界 {getSecretRealmRecommendedRealmText(secretRealm)}
                </Text>
                {secretRealm.specialType === "wild_wolf_valley" ? (
                  <Text style={{ color: "#ffb3b3", fontSize: 12, display: "block", marginTop: 6 }}>
                    超大型野狼谷 · 80x80 · 正常秘境掉落照常发放；未持有掌天瓶时，还会额外独立判定掌天瓶机缘。
                  </Text>
                ) : null}
                <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                  {secretRealm.description}
                </Text>
                <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                  坐标 ({secretRealm.positionX}, {secretRealm.positionY}) · {secretRealm.announcementText}
                </Text>
                {secretRealm.seedFocusTags && secretRealm.seedFocusTags.length > 0 ? (
                  <Text style={{ color: "#8f96ab", fontSize: 12, display: "block", marginTop: 6 }}>
                    灵种倾向：{secretRealm.seedFocusTags.join("、")}
                  </Text>
                ) : null}
                {secretRealm.hasHighTierSeedChance ? (
                  <Text style={{ color: "#8fd6a3", fontSize: 12, display: "block", marginTop: 6 }}>
                    此境有高阶灵种机缘，Boss 与精英更容易掉出优质种子。
                  </Text>
                ) : null}
                {renderSecretRealmDropIntelPreview(secretRealm.dropIntelPreview)}
                {secretRealm.specialHint ? (
                  <Text style={{ color: "#d9a063", fontSize: 12, display: "block", marginTop: 6 }}>
                    {secretRealm.specialHint}
                  </Text>
                ) : null}
              </div>
            ))
          ) : (
            !currentSecretRealm ? (
              <div style={intelCardStyle}>
                <Text style={{ color: "#8f96ab", fontSize: 12 }}>
                  当前地图暂无秘境入口。
                </Text>
              </div>
            ) : null
          )}
          </div>
        </ScrollableContent>
      </Modal>

      {/* 玩家资料弹窗 */}
      <Modal
        title={playerProfile ? (
          <Space size={6}>
            <span>角色信息</span>
            <Text style={{ color: "#e8e0d0" }}>{playerProfile.name}</Text>
          </Space>
        ) : "角色信息"}
        width="min(360px, calc(100vw - 24px))"
        open={playerProfileOpen}
        onCancel={closePlayerProfileModal}
        onOk={closePlayerProfileModal}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        {playerProfileLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spin />
          </div>
        ) : playerProfile ? (
          <div style={{ maxHeight: "min(60vh, 440px)", overflowY: "auto", paddingRight: 2 }}>
            <PlayerProfileContent
              profile={playerProfile}
              showAvatar
              topActions={
                <>
                  <Button
                    type="primary"
                    icon={<MessageOutlined />}
                    onClick={handleOpenPrivateChat}
                  >
                    私聊
                  </Button>
                  <Button
                    type="primary"
                    icon={<UserAddOutlined />}
                    loading={friendApplyLoading}
                    onClick={() => void handleApplyFriend()}
                  >
                    添加好友
                  </Button>
                  <Button
                    type="primary"
                    icon={<TeamOutlined />}
                    loading={partyInviteLoading}
                    onClick={() => void handleInviteParty()}
                  >
                    邀请组队
                  </Button>
                  <Button
                    icon={<HeartOutlined />}
                    loading={doubleCultivationRequestLoading}
                    onClick={() => void handleRequestDoubleCultivation()}
                  >
                    申请双修
                  </Button>
                  {pvpEnabledOnCurrentMap ? (
                    <Button
                      danger
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      loading={pvpLoading}
                      onClick={() => void handleStartPvp()}
                    >
                      切磋
                    </Button>
                  ) : null}
                </>
              }
            />
          </div>
        ) : (
          <Text style={{ color: "#6b6355" }}>暂无角色信息</Text>
        )}
      </Modal>

      <ItemDetailModal
        open={Boolean(detailItemId)}
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
        zIndex={2000}
      />
      <style jsx>{`
        .hongmeng-announcement-marquee {
          animation: hongmengAnnouncementScroll 9s linear 1;
          will-change: transform;
        }

        .jelly-pop {
          animation: jellyPop 240ms cubic-bezier(0.2, 0.9, 0.2, 1.15);
          transform-origin: top left;
        }

        .mobile-map-player-carousel::-webkit-scrollbar,
        .mobile-map-overlay-tab-strip::-webkit-scrollbar,
        .map-action-rail::-webkit-scrollbar,
        .map-nearby-entity-rail::-webkit-scrollbar {
          display: none;
        }

        .map-page-shell {
          position: relative;
          min-height: 100%;
          background:
            radial-gradient(circle at top center, rgba(66, 86, 146, 0.14), transparent 30%),
            linear-gradient(180deg, rgba(8, 10, 18, 0.18), rgba(8, 10, 18, 0));
        }

        .map-page-shell.is-compact {
          padding: 6px !important;
        }

        .map-scene-shell {
          position: relative;
          border-radius: 18px;
          background:
            linear-gradient(180deg, rgba(16, 20, 35, 0.94), rgba(8, 11, 21, 0.92));
          border: 1px solid rgba(46, 57, 88, 0.9);
          box-shadow:
            inset 0 1px 0 rgba(214, 223, 255, 0.08),
            0 16px 34px rgba(4, 7, 16, 0.28);
          overflow: hidden;
        }

        .map-scene-shell::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at top center, rgba(124, 156, 255, 0.08), transparent 30%),
            linear-gradient(90deg, rgba(240, 211, 138, 0.06), transparent 36%, rgba(122, 156, 255, 0.06));
          pointer-events: none;
        }

        .map-overlay-pill {
          backdrop-filter: blur(12px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 6px 16px rgba(4, 7, 16, 0.24);
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease,
            border-color 0.18s ease,
            background 0.18s ease;
        }

        .map-overlay-pill.is-active {
          box-shadow:
            inset 0 1px 0 rgba(255, 241, 204, 0.12),
            0 8px 18px rgba(32, 23, 8, 0.24);
        }

        .map-overlay-pill:hover,
        .map-overlay-pill:focus {
          transform: translateY(-1px);
        }

        .map-overlay-pill__label {
          display: block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .map-nearby-section {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(64, 76, 110, 0.72);
          background:
            radial-gradient(circle at top center, rgba(201, 168, 76, 0.08), transparent 38%),
            linear-gradient(180deg, rgba(18, 23, 38, 0.94), rgba(10, 13, 24, 0.92));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            0 10px 20px rgba(3, 6, 15, 0.2);
        }

        .map-nearby-section::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, rgba(97, 125, 203, 0.08), transparent 40%, rgba(240, 211, 138, 0.05));
          pointer-events: none;
        }

        .map-nearby-section::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0));
          pointer-events: none;
        }

        .map-nearby-section__header {
          position: relative;
          z-index: 1;
        }

        .map-nearby-section__title,
        .map-nearby-section__hint {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          min-width: 0;
        }

        .map-nearby-section__title {
          font-weight: 600;
          letter-spacing: 0.04em;
          color: #d9e2f8;
        }

        .map-nearby-section__headerTools {
          min-width: 0;
          flex-shrink: 0;
        }

        .map-nearby-section__hint {
          height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid rgba(70, 88, 132, 0.52);
          background: rgba(17, 25, 44, 0.72);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        :global(.map-nearby-section__scrollButton) {
          border-color: rgba(69, 85, 128, 0.72) !important;
          background: linear-gradient(180deg, rgba(24, 31, 51, 0.96), rgba(12, 17, 30, 0.96)) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 6px 12px rgba(4, 7, 16, 0.16);
        }

        :global(.map-nearby-card) {
          position: relative;
          border: 1px solid rgba(59, 76, 117, 0.72);
          background: linear-gradient(180deg, rgba(20, 27, 46, 0.94), rgba(11, 16, 29, 0.94));
          color: #dce5ff;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.06),
            0 8px 18px rgba(2, 5, 14, 0.22);
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease,
            border-color 0.18s ease;
        }

        :global(.map-nearby-card)::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at top left, rgba(255, 255, 255, 0.05), transparent 34%),
            linear-gradient(135deg, rgba(255, 255, 255, 0.04), transparent 36%);
          pointer-events: none;
        }

        :global(.map-nearby-card:hover),
        :global(.map-nearby-card:focus) {
          transform: translateY(-1px);
        }

        :global(.map-nearby-card--npc) {
          border-color: rgba(67, 74, 103, 0.78);
          background: linear-gradient(180deg, rgba(24, 26, 40, 0.94), rgba(13, 16, 28, 0.96));
          color: #dce4ff;
        }

        :global(.map-nearby-card--monster) {
          border-color: rgba(122, 77, 77, 0.78);
          background: linear-gradient(180deg, rgba(63, 24, 24, 0.82), rgba(31, 14, 16, 0.92));
          color: #ffd0d0;
        }

        :global(.map-nearby-card--player) {
          border-color: rgba(59, 76, 117, 0.72);
          background: linear-gradient(180deg, rgba(20, 27, 46, 0.94), rgba(11, 16, 29, 0.94));
        }

        :global(.map-nearby-card--npc:hover),
        :global(.map-nearby-card--npc:focus) {
          border-color: rgba(122, 136, 190, 0.92) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 10px 22px rgba(10, 16, 35, 0.26);
        }

        :global(.map-nearby-card--monster:hover),
        :global(.map-nearby-card--monster:focus) {
          border-color: rgba(173, 101, 101, 0.92) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 10px 22px rgba(34, 10, 12, 0.26);
        }

        :global(.map-nearby-card--player:hover),
        :global(.map-nearby-card--player:focus) {
          border-color: rgba(104, 132, 201, 0.94) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 10px 22px rgba(7, 14, 30, 0.28);
        }

        :global(.map-nearby-card__avatarShell) {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          border-radius: 999px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        :global(.map-nearby-card__avatarShell--npc) {
          background: linear-gradient(180deg, rgba(78, 64, 31, 0.88), rgba(32, 24, 13, 0.92));
          border: 1px solid rgba(202, 168, 76, 0.4);
        }

        :global(.map-nearby-card__avatarShell--monster) {
          background: linear-gradient(180deg, rgba(96, 48, 48, 0.9), rgba(44, 16, 18, 0.94));
          border: 1px solid rgba(168, 91, 91, 0.42);
        }

        :global(.map-nearby-card__avatarShell--player) {
          background: linear-gradient(180deg, rgba(30, 41, 70, 0.92), rgba(13, 20, 36, 0.94));
          border: 1px solid rgba(82, 106, 164, 0.44);
        }

        :global(.map-nearby-card__title),
        :global(.map-nearby-card__subtitle) {
          display: block;
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
        }

        :global(.map-nearby-card__title) {
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        :global(.map-nearby-card__subtitle) {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          line-clamp: 2;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        @keyframes hongmengAnnouncementScroll {
          0% {
            transform: translateX(100%);
          }
          100% {
            transform: translateX(-100%);
          }
        }

        @keyframes jellyPop {
          0% {
            opacity: 0;
            transform: translateY(-8px) scale(0.92);
          }
          60% {
            opacity: 1;
            transform: translateY(0) scale(1.03);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @media (max-width: 768px) {
          .map-scene-shell {
            border-radius: 16px;
            box-shadow:
              inset 0 1px 0 rgba(214, 223, 255, 0.08),
              0 12px 26px rgba(4, 7, 16, 0.24);
          }

          .map-nearby-section {
            border-radius: 12px !important;
          }
        }

        @media (max-width: 480px) {
          .map-page-shell {
            background:
              radial-gradient(circle at top center, rgba(78, 102, 177, 0.16), transparent 28%),
              linear-gradient(180deg, rgba(8, 10, 18, 0.22), rgba(8, 10, 18, 0));
          }

          .map-scene-shell {
            border-radius: 14px;
          }

          .map-overlay-pill {
            min-height: 28px !important;
            border-radius: 999px !important;
          }

          .map-nearby-section__header {
            gap: 6px !important;
          }

          .map-nearby-section__title {
            max-width: min(58vw, 190px);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .map-nearby-section__hint {
            white-space: nowrap;
            flex-shrink: 0;
          }

          .map-nearby-card.is-compact {
            border-radius: 11px;
          }

          .map-nearby-card__title {
            font-size: 12px !important;
          }

          .map-nearby-card__subtitle {
            -webkit-line-clamp: 1;
            line-clamp: 1;
          }
        }
      `}</style>

    </div>
  );
}
