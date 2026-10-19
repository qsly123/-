import { publishMapRefresh } from "@/modules/map/services/map-presence";

export function publishMapStructureChanged(params: {
  mapIds: Array<string | null | undefined>;
  source: string;
}) {
  const mapIds = Array.from(new Set(
    params.mapIds
      .map((mapId) => String(mapId || "").trim())
      .filter(Boolean),
  ));

  for (const mapId of mapIds) {
    publishMapRefresh({
      mapId,
      reason: "map_structure",
    });
  }

  if (mapIds.length > 0) {
    console.info("[map-structure] cache invalidated", {
      source: params.source,
      mapIds,
    });
  }
}
