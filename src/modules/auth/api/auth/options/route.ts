import { NextResponse } from "next/server";
import { getLinuxDoLoginEnabled } from "@/modules/system/services/feature-switch";
import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { GAME_BRAND_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

const DEFAULT_GAME_TITLE = "灵虚·长生录";
const DEFAULT_GAME_SUBTITLE = "踏上修仙之路，问鼎长生大道";

export async function GET() {
  let linuxDoLoginEnabled = false;
  let gameTitle = DEFAULT_GAME_TITLE;
  let gameSubtitle = DEFAULT_GAME_SUBTITLE;

  try {
    linuxDoLoginEnabled = await getLinuxDoLoginEnabled();
  } catch (error) {
    console.error("Get auth options error:", error);
  }

  try {
    const configMap = await getSystemConfigMap(GAME_BRAND_CONFIG_KEYS);
    gameTitle = configMap.GAME_TITLE?.trim() || DEFAULT_GAME_TITLE;
    gameSubtitle = configMap.GAME_SUBTITLE?.trim() || DEFAULT_GAME_SUBTITLE;
  } catch (error) {
    console.error("Get auth page copy error:", error);
  }

  return NextResponse.json({
    success: true,
    data: {
      linuxDoLoginEnabled,
      gameTitle,
      gameSubtitle,
    },
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
