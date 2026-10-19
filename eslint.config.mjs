import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/game/**/*.{ts,tsx}", "src/modules/**/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='WebSocket']",
          message: "玩法页禁止直接裸连 WebSocket，请使用 src/modules/shared/services/realtime-channel.ts 或 colyseus-game-client.ts。",
        },
        {
          selector: "NewExpression[callee.name='EventSource']",
          message: "玩法页禁止直接裸连 EventSource，请使用 src/modules/shared/services/realtime-channel.ts。",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".bak/**",
    "**/.bak/**",
    "out/**",
    "build/**",
    "android/**/build/**",
    "next-env.d.ts",
    "plugins/dist/**",
    "docker/.bak/**",
    "docker/four-realms-apply.mjs",
  ]),
]);

export default eslintConfig;
