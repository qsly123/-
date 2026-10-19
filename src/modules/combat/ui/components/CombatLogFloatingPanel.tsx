"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import type { CombatLogEntry } from "@/types/game";

const MOBILE_BREAKPOINT = 900;
const EDGE_MARGIN = 8;
const COLLAPSED_SIZE = 54;
const MOBILE_OPEN_WIDTH = 320;
const MOBILE_BOTTOM_OFFSET = 224;
const STORAGE_KEY = "immortality:combat:log-floating-panel";

type PanelPosition = {
  x: number;
  y: number;
};

type StoredPanelState = {
  x?: number;
  y?: number;
  open?: boolean;
};

interface CombatLogFloatingPanelProps {
  entries: CombatLogEntry[];
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logRef: RefObject<HTMLDivElement | null>;
  onLogScroll: () => void;
}

function isMobileViewport() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function getMobileOpenWidth() {
  if (typeof window === "undefined") {
    return MOBILE_OPEN_WIDTH;
  }

  return Math.max(COLLAPSED_SIZE, Math.min(MOBILE_OPEN_WIDTH, window.innerWidth - EDGE_MARGIN * 2));
}

function clampPosition(position: PanelPosition, width: number, height: number): PanelPosition {
  if (typeof window === "undefined") {
    return position;
  }

  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);

  return {
    x: Math.min(Math.max(position.x, EDGE_MARGIN), maxX),
    y: Math.min(Math.max(position.y, EDGE_MARGIN), maxY),
  };
}

function getDefaultPosition(width: number, height: number) {
  if (typeof window === "undefined") {
    return {
      x: EDGE_MARGIN,
      y: EDGE_MARGIN,
    };
  }

  return clampPosition({
    x: window.innerWidth - width - EDGE_MARGIN,
    y: window.innerHeight - height - MOBILE_BOTTOM_OFFSET,
  }, width, height);
}

function readStoredPanelState(): StoredPanelState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as StoredPanelState;
    return parsedValue && typeof parsedValue === "object" ? parsedValue : null;
  } catch {
    return null;
  }
}

function persistPanelState(state: StoredPanelState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write failures.
  }
}

export default function CombatLogFloatingPanel({
  entries,
  summary,
  open,
  onOpenChange,
  logRef,
  onLogScroll,
}: CombatLogFloatingPanelProps) {
  const restoredState = useMemo(() => readStoredPanelState(), []);
  const restoredOpen = typeof restoredState?.open === "boolean" ? restoredState.open : null;
  const didRestoreOpenRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const panelWidthRef = useRef(open ? getMobileOpenWidth() : COLLAPSED_SIZE);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  const [position, setPosition] = useState<PanelPosition>(() => {
    const defaultPosition = getDefaultPosition(COLLAPSED_SIZE, COLLAPSED_SIZE);
    if (typeof restoredState?.x !== "number" || typeof restoredState?.y !== "number") {
      return defaultPosition;
    }
    return {
      x: restoredState.x,
      y: restoredState.y,
    };
  });

  const panelWidth = isMobile ? (open ? getMobileOpenWidth() : COLLAPSED_SIZE) : 0;

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  const clampForViewport = useCallback((candidate: PanelPosition) => {
    const rect = panelRef.current?.getBoundingClientRect();
    return clampPosition(
      candidate,
      rect?.width ?? panelWidthRef.current,
      rect?.height ?? COLLAPSED_SIZE,
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!didRestoreOpenRef.current && typeof restoredOpen === "boolean" && restoredOpen !== open) {
      onOpenChange(restoredOpen);
    }
    didRestoreOpenRef.current = true;

    const syncViewport = () => {
      const nextIsMobile = isMobileViewport();
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) {
        return;
      }
      setPosition((current) => clampForViewport(current));
    };

    const animationFrameId = window.requestAnimationFrame(syncViewport);
    window.addEventListener("resize", syncViewport);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", syncViewport);
    };
  }, [clampForViewport, onOpenChange, open, restoredOpen]);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined") {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      setPosition((current) => clampForViewport(current));
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [clampForViewport, entries.length, isMobile, open]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    persistPanelState({
      x: position.x,
      y: position.y,
      open,
    });
  }, [isMobile, open, position.x, position.y]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobile) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }, [isMobile, position.x, position.y]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !isMobile) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(deltaX, deltaY) < 4) {
      return;
    }

    dragState.moved = true;

    const nextPosition = clampForViewport({
      x: dragState.originX + deltaX,
      y: dragState.originY + deltaY,
    });

    setPosition((current) => (
      current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition
    ));
  }, [clampForViewport, isMobile]);

  const clearPointerState = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return false;
    }

    dragStateRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    return dragState.moved;
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobile) {
      return;
    }

    const moved = clearPointerState(event);
    if (!moved) {
      onOpenChange(!open);
    }
  }, [clearPointerState, isMobile, onOpenChange, open]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    clearPointerState(event);
  }, [clearPointerState]);

  return (
    <>
      {isMobile ? (
        <button
          type="button"
          className={`combat-log-backdrop ${open ? "is-visible" : ""}`}
          onClick={() => onOpenChange(false)}
          aria-label="关闭战报"
          tabIndex={open ? 0 : -1}
        />
      ) : null}
      <div
        ref={panelRef}
        className={`combat-log-floating-shell ${isMobile ? "is-mobile" : "is-desktop"} ${open ? "is-open" : "is-closed"}`}
        style={isMobile ? {
          left: position.x,
          top: position.y,
          width: panelWidth,
          maxWidth: `calc(100vw - ${EDGE_MARGIN * 2}px)`,
        } : undefined}
      >
        <div className={`combat-log-box ${open ? "is-expanded" : "is-collapsed"}`}>
          <button
            type="button"
            className="combat-log-toggle"
            onClick={isMobile ? undefined : () => onOpenChange(!open)}
            onPointerDown={isMobile ? handlePointerDown : undefined}
            onPointerMove={isMobile ? handlePointerMove : undefined}
            onPointerUp={isMobile ? handlePointerUp : undefined}
            onPointerCancel={isMobile ? handlePointerCancel : undefined}
            aria-expanded={open}
          >
            {!isMobile || open ? (
              <>
                <span className="combat-log-title-wrap">
                  <span className="combat-log-title">战报</span>
                  <span className="combat-log-summary">{summary}</span>
                </span>
                <span className="combat-log-toggle-icon">{isMobile ? "拖动/收起" : (open ? <UpOutlined /> : <DownOutlined />)}</span>
              </>
            ) : (
              <span className="combat-log-orb">
                报
                <span className="combat-log-orb-label">战报</span>
              </span>
            )}
          </button>
          <div className="combat-log-body">
            <div className="combat-log-list" ref={logRef} onScroll={onLogScroll}>
              {entries.map((entry, index) => (
                <div key={`${entry.turn}-${index}-${entry.action}`} className="combat-log-item">
                  <span className="combat-log-turn">第 {entry.turn} 回合</span>
                  <span className={`combat-log-text ${entry.damage ? "is-damage" : entry.heal ? "is-heal" : entry.resultType === "miss" ? "is-system" : ""}`}>
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
