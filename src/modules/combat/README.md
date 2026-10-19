# Combat 模块

## 模块定位

负责服务端权威战斗系统，当前正向统一战斗内核收口。

## 当前重点

- 单人普通战斗，当前为站桩回合制互攻
- 组队战
- Boss 战
- PVP 实时 runtime 与统一 scene/action
- 统一 `BattleRuntime / BattleRuleset / BattleViewState`
- 阶段 6 Colyseus 战斗房间与纯规则迁移

## 阶段 6 审计口径

- `bun run stage6:combat-command:check` 当前只覆盖 PVP timeout 子项，不能代表完整战斗 command 主链完成。
- `bun run stage6:combat-mainline:audit` 会列出 H5 页面中仍调用旧 `/api/game/combat/action`、`/api/game/combat/move`、`/api/game/combat/advance`、`/api/game/boss/*` 的准确位置。
- `bun run stage6:combat-mainline:check` 是旧战斗动作主链退役前的严格门禁；当前应通过，若失败说明有旧 HTTP action / move / advance fallback 回流。
- `bun run stage-p1b:h5-mainline:check` 是 P1-B H5 主链代码门禁，额外覆盖 Boss 战报移动端折叠、普通战斗 Phaser 灰度壳接入同一条 Colyseus ACK / repair 主链、以及旧地图 move fallback 归零。

## 关键入口

- 页面
  - `/game/combat/[id]`
  - `/game/boss/[id]`
  - `/game/pvp/[combatId]`
- 接口
  - `/api/game/combat/*`
  - `/api/game/boss/[id]*`
  - `/api/game/pvp`

## 核心服务

- `battle-ruleset.ts`
- `battle-runtime.ts`
- `battle-command.ts`
- `battle-command-executor.ts`
- `battle-view.ts`
- `battle-scene-hub.ts`
- `battle-scene-sync.ts`
- `battle-spatial-runtime.ts`
- `party-combat-service.ts`
- `pvp-runtime-service.ts`
- `ui/components/BattleActionPanel.tsx`
- `ui/components/CompactCombatUnitStatusCard.tsx`

### 当前统一骨架

- `battle-command-executor.ts`
  - 为 `solo / party / pvp` 提供统一动作路由执行骨架
  - 现已继续扩到通用命令路由执行器，`move` 也开始复用同一套命令回包与同步校验
  - 统一处理：
    - 动作映射
    - 序列号校验
    - 场景 tick 校验
    - finished / turn / unsupported 拦截
    - `commandResult / acceptedClientSequence / serverSceneTick` 返回
- `pvp-runtime-service.ts`
  - 当前除 PVP 创建与动作外，也承接：
    - `syncPvpCombatRuntime`
    - `advancePvpCombatTimeout`
    - 按玩家视角构造 `battleView / battleRuntime / sceneSnapshot / settlement`
- `ui/components/BattleActionPanel.tsx`
  - 当前为 `solo / pvp` 共用的技能、丹药、主指令操作面板骨架
- `ui/components/CompactCombatUnitStatusCard.tsx`
  - 当前为 `solo / pvp` 共用的顶部紧凑状态卡
  - Boss 页桌面端的 `战报 + 操作区` 已在页面结构和布局语言上向同一套 side rail 收口，但 Boss 的按钮内容组件还未完全复用
- `services/boss-battle-runtime.ts`
  - Boss 共享 `battleView / battleRuntime` 构造器
  - 供 Boss route 与统一 scene stream 共用，避免多处重复拼装
- `services/battle-spatial-runtime.ts`
  - 为 `solo / party / boss / pvp` 提供统一的空间快照构造与 action timeline 生成入口
  - 当前统一补齐 `heading / moveState / targetPosition`，并明确 action 与 movement 分通道
- `packages/game-rules`
  - 阶段 6 已抽出 `BattleRuleset`、基础伤害、可配置伤害公式 parser / calculator、迁移期 runtime ruleset、冷却字段、距离 / 命中、战斗移动、settlement intent、reward intent、drop intent、death penalty intent、PVP timeout 纯规则起点
- `damage-formula.ts`
  - 当前只负责读取 `COMBAT_DAMAGE_FORMULA`、缓存 calculator 和记录回退日志；公式 parser / compiler 已迁到 `packages/game-rules`
- `battle-ruleset.ts`
  - 当前是 `packages/game-rules` runtime ruleset 的薄适配器，保持旧 Next 战斗主链规则形状不变
- `apps/game-server/src/rooms/combat-realtime-room.ts`
  - 阶段 6 已让 `CombatRoom / BossRoom / PvpRoom` 共用 `command / movement / useItem / surrender / repair` ACK 骨架
  - 已输出统一 `scene_snapshot`，并支持异常断线 10 秒 reconnect grace，重连成功后下发 repair 快照
  - Boss `flee / surrender` 已直接调用 `boss-room-runtime-service.ts`，不再走旧 DELETE fallback；Boss action / advance 已移除 `GAME_WEB_INTERNAL_URL` 内部 HTTP 网络 bridge，并改为直接导入 `boss-command-route-service.ts` 执行核心真实事务
- 已通过 `combat-runtime-hydration.ts` 读取真实普通战斗 pending session、玩家战斗可用消耗品、组队战 party encounter、Boss instance / damageMap / reward claim、PVP runtime / settlement / timeout 状态
- command / repair 后会重新刷新真实 runtime，并向房间内客户端下发新的 `scene_snapshot`；command 会额外广播独立 `timeline_event`，settlement intent 会额外广播独立 `settlement`
  - `surrender` 当前会生成 settlement / reward / drop / death penalty intent；配置 `DATABASE_URL` 时通过 `executeCombatSettlementTransaction(...)` 在 Postgres 事务中写入 `combat_reward_claims / combat_side_effect_claims` 幂等落账。
  - P0-B 起，奖励、掉落、体力扣减、任务推进、死亡惩罚和 PVP 正式结果都必须有 claim / side-effect key。`combat_reward_claims (combat_id, player_id)` 先占位并 `FOR UPDATE` 锁行后再发放；`combat_side_effect_claims` 的事务型 runner 会在同一个 transaction 内执行 DB 副作用并写 `completed`。
  - `CombatRoom / BossRoom / PvpRoom` close 前会 flush pending settlement intent，最多重试 3 轮；成功、重试中、最终耗尽都会输出结构化日志，便于线上追查掉线结算与 reconnect 回放问题。
- 普通 solo 战斗 H5 页面当前重写为站桩回合制，技能、丹药、撤离、认输直接提交核心 HTTP action route，由服务端 `executeTurn(...)` 一次结算玩家动作与怪物反击；Boss、PVP 与后续多人实时链路仍保留 Colyseus command 方向。
- `apps/game-server/src/rooms/combat-room.ts`
  - `CombatRoom` 默认仍是 `solo`；join options 携带 `partyId` 时切换 `party` ruleset，并在 snapshot 中维护多名队员和服务端权威组队目标实体
- `ui/pages/game/combat/[id]/TurnBasedCombatPage.tsx`
  - 普通 solo H5 主入口，移动端优先，PC 同步使用同一纵向布局。
  - 不复用旧普通战页面壳、Phaser、点击移动、自动追击或 `useCombatSceneController`。
  - 自动战斗只按技能顺序提交服务端回合动作，不做本地追击或伤害裁定。
  - 进入组队普通战时必须透传 `partyCombatId`，否则会错建/错入单人战。
- `useCombatSceneController` 仍作为历史实时战斗控制器存在，但普通 solo H5 入口不再依赖它。
- `usePvpBattleSceneController` 默认消费 `PvpRoom` Colyseus `scene_snapshot / timeline_event / settlement`，不再连接旧 combat scene SSE
- Boss 页默认消费 `BossRoom` Colyseus `scene_snapshot / timeline_event / settlement` 更新权威状态；旧 Boss WS / SSE 已在阶段 9 归档
- Boss route 只保留薄导出；奖励 replay 补偿、claim 语义和响应包装已由 `boss-command-route-service.ts` 承接，`BossRoom` 不再动态 import API route。
- Boss 玩家技能冷却保存在 `BossParticipant.skillCooldowns`，由 `boss-command-route-service.ts` 服务端校验并在动作后递减；前端 `BossBattlePage` 只根据同步字段显示/禁用按钮。
- 阶段 9 已归档旧地图 SSE / WS、旧 combat scene SSE / WS、旧 Boss SSE / WS 和旧 PVP replay 主流程。归档位置分别见 `.bak/2026-07-08/realtime-runtime-map-legacy/`、`.bak/2026-07-08/realtime-runtime-combat-boss-legacy/`、`src/modules/.bak/2026-07-08/combat/pvp-replay/`。
- H5 旧 HTTP action / move / advance fallback 已移除；PVP 断线裁定和正式结果幂等落账已接入 `settlePvpCombatDisconnect(...)` 与 `combat_side_effect_claims` 的 `pvp-result:<combatId>` 闸门。旧 HTTP settle 兼容 route 也已接入 reward claim 行锁、事务内体力扣减和任务推进 intent。

## 关联文档

- [`docs/current/combat-stage6-colyseus-ruleset-checklist-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/combat-stage6-colyseus-ruleset-checklist-2026-07-07.md)
- [`docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md)
- [`docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/legacy-realtime-retirement-stage9-2026-07-07.md)
- [`docs/current/combat.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/combat.md)
- [`docs/current/realtime-runtime.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-runtime.md)
- [`docs/current/map-secret-realm.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-secret-realm.md)

## 注意点

- 当前是渐进统一；普通 solo 已按站桩回合制重写，Boss/PVP/未来多人实时不要被普通 solo 的页面形态反向限制。
- 奖励与结算必须保持幂等，尤其是组队战和 Boss 战；新增奖励路径必须复用 `combat_reward_claims` 或等价 claim。
- 任务推进必须走 `combat-quest-side-effect-intent.ts`，由事务型 `combat_side_effect_claims` runner 调 `quest-service.ts` 的 tx 版本推进；房间和战斗结算路径不得直接调用 `advanceKillQuestProgress` / `advanceTalkQuestProgress`。
- PVP 当前已经接入统一 `scene / action / advance` 低频 API 和 `PvpRoom` Colyseus 状态同步；旧 combat scene SSE 已从 H5 控制器断开。
- `/api/game/combat/scene` 需要继续保留 `snapshot + sceneSnapshot` 双字段兼容，直到旧消费者全部迁走。
- PVP repair 不能只靠前端；读取 runtime 前的 `syncPvpCombatRuntime` 不能省。
- Phase 3.5 已开始把 Boss realtime payload 对齐到统一 `BattleRealtimeEnvelope`，Boss 页应优先消费 `payload.battleView / payload.battleRuntime`。
- `validateBattleCommandRouteSync` 已抽成共享校验器，Boss route 也开始复用同一套序列 / stale / tick 规则。
- 单人普通战当前要求是站桩回合互攻，不再做怪物后台索敌、追击或移动后自动攻击。
- 单人普通战固定站位必须保持在基础攻击命中窗口内，当前敌方 `y=68`、玩家 `y=80`，避免距离边界造成攻击无效。
- 玩家前台战斗页不得展示“服务端 / 接口 / 同步 / 实时房间 / ACK / 权威状态”等实现层词汇；普通站桩战斗页采用固定视口区块，战报和操作区内部滚动，避免日志增长挤压战场。
- 战斗画布层当前必须避免“双重位移”：服务端 timeline 已有动作前压时，实体层不能再叠加一次本地 rush。
- 后续如继续推进多人实时战斗，优先在共享 `battle-spatial-runtime.ts` 上加能力，不要让 `solo` 独自长出一套 spatial 表达。
