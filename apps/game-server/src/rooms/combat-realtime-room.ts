import type { Client } from "colyseus";
import {
  type BattleRuleset,
  calculateBattleDamage,
  calculateBattleDistance,
  createBattleDeathPenaltyIntent,
  createBattleDropIntent,
  createBattleRewardIntent,
  createBattleSettlementIntent,
  decideBattleMovement,
  decideCombatCommand,
  decidePvpTimeoutAdvance,
  getBattleRuleset,
  type BattleDeathPenaltyIntent,
  type BattleDropIntent,
  type BattleRewardIntent,
  type BattleSettlementIntent,
  type BattleCommandRejectReason,
  type BattleCommandType,
  type BattleMode,
} from "@immortality/game-rules";
import {
  type CombatSceneEntity,
  type CombatSceneEnvelope,
  type CombatSceneEvent,
  createRealtimeInputAck,
  type CombatCommandPayload,
  type CombatMovementPayload,
  type RealtimeClientInput,
  type RealtimeInputRejectReason,
} from "@immortality/shared-protocol";
import type { GameRoomAuthContext } from "../auth";
import { BaseGameRoom } from "./base-room";
import {
  adjustOnlineConnections,
  incrementGameServerMetric,
  isReconnectCandidateCloseCode,
  recordGameServerRoomPersistFailure,
  recordGameServerRoomJoin,
  recordGameServerRoomLeave,
  recordGameServerRoomReconnectFailure,
  recordGameServerRoomReconnectLeave,
  recordGameServerRoomReconnectSuccess,
  recordRealtimeRejected,
} from "../metrics";
import { executeCombatSettlementTransaction } from "../combat-settlement-transactions";
import {
  hydrateCombatRuntime,
  type CombatRuntimeHydrationResult,
} from "../combat-runtime-hydration";
import { GameEntityState } from "../state";
import {
  COMBAT_STATE_REFRESH_REASON,
  pushCombatInventoryRefresh,
  pushCombatRewardRefresh,
  type CombatStateRefreshPushResult,
  type CombatStateRefreshReason,
} from "../combat-state-refresh";
import {
  getPendingCombatSession,
  releasePendingCombatSessionLock,
  tryAcquirePendingCombatSessionLock,
} from "../../../../src/modules/combat/services/pending-combat-session";
import {
  buildSoloCombatRouteData,
  performSoloCombatActionTransaction,
  performSoloCombatMovementTransaction,
} from "../../../../src/modules/combat/services/solo-combat-command-transaction";
import {
  performBossLeaveCommandTransaction,
} from "../../../../src/modules/combat/services/boss-room-runtime-service";
import {
  flushRepairRefreshForClient,
  recordPlayerRefreshDigest,
  seedRepairRefreshDigestForJoin,
} from "../repair-refresh-bridge";
import { unregisterStateRefreshTarget } from "../state-refresh-registry";

const COMBAT_RECONNECT_GRACE_SECONDS = 10;
const SETTLEMENT_FLUSH_RETRY_LIMIT = 3;
const BASIC_ATTACK_SKILL_ID = "skill_basic_attack";
const SOLO_RUNTIME_CLIENT_SCENE_TICK_DRIFT_LIMIT = 240;

type PendingSettlementJob = {
  settlementIntent: BattleSettlementIntent;
  rewardIntent: BattleRewardIntent;
  dropIntent: BattleDropIntent;
  deathPenaltyIntent: BattleDeathPenaltyIntent | null;
  opponentType?: string;
  opponentId?: string | null;
  createdAtMs: number;
};

function mapBattleRejectReason(reason: BattleCommandRejectReason | undefined): RealtimeInputRejectReason | undefined {
  if (!reason) {
    return undefined;
  }
  if (reason === "unsupported") {
    return "unsupported_input";
  }
  return reason;
}

function normalizeBattleCommandType(input: RealtimeClientInput): BattleCommandType | null {
  if (input.inputType === "useItem") {
    return "item";
  }
  if (input.inputType === "surrender") {
    return "surrender";
  }
  if (input.inputType !== "command") {
    return null;
  }

  const payload = input.payload as Partial<CombatCommandPayload> | null;
  const commandType = String(payload?.commandType || "").trim();
  if (
    commandType === "basicAttack"
    || commandType === "skill"
    || commandType === "item"
    || commandType === "flee"
    || commandType === "surrender"
    || commandType === "repair"
    || commandType === "ready"
    || commandType === "timeoutAdvance"
  ) {
    return commandType;
  }
  return null;
}

function isSoloRuntimeCommandType(commandType: BattleCommandType) {
  return commandType === "basicAttack"
    || commandType === "skill"
    || commandType === "item"
    || commandType === "flee"
    || commandType === "surrender";
}

function isSoloRuntimeClientSceneTickStale(clientSceneTick: number, serverSceneTick: number) {
  return clientSceneTick > serverSceneTick
    || serverSceneTick - clientSceneTick > SOLO_RUNTIME_CLIENT_SCENE_TICK_DRIFT_LIMIT;
}

function getTargetId(input: RealtimeClientInput) {
  const payload = input.payload as Partial<CombatCommandPayload & { targetId?: string }> | null;
  return typeof payload?.targetId === "string" ? payload.targetId.trim() : "";
}

function getCommandSkillId(input: RealtimeClientInput) {
  const payload = input.payload as Partial<CombatCommandPayload & { skillId?: string }> | null;
  return typeof payload?.skillId === "string" ? payload.skillId.trim() : "";
}

function getCommandItemId(input: RealtimeClientInput) {
  const payload = input.payload as Partial<CombatCommandPayload & { itemId?: string }> | null;
  return typeof payload?.itemId === "string" ? payload.itemId.trim() : "";
}

function mapHttpStatusToRealtimeRejectReason(status: number): RealtimeInputRejectReason {
  if (status === 401 || status === 403) {
    return "permission_denied";
  }
  if (status === 409) {
    return "stale_state";
  }
  if (status >= 500) {
    return "persist_failed";
  }
  return "invalid_payload";
}

function createBossHttpCommandBody(params: {
  input: RealtimeClientInput;
  commandType: BattleCommandType;
  partyId?: string;
}) {
  const body: Record<string, unknown> = {
    clientSequence: params.input.clientSequence,
    clientSceneTick: params.input.clientSceneTick,
    actionId: params.input.actionId,
    clientSentAt: params.input.clientSentAt,
  };
  if (params.partyId) {
    body.partyCombatId = params.partyId;
  }

  if (params.commandType === "ready" || params.commandType === "timeoutAdvance") {
    body.advance = true;
    return body;
  }

  if (params.commandType === "item") {
    body.action = "item";
    body.itemId = getCommandItemId(params.input);
    return body;
  }

  body.action = "skill";
  const skillId = getCommandSkillId(params.input);
  if (skillId && params.commandType !== "basicAttack") {
    body.skillId = skillId;
  }
  return body;
}

function createBossBridgeCookieHeader(auth: GameRoomAuthContext) {
  const cookies: string[] = [];
  const sessionToken = String(auth.joinOptions.sessionToken || "").trim();
  if (sessionToken) {
    cookies.push(`immortality_session=${encodeURIComponent(sessionToken)}`);
  }
  if (auth.playerId) {
    cookies.push(`immortality_active_player=${encodeURIComponent(auth.playerId)}`);
  }
  return cookies.join("; ");
}

async function performBossCoreServiceCommand(params: {
  monsterId: string;
  cookieHeader: string;
  body: Record<string, unknown>;
}) {
  const { POST: bossActionPost } = await import("../../../../src/modules/combat/services/boss-command-route-service");
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (params.cookieHeader) {
    headers.set("Cookie", params.cookieHeader);
  }
  return bossActionPost(new Request(`http://game-server.local/api/game/boss/${encodeURIComponent(params.monsterId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params.body),
  }), {
    params: Promise.resolve({ id: params.monsterId }),
  });
}

async function readJsonResponse(response: Response) {
  try {
    return await response.json() as {
      success?: boolean;
      error?: string;
      data?: Record<string, unknown> | null;
    };
  } catch {
    return {
      success: false,
      error: await response.text().catch(() => "") || `HTTP ${response.status}`,
    };
  }
}

function mapSoloRuntimeErrorToRejectReason(error: string): RealtimeInputRejectReason {
  if (error.includes("冷却")) {
    return "on_cooldown";
  }
  if (error.includes("缺少") || error.includes("不存在") || error.includes("不可用") || error.includes("不足")) {
    return "invalid_payload";
  }
  if (error.includes("已结束")) {
    return "settlement_pending";
  }
  return "stale_state";
}

function getActorPublicId(client: Client, room: CombatRealtimeRoom) {
  const entity = room.state.entities.get(client.sessionId);
  return entity?.id || "";
}

function getRoomBattleId(room: CombatRealtimeRoom) {
  return room.roomId || `${room.roomKind}:${room.state.mapId || room.state.shardId || "local"}`;
}

function toCombatSceneEntity(entity: {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  updatedAt: number;
}): CombatSceneEntity {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    x: entity.x,
    y: entity.y,
    velocityX: entity.velocityX,
    velocityY: entity.velocityY,
    updatedAt: entity.updatedAt,
  };
}

export abstract class CombatRealtimeRoom extends BaseGameRoom {
  protected battleMode: BattleMode = "solo";
  private lastInputAtMs = Date.now();
  private readonly reconnectingSessionIds = new Set<string>();
  private readonly authBySessionId = new Map<string, GameRoomAuthContext>();
  private readonly runtimeBySessionId = new Map<string, CombatRuntimeHydrationResult>();
  private readonly hydratedEntityKeys = new Set<string>();
  private readonly pendingSettlementJobs = new Map<string, PendingSettlementJob>();
  private lastRuntimeBroadcastFingerprint = "";
  private combatId: string | undefined;
  private partyId: string | undefined;

  private getObservedRoomId() {
    return this.roomId || "unassigned";
  }

  /**
   * 丹药 command 落账后必须下发 inventory_refresh(10302)。
   * 只在"command 被接受"时下发：被拒绝的 command 没有发生库存扣减，
   * 不能让客户端产生本地乐观扣减后的错误回填。
   */
  protected pushCombatItemConsumedRefresh(params: {
    playerId: string;
    commandType: BattleCommandType;
    itemId: string;
    accepted: boolean;
  }): CombatStateRefreshPushResult | null {
    if (!params.accepted || params.commandType !== "item") {
      return null;
    }
    if (!String(params.playerId || "").trim() || !String(params.itemId || "").trim()) {
      return null;
    }

    const result = pushCombatInventoryRefresh({
      playerId: params.playerId,
      itemIds: [params.itemId],
      roomId: this.getObservedRoomId(),
      serverTick: this.state.serverTick,
    });
    this.traceCombatStateRefresh("inventory", params.playerId, result);
    return result;
  }

  /** 战斗结束结算后下发 asset_refresh(10510) 与 progress_refresh(12742)。 */
  protected pushCombatSettlementRewardRefresh(params: {
    playerId: string;
    reason?: CombatStateRefreshReason;
    currencies?: Record<string, number>;
  }): CombatStateRefreshPushResult | null {
    if (!String(params.playerId || "").trim()) {
      return null;
    }

    const result = pushCombatRewardRefresh({
      playerId: params.playerId,
      reason: params.reason,
      currencies: params.currencies,
      roomId: this.getObservedRoomId(),
      serverTick: this.state.serverTick,
    });
    this.traceCombatStateRefresh("reward", params.playerId, result);
    return result;
  }

  private traceCombatStateRefresh(
    kind: "inventory" | "reward",
    playerId: string,
    result: CombatStateRefreshPushResult | null,
  ) {
    if (!result) {
      return;
    }
    console.info("[game-server] combat state refresh pushed", {
      logCategory: "game-server.room.combat_state_refresh",
      roomId: this.getObservedRoomId(),
      roomKind: this.roomKind,
      battleMode: this.battleMode,
      combatId: this.combatId || null,
      kind,
      playerId,
      frameCount: result.frameCount,
      delivered: result.delivered,
      matchedSessions: result.matchedSessions,
      roomIds: result.roomIds,
    });
  }

  async onJoin(client: Client, options: Parameters<BaseGameRoom["onJoin"]>[1], auth?: GameRoomAuthContext) {
    super.onJoin(client, options, auth);
    // 进房先挂基线摘要，等 repair 补齐时统一下发，避免"连上了但数值是旧的"。
    seedRepairRefreshDigestForJoin(
      auth?.playerId || String(options.playerId || client.sessionId),
    );
    this.authBySessionId.set(client.sessionId, auth || {
      accountId: null,
      playerId: String(options.playerId || client.sessionId),
      playerName: String(options.playerId || client.sessionId),
      authenticated: false,
      authMode: "disabled",
      joinOptions: {
        mapId: String(options.mapId || "default"),
        shardId: String(options.shardId || "0"),
        playerId: String(options.playerId || client.sessionId),
        combatId: options.combatId,
        partyId: options.partyId,
      },
    });
    this.combatId = options.combatId || auth?.joinOptions.combatId || this.combatId;
    this.partyId = options.partyId || auth?.joinOptions.partyId || this.partyId;
    const entity = this.state.entities.get(client.sessionId);
    if (!entity) {
      return;
    }
    entity.kind = "combatant";
    entity.x = this.clients.length <= 1 ? 50 : 52;
    entity.y = this.clients.length <= 1 ? 76 : 24;
    entity.updatedAt = Date.now();
    this.state.snapshotVersion += 1;
    this.updateRoomEntityCount();
    await this.refreshRuntimeForClient(client).catch((error) => {
      console.error("[game-server] combat runtime hydrate failed", {
        roomId: this.getObservedRoomId(),
        roomKind: this.roomKind,
        combatId: this.combatId,
        partyId: this.partyId,
        error,
      });
    });
    this.clock.setTimeout(() => {
      if (!this.clients.includes(client) || !this.state.entities.has(client.sessionId)) {
        return;
      }
      this.sendCombatSceneSnapshot(client, null, [{
        type: "repair",
        actorId: entity.id,
      }]);
    }, 0);
  }

  async onLeave(client: Client, code?: number) {
    incrementGameServerMetric("leaves");
    adjustOnlineConnections(-1);
    recordGameServerRoomLeave(this.roomId);
    // 断网 / 锁屏被掐断时不会走 leave 报文，这里必须显式摘掉投递目标，
    // 否则服务端会一直把刷新帧投给一条死连接 —— 假在线的根源之一。
    unregisterStateRefreshTarget(this.getObservedRoomId(), client.sessionId);
    const entity = this.state.entities.get(client.sessionId);
    const shouldAllowReconnect = Boolean(entity)
      && isReconnectCandidateCloseCode(code)
      && getBattleRuleset(this.battleMode).timeout.repairOnReconnect;

    if (!shouldAllowReconnect) {
      this.reconnectingSessionIds.delete(client.sessionId);
      this.authBySessionId.delete(client.sessionId);
      this.runtimeBySessionId.delete(client.sessionId);
      this.state.entities.delete(client.sessionId);
      this.state.snapshotVersion += 1;
      this.updateRoomEntityCount();
      return;
    }

    incrementGameServerMetric("reconnectLeaves");
    recordGameServerRoomReconnectLeave(this.roomId);
    this.reconnectingSessionIds.add(client.sessionId);
    try {
      const reconnectedClient = await this.waitForClientReconnection(client, COMBAT_RECONNECT_GRACE_SECONDS);
      this.reconnectingSessionIds.delete(client.sessionId);
      incrementGameServerMetric("reconnectSuccesses");
      recordGameServerRoomReconnectSuccess(this.roomId);
      adjustOnlineConnections(1);
      recordGameServerRoomJoin(this.roomId);
      await this.refreshRuntimeForClient(reconnectedClient).catch(() => null);
      this.sendCombatSceneSnapshot(reconnectedClient, null, [{
        type: "repair",
        actorId: entity?.id || null,
      }]);
    } catch {
      this.reconnectingSessionIds.delete(client.sessionId);
      incrementGameServerMetric("reconnectFailures");
      recordGameServerRoomReconnectFailure(this.roomId);
      await this.settlePvpDisconnectIfNeeded(client).catch((error) => {
        recordGameServerRoomPersistFailure(this.getObservedRoomId(), "pvp_disconnect_settlement_failed");
        console.error("[game-server] pvp disconnect settlement failed", {
          logCategory: "game-server.room.db_persist_failed",
          roomId: this.getObservedRoomId(),
          roomKind: this.roomKind,
          mapId: this.state.mapId,
          shardId: this.state.shardId,
          combatId: this.combatId,
          sessionId: client.sessionId,
          reason: "pvp_disconnect_settlement_failed",
          error,
        });
      });
      this.authBySessionId.delete(client.sessionId);
      this.runtimeBySessionId.delete(client.sessionId);
      this.state.entities.delete(client.sessionId);
      this.state.snapshotVersion += 1;
      this.updateRoomEntityCount();
    }
  }

  async onDispose() {
    await this.flushPendingSettlementJobs("room_dispose");
    super.onDispose();
  }

  public getCurrentTimeoutDecision(nowMs = Date.now(), lastInputAtMs = this.lastInputAtMs) {
    if (this.battleMode !== "pvp") {
      return null;
    }
    return decidePvpTimeoutAdvance({
      ruleset: getBattleRuleset(this.battleMode),
      nowMs,
      lastInputAtMs,
    });
  }

  private async settlePvpDisconnectIfNeeded(client: Client) {
    if (this.battleMode !== "pvp" || !process.env.DATABASE_URL) {
      return false;
    }

    const { playerId, combatId } = this.getCombatRuntimeContext(client);
    if (!playerId || !combatId) {
      return false;
    }

    const {
      buildPvpCombatRouteData,
    } = await import("../../../../src/modules/combat/services/pvp-combat-command-transaction");
    const {
      settlePvpCombatDisconnect,
    } = await import("../../../../src/modules/combat/services/pvp-runtime-service");
    const result = await settlePvpCombatDisconnect({
      combatId,
      disconnectedPlayerId: playerId,
    });
    if (!result.success) {
      recordGameServerRoomPersistFailure(this.getObservedRoomId(), "pvp_disconnect_settlement_rejected");
      console.warn("[game-server] pvp disconnect settlement rejected", {
        logCategory: "game-server.room.db_persist_failed",
        roomId: this.getObservedRoomId(),
        roomKind: this.roomKind,
        mapId: this.state.mapId,
        shardId: this.state.shardId,
        combatId,
        playerId,
        reason: "pvp_disconnect_settlement_rejected",
        error: result.error,
      });
      return true;
    }

    // 断线裁定同样会发放 / 结算奖励，落账后立即补齐资产与进度帧。
    this.pushCombatSettlementRewardRefresh({
      playerId,
      reason: COMBAT_STATE_REFRESH_REASON.disconnectSettled,
    });
    await this.refreshRuntimeForAllClients();
    const routeData = buildPvpCombatRouteData({
      runtimeId: combatId,
      playerId,
    });
    const settlement = routeData?.settlement || result.runtime.settlement;
    if (!settlement) {
      return true;
    }
    const event: CombatSceneEvent = {
      type: "settlement",
      intent: settlement,
      persistence: {
        attempted: true,
        persisted: true,
        alreadyProcessed: !result.settlementTriggered,
      },
    };
    this.sendCombatSceneSnapshotToAll(client, null, [event]);
    this.sendCombatSceneEnvelopeToAll(client, "settlement", null, [event]);
    this.lastInputAtMs = Date.now();
    return true;
  }

  private createCombatSceneEnvelope(
    client: Client,
    acceptedSequence: number | null,
    events: CombatSceneEvent[],
  ): CombatSceneEnvelope {
    const ruleset: BattleRuleset = getBattleRuleset(this.battleMode);
    const hydrated = this.runtimeBySessionId.get(client.sessionId);
    const fallbackAuthoritativeState = {
      mode: this.battleMode,
      ruleset,
      entities: [...this.state.entities.values()].map(toCombatSceneEntity),
      runtimeSource: "fallback" as const,
      timeoutDecision: this.getCurrentTimeoutDecision(),
      reconnectingSessionIds: [...this.reconnectingSessionIds],
    };
    return {
      type: "scene_snapshot",
      serverTick: this.state.serverTick,
      roomId: this.getObservedRoomId(),
      snapshotVersion: this.state.snapshotVersion,
      acceptedSequence,
      authoritativeState: hydrated?.source && hydrated.source !== "fallback"
        ? hydrated.authoritativeState
        : fallbackAuthoritativeState,
      events,
    };
  }

  protected sendCombatSceneSnapshot(
    client: Client,
    acceptedSequence: number | null,
    events: CombatSceneEvent[] = [],
  ) {
    client.send("scene_snapshot", this.createCombatSceneEnvelope(client, acceptedSequence, events));
  }

  protected sendCombatSceneEnvelope(
    client: Client,
    messageType: "timeline_event" | "settlement",
    acceptedSequence: number | null,
    events: CombatSceneEvent[] = [],
  ) {
    client.send(messageType, {
      ...this.createCombatSceneEnvelope(client, acceptedSequence, events),
      type: messageType,
    } satisfies CombatSceneEnvelope);
  }

  protected sendCombatSceneSnapshotToAll(
    sourceClient: Client,
    acceptedSequence: number | null,
    events: CombatSceneEvent[] = [],
  ) {
    for (const roomClient of this.clients) {
      this.sendCombatSceneSnapshot(
        roomClient,
        roomClient.sessionId === sourceClient.sessionId ? acceptedSequence : null,
        events,
      );
    }
  }

  protected sendCombatSceneEnvelopeToAll(
    sourceClient: Client,
    messageType: "timeline_event" | "settlement",
    acceptedSequence: number | null,
    events: CombatSceneEvent[] = [],
  ) {
    for (const roomClient of this.clients) {
      this.sendCombatSceneEnvelope(
        roomClient,
        messageType,
        roomClient.sessionId === sourceClient.sessionId ? acceptedSequence : null,
        events,
      );
    }
  }

  private async refreshRuntimeForClient(client: Client) {
    const auth = this.authBySessionId.get(client.sessionId);
    const playerId = auth?.playerId || this.state.entities.get(client.sessionId)?.id || client.sessionId;
    const playerName = auth?.playerName || this.state.entities.get(client.sessionId)?.name || playerId;
    const joinOptions = auth?.joinOptions;
    const hydrated = await hydrateCombatRuntime({
      mode: this.battleMode,
      playerId,
      playerName,
      combatId: joinOptions?.combatId || this.combatId,
      partyId: joinOptions?.partyId || this.partyId,
      roomId: this.getObservedRoomId(),
    });
    this.runtimeBySessionId.set(client.sessionId, hydrated);
    this.applyHydratedEntities(hydrated);
    return hydrated;
  }

  protected getRuntimeSourceForClient(client: Client) {
    return this.runtimeBySessionId.get(client.sessionId)?.source || "fallback";
  }

  protected async refreshRuntimeForAllClients() {
    await Promise.all(this.clients.map((client) => this.refreshRuntimeForClient(client).catch((error) => {
      console.error("[game-server] combat runtime refresh failed", {
        roomId: this.getObservedRoomId(),
        roomKind: this.roomKind,
        sessionId: client.sessionId,
        error,
      });
      return null;
    })));
  }

  private createRuntimeBroadcastFingerprint() {
    const entities = [...this.state.entities.values()]
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        role: (entity as { role?: string }).role,
        hp: (entity as { hp?: number }).hp,
        maxHp: (entity as { maxHp?: number }).maxHp,
        mp: (entity as { mp?: number }).mp,
        maxMp: (entity as { maxMp?: number }).maxMp,
        x: entity.x,
        y: entity.y,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    const runtimeSources = [...this.runtimeBySessionId.entries()]
      .map(([sessionId, runtime]) => ({
        sessionId,
        source: runtime.source,
        mode: runtime.mode,
        state: runtime.authoritativeState.state,
        participants: runtime.authoritativeState.participants,
        claimState: runtime.authoritativeState.claimState,
        turnState: runtime.authoritativeState.turnState,
        settlement: runtime.authoritativeState.settlement,
      }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));

    return JSON.stringify({
      battleMode: this.battleMode,
      combatId: this.combatId || null,
      partyId: this.partyId || null,
      entities,
      runtimeSources,
    });
  }

  protected async refreshRuntimeAndBroadcastIfChanged(params?: {
    commandType?: string;
    settlementWhenDefeated?: boolean;
  }) {
    if (!this.clients.length) {
      return false;
    }

    await this.refreshRuntimeForAllClients();
    const nextFingerprint = this.createRuntimeBroadcastFingerprint();
    if (nextFingerprint === this.lastRuntimeBroadcastFingerprint) {
      return false;
    }
    this.lastRuntimeBroadcastFingerprint = nextFingerprint;

    const timelineEvent: CombatSceneEvent = {
      type: "timeline_event",
      actorId: "system",
      commandType: params?.commandType || "runtime_refresh",
      targetId: null,
      occurredAt: Date.now(),
    };
    const isDefeated = [...this.state.entities.values()].some((entity) => {
      const role = (entity as { role?: string }).role;
      const hp = (entity as { hp?: number }).hp;
      return role === "boss" && typeof hp === "number" && hp <= 0;
    });
    const settlementEvent: CombatSceneEvent | null = params?.settlementWhenDefeated && isDefeated
      ? {
        type: "settlement",
        intent: {
          battleId: this.roomId,
          mode: this.battleMode,
          reason: "runtime_defeated",
          occurredAt: Date.now(),
        },
        persistence: {
          source: "runtime_refresh",
        },
      }
      : null;

    for (const roomClient of this.clients) {
      this.sendCombatSceneSnapshot(roomClient, null, [timelineEvent]);
      this.sendCombatSceneEnvelope(roomClient, "timeline_event", null, [timelineEvent]);
      if (settlementEvent) {
        this.sendCombatSceneEnvelope(roomClient, "settlement", null, [settlementEvent]);
      }
    }
    return true;
  }

  private applyHydratedEntities(hydrated: CombatRuntimeHydrationResult) {
    const nextHydratedKeys = new Set(hydrated.entities.map((entity) => entity.id));
    const clientSessionIds = new Set(this.clients.map((client) => client.sessionId));

    for (const key of this.hydratedEntityKeys) {
      if (!nextHydratedKeys.has(key) && !clientSessionIds.has(key)) {
        this.state.entities.delete(key);
      }
    }

    this.hydratedEntityKeys.clear();
    for (const entity of hydrated.entities) {
      const key = entity.id;
      let target = this.state.entities.get(key);
      if (!target) {
        const sessionEntry = [...this.state.entities.entries()].find(([, value]) => value.id === entity.id);
        target = sessionEntry?.[1];
      }
      if (!target) {
        target = new GameEntityState();
        this.state.entities.set(key, target);
      }
      target.id = entity.id;
      target.kind = entity.kind;
      target.name = entity.name;
      target.x = entity.x;
      target.y = entity.y;
      target.velocityX = entity.velocityX;
      target.velocityY = entity.velocityY;
      target.updatedAt = entity.updatedAt;
      if (!clientSessionIds.has(key)) {
        this.hydratedEntityKeys.add(key);
      }
    }
    this.state.snapshotVersion += 1;
    this.updateRoomEntityCount();
  }

  protected handleRepairInput(client: Client, input: RealtimeClientInput) {
    const entity = this.state.entities.get(client.sessionId);
    void this.refreshRuntimeForClient(client).finally(() => {
      const hydrated = this.runtimeBySessionId.get(client.sessionId);
      if (!entity && !hydrated) {
        recordRealtimeRejected("entity_missing", this.roomId);
      }
      client.send("ack", createRealtimeInputAck({
        accepted: Boolean(entity || hydrated),
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: entity || hydrated ? undefined : "entity_missing",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          ruleset: getBattleRuleset(this.battleMode),
          runtimeSource: hydrated?.source || "fallback",
          self: entity
            ? {
              id: entity.id,
              x: entity.x,
              y: entity.y,
            }
            : null,
        },
      }));
      this.sendCombatSceneSnapshot(client, input.clientSequence, [{
        type: "repair",
        actorId: entity?.id || null,
      }]);
      // 前后台恢复 repair 补齐后补发资产 / 背包 / 进度刷新帧，禁止只回 ACK。
      flushRepairRefreshForClient({
        client,
        input,
        playerId: entity?.id || client.sessionId,
        roomId: this.getObservedRoomId(),
        serverTick: this.state.serverTick,
      });
    });
  }

  protected handleUnsupportedRealtimeInput(client: Client, input: RealtimeClientInput) {
    if (input.inputType === "movement") {
      void this.handleCombatMovementInput(client, input);
      return;
    }
    if (input.inputType === "command" || input.inputType === "useItem" || input.inputType === "surrender") {
      void this.handleCombatCommandInput(client, input);
      return;
    }
    super.handleUnsupportedRealtimeInput(client, input);
  }

  private rememberPendingSettlementJob(job: PendingSettlementJob) {
    this.pendingSettlementJobs.set(job.settlementIntent.idempotencyKey, job);
  }

  private forgetPendingSettlementJob(job: PendingSettlementJob) {
    this.pendingSettlementJobs.delete(job.settlementIntent.idempotencyKey);
  }

  private async persistSettlementJob(job: PendingSettlementJob) {
    const persistence = await executeCombatSettlementTransaction(job).catch((error) => {
      recordGameServerRoomPersistFailure(this.getObservedRoomId(), "combat_settlement_transaction_threw");
      console.error("[game-server] combat settlement transaction failed", {
        logCategory: "game-server.room.db_persist_failed",
        roomId: this.getObservedRoomId(),
        roomKind: this.roomKind,
        mapId: this.state.mapId,
        shardId: this.state.shardId,
        combatId: this.combatId,
        battleId: job.settlementIntent.battleId,
        idempotencyKey: job.settlementIntent.idempotencyKey,
        reason: "combat_settlement_transaction_threw",
        error,
      });
      throw error;
    });
    if (persistence.persisted) {
      this.forgetPendingSettlementJob(job);
      // 战斗结算会改资产 / 背包 / 进度，挂摘要等待下一次 repair 补齐下发。
      recordPlayerRefreshDigest({
        playerId: job.rewardIntent.playerId,
        inventory: {},
        asset: {},
        progress: { scopes: ["cultivation", "realm", "quest"] },
      });
      // 奖励已落账，立即下发 asset_refresh / progress_refresh，不能只回 ACK。
      this.pushCombatSettlementRewardRefresh({ playerId: job.rewardIntent.playerId });
    } else {
      recordGameServerRoomPersistFailure(this.getObservedRoomId(), persistence.reason || "combat_settlement_pending");
      this.rememberPendingSettlementJob(job);
    }
    return persistence;
  }

  private async flushPendingSettlementJobs(reason: string) {
    if (!this.pendingSettlementJobs.size) {
      return;
    }

    for (let attempt = 1; attempt <= SETTLEMENT_FLUSH_RETRY_LIMIT && this.pendingSettlementJobs.size > 0; attempt += 1) {
      const jobs = [...this.pendingSettlementJobs.values()];
      for (const job of jobs) {
        const persistence = await executeCombatSettlementTransaction(job).catch((error) => {
          recordGameServerRoomPersistFailure(this.getObservedRoomId(), "combat_settlement_flush_threw");
          console.error("[game-server] combat settlement flush failed", {
            logCategory: "game-server.room.db_persist_failed",
            roomId: this.getObservedRoomId(),
            roomKind: this.roomKind,
            mapId: this.state.mapId,
            shardId: this.state.shardId,
            combatId: this.combatId,
            battleId: job.settlementIntent.battleId,
            idempotencyKey: job.settlementIntent.idempotencyKey,
            ageMs: Math.max(0, Date.now() - job.createdAtMs),
            reason: "combat_settlement_flush_threw",
            attempt,
            error,
          });
          return {
            attempted: true,
            persisted: false,
            alreadyProcessed: false,
            reason: "flush_threw",
          } as unknown as Awaited<ReturnType<typeof executeCombatSettlementTransaction>>;
        });
        if (persistence.persisted) {
          this.forgetPendingSettlementJob(job);
          console.info("[game-server] combat settlement flush persisted", {
            roomId: this.getObservedRoomId(),
            roomKind: this.roomKind,
            battleId: job.settlementIntent.battleId,
            idempotencyKey: job.settlementIntent.idempotencyKey,
            ageMs: Math.max(0, Date.now() - job.createdAtMs),
            reason,
            attempt,
            alreadyProcessed: persistence.alreadyProcessed,
            rewardClaimId: persistence.rewardClaimId || null,
            sideEffectClaimed: persistence.sideEffectClaimed === true,
          });
          continue;
        }
        recordGameServerRoomPersistFailure(this.getObservedRoomId(), persistence.reason || "combat_settlement_flush_pending");
        console.warn("[game-server] combat settlement flush retry pending", {
          logCategory: "game-server.room.db_persist_retry",
          roomId: this.getObservedRoomId(),
          roomKind: this.roomKind,
          mapId: this.state.mapId,
          shardId: this.state.shardId,
          battleId: job.settlementIntent.battleId,
          idempotencyKey: job.settlementIntent.idempotencyKey,
          ageMs: Math.max(0, Date.now() - job.createdAtMs),
          reason,
          attempt,
          maxAttempts: SETTLEMENT_FLUSH_RETRY_LIMIT,
          persistenceReason: persistence.reason,
        });
      }
    }

    for (const job of this.pendingSettlementJobs.values()) {
      recordGameServerRoomPersistFailure(this.getObservedRoomId(), "combat_settlement_flush_exhausted");
      console.error("[game-server] combat settlement flush exhausted", {
        logCategory: "game-server.room.db_persist_failed",
        roomId: this.getObservedRoomId(),
        roomKind: this.roomKind,
        mapId: this.state.mapId,
        shardId: this.state.shardId,
        battleId: job.settlementIntent.battleId,
        idempotencyKey: job.settlementIntent.idempotencyKey,
        ageMs: Math.max(0, Date.now() - job.createdAtMs),
        reason,
        attempts: SETTLEMENT_FLUSH_RETRY_LIMIT,
      });
    }
  }

  private createSettlementJob(params: {
    actorId: string;
    targetId: string | null;
    reason: BattleSettlementIntent["reason"];
    surrendered?: boolean;
    defeated?: boolean;
  }): PendingSettlementJob {
    const settlementIntent = createBattleSettlementIntent({
      battleId: getRoomBattleId(this),
      mode: this.battleMode,
      winnerId: params.reason === "victory" ? params.actorId : params.targetId,
      loserId: params.reason === "victory" ? params.targetId : params.actorId,
      reason: params.reason,
      occurredAt: Date.now(),
    });
    const rewardPlayerId = settlementIntent.winnerId || settlementIntent.loserId || params.actorId;
    const rewardIntent = createBattleRewardIntent({
      battleId: settlementIntent.battleId,
      mode: settlementIntent.mode,
      playerId: rewardPlayerId,
      reason: settlementIntent.reason,
    });
    const dropIntent = createBattleDropIntent({
      battleId: settlementIntent.battleId,
      mode: settlementIntent.mode,
      playerId: rewardPlayerId,
      reason: settlementIntent.reason,
    });
    const deathPenaltyIntent = createBattleDeathPenaltyIntent({
      playerId: settlementIntent.loserId || params.actorId,
      battleId: settlementIntent.battleId,
      mode: this.battleMode,
      defeated: params.defeated !== false,
      surrendered: params.surrendered === true,
    });

    return {
      settlementIntent,
      rewardIntent,
      dropIntent,
      deathPenaltyIntent,
      opponentType: this.battleMode,
      opponentId: params.targetId,
      createdAtMs: Date.now(),
    };
  }

  private async tryHandleSoloRuntimeMovement(client: Client, input: RealtimeClientInput) {
    if (this.battleMode !== "solo") {
      return false;
    }

    const { playerId, combatId } = this.getCombatRuntimeContext(client);
    if (!combatId) {
      this.logSoloRuntimeMissing({
        client,
        input,
        playerId,
        combatId,
        commandType: "movement",
        reason: "missing_combat_id",
      });
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        message: "战斗会话参数缺失，请重新进入战斗",
      });
      return true;
    }
    let pendingCombat = getPendingCombatSession(playerId, combatId);
    if (!pendingCombat) {
      await this.refreshRuntimeForClient(client).catch((error) => {
        this.logSoloRuntimeMissing({
          client,
          input,
          playerId,
          combatId,
          commandType: "movement",
          reason: "runtime_refresh_failed",
          error,
        });
      });
      pendingCombat = getPendingCombatSession(playerId, combatId);
    }
    if (!pendingCombat) {
      this.logSoloRuntimeMissing({
        client,
        input,
        playerId,
        combatId,
        commandType: "movement",
        reason: "pending_runtime_missing",
      });
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        message: "战斗会话不存在或已失效，请刷新后重新进入战斗",
      });
      return true;
    }

    const lastAcceptedClientSequence = pendingCombat.lastAcceptedClientSequence || 0;
    if (input.clientSequence <= lastAcceptedClientSequence) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "already_processed",
        message: "动作序列已处理",
      });
      return true;
    }
    if (input.clientSequence > lastAcceptedClientSequence + 1) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "动作序号跳帧，请等待上一帧确认后再继续出手",
      });
      return true;
    }

    const serverSceneTick = pendingCombat.sceneSnapshot?.tick || 0;
    if (isSoloRuntimeClientSceneTickStale(input.clientSceneTick, serverSceneTick)) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "战斗状态已更新，请等待场景同步后再移动",
      });
      return true;
    }

    const payload = input.payload as Partial<CombatMovementPayload> | null;
    const targetXPercent = Number(payload?.targetXPercent ?? payload?.x);
    const targetYPercent = Number(payload?.targetYPercent ?? payload?.y);
    if (!Number.isFinite(targetXPercent) || !Number.isFinite(targetYPercent)) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "invalid_payload",
        message: "缺少目标位置",
      });
      return true;
    }

    if (!tryAcquirePendingCombatSessionLock(playerId, combatId)) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "战斗操作处理中，请稍后再试",
      });
      return true;
    }

    try {
      const lockedCombat = getPendingCombatSession(playerId, combatId);
      if (!lockedCombat) {
        this.sendSoloRuntimeRejectAck({
          client,
          input,
          acceptedSequence: lastAcceptedClientSequence,
          reason: "entity_missing",
          message: "战斗会话不存在或已失效",
        });
        return true;
      }

      const result = await performSoloCombatMovementTransaction({
        playerId,
        combatId,
        session: lockedCombat,
        targetXPercent,
        targetYPercent,
        clientSequence: input.clientSequence,
      });
      if (!result.success && result.acknowledgeSequence) {
        lockedCombat.lastAcceptedClientSequence = input.clientSequence;
      }

      await this.refreshRuntimeForAllClients();
      const nextCombat = getPendingCombatSession(playerId, combatId) || lockedCombat;
      const routeData = result.success
        ? result.data
        : result.data || buildSoloCombatRouteData({
          runtimeId: combatId,
          playerId,
          session: nextCombat,
        });
      const acceptedSequence = result.success || result.acknowledgeSequence
        ? input.clientSequence
        : lastAcceptedClientSequence;
      const movementEvent: CombatSceneEvent = {
        type: "movement_ack",
        actorId: playerId,
        x: targetXPercent,
        y: targetYPercent,
      };

      client.send("ack", createRealtimeInputAck({
        accepted: result.success,
        inputType: input.inputType,
        acceptedSequence,
        reason: result.success ? undefined : mapSoloRuntimeErrorToRejectReason(result.error),
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          runtimeSource: "pending_combat",
          commandType: "movement",
          battleView: routeData.battleView,
          battleRuntime: routeData.battleRuntime,
          sceneSnapshot: routeData.sceneSnapshot,
          state: routeData.state,
          message: result.success ? null : result.error,
        },
      }));

      this.sendCombatSceneSnapshotToAll(client, acceptedSequence, result.success ? [movementEvent] : []);
      this.lastInputAtMs = Date.now();
      return true;
    } finally {
      releasePendingCombatSessionLock(playerId, combatId);
    }
  }

  private async tryHandlePartyRuntimeTimeoutAdvance(client: Client, input: RealtimeClientInput, commandType: BattleCommandType) {
    if (this.battleMode !== "party" || commandType !== "timeoutAdvance") {
      return false;
    }

    const auth = this.authBySessionId.get(client.sessionId);
    const entity = this.state.entities.get(client.sessionId);
    const playerId = auth?.playerId || entity?.id || client.sessionId;
    const encounterId = auth?.joinOptions.partyId || this.partyId || auth?.joinOptions.combatId || this.combatId || "";
    if (!encounterId) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          message: "组队战斗不存在",
        },
      }));
      return true;
    }

    if (!process.env.DATABASE_URL) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "unsupported_input",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          runtimeSource: "fallback",
          message: "DATABASE_URL 未配置，组队战超时推进无法落账",
        },
      }));
      return true;
    }

    const { performPartyCombatTimeoutAdvanceTransaction } = await import("../../../../src/modules/combat/services/party-combat-command-transaction");
    const result = await performPartyCombatTimeoutAdvanceTransaction({
      encounterId,
      actorPlayerId: playerId,
    });
    const routeData = result.data || null;

    client.send("ack", createRealtimeInputAck({
      accepted: result.success,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: result.success ? undefined : mapSoloRuntimeErrorToRejectReason(result.error),
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        runtimeSource: "party_encounter",
        commandType,
        battleView: routeData?.battleView,
        battleRuntime: routeData?.battleRuntime,
        sceneSnapshot: routeData?.sceneSnapshot,
        state: routeData?.state,
        turnState: routeData?.turnState,
        message: result.success ? null : result.error,
      },
    }));

    if (routeData) {
      await this.refreshRuntimeForAllClients();
      const event: CombatSceneEvent = {
        type: "timeline_event",
        actorId: playerId,
        commandType,
        targetId: null,
        occurredAt: Date.now(),
      };
      this.sendCombatSceneSnapshotToAll(client, input.clientSequence, [event]);
      this.sendCombatSceneEnvelopeToAll(client, "timeline_event", input.clientSequence, [event]);
    }
    this.lastInputAtMs = Date.now();
    return true;
  }

  private async tryHandlePartyRuntimeCommand(client: Client, input: RealtimeClientInput, commandType: BattleCommandType) {
    if (this.battleMode !== "party") {
      return false;
    }
    if (
      commandType !== "basicAttack"
      && commandType !== "skill"
      && commandType !== "item"
      && commandType !== "flee"
      && commandType !== "surrender"
    ) {
      return false;
    }

    const auth = this.authBySessionId.get(client.sessionId);
    const entity = this.state.entities.get(client.sessionId);
    const playerId = auth?.playerId || entity?.id || client.sessionId;
    const encounterId = auth?.joinOptions.partyId || this.partyId || auth?.joinOptions.combatId || this.combatId || "";
    if (!encounterId) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          message: "组队战斗不存在",
        },
      }));
      return true;
    }

    if (!process.env.DATABASE_URL) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "unsupported_input",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          runtimeSource: "fallback",
          message: "DATABASE_URL 未配置，组队战动作无法落账",
        },
      }));
      return true;
    }

    const action: "skill" | "item" | "flee" | "surrender" = commandType === "basicAttack"
      ? "skill"
      : commandType === "surrender"
        ? "flee"
        : commandType;
    const skillId = commandType === "basicAttack" ? BASIC_ATTACK_SKILL_ID : getCommandSkillId(input);
    const { performPartyCombatActionTransaction } = await import("../../../../src/modules/combat/services/party-combat-command-transaction");
    const result = await performPartyCombatActionTransaction({
      encounterId,
      actorPlayerId: playerId,
      action,
      skillId,
      itemId: getCommandItemId(input),
      clientSequence: input.clientSequence,
      clientSceneTick: input.clientSceneTick,
    });
    const routeData = result.data || null;
    const acceptedSequence = typeof result.acceptedClientSequence === "number"
      ? result.acceptedClientSequence
      : input.clientSequence;

    client.send("ack", createRealtimeInputAck({
      accepted: result.success,
      inputType: input.inputType,
      acceptedSequence,
      reason: result.success ? undefined : mapSoloRuntimeErrorToRejectReason(result.error),
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        runtimeSource: "party_encounter",
        commandType,
        battleView: routeData?.battleView,
        battleRuntime: routeData?.battleRuntime,
        sceneSnapshot: routeData?.sceneSnapshot,
        state: routeData?.state,
        turnState: routeData?.turnState,
        message: result.success ? null : result.error,
      },
    }));

    if (routeData) {
      await this.refreshRuntimeForAllClients();
      const timelineEvent: CombatSceneEvent = {
        type: "timeline_event",
        actorId: playerId,
        commandType,
        targetId: getTargetId(input) || null,
        occurredAt: Date.now(),
      };
      this.sendCombatSceneSnapshotToAll(client, acceptedSequence, [
        {
          type: "command_ack",
          actorId: playerId,
          commandType,
          targetId: getTargetId(input) || null,
        },
        timelineEvent,
      ]);
      this.sendCombatSceneEnvelopeToAll(client, "timeline_event", acceptedSequence, [timelineEvent]);
    }
    // 组队战丹药同样必须下发库存刷新帧。
    this.pushCombatItemConsumedRefresh({
      playerId,
      commandType,
      itemId: getCommandItemId(input),
      accepted: result.success,
    });
    if (routeData?.state && routeData.state.status !== "ongoing") {
      this.pushCombatSettlementRewardRefresh({ playerId });
    }
    this.lastInputAtMs = Date.now();
    return true;
  }

  private async tryHandlePvpRuntimeCommand(client: Client, input: RealtimeClientInput, commandType: BattleCommandType) {
    if (this.battleMode !== "pvp") {
      return false;
    }
    if (commandType !== "skill" && commandType !== "item" && commandType !== "surrender" && commandType !== "flee") {
      return false;
    }
    if (!process.env.DATABASE_URL) {
      return false;
    }

    const auth = this.authBySessionId.get(client.sessionId);
    const entity = this.state.entities.get(client.sessionId);
    const playerId = auth?.playerId || entity?.id || client.sessionId;
    const combatId = auth?.joinOptions.combatId || this.combatId || "";
    if (!combatId) {
      return false;
    }

    const {
      acceptPvpClientSequence,
      getLastAcceptedPvpClientSequence,
      getPvpCombatRuntime,
    } = await import("../../../../src/modules/combat/services/pvp-runtime-service");
    const {
      buildPvpCombatRouteData,
      performPvpCombatActionTransaction,
    } = await import("../../../../src/modules/combat/services/pvp-combat-command-transaction");
    const runtime = getPvpCombatRuntime(combatId);
    if (!runtime) {
      return false;
    }

    const lastAcceptedClientSequence = getLastAcceptedPvpClientSequence(combatId, playerId);
    if (input.clientSequence <= lastAcceptedClientSequence) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "already_processed",
        message: "动作序列已处理",
      });
      return true;
    }
    if (input.clientSequence > lastAcceptedClientSequence + 1) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "动作序号跳帧，请等待上一帧确认后再继续出手",
      });
      return true;
    }

    const serverSceneTick = runtime.sceneSnapshotsByPlayerId[playerId]?.tick || 0;
    if (input.clientSceneTick > serverSceneTick || serverSceneTick - input.clientSceneTick > 5) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "论道状态已更新，请等待场景同步后再出手",
      });
      return true;
    }

    const result = await performPvpCombatActionTransaction({
      combatId,
      actorPlayerId: playerId,
      action: commandType === "flee" ? "surrender" : commandType,
      skillId: getCommandSkillId(input),
      itemId: getCommandItemId(input),
    });
    if (result.success || result.acknowledgeSequence) {
      acceptPvpClientSequence(combatId, playerId, input.clientSequence);
    }
    const routeData = result.success
      ? result.data
      : result.data || buildPvpCombatRouteData({
        runtimeId: combatId,
        playerId,
      });
    const acceptedSequence = result.success || result.acknowledgeSequence
      ? input.clientSequence
      : lastAcceptedClientSequence;

    client.send("ack", createRealtimeInputAck({
      accepted: result.success,
      inputType: input.inputType,
      acceptedSequence,
      reason: result.success ? undefined : mapSoloRuntimeErrorToRejectReason(result.error),
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        runtimeSource: "pvp_runtime",
        commandType,
        battleView: routeData?.battleView,
        battleRuntime: routeData?.battleRuntime,
        sceneSnapshot: routeData?.sceneSnapshot,
        state: routeData?.state,
        turnState: routeData?.turnState,
        settlement: routeData?.settlement,
        message: result.success ? null : result.error,
      },
    }));

    if (routeData) {
      await this.refreshRuntimeForAllClients();
      const event: CombatSceneEvent = routeData.settlement
        ? {
          type: "settlement",
          intent: routeData.settlement,
          persistence: null,
        }
        : {
          type: "timeline_event",
          actorId: playerId,
          commandType,
          targetId: getTargetId(input) || null,
          occurredAt: Date.now(),
        };
      this.sendCombatSceneSnapshotToAll(client, acceptedSequence, [event]);
      this.sendCombatSceneEnvelopeToAll(client, event.type === "settlement" ? "settlement" : "timeline_event", acceptedSequence, [event]);
    }
    // 论道丹药占用背包，必须下发库存刷新帧。
    this.pushCombatItemConsumedRefresh({
      playerId,
      commandType,
      itemId: getCommandItemId(input),
      accepted: result.success,
    });
    if (routeData?.settlement) {
      this.pushCombatSettlementRewardRefresh({ playerId });
    }
    this.lastInputAtMs = Date.now();
    return true;
  }

  private async tryHandlePvpRuntimeMovement(client: Client, input: RealtimeClientInput) {
    if (this.battleMode !== "pvp") {
      return false;
    }

    const { playerId, combatId } = this.getCombatRuntimeContext(client);
    const payload = input.payload as Partial<CombatMovementPayload> | null;
    const targetXPercent = Number(payload?.targetXPercent ?? payload?.x);
    const targetYPercent = Number(payload?.targetYPercent ?? payload?.y);
    if (!combatId || !Number.isFinite(targetXPercent) || !Number.isFinite(targetYPercent)) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: !combatId ? "missing_target" : "invalid_payload",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          runtimeSource: "pvp_runtime",
          commandType: "movement",
          message: !combatId ? "缺少论道会话 ID" : "PVP movement 缺少合法坐标",
        },
      }));
      return true;
    }

    const {
      acceptPvpClientSequence,
      getLastAcceptedPvpClientSequence,
    } = await import("../../../../src/modules/combat/services/pvp-runtime-service");
    const {
      buildPvpCombatRouteData,
      performPvpCombatMovementTransaction,
    } = await import("../../../../src/modules/combat/services/pvp-combat-command-transaction");

    const lastAcceptedClientSequence = getLastAcceptedPvpClientSequence(combatId, playerId);
    if (input.clientSequence <= lastAcceptedClientSequence) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "already_processed",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          runtimeSource: "pvp_runtime",
          commandType: "movement",
          battle: buildPvpCombatRouteData({
            runtimeId: combatId,
            playerId,
          }),
        },
      }));
      return true;
    }

    const result = await performPvpCombatMovementTransaction({
      combatId,
      actorPlayerId: playerId,
      targetXPercent,
      targetYPercent,
    });
    if (result.success || result.acknowledgeSequence) {
      acceptPvpClientSequence(combatId, playerId, input.clientSequence);
    }
    const routeData = result.success
      ? result.data
      : result.data || buildPvpCombatRouteData({
        runtimeId: combatId,
        playerId,
      });
    const acceptedSequence = result.success || result.acknowledgeSequence
      ? input.clientSequence
      : lastAcceptedClientSequence;
    const knownRejectReasons = new Set<string>([
      "invalid_input",
      "invalid_payload",
      "invalid_position",
      "entity_missing",
      "target_missing",
      "permission_denied",
      "already_processed",
      "stale_state",
      "unsupported_input",
      "out_of_bounds",
      "blocked",
      "too_far",
      "persist_failed",
      "missing_actor",
      "missing_target",
      "on_cooldown",
    ]);
    const rejectReason = result.success
      ? undefined
      : (knownRejectReasons.has(result.error || "") ? result.error : "stale_state") as RealtimeInputRejectReason;
    const movementPayload = result.success ? result.payload : null;

    client.send("ack", createRealtimeInputAck({
      accepted: result.success,
      inputType: input.inputType,
      acceptedSequence,
      reason: rejectReason,
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        runtimeSource: "pvp_runtime",
        commandType: "movement",
        battleView: routeData?.battleView,
        battleRuntime: routeData?.battleRuntime,
        sceneSnapshot: routeData?.sceneSnapshot,
        state: routeData?.state,
        turnState: routeData?.turnState,
        settlement: routeData?.settlement,
        payload: movementPayload,
        message: result.success ? null : result.error,
      },
    }));

    await this.refreshRuntimeForAllClients();
    this.sendCombatSceneSnapshotToAll(client, acceptedSequence, result.success
      ? [{
        type: "movement_ack",
        actorId: playerId,
        x: targetXPercent,
        y: targetYPercent,
      }]
      : []);
    this.lastInputAtMs = Date.now();
    return true;
  }

  private sendBossRuntimeCommandReject(params: {
    client: Client;
    input: RealtimeClientInput;
    commandType: BattleCommandType;
    reason?: RealtimeInputRejectReason;
    message: string;
    runtimeSource?: string;
  }) {
    const reason = params.reason || "unsupported_input";
    recordRealtimeRejected(reason, this.roomId);
    if (reason === "persist_failed") {
      recordGameServerRoomPersistFailure(this.getObservedRoomId(), "boss_runtime_command_failed");
    }
    params.client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: params.input.inputType,
      acceptedSequence: params.input.clientSequence,
      reason,
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        commandType: params.commandType,
        runtimeSource: params.runtimeSource || "boss_core_service",
        migrationNote: params.message,
      },
    }));
  }

  private async tryHandleBossRuntimeCommandBoundary(client: Client, input: RealtimeClientInput, commandType: BattleCommandType) {
    if (this.battleMode !== "boss") {
      return false;
    }
    if (
      commandType !== "basicAttack"
      && commandType !== "skill"
      && commandType !== "item"
      && commandType !== "flee"
      && commandType !== "surrender"
      && commandType !== "ready"
      && commandType !== "timeoutAdvance"
    ) {
      return false;
    }

    if (commandType === "flee" || commandType === "surrender") {
      const auth = this.authBySessionId.get(client.sessionId);
      const monsterId = auth?.joinOptions.combatId || this.combatId || "";
      const playerId = auth?.playerId || this.state.entities.get(client.sessionId)?.id || client.sessionId;
      if (!monsterId || !playerId) {
        this.sendBossRuntimeCommandReject({
          client,
          input,
          commandType,
          reason: "permission_denied",
          message: "BossRoom 缺少已认证玩家或首领 ID，无法执行离场事务。",
          runtimeSource: "boss_core_service",
        });
        return true;
      }

      try {
        const result = await performBossLeaveCommandTransaction({
          bossId: monsterId,
          playerId,
        });
        client.send("ack", createRealtimeInputAck({
          accepted: true,
          inputType: input.inputType,
          acceptedSequence: input.clientSequence,
          serverTick: this.state.serverTick,
          authoritativeState: {
            mode: this.battleMode,
            commandType,
            runtimeSource: "boss_core_service",
            participants: result.participants,
            turnState: result.turnState,
            sceneSnapshot: result.sceneSnapshot,
          },
        }));
        await this.refreshRuntimeForAllClients();
        const event: CombatSceneEvent = {
          type: "timeline_event",
          actorId: playerId,
          commandType,
          targetId: `boss:${monsterId}`,
          occurredAt: Date.now(),
        };
        this.sendCombatSceneSnapshotToAll(client, input.clientSequence, [event]);
        this.sendCombatSceneEnvelopeToAll(client, "timeline_event", input.clientSequence, [event]);
        this.lastInputAtMs = Date.now();
      } catch (error) {
        this.sendBossRuntimeCommandReject({
          client,
          input,
          commandType,
          reason: "persist_failed",
          runtimeSource: "boss_core_service",
          message: error instanceof Error ? error.message : "BossRoom 执行离场事务失败。",
        });
      }
      return true;
    }

    const auth = this.authBySessionId.get(client.sessionId);
    const monsterId = auth?.joinOptions.combatId || this.combatId || "";
    const cookieHeader = auth ? createBossBridgeCookieHeader(auth) : "";
    if (!process.env.DATABASE_URL || !auth?.playerId || !monsterId || !cookieHeader) {
      this.sendBossRuntimeCommandReject({
        client,
        input,
        commandType,
        reason: !process.env.DATABASE_URL ? "unsupported_input" : "permission_denied",
        runtimeSource: "boss_core_service",
        message: !process.env.DATABASE_URL
          ? "DATABASE_URL 未配置，BossRoom 无法执行真实 Boss 事务。"
          : "BossRoom 缺少已认证玩家、会话或首领 ID，无法执行真实 Boss 事务。",
      });
      return true;
    }

    const partyId = auth.joinOptions.partyId || this.partyId || undefined;
    try {
      const response = await performBossCoreServiceCommand({
        monsterId,
        cookieHeader,
        body: createBossHttpCommandBody({
          input,
          commandType,
          partyId,
        }),
      });
      const json = await readJsonResponse(response);
      const accepted = response.ok && json.success === true && Boolean(json.data);
      const rejectReason = accepted ? undefined : mapHttpStatusToRealtimeRejectReason(response.status);
      if (rejectReason) {
        recordRealtimeRejected(rejectReason, this.roomId);
      }
      if (rejectReason === "persist_failed") {
        recordGameServerRoomPersistFailure(this.getObservedRoomId(), "boss_core_service_rejected");
      }
      client.send("ack", createRealtimeInputAck({
        accepted,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: rejectReason,
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          commandType,
          runtimeSource: "boss_core_service",
          status: response.status,
          ...(json.data || {}),
          ...(json.error ? { error: json.error } : {}),
        },
      }));

      if (!accepted) {
        return true;
      }

      await this.refreshRuntimeForAllClients();
      const payload = json.data || {};
      const event: CombatSceneEvent = payload.bossDead
        ? {
          type: "settlement",
          intent: {
            battleId: `boss:${monsterId}`,
            mode: "boss",
            winnerSide: "players",
            reason: "defeated",
            finishedAt: new Date().toISOString(),
            participants: [],
          },
          persistence: null,
        }
        : {
          type: "timeline_event",
          actorId: auth.playerId,
          commandType,
          targetId: `boss:${monsterId}`,
          occurredAt: Date.now(),
        };
      this.sendCombatSceneSnapshotToAll(client, input.clientSequence, [event]);
      this.sendCombatSceneEnvelopeToAll(client, event.type === "settlement" ? "settlement" : "timeline_event", input.clientSequence, [event]);
      // Boss 丹药扣减发生在真实 Boss 事务内，成功后必须对齐背包。
      // Boss 核心服务已把刷新帧回传到响应体时，房间层不重复下发，避免同帧重复送达。
      const bossDeliveredRefreshFrames = Array.isArray((payload as { refreshFrames?: unknown }).refreshFrames)
        && (payload as { refreshFrames: unknown[] }).refreshFrames.length > 0;
      if (!bossDeliveredRefreshFrames) {
        this.pushCombatItemConsumedRefresh({
          playerId: auth.playerId,
          commandType,
          itemId: getCommandItemId(input),
          accepted: true,
        });
      }
      if (payload.bossDead && !bossDeliveredRefreshFrames) {
        for (const roomClient of this.clients) {
          const participantId = getActorPublicId(roomClient, this);
          if (participantId) {
            this.pushCombatSettlementRewardRefresh({ playerId: participantId });
          }
        }
      }
      this.lastInputAtMs = Date.now();
    } catch (error) {
      this.sendBossRuntimeCommandReject({
        client,
        input,
        commandType,
        reason: "persist_failed",
        runtimeSource: "boss_core_service",
        message: error instanceof Error ? error.message : "BossRoom 执行真实 Boss 事务失败。",
      });
    }
    return true;
  }

  private async handleCombatMovementInput(client: Client, input: RealtimeClientInput) {
    if (await this.tryHandleSoloRuntimeMovement(client, input)) {
      return;
    }

    if (await this.tryHandlePvpRuntimeMovement(client, input)) {
      return;
    }

    if (this.battleMode === "party") {
      recordRealtimeRejected("unsupported_input", this.roomId);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "unsupported_input",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          migrationNote: "组队战暂未开放站位移动，客户端不得回退旧 move fallback。",
        },
      }));
      return;
    }

    const entity = this.state.entities.get(client.sessionId);
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

    const payload = input.payload as Partial<CombatMovementPayload> | null;
    const to = {
      x: Number(payload?.x),
      y: Number(payload?.y),
    };
    const ruleset = getBattleRuleset(this.battleMode);
    const decision = decideBattleMovement({
      ruleset,
      from: {
        x: entity.x,
        y: entity.y,
      },
      to,
    });

    if (decision.accepted) {
      entity.velocityX = decision.position.x - entity.x;
      entity.velocityY = decision.position.y - entity.y;
      entity.x = decision.position.x;
      entity.y = decision.position.y;
      entity.updatedAt = Date.now();
      this.state.snapshotVersion += 1;
      this.lastInputAtMs = Date.now();
    }
    if (!decision.accepted) {
      recordRealtimeRejected(decision.reason === "unsupported" ? "unsupported_input" : decision.reason, this.roomId);
    }

    client.send("ack", createRealtimeInputAck({
      accepted: decision.accepted,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: decision.reason === "unsupported" ? "unsupported_input" : decision.reason,
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        x: entity.x,
        y: entity.y,
        ruleset,
      },
    }));
    this.sendCombatSceneSnapshot(client, input.clientSequence, decision.accepted
      ? [{
        type: "movement_ack",
        actorId: entity.id,
        x: entity.x,
        y: entity.y,
      }]
      : []);
  }

  private getCombatRuntimeContext(client: Client) {
    const auth = this.authBySessionId.get(client.sessionId);
    const entity = this.state.entities.get(client.sessionId);
    const playerId = auth?.playerId || entity?.id || client.sessionId;
    const combatId = auth?.joinOptions.combatId || this.combatId || "";
    return {
      playerId,
      combatId,
    };
  }

  private sendSoloRuntimeRejectAck(params: {
    client: Client;
    input: RealtimeClientInput;
    acceptedSequence: number;
    reason: RealtimeInputRejectReason;
    message?: string;
  }) {
    recordRealtimeRejected(params.reason, this.roomId);
    if (params.reason === "persist_failed") {
      recordGameServerRoomPersistFailure(this.getObservedRoomId(), "solo_runtime_rejected");
    }
    const hydrated = this.runtimeBySessionId.get(params.client.sessionId);
    const hydratedState = hydrated?.authoritativeState && hydrated.source !== "fallback"
      ? hydrated.authoritativeState
      : {};
    params.client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: params.input.inputType,
      acceptedSequence: params.input.clientSequence,
      reason: params.reason,
      serverTick: this.state.serverTick,
      authoritativeState: {
        ...hydratedState,
        mode: this.battleMode,
        ruleset: getBattleRuleset(this.battleMode),
        runtimeSource: hydrated?.source || "pending_combat",
        acceptedClientSequence: params.acceptedSequence,
        message: params.message || null,
      },
    }));
  }

  private logSoloRuntimeMissing(params: {
    client: Client;
    input: RealtimeClientInput;
    playerId: string;
    combatId: string;
    commandType: BattleCommandType | "movement";
    reason: string;
    error?: unknown;
  }) {
    const hydrated = this.runtimeBySessionId.get(params.client.sessionId);
    console.warn("[game-server] solo combat realtime input rejected without pending runtime", {
      logCategory: "game-server.room.realtime_protocol_error",
      roomId: this.getObservedRoomId(),
      roomKind: this.roomKind,
      mapId: this.state.mapId,
      shardId: this.state.shardId,
      battleMode: this.battleMode,
      combatId: params.combatId || null,
      playerId: params.playerId,
      commandType: params.commandType,
      inputType: params.input.inputType,
      clientSequence: params.input.clientSequence,
      clientSceneTick: params.input.clientSceneTick,
      actionId: params.input.actionId,
      runtimeSourceForClient: hydrated?.source || "none",
      hasHydratedState: Boolean(hydrated?.authoritativeState?.state),
      reason: params.reason,
      error: params.error instanceof Error ? params.error.message : params.error,
    });
  }

  private async tryHandleSoloRuntimeCommand(
    client: Client,
    input: RealtimeClientInput,
    commandType: BattleCommandType,
  ) {
    if (this.battleMode !== "solo") {
      return false;
    }
    if (!isSoloRuntimeCommandType(commandType)) {
      return false;
    }

    const { playerId, combatId } = this.getCombatRuntimeContext(client);
    if (!combatId) {
      this.logSoloRuntimeMissing({
        client,
        input,
        playerId,
        combatId,
        commandType,
        reason: "missing_combat_id",
      });
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        message: "战斗会话参数缺失，请重新进入战斗",
      });
      return true;
    }
    let pendingCombat = getPendingCombatSession(playerId, combatId);
    if (!pendingCombat) {
      await this.refreshRuntimeForClient(client).catch((error) => {
        this.logSoloRuntimeMissing({
          client,
          input,
          playerId,
          combatId,
          commandType,
          reason: "runtime_refresh_failed",
          error,
        });
      });
      pendingCombat = getPendingCombatSession(playerId, combatId);
    }
    if (!pendingCombat) {
      this.logSoloRuntimeMissing({
        client,
        input,
        playerId,
        combatId,
        commandType,
        reason: "pending_runtime_missing",
      });
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        message: "战斗会话不存在或已失效，请刷新后重新进入战斗",
      });
      return true;
    }

    const lastAcceptedClientSequence = pendingCombat.lastAcceptedClientSequence || 0;
    if (input.clientSequence <= lastAcceptedClientSequence) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "already_processed",
        message: "动作序列已处理",
      });
      return true;
    }
    if (input.clientSequence > lastAcceptedClientSequence + 1) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "动作序号跳帧，请等待上一帧确认后再继续出手",
      });
      return true;
    }

    const serverSceneTick = pendingCombat.sceneSnapshot?.tick || 0;
    if (isSoloRuntimeClientSceneTickStale(input.clientSceneTick, serverSceneTick)) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "战斗状态已更新，请等待场景同步后再出手",
      });
      return true;
    }

    if (!tryAcquirePendingCombatSessionLock(playerId, combatId)) {
      this.sendSoloRuntimeRejectAck({
        client,
        input,
        acceptedSequence: lastAcceptedClientSequence,
        reason: "stale_state",
        message: "战斗操作处理中，请稍后再试",
      });
      return true;
    }

    try {
      const lockedCombat = getPendingCombatSession(playerId, combatId);
      if (!lockedCombat) {
        this.sendSoloRuntimeRejectAck({
          client,
          input,
          acceptedSequence: lastAcceptedClientSequence,
          reason: "entity_missing",
          message: "战斗会话不存在或已失效",
        });
        return true;
      }

      const action: "skill" | "item" | "flee" | "surrender" = commandType === "basicAttack" ? "skill" : commandType;
      const skillId = commandType === "basicAttack" ? BASIC_ATTACK_SKILL_ID : getCommandSkillId(input);
      const result = await performSoloCombatActionTransaction({
        playerId,
        combatId,
        session: lockedCombat,
        action,
        skillId,
        itemId: getCommandItemId(input),
        clientSequence: input.clientSequence,
      });
      if (!result.success && result.acknowledgeSequence) {
        lockedCombat.lastAcceptedClientSequence = input.clientSequence;
      }

      await this.refreshRuntimeForAllClients();
      const nextCombat = getPendingCombatSession(playerId, combatId) || lockedCombat;
      const routeData = result.success
        ? result.data
        : result.data || buildSoloCombatRouteData({
          runtimeId: combatId,
          playerId,
          session: nextCombat,
        });
      const acceptedSequence = result.success || result.acknowledgeSequence
        ? input.clientSequence
        : lastAcceptedClientSequence;
      const timelineEvent: CombatSceneEvent = {
        type: "timeline_event",
        actorId: playerId,
        commandType,
        targetId: getTargetId(input) || null,
        occurredAt: Date.now(),
      };
      const routeState = routeData.state;
      const settlementIntent = result.success && routeState && routeState.status !== "ongoing"
        ? createBattleSettlementIntent({
          battleId: combatId,
          mode: "solo",
          winnerId: routeState.status === "player_win" ? playerId : routeState.enemy.id,
          loserId: routeState.status === "enemy_win" ? playerId : routeState.enemy.id,
          reason: commandType === "surrender" ? "surrender" : commandType === "flee" ? "abort" : "victory",
          occurredAt: Date.now(),
        })
        : null;

      client.send("ack", createRealtimeInputAck({
        accepted: result.success,
        inputType: input.inputType,
        acceptedSequence,
        reason: result.success ? undefined : mapSoloRuntimeErrorToRejectReason(result.error),
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          runtimeSource: "pending_combat",
          commandType,
          battleView: routeData.battleView,
          battleRuntime: routeData.battleRuntime,
          sceneSnapshot: routeData.sceneSnapshot,
          state: routeData.state,
          settlement: settlementIntent,
          settlementIntent,
          message: result.success ? null : result.error,
        },
      }));

      const settlementEvent: CombatSceneEvent | null = settlementIntent
        ? {
          type: "settlement",
          intent: settlementIntent,
          persistence: null,
        }
        : null;

      this.sendCombatSceneSnapshotToAll(client, acceptedSequence, [
        {
          type: "command_ack",
          actorId: playerId,
          commandType,
          targetId: getTargetId(input) || null,
        },
        timelineEvent,
        ...(settlementEvent ? [settlementEvent] : []),
      ]);
      this.sendCombatSceneEnvelopeToAll(client, "timeline_event", acceptedSequence, [timelineEvent]);
      if (settlementEvent) {
        this.sendCombatSceneEnvelopeToAll(client, "settlement", acceptedSequence, [settlementEvent]);
      }
      // 丹药落账后必须让客户端看到背包变化，禁止只回 ACK。
      this.pushCombatItemConsumedRefresh({
        playerId,
        commandType,
        itemId: getCommandItemId(input),
        accepted: result.success,
      });
      if (settlementIntent) {
        this.pushCombatSettlementRewardRefresh({ playerId });
      }
      this.lastInputAtMs = Date.now();
      return true;
    } finally {
      releasePendingCombatSessionLock(playerId, combatId);
    }
  }

  private async handleCombatCommandInput(client: Client, input: RealtimeClientInput) {
    const actorId = getActorPublicId(client, this);
    const commandType = normalizeBattleCommandType(input);
    if (!commandType) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        serverTick: this.state.serverTick,
      }));
      return;
    }

    if (await this.tryHandlePartyRuntimeTimeoutAdvance(client, input, commandType)) {
      return;
    }

    if (await this.tryHandlePartyRuntimeCommand(client, input, commandType)) {
      return;
    }

    if (await this.tryHandleBossRuntimeCommandBoundary(client, input, commandType)) {
      return;
    }

    const ruleset = getBattleRuleset(this.battleMode);
    const targetId = getTargetId(input);
    const actorEntity = this.state.entities.get(client.sessionId);
    const targetEntity = targetId
      ? [...this.state.entities.values()].find((entity) => entity.id === targetId)
      : null;
    const distance = actorEntity && targetEntity
      ? calculateBattleDistance(
        { x: actorEntity.x, y: actorEntity.y },
        { x: targetEntity.x, y: targetEntity.y },
      )
      : undefined;
    const decision = decideCombatCommand({
      actorId,
      targetId,
      commandType,
      nowMs: Date.now(),
      ruleset,
      distance,
    });

    if (!decision.accepted) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: mapBattleRejectReason(decision.reason),
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          ruleset,
        },
      }));
      return;
    }

    if (await this.tryHandlePvpRuntimeCommand(client, input, commandType)) {
      return;
    }

    const timeoutDecision = this.battleMode === "pvp"
      ? this.getCurrentTimeoutDecision()
      : null;
    if (commandType === "timeoutAdvance" && timeoutDecision?.shouldAdvance !== true) {
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: this.battleMode === "pvp" ? "stale_state" : "unsupported_input",
        serverTick: this.state.serverTick,
        authoritativeState: {
          mode: this.battleMode,
          ruleset,
          timeoutDecision,
        },
      }));
      return;
    }

    if (await this.tryHandleSoloRuntimeCommand(client, input, commandType)) {
      return;
    }

    this.lastInputAtMs = Date.now();
    const damageIntent = commandType === "basicAttack" || commandType === "skill"
      ? calculateBattleDamage({
        attack: 10,
        defense: 5,
        multiplier: commandType === "skill" ? 1.25 : 1,
      })
      : null;
    const settlementJob = commandType === "surrender" || commandType === "timeoutAdvance" || commandType === "flee"
      ? this.createSettlementJob({
        actorId,
        targetId: targetId || null,
        reason: commandType === "timeoutAdvance" ? "timeout" : commandType === "flee" ? "abort" : "surrender",
        surrendered: commandType === "surrender",
        defeated: commandType !== "flee",
      })
      : null;
    const settlementIntent = settlementJob?.settlementIntent || null;
    const rewardIntent = settlementJob?.rewardIntent || null;
    const dropIntent = settlementJob?.dropIntent || null;
    const deathPenaltyIntent = settlementJob?.deathPenaltyIntent || null;
    const settlementPersistence = settlementJob
      ? await this.persistSettlementJob(settlementJob)
      : null;
    await this.refreshRuntimeForAllClients();
    const timelineEvent: CombatSceneEvent = {
      type: "timeline_event",
      actorId,
      commandType,
      targetId: targetId || null,
      occurredAt: this.lastInputAtMs,
    };
    const settlementEvent: CombatSceneEvent | null = settlementIntent
      ? {
        type: "settlement",
        intent: settlementIntent,
        persistence: settlementPersistence,
      }
      : null;

    client.send("ack", createRealtimeInputAck({
      accepted: true,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      serverTick: this.state.serverTick,
      authoritativeState: {
        mode: this.battleMode,
        commandType,
        targetId: targetId || null,
        ruleset,
        damageIntent,
        settlementIntent,
        rewardIntent,
        dropIntent,
        deathPenaltyIntent,
        settlementPersistence,
        timeoutDecision,
      },
    }));
    this.sendCombatSceneSnapshotToAll(client, input.clientSequence, [
      {
        type: "command_ack",
        actorId,
        commandType,
        targetId: targetId || null,
      },
      timelineEvent,
      ...(settlementIntent
        ? [{
          type: "settlement_intent" as const,
          intent: settlementIntent,
        }]
        : []),
    ]);
    this.sendCombatSceneEnvelopeToAll(client, "timeline_event", input.clientSequence, [timelineEvent]);
    if (settlementEvent) {
      this.sendCombatSceneEnvelopeToAll(client, "settlement", input.clientSequence, [settlementEvent]);
    }
  }
}
