"use client";

import type { BattleViewState } from "@/types/game";

type BattleViewHeaderCardProps = {
  battleView?: BattleViewState | null;
  extraBadges?: Array<string | null | undefined>;
  className?: string;
};

const RUNTIME_STATE_LABELS: Record<BattleViewState["runtimeState"], string> = {
  preparing: "准备中",
  active: "进行中",
  settling: "结算中",
  finished: "已结束",
  closed: "已关闭",
};

export default function BattleViewHeaderCard({ battleView, extraBadges, className }: BattleViewHeaderCardProps) {
  if (!battleView) {
    return null;
  }

  const badges = [
    battleView.mode === "party" ? "组队模式" : battleView.mode === "boss" ? "首领模式" : battleView.mode === "pvp" ? "论道模式" : "普通模式",
    RUNTIME_STATE_LABELS[battleView.runtimeState],
    ...(extraBadges || []).filter((badge): badge is string => Boolean(badge)),
  ];

  return (
    <section className={["battle-view-card", className || ""].filter(Boolean).join(" ")}>
      <div className="battle-view-card__main">
        <div className="battle-view-card__copy">
          <span className="battle-view-card__eyebrow">统一战斗视图</span>
          <strong className="battle-view-card__title">{battleView.title}</strong>
          {battleView.subtitle ? <span className="battle-view-card__subtitle">{battleView.subtitle}</span> : null}
        </div>
        <div className="battle-view-card__badges">
          {badges.map((badge) => (
            <span key={badge} className="battle-view-card__badge">{badge}</span>
          ))}
        </div>
      </div>
      <div className="battle-view-card__meta">
        <span className="battle-view-card__status">{battleView.statusText || "战局更新中"}</span>
        <span className="battle-view-card__participants">参战 {battleView.participants.length} 名</span>
      </div>
    </section>
  );
}
