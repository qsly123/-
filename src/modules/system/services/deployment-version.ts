import { promises as fs } from "node:fs";
import path from "node:path";

const bootVersion = `boot-${Date.now().toString(36)}`;

let cachedDeploymentVersionPromise: Promise<string> | null = null;

async function readBuildIdFile(filePath: string) {
  try {
    const value = await fs.readFile(filePath, "utf8");
    const normalized = value.trim();
    return normalized || null;
  } catch {
    return null;
  }
}

async function resolveDeploymentVersion() {
  const envVersion = [
    process.env.APP_BUILD_ID,
    process.env.NEXT_PUBLIC_BUILD_ID,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.RENDER_GIT_COMMIT,
    process.env.HEROKU_SLUG_COMMIT,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (envVersion) {
    return envVersion.trim();
  }

  const candidatePaths = [
    path.join(process.cwd(), ".next", "BUILD_ID"),
    path.join(process.cwd(), "BUILD_ID"),
    path.join(process.cwd(), ".next", "standalone", ".next", "BUILD_ID"),
  ];

  for (const candidatePath of candidatePaths) {
    const buildId = await readBuildIdFile(candidatePath);
    if (buildId) {
      return buildId;
    }
  }

  return bootVersion;
}

export function getDeploymentVersion() {
  if (!cachedDeploymentVersionPromise) {
    cachedDeploymentVersionPromise = resolveDeploymentVersion();
  }

  return cachedDeploymentVersionPromise;
}
