import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { mapOpportunitySpawns, randomEvents } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { narrateEvent, narrateEventWithVariables } from "@/modules/ai/services/ai";
import { clearPendingMapEvent, getPendingMapEvent } from "@/modules/map/services/pending-map-event";
import {
  createOrRestoreEncounterSession,
  hasRestorableEncounterSessionForEvent,
  isChainEncounterEvent,
} from "@/modules/map/services/map-encounter-session-service";
import {
  applyRandomEventRewards,
  collectRandomEventActionVariableKeys,
  pickRandomEventImageUrl,
  type RandomEventRewardInput,
} from "@/modules/map/services/random-event-service";
import { collectDoubleCultivationRandomEventVariableOptions } from "@/modules/world/services/double-cultivation-random-event";
import { normalizeLegacyMapInteractRequest } from "@immortality/shared-protocol";
import {
  finishMapActionIdempotency,
  startMapActionIdempotency,
} from "@/modules/map/services/map-action-idempotency";

export async function POST(request: Request) {
  let eventResolveIdempotencyKey: string | null = null;
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const rawBody = await request.json() as { eventId?: unknown };
    const normalizedProtocolInput = normalizeLegacyMapInteractRequest(rawBody, "resolve_event");
    if (!normalizedProtocolInput.ok) {
      return NextResponse.json({
        success: false,
        error: normalizedProtocolInput.error,
        data: {
          realtimeAck: normalizedProtocolInput.ack,
        },
      }, { status: normalizedProtocolInput.status });
    }
    const body = normalizedProtocolInput.legacyBody as typeof rawBody;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (!eventId) {
      return NextResponse.json({ success: false, error: "缺少事件ID" }, { status: 400 });
    }

    const idempotency = await startMapActionIdempotency({
      scope: "map-event-resolve",
      roomId: "next-api:map-event-resolve",
      playerId: player.id,
      actionId: normalizedProtocolInput.input.actionId,
      inputType: "resolve_event",
      mapId: player.currentMapId || null,
      entityId: eventId,
      payload: {
        ...body,
        eventId,
      },
    });
    eventResolveIdempotencyKey = idempotency.idempotencyKey;
    if (idempotency.status === "accepted") {
      return NextResponse.json({
        success: true,
        data: {
          ...idempotency.result,
          alreadyProcessed: true,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      });
    }
    if (idempotency.status === "rejected") {
      return NextResponse.json({
        success: false,
        error: idempotency.reason || "事件结算失败",
        data: {
          ...idempotency.result,
          alreadyProcessed: true,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      }, { status: 400 });
    }
    if (idempotency.status === "pending") {
      return NextResponse.json({
        success: false,
        error: "事件结算正在处理中，请稍后重试",
        data: {
          realtimeAck: {
            accepted: false,
            inputType: normalizedProtocolInput.input.inputType,
            acceptedSequence: normalizedProtocolInput.input.clientSequence,
            reason: "settlement_pending",
            serverTick: normalizedProtocolInput.input.clientSceneTick,
            authoritativeState: {
              eventId,
              alreadyProcessing: true,
            },
          },
          protocol: normalizedProtocolInput.protocolMeta,
        },
      }, { status: 409 });
    }

    const evt = await db.select().from(randomEvents).where(eq(randomEvents.id, eventId)).get();
    if (!evt) {
      await finishMapActionIdempotency({
        idempotencyKey: eventResolveIdempotencyKey,
        status: "rejected",
        reason: "事件不存在或已失效",
        result: { eventId },
      });
      return NextResponse.json({ success: false, error: "事件不存在或已失效" }, { status: 404 });
    }

    const activeChainSession = isChainEncounterEvent(evt)
      ? await hasRestorableEncounterSessionForEvent({
        playerId: player.id,
        eventId,
        currentMapId: player.currentMapId || null,
      })
      : null;
    const pending = activeChainSession ? null : getPendingMapEvent(player.id, eventId);
    if (!pending && !activeChainSession) {
      await finishMapActionIdempotency({
        idempotencyKey: eventResolveIdempotencyKey,
        status: "rejected",
        reason: "当前没有待结算的事件",
        result: { eventId },
      });
      return NextResponse.json({ success: false, error: "当前没有待结算的事件" }, { status: 400 });
    }

    if (pending?.sourceType === "opportunity") {
      const spawnId = typeof pending.sourceRef === "string" ? pending.sourceRef.trim() : "";
      if (!spawnId) {
        await finishMapActionIdempotency({
          idempotencyKey: eventResolveIdempotencyKey,
          status: "rejected",
          reason: "机缘结算上下文缺失",
          result: { eventId },
        });
        return NextResponse.json({ success: false, error: "机缘结算上下文缺失" }, { status: 400 });
      }

      const claimedSpawn = await db.select({
        id: mapOpportunitySpawns.id,
      }).from(mapOpportunitySpawns).where(and(
        eq(mapOpportunitySpawns.id, spawnId),
        eq(mapOpportunitySpawns.eventId, eventId),
        eq(mapOpportunitySpawns.claimedByPlayerId, player.id),
        isNotNull(mapOpportunitySpawns.claimedAt),
      )).get();
      if (!claimedSpawn) {
        await finishMapActionIdempotency({
          idempotencyKey: eventResolveIdempotencyKey,
          status: "rejected",
          reason: "机缘已失效或不属于当前玩家",
          result: { eventId, spawnId },
        });
        return NextResponse.json({ success: false, error: "机缘已失效或不属于当前玩家" }, { status: 400 });
      }
    }

    if (isChainEncounterEvent(evt)) {
      const result = await createOrRestoreEncounterSession({
        playerId: player.id,
        playerName: player.name || "无名修士",
        playerRealmName: player.realmName,
        currentMapId: player.currentMapId || null,
        eventRow: evt,
      });
      const responseData = {
        encounterSession: result.encounterSession,
        stage: result.stage,
        sessionStatus: result.sessionStatus,
      };
      await finishMapActionIdempotency({
        idempotencyKey: eventResolveIdempotencyKey,
        status: "accepted",
        result: responseData,
      });
      clearPendingMapEvent(player.id);
      return NextResponse.json({
        success: true,
        data: {
          ...responseData,
          protocol: normalizedProtocolInput.protocolMeta,
        },
      });
    }

    const rewards = evt.rewards as RandomEventRewardInput | null;
    const imageUrl = pickRandomEventImageUrl(evt.imageUrls);
    const actionVariableKeys = collectRandomEventActionVariableKeys(rewards);

    let narrative = evt.description || "你遇到了一件奇事...";
    let aiVariables: Record<string, string> | null = null;
    if (actionVariableKeys.length > 0 && !evt.aiPrompt) {
      await finishMapActionIdempotency({
        idempotencyKey: eventResolveIdempotencyKey,
        status: "rejected",
        reason: "事件动作依赖 AI 变量，请配置 AI叙事提示词",
        result: { eventId },
      });
      return NextResponse.json({ success: false, error: "事件动作依赖 AI 变量，请配置 AI叙事提示词" }, { status: 400 });
    }

    if (evt.aiPrompt && actionVariableKeys.length > 0) {
      const actionVariableResult = await collectDoubleCultivationRandomEventVariableOptions({
        playerId: player.id,
        actions: rewards?.actions || [],
      });
      const actionVariableOptions = actionVariableResult.variables;
      const actionVariableMeta = actionVariableResult.variableMeta;
      const constraintsText = actionVariableKeys.map((key) => {
        const values = actionVariableOptions[key];
        if (Array.isArray(values) && values.length > 0) {
          return `变量 {{${key}}} 候选：${values.join("、")}（必须原样输出）`;
        }
        return `变量 {{${key}}}：请返回可用于动作执行的值`;
      }).join("\n");
      const promptHints = actionVariableKeys
        .map((key) => String(actionVariableMeta[key]?.promptHint || "").trim())
        .filter(Boolean);
      const promptHintText = promptHints.length > 0
        ? `\n【动作补充约束】\n${promptHints.join("\n")}`
        : "";

      const promptWithVariables = `${evt.aiPrompt}

【变量约束】
你必须在 variables 中返回这些变量：${actionVariableKeys.join(", ")}。
${constraintsText}${promptHintText}`;
      const aiResult = await narrateEventWithVariables({
        eventPrompt: promptWithVariables,
        playerName: player.name || "无名修士",
        playerRealm: player.realmName,
        variableKeys: actionVariableKeys,
      });
      for (const variableKey of actionVariableKeys) {
        const targetValue = String(aiResult.variables[variableKey] || "").trim();
        if (!targetValue) {
          await finishMapActionIdempotency({
            idempotencyKey: eventResolveIdempotencyKey,
            status: "rejected",
            reason: `AI 变量 {{${variableKey}}} 不能为空`,
            result: { eventId },
          });
          return NextResponse.json({
            success: false,
            error: `AI 变量 {{${variableKey}}} 不能为空`,
          }, { status: 400 });
        }
        const candidates = actionVariableOptions[variableKey];
        if (Array.isArray(candidates) && candidates.length > 0 && !new Set(candidates).has(targetValue)) {
          await finishMapActionIdempotency({
            idempotencyKey: eventResolveIdempotencyKey,
            status: "rejected",
            reason: `AI 变量 {{${variableKey}}} 不在候选范围内`,
            result: { eventId },
          });
          return NextResponse.json({
            success: false,
            error: `AI 变量 {{${variableKey}}} 不在候选范围内`,
          }, { status: 400 });
        }
      }
      narrative = aiResult.narrative;
      aiVariables = aiResult.variables;
    } else if (evt.aiPrompt) {
      try {
        narrative = await narrateEvent(evt.aiPrompt, player.name || "无名修士", player.realmName);
      } catch {
        narrative = evt.description || "你遇到了一件奇事...";
      }
    }

    const rewardsWithName = await applyRandomEventRewards({
      playerId: player.id,
      rewards,
      sourceRef: pending && pending.sourceType === "opportunity" && pending.sourceRef
        ? `${evt.id}:${pending.sourceRef}`
        : evt.id,
      aiVariables,
    });

    const responseData = {
      event: {
        name: evt.name,
        type: evt.eventType,
        narrative,
        imageUrl,
        rewards: rewardsWithName,
      },
    };
    await finishMapActionIdempotency({
      idempotencyKey: eventResolveIdempotencyKey,
      status: "accepted",
      result: responseData,
    });
    clearPendingMapEvent(player.id);

    return NextResponse.json({
      success: true,
      data: {
        ...responseData,
        protocol: normalizedProtocolInput.protocolMeta,
      },
    });
  } catch (e) {
    console.error("Resolve map event error:", e);
    const errorMessage = e instanceof Error ? e.message : "事件结算失败";
    if (eventResolveIdempotencyKey) {
      console.error("Resolve map event left pending for manual reconciliation:", {
        idempotencyKey: eventResolveIdempotencyKey,
        error: errorMessage,
      });
    }
    return NextResponse.json({ success: false, error: errorMessage }, { status: 400 });
  }
}
