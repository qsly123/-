import type { RealtimeOutputType } from "./index";

/**
 * 官样组序（数字 opcode）注册表。
 *
 * 段位约定：
 * - 100xx：场景 / 地图实时帧
 * - 101xx：战斗帧
 * - 102xx：社交帧
 * - 103xx：背包域刷新帧
 * - 105xx：资产域刷新帧
 * - 10999：错误帧
 * - 127xx：进度域刷新帧
 *
 * 规则：
 * - 数字 opcode 与字符串帧类型必须双向一一映射，不允许一个号对应两种帧。
 * - 新增帧类型必须同时登记 opcode，否则运行时解析会落到 null。
 * - 资产 / 背包 / 进度这类"状态变更刷新帧"是强制推送帧：
 *   服务端只要发生了资产或进度入库变更，就必须下发对应帧，不允许只回 ACK。
 */

export const REALTIME_OPCODE_BY_OUTPUT_TYPE = {
  scene_snapshot: 10001,
  sector_snapshot: 10002,
  sector_delta: 10003,
  entity_enter: 10004,
  entity_leave: 10005,
  correction: 10006,
  state_correction: 10007,
  repair: 10008,
  timeline_event: 10101,
  damage_event: 10102,
  settlement: 10103,
  social_snapshot: 10201,
  social_event: 10202,
  inventory_snapshot: 10301,
  inventory_refresh: 10302,
  asset_snapshot: 10501,
  asset_refresh: 10510,
  error: 10999,
  progress_snapshot: 12701,
  progress_refresh: 12742,
} as const satisfies Record<string, number>;

export type RealtimeOutputOpcode =
  (typeof REALTIME_OPCODE_BY_OUTPUT_TYPE)[keyof typeof REALTIME_OPCODE_BY_OUTPUT_TYPE];

const OUTPUT_TYPE_BY_OPCODE: Map<number, RealtimeOutputType> = new Map(
  (Object.entries(REALTIME_OPCODE_BY_OUTPUT_TYPE) as Array<[RealtimeOutputType, number]>)
    .map(([type, opcode]) => [opcode, type] as [number, RealtimeOutputType]),
);

/** 状态变更强制推送帧：发生对应入库变更时必须下发，不能只回 ACK。 */
export const STATE_REFRESH_OPCODES = [
  REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh,
  REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh,
  REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh,
] as const;

export const STATE_REFRESH_OUTPUT_TYPES = [
  "inventory_refresh",
  "asset_refresh",
  "progress_refresh",
] as const satisfies readonly RealtimeOutputType[];

export type StateRefreshOutputType = (typeof STATE_REFRESH_OUTPUT_TYPES)[number];

export type StateRefreshOpcode = (typeof STATE_REFRESH_OPCODES)[number];

export type ProgressRefreshScope =
  | "cultivation"
  | "realm"
  | "quest"
  | "sect"
  | "mail"
  | "checkin"
  | "activity"
  | "fortune"
  | "gongfa";

export interface InventoryRefreshPayload {
  reason: string;
  changedItemIds: string[];
  version: number;
  full: boolean;
}

export interface AssetRefreshPayload {
  reason: string;
  currencies: Record<string, number>;
  version: number;
  full: boolean;
}

export interface ProgressRefreshPayload {
  reason: string;
  scopes: ProgressRefreshScope[];
  version: number;
  full: boolean;
}

export interface StateRefreshEnvelope<TPayload> {
  opcode: number;
  type: RealtimeOutputType;
  playerId: string;
  roomId: string;
  serverTick: number;
  sentAt: number;
  payload: TPayload;
}

export type AnyStateRefreshEnvelope =
  | StateRefreshEnvelope<InventoryRefreshPayload>
  | StateRefreshEnvelope<AssetRefreshPayload>
  | StateRefreshEnvelope<ProgressRefreshPayload>;

export interface StateRefreshFrameGroupParams {
  playerId: string;
  roomId?: string;
  serverTick?: number;
  reason: string;
  inventory?: {
    changedItemIds?: string[];
    version?: number;
    full?: boolean;
  };
  asset?: {
    currencies?: Record<string, number>;
    version?: number;
    full?: boolean;
  };
  progress?: {
    scopes?: ProgressRefreshScope[];
    version?: number;
    full?: boolean;
  };
}

export function resolveRealtimeOpcode(type: RealtimeOutputType): number | null {
  const opcode = (REALTIME_OPCODE_BY_OUTPUT_TYPE as Record<string, number | undefined>)[type];
  return typeof opcode === "number" ? opcode : null;
}

export function resolveRealtimeOutputType(opcode: unknown): RealtimeOutputType | null {
  if (typeof opcode !== "number" || !Number.isSafeInteger(opcode)) {
    return null;
  }
  return OUTPUT_TYPE_BY_OPCODE.get(opcode) ?? null;
}

export function isKnownRealtimeOpcode(opcode: unknown): opcode is RealtimeOutputOpcode {
  return resolveRealtimeOutputType(opcode) !== null;
}

export function isStateRefreshOpcode(opcode: unknown): opcode is StateRefreshOpcode {
  return typeof opcode === "number" && (STATE_REFRESH_OPCODES as readonly number[]).includes(opcode);
}

export function isStateRefreshOutputType(type: unknown): type is StateRefreshOutputType {
  return (STATE_REFRESH_OUTPUT_TYPES as readonly string[]).includes(String(type));
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeCurrencyMap(values: Record<string, number> | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  if (!values || typeof values !== "object") {
    return result;
  }
  for (const [key, rawValue] of Object.entries(values)) {
    const normalizedKey = String(key || "").trim();
    const numberValue = Number(rawValue);
    if (!normalizedKey || !Number.isFinite(numberValue)) {
      continue;
    }
    result[normalizedKey] = numberValue;
  }
  return result;
}

/**
 * 构造"状态变更推送帧组"。
 *
 * 一次业务事务可能同时改动背包、资产和进度，必须一次性生成全部对应帧，
 * 客户端是纯渲染端，漏推任何一个域都会导致界面停在旧值。
 */
export function createStateRefreshFrameGroup(
  params: StateRefreshFrameGroupParams,
): AnyStateRefreshEnvelope[] {
  const serverTick = Number.isFinite(params.serverTick) ? Number(params.serverTick) : 0;
  const roomId = String(params.roomId || "").trim();
  const reason = String(params.reason || "").trim() || "state_changed";
  const sentAt = Date.now();
  const playerId = String(params.playerId || "").trim();
  const frames: AnyStateRefreshEnvelope[] = [];

  if (params.inventory) {
    frames.push({
      opcode: REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh,
      type: "inventory_refresh",
      playerId,
      roomId,
      serverTick,
      sentAt,
      payload: {
        reason,
        changedItemIds: normalizeStringList(params.inventory.changedItemIds),
        version: Number.isFinite(params.inventory.version) ? Number(params.inventory.version) : sentAt,
        full: params.inventory.full === true,
      },
    });
  }

  if (params.asset) {
    frames.push({
      opcode: REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh,
      type: "asset_refresh",
      playerId,
      roomId,
      serverTick,
      sentAt,
      payload: {
        reason,
        currencies: normalizeCurrencyMap(params.asset.currencies),
        version: Number.isFinite(params.asset.version) ? Number(params.asset.version) : sentAt,
        full: params.asset.full === true,
      },
    });
  }

  if (params.progress) {
    frames.push({
      opcode: REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh,
      type: "progress_refresh",
      playerId,
      roomId,
      serverTick,
      sentAt,
      payload: {
        reason,
        scopes: normalizeStringList(params.progress.scopes) as ProgressRefreshScope[],
        version: Number.isFinite(params.progress.version) ? Number(params.progress.version) : sentAt,
        full: params.progress.full === true,
      },
    });
  }

  return frames;
}

/** 校验组序表自身没有重复号，供门禁脚本与单测调用。 */
export function validateRealtimeOpcodeRegistry(): { ok: boolean; duplicates: number[] } {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const opcode of Object.values(REALTIME_OPCODE_BY_OUTPUT_TYPE)) {
    if (seen.has(opcode)) {
      duplicates.add(opcode);
      continue;
    }
    seen.add(opcode);
  }
  return { ok: duplicates.size === 0, duplicates: Array.from(duplicates) };
}
