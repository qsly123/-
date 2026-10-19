import { NextResponse } from "next/server";

export type LegacyRealtimeRetirementTarget =
  | "map-sse"
  | "combat-scene-sse";

function readBooleanEnv(name: string) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function isLegacyRealtimeRetired(target: LegacyRealtimeRetirementTarget) {
  if (readBooleanEnv("LEGACY_REALTIME_DISABLED")) {
    return true;
  }

  if (target === "map-sse") {
    return readBooleanEnv("WORLD_MAP_LEGACY_REALTIME_DISABLED");
  }

  if (target === "combat-scene-sse") {
    return readBooleanEnv("COMBAT_LEGACY_SCENE_REALTIME_DISABLED");
  }

  return false;
}

export function createLegacyRealtimeRetiredResponse(target: LegacyRealtimeRetirementTarget) {
  return NextResponse.json({
    success: false,
    error: "旧 realtime 入口已退役，请使用 Colyseus 主链。",
    errorCode: "LEGACY_REALTIME_RETIRED",
    target,
  }, { status: 410 });
}
