type AuditKind = "required-content" | "forbidden-content" | "missing-file";

type AuditTarget = {
  id: string;
  title: string;
  kind: AuditKind;
  file: string;
  patterns?: string[];
  requirement: string;
};

type Finding = {
  target: AuditTarget;
  pattern?: string;
  line?: number;
  text?: string;
};

export {};

const strict = process.argv.includes("--strict");

const targets: AuditTarget[] = [
  {
    id: "map-h5-no-legacy-move",
    title: "H5 地图页不能回流旧 map move / SSE / WS 主链",
    kind: "forbidden-content",
    file: "src/modules/map/ui/hooks/useMapSceneController.ts",
    patterns: ["/api/game/map/move", "/api/game/map/sse", "/ws/game/map/scene"],
    requirement: "P1-B 小批量账号默认 main 时，H5 地图移动必须只走 WorldMapRoom，不保留旧 move fallback。",
  },
  {
    id: "map-legacy-sse-route-archived",
    title: "旧地图 SSE route 必须已归档",
    kind: "missing-file",
    file: "src/app/api/game/map/sse/route.ts",
    requirement: "WORLD_MAP_LEGACY_REALTIME_DISABLED=1 灰度前，旧地图 SSE route 不能仍作为 active route 存在。",
  },
  {
    id: "boss-log-collapsible-tsx",
    title: "Boss 战报必须在 H5 可折叠",
    kind: "required-content",
    file: "src/modules/combat/ui/pages/game/boss/[id]/BossBattlePage.tsx",
    patterns: ["logExpanded", "setLogExpanded", "boss-log-toggle", "aria-expanded={logExpanded}", "boss-log-list"],
    requirement: "移动端 Boss 战报不能常驻遮挡战斗场景，必须有折叠状态和可访问展开状态。",
  },
  {
    id: "boss-log-mobile-css",
    title: "Boss 战报移动端必须限制高度并让动作区进入 mobile dock",
    kind: "required-content",
    file: "src/modules/combat/ui/styles/boss-battle-page.css",
    patterns: ["@media (max-width: 960px)", ".boss-log-list", "max-height: 140px", ".boss-mobile-dock", ".boss-combat-action-panel { display: none; }"],
    requirement: "H5 移动端战报展开后也只能在受控高度内滚动，核心战斗场景和底部操作区不能被战报整屏覆盖。",
  },
  {
    id: "combat-phaser-input",
    title: "CombatPhaserScene 不能只是只读 snapshot",
    kind: "required-content",
    file: "src/modules/combat/ui/components/CombatPhaserScene.tsx",
    patterns: ["onMove?(x: number, y: number): void", "this.input.on(\"pointerdown\"", "state.onMove?.(", "onRepair?(): void"],
    requirement: "Phaser 战斗灰度壳必须暴露输入回调，至少能把场景点击和 repair 交给页面主链处理。",
  },
  {
    id: "combat-phaser-page-mainline",
    title: "普通战斗 Phaser 灰度壳必须接入现有 Colyseus ACK 主链",
    kind: "required-content",
    file: "src/modules/combat/ui/pages/game/combat/[id]/page.tsx",
    patterns: ["COMBAT_PHASER_SCENE_ENABLED", "<CombatPhaserScene", "snapshot={combatRealtimeSceneEnvelope}", "status={combatCommandRoomStatus}", "onMove={handleCombatPhaserMove}", "onRepair={sendCombatRepair}", "requestMove(nextTarget)"],
    requirement: "Phaser 壳点击移动必须复用 useCombatSceneController 的 requestMove 队列、ACK、失败恢复和 repair，不允许另开一条页面级实时主链。",
  },
  {
    id: "combat-page-no-second-room",
    title: "普通战斗页不能为 Phaser 灰度壳重复 join 战斗房间",
    kind: "forbidden-content",
    file: "src/modules/combat/ui/pages/game/combat/[id]/page.tsx",
    patterns: ["import { useCombatColyseusRoom }", "const combatColyseusRoom = useCombatColyseusRoom"],
    requirement: "战斗页只能通过 useCombatSceneController 持有一条 Colyseus 主链，避免重复连接导致 ACK、repair 和 presence 统计分叉。",
  },
  {
    id: "combat-controller-exposes-realtime-state",
    title: "战斗控制器必须向 Phaser 壳暴露实时状态和 repair",
    kind: "required-content",
    file: "src/modules/combat/ui/hooks/useCombatSceneController.ts",
    patterns: ["combatRealtimeSceneEnvelope: combatColyseusRoom.sceneSnapshot", "combatRealtimeLastAck: combatColyseusRoom.lastAck", "sendCombatRepair: combatColyseusRoom.sendRepair", "sendCombatCommandAndWaitForAck: combatColyseusRoom.sendCommandAndWaitForAck"],
    requirement: "页面壳、Phaser 壳和动作面板必须共享同一个控制器实时状态，不再各自直连房间。",
  },
  {
    id: "combat-actions-use-command",
    title: "普通 / 组队战技能、丹药、逃跑必须走 command ACK",
    kind: "required-content",
    file: "src/modules/combat/ui/pages/game/combat/[id]/page.tsx",
    patterns: ["sendCombatCommandAndWaitForAck", "actionType: \"skill\" | \"item\" | \"flee\" | \"surrender\"", "commandType: params.actionType", "void handleAction(\"flee\")", "void handleAction(\"surrender\")", "void handleUseCombatItem(item.itemId)"],
    requirement: "技能、丹药、逃跑不允许回退到旧 HTTP action fallback。",
  },
  {
    id: "pvp-actions-use-command",
    title: "PVP 技能、丹药、认输必须走 command ACK",
    kind: "required-content",
    file: "src/modules/combat/ui/pages/game/pvp/[combatId]/PvpBattlePage.tsx",
    patterns: ["sendPvpCommandAndWaitForAck", "action: \"skill\" | \"surrender\"", "commandType: action", "commandType: \"item\"", "void handleAction(\"skill\", skill.id)", "void handleAction(\"surrender\")", "void handleUseItem(item.itemId)"],
    requirement: "PVP 动作必须进入 PvpRoom command，由服务端裁定和落账。",
  },
  {
    id: "boss-actions-use-command",
    title: "Boss 技能、丹药、advance 必须走 BossRoom command ACK",
    kind: "required-content",
    file: "src/modules/combat/ui/pages/game/boss/[id]/BossBattlePage.tsx",
    patterns: ["sendBossColyseusCommand", "commandType: \"item\"", "commandType: \"skill\"", "commandType: \"timeoutAdvance\""],
    requirement: "Boss 页面动作必须进入 BossRoom command，重复 reconnect / claim 不能靠旧 HTTP fallback 重放。",
  },
  {
    id: "combat-http-action-recovery-only",
    title: "普通战斗页 HTTP action 只能作为 Colyseus 不可用恢复兜底",
    kind: "required-content",
    file: "src/modules/combat/ui/pages/game/combat/[id]/page.tsx",
    patterns: ["submitColyseusCombatAction", "combatCommandRoomStatus !== \"connected\"", "submitHttpCombatAction", "|| await submitHttpCombatAction", "/api/game/combat/action"],
    requirement: "P1-B 主链仍必须优先走 Colyseus command ACK；HTTP action 只允许在房间未连接时走核心 command route 恢复，不能恢复旧 realtime 或默认 HTTP 主流程。",
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

function findPattern(text: string, pattern: string) {
  const lines = text.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.includes(pattern));
  if (lineIndex < 0) {
    return null;
  }
  return {
    line: lineIndex + 1,
    text: lines[lineIndex]!.trim(),
  };
}

async function collectFindings() {
  const findings: Finding[] = [];

  for (const target of targets) {
    if (target.kind === "missing-file") {
      if (await fileExists(target.file)) {
        findings.push({
          target,
          text: `${target.file} 仍存在`,
        });
      }
      continue;
    }

    const text = await readText(target.file);
    if (!text) {
      findings.push({
        target,
        pattern: "<file_missing>",
        text: `${target.file} 不存在`,
      });
      continue;
    }

    for (const pattern of target.patterns || []) {
      const match = findPattern(text, pattern);
      if (target.kind === "required-content" && !match) {
        findings.push({
          target,
          pattern,
          text: `缺少必要内容：${pattern}`,
        });
      }
      if (target.kind === "forbidden-content" && match) {
        findings.push({
          target,
          pattern,
          line: match.line,
          text: match.text,
        });
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
  console.log("P1-B H5 主链切换代码审计：PASS");
  console.log("旧地图 move fallback、战斗 Colyseus 主链、HTTP command 恢复兜底、Boss 移动端战报折叠和 Phaser 战斗灰度壳主链接入均满足代码门禁。");
  console.log("注意：版本周期、线上灰度和 iOS Safari / Android Chrome / PC H5 人工验收仍需按根清单留存日期后再勾选。");
  process.exit(0);
}

console.log(strict ? "P1-B H5 主链切换代码审计：BLOCKED" : "P1-B H5 主链切换代码审计：REPORT");
console.log("以下项目仍阻止 P1-B 代码门禁通过：");
console.log("");

for (const items of grouped.values()) {
  const { target } = items[0]!;
  console.log(`- ${target.title}`);
  console.log(`  前置要求：${target.requirement}`);
  for (const item of items) {
    const location = item.line ? `${target.file}:${item.line}` : target.file;
    const pattern = item.pattern ? ` pattern="${item.pattern}"` : "";
    console.log(`  - ${location}${pattern}`);
    if (item.text) {
      console.log(`    ${item.text}`);
    }
  }
  console.log("");
}

process.exit(strict ? 1 : 0);
