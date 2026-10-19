import { spawn } from "node:child_process";

interface Stage10Scenario {
  name: string;
  script: string;
  env: Record<string, string>;
}

const scenarios: Stage10Scenario[] = [
  {
    name: "100_online_same_map",
    script: "load:basic",
    env: {
      GAME_LOAD_LOCAL_PORT: "3301",
      GAME_LOAD_CONNECTIONS: "100",
      GAME_LOAD_CONCURRENCY: "20",
      GAME_LOAD_TIMEOUT_MS: "10000",
      GAME_LOAD_MAP_ID: "stage10-map",
      GAME_LOAD_SHARD_ID: "0",
    },
  },
  {
    name: "boss_20_players",
    script: "load:boss-command",
    env: {
      GAME_LOAD_LOCAL_PORT: "3302",
      GAME_LOAD_BOSS_ROOMS: "1",
      GAME_LOAD_BOSS_PLAYERS: "20",
      GAME_LOAD_BOSS_COMMANDS_PER_PLAYER: "1",
      GAME_LOAD_CONCURRENCY: "1",
      GAME_LOAD_TIMEOUT_MS: "10000",
    },
  },
  {
    name: "pvp_8_rooms",
    script: "load:pvp-command",
    env: {
      GAME_LOAD_LOCAL_PORT: "3303",
      GAME_LOAD_PVP_ROOMS: "8",
      GAME_LOAD_PVP_COMMANDS_PER_PLAYER: "1",
      GAME_LOAD_CONCURRENCY: "4",
      GAME_LOAD_TIMEOUT_MS: "10000",
    },
  },
];

function runScenario(scenario: Stage10Scenario) {
  return new Promise<void>((resolve, reject) => {
    console.log(`[stage10-local] start ${scenario.name}`);
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
        console.log(`[stage10-local] ok ${scenario.name}`);
        resolve();
        return;
      }
      reject(new Error(`[stage10-local] failed ${scenario.name} code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log("[stage10-local] all scenarios passed");
