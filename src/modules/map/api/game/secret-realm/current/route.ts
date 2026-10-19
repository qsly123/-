import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/modules/auth/services/auth";
import { getCurrentSecretRealmForPlayer } from "@/modules/map/services/secret-realm-instance-service";
import { ensureSecretRealmRuntimeCleanup } from "@/modules/map/services/secret-realm-runtime-maintenance";

export async function GET() {
  const player = await getCurrentPlayer();
  if (!player) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  await ensureSecretRealmRuntimeCleanup();

  const currentSecretRealm = await getCurrentSecretRealmForPlayer(player.id);
  return NextResponse.json({
    success: true,
    data: currentSecretRealm,
  });
}
