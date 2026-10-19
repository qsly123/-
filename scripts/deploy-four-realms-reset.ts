const EXECUTE_DEPLOY = process.env.FOUR_REALMS_DEPLOY === "1";

type Step = {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
};

async function runStep(step: Step) {
  console.log(JSON.stringify({
    step: step.name,
    cmd: step.cmd.join(" "),
  }, null, 2));

  const child = Bun.spawn({
    cmd: step.cmd,
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ...step.env,
    },
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`步骤失败: ${step.name} (exit=${exitCode})`);
  }
}

async function main() {
  if (!EXECUTE_DEPLOY) {
    console.log(JSON.stringify({
      executed: false,
      reason: "未设置 FOUR_REALMS_DEPLOY=1，仅允许显式开关后执行清理/迁移/导入",
    }, null, 2));
    return;
  }

  const bunBin = process.execPath;
  const steps: Step[] = [
    { name: "validate-pack", cmd: [bunBin, "run", "worldpack:four-realms:validate"] },
    { name: "prune-legacy", cmd: [bunBin, "run", "worldpack:four-realms:prune-legacy"], env: { FOUR_REALMS_PRUNE: "1" } },
    { name: "db-migrate", cmd: [bunBin, "run", "db:migrate"] },
    {
      name: "apply-pack",
      cmd: [bunBin, "run", "worldpack:four-realms:apply"],
      env: {
        FOUR_REALMS_APPLY: "1",
        ...(process.env.FOUR_REALMS_APPLY_FORCE === "1" ? { FOUR_REALMS_APPLY_FORCE: "1" } : {}),
      },
    },
  ];

  for (const step of steps) {
    await runStep(step);
  }

  console.log(JSON.stringify({
    executed: true,
    steps: steps.map((step) => step.name),
  }, null, 2));
}

main().catch((error) => {
  console.error("[four-realms] 一键部署失败", error);
  process.exit(1);
});
