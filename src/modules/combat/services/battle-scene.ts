import { getBossStageAnchorMap } from "@/modules/combat/services/battle-stage-layout";

export type BattleSceneMode = "combat" | "boss";
export type BattleSceneRole = "player" | "enemy" | "boss";
export type BattleSceneMoveState = "idle" | "moving" | "locked" | "attacking";

export type BattleSceneUnit = {
  id: string;
  name?: string;
  role: BattleSceneRole;
  slot?: number | null;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  isCurrent?: boolean;
  headingDegrees?: number | null;
  moveState?: BattleSceneMoveState | null;
  targetXPercent?: number | null;
  targetYPercent?: number | null;
};

export type BattleSceneAnchor = {
  xPercent: number;
  yPercent: number;
};

export type BattleSceneMotion = {
  actorId?: string | null;
  targetId?: string | null;
  durationMs?: number;
};

export type BattleScenePoint = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const COMBAT_SCENE_ANCHORS: Record<"player" | "enemy", BattleSceneAnchor> = {
  enemy: { xPercent: 50, yPercent: 14 },
  player: { xPercent: 50, yPercent: 84 },
};

const PARTY_COMBAT_PLAYER_ANCHORS_BY_SLOT: BattleSceneAnchor[] = [
  { xPercent: 50, yPercent: 84 },
  { xPercent: 22, yPercent: 77 },
  { xPercent: 78, yPercent: 77 },
];

const BOSS_SCENE_BOSS_ANCHOR: BattleSceneAnchor = {
  xPercent: 50,
  yPercent: 22,
};

const BOSS_SCENE_PLAYER_Y_PERCENT = 70;

export function getBattleSceneAnimatedPoint(params: {
  unit: BattleSceneUnit;
  basePoint: BattleScenePoint;
  pointMap: Map<string, BattleScenePoint>;
  motion?: BattleSceneMotion | null;
  progress: number;
}) {
  const { unit, basePoint, pointMap, motion, progress } = params;
  if (!motion || progress <= 0) {
    return basePoint;
  }

  const normalizedProgress = clamp(progress, 0, 1);
  const isBoss = unit.role === "boss";

  if (motion.actorId === unit.id && motion.targetId) {
    const targetPoint = pointMap.get(motion.targetId);
    if (!targetPoint) {
      return basePoint;
    }

    const dx = targetPoint.x - basePoint.x;
    const dy = targetPoint.y - basePoint.y;
    const distance = Math.hypot(dx, dy) || 1;
    const rushDistance = clamp(
      distance * 0.24,
      isBoss ? 18 : 14,
      isBoss ? 44 : 34,
    );
    const rush = Math.sin(normalizedProgress * Math.PI) * rushDistance;
    return {
      x: basePoint.x + (dx / distance) * rush,
      y: basePoint.y + (dy / distance) * rush,
    };
  }

  if (motion.targetId === unit.id && motion.actorId && motion.actorId !== unit.id) {
    const actorPoint = pointMap.get(motion.actorId);
    if (!actorPoint) {
      return basePoint;
    }

    const dx = basePoint.x - actorPoint.x;
    const dy = basePoint.y - actorPoint.y;
    const distance = Math.hypot(dx, dy) || 1;
    const recoilProgress = normalizedProgress <= 0.18
      ? 0
      : Math.sin(((normalizedProgress - 0.18) / 0.82) * Math.PI);
    const recoilDistance = clamp(
      distance * 0.045,
      isBoss ? 4 : 3,
      isBoss ? 12 : 8,
    ) * recoilProgress;
    return {
      x: basePoint.x + (dx / distance) * recoilDistance,
      y: basePoint.y + (dy / distance) * recoilDistance,
    };
  }

  return basePoint;
}

export function getBattleSceneAnchor(params: {
  mode: BattleSceneMode;
  role: BattleSceneRole;
  slot?: number | null;
  playerSlots?: number[];
}) {
  if (params.mode === "combat") {
    return COMBAT_SCENE_ANCHORS[params.role === "enemy" ? "enemy" : "player"];
  }

  if (params.role === "boss") {
    return BOSS_SCENE_BOSS_ANCHOR;
  }

  const slotMap = getBossStageAnchorMap(params.playerSlots || []);
  const anchor = typeof params.slot === "number" ? slotMap.get(params.slot) : null;
  return {
    xPercent: anchor?.leftPercent || 50,
    yPercent: BOSS_SCENE_PLAYER_Y_PERCENT,
  };
}

export function getBattleSceneAnchorMap(
  mode: BattleSceneMode,
  units: BattleSceneUnit[],
) {
  if (mode === "combat") {
    const enemyUnit = units.find((unit) => unit.role === "enemy");
    const playerUnits = units.filter((unit) => unit.role === "player");

    if (enemyUnit && playerUnits.length > 1) {
      const hasStablePartySlots = playerUnits.every((unit) => typeof unit.slot === "number" && Number.isFinite(unit.slot));
      if (hasStablePartySlots) {
        const playerAnchors = new Map<string, BattleSceneAnchor>();
        const sortedPlayers = [...playerUnits].sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));

        sortedPlayers.forEach((unit, index) => {
          const slot = Math.max(0, Math.floor(unit.slot ?? index));
          const anchor = PARTY_COMBAT_PLAYER_ANCHORS_BY_SLOT[slot]
            || PARTY_COMBAT_PLAYER_ANCHORS_BY_SLOT[index]
            || COMBAT_SCENE_ANCHORS.player;
          playerAnchors.set(unit.id, anchor);
        });

        return new Map(
          units.map((unit) => {
            if (unit.role === "enemy") {
              return [unit.id, COMBAT_SCENE_ANCHORS.enemy];
            }
            return [unit.id, playerAnchors.get(unit.id) || COMBAT_SCENE_ANCHORS.player];
          }),
        );
      }

      const currentPlayer = playerUnits.find((unit) => unit.isCurrent) || playerUnits[0];
      const otherPlayers = playerUnits.filter((unit) => unit.id !== currentPlayer.id);
      const playerAnchors = new Map<string, BattleSceneAnchor>([
        [currentPlayer.id, { xPercent: 50, yPercent: 84 }],
      ]);

      if (otherPlayers.length === 1) {
        const sidePlayer = otherPlayers[0];
        playerAnchors.set(sidePlayer.id, {
          xPercent: 22,
          yPercent: 77,
        });
      }

      if (otherPlayers.length >= 2) {
        playerAnchors.set(otherPlayers[0].id, { xPercent: 22, yPercent: 77 });
        playerAnchors.set(otherPlayers[1].id, { xPercent: 78, yPercent: 77 });
      }

      return new Map(
        units.map((unit) => {
          if (unit.role === "enemy") {
            return [unit.id, COMBAT_SCENE_ANCHORS.enemy];
          }
          return [unit.id, playerAnchors.get(unit.id) || COMBAT_SCENE_ANCHORS.player];
        }),
      );
    }
  }

  if (mode === "boss") {
    const bossUnit = units.find((unit) => unit.role === "boss");
    const playerUnits = units.filter((unit) => unit.role === "player");
    const currentPlayer = playerUnits.find((unit) => unit.isCurrent);

    if (currentPlayer) {
      const otherPlayers = playerUnits
        .filter((unit) => unit.id !== currentPlayer.id)
        .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));

      const playerAnchors = new Map<string, BattleSceneAnchor>([
        [currentPlayer.id, { xPercent: 50, yPercent: 72 }],
      ]);

      if (otherPlayers.length === 1) {
        const onlyOther = otherPlayers[0];
        playerAnchors.set(onlyOther.id, {
          xPercent: (onlyOther.slot ?? 0) < (currentPlayer.slot ?? 0) ? 26 : 74,
          yPercent: 66,
        });
      }

      if (otherPlayers.length >= 2) {
        playerAnchors.set(otherPlayers[0].id, { xPercent: 24, yPercent: 66 });
        playerAnchors.set(otherPlayers[1].id, { xPercent: 76, yPercent: 66 });
      }

      return new Map(
        units.map((unit) => {
          if (unit.role === "boss") {
            return [unit.id, BOSS_SCENE_BOSS_ANCHOR];
          }
          return [unit.id, playerAnchors.get(unit.id) || { xPercent: 50, yPercent: BOSS_SCENE_PLAYER_Y_PERCENT }];
        }),
      );
    }

    if (bossUnit && playerUnits.length === 1) {
      return new Map([
        [bossUnit.id, BOSS_SCENE_BOSS_ANCHOR],
        [playerUnits[0].id, { xPercent: 50, yPercent: 72 }],
      ]);
    }
  }

  const playerSlots = units
    .filter((unit) => unit.role === "player" && typeof unit.slot === "number")
    .map((unit) => Number(unit.slot));

  return new Map(
    units.map((unit) => [
      unit.id,
      getBattleSceneAnchor({
        mode,
        role: unit.role,
        slot: unit.slot,
        playerSlots,
      }),
    ]),
  );
}
