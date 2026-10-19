import { db } from "@/db";
import { secretRealmTemplates } from "@/db/schema";
import { chatCompletion } from "@/modules/ai/services/ai";
import {
  buildSecretRealmMonsterPlan,
  buildSecretRealmRewardPlan,
  normalizeSecretRealmRarity,
  normalizeSecretRealmSizeTier,
  pickSecretRealmDimensions,
  pickSecretRealmRarity,
  randomInt,
  randomPick,
  validateSecretRealmSnapshot,
  SECRET_REALM_SIZE_CONFIG,
} from "@/modules/map/services/secret-realm-balance-service";
import {
  WILD_WOLF_VALLEY_HEIGHT,
  WILD_WOLF_VALLEY_NAME,
  WILD_WOLF_VALLEY_TAG,
  WILD_WOLF_VALLEY_WIDTH,
  isWildWolfValleyRealm,
} from "@/modules/map/services/secret-realm-specials";
import type { SecretRealmTemplateRecord } from "@/modules/map/services/secret-realm-types";
import type {
  SecretRealmPoint,
  SecretRealmRarity,
  SecretRealmSizeTier,
  SecretRealmTemplateSnapshot,
  SecretRealmValidationReport,
  TileData,
} from "@/types/game";

const THEME_POOL = [
  { theme: "幽谷古境", floor: "grass", wall: "mountain" },
  { theme: "残碑石窟", floor: "building", wall: "mountain" },
  { theme: "沉水洞天", floor: "water", wall: "mountain" },
  { theme: "荒林秘藏", floor: "forest", wall: "mountain" },
];

const NAME_PREFIXES = ["玄雾", "断岳", "沉星", "血砂", "镜湖", "古篆", "黑沼", "寒魄"];
const NAME_SUFFIXES = ["秘境", "洞天", "残界", "遗府", "古域", "幽窟"];
const BOSS_PREFIXES = ["噬魂", "镇岳", "镜魇", "裂骨", "幽潮", "蚀心", "玄煞"];
const BOSS_SUFFIXES = ["魔猿", "蛇君", "石将", "狼王", "尸魁", "妖主", "古卫"];

function buildTileKey(point: SecretRealmPoint) {
  return `${point.x},${point.y}`;
}

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function clampText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.slice(0, maxLength) || fallback;
}

function createBaseTiles(params: {
  width: number;
  height: number;
  floorType: string;
  wallType: string;
}) {
  const tiles: TileData[] = [];
  for (let y = 0; y < params.height; y += 1) {
    for (let x = 0; x < params.width; x += 1) {
      tiles.push({
        x,
        y,
        type: params.wallType,
        walkable: false,
      });
    }
  }
  return tiles;
}

function setWalkableTile(tiles: TileData[], width: number, point: SecretRealmPoint, type: string, extras?: Partial<TileData>) {
  const index = point.y * width + point.x;
  const current = tiles[index];
  if (!current) {
    return;
  }
  tiles[index] = {
    ...current,
    ...extras,
    x: point.x,
    y: point.y,
    type,
    walkable: true,
  };
}

function carveLinePath(
  tiles: TileData[],
  width: number,
  from: SecretRealmPoint,
  to: SecretRealmPoint,
  floorType: string,
) {
  let currentX = from.x;
  let currentY = from.y;
  setWalkableTile(tiles, width, { x: currentX, y: currentY }, floorType);

  while (currentX !== to.x || currentY !== to.y) {
    if (currentX !== to.x && currentY !== to.y) {
      if (Math.random() > 0.5) {
        currentX += currentX < to.x ? 1 : -1;
      } else {
        currentY += currentY < to.y ? 1 : -1;
      }
    } else if (currentX !== to.x) {
      currentX += currentX < to.x ? 1 : -1;
    } else if (currentY !== to.y) {
      currentY += currentY < to.y ? 1 : -1;
    }

    setWalkableTile(tiles, width, { x: currentX, y: currentY }, floorType);
  }
}

function carveRoom(
  tiles: TileData[],
  width: number,
  height: number,
  center: SecretRealmPoint,
  radius: number,
  floorType: string,
) {
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
      setWalkableTile(tiles, width, { x, y }, floorType);
    }
  }
}

function listWalkablePoints(snapshot: SecretRealmTemplateSnapshot) {
  return snapshot.tilesData
    .filter((tile) => tile.walkable !== false)
    .map((tile) => ({ x: tile.x, y: tile.y }));
}

function pickDistinctPoints(
  points: SecretRealmPoint[],
  count: number,
  reserved: SecretRealmPoint[],
) {
  const reservedKeys = new Set(reserved.map((point) => buildTileKey(point)));
  const candidates = points.filter((point) => !reservedKeys.has(buildTileKey(point)));
  const picked: SecretRealmPoint[] = [];

  while (picked.length < count && candidates.length > 0) {
    const index = randomInt(0, candidates.length - 1);
    const point = candidates.splice(index, 1)[0] as SecretRealmPoint;
    picked.push(point);
  }

  return picked;
}

function buildFallbackSnapshot(params: {
  recommendedRealm: number;
  sizeTier: SecretRealmSizeTier;
  rarity?: SecretRealmRarity;
}) {
  const sizeTier = normalizeSecretRealmSizeTier(params.sizeTier);
  const rarity = normalizeSecretRealmRarity(params.rarity || pickSecretRealmRarity(sizeTier));
  const { width, height } = pickSecretRealmDimensions(sizeTier);
  const themeMeta = randomPick(THEME_POOL);
  const entryPoint = { x: 1, y: 1 };
  const bossPoint = { x: width - 2, y: height - 2 };
  const returnPoint = { x: 1, y: 1 };
  const tilesData = createBaseTiles({
    width,
    height,
    floorType: themeMeta.floor,
    wallType: themeMeta.wall,
  });

  carveLinePath(tilesData, width, entryPoint, bossPoint, themeMeta.floor);
  carveRoom(tilesData, width, height, entryPoint, 1, themeMeta.floor);
  carveRoom(tilesData, width, height, bossPoint, sizeTier === "large" ? 2 : 1, themeMeta.floor);

  const desiredWalkable = Math.round(width * height * (1 - SECRET_REALM_SIZE_CONFIG[sizeTier].blockedRatioMax + 0.08));
  let currentWalkable = tilesData.filter((tile) => tile.walkable !== false).length;
  while (currentWalkable < desiredWalkable) {
    const seedPoint = {
      x: randomInt(1, width - 2),
      y: randomInt(1, height - 2),
    };
    carveRoom(tilesData, width, height, seedPoint, randomInt(0, sizeTier === "large" ? 2 : 1), themeMeta.floor);
    currentWalkable = tilesData.filter((tile) => tile.walkable !== false).length;
  }

  setWalkableTile(tilesData, width, returnPoint, "portal", {
    portalId: "secret-realm-return",
    portalName: "回返阵",
    description: "踏入后可返回进入秘境前的位置。",
  });
  setWalkableTile(tilesData, width, entryPoint, themeMeta.floor, {
    description: "秘境入口，回首已不见来路。",
  });
  setWalkableTile(tilesData, width, bossPoint, "building", {
    description: "Boss 镇守之地。",
  });

  const baseName = `${randomPick(NAME_PREFIXES)}${randomPick(NAME_SUFFIXES)}`;
  const bossName = `${randomPick(BOSS_PREFIXES)}${randomPick(BOSS_SUFFIXES)}`;
  const snapshot: SecretRealmTemplateSnapshot = {
    width,
    height,
    sizeTier,
    rarity,
    recommendedRealm: Math.max(1, Math.floor(params.recommendedRealm)),
    theme: themeMeta.theme,
    introduction: `${baseName}迷雾浓重，神识在此受限，唯有循迹破阵方能见到尽头。`,
    announcement: `${baseName}现世，雾障翻涌，疑有异宝出世。`,
    bossBackground: `${bossName}盘踞在${themeMeta.theme}深处，吞噬了多年沉积的煞气。`,
    entryPoint,
    returnPoint,
    bossPoint,
    blockedRatio: 0,
    tilesData,
    monsterPlan: buildSecretRealmMonsterPlan({ sizeTier, rarity }),
    rewardPlan: buildSecretRealmRewardPlan({ sizeTier, rarity }),
    tags: [themeMeta.theme, rarity, sizeTier],
  };

  const walkablePoints = listWalkablePoints(snapshot);
  const elitePoints = pickDistinctPoints(
    walkablePoints,
    sizeTier === "large" ? 4 : sizeTier === "medium" ? 2 : 1,
    [entryPoint, returnPoint, bossPoint],
  );
  const chestPoints = pickDistinctPoints(
    walkablePoints,
    sizeTier === "large" ? 5 : sizeTier === "medium" ? 3 : 1,
    [entryPoint, returnPoint, bossPoint, ...elitePoints],
  );

  for (const point of elitePoints) {
    setWalkableTile(snapshot.tilesData, width, point, themeMeta.floor, {
      description: "精英妖物徘徊之处。",
    });
  }
  for (const point of chestPoints) {
    setWalkableTile(snapshot.tilesData, width, point, themeMeta.floor, {
      description: "宝匣气息若隐若现。",
    });
  }

  const validation = validateSecretRealmSnapshot(snapshot, "fallback");
  snapshot.blockedRatio = validation.blockedRatio;

  return {
    sourceType: "fallback" as const,
    name: baseName,
    description: snapshot.introduction,
    announcement: snapshot.announcement,
    theme: snapshot.theme,
    bossBackground: snapshot.bossBackground,
    sizeTier: snapshot.sizeTier,
    rarity: snapshot.rarity,
    recommendedRealm: snapshot.recommendedRealm,
    width: snapshot.width,
    height: snapshot.height,
    rewardBudget: snapshot.rewardPlan.budget,
    snapshot,
    validation,
    tags: snapshot.tags || [],
    bossPool: [bossName],
  };
}

function buildWildWolfValleySnapshot(params: {
  recommendedRealm: number;
}) {
  const width = WILD_WOLF_VALLEY_WIDTH;
  const height = WILD_WOLF_VALLEY_HEIGHT;
  const sizeTier: SecretRealmSizeTier = "large";
  const rarity: SecretRealmRarity = "legendary";
  const entryPoint = { x: 2, y: 2 };
  const returnPoint = { x: 2, y: 2 };
  const bossPoint = { x: width - 3, y: height - 4 };
  const tilesData = createBaseTiles({
    width,
    height,
    floorType: "forest",
    wallType: "mountain",
  });

  carveLinePath(tilesData, width, entryPoint, bossPoint, "forest");
  carveRoom(tilesData, width, height, entryPoint, 3, "forest");
  carveRoom(tilesData, width, height, bossPoint, 5, "forest");

  for (let index = 0; index < 84; index += 1) {
    carveRoom(
      tilesData,
      width,
      height,
      {
        x: randomInt(2, width - 3),
        y: randomInt(2, height - 3),
      },
      randomInt(1, 4),
      "forest",
    );
  }

  for (let index = 0; index < 18; index += 1) {
    const from = {
      x: randomInt(2, width - 3),
      y: randomInt(2, height - 3),
    };
    const to = {
      x: randomInt(2, width - 3),
      y: randomInt(2, height - 3),
    };
    carveLinePath(tilesData, width, from, to, "forest");
  }

  setWalkableTile(tilesData, width, returnPoint, "portal", {
    portalId: "secret-realm-return",
    portalName: "回返阵",
    description: "谷口残阵仍留有回返之力。",
  });
  setWalkableTile(tilesData, width, entryPoint, "forest", {
    description: "野狼谷入口，风中尽是狼嚎与血腥味。",
  });
  setWalkableTile(tilesData, width, bossPoint, "building", {
    description: "狼王盘踞之地，似有鸿蒙气息回荡。",
  });

  const snapshot: SecretRealmTemplateSnapshot = {
    width,
    height,
    sizeTier,
    rarity,
    recommendedRealm: Math.max(1, Math.floor(params.recommendedRealm)),
    theme: WILD_WOLF_VALLEY_NAME,
    introduction: "一处突兀现世的超大型狼谷，谷中狼潮不绝，传闻掌天瓶曾在此显露鸿蒙灵光。",
    announcement: "超大型秘境「野狼谷」现世，谷中疑有鸿蒙至宝掌天瓶的踪迹。",
    bossBackground: "啸月狼王统御群狼，守着谷底最深处那缕鸿蒙灵机。",
    entryPoint,
    returnPoint,
    bossPoint,
    blockedRatio: 0,
    tilesData,
    monsterPlan: [
      { role: "normal", count: 28, budgetWeight: 0.58, labels: ["狼群", "群猎"] },
      { role: "elite", count: 6, budgetWeight: 0.24, labels: ["凶狼", "首领亲卫"] },
      { role: "boss", count: 1, budgetWeight: 1, labels: ["狼王", "鸿蒙异兆"] },
    ],
    rewardPlan: buildSecretRealmRewardPlan({ sizeTier, rarity }),
    tags: [WILD_WOLF_VALLEY_TAG, "hongmeng", "wolf", "legendary"],
  };

  const walkableCount = snapshot.tilesData.filter((tile) => tile.walkable !== false).length;
  const blockedRatio = 1 - (walkableCount / (width * height));
  const validation: SecretRealmValidationReport = {
    passed: true,
    source: "fallback",
    reasons: [],
    blockedRatio,
    width,
    height,
  };
  snapshot.blockedRatio = blockedRatio;

  return {
    sourceType: "fallback" as const,
    name: WILD_WOLF_VALLEY_NAME,
    description: snapshot.introduction,
    announcement: snapshot.announcement,
    theme: snapshot.theme,
    bossBackground: snapshot.bossBackground,
    sizeTier: snapshot.sizeTier,
    rarity: snapshot.rarity,
    recommendedRealm: snapshot.recommendedRealm,
    width,
    height,
    rewardBudget: snapshot.rewardPlan.budget,
    snapshot,
    validation,
    tags: snapshot.tags || [],
    bossPool: ["啸月狼王"],
  };
}

function normalizeAiSnapshot(
  raw: Record<string, unknown>,
  fallback: ReturnType<typeof buildFallbackSnapshot>,
): SecretRealmTemplateSnapshot {
  const snapshot = raw.snapshot && typeof raw.snapshot === "object" && !Array.isArray(raw.snapshot)
    ? raw.snapshot as Record<string, unknown>
    : {};
  const fallbackSnapshot = fallback.snapshot;

  const sizeTier = normalizeSecretRealmSizeTier(raw.sizeTier ?? snapshot.sizeTier ?? fallbackSnapshot.sizeTier);
  const rarity = normalizeSecretRealmRarity(raw.rarity ?? snapshot.rarity ?? fallbackSnapshot.rarity);
  const width = Math.max(SECRET_REALM_SIZE_CONFIG[sizeTier].min, Math.floor(Number(raw.width ?? snapshot.width ?? fallbackSnapshot.width) || fallbackSnapshot.width));
  const height = Math.max(SECRET_REALM_SIZE_CONFIG[sizeTier].min, Math.floor(Number(raw.height ?? snapshot.height ?? fallbackSnapshot.height) || fallbackSnapshot.height));

  const candidate: SecretRealmTemplateSnapshot = {
    ...fallbackSnapshot,
    width,
    height,
    sizeTier,
    rarity,
    recommendedRealm: Math.max(1, Math.floor(Number(raw.recommendedRealm ?? snapshot.recommendedRealm ?? fallbackSnapshot.recommendedRealm) || fallbackSnapshot.recommendedRealm)),
    theme: clampText(raw.theme ?? snapshot.theme, fallbackSnapshot.theme, 40),
    introduction: clampText(raw.description ?? snapshot.introduction, fallbackSnapshot.introduction, 120),
    announcement: clampText(raw.announcement ?? snapshot.announcement, fallbackSnapshot.announcement, 120),
    bossBackground: clampText(raw.bossBackground ?? snapshot.bossBackground, fallbackSnapshot.bossBackground, 120),
    rewardPlan: fallbackSnapshot.rewardPlan,
    monsterPlan: fallbackSnapshot.monsterPlan,
    tilesData: Array.isArray(snapshot.tilesData)
      ? snapshot.tilesData
        .filter((tile): tile is TileData => Boolean(tile && typeof tile === "object" && !Array.isArray(tile)))
        .map((tile) => ({
          x: Number(tile.x),
          y: Number(tile.y),
          type: typeof tile.type === "string" ? tile.type : "grass",
          walkable: tile.walkable !== false,
          description: typeof tile.description === "string" ? tile.description : undefined,
          imageUrl: typeof tile.imageUrl === "string" ? tile.imageUrl : undefined,
          portalId: typeof tile.portalId === "string" ? tile.portalId : undefined,
          portalName: typeof tile.portalName === "string" ? tile.portalName : undefined,
          portalTargetMapId: typeof tile.portalTargetMapId === "string" ? tile.portalTargetMapId : undefined,
          portalTargetPortalId: typeof tile.portalTargetPortalId === "string" ? tile.portalTargetPortalId : undefined,
          portalTargetName: typeof tile.portalTargetName === "string" ? tile.portalTargetName : undefined,
        }))
      : fallbackSnapshot.tilesData,
    entryPoint: snapshot.entryPoint as SecretRealmPoint || fallbackSnapshot.entryPoint,
    returnPoint: snapshot.returnPoint as SecretRealmPoint || fallbackSnapshot.returnPoint,
    bossPoint: snapshot.bossPoint as SecretRealmPoint || fallbackSnapshot.bossPoint,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : fallbackSnapshot.tags,
  };

  candidate.rewardPlan = buildSecretRealmRewardPlan({ sizeTier, rarity });
  candidate.monsterPlan = buildSecretRealmMonsterPlan({ sizeTier, rarity });
  return candidate;
}

async function requestAiSecretRealm(params: {
  recommendedRealm: number;
  sizeTier: SecretRealmSizeTier;
  rarity: SecretRealmRarity;
  fallback: ReturnType<typeof buildFallbackSnapshot>;
}) {
  const prompt = [
    "你是修仙游戏肉鸽秘境生成器。",
    "只返回 JSON 对象。",
    "必须生成一个迷雾探索型秘境。",
    "必须包含 name、description、announcement、theme、bossBackground、sizeTier、rarity、recommendedRealm、snapshot。",
    "snapshot 内必须包含 width、height、entryPoint、returnPoint、bossPoint、tilesData。",
    "tilesData 使用数组，每项为 {x,y,type,walkable,description?}。",
    "障碍要偏多，但必须保证入口能走到 Boss 和回返阵。",
  ].join("\n");

  const userPayload = {
    recommendedRealm: params.recommendedRealm,
    sizeTier: params.sizeTier,
    rarity: params.rarity,
    fallbackTheme: params.fallback.snapshot.theme,
    fallbackSize: {
      width: params.fallback.snapshot.width,
      height: params.fallback.snapshot.height,
    },
  };

  const response = await chatCompletion(
    prompt,
    [{ role: "user", content: JSON.stringify(userPayload, null, 2) }],
    {
      scene: "worldFlavor",
      temperature: 0.95,
      maxTokens: 1200,
    },
  );

  return parseJsonObject(response);
}

export async function generateSecretRealmTemplate(params: {
  recommendedRealm: number;
  sizeTier?: SecretRealmSizeTier;
  rarity?: SecretRealmRarity;
  forceFallback?: boolean;
}): Promise<SecretRealmTemplateRecord> {
  const sizeTier = normalizeSecretRealmSizeTier(params.sizeTier || randomPick(["small", "medium", "large"]));
  const fallback = buildFallbackSnapshot({
    recommendedRealm: params.recommendedRealm,
    sizeTier,
    rarity: params.rarity,
  });

  let sourceType: "ai" | "fallback" = "fallback";
  let name = fallback.name;
  let description = fallback.description;
  let announcement = fallback.announcement;
  let theme = fallback.theme;
  let bossBackground = fallback.bossBackground;
  let snapshot = fallback.snapshot;
  let validation = fallback.validation;
  let tags = fallback.tags;

  if (!params.forceFallback) {
    try {
      const aiPayload = await requestAiSecretRealm({
        recommendedRealm: params.recommendedRealm,
        sizeTier,
        rarity: fallback.snapshot.rarity,
        fallback,
      });

      if (aiPayload) {
        const aiSnapshot = normalizeAiSnapshot(aiPayload, fallback);
        const aiValidation = validateSecretRealmSnapshot(aiSnapshot, "ai");
        if (aiValidation.passed) {
          sourceType = "ai";
          name = clampText(aiPayload.name, fallback.name, 30);
          description = clampText(aiPayload.description, fallback.description, 120);
          announcement = clampText(aiPayload.announcement, fallback.announcement, 120);
          theme = clampText(aiPayload.theme, fallback.theme, 40);
          bossBackground = clampText(aiPayload.bossBackground, fallback.bossBackground, 120);
          snapshot = {
            ...aiSnapshot,
            blockedRatio: aiValidation.blockedRatio,
            theme,
            introduction: description,
            announcement,
            bossBackground,
          };
          validation = aiValidation;
          tags = Array.isArray(aiPayload.tags)
            ? aiPayload.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8)
            : fallback.tags;
        }
      }
    } catch {
      sourceType = "fallback";
    }
  }

  const inserted = await db.insert(secretRealmTemplates).values({
    sourceType,
    status: "ready",
    name,
    description,
    announcement,
    theme,
    bossBackground,
    sizeTier: snapshot.sizeTier,
    rarity: snapshot.rarity,
    recommendedRealm: snapshot.recommendedRealm,
    width: snapshot.width,
    height: snapshot.height,
    rewardBudget: snapshot.rewardPlan.budget,
    snapshotJson: snapshot,
    bossPool: fallback.bossPool,
    validationReport: validation,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).returning().get();

  if (!inserted) {
    throw new Error("秘境模板生成失败");
  }

  return {
    id: inserted.id,
    name: inserted.name,
    description: inserted.description,
    announcementText: inserted.announcement,
    bossName: fallback.bossPool[0] || "秘境之主",
    bossLore: inserted.bossBackground,
    theme: inserted.theme,
    sizeTier: normalizeSecretRealmSizeTier(inserted.sizeTier),
    width: inserted.width,
    height: inserted.height,
    rarity: normalizeSecretRealmRarity(inserted.rarity),
    recommendedRealm: inserted.recommendedRealm,
    rewardBudget: inserted.rewardBudget,
    tags: Array.isArray(inserted.tags) ? inserted.tags : [],
    layout: {
      width: snapshot.width,
      height: snapshot.height,
      entrance: snapshot.entryPoint,
      returnPortal: snapshot.returnPoint,
      bossPoint: snapshot.bossPoint,
      elitePoints: [],
      chestPoints: [],
      obstacleRate: validation.blockedRatio,
      tilesData: snapshot.tilesData.map((tile) => ({
        x: tile.x,
        y: tile.y,
        type: tile.type,
        walkable: tile.walkable !== false,
        description: tile.description,
        imageUrl: tile.imageUrl,
      })),
    },
    generationSource: sourceType,
    validationNotes: validation.reasons,
  };
}

export async function ensureSecretRealmTemplate(params: {
  recommendedRealm: number;
  sizeTier?: SecretRealmSizeTier;
  rarity?: SecretRealmRarity;
}) {
  const sizeTier = normalizeSecretRealmSizeTier(params.sizeTier || "small");
  const rarity = normalizeSecretRealmRarity(params.rarity || "common");
  const existingCandidates = await db.query.secretRealmTemplates.findMany({
    where: (table, { and, eq, lte, gte }) => and(
      eq(table.status, "ready"),
      eq(table.sizeTier, sizeTier),
      eq(table.rarity, rarity),
      lte(table.recommendedRealm, params.recommendedRealm + 1),
      gte(table.recommendedRealm, Math.max(1, params.recommendedRealm - 2)),
    ),
  });
  const existing = existingCandidates.find((candidate) => !isWildWolfValleyRealm({
    name: candidate.name,
    tags: candidate.tags,
  }));

  if (existing) {
    return existing;
  }

  const generated = await generateSecretRealmTemplate({
    recommendedRealm: params.recommendedRealm,
    sizeTier,
    rarity,
  });

  return await db.query.secretRealmTemplates.findFirst({
    where: (table, { eq }) => eq(table.id, generated.id),
  });
}

export async function ensureWildWolfValleyTemplate(params: {
  recommendedRealm: number;
}) {
  const minRealm = Math.max(1, params.recommendedRealm - 1);
  const maxRealm = params.recommendedRealm + 2;
  const existingCandidates = await db.query.secretRealmTemplates.findMany({
    where: (table, { and, eq, gte, lte }) => and(
      eq(table.status, "ready"),
      eq(table.name, WILD_WOLF_VALLEY_NAME),
      gte(table.recommendedRealm, minRealm),
      lte(table.recommendedRealm, maxRealm),
    ),
  });
  const existing = existingCandidates.find((candidate) => isWildWolfValleyRealm({
    name: candidate.name,
    tags: candidate.tags,
  }));
  if (existing) {
    return existing;
  }

  const fallback = buildWildWolfValleySnapshot({
    recommendedRealm: Math.max(1, params.recommendedRealm),
  });
  const nowIso = new Date().toISOString();
  const inserted = await db.insert(secretRealmTemplates).values({
    sourceType: fallback.sourceType,
    status: "ready",
    name: fallback.name,
    description: fallback.description,
    announcement: fallback.announcement,
    theme: fallback.theme,
    bossBackground: fallback.bossBackground,
    sizeTier: fallback.snapshot.sizeTier,
    rarity: fallback.snapshot.rarity,
    recommendedRealm: fallback.snapshot.recommendedRealm,
    width: fallback.snapshot.width,
    height: fallback.snapshot.height,
    rewardBudget: fallback.snapshot.rewardPlan.budget,
    snapshotJson: fallback.snapshot,
    bossPool: fallback.bossPool,
    validationReport: fallback.validation,
    tags: fallback.tags,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).returning().get();

  if (!inserted) {
    throw new Error("野狼谷模板生成失败");
  }

  return inserted;
}
