"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createStateRefreshFrameGroup,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  resolveRealtimeOutputType,
  type AnyStateRefreshEnvelope,
  type ProgressRefreshScope,
  type StateRefreshFrameGroupParams,
} from "@immortality/shared-protocol";
import type {
  GameColyseusLikeRoom,
  GameRoomMessageHandler,
} from "@/modules/shared/services/colyseus-game-client";

/**
 * 状态变更刷新帧客户端订阅。
 *
 * 客户端是纯渲染端：资产 / 背包 / 进度是否变化完全依赖服务端下发的刷新帧。
 * 任何"服务端只回 ACK 不下发刷新帧"的接口都会让界面停在旧值，因此本 hook 是
 * 业务页感知资产变化的唯一入口。
 */

export type StateRefreshDomain = "inventory" | "asset" | "progress";

export interface StateRefreshSignal {
  domain: StateRefreshDomain;
  opcode: number;
  reason: string;
  version: number;
  full: boolean;
  receivedAt: number;
  changedItemIds?: string[];
  currencies?: Record<string, number>;
  scopes?: ProgressRefreshScope[];
}

export const STATE_REFRESH_FRAME_TYPES = [
  "inventory_refresh",
  "asset_refresh",
  "progress_refresh",
] as const;

const DOMAIN_BY_OPCODE: Record<number, StateRefreshDomain> = {
  [REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh]: "inventory",
  [REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh]: "asset",
  [REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh]: "progress",
};

function normalizeFrame(frame: AnyStateRefreshEnvelope): StateRefreshSignal | null {
  const domain = DOMAIN_BY_OPCODE[frame?.opcode];
  if (!domain) {
    return null;
  }
  const payload = frame.payload as {
    reason?: string;
    version?: number;
    full?: boolean;
    changedItemIds?: string[];
    currencies?: Record<string, number>;
    scopes?: ProgressRefreshScope[];
  };
  return {
    domain,
    opcode: frame.opcode,
    reason: String(payload?.reason || ""),
    version: Number(payload?.version || 0),
    full: payload?.full === true,
    receivedAt: Date.now(),
    ...(Array.isArray(payload?.changedItemIds) ? { changedItemIds: payload.changedItemIds } : {}),
    ...(payload?.currencies ? { currencies: payload.currencies } : {}),
    ...(Array.isArray(payload?.scopes) ? { scopes: payload.scopes } : {}),
  };
}

/** join 房间前预注册刷新帧 handler，避免首帧到达时被 SDK 丢弃。 */
export function createStateRefreshMessageHandlers(
  onFrame?: (frame: AnyStateRefreshEnvelope) => void,
): GameRoomMessageHandler[] {
  return STATE_REFRESH_FRAME_TYPES.map((type) => ({
    type,
    callback: (message: unknown) => {
      const frame = message as AnyStateRefreshEnvelope;
      if (!frame || typeof frame !== "object") {
        return;
      }
      if (!resolveRealtimeOutputType(frame.opcode)) {
        return;
      }
      onFrame?.(frame);
    },
  }));
}

export function useStateRefreshFrames(room: GameColyseusLikeRoom<unknown> | null) {
  const [signals, setSignals] = useState<Record<StateRefreshDomain, StateRefreshSignal | null>>({
    inventory: null,
    asset: null,
    progress: null,
  });
  const [versions, setVersions] = useState<Record<StateRefreshDomain, number>>({
    inventory: 0,
    asset: 0,
    progress: 0,
  });

  const applyFrame = useCallback((frame: AnyStateRefreshEnvelope) => {
    const signal = normalizeFrame(frame);
    if (!signal) {
      return null;
    }
    setVersions((previous) => ({
      ...previous,
      [signal.domain]: previous[signal.domain] + 1,
    }));
    setSignals((previous) => {
      const last = previous[signal.domain];
      if (last && Number(last.version) > Number(signal.version)) {
        return previous;
      }
      return { ...previous, [signal.domain]: signal };
    });
    return signal;
  }, []);

  useEffect(() => {
    if (!room?.onMessage) {
      return;
    }
    const disposers: Array<(() => void) | void> = [];
    for (const type of STATE_REFRESH_FRAME_TYPES) {
      disposers.push(
        room.onMessage<AnyStateRefreshEnvelope>(type, (message) => {
          applyFrame(message);
        }),
      );
    }
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === "function") {
          dispose();
        }
      }
    };
  }, [room, applyFrame]);

  return {
    signals,
    versions,
    applyFrame,
    /** 页面在收到刷新帧后调用，用于标记本地数据已与服务端对齐。 */
    hasPending: (domain: StateRefreshDomain) => Boolean(signals[domain]),
  };
}

/** 服务端事务响应里携带帧组时，客户端可直接消费，保证即使推送不可达界面也会刷新。 */
export function applyStateRefreshFramesFromResponse(
  frames: readonly AnyStateRefreshEnvelope[] | null | undefined,
  applyFrame: (frame: AnyStateRefreshEnvelope) => void,
) {
  if (!Array.isArray(frames)) {
    return 0;
  }
  let applied = 0;
  for (const frame of frames) {
    if (!frame || typeof frame !== "object") {
      continue;
    }
    applyFrame(frame);
    applied += 1;
  }
  return applied;
}

export function createClientSideStateRefreshFrames(
  params: StateRefreshFrameGroupParams,
): AnyStateRefreshEnvelope[] {
  return createStateRefreshFrameGroup(params);
}
