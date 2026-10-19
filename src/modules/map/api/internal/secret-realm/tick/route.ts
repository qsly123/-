import { NextResponse } from "next/server";
import { getAiItemAutoCleanupState, scheduleAiItemAutoCleanup } from "@/modules/admin/services/ai-item-auto-cleanup";
import { runSecretRealmTick } from "@/modules/map/services/secret-realm-spawn-service";
import { cleanupExpiredSecretRealmInstances } from "@/modules/map/services/secret-realm-instance-service";

const INTERNAL_REALTIME_TOKEN_HEADER = "x-internal-realtime-token";

function isAuthorizedInternalRequest(request: Request) {
  const expectedToken = (process.env.INTERNAL_REALTIME_TOKEN || "").trim();
  const providedToken = (request.headers.get(INTERNAL_REALTIME_TOKEN_HEADER) || "").trim();
  return Boolean(expectedToken) && providedToken === expectedToken;
}

export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const cleanupResult = await cleanupExpiredSecretRealmInstances();
  await runSecretRealmTick();
  void scheduleAiItemAutoCleanup({
    trigger: "secret_realm_internal_tick",
  });
  const aiItemCleanup = getAiItemAutoCleanupState();
  return NextResponse.json({
    success: true,
    data: {
      executedAt: new Date().toISOString(),
      cleanupResult,
      aiItemCleanup,
    },
  });
}
