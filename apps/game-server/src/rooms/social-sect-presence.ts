import {
  isSectPresenceCommand,
  isSectPresenceRoomMapId,
  normalizeSectPresenceMember,
  type SectPresenceCommand,
  type SectPresenceEvent,
  type SectPresenceMemberView,
  type SectPresenceState,
} from "@immortality/shared-protocol/sect-presence";
import type { SocialPresencePlayer } from "@immortality/shared-protocol";

/**
 * SocialRoom 宗门 presence 侧逻辑。
 *
 * 拆出本文件的原因：SocialRoom 本身已经承担附近 / 组队 presence，
 * 宗门 presence 需要独立的"驻地判定 + 事件构造 + 投递过滤"，混在一起会让
 * 房间类持续膨胀，也不利于 BotClient 场景断言直接复用同一套判定。
 */

export interface SectPresenceContextFields {
  sectId: string | null;
  atHome: boolean;
  presenceUpdatedAt: number;
}

export interface SectPresenceReadContext extends SectPresenceContextFields {
  sessionId: string;
  playerId: string;
  name: string;
  mapId: string;
  shardId: string;
  partyId: string | null;
  joinedAt: number;
  updatedAt: number;
}

export interface NormalizedSectPresenceCommand {
  command: SectPresenceCommand;
  roleKey: string;
  targetPlayerId: string;
}

/** 同宗门。宗门 presence 与所在地图无关，宗门频道是跨地图的。 */
export function isSameSect(a: string | null, b: string | null) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  return Boolean(left) && left === right;
}

/** 同地图同分片。附近频道才需要这个判定。 */
export function isSameMapShard(
  a: { mapId: string; shardId: string },
  b: { mapId: string; shardId: string },
) {
  return a.mapId === b.mapId && a.shardId === b.shardId;
}

/**
 * presence 事件是否应投递给目标连接。
 *
 * 只要目标在"附近 / 同队伍 / 同宗门"任一维度上与该玩家相关就要收到，
 * 否则成员列表会出现"在线但列表里没有"或"跨宗门串线"的问题。
 */
export function shouldDeliverPresence(
  target: SectPresenceReadContext,
  subject: SectPresenceReadContext,
) {
  if (isSameSect(target.sectId, subject.sectId)) {
    return true;
  }
  if (
    target.partyId
    && target.partyId === subject.partyId
  ) {
    return true;
  }
  return isSameMapShard(target, subject);
}

/** 加入宗门 presence 房间即视为进入驻地：宗门页就是驻地视图。 */
export function resolveInitialAtHome(mapId: string, sectId: string | null) {
  return isSectPresenceRoomMapId(mapId, sectId);
}

export function resolvePresenceState(context: SectPresenceContextFields): SectPresenceState {
  if (!context.sectId) {
    return "offline";
  }
  return context.atHome ? "at_home" : "away";
}

export function normalizeSectPresenceCommandPayload(payload: unknown): NormalizedSectPresenceCommand | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as {
    command?: unknown;
    commandType?: unknown;
    roleKey?: unknown;
    targetPlayerId?: unknown;
  };
  const command = isSectPresenceCommand(record.command)
    ? record.command
    : isSectPresenceCommand(record.commandType)
      ? record.commandType
      : null;
  if (!command) {
    return null;
  }
  return {
    command,
    roleKey: String(record.roleKey || "").trim(),
    targetPlayerId: String(record.targetPlayerId || "").trim(),
  };
}

export function toSectPresenceMember(
  player: SocialPresencePlayer,
  context: SectPresenceContextFields,
  options: { connected?: boolean } = {},
): SectPresenceMemberView {
  return normalizeSectPresenceMember(player, {
    atHome: context.atHome,
    ...(options.connected === undefined ? {} : { connected: options.connected }),
  });
}

/**
 * 构造宗门 presence 事件。
 *
 * 上线 / 下线 / 切换驻地 / 任命变化都必须落到 social_event(10202)，
 * 只回 ACK 不广播会让其他成员的界面停在旧成员列表。
 */
export function createSectPresenceEvent(params: {
  type: "join" | "leave" | "home_changed" | "role_changed";
  sectId: string;
  player: SocialPresencePlayer;
  context: SectPresenceContextFields;
  roleKey?: string;
  actorPlayerId?: string;
}): SectPresenceEvent | null {
  const sectId = String(params.sectId || "").trim();
  if (!sectId) {
    return null;
  }
  if (params.type === "join") {
    return {
      type: "sect_presence_join",
      sectId,
      player: params.player,
      state: resolvePresenceState(params.context),
      atHome: params.context.atHome,
    };
  }
  if (params.type === "leave") {
    return {
      type: "sect_presence_leave",
      sectId,
      player: params.player,
      state: "offline",
      atHome: false,
    };
  }
  if (params.type === "home_changed") {
    return {
      type: "sect_presence_home_changed",
      sectId,
      player: params.player,
      atHome: params.context.atHome,
    };
  }
  if (params.type === "role_changed") {
    return {
      type: "sect_presence_role_changed",
      sectId,
      player: params.player,
      roleKey: String(params.roleKey || "").trim(),
      actorPlayerId: String(params.actorPlayerId || "").trim(),
    };
  }
  return null;
}

/**
 * 重连 / repair 前清理残留 presence。
 *
 * 断线重连时旧 session 的 context 可能因为异常路径残留下来，
 * 不清掉会让成员列表里出现"实际已离线但仍显示在线"的幽灵成员。
 */
export function collectStaleSectPresenceSessionIds(
  contexts: ReadonlyMap<string, SectPresenceReadContext>,
  liveSessionIds: ReadonlySet<string>,
) {
  const stale: string[] = [];
  for (const sessionId of contexts.keys()) {
    if (!liveSessionIds.has(sessionId)) {
      stale.push(sessionId);
    }
  }
  return stale;
}
