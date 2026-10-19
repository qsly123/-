import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

import { fourRealmsPack } from "../src/db/offline-packs/four-realms-pack";

const LOCAL_UPLOAD_STAGING_ROOT = path.join(process.cwd(), "lingxu", "uploads", "cosmetics");

async function fileExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const copied: string[] = [];
  const reused: string[] = [];

  for (const icon of fourRealmsPack.iconAssets) {
    const sourcePath = path.join(process.cwd(), icon.sourcePath);
    const relativeUploadPath = icon.publicPath.replace(/^\/uploads\/cosmetics\//, "").replaceAll("/", path.sep);
    const targetPath = path.join(LOCAL_UPLOAD_STAGING_ROOT, relativeUploadPath);

    await mkdir(path.dirname(targetPath), { recursive: true });

    if (await fileExists(sourcePath)) {
      await cp(sourcePath, targetPath);
      copied.push(targetPath);
      continue;
    }

    if (await fileExists(targetPath)) {
      reused.push(targetPath);
      continue;
    }

    throw new Error(`缺少图标源文件且本地中转目录也不存在: ${icon.id} -> ${icon.publicPath}`);
  }

  console.log(JSON.stringify({
    stagingRoot: LOCAL_UPLOAD_STAGING_ROOT,
    copiedCount: copied.length,
    reusedCount: reused.length,
    sample: copied.slice(0, 6),
    reusedSample: reused.slice(0, 6),
  }, null, 2));
}

main().catch((error) => {
  console.error("[four-realms] 图标同步失败", error);
  process.exit(1);
});
