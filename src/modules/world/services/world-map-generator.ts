import type { TileData } from "@/types/game";
import {
  OPEN_WORLD_ACTIVE_NPC_LIMIT,
  OPEN_WORLD_BUILDING_ICONS,
  OPEN_WORLD_MAP_SIZE,
  OPEN_WORLD_NPCS_PER_MAP,
  OPEN_WORLD_PORTAL_IMAGE_URL,
  buildOpenWorldNpcActionLabel,
  buildOpenWorldNpcPersonalitySummary,
  buildOpenWorldSeed,
  getOpenWorldFemaleNamePool,
  getOpenWorldMapBlueprintById,
  getOpenWorldMaleNamePool,
  getOpenWorldNpcArchetypeProfile,
  getOpenWorldNpcTraitPool,
  listOpenWorldMapBlueprints,
  normalizeOpenWorldHeatTier,
  normalizeOpenWorldRegionBand,
  pickOpenWorldCustomNpcsForMap,
  resolveOpenWorldHeatTierLabel,
  type OpenWorldCustomNpcDefinition,
  type OpenWorldArchetype,
  type OpenWorldHeatTier,
  type OpenWorldRegionBand,
  type OpenWorldTravelConnectionBlueprint,
  type OpenWorldTravelConnectionRole,
  type OpenWorldTravelConnectionType,
} from "@/modules/world/services/world-config";
import {
  buildInitialOpenWorldNpcStats,
  getOpenWorldNpcRealmName,
} from "@/modules/world/services/world-npc-growth";
import { resolveOpenWorldNpcSpawnPoint } from "@/modules/world/services/world-map-walkable";

export interface GeneratedOpenWorldMapDraft {
  id: string;
  name: string;
  archetype: OpenWorldArchetype;
  regionBand: OpenWorldRegionBand;
  heatTier: OpenWorldHeatTier;
  heatScore: number;
  dangerLevel: number;
  mysteryLevel: number;
  seed: string;
  description: string;
  theme: string;
  districts: string[];
  buildingTags: string[];
  resourceThemes: string[];
  rumorSeeds: string[];
  encounterHooks: string[];
  secretRealmHooks: string[];
  travelConnections: Array<{
    role: OpenWorldTravelConnectionRole;
    targetMapId: string;
    targetMapName: string;
    travelType: OpenWorldTravelConnectionType;
    label: string;
    summary: string;
    heatTierHint: string;
  }>;
  backgroundImageUrl: string | null;
  width: number;
  height: number;
  minRealm: number;
  spawnPositionX: number;
  spawnPositionY: number;
  tilesData: TileData[];
  portals: Array<{
    id: string;
    role: OpenWorldTravelConnectionRole;
    travelType: OpenWorldTravelConnectionType;
    portalName: string;
    summary: string;
    positionX: number;
    positionY: number;
    targetWorldMapId: string;
    targetPositionX: number;
    targetPositionY: number;
    bidirectionalGroupKey: string;
  }>;
}

export interface GeneratedOpenWorldNpcDraft {
  id: string;
  worldMapId: string;
  sourceType?: "random" | "custom";
  customNpcId?: string | null;
  name: string;
  gender: "male" | "female";
  originType: string;
  profession: string;
  faction: string;
  realmName: string;
  realmMajor: number;
  realmMinor: number;
  personalitySummary: string;
  dnaSeed: string;
  traitTags: string[];
  worldBookKeywords?: string[];
  adultTags?: string[];
  grayTags?: string[];
  partnerIds?: string[];
  primaryPartnerId?: string | null;
  relationshipTags?: string[];
  behaviorWeights: Record<string, number>;
  statsSummary: Record<string, number>;
  avatarImageUrl: string | null;
  portraitImageUrl: string | null;
  runtime: {
    currentMapId: string;
    positionX: number;
    positionY: number;
    currentAction: "idle" | "wander" | "gather" | "hunt" | "loot" | "return" | "stall";
    currentActionLabel: string;
    isActivated: boolean;
  };
  initialLifeLog: {
    logType: string;
    title: string;
    content: string;
    payloadJson: Record<string, unknown>;
  };
}

type Point = {
  x: number;
  y: number;
};

const OPEN_WORLD_BACKGROUND_BY_ARCHETYPE: Record<OpenWorldArchetype, string | null> = {
  "凡人城镇": "/uploads/maps/backgrounds/default-map-bg.jpg",
  "修士坊市": "/uploads/maps/backgrounds/default-map-bg.jpg",
  "山野聚落": "/uploads/maps/backgrounds/default-map-bg.jpg",
  "边荒据点": "/uploads/maps/backgrounds/default-map-bg.jpg",
  "宗门聚落": "/uploads/maps/backgrounds/default-map-bg.jpg",
};

const OPEN_WORLD_THEME_BY_ARCHETYPE: Record<OpenWorldArchetype, string> = {
  "凡人城镇": "烟火、药香与茶肆流言并存",
  "修士坊市": "灵物、传送阵与散修交易汇聚",
  "山野聚落": "草药、山雾与猎修往返其间",
  "边荒据点": "风沙、巡防与残阵传闻不绝",
  "宗门聚落": "山门、丹房与演武坪相连，外门弟子与护山修士往来不绝",
};

const OPEN_WORLD_BUILDING_TAGS_BY_ARCHETYPE: Record<OpenWorldArchetype, string[]> = {
  "凡人城镇": ["药铺", "客栈", "茶摊", "传送阵"],
  "修士坊市": ["灵材铺", "法器摊", "符箓坊", "传送阵"],
  "山野聚落": ["药圃", "柴房", "猎棚", "回城阵"],
  "边荒据点": ["哨塔", "军帐", "补给摊", "回返阵"],
  "宗门聚落": ["山门", "演武坪", "丹房", "藏经阁", "护山阵"],
};

const OPEN_WORLD_RESOURCE_THEMES_BY_ARCHETYPE: Record<OpenWorldArchetype, string[]> = {
  "凡人城镇": ["常见草药", "坊市杂货"],
  "修士坊市": ["灵草", "碎矿", "符纸原料"],
  "山野聚落": ["野草药", "兽骨", "清泉灵泥"],
  "边荒据点": ["荒砂矿", "旧兵残片", "边地药材"],
  "宗门聚落": ["药圃灵草", "演武坪残痕", "后山灵石"],
};

const OPEN_WORLD_RUMOR_SEEDS_BY_ARCHETYPE: Record<OpenWorldArchetype, string[]> = {
  "凡人城镇": ["茶肆里总有人说东来阵夜里会自鸣", "老药农说城外草坡近来总有异香"],
  "修士坊市": ["坊市中人都在传一批旧法器要重现", "有人在传送阵旁见过带血的残符"],
  "山野聚落": ["山路上的采药客最近常提到雾中脚印", "聚落猎修说溪边总能捡到零碎战利"],
  "边荒据点": ["巡边修士说残阵深处偶有青火摇曳", "据点里流传着旧军仓尚未被搜尽"],
  "宗门聚落": ["外门都在传执事堂将重排名册", "有人说后山夜里常有剑鸣与药香同起"],
};

const PORTAL_LAYOUT = [
  { x: 2, y: 15 },
  { x: 27, y: 15 },
  { x: 15, y: 27 },
] as const;

const LEGACY_NPC_RUNTIME_POINTS: Point[] = [
  { x: 6, y: 7 },
  { x: 10, y: 7 },
  { x: 15, y: 7 },
  { x: 20, y: 7 },
  { x: 24, y: 7 },
  { x: 8, y: 11 },
  { x: 12, y: 11 },
  { x: 18, y: 11 },
  { x: 22, y: 11 },
  { x: 6, y: 15 },
  { x: 10, y: 15 },
  { x: 15, y: 15 },
  { x: 20, y: 15 },
  { x: 24, y: 15 },
  { x: 8, y: 19 },
  { x: 12, y: 19 },
  { x: 18, y: 19 },
  { x: 22, y: 19 },
  { x: 6, y: 23 },
  { x: 10, y: 23 },
  { x: 15, y: 23 },
  { x: 20, y: 23 },
  { x: 24, y: 23 },
  { x: 15, y: 26 },
];

const OPEN_WORLD_INITIAL_REALM_RANGE: Record<OpenWorldArchetype, readonly [number, number]> = {
  "凡人城镇": [1, 4],
  "修士坊市": [2, 6],
  "山野聚落": [1, 5],
  "边荒据点": [3, 7],
  "宗门聚落": [3, 7],
};

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pickBySeed<T>(values: readonly T[], seed: string, offset = 0): T {
  return values[(hashSeed(`${seed}:${offset}`) + offset) % values.length];
}

function buildNpcPreferredPoints(mapDraft: GeneratedOpenWorldMapDraft) {
  if (mapDraft.archetype === "宗门聚落") {
    return LEGACY_NPC_RUNTIME_POINTS;
  }

  const columns = 5;
  const rows = 5;
  const points: Point[] = [];
  const reservedKeys = new Set<string>([
    `${mapDraft.spawnPositionX},${mapDraft.spawnPositionY}`,
    ...PORTAL_LAYOUT.map((point) => `${point.x},${point.y}`),
  ]);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const baseX = Math.max(2, Math.min(mapDraft.width - 3, 3 + column * 5));
      const baseY = Math.max(2, Math.min(mapDraft.height - 3, 3 + row * 5));
      const pointKey = `${baseX},${baseY}`;
      if (reservedKeys.has(pointKey)) {
        continue;
      }
      points.push({ x: baseX, y: baseY });
    }
  }

  return points;
}

function pushUniqueTile(tileMap: Map<string, TileData>, tile: TileData) {
  tileMap.set(`${tile.x}:${tile.y}`, tile);
}

function pushRectangleTiles(params: {
  tileMap: Map<string, TileData>;
  x: number;
  y: number;
  width: number;
  height: number;
  type: TileData["type"];
  walkable?: boolean;
  imageUrl?: string;
  description: string;
}) {
  for (let currentX = params.x; currentX < params.x + params.width; currentX += 1) {
    for (let currentY = params.y; currentY < params.y + params.height; currentY += 1) {
      pushUniqueTile(params.tileMap, {
        x: currentX,
        y: currentY,
        type: params.type,
        walkable: params.walkable,
        imageUrl: params.imageUrl,
        description: params.description,
      });
    }
  }
}

function buildBuildingTiles(archetype: OpenWorldArchetype) {
  const tileMap = new Map<string, TileData>();
  const icons = OPEN_WORLD_BUILDING_ICONS[archetype];
  const roadAreas = [
    { x: 2, y: 14, width: 26, height: 3, description: `${archetype}东西主街` },
    { x: 14, y: 3, width: 3, height: 25, description: `${archetype}中坊纵街` },
    { x: 13, y: 22, width: 5, height: 6, description: `${archetype}南向驿路` },
    { x: 5, y: 7, width: 20, height: 2, description: `${archetype}北街巷道` },
    { x: 5, y: 22, width: 20, height: 2, description: `${archetype}南埠石道` },
    { x: 11, y: 11, width: 8, height: 8, description: `${archetype}中坊广场` },
    { x: 1, y: 14, width: 5, height: 3, description: `${archetype}西侧引路石道` },
    { x: 23, y: 14, width: 5, height: 3, description: `${archetype}东侧引路石道` },
  ];

  roadAreas.forEach((road) => {
    pushRectangleTiles({
      tileMap,
      x: road.x,
      y: road.y,
      width: road.width,
      height: road.height,
      type: "road",
      walkable: true,
      description: road.description,
    });
  });

  const districtBlocks = [
    { x: 4, y: 4, width: 2, height: 2, icon: icons[0], description: `${archetype}北门楼` },
    { x: 8, y: 4, width: 3, height: 2, icon: icons[1], description: `${archetype}北街铺面` },
    { x: 20, y: 4, width: 3, height: 2, icon: icons[1], description: `${archetype}北巷铺面` },
    { x: 24, y: 4, width: 2, height: 2, icon: icons[2], description: `${archetype}远客驿站` },
    { x: 4, y: 10, width: 3, height: 3, icon: icons[0], description: `${archetype}东坊小院` },
    { x: 22, y: 10, width: 3, height: 3, icon: icons[2], description: `${archetype}西坊碑亭` },
    { x: 4, y: 18, width: 3, height: 3, icon: icons[2], description: `${archetype}南埠棚屋` },
    { x: 22, y: 18, width: 3, height: 3, icon: icons[0], description: `${archetype}巡夜驻点` },
    { x: 8, y: 25, width: 3, height: 2, icon: icons[1], description: `${archetype}南埠货摊` },
    { x: 20, y: 25, width: 3, height: 2, icon: icons[0], description: `${archetype}回城小营` },
    { x: 12, y: 12, width: 2, height: 2, icon: icons[0], description: `${archetype}中坊东亭` },
    { x: 17, y: 12, width: 2, height: 2, icon: icons[1], description: `${archetype}中坊西亭` },
    { x: 12, y: 17, width: 2, height: 2, icon: icons[2], description: `${archetype}南向碑亭` },
    { x: 17, y: 17, width: 2, height: 2, icon: icons[0], description: `${archetype}回风歇脚棚` },
  ];

  districtBlocks.forEach((block) => {
    pushRectangleTiles({
      tileMap,
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      type: "building",
      walkable: false,
      imageUrl: block.icon,
      description: block.description,
    });
  });

  const sceneryPoints: Array<TileData> = [
    { x: 3, y: 15, type: "decor", imageUrl: icons[2], description: "西侧界碑" },
    { x: 6, y: 15, type: "decor", imageUrl: icons[1], description: "引路幡棚" },
    { x: 9, y: 9, type: "decor", imageUrl: icons[2], description: "北街风闻牌" },
    { x: 15, y: 10, type: "decor", imageUrl: icons[0], description: "药息石座" },
    { x: 22, y: 9, type: "decor", imageUrl: icons[1], description: "脚夫驿点" },
    { x: 24, y: 15, type: "decor", imageUrl: icons[1], description: "东阵引路棚" },
    { x: 26, y: 15, type: "decor", imageUrl: icons[2], description: "东侧返行碑" },
    { x: 15, y: 14, type: "decor", imageUrl: icons[2], description: "中坊石碑" },
    { x: 15, y: 18, type: "decor", imageUrl: icons[2], description: "广场南碑" },
    { x: 10, y: 15, type: "decor", imageUrl: icons[0], description: "东坊茶棚" },
    { x: 20, y: 15, type: "decor", imageUrl: icons[0], description: "西坊脚店" },
    { x: 8, y: 24, type: "decor", imageUrl: icons[2], description: "南街路标" },
    { x: 22, y: 24, type: "decor", imageUrl: icons[2], description: "南埠旧碑" },
    { x: 15, y: 5, type: "decor", imageUrl: icons[2], description: "北街路标" },
    { x: 15, y: 26, type: "decor", imageUrl: icons[2], description: "南向路碑" },
  ];
  sceneryPoints.forEach((tile) => pushUniqueTile(tileMap, tile));

  for (let x = 5; x <= 25; x += 5) {
    pushUniqueTile(tileMap, {
      x,
      y: 15,
      type: "decor",
      walkable: true,
      imageUrl: icons[(Math.floor(x / 5) + 1) % icons.length],
      description: `${archetype}主街地标`,
    });
  }

  for (let y = 6; y <= 24; y += 4) {
    pushUniqueTile(tileMap, {
      x: 15,
      y,
      type: "decor",
      walkable: true,
      imageUrl: icons[(Math.floor(y / 4) + 2) % icons.length],
      description: `${archetype}纵向引路标`,
    });
  }

  return Array.from(tileMap.values());
}

function findReciprocalPortalIndex(targetMapId: string, currentMapId: string) {
  const targetBlueprint = getOpenWorldMapBlueprintById(targetMapId);
  if (!targetBlueprint) {
    return 0;
  }
  const matchedIndex = targetBlueprint.travelConnections.findIndex((connection) => connection.targetMapId === currentMapId);
  return matchedIndex >= 0 ? matchedIndex : 0;
}

function buildPortalTiles(params: {
  mapId: string;
  travelConnections: OpenWorldTravelConnectionBlueprint[];
}) {
  return params.travelConnections.map((connection, index) => {
    const portal = PORTAL_LAYOUT[index] || PORTAL_LAYOUT[0];
    const reciprocalPortalIndex = findReciprocalPortalIndex(connection.targetMapId, params.mapId);

    return {
      x: portal.x,
      y: portal.y,
    type: "portal",
    walkable: true,
    imageUrl: OPEN_WORLD_PORTAL_IMAGE_URL,
    portalId: `${params.mapId}:portal:${index + 1}`,
      portalName: connection.label,
      portalTargetMapId: connection.targetMapId,
      portalTargetPortalId: `${connection.targetMapId}:portal:${reciprocalPortalIndex + 1}`,
      portalTargetName: connection.targetMapName,
      description: `${connection.label}可前往${connection.targetMapName}。${connection.summary}`,
    } satisfies TileData;
  });
}

function buildMapTiles(params: {
  mapId: string;
  archetype: OpenWorldArchetype;
  travelConnections: OpenWorldTravelConnectionBlueprint[];
}) {
  return [
    ...buildBuildingTiles(params.archetype),
    ...buildPortalTiles(params),
  ];
}

function buildNpcAvatar(gender: "male" | "female", slot: number) {
  void slot;
  return gender === "female" ? "/static/female.png" : "/static/male.png";
}

function buildDraftLifeLog(params: {
  id: string;
  name: string;
  mapDraft: GeneratedOpenWorldMapDraft;
  titleSeed: string;
  customNpc?: OpenWorldCustomNpcDefinition | null;
}) {
  return {
    logType: "born",
    title: "入世",
    content: params.customNpc
      ? `${params.name}循着旧缘踏入${params.mapDraft.name}，表面像个寻常来客，实则另有自己的旧账与去处。`
      : `${params.name}在${params.mapDraft.name}安下脚跟，正忙着${params.titleSeed}，想在${params.mapDraft.archetype}里慢慢攒下一条活路。`,
    payloadJson: {
      mapId: params.mapDraft.id,
      mapName: params.mapDraft.name,
      archetype: params.mapDraft.archetype,
      customNpcId: params.customNpc?.id || null,
      worldBookKeywords: params.customNpc?.worldBookKeywords || [],
      grayTags: params.customNpc?.grayTags || [],
      adultTags: params.customNpc?.adultTags || [],
      partnerIds: params.customNpc?.partnerIds || [],
      primaryPartnerId: params.customNpc?.primaryPartnerId || "",
      relationshipTags: params.customNpc?.relationshipTags || [],
    },
  };
}

export function buildOpenWorldMapDrafts() {
  return listOpenWorldMapBlueprints().map((blueprint, index) => {
    const tilesData = buildMapTiles({
      mapId: blueprint.id,
      archetype: blueprint.archetype,
      travelConnections: blueprint.travelConnections,
    });

    return {
      id: blueprint.id,
      name: blueprint.name,
      archetype: blueprint.archetype,
      regionBand: normalizeOpenWorldRegionBand(blueprint.regionBand),
      heatTier: normalizeOpenWorldHeatTier(blueprint.heatTier),
      heatScore: blueprint.heatScore,
      dangerLevel: blueprint.dangerLevel,
      mysteryLevel: blueprint.mysteryLevel,
      seed: buildOpenWorldSeed("open-world", index + 1),
      description: blueprint.description,
      theme: blueprint.theme || OPEN_WORLD_THEME_BY_ARCHETYPE[blueprint.archetype],
      districts: blueprint.districts,
      buildingTags: blueprint.buildingTags.length > 0 ? blueprint.buildingTags : OPEN_WORLD_BUILDING_TAGS_BY_ARCHETYPE[blueprint.archetype],
      resourceThemes: blueprint.resourceThemes.length > 0 ? blueprint.resourceThemes : OPEN_WORLD_RESOURCE_THEMES_BY_ARCHETYPE[blueprint.archetype],
      rumorSeeds: blueprint.rumorSeeds.length > 0 ? blueprint.rumorSeeds : OPEN_WORLD_RUMOR_SEEDS_BY_ARCHETYPE[blueprint.archetype],
      encounterHooks: blueprint.encounterHooks,
      secretRealmHooks: blueprint.secretRealmHooks,
      travelConnections: blueprint.travelConnections.map((connection) => ({
        ...connection,
        heatTierHint: resolveOpenWorldHeatTierLabel(
          normalizeOpenWorldHeatTier(getOpenWorldMapBlueprintById(connection.targetMapId)?.heatTier),
        ),
      })),
      backgroundImageUrl: OPEN_WORLD_BACKGROUND_BY_ARCHETYPE[blueprint.archetype],
      width: OPEN_WORLD_MAP_SIZE,
      height: OPEN_WORLD_MAP_SIZE,
      minRealm: 1,
      spawnPositionX: 15,
      spawnPositionY: 15,
      tilesData,
      portals: blueprint.travelConnections.map((connection, portalIndex) => {
        const reciprocalPortalIndex = findReciprocalPortalIndex(connection.targetMapId, blueprint.id);
        const portal = PORTAL_LAYOUT[portalIndex] || PORTAL_LAYOUT[0];
        const targetPortal = PORTAL_LAYOUT[reciprocalPortalIndex] || PORTAL_LAYOUT[0];

        return {
          id: `${blueprint.id}:portal:${portalIndex + 1}`,
          role: connection.role,
          travelType: connection.travelType,
          portalName: connection.label,
          summary: connection.summary,
        positionX: portal.x,
        positionY: portal.y,
          targetWorldMapId: connection.targetMapId,
          targetPositionX: targetPortal.x,
          targetPositionY: targetPortal.y,
          bidirectionalGroupKey: `world-route-${[blueprint.id, connection.targetMapId].sort().join(":")}`,
        };
      }),
    } satisfies GeneratedOpenWorldMapDraft;
  });
}

export function buildOpenWorldNpcDrafts(mapDraft: GeneratedOpenWorldMapDraft) {
  const occupiedSpawnPoints: Point[] = [];
  const preferredPoints = buildNpcPreferredPoints(mapDraft);
  const femaleNamePool = getOpenWorldFemaleNamePool();
  const maleNamePool = getOpenWorldMaleNamePool();
  const traitPool = getOpenWorldNpcTraitPool();
  const customNpcs = pickOpenWorldCustomNpcsForMap({
    mapId: mapDraft.id,
    mapName: mapDraft.name,
    archetype: mapDraft.archetype,
    regionBand: mapDraft.regionBand,
  });

  return Array.from({ length: OPEN_WORLD_NPCS_PER_MAP }).map((_, index) => {
    const customNpc = customNpcs[index] || null;
    const npcSeed = customNpc
      ? `${mapDraft.seed}:custom:${customNpc.id}`
      : `${mapDraft.seed}:npc:${index + 1}`;
    const archetypeProfile = getOpenWorldNpcArchetypeProfile(mapDraft.archetype);
    const gender = customNpc
      ? customNpc.gender
      : (hashSeed(`${npcSeed}:gender`) % 2 === 0 ? "male" : "female") as "male" | "female";
    const name = customNpc
      ? customNpc.name
      : pickBySeed(gender === "female" ? femaleNamePool : maleNamePool, npcSeed, index);
    const [realmMin, realmMax] = OPEN_WORLD_INITIAL_REALM_RANGE[mapDraft.archetype];
    const realmMinor = customNpc
      ? Math.max(realmMin, Math.min(realmMax + 2, customNpc.realmMinor))
      : realmMin + (hashSeed(`${npcSeed}:realm`) % Math.max(1, (realmMax - realmMin + 1)));
    const realmName = getOpenWorldNpcRealmName(realmMinor);
    const traits = customNpc
      ? customNpc.traitTags
      : [
        pickBySeed(traitPool, npcSeed, 1),
        pickBySeed(traitPool, npcSeed, 2),
        pickBySeed(traitPool, npcSeed, 3),
      ].filter((value, currentIndex, values) => values.indexOf(value) === currentIndex);
    const runtimePoint = resolveOpenWorldNpcSpawnPoint({
      seed: npcSeed,
      index,
      preferredPoints,
      tilesData: mapDraft.tilesData,
      width: mapDraft.width,
      height: mapDraft.height,
      occupiedPoints: occupiedSpawnPoints,
      minDistanceFromOccupiedPoints: 3,
    });
    occupiedSpawnPoints.push(runtimePoint);
    const currentAction = ([
      "wander",
      "gather",
      "hunt",
      "loot",
      "return",
      "stall",
    ] as const)[hashSeed(`${npcSeed}:action`) % 6];
    const originType = customNpc ? customNpc.originType : pickBySeed(archetypeProfile.origins, npcSeed, 5);
    const profession = customNpc ? customNpc.profession : pickBySeed(archetypeProfile.professions, npcSeed, 6);
    const faction = customNpc ? customNpc.faction : pickBySeed(archetypeProfile.factions, npcSeed, 7);
    const statsSummary = buildInitialOpenWorldNpcStats({
      seed: npcSeed,
      realmMinor,
      profession,
      traitTags: traits,
    });
    const titleSeed = pickBySeed(
      mapDraft.archetype === "宗门聚落"
        ? ["盯着山门名册", "惦记下一场演武", "守着丹房火候", "总想着往内门再进一步"]
        : ["捡药途中", "在集上讨生活", "盯着风声行事", "总想多攒些资粮"],
      npcSeed,
      4,
    );

    return {
      id: customNpc ? `${mapDraft.id}:custom:${customNpc.id}` : `${mapDraft.id}:npc:${index + 1}`,
      worldMapId: mapDraft.id,
      sourceType: customNpc ? "custom" : "random",
      customNpcId: customNpc?.id || null,
      name,
      gender,
      originType,
      profession,
      faction,
      realmName,
      realmMajor: 1,
      realmMinor,
      personalitySummary: buildOpenWorldNpcPersonalitySummary({
        seed: npcSeed,
        name,
        originType,
        profession,
        faction,
        traitTags: traits,
      }),
      dnaSeed: npcSeed,
      traitTags: traits,
      worldBookKeywords: customNpc?.worldBookKeywords || [],
      adultTags: customNpc?.adultTags || [],
      grayTags: customNpc?.grayTags || [],
      partnerIds: customNpc?.partnerIds || [],
      primaryPartnerId: customNpc?.primaryPartnerId || null,
      relationshipTags: customNpc?.relationshipTags || [],
      behaviorWeights: archetypeProfile.behaviorWeights,
      statsSummary,
      avatarImageUrl: buildNpcAvatar(gender, index),
      portraitImageUrl: buildNpcAvatar(gender, index),
      runtime: {
        currentMapId: mapDraft.id,
        positionX: runtimePoint.x,
        positionY: runtimePoint.y,
        currentAction,
        currentActionLabel: buildOpenWorldNpcActionLabel({
          action: currentAction,
          seed: `${npcSeed}:action-label`,
          profession,
          faction,
          traitTags: traits,
        }),
        isActivated: index < OPEN_WORLD_ACTIVE_NPC_LIMIT,
      },
      initialLifeLog: buildDraftLifeLog({
        id: customNpc ? `${mapDraft.id}:custom:${customNpc.id}` : `${mapDraft.id}:npc:${index + 1}`,
        name,
        mapDraft,
        titleSeed,
        customNpc,
      }),
    } satisfies GeneratedOpenWorldNpcDraft;
  });
}
