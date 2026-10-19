import { createEndpoint } from "colyseus";
import {
  isStateRefreshOpcode,
  type AnyStateRefreshEnvelope,
} from "@immortality/shared-protocol";
import { deliverStateRefreshFrames } from "./state-refresh-registry";

/**
 * 内部状态刷新端点。
 *
 * Next API 事务落账后调用本端点，由 game-server 把刷新帧投递到该玩家的所有在线连接。
 * 多实例时通过 presence topic 广播，保证玩家连在任意实例上都能收到。
 */

export const STATE_REFRESH_TOPIC = "immortality:state-refresh";

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeFrames(value: unknown): AnyStateRefreshEnvelope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((frame): frame is AnyStateRefreshEnvelope => (
    Boolean(frame)
    && typeof frame === "object"
    && isStateRefreshOpcode((frame as { opcode?: unknown }).opcode)
    && typeof (frame as { playerId?: unknown }).playerId === "string"
    && typeof (frame as { type?: unknown }).type === "string"
  ));
}

export function validateStateRefreshPayload(payload: unknown):
  | { ok: true; playerId: string; frames: number }
  | { ok: false; reason: string } {
  const body = (payload && typeof payload === "object" ? payload : {}) as {
    playerId?: unknown;
    frames?: unknown;
  };
  const playerId = String(body.playerId || "").trim();
  const frames = normalizeFrames(body.frames);
  if (!playerId) {
    return { ok: false, reason: "missing_player_id" };
  }
  if (frames.length === 0) {
    return { ok: false, reason: "missing_frames" };
  }
  return { ok: true, playerId, frames: frames.length };
}

export function deliverStateRefreshPayload(payload: unknown) {
  const body = (payload && typeof payload === "object" ? payload : {}) as {
    playerId?: unknown;
    frames?: unknown;
  };
  const playerId = String(body.playerId || "").trim();
  const frames = normalizeFrames(body.frames);
  if (!playerId || frames.length === 0) {
    return { ok: false, delivered: 0, reason: "invalid_payload" };
  }
  const result = deliverStateRefreshFrames({ playerId, frames });
  return { ok: true, ...result };
}

export function createStateRefreshEndpoint(params: {
  publish?: (payload: unknown) => void;
  token?: string;
}) {
  return createEndpoint(
    "/internal/state-refresh",
    { method: "POST" },
    async (context: {
      request?: { json?: () => Promise<unknown> };
      body?: unknown;
      headers?: { get?: (name: string) => string | null | undefined };
    }) => {
      const token = String(params.token || "").trim();
      if (token) {
        const provided = String(context?.headers?.get?.("x-internal-realtime-token") || "").trim();
        if (provided !== token) {
          return createJsonResponse({ ok: false, reason: "unauthorized" }, 401);
        }
      }

      let payload: unknown = context?.body;
      if (!payload || typeof payload !== "object") {
        const request = context?.request;
        if (request && typeof request.json === "function") {
          payload = await request.json().catch(() => null);
        }
      }

      const validation = validateStateRefreshPayload(payload);
      if (!validation.ok) {
        return createJsonResponse(validation, 400);
      }

      // 只广播，不在这里直接投递：订阅者统一投递，避免 LocalPresence 下本地重复送达。
      params.publish?.(payload);
      return createJsonResponse({ ok: true, published: true, frames: validation.frames });
    },
  );
}
