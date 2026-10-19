import type { Client } from "colyseus";
import {
  createRealtimeInputAck,
  type JoinRoomOptions,
  type RealtimeClientInput,
  type SocialPresenceEnvelope,
  type SocialPresenceEvent,
  type SocialPresencePlayer,
} from "@immortality/shared-protocol";
import {
  type SectPresenceEvent,
  type SectPresenceMemberView,
  type SocialPresenceEnvelopeWithSect,
} from "@immortality/shared-protocol/sect-presence";
import type { GameRoomAuthContext } from "../auth";
import { flushRepairRefreshForClient, seedRepairRefreshDigestForJoin } from "../repair-refresh-bridge";
import { BaseGameRoom } from "./base-room";
import {
  broadcastNearbyChatEcho,
  NEARBY_CHAT_PROGRESS_REASON,
  pushNearbyActivityProgressRefresh,
  readNearbyChatEchoDedupeKeys,
  releaseNearbyChatEchoSequence,
  type NearbyChatEchoRoomAdapter,
} from "./nearby-chat-echo";
import {
  collectStaleSectPresenceSessionIds,
  createSectPresenceEvent,
  isSameSect,
  normalizeSectPresenceCommandPayload,
  resolveInitialAtHome,
  shouldDeliverPresence,
  toSectPresenceMember,
  type SectPresenceContextFields,
} from "./social-sect-presence";
import {
  recordRealtimeRejected,
  recordSocialRoomMessage,
  recordSocialRoomReject,
} from "../metrics";

interface SocialClientContext extends SectPresenceContextFields {
  sessionId: string;
  playerId: string;
  name: string;
  mapId: string;
  shardId: string;
  partyId: string | null;
  sectId: string | null;
  joinedAt: number;
  updatedAt: number;
}

/**
 * social_event(10202) / social_snapshot(10201) 实际下发信封。
 *
 * 在通用 presence 事件之外额外携带宗门 presence 列表，宗门页才能直接渲染
 * "谁在线 / 谁在驻地"，不需要客户端自己反推。
 */
type SocialRoomEnvelope = SocialPresenceEnvelopeWithSect & {
  sectPresence: SectPresenceMemberView[];
};

function normalizeNullableId(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toSocialPresencePlayer(context: SocialClientContext): SocialPresencePlayer {
  return {
    sessionId: context.sessionId,
    playerId: context.playerId,
    name: context.name,
    mapId: context.mapId,
    shardId: context.shardId,
    partyId: context.partyId,
    sectId: context.sectId,
    joinedAt: context.joinedAt,
    updatedAt: context.updatedAt,
  };
}

function normalizeNearbyMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const message = String((payload as { message?: unknown }).message || "").trim();
  if (!message) {
    return "";
  }
  return message.slice(0, 200);
}

function normalizePartyCommand(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const command = String((payload as { command?: unknown }).command || "").trim();
  if (command === "accept" || command === "reject" || command === "leave" || command === "kick") {
    return command;
  }
  return "";
}

export class SocialRoom extends BaseGameRoom {
  readonly roomKind = "social";
  private readonly contexts = new Map<string, SocialClientContext>();

  onJoin(client: Client, options: JoinRoomOptions, auth?: GameRoomAuthContext) {
    super.onJoin(client, options, auth);
    const now = Date.now();
    const joinOptions = auth?.joinOptions;
    const entity = this.state.entities.get(client.sessionId);
    if (entity) {
      entity.kind = "social_player";
      entity.updatedAt = now;
    }
    // 进房先挂基线摘要，等 repair 补齐时统一下发，避免"连上了但资产是旧的"。
    seedRepairRefreshDigestForJoin(auth?.playerId || String(options.playerId || client.sessionId));

    const sectId = normalizeNullableId(joinOptions?.sectId || options.sectId);
    const mapId = joinOptions?.mapId || String(options.mapId || "default");
    const context: SocialClientContext = {
      sessionId: client.sessionId,
      playerId: auth?.playerId || String(options.playerId || client.sessionId),
      name: auth?.playerName || String(options.playerId || client.sessionId),
      mapId,
      shardId: joinOptions?.shardId || String(options.shardId || "0"),
      partyId: normalizeNullableId(joinOptions?.partyId || options.partyId),
      sectId,
      joinedAt: now,
      updatedAt: now,
      // 进入宗门 presence 房间即视为进入驻地：宗门页就是驻地视图。
      atHome: resolveInitialAtHome(mapId, sectId),
      presenceUpdatedAt: now,
    };
    this.contexts.set(client.sessionId, context);

    const player = toSocialPresencePlayer(context);
    const sectEvent = createSectPresenceEvent({
      type: "join",
      sectId: context.sectId || "",
      player,
      context,
    });
    this.sendSocialSnapshot(client, null, [
      { type: "presence_join", player },
      ...(sectEvent ? [sectEvent] : []),
    ]);
    this.broadcastSocialEvents(
      [
        { type: "presence_join", player },
        ...(sectEvent ? [sectEvent] : []),
      ],
      client.sessionId,
      (target) => shouldDeliverPresence(target, context),
    );
    // 成员变化必须下发附近频道进度刷新帧（12742 / activity），不能只回 ACK。
    this.pushNearbyActivityRefresh(
      this.collectNearbyPlayerIds(context.mapId, context.shardId),
      NEARBY_CHAT_PROGRESS_REASON.memberChanged,
    );
  }

  /**
   * 附近频道回声 / 进度刷新所需的房间能力。
   *
   * 附近频道的具体边界逻辑全部收敛在 `nearby-chat-echo.ts`，
   * 本房间只提供连接与上下文，避免房间文件越堆越厚。
   */
  private createNearbyChatEchoAdapter(): NearbyChatEchoRoomAdapter {
    return {
      roomId: this.roomId,
      getServerTick: () => this.state.serverTick,
      clients: this.clients,
      getContext: (sessionId) => this.contexts.get(sessionId),
    };
  }

  /** 同图同分片的在线玩家 id（去重），用于附近频道进度刷新帧投递。 */
  private collectNearbyPlayerIds(mapId: string, shardId: string) {
    const playerIds = new Set<string>();
    for (const candidate of this.contexts.values()) {
      if (candidate.mapId === mapId && candidate.shardId === shardId) {
        playerIds.add(candidate.playerId);
      }
    }
    return playerIds;
  }

  private pushNearbyActivityRefresh(playerIds: Iterable<string>, reason: string) {
    pushNearbyActivityProgressRefresh({
      playerIds,
      roomId: this.roomId,
      serverTick: this.state.serverTick,
      reason,
    });
  }

  onLeave(client: Client, code?: number) {
    const context = this.contexts.get(client.sessionId);
    this.contexts.delete(client.sessionId);
    super.onLeave(client, code);
    if (!context) {
      return;
    }
    releaseNearbyChatEchoSequence(context.sessionId);
    const player = toSocialPresencePlayer(context);
    const sectEvent = createSectPresenceEvent({
      type: "leave",
      sectId: context.sectId || "",
      player,
      context: { ...context, atHome: false },
    });
    this.broadcastSocialEvents(
      [
        { type: "presence_leave", player },
        ...(sectEvent ? [sectEvent] : []),
      ],
      undefined,
      (target) => shouldDeliverPresence(target, context),
    );
    this.pushNearbyActivityRefresh(
      this.collectNearbyPlayerIds(context.mapId, context.shardId),
      NEARBY_CHAT_PROGRESS_REASON.memberChanged,
    );
  }

  protected handleRepairInput(client: Client, input: RealtimeClientInput) {
    this.pruneStalePresenceContexts();
    const context = this.contexts.get(client.sessionId) || null;
    if (!context) {
      recordRealtimeRejected("entity_missing", this.roomId);
      recordSocialRoomReject(this.roomId, "entity_missing");
    }
    client.send("ack", createRealtimeInputAck({
      accepted: Boolean(context),
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: context ? undefined : "entity_missing",
      serverTick: this.state.serverTick,
      authoritativeState: context ? this.createAuthoritativeState(context) : undefined,
    }));
    this.sendSocialSnapshot(client, input.clientSequence, [{
      type: "repair",
      player: context ? toSocialPresencePlayer(context) : null,
    }]);
    // 前后台恢复 repair 补齐后补发资产 / 背包 / 进度刷新帧，禁止只回 ACK。
    if (context) {
      flushRepairRefreshForClient({
        client,
        input,
        playerId: context.playerId,
        roomId: this.roomId,
        serverTick: this.state.serverTick,
      });
      // 附近频道：重连后需要一次增量 replay 提示，客户端据此补拉而不是整段重灌。
      this.pushNearbyActivityRefresh([context.playerId], NEARBY_CHAT_PROGRESS_REASON.replay);
    }
  }

  protected handleUnsupportedRealtimeInput(client: Client, input: RealtimeClientInput) {
    if (input.inputType === "nearbyMessage") {
      this.handleNearbyMessageInput(client, input);
      return;
    }
    if (input.inputType === "partyInvite" || input.inputType === "partyCommand") {
      this.handlePartyPresenceInput(client, input);
      return;
    }
    if (input.inputType === "command") {
      this.handleSectPresenceCommand(client, input);
      return;
    }
    super.handleUnsupportedRealtimeInput(client, input);
  }

  /**
   * 宗门 presence 指令：进入 / 离开驻地、任命变化。
   *
   * 铁律：这三类变化必须广播 social_event(10202)，只回 ACK 不广播会让其他
   * 成员的界面停在旧成员列表。任命 / 权限 / 进度变化还需要 12742 progress_refresh
   * （由 Next 侧事务落账后推送），两者缺一不可。
   */
  private handleSectPresenceCommand(client: Client, input: RealtimeClientInput) {
    const context = this.contexts.get(client.sessionId);
    if (!context) {
      recordRealtimeRejected("entity_missing", this.roomId);
      recordSocialRoomReject(this.roomId, "entity_missing");
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "entity_missing",
        serverTick: this.state.serverTick,
      }));
      return;
    }

    const normalized = normalizeSectPresenceCommandPayload(input.payload);
    if (!context.sectId) {
      recordRealtimeRejected("permission_denied", this.roomId);
      recordSocialRoomReject(this.roomId, "permission_denied");
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "permission_denied",
        serverTick: this.state.serverTick,
        authoritativeState: this.createAuthoritativeState(context),
      }));
      return;
    }

    if (!normalized) {
      recordRealtimeRejected("invalid_payload", this.roomId);
      recordSocialRoomReject(this.roomId, "invalid_payload");
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason: "invalid_payload",
        serverTick: this.state.serverTick,
        authoritativeState: this.createAuthoritativeState(context),
      }));
      return;
    }

    const now = Date.now();
    context.updatedAt = now;
    context.presenceUpdatedAt = now;
    this.state.snapshotVersion += 1;
    recordSocialRoomMessage(this.roomId);

    let event: SectPresenceEvent | null = null;
    if (normalized.command === "sect_presence_home_enter") {
      context.atHome = true;
      event = createSectPresenceEvent({
        type: "home_changed",
        sectId: context.sectId,
        player: toSocialPresencePlayer(context),
        context,
      });
    } else if (normalized.command === "sect_presence_home_leave") {
      context.atHome = false;
      event = createSectPresenceEvent({
        type: "home_changed",
        sectId: context.sectId,
        player: toSocialPresencePlayer(context),
        context,
      });
    } else {
      const targetPlayerId = normalized.targetPlayerId || context.playerId;
      const targetContext = Array.from(this.contexts.values())
        .find((candidate) => candidate.playerId === targetPlayerId && candidate.sectId === context.sectId);
      event = createSectPresenceEvent({
        type: "role_changed",
        sectId: context.sectId,
        player: targetContext
          ? toSocialPresencePlayer(targetContext)
          : {
            sessionId: "",
            playerId: targetPlayerId,
            name: targetPlayerId,
            mapId: context.mapId,
            shardId: context.shardId,
            partyId: null,
            sectId: context.sectId,
            joinedAt: 0,
            updatedAt: now,
          },
        context,
        roleKey: normalized.roleKey,
        actorPlayerId: context.playerId,
      });
    }

    client.send("ack", createRealtimeInputAck({
      accepted: true,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      serverTick: this.state.serverTick,
      authoritativeState: this.createAuthoritativeState(context),
    }));
    this.sendSocialSnapshot(client, input.clientSequence, event ? [event] : []);
    if (event) {
      const sectId = context.sectId;
      this.broadcastSocialEvents([event], client.sessionId, (target) => (
        isSameSect(target.sectId, sectId)
      ));
    }
  }

  private handleNearbyMessageInput(client: Client, input: RealtimeClientInput) {
    const context = this.contexts.get(client.sessionId);
    const message = normalizeNearbyMessage(input.payload);
    if (!context || !message) {
      const reason = context ? "invalid_payload" : "entity_missing";
      recordRealtimeRejected(reason, this.roomId);
      recordSocialRoomReject(this.roomId, reason);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason,
        serverTick: this.state.serverTick,
      }));
      return;
    }

    // 幂等键由发送方在核心 API `POST /api/game/chat/nearby` 成功后回传；
    // 房间本身不生成 id、不写库 —— 持久化唯一入口始终是核心 API。
    const { messageId, dedupeKey } = readNearbyChatEchoDedupeKeys(input.payload);
    context.updatedAt = Date.now();
    recordSocialRoomMessage(this.roomId);
    this.state.snapshotVersion += 1;
    client.send("ack", createRealtimeInputAck({
      accepted: true,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      serverTick: this.state.serverTick,
      authoritativeState: this.createAuthoritativeState(context),
    }));

    // 附近消息只走回声帧广播：不再额外广播 social_event.nearby_message，
    // 否则同一条消息会在客户端出现两帧，破坏「只渲染一次」。
    broadcastNearbyChatEcho(this.createNearbyChatEchoAdapter(), {
      sessionId: client.sessionId,
      mapId: context.mapId,
      shardId: context.shardId,
      senderPlayerId: context.playerId,
      senderName: context.name,
      content: message,
      messageId,
      dedupeKey,
    });
    this.pushNearbyActivityRefresh(
      this.collectNearbyPlayerIds(context.mapId, context.shardId),
      NEARBY_CHAT_PROGRESS_REASON.message,
    );
  }

  private handlePartyPresenceInput(client: Client, input: RealtimeClientInput) {
    const context = this.contexts.get(client.sessionId);
    const command = input.inputType === "partyCommand"
      ? normalizePartyCommand(input.payload)
      : "invite";
    if (!context || !command) {
      const reason = context ? "invalid_payload" : "entity_missing";
      recordRealtimeRejected(reason, this.roomId);
      recordSocialRoomReject(this.roomId, reason);
      client.send("ack", createRealtimeInputAck({
        accepted: false,
        inputType: input.inputType,
        acceptedSequence: input.clientSequence,
        reason,
        serverTick: this.state.serverTick,
      }));
      return;
    }

    context.updatedAt = Date.now();
    recordRealtimeRejected("unsupported_input", this.roomId);
    recordSocialRoomReject(this.roomId, "unsupported_input");
    this.state.snapshotVersion += 1;
    client.send("ack", createRealtimeInputAck({
      accepted: false,
      inputType: input.inputType,
      acceptedSequence: input.clientSequence,
      reason: "unsupported_input",
      serverTick: this.state.serverTick,
      authoritativeState: {
        ...this.createAuthoritativeState(context),
        migrationNote: "party business actions still use low-frequency core APIs",
      },
    }));
    this.sendSocialSnapshot(client, input.clientSequence, [{
      type: "party_command_ack",
      player: toSocialPresencePlayer(context),
      command,
    }]);
  }

  /** 重连 / repair 前清掉已断线但残留的 presence，避免幽灵在线成员。 */
  private pruneStalePresenceContexts() {
    const liveSessionIds = new Set<string>();
    for (const client of this.clients) {
      liveSessionIds.add(client.sessionId);
    }
    for (const sessionId of collectStaleSectPresenceSessionIds(this.contexts, liveSessionIds)) {
      this.contexts.delete(sessionId);
    }
  }

  /** 当前连接里同宗门的 presence 列表，供宗门页直接渲染。 */
  private createSectPresenceList(context: SocialClientContext): SectPresenceMemberView[] {
    if (!context.sectId) {
      return [];
    }
    const sectId = context.sectId;
    return Array.from(this.contexts.values())
      .filter((candidate) => isSameSect(candidate.sectId, sectId))
      .map((candidate) => toSectPresenceMember(toSocialPresencePlayer(candidate), candidate));
  }

  private createAuthoritativeState(context: SocialClientContext): SocialPresenceEnvelope["authoritativeState"] {
    const self = toSocialPresencePlayer(context);
    const nearbyPlayers: SocialPresencePlayer[] = [];
    const partyMembers: SocialPresencePlayer[] = [];
    const sectMembers: SocialPresencePlayer[] = [];

    for (const candidate of this.contexts.values()) {
      if (candidate.mapId === context.mapId && candidate.shardId === context.shardId) {
        nearbyPlayers.push(toSocialPresencePlayer(candidate));
      }
      if (context.partyId && candidate.partyId === context.partyId) {
        partyMembers.push(toSocialPresencePlayer(candidate));
      }
      if (context.sectId && candidate.sectId === context.sectId) {
        sectMembers.push(toSocialPresencePlayer(candidate));
      }
    }

    return {
      self,
      mapId: context.mapId,
      shardId: context.shardId,
      nearbyPlayers,
      partyMembers,
      sectMembers,
    };
  }

  private createSocialEnvelope(
    context: SocialClientContext | null,
    acceptedSequence: number | null,
    events: Array<SocialPresenceEvent | SectPresenceEvent>,
  ): SocialRoomEnvelope {
    const base: SocialPresenceEnvelope = {
      type: "social_snapshot",
      serverTick: this.state.serverTick,
      roomId: this.roomId,
      snapshotVersion: this.state.snapshotVersion,
      acceptedSequence,
      authoritativeState: context
        ? this.createAuthoritativeState(context)
        : {
          self: null,
          mapId: this.state.mapId,
          shardId: this.state.shardId,
          nearbyPlayers: [],
          partyMembers: [],
          sectMembers: [],
        },
      events: [] as SocialPresenceEvent[],
    };
    return {
      ...base,
      events,
      sectPresence: context ? this.createSectPresenceList(context) : [],
    };
  }

  private sendSocialSnapshot(
    client: Client,
    acceptedSequence: number | null,
    events: Array<SocialPresenceEvent | SectPresenceEvent> = [],
  ) {
    const context = this.contexts.get(client.sessionId) || null;
    client.send("social_snapshot", this.createSocialEnvelope(context, acceptedSequence, events));
  }

  private broadcastSocialEvents(
    events: Array<SocialPresenceEvent | SectPresenceEvent>,
    skipSessionId?: string,
    filter?: (context: SocialClientContext) => boolean,
  ) {
    for (const client of this.clients) {
      if (skipSessionId && client.sessionId === skipSessionId) {
        continue;
      }
      const context = this.contexts.get(client.sessionId);
      if (!context || (filter && !filter(context))) {
        continue;
      }
      client.send("social_event", this.createSocialEnvelope(context, null, events));
    }
  }
}
