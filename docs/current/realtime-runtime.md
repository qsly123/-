# 实时运行时与同步链路：当前口径

## 当前结论

阶段 9 本轮已经退役旧地图 / combat / Boss realtime runtime 主链。

已归档内容：

- 旧地图 `/api/game/map/sse`
- 旧地图 `/ws/game/map/scene`
- 旧地图 shared watcher 主同步逻辑
- `server.mjs` 地图 websocket 分支
- `realtime-server.mjs` 地图重复逻辑
- 旧 combat scene `/api/game/combat/scene/sse`
- 旧 combat scene `/ws/game/combat/scene`
- 旧 Boss SSE / WS
- 旧 PVP replay 主流程

归档位置以 `legacy-realtime-retirement-stage9-2026-07-07.md` 为准。

不要再按旧 shared watcher、旧 map SSE / WS、旧 combat scene SSE / WS 或旧 Boss SSE / WS 开发新功能。

## 当前实时主线

- 地图：`apps/game-server` 的 `WorldMapRoom`
- 普通战斗 / 组队战：`CombatRoom`
- Boss：`BossRoom`
- PVP：`PvpRoom`
- 社交 presence：`SocialRoom`
- 协议：`packages/shared-protocol`
- 规则：`packages/game-rules`
- 持久化：Postgres + Drizzle schema / 核心 service
- 横向扩容：Redis Presence + Redis Driver

Next.js 继续负责登录、后台、普通页面、低频 API 和历史兼容 API。实时玩法主链不得再新增页面裸连 `WebSocket` / `EventSource`。

## P1-B H5 主链验收口径

当前新增 P1-B 代码门禁：`bun run stage-p1b:h5-mainline:audit` / `bun run stage-p1b:h5-mainline:check`。

该脚本覆盖：

- H5 地图页无旧 `/api/game/map/move`、旧地图 SSE / WS 主链引用。
- Boss 战报有折叠状态、`aria-expanded`，移动端 CSS 限制战报高度并把操作区放到底部 dock。
- 普通战斗 Phaser 灰度壳通过 `NEXT_PUBLIC_COMBAT_PHASER_SCENE=1` 启用时，复用 `useCombatSceneController` 持有的 Colyseus 状态、ACK 和 repair，不再在页面里重复 join 战斗房间。
- 普通 / 组队战、PVP、Boss 的技能、丹药、逃跑、认输、移动、advance 主链均保留在 Colyseus command / movement ACK 口径内，不回退旧 HTTP action fallback。

该脚本只证明代码层主链和旧入口引用归零；测试服跑满一个版本周期、线上 `WORLD_MAP_LEGACY_REALTIME_DISABLED=1` 灰度、iOS Safari / Android Chrome / PC H5 人工验收仍必须在根清单里单独留存日期后再勾选。

## 运行时形态

### Web runtime

`server.mjs` 当前只负责 Next Web 启动壳：

- 加载 `.env.local`
- 加载 Next standalone config
- 启动 Next request handler
- 拒绝旧 WebSocket upgrade

它不再承载旧地图 socket、旧 combat socket、旧 Boss socket 或 shared watcher。

### Legacy realtime health runtime

`realtime-server.mjs` 当前保留为内部健康探活兼容壳：

- `/_internal/runtime/health`
- `/_internal/runtime/performance`
- 旧 websocket upgrade 统一返回退役提示

这个进程不再负责旧地图 / 旧战斗 / 旧 Boss 的实时同步。保留它只是为了兼容当前 `/api/system/health`、后台性能面板和容器双进程启动脚本。后续如果运维面板完全迁到 `/game-server/health`，可以单独规划移除这个 health stub。

## 仍未退役的实时相关链路

聊天、附近频道、通知 SSE 不属于本轮地图 / combat / Boss 旧 realtime 退役范围。

仍需单独规划：

- `/api/game/social/sse`
- `/api/game/chat/sse`
- `/api/game/chat/nearby/sse`
- 通知中心事件流

这些链路的退役条件：

- H5 聊天页、地图聊天入口、通知中心不再依赖旧 SSE。
- 附近频道、组队 presence、宗门 presence 和通知状态完成 `SocialRoom` / 低频 API 分工。
- 新增或扩展审计脚本，确认没有 active legacy 引用。P2-A 已新增 `scripts/audit-chat-notification-sse-dependencies.ts`，入口是 `bun run stage-p2:social-sse:audit` 和 `bun run stage-p2:social-sse:check`。
- 按 `.bak/<YYYY-MM-DD>/` 规则归档，不硬删。

## 协议与 repair 口径

阶段 4 已在 `packages/shared-protocol` 定义统一实时输入和 repair 规则。

- 所有输入必须使用共享 envelope。
- 失败输入也要返回 ACK 或拒绝序号。
- repair 触发原因使用 `RealtimeRepairPayload.trigger`：
  - `manual`
  - `delta_gap`
  - `reconnect`
  - `weak_network_timeout`
  - `foreground_restore`
  - `visibility_restore`
  - `initial_join`
  - `server_request`
- 地图 repair 回包下发当前权威 `sector_snapshot`。
- 战斗 repair 回包下发当前权威 `scene_snapshot`。

## P0-B 事务与幂等底座

当前底座口径如下：

- 战斗结算 intent 由 `CombatRoom / BossRoom / PvpRoom` 生成和 flush；正式持久化入口包括 `apps/game-server/src/combat-settlement-transactions.ts`、Boss 核心事务 service、旧 HTTP settle 兼容 route 和 PVP runtime settlement。
- 战斗奖励、掉落、体力扣减和死亡惩罚在 Postgres transaction 内执行。`combat_reward_claims (combat_id, player_id)` 先占位并 `FOR UPDATE` 锁行后再发放，避免并发 claim / reconnect 先加经验、金币或背包后才撞唯一键。
- `combat_side_effect_claims` 现在有事务型 runner：同一个 transaction 内锁定 effect key、执行 DB 副作用、写 `completed`。死亡惩罚、PVP 正式结果、战斗任务推进都必须走该底座或等价 claim，不允许在房间里散落裸 DB 推进。
- `CombatRoom / BossRoom / PvpRoom` close 前会 flush pending settlement job，最多重试 3 轮。成功、重试中和最终耗尽都会输出结构化日志，包含 `roomId`、`roomKind`、`battleId`、`idempotencyKey`、`ageMs`、`attempt`、`rewardClaimId`、`sideEffectClaimed` 等字段。
- PVP 断线裁定和普通胜负以 `combat_side_effect_claims` 的 `pvp-result:<combatId>` 作为正式结果幂等闸门；落败传送、死亡计数、站内信、双方 combat log 和 fortune DB 账本与 claim `completed` 同事务提交。通知推送和地图预热在事务后按 `executed` 非阻塞触发。
- Boss 多人奖励以 `combat_reward_claims (combat_id, player_id)` 的 claim 语义发放；重复 claim / reconnect 会在锁行后回放既有 `rewardSnapshot`，不重复发奖。普通 Boss 奖励里的体力扣减也已移入 reward claim transaction。
- 战斗任务推进已抽成 `combat-quest-side-effect-intent.ts`。`runCombatKillQuestProgressIntent` / `runCombatTalkQuestProgressIntent` 使用事务型 side-effect runner，并调用 `quest-service.ts` 的 tx 版本推进 `player_quests.progress`；重复 reconnect 不重复推进任务。
- 地图 `interact / travel` 使用 `map_realtime_event_logs.idempotency_key = roomId:playerId:actionId`。处理前先写 `pending` 占位，完成后更新为 `accepted / rejected`；重复提交同一 `actionId` 直接回放结果或返回 `settlement_pending`。
- P2-A 地图 `interact` 支持 `opportunity / limited_opportunity` 共享机缘 claim 事务；`world_commission / reputation_event / sect_activity / event_portal / secret_realm / portal / sect_home` 返回明确 accepted ACK 和 `sideEffect: none`，真实接取、进入或治理仍走核心 API；`temporary_blocker / sealed_area` 返回 `permission_denied`，避免静默失败或假领奖。
- 旧 Next 随机事件 resolve、秘境入口和兼容 travel API 已统一接入 `map-action-idempotency.ts` / `map_realtime_event_logs`：成功会把最终视图写入 `resultJson` 供 reconnect / retry 回放；失败会写 `rejected` 供重复 actionId 回放；处理中重复请求返回 `settlement_pending`。复杂多步奖励、秘境进入或传送落账异常时保留 pending 并写线上日志，不自动重放多步副作用，避免半成功后重复发奖或重复传送。

## 地图房间、坐标与 AOI 口径

- 地图房间 key 统一使用 `createWorldMapRoomKey({ mapId, shardId })`，格式为 `mapId:shardId`。默认 `shardId` 是 `"0"`。
- `WorldMapRoom` 目标人数是 `WORLD_MAP_TARGET_CLIENTS_PER_ROOM = 80`，硬上限是 `WORLD_MAP_HARD_MAX_CLIENTS_PER_ROOM = 100`。
- 当前 shard 选择策略是默认 shard 优先；后续扩展自动分片时必须仍通过共享协议里的 room key 和 shard normalize 函数。
- 地图权威坐标单位是格子坐标。像素坐标和 Phaser 渲染坐标只能通过 `mapGridToPixelCoordinate`、`mapPixelToGridCoordinate`、`mapGridToPhaserCoordinate`、`mapPhaserToGridCoordinate` 转换。
- `apps/game-server/src/world-map-data.ts` 复用 Next 侧 `src/modules/map/services/runtime-map-store.ts#getRuntimeMapById`，不再复制一套地图结构读取逻辑。temporary map、world map instance、普通 map、开放世界入口合成和 legacy portal repair 口径由统一服务负责。
- P2-A 复杂临时事件实体统一进入 `WorldMapAoiEntity.kind`：`limited_opportunity / event_portal / sect_activity / temporary_blocker / sealed_area` 已进入共享协议；H5 只能消费净化后的 AOI 形状，不能读取原始 JSON payload。
- 地图结构缓存失效继续沿用 Next 当前地图读模型与 presence 侧规则：后台或运行时改动地图结构、机缘、秘境入口等时，必须同步触发既有 map scene / full panel 失效链路，不能让 Colyseus 单独缓存旧结构。`map-structure-invalidation.ts` 是地图结构变更的统一入口，会发布 `map_refresh(reason=map_structure)`，并复用 `publishMapRefresh` 失效 Next scene context、full panel 读模型缓存和 Colyseus `map-scene-hub` 共享态。
- 当前会触发地图结构失效的写入点包括后台 `maps / temporaryMaps / mapEdges` CRUD、境界配置重排导致的 `maps.minRealm` 重映射、宗门创建、宗门驻地编辑、宗门驻地扩建、宗门固定传送阵修复和空宗门清理。
- AOI 输出必须先净化再下发 H5。当前 `WorldMapAoiEntity` 只允许 `id / kind / name / x / y / velocityX / velocityY / updatedAt / sectorKey` 等渲染必要字段；后台-only 字段、隐私字段、未净化剧情 payload 和玩家私密数据不得进入 sector snapshot / delta。

## P1-A 运行稳定性与可观测性

`/game-server/health` 是 realtime 当前权威运行快照。返回值继续保留单进程顶层字段，同时新增 `processes[]`，即使当前只有一个进程也按同一结构输出，后台可按进程聚合多实例房间数据。

health 样例：

```json
{
  "ok": true,
  "service": "game-server",
  "processId": "game-server-1",
  "roomInstancesTotal": 2,
  "processes": [
    {
      "processId": "game-server-1",
      "roomInstancesTotal": 2,
      "metrics": {
        "onlineConnections": 3,
        "reconnectSuccessRate": 1,
        "persistFailures": 0,
        "websocketMissingSessionAndRoom": 1
      }
    }
  ],
  "roomInstances": [
    {
      "roomId": "abc",
      "roomKind": "world_map",
      "mapId": "qingyun_valley",
      "shardId": "0",
      "clientCount": 2,
      "repairInputs": 1,
      "moveRejectedByReason": {},
      "reconnectSuccessRate": 1,
      "persistFailures": 0
    }
  ]
}
```

当前 runtime metrics 口径：

- 全局与房间级都记录 `inputMessages / repairInputs / moveAccepted / moveRejected / moveRejectedByReason / tickAvgMs / tickMaxMs`。
- 房间级记录 `reconnectLeaves / reconnectSuccesses / reconnectFailures / reconnectSuccessRate`，地图、战斗、Boss、PVP 都必须通过房间维度看重连质量。
- DB 落账失败统一计入 `persistFailures / persistFailuresByReason`。地图移动 persist、地图 `interact / travel` 事务、战斗 settlement flush、PVP 断线裁定、Boss 核心事务失败都进入同一口径。
- realtime 协议拒绝统一计入 `realtimeRejected / realtimeRejectedByReason`，包括 invalid payload、entity missing、unsupported input、persist failed 等。
- WebSocket 细分计数包括 `websocketUpgradeRequests / websocketConnections / websocketConnectionErrors / websocketClientErrors / websocketHeartbeatTerminations / websocketHandshakeTimeouts / websocketMissingSessionAndRoom / websocketFailedReconnects / websocketRoomConnectFailures / websocketErrorByReason`。
- `SocialRoom` 单独记录 `socialMessages / socialRejected / socialRejectedByReason`，但仍只负责 presence 和轻量广播，不负责聊天或组队业务落账。

结构化日志 category：

- `web.request.failed`：Next / 后台 API 请求失败。
- `game-server.room.startup_failed`：房间创建或启动阶段失败。
- `game-server.room.map_load_failed` / `game-server.room.map_load_degraded` / `game-server.room.map_entity_load_degraded`：地图结构或实体加载异常。
- `game-server.room.db_persist_failed` / `game-server.room.db_persist_retry`：房间内 DB 落账失败、settlement flush 重试或耗尽。
- `game-server.room.runtime_refresh_failed`：Boss 等运行态刷新广播失败。
- `redis.error`：Redis 预检、连接或运行期错误。
- `realtime.protocol_error` 是协议错误的保留 category；当前协议拒绝已先进入 `realtimeRejectedByReason`，后续新增独立协议解析日志时使用该 category。
- DB 慢查询的保留 category 是 `db.slow_query`。新增 Drizzle / Postgres 慢查询采样时必须使用该 category，避免和房间落账失败混在一起。

## 开发禁令

- 不要重新接入旧 `/api/game/map/sse`。
- 不要重新接入旧 `/ws/game/map/scene`。
- 不要重新接入旧 `/api/game/combat/scene/sse`。
- 不要重新接入旧 `/ws/game/combat/scene`。
- 不要重新接入旧 Boss SSE / WS。
- 不要恢复 shared watcher。
- 不要在玩法页面直接 `new WebSocket` 或 `new EventSource`。
- 新实时玩法必须走 Colyseus 房间、共享协议和服务端权威规则。

## 后续执行入口

- 成品剩余总表：`remaining-work-to-product-2026-07-09.md`
- 阶段 5 地图详单：`map-stage5-colyseus-migration-checklist-2026-07-07.md`
- 阶段 6 战斗详单：`combat-stage6-colyseus-ruleset-checklist-2026-07-07.md`
- 阶段 7 社交 presence：`social-stage7-presence-room-2026-07-07.md`
- 阶段 8 后台监控：`admin-stage8-game-server-monitor-2026-07-07.md`
- 阶段 9 退役边界：`legacy-realtime-retirement-stage9-2026-07-07.md`
- 阶段 10 压测灰度：`stage10-loadtest-gray-release-checklist-2026-07-07.md`
