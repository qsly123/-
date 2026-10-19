"use client";

import {
  appendRealtimeCodecSearchParam,
  decodeRealtimePayloadAsync,
  encodeRealtimePayload,
  isBinaryRealtimeCodec,
  resolveRealtimeCodecKind,
} from "@/modules/shared/services/realtime-codec.mjs";

export type RealtimeTransport = "sse" | "ws";
export type RealtimeCodecKind = "json" | "msgpack";
type RealtimeTransportPreference = "auto" | RealtimeTransport;
type RealtimeTransportFallbackReason =
  | "client_no_ws"
  | "ws_upgrade_failed"
  | "codec_negotiation_failed"
  | "bridge_downgrade"
  | "explicit_client_no_ws"
  | "unknown";

type OpenJsonRealtimeChannelParams<T> = {
  sseUrl: string;
  wsUrl?: string | null;
  preferredTransport?: RealtimeTransportPreference;
  wsCodec?: RealtimeCodecKind;
  onMessage: (payload: T) => void;
  onError?: () => void;
  onOpen?: (transport: RealtimeTransport) => void;
};

function readConfiguredTransportPreference() {
  const value = (process.env.NEXT_PUBLIC_REALTIME_TRANSPORT || "").trim().toLowerCase();
  if (value === "ws") {
    return "ws" satisfies RealtimeTransportPreference;
  }
  if (value === "sse") {
    return "sse" satisfies RealtimeTransportPreference;
  }
  return "auto" satisfies RealtimeTransportPreference;
}

function resolveTransportPreference(preferredTransport?: RealtimeTransportPreference) {
  return preferredTransport || readConfiguredTransportPreference();
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function appendTransportFallbackReason(
  url: string,
  reason: RealtimeTransportFallbackReason,
) {
  if (!url) {
    return url;
  }

  try {
    const baseUrl = typeof window !== "undefined"
      ? window.location.origin
      : "http://127.0.0.1";
    const nextUrl = new URL(url, baseUrl);
    nextUrl.searchParams.set("transportFallbackReason", reason);
    return nextUrl.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}transportFallbackReason=${encodeURIComponent(reason)}`;
  }
}

export function buildRealtimeWebSocketUrl(path: string, options?: {
  codec?: RealtimeCodecKind | null;
}) {
  const configuredBaseUrl = (process.env.NEXT_PUBLIC_REALTIME_WS_BASE_URL || "").trim();
  if (!configuredBaseUrl) {
    if (typeof window === "undefined") {
      return null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return appendRealtimeCodecSearchParam(
      `${protocol}//${window.location.host}${normalizePath(path)}`,
      options?.codec,
    );
  }

  return appendRealtimeCodecSearchParam(
    `${normalizeBaseUrl(configuredBaseUrl)}${normalizePath(path)}`,
    options?.codec,
  );
}

export function openJsonRealtimeChannel<T>(params: OpenJsonRealtimeChannelParams<T>) {
  const transportPreference = resolveTransportPreference(params.preferredTransport);
  const fallbackToSse = transportPreference !== "sse";
  const canUseWebSocket = transportPreference !== "sse" && Boolean(params.wsUrl);
  const websocketCodec = resolveRealtimeCodecKind(params.wsCodec, "json");
  let activeWebSocketCodec = websocketCodec;

  let closed = false;
  let websocketOpened = false;
  let activeTransport: RealtimeTransport | null = null;
  let eventSource: EventSource | null = null;
  let websocket: WebSocket | null = null;
  let eventSourceOpened = false;

  const cleanupEventSource = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    eventSourceOpened = false;
  };

  const cleanupWebSocket = () => {
    if (websocket) {
      const socket = websocket;
      websocket = null;
      websocketOpened = false;
      eventSourceOpened = false;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        }, { once: true });
        return;
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.close();
      }
    }
  };

  const emitTransportOpen = (transport: RealtimeTransport) => {
    activeTransport = transport;
    params.onOpen?.(transport);
  };

  const openEventSource = (reason: RealtimeTransportFallbackReason) => {
    if (closed || eventSourceOpened || eventSource) {
      return;
    }

    cleanupWebSocket();
    eventSource = new EventSource(appendTransportFallbackReason(params.sseUrl, reason));
    eventSourceOpened = true;

    eventSource.onopen = () => {
      if (closed) {
        cleanupEventSource();
        return;
      }
      emitTransportOpen("sse");
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as T;
        params.onMessage(payload);
      } catch {
        // ignore malformed event payloads
      }
    };

    eventSource.onerror = () => {
      if (closed) {
        return;
      }
      params.onError?.();
    };
  };

  const openWebSocket = () => {
    if (closed || !params.wsUrl) {
      return;
    }

    try {
      websocket = new WebSocket(params.wsUrl);
    } catch {
      if (fallbackToSse) {
        openEventSource("ws_upgrade_failed");
        return;
      }
      params.onError?.();
      return;
    }

    websocket.onopen = () => {
      if (closed) {
        cleanupWebSocket();
        return;
      }
      websocketOpened = true;
      emitTransportOpen("ws");
    };
    if (isBinaryRealtimeCodec(websocketCodec)) {
      websocket.binaryType = "arraybuffer";
    }

    websocket.onmessage = (event) => {
      void decodeRealtimePayloadAsync(event.data, {
        codec: activeWebSocketCodec,
      }).then((decodedPayload) => {
        if (!closed) {
          const payload = decodedPayload.payload as T & {
            codec?: RealtimeCodecKind;
          };
          if (payload && typeof payload === "object" && "codec" in payload) {
            activeWebSocketCodec = resolveRealtimeCodecKind(payload.codec, "json");
          }
          params.onMessage(payload);
        }
      }).catch(() => {
        // ignore malformed event payloads
      });
    };

    websocket.onerror = () => {
      if (closed) {
        return;
      }

      if (!websocketOpened && fallbackToSse) {
        cleanupWebSocket();
        openEventSource("ws_upgrade_failed");
        return;
      }

      params.onError?.();
    };

    websocket.onclose = () => {
      if (closed) {
        return;
      }

      if (!websocketOpened && fallbackToSse) {
        cleanupWebSocket();
        openEventSource("ws_upgrade_failed");
        return;
      }

      params.onError?.();
    };
  };

  if (canUseWebSocket) {
    openWebSocket();
  } else {
    openEventSource(transportPreference === "sse" ? "explicit_client_no_ws" : "client_no_ws");
  }

  return {
    close() {
      closed = true;
      cleanupEventSource();
      cleanupWebSocket();
    },
    getTransport() {
      return activeTransport;
    },
    send(payload: unknown) {
      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        return false;
      }
      try {
        const encodedPayload = encodeRealtimePayload(payload, {
          codec: activeWebSocketCodec,
        });
        websocket.send(encodedPayload.data);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function openJsonEventStream<T>(params: {
  url: string;
  onMessage: (payload: T) => void;
  onError?: () => void;
  onOpen?: (transport: RealtimeTransport) => void;
}) {
  return openJsonRealtimeChannel({
    sseUrl: params.url,
    preferredTransport: "sse",
    onMessage: params.onMessage,
    onError: params.onError,
    onOpen: params.onOpen,
  });
}
