"use client";

import type { ReactNode } from "react";
import { Button, Spin } from "antd";

type BattlePageStateCardProps = {
  mode: "loading" | "empty";
  title?: string;
  description?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  children?: ReactNode;
};

const battlePageStateCardStyles = `
  .battle-page-state {
    min-height: 100vh;
    padding: 18px;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at top, rgba(188, 158, 113, 0.14), transparent 34%),
      linear-gradient(180deg, #0d1115 0%, #12181d 42%, #090c10 100%);
  }
  .battle-page-state-card {
    width: min(100%, 420px);
    padding: 24px 20px;
    display: grid;
    gap: 12px;
    text-align: center;
    border-radius: 24px;
    border: 1px solid rgba(214, 196, 149, 0.16);
    background: rgba(10, 14, 20, 0.92);
    color: #eadfcb;
    box-shadow: 0 22px 48px rgba(0, 0, 0, 0.28);
  }
  .battle-page-state-title {
    font-size: 22px;
    font-weight: 700;
    color: #f5ead0;
  }
  .battle-page-state-copy {
    line-height: 1.7;
    color: rgba(234, 223, 203, 0.72);
  }
  .battle-page-state-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
`;

export default function BattlePageStateCard(props: BattlePageStateCardProps) {
  if (props.mode === "loading") {
    return (
      <div className="battle-page-state">
        <Spin size="large" />
        <style jsx global>{battlePageStateCardStyles}</style>
      </div>
    );
  }

  return (
    <div className="battle-page-state">
      <div className="battle-page-state-card">
        {props.title ? <div className="battle-page-state-title">{props.title}</div> : null}
        {props.description ? <div className="battle-page-state-copy">{props.description}</div> : null}
        {props.children}
        {(props.primaryActionLabel || props.secondaryActionLabel) ? (
          <div className="battle-page-state-actions">
            {props.primaryActionLabel ? (
              <Button type="primary" onClick={props.onPrimaryAction}>
                {props.primaryActionLabel}
              </Button>
            ) : null}
            {props.secondaryActionLabel ? (
              <Button onClick={props.onSecondaryAction}>
                {props.secondaryActionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <style jsx global>{battlePageStateCardStyles}</style>
    </div>
  );
}
