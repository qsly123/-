import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { aiMemories, quests } from "@/db/schema";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { advanceTalkQuestProgress } from "@/modules/quest/services/quest-service";
import { encodeNpcEvent, executeNpcToolCall } from "@/modules/quest/services/npc-task-tools";
import { NpcInteractionError, requireNpcInteraction } from "@/modules/map/services/npc-interaction";
import { getSafeWorldQuestActionGate } from "@/modules/world/services/player-world-pressure-service";

type QuestAction = "accept" | "complete";
type QuestEvent = {
  type: "quest.accepted" | "quest.completed";
  payload: Record<string, unknown>;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveQuestAction(raw: unknown): QuestAction | null {
  return raw === "accept" || raw === "complete" ? raw : null;
}

function resolveUserMessage(action: QuestAction, questName: string) {
  const normalized = questName.trim();
  const target = normalized
    ? (normalized.endsWith("任务") ? normalized : `${normalized}任务`)
    : "任务";
  if (action === "accept") {
    return `我要接收${target}`;
  }
  return `我要完成${target}`;
}

function resolveQuestNameFromEvent(event: QuestEvent | null): string {
  if (!event) return "";
  const name = event.payload.questName;
  return typeof name === "string" ? name.trim() : "";
}

function resolveToolCall(action: QuestAction, questId: string, questName: string) {
  const args: Record<string, string> = {};
  if (questId) {
    args.questId = questId;
  }
  if (questName) {
    args.questName = questName;
  }
  return {
    id: `ui.${action}`,
    name: action === "accept" ? "accept_npc_quest" : "complete_npc_quest",
    arguments: JSON.stringify(args),
  };
}

async function tryCompleteTalkQuestImmediately(params: {
  playerId: string;
  npcId: string;
  acceptedEvent: QuestEvent;
}) {
  const acceptedQuestId = normalizeText(params.acceptedEvent.payload.questId);
  if (!acceptedQuestId) {
    return null;
  }

  const quest = await db.select({
    id: quests.id,
    questType: quests.questType,
  }).from(quests).where(eq(quests.id, acceptedQuestId)).get();
  if (!quest || quest.questType !== "talk") {
    return null;
  }

  await advanceTalkQuestProgress(params.playerId, params.npcId);

  const executed = await executeNpcToolCall({
    playerId: params.playerId,
    npcId: params.npcId,
    toolCall: resolveToolCall("complete", acceptedQuestId, ""),
  });

  if (!executed.event) {
    return {
      event: null,
      reply: executed.resultText || "",
    };
  }

  return {
    event: executed.event as QuestEvent,
    reply: executed.resultText || "",
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const { id: npcId } = await params;
    const npc = await requireNpcInteraction({ playerId: player.id, npcId });

    const body = await request.json() as {
      action?: unknown;
      questId?: unknown;
      questName?: unknown;
    };
    const action = resolveQuestAction(body.action);
    if (!action) {
      return NextResponse.json({ success: false, error: "action 非法" }, { status: 400 });
    }

    const questId = normalizeText(body.questId);
    const questName = normalizeText(body.questName);
    if (!questId && !questName) {
      return NextResponse.json({ success: false, error: "缺少 questId 或 questName" }, { status: 400 });
    }

    const questConditions = [];
    if (questId) {
      questConditions.push(eq(quests.id, questId));
    }
    if (questName) {
      questConditions.push(eq(quests.name, questName));
    }
    const questMeta = questConditions.length > 0
      ? await db.select({
      id: quests.id,
      questType: quests.questType,
      questCategory: quests.questCategory,
    }).from(quests)
        .where(or(...questConditions))
        .get()
      : null;
    if (questMeta) {
      const worldGate = await getSafeWorldQuestActionGate({
        playerId: player.id,
        npcId,
        questCategory: questMeta.questCategory === "main" ? "main" : "side",
        questType: questMeta.questType,
      });
      if (!worldGate.allowed) {
        return NextResponse.json({ success: false, error: worldGate.reason || "当前天道风声不利于办理此事" }, { status: 400 });
      }
    }

    // 传话类任务的进度原本只在 NPC 对话接口里推进（对话接口先推进、再调 LLM）。
    // LLM 不可用时那条路会 500，而玩家点「完成」本身就是一次传话交互，
    // 因此这里先推进一次，保证不依赖 LLM 也能交差。
    // 不区分任务类型：推进函数内部只会对「talk 需求且目标为当前 NPC」的生效任务累加。
    if (action === "complete") {
      await advanceTalkQuestProgress(player.id, npcId);
    }

    const executed = await executeNpcToolCall({
      playerId: player.id,
      npcId,
      toolCall: resolveToolCall(action, questId, questName),
    });

    if (!executed.event) {
      return NextResponse.json({ success: false, error: executed.resultText || "任务办理失败" }, { status: 400 });
    }

    const events: QuestEvent[] = [executed.event as QuestEvent];
    const replyParts: string[] = [];
    if (executed.resultText) {
      replyParts.push(executed.resultText);
    }

    const hasPersonality = normalizeText(npc.personality).length > 0;
    if (action === "accept" && !hasPersonality && executed.event.type === "quest.accepted") {
      const autoComplete = await tryCompleteTalkQuestImmediately({
        playerId: player.id,
        npcId,
        acceptedEvent: executed.event as QuestEvent,
      });
      if (autoComplete) {
        if (autoComplete.event) {
          events.push(autoComplete.event);
        }
        if (autoComplete.reply) {
          replyParts.push(autoComplete.reply);
        }
      }
    }

    const primaryQuestName = resolveQuestNameFromEvent(events[0])
      || questName
      || questId
      || "任务";
    const userMessage = resolveUserMessage(action, primaryQuestName);
    const reply = replyParts.filter(Boolean).join("\n").trim() || "此事已办妥。";

    await db.insert(aiMemories).values({
      npcId,
      playerId: player.id,
      role: "user",
      content: userMessage,
    }).run();

    for (const event of events) {
      await db.insert(aiMemories).values({
        npcId,
        playerId: player.id,
        role: "assistant",
        content: encodeNpcEvent(event),
      }).run();
    }

    await db.insert(aiMemories).values({
      npcId,
      playerId: player.id,
      role: "assistant",
      content: reply,
    }).run();

    return NextResponse.json({
      success: true,
      data: {
        userMessage,
        reply,
        events,
      },
    });
  } catch (error) {
    if (error instanceof NpcInteractionError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("NPC quest action error:", error);
    return NextResponse.json({ success: false, error: "办理任务失败" }, { status: 500 });
  }
}
