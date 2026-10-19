import { eq } from "drizzle-orm";
import { db } from "@/db";
import { worldMapInstances } from "@/db/schema";
import { generateOpenWorldDistrictRumors, type OpenWorldDistrictRumor } from "@/modules/world/services/world-ai-generation";
import { ensureGlobalMap } from "@/modules/shared/services/global-store";
import { buildOpenWorldMapDrafts } from "@/modules/world/services/world-map-generator";
import { listOpenWorldDistricts } from "@/modules/world/services/world-district-service";
import { ensureOpenWorldSchema } from "@/modules/world/services/world-schema";

const OPEN_WORLD_DISTRICT_RUMOR_REFRESH_MS = 20 * 60 * 1000;

export type StoredOpenWorldDistrictRumor = OpenWorldDistrictRumor & {
  updatedAt: string;
  source: "ai" | "fallback";
};

type StoredOpenWorldMapMeta = {
  theme?: string;
  districts?: string[];
  buildingTags?: string[];
  resourceThemes?: string[];
  npcCrowds?: string[];
  rumorSeeds?: string[];
  aiSource?: "ai" | "fallback";
  generatedAt?: string;
  districtRumors?: StoredOpenWorldDistrictRumor[];
  districtRumorsUpdatedAt?: string;
};

type DistrictRumorEnsureResult = {
  refreshed: boolean;
  rumors: StoredOpenWorldDistrictRumor[];
  updatedAt: string | null;
};

type RumorRefreshGlobalStore = typeof globalThis & {
  __openWorldDistrictRumorRefreshByMap?: Map<string, Promise<DistrictRumorEnsureResult>>;
};

function normalizeStoredDistrictRumors(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as StoredOpenWorldDistrictRumor[];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const districtName = typeof row.districtName === "string" ? row.districtName.trim() : "";
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const content = typeof row.content === "string" ? row.content.trim() : "";
      const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt.trim() : "";
      const source = row.source === "ai" ? "ai" : "fallback";
      const heat = row.heat === "high" || row.heat === "low" ? row.heat : "medium";
      if (!districtName || !title || !content || !updatedAt) {
        return null;
      }
      return {
        districtName,
        title,
        content,
        heat,
        updatedAt,
        source,
      } satisfies StoredOpenWorldDistrictRumor;
    })
    .filter((entry): entry is StoredOpenWorldDistrictRumor => Boolean(entry));
}

function enrichRumorsWithTimestamp(
  rumors: OpenWorldDistrictRumor[],
  source: "ai" | "fallback",
  updatedAt: string,
) {
  return rumors.map((rumor) => ({
    ...rumor,
    updatedAt,
    source,
  })) satisfies StoredOpenWorldDistrictRumor[];
}

function getRumorRefreshPromises() {
  const globalStore = globalThis as RumorRefreshGlobalStore;
  globalStore.__openWorldDistrictRumorRefreshByMap = ensureGlobalMap<string, Promise<DistrictRumorEnsureResult>>(
    globalStore as Record<string, unknown>,
    "__openWorldDistrictRumorRefreshByMap",
  );
  return globalStore.__openWorldDistrictRumorRefreshByMap;
}

function buildFallbackMapMeta(row: {
  id: string;
  name: string;
  archetype: string;
}) {
  const draft = buildOpenWorldMapDrafts().find((item) => item.id === row.id) || null;
  return {
    theme: draft?.theme || `${row.name}近来灵机流转`,
    districts: draft?.districts || listOpenWorldDistricts(row.id).map((district) => district.name),
    rumorSeeds: draft?.rumorSeeds || [],
    resourceThemes: draft?.resourceThemes || [],
  };
}

function buildFallbackDistrictRumors(row: {
  id: string;
  name: string;
  archetype: string;
  createdAt: string;
  updatedAt?: string | null;
}, metaJson: StoredOpenWorldMapMeta) {
  const fallbackMeta = buildFallbackMapMeta(row);
  const districts = Array.isArray(metaJson.districts) && metaJson.districts.length > 0
    ? metaJson.districts
    : fallbackMeta.districts;
  const rumorSeeds = Array.isArray(metaJson.rumorSeeds) && metaJson.rumorSeeds.length > 0
    ? metaJson.rumorSeeds
    : fallbackMeta.rumorSeeds;
  const resourceThemes = Array.isArray(metaJson.resourceThemes) && metaJson.resourceThemes.length > 0
    ? metaJson.resourceThemes
    : fallbackMeta.resourceThemes;
  const updatedAt = String(
    metaJson.districtRumorsUpdatedAt
    || metaJson.generatedAt
    || row.updatedAt
    || row.createdAt,
  ).trim() || new Date().toISOString();
  const heats: Array<StoredOpenWorldDistrictRumor["heat"]> = ["medium", "high", "low"];

  return districts.slice(0, 3).map((districtName, index) => ({
    districtName,
    title: String(rumorSeeds[index] || `${districtName}风声起`).trim().slice(0, 12) || `${districtName}风声起`,
    content: String(
      rumorSeeds[index]
        ? `${districtName}近来都在传：${rumorSeeds[index]}`
        : `${districtName}近来风声颇紧，诸修都在留意${resourceThemes[index % Math.max(1, resourceThemes.length)] || "旧机缘"}。`,
    ).trim().slice(0, 36) || `${districtName}近来风声颇紧。`,
    heat: heats[index % heats.length],
    updatedAt,
    source: "fallback",
  })) satisfies StoredOpenWorldDistrictRumor[];
}

function buildDistrictRumorSnapshot(row: {
  id: string;
  name: string;
  archetype: string;
  metaJson: unknown;
  createdAt: string;
  updatedAt?: string | null;
}): Omit<DistrictRumorEnsureResult, "refreshed"> {
  const metaJson = ((row.metaJson || {}) as StoredOpenWorldMapMeta);
  const storedRumors = normalizeStoredDistrictRumors(metaJson.districtRumors);
  const storedUpdatedAt = typeof metaJson.districtRumorsUpdatedAt === "string"
    ? metaJson.districtRumorsUpdatedAt.trim()
    : "";

  if (storedRumors.length > 0) {
    return {
      rumors: storedRumors,
      updatedAt: storedUpdatedAt || storedRumors[0]?.updatedAt || null,
    };
  }

  const fallbackRumors = buildFallbackDistrictRumors(row, metaJson);
  return {
    rumors: fallbackRumors,
    updatedAt: fallbackRumors[0]?.updatedAt || null,
  };
}

export function pickOpenWorldHotRumorFromRumors(rumors: StoredOpenWorldDistrictRumor[]) {
  const priorityMap: Record<StoredOpenWorldDistrictRumor["heat"], number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const sortedRumors = [...rumors].sort((left, right) => {
    const priorityGap = priorityMap[right.heat] - priorityMap[left.heat];
    if (priorityGap !== 0) {
      return priorityGap;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  return sortedRumors[0] || null;
}

export function readOpenWorldDistrictRumorSnapshotFromMapRow(row: {
  id: string;
  name: string;
  archetype: string;
  metaJson: unknown;
  createdAt: string;
  updatedAt?: string | null;
}) {
  return buildDistrictRumorSnapshot(row);
}

function shouldRefreshDistrictRumors(params: {
  storedRumors: StoredOpenWorldDistrictRumor[];
  storedUpdatedAt: string | null;
  force?: boolean;
}) {
  const storedUpdatedAt = String(params.storedUpdatedAt || "").trim();
  return Boolean(
    params.force
    || params.storedRumors.length <= 0
    || !storedUpdatedAt
    || !Number.isFinite(Date.parse(storedUpdatedAt))
    || (Date.now() - Date.parse(storedUpdatedAt)) >= OPEN_WORLD_DISTRICT_RUMOR_REFRESH_MS,
  );
}

export async function ensureOpenWorldDistrictRumors(mapId: string, options?: { force?: boolean }) {
  const normalizedMapId = String(mapId || "").trim();
  if (!normalizedMapId) {
    return {
      refreshed: false,
      rumors: [] as StoredOpenWorldDistrictRumor[],
      updatedAt: null,
    };
  }

  const pendingRefreshes = getRumorRefreshPromises();
  const pendingRefresh = pendingRefreshes.get(normalizedMapId);
  if (pendingRefresh) {
    return pendingRefresh;
  }

  const refreshPromise = (async (): Promise<DistrictRumorEnsureResult> => {
    if (!(await ensureOpenWorldSchema())) {
      return {
        refreshed: false,
        rumors: [] as StoredOpenWorldDistrictRumor[],
        updatedAt: null,
      };
    }

    const row = await db.select().from(worldMapInstances).where(eq(worldMapInstances.id, normalizedMapId)).get();
    if (!row) {
      return {
        refreshed: false,
        rumors: [] as StoredOpenWorldDistrictRumor[],
        updatedAt: null,
      };
    }

    const metaJson = ((row.metaJson || {}) as StoredOpenWorldMapMeta);
    const currentSnapshot = buildDistrictRumorSnapshot(row);
    const needsRefresh = shouldRefreshDistrictRumors({
      storedRumors: currentSnapshot.rumors,
      storedUpdatedAt: currentSnapshot.updatedAt,
      force: options?.force,
    });

    if (!needsRefresh) {
      return {
        refreshed: false,
        rumors: currentSnapshot.rumors,
        updatedAt: currentSnapshot.updatedAt,
      };
    }

    const fallbackMeta = buildFallbackMapMeta({
      id: row.id,
      name: row.name,
      archetype: row.archetype,
    });
    const districts = Array.isArray(metaJson.districts) && metaJson.districts.length > 0
      ? metaJson.districts
      : fallbackMeta.districts;
    const rumorSeeds = Array.isArray(metaJson.rumorSeeds) && metaJson.rumorSeeds.length > 0
      ? metaJson.rumorSeeds
      : fallbackMeta.rumorSeeds;
    const resourceThemes = Array.isArray(metaJson.resourceThemes) && metaJson.resourceThemes.length > 0
      ? metaJson.resourceThemes
      : fallbackMeta.resourceThemes;

    const rumorResult = await generateOpenWorldDistrictRumors({
      mapName: row.name,
      mapArchetype: row.archetype,
      theme: String(metaJson.theme || fallbackMeta.theme || "").trim(),
      districts,
      rumorSeeds,
      resourceThemes,
    });

    const latestRow = await db.select().from(worldMapInstances).where(eq(worldMapInstances.id, normalizedMapId)).get();
    if (!latestRow) {
      return {
        refreshed: false,
        rumors: currentSnapshot.rumors,
        updatedAt: currentSnapshot.updatedAt,
      };
    }

    const latestSnapshot = buildDistrictRumorSnapshot(latestRow);
    const stillNeedsRefresh = shouldRefreshDistrictRumors({
      storedRumors: latestSnapshot.rumors,
      storedUpdatedAt: latestSnapshot.updatedAt,
      force: options?.force,
    });
    if (!stillNeedsRefresh) {
      return {
        refreshed: false,
        rumors: latestSnapshot.rumors,
        updatedAt: latestSnapshot.updatedAt,
      };
    }

    const refreshedAt = new Date().toISOString();
    const nextRumors = enrichRumorsWithTimestamp(rumorResult.rumors, rumorResult.source, refreshedAt);
    const latestMetaJson = ((latestRow.metaJson || {}) as StoredOpenWorldMapMeta);
    const nextMetaJson: StoredOpenWorldMapMeta = {
      ...latestMetaJson,
      districtRumors: nextRumors,
      districtRumorsUpdatedAt: refreshedAt,
    };

    await db.update(worldMapInstances).set({
      metaJson: nextMetaJson,
      updatedAt: refreshedAt,
    }).where(eq(worldMapInstances.id, normalizedMapId)).run();

    return {
      refreshed: true,
      rumors: nextRumors,
      updatedAt: refreshedAt,
    };
  })().finally(() => {
    pendingRefreshes.delete(normalizedMapId);
  });

  pendingRefreshes.set(normalizedMapId, refreshPromise);
  return refreshPromise;
}

export async function listOpenWorldDistrictRumors(mapId: string) {
  if (!(await ensureOpenWorldSchema())) {
    return [] as StoredOpenWorldDistrictRumor[];
  }

  const normalizedMapId = String(mapId || "").trim();
  if (!normalizedMapId) {
    return [] as StoredOpenWorldDistrictRumor[];
  }

  const row = await db.select().from(worldMapInstances).where(eq(worldMapInstances.id, normalizedMapId)).get();
  if (!row) {
    return [] as StoredOpenWorldDistrictRumor[];
  }

  return buildDistrictRumorSnapshot(row).rumors;
}

export async function getOpenWorldDistrictRumor(mapId: string, districtName: string | null | undefined) {
  const normalizedDistrictName = String(districtName || "").trim();
  if (!normalizedDistrictName) {
    return null;
  }

  const rumors = await listOpenWorldDistrictRumors(mapId);
  return rumors.find((entry) => entry.districtName === normalizedDistrictName) || null;
}

export async function getOpenWorldHotRumorSummary(mapId: string) {
  const rumors = await listOpenWorldDistrictRumors(mapId);
  return pickOpenWorldHotRumorFromRumors(rumors);
}
