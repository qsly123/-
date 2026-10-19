export type BossStageLane = "left" | "center" | "right";

export type BossStageAnchor = {
  slot: number;
  lane: BossStageLane;
  leftPercent: number;
};

const BOSS_STAGE_LANES: Record<number, Array<{ lane: BossStageLane; leftPercent: number }>> = {
  1: [{ lane: "center", leftPercent: 50 }],
  2: [
    { lane: "left", leftPercent: 36 },
    { lane: "right", leftPercent: 64 },
  ],
  3: [
    { lane: "left", leftPercent: 22 },
    { lane: "center", leftPercent: 50 },
    { lane: "right", leftPercent: 78 },
  ],
};

export function getBossStageAnchors(slots: number[]): BossStageAnchor[] {
  const uniqueSlots = Array.from(new Set(slots))
    .filter((slot) => Number.isInteger(slot) && slot >= 0)
    .sort((left, right) => left - right);

  const laneTemplate = BOSS_STAGE_LANES[Math.min(3, Math.max(1, uniqueSlots.length))] || BOSS_STAGE_LANES[1];
  return uniqueSlots.map((slot, index) => {
    const lane = laneTemplate[index] || laneTemplate[laneTemplate.length - 1];
    return {
      slot,
      lane: lane.lane,
      leftPercent: lane.leftPercent,
    };
  });
}

export function getBossStageAnchorMap(slots: number[]) {
  return new Map(getBossStageAnchors(slots).map((anchor) => [anchor.slot, anchor]));
}
