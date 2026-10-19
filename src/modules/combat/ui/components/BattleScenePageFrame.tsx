"use client";

import type { ReactNode } from "react";

type BattleScenePageFrameProps = {
  className?: string;
  shellClassName?: string;
  bodyClassName?: string;
  topBanner?: ReactNode;
  header?: ReactNode;
  titleBar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export default function BattleScenePageFrame(props: BattleScenePageFrameProps) {
  return (
    <div className={["battle-scene-frame", props.className || ""].filter(Boolean).join(" ")}>
      <div className={["battle-scene-frame__shell", props.shellClassName || ""].filter(Boolean).join(" ")}>
        {props.topBanner ? <div className="battle-scene-frame__top-banner">{props.topBanner}</div> : null}
        {props.header ? <div className="battle-scene-frame__header">{props.header}</div> : null}
        {props.titleBar ? <div className="battle-scene-frame__titlebar">{props.titleBar}</div> : null}
        <div className={["battle-scene-frame__body", props.bodyClassName || ""].filter(Boolean).join(" ")}>
          {props.children}
        </div>
        {props.footer ? <div className="battle-scene-frame__footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}
