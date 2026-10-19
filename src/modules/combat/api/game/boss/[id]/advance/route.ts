import { POST as bossActionPost } from "@/modules/combat/api/game/boss/[id]/route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({})) as {
    partyCombatId?: unknown;
    actionId?: unknown;
    clientSentAt?: unknown;
    clientSequence?: unknown;
    clientSceneTick?: unknown;
  };
  const payload = {
    advance: true,
    ...(typeof body.partyCombatId === "string" && body.partyCombatId.trim()
      ? { partyCombatId: body.partyCombatId.trim() }
      : {}),
    ...(typeof body.actionId === "string" && body.actionId.trim()
      ? { actionId: body.actionId.trim() }
      : {}),
    ...(typeof body.clientSentAt === "number" && Number.isFinite(body.clientSentAt)
      ? { clientSentAt: body.clientSentAt }
      : {}),
    ...(typeof body.clientSequence === "number" && Number.isInteger(body.clientSequence) && body.clientSequence > 0
      ? { clientSequence: body.clientSequence }
      : {}),
    ...(typeof body.clientSceneTick === "number" && Number.isInteger(body.clientSceneTick) && body.clientSceneTick >= 0
      ? { clientSceneTick: body.clientSceneTick }
      : {}),
  };
  const actionUrl = request.url.replace(/\/advance(?=\/?$|\?)/, "");
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("Content-Type", "application/json");
  return bossActionPost(new Request(actionUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }), context);
}
