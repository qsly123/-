"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  type MapSceneNpc,
  type MapSceneMonster,
  type MapSceneOpportunity,
  type MapScenePlayer,
  type MapSceneSnapshot,
} from "@/modules/map/services/map-scene-state";
import type { MapSceneSelfCorrection } from "@/modules/map/services/map-scene-render-state";

type MapMoveTarget = {
  x: number;
  y: number;
};

type IssueMoveRequestOptions = {
  stationaryInteraction?: boolean;
};

export type MapMoveRequestResult = {
  success: boolean;
  error?: string;
  status?: number;
  data?: {
    newX: number;
    newY: number;
    event?: unknown;
    message?: string;
    acceptedClientSequence?: number;
    serverSceneTick?: number;
    sceneVersion?: number;
    serverTimeMs?: number;
    authoritativePosition?: MapMoveTarget;
    resyncRequired?: boolean;
    resyncReason?: string;
    transportUnavailable?: boolean;
  };
};

export type MapMoveRequestExecutor = (params: {
  from: MapMoveTarget;
  target: MapMoveTarget;
  clientSequence: number;
  stationaryInteraction: boolean;
}) => Promise<MapMoveRequestResult>;

type MapSceneControllerData = {
  map: {
    id: string;
  };
  player: {
    id: string;
    positionX: number;
    positionY: number;
  };
  otherPlayers: MapScenePlayer[];
  npcs: MapSceneNpc[];
  monsters: MapSceneMonster[];
  opportunities: MapSceneOpportunity[];
  playerOnPortal?: boolean;
  playerPortal?: {
    portalId?: string | null;
    x: number;
    y: number;
  } | null;
  portals?: Array<{
    portalId?: string | null;
    x: number;
    y: number;
  }>;
  sceneSnapshot?: MapSceneSnapshot | null;
};

type PartySnapshotLite = {
  party?: {
    leaderPlayerId: string;
  } | null;
} | null;

type MessageApiLike = {
  warning(content: string): void;
  error(content: string): void;
};

type SilentRefreshOptions = {
  immediate?: boolean;
  bypassMinInterval?: boolean;
};

const SILENT_MAP_REFRESH_DEBOUNCE_MS = 900;
const SILENT_MAP_REFRESH_MIN_INTERVAL_MS = 2500;
const MAP_MOVE_ACK_TIMEOUT_MS = 700;
const MAP_MOVE_SMALL_CORRECTION_MAX_TILES = 1;
const MAP_MOVE_SMOOTH_CORRECTION_MAX_TILES = 2;
const MAP_MOVE_SMOOTH_CORRECTION_MS = 80;

function calcGridDistance(from: MapMoveTarget, to: MapMoveTarget) {
  return Math.max(
    Math.abs(from.x - to.x),
    Math.abs(from.y - to.y),
  );
}

export function useMapSceneController<
  TData extends MapSceneControllerData,
  TFetchData extends TData = TData,
>(params: {
  data: TData | null;
  partySnapshot: PartySnapshotLite;
  setData: Dispatch<SetStateAction<TData | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setMoving: Dispatch<SetStateAction<boolean>>;
  filterVisibleMapData: (data: TData) => TData;
  buildSceneSnapshotFromMapData: (
    nextData: TData,
    options?: {
      previousSnapshot?: MapSceneSnapshot | null;
      sequence?: number;
      tick?: number;
      serverTimeMs?: number;
      preferEmbeddedSnapshot?: boolean;
    },
  ) => MapSceneSnapshot;
  resolveMovePath?: (
    currentData: TData,
    from: MapMoveTarget,
    target: MapMoveTarget,
  ) => MapMoveTarget[];
  onMoveEvent: (event: unknown) => Promise<void>;
  messageApi: MessageApiLike;
  extractSceneData?: (data: TFetchData) => TData;
  onFetchSuccess?: (data: TFetchData, options: { silent: boolean; didMapChange: boolean }) => void;
  onAuthoritativeMove?: (move: {
    from: MapMoveTarget;
    target: MapMoveTarget;
    authoritativePosition: MapMoveTarget;
    clientSequence: number;
    serverSceneTick?: number;
  }) => void;
  buildFetchUrl?: (options?: { silent?: boolean; reason?: string }) => string;
  executeMoveRequest: MapMoveRequestExecutor;
}) {
  const {
    data,
    partySnapshot,
    setData,
    setLoading,
    setMoving,
    filterVisibleMapData,
    buildSceneSnapshotFromMapData,
    resolveMovePath,
    onMoveEvent,
    messageApi,
    extractSceneData,
    onFetchSuccess,
    onAuthoritativeMove,
    buildFetchUrl,
    executeMoveRequest,
  } = params;
  const [lastAcceptedClientSequence, setLastAcceptedClientSequence] = useState(0);
  const [selfRenderCorrection, setSelfRenderCorrection] = useState<MapSceneSelfCorrection | null>(null);
  const [previousSceneSnapshot, setPreviousSceneSnapshot] = useState<MapSceneSnapshot | null>(null);
  const dataRef = useRef<TData | null>(null);
  const filterVisibleMapDataRef = useRef(filterVisibleMapData);
  const buildSceneSnapshotFromMapDataRef = useRef(buildSceneSnapshotFromMapData);
  const resolveMovePathRef = useRef(resolveMovePath);
  const onMoveEventRef = useRef(onMoveEvent);
  const messageApiRef = useRef(messageApi);
  const extractSceneDataRef = useRef(extractSceneData);
  const onFetchSuccessRef = useRef(onFetchSuccess);
  const onAuthoritativeMoveRef = useRef(onAuthoritativeMove);
  const buildFetchUrlRef = useRef(buildFetchUrl);
  const executeMoveRequestRef = useRef(executeMoveRequest);
  const sceneSnapshotRef = useRef<MapSceneSnapshot | null>(null);
  const nextClientSequenceRef = useRef(1);
  const lastAuthoritativeServerTickRef = useRef(1);
  const authoritativePlayerPositionRef = useRef<MapMoveTarget | null>(null);
  const predictedPlayerPositionRef = useRef<MapMoveTarget | null>(null);
  const moveRuntimeRef = useRef<{ inFlight: boolean; queuedSteps: MapMoveTarget[] }>({
    inFlight: false,
    queuedSteps: [],
  });
  const partySnapshotRef = useRef<PartySnapshotLite>(partySnapshot);
  const mapRequestIdRef = useRef(0);
  const lastResyncWarningAtRef = useRef(0);
  const pendingSilentRefreshRef = useRef(false);
  const pendingSilentRefreshReasonRef = useRef("manual");
  const silentRefreshTimerRef = useRef<number | null>(null);
  const lastSilentRefreshAtRef = useRef(0);
  const activeAckRequestIdRef = useRef(0);
  const ackTimeoutTimerRef = useRef<number | null>(null);
  const consecutiveAckTimeoutCountRef = useRef(0);

  useEffect(() => {
    dataRef.current = data;
    if (!data) {
      authoritativePlayerPositionRef.current = null;
      predictedPlayerPositionRef.current = null;
      setSelfRenderCorrection(null);
      return;
    }
    if (typeof data.sceneSnapshot?.tick === "number") {
      const nextTick = Math.max(1, data.sceneSnapshot.tick);
      const previousSnapshotMapId = sceneSnapshotRef.current?.mapId ?? null;
      if (
        sceneSnapshotRef.current
        && (
          sceneSnapshotRef.current.sequence !== data.sceneSnapshot.sequence
          || sceneSnapshotRef.current.mapId !== data.sceneSnapshot.mapId
        )
      ) {
        setPreviousSceneSnapshot(sceneSnapshotRef.current);
      }
      sceneSnapshotRef.current = data.sceneSnapshot;
      lastAuthoritativeServerTickRef.current = previousSnapshotMapId === data.map.id
        ? (
          authoritativePlayerPositionRef.current
            ? Math.max(lastAuthoritativeServerTickRef.current, nextTick)
            : nextTick
        )
        : nextTick;
    }

    if (!moveRuntimeRef.current.inFlight && moveRuntimeRef.current.queuedSteps.length === 0) {
      predictedPlayerPositionRef.current = {
        x: data.player.positionX,
        y: data.player.positionY,
      };
    }
  }, [data]);

  useEffect(() => {
    filterVisibleMapDataRef.current = filterVisibleMapData;
    buildSceneSnapshotFromMapDataRef.current = buildSceneSnapshotFromMapData;
    resolveMovePathRef.current = resolveMovePath;
    onMoveEventRef.current = onMoveEvent;
    messageApiRef.current = messageApi;
    extractSceneDataRef.current = extractSceneData;
    onFetchSuccessRef.current = onFetchSuccess;
    onAuthoritativeMoveRef.current = onAuthoritativeMove;
    buildFetchUrlRef.current = buildFetchUrl;
    executeMoveRequestRef.current = executeMoveRequest;
  }, [
    buildFetchUrl,
    buildSceneSnapshotFromMapData,
    executeMoveRequest,
    extractSceneData,
    filterVisibleMapData,
    messageApi,
    onAuthoritativeMove,
    onFetchSuccess,
    onMoveEvent,
    resolveMovePath,
  ]);

  useEffect(() => {
    partySnapshotRef.current = partySnapshot;
  }, [partySnapshot]);

  const resetMoveRuntime = useCallback((position?: MapMoveTarget | null) => {
    moveRuntimeRef.current.inFlight = false;
    moveRuntimeRef.current.queuedSteps = [];
    if (position) {
      authoritativePlayerPositionRef.current = position;
      predictedPlayerPositionRef.current = position;
    }
    setSelfRenderCorrection(null);
    setMoving(false);
  }, [setMoving]);

  const resetClientMoveSequence = useCallback(() => {
    nextClientSequenceRef.current = 1;
    setLastAcceptedClientSequence(0);
  }, []);

  const syncAcceptedClientSequence = useCallback((
    acceptedClientSequence?: number,
    options?: { requestedClientSequence?: number },
  ) => {
    if (typeof acceptedClientSequence !== "number") {
      return;
    }

    setLastAcceptedClientSequence(acceptedClientSequence);
    const requestedClientSequence = options?.requestedClientSequence;
    nextClientSequenceRef.current = typeof requestedClientSequence === "number" && acceptedClientSequence < requestedClientSequence
      ? Math.max(1, acceptedClientSequence + 1)
      : Math.max(
        nextClientSequenceRef.current,
        acceptedClientSequence + 1,
      );
  }, []);

  const restorePendingClientSequence = useCallback((clientSequence?: number) => {
    if (typeof clientSequence !== "number") {
      return;
    }

    nextClientSequenceRef.current = Math.max(1, clientSequence);
  }, []);

  const applyPlayerPositionToMapState = useCallback((
    position: MapMoveTarget,
    options?: {
      sequence?: number;
      tick?: number;
      sceneVersion?: number;
      serverTimeMs?: number;
      authoritative?: boolean;
      preserveRealtimeBaseline?: boolean;
    },
  ) => {
    if (options?.authoritative !== false) {
      authoritativePlayerPositionRef.current = position;
      if (typeof options?.tick === "number") {
        lastAuthoritativeServerTickRef.current = Math.max(
          lastAuthoritativeServerTickRef.current,
          Math.max(1, options.tick),
        );
      }
    }
    predictedPlayerPositionRef.current = position;

    setData((previousData) => {
      if (!previousData) {
        return previousData;
      }

      const nextData = {
        ...previousData,
        player: {
          ...previousData.player,
          positionX: position.x,
          positionY: position.y,
        },
      };
      const visibleData = filterVisibleMapDataRef.current(nextData);
      const baseSnapshot = sceneSnapshotRef.current;
      const preserveRealtimeBaseline = options?.preserveRealtimeBaseline === true;
      const nextSnapshot = buildSceneSnapshotFromMapDataRef.current(visibleData, {
        previousSnapshot: baseSnapshot,
        sequence: preserveRealtimeBaseline
          ? (baseSnapshot?.sequence ?? 1)
          : typeof options?.sequence === "number"
          ? options.sequence
          : (options?.authoritative === false ? (baseSnapshot?.sequence ?? 1) : undefined),
        tick: typeof options?.tick === "number"
          ? options.tick
          : (options?.authoritative === false ? (baseSnapshot?.tick ?? 1) : undefined),
        serverTimeMs: options?.serverTimeMs ?? (options?.authoritative === false ? baseSnapshot?.serverTimeMs : undefined),
        preferEmbeddedSnapshot: false,
      });
      if (typeof options?.sceneVersion === "number" && Number.isFinite(options.sceneVersion)) {
        nextSnapshot.sceneVersion = Math.max(1, Math.floor(options.sceneVersion));
      } else if (preserveRealtimeBaseline && typeof baseSnapshot?.sceneVersion === "number") {
        nextSnapshot.sceneVersion = Math.max(1, Math.floor(baseSnapshot.sceneVersion));
      } else if (options?.authoritative === false && typeof baseSnapshot?.sceneVersion === "number") {
        nextSnapshot.sceneVersion = Math.max(1, Math.floor(baseSnapshot.sceneVersion));
      }
      if (preserveRealtimeBaseline && typeof baseSnapshot?.entitiesRevision === "number") {
        nextSnapshot.entitiesRevision = Math.max(1, Math.floor(baseSnapshot.entitiesRevision));
      } else if (options?.authoritative === false && typeof baseSnapshot?.entitiesRevision === "number") {
        nextSnapshot.entitiesRevision = Math.max(1, Math.floor(baseSnapshot.entitiesRevision));
      }

      if (options?.authoritative !== false) {
        setPreviousSceneSnapshot(sceneSnapshotRef.current ?? null);
      }
      sceneSnapshotRef.current = nextSnapshot;

      return {
        ...visibleData,
        sceneSnapshot: nextSnapshot,
      };
    });
  }, [setData]);

  const revertToAuthoritativePlayerPosition = useCallback(() => {
    const authoritativePosition = authoritativePlayerPositionRef.current;
    if (!authoritativePosition) {
      return;
    }

    applyPlayerPositionToMapState(authoritativePosition, {
      authoritative: true,
      preserveRealtimeBaseline: true,
    });
  }, [applyPlayerPositionToMapState]);

  const fetchMap = useCallback(async (options?: { silent?: boolean; reason?: string }) => {
    const silent = options?.silent === true;
    if (silent && (moveRuntimeRef.current.inFlight || moveRuntimeRef.current.queuedSteps.length > 0)) {
      pendingSilentRefreshRef.current = true;
      return;
    }
    if (silent) {
      pendingSilentRefreshRef.current = false;
    }
    const requestId = mapRequestIdRef.current + 1;
    mapRequestIdRef.current = requestId;

    try {
      const requestUrl = buildFetchUrlRef.current
        ? buildFetchUrlRef.current({ silent, reason: options?.reason })
        : (() => {
          const url = new URL(silent ? "/api/game/map?refreshMode=silent" : "/api/game/map", window.location.origin);
          if (silent) {
            url.searchParams.set("reason", options?.reason || pendingSilentRefreshReasonRef.current || "manual");
          }
          return `${url.pathname}${url.search}`;
        })();
      const response = await fetch(requestUrl, { cache: "no-store" });
      const json = await response.json() as {
        success: boolean;
        error?: string;
        data?: TFetchData;
      };

      if (mapRequestIdRef.current !== requestId) {
        return;
      }

      if (json.success) {
        if (silent && (moveRuntimeRef.current.inFlight || moveRuntimeRef.current.queuedSteps.length > 0)) {
          pendingSilentRefreshRef.current = true;
          return;
        }
        const fetchedData = json.data || null;
        if (fetchedData) {
          const nextData = extractSceneDataRef.current ? extractSceneDataRef.current(fetchedData) : fetchedData;
          const previousMapId = dataRef.current?.map.id ?? sceneSnapshotRef.current?.mapId ?? null;
          const visibleData = filterVisibleMapDataRef.current(nextData);
          const didMapChange = previousMapId !== null && previousMapId !== visibleData.map.id;
          const currentTransportSnapshot = didMapChange ? null : sceneSnapshotRef.current;
          const hasEmbeddedSnapshot = Boolean(visibleData.sceneSnapshot);
          const nextSnapshot = buildSceneSnapshotFromMapDataRef.current(visibleData, {
            previousSnapshot: currentTransportSnapshot,
            sequence: !hasEmbeddedSnapshot && currentTransportSnapshot
              ? currentTransportSnapshot.sequence
              : undefined,
            tick: !hasEmbeddedSnapshot && currentTransportSnapshot
              ? currentTransportSnapshot.tick
              : undefined,
            serverTimeMs: !hasEmbeddedSnapshot && currentTransportSnapshot
              ? currentTransportSnapshot.serverTimeMs
              : undefined,
          });
          if (!hasEmbeddedSnapshot && currentTransportSnapshot) {
            nextSnapshot.sceneVersion = currentTransportSnapshot.sceneVersion;
            nextSnapshot.entitiesRevision = currentTransportSnapshot.entitiesRevision;
          }
          const nextPosition = {
            x: visibleData.player.positionX,
            y: visibleData.player.positionY,
          };

          setPreviousSceneSnapshot(sceneSnapshotRef.current ?? null);
          sceneSnapshotRef.current = nextSnapshot;
          lastAuthoritativeServerTickRef.current = Math.max(1, nextSnapshot.tick || 1);
          if (silent) {
            lastSilentRefreshAtRef.current = Date.now();
          }
          setSelfRenderCorrection(null);
          if (!silent || didMapChange) {
            resetClientMoveSequence();
          }
          resetMoveRuntime(nextPosition);
          setData({
            ...visibleData,
            sceneSnapshot: nextSnapshot,
          });
          onFetchSuccessRef.current?.(fetchedData, {
            silent,
            didMapChange,
          });
        } else {
          sceneSnapshotRef.current = null;
          if (silent) {
            lastSilentRefreshAtRef.current = Date.now();
          }
          resetMoveRuntime(null);
          setData(null);
        }
        return;
      }

      if (!silent) {
        messageApiRef.current.error(json.error || "加载地图失败");
      }
    } catch {
      if (mapRequestIdRef.current !== requestId) {
        return;
      }

      if (!silent) {
        messageApiRef.current.error("加载地图失败");
      }
    } finally {
      if (!silent && mapRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    resetClientMoveSequence,
    resetMoveRuntime,
    setData,
    setLoading,
  ]);

  const clearSilentRefreshTimer = useCallback(() => {
    if (silentRefreshTimerRef.current === null) {
      return;
    }
    window.clearTimeout(silentRefreshTimerRef.current);
    silentRefreshTimerRef.current = null;
  }, []);

  const clearAckTimeoutTimer = useCallback(() => {
    if (ackTimeoutTimerRef.current === null) {
      return;
    }
    window.clearTimeout(ackTimeoutTimerRef.current);
    ackTimeoutTimerRef.current = null;
  }, []);

  const flushPendingSilentRefresh = useCallback(() => {
    if (!pendingSilentRefreshRef.current) {
      return;
    }
    if (moveRuntimeRef.current.inFlight || moveRuntimeRef.current.queuedSteps.length > 0) {
      return;
    }
    const elapsedMs = Date.now() - lastSilentRefreshAtRef.current;
    if (elapsedMs < SILENT_MAP_REFRESH_MIN_INTERVAL_MS) {
      clearSilentRefreshTimer();
      silentRefreshTimerRef.current = window.setTimeout(() => {
        silentRefreshTimerRef.current = null;
        flushPendingSilentRefresh();
      }, Math.max(
        SILENT_MAP_REFRESH_DEBOUNCE_MS,
        SILENT_MAP_REFRESH_MIN_INTERVAL_MS - elapsedMs,
      ));
      return;
    }
    pendingSilentRefreshRef.current = false;
    const refreshReason = pendingSilentRefreshReasonRef.current || "manual";
    pendingSilentRefreshReasonRef.current = "manual";
    clearSilentRefreshTimer();
    void fetchMap({ silent: true, reason: refreshReason });
  }, [clearSilentRefreshTimer, fetchMap]);

  const runSilentRefreshNow = useCallback((reason = "manual", options?: { bypassMinInterval?: boolean }) => {
    pendingSilentRefreshRef.current = true;
    pendingSilentRefreshReasonRef.current = reason;
    clearSilentRefreshTimer();

    if (moveRuntimeRef.current.inFlight || moveRuntimeRef.current.queuedSteps.length > 0) {
      return;
    }

    const elapsedMs = Date.now() - lastSilentRefreshAtRef.current;
    if (!options?.bypassMinInterval && elapsedMs < SILENT_MAP_REFRESH_MIN_INTERVAL_MS) {
      silentRefreshTimerRef.current = window.setTimeout(() => {
        silentRefreshTimerRef.current = null;
        flushPendingSilentRefresh();
      }, Math.max(
        SILENT_MAP_REFRESH_DEBOUNCE_MS,
        SILENT_MAP_REFRESH_MIN_INTERVAL_MS - elapsedMs,
      ));
      return;
    }

    pendingSilentRefreshRef.current = false;
    pendingSilentRefreshReasonRef.current = "manual";
    void fetchMap({ silent: true, reason });
  }, [clearSilentRefreshTimer, fetchMap, flushPendingSilentRefresh]);

  const requestSilentRefresh = useCallback((reason = "manual", options?: SilentRefreshOptions) => {
    if (options?.immediate) {
      runSilentRefreshNow(reason, {
        bypassMinInterval: options.bypassMinInterval,
      });
      return;
    }

    pendingSilentRefreshRef.current = true;
    pendingSilentRefreshReasonRef.current = reason;
    clearSilentRefreshTimer();
    silentRefreshTimerRef.current = window.setTimeout(() => {
      silentRefreshTimerRef.current = null;
      flushPendingSilentRefresh();
    }, SILENT_MAP_REFRESH_DEBOUNCE_MS);
  }, [clearSilentRefreshTimer, flushPendingSilentRefresh, runSilentRefreshNow]);

  const queueAckTimeoutResync = useCallback(() => {
    consecutiveAckTimeoutCountRef.current += 1;
    if (consecutiveAckTimeoutCountRef.current < 2) {
      return;
    }
    consecutiveAckTimeoutCountRef.current = 0;
    requestSilentRefresh("ack_timeout_resync");
  }, [requestSilentRefresh]);

  useEffect(() => {
    void fetchMap();
  }, [fetchMap]);

  const issueMoveRequest = useCallback(async (
    target: MapMoveTarget,
    options?: IssueMoveRequestOptions,
  ) => {
    const currentData = dataRef.current;
    if (!currentData) {
      resetMoveRuntime();
      return;
    }
    const stationaryInteraction = options?.stationaryInteraction === true;

    let keepQueuedMove = true;
    moveRuntimeRef.current.inFlight = true;
    setMoving(true);
    setSelfRenderCorrection(null);
    const sourcePosition = predictedPlayerPositionRef.current ?? {
      x: currentData.player.positionX,
      y: currentData.player.positionY,
    };
    if (!stationaryInteraction) {
      applyPlayerPositionToMapState(target, { authoritative: false });
    }

    const clientSequence = nextClientSequenceRef.current;
    nextClientSequenceRef.current += 1;
    const ackRequestId = activeAckRequestIdRef.current + 1;
    activeAckRequestIdRef.current = ackRequestId;
    clearAckTimeoutTimer();
    ackTimeoutTimerRef.current = window.setTimeout(() => {
      if (activeAckRequestIdRef.current !== ackRequestId) {
        return;
      }
      queueAckTimeoutResync();
    }, MAP_MOVE_ACK_TIMEOUT_MS);
    try {
      const json = await executeMoveRequestRef.current({
        from: sourcePosition,
        target,
        clientSequence,
        stationaryInteraction,
      });
      clearAckTimeoutTimer();
      consecutiveAckTimeoutCountRef.current = 0;

      if (json.success && json.data) {
        const moveData = json.data;
        const authoritativeTarget = moveData.authoritativePosition || {
          x: moveData.newX,
          y: moveData.newY,
        };
        const correctionDistance = calcGridDistance(target, authoritativeTarget);
        const shouldRefreshStaticData = Boolean(moveData.event);
        syncAcceptedClientSequence(moveData.acceptedClientSequence, {
          requestedClientSequence: clientSequence,
        });

        const nextSceneVersion = typeof moveData.sceneVersion === "number"
          ? moveData.sceneVersion
          : moveData.serverSceneTick;
        const hasQueuedFollowUp = moveRuntimeRef.current.queuedSteps.length > 0;
        applyPlayerPositionToMapState(authoritativeTarget, {
          tick: moveData.serverSceneTick,
          sceneVersion: nextSceneVersion,
          serverTimeMs: moveData.serverTimeMs,
          authoritative: true,
          preserveRealtimeBaseline: true,
        });
        if (!stationaryInteraction) {
          onAuthoritativeMoveRef.current?.({
            from: sourcePosition,
            target,
            authoritativePosition: authoritativeTarget,
            clientSequence,
            serverSceneTick: moveData.serverSceneTick,
          });
        }
        if (
          !stationaryInteraction
          && !hasQueuedFollowUp
          && correctionDistance > MAP_MOVE_SMALL_CORRECTION_MAX_TILES
          && correctionDistance <= MAP_MOVE_SMOOTH_CORRECTION_MAX_TILES
        ) {
          setSelfRenderCorrection({
            fromX: target.x,
            fromY: target.y,
            toX: authoritativeTarget.x,
            toY: authoritativeTarget.y,
            startedAtMs: Date.now(),
            durationMs: MAP_MOVE_SMOOTH_CORRECTION_MS,
          });
        } else {
          setSelfRenderCorrection(null);
        }

        if (moveData.message) {
          messageApiRef.current.warning(moveData.message);
        }
        if (moveData.event) {
          keepQueuedMove = false;
          moveRuntimeRef.current.queuedSteps = [];
          await onMoveEventRef.current(moveData.event);
        }
        if (shouldRefreshStaticData) {
          requestSilentRefresh("move_event");
        } else if (stationaryInteraction) {
          requestSilentRefresh("stationary_interact_sync");
        }
      } else {
        clearAckTimeoutTimer();
        consecutiveAckTimeoutCountRef.current = 0;
        syncAcceptedClientSequence(json.data?.acceptedClientSequence, {
          requestedClientSequence: clientSequence,
        });
        if (typeof json.data?.acceptedClientSequence !== "number") {
          restorePendingClientSequence(clientSequence);
        }

        if (
          typeof json.data?.serverSceneTick === "number"
          && typeof json.data?.newX === "number"
          && typeof json.data?.newY === "number"
        ) {
          const correctionDistance = calcGridDistance(target, {
            x: json.data.newX,
            y: json.data.newY,
          });
          applyPlayerPositionToMapState({
            x: json.data.newX,
            y: json.data.newY,
          }, {
            tick: json.data.serverSceneTick,
            sceneVersion: json.data.sceneVersion,
            serverTimeMs: json.data.serverTimeMs,
            authoritative: true,
            preserveRealtimeBaseline: true,
          });
          if (
            !stationaryInteraction
            && moveRuntimeRef.current.queuedSteps.length === 0
            && correctionDistance > MAP_MOVE_SMALL_CORRECTION_MAX_TILES
            && correctionDistance <= MAP_MOVE_SMOOTH_CORRECTION_MAX_TILES
          ) {
            setSelfRenderCorrection({
              fromX: target.x,
              fromY: target.y,
              toX: json.data.newX,
              toY: json.data.newY,
              startedAtMs: Date.now(),
              durationMs: MAP_MOVE_SMOOTH_CORRECTION_MS,
            });
          } else {
            setSelfRenderCorrection(null);
          }
        } else {
          setSelfRenderCorrection(null);
          revertToAuthoritativePlayerPosition();
        }

        const requiresResync = Boolean(json.data?.resyncRequired)
          || json.status === 409;
        if (json.data?.transportUnavailable) {
          restorePendingClientSequence(clientSequence);
          setSelfRenderCorrection(null);
          revertToAuthoritativePlayerPosition();
          if (Date.now() - lastResyncWarningAtRef.current > 1500) {
            lastResyncWarningAtRef.current = Date.now();
            messageApiRef.current.warning(json.error || "地图房间正在重连，移动未提交，请稍后继续移动");
          }
          return;
        }

        if (requiresResync) {
          console.warn("[map] move resync", {
            error: json.error || null,
            request: {
              fromX: sourcePosition.x,
              fromY: sourcePosition.y,
              targetX: target.x,
              targetY: target.y,
              clientSequence,
            },
            response: json.data || null,
          });
          moveRuntimeRef.current.queuedSteps = [];
          await fetchMap({ silent: true, reason: json.data?.resyncReason || "move_resync" });
          if (Date.now() - lastResyncWarningAtRef.current > 1500) {
            lastResyncWarningAtRef.current = Date.now();
            messageApiRef.current.warning(json.error ? `${json.error}，地图状态已重新同步，请继续移动` : "地图状态已重新同步，请继续移动");
          }
          return;
        }

        messageApiRef.current.warning(json.error || (stationaryInteraction ? "交互失败" : "无法移动"));
      }
    } catch {
      clearAckTimeoutTimer();
      restorePendingClientSequence(clientSequence);
      setSelfRenderCorrection(null);
      revertToAuthoritativePlayerPosition();
      messageApiRef.current.error(stationaryInteraction ? "交互失败" : "移动失败");
    } finally {
      moveRuntimeRef.current.inFlight = false;
      const queuedTarget = moveRuntimeRef.current.queuedSteps[0] || null;
      moveRuntimeRef.current.queuedSteps = moveRuntimeRef.current.queuedSteps.slice(1);

      if (!keepQueuedMove || !queuedTarget) {
        resetMoveRuntime(authoritativePlayerPositionRef.current);
        flushPendingSilentRefresh();
        return;
      }

      const authoritativePosition = authoritativePlayerPositionRef.current;
      if (
        authoritativePosition
        && queuedTarget.x === authoritativePosition.x
        && queuedTarget.y === authoritativePosition.y
      ) {
        resetMoveRuntime(authoritativePosition);
        flushPendingSilentRefresh();
        return;
      }

      void issueMoveRequest(queuedTarget);
    }
  }, [
    applyPlayerPositionToMapState,
    fetchMap,
    clearAckTimeoutTimer,
    flushPendingSilentRefresh,
    resetMoveRuntime,
    restorePendingClientSequence,
    requestSilentRefresh,
    revertToAuthoritativePlayerPosition,
    setMoving,
    syncAcceptedClientSequence,
    queueAckTimeoutResync,
  ]);

  const handleMove = useCallback((x: number, y: number) => {
    const currentData = dataRef.current;
    if (!currentData) {
      return;
    }

    const activeParty = partySnapshotRef.current?.party;
    if (activeParty && activeParty.leaderPlayerId !== currentData.player.id) {
      messageApiRef.current.warning("组队状态下仅队长可移动，队员会自动跟随队长");
      return;
    }

    const currentPosition = predictedPlayerPositionRef.current ?? {
      x: currentData.player.positionX,
      y: currentData.player.positionY,
    };
    if (currentPosition.x === x && currentPosition.y === y) {
      return;
    }

    const nextSteps = resolveMovePathRef.current
      ? resolveMovePathRef.current(currentData, currentPosition, { x, y })
      : [{ x, y }];
    if (!nextSteps.length) {
      messageApiRef.current.warning("无法前往该位置");
      return;
    }

    if (moveRuntimeRef.current.inFlight) {
      moveRuntimeRef.current.queuedSteps = nextSteps;
      setSelfRenderCorrection(null);
      setMoving(true);
      return;
    }

    moveRuntimeRef.current.queuedSteps = nextSteps.slice(1);
    void issueMoveRequest(nextSteps[0]);
  }, [issueMoveRequest, setMoving]);

  const handleStationaryInteract = useCallback((x: number, y: number) => {
    const currentData = dataRef.current;
    if (!currentData) {
      return;
    }

    const currentPosition = predictedPlayerPositionRef.current ?? {
      x: currentData.player.positionX,
      y: currentData.player.positionY,
    };
    if (currentPosition.x !== x || currentPosition.y !== y) {
      return;
    }
    if (moveRuntimeRef.current.inFlight) {
      return;
    }

    moveRuntimeRef.current.queuedSteps = [];
    void issueMoveRequest({ x, y }, { stationaryInteraction: true });
  }, [issueMoveRequest]);

  const getPlannedPlayerPosition = useCallback(() => {
    const queuedSteps = moveRuntimeRef.current.queuedSteps;
    const queuedTail = queuedSteps.length > 0 ? queuedSteps[queuedSteps.length - 1] : null;
    if (queuedTail) {
      return queuedTail;
    }

    return predictedPlayerPositionRef.current ?? (
      dataRef.current
        ? {
          x: dataRef.current.player.positionX,
          y: dataRef.current.player.positionY,
        }
        : null
    );
  }, []);

  return {
    dataRef,
    partySnapshotRef,
    predictedPlayerPositionRef,
    getPlannedPlayerPosition,
    handleMove,
    fetchMap,
    lastAcceptedClientSequence,
    nextClientSequenceRef,
    previousSceneSnapshot,
    selfRenderCorrection,
    handleStationaryInteract,
  };
}
