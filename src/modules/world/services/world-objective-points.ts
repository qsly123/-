import { buildOpenWorldMapDrafts } from "@/modules/world/services/world-map-generator";
import { resolveOpenWorldDistrictName } from "@/modules/world/services/world-district-service";

export type OpenWorldObjectivePointType =
  | "rumor_stela"
  | "shadow_contact"
  | "black_market_stall"
  | "hidden_shrine"
  | "smuggling_gate";

export type OpenWorldObjectivePoint = {
  id: string;
  mapId: string;
  label: string;
  pointType: OpenWorldObjectivePointType;
  pointTypeLabel: string;
  districtName: string | null;
  positionX: number;
  positionY: number;
  description: string;
  interactionHint: string;
};

type ObjectivePointSeed = {
  pointType: OpenWorldObjectivePointType;
  offsetX: number;
  offsetY: number;
};

const OPEN_WORLD_OBJECTIVE_POINT_SEEDS: ObjectivePointSeed[] = [
  {
    pointType: "rumor_stela",
    offsetX: 15,
    offsetY: 6,
  },
  {
    pointType: "shadow_contact",
    offsetX: 9,
    offsetY: 15,
  },
  {
    pointType: "black_market_stall",
    offsetX: 21,
    offsetY: 15,
  },
  {
    pointType: "hidden_shrine",
    offsetX: 15,
    offsetY: 24,
  },
  {
    pointType: "smuggling_gate",
    offsetX: 24,
    offsetY: 23,
  },
];

function clampPoint(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

function resolveObjectivePointMeta(pointType: OpenWorldObjectivePointType, townName: string) {
  switch (pointType) {
    case "rumor_stela":
      return {
        label: `${townName}风闻碑`,
        pointTypeLabel: "风闻牌",
        description: "石碑旁总有人停步换口风，许多街面消息都会先从这里散开。",
        interactionHint: "可在此打探风声、听取口风、留意委托尾巴。",
      };
    case "shadow_contact":
      return {
        label: `${townName}灰巷接头`,
        pointTypeLabel: "灰线接头点",
        description: "巷口不起眼，却常有拿暗语、换口信的人从这里来去。",
        interactionHint: "适合递话、接线、换暗号与碰头。",
      };
    case "black_market_stall":
      return {
        label: `${townName}黑市小摊`,
        pointTypeLabel: "黑市小摊",
        description: "摊面卖的是寻常货色，真正见不得光的东西只认熟口风。",
        interactionHint: "适合谈黑货、收灰账、挑见不得光的门路。",
      };
    case "hidden_shrine":
      return {
        label: `${townName}偏门祠`,
        pointTypeLabel: "偏门据点",
        description: "香火寥落的角落里常藏着不能见光的货匣、帖子和旧账。",
        interactionHint: "适合藏物、交割、躲避追眼与处理灰活余波。",
      };
    default:
      return {
        label: `${townName}侧门货道`,
        pointTypeLabel: "货道口",
        description: "边巷通往外道，最适合护送黑货、改手转运与悄悄离场。",
        interactionHint: "适合接走黑货、护送转运、把麻烦顺路带出街区。",
      };
  }
}

function buildObjectivePointsByMapId() {
  const drafts = buildOpenWorldMapDrafts();
  return new Map<string, OpenWorldObjectivePoint[]>(drafts.map((draft) => {
    const points = OPEN_WORLD_OBJECTIVE_POINT_SEEDS.map((seed, index) => {
      const positionX = clampPoint(seed.offsetX, draft.width - 1);
      const positionY = clampPoint(seed.offsetY, draft.height - 1);
      const meta = resolveObjectivePointMeta(seed.pointType, draft.name);
      return {
        id: `${draft.id}:objective:${index + 1}`,
        mapId: draft.id,
        label: meta.label,
        pointType: seed.pointType,
        pointTypeLabel: meta.pointTypeLabel,
        districtName: resolveOpenWorldDistrictName({
          mapId: draft.id,
          positionX,
          positionY,
        }),
        positionX,
        positionY,
        description: meta.description,
        interactionHint: meta.interactionHint,
      } satisfies OpenWorldObjectivePoint;
    });
    return [draft.id, points];
  }));
}

const OPEN_WORLD_OBJECTIVE_POINTS_BY_MAP_ID = buildObjectivePointsByMapId();

export function listOpenWorldObjectivePoints(mapId: string) {
  return OPEN_WORLD_OBJECTIVE_POINTS_BY_MAP_ID.get(String(mapId || "").trim()) || [];
}

export function getOpenWorldObjectivePointById(mapId: string, pointId: string) {
  const normalizedPointId = String(pointId || "").trim();
  if (!normalizedPointId) {
    return null;
  }
  return listOpenWorldObjectivePoints(mapId).find((point) => point.id === normalizedPointId) || null;
}

export function pickOpenWorldObjectivePoint(params: {
  mapId: string;
  pointTypes?: OpenWorldObjectivePointType[];
  districtName?: string | null;
}) {
  const points = listOpenWorldObjectivePoints(params.mapId);
  if (points.length <= 0) {
    return null;
  }

  const pointTypes = Array.isArray(params.pointTypes) && params.pointTypes.length > 0
    ? params.pointTypes
    : null;
  const districtName = String(params.districtName || "").trim();

  const typedPoints = pointTypes
    ? points.filter((point) => pointTypes.includes(point.pointType))
    : points;
  const districtMatched = districtName
    ? typedPoints.filter((point) => point.districtName === districtName)
    : typedPoints;

  return districtMatched[0] || typedPoints[0] || points[0] || null;
}

export function isNearOpenWorldObjectivePoint(params: {
  point: Pick<OpenWorldObjectivePoint, "positionX" | "positionY">;
  positionX: number;
  positionY: number;
  maxDistance?: number;
}) {
  const maxDistance = Math.max(0, Number(params.maxDistance ?? 1));
  return Math.max(
    Math.abs(Number(params.positionX) - Number(params.point.positionX)),
    Math.abs(Number(params.positionY) - Number(params.point.positionY)),
  ) <= maxDistance;
}
