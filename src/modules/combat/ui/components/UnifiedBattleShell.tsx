"use client";

import type { ReactNode } from "react";
import BattleScenePageFrame from "@/modules/combat/ui/components/BattleScenePageFrame";

type UnifiedBattleShellProps = {
  pageClassName?: string;
  shellClassName?: string;
  topBanner?: ReactNode;
  header?: ReactNode;
  titleBar?: ReactNode;
  footer?: ReactNode;
  topHud?: ReactNode;
  topHudClassName?: string;
  battleLayoutClassName?: string;
  primaryContent: ReactNode;
  primaryClassName?: string;
  sideRailContent?: ReactNode;
  sideRailClassName?: string;
  mobileDock?: ReactNode;
  mobileDockClassName?: string;
};

export default function UnifiedBattleShell({
  pageClassName,
  shellClassName,
  topBanner,
  header,
  titleBar,
  footer,
  topHud,
  topHudClassName,
  battleLayoutClassName,
  primaryContent,
  primaryClassName,
  sideRailContent,
  sideRailClassName,
  mobileDock,
  mobileDockClassName,
}: UnifiedBattleShellProps) {
  return (
    <>
      <BattleScenePageFrame
        className={["combat-page", pageClassName || ""].filter(Boolean).join(" ")}
        shellClassName={["combat-shell", shellClassName || ""].filter(Boolean).join(" ")}
        topBanner={topBanner}
        header={header}
        titleBar={titleBar}
        footer={footer}
      >
        {topHud ? (
          <div className={["combat-top-hud", topHudClassName || ""].filter(Boolean).join(" ")}>
            {topHud}
          </div>
        ) : null}
        <div className={["combat-battle-layout", battleLayoutClassName || ""].filter(Boolean).join(" ")}>
          <div className={["combat-stage-column", primaryClassName || ""].filter(Boolean).join(" ")}>
            {primaryContent}
          </div>
          {sideRailContent ? (
            <div className={["combat-side-rail", sideRailClassName || ""].filter(Boolean).join(" ")}>
              {sideRailContent}
            </div>
          ) : null}
        </div>
      </BattleScenePageFrame>
      {mobileDock ? (
        <div className={["combat-mobile-dock", mobileDockClassName || ""].filter(Boolean).join(" ")}>
          {mobileDock}
        </div>
      ) : null}
    </>
  );
}
