import { createActionRequestMeta } from "@/modules/shared/services/action-request";

export type OpportunityPosition = { positionX: number; positionY: number };

export function hasOpportunityAtPosition(
  opportunities: readonly OpportunityPosition[], position: { x: number; y: number },
): boolean {
  return opportunities.some((entry) => entry.positionX === position.x && entry.positionY === position.y);
}

/** 在移动ACK之后调用；失败只影响领取，不推翻已经落账的移动。 */
export async function claimOpportunityAtPosition(params: {
  mapId: string; x: number; y: number; clientSequence: number; clientSceneTick: number;
}): Promise<{ event?: unknown; message?: string }> {
  try {
    const response = await fetch("/api/game/map/opportunity/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, entityId: `opportunity-position:${params.mapId}:${params.x}:${params.y}`,
        ...createActionRequestMeta({ clientSequence: params.clientSequence, clientSceneTick: params.clientSceneTick }) }),
    });
    const result = await response.json() as { success: boolean; error?: string; data?: { event?: unknown; message?: string } };
    return result.success ? (result.data ?? {}) : { message: result.error || "机缘领取失败，请在当前位置再次点击重试" };
  } catch {
    return { message: "机缘领取未确认，请在当前位置再次点击重试" };
  }
}
