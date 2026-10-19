type Finding = {
  file: string;
  line: number;
  text: string;
};

export {};

const strict = process.argv.includes("--strict");

const scannedFiles = [
  "docker/compose.multiplayer.yml",
  "docker/game-server.Dockerfile",
  "apps/game-server/src/config.ts",
  "src/modules/shared/services/colyseus-game-client.ts",
];

const forbiddenRuntimeAddressPattern = /(?:GAME_SERVER_PUBLIC_ADDRESS|NEXT_PUBLIC_GAME_SERVER_(?:WS_)?URL).*172\.18\.0\.[0-9]+|172\.18\.0\.[0-9]+.*(?:GAME_SERVER_PUBLIC_ADDRESS|NEXT_PUBLIC_GAME_SERVER_(?:WS_)?URL)/;

async function readText(file: string) {
  try {
    return await Bun.file(file).text();
  } catch {
    return null;
  }
}

async function collectFindings() {
  const findings: Finding[] = [];

  for (const file of scannedFiles) {
    const text = await readText(file);
    if (!text) {
      continue;
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenRuntimeAddressPattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }

  return findings;
}

const findings = await collectFindings();

if (findings.length === 0) {
  console.log("game-server public address 审计：PASS");
  console.log("运行配置未发现 Docker 内网 IP 作为浏览器可见地址默认值。");
  process.exit(0);
}

console.log("game-server public address 审计：BLOCKED");
console.log("不要把 172.18.0.x 这类 Docker 内网地址写成 GAME_SERVER_PUBLIC_ADDRESS 或 NEXT_PUBLIC_GAME_SERVER_* 默认值。");
console.log("浏览器可见地址必须使用公网域名 / 端口或正式反代地址；容器间调用使用 Docker 服务名。");
console.log("");

for (const finding of findings) {
  console.log(`- ${finding.file}:${finding.line}`);
  console.log(`  ${finding.text}`);
}

process.exit(strict ? 1 : 0);
