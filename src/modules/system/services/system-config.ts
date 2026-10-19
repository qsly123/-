import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { systemConfigs } from "@/db/schema";

const SYSTEM_CONFIG_CACHE_TTL_MS = 5_000;

type SystemConfigCacheEntry = {
  expiresAt: number;
  value: string | null;
};

const systemConfigCache = new Map<string, SystemConfigCacheEntry>();
const systemConfigBatchPromises = new Map<string, Promise<Map<string, string | null>>>();

export function invalidateSystemConfigCache(keys?: readonly string[]) {
  if (!keys || keys.length <= 0) {
    systemConfigCache.clear();
    systemConfigBatchPromises.clear();
    return;
  }

  const normalizedKeys = normalizeKeys(keys);
  for (const key of normalizedKeys) {
    systemConfigCache.delete(key);
  }

  for (const [signature] of systemConfigBatchPromises) {
    const signatureKeys = signature.split("\n");
    if (signatureKeys.some((key) => normalizedKeys.includes(key))) {
      systemConfigBatchPromises.delete(signature);
    }
  }
}

function normalizeRequiredValue(key: string, value: string | null) {
  if (!value || !value.trim()) {
    throw new Error(`系统配置缺失: ${key}`);
  }
  return value;
}

function normalizeKeys(keys: readonly string[]) {
  return Array.from(new Set(
    keys
      .map((key) => key.trim())
      .filter((key) => !!key),
  ));
}

function getCacheEntryValue(key: string) {
  const cacheEntry = systemConfigCache.get(key);
  if (!cacheEntry) {
    return {
      hit: false,
      value: null,
    };
  }

  if (cacheEntry.expiresAt <= Date.now()) {
    systemConfigCache.delete(key);
    return {
      hit: false,
      value: null,
    };
  }

  return {
    hit: true,
    value: cacheEntry.value,
  };
}

function setCacheEntryValue(key: string, value: string | null) {
  systemConfigCache.set(key, {
    value,
    expiresAt: Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS,
  });
}

async function loadSystemConfigBatch(keys: readonly string[]) {
  const normalizedKeys = normalizeKeys(keys);
  if (!normalizedKeys.length) {
    return new Map<string, string | null>();
  }

  const cacheSignature = normalizedKeys.join("\n");
  const activePromise = systemConfigBatchPromises.get(cacheSignature);
  if (activePromise) {
    return await activePromise;
  }

  const nextPromise = db
    .select({
      key: systemConfigs.key,
      value: systemConfigs.value,
    })
    .from(systemConfigs)
    .where(inArray(systemConfigs.key, normalizedKeys))
    .all()
    .then((rows) => {
      const rowMap = new Map<string, string | null>();
      for (const row of rows) {
        rowMap.set(row.key, row.value);
      }

      const result = new Map<string, string | null>();
      for (const key of normalizedKeys) {
        const value = rowMap.get(key) ?? null;
        setCacheEntryValue(key, value);
        result.set(key, value);
      }
      return result;
    })
    .finally(() => {
      if (systemConfigBatchPromises.get(cacheSignature) === nextPromise) {
        systemConfigBatchPromises.delete(cacheSignature);
      }
    });

  systemConfigBatchPromises.set(cacheSignature, nextPromise);
  return await nextPromise;
}

export async function getSystemConfigValue(key: string): Promise<string | null> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return null;
  }

  const cached = getCacheEntryValue(normalizedKey);
  if (cached.hit) {
    return cached.value;
  }

  const batchResult = await loadSystemConfigBatch([normalizedKey]);
  return batchResult.get(normalizedKey) ?? null;
}

export async function getSystemConfigJsonValue<T = unknown>(key: string): Promise<T | null> {
  const value = await getSystemConfigValue(key);
  if (!value || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function getRequiredSystemConfigValue(key: string): Promise<string> {
  const value = await getSystemConfigValue(key);
  return normalizeRequiredValue(key, value);
}

export async function getSystemConfigMap(keys: readonly string[]): Promise<Record<string, string>> {
  const normalizedKeys = normalizeKeys(keys);
  if (!normalizedKeys.length) {
    return {};
  }

  const map: Record<string, string> = {};
  const missingKeys: string[] = [];

  for (const key of normalizedKeys) {
    const cached = getCacheEntryValue(key);
    if (!cached.hit) {
      missingKeys.push(key);
      continue;
    }
    if (cached.value !== null) {
      map[key] = cached.value;
    }
  }

  if (!missingKeys.length) {
    return map;
  }

  const loadedMap = await loadSystemConfigBatch(missingKeys);
  for (const key of missingKeys) {
    const value = loadedMap.get(key) ?? null;
    if (value !== null) {
      map[key] = value;
    }
  }

  return map;
}

export async function getRequiredSystemConfigMap(keys: readonly string[]): Promise<Record<string, string>> {
  const map = await getSystemConfigMap(keys);

  for (const key of keys) {
    map[key] = normalizeRequiredValue(key, map[key] ?? null);
  }

  return map;
}
