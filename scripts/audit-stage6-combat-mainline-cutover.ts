type LegacyCombatCaller = {
  id: string;
  title: string;
  file: string;
  patterns: string[];
  requirement: string;
  method?: "POST";
};

type Finding = {
  target: LegacyCombatCaller;
  pattern: string;
  line: number;
  text: string;
};

export {};

const strict = process.argv.includes("--strict");

const targets: LegacyCombatCaller[] = [
  {
    id: "solo-combat-action-http",
    title: "普通 / 组队战技能、逃跑、丹药仍保留旧 HTTP action fallback",
    file: "src/modules/combat/ui/pages/game/combat/[id]/page.tsx",
    patterns: ["/api/game/combat/action"],
    requirement: "普通单人战斗与组队战默认必须走 Colyseus command；当前已接入 solo pending combat transaction 与 party encounter transaction，旧 HTTP action 只能作为 legacy / main-with-http-fallback 临时兼容。删除 fallback 前仍需 H5 三端灰度确认，并确保组队 movement、Boss、PVP 不再依赖旧 action 兼容。",
  },
  {
    id: "combat-scene-advance-http",
    title: "组队战超时推进仍保留旧 HTTP advance fallback",
    file: "src/modules/combat/ui/hooks/useCombatSceneController.ts",
    patterns: ["/api/game/combat/advance"],
    requirement: "组队战 timeoutAdvance 默认必须进入 Colyseus command，并保留旧主链的 advancePartyCombatTimeout、turnState 更新、scene snapshot、参与校验、锁与失败恢复语义；旧 HTTP advance 只能作为 legacy / fallback 临时兼容。",
  },
  {
    id: "combat-scene-move-http",
    title: "普通 / 组队战移动仍保留旧 HTTP move fallback",
    file: "src/modules/combat/ui/hooks/useCombatSceneController.ts",
    patterns: ["/api/game/combat/move"],
    requirement: "普通单人战斗移动默认必须走 Colyseus movement，并保持 pending combat session 写回、scene snapshot、acceptedClientSequence 和失败恢复语义；旧 HTTP move 只能作为 legacy 开关或组队战临时兼容。",
  },
  {
    id: "pvp-action-http",
    title: "PVP 技能 / 认输 / 丹药仍保留旧 HTTP action fallback",
    file: "src/modules/combat/ui/pages/game/pvp/[combatId]/PvpBattlePage.tsx",
    patterns: ["/api/game/combat/action"],
    requirement: "PVP action、useItem、surrender 默认已进入 PvpRoom command，并复用 performPvpCombatActionTransaction 覆盖 performPvpCombatAction、prepareCombatItemUsage、consumeOneCombatItem、syncPvpCombatRuntime、失败 ACK 与 accepted sequence；旧 HTTP action 只能作为 legacy / main-with-http-fallback 临时兼容。删除 fallback 前仍需 H5 三端灰度、断线裁定和正式 PVP 结果落账确认。",
  },
  {
    id: "boss-action-http",
    title: "Boss action / advance 仍保留旧 HTTP boss POST fallback",
    file: "src/modules/combat/ui/pages/game/boss/[id]/BossBattlePage.tsx",
    patterns: ["/api/game/boss/"],
    method: "POST",
    requirement: "Boss 攻击、技能、超时推进已接入 BossRoom command 优先路径；game-server 已移除 GAME_WEB_INTERNAL_URL 内部 HTTP 网络 bridge，改为本地 route adapter 执行真实事务。当前 H5 仍保留旧 Boss HTTP POST fallback，且 route adapter 背后仍有奖励 replay 补偿、响应包装和 claim 语义未完全抽成核心 service。删除 fallback 前必须继续抽离 route 事务并完成 H5 三端灰度。",
  },
];

async function readText(file: string) {
  try {
    return await Bun.file(file).text();
  } catch {
    return null;
  }
}

function collectPatternFindings(params: {
  target: LegacyCombatCaller;
  text: string;
  pattern: string;
}) {
  const findings: Finding[] = [];
  const lines = params.text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes(params.pattern)) {
      continue;
    }
    if (params.target.method) {
      const lookahead = lines.slice(index, index + 8).join("\n");
      if (!lookahead.includes(`method: "${params.target.method}"`)) {
        continue;
      }
    }
    findings.push({
      target: params.target,
      pattern: params.pattern,
      line: index + 1,
      text: line.trim(),
    });
  }
  return findings;
}

async function collectFindings() {
  const findings: Finding[] = [];

  for (const target of targets) {
    const text = await readText(target.file);
    if (!text) {
      findings.push({
        target,
        pattern: "<file_missing>",
        line: 0,
        text: `${target.file} 不存在`,
      });
      continue;
    }

    for (const pattern of target.patterns) {
      findings.push(...collectPatternFindings({ target, text, pattern }));
    }
  }

  return findings;
}

const findings = await collectFindings();

if (findings.length === 0) {
  console.log("阶段 6 combat 主链切换审计：PASS");
  console.log("未发现 H5 战斗页继续调用旧 combat / boss HTTP action、move、advance。");
  process.exit(0);
}

console.log(strict
  ? "阶段 6 combat 主链切换审计：BLOCKED"
  : "阶段 6 combat 主链切换审计：REPORT");
console.log("以下是仍阻止旧战斗动作主链退役的准确引用点：");
console.log("");

for (const finding of findings) {
  console.log(`- ${finding.target.title}`);
  console.log(`  前置要求：${finding.target.requirement}`);
  const location = finding.line > 0 ? `${finding.target.file}:${finding.line}` : finding.target.file;
  console.log(`  - ${location} pattern="${finding.pattern}"`);
  console.log(`    ${finding.text}`);
  console.log("");
}

process.exit(strict ? 1 : 0);
