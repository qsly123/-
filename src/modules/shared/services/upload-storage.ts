import path from "path";
import { access, stat } from "fs/promises";

export const UPLOADS_PUBLIC_BASE_PATH = "/uploads";
const UPLOAD_ROOTS_CACHE_TTL_MS = 30 * 1000;

function splitUploadRootEnv(value: string | undefined) {
  return String(value || "")
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupeUploadRoots(roots: string[]) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const root of roots) {
    const normalized = path.resolve(root);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

export const UPLOADS_ROOT_CANDIDATES = dedupeUploadRoots([
  ...splitUploadRootEnv(process.env.UPLOADS_ROOTS),
  ...splitUploadRootEnv(process.env.UPLOADS_ROOT),
  path.resolve(path.sep, "app", "uploads"),
  path.resolve(path.sep, "app", "public", "uploads"),
  path.resolve(path.sep, "app", ".next", "standalone", "uploads"),
  path.resolve(path.sep, "app", ".next", "standalone", "public", "uploads"),
  path.resolve(process.cwd(), "uploads"),
  path.resolve(process.cwd(), "lingxu", "uploads"),
  path.resolve(process.cwd(), "public", "uploads"),
  path.resolve(path.sep, "uploads"),
  path.resolve(path.sep, "opt", "1panel", "docker", "compose", "lingxu", "uploads"),
]);

let existingUploadRootsCache:
  | {
      expiresAt: number;
      roots: string[];
    }
  | null = null;
let existingUploadRootsPromise: Promise<string[]> | null = null;

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isSafeUploadSubPath(rootPath: string, filePath: string) {
  const rootWithSlash = `${rootPath}${path.sep}`;
  return filePath === rootPath || filePath.startsWith(rootWithSlash);
}

async function probeExistingUploadRoots() {
  const results: string[] = [];

  for (const candidate of UPLOADS_ROOT_CANDIDATES) {
    if (await pathExists(candidate)) {
      results.push(candidate);
    }
  }

  return results;
}

export async function getExistingUploadRoots() {
  const now = Date.now();
  if (existingUploadRootsCache && existingUploadRootsCache.expiresAt > now) {
    return existingUploadRootsCache.roots;
  }

  if (!existingUploadRootsPromise) {
    existingUploadRootsPromise = probeExistingUploadRoots()
      .then((roots) => {
        existingUploadRootsCache = {
          expiresAt: Date.now() + UPLOAD_ROOTS_CACHE_TTL_MS,
          roots,
        };
        return roots;
      })
      .finally(() => {
        existingUploadRootsPromise = null;
      });
  }

  return await existingUploadRootsPromise;
}

export async function getPreferredUploadsRoot() {
  const existingRoots = await getExistingUploadRoots();
  if (existingRoots.length > 0) {
    return existingRoots[0];
  }
  return UPLOADS_ROOT_CANDIDATES[0];
}

export async function resolveExistingUploadFilePath(segments: string[]) {
  const existingRoots = await getExistingUploadRoots();
  const rootsToCheck = existingRoots.length > 0
    ? existingRoots
    : [...UPLOADS_ROOT_CANDIDATES];

  for (const rootPath of rootsToCheck) {
    const filePath = path.resolve(rootPath, ...segments);
    if (!isSafeUploadSubPath(rootPath, filePath)) {
      continue;
    }

    try {
      const fileInfo = await stat(filePath);
      if (fileInfo.isFile()) {
        return filePath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function buildUploadsPublicUrl(...segments: string[]) {
  const normalizedSegments = segments
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
  return `${UPLOADS_PUBLIC_BASE_PATH}/${normalizedSegments.join("/")}`;
}
