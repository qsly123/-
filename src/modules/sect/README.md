# 宗门模块

## 模块定位

负责宗门、宗门驻地、宗门仓库、职位治理与宗门传送链路。

## 当前重点

- 创建宗门、申请加入、审批、任命
- 宗门驻地地图与入口
- 宗门仓库基础存取与扩容
- 空宗门清理
- 玩家死亡后宗门回返
- 阶段 7 宗门成员 presence 接入准备

## 关键入口

- 页面
  - `/game/sect`
  - `/game/sect/edit`
- 接口
  - `/api/game/sect/*`

## 核心服务

- `sect-constants.ts`
- `sect-map-service.ts`
- `sect-governance-service.ts`
- `sect-service.ts`
- `sect-maintenance-service.ts`

## 当前 Colyseus 接入

- `SocialRoom` 已支持通过 `sectId` 输出 `sectMembers` presence，并额外下发宗门扩展 presence 列表 `sectPresence`（在线 / 驻地 / 离开驻地）。
- 宗门 presence 房间的 join 上下文统一由 `resolveSectPresenceRoomOptions(sectId)` 解析
  （`mapId: "sect:<sectId>"`、`shardId: "sect"`），任何页面都不许自己拼，否则成员会落在不同分片上互相看不见。
- 宗门 H5 页面进入宗门页即视为进入驻地，离开页面广播离场；成员列表显示「驻地 / 在线 / 离线」三态。
- 成员上线 / 下线 / 切换驻地 / 任命变化都会广播 `social_event`(10202)，事件类型为
  `sect_presence_join` / `sect_presence_leave` / `sect_presence_home_changed` / `sect_presence_role_changed`。
- 宗门扩展帧契约在 `packages/shared-protocol/src/sect-presence.ts`
  （子路径 `@immortality/shared-protocol/sect-presence`），`shared-protocol/src/index.ts` 未改动。
- `WorldMapRoom` 已把宗门外部入口和 home map 驻地标记同步为 `sect_home` AOI 实体；P2-A payload 可继续把宗门活动扩展为 `sect_activity` AOI 入口。普通地图分片规则仍按 `mapId + shardId`。
- 宗门仓库、建筑、治理仍必须走低频核心 API，不进入实时房间主循环。

## 状态变更刷新帧（强制推送）

宗门事务只要发生入库变更就必须下发刷新帧，**不允许只回 ACK**：

| 事务 | 帧 | opcode |
| --- | --- | --- |
| 仓库存取 / 捐献物品 | `inventory_refresh` + `asset_refresh` | 10302 + 10510 |
| 捐献灵石 / 扩建（资源变更） | `asset_refresh` + `progress_refresh`（scopes 含 `sect`） | 10510 + 12742 |
| 任命 / 审批 / 建筑 / 权限 / 退出 | `progress_refresh`（scopes 含 `sect`） | 12742 |

- 推送封装：`src/modules/sect/services/sect-state-refresh-service.ts`。
- 任命 / 审批 / 退出对**全宗门成员**各推一份，不只是操作者本人。
- 帧组同时随 API 响应体 `refreshFrames` 回传，客户端用
  `applyStateRefreshFramesFromResponse` 消费，即使推送不可达界面也会刷新。
- presence 兜底落库：`src/modules/sect/services/sect-presence-service.ts` + `/api/game/sect/presence`，
  字段见 `drizzle/0071_sect_member_presence.sql`（幂等）。

## 验收

- iOS Safari / Android Chrome / PC H5 宗门驻地和宗门成员 presence 仍需人工真机验收后，才能在根清单 P2-A 验收项打勾。
- 验收清单：[`docs/current/acceptance/system-c-sect-presence.md`](/docs/current/acceptance/system-c-sect-presence.md)
- BotClient 场景断言：`apps/game-server/src/bot/system-c-sect-presence.ts`
  （`bun run apps/game-server/src/bot/system-c-sect-presence.ts`，本地无 DB / Redis 可跑）

## 关联文档

- [`docs/current/architecture-overview.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/architecture-overview.md)
- [`docs/current/admin-ops-deployment.md`](/Users/huronglong/Desktop/mygame/Immortality-main/docs/current/admin-ops-deployment.md)

## 注意点

- 宗门仓库不能存绑定物品和已装备物品。
- 宗门地图和传送链路改动时，要同步检查地图 travel 和死亡回返逻辑。
- 宗门驻地后续作为特殊地图房间接入时，不能破坏普通地图 `mapId + shardId` 分片规则。
