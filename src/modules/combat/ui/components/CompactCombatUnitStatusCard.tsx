"use client";

import { STATUS_NAMES } from "@/modules/shared/constants";
import type { CombatUnit } from "@/types/game";

function clampPercent(current: number, max: number) {
  return max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function StatBar({ label, current, max, color }: { label: string; current: number; max: number; color: string }) {
  return (
    <div className="combat-stat-row">
      <div className="combat-stat-meta">
        <span className="combat-stat-label">{label}</span>
        <span className="combat-stat-value">{current}/{max}</span>
      </div>
      <div className="combat-stat-track">
        <div className="combat-stat-fill" style={{ width: `${clampPercent(current, max)}%`, background: color }} />
      </div>
    </div>
  );
}

type CompactCombatUnitStatusCardProps = {
  unit: Pick<CombatUnit, "name" | "hp" | "maxHp" | "mp" | "maxMp" | "activeEffects">;
  slotTitle: string;
  badge?: string | null;
  className?: string;
};

export default function CompactCombatUnitStatusCard(props: CompactCombatUnitStatusCardProps) {
  const { unit, slotTitle, badge, className } = props;

  return (
    <div className={["combat-status-card", className || ""].filter(Boolean).join(" ")}>
      <div className="combat-status-head">
        <div className="combat-status-title-wrap">
          <span className="combat-status-slot">{slotTitle}</span>
          <span className="combat-status-name">{unit.name}</span>
        </div>
        {badge ? <span className="combat-status-badge">{badge}</span> : null}
      </div>
      <StatBar label="气血" current={unit.hp} max={unit.maxHp} color="linear-gradient(90deg, #9e312f, #e17e61)" />
      <StatBar label="灵力" current={unit.mp} max={unit.maxMp} color="linear-gradient(90deg, #274f74, #6fb1d3)" />
      <div className="combat-effects-row">
        {unit.activeEffects.length
          ? unit.activeEffects.map((effect, index) => (
            <span key={`${effect.type}-${index}`} className="combat-effect-chip">
              {STATUS_NAMES[effect.type] || effect.type} {effect.remainingTurns}
            </span>
          ))
          : <span className="combat-effect-empty">暂无状态</span>}
      </div>
    </div>
  );
}
