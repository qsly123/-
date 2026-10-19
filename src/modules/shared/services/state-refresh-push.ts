import {
  createStateRefreshFrameGroup,
  type AnyStateRefreshEnvelope,
  type StateRefreshFrameGroupParams,
} from "@immortality/shared-protocol";

/**
 * Next 侧状态变更刷新帧封装。
 *
 * 背景：资产 / 背包 / 进度变更有一部分发生在 Next API 事务里，而客户端连的是
 * game-server 的 Colyseus 房间。为了保证"客户端是纯渲染端也一定能刷新"，
 * 这里同时做两件事：
 *
 * 1. 尝试把帧组投递给 game-server（内部 HTTP，可配，失败静默不阻塞业务）。
 * 2. 无论投递是否成功，都把帧组回传到 API 响应里，客户端消费后必定刷新。
 *
 * 只回 ACK 不带帧组是明确禁止的。
 */

const STATE_REFRESH_PATH = "/internal/state-refresh";

function resolveInternalEndpoint() {
  const configured = String(
    process.env.GAME_SERVER_INTERNAL_URL
    || process.env.NEXT_PUBLIC_GAME_SERVER_URL
    || "",
  ).trim();
  if (!configured) {
    return "";
  }
  return configured.replace(/\/+$/, "");
}

export interface StateRefreshPushOutcome {
  frames: AnyStateRefreshEnvelope[];
  delivered: boolean;
  endpoint: string;
  error?: string;
}

export function buildStateRefreshFrames(
  params: StateRefreshFrameGroupParams,
): AnyStateRefreshEnvelope[] {
  return createStateRefreshFrameGroup(params);
}

export async function pushStateRefreshFrames(
  params: StateRefreshFrameGroupParams,
): Promise<StateRefreshPushOutcome> {
  const frames = buildStateRefreshFrames(params);
  const endpoint = resolveInternalEndpoint();
  if (!endpoint) {
    return { frames, delivered: false, endpoint: "" };
  }

  try {
    const response = await fetch(`${endpoint}${STATE_REFRESH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.GAME_SERVER_INTERNAL_TOKEN
          ? { "x-internal-realtime-token": process.env.GAME_SERVER_INTERNAL_TOKEN }
          : {}),
      },
      body: JSON.stringify({ playerId: params.playerId, frames }),
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    return {
      frames,
      delivered: response.ok,
      endpoint,
      ...(response.ok ? {} : { error: `http_${response.status}` }),
    };
  } catch (error) {
    // 推送失败不能阻断业务事务，帧组仍会随响应回传，由客户端兜底刷新。
    return {
      frames,
      delivered: false,
      endpoint,
      error: error instanceof Error ? error.message : "push_failed",
    };
  }
}

/** 把帧组挂到 API 响应体上，客户端拿到后必须触发对应域刷新。 */
export function withStateRefreshFrames<TResponse extends Record<string, unknown>>(
  response: TResponse,
  frames: readonly AnyStateRefreshEnvelope[],
): TResponse & { refreshFrames: AnyStateRefreshEnvelope[] } {
  return {
    ...response,
    refreshFrames: Array.isArray(frames) ? [...frames] : [],
  };
}
