import { buildOpenWorldMapDrafts } from "@/modules/world/services/world-map-generator";

export type OpenWorldDistrictInfo = {
  name: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

function buildDistrictsByMapId(): Map<string, OpenWorldDistrictInfo[]> {
  const drafts = buildOpenWorldMapDrafts();
  return new Map<string, OpenWorldDistrictInfo[]>(drafts.map((draft) => {
    const districts: OpenWorldDistrictInfo[] = [
      {
        name: draft.districts[0] || `${draft.name}北街`,
        xMin: 0,
        xMax: draft.width - 1,
        yMin: 0,
        yMax: Math.floor(draft.height / 3) - 1,
      },
      {
        name: draft.districts[1] || `${draft.name}中坊`,
        xMin: 0,
        xMax: draft.width - 1,
        yMin: Math.floor(draft.height / 3),
        yMax: Math.floor((draft.height * 2) / 3) - 1,
      },
      {
        name: draft.districts[2] || `${draft.name}南埠`,
        xMin: 0,
        xMax: draft.width - 1,
        yMin: Math.floor((draft.height * 2) / 3),
        yMax: draft.height - 1,
      },
    ];
    return [draft.id, districts];
  }));
}

const OPEN_WORLD_DISTRICTS_BY_MAP_ID: ReadonlyMap<string, OpenWorldDistrictInfo[]> = buildDistrictsByMapId();

export function listOpenWorldDistricts(mapId: string) {
  return OPEN_WORLD_DISTRICTS_BY_MAP_ID.get(mapId) || [];
}

export function resolveOpenWorldDistrictName(params: {
  mapId: string;
  positionX: number;
  positionY: number;
}) {
  const districts = listOpenWorldDistricts(params.mapId);
  const matched = districts.find((district) => (
    params.positionX >= district.xMin
    && params.positionX <= district.xMax
    && params.positionY >= district.yMin
    && params.positionY <= district.yMax
  ));
  return matched?.name || null;
}
