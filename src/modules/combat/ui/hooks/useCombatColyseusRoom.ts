"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRealtimeRepairPayload,
  GAME_ROOM_NAMES,
  type CombatCommandPayload,
  type CombatMovementPayload,
  type CombatSceneEnvelope,
  type JoinRoomOptions,
  type RealtimeInputAck,
  type RealtimeInputMetaOverrides,
  type RealtimeRepairTrigger,
} from "@immortality/shared-protocol";
import {
  joinGameRoomWithSdkClient,
  loadGameColyseusSdkConstructor,
  type GameRoomConnection,
} from "@/modules/shared/services/colyseus-game-client";
import {
  createStateRefreshMessageHandlers,
  useStateRefreshFrames,
} from "@/modules/shared/ui/hooks/useStateRefreshFrames";

export type CombatColyseusRoomStatus =
  | "idle"
  | "sdk_unavailable"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export interface CombatColyseusRoomSnapshot {
  status: CombatColyseusRoomStatus;
  roomId: string | null;
  sceneSnapshot: CombatSceneEnvelope | null;
  lastTimelineEvent: CombatSceneEnvelope | null;
  lastSettlement: CombatSceneEnvelope | null;
  lastAck: RealtimeInputAck | null;
  lastError: string | null;
  lastMessageAt: number;
}

const EMPTY_COMBAT_COLYSEUS_ROOM: CombatColyseusRoomSnapshot = {
  status: "idle",
  roomId: null,
  sceneSnapshot: null,
  lastTimelineEvent: null,
  lastSettlement: null,
  lastAck: null,
  lastError: null,
  lastMessageAt: 0,
};

function isCombatSceneEnvelope(
  value: unknown,
  expectedType: CombatSceneEnvelope["type"] = "scene_snapshot",
): value is CombatSceneEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const envelope = value as Partial<CombatSceneEnvelope>;
  const authoritativeState = envelope.authoritativeState as Partial<CombatSceneEnvelope["authoritativeState"]> | undefined;
  return envelope.type === expectedType
    && typeof envelope.serverTick === "number"
    && typeof envelope.roomId === "string"
    && typeof envelope.snapshotVersion === "number"
    && Boolean(authoritativeState)
    && Array.isArray(authoritativeState?.entities);
}

function resolveCombatSceneInputTick(envelope?: CombatSceneEnvelope | null) {
  const authoritativeState = envelope?.authoritativeState as Partial<{
    sceneSnapshot?: { tick?: number };
  }> | undefined;
  const battleSceneTick = Number(authoritativeState?.sceneSnapshot?.tick);
  if (Number.isFinite(battleSceneTick)) {
    return Math.max(0, Math.floor(battleSceneTick));
  }
  return envelope?.serverTick ?? 0;
}

export function useCombatColyseusRoom(params: {
  enabled?: boolean;
  roomName?: typeof GAME_ROOM_NAMES.combat | typeof GAME_ROOM_NAMES.boss | typeof GAME_ROOM_NAMES.pvp;
  combatId?: string | null;
  playerId?: string | null;
  partyId?: string | null;
  initialSequence?: number;
}) {
  const {
    enabled = true,
    roomName = GAME_ROOM_NAMES.combat,
    combatId,
    playerId,
    partyId,
    initialSequence,
  } = params;
  const [snapshot, setSnapshot] = useState<CombatColyseusRoomSnapshot>(EMPTY_COMBAT_COLYSEUS_ROOM);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const {
    signals: stateRefreshSignals,
    versions: stateRefreshVersions,
    applyFrame: applyStateRefreshFrame,
  } = useStateRefreshFrames(null);
  const connectionRef = useRef<GameRoomConnection | null>(null);
  const mountedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const initialSequenceRef = useRef(initialSequence);
  const joinOptions = useMemo<JoinRoomOptions | null>(() => {
    const normalizedCombatId = String(combatId || "").trim();
    const normalizedPlayerId = String(playerId || "").trim();
    const normalizedPartyId = String(partyId || "").trim();

    if (!enabled || !normalizedCombatId || !normalizedPlayerId) {
      return null;
    }

    return {
      combatId: normalizedCombatId,
      playerId: normalizedPlayerId,
      ...(normalizedPartyId ? { partyId: normalizedPartyId } : {}),
    };
  }, [combatId, enabled, partyId, playerId]);

  const sendRepair = useCallback((trigger: RealtimeRepairTrigger = "manual", reason?: string) => {
    const connection = connectionRef.current;
    if (!connection) {
      return null;
    }
    return connection.sendInput("repair", createRealtimeRepairPayload({
      trigger,
      ...(reason ? { reason } : {}),
      lastServerTick: snapshot.sceneSnapshot?.serverTick,
      lastSnapshotVersion: snapshot.sceneSnapshot?.snapshotVersion,
      lastAcceptedSequence: snapshot.sceneSnapshot?.acceptedSequence ?? undefined,
    }), {
      clientSceneTick: resolveCombatSceneInputTick(snapshot.sceneSnapshot),
    });
  }, [snapshot.sceneSnapshot]);

  const sendMovement = useCallback((payload: CombatMovementPayload) => {
    const connection = connectionRef.current;
    if (!connection) {
      return null;
    }
    return connection.sendInput("movement", payload, {
      clientSceneTick: resolveCombatSceneInputTick(snapshot.sceneSnapshot),
    });
  }, [snapshot.sceneSnapshot]);

  const sendMovementAndWaitForAck = useCallback((payload: CombatMovementPayload, overrides?: RealtimeInputMetaOverrides & { timeoutMs?: number }) => {
    const connection = connectionRef.current;
    if (!connection) {
      return null;
    }
    return connection.sendInputAndWaitForAck("movement", payload, {
      clientSceneTick: resolveCombatSceneInputTick(snapshot.sceneSnapshot),
      ...overrides,
    });
  }, [snapshot.sceneSnapshot]);

  const sendCommand = useCallback((payload: CombatCommandPayload, overrides?: RealtimeInputMetaOverrides) => {
    const connection = connectionRef.current;
    if (!connection) {
      return null;
    }
    return connection.sendInput("command", payload, {
      clientSceneTick: resolveCombatSceneInputTick(snapshot.sceneSnapshot),
      ...overrides,
    });
  }, [snapshot.sceneSnapshot]);

  const sendCommandAndWaitForAck = useCallback((payload: CombatCommandPayload, overrides?: RealtimeInputMetaOverrides & { timeoutMs?: number }) => {
    const connection = connectionRef.current;
    if (!connection) {
      return null;
    }
    return connection.sendInputAndWaitForAck("command", payload, {
      clientSceneTick: resolveCombatSceneInputTick(snapshot.sceneSnapshot),
      ...overrides,
    });
  }, [snapshot.sceneSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    initialSequenceRef.current = initialSequence;
  }, [initialSequence]);

  useEffect(() => {
    if (!joinOptions) {
      reconnectAttemptRef.current = 0;
      const resetTimer = window.setTimeout(() => {
        setSnapshot(EMPTY_COMBAT_COLYSEUS_ROOM);
      }, 0);
      return () => {
        window.clearTimeout(resetTimer);
      };
    }

    let closed = false;
    const cleanupCallbacks: Array<() => void> = [];
    const connectingStatusTimer = window.setTimeout(() => {
      if (closed || !mountedRef.current) {
        return;
      }
      setSnapshot((current) => ({
        ...current,
        status: "connecting",
        lastError: null,
      }));
    }, 0);
    cleanupCallbacks.push(() => window.clearTimeout(connectingStatusTimer));

    void loadGameColyseusSdkConstructor().then((ClientConstructor) => {
      if (closed || !mountedRef.current) {
        return;
      }
      if (!ClientConstructor) {
        setSnapshot({
          ...EMPTY_COMBAT_COLYSEUS_ROOM,
          status: "sdk_unavailable",
        });
        return;
      }

      const handleSceneSnapshot = (message: unknown) => {
        if (closed || !mountedRef.current || !isCombatSceneEnvelope(message)) {
          return;
        }
        setSnapshot((current) => ({
          ...current,
          status: "connected",
          roomId: message.roomId,
          sceneSnapshot: message,
          lastError: null,
          lastMessageAt: Date.now(),
        }));
        reconnectAttemptRef.current = 0;
      };
      const handleTimelineEvent = (message: unknown) => {
        if (closed || !mountedRef.current || !isCombatSceneEnvelope(message, "timeline_event")) {
          return;
        }
        setSnapshot((current) => ({
          ...current,
          status: "connected",
          roomId: message.roomId,
          lastTimelineEvent: message,
          lastError: null,
          lastMessageAt: Date.now(),
        }));
      };
      const handleSettlement = (message: unknown) => {
        if (closed || !mountedRef.current || !isCombatSceneEnvelope(message, "settlement")) {
          return;
        }
        setSnapshot((current) => ({
          ...current,
          status: "connected",
          roomId: message.roomId,
          lastSettlement: message,
          lastError: null,
          lastMessageAt: Date.now(),
        }));
      };

      void joinGameRoomWithSdkClient({
        ClientConstructor,
        roomName,
        options: joinOptions,
        initialSequence: initialSequenceRef.current,
        messageHandlers: [
          {
            type: "scene_snapshot",
            callback: handleSceneSnapshot,
          },
          {
            type: "timeline_event",
            callback: handleTimelineEvent,
          },
          {
            type: "settlement",
            callback: handleSettlement,
          },
          // 资产 / 背包 / 进度刷新帧必须在 join 前预注册，避免首帧到达时被 SDK 丢弃。
          ...createStateRefreshMessageHandlers((frame) => {
            applyStateRefreshFrame(frame);
          }),
        ],
        onAck: (ack) => {
          if (closed || !mountedRef.current) {
            return;
          }
          setSnapshot((current) => ({
            ...current,
            lastAck: ack,
            lastMessageAt: Date.now(),
          }));
        },
        onLeave: (code, reason) => {
          if (closed || !mountedRef.current) {
            return;
          }
          connectionRef.current = null;
          const attempt = reconnectAttemptRef.current + 1;
          reconnectAttemptRef.current = attempt;
          const delayMs = Math.min(5000, 500 * attempt);
          const reconnectTimer = window.setTimeout(() => {
            if (closed || !mountedRef.current) {
              return;
            }
            setReconnectNonce((current) => current + 1);
          }, delayMs);
          cleanupCallbacks.push(() => window.clearTimeout(reconnectTimer));
          setSnapshot((current) => ({
            ...current,
            status: "reconnecting",
            lastError: `Colyseus 战斗房间断开：${code}${reason ? ` ${reason}` : ""}`,
          }));
        },
        onReconnect: () => {
          if (closed || !mountedRef.current) {
            return;
          }
          setSnapshot((current) => ({
            ...current,
            status: "connected",
            lastError: null,
            lastMessageAt: Date.now(),
          }));
        },
      }).then((connection) => {
        if (closed) {
          void connection.leave();
          return;
        }

        connectionRef.current = connection;
        reconnectAttemptRef.current = 0;
        setSnapshot((current) => ({
          ...current,
          status: "connected",
          roomId: connection.room.id,
          lastError: null,
          lastMessageAt: Date.now(),
        }));
        connection.sendInput("repair", createRealtimeRepairPayload({
          trigger: "initial_join",
          reason: "combat_phaser_joined",
          lastServerTick: 0,
          lastSnapshotVersion: 0,
        }), {
          clientSceneTick: 0,
        });
      }).catch((error: unknown) => {
        if (closed || !mountedRef.current) {
          return;
        }
        setSnapshot((current) => ({
          ...current,
          status: "error",
          lastError: error instanceof Error ? error.message : "Colyseus 战斗房间连接失败",
        }));
      });
    }).catch((error: unknown) => {
      if (closed || !mountedRef.current) {
        return;
      }
      setSnapshot((current) => ({
        ...current,
        status: "error",
        lastError: error instanceof Error ? error.message : "Colyseus 战斗房间连接失败",
      }));
    });

    return () => {
      closed = true;
      for (const cleanup of cleanupCallbacks.splice(0)) {
        cleanup();
      }
      const connection = connectionRef.current;
      connectionRef.current = null;
      if (connection) {
        void connection.leave();
      }
    };
    // applyStateRefreshFrame 由 useStateRefreshFrames 用 useCallback([]) 创建，引用稳定。
  }, [applyStateRefreshFrame, joinOptions, reconnectNonce, roomName]);

  return {
    ...snapshot,
    sendCommand,
    sendCommandAndWaitForAck,
    sendMovement,
    sendMovementAndWaitForAck,
    sendRepair,
    stateRefreshSignals,
    stateRefreshVersions,
    applyStateRefreshFrame,
  };
}
