export const TILE_COLORS: Record<string, string> = {
  empty: "#1a1a2e",
  grass: "#1a2e1a",
  forest: "#0d1f0d",
  mountain: "#2a2520",
  water: "#0d1a2e",
  road: "#3a3325",
  decor: "#203124",
  building: "#2a2020",
  portal: "#2e2a1a",
};

export const ADMIN_TILE_COLORS: Record<string, string> = {
  empty: "#232844",
  grass: "#2d4e31",
  forest: "#23422c",
  mountain: "#52493b",
  water: "#2b4b74",
  road: "#635233",
  decor: "#385340",
  building: "#503c3c",
  portal: "#54472d",
};

export const TILE_ICONS: Record<string, string> = {
  mountain: "⛰️",
  water: "🌊",
  forest: "🌲",
  road: "🛤️",
  decor: "🌿",
  portal: "🌀",
  building: "🏠",
  grass: "",
  empty: "",
};

export const TILE_LABELS: Record<string, string> = {
  empty: "空地",
  grass: "草地",
  forest: "森林",
  mountain: "山地",
  water: "水域",
  road: "道路",
  decor: "景观",
  building: "建筑",
  portal: "传送点",
};

export const TILE_LEGEND_TYPES = [
  "grass",
  "forest",
  "mountain",
  "water",
  "road",
  "decor",
  "building",
  "portal",
  "empty",
] as const;

export const TILE_OPTION_TYPES = [
  "empty",
  "grass",
  "forest",
  "mountain",
  "water",
  "road",
  "decor",
  "building",
  "portal",
] as const;

export function getTileTypeOptions() {
  return TILE_OPTION_TYPES.map((value) => ({
    label: TILE_LABELS[value] || value,
    value,
  }));
}

export function getDefaultTileType(mapType?: string) {
  return mapType === "city" ? "empty" : "grass";
}
