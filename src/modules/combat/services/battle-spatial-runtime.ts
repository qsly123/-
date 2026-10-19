import type { BattleMode, CombatLogEntry } from "@/types/game";
import {
  createBattleSceneSnapshot,
  type BattleScenePositionOverride,
  type BattleSceneSnapshot,
  type BattleSceneTimelineEvent,
} from "@/modules/combat/services/battle-scene-state";
import type {
  BattleSceneMode,
  BattleSceneMoveState,
  BattleSceneUnit,
} from "@/modules/combat/services/battle-scene";

export type BattleSpatialRuntimeTarget = {
  xPercent?: number;
  yPercent?: number;
  moveState?: BattleSceneMoveState | null;
  headingDegrees?: number | null;
};

export function createBattleSpatialRuntimeSnapshot(params: {
  mode: BattleSceneMode;
  battleMode: BattleMode;
  units: BattleSceneUnit[];
  sequence: number;
  tick?: number;
  serverTimeMs: number;
  previousSnapshot?: BattleSceneSnapshot | null;
  positionOverrides?: Record<string, BattleScenePositionOverride>;
  movementTargetsByUnitId?: Record<string, BattleSpatialRuntimeTarget | undefined>;
  timeline?: BattleSceneTimelineEvent[];
}) {
  const movementTargetsByUnitId = params.movementTargetsByUnitId || {};
  return createBattleSceneSnapshot({
    mode: params.mode,
    battleMode: params.battleMode,
    units: params.units.map((unit) => {
      const movementTarget = movementTargetsByUnitId[unit.id];
      return {
        ...unit,
        targetXPercent: movementTarget?.xPercent ?? unit.targetXPercent,
        targetYPercent: movementTarget?.yPercent ?? unit.targetYPercent,
        moveState: movementTarget?.moveState ?? unit.moveState,
        headingDegrees: movementTarget?.headingDegrees ?? unit.headingDegrees,
      } satisfies BattleSceneUnit;
    }),
    sequence: params.sequence,
    tick: params.tick,
    serverTimeMs: params.serverTimeMs,
    previousSnapshot: params.previousSnapshot,
    positionOverrides: params.positionOverrides,
    timeline: params.timeline,
  });
}

export function buildBattleActionTimeline(params: {
  runtimeId: string;
  turn: number;
  entries: CombatLogEntry[];
  startedAtMs: number;
  windupMs?: number;
  activeMs?: number;
  recoverMs?: number;
  actorAdvancePercent?: number;
  itemAdvancePercent?: number;
  targetRecoilPercent?: number;
  spacingMs?: number;
}) {
  const timeline: BattleSceneTimelineEvent[] = [];
  let cursorMs = params.startedAtMs;
  const windupMs = Math.max(0, Math.floor(Number(params.windupMs ?? 80)));
  const activeMs = Math.max(0, Math.floor(Number(params.activeMs ?? 160)));
  const recoverMs = Math.max(0, Math.floor(Number(params.recoverMs ?? 210)));
  const spacingMs = Math.max(0, Math.floor(Number(params.spacingMs ?? 70)));
  const actorAdvancePercent = Number(params.actorAdvancePercent ?? 0);
  const itemAdvancePercent = Number(params.itemAdvancePercent ?? 0);
  const targetRecoilPercent = Number(params.targetRecoilPercent ?? 0);

  params.entries.forEach((entry, index) => {
    if (!entry.actorId || entry.entryType === "system" || entry.entryType === "status") {
      return;
    }

    timeline.push({
      id: `${params.runtimeId}-${params.turn}-${index}-${entry.actorId}`,
      channel: "action",
      actorId: entry.actorId,
      targetId: entry.targetId || null,
      startedAtMs: cursorMs,
      windupMs,
      activeMs,
      recoverMs,
      actorAdvancePercent: entry.entryType === "item" ? itemAdvancePercent : actorAdvancePercent,
      targetRecoilPercent: entry.damage && entry.damage > 0 ? targetRecoilPercent : 0,
    });
    cursorMs += windupMs + activeMs + recoverMs + spacingMs;
  });

  return timeline;
}
