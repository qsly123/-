import type { Client } from "colyseus";
import {
  createRealtimeInputAck,
  WORLD_MAP_HARD_MAX_CLIENTS_PER_ROOM,
  type MapInteractPayload,
  type MapTravelPayload,
  type JoinRoomOptions,
  type RealtimeClientInput,
} from "@immortality/shared-protocol";
import type { GameRoomAuthContext } from "../auth";
import {
  loadWorldMapRoomData,
  persistWorldMapPlayerMove,
  type WorldMapEntityRecord,
} from "../world-map-data";
import { GameEntityState } from "../state";
import {
  createWorldMapAoiState,
  createWorldMapSectorDelta,
  createWorldMapSectorSnapshot,
  type WorldMapAoiState,
} from "../world-map-aoi";
import { BaseGameRoom } from "./base-room";
import {
  adjustOnlineConnections,
  incrementGameServerMetric,
  incrementGameServerRoomMetric,
  isReconnectCandidateCloseCode,
  recordGameServerRoomPersistFailure,
  recordGameServerRoomJoin,
  recordGameServerRoomLeave,
  recordGameServerRoomReconnectFailure,
  recordGameServerRoomReconnectLeave,
  recordGameServerRoomReconnectSuccess,
  recordRealtimeRejected,
} from "../metrics";
import { executeMapInteractTransaction, executeMapTravelTransaction } from "../world-map-transactions";
import {
  flushRepairRefreshForClient,
  recordPlayerRefreshDigest,
  seedRepairRefreshDigestForJoin,
} from "../repair-refresh-bridge";
import { unregisterStateRefreshTarget } from "../state-refresh-registry";

const WORLD_MAP_RECONNECT_GRACE_SECONDS = 10;
const WORLD_MAP_ENTITY_REFRESH_INTERVAL_MS = 5000;

export class WorldMapRoom extends BaseGameRoom {
  readonly roomKind = "world_map";
  maxClients = WORLD_MAP_HARD_MAX_CLIENTS_PER_ROOM;
  private readonly clientAoiStates = new Map<string, WorldMapAoiState>();
  private readonly clientPrivateEntities = new Map<string, GameEntityState[]>();
  private readonly staticEntityIds = new Set<string>();
  private refreshingEntities = false;

  async onCreate(options: JoinRoomOptions) {
    super.onCreate(options);
    try {
      await this.hydrateRoomMap({
        mapId: String(options.mapId || "default"),
      });
    } catch (error) {
      console.error("[game-server] WorldMapRoom startup failed", {
        logCategory: "game-server.room.startup_failed",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: String(options.mapId || "default"),
        shardId: this.state.shardId,
        reason: "map_load_failed",
        error,
      });
      throw error;
    }
    this.clock.setInterval(() => {
      void this.refreshRoomEntities();
    }, WORLD_MAP_ENTITY_REFRESH_INTERVAL_MS);
  }

  async onJoin(client: Client, options: JoinRoomOptions, auth?: GameRoomAuthContext) {
    super.onJoin(client, options, auth);
    // 进房先挂基线摘要，等 repair 补齐时统一下发，避免"连上了但数值是旧的"。
    seedRepairRefreshDigestForJoin(auth?.playerId || String(options.playerId || client.sessionId));
    try {
      await this.hydrateJoinedPlayer(client, auth);
    } catch (error) {
      console.error("[game-server] WorldMapRoom player hydrate failed", {
        logCategory: "game-server.room.map_load_failed",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: this.state.mapId,
        shardId: this.state.shardId,
        playerId: auth?.playerId || null,
        reason: "player_hydrate_failed",
        error,
      });
    }
    setTimeout(() => {
      if (!this.clients.includes(client) || !this.state.entities.has(client.sessionId)) {
        return;
      }
      this.sendSectorSnapshot(client);
      this.syncAllClientAoi(client.sessionId);
    }, 0);
  }

  async onLeave(client: Client, code?: number) {
    incrementGameServerMetric("leaves");
    adjustOnlineConnections(-1);
    recordGameServerRoomLeave(this.roomId);
    // iOS 锁屏 / 断网被掐断时不会走 leave 报文，这里必须显式摘掉投递目标，
    // 否则服务端会一直把刷新帧投给一条死连接 —— 假在线的根源之一。
    unregisterStateRefreshTarget(this.roomId, client.sessionId);
    const entity = this.state.entities.get(client.sessionId);
    const shouldAllowReconnect = Boolean(entity) && isReconnectCandidateCloseCode(code);

    if (!shouldAllowReconnect) {
      this.clientAoiStates.delete(client.sessionId);
      this.clientPrivateEntities.delete(client.sessionId);
      this.state.entities.delete(client.sessionId);
      this.state.snapshotVersion += 1;
      this.updateRoomEntityCount();
      this.syncAllClientAoi();
      return;
    }

    incrementGameServerMetric("reconnectLeaves");
    recordGameServerRoomReconnectLeave(this.roomId);
    try {
      const reconnectedClient = await this.waitForClientReconnection(client, WORLD_MAP_RECONNECT_GRACE_SECONDS);
      incrementGameServerMetric("reconnectSuccesses");
      recordGameServerRoomReconnectSuccess(this.roomId);
      adjustOnlineConnections(1);
      recordGameServerRoomJoin(this.roomId);
      this.sendSectorSnapshot(reconnectedClient);
      this.syncAllClientAoi(reconnectedClient.sessionId);
    } catch {
      incrementGameServerMetric("reconnectFailures");
      recordGameServerRoomReconnectFailure(this.roomId);
      this.clientAoiStates.delete(client.sessionId);
      this.clientPrivateEntities.delete(client.sessionId);
      this.state.entities.delete(client.sessionId);
      this.state.snapshotVersion += 1;
      this.updateRoomEntityCount();
      this.syncAllClientAoi();
    }
  }

  private async hydrateRoomMap(params: {
    mapId: string;
    playerId?: string | null;
  }) {
    const data = await loadWorldMapRoomData({
      mapId: params.mapId,
      playerId: params.playerId,
    }).catch((error) => {
      console.error("[game-server] WorldMapRoom map load failed", {
        logCategory: "game-server.room.map_load_failed",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: params.mapId,
        shardId: this.state.shardId,
        playerId: params.playerId || null,
        reason: "map_load_failed",
        error,
      });
      throw error;
    });

    this.applyMapRuntimeState({
      mapId: data.map.id,
      mapName: data.map.name,
      mapRuntimeSource: data.map.runtimeSource,
      mapWidth: data.map.width,
      mapHeight: data.map.height,
      blockedTiles: data.map.blockedTiles,
    });

    if (data.degraded) {
      console.warn("[game-server] WorldMapRoom map data degraded", {
        logCategory: "game-server.room.map_load_degraded",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: params.mapId,
        shardId: this.state.shardId,
        reason: data.degradeReason,
      });
    }
    if (data.entitiesDegraded) {
      console.warn("[game-server] WorldMapRoom entity data degraded", {
        logCategory: "game-server.room.map_entity_load_degraded",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: data.map.id,
        shardId: this.state.shardId,
        reason: data.entitiesDegradeReason,
      });
    }

    this.applyStaticMapEntities(data.entities);

    return data;
  }

  private applyStaticMapEntities(records: WorldMapEntityRecord[]) {
    const previousStaticEntities = new Map<string, GameEntityState>();
    for (const entityId of this.staticEntityIds) {
      const previousEntity = this.state.entities.get(entityId);
      if (previousEntity) {
        previousStaticEntities.set(entityId, previousEntity);
      }
    }
    for (const entityId of this.staticEntityIds) {
      this.state.entities.delete(entityId);
    }
    this.staticEntityIds.clear();

    for (const record of records) {
      const entity = this.createEntityFromRecord(record, previousStaticEntities.get(record.id) || null);
      this.state.entities.set(record.id, entity);
      this.staticEntityIds.add(record.id);
    }

    if (records.length > 0 || previousStaticEntities.size > 0) {
      this.state.snapshotVersion += 1;
    }
    this.updateRoomEntityCount();
  }

  private createEntityFromRecord(record: WorldMapEntityRecord, previous?: GameEntityState | null) {
    const entity = new GameEntityState();
    entity.id = record.id;
    entity.kind = record.kind;
    entity.name = record.name;
    entity.x = record.positionX;
    entity.y = record.positionY;
    const unchanged = previous
      && previous.kind === entity.kind
      && previous.name === entity.name
      && previous.x === entity.x
      && previous.y === entity.y;
    entity.velocityX = previous && previous.kind === entity.kind && !unchanged
      ? entity.x - previous.x
      : 0;
    entity.velocityY = previous && previous.kind === entity.kind && !unchanged
      ? entity.y - previous.y
      : 0;
    entity.updatedAt = unchanged ? previous.updatedAt : Date.now();
    return entity;
  }

  private createPrivateEntitiesForClient(client: Client, records: WorldMapEntityRecord[]) {
    const previousEntities = new Map(
      (this.clientPrivateEntities.get(client.sessionId) || []).map((entity) => [entity.id, entity] as const),
    );
    return records.map((record) => this.createEntityFromRecord(record, previousEntities.get(record.id) || null));
  }

  private async hydrateJoinedPlayer(client: Client, auth?: GameRoomAuthContext) {
    const playerId = auth?.playerId;
    if (!playerId) {
      return;
    }

    const data = await this.hydrateRoomMap({
      mapId: this.state.mapId,
      playerId,
    });
    const entity = this.state.entities.get(client.sessionId);
    if (!entity || !data.player) {
      return;
    }

    this.clientPrivateEntities.set(
      client.sessionId,
      this.createPrivateEntitiesForClient(client, data.privateEntities),
    );
    entity.id = data.player.id;
    entity.name = data.player.name;
    entity.x = data.player.positionX;
    entity.y = data.player.positionY;
    entity.velocityX = 0;
    entity.velocityY = 0;
    entity.updatedAt = Date.now();
    this.state.snapshotVersion += 1;
    this.updateRoomEntityCount();
  }

  private async refreshRoomEntities() {
    if (this.refreshingEntities || this.state.mapRuntimeSource === "fallback") {
      return;
    }

    this.refreshingEntities = true;
    try {
      await this.hydrateRoomMap({
        mapId: this.state.mapId,
      });

      for (const client of this.clients) {
        const entity = this.getClientEntity(client);
        if (!entity?.id) {
          continue;
        }
        const data = await loadWorldMapRoomData({
          mapId: this.state.mapId,
          playerId: entity.id,
        });
        this.clientPrivateEntities.set(
          client.sessionId,
          this.createPrivateEntitiesForClient(client, data.privateEntities),
        );
      }

      this.syncAllClientAoi();
    } finally {
      this.refreshingEntities = false;
    }
  }

  protected afterMoveInput(
    client: Client,
    result: {
      input: RealtimeClientInput;
      accepted: boolean;
    },
  ) {
    if (!result.accepted) {
      return;
    }
    this.syncAllClientAoi(undefined, result.input.clientSequence);
    this.sendSectorDelta(client, result.input.clientSequence);
  }

  protected beforeMoveAck(
    client: Client,
    result: {
      input: RealtimeClientInput;
      previousPosition: { x: number; y: number };
      nextPosition: { x: number; y: number };
    },
  ) {
    void result.previousPosition;
    const entity = this.getClientEntity(client);
    const playerId = String(entity?.id || "").trim();
    if (!playerId || this.state.mapRuntimeSource === "fallback") {
      return;
    }
    if (!process.env.DATABASE_URL) {
      return;
    }

    return persistWorldMapPlayerMove({
      playerId,
      mapId: this.state.mapId,
      x: result.nextPosition.x,
      y: result.nextPosition.y,
    }).then(() => undefined);
  }

  private getClientEntity(client: Client) {
    return this.state.entities.get(client.sessionId) || null;
  }

  private findEntityByPublicId(entityId: string, client?: Client) {
    const direct = this.state.entities.get(entityId);
    if (direct) {
      return direct;
    }
    if (client) {
      const privateDirect = (this.clientPrivateEntities.get(client.sessionId) || [])
        .find((entity) => entity.id === entityId);
      if (privateDirect) {
        return privateDirect;
      }
    }
    for (const entity of this.state.entities.values()) {
      if (entity.id === entityId) {
        return entity;
      }
    }
    if (client) {
      for (const entity of this.clientPrivateEntities.get(client.sessionId) || []) {
        if (entity.id === entityId) {
          return entity;
        }
      }
    }
    return null;
  }

  protected handleRepairInput(client: Client, input: RealtimeClientInput) {
    const entity = this.getClientEntity(client);
    if (!entity) {
      recordRealtimeRejected("entity_missing", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
      }));
      return;
    }

    client.send("ack", createRealtimeInputAck({
      accepted: true,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      serverTick: this.state.serverTick,
      authoritativeState: {
        x: entity.x,
        y: entity.y,
      },
    }));
    this.sendSectorSnapshot(client, input.clientSequence);
    // 前后台恢复 / 重连 / 弱网 repair 补齐后必须补发资产 / 背包 / 进度刷新帧，
    // 只回 ACK 会让客户端停在旧值并显示"假在线"。
    flushRepairRefreshForClient({
      client,
      input,
      playerId: entity.id,
      roomId: this.roomId,
      serverTick: this.state.serverTick,
    });
  }

  protected handleInteractInput(client: Client, input: RealtimeClientInput) {
    void this.handleInteractInputAsync(client, input as RealtimeClientInput<MapInteractPayload, "interact">);
  }

  private async handleInteractInputAsync(client: Client, input: RealtimeClientInput<MapInteractPayload, "interact">) {
    const self = this.getClientEntity(client);
    if (!self) {
      recordRealtimeRejected("entity_missing", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
      }));
      return;
    }

    const payload = input.payload;
    const entityId = typeof payload?.entityId === "string" ? payload.entityId.trim() : "";
    if (!entityId) {
      recordRealtimeRejected("invalid_payload", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: self.x,
          y: self.y,
        },
      }));
      return;
    }

    const target = this.findEntityByPublicId(entityId, client);
    if (!target) {
      recordRealtimeRejected("target_missing", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "target_missing",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: self.x,
          y: self.y,
        },
      }));
      return;
    }

    const distance = Math.max(Math.abs(target.x - self.x), Math.abs(target.y - self.y));
    if (distance > 1) {
      recordRealtimeRejected("too_far", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "too_far",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: self.x,
          y: self.y,
          targetId: target.id,
          targetKind: target.kind,
          targetX: target.x,
          targetY: target.y,
        },
      }));
      return;
    }

    try {
      const result = await executeMapInteractTransaction({
        roomId: this.roomId,
        mapId: this.state.mapId,
        playerId: self.id,
        input,
        actor: self,
        target,
      });
      client.send("ack", createRealtimeInputAck({
        accepted: result.accepted,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: result.reason,
        serverTick: this.state.serverTick,
        authoritativeState: result.authoritativeState,
      }));
      if (!result.accepted) {
        recordRealtimeRejected(result.reason, this.roomId);
      }
      if (result.accepted) {
        await this.refreshRoomEntities();
        // 交互事务可能发放物品 / 货币 / 任务进度，挂摘要等待下一次 repair 补齐下发。
        recordPlayerRefreshDigest({
          playerId: self.id,
          inventory: {},
          asset: {},
          progress: { scopes: ["quest", "cultivation"] },
        });
      }
    } catch (error) {
      recordGameServerRoomPersistFailure(this.roomId, "map_interact_transaction_failed");
      recordRealtimeRejected("persist_failed", this.roomId);
      console.error("[game-server] map interact transaction failed", {
        logCategory: "game-server.room.db_persist_failed",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: this.state.mapId,
        shardId: this.state.shardId,
        playerId: self.id,
        actionId: input.actionId,
        inputType: input.inputType,
        reason: "map_interact_transaction_failed",
        error,
      });
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "persist_failed",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: self.x,
          y: self.y,
        },
      }));
    }
  }

  protected handleTravelInput(client: Client, input: RealtimeClientInput) {
    void this.handleTravelInputAsync(client, input as RealtimeClientInput<MapTravelPayload, "travel">);
  }

  private async handleTravelInputAsync(client: Client, input: RealtimeClientInput<MapTravelPayload, "travel">) {
    const self = this.getClientEntity(client);
    if (!self) {
      recordRealtimeRejected("entity_missing", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
      }));
      return;
    }

    const targetMapId = typeof input.payload?.targetMapId === "string" ? input.payload.targetMapId.trim() : "";
    if (!targetMapId) {
      recordRealtimeRejected("invalid_payload", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: self.x,
          y: self.y,
        },
      }));
      return;
    }

    try {
      const result = await executeMapTravelTransaction({
        roomId: this.roomId,
        mapId: this.state.mapId,
        playerId: self.id,
        input,
        actor: self,
      });
      client.send("ack", createRealtimeInputAck({
        accepted: result.accepted,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: result.reason,
        serverTick: this.state.serverTick,
        authoritativeState: result.authoritativeState || {
          x: self.x,
          y: self.y,
          targetMapId,
        },
      }));
      if (!result.accepted) {
        recordRealtimeRejected(result.reason, this.roomId);
      }
      if (result.accepted) {
        recordPlayerRefreshDigest({
          playerId: self.id,
          inventory: {},
          asset: {},
          progress: { scopes: ["quest", "cultivation"] },
        });
      }
      if (result.accepted && result.removeActorFromRoom) {
        this.clientAoiStates.delete(client.sessionId);
        this.clientPrivateEntities.delete(client.sessionId);
        this.state.entities.delete(client.sessionId);
        this.state.snapshotVersion += 1;
        this.updateRoomEntityCount();
        this.syncAllClientAoi(client.sessionId);
      }
    } catch (error) {
      recordGameServerRoomPersistFailure(this.roomId, "map_travel_transaction_failed");
      recordRealtimeRejected("persist_failed", this.roomId);
      console.error("[game-server] map travel transaction failed", {
        logCategory: "game-server.room.db_persist_failed",
        roomId: this.roomId,
        roomKind: this.roomKind,
        mapId: this.state.mapId,
        shardId: this.state.shardId,
        playerId: self.id,
        actionId: input.actionId,
        inputType: input.inputType,
        targetMapId,
        reason: "map_travel_transaction_failed",
        error,
      });
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "persist_failed",
        serverTick: this.state.serverTick,
        authoritativeState: {
          x: self.x,
          y: self.y,
          targetMapId,
        },
      }));
    }
  }

  private createClientAoiState(client: Client) {
    const entity = this.getClientEntity(client);
    if (!entity) {
      return null;
    }
    return createWorldMapAoiState({
      self: entity,
      entities: this.state.entities.values(),
      privateEntities: this.clientPrivateEntities.get(client.sessionId) || [],
    });
  }

  private sendSectorSnapshot(client: Client, acceptedSequence?: number | null) {
    const entity = this.getClientEntity(client);
    if (!entity) {
      return;
    }

    const nextAoi = this.createClientAoiState(client);
    if (!nextAoi) {
      return;
    }
    this.clientAoiStates.set(client.sessionId, nextAoi);
    incrementGameServerMetric("sectorSnapshotsSent");
    incrementGameServerRoomMetric(this.roomId, "sectorSnapshotsSent");
    client.send("sector_snapshot", createWorldMapSectorSnapshot({
      roomId: this.roomId,
      roomState: this.state,
      self: entity,
      privateEntities: this.clientPrivateEntities.get(client.sessionId) || [],
      acceptedSequence,
    }));
  }

  private sendSectorDelta(client: Client, acceptedSequence?: number | null) {
    const nextAoi = this.createClientAoiState(client);
    if (!nextAoi) {
      return;
    }
    const previousAoi = this.clientAoiStates.get(client.sessionId) || null;
    const envelope = createWorldMapSectorDelta({
      roomId: this.roomId,
      roomState: this.state,
      previousAoi,
      nextAoi,
      privateEntities: this.clientPrivateEntities.get(client.sessionId) || [],
      acceptedSequence,
    });
    this.clientAoiStates.set(client.sessionId, nextAoi);
    if (envelope) {
      incrementGameServerMetric("sectorDeltasSent");
      incrementGameServerRoomMetric(this.roomId, "sectorDeltasSent");
      client.send("sector_delta", envelope);
    }
  }

  private syncAllClientAoi(skipSessionId?: string, acceptedSequence?: number | null) {
    for (const client of this.clients) {
      if (client.sessionId === skipSessionId) {
        continue;
      }
      this.sendSectorDelta(client, acceptedSequence);
    }
  }
}
