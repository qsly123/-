"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Spin, Typography } from "antd";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import type { PartySnapshot } from "@/modules/social/domain/party-types";

const { Text } = Typography;

const MOBILE_BREAKPOINT = 960;
const EDGE_MARGIN = 8;
const COLLAPSED_WIDTH = 58;
const MOBILE_OPEN_WIDTH = 232;
const DESKTOP_OPEN_WIDTH = 320;
const LEGACY_DEFAULT_DESKTOP_POSITION = { x: 12, y: 96 };
const LEGACY_DEFAULT_MOBILE_POSITION = { x: 12, y: 88 };
const DESKTOP_BOTTOM_OFFSET = 24;
const MOBILE_BOTTOM_OFFSET = 86;
const STORAGE_KEY = "immortality:map:party-floating-panel";

type PanelPosition = {
  x: number;
  y: number;
};

type StoredPanelState = {
  x?: number;
  y?: number;
  open?: boolean;
};

interface PartyFloatingPanelProps {
  snapshot: PartySnapshot | null;
  loading?: boolean;
  open: boolean;
  currentPlayerId: string;
  onOpenChange: (open: boolean) => void;
  onLeave: () => void;
  onKick: (playerId: string) => void;
  onRespondInvite: (inviteId: string, accept: boolean) => void;
  actionLoadingKey?: string | null;
}

function isMobileViewport() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function getDefaultPosition(mobile: boolean, width: number, height: number): PanelPosition {
  if (typeof window === "undefined") {
    return mobile ? LEGACY_DEFAULT_MOBILE_POSITION : LEGACY_DEFAULT_DESKTOP_POSITION;
  }

  const bottomOffset = mobile ? MOBILE_BOTTOM_OFFSET : DESKTOP_BOTTOM_OFFSET;
  return clampPosition({
    x: window.innerWidth - width - EDGE_MARGIN,
    y: window.innerHeight - height - bottomOffset,
  }, width, height);
}

function getPanelWidth(mobile: boolean, open: boolean) {
  return mobile
    ? (open ? MOBILE_OPEN_WIDTH : COLLAPSED_WIDTH)
    : (open ? DESKTOP_OPEN_WIDTH : COLLAPSED_WIDTH);
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

function isLegacyDefaultPosition(position: StoredPanelState | null, mobile: boolean) {
  if (!position || typeof position.x !== "number" || typeof position.y !== "number") {
    return false;
  }

  const legacyPosition = mobile ? LEGACY_DEFAULT_MOBILE_POSITION : LEGACY_DEFAULT_DESKTOP_POSITION;
  return position.x === legacyPosition.x && position.y === legacyPosition.y;
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

export default function PartyFloatingPanel({
  snapshot,
  loading = false,
  open,
  currentPlayerId,
  onOpenChange,
  onLeave,
  onKick,
  onRespondInvite,
  actionLoadingKey = null,
}: PartyFloatingPanelProps) {
  const party = snapshot?.party || null;
  const incomingInvites = snapshot?.incomingInvites || [];
  const leaderPlayerId = party?.leaderPlayerId || "";
  const memberCount = party?.members.length || 0;
  const inviteCount = incomingInvites.length;
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
  const panelWidthRef = useRef(getPanelWidth(isMobileViewport(), open));
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  const [position, setPosition] = useState<PanelPosition>(() => {
    const mobile = isMobileViewport();
    const defaultPosition = getDefaultPosition(mobile, COLLAPSED_WIDTH, COLLAPSED_WIDTH);
    const shouldUseDefaultPosition = isLegacyDefaultPosition(restoredState, mobile)
      || typeof restoredState?.x !== "number"
      || typeof restoredState?.y !== "number";

    if (shouldUseDefaultPosition) {
      return defaultPosition;
    }

    return {
      x: restoredState.x as number,
      y: restoredState.y as number,
    };
  });

  const panelWidth = getPanelWidth(isMobile, open);
  const compact = isMobile;
  const desktopPosition = useMemo(() => (
    getDefaultPosition(false, panelWidth, open ? 360 : COLLAPSED_WIDTH)
  ), [open, panelWidth]);
  const containerPosition = isMobile ? position : desktopPosition;

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  const clampForViewport = useCallback((candidate: PanelPosition, mobile: boolean) => {
    if (!mobile) {
      return candidate;
    }

    const rect = panelRef.current?.getBoundingClientRect();
    return clampPosition(
      candidate,
      rect?.width ?? panelWidthRef.current,
      rect?.height ?? 0,
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
      setPosition((current) => {
        if (nextIsMobile && nextIsMobile !== isMobile) {
          return getDefaultPosition(true, COLLAPSED_WIDTH, COLLAPSED_WIDTH);
        }
        return clampForViewport(current, nextIsMobile);
      });
    };

    const animationFrameId = window.requestAnimationFrame(syncViewport);
    window.addEventListener("resize", syncViewport);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", syncViewport);
    };
  }, [clampForViewport, isMobile, onOpenChange, open, restoredOpen]);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined") {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      setPosition((current) => clampForViewport(current, true));
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [clampForViewport, inviteCount, isMobile, loading, memberCount, open]);

  useEffect(() => {
    persistPanelState({
      x: position.x,
      y: position.y,
      open,
    });
  }, [open, position.x, position.y]);

  const summaryText = useMemo(() => {
    if (inviteCount > 0) {
      return `${inviteCount} 条邀请`;
    }

    if (memberCount > 0) {
      return `${memberCount} 人同行`;
    }

    return "未组队";
  }, [inviteCount, memberCount]);
  const collapsedCountText = useMemo(() => {
    if (inviteCount > 0) {
      return `${inviteCount}`;
    }
    if (memberCount > 0) {
      return `${memberCount}`;
    }
    return "";
  }, [inviteCount, memberCount]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
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

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
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
    }, true);

    setPosition((current) => (
      current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition
    ));
  }, [clampForViewport, isMobile]);

  const clearPointerState = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
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

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobile) {
      return;
    }

    const moved = clearPointerState(event);
    if (!moved) {
      onOpenChange(!open);
    }
  }, [clearPointerState, isMobile, onOpenChange, open]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    clearPointerState(event);
  }, [clearPointerState]);

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: containerPosition.x,
        top: containerPosition.y,
        zIndex: 30,
        width: panelWidth,
        maxWidth: isMobile ? `calc(100vw - ${EDGE_MARGIN * 2}px)` : undefined,
        transition: "width 180ms ease, box-shadow 180ms ease",
      }}
    >
      <div
        style={{
          borderRadius: open ? (compact ? 22 : 24) : 999,
          border: open
            ? "1px solid rgba(214, 196, 149, 0.18)"
            : "1px solid rgba(189, 204, 255, 0.18)",
          background: open
            ? "linear-gradient(180deg, rgba(19, 25, 33, 0.7), rgba(8, 11, 17, 0.74))"
            : "radial-gradient(circle at 30% 28%, rgba(156, 197, 255, 0.28), rgba(71, 105, 164, 0.16) 42%, rgba(8, 11, 17, 0.18) 72%, rgba(8, 11, 17, 0.08) 100%)",
          boxShadow: open
            ? "0 18px 38px rgba(0, 0, 0, 0.18)"
            : "0 10px 24px rgba(3, 8, 20, 0.18), inset 0 0 18px rgba(128, 179, 255, 0.08)",
          backdropFilter: open ? "blur(14px)" : "blur(10px)",
          overflow: "hidden",
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={isMobile ? undefined : () => onOpenChange(!open)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenChange(!open);
            }
          }}
          onPointerDown={isMobile ? handlePointerDown : undefined}
          onPointerMove={isMobile ? handlePointerMove : undefined}
          onPointerUp={isMobile ? handlePointerUp : undefined}
          onPointerCancel={isMobile ? handlePointerCancel : undefined}
          style={{
            width: "100%",
            minHeight: open ? undefined : COLLAPSED_WIDTH,
            padding: open ? (compact ? "10px 12px" : "12px 14px") : 0,
            display: "flex",
            alignItems: "center",
            justifyContent: open ? "space-between" : "center",
            gap: 8,
            background: "transparent",
            color: open ? "#f2e5c0" : "#e8f1ff",
            cursor: isMobile ? "grab" : "pointer",
            touchAction: isMobile ? "none" : "auto",
            userSelect: "none",
          }}
        >
          {open ? (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "radial-gradient(circle at 32% 30%, rgba(160, 204, 255, 0.32), rgba(57, 87, 136, 0.18) 48%, rgba(12, 18, 28, 0.16) 100%)",
                    border: "1px solid rgba(196, 214, 255, 0.22)",
                    boxShadow: "inset 0 0 16px rgba(146, 191, 255, 0.08)",
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                  }}
                >
                  队
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700, lineHeight: 1.1 }}>队伍</span>
                  <span style={{ display: "block", fontSize: 11, color: "rgba(226, 235, 255, 0.56)", marginTop: 2 }}>
                    轻触可收起
                  </span>
                </span>
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: inviteCount > 0 ? "#ffd7a8" : "rgba(234, 223, 203, 0.62)",
                  whiteSpace: "nowrap",
                }}
              >
                {summaryText}
              </span>
            </>
          ) : (
            <span
              style={{
                position: "relative",
                width: COLLAPSED_WIDTH,
                height: COLLAPSED_WIDTH,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textShadow: "0 2px 12px rgba(0, 0, 0, 0.24)",
              }}
            >
              队
              {collapsedCountText ? (
                <span
                  style={{
                    position: "absolute",
                    right: 2,
                    top: 2,
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 999,
                    background: inviteCount > 0 ? "rgba(217, 112, 112, 0.88)" : "rgba(108, 165, 232, 0.84)",
                    color: "#f7fbff",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    letterSpacing: 0,
                    textShadow: "none",
                    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.18)",
                  }}
                >
                  {collapsedCountText}
                </span>
              ) : null}
              <span
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 9,
                  color: "rgba(232, 241, 255, 0.72)",
                  letterSpacing: "0.12em",
                }}
              >
                组队
              </span>
            </span>
          )}
        </div>

        {open ? (
          <div
            style={{
              padding: compact ? "0 12px 12px" : "0 14px 14px",
              display: "grid",
              gap: 12,
              maxHeight: compact ? "calc(100vh - 84px)" : "calc(100vh - 132px)",
              overflowY: "auto",
            }}
          >
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
                <Spin size="small" />
              </div>
            ) : null}

            {party ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div
                  style={{
                    padding: compact ? "9px 10px" : "10px 12px",
                    borderRadius: 16,
                    border: "1px solid rgba(214, 196, 149, 0.1)",
                    background: "rgba(255, 255, 255, 0.025)",
                  }}
                >
                  <Text style={{ color: "#f0e2bf", display: "block", marginBottom: 6 }}>三人队伍</Text>
                  <Text style={{ color: "rgba(234, 223, 203, 0.62)", fontSize: 12 }}>
                    队伍上限 3 人，可在地图页随时处理邀请、调整队员并查看战斗状态。
                  </Text>
                </div>

                {party.members.map((member) => {
                  const loadingKey = member.isLeader ? null : `kick:${member.playerId}`;
                  return (
                    <div
                      key={member.playerId}
                      style={{
                        padding: compact ? "9px 10px" : "10px 12px",
                        borderRadius: 18,
                        border: member.isLeader
                          ? "1px solid rgba(214, 196, 149, 0.22)"
                          : "1px solid rgba(214, 196, 149, 0.1)",
                        background: member.isLeader
                          ? "linear-gradient(180deg, rgba(84, 63, 30, 0.22), rgba(24, 19, 13, 0.42))"
                          : "rgba(255, 255, 255, 0.025)",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <PlayerAvatar
                            size={compact ? 34 : 36}
                            avatarImageUrl={member.avatarImageUrl}
                            avatarFrameImageUrl={member.avatarFrameImageUrl}
                            fallbackText={(member.name || "修士").slice(0, 2)}
                            fallbackFontSize={12}
                            fallbackFontWeight={700}
                            borderColor={member.isLeader ? "rgba(245, 218, 152, 0.46)" : "rgba(214, 196, 149, 0.2)"}
                            background="rgba(18, 24, 32, 0.94)"
                          />
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                color: "#f5ead0",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {member.name}
                            </div>
                            <div style={{ color: "rgba(234, 223, 203, 0.58)", fontSize: 12 }}>
                              {member.realmName} | 战力 {member.combatPower.toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: member.isLeader ? "#f0df9a" : "rgba(234, 223, 203, 0.58)" }}>
                          {member.isLeader ? "队长" : "队员"}
                        </span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "rgba(234, 223, 203, 0.62)" }}>
                        <span>气血 {member.maxHp}</span>
                        <span>灵力 {member.maxMp}</span>
                      </div>

                      {leaderPlayerId === currentPlayerId && !member.isLeader ? (
                        <Button
                          size="small"
                          danger
                          ghost
                          loading={actionLoadingKey === loadingKey}
                          onClick={() => onKick(member.playerId)}
                        >
                          请离队员
                        </Button>
                      ) : null}
                    </div>
                  );
                })}

                <Button
                  block
                  onClick={onLeave}
                  loading={actionLoadingKey === "leave"}
                  style={{
                    borderColor: "rgba(214, 196, 149, 0.16)",
                    background: "rgba(28, 17, 17, 0.62)",
                    color: "#f0d1cf",
                  }}
                >
                  {party.leaderPlayerId === currentPlayerId ? "离开并解散队伍" : "离开队伍"}
                </Button>
              </div>
            ) : (
              <div
                  style={{
                    padding: compact ? "10px 12px" : "12px 14px",
                    borderRadius: 16,
                    border: "1px dashed rgba(214, 196, 149, 0.16)",
                    background: "rgba(255, 255, 255, 0.02)",
                    color: "rgba(234, 223, 203, 0.64)",
                    fontSize: 12,
                    lineHeight: 1.7,
                  }}
              >
                你当前尚未组队。点击附近玩家名帖中的“邀请组队”，对方接受后就会出现在这里。
              </div>
            )}

            {incomingInvites.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                <Text style={{ color: "#f0e2bf" }}>收到的邀请</Text>
                {incomingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    style={{
                      padding: compact ? "9px 10px" : "10px 12px",
                      borderRadius: 16,
                      border: "1px solid rgba(214, 196, 149, 0.12)",
                      background: "rgba(255, 255, 255, 0.025)",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ color: "#f5ead0", fontWeight: 700 }}>
                      {invite.inviterName} 邀请你组队
                    </div>
                    <div style={{ color: "rgba(234, 223, 203, 0.58)", fontSize: 12 }}>
                      对方当前队伍人数 {invite.memberCount}/3
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button
                        type="primary"
                        size="small"
                        loading={actionLoadingKey === `respond:${invite.id}:accept`}
                        onClick={() => onRespondInvite(invite.id, true)}
                      >
                        接受
                      </Button>
                      <Button
                        size="small"
                        loading={actionLoadingKey === `respond:${invite.id}:reject`}
                        onClick={() => onRespondInvite(invite.id, false)}
                      >
                        拒绝
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
