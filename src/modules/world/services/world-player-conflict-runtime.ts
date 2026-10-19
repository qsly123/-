import { nanoid } from "nanoid";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";

const OPEN_WORLD_PLAYER_ONLINE_TTL_MS = 45_000;
const OPEN_WORLD_ASSASSINATION_EVENT_TTL_MS = 90_000;
const WORLD_NPC_MONSTER_ID_PREFIX = "world-npc:";

type OpenWorldPlayerPresence = {
  playerId: string;
  playerName: string;
  mapId: string;
  mapName: string;
  mapType: string;
  positionX: number;
  positionY: number;
  realm: number;
  updatedAt: number;
};

type OpenWorldAssassinationStage = "pending" | "combat_ready";

type OpenWorldAssassinationEvent = {
  id: string;
  playerId: string;
  mapId: string;
  npcId: string;
  npcName: string;
  npcRealmName: string;
  npcFaction: string | null;
  npcProfession: string | null;
  districtName: string | null;
  threatLevel: "low" | "medium" | "high";
  threatLabel: string;
  probeSummary: string;
  assassinationSummary: string;
  intro: string;
  escapeChance: number;
  escapeDifficultyLabel: string;
  stage: OpenWorldAssassinationStage;
  createdAt: number;
  expiresAt: number;
};

type OpenWorldConflictGlobal = typeof globalThis & {
  __openWorldPlayerPresenceByPlayerId?: Map<string, OpenWorldPlayerPresence>;
  __openWorldAssassinationEventsByPlayerId?: Map<string, OpenWorldAssassinationEvent>;
};

export type OpenWorldAssassinationView = {
  id: string;
  npcId: string;
  npcName: string;
  npcRealmName: string;
  npcFaction: string | null;
  npcProfession: string | null;
  districtName: string | null;
  threatLevel: "low" | "medium" | "high";
  threatLabel: string;
  probeSummary: string;
  assassinationSummary: string;
  intro: string;
  escapeChancePercent: number;
  escapeDifficultyLabel: string;
  createdAt: string;
};

export type OpenWorldAssassinationRuntimeView = OpenWorldAssassinationView & {
  stage: OpenWorldAssassinationStage;
};

function getPresenceByPlayerId() {
  const globalStore = globalThis as OpenWorldConflictGlobal;
  globalStore.__openWorldPlayerPresenceByPlayerId = ensureGlobalMap<string, OpenWorldPlayerPresence>(
    globalStore as Record<string, unknown>,
    "__openWorldPlayerPresenceByPlayerId",
  );
  return globalStore.__openWorldPlayerPresenceByPlayerId;
}

function getAssassinationEventsByPlayerId() {
  const globalStore = globalThis as OpenWorldConflictGlobal;
  globalStore.__openWorldAssassinationEventsByPlayerId = ensureGlobalMap<string, OpenWorldAssassinationEvent>(
    globalStore as Record<string, unknown>,
    "__openWorldAssassinationEventsByPlayerId",
  );
  return globalStore.__openWorldAssassinationEventsByPlayerId;
}

function pruneExpiredWorldConflictRuntime(now = Date.now()) {
  for (const [playerId, presence] of getPresenceByPlayerId().entries()) {
    if (now - presence.updatedAt > OPEN_WORLD_PLAYER_ONLINE_TTL_MS) {
      getPresenceByPlayerId().delete(playerId);
    }
  }

  for (const [playerId, event] of getAssassinationEventsByPlayerId().entries()) {
    if (event.expiresAt <= now) {
      getAssassinationEventsByPlayerId().delete(playerId);
    }
  }
}

function normalizeEscapeChance(value: number) {
  return Math.max(0.12, Math.min(0.78, value));
}

function toAssassinationView(event: OpenWorldAssassinationEvent): OpenWorldAssassinationView {
  return {
    id: event.id,
    npcId: event.npcId,
    npcName: event.npcName,
    npcRealmName: event.npcRealmName,
    npcFaction: event.npcFaction,
    npcProfession: event.npcProfession,
    districtName: event.districtName,
    threatLevel: event.threatLevel,
    threatLabel: event.threatLabel,
    probeSummary: event.probeSummary,
    assassinationSummary: event.assassinationSummary,
    intro: event.intro,
    escapeChancePercent: Math.round(event.escapeChance * 100),
    escapeDifficultyLabel: event.escapeDifficultyLabel,
    createdAt: new Date(event.createdAt).toISOString(),
  };
}

function toAssassinationRuntimeView(event: OpenWorldAssassinationEvent): OpenWorldAssassinationRuntimeView {
  return {
    ...toAssassinationView(event),
    stage: event.stage,
  };
}

export function buildWorldNpcMonsterIdFromNpcId(npcId: string) {
  return `${WORLD_NPC_MONSTER_ID_PREFIX}${npcId}`;
}

export function canMapReceiveWorldAssassination(mapType: string | null | undefined) {
  const normalizedMapType = String(mapType || "").trim();
  if (!normalizedMapType) {
    return false;
  }
  return normalizedMapType !== "secret_realm_instance" && normalizedMapType !== "sect";
}

export function markOpenWorldPlayerPresence(params: {
  playerId: string;
  playerName: string;
  mapId: string;
  mapName: string;
  mapType: string;
  positionX: number;
  positionY: number;
  realm: number;
}) {
  pruneExpiredWorldConflictRuntime();
  getPresenceByPlayerId().set(params.playerId, {
    ...params,
    updatedAt: Date.now(),
  });
}

export function listOnlineOpenWorldPlayersByMap(mapId: string, options?: {
  excludePlayerId?: string | null;
}) {
  pruneExpiredWorldConflictRuntime();
  const excludedPlayerId = String(options?.excludePlayerId || "").trim();
  return Array.from(getPresenceByPlayerId().values())
    .filter((presence) => presence.mapId === mapId)
    .filter((presence) => !excludedPlayerId || presence.playerId !== excludedPlayerId);
}

export function listOnlineWorldConflictPlayers(options?: {
  excludePlayerId?: string | null;
}) {
  pruneExpiredWorldConflictRuntime();
  const excludedPlayerId = String(options?.excludePlayerId || "").trim();
  return Array.from(getPresenceByPlayerId().values())
    .filter((presence) => canMapReceiveWorldAssassination(presence.mapType))
    .filter((presence) => !excludedPlayerId || presence.playerId !== excludedPlayerId);
}

export function peekPendingOpenWorldAssassinationForPlayer(playerId: string) {
  pruneExpiredWorldConflictRuntime();
  const current = getAssassinationEventsByPlayerId().get(playerId);
  if (!current || current.stage !== "pending") {
    return null;
  }
  return toAssassinationView(current);
}

export function peekOpenWorldAssassinationRuntimeForPlayer(playerId: string) {
  pruneExpiredWorldConflictRuntime();
  const current = getAssassinationEventsByPlayerId().get(playerId);
  if (!current) {
    return null;
  }
  return toAssassinationRuntimeView(current);
}

export function queueOpenWorldAssassinationEvent(params: {
  playerId: string;
  mapId: string;
  npcId: string;
  npcName: string;
  npcRealmName: string;
  npcFaction?: string | null;
  npcProfession?: string | null;
  districtName?: string | null;
  threatLevel: "low" | "medium" | "high";
  probeSummary: string;
  assassinationSummary: string;
  intro: string;
  escapeChance: number;
}) {
  pruneExpiredWorldConflictRuntime();
  const existing = getAssassinationEventsByPlayerId().get(params.playerId);
  if (existing) {
    return {
      queued: false,
      event: toAssassinationView(existing),
    };
  }

  const threatLabel = params.threatLevel === "high"
    ? "杀机逼近"
    : params.threatLevel === "medium"
      ? "暗潮窥伺"
      : "风声不善";
  const escapeDifficultyLabel = params.threatLevel === "high"
    ? "遁逃艰难"
    : params.threatLevel === "medium"
      ? "可搏一线"
      : "尚有转圜";
  const now = Date.now();
  const event: OpenWorldAssassinationEvent = {
    id: `world-assassination:${nanoid(10)}`,
    playerId: params.playerId,
    mapId: params.mapId,
    npcId: params.npcId,
    npcName: params.npcName,
    npcRealmName: params.npcRealmName,
    npcFaction: params.npcFaction || null,
    npcProfession: params.npcProfession || null,
    districtName: params.districtName || null,
    threatLevel: params.threatLevel,
    threatLabel,
    probeSummary: params.probeSummary,
    assassinationSummary: params.assassinationSummary,
    intro: params.intro,
    escapeChance: normalizeEscapeChance(params.escapeChance),
    escapeDifficultyLabel,
    stage: "pending",
    createdAt: now,
    expiresAt: now + OPEN_WORLD_ASSASSINATION_EVENT_TTL_MS,
  };
  getAssassinationEventsByPlayerId().set(params.playerId, event);
  return {
    queued: true,
    event: toAssassinationView(event),
  };
}

export function resolveOpenWorldAssassinationChoice(params: {
  playerId: string;
  eventId: string;
  action: "escape" | "fight";
}) {
  pruneExpiredWorldConflictRuntime();
  const event = getAssassinationEventsByPlayerId().get(params.playerId);
  if (!event || event.id !== params.eventId) {
    return {
      success: false as const,
      error: "刺杀气机已散，当前无有效来袭。",
    };
  }
  if (event.stage !== "pending") {
    return {
      success: false as const,
      error: "此刺杀事件已进入下一阶段。",
    };
  }

  if (params.action === "escape") {
    const escaped = Math.random() < event.escapeChance;
    if (escaped) {
      getAssassinationEventsByPlayerId().delete(params.playerId);
      return {
        success: true as const,
        escaped: true,
        combatRequired: false,
        narrative: `你在${event.districtName || "附近"}强行敛息遁走，暂时甩开了${event.npcName}的杀机。`,
      };
    }
  }

  const combatReadyEvent: OpenWorldAssassinationEvent = {
    ...event,
    stage: "combat_ready",
    expiresAt: Date.now() + 30_000,
  };
  getAssassinationEventsByPlayerId().set(params.playerId, combatReadyEvent);
  return {
    success: true as const,
    escaped: false,
    combatRequired: true,
    narrative: params.action === "escape"
      ? `${event.npcName}已锁定你的气机，遁逃失败，只能正面迎战。`
      : `${event.npcName}不再遮掩杀机，已逼到你面前。`,
    event: toAssassinationView(combatReadyEvent),
    monsterId: buildWorldNpcMonsterIdFromNpcId(event.npcId),
  };
}

export function canOpenWorldAssassinationStartCombat(params: {
  playerId: string;
  eventId: string;
  npcId: string;
}) {
  pruneExpiredWorldConflictRuntime();
  const event = getAssassinationEventsByPlayerId().get(params.playerId);
  return Boolean(
    event
    && event.id === params.eventId
    && event.stage === "combat_ready"
    && event.npcId === params.npcId,
  );
}

export function consumeOpenWorldAssassinationCombat(params: {
  playerId: string;
  eventId: string;
  npcId: string;
}) {
  const allowed = canOpenWorldAssassinationStartCombat(params);
  if (!allowed) {
    return false;
  }
  getAssassinationEventsByPlayerId().delete(params.playerId);
  return true;
}
