type TileEntity = {
  x: number;
  y: number;
  type: string;
  walkable?: boolean;
  imageUrl?: string;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
  portalTargetPortalId?: string;
  portalTargetName?: string;
  portalExtraTargets?: Array<{
    mapId?: string;
    mapName?: string;
    portalId?: string;
    label?: string;
  }>;
};

export interface PortalTravelTarget {
  mapId: string;
  mapName?: string;
  portalId?: string;
  label?: string;
}

export interface PortalTilePosition {
  x: number;
  y: number;
}

export interface PortalTileData extends PortalTilePosition {
  imageUrl?: string;
  portalId?: string;
  portalName?: string;
  portalTargetMapId?: string;
  portalTargetPortalId?: string;
  portalTargetName?: string;
  portalExtraTargets?: PortalTravelTarget[];
}

function normalizePortalExtraTargets(value: unknown): PortalTravelTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const row = entry as Record<string, unknown>;
    const mapId = String(row.mapId || "").trim();
    if (!mapId) {
      return [];
    }
    return [{
      mapId,
      mapName: typeof row.mapName === "string" ? row.mapName : undefined,
      portalId: typeof row.portalId === "string" ? row.portalId : undefined,
      label: typeof row.label === "string" ? row.label : undefined,
    }];
  });
}

function normalizeTiles(tilesData: unknown): TileEntity[] {
  if (!Array.isArray(tilesData)) {
    return [];
  }

  return tilesData.filter((tile): tile is TileEntity => {
    if (!tile || typeof tile !== "object" || Array.isArray(tile)) {
      return false;
    }
    const row = tile as Record<string, unknown>;
    return Number.isFinite(row.x) && Number.isFinite(row.y) && typeof row.type === "string";
  });
}

export function listWalkablePortalTiles(tilesData: unknown): PortalTileData[] {
  return normalizeTiles(tilesData)
    .filter((tile) => tile.type === "portal" && tile.walkable !== false)
    .map((tile) => ({
      x: tile.x,
      y: tile.y,
      imageUrl: tile.imageUrl,
      portalId: tile.portalId,
      portalName: tile.portalName,
      portalTargetMapId: tile.portalTargetMapId,
      portalTargetPortalId: tile.portalTargetPortalId,
      portalTargetName: tile.portalTargetName,
      portalExtraTargets: normalizePortalExtraTargets(tile.portalExtraTargets),
    }))
    .sort((a, b) => {
      if (a.x !== b.x) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });
}

export function getPortalTileAt(tilesData: unknown, x: number, y: number): PortalTileData | null {
  return listWalkablePortalTiles(tilesData).find((tile) => tile.x === x && tile.y === y) || null;
}

export function isPortalTile(tilesData: unknown, x: number, y: number): boolean {
  return Boolean(getPortalTileAt(tilesData, x, y));
}

export function listPortalTravelTargets(portal: PortalTileData | null | undefined): PortalTravelTarget[] {
  if (!portal) {
    return [];
  }

  const next: PortalTravelTarget[] = [];
  const primaryMapId = String(portal.portalTargetMapId || "").trim();
  if (primaryMapId) {
    next.push({
      mapId: primaryMapId,
      mapName: portal.portalTargetName,
      portalId: portal.portalTargetPortalId,
    });
  }
  for (const target of normalizePortalExtraTargets(portal.portalExtraTargets)) {
    if (next.some((item) => item.mapId === target.mapId && (item.portalId || "") === (target.portalId || ""))) {
      continue;
    }
    next.push(target);
  }
  return next;
}

export function getPortalTravelTarget(portal: PortalTileData | null | undefined, targetMapId?: string | null) {
  const list = listPortalTravelTargets(portal);
  if (list.length === 0) {
    return null;
  }
  const normalizedTargetMapId = String(targetMapId || "").trim();
  if (!normalizedTargetMapId) {
    return list[0];
  }
  return list.find((item) => item.mapId === normalizedTargetMapId) || null;
}

export function pickPortalSpawn(tilesData: unknown, portalId?: string | null): PortalTilePosition | null {
  const list = listWalkablePortalTiles(tilesData);
  if (list.length === 0) {
    return null;
  }
  const normalizedPortalId = String(portalId || "").trim();
  if (normalizedPortalId) {
    const matched = list.find((tile) => tile.portalId === normalizedPortalId);
    if (matched) {
      return matched;
    }
  }
  return list[0];
}
