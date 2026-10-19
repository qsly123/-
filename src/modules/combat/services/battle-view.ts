import type { BattleSceneSnapshot } from "@/modules/combat/services/battle-scene-state";
import type {
  BattleParticipantSummary,
  BattleRuntimeState,
  BattleViewState,
  BossParticipant,
  CombatState,
  CombatTurnState,
  CombatUnit,
  PvpReplayData,
} from "@/types/game";

function resolveTurnStateFromCombatState(state: CombatState): CombatTurnState | null {
  const turnOrder = Array.isArray(state.turnOrder)
    ? state.turnOrder.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const currentTurnPlayerId = typeof state.currentTurnPlayerId === "string"
    ? state.currentTurnPlayerId
    : null;
  const turnDeadlineAt = typeof state.turnDeadlineAt === "string"
    ? state.turnDeadlineAt
    : null;
  const eligibleMemberIds = Array.isArray(state.eligibleMemberIds)
    ? state.eligibleMemberIds.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

  if (!turnOrder.length && !currentTurnPlayerId && !turnDeadlineAt) {
    return null;
  }

  return {
    turnOrder,
    currentTurnPlayerId,
    turnIndex: Number.isFinite(state.turnIndex) ? Number(state.turnIndex) : 0,
    turnDeadlineAt,
    eligibleMemberIds,
  };
}

function resolveRuntimeStateByCombatStatus(status?: CombatState["status"] | null): BattleRuntimeState {
  if (status === "ongoing") {
    return "active";
  }
  if (status === "player_win" || status === "enemy_win" || status === "fled") {
    return "finished";
  }
  return "preparing";
}

function toParticipantSummaryFromCombatUnit(
  unit: CombatUnit,
  role: "player" | "enemy" | "boss",
  options?: {
    slot?: number | null;
    isCurrent?: boolean;
  },
): BattleParticipantSummary {
  return {
    id: unit.id,
    name: unit.name,
    role,
    slot: options?.slot ?? null,
    currentHp: unit.hp,
    maxHp: unit.maxHp,
    currentMp: unit.mp,
    maxMp: unit.maxMp,
    avatarImageUrl: unit.avatarImageUrl,
    avatarFrameImageUrl: unit.avatarFrameImageUrl,
    isCurrent: options?.isCurrent,
  };
}

function toParticipantSummaryFromBossParticipant(
  participant: BossParticipant,
  options?: {
    isCurrent?: boolean;
  },
): BattleParticipantSummary {
  return {
    id: participant.playerId,
    name: participant.playerName,
    role: "player",
    slot: participant.slot,
    currentHp: participant.hp,
    maxHp: participant.maxHp,
    currentMp: participant.mp,
    maxMp: participant.maxMp,
    avatarImageUrl: participant.avatarImageUrl,
    avatarFrameImageUrl: participant.avatarFrameImageUrl,
    isCurrent: options?.isCurrent,
  };
}

export function buildCombatBattleViewState(params: {
  runtimeId: string;
  mode: "solo" | "party";
  state: CombatState;
  sceneSnapshot?: BattleSceneSnapshot | null;
  turnState?: CombatTurnState | null;
  viewerPlayerId?: string | null;
}): BattleViewState {
  const resolvedTurnState = params.turnState || resolveTurnStateFromCombatState(params.state);
  const viewerPlayerId = params.viewerPlayerId?.trim() || params.state.player.id;
  const viewerUnit = params.state.participants?.find((unit) => unit.id === viewerPlayerId) || params.state.player;
  const participants = params.state.participants?.length
    ? params.state.participants.map((unit, index) => toParticipantSummaryFromCombatUnit(unit, "player", {
      slot: index,
      isCurrent: unit.id === resolvedTurnState?.currentTurnPlayerId,
    }))
    : [toParticipantSummaryFromCombatUnit(viewerUnit, "player", {
      slot: 0,
      isCurrent: true,
    })];
  const currentActorName = resolvedTurnState?.currentTurnPlayerId
    ? (
      params.state.participants?.find((unit) => unit.id === resolvedTurnState.currentTurnPlayerId)?.name
      || (resolvedTurnState.currentTurnPlayerId === params.state.player.id ? params.state.player.name : "")
      || "当前行动方"
    )
    : "";

  return {
    runtimeId: params.runtimeId,
    mode: params.mode,
    runtimeState: resolveRuntimeStateByCombatStatus(params.state.status),
    title: params.mode === "party" ? "组队战斗" : "普通战斗",
    subtitle: params.state.enemy.name || null,
    statusText: params.state.status === "ongoing"
      ? (
        params.mode === "party" && currentActorName
          ? `共享回合推进中 · 当前轮到 ${currentActorName}`
          : params.mode === "party"
            ? "共享回合推进中"
            : "战斗进行中"
      )
      : "战斗已结束",
    hero: toParticipantSummaryFromCombatUnit(viewerUnit, "player", {
      isCurrent: viewerUnit.id === resolvedTurnState?.currentTurnPlayerId,
    }),
    target: toParticipantSummaryFromCombatUnit(params.state.enemy, "enemy"),
    participants,
    turnState: resolvedTurnState,
    sceneSnapshot: params.sceneSnapshot || null,
    modePayload: {
      combatStatus: params.state.status,
      logLength: params.state.log.length,
      viewerPlayerId,
    },
  };
}

export function buildBossBattleViewState(params: {
  runtimeId: string;
  bossName: string;
  currentHp: number;
  maxHp: number;
  participants: BossParticipant[];
  turnState?: CombatTurnState | null;
  sceneSnapshot?: BattleSceneSnapshot | null;
  viewerPlayerId?: string | null;
  statusText?: string | null;
  modePayload?: Record<string, unknown> | null;
}): BattleViewState {
  const participantSummaries = params.participants.map((participant) => toParticipantSummaryFromBossParticipant(participant, {
    isCurrent: participant.playerId === params.turnState?.currentTurnPlayerId,
  }));
  const hero = participantSummaries.find((participant) => participant.id === params.viewerPlayerId) || null;

  return {
    runtimeId: params.runtimeId,
    mode: "boss",
    runtimeState: params.currentHp > 0 ? "active" : "finished",
    title: params.bossName || "首领战",
    subtitle: "世界首领 / 秘境首领",
    statusText: params.statusText || (params.currentHp > 0 ? "首领交战中" : "首领已被击败"),
    hero,
    target: {
      id: `boss:${params.runtimeId}`,
      name: params.bossName || "首领",
      role: "boss",
      currentHp: params.currentHp,
      maxHp: params.maxHp,
    },
    participants: participantSummaries,
    turnState: params.turnState || null,
    sceneSnapshot: params.sceneSnapshot || null,
    modePayload: params.modePayload || null,
  };
}

export function buildPvpBattleViewState(replay: PvpReplayData): BattleViewState {
  return {
    runtimeId: replay.combatId,
    mode: "pvp",
    runtimeState: "finished",
    title: "论道回放",
    subtitle: `${replay.winner.name} vs ${replay.loser.name}`,
    statusText: replay.result === "win" ? "当前视角胜出" : "当前视角落败",
    hero: toParticipantSummaryFromCombatUnit(replay.state.player, "player", {
      isCurrent: true,
    }),
    target: toParticipantSummaryFromCombatUnit(replay.state.enemy, "enemy"),
    participants: [
      toParticipantSummaryFromCombatUnit(replay.state.player, "player", {
        slot: 0,
        isCurrent: true,
      }),
      toParticipantSummaryFromCombatUnit(replay.state.enemy, "enemy", {
        slot: 1,
      }),
    ],
    turnState: null,
    sceneSnapshot: null,
    modePayload: {
      turns: replay.turns,
      result: replay.result,
      winnerId: replay.winner.id,
      loserId: replay.loser.id,
    },
  };
}
