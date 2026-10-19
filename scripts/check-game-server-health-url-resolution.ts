import { resolveGameServerHealthUrlFromEnv } from "../src/modules/admin/services/game-server-health";

type Case = {
  name: string;
  env: Partial<NodeJS.ProcessEnv>;
  expected: string;
};

const cases: Case[] = [
  {
    name: "prefers internal service url over stale docker bridge health url",
    env: {
      GAME_SERVER_HEALTH_URL: "http://172.18.0.5:3201/game-server/health",
      GAME_SERVER_INTERNAL_URL: "http://game-server:3201",
    },
    expected: "http://game-server:3201/game-server/health",
  },
  {
    name: "uses internal service url before public url",
    env: {
      GAME_SERVER_INTERNAL_URL: "http://game-server:3201",
      GAME_SERVER_PUBLIC_URL: "https://mrsj.ren:3201",
    },
    expected: "http://game-server:3201/game-server/health",
  },
  {
    name: "keeps explicit non-docker health url",
    env: {
      GAME_SERVER_HEALTH_URL: "https://mrsj.ren:3201/game-server/health",
      GAME_SERVER_INTERNAL_URL: "http://game-server:3201",
    },
    expected: "https://mrsj.ren:3201/game-server/health",
  },
  {
    name: "falls back to local port",
    env: {
      GAME_SERVER_PORT: "3301",
    },
    expected: "http://127.0.0.1:3301/game-server/health",
  },
];

for (const item of cases) {
  const actual = resolveGameServerHealthUrlFromEnv(item.env);
  if (actual !== item.expected) {
    console.error(`game-server health URL resolution failed: ${item.name}`);
    console.error(`expected: ${item.expected}`);
    console.error(`actual:   ${actual}`);
    process.exit(1);
  }
}

console.log("game-server health URL resolution：PASS");
