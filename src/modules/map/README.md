# Map 模块

## 模块定位

负责实时地图、传送、随机事件、NPC、开放世界入口与 AI 秘境。

## 当前重点

- 地图首屏与静默刷新
- 玩家移动、AOI、纠偏
- NPC/怪物/其他玩家场景显示
- 传送阵与跨图旅行
- AI 秘境生成、入口刷新、实例进出、离开
- 野狼谷与秘境情报

## 关键入口

- 页面
  - `/game/map`
  - `/game/npc/[id]`
- 接口
  - `/api/game/map`
  - `/api/game/map/move`
  - `/api/game/map/travel`
  - `/api/game/secret-realm/*`

## 核心服务

- `map-scene-state.ts`
- `map-scene-sync.ts`
- `map-portal.ts`
- `runtime-map-store.ts`
- `map-action-idempotency.ts`
- `map-structure-invalidation.ts`
- `secret-realm-generation-service.ts`
- `secret-realm-spawn-service.ts`
- `secret-realm-instance-service.ts`
- `secret-realm-drop-generation-service.ts`

## 当前口径补充

- Colyseus `WorldMapRoom` 已承接阶段 5 地图主链：真实地图结构、玩家位置、普通 NPC/怪物、开放世界 NPC、active 机缘、传送点、全局秘境入口、个人可见秘境入口、sector AOI、服务端 repair、`move` 坐标落账、`interact` 机缘 claim 事务、`travel` 普通地图切图事务与幂等事件日志已在 `apps/game-server` 建立起点。`/game/map` 默认移动提交走 shared Colyseus hook，不再调用旧 `/api/game/map/move` 成功路径。
- H5 地图 hook 必须在 shared Colyseus join 阶段通过 `messageHandlers` 预注册 `sector_snapshot / sector_delta`；`WorldMapRoom` 首帧会等玩家真实坐标和私有实体 hydration 完成后再延后一拍发送，避免登录进图先收到默认坐标后又被 repair 拉回。
- 阶段 7/P2-A 已让开放世界事件进入地图实体：`reputation_event` 是玩家私有名声事件入口，`world_commission` 覆盖公共故事线与玩家私有委托，`sect_home` 覆盖宗门外部入口与驻地 home map 标记。P2-A 继续支持 `limited_opportunity`、`event_portal`、`sect_activity`、`temporary_blocker`、`sealed_area`，并允许 world storyline / player offer / player incident payload 扩展多个入口。`WorldMapRoom` 每 5 秒重读实体源，NPC / 怪物 / 世界 NPC / 事件 / 委托 / 宗门入口出现、消失和位置变化会通过 AOI delta 下发，位置变化会带 `velocityX / velocityY`。
- `/game/map` 已新增 Phaser 地图灰度壳 `WorldMapPhaserScene`，通过 `NEXT_PUBLIC_WORLD_MAP_PHASER_SCENE=1` 启用。该壳复用 shared Colyseus AOI hook 和现有点击移动回调，不在页面里裸连 WebSocket；当前已支持点击移动、左下角轻量虚拟摇杆、其他玩家 / NPC / 怪物插值和平滑外推、服务端纠偏动画、弱网状态点与手动 repair。阶段 5 H5 三端人工验收已由用户确认通过；默认仍使用旧 H5 Canvas，正式扩大灰度前保留旧主链回滚口。
- H5 断线重连代码层已补齐：`useWorldMapColyseusAoi` 会监听 SDK `onLeave / onReconnect`、浏览器 `online / focus / pageshow / visibilitychange`，断线后退避 rejoin，重连或前后台恢复后自动发送 `repair`，长时间无 AOI 消息时触发 `weak_network_timeout` repair。阶段 5 H5 三端前后台恢复验收已由用户确认通过，1Panel 反代仍建议在每次部署后复测。
- 当前 Colyseus 地图链路已补齐同 AOI `entity_update`、delta 断层自动 repair、H5 前后台恢复 repair、NPC / 怪物占位阻挡、相邻斜向移动兼容旧 H5 规则、ACK 前 Postgres 坐标落账、基础 runtime metrics，以及 `NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=off|shadow|main` 灰度开关。当前默认是 `main`，旧移动 fallback 已从 H5 地图页移除。
- H5 地图移动在 `main` 模式下要区分“服务端权威拒绝”和“Colyseus 传输暂不可用”。`sendMoveAndWait / sendInteractAndWait` 返回空只表示当前房间尚未可发送，页面会短暂等待重连；等待失败时返回 `transportUnavailable`，只提示移动未提交，不触发 `resyncRequired`，避免把短暂重连窗口误判成地图状态冲突并把玩家拉回。
- 随机事件奖励动作已不再调用插件 Hook；历史双修 `doubleCultivation` 动作和 `double-cultivation` 判定条件由 `src/modules/world/services/double-cultivation-random-event.ts` 核心服务承接。`judgeConditions.pluginConditions` 字段暂作历史数据兼容容器，不能新增其他插件判定。
- 地图“附近道友”资料弹窗已补固定“申请双修”按钮，直接调用 `/api/game/double-cultivation/request`；旧 `map.nearby-player.actions` 只作历史说明，不再作为运行时入口。
- 阶段 5 后续执行以 `docs/current/map-stage5-colyseus-migration-checklist-2026-07-07.md` 为准；阶段 9 已完成旧地图 SSE / WS / shared watcher 归档，后续不要重新接入旧入口。
- 阶段 9 已移除旧地图 `/api/game/map/sse`、`/ws/game/map/scene`、旧 shared watcher 和 `realtime-server.mjs` 地图重复逻辑；归档位置为 `.bak/2026-07-08/realtime-runtime-map-legacy/`。后续不要重新接入旧 map SSE / WS。
- full 模式下的低频面板数据已改走 `map-full-panel-data.ts` + 读模型缓存
- full 面板缓存已拆成 `travel / secret-realm / world-base / world-player` 分段 key
- 结构性 silent refresh 会强制绕过旧 scene context cache
- 机缘/秘境/地图结构事件会失效对应地图缓存
- 旧地图 WS watcher 只作为 active legacy 追溯项，不再作为新增能力方向；退役按阶段 9 门禁执行
- 玩家当前只在 `clear` 视域显示；NPC、怪物按 `clear + shallow` 处理可见性，避免迷雾中的玩家残留或显示错位
- 神识 clear / shallow 视野与地图窗口当前统一按奇数尺寸居中展开，玩家所在格必须是中心点
- P0-B 起，Colyseus `WorldMapRoom` 的地图结构读取复用 `runtime-map-store.ts#getRuntimeMapById`，game-server 不再维护独立地图结构读取副本。
- 地图房间 key、shard 默认值、目标人数、硬上限、格子/像素/Phaser 坐标转换函数统一在 `packages/shared-protocol`；业务代码不得散落手写 `"0"` shard 或自定义坐标换算。
- `interact / travel` 事务用 `map_realtime_event_logs` 按 `roomId:playerId:actionId` 做幂等；旧 Next 随机事件 resolve、秘境入口和兼容 travel API 统一用 `map-action-idempotency.ts` 按 `scope:playerId:actionId` 回放成功 / 失败结果，处理中重复请求返回 `settlement_pending`。复杂多步奖励或秘境进入异常会保留 pending 并输出日志，避免半成功后自动重放副作用。
- P2-A 临时阻挡支持 tile type `blocked / barrier / sealed / event_blocker / closed_portal / portal_placeholder`、tile `walkable:false`，以及事件 payload 中的 `temporaryBlockers / blockedAreas / sealedAreas / portalPlaceholders`。动态阻挡支持时间窗和半径，最终合并进 `WorldMapRoom` 权威阻挡，不依赖前端本地判断。
- P2-A `interact` 新口径：`opportunity / limited_opportunity` 共享机缘 claim；委托、名声、宗门活动、事件传送门、秘境、传送点和宗门驻地入口只返回确认 ACK，真实接取/进入/治理继续走核心 API；阻挡和封锁实体返回明确拒绝。
- 地图结构变更统一通过 `map-structure-invalidation.ts` 发布 `map_refresh(reason=map_structure)`。后台 `maps / temporaryMaps / mapEdges` CRUD、境界配置导致的 `maps.minRealm` 重映射、宗门创建 / 驻地编辑 / 扩建 / 空宗门清理都会触发同一 presence 信号，使 Next scene context、full panel 读模型缓存和 Colyseus 共享态一起失效。
- AOI 输出只下发净化后的渲染必要字段；私有秘境、名声事件、世界委托先按玩家过滤，再转换成同一 `WorldMapAoiEntity` 形状。

## 关联文档

- [`docs/current/map-secret-realm.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-secret-realm.md)
- [`docs/current/map-stage5-colyseus-migration-checklist-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-stage5-colyseus-migration-checklist-2026-07-07.md)
- [`docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-mainline-cutover-before-stage9-2026-07-08.md)
- [`docs/current/legacy-realtime-retirement-stage9-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/legacy-realtime-retirement-stage9-2026-07-07.md)
- [`docs/current/realtime-runtime.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/realtime-runtime.md)
- [`docs/current/open-world.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/open-world.md)
- [`docs/current/social-stage7-presence-room-2026-07-07.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/social-stage7-presence-room-2026-07-07.md)
- [`docs/current/map-first-load-read-model-and-refresh.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/map-first-load-read-model-and-refresh.md)

## 注意点

- 地图页是高耦合聚合页，改动前先确认边界属于地图、世界、社交还是战斗。
- 秘境离开、Boss 封印、野狼谷特殊逻辑要同时看前端提示和服务端阻止链路。
