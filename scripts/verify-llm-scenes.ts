/**
 * 校验各 AI 场景是否都能通过「通用模型配置」回退生效。
 * 用法：bun run scripts/verify-llm-scenes.ts
 */
import { chatCompletion } from "@/modules/ai/services/ai";

const SCENES = [
  "default",
  "npc",
  "event",
  "worldFlavor",
  "openWorld",
  "smithing",
  "alchemy",
  "spiritualRoot",
] as const;

async function main() {
  for (const scene of SCENES) {
    const startedAt = Date.now();
    try {
      const text = await chatCompletion(
        "你是修仙世界的旁白。用不超过 15 个字回答。",
        [{ role: "user", content: "说一句修仙世界的风景描写" }],
        { scene, maxTokens: 60, timeoutMs: 30_000 },
      );
      console.log(`[ok]   ${scene.padEnd(14)} ${Date.now() - startedAt}ms  ${text.trim().slice(0, 40)}`);
    } catch (error) {
      console.log(`[FAIL] ${scene.padEnd(14)} ${Date.now() - startedAt}ms  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

void main();
