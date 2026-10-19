/**
 * 状态变更刷新帧门禁。
 *
 * 校检三件套之外的专项门禁，防止两类回归：
 * 1. 新增了帧类型但没登记数字 opcode，客户端按号解析会拿到 null。
 * 2. 资产 / 背包 / 进度入库变更后没有下发刷新帧（只回 ACK = 界面停在旧值）。
 *
 * 用法：
 *   bun run scripts/audit-state-refresh-push.ts
 *   bun run scripts/audit-state-refresh-push.ts --strict   # 有错即非零退出
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createStateRefreshFrameGroup,
  isStateRefreshOpcode,
  REALTIME_OPCODE_BY_OUTPUT_TYPE,
  REALTIME_OUTPUT_TYPES,
  resolveRealtimeOpcode,
  resolveRealtimeOutputType,
  validateRealtimeOpcodeRegistry,
} from "@immortality/shared-protocol";

interface Finding {
  level: "error" | "warn";
  code: string;
  message: string;
}

const findings: Finding[] = [];
const strict = process.argv.includes("--strict");

function addError(code: string, message: string) {
  findings.push({ level: "error", code, message });
}

// 1. 组序表自身一致性
const registry = validateRealtimeOpcodeRegistry();
if (!registry.ok) {
  addError("opcode_duplicate", `组序表存在重复号：${registry.duplicates.join(", ")}`);
}

// 2. 每个字符串帧类型都必须有数字 opcode
const missingOpcode = REALTIME_OUTPUT_TYPES.filter(
  (type) => resolveRealtimeOpcode(type) === null,
);
if (missingOpcode.length > 0) {
  addError("opcode_missing", `以下帧类型未登记 opcode：${missingOpcode.join(", ")}`);
}

// 3. 双向映射必须自洽
for (const type of REALTIME_OUTPUT_TYPES) {
  const opcode = resolveRealtimeOpcode(type);
  if (opcode === null) {
    continue;
  }
  if (resolveRealtimeOutputType(opcode) !== type) {
    addError("opcode_roundtrip", `opcode ${opcode} 反解得到 ${resolveRealtimeOutputType(opcode)}，期望 ${type}`);
  }
}

// 4. 状态刷新帧必须是已知 opcode
for (const opcode of [
  REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh,
  REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh,
  REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh,
]) {
  if (!isStateRefreshOpcode(opcode)) {
    addError("refresh_opcode_unknown", `opcode ${opcode} 未登记为状态刷新帧`);
  }
}

// 5. 帧组生成必须覆盖三个域
const group = createStateRefreshFrameGroup({
  playerId: "audit-bot",
  reason: "audit",
  inventory: { changedItemIds: ["item-1"] },
  asset: { currencies: { spiritStone: 1 } },
  progress: { scopes: ["quest"] },
});
if (group.length !== 3) {
  addError("frame_group_incomplete", `帧组应生成 3 帧，实际 ${group.length}`);
}
const groupOpcodes = group.map((frame) => frame.opcode).sort((a, b) => a - b);
const expectedOpcodes = [
  REALTIME_OPCODE_BY_OUTPUT_TYPE.inventory_refresh,
  REALTIME_OPCODE_BY_OUTPUT_TYPE.asset_refresh,
  REALTIME_OPCODE_BY_OUTPUT_TYPE.progress_refresh,
].sort((a, b) => a - b);
if (JSON.stringify(groupOpcodes) !== JSON.stringify(expectedOpcodes)) {
  addError("frame_group_opcode", `帧组 opcode 不符，实际 ${groupOpcodes.join(",")}`);
}

// 6. 扫描实际推送调用点，确认不是"只定义不推送"
const SCAN_ROOTS = ["apps/game-server/src", "src/modules"];
const PUSH_PATTERNS = [
  /pushStateRefresh\s*\(/,
  /pushStateRefreshFrames\s*\(/,
  /pushStateRefreshForPlayer\s*\(/,
];

function walk(dir: string, files: string[]) {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === ".bak") {
      continue;
    }
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

const pushSites: string[] = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(join(process.cwd(), root), [])) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (PUSH_PATTERNS.some((pattern) => pattern.test(content))) {
      pushSites.push(file.replace(`${process.cwd()}/`, "").replace(/\\/g, "/"));
    }
  }
}

if (pushSites.length === 0) {
  addError(
    "no_push_site",
    "全仓库没有任何 pushStateRefresh 调用点：资产变更将不会下发刷新帧，客户端界面不会刷新",
  );
} else {
  console.log(`[ok] 刷新帧推送调用点 ${pushSites.length} 处：`);
  for (const site of pushSites) {
    console.log(`     - ${site}`);
  }
}

const errors = findings.filter((item) => item.level === "error");
const warnings = findings.filter((item) => item.level === "warn");

console.log("");
console.log("=== 状态变更刷新帧门禁 ===");
console.log(`帧类型总数：${REALTIME_OUTPUT_TYPES.length}`);
console.log(`已登记 opcode：${Object.keys(REALTIME_OPCODE_BY_OUTPUT_TYPE).length}`);
console.log(`推送调用点：${pushSites.length}`);
console.log(`错误：${errors.length}  警告：${warnings.length}`);
for (const item of findings) {
  console.log(`  [${item.level}] ${item.code}: ${item.message}`);
}

if (errors.length > 0) {
  console.log("");
  console.log("门禁未通过。");
  process.exit(strict ? 1 : 0);
}

console.log("");
console.log("门禁通过。");
