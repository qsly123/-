import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import { generateSecretRealmTemplate } from "@/modules/map/services/secret-realm-generation-service";
import { normalizeSecretRealmRarity, normalizeSecretRealmSizeTier } from "@/modules/map/services/secret-realm-balance-service";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as {
      recommendedRealm?: unknown;
      sizeTier?: unknown;
      rarity?: unknown;
      forceFallback?: unknown;
    };

    const recommendedRealm = Math.max(1, Math.floor(Number(body.recommendedRealm) || 1));
    const template = await generateSecretRealmTemplate({
      recommendedRealm,
      sizeTier: normalizeSecretRealmSizeTier(body.sizeTier),
      rarity: normalizeSecretRealmRarity(body.rarity),
      forceFallback: body.forceFallback === true,
    });

    return NextResponse.json({
      success: true,
      data: template,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成秘境模板失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
