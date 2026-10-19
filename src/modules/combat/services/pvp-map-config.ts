import { getSystemConfigJsonValue } from "@/modules/system/services/system-config";

export type PvpMapType = "city" | "field" | "dungeon" | "secret" | "secret_realm_instance";

export type PvpMapTypeFlags = Record<PvpMapType, boolean>;

export type PvpAvailabilitySource = "map-id" | "map-type" | null;

export type PvpMapAvailability = {
  enabled: boolean;
  source: PvpAvailabilitySource;
  enabledMapIds: string[];
  enabledMapTypes: PvpMapTypeFlags;
};

const DEFAULT_PVP_MAP_IDS = ["map_starter_village"];

const DEFAULT_PVP_MAP_TYPE_FLAGS: PvpMapTypeFlags = {
  city: false,
  field: true,
  dungeon: true,
  secret: false,
  secret_realm_instance: false,
};

function normalizePvpMapIds(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const ids = new Set<string>();
  for (const item of raw) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id) {
      continue;
    }
    ids.add(id);
  }
  return Array.from(ids);
}

function normalizePvpMapTypeFlags(raw: unknown): PvpMapTypeFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PVP_MAP_TYPE_FLAGS };
  }

  const source = raw as Partial<Record<PvpMapType, unknown>>;
  return {
    city: Boolean(source.city),
    field: Boolean(source.field),
    dungeon: Boolean(source.dungeon),
    secret: Boolean(source.secret),
    secret_realm_instance: Boolean(source.secret_realm_instance),
  };
}

export async function getPvpMapConfig() {
  const [rawMapIds, rawMapTypeFlags] = await Promise.all([
    getSystemConfigJsonValue<unknown>("PVP_MAP_IDS_JSON"),
    getSystemConfigJsonValue<unknown>("PVP_MAP_TYPE_FLAGS_JSON"),
  ]);

  return {
    enabledMapIds: rawMapIds === null
      ? [...DEFAULT_PVP_MAP_IDS]
      : normalizePvpMapIds(rawMapIds),
    enabledMapTypes: rawMapTypeFlags === null
      ? { ...DEFAULT_PVP_MAP_TYPE_FLAGS }
      : normalizePvpMapTypeFlags(rawMapTypeFlags),
  };
}

export async function getPvpMapAvailability(params: {
  mapId: string;
  mapType?: string | null;
}): Promise<PvpMapAvailability> {
  const config = await getPvpMapConfig();
  if (config.enabledMapIds.includes(params.mapId)) {
    return {
      enabled: true,
      source: "map-id",
      enabledMapIds: config.enabledMapIds,
      enabledMapTypes: config.enabledMapTypes,
    };
  }

  const normalizedMapType = typeof params.mapType === "string"
    ? params.mapType.trim()
    : "";
  if (
    normalizedMapType
    && Object.prototype.hasOwnProperty.call(config.enabledMapTypes, normalizedMapType)
    && config.enabledMapTypes[normalizedMapType as PvpMapType]
  ) {
    return {
      enabled: true,
      source: "map-type",
      enabledMapIds: config.enabledMapIds,
      enabledMapTypes: config.enabledMapTypes,
    };
  }

  return {
    enabled: false,
    source: null,
    enabledMapIds: config.enabledMapIds,
    enabledMapTypes: config.enabledMapTypes,
  };
}
