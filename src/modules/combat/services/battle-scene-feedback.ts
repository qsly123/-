import type { BattleSceneRole } from "@/modules/combat/services/battle-scene";
import type { CombatSkillVisualEffect } from "@/types/game";

type BattleSceneAnchorLike = {
  xPercent: number;
  yPercent: number;
};

type BattleSceneFeedbackKind = "effect" | "popup";

const FEEDBACK_OFFSETS: Record<BattleSceneFeedbackKind, Record<BattleSceneRole, { x: number; y: number }>> = {
  effect: {
    player: { x: 0, y: -1.6 },
    enemy: { x: 0, y: -1.8 },
    boss: { x: 0, y: -0.8 },
  },
  popup: {
    player: { x: 0, y: -10.5 },
    enemy: { x: 0, y: -9.4 },
    boss: { x: 0, y: -12.8 },
  },
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function getEntityCenterAnchor(anchor: BattleSceneAnchorLike) {
  return {
    xPercent: clampPercent(anchor.xPercent),
    yPercent: clampPercent(anchor.yPercent),
  };
}

export function getBattleSceneFeedbackAnchor(params: {
  anchor?: BattleSceneAnchorLike | null;
  actorAnchor?: BattleSceneAnchorLike | null;
  role: BattleSceneRole;
  kind: BattleSceneFeedbackKind;
  visualEffect?: CombatSkillVisualEffect | null;
}) {
  const { anchor, actorAnchor, role, kind } = params;
  if (!anchor) {
    return null;
  }

  if (kind === "effect") {
    if (actorAnchor) {
      const sameEntity = Math.abs(actorAnchor.xPercent - anchor.xPercent) <= 0.01
        && Math.abs(actorAnchor.yPercent - anchor.yPercent) <= 0.01;
      if (sameEntity) {
        return getEntityCenterAnchor(anchor);
      }
    }

    return getEntityCenterAnchor(anchor);
  }

  const offset = FEEDBACK_OFFSETS[kind][role];
  return {
    xPercent: clampPercent(anchor.xPercent + offset.x),
    yPercent: clampPercent(anchor.yPercent + offset.y),
  };
}
