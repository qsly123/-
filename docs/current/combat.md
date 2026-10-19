# 统一战斗系统

## 当前目标

战斗系统已经进入统一收口阶段，方向是：

- 一套服务端权威战斗内核
- 多个模式规则集
- 一套实时场景协议
- 一套页面壳和视图模型
- 旧接口暂时兼容

## 当前模式

- `solo`
  - 单人普通战斗，当前为站桩回合制互攻
- `party`
  - 组队协作战斗
- `boss`
  - Boss 战与多人 Boss 参与链路
- `pvp`
  - PVP 实时论道运行时、统一 scene 协议与结算

## 统一内核组件

- `BattleRuntime`
  - 统一战斗运行时视图
- `BattleRuleset`
  - 不同模式的规则定义
- `BattleCommand`
  - 统一动作抽象
- `BattleCommandResult`
  - 统一动作返回
- `BattleViewState`
  - 统一前端消费视图
- `BattleSceneHub`
  - 统一实时房间入口

## 生命周期

- `preparing`
- `active`
- `settling`
- `finished`
- `closed`

## 当前收口结果

- 普通战斗、Boss、PVP 已经开始共享 `BattleViewState`
- 普通战斗、组队战、PVP 动作路由已接入统一 `BattleCommandResult`
- `solo / party / pvp` 已共用 `battle-command-executor.ts` 动作执行骨架
- `solo / party / boss / pvp` 已开始共用 `battle-spatial-runtime.ts` 的空间快照构造入口
- H5 场景状态已默认通过 Colyseus `scene_snapshot / timeline_event / settlement` 消费
- 页面层已开始向统一 `UnifiedBattleShell` 页面壳收口
- PVP 已从“创建即整场模拟”切到“创建 runtime + Colyseus scene/action”
- 旧 combat scene SSE / WS 已归档，不再作为当前 H5 场景状态主链
- Boss 已新增共享 `battleView / battleRuntime` 构造器，并开始按统一 `BattleRealtimeEnvelope` 输出实时 payload
- `BattleRuleset` 已补齐 `spatialPolicy / collisionPolicy / timeoutPolicy` 元数据，给 Boss/PVP/遭遇战的位置实时深化打底
- 普通 solo 战斗 H5 页面已重写为移动端优先的站桩回合制页面，不再套用旧 `useCombatSceneController`、Phaser 灰度壳、点击移动、自动追击或 Colyseus command UI。
- 战斗、Boss、PVP 的 `scene_snapshot / timeline_event / settlement` 必须在 shared Colyseus join 阶段通过 `messageHandlers` 预注册；服务端初始 `scene_snapshot` 延后一拍发送，避免 H5 在首帧 handler 未注册时漏掉权威快照。H5 战斗 hook 在异常 `onLeave` 后会短退避重新 join，并在重新 join 成功后立刻 repair。`initialSequence` 只作为建立连接时 sequencer 初值读取，后续 `nextClientSequence` 变化不得触发房间 leave / rejoin。
- 浏览器 Colyseus endpoint 解析必须优先保持与当前 H5 页面同 host，不能把 `mrsj.ren` 页面连到裸 IP；登录 cookie 是 `HttpOnly`，跨 host WebSocket 不会携带 cookie，生产 `GAME_SERVER_AUTH_MODE=required` 会直接拒绝 join。
- 普通 solo 战斗的 `basicAttack` 必须进入 pending combat 正式事务，禁止掉到 fallback ACK 分支，否则前端会收到 accepted 但缺少 `state / battleView / sceneSnapshot` 的不完整结果。若 pending runtime 丢失，服务端必须先尝试 hydrate，仍失败时返回明确拒绝。
- 战斗 command 的 `clientSceneTick` 使用业务 `sceneSnapshot.tick`。普通 solo 战斗不再依赖后台 runtime 漂移推进；怪物只在玩家提交技能、丹药、撤离或认输等回合动作时，由 `executeTurn(...)` 在同一次服务端事务里反击或结算。

仍处于渐进迁移中的部分：

- 不同模式的底层伤害推进逻辑还没有 100% 合并成单一 ruleset runtime
- H5 战斗页旧 SSE / WS realtime fallback 已移除；普通 / 组队 / Boss / PVP 的技能、丹药、移动、advance 默认必须走 Colyseus command / movement 主链
- 普通战斗页在 Colyseus 房间暂未连接、重连中或被生产鉴权拒绝时，允许走现有核心 HTTP `/api/game/combat/action` 与 `/api/game/combat/move` 做恢复兜底。该兜底仍使用统一 command/move route、`actionId`、`clientSequence` 和服务端权威结算，不允许恢复旧 realtime 或前端自裁战果。
- Boss action / advance、奖励 replay 补偿、claim 语义和响应包装已迁入 `boss-command-route-service.ts` 核心 service；API route 只保留薄导出，`BossRoom` 不再动态 import API route

## 当前执行文档

- [`docs/current/combat-stage6-colyseus-ruleset-checklist-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/combat-stage6-colyseus-ruleset-checklist-2026-07-07.md)
- [`docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md)
- [`docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/legacy-realtime-retirement-stage9-2026-07-07.md)
- P1-B H5 主链代码门禁：`bun run stage-p1b:h5-mainline:check`

旧 Phase 3.5、旧 PVP replay、旧 combat scene SSE / WS、旧 Boss SSE / WS 文档和入口已归档。它们只用于历史追溯，不再作为当前阶段 6 / 阶段 9 的执行依据。

## 动作执行器口径

新增统一路由级执行器：

- `src/modules/combat/services/battle-command-executor.ts`

当前统一内容：

- 动作类型映射到 `BattleCommand`
- `clientSequence` 合法性校验
- `clientSceneTick` 与服务端 `serverSceneTick` 的时序校验
- 已结束战斗、未轮到当前玩家、模式不支持动作的统一拦截
- 统一 `commandResult / acceptedClientSequence / serverSceneTick` 返回
- 统一成功与失败响应结构

当前接入：

- `POST /api/game/combat/action`
  - `combatId`
  - `partyCombatId`
  - `pvpCombatId`

说明：

- 这轮统一的是“动作路由骨架”，不是把 `solo / party / pvp` 的底层推进算法硬并成一份大函数
- 各模式仍可保留自己的 `perform*Action` 与 `settlementPolicy`
- 但路由层不再分别手写一套动作校验、序列确认和返回拼装

### 当前继续收口

- `executeBattleCommandRoute`
  - 已扩成更通用的命令路由执行器，不再只服务传统动作按钮
- `validateBattleCommandRouteSync`
  - 已抽成共享的序列 / stale / tick 校验器
- `/api/game/combat/move`
  - `solo move` 已接入统一命令骨架
  - `pvp move` 已接入 Colyseus `PvpRoom` movement 主链，真实 PVP runtime 会保存双方视角 position override、重建 `sceneSnapshot` 并提交 accepted sequence；旧 HTTP move 不再作为 PVP 主链
- `Boss route`
  - 当前只保留薄导出；Boss 同步校验、奖励 replay、claim 语义和响应包装由 `boss-command-route-service.ts` 承接，`BossRoom` 直接导入核心 service

## 当前规则共识

- 战斗是否合法、伤害、冷却、死亡、奖励，都由服务端决定
- 客户端可以预测与补间，但不能自己裁定战果
- 战斗空间状态当前不再只靠速度字段猜测；`heading / moveState / targetPosition` 已进入快照口径
- 攻击表现与真实位移必须分层；服务端权威位置不允许再被前端动作表现二次篡改
- 失败惩罚当前统一为：
  - 回出生点
  - `hp = 1`
  - `mp = 1`
- 组队战继续采用共享战斗、独立奖励
- Boss 战继续保留 Boss 特殊结算与房间逻辑

## 普通战斗现状

- 单人普通战已改为站桩回合制互攻。
- H5 页面入口 `/game/combat/[id]` 当前使用 `TurnBasedCombatPage`，移动端优先，PC 保持同一纵向布局适配。
- 前端只负责展示战局和提交回合动作，不再使用旧实时走位、Phaser 灰度壳、点击移动、自动追击或 Colyseus command UI。
- 自动战斗只按出战顺序定时提交技能回合，不会追怪、走位或本地裁定命中。
- 普通战页面会透传 URL 中的 `partyCombatId` 给 `/api/game/combat/start`，避免组队普通战从地图/邀请入口进入时丢失 encounter 上下文。
- 站桩固定坐标需要留在基础攻击命中窗口内；当前固定敌方 `y=68`、玩家 `y=80`，避免边界距离造成“玩家攻击无效果 / MISS”。
- 怪物不会在 pending session 后台定时攻击玩家；怪物反击只发生在玩家动作提交后的服务端 `executeTurn(...)` 结算中。
- 单人普通战首个玩家指令回合会强制玩家先手，避免被速度更高的怪物抢首拍。
- 怪物基础攻击有兜底，不依赖数据库一定存在基础技能记录。

## 组队战与 Boss 审计要点

- 组队普通战的当前动作入口仍走 `/api/game/combat/action` 的 party 分支，必须携带 `partyCombatId`、`clientSequence`、`clientSceneTick`；服务端按 `currentTurnPlayerId` 校验当前出手人。
- 组队战撤离当前是队伍级撤离：任一队员撤离会把 encounter 标记为 `fled/abandoned`，后续若改为个人撤离，需要同步调整结算与前端文案。
- Boss 战玩家技能冷却必须由服务端保存到 `BossParticipant.skillCooldowns` 并在每个 Boss 回合动作后递减；前端只读取该字段显示与禁用按钮，不能只靠本地 MP 判断能否释放。
- Boss 自身技能冷却仍由 `bossSkillCooldowns` 维护；玩家技能冷却和 Boss 技能冷却是两套运行态，不要混写。

## 奖励与结算

- 奖励结算优先走 claim 化与幂等防重
- Boss、组队战、普通战斗都要支持重放式结果恢复
- 结算包只给必要摘要，高频链路不直接塞大体积掉落详情

## 当前常见故障与判断

### 现象

- 首领不存在但页面无法退出
- 战斗结算后卡死
- 组队成员看见的状态不一致
- 掉落或奖励没有成功领取

### 优先检查

1. 是否命中了统一 `BattleRuntime` 兼容链路
2. `commandResult` 是否返回并被前端消费
3. `settlement` 是否重复执行或被中途断流
4. 组队 claim 是否按玩家维度落账
5. 页面是否仍在消费旧的局部字段而不是 `battleView`

## 页面要求

- 移动端优先
- 顶部说明必须短，不能堆长串规则文案
- 场景区优先级最高
- 日志、目标、附加卡片必须可收起
- 玩家前台战斗文案必须使用游戏内表达，不显示服务端、接口、同步、实时房间、ACK、主链、权威状态等实现层词汇。
- 普通站桩回合战斗采用固定视口区块：战场、最新战况、操作区、战报和结算区各自限制高度，战报与操作区在区块内滚动，不让日志增长撑长整页或压缩战场。
- Boss、组队、PVP 只允许通过 mode widget 体现差异，不再复制多套页面骨架
- 技能雪碧特效统一挂在 `BattleStageEntityCanvas`
- 特效锚点统一取实体圆心：优先目标单位中心点，无目标时回退施法者中心点

## 当前前端壳

- 统一壳组件：
  - `src/modules/combat/ui/components/UnifiedBattleShell.tsx`
- 普通战斗与组队战：
  - `src/modules/combat/ui/pages/game/combat/[id]/page.tsx`
  - 组队战仍走这张页面，通过 `combatState.mode === "party"` 区分回合提示与操作限制
- Boss 战：
  - `src/modules/combat/ui/pages/game/boss/[id]/BossBattlePage.tsx`
  - 已接入统一 `topBanner / header / topHud / primaryContent / sideRail / mobileDock` 插槽结构
- PVP：
  - `src/modules/combat/ui/pages/game/pvp/[combatId]/PvpBattlePage.tsx`
- 当前统一原则：
  - `BattleScenePageFrame` 只负责最外层 frame
  - `UnifiedBattleShell` 负责页面壳与移动端底部操作区
  - 各 mode 只保留自己的状态卡、说明卡和少量 mode widget

## PVP 当前口径

- `/api/game/pvp`
  - 只负责创建 runtime，不再直接返回整场回放
- `PvpRoom`
  - 默认通过 Colyseus 返回 PVP 当前 `scene_snapshot / timeline_event / settlement`
  - `movement` 已接入真实 PVP runtime，不再落入房间内存 fallback；双方视角会分别生成自己在下方、对手在上方的镜像 snapshot
  - 重连 grace 失败后会触发 `disconnect_timeout` settlement reason，并通过 `combat_side_effect_claims` 的 `pvp-result:<combatId>` 幂等闸门保护正式结果落账
- `/api/game/combat/action`
  - 继续作为兼容 API 保留，但 H5 PVP 技能、丹药、认输默认固定走 Colyseus command 主链，不再把旧 HTTP action 当主流程 fallback
- PVP 超时推进
  - 当前已能通过 Colyseus command 触发；旧 HTTP advance 只作为兼容窗口
- `/game/pvp/[combatId]`
  - 已改成实时战斗页，不再默认消费本地回放

### PVP repair / timeout 口径

- 服务端：
  - `syncPvpCombatRuntime`
    - 进入 scene、action 或 Colyseus room 前会先补做超时推进
  - `advancePvpCombatTimeout`
    - 仍保留旧 HTTP 兼容入口；默认主链继续向 Colyseus command 收口
- 客户端：
  - `usePvpBattleSceneController`
    - 支持 `snapshot / sceneSnapshot` 兼容读取
    - 基于 `connectionSequence` 发现连接断层后自动 repair
    - 在 `focus / visibilitychange / stale interval` 时主动 repair
    - 命中 `turnDeadlineAt` 后优先发送 Colyseus timeout command

目标效果：

- 玩家切后台、Colyseus 短断、长时间未出手后回来，不会继续卡在过期回合
- repair 失败时页面进入 `stale`，但仍可通过统一 repair 逻辑恢复

## 与地图协作

- 地图进入战斗、战斗离场返回地图都需要统一状态恢复
- 秘境 Boss 战与普通地图战斗要共用位置、掉落与传送补偿思路
- 与地图共用实时实体 schema 和 codec 方向
