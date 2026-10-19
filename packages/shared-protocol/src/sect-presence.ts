import type {
  SocialPresenceEnvelope,
  SocialPresenceEvent,
  SocialPresencePlayer,
} from "./index";

/**
 * 宗门 presence 扩展契约。
 *
 * 背景：`SocialPresenceEvent` 是通用社交帧，只有 presence_join / presence_leave /
 * nearby_message 等语义，无法表达"宗门驻地在场 / 离开驻地 / 任命变化"。
 * 宗门页既要知道"谁在线"，也要知道"谁在驻地""谁的职阶变了"，因此这里在
 * 不改动通用帧语义的前提下扩展出宗门专属 presence 事件。
 *
 * 规则：
 * - 宗门 presence 事件仍然挂在 `social_event`(10202) 帧里下发，只是 events 数组被
 *   扩展为 `SocialPresenceEvent | SectPresenceEvent`，旧客户端忽略未知 type 即可。
 * - 资产 / 背包 / 进度变更仍然走 10302 / 10510 / 12742 强制推送帧，不能只靠本帧。
 */

/** 宗门 presence 房间的 join 上下文，保证同宗门成员落在同一个房间分片。 */
export const SECT_PRESENCE_ROOM_MAP_PREFIX = "sect";
export const SECT_PRESENCE_ROOM_SHARD_ID = "sect";

export const SECT_PRESENCE_STATES = [
  "offline",
  "online",
  "away",
  "at_home",
] as const;

export type SectPresenceState = (typeof SECT_PRESENCE_STATES)[number];

export const SECT_PRESENCE_COMMANDS = [
  "sect_presence_home_enter",
  "sect_presence_home_leave",
  "sect_presence_role_changed",
] as const;

export type SectPresenceCommand = (typeof SECT_PRESENCE_COMMANDS)[number];

export const SECT_PRESENCE_EVENT_TYPES = [
  "sect_presence_join",
  "sect_presence_leave",
  "sect_presence_home_changed",
  "sect_presence_role_changed",
] as const;

export type SectPresenceEventType = (typeof SECT_PRESENCE_EVENT_TYPES)[number];

export interface SectPresenceMemberView {
  playerId: string;
  name: string;
  sectId: string;
  presenceState: SectPresenceState;
  atHome: boolean;
  mapId: string;
  shardId: string;
  updatedAt: number;
}

export type SectPresenceEvent =
  | {
    type: "sect_presence_join";
    sectId: string;
    player: SocialPresencePlayer;
    state: SectPresenceState;
    atHome: boolean;
  }
  | {
    type: "sect_presence_leave";
    sectId: string;
    player: SocialPresencePlayer;
    state: "offline";
    atHome: false;
  }
  | {
    type: "sect_presence_home_changed";
    sectId: string;
    player: SocialPresencePlayer;
    atHome: boolean;
  }
  | {
    type: "sect_presence_role_changed";
    sectId: string;
    player: SocialPresencePlayer;
    roleKey: string;
    actorPlayerId: string;
  };

/** 携带宗门扩展事件的 social_event 信封。 */
export type SocialPresenceEnvelopeWithSect = Omit<SocialPresenceEnvelope, "events"> & {
  events: Array<SocialPresenceEvent | SectPresenceEvent>;
};

const sectPresenceCommandSet = new Set<string>(SECT_PRESENCE_COMMANDS);
const sectPresenceEventTypeSet = new Set<string>(SECT_PRESENCE_EVENT_TYPES);
const sectPresenceStateSet = new Set<string>(SECT_PRESENCE_STATES);

export function isSectPresenceCommand(value: unknown): value is SectPresenceCommand {
  return typeof value === "string" && sectPresenceCommandSet.has(value);
}

export function isSectPresenceEventType(value: unknown): value is SectPresenceEventType {
  return typeof value === "string" && sectPresenceEventTypeSet.has(value);
}

export function isSectPresenceState(value: unknown): value is SectPresenceState {
  return typeof value === "string" && sectPresenceStateSet.has(value);
}

/** 宗门 presence 房间标识：`sect:<sectId>` / shard `sect`。 */
export function resolveSectPresenceRoomOptions(sectId: string) {
  const normalizedSectId = String(sectId || "").trim();
  return {
    mapId: `${SECT_PRESENCE_ROOM_MAP_PREFIX}:${normalizedSectId}`,
    shardId: SECT_PRESENCE_ROOM_SHARD_ID,
    sectId: normalizedSectId,
  };
}

export function isSectPresenceRoomMapId(mapId: unknown, sectId: string | null | undefined) {
  const normalizedSectId = String(sectId || "").trim();
  if (!normalizedSectId) {
    return false;
  }
  return String(mapId || "").trim() === `${SECT_PRESENCE_ROOM_MAP_PREFIX}:${normalizedSectId}`;
}

export function resolveSectPresenceState(params: {
  connected: boolean;
  atHome: boolean;
}): SectPresenceState {
  if (!params.connected) {
    return "offline";
  }
  return params.atHome ? "at_home" : "away";
}

export function normalizeSectPresenceMember(
  player: SocialPresencePlayer,
  options: { atHome: boolean; connected?: boolean },
): SectPresenceMemberView {
  const sectId = String(player?.sectId || "").trim();
  return {
    playerId: String(player?.playerId || "").trim(),
    name: String(player?.name || "").trim(),
    sectId,
    presenceState: resolveSectPresenceState({
      connected: options.connected ?? true,
      atHome: options.atHome,
    }),
    atHome: options.atHome,
    mapId: String(player?.mapId || "").trim(),
    shardId: String(player?.shardId || "").trim(),
    updatedAt: Number(player?.updatedAt || 0),
  };
}
