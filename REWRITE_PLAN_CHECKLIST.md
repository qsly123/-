# Immortality 全量重构执行清单

这份文件放在仓库根目录，方便后续直接按阶段复制任务给 AI 执行，避免漏项。

当前执行入口：

- 本文件是后续阶段推进、排查漏项和复制任务给 AI 的唯一阶段清单入口。
- `docs/current/README.md` 只保留当前专题导航，不再承载阶段勾选状态。
- 旧阶段详单、历史前置门禁和日期型过程清单已整合进本文件；如需追溯，查看 `.bak/<日期>/`，不要按归档文档继续执行。

## 当前总方向

- 取消插件体系，不再新增插件包、插件 Hook、插件宿主页面、插件后台实体扩展。
- 已有插件玩法如果保留，必须迁入固定核心模块。
- 多人在线底座迁向 `Colyseus + Phaser + Redis + Postgres`。
- Next.js 继续负责登录、后台、普通页面和低频 API。
- Web H5 是主客户端，必须保证 iOS Safari / Android Chrome / PC 浏览器三端互通。
- 地图、战斗、Boss、PVP、社交 presence 逐步进入独立 `apps/game-server`。

## 当前执行优先级：底层优先门禁

这一节是后续执行的唯一顺序入口。不能再按“哪个功能名字排在前面”开工，必须从上到下通过门禁：

- P0 未完成时，不做 P1 / P2 / P3。
- P0-B 未完成时，不继续勾选 Boss / PVP / 地图等高层“成品体验”。
- P1-A 未完成时，不宣布 realtime 成品稳定。
- P1-B 未完成时，不进入灰度上线批次。
- 每个未完成项完成后，必须在本节打 `[x]`，并同步更新对应专题文档或模块 README。

### P0-A：仓库、线上环境和部署底线

- [X] 轮换已经暴露过的 1Panel、root、数据库、面板、GitHub token 等所有凭据。（暂时不用，先做完全部项目内容我自己更换）
- [X] 记录当前线上版本、数据库备份点、Web 镜像 tag、game-server 镜像 tag。
- [X] 确认 `.bak/` 不进入 GitHub；只保留本地追溯或服务器备份。
- [X] 使用线上真实 `REDIS_URL` 执行 `bun run game:smoke:redis-multi`，留存输出，确认多 game-server 实例共享房间查询与跨实例 `joinById`。
- [X] 线上 Redis 持久化、内存限制、重启策略和告警记录完成。
- [X] WebSocket 反向代理配置验证记录留档，包括 `/game-server/health` 和 WebSocket Upgrade 结果。

### P0-B：数据事务、幂等和核心规则底座

- [X] Postgres 正式事务覆盖奖励发放、掉落发放、任务推进、死亡惩罚、PVP 结果，并保证全部幂等。
- [X] Boss 多人奖励按参与记录或 claim 记录发放，重复 claim / reconnect 不重复发奖。
- [X] 掉线回来能看到最终结果，重复 reconnect 不重复发奖励、不重复推进任务。
- [X] 任务推进抽成 settlement / side-effect intent，不允许房间里继续散落直接推进任务逻辑。
- [X] `CombatRoom / BossRoom / PvpRoom` close 前 flush settlement intent 的失败重试和线上日志留档补齐。
- [X] 地图交互 / 传送 / 秘境入口 / 复杂随机事件奖励继续补幂等事务：重复提交同一 `actionId` 不重复发奖，不把玩家传送到不存在地图。
- [X] 抽出统一地图加载服务，避免 game-server 和 Next API 各自复制地图结构读取逻辑。
- [X] 明确地图坐标单位：格子坐标、像素坐标、Phaser 渲染坐标之间使用单一转换函数。
- [X] 明确 `mapId + shardId` 房间命名、shard 选择策略、单房间目标人数和硬上限，并写入共享协议或当前权威文档。
- [X] 地图结构缓存失效规则和旧 Next 地图缓存保持一致，避免后台改地图后 Colyseus 仍读旧数据。
- [X] AOI 输出继续做隐私净化，禁止后台-only 字段、隐私字段或未净化剧情字段进入 H5。

### P1-A：Realtime 运行稳定性和可观测性

- [X] 房间启动失败、地图结构加载失败、DB 落账失败都要输出结构化日志，包含 `roomId`、`mapId`、`shardId`、失败原因。
- [X] 后台留存地图房间人数、分片、tick、消息量、repair、移动拒绝原因、落账失败统计。
- [X] 后台把断线重连成功率补到按房间维度。
- [X] 后台补 WebSocket fallback / error 更细分统计。
- [X] 后台补多实例部署后的跨进程房间实例聚合。
- [X] 后台监控补 SocialRoom 在线人数、消息量、拒绝原因。
- [X] 运维文档补线上 Redis 多实例 smoke 输出、WebSocket 反代验证截图或日志、game-server health 样例。
- [X] 日志区分 web 请求、game-server 房间、DB 慢查询、Redis 错误、realtime 协议错误。

### P1-B：H5 主链验收和旧入口关闭验证

- [ ] 测试服小批量账号默认 `NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=main` 跑满一个版本周期，并记录无旧 move fallback。
- [ ] 线上确认 `WORLD_MAP_LEGACY_REALTIME_DISABLED=1` 后 `/game/map` 不报错、不丢实体、不假在线。
- [X] Boss 战报在 H5 移动端可折叠，不遮挡核心战斗场景。（代码门禁已由 `bun run stage-p1b:h5-mainline:check` 覆盖；三端真机总验收仍看下方人工项。）
- [X] Phaser 战斗灰度壳接入 command，而不只是只读 snapshot。（普通战斗 Phaser 灰度壳已复用 `useCombatSceneController` 的 Colyseus ACK / repair 主链，不再重复 join 房间。）
- [ ] 技能、丹药、逃跑、认输、移动都走统一 command 后，完成 iOS Safari / Android Chrome / PC 浏览器人工验收。
- [ ] 灰度环境确认旧 combat / Boss realtime 关闭后，普通战斗、组队战、Boss、PVP 均不报错。

### P2-A：玩法内容扩展和社交宗门联动

- [X] 补复杂临时事件源：限时机缘、宗门活动、更多世界委托入口、更多名声事件入口。
- [X] 补临时阻挡、活动区域封锁、传送门占位等完整阻挡规则。
- [X] 聊天页、地图聊天入口、通知中心的 SSE 依赖单独盘点，不混入地图 / combat / Boss 旧 realtime 已退役结论。
- [ ] 附近频道明确 `SocialRoom` 与旧聊天持久化 API 的边界，真机验证不会重复刷屏。
- [X] 组队邀请、接受、离队事务继续走核心 API，但状态变化要稳定同步到地图和 `SocialRoom`。
- [ ] 宗门驻地、宗门成员 presence 完成 iOS Safari / Android Chrome / PC H5 页面验收。
- [X] 若要退役聊天 / 通知 SSE，先新增专门审计脚本，再按 `.bak/<日期>/` 归档。

### P2-B：H5 三端体验和离线细节

- [ ] 断网进入 `/game/*` 时离线页不贴边、不遮挡。
- [ ] 后续地图 / 战斗继续接 Phaser + Colyseus 时，不引入仅 iOS 或仅 Android 的前端分支主流程。
- [ ] iOS 锁屏 / 前后台恢复后，地图、战斗、聊天 presence 都能自动 repair，不显示假在线。
- [ ] PC 端继续保持纵屏游戏布局，不退化成横向后台面板。

### P3：压测、灰度和正式上线

- [ ] 第一批只开放新地图给测试账号。
- [ ] 第二批开放普通玩家进入新地图。
- [ ] 第三批开放新战斗。
- [ ] 第四批开放 Boss / PVP。
- [ ] 保留旧系统回滚入口一个版本周期，并记录窗口开始 / 结束时间。
- [ ] 稳定后关闭旧系统入口，并记录关闭时间、镜像 tag 和回滚方案。
- [ ] 正式上线前确认数据库已备份、密码已轮换、Redis 已持久化、WebSocket 代理验证通过。
- [ ] iOS Safari、iOS PWA、Android Chrome、PC 纵屏布局全部人工验收并留存日期。
- [ ] `/api/system/health`、`/game-server/health`、后台 `/admin/game-server` 线上可用。
- [ ] 日志无高频协议错误、DB 连接错误、Redis 错误。
- [ ] 稳定后再按热点决定是否引入 MessagePack 或 Colyseus Schema 优化高频包；这不是当前上线阻塞项。

### 每次继续执行的固定门禁

- [ ] 更新本根目录清单。
- [ ] 必要时更新 `docs/current/*` 当前专题文档。
- [ ] 必要时更新对应模块 `README.md`。
- [ ] `bun run stage-p1b:h5-mainline:check`
- [ ] `bun run stage9:realtime:check`
- [ ] `bun run stage-p2:social-sse:check`
- [ ] `bun run stage6:combat-command:check`
- [ ] `bun run stage6:combat-mainline:audit`
- [ ] `bun run legacy-plugin-gameplay:audit`
- [ ] `bun run game:smoke`
- [ ] `bun run lint`
- [ ] 涉及类型边界时运行 `bunx tsc --noEmit`
- [ ] 涉及页面 / 路由 / 构建时运行 `bun run build`
- [ ] 中文文档和中文文案做乱码巡检。

## 2026-07-09 大整合后未完成来源池

本节已被上面的“当前执行优先级：底层优先门禁”接管，不再作为执行顺序入口。原 P0 / P1 / P2 / P3 未完成项已经按依赖关系重排到顶部唯一 checkbox 队列；继续开工时不要从历史阶段名或功能名挑任务。

## 2026-07-08 清单审计结论

- [x] 已补齐阶段 5 详细清单中房间实例观测、后台分片展示、WebSocket upgrade、Redis 故障演练和压测脚本的漏勾。
- [x] 已修正阶段 6 详细清单中 `bun run game:smoke` 被 `DATABASE_URL` 阻塞的过期结论。
- [x] 阶段 9 旧地图 realtime 前置已完成：`/game/map` 默认移动主链切到 `WorldMapRoom`，H5 地图控制器不再连接旧 map SSE / WS，旧地图 SSE route、`server.mjs` 地图 WS 分支和 `realtime-server.mjs` 地图重复逻辑已归档到 `.bak/2026-07-08/realtime-runtime-map-legacy/`。
- [x] 阶段 9 旧 combat / Boss realtime 入口已完成退役：Boss H5 页不再连接旧 Boss SSE / WS，`BossRoom` 通过真实 Boss runtime 轮询广播 Colyseus `scene_snapshot / timeline_event / settlement`，旧 combat scene SSE / WS 与 Boss SSE / WS 已归档到 `.bak/2026-07-08/realtime-runtime-combat-boss-legacy/`。
- [x] 已把阶段 9 前置要求拆成可执行任务包：地图先完成 Colyseus 主链切换与旧 SSE / WS 引用归零；Boss / 战斗先完成 Colyseus command 主链、Boss 战报事件替代、正式幂等落账与灰度门禁。
- [x] 阶段 10 线上 Redis 多实例、灰度批次、数据库备份、密码轮换和正式上线检查仍必须在真实环境留存记录后再勾选；未完成项已收口到本文件顶部 P0 / P3。

## 2026-07-09 成品剩余任务收口

- [x] 新增成品剩余任务总表，2026-07-09 大整合后已吸收进本根目录清单，原过程文档归档到 `docs/current/.bak/2026-07-09/root-checklist-consolidation/`。
- [x] 明确阶段 9 本轮地图 / combat / Boss 旧 realtime 入口已经归档；聊天、附近频道、通知 SSE 单独规划，不混入本轮退役结论。
- [x] 补齐旧插件玩法“双修”的固定核心 H5 入口和固定核心 API：`/game/double-cultivation`、`/api/game/double-cultivation/*`。该修复不恢复插件系统，只把历史玩法迁入 `world` 核心模块。
- [x] 补齐旧双修插件 `dongfu.page.extend` 与 `player.profile.bottom.contents` 的核心化替代：洞府页固定“双修”入口、待处理红点、角色资料摘要和“双修状态”底部资料卡均改读 `world` 核心服务。
- [x] 迁移旧双修插件 `random-event.action.* / random-event.judge`：随机事件 `doubleCultivation` 动作、目标变量候选、玩家 / 妖兽目标选择、幂等妖兽账本落账、亲密度判定和后台核心判定配置已进入核心服务，不再调用插件 Hook。
- [x] 迁移旧双修插件 `map.nearby-player.actions`：地图“附近道友”资料弹窗已补固定“申请双修”按钮，直接调用 `/api/game/double-cultivation/request`，不恢复插件 Hook。
- [x] 新增历史插件玩法核心化审计：`bun run legacy-plugin-gameplay:audit` 报告双修、论道/PVP、功法、灵田、炼丹、炼器的迁移状态；`bun run legacy-plugin-gameplay:check` 作为成品前严格门禁。
- [x] 补完功法固定核心模块：`src/modules/character/services/gongfa-service.ts`、玩家 H5 页 `/game/gongfa`、玩家 API `/api/game/gongfa`、后台固定 API `/api/admin/gongfa`，旧 `plugin_gongfa_*` 表名暂作为核心账本兼容，不恢复插件 Hook。
- [x] 补完灵田固定核心模块：`src/modules/world/services/spiritual-field-service.ts`、玩家 H5 页 `/game/spiritual-field`、玩家 API `/api/game/spiritual-field`、后台固定 API `/api/admin/spiritual-field`，旧 `plugin_spiritual_field_*` 表名暂作为核心账本兼容，不恢复插件 Hook。
- [x] 补完炼丹固定核心模块：`src/modules/character/services/alchemy-service.ts`、玩家 H5 页 `/game/alchemy`、玩家 API `/api/game/alchemy`、后台固定 API `/api/admin/alchemy` 已接管配方、材料消耗、软保底和结果发放。
- [x] 补完炼器固定核心模块：`src/modules/character/services/smithing-service.ts`、玩家 H5 页 `/game/smithing`、玩家 API `/api/game/smithing`、后台固定 API `/api/admin/smithing` 已接管配方、材料消耗、软保底和装备产物发放。
- [x] 阶段 6 command 主链、正式幂等落账、战斗 H5 三端灰度验收仍是成品前 P1；未完成项已收口到本文件顶部 P1。
- [x] 阶段 6 已补 PVP `timeoutAdvance` Colyseus command 起点、H5 PVP 超时触发接入和房间 dispose 前 pending settlement flush 起点；PVP 技能、丹药、认输也已接入 Colyseus action 主链，剩余是断线裁定、正式 PVP 结果落账和发奖。
- [x] 阶段 6 已补 PVP `skill / item / surrender` Colyseus command 主链：`NEXT_PUBLIC_COMBAT_COLYSEUS_PVP_ACTION_MODE=legacy|main-with-http-fallback|main` 默认 `main`，`PvpRoom` 有真实 PVP runtime 且配置 `DATABASE_URL` 时复用 `performPvpCombatActionTransaction(...)`；旧 HTTP action 仅保留 legacy / fallback。
- [x] 阶段 6 已补普通 / 组队 / Boss `flee` Colyseus command 起点，生成 `abort` settlement intent 且不施加死亡惩罚；不代表旧 HTTP action 已完全停用。
- [x] 阶段 6 已新增主链切换审计：`bun run stage6:combat-mainline:audit` 报告旧 HTTP action / move / advance / Boss 调用点，`bun run stage6:combat-mainline:check` 作为最终严格门禁。
- [x] 阶段 6 已抽出普通战斗 action 主链前置服务：`combat-item-usage.ts` 负责丹药校验 / 库存扣减，`solo-combat-command-transaction.ts` 负责普通战斗 `executeTurn`、技能冷却、丹药恢复、逃跑和 scene snapshot 更新；后续 `CombatRoom command` 可复用该服务继续切主链。
- [x] 阶段 6 已接入 `CombatRoom` 普通战斗真实 command 起点：真实 pending combat session 存在时，`skill / item / flee` 会推进 `executeTurn`、刷新 runtime snapshot 并广播 `timeline_event`；H5 旧 HTTP 调用仍待按审计逐项切换。
- [x] 阶段 6 已接入普通战斗 H5 action 的 Colyseus command 主链开关：`NEXT_PUBLIC_COMBAT_COLYSEUS_ACTION_MODE=legacy|main-with-http-fallback|main`，默认 `main` 时普通单人技能、丹药、逃跑必须等待 Colyseus ACK；旧 HTTP action 仅作为 legacy / main-with-http-fallback 临时兜底。
- [x] 阶段 6 已接入组队战 H5 action 的 Colyseus command 主链开关：复用 `NEXT_PUBLIC_COMBAT_COLYSEUS_ACTION_MODE=legacy|main-with-http-fallback|main`，默认 `main` 时组队战技能、丹药、逃跑必须等待 Colyseus ACK；`CombatRoom` 有真实 party encounter runtime 时复用 `performPartyCombatActionTransaction(...)`，本地无 DB smoke 覆盖拒绝 ACK。
- [x] 阶段 6 已接入普通战斗 H5 movement 的 Colyseus movement 主链开关：`NEXT_PUBLIC_COMBAT_COLYSEUS_MOVEMENT_MODE=legacy|main-with-http-fallback|main`，默认 `main` 时普通单人移动必须等待 Colyseus ACK；`CombatRoom` movement 已复用真实 pending combat movement 事务并由 `bun run game:smoke` 覆盖 accepted sequence。
- [x] 阶段 6 已接入 PVP movement 的 Colyseus 主链：`PvpRoom` 不再让 PVP movement 落入房间内存 fallback，真实 PVP runtime 会保存双方视角 position override、重建 `sceneSnapshot`、提交 accepted sequence，并广播镜像后的对手视角；`bun run game:smoke` 已覆盖。
- [x] 阶段 6 已接入组队战 timeoutAdvance 的 Colyseus command 主链开关：`NEXT_PUBLIC_COMBAT_COLYSEUS_PARTY_ADVANCE_MODE=legacy|main-with-http-fallback|main`，默认 `main` 时组队回合超时必须等待 Colyseus ACK；`CombatRoom` party `timeoutAdvance` 已复用真实 `advancePartyCombatTimeout` 事务，本地无 DB smoke 覆盖拒绝 ACK。
- [x] 阶段 6 已接入 Boss H5 action / advance 的 Colyseus 主链：`BossRoom` action / advance 不再依赖 `GAME_WEB_INTERNAL_URL` 内部 HTTP 网络 bridge，也不再动态 import API route；当前导入 `boss-command-route-service.ts` 执行核心 Boss 事务，只有真实事务成功才返回 accepted ACK；Boss 技能表加载、技能冷却 tick、实例生命周期、血量 / damageMap、Boss / 参与者 CombatUnit 构造、下一招预告、反击选招、反击伤害、反击后玩家扣血 / 死亡、奖励 claim、击败奖励、奖励 replay 补偿、秘境结算入口和响应包装已进入核心 service；Boss 房间 runtime 状态、参与者、turnState、离场 / 认输事务已抽入 `boss-room-runtime-service.ts`。
- [x] 阶段 10 线上 Redis 多实例、灰度批次、数据库备份、密码轮换、镜像 tag 和正式上线记录仍是成品前 P0 / P3；未完成项已收口到本文件顶部 P0 / P3。

## 阶段 0：冻结与文档整理

- [x] 新建权威计划文档。
- [x] 更新 README / docs 导航。
- [x] 标记插件系统 legacy。
- [x] `docs/plugin/*` 归档到 `docs/.bak/2026-07-07/plugin/`。
- [x] 归档过期地图 realtime 日期热修文档到 `docs/.bak/2026-07-08/realtime-legacy-hotfixes/`。
- [x] 归档过期战斗 realtime 日期热修文档到 `docs/.bak/2026-07-08/realtime-legacy-hotfixes/`。
- [x] 归档旧双修插件宿主 / Hook / runtime 日期文档到 `docs/.bak/2026-07-08/plugin-legacy-double-cultivation/`。
- [x] 收紧 `docs/current/README.md` 和 `docs/README.md`，不再把旧 shared watcher、旧 SSE / WS 热修、旧插件宿主文档列为推荐阅读。
- [x] 线上密码轮换、版本、备份点和镜像 tag 记录已作为 P0 安全门禁收口到本文件顶部，不在阶段 0 重复维护。

## 阶段 1：取消插件体系设计

- [x] 插件上传停用。
- [x] 插件安装停用。
- [x] 插件启用 / 禁用停用。
- [x] 插件卸载停用。
- [x] 插件运行时不再加载。
- [x] 插件页面宿主停用。
- [x] 插件静态资源代理停用。
- [x] 插件后台实体扩展停用。
- [x] 移除插件构建脚本作为日常上线前置项。
- [x] 将双修正式账本迁入 `world` 固定核心模块，并补齐固定核心页面 `/game/double-cultivation`、洞府页固定入口、角色资料底部“双修状态”资料卡与固定核心 API `/api/game/double-cultivation/*`。
- [x] 将功法、灵田、论道、炼丹、炼器的核心数据驱动归属写入权威 MD；实际补完任务进入后续阶段。
- [x] 后台配置改为固定后台页面 / 固定配置项，不再通过插件注册菜单或系统配置项。

## 阶段 2：插件代码退役

- [x] 玩家侧插件 API 第一轮废弃。
- [x] 后台插件 API 第一轮废弃。
- [x] 后台插件管理菜单入口移除。
- [x] 插件扩展 Hook 运行时断开。
- [x] 插件历史数据先保留，不直接 drop。
- [x] 盘点所有插件相关表。
- [x] 写历史玩法数据迁移脚本：`scripts/migrate-plugin-legacy-data.ts`。
- [x] 将仍被核心玩法依赖的函数迁出 `src/modules/plugin`，改走 `src/modules/shared/services/legacy-plugin-compat.ts`。
- [x] 双修正式账本服务迁出 `src/modules/plugin`，进入 `src/modules/world/services/double-cultivation-ledger.ts`。
- [x] 双修玩家侧页面与公共 API 迁出插件宿主，进入 `src/modules/world/ui/pages/game/double-cultivation`、`src/modules/world/api/game/double-cultivation/*`；洞府页入口和角色资料底部卡片也已改为固定核心读取。
- [x] 第二轮确认无人依赖后把旧插件路由移入 `.bak/2026-07-07/`。
- [x] 最后一轮清理插件路由索引、文档入口和 `plugin:legacy:build`。

## 阶段 3：新多人在线底座搭建

- [x] 建立 Bun workspace 骨架。
- [x] 新增 `apps/game-server`。
- [x] 新增 `packages/shared-protocol`。
- [x] 新增 `packages/game-rules`。
- [x] 新增 `packages/db` 起点。
- [x] 新增 `bun run game:dev`。
- [x] 新增 `bun run game:start`。
- [x] 新增 `bun run game:smoke`。
- [x] 注册 `WorldMapRoom`。
- [x] 注册 `SecretRealmRoom`。
- [x] 注册 `CombatRoom`。
- [x] 注册 `BossRoom`。
- [x] 注册 `PvpRoom`。
- [x] 注册 `SocialRoom`。
- [x] 增加 Redis Presence / Redis Driver 配置入口。
- [x] 增加 game-server Dockerfile 与 Redis compose 参考。
- [x] GitHub Actions 同时构建并推送 Web 镜像与独立 game-server 镜像，避免 1Panel 长期依赖服务器本地临时镜像。
- [x] 修复非法 `move` 坐标会污染房间权威状态的问题。
- [x] `bun run game:smoke` 覆盖非法移动输入回归检测。
- [x] 接入现有 session cookie 鉴权起点。
- [x] 增加 `GAME_SERVER_AUTH_MODE`。
- [x] 增加 join options 规范化。
- [x] 修复 Colyseus `/matchmake` 未挂载导致官方 SDK join 404 的问题。
- [x] 修复 Bun 安装树中 Colyseus core 双实例导致 SDK join `seat reservation expired` 的问题。
- [x] `bun run game:smoke` 覆盖官方 `@colyseus/sdk` 本地 join `WorldMapRoom` + repair ACK + `sector_snapshot`。
- [x] 用真实浏览器 SDK join 验证 cookie 鉴权链路。阶段 5 H5 三端真实验收已由用户确认通过。
- [x] 新增 Redis 多实例共享房间查询验证命令：`bun run game:smoke:redis-multi`，会拉起两个 game-server 子进程并通过同一 `REDIS_URL` 验证 RedisDriver 查询与跨实例 `joinById`。
- [x] 线上真实 `REDIS_URL` 多实例 smoke 留存已作为 P0 安全与真实环境门禁收口到本文件顶部。
- [x] 做 1Panel WebSocket upgrade 验证。2026-07-08 已验证 `https://mrsj.ren:3201/game-server/health` 正常，`https://mrsj.ren:3201/colyseus` WebSocket Upgrade 返回 `101 Switching Protocols`。
- [x] 做 Redis 断开故障演练。`bun run game:smoke:redis-failure` 已验证 Redis 不可达时返回明确 `game_server_redis_unavailable`，game-server 启动前会执行 Redis PING 预检。

## H5 客户端三端互通检查

- [x] 确认客户端主形态是 Web H5，Capacitor 只是可选包装层。
- [x] 根布局补齐 iOS PWA / Apple Web App 元信息。
- [x] Manifest 标记纵屏优先。
- [x] 离线页补齐 iOS safe-area 与 `viewport-fit=cover`。
- [x] 客户端高度变量优先使用 `visualViewport`。
- [x] 检查玩法页没有直接裸连 `WebSocket` / `EventSource`。
- [x] iPhone Safari 人工打开 `/game/map` 验证。
- [x] iPhone 添加到主屏幕后人工验证。
- [x] Android Chrome 人工验证。
- [x] PC 浏览器人工验证纵向游戏布局。

## 阶段 4：共享协议重建

- [x] 建立共享协议包。
- [x] 定义房间名与协议版本。
- [x] 定义第一版实时输入 envelope。
- [x] 定义第一版实时输出 envelope。
- [x] 定义第一版实时输入 ACK。
- [x] 定义非法移动输入的拒绝回包规则。
- [x] 定义地图实时输入类型。
- [x] 定义战斗实时输入类型。
- [x] 定义社交实时输入类型。
- [x] 增加共享输入校验器 `validateRealtimeClientInput(...)`。
- [x] 增加共享 ACK helper `createRealtimeInputAck(...)`。
- [x] 建立前端 Colyseus client 封装入口。
- [x] 将失败请求 accepted/拒绝回包规则扩展到所有房间输入元数据。
- [x] 将旧地图 move/action 请求统一迁入共享协议。旧 `/api/game/map/move`、事件 resolve/choice、travel 先经 `packages/shared-protocol` legacy adapter 归一化为 `move / interact / travel` envelope。
- [x] 将旧战斗 action/move/advance 请求统一迁入共享协议。旧 combat action/move/advance 先经 `packages/shared-protocol` legacy adapter 归一化为 `command / useItem / surrender / movement` envelope。
- [x] 安装 `@colyseus/sdk` 并补真实浏览器 adapter。
- [x] 提供 `@colyseus/sdk` Client 构造器适配入口。
- [x] 禁止新玩法页直接裸连 WebSocket。ESLint 已对 `src/app/game/**/*` 与 `src/modules/**/ui/**/*` 禁止 `new WebSocket` / `new EventSource`，必须走 shared 封装。
- [x] 地图 AOI 输出类型集中到 `packages/shared-protocol`。
- [x] 定义 repair 统一触发与回包规则。`RealtimeRepairPayload` 统一 `manual / delta_gap / reconnect / weak_network_timeout / foreground_restore / visibility_restore / initial_join / server_request` 触发原因，回包继续走 `RealtimeInputAck + scene/sector snapshot`。

## 阶段 5：地图系统重构

阶段 5 未完成项已收口到本文件顶部“P1：阶段 5 地图线上灰度和地图深化”。旧阶段 5 详单已归档，只作为历史追溯。

- [x] 明确当前迁移边界：`/game/map` 默认移动、点击移动和虚拟摇杆已切到 Colyseus `WorldMapRoom move`，原地机缘交互走 `WorldMapRoom interact`，旧 `/api/game/map/move` 不再作为 H5 默认主链。
- [x] 补齐 `move` 统一输入 envelope、ACK、拒绝回包和服务端权威坐标回包。
- [x] `WorldMapRoom` 读取真实地图结构。
- [x] `WorldMapRoom` 读取玩家真实位置。
- [x] 实现地图 sector AOI。
- [x] AOI 半径和 sector 尺寸进入 `packages/shared-protocol` 共享常量。
- [x] 实现玩家移动权威校验。
- [x] 实现基础阻挡、NPC / 怪物占位碰撞、边界检查；玩家之间暂不阻挡，临时阻挡和活动区域封锁后续接入。
- [x] 地图宽高和阻挡格进入 `move` 判定。
- [x] 实现玩家实体同步。
- [x] 实现普通地图 NPC / 怪物实体进入 `WorldMapRoom` 与 AOI。
- [x] 实现开放世界 NPC 实体进入 `WorldMapRoom` 与 AOI。
- [x] 实现 active 机缘实体进入 `WorldMapRoom` 与 AOI。
- [x] 实现地图传送点 / 开放世界传送点实体进入 `WorldMapRoom` 与 AOI。
- [x] 实现全局秘境入口实体进入 `WorldMapRoom` 与 AOI。
- [x] 实现个人可见秘境入口 / 更复杂临时事件实体同步。当前个人可见秘境入口已作为 client 私有 AOI 实体进入 `WorldMapRoom`，不会广播给同房间其他玩家；更复杂临时事件仍待后续接入。
- [x] 实现 NPC / 怪物动态刷新、移动、死亡、复活的 AOI delta。当前 `WorldMapRoom` 已低频重读地图实体数据源，并通过既有 `entity_enter / entity_leave / entity_update` 输出 NPC、怪物、机缘、秘境等动态变化。
- [x] 实现进入 / 离开 AOI 的实体增量。
- [x] 补齐 `sector_snapshot / sector_delta` 的版本字段、同 AOI `entity_update` 和客户端 delta 断层自动 repair。
- [x] 实现地图断线重连。当前已补 `WorldMapRoom` 10 秒 reconnect grace、重连后 `sector_snapshot`、成功率指标和 `game:load:reconnect` SDK 压测；H5 三端真实前后台恢复验收已由用户确认通过。
- [x] 实现 `WorldMapRoom` 服务端 repair：ACK + 当前 AOI `sector_snapshot`。
- [x] `/game/map` 客户端接入 Colyseus AOI / repair 只读消费 hook。
- [x] 官方 `@colyseus/sdk` 本地 join `WorldMapRoom` 并完成 repair smoke。
- [x] 将 Colyseus AOI 数据接入 `/game/map` 真实渲染：当前先通过 H5 Canvas 过渡层融合 `sector_snapshot / sector_delta`，不替换旧移动主链。
- [x] 接入 `/game/map` 旧移动成功后的 Colyseus `move` 影子同步，先让 `WorldMapRoom` 跟随旧 API 权威坐标，不提前切主链。
- [x] 实现 `WorldMapRoom` 服务端 `interact / travel` ACK 骨架，避免静默丢包或假成功。
- [x] 将 `interact / travel` 从 ACK 骨架迁到真实事务，并覆盖距离、目标、权限、幂等落账。当前 Colyseus `interact` 支持机缘 claim 事务，`travel` 支持普通地图切图事务；秘境进入、复杂随机事件奖励仍留旧 API。
- [x] 实现地图事件落账。新增 `map_realtime_event_logs` schema 与 `0070_map_realtime_event_logs.sql`，game-server 以 `roomId + playerId + actionId` 做幂等 key 并 best-effort 写日志。
- [x] 新增 Phaser 地图场景灰度壳，不直接替换旧地图。通过 `NEXT_PUBLIC_WORLD_MAP_PHASER_SCENE=1` 启用。
- [x] Phaser 场景支持点击移动 / 虚拟摇杆、插值、纠偏、弱网 repair。
- [x] H5 客户端完成 iOS Safari / Android Chrome / PC 三端人工验收。验收结果由用户确认通过。
- [x] `/game/map` 主场景接入 Phaser + Colyseus。当前为灰度壳接入，复用 Colyseus AOI 融合后的 scene snapshot；默认仍保留旧 H5 MapGrid。
- [x] 增加旧 API 主链 / Colyseus 影子模式 / Colyseus 主链灰度功能开关：`NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=off|shadow|main`，当前默认 `main`，旧移动 fallback 已从 H5 地图页移除。
- [x] 旧 `/api/game/map/move` 从 H5 默认移动链路移除；玩家坐标改由 `WorldMapRoom` 在 ACK 前写入 Postgres，落账失败返回 `persist_failed` 并回滚房间坐标。
- [x] 迁移期间记录旧 API 与 Colyseus 坐标差异。当前地图页在旧 API 权威坐标影子同步后比对 Colyseus self entity，发现漂移会输出 console warn 并触发 `server_request` repair。
- [x] 增加地图房间在线人数、tick 耗时、消息量、repair 次数、重连成功率、移动拒绝原因统计。当前 `/health` 已输出进程级 runtime metrics 和每房间实例 registry：在线连接、峰值在线、tick 平均/最大耗时、join/leave、输入消息、repair、move accepted/rejected、拒绝原因、snapshot/delta、重连尝试/成功/失败/成功率、每房间人数、每房间 tick 和每房间消息量。

## 阶段 6：战斗系统重构

阶段 6 未完成项已收口到本文件顶部“P1：阶段 6 战斗成品化”。旧阶段 6 详单已归档，只作为历史追溯。

注意：本阶段已完成 Colyseus 房间、协议 ACK、纯规则、settlement intent、Phaser 灰度壳和旧 combat / Boss realtime 入口退役。技能、丹药、移动、advance 等正式动作仍保留旧 Next HTTP API 落账兼容。2026-07-09 已确认旧 HTTP action 仍承担技能冷却、`executeTurn / performPvpCombatAction`、丹药库存扣减、PVP runtime 同步、Boss claim / 伤害 / 奖励落账等事务语义；迁入 Colyseus command 时必须先等价迁移这些能力，不能只替换 H5 fetch。

- [x] 抽出 `BattleRuleset` 到 `packages/game-rules`。
- [x] 抽出基础伤害计算。
- [x] 将旧可配置伤害公式 parser / calculator 下沉到 `packages/game-rules`，旧 Next 服务只保留配置读取与缓存。
- [x] 将旧 `battle-ruleset.ts` 收敛为 `packages/game-rules` runtime ruleset 适配器。
- [x] 抽出基础冷却规则字段。
- [x] 抽出距离与命中规则。
- [x] 抽出掉落与奖励意图。当前已在 `packages/game-rules` 增加 `createBattleRewardIntent(...) / createBattleDropIntent(...)`。
- [x] 抽出死亡惩罚 intent。
- [x] 抽出 PVP 超时推进规则。
- [x] `CombatRoom` 支持普通战斗 ACK 骨架，并读取 pending combat session 真实 runtime。
- [x] `CombatRoom` 支持组队战。当前携带 `partyId` 时切换 `party` ruleset，优先读取真实 party encounter runtime；无 runtime 时才回退到占位组队目标。
- [x] `BossRoom` 支持多人 Boss 场景同步，并读取真实 Boss 实例 / 参与者 / damageMap / 当前玩家 reward claim 状态；action / advance command 已移除 `GAME_WEB_INTERNAL_URL` 内部 HTTP 网络 bridge，改为核心 `boss-command-route-service.ts` 调用真实 Boss 事务；未配置 `DATABASE_URL` 时明确拒绝，不返回假成功。
- [x] `PvpRoom` 支持实时 PVP ACK 骨架，并读取真实 PVP runtime / battleView / settlement / 匹配上下文 / 超时推进状态。
- [x] `CombatRoom` 读取真实普通战斗数据，并覆盖玩家、敌人、技能、战斗可用消耗品、血量、状态、冷却。物品 command 主链仍待迁入 Colyseus。
- [x] `CombatRoom` 读取真实组队战 runtime、怪物血量、技能和参与记录。
- [x] `BossRoom` 读取真实 Boss 房间、Boss 血量、参与者、伤害记录和 claim 状态。
- [x] `PvpRoom` 读取真实 PVP runtime、双方状态、匹配上下文和超时推进状态；排名上下文仍待接入正式 PVP 排名服务。
- [x] 普通战斗 action 事务前置服务已抽出，避免 H5 fetch 直接切 Colyseus 时丢失旧 HTTP 的技能冷却、丹药扣减和 scene snapshot 更新语义。
- [x] `CombatRoom` 普通战斗 `skill / item / flee` command 已接入真实 pending combat transaction；无真实 pending combat session 时仍保留 ACK / intent 骨架。
- [x] 普通战斗和组队战 H5 技能、丹药、逃跑已固定切到 Colyseus command 主链并复用 authoritative sync；旧 HTTP action fallback 已移除。
- [x] 普通战斗 H5 单人移动已固定切到 Colyseus movement 主链并复用 authoritative sync；旧 HTTP move fallback 已移除。
- [x] 组队战 H5 超时推进已固定切到 Colyseus `timeoutAdvance` 主链并复用 authoritative sync；旧 HTTP advance fallback 已移除。
- [x] PVP H5 技能、丹药、认输已固定切到 Colyseus command 主链并复用 authoritative sync；PVP movement 已进入 Colyseus runtime 主链；旧 HTTP action fallback 已移除；断线裁定和正式结果幂等落账已接入 `settlePvpCombatDisconnect(...)` 与 `pvp-result:<combatId>` side-effect claim。
- [x] Boss command 事务 service 已进入核心层：`boss-combat-command-transaction.ts` 承接 Boss POST 请求归一化、command 类型映射、技能快照归一化、Boss 技能表加载、Boss 技能冷却 tick、Boss 实例生命周期、Boss 血量 / damageMap 提交事务、Boss / 参与者 CombatUnit 构造、下一招预告、反击选招、反击伤害计算、反击后玩家扣血 / 死亡落账、奖励 claim 幂等读写工具、奖励分配主体、秘境安慰奖励合并、Boss 击败奖励 + 秘境结算入口和 Boss 击杀副作用幂等触发；`boss-command-route-service.ts` 承接原 Boss route 的奖励 replay 补偿、claim 语义和响应包装，API route 只保留薄导出。
- [x] 普通战斗、组队战、Boss、PVP H5 页面默认消费 Colyseus `scene_snapshot / timeline_event / settlement`。当前 `timeline_event / settlement` 已作为独立 Colyseus 消息进入 H5 hook，Boss 战报提示已切到 `BossRoom`，旧 Boss 事件流已归档；Boss action / advance 已通过核心 service 复用真实事务，内部 HTTP 网络 bridge 和 API route 动态 import 均已移除。
- [x] `useCombatSceneController` 不再连接旧 combat scene SSE / WS。
- [x] `usePvpBattleSceneController` 不再连接旧 combat scene SSE。
- [x] 房间只生成 settlement intent，不直接落账。
- [x] settlement intent 生成稳定 idempotency key。
- [x] `CombatRoom / BossRoom / PvpRoom` 支持异常断线 reconnect grace，重连成功后下发 repair `scene_snapshot`。
- [x] Postgres 事务负责正式落账。当前 `combat_reward_claims / combat_side_effect_claims` 已覆盖奖励发放、掉落发放、任务推进、死亡惩罚和 PVP 正式结果；Boss / 普通 / 组队兼容结算均按 claim replay，不重复发奖或推进任务。
- [x] 战斗场景接入 Phaser + Colyseus。当前通过 `NEXT_PUBLIC_COMBAT_PHASER_SCENE=1` 启用灰度壳，默认仍保留旧 Canvas 舞台。

## 阶段 7：开放世界、社交、宗门接入

- [x] 世界 NPC 进入 `WorldMapRoom` 实体系统。
- [x] NPC 移动、出现、消失通过 AOI 同步。当前 `WorldMapRoom` 每 5 秒重读地图实体数据源，新增 / 移除 / 同 AOI 位置变化都会通过 `entity_enter / entity_leave / entity_update` 下发；刷新位置变化会带 `velocityX / velocityY` 供 H5 插值。
- [x] 名声事件能在地图显示可交互入口。当前 `player_world_incidents` 会作为玩家私有 `reputation_event` AOI 实体进入 `WorldMapRoom`，优先读取 payload 坐标，缺省时按事件 key 在地图内稳定落点。
- [x] 世界委托能指向地图坐标。当前 active `world_storylines` 会作为公共 `world_commission` 实体进入开放世界地图，pending `player_world_event_offers` 会作为玩家私有 `world_commission` 实体进入对应地图或来源 NPC 所在地图。
- [x] 附近频道接入地图房间或 `SocialRoom`。当前 H5 聊天页已通过 shared Colyseus client 接入 `SocialRoom`，旧 `/api/game/chat/nearby` 仍负责持久化，发送成功后广播 `nearbyMessage`，收到 `social_event` 后刷新旧持久化列表。
- [x] 组队 presence 接入房间。当前 `SocialRoom` 已按 `partyId` 输出 `partyMembers`，组队邀请/接受/离队事务仍走旧核心 API。
- [x] 组队邀请、接受、离队与地图状态同步。当前地图页旧核心 API 成功后会刷新 `/api/game/social/party` 快照，并在可见性恢复 / 定时轮询时继续同步；`SocialRoom` 不伪造组队写库。
- [x] 宗门驻地作为特殊地图房间。当前宗门 `externalMapId/externalPosition` 会生成普通地图 `sect_home` 入口实体，`homeMapId` 对应地图进入 `WorldMapRoom` 时会生成宗门驻地实体；宗门治理仍走低频 API。
- [x] 宗门成员 presence 可见。当前宗门页已消费 `SocialRoom` 的 `sectMembers`，成员列表展示在线 / 离线，宗门仓库、建筑、治理仍不进入实时房间主循环。

## 阶段 8：后台与运维重构

- [x] 后台展示 game-server 在线状态。
- [x] 后台展示房间列表。当前同时展示注册房间类型和活跃房间实例。
- [x] 后台展示每房间人数。当前 `game-server` room registry 输出 `clientCount / peakClientCount`，后台活跃房间实例表展示当前 / 峰值人数。
- [x] 后台展示每房间 tick 耗时。当前每房间输出 `tickAvgMs / tickMaxMs`。
- [x] 后台展示每房间消息量。当前每房间输出 `inputMessages`，并保留 repair / move / interact / travel / sector snapshot / sector delta 细分计数。
- [x] 后台展示地图分片状态。当前地图分片状态表按 `world_map / secret_realm` 展示 `mapId + shardId`、人数、tick 和消息量。
- [x] 后台展示 Boss / PVP 房间状态。当前 Boss / PVP 房间状态表展示房间、战斗标识、人数、tick、消息量和运行状态。
- [x] 后台展示 repair 次数。
- [x] 后台展示断线重连成功率。当前展示 `reconnectLeaves / reconnectSuccesses` 基础累计值，百分比和按房间维度仍待补。
- [x] 后台展示 Redis 状态。当前 `/game-server/health` 返回 `redis.enabled / status / latencyMs / checkedAt / error`，后台展示 Redis 正常 / 异常 / 未启用、PING 延迟和错误原因。
- [x] 后台展示 WebSocket transport 基础统计。当前展示 upgrade 请求、成功连接、连接失败、客户端 socket error、心跳超时终止；反代层 fallback 细分仍待后续接入。
- [x] 健康检查拆分 `/api/system/health` 与 `/game-server/health`，并新增 `/api/admin/game-server/health` 后台代理。

## 阶段 9：旧系统退役

- [x] 建立阶段 9 旧 realtime active legacy 盘点，2026-07-09 大整合后已吸收进本根目录清单，原过程文档归档。
- [x] 建立阶段 9 前置收口清单，2026-07-09 大整合后已吸收进本根目录清单，原过程文档归档。
- [x] 已完成阶段 9 realtime active legacy 审计纠偏：旧地图 WS/SSE、旧 combat scene SSE/WS、旧 Boss SSE/WS 均已从 H5 客户端断开并归档；旧聊天与通知 SSE 不属于本轮地图/战斗/Boss realtime 主链退役范围，后续单独规划。
- [x] 归档 `src/modules/plugin` 到 `src/modules/.bak/2026-07-08/plugin`。
- [x] 移除插件 API 路由。旧路由已在阶段 2 移入 `.bak/2026-07-07/`，本阶段归档剩余模块源码。
- [x] 移除插件 UI。旧页面与组件已在阶段 2 移入 `.bak/2026-07-07/`，本阶段归档剩余模块源码。
- [x] 移除 `plugin:legacy:build` 与插件构建脚本。命令已从 `package.json` 删除，脚本已归档。
- [x] 移除插件文档入口。`docs/plugin/*` 已归档，当前只保留核心玩法扩展规则文档。
- [x] 迁移或归档插件数据表。当前保留历史表只读兼容，迁移盘点脚本为 `scripts/migrate-plugin-legacy-data.ts`。
- [x] 新增阶段 9 旧 realtime 显式退役门禁：`LEGACY_REALTIME_DISABLED`、`WORLD_MAP_LEGACY_REALTIME_DISABLED`、`COMBAT_LEGACY_SCENE_REALTIME_DISABLED`、`NEXT_PUBLIC_PVP_LEGACY_REPLAY_DISABLED`。默认不开，用于主链切换后的灰度验证。
- [x] 补充阶段 9 前置执行要求：旧地图 realtime、旧 Boss / combat realtime 的退役前置已整合进本根目录清单。
- [x] 新增阶段 9 旧 realtime 前置审计脚本：`bun run stage9:realtime:audit` 默认输出阻塞引用但不失败；`bun run stage9:realtime:check` 用于严格门禁并在仍有 active legacy 引用时返回非零。
- [x] 移除地图 SSE 主链。旧 route 已移动到 `.bak/2026-07-08/realtime-runtime-map-legacy/`。
- [x] 移除旧地图 WS 主链。`useMapSceneController` 不再连接 `/ws/game/map/scene`，`server.mjs` / `realtime-server.mjs` 已移除地图 WS upgrade。
- [x] 移除 shared watcher 主同步逻辑。旧 `attachMapSceneSocket` 大段 watcher 逻辑已移动到 `.bak/2026-07-08/realtime-runtime-map-legacy/`。
- [x] 移除 `server.mjs` 地图 websocket 分支。
- [x] 移除 `realtime-server.mjs` 重复地图逻辑。
- [x] 移除旧 combat scene SSE。旧 route 已移动到 `.bak/2026-07-08/realtime-runtime-combat-boss-legacy/`，`server.mjs` 的 `/ws/game/combat/scene` 分支已移除。
- [x] 移除旧 Boss SSE / WS。旧 route 已移动到 `.bak/2026-07-08/realtime-runtime-combat-boss-legacy/`，`server.mjs` / `realtime-server.mjs` 的 Boss socket proxy 已移除。
- [x] 移除旧 PVP replay 主流程。`pvp-replay-storage.ts`、`PvpReplayOverlay.tsx`、`pvp-replay-overlay.css` 已移动到 `src/modules/.bak/2026-07-08/combat/pvp-replay/`，地图页和 PVP 页不再引入旧 replay CSS。
- [x] `bun run stage9:realtime:audit` 已 PASS：未发现旧地图 / combat / Boss realtime active legacy 引用。旧入口已按 `.bak/<日期>/` 规则归档。

## 阶段 10：压测、灰度与正式上线

- [x] 新建阶段 10 压测灰度清单，2026-07-09 大整合后已吸收进本根目录清单，原过程文档归档。
- [x] 新增基础连接压测脚本：`bun run game:load:basic`。
- [x] 基础压测脚本覆盖 SDK join、repair ACK、`sector_snapshot` 和 health 汇总。
- [x] 新增地图移动压测脚本：`bun run game:load:map-move`。
- [x] 新增弱网 repair 压测脚本：`bun run game:load:repair`。
- [x] 新增断线重连压测脚本：`bun run game:load:reconnect`。
- [x] 新增普通战斗 command 压测脚本：`bun run game:load:combat-command`。
- [x] 新增 Boss command 压测脚本：`bun run game:load:boss-command`。注意：未配置 `DATABASE_URL` 时 `BossRoom` action / advance command 必须返回明确拒绝；配置真实数据库后以核心 service 执行真实 Boss 事务 accepted 作为压测成功指标。
- [x] 新增 PVP command 压测脚本：`bun run game:load:pvp-command`。当前压的是 `PvpRoom` 双人 command ACK 骨架，不代表旧 PVP replay、匹配、排名或结算主流程已迁移。
- [x] 新增 settlement intent 幂等压测脚本：`bun run game:load:settlement-intent`。当前验证重复 surrender 的 `settlementIntent.idempotencyKey` 稳定，不代表 Postgres 正式落账幂等已完成。
- [x] 新增阶段 10 本地基线总入口：`bun run game:load:stage10-local`，串行执行 100 同图、Boss 20 人、PVP 8 房间，并隔离本地端口。
- [x] 新增多地图 / 多分片持续在线压测脚本：`bun run game:load:map-shards`。
- [x] 新增阶段 10 本地 scale 总入口：`bun run game:load:stage10-scale-local`，串行执行 300 多图、500 多房间、1000 连接，并隔离本地端口。
- [x] 修复 Colyseus 房间匹配规则：`world_map` 按 `mapId + shardId` 分片，`combat / boss / pvp` 按战斗上下文过滤，避免 `joinOrCreate` 把不同地图分片塞进同一个房间。
- [x] `/game-server/health` 增加 `roomInstancesTotal / roomInstancesTruncated`，默认只返回前 25 个房间实例，避免高房间数压测时 health JSON 被截断。
- [x] 100 在线同图压测。2026-07-08 本地单进程 SDK 基线：100/100 join + repair 成功，0 失败，P95 total 170ms，未启用 Redis，不代表多实例结论。
- [x] 300 在线多图压测。2026-07-08 本地单进程 SDK 基线：300/300 join + repair 成功，6 个 `WorldMapRoom`，0 失败，P95 total 135ms，未启用 Redis，不代表多实例结论。
- [x] 500 在线多房间压测。2026-07-08 本地单进程 SDK 基线：500/500 join + repair 成功，25 个 `WorldMapRoom`，0 失败，P95 total 244ms，未启用 Redis，不代表多实例结论。
- [x] 1000 连接基础压测。2026-07-08 本地单进程 SDK 基线：1000/1000 join + repair 成功，100 个 `WorldMapRoom`，0 失败，health 在线读取正常，未启用 Redis，不代表多实例结论。
- [x] Boss 房间 20-50 人压测。2026-07-08 本地单进程 SDK 旧基线曾验证 BossRoom command ACK 骨架；2026-07-09 后未配置 `DATABASE_URL` 时压测应验证“join + 场景同步 + 明确拒绝 ACK”，配置真实数据库后再验证核心 service 的真实伤害 / 奖励事务。
- [x] PVP 多房间并发压测。2026-07-08 本地单进程 SDK 基线：8 个 PvpRoom、16/16 玩家加入、16/16 command accepted，0 拒绝；2026-07-09 已补 PVP 断线裁定和正式 Postgres 结果落账幂等闸门，仍不代表匹配或排名服务完成。
- [x] 普通战斗 command SDK 小样本压测。
- [x] Boss command SDK 小样本压测历史记录：`GAME_LOAD_BOSS_ROOMS=1 GAME_LOAD_BOSS_PLAYERS=20 GAME_LOAD_BOSS_COMMANDS_PER_PLAYER=2` 曾覆盖 ACK 骨架；当前应更新脚本预期为 action / advance 拒绝假成功。
- [x] PVP command SDK 小样本压测：`GAME_LOAD_PVP_ROOMS=2 GAME_LOAD_CONCURRENCY=1 GAME_LOAD_PVP_COMMANDS_PER_PLAYER=3`，12/12 command accepted。
- [x] settlement intent SDK 小样本压测：`GAME_LOAD_SETTLEMENT_ROOM=pvp GAME_LOAD_SETTLEMENT_ROOMS=2 GAME_LOAD_SETTLEMENT_REPEATS=4`，8/8 surrender accepted，`unstableKeyRooms=0`。
- [x] 断线重连 SDK 小样本压测。
- [x] 弱网 repair SDK 小样本压测。
- [x] 阶段 10 剩余灰度批次、回滚窗口、正式上线检查和线上 Redis 多实例 smoke 已收口到本文件顶部 P0 / P3，不在阶段 10 旧段落重复维护。

## 每阶段交付固定门禁

- [x] 每阶段交付固定门禁已收口到本文件顶部“每次继续执行的固定门禁”，后续只维护顶部门禁列表。
