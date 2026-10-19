# Colyseus 多人在线底座起步版（2026-07-07）

## 目标

本轮建立新的多人在线底座骨架，为后续地图、秘境、战斗、Boss、PVP、社交 presence 迁移做准备。

当前不是把旧地图/战斗业务一次性迁走，而是先让独立 `game-server` 可以启动、注册房间、健康检查、接入可选 Redis 扩容组件。

## 新增工程结构

  - `apps/game-server`
    - Colyseus 实时服务器入口。
    - 提供 `/health` 与 `/game-server/health`。
    - 支持 `bun run game:dev`、`bun run game:start`、`bun run game:smoke` 和阶段 10 `game:load:*` 压测脚本。
    - `world_map` 已按 `mapId + shardId` 做 Colyseus `filterBy`，避免不同地图分片被 `joinOrCreate` 复用到同一个房间。
- `packages/shared-protocol`
  - 共享房间名、协议版本、实时输入/输出 envelope、输入 ACK、地图/战斗/社交输入类型与 `social_snapshot / social_event` presence 类型。
- `packages/game-rules`
  - 第一批纯规则函数：格子移动判定、战斗命令判定、战斗移动、伤害计算、可配置伤害公式 parser / calculator、迁移期 runtime ruleset、settlement / death penalty intent、PVP timeout 判定。
- `packages/db`
  - 对现有 `src/db` 的 workspace re-export，后续逐步承接 Drizzle schema 与 DB client。

## 房间骨架

已注册的 Colyseus 房间：

- `world_map`
- `secret_realm`
- `combat`
- `boss`
- `pvp`
- `social`

所有房间当前继承 `BaseGameRoom`，具备：

- 基础 `GameRoomState`
- Colyseus `onAuth` 会话鉴权入口
- 玩家实体进入/离开
- 20Hz simulation tick
- 最小 `move` 输入 ACK
- 非法移动输入拒绝 ACK
- 所有不合规输入元数据拒绝 ACK
- `snapshotVersion` 增量

后续业务迁移时，应按阶段把地图 AOI、战斗命令、Boss 结算、PVP 超时、社交 presence 分别扩进对应房间，而不是继续扩旧 `server.mjs` / `realtime-server.mjs`。

## Redis 与部署

新增依赖：

- `colyseus`
- `@colyseus/core`
- `@colyseus/schema`
- `@colyseus/redis-presence`
- `@colyseus/redis-driver`
- `phaser`
- `@types/ws`（开发类型）

注意：当前 game-server 使用 `apps/game-server/src/colyseus-same-core-websocket-transport.ts` 作为 WebSocket transport。原因是 Bun 安装树中 `colyseus` 与 `@colyseus/ws-transport` 曾解析出两份不同的 `@colyseus/core` 实例，导致 `/matchmake` 已创建 seat reservation，但 WS 消费 seat 时读不到同一个 `matchMaker` 本地房间表，表现为官方 SDK join 报 `seat reservation expired`。自定义 transport 只保留官方 ws transport 的必要连接逻辑，并且所有 `matchMaker / connectClientToRoom / Protocol` 都从同一个 `colyseus` core 入口导入。

`REDIS_URL` 未配置时，game-server 以单进程本地模式启动。

`REDIS_URL` 配置后，game-server 会启用：

- Redis Presence
- Redis Driver

2026-07-09 修正：GHCR 独立 `game-server` 镜像不再内置 `GAME_SERVER_PUBLIC_ADDRESS=172.18.0.x:3201`。Docker 内网 IP 会随 1Panel / Compose 重建、临时 smoke 容器启停、网络重建而漂移，不能作为 Colyseus 返回给 H5 的公开 reservation 地址。线上必须显式配置浏览器可访问的公网 host:port，例如 `mrsj.ren:3201`；未配置时由 Colyseus 按请求入口推导。当前 1Panel 反代方案为：game-server 容器映射 `127.0.0.1:3202->3201`，OpenResty `mrsj.ren:3201` upstream 指向 `http://127.0.0.1:3202`，避免继续依赖 Docker 内网 IP。

2026-07-08 补充：

- game-server 在 `listen()` 前会对 `REDIS_URL` 执行 Redis PING 预检。
- Redis 不可达、URL 非法或协议不支持时会抛出 `game_server_redis_unavailable`，不会继续启动一个 `/health` 看似正常但 Redis 不可用的实例。
- 新增 `bun run game:smoke:redis-failure`，用于在本地验证 Redis 不可达时能得到明确失败。
- 新增 `bun run game:smoke:redis-multi`，需要真实 `REDIS_URL`，会拉起两个 game-server 子进程，验证 RedisDriver 查询共享房间和从第二实例 `joinById` 第一实例创建的房间。

新增部署文件：

- `docker/game-server.Dockerfile`
- `docker/compose.multiplayer.yml`

该 compose 文件是 1Panel / Docker 编排参考，包含：

- `web`
- `game-server`
- `redis`

实际线上启用前，还需要结合现有 Postgres、上传目录、反向代理 WebSocket upgrade 和域名路径策略做最终编排。

## 当前命令

- `bun run game:dev`
- `bun run game:start`
- `bun run game:smoke`
- `bun run game:smoke:redis-failure`
- `bun run game:smoke:redis-multi`
- `bun run game:load:basic`
- `bun run game:load:map-shards`
- `bun run game:load:map-move`
- `bun run game:load:repair`
- `bun run game:load:reconnect`
- `bun run game:load:combat-command`
- `bun run game:load:boss-command`
- `bun run game:load:pvp-command`
- `bun run game:load:settlement-intent`
- `bun run game:load:stage10-local`
- `bun run game:load:stage10-scale-local`

`bun run game:load:basic` 是阶段 10 基础连接压测起点，默认本地启动 game-server，并用官方 SDK 批量 join `WorldMapRoom`、发送 `repair`、等待 ACK 和 `sector_snapshot`。详细压测与灰度门禁见 `docs/current/stage10-loadtest-gray-release-checklist-2026-07-07.md`。

`bun run game:load:map-shards` 是阶段 10 多地图 / 多分片持续在线压测起点，默认本地启动 game-server，把虚拟客户端分布到多个 `mapId + shardId`，全部 join + repair 成功后保持在线并读取 health，再统一离开。该脚本用于验证多 `WorldMapRoom` 分片与在线 health 指标，不代表 Redis 多实例横向扩容。

`bun run game:load:map-move` 是阶段 10 地图移动压测起点，默认本地启动 game-server，批量 join 后按 1 格小步路线发送 `move`，统计 move ACK、拒绝原因和 health 指标。该脚本只验证 Colyseus `WorldMapRoom` 的 move ACK 压力，不代表旧 `/api/game/map/move` 已退役。

`bun run game:load:repair` 是阶段 10 弱网 repair 压测起点，默认本地启动 game-server，批量 join 后按延迟/抖动反复发送 `repair`，统计 repair ACK、`sector_snapshot` 和 health 指标。该脚本验证协议层 repeated repair 压力，不替代真实 iOS Safari 后台恢复人工验收。

`bun run game:load:reconnect` 是阶段 10 断线重连压测起点，默认本地启动 game-server，批量 join 后保存 SDK `reconnectionToken`，用 `1001 Going Away` 关闭底层连接触发服务端 reconnect grace，再通过 `client.reconnect(token)` 重连并发送 `repair`。该脚本验证协议层重连，不替代真实 H5 三端前后台恢复人工验收。

`bun run game:load:combat-command` 是阶段 10 普通战斗 command 压测起点，默认本地启动 game-server，每个虚拟战斗创建 2 个 SDK 客户端进入同一个 `CombatRoom`，先用合法 `movement` 把攻击者移动到命中范围，再发送 `basicAttack` command 并统计 ACK 接受率、拒绝原因和延迟。该脚本只验证 `CombatRoom` ACK 骨架，不代表旧战斗主链、Boss 奖励结算或 PVP 主流程已经迁移完成。

`bun run game:load:boss-command` 是阶段 10 Boss 多人 command 压测起点，默认本地启动 game-server，每个虚拟 Boss 房间创建 20 个 SDK 客户端进入同一个 `BossRoom`，先用合法 `movement` 把每个攻击者移动到命中范围，再发送 `basicAttack` command 并统计 ACK 接受率、拒绝原因和延迟。当前 `BossRoom` 还没有读取真实 Boss runtime，所以脚本暂用同房间内玩家实体作为目标，只验证多人房间 command ACK 骨架，不代表 Boss 血量、奖励、掉落或 Postgres 结算幂等已经迁移完成。

`bun run game:load:pvp-command` 是阶段 10 PVP 多房间 command 压测起点，默认本地启动 game-server，每个虚拟 PVP 房间创建 2 个 SDK 客户端进入同一个 `PvpRoom`，先用合法 `movement` 把双方移动到命中范围，再双向发送 `basicAttack` command 并统计 ACK 接受率、拒绝原因和延迟。该脚本只验证 `PvpRoom` command ACK 骨架，不代表旧 PVP replay、匹配、排名、掉线裁定或 Postgres 结算幂等已经迁移完成。

`bun run game:load:settlement-intent` 是阶段 10 settlement intent 幂等压测起点，默认本地启动 game-server，每个虚拟房间创建 2 个 SDK 客户端，并让同一个玩家重复发送 `surrender` command，验证 ACK 中 `settlementIntent.idempotencyKey` 对同一房间同一败者保持稳定。该脚本只验证 Colyseus intent 幂等键，不代表 Postgres 奖励、掉落、任务推进或死亡惩罚正式落账已经幂等。

`bun run game:load:stage10-local` 是阶段 10 本地单进程基线总入口，会串行执行 100 同图连接、Boss 20 人和 PVP 8 房间压测，并用 `GAME_LOAD_LOCAL_PORT=3301 / 3302 / 3303` 避免本地端口冲突。2026-07-08 本地验证结果：100/100 join + repair 成功，Boss 20/20 command accepted，PVP 16/16 command accepted。该命令不代表 Redis 多实例、真实 Postgres 落账、真实 Boss 奖励或 PVP 排名 / 匹配 / 掉线裁定已经完成。

`bun run game:load:stage10-scale-local` 是阶段 10 本地 scale 总入口，会串行执行 300 多图、500 多房间、1000 连接压测，并用 `GAME_LOAD_LOCAL_PORT=3311 / 3312 / 3313` 避免端口冲突。2026-07-08 本地验证结果：300/300、500/500、1000/1000 join + repair 成功；1000 场景创建 100 个 `WorldMapRoom`，在线 health 可读取并通过 `roomInstancesTruncated` 截断房间明细。该命令不代表线上 Redis 多实例、真实数据库落账或 H5 浏览器渲染压测。

`bun run game:smoke:redis-failure` 会对一个不可达 Redis 地址执行预检，验收标准是返回 `game_server_redis_unavailable`。

`bun run game:smoke:redis-multi` 需要设置真实 `REDIS_URL`。脚本会启动两个不同端口的 game-server 实例，确认两个实例都启用 Redis，再通过实例 A 创建 `WorldMapRoom`，用 RedisDriver 查询该 room cache，并通过实例 B `joinById` 加入同一个房间。该命令只验证多实例共享房间查询和跨实例 join，不替代阶段 10 大规模连接压测。

## 健康检查与基础指标

`/health` 与 `/game-server/health` 当前返回 `metrics` 字段，用于阶段 5 地图迁移和阶段 8 后台监控接入起点。

2026-07-08 补充：health 默认返回前 25 个 `roomInstances`，并通过 `roomInstancesTotal / roomInstancesTruncated` 表示总数和是否截断。原因是 1000 连接 / 100 房间压测时完整房间明细会超过当前路由稳定响应体大小，导致 JSON 被截断；截断后后台仍能看到总活跃房间数、进程级在线人数、峰值在线、消息量和 tick 指标。

阶段 8 已新增 Next 后台代理：

- `/api/admin/game-server/health`
- `/admin/game-server`

后台代理默认读取 `GAME_SERVER_HEALTH_URL`，没有配置时回退到 `GAME_SERVER_PUBLIC_URL / GAME_SERVER_URL + /game-server/health`，再回退到 `http://127.0.0.1:${GAME_SERVER_PORT || 3201}/game-server/health`。

已输出的基础指标：

- `roomsCreated`
- `onlineConnections`
- `peakOnlineConnections`
- `joins`
- `leaves`
- `reconnectLeaves`
- `reconnectSuccesses`
- `reconnectFailures`
- `reconnectSuccessRate`
- `inputMessages`
- `repairInputs`
- `moveAccepted`
- `moveRejected`
- `moveRejectedByReason`
- `interactInputs`
- `travelInputs`
- `sectorSnapshotsSent`
- `sectorDeltasSent`
- `tickSamples`
- `tickAvgMs`
- `tickMaxMs`

阶段 10 补充：`reconnectLeaves` 只应统计异常断线后的重连候选。Colyseus consented leave 默认 close code 为 `4000`，正常 SDK 离开不应计入 `reconnectLeaves`，避免基础压测把普通退出误判为重连压力。`game:load:reconnect` 明确使用 `1001 Going Away` 触发重连候选；实测 `room.leave(false)` 在本地 Bun / Node SDK 场景会被服务端识别成正常 `1000` 关闭，不能作为断线重连压测手段。

注意：这些仍是进程内累计指标，不等于最终运维监控。阶段 8 已补每房间实例 registry、按房间维度的在线人数 / tick 耗时、进程级断线重连成功率、Redis PING 健康和 WebSocket transport 基础计数；多实例聚合、反代层 fallback 细分、Redis 持久化和资源限制仍属后续上线检查。

已验证：

- `bun run game:smoke`
- `bun run game:smoke:redis-failure`
- `bunx tsc --noEmit`
- `bun run lint`
- `bun run build`

`bun run game:smoke` 当前已覆盖官方 `@colyseus/sdk` 本地 join 链路：

- 启动 `game-server`。
- 通过 SDK `joinOrCreate("world_map")` 进入 `WorldMapRoom`。
- 发送 `repair` 输入。
- 等待服务端返回成功 ACK。
- 等待服务端推送带 accepted sequence 的 `sector_snapshot`。
- 验证合法移动、非法移动、NPC / 怪物占位阻挡、AOI enter / leave、同 AOI `entity_update`、`interact / travel` ACK 骨架和 `/health.metrics`。
- 验证阶段 6 战斗起点：BattleRuleset、可配置伤害公式 calculator、迁移期 runtime ruleset、基础伤害、战斗 movement ACK、command missing target、basic attack intent、Boss command、PVP timeout、PVP surrender settlement intent、death penalty intent、重复 settlement idempotency key 和战斗房间 reconnect repair。
- 验证阶段 7 社交起点：`SocialRoom` 同图附近 presence、同队伍 presence、同宗门 presence、附近消息广播和未迁移组队业务命令的明确拒绝 ACK。

## 阶段 4 协议起点

本阶段已把第一版协议集中到 `packages/shared-protocol`，后续地图、战斗、Boss、PVP、社交 presence 不再各自复制字段。

当前协议能力：

- `REALTIME_INPUT_TYPES`
- `REALTIME_OUTPUT_TYPES`
- `RealtimeClientInput`
- `RealtimeServerEnvelope`
- `RealtimeInputAck`
- `MapRealtimeInput`
- `CombatRealtimeInput`
- `SocialRealtimeInput`
- `createRealtimeClientInput(...)`
- `validateRealtimeClientInput(...)`
- `createRealtimeInputAck(...)`

输入元数据统一要求：

- `clientSequence`
- `clientSceneTick`
- `actionId`
- `clientSentAt`
- `inputType`
- `payload`

`BaseGameRoom` 已接入 `validateRealtimeClientInput(...)`，因此缺少序列号、tick、actionId、发送时间、输入类型或 payload 的请求都会得到 `accepted: false` 的 ACK，不再静默丢弃。

前端侧新增：

- `src/modules/shared/services/colyseus-game-client.ts`

这个文件是新 Colyseus client 的统一入口，提供：

- `resolveGameServerEndpoint()`
- `createGameRoomInputSequencer(...)`
- `joinGameRoom(...)`

当前官方浏览器客户端包使用 `@colyseus/sdk`。早期曾因 npm TLS 证书错误 `ERR_TLS_CERT_ALTNAME_INVALID` 阻断安装，现已通过 Bun 安装 `@colyseus/sdk@0.17.43`，并保留可注入的 `GameColyseusLikeClient` 适配器，业务页面仍不直接裸连 WebSocket。

为后续接入做好的入口：

- `createGameColyseusClientFromSdk(...)`
- `joinGameRoomWithSdkClient(...)`
- `loadGameColyseusSdkConstructor(...)`

`createGameColyseusClientFromSdk(...)` 会把官方 SDK 房间适配成项目内部 `GameColyseusLikeRoom`：

- 官方 SDK 房间标识优先读取 `roomId`，内部统一暴露为 `id`。
- 保留 `sessionId / state / send / leave / onMessage / onStateChange`。
- 玩法页只依赖项目 shared 封装，不直接使用第三方 SDK 类型。

## 阶段 6 战斗房间起点

当前新增 `CombatRealtimeRoom`，让以下房间先共用统一 ACK 骨架：

- `CombatRoom`：当前模式为 `solo`。
- `BossRoom`：当前模式为 `boss`。
- `PvpRoom`：当前模式为 `pvp`。

已接入输入：

- `command`
- `movement`
- `useItem`
- `surrender`
- `repair`

当前能力：

- `repair` 返回 ruleset 和 self 权威坐标。
- `movement` 走 `packages/game-rules` 的 `decideBattleMovement(...)`。
- `command` 走 `decideCombatCommand(...)`。
- `surrender` 只生成 settlement intent 和 death penalty intent，不直接写数据库。
- 统一输出 `scene_snapshot`，供后续 Phaser 战斗场景只读接入。
- `CombatRoom / BossRoom / PvpRoom` 异常断线时保留实体 10 秒，重连成功后推送 repair `scene_snapshot`。
- 普攻 / 技能缺少目标返回 `missing_target`。
- 超出命中距离返回 `out_of_range`。

当前边界：

- 旧普通战斗、Boss、PVP 主链还没有切到 game-server。
- 房间还没有读取真实 combatId / Boss / PVP runtime 数据。
- `game:load:combat-command` 只压普通 `CombatRoom` 的 movement + basicAttack ACK。
- `game:load:boss-command` 只压 `BossRoom` 的多人 movement + basicAttack ACK。
- `game:load:pvp-command` 只压 `PvpRoom` 的双人 movement + basicAttack ACK；真实 PVP runtime、PVP 结算和掉线裁定仍待后续补。
- `game:load:settlement-intent` 只压重复 surrender 生成 settlement intent 的幂等键稳定性；Postgres 事务落账幂等仍待后续补。
- Postgres 事务落账、掉落、奖励、任务推进和 Phaser 战斗场景仍待阶段 6 后续任务接入。
- 战斗房间 reconnect grace 已有起点，但真实浏览器 H5 join/reconnect 和弱网人工验收仍待补。

## 阶段 4 鉴权起点

`apps/game-server/src/auth.ts` 已提供独立于 Next `cookies()` 的 game-server 鉴权 helper：

- 解析 Colyseus `AuthContext.headers` 中的 cookie header。
- 识别 `immortality_session`。
- 识别 `immortality_active_player`。
- 通过 `sessions / accounts / players` 校验账号会话与当前角色归属。
- 规范化 `mapId / shardId / combatId / partyId` 等 join options。

环境变量：

- `GAME_SERVER_AUTH_MODE=required`
- `GAME_SERVER_AUTH_MODE=optional`
- `GAME_SERVER_AUTH_MODE=disabled`

生产环境默认 `required`，开发环境默认 `optional`。没有 session cookie 时，开发环境会退回到 client session id，保证 `bun run game:smoke` 不依赖本地数据库；一旦请求携带 session，就会懒加载 DB 并执行真实校验。

## 已修复问题

### 非法移动坐标污染权威状态

检测方式：

- 直接调用 `WorldMapRoom` 的 `move` 输入处理，传入 `{ x: Number.NaN, y: 0 }`。
- 修复前服务端会返回 `accepted: true`，并把实体 `x` 与 `velocityX` 写成 `NaN`，JSON 序列化后表现为 `null`。

修复内容：

- `packages/game-rules` 的 `decideGridMovement(...)` 现在会拒绝非有限数字与非整数格子坐标。
- `decideGridMovement(...)` 支持 `occupiedTiles`，阶段 5 当前用它阻止玩家移动进 NPC / 怪物占位格；玩家之间暂不互相阻挡。
- `BaseGameRoom` 对非法 `move` payload 返回明确 `ack`，不再静默 `return`。
- `packages/shared-protocol` 新增 `RealtimeInputAck`，统一 `accepted / reason / serverTick / authoritativeState` 形状。
- `bun run game:smoke` 增加非法坐标回归检测，确保非法输入不会改变服务端权威位置。

### WorldMapRoom 接入地图结构与玩家位置

阶段 5 第一轮已经让 `WorldMapRoom` 从纯演示房间进入真实数据入口：

- 新增 `apps/game-server/src/world-map-data.ts`。
- 优先读取普通地图表 `maps`。
- 普通地图不存在时读取开放世界地图表 `world_map_instances`。
- 读取地图字段：
  - `id`
  - `name`
  - `width`
  - `height`
  - `tilesData`
- 从 `tilesData` 中提取阻挡格：
  - `walkable === false`
  - `type` 为 `water / mountain / building`
- 读取玩家字段：
  - `players.currentMapId`
  - `players.positionX`
  - `players.positionY`
  - `players.name`
- 房间 `GameRoomState` 增加：
  - `mapName`
  - `mapRuntimeSource`
  - `mapWidth`
  - `mapHeight`
- `BaseGameRoom` 的 `move` 判定现在会带上：
  - 地图宽度
  - 地图高度
  - 阻挡格集合

降级规则：

- 本地没有 `DATABASE_URL`、数据库不可连接或目标地图不存在时，房间会进入 fallback 地图。
- fallback 地图尺寸为 `16 x 16`，不会影响 `bun run game:smoke`。
- 降级会写出明确 warn 日志，不伪装成真实地图已加载。

当前边界：

- 第一轮只接入地图结构和玩家初始位置。
- 后续轮次已经补入普通地图 NPC、怪物、开放世界 NPC、active 机缘、传送点与全局秘境入口。
- AOI 分区、实体 enter/leave、服务端 repair 与 `WorldMapRoom` 10 秒 reconnect grace 已有协议起点，地图事件落账和真实 H5 三端前后台恢复验收仍在后续阶段。
- 客户端 `/game/map` 仍未迁到 Phaser + Colyseus。

新增 smoke 覆盖：

- DB 不可用时地图数据加载器必须返回可用 fallback 地图。
- 越界移动必须返回 `accepted: false / reason: out_of_bounds`，并且不能改变权威坐标。

### WorldMapRoom sector AOI 起步版

阶段 5 第二轮新增了 `WorldMapRoom` 的服务端 AOI 基础：

- 新增 `apps/game-server/src/world-map-aoi.ts`。
- 当前扇区大小为 `16 x 16` 格。
- 当前 AOI 半径为 `1` 个扇区，也就是订阅自身扇区和周围 8 个扇区。
- `WorldMapRoom` 为每个 client 维护：
  - 当前订阅扇区集合
  - 当前可见实体 ID 集合
- 玩家加入房间后会收到 `sector_snapshot`。
- 玩家权威移动成功后会触发 AOI 重算。
- AOI 可见性变化会发送 `sector_delta`，事件包含：
  - `entity_enter`
  - `entity_leave`
- `sector_snapshot / sector_delta` 使用 `RealtimeServerEnvelope` 形状，包含：
  - `serverTick`
  - `roomId`
  - `snapshotVersion`
  - `acceptedSequence`
  - `authoritativeState`
  - `events`

当前边界：

- Colyseus Schema 仍会同步 `state.entities`，本轮 AOI 主要先建立服务端订阅与增量协议，不等于最终网络裁剪已经完成。
- 玩家、普通地图 NPC、普通地图怪物、开放世界 NPC、active 机缘、传送点、全局秘境入口、个人可见秘境入口已参与 AOI。
- NPC/怪物当前已通过低频数据源刷新进入 AOI delta，还没有接 AI 主动移动、互动或战斗入口。
- 机缘、传送点和全局秘境入口当前只做实体可见性，还没有接点击交互、领取、传送或进入秘境。
- 个人可见秘境入口已作为 client 私有 AOI 实体进入 `WorldMapRoom`；更复杂临时事件还没有进入实体系统。
- 客户端已经通过 H5 Canvas 过渡层消费 `sector_snapshot / sector_delta`，后续 Phaser 接入时再替换主场景实现。

新增 smoke 覆盖：

- 跨扇区移动后会生成 `entity_enter`。
- 加入 `WorldMapRoom` 时会发送 `sector_snapshot`。
- `entity_enter` 与 `sector_snapshot` 会保留 NPC / 怪物实体类型。

### WorldMapRoom 接入 NPC 与怪物实体

阶段 5 第三轮让 `WorldMapRoom` 不再只有玩家实体：

- `apps/game-server/src/world-map-data.ts` 新增地图实体读取：
  - 普通地图读取 `npcs`。
  - 普通地图读取 `monsters`，优先使用 `currentPositionX / currentPositionY`，缺失时回退出生点坐标。
  - 开放世界地图读取 `world_npc_profiles + world_npc_runtime` 中已激活、未死亡的世界 NPC。
- 所有 NPC / 怪物坐标都会按当前地图宽高 clamp，避免脏坐标污染房间状态。
- `apps/game-server/src/rooms/world-map-room.ts` 会把这些记录写入 Colyseus `state.entities`：
  - `kind = npc`
  - `kind = monster`
  - 实体 id 使用 `npc:<id>` / `monster:<id>` 前缀，避免与玩家 session id 冲突。
- 实体读取失败只标记 `entitiesDegraded` 并记录 warning，不把已成功加载的地图结构降级成 fallback。

当前边界：

- 这轮只做实体进入房间和 AOI 可见性，不做 NPC AI 移动、怪物移动、点击交互、开战、机缘触发或传送。
- Colyseus Schema 仍会广播完整 `state.entities`，真正网络裁剪留到客户端消费 AOI 后再推进。
- 旧 `/game/map` 页面已经把这些 Colyseus 实体融合进 H5 Canvas 过渡渲染层，但交互、开战、传送和落账仍走旧 API。

### WorldMapRoom 接入机缘、传送点与全局秘境入口

阶段 5 第四轮继续补齐地图静态可见实体：

- 普通地图读取 `map_opportunity_spawns + random_events`：
  - 只同步未领取、未过期、类型为 `opportunity` 的 active 机缘。
  - 实体 `kind = opportunity`，id 前缀为 `opportunity:`。
- 普通地图读取 `secret_realm_spawns + secret_realm_templates`：
  - 只同步 `spawnType = global`、`status = active`、未过期的全局秘境入口。
  - 个人可见秘境入口不写入房间全局状态，避免被同房间其他玩家误见；后续阶段 5 第十轮已改为 client 私有 AOI 实体。
  - 实体 `kind = secret_realm`，id 前缀为 `secret_realm:`。
- 普通地图和开放世界地图都会解析 `tilesData` 中 `type = portal` 且可通行的 portal tile。
- 开放世界地图额外读取 `world_map_portals`。
- 所有新增实体坐标都会按地图宽高 clamp。

新增 smoke 覆盖：

- `sector_snapshot` 必须包含 `opportunity / portal / secret_realm` 类型实体。

当前边界：

- 这轮仍只做服务端房间实体与 AOI 可见性，不做领取机缘、传送、进入秘境、刷新后移除。
- 机缘领取、秘境进入、传送行为仍需要后续接 `interact / travel / repair` 协议与客户端消费。

### WorldMapRoom 私有实体、动态刷新与指标补强

阶段 5 第十轮补上三个服务端缺口：

- `WorldMapRoom` 现在按 session 维护 `clientPrivateEntities`。
- 个人秘境入口读取 `secret_realm_spawns` 中 `spawnType = personal`、`status = active`、未过期且 owner / `visiblePlayerIds` 命中的记录。
- 私有实体只进入对应 client 的 `sector_snapshot / sector_delta`，不会写入公共 `state.entities`，避免个人入口泄露给同 AOI 其他玩家。
- 房间每 5 秒低频刷新公共地图实体和各 client 私有实体：
  - NPC / 怪物位置变化会输出 `entity_update`。
  - 新刷新的机缘、秘境、传送点会输出 `entity_enter`。
  - 死亡、过期、领取或消失的实体会输出 `entity_leave`。
- 重建实体时会保留未变化实体的 `updatedAt`，避免无意义刷新造成客户端收到虚假的 `entity_update`。
- `/health` runtime metrics 新增进程级在线连接、峰值在线、tick 平均 / 最大耗时、重连失败数和重连成功率。

当前边界：

- 这是低频数据源刷新，不是 NPC / 怪物 AI 主循环。
- 指标仍是进程级累计值，不是最终每房间实例 registry。

### WorldMapRoom 服务端 repair

阶段 5 第五轮补上地图服务端 repair 起点：

- `BaseGameRoom` 现在识别 `inputType = repair`。
- 默认房间对 repair 返回 `unsupported_input`，避免非地图房间误报成功。
- `WorldMapRoom` 覆盖 repair：
  - 如果玩家实体不存在，返回 `accepted: false / reason: entity_missing`。
  - 如果玩家实体存在，先返回 `accepted: true` ACK。
  - 随后立刻推送当前 AOI 的 `sector_snapshot`。
  - `sector_snapshot.acceptedSequence` 会带上本次 repair 的 `clientSequence`。

新增 smoke 覆盖：

- `repair` 输入必须返回成功 ACK。
- `repair` 输入必须推送带 accepted sequence 的 `sector_snapshot`。

当前边界：

- 这轮只做服务端 repair，不等于 `/game/map` 客户端已经接入自动 repair。
- repair 当前返回 sector snapshot，不处理领取机缘、传送、进入秘境或地图事件落账。

### WorldMapRoom interact / travel ACK 骨架

阶段 5 第六轮补上地图交互与传送的服务端 ACK 骨架：

- `BaseGameRoom` 现在识别 `inputType = interact / travel`。
- 默认房间对这两类输入返回 `unsupported_input`。
- `WorldMapRoom` 对 `interact` 做基础校验：
  - 玩家实体不存在：`entity_missing`。
  - `entityId` 缺失：`invalid_payload`。
  - 目标实体不存在：`target_missing`。
  - 目标超过 1 格：`too_far`。
  - 目标存在且距离合法，但业务未迁移：`unsupported_input`。
- `WorldMapRoom` 对 `travel` 做基础校验：
  - 玩家实体不存在：`entity_missing`。
  - `targetMapId` 缺失：`invalid_payload`。
  - 参数合法但传送业务未迁移：`unsupported_input`。
- 这样前端不会因为未知输入静默丢包，也不会把未完成的领取/传送误判成成功。

新增 smoke 覆盖：

- `interact` 的坏参数、目标缺失、距离过远、合法但未迁移分支都有明确 ACK。
- `travel` 的坏参数、合法但未迁移分支都有明确 ACK。

### WorldMapRoom interact / travel 真实事务起点

阶段 5 第十一轮把 `interact / travel` 从纯 ACK 骨架推进到有限真实事务：

- 新增 `apps/game-server/src/world-map-transactions.ts`。
- 新增 Drizzle schema：`mapRealtimeEventLogs`。
- 新增 SQL 迁移：`drizzle/0070_map_realtime_event_logs.sql`。
- 幂等 key 使用 `roomId + playerId + actionId`。
- `interact` 当前支持：
  - 校验实体存在和距离。
  - 对 `opportunity:<spawnId>` 执行 `map_opportunity_spawns` claim 事务。
  - 重复同一 action 或同一玩家已领取时返回幂等成功。
  - best-effort 写 `map_realtime_event_logs`。
- `travel` 当前支持：
  - 校验玩家仍在当前房间 map。
  - 校验目标地图存在、境界满足、地图边或当前格传送点连通。
  - 更新 `players.currentMapId / positionX / positionY`。
  - ACK 返回目标地图和新坐标，并从旧房间移除玩家实体。
  - best-effort 写 `map_realtime_event_logs`。

当前边界：

- 随机事件奖励、NPC 交互、秘境进入 / 离开、开放世界特殊传送仍留旧 Next API。
- `map_realtime_event_logs` 迁移文件已手写；`drizzle-kit generate` 在当前工作区进入表重命名交互，不能自动选择。
- game-server 写日志使用 best-effort：表未迁移时会 warning，但不阻断实时事务。
- game-server 在懒加载项目 DB 前会先检查 `DATABASE_URL`。本地未配置数据库时，`WorldMapRoom` 会降级到 fallback 地图并明确记录 `DATABASE_URL 未配置`，避免 Bun 在失败模块缓存后产生 `Cannot access 'db' before initialization` 的误导日志。

### Phaser 地图灰度壳

阶段 5 第十一轮新增 H5 Phaser 地图灰度壳：

- 新增 `src/modules/map/ui/components/WorldMapPhaserScene.tsx`。
- `/game/map` 中 `MapSceneViewport` 支持 `NEXT_PUBLIC_WORLD_MAP_PHASER_SCENE=1` 时启用 Phaser。
- 默认仍使用旧 `MapGrid`，避免未完成 iOS Safari / Android Chrome / PC 人工验收前强切。
- Phaser 灰度壳复用现有 Colyseus AOI 融合后的 `sceneSnapshot`，不直接裸连 WebSocket。
- 当前支持格子绘制、玩家 / NPC / 怪物 / 机缘 / 传送点 / 秘境实体绘制、点击格子复用现有移动回调。
- 当前支持左下角轻量虚拟摇杆，摇杆仍复用现有 `onTileClick` 进入服务端权威移动链路，不在 Phaser 内本地落账。
- 当前支持其他玩家、NPC、怪物的插值和平滑外推，复用 `resolveMapSceneRenderEntities(...)`，避免页面和 Phaser 各自实现一套位置表现。
- 当前支持服务端纠偏表现，`MapSceneSelfCorrection` 会在 Phaser 内绘制权威坐标纠偏动画。
- 当前支持弱网状态点和手动 repair：连接异常、重连中或弱网时，右上角状态点可触发 `repair`。

当前边界：

- 灰度壳只是主场景替换入口，不代表旧地图主链已经完全退役。
- Phaser 灰度壳默认关闭，仍需 iOS Safari、Android Chrome、PC 浏览器真实打开 `/game/map` 验证触摸、摇杆、前后台恢复、repair 和布局遮挡。
- 当前移动主链默认仍是旧 `/api/game/map/move` + Colyseus 影子同步；`NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=main` 仅作为后续主链灰度开关。

### H5 断线重连与弱网 repair

阶段 5 第十二轮补齐 H5 客户端侧断线恢复：

- `src/modules/shared/services/colyseus-game-client.ts` 增加 `onLeave / onReconnect` 封装，玩法页仍只依赖 shared Colyseus client，不直接裸连 WebSocket。
- `src/modules/map/ui/hooks/useWorldMapColyseusAoi.ts` 增加 `reconnecting / weakNetwork / reconnectAttempts / lastMessageAt / lastRepairAt` 状态。
- SDK `onLeave` 后按退避重新 `joinOrCreate`，不依赖刷新页面恢复连接。
- SDK `onReconnect` 成功后发送 `repair`，拉取权威 `sector_snapshot`。
- 浏览器 `online`、`focus`、`pageshow`、`visibilitychange` 恢复后发送 `repair`，覆盖 iOS Safari 和 PWA 从后台回前台的常见断链场景。
- 长时间没有收到 `sector_snapshot / sector_delta / ack` 时标记弱网并触发 `weak_network_timeout` repair。

当前边界：

- 代码层已经具备断线监听、自动 rejoin、前后台恢复 repair、弱网 timeout repair 和服务端 10 秒 reconnect grace。
- `bun run game:load:reconnect` 只能验证 SDK 协议层重连，不等于 iOS Safari 锁屏 / 切后台 / 1Panel 反代下的真实 H5 验收。
- 真机验收通过前，不把“断线重连完成”写成正式线上验收完成。

### /game/map 客户端 Colyseus AOI / repair 只读接入

阶段 5 第七轮把旧 H5 地图页接入新的 Colyseus 通道，但不替换旧地图主流程：

- `packages/shared-protocol` 新增 `WorldMapAoiEntity`、`WorldMapSectorAuthoritativeState`、`WorldMapSectorEvent`、`WorldMapSectorEnvelope`，地图 AOI 输出类型不再由客户端和 game-server 各自复制。
- `src/modules/shared/services/colyseus-game-client.ts` 增加通用 `onMessage<T>()` 类型和 `resolveGlobalGameColyseusSdkConstructor()`，允许后续通过全局 SDK adapter 接入真实浏览器 Colyseus client。
- 后续补充：`src/modules/shared/services/colyseus-game-client.ts` 已增加 `loadGameColyseusSdkConstructor()`，会优先读取全局 `window.Colyseus.Client`，缺失时动态加载 `@colyseus/sdk` 的 `Client`。
- 新增 `src/modules/map/ui/hooks/useWorldMapColyseusAoi.ts`：
  - 能加载到 `window.Colyseus.Client` 或 `@colyseus/sdk` 时尝试加入 `world_map` 房间。
  - SDK 不可用时进入 `sdk_unavailable`，不影响旧地图页面加载、移动和渲染。
  - 订阅 `sector_snapshot / sector_delta`。
  - 保存最新 AOI 权威状态、ACK、server tick、snapshot version、订阅扇区和实体列表。
  - 连接成功后通过 shared input sequencer 发送一次 `repair`，用于消费服务端 repair ACK + 当前 AOI `sector_snapshot`。
- `/game/map` 页面已挂载该 hook，传入当前 `mapId / playerId / shardId`。早期只读消费不影响旧地图页面加载、移动和渲染。

当前边界：

- 真实 `@colyseus/sdk` 已安装，hook 已接入动态 SDK adapter；本地 `game:smoke` 已验证官方 SDK join + repair，但还没有做真实浏览器登录态 join 与 1Panel 反代验证。
- 客户端生命周期、协议类型、消息消费和 repair 发送路径已有本地验证；Phaser 地图灰度壳已经接入，但默认关闭，仍待真实 iOS Safari / Android Chrome / PC 人工验收。
- 多账号同图可见、真实浏览器断线 10 秒重连和 iOS Safari 弱网前后台 repair 仍在后续阶段验收。SDK 层 `game:load:reconnect` 与 `game:load:repair` 只能作为协议压测起点。

### /game/map 客户端 AOI 真实渲染过渡层

阶段 5 第八轮把 Colyseus AOI 接入旧 H5 地图 Canvas 渲染，但仍不替换旧地图主流程：

- `/game/map` 现在会把 `WorldMapAoiEntity` 融合成 `MapSceneSnapshot`，供现有 `MapGrid` Canvas 渲染。
- 玩家业务状态 `sceneData` 不会被 AOI 直接写回，避免新房间快照影响旧 `/api/game/map/move` 的移动链路。
- 其他玩家实体来自 Colyseus AOI；若旧 API 已有头像、境界等详情，则沿用旧详情，否则用保守默认展示。
- NPC、怪物、机缘会按 AOI 的 `npc:`、`monster:`、`opportunity:` 前缀拆回旧业务 id，只覆盖坐标与可见集合，点击详情、开战、领取仍走旧数据和旧 API。
- 传送点与秘境入口当前仍不通过 AOI 驱动交互，避免字段不足时误触发传送或进入副本。

当前边界：

- 默认地图主场景仍是现有 H5 Canvas；设置 `NEXT_PUBLIC_WORLD_MAP_PHASER_SCENE=1` 后可启用 Phaser 灰度壳。
- 这不是 Colyseus 移动主链切换，旧 `/api/game/map/move` 仍保留。
- 真实浏览器 cookie join、iPhone Safari / Android Chrome / PC 人工验收仍待执行。

### /game/map 旧移动后的 Colyseus move 影子同步

阶段 5 第九轮给旧地图移动接入 Colyseus `move` 影子同步：

- `useWorldMapColyseusAoi` 新增 `sendMove({ x, y })`，通过 shared Colyseus client 发送统一 `RealtimeClientInput<inputType = move>`。
- `useMapSceneController` 新增 `onAuthoritativeMove` 回调，只在旧 `/api/game/map/move` 成功并拿到服务端确认坐标后触发。
- `/game/map` 使用旧 API 返回的 `authoritativePosition` 向 `WorldMapRoom` 发送 `move`，让 Colyseus AOI 状态跟随旧主链。
- 如果 Colyseus 还未连接，影子同步会跳过，不影响旧地图移动、事件、传送和交互。
- 当前不会在旧 API 之前先发 Colyseus `move`，避免旧 API 拒绝时造成双写错位。

当前边界：

- 旧 `/api/game/map/move` 仍是落账、随机事件、机缘触发和业务交互的权威入口。
- Colyseus `move` 仍未持久化玩家坐标到 Postgres。
- 完整的 Colyseus 主链移动、ACK 驱动纠偏、真实 H5 弱网自动 repair 和前后台断线重连恢复仍待后续阶段。

### 官方 SDK matchmaking / WebSocket join 修复

检测方式：

- 使用官方 `@colyseus/sdk` 对本地 `game-server` 执行 `joinOrCreate("world_map")`。
- 修复前 `/matchmake/joinOrCreate/world_map` 要么 404，要么返回 seat reservation 后 WS 连接收到 `seat reservation expired`。

修复内容：

- `apps/game-server/src/server.ts` 改为通过 Colyseus `server.listen(...)` 启动，使默认 `/matchmake/:method/:roomName` router 被注册。
- `/health` 与 `/game-server/health` 改为 Colyseus router endpoint，不再用自建 HTTP request listener 抢先返回 404。
- 新增 `SameCoreWebSocketTransport`，避免官方 ws transport 在当前 Bun 安装树中加载第二份 `@colyseus/core`。
- `GameRoomState.entities` 改为构造函数赋值，确保 `MapSchema` 能通过 schema setter 写入 child type，避免 full state 序列化时报 `type[Symbol.metadata]`。
- `createGameServer().shutdown()` 增加 graceful shutdown 超时兜底，避免 smoke 因房间 dispose 等待卡住。

新增 smoke 覆盖：

- 官方 SDK join 必须成功返回 `roomId / sessionId`。
- SDK 房间发送 `repair` 后必须收到成功 ACK。
- SDK 房间发送 `repair` 后必须收到对应 `sector_snapshot`。

## 当前边界

- 玩家 session cookie 已接入 Colyseus `onAuth` 起点；本地官方 SDK join 已通过，但还没有做真实浏览器 cookie join 验证。
- `WorldMapRoom` 已有真实地图结构、玩家初始位置、普通地图 NPC/怪物、开放世界 NPC、active 机缘、传送点、全局秘境入口、个人可见秘境入口、移动权威校验、sector AOI、服务端 repair、`interact` 机缘 claim 事务、`travel` 普通地图切图事务与幂等事件日志；`/game/map` 已把 AOI / repair hook 的 `sector_snapshot / sector_delta` 融合进 H5 Canvas 过渡渲染层，并在旧移动成功后影子同步 Colyseus `move`。
- 旧 `/api/game/map/move` 已支持通过 `WORLD_MAP_LEGACY_MOVE_DISABLED=1` 或 `NEXT_PUBLIC_WORLD_MAP_COLYSEUS_MODE=main` 返回 410 迁移提示；默认仍保留旧主链作为灰度回滚口。
- 战斗房间已有阶段 6 ACK 骨架，普通战斗 command、Boss command 与 PVP command SDK 小样本已可压通；但还没有读取真实战斗 / Boss / PVP 数据或切换旧战斗主链，真实结算幂等和 H5 战斗场景仍待迁移。
- Redis 多实例共享房间查询已有 `bun run game:smoke:redis-multi` 可重复命令，但本地无 `REDIS_URL` 时不会执行；线上还需要使用真实 Redis 留存输出。
- Redis 故障演练已有 `bun run game:smoke:redis-failure`，且 game-server 启动前会执行 Redis PING 预检。
- Next 前端已有 Colyseus client 抽象入口、真实 `@colyseus/sdk` adapter 和地图业务页面只读 hook。
- Phaser 地图灰度壳已接入 `/game/map`，默认关闭；地图 Phaser 壳已具备点击移动、虚拟摇杆、插值、纠偏、弱网提示和手动 repair。战斗画面尚未迁移 Phaser。

## 后续顺序

1. 用真实浏览器 join 验证 cookie 鉴权链路。
2. 继续留存 1Panel WebSocket upgrade 与移动端 H5 Safari 连接表现；2026-07-08 已验证 `/colyseus` upgrade 返回 `101 Switching Protocols`。
3. 做真实浏览器 cookie join、前后台恢复、弱网 repair 与多账号同图移动人工验证。
4. 继续迁移 `/game/map` Colyseus 主链移动和坐标差异日志。
5. 再进入 `CombatRoom` / `BossRoom` / `PvpRoom` 业务迁移。
