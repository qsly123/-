import { copyFile, mkdir, readdir, rename, stat, writeFile } from "fs/promises";
import path from "path";

type AssetUsage =
  | "item"
  | "skill-icon"
  | "skill-sprite"
  | "map-emote"
  | "status-effect"
  | "avatar-frame"
  | "map-marker"
  | "npc-avatar-candidate"
  | "monster-candidate";

type CuratedAssetGroup = {
  usage: AssetUsage;
  category: string;
  subdir: string;
  sourceDir: string;
  tags: string[];
  verified: boolean;
  sensitive?: boolean;
  files: string[];
};

type BulkAssetGroup = {
  usage: AssetUsage;
  category: string;
  subdir: string;
  sourceDir: string;
  limit: number;
  tags: string[];
  verified: boolean;
  sensitive?: boolean;
  filenamePattern?: RegExp;
};

type ManifestEntry = {
  id: string;
  usage: AssetUsage;
  category: string;
  sourcePath: string;
  stagedPath: string;
  publicPath: string;
  tags: string[];
  verified: boolean;
  sensitive: boolean;
};

const curatedGroups: CuratedAssetGroup[] = [
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/sword",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["weapon", "sword", "ai-runtime"],
    verified: true,
    files: ["N32501.png", "1004_0.png", "1004_1.png", "31280.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/blade",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["weapon", "blade", "ai-runtime"],
    verified: true,
    files: ["N33101.png", "31280.png", "31281.png", "31282.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/needle",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["weapon", "needle", "ai-runtime"],
    verified: true,
    files: ["N32310.png", "31275.png", "31276.png", "31277.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/talisman",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["artifact", "talisman", "ai-runtime"],
    verified: true,
    files: ["N33010.png", "31263.png", "31264.png", "31265.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/shield",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["artifact", "shield", "ai-runtime"],
    verified: true,
    files: ["N33114.png", "1003_0.png", "1003_1.png", "1003_2.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/focus",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["weapon", "focus", "spellcaster", "ai-runtime"],
    verified: false,
    files: ["31263.png", "1019_2.png", "1018_2.png", "1017_2.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/sword-box",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["artifact", "sword-box", "ai-runtime"],
    verified: false,
    files: ["31280.png", "1010_0.png", "1010_1.png", "1011_0.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/blood-banner",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["artifact", "blood-banner", "tank", "ai-runtime"],
    verified: false,
    files: ["1019_2.png", "31283.png", "31284.png", "31285.png"],
  },
  {
    usage: "item",
    category: "ai-smithing-route",
    subdir: "item/ai-smithing/swift-ring",
    sourceDir: "img/icon/装备 武器 法宝",
    tags: ["artifact", "swift-ring", "fast-cast", "ai-runtime"],
    verified: false,
    files: ["1003_0.png", "1003_1.png", "1003_2.png", "1005_0.png"],
  },
  {
    usage: "item",
    category: "five-elements-material",
    subdir: "item/ai-smithing/material-metal",
    sourceDir: "img/icon",
    tags: ["material", "metal", "five-elements"],
    verified: false,
    files: ["100401.png", "101612.png", "100300.png"],
  },
  {
    usage: "item",
    category: "five-elements-material",
    subdir: "item/ai-smithing/material-wood",
    sourceDir: "img/icon",
    tags: ["material", "wood", "five-elements"],
    verified: false,
    files: ["100201.png", "100401.png", "30025.png"],
  },
  {
    usage: "item",
    category: "five-elements-material",
    subdir: "item/ai-smithing/material-water",
    sourceDir: "img/icon",
    tags: ["material", "water", "five-elements"],
    verified: false,
    files: ["100201.png", "30025.png", "101612.png"],
  },
  {
    usage: "item",
    category: "five-elements-material",
    subdir: "item/ai-smithing/material-fire",
    sourceDir: "img/icon",
    tags: ["material", "fire", "five-elements"],
    verified: false,
    files: ["100300.png", "100401.png", "30025.png"],
  },
  {
    usage: "item",
    category: "five-elements-material",
    subdir: "item/ai-smithing/material-earth",
    sourceDir: "img/icon",
    tags: ["material", "earth", "five-elements"],
    verified: false,
    files: ["101612.png", "100401.png", "30025.png"],
  },
  {
    usage: "skill-icon",
    category: "skill-icon-core",
    subdir: "skill-icon/ai-smithing/core",
    sourceDir: "img/icon/技能图标",
    tags: ["skill", "icon", "ai-runtime"],
    verified: true,
    files: ["10204.png", "11111.png", "14203.png", "20005.png", "20006.png", "20007.png"],
  },
  {
    usage: "skill-sprite",
    category: "combat-sprite-core",
    subdir: "skill-sprite/four-realms",
    sourceDir: "img/技能特效",
    tags: ["skill", "sprite", "combat", "four-realms"],
    verified: true,
    files: [
      "30FPS_AC2Q017_Barrier.png",
      "30FPS_ACQ020_Water.png",
      "30FPS_ACQ021_Fire.png",
      "30FPS_ACQ023_LightningA.png",
      "30FPS_ACQ003_Thrust1.png",
      "30FPS_ACQ012_Poison.png",
      "30FPS_ACQ013_Sleep.png",
      "30FPS_AC3T018_Tempest.png",
    ],
  },
  {
    usage: "map-emote",
    category: "map-event-core",
    subdir: "map-emote/four-realms",
    sourceDir: "img/角色地图标签",
    tags: ["map", "event", "emote", "four-realms"],
    verified: true,
    files: ["emo01_01.png", "emo08_01.png", "emo12_01.png", "emo20_01.png", "emo23_anim01.png", "emo24_01.png"],
  },
  {
    usage: "status-effect",
    category: "status-icon-safe",
    subdir: "status-effect/safe",
    sourceDir: "img/icon/状态图标",
    tags: ["status", "safe", "healing", "combat"],
    verified: true,
    files: ["d0001.png", "d0002.png", "d0003.png", "d0004.png", "FX1000.png", "FX1003.png"],
  },
  {
    usage: "status-effect",
    category: "status-restricted",
    subdir: "status-effect/restricted",
    sourceDir: "img/状态",
    tags: ["status", "restricted", "nsfw", "plugin-only"],
    verified: false,
    sensitive: true,
    files: [
      "k_受精_1.png",
      "k_受精_2.png",
      "LewdCrest_1.png",
      "LewdCrest_2.png",
    ],
  },
  {
    usage: "avatar-frame",
    category: "avatar-frame-core",
    subdir: "avatar-frame/candidates/core",
    sourceDir: "img/icon/头像框图标",
    tags: ["avatar-frame", "cosmetic", "candidate"],
    verified: true,
    files: ["3001.png", "3002.png", "3003.png", "3004.png", "3010.png", "3016.png"],
  },
  {
    usage: "map-marker",
    category: "map-marker-faction",
    subdir: "map-marker/faction-and-region",
    sourceDir: "img/icon/流派 地区 图标",
    tags: ["map", "marker", "faction", "region"],
    verified: true,
    files: ["T1201.png", "T1202.png", "T1205.png", "T1210.png", "T1216.png", "gang_icon_1.png"],
  },
];

const bulkGroups: BulkAssetGroup[] = [
  {
    usage: "skill-icon",
    category: "skill-icon-candidate",
    subdir: "skill-icon/ai-candidates/all",
    sourceDir: "img/icon/技能图标",
    limit: 240,
    tags: ["skill", "icon", "candidate"],
    verified: false,
  },
  {
    usage: "skill-sprite",
    category: "skill-sprite-candidate",
    subdir: "skill-sprite/ai-candidates/all",
    sourceDir: "img/技能特效",
    limit: 260,
    tags: ["skill", "sprite", "candidate"],
    verified: false,
  },
  {
    usage: "map-emote",
    category: "map-emote-candidate",
    subdir: "map-emote/ai-candidates/all",
    sourceDir: "img/角色地图标签",
    limit: 160,
    tags: ["map", "emote", "candidate"],
    verified: false,
  },
  {
    usage: "avatar-frame",
    category: "avatar-frame-candidate",
    subdir: "avatar-frame/ai-candidates/all",
    sourceDir: "img/icon/头像框图标",
    limit: 120,
    tags: ["avatar-frame", "candidate"],
    verified: false,
  },
  {
    usage: "map-marker",
    category: "map-marker-candidate",
    subdir: "map-marker/ai-candidates/all",
    sourceDir: "img/icon/流派 地区 图标",
    limit: 120,
    tags: ["map", "marker", "candidate"],
    verified: false,
  },
  {
    usage: "status-effect",
    category: "status-icon-candidate",
    subdir: "status-effect/safe/candidates",
    sourceDir: "img/icon/状态图标",
    limit: 100,
    tags: ["status", "safe", "candidate"],
    verified: false,
  },
  {
    usage: "status-effect",
    category: "status-restricted-candidate",
    subdir: "status-effect/restricted/candidates",
    sourceDir: "img/状态",
    limit: 60,
    tags: ["status", "restricted", "candidate", "plugin-only"],
    verified: false,
    sensitive: true,
  },
  {
    usage: "npc-avatar-candidate",
    category: "npc-avatar-candidate",
    subdir: "npc-avatar/ai-candidates/headwear-clothes",
    sourceDir: "img/icon/头饰 服饰 装饰",
    limit: 260,
    tags: ["npc", "avatar", "candidate"],
    verified: false,
  },
  {
    usage: "monster-candidate",
    category: "monster-candidate",
    subdir: "monster/ai-candidates/talent",
    sourceDir: "img/icon/天赋图标",
    limit: 180,
    tags: ["monster", "candidate", "talent"],
    verified: false,
  },
  {
    usage: "monster-candidate",
    category: "monster-candidate",
    subdir: "monster/ai-candidates/misc",
    sourceDir: "img/icon/其它图标",
    limit: 180,
    tags: ["monster", "candidate", "misc"],
    verified: false,
  },
];

const aiPromptLibrary = {
  smithing: {
    systemPrompt: "你是修仙炼器生成器。AI 只负责名字、来历、描述与少量词缀建议，数值与绑定技能必须被服务器模板钳制。",
    userTemplate: [
      "当前境界：{{realmStage}}",
      "主材：{{mainMaterial}}",
      "辅材：{{auxA}}、{{auxB}}、{{auxC}}",
      "路线：{{routeLabel}}",
      "允许词缀：{{allowedAttributesJson}}",
      "图标候选需从 manifest 中按路线与五行标签筛选。",
      "请只返回 JSON，字段包含 name、shortName、origin、description、flavorLines、affixes。",
    ].join("\n"),
  },
  encounterStoryboard: {
    systemPrompt: "你是修仙奇遇叙事分镜生成器。请根据地图、敌人、NPC 与固定结局，生成 3-5 镜短分镜。",
    fields: ["title", "summary", "shots[].scene", "shots[].narration", "shots[].speaker", "shots[].line"],
  },
  npcBark: {
    systemPrompt: "你是修仙 NPC 临场对白生成器。只写短对白，不改剧情事实，不替系统判定任务状态。",
    fields: ["mood", "lines[]"],
  },
  mapRumor: {
    systemPrompt: "你是修仙地图传闻生成器。负责生成半真半假的坊间流言与禁忌。",
    fields: ["headline", "rumors[].text", "rumors[].credibility", "rumors[].tag"],
  },
  assetSelectionRules: [
    "物品与法宝优先从 item/ 与 skill-icon/ 中选择，不要拿 npc-avatar 或 monster 目录硬套。",
    "技能视觉优先从 skill-sprite/ 中选择雪碧图；若只需要静态小图，再回退到 skill-icon/。",
    "地图头顶提示与奇遇提示优先从 map-emote/ 中选择。",
    "status-effect/restricted 仅限双修、成人或隐藏插件，不得默认接入主线、地图常规状态与 NPC 头像。",
    "npc-avatar/ai-candidates/headwear-clothes 只是候选裁片，不等于完整人像，落正式 NPC 头像前必须人工复核。",
    "monster/ai-candidates 适合作为怪物头像或怪群标识，不适合拿去充当凡人 NPC 头像。",
    "avatar-frame/ 只能做头像框，不要当地图建筑、怪物头像或物品图标。",
  ],
  uiWaitTexts: [
    "正在以炉火校准器胚……",
    "正在推演主材与五行辅材的契合度……",
    "正在为器物寻找合适的旧事来历……",
  ],
};

async function ensureDir(targetDir: string) {
  await mkdir(targetDir, { recursive: true });
}

async function safeCopyFile(sourcePath: string, targetPath: string) {
  await ensureDir(path.dirname(targetPath));
  await copyFile(sourcePath, targetPath);
}

async function fileExists(targetPath: string) {
  try {
    const info = await stat(targetPath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toPosixPath(value: string) {
  return value.replace(/\\/g, "/");
}

function formatBackupDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatBackupStamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function buildManifestId(entry: Pick<ManifestEntry, "usage" | "publicPath">) {
  return `${entry.usage}:${entry.publicPath.replace(/^\/+/, "")}`;
}

function buildPublicPath(rootDir: string, stagedPath: string) {
  return `/${toPosixPath(path.relative(rootDir, stagedPath)).replace(/^lingxu\//, "")}`;
}

async function collectCuratedAssets(rootDir: string, outputRoot: string, manifest: ManifestEntry[]) {
  for (const group of curatedGroups) {
    for (const filename of group.files) {
      const sourcePath = path.join(rootDir, group.sourceDir, filename);
      if (!(await fileExists(sourcePath))) {
        continue;
      }

      const stagedPath = path.join(outputRoot, group.subdir, filename);
      await safeCopyFile(sourcePath, stagedPath);
      const entry: ManifestEntry = {
        id: "",
        usage: group.usage,
        category: group.category,
        sourcePath: toPosixPath(path.relative(rootDir, sourcePath)),
        stagedPath: toPosixPath(path.relative(rootDir, stagedPath)),
        publicPath: buildPublicPath(rootDir, stagedPath),
        tags: group.tags,
        verified: group.verified,
        sensitive: Boolean(group.sensitive),
      };
      entry.id = buildManifestId(entry);
      manifest.push(entry);
    }
  }
}

async function collectBulkAssets(rootDir: string, outputRoot: string, manifest: ManifestEntry[]) {
  for (const group of bulkGroups) {
    const sourceDir = path.join(rootDir, group.sourceDir);
    const entries = (await readdir(sourceDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .filter((entry) => !group.filenamePattern || group.filenamePattern.test(entry.name))
      .slice(0, group.limit);

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const stagedPath = path.join(outputRoot, group.subdir, entry.name);
      await safeCopyFile(sourcePath, stagedPath);
      const manifestEntry: ManifestEntry = {
        id: "",
        usage: group.usage,
        category: group.category,
        sourcePath: toPosixPath(path.relative(rootDir, sourcePath)),
        stagedPath: toPosixPath(path.relative(rootDir, stagedPath)),
        publicPath: buildPublicPath(rootDir, stagedPath),
        tags: group.tags,
        verified: group.verified,
        sensitive: Boolean(group.sensitive),
      };
      manifestEntry.id = buildManifestId(manifestEntry);
      manifest.push(manifestEntry);
    }
  }
}

async function backupPreviousOutput(outputRoot: string) {
  if (!(await pathExists(outputRoot))) {
    return null;
  }

  const outputParent = path.dirname(outputRoot);
  const now = new Date();
  const backupDir = path.join(outputParent, ".bak", formatBackupDate(now));
  const backupPath = path.join(backupDir, `cosmetics-${formatBackupStamp(now)}`);
  await ensureDir(backupDir);
  await rename(outputRoot, backupPath);
  return backupPath;
}

function buildGroupedIndex(manifest: ManifestEntry[]) {
  const byUsage = new Map<string, ManifestEntry[]>();
  const byCategory = new Map<string, ManifestEntry[]>();
  const byTag = new Map<string, ManifestEntry[]>();

  for (const entry of manifest) {
    const usageList = byUsage.get(entry.usage) || [];
    usageList.push(entry);
    byUsage.set(entry.usage, usageList);

    const categoryList = byCategory.get(entry.category) || [];
    categoryList.push(entry);
    byCategory.set(entry.category, categoryList);

    for (const tag of entry.tags) {
      const tagList = byTag.get(tag) || [];
      tagList.push(entry);
      byTag.set(tag, tagList);
    }
  }

  const compact = (entries: ManifestEntry[]) => entries.map((entry) => ({
    id: entry.id,
    publicPath: entry.publicPath,
    tags: entry.tags,
    verified: entry.verified,
    sensitive: entry.sensitive,
  }));

  return {
    byUsage: Object.fromEntries(Array.from(byUsage.entries()).map(([key, entries]) => [key, compact(entries)])),
    byCategory: Object.fromEntries(Array.from(byCategory.entries()).map(([key, entries]) => [key, compact(entries)])),
    byTag: Object.fromEntries(Array.from(byTag.entries()).map(([key, entries]) => [key, compact(entries)])),
  };
}

async function main() {
  const rootDir = process.cwd();
  const outputRoot = path.join(rootDir, "lingxu", "uploads", "cosmetics");
  const manifest: ManifestEntry[] = [];

  const backupPath = await backupPreviousOutput(outputRoot);
  await ensureDir(outputRoot);
  await collectCuratedAssets(rootDir, outputRoot, manifest);
  await collectBulkAssets(rootDir, outputRoot, manifest);

  const manifestDir = path.join(outputRoot, "ai-catalog");
  await ensureDir(manifestDir);

  const groupedIndex = buildGroupedIndex(manifest);
  await writeFile(
    path.join(manifestDir, "asset-manifest.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: manifest.length,
      entries: manifest,
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(manifestDir, "asset-index.json"),
    JSON.stringify(groupedIndex, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(manifestDir, "ai-prompts.json"),
    JSON.stringify(aiPromptLibrary, null, 2),
    "utf8",
  );

  console.log(`AI 素材库已生成，共 ${manifest.length} 个文件。`);
  console.log(`输出目录: ${path.join("lingxu", "uploads", "cosmetics")}`);
  if (backupPath) {
    console.log(`旧素材已备份到: ${toPosixPath(path.relative(rootDir, backupPath))}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
