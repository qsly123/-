import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDeploymentVersion } from "@/modules/system/services/deployment-version";
import { UPLOADS_ROOT_CANDIDATES } from "@/modules/shared/services/upload-storage";

const MANAGED_DIRECTORIES = [
  {
    absolutePath: path.resolve(process.cwd(), "public", "static"),
    publicBasePath: "/static",
  },
  {
    absolutePath: path.resolve(process.cwd(), "public", "pwa"),
    publicBasePath: "/pwa",
  },
] as const;

const MANAGED_IMAGE_PATTERN = /\.(?:png|jpg|jpeg|webp|gif|svg|ico|avif)$/i;
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};
const MANIFEST_CACHE_TTL_MS = 60_000;

export interface ManagedAssetManifestEntry {
  path: string;
  url: string;
  hash: string;
  size: number;
  updatedAt: string;
  contentType: string;
}

export interface ManagedAssetManifest {
  version: string;
  generatedAt: string;
  entries: ManagedAssetManifestEntry[];
}

let cachedManifest: {
  expiresAt: number;
  deploymentVersion: string;
  manifest: ManagedAssetManifest;
} | null = null;

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] || "application/octet-stream";
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkManagedDirectory(
  absoluteRootPath: string,
  currentPath: string,
  publicBasePath: string,
) {
  const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
  const sortedEntries = [...directoryEntries].sort((left, right) => left.name.localeCompare(right.name));
  const manifestEntries: ManagedAssetManifestEntry[] = [];

  for (const directoryEntry of sortedEntries) {
    const nextAbsolutePath = path.join(currentPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) {
      if (directoryEntry.name === ".bak") {
        continue;
      }
      const childEntries = await walkManagedDirectory(absoluteRootPath, nextAbsolutePath, publicBasePath);
      manifestEntries.push(...childEntries);
      continue;
    }

    if (!directoryEntry.isFile() || !MANAGED_IMAGE_PATTERN.test(directoryEntry.name)) {
      continue;
    }

    const relativePath = path.relative(absoluteRootPath, nextAbsolutePath).split(path.sep).join("/");
    const fileBuffer = await fs.readFile(nextAbsolutePath);
    const fileInfo = await fs.stat(nextAbsolutePath);
    const hash = createHash("sha256").update(fileBuffer).digest("hex");
    const publicPath = `${publicBasePath}/${relativePath}`;

    manifestEntries.push({
      path: publicPath,
      url: publicPath,
      hash,
      size: fileInfo.size,
      updatedAt: fileInfo.mtime.toISOString(),
      contentType: getContentType(nextAbsolutePath),
    });
  }

  return manifestEntries;
}

export async function getManagedAssetManifest() {
  const deploymentVersion = await getDeploymentVersion();
  const now = Date.now();

  if (
    cachedManifest
    && cachedManifest.deploymentVersion === deploymentVersion
    && cachedManifest.expiresAt > now
  ) {
    return cachedManifest.manifest;
  }

  const entries: ManagedAssetManifestEntry[] = [];
  const entryMap = new Map<string, ManagedAssetManifestEntry>();

  for (const directory of MANAGED_DIRECTORIES) {
    const exists = await pathExists(directory.absolutePath);
    if (!exists) {
      continue;
    }

    const directoryEntries = await walkManagedDirectory(
      directory.absolutePath,
      directory.absolutePath,
      directory.publicBasePath,
    );
    for (const entry of directoryEntries) {
      if (!entryMap.has(entry.path)) {
        entryMap.set(entry.path, entry);
      }
    }
  }

  for (const uploadsRoot of UPLOADS_ROOT_CANDIDATES) {
    const exists = await pathExists(uploadsRoot);
    if (!exists) {
      continue;
    }

    const directoryEntries = await walkManagedDirectory(
      uploadsRoot,
      uploadsRoot,
      "/uploads",
    );
    for (const entry of directoryEntries) {
      if (!entryMap.has(entry.path)) {
        entryMap.set(entry.path, entry);
      }
    }
  }

  entries.push(...entryMap.values());
  entries.sort((left, right) => left.path.localeCompare(right.path));

  const manifest: ManagedAssetManifest = {
    version: deploymentVersion,
    generatedAt: new Date().toISOString(),
    entries,
  };

  cachedManifest = {
    deploymentVersion,
    expiresAt: now + MANIFEST_CACHE_TTL_MS,
    manifest,
  };

  return manifest;
}
