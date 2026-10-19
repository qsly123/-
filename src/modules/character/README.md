# Character 模块

## 模块定位

负责角色生命周期、主要养成、背包物品、市场、鸿蒙至宝与玩家资料。

## 当前重点

- 角色创建、选择、成长、突破
- 属性汇总与总战力
- 背包、装备、物品效果、市场
- 邮件、签到、排行、功法 / 神通、炼丹、炼器
- 鸿蒙至宝、玩家资料卡与角色页名声入口

## 关键入口

- 页面
  - `/create-character`
  - `/select-character`
  - `/game/character`
  - `/game/inventory`
  - `/game/market`
  - `/game/gongfa`
  - `/game/skills`
  - `/game/player/[id]` 相关弹窗来源
- 接口
  - `/api/character/*`
  - `/api/game/inventory/*`
  - `/api/game/market/*`
  - `/api/game/gongfa`
  - `/api/admin/gongfa`
  - `/api/game/player/[id]`

## 核心服务

- `player-stats.ts`
- `player-status.ts`
- `realm-service.ts`
- `reward-service.ts`
- `hongmeng-treasure-service.ts`
- `market-service.ts`
- `gongfa-service.ts`
- `player-active-skills.ts`

## 关联文档

- [`docs/current/ai-generation-and-crafting.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/ai-generation-and-crafting.md)
- [`docs/current/core-gameplay-data-driven-design-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/core-gameplay-data-driven-design-2026-07-07.md)
- [`docs/current/plugins-and-progression.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/plugins-and-progression.md)
- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)

## 注意点

- 玩家总属性必须看 `player-stats` 聚合结果，不能只看玩家表基础字段。
- 物品、邮件、市场、鸿蒙至宝的改动经常会影响 AI 物品治理和核心成长链。
- 功法 / 神通必须走核心服务、玩家技能装配和属性聚合，不再通过插件 Hook 注入。功法固定入口是 `/game/gongfa`，服务端由 `gongfa-service.ts` 接管旧 `plugin_gongfa_*` 历史账本。
- 炼丹必须走 `alchemy-service.ts`、`/game/alchemy`、`/api/game/alchemy`、`/api/admin/alchemy`，配方、材料消耗、软保底、结果发放和日志账本不再通过插件宿主或插件 Hook 承载。
- 炼器必须走 `smithing-service.ts`、`/game/smithing`、`/api/game/smithing`、`/api/admin/smithing`，配方、材料消耗、软保底、装备产物发放和日志账本不再通过插件宿主或插件 Hook 承载。
- 炼丹、炼器、功法的旧插件表若已经存在，核心 service 必须显式补齐当前列集，不能只写 `CREATE TABLE IF NOT EXISTS`。线上排查和部署后验收使用 `bun run core-crafting-gongfa:schema:audit` 或严格版 `bun run core-crafting-gongfa:schema:check`。
- 玩家自己的名声查看入口当前挂在 `/game/character` 顶部角色名旁的名声徽记，数据源与他人资料卡统一使用 `reputationSummary`。
- 双修是 `world` 核心玩法，角色页和洞府页只提供固定入口、红点和资料卡消费；不要恢复插件宿主、插件 Hook 或空插件动作数组。
- `/game/character` 与玩家资料卡的装备位当前统一为“紧凑图标格”展示，装备名称不在格子内展开，只在点击详情时展示。
- 角色页属性卡已做移动端紧凑化，保持属性颜色与数值可读性，同时缩小留白与装备格占位，优先保证竖屏一屏信息密度。
- 角色页属性说明当前采用“点击属性卡即在卡片上方显示极小悬浮说明，再点任意空白处收起”的即时提示；PC 与移动端统一走点击开关，避免长按带来的显示不稳定与误触拖动。灵根描述限制为短摘要，优先保证首屏可见主功能与属性卡。
- 详细修复说明见 [`docs/current/character-stat-long-press-tooltip-2026-03-19.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/character-stat-long-press-tooltip-2026-03-19.md)。
