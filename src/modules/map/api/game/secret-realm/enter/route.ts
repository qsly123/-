import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { enterSecretRealm, getCurrentSecretRealmForPlayer } from "@/modules/map/services/secret-realm-instance-service";
import { warmMapSceneSharedStateForMapId } from "@/modules/map/services/map-scene-hub";
import { ensureSecretRealmRuntimeCleanup } from "@/modules/map/services/secret-realm-runtime-maintenance";
import {
  finishMapActionIdempotency,
  startMapActionIdempotency,
} from "@/modules/map/services/map-action-idempotency";

export async function POST(request: Request) {
  let idempotencyKey: string | null = null;
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    await ensureSecretRealmRuntimeCleanup();

    const body = await request.json() as {
      spawnId?: unknown;
      actionId?: unknown;
      clientSequence?: unknown;
      clientSceneTick?: unknown;
    };
    const spawnId = typeof body.spawnId === "string" ? body.spawnId.trim() : "";
    if (!spawnId) {
      return NextResponse.json({ success: false, error: "缺少秘境入口" }, { status: 400 });
    }
    const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    if (actionId) {
      const idempotency = await startMapActionIdempotency({
        scope: "secret-realm-enter",
        roomId: "next-api:secret-realm-enter",
        playerId: player.id,
        actionId,
        inputType: "secret_realm_enter",
        mapId: player.currentMapId || null,
        entityId: spawnId,
        payload: {
          spawnId,
          actionId,
          clientSequence: body.clientSequence ?? null,
          clientSceneTick: body.clientSceneTick ?? null,
        },
      });
      idempotencyKey = idempotency.idempotencyKey;
      if (idempotency.status === "accepted") {
        return NextResponse.json({
          success: true,
          data: {
            ...idempotency.result,
            alreadyProcessed: true,
          },
        });
      }
      if (idempotency.status === "rejected") {
        return NextResponse.json({
          success: false,
          error: idempotency.reason || "进入秘境失败",
          data: {
            ...idempotency.result,
            alreadyProcessed: true,
          },
        }, { status: 400 });
      }
      if (idempotency.status === "pending") {
        return NextResponse.json({
          success: false,
          error: "秘境进入正在处理中，请稍后重试",
          data: {
            realtimeAck: {
              accepted: false,
              inputType: "interact",
              acceptedSequence: Number(body.clientSequence || 0),
              reason: "settlement_pending",
              serverTick: Number(body.clientSceneTick || 0),
              authoritativeState: {
                spawnId,
                alreadyProcessing: true,
              },
            },
          },
        }, { status: 409 });
      }
    }

    const enterResult = await enterSecretRealm({
      playerId: player.id,
      spawnId,
    });
    await warmMapSceneSharedStateForMapId({
      mapId: enterResult.mapId,
      reason: "player_transition",
    }).catch((error) => {
      console.error("Secret realm enter map prewarm error:", error);
    });
    const currentSecretRealm = await getCurrentSecretRealmForPlayer(player.id);
    const responseData = {
      ...enterResult,
      currentSecretRealm,
    };
    if (idempotencyKey) {
      await finishMapActionIdempotency({
        idempotencyKey,
        status: "accepted",
        result: responseData,
      });
    }

    return NextResponse.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "进入秘境失败";
    if (idempotencyKey) {
      console.error("Secret realm enter left pending for manual reconciliation:", {
        idempotencyKey,
        error: message,
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
