import { spawn } from "node:child_process";

interface Stage10ScaleScenario {
  name: string;
  script: string;
  env: Record<string, string>;
}

const scenarios: Stage10ScaleScenario[] = [
  {
    name: "300_online_multi_map",
    script: "load:map-shards",
    env: {
      GAME_LOAD_LOCAL_PORT: "3311",
      GAME_LOAD_CONNECTIONS: "300",
      GAME_LOAD_CONCURRENCY: "50",
      GAME_LOAD_TIMEOUT_MS: "15000",
      GAME_LOAD_MAP_ID: "stage10-multi-map",
      GAME_LOAD_SHARD_ID: "shard",
      GAME_LOAD_MAP_COUNT: "3",
      GAME_LOAD_SHARDS_PER_MAP: "2",
      GAME_LOAD_HOLD_MS: "1000",
      GAME_LOAD_SUPPRESS_DEGRADED_WARNINGS: "1",
    },
  },
  {
    name: "500_online_multi_room",
    script: "load:map-shards",
    env: {
      GAME_LOAD_LOCAL_PORT: "3312",
      GAME_LOAD_CONNECTIONS: "500",
      GAME_LOAD_CONCURRENCY: "75",
      GAME_LOAD_TIMEOUT_MS: "20000",
      GAME_LOAD_MAP_ID: "stage10-multi-room",
      GAME_LOAD_SHARD_ID: "shard",
      GAME_LOAD_MAP_COUNT: "5",
      GAME_LOAD_SHARDS_PER_MAP: "5",
      GAME_LOAD_HOLD_MS: "1000",
      GAME_LOAD_SUPPRESS_DEGRADED_WARNINGS: "1",
    },
  },
  {
    name: "1000_basic_connections",
    script: "load:map-shards",
    env: {
      GAME_LOAD_LOCAL_PORT: "3313",
      GAME_LOAD_CONNECTIONS: "1000",
      GAME_LOAD_CONCURRENCY: "100",
      GAME_LOAD_TIMEOUT_MS: "30000",
      GAME_LOAD_MAP_ID: "stage10-1000",
      GAME_LOAD_SHARD_ID: "shard",
      GAME_LOAD_MAP_COUNT: "10",
      GAME_LOAD_SHARDS_PER_MAP: "10",
      GAME_LOAD_HOLD_MS: "1000",
      GAME_LOAD_SUPPRESS_DEGRADED_WARNINGS: "1",
    },
  },
];

function runScenario(scenario: Stage10ScaleScenario) {
  return new Promise<void>((resolve, reject) => {
    console.log(`[stage10-scale-local] start ${scenario.name}`);
    const child = spawn(process.execPath, ["run", scenario.script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...scenario.env,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`[stage10-scale-local] ok ${scenario.name}`);
        resolve();
        return;
      }
      reject(new Error(`[stage10-scale-local] failed ${scenario.name} code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log("[stage10-scale-local] all scenarios passed");
