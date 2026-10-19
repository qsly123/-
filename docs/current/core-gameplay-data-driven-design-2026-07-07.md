# 核心玩法数据驱动归属：双修、功法、灵田、论道、炼丹、炼器

## 当前结论

阶段 1 的目标是完成玩法归属设计与插件退役边界，不是一次性补完所有玩法内容。

从本阶段开始，双修、功法、灵田、论道、炼丹、炼器都不再允许作为插件包、插件 Hook 或插件后台实体扩展来开发。新增内容必须进入固定核心模块，并通过核心 schema、service、页面/API、后台固定入口和本文件更新来维护。

迁移状态审计：

- `bun run legacy-plugin-gameplay:audit` 会列出双修、论道/PVP、功法、灵田、炼丹、炼器的核心化状态和缺失核心文件。
- `bun run legacy-plugin-gameplay:check` 是成品前严格门禁；历史插件玩法核心入口补齐后应通过，后续缺口以阶段 6 combat 主链和装备实例化增强为主。

## 双修

归属模块：

- 主归属：`src/modules/world`
- 协作模块：`src/modules/character`、`src/modules/social`
- 历史兼容：阶段 9 已将 `src/modules/plugin` 归档到 `src/modules/.bak/2026-07-08/plugin`，不能作为新主链或运行时入口

当前已完成的阶段 1 收口：

- 双修正式账本服务已迁到 `src/modules/world/services/double-cultivation-ledger.ts`。
- 双修状态读取与玩家动作服务已迁到 `src/modules/world/services/double-cultivation-profile-stats.ts` 和 `src/modules/world/services/double-cultivation-actions.ts`。
- 开放世界成人互动已通过 `src/modules/world/services/double-cultivation-linkage.ts` 调用核心账本。
- 玩家双修页面已迁到固定核心入口 `/game/double-cultivation`，接口已迁到 `/api/game/double-cultivation/*`，角色页和洞府页提供固定“双修”入口和待处理红点。
- 角色资料摘要和底部“双修状态”资料卡已改读 `world` 核心服务，不再依赖 `player.profile.extend` 或 `player.profile.bottom.contents` 插件 Hook。
- 随机事件双修动作已迁到 `src/modules/world/services/double-cultivation-random-event.ts`，普通事件和链式事件的 AI 变量候选、玩家 / 妖兽目标选择、妖兽账本幂等落账和亲密度判定不再调用插件 Hook。
- 旧插件双修路由和 UI 已归档，后续玩家入口必须走 `world` / `character` / `social` 固定核心模块，不允许恢复插件宿主主链。

后续迁移任务：

- 双修相关表在 Drizzle schema 中正式声明，替代运行时 `CREATE TABLE IF NOT EXISTS`。
- 附近玩家“双修申请”入口已迁入核心地图入口：地图“附近道友”资料弹窗固定按钮调用 `/api/game/double-cultivation/request`，不恢复 `map.nearby-player.actions` Hook。

## 功法 / 神通

归属模块：

- 主归属：`src/modules/character`
- 战斗协作：`src/modules/combat`
- 共享展示：`src/modules/shared`
- 后台入口：`/admin/skills`

当前代码现实：

- 玩家技能入口为 `/game/skills` 与 `/api/game/skills`。
- 技能表、技能轮转、战斗技能快照、技能视觉效果已走核心代码。
- 功法固定核心入口为 `/game/gongfa`，玩家 API 为 `/api/game/gongfa`，后台固定 API 为 `/api/admin/gongfa`。
- `src/modules/character/services/gongfa-service.ts` 已接管功法书、等级、点数、玩家进度和属性加成聚合；旧 `plugin_gongfa_*` 表名暂作为历史账本兼容，不再代表插件运行时。
- 功法/神通属性加成必须走核心属性聚合，不允许再通过 `player.stats.bonus` 插件 Hook 注入。

后续迁移任务：

- 如果未来改掉 `plugin_gongfa_*` 历史表名，必须先写可重复执行的数据迁移脚本和回滚说明。
- 新功法必须有后台固定配置入口或固定数据包导入脚本。

## 灵田

归属模块：

- 主归属：`src/modules/character`
- 地图协作：`src/modules/map`
- 世界资源协作：`src/modules/world`
- AI 物品协作：`src/modules/ai`、`src/modules/shared`

当前代码现实：

- 四境数据包中已有灵种、掌天瓶、灵田材料等核心数据，不再需要插件载体。
- AI 物品治理文档已要求清理逻辑不能误删灵田依赖物品。
- 灵田固定核心入口为 `/game/spiritual-field`，玩家 API 为 `/api/game/spiritual-field`，后台固定 API 为 `/api/admin/spiritual-field`。
- `src/modules/world/services/spiritual-field-service.ts` 已接管种植、成长、收获、掌天瓶加速和旧 `plugin_spiritual_field_*` 历史账本；旧表名不再代表插件运行时。

后续迁移任务：

- 如果未来改掉 `plugin_spiritual_field_*` 历史表名，必须先处理秘境掉落、AI 物品治理和玩家灵田账本的幂等迁移。
- 后台固定页面或实体入口继续管理灵种、成熟时间、产物与资源消耗。
- 地图资源点或洞府入口如果接入 realtime，必须先定义共享协议。

## 论道

归属模块：

- 主归属：`src/modules/combat`
- 社交协作：`src/modules/social`
- 后续实时房间：`apps/game-server` 的 `PvpRoom`

当前代码现实：

- 论道/PVP 已在 combat 相关 API、runtime、scene、规则文档中作为核心战斗流存在。
- 后续迁移到 Colyseus 时，必须复用共享输入协议和服务端权威战斗结算。

后续迁移任务：

- 论道主流程迁入 `PvpRoom`。
- 旧本地回放主流程退役，结算只由服务端权威规则产生。

## 炼丹

归属模块：

- 主归属：`src/modules/character`
- AI 生成协作：`src/modules/ai`
- 共享规则：`src/modules/shared/services/alchemy-balance.ts`
- 后台配置：固定系统配置与 AI 物品后台

当前代码现实：

- 炼丹模型配置已在 `SYSTEM_CONFIG_ITEMS` 固定注册。
- 炼丹平衡、品质、丹毒和 AI 物品治理已收口到核心服务与文档。
- 后台配置项由 `/api/admin/system-config-items` 固定返回，不再聚合插件配置 Hook。
- 炼丹固定核心入口为 `/game/alchemy`，玩家 API 为 `/api/game/alchemy`，后台固定 API 为 `/api/admin/alchemy`。
- `src/modules/character/services/alchemy-service.ts` 已接管四境炼丹配方导入、材料消耗、软保底、结果发放和 `player_alchemy_logs` 核心账本。
- 内置炼丹配方自举只补缺失编码，不覆盖已存在配置；后台编辑后的配方不会被冷启动或首次访问重置。

后续迁移任务：

- 新增炼丹配方、材料和概率时必须进入 `alchemy_recipes` 核心表或固定数据包。
- 不允许把炼丹模型、概率或产物逻辑放回插件 Hook。

## 炼器

归属模块：

- 主归属：`src/modules/character`
- AI 生成协作：`src/modules/ai`
- 共享规则：`src/modules/shared/services/crafting-rarity.ts`
- 后台配置：固定系统配置与 AI 物品后台

当前代码现实：

- 炼器模型配置已在 `SYSTEM_CONFIG_ITEMS` 固定注册。
- 炼器品质、材料稀有度、装备词条和 AI 物品治理已收口到核心服务与文档。
- 炼器固定核心入口为 `/game/smithing`，玩家 API 为 `/api/game/smithing`，后台固定 API 为 `/api/admin/smithing`。
- `src/modules/character/services/smithing-service.ts` 已接管四境炼器配方导入、材料消耗、软保底、装备产物发放和 `player_smithing_logs` 核心账本。
- 内置炼器配方自举只补缺失编码，不覆盖已存在配置；后台编辑后的配方不会被冷启动或首次访问重置。

后续迁移任务：

- 新增炼器路线、器型和产物时必须进入 `smithing_recipes` 核心表或固定数据包。
- 当前炼器产物先作为装备物品进入背包；后续如引入随机词条或装备实例，必须在 character 核心服务中写幂等实例化与回滚说明。
- 法宝技能绑定必须继续走核心技能和战斗系统，不得由插件动态注入。

## 后台配置规则

- 后台菜单必须来自固定菜单表或固定实体，不再通过 `admin.menu.entities` 插件 Hook 注册。
- 系统配置项必须来自 `SYSTEM_CONFIG_ITEMS` 固定注册，不再通过 `system.config.items` 插件 Hook 注册。
- 新玩法需要运营配置时，优先新增固定后台页面；简单配置可进入 `/admin/systemConfigs`。
- 历史插件实体页保留到阶段 2 / 阶段 9 归档，不再作为新增入口。

## 验收口径

阶段 1 可勾选的完成标准：

- 插件构建脚本不再是日常上线命令。
- 双修正式落账服务位于固定核心模块。
- 功法、灵田、论道、炼丹、炼器的固定模块归属、后台入口规则和后续迁移边界已写入权威 MD。
- 后台系统配置项和菜单不再通过插件 Hook 聚合。

不属于阶段 1 的完成标准：

- 不要求一次性补完灵田完整玩法。
- 不要求本阶段移除所有 legacy 插件 UI。
- 不要求本阶段 drop 插件历史表。
