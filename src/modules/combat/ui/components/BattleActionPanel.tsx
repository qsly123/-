"use client";

import type { ReactNode } from "react";

export type BattleActionPanelCommand = {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tone?: "default" | "primary" | "danger";
};

export type BattleActionPanelSkill = {
  key: string;
  tag?: ReactNode;
  content: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

export type BattleActionPanelItem = {
  key: string;
  content: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

type BattleActionPanelProps = {
  className?: string;
  title: ReactNode;
  subtitle: ReactNode;
  statusLabel: ReactNode;
  statusHighlighted?: boolean;
  commandButtons: BattleActionPanelCommand[];
  skills: BattleActionPanelSkill[];
  skillSectionTitle?: ReactNode;
  skillSectionHint?: ReactNode;
  items?: BattleActionPanelItem[];
  itemSectionTitle?: ReactNode;
  itemSectionHint?: ReactNode;
  itemSectionDesktopToggle?: {
    expanded: boolean;
    onToggle: () => void;
  };
  footerButtons?: BattleActionPanelCommand[];
};

function renderCommandButton(button: BattleActionPanelCommand) {
  return (
    <button
      key={button.key}
      type="button"
      className={[
        "combat-command-btn",
        button.tone === "primary" ? "is-primary" : "",
        button.tone === "danger" ? "is-danger" : "",
      ].filter(Boolean).join(" ")}
      disabled={button.disabled}
      onClick={button.onClick}
    >
      {button.label}
    </button>
  );
}

export default function BattleActionPanel(props: BattleActionPanelProps) {
  const {
    className,
    title,
    subtitle,
    statusLabel,
    statusHighlighted,
    commandButtons,
    skills,
    skillSectionTitle = "技能栏",
    skillSectionHint = "左右滑动",
    items = [],
    itemSectionTitle = "战斗丹药",
    itemSectionHint = "左右滑动",
    itemSectionDesktopToggle,
    footerButtons = [],
  } = props;

  const showItems = !itemSectionDesktopToggle || itemSectionDesktopToggle.expanded;

  return (
    <div className={className || "combat-action-panel"}>
      <div className="combat-action-head">
        <div className="combat-action-head-copy">
          <div className="combat-panel-title">{title}</div>
          <div className="combat-panel-subtitle">{subtitle}</div>
        </div>
        <span className={`combat-hud-state ${statusHighlighted ? "is-auto" : ""}`}>{statusLabel}</span>
      </div>

      <div className="combat-command-grid">
        {commandButtons.map(renderCommandButton)}
      </div>

      <div className="combat-hud-section">
        <div className="combat-hud-section-head">
          <div className="combat-hud-section-title">{skillSectionTitle}</div>
          <div className="combat-hud-section-hint">{skillSectionHint}</div>
        </div>
        <div className="combat-skill-grid">
          {skills.map((skill) => (
            <button
              key={skill.key}
              type="button"
              className="combat-skill-btn"
              disabled={skill.disabled}
              onClick={skill.onClick}
            >
              {skill.tag ? <span className="combat-skill-tag">{skill.tag}</span> : null}
              <span className="combat-skill-name">{skill.content}</span>
            </button>
          ))}
        </div>
      </div>

      {items.length ? (
        <div className={`combat-hud-section combat-item-section ${itemSectionDesktopToggle && !itemSectionDesktopToggle.expanded ? "is-collapsed" : ""}`}>
          <div className="combat-hud-section-head">
            <div className="combat-hud-section-title">{itemSectionTitle}</div>
            {itemSectionDesktopToggle ? (
              <button
                type="button"
                className="combat-hud-toggle-btn"
                aria-expanded={itemSectionDesktopToggle.expanded}
                onClick={itemSectionDesktopToggle.onToggle}
              >
                {itemSectionDesktopToggle.expanded ? "-" : "+"}
              </button>
            ) : (
              <div className="combat-hud-section-hint">{itemSectionHint}</div>
            )}
          </div>
          {showItems ? (
            <div className="combat-item-grid">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="combat-item-btn"
                  disabled={item.disabled}
                  onClick={item.onClick}
                >
                  <span className="combat-item-main">{item.content}</span>
                  {item.meta ? <span className="combat-item-count">{item.meta}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {footerButtons.length ? (
        <div className="combat-command-grid">
          {footerButtons.map(renderCommandButton)}
        </div>
      ) : null}
    </div>
  );
}
