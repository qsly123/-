# AI 模块

## 模块定位

`ai` 是统一的大模型调用层，负责模型选择、提示词组织和基础返回解析。

## 当前用途

- 灵根生成
- NPC 对话与摘要
- 随机事件叙事
- 世界风味文案
- AI 炼丹 / AI 炼器文案生成协作

## 核心入口

- `services/ai.ts`
- `services/world-flavor-generation.ts`

## 配置来源

所有模型与提示词配置都应从 `system` 模块读取，不直接写死。

## 关联文档

- [`docs/current/ai-generation-and-crafting.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/ai-generation-and-crafting.md)
- [`docs/current/core-gameplay-data-driven-design-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/core-gameplay-data-driven-design-2026-07-07.md)
- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)
- [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)

## 注意点

- AI 模块只做受控生成，不直接决定最终数值和数据库落账。
- 输出格式一旦修改，要同步检查调用方解析和 fallback。
