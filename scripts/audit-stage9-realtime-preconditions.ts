type AuditTarget = {
  id: string;
  title: string;
  kind: "file-exists" | "content";
  files: string[];
  patterns?: string[];
  requirement: string;
};

export {};

type Finding = {
  target: AuditTarget;
  file: string;
  pattern?: string;
  line?: number;
  text?: string;
};

const strict = process.argv.includes("--strict");

const targets: AuditTarget[] = [
  {
    id: "map-h5-legacy-channel",
    title: "H5 地图控制器仍连接旧 map SSE / WS",
    kind: "content",
    files: ["src/modules/map/ui/hooks/useMapSceneController.ts"],
    patterns: ["/api/game/map/sse", "/ws/game/map/scene"],
    requirement: "完成 M2：useMapSceneController 改为只消费 WorldMapRoom / shared Colyseus hook。",
  },
  {
    id: "map-h5-legacy-move",
    title: "H5 地图移动仍调用旧 /api/game/map/move",
    kind: "content",
    files: ["src/modules/map/ui/hooks/useMapSceneController.ts"],
    patterns: ["/api/game/map/move"],
    requirement: "完成 M1：默认移动提交改走 WorldMapRoom move，旧 move 只保留回滚兼容。",
  },
  {
    id: "map-sse-routes",
    title: "旧地图 SSE route 仍存在",
    kind: "file-exists",
    files: [
      "src/app/api/game/map/sse/route.ts",
      "src/modules/map/api/game/map/sse/route.ts",
    ],
    requirement: "完成 M6 并保留一个版本周期回滚后，才能移动到 .bak/<YYYY-MM-DD>/。",
  },
  {
    id: "map-server-runtime",
    title: "server runtime 仍包含旧地图 WS / SSE / move 分支",
    kind: "content",
    files: ["server.mjs", "realtime-server.mjs"],
    patterns: ["attachMapSceneSocket", "/ws/game/map/scene", "/api/game/map/sse", "/api/game/map/move"],
    requirement: "完成 M3-M6：WorldMapRoom 覆盖 watcher、移动、repair、落账和灰度门禁后再归档。",
  },
  {
    id: "combat-scene-sse-routes",
    title: "旧 combat scene SSE route 仍存在",
    kind: "file-exists",
    files: [
      "src/app/api/game/combat/scene/sse/route.ts",
      "src/modules/combat/api/game/combat/scene/sse/route.ts",
    ],
    requirement: "完成 B1、B3、B5、B6 后才能归档旧 combat scene SSE。",
  },
  {
    id: "combat-server-runtime",
    title: "server runtime 仍包含旧 combat scene WS 分支",
    kind: "content",
    files: ["server.mjs"],
    patterns: ["attachCombatSceneSocket", "/ws/game/combat/scene"],
    requirement: "完成 B1-B6 后才能移除旧 combat scene WS。",
  },
  {
    id: "boss-sse-routes",
    title: "旧 Boss SSE route 仍存在",
    kind: "file-exists",
    files: [
      "src/app/api/game/boss/[id]/sse/route.ts",
      "src/modules/combat/api/game/boss/[id]/sse/route.ts",
    ],
    requirement: "完成 B2、B3、B5、B6 后才能归档旧 Boss SSE。",
  },
  {
    id: "boss-server-runtime",
    title: "server runtime 仍包含旧 Boss WS 代理",
    kind: "content",
    files: ["server.mjs", "realtime-server.mjs"],
    patterns: ["attachBossSocket", "/ws/game/boss/", "/api/game/boss/"],
    requirement: "完成 B2：Boss 战报动画切到 BossRoom timeline_event / settlement 后再移除。",
  },
];

async function readText(file: string) {
  try {
    return await Bun.file(file).text();
  } catch {
    return null;
  }
}

async function fileExists(file: string) {
  try {
    return await Bun.file(file).exists();
  } catch {
    return false;
  }
}

async function collectFindings() {
  const findings: Finding[] = [];

  for (const target of targets) {
    for (const file of target.files) {
      if (target.kind === "file-exists") {
        if (await fileExists(file)) {
          findings.push({ target, file });
        }
        continue;
      }

      const text = await readText(file);
      if (!text) {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (const pattern of target.patterns || []) {
        const lineIndex = lines.findIndex((line) => line.includes(pattern));
        if (lineIndex >= 0) {
          findings.push({
            target,
            file,
            pattern,
            line: lineIndex + 1,
            text: lines[lineIndex].trim(),
          });
        }
      }
    }
  }

  return findings;
}

const findings = await collectFindings();
const grouped = new Map<string, Finding[]>();

for (const finding of findings) {
  const items = grouped.get(finding.target.id) || [];
  items.push(finding);
  grouped.set(finding.target.id, items);
}

if (findings.length === 0) {
  console.log("阶段 9 realtime 前置审计：PASS");
  console.log("未发现旧地图 / combat / Boss realtime active legacy 引用，可以进入严格删除前人工复核。");
  process.exit(0);
}

console.log("阶段 9 realtime 前置审计：BLOCKED");
console.log("以下是阻止删除旧 realtime 的准确引用点；这不是构建失败，而是防误删信号。");
console.log("");

for (const items of grouped.values()) {
  const { target } = items[0]!;
  console.log(`- ${target.title}`);
  console.log(`  前置要求：${target.requirement}`);
  for (const item of items) {
    const location = item.line ? `${item.file}:${item.line}` : item.file;
    const pattern = item.pattern ? ` pattern="${item.pattern}"` : "";
    console.log(`  - ${location}${pattern}`);
    if (item.text) {
      console.log(`    ${item.text}`);
    }
  }
  console.log("");
}

console.log("权威门禁：docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md");
process.exit(strict ? 1 : 0);
