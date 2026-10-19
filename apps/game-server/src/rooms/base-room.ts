import { Client, Room, type AuthContext } from "colyseus";
import { decideGridMovement } from "@immortality/game-rules";
import {
  createRealtimeInputAck,
  normalizeWorldMapShardId,
  validateRealtimeClientInput,
  type JoinRoomOptions,
  type RealtimeClientInput,
  type RealtimeInputRejectReason,
} from "@immortality/shared-protocol";
import { authenticateGameRoomJoin, type GameRoomAuthContext } from "../auth";
import { GameEntityState, GameRoomState } from "../state";
import { registerStateRefreshTarget } from "../state-refresh-registry";
import {
  adjustOnlineConnections,
  disposeGameServerRoom,
  incrementGameServerRoomMetric,
  incrementGameServerMetric,
  isReconnectCandidateCloseCode,
  recordGameServerRoomMoveRejected,
  recordGameServerRoomPersistFailure,
  recordGameServerRoomReconnectLeave,
  recordRealtimeRejected,
  recordGameServerRoomJoin,
  recordGameServerRoomLeave,
  registerGameServerRoom,
  recordMoveRejected,
  recordSimulationTickDuration,
  updateGameServerRoomMetadata,
} from "../metrics";

export abstract class BaseGameRoom extends Room {
  declare state: GameRoomState;

  abstract readonly roomKind: string;
  protected blockedTiles = new Set<string>();
  private reconnectAutoDisposeHoldCount = 0;
  private reconnectPreviousAutoDispose = true;
  private stateRefreshUnregisters = new Map<string, () => void>();

  onCreate(options: JoinRoomOptions) {
    incrementGameServerMetric("roomsCreated");
    const mapId = String(options.mapId || "default");
    const shardId = normalizeWorldMapShardId(options.shardId);
    registerGameServerRoom({
      roomId: this.roomId,
      roomKind: this.roomKind,
      mapId,
      shardId,
      combatId: options.combatId,
      partyId: options.partyId,
    });
    this.setState(new GameRoomState());
    this.state.roomKind = this.roomKind;
    this.state.mapId = mapId;
    this.state.shardId = shardId;

    this.setSimulationInterval(() => {
      const startedAt = performance.now();
      this.state.serverTick += 1;
      recordSimulationTickDuration(performance.now() - startedAt, this.roomId);
    }, 1000 / 20);

    this.onMessage("input", (client, input: unknown) => {
      incrementGameServerMetric("inputMessages");
      incrementGameServerRoomMetric(this.roomId, "inputMessages");
      this.handleRealtimeInput(client, input);
    });
  }

  onDispose() {
    disposeGameServerRoom(this.roomId);
  }

  async onAuth(client: Client, options: JoinRoomOptions, context: AuthContext) {
    return authenticateGameRoomJoin({
      options,
      context,
      fallbackPlayerId: client.sessionId,
    });
  }

  onJoin(client: Client, options: JoinRoomOptions, auth?: GameRoomAuthContext) {
    incrementGameServerMetric("joins");
    adjustOnlineConnections(1);
    recordGameServerRoomJoin(this.roomId);
    const joinOptions = auth?.joinOptions || {
      mapId: String(options.mapId || "default"),
      shardId: normalizeWorldMapShardId(options.shardId),
    };
    this.state.mapId = joinOptions.mapId;
    this.state.shardId = normalizeWorldMapShardId(joinOptions.shardId);
    updateGameServerRoomMetadata(this.roomId, {
      mapId: this.state.mapId,
      shardId: this.state.shardId,
      combatId: options.combatId || null,
      partyId: options.partyId || null,
    });

    const entity = new GameEntityState();
    entity.id = auth?.playerId || String(options.playerId || client.sessionId);
    entity.kind = "player";
    entity.name = auth?.playerName || entity.id;
    entity.updatedAt = Date.now();
    this.state.entities.set(client.sessionId, entity);
    this.state.snapshotVersion += 1;
    this.updateRoomEntityCount();
    this.stateRefreshUnregisters.set(
      client.sessionId,
      registerStateRefreshTarget({
        playerId: entity.id,
        roomId: this.roomId,
        roomKind: this.roomKind,
        sessionId: client.sessionId,
        send: (type, message) => client.send(type, message),
      }),
    );
  }

  onLeave(client: Client, code?: number) {
    incrementGameServerMetric("leaves");
    adjustOnlineConnections(-1);
    recordGameServerRoomLeave(this.roomId);
    const unregister = this.stateRefreshUnregisters.get(client.sessionId);
    if (unregister) {
      unregister();
      this.stateRefreshUnregisters.delete(client.sessionId);
    }
    if (isReconnectCandidateCloseCode(code)) {
      incrementGameServerMetric("reconnectLeaves");
      recordGameServerRoomReconnectLeave(this.roomId);
    }
    this.state.entities.delete(client.sessionId);
    this.state.snapshotVersion += 1;
    this.updateRoomEntityCount();
  }

  protected updateRoomEntityCount() {
    updateGameServerRoomMetadata(this.roomId, {
      entityCount: this.state?.entities?.size || 0,
    });
  }

  protected async waitForClientReconnection(client: Client, seconds: number) {
    if (this.reconnectAutoDisposeHoldCount === 0) {
      this.reconnectPreviousAutoDispose = this.autoDispose;
      this.autoDispose = false;
    }
    this.reconnectAutoDisposeHoldCount += 1;

    try {
      return await this.allowReconnection(client, seconds);
    } finally {
      this.reconnectAutoDisposeHoldCount = Math.max(0, this.reconnectAutoDisposeHoldCount - 1);
      if (this.reconnectAutoDisposeHoldCount === 0) {
        this.autoDispose = this.reconnectPreviousAutoDispose;
      }
    }
  }

  protected handleRealtimeInput(client: Client, input: unknown) {
    const validation = validateRealtimeClientInput(input);
    if (!validation.ok) {
      recordRealtimeRejected(validation.ack.reason, this.roomId);
      client.send("ack", {
        ...validation.ack,
        serverTick: this.state.serverTick,
      });
      return;
    }

    const realtimeInput = validation.input;
    if (realtimeInput.inputType === "move") {
      void this.handleMoveInput(client, realtimeInput);
      return;
    }
    if (realtimeInput.inputType === "repair") {
      incrementGameServerMetric("repairInputs");
      incrementGameServerRoomMetric(this.roomId, "repairInputs");
      this.handleRepairInput(client, realtimeInput);
      return;
    }
    if (realtimeInput.inputType === "interact") {
      incrementGameServerMetric("interactInputs");
      incrementGameServerRoomMetric(this.roomId, "interactInputs");
      this.handleInteractInput(client, realtimeInput);
      return;
    }
    if (realtimeInput.inputType === "travel") {
      incrementGameServerMetric("travelInputs");
      incrementGameServerRoomMetric(this.roomId, "travelInputs");
      this.handleTravelInput(client, realtimeInput);
      return;
    }

    this.handleUnsupportedRealtimeInput(client, realtimeInput);
  }

  protected applyMapRuntimeState(params: {
    mapId: string;
    mapName: string;
    mapRuntimeSource: string;
    mapWidth: number;
    mapHeight: number;
    blockedTiles?: ReadonlySet<string>;
  }) {
    this.state.mapId = params.mapId;
    this.state.mapName = params.mapName;
    this.state.mapRuntimeSource = params.mapRuntimeSource;
    this.state.mapWidth = params.mapWidth;
    this.state.mapHeight = params.mapHeight;
    this.blockedTiles = new Set(params.blockedTiles || []);
    this.state.snapshotVersion += 1;
    updateGameServerRoomMetadata(this.roomId, {
      mapId: this.state.mapId,
      mapName: this.state.mapName,
      mapRuntimeSource: this.state.mapRuntimeSource,
    });
  }

  private async handleMoveInput(client: Client, input: RealtimeClientInput) {
    const entity = this.state.entities.get(client.sessionId);
    if (!entity) {
      recordMoveRejected("entity_missing");
      recordGameServerRoomMoveRejected(this.roomId, "entity_missing");
      recordRealtimeRejected("entity_missing", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
      }));
      this.afterMoveInput(client, {
        input,
        accepted: false,
        reason: "entity_missing",
        previousPosition: null,
        nextPosition: null,
      });
      return;
    }

    if (!input.payload || typeof input.payload !== "object") {
      recordMoveRejected("invalid_payload");
      recordGameServerRoomMoveRejected(this.roomId, "invalid_payload");
      recordRealtimeRejected("invalid_payload", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: entity.x,
          y: entity.y,
        },
      }));
      this.afterMoveInput(client, {
        input,
        accepted: false,
        reason: "invalid_payload",
        previousPosition: { x: entity.x, y: entity.y },
        nextPosition: { x: entity.x, y: entity.y },
      });
      return;
    }

    const payload = input.payload as { x?: unknown; y?: unknown };
    const to = {
      x: Number(payload.x),
      y: Number(payload.y),
    };

    const previousPosition = { x: entity.x, y: entity.y };
    const decision = decideGridMovement({
      from: { x: entity.x, y: entity.y },
      to,
      mapWidth: this.state.mapWidth > 0 ? this.state.mapWidth : undefined,
      mapHeight: this.state.mapHeight > 0 ? this.state.mapHeight : undefined,
      blockedTiles: this.blockedTiles,
      occupiedTiles: this.collectOccupiedBlockingTiles(client.sessionId),
    });
    let accepted = decision.accepted;
    let rejectReason: RealtimeInputRejectReason | undefined = decision.reason;

    if (accepted) {
      incrementGameServerMetric("moveAccepted");
      incrementGameServerRoomMetric(this.roomId, "moveAccepted");
      entity.velocityX = decision.position.x - entity.x;
      entity.velocityY = decision.position.y - entity.y;
      entity.x = decision.position.x;
      entity.y = decision.position.y;
      entity.updatedAt = Date.now();
      this.state.snapshotVersion += 1;
      try {
        const beforeAckResult = this.beforeMoveAck(client, {
          input,
          previousPosition,
          nextPosition: { x: entity.x, y: entity.y },
        });
        if (beforeAckResult && typeof beforeAckResult.then === "function") {
          await beforeAckResult;
        }
      } catch (error) {
        recordGameServerRoomPersistFailure(this.roomId, "move_persist_failed");
        console.error("[game-server] move persist failed", {
          logCategory: "game-server.room.db_persist_failed",
          roomId: this.roomId,
          roomKind: this.roomKind,
          mapId: this.state.mapId,
          shardId: this.state.shardId,
          reason: "move_persist_failed",
          error,
        });
        entity.velocityX = 0;
        entity.velocityY = 0;
        entity.x = previousPosition.x;
        entity.y = previousPosition.y;
        entity.updatedAt = Date.now();
        this.state.snapshotVersion += 1;
        accepted = false;
        rejectReason = "persist_failed";
        recordGameServerRoomMoveRejected(this.roomId, rejectReason);
        recordRealtimeRejected(rejectReason, this.roomId);
        recordMoveRejected(rejectReason);
      }
    } else {
      recordGameServerRoomMoveRejected(this.roomId, rejectReason);
      recordRealtimeRejected(rejectReason, this.roomId);
      recordMoveRejected(rejectReason);
    }

    client.send("ack", createRealtimeInputAck({
      accepted,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: rejectReason,
      serverTick: this.state.serverTick,
      authoritativeState: {
        x: entity.x,
        y: entity.y,
      },
    }));
    this.afterMoveInput(client, {
      input,
      accepted,
      reason: rejectReason,
      previousPosition,
      nextPosition: { x: entity.x, y: entity.y },
    });
  }

  private collectOccupiedBlockingTiles(selfSessionId: string) {
    const blockingTiles = new Set<string>();
    for (const [sessionId, entity] of this.state.entities.entries()) {
      if (sessionId === selfSessionId) {
        continue;
      }
      if (entity.kind !== "npc" && entity.kind !== "monster") {
        continue;
      }
      if (!Number.isInteger(entity.x) || !Number.isInteger(entity.y)) {
        continue;
      }
      blockingTiles.add(`${entity.x}:${entity.y}`);
    }
    return blockingTiles;
  }

  protected afterMoveInput(
    client: Client,
    result: {
      input: RealtimeClientInput;
      accepted: boolean;
      reason?: RealtimeInputRejectReason;
      previousPosition: { x: number; y: number } | null;
      nextPosition: { x: number; y: number } | null;
    },
  ) {
    void client;
    void result;
    // Room-specific realtime fanout hook.
  }

  protected beforeMoveAck(
    client: Client,
    result: {
      input: RealtimeClientInput;
      previousPosition: { x: number; y: number };
      nextPosition: { x: number; y: number };
    },
  ): void | Promise<void> {
    void client;
    void result;
  }

  protected handleRepairInput(client: Client, input: RealtimeClientInput) {
    recordRealtimeRejected("unsupported_input", this.roomId);
    client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: "unsupported_input",
      serverTick: this.state.serverTick,
    }));
  }

  protected handleInteractInput(client: Client, input: RealtimeClientInput) {
    recordRealtimeRejected("unsupported_input", this.roomId);
    client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: "unsupported_input",
      serverTick: this.state.serverTick,
    }));
  }

  protected handleTravelInput(client: Client, input: RealtimeClientInput) {
    recordRealtimeRejected("unsupported_input", this.roomId);
    client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: "unsupported_input",
      serverTick: this.state.serverTick,
    }));
  }

  protected handleUnsupportedRealtimeInput(client: Client, input: RealtimeClientInput) {
    recordRealtimeRejected("unsupported_input", this.roomId);
    client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: "unsupported_input",
      serverTick: this.state.serverTick,
    }));
  }
}
