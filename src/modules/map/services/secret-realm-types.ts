import type {
  SecretRealmBossGateStatus,
  SecretRealmInstanceStatus,
  SecretRealmRarity,
  SecretRealmSpecialType,
  SecretRealmSizeTier,
  SecretRealmSpawnType,
  SecretRealmTemplateSnapshot,
  TileData,
} from "@/types/game";

export const SECRET_REALM_SIZE_RANGES: Record<SecretRealmSizeTier, {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}> = {
  small: {
    minWidth: 9,
    maxWidth: 13,
    minHeight: 9,
    maxHeight: 13,
  },
  medium: {
    minWidth: 15,
    maxWidth: 25,
    minHeight: 15,
    maxHeight: 25,
  },
  large: {
    minWidth: 30,
    maxWidth: 50,
    minHeight: 30,
    maxHeight: 50,
  },
};

export const SECRET_REALM_RARITY_ORDER: SecretRealmRarity[] = [
  "common",
  "rare",
  "epic",
  "legendary",
];

export type SecretRealmConfig = {
  globalSpawnIntervalSeconds: number;
  personalSpawnIntervalSeconds: number;
  globalExpireSeconds: number;
  personalExpireSeconds: number;
  instanceExpireSeconds: number;
  settleStaySeconds: number;
  pityThreshold: number;
  aiGenerationEnabled: boolean;
};

export type GeneratedSecretRealmCandidate = {
  name: string;
  description: string;
  announcement: string;
  theme: string;
  bossBackground: string;
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
  width: number;
  height: number;
  entryPoint: { x: number; y: number };
  returnPoint: { x: number; y: number };
  bossPoint: { x: number; y: number };
  tilesData: TileData[];
  monsterPlan?: SecretRealmTemplateSnapshot["monsterPlan"];
  rewardPlan?: SecretRealmTemplateSnapshot["rewardPlan"];
  tags?: string[];
};

export type SecretRealmTemplateRecord = {
  id: string;
  name: string;
  description: string;
  announcementText: string;
  bossName: string;
  bossLore: string;
  theme: string;
  sizeTier: SecretRealmSizeTier;
  width: number;
  height: number;
  rarity: SecretRealmRarity;
  recommendedRealm: number;
  recommendedRealmName?: string;
  rewardBudget: number;
  tags: string[];
  layout: {
    width: number;
    height: number;
    entrance: { x: number; y: number };
    returnPortal: { x: number; y: number };
    bossPoint: { x: number; y: number };
    elitePoints: Array<{ x: number; y: number }>;
    chestPoints: Array<{ x: number; y: number }>;
    obstacleRate: number;
    tilesData: Array<TileData & { imageUrl?: string | null }>;
  };
  generationSource: "ai" | "fallback";
  validationNotes: string[];
};

export type SecretRealmSpawnView = {
  id: string;
  templateId: string;
  mapId: string;
  mapName: string;
  visibilityScope: "world" | "owner" | "party";
  status: "active" | "entered" | "completed" | "expired";
  name: string;
  description: string;
  announcementText: string;
  bossName: string;
  spawnType: SecretRealmSpawnType;
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
  recommendedRealm: number;
  recommendedRealmName?: string;
  rewardBudget: number;
  positionX: number;
  positionY: number;
  expiresAt: string;
  ownerPlayerId: string | null;
  partyId: string | null;
  mapInstanceId: string | null;
  canEnter?: boolean;
  enterBlockedReason?: string;
  specialType?: SecretRealmSpecialType | null;
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
};

export type SecretRealmCurrentView = {
  instanceId: string;
  mapId: string;
  spawnId: string;
  templateId: string;
  announcementText: string;
  theme: string;
  name: string;
  description: string;
  bossName: string;
  spawnType: SecretRealmSpawnType;
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
  recommendedRealm: number;
  recommendedRealmName?: string;
  status: SecretRealmInstanceStatus;
  ownerPlayerId: string | null;
  expiresAt: string;
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
  specialType?: SecretRealmSpecialType | null;
  showAttentionDot?: boolean;
  specialHint?: string | null;
  wildWolfValleyBottleOwned?: boolean;
  wildWolfValleyMobBottleChance?: number;
  wildWolfValleyBossBottleChance?: number;
  bossGateStatus?: SecretRealmBossGateStatus | null;
  seedFocusTags?: string[];
  hasHighTierSeedChance?: boolean;
  dropIntelPreview?: Array<{
    label: string;
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "hongmeng";
    rarityLabel: string;
    chanceText: string;
    quantityText: string;
  }>;
};

export type CurrentSecretRealmView = SecretRealmCurrentView;

export function getSecretRealmSizeRange(sizeTier: SecretRealmSizeTier) {
  return SECRET_REALM_SIZE_RANGES[sizeTier];
}

export function isSecretRealmMapType(mapType: string | null | undefined) {
  return (mapType || "").trim() === "secret_realm_instance";
}
