import { getSystemConfigValue } from "@/modules/system/services/system-config";

export type MapTravelMode = "direct" | "portal";

const MAP_TRAVEL_MODE_KEY = "MAP_TRAVEL_MODE";

function normalizeMapTravelMode(value: string | null | undefined): MapTravelMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "portal") {
    return "portal";
  }
  return "direct";
}

export async function getMapTravelMode(): Promise<MapTravelMode> {
  const value = await getSystemConfigValue(MAP_TRAVEL_MODE_KEY);
  return normalizeMapTravelMode(value);
}
