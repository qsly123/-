import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  ClientState,
  CloseCode,
  Protocol,
  Transport,
  connectClientToRoom,
  debugAndPrintError,
  debugConnection,
  debugMessage,
  getBearerToken,
  getMessageBytes,
  logger,
  matchMaker,
} from "colyseus";
import {
  incrementGameServerTransportMetric,
  recordGameServerTransportError,
} from "./metrics";

const SEND_OPTS = { binary: true };

function noop() {
  // ws ping callback placeholder.
}

function heartbeat(this: WebSocket & { pingCount?: number }) {
  this.pingCount = 0;
}

class SameCoreWebSocketClient {
  state: number = ClientState.JOINING;
  sessionId: string;
  id: string;
  ref: WebSocket & { pingCount?: number; onleave?: (code?: number) => void };
  _afterNextPatchQueue?: unknown[];
  _enqueuedMessages: Uint8Array[] = [];
  _numMessagesLastSecond = 0;
  _lastMessageTime = 0;
  auth?: unknown;
  reconnectionToken?: string;
  "~messages"?: unknown;

  constructor(id: string, ref: WebSocket & { pingCount?: number; onleave?: (code?: number) => void }) {
    this.sessionId = id;
    this.id = id;
    this.ref = ref;
  }

  sendBytes(type: string | number, bytes: Uint8Array, options?: { afterNextPatch?: boolean }) {
    debugMessage("send bytes(to %s): '%s' -> %j", this.sessionId, type, bytes);
    this.enqueueRaw(getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, bytes), options);
  }

  send(messageOrType: string | number, messageOrOptions?: unknown, options?: { afterNextPatch?: boolean }) {
    debugMessage("send(to %s): '%s' -> %j", this.sessionId, messageOrType, messageOrOptions);
    this.enqueueRaw(getMessageBytes.raw(Protocol.ROOM_DATA, messageOrType, messageOrOptions), options);
  }

  enqueueRaw(data: Uint8Array, options?: { afterNextPatch?: boolean }) {
    if (options?.afterNextPatch) {
      this._afterNextPatchQueue?.push([this, [data]]);
      return;
    }
    if (this.state !== ClientState.JOINED) {
      this._enqueuedMessages.push(data);
      return;
    }
    this.raw(data);
  }

  raw(data: Uint8Array, _options?: unknown, callback?: (error?: Error) => void) {
    this.ref.send(data, SEND_OPTS, callback);
  }

  error(code: number, message = "", callback?: () => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, callback);
  }

  get readyState() {
    return this.ref.readyState;
  }

  leave(code?: number, data?: string) {
    this.ref.close(code, data);
  }

  close(code?: number, data?: string) {
    logger.warn("DEPRECATION WARNING: use client.leave() instead of client.close()");
    this.leave(code, data);
  }

  toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}

export class SameCoreWebSocketTransport extends Transport {
  server: HttpServer;
  wss: WebSocketServer;
  pingInterval?: ReturnType<typeof setInterval>;
  pingIntervalMS: number;
  pingMaxRetries: number;
  private shuttingDown = false;

  constructor(options: {
    server?: HttpServer;
    maxPayload?: number;
    perMessageDeflate?: boolean;
    pingInterval?: number;
    pingMaxRetries?: number;
  } = {}) {
    super();
    const server = options.server || createServer();
    this.server = server;
    this.pingIntervalMS = options.pingInterval ?? 3000;
    this.pingMaxRetries = options.pingMaxRetries ?? 2;
    this.wss = new WebSocketServer({
      server,
      maxPayload: options.maxPayload ?? 4 * 1024,
      perMessageDeflate: options.perMessageDeflate ?? false,
    });
    this.server.on("upgrade", () => {
      incrementGameServerTransportMetric("websocketUpgradeRequests");
    });
    this.wss.on("connection", (rawClient, request) => {
      incrementGameServerTransportMetric("websocketConnections");
      void this.onConnection(rawClient, request);
    });
    this.wss.on("error", (error) => {
      incrementGameServerTransportMetric("websocketConnectionErrors");
      recordGameServerTransportError(error instanceof Error ? error.message : "websocket_server_error");
      debugAndPrintError(error);
    });

    if (this.pingIntervalMS > 0 && this.pingMaxRetries > 0) {
      this.server.on("listening", () => this.autoTerminateUnresponsiveClients());
      this.server.on("close", () => clearInterval(this.pingInterval));
    }
  }

  listen(port: number | string, hostname?: string, backlog?: number, listeningListener?: (error?: Error) => void) {
    (this.server.listen as (...args: unknown[]) => HttpServer)(port, hostname, backlog, listeningListener);
    return this;
  }

  shutdown() {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    clearInterval(this.pingInterval);
    this.wss.clients.forEach((client) => client.terminate());
    try {
      this.wss.close();
    } catch (error) {
      debugAndPrintError(error instanceof Error ? error : String(error));
    }
    try {
      this.server.close();
    } catch (error) {
      debugAndPrintError(error instanceof Error ? error : String(error));
    }
  }

  simulateLatency() {
    // Latency simulation is not needed for game-server smoke or production boot.
  }

  autoTerminateUnresponsiveClients() {
    if (this.pingInterval) {
      return;
    }
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((client: WebSocket & { pingCount?: number }) => {
        if ((client.pingCount || 0) >= this.pingMaxRetries) {
          debugConnection("terminating unresponsive client");
          incrementGameServerTransportMetric("websocketHeartbeatTerminations");
          recordGameServerTransportError("heartbeat_timeout");
          client.terminate();
          return;
        }
        client.pingCount = (client.pingCount || 0) + 1;
        client.ping(noop);
      });
    }, this.pingIntervalMS);
  }

  async onConnection(rawClient: WebSocket & { pingCount?: number }, request: IncomingMessage) {
    rawClient.on("error", (error: Error) => {
      incrementGameServerTransportMetric("websocketClientErrors");
      recordGameServerTransportError(error.message || "websocket_client_error");
      debugAndPrintError(`${error.message}\n${error.stack}`);
    });
    rawClient.on("pong", heartbeat);
    rawClient.pingCount = 0;

    const parsedURL = new URL(request.url || "/", "ws://server");
    const sessionId = parsedURL.searchParams.get("sessionId");
    const processAndRoomId = parsedURL.pathname.match(/\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)$/);
    const roomId = processAndRoomId?.[1];

    if (!sessionId && !roomId) {
      incrementGameServerTransportMetric("websocketMissingSessionAndRoom");
      recordGameServerTransportError("missing_session_and_room");
      const timeout = setTimeout(() => {
        incrementGameServerTransportMetric("websocketHandshakeTimeouts");
        recordGameServerTransportError("handshake_timeout");
        rawClient.close(CloseCode.NORMAL_CLOSURE);
      }, 1000);
      rawClient.on("message", () => rawClient.send(new Uint8Array([Protocol.PING])));
      rawClient.on("close", () => clearTimeout(timeout));
      return;
    }

    const room = roomId ? matchMaker.getLocalRoomById(roomId) : undefined;
    const client = new SameCoreWebSocketClient(String(sessionId || ""), rawClient);
    const reconnectionToken = parsedURL.searchParams.get("reconnectionToken") || undefined;
    const skipHandshake = parsedURL.searchParams.has("skipHandshake");

    try {
      await connectClientToRoom(room, client as never, {
        headers: new Headers(request.headers as Record<string, string>),
        token: parsedURL.searchParams.get("_authToken") || getBearerToken(String(request.headers.authorization || "")),
        ip: String(request.headers["x-real-ip"] || request.headers["x-forwarded-for"] || request.socket.remoteAddress || ""),
      }, {
        reconnectionToken,
        skipHandshake,
      });
    } catch (error) {
      incrementGameServerTransportMetric("websocketConnectionErrors");
      incrementGameServerTransportMetric(reconnectionToken ? "websocketFailedReconnects" : "websocketRoomConnectFailures");
      const code = typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : CloseCode.WITH_ERROR;
      const message = error instanceof Error ? error.message : "websocket_connect_failed";
      recordGameServerTransportError(reconnectionToken ? "failed_reconnect" : "room_connect_failed");
      recordGameServerTransportError(message);
      debugAndPrintError(error instanceof Error ? error : String(error));
      client.error(code, message, () => rawClient.close(reconnectionToken ? CloseCode.FAILED_TO_RECONNECT : CloseCode.WITH_ERROR));
    }
  }
}
