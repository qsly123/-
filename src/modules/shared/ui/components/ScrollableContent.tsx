"use client";

import type { CSSProperties, ReactNode } from "react";

type ScrollableContentProps = {
  children: ReactNode;
  style?: CSSProperties;
  maxHeight?: CSSProperties["maxHeight"];
  minHeight?: CSSProperties["minHeight"];
};

const baseScrollableStyle: CSSProperties = {
  width: "100%",
  position: "relative",
  display: "block",
  overflowY: "auto",
  overflowX: "hidden",
  overscrollBehaviorY: "contain",
  overscrollBehaviorX: "none",
  WebkitOverflowScrolling: "touch",
  scrollbarGutter: "stable",
  scrollbarWidth: "thin",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  touchAction: "pan-y pinch-zoom",
  pointerEvents: "auto",
  paddingBottom: 2,
};

const innerScrollableStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: "100%",
  display: "block",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  touchAction: "pan-y pinch-zoom",
  pointerEvents: "auto",
  WebkitOverflowScrolling: "touch",
};

export default function ScrollableContent({
  children,
  style,
  maxHeight = "min(42vh, 320px)",
  minHeight,
}: ScrollableContentProps) {
  return (
    <div
      style={{
        ...baseScrollableStyle,
        maxHeight,
        minHeight,
        ...style,
      }}
    >
      <div style={innerScrollableStyle}>
        {children}
      </div>
    </div>
  );
}
