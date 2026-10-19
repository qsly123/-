type AuditTarget = {
  id: string;
  title: string;
  kind: "file-exists" | "content";
  files: string[];
  patterns?: string[];
  requirement: string;
};

type Finding = {
  target: AuditTarget;
  file: string;
  pattern?: string;
  line?: number;
  text?: string;
};

export {};

const strict = process.argv.includes("--strict");

const activeTargets: AuditTarget[] = [
  {
    id: "world-chat-sse-route",
    title: "世界聊天 SSE route 仍是现役聊天链路",
    kind: "file-exists",
    files: ["src/modules/chat/api/game/chat/sse/route.ts"],
    requirement: "只允许在聊天 / 通知 SSE 专门审计通过并完成 H5 真机替代验证后，按 .bak/<YYYY-MM-DD>/ 归档。",
  },
  {
    id: "nearby-chat-sse-route",
    title: "附近频道 SSE route 仍是现役聊天链路",
    kind: "file-exists",
    files: ["src/modules/chat/api/game/chat/nearby/sse/route.ts"],
    requirement: "附近频道持久化 API 与 SocialRoom presence 分工未替换前，不能归入地图 / combat / Boss 旧 realtime 退役范围。",
  },
  {
    id: "social-notification-sse-route",
    title: "社交通知 SSE route 仍是现役通知链路",
    kind: "file-exists",
    files: ["src/modules/social/api/game/social/sse/route.ts"],
    requirement: "私聊、好友、亲密关系、市场通知和站内通知红点仍依赖该 route，退役前必须另立通知替代方案。",
  },
  {
    id: "chat-page-world-sse",
    title: "聊天页仍消费世界聊天 SSE",
    kind: "content",
    files: ["src/modules/social/ui/ChatPage.tsx"],
    patterns: ["/api/game/chat/sse"],
    requirement: "聊天页世界频道未替换前，保留 shared openJsonEventStream 接入。",
  },
  {
    id: "chat-page-nearby-sse",
    title: "聊天页仍消费附近频道 SSE",
    kind: "content",
    files: ["src/modules/social/ui/ChatPage.tsx"],
    patterns: ["/api/game/chat/nearby/sse"],
    requirement: "附近频道旧持久化消息流未替换前，保留 SSE；SocialRoom nearby_message 只触发刷新，不直接写旧消息列表。",
  },
  {
    id: "chat-page-social-sse",
    title: "聊天页仍消费社交通知 SSE",
    kind: "content",
    files: ["src/modules/social/ui/ChatPage.tsx"],
    patterns: ["/api/game/social/sse"],
    requirement: "聊天页私聊 / 好友 / 亲密关系提醒未替换前，保留 SSE。",
  },
  {
    id: "notification-center-social-sse",
    title: "通知中心仍消费社交通知 SSE",
    kind: "content",
    files: ["src/modules/shared/ui/contexts/GameNotificationContext.tsx"],
    patterns: ["/api/game/social/sse"],
    requirement: "通知中心红点仍通过社交 SSE 触发 summary 刷新，退役前必须有等价事件源或稳定轮询策略。",
  },
  {
    id: "map-chat-announcement-sse",
    title: "地图页仍消费世界聊天公告 SSE",
    kind: "content",
    files: ["src/modules/map/ui/pages/game/map/page.tsx"],
    patterns: ["/api/game/chat/sse"],
    requirement: "地图页只消费聊天公告提示，不代表地图 / combat / Boss 旧 realtime 仍在线；归档需按聊天 SSE 独立计划执行。",
  },
  {
    id: "shared-event-stream-wrapper",
    title: "聊天 / 通知 SSE 通过 shared realtime-channel 封装接入",
    kind: "content",
    files: [
      "src/modules/social/ui/ChatPage.tsx",
      "src/modules/shared/ui/contexts/GameNotificationContext.tsx",
      "src/modules/map/ui/pages/game/map/page.tsx",
    ],
    patterns: ["openJsonEventStream"],
    requirement: "玩法页不能裸连 EventSource；继续通过 shared realtime-channel 维护 fallback 与错误统计。",
  },
];

const retiredRealtimeTargets: AuditTarget[] = [
  {
    id: "retired-map-sse",
    title: "旧地图 realtime SSE 不应被本审计恢复",
    kind: "file-exists",
    files: [
      "src/app/api/game/map/sse/route.ts",
      "src/modules/map/api/game/map/sse/route.ts",
    ],
    requirement: "地图 realtime 退役只看 stage9 审计；本脚本不会要求恢复旧地图 SSE。",
  },
  {
    id: "retired-combat-sse",
    title: "旧 combat realtime SSE 不应被本审计恢复",
    kind: "file-exists",
    files: [
      "src/app/api/game/combat/scene/sse/route.ts",
      "src/modules/combat/api/game/combat/scene/sse/route.ts",
    ],
    requirement: "combat realtime 退役只看 stage9 / stage6 审计；本脚本不会要求恢复旧 combat SSE。",
  },
  {
    id: "retired-boss-sse",
    title: "旧 Boss realtime SSE 不应被本审计恢复",
    kind: "file-exists",
    files: [
      "src/app/api/game/boss/[id]/sse/route.ts",
      "src/modules/combat/api/game/boss/[id]/sse/route.ts",
    ],
    requirement: "Boss realtime 退役只看 stage9 / BossRoom 验收；本脚本不会要求恢复旧 Boss SSE。",
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

async function collectActiveFindings() {
  const findings: Finding[] = [];
  const missing: Finding[] = [];

  for (const target of activeTargets) {
    for (const file of target.files) {
      if (target.kind === "file-exists") {
        if (await fileExists(file)) {
          findings.push({ target, file });
        } else {
          missing.push({ target, file, text: "现役聊天 / 通知 SSE route 不存在" });
        }
        continue;
      }

      const text = await readText(file);
      if (!text) {
        missing.push({ target, file, text: "目标文件不存在或不可读取" });
        continue;
      }

      const lines = text.split(/\r?\n/);
      for (const pattern of target.patterns || []) {
        let matched = false;
        lines.forEach((line, index) => {
          if (!line.includes(pattern)) {
            return;
          }
          matched = true;
          findings.push({
            target,
            file,
            pattern,
            line: index + 1,
            text: line.trim(),
          });
        });
        if (!matched) {
          missing.push({ target, file, pattern, text: "未找到预期依赖引用" });
        }
      }
    }
  }

  return { findings, missing };
}

async function collectRetiredFindings() {
  const findings: Finding[] = [];
  for (const target of retiredRealtimeTargets) {
    for (const file of target.files) {
      if (await fileExists(file)) {
        findings.push({ target, file });
      }
    }
  }
  return findings;
}

function printFinding(prefix: string, finding: Finding) {
  const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  const pattern = finding.pattern ? ` pattern="${finding.pattern}"` : "";
  console.log(`${prefix} ${location}${pattern}`);
  if (finding.text) {
    console.log(`    ${finding.text}`);
  }
}

const { findings, missing } = await collectActiveFindings();
const retiredFindings = await collectRetiredFindings();

console.log("P2-A 聊天 / 通知 SSE 独立审计：REPORT");
console.log("结论：以下 SSE 属于聊天、附近频道、社交通知和地图聊天公告现役依赖，不纳入地图 / combat / Boss 旧 realtime 退役结论。");
console.log("");

for (const finding of findings) {
  console.log(`- ${finding.target.title}`);
  console.log(`  边界：${finding.target.requirement}`);
  printFinding("  -", finding);
  console.log("");
}

if (missing.length > 0) {
  console.log("缺失或异常项：");
  for (const finding of missing) {
    console.log(`- ${finding.target.title}`);
    console.log(`  要求：${finding.target.requirement}`);
    printFinding("  -", finding);
    console.log("");
  }
}

if (retiredFindings.length > 0) {
  console.log("注意：发现旧地图 / combat / Boss realtime SSE 文件仍存在。它们必须继续交给 stage9 审计判断，不属于聊天 / 通知 SSE。");
  for (const finding of retiredFindings) {
    printFinding("  -", finding);
  }
  console.log("");
}

if (missing.length === 0) {
  console.log("状态：PASS。聊天 / 通知 SSE 依赖已被单独列明，退役前仍需真机替代验证和 .bak/<YYYY-MM-DD>/ 归档计划。");
  process.exit(0);
}

console.log(strict
  ? "状态：BLOCKED。严格模式下，现役聊天 / 通知 SSE 依赖缺失或已被误移除。"
  : "状态：WARN。请先确认缺失项是否已有等价替代。");
process.exit(strict ? 1 : 0);
