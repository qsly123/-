import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pluginInstalls, pluginPackages } from "@/db/schema";
import { isAdminEntity, type AdminEntity } from "@/modules/admin/services/admin-entities";

const ADMIN_ENTITY_CAPABILITY_PREFIX = "admin.entity:";

type PluginEntityCapabilityState = {
  declared: boolean;
  enabled: boolean;
};

function parseEntityCapability(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const capability = value.trim();
  if (!capability.startsWith(ADMIN_ENTITY_CAPABILITY_PREFIX)) {
    return null;
  }
  const entity = capability.slice(ADMIN_ENTITY_CAPABILITY_PREFIX.length).trim();
  if (!entity || !isAdminEntity(entity)) {
    return null;
  }
  return entity;
}

function parseManifestCapabilities(manifest: unknown) {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }
  const capabilities = (manifest as Record<string, unknown>).capabilities;
  if (!Array.isArray(capabilities)) {
    return [];
  }
  return capabilities;
}

async function getPluginEntityCapabilityStateMap() {
  const rows = await db.select({
    enabled: pluginInstalls.enabled,
    manifest: pluginPackages.manifest,
  }).from(pluginInstalls).innerJoin(pluginPackages, eq(pluginInstalls.packageId, pluginPackages.id)).all();

  const map = new Map<AdminEntity, PluginEntityCapabilityState>();
  for (const row of rows) {
    const capabilities = parseManifestCapabilities(row.manifest);
    for (const capability of capabilities) {
      const entity = parseEntityCapability(capability);
      if (!entity) {
        continue;
      }
      const current = map.get(entity) || { declared: false, enabled: false };
      current.declared = true;
      if (row.enabled) {
        current.enabled = true;
      }
      map.set(entity, current);
    }
  }

  return map;
}

export async function canAccessAdminEntity(entity: AdminEntity) {
  const capabilityStateMap = await getPluginEntityCapabilityStateMap();
  const state = capabilityStateMap.get(entity);
  if (!state?.declared) {
    return true;
  }
  return state.enabled;
}
