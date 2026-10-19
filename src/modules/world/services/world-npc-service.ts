import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  items,
  playerInventory,
  players,
  worldMapInstances,
  worldNpcInventory,
  worldNpcLifeLogs,
  worldNpcProfiles,
  worldNpcRuntime,
} from "@/db/schema";
import type { CombatRewardDrop } from "@/types/game";
import type { MapSceneNpc } from "@/modules/map/services/map-scene-state";
import { hasPendingCombatSessionByCombatId } from "@/modules/combat/services/pending-combat-session";
import { normalizeNpcAvatarImageUrl, normalizeNpcPortraitImageUrl } from "@/modules/shared/services/cosmetic-url";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";
import {
  OPEN_WORLD_ACTION_LABELS,
  OPEN_WORLD_ACTIVE_NPC_LIMIT,
  OPEN_WORLD_REALM_NAMES,
  buildOpenWorldNpcActionLabel,
  buildOpenWorldNpcPersonalitySummary,
  findOpenWorldCustomNpcByGeneratedId,
  getOpenWorldNpcArchetypeProfile,
  getOpenWorldActionLabel,
  getOpenWorldFemaleNamePool,
  getOpenWorldMaleNamePool,
  getOpenWorldNpcTraitPool,
  normalizeOpenWorldAction,
} from "@/modules/world/services/world-config";
import {
  buildInitialOpenWorldNpcStats,
  describeOpenWorldNpcGrowth,
  getOpenWorldNpcRealmName,
  normalizeOpenWorldNpcGrowthStats,
} from "@/modules/world/services/world-npc-growth";
import { buildOpenWorldMapDrafts, type GeneratedOpenWorldNpcDraft } from "@/modules/world/services/world-map-generator";
import {
  buildWorldMapBlockedTileKeySet,
  resolveNearestWorldMapWalkablePosition,
} from "@/modules/world/services/world-map-walkable";
import { createWorldNpcNearbyChatMessage } from "@/modules/world/services/world-nearby-chat";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";
import {
  applyPlayerWorldIncident,
  buildPlayerWorldNpcAttitude,
  completePlayerWorldNpcKillContracts,
  getSafePlayerWorldPressureSnapshot,
  listPlayerWorldContractsByNpc,
} from "@/modules/world/services/player-world-pressure-service";
import {
  getWorldNpcFactionHints,
  listWorldNpcInvolvedStorylines,
} from "@/modules/world/services/world-faction-storyline-service";
import { generateOpenWorldNpcDnaProfile } from "@/modules/world/services/world-ai-generation";

const WORLD_NPC_MONSTER_ID_PREFIX = "world-npc:";
const WORLD_NPC_COMBAT_BOOTSTRAP_GRACE_MS = 15 * 1000;
const WORLD_NPC_HOSTILITY_TARGET_TYPE = "player_hostility";
const WORLD_NPC_HOSTILITY_DURATION_MS = 18 * 60 * 1000;
const WORLD_NPC_WITNESS_RADIUS = 10;
const WORLD_NPC_WITNESS_LIMIT = 3;
const WORLD_NPC_RELATION_SUPPORT_RADIUS = 14;
const WORLD_NPC_RELATION_SUPPORT_LIMIT = 2;
type RewardTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type WorldNpcRelationTier = "same_faction" | "same_district" | "neutral";

type WorldNpcStats = {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  skillDamageBonus: number;
  skillDamageReduction: number;
  artifactDamageBonus: number;
  artifactDamageReduction: number;
};

type LoadedWorldNpc = {
  profile: typeof worldNpcProfiles.$inferSelect;
  runtime: typeof worldNpcRuntime.$inferSelect;
};

type WorldNpcDetailViewer = {
  playerId?: string | null;
  realm: number;
  spiritualSense: number;
};

type WorldNpcInventoryProbe = {
  mode: "blocked" | "blurred";
  title: string;
  description: string;
};

type WorldNpcThreatSummary = {
  state: "calm" | "alert" | "hostile";
  label: string;
  description: string;
  expiresAt: string | null;
  isTargetingViewer: boolean;
};

type WorldNpcFateSummary = {
  title: string;
  description: string;
};

type WorldNpcRelationSummary = {
  label: string;
  description: string;
  nearbyFactionCount: number;
  nearbyDistrictCount: number;
  recentSignal: string | null;
  hints: string[];
};

type WorldNpcHostilityReason =
  | "engage"
  | "witnessed_combat"
  | "witnessed_killing"
  | "repelled_player"
  | "escaped_player"
  | "faction_support";

function normalizeStat(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

function toWorldNpcStats(raw: Record<string, number> | null | undefined): WorldNpcStats {
  return {
    hp: normalizeStat(raw?.hp, 120),
    attack: normalizeStat(raw?.attack, 16),
    defense: normalizeStat(raw?.defense, 10),
    speed: normalizeStat(raw?.speed, 10),
    luck: normalizeStat(raw?.luck, 8),
    spiritualSense: normalizeStat(raw?.spiritualSense, 6),
    armorPenetration: normalizeStat(raw?.armorPenetration, 0),
    block: normalizeStat(raw?.block, 0),
    skillDamageBonus: normalizeStat(raw?.skillDamageBonus, 0),
    skillDamageReduction: normalizeStat(raw?.skillDamageReduction, 0),
    artifactDamageBonus: normalizeStat(raw?.artifactDamageBonus, 0),
    artifactDamageReduction: normalizeStat(raw?.artifactDamageReduction, 0),
  };
}

function parseNpcSlot(npcId: string) {
  const matched = npcId.match(/:npc:(\d+)$/);
  return Number(matched?.[1] || 1);
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pickBySeed<T>(values: readonly T[], seed: string, offset = 0): T {
  return values[(hashSeed(`${seed}:${offset}`) + offset) % values.length];
}

function chebyshevDistance(leftX: number, leftY: number, rightX: number, rightY: number) {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
}

function normalizeItemTypeLabel(itemType: string | null | undefined) {
  const normalized = String(itemType || "").trim().toLowerCase();
  if (!normalized) {
    return "物件";
  }
  if (normalized.includes("pill") || normalized.includes("consumable") || normalized.includes("elixir")) {
    return "丹药";
  }
  if (normalized.includes("weapon") || normalized.includes("blade") || normalized.includes("sword")) {
    return "兵刃";
  }
  if (normalized.includes("armor") || normalized.includes("robe")) {
    return "护具";
  }
  if (normalized.includes("artifact") || normalized.includes("talisman")) {
    return "异宝";
  }
  if (normalized.includes("material") || normalized.includes("ore")) {
    return "材料";
  }
  return "物件";
}

function normalizeRarityHint(rarity: string | null | undefined) {
  const normalized = String(rarity || "").trim().toLowerCase();
  if (!normalized) {
    return "寻常";
  }
  if (["legendary", "mythic", "epic"].includes(normalized)) {
    return "气机不凡的";
  }
  if (["rare", "purple", "orange"].includes(normalized)) {
    return "品质不低的";
  }
  if (["uncommon", "fine", "green", "blue"].includes(normalized)) {
    return "带些灵气的";
  }
  return "寻常";
}

function normalizeQuantityHint(quantity: number) {
  if (quantity <= 1) {
    return "约莫一件";
  }
  if (quantity <= 3) {
    return "像是数件";
  }
  return "似有一小堆";
}

function buildWorldNpcInventoryProbe(viewer: WorldNpcDetailViewer, npcRealmMinor: number): WorldNpcInventoryProbe {
  if (viewer.realm < npcRealmMinor) {
    return {
      mode: "blocked",
      title: "气机遮蔽",
      description: "此人境界更高，行囊气机被神识遮去，难以查探其中虚实。",
    };
  }

  return {
    mode: "blurred",
    title: "模糊查探",
    description: "你只能大致感知其所携之物的轮廓与气机，无法直接看清真实名称与数量。",
  };
}

function parseWorldNpcThreatExpiresAt(nextActionAt: string | null | undefined) {
  const timestamp = Date.parse(String(nextActionAt || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveWorldMapDisplayName(mapName: string | null | undefined, mapId: string | null | undefined) {
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

function resolveWorldNpcLogPlayerId(payloadJson: unknown) {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }
  const playerId = String((payloadJson as Record<string, unknown>).playerId || "").trim();
  return playerId || null;
}

function resolveWorldNpcLogPlayerName(params: {
  payloadJson: unknown;
  playerNameMap: Map<string, string>;
}) {
  if (!params.payloadJson || typeof params.payloadJson !== "object") {
    return null;
  }
  const payloadJson = params.payloadJson as Record<string, unknown>;
  const payloadName = String(payloadJson.playerName || "").trim();
  if (payloadName) {
    return payloadName;
  }
  const playerId = resolveWorldNpcLogPlayerId(payloadJson);
  if (!playerId) {
    return null;
  }
  return params.playerNameMap.get(playerId) || null;
}

function resolveWorldNpcLogPlayerLabel(params: {
  payloadJson: unknown;
  playerNameMap: Map<string, string>;
  viewerPlayerId?: string | null;
}) {
  const playerId = resolveWorldNpcLogPlayerId(params.payloadJson);
  const playerName = resolveWorldNpcLogPlayerName({
    payloadJson: params.payloadJson,
    playerNameMap: params.playerNameMap,
  });
  if (!playerName) {
    return null;
  }
  if (params.viewerPlayerId && playerId === params.viewerPlayerId) {
    return `${playerName}（你）`;
  }
  return playerName;
}

function buildWorldNpcLifeLogView(params: {
  npcName: string;
  viewerPlayerId?: string | null;
  entry: typeof worldNpcLifeLogs.$inferSelect;
  playerNameMap: Map<string, string>;
}) {
  const playerLabel = resolveWorldNpcLogPlayerLabel({
    payloadJson: params.entry.payloadJson,
    playerNameMap: params.playerNameMap,
    viewerPlayerId: params.viewerPlayerId,
  });
  const payloadJson = {
    ...(params.entry.payloadJson && typeof params.entry.payloadJson === "object"
      ? params.entry.payloadJson as Record<string, unknown>
      : {}),
    playerName: playerLabel,
  };

  if (!playerLabel) {
    return {
      id: params.entry.id,
      logType: params.entry.logType,
      title: params.entry.title,
      content: params.entry.content,
      payloadJson,
      createdAt: params.entry.createdAt,
    };
  }

  if (params.entry.logType === "adult_interaction") {
    return {
      id: params.entry.id,
      logType: params.entry.logType,
      title: params.entry.title,
      content: `${params.npcName}与${playerLabel}留下一段暧昧余波，关系与风声都因此偏移了些许。`,
      payloadJson,
      createdAt: params.entry.createdAt,
    };
  }

  if (params.entry.logType === "killed_by_player") {
    return {
      id: params.entry.id,
      logType: params.entry.logType,
      title: params.entry.title,
      content: `${params.npcName}被${playerLabel}击败，所携物资尽数被夺。`,
      payloadJson,
      createdAt: params.entry.createdAt,
    };
  }

  if (params.entry.logType === "repelled_player") {
    return {
      id: params.entry.id,
      logType: params.entry.logType,
      title: params.entry.title,
      content: params.entry.content.includes("来犯修士")
        ? params.entry.content.replace("来犯修士", playerLabel)
        : `${params.npcName}击退了${playerLabel}，继续在此地活动。`,
      payloadJson,
      createdAt: params.entry.createdAt,
    };
  }

  if (params.entry.logType === "escaped_player") {
    return {
      id: params.entry.id,
      logType: params.entry.logType,
      title: params.entry.title,
      content: params.entry.content.includes("来者")
        ? params.entry.content.replace("来者", playerLabel)
        : `${params.npcName}眼见${playerLabel}遁走，收敛战意，重新回到日常行动中。`,
      payloadJson,
      createdAt: params.entry.createdAt,
    };
  }

  return {
    id: params.entry.id,
    logType: params.entry.logType,
    title: params.entry.title,
    content: params.entry.content,
    payloadJson,
    createdAt: params.entry.createdAt,
  };
}

export function isWorldNpcThreatActive(runtime: Pick<typeof worldNpcRuntime.$inferSelect, "currentTargetType" | "currentTargetId" | "nextActionAt">) {
  const expiresAtMs = parseWorldNpcThreatExpiresAt(runtime.nextActionAt);
  return runtime.currentTargetType === WORLD_NPC_HOSTILITY_TARGET_TYPE
    && Boolean(String(runtime.currentTargetId || "").trim())
    && expiresAtMs !== null
    && expiresAtMs > Date.now();
}

function buildWorldNpcThreatSummary(params: {
  runtime: Pick<typeof worldNpcRuntime.$inferSelect, "currentTargetType" | "currentTargetId" | "nextActionAt">;
  viewerPlayerId?: string | null;
}) {
  if (!isWorldNpcThreatActive(params.runtime)) {
    return {
      state: "calm",
      label: "气机平稳",
      description: "此人目前并未显露明显敌意，仍按自己的修行路数行事。",
      expiresAt: null,
      isTargetingViewer: false,
    } satisfies WorldNpcThreatSummary;
  }

  const currentTargetId = String(params.runtime.currentTargetId || "").trim();
  const isTargetingViewer = Boolean(params.viewerPlayerId) && currentTargetId === params.viewerPlayerId;
  const expiresAt = String(params.runtime.nextActionAt || "").trim() || null;

  if (isTargetingViewer) {
    return {
      state: "hostile",
      label: "记住了你的气机",
      description: "此人曾目睹你动手或与你结下杀机，短时间内仍会提防并追缉你的行踪。",
      expiresAt,
      isTargetingViewer,
    } satisfies WorldNpcThreatSummary;
  }

  return {
    state: "alert",
    label: "戒备森严",
    description: "此人最近目睹过杀伐，虽然未必针对你，但仍在提防附近可疑气机。",
    expiresAt,
    isTargetingViewer: false,
  } satisfies WorldNpcThreatSummary;
}

function buildWorldNpcFateSummary(params: {
  originType: string | null | undefined;
  profession: string | null | undefined;
  faction: string | null | undefined;
  traitTags: string[] | null | undefined;
  reincarnationCount: number;
}) {
  const traitTags = Array.isArray(params.traitTags) ? params.traitTags.filter(Boolean) : [];
  const [firstTrait = "沉稳", secondTrait = "多思"] = traitTags;
  const origin = String(params.originType || "无名出身").trim();
  const profession = String(params.profession || "散修").trim();
  const faction = String(params.faction || "无门散人").trim();
  const reincarnationLabel = params.reincarnationCount > 0
    ? `身上还留着 ${params.reincarnationCount} 次轮回残痕`
    : "气机尚算清澈，前尘残痕不重";
  return {
    title: `${origin}·${profession}命格`,
    description: `观其气象，像是${firstTrait}、${secondTrait}一路修出来的人，立身于${faction}，${reincarnationLabel}。`,
  } satisfies WorldNpcFateSummary;
}

function normalizeWorldNpcRelationTier(params: {
  sourceFaction?: string | null;
  witnessFaction?: string | null;
  sourceDistrictName?: string | null;
  witnessDistrictName?: string | null;
}): WorldNpcRelationTier {
  const sourceFaction = String(params.sourceFaction || "").trim();
  const witnessFaction = String(params.witnessFaction || "").trim();
  if (sourceFaction && witnessFaction && sourceFaction === witnessFaction) {
    return "same_faction" as const;
  }

  const sourceDistrictName = String(params.sourceDistrictName || "").trim();
  const witnessDistrictName = String(params.witnessDistrictName || "").trim();
  if (sourceDistrictName && witnessDistrictName && sourceDistrictName === witnessDistrictName) {
    return "same_district" as const;
  }

  return "neutral" as const;
}

function buildWorldNpcRelationSummary(params: {
  faction: string | null | undefined;
  currentDistrictName: string | null;
  nearbyFactionCount: number;
  nearbyDistrictCount: number;
  lifeLogs: Array<{
    logType: string;
    title: string;
  }>;
}) {
  const faction = String(params.faction || "").trim();
  const currentDistrictName = String(params.currentDistrictName || "").trim() || "此地";
  const recentSignal = params.lifeLogs.find((entry) => (
    ["faction_alert", "district_alert", "faction_support", "witnessed_killing", "witnessed_combat"].includes(entry.logType)
  ))?.title || null;
  const hints: string[] = [];

  if (params.nearbyFactionCount > 0 && faction) {
    hints.push(`${faction}里还有 ${params.nearbyFactionCount} 人会留意此人的动向。`);
  }
  if (params.nearbyDistrictCount > 0) {
    hints.push(`${currentDistrictName}附近尚有 ${params.nearbyDistrictCount} 位熟面孔可能互相传话。`);
  }
  if (recentSignal) {
    hints.push(`最近一次人际波动是“${recentSignal}”。`);
  }
  if (hints.length <= 0) {
    hints.push("此人多半独来独往，暂时看不出明显人脉牵连。");
  }

  if (params.nearbyFactionCount >= 2 && faction) {
    return {
      label: "同门照应",
      description: `此人背后有较稳定的${faction}人脉，一旦风声走漏，同门往往会更快互相示警。`,
      nearbyFactionCount: params.nearbyFactionCount,
      nearbyDistrictCount: params.nearbyDistrictCount,
      recentSignal,
      hints,
    } satisfies WorldNpcRelationSummary;
  }

  if (params.nearbyDistrictCount >= 2) {
    return {
      label: "街区熟识",
      description: `此人在${currentDistrictName}并不孤立，周围街坊更容易记住其遭遇与仇怨。`,
      nearbyFactionCount: params.nearbyFactionCount,
      nearbyDistrictCount: params.nearbyDistrictCount,
      recentSignal,
      hints,
    } satisfies WorldNpcRelationSummary;
  }

  if (params.nearbyFactionCount === 1 && faction) {
    return {
      label: "有一位照应",
      description: `此人至少还有一位${faction}同路人，关键时刻有人会替他传讯示警。`,
      nearbyFactionCount: params.nearbyFactionCount,
      nearbyDistrictCount: params.nearbyDistrictCount,
      recentSignal,
      hints,
    } satisfies WorldNpcRelationSummary;
  }

  return {
    label: "独来独往",
    description: "此人当前没有太明显的同门或街区支援，更多是靠自己在此地行走。",
    nearbyFactionCount: params.nearbyFactionCount,
    nearbyDistrictCount: params.nearbyDistrictCount,
    recentSignal,
    hints,
  } satisfies WorldNpcRelationSummary;
}

async function upsertPlayerInventoryItemTx(params: {
  tx: RewardTx;
  playerId: string;
  itemId: string;
  quantity: number;
}) {
  const existing = await params.tx.select().from(playerInventory)
    .where(and(eq(playerInventory.playerId, params.playerId), eq(playerInventory.itemId, params.itemId)))
    .get();
  if (existing) {
    await params.tx.update(playerInventory)
      .set({ quantity: existing.quantity + params.quantity })
      .where(and(eq(playerInventory.playerId, params.playerId), eq(playerInventory.itemId, params.itemId)))
      .run();
    return;
  }

  await params.tx.insert(playerInventory).values({
    playerId: params.playerId,
    itemId: params.itemId,
    quantity: params.quantity,
    equipped: false,
    equipSlot: null,
  }).run();
}

async function loadWorldNpcById(npcId: string): Promise<LoadedWorldNpc | null> {
  if (!(await ensureOpenWorldSchema())) {
    return null;
  }
  const row = await db.select({
    profile: worldNpcProfiles,
    runtime: worldNpcRuntime,
  }).from(worldNpcProfiles)
    .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .where(eq(worldNpcProfiles.id, npcId))
    .get();
  if (!row) {
    return null;
  }
  return clearExpiredWorldNpcThreat(row);
}

async function clearStaleWorldNpcOccupation(row: LoadedWorldNpc) {
  const occupiedByCombatId = String(row.runtime.occupiedByCombatId || "").trim();
  const updatedAt = Date.parse(String(row.runtime.updatedAt || ""));
  if (!occupiedByCombatId) {
    return row;
  }
  const expectedMonsterId = buildWorldNpcMonsterId(row.profile.id);
  if (hasPendingCombatSessionByCombatId(occupiedByCombatId, { monsterId: expectedMonsterId })) {
    return row;
  }
  if (Number.isFinite(updatedAt) && (Date.now() - updatedAt) < WORLD_NPC_COMBAT_BOOTSTRAP_GRACE_MS) {
    return row;
  }

  await db.update(worldNpcRuntime).set({
    occupiedByCombatId: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(worldNpcRuntime.npcId, row.profile.id)).run();

  return {
    ...row,
    runtime: {
      ...row.runtime,
      occupiedByCombatId: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function clearExpiredWorldNpcThreat(row: LoadedWorldNpc) {
  if (isWorldNpcThreatActive(row.runtime)) {
    return row;
  }
  if (row.runtime.currentTargetType !== WORLD_NPC_HOSTILITY_TARGET_TYPE) {
    return row;
  }

  const updatedAt = new Date().toISOString();
  await db.update(worldNpcRuntime).set({
    currentTargetType: null,
    currentTargetId: null,
    nextActionAt: null,
    currentActionLabel: buildOpenWorldNpcActionLabel({
      action: row.runtime.currentAction,
      seed: `${row.profile.dnaSeed}:threat-clear`,
      profession: row.profile.profession,
      faction: row.profile.faction,
      traitTags: row.profile.traitTags,
    }),
    updatedAt,
  }).where(eq(worldNpcRuntime.npcId, row.profile.id)).run();

  return {
    ...row,
    runtime: {
      ...row.runtime,
      currentTargetType: null,
      currentTargetId: null,
      nextActionAt: null,
      currentActionLabel: buildOpenWorldNpcActionLabel({
        action: row.runtime.currentAction,
        seed: `${row.profile.dnaSeed}:threat-expired`,
        profession: row.profile.profession,
        faction: row.profile.faction,
        traitTags: row.profile.traitTags,
      }),
      updatedAt,
    },
  };
}

async function loadNearbyActiveWorldNpcRows(params: {
  mapId: string;
  excludeNpcId: string;
  sourcePositionX: number;
  sourcePositionY: number;
  radius: number;
  limit?: number;
}) {
  const rows = await db.select({
    profile: worldNpcProfiles,
    runtime: worldNpcRuntime,
  }).from(worldNpcProfiles)
    .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .where(and(
      eq(worldNpcRuntime.currentMapId, params.mapId),
      eq(worldNpcRuntime.isActivated, true),
    ))
    .all();

  return rows
    .filter((row) => row.profile.status !== "dead" && row.profile.id !== params.excludeNpcId)
    .map((row) => ({
      ...row,
      distance: chebyshevDistance(
        row.runtime.positionX,
        row.runtime.positionY,
        params.sourcePositionX,
        params.sourcePositionY,
      ),
    }))
    .filter((row) => row.distance <= params.radius)
    .sort((left, right) => (
      left.distance - right.distance
    ))
    .slice(0, params.limit || rows.length);
}

async function loadWitnessNpcRows(params: {
  mapId: string;
  sourceNpcId: string;
  sourcePositionX: number;
  sourcePositionY: number;
}) {
  return loadNearbyActiveWorldNpcRows({
    mapId: params.mapId,
    excludeNpcId: params.sourceNpcId,
    sourcePositionX: params.sourcePositionX,
    sourcePositionY: params.sourcePositionY,
    radius: WORLD_NPC_WITNESS_RADIUS,
    limit: WORLD_NPC_WITNESS_LIMIT,
  });
}

async function markWorldNpcHostileToPlayer(params: {
  npcId: string;
  playerId: string;
  reason: WorldNpcHostilityReason;
  hostilityDurationMs?: number;
  actionLabel?: string;
  lifeLogType?: string;
  payloadJson?: Record<string, unknown>;
  lifeLogTitle?: string;
  lifeLogContent?: string;
}) {
  const expiresAt = new Date(Date.now() + (params.hostilityDurationMs || WORLD_NPC_HOSTILITY_DURATION_MS)).toISOString();
  const actionLabel = params.actionLabel || (params.reason === "witnessed_killing"
    ? "目睹杀机后戒备"
    : params.reason === "repelled_player"
      ? "追缉来犯者"
    : params.reason === "escaped_player"
        ? "记住了遁走气机"
      : params.reason === "faction_support"
          ? "同门驰援"
        : params.reason === "engage"
          ? "警觉来犯气机"
          : "警觉巡查");

  await db.update(worldNpcRuntime).set({
    currentTargetType: WORLD_NPC_HOSTILITY_TARGET_TYPE,
    currentTargetId: params.playerId,
    nextActionAt: expiresAt,
    currentAction: "hunt",
    currentActionLabel: actionLabel,
    updatedAt: new Date().toISOString(),
  }).where(eq(worldNpcRuntime.npcId, params.npcId)).run();

  if (params.lifeLogTitle && params.lifeLogContent) {
    await db.insert(worldNpcLifeLogs).values({
      npcId: params.npcId,
      logType: params.lifeLogType || params.reason,
      title: params.lifeLogTitle,
      content: params.lifeLogContent,
      payloadJson: {
        playerId: params.playerId,
        expiresAt,
        ...(params.payloadJson || {}),
      },
      createdAt: new Date().toISOString(),
    }).run();
  }

  return expiresAt;
}

async function propagateWorldNpcWitnessHostility(params: {
  mapId: string;
  playerId: string;
  sourceNpcId: string;
  sourceNpcName: string;
  sourceFaction?: string | null;
  sourceDistrictName?: string | null;
  sourcePositionX: number;
  sourcePositionY: number;
  eventType: "combat" | "killing";
}) {
  const witnessRows = await loadWitnessNpcRows({
    mapId: params.mapId,
    sourceNpcId: params.sourceNpcId,
    sourcePositionX: params.sourcePositionX,
    sourcePositionY: params.sourcePositionY,
  });
  if (witnessRows.length <= 0) {
    return {
      witnessCount: 0,
      witnessNames: [] as string[],
    };
  }

  const witnessNames: string[] = [];
  const prioritizedWitnessRows = witnessRows
    .map((witness) => {
      const witnessDistrictName = resolveOpenWorldDistrictName({
        mapId: params.mapId,
        positionX: witness.runtime.positionX,
        positionY: witness.runtime.positionY,
      });
      const relationTier = normalizeWorldNpcRelationTier({
        sourceFaction: params.sourceFaction,
        witnessFaction: witness.profile.faction,
        sourceDistrictName: params.sourceDistrictName,
        witnessDistrictName,
      });
      const relationPriority = relationTier === "same_faction" ? 0 : relationTier === "same_district" ? 1 : 2;
      return {
        witness,
        witnessDistrictName,
        relationTier,
        relationPriority,
      };
    })
    .filter((entry) => !entry.witness.runtime.occupiedByCombatId)
    .filter((entry) => !isWorldNpcThreatActive(entry.witness.runtime))
    .sort((left, right) => (
      left.relationPriority - right.relationPriority
    ));

  for (const entry of prioritizedWitnessRows) {
    const { witness, witnessDistrictName, relationTier } = entry;
    witnessNames.push(witness.profile.name);
    const hostilityDurationMs = relationTier === "same_faction"
      ? (params.eventType === "killing" ? 28 : 22) * 60 * 1000
      : relationTier === "same_district"
        ? (params.eventType === "killing" ? 20 : 14) * 60 * 1000
        : undefined;
    const lifeLogType = relationTier === "same_faction"
      ? "faction_alert"
      : relationTier === "same_district"
        ? "district_alert"
        : undefined;
    const lifeLogTitle = relationTier === "same_faction"
      ? (params.eventType === "killing" ? "同门闻凶" : "同门示警")
      : relationTier === "same_district"
        ? (params.eventType === "killing" ? "街坊惊闻" : "街巷互告")
        : (params.eventType === "killing" ? "目击杀伐" : "目击争斗");
    const lifeLogContent = relationTier === "same_faction"
      ? (params.eventType === "killing"
        ? `${witness.profile.name}亲眼见到同路的${params.sourceNpcName}横死，当场把来犯修士的气机牢牢记下。`
        : `${witness.profile.name}发现${params.sourceNpcName}与修士交锋，立刻按同门默契开始提防那股来犯气机。`)
      : relationTier === "same_district"
        ? (params.eventType === "killing"
          ? `${witness.profile.name}在${witnessDistrictName || params.sourceDistrictName || "附近"}听闻并目睹杀伐，决定把这股凶煞气机记在心里。`
          : `${witness.profile.name}听见${params.sourceNpcName}那边起了争斗，街巷之间很快就传开了警讯。`)
        : (params.eventType === "killing"
          ? `${witness.profile.name}亲眼看见${params.sourceNpcName}横死，当场记住了来犯修士的气机。`
          : `${witness.profile.name}目睹${params.sourceNpcName}与修士交锋，心中生出明显戒备。`);
    const actionLabel = relationTier === "same_faction"
      ? (params.eventType === "killing" ? "同门记仇巡查" : "同门戒备巡望")
      : relationTier === "same_district"
        ? "街巷互告巡望"
        : undefined;
    await markWorldNpcHostileToPlayer({
      npcId: witness.profile.id,
      playerId: params.playerId,
      reason: params.eventType === "killing" ? "witnessed_killing" : "witnessed_combat",
      hostilityDurationMs,
      actionLabel,
      lifeLogType,
      lifeLogTitle,
      lifeLogContent,
      payloadJson: {
        sourceNpcId: params.sourceNpcId,
        sourceNpcName: params.sourceNpcName,
        sourceFaction: params.sourceFaction || null,
        sourceDistrictName: params.sourceDistrictName || null,
        witnessDistrictName: witnessDistrictName || null,
        relationTier,
      },
    });
  }

  const spokesperson = prioritizedWitnessRows[0];
  if (spokesperson) {
    await createWorldNpcNearbyChatMessage({
      mapId: params.mapId,
      npcId: spokesperson.witness.profile.id,
      senderName: spokesperson.witness.profile.name,
      content: spokesperson.relationTier === "same_faction"
        ? (params.eventType === "killing"
          ? `${params.sourceNpcName}那边出了人命，我们这一脉都记下那股来犯气机了。`
          : `${params.sourceNpcName}那边起了争斗，同路之人这几日都该多留心。`)
        : spokesperson.relationTier === "same_district"
          ? `${params.sourceDistrictName || spokesperson.witnessDistrictName || "这片街区"}已经传开了，诸位都小心那股来犯气机。`
          : (params.eventType === "killing"
            ? `我亲眼看见${params.sourceNpcName}被人夺命，这股气机我记下了。`
            : `${params.sourceNpcName}那边起了争斗，诸位这几日都留神些。`),
    });
  }

  return {
    witnessCount: witnessRows.length,
    witnessNames,
  };
}

export async function reinforceWorldNpcFactionSupport(params: {
  mapId: string;
  playerId: string;
  sourceNpcId: string;
  sourceNpcName: string;
  sourceFaction?: string | null;
  sourceDistrictName?: string | null;
  sourcePositionX: number;
  sourcePositionY: number;
}) {
  const nearbyRows = await loadNearbyActiveWorldNpcRows({
    mapId: params.mapId,
    excludeNpcId: params.sourceNpcId,
    sourcePositionX: params.sourcePositionX,
    sourcePositionY: params.sourcePositionY,
    radius: WORLD_NPC_RELATION_SUPPORT_RADIUS,
  });

  const supportRows = nearbyRows
    .map((row) => {
      const currentDistrictName = resolveOpenWorldDistrictName({
        mapId: params.mapId,
        positionX: row.runtime.positionX,
        positionY: row.runtime.positionY,
      });
      const relationTier = normalizeWorldNpcRelationTier({
        sourceFaction: params.sourceFaction,
        witnessFaction: row.profile.faction,
        sourceDistrictName: params.sourceDistrictName,
        witnessDistrictName: currentDistrictName,
      });
      const alreadyTrackingSamePlayer = isWorldNpcThreatActive(row.runtime)
        && String(row.runtime.currentTargetId || "").trim() === params.playerId;
      const relationPriority = relationTier === "same_faction" ? 0 : relationTier === "same_district" ? 1 : 2;
      return {
        row,
        currentDistrictName,
        relationTier,
        relationPriority,
        alreadyTrackingSamePlayer,
      };
    })
    .filter((entry) => !entry.alreadyTrackingSamePlayer)
    .filter((entry) => !entry.row.runtime.occupiedByCombatId)
    .filter((entry) => !isWorldNpcThreatActive(entry.row.runtime))
    .filter((entry) => entry.relationTier !== "neutral")
    .sort((left, right) => left.relationPriority - right.relationPriority)
    .slice(0, WORLD_NPC_RELATION_SUPPORT_LIMIT);

  if (supportRows.length <= 0) {
    return {
      supportCount: 0,
      supportNames: [] as string[],
    };
  }

  const supportNames: string[] = [];
  for (const entry of supportRows) {
    supportNames.push(entry.row.profile.name);
    const isFactionSupport = entry.relationTier === "same_faction";
    await markWorldNpcHostileToPlayer({
      npcId: entry.row.profile.id,
      playerId: params.playerId,
      reason: isFactionSupport ? "faction_support" : "witnessed_combat",
      hostilityDurationMs: (isFactionSupport ? 18 : 12) * 60 * 1000,
      actionLabel: isFactionSupport ? "同门驰援" : "街巷互告巡望",
      lifeLogType: isFactionSupport ? "faction_support" : "district_alert",
      lifeLogTitle: isFactionSupport ? "同门传讯" : "街巷互告",
      lifeLogContent: isFactionSupport
        ? `${entry.row.profile.name}收到了${params.sourceNpcName}那边的同门示警，开始沿着气机追查来犯修士。`
        : `${entry.row.profile.name}从${entry.currentDistrictName || params.sourceDistrictName || "附近"}听闻有人作乱，街巷之间很快传开了警讯。`,
      payloadJson: {
        sourceNpcId: params.sourceNpcId,
        sourceNpcName: params.sourceNpcName,
        sourceFaction: params.sourceFaction || null,
        sourceDistrictName: params.sourceDistrictName || null,
        supportDistrictName: entry.currentDistrictName || null,
        relationTier: entry.relationTier,
      },
    });
  }

  const spokesperson = supportRows[0];
  if (spokesperson) {
    await createWorldNpcNearbyChatMessage({
      mapId: params.mapId,
      npcId: spokesperson.row.profile.id,
      senderName: spokesperson.row.profile.name,
      content: spokesperson.relationTier === "same_faction"
        ? `我已收到${params.sourceNpcName}那边的示警，那股来犯气机休想轻易藏住。`
        : `${params.sourceDistrictName || spokesperson.currentDistrictName || "这片街区"}已经有人传话，诸位都留神些。`,
    });
  }

  return {
    supportCount: supportRows.length,
    supportNames,
  };
}

export function buildWorldNpcMonsterId(npcId: string) {
  return `${WORLD_NPC_MONSTER_ID_PREFIX}${npcId}`;
}

function decodeWorldNpcIdentifier(value: string) {
  const normalized = value.trim();
  if (!normalized.includes("%")) {
    return normalized;
  }
  try {
    return decodeURIComponent(normalized).trim();
  } catch {
    return normalized;
  }
}

export function isWorldNpcMonsterId(monsterId: string) {
  return decodeWorldNpcIdentifier(monsterId).startsWith(WORLD_NPC_MONSTER_ID_PREFIX);
}

export function resolveWorldNpcIdFromMonsterId(monsterId: string) {
  const normalizedMonsterId = decodeWorldNpcIdentifier(monsterId);
  return normalizedMonsterId.startsWith(WORLD_NPC_MONSTER_ID_PREFIX)
    ? normalizedMonsterId.slice(WORLD_NPC_MONSTER_ID_PREFIX.length).trim()
    : "";
}

export async function listWorldSceneNpcsByMap(mapId: string): Promise<MapSceneNpc[]> {
  if (!(await ensureOpenWorldSchema())) {
    return [];
  }
  const mapRow = await db.select({
    width: worldMapInstances.width,
    height: worldMapInstances.height,
    tilesData: worldMapInstances.tilesData,
  }).from(worldMapInstances).where(eq(worldMapInstances.id, mapId)).get();
  const rows = await db.select({
    id: worldNpcProfiles.id,
    name: worldNpcProfiles.name,
    title: worldNpcProfiles.profession,
    avatarImageUrl: worldNpcProfiles.avatarImageUrl,
    realmName: worldNpcProfiles.realmName,
    positionX: worldNpcRuntime.positionX,
    positionY: worldNpcRuntime.positionY,
    currentAction: worldNpcRuntime.currentAction,
    currentActionLabel: worldNpcRuntime.currentActionLabel,
    isKillable: worldNpcProfiles.isKillable,
    status: worldNpcProfiles.status,
  }).from(worldNpcProfiles)
    .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .where(and(
      eq(worldNpcRuntime.currentMapId, mapId),
      eq(worldNpcRuntime.isActivated, true),
    ))
    .all();
  const blockedTileKeys = mapRow
    ? buildWorldMapBlockedTileKeySet(mapRow.tilesData, mapRow.width, mapRow.height)
    : null;

  const reservedPositions: Array<{ x: number; y: number }> = [];
  return rows
    .filter((row) => row.status !== "dead")
    .slice(0, OPEN_WORLD_ACTIVE_NPC_LIMIT)
    .map((row) => {
      const safePosition = blockedTileKeys && mapRow
        ? resolveNearestWorldMapWalkablePosition({
          preferred: {
            x: row.positionX,
            y: row.positionY,
          },
          width: mapRow.width,
          height: mapRow.height,
          blockedTileKeys,
          avoidPoints: reservedPositions,
          minDistanceFromAvoidPoints: 2,
        })
        : {
          x: row.positionX,
          y: row.positionY,
        };
      reservedPositions.push(safePosition);

      return {
        id: row.id,
        name: row.name,
        title: row.title,
        avatarImageUrl: normalizeNpcAvatarImageUrl(row.avatarImageUrl),
        positionX: safePosition.x,
        positionY: safePosition.y,
        isShop: false,
        sourceType: "world",
        detailRoute: `/game/world/npc/${row.id}`,
        realmName: row.realmName,
        currentActionLabel: row.currentActionLabel || getOpenWorldActionLabel(row.currentAction),
        isKillable: Boolean(row.isKillable),
        status: row.status,
      };
    });
}

export async function getWorldNpcDetail(npcId: string, viewer: WorldNpcDetailViewer) {
  if (!(await ensureOpenWorldSchema())) {
    return null;
  }
  const row = await loadWorldNpcById(npcId);
  if (!row) {
    return null;
  }

  const [mapRow, inventoryRows, logRows, shadowContracts, factionHints, involvedStorylines, worldPressureSnapshot] = await Promise.all([
    db.select({
      id: worldMapInstances.id,
      name: worldMapInstances.name,
      archetype: worldMapInstances.archetype,
    }).from(worldMapInstances).where(eq(worldMapInstances.id, row.runtime.currentMapId)).get(),
    db.select().from(worldNpcInventory).where(eq(worldNpcInventory.npcId, npcId)).all(),
    db.select().from(worldNpcLifeLogs).where(eq(worldNpcLifeLogs.npcId, npcId))
      .orderBy(desc(worldNpcLifeLogs.id))
      .limit(10)
      .all(),
    viewer.playerId
      ? listPlayerWorldContractsByNpc({
        playerId: viewer.playerId,
        npcId,
      }).catch(() => [])
      : Promise.resolve([]),
    getWorldNpcFactionHints({
      npcId,
      playerId: viewer.playerId,
    }).catch(() => null),
    listWorldNpcInvolvedStorylines(npcId).catch(() => []),
    viewer.playerId
      ? getSafePlayerWorldPressureSnapshot(viewer.playerId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const normalizedGrowthStats = normalizeOpenWorldNpcGrowthStats({
    dnaSeed: row.profile.dnaSeed,
    profession: row.profile.profession,
    traitTags: row.profile.traitTags,
    realmMinor: row.profile.realmMinor,
    statsSummary: row.profile.statsSummary,
  });
  const stats = toWorldNpcStats(normalizedGrowthStats);
  const inventoryProbe = buildWorldNpcInventoryProbe(viewer, Math.max(1, row.profile.realmMinor));
  const currentMapName = resolveWorldMapDisplayName(mapRow?.name, row.runtime.currentMapId);
  const currentDistrictName = resolveOpenWorldDistrictName({
    mapId: row.runtime.currentMapId,
    positionX: row.runtime.positionX,
    positionY: row.runtime.positionY,
  });
  const nearbyRelationRows = await loadNearbyActiveWorldNpcRows({
    mapId: row.runtime.currentMapId,
    excludeNpcId: npcId,
    sourcePositionX: row.runtime.positionX,
    sourcePositionY: row.runtime.positionY,
    radius: WORLD_NPC_RELATION_SUPPORT_RADIUS,
  });
  const nearbyFactionCount = nearbyRelationRows.filter((entry) => (
    String(entry.profile.faction || "").trim()
    && String(entry.profile.faction || "").trim() === String(row.profile.faction || "").trim()
  )).length;
  const nearbyDistrictCount = nearbyRelationRows.filter((entry) => (
    resolveOpenWorldDistrictName({
      mapId: row.runtime.currentMapId,
      positionX: entry.runtime.positionX,
      positionY: entry.runtime.positionY,
    }) === currentDistrictName
  )).length;
  const inventoryItemIds = inventoryRows.map((entry) => entry.itemId);
  const relatedPlayerIds = Array.from(new Set(
    logRows
      .map((entry) => resolveWorldNpcLogPlayerId(entry.payloadJson))
      .filter((playerId): playerId is string => Boolean(playerId)),
  ));
  const relatedPlayerRows = relatedPlayerIds.length > 0
    ? await db.select({
      id: players.id,
      name: players.name,
    }).from(players).where(inArray(players.id, relatedPlayerIds)).all()
    : [];
  const relatedPlayerNameMap = new Map(relatedPlayerRows.map((entry) => [entry.id, entry.name]));
  const itemRows = inventoryItemIds.length > 0
    ? await db.select({
      id: items.id,
      name: items.name,
      iconUrl: items.iconUrl,
      itemType: items.itemType,
      rarity: items.rarity,
    }).from(items).where(inArray(items.id, inventoryItemIds)).all()
    : [];
  const itemMap = new Map(itemRows.map((item) => [item.id, item]));
  const reputationReaction = viewer.playerId && worldPressureSnapshot
    ? buildPlayerWorldNpcAttitude({
      npcName: row.profile.name,
      pressure: worldPressureSnapshot.pressure,
      reputation: worldPressureSnapshot.reputation,
      bountyEnabled: false,
      shadowFriendlyEligible: true,
    })
    : null;

  return {
    npc: {
      id: row.profile.id,
      name: row.profile.name,
      gender: row.profile.gender,
      originType: row.profile.originType,
      profession: row.profile.profession,
      faction: row.profile.faction,
      realmName: row.profile.realmName,
      realmMajor: row.profile.realmMajor,
      realmMinor: row.profile.realmMinor,
      personalitySummary: row.profile.personalitySummary,
      traitTags: Array.isArray(row.profile.traitTags) ? row.profile.traitTags : [],
      statsSummary: stats,
      reincarnationCount: row.profile.reincarnationCount,
      isKillable: row.profile.isKillable,
      status: row.profile.status,
      avatarImageUrl: normalizeNpcAvatarImageUrl(row.profile.avatarImageUrl),
      portraitImageUrl: normalizeNpcPortraitImageUrl(row.profile.portraitImageUrl),
      currentAction: normalizeOpenWorldAction(row.runtime.currentAction),
      currentActionLabel: row.runtime.currentActionLabel || getOpenWorldActionLabel(row.runtime.currentAction),
      currentMapId: row.runtime.currentMapId,
      currentMapName,
      currentMapArchetype: mapRow?.archetype || null,
      currentDistrictName,
      positionX: row.runtime.positionX,
      positionY: row.runtime.positionY,
      occupiedByCombatId: row.runtime.occupiedByCombatId,
      mapType: "open_world",
    },
    fateSummary: buildWorldNpcFateSummary({
      originType: row.profile.originType,
      profession: row.profile.profession,
      faction: row.profile.faction,
      traitTags: row.profile.traitTags,
      reincarnationCount: row.profile.reincarnationCount,
    }),
    threatSummary: buildWorldNpcThreatSummary({
      runtime: row.runtime,
      viewerPlayerId: viewer.playerId,
    }),
    growthSummary: describeOpenWorldNpcGrowth({
      dnaSeed: row.profile.dnaSeed,
      profession: row.profile.profession,
      traitTags: row.profile.traitTags,
      realmMinor: row.profile.realmMinor,
      statsSummary: normalizedGrowthStats,
    }),
    relationSummary: buildWorldNpcRelationSummary({
      faction: row.profile.faction,
      currentDistrictName,
      nearbyFactionCount,
      nearbyDistrictCount,
      lifeLogs: logRows.map((entry) => ({
        logType: entry.logType,
        title: entry.title,
      })),
    }),
    inventoryProbe,
    inventory: inventoryProbe.mode === "blocked"
      ? []
      : inventoryRows.map((entry) => {
        const itemMeta = itemMap.get(entry.itemId);
        const itemTypeLabel = normalizeItemTypeLabel(itemMeta?.itemType);
        const rarityHint = normalizeRarityHint(itemMeta?.rarity);
        return {
          id: entry.id,
          itemId: null,
          itemName: `${rarityHint}${itemTypeLabel}`,
          itemIconUrl: null,
          quantity: entry.quantity,
          quantityLabel: normalizeQuantityHint(entry.quantity),
          isEquipped: entry.isEquipped,
          isLootable: entry.isLootable,
          slotType: entry.slotType,
          itemCategoryLabel: itemTypeLabel,
        };
      }),
    lifeLogs: logRows.map((entry) => buildWorldNpcLifeLogView({
      npcName: row.profile.name,
      viewerPlayerId: viewer.playerId,
      entry,
      playerNameMap: relatedPlayerNameMap,
    })),
    factionHints,
    involvedStorylines,
    shadowContracts,
    reputationSummary: worldPressureSnapshot?.reputation || null,
    reputationReaction,
    relationshipRepairHints: reputationReaction?.repairHints || [],
  };
}

export async function assertCanEngageWorldNpc(params: {
  playerId: string;
  npcId: string;
  allowRemoteEngage?: boolean;
}) {
  if (!(await ensureOpenWorldSchema())) {
    throw new Error("开放世界表结构尚未就绪");
  }
  const [playerRow, loadedNpc] = await Promise.all([
    db.select({
      id: players.id,
      currentMapId: players.currentMapId,
      positionX: players.positionX,
      positionY: players.positionY,
      name: players.name,
      realm: players.realm,
    }).from(players).where(eq(players.id, params.playerId)).get(),
    loadWorldNpcById(params.npcId),
  ]);

  if (!playerRow) {
    throw new Error("玩家不存在");
  }
  if (!loadedNpc) {
    throw new Error("世界 NPC 不存在");
  }

  const npcRow = await clearStaleWorldNpcOccupation(loadedNpc);
  if (npcRow.profile.status === "dead") {
    throw new Error("该世界 NPC 已身死道消");
  }
  if (!npcRow.profile.isKillable) {
    throw new Error("该世界 NPC 当前不可击杀");
  }
  if (!playerRow.currentMapId || npcRow.runtime.currentMapId !== playerRow.currentMapId) {
    throw new Error("不在同一张地图，无法发起交战");
  }
  if (
    !params.allowRemoteEngage
    && chebyshevDistance(
      playerRow.positionX,
      playerRow.positionY,
      npcRow.runtime.positionX,
      npcRow.runtime.positionY,
    ) > 1
  ) {
    throw new Error("距离过远，请先靠近目标");
  }
  if (npcRow.runtime.occupiedByCombatId) {
    throw new Error("该世界 NPC 正在与他人交战");
  }

  return {
    player: playerRow,
    npc: npcRow,
    monsterId: buildWorldNpcMonsterId(npcRow.profile.id),
  };
}

export async function occupyWorldNpcForCombat(params: {
  npcId: string;
  combatId: string;
  playerId?: string | null;
}) {
  if (!(await ensureOpenWorldSchema())) {
    return false;
  }
  const loadedNpc = await loadWorldNpcById(params.npcId);
  if (!loadedNpc) {
    return false;
  }
  const npcRow = await clearStaleWorldNpcOccupation(loadedNpc);
  if (npcRow.runtime.occupiedByCombatId) {
    return false;
  }

  await db.update(worldNpcRuntime).set({
    occupiedByCombatId: params.combatId,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(worldNpcRuntime.npcId, params.npcId),
    isNull(worldNpcRuntime.occupiedByCombatId),
  )).run();

  const latest = await db.select({
    occupiedByCombatId: worldNpcRuntime.occupiedByCombatId,
  }).from(worldNpcRuntime).where(eq(worldNpcRuntime.npcId, params.npcId)).get();
  const occupied = latest?.occupiedByCombatId === params.combatId;
  if (occupied && params.playerId) {
    await markWorldNpcHostileToPlayer({
      npcId: params.npcId,
      playerId: params.playerId,
      reason: "engage",
      lifeLogTitle: "记住了来犯者",
      lifeLogContent: `${npcRow.profile.name}察觉到来犯修士的杀机，已将这股气机牢牢记下。`,
    });
  }
  return occupied;
}

export async function releaseWorldNpcCombatOccupation(params: {
  npcId: string;
  combatId?: string | null;
}) {
  if (!(await ensureOpenWorldSchema())) {
    return;
  }
  const row = await db.select({
    occupiedByCombatId: worldNpcRuntime.occupiedByCombatId,
  }).from(worldNpcRuntime).where(eq(worldNpcRuntime.npcId, params.npcId)).get();
  if (!row) {
    return;
  }
  if (params.combatId && row.occupiedByCombatId && row.occupiedByCombatId !== params.combatId) {
    return;
  }

  await db.update(worldNpcRuntime).set({
    occupiedByCombatId: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(worldNpcRuntime.npcId, params.npcId)).run();
}

export async function getWorldNpcCombatTarget(npcId: string) {
  if (!(await ensureOpenWorldSchema())) {
    return null;
  }
  const row = await loadWorldNpcById(npcId);
  if (!row || row.profile.status === "dead") {
    return null;
  }
  const stats = toWorldNpcStats(normalizeOpenWorldNpcGrowthStats({
    dnaSeed: row.profile.dnaSeed,
    profession: row.profile.profession,
    traitTags: row.profile.traitTags,
    realmMinor: row.profile.realmMinor,
    statsSummary: row.profile.statsSummary,
  }));
  return {
    id: buildWorldNpcMonsterId(row.profile.id),
    npcId: row.profile.id,
    name: row.profile.name,
    avatarImageUrl: normalizeNpcAvatarImageUrl(row.profile.avatarImageUrl),
    realmName: row.profile.realmName,
    currentMapId: row.runtime.currentMapId,
    positionX: row.runtime.positionX,
    positionY: row.runtime.positionY,
    stats,
  };
}

export async function settleWorldNpcCombat(params: {
  playerId: string;
  npcId: string;
  combatId: string;
  result: "player_win" | "enemy_win" | "fled";
}) {
  if (!(await ensureOpenWorldSchema())) {
    return {
      npcName: "世界 NPC",
      drops: [] as CombatRewardDrop[],
      xp: 0,
      gold: 0,
    };
  }
  const row = await loadWorldNpcById(params.npcId);
  if (!row) {
    return {
      npcName: "世界 NPC",
      drops: [] as CombatRewardDrop[],
      xp: 0,
      gold: 0,
    };
  }
  const playerRow = await db.select({
    id: players.id,
    name: players.name,
  }).from(players).where(eq(players.id, params.playerId)).get();
  const playerDisplayName = String(playerRow?.name || "").trim() || "某位修士";
  const currentMapRow = await db.select({
    name: worldMapInstances.name,
  }).from(worldMapInstances).where(eq(worldMapInstances.id, row.runtime.currentMapId)).get();
  const currentMapName = resolveWorldMapDisplayName(currentMapRow?.name, row.runtime.currentMapId);

  if (params.result === "player_win") {
    const coreResult = await db.transaction(async (tx) => settleWorldNpcCombatVictoryCoreTx({
      tx,
      playerId: params.playerId,
      npcId: params.npcId,
      combatId: params.combatId,
      playerDisplayName,
    }));
    await runWorldNpcCombatVictoryPostTasks({
      playerId: params.playerId,
      npcId: params.npcId,
      npcName: coreResult.npcName,
      mapId: coreResult.mapId,
      districtName: coreResult.districtName,
      sourceFaction: coreResult.sourceFaction,
      sourcePositionX: coreResult.sourcePositionX,
      sourcePositionY: coreResult.sourcePositionY,
      drops: coreResult.drops,
    });

    return {
      npcName: coreResult.npcName,
      drops: coreResult.drops,
      xp: 0,
      gold: 0,
    };
  }

  await releaseWorldNpcCombatOccupation({
    npcId: params.npcId,
    combatId: params.combatId,
  });
  await markWorldNpcHostileToPlayer({
    npcId: params.npcId,
    playerId: params.playerId,
    reason: params.result === "enemy_win" ? "repelled_player" : "escaped_player",
  });
  await db.insert(worldNpcLifeLogs).values({
    npcId: params.npcId,
    logType: params.result === "enemy_win" ? "repelled_player" : "escaped_player",
    title: params.result === "enemy_win" ? "逼退来犯者" : "来犯者遁走",
    content: params.result === "enemy_win"
      ? `${row.profile.name}击退了${playerDisplayName}，继续在${currentMapName}活动。`
      : `${row.profile.name}眼见${playerDisplayName}遁走，收敛战意，重新回到日常行动中。`,
    payloadJson: {
      combatId: params.combatId,
      playerId: params.playerId,
      playerName: playerDisplayName,
    },
    createdAt: new Date().toISOString(),
  }).run();
  const witnessResult = await propagateWorldNpcWitnessHostility({
    mapId: row.runtime.currentMapId,
    playerId: params.playerId,
    sourceNpcId: row.profile.id,
    sourceNpcName: row.profile.name,
    sourceFaction: row.profile.faction,
    sourceDistrictName: resolveOpenWorldDistrictName({
      mapId: row.runtime.currentMapId,
      positionX: row.runtime.positionX,
      positionY: row.runtime.positionY,
    }),
    sourcePositionX: row.runtime.positionX,
    sourcePositionY: row.runtime.positionY,
    eventType: "combat",
  });
  if (witnessResult.witnessCount > 0) {
    await applyPlayerWorldIncident({
      playerId: params.playerId,
      incidentType: "witnessed",
      sourceType: "world_npc",
      sourceId: row.profile.id,
      mapId: row.runtime.currentMapId,
      districtName: resolveOpenWorldDistrictName({
        mapId: row.runtime.currentMapId,
        positionX: row.runtime.positionX,
        positionY: row.runtime.positionY,
      }),
      severity: Math.min(4, 1 + witnessResult.witnessCount),
      summary: `${witnessResult.witnessCount} 名附近修士记住了你和 ${row.profile.name} 这场争斗。`,
      payloadJson: {
        npcId: row.profile.id,
        npcName: row.profile.name,
        witnessCount: witnessResult.witnessCount,
      },
    });
  }

  return {
    npcName: row.profile.name,
    drops: [] as CombatRewardDrop[],
    xp: 0,
    gold: 0,
  };
}

export async function settleWorldNpcCombatVictoryCoreTx(params: {
  tx: RewardTx;
  playerId: string;
  npcId: string;
  combatId: string;
  playerDisplayName: string;
}) {
  const row = await params.tx.select({
    profile: worldNpcProfiles,
    runtime: worldNpcRuntime,
  }).from(worldNpcProfiles)
    .innerJoin(worldNpcRuntime, eq(worldNpcRuntime.npcId, worldNpcProfiles.id))
    .where(eq(worldNpcProfiles.id, params.npcId))
    .get();

  if (!row) {
    return {
      npcName: "世界 NPC",
      drops: [] as CombatRewardDrop[],
      mapId: null as string | null,
      districtName: null as string | null,
      sourceFaction: null as string | null,
      sourcePositionX: 0,
      sourcePositionY: 0,
    };
  }

  const lootRows = await params.tx.select().from(worldNpcInventory)
    .where(and(
      eq(worldNpcInventory.npcId, params.npcId),
      eq(worldNpcInventory.isLootable, true),
    ))
    .all();
  const drops: CombatRewardDrop[] = [];
  for (const lootRow of lootRows) {
    const quantity = Math.max(1, lootRow.quantity);
    await upsertPlayerInventoryItemTx({
      tx: params.tx,
      playerId: params.playerId,
      itemId: lootRow.itemId,
      quantity,
    });
    drops.push({
      itemId: lootRow.itemId,
      quantity,
      itemName: lootRow.itemNameSnapshot || lootRow.itemId,
      itemIconUrl: lootRow.itemIconUrl || null,
    });
  }

  if (lootRows.length > 0) {
    await params.tx.delete(worldNpcInventory).where(eq(worldNpcInventory.npcId, params.npcId)).run();
  }

  const nowIso = new Date().toISOString();
  await params.tx.update(worldNpcProfiles).set({
    status: "dead",
    updatedAt: nowIso,
  }).where(eq(worldNpcProfiles.id, params.npcId)).run();
  await params.tx.update(worldNpcRuntime).set({
    currentAction: "dead",
    currentActionLabel: OPEN_WORLD_ACTION_LABELS.dead,
    currentTargetType: null,
    currentTargetId: null,
    nextActionAt: null,
    occupiedByCombatId: null,
    isActivated: false,
    updatedAt: nowIso,
  }).where(eq(worldNpcRuntime.npcId, params.npcId)).run();
  await params.tx.insert(worldNpcLifeLogs).values({
    npcId: params.npcId,
    logType: "killed_by_player",
    title: "横死街头",
    content: `${row.profile.name}被${params.playerDisplayName}击败，所携物资尽数被夺。`,
    payloadJson: {
      combatId: params.combatId,
      playerId: params.playerId,
      playerName: params.playerDisplayName,
      drops,
    },
    createdAt: nowIso,
  }).run();

  return {
    npcName: row.profile.name,
    drops,
    mapId: row.runtime.currentMapId,
    districtName: resolveOpenWorldDistrictName({
      mapId: row.runtime.currentMapId,
      positionX: row.runtime.positionX,
      positionY: row.runtime.positionY,
    }),
    sourceFaction: row.profile.faction,
    sourcePositionX: row.runtime.positionX,
    sourcePositionY: row.runtime.positionY,
  };
}

export async function runWorldNpcCombatVictoryPostTasks(params: {
  playerId: string;
  npcId: string;
  npcName: string;
  mapId: string | null;
  districtName: string | null;
  sourceFaction: string | null;
  sourcePositionX: number;
  sourcePositionY: number;
  drops: CombatRewardDrop[];
}) {
  if (!params.mapId) {
    return {
      witnessCount: 0,
    };
  }

  const districtName = params.districtName || resolveOpenWorldDistrictName({
    mapId: params.mapId,
    positionX: params.sourcePositionX,
    positionY: params.sourcePositionY,
  });
  const witnessResult = await propagateWorldNpcWitnessHostility({
    mapId: params.mapId,
    playerId: params.playerId,
    sourceNpcId: params.npcId,
    sourceNpcName: params.npcName,
    sourceFaction: params.sourceFaction,
    sourceDistrictName: districtName,
    sourcePositionX: params.sourcePositionX,
    sourcePositionY: params.sourcePositionY,
    eventType: "killing",
  });
  await applyPlayerWorldIncident({
    playerId: params.playerId,
    incidentType: "kill_and_loot",
    sourceType: "world_npc",
    sourceId: params.npcId,
    mapId: params.mapId,
    districtName,
    severity: witnessResult.witnessCount > 0 ? 4 : 3,
    summary: witnessResult.witnessCount > 0
      ? `${params.npcName}被你击败后，当地已有风声与目击者开始扩散。`
      : `${params.npcName}被你击败，夺宝之举已被天道记下一笔。`,
    payloadJson: {
      npcId: params.npcId,
      npcName: params.npcName,
      witnessCount: witnessResult.witnessCount,
      drops: params.drops,
    },
  });
  await completePlayerWorldNpcKillContracts({
    playerId: params.playerId,
    npcId: params.npcId,
    npcName: params.npcName,
    mapId: params.mapId,
    districtName,
  });

  return witnessResult;
}

export async function reincarnateWorldNpc(npcId: string) {
  if (!(await ensureOpenWorldSchema())) {
    return null;
  }
  const row = await loadWorldNpcById(npcId);
  if (!row || row.profile.status !== "dead") {
    return null;
  }

  const slot = parseNpcSlot(npcId);
  const reincarnationCount = row.profile.reincarnationCount + 1;
  const dnaSeed = `${row.profile.id}:reincarnation:${reincarnationCount}`;
  const mapRow = await db.select({
    name: worldMapInstances.name,
    archetype: worldMapInstances.archetype,
  }).from(worldMapInstances).where(eq(worldMapInstances.id, row.profile.worldMapId)).get();
  const mapDisplayName = resolveWorldMapDisplayName(mapRow?.name, row.runtime.currentMapId);
  const mapDraft = buildOpenWorldMapDrafts().find((entry) => entry.id === row.profile.worldMapId) || null;
  const customNpc = findOpenWorldCustomNpcByGeneratedId(npcId);
  const archetypeProfile = getOpenWorldNpcArchetypeProfile(
    (mapRow?.archetype || "凡人城镇") as Parameters<typeof getOpenWorldNpcArchetypeProfile>[0],
  );
  const femaleNamePool = getOpenWorldFemaleNamePool();
  const maleNamePool = getOpenWorldMaleNamePool();
  const traitPool = getOpenWorldNpcTraitPool();
  const gender = customNpc?.gender || ((hashSeed(`${dnaSeed}:gender`) % 2 === 0 ? "male" : "female") as "male" | "female");
  const fallbackName = customNpc?.name || pickBySeed(gender === "female" ? femaleNamePool : maleNamePool, dnaSeed, slot);
  const traitTags = [
    ...(customNpc?.traitTags?.slice(0, 3) || []),
    pickBySeed(traitPool, dnaSeed, 1),
    pickBySeed(traitPool, dnaSeed, 2),
    row.profile.traitTags?.[0] || pickBySeed(traitPool, dnaSeed, 3),
  ].filter((value, index, list) => list.indexOf(value) === index);
  const realmMinor = Math.max(
    1,
    Math.min(
      OPEN_WORLD_REALM_NAMES.length - 1,
      customNpc
        ? customNpc.realmMinor
        : (row.profile.realmMinor > 4 ? row.profile.realmMinor - 1 : row.profile.realmMinor),
    ),
  );
  const fallbackOriginType = customNpc?.originType || pickBySeed(archetypeProfile.origins, dnaSeed, 4);
  const fallbackProfession = customNpc?.profession || pickBySeed(archetypeProfile.professions, dnaSeed, 5);
  const fallbackFaction = customNpc?.faction || pickBySeed(archetypeProfile.factions, dnaSeed, 6);
  const fallbackPersonalitySummary = customNpc?.personalitySummary || buildOpenWorldNpcPersonalitySummary({
    seed: `${dnaSeed}:reincarnated`,
    name: fallbackName,
    originType: fallbackOriginType,
    profession: fallbackProfession,
    faction: fallbackFaction,
    traitTags,
  });
  const previousStats = row.profile.statsSummary || {};
  const actionCycle = ["wander", "gather", "hunt", "loot", "return", "stall"] as const;
  const currentAction = actionCycle[hashSeed(`${dnaSeed}:action`) % actionCycle.length];
  const fallbackActionLabel = buildOpenWorldNpcActionLabel({
    action: currentAction,
    seed: `${dnaSeed}:reincarnation-action`,
    profession: fallbackProfession,
    faction: fallbackFaction,
    traitTags,
  });
  const npcDraft: GeneratedOpenWorldNpcDraft = {
    id: npcId,
    worldMapId: row.profile.worldMapId,
    sourceType: customNpc ? "custom" : "random",
    customNpcId: customNpc?.id || null,
    name: fallbackName,
    gender,
    originType: fallbackOriginType,
    profession: fallbackProfession,
    faction: fallbackFaction,
    realmName: getOpenWorldNpcRealmName(realmMinor),
    realmMajor: 1,
    realmMinor,
    personalitySummary: fallbackPersonalitySummary,
    dnaSeed,
    traitTags,
    worldBookKeywords: customNpc?.worldBookKeywords || [],
    adultTags: customNpc?.adultTags || [],
    grayTags: customNpc?.grayTags || [],
    partnerIds: customNpc?.partnerIds || [],
    primaryPartnerId: customNpc?.primaryPartnerId || null,
    relationshipTags: customNpc?.relationshipTags || [],
    behaviorWeights: archetypeProfile.behaviorWeights,
    statsSummary: previousStats,
    avatarImageUrl: row.profile.avatarImageUrl,
    portraitImageUrl: row.profile.portraitImageUrl,
    runtime: {
      currentMapId: row.runtime.currentMapId,
      positionX: row.runtime.positionX,
      positionY: row.runtime.positionY,
      currentAction,
      currentActionLabel: fallbackActionLabel,
      isActivated: slot <= OPEN_WORLD_ACTIVE_NPC_LIMIT,
    },
    initialLifeLog: {
      logType: "reincarnated",
      title: "轮回补位",
      content: `${fallbackName}承接旧壳残痕，于${mapDisplayName}再度醒转。`,
      payloadJson: {
        reincarnationCount,
        mapId: row.runtime.currentMapId,
        carriedThreat: false,
      },
    },
  };
  const npcDnaProfile = mapDraft && !customNpc
    ? await generateOpenWorldNpcDnaProfile({
      mapDraft,
      npcDraft,
    })
    : null;
  const name = npcDnaProfile?.name || fallbackName;
  const finalOriginType = npcDnaProfile?.originType || fallbackOriginType;
  const finalProfession = npcDnaProfile?.profession || fallbackProfession;
  const finalFaction = npcDnaProfile?.faction || fallbackFaction;
  const finalTraitTags = npcDnaProfile?.traitTags || traitTags;
  const finalPersonalitySummary = npcDnaProfile?.personalitySummary || fallbackPersonalitySummary;
  const carriedStats = {
    growthProgress: Math.floor(Number(previousStats.growthProgress || 0) * 0.35),
    idleExp: Math.floor(Number(previousStats.idleExp || 0) * 0.3),
    wanderExp: Math.floor(Number(previousStats.wanderExp || 0) * 0.4),
    gatherExp: Math.floor(Number(previousStats.gatherExp || 0) * 0.4),
    huntExp: Math.floor(Number(previousStats.huntExp || 0) * 0.4),
    lootExp: Math.floor(Number(previousStats.lootExp || 0) * 0.4),
    returnExp: Math.floor(Number(previousStats.returnExp || 0) * 0.35),
    stallExp: Math.floor(Number(previousStats.stallExp || 0) * 0.4),
  };
  const statsSummary = normalizeOpenWorldNpcGrowthStats({
    dnaSeed,
    realmMinor,
    profession: finalProfession,
    traitTags: finalTraitTags,
    statsSummary: {
      ...buildInitialOpenWorldNpcStats({
        seed: dnaSeed,
        realmMinor,
        profession: finalProfession,
        traitTags: finalTraitTags,
      }),
      ...carriedStats,
    },
  });
  const currentActionLabel = buildOpenWorldNpcActionLabel({
    action: currentAction,
    seed: `${dnaSeed}:reincarnation-action`,
    profession: finalProfession,
    faction: finalFaction,
    traitTags: finalTraitTags,
  });

  await db.update(worldNpcProfiles).set({
    name,
    gender,
    originType: finalOriginType,
    profession: finalProfession,
    faction: finalFaction,
    realmName: getOpenWorldNpcRealmName(realmMinor),
    personalitySummary: finalPersonalitySummary,
    dnaSeed,
    traitTags: finalTraitTags,
    behaviorWeights: npcDnaProfile?.behaviorWeights || archetypeProfile.behaviorWeights,
    statsSummary,
    reincarnationCount,
    status: "active",
    avatarImageUrl: row.profile.avatarImageUrl,
    portraitImageUrl: row.profile.portraitImageUrl,
    updatedAt: new Date().toISOString(),
  }).where(eq(worldNpcProfiles.id, npcId)).run();

  await db.update(worldNpcRuntime).set({
    currentAction,
    currentActionLabel,
    currentTargetType: null,
    currentTargetId: null,
    nextActionAt: null,
    occupiedByCombatId: null,
    isActivated: slot <= OPEN_WORLD_ACTIVE_NPC_LIMIT,
    updatedAt: new Date().toISOString(),
  }).where(eq(worldNpcRuntime.npcId, npcId)).run();

  const itemPool = await db.select({
    id: items.id,
    name: items.name,
    iconUrl: items.iconUrl,
  }).from(items).limit(12).all();
  const reincarnationItem = itemPool.length > 0
    ? itemPool[hashSeed(`${dnaSeed}:loot`) % itemPool.length]
    : null;
  await db.delete(worldNpcInventory).where(eq(worldNpcInventory.npcId, npcId)).run();
  if (reincarnationItem) {
    await db.insert(worldNpcInventory).values({
      id: `${npcId}:loot:reincarnation:${reincarnationCount}`,
      npcId,
      itemId: reincarnationItem.id,
      itemNameSnapshot: reincarnationItem.name,
      itemIconUrl: reincarnationItem.iconUrl,
      quantity: 1,
      isEquipped: false,
      isLootable: true,
      slotType: "fated",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  }

  await db.insert(worldNpcLifeLogs).values({
    npcId,
    logType: "reincarnated",
    title: "轮回补位",
    content: `${name}承接旧壳残痕，于${mapDisplayName}再度醒转。`,
    payloadJson: {
      reincarnationCount,
      mapId: row.runtime.currentMapId,
      carriedThreat: false,
    },
    createdAt: new Date().toISOString(),
  }).run();

  return {
    npcId,
    name,
    reincarnationCount,
  };
}
