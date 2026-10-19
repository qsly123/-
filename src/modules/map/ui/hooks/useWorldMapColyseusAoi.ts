"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GAME_ROOM_NAMES,
  createRealtimeRepairPayload,
  type JoinRoomOptions,
  type MapInteractPayload,
  type MapMovePayload,
  type MapTravelPayload,
  type RealtimeClientInput,
  type RealtimeInputAck,
  type RealtimeInputMetaOverrides,
  type RealtimeRepairTrigger,
  type WorldMapAoiEntity,
  type WorldMapSectorEnvelope,
} from "@immortality/shared-protocol";
import {
  joinGameRoomWithSdkClient,
  loadGameColyseusSdkConstructor,
  type GameRoomConnection,
} from "@/modules/shared/services/colyseus-game-client";
import { useForegroundRepairTrigger } from "@/modules/shared/ui/hooks/useForegroundRepairTrigger";

export type WorldMapColyseusAoiStatus =
  | "idle"
  | "sdk_unavailable"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export type WorldMapColyseusMode = "off" | "shadow" | "main";

export interface WorldMapColyseusAoiSnapshot {
  status: WorldMapColyseusAoiStatus;
  roomId: string | null;
  serverTick: number;
  snapshotVersion: number;
  acceptedSequence: number | null;
  mapId: string | null;
  shardId: string | null;
  sectorSize: number;
  subscribedSectorKeys: string[];
  entities: WorldMapAoiEntity[];
  lastAck: RealtimeInputAck | null;
  lastError: string | null;
  lastMessageAt: number;
  lastRepairAt: number;
  reconnectAttempts: number;
  weakNetwork: boolean;
}

const EMPTY_AOI_SNAPSHOT: WorldMapColyseusAoiSnapshot = {
  status: "idle",
  roomId: null,
  serverTick: 0,
  snapshotVersion: 0,
  acceptedSequence: null,
  mapId: null,
  shardId: null,
  sectorSize: 0,
  subscribedSectorKeys: [],
  entities: [],
  lastAck: null,
  lastError: null,
  lastMessageAt: 0,
  lastRepairAt: 0,
  reconnectAttempts: 0,
  weakNetwork: false,
};

const WORLD_MAP_WEAK_NETWORK_REPAIR_AFTER_MS = 12_000;
const WORLD_MAP_WEAK_NETWORK_CHECK_INTERVAL_MS = 3_000;
const WORLD_MAP_REJOIN_BASE_DELAY_MS = 800;
const WORLD_MAP_REJOIN_MAX_DELAY_MS = 5_000;
const WORLD_MAP_MOVE_ACK_TIMEOUT_MS = 1200;

export function resolveWorldMapColyseusMode(): WorldMapColyseusMode {
  const configuredMode = String(process.env.NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE || "main")
    .trim()
    .toLowerCase();

  if (configuredMode === "off" || configuredMode === "shadow" || configuredMode === "main") {
    return configuredMode;
  }

  return "main";
}

function isWorldMapSectorEnvelope(value: unknown): value is WorldMapSectorEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const envelope = value as Partial<WorldMapSectorEnvelope>;
  const authoritativeState = envelope.authoritativeState as Partial<WorldMapSectorEnvelope["authoritativeState"]> | undefined;

  return (
    (envelope.type === "sector_snapshot" || envelope.type === "sector_delta")
    && typeof envelope.serverTick === "number"
    && typeof envelope.roomId === "string"
    && typeof envelope.snapshotVersion === "number"
    && Boolean(authoritativeState)
    && typeof authoritativeState?.mapId === "string"
    && typeof authoritativeState?.shardId === "string"
    && typeof authoritativeState?.sectorSize === "number"
    && Array.isArray(authoritativeState?.subscribedSectorKeys)
    && Array.isArray(authoritativeState?.entities)
  );
}

function applyWorldMapSectorEnvelope(
  current: WorldMapColyseusAoiSnapshot,
  envelope: WorldMapSectorEnvelope,
): WorldMapColyseusAoiSnapshot {
  const state = envelope.authoritativeState;

  return {
    ...current,
    status: "connected",
    roomId: envelope.roomId,
    serverTick: envelope.serverTick,
    snapshotVersion: envelope.snapshotVersion,
    acceptedSequence: envelope.acceptedSequence,
    mapId: state.mapId,
    shardId: state.shardId,
    sectorSize: state.sectorSize,
    subscribedSectorKeys: [...state.subscribedSectorKeys],
    entities: [...state.entities],
    lastError: null,
    lastMessageAt: Date.now(),
    weakNetwork: false,
  };
}

export function useWorldMapColyseusAoi(params: {
  enabled?: boolean;
  mapId?: string | null;
  playerId?: string | null;
  shardId?: string | null;
  initialSequence?: number;
}) {
  const {
    enabled = true,
    mapId,
    playerId,
    shardId,
    initialSequence,
  } = params;
  const [snapshot, setSnapshot] = useState<WorldMapColyseusAoiSnapshot>(EMPTY_AOI_SNAPSHOT);
  const connectionRef = useRef<GameRoomConnection | null>(null);
  const mountedRef = useRef(false);
  const lastGapRepairVersionRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingMoveAckRef = useRef(new Map<number, {
    timer: number;
    resolve: (ack: RealtimeInputAck) => void;
  }>());
  const snapshotRef = useRef(snapshot);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const joinOptions = useMemo<JoinRoomOptions | null>(() => {
    const normalizedMapId = String(mapId || "").trim();
    const normalizedPlayerId = String(playerId || "").trim();
    const normalizedShardId = String(shardId || "default").trim() || "default";

    if (!enabled || !normalizedMapId || !normalizedPlayerId) {
      return null;
    }

    return {
      mapId: normalizedMapId,
      playerId: normalizedPlayerId,
      shardId: normalizedShardId,
    };
  }, [enabled, mapId, playerId, shardId]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current === null) {
      return;
    }
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const scheduleRejoin = useCallback((reason: string) => {
    clearReconnectTimer();
    const currentAttempts = snapshotRef.current.reconnectAttempts;
    const nextAttempts = currentAttempts + 1;
    const delayMs = Math.min(
      WORLD_MAP_REJOIN_MAX_DELAY_MS,
      WORLD_MAP_REJOIN_BASE_DELAY_MS * Math.max(1, nextAttempts),
    );

    setSnapshot((current) => ({
      ...current,
      status: "reconnecting",
      lastError: reason,
      reconnectAttempts: nextAttempts,
      weakNetwork: true,
    }));

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectAttempt((value) => value + 1);
    }, delayMs);
  }, [clearReconnectTimer]);

  const sendRepair = useCallback((trigger: RealtimeRepairTrigger = "manual", reason?: string) => {
    const connection = connectionRef.current;
    const currentSnapshot = snapshotRef.current;
    if (!connection) {
      return null;
    }

    return connection.sendInput("repair", createRealtimeRepairPayload({
      trigger,
      reason,
      lastServerTick: currentSnapshot.serverTick,
      lastSnapshotVersion: currentSnapshot.snapshotVersion,
      lastAcceptedSequence: currentSnapshot.acceptedSequence ?? undefined,
    }), {
      clientSceneTick: currentSnapshot.serverTick,
    });
  }, []);

  const sendRepairWithSceneTick = useCallback((
    clientSceneTick: number,
    trigger: RealtimeRepairTrigger = "manual",
    reason?: string,
  ) => {
    const connection = connectionRef.current;
    const currentSnapshot = snapshotRef.current;
    if (!connection) {
      return null;
    }

    return connection.sendInput("repair", createRealtimeRepairPayload({
      trigger,
      reason,
      lastServerTick: clientSceneTick,
      lastSnapshotVersion: currentSnapshot.snapshotVersion,
      lastAcceptedSequence: currentSnapshot.acceptedSequence ?? undefined,
    }), {
      clientSceneTick,
    });
  }, []);

  const resolvePendingMoveAck = useCallback((ack: RealtimeInputAck) => {
    const pending = pendingMoveAckRef.current.get(ack.acceptedSequence);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timer);
    pendingMoveAckRef.current.delete(ack.acceptedSequence);
    pending.resolve(ack);
  }, []);

  const clearPendingMoveAcks = useCallback((reason: RealtimeInputAck["reason"] = "stale_state") => {
    for (const [sequence, pending] of pendingMoveAckRef.current.entries()) {
      window.clearTimeout(pending.timer);
      pending.resolve({
        accepted: false,
        inputType: "move",
        acceptedSequence: sequence,
        reason,
        serverTick: snapshotRef.current.serverTick,
      });
    }
    pendingMoveAckRef.current.clear();
  }, []);

  const sendMove = useCallback((
    target: MapMovePayload,
    overrides?: RealtimeInputMetaOverrides,
  ): RealtimeClientInput<MapMovePayload, "move"> | null => {
    const connection = connectionRef.current;
    if (!connection) {
      return null;
    }

    if (!Number.isInteger(target.x) || !Number.isInteger(target.y)) {
      return null;
    }

    return connection.sendInput("move", {
      x: target.x,
      y: target.y,
      ...(Number.isInteger(target.fromX) ? { fromX: target.fromX } : {}),
      ...(Number.isInteger(target.fromY) ? { fromY: target.fromY } : {}),
    }, {
      clientSceneTick: snapshotRef.current.serverTick,
      ...overrides,
    });
  }, []);

  const sendMoveAndWait = useCallback((
    target: MapMovePayload,
    overrides?: RealtimeInputMetaOverrides,
    timeoutMs = WORLD_MAP_MOVE_ACK_TIMEOUT_MS,
  ) => {
    const input = sendMove(target, overrides);
    if (!input) {
      return null;
    }

    const ackPromise = new Promise<RealtimeInputAck<{ x: number; y: number }>>((resolve) => {
      const timer = window.setTimeout(() => {
        pendingMoveAckRef.current.delete(input.clientSequence);
        resolve({
          accepted: false,
          inputType: "move",
          acceptedSequence: input.clientSequence,
          reason: "stale_state",
          serverTick: snapshotRef.current.serverTick,
        });
      }, Math.max(1, timeoutMs));

      pendingMoveAckRef.current.set(input.clientSequence, {
        timer,
        resolve: (ack) => resolve(ack as RealtimeInputAck<{ x: number; y: number }>),
      });
    });

    return {
      input,
      ackPromise,
    };
  }, [sendMove]);

  const sendInteract = useCallback((
    payload: MapInteractPayload,
    overrides?: RealtimeInputMetaOverrides,
  ): RealtimeClientInput<MapInteractPayload, "interact"> | null => {
    const connection = connectionRef.current;
    if (!connection || !payload.entityId) {
      return null;
    }

    return connection.sendInput("interact", payload, {
      clientSceneTick: snapshotRef.current.serverTick,
      ...overrides,
    });
  }, []);

  const sendInteractAndWait = useCallback((
    payload: MapInteractPayload,
    overrides?: RealtimeInputMetaOverrides,
    timeoutMs = WORLD_MAP_MOVE_ACK_TIMEOUT_MS,
  ) => {
    const input = sendInteract(payload, overrides);
    if (!input) {
      return null;
    }

    const ackPromise = new Promise<RealtimeInputAck>((resolve) => {
      const timer = window.setTimeout(() => {
        pendingMoveAckRef.current.delete(input.clientSequence);
        resolve({
          accepted: false,
          inputType: "interact",
          acceptedSequence: input.clientSequence,
          reason: "stale_state",
          serverTick: snapshotRef.current.serverTick,
        });
      }, Math.max(1, timeoutMs));

      pendingMoveAckRef.current.set(input.clientSequence, {
        timer,
        resolve,
      });
    });

    return {
      input,
      ackPromise,
    };
  }, [sendInteract]);

  const sendTravel = useCallback((payload: MapTravelPayload) => {
    const connection = connectionRef.current;
    if (!connection || !payload.targetMapId) {
      return null;
    }

    return connection.sendInput("travel", payload, {
      clientSceneTick: snapshotRef.current.serverTick,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!joinOptions) {
      const resetTimer = window.setTimeout(() => {
        setSnapshot(EMPTY_AOI_SNAPSHOT);
      }, 0);
      return () => {
        window.clearTimeout(resetTimer);
      };
    }

    let closed = false;
    const cleanupCallbacks: Array<() => void> = [];
    clearReconnectTimer();

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

    const handleSectorEnvelope = (message: unknown) => {
      if (!isWorldMapSectorEnvelope(message) || message.authoritativeState.mapId !== joinOptions.mapId) {
        return;
      }

      setSnapshot((current) => {
        const hasVersionGap = message.type === "sector_delta"
          && current.snapshotVersion > 0
          && message.snapshotVersion > current.snapshotVersion + 1;

        if (
          hasVersionGap
          && lastGapRepairVersionRef.current !== message.snapshotVersion
        ) {
          lastGapRepairVersionRef.current = message.snapshotVersion;
          window.setTimeout(() => {
            sendRepairWithSceneTick(message.serverTick, "delta_gap", "sector_delta_version_gap");
          }, 0);
        }

        return applyWorldMapSectorEnvelope(current, message);
      });
    };

    void loadGameColyseusSdkConstructor().then((ClientConstructor) => {
      if (closed || !mountedRef.current) {
        return;
      }

      if (!ClientConstructor) {
        setSnapshot({
          ...EMPTY_AOI_SNAPSHOT,
          status: "sdk_unavailable",
        });
        return;
      }

      void joinGameRoomWithSdkClient({
        ClientConstructor,
        roomName: GAME_ROOM_NAMES.worldMap,
        options: joinOptions,
        initialSequence,
        messageHandlers: [
          {
            type: "sector_snapshot",
            callback: handleSectorEnvelope,
          },
          {
            type: "sector_delta",
            callback: handleSectorEnvelope,
          },
        ],
        onAck: (ack) => {
          if (!mountedRef.current || closed) {
            return;
          }
          resolvePendingMoveAck(ack);
          setSnapshot((current) => ({
            ...current,
            lastAck: ack,
            acceptedSequence: ack.acceptedSequence,
            lastMessageAt: Date.now(),
            lastRepairAt: ack.inputType === "repair" ? Date.now() : current.lastRepairAt,
            weakNetwork: false,
          }));
        },
        onReconnect: () => {
          if (!mountedRef.current || closed) {
            return;
          }
          setSnapshot((current) => ({
            ...current,
            status: "connected",
            lastError: null,
            lastMessageAt: Date.now(),
            weakNetwork: false,
          }));
          window.setTimeout(() => {
            sendRepairWithSceneTick(snapshotRef.current.serverTick, "reconnect", "world_map_sdk_reconnected");
          }, 0);
        },
        onLeave: (code, reason) => {
          if (!mountedRef.current || closed) {
            return;
          }
          clearPendingMoveAcks("stale_state");
          connectionRef.current = null;
          scheduleRejoin(`Colyseus 地图房间断开：${code}${reason ? ` ${reason}` : ""}`);
        },
      }).then((connection) => {
        if (closed) {
          void connection.leave();
          return;
        }

        connectionRef.current = connection;
        const roomId = connection.room.id;

        setSnapshot((current) => ({
          ...current,
          status: "connected",
          roomId,
          mapId: joinOptions.mapId || null,
          shardId: joinOptions.shardId || null,
          lastError: null,
          lastMessageAt: Date.now(),
          weakNetwork: false,
        }));

        connection.sendInput("repair", createRealtimeRepairPayload({
          trigger: "initial_join",
          reason: "world_map_joined",
          lastServerTick: 0,
          lastSnapshotVersion: 0,
        }), {
          clientSceneTick: 0,
        });
      }).catch((error: unknown) => {
        if (closed || !mountedRef.current) {
          return;
        }

        const reason = error instanceof Error ? error.message : "Colyseus 地图房间连接失败";
        setSnapshot((current) => ({
          ...current,
          status: "error",
          lastError: reason,
          weakNetwork: true,
        }));
        scheduleRejoin(reason);
      });
    }).catch((error: unknown) => {
      if (closed || !mountedRef.current) {
        return;
      }

      setSnapshot((current) => ({
        ...current,
        status: "error",
        lastError: error instanceof Error ? error.message : "Colyseus 地图房间连接失败",
        weakNetwork: true,
      }));
      scheduleRejoin(error instanceof Error ? error.message : "Colyseus 地图房间连接失败");
    });

    return () => {
      closed = true;
      clearReconnectTimer();
      clearPendingMoveAcks("stale_state");
      for (const cleanup of cleanupCallbacks.splice(0)) {
        cleanup();
      }
      const connection = connectionRef.current;
      connectionRef.current = null;
      if (connection) {
        void connection.leave();
      }
    };
  }, [
    clearReconnectTimer,
    initialSequence,
    joinOptions,
    reconnectAttempt,
    scheduleRejoin,
    sendRepairWithSceneTick,
    clearPendingMoveAcks,
    resolvePendingMoveAck,
  ]);

  // iOS 锁屏 / 切后台回到前台后统一发一次权威 repair，避免地图状态停留在旧值。
  // hook 内部已合并 visibilitychange / pageshow / focus，不区分 iOS 与 Android。
  useForegroundRepairTrigger({
    enabled: Boolean(joinOptions),
    onRepair: (trigger, source) => {
      sendRepairWithSceneTick(snapshotRef.current.serverTick, trigger, source);
    },
  });

  useEffect(() => {
    if (!joinOptions) {
      return;
    }

    const repairAfterOnline = () => {
      if (!connectionRef.current) {
        scheduleRejoin("browser_online_rejoin");
      }
    };

    const markOffline = () => {
      setSnapshot((current) => ({
        ...current,
        status: current.status === "connected" ? "reconnecting" : current.status,
        weakNetwork: true,
        lastError: "browser_offline",
      }));
    };

    window.addEventListener("online", repairAfterOnline);
    window.addEventListener("offline", markOffline);

    return () => {
      window.removeEventListener("online", repairAfterOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [joinOptions, scheduleRejoin]);

  useEffect(() => {
    if (!joinOptions) {
      return;
    }

    const timer = window.setInterval(() => {
      const current = snapshotRef.current;
      if (current.status !== "connected" || !connectionRef.current) {
        return;
      }
      const lastMessageAt = current.lastMessageAt || Date.now();
      if (Date.now() - lastMessageAt < WORLD_MAP_WEAK_NETWORK_REPAIR_AFTER_MS) {
        return;
      }
      setSnapshot((value) => ({
        ...value,
        weakNetwork: true,
      }));
      sendRepairWithSceneTick(current.serverTick, "weak_network_timeout", "no_recent_world_map_message");
    }, WORLD_MAP_WEAK_NETWORK_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [joinOptions, sendRepairWithSceneTick]);

  return {
    ...snapshot,
    sendMove,
    sendMoveAndWait,
    sendInteract,
    sendInteractAndWait,
    sendTravel,
    sendRepair,
  };
}
