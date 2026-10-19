import { NextResponse } from "next/server";
import type { SceneStreamRuntime } from "@/modules/shared/services/scene-stream-runtime";
import { recordRealtimeTransportPayload } from "@/modules/system/services/runtime-bandwidth-stats";

export interface TransportAdapter<TStreamEvent> {
  push: (payload: TStreamEvent) => boolean;
  close: () => void;
}

export function createJsonSseResponse<TSnapshot, TDomainEvent, TStreamEvent>(params: {
  request?: Request;
  runtime: SceneStreamRuntime<TSnapshot, TDomainEvent, TStreamEvent>;
  heartbeatMs?: number;
}) {
  const encoder = new TextEncoder();
  const resolvedHeartbeatMs = Number.parseInt(
    String(process.env.REALTIME_SSE_HEARTBEAT_MS || "").trim(),
    10,
  );
  const heartbeatMs = Number.isFinite(resolvedHeartbeatMs) && resolvedHeartbeatMs >= 10_000
    ? resolvedHeartbeatMs
    : (params.heartbeatMs ?? 30_000);
  const isInternalRealtimeProxy = params.request?.headers.get("x-internal-realtime-proxy") === "1";
  const proxiedPublicTransport = String(
    params.request?.headers.get("x-realtime-public-transport") || "",
  ).trim().toLowerCase();
  const shouldRecordBandwidth = !isInternalRealtimeProxy || proxiedPublicTransport === "sse";
  let stopStream: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let stopped = false;

      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      stopStream = stop;

      const adapter: TransportAdapter<TStreamEvent> = {
        push(payload) {
          if (stopped) {
            return false;
          }
          try {
            const serializedPayload = JSON.stringify(payload);
            const encodedPayload = encoder.encode(`data: ${serializedPayload}\n\n`);
            controller.enqueue(encodedPayload);
            if (shouldRecordBandwidth) {
              recordRealtimeTransportPayload({
                transport: "sse",
                payload,
                bytes: encodedPayload.byteLength,
              });
            }
            return true;
          } catch {
            stop();
            return false;
          }
        },
        close() {
          stop();
        },
      };

      const initialEvents = await params.runtime.getInitialEvents();
      for (const event of initialEvents) {
        if (!adapter.push(event)) {
          return;
        }
      }

      const nextUnsubscribe = await params.runtime.subscribe((event) => {
        adapter.push(event);
      });
      unsubscribe = nextUnsubscribe;

      heartbeatTimer = setInterval(() => {
        if (stopped) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          stop();
        }
      }, heartbeatMs);
      heartbeatTimer.unref?.();

      params.request?.signal.addEventListener("abort", stop);
    },
    cancel() {
      stopStream?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
