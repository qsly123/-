type AuditTarget = {
  id: string;
  title: string;
  kind: "required-content" | "forbidden-content";
  file: string;
  patterns: string[];
  requirement: string;
};

type Finding = {
  target: AuditTarget;
  pattern: string;
  line?: number;
  text?: string;
};

export {};

const targets: AuditTarget[] = [
  {
    id: "combat-colyseus-send-command",
    title: "战斗 H5 Colyseus hook 必须暴露 command 发送器",
    kind: "required-content",
    file: "src/modules/combat/ui/hooks/useCombatColyseusRoom.ts",
    patterns: ["sendCommand", "connection.sendInput(\"command\""],
    requirement: "PVP timeout、后续技能、丹药、认输等动作必须能通过共享 Colyseus input envelope 发出。",
  },
  {
    id: "pvp-timeout-no-legacy-advance",
    title: "PVP H5 超时推进不能再调用旧 /api/game/combat/advance",
    kind: "forbidden-content",
    file: "src/modules/combat/ui/hooks/usePvpBattleSceneController.ts",
    patterns: ["/api/game/combat/advance"],
    requirement: "PVP timeoutAdvance 已有 PvpRoom 服务端能力，H5 定时器必须发送 Colyseus command。",
  },
  {
    id: "pvp-timeout-colyseus-command",
    title: "PVP H5 超时推进必须发送 timeoutAdvance command",
    kind: "required-content",
    file: "src/modules/combat/ui/hooks/usePvpBattleSceneController.ts",
    patterns: ["commandType: \"timeoutAdvance\"", "sendPvpCommand"],
    requirement: "PVP 回合超时必须进入 PvpRoom，由服务端判定是否到期并生成 settlement intent。",
  },
];

async function readText(file: string) {
  try {
    return await Bun.file(file).text();
  } catch {
    return null;
  }
}

async function collectFindings() {
  const findings: Finding[] = [];

  for (const target of targets) {
    const text = await readText(target.file);
    if (!text) {
      findings.push({
        target,
        pattern: "<file_missing>",
        text: `${target.file} 不存在`,
      });
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (const pattern of target.patterns) {
      const lineIndex = lines.findIndex((line) => line.includes(pattern));
      const found = lineIndex >= 0;
      if (target.kind === "required-content" && !found) {
        findings.push({
          target,
          pattern,
          text: `缺少必要内容：${pattern}`,
        });
      }
      if (target.kind === "forbidden-content" && found) {
        findings.push({
          target,
          pattern,
          line: lineIndex + 1,
          text: lines[lineIndex]!.trim(),
        });
      }
    }
  }

  return findings;
}

const findings = await collectFindings();

if (findings.length === 0) {
  console.log("阶段 6 combat Colyseus timeout 子项审计：PASS");
  console.log("PVP timeout 已走 Colyseus command，未发现旧 advance 回流。完整 combat action / move / Boss 主链请运行 stage6:combat-mainline:audit。");
  process.exit(0);
}

console.log("阶段 6 combat Colyseus timeout 子项审计：BLOCKED");
console.log("以下是阻止 PVP timeout 子项继续收口的准确引用点：");
console.log("");

for (const finding of findings) {
  console.log(`- ${finding.target.title}`);
  console.log(`  前置要求：${finding.target.requirement}`);
  const location = finding.line ? `${finding.target.file}:${finding.line}` : finding.target.file;
  console.log(`  - ${location} pattern="${finding.pattern}"`);
  if (finding.text) {
    console.log(`    ${finding.text}`);
  }
  console.log("");
}

process.exit(1);
