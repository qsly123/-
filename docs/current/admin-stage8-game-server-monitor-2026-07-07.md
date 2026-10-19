# 阶段 8 后台实时房间监控接入记录

本文记录阶段 8 第一轮后台运维改造：Next 后台读取独立 `game-server` 的健康检查与基础 metrics。

## 当前完成

- 新增后台页面：`/admin/game-server`。
- 新增后台 API：`/api/admin/game-server/health`。
- 新增服务：`src/modules/admin/services/game-server-health.ts`。
- 后台菜单 `系统能力` 下新增 `实时房间监控`。
- API 通过 `requireAdminApi()` 校验后台权限。
- API 默认探测：
  - `GAME_SERVER_HEALTH_URL`
  - 或 `GAME_SERVER_INTERNAL_URL + /game-server/health`
  - 或 `GAME_SERVER_PUBLIC_URL / GAME_SERVER_URL + /game-server/health`
  - 或 `http://127.0.0.1:${GAME_SERVER_PORT || 3201}/game-server/health`
- 2026-07-09 修正：如果线上遗留的 `GAME_SERVER_HEALTH_URL` 指向 `172.18.0.x` Docker 内网 IP，同时存在 `GAME_SERVER_INTERNAL_URL`，后台监控会自动改用稳定的内部服务名地址，避免 1Panel / Compose 重建后容器尾号变化导致监控不可用。线上 Web 容器当前使用 `GAME_SERVER_INTERNAL_URL=http://immortality-game-server:3201`。
- 页面展示：
  - game-server 在线 / 不可用状态。
  - 探测地址、HTTP 状态、延迟。
  - processId、运行时间、协议版本。
  - Redis 正常 / 异常 / 未启用状态、PING 延迟和错误原因。
  - 房间类型列表。
  - 基础累计 metrics：
    - roomsCreated
    - onlineConnections / peakOnlineConnections
    - joins / leaves
    - reconnectLeaves / reconnectSuccesses / reconnectFailures / reconnectSuccessRate
    - tickSamples / tickAvgMs / tickMaxMs
    - inputMessages
    - repairInputs
    - moveAccepted / moveRejected
    - interactInputs / travelInputs
    - sectorSnapshotsSent / sectorDeltasSent
    - websocketUpgradeRequests / websocketConnections / websocketConnectionErrors / websocketClientErrors / websocketHeartbeatTerminations
  - 移动拒绝原因分布。
- game-server `/health` 已新增活跃房间实例 registry：
  - `roomId`
  - `roomKind`
  - `mapId / mapName / shardId`
  - `combatId / partyId`
  - `clientCount / peakClientCount`
  - `entityCount`
  - 每房间 `inputMessages`
  - 每房间 `tickAvgMs / tickMaxMs`
  - 每房间 `repair / move / interact / travel / sector snapshot / sector delta` 计数
  - `createdAt / updatedAt / status`
- 后台页面已新增：
  - 活跃房间实例表。
  - 地图分片状态表。
  - Boss / PVP 房间状态表。
  - 顶部活跃房间数量。

## 当前边界

- 当前房间 registry 是单个 game-server 进程内视角；多实例横向部署后的跨实例汇总仍需要 Redis / driver registry 或后台聚合层。
- 已释放房间会从活跃列表移除；后台当前展示的是实时活跃房间，不是历史房间审计。
- Redis ping、延迟和错误原因已经接入 `/game-server/health` 与后台页；错误计数、持久化状态和资源限制仍留到阶段 10 上线检查。
- WebSocket transport 基础计数已接入；反代层 fallback 细分、按错误类型聚合仍未接入。
- 该后台页不依赖业务数据库；但进入 `/admin/*` 仍需要现有后台登录态。

## 后续任务

- WebSocket transport 继续细化 fallback、错误类型和反代层统计。
- 多实例部署后补跨进程房间实例聚合。
- 后台继续细化 SocialRoom nearby message 专项统计。
