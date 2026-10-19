"use client";

import {
  createRealtimeClientInput,
  GAME_ROOM_NAMES,
  type GameRoomName,
  type JoinRoomOptions,
  type RealtimeClientInput,
  type RealtimeInputAck,
  type RealtimeInputMetaOverrides,
  type RealtimeInputType,
} from "@immortality/shared-protocol";

export interface GameColyseusLikeRoom<TState = unknown> {
  id: string;
  sessionId: string;
  state: TState;
  send(type: "input", message: RealtimeClientInput): void;
  leave(consented?: boolean): void | Promise<unknown>;
  onMessage?<TMessage = unknown>(type: string, callback: (message: TMessage) => void): void | (() => void);
  onStateChange?(callback: (state: TState) => void): void | (() => void);
  onLeave?(callback: (code: number, reason?: string) => void): void | (() => void);
  onReconnect?(callback: () => void): void | (() => void);
}

export interface GameColyseusLikeClient {
  joinOrCreate<TState = unknown>(
    roomName: GameRoomName,
    options: JoinRoomOptions,
  ): Promise<GameColyseusLikeRoom<TState>>;
}

export interface GameColyseusSdkRoom<TState = unknown> {
  roomId?: string;
  id?: string;
  sessionId: string;
  state: TState;
  send(type: string, message: unknown): void;
  leave(consented?: boolean): void | Promise<unknown>;
  onMessage?<TMessage = unknown>(type: string, callback: (message: TMessage) => void): void | (() => void);
  onStateChange?(callback: (state: TState) => void): void | (() => void);
  onLeave?: {
    (callback: (code: number, reason?: string) => void): unknown;
    remove?(callback: (code: number, reason?: string) => void): void;
  };
  onReconnect?: {
    (callback: () => void): unknown;
    remove?(callback: () => void): void;
  };
}

export interface GameColyseusSdkClientLike {
  joinOrCreate<TState = unknown>(
    roomName: GameRoomName,
    options: JoinRoomOptions,
  ): Promise<GameColyseusSdkRoom<TState>>;
}

export interface GameColyseusSdkClientConstructor {
  new(endpoint: string): GameColyseusSdkClientLike;
}

export interface GameRoomConnection<TState = unknown> {
  room: GameColyseusLikeRoom<TState>;
  sendInput<TPayload, TInputType extends RealtimeInputType>(
    inputType: TInputType,
    payload: TPayload,
    overrides?: RealtimeInputMetaOverrides,
  ): RealtimeClientInput<TPayload, TInputType>;
  sendInputAndWaitForAck<TPayload, TInputType extends RealtimeInputType>(
    inputType: TInputType,
    payload: TPayload,
    overrides?: RealtimeInputMetaOverrides & { timeoutMs?: number },
  ): Promise<{
    input: RealtimeClientInput<TPayload, TInputType>;
    ack: RealtimeInputAck;
  }>;
  leave(consented?: boolean): Promise<void>;
}

export type GameRoomMessageHandler = {
  type: string;
  callback: (message: unknown) => void;
};

function createPendingAckKey(inputType: string, clientSequence: number) {
  return `${inputType}:${clientSequence}`;
}

function isIpv4Host(value: string) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.trim());
}

function isLocalHost(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

function normalizeConfiguredGameServerEndpoint(configuredUrl: string) {
  const trimmed = configuredUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("//")) {
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}${trimmed}`.replace(/\/+$/, "");
  }

  if (trimmed.startsWith("/")) {
    if (typeof window === "undefined") {
      return trimmed.replace(/\/+$/, "");
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${trimmed}`.replace(/\/+$/, "");
  }

  try {
    const url = new URL(trimmed);
    if (
      typeof window !== "undefined"
      && isIpv4Host(url.hostname)
      && !isIpv4Host(window.location.hostname)
      && !isLocalHost(window.location.hostname)
    ) {
      url.hostname = window.location.hostname;
      if (window.location.protocol === "https:" && url.protocol === "ws:") {
        url.protocol = "wss:";
      }
      if (window.location.protocol === "https:" && url.protocol === "http:") {
        url.protocol = "https:";
      }
      if (window.location.protocol === "http:" && url.protocol === "wss:") {
        url.protocol = "ws:";
      }
      if (window.location.protocol === "http:" && url.protocol === "https:") {
        url.protocol = "http:";
      }
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function resolveGameServerEndpoint() {
  const configuredUrl = (
    process.env.NEXT_PUBLIC_GAME_SERVER_WS_URL
    || process.env.NEXT_PUBLIC_GAME_SERVER_URL
    || ""
  ).trim();

  if (configuredUrl) {
    return normalizeConfiguredGameServerEndpoint(configuredUrl);
  }

  if (typeof window === "undefined") {
    return "ws://127.0.0.1:3201";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3201`;
}

export function createGameColyseusClientFromSdk(
  ClientConstructor: GameColyseusSdkClientConstructor,
  endpoint = resolveGameServerEndpoint(),
): GameColyseusLikeClient {
  const sdkClient = new ClientConstructor(endpoint);

  return {
    async joinOrCreate<TState = unknown>(roomName: GameRoomName, options: JoinRoomOptions) {
      const sdkRoom = await sdkClient.joinOrCreate<TState>(roomName, options);
      const roomId = sdkRoom.roomId || sdkRoom.id;

      return {
        id: roomId || `${roomName}:${sdkRoom.sessionId}`,
        sessionId: sdkRoom.sessionId,
        state: sdkRoom.state,
        send(type, message) {
          sdkRoom.send(type, message);
        },
        leave(consented) {
          return sdkRoom.leave(consented);
        },
        onMessage(type, callback) {
          return sdkRoom.onMessage?.(type, callback);
        },
        onStateChange(callback) {
          return sdkRoom.onStateChange?.(callback);
        },
        onLeave(callback) {
          sdkRoom.onLeave?.(callback);
          return () => {
            sdkRoom.onLeave?.remove?.(callback);
          };
        },
        onReconnect(callback) {
          sdkRoom.onReconnect?.(callback);
          return () => {
            sdkRoom.onReconnect?.remove?.(callback);
          };
        },
      } satisfies GameColyseusLikeRoom<TState>;
    },
  };
}

export function resolveGlobalGameColyseusSdkConstructor() {
  if (typeof globalThis === "undefined") {
    return null;
  }

  const candidate = (globalThis as typeof globalThis & {
    Colyseus?: {
      Client?: GameColyseusSdkClientConstructor;
    };
  }).Colyseus?.Client;

  return typeof candidate === "function" ? candidate : null;
}

export async function loadGameColyseusSdkConstructor() {
  const globalConstructor = resolveGlobalGameColyseusSdkConstructor();
  if (globalConstructor) {
    return globalConstructor;
  }

  const sdkModule = await import("@colyseus/sdk") as unknown as {
    Client?: GameColyseusSdkClientConstructor;
  };

  return typeof sdkModule.Client === "function" ? sdkModule.Client : null;
}

export function createGameRoomInputSequencer(initialSequence = 0) {
  let nextSequence = initialSequence;

  return {
    peek() {
      return nextSequence;
    },
    create<TPayload, TInputType extends RealtimeInputType>(
      inputType: TInputType,
      payload: TPayload,
      overrides?: RealtimeInputMetaOverrides,
    ) {
      nextSequence += 1;
      return createRealtimeClientInput({
        clientSequence: overrides?.clientSequence ?? nextSequence,
        clientSceneTick: overrides?.clientSceneTick ?? 0,
        actionId: overrides?.actionId,
        clientSentAt: overrides?.clientSentAt,
        inputType,
        payload,
      });
    },
    markAccepted(acceptedSequence: number) {
      if (Number.isSafeInteger(acceptedSequence) && acceptedSequence > nextSequence) {
        nextSequence = acceptedSequence;
      }
    },
  };
}

export async function joinGameRoomWithSdkClient<TState = unknown>(params: {
  ClientConstructor: GameColyseusSdkClientConstructor;
  endpoint?: string;
  roomName: GameRoomName;
  options: JoinRoomOptions;
  initialSequence?: number;
  onAck?: (ack: RealtimeInputAck) => void;
  messageHandlers?: GameRoomMessageHandler[];
  onStateChange?: (state: TState) => void;
  onLeave?: (code: number, reason?: string) => void;
  onReconnect?: () => void;
}) {
  return joinGameRoom<TState>({
    client: createGameColyseusClientFromSdk(params.ClientConstructor, params.endpoint),
    roomName: params.roomName,
    options: params.options,
    initialSequence: params.initialSequence,
    onAck: params.onAck,
    messageHandlers: params.messageHandlers,
    onStateChange: params.onStateChange,
    onLeave: params.onLeave,
    onReconnect: params.onReconnect,
  });
}

export async function joinGameRoom<TState = unknown>(params: {
  client: GameColyseusLikeClient;
  roomName: GameRoomName;
  options: JoinRoomOptions;
  initialSequence?: number;
  onAck?: (ack: RealtimeInputAck) => void;
  messageHandlers?: GameRoomMessageHandler[];
  onStateChange?: (state: TState) => void;
  onLeave?: (code: number, reason?: string) => void;
  onReconnect?: () => void;
}): Promise<GameRoomConnection<TState>> {
  const room = await params.client.joinOrCreate<TState>(params.roomName, params.options);
  const sequencer = createGameRoomInputSequencer(params.initialSequence);
  const cleanupCallbacks: Array<() => void> = [];
  const pendingAcks = new Map<string, {
    timeout: ReturnType<typeof setTimeout>;
    resolve: (ack: RealtimeInputAck) => void;
    reject: (error: Error) => void;
  }>();

  for (const handler of params.messageHandlers || []) {
    const messageCleanup = room.onMessage?.(handler.type, handler.callback);
    if (typeof messageCleanup === "function") {
      cleanupCallbacks.push(messageCleanup);
    }
  }

  const ackCleanup = room.onMessage?.<RealtimeInputAck>("ack", (ack) => {
    if (ack.accepted) {
      sequencer.markAccepted(ack.acceptedSequence);
    }
    const pendingKey = createPendingAckKey(ack.inputType, ack.acceptedSequence);
    const pending = pendingAcks.get(pendingKey);
    if (pending) {
      pendingAcks.delete(pendingKey);
      clearTimeout(pending.timeout);
      pending.resolve(ack);
    }
    params.onAck?.(ack);
  });
  if (typeof ackCleanup === "function") {
    cleanupCallbacks.push(ackCleanup);
  }

  const stateCleanup = room.onStateChange?.((state) => {
    params.onStateChange?.(state);
  });
  if (typeof stateCleanup === "function") {
    cleanupCallbacks.push(stateCleanup);
  }

  const leaveCleanup = room.onLeave?.((code, reason) => {
    params.onLeave?.(code, reason);
  });
  if (typeof leaveCleanup === "function") {
    cleanupCallbacks.push(leaveCleanup);
  }

  const reconnectCleanup = room.onReconnect?.(() => {
    params.onReconnect?.();
  });
  if (typeof reconnectCleanup === "function") {
    cleanupCallbacks.push(reconnectCleanup);
  }

  return {
    room,
    sendInput(inputType, payload, overrides) {
      const input = sequencer.create(inputType, payload, overrides);
      room.send("input", input);
      return input;
    },
    sendInputAndWaitForAck(inputType, payload, overrides) {
      const input = sequencer.create(inputType, payload, overrides);
      const timeoutMs = Math.max(500, Number(overrides?.timeoutMs || 2500));
      const pendingKey = createPendingAckKey(input.inputType, input.clientSequence);
      const ackPromise = new Promise<RealtimeInputAck>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingAcks.delete(pendingKey);
          reject(new Error("等待实时 ACK 超时"));
        }, timeoutMs);
        pendingAcks.set(pendingKey, {
          timeout,
          resolve,
          reject,
        });
      });
      room.send("input", input);
      return ackPromise.then((ack) => ({ input, ack }));
    },
    async leave(consented = true) {
      for (const pending of pendingAcks.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("实时房间已关闭"));
      }
      pendingAcks.clear();
      for (const cleanup of cleanupCallbacks.splice(0)) {
        cleanup();
      }
      await room.leave(consented);
    },
  };
}

export const DEFAULT_GAME_ROOM_NAMES = GAME_ROOM_NAMES;
