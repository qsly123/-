"use client";

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { isCapacitorRuntime } from "@/modules/shared/services/client-runtime";
import type { ManagedAssetManifest } from "@/modules/shared/services/managed-asset-manifest";

const MANIFEST_ENDPOINT = "/api/assets/manifest";
const STORAGE_KEY = "immortality-managed-assets-v1";
const ASSET_ROOT_PATH = "game-assets";
const MANAGED_IMAGE_PATTERN = /\.(?:png|jpg|jpeg|webp|gif|svg|ico|avif)$/i;
const MANAGED_PREFIXES = ["/static/", "/uploads/", "/pwa/"];

type StoredManagedAssetEntry = {
  hash: string;
  localPath: string;
  localUrl: string;
  sourceUrl: string;
};

type StoredManagedAssetManifest = {
  version: string;
  syncedAt: string;
  entries: Record<string, StoredManagedAssetEntry>;
};

type ManagedAssetManifestResponse = {
  success: boolean;
  data?: ManagedAssetManifest;
};

const registryListeners = new Set<() => void>();

let inMemoryManifest: StoredManagedAssetManifest | null = null;
let loadManifestPromise: Promise<void> | null = null;
let syncManifestPromise: Promise<StoredManagedAssetManifest | null> | null = null;

function notifyRegistryListeners() {
  for (const listener of registryListeners) {
    listener();
  }
}

function isManagedAssetPath(pathname: string) {
  return MANAGED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function normalizeManagedAssetSource(src?: string | null) {
  if (!src || typeof window === "undefined") {
    return null;
  }

  const normalizedSrc = src.trim();
  if (!normalizedSrc) {
    return null;
  }

  if (
    normalizedSrc.startsWith("data:")
    || normalizedSrc.startsWith("blob:")
    || normalizedSrc.startsWith("capacitor:")
    || normalizedSrc.startsWith("content:")
    || normalizedSrc.startsWith("file:")
    || normalizedSrc.startsWith("http://localhost/_capacitor_file_")
  ) {
    return null;
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(normalizedSrc, window.location.origin);
  } catch {
    return null;
  }

  if (resolvedUrl.origin !== window.location.origin) {
    return null;
  }

  if (!MANAGED_IMAGE_PATTERN.test(resolvedUrl.pathname) || !isManagedAssetPath(resolvedUrl.pathname)) {
    return null;
  }

  return {
    key: resolvedUrl.pathname,
    sourceUrl: `${resolvedUrl.pathname}${resolvedUrl.search}`,
  };
}

function buildLocalAssetPath(assetPath: string, hash: string) {
  const normalizedPath = assetPath.replace(/^\/+/, "");
  return `${ASSET_ROOT_PATH}/${hash}/${normalizedPath}`;
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function readStoredManifest() {
  const result = await Preferences.get({ key: STORAGE_KEY });
  if (!result.value) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.value) as StoredManagedAssetManifest;
    if (!parsed || typeof parsed !== "object" || typeof parsed.entries !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function persistStoredManifest(manifest: StoredManagedAssetManifest) {
  await Preferences.set({
    key: STORAGE_KEY,
    value: JSON.stringify(manifest),
  });
}

async function downloadManagedAsset(assetPath: string, hash: string, sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Download asset failed: ${sourceUrl}`);
  }

  const buffer = await response.arrayBuffer();
  const localPath = buildLocalAssetPath(assetPath, hash);

  await Filesystem.writeFile({
    path: localPath,
    data: arrayBufferToBase64(buffer),
    directory: Directory.Data,
    recursive: true,
  });

  const uri = await Filesystem.getUri({
    path: localPath,
    directory: Directory.Data,
  });

  return {
    hash,
    localPath,
    localUrl: Capacitor.convertFileSrc(uri.uri),
    sourceUrl,
  } satisfies StoredManagedAssetEntry;
}

async function removeManagedAsset(entry?: StoredManagedAssetEntry) {
  if (!entry?.localPath) {
    return;
  }

  try {
    await Filesystem.deleteFile({
      path: entry.localPath,
      directory: Directory.Data,
    });
  } catch {
    // Local cache cleanup should not block future updates.
  }
}

async function fetchManagedAssetManifest() {
  const response = await fetch(MANIFEST_ENDPOINT, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("Fetch asset manifest failed");
  }

  const payload = await response.json() as ManagedAssetManifestResponse;
  if (!payload.success || !payload.data) {
    throw new Error("Invalid asset manifest response");
  }

  return payload.data;
}

async function syncManagedAssetManifest() {
  const remoteManifest = await fetchManagedAssetManifest();
  const previousManifest = inMemoryManifest || await readStoredManifest();
  const nextEntries: Record<string, StoredManagedAssetEntry> = {};

  for (const remoteEntry of remoteManifest.entries) {
    const previousEntry = previousManifest?.entries[remoteEntry.path];
    if (previousEntry && previousEntry.hash === remoteEntry.hash && previousEntry.localUrl) {
      nextEntries[remoteEntry.path] = previousEntry;
      continue;
    }

    const downloadedEntry = await downloadManagedAsset(remoteEntry.path, remoteEntry.hash, remoteEntry.url);
    nextEntries[remoteEntry.path] = downloadedEntry;

    if (previousEntry && previousEntry.localPath !== downloadedEntry.localPath) {
      await removeManagedAsset(previousEntry);
    }
  }

  if (previousManifest) {
    for (const [assetPath, previousEntry] of Object.entries(previousManifest.entries)) {
      if (!nextEntries[assetPath]) {
        await removeManagedAsset(previousEntry);
      }
    }
  }

  const nextManifest: StoredManagedAssetManifest = {
    version: remoteManifest.version,
    syncedAt: new Date().toISOString(),
    entries: nextEntries,
  };

  inMemoryManifest = nextManifest;
  await persistStoredManifest(nextManifest);
  notifyRegistryListeners();

  return nextManifest;
}

export async function ensureManagedAssetRegistryLoaded() {
  if (!isCapacitorRuntime()) {
    return;
  }

  if (!loadManifestPromise) {
    loadManifestPromise = (async () => {
      inMemoryManifest = await readStoredManifest();
      notifyRegistryListeners();
    })().finally(() => {
      loadManifestPromise = null;
    });
  }

  await loadManifestPromise;
}

export async function syncManagedAssets(options?: { force?: boolean }) {
  if (!isCapacitorRuntime()) {
    return null;
  }

  await ensureManagedAssetRegistryLoaded();

  if (syncManifestPromise && !options?.force) {
    return syncManifestPromise;
  }

  syncManifestPromise = syncManagedAssetManifest().finally(() => {
    syncManifestPromise = null;
  });

  return syncManifestPromise;
}

export function subscribeManagedAssetRegistry(listener: () => void) {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

export function resolveManagedAssetUrl(src?: string | null) {
  const normalized = normalizeManagedAssetSource(src);
  if (!normalized) {
    return src || null;
  }

  return inMemoryManifest?.entries[normalized.key]?.localUrl || src || null;
}

export async function bootstrapManagedAssetSync() {
  if (!isCapacitorRuntime()) {
    return;
  }

  try {
    await ensureManagedAssetRegistryLoaded();
    await syncManagedAssets();
  } catch {
    // Asset sync should fail soft to avoid blocking gameplay.
  }
}
