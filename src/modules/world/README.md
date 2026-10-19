# World 模块

## 模块定位

负责开放世界、世界 NPC、名声与压力、轻委托、成人互动和天道风闻。

## 当前重点

- 开放世界地图池与路网
- 世界 NPC 生成、成长、掉落、轮回
- 名声、压力、风闻与真实事件
- 市场与世界 NPC 联动
- 成人互动与双修核心账本
- 灵田种植、成长、收获与掌天瓶加速

## 关键入口

- `/api/game/world/maps`
- `/api/game/world/map/[id]`
- `/api/game/world/summary`
- `/api/game/world/intel`
- `/api/game/world/npc/[id]/*`
- `/api/game/world/contracts/*`
- `/api/game/double-cultivation/*`
- `/game/double-cultivation`
- `/api/game/spiritual-field`
- `/api/admin/spiritual-field`
- `/game/spiritual-field`

## 核心服务

- `world-map-service.ts`
- `world-npc-service.ts`
- `world-rumor-service.ts`
- `world-summary-service.ts`
- `player-world-pressure-service.ts`
- `world-adult-service.ts`
- `double-cultivation-ledger.ts`
- `double-cultivation-linkage.ts`
- `double-cultivation-actions.ts`
- `double-cultivation-core-api.ts`
- `double-cultivation-profile-stats.ts`
- `spiritual-field-service.ts`
- `world-ai-generation.ts`
- `tiandao-runtime.ts`

## 关联文档

- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)
- [`docs/current/open-world-contracts.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world-contracts.md)
- [`docs/current/open-world-event-guidance-2026-03-19.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world-event-guidance-2026-03-19.md)
- [`docs/current/map-secret-realm.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-secret-realm.md)
- [`docs/current/plugins-and-progression.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/plugins-and-progression.md)
- [`docs/current/core-gameplay-data-driven-design-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/core-gameplay-data-driven-design-2026-07-07.md)

## 注意点

- 世界 NPC、市场、附近频道、成人互动和地图显示是强联动的，不能只改单点。
- 双修已经是固定核心玩法：玩家入口 `/game/double-cultivation`、洞府页固定按钮、角色页固定按钮、角色资料底部“双修状态”资料卡和 `/api/game/double-cultivation/*` 不能回退到插件宿主或插件 Hook。
- 旧双修随机事件动作已迁入 `double-cultivation-random-event.ts`，普通事件和链式事件都通过核心服务处理 `doubleCultivation` 动作、AI 目标变量、亲密度判定和妖兽账本幂等落账。
- 旧附近玩家“双修申请”已核心化为地图“附近道友”资料弹窗固定按钮，直接调用 `/api/game/double-cultivation/request`，不恢复 `map.nearby-player.actions` Hook。
- 灵田已核心化为 `spiritual-field-service.ts`：洞府固定入口进入 `/game/spiritual-field`，种植扣背包灵种，成熟收获直接发背包物品，掌天瓶加速扣服务端能量；旧 `plugin_spiritual_field_*` 表名只作为历史账本兼容。
- 开放世界 AI 关键词池是当前差异化内容的基础，不应继续散落在代码里硬编码。
- 名声/修关系提示不能只停在文案层；若服务端已经生成可接来信或世界委托，地图页与 NPC 详情页都要给出可点击的引导入口。
- 事件引导不能只覆盖来信；主目标、私密邀约、暗线委托、故事链和暗袭提示也必须统一告诉玩家找谁、去哪、坐标与当前步骤。
