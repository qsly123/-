import { existsSync } from "fs";

type GameplayStatus = "core-ready" | "core-partial" | "blocked";

type GameplayTarget = {
  id: string;
  title: string;
  legacySource: string;
  expectedCoreModule: string;
  requiredFiles: string[];
  partialFiles?: string[];
  notes: string[];
};

type GameplayReport = GameplayTarget & {
  status: GameplayStatus;
  missingRequiredFiles: string[];
  existingRequiredFiles: string[];
  existingPartialFiles: string[];
};

export {};

const strict = process.argv.includes("--strict");

const targets: GameplayTarget[] = [
  {
    id: "double-cultivation",
    title: "双修",
    legacySource: "double-cultivation builtin plugin hooks/routes/pages",
    expectedCoreModule: "src/modules/world",
    requiredFiles: [
      "src/modules/world/services/double-cultivation-actions.ts",
      "src/modules/world/services/double-cultivation-ledger.ts",
      "src/modules/world/services/double-cultivation-random-event.ts",
      "src/modules/world/ui/pages/game/double-cultivation/page.tsx",
      "src/modules/world/api/game/double-cultivation/request/route.ts",
      "src/modules/world/api/game/double-cultivation/respond/route.ts",
    ],
    notes: [
      "固定核心页面、请求/响应 API、随机事件动作、附近玩家申请入口已迁入 world / map。",
    ],
  },
  {
    id: "lundao",
    title: "论道 / PVP",
    legacySource: "lundao plugin arena/daily/weekly tables",
    expectedCoreModule: "src/modules/combat + apps/game-server/PvpRoom",
    requiredFiles: [
      "src/modules/combat/services/pvp-runtime-service.ts",
      "src/modules/combat/ui/pages/game/pvp/[combatId]/PvpBattlePage.tsx",
      "src/modules/combat/api/game/pvp/route.ts",
      "apps/game-server/src/rooms/pvp-room.ts",
    ],
    partialFiles: [
      "src/modules/combat/ui/pages/game/pvp/[combatId]/PvpBattlePage.tsx",
      "src/modules/combat/api/game/combat/action/route.ts",
    ],
    notes: [
      "PVP 已是核心 combat + PvpRoom 主链；H5 技能/丹药/认输旧 HTTP action fallback 已移除，断线裁定和正式结果幂等落账已进入核心服务；匹配与排名服务后续继续增强。",
    ],
  },
  {
    id: "gongfa",
    title: "功法",
    legacySource: "plugin_gongfa_* tables and gongfa-admin.ts",
    expectedCoreModule: "src/modules/character",
    requiredFiles: [
      "src/modules/character/services/gongfa-service.ts",
      "src/modules/character/ui/pages/game/gongfa/page.tsx",
      "src/modules/character/api/game/gongfa/route.ts",
      "src/modules/character/api/admin/gongfa/route.ts",
    ],
    partialFiles: [
      "src/modules/shared/services/gongfa-bonus.ts",
      "src/modules/character/ui/pages/game/skills/page.tsx",
      "src/modules/character/api/game/skills/route.ts",
    ],
    notes: [
      "功法书、等级、点数、玩家进度、玩家 H5 页、玩家 API 与后台固定 API 已由 character 核心模块接管；旧 plugin_gongfa_* 表名暂作为历史账本兼容，不恢复插件 Hook。",
    ],
  },
  {
    id: "spiritual-field",
    title: "灵田",
    legacySource: "plugin_spiritual_field_* tables",
    expectedCoreModule: "src/modules/world or src/modules/character",
    requiredFiles: [
      "src/modules/world/services/spiritual-field-service.ts",
      "src/modules/world/ui/pages/game/spiritual-field/page.tsx",
      "src/modules/world/api/game/spiritual-field/route.ts",
      "src/modules/world/api/admin/spiritual-field/route.ts",
    ],
    partialFiles: [
      "src/db/offline-packs/four-realms-pack.ts",
      "src/modules/admin/services/ai-item-admin-service.ts",
    ],
    notes: [
      "灵田种植、成长、收获、掌天瓶加速、玩家 H5 页、玩家 API 与后台固定 API 已由 world 核心模块接管；旧 plugin_spiritual_field_* 表名暂作为历史账本兼容，不恢复插件 Hook。",
    ],
  },
  {
    id: "alchemy",
    title: "炼丹",
    legacySource: "alchemy plugin recipes/logs and soft-pity docs",
    expectedCoreModule: "src/modules/character + src/modules/shared",
    requiredFiles: [
      "src/modules/character/services/alchemy-service.ts",
      "src/modules/character/ui/pages/game/alchemy/page.tsx",
      "src/modules/character/api/game/alchemy/route.ts",
      "src/modules/character/api/admin/alchemy/route.ts",
    ],
    partialFiles: [
      "src/modules/shared/services/alchemy-balance.ts",
      "docs/current/ai-generation-and-crafting.md",
    ],
    notes: [
      "炼丹配方、材料消耗、软保底、结果发放、玩家 H5 页、玩家 API 与后台固定 API 已由 character 核心模块接管；不恢复插件 Hook 或插件宿主。",
    ],
  },
  {
    id: "smithing",
    title: "炼器",
    legacySource: "smithing plugin recipes/logs and soft-pity docs",
    expectedCoreModule: "src/modules/character + src/modules/shared",
    requiredFiles: [
      "src/modules/character/services/smithing-service.ts",
      "src/modules/character/ui/pages/game/smithing/page.tsx",
      "src/modules/character/api/game/smithing/route.ts",
      "src/modules/character/api/admin/smithing/route.ts",
    ],
    partialFiles: [
      "docs/current/ai-generation-and-crafting.md",
      "docs/current/equipment-effect-color-tiering-2026-03-19.md",
    ],
    notes: [
      "炼器配方、材料消耗、软保底、装备产物发放、玩家 H5 页、玩家 API 与后台固定 API 已由 character 核心模块接管；当前产物先进入背包，后续高阶装备实例化再走独立核心规则增强。",
    ],
  },
];

function fileExists(file: string) {
  return existsSync(file);
}

function buildReport(target: GameplayTarget): GameplayReport {
  const existingRequiredFiles = target.requiredFiles.filter(fileExists);
  const missingRequiredFiles = target.requiredFiles.filter((file) => !fileExists(file));
  const existingPartialFiles = (target.partialFiles || []).filter(fileExists);
  const status: GameplayStatus = missingRequiredFiles.length === 0
    ? "core-ready"
    : existingRequiredFiles.length > 0 || existingPartialFiles.length > 0
      ? "core-partial"
      : "blocked";

  return {
    ...target,
    status,
    missingRequiredFiles,
    existingRequiredFiles,
    existingPartialFiles,
  };
}

const reports = targets.map(buildReport);
const blockedReports = reports.filter((report) => report.status !== "core-ready");

console.log(strict && blockedReports.length > 0
  ? "历史插件玩法核心化审计：BLOCKED"
  : "历史插件玩法核心化审计：REPORT");
console.log("");

for (const report of reports) {
  const statusLabel = report.status === "core-ready"
    ? "已核心化"
    : report.status === "core-partial"
      ? "部分核心化"
      : "缺核心入口";
  console.log(`- ${report.title}: ${statusLabel}`);
  console.log(`  历史来源：${report.legacySource}`);
  console.log(`  目标模块：${report.expectedCoreModule}`);
  if (report.existingRequiredFiles.length > 0) {
    console.log("  已存在核心文件：");
    for (const file of report.existingRequiredFiles) {
      console.log(`    - ${file}`);
    }
  }
  if (report.existingPartialFiles.length > 0) {
    console.log("  已存在部分承接：");
    for (const file of report.existingPartialFiles) {
      console.log(`    - ${file}`);
    }
  }
  if (report.missingRequiredFiles.length > 0) {
    console.log("  缺失核心文件：");
    for (const file of report.missingRequiredFiles) {
      console.log(`    - ${file}`);
    }
  }
  for (const note of report.notes) {
    console.log(`  备注：${note}`);
  }
  console.log("");
}

process.exit(strict && blockedReports.length > 0 ? 1 : 0);
