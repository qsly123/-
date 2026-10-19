# 核心玩法扩展与插件退役

## 当前结论

插件体系已经进入退役流程，不再作为新增玩法的扩展方式。

后续新增成长、地图、战斗、开放世界、社交、宗门、后台内容时，必须进入固定核心模块，并同步 schema、service、页面、后台入口和权威 MD。不得再通过动态插件 Hook、插件页面宿主、插件路由或上传插件包来扩展核心玩法。

全量重构主计划见：

- `docs/current/rewrite-multiplayer-core-plan.md`
- `docs/current/core-gameplay-data-driven-design-2026-07-07.md`

## 插件系统 legacy 范围

以下能力只作为历史兼容范围，不再新增能力：

- 插件上传、安装、启停、卸载
- 插件运行时 `runtime.ts`
- 插件 action 路由
- 插件页面宿主渲染
- 插件静态资源代理
- 插件后台菜单和后台实体
- 插件系统配置项
- 插件角色属性加成
- 插件页面扩展
- 插件通知角标扩展
- 插件随机事件 action / judge
- 插件附近玩家动作

旧插件文档已经归档到 `docs/.bak/2026-07-07/plugin/`，剩余插件源码已经归档到 `src/modules/.bak/2026-07-08/plugin`。它们只用于追溯历史，不再作为新开发入口或运行时入口。

## 历史插件玩法迁移口径

历史插件玩法如果继续保留，必须迁入核心模块。

迁移状态审计命令：

- `bun run legacy-plugin-gameplay:audit`：报告双修、论道/PVP、功法、灵田、炼丹、炼器的核心化状态和缺失核心文件。
- `bun run legacy-plugin-gameplay:check`：成品前严格门禁，所有历史插件玩法都有固定核心入口后才能通过。
- `bun run core-crafting-gongfa:schema:audit`：执行炼丹、炼器、功法核心 service 的旧表补列，并报告旧插件表是否具备当前核心接口需要的列。
- `bun run core-crafting-gongfa:schema:check`：线上修复后严格门禁，缺少当前核心列时返回失败。

当前建议：

- AI 炼丹 / AI 炼器
  - 归入 `character`、`ai`、`admin` 与 `shared` 的核心服务协作。
  - 具体规则继续以 `docs/current/ai-generation-and-crafting.md` 为准。
  - 炼丹已补固定核心模块：`src/modules/character/services/alchemy-service.ts`、`/game/alchemy`、`/api/game/alchemy`、`/api/admin/alchemy`。
  - 炼器已补固定核心模块：`src/modules/character/services/smithing-service.ts`、`/game/smithing`、`/api/game/smithing`、`/api/admin/smithing`；当前产物先进入背包，后续装备实例化继续走核心规则增强。
  - 旧 `alchemy_recipes`、`smithing_recipes`、`player_alchemy_logs`、`player_smithing_logs` 表可能来自插件时代；核心 service 启动时必须用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 补齐 `recipe_code`、软保底、结果物品和成功率日志列，不能只依赖 `CREATE TABLE IF NOT EXISTS`。
- 双修
  - 正式账本、状态读取和玩家动作归入 `world` 固定核心模块，角色状态与社交关系分别由 `character`、`social` 协作。
  - 玩家固定入口为 `/game/double-cultivation`，固定 API 为 `/api/game/double-cultivation/overview`、`stats`、`notification-count`、`request`、`respond`。
  - 旧 `dongfu.page.extend` 已迁为洞府页固定“双修”按钮，旧 `player.profile.bottom.contents` 已迁为角色资料底部“双修状态”资料卡，均读取 `world` 核心服务。
  - 旧 `random-event.*` 已迁为核心随机事件动作与判定：`doubleCultivation` 支持 AI 变量候选、玩家 / 妖兽目标选择、幂等妖兽账本落账和亲密度判定，不再调用插件 Hook。
  - 旧 `map.nearby-player.actions` 已迁为地图“附近道友”资料弹窗固定“申请双修”按钮，直接调用 `/api/game/double-cultivation/request`，不再回退到插件 Hook。
  - 不能再依赖插件宿主路由和插件 Hook 作为主链；旧插件 UI / 路由已归档，不再作为过渡入口。
- 功法
  - 归入 `character` 的成长系统或新增固定核心模块。
  - 属性加成必须通过核心属性聚合服务计算，不再通过 `player.stats.bonus` Hook。
  - 当前已补固定核心模块：`src/modules/character/services/gongfa-service.ts`、`/game/gongfa`、`/api/game/gongfa`、`/api/admin/gongfa`。
  - 旧 `plugin_gongfa_*` 表名暂作为核心账本兼容，后续如改表名必须写幂等迁移脚本，不允许恢复插件 Hook。
  - 旧 `plugin_gongfa_player_points` 和 `plugin_gongfa_point_logs` 可能缺少 `total_earned`、`delta`、`source_ref` 等核心列；`gongfa-service.ts` 负责自动补列并同步旧 `change_amount/source` 字段，避免旧玩家访问 `/api/game/gongfa` 时 500。
- 灵田
  - 归入 `character` / `world` / `map` 的核心资源与地图玩法。
  - 高阶灵种、掌天瓶、AI 秘境材料仍要纳入 AI 物品治理。
  - 当前已补固定核心模块：`src/modules/world/services/spiritual-field-service.ts`、`/game/spiritual-field`、`/api/game/spiritual-field`、`/api/admin/spiritual-field`。
  - 旧 `plugin_spiritual_field_*` 表名暂作为核心账本兼容，秘境掉落和 AI 物品治理继续读取该账本；后续改表名必须写幂等迁移脚本。
- 论道
  - 归入 `combat` 或 `social`，如果参与实时 PVP，需要接入新的 Colyseus 房间协议。
  - 当前已由 `combat` PVP runtime 和 `PvpRoom` 承接主入口；阶段 6 action / useItem / surrender 主链仍需继续切到 Colyseus command。

## 新玩法开发规则

新增玩法必须满足：

- 有明确所属模块。
- 有 Drizzle schema 或系统配置表。
- 有服务端核心 service。
- 有前台页面或固定入口。
- 如需运营配置，必须有后台固定入口。
- 如涉及 realtime，必须先定义共享协议。
- 如涉及成长数值，必须走核心属性聚合。
- 如涉及地图或战斗，必须服务端权威。
- 必须更新 `docs/current/*` 与对应模块 `README.md`。

禁止：

- 新增插件包作为玩法载体。
- 通过动态 Hook 修改角色属性、地图行为、战斗数值或通知结果。
- 为某个玩法临时绕开核心 service 直接写跨模块页面逻辑。
- 把高频实时状态藏在客户端内存或插件运行时中。

## 数据保留规则

- 历史插件安装记录暂时保留只读兼容。
- 已沉淀的玩家成长数据不直接删除。
- 已迁入核心模块的数据需要写幂等迁移脚本。
- 不再使用的数据表先标记 legacy，稳定后再按归档策略处理。
- 涉及删除文件或文档时，先移动到 `.bak/<YYYY-MM-DD>/`。

## 后续退役验收

插件系统彻底退役前必须满足：

- `bun run build` 不依赖插件构建产物。
- `bun run lint` 通过。
- 后台没有插件上传、启停、实体扩展入口。
- 玩家页面没有插件加载失败或插件诊断卡。
- 地图、角色、通知、随机事件不再调用插件 Hook。
- 新开发者从 `docs/current/README.md` 读起时，不会把旧插件专题文档当作当前开发规范。
